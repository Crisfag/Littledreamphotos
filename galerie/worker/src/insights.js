// Statistiques des séances du photographe (onglet « Statistiques ») : quels
// types de séance reviennent le plus, lesquels remplissent le panier,
// combien de photos sont choisies, quels forfaits (10, 15, 20 photos…)
// reviennent, et où partent les photos supplémentaires.
//
// Une séance, ici, c'est une galerie client (ni démo, ni groupe scolaire)
// créée pendant la période. Son type (grossesse, naissance…) est celui
// choisi par le photographe ; à défaut, il est deviné d'après le titre de
// la galerie (« Séance grossesse Julie » → grossesse) et signalé comme tel,
// pour que le photographe le corrige d'un clic.
//
// L'argent vient des paiements réglés (`payments.status = 'paid'`) : les
// suppléments photos (`kind = 'supplement'`) et les tirages (`kind =
// 'print'`), comme le tableau des ventes et les factures.

import { json, fail } from "./http.js";

export const SESSION_TYPES = [
  { key: "grossesse", label: "Grossesse", en: "Maternity" },
  { key: "naissance", label: "Naissance", en: "Newborn" },
  { key: "bebe", label: "Bébé", en: "Baby" },
  { key: "smash", label: "Smash cake · anniversaire", en: "Cake smash · birthday" },
  { key: "enfant", label: "Enfant", en: "Child" },
  { key: "famille", label: "Famille", en: "Family" },
  { key: "couple", label: "Couple", en: "Couple" },
  { key: "mariage", label: "Mariage", en: "Wedding" },
  { key: "bapteme", label: "Baptême · communion", en: "Christening · communion" },
  { key: "portrait", label: "Portrait · pro", en: "Portrait · business" },
  { key: "mini", label: "Mini-séance", en: "Mini session" },
  { key: "evenement", label: "Événement", en: "Event" },
  { key: "autre", label: "Autre", en: "Other" },
];
const TYPE_KEYS = new Set(SESSION_TYPES.map((t) => t.key));

export function cleanSessionType(value) {
  const key = String(value || "").trim().toLowerCase();
  return TYPE_KEYS.has(key) ? key : "";
}

// Mots qui trahissent le type d'une séance dans le titre de la galerie, du
// plus précis au plus général (« mini-séance de Noël en famille » est une
// mini-séance, « naissance de Léo » une naissance même si Léo est un bébé).
const GUESSES = [
  ["mini", /mini[\s-]?s[ée]ance|\bnoël\b|\bnoel\b|\bpâques\b|\bpaques\b|saint[\s-]valentin/],
  ["grossesse", /grossesse|maternit|enceinte|future?s? maman|baby ?bump/],
  ["naissance", /naissance|nouveau[\s-]n[ée]|newborn|nouveau-n/],
  ["smash", /smash|cake|anniversaire|birthday|\b1 an\b/],
  ["bapteme", /bapt[êe]me|communion|confirmation/],
  ["mariage", /mariage|wedding|mari[ée]s?\b|\bnoces\b/],
  ["couple", /couple|fian[çc]ailles|engagement|love ?session/],
  ["bebe", /b[ée]b[ée]|baby|bambin|\b\d{1,2} mois\b/],
  ["enfant", /enfant|kids?\b|fratrie/],
  ["famille", /famille|family|familial/],
  ["portrait", /portrait|corporate|linkedin|entreprise|headshot|\bcv\b/],
  ["evenement", /[ée]v[ée]nement|event|soir[ée]e|f[êe]te/],
];

export function guessSessionType(title) {
  const text = String(title || "").toLowerCase();
  for (const [key, re] of GUESSES) if (re.test(text)) return key;
  return "";
}

export function sessionTypeLabel(key, en = false) {
  const type = SESSION_TYPES.find((t) => t.key === key);
  return type ? (en ? type.en : type.label) : en ? "Not classified" : "Non classée";
}

// Début de la période (secondes) : 3, 6 ou 12 derniers mois, l'année en
// cours, ou tout depuis le début.
export const PERIODS = ["3m", "6m", "12m", "year", "all"];
export function periodStart(period, at = Math.floor(Date.now() / 1000)) {
  const date = new Date(at * 1000);
  if (period === "all") return 0;
  if (period === "year") return Math.floor(Date.UTC(date.getUTCFullYear(), 0, 1) / 1000);
  const months = period === "3m" ? 3 : period === "6m" ? 6 : 12;
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, date.getUTCDate()) / 1000);
}

const avg = (sum, n) => (n ? sum / n : 0);
const round1 = (x) => Math.round(x * 10) / 10;

// Calcul pur (testable sans base) à partir des séances de la période.
// session : { slug, title, type, guessed, included, extraPriceCents, photos,
//             selected, paidExtras, supplementCents, printCents, validated }
export function computeInsights(sessions) {
  const extrasOf = (s) => (s.included != null ? Math.max(0, s.selected - s.included) : 0);
  const revenueOf = (s) => s.supplementCents + s.printCents;
  const total = sessions.length;

  const groups = new Map();
  for (const s of sessions) {
    const key = s.type || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const summarize = (list) => {
    const n = list.length;
    const withPackage = list.filter((s) => s.included != null);
    const withExtras = withPackage.filter((s) => extrasOf(s) > 0);
    const revenue = list.reduce((sum, s) => sum + revenueOf(s), 0);
    const buyers = list.filter((s) => revenueOf(s) > 0).length;
    return {
      count: n,
      share: total ? n / total : 0,
      avgPhotos: round1(avg(list.reduce((sum, s) => sum + s.photos, 0), n)),
      avgSelected: round1(avg(list.reduce((sum, s) => sum + s.selected, 0), n)),
      avgIncluded: round1(avg(withPackage.reduce((sum, s) => sum + s.included, 0), withPackage.length)),
      extrasRate: withPackage.length ? withExtras.length / withPackage.length : 0,
      avgExtras: round1(avg(withExtras.reduce((sum, s) => sum + extrasOf(s), 0), withExtras.length)),
      revenueCents: revenue,
      supplementCents: list.reduce((sum, s) => sum + s.supplementCents, 0),
      printCents: list.reduce((sum, s) => sum + s.printCents, 0),
      avgRevenueCents: Math.round(avg(revenue, n)),
      basketCents: Math.round(avg(revenue, buyers)),
      buyers,
      validatedRate: n ? list.filter((s) => s.validated).length / n : 0,
    };
  };

  const byType = [...groups.entries()]
    .map(([key, list]) => ({ key, guessed: list.filter((s) => s.guessed).length, ...summarize(list) }))
    .sort((a, b) => b.count - a.count || b.revenueCents - a.revenueCents);

  // Forfaits : nombre de photos comprises (10, 15, 20…), du plus fréquent au
  // moins fréquent ; « sans forfait » à part.
  const packages = new Map();
  for (const s of sessions) {
    const key = s.included != null ? String(s.included) : "";
    if (!packages.has(key)) packages.set(key, []);
    packages.get(key).push(s);
  }
  const byPackage = [...packages.entries()]
    .map(([key, list]) => {
      const sum = summarize(list);
      const types = new Map();
      for (const s of list) types.set(s.type || "", (types.get(s.type || "") || 0) + 1);
      const topType = [...types.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      return { included: key === "" ? null : Number(key), topType, ...sum };
    })
    .sort((a, b) => (a.included == null) - (b.included == null) || b.count - a.count);

  const overall = summarize(sessions);
  const typed = byType.filter((t) => t.key);
  const pick = (list, score) => list.length ? list.reduce((best, t) => (score(t) > score(best) ? t : best)) : null;
  const highlights = {
    mostRequested: typed[0] ? typed[0].key : null,
    leastPractised: typed.length > 1 ? typed[typed.length - 1].key : null,
    bestBasket: pick(typed.filter((t) => t.buyers > 0), (t) => t.basketCents)?.key ?? null,
    mostExtras: pick(typed.filter((t) => t.extrasRate > 0), (t) => t.extrasRate)?.key ?? null,
    topPackage: byPackage.find((p) => p.included != null)?.included ?? null,
  };

  return { total, overall, byType, byPackage, highlights, toClassify: sessions.filter((s) => !s.type || s.guessed).length };
}

// GET /api/admin/insights?period=12m
export async function insightsForAdmin(env, photographerId, period, at = Math.floor(Date.now() / 1000)) {
  const p = PERIODS.includes(period) ? period : "12m";
  const since = periodStart(p, at);

  const { results } = await env.DB.prepare(
    `SELECT g.slug, g.title, g.client_name, g.session_type, g.included_photos, g.extra_photo_price_cents,
            g.selection_done_at, g.created_at,
            (SELECT COUNT(*) FROM photos ph WHERE ph.gallery_id = g.id) AS photos,
            (SELECT COUNT(*) FROM photos ph WHERE ph.gallery_id = g.id AND ph.selected = 1) AS selected,
            (SELECT COALESCE(SUM(pay.extra_count), 0) FROM payments pay WHERE pay.gallery_id = g.id AND pay.status = 'paid') AS paid_extras,
            (SELECT COALESCE(SUM(pay.amount_cents), 0) FROM payments pay WHERE pay.gallery_id = g.id AND pay.status = 'paid' AND pay.kind = 'supplement') AS supplement_cents,
            (SELECT COALESCE(SUM(pay.amount_cents), 0) FROM payments pay WHERE pay.gallery_id = g.id AND pay.status = 'paid' AND pay.kind = 'print') AS print_cents
     FROM galleries g
     WHERE g.photographer_id = ? AND g.demo = 0 AND g.kind = 'client' AND g.created_at >= ?
     ORDER BY g.created_at DESC`
  )
    .bind(photographerId, since)
    .all();

  const sessions = results.map((g) => {
    const chosen = cleanSessionType(g.session_type);
    const guess = chosen ? "" : guessSessionType(g.title);
    return {
      slug: g.slug,
      title: g.title,
      clientName: g.client_name || "",
      createdAt: g.created_at,
      type: chosen || guess,
      guessed: !chosen && Boolean(guess),
      included: g.included_photos == null ? null : Number(g.included_photos),
      extraPriceCents: g.extra_photo_price_cents || 0,
      photos: g.photos,
      selected: g.selected,
      paidExtras: g.paid_extras,
      supplementCents: g.supplement_cents,
      printCents: g.print_cents,
      validated: Boolean(g.selection_done_at),
    };
  });

  // Réservations en ligne de la période, par prestation : ce que les
  // clients demandent, même avant qu'une galerie existe.
  const { results: bookings } = await env.DB.prepare(
    `SELECT offer_title AS title, COUNT(*) AS n, COALESCE(SUM(price_cents), 0) AS price_cents
     FROM bookings WHERE photographer_id = ? AND status = 'confirmed' AND starts_at >= ?
     GROUP BY offer_title ORDER BY n DESC LIMIT 12`
  )
    .bind(photographerId, since)
    .all();

  return json({
    period: p,
    since,
    types: SESSION_TYPES,
    ...computeInsights(sessions),
    bookings: bookings.map((b) => ({ title: b.title, count: b.n, priceCents: b.price_cents })),
    // Séances à classer (type absent ou deviné) : corrigées d'un clic.
    sessions: sessions.filter((s) => !s.type || s.guessed).slice(0, 50)
      .map((s) => ({ slug: s.slug, title: s.title, clientName: s.clientName, createdAt: s.createdAt, type: s.type, guessed: s.guessed })),
  });
}

// POST /api/admin/galleries/:slug/session-type { sessionType }
export async function setSessionType(request, env, photographerId, slug) {
  const body = await request.json().catch(() => null);
  if (!body) return fail(400, "Requête invalide");
  const type = cleanSessionType(body.sessionType);
  if (body.sessionType && !type) return fail(400, "Type de séance inconnu");
  const updated = await env.DB.prepare("UPDATE galleries SET session_type = ? WHERE slug = ? AND photographer_id = ?")
    .bind(type, slug, photographerId)
    .run();
  if (!updated.meta?.changes) return fail(404, "Galerie introuvable");
  return json({ ok: true, sessionType: type });
}
