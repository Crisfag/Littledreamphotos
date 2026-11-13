// Suivi d'une séance, sans réseau ni D1 : liste récapitulative (lignes,
// e-mail), contrat proposé pour une réservation, rappel de signature,
// e-mail « votre galerie est en ligne » (lien, mot de passe, FR et EN).
//
//   node tests/suivi.test.mjs

import { prepItems, buildBookingPrepEmail, buildGalleryInviteEmail, buildContractToClientEmail } from "../src/notify.js";
import { bookingContractDraft } from "../src/contracts.js";
import { defaultPrep } from "../src/booking.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

/* ---------- Liste récapitulative ---------- */

const items = prepItems("- 2 tenues claires\n\n• Un doudou\n3) Arriver 10 min avant\n   \n— Plaid fourni");
check("une ligne par point, puces et numéros retirés, lignes vides ignorées",
      JSON.stringify(items) === JSON.stringify(["2 tenues claires", "Un doudou", "Arriver 10 min avant", "Plaid fourni"]), JSON.stringify(items));
check("40 points au plus", prepItems(Array.from({ length: 60 }, (_, i) => `point ${i}`).join("\n")).length === 40);
check("liste de la formule, sinon conseil vestimentaire", defaultPrep("  Tenues claires ", "x") === "Tenues claires" && defaultPrep("", "Tons doux") === "Tons doux" && defaultPrep("", "") === "");

const prep = buildBookingPrepEmail({
  studioName: "Studio <Lumière>", studioEmail: "julie@example.com", studioPhone: "+32 470 00 00 00",
  clientName: "Camille Dubois", offerTitle: "Séance naissance", when: "samedi 28 novembre à 10 h", durationMin: 90, location: "Studio, Liège",
  prep: "Tenues <claires>\nUn doudou", note: "Hâte de vous voir !", depositCents: 5000, priceCents: 18000,
});
check("e-mail récap : séance et date dans l'objet, prénom, mot, points échappés",
      prep.subject.includes("Séance naissance") && prep.subject.includes("samedi 28 novembre") && prep.html.includes("Camille, tout pour préparer") &&
      prep.html.includes("Hâte de vous voir") && prep.html.includes("<li style") && prep.html.includes("Tenues &lt;claires&gt;") && prep.html.includes("Studio, Liège"), prep.subject);
check("e-mail récap : pas de montants (ce n'est pas une facture)", !prep.html.includes("180") && !prep.text.includes("Acompte"));
check("e-mail récap : version texte avec la liste", prep.text.includes("À prévoir :\n- Tenues <claires>\n- Un doudou"), prep.text);

/* ---------- Contrat d'une réservation ---------- */

// Samedi 28 novembre 2026, 10 h 30 à Bruxelles (UTC+1).
const startsAt = Date.UTC(2026, 10, 28, 9, 30) / 1000;
const booking = {
  client_name: "Camille Dubois", client_email: "camille@example.com", offer_title: "Séance naissance",
  starts_at: startsAt, price_cents: 18000, deposit_cents: 5000, paid_at: 1, photos: 20, tier_label: "Essentiel",
};
const draft = bookingContractDraft(booking, { priceCents: undefined, depositCents: 0, terms: "Conditions du studio, assez longues." });
check("contrat : client, titre, date et heure de Bruxelles",
      draft.clientName === "Camille Dubois" && draft.clientEmail === "camille@example.com" && draft.title === "Séance naissance" &&
      draft.sessionDay === "2026-11-28" && draft.sessionTime === "10:30", JSON.stringify(draft));
check("contrat : une ligne au prix de la réservation, tarif choisi, acompte déjà réglé rappelé",
      draft.lines.length === 1 && draft.lines[0].amountCents === 18000 && draft.lines[0].label.includes("20 photos (Essentiel)") &&
      draft.lines[0].label.includes("acompte de 50 € déjà réglé"), draft.lines[0].label);
const summer = bookingContractDraft({ ...booking, starts_at: Date.UTC(2026, 6, 4, 8, 0) / 1000, paid_at: null, photos: null, tier_label: "" }, { priceCents: 25000, depositCents: 7500, terms: "x" });
check("contrat : heure d'été, prix et acompte ajustés, sans acompte déjà réglé",
      summer.sessionTime === "10:00" && summer.lines[0].amountCents === 25000 && summer.depositCents === 7500 && summer.lines[0].label === "Séance naissance", JSON.stringify(summer));

const remind = buildContractToClientEmail({ studioName: "Studio", clientName: "Camille", number: "2026-004", title: "Séance naissance", url: "https://x/contrat.html?t=abc", depositCents: 5000, reminder: true });
const first = buildContractToClientEmail({ studioName: "Studio", clientName: "Camille", number: "2026-004", title: "Séance naissance", url: "https://x/contrat.html?t=abc", depositCents: 0 });
check("relance : objet « Rappel », même lien de signature", remind.subject.startsWith("Rappel : votre contrat") && remind.html.includes("pas encore signé") && remind.text.includes("contrat.html?t=abc"), remind.subject);
check("premier envoi inchangé", first.subject === "Studio : votre devis « Séance naissance »" && !first.html.includes("Petit rappel"));

/* ---------- Galerie en ligne ---------- */

const fr = buildGalleryInviteEmail({
  studioName: "Studio Lumière", galleryTitle: "Naissance de <Léon>", clientName: "Camille Dubois",
  galleryUrl: "https://studio.example/?g=leon", password: "ciel-vert-42", note: "Quelle belle séance !", expiresAt: Date.UTC(2027, 0, 31, 12) / 1000,
});
check("galerie FR : titre, lien, mot de passe, date de fermeture",
      fr.subject === "Votre galerie « Naissance de <Léon> » est en ligne" && fr.html.includes("Naissance de &lt;Léon&gt;") &&
      fr.html.includes("https://studio.example/?g=leon") && fr.html.includes("ciel-vert-42") && fr.html.includes("31 janvier 2027") &&
      fr.html.includes("Camille, vos photos sont en ligne") && fr.html.includes("Quelle belle séance"), fr.subject);
check("galerie FR : version texte avec lien et mot de passe", fr.text.includes("Lien : https://studio.example/?g=leon") && fr.text.includes("Mot de passe : ciel-vert-42"));
const en = buildGalleryInviteEmail({ studioName: "Studio", galleryTitle: "Wedding", clientName: "", galleryUrl: "https://x/?g=w", password: "pw-123456", lang: "en" });
check("galerie EN : anglais, sans date de fermeture", en.subject === "Your gallery “Wedding” is online" && en.html.includes('lang="en"') &&
      en.html.includes("Open my gallery") && en.text.includes("Password: pw-123456") && !en.html.includes("open until"), en.subject);

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
