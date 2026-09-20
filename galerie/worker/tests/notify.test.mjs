// Vérifie le contenu de l'e-mail d'alerte de capture, sans réseau ni
// wrangler dev : buildCaptureAlertEmail est une fonction pure.
//
//   node tests/notify.test.mjs

import { buildCaptureAlertEmail } from "../src/notify.js";

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

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
