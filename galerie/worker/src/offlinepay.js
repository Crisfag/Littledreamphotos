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
// Uniquement les suppléments (photos au-delà du forfait) et les options
// cochées (options.js) : les tirages restent payés en ligne, ils partent au
// labo dès le paiement.

import { json, fail } from "./http.js";
import { randomBytes, b64url } from "./auth.js";
import { supplementFor } from "./admin.js";
import { issueInvoice } from "./billing.js";
import { expireCheckoutSession } from "./stripe.js";
import { sendOfflinePaymentRequest, sendOfflinePaymentInstructions } from "./notify.js";
import { galleryUrlFor } from "./reminders.js";
import { amountDueFor, unpaidOptionsByGallery, optionsSnapshot, markOptionsPaid } from "./options.js";

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
    `SELECT id, method, extra_count, amount_cents, options_json, created_at FROM payments
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

const outstandingFor = amountDueFor;

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
  const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(gallery.photographer_id).first();
  const options = offlineOptionsFor(photographer);
  if (!options[method]) return fail(400, "Ce moyen de paiement n'est pas proposé par le studio");

  const supplement = await outstandingFor(env, gallery);
  if (supplement.totalCents <= 0) return fail(400, "Rien à régler pour le moment");
  const snapshot = optionsSnapshot(supplement.options);

  // Même demande déjà en cours (double clic, page rechargée) : rien à
  // refaire, et surtout pas de second e-mail au photographe.
  const current = await awaitingOfflinePayment(env, gallery.id);
  if (current && current.method === method && current.extra_count === supplement.dueExtraCount && current.amount_cents === supplement.totalCents && (current.options_json || "") === snapshot) {
    return json({ pending: pendingForClient(current) });
  }

  await env.DB.prepare("DELETE FROM payments WHERE gallery_id = ? AND status = 'awaiting' AND kind = 'supplement'")
    .bind(gallery.id).run();
  const id = `pay_${b64url(randomBytes(9))}`;
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, fee_cents, status, kind, method, options_json, created_at)
     VALUES (?, ?, ?, ?, ?, 0, 'awaiting', 'supplement', ?, ?, ?)`
  ).bind(id, gallery.id, `offline_${id}`, supplement.dueExtraCount, supplement.totalCents, method, snapshot, ts).run();

  const params = {
    method,
    studioName: photographer.studio_name || "",
    galleryTitle: gallery.title,
    clientName: gallery.client_name || "",
    clientEmail: gallery.client_email || "",
    photographerEmail: photographer.email,
    extraCount: supplement.dueExtraCount,
    amountCents: supplement.totalCents,
    options: supplement.options,
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

  return json({ pending: { method, extraCount: supplement.dueExtraCount, amountCents: supplement.totalCents, createdAt: ts } });
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
  const payment = await env.DB.prepare("SELECT * FROM payments WHERE id = ?").bind(paymentId).first();
  await markOptionsPaid(env, payment);
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

/* ---------- Suppléments dus, toutes galeries (onglet Facturation) ---------- */

// Une session Stripe encore ouverte pendant ce délai (24 h par défaut chez
// Stripe) : passé ce cap, le client ne peut plus la payer.
const CARD_SESSION_LIFETIME = 24 * 3600;

// GET /api/admin/supplements — chaque galerie où le client doit encore des
// suppléments, avec ce qui est en cours : demande en espèces ou par
// virement, ou paiement par carte commencé sans être allé au bout. Même
// calcul que listGalleries/supplementFor : le dû se recalcule toujours à
// partir de la sélection, jamais d'un montant stocké.
export async function listDueSupplements(env, photographerId) {
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.slug, g.title, g.client_name, g.client_email, g.included_photos, g.extra_photo_price_cents, g.selection_done_at,
            (SELECT COUNT(*) FROM photos p WHERE p.gallery_id = g.id AND p.selected = 1) AS selected_count,
            (SELECT COALESCE(SUM(extra_count), 0) FROM payments WHERE payments.gallery_id = g.id AND payments.status = 'paid') AS paid_extra_count,
            (SELECT method FROM payments WHERE payments.gallery_id = g.id AND payments.status = 'awaiting' AND payments.kind = 'supplement' ORDER BY created_at DESC LIMIT 1) AS awaiting_method,
            (SELECT created_at FROM payments WHERE payments.gallery_id = g.id AND payments.status = 'awaiting' AND payments.kind = 'supplement' ORDER BY created_at DESC LIMIT 1) AS awaiting_at,
            (SELECT MAX(created_at) FROM payments WHERE payments.gallery_id = g.id AND payments.status = 'pending' AND payments.kind = 'supplement') AS card_started_at,
            (SELECT MAX(sent_at) FROM reminders_sent WHERE reminders_sent.gallery_id = g.id AND reminders_sent.kind LIKE 'unpaid_%') AS reminded_at
     FROM galleries g
     WHERE g.photographer_id = ? AND g.demo = 0 AND g.kind != 'school'
     ORDER BY g.created_at DESC`
  ).bind(photographerId).all();
  const optionsDue = await unpaidOptionsByGallery(env, photographerId);

  const cardCutoff = now() - CARD_SESSION_LIFETIME;
  const supplements = [];
  for (const g of results) {
    const due = supplementFor(g.included_photos, g.extra_photo_price_cents, g.selected_count, g.paid_extra_count);
    const options = optionsDue.get(g.id) || { cents: 0, count: 0 };
    if (due.dueExtraCount <= 0 && options.cents <= 0) continue;
    supplements.push({
      slug: g.slug,
      title: g.title,
      clientName: g.client_name || "",
      clientEmail: g.client_email || "",
      selectionDoneAt: g.selection_done_at || null,
      dueExtraCount: due.dueExtraCount,
      extrasCents: due.dueTotalCents,
      optionsCount: options.count,
      optionsCents: options.cents,
      dueTotalCents: due.dueTotalCents + options.cents,
      unitPriceCents: g.extra_photo_price_cents || 0,
      remindedAt: g.reminded_at || null,
      awaiting: g.awaiting_method ? { method: g.awaiting_method, createdAt: g.awaiting_at } : null,
      cardStartedAt: g.card_started_at && g.card_started_at > cardCutoff ? g.card_started_at : null,
    });
  }
  const totalCents = supplements.reduce((sum, s) => sum + s.dueTotalCents, 0);
  return json({ supplements, totalCents });
}

// POST /api/admin/galleries/:slug/supplement/settle { method, amountCents }
// — le client a réglé le supplément en dehors de la galerie (virement fait
// d'habitude sur le compte du studio, espèces remises en main propre) :
// tout ce qui est dû à cet instant passe à « réglé », la facture part au
// client, exactement comme « Marquer comme reçu » sur une demande.
//
// `amountCents` : le montant que le photographe avait sous les yeux. Si le
// client a changé sa sélection entre-temps, le dû n'est plus le même — on
// refuse plutôt que de facturer un montant qu'il n'a pas vu.
export async function settleSupplement(request, env, gallery) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const method = String(body?.method || "");
  if (!OFFLINE_METHODS.includes(method)) return fail(400, "Moyen de paiement inconnu");
  const supplement = await outstandingFor(env, gallery);
  if (supplement.totalCents <= 0) return fail(409, "Plus rien à régler sur cette galerie : la page n'était plus à jour");
  if (Number.isFinite(body?.amountCents) && body.amountCents !== supplement.totalCents) {
    return fail(409, "Le client a changé sa sélection : le montant dû n'est plus le même. Rechargez la page et vérifiez avant de confirmer.");
  }

  // Plus de demande « à recevoir » : c'est réglé.
  await env.DB.prepare("DELETE FROM payments WHERE gallery_id = ? AND status = 'awaiting' AND kind = 'supplement'")
    .bind(gallery.id).run();
  const id = `pay_${b64url(randomBytes(9))}`;
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, fee_cents, status, kind, method, options_json, created_at, paid_at)
     VALUES (?, ?, ?, ?, ?, 0, 'paid', 'supplement', ?, ?, ?, ?)`
  ).bind(id, gallery.id, `offline_${id}`, supplement.dueExtraCount, supplement.totalCents, method, optionsSnapshot(supplement.options), ts, ts).run();
  await markOptionsPaid(env, await env.DB.prepare("SELECT * FROM payments WHERE id = ?").bind(id).first());

  // Un paiement par carte commencé puis abandonné ne doit plus pouvoir
  // aboutir : le client paierait deux fois. On ferme sa session Stripe ;
  // si Stripe refuse (déjà payée à l'instant), la ligne reste et le
  // webhook l'enregistrera — mieux vaut un remboursement à faire qu'un
  // encaissement invisible.
  const { results: openCards } = await env.DB.prepare(
    `SELECT id, stripe_checkout_session_id FROM payments
     WHERE gallery_id = ? AND status = 'pending' AND kind = 'supplement' AND created_at > ?`
  ).bind(gallery.id, ts - CARD_SESSION_LIFETIME).all();
  for (const card of openCards) {
    try {
      await expireCheckoutSession(env, card.stripe_checkout_session_id);
      await env.DB.prepare("DELETE FROM payments WHERE id = ? AND status = 'pending'").bind(card.id).run();
    } catch (err) {
      console.warn("Session Stripe non fermée :", card.stripe_checkout_session_id, err && err.message ? err.message : err);
    }
  }

  await issueInvoice(env, `offline_${id}`);
  const invoice = await env.DB.prepare("SELECT number, emailed_to FROM invoices WHERE payment_id = ?").bind(id).first();
  return json({
    ok: true,
    extraCount: supplement.dueExtraCount,
    amountCents: supplement.totalCents,
    invoiceNumber: invoice?.number || "",
    emailedTo: invoice?.emailed_to || "",
  });
}
