// Textes d'accompagnement enregistrés, dans un vrai navigateur : le
// photographe écrit son texte dans la galerie A et coche « Enregistrer ce
// texte pour mes prochaines galeries » ; dans la galerie B, il le choisit
// dans le menu — le texte apparaît et s'applique aussitôt. Retrait du menu.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/introtexts.test.mjs

import { chromium } from "playwright";
import { join } from "node:path";
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

const account = await createTestAccount(API, "textes");
const client = new WorkerClient({ api: API, ...account });
const RUN = Date.now().toString(36);
const slugA = `noel-dupont-${RUN}`;
const slugB = `noel-martin-${RUN}`;
await client.createGallery({ slug: slugA, title: "Noël famille Dupont", password: "mot-de-passe-a" });
await client.createGallery({ slug: slugB, title: "Noël famille Martin", password: "mot-de-passe-b" });
const NOEL = "Merci pour cette jolie séance de Noël ! Choisissez vos photos préférées en cliquant sur le cœur.";

const browser = await chromium.launch({ ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
page.on("dialog", (d) => d.accept());
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const intro = async (slug) => (await client.getGallery(slug)).gallery.presentation.intro;
const toastHas = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector(".ad-toast")?.textContent || ""), re.source, { timeout: 15000 });

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.fill('#ad-login-form [name="email"]', account.email);
  await page.fill('#ad-login-form [name="password"]', account.password);
  await page.click("#ad-login-submit");
  await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });

  /* ---------- Galerie A : écrire et garder ---------- */

  await page.goto(`${BASE}/#/g/${slugA}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-presentation-form", { timeout: 10000 });
  check("aucun texte enregistré : pas de menu, juste la case", (await page.locator("#ad-intro-saved").count()) === 0 && await page.isVisible('[name="keepIntro"]'));
  await page.fill('#ad-presentation-form [name="intro"]', NOEL);
  await page.check('[name="keepIntro"]');
  check("la case cochée propose de nommer le texte", await page.isVisible('[name="introLabel"]'));
  await page.fill('[name="introLabel"]', "Noël 2026");
  await page.click('#ad-presentation-form button[type="submit"]');
  await toastHas(/aussi dans votre menu/);
  check("galerie A : texte enregistré sur la galerie", (await intro(slugA)) === NOEL);
  await page.waitForSelector("#ad-intro-saved", { timeout: 10000 });
  check("et le menu « Mes textes enregistrés » apparaît avec « Noël 2026 »", /Noël 2026/.test(await page.textContent("#ad-intro-saved")));

  /* ---------- Galerie B : choisir dans le menu ---------- */

  await page.goto(`${BASE}/#/g/${slugB}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-intro-saved", { timeout: 10000 });
  check("galerie B : texte d'accompagnement vide au départ", (await page.inputValue('#ad-presentation-form [name="intro"]')) === "");
  if (SHOTS) await page.locator("#ad-presentation-form").screenshot({ path: join(SHOTS, "textes-menu.png") });
  const optionId = await page.locator("#ad-intro-saved option", { hasText: "Noël 2026" }).getAttribute("value");
  await page.selectOption("#ad-intro-saved", optionId);
  await toastHas(/Texte « Noël 2026 » appliqué/);
  check("un clic dans le menu : le texte apparaît dans le champ et dans l'aperçu",
        (await page.inputValue('#ad-presentation-form [name="intro"]')) === NOEL && (await page.textContent(".ad-style-sample-body")) === NOEL);
  check("…et il est déjà enregistré sur la galerie B (rien d'autre à cliquer)", (await intro(slugB)) === NOEL);

  /* ---------- Retirer du menu ---------- */

  await page.click("#ad-intro-delete");
  await toastHas(/retiré du menu/);
  check("retiré du menu : le menu disparaît (plus aucun texte)", (await page.locator("#ad-intro-saved").count()) === 0);
  check("les galeries qui l'utilisaient le gardent", (await intro(slugA)) === NOEL && (await intro(slugB)) === NOEL);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : rien ne dépasse", overflow <= 0, `${overflow}px`);
  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} finally {
  await browser.close();
  await client.deleteGallery(slugA).catch(() => {});
  await client.deleteGallery(slugB).catch(() => {});
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
