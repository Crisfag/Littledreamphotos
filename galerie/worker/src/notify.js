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
function emailShell({ preheader, bodyHtml, lang }) {
  return `
<!doctype html>
<html lang="${lang === "en" ? "en" : "fr"}">
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
                  ${lang === "en" ? "Holypixx — protected galleries for photographers" : "Holypixx — galeries protégées pour photographes"}
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
export function buildCaptureAlertEmail({ studioName, galleryTitle, clientName, photoLabel, reason, ts, adminUrl, lang }) {
  if (lang === "en") return captureAlertEn({ studioName, galleryTitle, clientName, photoLabel, reason, ts, adminUrl });
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
export function buildPasswordResetEmail({ studioName, resetUrl, ts, lang }) {
  if (lang === "en") return passwordResetEn({ studioName, resetUrl, ts });
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
export function buildEmailChangeConfirmationEmail({ studioName, confirmUrl, ts, lang }) {
  if (lang === "en") return emailChangeEn({ studioName, confirmUrl, ts });
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
export function buildInvoiceEmail({ galleryTitle, number, amountCents, lang }) {
  if (lang === "en") return invoiceEmailEn({ galleryTitle, number, amountCents });
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
/* ---------- Galeries en anglais (voir i18n.js) ----------
   Même mise en page que les versions françaises ; seuls les textes
   changent. Les e-mails au photographe restent en français. */

function formatEurosEn(cents) {
  return "€" + ((cents || 0) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDayEn(ts) {
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Europe/Brussels" });
}

function greetingEn(name, sentence) {
  return name ? `${escapeHtml(name)}, ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}` : sentence;
}

function enMail(subject, bodyHtml, text) {
  return { subject, html: emailShell({ preheader: subject, bodyHtml, lang: "en" }), text };
}

function invoiceEmailEn({ galleryTitle, number, amountCents }) {
  const subject = `Your invoice ${number} — ${galleryTitle}`;
  const bodyHtml = [
    eyebrow("Invoice"),
    heading(`Invoice ${escapeHtml(number)}`),
    paragraph(`Thank you for your payment of <strong>${formatEurosEn(amountCents)}</strong> for “${escapeHtml(galleryTitle)}”.`),
    paragraph("Your invoice is attached to this email (PDF).", { small: true }),
  ].join("\n");
  return { subject, html: emailShell({ preheader: `Invoice ${number} — ${galleryTitle}`, bodyHtml, lang: "en" }),
    text: `Thank you for your payment of ${formatEurosEn(amountCents)} for "${galleryTitle}". Invoice ${number} attached.` };
}

function clientReminderEn({ studioName, galleryTitle, clientName, daysLeft, selectedCount, galleryUrl }) {
  const when = daysLeft <= 1 ? "tomorrow" : `in ${daysLeft} days`;
  const subject = `Your gallery “${galleryTitle}” closes ${when}`;
  const selectionLine = selectedCount > 0
    ? `You already have ${selectedCount} favourite${selectedCount > 1 ? "s" : ""} — all that's left is to confirm your choice with the “Confirm my selection” button at the top of the gallery.`
    : "You haven't picked any photos yet: take a moment to browse them and heart your favourites, then confirm with the “Confirm my selection” button.";
  const bodyHtml =
    eyebrow(studioName || "Your gallery") +
    heading(`Your gallery closes ${escapeHtml(when)}`) +
    paragraph(greetingEn(clientName, `Your photos from “<strong>${escapeHtml(galleryTitle)}</strong>” stay online ${daysLeft <= 1 ? "until tomorrow" : `for another ${daysLeft} days`}.`)) +
    paragraph(escapeHtml(selectionLine)) +
    (galleryUrl ? emailButton(galleryUrl, "View my gallery") : "") +
    paragraph("You're receiving this message because a selection is expected on this gallery. Once it's confirmed, you won't receive any more reminders.", { small: true });
  const text = [`Your gallery “${galleryTitle}” closes ${when}.`, "", selectionLine, galleryUrl ? `\nView my gallery: ${galleryUrl}` : ""].join("\n");
  return enMail(subject, bodyHtml, text);
}

function printLinesHtmlEn(lines) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:6px 0 16px;font-family:${SANS};font-size:14px;color:${CHARCOAL};">` +
    lines.map((l) =>
      `<tr><td style="padding:4px 0;">${l.copies} × ${escapeHtml(l.label)} <span style="color:${MUTED};">— photo no. ${l.photoNumber}</span></td>` +
      `<td style="padding:4px 0;text-align:right;white-space:nowrap;">${formatEurosEn(l.lineCents)}</td></tr>`
    ).join("") +
    `</table>`;
}

function printOrderConfirmationEn({ studioName, galleryTitle, recipientName, lines, shippingCents, totalCents, invoiceNumber }) {
  const subject = `Your print order is confirmed — ${galleryTitle}`;
  const bodyHtml =
    eyebrow(studioName || "Print order") +
    heading("Thank you for your order!") +
    paragraph(greetingEn(recipientName, `We've received your payment. Your prints from “<strong>${escapeHtml(galleryTitle)}</strong>” are going into production at our lab, then straight to your door.`)) +
    printLinesHtmlEn(lines) +
    paragraph(`Shipping: ${formatEurosEn(shippingCents)}<br /><strong>Total paid: ${formatEurosEn(totalCents)}</strong>`) +
    paragraph(`You'll receive an email with the tracking link as soon as it ships.${invoiceNumber ? ` Your invoice no. ${escapeHtml(invoiceNumber)} is attached to this message.` : ""}`, { small: true });
  const text = [
    `Your print order for “${galleryTitle}” is confirmed.`,
    "",
    lines.map((l) => `- ${l.copies} × ${l.label} (photo no. ${l.photoNumber}): ${formatEurosEn(l.lineCents)}`).join("\n"),
    `Shipping: ${formatEurosEn(shippingCents)}`,
    `Total paid: ${formatEurosEn(totalCents)}`,
    "",
    "You'll receive an email with the tracking link as soon as it ships.",
  ].join("\n");
  return enMail(subject, bodyHtml, text);
}

function deliveryReadyEn({ studioName, galleryTitle, clientName, count, galleryUrl }) {
  const subject = `Your photos “${galleryTitle}” are ready`;
  const countText = `${count} photo${count > 1 ? "s" : ""}`;
  const bodyHtml =
    eyebrow(studioName || "Your photos") +
    heading("Your photos are ready") +
    paragraph(greetingEn(clientName, `Your final photos from “<strong>${escapeHtml(galleryTitle)}</strong>” are waiting for you: ${escapeHtml(countText)} in high resolution, to download one by one or all at once.`)) +
    (galleryUrl ? emailButton(galleryUrl, "Download my photos") : "") +
    paragraph("Sign in with your gallery's usual password. Remember to save your photos before the gallery closes.", { small: true });
  const text = [
    `Your final photos from “${galleryTitle}” are ready: ${countText} in high resolution.`,
    galleryUrl ? `\nDownload my photos: ${galleryUrl}` : "",
    "\nSign in with your gallery's usual password.",
  ].join("\n");
  return enMail(subject, bodyHtml, text);
}

function promoLineEn(promo) {
  return promo ? `${promo.percent}% off all prints until ${formatDayEn(promo.endsAt)}` : "";
}

function printPromoEn({ studioName, galleryTitle, clientName, percent, endsAt, favoritesCount, galleryUrl }) {
  const until = formatDayEn(endsAt);
  const subject = `${percent}% off your prints until ${until}`;
  const favorites = favoritesCount > 0
    ? `Your ${favoritesCount} favourite${favoritesCount > 1 ? "s are" : " is"} ready for it: photo print, canvas, frame…`
    : "Photo prints, canvases, frames: pick your favourites and have them delivered to your door.";
  const bodyHtml =
    eyebrow(studioName || "Your photos") +
    heading(`${percent}% off your prints`) +
    paragraph(greetingEn(clientName, `Until <strong>${escapeHtml(until)}</strong>, every print from your gallery “<strong>${escapeHtml(galleryTitle)}</strong>” is ${percent}% off.`)) +
    paragraph(escapeHtml(favorites)) +
    (galleryUrl ? emailButton(galleryUrl, "Choose my prints") : "") +
    paragraph("Open a photo, then “Prints”: the discount is applied automatically. Delivered to your home.", { small: true });
  const text = [
    `Until ${until}, every print from your gallery “${galleryTitle}” is ${percent}% off.`,
    favorites,
    galleryUrl ? `\nChoose my prints: ${galleryUrl}` : "",
  ].join("\n");
  return enMail(subject, bodyHtml, text);
}

function cartReminderEn({ studioName, galleryTitle, clientName, items, promo, galleryUrl }) {
  const count = items.reduce((n, i) => n + i.copies, 0);
  const subject = `Your cart is waiting: ${count} print${count > 1 ? "s" : ""}`;
  const list = items.map((i) => `${i.copies} × ${i.label}`);
  const bodyHtml =
    eyebrow(studioName || "Your prints") +
    heading("Your cart is waiting") +
    paragraph(greetingEn(clientName, `You put together a print order in your gallery “<strong>${escapeHtml(galleryTitle)}</strong>” without completing it:`)) +
    `<ul style="margin:0 0 18px;padding-left:20px;color:#3a332e;font-size:15px;line-height:1.6;">${list.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>` +
    (promo ? paragraph(`<strong>${escapeHtml(promoLineEn(promo))}</strong>`) : "") +
    (galleryUrl ? emailButton(galleryUrl, "Complete my order") : "") +
    paragraph("Your cart is saved: just open your gallery, then “My prints”.", { small: true });
  const text = [
    `You put together a print order in your gallery “${galleryTitle}” without completing it:`,
    ...list.map((l) => `- ${l}`),
    promo ? `\n${promoLineEn(promo)}` : "",
    galleryUrl ? `\nComplete my order: ${galleryUrl}` : "",
  ].join("\n");
  return enMail(subject, bodyHtml, text);
}

function favoritesPrintEn({ studioName, galleryTitle, clientName, favoritesCount, promo, galleryUrl }) {
  const subject = "Your favourites deserve to be printed";
  const bodyHtml =
    eyebrow(studioName || "Your photos") +
    heading("Why not print them?") +
    paragraph(greetingEn(clientName, `You picked ${favoritesCount} favourite${favoritesCount > 1 ? "s" : ""} in “<strong>${escapeHtml(galleryTitle)}</strong>”. Photo print, canvas, frame or acrylic: your best photos deserve more than a screen.`)) +
    (promo ? paragraph(`<strong>${escapeHtml(promoLineEn(promo))}</strong>`) : "") +
    (galleryUrl ? emailButton(galleryUrl, "See the prints") : "") +
    paragraph("Made by our partner lab and delivered to your door.", { small: true });
  const text = [
    `You picked ${favoritesCount} favourite${favoritesCount > 1 ? "s" : ""} in “${galleryTitle}”. Photo print, canvas, frame: your best photos deserve more than a screen.`,
    promo ? promoLineEn(promo) : "",
    galleryUrl ? `\nSee the prints: ${galleryUrl}` : "",
  ].join("\n");
  return enMail(subject, bodyHtml, text);
}

function printOrderShippedEn({ studioName, galleryTitle, recipientName, trackingUrl }) {
  const subject = `Your prints are on their way — ${galleryTitle}`;
  const bodyHtml =
    eyebrow(studioName || "Print order") +
    heading("Your prints are on their way") +
    paragraph(greetingEn(recipientName, `Your prints from “<strong>${escapeHtml(galleryTitle)}</strong>” have just shipped.`)) +
    (trackingUrl ? emailButton(trackingUrl, "Track my parcel") : paragraph("The carrier doesn't provide a tracking link for this shipment.", { small: true }));
  return enMail(subject, bodyHtml, `Your prints from “${galleryTitle}” have just shipped.${trackingUrl ? `\n\nTracking: ${trackingUrl}` : ""}`);
}

/* ---------- Espace photographe en anglais : e-mails au photographe ---------- */

const REASON_LABELS_EN = {
  "impr-ecran": "the Print Screen key",
  "capture-macos": "a macOS screenshot shortcut",
  "absence-breve": "a strong screenshot signal (a very brief window switch)",
};

function formatWhenEn(ts) {
  return new Date(ts * 1000).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Brussels" });
}

function hello(studioName) {
  return `Hello${studioName ? " " + escapeHtml(studioName) : ""},`;
}

function captureAlertEn({ studioName, galleryTitle, clientName, photoLabel, reason, ts, adminUrl }) {
  const reasonLabel = REASON_LABELS_EN[reason] || "a screenshot";
  const subject = `Screenshot suspected on “${galleryTitle}”`;
  const photoLine = photoLabel
    ? `<strong>${escapeHtml(photoLabel)}</strong> was on screen at that moment.`
    : "No specific photo could be identified (screenshot from the overview).";
  const bodyHtml = [
    eyebrow("Screenshot alert"),
    heading(`Screenshot suspected on “${escapeHtml(galleryTitle)}”`),
    paragraph(hello(studioName)),
    paragraph(`A visitor to your gallery <strong>${escapeHtml(galleryTitle)}</strong>${clientName ? " (" + escapeHtml(clientName) + ")" : ""} triggered ${reasonLabel} on ${escapeHtml(formatWhenEn(ts))}.`),
    paragraph(photoLine),
    paragraph("This is never an absolute certainty — only a strong signal, recorded in this gallery's access log.", { small: true }),
    adminUrl ? emailButton(adminUrl, "Open my dashboard") : "",
  ].join("\n");
  const text = `A visitor to your gallery "${galleryTitle}"${clientName ? " (" + clientName + ")" : ""} triggered ${reasonLabel} on ${formatWhenEn(ts)}. ` +
    (photoLabel ? `Photo: ${photoLabel}.` : "Photo not identified (overview).") + (adminUrl ? ` Dashboard: ${adminUrl}` : "");
  return { subject, html: emailShell({ preheader: `Screenshot suspected on ${galleryTitle}`, bodyHtml, lang: "en" }), text };
}

function passwordResetEn({ studioName, resetUrl, ts }) {
  const subject = "Reset your Holypixx password";
  const bodyHtml = [
    eyebrow("Account security"),
    heading("Reset your password"),
    paragraph(hello(studioName)),
    paragraph(`A password reset was requested for your Holypixx account on ${escapeHtml(formatWhenEn(ts))}.`),
    emailButton(resetUrl, "Choose a new password"),
    `<div style="height:20px;"></div>`,
    paragraph("This link is valid for half an hour and works only once. If you didn't ask for this, just ignore this email: your current password stays the same.", { small: true }),
  ].join("\n");
  const text = `A password reset was requested for your Holypixx account on ${formatWhenEn(ts)}. Choose a new password: ${resetUrl} ` +
    "This link is valid for half an hour and works only once. If you didn't ask for this, just ignore this email.";
  return { subject, html: emailShell({ preheader: "Choose a new password for your Holypixx account", bodyHtml, lang: "en" }), text };
}

function emailChangeEn({ studioName, confirmUrl, ts }) {
  const subject = "Confirm your new Holypixx email address";
  const bodyHtml = [
    eyebrow("Account security"),
    heading("Confirm your new address"),
    paragraph(hello(studioName)),
    paragraph(`An email address change was requested for your Holypixx account on ${escapeHtml(formatWhenEn(ts))}. Once confirmed, this address becomes your sign-in email.`),
    emailButton(confirmUrl, "Confirm this address"),
    `<div style="height:20px;"></div>`,
    paragraph("This link is valid for half an hour and works only once. If you didn't ask for this, just ignore this email: nothing changes until the link is opened.", { small: true }),
  ].join("\n");
  const text = `An email address change was requested for your Holypixx account on ${formatWhenEn(ts)}. Confirm this address: ${confirmUrl} ` +
    "This link is valid for half an hour and works only once. If you didn't ask for this, just ignore this email.";
  return { subject, html: emailShell({ preheader: subject, bodyHtml, lang: "en" }), text };
}

function photographerReminderEn({ galleryTitle, clientName, daysLeft, selectedCount, adminUrl }) {
  const when = daysLeft <= 1 ? "tomorrow" : `in ${daysLeft} days`;
  const subject = `Selection still pending on “${galleryTitle}” (closes ${when})`;
  const who = clientName ? escapeHtml(clientName) : "Your client";
  const bodyHtml =
    eyebrow("Automatic reminder") +
    heading(`“${escapeHtml(galleryTitle)}” closes ${escapeHtml(when)}`) +
    paragraph(`${who} hasn't confirmed their selection yet (${selectedCount} favourite${selectedCount === 1 ? "" : "s"} so far). The automatic reminders have been sent; a word from you may make the difference.`) +
    (adminUrl ? emailButton(adminUrl, "Open the dashboard") : "") +
    paragraph("You can turn these reminders off in Settings.", { small: true });
  const text = `“${galleryTitle}” closes ${when} and ${clientName || "your client"} hasn't confirmed their selection yet (${selectedCount} favourite(s)).${adminUrl ? `\n\nDashboard: ${adminUrl}` : ""}`;
  return { subject, html: emailShell({ preheader: subject, bodyHtml, lang: "en" }), text };
}

function selectionValidatedEn({ galleryTitle, clientName, selectedCount, dueExtraCount, dueTotalCents, adminUrl }) {
  const subject = `Selection confirmed on “${galleryTitle}”`;
  const dueLine = dueExtraCount > 0
    ? `Extras due: ${dueExtraCount} photo${dueExtraCount > 1 ? "s" : ""} beyond the package, ${formatEurosEn(dueTotalCents)}.`
    : "No extras due.";
  const bodyHtml =
    eyebrow("Selection confirmed") +
    heading(`${escapeHtml(clientName || "Your client")} confirmed their selection`) +
    paragraph(`Gallery “<strong>${escapeHtml(galleryTitle)}</strong>”: <strong>${selectedCount} photo${selectedCount === 1 ? "" : "s"}</strong> chosen.`) +
    paragraph(escapeHtml(dueLine)) +
    (adminUrl ? emailButton(adminUrl, "See the selection") : "");
  const text = `${clientName || "Your client"} confirmed their selection on “${galleryTitle}”: ${selectedCount} photo(s). ${dueLine}${adminUrl ? `\n\nDashboard: ${adminUrl}` : ""}`;
  return { subject, html: emailShell({ preheader: subject, bodyHtml, lang: "en" }), text };
}

function printOrderPhotographerEn({ galleryTitle, recipientName, lines, totalCents, labStatus, labError, adminUrl }) {
  const failed = labStatus === "failed";
  const subject = failed ? `⚠️ Print order needs attention — ${galleryTitle}` : `New print order — ${galleryTitle}`;
  const bodyHtml =
    eyebrow(failed ? "Action needed" : "New order") +
    heading(`${escapeHtml(recipientName || "A client")} ordered prints`) +
    paragraph(`Gallery “<strong>${escapeHtml(galleryTitle)}</strong>”, ${formatEurosEn(totalCents)} paid online.`) +
    printLinesHtmlEn(lines) +
    paragraph(failed
      ? `<strong>The lab rejected the order:</strong> ${escapeHtml(labError || "unknown reason")}. Fix the format in question in the Shop tab, then resubmit the order from the gallery page.`
      : "The order was sent to the lab automatically. Nothing to do on your side: your client will get tracking when it ships.") +
    (adminUrl ? emailButton(adminUrl, "Open the dashboard") : "");
  const text = `${recipientName || "A client"} ordered prints on “${galleryTitle}” (${formatEurosEn(totalCents)}).\n\n` +
    lines.map((l) => `- ${l.copies} × ${l.label} (photo no. ${l.photoNumber}): ${formatEurosEn(l.lineCents)}`).join("\n") + "\n\n" +
    (failed ? `The lab rejected the order: ${labError || "unknown reason"}. Resubmit it from the gallery page.` : "Order sent to the lab automatically.");
  return { subject, html: emailShell({ preheader: subject, bodyHtml, lang: "en" }), text };
}

function storagePurgeEn({ studioName, galleryTitle, deliveryCount, originalCount, sizeLabel, purgeAt, adminUrl }) {
  const day = formatDayEn(purgeAt);
  const subject = `HD files of “${galleryTitle}” will be deleted on ${day}`;
  const what = [
    deliveryCount ? `${deliveryCount} high-resolution delivered photo${deliveryCount > 1 ? "s" : ""} (${sizeLabel})` : "",
    originalCount ? `${originalCount} print file${originalCount > 1 ? "s" : ""}` : "",
  ].filter(Boolean).join(" and ");
  const bodyHtml =
    eyebrow(studioName || "Your storage") +
    heading("Some files are about to be deleted") +
    paragraph(`The gallery “<strong>${escapeHtml(galleryTitle)}</strong>” has expired. To free up your storage, ${escapeHtml(what)} will be deleted on <strong>${escapeHtml(day)}</strong>.`) +
    paragraph("The gallery's photos themselves stay online. To keep these files, simply extend the gallery: the deletion date moves back accordingly.") +
    (adminUrl ? emailButton(adminUrl, "Open the gallery") : "") +
    paragraph("Have the originals on your computer? Nothing to do: you can always upload them again.", { small: true });
  const text = [
    `The gallery “${galleryTitle}” has expired: ${what} will be deleted on ${day}.`,
    "The gallery's photos stay online. Extend the gallery to keep these files.",
    adminUrl ? `\nOpen the gallery: ${adminUrl}` : "",
  ].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml, lang: "en" }), text };
}

function daysLabel(daysLeft) {
  if (daysLeft <= 1) return "demain";
  return `dans ${daysLeft} jours`;
}

// Relance au client : sa galerie expire bientôt et il n'a pas encore validé
// sa sélection. Fonction pure, testée sans réseau.
export function buildClientReminderEmail({ studioName, galleryTitle, clientName, daysLeft, selectedCount, galleryUrl, lang }) {
  if (lang === "en") return clientReminderEn({ studioName, galleryTitle, clientName, daysLeft, selectedCount, galleryUrl });
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
export function buildPhotographerReminderEmail({ galleryTitle, clientName, daysLeft, selectedCount, adminUrl, lang }) {
  if (lang === "en") return photographerReminderEn({ galleryTitle, clientName, daysLeft, selectedCount, adminUrl });
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
export function buildSelectionValidatedEmail({ galleryTitle, clientName, selectedCount, dueExtraCount, dueTotalCents, adminUrl, lang }) {
  if (lang === "en") return selectionValidatedEn({ galleryTitle, clientName, selectedCount, dueExtraCount, dueTotalCents, adminUrl });
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
export function buildPrintOrderConfirmationEmail({ studioName, galleryTitle, recipientName, lines, shippingCents, totalCents, invoiceNumber, lang }) {
  if (lang === "en") return printOrderConfirmationEn({ studioName, galleryTitle, recipientName, lines, shippingCents, totalCents, invoiceNumber });
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
export function buildPrintOrderPhotographerEmail({ galleryTitle, recipientName, lines, totalCents, labStatus, labError, adminUrl, lang }) {
  if (lang === "en") return printOrderPhotographerEn({ galleryTitle, recipientName, lines, totalCents, labStatus, labError, adminUrl });
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
export function buildDeliveryReadyEmail({ studioName, galleryTitle, clientName, count, galleryUrl, lang }) {
  if (lang === "en") return deliveryReadyEn({ studioName, galleryTitle, clientName, count, galleryUrl });
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

export function buildPrintPromoEmail({ studioName, galleryTitle, clientName, percent, endsAt, favoritesCount, galleryUrl, lang }) {
  if (lang === "en") return printPromoEn({ studioName, galleryTitle, clientName, percent, endsAt, favoritesCount, galleryUrl });
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

export function buildCartReminderEmail({ studioName, galleryTitle, clientName, items, promo, galleryUrl, lang }) {
  if (lang === "en") return cartReminderEn({ studioName, galleryTitle, clientName, items, promo, galleryUrl });
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

export function buildFavoritesPrintEmail({ studioName, galleryTitle, clientName, favoritesCount, promo, galleryUrl, lang }) {
  if (lang === "en") return favoritesPrintEn({ studioName, galleryTitle, clientName, favoritesCount, promo, galleryUrl });
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

export function buildPrintOrderShippedEmail({ studioName, galleryTitle, recipientName, trackingUrl, lang }) {
  if (lang === "en") return printOrderShippedEn({ studioName, galleryTitle, recipientName, trackingUrl });
  const subject = `Vos tirages sont en route — ${galleryTitle}`;
  const bodyHtml =
    eyebrow(studioName || "Commande de tirages") +
    heading("Vos tirages sont en route") +
    paragraph(`${recipientName ? escapeHtml(recipientName) + ", v" : "V"}os tirages de « <strong>${escapeHtml(galleryTitle)}</strong> » viennent d'être expédiés.`) +
    (trackingUrl ? emailButton(trackingUrl, "Suivre mon colis") : paragraph("Le transporteur ne fournit pas de lien de suivi pour cet envoi.", { small: true }));
  const text = `Vos tirages de « ${galleryTitle} » viennent d'être expédiés.${trackingUrl ? `\n\nSuivi : ${trackingUrl}` : ""}`;
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

export function buildStoragePurgeNoticeEmail({ studioName, galleryTitle, deliveryCount, originalCount, sizeLabel, purgeAt, adminUrl, lang }) {
  if (lang === "en") return storagePurgeEn({ studioName, galleryTitle, deliveryCount, originalCount, sizeLabel, purgeAt, adminUrl });
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

/* ---------- Réservations (booking.js) ---------- */

function durationLabel(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

// « 10 photos retouchées (Complète) » pour une formule à plusieurs tarifs.
function bookingTierLabel({ photos, tierLabel }) {
  if (!photos) return "";
  return `${photos} photo${photos > 1 ? "s" : ""} retouchée${photos > 1 ? "s" : ""}${tierLabel ? ` (${tierLabel})` : ""}`;
}

function bookingDetailsHtml({ offerTitle, when, durationMin, location, depositCents, priceCents, photos, tierLabel }) {
  const rest = priceCents > depositCents ? priceCents - depositCents : 0;
  const tier = bookingTierLabel({ photos, tierLabel });
  return [
    `<strong>Séance :</strong> ${escapeHtml(offerTitle)} (${escapeHtml(durationLabel(durationMin))})`,
    tier ? `<strong>Formule :</strong> ${escapeHtml(tier)}, ${escapeHtml(formatEuros(priceCents))}` : "",
    `<strong>Quand :</strong> ${escapeHtml(when)}`,
    location ? `<strong>Où :</strong> ${escapeHtml(location)}` : "",
    depositCents ? `<strong>Acompte réglé :</strong> ${escapeHtml(formatEuros(depositCents))}` : "",
    rest && depositCents ? `<strong>Reste à régler :</strong> ${escapeHtml(formatEuros(rest))}` : "",
    priceCents && !depositCents ? `<strong>Prix :</strong> ${escapeHtml(formatEuros(priceCents))}` : "",
  ].filter(Boolean).join("<br>");
}

function bookingDetailsText({ offerTitle, when, durationMin, location, depositCents, priceCents, photos, tierLabel }) {
  const rest = priceCents > depositCents ? priceCents - depositCents : 0;
  const tier = bookingTierLabel({ photos, tierLabel });
  return [
    `Séance : ${offerTitle} (${durationLabel(durationMin)})`,
    tier ? `Formule : ${tier}, ${formatEuros(priceCents)}` : "",
    `Quand : ${when}`,
    location ? `Où : ${location}` : "",
    depositCents ? `Acompte réglé : ${formatEuros(depositCents)}` : "",
    rest && depositCents ? `Reste à régler : ${formatEuros(rest)}` : "",
    priceCents && !depositCents ? `Prix : ${formatEuros(priceCents)}` : "",
  ].filter(Boolean).join("\n");
}

// Ce que le client doit savoir avant de venir : ce qui est compris dans son
// forfait, et le conseil vestimentaire du photographe.
function bookingNoteHtml(title, text) {
  return `<div style="margin:0 0 14px;padding:14px 16px;background:${CREAM};border-radius:10px;font-family:${SANS};font-size:15px;line-height:1.6;color:${CHARCOAL};">` +
    `<strong style="display:block;margin-bottom:4px;">${escapeHtml(title)}</strong><span style="white-space:pre-wrap;">${escapeHtml(text)}</span></div>`;
}

function bookingNotesHtml({ included, dressCode }, { withIncluded = true } = {}) {
  return (withIncluded && included ? bookingNoteHtml("Compris dans votre forfait", included) : "") +
    (dressCode ? bookingNoteHtml("Conseil vestimentaire", dressCode) : "");
}

function bookingNotesText({ included, dressCode }, { withIncluded = true } = {}) {
  return [
    withIncluded && included ? `\n\nCompris dans votre forfait :\n${included}` : "",
    dressCode ? `\n\nConseil vestimentaire :\n${dressCode}` : "",
  ].join("");
}

function studioContactLine({ studioName, studioEmail, studioPhone }) {
  return [studioEmail, studioPhone].filter(Boolean).length
    ? `Une question ? Répondez simplement à cet e-mail${studioPhone ? ` ou appelez ${escapeHtml(studioName)} au ${escapeHtml(studioPhone)}` : ""}.`
    : "";
}

/* ---------- Bons cadeaux (giftcards.js) ---------- */

function giftSummaryHtml(p) {
  const seance = p.offerTitle
    ? `<strong>${escapeHtml(p.offerTitle)}</strong>${p.duration ? ` · ${escapeHtml(p.duration)}` : ""}${p.tierPhotos ? ` · ${p.tierPhotos} photo${p.tierPhotos > 1 ? "s" : ""}` : ""}`
    : "<strong>Une séance photo, au choix</strong>";
  return [
    seance,
    `Valeur : <strong>${escapeHtml(p.amount)}</strong>`,
    `Pour ${escapeHtml(p.toName)}, de la part de ${escapeHtml(p.fromName)}`,
    `Valable jusqu'au ${escapeHtml(p.validUntil)}`,
    `Code : <strong style="letter-spacing:.06em;">${escapeHtml(p.code)}</strong>`,
  ].join("<br>");
}

function giftSummaryText(p) {
  return [
    p.offerTitle ? `${p.offerTitle}${p.duration ? ` · ${p.duration}` : ""}${p.tierPhotos ? ` · ${p.tierPhotos} photos` : ""}` : "Une séance photo, au choix",
    `Valeur : ${p.amount}`,
    `Pour ${p.toName}, de la part de ${p.fromName}`,
    `Valable jusqu'au ${p.validUntil}`,
    `Code : ${p.code}`,
  ].join("\n");
}

function giftMessageHtml(message) {
  return message
    ? `<div style="margin:0 0 14px;padding:14px 16px;background:${CREAM};border-radius:10px;font-family:${SERIF};font-style:italic;font-size:16px;line-height:1.6;color:${CHARCOAL};white-space:pre-wrap;">« ${escapeHtml(message)} »</div>`
    : "";
}

export function buildGiftCardBuyerEmail(p) {
  const subject = `Votre bon cadeau pour ${p.toName} — ${p.studioName}`;
  const bodyHtml =
    eyebrow(p.studioName || "Votre photographe") +
    heading("Votre bon cadeau est prêt") +
    paragraph(`Merci ! Voici le bon cadeau offert à ${escapeHtml(p.toName)}, en PDF dans cet e-mail : imprimez-le, ou transférez-le simplement.`) +
    paragraph(giftSummaryHtml(p)) +
    giftMessageHtml(p.message) +
    paragraph(`En scannant le QR code du bon, ou sur ${escapeHtml(p.typedUrl)} avec le code, ${escapeHtml(p.toName)} découvrira ce qui lui est offert.`) +
    emailButton(p.pageUrl, "Voir le bon cadeau") +
    (studioContactLine(p) ? paragraph(studioContactLine(p), { small: true }) : "");
  const text = [
    `Votre bon cadeau pour ${p.toName} est prêt (PDF joint).`,
    "",
    giftSummaryText(p),
    p.message ? `\n« ${p.message} »` : "",
    "",
    `Le bon en ligne : ${p.pageUrl}`,
  ].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

export function buildGiftCardRecipientEmail(p) {
  const subject = `${p.fromName} vous offre une séance photo chez ${p.studioName}`;
  const bodyHtml =
    eyebrow(p.studioName || "Votre photographe") +
    heading(`Un cadeau pour vous, ${escapeHtml(p.toName)} !`) +
    paragraph(`${escapeHtml(p.fromName)} vous offre un bon cadeau chez ${escapeHtml(p.studioName)}.`) +
    giftMessageHtml(p.message) +
    paragraph(giftSummaryHtml(p)) +
    emailButton(p.pageUrl, "Découvrir mon cadeau") +
    paragraph("Le bon est joint en PDF. Pour réserver votre séance, contactez le studio en indiquant votre code.", { small: true });
  const text = [
    `${p.fromName} vous offre un bon cadeau chez ${p.studioName}.`,
    p.message ? `\n« ${p.message} »` : "",
    "",
    giftSummaryText(p),
    "",
    `Votre bon : ${p.pageUrl}`,
  ].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

export function buildGiftCardSoldEmail(p) {
  const subject = `Bon cadeau vendu : ${p.amount} pour ${p.toName}`;
  const bodyHtml =
    eyebrow("Bon cadeau") +
    heading("Un bon cadeau vient d'être offert") +
    paragraph(giftSummaryHtml(p)) +
    giftMessageHtml(p.message) +
    paragraph(`<strong>Acheteur :</strong> <a href="mailto:${escapeHtml(p.buyerEmail)}" style="color:${ROSE_DEEP};">${escapeHtml(p.buyerEmail)}</a>`) +
    (p.adminUrl ? emailButton(p.adminUrl, "Voir mes bons cadeaux") : "") +
    paragraph("Le montant arrive sur votre compte Stripe. À la séance, marquez le bon comme utilisé.", { small: true });
  const text = [
    "Un bon cadeau vient d'être offert.",
    "",
    giftSummaryText(p),
    "",
    `Acheteur : ${p.buyerEmail}`,
    p.adminUrl ? `\nVos bons cadeaux : ${p.adminUrl}` : "",
  ].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

export function buildBookingConfirmationEmail(params) {
  const { studioName, clientName, offerTitle } = params;
  const subject = `Votre séance « ${offerTitle} » est réservée`;
  const bodyHtml =
    eyebrow(studioName || "Votre photographe") +
    heading(`C'est noté${clientName ? `, ${escapeHtml(clientName)}` : ""} !`) +
    paragraph(bookingDetailsHtml(params)) +
    bookingNotesHtml(params) +
    paragraph("L'invitation jointe ajoute la séance à votre agenda. Vous recevrez un petit rappel la veille.") +
    (studioContactLine(params) ? paragraph(studioContactLine(params), { small: true }) : "");
  const text = [
    `Votre séance avec ${studioName} est réservée.`,
    "",
    bookingDetailsText(params) + bookingNotesText(params),
    "",
    "L'invitation jointe ajoute la séance à votre agenda. Vous recevrez un rappel la veille.",
  ].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

export function buildBookingPhotographerEmail(params) {
  const { clientName, clientEmail, clientPhone, message, when, adminUrl } = params;
  const subject = `Nouvelle réservation : ${clientName}, ${when}`;
  const contact = [
    `<strong>Client :</strong> ${escapeHtml(clientName)}`,
    `<strong>E-mail :</strong> <a href="mailto:${escapeHtml(clientEmail)}" style="color:${ROSE_DEEP};">${escapeHtml(clientEmail)}</a>`,
    clientPhone ? `<strong>Téléphone :</strong> ${escapeHtml(clientPhone)}` : "",
  ].filter(Boolean).join("<br>");
  const bodyHtml =
    eyebrow("Réservation en ligne") +
    heading("Une séance vient d'être réservée") +
    paragraph(bookingDetailsHtml(params)) +
    paragraph(contact) +
    (message ? `<div style="margin:0 0 14px;padding:14px 16px;background:${CREAM};border-radius:10px;font-family:${SANS};font-size:15px;line-height:1.6;color:${CHARCOAL};white-space:pre-wrap;">${escapeHtml(message)}</div>` : "") +
    (adminUrl ? emailButton(adminUrl, "Voir mes réservations") : "") +
    paragraph("L'invitation jointe ajoute la séance à votre agenda. Répondez à cet e-mail pour écrire au client.", { small: true });
  const text = [
    "Une séance vient d'être réservée.",
    "",
    bookingDetailsText(params),
    "",
    `Client : ${clientName} — ${clientEmail}${clientPhone ? " — " + clientPhone : ""}`,
    message ? `\n${message}` : "",
    adminUrl ? `\nVos réservations : ${adminUrl}` : "",
  ].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

export function buildBookingReminderEmail(params) {
  const { studioName, offerTitle, when } = params;
  const subject = `Rappel : votre séance ${when}`;
  const bodyHtml =
    eyebrow(studioName || "Votre photographe") +
    heading("À très vite !") +
    paragraph(`Petit rappel de votre séance « ${escapeHtml(offerTitle)} ».`) +
    paragraph(bookingDetailsHtml(params)) +
    bookingNotesHtml(params, { withIncluded: false }) +
    (studioContactLine(params) ? paragraph(studioContactLine(params), { small: true }) : "");
  const text = [`Rappel de votre séance avec ${studioName}.`, "", bookingDetailsText(params) + bookingNotesText(params, { withIncluded: false })].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

export function buildBookingCancelledEmail(params) {
  const { studioName, offerTitle, when, depositCents, note } = params;
  const subject = `Séance annulée : ${offerTitle}, ${when}`;
  const bodyHtml =
    eyebrow(studioName || "Votre photographe") +
    heading("Votre séance est annulée") +
    paragraph(`${escapeHtml(studioName)} a annulé la séance « ${escapeHtml(offerTitle)} » prévue ${escapeHtml(when)}.`) +
    (note ? `<div style="margin:0 0 14px;padding:14px 16px;background:${CREAM};border-radius:10px;font-family:${SANS};font-size:15px;line-height:1.6;color:${CHARCOAL};white-space:pre-wrap;">${escapeHtml(note)}</div>` : "") +
    (depositCents ? paragraph(`L'acompte de ${escapeHtml(formatEuros(depositCents))} vous sera remboursé par le studio.`) : "") +
    (studioContactLine(params) ? paragraph(studioContactLine(params), { small: true }) : "");
  const text = [
    `${studioName} a annulé la séance « ${offerTitle} » prévue ${when}.`,
    note ? `\n${note}` : "",
    depositCents ? `\nL'acompte de ${formatEuros(depositCents)} vous sera remboursé par le studio.` : "",
  ].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

export function buildBookingConflictEmail(params) {
  const { clientName, clientEmail, when, offerTitle, depositCents, adminUrl } = params;
  const subject = `À rembourser : acompte de ${clientName} (créneau déjà repris)`;
  const bodyHtml =
    eyebrow("Réservation en ligne") +
    heading("Un acompte est arrivé trop tard") +
    paragraph(`${escapeHtml(clientName)} (${escapeHtml(clientEmail)}) a payé l'acompte de ${escapeHtml(formatEuros(depositCents))} pour « ${escapeHtml(offerTitle)} », ${escapeHtml(when)}, après l'expiration du délai de paiement : le créneau avait été repris entre-temps.`) +
    paragraph("Proposez-lui un autre horaire, ou remboursez l'acompte depuis votre tableau de bord Stripe (Paiements).") +
    (adminUrl ? emailButton(adminUrl, "Voir mes réservations") : "");
  const text = `${clientName} (${clientEmail}) a payé l'acompte de ${formatEuros(depositCents)} pour « ${offerTitle} », ${when}, mais le créneau avait été repris. Proposez un autre horaire ou remboursez l'acompte depuis Stripe.`;
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

/* ---------- Devis et contrats (contracts.js) ---------- */

function contractSummaryHtml({ title, sessionDate, totalCents, depositCents }) {
  return [
    `<strong>${escapeHtml(title)}</strong>`,
    sessionDate ? `Date prévue : ${escapeHtml(sessionDate)}` : "",
    `Total : ${escapeHtml(formatEuros(totalCents))}`,
    depositCents ? `Acompte à la signature : ${escapeHtml(formatEuros(depositCents))}` : "",
  ].filter(Boolean).join("<br>");
}

export function buildContractToClientEmail(params) {
  const { studioName, clientName, number, title, url, validUntil, depositCents } = params;
  const subject = `${studioName} : votre devis « ${title} »`;
  const bodyHtml =
    eyebrow(studioName || "Votre photographe") +
    heading(`Bonjour ${escapeHtml(clientName)},`) +
    paragraph(`Voici votre devis n° ${escapeHtml(number)}. Vous pouvez le lire, puis le signer en ligne${depositCents ? " et régler l'acompte" : ""} : tout se fait depuis le lien ci-dessous, sans compte à créer.`) +
    paragraph(contractSummaryHtml(params)) +
    emailButton(url, "Consulter et signer") +
    (validUntil ? paragraph(`Ce devis est valable jusqu'au ${escapeHtml(formatDay(validUntil))}.`, { small: true }) : "") +
    paragraph("Une question ? Répondez simplement à cet e-mail.", { small: true });
  const text = [
    `Bonjour ${clientName},`,
    "",
    `Voici votre devis n° ${number} : ${title}.`,
    `Consulter et signer : ${url}`,
    validUntil ? `Valable jusqu'au ${formatDay(validUntil)}.` : "",
  ].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

export function buildContractSignedEmail(params) {
  const { studioName, number, title, url, depositDue } = params;
  const subject = `Contrat signé : ${title}`;
  const bodyHtml =
    eyebrow(studioName || "Votre photographe") +
    heading("Merci, votre contrat est signé") +
    paragraph(`Vous trouverez en pièce jointe le contrat n° ${escapeHtml(number)} signé, à conserver.`) +
    paragraph(contractSummaryHtml(params)) +
    (depositDue ? paragraph("Il reste à régler l'acompte : si le paiement a été interrompu, reprenez-le depuis le lien ci-dessous.") + emailButton(url, "Régler l'acompte") : "");
  const text = [`Votre contrat n° ${number} (${title}) est signé : il est joint à cet e-mail.`, depositDue ? `Acompte à régler : ${url}` : ""].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

export function buildContractSignedNoticeEmail(params) {
  const { clientName, signerName, number, title, adminUrl, depositCents } = params;
  const subject = `${clientName} a signé le contrat ${number}`;
  const bodyHtml =
    eyebrow("Devis et contrats") +
    heading("Contrat signé") +
    paragraph(`${escapeHtml(signerName || clientName)} a signé le contrat n° ${escapeHtml(number)} « ${escapeHtml(title)} ». Le PDF signé est joint.`) +
    paragraph(contractSummaryHtml(params)) +
    (depositCents ? paragraph("Vous recevrez un autre e-mail dès que l'acompte sera réglé.", { small: true }) : "") +
    (adminUrl ? emailButton(adminUrl, "Voir mes devis et contrats") : "");
  const text = `${signerName || clientName} a signé le contrat n° ${number} (${title}). Le PDF signé est joint.`;
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

export function buildContractDepositPaidEmail(params, forPhotographer) {
  const { studioName, clientName, number, title, depositCents, adminUrl } = params;
  const subject = forPhotographer ? `Acompte reçu : ${clientName}, contrat ${number}` : `Acompte reçu, merci : ${title}`;
  const bodyHtml = forPhotographer
    ? eyebrow("Devis et contrats") + heading("Acompte reçu") +
      paragraph(`${escapeHtml(clientName)} a réglé l'acompte de ${escapeHtml(formatEuros(depositCents))} pour le contrat n° ${escapeHtml(number)} « ${escapeHtml(title)} ».`) +
      (adminUrl ? emailButton(adminUrl, "Voir mes devis et contrats") : "")
    : eyebrow(studioName || "Votre photographe") + heading("Acompte bien reçu") +
      paragraph(`Votre acompte de ${escapeHtml(formatEuros(depositCents))} pour « ${escapeHtml(title)} » est réglé : votre réservation est confirmée.`) +
      paragraph("Une question ? Répondez simplement à cet e-mail.", { small: true });
  const text = forPhotographer
    ? `${clientName} a réglé l'acompte de ${formatEuros(depositCents)} (contrat ${number}).`
    : `Votre acompte de ${formatEuros(depositCents)} pour « ${title} » est réglé.`;
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

export function buildContractDeclinedEmail(params) {
  const { clientName, number, title, reason, adminUrl } = params;
  const subject = `${clientName} a refusé le devis ${number}`;
  const bodyHtml =
    eyebrow("Devis et contrats") +
    heading("Devis refusé") +
    paragraph(`${escapeHtml(clientName)} a refusé le devis n° ${escapeHtml(number)} « ${escapeHtml(title)} ».`) +
    (reason ? `<div style="margin:0 0 14px;padding:14px 16px;background:${CREAM};border-radius:10px;font-family:${SANS};font-size:15px;line-height:1.6;color:${CHARCOAL};white-space:pre-wrap;">${escapeHtml(reason)}</div>` : "") +
    (adminUrl ? emailButton(adminUrl, "Voir mes devis et contrats") : "");
  const text = `${clientName} a refusé le devis n° ${number} (${title}).${reason ? "\n\n" + reason : ""}`;
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

/* ---------- Factures libres et relances de paiement (clientinvoices.js) ---------- */

function invoiceDay(day) {
  return day ? new Date(day + "T12:00:00Z").toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
}

function scheduleHtml(schedule) {
  if (!schedule || schedule.length < 2) return "";
  return paragraph(schedule.map((s) =>
    `${escapeHtml(s.label)} : ${escapeHtml(formatEuros(s.amountCents))} — ${s.paidAt ? "réglé" : `pour le ${escapeHtml(invoiceDay(s.dueDate))}`}`
  ).join("<br>"));
}

function howToPayHtml(p) {
  return paragraph([
    p.canPayOnline ? "Réglez en ligne (carte, Bancontact) depuis la facture." : "",
    p.iban ? `Ou par virement : ${escapeHtml(p.iban)}, communication « facture ${escapeHtml(p.number)} ».` : "",
  ].filter(Boolean).join(" "), { small: true });
}

export function buildClientInvoiceEmail(p) {
  if (p.credit) {
    const subject = `Note de crédit ${p.number} — ${p.studioName}`;
    const bodyHtml = eyebrow(p.studioName || "Votre photographe") + heading("Note de crédit") +
      paragraph(`Voici la note de crédit n° ${escapeHtml(p.number)}${p.title ? ` (« ${escapeHtml(p.title)} »)` : ""}, en PDF dans cet e-mail.`) +
      paragraph("Une question ? Répondez simplement à cet e-mail.", { small: true });
    return { subject, html: emailShell({ preheader: subject, bodyHtml }), text: `Note de crédit n° ${p.number} (PDF joint).` };
  }
  const subject = `Facture ${p.number} — ${p.studioName}`;
  const due = p.nextDue;
  const bodyHtml =
    eyebrow(p.studioName || "Votre photographe") +
    heading(`Votre facture${p.clientName ? `, ${escapeHtml(p.clientName)}` : ""}`) +
    paragraph(`Facture n° ${escapeHtml(p.number)}${p.title ? ` — ${escapeHtml(p.title)}` : ""} : <strong>${escapeHtml(formatEuros(p.totalCents))}</strong>.` +
      (due ? `<br>À régler : ${escapeHtml(formatEuros(due.amountCents))} pour le ${escapeHtml(invoiceDay(due.dueDate))}.` : "<br>Elle est déjà réglée, merci !")) +
    scheduleHtml(p.schedule) +
    emailButton(p.pageUrl, due && p.canPayOnline ? "Voir et régler la facture" : "Voir la facture") +
    (due ? howToPayHtml(p) : "") +
    paragraph("La facture est aussi jointe en PDF.", { small: true });
  const text = [
    `Facture n° ${p.number} — ${formatEuros(p.totalCents)}.`,
    due ? `À régler : ${formatEuros(due.amountCents)} pour le ${invoiceDay(due.dueDate)}.` : "Déjà réglée, merci !",
    "",
    `La facture : ${p.pageUrl}`,
  ].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

// Étapes : 1 = trois jours avant l'échéance, 2 = le lendemain, 3 = une semaine après.
export function buildClientInvoiceReminderEmail(p) {
  const i = p.installment;
  const amount = formatEuros(i.amountCents);
  const subject = p.stage === 1
    ? `Rappel : ${amount} à régler le ${invoiceDay(i.dueDate)} — facture ${p.number}`
    : p.stage === 2
      ? `Facture ${p.number} : échéance du ${invoiceDay(i.dueDate)} dépassée`
      : `Second rappel : facture ${p.number} en attente de paiement`;
  const lede = p.stage === 1
    ? `Petit rappel : l'échéance « ${escapeHtml(i.label)} » de la facture n° ${escapeHtml(p.number)}, soit <strong>${escapeHtml(amount)}</strong>, est à régler le ${escapeHtml(invoiceDay(i.dueDate))}.`
    : `Sauf erreur de notre part, l'échéance « ${escapeHtml(i.label)} » de la facture n° ${escapeHtml(p.number)}, soit <strong>${escapeHtml(amount)}</strong>, prévue le ${escapeHtml(invoiceDay(i.dueDate))}, n'est pas encore réglée.`;
  const bodyHtml =
    eyebrow(p.studioName || "Votre photographe") +
    heading(p.stage === 1 ? "Petit rappel" : p.stage === 2 ? "Échéance dépassée" : "Second rappel") +
    paragraph(lede) +
    emailButton(p.pageUrl, p.canPayOnline ? "Régler en ligne" : "Voir la facture") +
    howToPayHtml(p) +
    paragraph("Si le paiement est déjà parti, merci de ne pas tenir compte de ce message. Une question ? Répondez simplement à cet e-mail.", { small: true });
  const text = [`${p.stage === 1 ? "Rappel" : "Échéance dépassée"} : ${i.label}, ${amount}, facture n° ${p.number}, pour le ${invoiceDay(i.dueDate)}.`, "", `La facture : ${p.pageUrl}`].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

export function buildClientInvoicePaidEmail(p) {
  const subject = `Paiement reçu : ${formatEuros(p.amountCents)}, facture ${p.number}`;
  const bodyHtml =
    eyebrow("Facturation") + heading("Paiement reçu") +
    paragraph(`${escapeHtml(p.clientName || p.clientEmail)} a réglé en ligne « ${escapeHtml(p.label)} » de la facture n° ${escapeHtml(p.number)} : <strong>${escapeHtml(formatEuros(p.amountCents))}</strong>.`) +
    (p.adminUrl ? emailButton(p.adminUrl, "Voir mes factures") : "");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text: `${p.clientName || p.clientEmail} a réglé ${formatEuros(p.amountCents)} (facture ${p.number}).` };
}

export function buildContractDepositReminderEmail(p) {
  const subject = `Rappel : acompte à régler pour « ${p.title} »`;
  const bodyHtml =
    eyebrow(p.studioName || "Votre photographe") +
    heading(p.stage === 1 ? "Votre acompte" : "Dernier rappel pour votre acompte") +
    paragraph(`Merci d'avoir signé le contrat « ${escapeHtml(p.title)} » ! L'acompte de <strong>${escapeHtml(formatEuros(p.depositCents))}</strong> confirme votre date : il n'est pas encore réglé.`) +
    emailButton(p.url, "Régler l'acompte") +
    paragraph("Si c'est déjà fait, merci de ne pas tenir compte de ce message. Une question ? Répondez simplement à cet e-mail.", { small: true });
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text: `Acompte de ${formatEuros(p.depositCents)} à régler : ${p.url}` };
}

/* ---------- Fiches clients (clients.js) ---------- */

export function buildClientDateReminderEmail({ clientName, clientEmail, title, date, daysUntil, message, mailto, adminUrl }) {
  const when = daysUntil === 0 ? "aujourd'hui" : daysUntil === 1 ? "demain" : `dans ${daysUntil} jours`;
  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Brussels" });
  const subject = `${title}, ${when} : proposez une séance à ${clientName}`;
  const bodyHtml =
    eyebrow("Vos clients") +
    heading(`${escapeHtml(title)}, ${escapeHtml(when)}`) +
    paragraph(`Le ${escapeHtml(day)} : une belle occasion de proposer une nouvelle séance à ${escapeHtml(clientName)} (${escapeHtml(clientEmail)}).`) +
    paragraph("Un message est prêt, à envoyer tel quel ou à retoucher :", { small: true }) +
    `<div style="margin:0 0 14px;padding:14px 16px;background:${CREAM};border-radius:10px;font-family:${SANS};font-size:15px;line-height:1.6;color:${CHARCOAL};white-space:pre-wrap;"><strong>${escapeHtml(message.subject)}</strong>\n\n${escapeHtml(message.body)}</div>` +
    emailButton(mailto, "Écrire à " + firstWord(clientName)) +
    (adminUrl ? paragraph(`<a href="${escapeHtml(adminUrl)}" style="color:${ROSE_DEEP};">Ouvrir la fiche client</a>`, { small: true }) : "");
  const text = [`${title}, ${when} (${day}).`, `Proposez une séance à ${clientName} (${clientEmail}).`, "", message.subject, "", message.body, adminUrl ? `\nFiche client : ${adminUrl}` : ""].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

// Temps fort du studio (séances de Noël…) : rappel au photographe, avec un
// message à envoyer à tous ses clients en copie cachée.
export function buildStudioSeasonReminderEmail({ title, date, daysUntil, recipients, message, mailto, adminUrl }) {
  const when = daysUntil === 0 ? "aujourd'hui" : daysUntil === 1 ? "demain" : `dans ${daysUntil} jours`;
  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Brussels" });
  const who = recipients === 1 ? "votre client" : `vos ${recipients} clients`;
  const subject = `${title} ${when} : proposez-les à ${who}`;
  const bodyHtml =
    eyebrow("Temps forts du studio") +
    heading(`${escapeHtml(title)}, ${escapeHtml(when)}`) +
    paragraph(`Vos séances commencent le ${escapeHtml(day)} : c'est le bon moment pour les proposer à ${escapeHtml(who)}, avant que les agendas se remplissent.`) +
    paragraph("Un message est prêt, à envoyer tel quel ou à retoucher :", { small: true }) +
    `<div style="margin:0 0 14px;padding:14px 16px;background:${CREAM};border-radius:10px;font-family:${SANS};font-size:15px;line-height:1.6;color:${CHARCOAL};white-space:pre-wrap;"><strong>${escapeHtml(message.subject)}</strong>\n\n${escapeHtml(message.body)}</div>` +
    emailButton(mailto, "Écrire à tous, en copie cachée") +
    (adminUrl ? paragraph(`<a href="${escapeHtml(adminUrl)}" style="color:${ROSE_DEEP};">Copier les adresses depuis l'onglet Clients</a>`, { small: true }) : "");
  const text = [`${title}, ${when} (${day}).`, `Proposez-les à ${who}.`, "", message.subject, "", message.body, adminUrl ? `\nOnglet Clients : ${adminUrl}` : ""].join("\n");
  return { subject, html: emailShell({ preheader: subject, bodyHtml }), text };
}

function firstWord(name) {
  return String(name || "").trim().split(/\s+/)[0] || "votre client";
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function sendInvoiceEmail(env, { to, galleryTitle, number, amountCents, pdfBytes, lang }) {
  await sendEmail(env, {
    to,
    ...buildInvoiceEmail({ galleryTitle, number, amountCents, lang }),
    attachments: [{ filename: `${lang === "en" ? "invoice" : "facture"}-${number}.pdf`, content: bytesToBase64(pdfBytes) }],
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
    ...(params.pdfBytes ? { attachments: [{ filename: `${params.lang === "en" ? "invoice" : "facture"}-${params.invoiceNumber}.pdf`, content: bytesToBase64(params.pdfBytes) }] } : {}),
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

function withAttachment(params) {
  return params.attachment ? { attachments: [params.attachment] } : {};
}

export async function sendBookingConfirmation(env, params) {
  await sendEmail(env, { to: params.to, replyTo: params.replyTo, ...buildBookingConfirmationEmail(params), ...withAttachment(params) });
}

export async function sendBookingPhotographerNotice(env, params) {
  await sendEmail(env, { to: params.to, replyTo: params.replyTo, ...buildBookingPhotographerEmail(params), ...withAttachment(params) });
}

export async function sendBookingReminder(env, params) {
  await sendEmail(env, { to: params.to, replyTo: params.replyTo, ...buildBookingReminderEmail(params) });
}

export async function sendBookingCancelled(env, params) {
  await sendEmail(env, { to: params.to, replyTo: params.replyTo, ...buildBookingCancelledEmail(params), ...withAttachment(params) });
}

export async function sendBookingConflict(env, params) {
  await sendEmail(env, { to: params.to, ...buildBookingConflictEmail(params) });
}

export async function sendContractToClient(env, params) {
  await sendEmail(env, { to: params.to, replyTo: params.replyTo, ...buildContractToClientEmail(params) });
}

export async function sendContractSigned(env, params) {
  await sendEmail(env, { to: params.to, replyTo: params.replyTo, ...buildContractSignedEmail(params), ...withAttachment(params) });
}

export async function sendContractSignedNotice(env, params) {
  await sendEmail(env, { to: params.to, replyTo: params.replyTo, ...buildContractSignedNoticeEmail(params), ...withAttachment(params) });
}

export async function sendContractDepositPaid(env, params) {
  await sendEmail(env, { to: params.to, replyTo: params.replyTo, ...buildContractDepositPaidEmail(params, false) });
  if (params.photographerTo) await sendEmail(env, { to: params.photographerTo, ...buildContractDepositPaidEmail(params, true) });
}

export async function sendContractDeclined(env, params) {
  await sendEmail(env, { to: params.to, ...buildContractDeclinedEmail(params) });
}

export async function sendClientDateReminder(env, params) {
  await sendEmail(env, { to: params.to, ...buildClientDateReminderEmail(params) });
}

export async function sendStudioSeasonReminder(env, params) {
  await sendEmail(env, { to: params.to, ...buildStudioSeasonReminderEmail(params) });
}

export async function sendClientInvoice(env, params) {
  await sendEmail(env, { to: params.to, replyTo: params.replyTo, ...buildClientInvoiceEmail(params), ...withAttachment(params) });
}

export async function sendClientInvoiceReminder(env, params) {
  await sendEmail(env, { to: params.to, replyTo: params.replyTo, ...buildClientInvoiceReminderEmail(params), ...withAttachment(params) });
}

export async function sendClientInvoicePaidNotice(env, params) {
  if (!params.to) return;
  await sendEmail(env, { to: params.to, ...buildClientInvoicePaidEmail(params) });
}

export async function sendContractDepositReminder(env, params) {
  await sendEmail(env, { to: params.to, replyTo: params.replyTo, ...buildContractDepositReminderEmail(params) });
}

export async function sendGiftCardToBuyer(env, params) {
  await sendEmail(env, { to: params.to, replyTo: params.replyTo, ...buildGiftCardBuyerEmail(params), ...withAttachment(params) });
}

export async function sendGiftCardToRecipient(env, params) {
  await sendEmail(env, { to: params.to, replyTo: params.replyTo, ...buildGiftCardRecipientEmail(params), ...withAttachment(params) });
}

export async function sendGiftCardSoldNotice(env, params) {
  await sendEmail(env, { to: params.to, replyTo: params.replyTo, ...buildGiftCardSoldEmail(params) });
}

export async function sendStoragePurgeNotice(env, params) {
  await sendEmail(env, { to: params.to, ...buildStoragePurgeNoticeEmail(params) });
}
