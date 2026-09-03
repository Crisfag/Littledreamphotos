// Vérification de la sélection client (coup de cœur) dans un vrai navigateur,
// contre le vrai Worker local. Autonome : crée sa propre galerie, sert la
// page cliente, nettoie derrière elle.
//
//   npx wrangler dev --local --port 8788   (depuis worker/)
//   node tests/selection.test.mjs          (depuis tools/)

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../lib/client.mjs";
import { processPhoto } from "../lib/pipeline.mjs";

const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const ADMIN_TOKEN = process.env.GALERIE_ADMIN_TOKEN || "jeton-admin-de-test";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_DIR = join(REPO_ROOT, "galerie", "web");
const PHOTOS = [
  join(REPO_ROOT, "images", "famille", "famille-01.jpeg"),
  join(REPO_ROOT, "images", "famille", "famille-02.jpeg"),
  join(REPO_ROOT, "images", "maternite", "maternite-01.jpeg"),
];

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

/* ---------- Galerie de test, créée pour de vrai sur le Worker local ---------- */

const client = new WorkerClient({ api: API, adminToken: ADMIN_TOKEN });
const slug = `select-${Date.now().toString(36)}`;
const forensicKey = "cle-de-test-selection";

const created = await client.createGallery({
  slug,
  title: "Test sélection automatisé",
  clientName: "Suite de tests",
  password: "mot-de-passe-select-test",
});

for (const [position, file] of PHOTOS.entries()) {
  const input = await readFile(file);
  const { photo, tiles } = await processPhoto(input, {
    galleryId: created.id,
    forensicKey,
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
    if (ext === "html") {
      body = body.toString().replace(/api: "[^"]*"/, `api: "${API}"`);
    }
    res.writeHead(200, { "content-type": STATIC_TYPES[ext] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
// Port fixe et hôte « localhost » : c'est l'origine que wrangler.toml
// (ALLOWED_ORIGINS) autorise pour le développement local — un port choisi au
// hasard se ferait bloquer par le CORS du Worker.
const SITE_PORT = Number(process.env.SITE_PORT || 8000);
await new Promise((resolve, reject) => {
  site.once("error", reject);
  site.listen(SITE_PORT, "localhost", resolve);
});
const siteBase = `http://localhost:${SITE_PORT}`;

/* ---------- Navigateur ---------- */

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));

async function login() {
  await page.goto(`${siteBase}/galerie.html?g=${slug}`, { waitUntil: "networkidle" });
  await page.fill("#gp-password", "mot-de-passe-select-test");
  await page.click("#gp-submit");
  await page.waitForSelector("#gp-gallery:not([hidden])", { timeout: 10000 });
  await page.waitForTimeout(1200);
}

await login();
check("la barre de sélection est visible", await page.isVisible("#gp-toolbar"));
check("rien n'est sélectionné au départ",
      (await page.textContent("#gp-selection-count")).trim() === "Aucune photo sélectionnée pour l'instant");
check("3 cœurs affichés dans la grille", await page.locator(".gp-item .gp-heart").count() === 3);

const hearts = page.locator(".gp-item .gp-heart");
await hearts.nth(0).click();
await hearts.nth(2).click();
await page.waitForTimeout(400);
check("2 cœurs actifs après clic dans la grille", await page.locator(".gp-item .gp-heart-active").count() === 2);
check("le compteur reflète 2 sélections",
      (await page.textContent("#gp-selection-count")).trim() === "2 photos sélectionnées");

// Sélection depuis la visionneuse, sur la photo restante.
await page.locator(".gp-open").nth(1).click();
await page.waitForSelector("#gp-viewer:not([hidden])");
await page.waitForTimeout(1000);
check("le cœur de la visionneuse reflète l'état non sélectionné",
      !(await page.locator("#gp-viewer-heart").evaluate((el) => el.classList.contains("gp-heart-active"))));
await page.click("#gp-viewer-heart");
await page.waitForTimeout(400);
check("le cœur de la visionneuse devient actif au clic",
      await page.locator("#gp-viewer-heart").evaluate((el) => el.classList.contains("gp-heart-active")));
await page.click("#gp-close");
check("3 cœurs actifs dans la grille après sélection via la visionneuse",
      await page.locator(".gp-item .gp-heart-active").count() === 3);

// Filtre « ma sélection » : masque sans retélécharger, et borne la navigation.
await hearts.nth(1).click(); // désélectionne une des trois pour avoir un cas 2/3 significatif
await page.waitForTimeout(300);
await page.check("#gp-filter-selected");
await page.waitForTimeout(200);
check("le filtre ne montre que les photos sélectionnées",
      await page.locator(".gp-item:visible").count() === 2);
await page.locator(".gp-item:visible .gp-open").first().click();
await page.waitForSelector("#gp-viewer:not([hidden])");
check("la visionneuse filtrée ne compte que les sélectionnées",
      (await page.textContent("#gp-counter")).trim().endsWith("/ 2"),
      await page.textContent("#gp-counter"));
await page.click("#gp-close");
await page.uncheck("#gp-filter-selected");

/* ---------- Persistance : une reconnexion complète retrouve la sélection ---------- */

await login();
check("la sélection survit à une reconnexion complète",
      await page.locator(".gp-item .gp-heart-active").count() === 2);

/* ---------- Le Worker a bien la même vérité que l'écran ---------- */

const detail = await client.getGallery(slug);
const selectedOnServer = detail.photos.filter((p) => Number(p.selected) === 1);
check("le Worker enregistre les mêmes 2 sélections", selectedOnServer.length === 2,
      selectedOnServer.map((p) => p.id).join(", "));
check("selected_at est renseigné pour chaque photo sélectionnée",
      selectedOnServer.every((p) => Number.isInteger(p.selected_at)));

const { galleries } = await client.listGalleries();
const row = galleries.find((g) => g.slug === slug);
check("le compteur de sélection de la liste des galeries est à jour",
      row?.selected_count === 2, JSON.stringify(row));

check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

/* ---------- Nettoyage ---------- */

await browser.close();
site.close();
await client.deleteGallery(slug);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
