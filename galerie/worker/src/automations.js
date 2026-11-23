// Relances automatiques du studio vers ses clients : toutes au même endroit
// (onglet Relances), chacune avec son interrupteur, son délai, et — pour
// celles que Holypixx rédige au nom du studio — un texte modifiable en
// français, anglais et néerlandais, un aperçu et un envoi test.
//
// « builtin » : relances qui existaient déjà (galerie qui expire, panier,
// suppléments impayés…) : interrupteur seulement, leur e-mail est fixe.
// « custom » : relances au nom du studio, rédigées par mailingTexts.js et
// réécrivables : sélection pas commencée, remise « early bird » à la
// première ouverture, un an déjà, demande d'avis, client à revoir, dates à
// retenir envoyées directement au client.
//
//   /api/admin/mailing/automations               liste, réglages, chiffres (30 j)
//   /api/admin/mailing/automations/:clé  (POST)  interrupteur, délai, valeur, textes
//   /api/admin/mailing/automations/:clé/preview  (POST) aperçu { lang, texts }
//   /api/admin/mailing/automations/:clé/test     (POST) envoi test au photographe

import { json, fail } from "./http.js";
import { languageOf, LANGUAGES } from "./i18n.js";
import { hasFeature } from "./subscription.js";
import { galleryUrlFor } from "./reminders.js";
import { PROMO_PERCENTS } from "./campaigns.js";
import { bookingPageUrl } from "./clients.js";
import { AUTOMATION_TEXTS, automationTexts, occasionText } from "./mailingTexts.js";
import {
  now, normEmail, settingsOf, saveSetting, sendStudioMail, renderStudioEmail, deliver, senderFor, studioLabel,
  fillPlaceholders, firstNameOf, statsOf, percentLabel, dateLabel, alreadySent, unsubscribeUrl,
} from "./mailing.js";

const DAY = 86400;

// Ordre d'affichage : par moment de la relation client.
export const AUTOMATIONS = [
  { key: "booking_reminder", group: "session", kind: "builtin", defaultOn: true,
    title: "Rappel de séance", desc: "La veille ou l'avant-veille de la séance réservée : l'heure, l'adresse et la liste de préparation." },
  { key: "selection_nudge", group: "gallery", kind: "custom", defaultOn: true, delay: { def: 4, min: 2, max: 14, unit: "jours après l'envoi de la galerie" },
    title: "Sélection pas commencée", desc: "Le client n'a encore choisi aucune photo : un mot doux pour l'inviter à ouvrir sa galerie." },
  { key: "expiry", group: "gallery", kind: "builtin", defaultOn: true,
    title: "Galerie qui expire", desc: "7 puis 2 jours avant l'expiration, tant que la sélection n'est pas validée." },
  { key: "early_bird", group: "sales", kind: "custom", defaultOn: false, feature: "campaigns", delay: { def: 3, min: 1, max: 7, unit: "jours d'offre" },
    value: { kind: "percent", def: "20", label: "Remise sur les tirages" },
    title: "Offre de bienvenue sur les tirages", desc: "À la première ouverture de la galerie : une remise sur les tirages pendant quelques jours, affichée dans la galerie et annoncée par e-mail." },
  { key: "cart", group: "sales", kind: "builtin", defaultOn: true, feature: "campaigns",
    title: "Panier oublié", desc: "24 h après un panier de tirages laissé sans commande (une fois par panier)." },
  { key: "favorites", group: "sales", kind: "builtin", defaultOn: true, feature: "campaigns",
    title: "Coups de cœur à imprimer", desc: "3 jours après la sélection validée, si rien n'a été commandé." },
  { key: "unpaid", group: "payment", kind: "builtin", defaultOn: true, column: "unpaid_reminders_enabled",
    title: "Suppléments impayés", desc: "3 puis 7 jours après la sélection validée, avec tous les moyens de régler." },
  { key: "invoice_reminder", group: "payment", kind: "builtin", defaultOn: true,
    title: "Factures en retard", desc: "Avant et après chaque échéance de vos factures (réglable aussi facture par facture)." },
  { key: "deposit_reminder", group: "payment", kind: "builtin", defaultOn: true,
    title: "Acompte du contrat", desc: "3 puis 8 jours après la signature, si l'acompte n'est pas réglé." },
  { key: "review", group: "loyalty", kind: "custom", defaultOn: false, delay: { def: 7, min: 2, max: 30, unit: "jours après la livraison HD" },
    value: { kind: "url", def: "", label: "Lien vers votre page d'avis (Google, Facebook…)" },
    title: "Demande d'avis", desc: "Quelques jours après la livraison en haute définition : un lien direct vers votre page d'avis." },
  { key: "anniversary", group: "loyalty", kind: "custom", defaultOn: true, marketing: true, delay: { def: 365, min: 300, max: 420, unit: "jours après la séance" },
    title: "Un an déjà", desc: "Un an après la séance : un souvenir, et une invitation à réserver la suivante." },
  { key: "dates", group: "loyalty", kind: "custom", defaultOn: false, marketing: true,
    title: "Dates à retenir, envoyées au client", desc: "Anniversaires, étapes de bébé, Noël… Au lieu de vous prévenir, Holypixx écrit directement au client, au délai réglé sur chaque date." },
  { key: "dormant", group: "loyalty", kind: "custom", defaultOn: false, marketing: true, delay: { def: 330, min: 180, max: 540, unit: "jours sans séance" },
    title: "Client à revoir", desc: "Un client sans séance depuis longtemps, sans rien de prévu : une invitation à se revoir (une fois par an au plus)." },
];
export const AUTOMATION_KEYS = AUTOMATIONS.map((a) => a.key);
const BY_KEY = Object.fromEntries(AUTOMATIONS.map((a) => [a.key, a]));

// SQL : la relance `key` est active pour le photographe `col`.
export function enabledSql(key, col = "p.id") {
  const a = BY_KEY[key];
  if (a?.column) return `p.${a.column} = 1`;
  return `COALESCE((SELECT s.enabled FROM automation_settings s WHERE s.photographer_id = ${col} AND s.key = '${key}'), ${a?.defaultOn ? 1 : 0}) = 1`;
}

function delaySql(key, col = "p.id") {
  return `COALESCE((SELECT s.delay_days FROM automation_settings s WHERE s.photographer_id = ${col} AND s.key = '${key}'), ${BY_KEY[key].delay.def})`;
}

function stateOf(a, settings, photographer) {
  const s = settings.get(a.key);
  const enabled = a.column ? photographer[a.column] !== 0 : s ? s.enabled : a.defaultOn;
  return {
    enabled,
    delayDays: a.delay ? (s?.delayDays ?? a.delay.def) : null,
    value: a.value ? (s?.value || a.value.def) : "",
    texts: s?.texts || {},
  };
}

/* ---------- Photographe ---------- */

export async function automationsForAdmin(env, photographer) {
  const settings = await settingsOf(env, photographer.id);
  const stats = await statsOf(env, photographer.id, { since: now() - 30 * DAY, kindPrefix: "auto:" });
  return {
    remindersEnabled: photographer.reminders_enabled !== 0,
    automations: AUTOMATIONS.map((a) => {
      const st = stateOf(a, settings, photographer);
      return {
        key: a.key, group: a.group, kind: a.kind, title: a.title, desc: a.desc, marketing: Boolean(a.marketing),
        available: !a.feature || hasFeature(env, photographer, a.feature),
        delay: a.delay || null, value: a.value || null,
        enabled: st.enabled, delayDays: st.delayDays, valueSet: st.value,
        texts: a.kind === "custom" ? Object.fromEntries(LANGUAGES.map((l) => [l, automationTexts(a.key, l, st.texts)])) : null,
        stats: stats.get(a.key) || null,
      };
    }),
  };
}

function cleanTexts(input) {
  const out = {};
  for (const l of LANGUAGES) {
    const t = input && input[l];
    if (!t) continue;
    const subject = String(t.subject || "").trim().slice(0, 160);
    const body = String(t.body || "").replace(/\r\n/g, "\n").trim().slice(0, 4000);
    const cta = String(t.cta || "").trim().slice(0, 60);
    if (subject || body || cta) out[l] = { subject, body, cta };
  }
  return out;
}

// Exemple pour l'aperçu et l'envoi test.
function sampleVars(photographer, lang) {
  const l = languageOf(lang);
  return {
    prenom: l === "nl" ? "Sofie" : l === "en" ? "Emma" : "Sophie",
    studio: studioLabel(photographer),
    galerie: l === "nl" ? "Gezinsshoot in het park" : l === "en" ? "Family session in the park" : "Séance famille au parc",
    remise: percentLabel(20, l),
    fin: dateLabel(now() + 3 * DAY, l),
    occasion: occasionText(l, { kind: "baby", label: l === "nl" ? "Lotte" : "Léa", months: 6 }),
  };
}

export async function handleAutomationsAdmin(request, env, photographer, parts) {
  // parts : ce qui suit /api/admin/mailing/automations
  if (!parts.length && request.method === "GET") return json(await automationsForAdmin(env, photographer));
  const key = parts[0];
  const a = BY_KEY[key];
  if (!a) return fail(404, "Relance inconnue");
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};

  if (parts.length === 1 && request.method === "POST") {
    if (a.column && body.enabled !== undefined) {
      await env.DB.prepare(`UPDATE photographers SET ${a.column} = ? WHERE id = ?`).bind(body.enabled ? 1 : 0, photographer.id).run();
      photographer[a.column] = body.enabled ? 1 : 0;
    }
    const patch = {};
    if (body.enabled !== undefined && !a.column) patch.enabled = Boolean(body.enabled);
    if (body.delayDays !== undefined && a.delay) {
      const d = Math.round(Number(body.delayDays));
      if (!(d >= a.delay.min && d <= a.delay.max)) return fail(400, `Délai entre ${a.delay.min} et ${a.delay.max} jours`);
      patch.delayDays = d;
    }
    if (body.value !== undefined && a.value) {
      const v = String(body.value || "").trim();
      if (a.value.kind === "percent" && !PROMO_PERCENTS.includes(Number(v))) return fail(400, "Remise : 10, 15, 20, 25, 30, 40 ou 50 %");
      if (a.value.kind === "url" && v && !/^https:\/\/[^\s]+$/.test(v)) return fail(400, "Lien invalide : il doit commencer par https://");
      patch.value = v.slice(0, 500);
    }
    if (body.texts !== undefined && a.kind === "custom") patch.texts = cleanTexts(body.texts);
    if (a.key === "review" && patch.enabled) {
      const current = stateOf(a, await settingsOf(env, photographer.id), photographer);
      if (!(patch.value ?? current.value)) return fail(400, "Indiquez d'abord le lien de votre page d'avis");
    }
    if (Object.keys(patch).length) await saveSetting(env, photographer.id, key, patch, a.defaultOn);
    return json(await automationsForAdmin(env, photographer));
  }

  if (parts[1] === "preview" && request.method === "POST" && a.kind === "custom") {
    const lang = languageOf(body.lang);
    const texts = body.texts ? cleanTexts(body.texts) : (await settingsOf(env, photographer.id)).get(key)?.texts;
    const t = automationTexts(key, lang, texts);
    const vars = sampleVars(photographer, lang);
    const mail = renderStudioEmail({
      lang, studioName: studioLabel(photographer), subject: fillPlaceholders(t.subject, vars), body: fillPlaceholders(t.body, vars),
      ctaLabel: t.cta, ctaUrl: t.cta ? "https://www.holypixx.com/" : "", unsubscribe: "https://www.holypixx.com/",
    });
    return json({ subject: mail.subject, html: mail.html });
  }

  if (parts[1] === "test" && request.method === "POST" && a.kind === "custom") {
    const lang = languageOf(body.lang);
    const texts = body.texts ? cleanTexts(body.texts) : (await settingsOf(env, photographer.id)).get(key)?.texts;
    const t = automationTexts(key, lang, texts);
    const vars = sampleVars(photographer, lang);
    const mail = renderStudioEmail({
      lang, studioName: studioLabel(photographer), subject: "[Test] " + fillPlaceholders(t.subject, vars), body: fillPlaceholders(t.body, vars),
      ctaLabel: t.cta, ctaUrl: t.cta ? (env.PUBLIC_SITE_ORIGIN || "https://www.holypixx.com") : "", unsubscribe: "",
    });
    const ok = await deliver(env, { from: await senderFor(env, photographer), to: photographer.email, ...mail });
    if (!ok && env.RESEND_API_KEY) return fail(502, "L'envoi test n'est pas parti : réessayez dans un instant");
    return json({ ok: true, to: photographer.email });
  }
  return fail(404, "Route inconnue");
}

/* ---------- Envoi d'une relance « custom » ---------- */

async function sendAutomation(env, photographer, key, { to, clientName, galleryTitle, lang, ctaUrl, refId, vars = {}, marketing }) {
  const settings = await settingsOf(env, photographer.id);
  const l = languageOf(lang);
  const t = automationTexts(key, l, settings.get(key)?.texts);
  const all = { prenom: firstNameOf(clientName) || (l === "nl" ? "Hallo" : l === "en" ? "Hello" : "Bonjour"), studio: studioLabel(photographer), galerie: galleryTitle || "", ...vars };
  // « Bonjour Bonjour » n'arrive jamais : sans prénom, la salutation suffit.
  const subject = fillPlaceholders(t.subject, all).replace(/,\s*(Bonjour|Hello|Hallo)\b/, "");
  let body = fillPlaceholders(t.body, all);
  if (!firstNameOf(clientName)) body = body.replace(/^(Bonjour|Hello|Hi|Hallo|Dag) (Bonjour|Hello|Hallo),/, "$1,");
  return sendStudioMail(env, photographer, {
    to, kind: `auto:${key}`, refId, lang: l, subject, body, ctaLabel: ctaUrl ? t.cta : "", ctaUrl,
    marketing: marketing ?? Boolean(BY_KEY[key].marketing),
  });
}

async function photographerById(env, id, cache) {
  if (cache.has(id)) return cache.get(id);
  const p = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(id).first();
  cache.set(id, p);
  return p;
}

// Marque une relance unique par galerie (clé primaire : une seule passe gagne).
async function claim(env, galleryId, kind, at) {
  const r = await env.DB.prepare("INSERT OR IGNORE INTO reminders_sent (gallery_id, kind, sent_at) VALUES (?, ?, ?)").bind(galleryId, kind, at).run();
  return Boolean(r.meta?.changes);
}

/* ---------- Passe quotidienne ---------- */

export async function runAutomations(env, options = {}) {
  const at = options.now || now();
  const cache = new Map();
  const sent = [];

  // 1. Sélection pas commencée.
  const { results: nudges } = await env.DB.prepare(
    `SELECT g.* FROM galleries g JOIN photographers p ON p.id = g.photographer_id
      WHERE g.client_email != '' AND g.demo = 0 AND g.kind = 'client' AND g.selection_done_at IS NULL
        AND (g.expires_at IS NULL OR g.expires_at > ?) AND p.reminders_enabled = 1 AND ${enabledSql("selection_nudge")}
        AND COALESCE(g.invite_sent_at, g.created_at) <= ? - ${delaySql("selection_nudge")} * ${DAY}
        AND COALESCE(g.invite_sent_at, g.created_at) > ? - 30 * ${DAY}
        AND EXISTS (SELECT 1 FROM photos ph WHERE ph.gallery_id = g.id)
        AND NOT EXISTS (SELECT 1 FROM photos ph WHERE ph.gallery_id = g.id AND ph.selected = 1)
        AND NOT EXISTS (SELECT 1 FROM reminders_sent r WHERE r.gallery_id = g.id AND r.kind = 'selection_nudge')
      LIMIT 200`
  ).bind(at, at, at).all();
  for (const g of nudges || []) {
    if (!(await claim(env, g.id, "selection_nudge", at))) continue;
    const p = await photographerById(env, g.photographer_id, cache);
    const r = await sendAutomation(env, p, "selection_nudge", {
      to: g.client_email, clientName: g.client_name, galleryTitle: g.title, lang: g.language, ctaUrl: galleryUrlFor(env, g.slug), refId: g.id, marketing: false,
    });
    sent.push({ key: "selection_nudge", galleryId: g.id, ...r });
  }

  // 2. Demande d'avis après la livraison HD.
  const { results: reviews } = await env.DB.prepare(
    `SELECT g.*, (SELECT s.value FROM automation_settings s WHERE s.photographer_id = p.id AND s.key = 'review') AS review_url
       FROM galleries g JOIN photographers p ON p.id = g.photographer_id
      WHERE g.client_email != '' AND g.demo = 0 AND g.kind = 'client' AND g.delivery_opened_at IS NOT NULL
        AND g.delivery_opened_at <= ? - ${delaySql("review")} * ${DAY} AND g.delivery_opened_at > ? - 60 * ${DAY}
        AND ${enabledSql("review")}
        AND NOT EXISTS (SELECT 1 FROM reminders_sent r WHERE r.gallery_id = g.id AND r.kind = 'review')
      LIMIT 200`
  ).bind(at, at).all();
  for (const g of reviews || []) {
    if (!/^https:\/\//.test(g.review_url || "")) continue;
    if (!(await claim(env, g.id, "review", at))) continue;
    const p = await photographerById(env, g.photographer_id, cache);
    const r = await sendAutomation(env, p, "review", {
      to: g.client_email, clientName: g.client_name, galleryTitle: g.title, lang: g.language, ctaUrl: g.review_url, refId: g.id, marketing: false,
    });
    sent.push({ key: "review", galleryId: g.id, ...r });
  }

  // 3. Un an déjà : une galerie dont c'est l'anniversaire (fenêtre d'une
  //    semaine), sans séance plus récente ni à venir.
  const { results: anniversaries } = await env.DB.prepare(
    `SELECT g.* FROM galleries g JOIN photographers p ON p.id = g.photographer_id
      WHERE g.client_email != '' AND g.demo = 0 AND g.kind = 'client' AND ${enabledSql("anniversary")}
        AND g.created_at <= ? - ${delaySql("anniversary")} * ${DAY} AND g.created_at > ? - (${delaySql("anniversary")} + 7) * ${DAY}
        AND NOT EXISTS (SELECT 1 FROM galleries g2 WHERE g2.photographer_id = g.photographer_id AND g2.client_email = g.client_email AND g2.created_at > g.created_at + 30 * ${DAY})
        AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.photographer_id = g.photographer_id AND lower(b.client_email) = g.client_email AND b.status = 'confirmed' AND b.starts_at > ? - 90 * ${DAY})
        AND NOT EXISTS (SELECT 1 FROM reminders_sent r WHERE r.gallery_id = g.id AND r.kind = 'anniversary')
      LIMIT 200`
  ).bind(at, at, at).all();
  for (const g of anniversaries || []) {
    if (!(await claim(env, g.id, "anniversary", at))) continue;
    const p = await photographerById(env, g.photographer_id, cache);
    const r = await sendAutomation(env, p, "anniversary", {
      to: g.client_email, clientName: g.client_name, galleryTitle: g.title, lang: g.language, ctaUrl: await bookingPageUrl(env, p), refId: g.id,
    });
    sent.push({ key: "anniversary", galleryId: g.id, ...r });
  }

  // 4. Client à revoir : dernière galerie dans la fenêtre du délai, rien
  //    de prévu, pas déjà relancé dans l'année.
  const { results: dormants } = await env.DB.prepare(
    `SELECT g.photographer_id, g.client_email, MAX(g.created_at) AS last_at,
            (SELECT g3.client_name FROM galleries g3 WHERE g3.photographer_id = g.photographer_id AND g3.client_email = g.client_email ORDER BY g3.created_at DESC LIMIT 1) AS client_name,
            (SELECT g3.language FROM galleries g3 WHERE g3.photographer_id = g.photographer_id AND g3.client_email = g.client_email ORDER BY g3.created_at DESC LIMIT 1) AS language,
            ${delaySql("dormant", "g.photographer_id")} AS delay
       FROM galleries g JOIN photographers p ON p.id = g.photographer_id
      WHERE g.client_email != '' AND g.demo = 0 AND g.kind = 'client' AND ${enabledSql("dormant", "g.photographer_id")}
      GROUP BY g.photographer_id, g.client_email
     HAVING last_at <= ? - delay * ${DAY} AND last_at > ? - (delay + 14) * ${DAY}
      LIMIT 200`
  ).bind(at, at).all();
  for (const d of dormants || []) {
    const upcoming = await env.DB.prepare("SELECT 1 FROM bookings WHERE photographer_id = ? AND lower(client_email) = ? AND status = 'confirmed' AND starts_at > ? LIMIT 1")
      .bind(d.photographer_id, d.client_email, d.last_at).first();
    if (upcoming) continue;
    const recent = await env.DB.prepare("SELECT 1 FROM email_sends WHERE photographer_id = ? AND client_email = ? AND kind = 'auto:dormant' AND created_at > ? LIMIT 1")
      .bind(d.photographer_id, d.client_email, at - 300 * DAY).first();
    if (recent) continue;
    const p = await photographerById(env, d.photographer_id, cache);
    const r = await sendAutomation(env, p, "dormant", {
      to: d.client_email, clientName: d.client_name, lang: d.language, ctaUrl: await bookingPageUrl(env, p), refId: "",
    });
    sent.push({ key: "dormant", email: d.client_email, ...r });
  }

  console.log(`Relances du studio : ${sent.length} e-mail(s) traité(s).`);
  return { sent };
}

/* ---------- Dates à retenir, envoyées au client (appelé par clients.js) ---------- */

export async function datesDirectEnabled(env, photographerId) {
  const s = (await settingsOf(env, photographerId)).get("dates");
  return s ? s.enabled : BY_KEY.dates.defaultOn;
}

export async function sendDateToClient(env, photographer, { to, clientName, next, date, lang }) {
  const l = languageOf(lang);
  const occasion = occasionText(l, { kind: date.kind, label: date.label, years: next.years, months: next.months });
  return sendAutomation(env, photographer, "dates", {
    to, clientName, lang: l, ctaUrl: await bookingPageUrl(env, photographer), refId: `${date.id}:${next.key}`, vars: { occasion },
  });
}

/* ---------- Offre de bienvenue, à la première ouverture (viewer.js) ---------- */

// Appelé à la première connexion du client : lance la remise si le studio
// l'a activée et que la boutique est ouverte. Renvoie la galerie à jour.
export async function startEarlyBird(env, gallery, shopState) {
  try {
    if (gallery.demo || gallery.kind === "school" || !gallery.shop_enabled) return gallery;
    if (Number(gallery.promo_percent || 0) > 0 && Number(gallery.promo_ends_at || 0) > now()) return gallery;
    const settings = await settingsOf(env, gallery.photographer_id);
    const s = settings.get("early_bird");
    if (!(s ? s.enabled : BY_KEY.early_bird.defaultOn)) return gallery;
    const state = await shopState(env, gallery);
    if (!state || !hasFeature(env, state.photographer, "campaigns")) return gallery;
    if (!(await claim(env, gallery.id, "early_bird", now()))) return gallery;
    const percent = PROMO_PERCENTS.includes(Number(s?.value)) ? Number(s.value) : Number(BY_KEY.early_bird.value.def);
    const days = s?.delayDays || BY_KEY.early_bird.delay.def;
    const endsAt = now() + days * DAY;
    await env.DB.prepare("UPDATE galleries SET promo_percent = ?, promo_ends_at = ?, promo_sent_at = ? WHERE id = ?").bind(percent, endsAt, now(), gallery.id).run();
    if (gallery.client_email) {
      const p = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(gallery.photographer_id).first();
      const lang = languageOf(gallery.language);
      await sendAutomation(env, p, "early_bird", {
        to: gallery.client_email, clientName: gallery.client_name, galleryTitle: gallery.title, lang, ctaUrl: galleryUrlFor(env, gallery.slug), refId: gallery.id,
        vars: { remise: percentLabel(percent, lang), fin: dateLabel(endsAt, lang) }, marketing: false,
      });
    }
    return { ...gallery, promo_percent: percent, promo_ends_at: endsAt };
  } catch (err) {
    console.error("Offre de bienvenue : impossible de la lancer :", err?.message || err);
    return gallery;
  }
}

export { AUTOMATION_TEXTS, unsubscribeUrl, normEmail, alreadySent };
