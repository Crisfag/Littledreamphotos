// Pack « toutes les photos de l'enfant », ordre de la gamme et liste de
// prénoms collée, dans de vrais navigateurs contre le Worker local : le
// photographe colle les prénoms d'une section de crèche, crée le pack et le
// remonte en tête de gamme ; la famille le voit en premier, l'ajoute d'un
// clic (sans choisir de photo) et, une fois payé, télécharge chaque photo.
//
// Stripe n'est pas configuré en local : la commande payée est posée
// directement dans la base, comme le ferait le webhook.
//
//   npm run dev:local                      (depuis worker/)
//   node admin-server.mjs                  (depuis tools/, GALERIE_API=http://127.0.0.1:8788)
//   node tests/schoolpack.test.mjs         (depuis tools/)

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
const SITE_PORT = Number(process.env.SITE_PORT || 8002);
const SHOTS = process.env.SCREENSHOT_DIR || "";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

/* ---------- Une crèche, une section, trois enfants ---------- */

const account = await createTestAccount(API, "pack", { plan: "studio" });
const RUN = Date.now().toString(36);
const PARENT = `parent-pack-${RUN}@test.invalid`;
const client = new WorkerClient({ api: API, ...account });
const school = await client.request("POST", "/api/admin/school/schools", { kind: "creche", name: "Les Petits Pas" });
const yearId = school.yearId;
const { ids: [groupId] } = await client.request("POST", `/api/admin/school/years/${yearId}/groups`, { names: ["Les Lapins"] });
const { slug } = await client.request("POST", `/api/admin/school/groups/${groupId}/gallery`, {});
const gallery = await client.getGallery(slug);

// Trois rafales : 3 photos, 2 photos, 1 photo.
const base = Date.UTC(2026, 11, 3, 9, 0, 0);
const shots = [["#c98", 0], ["#c98", 2000], ["#c98", 4000], ["#89c", 60000], ["#89c", 62000], ["#9b8", 120000]];
let position = 0;
for (const [color, offset] of shots) {
  const input = await sharp({ create: { width: 800, height: 1000, channels: 3, background: color } }).jpeg().toBuffer();
  const { photo, tiles } = await processPhoto(input, { galleryId: gallery.gallery.id, forensicKey: "cle-de-test-pack", watermarkText: "Test", position: position++ });
  await client.addPhoto(slug, { ...photo, takenAt: base + offset });
  for (const t of tiles) await client.putTile(photo.id, t.level, t.col, t.row, t.buffer);
  await client.putOriginal(photo.id, input);
}
await client.request("POST", `/api/admin/school/groups/${groupId}/arrange`, {});
await client.request("POST", `/api/admin/school/years/${yearId}`, { status: "open", orderDeadline: "2030-12-20" });
await client.request("POST", `/api/admin/school/years/${yearId}/products`, { kind: "tirage", scope: "portrait", name: "Tirage 13×18", price: "8" });
await client.request("POST", `/api/admin/school/years/${yearId}/products`, { kind: "numerique", scope: "portrait", name: "Fichier numérique HD", price: "10" });

/* ---------- API : garde-fous ---------- */

const post = (path, body) => fetch(`${API}/api/admin${path}`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${client.token}` }, body: JSON.stringify(body),
});
const pochettePack = await post(`/school/years/${yearId}/products`, { kind: "pochette", scope: "all", name: "Pochette de tout", price: "30" });
check("un pack « toutes les photos » en pochette est refusé", pochettePack.status === 400, (await pochettePack.json()).error);
const noNames = await post(`/school/groups/${groupId}/names`, { text: "  \n " });
check("une liste de prénoms vide est refusée", noNames.status === 400, (await noNames.json()).error);

/* ---------- Tableau de bord ---------- */

const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ["--disable-features=LocalNetworkAccessChecks"],
});
const exceptions = [];
const admin = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
admin.on("pageerror", (err) => exceptions.push("admin: " + String(err)));
await admin.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await admin.goto(BASE, { waitUntil: "domcontentloaded" });
await admin.fill('#ad-login-form [name="email"]', account.email);
await admin.fill('#ad-login-form [name="password"]', account.password);
await admin.click("#ad-login-submit");
await admin.waitForSelector("#ad-tab-school:not([hidden])", { timeout: 10000 });

// Liste de prénoms collée depuis un tableur (en-tête, « Prénom;Nom », ligne en trop).
await admin.goto(`${BASE}/#/scolaire/groupe/${encodeURIComponent(groupId)}`, { waitUntil: "domcontentloaded" });
await admin.waitForSelector(".ad-sc-names", { timeout: 10000 });
await admin.click(".ad-sc-names summary");
await admin.fill("#ad-sc-names-text", "Prénom;Nom\nLéo;Martin\nEmma\nJules\nInès");
if (SHOTS) await admin.screenshot({ path: join(SHOTS, "pack-01-prenoms.png"), fullPage: true });
await admin.click("#ad-sc-names-save");
await admin.waitForFunction(() => /3 enfants nommés/.test(document.body.innerText), null, { timeout: 10000 });
check("prénoms collés : 3 enfants nommés, la ligne en trop signalée", /1 ligne en trop/.test(await admin.innerText("body")));
let detail = await client.request("GET", `/api/admin/school/groups/${groupId}`);
const named = detail.children.slice().sort((a, b) => a.number - b.number).map((c) => c.firstName);
check("dans l'ordre des numéros, en-tête ignoré, « Léo;Martin » devient « Léo Martin »",
      named.join(",") === "Léo Martin,Emma,Jules", named.join(","));
await admin.waitForSelector("[data-child-name]");
const inputs = await admin.$$eval("[data-child-name]", (els) => els.map((e) => e.value));
check("la grille de vérification montre les nouveaux prénoms", inputs.includes("Léo Martin") && inputs.includes("Jules"), inputs.join(","));

// Pack créé depuis le formulaire, puis remonté en tête de gamme.
await admin.goto(`${BASE}/#/scolaire/${encodeURIComponent(school.id)}/${encodeURIComponent(yearId)}`, { waitUntil: "domcontentloaded" });
await admin.waitForSelector("#ad-sc-add-product", { timeout: 10000 });
const scopes = await admin.$$eval('#ad-sc-add-product [name="scope"] option', (o) => o.map((x) => x.value));
check("le formulaire propose le pack « toutes les photos de l'enfant »", scopes.includes("all"), scopes.join(","));
await admin.fill('#ad-sc-add-product [name="name"]', "Toutes les photos en numérique");
await admin.selectOption('#ad-sc-add-product [name="kind"]', "numerique");
await admin.selectOption('#ad-sc-add-product [name="scope"]', "all");
await admin.fill('#ad-sc-add-product [name="price"]', "25");
await admin.click('#ad-sc-add-product [type="submit"]');
await admin.waitForFunction(() => document.querySelectorAll(".ad-sc-products > li").length === 3);
const names = () => admin.$$eval('.ad-sc-products > li [data-pfield="name"]', (els) => els.map((e) => e.value));
check("le pack s'ajoute en fin de gamme, marqué comme tel",
      (await names()).at(-1) === "Toutes les photos en numérique" && (await admin.innerText(".ad-sc-products > li:last-child")).includes("pack"));
for (let i = 0; i < 2; i++) {
  await admin.locator(".ad-sc-products > li", { has: admin.locator('[data-pfield="name"][value="Toutes les photos en numérique"]') }).locator('[data-move="-1"]').click();
  await admin.waitForTimeout(700);
}
await admin.waitForFunction(() => document.querySelector('.ad-sc-products > li [data-pfield="name"]').value === "Toutes les photos en numérique", null, { timeout: 10000 });
check("deux clics sur ↑ : le pack passe en tête", (await names()).join(" | ") === "Toutes les photos en numérique | Tirage 13×18 | Fichier numérique HD", (await names()).join(" | "));
await admin.locator(".ad-sc-products > li").first().locator('[data-move="-1"]').click();
await admin.waitForTimeout(500);
check("↑ sur le premier : rien ne bouge", (await names())[0] === "Toutes les photos en numérique");
let shop = await client.request("GET", `/api/admin/school/years/${yearId}/shop`);
check("l'ordre est enregistré", shop.products.map((p) => p.name)[0] === "Toutes les photos en numérique");
if (SHOTS) await admin.screenshot({ path: join(SHOTS, "pack-02-gamme.png"), fullPage: true });
const pack = shop.products.find((p) => p.scope === "all");

/* ---------- Espace famille ---------- */

const coupons = await client.request("POST", `/api/admin/school/years/${yearId}/coupons`, {});
const leo = coupons.groups[0].children.find((c) => c.firstName === "Léo Martin");
detail = await client.request("GET", `/api/admin/school/groups/${groupId}`);
const leoPhotos = detail.photos.filter((p) => p.childId === leo.id);

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

await page.goto(`http://localhost:${SITE_PORT}/ecole?c=${leo.code}`, { waitUntil: "domcontentloaded" });
await page.fill("#ec-email", PARENT);
await page.click("#ec-access-submit");
await page.waitForSelector(".ec-product");
const first = page.locator(".ec-product").first();
check("la famille voit la gamme dans l'ordre choisi : le pack en premier, avec le nombre de photos",
      (await first.locator("h4").textContent()) === "Toutes les photos en numérique" && (await first.locator(".ec-product-kind").textContent()) === `Pack · ${leoPhotos.length} photos`,
      (await first.innerText()).replace(/\s+/g, " "));
await first.locator("[data-pack]").click();
await page.waitForSelector("#ec-cartbar:not([hidden])");
check("« Ajouter » met le pack au panier d'un clic, sans choisir de photo",
      (await page.textContent("#ec-cartbar-text")).includes("1 article") && (await page.textContent("#ec-cartbar-text")).includes("25,00"),
      await page.textContent("#ec-cartbar-text"));
await first.locator("[data-pack]").click();
check("un second clic ne l'ajoute pas deux fois", (await page.textContent("#ec-cartbar-text")).includes("1 article"));
await page.click("#ec-cartbar-open");
await page.waitForSelector("#ec-sheet:not([hidden]) .ec-cart-total");
check("le panier annonce « Toutes les photos (3) »", (await page.textContent(".ec-cart-lines")).includes("Toutes les photos (3)"));
if (SHOTS) await page.screenshot({ path: join(SHOTS, "pack-03-panier.png") });
await page.keyboard.press("Escape");

// Commande payée (comme après le webhook) : le pack est une ligne par photo.
const orderId = `sco_pack_${RUN}`;
const paidAt = Math.floor(Date.now() / 1000);
const share = [834, 833, 833];
await localSql(API, [
  `INSERT INTO school_orders (id, year_id, family_id, email, delivery, shipping_cents, amount_cents, fee_cents, status, stripe_session_id, created_at, paid_at)
   VALUES ('${orderId}', '${yearId}', (SELECT id FROM families WHERE email = '${PARENT}'), '${PARENT}', 'school', 0, 2500, 63, 'paid', 'cs_pack_${RUN}', ${paidAt}, ${paidAt})`,
  ...leoPhotos.map((p, i) => `INSERT INTO school_order_lines (id, order_id, child_id, group_id, product_id, photo_id, kind, name, description, price_cents, quantity, pack_size)
   VALUES ('sol_pack_${RUN}_${i}', '${orderId}', '${leo.id}', '${groupId}', '${pack.id}', '${p.id}', 'numerique', '${pack.name}', '', ${share[i]}, 1, ${leoPhotos.length})`),
].join("; "));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".ec-orders");
const orderLines = page.locator(".ec-order-lines > li");
check("chez la famille, le pack est un seul article : « 1 × Toutes les photos en numérique (3 photos) »",
      (await orderLines.count()) === 1 && (await orderLines.first().innerText()).includes("(3 photos)") && (await page.textContent(".ec-order-head")).includes("25,00"),
      (await orderLines.first().innerText()).replace(/\s+/g, " "));
const buttons = await page.$$eval(".ec-order-lines [data-download]", (els) => els.map((e) => e.textContent));
check("une photo à télécharger par bouton : Photo 1, Photo 2, Photo 3", buttons.join(",") === "Photo 1,Photo 2,Photo 3", buttons.join(","));
const [download] = await Promise.all([page.waitForEvent("download"), page.locator(".ec-order-lines [data-download]").nth(2).click()]);
const meta = await sharp(await readFile(await download.path())).metadata().catch(() => ({}));
check("chaque photo du pack se télécharge en pleine définition", meta.width === 800 && meta.height === 1000, `${meta.width}×${meta.height}`);
if (SHOTS) await page.screenshot({ path: join(SHOTS, "pack-04-commande.png"), fullPage: true });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
const token = await page.evaluate(() => JSON.parse(localStorage.getItem("holypixx-famille")).token);
await mobile.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await mobile.route(/workers\.dev\/api\//, async (route) => {
  const url = route.request().url().replace(/^https:\/\/[^/]+/, API);
  const upstream = await fetch(url, { method: route.request().method(), headers: route.request().headers(), body: route.request().postData() || undefined });
  await route.fulfill({ status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") || "application/json", "access-control-allow-origin": "*" }, body: Buffer.from(await upstream.arrayBuffer()) });
});
await mobile.goto(`http://localhost:${SITE_PORT}/ecole`, { waitUntil: "domcontentloaded" });
await mobile.evaluate((t) => localStorage.setItem("holypixx-famille", JSON.stringify({ token: t, exp: Date.now() + 3600e3 })), token);
await mobile.reload({ waitUntil: "domcontentloaded" });
await mobile.waitForSelector(".ec-orders");
check("sur téléphone, commandes et boutons de téléchargement tiennent dans la largeur",
      await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
if (SHOTS) await mobile.screenshot({ path: join(SHOTS, "pack-05-mobile.png"), fullPage: true });

check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

await browser.close();
site.close();

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
