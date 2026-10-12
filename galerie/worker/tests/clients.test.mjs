// Vérifie les règles des fiches clients sans réseau ni D1 : prochaine
// occurrence d'une date (29 février, jour même, passage d'année), libellés,
// messages proposés, lien mailto, e-mail de rappel.
//
//   node tests/clients.test.mjs

import { nextOccurrence, occasionLabel, suggestedMessage, mailtoUrl, REMINDER_LEAD_DAYS } from "../src/clients.js";
import { buildClientDateReminderEmail } from "../src/notify.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

let n = nextOccurrence("2025-11-02", "2026-10-12");
check("anniversaire à venir cette année : date, jours restants, âge", n.date === "2026-11-02" && n.daysUntil === 21 && n.years === 1, JSON.stringify(n));
n = nextOccurrence("2020-03-01", "2026-10-12");
check("anniversaire passé cette année : l'an prochain", n.date === "2027-03-01" && n.years === 7, JSON.stringify(n));
n = nextOccurrence("2024-10-12", "2026-10-12");
check("le jour même compte (0 jour)", n.daysUntil === 0 && n.years === 2);
n = nextOccurrence("2024-02-29", "2027-01-10");
check("né un 29 février : fêté le 28 les années non bissextiles", n.date === "2027-02-28" && n.years === 3, n.date);
n = nextOccurrence("2024-02-29", "2027-12-01");
check("… et le 29 les années bissextiles", n.date === "2028-02-29" && n.years === 4, n.date);
check("date invalide refusée", nextOccurrence("2026-02-30", "2026-10-12") === null && nextOccurrence("hier", "2026-10-12") === null);
check("une date de l'année n'a pas encore d'âge", nextOccurrence("2026-12-25", "2026-10-12").years === null);

check("libellés : âge, singulier et pluriel, mariage",
      occasionLabel("birthday", "Léa", 1) === "Léa aura 1 an" && occasionLabel("birthday", "Tom", 5) === "Tom aura 5 ans" &&
      occasionLabel("wedding", "Camille et Hugo", 10) === "10 ans de mariage : Camille et Hugo" && occasionLabel("other", "Rentrée", null) === "Rentrée");

const msg = suggestedMessage({ kind: "birthday", label: "Léa", years: 1, clientName: "Camille Dubois", studioName: "Little Dream Photos", bookingUrl: "https://studio.example/#reserver" });
check("message d'anniversaire : prénom du client, âge, lien de réservation, signature",
      msg.subject === "Une séance pour le premier anniversaire de Léa ?" && msg.body.startsWith("Bonjour Camille,") && msg.body.includes("fêter son premier anniversaire") &&
      suggestedMessage({ kind: "birthday", label: "Tom", years: 5, clientName: "", studioName: "" }).subject === "Une séance pour les 5 ans de Tom ?" &&
      msg.body.includes("https://studio.example/#reserver") && msg.body.endsWith("Little Dream Photos"), msg.subject);
const dormant = suggestedMessage({ clientName: "", studioName: "Studio", bookingUrl: "", dormant: true });
check("message de relance sans réservation en ligne : propose de répondre", dormant.body.startsWith("Bonjour,") && dormant.body.includes("quelles dates"));
check("aucun message au féminin ou au masculin pour le photographe", !/ravie?\b|heureuse?\b/.test(msg.body + dormant.body));

const mailto = mailtoUrl("camille@example.com", msg);
check("lien mailto : adresse lisible, sujet et corps encodés", mailto.startsWith("mailto:camille@example.com?subject=Une%20s%C3%A9ance") && mailto.includes("&body=Bonjour%20Camille"));

const email = buildClientDateReminderEmail({ clientName: "Camille <Dubois>", clientEmail: "camille@example.com", title: "Léa aura 1 an", date: "2026-11-02", daysUntil: REMINDER_LEAD_DAYS, message: msg, mailto, adminUrl: "https://admin/#/clients/camille%40example.com" });
check("e-mail de rappel : échéance, jour, message prêt, bouton d'écriture, nom échappé",
      email.subject.startsWith("Léa aura 1 an, dans 21 jours") && email.html.includes("lundi 2 novembre") && email.html.includes("Camille &lt;Dubois&gt;") &&
      email.html.includes("mailto:camille@example.com") && email.text.includes("Une séance pour le premier anniversaire de Léa ?"), email.subject);

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} vérifications réussies`);
process.exit(failed ? 1 : 0);
