// Vérifie la signature des webhooks Stripe — pur, sans réseau ni wrangler dev.
//
//   node tests/stripe.test.mjs

import { createHmac } from "node:crypto";
import { verifyStripeSignature } from "../src/stripe.js";

const SECRET = "whsec_test_secret";
const PAYLOAD = JSON.stringify({ id: "evt_test", type: "account.updated", data: { object: { id: "acct_123", charges_enabled: true } } });

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

function header(timestamp, secret, payload) {
  const signed = `${timestamp}.${payload}`;
  const signature = createHmac("sha256", secret).update(signed).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

const now = Math.floor(Date.now() / 1000);

check("une signature valide est acceptée",
      await verifyStripeSignature(PAYLOAD, header(now, SECRET, PAYLOAD), SECRET));

check("une signature calculée avec le mauvais secret est refusée",
      !(await verifyStripeSignature(PAYLOAD, header(now, "whsec_autre_secret", PAYLOAD), SECRET)));

check("un corps modifié après signature est refusé",
      !(await verifyStripeSignature(PAYLOAD + " ", header(now, SECRET, PAYLOAD), SECRET)));

check("un évènement trop ancien (rejeu) est refusé",
      !(await verifyStripeSignature(PAYLOAD, header(now - 3600, SECRET, PAYLOAD), SECRET)));

check("l'absence d'en-tête est refusée sans lever d'exception",
      !(await verifyStripeSignature(PAYLOAD, null, SECRET)));

check("l'absence de secret configuré est refusée sans lever d'exception",
      !(await verifyStripeSignature(PAYLOAD, header(now, SECRET, PAYLOAD), "")));

check("un en-tête malformé est refusé sans lever d'exception",
      !(await verifyStripeSignature(PAYLOAD, "n'importe-quoi", SECRET)));

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
