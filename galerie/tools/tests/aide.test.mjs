// Aide de page, dans un vrai navigateur : le petit « i » à côté du titre de
// chaque écran (résumé au survol, volet « Comment ça marche » au clic,
// raccourci vers Lumi), qui pulse à la première visite, sur ordinateur et
// sur téléphone.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/aide.test.mjs

import { chromium, devices } from "playwright";
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

const account = await createTestAccount(API, "aide");
const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const exceptions = [];
const asked = [];

async function preparePage(page) {
  page.on("pageerror", (err) => exceptions.push(String(err)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  // Lumi disponible (réponses simulées) : le raccourci « Demander à Lumi » s'affiche.
  await page.route("**/local/assistant", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true, remaining: 40 } });
    asked.push(JSON.parse(route.request().postData() || "{}"));
    return route.fulfill({ json: { reply: "Voici l'essentiel de cette page.", remaining: 39 } });
  });
}
async function login(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.fill('#ad-login-form [name="email"]', account.email);
  await page.fill('#ad-login-form [name="password"]', account.password);
  await page.click("#ad-login-submit");
  await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });
}

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage();
  await preparePage(page);
  await login(page);

  await page.waitForSelector('.ad-help-btn[data-help="galleries"]', { timeout: 10000 });
  check("Galeries : le « i » à côté du titre, qui pulse à la première visite", await page.isVisible('.ad-help-btn.is-new[data-help="galleries"]'));
  await page.hover(".ad-help-btn");
  await page.waitForTimeout(500);
  const tipText = await page.evaluate(() => {
    const b = document.querySelector(".ad-help-btn");
    const st = getComputedStyle(b, "::after");
    return st.opacity === "1" ? st.content : "";
  });
  check("au survol : le résumé de la page", tipText.includes("Vos galeries clients protégées"), tipText.slice(0, 60));
  check("le titre reste « Vos galeries » (la bulle n'est pas dans son texte)", (await page.textContent(".ad-section-header h2")).trim() === "Vos galeries");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/aide-survol.png`, clip: { x: 220, y: 0, width: 620, height: 260 } });

  await page.click(".ad-help-btn");
  await page.waitForSelector("#ad-help:not([hidden])");
  await page.waitForTimeout(400);
  check("au clic : volet « Comment fonctionne : Galeries », 4 étapes, bon à savoir",
        (await page.textContent("#ad-help-title")) === "Comment fonctionne : Galeries" &&
        (await page.locator("#ad-help-body ol li").count()) === 4 && (await page.locator("#ad-help-body ul li").count()) === 2);
  check("une fois lu, le « i » ne pulse plus", !(await page.locator(".ad-help-btn").getAttribute("class")).includes("is-new"));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/aide-volet.png` });
  await page.keyboard.press("Escape");
  check("Échap ferme le volet", await page.isHidden("#ad-help"));

  // Chaque onglet a son aide.
  const TABS = [
    ["planning", "planning", "Planning"], ["clients", "clients", "Clients"], ["booking", "booking", "Réservations"],
    ["contracts", "contracts", "Devis et contrats"], ["sales", "sales", "Ventes"], ["insights", "insights", "Statistiques"],
    ["billing", "billing", "Facturation"], ["shop", "shop", "Boutique de tirages"], ["portfolio", "portfolio", "Portfolio"],
    ["giftcards", "giftcards", "Bons cadeaux"], ["subscription", "subscription", "Abonnement"], ["settings", "settings", "Paramètres"],
    ["feedback", "feedback", "Suggestions"],
  ];
  const missing = [];
  for (const [tab, key, title] of TABS) {
    await page.click(`#ad-tab-${tab}`);
    const btn = page.locator(`.ad-help-btn[data-help="${key}"]`);
    try {
      await btn.waitFor({ timeout: 10000 });
      await btn.click();
      await page.waitForSelector("#ad-help:not([hidden])", { timeout: 5000 });
      if ((await page.textContent("#ad-help-title")) !== `Comment fonctionne : ${title}`) missing.push(`${key} (titre)`);
      if ((await page.locator("#ad-help-body ol li").count()) < 2) missing.push(`${key} (étapes)`);
      await page.click("#ad-help-close");
    } catch (err) {
      missing.push(key);
    }
  }
  check("chaque onglet a son « i » et son mode d'emploi (13 onglets)", missing.length === 0, missing.join(", ") || "tous");

  // Changer d'écran ferme l'aide de l'écran précédent.
  await page.click("#ad-tab-booking");
  await page.locator('.ad-help-btn[data-help="booking"]').click();
  await page.waitForSelector("#ad-help:not([hidden])");
  await page.click("#ad-tab-clients");
  await page.waitForSelector('.ad-help-btn[data-help="clients"]');
  check("changer d'onglet ferme le volet de l'onglet précédent", await page.isHidden("#ad-help"));

  // Raccourci vers Lumi.
  await page.locator('.ad-help-btn[data-help="clients"]').click();
  await page.waitForSelector("#ad-help-ask:not([hidden])");
  await page.click("#ad-help-ask");
  await page.waitForSelector("#lumi-panel:not([hidden])");
  await page.waitForFunction(() => document.querySelectorAll(".lumi-msg-bot").length >= 1, null, { timeout: 10000 });
  check("« Demander à Lumi » : la question sur la page part à Lumi",
        await page.isHidden("#ad-help") && asked.length === 1 && asked[0].messages[0].content.includes("« Clients »"), asked[0] && asked[0].messages[0].content);
  await page.keyboard.press("Escape");

  // Mémoire des pages déjà lues : au rechargement, plus de pulsation.
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('.ad-help-btn[data-help="galleries"]', { timeout: 10000 });
  check("au rechargement, une page déjà lue ne pulse plus", !(await page.locator(".ad-help-btn").getAttribute("class")).includes("is-new"));

  // Fiche d'une galerie.
  const client = await import("../lib/client.mjs");
  const wc = new client.WorkerClient({ api: API, ...account });
  const slug = `aide-${Date.now().toString(36)}`;
  await wc.request("POST", "/api/admin/galleries", { slug, title: "Séance aide", password: "mot-de-passe-aide" });
  await page.goto(`${BASE}/#/g/${slug}`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('.ad-help-btn[data-help="gallery"]', { timeout: 15000 });
  await page.click('.ad-help-btn[data-help="gallery"]');
  check("page d'une galerie : son propre mode d'emploi", (await page.textContent("#ad-help-title")) === "Comment fonctionne : Une galerie");
  await page.keyboard.press("Escape");

  // Téléphone : volet en bas de l'écran, sans débordement.
  const phoneContext = await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "block" });
  const phone = await phoneContext.newPage();
  await preparePage(phone);
  await login(phone);
  await phone.click('.ad-help-btn[data-help="galleries"]');
  await phone.waitForSelector("#ad-help:not([hidden])");
  await phone.waitForTimeout(500); // fin de l'animation d'ouverture
  const box = await phone.locator("#ad-help").boundingBox();
  const viewport = phone.viewportSize();
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : volet en bas, sur toute la largeur, sans débordement",
        box.width > viewport.width - 24 && Math.abs(box.y + box.height - (viewport.height - 8)) < 4 && overflow <= 0, `${Math.round(box.width)}×${Math.round(box.height)} à y=${Math.round(box.y)}`);
  if (SHOTS) await phone.screenshot({ path: `${SHOTS}/aide-mobile.png` });

  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
