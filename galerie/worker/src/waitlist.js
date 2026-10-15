// Liste d'attente « Holypixx in English » (page d'accueil anglaise, /en/) :
// l'espace photographe n'existe encore qu'en français ; les photographes
// anglophones laissent leur e-mail pour être prévenus du lancement. Sert
// aussi à mesurer la demande réelle par pays avant de traduire l'espace
// photographe.
//
// La réponse est toujours la même, que l'adresse soit nouvelle ou déjà
// inscrite : la liste ne confirme jamais qui y figure.

import { json, fail } from "./http.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const WAITLIST_SPECIALTIES = ["wedding", "family", "newborn", "portrait", "events", "school", "other"];
const MAX_ROWS = 20000;

function now() {
  return Math.floor(Date.now() / 1000);
}

// { entry } prêt à enregistrer, ou { error }. `website` est un champ
// invisible : rempli, c'est un robot (réponse « ok », rien d'enregistré).
export function readWaitlistEntry(body) {
  const b = body && typeof body === "object" ? body : {};
  if (String(b.website || "").trim()) return { bot: true };
  const email = String(b.email || "").trim().toLowerCase().slice(0, 200);
  if (!EMAIL_RE.test(email)) return { error: "Please enter a valid email address." };
  const country = String(b.country || "").trim().toUpperCase();
  const specialty = String(b.specialty || "").trim().toLowerCase();
  return {
    entry: {
      email,
      country: /^[A-Z]{2}$/.test(country) ? country : "",
      specialty: WAITLIST_SPECIALTIES.includes(specialty) ? specialty : "",
      lang: b.lang === "fr" ? "fr" : "en",
    },
  };
}

// POST /api/public/waitlist
export async function joinWaitlist(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return fail(400, "Invalid request");
  const read = readWaitlistEntry(body);
  if (read.bot) return json({ ok: true });
  if (read.error) return fail(400, read.error);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM waitlist").first();
  if ((count?.n || 0) >= MAX_ROWS) return json({ ok: true });
  const { email, country, specialty, lang } = read.entry;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO waitlist (email, country, specialty, lang, created_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(email, country, specialty, lang, now())
    .run();
  return json({ ok: true });
}

// Espace propriétaire : effectif, répartition par pays et par spécialité,
// dernières inscriptions.
export async function waitlistForOwner(env) {
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM waitlist").first();
  const { results: byCountry } = await env.DB.prepare(
    "SELECT country, COUNT(*) AS n FROM waitlist GROUP BY country ORDER BY n DESC, country ASC LIMIT 30"
  ).all();
  const { results: bySpecialty } = await env.DB.prepare(
    "SELECT specialty, COUNT(*) AS n FROM waitlist GROUP BY specialty ORDER BY n DESC"
  ).all();
  const { results: latest } = await env.DB.prepare(
    "SELECT email, country, specialty, created_at FROM waitlist ORDER BY created_at DESC LIMIT 200"
  ).all();
  return {
    total: total?.n || 0,
    byCountry: byCountry.map((r) => ({ country: r.country, count: r.n })),
    bySpecialty: bySpecialty.map((r) => ({ specialty: r.specialty, count: r.n })),
    latest: latest.map((r) => ({ email: r.email, country: r.country, specialty: r.specialty, createdAt: r.created_at })),
  };
}

// Suppression d'une adresse (demande RGPD, désinscription).
export async function removeFromWaitlist(env, email) {
  const result = await env.DB.prepare("DELETE FROM waitlist WHERE email = ?").bind(String(email || "").trim().toLowerCase()).run();
  return { removed: result.meta?.changes || 0 };
}
