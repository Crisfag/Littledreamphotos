// Envoi des commandes scolaires au labo, contre le vrai Worker local et un
// FAUX BePhoto (127.0.0.1:8791, rien n'est imprimé) : connexion du compte,
// catalogue, composition labo des produits, lots (un article ne part
// qu'une fois), envoi pas à pas avec reconnexion quand le jeton expire,
// fichiers téléchargés par le labo via leur adresse signée, cloisonnement ;
// puis l'écran « Envois au labo » du tableau de bord.
//
//   BEPHOTO_API_BASE="http://127.0.0.1:8791" dans worker/.dev.vars
//   npm run dev:local                      (depuis worker/)
//   node admin-server.mjs                  (depuis tools/, GALERIE_API=http://127.0.0.1:8788)
//   node tests/schoollab.test.mjs          (depuis tools/)

import { chromium } from "playwright";
import sharp from "sharp";
import { createServer } from "node:http";
import { WorkerClient } from "../lib/client.mjs";
import { processPhoto } from "../lib/pipeline.mjs";
import { createTestAccount, localSql } from "./lib/testAccount.mjs";
import { labFilename, normalizeLabItems, normalizeProducts, BEPHOTO_PLANCHES, plancheSheet, previewForLabItems } from "../../worker/src/bephoto.js";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const LAB_PORT = 8791;

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

/* ---------- Sans réseau : noms de fichiers, composition, catalogue ---------- */

check("le nom de fichier trie par groupe puis par enfant, en ASCII",
      labFilename({ groupIndex: 1, groupName: "P2 B", childNumber: 7, childFirstName: "Léa", productName: "Pochette Classique", part: "Tirage 13×18" }) ===
      "01_P2-B_007_Lea_Pochette-Classique_Tirage-13x18.jpg");
check("composition : papier inconnu, quantité absurde ou trop d'éléments refusés",
      normalizeLabItems([{ idproduct: 3, idpaper: 9, quantity: 1 }]).error && normalizeLabItems([{ idproduct: 3, idpaper: 1, quantity: 0 }]).error &&
      normalizeLabItems(Array.from({ length: 13 }, () => ({ idproduct: 3, idpaper: 1, quantity: 1 }))).error &&
      normalizeLabItems([{ idproduct: "3", idpaper: "2", quantity: "4", label: " 13x18 " }]).items[0].label === "13x18");
check("catalogue : chaînes converties, prix en centimes",
      JSON.stringify(normalizeProducts([{ idproduct: "12", product: "Tirage", dimensions: "127x178", prices: [{ price: "0.35", idpaper: "1" }] }])) ===
      JSON.stringify([{ idproduct: 12, name: "Tirage", dimensions: "127x178", prices: [{ idpaper: 1, cents: 35 }] }]));

check("planches : 26 références, formats de feuille lisibles (305 mm = 30 cm), visuel de la première planche d'une composition",
      BEPHOTO_PLANCHES.length === 26 && new Set(BEPHOTO_PLANCHES.map((p) => p.id)).size === 26 &&
      BEPHOTO_PLANCHES.every((p) => p.label && plancheSheet(p)) && plancheSheet(BEPHOTO_PLANCHES.find((p) => p.id === 118)) === "20×30" &&
      previewForLabItems([{ idproduct: 102 }, { idproduct: 1120 }, { idproduct: 1054 }]) === "/api/lab-previews/bephoto/1054.jpg" && previewForLabItems([]) === "");

/* ---------- Faux BePhoto ---------- */

const LAB_EMAIL = "labo@test.invalid";
const LAB_PASSWORD = "bon-mot-de-passe";
const lab = { logins: 0, token: "", orders: new Map(), downloads: [], expireAfterFirstAdd: true, previewFetches: 0 };
const CATALOGUE = [
  { idproduct: "101", product: "Tirage 13x18", dimensions: "127x178", prices: [{ price: "0.45", idpaper: "1" }, { price: "0.50", idpaper: "2" }] },
  { idproduct: "102", product: "Tirage 9x13", dimensions: "89x127", prices: [{ price: "0.25", idpaper: "1" }] },
  { idproduct: "103", product: "Tirage 20x30", dimensions: "203x305", prices: [{ price: "2.10", idpaper: "1" }, { price: "2.30", idpaper: "2" }] },
];
const labServer = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const data = body ? JSON.parse(body) : null;
  const reply = (status, payload) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); };
  const authed = req.headers.authorization === `Bearer ${lab.token}` && lab.token;
  if (req.method === "GET" && req.url.startsWith("/images/products/formats/montages/")) {
    lab.previewFetches++;
    res.writeHead(200, { "content-type": "image/jpeg" });
    return res.end(await sharp({ create: { width: 120, height: 170, channels: 3, background: "#123a6e" } }).jpeg().toBuffer());
  }
  if (req.method === "POST" && req.url === "/user/login") {
    if (data?.email !== LAB_EMAIL || data?.password !== LAB_PASSWORD) return reply(401, { error: "Unauthorized" });
    lab.logins++;
    lab.token = `tok-${lab.logins}`;
    return reply(200, { status: 1, token: lab.token });
  }
  if (!authed) return reply(401, { error: "Unauthorized" });
  if (req.method === "GET" && req.url === "/products") return reply(200, { status: 1, products: CATALOGUE });
  if (req.method === "POST" && req.url === "/orders") {
    const id = 500 + lab.orders.size + 1;
    lab.orders.set(String(id), { metadata: data.metadata, lines: [], closed: false });
    return reply(200, { status: 1, order: [{ idorder: id, metadata: data.metadata }] });
  }
  const m = /^\/orders\/(\d+)(\/products|\/close)?$/.exec(req.url);
  const order = m && lab.orders.get(m[1]);
  if (!order) return reply(404, { error: "Commande inconnue" });
  if (req.method === "POST" && m[2] === "/products") {
    if (order.closed) return reply(400, { error: "Commande fermée" });
    order.lines.push(data);
    // Le labo vient chercher le fichier, comme le vrai.
    const file = await fetch(data.fileurl);
    const bytes = Buffer.from(await file.arrayBuffer());
    lab.downloads.push({ status: file.status, size: bytes.length, announced: data.filesize, type: file.headers.get("content-type") });
    if (lab.expireAfterFirstAdd) { lab.expireAfterFirstAdd = false; lab.token = "expire"; }
    return reply(200, { status: 1 });
  }
  if (req.method === "POST" && m[2] === "/close") { order.closed = true; return reply(200, { status: 1 }); }
  if (req.method === "GET" && !m[2]) return reply(200, { status: 1, order: [{ idorder: Number(m[1]), totalorder: "12.40", totalcost: "15.90", shippingmethod: "bpost" }] });
  return reply(404, { error: "?" });
});
await new Promise((resolve) => labServer.listen(LAB_PORT, "127.0.0.1", resolve));

/* ---------- Une école, une classe, deux enfants, une photo de classe ---------- */

const account = await createTestAccount(API, "labo", { plan: "studio" });
const RUN = Date.now().toString(36);
const client = new WorkerClient({ api: API, ...account });
async function call(method, path, body) {
  if (!client.token) await client.login();
  const r = await fetch(API + path, {
    method, headers: { authorization: `Bearer ${client.token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const school = await client.request("POST", "/api/admin/school/schools", { kind: "ecole", name: "École du labo", address: "Rue de l'École 1, 4000 Liège" });
const yearId = school.yearId;
const { ids: [groupId] } = await client.request("POST", `/api/admin/school/years/${yearId}/groups`, { names: ["P2"] });
const { slug } = await client.request("POST", `/api/admin/school/groups/${groupId}/gallery`, {});
const gallery = await client.getGallery(slug);
const base = Date.UTC(2026, 9, 7, 9, 0, 0);
let position = 0;
for (const [color, offset] of [["#c98", 0], ["#c98", 2000], ["#89c", 40000], ["#89c", 42000], ["#bbb", 600000]]) {
  const input = await sharp({ create: { width: 800, height: 1000, channels: 3, background: color } }).jpeg().toBuffer();
  const { photo, tiles } = await processPhoto(input, { galleryId: gallery.gallery.id, forensicKey: "cle-de-test-labo", watermarkText: "Test", position: position++ });
  await client.addPhoto(slug, { ...photo, takenAt: base + offset });
  for (const t of tiles) await client.putTile(photo.id, t.level, t.col, t.row, t.buffer);
  await client.putOriginal(photo.id, input);
}
await client.request("POST", `/api/admin/school/groups/${groupId}/arrange`, {});
let detail = await client.request("GET", `/api/admin/school/groups/${groupId}`);
const lonely = detail.children.find((c) => detail.photos.filter((p) => p.childId === c.id).length === 1);
await client.request("POST", `/api/admin/school/groups/${groupId}/assign`, { photoIds: detail.photos.filter((p) => p.childId === lonely.id).map((p) => p.id), to: "group" });
detail = await client.request("GET", `/api/admin/school/groups/${groupId}`);
const [kidA, kidB] = detail.children;
await client.request("POST", `/api/admin/school/children/${kidA.id}`, { firstName: "Léa" });
const photosOf = (id) => detail.photos.filter((p) => p.childId === id);
const groupPhoto = detail.photos.find((p) => !p.childId);
await client.request("POST", `/api/admin/school/years/${yearId}/starter-products`, {});
await client.request("POST", `/api/admin/school/years/${yearId}`, { status: "open", orderDeadline: "2030-06-04", lateDeadline: "2030-07-01" });
const shop = await client.request("GET", `/api/admin/school/years/${yearId}/shop`);
const productNamed = (n) => shop.products.find((p) => p.name === n);

/* ---------- Compte BePhoto et catalogue ---------- */

const offlineCatalogue = await call("GET", "/api/admin/school/lab/catalogue");
const p1051 = offlineCatalogue.body.planches?.find((p) => p.idproduct === 1051);
check("sans compte BePhoto, les 26 planches de la grille publique sont proposées, en français, avec visuel et prix",
      offlineCatalogue.status === 200 && offlineCatalogue.body.planches.length === 26 && offlineCatalogue.body.others.length === 0 &&
      p1051.name === "3 photos 6×9 + 4 photos d'identité" && p1051.sheet === "13×18" && p1051.preview === "/api/lab-previews/bephoto/1051.jpg" &&
      p1051.minCents === 32 && p1051.maxCents === 65, JSON.stringify(p1051));
const preview1 = await fetch(`${API}/api/lab-previews/bephoto/1051.jpg`);
const previewBytes = Buffer.from(await preview1.arrayBuffer());
const fetchesAfterFirst = lab.previewFetches;
const preview2 = await fetch(`${API}/api/lab-previews/bephoto/1051.jpg`);
await preview2.arrayBuffer();
check("le visuel d'une planche est recopié une fois chez Holypixx, puis servi depuis chez nous",
      preview1.status === 200 && preview1.headers.get("content-type") === "image/jpeg" && previewBytes.length > 100 &&
      preview2.status === 200 && fetchesAfterFirst <= 1 && lab.previewFetches === fetchesAfterFirst, `${lab.previewFetches} téléchargement(s) chez le labo`);
const unknownPreview = await fetch(`${API}/api/lab-previews/bephoto/999.jpg`);
const noVisual = await fetch(`${API}/api/lab-previews/bephoto/1120.jpg`);
const traversal = await fetch(`${API}/api/lab-previews/bephoto/..%2F..%2Fsecret.jpg`);
check("seules les planches connues ont un visuel (jamais un relais ouvert)", unknownPreview.status === 404 && noVisual.status === 404 && traversal.status === 404);

const noAccount = await call("GET", "/api/admin/school/lab/products");
check("sans compte BePhoto, le catalogue n'est pas accessible (message clair)", noAccount.status === 409 && /Connectez/.test(noAccount.body.error), noAccount.body.error);
const wrong = await call("POST", "/api/admin/school/lab", { email: LAB_EMAIL, password: "faux" });
check("un mauvais mot de passe BePhoto est refusé à la connexion", wrong.status === 400 && /refuse/.test(wrong.body.error), wrong.body.error);
const connected = await call("POST", "/api/admin/school/lab", { email: LAB_EMAIL, password: LAB_PASSWORD });
const accountView = await call("GET", "/api/admin/school/lab");
check("le compte se connecte ; le mot de passe n'est jamais renvoyé",
      connected.status === 200 && accountView.body.connected && accountView.body.email === LAB_EMAIL && !JSON.stringify(accountView.body).includes(LAB_PASSWORD));
const exported = await call("GET", "/api/admin/account/export");
check("l'export RGPD du compte ne contient ni le mot de passe ni le jeton BePhoto",
      exported.status === 200 && !JSON.stringify(exported.body).includes(LAB_PASSWORD) && !JSON.stringify(exported.body).includes("bephoto_password_enc") &&
      !JSON.stringify(exported.body).includes("bephoto_token_enc"));
const catalogue = await call("GET", "/api/admin/school/lab/products");
check("le catalogue BePhoto se lit, prix en centimes par papier",
      catalogue.status === 200 && catalogue.body.products.length === 3 && catalogue.body.products[0].prices[1].cents === 50);
const onlineCatalogue = await call("GET", "/api/admin/school/lab/catalogue");
check("compte connecté : les tirages du catalogue BePhoto s'ajoutent aux planches",
      onlineCatalogue.body.planches.length === 26 && onlineCatalogue.body.others.length === 3 && onlineCatalogue.body.connected === true);

/* ---------- Composition labo des produits ---------- */

const onDigital = await call("POST", `/api/admin/school/products/${productNamed("Fichier numérique HD").id}/lab`, { items: [{ idproduct: 101, idpaper: 1, quantity: 1 }] });
const badPaper = await call("POST", `/api/admin/school/products/${productNamed("Pochette Classique").id}/lab`, { items: [{ idproduct: 101, idpaper: 7, quantity: 1 }] });
const pochette = await call("POST", `/api/admin/school/products/${productNamed("Pochette Classique").id}/lab`, {
  items: [{ idproduct: 101, idpaper: 1, quantity: 1, label: "Tirage 13x18" }, { idproduct: 102, idpaper: 1, quantity: 2, label: "Tirage 9x13" }],
});
await call("POST", `/api/admin/school/products/${productNamed("Photo de groupe 20×30").id}/lab`, { items: [{ idproduct: 103, idpaper: 2, quantity: 1, label: "Tirage 20x30" }] });
check("composition : refusée pour un fichier numérique ou un papier inconnu, enregistrée pour une pochette",
      onDigital.status === 400 && badPaper.status === 400 && pochette.status === 200 && pochette.body.labItems.length === 2);
await call("POST", `/api/admin/school/products/${productNamed("Pochette Famille").id}/lab`, {
  items: [{ idproduct: 102, idpaper: 1, quantity: 1, label: "Tirage 9x13" }, { idproduct: 165, idpaper: 1, quantity: 1, label: "Planche 18×24 n°165" }],
});
const shopAfter = (await call("GET", `/api/admin/school/years/${yearId}/shop`)).body;
check("le visuel d'un produit est celui de la première planche de sa composition",
      shopAfter.products.find((p) => p.name === "Pochette Famille").preview === "/api/lab-previews/bephoto/165.jpg" &&
      shopAfter.products.find((p) => p.name === "Pochette Classique").preview === "");

/* ---------- Commandes payées (comme après Stripe) ---------- */

await localSql(API, `INSERT INTO families (id, email, created_at) VALUES ('fam_lab_${RUN}', 'parent-labo-${RUN}@test.invalid', 0)`);
const paid = Math.floor(Date.now() / 1000);
const order = (id, delivery) => `INSERT INTO school_orders (id, year_id, family_id, email, delivery, shipping_cents, amount_cents, fee_cents, status, stripe_session_id, created_at, paid_at, shipping_name, shipping_address)
  VALUES ('${id}', '${yearId}', 'fam_lab_${RUN}', 'parent-labo-${RUN}@test.invalid', '${delivery}', 0, 5000, 100, 'paid', 'cs_${id}', ${paid}, ${paid}, '${delivery === "home" ? "Marie Dupont" : ""}', '${delivery === "home" ? '{"line1":"Rue Haute 3","postal_code":"4000","city":"Liège","country":"BE"}' : ""}')`;
const line = (id, orderId, kid, product, photo, kind, qty) =>
  `INSERT INTO school_order_lines (id, order_id, child_id, group_id, product_id, photo_id, kind, name, description, price_cents, quantity)
   VALUES ('${id}', '${orderId}', '${kid}', '${groupId}', '${product.id}', '${photo}', '${kind}', '${product.name}', '', ${product.priceCents}, ${qty})`;
await localSql(API, [
  order(`sco1_${RUN}`, "school"), order(`sco2_${RUN}`, "school"), order(`sco3_${RUN}`, "home"),
  line(`sl1_${RUN}`, `sco1_${RUN}`, kidA.id, productNamed("Pochette Classique"), photosOf(kidA.id)[1].id, "pochette", 2),
  line(`sl2_${RUN}`, `sco1_${RUN}`, kidB.id, productNamed("Fichier numérique HD"), photosOf(kidB.id)[0].id, "numerique", 1),
  line(`sl3_${RUN}`, `sco2_${RUN}`, kidB.id, productNamed("Photo de groupe 20×30"), groupPhoto.id, "tirage", 1),
  line(`sl4_${RUN}`, `sco3_${RUN}`, kidA.id, productNamed("Tirage 13×18"), photosOf(kidA.id)[0].id, "tirage", 1),
].join("; "));

/* ---------- Lots ---------- */

let batches = (await call("GET", `/api/admin/school/years/${yearId}/batches`)).body;
check("en attente : 2 articles imprimables pour l'école (le numérique ne part pas au labo), 1 à domicile",
      batches.pending.school.lines === 2 && batches.pending.school.quantity === 3 && batches.pending.school.children === 2 && batches.pending.home.lines === 1,
      JSON.stringify(batches.pending));
check("les produits en vente sans composition labo sont signalés", batches.unmappedProducts.includes("Tirage 13×18"), batches.unmappedProducts.join(", "));
const lot1 = await call("POST", `/api/admin/school/years/${yearId}/batches`, { delivery: "school" });
const lotAgain = await call("POST", `/api/admin/school/years/${yearId}/batches`, { delivery: "school" });
const lotHome = await call("POST", `/api/admin/school/years/${yearId}/batches`, { delivery: "home" });
check("un lot regroupe tout ce qui attend ; rien ne peut entrer dans deux lots",
      lot1.status === 201 && lot1.body.number === 1 && lotAgain.status === 400 && lotHome.status === 201 && lotHome.body.number === 2);
const homeSend = await call("POST", `/api/admin/school/batches/${lotHome.body.id}/send`, {});
check("un lot à domicile ne part pas par l'API (pas de champ adresse chez BePhoto) : message clair",
      homeSend.status === 409 && /adresse/.test(homeSend.body.error), homeSend.body.error);
const production = await call("POST", `/api/admin/school/years/${yearId}/production`, { batchId: lotHome.body.id });
check("le fichier d'un lot à domicile ne contient que ce lot, avec l'adresse de la famille",
      production.status === 200 && production.body.lines.length === 1 && production.body.batch.number === 2 && production.body.lines[0].shippingAddress.city === "Liège");

/* ---------- Envoi à BePhoto, pas à pas ---------- */

const steps = [];
for (let i = 0; i < 20; i++) {
  const step = await call("POST", `/api/admin/school/batches/${lot1.body.id}/send`, {});
  steps.push(step);
  if (step.status !== 200 || step.body.done) break;
}
const labOrder = lab.orders.get("501");
const last = steps.at(-1);
check("l'envoi se fait pas à pas jusqu'au bout", last.status === 200 && last.body.done === true && steps.length >= 2,
      steps.map((s) => s.status + ":" + (s.body.sent ?? "") + "/" + (s.body.total ?? "")).join(" "));
check("BePhoto reçoit une commande annotée (établissement, année, lot, adresse de livraison)",
      labOrder && /École du labo/.test(labOrder.metadata) && /Lot 1/.test(labOrder.metadata) && /Rue de l'École 1/.test(labOrder.metadata), labOrder?.metadata);
check("chaque article devient ses tirages : 2 pochettes = 2 × 13×18 + 4 × 9×13, plus la photo de classe en lustré",
      labOrder.lines.length === 3 &&
      labOrder.lines.some((l) => l.idproduct === 101 && l.quantity === 2 && l.idpaper === 1) &&
      labOrder.lines.some((l) => l.idproduct === 102 && l.quantity === 4) &&
      labOrder.lines.some((l) => l.idproduct === 103 && l.quantity === 1 && l.idpaper === 2),
      JSON.stringify(labOrder.lines.map((l) => [l.idproduct, l.quantity, l.idpaper])));
check("les noms de fichiers rangent par classe et par enfant",
      labOrder.lines.every((l) => /^01_P2_00\d_/.test(l.filename)) && labOrder.lines.some((l) => l.filename.startsWith("01_P2_001_Lea_Pochette-Classique")),
      labOrder.lines.map((l) => l.filename).join(", "));
check("le labo télécharge chaque fichier d'impression par son adresse signée (taille annoncée exacte)",
      lab.downloads.length === 3 && lab.downloads.every((d) => d.status === 200 && d.size === d.announced && d.type === "image/jpeg"),
      JSON.stringify(lab.downloads));
check("quand le jeton BePhoto expire en route, Holypixx se reconnecte seul et poursuit",
      lab.logins === 2 && lab.token === "tok-2" && labOrder.lines.length === 3, `${lab.logins} connexions`);
check("la commande est confirmée (fermée) chez BePhoto", labOrder.closed === true);
batches = (await call("GET", `/api/admin/school/years/${yearId}/batches`)).body;
const sentLot = batches.batches.find((b) => b.id === lot1.body.id);
check("le lot est marqué parti, avec le numéro BePhoto et le total annoncé",
      sentLot.status === "sent" && sentLot.labOrderId === "501" && sentLot.labTotal?.totalCost === "15.90" && batches.pending.school.lines === 0);
const resend = await call("POST", `/api/admin/school/batches/${lot1.body.id}/send`, {});
const cancelSent = await call("DELETE", `/api/admin/school/batches/${lot1.body.id}`);
check("un lot parti ne repart pas et ne s'annule plus", resend.body.done === true && lab.orders.size === 1 && cancelSent.status === 409);

const fileUrl = labOrder.lines[0].fileurl;
const forged = await fetch(fileUrl.replace(/s=[^&]+/, "s=faux"));
const otherPhoto = await fetch(fileUrl.replace(encodeURIComponent(labOrder.lines[0].fileurl.split("/").at(-1).split(".jpg")[0]), photosOf(kidB.id)[0].id));
check("une adresse de fichier falsifiée, ou vers une autre photo, ne livre rien", forged.status === 403 && otherPhoto.status === 403);

const cancelHome = await call("DELETE", `/api/admin/school/batches/${lotHome.body.id}`);
batches = (await call("GET", `/api/admin/school/years/${yearId}/batches`)).body;
check("annuler un lot pas encore parti remet ses articles en attente", cancelHome.status === 200 && batches.pending.home.lines === 1 && batches.batches.length === 1);

const other = await createTestAccount(API, "labo-autre", { plan: "studio" });
const otherClient = new WorkerClient({ api: API, ...other });
await otherClient.login();
const peek = await fetch(`${API}/api/admin/school/batches/${lot1.body.id}/send`, { method: "POST", headers: { authorization: `Bearer ${otherClient.token}` } });
const peekProduct = await fetch(`${API}/api/admin/school/products/${productNamed("Pochette Classique").id}/lab`, {
  method: "POST", headers: { authorization: `Bearer ${otherClient.token}`, "content-type": "application/json" }, body: JSON.stringify({ items: [] }),
});
check("un autre photographe n'atteint ni les lots ni la composition", peek.status === 404 && peekProduct.status === 404);

/* ---------- Tableau de bord ---------- */

const browser = await chromium.launch({ ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}), args: ["--disable-features=LocalNetworkAccessChecks"] });
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.fill('#ad-login-form [name="email"]', account.email);
await page.fill('#ad-login-form [name="password"]', account.password);
await page.click("#ad-login-submit");
await page.waitForSelector("#ad-tab-school:not([hidden])", { timeout: 10000 });
await page.goto(`${BASE}/#/scolaire/${encodeURIComponent(school.id)}/${encodeURIComponent(yearId)}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-sc-lab .ad-sc-pending", { timeout: 15000 });
const labText = await page.textContent("#ad-sc-lab");
check("l'écran « Envois au labo » montre l'attente, le lot parti chez BePhoto et le compte connecté",
      /Lot 1/.test(labText) && /BePhoto n° 501/.test(labText) && /Compte BePhoto connecté/.test(labText) && /1 article/.test(labText), labText.replace(/\s+/g, " ").slice(0, 200));
const pochetteRow = page.locator(".ad-sc-products > li", { has: page.locator('[data-pfield="name"][value="Pochette Classique"]') });
check("chaque produit montre ce que le labo imprime", (await pochetteRow.locator(".ad-sc-prod-lab").textContent()).includes("2× Tirage 9x13"));
await pochetteRow.locator("[data-lab-product]").click();
await pochetteRow.locator(".ad-sc-lab-row").first().waitFor();
const editorText = await pochetteRow.locator(".ad-sc-lab-editor").textContent();
check("l'éditeur de composition affiche le coût labo et la marge", /Coût labo ≈ 0,95/.test(editorText) && /marge ≈ 21,05/.test(editorText), editorText.replace(/\s+/g, " ").slice(-140));
const famRow = page.locator(".ad-sc-products > li", { has: page.locator('[data-pfield="name"][value="Photo de groupe 20×30"]') });
await famRow.locator("[data-lab-product]").click();
await famRow.locator(".ad-vsel-btn").first().click();
await famRow.locator('.ad-vsel [role="option"][data-value="420"]').waitFor();
const groupsShown = await famRow.locator(".ad-vsel-group").allTextContents();
const thumbs = await famRow.locator('.ad-vsel [role="option"] img').count();
if (process.env.SCREENSHOT_DIR) {
  await page.waitForTimeout(800);
  await famRow.screenshot({ path: `${process.env.SCREENSHOT_DIR}/ecole-labo-menu.png` });
  await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/ecole-labo-menu-page.png` });
}
await famRow.locator('.ad-vsel [role="option"][data-value="118"]').click();
await famRow.locator("[data-lab-cost]").waitFor();
check("éditeur : menu déroulant illustré (planches avec vignette, puis tirages), coût et marge mis à jour",
      groupsShown.join("|") === "Planches composées par le labo|Tirages et autres produits BePhoto" && thumbs === 24 &&
      /Coût labo ≈ 1,20 € à 2,19 €/.test(await famRow.locator("[data-lab-cost]").textContent()), `${thumbs} vignettes`);
await famRow.locator("[data-save-lab]").click();
await page.waitForFunction(() => [...document.querySelectorAll(".ad-sc-products > li")].some((li) => li.querySelector(".ad-sc-prod-thumb") && li.textContent.includes("Planche 20×30 n°118")));
check("après enregistrement, le produit montre la vignette de sa planche", true);
await page.click('[data-new-batch="home"]');
await page.waitForSelector('[data-cancel-batch]');
check("« Préparer un lot » crée le lot depuis l'écran (le numéro d'un lot annulé est repris)",
      /Lot 2\s*À domicile/.test(await page.textContent("#ad-sc-lab tbody")), (await page.textContent("#ad-sc-lab tbody")).replace(/\s+/g, " ").slice(0, 120));
if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/ecole-labo.png`, fullPage: true });
check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

await browser.close();
labServer.close();

const disconnected = await call("DELETE", "/api/admin/school/lab");
check("le compte BePhoto se déconnecte", disconnected.status === 200 && disconnected.body.connected === false);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
