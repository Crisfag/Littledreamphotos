// Aperçu client depuis l'espace photographe, dans un vrai navigateur, contre
// le Worker local et admin-server.mjs : bouton « Aperçu client », galerie
// ouverte sans mot de passe avec un bandeau, cœurs et filtres qui marchent
// dans la page sans rien enregistrer (ni sélection, ni ligne au journal),
// écritures refusées par le Worker, clé falsifiée refusée.
// SHOTS=<dossier> enregistre des captures.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/preview.test.mjs

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../lib/client.mjs";
import { processPhoto } from "../lib/pipeline.mjs";
import { createTestAccount } from "./lib/testAccount.mjs";

const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const SHOTS = process.env.SHOTS || "";
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

/* ---------- Galerie de test ---------- */

const account = await createTestAccount(API, "apercu");
const client = new WorkerClient({ api: API, ...account });
const slug = `apercu-${Date.now().toString(36)}`;
const created = await client.createGallery({ slug, title: "Test aperçu", clientName: "Famille Test", password: "mot-de-passe-apercu-test" });
for (const [position, file] of PHOTOS.entries()) {
  const { photo, tiles } = await processPhoto(await readFile(file), { galleryId: created.id, forensicKey: "cle-apercu", watermarkText: "Test", position });
  await client.addPhoto(slug, photo);
  for (const tile of tiles) await client.putTile(photo.id, tile.level, tile.col, tile.row, tile.buffer);
}

/* ---------- Le Worker : clé, session d'aperçu, écritures refusées ---------- */

const { key } = await client.request("POST", `/api/admin/galleries/${slug}/preview`, {});
check("l'espace photographe obtient une clé d'aperçu", typeof key === "string" && key.length > 20);
const open = await fetch(`${API}/api/gallery/${slug}/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ preview: key }) });
const session = await open.json();
check("la clé ouvre la galerie sans mot de passe, marquée « aperçu »", open.ok && session.gallery.preview === true && session.photos.length === 2);
const auth = { "content-type": "application/json", authorization: `Bearer ${session.token}` };
const select = await fetch(`${API}/api/gallery/${slug}/select`, { method: "POST", headers: auth, body: JSON.stringify({ photoId: session.photos[0].id, selected: true }) });
const event = await fetch(`${API}/api/gallery/${slug}/event`, { method: "POST", headers: auth, body: JSON.stringify({ type: "capture", reason: "impr-ecran" }) });
check("une session d'aperçu ne peut rien écrire (sélection, journal)", select.status === 403 && event.status === 403, `${select.status}, ${event.status}`);
const tile = await fetch(`${API}/api/gallery/${slug}/tile/${session.photos[0].id}/0/0/0`, { headers: { authorization: auth.authorization } });
check("…mais voit les photos (tuiles)", tile.ok, tile.status);
const real = await (await fetch(`${API}/api/gallery/${slug}/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "mot-de-passe-apercu-test" }) })).json();
const forged = await fetch(`${API}/api/gallery/${slug}/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ preview: real.token }) });
const garbage = await fetch(`${API}/api/gallery/${slug}/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ preview: "n-importe-quoi" }) });
check("un jeton client ou une clé inventée n'ouvrent pas l'aperçu", forged.status === 401 && garbage.status === 401, `${forged.status}, ${garbage.status}`);
const realGallery = await (await fetch(`${API}/api/gallery/${slug}/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "mot-de-passe-apercu-test" }) })).json();
check("une vraie connexion client n'est jamais marquée « aperçu »", realGallery.gallery.preview === false);
const logins = async () => (await client.request("GET", `/api/admin/galleries/${slug}/log`)).log.filter((e) => e.event === "login").length;
const logBefore = await logins();

/* ---------- Page client statique ---------- */

const TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8" };
const site = createServer(async (req, res) => {
  const pathname = req.url.split("?")[0] === "/" ? "/galerie.html" : req.url.split("?")[0];
  try {
    let body = await readFile(join(WEB_DIR, pathname));
    const ext = pathname.split(".").pop();
    if (ext === "html") body = body.toString().replace(/api: "[^"]*"/, `api: "${API}"`);
    res.writeHead(200, { "content-type": TYPES[ext] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
const SITE_PORT = Number(process.env.SITE_PORT || 8000);
await new Promise((resolve, reject) => { site.once("error", reject); site.listen(SITE_PORT, "localhost", resolve); });
const siteBase = `http://localhost:${SITE_PORT}`;

const browser = await chromium.launch({ ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}), args: ["--disable-features=LocalNetworkAccessChecks"] });
const exceptions = [];

/* ---------- Bouton « Aperçu client » dans l'espace photographe ---------- */

const admin = await browser.newPage({ viewport: { width: 1280, height: 900 } });
admin.on("pageerror", (err) => exceptions.push(String(err)));
await admin.goto(BASE, { waitUntil: "domcontentloaded" });
await admin.waitForSelector("#ad-login-form", { timeout: 10000 });
await admin.fill('#ad-login-form [name="email"]', account.email);
await admin.fill('#ad-login-form [name="password"]', account.password);
await admin.click("#ad-login-submit");
await admin.waitForSelector("#ad-new-gallery", { timeout: 10000 });
await admin.goto(`${BASE}/#/g/${slug}`, { waitUntil: "domcontentloaded" });
await admin.waitForSelector("#ad-preview", { timeout: 10000 });
const [popup] = await Promise.all([admin.context().waitForEvent("page"), admin.click("#ad-preview")]);
await popup.waitForURL(/apercu=/, { timeout: 10000 });
check("« Aperçu client » ouvre un onglet sur le lien du client, clé après le #", new RegExp(`\\?g=${slug}#apercu=.+`).test(popup.url()), popup.url().slice(0, 80) + "…");
const previewKey = decodeURIComponent(popup.url().split("#apercu=")[1]);
await popup.close();

/* ---------- La page client en aperçu ---------- */

const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on("pageerror", (err) => exceptions.push(String(err)));
await page.goto(`${siteBase}/galerie.html?g=${slug}#apercu=${encodeURIComponent(previewKey)}`, { waitUntil: "networkidle" });
await page.waitForSelector("#gp-gallery:not([hidden])", { timeout: 10000 });
check("la galerie s'ouvre directement, sans écran de mot de passe", await page.isHidden("#gp-login"));
check("bandeau « Aperçu » affiché", await page.isVisible("#gp-preview-banner") && (await page.textContent("#gp-preview-banner")).includes("ne sont pas enregistrés"));
check("la clé est retirée de l'adresse", !page.url().includes("#apercu="), page.url());
await page.waitForTimeout(800);
await page.locator(".gp-item .gp-heart").first().click();
await page.waitForTimeout(300);
check("un cœur s'allume dans la page", await page.locator(".gp-item .gp-heart-active").count() === 1);
await page.click('#gp-filters [data-filter="selected"]');
await page.waitForTimeout(200);
check("le filtre « Mes favoris » fonctionne en aperçu", await page.locator(".gp-item:visible").count() === 1);
if (SHOTS) await page.screenshot({ path: join(SHOTS, "01-apercu.png") });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
if (SHOTS) await page.screenshot({ path: join(SHOTS, "02-apercu-mobile.png") });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("sur téléphone, bandeau et filtres tiennent dans la largeur", overflow <= 1, overflow);

const detail = await client.getGallery(slug);
check("rien n'a été enregistré : aucune photo sélectionnée côté serveur", detail.photos.every((p) => !Number(p.selected)));
check("aucune connexion d'aperçu au journal du client", await logins() === logBefore, `${logBefore} connexion(s) client`);
check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));

/* ---------- Nettoyage ---------- */

await browser.close();
site.close();
await client.deleteGallery(slug).catch(() => {});

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
