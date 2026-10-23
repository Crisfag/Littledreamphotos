// Galerie client en anglais, dans un vrai navigateur, contre le vrai Worker
// local : écran de mot de passe, galerie, visionneuse, boutique (pays
// traduits, port hors d'Europe). Autonome : crée son compte, sa galerie et
// ses photos, nettoie derrière lui. SHOTS=<dossier> enregistre des captures.
//
//   npm run dev:local                      (depuis worker/)
//   node tests/english.test.mjs            (depuis tools/)

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
const account = await createTestAccount(API, "anglais");
const client = new WorkerClient({ api: API, ...account });
await client.shopRequest("POST", "shop/settings", { apiKey: "test-key-anglais", environment: "sandbox", shippingCents: 590, shippingWorldCents: 1490 });
await client.shopRequest("POST", "shop/products/suggested");
const { photographer } = await client.me();
await d1(`UPDATE photographers SET stripe_account_id = 'acct_test_ui', stripe_charges_enabled = 1 WHERE id = '${photographer.id}'`);

const slug = `english-${Date.now().toString(36)}`;
const PASSWORD = "mot-de-passe-anglais-test";
const created = await client.createGallery({ slug, title: "Emma & Louis", clientName: "Emma", password: PASSWORD, language: "en", expiresAt: Math.floor(Date.now() / 1000) + 30 * 86400 });
await client.setGalleryShop(slug, true);
const photoIds = [];
for (const [position, file] of PHOTOS.entries()) {
  const input = await readFile(file);
  const { photo, tiles } = await processPhoto(input, { galleryId: created.id, forensicKey: "cle-de-test-anglais", watermarkText: "Test", position });
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

const SHOTS = process.env.SHOTS || "";
const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ["--disable-features=LocalNetworkAccessChecks"],
});
const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "en-US" });
const page = await context.newPage();
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
const shot = async (name, target = page) => { if (SHOTS) await target.screenshot({ path: join(SHOTS, name) }); };

await page.goto(`${siteBase}/galerie.html?g=${slug}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.documentElement.lang === "en", null, { timeout: 10000 });
check("l'écran de mot de passe s'affiche en anglais avant même la connexion",
      (await page.textContent("#gp-login h1")) === "Your private gallery" && (await page.textContent("#gp-submit")) === "See my photos" &&
      (await page.textContent(".gp-privacy-note")).includes("Privacy"));
await shot("en-login.png");

await page.fill("#gp-password", "wrong-password");
await page.click("#gp-submit");
await page.waitForSelector("#gp-error:not([hidden])");
check("mot de passe faux : message en anglais", (await page.textContent("#gp-error")) === "Incorrect password.", await page.textContent("#gp-error"));

await page.fill("#gp-password", PASSWORD);
await page.click("#gp-submit");
await page.waitForSelector("#gp-gallery:not([hidden])", { timeout: 10000 });
await page.waitForTimeout(1200);
const galleryText = await page.textContent("#gp-gallery");
check("la galerie est en anglais (sous-titre, échéance, avertissement, barre d'outils)",
      (await page.textContent("#gp-subtitle")) === "Gallery of Emma" && (await page.textContent("#gp-expiry")).startsWith("Access open until ") &&
      galleryText.includes("These photos are viewing proofs") && galleryText.includes("No photos selected yet") &&
      galleryText.includes("My favourites") && galleryText.includes("My prints"), (await page.textContent("#gp-expiry")));
check("aucun texte français visible dans la galerie",
      !/Votre |vos photos|Valider|sélection|Tirages|Afficher/.test(await page.evaluate(() => document.getElementById("gp-gallery").innerText)));

await page.locator(".gp-heart").first().click();
await page.waitForTimeout(400);
check("compteur de sélection et bouton de validation en anglais",
      (await page.textContent("#gp-selection-count")) === "1 photo selected" && (await page.textContent("#gp-validate")) === "Confirm my selection");
await shot("en-gallery.png");

await page.locator(".gp-open").first().click();
await page.waitForSelector("#gp-viewer:not([hidden])");
await page.waitForTimeout(500);
check("visionneuse : libellés accessibles en anglais",
      (await page.getAttribute("#gp-close", "aria-label")) === "Close" && (await page.getAttribute("#gp-viewer-heart", "aria-label")) === "Remove from favourites" &&
      (await page.textContent("#gp-print-toggle")) === "Prints");
await page.click("#gp-print-toggle");
const firstProduct = await page.textContent("#gp-print-products li:first-child");
check("formats et prix à l'anglaise (pouces, cm, €)", /in \(\d+ × \d+ cm\)/.test(firstProduct) && /€\d+\.\d\d/.test(firstProduct) &&
      (await page.textContent(".gp-print-add")) === "Add", firstProduct);
await page.locator("#gp-print-products .gp-print-add").first().click();
check("ajout au panier confirmé en anglais", (await page.textContent("#gp-print-status")).startsWith("Added ✓ — 1 item"), await page.textContent("#gp-print-status"));
await shot("en-prints.png");
await page.click("#gp-close");

await page.click("#gp-cart-btn");
await page.waitForSelector("#gp-cart:not([hidden])");
check("pays en anglais, États-Unis présélectionnés (navigateur en-US, livraison hors d'Europe ouverte)",
      (await page.inputValue("#gp-cart-country")) === "US" &&
      (await page.locator("#gp-cart-country option", { hasText: "Germany" }).count()) === 1);
check("port hors d'Europe appliqué (€14.90)", (await page.textContent("#gp-cart-shipping")) === "€14.90", await page.textContent("#gp-cart-shipping"));
await page.selectOption("#gp-cart-country", "DE");
check("vers l'Allemagne, le forfait Europe (€5.90) et le total suivent",
      (await page.textContent("#gp-cart-shipping")) === "€5.90" && (await page.textContent("#gp-cart-pay")).startsWith("Pay €"), await page.textContent("#gp-cart-pay"));
await page.selectOption("#gp-cart-country", "US");
await shot("en-cart.png");
await page.fill('#gp-cart-form [name="name"]', "Emma Smith");
await page.fill('#gp-cart-form [name="email"]', "emma@example.com");
await page.fill('#gp-cart-form [name="line1"]', "1 Main Street");
await page.fill('#gp-cart-form [name="postalCode"]', "10001");
await page.fill('#gp-cart-form [name="city"]', "New York");
await page.click("#gp-cart-pay");
await page.waitForSelector("#gp-cart-error:not([hidden])", { timeout: 10000 });
check("sans Stripe en local, refus expliqué en anglais (pas de message français)",
      (await page.textContent("#gp-cart-error")) === "Online payment isn't enabled yet", await page.textContent("#gp-cart-error"));

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-GB", isMobile: true });
const phone = await mobile.newPage();
phone.on("pageerror", (err) => exceptions.push(String(err)));
await phone.goto(`${siteBase}/galerie.html?g=${slug}`, { waitUntil: "domcontentloaded" });
await phone.fill("#gp-password", PASSWORD);
await phone.click("#gp-submit");
await phone.waitForSelector("#gp-gallery:not([hidden])", { timeout: 10000 });
await phone.waitForTimeout(1200);
check("sur téléphone, aucun débordement horizontal", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
await shot("en-mobile.png", phone);
await mobile.close();

check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

/* ---------- Nettoyage ---------- */

await browser.close();
site.close();
await lab.close();
await client.deleteGallery(slug);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
