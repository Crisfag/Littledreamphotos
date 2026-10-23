// Parcours d'inscription de bout en bout, dans un vrai navigateur, contre
// admin-server.mjs et un Worker local : arrivée depuis Google sur une page
// du site (visite comptée une fois par session), source gardée de page en
// page, clic « Créer un compte » compté, écran d'inscription compté, compte
// créé avec sa page et sa source, puis la section « Parcours d'inscription »
// de l'onglet Admin (étapes, sources, pages, période, téléphone).
// SHOTS=<dossier> enregistre des captures.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/funnel.test.mjs

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../lib/client.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const PROD_API = "https://galerie-protegee.littledreamphotos-be.workers.dev";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const SHOTS = process.env.SHOTS || "";
const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web");
// Navigateur ordinaire : le Worker écarte les navigateurs sans écran.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

/* ---------- Site statique (web/), adresses propres comme sur Pages ---------- */

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg" };
const site = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  if (!extname(path)) path += ".html";
  try {
    const body = await readFile(join(WEB, path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const SITE = `http://127.0.0.1:${site.address().port}`;

/* ---------- Propriétaire : lecture du parcours avant / après ---------- */

const OWNER_EMAIL = "fagnantchristine@gmail.com";
const OWNER_PASSWORD = "mot-de-passe-de-la-proprietaire-1234";
await fetch(`${API}/api/auth/signup`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD, studioName: "Holypixx" }),
});
const owner = new WorkerClient({ api: API, email: OWNER_EMAIL, password: OWNER_PASSWORD });
const readFunnel = () => owner.request("GET", "/api/owner/funnel?days=7");
const step = (data, key) => data.steps.find((s) => s.key === key).count;
const row = (list, id) => list.find((r) => r.id === id) || { visits: 0, clicks: 0, signups: 0 };
const before = await readFunnel();

/* ---------- Visite depuis Google, puis une deuxième page ---------- */

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "fr-BE" });
await context.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
// Les pages visent le Worker de production : renvoyées vers le Worker local.
const beacons = [];
await context.route(`${PROD_API}/**`, async (route) => {
  const req = route.request();
  const url = req.url().replace(PROD_API, API);
  if (url.includes("/api/public/funnel")) beacons.push(JSON.parse(req.postData() || "{}"));
  const res = await fetch(url, { method: req.method(), headers: { "content-type": req.headers()["content-type"] || "text/plain", "user-agent": UA }, body: req.method() === "GET" ? undefined : req.postData() });
  await route.fulfill({ status: res.status, headers: { "access-control-allow-origin": "*", "content-type": res.headers.get("content-type") || "application/json" }, body: Buffer.from(await res.arrayBuffer()) });
});
// Le lien « Créer un compte » mène à admin.holypixx.com : on garde l'adresse.
let signupTarget = "";
let adminOpened = false;
await context.route("https://admin.holypixx.com/**", (route) => {
  adminOpened = true;
  return route.fulfill({ status: 200, contentType: "text/html", body: "<p>admin</p>" });
});
const page = await context.newPage();
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
async function waitBeacon(n) {
  for (let i = 0; i < 50 && beacons.length < n; i++) await new Promise((r) => setTimeout(r, 100));
}

await page.goto(`${SITE}/galerie-photo-mariage`, { referer: "https://www.google.com/", waitUntil: "load" });
await waitBeacon(1);
check("arrivée depuis Google sur « Galerie photo de mariage » : une visite envoyée, page et source reconnues",
      beacons.length === 1 && beacons[0].step === "visit" && beacons[0].page === "mariage" && beacons[0].source === "google", JSON.stringify(beacons[0]));
const hrefMariage = await page.getAttribute("[data-signup]", "href");
check("le lien d'inscription emporte la page et la source", /#\/inscription\?from=mariage&src=google$/.test(hrefMariage), hrefMariage);

await page.goto(`${SITE}/contrat-photographe`, { referer: `${SITE}/galerie-photo-mariage`, waitUntil: "load" });
await page.waitForTimeout(500);
check("deuxième page de la même visite : pas de nouvelle visite comptée", beacons.length === 1, beacons.length);
const hrefContrat = await page.getAttribute("[data-signup]", "href");
check("la source Google suit de page en page ; la page devient « contrat »", /from=contrat&src=google$/.test(hrefContrat), hrefContrat);

// La requête vers admin.holypixx.com ne transporte pas le « #… » : on garde le lien cliqué.
signupTarget = hrefContrat;
await page.click("[data-signup]");
await waitBeacon(2);
check("clic « Créer un compte » compté", beacons[1]?.step === "signup_click" && beacons[1]?.page === "contrat", JSON.stringify(beacons[1]));
await page.waitForTimeout(300);
check("le clic ouvre l'espace photographe (admin.holypixx.com)", adminOpened);

/* ---------- Inscription ---------- */

const hash = signupTarget.slice(signupTarget.indexOf("#"));
await page.goto(`${BASE}/${hash}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-signup-card", { state: "visible", timeout: 10000 });
await page.waitForTimeout(800);
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const email = `parcours-${RUN}@test.invalid`;
const password = "parcours-inscription-1234";
await page.fill('#ad-signup-form [name="firstName"]', "Lou");
await page.fill('#ad-signup-form [name="studioName"]', "Studio Parcours");
await page.fill('#ad-signup-form [name="email"]', email);
await page.fill('#ad-signup-form [name="password"]', password);
await page.check('#ad-signup-form [name="acceptTerms"]');
await page.click("#ad-signup-submit");
await page.waitForSelector("#ad-demo", { timeout: 15000 });

const after = await readFunnel();
check("onglet Admin : +1 visiteur, +1 clic, +1 écran d'inscription, +1 compte",
      step(after, "visit") - step(before, "visit") === 1 && step(after, "signup_click") - step(before, "signup_click") === 1 &&
      step(after, "signup_view") - step(before, "signup_view") === 1 && step(after, "signup") - step(before, "signup") === 1,
      ["visit", "signup_click", "signup_view", "signup"].map((k) => `${k} ${step(before, k)}→${step(after, k)}`).join(", "));
check("le compte est rangé sous la source Google et la page « Contrat de photographe »",
      row(after.bySource, "google").signups - row(before.bySource, "google").signups === 1 &&
      row(after.byPage, "contrat").signups - row(before.byPage, "contrat").signups === 1 &&
      row(after.byPage, "contrat").label === "Contrat de photographe");

// Nettoyage du compte de test (avant de passer à la propriétaire).
await page.evaluate(async (pw) => fetch("/local/account/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw, confirm: "SUPPRIMER" }) }), password);

/* ---------- Section « Parcours d'inscription » de l'onglet Admin ---------- */

const admin = await browser.newPage({ viewport: { width: 1280, height: 900 } });
admin.on("pageerror", (err) => exceptions.push(String(err)));
await admin.goto(BASE, { waitUntil: "domcontentloaded" });
await admin.waitForSelector("#ad-login-form", { timeout: 10000 });
await admin.fill('#ad-login-form [name="email"]', OWNER_EMAIL);
await admin.fill('#ad-login-form [name="password"]', OWNER_PASSWORD);
await admin.click("#ad-login-submit");
await admin.waitForSelector("#ad-tab-owner:not([hidden])", { timeout: 10000 });
await admin.click("#ad-tab-owner");
await admin.waitForSelector("#ad-funnel .ad-funnel-step", { timeout: 10000 });
const labels = await admin.$$eval("#ad-funnel .ad-funnel-label", (els) => els.map((e) => e.textContent));
check("8 étapes, de la visite à la formule payante",
      labels.length === 8 && labels[0] === "Visiteurs du site" && labels[3] === "Comptes créés" && labels[6] === "Galerie ouverte par un client", labels.join(" → "));
const sectionText = await admin.innerText("#ad-funnel");
check("tableaux par source et par page, avec Google et la page Contrat",
      sectionText.includes("Par source") && sectionText.includes("Google") && sectionText.includes("Par page du site") && sectionText.includes("Contrat de photographe"));
check("période par défaut : 30 jours", await admin.getAttribute('[data-funnel-days="30"]', "aria-pressed") === "true");
if (SHOTS) await (await admin.$("#ad-funnel")).screenshot({ path: join(SHOTS, "01-parcours.png") });
await admin.click('[data-funnel-days="90"]');
await admin.waitForSelector('[data-funnel-days="90"][aria-pressed="true"]', { timeout: 10000 });
check("changer de période recharge la section (90 jours)", (await admin.innerText("#ad-funnel")).includes("90 derniers jours"));
await admin.click('[data-funnel-days="7"]');
await admin.waitForSelector('[data-funnel-days="7"][aria-pressed="true"]', { timeout: 10000 });
check("…et encore (7 jours)", (await admin.innerText("#ad-funnel")).includes("7 derniers jours"));

await admin.setViewportSize({ width: 390, height: 844 });
await admin.waitForTimeout(400);
const overflow = await admin.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("sur téléphone, la section tient dans la largeur", overflow <= 1, overflow);
if (SHOTS) await (await admin.$("#ad-funnel")).screenshot({ path: join(SHOTS, "02-parcours-mobile.png") });

check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));

await browser.close();
site.close();

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
