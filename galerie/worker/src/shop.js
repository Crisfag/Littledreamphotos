// Boutique de tirages : réglages et catalogue (admin), commande (client),
// paiement → laboratoire Prodigi → suivi d'expédition.
//
// Le paiement réutilise tout le circuit des suppléments : une ligne
// `payments` (kind = 'print'), une session Stripe sur le compte Connect du
// photographe, le même webhook et la même facture automatique. Ce module
// n'ajoute que ce qui est propre aux tirages : le catalogue, la commande
// figée, l'envoi au labo et le suivi.

import { json, fail } from "./http.js";
import { randomBytes, b64url } from "./auth.js";
import { createCheckoutSession } from "./stripe.js";
import { createInvoiceForPayment, formatEuros } from "./invoices.js";
import { sendPrintOrderConfirmation, sendPrintOrderPhotographer, sendPrintOrderShipped } from "./notify.js";
import {
  SUGGESTED_PRODUCTS, SHOP_COUNTRIES, ORDER_STATUS_LABELS,
  encryptApiKey, decryptApiKey, signFor, verifySignature,
  normalizeRecipient, buildOrderLines, buildOrderPayload, buildQuotePayload,
  prodigiRequest, costFromQuote, statusFromProdigiOrder, availabilityFromDetails,
} from "./prodigi.js";
import { resolveSelection, catalogueForAdmin, categoryLabelFor, findProduct, skuFor, lookFor } from "./printCatalogue.js";

const MAX_ORIGINAL_BYTES = 60 * 1024 * 1024;
const MAX_PRODUCTS = 40;

function now() {
  return Math.floor(Date.now() / 1000);
}

function newId(prefix) {
  return `${prefix}_${b64url(randomBytes(9))}`;
}

export function originalKey(galleryId, photoId) {
  // Sous le préfixe de la photo : effacé avec elle (et avec la galerie) par
  // les boucles de suppression existantes, sans rien à ajouter. Jamais
  // atteignable par la route des tuiles, qui n'accepte que des nombres.
  return `${galleryId}/${photoId}/original.jpg`;
}

async function credentialsFor(env, photographer) {
  return {
    apiKey: await decryptApiKey(env.AUTH_SECRET, photographer.prodigi_api_key_enc),
    environment: photographer.prodigi_environment === "live" ? "live" : "sandbox",
  };
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function productOut(p) {
  return {
    id: p.id,
    label: p.label,
    sku: p.sku,
    attributes: parseJson(p.attributes || "{}", {}),
    priceCents: p.price_cents,
    active: Boolean(p.active),
    position: p.position,
    category: categoryLabelFor(p),
    fromCatalogue: Boolean(p.catalog_ref),
    costCents: p.cost_cents || 0,
    shipCostCents: p.ship_cost_cents || 0,
  };
}

function orderOut(o) {
  return {
    id: o.id,
    status: o.status,
    statusLabel: ORDER_STATUS_LABELS[o.status] || o.status,
    lines: parseJson(o.items, []),
    recipient: parseJson(o.recipient, {}),
    clientEmail: o.client_email,
    itemsCents: o.items_cents,
    shippingCents: o.shipping_cents,
    totalCents: o.total_cents,
    prodigiOrderId: o.prodigi_order_id,
    trackingUrl: o.tracking_url,
    error: o.error,
    createdAt: o.created_at,
    paidAt: o.paid_at,
    submittedAt: o.submitted_at,
  };
}

/* =================================================================
   Admin : réglages, catalogue, devis
   ================================================================= */

async function photographerRow(env, photographerId) {
  return env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(photographerId).first();
}

async function listProducts(env, photographerId) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM print_products WHERE photographer_id = ? ORDER BY position ASC, created_at ASC"
  )
    .bind(photographerId)
    .all();
  return results;
}

async function getShop(env, photographerId) {
  const photographer = await photographerRow(env, photographerId);
  if (!photographer) return fail(404, "Compte introuvable");
  const apiKey = await decryptApiKey(env.AUTH_SECRET, photographer.prodigi_api_key_enc);
  const products = await listProducts(env, photographerId);
  return json({
    settings: {
      connected: Boolean(apiKey),
      keyHint: apiKey ? `…${apiKey.slice(-4)}` : "",
      environment: photographer.prodigi_environment === "live" ? "live" : "sandbox",
      shippingCents: photographer.shop_shipping_cents || 0,
      stripeReady: Boolean(photographer.stripe_account_id) && Boolean(photographer.stripe_charges_enabled),
    },
    products: products.map(productOut),
    suggested: SUGGESTED_PRODUCTS,
    catalogue: catalogueForAdmin(),
    countries: SHOP_COUNTRIES,
  });
}

async function updateShopSettings(request, env, photographerId) {
  const body = await request.json().catch(() => null);
  if (!body) return fail(400, "Requête invalide");

  const environment = body.environment === "live" ? "live" : "sandbox";
  const shipping = Number(body.shippingCents ?? 0);
  if (!Number.isInteger(shipping) || shipping < 0 || shipping > 100000) return fail(400, "Frais de port invalides");

  const updates = ["prodigi_environment = ?", "shop_shipping_cents = ?"];
  const values = [environment, shipping];
  if (body.clearKey === true) {
    updates.push("prodigi_api_key_enc = ''");
  } else if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    const apiKey = body.apiKey.trim();
    if (apiKey.length > 200 || /\s/.test(apiKey)) return fail(400, "Clé Prodigi invalide");
    updates.push("prodigi_api_key_enc = ?");
    values.push(await encryptApiKey(env.AUTH_SECRET, apiKey));
  }
  await env.DB.prepare(`UPDATE photographers SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values, photographerId)
    .run();
  return json({ ok: true });
}

function normalizeProduct(body) {
  const label = String(body?.label ?? "").trim().slice(0, 100);
  const sku = String(body?.sku ?? "").trim().slice(0, 80);
  const priceCents = Number(body?.priceCents);
  let attributes = body?.attributes ?? {};
  if (typeof attributes === "string") attributes = parseJson(attributes || "{}", null);
  if (!label) return { error: "Le libellé est requis" };
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/.test(sku)) return { error: "Référence (SKU) Prodigi invalide" };
  if (!Number.isInteger(priceCents) || priceCents < 1 || priceCents > 1000000) return { error: "Prix invalide" };
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return { error: "Options (attributs) invalides : un objet JSON est attendu" };
  for (const [k, v] of Object.entries(attributes)) {
    if (typeof v !== "string" || k.length > 40 || v.length > 60) return { error: "Options (attributs) invalides" };
  }
  return {
    product: {
      label, sku, priceCents,
      attributes: JSON.stringify(attributes),
      active: body?.active === false ? 0 : 1,
    },
  };
}

// Coût communiqué par l'admin juste après son devis : purement indicatif
// (affichage de la marge), jamais utilisé pour facturer quoi que ce soit.
function costFrom(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 10000000 ? n : 0;
}

async function createProduct(request, env, photographerId) {
  const body = await request.json().catch(() => null);
  let catalogRef = "";
  let payload = body;
  // Choix fait dans les menus déroulants : le serveur traduit lui-même en
  // SKU et options, jamais à partir de ce que la page prétend.
  if (body && body.product) {
    const resolved = resolveSelection(body);
    if (resolved.error) return fail(400, resolved.error);
    catalogRef = resolved.ref;
    payload = { label: body.label || resolved.label, sku: resolved.sku, attributes: resolved.attributes, priceCents: body.priceCents, active: true };
  }
  const normalized = normalizeProduct(payload);
  if (normalized.error) return fail(400, normalized.error);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS last FROM print_products WHERE photographer_id = ?")
    .bind(photographerId)
    .first();
  if ((count?.n || 0) >= MAX_PRODUCTS) return fail(400, `Au plus ${MAX_PRODUCTS} formats`);
  const p = normalized.product;
  const id = newId("prd");
  await env.DB.prepare(
    `INSERT INTO print_products (id, photographer_id, label, sku, attributes, price_cents, active, position, catalog_ref, cost_cents, ship_cost_cents, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, photographerId, p.label, p.sku, p.attributes, p.priceCents, p.active, (count?.last ?? -1) + 1,
          catalogRef, costFrom(body?.costCents), costFrom(body?.shipCostCents), now())
    .run();
  return json({ id }, { status: 201 });
}

async function addSuggestedProducts(env, photographerId) {
  const existing = await listProducts(env, photographerId);
  const known = new Set(existing.map((p) => p.sku.toLowerCase()));
  let position = existing.reduce((max, p) => Math.max(max, p.position), -1);
  const statements = [];
  for (const s of SUGGESTED_PRODUCTS) {
    if (known.has(s.sku.toLowerCase())) continue;
    position += 1;
    statements.push(
      env.DB.prepare(
        `INSERT INTO print_products (id, photographer_id, label, sku, attributes, price_cents, active, position, catalog_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      ).bind(newId("prd"), photographerId, s.label, s.sku, JSON.stringify(s.attributes), s.priceCents, position, s.ref || "", now())
    );
  }
  if (statements.length) await env.DB.batch(statements);
  return json({ ok: true, added: statements.length });
}

async function updateProduct(request, env, photographerId, productId) {
  const existing = await env.DB.prepare("SELECT * FROM print_products WHERE id = ? AND photographer_id = ?")
    .bind(productId, photographerId)
    .first();
  if (!existing) return fail(404, "Format introuvable");
  const body = await request.json().catch(() => null);
  const normalized = normalizeProduct({
    label: body?.label ?? existing.label,
    sku: body?.sku ?? existing.sku,
    priceCents: body?.priceCents ?? existing.price_cents,
    attributes: body?.attributes ?? existing.attributes,
    active: body?.active ?? Boolean(existing.active),
  });
  if (normalized.error) return fail(400, normalized.error);
  const p = normalized.product;
  await env.DB.prepare(
    "UPDATE print_products SET label = ?, sku = ?, attributes = ?, price_cents = ?, active = ? WHERE id = ?"
  )
    .bind(p.label, p.sku, p.attributes, p.priceCents, p.active, productId)
    .run();
  return json({ ok: true });
}

async function deleteProduct(env, photographerId, productId) {
  const result = await env.DB.prepare("DELETE FROM print_products WHERE id = ? AND photographer_id = ?")
    .bind(productId, photographerId)
    .run();
  if (!result.meta || result.meta.changes === 0) return fail(404, "Format introuvable");
  return json({ ok: true });
}

// Devis réel Prodigi pour chaque format actif : coût du labo (produit +
// port) pour une unité livrée dans le pays choisi, comparé au prix de vente.
async function quoteProducts(request, env, photographerId) {
  const body = await request.json().catch(() => ({}));
  const countryCode = SHOP_COUNTRIES[String(body?.countryCode || "").toUpperCase()] ? String(body.countryCode).toUpperCase() : "BE";
  const photographer = await photographerRow(env, photographerId);
  const creds = await credentialsFor(env, photographer);
  if (!creds.apiKey) return fail(409, "Enregistrez d'abord votre clé Prodigi");
  const products = (await listProducts(env, photographerId)).filter((p) => p.active);
  const quotes = [];
  for (const product of products) {
    try {
      const data = await prodigiRequest(env, creds, "POST", "/quotes", buildQuotePayload({
        sku: product.sku,
        attributes: parseJson(product.attributes || "{}", {}),
        countryCode,
      }));
      const cost = costFromQuote(data);
      if (!cost) throw new Error("Devis illisible");
      await env.DB.prepare("UPDATE print_products SET cost_cents = ?, ship_cost_cents = ? WHERE id = ?")
        .bind(cost.itemsCents, cost.shippingCents, product.id)
        .run();
      quotes.push({
        productId: product.id,
        ...cost,
        totalCostCents: cost.itemsCents + cost.shippingCents,
        // Marge sur le produit : prix de vente moins coût du labo. La
        // livraison est couverte à part par le forfait de port.
        marginCents: product.price_cents - cost.itemsCents,
      });
    } catch (err) {
      quotes.push({ productId: product.id, error: err.message || "Devis refusé" });
    }
  }
  return json({ countryCode, quotes });
}

// Devis d'un choix fait dans les menus, avant de l'ajouter à la boutique :
// coût du produit et de la livraison, ou raison du refus du labo.
async function quoteSelection(request, env, photographerId) {
  const body = await request.json().catch(() => null);
  const resolved = resolveSelection(body || {});
  if (resolved.error) return fail(400, resolved.error);
  const countryCode = SHOP_COUNTRIES[String(body?.countryCode || "").toUpperCase()] ? String(body.countryCode).toUpperCase() : "BE";
  const photographer = await photographerRow(env, photographerId);
  const creds = await credentialsFor(env, photographer);
  if (!creds.apiKey) return fail(409, "Enregistrez d'abord votre clé Prodigi");
  try {
    const data = await prodigiRequest(env, creds, "POST", "/quotes", buildQuotePayload({ sku: resolved.sku, attributes: resolved.attributes, countryCode }));
    const cost = costFromQuote(data);
    if (!cost) throw new Error("Devis illisible");
    return json({ available: true, label: resolved.label, countryCode, ...cost });
  } catch (err) {
    if (err.prodigiStatus === 401) return fail(502, err.message);
    return json({ available: false, label: resolved.label, countryCode, error: err.message || "Indisponible chez le labo" });
  }
}

// Fiches produits Prodigi déjà lues, gardées quelques heures par instance du
// Worker : le catalogue du labo bouge rarement et l'admin redemande souvent
// la même catégorie. Une fiche introuvable est mémorisée aussi (null).
const DETAILS_TTL_MS = 6 * 60 * 60 * 1000;
const detailsCache = new Map();

async function productDetails(env, creds, sku) {
  const key = `${creds.environment}:${sku.toUpperCase()}`;
  const hit = detailsCache.get(key);
  if (hit && Date.now() - hit.at < DETAILS_TTL_MS) return hit.data;
  try {
    const data = await prodigiRequest(env, creds, "GET", `/products/${encodeURIComponent(sku)}`);
    detailsCache.set(key, { at: Date.now(), data });
    return data;
  } catch (err) {
    if (err.prodigiStatus === 404 || err.prodigiStatus === 400) {
      detailsCache.set(key, { at: Date.now(), data: null });
      return null;
    }
    throw err;
  }
}

// Formats réellement proposés par Prodigi pour un produit du catalogue :
// l'admin n'affiche que ceux-là dans ses menus, avec les options valides
// pour chacun. Une fiche qui n'a pas pu être lue (panne réseau) laisse le
// format affiché : le devis qui suit tranchera.
async function catalogueAvailability(request, env, photographerId) {
  const body = await request.json().catch(() => null);
  const found = findProduct(String(body?.product || ""));
  if (!found) return fail(400, "Produit inconnu");
  const { product } = found;
  const countryCode = SHOP_COUNTRIES[String(body?.countryCode || "").toUpperCase()] ? String(body.countryCode).toUpperCase() : "BE";
  const photographer = await photographerRow(env, photographerId);
  const creds = await credentialsFor(env, photographer);
  if (!creds.apiKey) return fail(409, "Enregistrez d'abord votre clé Prodigi");
  const optionAttribute = product.option?.attribute;
  const sizes = {};
  try {
    await Promise.all(product.sizes.map(async (size) => {
      try {
        const data = await productDetails(env, creds, skuFor(product, size));
        sizes[size] = data
          ? availabilityFromDetails(data, { optionAttribute, countryCode })
          : { available: false, reason: "Format absent du catalogue du labo" };
      } catch (err) {
        if (err.prodigiStatus === 401) throw err;
        sizes[size] = { available: true, allowed: null, unchecked: true };
      }
    }));
  } catch (err) {
    return fail(502, err.message);
  }
  return json({ product: product.key, countryCode, sizes });
}

async function setGalleryShop(request, env, gallery) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.enabled !== "boolean") return fail(400, "Requête invalide");
  await env.DB.prepare("UPDATE galleries SET shop_enabled = ? WHERE id = ?").bind(body.enabled ? 1 : 0, gallery.id).run();
  return json({ ok: true, enabled: body.enabled });
}

// Fichier d'impression d'une photo (pleine définition, sans filigrane) —
// envoyé par l'outil d'import, jamais servi au client : seul le labo le
// télécharge, par une URL signée propre à une commande payée.
async function putOriginal(request, env, photo) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_ORIGINAL_BYTES) return fail(413, "Fichier d'impression trop volumineux");
  await env.TILES.put(originalKey(photo.gallery_id, photo.id), request.body, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  await env.DB.prepare("UPDATE photos SET has_original = 1 WHERE id = ?").bind(photo.id).run();
  return json({ ok: true });
}

export async function listPrintOrders(env, { photographerId, galleryId }) {
  const query = galleryId
    ? env.DB.prepare("SELECT * FROM print_orders WHERE gallery_id = ? AND status != 'pending_payment' ORDER BY created_at DESC").bind(galleryId)
    : env.DB.prepare(
        `SELECT print_orders.*, galleries.slug AS gallery_slug, galleries.title AS gallery_title
         FROM print_orders JOIN galleries ON galleries.id = print_orders.gallery_id
         WHERE print_orders.photographer_id = ? AND print_orders.status != 'pending_payment'
         ORDER BY print_orders.created_at DESC LIMIT 200`
      ).bind(photographerId);
  const { results } = await query.all();
  return results.map((o) => ({ ...orderOut(o), gallerySlug: o.gallery_slug, galleryTitle: o.gallery_title }));
}

async function resubmitOrder(request, env, photographerId, orderId) {
  const order = await env.DB.prepare("SELECT * FROM print_orders WHERE id = ? AND photographer_id = ?")
    .bind(orderId, photographerId)
    .first();
  if (!order) return fail(404, "Commande introuvable");
  if (order.status !== "paid" && order.status !== "failed") {
    return fail(409, "Cette commande a déjà été transmise au laboratoire");
  }
  const result = await submitPrintOrder(env, order.id, new URL(request.url).origin);
  return json(result);
}

// Point d'entrée des routes admin de la boutique (déjà authentifiées).
// `helpers` vient de admin.js (cloisonnement des galeries et des photos).
export async function handleShopAdmin(request, env, photographerId, parts, helpers) {
  const section = parts[2];
  const method = request.method;

  if (section === "shop") {
    if (parts.length === 3 && method === "GET") return getShop(env, photographerId);
    if (parts.length === 4 && parts[3] === "settings" && method === "POST") return updateShopSettings(request, env, photographerId);
    if (parts.length === 4 && parts[3] === "quote" && method === "POST") return quoteProducts(request, env, photographerId);
    if (parts.length === 4 && parts[3] === "quote-item" && method === "POST") return quoteSelection(request, env, photographerId);
    if (parts.length === 4 && parts[3] === "availability" && method === "POST") return catalogueAvailability(request, env, photographerId);
    if (parts.length === 4 && parts[3] === "products" && method === "POST") return createProduct(request, env, photographerId);
    if (parts.length === 5 && parts[3] === "products" && parts[4] === "suggested" && method === "POST") return addSuggestedProducts(env, photographerId);
    if (parts.length === 5 && parts[3] === "products" && method === "PUT") return updateProduct(request, env, photographerId, parts[4]);
    if (parts.length === 5 && parts[3] === "products" && method === "DELETE") return deleteProduct(env, photographerId, parts[4]);
  }
  if (section === "print-orders") {
    if (parts.length === 3 && method === "GET") return json({ orders: await listPrintOrders(env, { photographerId }) });
    if (parts.length === 5 && parts[4] === "submit" && method === "POST") return resubmitOrder(request, env, photographerId, parts[3]);
  }
  if (section === "galleries" && parts.length === 5 && parts[4] === "shop" && method === "POST") {
    const gallery = await helpers.ownedGallery(env, photographerId, parts[3]);
    if (!gallery) return fail(404, "Galerie introuvable");
    return setGalleryShop(request, env, gallery);
  }
  if (section === "photos" && parts.length === 5 && parts[4] === "original" && method === "PUT") {
    const photo = await helpers.ownedPhoto(env, photographerId, parts[3]);
    if (!photo) return fail(404, "Photo introuvable");
    return putOriginal(request, env, photo);
  }
  return null;
}

/* =================================================================
   Client : boutique d'une galerie, commande
   ================================================================= */

async function shopState(env, gallery) {
  if (!gallery.shop_enabled) return null;
  const photographer = await photographerRow(env, gallery.photographer_id);
  if (!photographer?.prodigi_api_key_enc) return null;
  if (!photographer.stripe_account_id || !photographer.stripe_charges_enabled) return null;
  const products = (await listProducts(env, photographer.id)).filter((p) => p.active);
  if (!products.length) return null;
  return { photographer, products };
}

// Ce que la page cliente reçoit à la connexion : null si la boutique n'est
// pas ouverte (ou pas prête : clé, Stripe, catalogue), sinon les formats et
// les commandes déjà payées de cette galerie, avec leur suivi.
export async function shopForClient(env, gallery) {
  const state = await shopState(env, gallery);
  const orders = await listPrintOrders(env, { galleryId: gallery.id });
  const ordersOut = orders.map((o) => ({
    id: o.id,
    createdAt: o.createdAt,
    totalCents: o.totalCents,
    status: o.status,
    statusLabel: o.status === "failed" ? "En préparation" : o.statusLabel,
    trackingUrl: o.trackingUrl,
    count: o.lines.reduce((n, l) => n + l.copies, 0),
  }));
  if (!state) return { shop: null, printOrders: ordersOut };
  return {
    shop: {
      shippingCents: state.photographer.shop_shipping_cents || 0,
      countries: SHOP_COUNTRIES,
      products: state.products.map((p) => ({ id: p.id, label: p.label, priceCents: p.price_cents, look: lookFor(p) })),
    },
    printOrders: ordersOut,
  };
}

export async function handlePrintOrder(request, env, gallery) {
  const state = await shopState(env, gallery);
  if (!state) return fail(409, "La boutique de tirages n'est pas ouverte sur cette galerie");

  const body = await request.json().catch(() => null);
  if (!body) return fail(400, "Requête invalide");
  const successUrl = String(body.successUrl || "");
  const cancelUrl = String(body.cancelUrl || "");
  if (!/^https?:\/\//.test(successUrl) || !/^https?:\/\//.test(cancelUrl)) return fail(400, "URL de retour manquante");

  const normalized = normalizeRecipient(body.recipient);
  if (normalized.error) return fail(400, normalized.error);
  const recipient = normalized.recipient;

  const { results: photos } = await env.DB.prepare("SELECT id, position, has_original FROM photos WHERE gallery_id = ?")
    .bind(gallery.id)
    .all();
  const built = buildOrderLines(body.lines, {
    photosById: new Map(photos.map((p) => [p.id, p])),
    productsById: new Map(state.products.map((p) => [p.id, p])),
  });
  if (built.error) return fail(400, built.error);

  const shippingCents = state.photographer.shop_shipping_cents || 0;
  const totalCents = built.itemsCents + shippingCents;
  const paymentId = newId("pay");
  const orderId = newId("ord");
  const count = built.lines.reduce((n, l) => n + l.copies, 0);

  let session;
  try {
    session = await createCheckoutSession(env, state.photographer.stripe_account_id, {
      label: `${count} tirage${count > 1 ? "s" : ""} — ${gallery.title}${shippingCents ? " (port compris)" : ""}`,
      unitAmountCents: totalCents,
      quantity: 1,
      successUrl,
      cancelUrl,
      metadata: { gallery_id: gallery.id, payment_id: paymentId, print_order_id: orderId, kind: "print" },
    });
  } catch (err) {
    if (err.stripeNotConfigured) return fail(503, "Le paiement en ligne n'est pas encore activé");
    console.error("Échec de la création de la session Stripe (tirages) :", err);
    return fail(502, "Stripe a refusé la demande de paiement");
  }

  const ts = now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, status, kind, created_at)
       VALUES (?, ?, ?, 0, ?, 'pending', 'print', ?)`
    ).bind(paymentId, gallery.id, session.id, totalCents, ts),
    env.DB.prepare(
      `INSERT INTO print_orders (id, gallery_id, photographer_id, payment_id, status, items, recipient, client_email,
                                 items_cents, shipping_cents, total_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(orderId, gallery.id, state.photographer.id, paymentId, JSON.stringify(built.lines), JSON.stringify(recipient),
           recipient.email, built.itemsCents, shippingCents, totalCents, ts, ts),
  ]);

  return json({ url: session.url, orderId });
}

/* =================================================================
   Après paiement : facture, labo, e-mails
   ================================================================= */

async function assetUrl(env, origin, orderId, photoId) {
  const s = await signFor(env.AUTH_SECRET, `asset:${orderId}:${photoId}`);
  return `${origin}/api/print-assets/${encodeURIComponent(orderId)}/${encodeURIComponent(photoId)}?s=${s}`;
}

async function callbackUrl(env, origin, orderId) {
  const s = await signFor(env.AUTH_SECRET, `callback:${orderId}`);
  return `${origin}/api/prodigi/callback/${encodeURIComponent(orderId)}?s=${s}`;
}

// Transmet une commande payée au laboratoire. Idempotent côté Prodigi
// (idempotencyKey = commande + numéro de tentative) ; un refus passe la
// commande en « failed » avec la raison, relançable depuis l'admin.
export async function submitPrintOrder(env, orderId, origin) {
  const order = await env.DB.prepare("SELECT * FROM print_orders WHERE id = ?").bind(orderId).first();
  if (!order) return { ok: false, error: "Commande introuvable" };
  const photographer = await photographerRow(env, order.photographer_id);
  const creds = await credentialsFor(env, photographer);
  const lines = parseJson(order.items, []);
  const recipient = parseJson(order.recipient, {});

  const urls = new Map();
  for (const line of lines) {
    if (!urls.has(line.photoId)) urls.set(line.photoId, await assetUrl(env, origin, order.id, line.photoId));
  }
  const payload = buildOrderPayload({
    order,
    lines,
    recipient,
    assetUrlFor: (photoId) => urls.get(photoId),
    callbackUrl: await callbackUrl(env, origin, order.id),
  });

  const ts = now();
  try {
    const data = await prodigiRequest(env, creds, "POST", "/orders", payload);
    const prodigiOrder = data?.order || {};
    const mapped = statusFromProdigiOrder(prodigiOrder);
    await env.DB.prepare(
      `UPDATE print_orders SET status = ?, prodigi_order_id = ?, prodigi_stage = ?, error = ?, submit_attempts = submit_attempts + 1,
                               submitted_at = ?, updated_at = ? WHERE id = ?`
    )
      .bind(mapped.status, prodigiOrder.id || "", mapped.stage, mapped.issue, ts, ts, order.id)
      .run();
    return { ok: true, status: mapped.status, prodigiOrderId: prodigiOrder.id || "" };
  } catch (err) {
    const message = (err.message || "Refus du laboratoire").slice(0, 500);
    await env.DB.prepare(
      "UPDATE print_orders SET status = 'failed', error = ?, submit_attempts = submit_attempts + 1, updated_at = ? WHERE id = ?"
    )
      .bind(message, ts, order.id)
      .run();
    console.error(`Commande de tirages ${order.id} refusée par Prodigi :`, message);
    return { ok: false, status: "failed", error: message };
  }
}

// Appelé par le webhook Stripe dès que le paiement d'une commande de
// tirages est confirmé (une seule fois : l'appelant ne le fait qu'au
// passage de « pending » à « paid »).
export async function handlePrintPaymentConfirmed(env, payment, origin) {
  const order = await env.DB.prepare("SELECT * FROM print_orders WHERE payment_id = ?").bind(payment.id).first();
  if (!order) return;
  const ts = now();
  await env.DB.prepare("UPDATE print_orders SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ? AND status = 'pending_payment'")
    .bind(ts, ts, order.id)
    .run();

  const gallery = await env.DB.prepare("SELECT * FROM galleries WHERE id = ?").bind(order.gallery_id).first();
  const photographer = await photographerRow(env, order.photographer_id);
  const lines = parseJson(order.items, []);
  const recipient = parseJson(order.recipient, {});

  // 1. Le labo d'abord : c'est ce que le client a payé.
  const submission = await submitPrintOrder(env, order.id, origin);

  // 2. La facture (un incident ici ne doit rien bloquer d'autre).
  let invoice = null;
  try {
    const count = lines.reduce((n, l) => n + l.copies, 0);
    invoice = await createInvoiceForPayment(env, {
      payment,
      gallery,
      photographer,
      clientName: recipient.name,
      description: `${count} tirage${count > 1 ? "s" : ""} — ${gallery.title}`,
      details: [
        ...lines.map((l) => `${l.copies} × ${l.label} (photo n° ${l.photoNumber}) — ${formatEuros(l.lineCents)}`),
        `Frais de port — ${formatEuros(order.shipping_cents)}`,
      ],
    });
    await env.DB.prepare("UPDATE invoices SET emailed_to = ? WHERE id = ?").bind(order.client_email, invoice.id).run();
  } catch (err) {
    console.error("Échec de la facture de tirages :", err);
  }

  // 3. Les e-mails (au mieux, jamais bloquants).
  try {
    await sendPrintOrderConfirmation(env, {
      to: order.client_email,
      studioName: photographer?.studio_name,
      galleryTitle: gallery.title,
      recipientName: recipient.name,
      lines,
      shippingCents: order.shipping_cents,
      totalCents: order.total_cents,
      invoiceNumber: invoice?.number || "",
      pdfBytes: invoice?.pdfBytes,
    });
    if (photographer?.email) {
      await sendPrintOrderPhotographer(env, {
        to: photographer.email,
        galleryTitle: gallery.title,
        recipientName: recipient.name,
        lines,
        totalCents: order.total_cents,
        labStatus: submission.status,
        labError: submission.error,
        adminUrl: env.ADMIN_URL || "",
      });
    }
  } catch (err) {
    console.error("Échec des e-mails de commande de tirages :", err);
  }
}

/* =================================================================
   Routes publiques signées : fichier d'impression, notifications Prodigi
   ================================================================= */

const ASSET_STATUSES = new Set(["paid", "submitted", "in_production", "shipped", "failed"]);

export async function handlePrintAsset(request, env, orderId, photoId) {
  const s = new URL(request.url).searchParams.get("s") || "";
  if (!(await verifySignature(env.AUTH_SECRET, `asset:${orderId}:${photoId}`, s))) return fail(403, "Lien invalide");
  const order = await env.DB.prepare("SELECT gallery_id, status, items FROM print_orders WHERE id = ?").bind(orderId).first();
  if (!order || !ASSET_STATUSES.has(order.status)) return fail(404, "Fichier indisponible");
  if (!parseJson(order.items, []).some((l) => l.photoId === photoId)) return fail(404, "Fichier indisponible");
  const object = await env.TILES.get(originalKey(order.gallery_id, photoId));
  if (!object) return fail(404, "Fichier indisponible");
  return new Response(object.body, {
    headers: {
      "content-type": "image/jpeg",
      "content-length": String(object.size),
      "cache-control": "private, no-store",
    },
  });
}

// Prodigi notifie chaque changement d'étape. Le contenu de la notification
// n'est jamais cru tel quel : l'URL signée prouve seulement qu'il s'agit
// d'une de nos commandes, puis on relit la commande chez Prodigi avec la
// clé du photographe — c'est cette réponse-là qui fait foi.
export async function handleProdigiCallback(request, env, orderId) {
  const s = new URL(request.url).searchParams.get("s") || "";
  if (!(await verifySignature(env.AUTH_SECRET, `callback:${orderId}`, s))) return fail(403, "Signature invalide");
  const order = await env.DB.prepare("SELECT * FROM print_orders WHERE id = ?").bind(orderId).first();
  if (!order || !order.prodigi_order_id) return fail(404, "Commande introuvable");

  const photographer = await photographerRow(env, order.photographer_id);
  let prodigiOrder;
  try {
    const data = await prodigiRequest(env, await credentialsFor(env, photographer), "GET", `/orders/${encodeURIComponent(order.prodigi_order_id)}`);
    prodigiOrder = data?.order;
  } catch (err) {
    console.error(`Relecture de la commande Prodigi ${order.prodigi_order_id} impossible :`, err.message);
    return fail(502, "Relecture impossible");
  }
  if (!prodigiOrder) return fail(502, "Relecture impossible");

  const mapped = statusFromProdigiOrder(prodigiOrder);
  const ts = now();
  await env.DB.prepare(
    "UPDATE print_orders SET status = ?, prodigi_stage = ?, tracking_url = ?, error = ?, updated_at = ? WHERE id = ?"
  )
    .bind(mapped.status, mapped.stage, mapped.trackingUrl || order.tracking_url, mapped.issue, ts, order.id)
    .run();

  if (mapped.status === "shipped" && order.status !== "shipped") {
    const gallery = await env.DB.prepare("SELECT title FROM galleries WHERE id = ?").bind(order.gallery_id).first();
    try {
      await sendPrintOrderShipped(env, {
        to: order.client_email,
        studioName: photographer?.studio_name,
        galleryTitle: gallery?.title || "",
        recipientName: parseJson(order.recipient, {}).name,
        trackingUrl: mapped.trackingUrl,
      });
    } catch (err) {
      console.error("E-mail d'expédition :", err);
    }
  }
  return json({ ok: true, status: mapped.status });
}
