// Mini-site portfolio, de bout en bout, contre le vrai Worker local :
// onglet Portfolio de l'admin (photos réduites et sans EXIF, ordre,
// présentation, publication), page publique (couverture, travaux,
// visionneuse, contact), messages reçus, identifiant unique, racine du
// sous-domaine d'un studio Pro, et effacement avec le compte. Autonome.
//
//   npm run dev:local                      (depuis worker/)
//   node admin-server.mjs                  (depuis tools/, GALERIE_API=http://127.0.0.1:8788)
//   node tests/portfolio.test.mjs          (depuis tools/)

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../lib/client.mjs";
import { createTestAccount, setTestPlan } from "./lib/testAccount.mjs";
import { hostFetch } from "./lib/hostFetch.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_DIR = join(REPO_ROOT, "galerie", "web");
const PHOTOS = ["famille-01.jpeg", "famille-02.jpeg", "famille-03.jpeg"].map((f) => join(REPO_ROOT, "images", "famille", f));
const SITE_PORT = Number(process.env.SITE_PORT || 8000); // seule origine locale autorisée par le Worker
const SCREENSHOT = process.env.PORTFOLIO_SCREENSHOT || "";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

/* ---------- Comptes ---------- */

// Formule gratuite : le portfolio est inclus dans toutes les formules.
const account = await createTestAccount(API, "portfolio", { plan: "" });
const client = new WorkerClient({ api: API, ...account });
const rival = new WorkerClient({ api: API, ...(await createTestAccount(API, "portfolio-rival", { plan: "" })) });
const stamp = Date.now().toString(36);
const HANDLE = `studio-${stamp}`;

/* ---------- Site principal local (page publique, relue aussi par le Worker) ---------- */

const TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8" };
const site = createServer(async (req, res) => {
  const pathname = req.url.split("?")[0];
  try {
    let body = await readFile(join(WEB_DIR, pathname));
    const ext = pathname.split(".").pop();
    // Pour le navigateur : la page appelle le Worker local. Le Worker, lui,
    // relit le fichier tel quel et y inscrit l'adresse du studio lui-même.
    if (ext === "html" && req.headers["user-agent"]?.includes("Chrome")) {
      body = body.toString().replace(/api: "[^"]*"/, `api: "${API}"`);
    }
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

/* ---------- Admin : onglet Portfolio ---------- */

const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ["--disable-features=LocalNetworkAccessChecks"],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
page.on("dialog", (dialog) => dialog.accept());

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-login-form", { timeout: 10000 });
await page.fill('#ad-login-form [name="email"]', account.email);
await page.fill('#ad-login-form [name="password"]', account.password);
await page.click("#ad-login-submit");
await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });

await page.click("#ad-tab-portfolio");
await page.waitForSelector("#ad-pf-form", { timeout: 10000 });
check("l'onglet Portfolio ouvre #/portfolio, avec une adresse proposée",
      (await page.evaluate(() => location.hash)) === "#/portfolio" && (await page.inputValue('#ad-pf-form [name="handle"]')).length >= 3,
      await page.inputValue('#ad-pf-form [name="handle"]'));

await page.check('#ad-pf-form [name="published"]');
await page.fill('#ad-pf-form [name="handle"]', HANDLE);
await page.click("#ad-pf-save");
await page.waitForSelector("#ad-pf-error:not([hidden])", { timeout: 5000 });
check("impossible de publier un portfolio sans photo", (await page.textContent("#ad-pf-error")).includes("au moins une photo"));

await page.setInputFiles("#ad-pf-files", PHOTOS);
await page.waitForFunction(() => document.querySelectorAll(".ad-pf-photo").length === 3, null, { timeout: 60000 });
check("trois photos ajoutées, la première marquée comme couverture",
      (await page.textContent("#ad-pf-count")).trim() === "3 / 40" && (await page.locator(".ad-pf-photo").first().locator(".ad-pf-cover").count()) === 1);

let admin = await client.request("GET", "/api/admin/portfolio");
const firstUpload = admin.photos[0];
check("les photos sont réduites à 2000 px au plus grand côté",
      admin.photos.every((p) => Math.max(p.width, p.height) <= 2000), admin.photos.map((p) => `${p.width}×${p.height}`).join(" "));
const stored = Buffer.from(await (await client.getPortfolioPhotoResponse(firstUpload.id)).arrayBuffer());
check("photo stockée en WebP, sans bloc EXIF (ni appareil, ni lieu)",
      stored.subarray(0, 4).toString() === "RIFF" && stored.subarray(8, 12).toString() === "WEBP" && !stored.includes(Buffer.from("EXIF")) && !stored.includes(Buffer.from("Exif")));

await page.locator(".ad-pf-photo").first().locator('[data-move="1"]').click();
await page.waitForFunction((id) => document.querySelectorAll(".ad-pf-photo")[1]?.getAttribute("data-id") === id, firstUpload.id, { timeout: 5000 });
admin = await client.request("GET", "/api/admin/portfolio");
check("l'ordre des photos se change d'un clic et est enregistré", admin.photos[1].id === firstUpload.id);

await page.fill('#ad-pf-form [name="handle"]', HANDLE);
await page.fill('#ad-pf-form [name="headline"]', "Photographe de famille, en lumière naturelle");
await page.fill('#ad-pf-form [name="city"]', "Liège");
await page.fill('#ad-pf-form [name="phone"]', "+32 470 12 34 56");
await page.fill('#ad-pf-form [name="bio"]', "Je photographie les familles chez elles.\n\nSans pose, avec beaucoup de rires.");
await page.fill('#ad-pf-form [name="services"]', "Séances famille\nNouveau-nés\n\nSéances famille");
await page.fill('#ad-pf-form [name="instagram"]', "https://www.instagram.com/studio.test/");
await page.fill('#ad-pf-form [name="website"]', "exemple.be");
await page.check('#ad-pf-form [name="published"]');
await page.click("#ad-pf-save");
await page.waitForSelector("#ad-pf-link", { timeout: 10000 });
admin = await client.request("GET", "/api/admin/portfolio");
check("publié : le lien public s'affiche dans l'admin",
      (await page.getAttribute("#ad-pf-link", "href")).endsWith(`/portfolio.html?s=${HANDLE}`) && admin.published);
check("les champs sont nettoyés (prestations sans doublon, Instagram, site en https)",
      admin.services.join("|") === "Séances famille|Nouveau-nés" && admin.instagram === "studio.test" && admin.website === "https://exemple.be/",
      JSON.stringify([admin.services, admin.instagram, admin.website]));

const taken = await rival.request("PUT", "/api/admin/portfolio", { handle: HANDLE }).catch((err) => err);
check("un autre studio ne peut pas prendre la même adresse", taken.status === 409);

/* ---------- Page publique ---------- */

const visitor = await browser.newPage({ viewport: { width: 1280, height: 900 } });
visitor.on("pageerror", (err) => exceptions.push(String(err)));
await visitor.goto(`http://localhost:${SITE_PORT}/portfolio.html?s=${HANDLE}`, { waitUntil: "domcontentloaded" });
await visitor.waitForSelector("#pf-page:not([hidden])", { timeout: 10000 });
await visitor.waitForFunction(() => document.getElementById("pf-hero-img").complete && document.getElementById("pf-hero-img").naturalWidth > 0, null, { timeout: 10000 });
check("la page publique porte le nom du studio, la ville et l'accroche",
      (await visitor.title()).includes("Photographe à Liège") && (await visitor.textContent("#pf-city")) === "Liège" &&
      (await visitor.textContent("#pf-headline")).includes("lumière naturelle"));
check("la couverture est la première photo, puis les trois photos en grille",
      (await visitor.getAttribute("#pf-hero-img", "src")).endsWith(`/photo/${admin.photos[0].id}`) && (await visitor.locator(".pf-tile").count()) === 3);
check("référencement sur www : adresse de référence du portfolio et données structurées du photographe",
      (await visitor.getAttribute('link[rel="canonical"]', "href")).endsWith(`/portfolio.html?s=${HANDLE}`) &&
      JSON.parse(await visitor.textContent('script[type="application/ld+json"]'))["@type"] === "ProfessionalService");
check("présentation en paragraphes et prestations",
      (await visitor.locator("#pf-bio p").count()) === 2 && (await visitor.locator("#pf-services li").count()) === 2);
const linksText = await visitor.textContent("#pf-links");
check("téléphone, Instagram et site sont affichés",
      linksText.includes("+32 470 12 34 56") && linksText.includes("@studio.test") && linksText.includes("exemple.be") &&
      (await visitor.getAttribute('#pf-links a[href^="tel:"]', "href")) === "tel:+32470123456");
if (SCREENSHOT) await visitor.screenshot({ path: SCREENSHOT, fullPage: true });
if (SCREENSHOT) await page.screenshot({ path: SCREENSHOT.replace(/\.png$/, "-admin.png"), fullPage: true });
await visitor.setViewportSize({ width: 375, height: 800 });
check("sur téléphone, la page tient dans la largeur",
      await visitor.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
if (SCREENSHOT) await visitor.screenshot({ path: SCREENSHOT.replace(/\.png$/, "-mobile.png"), fullPage: true });
await visitor.setViewportSize({ width: 1280, height: 900 });

await visitor.locator(".pf-tile").nth(1).click();
await visitor.waitForSelector("#pf-lightbox:not([hidden])");
check("la visionneuse s'ouvre sur la photo choisie", (await visitor.textContent("#pf-lb-count")) === "2 / 3");
await visitor.keyboard.press("ArrowRight");
await visitor.keyboard.press("ArrowRight");
check("les flèches font défiler en boucle", (await visitor.textContent("#pf-lb-count")) === "1 / 3");
await visitor.keyboard.press("Escape");
check("Échap ferme la visionneuse", await visitor.isHidden("#pf-lightbox"));

await visitor.fill('#pf-form [name="name"]', "Camille");
await visitor.fill('#pf-form [name="email"]', "pas-une-adresse");
await visitor.fill('#pf-form [name="message"]', "Bonjour, nous aimerions une séance en famille au printemps.");
await visitor.click("#pf-submit");
check("une adresse invalide est signalée avant l'envoi", (await visitor.textContent("#pf-form-error")).includes("e-mail"));
await visitor.fill('#pf-form [name="email"]', "camille@test.invalid");
await visitor.fill('#pf-form [name="eventDate"]', "avril 2027");
await visitor.click("#pf-submit");
await visitor.waitForSelector("#pf-sent:not([hidden])", { timeout: 10000 });
check("le message part et un remerciement s'affiche", await visitor.isHidden("#pf-form"));

const contact = (body) => fetch(`${API}/api/portfolio/${HANDLE}/contact`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const trapped = await contact({ name: "Robot", email: "robot@test.invalid", message: "Achetez mes produits miracles", website: "http://spam.example" });
admin = await client.request("GET", "/api/admin/portfolio");
check("le champ piège fait semblant d'accepter un robot, sans rien enregistrer",
      trapped.status === 200 && admin.messages.length === 1 && admin.messages[0].name === "Camille" && admin.messages[0].eventDate === "avril 2027");
check("un message trop court est refusé", (await contact({ name: "A", email: "a@test.invalid", message: "Salut" })).status === 400);
const second = await contact({ name: "Léa", email: "lea@test.invalid", message: "Une question sur vos tarifs, merci !" });
const third = await contact({ name: "Léa", email: "lea@test.invalid", message: "Une autre question sur vos tarifs." });
const fourth = await contact({ name: "Léa", email: "lea@test.invalid", message: "Encore une question sur vos tarifs." });
check("au-delà de 3 messages par heure depuis la même adresse, le formulaire refuse",
      second.status === 200 && third.status === 200 && fourth.status === 429, `${second.status} ${third.status} ${fourth.status}`);

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".ad-pf-message", { timeout: 10000 });
// Le message de Camille a déjà été lu (relecture par l'API plus haut) : seuls
// les deux de Léa sont nouveaux.
check("les messages reçus s'affichent dans l'admin, les nouveaux signalés",
      (await page.locator(".ad-pf-message").count()) === 3 && (await page.locator(".ad-pf-message .ad-badge").count()) === 2 &&
      (await page.textContent(".ad-pf-messages")).includes("camille@test.invalid"));
await page.locator(".ad-pf-message").first().locator("[data-delete-message]").click();
await page.waitForFunction(() => document.querySelectorAll(".ad-pf-message").length === 2, null, { timeout: 5000 });
admin = await client.request("GET", "/api/admin/portfolio");
check("un message se supprime, et les autres sont désormais lus",
      admin.messages.length === 2 && admin.messages.every((m) => !m.unread));

/* ---------- Racine du sous-domaine d'un studio Pro ---------- */

await setTestPlan(API, account.email, "pro");
const SUB = `pf${stamp}`.slice(0, 20);
await client.request("POST", "/api/admin/account/subdomain", { subdomain: SUB });
const root = await hostFetch(`${API}/`, { headers: { host: `${SUB}.holypixx.com`} });
const rootHtml = await root.text();
check("la racine du sous-domaine affiche le portfolio publié",
      root.status === 200 && rootHtml.includes(`handle: "${HANDLE}"`) && rootHtml.includes(`api: "//${SUB}.holypixx.com"`) && rootHtml.includes("portfolio.js"));
check("le serveur écrit titre, adresse de référence, aperçu de lien et données structurées du studio dans la page",
      rootHtml.includes("— Photographe à Liège</title>") && rootHtml.includes(`<link rel="canonical" href="https://${SUB}.holypixx.com/" />`) &&
      rootHtml.includes(`<meta property="og:image" content="https://${SUB}.holypixx.com/api/portfolio/${HANDLE}/photo/`) &&
      /"@type":"ProfessionalService"/.test(rootHtml) && !rootHtml.includes("Portfolio — Holypixx"));
const withGallery = await hostFetch(`${API}/?g=quelque-chose`, { headers: { host: `${SUB}.holypixx.com`} });
check("un lien de galerie sous le sous-domaine mène toujours à la galerie, jamais indexée",
      (await withGallery.text()).includes("GALERIE_CONFIG") && (withGallery.headers.get("x-robots-tag") || "").includes("noindex"));
const studioRobots = await (await hostFetch(`${API}/robots.txt`, { headers: { host: `${SUB}.holypixx.com` } })).text();
const studioSitemap = await hostFetch(`${API}/sitemap.xml`, { headers: { host: `${SUB}.holypixx.com` } });
const sitemapXml = await studioSitemap.text();
check("le studio a son robots.txt et son plan du site (la racine, avec sa date)",
      studioRobots.includes(`Sitemap: https://${SUB}.holypixx.com/sitemap.xml`) && studioSitemap.status === 200 &&
      sitemapXml.includes(`<loc>https://${SUB}.holypixx.com/</loc>`) && /<lastmod>\d{4}-\d\d-\d\d<\/lastmod>/.test(sitemapXml));
const rivalHandle = `rival-${stamp}`;
await rival.request("PUT", "/api/admin/portfolio", { handle: rivalHandle });
const foreign = await hostFetch(`${API}/api/portfolio/${rivalHandle}`, { headers: { host: `${SUB}.holypixx.com` } });
check("le portfolio d'un autre studio n'existe pas sous ce sous-domaine", foreign.status === 404);
const subTaken = await rival.request("POST", "/api/admin/account/subdomain", { subdomain: HANDLE }).catch((err) => err);
check("l'adresse d'un portfolio ne peut pas devenir le sous-domaine d'un autre studio", subTaken.status === 409 || subTaken.status === 402);

/* ---------- Dépublier, effacer ---------- */

await client.request("PUT", "/api/admin/portfolio", { ...admin, published: false });
check("dépublié, le portfolio disparaît du public", (await fetch(`${API}/api/portfolio/${HANDLE}`)).status === 404);
await visitor.goto(`http://localhost:${SITE_PORT}/portfolio.html?s=${HANDLE}`, { waitUntil: "domcontentloaded" });
await visitor.waitForSelector("#pf-missing:not([hidden])", { timeout: 10000 });
check("la page publique l'annonce simplement, sans se faire indexer",
      (await visitor.textContent("#pf-missing")).includes("pas disponible") && (await visitor.getAttribute('meta[name="robots"]', "content")) === "noindex");
check("dépublié : plus de plan du site pour le studio",
      (await hostFetch(`${API}/sitemap.xml`, { headers: { host: `${SUB}.holypixx.com` } })).status === 404 &&
      !(await (await hostFetch(`${API}/robots.txt`, { headers: { host: `${SUB}.holypixx.com` } })).text()).includes("Sitemap"));

const exported = await client.request("GET", "/api/admin/account/export");
check("l'export RGPD contient le portfolio, ses photos et ses messages",
      exported.portfolio?.handle === HANDLE && exported.portfolio_photos.length === 3 && exported.portfolio_messages.length === 2);

check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

await browser.close();
site.close();

const photoIds = admin.photos.map((p) => p.id);
await client.request("POST", "/api/admin/account/delete", { confirm: "SUPPRIMER", password: account.password });
await rival.request("POST", "/api/admin/account/delete", { confirm: "SUPPRIMER", password: rival.password }).catch(() => {});
const after = await fetch(`${API}/api/portfolio/${HANDLE}/photo/${photoIds[0]}`);
check("supprimer le compte efface aussi le portfolio", after.status === 404);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
