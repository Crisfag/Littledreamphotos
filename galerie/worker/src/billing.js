// Paiement en ligne des suppléments et facturation — appelé depuis admin.js
// (routes authentifiées, section « stripe »/« billing ») pour la partie
// photographe, et directement depuis index.js pour le webhook Stripe
// (jamais de session applicative : la signature en tient lieu).

import { json, fail } from "./http.js";
import { createConnectAccount, createAccountLink, retrieveAccount, verifyStripeSignature } from "./stripe.js";

function stripeFailure(err) {
  console.error("Échec d'un appel Stripe :", err);
  if (err.stripeNotConfigured) {
    return fail(503, "Le paiement en ligne n'est pas encore configuré sur cette plateforme");
  }
  return fail(502, "Stripe a refusé la demande");
}

// Crée le compte Connect au premier appel (réutilisé ensuite), puis un lien
// d'onboarding à usage unique vers le formulaire hébergé par Stripe. On n'y
// voit jamais les informations d'identité ou le RIB du photographe.
export async function connectStripe(request, env, photographer) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const returnUrl = String(body.returnUrl || "");
  const refreshUrl = String(body.refreshUrl || "");
  if (!returnUrl || !refreshUrl) return fail(400, "URL de retour manquante");

  try {
    let accountId = photographer.stripe_account_id;
    if (!accountId) {
      const account = await createConnectAccount(env, photographer);
      accountId = account.id;
      await env.DB.prepare("UPDATE photographers SET stripe_account_id = ? WHERE id = ?")
        .bind(accountId, photographer.id)
        .run();
    }
    const link = await createAccountLink(env, accountId, { returnUrl, refreshUrl });
    return json({ url: link.url });
  } catch (err) {
    return stripeFailure(err);
  }
}

// Relit l'état réel du compte Stripe — utile juste après le retour
// d'onboarding (le webhook peut mettre quelques secondes à arriver), et en
// secours si le webhook n'est pas joignable (développement local).
export async function refreshStripeStatus(request, env, photographer) {
  if (!photographer.stripe_account_id) {
    return json({ connected: false, chargesEnabled: false });
  }
  try {
    const account = await retrieveAccount(env, photographer.stripe_account_id);
    const chargesEnabled = Boolean(account.charges_enabled);
    await env.DB.prepare("UPDATE photographers SET stripe_charges_enabled = ? WHERE id = ?")
      .bind(chargesEnabled ? 1 : 0, photographer.id)
      .run();
    return json({ connected: true, chargesEnabled });
  } catch (err) {
    return stripeFailure(err);
  }
}

export async function setBillingProfile(request, env, photographer) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const companyName = String(body.companyName || "").trim().slice(0, 200);
  const address = String(body.address || "").trim().slice(0, 500);
  const vatNumber = String(body.vatNumber || "").trim().slice(0, 40);

  await env.DB.prepare(
    `UPDATE photographers
     SET billing_company_name = ?, billing_address = ?, billing_vat_number = ?
     WHERE id = ?`
  )
    .bind(companyName, address, vatNumber, photographer.id)
    .run();

  return json({ ok: true });
}

// Webhook Stripe : pas de session, l'authenticité vient de la signature
// (Stripe-Signature, vérifiée sur le corps brut — jamais reparsé avant).
// account.updated est le seul évènement traité pour l'instant (étape 1 :
// suivre l'état de l'inscription Connect) ; les évènements de paiement
// viendront avec la fonctionnalité de règlement des suppléments.
export async function handleStripeWebhook(request, env) {
  if (request.method !== "POST") return fail(405, "Méthode non autorisée");
  if (!env.STRIPE_WEBHOOK_SECRET) return fail(503, "Webhook Stripe non configuré");

  const payload = await request.text();
  const signature = request.headers.get("Stripe-Signature");
  const valid = await verifyStripeSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return fail(400, "Signature invalide");

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return fail(400, "Charge utile illisible");
  }

  if (event.type === "account.updated") {
    const account = event.data && event.data.object;
    if (account && account.id) {
      await env.DB.prepare("UPDATE photographers SET stripe_charges_enabled = ? WHERE stripe_account_id = ?")
        .bind(account.charges_enabled ? 1 : 0, account.id)
        .run();
    }
  }

  return json({ received: true });
}
