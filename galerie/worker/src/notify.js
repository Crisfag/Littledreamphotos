// Alerte par e-mail au photographe quand une capture d'écran est
// suspectée chez un client. Best-effort : sans RESEND_API_KEY configurée,
// ou si Resend est indisponible, on n'envoie rien et on ne fait jamais
// échouer la requête du visiteur pour autant (voir viewer.js, appelé via
// ctx.waitUntil, jamais attendu par la réponse HTTP).

const REASON_LABELS = {
  "impr-ecran": "la touche Impr. écran",
  "capture-macos": "un raccourci de capture macOS",
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

export async function sendCaptureAlert(env, params) {
  if (!env.RESEND_API_KEY || !params.to) return;
  const { subject, html, text } = buildCaptureAlertEmail(params);
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM || "Holypixx <alertes@holypixx.com>",
        to: params.to,
        subject,
        html,
        text,
      }),
    });
  } catch (err) {
    // Un incident chez Resend ne doit jamais remonter au visiteur de la
    // galerie : la capture reste consignée dans le journal quoi qu'il arrive.
    console.error("Échec de l'alerte de capture :", err && err.message ? err.message : err);
  }
}
