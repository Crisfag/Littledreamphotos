// Vérification de l'interface client dans un vrai navigateur.
//
// Suppose un serveur d'aperçu déjà lancé :
//   node prepare.mjs --slug essai --dry-run photos/*.jpg
//   node preview-server.mjs --slug essai
//   node tests/viewer.test.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:8787";
// L'API peut être ailleurs que la page : c'est le cas quand le site est servi
// séparément du Worker — ce qui met aussi CORS à l'épreuve.
const API_BASE = process.env.API_BASE || BASE;
const SLUG = process.env.SLUG || "essai";
const PASSWORD = process.env.PASSWORD || "apercu";
const EXPECTED = Number(process.env.PHOTOS || 8);
const SHOTS = process.env.SHOTS || ".";
// Un Chromium déjà présent sur la machine peut être imposé, quand la version
// épinglée par Playwright n'y est pas installée.
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? "  — " + detail : ""}`);
}

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// Exceptions JavaScript réelles. À distinguer des erreurs de console : le test
// provoque volontairement un 401 (mauvais mot de passe), et les polices Google
// peuvent être injoignables selon le réseau — ni l'un ni l'autre n'est un défaut.
const exceptions = [];
const consoleErrors = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
const EXPECTED_CONSOLE = [/401 \(Unauthorized\)/, /fonts\.(googleapis|gstatic)\.com/, /ERR_CONNECTION_RESET/];

await page.goto(`${BASE}/galerie.html?g=${SLUG}`, { waitUntil: "networkidle" });
check("l'écran de mot de passe s'affiche", await page.isVisible("#gp-password"));

// Mauvais mot de passe : message d'erreur, aucune photo.
await page.fill("#gp-password", "pas-le-bon");
await page.click("#gp-submit");
await page.waitForSelector("#gp-error:not([hidden])", { timeout: 5000 });
check("un mauvais mot de passe est refusé", await page.isHidden("#gp-gallery"),
      (await page.textContent("#gp-error")).trim());

// Bon mot de passe : la grille se construit.
await page.fill("#gp-password", PASSWORD);
await page.click("#gp-submit");
await page.waitForSelector("#gp-gallery:not([hidden])", { timeout: 10000 });
const count = await page.locator(".gp-item canvas").count();
check("la grille contient les photos", count === EXPECTED, `${count} vignettes`);

// Les vignettes sont réellement peintes : un canvas vide aurait un écart-type nul.
await page.waitForTimeout(2500);
const spread = await page.evaluate(() => {
  return Array.from(document.querySelectorAll(".gp-item canvas")).map((canvas) => {
    const ctx = canvas.getContext("2d");
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0, sumSq = 0, n = 0;
    for (let i = 0; i < data.length; i += 40) { sum += data[i]; sumSq += data[i] * data[i]; n++; }
    const mean = sum / n;
    return Math.round(Math.sqrt(sumSq / n - mean * mean));
  });
});
check("chaque vignette est peinte", spread.every((s) => s > 8), `écarts-types : ${spread.join(", ")}`);

// Aucune balise <img> ni URL de photo entière dans la page.
const imgCount = await page.locator("#gp-gallery img").count();
check("aucune image n'est exposée comme fichier", imgCount === 0);

await page.screenshot({ path: `${SHOTS}/apercu-grille.png`, fullPage: false });

// Visionneuse plein écran.
await page.locator(".gp-open").first().click();
await page.waitForSelector("#gp-viewer:not([hidden])", { timeout: 5000 });
await page.waitForTimeout(3000);
const full = await page.evaluate(() => {
  const canvas = document.getElementById("gp-viewer-canvas");
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let sum = 0, sumSq = 0, n = 0;
  for (let i = 0; i < data.length; i += 400) { sum += data[i]; sumSq += data[i] * data[i]; n++; }
  const mean = sum / n;
  return { width: canvas.width, height: canvas.height, spread: Math.sqrt(sumSq / n - mean * mean) };
});
check("la photo agrandie est recomposée", full.spread > 8, `${full.width}×${full.height}`);
await page.screenshot({ path: `${SHOTS}/apercu-visionneuse.png` });

// Navigation.
await page.click("#gp-next");
await page.waitForTimeout(1200);
check("la navigation avance", (await page.textContent("#gp-counter")).trim() === `2 / ${EXPECTED}`,
      (await page.textContent("#gp-counter")).trim());
check("le bouton précédent est actif hors première photo", !(await page.isDisabled("#gp-prev")));

// Menu contextuel neutralisé.
const contextBlocked = await page.evaluate(() => {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  document.getElementById("gp-viewer-canvas").dispatchEvent(event);
  return event.defaultPrevented;
});
check("le menu contextuel est neutralisé", contextBlocked);

const copyBlocked = await page.evaluate(() => {
  const event = new Event("copy", { bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event.defaultPrevented;
});
check("la copie est neutralisée", copyBlocked);

// Capture d'écran : voile + trace au journal.
await page.evaluate(() => {
  document.dispatchEvent(new KeyboardEvent("keyup", { key: "PrintScreen", bubbles: true }));
});
await page.waitForSelector("#gp-veil:not([hidden])", { timeout: 3000 });
check("« Impr. écran » déclenche le voile", await page.isVisible("#gp-veil"));

// Le serveur d'aperçu expose ses évènements ; le vrai Worker les met en base,
// et c'est la suite d'API qui le vérifie. On saute donc ici plutôt que d'échouer.
await page.waitForTimeout(600);
const journal = await fetch(`${API_BASE}/__events`).catch(() => null);
if (journal && journal.ok) {
  const { events } = await journal.json();
  check("la tentative est consignée", events.some((e) => e.event === "capture_suspected"),
        events.map((e) => e.event).join(", "));
} else {
  console.log("· la tentative est consignée  — vérifiée par tests/api.test.mjs côté Worker");
}

// Perte de focus.
await page.evaluate(() => window.dispatchEvent(new Event("blur")));
await page.waitForTimeout(200);
check("la perte de focus masque les photos", await page.isVisible("#gp-veil"));

check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

const unexpected = consoleErrors.filter((line) => !EXPECTED_CONSOLE.some((re) => re.test(line)));
check("aucune erreur de console inattendue", unexpected.length === 0, unexpected.join(" | "));

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : "\nToutes les vérifications passent.");
process.exit(failed.length ? 1 : 0);
