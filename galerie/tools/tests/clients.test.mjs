// Fiches clients et relances, de bout en bout dans un vrai navigateur : la
// fiche se construit seule à partir des galeries, réservations, contrats et
// paiements ; le photographe y ajoute notes, téléphone et dates à retenir ;
// les relances (« Léa aura 1 an ») et les clients perdus de vue remontent en
// tête de liste, avec un message prêt à envoyer.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/clients.test.mjs

import { chromium } from "playwright";
import { WorkerClient } from "../lib/client.mjs";
import { createTestAccount, localSql } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}
const nbsp = (t) => String(t || "").replace(/[  ]/g, " ");

const account = await createTestAccount(API, "clients");
const client = new WorkerClient({ api: API, ...account });
const freeClient = new WorkerClient({ api: API, ...(await createTestAccount(API, "clients-free", { plan: "" })) });

/* ---------- Ce que Holypixx connaît déjà ---------- */

const now = Math.floor(Date.now() / 1000);
const tag = Date.now().toString(36);
await client.createGallery({ slug: `camille-${tag}`, title: "Séance grossesse", clientName: "Camille Dubois", clientEmail: "camille@example.com", password: "mot-de-passe-1" });
await client.createGallery({ slug: `leroy-${tag}`, title: "Famille Leroy au parc", clientName: "Famille Leroy", clientEmail: "leroy@example.com", password: "mot-de-passe-2" });
// La galerie des Leroy date d'il y a plus d'un an : client à recontacter.
await localSql(API, `UPDATE galleries SET created_at = ${now - 400 * 86400} WHERE slug = 'leroy-${tag}'`);
// Une séance réservée et payée dans trois semaines (e-mail en majuscules : même fiche).
await localSql(API, `INSERT INTO bookings (id, photographer_id, slot_id, offer_id, offer_title, starts_at, duration_min, price_cents, deposit_cents, client_name, client_email, client_phone, status, paid_at, created_at)
  SELECT 'bkg_cl_${tag}', id, 'slt_cl_${tag}', 'off_cl', 'Séance nouveau-né', ${now + 25 * 86400}, 90, 25000, 5000, 'Camille Dubois', 'Camille@Example.com', '+32 470 12 34 56', 'confirmed', ${now}, ${now}
  FROM photographers WHERE email = '${account.email}'`);
await client.request("POST", "/api/admin/contracts", {
  clientName: "Camille Dubois", clientEmail: "camille@example.com", title: "Séance nouveau-né", lines: [{ label: "Séance 1 h 30", amountCents: 25000 }], send: true,
});

const browser = await chromium.launch({ ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}) });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
const page = await context.newPage();
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-login-form", { timeout: 10000 });
  await page.fill('#ad-login-form [name="email"]', account.email);
  await page.fill('#ad-login-form [name="password"]', account.password);
  await page.click("#ad-login-submit");
  await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });

  /* ---------- La liste se remplit toute seule ---------- */

  await page.click("#ad-tab-clients");
  await page.waitForSelector("#ad-cl-rows", { timeout: 10000 });
  check("l'onglet Clients ouvre #/clients", (await page.evaluate(() => location.hash)) === "#/clients");
  const rows = page.locator("#ad-cl-rows tr[data-cl-email]");
  check("un client par adresse e-mail, majuscules comprises", (await rows.count()) === 2,
        (await rows.evaluateAll((r) => r.map((x) => x.dataset.clEmail))).join(", "));
  const camilleRow = nbsp(await page.locator('#ad-cl-rows tr[data-cl-email="camille@example.com"]').innerText());
  check("Camille : séances et acompte encaissé dans la liste", /2/.test(camilleRow) && /50,00/.test(camilleRow), camilleRow.replace(/\s+/g, " "));
  const dormant = page.locator(".ad-cl-reminds .ad-cl-remind", { hasText: "Famille Leroy" });
  check("les Leroy, sans séance depuis un an, sont à recontacter", (await dormant.count()) === 1 && /il y a 1 an/.test(await dormant.innerText()));
  const dormantMail = await dormant.locator("a.ad-btn").getAttribute("href");
  check("« Écrire » ouvre un message déjà rédigé", dormantMail.startsWith("mailto:leroy@example.com?subject=") && /body=/.test(dormantMail));

  await page.keyboard.press("/");
  check("« / » place le curseur dans la recherche", await page.evaluate(() => document.activeElement && document.activeElement.id === "ad-cl-search"));
  await page.keyboard.type("leroy");
  check("la recherche filtre au fil de la frappe", (await rows.count()) === 1 && (await rows.first().getAttribute("data-cl-email")) === "leroy@example.com");
  await page.fill("#ad-cl-search", "0470");
  check("on retrouve un client par son numéro", (await rows.count()) === 1 && (await rows.first().getAttribute("data-cl-email")) === "camille@example.com");
  await page.press("#ad-cl-search", "Escape");
  check("Échap vide la recherche", (await page.inputValue("#ad-cl-search")) === "" && (await rows.count()) === 2);
  await page.click('[data-cl-filter="upcoming"]');
  check("filtre « Séance prévue »", (await rows.count()) === 1 && (await rows.first().getAttribute("data-cl-email")) === "camille@example.com");
  await page.click('[data-cl-filter="all"]');

  /* ---------- La fiche ---------- */

  await page.click('#ad-cl-rows tr[data-cl-email="camille@example.com"]');
  await page.waitForSelector(".ad-cl-head h2");
  check("un clic sur la ligne ouvre la fiche (#/clients/…)",
        (await page.evaluate(() => decodeURIComponent(location.hash))) === "#/clients/camille@example.com" && (await page.textContent(".ad-cl-head h2")) === "Camille Dubois");
  const stats = nbsp(await page.locator(".ad-stats").innerText());
  check("chiffres de la fiche : séances, encaissé, prochaine séance", /50,00/.test(stats) && /dans 2[45] jours/.test(stats), stats.replace(/\s+/g, " "));
  const history = page.locator(".ad-cl-history .ad-cl-event");
  check("historique : galerie, réservation et contrat", (await history.count()) === 3 &&
        (await page.locator(".ad-cl-event-gallery").count()) === 1 && (await page.locator(".ad-cl-event-booking").count()) === 1 && (await page.locator(".ad-cl-event-contract").count()) === 1);
  check("le téléphone de la réservation est repris", (await page.locator('.ad-cl-contact a[href="tel:+32470123456"]').count()) === 1);
  await page.click("#ad-cl-copy");
  await page.waitForSelector("#ad-toast:not([hidden])");
  check("« Copier » met l'adresse dans le presse-papiers", (await page.evaluate(() => navigator.clipboard.readText())) === "camille@example.com");

  // Notes : enregistrées seules, une seconde après la dernière frappe.
  await page.fill("#ad-cl-notes", "Léa, née le 22 octobre. Allergique aux chats.");
  await page.waitForSelector(".ad-cl-saved-ok", { timeout: 5000 });
  check("les notes s'enregistrent seules", /Enregistré à \d\d:\d\d/.test(await page.textContent("#ad-cl-saved")));

  // Date à retenir : le premier anniversaire de Léa, dans dix jours.
  const birth = new Date();
  birth.setUTCDate(birth.getUTCDate() + 10);
  birth.setUTCFullYear(birth.getUTCFullYear() - 1);
  await page.selectOption('#ad-cl-date-form [name="kind"]', "birthday");
  check("le libellé du champ suit le type de date", (await page.textContent("#ad-cl-label-name")) === "Prénom");
  await page.fill('#ad-cl-date-form [name="label"]', "Léa");
  await page.fill('#ad-cl-date-form [name="date"]', birth.toISOString().slice(0, 10));
  await page.click('#ad-cl-date-form button[type="submit"]');
  await page.waitForSelector(".ad-cl-dateitem");
  const dateItem = nbsp(await page.locator(".ad-cl-dateitem").innerText());
  check("la date apparaît : « Léa aura 1 an », dans 10 jours", /Léa aura 1 an/.test(dateItem) && /dans 1[01] jours/.test(dateItem), dateItem.replace(/\s+/g, " "));
  check("l'échéance proche est signalée", (await page.locator(".ad-cl-dateitem .ad-cl-when-soon").count()) === 1);
  const dateMail = decodeURIComponent(await page.locator(".ad-cl-dateitem a.ad-btn").getAttribute("href"));
  check("message prêt : premier anniversaire, prénom, signé du studio",
        /premier anniversaire/.test(dateMail) && /Léa/.test(dateMail) && /Camille/.test(dateMail), dateMail.slice(0, 160).replace(/\n/g, " "));

  // Une date de naissance dans le futur est refusée.
  const future = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  const refused = await client.request("POST", "/api/admin/clients/dates", { email: "camille@example.com", kind: "birthday", label: "Bébé", date: future }).catch((err) => err);
  check("une naissance dans le futur est refusée", refused.status === 400);

  // Coordonnées.
  await page.fill('#ad-cl-info [name="phone"]', "+32 499 00 11 22");
  await page.click('#ad-cl-info button[type="submit"]');
  await page.waitForSelector('.ad-cl-contact a[href="tel:+32499001122"]');
  check("le téléphone se met à jour", true);

  // Les notes ont survécu au rafraîchissement de la fiche.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-cl-notes");
  check("la fiche se rouvre depuis l'adresse, notes comprises",
        (await page.inputValue("#ad-cl-notes")) === "Léa, née le 22 octobre. Allergique aux chats.");

  // Rappel désactivé, puis réactivé.
  await page.uncheck("[data-cld-remind]");
  await page.waitForFunction(() => document.querySelector("[data-cld-remind]") && !document.querySelector("[data-cld-remind]").checked);
  let detail = await client.request("GET", "/api/admin/clients/detail?email=camille%40example.com");
  check("le rappel par e-mail se coupe date par date", detail.dates[0].remind === false);
  await page.check("[data-cld-remind]");
  await page.waitForTimeout(400);
  detail = await client.request("GET", "/api/admin/clients/detail?email=camille%40example.com");
  check("… et se rallume", detail.dates[0].remind === true);

  /* ---------- Les relances dans la liste et le menu ---------- */

  await page.click("#ad-cl-back");
  await page.waitForSelector(".ad-cl-reminds");
  const lea = page.locator(".ad-cl-reminds .ad-cl-remind", { hasText: "Léa aura 1 an" });
  check("« Léa aura 1 an » en tête de liste, avec « Proposer une séance »",
        (await lea.count()) === 1 && /mailto:camille@example\.com/.test(await lea.locator("a.ad-btn-primary").getAttribute("href")));
  check("la pastille du menu compte les clients à relancer", (await page.textContent("#ad-tab-clients .ad-tab-count")) === "1");
  const dateCell = nbsp(await page.locator('#ad-cl-rows tr[data-cl-email="camille@example.com"]').innerText());
  check("la prochaine date figure dans la liste", /Léa aura 1 an/.test(dateCell));
  await page.click('[data-cl-filter="dates"]');
  check("filtre « Avec date à retenir »", (await rows.count()) === 1);
  await page.click('[data-cl-filter="all"]');

  // La pastille apparaît dès l'ouverture du tableau de bord.
  await page.goto(BASE + "/#/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-tab-clients .ad-tab-count", { timeout: 10000 });
  check("pastille visible sans ouvrir l'onglet", (await page.textContent("#ad-tab-clients .ad-tab-count")) === "1");

  /* ---------- Les autres écrans mènent à la fiche ---------- */

  await page.click("#ad-tab-booking");
  await page.waitForSelector('.ad-bk-table a.ad-cl-link', { timeout: 10000 });
  await page.click('.ad-bk-table a.ad-cl-link');
  await page.waitForSelector(".ad-cl-head h2");
  check("réservation → fiche du client", (await page.textContent(".ad-cl-head h2")) === "Camille Dubois");
  await page.click("#ad-tab-contracts");
  await page.waitForSelector("a.ad-cl-link", { timeout: 10000 });
  check("contrat → fiche du client", (await page.getAttribute("a.ad-cl-link", "href")) === "#/clients/camille%40example.com");

  /* ---------- Depuis la fiche : devis et galerie préremplis ---------- */

  await page.goto(BASE + "/#/clients/camille%40example.com", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-cl-quote");
  await page.click("#ad-cl-quote");
  await page.waitForSelector("#ad-ct-form");
  check("« Nouveau devis » préremplit le client",
        (await page.inputValue('#ad-ct-form [name="clientName"]')) === "Camille Dubois" && (await page.inputValue('#ad-ct-form [name="clientEmail"]')) === "camille@example.com");
  await page.goto(BASE + "/#/clients/camille%40example.com", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-cl-gallery");
  await page.click("#ad-cl-gallery");
  await page.waitForSelector("#ad-create-form", { state: "visible" });
  check("« Nouvelle galerie » préremplit le client",
        (await page.inputValue('#ad-create-form [name="clientEmail"]')) === "camille@example.com");
  await page.keyboard.press("Escape");
  check("Échap ferme la fenêtre", await page.locator("#ad-create-modal").isHidden());

  /* ---------- Fiche créée à la main, puis effacée ---------- */

  await page.goto(BASE + "/#/clients", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-cl-new");
  await page.click("#ad-cl-new");
  check("le formulaire s'ouvre, curseur sur le nom", await page.evaluate(() => document.activeElement && document.activeElement.name === "name"));
  await page.fill('#ad-cl-create-form [name="name"]', "Nora Benali");
  await page.fill('#ad-cl-create-form [name="email"]', "nora@example.com");
  await page.click('#ad-cl-create-form button[type="submit"]');
  await page.waitForFunction(() => decodeURIComponent(location.hash) === "#/clients/nora@example.com");
  await page.waitForSelector(".ad-cl-head h2");
  check("une fiche créée à la main s'ouvre aussitôt", (await page.textContent(".ad-cl-head h2")) === "Nora Benali");
  check("historique vide : une phrase, pas un trou", /l'historique se remplit/.test(await page.locator(".ad-cl-col").first().innerText()));
  const duplicate = await client.request("POST", "/api/admin/clients", { create: true, name: "Nora", email: "NORA@example.com" }).catch((err) => err);
  check("pas deux fiches pour la même adresse", duplicate.status === 409);

  await page.goto(BASE + "/#/clients/camille%40example.com", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-cl-erase", { state: "attached" });
  await page.click(".ad-danger-zone summary");
  await page.click("#ad-cl-erase");
  await page.waitForSelector("#ad-confirm-modal:not([hidden])");
  await page.click("#ad-confirm-ok");
  await page.waitForFunction(() => document.querySelector("#ad-cl-notes") && document.querySelector("#ad-cl-notes").value === "" && !document.querySelector(".ad-cl-dateitem"));
  detail = await client.request("GET", "/api/admin/clients/detail?email=camille%40example.com");
  check("effacer retire notes et dates, garde l'historique", detail.client.notes === "" && detail.dates.length === 0 && detail.history.length === 3);

  /* ---------- Téléphone : rien ne déborde ---------- */

  await page.setViewportSize({ width: 390, height: 844 });
  for (const hash of ["#/clients", "#/clients/camille%40example.com"]) {
    await page.goto(BASE + "/" + hash, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(hash === "#/clients" ? "#ad-cl-rows" : ".ad-cl-head h2");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`390 px, ${hash} : pas de défilement horizontal`, overflow <= 0, `${overflow}px`);
  }

  /* ---------- Cloisonnement et formules ---------- */

  const free = await freeClient.request("GET", "/api/admin/clients");
  check("formule Découverte : les fiches clients sont incluses", Array.isArray(free.clients) && free.clients.length === 0);
  const foreign = await freeClient.request("GET", "/api/admin/clients/detail?email=camille%40example.com").catch((err) => err);
  check("un autre photographe ne voit pas la fiche", foreign.status === 404);

  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} catch (err) {
  check("déroulé sans exception", false, err.stack || String(err));
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} vérifications réussies`);
process.exit(failed.length ? 1 : 0);
