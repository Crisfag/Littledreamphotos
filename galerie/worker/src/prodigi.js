// Boutique de tirages : client de l'API Prodigi (v4) et outils associés.
//
// Prodigi fabrique et expédie les tirages ; chaque photographe connecte SON
// compte Prodigi (c'est lui que le labo facture), le client paie le prix de
// vente fixé par le photographe via Stripe (son compte Connect, comme pour
// les suppléments). La différence est sa marge.
//
// Tout ce qui est « pur » (construction des requêtes, chiffrement de la clé,
// signatures d'URL, lecture des statuts) est exporté pour être testé sans
// réseau (tests/prodigi.test.mjs).

import { b64url, unb64url, randomBytes, timingSafeEqual } from "./auth.js";
import { SUGGESTED_SELECTIONS, resolveSelection } from "./printCatalogue.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

export const PRODIGI_BASES = {
  sandbox: "https://api.sandbox.prodigi.com/v4.0",
  live: "https://api.prodigi.com/v4.0",
};

// PRODIGI_API_BASE ne sert qu'aux tests locaux (faux labo sur localhost) :
// jamais défini en production, où l'environnement choisi par le
// photographe décide seul de l'adresse.
export function prodigiBase(env, environment) {
  if (env.PRODIGI_API_BASE) return env.PRODIGI_API_BASE.replace(/\/+$/, "");
  return environment === "live" ? PRODIGI_BASES.live : PRODIGI_BASES.sandbox;
}

// Formats proposés d'un clic dans l'admin (voir printCatalogue.js).
export const SUGGESTED_PRODUCTS = SUGGESTED_SELECTIONS.map((sel) => {
  const resolved = resolveSelection(sel);
  return { label: resolved.label, sku: resolved.sku, attributes: resolved.attributes, ref: resolved.ref, priceCents: sel.priceCents };
});

// Pays de livraison proposés au client (Prodigi livre bien au-delà, mais
// le forfait de port du photographe est pensé pour l'Europe proche).
export const SHOP_COUNTRIES = {
  BE: "Belgique", FR: "France", LU: "Luxembourg", NL: "Pays-Bas", DE: "Allemagne",
  CH: "Suisse", AT: "Autriche", IT: "Italie", ES: "Espagne", PT: "Portugal",
  IE: "Irlande", GB: "Royaume-Uni", DK: "Danemark", SE: "Suède",
};

export const MAX_ORDER_LINES = 20;
export const MAX_COPIES = 10;

/* ---------- Clé d'API chiffrée ---------- */

async function aesKey(secret) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(`${secret}:prodigi-api-key`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptApiKey(secret, plaintext) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), enc.encode(plaintext));
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

export async function decryptApiKey(secret, stored) {
  if (!stored || !stored.startsWith("v1.")) return "";
  const [, ivPart, ctPart] = stored.split(".");
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64url(ivPart) }, await aesKey(secret), unb64url(ctPart));
    return dec.decode(pt);
  } catch {
    return "";
  }
}

/* ---------- URLs signées (fichiers d'impression, notifications) ---------- */

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey("raw", enc.encode(`${secret}:prodigi-urls`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

export async function signFor(secret, message) {
  return b64url(await hmac(secret, message));
}

export async function verifySignature(secret, message, given) {
  if (typeof given !== "string" || !given) return false;
  let givenBytes;
  try {
    givenBytes = unb64url(given);
  } catch {
    return false;
  }
  return timingSafeEqual(await hmac(secret, message), givenBytes);
}

/* ---------- Validation de la commande client ---------- */

function clean(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeRecipient(input) {
  const r = input && typeof input === "object" ? input : {};
  const recipient = {
    name: clean(r.name, 100),
    email: clean(r.email, 200).toLowerCase(),
    line1: clean(r.line1, 120),
    line2: clean(r.line2, 120),
    postalCode: clean(r.postalCode, 20),
    city: clean(r.city, 80),
    countryCode: clean(r.countryCode, 2).toUpperCase(),
  };
  if (!recipient.name) return { error: "Le nom du destinataire est requis" };
  if (!EMAIL_RE.test(recipient.email)) return { error: "Une adresse e-mail valide est requise" };
  if (!recipient.line1) return { error: "L'adresse de livraison est requise" };
  if (!recipient.postalCode) return { error: "Le code postal est requis" };
  if (!recipient.city) return { error: "La ville est requise" };
  if (!SHOP_COUNTRIES[recipient.countryCode]) return { error: "Pays de livraison non proposé" };
  return { recipient };
}

// `lines` : [{ photoId, productId, copies }] tels qu'envoyés par la page.
// Les photos et produits réels sont passés par l'appelant (déjà relus en
// base, cloisonnés) : on ne fait ici que croiser et figer.
export function buildOrderLines(lines, { photosById, productsById }) {
  if (!Array.isArray(lines) || !lines.length) return { error: "Le panier est vide" };
  if (lines.length > MAX_ORDER_LINES) return { error: `Au plus ${MAX_ORDER_LINES} lignes par commande` };
  const out = [];
  for (const line of lines) {
    const photo = photosById.get(String(line?.photoId || ""));
    if (!photo) return { error: "Une des photos du panier n'existe plus" };
    if (!photo.has_original) return { error: "Une des photos du panier n'est pas disponible en tirage" };
    const product = productsById.get(String(line?.productId || ""));
    if (!product || !product.active) return { error: "Un des formats du panier n'est plus proposé" };
    const copies = Number(line?.copies);
    if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) {
      return { error: `Quantité invalide (1 à ${MAX_COPIES} exemplaires)` };
    }
    let attributes = {};
    try {
      attributes = JSON.parse(product.attributes || "{}") || {};
    } catch {
      attributes = {};
    }
    out.push({
      photoId: photo.id,
      photoNumber: (photo.position ?? 0) + 1,
      productId: product.id,
      label: product.label,
      sku: product.sku,
      attributes,
      copies,
      unitCents: product.price_cents,
      lineCents: product.price_cents * copies,
    });
  }
  return { lines: out, itemsCents: out.reduce((sum, l) => sum + l.lineCents, 0) };
}

/* ---------- Requêtes Prodigi ---------- */

export function buildOrderPayload({ order, lines, recipient, assetUrlFor, callbackUrl }) {
  return {
    merchantReference: order.id,
    idempotencyKey: `${order.id}-${order.submit_attempts + 1}`,
    shippingMethod: "Standard",
    callbackUrl,
    recipient: {
      name: recipient.name,
      email: recipient.email,
      address: {
        line1: recipient.line1,
        ...(recipient.line2 ? { line2: recipient.line2 } : {}),
        postalOrZipCode: recipient.postalCode,
        countryCode: recipient.countryCode,
        townOrCity: recipient.city,
      },
    },
    items: lines.map((line, index) => ({
      merchantReference: `${order.id}-${index + 1}`,
      sku: line.sku,
      copies: line.copies,
      sizing: "fillPrintArea",
      ...(line.attributes && Object.keys(line.attributes).length ? { attributes: line.attributes } : {}),
      assets: [{ printArea: "default", url: assetUrlFor(line.photoId) }],
    })),
  };
}

export function buildQuotePayload({ sku, attributes, countryCode }) {
  return {
    shippingMethod: "Standard",
    destinationCountryCode: countryCode || "BE",
    currencyCode: "EUR",
    items: [{
      sku,
      copies: 1,
      ...(attributes && Object.keys(attributes).length ? { attributes } : {}),
      assets: [{ printArea: "default" }],
    }],
  };
}

// Message d'erreur lisible à partir d'une réponse d'erreur Prodigi.
export function prodigiErrorMessage(data, status) {
  // Cas le plus fréquent à la mise en route : une clé « Live » utilisée en
  // mode test (ou l'inverse) — Prodigi a deux clés distinctes.
  if (status === 401 || data?.statusText === "NotAuthenticated") {
    return "Clé refusée par Prodigi : en mode test il faut la clé Sandbox, en production la clé Live (ce sont deux clés différentes)";
  }
  // Prodigi renvoie ses détails sous plusieurs formes selon la route :
  // tableau d'erreurs, ou objet { "items[0].sku": [{ code, description }] }.
  const describe = (e) => (typeof e === "string" ? e : e?.message || e?.description || e?.code || "");
  const details = [];
  for (const source of [data?.data?.errors, data?.failures, data?.errors]) {
    if (Array.isArray(source)) {
      for (const e of source) details.push([e?.property || e?.field || e?.key, describe(e)].filter(Boolean).join(" : "));
    } else if (source && typeof source === "object") {
      for (const [property, list] of Object.entries(source)) {
        const messages = (Array.isArray(list) ? list : [list]).map(describe).filter(Boolean);
        details.push([property, messages.join(", ")].filter(Boolean).join(" : "));
      }
    }
  }
  const head = data?.statusText || data?.outcome || `Prodigi a refusé la requête (HTTP ${status})`;
  const cleaned = details.filter(Boolean);
  return cleaned.length ? `${head} — ${cleaned.join(" ; ")}` : head;
}

export async function prodigiRequest(env, { apiKey, environment }, method, path, body) {
  if (!apiKey) {
    const err = new Error("Aucune clé Prodigi n'est enregistrée");
    err.prodigiNotConfigured = true;
    throw err;
  }
  const response = await fetch(`${prodigiBase(env, environment)}${path}`, {
    method,
    headers: { "X-API-Key": apiKey, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(prodigiErrorMessage(data, response.status));
    err.prodigiStatus = response.status;
    throw err;
  }
  return data;
}

// Coût facturé par Prodigi pour une unité livrée dans `countryCode` :
// produit + port, en centimes d'euro.
export function costFromQuote(data) {
  const quote = data?.quotes?.[0];
  if (!quote?.costSummary) return null;
  const toCents = (cost) => Math.round(parseFloat(cost?.amount || "0") * 100);
  return {
    currency: quote.costSummary.items?.currency || "EUR",
    itemsCents: toCents(quote.costSummary.items),
    shippingCents: toCents(quote.costSummary.shipping),
  };
}

// Traduit une commande Prodigi (réponse ou notification) en statut local.
export function statusFromProdigiOrder(order) {
  const stage = order?.status?.stage || "";
  const shipments = Array.isArray(order?.shipments) ? order.shipments : [];
  const shipped = shipments.find((s) => s && s.status === "Shipped");
  const trackingUrl = shipped?.tracking?.url || "";
  let status = "submitted";
  if (stage === "InProgress") status = "in_production";
  if (shipped || stage === "Complete") status = "shipped";
  if (stage === "Cancelled") status = "cancelled";
  const issues = (order?.status?.issues || [])
    .map((i) => i?.description || i?.errorCode)
    .filter(Boolean);
  return { status, stage, trackingUrl, issue: issues.join(" ; ") };
}

export const ORDER_STATUS_LABELS = {
  pending_payment: "En attente de paiement",
  paid: "Payée",
  submitted: "Envoyée au labo",
  in_production: "En fabrication",
  shipped: "Expédiée",
  cancelled: "Annulée",
  failed: "À relancer",
};
