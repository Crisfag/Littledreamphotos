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

async function sendEmail(env, { to, subject, html, text }) {
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
