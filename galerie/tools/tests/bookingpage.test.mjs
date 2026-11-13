// Page de réservation seule (sans mini-site), dans un vrai navigateur : le
// photographe l'ouvre depuis l'onglet Réservations (lien, QR code, bouton et
// agenda à intégrer), un client réserve dessus, l'agenda fonctionne intégré
// dans le site d'un photographe (reserver-integre.js), un créneau privé y
// mène, et la fermer la rend indisponible.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/bookingpage.test.mjs

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
function dayAhead(days) {
  return new Date(Date.now() + days * 86400000).toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
}
const DAY = dayAhead(12);

const account = await createTestAccount(API, "page-resa");
const client = new WorkerClient({ api: API, ...account });
const HANDLE = `resa-${Date.now().toString(36)}`;

let admin = await client.request("POST", "/api/admin/booking/offers", { title: "Séance famille", durationMin: 60, priceCents: 15000, depositCents: 0, location: "Studio, Liège" });
const offer = admin.offers[0];
await client.request("POST", "/api/admin/booking/slots", { offerId: offer.id, date: DAY, times: ["10:00", "14:00", "16:00"] });

// Site local : les pages Holypixx, et la page d'un site de photographe qui
// intègre l'agenda avec le code fourni.
const TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8" };
let hostHtml = "";
const site = createServer(async (req, res) => {
  const pathname = req.url.split("?")[0];
  if (pathname === "/mon-site.html") {
    res.writeHead(200, { "content-type": TYPES.html });
    res.end(hostHtml);
    return;
  }
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
const local = (url) => url.replace(/^https?:\/\/[^/]+/, `http://localhost:${SITE_PORT}`);

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-login-form", { timeout: 10000 });
  await page.fill('#ad-login-form [name="email"]', account.email);
  await page.fill('#ad-login-form [name="password"]', account.password);
  await page.click("#ad-login-submit");
  await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });

  /* ---------- Onglet Réservations : ouvrir la page ---------- */

  await page.click("#ad-tab-booking");
  await page.waitForSelector("#ad-bk-share-form", { timeout: 10000 });
  check("sans mini-site ni page : un bandeau dit que personne ne peut réserver",
        (await page.locator(".ad-banner").allTextContents()).some((t) => t.includes("ne peuvent pas encore réserver")));
  check("case « Mini-site » grisée tant qu'il n'est pas publié", await page.isDisabled('#ad-bk-share-form [name="onSite"]'));
  const closed = await fetch(`${API}/api/booking/${HANDLE}?page=1`);
  check("page fermée : indisponible (404)", closed.status === 404, String(closed.status));

  await page.check('#ad-bk-share-form [name="enabled"]');
  await page.waitForSelector("#ad-bk-share-url", { timeout: 10000 });
  await page.click("#ad-bk-share-form details summary");
  await page.fill('#ad-bk-share-form [name="handle"]', HANDLE);
  await page.fill('#ad-bk-share-form [name="website"]', "https://www.mon-studio-photo.be");
  await page.fill('#ad-bk-share-form [name="phone"]', "0470 11 22 33");
  await page.click('#ad-bk-share-form details [type="submit"]');
  await page.waitForFunction((h) => (document.getElementById("ad-bk-share-url") || {}).value?.includes("s=" + h), HANDLE, { timeout: 10000 });
  const url = await page.inputValue("#ad-bk-share-url");
  check("lien de la page avec l'identifiant choisi", /reserver\.html\?s=/.test(url) && url.endsWith(HANDLE), url);
  check("QR code affiché", (await page.locator(".ad-bk-qr svg path").count()) === 1);
  const buttonCode = await page.inputValue("#ad-bk-share-button");
  const embedCode = await page.inputValue("#ad-bk-share-embed");
  check("code du bouton : un lien vers la page", buttonCode.includes(`href="${url}"`) && buttonCode.includes("Réserver une séance"), buttonCode);
  check("code de l'agenda intégré : bloc + script", embedCode.includes(`data-holypixx-reservation="${HANDLE}"`) && embedCode.includes("reserver-integre.js"), embedCode);
  await page.click('[data-copy="ad-bk-share-embed"]');
  await page.waitForTimeout(300);
  check("« Copier » met le code dans le presse-papiers", (await page.evaluate(() => navigator.clipboard.readText().catch(() => ""))) === embedCode);
  check("plus de bandeau : la réservation est ouverte",
        !(await page.locator(".ad-banner").allTextContents()).some((t) => t.includes("ne peuvent pas encore réserver")));
  check("« Voir la page de réservation » mène à la page", (await page.getAttribute(".ad-detail-header a.ad-btn", "href")) === url);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "page-resa-admin.png"), fullPage: true });
  const miniSiteApi = await fetch(`${API}/api/booking/${HANDLE}`);
  check("sans mini-site publié, la porte « mini-site » reste fermée (404)", miniSiteApi.status === 404, String(miniSiteApi.status));

  /* ---------- Un client réserve sur la page ---------- */

  const visitor = await browser.newPage({ viewport: { width: 390, height: 844 } });
  visitor.on("pageerror", (err) => exceptions.push(String(err)));
  await visitor.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await visitor.goto(local(url), { waitUntil: "domcontentloaded" });
  await visitor.waitForSelector("#pf-page:not([hidden])", { timeout: 15000 });
  check("en-tête du studio, retour vers son site", (await visitor.textContent("#pf-resa-studio")).includes("Suite de tests") &&
        (await visitor.getAttribute("#pf-resa-website", "href")) === "https://www.mon-studio-photo.be/" || (await visitor.getAttribute("#pf-resa-website", "href")) === "https://www.mon-studio-photo.be",
        await visitor.getAttribute("#pf-resa-website", "href"));
  check("téléphone du studio en pied de page", (await visitor.textContent("#pf-resa-contact")).includes("0470 11 22 33"));
  check("la formule et ses 3 créneaux", (await visitor.locator(".pf-bk-offer").count()) === 1 && (await visitor.locator(".pf-bk-time").count()) === 3);
  await visitor.locator(".pf-bk-time").nth(1).click();
  await visitor.fill('#pf-bk-form [name="name"]', "Léa Martin");
  await visitor.fill('#pf-bk-form [name="email"]', "lea.martin@test.invalid");
  if (SHOTS) await visitor.screenshot({ path: join(SHOTS, "page-resa-client.png"), fullPage: true });
  await visitor.click("#pf-bk-submit");
  await visitor.waitForSelector("#pf-bk-result:not([hidden])", { timeout: 10000 });
  check("réservation confirmée sur la page seule", (await visitor.textContent("#pf-bk-result h3")) === "Votre séance est réservée", await visitor.textContent("#pf-bk-result"));
  admin = await client.request("GET", "/api/admin/booking");
  check("côté photographe : la séance est là", admin.bookings.some((b) => b.clientEmail === "lea.martin@test.invalid" && b.status === "confirmed"));

  /* ---------- Agenda intégré dans le site du photographe ---------- */

  hostHtml = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Mon studio</title></head>
<body style="margin:0;font-family:sans-serif;background:#eef"><header style="padding:20px;background:#223;color:#fff">Mon site à moi</header>
<main style="max-width:900px;margin:0 auto;padding:20px"><h1>Réservez</h1>${embedCode.replace(/https?:\/\/[^/"]+\/reserver-integre\.js/, `http://localhost:${SITE_PORT}/reserver-integre.js`)}</main></body></html>`;
  const host = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  host.on("pageerror", (err) => exceptions.push(String(err)));
  await host.goto(`http://localhost:${SITE_PORT}/mon-site.html`, { waitUntil: "domcontentloaded" });
  await host.waitForSelector("[data-holypixx-reservation] iframe", { timeout: 10000 });
  const frame = host.frameLocator("[data-holypixx-reservation] iframe");
  await frame.locator(".pf-bk-time").first().waitFor({ timeout: 15000 });
  check("intégré : l'agenda s'affiche dans le site hôte, sans en-tête Holypixx",
        (await frame.locator(".pf-bk-time").count()) === 2 && !(await frame.locator(".pf-resa-top").isVisible()));
  await host.waitForFunction(() => parseInt(document.querySelector("[data-holypixx-reservation] iframe").style.height, 10) > 0, null, { timeout: 5000 });
  const h1 = await host.evaluate(() => parseInt(document.querySelector("[data-holypixx-reservation] iframe").style.height, 10));
  await frame.locator(".pf-bk-time").first().click();
  await host.waitForTimeout(800);
  const h2 = await host.evaluate(() => parseInt(document.querySelector("[data-holypixx-reservation] iframe").style.height, 10));
  check("intégré : le cadre suit la hauteur du contenu (formulaire ouvert → plus haut)", h2 > h1, `${h1}px → ${h2}px`);
  const inner = await frame.locator("html").evaluate((n) => n.scrollHeight);
  check("intégré : pas de barre de défilement dans le cadre", Math.abs(inner - h2) <= 4, `${inner} vs ${h2}`);
  if (SHOTS) await host.screenshot({ path: join(SHOTS, "page-resa-integre.png"), fullPage: true });

  /* ---------- Créneau privé : son lien mène à la page ---------- */

  admin = await client.request("GET", "/api/admin/booking");
  const free = admin.slots.find((s) => !s.bookingId);
  admin = await client.request("POST", `/api/admin/booking/slots/${free.id}/private`, { private: true });
  const priv = admin.slots.find((s) => s.id === free.id);
  check("lien privé : sur la page de réservation", /reserver\.html\?s=.*&creneau=/.test(priv.privateUrl), priv.privateUrl);
  await visitor.goto("about:blank");
  await visitor.goto(local(priv.privateUrl), { waitUntil: "domcontentloaded" });
  await visitor.waitForSelector("#pf-bk-form:not([hidden])", { timeout: 15000 });
  check("lien privé : ce seul créneau, présélectionné", (await visitor.locator(".pf-bk-time").count()) === 1 &&
        (await visitor.getAttribute(".pf-bk-time", "aria-pressed")) === "true" && (await visitor.textContent("#pf-bk-private")).includes("gardé ce créneau"));

  /* ---------- Fermer la page ---------- */

  await page.uncheck('#ad-bk-share-form [name="enabled"]');
  await page.waitForFunction(() => !document.getElementById("ad-bk-share-url"), null, { timeout: 10000 });
  await visitor.goto("about:blank");
  await visitor.goto(local(url), { waitUntil: "domcontentloaded" });
  await visitor.waitForSelector("#pf-missing:not([hidden])", { timeout: 15000 });
  check("page fermée : « pas disponible » pour le client", (await visitor.textContent("#pf-missing h1")).includes("n'est pas disponible"));

  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} finally {
  await browser.close();
  site.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
