// Alerte par e-mail au photographe quand une capture d'écran est
// suspectée chez un client. Best-effort : sans RESEND_API_KEY configurée,
// ou si Resend est indisponible, on n'envoie rien et on ne fait jamais
// échouer la requête du visiteur pour autant (voir viewer.js, appelé via
// ctx.waitUntil, jamais attendu par la réponse HTTP).

const REASON_LABELS = {
  "impr-ecran": "la touche Impr. écran",
  "capture-macos": "un raccourci de capture macOS",
  "absence-breve": "un signal fort de capture d'écran (changement de fenêtre très bref)",
};

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

// Fonction pure (pas d'accès réseau) : facile à tester unitairement.
export function buildCaptureAlertEmail({ studioName, galleryTitle, clientName, photoLabel, reason, ts, adminUrl }) {
  const reasonLabel = REASON_LABELS[reason] || "une capture d'écran";
  const subject = `Capture suspectée sur « ${galleryTitle} »`;
  const photoLine = photoLabel
    ? `<strong>${escapeHtml(photoLabel)}</strong> était affichée à ce moment-là.`
    : "Aucune photo précise n'a pu être identifiée (capture depuis la vue d'ensemble).";

  const html = `
    <div style="font-family:Georgia,serif;color:#2b2521;max-width:480px;margin:0 auto;">
      <p>Bonjour${studioName ? " " + escapeHtml(studioName) : ""},</p>
      <p>
        Un visiteur de votre galerie <strong>${escapeHtml(galleryTitle)}</strong>
        ${clientName ? "(" + escapeHtml(clientName) + ")" : ""}
        a déclenché ${reasonLabel} le ${escapeHtml(formatWhen(ts))}.
      </p>
      <p>${photoLine}</p>
      <p style="color:#7c716a;font-size:.9em;">
        Il ne s'agit jamais d'une certitude absolue — seulement d'un signal fort,
        consigné dans le journal d'accès de cette galerie.
      </p>
      ${adminUrl ? `<p><a href="${escapeHtml(adminUrl)}" style="color:#9c6f61;">Ouvrir mon tableau de bord</a></p>` : ""}
    </div>
  `.trim();

  const text =
    `Un visiteur de votre galerie "${galleryTitle}"${clientName ? " (" + clientName + ")" : ""} ` +
    `a déclenché ${reasonLabel} le ${formatWhen(ts)}. ` +
    (photoLabel ? `Photo concernée : ${photoLabel}.` : "Photo non identifiée (vue d'ensemble).");

  return { subject, html, text };
}

// Fonction pure : facile à tester unitairement, sans accès réseau.
export function buildPasswordResetEmail({ studioName, resetUrl, ts }) {
  const subject = "Réinitialisation de votre mot de passe Holypixx";
  const html = `
    <div style="font-family:Georgia,serif;color:#2b2521;max-width:480px;margin:0 auto;">
      <p>Bonjour${studioName ? " " + escapeHtml(studioName) : ""},</p>
      <p>
        Une réinitialisation de mot de passe a été demandée pour votre compte
        Holypixx le ${escapeHtml(formatWhen(ts))}.
      </p>
      <p>
        <a href="${escapeHtml(resetUrl)}" style="color:#9c6f61;">Choisir un nouveau mot de passe</a>
      </p>
      <p style="color:#7c716a;font-size:.9em;">
        Ce lien n'est valable qu'une demi-heure et ne fonctionne qu'une seule
        fois. Si vous n'êtes pas à l'origine de cette demande, ignorez
        simplement cet e-mail : votre mot de passe actuel reste inchangé.
      </p>
    </div>
  `.trim();

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
