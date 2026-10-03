// Vérification des codes couleur (validée / à retoucher / à écarter) et des
// repères annotés (un point posé sur la photo + une note) dans un vrai
// navigateur, contre le vrai Worker local. Autonome : crée sa propre
// galerie, sert la page cliente, nettoie derrière elle.
//
//   npm run dev:local                      (depuis worker/)
//   node tests/marks.test.mjs              (depuis tools/)

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
const PHOTOS = [
  join(REPO_ROOT, "images", "famille", "famille-01.jpeg"),
  join(REPO_ROOT, "images", "famille", "famille-02.jpeg"),
];

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

/* ---------- Galerie de test, créée pour de vrai sur le Worker local ---------- */

const account = await createTestAccount(API, "marks");
const client = new WorkerClient({ api: API, ...account });
const slug = `reperes-${Date.now().toString(36)}`;
const PASSWORD = "mot-de-passe-reperes-test";

const created = await client.createGallery({
  slug,
  title: "Test repères automatisé",
  clientName: "Suite de tests",
  password: PASSWORD,
});

for (const [position, file] of PHOTOS.entries()) {
  const input = await readFile(file);
  const { photo, tiles } = await processPhoto(input, {
    galleryId: created.id,
    forensicKey: "cle-de-test-reperes",
    watermarkText: "Test",
    position,
  });
  await client.addPhoto(slug, photo);
  for (const tile of tiles) await client.putTile(photo.id, tile.level, tile.col, tile.row, tile.buffer);
}
console.log(`Galerie de test créée : ${slug} (${PHOTOS.length} photos)`);

/* ---------- Petit serveur statique : web/*, avec l'API du Worker injectée ---------- */

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
const SITE_PORT = Number(process.env.SITE_PORT || 8000);
await new Promise((resolve, reject) => {
  site.once("error", reject);
  site.listen(SITE_PORT, "localhost", resolve);
});
const siteBase = `http://localhost:${SITE_PORT}`;

/* ---------- Navigateur ---------- */

// Chromium récent bloque par défaut les requêtes d'une origine locale vers
// un autre port local (« Local Network Access ») : la page servie ici doit
// pourtant joindre le Worker local sur son propre port.
const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ["--disable-features=LocalNetworkAccessChecks"],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));

async function login() {
  await page.goto(`${siteBase}/galerie.html?g=${slug}`, { waitUntil: "networkidle" });
  await page.fill("#gp-password", PASSWORD);
  await page.click("#gp-submit");
  await page.waitForSelector("#gp-gallery:not([hidden])", { timeout: 10000 });
  await page.waitForTimeout(1200);
}

async function openFirstPhoto() {
  await page.locator(".gp-open").first().click();
  await page.waitForSelector("#gp-viewer:not([hidden])");
  await page.waitForTimeout(800);
}

const firstPhotoId = (await client.getGallery(slug)).photos[0].id;
const photoOnWorker = async () => (await client.getGallery(slug)).photos.find((p) => p.id === firstPhotoId);

await login();
check("aucune pastille de couleur ni compteur de repères au départ",
      (await page.locator(".gp-tag-dot:visible").count()) === 0 && (await page.locator(".gp-mark-badge:visible").count()) === 0);

/* ---------- Code couleur depuis la visionneuse ---------- */

await openFirstPhoto();
check("aucun code couleur actif par défaut",
      (await page.locator('.gp-tag[aria-pressed="true"]').count()) === 0);

await page.click(".gp-tag-green");
await page.waitForTimeout(500);
check("cliquer sur le vert marque la photo « validée » à l'écran",
      await page.getAttribute(".gp-tag-green", "aria-pressed") === "true");
check("le Worker enregistre le code couleur", (await photoOnWorker()).tag === "green");

await page.click(".gp-tag-green");
await page.waitForTimeout(500);
check("re-cliquer sur la couleur active la retire",
      await page.getAttribute(".gp-tag-green", "aria-pressed") === "false" && (await photoOnWorker()).tag === "");

await page.click(".gp-tag-yellow");
await page.waitForTimeout(500);
check("une autre couleur remplace la précédente", (await photoOnWorker()).tag === "yellow");

/* ---------- Poser un repère annoté ---------- */

check("le mode « placer un repère » est inactif par défaut",
      await page.getAttribute("#gp-pin-toggle", "aria-pressed") === "false" && await page.isHidden("#gp-pin-hint"));
await page.click("#gp-pin-toggle");
check("activer le mode affiche la consigne", await page.isVisible("#gp-pin-hint"));

await page.locator("#gp-pins").click(); // au centre du calque = centre de la photo
await page.waitForSelector("#gp-pin-editor:not([hidden])", { timeout: 5000 });
check("toucher la photo pose un repère et ouvre la note", (await page.locator(".gp-pin").count()) === 1);
check("le mode de placement se désactive après la pose",
      await page.getAttribute("#gp-pin-toggle", "aria-pressed") === "false");
check("le champ de note reçoit le focus", await page.evaluate(() => document.activeElement.id === "gp-pin-note"));

await page.fill("#gp-pin-note", "retirer ce reflet");
await page.click("#gp-pin-save");
await page.waitForTimeout(600);
check("la note est fermée et le repère reste affiché",
      await page.isHidden("#gp-pin-editor") && (await page.locator(".gp-pin").count()) === 1);
const savedMarks = (await photoOnWorker()).marks;
check("le Worker enregistre le repère au centre de la photo, avec sa note",
      savedMarks.length === 1 && Math.abs(savedMarks[0].x - 0.5) < 0.05 && Math.abs(savedMarks[0].y - 0.5) < 0.05 &&
      savedMarks[0].note === "retirer ce reflet",
      JSON.stringify(savedMarks));

/* ---------- Relire, annuler, abandonner ---------- */

await page.click(".gp-pin");
await page.waitForSelector("#gp-pin-editor:not([hidden])");
check("cliquer sur un repère rouvre sa note", await page.inputValue("#gp-pin-note") === "retirer ce reflet");
await page.click("#gp-pin-cancel");
check("annuler sur un repère existant le conserve", (await page.locator(".gp-pin").count()) === 1);

await page.click("#gp-pin-toggle");
await page.locator("#gp-pins").click({ position: { x: 20, y: 20 } });
await page.waitForSelector("#gp-pin-editor:not([hidden])");
check("un second repère s'ajoute en attente de note", (await page.locator(".gp-pin").count()) === 2);
await page.click("#gp-pin-cancel");
await page.waitForTimeout(400);
check("annuler un repère tout juste posé le retire, sans rien envoyer",
      (await page.locator(".gp-pin").count()) === 1 && (await photoOnWorker()).marks.length === 1);

await page.click("#gp-close");
await page.waitForTimeout(300);
check("la grille montre la pastille de couleur et le compteur de repères",
      (await page.locator(".gp-tag-dot:visible").count()) === 1 &&
      (await page.textContent(".gp-mark-badge:visible")).trim() === "1");

/* ---------- Persistance : une reconnexion complète retrouve tout ---------- */

await login();
check("code couleur et repères survivent à une reconnexion complète",
      (await page.locator(".gp-tag-dot:visible").count()) === 1 && (await page.locator(".gp-mark-badge:visible").count()) === 1);
await openFirstPhoto();
check("le repère est redessiné au même endroit après reconnexion",
      (await page.locator(".gp-pin").count()) === 1 && await page.getAttribute(".gp-tag-yellow", "aria-pressed") === "true");

/* ---------- Supprimer un repère ---------- */

await page.click(".gp-pin");
await page.waitForSelector("#gp-pin-editor:not([hidden])");
await page.click("#gp-pin-delete");
await page.waitForTimeout(600);
check("supprimer le repère le retire de la photo et du Worker",
      (await page.locator(".gp-pin").count()) === 0 && (await photoOnWorker()).marks.length === 0);

check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

/* ---------- Nettoyage ---------- */

await browser.close();
site.close();
await client.deleteGallery(slug);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
