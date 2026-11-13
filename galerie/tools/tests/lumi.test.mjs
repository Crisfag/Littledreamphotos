// Lumi, l'assistante, dans un vrai navigateur. Sans clé d'API en local, le
// Worker répond « indisponible » (vérifié), puis les réponses de Lumi sont
// simulées pour tester l'écran : avatar, bulle d'accueil, suggestions,
// réflexion, réponse mise en forme, bouton vers un onglet, conversation
// gardée au rechargement, erreur, téléphone.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/lumi.test.mjs

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

const account = await createTestAccount(API, "lumi");
const client = new WorkerClient({ api: API, ...account });
const status = await client.request("GET", "/api/admin/assistant");
check("sans clé d'API : Lumi indisponible", status.enabled === false, JSON.stringify(status));
const refused = await client.request("POST", "/api/admin/assistant", { messages: [{ role: "user", content: "Bonjour" }] }).catch((err) => err);
check("sans clé d'API : question refusée proprement (503)", refused.status === 503, refused.message);

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const exceptions = [];
let posted = [];
let failNext = false;

async function preparePage(page) {
  page.on("pageerror", (err) => exceptions.push(String(err)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route("**/local/assistant", async (route) => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: { enabled: true, remaining: 40, limit: 40 } });
    const body = JSON.parse(req.postData() || "{}");
    posted.push(body);
    await new Promise((r) => setTimeout(r, 600));
    if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { error: "Lumi est très demandée en ce moment : réessayez dans un instant." } }); }
    return route.fulfill({ json: {
      reply: "Pour ouvrir vos créneaux :\n1. Créez une **formule de séance**.\n2. Choisissez une date ou une période.\n- Astuce : un créneau peut être privé.\n[[reservations]]\n<img src=x onerror=alert(1)>",
      remaining: 8,
    } });
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
  await page.waitForSelector("#lumi-launcher:not([hidden])", { timeout: 10000 });
  check("Lumi apparaît en bas à droite, avec sa bulle « Une question ? »", await page.isVisible("#lumi-launcher .lumi") && await page.isVisible("#lumi-tip"));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/lumi-bouton.png`, clip: { x: 980, y: 760, width: 300, height: 140 } });

  // Les yeux suivent le pointeur.
  await page.mouse.move(100, 100);
  await page.waitForTimeout(150);
  const look = await page.evaluate(() => getComputedStyle(document.querySelector("#lumi-launcher [data-lumi]")).getPropertyValue("--lumi-x"));
  check("ses yeux suivent la souris", parseFloat(look) < 0, look);

  await page.click("#lumi-launcher");
  await page.waitForSelector("#lumi-panel:not([hidden])");
  check("panneau ouvert : grand Lumi, salutation à son nom, 5 suggestions",
        await page.isVisible(".lumi-welcome .lumi-hero svg") && /^Bon(jour|soir) /.test(await page.textContent(".lumi-welcome h3")) &&
        (await page.textContent(".lumi-welcome p")).includes("Je suis Lumi") && (await page.locator(".lumi-suggest button").count()) === 5);
  if (SHOTS) await page.locator("#lumi-panel").screenshot({ path: `${SHOTS}/lumi-accueil.png` });
  check("la bulle d'accueil ne revient plus", await page.isHidden("#lumi-tip"));

  await page.click('.lumi-suggest button:has-text("Comment ouvrir des créneaux")');
  await page.waitForSelector(".lumi-typing");
  check("pendant la réflexion : trois points, Lumi pense (flash)", await page.evaluate(() => document.querySelector("#lumi-panel [data-lumi]").classList.contains("is-thinking")));
  await page.waitForSelector(".lumi-goto", { timeout: 10000 });
  const last = page.locator(".lumi-msg-bot .lumi-bubble").last();
  check("réponse mise en forme : liste numérotée, puce, gras",
        (await last.locator("ol li").count()) === 2 && (await last.locator("ul li").count()) === 1 && (await last.locator("strong").textContent()) === "formule de séance");
  check("le HTML de la réponse est neutralisé", (await last.locator("img").count()) === 0 && (await last.textContent()).includes("<img"));
  check("Lumi sautille de joie en répondant", await page.evaluate(() => document.querySelector("#lumi-panel [data-lumi]").classList.contains("is-happy")));
  check("envoyé au serveur : la question seule", posted.length === 1 && posted[0].messages.length === 1 && posted[0].messages[0].content === "Comment ouvrir des créneaux de réservation ?");
  check("pied : questions restantes aujourd'hui", (await page.textContent("#lumi-foot")).includes("8 questions restantes"));
  if (SHOTS) await page.locator("#lumi-panel").screenshot({ path: `${SHOTS}/lumi-panneau.png` });

  await page.click(".lumi-goto");
  await page.waitForFunction(() => location.hash === "#/reservations", null, { timeout: 10000 });
  check("le bouton « Réservations » ouvre l'onglet", true);

  // Deuxième question au clavier : l'historique part avec.
  await page.fill("#lumi-input", "Et pour un client habitué ?");
  await page.press("#lumi-input", "Enter");
  await page.waitForFunction(() => document.querySelectorAll(".lumi-msg-bot .lumi-goto").length === 2, null, { timeout: 10000 });
  check("Entrée envoie ; l'historique accompagne la question", posted[1].messages.length === 3 && posted[1].messages[1].role === "assistant");

  // Erreur : message clair, la question reste dans le champ.
  failNext = true;
  await page.fill("#lumi-input", "Une question qui échoue");
  await page.click("#lumi-send");
  await page.waitForSelector(".lumi-error");
  check("erreur : message de Lumi, question gardée dans le champ",
        (await page.textContent(".lumi-error")).includes("très demandée") && (await page.inputValue("#lumi-input")) === "Une question qui échoue");

  // Rechargement : la conversation est toujours là.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#lumi-launcher:not([hidden])", { timeout: 10000 });
  check("au rechargement, plus de bulle d'accueil", await page.isHidden("#lumi-tip"));
  await page.click("#lumi-launcher");
  check("conversation gardée au rechargement", (await page.locator(".lumi-msg-me").count()) === 2);
  await page.click("#lumi-reset");
  check("« Nouvelle conversation » repart de zéro", (await page.locator(".lumi-msg-me").count()) === 0 && (await page.locator(".lumi-suggest button").count()) === 5);
  await page.keyboard.press("Escape");
  check("Échap ferme Lumi", await page.isHidden("#lumi-panel"));

  // Téléphone : panneau plein écran, rien ne déborde, l'onglet ouvert ferme Lumi.
  const phoneContext = await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "block" });
  const phone = await phoneContext.newPage();
  await preparePage(phone);
  await login(phone);
  await phone.waitForSelector("#lumi-launcher:not([hidden])", { timeout: 10000 });
  await phone.click("#lumi-launcher");
  await phone.click(".lumi-suggest button >> nth=0");
  await phone.waitForSelector(".lumi-goto", { timeout: 10000 });
  const box = await phone.locator("#lumi-panel").boundingBox();
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : panneau sur tout l'écran, sans débordement", box.width > 360 && box.height > 600 && overflow <= 0, `${Math.round(box.width)}×${Math.round(box.height)}, ${overflow}px`);
  if (SHOTS) await phone.screenshot({ path: `${SHOTS}/lumi-mobile.png` });
  await phone.click(".lumi-goto");
  check("téléphone : ouvrir un onglet referme Lumi", await phone.isHidden("#lumi-panel"));

  // Déconnexion : Lumi disparaît.
  await page.evaluate(() => document.getElementById("ad-logout").click());
  await page.waitForSelector("#ad-login-form", { timeout: 10000 });
  check("déconnexion : Lumi disparaît", await page.isHidden("#lumi-launcher"));
  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
