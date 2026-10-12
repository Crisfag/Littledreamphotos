// Réservation en ligne, de bout en bout dans un vrai navigateur : le
// photographe crée une formule illustrée (image, compris, conseil
// vestimentaire, sauvegardée comme prestation) et ouvre des créneaux (un
// horaire, puis une série de mini-séances) dans l'onglet Réservations ; un
// client réserve sur le mini-site ; le photographe voit la séance et
// l'annule, puis remet la prestation en ligne depuis « Type de séance ».
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/booking.test.mjs

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../lib/client.mjs";
import { createTestAccount, localSql } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_DIR = join(REPO_ROOT, "galerie", "web");
const PHOTO = join(REPO_ROOT, "images", "famille", "famille-01.jpeg");
const SITE_PORT = Number(process.env.SITE_PORT || 8000); // seule origine locale autorisée par le Worker

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

// Date (heure de Bruxelles) dans `days` jours, au format des champs date.
function dayAhead(days) {
  return new Date(Date.now() + days * 86400000).toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
}
const DAY_A = dayAhead(20);
const DAY_B = dayAhead(21);

/* ---------- Comptes ---------- */

const account = await createTestAccount(API, "booking");
const client = new WorkerClient({ api: API, ...account });
const freeAccount = await createTestAccount(API, "booking-free", { plan: "" });
const freeClient = new WorkerClient({ api: API, ...freeAccount });
const HANDLE = `resa-${Date.now().toString(36)}`;

/* ---------- Site principal local (mini-site) ---------- */

const TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8" };
const site = createServer(async (req, res) => {
  const pathname = req.url.split("?")[0];
  try {
    let body = await readFile(join(WEB_DIR, pathname));
    const ext = pathname.split(".").pop();
    if (ext === "html") body = body.toString().replace(/api: "[^"]*"/, `api: "${API}"`);
    res.writeHead(200, { "content-type": TYPES[ext] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve, reject) => {
  site.once("error", reject);
  site.listen(SITE_PORT, "localhost", resolve);
});

const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ["--disable-features=LocalNetworkAccessChecks"],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-login-form", { timeout: 10000 });
  await page.fill('#ad-login-form [name="email"]', account.email);
  await page.fill('#ad-login-form [name="password"]', account.password);
  await page.click("#ad-login-submit");
  await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });

  /* ---------- Mini-site publié (les réservations s'y font) ---------- */

  await page.click("#ad-tab-portfolio");
  await page.waitForSelector("#ad-pf-form", { timeout: 10000 });
  await page.setInputFiles("#ad-pf-files", [PHOTO]);
  await page.waitForFunction(() => document.querySelectorAll(".ad-pf-photo").length === 1, null, { timeout: 60000 });
  await page.fill('#ad-pf-form [name="handle"]', HANDLE);
  await page.check('#ad-pf-form [name="published"]');
  await page.click("#ad-pf-save");
  for (let i = 0; i < 20 && !(await client.request("GET", "/api/admin/portfolio")).published; i++) await page.waitForTimeout(300);

  /* ---------- Onglet Réservations : formule ---------- */

  await page.click("#ad-tab-booking");
  await page.waitForSelector("#ad-bk-offer-form", { timeout: 10000 });
  check("l'onglet Réservations ouvre #/reservations, avec le formulaire de première formule",
        (await page.evaluate(() => location.hash)) === "#/reservations");

  await page.fill('#ad-bk-offer-form [name="title"]', "Mini-séance de Noël");
  await page.fill('#ad-bk-offer-form [name="durationMin"]', "20");
  await page.fill('#ad-bk-offer-form [name="price"]', "90");
  await page.fill('#ad-bk-offer-form [name="deposit"]', "0");
  await page.fill('#ad-bk-offer-form [name="location"]', "Studio, Liège");
  await page.fill('#ad-bk-offer-form [name="description"]', "Décor de Noël, 10 photos retouchées.");
  await page.fill('#ad-bk-offer-form [name="included"]', "10 photos retouchées\n- Galerie privée en ligne");
  await page.fill('#ad-bk-offer-form [name="dressCode"]', "Tons doux et unis, sans logo.");
  check("la case « Sauvegarder le réglage de cette prestation » est cochée par défaut",
        await page.isChecked('#ad-bk-offer-form [name="saveTemplate"]'));
  await page.setInputFiles("#ad-bk-image-file", [PHOTO]);
  await page.waitForSelector("#ad-bk-image .ad-bk-image-preview img", { timeout: 60000 });
  const pickedImage = await page.inputValue('#ad-bk-offer-form [name="imageId"]');
  check("l'image d'illustration est envoyée, réduite, et prévisualisée", /^bki_/.test(pickedImage) &&
        await page.waitForFunction(() => { const img = document.querySelector("#ad-bk-image img"); return img.complete && img.naturalWidth > 0 && img.naturalWidth <= 1600; }, null, { timeout: 10000 }).then(() => true, () => false), pickedImage);
  await page.click('#ad-bk-offer-form button[type="submit"]');
  await page.waitForSelector(".ad-bk-offer", { timeout: 10000 });
  check("la formule apparaît avec sa durée, son prix et « sans acompte »",
        /20 min · 90,00 € · sans acompte · Studio, Liège/.test((await page.textContent(".ad-bk-offer")).replace(/ /g, " ")),
        (await page.textContent(".ad-bk-offer .ad-hint")).replace(/ /g, " "));

  let admin = await client.request("GET", "/api/admin/booking");
  const noelOffer = admin.offers.find((o) => o.title === "Mini-séance de Noël");
  check("la formule garde son image, ce qui est compris et le conseil vestimentaire",
        noelOffer.imageId === pickedImage && noelOffer.included === "10 photos retouchées\n- Galerie privée en ligne" && noelOffer.dressCode === "Tons doux et unis, sans logo.",
        JSON.stringify(noelOffer));
  check("elle est sauvegardée comme prestation (image comprise)",
        admin.templates.length === 1 && admin.templates[0].title === "Mini-séance de Noël" && admin.templates[0].imageId === pickedImage &&
        admin.templates[0].dressCode === "Tons doux et unis, sans logo.", JSON.stringify(admin.templates));
  check("la vignette de la formule s'affiche dans la liste",
        await page.waitForFunction(() => { const img = document.querySelector(".ad-bk-offer img.ad-bk-thumb"); return Boolean(img && img.complete && img.naturalWidth > 0); }, null, { timeout: 10000 }).then(() => true, () => false));
  check("« Type de séance » propose la prestation enregistrée",
        (await page.locator("#ad-bk-template option").allTextContents()).some((t) => t.replace(/ /g, " ").startsWith("Mini-séance de Noël · 20 min")),
        (await page.locator("#ad-bk-template option").allTextContents()).join("|"));

  /* ---------- Créneaux : horaires précis puis série ---------- */

  await page.fill('#ad-bk-slot-form [name="date"]', DAY_A);
  await page.fill('#ad-bk-slot-form [name="times"]', "14h30");
  await page.click('#ad-bk-slot-form button[type="submit"]');
  await page.waitForSelector(".ad-bk-chip", { timeout: 10000 });
  check("un horaire précis (« 14h30 ») ouvre un créneau à 14 h 30, heure de Bruxelles",
        (await page.textContent(".ad-bk-chip")).startsWith("14 h 30"), await page.textContent(".ad-bk-chip"));

  await page.click('[data-bk-mode="series"]');
  await page.fill('#ad-bk-slot-form [name="date"]', DAY_B);
  await page.fill('#ad-bk-slot-form [name="from"]', "10:00");
  await page.fill('#ad-bk-slot-form [name="to"]', "11:00");
  await page.click('#ad-bk-slot-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll(".ad-bk-chip").length === 4, null, { timeout: 10000 });
  const chips = await page.locator(".ad-bk-chip").allTextContents();
  check("une série de 10 h à 11 h ouvre les mini-séances de 10 h 00, 10 h 20 et 10 h 40",
        chips.slice(1).map((t) => t.replace("×", "").trim()).join("|") === "10 h 00|10 h 20|10 h 40", chips.join("|"));

  // Une formule avec acompte, alors que le paiement en ligne n'est pas actif.
  await page.click("#ad-bk-new");
  await page.waitForSelector("#ad-bk-offer-form", { timeout: 10000 });
  check("« Créer une nouvelle prestation » ouvre un formulaire vide",
        (await page.inputValue('#ad-bk-offer-form [name="title"]')) === "" && (await page.inputValue('#ad-bk-offer-form [name="imageId"]')) === "");
  await page.fill('#ad-bk-offer-form [name="title"]', "Séance famille");
  await page.fill('#ad-bk-offer-form [name="durationMin"]', "60");
  await page.fill('#ad-bk-offer-form [name="price"]', "180");
  await page.fill('#ad-bk-offer-form [name="deposit"]', "50");
  await page.uncheck('#ad-bk-offer-form [name="saveTemplate"]');
  await page.click('#ad-bk-offer-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll(".ad-bk-offer").length === 2, null, { timeout: 10000 });
  check("sans paiement en ligne actif, un bandeau prévient que les formules avec acompte attendront",
        (await page.locator(".ad-banner").allTextContents()).some((t) => t.includes("Onglet Facturation")));
  admin = await client.request("GET", "/api/admin/booking");
  check("case décochée : la formule n'est pas sauvegardée comme prestation", admin.templates.length === 1);
  const familyOffer = admin.offers.find((o) => o.depositCents === 5000);
  await client.request("POST", "/api/admin/booking/slots", { offerId: familyOffer.id, date: DAY_A, times: ["16:00"] });

  /* ---------- Le client réserve sur le mini-site ---------- */

  const visitor = await browser.newPage({ viewport: { width: 390, height: 844 } });
  visitor.on("pageerror", (err) => exceptions.push(String(err)));
  await visitor.goto(`http://localhost:${SITE_PORT}/portfolio.html?s=${HANDLE}`, { waitUntil: "domcontentloaded" });
  await visitor.waitForSelector("#reserver:not([hidden])", { timeout: 15000 });
  check("le mini-site affiche « Réserver » et en fait l'appel principal de la couverture",
        (await visitor.textContent("#pf-hero-cta")) === "Réserver une séance" && (await visitor.evaluate(() => !document.getElementById("pf-nav-booking").hidden)));
  check("seule la formule sans acompte est proposée tant que le paiement en ligne n'est pas actif",
        (await visitor.locator(".pf-bk-offer").count()) === 1 && (await visitor.textContent(".pf-bk-offer strong")) === "Mini-séance de Noël");
  check("la formule unique est présélectionnée, ses 4 créneaux affichés par jour",
        (await visitor.locator(".pf-bk-time").count()) === 4 && (await visitor.locator(".pf-bk-day").count()) === 2);
  check("la formule s'affiche avec son image d'illustration",
        await visitor.waitForFunction(() => { const img = document.querySelector(".pf-bk-offer img.pf-bk-offer-img"); return Boolean(img && img.complete && img.naturalWidth > 0); }, null, { timeout: 10000 }).then(() => true, () => false));
  check("« Compris dans votre forfait » liste chaque ligne (tirets retirés)",
        (await visitor.locator(".pf-bk-included-item").allTextContents()).join("|") === "10 photos retouchées|Galerie privée en ligne",
        (await visitor.locator(".pf-bk-included-item").allTextContents()).join("|"));

  await visitor.locator(".pf-bk-time").nth(1).click();
  check("le conseil vestimentaire s'affiche avant la réservation",
        await visitor.isVisible("#pf-bk-dress") && (await visitor.textContent("#pf-bk-dress-text")) === "Tons doux et unis, sans logo.");
  check("le récapitulatif reprend la formule et l'horaire choisis",
        (await visitor.textContent("#pf-bk-summary")).replace(/ /g, " ").includes("Mini-séance de Noël") &&
        (await visitor.textContent("#pf-bk-summary")).includes("10 h 00"),
        await visitor.textContent("#pf-bk-summary"));
  await visitor.fill('#pf-bk-form [name="name"]', "Camille Test");
  await visitor.fill('#pf-bk-form [name="email"]', "camille.test@example.com");
  await visitor.fill('#pf-bk-form [name="message"]', "Avec notre chien.");
  check("sans acompte, le bouton dit « Confirmer la réservation »", (await visitor.textContent("#pf-bk-submit")) === "Confirmer la réservation");
  await visitor.click("#pf-bk-submit");
  await visitor.waitForSelector("#pf-bk-result:not([hidden])", { timeout: 10000 });
  check("la réservation est confirmée à l'écran", (await visitor.textContent("#pf-bk-result h3")) === "Votre séance est réservée",
        await visitor.textContent("#pf-bk-result"));
  check("la confirmation rappelle le conseil vestimentaire",
        (await visitor.textContent("#pf-bk-result")).includes("Conseil vestimentaire : Tons doux et unis, sans logo."));

  /* ---------- Règles côté serveur ---------- */

  const publicOffers = async () => (await (await fetch(`${API}/api/booking/${HANDLE}`)).json()).offers;
  let offers = await publicOffers();
  check("le créneau réservé n'est plus proposé", offers[0].slots.length === 3);

  admin = await client.request("GET", "/api/admin/booking");
  const booked = admin.bookings.find((b) => b.clientEmail === "camille.test@example.com");
  check("la réservation garde une copie du conseil vestimentaire et de ce qui est compris (pour les e-mails)",
        booked.dressCode === "Tons doux et unis, sans logo." && booked.included.startsWith("10 photos"));
  const imageStatus = (id) => fetch(`${API}/api/booking/${HANDLE}/image/${id}`).then((r) => r.status);
  check("l'image d'une formule proposée est publique, une image inconnue ne l'est pas",
        (await imageStatus(pickedImage)) === 200 && (await imageStatus("bki_inconnue123")) === 404);
  const again = await fetch(`${API}/api/booking/${HANDLE}/book`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slotId: booked.slotId, name: "Autre", email: "autre@example.com", returnUrl: `http://localhost:${SITE_PORT}/` }),
  });
  check("un même créneau ne peut pas être réservé deux fois (409)", again.status === 409);
  const deleteBooked = await client.request("DELETE", `/api/admin/booking/slots/${booked.slotId}`).catch((err) => err);
  check("un créneau réservé ne peut pas être supprimé", deleteBooked.status === 409);
  const blocked = await freeClient.request("POST", "/api/admin/booking/offers", { title: "x", durationMin: 30 }).catch((err) => err);
  check("la formule Découverte n'inclut pas la réservation en ligne (402)", blocked.status === 402, blocked.status);

  // Paiement en ligne activé : la formule avec acompte devient réservable,
  // et la réservation passe par Stripe (non configuré ici : refus propre,
  // créneau aussitôt libéré).
  await localSql(API, `UPDATE photographers SET stripe_account_id = 'acct_test', stripe_charges_enabled = 1 WHERE email = '${account.email}'`);
  offers = await publicOffers();
  const withDeposit = offers.find((o) => o.depositCents === 5000);
  check("avec le paiement en ligne actif, la formule avec acompte est proposée", Boolean(withDeposit) && withDeposit.slots.length === 1);
  const paid = await fetch(`${API}/api/booking/${HANDLE}/book`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slotId: withDeposit.slots[0].id, name: "Paul", email: "paul@example.com", returnUrl: `http://localhost:${SITE_PORT}/portfolio.html?s=${HANDLE}` }),
  });
  offers = await publicOffers();
  check("sans Stripe configuré, l'acompte est refusé proprement et le créneau reste libre",
        [502, 503].includes(paid.status) && offers.find((o) => o.depositCents === 5000).slots.length === 1, paid.status);

  /* ---------- Le photographe voit la séance et l'annule ---------- */

  await page.click("#ad-tab-galleries");
  await page.click("#ad-tab-booking");
  await page.waitForSelector("#ad-bk-upcoming .ad-bk-table", { timeout: 10000 });
  const row = (await page.textContent("#ad-bk-upcoming tbody tr")).replace(/ /g, " ");
  check("la séance réservée apparaît dans « Prochaines séances » avec le client et son message",
        row.includes("Camille Test") && row.includes("camille.test@example.com") && row.includes("Avec notre chien") && row.includes("Confirmée"), row);
  check("le créneau réservé porte le nom du client dans la liste des créneaux",
        (await page.locator(".ad-bk-chip-booked").allTextContents()).some((t) => t.includes("Camille Test")));

  await page.click(`[data-bk-cancel="${booked.id}"]`);
  await page.waitForSelector("#ad-confirm-modal:not([hidden])");
  await page.click("#ad-confirm-ok");
  await page.waitForFunction(() => !document.querySelector("#ad-bk-upcoming tbody tr") || !document.querySelector("[data-bk-cancel]"), null, { timeout: 10000 });
  offers = await publicOffers();
  check("annuler la séance libère le créneau sur le mini-site", offers.find((o) => o.title === "Mini-séance de Noël").slots.length === 4);

  // Supprimer une formule sans réservation à venir emporte ses créneaux libres.
  await client.request("DELETE", `/api/admin/booking/offers/${familyOffer.id}`);
  admin = await client.request("GET", "/api/admin/booking");
  check("supprimer une formule supprime aussi ses créneaux libres",
        admin.offers.length === 1 && !admin.slots.some((s) => s.offerId === familyOffer.id));

  /* ---------- Plusieurs tarifs selon le nombre de photos ---------- */

  await page.click("#ad-tab-galleries");
  await page.click("#ad-tab-booking");
  await page.waitForSelector("#ad-bk-offers", { timeout: 10000 });
  await page.click("#ad-bk-new");
  await page.fill('#ad-bk-offer-form [name="title"]', "Mini-séance au choix");
  await page.fill('#ad-bk-offer-form [name="durationMin"]', "20");
  await page.click('#ad-bk-offer-form [data-bk-pricing="tiers"]');
  check("« Plusieurs tarifs » remplace le prix unique par des lignes de tarifs",
        await page.isHidden('#ad-bk-offer-form [name="price"]') && (await page.locator("#ad-bk-offer-form .ad-bk-tier").count()) === 2);
  const tierRow = (i) => page.locator("#ad-bk-offer-form .ad-bk-tier").nth(i);
  await tierRow(0).locator('[data-tier="photos"]').fill("5");
  await tierRow(0).locator('[data-tier="price"]').fill("90");
  await tierRow(1).locator('[data-tier="label"]').fill("Complète");
  await tierRow(1).locator('[data-tier="photos"]').fill("10");
  await tierRow(1).locator('[data-tier="price"]').fill("120");
  await page.click("#ad-bk-tier-add");
  await tierRow(2).locator('[data-tier="photos"]').fill("15");
  await tierRow(2).locator('[data-tier="price"]').fill("150");
  await page.fill('#ad-bk-offer-form [name="deposit"]', "0");
  await page.click('#ad-bk-offer-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll(".ad-bk-offer").length === 2, null, { timeout: 10000 });
  const tierMeta = (await page.locator(".ad-bk-offer", { hasText: "Mini-séance au choix" }).innerText()).replace(/ /g, " ");
  check("la formule affiche ses trois tarifs", tierMeta.includes("5 photos 90,00 € / Complète : 10 photos 120,00 € / 15 photos 150,00 €"), tierMeta);
  admin = await client.request("GET", "/api/admin/booking");
  const tiered = admin.offers.find((o) => o.title === "Mini-séance au choix");
  check("côté serveur : tarifs triés, prix de la formule = le moins cher",
        tiered.tiers.length === 3 && tiered.priceCents === 9000 && tiered.tiers[1].label === "Complète", JSON.stringify(tiered.tiers));
  const tooHigh = await client.request("POST", `/api/admin/booking/offers/${tiered.id}`, { depositCents: 10000 }).catch((err) => err);
  check("l'acompte ne peut pas dépasser le tarif le moins cher", tooHigh.status === 400 && /moins cher/.test(tooHigh.message || ""), tooHigh.message);
  await client.request("POST", `/api/admin/booking/offers/${tiered.id}`, { active: false });
  await client.request("POST", `/api/admin/booking/offers/${tiered.id}`, { active: true });
  admin = await client.request("GET", "/api/admin/booking");
  check("désactiver puis réactiver la formule garde ses tarifs", admin.offers.find((o) => o.id === tiered.id).tiers.length === 3);
  await client.request("POST", "/api/admin/booking/slots", { offerId: tiered.id, date: DAY_A, times: ["17:00", "17:30"] });

  await visitor.goto(`http://localhost:${SITE_PORT}/portfolio.html?s=${HANDLE}`, { waitUntil: "domcontentloaded" });
  await visitor.waitForSelector(".pf-bk-offer", { timeout: 15000 });
  const tierCard = visitor.locator(".pf-bk-offer", { hasText: "Mini-séance au choix" });
  check("sur le mini-site : « 5 à 15 photos, à partir de 90 € »", (await tierCard.innerText()).replace(/ /g, " ").includes("5 à 15 photos, à partir de 90 €"), await tierCard.innerText());
  await tierCard.click();
  await visitor.locator(".pf-bk-time").first().click();
  check("après le créneau, le client choisit son nombre de photos (le moins cher présélectionné)",
        await visitor.isVisible("#pf-bk-tier-step") && (await visitor.locator(".pf-bk-tier").count()) === 3 &&
        (await visitor.getAttribute(".pf-bk-tier >> nth=0", "aria-pressed")) === "true" &&
        (await visitor.textContent("#pf-bk-step-contact")) === "4. Vos coordonnées");
  await visitor.locator(".pf-bk-tier").nth(1).click();
  check("le récapitulatif suit le tarif choisi", (await visitor.textContent("#pf-bk-summary")).replace(/ /g, " ").includes("10 photos, 120 €"),
        await visitor.textContent("#pf-bk-summary"));
  await visitor.fill('#pf-bk-form [name="name"]', "Inès Tarif");
  await visitor.fill('#pf-bk-form [name="email"]', "ines.tarif@example.com");
  await visitor.click("#pf-bk-submit");
  await visitor.waitForSelector("#pf-bk-result:not([hidden])", { timeout: 10000 });
  check("la confirmation reprend la formule choisie",
        (await visitor.textContent("#pf-bk-result")).replace(/ /g, " ").includes("Votre formule : 10 photos retouchées (Complète), 120 €"), await visitor.textContent("#pf-bk-result"));
  admin = await client.request("GET", "/api/admin/booking");
  const tierBooking = admin.bookings.find((b) => b.clientEmail === "ines.tarif@example.com");
  check("la réservation enregistre le nombre de photos, le nom et le prix du tarif",
        tierBooking && tierBooking.photos === 10 && tierBooking.tierLabel === "Complète" && tierBooking.priceCents === 12000, JSON.stringify(tierBooking));
  const freeSlot = (await publicOffers()).find((o) => o.id === tiered.id).slots[0];
  const badTier = await fetch(`${API}/api/booking/${HANDLE}/book`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ slotId: freeSlot.id, tier: 7, name: "X", email: "x@example.com", returnUrl: `http://localhost:${SITE_PORT}/` }),
  });
  check("un tarif qui n'existe pas est refusé", badTier.status === 400);
  await page.click("#ad-tab-galleries");
  await page.click("#ad-tab-booking");
  await page.waitForSelector("#ad-bk-upcoming .ad-bk-table", { timeout: 10000 });
  const tierRowText = (await page.locator("#ad-bk-upcoming tbody tr", { hasText: "Inès Tarif" }).innerText()).replace(/ /g, " ");
  check("dans « Prochaines séances » : 10 photos (Complète) · 120,00 €", tierRowText.includes("10 photos (Complète) · 120,00 €"), tierRowText);
  await client.request("POST", `/api/admin/booking/offers/${tiered.id}`, { tiers: [], priceCents: 10000 });
  admin = await client.request("GET", "/api/admin/booking");
  const single = admin.offers.find((o) => o.id === tiered.id);
  check("repasser au prix unique efface les tarifs", single.tiers.length === 0 && single.priceCents === 10000);

  /* ---------- Prestations enregistrées : remettre en ligne sans tout reparamétrer ---------- */

  admin = await client.request("GET", "/api/admin/booking");
  const tieredTemplate = admin.templates.find((t) => t.title === "Mini-séance au choix");
  check("la formule à plusieurs tarifs est aussi sauvegardée, avec ses tarifs", Boolean(tieredTemplate) && tieredTemplate.tiers.length === 3,
        JSON.stringify(admin.templates.map((t) => t.title)));
  // L'ancienne formule de Noël est supprimée : la prestation, elle, reste.
  await client.request("DELETE", `/api/admin/booking/offers/${noelOffer.id}`);
  const adminImage = (id) => client.rawGet(`/api/admin/booking/images/${id}`).then((r) => r.status);
  check("supprimer la formule garde l'image tant que la prestation l'utilise", (await adminImage(pickedImage)) === 200);

  await page.click("#ad-tab-galleries");
  await page.click("#ad-tab-booking");
  await page.waitForSelector("#ad-bk-template", { timeout: 10000 });
  const noelTemplate = admin.templates.find((t) => t.title === "Mini-séance de Noël");
  await page.selectOption("#ad-bk-template", noelTemplate.id);
  await page.waitForSelector("#ad-bk-offer-form", { timeout: 10000 });
  check("choisir la prestation pré-remplit tout le formulaire, image comprise",
        (await page.inputValue('#ad-bk-offer-form [name="title"]')) === "Mini-séance de Noël" &&
        (await page.inputValue('#ad-bk-offer-form [name="durationMin"]')) === "20" &&
        (await page.inputValue('#ad-bk-offer-form [name="price"]')) === "90" &&
        (await page.inputValue('#ad-bk-offer-form [name="dressCode"]')) === "Tons doux et unis, sans logo." &&
        (await page.inputValue('#ad-bk-offer-form [name="imageId"]')) === pickedImage &&
        (await page.textContent("#ad-bk-offers .ad-sc-subhead")).includes("à partir de « Mini-séance de Noël »"),
        await page.textContent("#ad-bk-offers .ad-sc-subhead"));
  await page.click('#ad-bk-offer-form button[type="submit"]');
  await page.waitForFunction(() => [...document.querySelectorAll(".ad-bk-offer strong")].some((n) => n.textContent === "Mini-séance de Noël"), null, { timeout: 10000 });
  admin = await client.request("GET", "/api/admin/booking");
  const reborn = admin.offers.find((o) => o.title === "Mini-séance de Noël");
  check("la formule est remise en ligne à l'identique, sans doublon de prestation",
        Boolean(reborn) && reborn.imageId === pickedImage && reborn.included === noelOffer.included && reborn.location === "Studio, Liège" &&
        admin.templates.filter((t) => t.title === "Mini-séance de Noël").length === 1, JSON.stringify(reborn));

  // Supprimer la prestation (fenêtre de confirmation), puis la formule : l'image part avec la dernière.
  await page.click("#ad-bk-offers .ad-bk-templates summary");
  await page.click(`[data-bk-template-delete="${noelTemplate.id}"]`);
  await page.waitForSelector("#ad-confirm-modal:not([hidden])");
  await page.click("#ad-confirm-ok");
  await page.waitForFunction((id) => !document.querySelector(`[data-bk-template-delete="${id}"]`), noelTemplate.id, { timeout: 10000 });
  admin = await client.request("GET", "/api/admin/booking");
  check("la prestation supprimée disparaît de « Type de séance », la formule reste en ligne",
        !admin.templates.some((t) => t.id === noelTemplate.id) && admin.offers.some((o) => o.id === reborn.id) &&
        !(await page.locator("#ad-bk-template option").allTextContents()).some((t) => t.startsWith("Mini-séance de Noël")));
  check("l'image reste tant que la formule l'utilise", (await adminImage(pickedImage)) === 200);
  await client.request("DELETE", `/api/admin/booking/offers/${reborn.id}`);
  check("plus aucune formule ni prestation ne l'utilise : l'image est effacée", (await adminImage(pickedImage)) === 404);
  const badImage = await client.request("POST", "/api/admin/booking/offers", { title: "Image fantôme", durationMin: 30, imageId: "bki_fantome1234" }).catch((err) => err);
  check("une image inexistante est refusée", badImage.status === 400, badImage.status);

  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} finally {
  await browser.close();
  site.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
