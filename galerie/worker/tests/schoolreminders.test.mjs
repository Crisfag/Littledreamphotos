// Rappels de commande aux familles (schoolreminders.js) : quel rappel est dû
// selon la date, sans réseau ni D1 (reminderKindFor est une fonction pure),
// et contenu de l'e-mail (buildSchoolReminderEmail).
//
//   node tests/schoolreminders.test.mjs

import { reminderKindFor, SCHOOL_REMINDERS_CRON } from "../src/schoolreminders.js";
import { buildSchoolReminderEmail } from "../src/notify.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const DAY = 86400;
const deadline = Date.UTC(2030, 5, 4, 21, 59, 59) / 1000; // 4 juin, 23 h 59 à Bruxelles
const late = Date.UTC(2030, 5, 20, 21, 59, 59) / 1000;
const year = { status: "open", family_reminders: 1, order_deadline: deadline, late_deadline: late };
const at = (days) => deadline - days * DAY;

check("à 10 jours de la date limite, rien", reminderKindFor(year, at(10)) === null);
check("de 7 à 3 jours avant : le premier rappel",
      ["j7", "j7", "j7"].join() === [at(6.9), at(5), at(2.1)].map((t) => reminderKindFor(year, t)).join());
check("dans les 2 derniers jours (jour même compris) : le dernier rappel, jamais les deux",
      reminderKindFor(year, at(2)) === "j2" && reminderKindFor(year, at(0.1)) === "j2" && reminderKindFor(year, deadline) === "j2");
check("après la commande groupée : rien, sauf dans les 2 derniers jours de la commande à domicile",
      reminderKindFor(year, deadline + 1) === null && reminderKindFor(year, late - 5 * DAY) === null &&
      reminderKindFor(year, late - 1.5 * DAY) === "late2" && reminderKindFor(year, late + 1) === null);
check("sans commande à domicile prévue, rien après la date limite",
      reminderKindFor({ ...year, late_deadline: null }, late - DAY) === null);
check("année pas en vente, rappels coupés par le photographe, ou sans date : rien",
      reminderKindFor({ ...year, status: "closed" }, at(3)) === null && reminderKindFor({ ...year, family_reminders: 0 }, at(3)) === null &&
      reminderKindFor({ ...year, order_deadline: null, late_deadline: null }, at(3)) === null);
check("le déclencheur des rappels ne tourne qu'en journée (7 h à 18 h 30 UTC)", SCHOOL_REMINDERS_CRON === "*/30 7-18 * * *");

const base = { studioName: "Studio Lumière", schoolName: "École du Centre", deadline, familyUrl: "https://www.holypixx.com/ecole", stopUrl: "https://www.holypixx.com/ecole?stop=fam_x.sig" };
const one = buildSchoolReminderEmail({ ...base, kind: "j7", childNames: ["Léa"], childrenCount: 1 });
const two = buildSchoolReminderEmail({ ...base, kind: "j2", childNames: ["Léa", "Tom"], childrenCount: 2 });
const unnamed = buildSchoolReminderEmail({ ...base, kind: "j7", childNames: ["Léa"], childrenCount: 2 });
const lateMail = buildSchoolReminderEmail({ ...base, kind: "late2", childNames: [], childrenCount: 1 });
check("e-mail : prénoms, établissement, date limite, lien vers l'espace famille",
      one.subject.includes("Léa") && one.subject.includes("4 juin") && one.html.includes("École du Centre") &&
      one.html.includes("https://www.holypixx.com/ecole") && one.text.includes("4 juin"), one.subject);
check("plusieurs enfants nommés ; « vos enfants » quand un prénom manque ; « votre enfant » sans prénom",
      two.subject.includes("Léa et Tom") && two.subject.startsWith("Dernier rappel") && unnamed.subject.includes("vos enfants") &&
      lateMail.subject.includes("votre enfant") && lateMail.html.includes("livraison à domicile"), [two.subject, unnamed.subject, lateMail.subject].join(" | "));
check("chaque rappel porte le lien pour ne plus en recevoir", [one, two, lateMail].every((m) => m.html.includes("?stop=fam_x.sig") && m.text.includes("?stop=fam_x.sig")));
check("un prénom n'est jamais injecté tel quel dans le HTML",
      !buildSchoolReminderEmail({ ...base, kind: "j7", childNames: ["<b>x</b>"], childrenCount: 1 }).html.includes("<b>x</b>"));

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
