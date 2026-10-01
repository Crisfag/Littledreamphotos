// Paiement en ligne des suppléments et facturation — appelé depuis admin.js
// (routes authentifiées, section « stripe »/« billing ») pour la partie
// photographe, et directement depuis index.js pour le webhook Stripe
// (jamais de session applicative : la signature en tient lieu).

import { json, fail } from "./http.js";
import { handlePrintPaymentConfirmed } from "./shop.js";
import { createConnectAccount, createAccountLink, retrieveAccount, verifyStripeSignature } from "./stripe.js";
import { createInvoiceForPayment } from "./invoices.js";
import { sendInvoiceEmail } from "./notify.js";

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
// Deux évènements traités, mais reçus par DEUX destinations Stripe
// distinctes (donc deux clés de signature) : account.updated arrive côté
// « Comptes connectés » (état de l'inscription Connect du photographe,
// STRIPE_WEBHOOK_SECRET), tandis que checkout.session.completed arrive
// côté « Votre compte » (la session de paiement du supplément est une
// charge de destination créée sur la plateforme, voir stripe.js —
// STRIPE_WEBHOOK_SECRET_PLATFORM). On essaie chaque clé configurée tour à
// tour plutôt que de deviner laquelle correspond à l'évènement reçu.
export async function handleStripeWebhook(request, env) {
  if (request.method !== "POST") return fail(405, "Méthode non autorisée");
  const secrets = [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_WEBHOOK_SECRET_PLATFORM].filter(Boolean);
  if (!secrets.length) return fail(503, "Webhook Stripe non configuré");

  const payload = await request.text();
  const signature = request.headers.get("Stripe-Signature");
  let valid = false;
  for (const secret of secrets) {
    if (await verifyStripeSignature(payload, signature, secret)) {
      valid = true;
      break;
    }
  }
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

  if (event.type === "checkout.session.completed") {
    const session = event.data && event.data.object;
    // "paid" est le seul statut qui compte comme réglé : certains moyens de
    // paiement restent "unpaid" un instant après ce même évènement (virement
    // notamment) — mieux vaut attendre leur propre confirmation que de
    // libérer un supplément pas vraiment encaissé.
    if (session && session.id && session.payment_status === "paid") {
      const result = await env.DB.prepare(
        `UPDATE payments SET status = 'paid', paid_at = ?, stripe_payment_intent_id = ?
         WHERE stripe_checkout_session_id = ? AND status != 'paid'`
      )
        .bind(Math.floor(Date.now() / 1000), session.payment_intent || "", session.id)
        .run();

      // meta.changes reste à 0 si ce paiement était déjà "paid" : Stripe
      // redélivre parfois le même évènement, et une facture ne doit jamais
      // être émise deux fois pour le même règlement.
      if (result.meta && result.meta.changes > 0) {
        const payment = await env.DB.prepare("SELECT * FROM payments WHERE stripe_checkout_session_id = ?")
          .bind(session.id)
          .first();
        if (payment?.kind === "print") {
          // Commande de tirages : envoi au labo, facture et e-mails (shop.js).
          await handlePrintPaymentConfirmed(env, payment, new URL(request.url).origin);
        } else {
          await issueInvoice(env, session.id);
        }
      }
    }
  }

  return json({ received: true });
}

// Toujours appelé APRÈS que le paiement soit confirmé "paid" en base — jamais
// avant, pour ne jamais facturer un règlement qui échouerait finalement. Un
// incident ici (génération de PDF, R2, e-mail) est consigné mais ne doit
// jamais faire échouer la réponse au webhook : Stripe réessaierait sinon
// indéfiniment, alors que le paiement lui, est bel et bien confirmé.
async function issueInvoice(env, stripeCheckoutSessionId) {
  try {
    const payment = await env.DB.prepare("SELECT * FROM payments WHERE stripe_checkout_session_id = ?")
      .bind(stripeCheckoutSessionId)
      .first();
    if (!payment) return;
    const gallery = await env.DB.prepare("SELECT * FROM galleries WHERE id = ?").bind(payment.gallery_id).first();
    if (!gallery) return;
    const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?")
      .bind(gallery.photographer_id)
      .first();
    if (!photographer) return;

    const invoice = await createInvoiceForPayment(env, { payment, gallery, photographer });

    // "emailed_to" atteste qu'un envoi a été tenté vers cette adresse, pas
    // qu'il a été livré avec certitude — l'envoi d'e-mail est toujours au
    // mieux dans ce projet (voir notify.js), jamais garanti ni réessayé.
    if (gallery.client_email) {
      await env.DB.prepare("UPDATE invoices SET emailed_to = ? WHERE id = ?")
        .bind(gallery.client_email, invoice.id)
        .run();
      await sendInvoiceEmail(env, {
        to: gallery.client_email,
        galleryTitle: gallery.title,
        number: invoice.number,
        amountCents: payment.amount_cents,
        pdfBytes: invoice.pdfBytes,
      });
    }
  } catch (err) {
    console.error("Échec de la génération de la facture :", err);
  }
}
