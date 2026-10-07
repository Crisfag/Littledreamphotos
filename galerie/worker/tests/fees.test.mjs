// Vérifie les frais de paiement refacturés sur les ventes, sans réseau :
// règle par défaut, réglage par variables, arrondi, plafond, propriétaire
// exemptée, libellé affiché.
//
//   node tests/fees.test.mjs

import { paymentFeeRule, schoolFeeRule, feeCentsFor, paymentFeeCents, feeRuleLabel, DEFAULT_FEE_PERCENT, DEFAULT_FEE_FIXED_CENTS } from "../src/fees.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const env = { OWNER_EMAIL: "proprietaire@test.invalid" };
const photographer = { email: "julie@test.invalid" };
const rule = paymentFeeRule(env, photographer);
check("par défaut : 2 % + 0,30 €", rule.percent === DEFAULT_FEE_PERCENT && rule.fixedCents === DEFAULT_FEE_FIXED_CENTS && rule.percent === 2 && rule.fixedCents === 30);
check("la règle par défaut couvre une carte européenne et le virement (1,5 % + 0,25 € + 0,25 %)",
      [500, 2500, 10000, 50000].every((a) => feeCentsFor(rule, a) >= Math.round(a * 0.0175) + 25));
check("calcul et arrondi au centime", feeCentsFor(rule, 2500) === 80 && feeCentsFor(rule, 4590) === 122 && feeCentsFor(rule, 333) === 37,
      [feeCentsFor(rule, 2500), feeCentsFor(rule, 4590), feeCentsFor(rule, 333)].join(" "));
check("jamais plus que le paiement moins un centime, rien sur un montant nul",
      feeCentsFor(rule, 20) === 19 && feeCentsFor(rule, 0) === 0 && feeCentsFor(rule, -5) === 0);
const tuned = paymentFeeRule({ ...env, PAYMENT_FEE_PERCENT: "1.5", PAYMENT_FEE_FIXED_CENTS: "25" }, photographer);
check("réglable par variables (PAYMENT_FEE_PERCENT, PAYMENT_FEE_FIXED_CENTS)",
      tuned.percent === 1.5 && tuned.fixedCents === 25 && feeCentsFor(tuned, 10000) === 175);
const absurd = paymentFeeRule({ ...env, PAYMENT_FEE_PERCENT: "80", PAYMENT_FEE_FIXED_CENTS: "abc" }, photographer);
check("une valeur absurde ou illisible retombe sur la règle par défaut", absurd.percent === 2 && absurd.fixedCents === 30);
check("zéro est un réglage valide (frais désactivés)",
      paymentFeeCents({ ...env, PAYMENT_FEE_PERCENT: "0", PAYMENT_FEE_FIXED_CENTS: "0" }, photographer, 10000) === 0);
check("la propriétaire de la plateforme ne paie aucun frais",
      paymentFeeCents(env, { email: "proprietaire@test.invalid" }, 10000) === 0);
check("libellé affiché au photographe",
      feeRuleLabel(rule) === "2 % + 0,30 €" && feeRuleLabel(tuned) === "1,5 % + 0,25 €" &&
      feeRuleLabel({ percent: 0, fixedCents: 0 }) === "aucun" && feeRuleLabel({ percent: 0, fixedCents: 50 }) === "0,50 €");

// Ventes scolaires : la formule Scolaire paie 4,5 % (frais bancaires compris),
// Studio garde la règle ordinaire, la propriétaire ne paie rien.
const scolaire = schoolFeeRule(env, { email: "a@test.invalid", plan: "scolaire", plan_status: "active" });
const scolaireOff = schoolFeeRule(env, { email: "a@test.invalid", plan: "scolaire", plan_status: "canceled" });
const studioRule = schoolFeeRule(env, { email: "b@test.invalid", plan: "studio", plan_status: "active" });
check("ventes scolaires : 4,5 % pour Scolaire, règle ordinaire pour Studio, rien pour la propriétaire",
      scolaire.percent === 4.5 && scolaire.fixedCents === 0 && feeCentsFor(scolaire, 7100) === 320 &&
      studioRule.percent === 2 && studioRule.fixedCents === 30 && scolaireOff.percent === 2 &&
      schoolFeeRule(env, { email: "proprietaire@test.invalid", plan: "scolaire", plan_status: "active" }).percent === 0);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
