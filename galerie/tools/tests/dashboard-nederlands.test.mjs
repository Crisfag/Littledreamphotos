// Espace photographe en néerlandais, dans un vrai navigateur, contre
// admin-server.mjs et un Worker local : sélecteur FR · EN · NL, inscription
// depuis la page néerlandaise (?lang=nl), écrans de la formule gratuite sans
// reste de français ni d'anglais, galerie créée pour un client néerlandophone,
// bandeau « Wil je meer in het Nederlands? » et inscription à la newsletter
// sur les onglets encore en français. SHOTS=<dossier> enregistre des captures.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/dashboard-nederlands.test.mjs

import { chromium } from "playwright";
import { join } from "node:path";
import { localSql } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const SHOTS = process.env.SHOTS || "";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

// Mots qui trahissent un reste de français ou d'anglais dans une vue censée
// être en néerlandais. « Français », « English », « Nederlands » : noms des
// langues ; Léa & Tom, prénoms des aperçus de style ; « giclée » : papier.
const FRENCH = /\b(votre|vos|les|des|avec|pour|une|sont|Enregistrer|Supprimer|Créer|Galeries?|Paramètres|Facturation|Boutique|Ajouter|Modifier|Aucune?)\b|[àâçù«»]/;
const ENGLISH = /\b(the|your|you|with|and|Save|Delete|Create|Add|Edit|Settings|Galleries|Subscription|Billing|Sign out|Shop)\b/;
function leftovers(text) {
  // « Settings → Integrations → API » : menus du site de Prodigi, en anglais.
  return text.replace(/gicl[ée]e|Français|English|Léa|Settings → Integrations/gi, "").split("\n").filter((line) => FRENCH.test(line) || ENGLISH.test(line)).slice(0, 6);
}

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "nl-BE", serviceWorkers: "block" });
const page = await context.newPage();
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
async function shot(name) {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, name + ".png"), fullPage: true });
}

/* ---------- Sélecteur de langue de l'écran de connexion ---------- */

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-login-form", { timeout: 10000 });
check("sans choix : français, FR enfoncé (même navigateur en néerlandais)",
      (await page.textContent("#ad-login-card")).includes("Se connecter") &&
      await page.getAttribute('#ad-lang-switch [data-lang="fr"]', "aria-pressed") === "true");
await page.click('#ad-lang-switch [data-lang="nl"]');
const loginNl = await page.innerText("#ad-login-card");
check("NL traduit l'écran de connexion, sans reste", await page.getAttribute("html", "lang") === "nl" && leftovers(loginNl).length === 0 &&
      await page.getAttribute('#ad-lang-switch [data-lang="nl"]', "aria-pressed") === "true", leftovers(loginNl).join(" | "));
await shot("nl-01-login");
await page.click('#ad-lang-switch [data-lang="en"]');
check("EN puis FR : retour à l'anglais puis au français", (await page.textContent("#ad-login-card")).includes("Sign in"));
await page.click('#ad-lang-switch [data-lang="fr"]');
check("…et au français", (await page.textContent("#ad-login-card")).includes("Se connecter"));

/* ---------- Inscription depuis la page néerlandaise ---------- */

const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const email = `dashboard-nl-${RUN}@test.invalid`;
await page.goto("about:blank");
await page.goto(`${BASE}/#/inscription?lang=nl`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-signup-card", { state: "visible", timeout: 10000 });
const signupText = await page.innerText("#ad-signup-card");
check("lien de la page néerlandaise : inscription en néerlandais", leftovers(signupText).length === 0, leftovers(signupText).join(" | "));
await shot("nl-02-signup");
await page.fill('#ad-signup-form [name="firstName"]', "Lien");
await page.fill('#ad-signup-form [name="lastName"]', "Peeters");
await page.fill('#ad-signup-form [name="studioName"]', "Studio Lichtpunt");
await page.fill('#ad-signup-form [name="email"]', email);
await page.fill('#ad-signup-form [name="password"]', "dashboard-nederlands-1234");
await page.check('#ad-signup-form [name="acceptTerms"]');
await page.click("#ad-signup-submit");
await page.waitForSelector("#ad-demo", { timeout: 15000 });
const demoText = await page.innerText("#ad-demo");
check("démo en néerlandais dès l'inscription", leftovers(demoText).length === 0, leftovers(demoText).join(" | "));
await shot("nl-03-demo");
const demoSlug = await page.evaluate(() => decodeURIComponent(location.hash.slice(4)));
await page.evaluate(async (s) => fetch(`/local/galleries/${encodeURIComponent(s)}`, { method: "DELETE" }), demoSlug);
await page.click("#ad-tab-galleries");
await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });
const me = await page.evaluate(async () => (await (await fetch("/local/auth/me")).json()).photographer);
check("le compte naît en néerlandais", me.uiLanguage === "nl", me.uiLanguage);

/* ---------- Écrans de la formule gratuite ---------- */

const TABS = ["galleries", "subscription", "settings", "planning", "billing", "shop"];
for (const tab of TABS) {
  await page.click(`#ad-tab-${tab}`);
  await page.waitForTimeout(800);
  const view = await page.innerText("#ad-view");
  const left = leftovers(view);
  check(`onglet ${tab} : en néerlandais, sans bandeau`, left.length === 0 && !(await page.$("#ad-nl-news")),
        (await page.innerText(`#ad-tab-${tab}`)).trim().replace(/\s+/g, " ") + (left.length ? " · " + left.join(" | ") : ""));
  await shot(`nl-04-${tab}`);
}
const nav = await page.innerText(".ad-tabs");
check("menu latéral en néerlandais (Galerijen, Instellingen, Abonnement)", /Galerijen/.test(nav) && /Instellingen/.test(nav) && /Abonnement/.test(nav));

/* ---------- Galerie pour un client néerlandophone ---------- */

await page.click("#ad-tab-galleries");
await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });
await page.click("#ad-new-gallery");
await page.waitForSelector("#ad-create-modal:not([hidden])", { timeout: 5000 });
check("nouvelle galerie : langue du client en néerlandais par défaut", await page.inputValue('#ad-create-form [name="language"]') === "nl");
const createText = await page.innerText("#ad-create-modal");
check("formulaire de création en néerlandais", leftovers(createText).length === 0, leftovers(createText).join(" | "));
await shot("nl-05-create");
const slug = `nl-dash-${RUN}`;
await page.fill('#ad-create-form [name="title"]', "Huwelijk Janssens");
await page.fill('#ad-create-form [name="clientName"]', "Sofie");
await page.fill('#ad-create-form [name="slug"]', slug);
await page.click("#ad-create-submit");
await page.waitForSelector("#ad-created-modal:not([hidden])", { timeout: 10000 });
await page.click('#ad-created-modal [data-close-modal]');
await page.waitForSelector("#ad-dropzone", { timeout: 10000 });
await page.waitForTimeout(500);
const detail = await page.innerText("#ad-view");
check("fiche de la galerie en néerlandais", leftovers(detail).length === 0, leftovers(detail).join(" | "));
const stored = await page.evaluate(async (s) => (await (await fetch(`/local/galleries/${s}`)).json()), slug);
check("galerie enregistrée en néerlandais pour le client", stored.gallery.presentation.language === "nl", stored.gallery.presentation.language);
await shot("nl-06-detail");

/* ---------- Onglet encore en français : bandeau et newsletter ---------- */

await page.evaluate(() => localStorage.removeItem("holypixx-nl-news"));
await page.click("#ad-tab-booking");
await page.waitForSelector("#ad-nl-news", { timeout: 10000 });
await page.waitForTimeout(800);
check("onglet Réservations : bandeau néerlandais en tête de page",
      (await page.textContent("#ad-nl-news")).includes("Wil je meer in het Nederlands?") &&
      await page.evaluate(() => document.getElementById("ad-view").firstElementChild.id === "ad-nl-news"));
check("e-mail du compte prérempli", await page.inputValue("#ad-nl-news [name=email]") === email);
await shot("nl-07-banner");
await page.click("#ad-nl-news button[type=submit]");
check("sans case cochée : refus, en néerlandais", /Vink het vakje aan/.test(await page.textContent(".ad-nl-news-status")));
await page.check("#ad-nl-news [name=consent]");
await page.click("#ad-nl-news button[type=submit]");
await page.waitForFunction(() => /Bedankt/.test(document.getElementById("ad-nl-news").textContent), null, { timeout: 10000 });
check("inscription : merci en néerlandais", true);
const row = await (async () => {
  // Lecture directe de la base locale (le tableau propriétaire demande OWNER_EMAIL).
  const { execFileSync } = await import("node:child_process");
  const { dirname: d, join: j } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "galerie-protegee", "--local", "--json", "--command",
    `SELECT email, lang, source, consent_at FROM newsletter_subscribers WHERE email = '${email}'`],
  { cwd: j(d(fileURLToPath(import.meta.url)), "..", "..", "worker"), stdio: "pipe" }).toString();
  return JSON.parse(out.slice(out.indexOf("[")))[0].results[0];
})();
check("abonné·e enregistré·e : néerlandais, depuis l'espace, consentement daté", row && row.lang === "nl" && row.source === "admin" && row.consent_at > 0, JSON.stringify(row));
await page.click("#ad-tab-clients");
await page.waitForSelector("#ad-nl-news", { timeout: 10000 });
check("ensuite, le bandeau dit simplement qu'on est sur la liste", /Je staat op de lijst/.test(await page.textContent("#ad-nl-news")));
await page.click("#ad-tab-galleries");
await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });
check("onglet traduit : plus de bandeau", !(await page.$("#ad-nl-news")));

/* ---------- Langue dans Paramètres ---------- */

await page.click("#ad-tab-settings");
await page.waitForSelector("#ad-ui-language", { timeout: 10000 });
check("Paramètres : la langue de l'espace est sur Nederlands", await page.inputValue("#ad-ui-language") === "nl");
await page.fill('#ad-password-change-form [name="currentPassword"]', "wrong-password-123");
await page.fill('#ad-password-change-form [name="newPassword"]', "whatever-password-1234");
await page.click("#ad-password-change-save");
await page.waitForSelector("#ad-password-change-error:not([hidden])", { timeout: 10000 });
const serverError = (await page.textContent("#ad-password-change-error")).trim();
check("erreur du serveur traduite en néerlandais", serverError && leftovers(serverError).length === 0 && serverError !== "Current password is incorrect", serverError);

// Reconnexion depuis un autre navigateur, sur téléphone : la langue suit le compte.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const fresh = await phone.newPage();
fresh.on("pageerror", (err) => exceptions.push(String(err)));
await fresh.goto(BASE, { waitUntil: "domcontentloaded" });
await fresh.waitForSelector("#ad-login-form", { timeout: 10000 });
await fresh.fill('#ad-login-form [name="email"]', email);
await fresh.fill('#ad-login-form [name="password"]', "dashboard-nederlands-1234");
await fresh.click("#ad-login-submit");
await fresh.waitForSelector("#ad-new-gallery", { timeout: 10000 });
check("connexion depuis un autre appareil : l'espace s'ouvre en néerlandais", await fresh.getAttribute("html", "lang") === "nl");
const overflow = await fresh.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("téléphone : pas de débordement horizontal", overflow <= 1, overflow + " px");
if (SHOTS) await fresh.screenshot({ path: join(SHOTS, "nl-08-mobile.png"), fullPage: true });

check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));

/* ---------- Nettoyage ---------- */

await page.evaluate(async (s) => fetch(`/local/galleries/${s}`, { method: "DELETE" }), slug);
await localSql(API, `DELETE FROM newsletter_subscribers WHERE email = '${email}'`).catch(() => {});
await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
