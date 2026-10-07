// Vérifie la logique des abonnements sans réseau ni D1 : formule effective,
// fonctionnalités, et traitement des évènements Stripe (sur une base
// factice qui enregistre les requêtes).
//
//   node tests/subscription.test.mjs

import { PLANS, planFor, hasFeature, planKeyFromSubscription, handleSubscriptionEvent, TRIAL_DAYS, FOUNDERS_LIMIT, founderCoupon, trialAvailable, founderEligible, publicPlans, syncSubscription, monthlyRevenueCents } from "../src/subscription.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const env = { OWNER_EMAIL: "proprietaire@exemple.be" };
check("sans abonnement : formule gratuite", planFor(env, { email: "a@b.c", plan: "free", plan_status: "" }).key === "free");
check("abonnement actif ou en période de grâce : formule souscrite",
      planFor(env, { plan: "pro", plan_status: "active" }).key === "pro" && planFor(env, { plan: "essentiel", plan_status: "past_due" }).key === "essentiel" &&
      planFor(env, { plan: "pro", plan_status: "trialing" }).key === "pro");
check("abonnement impayé, incomplet ou résilié : retour au gratuit",
      ["unpaid", "incomplete", "incomplete_expired", "canceled", ""].every((status) => planFor(env, { plan: "pro", plan_status: status }).key === "free"));
check("une formule inconnue en base ne donne rien", planFor(env, { plan: "illimitee", plan_status: "active" }).key === "free");
check("la propriétaire a tout, sans abonnement", planFor(env, { email: "proprietaire@exemple.be", plan: "free" }).key === "pro");
check("fonctionnalités par formule : boutique dès Essentiel, adresse à son nom en Pro",
      !hasFeature(env, { plan: "free" }, "shop") && hasFeature(env, { plan: "essentiel", plan_status: "active" }, "shop") &&
      !hasFeature(env, { plan: "essentiel", plan_status: "active" }, "subdomain") && hasFeature(env, { plan: "pro", plan_status: "active" }, "subdomain"));
check("la formule d'un abonnement se lit dans ses métadonnées, sinon d'après son prix (changement depuis le portail)",
      planKeyFromSubscription({ metadata: { plan: "essentiel" } }) === "essentiel" &&
      planKeyFromSubscription({ metadata: {}, items: { data: [{ price: { unit_amount: PLANS.pro.priceCents } }] } }) === "pro" &&
      planKeyFromSubscription({ items: { data: [{ price: { unit_amount: 999 } }] } }) === "");

check("grille : Essentiel 15 €/mois ou 150 €/an, Pro 29 €/mois ou 290 €/an (2 mois offerts)",
      PLANS.essentiel.priceCents === 1500 && PLANS.essentiel.yearlyCents === 15000 &&
      PLANS.pro.priceCents === 2900 && PLANS.pro.yearlyCents === 29000);
check("une formule annuelle se reconnaît aussi à son prix", planKeyFromSubscription({ items: { data: [{ price: { unit_amount: 29000 } }] } }) === "pro");
check("essai gratuit de 10 jours, offre Fondateurs limitée à 50 places", TRIAL_DAYS === 10 && FOUNDERS_LIMIT === 50);
const couponMonth = founderCoupon(PLANS.pro, "month");
const couponYear = founderCoupon(PLANS.essentiel, "year");
check("Fondateurs en mensuel : 5 € de moins pendant 12 mois (24 € au lieu de 29 €), puis prix normal",
      couponMonth.amount_off === 500 && couponMonth.duration === "repeating" && couponMonth.duration_in_months === 12 && couponMonth.currency === "eur",
      JSON.stringify(couponMonth));
check("Fondateurs en annuel : 30 € de moins sur la 1re année seulement (120 € au lieu de 150 €)",
      couponYear.amount_off === 3000 && couponYear.duration === "once" && couponYear.duration_in_months === undefined && couponYear.id === "fondateurs-essentiel-annuel");
check("essai et prix Fondateurs réservés à un premier abonnement",
      trialAvailable({}) && !trialAvailable({ trial_used_at: 1 }) && !trialAvailable({ stripe_customer_id: "cus_1" }) &&
      founderEligible({}, 49) && !founderEligible({}, 50) && !founderEligible({ stripe_customer_id: "cus_1" }, 0) && !founderEligible({ founder_at: 1 }, 0));
const pub = publicPlans(47);
check("ce qui est publié : formules, durée d'essai, places restantes", pub.trialDays === 10 && pub.founders.remaining === 3 && pub.plans.length === 3 &&
      publicPlans(80).founders.remaining === 0);

// Base factice : garde la dernière requête préparée et ses valeurs.
function fakeDb(row) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, binds: [] };
      calls.push(call);
      const run = async () => ({ meta: { changes: 1 } });
      const first = async () => row;
      return {
        run, first, all: async () => ({ results: [] }),
        bind(...binds) {
          call.binds = binds;
          return { run, first, all: async () => ({ results: [] }) };
        },
      };
    },
  };
}

const db1 = fakeDb(null);
const handledCheckout = await handleSubscriptionEvent({ DB: db1 }, {
  type: "checkout.session.completed",
  data: { object: { mode: "subscription", client_reference_id: "pho_1", customer: "cus_1", subscription: "sub_1", metadata: { plan: "pro" } } },
});
check("paiement de l'abonnement confirmé : formule, client et abonnement Stripe enregistrés",
      handledCheckout === true && /UPDATE photographers SET plan = \?/.test(db1.calls[0].sql) &&
      db1.calls[0].binds.slice(0, 4).join(",") === "pro,active,cus_1,sub_1" && db1.calls[0].binds[4] === 0 && db1.calls[0].binds[6] === 0 &&
      db1.calls[0].binds.at(-1) === "pho_1", db1.calls[0].binds.join(","));
const dbTrial = fakeDb(null);
await handleSubscriptionEvent({ DB: dbTrial }, {
  type: "checkout.session.completed",
  data: { object: { mode: "subscription", client_reference_id: "pho_1", customer: "cus_1", subscription: "sub_1", metadata: { plan: "pro", trial: "1", founder: "1" } } },
});
check("abonnement avec essai et prix Fondateurs : statut « essai », essai consommé et place Fondateurs prise",
      dbTrial.calls[0].binds[1] === "trialing" && dbTrial.calls[0].binds[4] === 1 && dbTrial.calls[0].binds[6] === 1, dbTrial.calls[0].binds.join(","));
const db2 = fakeDb(null);
const ignored = await handleSubscriptionEvent({ DB: db2 }, { type: "checkout.session.completed", data: { object: { mode: "payment", id: "cs_1" } } });
check("un paiement de supplément ou de tirages n'est pas pris pour un abonnement", ignored === false && db2.calls.length === 0);

const db3 = fakeDb({ id: "pho_1", stripe_subscription_id: "sub_1" });
await handleSubscriptionEvent({ DB: db3 }, {
  type: "customer.subscription.updated",
  data: { object: { id: "sub_1", customer: "cus_1", status: "active", current_period_end: 1800000000, cancel_at_period_end: true, metadata: { plan: "essentiel" } } },
});
const update = db3.calls[1];
check("mise à jour de l'abonnement : formule, statut, échéance et résiliation programmée recopiés",
      update.binds.slice(0, 5).join(",") === "essentiel,active,1800000000,1,sub_1" && update.binds.at(-1) === "pho_1", update.binds.join(","));

const db3b = fakeDb({ id: "pho_1", stripe_subscription_id: "sub_1" });
await handleSubscriptionEvent({ DB: db3b }, {
  type: "customer.subscription.updated",
  data: { object: { id: "sub_1", customer: "cus_1", status: "trialing", trial_end: 1790000000, metadata: { plan: "pro" },
    items: { data: [{ current_period_end: 1790000000, price: { unit_amount: 29000, recurring: { interval: "year" } } }] } } },
});
check("versions d'API récentes : échéance lue sur la ligne d'abonnement, facturation annuelle enregistrée",
      db3b.calls[1].binds[2] === 1790000000 && db3b.calls[1].binds[7] === "year" && db3b.calls[1].binds[1] === "trialing", db3b.calls[1].binds.join(","));

const db4 = fakeDb({ id: "pho_1", stripe_subscription_id: "sub_1" });
await handleSubscriptionEvent({ DB: db4 }, { type: "customer.subscription.deleted", data: { object: { id: "sub_1", customer: "cus_1", status: "canceled" } } });
check("abonnement résilié : retour au gratuit", db4.calls[1].binds.slice(0, 2).join(",") === "free,canceled" && db4.calls[1].binds[4] === "");
const db5 = fakeDb({ id: "pho_1", stripe_subscription_id: "sub_2" });
await handleSubscriptionEvent({ DB: db5 }, { type: "customer.subscription.deleted", data: { object: { id: "sub_1", customer: "cus_1" } } });
check("la fin d'un ancien abonnement n'écrase pas un abonnement plus récent", db5.calls.length === 1);

{
  const t = 1800000000, YEAR = 365 * 86400;
  check("revenu mensuel : mensuel au prix normal, annuel ramené au mois, prix Fondateurs la 1re année seulement",
        monthlyRevenueCents({ plan: "pro", plan_status: "active", plan_interval: "month" }, t) === 2900 &&
        monthlyRevenueCents({ plan: "essentiel", plan_status: "active", plan_interval: "year" }, t) === 1250 &&
        monthlyRevenueCents({ plan: "pro", plan_status: "active", plan_interval: "year", founder_at: t - 10 }, t) === 2000 &&
        monthlyRevenueCents({ plan: "essentiel", plan_status: "active", plan_interval: "month", founder_at: t - YEAR - 1 }, t) === 1500);
  check("un essai, un impayé ou un compte gratuit ne rapportent rien",
        monthlyRevenueCents({ plan: "pro", plan_status: "trialing", plan_interval: "month" }, t) === 0 &&
        monthlyRevenueCents({ plan: "pro", plan_status: "canceled" }, t) === 0 && monthlyRevenueCents({ plan: "free", plan_status: "" }, t) === 0);
  const dbStart = fakeDb({ id: "pho_1", stripe_subscription_id: "sub_1" });
  await handleSubscriptionEvent({ DB: dbStart }, { type: "customer.subscription.updated",
    data: { object: { id: "sub_1", customer: "cus_1", status: "active", start_date: 1790000000, metadata: { plan: "pro" } } } });
  check("la date de début de l'abonnement (start_date Stripe) est enregistrée",
        /plan_started_at = CASE/.test(dbStart.calls[1].sql) && dbStart.calls[1].binds.at(-3) === 1 && dbStart.calls[1].binds.at(-2) === 1790000000);
}

/* ---------- Rattrapage au retour de Stripe (webhook manqué) ---------- */
// fetch intercepté : on répond comme Stripe et on note ce qui a été demandé.
const stripeCalls = [];
function fakeStripe(routes) {
  globalThis.fetch = async (url) => {
    const path = String(url).replace("https://api.stripe.com/v1", "");
    stripeCalls.push(path);
    const hit = Object.keys(routes).find((prefix) => path.startsWith(prefix));
    return new Response(JSON.stringify(hit ? routes[hit] : { error: { message: "inconnu" } }), { status: hit ? 200 : 404 });
  };
}
const stripeSub = {
  id: "sub_9", customer: "cus_9", status: "trialing", created: 1791300848, trial_start: 1791300848, trial_end: 1792164845,
  metadata: { photographer_id: "pho_1", plan: "essentiel" },
  discount: { coupon: { id: "fondateurs-essentiel-annuel" } },
  items: { data: [{ current_period_end: 1792164845, price: { unit_amount: 15000, recurring: { interval: "year" } } }] },
};
const syncEnv = (db) => ({ DB: db, STRIPE_SECRET_KEY: "sk_test_x", OWNER_EMAIL: "proprietaire@exemple.be" });
const syncRequest = (body) => new Request("https://w/api/admin/subscription/sync", { method: "POST", body: JSON.stringify(body) });

fakeStripe({ "/checkout/sessions/cs_live_abc": {
  id: "cs_live_abc", mode: "subscription", status: "complete", client_reference_id: "pho_1",
  metadata: { plan: "essentiel", trial: "1", founder: "1" }, subscription: stripeSub,
} });
const dbSync = fakeDb({ id: "pho_1", email: "a@b.c", plan: "free", plan_status: "", stripe_subscription_id: "" });
const synced = await syncSubscription(syncRequest({ sessionId: "cs_live_abc" }), syncEnv(dbSync), { id: "pho_1", email: "a@b.c", plan: "free" });
const syncWrites = dbSync.calls.filter((c) => /^\s*UPDATE photographers/.test(c.sql));
check("retour de Stripe : la session relue enregistre formule, essai, place Fondateurs, échéance et rythme annuel",
      synced.status === 200 && stripeCalls[0].includes("expand%5B%5D=subscription") && syncWrites.length === 2 &&
      syncWrites[0].binds.slice(0, 4).join(",") === "essentiel,trialing,cus_9,sub_9" && syncWrites[0].binds[4] === 1 && syncWrites[0].binds[6] === 1 &&
      syncWrites[1].binds[2] === 1792164845 && syncWrites[1].binds[7] === "year",
      syncWrites.map((c) => c.binds.join(",")).join(" | "));

fakeStripe({ "/checkout/sessions/cs_live_autre": { id: "cs_live_autre", mode: "subscription", status: "complete", client_reference_id: "pho_2", subscription: stripeSub } });
const dbOther = fakeDb({ id: "pho_1" });
const stolen = await syncSubscription(syncRequest({ sessionId: "cs_live_autre" }), syncEnv(dbOther), { id: "pho_1", email: "a@b.c", plan: "free" });
check("la session de paiement d'un autre photographe est refusée et ne touche à rien",
      stolen.status === 403 && !dbOther.calls.some((c) => /UPDATE/.test(c.sql)));

stripeCalls.length = 0;
fakeStripe({ "/subscriptions/search": { data: [{ ...stripeSub, id: "sub_old", status: "canceled", created: 1 }, stripeSub] } });
const dbSearch = fakeDb({ id: "pho_1", plan: "free" });
await syncSubscription(syncRequest({}), syncEnv(dbSearch), { id: "pho_1", email: "a@b.c", plan: "free" });
const searchWrites = dbSearch.calls.filter((c) => /^\s*UPDATE photographers/.test(c.sql));
check("sans session : l'abonnement en cours est retrouvé par sa métadonnée (les résiliés sont ignorés), essai et Fondateurs déduits",
      decodeURIComponent(stripeCalls[0]).includes("metadata['photographer_id']:'pho_1'") && searchWrites.length === 2 &&
      searchWrites[0].binds.slice(0, 4).join(",") === "essentiel,trialing,cus_9,sub_9" && searchWrites[0].binds[4] === 1 && searchWrites[0].binds[6] === 1,
      searchWrites.map((c) => c.binds.join(",")).join(" | "));

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
