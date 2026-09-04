// Vérification des commentaires client (une remarque laissée sur une photo)
// dans un vrai navigateur, contre le vrai Worker local. Autonome : crée sa
// propre galerie, sert la page cliente, nettoie derrière elle.
//
//   npx wrangler dev --local --port 8788   (depuis worker/)
//   node tests/comments.test.mjs           (depuis tools/)

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
const slug = `comment-${Date.now().toString(36)}`;
const forensicKey = "cle-de-test-commentaires";

const created = await client.createGallery({
  slug,
  title: "Test commentaires automatisé",
  clientName: "Suite de tests",
  password: "mot-de-passe-comment-test",
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
// Même origine que wrangler.toml (ALLOWED_ORIGINS) autorise pour le
// développement local — voir selection.test.mjs pour l'explication complète.
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
  await page.fill("#gp-password", "mot-de-passe-comment-test");
  await page.click("#gp-submit");
  await page.waitForSelector("#gp-gallery:not([hidden])", { timeout: 10000 });
  await page.waitForTimeout(1200);
}

await login();
check("aucune pastille de commentaire au départ", await page.locator(".gp-comment-badge:visible").count() === 0);

/* ---------- Laisser un commentaire depuis la visionneuse ---------- */

await page.locator(".gp-open").first().click();
await page.waitForSelector("#gp-viewer:not([hidden])");
await page.waitForTimeout(800);

check("le panneau de commentaire est fermé par défaut", await page.isHidden("#gp-comment-panel"));
await page.click("#gp-comment-toggle");
check("le panneau s'ouvre au clic", await page.isVisible("#gp-comment-panel"));
check("le champ de saisie reçoit le focus", await page.evaluate(() => document.activeElement.id === "gp-comment-input"));

await page.fill("#gp-comment-input", "en noir et blanc svp");
// Ne pas attendre le débounce : on change tout de suite de photo pour
// vérifier que le commentaire en cours de frappe est bien sauvegardé quand
// même (flushPendingComment), pas perdu.
await page.click("#gp-next");
await page.waitForTimeout(600);

const detailAfterFlush = await client.getGallery(slug);
const firstPhotoAfterFlush = detailAfterFlush.photos[0];
check("un commentaire tapé juste avant de changer de photo n'est pas perdu",
      firstPhotoAfterFlush.comment === "en noir et blanc svp", JSON.stringify(firstPhotoAfterFlush.comment));

/* ---------- Le panneau reste ouvert d'une photo à l'autre, contenu à jour ---------- */

check("le panneau reste ouvert en changeant de photo", await page.isVisible("#gp-comment-panel"));
check("le champ se vide pour une photo sans commentaire", await page.inputValue("#gp-comment-input") === "");

await page.fill("#gp-comment-input", "peut-on la recadrer un peu ?");
await page.waitForTimeout(1000); // laisse le débounce (700 ms) déclencher la sauvegarde
check("le statut affiche la confirmation d'enregistrement",
      (await page.textContent("#gp-comment-status")).trim() === "Enregistré");

await page.click("#gp-close");

/* ---------- Les pastilles apparaissent dans la grille ---------- */

await page.waitForTimeout(300);
check("2 pastilles de commentaire dans la grille", await page.locator(".gp-comment-badge:visible").count() === 2);

/* ---------- Persistance : une reconnexion complète retrouve les commentaires ---------- */

await login();
check("les commentaires survivent à une reconnexion complète",
      await page.locator(".gp-comment-badge:visible").count() === 2);

/* ---------- Effacer un commentaire ---------- */

await page.locator(".gp-open").first().click();
await page.waitForSelector("#gp-viewer:not([hidden])");
await page.waitForTimeout(600);
await page.click("#gp-comment-toggle");
await page.fill("#gp-comment-input", "");
await page.waitForTimeout(1000);
await page.click("#gp-close");
await page.waitForTimeout(300);
check("effacer le texte retire la pastille de la grille",
      await page.locator(".gp-comment-badge:visible").count() === 1);

/* ---------- Le Worker a bien la même vérité que l'écran ---------- */

const detail = await client.getGallery(slug);
const commented = detail.photos.filter((p) => p.comment);
check("le Worker garde exactement 1 commentaire", commented.length === 1,
      commented.map((p) => p.comment).join(" | "));
check("comment_at est renseigné pour la photo commentée",
      Number.isInteger(commented[0]?.comment_at));
check("comment_at est effacé pour la photo dont le commentaire a été retiré",
      detail.photos.find((p) => p.id === detailAfterFlush.photos[0].id)?.comment_at == null);

const { galleries } = await client.listGalleries();
const row = galleries.find((g) => g.slug === slug);
check("le compteur de commentaires de la liste des galeries est à jour",
      row?.comment_count === 1, JSON.stringify(row));

check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

/* ---------- Nettoyage ---------- */

await browser.close();
site.close();
await client.deleteGallery(slug);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
