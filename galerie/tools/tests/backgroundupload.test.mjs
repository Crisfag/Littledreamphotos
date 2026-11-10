// Envois de photos en arrière-plan, dans un vrai navigateur : on lance un
// envoi dans une galerie, on part travailler dans une autre (où l'on envoie
// aussi), on revient — les envois continuent, un panneau les suit partout,
// la fiche retrouve ses lignes en cours, et fermer la page pendant un envoi
// est signalé.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/backgroundupload.test.mjs

import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../lib/client.mjs";
import { createTestAccount } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PHOTOS = ["famille-01.jpeg", "famille-02.jpeg", "famille-03.jpeg", "famille-04.jpeg"].map((n) => join(REPO_ROOT, "images", "famille", n));
const SHOTS = process.env.SCREENSHOT_DIR || "";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const account = await createTestAccount(API, "envois-fond");
const client = new WorkerClient({ api: API, ...account });
const RUN = Date.now().toString(36);
const slugA = `noel-a-${RUN}`;
const slugB = `noel-b-${RUN}`;
await client.createGallery({ slug: slugA, title: "Noël famille Dupont", password: "mot-de-passe-a" });
await client.createGallery({ slug: slugB, title: "Noël famille Martin", password: "mot-de-passe-b" });

const browser = await chromium.launch({ ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
// Envois ralentis (connexion lente) : le temps de changer d'écran.
await page.route(`**/local/galleries/${slugA}/photos`, async (route) => {
  await new Promise((r) => setTimeout(r, 1500));
  await route.continue();
});
const count = async (slug) => (await client.getGallery(slug)).photos.length;

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.fill('#ad-login-form [name="email"]', account.email);
  await page.fill('#ad-login-form [name="password"]', account.password);
  await page.click("#ad-login-submit");
  await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });

  await page.goto(`${BASE}/#/g/${slugA}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-file-input", { state: "attached", timeout: 10000 });
  await page.setInputFiles("#ad-file-input", PHOTOS);
  await page.waitForSelector(".ad-upload-item", { timeout: 5000 });
  check("galerie A : 4 lignes d'envoi", (await page.locator(".ad-upload-item").count()) === 4);
  check("sur la fiche de la galerie, pas de panneau en double", !(await page.isVisible("#ad-uploads-panel")));

  // On part sur la galerie B pendant l'envoi.
  await page.goto(`${BASE}/#/g/${slugB}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-file-input", { state: "attached", timeout: 10000 });
  await page.waitForSelector("#ad-uploads-panel:not([hidden])", { timeout: 5000 });
  const panel = await page.innerText("#ad-uploads-panel");
  check("ailleurs : le panneau suit l'envoi de la galerie A", /Noël famille Dupont/.test(panel) && /en cours/.test(panel), panel.replace(/\n/g, " | "));
  if (SHOTS) await page.locator("#ad-uploads-panel").screenshot({ path: join(SHOTS, "envois-panneau.png") });
  check("pendant ce temps, la galerie B se travaille : on y envoie une photo", true);
  await page.setInputFiles("#ad-file-input", [PHOTOS[0]]);
  await page.waitForFunction(() => document.querySelectorAll("#ad-photos .ad-photo").length === 1, null, { timeout: 60000 });
  check("galerie B : sa photo arrive et s'affiche", (await count(slugB)) === 1);
  const midway = await count(slugA);
  check("galerie A : l'envoi continue en arrière-plan", midway < 4, `${midway} / 4 à ce moment`);

  const beforeUnload = await page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  check("fermer ou recharger la page pendant un envoi : le navigateur demande confirmation", beforeUnload);

  // Retour sur la galerie A, envoi pas fini : ses lignes réapparaissent.
  await page.click(`#ad-uploads-panel a[href="#/g/${slugA}"]`);
  await page.waitForSelector(`#ad-upload-queue[data-slug="${slugA}"]`, { timeout: 10000 });
  const rows = await page.locator("#ad-upload-queue .ad-upload-item").count();
  check("retour sur la galerie A : les lignes en cours sont toujours là", rows > 0, `${rows} ligne(s)`);
  await page.waitForFunction(() => document.querySelectorAll("#ad-photos .ad-photo").length === 4, null, { timeout: 90000 });
  check("galerie A : les 4 photos arrivent, vignettes comprises, sans doublon", (await count(slugA)) === 4 && (await page.locator("#ad-photos .ad-photo").count()) === 4);
  check("le compteur de photos suit", (await page.textContent("#ad-photos-heading")).trim() === "Photos (4)");

  // Envoi suivi depuis la liste des galeries jusqu'au bout.
  await page.goto(`${BASE}/#/g/${slugB}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-file-input", { state: "attached", timeout: 10000 });
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver(() => window.__toasts.push(document.getElementById("ad-toast").textContent)).observe(document.getElementById("ad-toast"), { childList: true, characterData: true, subtree: true });
  });
  await page.setInputFiles("#ad-file-input", PHOTOS.slice(1, 3));
  await page.click("#ad-tab-galleries");
  await page.waitForSelector("#ad-uploads-panel:not([hidden])", { timeout: 5000 });
  await page.waitForFunction(() => /2 photo\(s\) envoyée\(s\)/.test(window.__toasts.join(" ")), null, { timeout: 60000 });
  const toast = (await page.evaluate(() => window.__toasts)).join(" || ");
  check("depuis la liste des galeries : fin de l'envoi annoncée avec le nom de la galerie", /Noël famille Martin/.test(toast), toast);
  await page.waitForFunction(() => document.getElementById("ad-uploads-panel").hidden, null, { timeout: 10000 });
  check("le panneau disparaît une fois tout envoyé", (await count(slugB)) === 3);
  const idle = await page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  check("plus rien en cours : la page se ferme sans question", !idle);

  await page.setViewportSize({ width: 390, height: 844 });
  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} finally {
  await browser.close();
  await client.deleteGallery(slugA).catch(() => {});
  await client.deleteGallery(slugB).catch(() => {});
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
