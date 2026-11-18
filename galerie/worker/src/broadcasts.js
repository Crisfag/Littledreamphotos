// Campagnes e-mail du studio vers ses clients (formule Pro) : un modèle de
// saison (Noël, fête des mères, mini-séances, vente flash tirages…) ou un
// message libre, en français, anglais et néerlandais, envoyé à une partie
// ciblée des clients, tout de suite ou à une date choisie.
//
// Ciblage : clients qui ont accepté de recevoir les offres (case jamais
// pré-cochée) — ou, au choix, aussi les clients qui ont déjà fait une séance
// ou un achat, sans s'y être opposés (« offres analogues » du RGPD) ;
// jamais un client désinscrit. Filtres combinables : type de séance, tag,
// langue, inactivité, dépense totale.
//
// Une remise sur les tirages peut accompagner la campagne : elle s'applique
// à leurs galeries ouvertes, pour la durée choisie.
//
// Mesure : envois, clics, réservations et ventes dans les 14 jours.
//
//   /api/admin/mailing/campaigns                  liste, modèles, filtres possibles
//   /api/admin/mailing/campaigns          (POST)  créer (brouillon)
//   /api/admin/mailing/campaigns/audience (POST)  compter les destinataires d'un ciblage
//   /api/admin/mailing/campaigns/:id      (POST)  modifier ; (DELETE) supprimer un brouillon
//   /api/admin/mailing/campaigns/:id/preview (POST) aperçu { lang }
//   /api/admin/mailing/campaigns/:id/test    (POST) envoi test au photographe
//   /api/admin/mailing/campaigns/:id/send    (POST) { at } : maintenant ou programmée
//   /api/admin/mailing/campaigns/:id/cancel  (POST) annuler une programmation

import { json, fail } from "./http.js";
import { b64url, randomBytes } from "./auth.js";
import { LANGUAGES, languageOf } from "./i18n.js";
import { hasFeature, featureRefusal } from "./subscription.js";
import { galleryUrlFor } from "./reminders.js";
import { PROMO_PERCENTS } from "./campaigns.js";
import { collect, bookingPageUrl } from "./clients.js";
import { CAMPAIGN_TEMPLATES } from "./mailingTexts.js";
import {
  now, normEmail, renderStudioEmail, deliver, deliverBatch, senderFor, studioLabel, fillPlaceholders, firstNameOf,
  statsOf, percentLabel, dateLabel, queueSend, unsubscribeUrl, trackedUrl,
} from "./mailing.js";

const DAY = 86400;
export const MAX_RECIPIENTS = 3000;
const BATCH = 50;
const CTAS = ["booking", "gallery", "url", "none"];

function newId(prefix) {
  return `${prefix}_${b64url(randomBytes(9))}`;
}

function parse(text, fallback) {
  try { return text ? JSON.parse(text) : fallback; } catch { return fallback; }
}

/* ---------- Ciblage ---------- */

export function cleanSegment(input) {
  const s = input && typeof input === "object" ? input : {};
  const list = (v, max = 30) => (Array.isArray(v) ? v.map((x) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, max) : []);
  const int = (v, min, max) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= min && n <= max ? n : 0;
  };
  return {
    audience: s.audience === "customers" ? "customers" : "consent",
    sessionTypes: list(s.sessionTypes),
    tags: list(s.tags),
    langs: list(s.langs).filter((l) => LANGUAGES.includes(l)),
    inactiveMonths: int(s.inactiveMonths, 1, 60),
    activeMonths: int(s.activeMonths, 1, 60),
    minSpentCents: int(s.minSpentCents, 1, 100000000),
  };
}

function langOf(c) {
  if (LANGUAGES.includes(c.lang)) return c.lang;
  const last = [...c.galleries].sort((a, b) => b.createdAt - a.createdAt)[0];
  return languageOf(last?.language);
}

function isCustomer(c) {
  return c.galleries.length > 0 || c.paidCents > 0 || c.bookings.some((b) => b.status === "confirmed");
}

// Clients retenus, et pourquoi les autres ne le sont pas.
export function selectAudience(clients, segment, at = now()) {
  const seg = cleanSegment(segment);
  const out = [];
  const excluded = { noEmail: 0, unsubscribed: 0, noConsent: 0, filtered: 0 };
  for (const c of clients) {
    if (!c.email) { excluded.noEmail++; continue; }
    if (c.unsubscribedAt) { excluded.unsubscribed++; continue; }
    if (!(c.consent || (seg.audience === "customers" && isCustomer(c)))) { excluded.noConsent++; continue; }
    const types = new Set(c.galleries.map((g) => g.sessionType).filter(Boolean));
    const lang = langOf(c);
    const last = c.lastSessionAt || 0;
    const keep =
      (!seg.sessionTypes.length || seg.sessionTypes.some((t) => types.has(t))) &&
      (!seg.tags.length || seg.tags.some((t) => (c.tags || []).includes(t))) &&
      (!seg.langs.length || seg.langs.includes(lang)) &&
      (!seg.inactiveMonths || (last && last < at - seg.inactiveMonths * 30 * DAY && !c.upcomingSessionAt)) &&
      (!seg.activeMonths || last >= at - seg.activeMonths * 30 * DAY) &&
      (!seg.minSpentCents || c.paidCents >= seg.minSpentCents);
    if (!keep) { excluded.filtered++; continue; }
    out.push({ email: c.email, name: c.name, lang, client: c });
  }
  return { recipients: out, excluded };
}

/* ---------- Textes ---------- */

function cleanTexts(input) {
  const out = {};
  for (const l of LANGUAGES) {
    const t = input && input[l];
    if (!t) continue;
    const subject = String(t.subject || "").trim().slice(0, 160);
    const body = String(t.body || "").replace(/\r\n/g, "\n").trim().slice(0, 6000);
    const cta = String(t.cta || "").trim().slice(0, 60);
    if (subject || body) out[l] = { subject, body, cta };
  }
  return out;
}

// Texte d'une langue : la version écrite pour elle, sinon le français.
function textsFor(campaign, lang) {
  const texts = parse(campaign.texts, {});
  const t = texts[lang]?.subject && texts[lang]?.body ? texts[lang] : texts.fr || Object.values(texts)[0] || { subject: "", body: "", cta: "" };
  return { subject: t.subject || "", body: t.body || "", cta: t.cta || campaign.cta_label || "" };
}

function campaignOut(row, stats) {
  return {
    id: row.id, name: row.name, template: row.template, texts: parse(row.texts, {}), cta: row.cta, ctaUrl: row.cta_url,
    printPromo: row.print_promo, promoDays: row.promo_days, segment: parse(row.segment, {}), status: row.status,
    scheduledAt: row.scheduled_at, startedAt: row.started_at, sentAt: row.sent_at, recipients: row.recipients,
    createdAt: row.created_at, updatedAt: row.updated_at, stats: stats || null,
  };
}

/* ---------- Photographe ---------- */

async function listForAdmin(env, photographer) {
  const { results } = await env.DB.prepare("SELECT * FROM broadcasts WHERE photographer_id = ? AND status != 'archived' ORDER BY created_at DESC LIMIT 100").bind(photographer.id).all();
  const stats = await statsOf(env, photographer.id, { since: now() - 400 * DAY, kindPrefix: "campaign" });
  const clients = await collect(env, photographer.id);
  const types = new Map();
  const tags = new Map();
  const langs = new Map();
  let consent = 0, unsubscribed = 0, customers = 0;
  for (const c of clients) {
    if (!c.email) continue;
    if (c.unsubscribedAt) { unsubscribed++; continue; }
    if (c.consent) consent++;
    if (isCustomer(c)) customers++;
    for (const g of c.galleries) if (g.sessionType) types.set(g.sessionType, (types.get(g.sessionType) || 0) + 1);
    for (const t of c.tags || []) tags.set(t, (tags.get(t) || 0) + 1);
    const l = langOf(c);
    langs.set(l, (langs.get(l) || 0) + 1);
  }
  const counts = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));
  return {
    enabled: hasFeature(env, photographer, "campaigns"),
    campaigns: (results || []).map((r) => campaignOut(r, stats.get(r.id))),
    templates: CAMPAIGN_TEMPLATES.map((t) => ({ key: t.key, name: t.name, cta: t.cta, printPromo: t.printPromo || 0, texts: t.texts })),
    options: { sessionTypes: counts(types), tags: counts(tags), langs: counts(langs) },
    contacts: { consent, unsubscribed, customers },
    promoPercents: PROMO_PERCENTS,
  };
}

function readCampaign(body, current) {
  const out = {};
  if (body.name !== undefined) out.name = String(body.name || "").trim().slice(0, 80);
  if (body.template !== undefined) out.template = String(body.template || "").slice(0, 30);
  if (body.texts !== undefined) out.texts = JSON.stringify(cleanTexts(body.texts));
  if (body.cta !== undefined) out.cta = CTAS.includes(body.cta) ? body.cta : "booking";
  if (body.ctaUrl !== undefined) {
    const url = String(body.ctaUrl || "").trim();
    if (url && !/^https:\/\/\S+$/.test(url)) return { error: "Lien invalide : il doit commencer par https://" };
    out.cta_url = url.slice(0, 500);
  }
  if (body.printPromo !== undefined) {
    const p = Number(body.printPromo || 0);
    if (p && !PROMO_PERCENTS.includes(p)) return { error: "Remise : 10, 15, 20, 25, 30, 40 ou 50 %" };
    out.print_promo = p;
  }
  if (body.promoDays !== undefined) {
    const d = Math.round(Number(body.promoDays));
    if (!(d >= 1 && d <= 30)) return { error: "Durée de la remise : 1 à 30 jours" };
    out.promo_days = d;
  }
  if (body.segment !== undefined) out.segment = JSON.stringify(cleanSegment(body.segment));
  const cta = out.cta ?? current?.cta;
  const url = out.cta_url ?? current?.cta_url;
  if (cta === "url" && !url) return { error: "Indiquez le lien du bouton" };
  return { fields: out };
}

async function ownCampaign(env, photographer, id) {
  return env.DB.prepare("SELECT * FROM broadcasts WHERE id = ? AND photographer_id = ?").bind(id, photographer.id).first();
}

function sampleVars(photographer, lang, campaign) {
  const l = languageOf(lang);
  return {
    prenom: l === "nl" ? "Sofie" : l === "en" ? "Emma" : "Sophie",
    studio: studioLabel(photographer),
    galerie: l === "nl" ? "Gezinsshoot in het park" : l === "en" ? "Family session in the park" : "Séance famille au parc",
    remise: percentLabel(campaign.print_promo || 20, l),
    fin: dateLabel(now() + (campaign.promo_days || 7) * DAY, l),
  };
}

export async function handleBroadcastsAdmin(request, env, ctx, photographer, parts) {
  const method = request.method;
  if (!parts.length && method === "GET") return json(await listForAdmin(env, photographer));
  const body = method === "POST" ? await request.json().catch(() => ({})) : {};

  if (parts[0] === "audience" && method === "POST") {
    const clients = await collect(env, photographer.id);
    const { recipients, excluded } = selectAudience(clients, body.segment);
    return json({ count: recipients.length, excluded, sample: recipients.slice(0, 8).map((r) => r.name || r.email) });
  }

  if (!parts.length && method === "POST") {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM broadcasts WHERE photographer_id = ?").bind(photographer.id).first();
    if ((count?.n || 0) >= 300) return fail(409, "300 campagnes au maximum : supprimez d'anciens brouillons");
    const template = CAMPAIGN_TEMPLATES.find((t) => t.key === body.template);
    const read = readCampaign({
      name: body.name || (template ? template.name.fr : "Nouvelle campagne"),
      template: template?.key || "",
      texts: body.texts || template?.texts || { fr: { subject: "", body: "", cta: "" } },
      cta: body.cta || template?.cta || "booking",
      printPromo: body.printPromo ?? template?.printPromo ?? 0,
      promoDays: body.promoDays ?? 7,
      segment: body.segment || { audience: "consent" },
    }, null);
    if (read.error) return fail(400, read.error);
    const id = newId("cmp");
    const f = read.fields;
    const ts = now();
    await env.DB.prepare(
      `INSERT INTO broadcasts (id, photographer_id, name, template, texts, cta, cta_url, cta_label, print_promo, promo_days, segment, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, 'draft', ?, ?)`
    ).bind(id, photographer.id, f.name, f.template, f.texts, f.cta, f.cta_url || "", f.print_promo || 0, f.promo_days || 7, f.segment, ts, ts).run();
    return json(campaignOut(await ownCampaign(env, photographer, id)), { status: 201 });
  }

  const campaign = await ownCampaign(env, photographer, decodeURIComponent(parts[0] || ""));
  if (!campaign) return fail(404, "Campagne introuvable");
  const action = parts[1] || "";

  if (!action && method === "DELETE") {
    if (campaign.status === "sending") return fail(409, "Cette campagne est en cours d'envoi");
    if (campaign.status === "sent") {
      // Une campagne envoyée reste dans le journal (ses chiffres aussi) : on
      // la retire seulement de la liste.
      await env.DB.prepare("UPDATE broadcasts SET status = 'archived', updated_at = ? WHERE id = ?").bind(now(), campaign.id).run();
    } else {
      await env.DB.prepare("DELETE FROM broadcasts WHERE id = ?").bind(campaign.id).run();
    }
    return json(await listForAdmin(env, photographer));
  }
  if (!action && method === "POST") {
    if (!["draft", "scheduled"].includes(campaign.status)) return fail(409, "Cette campagne est déjà partie");
    const read = readCampaign(body, campaign);
    if (read.error) return fail(400, read.error);
    const entries = Object.entries(read.fields);
    if (entries.length) {
      await env.DB.prepare(`UPDATE broadcasts SET ${entries.map(([k]) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
        .bind(...entries.map(([, v]) => v), now(), campaign.id).run();
    }
    return json(campaignOut(await ownCampaign(env, photographer, campaign.id)));
  }
  if (action === "preview" && method === "POST") {
    const lang = languageOf(body.lang);
    const t = textsFor(campaign, lang);
    const vars = sampleVars(photographer, lang, campaign);
    const mail = renderStudioEmail({
      lang, studioName: studioLabel(photographer), subject: fillPlaceholders(t.subject, vars), body: fillPlaceholders(t.body, vars),
      ctaLabel: campaign.cta === "none" ? "" : t.cta, ctaUrl: campaign.cta === "none" ? "" : "https://www.holypixx.com/", unsubscribe: "https://www.holypixx.com/",
    });
    return json({ subject: mail.subject, html: mail.html });
  }
  if (action === "test" && method === "POST") {
    const lang = languageOf(body.lang);
    const t = textsFor(campaign, lang);
    const vars = sampleVars(photographer, lang, campaign);
    const mail = renderStudioEmail({
      lang, studioName: studioLabel(photographer), subject: "[Test] " + fillPlaceholders(t.subject, vars), body: fillPlaceholders(t.body, vars),
      ctaLabel: campaign.cta === "none" ? "" : t.cta, ctaUrl: campaign.cta === "none" ? "" : await ctaUrlFor(env, photographer, campaign, null), unsubscribe: "",
    });
    const ok = await deliver(env, { from: await senderFor(env, photographer), to: photographer.email, ...mail });
    if (!ok && env.RESEND_API_KEY) return fail(502, "L'envoi test n'est pas parti : réessayez dans un instant");
    return json({ ok: true, to: photographer.email });
  }
  if (action === "send" && method === "POST") {
    if (!hasFeature(env, photographer, "campaigns")) return featureRefusal(env, photographer, "campaigns");
    if (!["draft", "scheduled"].includes(campaign.status)) return fail(409, "Cette campagne est déjà partie");
    const fr = textsFor(campaign, "fr");
    if (!fr.subject || !fr.body) return fail(400, "Écrivez l'objet et le message avant d'envoyer");
    const at = Math.floor(Number(body.at || 0));
    if (at && at > now() + 120) {
      if (at > now() + 180 * DAY) return fail(400, "Programmez l'envoi dans les 6 prochains mois");
      await env.DB.prepare("UPDATE broadcasts SET status = 'scheduled', scheduled_at = ?, updated_at = ? WHERE id = ?").bind(at, now(), campaign.id).run();
      return json(campaignOut(await ownCampaign(env, photographer, campaign.id)));
    }
    const started = await startCampaign(env, photographer, campaign);
    if (started.error) return fail(400, started.error);
    // Premier paquet tout de suite ; la suite part avec la passe planifiée.
    const work = sendQueued(env, { campaignId: campaign.id });
    if (ctx?.waitUntil) ctx.waitUntil(work); else await work;
    return json(campaignOut(await ownCampaign(env, photographer, campaign.id)));
  }
  if (action === "cancel" && method === "POST") {
    if (campaign.status !== "scheduled") return fail(409, "Cette campagne n'est pas programmée");
    await env.DB.prepare("UPDATE broadcasts SET status = 'draft', scheduled_at = NULL, updated_at = ? WHERE id = ?").bind(now(), campaign.id).run();
    return json(campaignOut(await ownCampaign(env, photographer, campaign.id)));
  }
  return fail(404, "Route inconnue");
}

/* ---------- Envoi ---------- */

async function ctaUrlFor(env, photographer, campaign, recipient) {
  if (campaign.cta === "url") return campaign.cta_url || "";
  if (campaign.cta === "gallery" && recipient) {
    const open = recipient.client.galleries
      .filter((g) => !g.expiresAt || g.expiresAt > now())
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (open) return galleryUrlFor(env, open.slug);
  }
  if (campaign.cta === "none") return "";
  return bookingPageUrl(env, photographer);
}

// Destinataires figés au départ (file dans email_sends), remise tirages posée.
export async function startCampaign(env, photographer, campaign) {
  const claim = await env.DB.prepare("UPDATE broadcasts SET status = 'sending', started_at = ?, updated_at = ? WHERE id = ? AND status IN ('draft', 'scheduled')")
    .bind(now(), now(), campaign.id).run();
  if (!claim.meta?.changes) return { error: "Cette campagne est déjà partie" };
  const clients = await collect(env, photographer.id);
  const { recipients } = selectAudience(clients, parse(campaign.segment, {}));
  const list = recipients.slice(0, MAX_RECIPIENTS);
  const ts = now();
  const promoEnds = ts + (campaign.promo_days || 7) * DAY;
  const statements = [];
  for (const r of list) {
    const token = b64url(randomBytes(18));
    statements.push(env.DB.prepare(
      "INSERT INTO email_sends (id, photographer_id, client_email, kind, ref_id, lang, subject, token, status, created_at) VALUES (?, ?, ?, 'campaign', ?, ?, '', ?, 'queued', ?)"
    ).bind(newId("snd"), photographer.id, r.email, campaign.id, r.lang, token, ts));
    // Remise sur les tirages : sur ses galeries ouvertes avec boutique, sans
    // jamais réduire une remise plus forte déjà en cours.
    if (campaign.print_promo) {
      for (const g of r.client.galleries) {
        if (!g.shopEnabled || (g.expiresAt && g.expiresAt < ts)) continue;
        statements.push(env.DB.prepare(
          `UPDATE galleries SET promo_percent = ?, promo_ends_at = ?, promo_sent_at = ?
            WHERE id = ? AND photographer_id = ? AND NOT (promo_percent >= ? AND promo_ends_at > ?)`
        ).bind(campaign.print_promo, promoEnds, ts, g.id, photographer.id, campaign.print_promo, ts));
      }
    }
  }
  for (let i = 0; i < statements.length; i += 80) await env.DB.batch(statements.slice(i, i + 80));
  await env.DB.prepare("UPDATE broadcasts SET recipients = ?, updated_at = ? WHERE id = ?").bind(list.length, now(), campaign.id).run();
  if (!list.length) await env.DB.prepare("UPDATE broadcasts SET status = 'sent', sent_at = ? WHERE id = ?").bind(now(), campaign.id).run();
  return { recipients: list.length };
}

// Envoie un paquet d'e-mails en file pour une campagne (ou toutes).
export async function sendQueued(env, { campaignId, limit = BATCH } = {}) {
  const campaigns = campaignId
    ? [await env.DB.prepare("SELECT * FROM broadcasts WHERE id = ? AND status = 'sending'").bind(campaignId).first()].filter(Boolean)
    : (await env.DB.prepare("SELECT * FROM broadcasts WHERE status = 'sending' ORDER BY started_at ASC LIMIT 20").all()).results || [];
  let total = 0;
  for (const campaign of campaigns) {
    const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(campaign.photographer_id).first();
    if (!photographer) continue;
    const { results: queue } = await env.DB.prepare("SELECT * FROM email_sends WHERE ref_id = ? AND kind = 'campaign' AND status = 'queued' LIMIT ?")
      .bind(campaign.id, limit).all();
    if (!queue?.length) {
      await env.DB.prepare("UPDATE broadcasts SET status = 'sent', sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ?").bind(now(), now(), campaign.id).run();
      continue;
    }
    const clients = new Map((await collect(env, photographer.id)).map((c) => [c.email, c]));
    const from = await senderFor(env, photographer);
    const studio = studioLabel(photographer);
    const promoEnds = (campaign.started_at || now()) + (campaign.promo_days || 7) * DAY;
    const mails = [];
    const rows = [];
    for (const send of queue) {
      const client = clients.get(send.client_email);
      // Désinscrit depuis le départ de la campagne : on n'envoie plus.
      if (!client || client.unsubscribedAt) {
        await env.DB.prepare("UPDATE email_sends SET status = 'skipped', sent_at = ? WHERE id = ?").bind(now(), send.id).run();
        continue;
      }
      const lang = languageOf(send.lang);
      const t = textsFor(campaign, lang);
      const last = [...client.galleries].sort((a, b) => b.createdAt - a.createdAt)[0];
      const vars = {
        prenom: firstNameOf(client.name) || (lang === "nl" ? "Hallo" : lang === "en" ? "Hello" : "Bonjour"),
        studio, galerie: last?.title || "", remise: percentLabel(campaign.print_promo || 0, lang), fin: dateLabel(promoEnds, lang),
      };
      let subject = fillPlaceholders(t.subject, vars).replace(/,\s*(Bonjour|Hello|Hallo)\b/, "");
      let text = fillPlaceholders(t.body, vars);
      if (!firstNameOf(client.name)) text = text.replace(/^(Bonjour|Hello|Hi|Hallo|Dag) (Bonjour|Hello|Hallo),/, "$1,");
      const target = await ctaUrlFor(env, photographer, campaign, { client });
      const unsubscribe = unsubscribeUrl(env, send.token);
      const mail = renderStudioEmail({
        lang, studioName: studio, subject, body: text, ctaLabel: target ? t.cta : "",
        ctaUrl: target ? await trackedUrl(env, send.token, target) : "", unsubscribe,
      });
      mails.push({ from, to: send.client_email, replyTo: photographer.email, ...mail, unsubscribe });
      rows.push({ id: send.id, subject });
    }
    const results = await deliverBatch(env, mails);
    const updates = rows.map((r, i) => env.DB.prepare("UPDATE email_sends SET status = ?, sent_at = ?, subject = ? WHERE id = ?")
      .bind(results[i] ? "sent" : "failed", now(), r.subject.slice(0, 200), r.id));
    if (updates.length) await env.DB.batch(updates);
    total += rows.length;
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM email_sends WHERE ref_id = ? AND kind = 'campaign' AND status = 'queued'").bind(campaign.id).first();
    if (!left?.n) await env.DB.prepare("UPDATE broadcasts SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?").bind(now(), now(), campaign.id).run();
  }
  return total;
}

// Passe planifiée : campagnes programmées arrivées à l'heure, puis envoi
// des files en cours (quelques paquets par passe).
export async function runBroadcasts(env, options = {}) {
  const at = options.now || now();
  const { results: due } = await env.DB.prepare("SELECT * FROM broadcasts WHERE status = 'scheduled' AND scheduled_at <= ? LIMIT 20").bind(at).all();
  for (const campaign of due || []) {
    const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(campaign.photographer_id).first();
    if (!photographer || !hasFeature(env, photographer, "campaigns")) {
      await env.DB.prepare("UPDATE broadcasts SET status = 'draft', updated_at = ? WHERE id = ?").bind(at, campaign.id).run();
      continue;
    }
    await startCampaign(env, photographer, campaign);
  }
  let sent = 0;
  for (let i = 0; i < (options.rounds || 6); i++) {
    const n = await sendQueued(env, {});
    sent += n;
    if (!n) break;
  }
  if (sent) console.log(`Campagnes : ${sent} e-mail(s) envoyé(s).`);
  return sent;
}

export { normEmail, queueSend };
