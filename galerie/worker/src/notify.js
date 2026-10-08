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
// Lien de connexion à l'espace famille du module scolaire (ecole.html).
export function buildFamilyLoginLinkEmail({ loginUrl, ts }) {
  const subject = "Votre lien pour retrouver les photos de vos enfants";
  const bodyHtml = [
    eyebrow("Espace famille"),
    heading("Retrouver vos photos"),
    paragraph(`Vous avez demandé à vous connecter à votre espace famille le ${escapeHtml(formatWhen(ts))}.`),
    emailButton(loginUrl, "Ouvrir mon espace famille"),
    `<div style="height:20px;"></div>`,
    paragraph(
      "Ce lien n'est valable qu'une demi-heure et ne fonctionne qu'une seule fois. Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail.",
      { small: true }
    ),
  ].join("\n");
  const html = emailShell({ preheader: "Votre lien de connexion à l'espace famille", bodyHtml });
  const text =
    `Vous avez demandé à vous connecter à votre espace famille le ${formatWhen(ts)}. ` +
    `Ouvrez-le ici : ${loginUrl} ` +
    "Ce lien n'est valable qu'une demi-heure et ne fonctionne qu'une seule fois.";
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

// Lignes d'une commande de tirages, en HTML et en texte, pour les e-mails.
function printLinesHtml(lines) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:6px 0 16px;font-family:${SANS};font-size:14px;color:${CHARCOAL};">` +
    lines.map((l) =>
      `<tr><td style="padding:4px 0;">${l.copies} × ${escapeHtml(l.label)} <span style="color:${MUTED};">— photo n° ${l.photoNumber}</span></td>` +
      `<td style="padding:4px 0;text-align:right;white-space:nowrap;">${formatEuros(l.lineCents)}</td></tr>`
    ).join("") +
    `</table>`;
}

function printLinesText(lines) {
  return lines.map((l) => `- ${l.copies} × ${l.label} (photo n° ${l.photoNumber}) : ${formatEuros(l.lineCents)}`).join("\n");
}

// Confirmation au client après paiement d'une commande de tirages (la
// facture est jointe par l'appelant).
export function buildPrintOrderConfirmationEmail({ studioName, galleryTitle, recipientName, lines, shippingCents, totalCents, invoiceNumber }) {
  const subject = `Votre commande de tirages est confirmée — ${galleryTitle}`;
  const bodyHtml =
    eyebrow(studioName || "Commande de tirages") +
    heading("Merci pour votre commande !") +
    paragraph(`${recipientName ? escapeHtml(recipientName) + ", v" : "V"}otre paiement est bien reçu. Vos tirages de « <strong>${escapeHtml(galleryTitle)}</strong> » partent en fabrication chez notre laboratoire, puis directement chez vous.`) +
    printLinesHtml(lines) +
    paragraph(`Frais de port : ${formatEuros(shippingCents)}<br /><strong>Total réglé : ${formatEuros(totalCents)}</strong>`) +
    paragraph(`Vous recevrez un e-mail avec le lien de suivi dès l'expédition.${invoiceNumber ? ` Votre facture n° ${escapeHtml(invoiceNumber)} est jointe à ce message.` : ""}`, { small: true });
  const text = [
    `Votre commande de tirages pour « ${galleryTitle} » est confirmée.`,
    "",
    printLinesText(lines),
    `Frais de port : ${formatEuros(shippingCents)}`,
    `Total réglé : ${formatEuros(totalCents)}`,
    "",
    "Vous recevrez un e-mail avec le lien de suivi dès l'expédition.",
  ].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

// Aux parents : commande de photos scolaires payée. Livraison groupée à
// l'établissement (distribuée aux enfants) ou à domicile.
export function buildSchoolOrderConfirmationEmail({ studioName, schoolName, delivery, lines, shippingCents, totalCents, familyUrl, hasDigital }) {
  const subject = `Votre commande de photos est confirmée — ${schoolName}`;
  const rows = lines.map((l) => ({ copies: l.quantity, label: `${l.name} — ${l.childName}`, lineCents: l.priceCents * l.quantity }));
  const tableHtml = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:6px 0 16px;font-family:${SANS};font-size:14px;color:${CHARCOAL};">` +
    rows.map((r) => `<tr><td style="padding:4px 0;">${r.copies} × ${escapeHtml(r.label)}</td><td style="padding:4px 0;text-align:right;white-space:nowrap;">${formatEuros(r.lineCents)}</td></tr>`).join("") +
    `</table>`;
  const where = delivery === "home"
    ? "Vos photos sont imprimées puis envoyées à l'adresse indiquée lors du paiement."
    : `Vos photos sont imprimées avec celles de toute l'école puis remises à vos enfants par « ${escapeHtml(schoolName)} ».`;
  const bodyHtml =
    eyebrow(studioName || "Photos scolaires") +
    heading("Merci pour votre commande !") +
    paragraph(`Votre paiement est bien reçu. ${where}`) +
    tableHtml +
    paragraph(`${shippingCents ? `Livraison à domicile : ${formatEuros(shippingCents)}<br />` : ""}<strong>Total réglé : ${formatEuros(totalCents)}</strong>`) +
    (hasDigital ? paragraph("Vos fichiers numériques sont déjà à télécharger dans votre espace famille.") + emailButton(familyUrl, "Ouvrir mon espace famille") : "");
  const text = [
    `Votre commande de photos (${schoolName}) est confirmée.`,
    "",
    ...rows.map((r) => `- ${r.copies} × ${r.label} : ${formatEuros(r.lineCents)}`),
    ...(shippingCents ? [`Livraison à domicile : ${formatEuros(shippingCents)}`] : []),
    `Total réglé : ${formatEuros(totalCents)}`,
    "",
    delivery === "home" ? "Vos photos seront envoyées à l'adresse indiquée lors du paiement." : "Vos photos seront remises à vos enfants par l'établissement.",
    ...(hasDigital ? [`Vos fichiers numériques : ${familyUrl}`] : []),
  ].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

// Rappel de commande à une famille (module scolaire) : 7 et 2 jours avant
// la date de commande groupée (« j7 », « j2 »), 2 jours avant la fin de la
// commande à domicile (« late2 »). Toujours avec le lien pour ne plus en
// recevoir.
function childrenLabel(names, count) {
  if (names.length === 1 && count === 1) return names[0];
  if (names.length && names.length === count) return names.slice(0, -1).join(", ") + " et " + names[names.length - 1];
  return count > 1 ? "vos enfants" : "votre enfant";
}

export function buildSchoolReminderEmail({ kind, studioName, schoolName, childNames = [], childrenCount = 1, deadline, familyUrl, stopUrl }) {
  const who = childrenLabel(childNames, childrenCount);
  const day = formatDay(deadline);
  const subject = kind === "late2"
    ? `Encore deux jours pour commander les photos de ${who}`
    : kind === "j2"
      ? `Dernier rappel : commande des photos de ${who} jusqu'au ${day}`
      : `Les photos de ${who} vous attendent — commande jusqu'au ${day}`;
  const lead = kind === "late2"
    ? `La commande groupée de « <strong>${escapeHtml(schoolName)}</strong> » est terminée, mais vous pouvez encore commander les photos de ${escapeHtml(who)} jusqu'au <strong>${escapeHtml(day)}</strong>, avec livraison à domicile.`
    : `Les photos de ${escapeHtml(who)} (« <strong>${escapeHtml(schoolName)}</strong> ») sont dans votre espace famille. Commandez avant le <strong>${escapeHtml(day)}</strong> : elles seront livrées à l'établissement, sans frais de port.`;
  const bodyHtml =
    eyebrow(studioName || "Photos scolaires") +
    heading(kind === "j2" ? "C'est bientôt la fin de la commande" : kind === "late2" ? "Dernière chance" : "Vos photos vous attendent") +
    paragraph(lead) +
    emailButton(familyUrl, "Voir les photos et commander") +
    `<div style="height:20px;"></div>` +
    paragraph(`Une question ? Répondez simplement à cet e-mail${studioName ? ` : il arrive chez ${escapeHtml(studioName)}` : ""}.`, { small: true }) +
    paragraph(`Vous recevez ce rappel parce que vous avez ouvert un espace famille. <a href="${escapeHtml(stopUrl)}" style="color:${MUTED};">Ne plus recevoir de rappels</a>.`, { small: true });
  const text = [
    kind === "late2"
      ? `La commande groupée (${schoolName}) est terminée, mais vous pouvez encore commander les photos de ${who} jusqu'au ${day}, avec livraison à domicile.`
      : `Les photos de ${who} (${schoolName}) sont dans votre espace famille. Commandez avant le ${day} : livraison à l'établissement, sans frais de port.`,
    "",
    `Voir les photos et commander : ${familyUrl}`,
    "",
    "Une question ? Répondez simplement à cet e-mail.",
    `Ne plus recevoir de rappels : ${stopUrl}`,
  ].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

// Au photographe : nouvelle commande payée, et ce qu'il en est côté labo.
export function buildPrintOrderPhotographerEmail({ galleryTitle, recipientName, lines, totalCents, labStatus, labError, adminUrl }) {
  const failed = labStatus === "failed";
  const subject = failed
    ? `⚠️ Commande de tirages à relancer — ${galleryTitle}`
    : `Nouvelle commande de tirages — ${galleryTitle}`;
  const bodyHtml =
    eyebrow(failed ? "Action requise" : "Nouvelle commande") +
    heading(`${escapeHtml(recipientName || "Un client")} a commandé des tirages`) +
    paragraph(`Galerie « <strong>${escapeHtml(galleryTitle)}</strong> », ${formatEuros(totalCents)} réglés en ligne.`) +
    printLinesHtml(lines) +
    paragraph(failed
      ? `<strong>Le laboratoire a refusé la commande :</strong> ${escapeHtml(labError || "raison inconnue")}. Corrigez le format en cause dans Paramètres → Boutique, puis relancez la commande depuis la fiche de la galerie.`
      : "La commande a été transmise automatiquement au laboratoire. Rien à faire de votre côté : le client recevra le suivi à l'expédition.") +
    (adminUrl ? emailButton(adminUrl, "Ouvrir le tableau de bord") : "");
  const text = `${recipientName || "Un client"} a commandé des tirages sur « ${galleryTitle} » (${formatEuros(totalCents)}).\n\n${printLinesText(lines)}\n\n` +
    (failed ? `Le laboratoire a refusé la commande : ${labError || "raison inconnue"}. Relancez-la depuis la fiche de la galerie.` : "Commande transmise automatiquement au laboratoire.");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

// Au client : ses tirages sont expédiés.
export function buildDeliveryReadyEmail({ studioName, galleryTitle, clientName, count, galleryUrl }) {
  const subject = `Vos photos « ${galleryTitle} » sont prêtes`;
  const countText = `${count} photo${count > 1 ? "s" : ""}`;
  const bodyHtml =
    eyebrow(studioName || "Vos photos") +
    heading("Vos photos sont prêtes") +
    paragraph(`${clientName ? escapeHtml(clientName) + ", v" : "V"}os photos définitives de « <strong>${escapeHtml(galleryTitle)}</strong> » vous attendent : ${escapeHtml(countText)} en haute définition, à télécharger une par une ou toutes d'un coup.`) +
    (galleryUrl ? emailButton(galleryUrl, "Télécharger mes photos") : "") +
    paragraph("Connectez-vous avec le mot de passe habituel de votre galerie. Pensez à enregistrer vos photos avant la fermeture de la galerie.", { small: true });
  const text = [
    `Vos photos définitives de « ${galleryTitle} » sont prêtes : ${countText} en haute définition.`,
    galleryUrl ? `\nTélécharger mes photos : ${galleryUrl}` : "",
    "\nConnectez-vous avec le mot de passe habituel de votre galerie.",
  ].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

function formatDay(ts) {
  return new Date(ts * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Brussels" });
}

function promoLine(promo) {
  return promo ? `−${promo.percent} % sur tous les tirages jusqu'au ${formatDay(promo.endsAt)}` : "";
}

export function buildPrintPromoEmail({ studioName, galleryTitle, clientName, percent, endsAt, favoritesCount, galleryUrl }) {
  const until = formatDay(endsAt);
  const subject = `−${percent} % sur vos tirages jusqu'au ${until}`;
  const favorites = favoritesCount > 0
    ? `Vos ${favoritesCount} coup${favoritesCount > 1 ? "s" : ""} de cœur n'attendent que ça : tirage photo, toile, cadre…`
    : "Tirages photo, toiles, cadres : choisissez vos préférées et recevez-les chez vous.";
  const bodyHtml =
    eyebrow(studioName || "Vos photos") +
    heading(`−${percent} % sur vos tirages`) +
    paragraph(`${clientName ? escapeHtml(clientName) + ", j" : "J"}usqu'au <strong>${escapeHtml(until)}</strong>, tous les tirages de votre galerie « <strong>${escapeHtml(galleryTitle)}</strong> » sont à −${percent} %.`) +
    paragraph(escapeHtml(favorites)) +
    (galleryUrl ? emailButton(galleryUrl, "Choisir mes tirages") : "") +
    paragraph("Ouvrez une photo, puis « Tirages » : la remise est appliquée automatiquement. Livraison à domicile.", { small: true });
  const text = [
    `Jusqu'au ${until}, tous les tirages de votre galerie « ${galleryTitle} » sont à −${percent} %.`,
    favorites,
    galleryUrl ? `\nChoisir mes tirages : ${galleryUrl}` : "",
  ].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

export function buildCartReminderEmail({ studioName, galleryTitle, clientName, items, promo, galleryUrl }) {
  const count = items.reduce((n, i) => n + i.copies, 0);
  const subject = `Votre panier vous attend : ${count} tirage${count > 1 ? "s" : ""}`;
  const list = items.map((i) => `${i.copies} × ${i.label}`);
  const bodyHtml =
    eyebrow(studioName || "Vos tirages") +
    heading("Votre panier vous attend") +
    paragraph(`${clientName ? escapeHtml(clientName) + ", v" : "V"}ous avez préparé une commande de tirages dans votre galerie « <strong>${escapeHtml(galleryTitle)}</strong> » sans la finaliser :`) +
    `<ul style="margin:0 0 18px;padding-left:20px;color:#3a332e;font-size:15px;line-height:1.6;">${list.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>` +
    (promo ? paragraph(`<strong>${escapeHtml(promoLine(promo))}</strong>`) : "") +
    (galleryUrl ? emailButton(galleryUrl, "Finaliser ma commande") : "") +
    paragraph("Votre panier est enregistré : il vous suffit d'ouvrir votre galerie, puis « Mes tirages ».", { small: true });
  const text = [
    `Vous avez préparé une commande de tirages dans votre galerie « ${galleryTitle} » sans la finaliser :`,
    ...list.map((l) => `- ${l}`),
    promo ? `\n${promoLine(promo)}` : "",
    galleryUrl ? `\nFinaliser ma commande : ${galleryUrl}` : "",
  ].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

export function buildFavoritesPrintEmail({ studioName, galleryTitle, clientName, favoritesCount, promo, galleryUrl }) {
  const subject = "Vos coups de cœur méritent d'être imprimés";
  const bodyHtml =
    eyebrow(studioName || "Vos photos") +
    heading("Et si vous les imprimiez ?") +
    paragraph(`${clientName ? escapeHtml(clientName) + ", v" : "V"}ous avez choisi ${favoritesCount} coup${favoritesCount > 1 ? "s" : ""} de cœur dans « <strong>${escapeHtml(galleryTitle)}</strong> ». Tirage photo, toile, cadre ou plexiglas : vos photos préférées méritent mieux qu'un écran.`) +
    (promo ? paragraph(`<strong>${escapeHtml(promoLine(promo))}</strong>`) : "") +
    (galleryUrl ? emailButton(galleryUrl, "Voir les tirages") : "") +
    paragraph("Fabriqués par notre laboratoire partenaire et livrés chez vous.", { small: true });
  const text = [
    `Vous avez choisi ${favoritesCount} coup${favoritesCount > 1 ? "s" : ""} de cœur dans « ${galleryTitle} ». Tirage photo, toile, cadre : vos photos préférées méritent mieux qu'un écran.`,
    promo ? promoLine(promo) : "",
    galleryUrl ? `\nVoir les tirages : ${galleryUrl}` : "",
  ].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

export function buildPrintOrderShippedEmail({ studioName, galleryTitle, recipientName, trackingUrl }) {
  const subject = `Vos tirages sont en route — ${galleryTitle}`;
  const bodyHtml =
    eyebrow(studioName || "Commande de tirages") +
    heading("Vos tirages sont en route") +
    paragraph(`${recipientName ? escapeHtml(recipientName) + ", v" : "V"}os tirages de « <strong>${escapeHtml(galleryTitle)}</strong> » viennent d'être expédiés.`) +
    (trackingUrl ? emailButton(trackingUrl, "Suivre mon colis") : paragraph("Le transporteur ne fournit pas de lien de suivi pour cet envoi.", { small: true }));
  const text = `Vos tirages de « ${galleryTitle} » viennent d'être expédiés.${trackingUrl ? `\n\nSuivi : ${trackingUrl}` : ""}`;
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

export function buildStoragePurgeNoticeEmail({ studioName, galleryTitle, deliveryCount, originalCount, sizeLabel, purgeAt, adminUrl }) {
  const subject = `Fichiers HD de « ${galleryTitle} » effacés le ${formatDay(purgeAt)}`;
  const what = [
    deliveryCount ? `${deliveryCount} photo${deliveryCount > 1 ? "s" : ""} livrée${deliveryCount > 1 ? "s" : ""} en haute définition (${sizeLabel})` : "",
    originalCount ? `${originalCount} fichier${originalCount > 1 ? "s" : ""} d'impression` : "",
  ].filter(Boolean).join(" et ");
  const bodyHtml =
    eyebrow(studioName || "Votre espace de stockage") +
    heading("Des fichiers vont être effacés") +
    paragraph(`La galerie « <strong>${escapeHtml(galleryTitle)}</strong> » a expiré. Pour libérer votre espace de stockage, ${escapeHtml(what)} seront effacés le <strong>${escapeHtml(formatDay(purgeAt))}</strong>.`) +
    paragraph("Les photos de la galerie elle-même restent en ligne. Pour garder ces fichiers, prolongez simplement la galerie : la date d'effacement sera repoussée d'autant.") +
    (adminUrl ? emailButton(adminUrl, "Ouvrir la galerie") : "") +
    paragraph("Vous avez les originaux sur votre ordinateur ? Rien à faire : ils pourront toujours être déposés à nouveau.", { small: true });
  const text = [
    `La galerie « ${galleryTitle} » a expiré : ${what} seront effacés le ${formatDay(purgeAt)}.`,
    "Les photos de la galerie restent en ligne. Prolongez la galerie pour garder ces fichiers.",
    adminUrl ? `\nOuvrir la galerie : ${adminUrl}` : "",
  ].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

export function buildPortfolioContactEmail({ studioName, name, email, phone, eventDate, message }) {
  const subject = `Nouveau message de ${name} via votre portfolio`;
  const details = [
    `<strong>E-mail :</strong> <a href="mailto:${escapeHtml(email)}" style="color:${ROSE_DEEP};">${escapeHtml(email)}</a>`,
    phone ? `<strong>Téléphone :</strong> ${escapeHtml(phone)}` : "",
    eventDate ? `<strong>Date souhaitée :</strong> ${escapeHtml(eventDate)}` : "",
  ].filter(Boolean).join("<br>");
  const bodyHtml =
    eyebrow(studioName || "Votre portfolio") +
    heading(`${escapeHtml(name)} vous a écrit`) +
    paragraph(details) +
    `<div style="margin:0 0 14px;padding:14px 16px;background:${CREAM};border-radius:10px;font-family:${SANS};font-size:15px;line-height:1.6;color:${CHARCOAL};white-space:pre-wrap;">${escapeHtml(message)}</div>` +
    paragraph("Répondez directement à cet e-mail : votre réponse partira vers l'adresse du visiteur. Le message est aussi enregistré dans l'onglet Portfolio de votre tableau de bord.", { small: true });
  const text = [
    `${name} vous a écrit depuis votre portfolio.`,
    `E-mail : ${email}`,
    phone ? `Téléphone : ${phone}` : "",
    eventDate ? `Date souhaitée : ${eventDate}` : "",
    "",
    message,
  ].filter((l, i) => l !== "" || i === 4).join("\n");
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

async function sendEmail(env, { to, subject, html, text, attachments, replyTo }) {
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
        ...(replyTo ? { reply_to: replyTo } : {}),
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

export async function sendFamilyLoginLink(env, params) {
  await sendEmail(env, { to: params.to, ...buildFamilyLoginLinkEmail(params) });
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

export async function sendPrintOrderConfirmation(env, params) {
  await sendEmail(env, {
    to: params.to,
    ...buildPrintOrderConfirmationEmail(params),
    ...(params.pdfBytes ? { attachments: [{ filename: `facture-${params.invoiceNumber}.pdf`, content: bytesToBase64(params.pdfBytes) }] } : {}),
  });
}

export async function sendSchoolReminder(env, params) {
  await sendEmail(env, { to: params.to, replyTo: params.replyTo, ...buildSchoolReminderEmail(params) });
}

export async function sendSchoolOrderConfirmation(env, params) {
  await sendEmail(env, { to: params.to, ...buildSchoolOrderConfirmationEmail(params) });
}

export async function sendPrintOrderPhotographer(env, params) {
  await sendEmail(env, { to: params.to, ...buildPrintOrderPhotographerEmail(params) });
}

export async function sendPrintOrderShipped(env, params) {
  await sendEmail(env, { to: params.to, ...buildPrintOrderShippedEmail(params) });
}

export async function sendDeliveryReady(env, params) {
  await sendEmail(env, { to: params.to, ...buildDeliveryReadyEmail(params) });
}

export async function sendPrintPromo(env, params) {
  await sendEmail(env, { to: params.to, ...buildPrintPromoEmail(params) });
}

export async function sendCartReminder(env, params) {
  await sendEmail(env, { to: params.to, ...buildCartReminderEmail(params) });
}

export async function sendFavoritesPrint(env, params) {
  await sendEmail(env, { to: params.to, ...buildFavoritesPrintEmail(params) });
}

export async function sendPortfolioContact(env, params) {
  await sendEmail(env, { to: params.to, replyTo: params.replyTo, ...buildPortfolioContactEmail(params) });
}

export async function sendStoragePurgeNotice(env, params) {
  await sendEmail(env, { to: params.to, ...buildStoragePurgeNoticeEmail(params) });
}
