// Commande des photos scolaires de bout en bout, dans de vrais navigateurs,
// contre le vrai Worker local : le photographe compose sa gamme et ses prix
// (tableau de bord), la famille remplit un seul panier pour ses deux
// enfants (espace famille), le paiement est refusé tant que Stripe n'est pas
// prêt, puis une commande payée apparaît chez la famille (fichier numérique
// à télécharger) et chez le photographe (suivi par classe, fichier de
// production rangé par classe et par enfant).
//
// Stripe n'est pas configuré en local : la commande payée est posée
// directement dans la base, comme le ferait le webhook.
//
//   npm run dev:local                      (depuis worker/)
//   node admin-server.mjs                  (depuis tools/, GALERIE_API=http://127.0.0.1:8788)
//   node tests/schoolshop.test.mjs         (depuis tools/)

import { chromium } from "playwright";
import sharp from "sharp";
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
const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web");
const SITE_PORT = Number(process.env.SITE_PORT || 8001);

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

/* ---------- Une école, une classe, deux enfants, une photo de classe ---------- */

const account = await createTestAccount(API, "boutique", { plan: "studio" });
const RUN = Date.now().toString(36);
const PARENT = `parent-boutique-${RUN}@test.invalid`;
const client = new WorkerClient({ api: API, ...account });
const school = await client.request("POST", "/api/admin/school/schools", { kind: "ecole", name: "École de la boutique" });
const yearId = school.yearId;
const { ids: [groupId] } = await client.request("POST", `/api/admin/school/years/${yearId}/groups`, { names: ["P2"] });
const { slug } = await client.request("POST", `/api/admin/school/groups/${groupId}/gallery`, {});
const gallery = await client.getGallery(slug);

const base = Date.UTC(2026, 9, 7, 9, 0, 0);
const shots = [["#c98", 0], ["#c98", 2000], ["#89c", 40000], ["#89c", 42000], ["#bbb", 600000]];
let position = 0;
for (const [color, offset] of shots) {
  const input = await sharp({ create: { width: 800, height: 1000, channels: 3, background: color } }).jpeg().toBuffer();
  const { photo, tiles } = await processPhoto(input, { galleryId: gallery.gallery.id, forensicKey: "cle-de-test-boutique", watermarkText: "Test", position: position++ });
  await client.addPhoto(slug, { ...photo, takenAt: base + offset });
  for (const t of tiles) await client.putTile(photo.id, t.level, t.col, t.row, t.buffer);
  await client.putOriginal(photo.id, input);
}
await client.request("POST", `/api/admin/school/groups/${groupId}/arrange`, {});
let detail = await client.request("GET", `/api/admin/school/groups/${groupId}`);
const lonely = detail.children.find((c) => detail.photos.filter((p) => p.childId === c.id).length === 1);
await client.request("POST", `/api/admin/school/groups/${groupId}/assign`, {
  photoIds: detail.photos.filter((p) => p.childId === lonely.id).map((p) => p.id), to: "group",
});
detail = await client.request("GET", `/api/admin/school/groups/${groupId}`);
await client.request("POST", `/api/admin/school/children/${detail.children[0].id}`, { firstName: "Léa" });
await client.request("POST", `/api/admin/school/children/${detail.children[1].id}`, { firstName: "Tom" });
const coupons = await client.request("POST", `/api/admin/school/years/${yearId}/coupons`, {});
const [kidA, kidB] = coupons.groups[0].children;
detail = await client.request("GET", `/api/admin/school/groups/${groupId}`);
const photosOf = (childId) => detail.photos.filter((p) => p.childId === childId);
await client.request("POST", `/api/admin/school/years/${yearId}`, { status: "open", orderDeadline: "2030-06-04", lateDeadline: "2030-07-01" });

/* ---------- API : validations de la gamme ---------- */

const badPrice = await fetch(`${API}/api/admin/school/years/${yearId}/products`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${client.token}` },
  body: JSON.stringify({ kind: "tirage", scope: "portrait", name: "Gratuit", price: "0" }),
});
check("un produit sans prix valable est refusé", badPrice.status === 400, (await badPrice.json()).error);

/* ---------- Tableau de bord : gamme, prix, frais de port ---------- */

const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ["--disable-features=LocalNetworkAccessChecks"],
});
const admin = await browser.newPage({ viewport: { width: 1300, height: 1000 }, acceptDownloads: true });
const exceptions = [];
admin.on("pageerror", (err) => exceptions.push("admin: " + String(err)));
await admin.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await admin.goto(BASE, { waitUntil: "domcontentloaded" });
await admin.fill('#ad-login-form [name="email"]', account.email);
await admin.fill('#ad-login-form [name="password"]', account.password);
await admin.click("#ad-login-submit");
await admin.waitForSelector("#ad-tab-school:not([hidden])", { timeout: 10000 });
await admin.goto(`${BASE}/#/scolaire/${encodeURIComponent(school.id)}/${encodeURIComponent(yearId)}`, { waitUntil: "domcontentloaded" });
await admin.waitForSelector("#ad-sc-starter", { timeout: 10000 });
check("une année sans gamme propose de partir d'une gamme type", await admin.isVisible("#ad-sc-starter"));
await admin.click("#ad-sc-starter");
await admin.waitForSelector(".ad-sc-products > li");
check("la gamme de départ compte pochettes, tirages, fichier numérique et photo de groupe",
      (await admin.locator(".ad-sc-products > li").count()) === 6, String(await admin.locator(".ad-sc-products > li").count()));

const firstPrice = admin.locator('.ad-sc-products > li').first().locator('[data-pfield="price"]');
await firstPrice.fill("24,50");
await firstPrice.press("Tab");
const tirage20 = admin.locator(".ad-sc-products > li", { has: admin.locator('[data-pfield="name"][value="Tirage 20×30"]') });
await tirage20.locator('[data-pfield="active"]').uncheck();
await admin.fill('#ad-sc-add-product [name="name"]', "Pochette Duo");
await admin.fill('#ad-sc-add-product [name="description"]', "2 tirages 13×18");
await admin.fill('#ad-sc-add-product [name="price"]', "18");
await admin.click('#ad-sc-add-product [type="submit"]');
await admin.waitForFunction(() => document.querySelectorAll(".ad-sc-products > li").length === 7);
await admin.fill("#ad-sc-shipping", "6,90");
await admin.press("#ad-sc-shipping", "Tab");
await admin.waitForTimeout(800);
let shop = await client.request("GET", `/api/admin/school/years/${yearId}/shop`);
const byName = (n) => shop.products.find((p) => p.name === n);
check("prix modifié, article retiré de la vente, nouveau produit et frais de port sont enregistrés",
      byName("Pochette Classique").priceCents === 2450 && byName("Tirage 20×30").active === false &&
      byName("Pochette Duo").priceCents === 1800 && shop.homeShippingCents === 690,
      JSON.stringify({ classique: byName("Pochette Classique").priceCents, actif: byName("Tirage 20×30").active, port: shop.homeShippingCents }));
check("sans commande, le suivi l'annonce simplement", (await admin.textContent("#ad-sc-orders")).includes("Aucune commande"));

// Pochette Classique composée d'une planche du labo : elle aura son visuel.
await client.request("POST", `/api/admin/school/products/${byName("Pochette Classique").id}/lab`, {
  items: [{ idproduct: 1051, idpaper: 1, quantity: 1, label: "Planche 13×18 n°1051" }],
});
// Pochette Duo : planche 1033, dont une case en noir et blanc.
await client.request("POST", `/api/admin/school/products/${byName("Pochette Duo").id}/lab`, {
  items: [{ idproduct: 1033, idpaper: 1, quantity: 1, label: "Planche 13×18 n°1033" }],
});

/* ---------- Espace famille : panier pour deux enfants ---------- */

const site = createServer(async (req, res) => {
  let pathname = req.url.split("?")[0];
  if (pathname === "/ecole") pathname = "/ecole.html";
  try {
    const body = await readFile(join(WEB_DIR, pathname));
    const type = pathname.endsWith(".css") ? "text/css" : pathname.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8";
    res.writeHead(200, { "content-type": type });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => site.listen(SITE_PORT, "localhost", resolve));

const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
page.on("pageerror", (err) => exceptions.push("famille: " + String(err)));
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await page.route(/workers\.dev\/api\//, async (route) => {
  const url = route.request().url().replace(/^https:\/\/[^/]+/, API);
  const upstream = await fetch(url, { method: route.request().method(), headers: route.request().headers(), body: route.request().postData() || undefined });
  const headers = { "content-type": upstream.headers.get("content-type") || "application/json", "access-control-allow-origin": "*" };
  if (upstream.headers.get("content-disposition")) {
    headers["content-disposition"] = upstream.headers.get("content-disposition");
    headers["access-control-expose-headers"] = "content-disposition";
  }
  await route.fulfill({ status: upstream.status, headers, body: Buffer.from(await upstream.arrayBuffer()) });
});

await page.goto(`http://localhost:${SITE_PORT}/ecole?c=${kidA.code}`, { waitUntil: "domcontentloaded" });
await page.fill("#ec-email", PARENT);
await page.click("#ec-access-submit");
await page.waitForSelector(".ec-product");
const productNames = await page.$$eval(".ec-product h4", (els) => els.map((e) => e.textContent));
check("la famille voit la gamme en vente (pas l'article retiré) et ses prix",
      productNames.length === 6 && !productNames.includes("Tirage 20×30") && (await page.textContent(".ec-order")).includes("24,50"),
      productNames.join(", "));
check("la livraison gratuite à l'école et la date limite sont annoncées", /gratuite à l'établissement.*2030/.test(await page.textContent(".ec-order")));

await page.waitForFunction(() => document.querySelectorAll("canvas.ec-mockup[data-mockup].ec-loaded").length === 2, null, { timeout: 15000 });
// Lit des pixels de l'aperçu : centre d'une case (photo #c98, rosée) et
// marge blanche ; pour 1033, la case noir et blanc doit être grise.
const sample = (selector, points) => page.$eval(selector, (canvas, pts) => {
  const ctx = canvas.getContext("2d");
  return pts.map(([x, y]) => Array.from(ctx.getImageData(Math.round(x * canvas.width), Math.round(y * canvas.height), 1, 1).data).slice(0, 3));
}, points);
const classique = await sample('.ec-product:has(h4:text-is("Pochette Classique")) canvas.ec-mockup', [[0.25, 0.25], [0.01, 0.5]]);
const duo = await sample('.ec-product:has(h4:text-is("Pochette Duo")) canvas.ec-mockup', [[0.5, 0.2], [0.75, 0.8]]);
const isPhoto = ([r, g, b]) => r > g + 20 && g > b && r < 245;
const isWhite = ([r, g, b]) => r > 245 && g > 245 && b > 245;
const isGrey = ([r, g, b]) => Math.abs(r - g) < 6 && Math.abs(g - b) < 6 && r < 240;
check("chaque produit composé d'une planche montre l'aperçu avec la photo de l'enfant dans les cases",
      isPhoto(classique[0]) && isWhite(classique[1]) && (await page.locator(".ec-product-img").count()) === 2, JSON.stringify(classique));
check("les cases noir et blanc de la planche le sont aussi dans l'aperçu", isPhoto(duo[0]) && isGrey(duo[1]), JSON.stringify(duo));
const familyShop = await page.evaluate(() => fetch("https://galerie-protegee.littledreamphotos-be.workers.dev/api/family/me", {
  headers: { authorization: "Bearer " + JSON.parse(localStorage.getItem("holypixx-famille")).token },
}).then((r) => r.json()));
check("la composition labo reste côté photographe (jamais envoyée aux familles)",
      Object.values(familyShop.shops)[0].products.every((p) => !("labItems" in p)));

// Pochette Classique, sur la 2e photo de Léa, en 2 exemplaires.
await page.click('.ec-product:has(h4:text-is("Pochette Classique")) [data-pick]');
await page.waitForSelector("#ec-sheet:not([hidden]) .ec-pick-photo");
await page.waitForSelector("#ec-pick-visual canvas.ec-loaded", { timeout: 10000 });
check("le choix de l'article est un menu déroulant illustré, avec l'aperçu de la planche et de la photo choisie",
      (await page.textContent(".ec-vsel-btn")).includes("Pochette Classique") && !(await page.isHidden("#ec-pick-visual canvas")) &&
      (await page.textContent("#ec-pick-visual figcaption")).includes("filigrane"));
await page.click(".ec-vsel-btn");
await page.waitForSelector('.ec-vsel-list:not([hidden])');
if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, "famille-menu-article.png") });
const articleOptions = await page.$$eval('.ec-vsel [role="option"] strong', (els) => els.map((e) => e.textContent));
await page.keyboard.press("Escape");
check("le menu propose les articles « portrait » ; Échap le referme sans fermer le panneau",
      articleOptions.length === 5 && !articleOptions.includes("Photo de groupe 20×30") && (await page.isHidden(".ec-vsel-list")) && !(await page.isHidden("#ec-sheet")),
      articleOptions.join(", "));
check("le choix propose les portraits de l'enfant", (await page.locator(".ec-pick-photo").count()) === photosOf(kidA.id).length);
await page.locator(".ec-pick-photo").nth(1).click();
await page.click('[data-qty="1"]');
check("le bouton affiche le prix de la quantité choisie", (await page.textContent("#ec-pick-add")).includes("49,00"), await page.textContent("#ec-pick-add"));
await page.click("#ec-pick-add");
await page.waitForSelector("#ec-cartbar:not([hidden])");
check("le panier s'affiche en bas de page", (await page.textContent("#ec-cartbar")).includes("2 articles"), await page.textContent("#ec-cartbar-text"));

// Photo de classe, depuis la photo en grand.
await page.locator('.ec-thumb[data-list="groupPhotos"]').first().click();
await page.waitForSelector("#ec-lightbox-order:not([hidden])");
await page.click("#ec-lightbox-order");
await page.waitForSelector("#ec-sheet:not([hidden])");
const groupChoices = await page.$$eval('.ec-vsel [role="option"] strong', (els) => els.map((e) => e.textContent));
check("depuis la photo de classe en grand, seuls les articles « photo de groupe » sont proposés",
      groupChoices.length === 1 && groupChoices[0] === "Photo de groupe 20×30", groupChoices.join(", "));
await page.click("#ec-pick-add");

// Deuxième enfant, même panier.
await page.fill("#ec-add-code", kidB.code);
await page.click("#ec-add-form [type=submit]");
await page.waitForFunction(() => document.querySelectorAll(".ec-kid").length === 2);
await page.locator(".ec-kid").nth(1).click();
await page.click('.ec-product:has(h4:text-is("Fichier numérique HD")) [data-pick]');
await page.click("#ec-pick-add");
await page.click("#ec-cartbar-open");
await page.waitForSelector("#ec-sheet:not([hidden]) .ec-cart-total");
check("un seul panier pour les deux enfants, rangé par enfant",
      (await page.locator(".ec-cart-child").count()) === 2 && (await page.textContent("#ec-sheet")).includes("Léa") && (await page.textContent("#ec-sheet")).includes("Tom"));
check("total : 2 × 24,50 + 12,00 + 10,00, livraison à l'école offerte",
      (await page.textContent(".ec-cart-total")).includes("71,00") && (await page.textContent(".ec-cart-totals")).includes("Offerte"),
      await page.textContent(".ec-cart-total"));
if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, "famille-panier.png") });

await page.click("#ec-pay");
await page.waitForSelector("#ec-pay-error:not([hidden])");
check("tant que le photographe n'a pas activé Stripe, le paiement est refusé avec un message clair",
      (await page.textContent("#ec-pay-error")).includes("pas encore ouvert"), await page.textContent("#ec-pay-error"));

await localSql(API, `UPDATE photographers SET stripe_account_id = 'acct_test_${RUN}', stripe_charges_enabled = 1 WHERE email = '${account.email}'`);
await page.click("#ec-pay");
await page.waitForFunction(() => /configuré/.test(document.getElementById("ec-pay-error").textContent));
const pendingLeft = await client.request("GET", `/api/admin/school/years/${yearId}/shop`);
check("si Stripe ne répond pas, aucune commande fantôme ne reste", pendingLeft.totals.orders === 0);
await page.keyboard.press("Escape");

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#ec-cartbar:not([hidden])");
check("le panier est gardé au retour sur la page", (await page.textContent("#ec-cartbar-text")).includes("4 articles"), await page.textContent("#ec-cartbar-text"));

// Un panier mal formé ne passe pas : photo d'un autre enfant.
const token = await page.evaluate(() => JSON.parse(localStorage.getItem("holypixx-famille")).token);
const wrongPhoto = await fetch(`${API}/api/family/checkout`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({ items: [{ childId: kidA.id, productId: byName("Pochette Classique").id, photoId: photosOf(kidB.id)[0].id, quantity: 1 }], returnUrl: "https://www.holypixx.com/ecole" }),
});
check("une photo d'un autre enfant ne peut pas être commandée sur la fiche de celui-ci", wrongPhoto.status === 400, (await wrongPhoto.json()).error);

/* ---------- Commande payée (comme après le webhook Stripe) ---------- */

const orderId = `sco_test_${RUN}`;
const lineA = `sol_a_${RUN}`;
const lineB = `sol_b_${RUN}`;
const paidAt = Math.floor(Date.now() / 1000);
await localSql(API, [
  `INSERT INTO school_orders (id, year_id, family_id, email, delivery, shipping_cents, amount_cents, fee_cents, status, stripe_session_id, created_at, paid_at)
   VALUES ('${orderId}', '${yearId}', (SELECT id FROM families WHERE email = '${PARENT}'), '${PARENT}', 'school', 0, 5900, 148, 'paid', 'cs_test_${RUN}', ${paidAt}, ${paidAt})`,
  `INSERT INTO school_order_lines (id, order_id, child_id, group_id, product_id, photo_id, kind, name, description, price_cents, quantity)
   VALUES ('${lineA}', '${orderId}', '${kidA.id}', '${groupId}', '${byName("Pochette Classique").id}', '${photosOf(kidA.id)[1].id}', 'pochette', 'Pochette Classique', '', 2450, 2)`,
  `INSERT INTO school_order_lines (id, order_id, child_id, group_id, product_id, photo_id, kind, name, description, price_cents, quantity)
   VALUES ('${lineB}', '${orderId}', '${kidB.id}', '${groupId}', '${byName("Fichier numérique HD").id}', '${photosOf(kidB.id)[0].id}', 'numerique', 'Fichier numérique HD', '', 1000, 1)`,
].join("; "));

await page.goto(`http://localhost:${SITE_PORT}/ecole?commande=annulee`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".ec-notice");
check("au retour d'un paiement annulé, le panier est conservé et la famille prévenue",
      (await page.textContent(".ec-notice")).includes("annulé") && !(await page.isHidden("#ec-cartbar")));
await page.waitForSelector(".ec-orders");
check("la commande payée apparaît dans « Vos commandes »", (await page.textContent(".ec-orders")).includes("Pochette Classique"));
const [download] = await Promise.all([page.waitForEvent("download"), page.click("[data-download]")]);
const downloaded = await readFile(await download.path());
const downloadedMeta = await sharp(downloaded).metadata().catch(() => ({}));
check("le fichier numérique acheté se télécharge en pleine définition", downloadedMeta.width === 800 && downloadedMeta.height === 1000, `${downloadedMeta.width}×${downloadedMeta.height}`);
const notBought = await fetch(`${API}/api/family/download/${lineA}`, { headers: { authorization: `Bearer ${token}` } });
check("une pochette (article imprimé) ne donne pas accès au fichier", notBought.status === 404);
const unknownSession = await fetch(`${API}/api/family/checkout/sync`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ sessionId: "cs_inconnu" }),
});
check("une session de paiement inconnue n'est rattachée à rien", unknownSession.status === 404);

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await mobile.route(/workers\.dev\/api\//, async (route) => {
  const url = route.request().url().replace(/^https:\/\/[^/]+/, API);
  const upstream = await fetch(url, { method: route.request().method(), headers: route.request().headers(), body: route.request().postData() || undefined });
  await route.fulfill({ status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") || "application/json", "access-control-allow-origin": "*" }, body: Buffer.from(await upstream.arrayBuffer()) });
});
await mobile.goto(`http://localhost:${SITE_PORT}/ecole`, { waitUntil: "domcontentloaded" });
await mobile.evaluate((t) => localStorage.setItem("holypixx-famille", JSON.stringify({ token: t, exp: Date.now() + 3600e3 })), token);
await mobile.reload({ waitUntil: "domcontentloaded" });
await mobile.waitForSelector(".ec-product");
await mobile.click('.ec-product:has(h4:text-is("Pochette Duo")) [data-pick]');
await mobile.waitForSelector("#ec-sheet:not([hidden])");
check("sur téléphone, le choix s'ouvre en panneau, sans défilement horizontal",
      await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector(".ec-sheet-card").getBoundingClientRect().bottom <= innerHeight + 1));
if (process.env.SCREENSHOT_DIR) await mobile.screenshot({ path: join(process.env.SCREENSHOT_DIR, "famille-choix-mobile.png") });

/* ---------- Suivi et fichier de production côté photographe ---------- */

await admin.reload({ waitUntil: "domcontentloaded" });
await admin.waitForSelector(".ad-sc-kpis");
const kpis = await admin.textContent(".ad-sc-kpis");
check("le suivi résume commandes, familles et montants", /1\s*commande/.test(kpis) && kpis.includes("59,00"), kpis.replace(/\s+/g, " "));
check("le suivi par classe montre les enfants ayant commandé", (await admin.textContent(".ad-sc-group-table")).includes("2 / 2"));
if (process.env.SCREENSHOT_DIR) await admin.screenshot({ path: join(process.env.SCREENSHOT_DIR, "ecole-commandes.png"), fullPage: true });

const productionHref = await admin.getAttribute('#ad-sc-orders a[href*="/production"]', "href");
const zip = await admin.request.get(BASE + productionHref);
const zipBody = await zip.body();
const zipNames = [];
const zipFiles = new Map();
for (let i = 0; i < zipBody.length - 4;) {
  if (zipBody.readUInt32LE(i) !== 0x04034b50) break;
  const size = zipBody.readUInt32LE(i + 18);
  const nameLength = zipBody.readUInt16LE(i + 26);
  const name = zipBody.subarray(i + 30, i + 30 + nameLength).toString("utf8");
  zipNames.push(name);
  zipFiles.set(name, zipBody.subarray(i + 30 + nameLength, i + 30 + nameLength + size));
  i += 30 + nameLength + size;
}
check("le fichier de production range les tirages par classe puis par enfant (le fichier numérique, rien à imprimer, n'y est pas)",
      zip.status() === 200 && zipNames.some((n) => /^01_P2\/001_Lea\/2x_Pochette_Classique_\w{6}\.jpg$/.test(n)) &&
      !zipNames.some((n) => /Fichier_numerique/.test(n)), zipNames.join(", "));
const recap = (zipFiles.get("recapitulatif.csv") || Buffer.alloc(0)).toString("utf8");
const distribution = (zipFiles.get("distribution.csv") || Buffer.alloc(0)).toString("utf8");
check("le récapitulatif CSV liste chaque article, et la liste de distribution chaque enfant",
      recap.split("\r\n").filter(Boolean).length === 2 && recap.includes("Pochette Classique;;2;24,50;École") &&
      distribution.includes("P2;1;Léa;2× Pochette Classique;"), recap.split("\r\n")[1]);

check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

await browser.close();
site.close();

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
