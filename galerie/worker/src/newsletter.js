// Newsletter Holypixx : les photographes qui veulent des nouvelles — par
// exemple, en néerlandais, l'arrivée des sections encore en français de
// l'espace photographe (bandeau « Wil je meer in het Nederlands? »).
//
// Consentement RGPD explicite (case cochée, date gardée), langue et origine
// de l'inscription. La réponse est la même que l'adresse soit nouvelle ou
// déjà inscrite : la liste ne confirme jamais qui y figure. Lecture, export
// CSV et retrait d'une adresse depuis l'espace propriétaire.

import { json, fail } from "./http.js";
import { LANGUAGES, pick } from "./i18n.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const NEWSLETTER_SOURCES = ["admin", "home-nl", "home-en", "home-fr"];
const MAX_ROWS = 50000;

function now() {
  return Math.floor(Date.now() / 1000);
}

// { entry } prêt à enregistrer, { bot } ou { error }. `website` est un champ
// invisible : rempli, c'est un robot (réponse « ok », rien d'enregistré).
export function readNewsletterSignup(body) {
  const b = body && typeof body === "object" ? body : {};
  const lang = LANGUAGES.includes(b.lang) ? b.lang : "fr";
  if (String(b.website || "").trim()) return { bot: true };
  const email = String(b.email || "").trim().toLowerCase().slice(0, 200);
  if (!EMAIL_RE.test(email)) {
    return { error: pick(lang, "Adresse e-mail invalide", "Please enter a valid email address.", "Vul een geldig e-mailadres in.") };
  }
  if (b.consent !== true) {
    return { error: pick(lang, "Cochez la case pour recevoir la newsletter.", "Tick the box to receive the newsletter.", "Vink het vakje aan om de nieuwsbrief te ontvangen.") };
  }
  const source = NEWSLETTER_SOURCES.includes(b.source) ? b.source : "";
  return { entry: { email, lang, source } };
}

// POST /api/public/newsletter
export async function joinNewsletter(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return fail(400, "Requête invalide");
  const read = readNewsletterSignup(body);
  if (read.bot) return json({ ok: true });
  if (read.error) return fail(400, read.error);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM newsletter_subscribers").first();
  if ((count?.n || 0) >= MAX_ROWS) return json({ ok: true });
  const { email, lang, source } = read.entry;
  const at = now();
  // Réinscription : nouvelle langue et nouveau consentement, date d'origine gardée.
  await env.DB.prepare(
    `INSERT INTO newsletter_subscribers (email, lang, source, consent_at, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET lang = excluded.lang, source = excluded.source, consent_at = excluded.consent_at`
  )
    .bind(email, lang, source, at, at)
    .run();
  return json({ ok: true });
}

// Espace propriétaire : effectif, répartition par langue, toutes les
// adresses (pour l'export CSV).
export async function newsletterForOwner(env) {
  const { results: byLang } = await env.DB.prepare(
    "SELECT lang, COUNT(*) AS n FROM newsletter_subscribers GROUP BY lang ORDER BY n DESC"
  ).all();
  const { results: rows } = await env.DB.prepare(
    "SELECT email, lang, source, consent_at, created_at FROM newsletter_subscribers ORDER BY created_at DESC LIMIT ?"
  ).bind(MAX_ROWS).all();
  return {
    total: rows.length,
    byLang: byLang.map((r) => ({ lang: r.lang, count: r.n })),
    subscribers: rows.map((r) => ({ email: r.email, lang: r.lang, source: r.source, consentAt: r.consent_at, createdAt: r.created_at })),
  };
}

// Retrait d'une adresse (désinscription, demande RGPD).
export async function removeFromNewsletter(env, email) {
  const result = await env.DB.prepare("DELETE FROM newsletter_subscribers WHERE email = ?")
    .bind(String(email || "").trim().toLowerCase())
    .run();
  return { removed: result.meta?.changes || 0 };
}
