// Espace photographe en anglais (parcours de base), dans un vrai navigateur,
// contre admin-server.mjs et un Worker local : inscription depuis la page
// anglaise (?lang=en), onglets traduits sans reste de français, création
// d'une galerie (client en anglais par défaut), erreurs du serveur
// traduites, bandeau sur les onglets pas encore traduits, bascule de langue
// dans Paramètres. SHOTS=<dossier> enregistre des captures.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/dashboard-english.test.mjs

import { chromium } from "playwright";
import { join } from "node:path";
import { setTestPlan } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const SHOTS = process.env.SHOTS || "";

// Inscription : premier écran sur la galerie de démonstration (voir
// demo.test.mjs). On la retire pour que la suite parte d'un compte vide.
async function dropDemo(page) {
  await page.waitForSelector("#ad-demo", { timeout: 15000 });
  const demoSlug = await page.evaluate(() => decodeURIComponent(location.hash.slice(4)));
  await page.evaluate(async (s) => fetch(`/local/galleries/${encodeURIComponent(s)}`, { method: "DELETE" }), demoSlug);
  await page.click("#ad-tab-galleries");
  return demoSlug;
}

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

// Mots qui trahissent un reste de français dans une vue censée être en
// anglais. « Giclée » est un mot anglais emprunté ; « Français » est le nom
// de l'option de langue ; Léa & Tom, les prénoms des aperçus de style.
const FRENCH = /\b(votre|vos|les|des|avec|pour|une|sont|Enregistrer|Supprimer|Créer|Galeries?|Paramètres|Abonnement|Facturation|Boutique|Ajouter|Modifier|Aucune?)\b|[àâéèêçùô«»]/;
function frenchLeftovers(text) {
  return text.replace(/gicl[ée]e|Français|Léa/gi, "").split("\n").filter((line) => FRENCH.test(line)).slice(0, 6);
}

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
async function shot(name) {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, name + ".png"), fullPage: true });
}

/* ---------- Écran de connexion : français par défaut, anglais au choix ---------- */

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-login-form", { timeout: 10000 });
check("sans choix, l'écran de connexion reste en français (même navigateur en anglais)",
      (await page.textContent("#ad-login-card")).includes("Se connecter"));
await page.click("#ad-lang-switch");
check("le bouton English traduit l'écran de connexion",
      (await page.textContent("#ad-login-card")).includes("Sign in") && await page.getAttribute("html", "lang") === "en");
await page.click("#ad-lang-switch");
check("…et Français le remet en français", (await page.textContent("#ad-login-card")).includes("Se connecter"));

/* ---------- Inscription depuis la page anglaise ---------- */

const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const email = `dashboard-en-${RUN}@test.invalid`;
await page.goto("about:blank");
await page.goto(`${BASE}/#/inscription?lang=en`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-signup-card", { state: "visible", timeout: 10000 });
const signupText = await page.textContent("#ad-signup-card");
check("lien de la page anglaise : inscription en anglais", signupText.includes("Create my account") && frenchLeftovers(await page.innerText("#ad-signup-card")).length === 0,
      frenchLeftovers(await page.innerText("#ad-signup-card")).join(" | "));
await shot("01-signup");
await page.fill('#ad-signup-form [name="firstName"]', "Ava");
await page.fill('#ad-signup-form [name="lastName"]', "Stone");
await page.fill('#ad-signup-form [name="studioName"]', "Northlight Studio");
await page.fill('#ad-signup-form [name="email"]', email);
await page.fill('#ad-signup-form [name="password"]', "dashboard-english-1234");
await page.check('#ad-signup-form [name="acceptTerms"]');
await page.click("#ad-signup-submit");
await page.waitForSelector("#ad-demo", { timeout: 15000 });
check("démo en anglais dès l'inscription", (await page.textContent("#ad-demo")).includes("This is exactly what your client experiences") &&
      frenchLeftovers(await page.innerText("#ad-demo")).length === 0, frenchLeftovers(await page.innerText("#ad-demo")).join(" | "));
await shot("00-demo");
await dropDemo(page);
await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });
await setTestPlan(API, email, "pro");
const me = await page.evaluate(async () => (await (await fetch("/local/auth/me")).json()).photographer);
check("le compte naît en anglais", me.uiLanguage === "en", me.uiLanguage);

/* ---------- Onglets traduits ---------- */

const TRANSLATED = [
  ["galleries", "Galleries"],
  ["planning", "Planning"],
  ["billing", "Billing"],
  ["shop", "Shop"],
  ["subscription", "Subscription"],
  ["settings", "Settings"],
];
for (const [tab, label] of TRANSLATED) {
  await page.click(`#ad-tab-${tab}`);
  await page.waitForTimeout(700);
  const tabLabel = (await page.innerText(`#ad-tab-${tab}`)).trim();
  const leftovers = frenchLeftovers(await page.innerText("#ad-view"));
  check(`onglet ${label} : en anglais, sans reste de français, sans bandeau`,
        tabLabel.includes(label) && leftovers.length === 0 && await page.getAttribute("#ad-view", "data-untranslated") === null,
        tabLabel + (leftovers.length ? " · " + leftovers.join(" | ") : ""));
  await shot(`02-${tab}`);
}

await page.click("#ad-tab-booking");
await page.waitForTimeout(700);
check("onglet pas encore traduit : bandeau en anglais",
      /still in French/.test(await page.getAttribute("#ad-view", "data-untranslated") || ""));
await shot("03-booking-banner");

/* ---------- Création d'une galerie ---------- */

await page.click("#ad-tab-galleries");
await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });
await page.click("#ad-new-gallery");
await page.waitForSelector("#ad-create-modal:not([hidden])", { timeout: 5000 });
check("nouvelle galerie : langue du client en anglais par défaut",
      await page.inputValue('#ad-create-form [name="language"]') === "en");
check("formulaire de création en anglais",
      frenchLeftovers(await page.innerText("#ad-create-modal")).length === 0, frenchLeftovers(await page.innerText("#ad-create-modal")).join(" | "));
await shot("04-create");
const slug = `en-dash-${RUN}`;
await page.fill('#ad-create-form [name="title"]', "Harper wedding");
await page.fill('#ad-create-form [name="clientName"]', "Harper");
await page.fill('#ad-create-form [name="slug"]', slug);
await page.click("#ad-create-submit");
await page.waitForSelector("#ad-created-modal:not([hidden])", { timeout: 10000 });
check("galerie créée : fenêtre de partage en anglais",
      frenchLeftovers(await page.innerText("#ad-created-modal")).length === 0, frenchLeftovers(await page.innerText("#ad-created-modal")).join(" | "));
await page.click('#ad-created-modal [data-close-modal]');
await page.waitForSelector("#ad-dropzone", { timeout: 10000 });
await page.waitForTimeout(500);
const detailLeftovers = frenchLeftovers(await page.innerText("#ad-view"));
check("fiche de la galerie en anglais", detailLeftovers.length === 0, detailLeftovers.join(" | "));
await shot("05-detail");

/* ---------- Bascule de langue dans Paramètres ---------- */

await page.click("#ad-tab-settings");
await page.waitForSelector("#ad-ui-language", { timeout: 10000 });
check("Paramètres : la langue de l'espace est proposée, sur English", await page.inputValue("#ad-ui-language") === "en");

// Erreur du serveur (rédigée en français) : traduite à l'affichage.
await page.fill('#ad-password-change-form [name="currentPassword"]', "wrong-password-123");
await page.fill('#ad-password-change-form [name="newPassword"]', "whatever-password-1234");
await page.click("#ad-password-change-save");
await page.waitForSelector("#ad-password-change-error:not([hidden])", { timeout: 10000 });
check("erreur du serveur en anglais (mot de passe actuel incorrect)",
      (await page.textContent("#ad-password-change-error")).trim() === "Current password is incorrect", await page.textContent("#ad-password-change-error"));
await page.selectOption("#ad-ui-language", "fr");
await page.waitForFunction(() => document.documentElement.lang === "fr", null, { timeout: 10000 });
await page.waitForTimeout(500);
const meFr = await page.evaluate(async () => (await (await fetch("/local/auth/me")).json()).photographer);
check("passage en français : menu traduit et choix retenu au compte",
      (await page.innerText("#ad-tab-settings")).includes("Paramètres") && meFr.uiLanguage === "fr", meFr.uiLanguage);
await page.selectOption("#ad-ui-language", "en");
await page.waitForFunction(() => document.documentElement.lang === "en", null, { timeout: 10000 });
check("…et retour à l'anglais", (await page.innerText("#ad-tab-settings")).includes("Settings"));

// Reconnexion dans un autre navigateur : la langue suit le compte.
const fresh = await browser.newPage({ viewport: { width: 390, height: 844 } });
await fresh.goto(BASE, { waitUntil: "domcontentloaded" });
await fresh.waitForSelector("#ad-login-form", { timeout: 10000 });
await fresh.fill('#ad-login-form [name="email"]', email);
await fresh.fill('#ad-login-form [name="password"]', "dashboard-english-1234");
await fresh.click("#ad-login-submit");
await fresh.waitForSelector("#ad-new-gallery", { timeout: 10000 });
check("connexion depuis un autre navigateur : l'espace s'ouvre en anglais",
      await fresh.getAttribute("html", "lang") === "en" && (await fresh.innerText("#ad-view")).includes("Galleries"));
if (SHOTS) await fresh.screenshot({ path: join(SHOTS, "06-mobile.png"), fullPage: true });

check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));

/* ---------- Nettoyage ---------- */

await page.evaluate(async (s) => fetch(`/local/galleries/${s}`, { method: "DELETE" }), slug);
await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
