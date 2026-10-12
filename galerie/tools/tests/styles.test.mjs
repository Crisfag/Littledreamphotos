// Styles de galerie, de bout en bout dans un vrai navigateur : à la
// création, le photographe choisit un style ; dans la galerie, il survole les
// styles (aperçu avec ses photos), en applique un, choisit ses polices, un
// texte d'accompagnement, une photo de couverture puis une vidéo d'en-tête,
// et la mise en page « récit ». Le client voit tout cela sur sa galerie.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/styles.test.mjs

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
const SHOTS = process.env.SHOTS || "";
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_DIR = join(REPO_ROOT, "galerie", "web");
const IMAGES = join(REPO_ROOT, "images");
// Paysages et portraits mélangés, pour la mise en page « récit ».
const PHOTOS = ["cake/cake-01.jpeg", "famille/famille-05.jpeg", "famille/famille-07.jpeg", "cake/cake-02.jpeg", "famille/famille-08.jpeg", "cake/cake-04.jpeg"]
  .map((p) => join(IMAGES, p));
const SITE_PORT = Number(process.env.SITE_PORT || 8000);

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const account = await createTestAccount(API, "styles");
const client = new WorkerClient({ api: API, ...account });
await client.request("POST", "/api/admin/account", { studioName: "Atelier Lumière" }).catch(() => {});

const TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8" };
const site = createServer(async (req, res) => {
  const pathname = req.url.split("?")[0];
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
await new Promise((resolve, reject) => {
  site.once("error", reject);
  site.listen(SITE_PORT, "localhost", resolve);
});

const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ["--disable-features=LocalNetworkAccessChecks"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-login-form", { timeout: 10000 });
  await page.fill('#ad-login-form [name="email"]', account.email);
  await page.fill('#ad-login-form [name="password"]', account.password);
  await page.click("#ad-login-submit");
  await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });

  /* ---------- Style par défaut (Paramètres) ---------- */

  await page.click("#ad-tab-settings");
  await page.waitForSelector("#ad-default-style-cards", { timeout: 10000 });
  await page.click('#ad-default-style-cards [data-style="romantique"]');
  await page.waitForSelector('#ad-default-style-cards [data-style="romantique"][aria-pressed="true"]', { timeout: 10000 });
  const me = await client.request("GET", "/api/auth/me");
  check("le style par défaut se règle dans les paramètres, sans toucher à la mise en page",
        (me.photographer || me).defaultTheme === "romantique" && (me.photographer || me).defaultLayout === "grille", JSON.stringify(me.photographer || me).slice(0, 160));

  /* ---------- Création : le style du compte est proposé, modifiable ---------- */

  await page.click("#ad-tab-galleries");
  await page.click("#ad-new-gallery");
  await page.waitForSelector("#ad-create-modal:not([hidden])");
  check("à la création, le style par défaut du compte est présélectionné",
        (await page.inputValue('#ad-create-form [name="theme"]')) === "romantique" &&
        (await page.locator('#ad-create-form [name="theme"] option').count()) === 9);
  await page.selectOption('#ad-create-form [name="theme"]', "doux");
  await page.fill('#ad-create-form [name="title"]', "Mariage de Léa & Tom");
  await page.fill('#ad-create-form [name="clientName"]', "Léa Martin");
  await page.fill('#ad-create-form [name="slug"]', `lea-tom-${Date.now().toString(36)}`);
  await page.click("#ad-create-submit");
  await page.waitForSelector("#ad-created-modal:not([hidden])", { timeout: 10000 });
  const password = await page.inputValue("#ad-created-password");
  const link = await page.inputValue("#ad-created-link");
  const slug = new URLSearchParams(link.split("?")[1] || "").get("g") || link.split("#").pop();
  await page.click("#ad-created-modal [data-close-modal]");
  await page.waitForSelector("#ad-style-cards", { timeout: 10000 });
  check("la galerie est créée avec le style choisi (Doux)",
        (await page.getAttribute('#ad-style-cards [data-style="doux"]', "aria-pressed")) === "true");
  check("neuf styles sont proposés, chacun avec son aperçu miniature",
        (await page.locator("#ad-style-cards .ad-style-card").count()) === 9 && (await page.locator("#ad-style-cards .ad-style-mini").count()) === 9);

  await page.setInputFiles("#ad-file-input", PHOTOS);
  await page.waitForFunction((n) => document.querySelectorAll("#ad-photos .ad-photo").length === n, PHOTOS.length, { timeout: 120000 });
  await page.waitForTimeout(800);
  // Les photos envoyées : on recharge la fiche pour que l'aperçu les connaisse.
  await page.click("#ad-tab-galleries");
  await page.locator(".ad-card", { hasText: "Mariage de Léa & Tom" }).first().click();
  await page.waitForSelector("#ad-style-cards", { timeout: 10000 });

  /* ---------- Aperçu au survol ---------- */

  await page.hover('#ad-style-cards [data-style="editorial"]');
  await page.waitForSelector("#ad-style-pop:not([hidden])", { timeout: 5000 });
  const pop = await page.evaluate(() => {
    const el = document.getElementById("ad-style-pop");
    const box = el.getBoundingClientRect();
    return {
      title: el.querySelector(".ad-style-pop-title").textContent,
      caption: el.querySelector(".ad-style-pop-cap").textContent,
      photos: el.querySelectorAll(".ad-style-pop-photo").length,
      inside: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
      font: getComputedStyle(el.querySelector(".ad-style-pop-title")).fontFamily,
    };
  });
  check("survoler un style ouvre un aperçu avec le vrai titre et les photos de la galerie",
        pop.title === "Mariage de Léa & Tom" && pop.photos === 6 && pop.inside && /Bodoni/.test(pop.font) && pop.caption.startsWith("Éditorial"), JSON.stringify(pop));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/styles-survol.png` });
  await page.mouse.move(5, 5);
  await page.waitForSelector("#ad-style-pop", { state: "hidden", timeout: 5000 });
  check("l'aperçu se referme en quittant la carte", true);

  await page.click('#ad-style-cards [data-style="editorial"]');
  await page.waitForSelector('#ad-style-cards [data-style="editorial"][aria-pressed="true"]', { timeout: 10000 });
  let detail = await client.request("GET", `/api/admin/galleries/${slug}`);
  check("cliquer applique le style", detail.gallery.presentation.theme === "editorial");

  /* ---------- Polices, texte, couverture, vidéo, mise en page ---------- */

  await page.selectOption("#ad-title-font", "playfair");
  await page.waitForTimeout(400);
  await page.selectOption("#ad-body-font", "lora");
  await page.waitForTimeout(400);
  check("l'échantillon suit les polices choisies",
        /Playfair/.test(await page.evaluate(() => getComputedStyle(document.querySelector(".ad-style-sample-title")).fontFamily)) &&
        /Lora/.test(await page.evaluate(() => getComputedStyle(document.querySelector(".ad-style-sample-body")).fontFamily)));
  await page.fill('#ad-presentation-form [name="intro"]', "Merci pour ce 14 juin inoubliable.\nVoici vos photos, avec tout notre cœur.");
  check("l'échantillon reprend le texte d'accompagnement en direct",
        (await page.textContent(".ad-style-sample-body")).startsWith("Merci pour ce 14 juin"));
  await page.click('#ad-presentation-form [data-header-mode="cover"]');
  await page.click('#ad-presentation-form button[type="submit"]');
  await page.waitForSelector('#ad-presentation-form [data-header-mode="cover"][aria-pressed="true"]', { timeout: 10000 });
  detail = await client.request("GET", `/api/admin/galleries/${slug}`);
  check("polices et texte enregistrés ; sans choix, la couverture est la première photo",
        detail.gallery.presentation.titleFont === "playfair" && detail.gallery.presentation.bodyFont === "lora" &&
        detail.gallery.presentation.intro.startsWith("Merci pour ce 14 juin") && detail.gallery.presentation.coverPhotoId === detail.photos[0].id,
        JSON.stringify(detail.gallery.presentation));
  // L'étoile d'une autre photo la choisit comme couverture.
  const coverTarget = detail.photos[3].id;
  await page.hover(`#ad-photos [data-photo-id="${coverTarget}"]`);
  await page.click(`#ad-photos [data-photo-id="${coverTarget}"] .ad-photo-cover`);
  await page.waitForSelector(`#ad-photos [data-photo-id="${coverTarget}"] .ad-photo-cover-on`, { timeout: 10000 });
  detail = await client.request("GET", `/api/admin/galleries/${slug}`);
  check("l'étoile ★ d'une photo la choisit comme couverture", detail.gallery.presentation.coverPhotoId === coverTarget);

  await page.click('#ad-layout-options [data-layout="recit"]');
  await page.waitForSelector('#ad-layout-options [data-layout="recit"].ad-layout-option-active', { timeout: 10000 });
  check("la mise en page « Récit » est proposée et s'applique", (await client.request("GET", `/api/admin/galleries/${slug}`)).gallery.layout === "recit");

  /* ---------- Côté client : couverture, style, polices, récit ---------- */

  const visitor = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  visitor.on("pageerror", (err) => exceptions.push(String(err)));
  await visitor.goto(`http://localhost:${SITE_PORT}/galerie.html?g=${slug}`, { waitUntil: "domcontentloaded" });
  await visitor.waitForFunction(() => document.body.getAttribute("data-theme") === "editorial", null, { timeout: 10000 });
  check("l'écran de mot de passe prend déjà le style de la galerie", true);
  await visitor.fill("#gp-password", password);
  await visitor.click("#gp-submit");
  await visitor.waitForSelector("#gp-gallery:not([hidden])", { timeout: 15000 });
  const page1 = await visitor.evaluate(() => ({
    theme: document.body.getAttribute("data-theme"),
    titleFont: getComputedStyle(document.getElementById("gp-title")).getPropertyValue("font-family"),
    bodyFont: getComputedStyle(document.body).fontFamily,
    intro: document.getElementById("gp-intro").textContent,
    introHidden: document.getElementById("gp-intro").hidden,
    hero: Boolean(document.querySelector("#gp-hero:not([hidden]) .gp-hero-cover canvas.gp-canvas")),
    imgs: document.querySelectorAll("#gp-gallery img").length,
    plan: [...document.querySelectorAll(".gp-item")].map((f) => (f.className.match(/gp-recit-(wide|pair|solo)/) || [])[1]),
  }));
  check("le client voit le style, les polices et le texte d'accompagnement",
        page1.theme === "editorial" && /Playfair/.test(page1.titleFont) && /Lora/.test(page1.bodyFont) &&
        page1.intro.startsWith("Merci pour ce 14 juin") && !page1.introHidden, JSON.stringify(page1));
  check("la photo de couverture ouvre la galerie, peinte dans un canvas (aucune <img>)", page1.hero && page1.imgs === 0);
  check("récit : paysages en pleine largeur, portraits par deux", page1.plan.join(",") === "wide,pair,pair,wide,pair,pair", page1.plan.join(","));
  // Les grandes photos passent en pleine définition en approchant de l'écran.
  await visitor.evaluate(() => document.querySelector(".gp-recit-wide").scrollIntoView({ block: "center" }));
  await visitor.waitForTimeout(2500);
  const sharp = await visitor.evaluate(() => {
    const hero = document.querySelector(".gp-hero-cover canvas");
    const wide = document.querySelector(".gp-recit-wide canvas");
    return { hero: hero.width, wide: wide ? wide.width : 0 };
  });
  check("couverture et grandes photos du récit en pleine définition (plus de 500 px)", sharp.hero > 1000 && sharp.wide > 1000, JSON.stringify(sharp));
  if (SHOTS) await visitor.screenshot({ path: `${SHOTS}/styles-client-editorial.png` });

  // Vidéo d'en-tête (Vimeo non répertoriée) : elle prend la place de la couverture.
  const bad = await client.request("POST", `/api/admin/galleries/${slug}/presentation`, { headerVideo: "https://example.com/film.mp4" }).catch((err) => err);
  check("un lien vidéo qui n'est ni YouTube ni Vimeo est refusé", bad.status === 400);
  await page.click('#ad-presentation-form [data-header-mode="video"]');
  await page.fill('#ad-presentation-form [name="headerVideo"]', "https://vimeo.com/123456789/abcdef1234");
  await page.click('#ad-presentation-form button[type="submit"]');
  await page.waitForSelector('#ad-presentation-form [data-header-mode="video"][aria-pressed="true"]', { timeout: 10000 });
  check("le lien Vimeo est enregistré et réaffiché tel quel",
        (await page.inputValue('#ad-presentation-form [name="headerVideo"]')) === "https://vimeo.com/123456789/abcdef1234");
  await client.request("POST", `/api/admin/galleries/${slug}/presentation`, { theme: "nuit", titleFont: "", bodyFont: "" });
  await visitor.reload({ waitUntil: "domcontentloaded" });
  await visitor.fill("#gp-password", password);
  await visitor.click("#gp-submit");
  await visitor.waitForSelector("#gp-gallery:not([hidden])", { timeout: 15000 });
  const before = await visitor.evaluate(() => ({
    iframes: document.querySelectorAll("#gp-hero iframe").length,
    poster: Boolean(document.querySelector("#gp-hero .gp-hero-video-poster canvas.gp-canvas")),
    play: Boolean(document.querySelector("#gp-hero .gp-hero-play")),
  }));
  check("vidéo d'en-tête : rien n'est chargé chez Vimeo avant le clic, la couverture sert d'affiche",
        before.iframes === 0 && before.poster && before.play, JSON.stringify(before));
  await visitor.click("#gp-hero .gp-hero-play");
  await visitor.waitForSelector("#gp-hero iframe", { timeout: 5000 });
  const page2 = await visitor.evaluate(() => ({
    src: (document.querySelector("#gp-hero .gp-hero-video iframe") || {}).src || "",
    cover: Boolean(document.querySelector(".gp-hero-cover")),
    bg: getComputedStyle(document.body).backgroundColor,
    ink: getComputedStyle(document.getElementById("gp-title")).color,
    titleFont: getComputedStyle(document.getElementById("gp-title")).fontFamily,
  }));
  check("« Voir le film » charge le lecteur Vimeo (sans suivi) et lance la vidéo",
        page2.src === "https://player.vimeo.com/video/123456789?dnt=1&title=0&byline=0&portrait=0&h=abcdef1234&autoplay=1" && !page2.cover, page2.src);
  check("style Nuit : fond sombre, titre clair, polices du style (Cormorant)",
        page2.bg === "rgb(17, 17, 16)" && page2.ink === "rgb(243, 237, 228)" && /Cormorant/.test(page2.titleFont), JSON.stringify(page2));
  await visitor.locator(".gp-open").first().click();
  await visitor.waitForSelector("#gp-viewer:not([hidden])", { timeout: 5000 });
  check("la visionneuse s'ouvre toujours, quel que soit le style", true);
  await visitor.keyboard.press("Escape");
  if (SHOTS) {
    await visitor.waitForTimeout(800);
    await visitor.screenshot({ path: `${SHOTS}/styles-client-nuit.png` });
  }

  // Police manuscrite (Romantique) : réservée au grand titre.
  await client.request("POST", `/api/admin/galleries/${slug}/presentation`, { theme: "romantique", headerVideo: "" });
  await visitor.reload({ waitUntil: "domcontentloaded" });
  await visitor.fill("#gp-password", password);
  await visitor.click("#gp-submit");
  await visitor.waitForSelector("#gp-gallery:not([hidden])", { timeout: 15000 });
  const page3 = await visitor.evaluate(() => ({
    script: document.body.hasAttribute("data-title-script"),
    title: getComputedStyle(document.getElementById("gp-title")).fontFamily,
    serif: getComputedStyle(document.documentElement).getPropertyValue("--serif"),
  }));
  check("Romantique : titre manuscrit (Great Vibes), petits titres lisibles (Lora)",
        page3.script && /Great Vibes/.test(page3.title) && /Lora/.test(page3.serif), JSON.stringify(page3));

  const unknown = await client.request("POST", `/api/admin/galleries/${slug}/presentation`, { theme: "fluo" }).catch((err) => err);
  const foreign = await client.request("POST", `/api/admin/galleries/${slug}/presentation`, { coverPhotoId: "ph_inconnue" }).catch((err) => err);
  check("style inconnu et photo d'une autre galerie refusés", unknown.status === 400 && foreign.status === 400);

  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} finally {
  await browser.close();
  site.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
