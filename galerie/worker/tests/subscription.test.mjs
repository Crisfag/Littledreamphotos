// Vérifie la logique des abonnements sans réseau ni D1 : formule effective,
// fonctionnalités, et traitement des évènements Stripe (sur une base
// factice qui enregistre les requêtes).
//
//   node tests/subscription.test.mjs

import { PLANS, planFor, hasFeature, planKeyFromSubscription, handleSubscriptionEvent } from "../src/subscription.js";

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

// Base factice : garde la dernière requête préparée et ses valeurs.
function fakeDb(row) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, binds: [] };
      calls.push(call);
      return {
        bind(...binds) {
          call.binds = binds;
          return { run: async () => ({ meta: { changes: 1 } }), first: async () => row };
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
      handledCheckout === true && /UPDATE photographers SET plan = \?/.test(db1.calls[0].sql) && db1.calls[0].binds.join(",") === "pro,cus_1,sub_1,pho_1");
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

const db4 = fakeDb({ id: "pho_1", stripe_subscription_id: "sub_1" });
await handleSubscriptionEvent({ DB: db4 }, { type: "customer.subscription.deleted", data: { object: { id: "sub_1", customer: "cus_1", status: "canceled" } } });
check("abonnement résilié : retour au gratuit", db4.calls[1].binds.slice(0, 2).join(",") === "free,canceled" && db4.calls[1].binds[4] === "");
const db5 = fakeDb({ id: "pho_1", stripe_subscription_id: "sub_2" });
await handleSubscriptionEvent({ DB: db5 }, { type: "customer.subscription.deleted", data: { object: { id: "sub_1", customer: "cus_1" } } });
check("la fin d'un ancien abonnement n'écrase pas un abonnement plus récent", db5.calls.length === 1);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
