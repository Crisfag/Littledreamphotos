// Sous-domaine par studio : julie.holypixx.com sert la page de galerie
// (web/galerie.html et ses fichiers, relus depuis le site principal) et
// l'API, sur une même origine — le client voit l'adresse du studio, jamais
// celle de la plateforme, et aucun réglage CORS supplémentaire n'est
// nécessaire puisque la page appelle l'API de sa propre origine.
//
// Une galerie n'est servie sous un sous-domaine que si elle appartient bien
// au studio de ce sous-domaine : un lien « julie.holypixx.com/?g=x » vers
// une galerie d'un autre compte répond « introuvable », comme s'il n'y avait
// rien. Le site principal (www, apex) et les noms réservés ne sont jamais
// interceptés : la requête passe telle quelle à l'hébergement habituel.

import { hasFeature } from "./subscription.js";
import { json, fail } from "./http.js";

export const RESERVED_SUBDOMAINS = new Set([
  "www", "api", "admin", "app", "mail", "smtp", "imap", "pop", "ftp", "ns1", "ns2",
  "galerie", "galeries", "gallery", "galleries", "holypixx", "static", "cdn", "assets",
  "help", "support", "aide", "blog", "shop", "boutique", "stripe", "owner", "dev",
  "test", "staging", "status", "login", "compte", "account", "contact", "studio",
]);

export const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/;

// Normalise et valide un sous-domaine saisi par le photographe. Vide = retirer.
export function normalizeSubdomain(value) {
  const subdomain = String(value || "").trim().toLowerCase();
  if (!subdomain) return { subdomain: "" };
  if (subdomain.length < 3) return { error: "Au moins 3 caractères" };
  if (!SUBDOMAIN_RE.test(subdomain)) {
    return { error: "Lettres minuscules, chiffres et tirets seulement (30 caractères maximum, sans tiret au début ni à la fin)" };
  }
  if (RESERVED_SUBDOMAINS.has(subdomain)) return { error: "Ce nom est réservé" };
  return { subdomain };
}

// Renvoie le sous-domaine candidat si l'hôte est de la forme
// « <nom>.<STUDIO_DOMAIN> » (un seul niveau), sinon null. Les noms réservés
// (www, api…) renvoient aussi null : ils ne sont jamais interceptés.
export function studioSubdomainOf(hostname, env) {
  const domain = (env.STUDIO_DOMAIN || "").toLowerCase();
  if (!domain || !hostname) return null;
  const host = hostname.toLowerCase();
  if (!host.endsWith("." + domain)) return null;
  const label = host.slice(0, -(domain.length + 1));
  if (!label || label.includes(".")) return null;
  if (RESERVED_SUBDOMAINS.has(label)) return null;
  return label;
}

export async function studioBySubdomain(env, subdomain) {
  const studio = await env.DB.prepare("SELECT id, studio_name, subdomain, email, plan, plan_status FROM photographers WHERE subdomain = ?")
    .bind(subdomain)
    .first();
  // L'adresse à son nom fait partie de la formule Pro : sans elle (abonnement
  // résilié…), le sous-domaine ne mène plus nulle part, comme un inconnu.
  if (!studio || !hasFeature(env, studio, "subdomain")) return null;
  return { id: studio.id, studio_name: studio.studio_name, subdomain: studio.subdomain };
}

const PAGE_FILES = {
  "/": { file: "galerie.html", type: "text/html; charset=utf-8" },
  "/galerie.html": { file: "galerie.html", type: "text/html; charset=utf-8" },
  "/gallery.css": { file: "gallery.css", type: "text/css; charset=utf-8" },
  "/gallery.js": { file: "gallery.js", type: "text/javascript; charset=utf-8" },
  "/portfolio.css": { file: "portfolio.css", type: "text/css; charset=utf-8" },
  "/portfolio.js": { file: "portfolio.js", type: "text/javascript; charset=utf-8" },
};
const PORTFOLIO_PAGE = { file: "portfolio.html", type: "text/html; charset=utf-8" };

// Identifiant du portfolio publié de ce studio, ou "" s'il n'en a pas.
async function publishedHandle(env, photographerId) {
  const row = await env.DB.prepare("SELECT handle FROM portfolios WHERE photographer_id = ? AND published = 1")
    .bind(photographerId)
    .first();
  return row?.handle || "";
}

function studioNotFound() {
  return new Response(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Studio introuvable</title>
<meta name="robots" content="noindex"><style>body{font-family:Georgia,serif;background:#f7f2ec;color:#2b2521;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:2rem}p{color:#7c716a}</style></head>
<body><div><h1>Ce studio n'existe pas</h1><p>Vérifiez l'adresse reçue de votre photographe.</p></div></body></html>`,
    { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}

// Sert la page de galerie sous l'adresse du studio : les fichiers viennent
// du site principal (PUBLIC_SITE_ORIGIN), et l'adresse de l'API inscrite
// dans la page est remplacée par l'hôte courant, sans schéma (« //julie.… ») :
// la page appelle alors son API sur sa propre origine, en https dès que la
// page l'est — aucun appel cross-origin, aucun contenu mixte.
async function servePage(request, env, url, { entry = PAGE_FILES[url.pathname], handle = "" } = {}) {
  if (!entry || request.method !== "GET") return fail(404, "Page inconnue");
  const origin = (env.PUBLIC_SITE_ORIGIN || "").replace(/\/+$/, "");
  if (!origin) return fail(503, "PUBLIC_SITE_ORIGIN n'est pas configuré");

  let upstream;
  try {
    upstream = await fetch(`${origin}/${entry.file}`, { cf: { cacheTtl: 300, cacheEverything: true } });
  } catch {
    return fail(502, "Site principal injoignable");
  }
  if (!upstream.ok) return fail(502, "Site principal injoignable");

  let body = await upstream.text();
  const isHtml = entry.file.endsWith(".html");
  if (isHtml) {
    body = body.replace(/api:\s*"[^"]*"/, `api: "//${url.host}"`);
  }
  // Le portfolio servi à la racine du studio sait d'avance lequel afficher.
  if (handle) {
    body = body.replace(/handle:\s*"[^"]*"/, `handle: ${JSON.stringify(handle)}`);
  }
  return new Response(body, {
    headers: {
      "content-type": entry.type,
      "cache-control": isHtml ? "no-store" : "public, max-age=300",
    },
  });
}

// Point d'entrée appelé par index.js pour tout hôte « <sub>.<STUDIO_DOMAIN> ».
// Renvoie une réponse, ou null pour laisser la requête suivre le routage
// normal de l'API (déjà vérifiée comme appartenant à ce studio).
export async function handleStudioHost(request, env, url, subdomain, path) {
  const studio = await studioBySubdomain(env, subdomain);
  if (!studio) return studioNotFound();

  if (!path.startsWith("/api/")) {
    // Racine du studio sans lien de galerie : son portfolio, s'il est publié.
    if (url.pathname === "/" && !url.searchParams.get("g")) {
      const handle = await publishedHandle(env, studio.id);
      if (handle) return servePage(request, env, url, { entry: PORTFOLIO_PAGE, handle });
    }
    return servePage(request, env, url);
  }

  // Une galerie (ou un portfolio) d'un autre studio n'existe pas sous cette adresse.
  const parts = path.split("/").filter(Boolean); // api, gallery, slug, …
  if (parts[1] === "portfolio" && parts[2]) {
    const own = await env.DB.prepare("SELECT photographer_id FROM portfolios WHERE handle = ?").bind(decodeURIComponent(parts[2])).first();
    if (!own || own.photographer_id !== studio.id) return fail(404, "Portfolio introuvable");
  }
  if (parts[1] === "gallery" && parts[2]) {
    const gallery = await env.DB.prepare("SELECT photographer_id FROM galleries WHERE slug = ?")
      .bind(parts[2])
      .first();
    if (!gallery || gallery.photographer_id !== studio.id) return fail(404, "Galerie introuvable");
  }
  return null;
}

export function studioLinkFor(env, photographer, slug) {
  const domain = env.STUDIO_DOMAIN || "";
  if (!domain || !photographer?.subdomain) return "";
  return `https://${photographer.subdomain}.${domain}/?g=${encodeURIComponent(slug)}`;
}

export { json };
