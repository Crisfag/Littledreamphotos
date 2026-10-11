// Vérifie les règles de la réservation en ligne sans réseau ni D1 : heure
// de Bruxelles (été, hiver, changements d'heure), séries de mini-séances,
// invitation de calendrier, e-mails.
//
//   node tests/booking.test.mjs

import { localToEpoch, seriesTimes, formatSlot, buildIcs } from "../src/booking.js";
import { PLANS } from "../src/subscription.js";
import {
  buildBookingConfirmationEmail,
  buildBookingPhotographerEmail,
  buildBookingCancelledEmail,
  buildBookingReminderEmail,
} from "../src/notify.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}
const iso = (s) => new Date(s * 1000).toISOString();

check("10 h à Bruxelles en hiver = 9 h UTC", iso(localToEpoch("2026-12-06", "10:00")) === "2026-12-06T09:00:00.000Z", iso(localToEpoch("2026-12-06", "10:00")));
check("10 h à Bruxelles en été = 8 h UTC", iso(localToEpoch("2027-06-14", "10:00")) === "2027-06-14T08:00:00.000Z", iso(localToEpoch("2027-06-14", "10:00")));
check("jour du passage à l'heure d'été : 14 h = 12 h UTC", iso(localToEpoch("2027-03-28", "14:00")) === "2027-03-28T12:00:00.000Z", iso(localToEpoch("2027-03-28", "14:00")));
check("jour du passage à l'heure d'hiver : 14 h = 13 h UTC", iso(localToEpoch("2026-10-25", "14:00")) === "2026-10-25T13:00:00.000Z", iso(localToEpoch("2026-10-25", "14:00")));
check("date ou heure impossibles refusées",
      localToEpoch("2027-02-31", "10:00") === null && localToEpoch("2027-01-10", "25:00") === null && localToEpoch("10/01/2027", "10:00") === null && localToEpoch("2027-01-10", "") === null);

const series = seriesTimes("10:00", "12:00", 20, 15);
check("série de mini-séances : toutes les 20 min, la dernière finit avant la fin de plage",
      series.join(",") === "10:00,10:20,10:40,11:00,11:20,11:40", series.join(","));
check("séance d'1 h de 14 h à 16 h, toutes les heures : 14 h et 15 h", seriesTimes("14:00", "16:00", 60, 60).join(",") === "14:00,15:00");
check("plage vide ou pas trop court refusés", seriesTimes("12:00", "10:00", 20, 15).length === 0 && seriesTimes("10:00", "12:00", 2, 15).length === 0);

const label = formatSlot(localToEpoch("2026-12-06", "10:20"));
check("horaire lisible, à l'heure de Bruxelles", label === "dimanche 6 décembre 2026 à 10 h 20", label);

const ics = buildIcs({ uid: "bkg_abc", startsAt: localToEpoch("2026-12-06", "10:20"), durationMin: 20, title: "Mini-séance Noël; Studio, Liège", location: "Parc de la Boverie" });
check("invitation .ics : début, fin, titre échappé, lignes CRLF",
      ics.includes("DTSTART:20261206T092000Z") && ics.includes("DTEND:20261206T094000Z") &&
      ics.includes("SUMMARY:Mini-séance Noël\\; Studio\\, Liège") && ics.includes("\r\nEND:VCALENDAR\r\n") && ics.includes("UID:bkg_abc@holypixx.com"));
check("invitation d'annulation", buildIcs({ uid: "x", startsAt: 0, durationMin: 10, title: "t", cancelled: true }).includes("METHOD:CANCEL"));

const params = {
  studioName: "Little Dream Photos", studioEmail: "studio@example.com", studioPhone: "+32 470 00 00 00",
  clientName: "Camille", clientEmail: "camille@example.com", clientPhone: "", message: "Avec notre chien <Rex>",
  offerTitle: "Mini-séance de Noël", when: "dimanche 6 décembre 2026 à 10 h 20", durationMin: 20,
  location: "Studio, Liège", depositCents: 3000, priceCents: 9000, adminUrl: "https://admin.example/#/reservations",
};
const confirmation = buildBookingConfirmationEmail(params);
check("e-mail client : formule, horaire, acompte et reste à régler",
      confirmation.subject.includes("Mini-séance de Noël") && confirmation.html.includes("30,00 €") && confirmation.html.includes("60,00 €") && confirmation.text.includes("10 h 20"));
const notice = buildBookingPhotographerEmail(params);
check("e-mail photographe : coordonnées du client, message échappé, lien vers l'admin",
      notice.html.includes("camille@example.com") && notice.html.includes("&lt;Rex&gt;") && notice.html.includes("#/reservations"));
check("e-mails d'annulation et de rappel", buildBookingCancelledEmail(params).html.includes("remboursé") && buildBookingReminderEmail(params).subject.startsWith("Rappel"));

check("réservation en ligne : Essentiel, Pro et Studio, pas Découverte ni Scolaire",
      PLANS.essentiel.features.booking && PLANS.pro.features.booking && PLANS.studio.features.booking && !PLANS.free.features.booking && !PLANS.scolaire.features.booking);

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} vérifications réussies`);
process.exit(failed ? 1 : 0);
