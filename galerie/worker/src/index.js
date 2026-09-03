// Worker Cloudflare — API des galeries protégées.
//
// Bindings attendus (voir wrangler.toml) :
//   DB      → base D1
//   TILES   → bucket R2 (tuiles d'images)
// Secrets attendus (wrangler secret put …) :
//   ADMIN_TOKEN   → jeton d'administration du photographe
//   TOKEN_SECRET  → clé de signature des sessions client
// Variables :
//   ALLOWED_ORIGINS → origines autorisées, séparées par des virgules

import { handleAdmin } from "./admin.js";
import { handleViewer } from "./viewer.js";
import { json, fail } from "./http.js";

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Sans liste configurée on ne renvoie aucun en-tête CORS : le navigateur
  // bloquera les appels cross-origin plutôt que d'ouvrir l'API à tous.
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    let response;
    try {
      // Sans ces secrets, l'API accepterait des jetons signés avec une clé vide.
      // Mieux vaut refuser franchement qu'ouvrir les galeries en silence.
      if (!env.TOKEN_SECRET || !env.ADMIN_TOKEN) {
        console.error("Secrets manquants : ADMIN_TOKEN et TOKEN_SECRET doivent être définis.");
        return fail(503, "Service mal configuré");
      }

      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (path === "/" || path === "/health") {
        response = json({ ok: true, service: "galerie-protegee" });
      } else if (path.startsWith("/api/admin/")) {
        response = await handleAdmin(request, env, ctx, path);
      } else if (path.startsWith("/api/gallery/")) {
        response = await handleViewer(request, env, ctx, path);
      } else {
        response = fail(404, "Route inconnue");
      }
    } catch (err) {
      console.error("Erreur non gérée :", err && err.stack ? err.stack : err);
      response = fail(500, "Erreur interne");
    }

    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    // La galerie ne doit jamais être mise en cache par un proxy intermédiaire.
    if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "no-referrer");
    return new Response(response.body, { status: response.status, headers });
  },
};
