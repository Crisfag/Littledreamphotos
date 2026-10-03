// Campagnes de vente des tirages :
//
//  - Promotion à durée limitée sur une galerie (−10 % à −50 % jusqu'à une
//    date) : prix barrés côté client, appliqués aussi par le serveur à la
//    commande, et jamais en dessous du coût du labo (le photographe ne vend
//    jamais à perte). Le photographe peut l'annoncer au client par e-mail.
//  - Panier enregistré côté serveur : le client le retrouve sur un autre
//    appareil, et s'il ne commande pas, un rappel part au bout de 24 h
//    (une seule fois par panier).
//  - Relance « vos coups de cœur méritent d'être imprimés » quelques jours
//    après la validation de la sélection, si rien n'a été commandé.
//
// Les relances automatiques suivent le réglage « Relances automatiques » du
// photographe et ne partent que si la boutique est réellement ouverte.

import { json, fail } from "./http.js";
import { sendPrintPromo, sendCartReminder, sendFavoritesPrint } from "./notify.js";
import { galleryUrlFor } from "./reminders.js";

export const PROMO_PERCENTS = [10, 15, 20, 25, 30, 40, 50];
const DAY = 24 * 60 * 60;
const MAX_PROMO_DAYS = 60;
export const CART_REMINDER_DELAY = DAY;
export const FAVORITES_DELAY = 3 * DAY;
const MAX_CART_LINES = 50;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/* ---------- Promotion (logique pure) ---------- */

export function activePromo(gallery, at = nowSeconds()) {
  const percent = Number(gallery?.promo_percent || 0);
  const endsAt = Number(gallery?.promo_ends_at || 0);
  if (!PROMO_PERCENTS.includes(percent) || !(endsAt > at)) return null;
  return { percent, endsAt };
}

// Prix remisé, arrondi au centime, jamais sous le coût connu du labo ni
// au-dessus du prix normal.
export function discountedCents(priceCents, costCents, percent) {
  const reduced = Math.round((priceCents * (100 - percent)) / 100);
  return Math.min(priceCents, Math.max(reduced, Number(costCents) || 0));
}

// Lignes de print_products avec le prix réellement payé pendant la
// promotion (`price_cents`) et le prix normal (`list_price_cents`).
export function applyPromo(products, gallery, at = nowSeconds()) {
  const promo = activePromo(gallery, at);
  return products.map((p) => ({
    ...p,
    list_price_cents: p.price_cents,
    price_cents: promo ? discountedCents(p.price_cents, p.cost_cents, promo.percent) : p.price_cents,
  }));
}

/* ---------- Promotion (admin, galerie déjà vérifiée) ---------- */

// POST …/promo { percent, endsAt } — percent 0 arrête la promotion.
export async function setPromo(request, env, gallery) {
  const body = await request.json().catch(() => null);
  const percent = Number(body?.percent || 0);
  if (percent === 0) {
    await env.DB.prepare("UPDATE galleries SET promo_percent = 0, promo_ends_at = NULL, promo_sent_at = NULL WHERE id = ?").bind(gallery.id).run();
    return json({ ok: true, promo: null });
  }
  if (!PROMO_PERCENTS.includes(percent)) return fail(400, "Remise proposée : 10, 15, 20, 25, 30, 40 ou 50 %");
  const endsAt = Math.floor(Number(body?.endsAt || 0));
  const now = nowSeconds();
  if (!(endsAt > now + 3600) || endsAt > now + MAX_PROMO_DAYS * DAY) return fail(400, `Date de fin invalide (dans l'heure qui vient à ${MAX_PROMO_DAYS} jours)`);
  await env.DB.prepare("UPDATE galleries SET promo_percent = ?, promo_ends_at = ?, promo_sent_at = NULL WHERE id = ?")
    .bind(percent, endsAt, gallery.id)
    .run();
  return json({ ok: true, promo: { percent, endsAt } });
}

// POST …/promo/send — annonce la promotion au client (une fois par promotion).
export async function sendPromoToClient(env, gallery, studioName) {
  const promo = activePromo(gallery);
  if (!promo) return fail(409, "Aucune promotion en cours sur cette galerie");
  if (!gallery.shop_enabled) return fail(409, "La boutique de tirages n'est pas ouverte sur cette galerie");
  if (!gallery.client_email) return fail(409, "Aucun e-mail client renseigné pour cette galerie");
  if (gallery.promo_sent_at) return fail(409, "Cette promotion a déjà été envoyée au client");
  const favorites = await env.DB.prepare("SELECT COUNT(*) AS n FROM photos WHERE gallery_id = ? AND selected = 1").bind(gallery.id).first();
  await env.DB.prepare("UPDATE galleries SET promo_sent_at = ? WHERE id = ?").bind(nowSeconds(), gallery.id).run();
  await sendPrintPromo(env, {
    to: gallery.client_email,
    studioName,
    galleryTitle: gallery.title,
    clientName: gallery.client_name,
    percent: promo.percent,
    endsAt: promo.endsAt,
    favoritesCount: favorites?.n || 0,
    galleryUrl: galleryUrlFor(env, gallery.slug),
  });
  return json({ ok: true });
}

export async function promoForAdmin(env, gallery) {
  const promo = activePromo(gallery);
  const cart = await env.DB.prepare("SELECT lines, updated_at, reminded_at FROM print_carts WHERE gallery_id = ?").bind(gallery.id).first();
  const lines = cart ? parseJson(cart.lines, []) : [];
  return {
    promo: promo ? { ...promo, sentAt: gallery.promo_sent_at || null } : null,
    percents: PROMO_PERCENTS,
    cart: lines.length
      ? { items: lines.reduce((n, l) => n + l.copies, 0), updatedAt: cart.updated_at, remindedAt: cart.reminded_at || null }
      : null,
  };
}

/* ---------- Panier enregistré (client, session déjà vérifiée) ---------- */

// Ne garde que des lignes bien formées : la commande revalide tout de toute
// façon (photos, formats, quantités) au moment de payer.
export function normalizeCartLines(lines) {
  if (!Array.isArray(lines)) return null;
  const out = [];
  for (const line of lines.slice(0, MAX_CART_LINES)) {
    const photoId = String(line?.photoId || "");
    const productId = String(line?.productId || "");
    const copies = Number(line?.copies);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(photoId) || !/^[A-Za-z0-9_-]{1,64}$/.test(productId)) continue;
    if (!Number.isInteger(copies) || copies < 1 || copies > 10) continue;
    out.push({ photoId, productId, copies });
  }
  return out;
}

// POST /api/gallery/<slug>/cart { lines }
export async function saveCart(request, env, gallery) {
  const body = await request.json().catch(() => null);
  const lines = normalizeCartLines(body?.lines);
  if (!lines) return fail(400, "Panier invalide");
  if (!lines.length) {
    await env.DB.prepare("DELETE FROM print_carts WHERE gallery_id = ?").bind(gallery.id).run();
    return json({ ok: true, items: 0 });
  }
  // Un panier modifié repart pour un rappel (reminded_at remis à zéro).
  await env.DB.prepare(
    `INSERT INTO print_carts (gallery_id, lines, updated_at, reminded_at) VALUES (?, ?, ?, NULL)
     ON CONFLICT(gallery_id) DO UPDATE SET lines = excluded.lines, updated_at = excluded.updated_at, reminded_at = NULL
     WHERE print_carts.lines != excluded.lines`
  )
    .bind(gallery.id, JSON.stringify(lines), nowSeconds())
    .run();
  return json({ ok: true, items: lines.reduce((n, l) => n + l.copies, 0) });
}

export async function savedCartFor(env, galleryId) {
  const row = await env.DB.prepare("SELECT lines FROM print_carts WHERE gallery_id = ?").bind(galleryId).first();
  return row ? parseJson(row.lines, []) : [];
}

export async function clearCart(env, galleryId) {
  await env.DB.prepare("DELETE FROM print_carts WHERE gallery_id = ?").bind(galleryId).run();
}

/* ---------- Relances automatiques (passe quotidienne) ---------- */

// `shopState(env, gallery)` vient de shop.js (passé en paramètre pour
// éviter un import circulaire) : null si la boutique n'est pas réellement
// ouverte (clé Prodigi, Stripe, formats, formule).
export async function runSalesReminders(env, shopState, options = {}) {
  const now = options.now || nowSeconds();
  const sent = [];

  // 1. Paniers laissés sans commande depuis 24 h.
  const { results: carts } = await env.DB.prepare(
    `SELECT c.gallery_id, c.lines, c.updated_at, g.*, p.studio_name AS studio_name_p
     FROM print_carts c
     JOIN galleries g ON g.id = c.gallery_id
     JOIN photographers p ON p.id = g.photographer_id
     WHERE c.reminded_at IS NULL AND c.updated_at <= ? AND g.client_email != ''
       AND (g.expires_at IS NULL OR g.expires_at > ?) AND p.reminders_enabled = 1`
  )
    .bind(now - CART_REMINDER_DELAY, now)
    .all();
  for (const row of carts) {
    const gallery = { ...row, id: row.gallery_id };
    const ordered = await env.DB.prepare(
      "SELECT 1 FROM print_orders WHERE gallery_id = ? AND status != 'pending_payment' AND created_at >= ? LIMIT 1"
    )
      .bind(gallery.id, row.updated_at)
      .first();
    if (ordered) continue;
    const state = await shopState(env, gallery);
    if (!state) continue;
    const marked = await env.DB.prepare("UPDATE print_carts SET reminded_at = ? WHERE gallery_id = ? AND reminded_at IS NULL")
      .bind(now, gallery.id)
      .run();
    if (!marked.meta || marked.meta.changes === 0) continue;
    const lines = parseJson(row.lines, []);
    const products = new Map(state.products.map((p) => [p.id, p]));
    const items = lines
      .filter((l) => products.has(l.productId))
      .map((l) => ({ label: products.get(l.productId).label, copies: l.copies }));
    if (!items.length) continue;
    await sendCartReminder(env, {
      to: gallery.client_email,
      studioName: row.studio_name_p,
      galleryTitle: gallery.title,
      clientName: gallery.client_name,
      items,
      promo: activePromo(gallery, now),
      galleryUrl: galleryUrlFor(env, gallery.slug),
    });
    sent.push({ galleryId: gallery.id, slug: gallery.slug, kind: "cart" });
  }

  // 2. Sélection validée il y a 3 jours, coups de cœur imprimables, rien
  //    commandé : une seule relance par galerie (reminders_sent).
  const { results: galleries } = await env.DB.prepare(
    `SELECT g.*, p.studio_name AS studio_name_p,
            (SELECT COUNT(*) FROM photos ph WHERE ph.gallery_id = g.id AND ph.selected = 1 AND ph.has_original = 1) AS printable_favorites
     FROM galleries g JOIN photographers p ON p.id = g.photographer_id
     WHERE g.shop_enabled = 1 AND g.client_email != '' AND g.selection_done_at IS NOT NULL AND g.selection_done_at <= ?
       AND (g.expires_at IS NULL OR g.expires_at > ?) AND p.reminders_enabled = 1
       AND NOT EXISTS (SELECT 1 FROM reminders_sent r WHERE r.gallery_id = g.id AND r.kind = 'print_favorites')
       AND NOT EXISTS (SELECT 1 FROM print_orders o WHERE o.gallery_id = g.id AND o.status != 'pending_payment')`
  )
    .bind(now - FAVORITES_DELAY, now)
    .all();
  for (const gallery of galleries) {
    if (!gallery.printable_favorites) continue;
    const state = await shopState(env, gallery);
    if (!state) continue;
    const inserted = await env.DB.prepare("INSERT OR IGNORE INTO reminders_sent (gallery_id, kind, sent_at) VALUES (?, 'print_favorites', ?)")
      .bind(gallery.id, now)
      .run();
    if (!inserted.meta || inserted.meta.changes === 0) continue;
    await sendFavoritesPrint(env, {
      to: gallery.client_email,
      studioName: gallery.studio_name_p,
      galleryTitle: gallery.title,
      clientName: gallery.client_name,
      favoritesCount: gallery.printable_favorites,
      promo: activePromo(gallery, now),
      galleryUrl: galleryUrlFor(env, gallery.slug),
    });
    sent.push({ galleryId: gallery.id, slug: gallery.slug, kind: "print_favorites" });
  }

  return { sent };
}
