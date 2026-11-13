// Agenda de réservation, de bout en bout dans un vrai navigateur : le
// photographe ouvre d'un coup une période (du lundi au vendredi, 10 h et
// 14 h) pour deux séances, puis une plage découpée ; le client voit un
// agenda mensuel, clique sur une date et y trouve les deux séances ; une
// réservation retire aussitôt l'autre séance prévue à la même heure ; le
// photographe retire une journée entière.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/agenda.test.mjs

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../lib/client.mjs";
import { createTestAccount } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_DIR = join(REPO_ROOT, "galerie", "web");
const SITE_PORT = Number(process.env.SITE_PORT || 8000);
const SHOTS = process.env.SCREENSHOT_DIR || "";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

// Un lundi dans au moins 10 jours (heure de Bruxelles), et la semaine qui suit.
function brusselsDay(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400000).toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
}
function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
let MONDAY = brusselsDay(10);
while (new Date(MONDAY + "T12:00:00Z").getUTCDay() !== 1) MONDAY = addDays(MONDAY, 1);
const FRIDAY = addDays(MONDAY, 4);
const SUNDAY = addDays(MONDAY, 6);
const NEXT_MONDAY = addDays(MONDAY, 7);

const account = await createTestAccount(API, "agenda");
const client = new WorkerClient({ api: API, ...account });
let admin = await client.request("POST", "/api/admin/booking/offers", { title: "Séance grossesse", durationMin: 60, priceCents: 18000, depositCents: 0 });
admin = await client.request("POST", "/api/admin/booking/offers", { title: "Séance bambin", durationMin: 45, priceCents: 12000, depositCents: 0 });
const grossesse = admin.offers.find((o) => o.title === "Séance grossesse");
const bambin = admin.offers.find((o) => o.title === "Séance bambin");
admin = await client.request("POST", "/api/admin/booking/page", { enabled: true, onSite: true });
const pageUrl = admin.page.url.replace(/^https?:\/\/[^/]+/, `http://localhost:${SITE_PORT}`);

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
await new Promise((resolve, reject) => { site.once("error", reject); site.listen(SITE_PORT, "localhost", resolve); });

const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ["--disable-features=LocalNetworkAccessChecks"],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-login-form", { timeout: 10000 });
  await page.fill('#ad-login-form [name="email"]', account.email);
  await page.fill('#ad-login-form [name="password"]', account.password);
  await page.click("#ad-login-submit");
  await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });

  /* ---------- Photographe : une semaine, deux séances, deux horaires ---------- */

  await page.click("#ad-tab-booking");
  await page.waitForSelector(".ad-bk-offer", { timeout: 10000 });
  await page.locator(".ad-bk-offer", { hasText: "Séance grossesse" }).locator("[data-bk-open-slots]").click();
  await page.waitForSelector("#ad-bk-slot-form");
  const picked = await page.$$eval('#ad-bk-slot-form [name="offerIds"]', (n) => n.filter((i) => i.checked).map((i) => i.value));
  check("« Ouvrir des créneaux » sur une séance : le formulaire la coche, elle seule", picked.length === 1 && picked[0] === grossesse.id, JSON.stringify(picked));
  await page.locator(".ad-bk-pick", { hasText: "Séance bambin" }).click();
  await page.fill('#ad-bk-slot-form [name="date"]', MONDAY);
  await page.fill('#ad-bk-slot-form [name="until"]', SUNDAY);
  await page.locator(".ad-bk-wd", { hasText: "sam" }).click();
  await page.locator(".ad-bk-wd", { hasText: "dim" }).click();
  await page.fill('#ad-bk-slot-form [name="times"]', "10h, 14:00");
  const preview = await page.textContent("#ad-bk-slot-preview");
  check("aperçu avant d'ouvrir : 20 créneaux (5 jours × 4 par jour)", preview.includes("20 créneaux") && preview.includes("5 jours") && preview.includes("4 créneaux par jour"), preview);
  if (SHOTS) await page.locator("#ad-bk-slot-form").screenshot({ path: join(SHOTS, "agenda-formulaire.png") });
  await page.click('#ad-bk-slot-form button[type="submit"]');
  await page.waitForFunction(() => /20 créneaux ouverts/.test(document.body.innerText), null, { timeout: 10000 });
  admin = await client.request("GET", "/api/admin/booking");
  const weekSlots = admin.slots.filter((s) => s.startsAt < Date.parse(NEXT_MONDAY + "T00:00:00Z") / 1000);
  const weekDays = new Set(weekSlots.map((s) => new Date(s.startsAt * 1000).toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" })));
  check("du lundi au vendredi seulement, pour les deux séances", weekSlots.length === 20 && weekDays.size === 5 && !weekDays.has(addDays(MONDAY, 5)), `${weekSlots.length} créneaux, ${[...weekDays].join(",")}`);

  // Plage découpée : 9 h → 11 h, toutes les heures, pour les deux séances.
  await page.click('[data-bk-mode="series"]');
  await page.fill('#ad-bk-slot-form [name="date"]', NEXT_MONDAY);
  await page.fill('#ad-bk-slot-form [name="until"]', "");
  await page.fill('#ad-bk-slot-form [name="from"]', "09:00");
  await page.fill('#ad-bk-slot-form [name="to"]', "11:00");
  await page.fill('#ad-bk-slot-form [name="every"]', "60");
  check("aperçu de la plage : 4 créneaux (2 par séance)", (await page.textContent("#ad-bk-slot-preview")).includes("4 créneaux"), await page.textContent("#ad-bk-slot-preview"));
  await page.click('#ad-bk-slot-form button[type="submit"]');
  await page.waitForFunction(() => /4 créneaux ouverts/.test(document.body.innerText), null, { timeout: 10000 });

  /* ---------- Client : l'agenda ---------- */

  const visitor = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  visitor.on("pageerror", (err) => exceptions.push(String(err)));
  await visitor.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await visitor.goto(pageUrl, { waitUntil: "domcontentloaded" });
  await visitor.waitForSelector(".pf-bk-cal-grid", { timeout: 15000 });
  check("deux séances : aucune présélectionnée, l'agenda les montre toutes", (await visitor.locator('.pf-bk-offer[aria-pressed="true"]').count()) === 0 &&
        await visitor.isVisible("#pf-bk-offers-hint"));
  const openDay = async (key) => {
    for (let i = 0; i < 3 && !(await visitor.locator(`.pf-bk-cal-open[data-date="${key}"]`).count()); i++) await visitor.click(".pf-bk-cal-nav >> nth=1");
    await visitor.click(`.pf-bk-cal-open[data-date="${key}"]`);
  };
  check("le premier jour libre est ouvert d'office", (await visitor.getAttribute(`.pf-bk-cal-open[data-date="${MONDAY}"]`, "aria-pressed")) === "true");
  check("le lundi : 4 créneaux, les deux séances, avec leurs horaires",
        (await visitor.getAttribute(`.pf-bk-cal-open[data-date="${MONDAY}"] .pf-bk-cal-count`, "data-count")) === "4" &&
        (await visitor.locator(".pf-bk-day").count()) === 2 && (await visitor.locator(".pf-bk-time").count()) === 4 &&
        (await visitor.locator(".pf-bk-day-offer strong").allTextContents()).join("|") === "Séance grossesse|Séance bambin",
        (await visitor.locator(".pf-bk-day-offer strong").allTextContents()).join("|"));
  check("samedi et dimanche : pas de créneau (jours non cliquables)",
        (await visitor.locator(`.pf-bk-cal-open[data-date="${addDays(MONDAY, 5)}"]`).count()) === 0);
  await openDay(FRIDAY);
  check("un clic sur le vendredi : ses créneaux", (await visitor.getAttribute(`.pf-bk-cal-open[data-date="${FRIDAY}"]`, "aria-pressed")) === "true" &&
        (await visitor.locator(".pf-bk-time").count()) === 4);
  if (SHOTS) await visitor.screenshot({ path: join(SHOTS, "agenda-client.png"), fullPage: true });

  // Filtre : une seule séance.
  await visitor.locator(".pf-bk-offer", { hasText: "Séance bambin" }).click();
  check("choisir « Séance bambin » filtre l'agenda", (await visitor.locator(".pf-bk-day").count()) === 1 &&
        (await visitor.textContent(".pf-bk-day-offer strong")) === "Séance bambin" && (await visitor.locator(".pf-bk-time").count()) === 2);
  await visitor.locator(".pf-bk-offer", { hasText: "Séance bambin" }).click();
  check("second clic : toutes les séances de nouveau", (await visitor.locator(".pf-bk-day").count()) === 2);

  // Réserver la grossesse du lundi à 10 h.
  await openDay(MONDAY);
  await visitor.locator(".pf-bk-day", { hasText: "Séance grossesse" }).locator(".pf-bk-time", { hasText: "10 h 00" }).click();
  check("le récapitulatif suit la séance et l'heure choisies", (await visitor.textContent("#pf-bk-summary")).includes("Séance grossesse") &&
        (await visitor.textContent("#pf-bk-summary")).includes("10 h 00"), await visitor.textContent("#pf-bk-summary"));
  await visitor.fill('#pf-bk-form [name="name"]', "Emma Lune");
  await visitor.fill('#pf-bk-form [name="email"]', "emma.lune@test.invalid");
  await visitor.click("#pf-bk-submit");
  await visitor.waitForSelector("#pf-bk-result:not([hidden])", { timeout: 10000 });
  check("réservation confirmée", (await visitor.textContent("#pf-bk-result h3")) === "Votre séance est réservée");

  await visitor.goto("about:blank");
  await visitor.goto(pageUrl, { waitUntil: "domcontentloaded" });
  await visitor.waitForSelector(".pf-bk-cal-grid", { timeout: 15000 });
  const mondayTimes = await visitor.locator(".pf-bk-time").allTextContents();
  check("le même horaire de l'autre séance disparaît aussi (10 h 00 pris)", (await visitor.getAttribute(`.pf-bk-cal-open[data-date="${MONDAY}"] .pf-bk-cal-count`, "data-count")) === "2" &&
        !mondayTimes.includes("10 h 00"), mondayTimes.join("|"));
  const atBrussels = (sl) => new Date(sl.startsAt * 1000).toLocaleString("sv-SE", { timeZone: "Europe/Brussels" });
  const sneaky = admin.slots.find((sl) => sl.offerId === bambin.id && atBrussels(sl).startsWith(`${MONDAY} 10:00`));
  const clash = await fetch(`${API}/api/booking/${admin.page.handle}/book?page=1`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ slotId: sneaky.id, name: "Autre", email: "autre@test.invalid", returnUrl: pageUrl }),
  });
  check("réserver quand même l'autre séance à 10 h : refusé (409)", clash.status === 409, String(clash.status));

  /* ---------- Photographe : créneau « pris », journée retirée ---------- */

  await page.click("#ad-tab-galleries");
  await page.click("#ad-tab-booking");
  await page.waitForSelector(".ad-bk-chip-busy", { timeout: 10000 });
  check("côté photographe : l'autre séance de 10 h est marquée « pris »", (await page.locator(".ad-bk-chip-busy").count()) === 1 &&
        (await page.textContent(".ad-bk-chip-busy")).includes("10 h 00"));
  const fridayLabel = new Date(FRIDAY + "T12:00:00Z").toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const fridayBox = page.locator(".ad-bk-day", { hasText: fridayLabel });
  await fridayBox.locator("[data-bk-day-clear]").click();
  await page.click("#ad-confirm-ok");
  await page.waitForFunction(() => /4 créneaux retirés/.test(document.body.innerText), null, { timeout: 10000 });
  admin = await client.request("GET", "/api/admin/booking");
  const fridayLeft = admin.slots.filter((s) => new Date(s.startsAt * 1000).toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" }) === FRIDAY);
  check("« Retirer les 4 créneaux libres » vide le vendredi", fridayLeft.length === 0);

  /* ---------- Téléphone ---------- */

  await visitor.setViewportSize({ width: 390, height: 844 });
  await visitor.goto("about:blank");
  await visitor.goto(pageUrl, { waitUntil: "domcontentloaded" });
  await visitor.waitForSelector(".pf-bk-cal-grid", { timeout: 15000 });
  const overflow = await visitor.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const cell = await visitor.$eval(".pf-bk-cal-open", (n) => n.getBoundingClientRect().width);
  check("téléphone : l'agenda tient dans l'écran, des jours assez grands pour le doigt", overflow <= 0 && cell >= 40, `${overflow}px, case ${Math.round(cell)}px`);
  if (SHOTS) await visitor.screenshot({ path: join(SHOTS, "agenda-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const adminOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : le formulaire des créneaux tient dans l'écran", adminOverflow <= 0, `${adminOverflow}px`);

  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} finally {
  await browser.close();
  site.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
