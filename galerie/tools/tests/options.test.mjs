// Options payantes et relance des impayés, dans un vrai navigateur :
// le photographe crée ses options (Paramètres, à partir des idées), sa
// cliente les coche dans sa galerie (quantité, total), demande à payer par
// virement ; le photographe voit tout dans la fiche et la Facturation,
// relance, marque reçu — les options passent en réglées chez la cliente.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/options.test.mjs

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../lib/client.mjs";
import { processPhoto } from "../lib/pipeline.mjs";
import { createTestAccount, localSql } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_DIR = join(REPO_ROOT, "galerie", "web");
const SITE_PORT = Number(process.env.SITE_PORT || 8000);
const SHOTS = process.env.SCREENSHOT_DIR || "";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const account = await createTestAccount(API, "options");
const client = new WorkerClient({ api: API, ...account });
const slug = `options-${Date.now().toString(36)}`;
const PASSWORD = "mot-de-passe-options";
const created = await client.createGallery({ slug, title: "Noël famille Martin", clientName: "Léa", clientEmail: "lea@client.invalid", password: PASSWORD });
for (const [position, name] of ["famille-01.jpeg", "famille-02.jpeg", "famille-03.jpeg", "famille-04.jpeg"].entries()) {
  const { photo, tiles } = await processPhoto(await readFile(join(REPO_ROOT, "images", "famille", name)), { galleryId: created.id, forensicKey: "cle-options", watermarkText: "Test", position });
  await client.addPhoto(slug, photo);
  for (const tile of tiles) await client.putTile(photo.id, tile.level, tile.col, tile.row, tile.buffer);
}
await client.setQuota(slug, 2, 15);
await localSql(API, `UPDATE photos SET selected = 1 WHERE gallery_id = '${created.id}'`);
await localSql(API, `UPDATE photographers SET offline_transfer = 1, billing_iban = 'BE68 5390 0754 7034' WHERE email = '${account.email}'`);

const TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8" };
const site = createServer(async (req, res) => {
  const pathname = req.url.split("?")[0];
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
await new Promise((resolve, reject) => { site.once("error", reject); site.listen(SITE_PORT, "localhost", resolve); });

const browser = await chromium.launch({ ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}), args: ["--disable-features=LocalNetworkAccessChecks"] });
const exceptions = [];
const admin = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const gallery = await browser.newPage({ viewport: { width: 1200, height: 900 } });
for (const p of [admin, gallery]) {
  p.on("pageerror", (err) => exceptions.push(String(err)));
  p.on("dialog", (d) => d.accept());
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
}
const toastHas = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector(".ad-toast")?.textContent || ""), re.source, { timeout: 15000 });

try {
  /* ---------- Le photographe crée ses options ---------- */

  await admin.goto(BASE, { waitUntil: "domcontentloaded" });
  await admin.fill('#ad-login-form [name="email"]', account.email);
  await admin.fill('#ad-login-form [name="password"]', account.password);
  await admin.click("#ad-login-submit");
  await admin.waitForSelector("#ad-new-gallery", { timeout: 10000 });
  await admin.goto(`${BASE}/#/parametres`, { waitUntil: "domcontentloaded" });
  await admin.waitForSelector("#ad-options-catalog .ad-options-empty", { timeout: 10000 });
  check("Paramètres : aucune option, des idées proposées", (await admin.locator("[data-option-idea]").count()) === 5);
  await admin.click('[data-option-idea="0"]');
  check("une idée remplit le formulaire (Retouche avancée, 15 €, à l'unité)",
        (await admin.inputValue('#ad-option-form [name="label"]')) === "Retouche avancée" && (await admin.inputValue('#ad-option-form [name="price"]')) === "15" &&
        await admin.isChecked('#ad-option-form [name="perUnit"]'));
  await admin.click("#ad-option-save");
  await admin.waitForFunction(() => document.querySelectorAll(".ad-options-catalog li").length === 1, null, { timeout: 10000 });
  await admin.click('[data-option-idea="1"]');
  await admin.click("#ad-option-save");
  await admin.waitForFunction(() => document.querySelectorAll(".ad-options-catalog li").length === 2, null, { timeout: 10000 });
  await admin.locator(".ad-options-catalog li", { hasText: "Livraison express" }).locator("[data-option-edit]").click();
  await admin.fill('#ad-option-form [name="price"]', "25");
  await admin.click("#ad-option-save");
  await admin.waitForFunction(() => /25,00 €/.test(document.querySelector(".ad-options-catalog")?.textContent || ""), null, { timeout: 10000 });
  check("deux options au catalogue, prix modifié (express à 25 €)", (await admin.locator(".ad-options-catalog li").count()) === 2);
  if (SHOTS) await admin.locator("#ad-options-section").screenshot({ path: join(SHOTS, "options-parametres.png") });

  await admin.uncheck("#ad-unpaid-reminders-toggle");
  await toastHas(admin, /Relance des suppléments non réglés désactivée/);
  let me = await client.request("GET", "/api/auth/me");
  check("relance des impayés : se désactive…", me.photographer.unpaidRemindersEnabled === false);
  await admin.check("#ad-unpaid-reminders-toggle");
  await toastHas(admin, /activée/);
  me = await client.request("GET", "/api/auth/me");
  check("…et se réactive", me.photographer.unpaidRemindersEnabled === true);

  /* ---------- La cliente coche ---------- */

  await gallery.goto(`http://localhost:${SITE_PORT}/galerie.html?g=${slug}`, { waitUntil: "domcontentloaded" });
  await gallery.fill("#gp-password", PASSWORD);
  await gallery.click("#gp-submit");
  await gallery.waitForSelector("#gp-gallery:not([hidden])", { timeout: 15000 });
  await gallery.waitForSelector("#gp-options-bar:not([hidden])", { timeout: 5000 });
  check("galerie : bouton « Ajouter des options »", (await gallery.textContent("#gp-options-open")).trim() === "Ajouter des options");
  await gallery.click("#gp-options-open");
  await gallery.waitForSelector("#gp-options:not([hidden])");
  check("la fenêtre liste les 2 options avec leur prix", (await gallery.locator(".gp-option").count()) === 2 &&
        /\+15,00 € \/ unité/.test(await gallery.textContent("#gp-options-list")) && /\+25,00 €/.test(await gallery.textContent("#gp-options-list")));
  await gallery.locator(".gp-option", { hasText: "Retouche avancée" }).locator("input").check();
  await gallery.waitForSelector(".gp-option-qty", { timeout: 10000 });
  await gallery.locator('.gp-option-qty button[aria-label="Une de plus"]').click();
  await gallery.waitForFunction(() => document.querySelector(".gp-option-qty output")?.textContent === "2", null, { timeout: 10000 });
  check("retouche à l'unité : quantité 2, sous-total 30 €", /= 30,00 €/.test(await gallery.textContent(".gp-option-qty")));
  await gallery.locator(".gp-option", { hasText: "Livraison express" }).locator("input").check();
  await gallery.waitForFunction(() => /55,00 €/.test(document.getElementById("gp-options-total").textContent), null, { timeout: 10000 });
  check("total des options : 55 €", true);
  if (SHOTS) await gallery.locator(".gp-options-card").screenshot({ path: join(SHOTS, "options-galerie.png") });
  await gallery.keyboard.press("Escape");
  check("Échap ferme la fenêtre ; la barre résume « 2 choisies · 55,00 € »",
        await gallery.isHidden("#gp-options") && /2 choisies · 55,00 €/.test(await gallery.textContent("#gp-options-open")));
  let detail = await client.getGallery(slug);
  check("côté serveur : 30 € de suppléments + 55 € d'options = 85 €", detail.gallery.due_total_cents === 8500 && detail.gallery.due_options_cents === 5500);

  await gallery.click("#gp-pay-transfer");
  await gallery.waitForSelector("#gp-offline-pending:not([hidden])", { timeout: 10000 });
  check("« Payer par virement » : demande de 85 €", /85,00 €/.test(await gallery.textContent("#gp-offline-pending")));

  /* ---------- Le photographe ---------- */

  await admin.goto(`${BASE}/#/facturation`, { waitUntil: "domcontentloaded" });
  await admin.waitForSelector(".ad-due-table", { timeout: 15000 });
  const row = (await admin.locator(".ad-due-table tbody tr", { hasText: "Noël famille Martin" }).innerText()).replace(/\s+/g, " ");
  check("Facturation : 85 €, détail photos + 2 options, demande de virement", /85,00 €/.test(row) && /\+ 2 options \(55,00 €\)/.test(row) && /A demandé à payer par virement/.test(row), row);
  await admin.click(`[data-remind="${slug}"]`);
  await toastHas(admin, /Rappel envoyé à lea@client\.invalid/);
  await admin.waitForFunction(() => /Relancé le/.test(document.querySelector(".ad-due-table")?.textContent || ""), null, { timeout: 10000 });
  check("« Relancer maintenant » : rappel parti, « Relancé le … » affiché", true);
  if (SHOTS) await admin.locator("#ad-due").screenshot({ path: join(SHOTS, "options-facturation.png") });

  await admin.goto(`${BASE}/#/g/${slug}`, { waitUntil: "domcontentloaded" });
  await admin.waitForSelector(".ad-options-chosen", { timeout: 10000 });
  const chosen = (await admin.innerText(".ad-options-chosen")).replace(/\s+/g, " ");
  check("fiche galerie : options cochées, « À régler »", /Retouche avancée × 2/.test(chosen) && /Livraison express 48 h/.test(chosen) && (chosen.match(/À régler/g) || []).length === 2, chosen);
  check("historique : la demande couvre « 2 photos + Retouche avancée × 2 + Livraison express 48 h »",
        /2 photos \+ Retouche avancée × 2 \+ Livraison express 48 h/.test(await admin.textContent(".ad-quota table")));
  await admin.click("[data-offline-received]");
  await admin.waitForFunction(() => (document.querySelector(".ad-options-chosen")?.textContent.match(/Réglée/g) || []).length === 2, null, { timeout: 15000 });
  check("« Marquer comme reçu » : les deux options passent en « Réglée »", true);
  if (SHOTS) await admin.locator(".ad-quota").screenshot({ path: join(SHOTS, "options-fiche.png") });

  await gallery.reload({ waitUntil: "domcontentloaded" });
  await gallery.waitForSelector("#gp-gallery:not([hidden]), #gp-password", { timeout: 15000 });
  if (await gallery.isVisible("#gp-password")) {
    await gallery.fill("#gp-password", PASSWORD);
    await gallery.click("#gp-submit");
  }
  await gallery.waitForSelector("#gp-gallery:not([hidden])", { timeout: 15000 });
  await gallery.click("#gp-options-open");
  check("chez la cliente : « Déjà réglé : Retouche avancée × 2, Livraison express 48 h ✓ », plus rien à payer",
        /Déjà réglé : Retouche avancée × 2, Livraison express 48 h ✓/.test(await gallery.textContent("#gp-options-paid")) && await gallery.isHidden("#gp-offline"));

  await gallery.setViewportSize({ width: 390, height: 844 });
  await gallery.waitForTimeout(300);
  const overflow = await gallery.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : la fenêtre des options tient dans l'écran", overflow <= 0, `${overflow}px`);
  if (SHOTS) await gallery.screenshot({ path: join(SHOTS, "options-galerie-mobile.png") });
  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} finally {
  await browser.close();
  site.close();
  await client.deleteGallery(slug).catch(() => {});
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
