// Onglet « Relances » de l'espace photographe : routes /api/admin/mailing/…
//
//   overview                 chiffres des 30 derniers jours et derniers envois
//   automations[/…]          relances automatiques (automations.js)
//   campaigns[/…]            campagnes (broadcasts.js)
//   contacts        (GET)    consentement, langue, désinscription de chaque client
//   contacts        (POST)   { email, consent | unsubscribed: false | lang }
//   sender[/…]               adresse d'envoi du studio (senderdomain.js)
//   send            (POST)   e-mail direct à un client (fiche, dates à retenir)

import { json, fail } from "./http.js";
import { LANGUAGES, languageOf } from "./i18n.js";
import { collect } from "./clients.js";
import { handleAutomationsAdmin } from "./automations.js";
import { handleBroadcastsAdmin } from "./broadcasts.js";
import { handleSenderAdmin } from "./senderdomain.js";
import {
  now, normEmail, isEmail, statsOf, recordConsent, withdrawConsent, resubscribeContact, unsubscribeContact,
  sendStudioMail, languageForClient, contactOf,
} from "./mailing.js";

const DAY = 86400;

async function overview(env, photographer) {
  const since = now() - 30 * DAY;
  const [auto, camp] = await Promise.all([
    statsOf(env, photographer.id, { since, kindPrefix: "auto:" }),
    statsOf(env, photographer.id, { since, kindPrefix: "campaign" }),
  ]);
  const sum = (maps) => {
    const t = { sent: 0, clicked: 0, cents: 0, bookings: 0, sales: 0 };
    for (const m of maps) for (const g of m.values()) { t.sent += g.sent; t.clicked += g.clicked; t.cents += g.cents; t.bookings += g.bookings; t.sales += g.sales; }
    return t;
  };
  const { results: recent } = await env.DB.prepare(
    `SELECT s.client_email, s.kind, s.ref_id, s.subject, s.status, s.sent_at, s.clicked_at, b.name AS campaign_name
       FROM email_sends s LEFT JOIN broadcasts b ON b.id = s.ref_id AND s.kind = 'campaign'
      WHERE s.photographer_id = ? AND s.sent_at IS NOT NULL ORDER BY s.sent_at DESC LIMIT 30`
  ).bind(photographer.id).all();
  return {
    totals: sum([auto, camp]),
    automations: sum([auto]),
    campaigns: sum([camp]),
    recent: (recent || []).map((r) => ({
      email: r.client_email, kind: r.kind, campaign: r.campaign_name || "", subject: r.subject, status: r.status, sentAt: r.sent_at, clicked: Boolean(r.clicked_at),
    })),
  };
}

async function contacts(env, photographer) {
  const all = await collect(env, photographer.id);
  const list = all.filter((c) => c.email).map((c) => ({
    email: c.email, name: c.name || c.email, consent: c.consent, consentAt: c.consentAt, consentSource: c.consentSource,
    unsubscribed: Boolean(c.unsubscribedAt), unsubscribedAt: c.unsubscribedAt, lang: c.lang,
    customer: c.galleries.length > 0 || c.paidCents > 0,
  })).sort((a, b) => (b.consentAt || 0) - (a.consentAt || 0) || a.name.localeCompare(b.name, "fr"));
  return {
    contacts: list,
    counts: {
      total: list.length,
      consent: list.filter((c) => c.consent && !c.unsubscribed).length,
      customers: list.filter((c) => c.customer && !c.unsubscribed).length,
      unsubscribed: list.filter((c) => c.unsubscribed).length,
    },
  };
}

export async function handleMailingAdmin(request, env, ctx, photographer, parts) {
  // parts : ce qui suit /api/admin/mailing
  const section = parts[0];
  const rest = parts.slice(1);
  if (section === "overview" && request.method === "GET") return json(await overview(env, photographer));
  if (section === "automations") return handleAutomationsAdmin(request, env, photographer, rest);
  if (section === "campaigns") return handleBroadcastsAdmin(request, env, ctx, photographer, rest);
  if (section === "sender") return handleSenderAdmin(request, env, photographer, rest);

  if (section === "contacts" && !rest.length) {
    if (request.method === "GET") return json(await contacts(env, photographer));
    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const email = normEmail(body.email);
      if (!isEmail(email)) return fail(400, "Adresse e-mail invalide");
      if (body.consent === true) await recordConsent(env, photographer.id, email, { source: "photographer" });
      if (body.consent === false) await withdrawConsent(env, photographer.id, email);
      if (body.unsubscribed === false) await resubscribeContact(env, photographer.id, email);
      if (body.unsubscribed === true) await unsubscribeContact(env, photographer.id, email);
      if (body.lang !== undefined) {
        const lang = LANGUAGES.includes(body.lang) ? body.lang : "";
        await env.DB.prepare("UPDATE clients SET lang = ?, updated_at = ? WHERE photographer_id = ? AND email = ?").bind(lang, now(), photographer.id, email).run();
      }
      return json(await contacts(env, photographer));
    }
  }

  // E-mail direct à un client, rédigé par le photographe (fiche client,
  // dates à retenir, client à revoir) : au nom du studio, réponse vers lui.
  if (section === "send" && !rest.length && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const email = normEmail(body.email);
    const subject = String(body.subject || "").trim().slice(0, 160);
    const text = String(body.body || "").replace(/\r\n/g, "\n").trim().slice(0, 6000);
    if (!isEmail(email)) return fail(400, "Adresse e-mail invalide");
    if (!subject || !text) return fail(400, "Écrivez l'objet et le message");
    const known = await contactOf(env, photographer.id, email);
    const gallery = await env.DB.prepare("SELECT 1 FROM galleries WHERE photographer_id = ? AND client_email = ? LIMIT 1").bind(photographer.id, email).first();
    const booking = await env.DB.prepare("SELECT 1 FROM bookings WHERE photographer_id = ? AND lower(client_email) = ? LIMIT 1").bind(photographer.id, email).first();
    if (!known && !gallery && !booking) return fail(404, "Ce client n'est pas dans vos fiches");
    // Limite anti-abus : 200 messages directs par jour.
    const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM email_sends WHERE photographer_id = ? AND kind = 'direct' AND created_at > ?").bind(photographer.id, now() - DAY).first();
    if ((today?.n || 0) >= 200) return fail(429, "200 messages par jour au maximum");
    const lang = languageOf(body.lang || await languageForClient(env, photographer.id, email, "fr"));
    const ctaUrl = /^https:\/\/\S+$/.test(String(body.ctaUrl || "")) ? String(body.ctaUrl) : "";
    const result = await sendStudioMail(env, photographer, {
      to: email, kind: "direct", refId: String(body.ref || "").slice(0, 80), lang, subject, body: text,
      ctaLabel: ctaUrl ? String(body.ctaLabel || "").slice(0, 60) : "", ctaUrl, marketing: false,
    });
    if (!result.sent && env.RESEND_API_KEY) return fail(502, "Le message n'est pas parti : réessayez dans un instant");
    return json({ ok: true });
  }
  return fail(404, "Route inconnue");
}
