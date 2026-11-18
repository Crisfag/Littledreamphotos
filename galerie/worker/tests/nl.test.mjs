// Galeries en néerlandais : chaque e-mail reçu par le client existe en
// néerlandais (objet, HTML et texte), avec lang="nl", les montants « € 45,00 »
// et les dates en nl-BE ; la boutique, la facture PDF et les lignes de
// paiement suivent. Les e-mails au photographe, eux, restent en français ou
// en anglais. Fonctions pures, sans réseau ni wrangler dev.
//
//   node tests/nl.test.mjs

import { inflateSync } from "node:zlib";
import {
  LANGUAGES, UI_LANGUAGES, languageOf, uiLanguageOf, photographerMailLanguage, pick, formatAmount, formatDate,
} from "../src/i18n.js";
import {
  buildInvoiceEmail, buildClientReminderEmail, buildPrintOrderConfirmationEmail, buildDeliveryReadyEmail,
  buildPrintPromoEmail, buildCartReminderEmail, buildFavoritesPrintEmail, buildPrintOrderShippedEmail,
  buildGalleryInviteEmail, buildOfflinePaymentInstructionsEmail, buildUnpaidReminderEmail,
  buildCaptureAlertEmail, buildPasswordResetEmail, buildEmailChangeConfirmationEmail, buildPhotographerReminderEmail,
  buildSelectionValidatedEmail, buildPrintOrderPhotographerEmail, buildStoragePurgeNoticeEmail,
  buildOfflinePaymentRequestEmail, sendInvoiceEmail, sendPrintOrderConfirmation,
} from "../src/notify.js";
import { resolveSelection, productLabelFor, catalogueForAdmin, categoryLabelFor } from "../src/printCatalogue.js";
import { countriesForClient, ORDER_STATUS_LABELS_NL } from "../src/prodigi.js";
import { paymentInvoiceText, optionLine } from "../src/options.js";
import { buildInvoicePdf, formatEuros } from "../src/invoices.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

/* ---------- i18n ---------- */

check("le néerlandais est une langue de galerie et d'interface",
      LANGUAGES.includes("nl") && UI_LANGUAGES.includes("nl") && languageOf("nl") === "nl" && uiLanguageOf("nl") === "nl" && languageOf("de") === "fr");
check("pick : le néerlandais, sinon l'anglais (jamais le français)",
      pick("nl", "Bonjour", "Hello", "Hallo") === "Hallo" && pick("nl", "Bonjour", "Hello") === "Hello" &&
      pick("en", "Bonjour", "Hello", "Hallo") === "Hello" && pick("fr", "Bonjour", "Hello", "Hallo") === "Bonjour");
check("montants : « € 45,00 » en néerlandais, inchangés en français et en anglais",
      formatAmount(4500, "nl") === "€ 45,00" && formatAmount(123450, "nl") === "€ 1.234,50" &&
      formatAmount(4500, "en") === "€45.00" && formatAmount(4500, "fr").replace(/\s/g, " ") === "45,00 €",
      `${formatAmount(4500, "nl")} | ${formatAmount(123450, "nl")}`);
check("dates en nl-BE", formatDate(1_790_000_000, "nl") === "21 september 2026", formatDate(1_790_000_000, "nl"));
check("e-mails au photographe : « nl » reçoit l'anglais, le reste le français",
      photographerMailLanguage("nl") === "en" && photographerMailLanguage("en") === "en" &&
      photographerMailLanguage("fr") === "fr" && photographerMailLanguage(undefined) === "fr");

/* ---------- E-mails au client ---------- */

const TITLE = "Huwelijk <Anna & Tom>";
const TITLE_HTML = "Huwelijk &lt;Anna &amp; Tom&gt;";
const URL = "https://www.holypixx.com/galerie.html?g=anna-tom";
const print = resolveSelection({ product: "photo-ctype", size: "4x6", option: "lustre" });
const canvas = resolveSelection({ product: "canvas-stretched", size: "12x16", option: "MirrorWrap" });
const lines = [
  { copies: 2, label: productLabelFor({ label: print.label, catalog_ref: print.ref }, "nl"), photoNumber: 4, lineCents: 800 },
  { copies: 1, label: productLabelFor({ label: canvas.label, catalog_ref: canvas.ref }, "nl"), photoNumber: 12, lineCents: 7900 },
];
const options = [{ label: "Clé USB", quantity: 1, unitCents: 1500 }];

const mails = {
  "facture": buildInvoiceEmail({ lang: "nl", galleryTitle: TITLE, number: "2026-0007", amountCents: 4490 }),
  "rappel d'expiration (2 jours, favoris)": buildClientReminderEmail({ lang: "nl", studioName: "Studio Lien", galleryTitle: TITLE, clientName: "Anna", daysLeft: 2, selectedCount: 3, galleryUrl: URL }),
  "rappel d'expiration (demain, aucun favori)": buildClientReminderEmail({ lang: "nl", studioName: "", galleryTitle: TITLE, clientName: "", daysLeft: 1, selectedCount: 0, galleryUrl: URL }),
  "confirmation de commande de tirages": buildPrintOrderConfirmationEmail({ lang: "nl", studioName: "Studio Lien", galleryTitle: TITLE, recipientName: "Anna Peeters", lines, shippingCents: 790, totalCents: 9490, invoiceNumber: "2026-0007" }),
  "photos prêtes": buildDeliveryReadyEmail({ lang: "nl", studioName: "Studio Lien", galleryTitle: TITLE, clientName: "Anna", count: 48, galleryUrl: URL }),
  "promotion": buildPrintPromoEmail({ lang: "nl", studioName: "Studio Lien", galleryTitle: TITLE, clientName: "Anna", percent: 20, endsAt: 1_790_000_000, favoritesCount: 5, galleryUrl: URL }),
  "promotion (sans favoris)": buildPrintPromoEmail({ lang: "nl", studioName: "", galleryTitle: TITLE, clientName: "", percent: 15, endsAt: 1_790_000_000, favoritesCount: 0, galleryUrl: URL }),
  "panier oublié": buildCartReminderEmail({ lang: "nl", studioName: "Studio Lien", galleryTitle: TITLE, clientName: "Anna", items: [{ copies: 2, label: lines[0].label }], promo: { percent: 10, endsAt: 1_790_000_000 }, galleryUrl: URL }),
  "favoris à imprimer": buildFavoritesPrintEmail({ lang: "nl", studioName: "Studio Lien", galleryTitle: TITLE, clientName: "Anna", favoritesCount: 7, promo: { percent: 10, endsAt: 1_790_000_000 }, galleryUrl: URL }),
  "expédition": buildPrintOrderShippedEmail({ lang: "nl", studioName: "Studio Lien", galleryTitle: TITLE, recipientName: "Anna", trackingUrl: "https://track.example/123" }),
  "expédition (sans suivi)": buildPrintOrderShippedEmail({ lang: "nl", studioName: "", galleryTitle: TITLE, recipientName: "", trackingUrl: "" }),
  "invitation « galerie en ligne »": buildGalleryInviteEmail({ lang: "nl", studioName: "Studio Lien", galleryTitle: TITLE, clientName: "Anna Peeters", galleryUrl: URL, password: "zon<2026>", note: "Tot snel!", expiresAt: 1_790_000_000 }),
  "paiement hors ligne : espèces": buildOfflinePaymentInstructionsEmail({ lang: "nl", method: "cash", studioName: "Studio Lien", galleryTitle: TITLE, extraCount: 3, amountCents: 4500, options: [], cashAddress: "Kerkstraat 1, 9000 Gent", photographerEmail: "lien@example.be", galleryUrl: URL }),
  "paiement hors ligne : virement avec options": buildOfflinePaymentInstructionsEmail({ lang: "nl", method: "transfer", studioName: "", galleryTitle: TITLE, extraCount: 2, amountCents: 4500, options, cashAddress: "", photographerEmail: "", galleryUrl: URL }),
  "rappel de supplément impayé": buildUnpaidReminderEmail({ lang: "nl", studioName: "Studio Lien", galleryTitle: TITLE, clientName: "Anna", extraCount: 2, options, amountCents: 4500, canPayOnline: true, transfer: true, iban: "BE68 5390 0754 7034", accountHolder: "Studio Lien", cashAddress: "Kerkstraat 1, 9000 Gent", awaitingMethod: "", galleryUrl: URL }),
  "rappel de supplément impayé (virement annoncé)": buildUnpaidReminderEmail({ lang: "nl", studioName: "", galleryTitle: TITLE, clientName: "", extraCount: 1, options: [], amountCents: 1500, canPayOnline: false, transfer: true, iban: "", accountHolder: "", cashAddress: "", awaitingMethod: "transfer", galleryUrl: URL }),
};

// Texte visible du HTML (balises retirées, entités décodées).
function visible(html) {
  return html.replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}
// Mots français ou anglais qui n'ont rien à faire dans un e-mail néerlandais
// (les libellés choisis par le photographe, ici « Clé USB », sont retirés).
const FRENCH = /\b(votre|vos|vous|bonjour|merci|galerie|tirages?|commande|facture|suppléments?|espèces|virement|réglée?s?|photos|jusqu|cœur|expédi\w*)\b|«|»/i;
const ENGLISH = /\b(your|the|gallery|prints?|order|invoice|thanks?|payment|shipping|download|password|hello|you|favourites?|until|days?|tomorrow|with)\b/i;

for (const [name, mail] of Object.entries(mails)) {
  const words = `${mail.subject}\n${mail.text}\n${visible(mail.html)}`
    .replace(/https?:\/\/\S+/g, "").replace(/Clé USB/g, "").replace(/Huwelijk <Anna & Tom>/g, "");
  const french = words.match(FRENCH);
  const english = words.match(ENGLISH);
  check(`${name} : en néerlandais, sans mot français ni anglais résiduel`,
        !french && !english && /\b(je|jouw|jij)\b/i.test(words),
        french || english ? `reste « ${(french || english)[0]} » — ${mail.subject}` : mail.subject);
  check(`${name} : <html lang="nl"> et pied de page néerlandais`,
        mail.html.includes('<html lang="nl">') && mail.html.includes("beveiligde galerijen voor fotografen"));
  check(`${name} : titre échappé dans le HTML, intact dans le texte`,
        mail.html.includes(TITLE_HTML) && !mail.html.includes("<Anna") && mail.text.includes(TITLE));
  check(`${name} : aucun montant au format français ou anglais`,
        !/\d,\d\d\s?€|€\d/.test(mail.subject + mail.text + mail.html));
}

const m = mails;
check("facture : objet, montant « € 44,90 »",
      m["facture"].subject === `Je factuur 2026-0007 — ${TITLE}` && m["facture"].html.includes("€ 44,90") && m["facture"].text.includes("€ 44,90"),
      m["facture"].subject);
check("rappel : « over 2 dagen », « morgen », bouton et libellé du bouton de la galerie",
      m["rappel d'expiration (2 jours, favoris)"].subject === `Je galerij “${TITLE}” sluit over 2 dagen` &&
      m["rappel d'expiration (demain, aucun favori)"].subject.endsWith("sluit morgen") &&
      m["rappel d'expiration (2 jours, favoris)"].text.includes("3 favorieten") &&
      m["rappel d'expiration (2 jours, favoris)"].html.includes("Mijn galerij bekijken") &&
      m["rappel d'expiration (2 jours, favoris)"].text.includes("“Mijn selectie bevestigen”"),
      m["rappel d'expiration (2 jours, favoris)"].subject);
const order = m["confirmation de commande de tirages"];
check("commande de tirages : lignes, port et total en « € », produits en néerlandais, facture jointe",
      order.text.includes("- 2 × Fotoafdruk op fotopapier 10 × 15 cm — zijdeglans (foto nr. 4): € 8,00") &&
      order.text.includes("Verzending: € 7,90") && order.text.includes("Totaal betaald: € 94,90") &&
      order.html.includes("Canvas op spieraam 30 × 40 cm — gespiegelde randen") && order.html.includes("factuur nr. 2026-0007"),
      order.text.split("\n")[2]);
check("photos prêtes : « 48 foto's », « downloaden in HD », wachtwoord",
      m["photos prêtes"].text.includes("48 foto's in hoge resolutie") && visible(m["photos prêtes"].html).includes("te downloaden in HD") &&
      m["photos prêtes"].html.includes("wachtwoord") && visible(m["photos prêtes"].html).includes("Mijn foto's downloaden"));
check("promotion : date en néerlandais et pourcentage",
      m["promotion"].subject === "20% korting op je afdrukken tot 21 september" && m["promotion"].text.includes("Je 5 favorieten wachten"),
      m["promotion"].subject);
check("panier oublié : nombre de tirages et ligne de promotion datée",
      m["panier oublié"].subject === "Je winkelmandje wacht op je: 2 afdrukken" && m["panier oublié"].text.includes("10% korting op alle afdrukken tot 21 september"));
check("favoris à imprimer : objet et nombre de favoris",
      m["favoris à imprimer"].subject === "Je favorieten verdienen een mooie afdruk" && m["favoris à imprimer"].text.includes("7 favorieten"));
check("expédition : bouton de suivi, ou message sans suivi",
      m["expédition"].html.includes("Mijn pakje volgen") && m["expédition"].html.includes("https://track.example/123") &&
      m["expédition (sans suivi)"].html.includes("De vervoerder geeft geen link"));
const invite = m["invitation « galerie en ligne »"];
check("invitation : prénom, mot de passe échappé, date de fermeture en néerlandais",
      invite.subject === `Je galerij “${TITLE}” staat online` && visible(invite.html).includes("Anna, je foto's staan online") && invite.html.includes("zon&lt;2026&gt;") &&
      invite.html.includes("De galerij blijft open tot 21 september 2026.") && invite.text.includes("Wachtwoord: zon<2026>"),
      invite.subject);
check("paiement hors ligne : espèces, adresse et montant",
      m["paiement hors ligne : espèces"].subject === `Je betaling voor “${TITLE}”: € 45,00 contant` &&
      m["paiement hors ligne : espèces"].text.includes("3 extra foto's bovenop je pakket: € 45,00.") &&
      m["paiement hors ligne : espèces"].text.includes("Kerkstraat 1, 9000 Gent"),
      m["paiement hors ligne : espèces"].subject);
check("paiement hors ligne : virement, options détaillées",
      m["paiement hors ligne : virement avec options"].text.includes("2 extra foto's + Clé USB: € 45,00.") &&
      m["paiement hors ligne : virement avec options"].text.includes("Je fotograaf bezorgt je zo snel mogelijk het rekeningnummer."));
const unpaid = m["rappel de supplément impayé"];
check("supplément impayé : montant, IBAN, mededeling, trois façons de payer",
      unpaid.subject === `Kleine herinnering: nog € 45,00 te betalen voor “${TITLE}”` &&
      unpaid.text.includes("Hallo Anna,") && unpaid.text.includes("BE68 5390 0754 7034 (Studio Lien), met als mededeling") &&
      unpaid.text.includes("Je kunt betalen:") && unpaid.text.includes("Contant, op dit adres") &&
      unpaid.html.includes("Extra foto&#39;s betalen"),
      unpaid.subject);
check("supplément impayé : virement déjà annoncé",
      m["rappel de supplément impayé (virement annoncé)"].text.includes("via overschrijving betaalt") &&
      m["rappel de supplément impayé (virement annoncé)"].text.includes("Zo kun je betalen:"));

check("français et anglais inchangés à côté",
      buildDeliveryReadyEmail({ galleryTitle: "Smith", clientName: "", count: 2, galleryUrl: "" }).subject === "Vos photos « Smith » sont prêtes" &&
      buildDeliveryReadyEmail({ lang: "en", galleryTitle: "Smith", clientName: "", count: 2, galleryUrl: "" }).html.includes('<html lang="en">') &&
      buildUnpaidReminderEmail({ galleryTitle: "Smith", extraCount: 1, amountCents: 1500, galleryUrl: "" }).html.includes('<html lang="fr">'));

/* ---------- Pièce jointe : « factuur-….pdf » ---------- */

const sent = [];
globalThis.fetch = async (_url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, text: async () => "" }; };
const env = { RESEND_API_KEY: "test" };
const originalLog = console.log;
console.log = () => {};
await sendInvoiceEmail(env, { to: "anna@example.be", galleryTitle: TITLE, number: "2026-0007", amountCents: 4490, pdfBytes: new Uint8Array([37, 80, 68, 70]), lang: "nl" });
await sendPrintOrderConfirmation(env, { to: "anna@example.be", lang: "nl", galleryTitle: TITLE, recipientName: "Anna", lines, shippingCents: 790, totalCents: 9490, invoiceNumber: "2026-0008", pdfBytes: new Uint8Array([37, 80, 68, 70]) });
console.log = originalLog;
check("factures jointes nommées « factuur-….pdf »",
      sent[0]?.attachments?.[0]?.filename === "factuur-2026-0007.pdf" && sent[1]?.attachments?.[0]?.filename === "factuur-2026-0008.pdf",
      sent.map((s) => s.attachments?.[0]?.filename).join(", "));

/* ---------- E-mails au photographe : jamais en néerlandais ---------- */

const photographerMails = [
  buildCaptureAlertEmail({ studioName: "Studio Lien", galleryTitle: "Smith", clientName: "Anna", photoLabel: "Photo no. 3", reason: "impr-ecran", ts: 1_700_000_000, adminUrl: "https://x", lang: "nl" }),
  buildPasswordResetEmail({ studioName: "Studio Lien", resetUrl: "https://x/?reset=abc", ts: 1_700_000_000, lang: "nl" }),
  buildEmailChangeConfirmationEmail({ studioName: "Studio Lien", confirmUrl: "https://x/?confirm-email=abc", ts: 1_700_000_000, lang: "nl" }),
  buildPhotographerReminderEmail({ galleryTitle: "Smith", clientName: "Anna", daysLeft: 2, selectedCount: 0, adminUrl: "https://x", lang: "nl" }),
  buildSelectionValidatedEmail({ galleryTitle: "Smith", clientName: "Anna", selectedCount: 12, dueExtraCount: 2, dueTotalCents: 3000, adminUrl: "https://x", lang: "nl" }),
  buildPrintOrderPhotographerEmail({ galleryTitle: "Smith", recipientName: "Anna", lines, totalCents: 9490, labStatus: "sent", labError: "", adminUrl: "https://x", lang: "nl" }),
  buildStoragePurgeNoticeEmail({ studioName: "Studio Lien", galleryTitle: "Smith", deliveryCount: 10, originalCount: 40, sizeLabel: "1.2 GB", purgeAt: 1_790_000_000, adminUrl: "https://x", lang: "nl" }),
  buildOfflinePaymentRequestEmail({ method: "cash", galleryTitle: "Smith", clientName: "Anna", clientEmail: "anna@example.be", extraCount: 2, amountCents: 3000, options: [], cashAddress: "Kerkstraat 1", adminUrl: "https://x", lang: "nl" }),
];
check("photographe dont l'espace est en néerlandais : ses e-mails arrivent en anglais (lang=\"en\")",
      photographerMails.every((p) => p.html.includes('<html lang="en">') && !/[àéèç«»]|Votre|Bonjour/.test(p.subject + p.text)),
      photographerMails.map((p) => p.subject).join(" | "));
check("e-mail au photographe sans version anglaise demandée : jamais lang=\"nl\"",
      buildOfflinePaymentRequestEmail({ method: "transfer", galleryTitle: "Smith", clientName: "", clientEmail: "", extraCount: 1, amountCents: 1500, options: [], cashAddress: "", adminUrl: "", lang: "fr" }).html.includes('<html lang="fr">'));

/* ---------- Boutique, pays, statuts ---------- */

check("libellés des produits en néerlandais (cm, virgule décimale, contenance du mug)",
      lines[0].label === "Fotoafdruk op fotopapier 10 × 15 cm — zijdeglans" &&
      productLabelFor((() => { const r = resolveSelection({ product: "art-photorag", size: "A4" }); return { label: r.label, catalog_ref: r.ref }; })(), "nl") === "Fine-art-afdruk op Hahnemühle Photo Rag A4 · 21 × 29,7 cm" &&
      productLabelFor((() => { const r = resolveSelection({ product: "gift-mug", size: "11oz" }); return { label: r.label, catalog_ref: r.ref }; })(), "nl") === "Witte keramische mok 330 ml",
      lines[0].label);
check("libellé réécrit par le photographe gardé tel quel en néerlandais",
      productLabelFor({ label: "Mijn mooie afdruk", catalog_ref: print.ref }, "nl") === "Mijn mooie afdruk");
const nlCatalogue = catalogueForAdmin("nl");
check("catalogue de l'espace photographe en néerlandais",
      nlCatalogue[0].label === "Fotoafdrukken" && nlCatalogue[0].products[0].option.label === "Afwerking" &&
      nlCatalogue[0].products[0].option.choices[0].label === "Zijdeglans" &&
      categoryLabelFor({ catalog_ref: canvas.ref }, "nl") === "Canvas" && categoryLabelFor({ sku: "ZZZ" }, "nl") === "Andere producten");
const nlCountries = countriesForClient({ shop_shipping_world_cents: 1500 }, "nl");
check("pays de livraison en néerlandais, triés",
      nlCountries.find((c) => c.code === "BE").name === "België" && nlCountries.find((c) => c.code === "US").name === "Verenigde Staten" &&
      nlCountries.every((c, i) => i === 0 || nlCountries[i - 1].name.localeCompare(c.name, "nl") <= 0),
      nlCountries.slice(0, 4).map((c) => c.name).join(", "));
check("statuts de commande en néerlandais, échec présenté « in voorbereiding »",
      ORDER_STATUS_LABELS_NL.shipped === "Verzonden" && ORDER_STATUS_LABELS_NL.failed === "In voorbereiding");

/* ---------- Facture : texte, lignes, PDF ---------- */

const invoiceText = paymentInvoiceText({ extra_count: 2, amount_cents: 4500, options_json: JSON.stringify([{ optionId: "o1", label: "Clé USB", quantity: 1, unitCents: 1500 }]) }, { title: "Anna & Tom" }, "nl");
check("facture : description et détails en néerlandais, montants « € »",
      invoiceText.description === "Extra foto's en opties — Anna & Tom" &&
      invoiceText.details[0] === "2 extra foto's — € 30,00" && invoiceText.details[1] === "Clé USB — € 15,00",
      JSON.stringify(invoiceText));
check("facture sans option : « 3 extra foto's »",
      paymentInvoiceText({ extra_count: 3, amount_cents: 4500, options_json: "[]" }, { title: "X" }, "nl").description === "3 extra foto's — X");
check("ligne d'option en néerlandais", optionLine({ label: "Retouche", quantity: 2, unitCents: 1250 }, "nl") === "2 × Retouche — € 25,00");
check("formatEuros de la facture : « € 1.500,00 » en néerlandais, français inchangé",
      formatEuros(150000, "nl") === "€ 1.500,00" && formatEuros(150000).replace(/\s/g, " ") === "1 500,00 €", formatEuros(150000, "nl"));

// Texte du PDF : flux décompressés, chaînes hexadécimales WinAnsi des Tj.
function pdfText(bytes) {
  const buf = Buffer.from(bytes);
  const out = [];
  let at = 0;
  while ((at = buf.indexOf("stream", at)) !== -1) {
    let start = at + 6;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const end = buf.indexOf("endstream", start);
    if (end === -1) break;
    const raw = buf.subarray(start, end);
    let data;
    try { data = inflateSync(raw); } catch { data = raw; }
    for (const match of data.toString("latin1").matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
      out.push(Buffer.from(match[1], "hex").toString("latin1").replace(/\x80/g, "€").replace(/\x97/g, "—"));
    }
    at = end + 9;
  }
  return out.join("\n");
}
const pdf = await buildInvoicePdf({
  lang: "nl", number: "2026-0009", issuedAt: 1_790_000_000,
  seller: { name: "Studio Lien", address: "Kerkstraat 1\n9000 Gent", vatNumber: "" }, clientName: "Anna Peeters",
  description: invoiceText.description, details: invoiceText.details, amountCents: 4500, netCents: 4500, vatCents: 0, vatRate: 0,
});
const text = pdfText(pdf);
check("facture PDF : un PDF valide", pdf.length > 800 && String.fromCharCode(...pdf.slice(0, 5)) === "%PDF-");
check("facture PDF : intitulés néerlandais, date nl-BE, montants « € 45,00 »",
      text.includes("Factuur nr. 2026-0009") && text.includes("21/9/2026") && text.includes("Totaal betaald") &&
      text.includes("€ 45,00") && text.includes("Factuur aan") && text.includes("Online betaald"),
      text.split("\n").slice(0, 3).join(" | "));
check("facture PDF : mention légale belge en français suivie de sa traduction néerlandaise",
      text.includes("TVA non applicable, article 56bis du Code de la TVA.") && text.includes("btw niet van toepassing, artikel 56bis van het Btw-Wetboek"));

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
