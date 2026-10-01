// Vérification du sous-domaine par studio dans un vrai navigateur : la page
// de galerie servie à « <studio>.holypixx.com », l'API appelée sur cette
// même origine, le nom du studio affiché au client. Autonome : crée son
// compte et sa galerie, nettoie derrière lui.
//
// Le navigateur ne peut pas résoudre *.holypixx.com vers le Worker local :
// Playwright intercepte donc ces requêtes et les rejoue sur le Worker local
// avec l'en-tête Host du studio — exactement ce que le Worker recevra en
// production derrière la route « *.holypixx.com/* ».
//
//   npx wrangler dev --local --port 8788   (depuis worker/, avec
//                                           PUBLIC_SITE_ORIGIN=http://localhost:8000 dans .dev.vars)
//   node tests/subdomain.test.mjs          (depuis tools/)

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../lib/client.mjs";
import { processPhoto } from "../lib/pipeline.mjs";
import { createTestAccount } from "./lib/testAccount.mjs";
import { hostFetch } from "./lib/hostFetch.mjs";

const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_DIR = join(REPO_ROOT, "galerie", "web");
const PHOTO = join(REPO_ROOT, "images", "famille", "famille-01.jpeg");

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

/* ---------- Compte, sous-domaine et galerie, créés pour de vrai ---------- */

const account = await createTestAccount(API, "studio");
const client = new WorkerClient({ api: API, ...account });
await client.setStudioName?.("Studio Lumière");
const SUB = `lumiere-${Date.now().toString(36)}`;
await client.setSubdomain(SUB);
const slug = `sous-domaine-${Date.now().toString(36)}`;
const PASSWORD = "mot-de-passe-studio-test";
const created = await client.createGallery({ slug, title: "Test sous-domaine", clientName: "Suite de tests", password: PASSWORD });
{
  const input = await readFile(PHOTO);
  const { photo, tiles } = await processPhoto(input, { galleryId: created.id, forensicKey: "cle-de-test-studio", watermarkText: "Test", position: 0 });
  await client.addPhoto(slug, photo);
  for (const tile of tiles) await client.putTile(photo.id, tile.level, tile.col, tile.row, tile.buffer);
}

/* ---------- Site principal local : ce que le Worker relit (PUBLIC_SITE_ORIGIN) ---------- */

const STATIC_TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8" };
const site = createServer(async (req, res) => {
  const pathname = req.url.split("?")[0] === "/" ? "/galerie.html" : req.url.split("?")[0];
  try {
    const body = await readFile(join(WEB_DIR, pathname));
    res.writeHead(200, { "content-type": STATIC_TYPES[pathname.split(".").pop()] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve, reject) => {
  site.once("error", reject);
  site.listen(Number(process.env.SITE_PORT || 8000), "localhost", resolve);
});

/* ---------- Navigateur, avec « *.holypixx.com » rejoué sur le Worker local ---------- */

const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ["--disable-features=LocalNetworkAccessChecks"],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));

// Chromium force le https sur ce domaine : on navigue donc en https, comme
// en production. L'origine d'API inscrite dans la page est sans schéma
// (« //<studio>.holypixx.com »), elle suit celui de la page.
const STUDIO_HOST = `${SUB}.holypixx.com`;
const STUDIO_ORIGIN = `https://${STUDIO_HOST}`;
const seenOnStudio = [];
await page.route((url) => url.hostname === STUDIO_HOST, async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  seenOnStudio.push(url.pathname);
  const headers = { ...request.headers(), host: STUDIO_HOST };
  delete headers["content-length"];
  const upstream = await hostFetch(`${API}${url.pathname}${url.search}`, {
    method: request.method(),
    headers,
    body: ["GET", "HEAD"].includes(request.method()) ? undefined : request.postDataBuffer(),
  });
  const body = Buffer.from(await upstream.arrayBuffer());
  const responseHeaders = {};
  upstream.headers.forEach((value, key) => {
    if (!["content-encoding", "content-length", "transfer-encoding"].includes(key)) responseHeaders[key] = value;
  });
  await route.fulfill({ status: upstream.status, headers: responseHeaders, body });
});

await page.goto(`${STUDIO_ORIGIN}/?g=${slug}`, { waitUntil: "networkidle" });
check("la page de galerie s'affiche à l'adresse du studio", await page.isVisible("#gp-login"));
check("l'adresse d'API inscrite dans la page est l'hôte du studio, sans schéma (même origine, jamais de contenu mixte)",
      await page.evaluate(() => window.GALERIE_CONFIG.api) === `//${STUDIO_HOST}`,
      await page.evaluate(() => window.GALERIE_CONFIG.api));
check("feuille de style et script sont servis par la même adresse",
      seenOnStudio.includes("/gallery.css") && seenOnStudio.includes("/gallery.js"), seenOnStudio.join(" "));

await page.fill("#gp-password", PASSWORD);
await page.click("#gp-submit");
await page.waitForSelector("#gp-gallery:not([hidden])", { timeout: 10000 });
await page.waitForTimeout(1200);
check("la connexion passe par l'API du studio, jamais par une autre origine",
      seenOnStudio.includes(`/api/gallery/${slug}/login`) && seenOnStudio.some((p) => p.includes("/tile/")));
check("la galerie s'ouvre et les tuiles se chargent",
      (await page.locator(".gp-item canvas").count()) === 1);
check("le nom du studio remplace la marque de la plateforme en tête de galerie",
      (await page.textContent("#gp-gallery .gp-eyebrow")).trim() === "Studio Lumière",
      await page.textContent("#gp-gallery .gp-eyebrow"));

/* ---------- Une galerie d'un autre studio n'existe pas ici ---------- */

const other = await createTestAccount(API, "autre-studio");
const otherClient = new WorkerClient({ api: API, ...other });
const otherSlug = `autre-${Date.now().toString(36)}`;
await otherClient.createGallery({ slug: otherSlug, title: "Galerie d'un autre studio", password: PASSWORD });
// « domcontentloaded » plutôt que « networkidle » : la page précédente
// garde des requêtes en vol (journal, tuiles) qui retardent le signal.
await page.goto(`${STUDIO_ORIGIN}/?g=${otherSlug}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#gp-login:not([hidden])", { timeout: 10000 });
await page.fill("#gp-password", PASSWORD);
await page.click("#gp-submit");
await page.waitForSelector("#gp-error:not([hidden])", { timeout: 10000 });
check("sous l'adresse d'un studio, la galerie d'un autre studio reste introuvable",
      await page.isHidden("#gp-gallery") && (await page.textContent("#gp-error")).length > 0,
      await page.textContent("#gp-error"));

check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

/* ---------- Nettoyage ---------- */

await browser.close();
site.close();
await client.deleteGallery(slug);
await otherClient.deleteGallery(otherSlug);
await client.setSubdomain("");

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
