// Vérifie le contenu de l'e-mail d'alerte de capture, sans réseau ni
// wrangler dev : buildCaptureAlertEmail est une fonction pure.
//
//   node tests/notify.test.mjs

import {
  buildCaptureAlertEmail, buildPasswordResetEmail, buildEmailChangeConfirmationEmail,
  buildClientReminderEmail, buildPhotographerReminderEmail, buildSelectionValidatedEmail,
  buildSchoolOrderConfirmationEmail,
} from "../src/notify.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const base = {
  studioName: "Studio Test",
  galleryTitle: "Séance Bambin",
  clientName: "Julie Peters",
  photoLabel: "Photo n° 3",
  reason: "impr-ecran",
  ts: 1_700_000_000,
  adminUrl: "https://holypixx-admin.onrender.com/",
};

const email = buildCaptureAlertEmail(base);
check("le sujet mentionne le titre de la galerie", email.subject.includes("Séance Bambin"));
check("le corps HTML référence la photo précise", email.html.includes("Photo n° 3"));
check("le corps texte référence aussi la photo précise", email.text.includes("Photo n° 3"));
check("le lien vers le tableau de bord est inclus", email.html.includes(base.adminUrl));

const withoutPhoto = buildCaptureAlertEmail({ ...base, photoLabel: "" });
check("sans photo identifiée, le message le dit plutôt que d'inventer une référence",
      withoutPhoto.html.includes("Aucune photo précise"));

const macos = buildCaptureAlertEmail({ ...base, reason: "capture-macos" });
check("la raison macOS est traduite en texte lisible", macos.html.includes("macOS"));

const briefAbsence = buildCaptureAlertEmail({ ...base, reason: "absence-breve" });
check("l'absence brève (macOS, raccourci non détectable) est traduite en texte lisible",
      briefAbsence.html.includes("changement de fenêtre"));

const unknownReason = buildCaptureAlertEmail({ ...base, reason: "quelque-chose-d-inconnu" });
check("une raison inconnue retombe sur un texte générique plutôt que de planter",
      unknownReason.html.includes("une capture d'écran"));

/* ---------- Échappement HTML : les champs viennent du photographe ---------- */
// studioName, galleryTitle et clientName sont saisis par le photographe à la
// création de la galerie ou de son compte — jamais du texte de confiance.

const hostile = buildCaptureAlertEmail({
  ...base,
  studioName: '<img src=x onerror=alert(1)>',
  galleryTitle: "<script>alert(2)</script>",
  clientName: "</p><b>injecté</b>",
});
check("le nom du studio est échappé dans le HTML", !hostile.html.includes("<img"));
check("le titre de la galerie est échappé dans le HTML", !hostile.html.includes("<script>"));
check("le nom du client est échappé dans le HTML", !hostile.html.includes("<b>injecté</b>"));

/* ---------- Réinitialisation de mot de passe ---------- */

const resetEmail = buildPasswordResetEmail({
  studioName: "Studio Test",
  resetUrl: "https://holypixx-admin.onrender.com/?reset=abc123",
  ts: 1_700_000_000,
});
check("le sujet évoque la réinitialisation", resetEmail.subject.toLowerCase().includes("réinitialisation"));
check("le lien de réinitialisation est inclus dans le HTML", resetEmail.html.includes("?reset=abc123"));
check("le lien de réinitialisation est inclus dans le texte", resetEmail.text.includes("?reset=abc123"));
check("le message précise que le lien est à usage unique et limité dans le temps",
      resetEmail.html.includes("une demi-heure") && resetEmail.html.includes("qu'une seule"));

const hostileReset = buildPasswordResetEmail({
  studioName: '<img src=x onerror=alert(1)>',
  resetUrl: "https://holypixx-admin.onrender.com/?reset=abc123",
  ts: 1_700_000_000,
});
check("le nom du studio est échappé dans l'e-mail de réinitialisation", !hostileReset.html.includes("<img"));

/* ---------- Changement d'adresse e-mail ---------- */
// Envoyé exclusivement à la NOUVELLE adresse (jamais l'ancienne) — c'est ce
// qui empêche un jeton de session volé de rediriger seul les notifications
// futures du compte. Mêmes exigences que la réinitialisation : lien à usage
// unique et limité dans le temps, nom du studio échappé.

const emailChangeEmail = buildEmailChangeConfirmationEmail({
  studioName: "Studio Test",
  confirmUrl: "https://holypixx-admin.onrender.com/?confirm-email=abc123",
  ts: 1_700_000_000,
});
check("le sujet évoque la confirmation d'une nouvelle adresse",
      emailChangeEmail.subject.toLowerCase().includes("confirmez") || emailChangeEmail.subject.toLowerCase().includes("adresse"));
check("le lien de confirmation est inclus dans le HTML", emailChangeEmail.html.includes("?confirm-email=abc123"));
check("le lien de confirmation est inclus dans le texte", emailChangeEmail.text.includes("?confirm-email=abc123"));
check("le message précise que le lien est à usage unique et limité dans le temps",
      emailChangeEmail.html.includes("une demi-heure") && emailChangeEmail.html.includes("qu'une seule"));

const hostileEmailChange = buildEmailChangeConfirmationEmail({
  studioName: '<img src=x onerror=alert(1)>',
  confirmUrl: "https://holypixx-admin.onrender.com/?confirm-email=abc123",
  ts: 1_700_000_000,
});
check("le nom du studio est échappé dans l'e-mail de confirmation d'adresse", !hostileEmailChange.html.includes("<img"));

/* ---------- Relances et sélection validée ---------- */

const clientReminder = buildClientReminderEmail({
  studioName: "Studio Test", galleryTitle: "Séance Bambin", clientName: "Julie Peters",
  daysLeft: 7, selectedCount: 3, galleryUrl: "https://www.holypixx.com/galerie.html?g=seance-bambin",
});
check("la relance client annonce l'échéance en jours et nomme la galerie",
      clientReminder.subject.includes("dans 7 jours") && clientReminder.subject.includes("Séance Bambin"));
check("la relance client rappelle le nombre de coups de cœur déjà posés et le bouton à cliquer",
      clientReminder.html.includes("3 coups de cœur") && clientReminder.html.includes("Valider ma sélection"));
check("la relance client contient le lien vers la galerie (HTML et texte)",
      clientReminder.html.includes("galerie.html?g=seance-bambin") && clientReminder.text.includes("galerie.html?g=seance-bambin"));

const clientReminderTomorrow = buildClientReminderEmail({
  studioName: "Studio Test", galleryTitle: "Séance Bambin", clientName: "", daysLeft: 1, selectedCount: 0, galleryUrl: "",
});
check("à J-1 la relance dit « demain » et, sans coup de cœur, invite à choisir",
      clientReminderTomorrow.subject.includes("demain") && clientReminderTomorrow.html.includes("pas encore choisi"));
check("sans adresse publique configurée, aucun bouton n'est inséré plutôt qu'un lien cassé",
      !clientReminderTomorrow.html.includes("href="));

const hostileReminder = buildClientReminderEmail({
  studioName: "<script>alert(1)</script>", galleryTitle: "<b>x</b>", clientName: "<i>y</i>", daysLeft: 2, selectedCount: 1, galleryUrl: "",
});
check("nom du studio, titre et nom du client sont échappés dans la relance client",
      !hostileReminder.html.includes("<script>") && !hostileReminder.html.includes("<b>") && !hostileReminder.html.includes("<i>"));

const photographerReminder = buildPhotographerReminderEmail({
  galleryTitle: "Séance Bambin", clientName: "Julie Peters", daysLeft: 2, selectedCount: 4, adminUrl: "https://holypixx-admin.onrender.com",
});
check("la relance photographe nomme le client, l'échéance et le tableau de bord",
      photographerReminder.subject.includes("Séance Bambin") && photographerReminder.html.includes("Julie Peters") &&
      photographerReminder.html.includes("dans 2 jours") && photographerReminder.html.includes("holypixx-admin.onrender.com"));

const validated = buildSelectionValidatedEmail({
  galleryTitle: "Séance Bambin", clientName: "Julie Peters", selectedCount: 12, dueExtraCount: 2, dueTotalCents: 3000, adminUrl: "",
});
check("l'e-mail de sélection validée donne le nombre de photos et le supplément dû",
      validated.subject.includes("Sélection validée") && validated.html.includes("12 photos") && validated.html.includes("2 photos au-delà") && validated.html.includes("30,00"));
const validatedNoDue = buildSelectionValidatedEmail({
  galleryTitle: "Séance Bambin", clientName: "", selectedCount: 1, dueExtraCount: 0, dueTotalCents: 0, adminUrl: "",
});
check("sans supplément, l'e-mail le dit explicitement et s'adresse à « votre client »",
      validatedNoDue.html.includes("Aucun supplément") && validatedNoDue.html.includes("Votre client"));

const schoolLines = [
  { name: "Pochette Classique", quantity: 2, priceCents: 2450, childName: "Léa" },
  { name: "Fichier numérique HD", quantity: 1, priceCents: 1000, childName: "Tom <b>" },
];
const atSchool = buildSchoolOrderConfirmationEmail({ studioName: "Studio Test", schoolName: "École du Centre", delivery: "school", lines: schoolLines, shippingCents: 0, totalCents: 5900, familyUrl: "https://www.holypixx.com/ecole", hasDigital: true });
const atHome = buildSchoolOrderConfirmationEmail({ studioName: "", schoolName: "École du Centre", delivery: "home", lines: schoolLines.slice(0, 1), shippingCents: 690, totalCents: 5590, familyUrl: "https://www.holypixx.com/ecole", hasDigital: false });
check("commande scolaire : détail par enfant, total, livraison à l'école et lien vers les fichiers numériques",
      atSchool.subject.includes("École du Centre") && atSchool.text.includes("2 × Pochette Classique — Léa") && atSchool.text.includes("59,00") &&
      atSchool.html.includes("remises à vos enfants") && atSchool.html.includes("https://www.holypixx.com/ecole") && !atSchool.html.includes("Tom <b>"));
check("commande scolaire à domicile : frais de port, pas de lien de téléchargement",
      atHome.text.includes("Livraison à domicile : 6,90") && atHome.html.includes("adresse indiquée") && !atHome.html.includes("/ecole"));

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
