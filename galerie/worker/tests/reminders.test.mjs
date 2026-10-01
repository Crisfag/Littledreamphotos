// Vérifie la logique de décision des relances (quelle relance est due pour
// une galerie, selon les jours restants et ce qui a déjà été envoyé), sans
// réseau ni D1 : remindersDue est une fonction pure.
//
//   node tests/reminders.test.mjs

import { remindersDue, galleryUrlFor } from "../src/reminders.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const none = new Set();
const due = (daysLeft, hasClientEmail = true, sent = none) => remindersDue({ daysLeft, hasClientEmail, sentKinds: sent });

check("à 10 jours de l'expiration, rien n'est dû", due(10).length === 0);
check("à 7 jours, la première relance client est due (et rien d'autre)", JSON.stringify(due(7)) === '["client_j7"]');
check("à 5 jours, toujours la première relance client si elle n'est pas partie", JSON.stringify(due(5)) === '["client_j7"]');
check("à 2 jours, la seconde relance client et celle du photographe sont dues",
      JSON.stringify(due(2)) === '["client_j2","photographer_j2"]');
check("à 1 jour (demain), même chose", JSON.stringify(due(1)) === '["client_j2","photographer_j2"]');
check("une galerie déjà expirée n'est plus relancée", due(0).length === 0 && due(-3).length === 0);
check("sans e-mail client, seule la relance photographe part à J-2",
      due(5, false).length === 0 && JSON.stringify(due(2, false)) === '["photographer_j2"]');
check("une relance déjà envoyée n'est jamais redue",
      due(6, true, new Set(["client_j7"])).length === 0 &&
      JSON.stringify(due(2, true, new Set(["client_j2"]))) === '["photographer_j2"]' &&
      due(1, true, new Set(["client_j2", "photographer_j2"])).length === 0);
check("la première relance client n'est pas rattrapée à J-2 si elle a été manquée (on n'envoie pas deux e-mails le même jour)",
      !due(2).includes("client_j7"));

check("le lien de galerie est construit depuis PUBLIC_SITE_ORIGIN, slug encodé",
      galleryUrlFor({ PUBLIC_SITE_ORIGIN: "https://www.holypixx.com/" }, "séance 1") === "https://www.holypixx.com/galerie.html?g=s%C3%A9ance%201");
check("sans PUBLIC_SITE_ORIGIN, pas de lien du tout", galleryUrlFor({}, "x") === "");

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
