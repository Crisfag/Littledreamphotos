// Musique d'ambiance, côté client, dans un vrai navigateur, contre le vrai
// Worker local : morceau de la bibliothèque (lu comme un MP3, avec son
// crédit) et lien Spotify (lecteur officiel chargé seulement au clic).
// Autonome : crée son compte, sa galerie et un morceau, nettoie derrière lui.
//
//   npm run dev:local                      (depuis worker/)
//   node tests/music.test.mjs              (depuis tools/)

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../lib/client.mjs";
import { processPhoto } from "../lib/pipeline.mjs";
import { createTestAccount } from "./lib/testAccount.mjs";

const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_DIR = join(REPO_ROOT, "galerie", "web");
const PHOTO = join(REPO_ROOT, "images", "famille", "famille-01.jpeg");
const SITE_PORT = Number(process.env.SITE_PORT || 8000); // seule origine locale autorisée par le Worker (ALLOWED_ORIGINS)

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

/* ---------- Bibliothèque (propriétaire), compte, galerie ---------- */

// Compte propriétaire (OWNER_EMAIL de worker/wrangler.toml), créé ou retrouvé
// avec le même mot de passe fixe que les autres suites de tests.
const OWNER_EMAIL = "fagnantchristine@gmail.com";
const OWNER_PASSWORD = "mot-de-passe-de-la-proprietaire-1234";
await fetch(`${API}/api/auth/signup`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD, studioName: "Holypixx" }),
});
const owner = new WorkerClient({ api: API, email: OWNER_EMAIL, password: OWNER_PASSWORD });
const TRACK = Buffer.alloc(8000, 7);
const title = `Clair de lune ${Date.now().toString(36)}`;
const { track } = await owner.request(
  "PUT",
  `/api/owner/music?title=${encodeURIComponent(title)}&artist=Pianiste&mood=piano&credit=${encodeURIComponent("Pianiste — CC BY 4.0")}&duration=120`,
  TRACK,
  true
);

const account = await createTestAccount(API, "musique");
const client = new WorkerClient({ api: API, ...account });
const slug = `musique-${Date.now().toString(36)}`;
const PASSWORD = "mot-de-passe-musique-test";
const created = await client.createGallery({ slug, title: "Test musique automatisé", clientName: "Suite de tests", password: PASSWORD });
const input = await readFile(PHOTO);
const { photo, tiles } = await processPhoto(input, { galleryId: created.id, forensicKey: "cle-de-test-musique", watermarkText: "Test", position: 0 });
await client.addPhoto(slug, photo);
for (const tile of tiles) await client.putTile(photo.id, tile.level, tile.col, tile.row, tile.buffer);

/* ---------- Site statique local ---------- */

const STATIC_TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8" };
const site = createServer(async (req, res) => {
  const pathname = req.url.split("?")[0] === "/" ? "/galerie.html" : req.url.split("?")[0];
  try {
    let body = await readFile(join(WEB_DIR, pathname));
    const ext = pathname.split(".").pop();
    if (ext === "html") body = body.toString().replace(/api: "[^"]*"/, `api: "${API}"`);
    res.writeHead(200, { "content-type": STATIC_TYPES[ext] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve, reject) => {
  site.once("error", reject);
  site.listen(SITE_PORT, "localhost", resolve);
});

const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ["--disable-features=LocalNetworkAccessChecks", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
// Aucun service extérieur n'est joint pendant le test : on note seulement
// ce que la page aurait chargé chez Spotify.
const spotifyRequests = [];
await page.route("https://open.spotify.com/**", (route) => {
  spotifyRequests.push(route.request().url());
  route.fulfill({ status: 200, contentType: "text/html", body: "<p>lecteur</p>" });
});

async function login() {
  await page.goto(`http://localhost:${SITE_PORT}/galerie.html?g=${slug}`, { waitUntil: "domcontentloaded" });
  await page.fill("#gp-password", PASSWORD);
  await page.click("#gp-submit");
  await page.waitForSelector("#gp-gallery:not([hidden])", { timeout: 10000 });
  await page.waitForTimeout(500);
}

/* ---------- Morceau de la bibliothèque ---------- */

await client.request("POST", `/api/admin/galleries/${slug}/music-choice`, { source: "library", trackId: track.id });
const musicResponse = page.waitForResponse((r) => r.url().endsWith(`/api/gallery/${slug}/music`), { timeout: 10000 }).catch(() => null);
await login();
check("un morceau de la bibliothèque propose le bouton de musique", await page.isVisible("#gp-music"));
check("son titre, son artiste et son crédit de licence sont affichés discrètement",
      (await page.textContent("#gp-music-credit")).includes(title) && (await page.textContent("#gp-music-credit")).includes("CC BY 4.0"));
await page.click("#gp-music");
const served = await musicResponse;
check("la piste est servie par le Worker de la galerie, sans service extérieur", Boolean(served) && [200, 206].includes(served.status()));

/* ---------- Lien Spotify ---------- */

await client.request("POST", `/api/admin/galleries/${slug}/music-choice`, { source: "link", url: "https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO" });
await login();
check("avec un lien Spotify, le bouton annonce le lecteur Spotify",
      (await page.textContent("#gp-music-label")).includes("Spotify") && await page.isHidden("#gp-music-credit"));
check("rien n'est chargé chez Spotify tant que le client n'ouvre pas le lecteur",
      spotifyRequests.length === 0 && (await page.locator("#gp-music-player iframe").count()) === 0);
await page.click("#gp-music");
await page.waitForSelector("#gp-music-player:not([hidden]) iframe", { timeout: 5000 });
check("au clic, le lecteur officiel s'ouvre sur la bonne playlist",
      (await page.getAttribute("#gp-music-player iframe", "src")) === "https://open.spotify.com/embed/playlist/37i9dQZF1DX4sWSpwq3LiO" &&
      (await page.getAttribute("#gp-music", "aria-expanded")) === "true");
await page.click("#gp-music-player-min");
check("« Réduire » cache le lecteur sans l'arrêter",
      await page.isHidden("#gp-music-player") && (await page.locator("#gp-music-player iframe").count()) === 1 &&
      (await page.getAttribute("#gp-music", "aria-pressed")) === "true");
await page.click("#gp-music");
await page.click("#gp-music-player-close");
check("« Fermer » retire le lecteur (la musique s'arrête)",
      await page.isHidden("#gp-music-player") && (await page.locator("#gp-music-player iframe").count()) === 0 &&
      (await page.getAttribute("#gp-music", "aria-pressed")) === "false");

/* ---------- Sans musique ---------- */

await client.request("POST", `/api/admin/galleries/${slug}/music-choice`, { source: "none" });
await login();
check("sans musique choisie, aucun bouton ni lecteur", await page.isHidden("#gp-music") && await page.isHidden("#gp-music-player"));

check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

/* ---------- Nettoyage ---------- */

await browser.close();
site.close();
await client.request("DELETE", `/api/admin/galleries/${slug}`).catch(() => {});
await owner.request("DELETE", `/api/owner/music/${track.id}`).catch(() => {});

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
