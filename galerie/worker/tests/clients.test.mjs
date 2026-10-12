// Vérifie les règles des fiches clients sans réseau ni D1 : prochaine
// occurrence d'une date (29 février, jour même, passage d'année), libellés,
// messages proposés, lien mailto, e-mail de rappel.
//
//   node tests/clients.test.mjs

import { nextOccurrence, occasionLabel, suggestedMessage, mailtoUrl, REMINDER_LEAD_DAYS, addMonths, birthFromAge, babySteps, nextEvent, parsePlan } from "../src/clients.js";
import { buildClientDateReminderEmail, buildStudioSeasonReminderEmail } from "../src/notify.js";

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

/* ---------- Étapes d'un bébé, saisons, délai de rappel ---------- */

check("mois ajoutés : fin de mois et années bissextiles",
      addMonths("2026-01-31", 1) === "2026-02-28" && addMonths("2027-12-31", 2) === "2028-02-29" && addMonths("2026-10-05", -6) === "2026-04-05");
check("naissance estimée : 6 mois à la séance du 5 octobre → 5 avril ; nouveau-né → dix jours avant",
      birthFromAge("2026-10-05", 6) === "2026-04-05" && birthFromAge("2026-10-12", 0) === "2026-10-02");
check("étapes : seules les valeurs connues, sans doublon", parsePlan("3,6,6,7,y,12,x").join(",") === "3,6,y,12");
const steps = babySteps("2026-04-05", "6,9,12,y", "2026-10-12");
check("étapes à venir : 6 mois déjà passés, puis 9 mois, 1 an, 2 ans…",
      steps[0].months === 9 && steps[0].date === "2027-01-05" && steps[1].months === 12 && steps[2].months === 24, steps.slice(0, 3).map((x) => x.months).join(","));
const alex = { kind: "baby", label: "Alexandre", date: "2026-04-05", plan: "12,y", lead_days: 30, client_email: "helene@example.com" };
let ev = nextEvent(alex, "2026-10-12");
check("1 an d'Alexandre : rappel un mois avant (à ses 11 mois)",
      ev.title === "Alexandre aura 1 an" && ev.date === "2027-04-05" && ev.remindOn === "2027-03-06" && ev.key === 20270405 && ev.years === 1, JSON.stringify(ev));
ev = nextEvent({ ...alex, plan: "9,12" }, "2026-10-12");
check("étape en mois : « Alexandre aura 9 mois »", ev.title === "Alexandre aura 9 mois" && ev.months === 9 && ev.years === null);
check("plus aucune étape à venir : rien à rappeler", nextEvent({ ...alex, plan: "3,6" }, "2026-10-12") === null);
const nine = suggestedMessage({ kind: "baby", label: "Alexandre", months: 9, clientName: "Hélène Kul", studioName: "Little Dream" });
const oneYear = suggestedMessage({ kind: "baby", label: "Alexandre", years: 1, clientName: "Hélène Kul", studioName: "Little Dream" });
check("messages bébé : l'étape en mois, puis le premier anniversaire",
      nine.subject === "Alexandre aura bientôt 9 mois : une séance photo ?" && nine.body.startsWith("Bonjour Hélène,") &&
      oneYear.subject === "Une séance pour le premier anniversaire d'Alexandre ?", oneYear.subject);

const noel = { kind: "season", label: "noel", date: "2025-11-29", lead_days: 42, client_email: "camille@example.com" };
ev = nextEvent(noel, "2026-10-12");
check("séance de Noël : chaque année, rappel six semaines avant",
      ev.title === "Séance de Noël" && ev.date === "2026-11-29" && ev.remindOn === "2026-10-18" && ev.years === null, JSON.stringify(ev));
ev = nextEvent({ ...noel, client_email: "" }, "2026-10-12");
check("temps fort du studio : « Séances de Noël »", ev.title === "Séances de Noël");
check("délai par défaut selon le type, puis délai choisi",
      nextEvent({ kind: "birthday", label: "Léa", date: "2025-11-02" }, "2026-10-12").lead === 30 &&
      nextEvent({ kind: "other", label: "Rentrée", date: "2025-09-01" }, "2026-10-12").lead === 21 &&
      nextEvent({ kind: "season", label: "meres", date: "2026-05-10", lead_days: 60 }, "2026-10-12").lead === 60 &&
      nextEvent({ kind: "season", label: "meres", date: "2026-05-10", lead_days: 99 }, "2026-10-12").lead === 42);
const studioMsg = suggestedMessage({ kind: "season", label: "noel", clientName: "", studioName: "Little Dream", bookingUrl: "https://studio.example/#reserver", studio: true });
const clientMsg = suggestedMessage({ kind: "season", label: "meres", clientName: "Camille Dubois", studioName: "Little Dream" });
check("messages de saison : à tous (studio) ou au client (« cette année encore »)",
      studioMsg.subject === "Les séances de Noël sont ouvertes" && studioMsg.body.startsWith("Bonjour,") && studioMsg.body.includes("https://studio.example/#reserver") &&
      clientMsg.subject === "Fête des mères approche : une nouvelle séance ?" && clientMsg.body.includes("séances pour la fête des mères") && clientMsg.body.includes("cette année encore"), clientMsg.subject);
const seasonEmail = buildStudioSeasonReminderEmail({ title: "Séances de Noël", date: "2026-11-29", daysUntil: 42, recipients: 37, message: studioMsg, mailto: "mailto:?bcc=a@b.c&subject=x", adminUrl: "https://admin/#/clients" });
check("e-mail du temps fort : échéance, nombre de clients, copie cachée",
      seasonEmail.subject === "Séances de Noël dans 42 jours : proposez-les à vos 37 clients" && seasonEmail.html.includes("dimanche 29 novembre") &&
      seasonEmail.html.includes("copie cachée") && seasonEmail.text.includes("Les séances de Noël sont ouvertes"), seasonEmail.subject);

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} vérifications réussies`);
process.exit(failed ? 1 : 0);
