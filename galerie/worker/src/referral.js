// Parrainage entre photographes : une carte de fidélité pour le parrain.
//
// Chaque photographe a un code (son lien de parrainage). Un nouveau compte
// créé avec ce lien devient son filleul. Rien n'est gagné à l'inscription :
// tout se déclenche au PREMIER PAIEMENT du filleul (abonnement passé à
// « active », après l'essai gratuit le cas échéant), ce qui écarte les
// comptes créés pour la forme.
//
//   - le filleul : −50 % sur le mois qui suit (crédit égal à la moitié d'un
//     mois de sa formule, déduit de sa prochaine facture) ;
//   - le parrain : une case de sa carte ; trois cases = un mois offert
//     (crédit d'un mois de sa formule), deux mois offerts au plus sur
//     douze mois glissants. Une carte remplie au-delà attend la fin du
//     délai, puis est créditée toute seule (passe quotidienne).
//
// Les crédits passent par le solde client Stripe du compte plateforme
// (customer balance) : Stripe les déduit de la facture suivante, quelle que
// soit la remise déjà appliquée (offre Fondateurs comprise). Un parrain
// sans abonnement payant garde ses mois offerts en attente : ils sont
// crédités dès qu'il s'abonne.

import { json, fail } from "./http.js";
import { randomBytes } from "./auth.js";
import { PLANS, planFor, isOwner } from "./subscription.js";
import { creditCustomerBalance } from "./stripe.js";

export const STAMPS_PER_CARD = 3;
export const MAX_FREE_MONTHS_PER_YEAR = 2;
export const FILLEUL_DISCOUNT_PERCENT = 50;
const YEAR_SECONDS = 365 * 24 * 60 * 60;
// Sans 0/O ni 1/I/L : un code se dicte et se recopie sans erreur.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function now() {
  return Math.floor(Date.now() / 1000);
}

export function newReferralCode() {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

// Code tapé ou reçu dans un lien : majuscules, sans espaces ni tirets.
export function normalizeCode(raw) {
  const code = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return code.length >= 6 && code.length <= 12 ? code : "";
}

// Ce que coûte un mois de sa formule à ce photographe : le prix mensuel
// (Fondateurs compris la première année), ou, en annuel, le prix mensuel
// normal de la formule.
export function monthValueCents(photographer, at = now()) {
  const plan = PLANS[photographer?.plan];
  if (!plan || !plan.priceCents) return 0;
  if (photographer.plan_interval === "year") return plan.priceCents;
  const founder = photographer.founder_at && at < photographer.founder_at + YEAR_SECONDS;
  return founder && plan.founderCents ? plan.founderCents : plan.priceCents;
}

// La carte du parrain, à partir des filleuls payants et des mois offerts
// déjà enregistrés (fonction pure).
export function cardState(convertedCount, rewards, at = now()) {
  const earned = Math.floor(convertedCount / STAMPS_PER_CARD);
  const granted = rewards.filter((r) => r.status === "granted");
  const recent = granted.filter((r) => r.granted_at > at - YEAR_SECONDS).sort((a, b) => a.granted_at - b.granted_at);
  const waiting = rewards.filter((r) => r.status === "waiting").length;
  const room = Math.max(0, MAX_FREE_MONTHS_PER_YEAR - recent.length);
  return {
    stamps: convertedCount % STAMPS_PER_CARD,
    perCard: STAMPS_PER_CARD,
    earned,
    granted: granted.length,
    grantedThisYear: recent.length,
    waiting,
    room,
    // Plafond atteint : date à laquelle un nouveau mois pourra être offert.
    nextFreeAt: room === 0 && recent.length ? recent[0].granted_at + YEAR_SECONDS : null,
  };
}

async function photographerRow(env, id) {
  return env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(id).first();
}

async function ensureCode(env, photographer) {
  if (photographer.referral_code) return photographer.referral_code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newReferralCode();
    const result = await env.DB.prepare("UPDATE photographers SET referral_code = ? WHERE id = ? AND referral_code = ''")
      .bind(code, photographer.id)
      .run()
      .catch(() => null); // code déjà pris (index unique) : on en tire un autre
    if (result?.meta?.changes) return code;
    const fresh = await photographerRow(env, photographer.id);
    if (fresh?.referral_code) return fresh.referral_code;
  }
  throw new Error("Impossible de créer un code de parrainage");
}

// Parrain d'un code, pour l'écran d'inscription (studio affiché).
export async function referrerForCode(env, rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  return env.DB.prepare("SELECT id, studio_name, first_name FROM photographers WHERE referral_code = ?").bind(code).first();
}

// GET /api/public/referral/<code> — le nom du studio qui parraine.
export async function publicReferral(env, rawCode) {
  const parrain = await referrerForCode(env, rawCode);
  if (!parrain) return fail(404, "Code de parrainage inconnu");
  return json({ studio: parrain.studio_name || parrain.first_name || "Un photographe Holypixx", discountPercent: FILLEUL_DISCOUNT_PERCENT });
}

// À l'inscription : relie le nouveau compte à son parrain. Un code inconnu
// est simplement ignoré (l'inscription n'échoue jamais pour ça).
export async function recordReferral(env, filleulId, rawCode) {
  const parrain = await referrerForCode(env, rawCode);
  if (!parrain || parrain.id === filleulId) return false;
  await env.DB.prepare("INSERT OR IGNORE INTO referrals (filleul_id, parrain_id, created_at) VALUES (?, ?, ?)")
    .bind(filleulId, parrain.id, now())
    .run();
  return true;
}

// Crée les mois offerts gagnés, puis crédite ceux que le plafond et
// l'abonnement du parrain permettent. Rien n'est crédité deux fois : chaque
// mois offert a sa ligne, et sa clé d'idempotence chez Stripe.
export async function settleRewards(env, parrainId, at = now()) {
  const converted = await env.DB.prepare("SELECT COUNT(*) AS n FROM referrals WHERE parrain_id = ? AND converted_at IS NOT NULL")
    .bind(parrainId)
    .first();
  const earned = Math.floor((converted?.n || 0) / STAMPS_PER_CARD);
  const { results: existing } = await env.DB.prepare("SELECT * FROM referral_rewards WHERE parrain_id = ? ORDER BY card ASC")
    .bind(parrainId)
    .all();
  for (let card = existing.length + 1; card <= earned; card++) {
    await env.DB.prepare("INSERT OR IGNORE INTO referral_rewards (parrain_id, card, status, created_at) VALUES (?, ?, 'waiting', ?)")
      .bind(parrainId, card, at)
      .run();
  }
  const { results: rewards } = await env.DB.prepare("SELECT * FROM referral_rewards WHERE parrain_id = ? ORDER BY card ASC")
    .bind(parrainId)
    .all();
  const state = cardState(converted?.n || 0, rewards, at);
  const waiting = rewards.filter((r) => r.status === "waiting");
  if (!waiting.length || !state.room) return state;

  const parrain = await photographerRow(env, parrainId);
  // Mois offert = un mois d'abonnement : il faut un abonnement payant.
  const plan = parrain ? planFor(env, parrain) : null;
  if (!parrain || isOwner(env, parrain) || !plan?.priceCents || !parrain.stripe_customer_id) return state;
  const amount = monthValueCents(parrain, at);
  if (!amount) return state;

  for (const reward of waiting.slice(0, state.room)) {
    const credit = await creditCustomerBalance(env, parrain.stripe_customer_id, {
      amountCents: amount,
      description: `Parrainage Holypixx : un mois offert (carte n° ${reward.card})`,
      idempotencyKey: `parrainage-${parrainId}-carte-${reward.card}`,
    });
    await env.DB.prepare("UPDATE referral_rewards SET status = 'granted', granted_at = ?, amount_cents = ?, stripe_txn_id = ? WHERE parrain_id = ? AND card = ?")
      .bind(at, amount, credit?.id || "", parrainId, reward.card)
      .run();
  }
  return settleRewardsState(env, parrainId, at);
}

async function settleRewardsState(env, parrainId, at) {
  const converted = await env.DB.prepare("SELECT COUNT(*) AS n FROM referrals WHERE parrain_id = ? AND converted_at IS NOT NULL").bind(parrainId).first();
  const { results: rewards } = await env.DB.prepare("SELECT * FROM referral_rewards WHERE parrain_id = ?").bind(parrainId).all();
  return cardState(converted?.n || 0, rewards, at);
}

// −50 % du filleul : la moitié d'un mois de sa formule, sur son solde
// Stripe. Un échec (Stripe indisponible) est réessayé par la passe
// quotidienne ; la clé d'idempotence évite tout double crédit.
async function creditFilleul(env, filleul, at) {
  const amount = Math.round(monthValueCents(filleul, at) * FILLEUL_DISCOUNT_PERCENT / 100);
  if (!amount || !filleul.stripe_customer_id) return false;
  try {
    const credit = await creditCustomerBalance(env, filleul.stripe_customer_id, {
      amountCents: amount,
      description: "Parrainage Holypixx : −50 % sur votre mois suivant",
      idempotencyKey: `parrainage-filleul-${filleul.id}`,
    });
    await env.DB.prepare("UPDATE referrals SET filleul_credit_cents = ?, filleul_txn_id = ? WHERE filleul_id = ?")
      .bind(amount, credit?.id || "credit", filleul.id)
      .run();
    return true;
  } catch (err) {
    console.error("Parrainage : crédit du filleul impossible :", err && err.message ? err.message : err);
    return false;
  }
}

// Premier paiement d'un filleul (appelé quand son abonnement passe à
// « active ») : −50 % pour lui sur le mois suivant, une case pour son
// parrain. Sans effet la deuxième fois.
export async function convertReferral(env, filleulId, at = now()) {
  const referral = await env.DB.prepare("SELECT * FROM referrals WHERE filleul_id = ? AND converted_at IS NULL").bind(filleulId).first();
  if (!referral) return false;
  const filleul = await photographerRow(env, filleulId);
  if (!filleul || filleul.plan_status !== "active" || !PLANS[filleul.plan]?.priceCents || !filleul.stripe_customer_id) return false;
  const marked = await env.DB.prepare("UPDATE referrals SET converted_at = ? WHERE filleul_id = ? AND converted_at IS NULL")
    .bind(at, filleulId)
    .run();
  if (!marked.meta || marked.meta.changes === 0) return false;

  await creditFilleul(env, filleul, at);
  try {
    await settleRewards(env, referral.parrain_id, at);
  } catch (err) {
    console.error("Parrainage : mois offert du parrain en attente :", err && err.message ? err.message : err);
  }
  return true;
}

// Passe quotidienne : filleuls dont le paiement a été vu sans conversion
// (webhook manqué), crédits de filleuls à réessayer, mois offerts en attente (plafond levé, parrain
// désormais abonné, crédit Stripe à réessayer).
export async function runReferralRewards(env) {
  const { results: pendingFilleuls } = await env.DB.prepare(
    `SELECT r.filleul_id FROM referrals r JOIN photographers p ON p.id = r.filleul_id
     WHERE r.converted_at IS NULL AND p.plan_status = 'active' AND p.stripe_customer_id != ''`
  ).all();
  for (const row of pendingFilleuls) await convertReferral(env, row.filleul_id).catch(() => false);
  // Crédits de filleuls refusés par Stripe au moment de la conversion.
  const { results: uncredited } = await env.DB.prepare(
    `SELECT p.* FROM referrals r JOIN photographers p ON p.id = r.filleul_id
     WHERE r.converted_at IS NOT NULL AND r.filleul_txn_id = '' AND r.converted_at > ?`
  ).bind(now() - 90 * 24 * 60 * 60).all();
  for (const filleul of uncredited) await creditFilleul(env, filleul, now());
  const { results: parrains } = await env.DB.prepare("SELECT DISTINCT parrain_id FROM referral_rewards WHERE status = 'waiting'").all();
  for (const row of parrains) await settleRewards(env, row.parrain_id).catch(() => null);
  return { filleuls: pendingFilleuls.length, parrains: parrains.length };
}

// Onglet Abonnement : le lien, la carte, les filleuls.
export async function referralForAdmin(env, photographer) {
  const code = await ensureCode(env, photographer);
  const site = String(env.PUBLIC_SITE_ORIGIN || "https://www.holypixx.com").replace(/\/+$/, "");
  const { results: filleuls } = await env.DB.prepare(
    `SELECT r.created_at, r.converted_at, p.studio_name, p.first_name
     FROM referrals r JOIN photographers p ON p.id = r.filleul_id
     WHERE r.parrain_id = ? ORDER BY r.created_at DESC LIMIT 50`
  ).bind(photographer.id).all();
  const converted = filleuls.filter((f) => f.converted_at).length;
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM referrals WHERE parrain_id = ? AND converted_at IS NOT NULL").bind(photographer.id).first();
  const { results: rewards } = await env.DB.prepare("SELECT * FROM referral_rewards WHERE parrain_id = ?").bind(photographer.id).all();
  const mine = await env.DB.prepare(
    `SELECT r.converted_at, r.filleul_credit_cents, p.studio_name, p.first_name
     FROM referrals r JOIN photographers p ON p.id = r.parrain_id WHERE r.filleul_id = ?`
  ).bind(photographer.id).first();
  return {
    code,
    link: `${site}/?parrain=${code}`,
    discountPercent: FILLEUL_DISCOUNT_PERCENT,
    maxPerYear: MAX_FREE_MONTHS_PER_YEAR,
    card: cardState(total?.n || converted, rewards),
    filleuls: filleuls.map((f) => ({
      name: f.studio_name || f.first_name || "Un photographe",
      since: f.created_at,
      paid: Boolean(f.converted_at),
    })),
    referredBy: mine
      ? { name: mine.studio_name || mine.first_name || "Un photographe", rewarded: Boolean(mine.converted_at), creditCents: mine.filleul_credit_cents || 0 }
      : null,
  };
}
