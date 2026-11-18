// E-mails du studio à ses clients (relances et campagnes) : ce qui est
// commun aux deux.
//
//  - Journal (email_sends) : un envoi par destinataire, avec un jeton qui
//    sert au lien de désinscription et au suivi des clics. C'est lui qui
//    permet de dire « cette relance a rapporté 340 € ».
//  - Consentement : la case « recevoir les offres du studio », jamais
//    pré-cochée (galerie, réservation, commande de tirages), ou notée par le
//    photographe. Les campagnes ne partent qu'aux clients qui l'ont cochée ;
//    les relances de fidélité (un an déjà, dates à retenir…) aux clients
//    existants, avec un lien de désinscription, comme le permet le RGPD pour
//    des services analogues. Une désinscription arrête tout ce qui n'est pas
//    strictement lié à une galerie ou une commande en cours.
//  - Mise en forme : un e-mail sobre, au nom du studio, dans la langue du
//    client, avec un bouton et un pied de page « se désinscrire ».
//  - Envoi : depuis l'adresse du studio si son domaine est vérifié (voir
//    senderdomain.js), sinon depuis Holypixx ; réponse toujours au
//    photographe ; en-têtes List-Unsubscribe (désinscription en un clic dans
//    Gmail, Outlook, Apple Mail).
//
//   GET  /api/m/u/<jeton>    page « Se désinscrire »
//   POST /api/m/u/<jeton>    désinscription (bouton de la page, ou un clic
//                            dans la messagerie : List-Unsubscribe-Post)
//   GET  /api/m/c/<lien>     clic suivi, puis redirection (lien signé)

import { b64url, randomBytes, signToken, verifyToken } from "./auth.js";
import { LANGUAGES, languageOf, pick, formatDate } from "./i18n.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = 86400;
// Une vente ou une réservation dans les 14 jours qui suivent un e-mail lui
// est attribuée (le dernier e-mail reçu avant l'achat).
export const ATTRIBUTION_DAYS = 14;

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
const ROSE = "#b98a7a";
const CREAM = "#f7f2ec";
const INK = "#2b2521";
const CHARCOAL = "#3a332e";
const MUTED = "#7c716a";

export function now() {
  return Math.floor(Date.now() / 1000);
}

function newId(prefix) {
  return `${prefix}_${b64url(randomBytes(9))}`;
}

export function normEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function isEmail(value) {
  return EMAIL_RE.test(normEmail(value));
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Adresse publique du Worker (liens de désinscription et de suivi). Les
// passes planifiées n'ont pas de requête d'où la tirer.
export function apiOrigin(env) {
  return String(env.PUBLIC_API_ORIGIN || "https://galerie-protegee.littledreamphotos-be.workers.dev").replace(/\/+$/, "");
}

/* ---------- Réglages des relances ---------- */

// Fragment SQL : vrai si le photographe (colonne `col`) a coupé la relance `key`.
export function automationOffSql(key, col = "p.id") {
  return `EXISTS (SELECT 1 FROM automation_settings a_${key} WHERE a_${key}.photographer_id = ${col} AND a_${key}.key = '${key}' AND a_${key}.enabled = 0)`;
}

export async function settingsOf(env, photographerId) {
  const { results } = await env.DB.prepare("SELECT * FROM automation_settings WHERE photographer_id = ?").bind(photographerId).all();
  const map = new Map();
  for (const r of results || []) {
    let texts = {};
    try { texts = r.texts ? JSON.parse(r.texts) : {}; } catch { texts = {}; }
    map.set(r.key, { enabled: r.enabled !== 0, delayDays: r.delay_days, value: r.value || "", texts, updatedAt: r.updated_at });
  }
  return map;
}

// `defaultEnabled` : état d'une relance jamais réglée (enregistrer son texte
// ne l'active pas).
export async function saveSetting(env, photographerId, key, { enabled, delayDays, value, texts }, defaultEnabled = true) {
  const current = (await settingsOf(env, photographerId)).get(key);
  const row = {
    enabled: enabled === undefined ? (current ? current.enabled : Boolean(defaultEnabled)) : Boolean(enabled),
    delayDays: delayDays === undefined ? (current ? current.delayDays : null) : delayDays,
    value: value === undefined ? (current ? current.value : "") : value,
    texts: texts === undefined ? (current ? current.texts : {}) : texts,
  };
  await env.DB.prepare(
    `INSERT INTO automation_settings (photographer_id, key, enabled, delay_days, value, texts, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(photographer_id, key) DO UPDATE SET enabled = excluded.enabled, delay_days = excluded.delay_days,
       value = excluded.value, texts = excluded.texts, updated_at = excluded.updated_at`
  ).bind(photographerId, key, row.enabled === null ? 1 : row.enabled ? 1 : 0, row.delayDays ?? null, row.value || "", JSON.stringify(row.texts || {}), now()).run();
}

/* ---------- Consentement, langue, désinscription ---------- */

// Fiche du client (créée au besoin) : consentement, désinscription, langue.
export async function contactOf(env, photographerId, email) {
  return env.DB.prepare("SELECT * FROM clients WHERE photographer_id = ? AND email = ?").bind(photographerId, normEmail(email)).first();
}

async function ensureContact(env, photographerId, email, name) {
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO clients (id, photographer_id, email, name, phone, notes, tags, created_at, updated_at) VALUES (?, ?, ?, ?, '', '', '', ?, ?)
     ON CONFLICT(photographer_id, email) DO UPDATE SET name = CASE WHEN clients.name = '' THEN excluded.name ELSE clients.name END`
  ).bind(newId("cli"), photographerId, normEmail(email), String(name || "").trim().slice(0, 120), ts, ts).run();
}

// Le client a coché « recevoir les offres du studio » (ou le photographe le
// note). source : gallery | booking | checkout | photographer.
export async function recordConsent(env, photographerId, email, { source, name, lang } = {}) {
  const key = normEmail(email);
  if (!EMAIL_RE.test(key)) return false;
  await ensureContact(env, photographerId, key, name);
  await env.DB.prepare(
    `UPDATE clients SET marketing_consent = 1, consent_at = ?, consent_source = ?, unsubscribed_at = NULL,
            lang = CASE WHEN ? != '' THEN ? ELSE lang END, updated_at = ?
      WHERE photographer_id = ? AND email = ?`
  ).bind(now(), String(source || "").slice(0, 20), LANGUAGES.includes(lang) ? lang : "", LANGUAGES.includes(lang) ? lang : "", now(), photographerId, key).run();
  return true;
}

// Retrait du consentement par le photographe (sur demande du client).
export async function withdrawConsent(env, photographerId, email) {
  await env.DB.prepare("UPDATE clients SET marketing_consent = 0, updated_at = ? WHERE photographer_id = ? AND email = ?")
    .bind(now(), photographerId, normEmail(email)).run();
}

export async function unsubscribeContact(env, photographerId, email) {
  await ensureContact(env, photographerId, email, "");
  await env.DB.prepare("UPDATE clients SET unsubscribed_at = ?, marketing_consent = 0, updated_at = ? WHERE photographer_id = ? AND email = ?")
    .bind(now(), now(), photographerId, normEmail(email)).run();
}

export async function resubscribeContact(env, photographerId, email) {
  await env.DB.prepare("UPDATE clients SET unsubscribed_at = NULL, updated_at = ? WHERE photographer_id = ? AND email = ?")
    .bind(now(), photographerId, normEmail(email)).run();
}

// Langue d'un client : celle de sa fiche, sinon de sa dernière galerie.
export async function languageForClient(env, photographerId, email, fallback) {
  const contact = await contactOf(env, photographerId, email);
  if (contact && LANGUAGES.includes(contact.lang)) return contact.lang;
  const g = await env.DB.prepare("SELECT language FROM galleries WHERE photographer_id = ? AND client_email = ? ORDER BY created_at DESC LIMIT 1")
    .bind(photographerId, normEmail(email)).first();
  return g ? languageOf(g.language) : languageOf(fallback);
}

/* ---------- Journal des envois ---------- */

export async function queueSend(env, { photographerId, email, kind, refId = "", lang = "fr", subject = "", status = "queued" }) {
  const id = newId("snd");
  const token = b64url(randomBytes(18));
  await env.DB.prepare(
    "INSERT INTO email_sends (id, photographer_id, client_email, kind, ref_id, lang, subject, token, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, photographerId, normEmail(email), kind, refId, languageOf(lang), String(subject).slice(0, 200), token, status, now()).run();
  return { id, token };
}

export async function markSent(env, sendId, { ok, subject }) {
  await env.DB.prepare("UPDATE email_sends SET status = ?, sent_at = ?, subject = COALESCE(?, subject) WHERE id = ?")
    .bind(ok ? "sent" : "failed", now(), subject ?? null, sendId).run();
}

// Déjà envoyé (relance unique) : même clé, même client, même référence.
export async function alreadySent(env, photographerId, kind, email, refId = "") {
  const row = await env.DB.prepare(
    "SELECT 1 FROM email_sends WHERE photographer_id = ? AND kind = ? AND client_email = ? AND ref_id = ? AND status IN ('sent', 'queued') LIMIT 1"
  ).bind(photographerId, kind, normEmail(email), refId).first();
  return Boolean(row);
}

export function unsubscribeUrl(env, token) {
  return `${apiOrigin(env)}/api/m/u/${encodeURIComponent(token)}`;
}

// Lien suivi : signé, pour que personne ne fabrique une redirection vers un
// site tiers à partir de notre adresse.
export async function trackedUrl(env, token, url) {
  if (!url || !token) return url || "";
  // Un lien d'e-mail reste valable longtemps (400 jours).
  const signed = await signToken(env.TOKEN_SECRET, { t: token, u: url, exp: now() + 400 * DAY });
  return `${apiOrigin(env)}/api/m/c/${encodeURIComponent(signed)}`;
}

/* ---------- Mise en forme ---------- */

// Remplace {prenom}, {studio}, {galerie}… ; une variable inconnue disparaît.
export function fillPlaceholders(text, vars) {
  return String(text || "").replace(/\{([a-z_]+)\}/g, (all, name) => (vars[name] !== undefined && vars[name] !== null ? String(vars[name]) : ""));
}

export function firstNameOf(name) {
  const clean = String(name || "").trim();
  if (!clean) return "";
  // « Famille Martin » reste entier ; « Sophie Martin » → « Sophie ».
  if (/^(famille|family|familie|les|the|de familie)\b/i.test(clean)) return clean;
  return clean.split(/\s+/)[0];
}

// Corps du message : paragraphes séparés par une ligne vide ; **gras**.
function bodyParagraphs(text) {
  return String(text || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => escapeHtml(p).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br />"));
}

const FOOTER = {
  fr: (studio) => `Vous recevez cet e-mail parce que vous êtes client·e de ${studio}.`,
  en: (studio) => `You're receiving this email because you're a client of ${studio}.`,
  nl: (studio) => `Je krijgt deze e-mail omdat je klant bent bij ${studio}.`,
};
const UNSUB_LABEL = { fr: "Se désinscrire", en: "Unsubscribe", nl: "Uitschrijven" };

// E-mail au nom du studio : titre, paragraphes, bouton, désinscription.
export function renderStudioEmail({ lang, studioName, subject, body, ctaLabel, ctaUrl, unsubscribe, preheader }) {
  const l = languageOf(lang);
  const paragraphs = bodyParagraphs(body);
  const button = ctaUrl && ctaLabel
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 6px;"><tr><td style="border-radius:999px;background:${ROSE};">` +
      `<a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:14px 30px;font-family:${SANS};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${escapeHtml(ctaLabel)}</a></td></tr></table>`
    : "";
  const html = `<!doctype html>
<html lang="${l}">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="light" /><title>${escapeHtml(subject)}</title></head>
  <body style="margin:0;padding:0;background:${CREAM};">
    <span style="display:none;max-height:0;overflow:hidden;font-size:1px;color:${CREAM};">${escapeHtml(preheader || subject)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};">
      <tr><td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
          <tr><td style="padding-bottom:20px;font-family:${SERIF};font-size:19px;font-weight:700;color:${INK};">${escapeHtml(studioName)}</td></tr>
          <tr><td style="background:#ffffff;border-radius:16px;padding:34px 30px;">
            ${paragraphs.map((p) => `<p style="margin:0 0 14px;font-family:${SANS};font-size:15px;line-height:1.65;color:${CHARCOAL};">${p}</p>`).join("\n            ")}
            ${button}
          </td></tr>
          <tr><td style="padding-top:22px;text-align:center;font-family:${SANS};font-size:12px;line-height:1.6;color:${MUTED};">
            ${escapeHtml(FOOTER[l](studioName))}${unsubscribe ? `<br /><a href="${escapeHtml(unsubscribe)}" style="color:${MUTED};">${UNSUB_LABEL[l]}</a>` : ""}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
  const text = [
    ...String(body || "").split(/\n{2,}/).map((p) => p.trim().replace(/\*\*/g, "")).filter(Boolean),
    ctaUrl && ctaLabel ? `${ctaLabel} : ${ctaUrl}` : "",
    "—",
    FOOTER[l](studioName),
    unsubscribe ? `${UNSUB_LABEL[l]} : ${unsubscribe}` : "",
  ].filter(Boolean).join("\n\n");
  return { subject, html, text };
}

/* ---------- Envoi ---------- */

// Expéditeur : l'adresse du studio si son domaine est vérifié.
export async function senderFor(env, photographer) {
  const studio = String(photographer?.studio_name || "").replace(/[<>"\r\n]/g, "").trim();
  const row = photographer?.id
    ? await env.DB.prepare("SELECT domain, local_part, status FROM sender_domains WHERE photographer_id = ?").bind(photographer.id).first().catch(() => null)
    : null;
  if (row && row.status === "verified") return `${studio || row.domain} <${row.local_part}@${row.domain}>`;
  const base = env.RESEND_FROM || "Holypixx <alertes@holypixx.com>";
  const address = (/<([^>]+)>/.exec(base) || [null, base])[1];
  return studio ? `${studio} via Holypixx <${address}>` : base;
}

// Envoi par Resend ; vrai si accepté. Jamais d'exception.
export async function deliver(env, { from, to, replyTo, subject, html, text, unsubscribe }) {
  if (!env.RESEND_API_KEY || !to) return false;
  try {
    const headers = unsubscribe ? { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to, subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}), ...(headers ? { headers } : {}) }),
    });
    if (!response.ok) {
      console.error(`Resend a refusé l'e-mail du studio (HTTP ${response.status}) : ${(await response.text().catch(() => "")).slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Échec de l'envoi d'e-mail du studio :", err?.message || err);
    return false;
  }
}

// Envoi groupé (campagnes) : jusqu'à 100 e-mails par appel à Resend.
// Renvoie un tableau de booléens, dans l'ordre.
export async function deliverBatch(env, mails) {
  if (!mails.length) return [];
  if (!env.RESEND_API_KEY) return mails.map(() => false);
  try {
    const response = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(mails.map((m) => ({
        from: m.from, to: m.to, subject: m.subject, html: m.html, text: m.text,
        ...(m.replyTo ? { reply_to: m.replyTo } : {}),
        ...(m.unsubscribe ? { headers: { "List-Unsubscribe": `<${m.unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
      }))),
    });
    if (!response.ok) {
      console.error(`Resend a refusé l'envoi groupé (HTTP ${response.status}) : ${(await response.text().catch(() => "")).slice(0, 300)}`);
      return mails.map(() => false);
    }
    return mails.map(() => true);
  } catch (err) {
    console.error("Échec de l'envoi groupé :", err?.message || err);
    return mails.map(() => false);
  }
}

// Un e-mail du studio à un client, de bout en bout : journal, liens suivis,
// désinscription, envoi. `marketing` : refusé si le client s'est désinscrit.
// Renvoie { sent, skipped, sendId }.
export async function sendStudioMail(env, photographer, { to, kind, refId = "", lang, subject, body, ctaLabel, ctaUrl, marketing = true, sendRow }) {
  const email = normEmail(to);
  if (!EMAIL_RE.test(email)) return { sent: false, skipped: "email" };
  if (marketing) {
    const contact = await contactOf(env, photographer.id, email);
    if (contact?.unsubscribed_at) return { sent: false, skipped: "unsubscribed" };
  }
  const row = sendRow || await queueSend(env, { photographerId: photographer.id, email, kind, refId, lang, subject });
  const unsubscribe = unsubscribeUrl(env, row.token);
  const mail = renderStudioEmail({
    lang, studioName: studioLabel(photographer), subject, body, ctaLabel,
    ctaUrl: ctaUrl ? await trackedUrl(env, row.token, ctaUrl) : "", unsubscribe,
  });
  const ok = await deliver(env, { from: await senderFor(env, photographer), to: email, replyTo: photographer.email, ...mail, unsubscribe });
  await markSent(env, row.id, { ok, subject });
  return { sent: ok, sendId: row.id };
}

export function studioLabel(photographer) {
  const studio = String(photographer?.studio_name || "").trim();
  if (studio) return studio;
  const name = [photographer?.first_name, photographer?.last_name].filter(Boolean).join(" ").trim();
  return name || "Votre photographe";
}

/* ---------- Mesure : envois, clics, ventes attribuées ---------- */

// Ventes et réservations de chaque client du photographe (date, montant, type).
export async function conversionsOf(env, photographerId, since) {
  const [payments, bookings, gifts, contracts, invoices] = await Promise.all([
    env.DB.prepare(
      `SELECT CASE WHEN p.kind = 'print' AND o.client_email != '' THEN o.client_email ELSE g.client_email END AS email,
              p.paid_at AS at, p.amount_cents AS cents, p.kind AS kind
         FROM payments p JOIN galleries g ON g.id = p.gallery_id LEFT JOIN print_orders o ON o.payment_id = p.id
        WHERE g.photographer_id = ? AND p.status = 'paid' AND p.paid_at >= ?`
    ).bind(photographerId, since).all(),
    env.DB.prepare(
      "SELECT client_email AS email, created_at AS at, CASE WHEN paid_at IS NOT NULL THEN deposit_cents ELSE 0 END AS cents FROM bookings WHERE photographer_id = ? AND status = 'confirmed' AND created_at >= ?"
    ).bind(photographerId, since).all(),
    env.DB.prepare(
      "SELECT buyer_email AS email, paid_at AS at, amount_cents AS cents FROM gift_cards WHERE photographer_id = ? AND source = 'online' AND status != 'cancelled' AND status != 'pending' AND paid_at >= ?"
    ).bind(photographerId, since).all(),
    env.DB.prepare(
      "SELECT client_email AS email, paid_at AS at, deposit_cents AS cents FROM contracts WHERE photographer_id = ? AND status = 'paid' AND paid_at >= ?"
    ).bind(photographerId, since).all(),
    env.DB.prepare(
      "SELECT client_email AS email, paid_at AS at, total_cents AS cents FROM client_invoices WHERE photographer_id = ? AND kind = 'invoice' AND source = 'manual' AND status = 'paid' AND paid_at >= ?"
    ).bind(photographerId, since).all(),
  ]);
  const out = [];
  const add = (rows, type) => (rows.results || []).forEach((r) => { if (r.email && r.at) out.push({ email: normEmail(r.email), at: r.at, cents: r.cents || 0, type: type === "payment" ? (r.kind === "print" ? "print" : "supplement") : type }); });
  add(payments, "payment");
  add(bookings, "booking");
  add(gifts, "gift");
  add(contracts, "contract");
  add(invoices, "invoice");
  return out;
}

// Chaque vente revient au dernier e-mail reçu dans les 14 jours qui la
// précèdent (une seule fois). Renvoie Map(sendId → { cents, bookings, sales }).
export function attribute(sends, conversions) {
  const byEmail = new Map();
  for (const s of sends) {
    if (!s.sent_at || s.status !== "sent") continue;
    if (!byEmail.has(s.client_email)) byEmail.set(s.client_email, []);
    byEmail.get(s.client_email).push(s);
  }
  for (const list of byEmail.values()) list.sort((a, b) => a.sent_at - b.sent_at);
  const result = new Map();
  for (const c of conversions) {
    const list = byEmail.get(c.email);
    if (!list) continue;
    let best = null;
    for (const s of list) {
      if (s.sent_at <= c.at && c.at - s.sent_at <= ATTRIBUTION_DAYS * DAY) best = s;
    }
    if (!best) continue;
    const r = result.get(best.id) || { cents: 0, bookings: 0, sales: 0 };
    r.cents += c.cents;
    if (c.type === "booking") r.bookings++;
    else r.sales++;
    result.set(best.id, r);
  }
  return result;
}

// Chiffres par clé (relance) ou par campagne, sur une période.
export async function statsOf(env, photographerId, { since, kindPrefix }) {
  const { results: sends } = await env.DB.prepare(
    `SELECT id, client_email, kind, ref_id, status, sent_at, clicked_at, clicks FROM email_sends
      WHERE photographer_id = ? AND created_at >= ? AND kind LIKE ?`
  ).bind(photographerId, since, `${kindPrefix}%`).all();
  const conversions = await conversionsOf(env, photographerId, since);
  const attributed = attribute(sends || [], conversions);
  const groups = new Map();
  for (const s of sends || []) {
    const key = kindPrefix === "campaign" ? s.ref_id : s.kind.replace(/^auto:/, "");
    const g = groups.get(key) || { sent: 0, failed: 0, clicked: 0, cents: 0, bookings: 0, sales: 0, queued: 0 };
    if (s.status === "sent") g.sent++;
    else if (s.status === "failed") g.failed++;
    else if (s.status === "queued") g.queued++;
    if (s.clicked_at) g.clicked++;
    const a = attributed.get(s.id);
    if (a) { g.cents += a.cents; g.bookings += a.bookings; g.sales += a.sales; }
    groups.set(key, g);
  }
  return groups;
}

/* ---------- Routes publiques : désinscription, clics ---------- */

const UNSUB_PAGE = {
  fr: { title: "Se désinscrire", ask: (s) => `Ne plus recevoir les e-mails d'offres et de nouvelles de ${s} ?`, button: "Me désinscrire", done: (s) => `C'est fait : vous ne recevrez plus les offres de ${s}. Les e-mails liés à vos galeries et commandes en cours continuent d'arriver.`, unknown: "Ce lien n'est plus valable." },
  en: { title: "Unsubscribe", ask: (s) => `Stop receiving offers and news from ${s}?`, button: "Unsubscribe me", done: (s) => `Done: you won't receive offers from ${s} anymore. Emails about your current galleries and orders will still arrive.`, unknown: "This link is no longer valid." },
  nl: { title: "Uitschrijven", ask: (s) => `Geen aanbiedingen en nieuws meer ontvangen van ${s}?`, button: "Schrijf me uit", done: (s) => `Klaar: je krijgt geen aanbiedingen meer van ${s}. E-mails over je lopende galerijen en bestellingen blijven wel komen.`, unknown: "Deze link is niet meer geldig." },
};

function page(lang, title, inner) {
  return new Response(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>${escapeHtml(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:${CREAM};font-family:${SANS};color:${CHARCOAL}}main{max-width:440px;background:#fff;border-radius:16px;padding:32px 28px;text-align:center;box-shadow:0 10px 30px rgba(43,37,33,.08)}h1{font-family:${SERIF};font-size:22px;color:${INK};margin:0 0 14px}p{line-height:1.6;margin:0 0 18px}button{font:inherit;font-weight:600;color:#fff;background:${ROSE};border:0;border-radius:999px;padding:13px 28px;cursor:pointer}button:focus-visible{outline:3px solid ${INK};outline-offset:3px}</style></head>
<body><main>${inner}</main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

export async function handleMailPublic(request, env, path) {
  const parts = path.split("/").filter(Boolean); // api, m, u|c, jeton
  const action = parts[2];
  const token = decodeURIComponent(parts[3] || "");
  if (action === "c" && request.method === "GET") {
    const data = await verifyToken(env.TOKEN_SECRET, token).catch(() => null);
    const url = data && typeof data.u === "string" && /^https?:\/\//.test(data.u) ? data.u : "";
    if (!url) return new Response("Lien invalide", { status: 400 });
    await env.DB.prepare("UPDATE email_sends SET clicks = clicks + 1, clicked_at = COALESCE(clicked_at, ?) WHERE token = ?").bind(now(), String(data.t || "")).run().catch(() => {});
    return Response.redirect(url, 302);
  }
  if (action === "u") {
    const send = token ? await env.DB.prepare(
      `SELECT s.*, p.studio_name, p.first_name, p.last_name FROM email_sends s JOIN photographers p ON p.id = s.photographer_id WHERE s.token = ?`
    ).bind(token).first() : null;
    const lang = languageOf(send?.lang);
    const t = UNSUB_PAGE[lang];
    if (!send) return page(lang, t.title, `<h1>${t.title}</h1><p>${t.unknown}</p>`);
    const studio = escapeHtml(studioLabel(send));
    if (request.method === "POST") {
      await unsubscribeContact(env, send.photographer_id, send.client_email);
      return page(lang, t.title, `<h1>${t.title}</h1><p>${t.done(studio)}</p>`);
    }
    // GET : une page à confirmer (les antivirus qui ouvrent les liens ne
    // désinscrivent personne par erreur).
    return page(lang, t.title, `<h1>${t.title}</h1><p>${t.ask(studio)}</p><form method="post"><button type="submit">${t.button}</button></form>`);
  }
  return new Response("Route inconnue", { status: 404 });
}

// Utilitaire pour les textes : « 20 % » / « 20% » selon la langue.
export function percentLabel(percent, lang) {
  return pick(languageOf(lang), `${percent} %`, `${percent}%`, `${percent}%`);
}

export function dateLabel(ts, lang) {
  return formatDate(ts, languageOf(lang), { day: "numeric", month: "long" });
}
