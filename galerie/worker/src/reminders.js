// Relances automatiques : tant que le client n'a pas validé sa sélection,
// il est prévenu à J-7 puis à J-2 de l'expiration de sa galerie, et le
// photographe l'est à J-2. Lancé une fois par jour par le déclencheur
// planifié (wrangler.toml, [triggers]) — et à la demande par la propriétaire
// depuis l'onglet Admin.
//
// Chaque relance n'est envoyée qu'une fois (table reminders_sent) ; une
// passe peut donc tourner plusieurs fois par jour sans jamais doubler un
// e-mail. Sans RESEND_API_KEY, l'envoi est silencieusement ignoré par
// notify.js : la passe « consomme » quand même l'échéance, pour que la mise
// en service de la clé ne déclenche pas une rafale de vieux rappels.

import { sendClientReminder, sendPhotographerReminder } from "./notify.js";

const DAY = 86400;
export const CLIENT_FIRST_DAYS = 7;
export const CLIENT_LAST_DAYS = 2;
export const PHOTOGRAPHER_DAYS = 2;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function galleryUrlFor(env, slug) {
  const origin = (env.PUBLIC_SITE_ORIGIN || "").replace(/\/+$/, "");
  return origin ? `${origin}/galerie.html?g=${encodeURIComponent(slug)}` : "";
}

// Décide, pour une galerie, quelles relances sont dues aujourd'hui — pure,
// donc testable sans base : `sentKinds` est l'ensemble des relances déjà
// envoyées, `daysLeft` le nombre de jours (entamés) avant expiration.
export function remindersDue({ daysLeft, hasClientEmail, sentKinds }) {
  const due = [];
  if (daysLeft <= 0) return due; // déjà expirée : trop tard pour relancer
  if (hasClientEmail && daysLeft <= CLIENT_FIRST_DAYS && daysLeft > CLIENT_LAST_DAYS && !sentKinds.has("client_j7")) {
    due.push("client_j7");
  }
  if (hasClientEmail && daysLeft <= CLIENT_LAST_DAYS && !sentKinds.has("client_j2")) {
    due.push("client_j2");
  }
  if (daysLeft <= PHOTOGRAPHER_DAYS && !sentKinds.has("photographer_j2")) {
    due.push("photographer_j2");
  }
  return due;
}

export async function runReminders(env, options = {}) {
  const now = options.now || nowSeconds();
  const horizon = now + CLIENT_FIRST_DAYS * DAY;

  const { results: galleries } = await env.DB.prepare(
    `SELECT g.id, g.slug, g.title, g.client_name, g.client_email, g.expires_at,
            p.email AS photographer_email, p.studio_name,
            (SELECT COUNT(*) FROM photos ph WHERE ph.gallery_id = g.id AND ph.selected = 1) AS selected_count
     FROM galleries g JOIN photographers p ON p.id = g.photographer_id
     WHERE g.expires_at IS NOT NULL AND g.expires_at > ? AND g.expires_at <= ?
       AND g.selection_done_at IS NULL AND p.reminders_enabled = 1
     ORDER BY g.expires_at ASC`
  )
    .bind(now, horizon)
    .all();

  const sent = [];
  for (const gallery of galleries) {
    const { results: already } = await env.DB.prepare("SELECT kind FROM reminders_sent WHERE gallery_id = ?")
      .bind(gallery.id)
      .all();
    const sentKinds = new Set(already.map((r) => r.kind));
    const daysLeft = Math.ceil((gallery.expires_at - now) / DAY);
    const due = remindersDue({ daysLeft, hasClientEmail: Boolean(gallery.client_email), sentKinds });

    for (const kind of due) {
      // Marqué AVANT l'envoi : si deux passes se chevauchent, une seule
      // obtient l'insertion (clé primaire) et envoie.
      const inserted = await env.DB.prepare(
        "INSERT OR IGNORE INTO reminders_sent (gallery_id, kind, sent_at) VALUES (?, ?, ?)"
      )
        .bind(gallery.id, kind, now)
        .run();
      if (!inserted.meta || inserted.meta.changes === 0) continue;

      if (kind === "photographer_j2") {
        await sendPhotographerReminder(env, {
          to: gallery.photographer_email,
          galleryTitle: gallery.title,
          clientName: gallery.client_name,
          daysLeft,
          selectedCount: gallery.selected_count,
          adminUrl: env.ADMIN_URL || "",
        });
        sent.push({ galleryId: gallery.id, slug: gallery.slug, kind, to: gallery.photographer_email });
      } else {
        await sendClientReminder(env, {
          to: gallery.client_email,
          studioName: gallery.studio_name,
          galleryTitle: gallery.title,
          clientName: gallery.client_name,
          daysLeft,
          selectedCount: gallery.selected_count,
          galleryUrl: galleryUrlFor(env, gallery.slug),
        });
        sent.push({ galleryId: gallery.id, slug: gallery.slug, kind, to: gallery.client_email });
      }
    }
  }

  console.log(`Relances : ${galleries.length} galerie(s) examinée(s), ${sent.length} e-mail(s) envoyé(s).`);
  return { examined: galleries.length, sent };
}
