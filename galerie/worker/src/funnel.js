// Parcours d'inscription : de la visite du site au premier client, pour
// savoir où les photographes décrochent avant de devenir clients.
//
// Deux sources, sans cookie ni donnée personnelle :
//  - le haut du parcours (visite, clic « Créer un compte », écran
//    d'inscription) : des compteurs anonymes par jour, page et source,
//    envoyés par le site (web/funnel.js) et l'espace photographe. Ni IP, ni
//    navigateur, ni identifiant : seulement « +1 » sur une case du tableau ;
//  - la suite (compte créé, première galerie, photos, client, formule) : lue
//    sur les comptes eux-mêmes, avec la page et la source d'arrivée gardées
//    à l'inscription (photographers.signup_page / signup_source).
//
// Les compteurs sont publics par nature (n'importe qui peut en ajouter) :
// valeurs filtrées, robots écartés, nombre de lignes plafonné. Ils servent à
// voir des tendances, pas à facturer.

import { json, fail } from "./http.js";

export const FUNNEL_STEPS = ["visit", "signup_click", "signup_view"];

// Pages du site qui mènent à l'inscription (web/funnel.js, pageOf).
export const FUNNEL_PAGES = {
  accueil: "Accueil",
  "accueil-en": "Accueil (anglais)",
  mariage: "Galerie photo de mariage",
  contrat: "Contrat de photographe",
  proteger: "Protéger ses photos",
  fideliser: "Fidéliser ses clients",
  reservation: "Réservation de séance",
};

// Sources reconnues par le site (web/funnel.js, sourceOf) ; un utm_source
// de campagne passe tel quel s'il est propre (lettres, chiffres, tirets).
export const FUNNEL_SOURCES = {
  direct: "Accès direct",
  google: "Google",
  bing: "Bing",
  duckduckgo: "DuckDuckGo",
  ecosia: "Ecosia",
  qwant: "Qwant",
  yahoo: "Yahoo",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  youtube: "YouTube",
  tiktok: "TikTok",
  x: "X (Twitter)",
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  claude: "Claude",
  "autre-site": "Autre site",
};

const MAX_ROWS = 50000;
const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget|python-requests/i;

export function cleanPage(value) {
  const page = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(FUNNEL_PAGES, page) ? page : "";
}

export function cleanSource(value) {
  const source = String(value || "").trim().toLowerCase();
  if (!source) return "direct";
  return /^[a-z0-9][a-z0-9-]{0,29}$/.test(source) ? source : "autre-site";
}

export function sourceLabel(source) {
  return FUNNEL_SOURCES[source] || source;
}

// { event } prêt à compter, { ignore } (robot, étape inconnue) ou { error }.
export function readFunnelEvent(body, userAgent = "") {
  if (BOT_RE.test(String(userAgent || ""))) return { ignore: true };
  const b = body && typeof body === "object" ? body : null;
  if (!b) return { error: "Requête invalide" };
  const step = String(b.step || "");
  if (!FUNNEL_STEPS.includes(step)) return { ignore: true };
  return { event: { step, page: cleanPage(b.page), source: cleanSource(b.source) } };
}

export function dayOf(ts) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function now() {
  return Math.floor(Date.now() / 1000);
}

// POST /api/public/funnel — envoyé par navigator.sendBeacon en text/plain
// (pas de requête préalable CORS) : le corps est lu comme du texte.
export async function recordFunnelEvent(request, env, at = now()) {
  let body = null;
  try {
    const text = await request.text();
    if (text.length > 2000) return fail(400, "Requête invalide");
    body = JSON.parse(text);
  } catch {
    return fail(400, "Requête invalide");
  }
  const read = readFunnelEvent(body, request.headers.get("user-agent"));
  if (read.error) return fail(400, read.error);
  if (read.ignore) return json({ ok: true });
  await countFunnelEvent(env, read.event, at);
  return json({ ok: true });
}

export async function countFunnelEvent(env, { step, page, source }, at = now()) {
  const day = dayOf(at);
  const updated = await env.DB.prepare(
    "UPDATE funnel_daily SET count = count + 1 WHERE day = ? AND step = ? AND page = ? AND source = ?"
  )
    .bind(day, step, page, source)
    .run();
  if (updated.meta?.changes) return;
  const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM funnel_daily").first();
  if ((rows?.n || 0) >= MAX_ROWS) return;
  await env.DB.prepare(
    `INSERT INTO funnel_daily (day, step, page, source, count) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT (day, step, page, source) DO UPDATE SET count = count + 1`
  )
    .bind(day, step, page, source)
    .run();
}

// Page et source d'arrivée gardées sur le compte à l'inscription.
export function signupAttribution(body) {
  const b = body && typeof body === "object" ? body : {};
  return {
    page: cleanPage(b.signupPage),
    // Sans source (lien direct vers l'inscription) : accès direct. Seuls les
    // comptes créés avant la mesure restent sans source.
    source: cleanSource(b.signupSource),
  };
}

const ACCOUNT_STAGES = [
  // Clé, libellé, condition SQL sur le compte p.
  ["gallery", "Première vraie galerie", "EXISTS (SELECT 1 FROM galleries g WHERE g.photographer_id = p.id AND g.demo = 0)"],
  ["photos", "Photos envoyées", `EXISTS (SELECT 1 FROM photos ph JOIN galleries g ON g.id = ph.gallery_id
      WHERE g.photographer_id = p.id AND g.demo = 0)`],
  ["client", "Galerie ouverte par un client", `EXISTS (SELECT 1 FROM access_log l JOIN galleries g ON g.id = l.gallery_id
      WHERE g.photographer_id = p.id AND g.demo = 0 AND l.event = 'login')`],
  ["subscribed", "Formule payante choisie", "(p.plan_started_at IS NOT NULL OR p.trial_used_at IS NOT NULL)"],
];

// Vue propriétaire : le parcours sur les `days` derniers jours. Le haut du
// parcours compte les évènements de la période ; la suite suit les comptes
// créés pendant la période (cohorte), jusqu'à aujourd'hui — seulement ceux
// créés depuis la mise en place de la mesure (source enregistrée), pour ne
// pas comparer des comptes anciens à des visites qu'on ne comptait pas.
export async function funnelForOwner(env, { days = 30, at = now() } = {}) {
  const span = [7, 30, 90, 365].includes(Number(days)) ? Number(days) : 30;
  const sinceDay = dayOf(at - (span - 1) * 86400);
  const sinceTs = Math.floor(Date.parse(sinceDay + "T00:00:00Z") / 1000);

  const { results: counted } = await env.DB.prepare(
    "SELECT step, page, source, SUM(count) AS n FROM funnel_daily WHERE day >= ? GROUP BY step, page, source"
  )
    .bind(sinceDay)
    .all();

  const stageSql = ACCOUNT_STAGES.map(([key, , cond]) => `CASE WHEN ${cond} THEN 1 ELSE 0 END AS ${key}`).join(",\n       ");
  const { results: accounts } = await env.DB.prepare(
    `SELECT p.signup_page AS page, p.signup_source AS source,
       CASE WHEN p.plan IN ('essentiel', 'pro', 'studio') AND p.plan_status IN ('active', 'past_due')
            AND p.stripe_subscription_id != '' THEN 1 ELSE 0 END AS paying,
       ${stageSql}
     FROM photographers p
     WHERE p.created_at >= ? AND p.email != ? AND p.signup_source != ''`
  )
    .bind(sinceTs, env.OWNER_EMAIL || "")
    .all();

  const sum = (step) => counted.filter((r) => r.step === step).reduce((n, r) => n + r.n, 0);
  const has = (key) => accounts.filter((a) => a[key]).length;
  const steps = [
    { key: "visit", label: "Visiteurs du site", count: sum("visit") },
    { key: "signup_click", label: "Clics « Créer un compte »", count: sum("signup_click") },
    { key: "signup_view", label: "Écran d'inscription ouvert", count: sum("signup_view") },
    { key: "signup", label: "Comptes créés", count: accounts.length },
    ...ACCOUNT_STAGES.map(([key, label]) => ({ key, label, count: has(key) })),
  ];

  // Par source et par page : visiteurs, clics, comptes créés, comptes allés
  // jusqu'au premier client.
  const group = (field, labelOf) => {
    const rows = new Map();
    const row = (id) => {
      if (!rows.has(id)) rows.set(id, { id, label: labelOf(id), visits: 0, clicks: 0, signups: 0, activated: 0 });
      return rows.get(id);
    };
    for (const r of counted) {
      if (r.step === "visit") row(r[field]).visits += r.n;
      if (r.step === "signup_click") row(r[field]).clicks += r.n;
    }
    for (const a of accounts) {
      const r = row(a[field] || "");
      r.signups += 1;
      if (a.client) r.activated += 1;
    }
    return [...rows.values()].sort((a, b) => b.signups - a.signups || b.visits - a.visits);
  };

  return {
    days: span,
    since: sinceDay,
    steps,
    paying: has("paying"),
    bySource: group("source", sourceLabel),
    byPage: group("page", (p) => FUNNEL_PAGES[p] || (p ? p : "Aucune (lien direct vers l'inscription)")),
  };
}
