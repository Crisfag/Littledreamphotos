// Suppléments réglés en espèces ou par virement, de bout en bout dans de
// vrais navigateurs : le photographe active les deux moyens dans
// Paramètres (adresse pour les espèces) ; le client, au-delà de son
// forfait, demande à régler en espèces, puis change pour le virement ; le
// photographe voit la demande dans la galerie et clique « Marquer comme
// reçu » ; le client retrouve ses suppléments réglés et sa facture.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/offlinepay.test.mjs

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../lib/client.mjs";
import { processPhoto } from "../lib/pipeline.mjs";
import { createTestAccount } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_DIR = join(REPO_ROOT, "galerie", "web");
const PHOTOS = [
  join(REPO_ROOT, "images", "famille", "famille-01.jpeg"),
  join(REPO_ROOT, "images", "famille", "famille-02.jpeg"),
  join(REPO_ROOT, "images", "maternite", "maternite-01.jpeg"),
];
const SITE_PORT = Number(process.env.SITE_PORT || 8000);
const SHOTS = process.env.SCREENSHOT_DIR || "";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

/* ---------- Galerie : 3 photos, 1 incluse, 12 € la photo en plus ---------- */

const account = await createTestAccount(API, "hors-ligne", { plan: "essentiel" });
const client = new WorkerClient({ api: API, ...account });
const slug = `hors-ligne-${Date.now().toString(36)}`;
const PASSWORD = "mot-de-passe-hors-ligne";
const created = await client.createGallery({ slug, title: "Famille Martin", clientName: "Léa Martin", clientEmail: "lea@test.invalid", password: PASSWORD });
for (const [position, file] of PHOTOS.entries()) {
  const { photo, tiles } = await processPhoto(await readFile(file), { galleryId: created.id, forensicKey: "cle-hors-ligne", watermarkText: "Test", position });
  await client.addPhoto(slug, photo);
  for (const tile of tiles) await client.putTile(photo.id, tile.level, tile.col, tile.row, tile.buffer);
}
await client.setQuota(slug, 1, 12);

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
await new Promise((resolve, reject) => {
  site.once("error", reject);
  site.listen(SITE_PORT, "localhost", resolve);
});

const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ["--disable-features=LocalNetworkAccessChecks"],
});
const exceptions = [];
const admin = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
admin.on("pageerror", (err) => exceptions.push("admin: " + String(err)));
await admin.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on("pageerror", (err) => exceptions.push("galerie: " + String(err)));
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

async function openGallery() {
  await page.goto(`http://localhost:${SITE_PORT}/galerie.html?g=${slug}`, { waitUntil: "domcontentloaded" });
  await page.fill("#gp-password", PASSWORD);
  await page.click("#gp-submit");
  await page.waitForSelector("#gp-gallery:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(600);
}

try {
  /* ---------- Paramètres du photographe ---------- */

  await admin.goto(BASE, { waitUntil: "domcontentloaded" });
  await admin.fill('#ad-login-form [name="email"]', account.email);
  await admin.fill('#ad-login-form [name="password"]', account.password);
  await admin.click("#ad-login-submit");
  await admin.waitForSelector("#ad-new-gallery", { timeout: 10000 });
  await admin.click("#ad-tab-settings");
  await admin.waitForSelector("#ad-offline-form", { timeout: 10000 });
  check("Paramètres : section espèces et virement, adresse masquée tant que les espèces sont décochées",
        await admin.isVisible("#ad-offline-section") && await admin.isHidden("#ad-offline-form .ad-offline-address"));
  await admin.check('#ad-offline-form [name="cash"]');
  check("cocher les espèces fait apparaître l'adresse", await admin.isVisible("#ad-offline-form .ad-offline-address"));
  await admin.fill('#ad-offline-form [name="cashAddress"]', "");
  await admin.click("#ad-offline-save");
  await admin.waitForSelector("#ad-offline-error:not([hidden])", { timeout: 5000 });
  check("espèces sans adresse : l'erreur s'affiche sous le formulaire", /adresse/.test(await admin.textContent("#ad-offline-error")));
  await admin.fill('#ad-offline-form [name="cashAddress"]', "Studio Julie\nRue des Fleurs 1, 1000 Bruxelles — sur rendez-vous");
  await admin.check('#ad-offline-form [name="transfer"]');
  await admin.click("#ad-offline-save");
  await admin.waitForFunction(() => document.getElementById("ad-offline-error").hidden, null, { timeout: 5000 });
  await admin.waitForTimeout(300);
  const me = (await client.request("GET", "/api/auth/me")).photographer;
  check("réglages enregistrés", me.offlineCash && me.offlineTransfer && me.offlineCashAddress.includes("Rue des Fleurs"));
  if (SHOTS) await admin.locator("#ad-offline-section").screenshot({ path: join(SHOTS, "offline-reglages.png") });

  /* ---------- Galerie du client ---------- */

  await openGallery();
  const hearts = page.locator(".gp-item .gp-heart");
  for (let i = 0; i < 3; i++) await hearts.nth(i).click();
  await page.waitForTimeout(500);
  check("3 photos choisies, 1 incluse : 2 suppléments à 24 €", /\+2 suppléments \(24,00 €\)/.test(await page.textContent("#gp-toolbar-quota")), await page.textContent("#gp-toolbar-quota"));
  check("sans Stripe : pas de paiement en ligne, mais espèces et virement proposés",
        await page.isHidden("#gp-pay-supplement") && await page.isVisible("#gp-pay-cash") && await page.isVisible("#gp-pay-transfer") &&
        (await page.textContent("#gp-offline-lead")) === "Régler le supplément :");

  await page.click("#gp-pay-cash");
  await page.waitForSelector("#gp-offline-pending:not([hidden])", { timeout: 10000 });
  let pending = await page.innerText("#gp-offline-pending");
  check("espèces : montant et adresse du studio affichés, boutons repliés",
        /espèces demandé : 24,00 €/.test(pending) && /Rue des Fleurs 1/.test(pending) && await page.isHidden("#gp-pay-cash"), pending.replace(/\n/g, " | "));
  if (SHOTS) await page.locator(".gp-toolbar").screenshot({ path: join(SHOTS, "offline-client-especes.png") });

  await openGallery();
  check("demande retrouvée après reconnexion", /espèces demandé/.test(await page.innerText("#gp-offline-pending")));
  await page.click(".gp-offline-change");
  check("« Choisir un autre moyen » ré-affiche les boutons", await page.isVisible("#gp-pay-transfer"));
  await page.click("#gp-pay-transfer");
  await page.waitForFunction(() => /virement demandé/.test(document.getElementById("gp-offline-pending").innerText), null, { timeout: 10000 });
  pending = await page.innerText("#gp-offline-pending");
  check("virement : le studio communique son numéro de compte, contact affiché",
        /numéro de compte/.test(pending) && pending.includes(account.email), pending.replace(/\n/g, " | "));

  await page.locator(".gp-item .gp-heart").nth(2).click();
  await page.waitForTimeout(400);
  check("sélection réduite : l'ancienne demande n'est plus montrée, choix à refaire",
        await page.isHidden("#gp-offline-pending") && /a changé/.test(await page.textContent("#gp-offline-lead")));
  await page.locator(".gp-item .gp-heart").nth(2).click();
  await page.waitForTimeout(400);
  check("sélection rétablie : la demande en cours réapparaît", /virement demandé/.test(await page.innerText("#gp-offline-pending")));

  /* ---------- Le photographe confirme la réception ---------- */

  await admin.goto(`${BASE}/#/g/${encodeURIComponent(slug)}`, { waitUntil: "domcontentloaded" });
  await admin.waitForSelector("[data-offline-received]", { timeout: 10000 });
  check("galerie : demande « À recevoir par virement » avec ses deux actions",
        /À recevoir par virement/.test(await admin.textContent(".ad-quota")) && await admin.isVisible("[data-offline-cancel]"));
  if (SHOTS) await admin.locator(".ad-quota").screenshot({ path: join(SHOTS, "offline-admin-attente.png") });
  await admin.click("[data-offline-received]");
  await admin.waitForFunction(() => /Réglé par virement/.test(document.querySelector(".ad-quota")?.textContent || ""), null, { timeout: 15000 });
  const quota = await admin.textContent(".ad-quota");
  check("après « Marquer comme reçu » : réglé, facture émise, plus rien à régler",
        /2 suppléments déjà réglés/.test(quota) && !/à régler/.test(quota) && await admin.locator('.ad-quota a[href^="/local/invoices/"]').count() === 1, quota.replace(/\s+/g, " ").slice(0, 300));

  await openGallery();
  check("côté client : supplément réglé, plus de demande ni de boutons, facture téléchargeable",
        /supplément réglé ✓/.test(await page.textContent("#gp-toolbar-quota")) && await page.isHidden("#gp-offline") && await page.isVisible("#gp-download-invoice"));

  /* ---------- Une nouvelle demande peut être annulée ---------- */

  await client.setQuota(slug, 0, 12);
  await openGallery();
  await page.click("#gp-pay-cash");
  await page.waitForSelector("#gp-offline-pending:not([hidden])", { timeout: 10000 });
  await admin.goto(`${BASE}/#/g/${encodeURIComponent(slug)}`, { waitUntil: "domcontentloaded" });
  await admin.reload({ waitUntil: "domcontentloaded" });
  await admin.waitForSelector("[data-offline-cancel]", { timeout: 10000 });
  admin.once("dialog", (d) => d.accept());
  await admin.click("[data-offline-cancel]");
  await admin.waitForFunction(() => !document.querySelector("[data-offline-cancel]"), null, { timeout: 10000 });
  const payments = (await client.request("GET", `/api/admin/galleries/${slug}`)).payments;
  check("demande annulée : retirée, le paiement reçu reste", payments.length === 1 && payments[0].status === "paid" && payments[0].method === "transfer");

  /* ---------- Mobile ---------- */

  await page.setViewportSize({ width: 390, height: 844 });
  await openGallery();
  await page.click("#gp-pay-transfer");
  await page.waitForSelector("#gp-offline-pending:not([hidden])", { timeout: 10000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : la demande tient dans l'écran", overflow <= 0, `${overflow}px`);
  if (SHOTS) await page.locator(".gp-toolbar").screenshot({ path: join(SHOTS, "offline-client-mobile.png") });

  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} finally {
  await browser.close();
  site.close();
  await client.deleteGallery(slug).catch(() => {});
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
