// Envoi des commandes scolaires au labo, par lots.
//
// Le photographe encaisse les commandes des familles sur son compte Stripe,
// puis, une ou deux fois pendant la vente (conseil du labo), regroupe les
// articles payés pas encore partis en un LOT : un pour l'établissement
// (livraison groupée), un pour les envois à domicile. Un article
// n'appartient qu'à un lot : il ne part jamais deux fois. Chaque lot a son
// fichier de production (admin-server) ; il peut partir à la main, ou
// directement chez BePhoto si le photographe a connecté son compte.
//
// Envoi à BePhoto pas à pas : au départ, le lot devient un PLAN figé
// d'opérations (créer la commande, son adresse, une enveloppe par enfant,
// ajouter les tirages, demander le prix, attendre la confirmation du
// photographe, confirmer) ; chaque appel en exécute quelques-unes et avance
// un curseur, pour rester sous les limites d'un appel du Worker et reprendre
// là où l'on s'était arrêté après une coupure. Rien n'est imprimé avant que
// le photographe ait vu le prix annoncé par le labo et confirmé.
//
// - Lot « établissement » : une commande, une sous-commande (enveloppe) par
//   enfant, triées par classe puis par enfant ; livrée à l'établissement, à
//   l'adresse du compte BePhoto ou enlevée chez BePhoto.
// - Lot « à domicile » : une commande par famille, livrée à son adresse,
//   avec le nom de l'enfant au dos de chaque photo.
//
// BePhoto vient chercher chaque fichier d'impression par une adresse signée,
// valable tant que le lot est récent.

import { json, fail } from "./http.js";
import { randomBytes, b64url } from "./auth.js";
import { encryptApiKey, decryptApiKey, signFor, verifySignature } from "./prodigi.js";
import { originalKey } from "./storage.js";
import {
  BephotoError, PAPERS, PRODUCTS_PER_CALL, bephotoLogin, bephotoLoginKey, bephotoProducts, bephotoCreateOrder,
  bephotoSetShipping, bephotoShippingAddress, bephotoCreateSuborder, bephotoAddProducts, bephotoOrderPrice,
  bephotoCloseOrder, bephotoCalculate, labFilename, normalizeLabItems, envelopeLabel, backprintText, splitName,
  parseAddressText, labShippingAddress,
  BEPHOTO_PLANCHES, BEPHOTO_PREVIEW_BASE, plancheById, planchePreviewPath, plancheRange, plancheSheet,
} from "./bephoto.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Lignes transmises par appel : quelques requêtes chacune (fichier, labo,
// base), bien sous les limites d'un appel du Worker.
// Poids maximal d'une étape d'envoi : un appel au labo compte 1, chaque
// fichier joint compte 1 de plus (lecture dans R2).
export const STEP_BUDGET = 24;
// Livraison d'un lot « établissement ».
export const SCHOOL_SHIPPING = ["school", "account", "pickup"];
// Simulations de prix d'un lot à domicile (une par famille), au plus.
const ESTIMATE_MAX_ORDERS = 25;
// Le labo peut retélécharger un fichier pendant ce délai après l'envoi.
const FILE_LINK_DAYS = 60;

function now() {
  return Math.floor(Date.now() / 1000);
}
function newId(prefix) {
  return `${prefix}_${b64url(randomBytes(9))}`;
}
function parseJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

/* ---------- Compte BePhoto du photographe ---------- */

// Connecté par clé d'API (recommandé : pas de mot de passe chez nous) ou par
// e-mail et mot de passe.
function isConnected(photographer) {
  return Boolean(photographer.bephoto_key_enc || photographer.bephoto_password_enc);
}

function labAccountOut(photographer) {
  const method = photographer.bephoto_key_enc ? "key" : photographer.bephoto_password_enc ? "password" : "";
  return { connected: Boolean(method), method, email: method === "password" ? photographer.bephoto_email || "" : "", papers: PAPERS };
}

async function connectAccount(request, env, photographer) {
  const body = await request.json().catch(() => null);
  const apiKey = String(body?.apiKey || "").trim();
  if (apiKey) {
    if (apiKey.length > 500 || /\s/.test(apiKey)) return fail(400, "Clé d'API invalide");
    let token;
    try {
      token = await bephotoLoginKey(env, apiKey);
    } catch (err) {
      if (err instanceof BephotoError) return fail(err.unauthorized ? 400 : 502, err.unauthorized ? "BePhoto refuse cette clé d'API." : err.message);
      throw err;
    }
    await env.DB.prepare(
      "UPDATE photographers SET bephoto_email = '', bephoto_password_enc = '', bephoto_key_enc = ?, bephoto_token_enc = ? WHERE id = ?"
    ).bind(await encryptApiKey(env.AUTH_SECRET, apiKey), await encryptApiKey(env.AUTH_SECRET, token), photographer.id).run();
    return json({ connected: true, method: "key", email: "", papers: PAPERS });
  }
  const email = String(body?.email || "").trim().toLowerCase().slice(0, 200);
  const password = String(body?.password || "");
  if (!EMAIL_RE.test(email)) return fail(400, "Indiquez votre clé d'API BePhoto, ou l'e-mail et le mot de passe du compte.");
  if (!password || password.length > 200) return fail(400, "Mot de passe requis");
  let token;
  try {
    token = await bephotoLogin(env, email, password);
  } catch (err) {
    if (err instanceof BephotoError) {
      return fail(err.unauthorized ? 400 : 502, err.unauthorized ? "BePhoto refuse cet e-mail ou ce mot de passe." : err.message);
    }
    throw err;
  }
  await env.DB.prepare(
    "UPDATE photographers SET bephoto_email = ?, bephoto_password_enc = ?, bephoto_key_enc = '', bephoto_token_enc = ? WHERE id = ?"
  ).bind(email, await encryptApiKey(env.AUTH_SECRET, password), await encryptApiKey(env.AUTH_SECRET, token), photographer.id).run();
  return json({ connected: true, method: "password", email, papers: PAPERS });
}

async function disconnectAccount(env, photographer) {
  await env.DB.prepare(
    "UPDATE photographers SET bephoto_email = '', bephoto_password_enc = '', bephoto_key_enc = '', bephoto_token_enc = '' WHERE id = ?"
  ).bind(photographer.id).run();
  return json({ connected: false, method: "", email: "", papers: PAPERS });
}

// Appelle BePhoto avec le jeton gardé ; s'il a expiré, se reconnecte une
// fois (clé d'API ou identifiants chiffrés) et garde le nouveau jeton.
async function withBephoto(env, photographer, fn) {
  if (!isConnected(photographer)) throw new BephotoError("Connectez d'abord votre compte BePhoto.", { status: 409 });
  let token = await decryptApiKey(env.AUTH_SECRET, photographer.bephoto_token_enc);
  const relogin = async () => {
    if (photographer.bephoto_key_enc) {
      token = await bephotoLoginKey(env, await decryptApiKey(env.AUTH_SECRET, photographer.bephoto_key_enc));
    } else {
      const password = await decryptApiKey(env.AUTH_SECRET, photographer.bephoto_password_enc);
      token = await bephotoLogin(env, photographer.bephoto_email, password);
    }
    photographer.bephoto_token_enc = await encryptApiKey(env.AUTH_SECRET, token);
    await env.DB.prepare("UPDATE photographers SET bephoto_token_enc = ? WHERE id = ?").bind(photographer.bephoto_token_enc, photographer.id).run();
  };
  if (!token) await relogin();
  try {
    return await fn(token);
  } catch (err) {
    if (!(err instanceof BephotoError) || !err.unauthorized) throw err;
    await relogin();
    return fn(token);
  }
}

function labFailure(err) {
  if (err instanceof BephotoError) {
    if (err.status === 409) return fail(409, err.message);
    return fail(502, err.unauthorized ? "BePhoto refuse la connexion : vérifiez votre compte BePhoto." : err.message);
  }
  throw err;
}

async function labProducts(env, photographer) {
  try {
    return json({ products: await withBephoto(env, photographer, (token) => bephotoProducts(env, token)), papers: PAPERS });
  } catch (err) {
    return labFailure(err);
  }
}

// GET …/lab/catalogue — de quoi composer un produit, même sans compte
// connecté : les planches de la grille publique (avec leur visuel et leur
// fourchette de prix), puis, si le compte est connecté, les autres produits
// du catalogue BePhoto : montages de son compte (pochettes, planches
// d'identité, montages scolaires) et tirages simples.
async function labCatalogue(env, photographer) {
  const planches = BEPHOTO_PLANCHES.map((p) => ({
    idproduct: p.id, name: p.label, labName: p.name, sheet: plancheSheet(p), dimensions: p.dimensions, preview: planchePreviewPath(p.id),
    ...plancheRange(p), tiers: p.cents, planche: true,
  }));
  let others = [];
  let warning = "";
  if (isConnected(photographer)) {
    try {
      const ids = new Set(BEPHOTO_PLANCHES.map((p) => p.id));
      others = (await withBephoto(env, photographer, (token) => bephotoProducts(env, token)))
        .filter((p) => !ids.has(p.idproduct))
        .map((p) => ({ idproduct: p.idproduct, name: p.name, dimensions: p.dimensions, preview: "", prices: p.prices, planche: false, montage: p.montage }));
    } catch (err) {
      if (!(err instanceof BephotoError)) throw err;
      warning = "Le catalogue BePhoto ne répond pas : seules les planches sont proposées.";
    }
  }
  return json({ planches, others, connected: isConnected(photographer), papers: PAPERS, warning });
}

/* ---------- Visuels des planches ---------- */

// GET /api/lab-previews/bephoto/:id.jpg — visuel d'exemple d'une planche,
// public (une illustration de produit, rien de personnel). Recopié une fois
// depuis le labo dans R2, puis servi depuis chez nous : seules les planches
// connues sont servies, ce n'est jamais un relais ouvert.
export async function handleLabPreview(env, file) {
  const planche = plancheById(String(file || "").replace(/\.jpg$/i, ""));
  if (!planche?.preview) return fail(404, "Visuel inconnu");
  const key = `lab-previews/bephoto/${planche.preview.split("/").pop()}`;
  let object = await env.TILES.get(key);
  if (!object) {
    let response;
    try {
      response = await fetch(String(env.BEPHOTO_PREVIEW_BASE || BEPHOTO_PREVIEW_BASE).replace(/\/+$/, "") + planche.preview);
    } catch {
      return fail(502, "Visuel indisponible");
    }
    const type = response.headers.get("content-type") || "";
    const bytes = response.ok && /^image\/jpe?g/i.test(type) ? new Uint8Array(await response.arrayBuffer()) : null;
    if (!bytes || bytes.length > 3 * 1024 * 1024) return fail(502, "Visuel indisponible");
    await env.TILES.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
    object = await env.TILES.get(key);
    if (!object) return fail(502, "Visuel indisponible");
  }
  return new Response(object.body, {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=604800" },
  });
}

/* ---------- Composition labo d'un produit ---------- */

async function setProductLab(request, env, photographer, productId) {
  const product = await env.DB.prepare(
    `SELECT p.id, p.kind FROM school_products p JOIN school_years y ON y.id = p.year_id JOIN schools s ON s.id = y.school_id
     WHERE p.id = ? AND s.photographer_id = ?`
  ).bind(productId, photographer.id).first();
  if (!product) return fail(404, "Produit introuvable");
  if (product.kind === "numerique") return fail(400, "Un fichier numérique ne s'imprime pas");
  const body = await request.json().catch(() => null);
  const checked = normalizeLabItems(body?.items);
  if (checked.error) return fail(400, checked.error);
  await env.DB.prepare("UPDATE school_products SET lab_items = ? WHERE id = ?")
    .bind(checked.items.length ? JSON.stringify(checked.items) : "", productId).run();
  return json({ labItems: checked.items });
}

/* ---------- Lots ---------- */

async function ownedYear(env, photographerId, yearId) {
  return env.DB.prepare(
    `SELECT y.*, s.name AS school_name, s.address AS school_address
     FROM school_years y JOIN schools s ON s.id = y.school_id WHERE y.id = ? AND s.photographer_id = ?`
  ).bind(yearId, photographerId).first();
}

async function ownedBatch(env, photographerId, batchId) {
  return env.DB.prepare(
    `SELECT b.*, y.label AS year_label, s.name AS school_name, s.address AS school_address,
            s.contact_name AS school_contact, s.contact_email AS school_email
     FROM school_lab_batches b JOIN school_years y ON y.id = b.year_id JOIN schools s ON s.id = y.school_id
     WHERE b.id = ? AND s.photographer_id = ?`
  ).bind(batchId, photographerId).first();
}

// Articles payés, imprimables, pas encore dans un lot.
const PENDING_WHERE = `o.year_id = ? AND o.status = 'paid' AND o.delivery = ? AND l.kind != 'numerique' AND l.batch_id = ''`;

async function batchesForYear(env, photographer, year) {
  const pending = {};
  for (const delivery of ["school", "home"]) {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS lines, COALESCE(SUM(l.quantity), 0) AS quantity, COUNT(DISTINCT l.child_id) AS children,
              COUNT(DISTINCT o.id) AS orders
       FROM school_order_lines l JOIN school_orders o ON o.id = l.order_id WHERE ${PENDING_WHERE}`
    ).bind(year.id, delivery).first();
    pending[delivery] = { lines: row?.lines || 0, quantity: row?.quantity || 0, children: row?.children || 0, orders: row?.orders || 0 };
  }
  const { results } = await env.DB.prepare(
    `SELECT b.*, (SELECT COUNT(*) FROM school_order_lines l WHERE l.batch_id = b.id) AS lines,
            (SELECT COALESCE(SUM(l.quantity), 0) FROM school_order_lines l WHERE l.batch_id = b.id) AS quantity,
            (SELECT COUNT(DISTINCT l.child_id) FROM school_order_lines l WHERE l.batch_id = b.id) AS children
     FROM school_lab_batches b WHERE b.year_id = ? ORDER BY b.number DESC`
  ).bind(year.id).all();
  const { results: unmapped } = await env.DB.prepare(
    "SELECT name FROM school_products WHERE year_id = ? AND kind != 'numerique' AND active = 1 AND lab_items = '' ORDER BY sort"
  ).bind(year.id).all();
  return json({
    pending,
    batches: results.map((b) => ({
      id: b.id, number: b.number, delivery: b.delivery, status: b.status, lab: b.lab, labOrderId: b.lab_order_id,
      labOrders: b.lab_order_id ? b.lab_order_id.split(",").map((x) => x.trim()).filter(Boolean) : [],
      shipping: b.lab_shipping || "",
      lines: b.lines, quantity: b.quantity, children: b.children, createdAt: b.created_at, sentAt: b.sent_at,
      error: b.error, progress: b.status === "sending" ? { sent: b.lab_cursor, total: parseJson(b.lab_items, {}).ops?.length || 0 } : null,
      labTotal: parseJson(b.lab_total, null),
    })),
    lab: labAccountOut(photographer),
    schoolAddress: Boolean(parseAddressText(year.school_address)),
    unmappedProducts: unmapped.map((p) => p.name),
  });
}

// POST …/years/:id/batches { delivery: "school" | "home" }
async function createBatch(request, env, year) {
  const body = await request.json().catch(() => ({}));
  const delivery = body?.delivery === "home" ? "home" : "school";
  const waiting = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM school_order_lines l JOIN school_orders o ON o.id = l.order_id WHERE ${PENDING_WHERE}`
  ).bind(year.id, delivery).first();
  if (!waiting?.n) return fail(400, delivery === "home" ? "Aucun envoi à domicile en attente." : "Aucun article en attente pour l'établissement.");
  const id = newId("slb");
  const next = await env.DB.prepare("SELECT COALESCE(MAX(number), 0) + 1 AS n FROM school_lab_batches WHERE year_id = ?").bind(year.id).first();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO school_lab_batches (id, year_id, number, delivery, status, created_at) VALUES (?, ?, ?, ?, 'ready', ?)")
      .bind(id, year.id, next?.n || 1, delivery, now()),
    env.DB.prepare(
      `UPDATE school_order_lines SET batch_id = ? WHERE id IN (
         SELECT l.id FROM school_order_lines l JOIN school_orders o ON o.id = l.order_id WHERE ${PENDING_WHERE})`
    ).bind(id, year.id, delivery),
  ]);
  return json({ id, number: next?.n || 1 }, { status: 201 });
}

// POST …/batches/:id { status: "sent" } — parti à la main (fichier de production).
async function markSent(request, env, batch) {
  const body = await request.json().catch(() => null);
  if (body?.status !== "sent") return fail(400, "Statut inconnu");
  if (batch.status !== "ready") return fail(409, "Ce lot est déjà parti ou en cours d'envoi.");
  await env.DB.prepare("UPDATE school_lab_batches SET status = 'sent', sent_at = ? WHERE id = ? AND status = 'ready'").bind(now(), batch.id).run();
  return json({ ok: true });
}

// DELETE …/batches/:id — annule un lot pas encore parti : ses articles
// retournent en attente. Possible aussi quand le prix BePhoto attend la
// confirmation : la commande, jamais confirmée, n'est pas imprimée.
async function cancelBatch(env, batch) {
  if (batch.status !== "ready" && batch.status !== "priced") return fail(409, "Un lot parti (ou en cours d'envoi) ne s'annule plus.");
  await env.DB.batch([
    env.DB.prepare("UPDATE school_order_lines SET batch_id = '' WHERE batch_id = ?").bind(batch.id),
    env.DB.prepare("DELETE FROM school_lab_batches WHERE id = ? AND status IN ('ready', 'priced')").bind(batch.id),
  ]);
  return json({ ok: true });
}

// Ce qui part chez BePhoto, ligne par ligne, figé au début de l'envoi :
// chaque article commandé × sa composition labo, rangé par groupe puis par
// enfant (le nom de fichier porte ce rangement) ; pour les envois à
// domicile, d'abord par commande de famille.
async function labItemsForBatch(env, batch) {
  const { results: lines } = await env.DB.prepare(
    `SELECT l.id, l.photo_id, l.name, l.quantity, l.group_id, l.child_id, l.order_id, p.lab_items, c.number AS child_number,
            c.first_name, g.name AS group_name, ph.gallery_id, o.shipping_name, o.shipping_address, o.email
     FROM school_order_lines l
     JOIN school_orders o ON o.id = l.order_id
     LEFT JOIN school_products p ON p.id = l.product_id
     LEFT JOIN school_children c ON c.id = l.child_id
     LEFT JOIN school_groups g ON g.id = l.group_id
     LEFT JOIN photos ph ON ph.id = l.photo_id
     WHERE l.batch_id = ?
     ORDER BY ${batch.delivery === "home" ? "o.paid_at, o.id, " : ""}g.sort, g.name COLLATE NOCASE, c.number, l.id`
  ).bind(batch.id).all();
  const missing = [...new Set(lines.filter((l) => !parseJson(l.lab_items, []).length).map((l) => l.name))];
  if (missing.length) return { error: `Indiquez d'abord ce que le labo imprime pour : ${missing.join(", ")} (Gamme et prix → Labo).` };
  if (lines.some((l) => !l.gallery_id)) return { error: "Une photo commandée n'existe plus : retirez-la du lot avant l'envoi." };
  const groupIndex = new Map();
  const items = [];
  for (const l of lines) {
    if (!groupIndex.has(l.group_id)) groupIndex.set(l.group_id, groupIndex.size + 1);
    const child = { groupName: l.group_name, childNumber: l.child_number, childFirstName: l.first_name };
    for (const part of parseJson(l.lab_items, [])) {
      items.push({
        photoId: l.photo_id, galleryId: l.gallery_id,
        idproduct: part.idproduct, idpaper: part.idpaper, quantity: part.quantity * l.quantity,
        filename: labFilename({
          groupIndex: groupIndex.get(l.group_id), groupName: l.group_name, childNumber: l.child_number,
          childFirstName: l.first_name, productName: l.name, part: part.label || `p${part.idproduct}`,
        }),
        envelope: l.child_id ? `c:${l.child_id}` : `o:${l.order_id}`,
        label: envelopeLabel(child), backprint: backprintText(child),
        orderId: l.order_id, shippingName: l.shipping_name, shippingAddress: l.shipping_address, email: l.email,
      });
    }
  }
  return { items };
}

// Regroupe en gardant l'ordre de première apparition.
function groupInOrder(items, keyOf) {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.values()];
}

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Adresse de l'établissement pour BePhoto (fiche de l'établissement, texte
// libre) ; null si rue, code postal ou localité manquent.
export function schoolLabAddress(batch) {
  const parsed = parseAddressText(batch.school_address);
  if (!parsed) return null;
  const who = splitName(batch.school_contact) || { prenom: "Direction", nom: String(batch.school_name || "École") };
  return {
    nom: who.nom.slice(0, 100), prenom: who.prenom.slice(0, 100), societe: String(batch.school_name || "").slice(0, 100),
    ...parsed, email: String(batch.school_email || "").slice(0, 200),
  };
}

const fileItem = (item, withBackprint) => ({
  photoId: item.photoId, galleryId: item.galleryId, idproduct: item.idproduct, idpaper: item.idpaper,
  quantity: item.quantity, filename: item.filename, ...(withBackprint ? { backprint: item.backprint } : {}),
});

// Plan d'envoi d'un lot : la liste figée des opérations chez BePhoto.
export function buildLabPlan(batch, items, shipping) {
  const base = ["Holypixx", batch.school_name, batch.year_label, `Lot ${batch.number}`];
  const ops = [];
  let orders = 0;
  let envelopes = 0;
  if (batch.delivery === "home") {
    const families = groupInOrder(items, (i) => i.orderId);
    const incomplete = [];
    for (const familyItems of families) {
      const first = familyItems[0];
      const address = labShippingAddress(first.shippingName, parseJson(first.shippingAddress, null), { email: first.email });
      if (!address) { incomplete.push(first.shippingName || first.email || first.orderId); continue; }
      const o = orders++;
      ops.push({ t: "order", o, metadata: [...base, `Famille ${first.shippingName}`].join(" · ") });
      ops.push({ t: "address", o, address });
      for (const chunk of chunks(familyItems, PRODUCTS_PER_CALL)) ops.push({ t: "add", o, items: chunk.map((i) => fileItem(i, true)) });
      ops.push({ t: "price", o });
    }
    if (incomplete.length) return { error: `Adresse de livraison incomplète pour : ${incomplete.slice(0, 5).join(", ")}${incomplete.length > 5 ? "…" : ""}. Envoyez ce lot avec son fichier de production.` };
  } else {
    let address = null;
    if (shipping === "school") {
      address = schoolLabAddress(batch);
      if (!address) {
        return { error: "Adresse de l'établissement incomplète : indiquez « rue et numéro, code postal localité » sur sa fiche, ou choisissez une autre livraison." };
      }
    }
    orders = 1;
    const where = shipping === "pickup" ? "Enlèvement chez BePhoto" : shipping === "school" ? `Livraison : ${address.adresse}, ${address.cp} ${address.localite}` : "Livraison : adresse du compte";
    ops.push({ t: "order", o: 0, metadata: [...base, where].join(" · ") });
    if (address) ops.push({ t: "address", o: 0, address });
    if (shipping === "pickup") ops.push({ t: "shipping", o: 0, method: "PICKUP" });
    // Une enveloppe par enfant, dans l'ordre classe puis enfant : BePhoto
    // les emballe dans l'ordre de création. Le libellé de l'enveloppe est
    // imprimé au dos des photos.
    for (const envelopeItems of groupInOrder(items, (i) => i.envelope)) {
      const e = envelopes++;
      ops.push({ t: "sub", o: 0, e, label: envelopeItems[0].label });
      for (const chunk of chunks(envelopeItems, PRODUCTS_PER_CALL)) ops.push({ t: "add", o: 0, e, items: chunk.map((i) => fileItem(i, false)) });
    }
    ops.push({ t: "price", o: 0 });
  }
  ops.push({ t: "confirm" });
  for (let o = 0; o < orders; o++) ops.push({ t: "close", o });
  return { plan: { v: 2, ops, orders, envelopes, items: items.length } };
}

// Prix annoncé par BePhoto pour tout le lot (somme des commandes).
export function labPriceSummary(plan, state, shipping) {
  const prices = Object.values(state.prices || {});
  const totals = Object.values(state.totals || {});
  return {
    orders: plan.orders, envelopes: plan.envelopes, shipping,
    productsCents: prices.reduce((sum, p) => sum + (p.productsCents || 0), 0),
    feesCents: prices.reduce((sum, p) => sum + (p.feesCents || 0), 0),
    feeEnvelopeCount: prices.reduce((sum, p) => sum + (p.feeEnvelopeCount || 0), 0),
    feeEnvelopes: prices.flatMap((p) => p.feeEnvelopes || []).slice(0, 30),
    totalCents: totals.length === plan.orders && totals.every((t) => Number.isFinite(t)) ? totals.reduce((sum, t) => sum + t, 0) : null,
  };
}

function fileUrl(origin, batchId, photoId, signature) {
  return `${origin}/api/school-lab-files/${encodeURIComponent(batchId)}/${encodeURIComponent(photoId)}.jpg?s=${signature}`;
}

async function runOp(env, photographer, batch, state, op, origin) {
  const lab = (fn) => withBephoto(env, photographer, fn);
  const orderId = () => {
    const id = state.ids.orders[op.o];
    if (!id) throw new BephotoError("Commande BePhoto introuvable pour cette étape", { status: 409 });
    return id;
  };
  if (op.t === "order") {
    const order = await lab((token) => bephotoCreateOrder(env, token, op.metadata));
    state.ids.orders[op.o] = String(order.idorder);
  } else if (op.t === "address") {
    await lab((token) => bephotoShippingAddress(env, token, orderId(), op.address));
  } else if (op.t === "shipping") {
    await lab((token) => bephotoSetShipping(env, token, orderId(), op.method));
  } else if (op.t === "sub") {
    const sub = await lab((token) => bephotoCreateSuborder(env, token, orderId(), op.label));
    state.ids.subs[op.e] = String(sub.idorder);
  } else if (op.t === "add") {
    const target = op.e !== undefined ? state.ids.subs[op.e] : orderId();
    if (!target) throw new BephotoError("Enveloppe BePhoto introuvable pour cette étape", { status: 409 });
    const products = [];
    for (const item of op.items) {
      const head = await env.TILES.head(originalKey(item.galleryId, item.photoId));
      if (!head) throw new BephotoError(`Fichier d'impression introuvable (${item.filename})`, { status: 409 });
      const signature = await signFor(env.AUTH_SECRET, `school-lab:${batch.id}:${item.photoId}`);
      products.push({
        idproduct: item.idproduct, idpaper: item.idpaper, quantity: item.quantity, backprint: item.backprint || "",
        fileurl: fileUrl(origin, batch.id, item.photoId, signature), filename: item.filename, filesize: head.size,
      });
    }
    await lab((token) => bephotoAddProducts(env, token, target, products));
  } else if (op.t === "price") {
    state.prices[op.o] = await lab((token) => bephotoOrderPrice(env, token, orderId()));
  } else if (op.t === "close") {
    state.totals[op.o] = (await lab((token) => bephotoCloseOrder(env, token, orderId()))).totalCents;
  }
}

const orderIdsOf = (state) => Object.keys(state.ids.orders).sort((a, b) => a - b).map((k) => state.ids.orders[k]).join(", ");

// Exécute les opérations suivantes du plan, dans la limite d'une étape.
async function runSteps(env, photographer, batch, origin) {
  const plan = parseJson(batch.lab_items, null);
  const state = parseJson(batch.lab_state, null) || { ids: { orders: {}, subs: {} }, prices: {}, totals: {} };
  if (!plan || plan.v !== 2) return fail(409, "Cet envoi a été préparé par une ancienne version : contactez le support.");
  let cursor = batch.lab_cursor;
  let budget = STEP_BUDGET;
  while (cursor < plan.ops.length && budget > 0) {
    const op = plan.ops[cursor];
    if (op.t === "confirm") {
      const summary = labPriceSummary(plan, state, batch.lab_shipping);
      await env.DB.prepare(
        "UPDATE school_lab_batches SET status = 'priced', lab_total = ?, error = '' WHERE id = ? AND status = 'sending'"
      ).bind(JSON.stringify(summary), batch.id).run();
      return json({ done: false, awaiting: true, sent: cursor, total: plan.ops.length, labTotal: summary, labOrderId: orderIdsOf(state) });
    }
    await runOp(env, photographer, batch, state, op, origin);
    budget -= op.t === "add" ? 1 + op.items.length : 1;
    // Avancé opération par opération : une coupure ne renvoie jamais deux
    // fois la même ; une autre fenêtre qui envoie le même lot s'arrête.
    const saved = await env.DB.prepare(
      "UPDATE school_lab_batches SET lab_cursor = ?, lab_state = ?, lab_order_id = ?, error = '' WHERE id = ? AND lab_cursor = ?"
    ).bind(cursor + 1, JSON.stringify(state), orderIdsOf(state), batch.id, cursor).run();
    if (!saved?.meta?.changes) return fail(409, "Ce lot est en cours d'envoi depuis une autre fenêtre.");
    cursor++;
  }
  if (cursor < plan.ops.length) return json({ done: false, sent: cursor, total: plan.ops.length });
  const summary = labPriceSummary(plan, state, batch.lab_shipping);
  await env.DB.prepare("UPDATE school_lab_batches SET status = 'sent', sent_at = ?, lab_total = ?, error = '' WHERE id = ?")
    .bind(now(), JSON.stringify(summary), batch.id).run();
  return json({ done: true, sent: cursor, total: plan.ops.length, labTotal: summary, labOrderId: orderIdsOf(state) });
}

// POST …/batches/:id/send { shipping } — une étape de l'envoi à BePhoto ;
// l'interface rappelle jusqu'à `done`, ou jusqu'à `awaiting` (prix annoncé,
// à confirmer par le photographe).
async function sendStep(request, env, photographer, batch, origin) {
  if (batch.status === "sent") return json({ done: true, sent: 0, total: 0 });
  if (batch.status === "priced") return json({ done: false, awaiting: true, labTotal: parseJson(batch.lab_total, null) });
  const body = await request.json().catch(() => ({}));
  try {
    if (batch.status === "ready") {
      if (!isConnected(photographer)) return fail(409, "Connectez d'abord votre compte BePhoto.");
      const shipping = batch.delivery === "home" ? "home" : SCHOOL_SHIPPING.includes(body?.shipping) ? body.shipping : "account";
      const prepared = await labItemsForBatch(env, batch);
      if (prepared.error) return fail(409, prepared.error);
      const built = buildLabPlan(batch, prepared.items, shipping);
      if (built.error) return fail(409, built.error);
      const state = { ids: { orders: {}, subs: {} }, prices: {}, totals: {} };
      const started = await env.DB.prepare(
        `UPDATE school_lab_batches SET status = 'sending', lab = 'bephoto', lab_order_id = '', lab_items = ?, lab_state = ?, lab_cursor = 0,
                lab_shipping = ?, lab_total = '', error = ''
         WHERE id = ? AND status = 'ready'`
      ).bind(JSON.stringify(built.plan), JSON.stringify(state), shipping, batch.id).run();
      if (!started?.meta?.changes) return fail(409, "Ce lot vient d'être envoyé depuis une autre fenêtre.");
      batch = { ...batch, status: "sending", lab_items: JSON.stringify(built.plan), lab_state: JSON.stringify(state), lab_cursor: 0, lab_shipping: shipping };
    }
    return await runSteps(env, photographer, batch, origin);
  } catch (err) {
    if (err instanceof BephotoError) {
      await env.DB.prepare("UPDATE school_lab_batches SET error = ? WHERE id = ?").bind(err.message.slice(0, 300), batch.id).run();
    }
    return labFailure(err);
  }
}

// POST …/batches/:id/confirm — le photographe a vu le prix : la suite de
// l'envoi confirme les commandes chez BePhoto (elles partent en production).
async function confirmBatch(env, batch) {
  if (batch.status !== "priced") return fail(409, "Ce lot n'attend pas de confirmation.");
  const done = await env.DB.prepare(
    "UPDATE school_lab_batches SET status = 'sending', lab_cursor = lab_cursor + 1 WHERE id = ? AND status = 'priced'"
  ).bind(batch.id).run();
  if (!done?.meta?.changes) return fail(409, "Ce lot vient d'être confirmé depuis une autre fenêtre.");
  return json({ ok: true });
}

// POST …/batches/:id/estimate { shipping } — prix simulé chez BePhoto avant
// l'envoi (tirages et livraison, sans les frais d'enveloppe éventuels).
async function estimateBatch(request, env, photographer, batch) {
  if (batch.status !== "ready") return fail(409, "Ce lot est déjà parti chez BePhoto.");
  if (!isConnected(photographer)) return fail(409, "Connectez d'abord votre compte BePhoto.");
  const body = await request.json().catch(() => ({}));
  const shipping = batch.delivery === "home" ? "home" : SCHOOL_SHIPPING.includes(body?.shipping) ? body.shipping : "account";
  const prepared = await labItemsForBatch(env, batch);
  if (prepared.error) return fail(409, prepared.error);
  const built = buildLabPlan(batch, prepared.items, shipping);
  if (built.error) return fail(409, built.error);
  const perOrder = new Map();
  for (const op of built.plan.ops) {
    if (op.t === "add") perOrder.set(op.o, (perOrder.get(op.o) || []).concat(op.items));
  }
  const orders = [...perOrder.values()];
  const method = shipping === "pickup" ? "PICKUP" : "BPOST";
  const out = { orders: orders.length, estimated: 0, envelopes: built.plan.envelopes, shipping, productsCents: 0, shippingCents: 0, totalCents: 0 };
  try {
    for (const items of orders.slice(0, ESTIMATE_MAX_ORDERS)) {
      const price = await withBephoto(env, photographer, (token) => bephotoCalculate(env, token, items, method));
      out.productsCents += price.productsCents;
      out.shippingCents += price.shippingCents;
      out.totalCents += price.totalCents;
      out.estimated++;
    }
  } catch (err) {
    return labFailure(err);
  }
  return json(out);
}

/* ---------- Fichier d'impression, téléchargé par le labo ---------- */

// GET /api/school-lab-files/:batchId/:photoId.jpg?s=… — adresse signée,
// valable pour une photo de ce lot, tant que le lot est récent.
export async function handleLabFile(request, env, batchId, photoFile) {
  const photoId = photoFile.replace(/\.jpg$/i, "");
  const s = new URL(request.url).searchParams.get("s") || "";
  if (!(await verifySignature(env.AUTH_SECRET, `school-lab:${batchId}:${photoId}`, s))) return fail(403, "Lien invalide");
  const row = await env.DB.prepare(
    `SELECT b.status, b.sent_at, ph.gallery_id FROM school_lab_batches b
     JOIN school_order_lines l ON l.batch_id = b.id AND l.photo_id = ?
     JOIN photos ph ON ph.id = l.photo_id
     WHERE b.id = ? LIMIT 1`
  ).bind(photoId, batchId).first();
  if (!row || row.status === "ready") return fail(404, "Fichier indisponible");
  if (row.sent_at && now() - row.sent_at > FILE_LINK_DAYS * 86400) return fail(410, "Lien expiré");
  const object = await env.TILES.get(originalKey(row.gallery_id, photoId));
  if (!object) return fail(404, "Fichier indisponible");
  return new Response(object.body, {
    headers: { "content-type": "image/jpeg", "content-length": String(object.size), "cache-control": "private, no-store" },
  });
}

/* ---------- Routeur : /api/admin/school/… (null si la route n'est pas d'ici) ---------- */

export async function handleSchoolLabAdmin(request, env, photographer, rest, origin) {
  const [kind, id, sub] = rest;
  const method = request.method;
  if (kind === "lab" && rest.length === 1) {
    if (method === "GET") return json(labAccountOut(photographer));
    if (method === "POST") return connectAccount(request, env, photographer);
    if (method === "DELETE") return disconnectAccount(env, photographer);
  }
  if (kind === "lab" && id === "products" && rest.length === 2 && method === "GET") return labProducts(env, photographer);
  if (kind === "lab" && id === "catalogue" && rest.length === 2 && method === "GET") return labCatalogue(env, photographer);
  if (kind === "products" && sub === "lab" && rest.length === 3 && method === "POST") return setProductLab(request, env, photographer, id);
  if (kind === "years" && sub === "batches" && rest.length === 3) {
    const year = await ownedYear(env, photographer.id, id);
    if (!year) return fail(404, "Année introuvable");
    if (method === "GET") return batchesForYear(env, photographer, year);
    if (method === "POST") return createBatch(request, env, year);
  }
  if (kind === "batches" && (rest.length === 2 || (rest.length === 3 && ["send", "confirm", "estimate"].includes(sub)))) {
    const batch = await ownedBatch(env, photographer.id, id);
    if (!batch) return fail(404, "Lot introuvable");
    if (rest.length === 3 && method === "POST" && sub === "send") return sendStep(request, env, photographer, batch, origin);
    if (rest.length === 3 && method === "POST" && sub === "confirm") return confirmBatch(env, batch);
    if (rest.length === 3 && method === "POST" && sub === "estimate") return estimateBatch(request, env, photographer, batch);
    if (rest.length === 2 && method === "POST") return markSent(request, env, batch);
    if (rest.length === 2 && method === "DELETE") return cancelBatch(env, batch);
  }
  return null;
}
