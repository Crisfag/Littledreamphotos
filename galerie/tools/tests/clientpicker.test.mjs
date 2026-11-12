// « Choisir dans mes fiches clients », dans un vrai navigateur : la recherche
// parmi les clients déjà connus remplit la facture (adresse et TVA reprises
// de sa dernière facture), le devis, la nouvelle galerie et la tâche du
// planning ; dans Réservations, « + » sur un créneau libre le réserve au nom
// d'un client habitué, sans acompte en ligne.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/clientpicker.test.mjs

import { chromium } from "playwright";
import { WorkerClient } from "../lib/client.mjs";
import { createTestAccount } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const SHOTS = process.env.SCREENSHOT_DIR || "";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}
function dayAhead(days) {
  return new Date(Date.now() + days * 86400000).toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
}

const account = await createTestAccount(API, "cpick");
const client = new WorkerClient({ api: API, ...account });
const slug = `cpick-${Date.now().toString(36)}`;

// Deux clients connus : Camille (galerie + facture déjà émise, avec adresse)
// et Théo (fiche créée à la main, avec téléphone).
const CAMILLE = "camille.dubois@test.invalid";
const THEO = "theo.martin@test.invalid";
await client.createGallery({ slug, title: "Séance famille Dubois", clientName: "Camille Dubois", clientEmail: CAMILLE, password: "mot-de-passe-cpick" });
await client.request("POST", "/api/admin/clients", { create: true, email: THEO, name: "Théo Martin", phone: "0470 12 34 56" });
const draft = await client.request("POST", "/api/admin/client-invoices", {
  clientName: "Camille Dubois", clientEmail: CAMILLE, clientAddress: "Rue des Lilas 4\n4000 Liège", clientVat: "BE0123456789",
  lines: [{ description: "Album", quantity: 1, unitCents: 12000, vatRate: 0 }],
}).catch((err) => ({ error: err.message }));
const draftId = draft && draft.createdId;
if (draftId) await client.request("POST", `/api/admin/client-invoices/${draftId}/issue`, { send: false }).catch(() => {});

// Une formule à deux tarifs, avec acompte, et un créneau libre.
const offers = await client.request("POST", "/api/admin/booking/offers", {
  title: "Séance famille", durationMin: 60, priceCents: 0, depositCents: 3000, location: "Studio",
  tiers: [{ photos: 5, priceCents: 9000 }, { photos: 10, priceCents: 15000 }],
});
const offer = offers.offers[0];
await client.request("POST", "/api/admin/booking/slots", { offerId: offer.id, date: dayAhead(20), times: ["10:00", "14:00"] });

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

async function pick(root, query, name) {
  await page.click(`${root} .ad-cpick-btn`);
  await page.waitForSelector(`${root} .ad-cpick-panel:not([hidden]) [role=option]`, { timeout: 10000 });
  if (query) await page.fill(`${root} .ad-cpick-search`, query);
  await page.click(`${root} [role=option]:has-text("${name}")`);
}

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-login-form", { timeout: 10000 });
  await page.fill('#ad-login-form [name="email"]', account.email);
  await page.fill('#ad-login-form [name="password"]', account.password);
  await page.click("#ad-login-submit");
  await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });

  /* ---------- Facture ---------- */

  await page.click("#ad-tab-billing");
  await page.waitForSelector("#ad-ci-new", { timeout: 15000 });
  await page.click("#ad-ci-new");
  await page.waitForSelector("#ad-ci-form [data-cpick] .ad-cpick-btn");
  await page.click("#ad-ci-form .ad-cpick-btn");
  await page.waitForSelector("#ad-ci-form [role=option]", { timeout: 10000 });
  const recent = await page.$$eval("#ad-ci-form [role=option] .ad-cpick-name", (n) => n.map((x) => x.textContent));
  check("le menu déroulant montre les derniers clients", recent.some((t) => t.includes("Camille Dubois")) && recent.some((t) => t.includes("Théo Martin")), recent.join(" | "));
  await page.fill("#ad-ci-form .ad-cpick-search", "dubois");
  const filtered = await page.$$eval("#ad-ci-form [role=option] .ad-cpick-name", (n) => n.map((x) => x.textContent));
  check("la recherche filtre (« dubois » → Camille seule)", filtered.length === 1 && filtered[0].includes("Camille"), filtered.join(" | "));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/cpick-facture.png` });
  await page.keyboard.press("Enter");
  const invoiceFields = await page.evaluate(() => {
    const f = document.getElementById("ad-ci-form").elements;
    return { name: f.clientName.value, email: f.clientEmail.value, address: f.clientAddress.value, vat: f.clientVat.value };
  });
  check("facture : nom et e-mail remplis depuis la fiche (Entrée)", invoiceFields.name === "Camille Dubois" && invoiceFields.email === CAMILLE, JSON.stringify(invoiceFields));
  check("facture : adresse et TVA reprises de sa dernière facture",
        !draftId || (invoiceFields.address.includes("Liège") && invoiceFields.vat === "BE0123456789"), JSON.stringify(invoiceFields));
  check("le menu se referme et confirme le choix",
        await page.isHidden("#ad-ci-form .ad-cpick-panel") && (await page.innerText("#ad-ci-form .ad-cpick-picked")).includes("Camille Dubois"));
  await pick("#ad-ci-form", "0470 12", "Théo Martin");
  const theoInvoice = await page.evaluate(() => {
    const f = document.getElementById("ad-ci-form").elements;
    return { name: f.clientName.value, address: f.clientAddress.value };
  });
  check("recherche par téléphone ; changer de client vide l'adresse du précédent", theoInvoice.name === "Théo Martin" && theoInvoice.address === "", JSON.stringify(theoInvoice));

  /* ---------- Nouvelle galerie ---------- */

  await page.click("#ad-tab-galleries");
  await page.waitForSelector("#ad-new-gallery");
  await page.click("#ad-new-gallery");
  await page.waitForSelector("#ad-create-cpick .ad-cpick-btn");
  await pick("#ad-create-cpick", "theo", "Théo Martin");
  const galleryFields = await page.evaluate(() => {
    const f = document.getElementById("ad-create-form").elements;
    return { name: f.clientName.value, email: f.clientEmail.value };
  });
  check("nouvelle galerie : nom et e-mail du client (recherche sans accent)", galleryFields.name === "Théo Martin" && galleryFields.email === THEO, JSON.stringify(galleryFields));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/cpick-galerie.png` });
  await page.keyboard.press("Escape");

  /* ---------- Devis ---------- */

  await page.click("#ad-tab-contracts");
  await page.waitForSelector("#ad-ct-new", { timeout: 15000 });
  await page.click("#ad-ct-new");
  await page.waitForSelector("#ad-ct-form .ad-cpick-btn");
  await pick("#ad-ct-form", "", "Camille Dubois");
  const ct = await page.evaluate(() => ({ name: document.getElementById("ad-ct-form").elements.clientName.value, email: document.getElementById("ad-ct-form").elements.clientEmail.value }));
  check("devis : nom et e-mail du client", ct.name === "Camille Dubois" && ct.email === CAMILLE, JSON.stringify(ct));

  /* ---------- Planning ---------- */

  await page.click("#ad-tab-planning");
  await page.waitForSelector("#ad-pl-add", { timeout: 15000 });
  await page.click("#ad-pl-add");
  await pick("#ad-pl-form", "camille", "Camille Dubois");
  check("planning : e-mail du client", (await page.inputValue('#ad-pl-form [name="clientEmail"]')) === CAMILLE);

  /* ---------- Réservations : créneau réservé pour un client ---------- */

  await page.click("#ad-tab-booking");
  await page.waitForSelector("[data-bk-slot-book]", { timeout: 15000 });
  check("un bouton « + » sur chaque créneau libre", (await page.$$("[data-bk-slot-book]")).length === 2);
  await page.click("[data-bk-slot-book] >> nth=0");
  await page.waitForSelector("#ad-bk-book");
  check("le formulaire nomme l'horaire et la formule", /10:00|10 h/.test(await page.innerText("#ad-bk-book .ad-bk-book-head")) && (await page.innerText("#ad-bk-book .ad-bk-book-head")).includes("Séance famille"),
        await page.innerText("#ad-bk-book .ad-bk-book-head"));
  await pick("#ad-bk-book", "théo", "Théo Martin");
  const bk = await page.evaluate(() => { const f = document.getElementById("ad-bk-book").elements; return { name: f.name.value, email: f.email.value, phone: f.phone.value }; });
  check("réservation : nom, e-mail et téléphone depuis la fiche", bk.name === "Théo Martin" && bk.email === THEO && bk.phone.replace(/\D/g, "").endsWith("470123456"), JSON.stringify(bk));
  await page.selectOption('#ad-bk-book [name="tier"]', "1");
  await page.uncheck('#ad-bk-book [name="notify"]');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/cpick-reservation.png` });
  await page.click('#ad-bk-book [type="submit"]');
  await page.waitForSelector(".ad-bk-chip-booked", { timeout: 10000 });
  check("le créneau apparaît réservé au nom du client", (await page.innerText(".ad-bk-chip-booked")).includes("Théo Martin"));
  const after = await client.request("GET", "/api/admin/booking");
  const booking = after.bookings.find((b) => b.clientEmail === THEO);
  check("réservation confirmée, sans acompte, au tarif choisi (10 photos)",
        booking && booking.status === "confirmed" && booking.depositCents === 0 && booking.photos === 10 && booking.priceCents === 15000, JSON.stringify(booking));
  check("plus qu'un « + » (l'autre créneau)", (await page.$$("[data-bk-slot-book]")).length === 1);

  let conflict = null;
  try { await client.request("POST", `/api/admin/booking/slots/${encodeURIComponent(booking.slotId)}/book`, { name: "Autre", email: "autre@test.invalid" }); }
  catch (err) { conflict = err; }
  check("un créneau déjà réservé est refusé (409)", conflict && conflict.status === 409, conflict && conflict.message);
  let invalid = null;
  const free = after.slots.find((s) => !s.bookingId);
  try { await client.request("POST", `/api/admin/booking/slots/${encodeURIComponent(free.id)}/book`, { name: "Sans e-mail", email: "pas-une-adresse" }); }
  catch (err) { invalid = err; }
  check("e-mail invalide refusé (400)", invalid && invalid.status === 400, invalid && invalid.message);

  /* ---------- Téléphone ---------- */

  await page.setViewportSize({ width: 390, height: 844 });
  await page.click("[data-bk-slot-book]");
  await page.waitForSelector("#ad-bk-book");
  await page.click("#ad-bk-book .ad-cpick-btn");
  await page.waitForSelector("#ad-bk-book [role=option]");
  const box = await page.$eval("#ad-bk-book .ad-cpick-panel", (n) => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right }; });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : le menu tient dans l'écran", box.left >= 0 && box.right <= 390 && overflow <= 0, JSON.stringify({ ...box, overflow }));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/cpick-mobile.png` });
  await page.keyboard.press("Escape");
  check("Échap referme le menu", await page.isHidden("#ad-bk-book .ad-cpick-panel"));

  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} finally {
  await browser.close();
  await client.deleteGallery(slug).catch(() => {});
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
