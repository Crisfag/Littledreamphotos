// Règlement des suppléments sans carte : en espèces (le client passe à
// l'adresse indiquée par le photographe) ou par virement (le photographe,
// prévenu par e-mail, lui communique son numéro de compte).
//
// Le client fait une DEMANDE depuis sa galerie : une ligne « awaiting » dans
// payments (method 'cash' ou 'transfer'). Rien n'est considéré comme réglé
// tant que le photographe n'a pas cliqué « Marquer comme reçu » : la ligne
// passe alors à « paid », exactement comme après un paiement Stripe, et la
// facture part au client. Une seule demande en cours par galerie : une
// nouvelle demande (autre moyen, ou sélection qui a changé) remplace la
// précédente ; un paiement par carte confirmé les efface.
//
// Uniquement les suppléments (photos au-delà du forfait) : les tirages
// restent payés en ligne, ils partent au labo dès le paiement.

import { json, fail } from "./http.js";
import { randomBytes, b64url } from "./auth.js";
import { supplementFor } from "./admin.js";
import { issueInvoice } from "./billing.js";
import { sendOfflinePaymentRequest, sendOfflinePaymentInstructions } from "./notify.js";
import { galleryUrlFor } from "./reminders.js";

export const OFFLINE_METHODS = ["cash", "transfer"];

const now = () => Math.floor(Date.now() / 1000);

// Réglages du photographe, tels que la galerie client les reçoit.
export function offlineOptionsFor(photographer) {
  const cashAddress = String(photographer?.offline_cash_address || "").trim();
  return {
    cash: Boolean(photographer?.offline_cash) && cashAddress !== "",
    cashAddress,
    transfer: Boolean(photographer?.offline_transfer),
  };
}

export async function awaitingOfflinePayment(env, galleryId) {
  return env.DB.prepare(
    `SELECT id, method, extra_count, amount_cents, created_at FROM payments
     WHERE gallery_id = ? AND status = 'awaiting' AND kind = 'supplement'
     ORDER BY created_at DESC LIMIT 1`
  ).bind(galleryId).first();
}

// Bloc « offline » de la session client (viewer.js) : null si le
// photographe n'a activé aucun des deux moyens et qu'aucune demande n'est
// en cours.
export async function offlineForClient(env, gallery, photographer) {
  const options = offlineOptionsFor(photographer);
  const pending = await awaitingOfflinePayment(env, gallery.id);
  if (!options.cash && !options.transfer && !pending) return null;
  return {
    cash: options.cash,
    transfer: options.transfer,
    cashAddress: options.cash || pending?.method === "cash" ? options.cashAddress : "",
    contactEmail: photographer?.email || "",
    pending: pending ? pendingForClient(pending) : null,
  };
}

function pendingForClient(row) {
  return { method: row.method, extraCount: row.extra_count, amountCents: row.amount_cents, createdAt: row.created_at };
}

async function outstandingFor(env, gallery) {
  const selected = await env.DB.prepare("SELECT COUNT(*) AS n FROM photos WHERE gallery_id = ? AND selected = 1")
    .bind(gallery.id).first();
  const paid = await env.DB.prepare(
    "SELECT COALESCE(SUM(extra_count), 0) AS n FROM payments WHERE gallery_id = ? AND status = 'paid'"
  ).bind(gallery.id).first();
  return supplementFor(gallery.included_photos, gallery.extra_photo_price_cents, selected?.n || 0, paid?.n || 0);
}

// POST /api/galleries/:slug/offline-payment { method } — demande du client.
export async function handleOfflineRequest(request, env, ctx, gallery) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const method = String(body?.method || "");
  if (!OFFLINE_METHODS.includes(method)) return fail(400, "Moyen de paiement inconnu");
  if (gallery.included_photos === null || gallery.included_photos === undefined) {
    return fail(400, "Aucun forfait n'est défini pour cette galerie");
  }

  const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(gallery.photographer_id).first();
  const options = offlineOptionsFor(photographer);
  if (!options[method]) return fail(400, "Ce moyen de paiement n'est pas proposé par le studio");

  const supplement = await outstandingFor(env, gallery);
  if (supplement.dueExtraCount <= 0) return fail(400, "Rien à régler pour le moment");

  // Même demande déjà en cours (double clic, page rechargée) : rien à
  // refaire, et surtout pas de second e-mail au photographe.
  const current = await awaitingOfflinePayment(env, gallery.id);
  if (current && current.method === method && current.extra_count === supplement.dueExtraCount && current.amount_cents === supplement.dueTotalCents) {
    return json({ pending: pendingForClient(current) });
  }

  await env.DB.prepare("DELETE FROM payments WHERE gallery_id = ? AND status = 'awaiting' AND kind = 'supplement'")
    .bind(gallery.id).run();
  const id = `pay_${b64url(randomBytes(9))}`;
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, fee_cents, status, kind, method, created_at)
     VALUES (?, ?, ?, ?, ?, 0, 'awaiting', 'supplement', ?, ?)`
  ).bind(id, gallery.id, `offline_${id}`, supplement.dueExtraCount, supplement.dueTotalCents, method, ts).run();

  const params = {
    method,
    studioName: photographer.studio_name || "",
    galleryTitle: gallery.title,
    clientName: gallery.client_name || "",
    clientEmail: gallery.client_email || "",
    photographerEmail: photographer.email,
    extraCount: supplement.dueExtraCount,
    amountCents: supplement.dueTotalCents,
    cashAddress: options.cashAddress,
  };
  const mails = (async () => {
    await sendOfflinePaymentRequest(env, { ...params, lang: photographer.ui_language, to: photographer.email, adminUrl: env.ADMIN_URL || "" });
    if (gallery.client_email) {
      await sendOfflinePaymentInstructions(env, { ...params, lang: gallery.language, to: gallery.client_email, galleryUrl: galleryUrlFor(env, gallery.slug) });
    }
  })().catch((err) => console.error("E-mails de paiement hors ligne :", err && err.message ? err.message : err));
  if (ctx?.waitUntil) ctx.waitUntil(mails);
  else await mails;

  return json({ pending: { method, extraCount: supplement.dueExtraCount, amountCents: supplement.dueTotalCents, createdAt: ts } });
}

// POST /api/admin/account/offline-payments — réglages du photographe.
export async function updateOfflineSettings(request, env, photographerId) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const cash = body?.cash === true;
  const transfer = body?.transfer === true;
  const cashAddress = String(body?.cashAddress || "").trim().slice(0, 500);
  if (cash && !cashAddress) return fail(400, "Indiquez l'adresse où vos clients viennent régler en espèces");
  await env.DB.prepare(
    "UPDATE photographers SET offline_cash = ?, offline_cash_address = ?, offline_transfer = ? WHERE id = ?"
  ).bind(cash ? 1 : 0, cashAddress, transfer ? 1 : 0, photographerId).run();
  return json({ ok: true, cash, cashAddress, transfer });
}

// POST /api/admin/galleries/:slug/payments/:id/received — le photographe a
// bien reçu l'argent : le supplément est réglé, la facture part au client.
export async function confirmOfflinePayment(env, gallery, paymentId) {
  const result = await env.DB.prepare(
    `UPDATE payments SET status = 'paid', paid_at = ?
     WHERE id = ? AND gallery_id = ? AND status = 'awaiting'`
  ).bind(now(), paymentId, gallery.id).run();
  if (!(result.meta && result.meta.changes > 0)) return fail(404, "Demande de paiement introuvable ou déjà traitée");
  const payment = await env.DB.prepare("SELECT stripe_checkout_session_id FROM payments WHERE id = ?").bind(paymentId).first();
  await issueInvoice(env, payment.stripe_checkout_session_id);
  return json({ ok: true });
}

// POST /api/admin/galleries/:slug/payments/:id/cancel — demande abandonnée.
export async function cancelOfflinePayment(env, gallery, paymentId) {
  const result = await env.DB.prepare(
    "DELETE FROM payments WHERE id = ? AND gallery_id = ? AND status = 'awaiting'"
  ).bind(paymentId, gallery.id).run();
  if (!(result.meta && result.meta.changes > 0)) return fail(404, "Demande de paiement introuvable ou déjà traitée");
  return json({ ok: true });
}
