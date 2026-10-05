// Frais de paiement refacturés au photographe sur chaque vente en ligne
// (suppléments, tirages).
//
// Les paiements clients passent par des CHARGES DE DESTINATION (voir
// stripe.js) : c'est le compte Stripe de la PLATEFORME qui paie les frais
// Stripe (carte, virement vers le photographe, compte Connect actif), pas
// le photographe. Sans refacturation, chaque vente coûterait de l'argent à
// Holypixx. On retient donc, au moment du paiement, un montant forfaitaire
// (`application_fee_amount`) qui couvre ces frais : pas une commission sur
// la vente, seulement le coût du paiement.
//
// Stripe ne permet pas de modifier ce montant après coup : il est fixé à la
// création de la session, sur le total payé, d'après une règle
// « pourcentage + fixe » réglable sans toucher au code (variables
// PAYMENT_FEE_PERCENT et PAYMENT_FEE_FIXED_CENTS de wrangler.toml). Par
// défaut 2 % + 0,30 € : couvre une carte européenne (1,5 % + 0,25 €), le
// virement au photographe (0,25 %) et la part du forfait mensuel par compte
// connecté.
//
// La propriétaire de la plateforme n'en paie pas : ses ventes sont déjà
// celles de la plateforme.

import { isOwner } from "./subscription.js";

export const DEFAULT_FEE_PERCENT = 2;
export const DEFAULT_FEE_FIXED_CENTS = 30;

function parseNumber(value, fallback, { min, max }) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

export function paymentFeeRule(env, photographer) {
  if (photographer && isOwner(env, photographer)) return { percent: 0, fixedCents: 0 };
  return {
    percent: parseNumber(env.PAYMENT_FEE_PERCENT, DEFAULT_FEE_PERCENT, { min: 0, max: 20 }),
    fixedCents: Math.round(parseNumber(env.PAYMENT_FEE_FIXED_CENTS, DEFAULT_FEE_FIXED_CENTS, { min: 0, max: 500 })),
  };
}

// Montant retenu (centimes) sur un paiement de `amountCents`. Jamais plus
// que le paiement lui-même moins un centime : Stripe refuse une retenue
// égale ou supérieure au montant, et le photographe doit toujours recevoir
// quelque chose.
export function feeCentsFor(rule, amountCents) {
  const amount = Math.round(Number(amountCents) || 0);
  if (amount <= 0) return 0;
  if (!rule.percent && !rule.fixedCents) return 0;
  const fee = Math.round((amount * rule.percent) / 100) + rule.fixedCents;
  return Math.max(0, Math.min(fee, amount - 1));
}

export function paymentFeeCents(env, photographer, amountCents) {
  return feeCentsFor(paymentFeeRule(env, photographer), amountCents);
}

// « 2 % + 0,30 € » — pour l'admin et les e-mails.
export function feeRuleLabel(rule) {
  if (!rule.percent && !rule.fixedCents) return "aucun";
  const percent = `${String(rule.percent).replace(".", ",")} %`;
  const fixed = `${(rule.fixedCents / 100).toFixed(2).replace(".", ",")} €`;
  if (!rule.fixedCents) return percent;
  if (!rule.percent) return fixed;
  return `${percent} + ${fixed}`;
}

export function feeRuleForAdmin(env, photographer) {
  const rule = paymentFeeRule(env, photographer);
  return { ...rule, label: feeRuleLabel(rule) };
}
