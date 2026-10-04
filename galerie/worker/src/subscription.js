// Abonnements Holypixx : la formule de chaque photographe, ses limites, et
// le paiement mensuel par Stripe Billing, sur le compte PLATEFORME (pas le
// compte Connect du photographe, qui sert à encaisser SES clients).
//
// Les prix sont créés à la volée dans la session Checkout (`price_data` avec
// `recurring`) : aucun produit à préparer dans Stripe. Changer un prix
// ci-dessous ne touche que les nouveaux abonnements ; ceux en cours gardent
// leur prix jusqu'à résiliation.
//
// La formule n'est accordée que tant que Stripe dit l'abonnement actif (ou
// en période de grâce après un échec de paiement) ; tout le reste retombe
// sur la formule gratuite. La propriétaire de la plateforme a tout, sans
// abonnement.

import { json, fail } from "./http.js";
import { createSubscriptionCheckout, createBillingPortalSession } from "./stripe.js";

export const PLANS = {
  free: {
    key: "free",
    label: "Découverte",
    priceCents: 0,
    maxActiveGalleries: 3,
    features: { shop: false, subdomain: false },
    pitch: "Pour essayer : 3 galeries actives, protection complète, sélection, livraison HD.",
  },
  essentiel: {
    key: "essentiel",
    label: "Essentiel",
    priceCents: 1200,
    maxActiveGalleries: 25,
    features: { shop: true, subdomain: false },
    pitch: "25 galeries actives et la boutique de tirages.",
  },
  pro: {
    key: "pro",
    label: "Pro",
    priceCents: 2400,
    maxActiveGalleries: null,
    features: { shop: true, subdomain: true },
    pitch: "Galeries illimitées, boutique, et vos galeries à votre nom (votre-studio.holypixx.com).",
  },
};

export const FEATURE_LABELS = {
  shop: "La boutique de tirages",
  subdomain: "L'adresse à votre nom",
};

// Statuts Stripe qui ouvrent droit à la formule payée (past_due : période de
// grâce pendant que Stripe retente le prélèvement).
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

function now() {
  return Math.floor(Date.now() / 1000);
}

export function isOwner(env, photographer) {
  return Boolean(env.OWNER_EMAIL) && photographer?.email === env.OWNER_EMAIL;
}

// Formule effective d'un photographe (ligne de la table photographers).
export function planFor(env, photographer) {
  if (isOwner(env, photographer)) return PLANS.pro;
  const paid = PLANS[photographer?.plan];
  if (paid && paid.key !== "free" && ACTIVE_STATUSES.has(photographer.plan_status)) return paid;
  return PLANS.free;
}

export function hasFeature(env, photographer, feature) {
  return Boolean(planFor(env, photographer).features[feature]);
}

// Réponse 402 expliquant quelle formule débloque une fonctionnalité.
export function featureRefusal(feature) {
  const needed = Object.values(PLANS).find((p) => p.features[feature]);
  return fail(402, `${FEATURE_LABELS[feature] || "Cette fonctionnalité"} est incluse à partir de la formule ${needed?.label || "payante"} (onglet Abonnement).`);
}

export async function activeGalleryCount(env, photographerId) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM galleries WHERE photographer_id = ? AND (expires_at IS NULL OR expires_at > ?)"
  )
    .bind(photographerId, now())
    .first();
  return row?.n || 0;
}

// null si une nouvelle galerie est permise, sinon la réponse 402.
export async function galleryQuotaRefusal(env, photographer) {
  const plan = planFor(env, photographer);
  if (plan.maxActiveGalleries === null) return null;
  const count = await activeGalleryCount(env, photographer.id);
  if (count < plan.maxActiveGalleries) return null;
  return fail(402,
    `Votre formule ${plan.label} permet ${plan.maxActiveGalleries} galeries actives. Supprimez ou laissez expirer une galerie, ou passez à la formule supérieure (onglet Abonnement).`);
}

function planOut(plan) {
  return {
    key: plan.key,
    label: plan.label,
    priceCents: plan.priceCents,
    maxActiveGalleries: plan.maxActiveGalleries,
    features: plan.features,
    pitch: plan.pitch,
  };
}

export async function subscriptionForAdmin(env, photographer) {
  const plan = planFor(env, photographer);
  return json({
    plan: planOut(plan),
    owner: isOwner(env, photographer),
    status: photographer.plan_status || "",
    subscribedPlan: photographer.plan || "free",
    renewsAt: photographer.plan_renews_at || null,
    cancelAtPeriodEnd: Boolean(photographer.plan_cancel_at_period_end),
    canManage: Boolean(photographer.stripe_customer_id),
    stripeConfigured: Boolean(env.STRIPE_SECRET_KEY),
    usage: { activeGalleries: await activeGalleryCount(env, photographer.id) },
    plans: Object.values(PLANS).map(planOut),
  });
}

function stripeFailure(err) {
  if (err.stripeNotConfigured) return fail(503, "Le paiement des abonnements n'est pas encore configuré sur la plateforme.");
  return fail(502, err.message || "Stripe a refusé la demande");
}

// POST /api/admin/subscription/checkout { plan, returnUrl }
export async function startSubscriptionCheckout(request, env, photographer) {
  const body = await request.json().catch(() => null);
  const plan = PLANS[body?.plan];
  if (!plan || plan.key === "free") return fail(400, "Formule inconnue");
  if (isOwner(env, photographer)) return fail(409, "Le compte propriétaire a déjà toutes les fonctionnalités.");
  if (planFor(env, photographer).key !== "free" && photographer.stripe_customer_id) {
    return fail(409, "Vous avez déjà un abonnement : changez de formule depuis « Gérer mon abonnement ».");
  }
  const returnUrl = String(body?.returnUrl || "");
  if (!/^https?:\/\//.test(returnUrl)) return fail(400, "Adresse de retour invalide");
  try {
    const session = await createSubscriptionCheckout(env, {
      photographerId: photographer.id,
      email: photographer.email,
      customerId: photographer.stripe_customer_id || "",
      planKey: plan.key,
      label: `Holypixx ${plan.label}`,
      unitAmountCents: plan.priceCents,
      successUrl: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}abonnement=merci`,
      cancelUrl: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}abonnement=annule`,
    });
    return json({ url: session.url });
  } catch (err) {
    return stripeFailure(err);
  }
}

// POST /api/admin/subscription/portal { returnUrl } — portail client Stripe
// (changer de formule, carte, factures, résiliation).
export async function openBillingPortal(request, env, photographer) {
  const body = await request.json().catch(() => null);
  if (!photographer.stripe_customer_id) return fail(409, "Aucun abonnement à gérer");
  const returnUrl = String(body?.returnUrl || "");
  if (!/^https?:\/\//.test(returnUrl)) return fail(400, "Adresse de retour invalide");
  try {
    const session = await createBillingPortalSession(env, { customerId: photographer.stripe_customer_id, returnUrl });
    return json({ url: session.url });
  } catch (err) {
    return stripeFailure(err);
  }
}

/* ---------- Webhook (évènements du compte plateforme) ---------- */

export function planKeyFromSubscription(subscription) {
  const fromMetadata = subscription?.metadata?.plan;
  if (PLANS[fromMetadata]) return fromMetadata;
  // Changement de formule depuis le portail : on retrouve la formule au
  // montant mensuel du prix.
  const amount = subscription?.items?.data?.[0]?.price?.unit_amount;
  const match = Object.values(PLANS).find((p) => p.priceCents && p.priceCents === amount);
  return match ? match.key : "";
}

// Applique un évènement Stripe lié aux abonnements ; renvoie true s'il en
// était un (le reste du webhook l'ignore alors).
export async function handleSubscriptionEvent(env, event) {
  const object = event?.data?.object;
  if (!object) return false;

  if (event.type === "checkout.session.completed" && object.mode === "subscription") {
    const photographerId = object.client_reference_id || object.metadata?.photographer_id;
    const planKey = PLANS[object.metadata?.plan] ? object.metadata.plan : "";
    if (photographerId && planKey) {
      await env.DB.prepare(
        `UPDATE photographers SET plan = ?, plan_status = 'active', stripe_customer_id = ?, stripe_subscription_id = ?
         WHERE id = ?`
      )
        .bind(planKey, object.customer || "", object.subscription || "", photographerId)
        .run();
    }
    return true;
  }

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const deleted = event.type === "customer.subscription.deleted";
    const planKey = deleted ? "free" : planKeyFromSubscription(object) || "free";
    const status = deleted ? "canceled" : String(object.status || "");
    const photographer = await env.DB.prepare(
      "SELECT id, stripe_subscription_id FROM photographers WHERE stripe_subscription_id = ? OR (stripe_customer_id = ? AND stripe_customer_id != '') OR id = ?"
    )
      .bind(object.id || "", object.customer || "", object.metadata?.photographer_id || "")
      .first();
    if (!photographer) return true;
    // Un vieil abonnement résilié ne doit pas écraser un abonnement plus récent.
    if (deleted && photographer.stripe_subscription_id && photographer.stripe_subscription_id !== object.id) return true;
    await env.DB.prepare(
      `UPDATE photographers SET plan = ?, plan_status = ?, plan_renews_at = ?, plan_cancel_at_period_end = ?,
         stripe_subscription_id = ?, stripe_customer_id = CASE WHEN ? != '' THEN ? ELSE stripe_customer_id END
       WHERE id = ?`
    )
      .bind(
        planKey, status, object.current_period_end || null, object.cancel_at_period_end ? 1 : 0,
        deleted ? "" : object.id || "", object.customer || "", object.customer || "", photographer.id
      )
      .run();
    return true;
  }
  return false;
}
