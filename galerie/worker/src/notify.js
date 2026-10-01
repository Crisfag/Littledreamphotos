// Alerte par e-mail au photographe quand une capture d'écran est
// suspectée chez un client, et réinitialisation de mot de passe. Best-effort :
// sans RESEND_API_KEY configurée, ou si Resend est indisponible, on n'envoie
// rien et on ne fait jamais échouer la requête du visiteur pour autant (voir
// viewer.js / authPhotographer.js, toujours appelé via ctx.waitUntil, jamais
// attendu par la réponse HTTP).

const REASON_LABELS = {
  "impr-ecran": "la touche Impr. écran",
  "capture-macos": "un raccourci de capture macOS",
  "absence-breve": "un signal fort de capture d'écran (changement de fenêtre très bref)",
};

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
const ROSE = "#b98a7a";
const ROSE_DEEP = "#9c6f61";
const CREAM = "#f7f2ec";
const INK = "#2b2521";
const CHARCOAL = "#3a332e";
const MUTED = "#7c716a";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatWhen(ts) {
  return new Date(ts * 1000).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
}

// Bouton à base de tableau plutôt qu'un simple lien : c'est la façon la plus
// fiable d'obtenir un vrai bouton (fond, coins arrondis) qui survive aux
// clients mail les plus capricieux (Outlook compris), sans dépendance CSS externe.
function emailButton(url, label) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 0;">
      <tr>
        <td style="border-radius:999px;background:${ROSE};">
          <a href="${escapeHtml(url)}"
             style="display:inline-block;padding:14px 30px;font-family:${SANS};font-size:14px;
                    font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>
  `.trim();
}

// Emballage commun : en-tête avec la marque, carte blanche pour le contenu,
// pied de page. `bodyHtml` est déjà échappé par l'appelant — cette fonction
// ne fait que le positionner.
function emailShell({ preheader, bodyHtml }) {
  return `
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
  </head>
  <body style="margin:0;padding:0;background:${CREAM};">
    <span style="display:none;max-height:0;overflow:hidden;font-size:1px;color:${CREAM};">${escapeHtml(preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
            <tr>
              <td style="padding-bottom:22px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:34px;height:34px;background:${ROSE};border-radius:8px;text-align:center;">
                      <span style="display:inline-block;line-height:34px;color:#ffffff;font-family:${SERIF};font-size:18px;font-weight:700;">H</span>
                    </td>
                    <td style="padding-left:10px;font-family:${SERIF};font-size:18px;font-weight:700;color:${INK};">
                      Holypixx
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border-radius:16px;padding:34px 30px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding-top:22px;text-align:center;">
                <p style="margin:0;font-family:${SANS};font-size:12px;color:${MUTED};">
                  Holypixx — galeries protégées pour photographes
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();
}

function eyebrow(text) {
  return `<p style="margin:0 0 6px;font-family:${SANS};font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${ROSE_DEEP};font-weight:700;">${escapeHtml(text)}</p>`;
}

function heading(text) {
  return `<h1 style="margin:0 0 18px;font-family:${SERIF};font-size:22px;font-weight:700;color:${INK};line-height:1.3;">${text}</h1>`;
}

function paragraph(html, opts) {
  const small = opts && opts.small;
  return `<p style="margin:0 0 14px;font-family:${SANS};font-size:${small ? "13px" : "15px"};line-height:1.6;color:${small ? MUTED : CHARCOAL};">${html}</p>`;
}

// Fonction pure (pas d'accès réseau) : facile à tester unitairement.
export function buildCaptureAlertEmail({ studioName, galleryTitle, clientName, photoLabel, reason, ts, adminUrl }) {
  const reasonLabel = REASON_LABELS[reason] || "une capture d'écran";
  const subject = `Capture suspectée sur « ${galleryTitle} »`;
  const photoLine = photoLabel
    ? `<strong>${escapeHtml(photoLabel)}</strong> était affichée à ce moment-là.`
    : "Aucune photo précise n'a pu être identifiée (capture depuis la vue d'ensemble).";

  const bodyHtml = [
    eyebrow("Alerte de capture"),
    heading(`Capture suspectée sur « ${escapeHtml(galleryTitle)} »`),
    paragraph(`Bonjour${studioName ? " " + escapeHtml(studioName) : ""},`),
    paragraph(
      `Un visiteur de votre galerie <strong>${escapeHtml(galleryTitle)}</strong>` +
        `${clientName ? " (" + escapeHtml(clientName) + ")" : ""} a déclenché ${reasonLabel} le ${escapeHtml(formatWhen(ts))}.`
    ),
    paragraph(photoLine),
    paragraph(
      "Il ne s'agit jamais d'une certitude absolue — seulement d'un signal fort, consigné dans le journal d'accès de cette galerie.",
      { small: true }
    ),
    adminUrl ? emailButton(adminUrl, "Ouvrir mon tableau de bord") : "",
  ].join("\n");

  const html = emailShell({ preheader: `Capture suspectée sur ${galleryTitle}`, bodyHtml });

  const text =
    `Un visiteur de votre galerie "${galleryTitle}"${clientName ? " (" + clientName + ")" : ""} ` +
    `a déclenché ${reasonLabel} le ${formatWhen(ts)}. ` +
    (photoLabel ? `Photo concernée : ${photoLabel}.` : "Photo non identifiée (vue d'ensemble).") +
    (adminUrl ? ` Tableau de bord : ${adminUrl}` : "");

  return { subject, html, text };
}

// Fonction pure : facile à tester unitairement, sans accès réseau.
export function buildPasswordResetEmail({ studioName, resetUrl, ts }) {
  const subject = "Réinitialisation de votre mot de passe Holypixx";

  const bodyHtml = [
    eyebrow("Sécurité du compte"),
    heading("Réinitialiser votre mot de passe"),
    paragraph(`Bonjour${studioName ? " " + escapeHtml(studioName) : ""},`),
    paragraph(`Une réinitialisation de mot de passe a été demandée pour votre compte Holypixx le ${escapeHtml(formatWhen(ts))}.`),
    emailButton(resetUrl, "Choisir un nouveau mot de passe"),
    `<div style="height:20px;"></div>`,
    paragraph(
      "Ce lien n'est valable qu'une demi-heure et ne fonctionne qu'une seule fois. Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail : votre mot de passe actuel reste inchangé.",
      { small: true }
    ),
  ].join("\n");

  const html = emailShell({ preheader: "Choisissez un nouveau mot de passe pour votre compte Holypixx", bodyHtml });

  const text =
    `Une réinitialisation de mot de passe a été demandée pour votre compte Holypixx le ${formatWhen(ts)}. ` +
    `Choisissez un nouveau mot de passe : ${resetUrl} ` +
    `Ce lien n'est valable qu'une demi-heure et ne fonctionne qu'une seule fois. ` +
    "Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail.";

  return { subject, html, text };
}

// Fonction pure : facile à tester unitairement, sans accès réseau.
export function buildEmailChangeConfirmationEmail({ studioName, confirmUrl, ts }) {
  const subject = "Confirmez votre nouvelle adresse e-mail Holypixx";

  const bodyHtml = [
    eyebrow("Sécurité du compte"),
    heading("Confirmer votre nouvelle adresse"),
    paragraph(`Bonjour${studioName ? " " + escapeHtml(studioName) : ""},`),
    paragraph(`Un changement d'adresse e-mail a été demandé pour votre compte Holypixx le ${escapeHtml(formatWhen(ts))}. Cette adresse-ci deviendra votre identifiant de connexion dès confirmation.`),
    emailButton(confirmUrl, "Confirmer cette adresse"),
    `<div style="height:20px;"></div>`,
    paragraph(
      "Ce lien n'est valable qu'une demi-heure et ne fonctionne qu'une seule fois. Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail : rien ne change tant que ce lien n'est pas ouvert.",
      { small: true }
    ),
  ].join("\n");

  const html = emailShell({ preheader: "Confirmez votre nouvelle adresse e-mail Holypixx", bodyHtml });

  const text =
    `Un changement d'adresse e-mail a été demandé pour votre compte Holypixx le ${formatWhen(ts)}. ` +
    `Confirmez cette adresse : ${confirmUrl} ` +
    `Ce lien n'est valable qu'une demi-heure et ne fonctionne qu'une seule fois. ` +
    "Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail.";

  return { subject, html, text };
}

function formatEuros(cents) {
  return ((cents || 0) / 100).toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

// Fonction pure : facile à tester unitairement, sans accès réseau.
export function buildInvoiceEmail({ galleryTitle, number, amountCents }) {
  const subject = `Votre facture ${number} — ${galleryTitle}`;

  const bodyHtml = [
    eyebrow("Facture"),
    heading(`Facture ${escapeHtml(number)}`),
    paragraph(
      `Merci pour votre règlement de <strong>${formatEuros(amountCents)}</strong> ` +
        `concernant « ${escapeHtml(galleryTitle)} ».`
    ),
    paragraph("Vous trouverez votre facture en pièce jointe de cet e-mail (PDF).", { small: true }),
  ].join("\n");

  const html = emailShell({ preheader: `Facture ${number} — ${galleryTitle}`, bodyHtml });

  const text =
    `Merci pour votre règlement de ${formatEuros(amountCents)} concernant "${galleryTitle}". ` +
    `Facture ${number} en pièce jointe.`;

  return { subject, html, text };
}

// Encodage base64 par blocs : `String.fromCharCode(...bytes)` déborderait la
// pile d'appels sur un fichier de plusieurs dizaines de Ko (peu probable ici,
// une facture d'une page, mais autant rester correct dans tous les cas).
function daysLabel(daysLeft) {
  if (daysLeft <= 1) return "demain";
  return `dans ${daysLeft} jours`;
}

// Relance au client : sa galerie expire bientôt et il n'a pas encore validé
// sa sélection. Fonction pure, testée sans réseau.
export function buildClientReminderEmail({ studioName, galleryTitle, clientName, daysLeft, selectedCount, galleryUrl }) {
  const when = daysLabel(daysLeft);
  const subject = `Votre galerie « ${galleryTitle} » se ferme ${when}`;
  const selectionLine = selectedCount > 0
    ? `Vous avez déjà ${selectedCount} coup${selectedCount > 1 ? "s" : ""} de cœur — il ne reste qu'à confirmer votre choix avec le bouton « Valider ma sélection » en haut de la galerie.`
    : "Vous n'avez pas encore choisi de photos : prenez un moment pour les parcourir et cocher vos coups de cœur, puis confirmez avec le bouton « Valider ma sélection ».";
  const bodyHtml =
    eyebrow(studioName || "Votre galerie") +
    heading(`Votre galerie se ferme ${escapeHtml(when)}`) +
    paragraph(`${clientName ? escapeHtml(clientName) + ", v" : "V"}os photos de « <strong>${escapeHtml(galleryTitle)}</strong> » restent visibles ${escapeHtml(when)}.`) +
    paragraph(escapeHtml(selectionLine)) +
    (galleryUrl ? emailButton(galleryUrl, "Revoir ma galerie") : "") +
    paragraph("Vous recevez ce message parce qu'une sélection est attendue sur cette galerie. Une fois validée, plus aucune relance ne vous sera envoyée.", { small: true });
  const text = [
    `Votre galerie « ${galleryTitle} » se ferme ${when}.`,
    "",
    selectionLine,
    galleryUrl ? `\nRevoir ma galerie : ${galleryUrl}` : "",
  ].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

// Relance au photographe : la galerie expire dans deux jours et le client
// n'a toujours pas validé — de quoi le contacter directement.
export function buildPhotographerReminderEmail({ galleryTitle, clientName, daysLeft, selectedCount, adminUrl }) {
  const when = daysLabel(daysLeft);
  const subject = `Sélection toujours en attente sur « ${galleryTitle} » (expire ${when})`;
  const bodyHtml =
    eyebrow("Relance automatique") +
    heading(`« ${escapeHtml(galleryTitle)} » expire ${escapeHtml(when)}`) +
    paragraph(`${clientName ? escapeHtml(clientName) : "Votre client"} n'a pas encore validé sa sélection (${selectedCount} coup${selectedCount > 1 ? "s" : ""} de cœur pour l'instant). Les relances automatiques lui ont été envoyées ; un mot de votre part fera peut-être la différence.`) +
    (adminUrl ? emailButton(adminUrl, "Ouvrir le tableau de bord") : "") +
    paragraph("Vous pouvez désactiver ces relances dans Paramètres.", { small: true });
  const text = `« ${galleryTitle} » expire ${when} et ${clientName || "votre client"} n'a pas encore validé sa sélection (${selectedCount} coup(s) de cœur).${adminUrl ? `\n\nTableau de bord : ${adminUrl}` : ""}`;
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

// Le client vient de cliquer « Valider ma sélection » : le photographe est
// prévenu tout de suite, avec le compte des photos et le supplément dû.
export function buildSelectionValidatedEmail({ galleryTitle, clientName, selectedCount, dueExtraCount, dueTotalCents, adminUrl }) {
  const subject = `Sélection validée sur « ${galleryTitle} »`;
  const dueLine = dueExtraCount > 0
    ? `Supplément à régler : ${dueExtraCount} photo${dueExtraCount > 1 ? "s" : ""} au-delà du forfait, soit ${formatEuros(dueTotalCents)}.`
    : "Aucun supplément à régler.";
  const bodyHtml =
    eyebrow("Sélection validée") +
    heading(`${escapeHtml(clientName || "Votre client")} a validé sa sélection`) +
    paragraph(`Galerie « <strong>${escapeHtml(galleryTitle)}</strong> » : <strong>${selectedCount} photo${selectedCount > 1 ? "s" : ""}</strong> choisie${selectedCount > 1 ? "s" : ""}.`) +
    paragraph(escapeHtml(dueLine)) +
    (adminUrl ? emailButton(adminUrl, "Voir la sélection") : "");
  const text = `${clientName || "Votre client"} a validé sa sélection sur « ${galleryTitle} » : ${selectedCount} photo(s). ${dueLine}${adminUrl ? `\n\nTableau de bord : ${adminUrl}` : ""}`;
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function sendInvoiceEmail(env, { to, galleryTitle, number, amountCents, pdfBytes }) {
  await sendEmail(env, {
    to,
    ...buildInvoiceEmail({ galleryTitle, number, amountCents }),
    attachments: [{ filename: `facture-${number}.pdf`, content: bytesToBase64(pdfBytes) }],
  });
}

async function sendEmail(env, { to, subject, html, text, attachments }) {
  if (!env.RESEND_API_KEY || !to) return;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM || "Holypixx <alertes@holypixx.com>",
        to,
        subject,
        html,
        text,
        ...(attachments ? { attachments } : {}),
      }),
    });
    // `fetch` ne lève une exception qu'en cas de panne réseau — un refus de
    // Resend (mauvaise clé, domaine d'expédition non vérifié, adresse
    // invalide…) revient comme une réponse HTTP normale, juste pas 2xx.
    // Sans cette vérification, un refus passait totalement inaperçu.
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`Resend a refusé l'e-mail (HTTP ${response.status}) : ${body.slice(0, 300)}`);
    } else {
      console.log(`E-mail envoyé via Resend à ${to} : « ${subject} »`);
    }
  } catch (err) {
    // Un incident chez Resend ne doit jamais remonter à l'appelant : celui-ci
    // continue son cours normal (capture consignée, ou lien de
    // réinitialisation simplement pas reçu — l'utilisateur peut réessayer).
    console.error("Échec de l'envoi d'e-mail :", err && err.message ? err.message : err);
  }
}

export async function sendCaptureAlert(env, params) {
  await sendEmail(env, { to: params.to, ...buildCaptureAlertEmail(params) });
}

export async function sendPasswordResetEmail(env, params) {
  await sendEmail(env, { to: params.to, ...buildPasswordResetEmail(params) });
}

export async function sendEmailChangeConfirmation(env, params) {
  await sendEmail(env, { to: params.to, ...buildEmailChangeConfirmationEmail(params) });
}

export async function sendClientReminder(env, params) {
  await sendEmail(env, { to: params.to, ...buildClientReminderEmail(params) });
}

export async function sendPhotographerReminder(env, params) {
  await sendEmail(env, { to: params.to, ...buildPhotographerReminderEmail(params) });
}

export async function sendSelectionValidated(env, params) {
  await sendEmail(env, { to: params.to, ...buildSelectionValidatedEmail(params) });
}
