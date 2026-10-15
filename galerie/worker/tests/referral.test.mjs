// Vérifie le parrainage sans réseau : codes, valeur d'un mois, carte de
// fidélité (3 cases = 1 mois offert, 2 au plus sur douze mois), puis le
// parcours complet sur une vraie base SQLite (schema.sql) avec un faux Stripe :
// inscription avec un code, premier paiement du filleul, crédits, plafond,
// mois offerts en attente.
//
//   node tests/referral.test.mjs

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  newReferralCode, normalizeCode, monthValueCents, cardState, recordReferral, convertReferral,
  settleRewards, runReferralRewards, referralForAdmin, STAMPS_PER_CARD, MAX_FREE_MONTHS_PER_YEAR,
} from "../src/referral.js";
import { handleSubscriptionEvent } from "../src/subscription.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}
const DAY = 86400;
const YEAR = 365 * DAY;

/* ---------- Fonctions pures ---------- */

const codes = new Set(Array.from({ length: 200 }, newReferralCode));
check("codes de 8 caractères, sans caractères ambigus, tous différents",
      [...codes].every((c) => /^[A-HJ-NP-Z2-9]{8}$/.test(c) && !/[01OIL]/.test(c)) && codes.size === 200);
check("code normalisé (minuscules, espaces, tirets) ; trop court ou trop long refusé",
      normalizeCode(" abcd-efgh ") === "ABCDEFGH" && normalizeCode("ab") === "" && normalizeCode("x".repeat(13)) === "");
const t0 = 1_800_000_000;
check("un mois d'Essentiel : 15 € (12 € la 1re année Fondateurs), en annuel le prix mensuel normal",
      monthValueCents({ plan: "essentiel", plan_interval: "month" }, t0) === 1500 &&
      monthValueCents({ plan: "essentiel", plan_interval: "month", founder_at: t0 - DAY }, t0) === 1200 &&
      monthValueCents({ plan: "essentiel", plan_interval: "month", founder_at: t0 - YEAR - DAY }, t0) === 1500 &&
      monthValueCents({ plan: "pro", plan_interval: "year", founder_at: t0 - DAY }, t0) === 2900 &&
      monthValueCents({ plan: "free" }, t0) === 0);
const s1 = cardState(4, [{ status: "granted", granted_at: t0 - 10 * DAY }], t0);
check("carte : 4 filleuls payants = 1 mois gagné et 1 case sur 3", s1.earned === 1 && s1.stamps === 1 && s1.perCard === 3 && s1.room === 1);
const s2 = cardState(9, [
  { status: "granted", granted_at: t0 - 200 * DAY }, { status: "granted", granted_at: t0 - 20 * DAY }, { status: "waiting" },
], t0);
check("plafond : 2 mois offerts sur douze mois, le 3e attend jusqu'à l'anniversaire du plus ancien",
      s2.room === 0 && s2.waiting === 1 && s2.nextFreeAt === t0 - 200 * DAY + YEAR && STAMPS_PER_CARD === 3 && MAX_FREE_MONTHS_PER_YEAR === 2);
check("un mois offert de plus d'un an ne compte plus dans le plafond",
      cardState(6, [{ status: "granted", granted_at: t0 - 400 * DAY }, { status: "granted", granted_at: t0 - 5 * DAY }], t0).room === 1);

/* ---------- Parcours complet : SQLite + faux Stripe ---------- */

// D1 minimal au-dessus de node:sqlite (prepare/bind/first/all/run/batch).
function fakeD1(db) {
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes) } };
    },
  });
  return { prepare: (sql) => statement(sql), batch: async (list) => Promise.all(list.map((s) => s.run())) };
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(":memory:");
db.exec(await readFile(join(root, "schema.sql"), "utf8"));
const env = { DB: fakeD1(db), STRIPE_SECRET_KEY: "sk_test_faux", PUBLIC_SITE_ORIGIN: "https://www.holypixx.com", OWNER_EMAIL: "proprio@exemple.be" };

// Faux Stripe : enregistre les crédits demandés ; peut refuser un client.
const credits = [];
let refuseCustomer = "";
globalThis.fetch = async (url, init) => {
  const m = /\/v1\/customers\/([^/]+)\/balance_transactions$/.exec(String(url));
  if (!m) throw new Error("Appel Stripe inattendu : " + url);
  const customer = decodeURIComponent(m[1]);
  if (customer === refuseCustomer) return { ok: false, status: 400, json: async () => ({ error: { message: "No such customer" } }) };
  const params = new URLSearchParams(init.body);
  credits.push({ customer, amount: Number(params.get("amount")), key: init.headers["Idempotency-Key"], description: params.get("description") });
  return { ok: true, status: 200, json: async () => ({ id: "cbtxn_" + credits.length }) };
};

let n = 0;
function addPhotographer(fields = {}) {
  const id = "ph_" + ++n;
  const row = {
    id, email: `${id}@exemple.be`, password_hash: "x", password_salt: "x", studio_name: fields.studio_name ?? `Studio ${n}`,
    created_at: t0, plan: "free", plan_status: "", plan_interval: "", stripe_customer_id: "", ...fields,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO photographers (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c]));
  return id;
}
const pay = (id, fields) => {
  const sets = Object.keys(fields).map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE photographers SET ${sets} WHERE id = ?`).run(...Object.values(fields), id);
};

const parrain = addPhotographer({ studio_name: "Lumière & Co", plan: "pro", plan_status: "active", plan_interval: "month", stripe_customer_id: "cus_parrain" });
const admin0 = await referralForAdmin(env, db.prepare("SELECT * FROM photographers WHERE id = ?").get(parrain));
const code = admin0.code;
check("le code est créé au premier affichage, avec le lien à partager",
      /^[A-Z2-9]{8}$/.test(code) && admin0.link === `https://www.holypixx.com/?parrain=${code}` && admin0.card.stamps === 0);
const again = await referralForAdmin(env, db.prepare("SELECT * FROM photographers WHERE id = ?").get(parrain));
check("le code ne change plus ensuite", again.code === code);

const f1 = addPhotographer({ studio_name: "Atelier Rose" });
check("inscription avec le code (en minuscules) : filleul enregistré", await recordReferral(env, f1, code.toLowerCase()));
check("un code inconnu est ignoré, sans erreur", (await recordReferral(env, addPhotographer(), "ZZZZZZZZ")) === false);
check("on ne peut pas se parrainer soi-même", (await recordReferral(env, parrain, code)) === false);

// Essai en cours : rien n'est gagné.
pay(f1, { plan: "essentiel", plan_status: "trialing", plan_interval: "month", stripe_customer_id: "cus_f1" });
check("pendant l'essai gratuit du filleul, rien n'est crédité", (await convertReferral(env, f1, t0)) === false && credits.length === 0);

// Premier paiement : −50 % pour le filleul (Essentiel mensuel : 7,50 €).
pay(f1, { plan_status: "active" });
check("premier paiement du filleul : crédit de 7,50 € (moitié d'un mois d'Essentiel)",
      (await convertReferral(env, f1, t0)) && credits.length === 1 && credits[0].customer === "cus_f1" && credits[0].amount === -750 &&
      credits[0].key === `parrainage-filleul-${f1}`, JSON.stringify(credits[0]));
check("une seconde conversion ne crédite rien de plus", (await convertReferral(env, f1, t0)) === false && credits.length === 1);

// Deux autres filleuls payants, dont un annuel Fondateurs : la carte se remplit.
async function newFilleul(fields, at) {
  const id = addPhotographer();
  await recordReferral(env, id, code);
  pay(id, { plan_status: "active", stripe_customer_id: "cus_" + id, ...fields });
  await convertReferral(env, id, at);
  return id;
}
const f2 = await newFilleul({ plan: "pro", plan_interval: "year", founder_at: t0 }, t0 + DAY);
check("filleul Pro annuel : crédit de 14,50 € (moitié du prix mensuel normal)", credits.at(-1).amount === -1450, credits.at(-1).amount);
await newFilleul({ plan: "essentiel", plan_interval: "month", founder_at: t0 }, t0 + 2 * DAY);
check("filleul Essentiel Fondateurs : crédit de 6 € (moitié de 12 €)", credits.at(-2).amount === -600, credits.at(-2)?.amount);
const parrainCredit = credits.at(-1);
check("3e filleul payant : un mois offert au parrain (29 €, un mois de Pro)",
      parrainCredit.customer === "cus_parrain" && parrainCredit.amount === -2900 && parrainCredit.key === `parrainage-${parrain}-carte-1`, JSON.stringify(parrainCredit));
let card = (await referralForAdmin(env, db.prepare("SELECT * FROM photographers WHERE id = ?").get(parrain))).card;
check("la carte repart à zéro, 1 mois offert compté", card.stamps === 0 && card.granted === 1 && card.grantedThisYear === 1 && card.room === 1);

// Trois de plus : 2e mois offert ; trois encore : plafond atteint, en attente.
for (let i = 0; i < 3; i++) await newFilleul({ plan: "essentiel", plan_interval: "month" }, t0 + 30 * DAY);
const before = credits.length;
for (let i = 0; i < 3; i++) await newFilleul({ plan: "essentiel", plan_interval: "month" }, t0 + 60 * DAY);
card = cardState(9, (await env.DB.prepare("SELECT * FROM referral_rewards WHERE parrain_id = ?").bind(parrain).all()).results, t0 + 60 * DAY);
const parrainCredits = credits.filter((c) => c.customer === "cus_parrain");
check("2 mois offerts sur douze mois, le 3e attend (plafond)",
      parrainCredits.length === 2 && card.waiting === 1 && card.room === 0 && card.nextFreeAt === t0 + 2 * DAY + YEAR && credits.length === before + 3,
      `${parrainCredits.length} crédits parrain, ${card.waiting} en attente`);
await settleRewards(env, parrain, t0 + 2 * DAY + YEAR - DAY);
check("la veille de la date, toujours en attente", credits.filter((c) => c.customer === "cus_parrain").length === 2);
await settleRewards(env, parrain, t0 + 2 * DAY + YEAR + 1);
check("un an après le 1er mois offert, le 3e est crédité tout seul",
      credits.filter((c) => c.customer === "cus_parrain").length === 3 && credits.at(-1).key === `parrainage-${parrain}-carte-3`);

// Parrain sans abonnement : ses mois offerts attendent qu'il s'abonne.
const p2 = addPhotographer({ studio_name: "Petit Studio" });
const code2 = (await referralForAdmin(env, db.prepare("SELECT * FROM photographers WHERE id = ?").get(p2))).code;
for (let i = 0; i < 3; i++) {
  const id = addPhotographer();
  await recordReferral(env, id, code2);
  pay(id, { plan: "essentiel", plan_status: "active", plan_interval: "month", stripe_customer_id: "cus_x" + id });
  await convertReferral(env, id, t0);
}
const waitingP2 = (await env.DB.prepare("SELECT status FROM referral_rewards WHERE parrain_id = ?").bind(p2).all()).results;
check("parrain sans abonnement : le mois offert attend", waitingP2.length === 1 && waitingP2[0].status === "waiting" &&
      !credits.some((c) => c.key === `parrainage-${p2}-carte-1`));
// Il s'abonne (webhook) : le mois offert est crédité.
pay(p2, { stripe_customer_id: "cus_p2" });
await handleSubscriptionEvent(env, { type: "customer.subscription.updated", data: { object: {
  id: "sub_p2", customer: "cus_p2", status: "trialing", metadata: { photographer_id: p2, plan: "essentiel" },
  items: { data: [{ price: { unit_amount: 1500, recurring: { interval: "month" } } }] },
} } });
check("dès qu'il s'abonne, son mois offert est crédité (15 €, Essentiel)",
      credits.some((c) => c.key === `parrainage-${p2}-carte-1` && c.customer === "cus_p2" && c.amount === -1500));

// Le webhook du premier paiement déclenche la conversion ; un échec Stripe
// ne bloque pas la case du parrain.
const p3 = addPhotographer({ plan: "essentiel", plan_status: "active", plan_interval: "month", stripe_customer_id: "cus_p3" });
const code3 = (await referralForAdmin(env, db.prepare("SELECT * FROM photographers WHERE id = ?").get(p3))).code;
const f9 = addPhotographer();
await recordReferral(env, f9, code3);
pay(f9, { stripe_customer_id: "cus_f9" });
refuseCustomer = "cus_f9";
await handleSubscriptionEvent(env, { type: "customer.subscription.updated", data: { object: {
  id: "sub_f9", customer: "cus_f9", status: "active", metadata: { photographer_id: f9, plan: "pro" },
  items: { data: [{ price: { unit_amount: 2900, recurring: { interval: "month" } } }] },
} } });
refuseCustomer = "";
const r9 = db.prepare("SELECT converted_at, filleul_credit_cents FROM referrals WHERE filleul_id = ?").get(f9);
check("webhook « active » : filleul converti même si Stripe refuse son crédit (journalisé)", Boolean(r9.converted_at) && r9.filleul_credit_cents === 0);

// Passe quotidienne : rattrape un filleul payant dont la conversion a été manquée.
const f10 = addPhotographer();
await recordReferral(env, f10, code3);
pay(f10, { plan: "essentiel", plan_status: "active", plan_interval: "month", stripe_customer_id: "cus_f10" });
const pass = await runReferralRewards(env);
check("passe quotidienne : conversion manquée rattrapée", pass.filleuls >= 1 &&
      Boolean(db.prepare("SELECT converted_at FROM referrals WHERE filleul_id = ?").get(f10).converted_at));
check("passe quotidienne : le crédit refusé du filleul est réessayé (14,50 €, Pro)",
      db.prepare("SELECT filleul_credit_cents FROM referrals WHERE filleul_id = ?").get(f9).filleul_credit_cents === 1450 &&
      credits.filter((c) => c.key === `parrainage-filleul-${f9}`).length === 1);

const view = await referralForAdmin(env, db.prepare("SELECT * FROM photographers WHERE id = ?").get(f1));
check("le filleul voit son parrain et son crédit", view.referredBy && view.referredBy.name === "Lumière & Co" && view.referredBy.rewarded && view.referredBy.creditCents === 750);
const parrainView = await referralForAdmin(env, db.prepare("SELECT * FROM photographers WHERE id = ?").get(parrain));
check("le parrain voit ses filleuls (studio, abonné ou non)", parrainView.filleuls.length === 9 && parrainView.filleuls.every((f) => f.paid) &&
      parrainView.filleuls.some((f) => f.name === "Atelier Rose"));

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} vérifications réussies`);
process.exit(failed ? 1 : 0);
