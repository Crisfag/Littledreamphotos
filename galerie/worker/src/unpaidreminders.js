// Relance des suppléments (et options) pas encore réglés : le client a
// validé sa sélection, il reste quelque chose à payer — un e-mail aimable
// 3 jours puis 7 jours après la validation, avec toutes les façons de
// régler que propose le studio (carte, virement avec le numéro de compte,
// espèces). Lancé chaque matin par le déclencheur planifié (index.js), et
// à la demande par le photographe (« Relancer », onglet Facturation).
//
// Une validation = un cycle : les relances sont mémorisées dans
// reminders_sent sous « unpaid_d3_<date de validation> » ; si le client
// valide à nouveau (sélection changée), un nouveau cycle peut démarrer.
// Au-delà de 14 jours, plus de relance automatique — le photographe garde
// la main (bouton « Relancer »).

import { json, fail } from "./http.js";
import { amountDueFor } from "./options.js";
import { offlineOptionsFor, awaitingOfflinePayment } from "./offlinepay.js";
import { sendUnpaidReminder } from "./notify.js";
import { galleryUrlFor } from "./reminders.js";
import { hasFeature } from "./subscription.js";
import { languageOf } from "./i18n.js";

const DAY = 86400;
export const FIRST_DAYS = 3;
export const SECOND_DAYS = 7;
export const LAST_DAYS = 14;
// Pas de relance automatique si le photographe vient d'en envoyer une.
const RECENT_MANUAL_SECONDS = 2 * DAY;
// Deux clics sur « Relancer » : un seul e-mail.
const MANUAL_COOLDOWN_SECONDS = 10 * 60;

const nowSeconds = () => Math.floor(Date.now() / 1000);

// Pure : quelle relance envoyer aujourd'hui (ou null).
export function unpaidReminderDue({ validatedAt, now, sentKinds }) {
  if (!validatedAt) return null;
  const days = (now - validatedAt) / DAY;
  if (days >= SECOND_DAYS && days < LAST_DAYS) {
    const kind = `unpaid_d7_${validatedAt}`;
    return sentKinds.has(kind) ? null : kind;
  }
  if (days >= FIRST_DAYS && days < SECOND_DAYS) {
    const kind = `unpaid_d3_${validatedAt}`;
    return sentKinds.has(kind) ? null : kind;
  }
  return null;
}

async function reminderParams(env, gallery, photographer, due) {
  const offline = offlineOptionsFor(photographer);
  const awaiting = await awaitingOfflinePayment(env, gallery.id);
  return {
    lang: languageOf(gallery.language),
    to: gallery.client_email,
    photographerEmail: photographer.email,
    studioName: photographer.studio_name || "",
    galleryTitle: gallery.title,
    clientName: gallery.client_name || "",
    extraCount: due.dueExtraCount,
    options: due.options,
    amountCents: due.totalCents,
    canPayOnline: Boolean(photographer.stripe_account_id) && Boolean(photographer.stripe_charges_enabled) && hasFeature(env, photographer, "extras"),
    transfer: offline.transfer,
    iban: offline.transfer ? photographer.billing_iban || "" : "",
    accountHolder: photographer.billing_company_name || photographer.studio_name || "",
    cashAddress: offline.cash ? offline.cashAddress : "",
    awaitingMethod: awaiting?.method || "",
    galleryUrl: galleryUrlFor(env, gallery.slug),
  };
}

export async function runUnpaidReminders(env, options = {}) {
  const now = options.now || nowSeconds();
  const { results: galleries } = await env.DB.prepare(
    `SELECT g.* FROM galleries g JOIN photographers p ON p.id = g.photographer_id
     WHERE p.unpaid_reminders_enabled = 1 AND g.demo = 0 AND g.kind != 'school'
       AND g.client_email != '' AND g.selection_done_at IS NOT NULL
       AND g.selection_done_at <= ? AND g.selection_done_at > ?
       AND (g.expires_at IS NULL OR g.expires_at > ?)`
  ).bind(now - FIRST_DAYS * DAY, now - LAST_DAYS * DAY, now).all();

  const sent = [];
  for (const gallery of galleries) {
    const { results: already } = await env.DB.prepare(
      "SELECT kind, sent_at FROM reminders_sent WHERE gallery_id = ? AND kind LIKE 'unpaid_%'"
    ).bind(gallery.id).all();
    const kind = unpaidReminderDue({ validatedAt: gallery.selection_done_at, now, sentKinds: new Set(already.map((r) => r.kind)) });
    if (!kind) continue;
    if (already.some((r) => r.kind.startsWith("unpaid_manual_") && r.sent_at > now - RECENT_MANUAL_SECONDS)) continue;

    const due = await amountDueFor(env, gallery);
    if (due.totalCents <= 0) continue;

    // Marqué AVANT l'envoi : deux passes simultanées n'envoient qu'une fois.
    const inserted = await env.DB.prepare("INSERT OR IGNORE INTO reminders_sent (gallery_id, kind, sent_at) VALUES (?, ?, ?)")
      .bind(gallery.id, kind, now).run();
    if (!inserted.meta || inserted.meta.changes === 0) continue;

    const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(gallery.photographer_id).first();
    await sendUnpaidReminder(env, await reminderParams(env, gallery, photographer, due));
    sent.push({ slug: gallery.slug, kind, to: gallery.client_email, amountCents: due.totalCents });
  }
  console.log(`Relances des suppléments : ${galleries.length} galerie(s) examinée(s), ${sent.length} e-mail(s) envoyé(s).`);
  return { examined: galleries.length, sent };
}

// POST /api/admin/galleries/:slug/supplement/remind — tout de suite.
export async function remindUnpaidNow(env, gallery) {
  if (!gallery.client_email) return fail(400, "Aucune adresse e-mail client sur cette galerie : ajoutez-la d'abord dans sa fiche");
  const due = await amountDueFor(env, gallery);
  if (due.totalCents <= 0) return fail(409, "Plus rien à régler sur cette galerie");
  const now = nowSeconds();
  const recent = await env.DB.prepare(
    "SELECT MAX(sent_at) AS ts FROM reminders_sent WHERE gallery_id = ? AND kind LIKE 'unpaid_%'"
  ).bind(gallery.id).first();
  if (recent?.ts && recent.ts > now - MANUAL_COOLDOWN_SECONDS) return fail(409, "Une relance vient déjà de partir pour cette galerie");
  await env.DB.prepare("INSERT OR IGNORE INTO reminders_sent (gallery_id, kind, sent_at) VALUES (?, ?, ?)")
    .bind(gallery.id, `unpaid_manual_${now}`, now).run();
  const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(gallery.photographer_id).first();
  await sendUnpaidReminder(env, await reminderParams(env, gallery, photographer, due));
  return json({ ok: true, to: gallery.client_email, amountCents: due.totalCents, remindedAt: now });
}

// POST /api/admin/account/unpaid-reminders { enabled }
export async function updateUnpaidReminders(request, env, photographerId) {
  let body;
  try { body = await request.json(); } catch { return fail(400, "Requête invalide"); }
  const enabled = body?.enabled === true;
  await env.DB.prepare("UPDATE photographers SET unpaid_reminders_enabled = ? WHERE id = ?").bind(enabled ? 1 : 0, photographerId).run();
  return json({ ok: true, enabled });
}
