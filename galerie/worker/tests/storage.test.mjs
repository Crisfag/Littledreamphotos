// Vérifie les règles de stockage sans réseau ni D1 : unités affichées,
// espace par formule, propriétaire illimitée, date de purge, e-mail de
// préavis.
//
//   node tests/storage.test.mjs

import { formatBytes, storageQuotaFor, purgeDateFor, storageRefusalMessage, PURGE_AFTER_EXPIRY_DAYS, PURGE_NOTICE_DAYS } from "../src/storage.js";
import { PLANS } from "../src/subscription.js";
import { buildStoragePurgeNoticeEmail } from "../src/notify.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

check("unités décimales lisibles",
      formatBytes(0) === "0 Mo" && formatBytes(850e6) === "850 Mo" && formatBytes(12.34e9) === "12 Go" &&
      formatBytes(1.25e9) === "1,3 Go" && formatBytes(1e12) === "1 To" && formatBytes(200e9) === "200 Go",
      [formatBytes(12.34e9), formatBytes(1.25e9)].join(" "));
check("espace par formule : 5 Go, 200 Go, 1 To",
      PLANS.free.storageBytes === 5e9 && PLANS.essentiel.storageBytes === 200e9 && PLANS.pro.storageBytes === 1000e9);
const env = { OWNER_EMAIL: "proprietaire@test.invalid" };
check("le quota suit la formule effective, la propriétaire est illimitée",
      storageQuotaFor(env, { email: "a@test.invalid", plan: "essentiel", plan_status: "active" }) === 200e9 &&
      storageQuotaFor(env, { email: "a@test.invalid", plan: "essentiel", plan_status: "canceled" }) === 5e9 &&
      storageQuotaFor(env, { email: "proprietaire@test.invalid" }) === null);
check("purge 90 jours après l'expiration, préavis 14 jours avant",
      PURGE_AFTER_EXPIRY_DAYS === 90 && PURGE_NOTICE_DAYS === 14 && purgeDateFor(1000) === 1000 + 90 * 86400 && purgeDateFor(null) === null);
check("message de refus clair", storageRefusalMessage(PLANS.essentiel, 200e9).includes("200 Go avec la formule Essentiel"));
const mail = buildStoragePurgeNoticeEmail({
  studioName: "Studio", galleryTitle: "Mariage <Martin>", deliveryCount: 2, originalCount: 1,
  sizeLabel: "1,2 Go", purgeAt: Math.floor(Date.parse("2027-01-15T12:00:00Z") / 1000), adminUrl: "https://admin.example/#/g/x",
});
check("e-mail de préavis : date, contenu, échappement, lien",
      mail.subject.includes("15 janvier") && mail.html.includes("2 photos livrées en haute définition (1,2 Go) et 1 fichier d") &&
      mail.html.includes("Mariage &lt;Martin&gt;") && mail.html.includes("https://admin.example/#/g/x") && mail.text.includes("Prolongez la galerie"),
      mail.subject);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
