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
import { createSubscriptionCheckout, createBillingPortalSession, ensureCoupon, retrieveCheckoutSession, searchPhotographerSubscriptions } from "./stripe.js";
import { storageForAdmin } from "./storage.js";

export const PLANS = {
  free: {
    key: "free",
    label: "Découverte",
    priceCents: 0,
    maxActiveGalleries: 3,
    storageBytes: 5e9,
    features: { shop: false, subdomain: false },
    pitch: "Pour essayer : 3 galeries actives, protection complète, sélection, livraison HD.",
  },
  essentiel: {
    key: "essentiel",
    label: "Essentiel",
    priceCents: 1500,
    yearlyCents: 15000,
    founderCents: 1200,
    founderYearlyCents: 12000,
    maxActiveGalleries: 25,
    storageBytes: 200e9,
    features: { shop: true, subdomain: false },
    pitch: "25 galeries actives et la boutique de tirages.",
  },
  pro: {
    key: "pro",
    label: "Pro",
    priceCents: 2900,
    yearlyCents: 29000,
    founderCents: 2400,
    founderYearlyCents: 24000,
    maxActiveGalleries: null,
    storageBytes: 1000e9,
    features: { shop: true, subdomain: true },
    pitch: "Galeries illimitées, boutique, et vos galeries à votre nom (votre-studio.holypixx.com).",
  },
};

// Essai gratuit des formules payantes : une seule fois par compte. La carte
// est demandée par Stripe dès l'inscription, rien n'est prélevé si
// l'abonnement est résilié avant la fin de l'essai.
export const TRIAL_DAYS = 10;

// Offre Fondateurs : les FOUNDERS_LIMIT premiers abonnés paient le prix
// réduit (founderCents / founderYearlyCents) pendant la première année,
// puis le prix normal. La réduction est un coupon Stripe appliqué à
// l'abonnement (12 mois en mensuel, la 1re échéance en annuel).
export const FOUNDERS_LIMIT = 50;

export const INTERVALS = ["month", "year"];

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
    yearlyCents: plan.yearlyCents ?? 0,
    founderCents: plan.founderCents ?? 0,
    founderYearlyCents: plan.founderYearlyCents ?? 0,
    maxActiveGalleries: plan.maxActiveGalleries,
    storageBytes: plan.storageBytes,
    features: plan.features,
    pitch: plan.pitch,
  };
}

// Places de l'offre Fondateurs déjà prises (comptes passés par un
// abonnement au prix Fondateurs).
export async function foundersTaken(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM photographers WHERE founder_at IS NOT NULL").first();
  return row?.n || 0;
}

// Essai et prix Fondateurs ne valent que pour un premier abonnement : le
// client Stripe n'est créé qu'au premier abonnement payé et n'est jamais
// effacé, il sert donc de témoin (résilier puis se réabonner ne relance ni
// un essai ni une année à prix réduit).
export function trialAvailable(photographer) {
  return !photographer?.trial_used_at && !photographer?.stripe_customer_id;
}

export function founderEligible(photographer, taken) {
  return !photographer?.founder_at && !photographer?.stripe_customer_id && taken < FOUNDERS_LIMIT;
}

export function publicPlans(taken) {
  return {
    plans: Object.values(PLANS).map(planOut),
    trialDays: TRIAL_DAYS,
    founders: { limit: FOUNDERS_LIMIT, remaining: Math.max(0, FOUNDERS_LIMIT - taken) },
  };
}

// GET /api/public/plans — formules, essai et places Fondateurs restantes
// (page d'accueil). Aucune donnée de compte.
export async function plansForPublic(env) {
  return json(publicPlans(await foundersTaken(env)), { headers: { "cache-control": "public, max-age=300" } });
}

export async function subscriptionForAdmin(env, photographer) {
  const plan = planFor(env, photographer);
  const taken = await foundersTaken(env);
  return json({
    ...publicPlans(taken),
    plan: planOut(plan),
    owner: isOwner(env, photographer),
    status: photographer.plan_status || "",
    interval: photographer.plan_interval || "month",
    subscribedPlan: photographer.plan || "free",
    renewsAt: photographer.plan_renews_at || null,
    trialAvailable: trialAvailable(photographer),
    founderEligible: founderEligible(photographer, taken),
    isFounder: Boolean(photographer.founder_at),
    cancelAtPeriodEnd: Boolean(photographer.plan_cancel_at_period_end),
    canManage: Boolean(photographer.stripe_customer_id),
    stripeConfigured: Boolean(env.STRIPE_SECRET_KEY),
    usage: { activeGalleries: await activeGalleryCount(env, photographer.id), storage: await storageForAdmin(env, photographer) },
  });
}

function stripeFailure(err) {
  if (err.stripeNotConfigured) return fail(503, "Le paiement des abonnements n'est pas encore configuré sur la plateforme.");
  return fail(502, err.message || "Stripe a refusé la demande");
}

// Coupon Stripe de l'offre Fondateurs pour une formule et une période :
// la différence avec le prix normal, pendant 12 mois (mensuel) ou sur la
// première échéance (annuel).
export function founderCoupon(plan, interval) {
  const yearly = interval === "year";
  const amountOff = yearly ? plan.yearlyCents - plan.founderYearlyCents : plan.priceCents - plan.founderCents;
  return {
    id: `fondateurs-${plan.key}-${yearly ? "annuel" : "mensuel"}`,
    name: "Offre Fondateurs (1re année)",
    currency: "eur",
    amount_off: amountOff,
    duration: yearly ? "once" : "repeating",
    ...(yearly ? {} : { duration_in_months: 12 }),
  };
}

// POST /api/admin/subscription/checkout { plan, interval, returnUrl }
export async function startSubscriptionCheckout(request, env, photographer) {
  const body = await request.json().catch(() => null);
  const plan = PLANS[body?.plan];
  if (!plan || plan.key === "free") return fail(400, "Formule inconnue");
  const interval = INTERVALS.includes(body?.interval) ? body.interval : "month";
  if (isOwner(env, photographer)) return fail(409, "Le compte propriétaire a déjà toutes les fonctionnalités.");
  if (planFor(env, photographer).key !== "free" && photographer.stripe_customer_id) {
    return fail(409, "Vous avez déjà un abonnement : changez de formule depuis « Gérer mon abonnement ».");
  }
  const returnUrl = String(body?.returnUrl || "");
  if (!/^https?:\/\//.test(returnUrl)) return fail(400, "Adresse de retour invalide");
  // Un abonnement déjà payé mais pas encore enregistré ici (webhook manqué ou
  // en retard) : on le rattrape plutôt que d'en ouvrir un second.
  if (!photographer.stripe_subscription_id) {
    const existing = await findLiveSubscription(env, photographer).catch(() => null);
    if (existing) {
      await applySubscription(env, existing);
      return fail(409, "Vous avez déjà un abonnement en cours : il vient d'être enregistré, rechargez la page.");
    }
  }
  try {
    const founder = founderEligible(photographer, await foundersTaken(env));
    let couponId = "";
    if (founder) {
      const coupon = founderCoupon(plan, interval);
      await ensureCoupon(env, coupon);
      couponId = coupon.id;
    }
    const session = await createSubscriptionCheckout(env, {
      photographerId: photographer.id,
      email: photographer.email,
      customerId: photographer.stripe_customer_id || "",
      planKey: plan.key,
      label: `Holypixx ${plan.label}${interval === "year" ? " (annuel)" : ""}`,
      unitAmountCents: interval === "year" ? plan.yearlyCents : plan.priceCents,
      interval,
      trialDays: trialAvailable(photographer) ? TRIAL_DAYS : 0,
      couponId,
      // {CHECKOUT_SESSION_ID} est remplacé par Stripe : au retour, le tableau
      // de bord relit cette session (voir syncSubscription).
      successUrl: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}abonnement=merci&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}abonnement=annule`,
    });
    return json({ url: session.url });
  } catch (err) {
    return stripeFailure(err);
  }
}

// Abonnements qui comptent encore (pas résiliés, pas abandonnés au paiement).
const LIVE_STATUSES = ["trialing", "active", "past_due", "unpaid"];

async function findLiveSubscription(env, photographer) {
  const subs = await searchPhotographerSubscriptions(env, photographer.id);
  return subs
    .filter((sub) => LIVE_STATUSES.includes(sub.status))
    .sort((a, b) => (b.created || 0) - (a.created || 0))[0] || null;
}

// Enregistre un abonnement relu chez Stripe, exactement comme le ferait le
// webhook : essai et place Fondateurs d'abord (comme checkout.session.completed),
// puis formule, statut et échéance (comme customer.subscription.updated).
async function applySubscription(env, sub, session = null) {
  const photographerId = session?.client_reference_id || sub.metadata?.photographer_id;
  const planKey = planKeyFromSubscription(sub) || sub.metadata?.plan || "";
  if (!photographerId || !PLANS[planKey]) return;
  const coupons = [sub.discount?.coupon?.id, ...(sub.discounts || []).map((d) => d?.coupon?.id || d?.coupon)];
  const founder = session ? session.metadata?.founder === "1" : coupons.some((id) => String(id || "").startsWith("fondateurs-"));
  const trial = session ? session.metadata?.trial === "1" : Boolean(sub.trial_start);
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id || "";
  await handleSubscriptionEvent(env, {
    type: "checkout.session.completed",
    data: { object: {
      mode: "subscription", client_reference_id: photographerId, customer, subscription: sub.id,
      metadata: { plan: planKey, trial: trial ? "1" : "0", founder: founder ? "1" : "0" },
    } },
  });
  await handleSubscriptionEvent(env, { type: "customer.subscription.updated", data: { object: { ...sub, customer } } });
}

// POST /api/admin/subscription/sync { sessionId? } — au retour de Stripe, relit
// la session de paiement (ou, à défaut, les abonnements du photographe) et
// met la base à jour sans attendre le webhook.
export async function syncSubscription(request, env, photographer) {
  const body = await request.json().catch(() => null);
  const sessionId = String(body?.sessionId || "");
  if (!isOwner(env, photographer)) {
    try {
      if (/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
        const session = await retrieveCheckoutSession(env, sessionId, { expandSubscription: true });
        if (session.client_reference_id !== photographer.id) return fail(403, "Cette session de paiement ne vous appartient pas");
        if (session.mode === "subscription" && session.status === "complete" && session.subscription && typeof session.subscription === "object") {
          await applySubscription(env, session.subscription, session);
        }
      } else if (!photographer.stripe_subscription_id) {
        const sub = await findLiveSubscription(env, photographer);
        if (sub) await applySubscription(env, sub);
      }
    } catch (err) {
      return stripeFailure(err);
    }
  }
  const fresh = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(photographer.id).first();
  return subscriptionForAdmin(env, fresh || photographer);
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
  const match = Object.values(PLANS).find((p) => p.priceCents && [p.priceCents, p.yearlyCents].includes(amount));
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
      const trial = object.metadata?.trial === "1";
      const founder = object.metadata?.founder === "1";
      await env.DB.prepare(
        `UPDATE photographers SET plan = ?, plan_status = ?, stripe_customer_id = ?, stripe_subscription_id = ?,
           trial_used_at = CASE WHEN ? THEN COALESCE(trial_used_at, ?) ELSE trial_used_at END,
           founder_at = CASE WHEN ? THEN COALESCE(founder_at, ?) ELSE founder_at END
         WHERE id = ?`
      )
        .bind(planKey, trial ? "trialing" : "active", object.customer || "", object.subscription || "",
              trial ? 1 : 0, now(), founder ? 1 : 0, now(), photographerId)
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
    // Selon la version d'API du webhook, l'échéance est sur l'abonnement
    // ou sur sa ligne (versions récentes) ; pendant un essai, c'est sa fin.
    const item = object.items?.data?.[0];
    const periodEnd = object.current_period_end || item?.current_period_end || object.trial_end || null;
    const interval = item?.price?.recurring?.interval || item?.plan?.interval || "";
    await env.DB.prepare(
      `UPDATE photographers SET plan = ?, plan_status = ?, plan_renews_at = ?, plan_cancel_at_period_end = ?,
         stripe_subscription_id = ?, stripe_customer_id = CASE WHEN ? != '' THEN ? ELSE stripe_customer_id END,
         plan_interval = CASE WHEN ? != '' THEN ? ELSE plan_interval END
       WHERE id = ?`
    )
      .bind(
        planKey, status, periodEnd, object.cancel_at_period_end ? 1 : 0,
        deleted ? "" : object.id || "", object.customer || "", object.customer || "",
        interval, interval, photographer.id
      )
      .run();
    return true;
  }
  return false;
}
