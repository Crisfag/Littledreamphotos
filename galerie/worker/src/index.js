// Worker Cloudflare — API des galeries protégées.
//
// Bindings attendus (voir wrangler.toml) :
//   DB      → base D1
//   TILES   → bucket R2 (tuiles d'images)
// Secrets attendus (wrangler secret put …) :
//   AUTH_SECRET   → clé de signature des sessions de compte photographe
//   TOKEN_SECRET  → clé de signature des sessions client (une galerie)
// Variables :
//   ALLOWED_ORIGINS → origines autorisées, séparées par des virgules

import { handleAdmin } from "./admin.js";
import { handleViewer } from "./viewer.js";
import { handleAuth } from "./authPhotographer.js";
import { handleOwner } from "./owner.js";
import { handleLibraryAudio } from "./music.js";
import { handleStripeWebhook } from "./billing.js";
import { runReminders } from "./reminders.js";
import { purgeOldAccessLogs } from "./privacy.js";
import { runSalesReminders } from "./campaigns.js";
import { shopState } from "./shop.js";
import { studioSubdomainOf, handleStudioHost } from "./studio.js";
import { handlePrintAsset, handleProdigiCallback } from "./shop.js";
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
      // Mieux vaut refuser franchement qu'ouvrir les galeries ou les comptes en silence.
      if (!env.TOKEN_SECRET || !env.AUTH_SECRET) {
        console.error("Secrets manquants : AUTH_SECRET et TOKEN_SECRET doivent être définis.");
        return fail(503, "Service mal configuré");
      }

      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      // Adresse d'un studio (julie.holypixx.com) : la page de galerie et
      // l'API y sont servies sur une même origine (voir studio.js). Le site
      // principal et les noms réservés passent tels quels à l'hébergement
      // habituel — ce Worker ne s'interpose jamais sur eux.
      const studio = studioSubdomainOf(url.hostname, env);
      if (studio) {
        const handled = await handleStudioHost(request, env, url, studio, path);
        if (handled) return handled;
      } else if (env.STUDIO_DOMAIN && (url.hostname === env.STUDIO_DOMAIN || url.hostname.endsWith("." + env.STUDIO_DOMAIN))) {
        return fetch(request);
      }

      if (path === "/" || path === "/health") {
        response = json({ ok: true, service: "galerie-protegee" });
      } else if (path.startsWith("/api/auth/")) {
        response = await handleAuth(request, env, ctx, path);
      } else if (path.startsWith("/api/admin/")) {
        response = await handleAdmin(request, env, ctx, path);
      } else if (path.startsWith("/api/owner/")) {
        response = await handleOwner(request, env, path);
      } else if (path.startsWith("/api/gallery/")) {
        response = await handleViewer(request, env, ctx, path);
      } else if (path.startsWith("/api/music-library/") && request.method === "GET") {
        // Écoute d'un morceau libre de droits de la bibliothèque commune.
        response = await handleLibraryAudio(request, env, decodeURIComponent(path.split("/")[3] || ""));
      } else if (path.startsWith("/api/print-assets/") && request.method === "GET") {
        // Fichier d'impression, téléchargé par le labo via une URL signée.
        const [, , , orderId, photoId] = path.split("/");
        response = await handlePrintAsset(request, env, decodeURIComponent(orderId || ""), decodeURIComponent(photoId || ""));
      } else if (path.startsWith("/api/prodigi/callback/") && request.method === "POST") {
        // Notification de Prodigi (URL signée, contenu relu chez Prodigi).
        const orderId = decodeURIComponent(path.split("/")[4] || "");
        response = await handleProdigiCallback(request, env, orderId);
      } else if (path === "/api/stripe/webhook") {
        // Appelé par les serveurs Stripe, jamais par un navigateur : pas de
        // session applicative, l'authenticité vient de la signature.
        response = await handleStripeWebhook(request, env);
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

  // Déclencheur planifié (wrangler.toml, [triggers]) : relances automatiques.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runReminders(env).catch((err) => {
        console.error("Relances : échec de la passe planifiée :", err && err.stack ? err.stack : err);
      })
    );
    // Campagnes de vente : paniers oubliés, coups de cœur à imprimer.
    ctx.waitUntil(
      runSalesReminders(env, shopState).catch((err) => {
        console.error("Relances de vente : échec de la passe planifiée :", err && err.stack ? err.stack : err);
      })
    );
    // Conservation limitée des journaux d'accès (voir privacy.js).
    ctx.waitUntil(
      purgeOldAccessLogs(env).catch((err) => {
        console.error("Purge des journaux : échec :", err && err.stack ? err.stack : err);
      })
    );
  },
};
