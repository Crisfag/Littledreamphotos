// Suivi d'une séance, de la réservation à la livraison, dans un vrai
// navigateur : la réservation crée la fiche client ; depuis la carte de la
// séance, le photographe envoie le contrat (puis le relance), la liste
// récapitulative de la formule, crée la galerie (rattachée à la séance) et
// l'envoie au client avec un nouveau mot de passe ; la livraison clôt le suivi.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/suivi.test.mjs

import { chromium } from "playwright";
import { WorkerClient } from "../lib/client.mjs";
import { createTestAccount, localSql } from "./lib/testAccount.mjs";

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

const account = await createTestAccount(API, "suivi");
const client = new WorkerClient({ api: API, ...account });
const CAMILLE = `camille.${Date.now().toString(36)}@test.invalid`;
const LEA = `lea.${Date.now().toString(36)}@test.invalid`;
const PREP = "2 ou 3 tenues aux tons doux\nUn doudou\nArrivez 10 minutes avant";

let admin = await client.request("POST", "/api/admin/booking/offers", { title: "Séance naissance", durationMin: 90, priceCents: 18000, depositCents: 0, prep: PREP });
const birth = admin.offers.find((o) => o.title === "Séance naissance");
check("formule : liste récapitulative enregistrée", birth.prep === PREP);
admin = await client.request("POST", "/api/admin/booking/offers", { title: "Mini-séance", durationMin: 20, priceCents: 6000, depositCents: 0, dressCode: "Pulls de Noël bienvenus" });
const mini = admin.offers.find((o) => o.title === "Mini-séance");
admin = await client.request("POST", "/api/admin/booking/slots", { offerIds: [birth.id], date: dayAhead(12), times: ["10:00"] });
admin = await client.request("POST", "/api/admin/booking/slots", { offerIds: [mini.id], date: dayAhead(14), times: ["14:00", "15:00"] });
const birthSlot = admin.slots.find((s) => s.offerId === birth.id);
const miniSlots = admin.slots.filter((s) => s.offerId === mini.id);

// Deux séances réservées par le photographe pour ses clients.
admin = await client.request("POST", `/api/admin/booking/slots/${birthSlot.id}/book`, { name: "Camille Dubois", email: CAMILLE, phone: "0470 12 34 56", notify: false });
const camilleBooking = admin.bookings.find((b) => b.clientEmail === CAMILLE);
admin = await client.request("POST", `/api/admin/booking/slots/${miniSlots[0].id}/book`, { name: "Léa Martin", email: LEA, notify: false });
const leaBooking = admin.bookings.find((b) => b.clientEmail === LEA);
const clients = await client.request("GET", "/api/admin/clients");
const camilleCard = clients.clients.find((c) => c.email === CAMILLE);
const detail = await client.request("GET", `/api/admin/clients/detail?email=${encodeURIComponent(CAMILLE)}`);
check("la réservation crée la fiche client (nom et téléphone)", Boolean(camilleCard && detail.client.recordId) && detail.client.phone.replace(/\s/g, "").endsWith("470123456"), JSON.stringify(detail.client && { recordId: detail.client.recordId, phone: detail.client.phone }));
check("suivi : liste de la formule proposée, sinon le conseil vestimentaire",
      camilleBooking.followUp.prep === PREP && leaBooking.followUp.prep === "Pulls de Noël bienvenus" && !leaBooking.followUp.offerPrep);

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

async function openBookings() {
  // Rechargement complet : les données changées en base sont relues.
  await page.goto(`${BASE}/#/reservations`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".ad-bk-session", { timeout: 15000 });
}
function card(bookingId) {
  return page.locator(`.ad-bk-session[data-booking="${bookingId}"]`);
}
async function toastText() {
  await page.waitForSelector(".ad-toast", { timeout: 10000 });
  return page.locator(".ad-toast").last().textContent();
}

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.fill('#ad-login-form [name="email"]', account.email);
  await page.fill('#ad-login-form [name="password"]', account.password);
  await page.click("#ad-login-submit");
  await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });
  await openBookings();

  const camille = card(camilleBooking.id);
  check("carte de séance : client, formule, piste en 5 étapes", (await camille.locator(".ad-flow-step").count()) === 5 &&
        (await camille.textContent()).includes("Camille Dubois") && (await camille.locator('[data-step="client"]').getAttribute("class")).includes("is-done"));
  check("prochain geste : le contrat, bouton en couleur d'action",
        (await camille.locator('[data-step="contract"]').getAttribute("class")).includes("is-next") &&
        (await camille.locator('[data-step="contract"] .ad-btn-primary').textContent()) === "Envoyer le contrat");
  check("bandeau « À faire » : contrats et listes", /2 contrats à envoyer/.test(await page.textContent(".ad-flow-todo")) && /2 listes récapitulatives/.test(await page.textContent(".ad-flow-todo")), await page.textContent(".ad-flow-todo"));

  /* ---------- Contrat ---------- */
  await camille.locator('[data-step="contract"] .ad-btn-primary').click();
  await page.waitForSelector('.ad-flow-panel[data-flow-form="contract"]');
  check("panneau contrat : prix de la réservation prérempli", (await page.inputValue('.ad-flow-panel [name="price"]')) === "180");
  await page.fill('.ad-flow-panel [name="deposit"]', "50");
  await page.click('.ad-flow-panel [type="submit"]');
  check("contrat envoyé (message)", /Contrat envoyé à camille/.test(await toastText()));
  await page.waitForSelector(`.ad-bk-session[data-booking="${camilleBooking.id}"] [data-step="contract"].is-wait`);
  const contracts = await client.request("GET", "/api/admin/contracts");
  const contract = contracts.contracts.find((c) => c.clientEmail === CAMILLE);
  check("contrat : client, date, ligne au prix, acompte 50 €, envoyé",
        contract && contract.status === "sent" && contract.title === "Séance naissance" && contract.sessionDay === dayAhead(12) && contract.sessionTime === "10:00" &&
        contract.totalCents === 18000 && contract.depositCents === 5000, JSON.stringify(contract && { status: contract.status, day: contract.sessionDay, time: contract.sessionTime, total: contract.totalCents }));
  check("étape contrat : « Envoyé le …, pas encore signé », relance pas encore possible",
        /Envoyé le .*pas encore signé/.test(await camille.locator('[data-step="contract"] .ad-flow-text').textContent()) &&
        await camille.locator("[data-flow-remind]").isDisabled());
  const again = await client.request("POST", `/api/admin/booking/bookings/${camilleBooking.id}/contract`, { send: true }).catch((err) => err);
  check("un seul contrat vivant par séance (409)", again.status === 409, again.message);

  // Deux jours plus tard : la relance est possible.
  await localSql(API, `UPDATE contracts SET sent_at = sent_at - 172800 WHERE id = '${contract.id}'`);
  await openBookings();
  await card(camilleBooking.id).locator("[data-flow-remind]").click();
  check("relance envoyée", /Rappel envoyé/.test(await toastText()));
  await page.waitForFunction((id) => /relancé le/.test(document.querySelector(`.ad-bk-session[data-booking="${id}"] [data-step="contract"]`).textContent), camilleBooking.id);
  const twice = await client.request("POST", `/api/admin/booking/bookings/${camilleBooking.id}/contract/remind`, {}).catch((err) => err);
  check("une relance par jour au plus (429)", twice.status === 429, twice.message);

  // Signé (comme le ferait le client) : l'étape passe au vert.
  await localSql(API, `UPDATE contracts SET status = 'paid', signed_at = strftime('%s','now'), paid_at = strftime('%s','now') WHERE id = '${contract.id}'`);

  /* ---------- Liste récapitulative ---------- */
  await openBookings();
  check("contrat signé : étape faite, PDF signé proposé",
        (await card(camilleBooking.id).locator('[data-step="contract"]').getAttribute("class")).includes("is-done") &&
        (await card(camilleBooking.id).locator('[data-step="contract"] a[download]').count()) === 1);
  check("prochain geste : la liste récapitulative", (await card(camilleBooking.id).locator('[data-step="prep"]').getAttribute("class")).includes("is-next"));
  await card(camilleBooking.id).locator('[data-step="prep"] .ad-btn-primary').click();
  await page.waitForSelector('.ad-flow-panel[data-flow-form="prep"]');
  check("panneau liste : celle de la formule, prête à envoyer", (await page.inputValue('.ad-flow-panel [name="prep"]')) === PREP &&
        !(await page.isChecked('.ad-flow-panel [name="saveToOffer"]')));
  if (SHOTS) await card(camilleBooking.id).screenshot({ path: `${SHOTS}/suivi-liste.png` });
  await page.fill('.ad-flow-panel [name="note"]', "Hâte de rencontrer bébé !");
  await page.click('.ad-flow-panel [type="submit"]');
  check("liste envoyée (message)", /Liste récapitulative envoyée/.test(await toastText()));
  await page.waitForSelector(`.ad-bk-session[data-booking="${camilleBooking.id}"] [data-step="prep"].is-done`);

  // Léa : liste écrite pour l'occasion, gardée pour la formule.
  await card(leaBooking.id).locator('[data-step="prep"] [data-flow="prep"]').click();
  await page.waitForSelector('.ad-flow-panel[data-flow-form="prep"]');
  check("formule sans liste : conseil vestimentaire repris, « garder pour la formule » coché",
        (await page.inputValue('.ad-flow-panel [name="prep"]')) === "Pulls de Noël bienvenus" && (await page.isChecked('.ad-flow-panel [name="saveToOffer"]')));
  await page.fill('.ad-flow-panel [name="prep"]', "Pulls de Noël bienvenus\nBonnet ou écharpe");
  await page.click('.ad-flow-panel [type="submit"]');
  await toastText();
  admin = await client.request("GET", "/api/admin/booking");
  check("la liste est gardée pour la formule « Mini-séance »", admin.offers.find((o) => o.id === mini.id).prep === "Pulls de Noël bienvenus\nBonnet ou écharpe");
  const empty = await client.request("POST", `/api/admin/booking/bookings/${leaBooking.id}/prep`, { prep: " \n - \n" }).catch((err) => err);
  check("liste vide refusée (400)", empty.status === 400, empty.message);

  /* ---------- Contrat relu d'abord dans l'éditeur ---------- */
  await openBookings();
  await card(leaBooking.id).locator('[data-step="contract"] [data-flow="contract"]').click();
  await page.click(".ad-flow-panel [data-flow-draft]");
  await page.waitForSelector("#ad-ct-form", { timeout: 10000 });
  check("« Relire d'abord » : l'éditeur du devis s'ouvre, prérempli",
        (await page.inputValue('#ad-ct-form [name="clientEmail"]')) === LEA && (await page.inputValue('#ad-ct-form [name="title"]')) === "Mini-séance" &&
        (await page.inputValue('#ad-ct-form [name="sessionDay"]')) === dayAhead(14));
  await openBookings();
  check("la séance garde le brouillon : « Relire et envoyer »", (await card(leaBooking.id).locator("[data-flow-open-contract]").textContent()) === "Relire et envoyer");

  /* ---------- Après la séance : galerie ---------- */
  // La séance de Camille a eu lieu.
  await localSql(API, `UPDATE bookings SET starts_at = strftime('%s','now') - 3 * 86400 WHERE id = '${camilleBooking.id}'`);
  await openBookings();
  check("séance passée : rangée dans « Séances à finaliser »", (await page.locator(`#ad-bk-finish [data-booking="${camilleBooking.id}"]`).count()) === 1);
  const finished = card(camilleBooking.id);
  check("prochain geste : créer la galerie", (await finished.locator('[data-step="gallery"] .ad-btn-primary').textContent()) === "Créer la galerie");
  await finished.locator("[data-flow-create-gallery]").click();
  await page.waitForSelector("#ad-create-modal:not([hidden])");
  check("création de galerie préremplie (titre, client, e-mail)",
        (await page.inputValue('#ad-create-form [name="title"]')) === "Séance naissance — Camille Dubois" &&
        (await page.inputValue('#ad-create-form [name="clientEmail"]')) === CAMILLE);
  await page.click("#ad-create-submit");
  await page.waitForSelector("#ad-created-modal:not([hidden])", { timeout: 15000 });
  await page.click("#ad-created-modal [data-close-modal]");
  admin = await client.request("GET", "/api/admin/booking");
  const linked = admin.bookings.find((b) => b.id === camilleBooking.id).followUp.gallery;
  check("la galerie est rattachée à la séance", linked && linked.title === "Séance naissance — Camille Dubois" && linked.photoCount === 0, JSON.stringify(linked));

  await openBookings();
  check("galerie vide : « ajoutez les photos »", /ajoutez les photos/.test(await card(camilleBooking.id).locator('[data-step="gallery"]').textContent()));
  const emptySend = await client.request("POST", `/api/admin/galleries/${linked.slug}/send`, { newPassword: "nouveau-mot-de-passe" }).catch((err) => err);
  check("galerie vide : envoi refusé, mot de passe inchangé", emptySend.status === 409 && /vide/.test(emptySend.message), emptySend.message);

  // Une photo (comme après l'envoi des photos).
  const gal = await client.request("GET", `/api/admin/galleries/${linked.slug}`);
  await localSql(API, `INSERT INTO photos (id, gallery_id, position, width, height, cols, rows, created_at) VALUES ('pho_suivi_${Date.now().toString(36)}', '${gal.gallery.id}', 0, 1200, 800, 4, 3, strftime('%s','now'))`);
  await openBookings();
  const sendBtn = card(camilleBooking.id).locator("[data-flow-send-gallery]");
  check("prochain geste : envoyer la galerie au client", (await sendBtn.getAttribute("class")).includes("ad-btn-primary"));
  await sendBtn.click();
  await page.waitForSelector("#ad-send-gallery-modal:not([hidden])");
  check("fenêtre d'envoi : e-mail du client, nouveau mot de passe par défaut",
        (await page.inputValue('#ad-send-gallery-form [name="email"]')) === CAMILLE && (await page.isChecked('#ad-send-gallery-form [value="new"]')) &&
        (await page.textContent("#ad-send-gallery-name")) === "Séance naissance — Camille Dubois");
  // Mauvais mot de passe actuel : refusé, rien n'est envoyé.
  await page.check('#ad-send-gallery-form [value="current"]');
  await page.fill('#ad-send-gallery-form [name="password"]', "pas-le-bon-mot-de-passe");
  await page.click("#ad-send-gallery-submit");
  await page.waitForSelector("#ad-send-gallery-error:not([hidden])");
  check("mot de passe actuel faux : refusé avant l'envoi", /ne correspond pas/.test(await page.textContent("#ad-send-gallery-error")));
  if (SHOTS) await page.locator("#ad-send-gallery-modal .ad-modal").screenshot({ path: `${SHOTS}/suivi-envoi-galerie.png` });
  await page.check('#ad-send-gallery-form [value="new"]');
  await page.fill('#ad-send-gallery-form [name="note"]', "Voici vos photos !");
  await page.click("#ad-send-gallery-submit");
  const sentToast = await toastText();
  const password = (sentToast.match(/nouveau mot de passe : (\S+?)\.?$/) || [])[1];
  check("galerie envoyée, nouveau mot de passe indiqué", /Galerie envoyée à camille/.test(sentToast) && Boolean(password), sentToast);
  const login = await fetch(`${API}/api/gallery/${linked.slug}/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
  check("le nouveau mot de passe ouvre la galerie", login.ok, String(login.status));
  await page.waitForSelector(`.ad-bk-session[data-booking="${camilleBooking.id}"] [data-step="gallery"].is-done`, { timeout: 10000 });
  check("étape galerie faite ; prochain geste : la livraison",
        (await card(camilleBooking.id).locator('[data-step="delivery"]').getAttribute("class")).includes("is-next"));
  if (SHOTS) await card(camilleBooking.id).screenshot({ path: `${SHOTS}/suivi-carte.png` });

  // La page de la galerie le sait aussi.
  await page.goto(`${BASE}/#/g/${linked.slug}`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-send-gallery", { timeout: 15000 });
  check("page de la galerie : « Envoyée le … » et bouton d'envoi", /Envoyée le/.test(await page.textContent(".ad-send-row")));

  // Livraison ouverte : le suivi est complet, la séance quitte « à finaliser ».
  await localSql(API, `UPDATE galleries SET delivery_open = 1, delivery_opened_at = strftime('%s','now') WHERE id = '${gal.gallery.id}'`);
  await openBookings();
  check("livraison ouverte : séance sortie de « à finaliser »", (await page.locator(`#ad-bk-finish [data-booking="${camilleBooking.id}"]`).count()) === 0);

  // Associer une galerie existante (même client).
  await client.request("POST", "/api/admin/galleries", { slug: `lea-${Date.now().toString(36)}`, title: "Noël de Léa", clientName: "Léa Martin", clientEmail: LEA, password: "mot-de-passe-lea" });
  await openBookings();
  await card(leaBooking.id).locator('[data-step="gallery"] [data-flow="gallery"]').click();
  await page.waitForSelector('.ad-flow-panel[data-flow-form="gallery"]');
  await page.click('.ad-flow-panel [type="submit"]');
  await toastText();
  admin = await client.request("GET", "/api/admin/booking");
  check("galerie existante du client associée à la séance", admin.bookings.find((b) => b.id === leaBooking.id).followUp.gallery?.title === "Noël de Léa");

  // Téléphone : la piste passe à la verticale, rien ne déborde.
  await openBookings();
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : les cartes tiennent dans l'écran", overflow <= 0, `${overflow}px`);
  if (SHOTS) await card(leaBooking.id).screenshot({ path: `${SHOTS}/suivi-mobile.png` });

  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
