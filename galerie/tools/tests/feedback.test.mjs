// Suggestions et installation sur l'écran d'accueil, dans un vrai
// navigateur : un photographe envoie une demande depuis l'onglet
// Suggestions ; la propriétaire la voit dans l'onglet Admin (pastille),
// change son statut et répond ; le photographe voit la réponse (pastille,
// « Nouvelle réponse »). L'espace photographe est installable : manifeste,
// icônes, service worker, et le bouton « Installer l'appli » sur iPhone.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/feedback.test.mjs

import { chromium, devices } from "playwright";
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

// Compte propriétaire (OWNER_EMAIL de worker/wrangler.toml), créé ou retrouvé
// avec le même mot de passe fixe que les autres suites de tests.
const OWNER_EMAIL = "fagnantchristine@gmail.com";
const OWNER_PASSWORD = "mot-de-passe-de-la-proprietaire-1234";
await fetch(`${API}/api/auth/signup`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD, studioName: "Holypixx" }),
});
const owner = new WorkerClient({ api: API, email: OWNER_EMAIL, password: OWNER_PASSWORD });
const account = await createTestAccount(API, "suggestions");
const client = new WorkerClient({ api: API, ...account });
const TITLE = `Vidéo dans la galerie ${Date.now().toString(36)}`;

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const exceptions = [];

async function login(page, email, password) {
  page.on("pageerror", (err) => exceptions.push(String(err)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-login-form", { timeout: 10000 });
  await page.fill('#ad-login-form [name="email"]', email);
  await page.fill('#ad-login-form [name="password"]', password);
  await page.click("#ad-login-submit");
  await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });
}

try {
  /* ---------- Le photographe envoie une suggestion ---------- */

  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  await login(page, account.email, account.password);
  await page.click("#ad-tab-feedback");
  await page.waitForSelector("#ad-fb-form", { timeout: 10000 });
  check("onglet Suggestions : un formulaire, aucune demande encore", (await page.textContent("#ad-view")).includes("rien envoyé"));
  await page.locator(".ad-bk-pick", { hasText: "Amélioration" }).click();
  await page.fill('#ad-fb-form [name="title"]', TITLE);
  await page.fill('#ad-fb-form [name="body"]', "Pour les mariages : une courte vidéo en tête de galerie.");
  await page.click('#ad-fb-form [type="submit"]');
  await page.waitForSelector(".ad-fb-item", { timeout: 10000 });
  check("la demande apparaît dans « Vos demandes », statut « Reçue »",
        (await page.textContent(".ad-fb-title")) === TITLE && (await page.textContent(".ad-fb-item .ad-badge")) === "Reçue" &&
        (await page.textContent(".ad-fb-kind")).startsWith("Amélioration"));
  const empty = await client.request("POST", "/api/admin/feedback", { title: "  " }).catch((err) => err);
  check("sans titre : refusée (400)", empty.status === 400, empty.message);
  const forbidden = await client.request("GET", "/api/owner/feedback").catch((err) => err);
  check("un photographe ne voit pas les suggestions des autres (403)", forbidden.status === 403, String(forbidden.status));

  /* ---------- La propriétaire la lit et répond ---------- */

  const ownerPage = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  await login(ownerPage, OWNER_EMAIL, OWNER_PASSWORD);
  await ownerPage.waitForSelector("#ad-tab-owner .ad-tab-count", { timeout: 10000 });
  check("pastille sur l'onglet Admin : des suggestions à lire", Number(await ownerPage.textContent("#ad-tab-owner .ad-tab-count")) >= 1);
  await ownerPage.click("#ad-tab-owner");
  await ownerPage.waitForSelector("#ad-fb-owner", { timeout: 20000 });
  const item = ownerPage.locator(".ad-fb-item", { hasText: TITLE });
  check("Admin : la suggestion, avec le studio et son e-mail", (await item.count()) === 1 && (await item.textContent()).includes(account.email));
  if (SHOTS) await ownerPage.locator("#ad-fb-owner").screenshot({ path: `${SHOTS}/suggestions-admin.png` });
  await item.locator('[name="status"]').selectOption("planned");
  await item.locator('[name="reply"]').fill("Merci ! C'est prévu pour janvier.");
  await item.locator('[type="submit"]').click();
  await ownerPage.waitForFunction(() => /Réponse envoyée/.test(document.body.innerText), null, { timeout: 10000 });
  const ownerData = await owner.request("GET", "/api/owner/feedback");
  const saved = ownerData.items.find((i) => i.title === TITLE);
  check("statut « Prévue » et réponse enregistrés", saved && saved.status === "planned" && saved.reply.includes("janvier") && saved.repliedAt > 0, JSON.stringify(saved && { status: saved.status, reply: saved.reply }));

  /* ---------- Le photographe voit la réponse ---------- */

  await page.click("#ad-tab-galleries");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-tab-feedback .ad-tab-count", { timeout: 10000 });
  check("pastille « 1 » sur l'onglet Suggestions", (await page.textContent("#ad-tab-feedback .ad-tab-count")) === "1");
  await page.click("#ad-tab-feedback");
  await page.waitForSelector(".ad-fb-reply", { timeout: 10000 });
  check("la réponse, marquée « Nouvelle réponse », et le statut « Prévue »",
        (await page.textContent(".ad-fb-reply")).includes("prévu pour janvier") && (await page.textContent(".ad-fb-reply")).includes("Nouvelle réponse") &&
        (await page.textContent(".ad-fb-head .ad-badge")) === "Prévue");
  await page.waitForFunction(() => !document.querySelector("#ad-tab-feedback .ad-tab-count"), null, { timeout: 10000 });
  const after = await client.request("GET", "/api/admin/feedback");
  check("une fois l'onglet ouvert, la réponse est lue (plus de pastille)", after.unread === 0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/suggestions-photographe.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : l'onglet tient dans l'écran", overflow <= 0, `${overflow}px`);

  /* ---------- Installation sur l'écran d'accueil ---------- */

  const manifestRes = await fetch(`${BASE}/manifest.webmanifest`);
  const manifest = await manifestRes.json().catch(() => ({}));
  check("manifeste : appli autonome, icônes 192 et 512 (dont masquable)",
        /manifest\+json/.test(manifestRes.headers.get("content-type") || "") && manifest.display === "standalone" && manifest.start_url === "/" &&
        manifest.icons.some((i) => i.sizes === "192x192") && manifest.icons.some((i) => i.purpose === "maskable"), manifestRes.headers.get("content-type"));
  const icon = await fetch(`${BASE}/icon-512.png`);
  const apple = await fetch(`${BASE}/apple-touch-icon.png`);
  check("icônes servies en PNG", icon.headers.get("content-type") === "image/png" && apple.ok);
  check("la page déclare le manifeste et l'icône iPhone",
        (await page.getAttribute('link[rel="manifest"]', "href")) === "/manifest.webmanifest" && (await page.getAttribute('link[rel="apple-touch-icon"]', "href")) === "/apple-touch-icon.png");
  const swReady = await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready.then((r) => Boolean(r.active)),
    new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
  ]));
  check("service worker actif (installable, page « hors connexion »)", swReady === true);
  const offline = await fetch(`${BASE}/offline.html`);
  check("page « hors connexion » disponible", offline.ok && (await offline.text()).includes("Pas de connexion"));

  const iphone = await browser.newContext({ ...devices["iPhone 13"] });
  const phone = await iphone.newPage();
  await login(phone, account.email, account.password);
  check("iPhone : bouton « Installer l'appli »", await phone.isVisible("#ad-install"));
  await phone.click("#ad-install");
  await phone.waitForSelector("#ad-install-modal:not([hidden])", { timeout: 5000 });
  const steps = await phone.textContent("#ad-install-steps");
  check("iPhone : les trois gestes (Partager → Sur l'écran d'accueil → Ajouter)",
        steps.includes("Partager") && steps.includes("Sur l'écran d'accueil") && steps.includes("Ajouter"), steps);
  if (SHOTS) await phone.screenshot({ path: `${SHOTS}/installer-iphone.png` });
  await phone.click("#ad-install-modal [data-close-modal]");
  check("« J'ai compris » ferme la fenêtre", await phone.isHidden("#ad-install-modal"));

  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
