// Onglet Planning, dans un vrai navigateur, contre admin-server.mjs et un
// Worker local : agenda (séance réservée, date d'un client, temps fort du
// studio, rendez-vous perso), « À faire » (sélection reçue, séance passée
// sans galerie, client à recontacter, tâche perso), un rappel qui mène à la
// fiche du client, tâches cochées, pastille de l'onglet. Données posées par
// l'API et, pour les réservations, directement en base locale.
// SHOTS=<dossier> enregistre des captures.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/planning.test.mjs

import { chromium } from "playwright";
import { join } from "node:path";
import { WorkerClient } from "../lib/client.mjs";
import { createTestAccount, localSql } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const SHOTS = process.env.SHOTS || "";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const DAY = 86400;
const nowS = Math.floor(Date.now() / 1000);
const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * DAY * 1000).toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
// Anniversaire dans 10 jours (rappel à 30 jours : déjà le moment d'écrire).
const birth = (() => {
  const d = new Date(Date.now() + 10 * DAY * 1000);
  return `${d.getFullYear() - 3}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

/* ---------- Données ---------- */

const account = await createTestAccount(API, "planning");
const client = new WorkerClient({ api: API, ...account });
const { photographer } = await client.me();
const RUN = Date.now().toString(36);

// Séance réservée dans 3 jours (acompte réglé), et une séance d'il y a 2
// jours pour laquelle aucune galerie n'a encore été créée.
const upcomingAt = Math.floor((Date.now() + 3 * DAY * 1000) / 1000 / 3600) * 3600;
const pastAt = nowS - 2 * DAY;
const sql = (id, slot, title, at, name, email, paid) =>
  `INSERT INTO bookings (id, photographer_id, slot_id, offer_id, offer_title, location, starts_at, duration_min, price_cents, deposit_cents, client_name, client_email, client_phone, status, paid_at, created_at)
   VALUES ('${id}', '${photographer.id}', '${slot}', 'bko_test', '${title}', 'Studio, rue de la Station 12', ${at}, 30, 9000, 3000, '${name}', '${email}', '+32 470 12 34 56', 'confirmed', ${paid ? nowS : "NULL"}, ${nowS})`;
await localSql(API, sql(`bkg_up${RUN}`, `bks_up${RUN}`, "Mini-séance de Noël", upcomingAt, "Famille Dupont", `dupont-${RUN}@test.invalid`, true));
await localSql(API, sql(`bkg_past${RUN}`, `bks_past${RUN}`, "Séance nouveau-né", pastAt, "Famille Leroy", `leroy-${RUN}@test.invalid`, true));

// Date à retenir d'une cliente, et un temps fort du studio.
const lea = `martin-${RUN}@test.invalid`;
await client.request("POST", "/api/admin/clients", { email: lea, name: "Famille Martin" });
await client.request("POST", "/api/admin/clients/dates", { email: lea, kind: "birthday", label: "Léa", date: birth, lead: 30 });
await client.request("POST", "/api/admin/clients/dates", { studio: true, label: "noel", date: isoDay(40), lead: 42 });

// Galerie dont le client a validé sa sélection, pas encore livrée.
const slug = `planning-${RUN}`;
await client.createGallery({ slug, title: "Séance famille Bernard", clientName: "Famille Bernard", clientEmail: `bernard-${RUN}@test.invalid`, password: "mot-de-passe-planning" });
await localSql(API, `UPDATE galleries SET selection_done_at = ${nowS - 3600} WHERE slug = '${slug}'`);

/* ---------- Connexion et onglet ---------- */

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
async function shot(name) {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, name + ".png"), fullPage: true });
}

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-login-form", { timeout: 10000 });
await page.fill('#ad-login-form [name="email"]', account.email);
await page.fill('#ad-login-form [name="password"]', account.password);
await page.click("#ad-login-submit");
await page.waitForSelector("#ad-tab-planning", { timeout: 10000 });
await page.waitForSelector("#ad-tab-planning .ad-tab-count", { timeout: 10000 });
check("onglet Planning dans le menu, avec la pastille des choses à faire",
      (await page.textContent("#ad-tab-planning")).includes("Planning") && (await page.textContent("#ad-tab-planning .ad-tab-count")).trim() === "3",
      await page.textContent("#ad-tab-planning .ad-tab-count"));

await page.click("#ad-tab-planning");
await page.waitForSelector(".ad-pl-layout", { timeout: 10000 });
const agenda = await page.textContent(".ad-pl-agenda");
const todo = await page.textContent(".ad-pl-todo");
check("agenda : la séance réservée, avec son client, son lieu et l'acompte réglé",
      agenda.includes("Mini-séance de Noël") && agenda.includes("Famille Dupont") && agenda.includes("rue de la Station") && agenda.includes("Acompte réglé"));
check("agenda : l'anniversaire de la cliente (« Léa aura 3 ans ») et le temps fort du studio",
      agenda.includes("Léa aura 3 ans") && agenda.includes("Séances de Noël"));
check("agenda : la séance passée n'y est plus", !agenda.includes("Séance nouveau-né"));
check("à faire : sélection reçue, séance passée sans galerie, cliente à recontacter",
      todo.includes("Sélection reçue : à retoucher") && todo.includes("Séance famille Bernard") &&
      todo.includes("Séance passée : créer la galerie") && todo.includes("Séance nouveau-né") &&
      todo.includes("Écrire à Famille Martin"));
check("les jours sont regroupés, du plus proche au plus lointain",
      await page.evaluate(() => {
        const items = [...document.querySelectorAll(".ad-pl-agenda .ad-pl-title")].map((n) => n.textContent);
        return items.findIndex((t) => t.includes("Mini-séance")) < items.findIndex((t) => t.includes("Léa")) &&
          items.findIndex((t) => t.includes("Léa")) < items.findIndex((t) => t.includes("Noël") && !t.includes("Mini"));
      }));
await shot("01-planning");

/* ---------- Filtres ---------- */

await page.click('[data-pl-filter="booking"]');
const onlyBookings = await page.textContent(".ad-pl-agenda");
check("filtre Séances : seulement les séances", onlyBookings.includes("Mini-séance de Noël") && !onlyBookings.includes("Léa aura"));
await page.click('[data-pl-filter="reminder"]');
const onlyReminders = await page.textContent(".ad-pl-agenda");
check("filtre Rappels : dates des clients et temps forts", onlyReminders.includes("Léa aura 3 ans") && onlyReminders.includes("Séances de Noël") && !onlyReminders.includes("Mini-séance"));
await page.click('[data-pl-filter="all"]');

/* ---------- Un rappel mène à la fiche du client ---------- */

await page.click('.ad-pl-agenda .ad-pl-reminder .ad-pl-meta');
await page.waitForFunction(() => /^#\/clients\/.+/.test(location.hash), null, { timeout: 5000 });
await page.waitForSelector(".ad-view-client, #ad-view h2", { timeout: 10000 });
check("cliquer sur un rappel ouvre la fiche du client",
      decodeURIComponent(page.url()).includes(lea) && (await page.textContent("#ad-view")).includes("Famille Martin"), page.url());
await page.goBack();
await page.waitForSelector(".ad-pl-layout", { timeout: 10000 });

/* ---------- Tâches ---------- */

// Séance passée : la création de galerie s'ouvre pré-remplie.
await page.click('[data-pl-create]');
await page.waitForSelector("#ad-create-modal:not([hidden])", { timeout: 5000 });
check("« Nouvelle galerie » depuis une séance passée : client déjà renseigné",
      (await page.inputValue('#ad-create-form [name="clientName"]')) === "Famille Leroy" &&
      (await page.inputValue('#ad-create-form [name="clientEmail"]')) === `leroy-${RUN}@test.invalid`);
await page.keyboard.press("Escape");
await page.evaluate(() => document.querySelectorAll(".ad-modal-backdrop").forEach((m) => { m.hidden = true; }));

// Tâche perso sans date, et rendez-vous daté.
await page.click("#ad-pl-add");
await page.fill('#ad-pl-form [name="title"]', "Commander les albums");
await page.click('#ad-pl-form button[type="submit"]');
await page.waitForFunction(() => document.querySelector(".ad-pl-todo")?.textContent.includes("Commander les albums"), null, { timeout: 10000 });
await page.click("#ad-pl-add");
await page.fill('#ad-pl-form [name="title"]', "Repérage au parc");
await page.fill('#ad-pl-form [name="date"]', isoDay(5));
await page.fill('#ad-pl-form [name="time"]', "09:30");
await page.fill('#ad-pl-form [name="clientEmail"]', lea);
await page.click('#ad-pl-form button[type="submit"]');
await page.waitForFunction(() => document.querySelector(".ad-pl-agenda")?.textContent.includes("Repérage au parc"), null, { timeout: 10000 });
const withItem = await page.textContent(".ad-pl-agenda");
check("rendez-vous daté : dans l'agenda, à son heure, rattaché à la fiche",
      withItem.includes("Repérage au parc") && withItem.includes("09:30") && withItem.includes("Famille Martin"));
check("tâche sans date : dans « À faire »", (await page.textContent(".ad-pl-todo")).includes("Commander les albums"));

// Cocher : la sélection disparaît, la tâche perso reste barrée.
await page.check('[data-pl-check^="sel:"]');
await page.waitForFunction(() => !document.querySelector(".ad-pl-todo")?.textContent.includes("Sélection reçue"), null, { timeout: 10000 });
check("sélection marquée faite : retirée de « À faire »", true);
await page.check('.ad-pl-task:has-text("Commander les albums") input[type="checkbox"]');
await page.waitForSelector('.ad-pl-done:has-text("Commander les albums")', { timeout: 10000 });
check("tâche perso cochée : barrée, toujours visible", await page.isVisible('.ad-pl-done:has-text("Commander les albums")'));
const badge = (await page.textContent("#ad-tab-planning .ad-tab-count")).trim();
check("la pastille suit : 2 choses à faire", badge === "2", badge);
await shot("02-planning-done");

// La galerie créée après la séance éteint la tâche d'elle-même.
await client.createGallery({ slug: `${slug}-leroy`, title: "Séance Leroy", clientName: "Famille Leroy", clientEmail: `leroy-${RUN}@test.invalid`, password: "mot-de-passe-planning" });
const fresh = await page.evaluate(async () => (await fetch("/local/planning")).json());
check("galerie créée pour ce client : « créer la galerie » disparaît d'elle-même", !fresh.tasks.some((t) => t.type === "gallery"));

/* ---------- Mobile ---------- */

await page.setViewportSize({ width: 390, height: 844 });
await page.reload();
await page.waitForSelector(".ad-pl-layout", { timeout: 10000 });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("sur téléphone : « À faire » d'abord, sans débordement", overflow <= 1 &&
      await page.evaluate(() => document.querySelector(".ad-pl-todo").getBoundingClientRect().top < document.querySelector(".ad-pl-agenda").getBoundingClientRect().top), overflow);
await shot("03-planning-mobile");

/* ---------- Le Worker refuse le n'importe quoi ---------- */

const bad = await page.evaluate(async () => {
  const post = (path, body) => fetch("/local/planning" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.status);
  return [await post("/items", { title: "" }), await post("/items", { title: "x", date: "demain" }), await post("/items", { title: "x", time: "09:00" }), await post("/done", { key: "nimporte" })];
});
check("refus : libellé vide, date illisible, heure sans date, tâche inconnue", bad.every((s) => s === 400), bad.join(", "));

check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
