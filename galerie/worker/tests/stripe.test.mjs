// Vérifie la signature des webhooks Stripe — pur, sans réseau ni wrangler dev.
//
//   node tests/stripe.test.mjs

import { createHmac } from "node:crypto";
import { verifyStripeSignature, createCheckoutSession, createConnectAccount } from "../src/stripe.js";

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

/* ---------- Encodage des requêtes Stripe (tableaux et objets imbriqués) ---------- */
// Sans appel réseau : on intercepte fetch pour vérifier ce qui aurait été
// envoyé — c'est là qu'une erreur d'encodage (un tableau mal indexé, par
// exemple) se manifesterait sans jamais lever d'exception JS.

const originalFetch = globalThis.fetch;
let captured = null;
globalThis.fetch = async (url, opts) => {
  captured = { url, ...opts };
  return { ok: true, json: async () => ({ id: "cs_test_123", url: "https://checkout.stripe.com/x" }) };
};

await createCheckoutSession({ STRIPE_SECRET_KEY: "sk_test_fake" }, "acct_123", {
  label: "2 photos supplémentaires",
  unitAmountCents: 1500,
  quantity: 2,
  successUrl: "https://example.com/success",
  cancelUrl: "https://example.com/cancel",
  metadata: { gallery_id: "gal_abc" },
});
const body = new URLSearchParams(captured.body);

check("la session de paiement est créée sur le compte du photographe (charge directe)",
      captured.headers["Stripe-Account"] === "acct_123");
check("le tableau line_items est correctement indexé",
      body.get("line_items[0][price_data][currency]") === "eur" &&
      body.get("line_items[0][price_data][unit_amount]") === "1500" &&
      body.get("line_items[0][quantity]") === "2",
      captured.body);
check("les moyens de paiement s'adaptent automatiquement à ce qui est activé",
      body.get("automatic_payment_methods[enabled]") === "true");
check("les métadonnées imbriquées sont bien encodées",
      body.get("metadata[gallery_id]") === "gal_abc");

captured = null;
await createConnectAccount({ STRIPE_SECRET_KEY: "sk_test_fake" }, { email: "test@example.com" });
const accountBody = new URLSearchParams(captured.body);
check("le compte Connect est créé sans en-tête Stripe-Account (c'est la plateforme qui le crée)",
      captured.headers["Stripe-Account"] === undefined);
check("les capacités demandées sont bien encodées",
      accountBody.get("capabilities[card_payments][requested]") === "true" &&
      accountBody.get("capabilities[transfers][requested]") === "true");

globalThis.fetch = originalFetch;

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
