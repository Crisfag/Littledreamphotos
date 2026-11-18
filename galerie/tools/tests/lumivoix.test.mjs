// La voix de Lumi, dans un vrai navigateur avec un faux micro : poser sa
// question à voix haute (enregistrement → transcription → question), entendre
// la réponse (bouche qui bouge), réécouter une réponse, couper la voix. Les
// réponses du serveur (Whisper, MeloTTS, Claude) sont simulées.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/lumivoix.test.mjs

import { chromium } from "playwright";
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

// Une seconde de silence en WAV : la « voix » simulée de Lumi.
function silentWav(seconds = 0.8) {
  const rate = 8000, n = Math.round(rate * seconds), buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  return buf;
}

const account = await createTestAccount(API, "voix");
const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const exceptions = [];
const heard = [];
const spoken = [];
const asked = [];

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block", permissions: ["microphone"] });
  const page = await context.newPage();
  page.on("pageerror", (err) => exceptions.push(String(err)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route("**/local/assistant", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true, voice: true, remaining: 40 } });
    asked.push(JSON.parse(route.request().postData() || "{}"));
    return route.fulfill({ json: { reply: "Bien sûr ! Ouvrez votre galerie et cliquez sur **Envoyer au client par e-mail**.\n[[galeries]]", remaining: 38 } });
  });
  await page.route("**/local/assistant/listen", async (route) => {
    heard.push({ type: route.request().headers()["content-type"], size: (route.request().postDataBuffer() || Buffer.alloc(0)).length });
    return route.fulfill({ json: { text: "Comment j'envoie une galerie à mon client ?" } });
  });
  await page.route("**/local/assistant/speak", async (route) => {
    spoken.push(JSON.parse(route.request().postData() || "{}"));
    return route.fulfill({ status: 200, headers: { "content-type": "audio/wav" }, body: silentWav(1.2) });
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.fill('#ad-login-form [name="email"]', account.email);
  await page.fill('#ad-login-form [name="password"]', account.password);
  await page.click("#ad-login-submit");
  await page.waitForSelector("#lumi-launcher:not([hidden])", { timeout: 15000 });
  await page.click("#lumi-launcher");
  check("voix disponible : bouton micro et bouton « Lumi lit ses réponses »", await page.isVisible("#lumi-mic") && await page.isVisible("#lumi-voice"));
  check("la lecture à voix haute est coupée par défaut", (await page.getAttribute("#lumi-voice", "aria-pressed")) === "false");

  // Question à voix haute.
  await page.click("#lumi-mic");
  await page.waitForFunction(() => document.getElementById("lumi-mic").classList.contains("is-recording"), null, { timeout: 5000 });
  check("pendant l'écoute : micro rouge, « Je vous écoute… », Lumi tend l'oreille",
        (await page.getAttribute("#lumi-input", "placeholder")).startsWith("Je vous écoute") &&
        await page.evaluate(() => document.querySelector("#lumi-panel [data-lumi]").classList.contains("is-listening")));
  if (SHOTS) await page.locator("#lumi-panel").screenshot({ path: `${SHOTS}/voix-ecoute.png` });
  await page.waitForTimeout(1500);
  await page.click("#lumi-mic");
  await page.waitForFunction(() => document.querySelectorAll(".lumi-msg-me").length === 1 && document.querySelector(".lumi-msg-me").textContent.includes("galerie"), null, { timeout: 10000 });
  check("l'enregistrement part à l'écoute (audio réel)", heard.length === 1 && /^audio\//.test(heard[0].type) && heard[0].size > 800, JSON.stringify(heard[0]));
  check("la phrase entendue devient la question", asked.length === 1 && asked[0].messages[0].content === "Comment j'envoie une galerie à mon client ?");

  // Réponse lue à voix haute (question posée à la voix).
  await page.waitForFunction(() => document.querySelector("#lumi-panel [data-lumi]").classList.contains("is-talking"), null, { timeout: 10000 });
  check("réponse lue à voix haute : texte propre envoyé à la voix, Lumi parle (bouche)",
        spoken.length === 1 && spoken[0].text.includes("Envoyer au client") && await page.isVisible(".lumi-msg-bot .lumi-play.is-playing"));
  if (SHOTS) await page.locator("#lumi-panel").screenshot({ path: `${SHOTS}/voix-parle.png` });
  await page.waitForFunction(() => !document.querySelector("#lumi-panel [data-lumi]").classList.contains("is-talking"), null, { timeout: 10000 });
  check("fin de la lecture : la bouche se referme", true);

  // Question écrite : pas de lecture tant que la voix est coupée.
  await page.fill("#lumi-input", "Et pour le mot de passe ?");
  await page.press("#lumi-input", "Enter");
  await page.waitForFunction(() => document.querySelectorAll(".lumi-msg-bot .lumi-play").length === 2, null, { timeout: 10000 });
  await page.waitForTimeout(400);
  check("question écrite, voix coupée : rien n'est lu", spoken.length === 1);

  // « Écouter » sous une réponse.
  await page.locator(".lumi-msg-bot .lumi-play").last().click();
  await page.waitForFunction(() => document.querySelectorAll(".lumi-play.is-playing").length === 1, null, { timeout: 10000 });
  check("« Écouter » lit cette réponse", spoken.length === 2);
  await page.locator(".lumi-play.is-playing").click();
  check("un second clic arrête la lecture", (await page.locator(".lumi-play.is-playing").count()) === 0);

  // Voix activée : les réponses écrites sont lues aussi, et le choix est gardé.
  await page.click("#lumi-voice");
  check("bouton « Lumi lit ses réponses » activé", (await page.getAttribute("#lumi-voice", "aria-pressed")) === "true");
  await page.fill("#lumi-input", "Merci !");
  await page.press("#lumi-input", "Enter");
  await page.waitForFunction((n) => window.__n = document.querySelectorAll(".lumi-msg-bot .lumi-play").length >= 3, null, { timeout: 10000 });
  await page.waitForTimeout(600);
  check("voix activée : la réponse à une question écrite est lue", spoken.length === 3);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#lumi-launcher:not([hidden])", { timeout: 15000 });
  check("le choix de la voix est gardé", (await page.getAttribute("#lumi-voice", "aria-pressed")) === "true");

  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
