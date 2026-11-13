// Créneau privé, de bout en bout dans un vrai navigateur : le photographe
// ouvre un créneau « privé » (absent du mini-site), copie son lien et
// l'envoie à un client choisi dans ses fiches ; le client ouvre le lien,
// ne voit que ce créneau (même d'une formule retirée du mini-site), ses
// coordonnées pré-remplies, et réserve ; le lien ne sert qu'une fois.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/privateslot.test.mjs

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
const PHOTO = join(REPO_ROOT, "images", "famille", "famille-01.jpeg");
const SITE_PORT = Number(process.env.SITE_PORT || 8000);
const SHOTS = process.env.SCREENSHOT_DIR || "";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}
function dayAhead(days) {
  return new Date(Date.now() + days * 86400000).toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
}
const DAY = dayAhead(15);

const account = await createTestAccount(API, "prive");
const client = new WorkerClient({ api: API, ...account });
const HANDLE = `prive-${Date.now().toString(36)}`;
const CAMILLE = "camille.prive@test.invalid";
await client.request("POST", "/api/admin/clients", { create: true, email: CAMILLE, name: "Camille Dubois" });

// Une formule publique (un créneau visible) et une formule réservée aux
// habitués, retirée du mini-site.
let admin = await client.request("POST", "/api/admin/booking/offers", { title: "Séance découverte", durationMin: 30, priceCents: 6000, depositCents: 0 });
const publicOffer = admin.offers[0];
admin = await client.request("POST", "/api/admin/booking/offers", {
  title: "Séance fidélité", durationMin: 60, priceCents: 0, depositCents: 0,
  tiers: [{ photos: 5, priceCents: 9000 }, { photos: 10, priceCents: 15000 }],
});
const loyalOffer = admin.offers.find((o) => o.title === "Séance fidélité");
await client.request("POST", `/api/admin/booking/offers/${loyalOffer.id}`, { active: false });
admin = await client.request("POST", "/api/admin/booking/slots", { offerId: publicOffer.id, date: DAY, times: ["09:00"] });

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
const context = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
const page = await context.newPage();
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

// Lien local équivalent au lien envoyé (même jeton, site de test).
const localLink = (url) => `http://localhost:${SITE_PORT}/portfolio.html?s=${HANDLE}&creneau=${new URL(url).searchParams.get("creneau")}#reserver`;

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-login-form", { timeout: 10000 });
  await page.fill('#ad-login-form [name="email"]', account.email);
  await page.fill('#ad-login-form [name="password"]', account.password);
  await page.click("#ad-login-submit");
  await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });

  // Mini-site publié : c'est là que le client réserve.
  await page.click("#ad-tab-portfolio");
  await page.waitForSelector("#ad-pf-form", { timeout: 10000 });
  await page.setInputFiles("#ad-pf-files", [PHOTO]);
  await page.waitForFunction(() => document.querySelectorAll(".ad-pf-photo").length === 1, null, { timeout: 60000 });
  await page.fill('#ad-pf-form [name="handle"]', HANDLE);
  await page.check('#ad-pf-form [name="published"]');
  await page.click("#ad-pf-save");
  for (let i = 0; i < 20 && !(await client.request("GET", "/api/admin/portfolio")).published; i++) await page.waitForTimeout(300);

  /* ---------- Le photographe ouvre un créneau privé ---------- */

  await page.click("#ad-tab-booking");
  await page.waitForSelector("#ad-bk-slot-form", { timeout: 10000 });
  await page.selectOption('#ad-bk-slot-form [name="offerId"]', loyalOffer.id);
  await page.fill('#ad-bk-slot-form [name="date"]', DAY);
  await page.fill('#ad-bk-slot-form [name="times"]', "14:00");
  await page.check('#ad-bk-slot-form [name="private"]');
  await page.click('#ad-bk-slot-form button[type="submit"]');
  await page.waitForSelector("#ad-bk-link", { timeout: 10000 });
  const url = await page.inputValue("#ad-bk-link .ad-bk-link-url");
  check("un seul créneau privé ouvert : son lien s'affiche aussitôt", /creneau=[A-Za-z0-9_-]{16,}/.test(url) && url.includes("#reserver"), url);
  check("le créneau privé se distingue (cadenas) dans la liste", (await page.locator(".ad-bk-chip-private").count()) === 1);
  await page.click("#ad-bk-link-copy");
  await page.waitForTimeout(300);
  const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
  check("« Copier le lien » met le lien dans le presse-papiers", copied === url, copied);

  await page.click("#ad-bk-link .ad-cpick-btn");
  await page.waitForSelector("#ad-bk-link [role=option]");
  await page.fill("#ad-bk-link .ad-cpick-search", "camille");
  await page.keyboard.press("Enter");
  check("client choisi dans les fiches", (await page.inputValue('#ad-bk-link [name="email"]')) === CAMILLE);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "prive-admin.png") });
  await page.click('#ad-bk-link [type="submit"]');
  await page.waitForFunction(() => /Lien envoyé/.test(document.body.innerText), null, { timeout: 10000 });
  admin = await client.request("GET", "/api/admin/booking");
  const priv = admin.slots.find((s) => s.private);
  check("le lien part au client ; le créneau garde son nom", priv && priv.privateEmail === CAMILLE && priv.privateName === "Camille Dubois", JSON.stringify(priv));
  check("le nom du client apparaît sur le créneau", (await page.textContent(".ad-bk-chip-private")).includes("Camille Dubois"));

  /* ---------- Mini-site : invisible sans le lien ---------- */

  const visitor = await browser.newPage({ viewport: { width: 390, height: 844 } });
  visitor.on("pageerror", (err) => exceptions.push(String(err)));
  await visitor.goto(`http://localhost:${SITE_PORT}/portfolio.html?s=${HANDLE}`, { waitUntil: "domcontentloaded" });
  await visitor.waitForSelector("#reserver:not([hidden])", { timeout: 15000 });
  check("sans le lien : seule la formule publique, sans le créneau privé",
        (await visitor.locator(".pf-bk-offer").count()) === 1 && (await visitor.locator(".pf-bk-time").count()) === 1 && (await visitor.textContent(".pf-bk-offer strong")) === "Séance découverte");
  const bypass = await fetch(`${API}/api/booking/${HANDLE}/book`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ slotId: priv.id, name: "Intrus", email: "intrus@test.invalid", returnUrl: `http://localhost:${SITE_PORT}/` }),
  });
  check("réserver le créneau privé sans son lien : refusé (404)", bypass.status === 404, String(bypass.status));

  /* ---------- Le client ouvre son lien ---------- */

  await visitor.goto(localLink(priv.privateUrl), { waitUntil: "domcontentloaded" });
  await visitor.waitForSelector("#pf-bk-form:not([hidden])", { timeout: 15000 });
  check("avec le lien : un mot du studio, ce seul créneau, même d'une formule retirée",
        (await visitor.textContent("#pf-bk-private")).includes("a gardé ce créneau pour vous") &&
        (await visitor.locator(".pf-bk-offer").count()) === 1 && (await visitor.textContent(".pf-bk-offer strong")) === "Séance fidélité" &&
        (await visitor.locator(".pf-bk-time").count()) === 1, await visitor.textContent("#pf-bk-private"));
  check("créneau présélectionné, nom et e-mail pré-remplis",
        (await visitor.getAttribute(".pf-bk-time", "aria-pressed")) === "true" &&
        (await visitor.inputValue('#pf-bk-form [name="name"]')) === "Camille Dubois" && (await visitor.inputValue('#pf-bk-form [name="email"]')) === CAMILLE);
  await visitor.locator(".pf-bk-tier").nth(1).click();
  if (SHOTS) await visitor.screenshot({ path: join(SHOTS, "prive-client.png"), fullPage: false });
  await visitor.click("#pf-bk-submit");
  await visitor.waitForSelector("#pf-bk-result:not([hidden])", { timeout: 10000 });
  check("réservation confirmée", (await visitor.textContent("#pf-bk-result h3")) === "Votre séance est réservée", await visitor.textContent("#pf-bk-result"));
  admin = await client.request("GET", "/api/admin/booking");
  const booked = admin.bookings.find((b) => b.slotId === priv.id);
  check("côté photographe : séance confirmée au tarif choisi (10 photos)", booked && booked.status === "confirmed" && booked.photos === 10 && booked.clientEmail === CAMILLE, JSON.stringify(booked));

  await visitor.goto("about:blank");
  await visitor.goto(localLink(priv.privateUrl), { waitUntil: "domcontentloaded" });
  await visitor.waitForSelector("#pf-bk-private.pf-bk-private-error:not([hidden])", { timeout: 15000 });
  check("le lien ne sert qu'une fois : message clair, autres disponibilités proposées",
        (await visitor.textContent("#pf-bk-private")).includes("déjà réservé") && (await visitor.textContent(".pf-bk-offer strong")) === "Séance découverte",
        await visitor.textContent("#pf-bk-private"));

  /* ---------- Rendre privé, nouveau lien, rendre public ---------- */

  await client.request("POST", "/api/admin/booking/slots", { offerId: publicOffer.id, date: DAY, times: ["11:00"] });
  await page.click("#ad-tab-galleries");
  await page.click("#ad-tab-booking");
  await page.waitForSelector("[data-bk-slot-link]", { timeout: 10000 });
  const linkButtons = await page.$$("[data-bk-slot-link]");
  await linkButtons[linkButtons.length - 1].click();
  await page.waitForSelector("#ad-bk-link", { timeout: 10000 });
  const firstUrl = await page.inputValue("#ad-bk-link .ad-bk-link-url");
  check("le bouton lien rend un créneau public privé", (await page.locator(".ad-bk-chip-private").count()) === 1 && /creneau=/.test(firstUrl));
  await page.click("#ad-bk-link-renew");
  await page.click("#ad-confirm-ok").catch(() => {});
  await page.waitForFunction((old) => { const i = document.querySelector("#ad-bk-link .ad-bk-link-url"); return i && i.value !== old; }, firstUrl, { timeout: 10000 });
  const oldLink = await fetch(`${API}/api/booking/${HANDLE}?creneau=${new URL(firstUrl).searchParams.get("creneau")}`).then((r) => r.json());
  check("nouveau lien : l'ancien ne fonctionne plus", Boolean(oldLink.privateError) && !oldLink.private, JSON.stringify(oldLink.privateError));
  await page.click("#ad-bk-link-public");
  await page.click("#ad-confirm-ok").catch(() => {});
  await page.waitForFunction(() => !document.getElementById("ad-bk-link") && !document.querySelector(".ad-bk-chip-private"), null, { timeout: 10000 });
  const pub = await fetch(`${API}/api/booking/${HANDLE}`).then((r) => r.json());
  check("« Rendre public » : le créneau revient sur le mini-site", pub.offers.reduce((n, o) => n + o.slots.length, 0) === 2, JSON.stringify(pub.offers.map((o) => o.slots.length)));

  /* ---------- Réservation retirée du mini-site ---------- */

  await client.request("POST", "/api/admin/booking/page", { enabled: false, onSite: false });
  const hidden = await fetch(`${API}/api/booking/${HANDLE}`);
  await visitor.goto("about:blank");
  await visitor.goto(`http://localhost:${SITE_PORT}/portfolio.html?s=${HANDLE}`, { waitUntil: "domcontentloaded" });
  await visitor.waitForSelector("#pf-page:not([hidden])", { timeout: 15000 });
  await visitor.waitForTimeout(800);
  check("case « Mini-site » décochée : plus de section Réserver (404 côté Worker)",
        hidden.status === 404 && (await visitor.isHidden("#reserver")) && (await visitor.isHidden("#pf-nav-booking")), String(hidden.status));
  await client.request("POST", "/api/admin/booking/page", { enabled: false, onSite: true });
  const back = await fetch(`${API}/api/booking/${HANDLE}`);
  check("recochée : la réservation revient sur le mini-site", back.status === 200);

  /* ---------- Téléphone ---------- */

  await page.setViewportSize({ width: 390, height: 844 });
  const lb = await page.$$("[data-bk-slot-link]");
  await lb[0].click();
  await page.waitForSelector("#ad-bk-link", { timeout: 10000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : le panneau du lien tient dans l'écran", overflow <= 0, `${overflow}px`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "prive-admin-mobile.png") });

  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} finally {
  await browser.close();
  site.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
