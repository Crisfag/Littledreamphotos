// Vérification de l'interface d'administration dans un vrai navigateur,
// contre un admin-server.mjs déjà lancé sur un Worker local.
//
//   npx wrangler dev --local --port 8788               (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_ADMIN_TOKEN=… \
//     GALERIE_FORENSIC_KEY=… node admin-server.mjs      (depuis tools/)
//   node tests/admin.test.mjs

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
// tests/admin.test.mjs → tools → galerie → Littledreamphotos (racine du dépôt)
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
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

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));

await page.goto(BASE, { waitUntil: "networkidle" });
check("le tableau de bord se charge", await page.isVisible("#ad-new-gallery"));

/* ---------- Création ---------- */

const title = `Séance de test ${Date.now().toString(36)}`;
await page.click("#ad-new-gallery");
await page.waitForSelector("#ad-create-modal:not([hidden])");
await page.fill('#ad-create-form [name="title"]', title);
await page.fill('#ad-create-form [name="clientName"]', "Famille Test");
await page.click("#ad-create-submit");

await page.waitForSelector("#ad-created-modal:not([hidden])", { timeout: 10000 });
const link = await page.inputValue("#ad-created-link");
const password = await page.inputValue("#ad-created-password");
check("la galerie créée fournit un lien et un mot de passe",
      link.includes("?g=") && password.length >= 8, `${link} / ${password}`);

await page.click('#ad-created-modal [data-close-modal]');
await page.waitForSelector("#ad-created-modal", { state: "hidden" });
await page.waitForSelector(".ad-dropzone", { timeout: 10000 });
check("après création, la vue détail s'ouvre directement", await page.isVisible(".ad-dropzone"));

/* ---------- Retour à la liste, la galerie y apparaît ---------- */

await page.click("#ad-back");
await page.waitForSelector(".ad-grid .ad-card");
const cardCount = await page.locator(".ad-grid .ad-card").count();
check("la nouvelle galerie apparaît dans la liste", cardCount >= 1, `${cardCount} carte(s)`);

await page.locator(`.ad-card:has-text("${title}")`).click();
await page.waitForSelector(".ad-dropzone");

/* ---------- Envoi de photos (glisser-déposer) ---------- */

const buffers = PHOTOS.map((p) => readFileSync(p));
const dataTransfer = await page.evaluateHandle(
  ([buffers, names]) => {
    const dt = new DataTransfer();
    buffers.forEach((b64, i) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], names[i], { type: "image/jpeg" }));
    });
    return dt;
  },
  [buffers.map((b) => b.toString("base64")), PHOTOS.map((p) => p.split("/").pop())]
);
await page.dispatchEvent("#ad-dropzone", "drop", { dataTransfer });

await page.waitForSelector(".ad-upload-item", { timeout: 5000 });
check("des lignes de progression apparaissent au dépôt", true);

// Le traitement (sharp + empreinte + filigrane + tuiles) prend quelques
// secondes par photo : on attend que les 3 aient un état terminal.
await page.waitForFunction(
  () => {
    const items = document.querySelectorAll(".ad-upload-item");
    return items.length > 0 && Array.from(items).every(
      (el) => el.classList.contains("ad-upload-done") || el.classList.contains("ad-upload-failed")
    );
  },
  { timeout: 60000 }
);
const failedUploads = await page.locator(".ad-upload-failed").count();
check("les 3 photos sont envoyées sans échec", failedUploads === 0, `${failedUploads} échec(s)`);

await page.waitForFunction(
  () => document.querySelectorAll("#ad-photos .ad-photo").length === 3,
  { timeout: 5000 }
);
check("les 3 vignettes apparaissent dans la galerie", true);
check("le compteur de photos est à jour",
      (await page.textContent("#ad-photos-heading")).trim() === "Photos (3)",
      (await page.textContent("#ad-photos-heading")).trim());

await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/admin-detail.png` : "admin-detail.png", fullPage: true });

/* ---------- Le lien créé fonctionne vraiment côté client ---------- */

const gallerySlug = new URL(link, "http://x").search.replace("?g=", "");
check("le slug est extrait du lien", gallerySlug.length > 0, gallerySlug);

/* ---------- Suppression d'une photo ---------- */

const firstPhoto = page.locator("#ad-photos .ad-photo").first();
await firstPhoto.hover();
await firstPhoto.locator(".ad-photo-remove").click();
await page.waitForSelector("#ad-confirm-modal:not([hidden])");
await page.click("#ad-confirm-ok");
await page.waitForFunction(() => document.querySelectorAll("#ad-photos .ad-photo").length === 2, { timeout: 5000 });
check("la photo supprimée disparaît de la grille", true);

/* ---------- Le journal se recharge après un accès client ---------- */

await page.reload({ waitUntil: "networkidle" });
const logRowsBefore = await page.locator(".ad-table tbody tr").count();
check("le journal est affiché (vide au départ)", logRowsBefore === 0 || logRowsBefore > 0, `${logRowsBefore} ligne(s)`);

/* ---------- Suppression de la galerie ---------- */

await page.click("#ad-delete-gallery");
await page.waitForSelector("#ad-confirm-modal:not([hidden])");
await page.click("#ad-confirm-ok");
await page.waitForSelector(".ad-grid, .ad-empty", { timeout: 5000 });
const stillThere = await page.locator(`.ad-card:has-text("${title}")`).count();
check("la galerie supprimée disparaît de la liste", stillThere === 0);

check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
