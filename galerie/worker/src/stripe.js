// Client HTTP minimal vers l'API Stripe — pas le SDK officiel (pensé pour
// Node, pas pour l'environnement Workers), seulement les quelques appels
// dont ce projet a besoin : comptes Connect (Express), liens d'onboarding,
// et vérification de signature de webhook. Tout en WebCrypto/fetch natifs.

const API_BASE = "https://api.stripe.com/v1";
// Épinglée : une nouvelle version de l'API Stripe ne doit jamais changer le
// comportement de ce code sous nos pieds sans qu'on le décide explicitement.
const API_VERSION = "2024-06-20";

// Stripe attend un corps `application/x-www-form-urlencoded`, avec les
// objets imbriqués à plat façon `capabilities[card_payments][requested]`.
function flatten(params, prefix, out) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, name, out);
    } else {
      out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return out;
}

async function stripeRequest(env, method, path, params) {
  if (!env.STRIPE_SECRET_KEY) {
    const err = new Error("STRIPE_SECRET_KEY n'est pas configurée");
    err.stripeNotConfigured = true;
    throw err;
  }
  const body = params ? flatten(params, "", []).join("&") : undefined;
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
      "Stripe-Version": API_VERSION,
    },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data?.error?.message || `Stripe a refusé la requête (HTTP ${response.status})`);
    err.stripeStatus = response.status;
    err.stripeCode = data?.error?.code;
    throw err;
  }
  return data;
}

// Compte « Express » : Stripe héberge lui-même toute la vérification
// d'identité et la saisie du RIB — on ne voit jamais ces informations.
export function createConnectAccount(env, photographer) {
  return stripeRequest(env, "POST", "/accounts", {
    type: "express",
    // La quasi-totalité des photographes visés aujourd'hui sont en Belgique ;
    // Stripe exige un pays à la création d'un compte Express et ne permet
    // pas de le changer ensuite — à revoir le jour où la plateforme accueille
    // des photographes hors de Belgique.
    country: "BE",
    email: photographer.email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
  });
}

// Lien à usage unique (quelques minutes) vers le formulaire Stripe hébergé.
// `refreshUrl` est rouvert par Stripe si le lien a expiré avant d'être
// utilisé ; `returnUrl` une fois l'étape terminée (pas forcément complète :
// il faut relire le compte pour savoir si les paiements sont vraiment actifs).
export function createAccountLink(env, accountId, { returnUrl, refreshUrl }) {
  return stripeRequest(env, "POST", "/account_links", {
    account: accountId,
    return_url: returnUrl,
    refresh_url: refreshUrl,
    type: "account_onboarding",
  });
}

export function retrieveAccount(env, accountId) {
  return stripeRequest(env, "GET", `/accounts/${encodeURIComponent(accountId)}`);
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Vérifie l'en-tête Stripe-Signature d'un webhook : décompose `t=…,v1=…`,
// recalcule le HMAC-SHA256 attendu sur `${t}.${payload}` (le corps brut, tel
// que reçu — jamais reparsé puis réencodé, ce qui changerait la signature),
// compare à temps constant, et rejette un évènement trop ancien (rejeu).
export async function verifyStripeSignature(payload, header, secret, toleranceSeconds = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k, v];
    })
  );
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!Number.isFinite(timestamp) || !signature) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const expected = toHex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`))
  );

  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
