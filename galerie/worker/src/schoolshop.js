// Commande des familles du module scolaire.
//
// Le photographe compose la gamme d'une année (pochettes, tirages, fichiers
// numériques ; chacun sur un portrait de l'enfant ou sur la photo de
// groupe) et ses prix. Les familles remplissent un seul panier pour tous
// leurs enfants depuis l'espace famille (ecole.html), puis paient par
// Stripe : charge de destination vers le compte du photographe, comme les
// tirages des galeries, avec retenue des frais (fees.js — commission de la
// formule Scolaire, ou frais de paiement habituels).
//
// Livraison : groupée à l'établissement (gratuite) jusqu'à la date de
// commande groupée, puis à domicile (frais de port de l'année, adresse
// demandée par Stripe) jusqu'à la date de commande à domicile.
//
// Le photographe suit les commandes par groupe et télécharge le fichier de
// production (admin-server : fichiers d'impression rangés par groupe et par
// enfant, et récapitulatif).

import { json, fail } from "./http.js";
import { randomBytes, b64url } from "./auth.js";
import { createSchoolCheckout, retrieveCheckoutSession } from "./stripe.js";
import { schoolFeeRule, feeCentsFor } from "./fees.js";
import { originalKey } from "./storage.js";
import { SCHOOL_KINDS } from "./school.js";
import { sendSchoolOrderConfirmation } from "./notify.js";
import { previewForLabItems, layoutForLabItems } from "./bephoto.js";
import { reminderStats } from "./schoolreminders.js";

export const PRODUCT_KINDS = { pochette: "Pochette", tirage: "Tirage", numerique: "Fichier numérique" };
const SCOPES = ["portrait", "group"];
const MAX_PRODUCTS = 40;
const MAX_LINES = 60;
const MAX_QTY = 20;

function now() {
  return Math.floor(Date.now() / 1000);
}
function newId(prefix) {
  return `${prefix}_${b64url(randomBytes(9))}`;
}
function text(value, max) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}
function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
function parseAddress(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}
function priceCents(value) {
  const n = Math.round(Number(String(value ?? "").replace(",", ".")) * 100);
  return Number.isFinite(n) && n >= 50 && n <= 100000 ? n : null;
}

// Gamme de départ, à ajuster : prix TTC courants en photo scolaire.
export const STARTER_PRODUCTS = [
  { kind: "pochette", scope: "portrait", name: "Pochette Classique", description: "1 tirage 13×18, 2 tirages 9×13, 4 photos d'identité", price_cents: 2200 },
  { kind: "pochette", scope: "portrait", name: "Pochette Famille", description: "1 tirage 18×24, 2 tirages 13×18, 4 tirages 9×13, 8 photos d'identité, le fichier numérique", price_cents: 3900 },
  { kind: "tirage", scope: "portrait", name: "Tirage 13×18", description: "Portrait au choix", price_cents: 800 },
  { kind: "tirage", scope: "portrait", name: "Tirage 20×30", description: "Portrait au choix", price_cents: 1500 },
  { kind: "numerique", scope: "portrait", name: "Fichier numérique HD", description: "À télécharger depuis l'espace famille, sans filigrane", price_cents: 1000 },
  { kind: "tirage", scope: "group", name: "Photo de groupe 20×30", description: "La photo de groupe", price_cents: 1200 },
];

/* ---------- Côté photographe ---------- */

async function ownedYear(env, photographerId, yearId) {
  return env.DB.prepare(
    `SELECT y.*, s.kind AS school_kind, s.name AS school_name, s.address AS school_address
     FROM school_years y JOIN schools s ON s.id = y.school_id WHERE y.id = ? AND s.photographer_id = ?`
  ).bind(yearId, photographerId).first();
}

function productOut(p) {
  return {
    id: p.id, kind: p.kind, scope: p.scope, name: p.name, description: p.description,
    priceCents: p.price_cents, sort: p.sort, active: Boolean(p.active), labItems: parseJson(p.lab_items, []),
    preview: previewForLabItems(parseJson(p.lab_items, [])),
    // Cases de la planche, pour l'aperçu avec la photo de l'enfant.
    layout: layoutForLabItems(parseJson(p.lab_items, [])),
  };
}

async function listProducts(env, yearId, { activeOnly = false } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM school_products WHERE year_id = ?${activeOnly ? " AND active = 1" : ""} ORDER BY sort, created_at`
  ).bind(yearId).all();
  return results;
}

function productFields(body) {
  const kind = PRODUCT_KINDS[body?.kind] ? body.kind : null;
  const scope = SCOPES.includes(body?.scope) ? body.scope : "portrait";
  const name = text(body?.name, 80);
  const price = priceCents(body?.price);
  if (!kind) return { error: "Type de produit inconnu" };
  if (!name) return { error: "Nom du produit requis" };
  if (price === null) return { error: "Prix invalide (entre 0,50 € et 1 000 €)" };
  return { kind, scope, name, description: text(body?.description, 240), price };
}

async function createProduct(request, env, year) {
  const f = productFields(await request.json().catch(() => null));
  if (f.error) return fail(400, f.error);
  const row = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(sort), -1) AS last FROM school_products WHERE year_id = ?").bind(year.id).first();
  if ((row?.n || 0) >= MAX_PRODUCTS) return fail(400, `${MAX_PRODUCTS} produits au maximum par année`);
  const id = newId("spr");
  await env.DB.prepare(
    `INSERT INTO school_products (id, year_id, kind, scope, name, description, price_cents, sort, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  ).bind(id, year.id, f.kind, f.scope, f.name, f.description, f.price, (row?.last ?? -1) + 1, now()).run();
  return json({ id }, { status: 201 });
}

async function addStarterProducts(env, year) {
  const existing = await listProducts(env, year.id);
  if (existing.length) return fail(409, "La gamme de cette année n'est pas vide");
  await env.DB.batch(STARTER_PRODUCTS.map((p, i) => env.DB.prepare(
    `INSERT INTO school_products (id, year_id, kind, scope, name, description, price_cents, sort, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  ).bind(newId("spr"), year.id, p.kind, p.scope, p.name, p.description, p.price_cents, i, now())));
  return json({ products: (await listProducts(env, year.id)).map(productOut) });
}

async function ownedProduct(env, photographerId, productId) {
  return env.DB.prepare(
    `SELECT p.* FROM school_products p JOIN school_years y ON y.id = p.year_id JOIN schools s ON s.id = y.school_id
     WHERE p.id = ? AND s.photographer_id = ?`
  ).bind(productId, photographerId).first();
}

async function updateProduct(request, env, photographer, productId) {
  const product = await ownedProduct(env, photographer.id, productId);
  if (!product) return fail(404, "Produit introuvable");
  const body = await request.json().catch(() => null);
  const merged = {
    kind: body?.kind ?? product.kind, scope: body?.scope ?? product.scope, name: body?.name ?? product.name,
    description: body?.description ?? product.description, price: body?.price ?? product.price_cents / 100,
  };
  const f = productFields(merged);
  if (f.error) return fail(400, f.error);
  const active = body?.active === undefined ? product.active : (body.active ? 1 : 0);
  await env.DB.prepare(
    "UPDATE school_products SET kind = ?, scope = ?, name = ?, description = ?, price_cents = ?, active = ? WHERE id = ?"
  ).bind(f.kind, f.scope, f.name, f.description, f.price, active, productId).run();
  return json({ ok: true });
}

async function deleteProduct(env, photographer, productId) {
  if (!(await ownedProduct(env, photographer.id, productId))) return fail(404, "Produit introuvable");
  // Les commandes gardent le nom et le prix de l'article : rien ne se perd.
  await env.DB.prepare("DELETE FROM school_products WHERE id = ?").bind(productId).run();
  return json({ ok: true });
}

// La gamme passe d'une année à la suivante avec les groupes (school.js).
export async function copyProducts(env, fromYearId, toYearId) {
  const products = await listProducts(env, fromYearId);
  if (!products.length) return [];
  return products.map((p) => env.DB.prepare(
    `INSERT INTO school_products (id, year_id, kind, scope, name, description, price_cents, sort, active, lab_items, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(newId("spr"), toYearId, p.kind, p.scope, p.name, p.description, p.price_cents, p.sort, p.active, p.lab_items || "", now()));
}

// GET …/years/:id/shop — gamme, frais de port, commandes par groupe.
async function shopForAdmin(env, photographer, year) {
  const products = (await listProducts(env, year.id)).map(productOut);
  const { results: groups } = await env.DB.prepare(
    `SELECT g.id, g.name, (SELECT COUNT(*) FROM school_children c WHERE c.group_id = g.id) AS children
     FROM school_groups g WHERE g.year_id = ? ORDER BY g.sort, g.name COLLATE NOCASE`
  ).bind(year.id).all();
  const { results: perGroup } = await env.DB.prepare(
    `SELECT l.group_id, COUNT(DISTINCT l.child_id) AS children, COUNT(DISTINCT o.id) AS orders,
            SUM(l.price_cents * l.quantity) AS amount
     FROM school_order_lines l JOIN school_orders o ON o.id = l.order_id
     WHERE o.year_id = ? AND o.status = 'paid' GROUP BY l.group_id`
  ).bind(year.id).all();
  const { results: orders } = await env.DB.prepare(
    `SELECT o.*, (SELECT COUNT(*) FROM school_order_lines l WHERE l.order_id = o.id) AS lines
     FROM school_orders o WHERE o.year_id = ? AND o.status = 'paid' ORDER BY o.paid_at DESC LIMIT 200`
  ).bind(year.id).all();
  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS amount, COALESCE(SUM(fee_cents), 0) AS fees,
            COUNT(DISTINCT family_id) AS families
     FROM school_orders WHERE year_id = ? AND status = 'paid'`
  ).bind(year.id).first();
  return json({
    products,
    kinds: PRODUCT_KINDS,
    homeShippingCents: year.home_shipping_cents || 0,
    familyReminders: Boolean(year.family_reminders),
    reminders: await reminderStats(env, year.id),
    totals: { orders: totals?.n || 0, amountCents: totals?.amount || 0, feeCents: totals?.fees || 0, families: totals?.families || 0 },
    groups: groups.map((g) => {
      const stat = perGroup.find((s) => s.group_id === g.id) || {};
      return { id: g.id, name: g.name, children: g.children, childrenOrdered: stat.children || 0, orders: stat.orders || 0, amountCents: stat.amount || 0 };
    }),
    orders: orders.map((o) => ({
      id: o.id, email: o.email, delivery: o.delivery, amountCents: o.amount_cents, feeCents: o.fee_cents,
      lines: o.lines, paidAt: o.paid_at, shippingName: o.shipping_name,
    })),
  });
}

// POST …/years/:id/shipping { price } — frais de port de la commande à domicile.
async function setShipping(request, env, year) {
  const body = await request.json().catch(() => null);
  const raw = String(body?.price ?? "").trim();
  const cents = raw === "" || raw === "0" ? 0 : priceCents(raw);
  if (cents === null) return fail(400, "Frais de port invalides");
  await env.DB.prepare("UPDATE school_years SET home_shipping_cents = ? WHERE id = ?").bind(cents, year.id).run();
  return json({ ok: true });
}

// POST …/years/:id/production { groupId? } — ce qu'il faut produire : les
// articles payés, rangés par groupe puis par enfant, avec la photo choisie.
// admin-server en fait un ZIP (fichiers d'impression + récapitulatif).
async function productionForYear(request, env, year) {
  const body = await request.json().catch(() => ({}));
  const { results } = await env.DB.prepare(
    `SELECT l.*, ph.gallery_id, o.delivery, o.email, o.shipping_name, o.shipping_address, o.paid_at, o.id AS order_id,
            c.number AS child_number, c.first_name AS child_first_name, g.name AS group_name, g.sort AS group_sort
     FROM school_order_lines l
     JOIN school_orders o ON o.id = l.order_id
     LEFT JOIN photos ph ON ph.id = l.photo_id
     LEFT JOIN school_children c ON c.id = l.child_id
     LEFT JOIN school_groups g ON g.id = l.group_id
     WHERE o.year_id = ? AND o.status = 'paid' AND l.kind != 'numerique'
       ${body?.groupId ? "AND l.group_id = ?" : ""} ${body?.batchId ? "AND l.batch_id = ?" : ""}
     ORDER BY g.sort, g.name COLLATE NOCASE, c.number, o.paid_at`
  ).bind(year.id, ...(body?.groupId ? [String(body.groupId)] : []), ...(body?.batchId ? [String(body.batchId)] : [])).all();
  const batch = body?.batchId
    ? await env.DB.prepare("SELECT number, delivery FROM school_lab_batches WHERE id = ? AND year_id = ?").bind(String(body.batchId), year.id).first()
    : null;
  if (body?.batchId && !batch) return fail(404, "Lot introuvable");
  return json({
    school: { name: year.school_name, address: year.school_address },
    year: { label: year.label },
    batch: batch ? { number: batch.number, delivery: batch.delivery } : null,
    lines: results.map((l) => ({
      orderId: l.order_id, groupId: l.group_id, groupName: l.group_name || "(groupe supprimé)", childId: l.child_id,
      childNumber: l.child_number || 0, childFirstName: l.child_first_name || "",
      kind: l.kind, name: l.name, description: l.description, quantity: l.quantity, priceCents: l.price_cents,
      photoId: l.photo_id, galleryId: l.gallery_id || "", delivery: l.delivery, email: l.email, shippingName: l.shipping_name,
      shippingAddress: parseAddress(l.shipping_address), paidAt: l.paid_at,
    })),
  });
}

export async function handleSchoolShopAdmin(request, env, photographer, rest) {
  const [kind, id, sub] = rest;
  const method = request.method;
  if (kind === "years" && ["shop", "products", "starter-products", "shipping", "production"].includes(sub)) {
    const year = await ownedYear(env, photographer.id, id);
    if (!year) return fail(404, "Année introuvable");
    if (sub === "shop" && method === "GET") return shopForAdmin(env, photographer, year);
    if (sub === "products" && method === "POST") return createProduct(request, env, year);
    if (sub === "starter-products" && method === "POST") return addStarterProducts(env, year);
    if (sub === "shipping" && method === "POST") return setShipping(request, env, year);
    if (sub === "production" && method === "POST") return productionForYear(request, env, year);
  }
  if (kind === "products" && rest.length === 2 && method === "POST") return updateProduct(request, env, photographer, id);
  if (kind === "products" && rest.length === 2 && method === "DELETE") return deleteProduct(env, photographer, id);
  return null;
}

// Effacement d'années (établissement, année, compte supprimés) : gamme,
// commandes et lignes partent avec. `where` choisit les années, par exemple
// "id = ?" ou "school_id = ?".
export function eraseShopStatements(env, where, value) {
  const years = `SELECT id FROM school_years WHERE ${where}`;
  return [
    env.DB.prepare(`DELETE FROM school_order_lines WHERE order_id IN (SELECT id FROM school_orders WHERE year_id IN (${years}))`).bind(value),
    env.DB.prepare(`DELETE FROM school_orders WHERE year_id IN (${years})`).bind(value),
    env.DB.prepare(`DELETE FROM school_products WHERE year_id IN (${years})`).bind(value),
    env.DB.prepare(`DELETE FROM school_lab_batches WHERE year_id IN (${years})`).bind(value),
    env.DB.prepare(`DELETE FROM school_reminders WHERE year_id IN (${years})`).bind(value),
  ];
}

/* ---------- Côté famille ---------- */

// Mode de livraison possible aujourd'hui pour une année, ou null (fermé).
export function deliveryFor(year, at = now()) {
  if (year.status !== "open") return null;
  if (!year.order_deadline || at <= year.order_deadline) return "school";
  if (year.late_deadline && at <= year.late_deadline) return "home";
  return null;
}

// Gamme, livraison et commandes d'une famille, ajoutées à sa vue (family.js).
export async function shopForFamily(env, family, children) {
  const yearIds = [...new Set(children.map((c) => c.yearId))];
  const shops = {};
  for (const yearId of yearIds) {
    const year = await env.DB.prepare("SELECT * FROM school_years WHERE id = ?").bind(yearId).first();
    if (!year) continue;
    const delivery = deliveryFor(year);
    shops[yearId] = {
      delivery,
      homeShippingCents: year.home_shipping_cents || 0,
      // La composition labo reste côté photographe ; la famille voit le visuel.
      products: delivery ? (await listProducts(env, yearId, { activeOnly: true })).map((p) => {
        const { labItems, ...out } = productOut(p);
        void labItems;
        return out;
      }) : [],
    };
  }
  const { results: orders } = await env.DB.prepare(
    "SELECT * FROM school_orders WHERE family_id = ? AND status = 'paid' ORDER BY paid_at DESC LIMIT 50"
  ).bind(family.id).all();
  const out = [];
  for (const o of orders) {
    const { results: lines } = await env.DB.prepare("SELECT * FROM school_order_lines WHERE order_id = ?").bind(o.id).all();
    out.push({
      id: o.id, paidAt: o.paid_at, amountCents: o.amount_cents, delivery: o.delivery,
      lines: lines.map((l) => ({ id: l.id, childId: l.child_id, name: l.name, quantity: l.quantity, priceCents: l.price_cents, kind: l.kind, photoId: l.photo_id })),
    });
  }
  return { shops, orders: out };
}

// POST /api/family/checkout { items: [{ childId, productId, photoId, quantity }] }
export async function familyCheckout(request, env, family) {
  const body = await request.json().catch(() => null);
  const items = Array.isArray(body?.items) ? body.items.slice(0, MAX_LINES) : [];
  if (!items.length) return fail(400, "Votre panier est vide");
  // Retour toujours vers l'espace famille du site : jamais une adresse
  // fournie par le navigateur (redirection arbitraire après paiement).
  const returnUrl = `${String(env.PUBLIC_SITE_ORIGIN || "https://www.holypixx.com").replace(/\/+$/, "")}/ecole`;

  // Chaque article doit viser un enfant de la famille, un produit actif de
  // l'année de cet enfant, et une photo de cet enfant (ou la photo de groupe
  // de son groupe, selon le produit).
  const lines = [];
  let year = null;
  for (const item of items) {
    const row = await env.DB.prepare(
      `SELECT c.id AS child_id, c.first_name AS child_first_name, c.number AS child_number, c.group_id, g.gallery_id, y.*, p.id AS product_id, p.kind, p.scope, p.name, p.description, p.price_cents,
              s.photographer_id
       FROM family_children fc
       JOIN school_children c ON c.id = fc.child_id
       JOIN school_groups g ON g.id = c.group_id
       JOIN school_years y ON y.id = g.year_id
       JOIN schools s ON s.id = y.school_id
       JOIN school_products p ON p.year_id = y.id AND p.id = ? AND p.active = 1
       WHERE fc.family_id = ? AND fc.child_id = ?`
    ).bind(String(item?.productId || ""), family.id, String(item?.childId || "")).first();
    if (!row) return fail(400, "Un article du panier n'est plus disponible : videz le panier et recommencez.");
    if (year && year.id !== row.id) return fail(400, "Une commande ne peut porter que sur un même établissement et une même année : passez une commande par établissement.");
    year = row;
    const photo = row.gallery_id && await env.DB.prepare(
      "SELECT id, school_role FROM photos WHERE id = ? AND gallery_id = ? AND ((child_id = ? AND school_role = '') OR school_role = 'group')"
    ).bind(String(item?.photoId || ""), row.gallery_id, row.child_id).first();
    if (!photo || (row.scope === "group") !== (photo.school_role === "group")) return fail(400, "La photo choisie ne correspond pas à cet article.");
    const quantity = Math.max(1, Math.min(MAX_QTY, Math.round(Number(item?.quantity) || 1)));
    lines.push({ ...row, photo_id: photo.id, quantity });
  }

  const delivery = deliveryFor(year);
  if (!delivery) return fail(409, "Les commandes sont closes pour cet établissement.");
  const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(year.photographer_id).first();
  if (!photographer?.stripe_account_id || !photographer.stripe_charges_enabled) {
    return fail(409, "Le paiement en ligne n'est pas encore ouvert par votre photographe.");
  }
  const shipping = delivery === "home" ? year.home_shipping_cents || 0 : 0;
  const amount = lines.reduce((n, l) => n + l.price_cents * l.quantity, 0) + shipping;
  const fee = feeCentsFor(schoolFeeRule(env, photographer), amount);
  const orderId = newId("sco");
  const kind = SCHOOL_KINDS[year.school_kind] || SCHOOL_KINDS.ecole;
  const statements = [
    env.DB.prepare(
      `INSERT INTO school_orders (id, year_id, family_id, email, delivery, shipping_cents, amount_cents, fee_cents, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).bind(orderId, year.id, family.id, family.email, delivery, shipping, amount, fee, now()),
    ...lines.map((l) => env.DB.prepare(
      `INSERT INTO school_order_lines (id, order_id, child_id, group_id, product_id, photo_id, kind, name, description, price_cents, quantity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(newId("sol"), orderId, l.child_id, l.group_id, l.product_id, l.photo_id, l.kind, l.name, l.description, l.price_cents, l.quantity)),
  ];
  await env.DB.batch(statements);

  const sep = returnUrl.includes("?") ? "&" : "?";
  try {
    const session = await createSchoolCheckout(env, photographer.stripe_account_id, {
      lineItems: [
        ...lines.map((l) => ({ name: `${l.name} — ${l.child_first_name || `enfant n° ${l.child_number}`}`, unitAmountCents: l.price_cents, quantity: l.quantity })),
        ...(shipping ? [{ name: "Livraison à domicile", unitAmountCents: shipping, quantity: 1 }] : []),
      ],
      email: family.email,
      collectShipping: delivery === "home",
      successUrl: `${returnUrl}${sep}commande=merci&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${returnUrl}${sep}commande=annulee`,
      metadata: { kind: "school", school_order_id: orderId, delivery, group_word: kind.group },
      applicationFeeCents: fee,
    });
    await env.DB.prepare("UPDATE school_orders SET stripe_session_id = ? WHERE id = ?").bind(session.id, orderId).run();
    return json({ url: session.url, orderId });
  } catch (err) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM school_order_lines WHERE order_id IN (SELECT id FROM school_orders WHERE id = ? AND status = 'pending')").bind(orderId),
      env.DB.prepare("DELETE FROM school_orders WHERE id = ? AND status = 'pending'").bind(orderId),
    ]);
    return fail(502, err.stripeNotConfigured ? "Le paiement en ligne n'est pas encore configuré." : "Le paiement n'a pas pu démarrer. Réessayez dans un instant.");
  }
}

// Marque une commande payée (webhook ou retour de Stripe) ; idempotent.
export async function markSchoolOrderPaid(env, session) {
  if (!session?.id || session.payment_status !== "paid") return false;
  const orderId = session.metadata?.school_order_id;
  if (!orderId) return false;
  const shipping = session.collected_information?.shipping_details || session.shipping_details || null;
  const result = await env.DB.prepare(
    `UPDATE school_orders SET status = 'paid', paid_at = ?, shipping_name = ?, shipping_address = ?
     WHERE id = ? AND stripe_session_id = ? AND status != 'paid'`
  ).bind(now(), shipping?.name || "", shipping?.address ? JSON.stringify(shipping.address) : "", orderId, session.id).run();
  if (!result?.meta?.changes) return false;
  // Première confirmation seulement (webhook et retour de Stripe peuvent se
  // croiser) ; l'e-mail est au mieux, jamais bloquant.
  try {
    await confirmToFamily(env, orderId);
  } catch (err) {
    console.error("Confirmation de commande scolaire non envoyée :", err);
  }
  return true;
}

async function confirmToFamily(env, orderId) {
  const order = await env.DB.prepare(
    `SELECT o.*, s.name AS school_name, p.studio_name FROM school_orders o JOIN school_years y ON y.id = o.year_id
     JOIN schools s ON s.id = y.school_id JOIN photographers p ON p.id = s.photographer_id WHERE o.id = ?`
  ).bind(orderId).first();
  if (!order?.email) return;
  const { results: lines } = await env.DB.prepare(
    `SELECT l.*, c.first_name, c.number FROM school_order_lines l LEFT JOIN school_children c ON c.id = l.child_id WHERE l.order_id = ?`
  ).bind(orderId).all();
  const origin = String(env.PUBLIC_SITE_ORIGIN || "https://www.holypixx.com").replace(/\/+$/, "");
  await sendSchoolOrderConfirmation(env, {
    to: order.email,
    studioName: order.studio_name || "",
    schoolName: order.school_name,
    delivery: order.delivery,
    lines: lines.map((l) => ({ name: l.name, quantity: l.quantity, priceCents: l.price_cents, childName: l.first_name || `enfant n° ${l.number || "?"}` })),
    shippingCents: order.shipping_cents,
    totalCents: order.amount_cents,
    familyUrl: `${origin}/ecole`,
    hasDigital: lines.some((l) => l.kind === "numerique"),
  });
}

// POST /api/family/checkout/sync { sessionId } — retour de Stripe : relit la
// session sans attendre le webhook.
export async function familyCheckoutSync(request, env, family) {
  const body = await request.json().catch(() => null);
  const sessionId = String(body?.sessionId || "");
  const order = await env.DB.prepare("SELECT * FROM school_orders WHERE stripe_session_id = ? AND family_id = ?").bind(sessionId, family.id).first();
  if (!order) return fail(404, "Commande introuvable");
  if (order.status !== "paid") {
    try {
      await markSchoolOrderPaid(env, await retrieveCheckoutSession(env, sessionId));
    } catch {
      /* le webhook prendra le relais */
    }
  }
  const fresh = await env.DB.prepare("SELECT status FROM school_orders WHERE id = ?").bind(order.id).first();
  return json({ paid: fresh?.status === "paid" });
}

// GET /api/family/download/:lineId — fichier numérique acheté (fichier
// d'impression, sans filigrane), pour une commande payée de la famille.
export async function familyDownload(env, family, lineId) {
  const line = await env.DB.prepare(
    `SELECT l.photo_id, l.name, p.gallery_id FROM school_order_lines l JOIN school_orders o ON o.id = l.order_id
     JOIN photos p ON p.id = l.photo_id
     WHERE l.id = ? AND o.family_id = ? AND o.status = 'paid' AND l.kind = 'numerique'`
  ).bind(lineId, family.id).first();
  if (!line) return fail(404, "Fichier introuvable");
  const object = await env.TILES.get(originalKey(line.gallery_id, line.photo_id));
  if (!object) return fail(404, "Fichier introuvable");
  return new Response(object.body, {
    headers: {
      "content-type": "image/jpeg",
      "content-disposition": `attachment; filename="photo-${line.photo_id.slice(-6)}.jpg"`,
      "cache-control": "private, no-store",
    },
  });
}

// Passe quotidienne : un panier parti vers Stripe et jamais payé (page
// fermée, paiement abandonné) ne sert plus après deux jours — la session
// Stripe expire au bout de 24 heures.
export function purgePendingOrdersStatements(env, at = now()) {
  const cutoff = at - 2 * 24 * 60 * 60;
  return [
    env.DB.prepare(`DELETE FROM school_order_lines WHERE order_id IN (SELECT id FROM school_orders WHERE status = 'pending' AND created_at < ?)`).bind(cutoff),
    env.DB.prepare("DELETE FROM school_orders WHERE status = 'pending' AND created_at < ?").bind(cutoff),
  ];
}
