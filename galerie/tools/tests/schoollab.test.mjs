// Envoi des commandes scolaires au labo, contre le vrai Worker local et un
// FAUX BePhoto (127.0.0.1:8791, rien n'est imprimé) qui suit la
// documentation de novembre 2026 : connexion du compte (mot de passe puis
// clé d'API), catalogue (montages compris), composition labo des produits,
// lots (un article ne part qu'une fois), simulation de prix, envoi pas à pas
// (une enveloppe par enfant, adresse de l'établissement, une commande par
// famille livrée chez elle), prix et frais d'enveloppe annoncés avant la
// confirmation du photographe, reconnexion quand le jeton expire, fichiers
// téléchargés par le labo via leur adresse signée, cloisonnement ; puis
// l'écran « Envois au labo » du tableau de bord.
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
import {
  labFilename, normalizeLabItems, normalizeProducts, BEPHOTO_PLANCHES, plancheSheet, previewForLabItems, envelopeLabel, backprintText,
  parseAddressText, labShippingAddress, summarizePrice, aggregateLabItems,
} from "../../worker/src/bephoto.js";
import { buildLabPlan } from "../../worker/src/schoollab.js";

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
check("catalogue (ancien format) : chaînes converties, prix en centimes",
      JSON.stringify(normalizeProducts([{ idproduct: "12", product: "Tirage", dimensions: "127x178", prices: [{ price: "0.35", idpaper: "1" }] }])) ===
      JSON.stringify([{ idproduct: 12, name: "Tirage", dimensions: "127x178", montage: false, prices: [{ idpaper: 1, cents: 35 }] }]));
check("catalogue (format actuel) : objet par idformat, dimensions en mm, prix par papier, montages reconnus",
      JSON.stringify(normalizeProducts({
        "2001": { idformat: "2001", format: "Pochette", largeur: "152", hauteur: "210", prix: { "1": "1.90" }, idtypeformat: "100" },
        "12": { idformat: 12, format: "Tirage 10x15", largeur: 102, hauteur: 152, prix: { "1": "0.35", "2": "0.40" } },
      })) === JSON.stringify([
        { idproduct: 12, name: "Tirage 10x15", dimensions: "102x152", montage: false, prices: [{ idpaper: 1, cents: 35 }, { idpaper: 2, cents: 40 }] },
        { idproduct: 2001, name: "Pochette", dimensions: "152x210", montage: true, prices: [{ idpaper: 1, cents: 190 }] },
      ]));
check("enveloppe « classe - numéro prénom » (100 car.), dos des photos en 30 caractères, sans guillemets ni « / »",
      envelopeLabel({ groupName: "P2", childNumber: 7, childFirstName: "Léa" }) === "P2 - 007 Léa" &&
      envelopeLabel({ groupName: "3A/B", childNumber: 12, childFirstName: "" }) === "3A-B - 012" &&
      backprintText({ groupName: "P2", childNumber: 7, childFirstName: "Léa" }) === "P2 007 Léa" &&
      backprintText({ groupName: "Section des très grands", childNumber: 107, childFirstName: "Marie-Antoinette" }).length === 30);
const parsedA = parseAddressText("Rue de l'École 1, 4000 Liège");
const parsedB = parseAddressText("Avenue Louise 54\nBoîte 3\n1050 Ixelles\nBelgique");
const parsedC = parseAddressText("12 rue des Lilas, 75011 Paris");
const parsedD = parseAddressText("Dorpsstraat 4, 1012 AB Amsterdam");
check("adresse d'établissement en texte libre : rue, complément, code postal, localité, pays déduit ; incomplète = refusée",
      parsedA.adresse === "Rue de l'École 1" && parsedA.cp === "4000" && parsedA.localite === "Liège" && parsedA.pays === "BE" &&
      parsedB.complement_adresse === "Boîte 3" && parsedB.cp === "1050" && parsedB.pays === "BE" &&
      parsedC.pays === "FR" && parsedC.cp === "75011" && parsedD.pays === "NL" && parsedD.cp === "1012 AB" &&
      parseAddressText("Liège") === null && parseAddressText("") === null, JSON.stringify([parsedA, parsedB, parsedC, parsedD]));
const homeAddress = labShippingAddress("Marie Dupont", { line1: "Rue Haute 3", postal_code: "4000", city: "Liège", country: "be" }, { email: "p@test.invalid" });
check("adresse Stripe d'une famille → adresse BePhoto (prénom, nom, pays) ; incomplète = null",
      homeAddress.prenom === "Marie" && homeAddress.nom === "Dupont" && homeAddress.pays === "BE" && homeAddress.cp === "4000" && homeAddress.email === "p@test.invalid" &&
      labShippingAddress("Marie Dupont", { line1: "Rue Haute 3", city: "Liège" }) === null && labShippingAddress("", { line1: "x", postal_code: "1", city: "y" }) === null);
const price = summarizePrice({ products: [{ prix: "0.45", quantite: "2" }, { prix: "2.30", quantite: 1 }], suborders: [{ label: "P2 - 001", prints: 6, total: "1.9", fee: "0" }, { label: "P2 - 002", prints: 1, total: "2.3", fee: "1.50" }] });
check("prix annoncé : tirages, enveloppes, frais des enveloppes sous le minimum",
      price.productsCents === 320 && price.envelopes === 2 && price.feesCents === 150 && price.feeEnvelopeCount === 1 && price.feeEnvelopes[0].label === "P2 - 002" &&
      JSON.stringify(aggregateLabItems([{ idproduct: 1, idpaper: 1, quantity: 2 }, { idproduct: 1, idpaper: 1, quantity: 3 }, { idproduct: 1, idpaper: 2, quantity: 1 }])) ===
      JSON.stringify([{ idproduct: 1, idpaper: 1, quantity: 5 }, { idproduct: 1, idpaper: 2, quantity: 1 }]));
{
  const it = (envelope, orderId, extra = {}) => ({ photoId: "p", galleryId: "g", idproduct: 1, idpaper: 1, quantity: 1, filename: "f.jpg", envelope, label: `L-${envelope}`, backprint: `B-${envelope}`, orderId, ...extra });
  const batchSchool = { delivery: "school", number: 3, school_name: "École", year_label: "2026", school_address: "Rue A 1, 4000 Liège", school_contact: "", school_email: "" };
  const pickup = buildLabPlan(batchSchool, [it("c:1", "o1"), it("c:1", "o1"), it("c:2", "o2")], "pickup").plan;
  const toSchool = buildLabPlan(batchSchool, [it("c:1", "o1")], "school").plan;
  const noAddress = buildLabPlan({ ...batchSchool, school_address: "Liège" }, [it("c:1", "o1")], "school");
  const many = buildLabPlan(batchSchool, Array.from({ length: 23 }, () => it("c:1", "o1")), "account").plan;
  const addr = JSON.stringify({ line1: "Rue B 2", postal_code: "4000", city: "Liège", country: "BE" });
  const home = buildLabPlan({ ...batchSchool, delivery: "home" }, [
    it("c:1", "o1", { shippingName: "Ann Lee", shippingAddress: addr }), it("c:2", "o1", { shippingName: "Ann Lee", shippingAddress: addr }),
    it("c:3", "o2", { shippingName: "Bob Ray", shippingAddress: addr }),
  ], "home").plan;
  const homeBad = buildLabPlan({ ...batchSchool, delivery: "home" }, [it("c:1", "o1", { shippingName: "Ann Lee", shippingAddress: "" })], "home");
  check("plan d'envoi : enlèvement, adresse de l'établissement, une enveloppe par enfant, 10 produits par appel, confirmation avant fermeture",
      pickup.ops.map((o) => o.t).join(",") === "order,shipping,sub,add,sub,add,price,confirm,close" && pickup.ops[1].method === "PICKUP" && pickup.envelopes === 2 &&
      toSchool.ops.map((o) => o.t).join(",") === "order,address,sub,add,price,confirm,close" && toSchool.ops[1].address.societe === "École" &&
      noAddress.error && /établissement/.test(noAddress.error) &&
      many.ops.filter((o) => o.t === "add").map((o) => o.items.length).join(",") === "10,10,3" && !many.ops.some((o) => o.t === "address" || o.t === "shipping"),
      pickup.ops.map((o) => o.t).join(","));
  check("plan à domicile : une commande par famille avec son adresse, nom de l'enfant au dos, confirmation puis fermeture de chacune",
      home.orders === 2 && home.ops.map((o) => o.t).join(",") === "order,address,add,price,order,address,add,price,confirm,close,close" &&
      home.ops[2].items.map((i) => i.backprint).join("|") === "B-c:1|B-c:2" && home.ops[1].address.nom === "Lee" &&
      homeBad.error && /Adresse de livraison incomplète/.test(homeBad.error), home.ops.map((o) => o.t).join(","));
}

check("planches : 26 références, formats de feuille lisibles (305 mm = 30 cm), visuel de la première planche d'une composition",
      BEPHOTO_PLANCHES.length === 26 && new Set(BEPHOTO_PLANCHES.map((p) => p.id)).size === 26 &&
      BEPHOTO_PLANCHES.every((p) => p.label && plancheSheet(p)) && plancheSheet(BEPHOTO_PLANCHES.find((p) => p.id === 118)) === "20×30" &&
      previewForLabItems([{ idproduct: 102 }, { idproduct: 1120 }, { idproduct: 1054 }]) === "/api/lab-previews/bephoto/1054.jpg" && previewForLabItems([]) === "");

/* ---------- Faux BePhoto ---------- */

const LAB_EMAIL = "labo@test.invalid";
const LAB_PASSWORD = "bon-mot-de-passe";
const LAB_KEY = "cle-api-bephoto-de-test";
const lab = { logins: 0, keyLogins: 0, token: "", orders: new Map(), nextId: 500, downloads: [], expireAfterFirstAdd: true, previewFetches: 0, calculations: [] };
// Format de novembre 2026 : objet indexé par idformat ; montages avec ?include=montage.
const CATALOGUE = {
  "101": { idformat: "101", format: "Tirage 13x18", largeur: "127", hauteur: "178", prix: { "1": "0.45", "2": "0.50" } },
  "102": { idformat: "102", format: "Tirage 9x13", largeur: "89", hauteur: "127", prix: { "1": "0.25" } },
  "103": { idformat: "103", format: "Tirage 20x30", largeur: "203", hauteur: "305", prix: { "1": "2.10", "2": "2.30" } },
};
const MONTAGES = {
  "163": { idformat: 163, format: "2 6x9 on9x13", largeur: 127, hauteur: 90, prix: { "1": "0.14" }, idtypeformat: 100 },
  "2001": { idformat: 2001, format: "Pochette scolaire du studio", largeur: 152, hauteur: 210, prix: { "1": "1.90" }, idtypeformat: 100 },
};
const MIN_PRINTS = 3;            // minimum d'une enveloppe sur ce compte
const FEE = "1.50";              // frais d'une enveloppe sous le minimum
const SHIPPING = { BPOST: 6.5, PICKUP: 0 };
const unitPrice = (idproduct, idpaper) => Number(({ ...CATALOGUE, ...MONTAGES })[String(idproduct)]?.prix[String(idpaper)] ?? 0);
function orderPrice(order) {
  const subs = order.subs.map((id) => lab.orders.get(id));
  const lines = order.lines.concat(subs.flatMap((sub) => sub.lines));
  const products = aggregateLabItems(lines).map((l) => ({ idformat: l.idproduct, idpapier: l.idpaper, prix: unitPrice(l.idproduct, l.idpaper).toFixed(2), quantite: l.quantity }));
  const suborders = subs.map((sub) => {
    const prints = sub.lines.reduce((n, l) => n + l.quantity, 0);
    return { idorder: sub.id, label: sub.label, prints, total: sub.lines.reduce((t, l) => t + unitPrice(l.idproduct, l.idpaper) * l.quantity, 0).toFixed(2), fee: prints < MIN_PRINTS ? FEE : "0" };
  });
  const total = products.reduce((t, p) => t + Number(p.prix) * p.quantite, 0) + suborders.reduce((t, s) => t + Number(s.fee), 0) + SHIPPING[order.shipping];
  return { products, suborders, total: total.toFixed(2) };
}
const labServer = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const data = body ? JSON.parse(body) : null;
  const reply = (status, payload) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); };
  const authed = req.headers.authorization === `Bearer ${lab.token}` && lab.token;
  const url = new URL(req.url, "http://lab");
  if (req.method === "GET" && url.pathname.startsWith("/images/products/formats/montages/")) {
    lab.previewFetches++;
    res.writeHead(200, { "content-type": "image/jpeg" });
    return res.end(await sharp({ create: { width: 120, height: 170, channels: 3, background: "#123a6e" } }).jpeg().toBuffer());
  }
  if (req.method === "POST" && url.pathname === "/user/login") {
    if (data?.email !== LAB_EMAIL || data?.password !== LAB_PASSWORD) return reply(401, { error: "Unauthorized" });
    lab.logins++;
    lab.token = `tok-${lab.logins}`;
    return reply(200, { status: 1, token: lab.token });
  }
  if (req.method === "POST" && url.pathname === "/user/loginToken") {
    if (data?.token !== LAB_KEY) return reply(401, { error: "Unauthorised" });
    lab.keyLogins++;
    lab.token = `key-${lab.keyLogins}`;
    return reply(200, { status: 1, token: lab.token });
  }
  if (!authed) return reply(401, { error: "Unauthorized" });
  if (req.method === "GET" && url.pathname === "/products") {
    return reply(200, { status: 1, products: url.searchParams.get("include") === "montage" ? { ...CATALOGUE, ...MONTAGES } : CATALOGUE });
  }
  if (req.method === "POST" && url.pathname === "/calculate") {
    const products = JSON.parse(data.products);
    lab.calculations.push({ products, shippingmethod: data.shippingmethod });
    const lines = products.map((p) => ({ ...p, price: unitPrice(p.idproduct, p.idpaper).toFixed(2), total: (unitPrice(p.idproduct, p.idpaper) * p.quantity).toFixed(2) }));
    const totalProducts = lines.reduce((t, l) => t + Number(l.total), 0);
    const shipping = data.shippingmethod ? SHIPPING[data.shippingmethod] : 0;
    return reply(200, { products: lines, total_products: totalProducts.toFixed(2), total_shipping: shipping.toFixed(2), total_order: (totalProducts + shipping).toFixed(2) });
  }
  if (req.method === "POST" && url.pathname === "/orders") {
    const id = String(++lab.nextId);
    lab.orders.set(id, { id, metadata: data.metadata, lines: [], subs: [], parent: null, closed: false, shipping: "BPOST", address: null });
    return reply(200, { status: 1, order: { idorder: Number(id), datestart: "2026-11-27 10:00:00", totalorder: "0", totalcost: "0", shippingmethod: "BPOST", metadata: data.metadata } });
  }
  const m = /^\/orders\/(\d+)(\/products|\/close|\/price|\/suborders|\/shipping-address|\/shipping\/([A-Z]+))?$/.exec(url.pathname);
  const order = m && lab.orders.get(m[1]);
  if (!order) return reply(404, { error: "Commande inconnue" });
  const main = order.parent ? lab.orders.get(order.parent) : order;
  if (main.closed && req.method === "POST") return reply(400, { error: "Commande confirmée" });
  if (order.parent && ["/close", "/price", "/suborders", "/shipping-address"].includes(m[2] || "") ) return reply(400, { error: "Interdit sur une sous-commande" });
  if (order.parent && m[3]) return reply(400, { error: "Interdit sur une sous-commande" });
  if (req.method === "POST" && m[2] === "/products") {
    const products = Array.isArray(data.products) ? data.products : [data];
    for (const product of products) {
      if (!product.fileurl) return reply(400, { error: "fileurl obligatoire" });
      order.lines.push(product);
      // Le labo vient chercher le fichier, comme le vrai.
      const file = await fetch(product.fileurl);
      const bytes = Buffer.from(await file.arrayBuffer());
      lab.downloads.push({ status: file.status, size: bytes.length, announced: product.filesize, type: file.headers.get("content-type") });
    }
    if (lab.expireAfterFirstAdd) { lab.expireAfterFirstAdd = false; lab.token = "expire"; }
    return reply(200, { status: 1, products });
  }
  if (req.method === "POST" && m[2] === "/suborders") {
    if (!data?.label) return reply(400, { error: "label obligatoire" });
    const id = String(++lab.nextId);
    lab.orders.set(id, { id, label: data.label, lines: [], subs: [], parent: order.id, closed: false });
    order.subs.push(id);
    return reply(200, { status: 1, order: { idorder: Number(id), label: data.label, parent_idorder: Number(order.id) } });
  }
  if (req.method === "POST" && m[3]) {
    if (!(m[3] in SHIPPING)) return reply(400, { error: "Méthode inconnue" });
    order.shipping = m[3];
    return reply(200, { status: 1 });
  }
  if (req.method === "POST" && m[2] === "/shipping-address") {
    for (const field of ["nom", "prenom", "adresse", "cp", "localite"]) if (!data?.[field]) return reply(400, { error: `${field} obligatoire` });
    order.address = data;
    order.shipping = "BPOST";
    return reply(200, { status: 1, idadrliv: 77 });
  }
  if (req.method === "POST" && m[2] === "/price") {
    const { products, suborders } = orderPrice(order);
    return reply(200, { status: 1, products, suborders });
  }
  if (req.method === "POST" && m[2] === "/close") {
    order.closed = true;
    const { products, total } = orderPrice(order);
    return reply(200, { status: 1, total_order: total, products });
  }
  if (req.method === "GET" && !m[2]) return reply(200, { status: 1, order: { idorder: Number(m[1]), shippingmethod: order.shipping } });
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
let accountView = await call("GET", "/api/admin/school/lab");
check("le compte se connecte par e-mail et mot de passe ; le mot de passe n'est jamais renvoyé",
      connected.status === 200 && accountView.body.connected && accountView.body.method === "password" && accountView.body.email === LAB_EMAIL &&
      !JSON.stringify(accountView.body).includes(LAB_PASSWORD));
const catalogue = await call("GET", "/api/admin/school/lab/products");
check("le catalogue BePhoto (format actuel, montages compris) se lit, prix en centimes par papier",
      catalogue.status === 200 && catalogue.body.products.length === 5 && catalogue.body.products[0].idproduct === 101 &&
      catalogue.body.products[0].prices[1].cents === 50 && catalogue.body.products.find((p) => p.idproduct === 2001)?.montage === true,
      JSON.stringify(catalogue.body.products?.map((p) => p.idproduct)));

const wrongKey = await call("POST", "/api/admin/school/lab", { apiKey: "mauvaise-cle" });
check("une clé d'API refusée par BePhoto ne remplace pas la connexion existante",
      wrongKey.status === 400 && /clé/.test(wrongKey.body.error) && (await call("GET", "/api/admin/school/lab")).body.method === "password", wrongKey.body.error);
const byKey = await call("POST", "/api/admin/school/lab", { apiKey: LAB_KEY });
accountView = await call("GET", "/api/admin/school/lab");
check("connexion par clé d'API : le mot de passe enregistré est effacé, la clé n'est jamais renvoyée",
      byKey.status === 200 && accountView.body.connected && accountView.body.method === "key" && accountView.body.email === "" &&
      !JSON.stringify(accountView.body).includes(LAB_KEY) && lab.keyLogins === 1);
const exported = await call("GET", "/api/admin/account/export");
const exportedText = JSON.stringify(exported.body);
check("l'export RGPD du compte ne contient ni mot de passe, ni clé, ni jeton BePhoto",
      exported.status === 200 && !exportedText.includes(LAB_PASSWORD) && !exportedText.includes(LAB_KEY) && !exportedText.includes("bephoto_password_enc") &&
      !exportedText.includes("bephoto_token_enc") && !exportedText.includes("bephoto_key_enc") && /enregistrée, non exportée/.test(exportedText));
const onlineCatalogue = await call("GET", "/api/admin/school/lab/catalogue");
check("compte connecté : les montages du compte et les tirages s'ajoutent aux planches (sans doublon avec la grille publique)",
      onlineCatalogue.body.planches.length === 26 && onlineCatalogue.body.others.length === 4 && onlineCatalogue.body.connected === true &&
      onlineCatalogue.body.others.filter((p) => p.montage).map((p) => p.idproduct).join() === "2001",
      JSON.stringify(onlineCatalogue.body.others?.map((p) => [p.idproduct, p.montage])));

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
check("les produits en vente sans composition labo sont signalés ; l'adresse de l'établissement est reconnue",
      batches.unmappedProducts.includes("Tirage 13×18") && batches.schoolAddress === true, batches.unmappedProducts.join(", "));
const lot1 = await call("POST", `/api/admin/school/years/${yearId}/batches`, { delivery: "school" });
const lotAgain = await call("POST", `/api/admin/school/years/${yearId}/batches`, { delivery: "school" });
const lotHome = await call("POST", `/api/admin/school/years/${yearId}/batches`, { delivery: "home" });
check("un lot regroupe tout ce qui attend ; rien ne peut entrer dans deux lots",
      lot1.status === 201 && lot1.body.number === 1 && lotAgain.status === 400 && lotHome.status === 201 && lotHome.body.number === 2);
const homeUnmapped = await call("POST", `/api/admin/school/batches/${lotHome.body.id}/send`, {});
check("un lot dont un produit n'a pas de composition labo ne part pas (message clair), et reste prêt",
      homeUnmapped.status === 409 && /Tirage 13×18/.test(homeUnmapped.body.error) && lab.orders.size === 0, homeUnmapped.body.error);
const production = await call("POST", `/api/admin/school/years/${yearId}/production`, { batchId: lotHome.body.id });
check("le fichier d'un lot à domicile ne contient que ce lot, avec l'adresse de la famille",
      production.status === 200 && production.body.lines.length === 1 && production.body.batch.number === 2 && production.body.lines[0].shippingAddress.city === "Liège");

/* ---------- Prix simulé, puis envoi à BePhoto pas à pas ---------- */

const estimate = await call("POST", `/api/admin/school/batches/${lot1.body.id}/estimate`, { shipping: "school" });
check("prix simulé avant l'envoi : quantités additionnées par produit et papier, livraison du compte (rien n'est créé chez BePhoto)",
      estimate.status === 200 && estimate.body.productsCents === 420 && estimate.body.shippingCents === 650 && estimate.body.totalCents === 1070 &&
      estimate.body.envelopes === 2 && lab.calculations.length === 1 && lab.calculations[0].shippingmethod === "BPOST" &&
      lab.calculations[0].products.length === 3 && lab.orders.size === 0, JSON.stringify(estimate.body));

const steps = [];
for (let i = 0; i < 20; i++) {
  const step = await call("POST", `/api/admin/school/batches/${lot1.body.id}/send`, { shipping: "school" });
  steps.push(step);
  if (step.status !== 200 || step.body.done || step.body.awaiting) break;
}
const labOrder = lab.orders.get("501");
const envelopes = labOrder ? labOrder.subs.map((id) => lab.orders.get(id)) : [];
const allLines = envelopes.flatMap((e) => e.lines);
let last = steps.at(-1);
check("l'envoi se fait pas à pas jusqu'au prix annoncé, puis attend la confirmation (rien n'est confirmé)",
      last.status === 200 && last.body.awaiting === true && labOrder && labOrder.closed === false,
      steps.map((s) => s.status + ":" + (s.body.sent ?? "") + "/" + (s.body.total ?? "") + (s.body.awaiting ? " prix" : "")).join(" ") + " " + (last.body.error || ""));
check("BePhoto reçoit une commande annotée et l'adresse de l'établissement (contact par défaut : la direction)",
      /École du labo/.test(labOrder.metadata) && /Lot 1/.test(labOrder.metadata) && labOrder.address?.adresse === "Rue de l'École 1" &&
      labOrder.address.cp === "4000" && labOrder.address.localite === "Liège" && labOrder.address.pays === "BE" &&
      labOrder.address.societe === "École du labo" && labOrder.address.prenom === "Direction", JSON.stringify(labOrder.address));
check("une enveloppe par enfant, dans l'ordre de la classe, avec son libellé ; les tirages vont dans l'enveloppe, pas dans la commande",
      envelopes.map((e) => e.label).join(" | ") === "P2 - 001 Léa | P2 - 002" && labOrder.lines.length === 0 &&
      envelopes[0].lines.length === 2 && envelopes[1].lines.length === 1, envelopes.map((e) => e.label + ":" + e.lines.length).join(" | "));
check("chaque article devient ses tirages : 2 pochettes = 2 × 13×18 + 4 × 9×13, plus la photo de classe en lustré",
      allLines.length === 3 &&
      envelopes[0].lines.some((l) => l.idproduct === 101 && l.quantity === 2 && l.idpaper === 1) &&
      envelopes[0].lines.some((l) => l.idproduct === 102 && l.quantity === 4) &&
      envelopes[1].lines.some((l) => l.idproduct === 103 && l.quantity === 1 && l.idpaper === 2) && allLines.every((l) => !l.backprint),
      JSON.stringify(allLines.map((l) => [l.idproduct, l.quantity, l.idpaper])));
check("les noms de fichiers rangent par classe et par enfant",
      allLines.every((l) => /^01_P2_00\d_/.test(l.filename)) && allLines.some((l) => l.filename.startsWith("01_P2_001_Lea_Pochette-Classique")),
      allLines.map((l) => l.filename).join(", "));
check("le labo télécharge chaque fichier d'impression par son adresse signée (taille annoncée exacte)",
      lab.downloads.length === 3 && lab.downloads.every((d) => d.status === 200 && d.size === d.announced && d.type === "image/jpeg"),
      JSON.stringify(lab.downloads));
check("quand le jeton BePhoto expire en route, Holypixx se reconnecte seul avec la clé d'API et poursuit",
      lab.keyLogins === 2 && lab.token === "key-2" && allLines.length === 3, `${lab.keyLogins} connexions par clé`);
check("prix annoncé : tirages 4,20 €, une enveloppe sous le minimum (1,50 € de frais), deux enveloppes",
      last.body.labTotal?.productsCents === 420 && last.body.labTotal.feesCents === 150 && last.body.labTotal.feeEnvelopeCount === 1 &&
      last.body.labTotal.feeEnvelopes[0].label === "P2 - 002" && last.body.labTotal.envelopes === 2 && last.body.labTotal.totalCents === null,
      JSON.stringify(last.body.labTotal));
batches = (await call("GET", `/api/admin/school/years/${yearId}/batches`)).body;
let lotView = batches.batches.find((b) => b.id === lot1.body.id);
const again = await call("POST", `/api/admin/school/batches/${lot1.body.id}/send`, {});
check("le lot attend la confirmation (« à confirmer », numéro BePhoto, livraison choisie) ; relancer l'envoi ne confirme rien",
      lotView.status === "priced" && lotView.labOrderId === "501" && lotView.shipping === "school" && lotView.labTotal.feesCents === 150 &&
      again.body.awaiting === true && labOrder.closed === false);
const confirmReady = await call("POST", `/api/admin/school/batches/${lotHome.body.id}/confirm`, {});
check("seul un lot au prix annoncé se confirme", confirmReady.status === 409);
const confirmed = await call("POST", `/api/admin/school/batches/${lot1.body.id}/confirm`, {});
const confirmedTwice = await call("POST", `/api/admin/school/batches/${lot1.body.id}/confirm`, {});
for (let i = 0; i < 10; i++) {
  last = await call("POST", `/api/admin/school/batches/${lot1.body.id}/send`, {});
  if (last.status !== 200 || last.body.done) break;
}
check("après confirmation, la commande (et ses enveloppes) est confirmée chez BePhoto, une seule fois",
      confirmed.status === 200 && confirmedTwice.status === 409 && last.body.done === true && labOrder.closed === true, JSON.stringify(last.body));
batches = (await call("GET", `/api/admin/school/years/${yearId}/batches`)).body;
const sentLot = batches.batches.find((b) => b.id === lot1.body.id);
check("le lot est marqué parti, avec le numéro BePhoto et le total facturé (tirages, frais d'enveloppe, livraison)",
      sentLot.status === "sent" && sentLot.labOrderId === "501" && sentLot.labTotal?.totalCents === 1220 && batches.pending.school.lines === 0,
      JSON.stringify(sentLot.labTotal));
const topOrders = () => [...lab.orders.values()].filter((o) => !o.parent).length;
const resend = await call("POST", `/api/admin/school/batches/${lot1.body.id}/send`, {});
const cancelSent = await call("DELETE", `/api/admin/school/batches/${lot1.body.id}`);
check("un lot parti ne repart pas et ne s'annule plus", resend.body.done === true && topOrders() === 1 && cancelSent.status === 409);

const fileUrl = allLines[0].fileurl;
const forged = await fetch(fileUrl.replace(/s=[^&]+/, "s=faux"));
const otherPhoto = await fetch(fileUrl.replace(encodeURIComponent(fileUrl.split("/").at(-1).split(".jpg")[0]), photosOf(kidB.id)[0].id));
check("une adresse de fichier falsifiée, ou vers une autre photo, ne livre rien", forged.status === 403 && otherPhoto.status === 403);

/* ---------- Lot à domicile : une commande par famille, livrée chez elle ---------- */

await call("POST", `/api/admin/school/products/${productNamed("Tirage 13×18").id}/lab`, { items: [{ idproduct: 101, idpaper: 1, quantity: 1, label: "Tirage 13x18" }] });
let homeLast;
for (let i = 0; i < 10; i++) {
  homeLast = await call("POST", `/api/admin/school/batches/${lotHome.body.id}/send`, {});
  if (homeLast.status !== 200 || homeLast.body.done || homeLast.body.awaiting) break;
}
const homeOrder = [...lab.orders.values()].find((o) => !o.parent && o.id !== "501");
check("à domicile : une commande BePhoto à l'adresse de la famille, le nom de l'enfant au dos de la photo, sans enveloppe",
      homeLast.body.awaiting === true && homeOrder && /Famille Marie Dupont/.test(homeOrder.metadata) &&
      homeOrder.address?.prenom === "Marie" && homeOrder.address.nom === "Dupont" && homeOrder.address.adresse === "Rue Haute 3" &&
      homeOrder.address.cp === "4000" && homeOrder.address.localite === "Liège" && homeOrder.address.pays === "BE" &&
      homeOrder.address.email === `parent-labo-${RUN}@test.invalid` && homeOrder.subs.length === 0 && homeOrder.lines.length === 1 &&
      homeOrder.lines[0].backprint === "P2 001 Léa" && homeOrder.closed === false && homeLast.body.labTotal.productsCents === 45,
      JSON.stringify(homeOrder?.address) + " " + JSON.stringify(homeLast.body));
const cancelHome = await call("DELETE", `/api/admin/school/batches/${lotHome.body.id}`);
batches = (await call("GET", `/api/admin/school/years/${yearId}/batches`)).body;
check("annuler un lot au prix pas encore confirmé remet ses articles en attente (rien n'est imprimé)",
      cancelHome.status === 200 && batches.pending.home.lines === 1 && batches.batches.length === 1 && homeOrder.closed === false);

const other = await createTestAccount(API, "labo-autre", { plan: "studio" });
const otherClient = new WorkerClient({ api: API, ...other });
await otherClient.login();
const peek = await fetch(`${API}/api/admin/school/batches/${lot1.body.id}/send`, { method: "POST", headers: { authorization: `Bearer ${otherClient.token}` } });
const peekConfirm = await fetch(`${API}/api/admin/school/batches/${lot1.body.id}/confirm`, { method: "POST", headers: { authorization: `Bearer ${otherClient.token}` } });
const peekProduct = await fetch(`${API}/api/admin/school/products/${productNamed("Pochette Classique").id}/lab`, {
  method: "POST", headers: { authorization: `Bearer ${otherClient.token}`, "content-type": "application/json" }, body: JSON.stringify({ items: [] }),
});
check("un autre photographe n'atteint ni les lots ni la composition", peek.status === 404 && peekConfirm.status === 404 && peekProduct.status === 404);

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
check("l'écran « Envois au labo » montre l'attente, le lot parti chez BePhoto avec son total et le compte connecté par clé",
      /Lot 1/.test(labText) && /BePhoto n° 501/.test(labText) && /Total BePhoto : 12,20/.test(labText) && /Compte BePhoto connecté · par clé d'API/.test(labText) &&
      /1 article/.test(labText) && /Une commande BePhoto par famille/.test(labText), labText.replace(/\s+/g, " ").slice(0, 300));
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
      groupsShown.join("|") === "Planches composées par le labo|Montages de votre compte BePhoto|Tirages et autres produits BePhoto" && thumbs === 24 &&
      /Coût labo ≈ 1,20 € à 2,19 €/.test(await famRow.locator("[data-lab-cost]").textContent()), `${thumbs} vignettes`);
await famRow.locator("[data-save-lab]").click();
await page.waitForFunction(() => [...document.querySelectorAll(".ad-sc-products > li")].some((li) => li.querySelector(".ad-sc-prod-thumb") && li.textContent.includes("Planche 20×30 n°118")));
check("après enregistrement, le produit montre la vignette de sa planche", true);
await page.click('[data-new-batch="home"]');
await page.waitForSelector('[data-cancel-batch]');
check("« Préparer un lot » crée le lot depuis l'écran (le numéro d'un lot annulé est repris)",
      /Lot 2\s*À domicile/.test(await page.textContent("#ad-sc-lab tbody")), (await page.textContent("#ad-sc-lab tbody")).replace(/\s+/g, " ").slice(0, 120));
const homeRow = page.locator("#ad-sc-lab tbody tr", { hasText: "Lot 2" });
await homeRow.locator("[data-estimate]").click();
await page.waitForFunction(() => /Estimation : tirages/.test(document.querySelector("#ad-sc-lab tbody tr:first-child [data-batch-status]")?.textContent || ""));
const estimateText = await homeRow.locator("[data-batch-status]").textContent();
check("« Estimer le prix » affiche la simulation BePhoto sans rien envoyer", /Estimation : tirages 0,45\s€ \+ livraison 6,50\s€ = 6,95\s€/.test(estimateText), estimateText);
await homeRow.locator("[data-send-batch]").click();
await page.waitForSelector("[data-confirm-batch]", { timeout: 15000 });
const pricedText = (await page.locator("#ad-sc-lab tbody tr", { hasText: "Lot 2" }).textContent()).replace(/\s+/g, " ");
check("« Envoyer à BePhoto » transmet le lot puis affiche le prix à confirmer",
      /Prix à confirmer/.test(pricedText) && /Prix BePhoto : tirages 0,45\s€, hors livraison/.test(pricedText) && /Une commande par famille/.test(pricedText), pricedText);
if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/ecole-labo-prix.png`, fullPage: true });
const confirmBtn = page.locator("[data-confirm-batch]");
await confirmBtn.click();
check("confirmer demande une seconde validation", /BePhoto imprime et vous facture/.test(await confirmBtn.textContent()));
await confirmBtn.click();
await page.waitForFunction(() => [...document.querySelectorAll("#ad-sc-lab tbody tr")].some((tr) => /Lot 2/.test(tr.textContent) && /Parti le/.test(tr.textContent)), null, { timeout: 15000 });
const sentHomeText = (await page.locator("#ad-sc-lab tbody tr", { hasText: "Lot 2" }).textContent()).replace(/\s+/g, " ");
const uiOrder = [...lab.orders.values()].filter((o) => !o.parent).at(-1);
check("après confirmation, le lot à domicile est parti, avec son numéro et son total BePhoto",
      /Parti le/.test(sentHomeText) && new RegExp(`BePhoto n° ${uiOrder.id}`).test(sentHomeText) && /Total BePhoto : 6,95/.test(sentHomeText) && uiOrder.closed === true, sentHomeText);
if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/ecole-labo.png`, fullPage: true });
check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

await browser.close();
labServer.close();

const disconnected = await call("DELETE", "/api/admin/school/lab");
check("le compte BePhoto se déconnecte", disconnected.status === 200 && disconnected.body.connected === false);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
