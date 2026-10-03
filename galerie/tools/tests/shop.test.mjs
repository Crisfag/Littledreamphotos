// Boutique de tirages, côté client, dans un vrai navigateur, contre le vrai
// Worker local et le faux laboratoire Prodigi (worker/tests/lib/fakeProdigi.mjs,
// branché par PRODIGI_API_BASE dans worker/.dev.vars). Autonome : crée son
// compte, sa galerie et ses photos, nettoie derrière lui.
//
//   npm run dev:local                      (depuis worker/)
//   node tests/shop.test.mjs               (depuis tools/)

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../lib/client.mjs";
import { processPhoto } from "../lib/pipeline.mjs";
import { createTestAccount } from "./lib/testAccount.mjs";
import { startFakeProdigi } from "../../worker/tests/lib/fakeProdigi.mjs";

const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_DIR = join(REPO_ROOT, "galerie", "web");
const WORKER_DIR = join(REPO_ROOT, "galerie", "worker");
const PHOTOS = [
  join(REPO_ROOT, "images", "famille", "famille-01.jpeg"),
  join(REPO_ROOT, "images", "famille", "famille-02.jpeg"),
];

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

async function d1(sql) {
  execFileSync("npx", ["wrangler", "d1", "execute", "galerie-protegee", "--local", "--command", sql], { cwd: WORKER_DIR, stdio: "pipe" });
  for (let i = 0; i < 20; i++) {
    try {
      if ((await fetch(`${API}/health`)).ok) return;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/* ---------- Compte, boutique, galerie ---------- */

const lab = await startFakeProdigi();
const account = await createTestAccount(API, "boutique");
const client = new WorkerClient({ api: API, ...account });
await client.shopRequest("POST", "shop/settings", { apiKey: "test-key-boutique", environment: "sandbox", shippingCents: 590 });
await client.shopRequest("POST", "shop/products/suggested");
const { photographer } = await client.me();
await d1(`UPDATE photographers SET stripe_account_id = 'acct_test_ui', stripe_charges_enabled = 1 WHERE id = '${photographer.id}'`);

const slug = `boutique-${Date.now().toString(36)}`;
const PASSWORD = "mot-de-passe-boutique-test";
const created = await client.createGallery({ slug, title: "Test boutique automatisé", clientName: "Suite de tests", password: PASSWORD });
await client.setGalleryShop(slug, true);
const photoIds = [];
for (const [position, file] of PHOTOS.entries()) {
  const input = await readFile(file);
  const { photo, tiles } = await processPhoto(input, { galleryId: created.id, forensicKey: "cle-de-test-boutique", watermarkText: "Test", position });
  await client.addPhoto(slug, photo);
  for (const tile of tiles) await client.putTile(photo.id, tile.level, tile.col, tile.row, tile.buffer);
  if (position === 0) await client.putOriginal(photo.id, input); // seule la première est disponible en tirage
  photoIds.push(photo.id);
}

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
  site.listen(Number(process.env.SITE_PORT || 8000), "localhost", resolve);
});
const siteBase = `http://localhost:${process.env.SITE_PORT || 8000}`;

/* ---------- Navigateur ---------- */

const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ["--disable-features=LocalNetworkAccessChecks"],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));

async function login(query = "") {
  await page.goto(`${siteBase}/galerie.html?g=${slug}${query}`, { waitUntil: "domcontentloaded" });
  await page.fill("#gp-password", PASSWORD);
  await page.click("#gp-submit");
  await page.waitForSelector("#gp-gallery:not([hidden])", { timeout: 10000 });
  await page.waitForTimeout(1000);
}

await login();
check("la boutique est annoncée dans la galerie, panier vide",
      await page.isVisible("#gp-shop-bar") && (await page.textContent("#gp-cart-count")).trim() === "(0)");

await page.locator(".gp-open").first().click();
await page.waitForSelector("#gp-viewer:not([hidden])");
await page.waitForTimeout(500);
check("une photo disponible en tirage propose « Commander un tirage »", await page.isVisible("#gp-print-toggle"));
await page.click("#gp-print-toggle");
check("le panneau liste les 5 formats proposés, avec leur prix",
      (await page.locator("#gp-print-products li").count()) === 5 &&
      (await page.textContent("#gp-print-products li:first-child")).includes("4,00"));
check("chaque format est illustré avec la photo elle-même, et un grand aperçu montre le format survolé",
      (await page.locator("#gp-print-products li .gp-mock canvas").count()) === 5 &&
      await page.isVisible("#gp-print-preview .gp-mock canvas"));
const frameRow = page.locator("#gp-print-products li", { hasText: "passe-partout" });
await frameRow.hover();
check("le cadre est dessiné à sa couleur (noir), avec son passe-partout",
      (await page.textContent(".gp-print-preview-label")).includes("passe-partout") &&
      (await page.locator("#gp-print-preview .gp-mock-frame .gp-mock-mat").count()) === 1 &&
      (await page.locator("#gp-print-preview .gp-mock-obj").evaluate((n) => n.style.getPropertyValue("--frame"))) === "#1f1c1a");
const mockPainted = await page.locator("#gp-print-preview canvas").evaluate((c) => {
  const d = c.getContext("2d").getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
  return !(d[0] === 0xef && d[1] === 0xe6 && d[2] === 0xdb);
});
check("l'aperçu contient bien la photo (pas un simple fond)", mockPainted);
await page.locator("#gp-print-products .gp-print-add").nth(0).click();
await page.locator("#gp-print-products .gp-print-add").nth(0).click();
await page.locator("#gp-print-products .gp-print-add").nth(1).click();
check("ajouter au panier le confirme aussitôt", (await page.textContent("#gp-print-status")).includes("3 articles"));

await page.click("#gp-next");
await page.waitForTimeout(500);
check("une photo sans fichier d'impression ne propose pas de tirage", await page.isHidden("#gp-print-toggle"));
await page.click("#gp-close");
check("le compteur du panier est à jour", (await page.textContent("#gp-cart-count")).trim() === "(3)");

await page.click("#gp-cart-btn");
await page.waitForSelector("#gp-cart:not([hidden])");
check("le panier détaille les lignes (format, photo, quantité), chacune avec son aperçu",
      (await page.locator("#gp-cart-lines li").count()) === 2 && (await page.textContent("#gp-cart-lines")).includes("Photo n° 1") &&
      (await page.locator("#gp-cart-lines li .gp-mock canvas").count()) === 2);
check("le total additionne tirages et livraison (2 × 4,00 + 12,00 + 5,90)",
      (await page.textContent("#gp-cart-items")).includes("20,00") && (await page.textContent("#gp-cart-shipping")).includes("5,90") &&
      (await page.textContent("#gp-cart-total")).includes("25,90"),
      await page.textContent("#gp-cart-total"));
await page.locator("#gp-cart-lines li").nth(1).locator("select").selectOption("2");
check("changer une quantité recalcule le total", (await page.textContent("#gp-cart-total")).includes("37,90"), await page.textContent("#gp-cart-total"));
await page.locator("#gp-cart-lines li").nth(0).locator(".gp-cart-remove").click();
check("retirer une ligne la supprime du panier", (await page.locator("#gp-cart-lines li").count()) === 1 &&
      (await page.textContent("#gp-cart-count")).trim() === "(2)");

await page.fill('#gp-cart-form [name="name"]', "Julie Peters");
await page.fill('#gp-cart-form [name="email"]', "julie@example.com");
await page.fill('#gp-cart-form [name="line1"]', "Rue de la Paix 1");
await page.fill('#gp-cart-form [name="postalCode"]', "1000");
await page.fill('#gp-cart-form [name="city"]', "Bruxelles");
check("la Belgique est proposée par défaut parmi les pays de livraison",
      (await page.inputValue("#gp-cart-country")) === "BE" && (await page.locator("#gp-cart-country option").count()) >= 10);
await page.click("#gp-cart-pay");
await page.waitForSelector("#gp-cart-error:not([hidden])", { timeout: 10000 });
check("sans Stripe configuré en local, la commande est refusée proprement et le panier conservé",
      (await page.textContent("#gp-cart-error")).includes("paiement en ligne") && (await page.locator("#gp-cart-lines li").count()) === 1,
      await page.textContent("#gp-cart-error"));
await page.click("#gp-cart-close");

await login();
check("le panier survit à un rechargement complet (retour de la page de paiement)",
      (await page.textContent("#gp-cart-count")).trim() === "(2)");

// Une commande déjà expédiée pour cette galerie, posée comme le ferait le circuit complet.
const now = Math.floor(Date.now() / 1000);
await d1(
  `INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, status, kind, created_at, paid_at) VALUES ('pay_ui_${slug}', '${created.id}', 'cs_ui_${slug}', 0, 1790, 'paid', 'print', ${now}, ${now}); ` +
  `INSERT INTO print_orders (id, gallery_id, photographer_id, payment_id, status, items, recipient, client_email, items_cents, shipping_cents, total_cents, tracking_url, created_at, paid_at, updated_at) ` +
  `VALUES ('ord_ui_${slug}', '${created.id}', '${photographer.id}', 'pay_ui_${slug}', 'shipped', '[{"photoId":"${photoIds[0]}","photoNumber":1,"copies":3,"label":"Tirage","lineCents":1200}]', '{"name":"Julie"}', 'julie@example.com', 1200, 590, 1790, 'https://suivi.example/ui', ${now}, ${now}, ${now});`
);
await login("&tirages=succes");
check("au retour du paiement, un message confirme la commande et le panier est vidé",
      await page.isVisible("#gp-shop-banner") && (await page.textContent("#gp-shop-banner")).includes("confirmée") &&
      (await page.textContent("#gp-cart-count")).trim() === "(0)");
check("le paramètre de retour est retiré de l'adresse", !(await page.evaluate(() => location.search)).includes("tirages="));
check("les commandes passées s'affichent avec leur statut et le lien de suivi",
      (await page.textContent("#gp-print-orders")).includes("3 tirages") && (await page.textContent("#gp-print-orders")).includes("Expédiée") &&
      (await page.getAttribute("#gp-print-orders a", "href")) === "https://suivi.example/ui");

check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

/* ---------- Nettoyage ---------- */

await browser.close();
site.close();
await lab.close();
await client.deleteGallery(slug);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
