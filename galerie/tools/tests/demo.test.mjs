// Galerie de démonstration créée à l'inscription, dans un vrai navigateur,
// contre admin-server.mjs et un Worker local : premier écran sur la démo,
// photos préparées en arrière-plan, sélection de la cliente simulée, guide
// (lien, mot de passe qui ouvre vraiment la galerie, suppléments), hors
// quota et hors statistiques, une seule à la fois, suppression puis
// recréation depuis l'onglet Galeries. SHOTS=<dossier> enregistre des captures.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/demo.test.mjs

import { chromium } from "playwright";
import { join } from "node:path";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const SHOTS = process.env.SHOTS || "";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
async function shot(name, target = page) {
  if (SHOTS) await target.screenshot({ path: join(SHOTS, name + ".png"), fullPage: true });
}
const local = (method, path, body) => page.evaluate(async ({ method, path, body }) => {
  const res = await fetch("/local" + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}, { method, path, body });

/* ---------- Inscription : premier écran sur la démo ---------- */

const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const email = `demo-${RUN}@test.invalid`;
await page.goto(`${BASE}/#/inscription`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-signup-card", { state: "visible", timeout: 10000 });
await page.fill('#ad-signup-form [name="firstName"]', "Camille");
await page.fill('#ad-signup-form [name="studioName"]', "Studio Lumière");
await page.fill('#ad-signup-form [name="email"]', email);
await page.fill('#ad-signup-form [name="password"]', "mot-de-passe-demo-1234");
await page.check('#ad-signup-form [name="acceptTerms"]');
const started = Date.now();
await page.click("#ad-signup-submit");
await page.waitForSelector("#ad-demo", { timeout: 15000 });
check("après l'inscription, le premier écran est la galerie de démonstration",
      /#\/g\/demo-/.test(page.url()) && (await page.textContent("#ad-demo")).includes("Voici exactement ce que vit votre client"), page.url());
const firstText = await page.textContent("#ad-demo");
check("ses photos arrivent en arrière-plan, avec une ligne de progression",
      /Préparation des photos|fait sa sélection/.test(firstText) || (await page.locator("#ad-photos .ad-photo").count()) > 0, firstText.match(/Préparation[^…]*…/)?.[0]);
await shot("01-demo-preparing");

// La fiche se recharge d'elle-même quand la famille a fait sa sélection.
await page.waitForFunction(() => !document.querySelector("#ad-demo .ad-demo-progress") && document.querySelectorAll("#ad-photos .ad-photo").length > 0,
  null, { timeout: 180000, polling: 1000 });
const seconds = Math.round((Date.now() - started) / 1000);
const photoCount = await page.locator("#ad-photos .ad-photo").count();
const guide = await page.textContent("#ad-demo");
check("11 photos préparées et la sélection faite, fiche rechargée toute seule", photoCount === 11, `${photoCount} photos en ${seconds} s`);
check("le guide lit la sélection : 7 coups de cœur, forfait de 5, 2 suppléments à 30 €",
      guide.includes("7 coups de cœur") && guide.includes("forfait de 5 photos") && guide.includes("2 suppléments") && /30,00\s€/.test(guide), guide.match(/\d+ coups de cœur[^.]*\./)?.[0]);
const { slug, password } = await page.evaluate(() => ({
  slug: decodeURIComponent(location.hash.slice(4)),
  password: document.getElementById("ad-demo-password")?.value || "",
}));
check("le mot de passe de la démo est affiché, à copier", password.length >= 12, password);
const detail = (await local("GET", `/galleries/${slug}`)).data;
const selected = detail.photos.filter((p) => p.selected);
check("cliente simulée : 7 favoris, 3 codes couleur, 1 commentaire, et sa connexion au journal",
      selected.length === 7 && detail.photos.filter((p) => p.tag).length === 3 && detail.photos.filter((p) => p.comment).length === 1 &&
      detail.log.some((e) => e.event === "login") && detail.log.filter((e) => e.event === "select").length === 7,
      `${selected.length} favoris, ${detail.log.length} lignes au journal`);
check("filigrane au nom du studio et de la famille", detail.gallery.watermark_text === "Studio Lumière  ·  Famille Martin", detail.gallery.watermark_text);
await shot("02-demo-ready");

// Le mot de passe affiché ouvre vraiment la galerie, côté client.
const clientLogin = await fetch(`${API}/api/gallery/${encodeURIComponent(slug)}/login`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }),
});
check("le mot de passe affiché ouvre la galerie côté client", clientLogin.ok, clientLogin.status);

/* ---------- Hors quota, hors statistiques, une seule à la fois ---------- */

await page.click("#ad-back");
await page.waitForSelector(".ad-card", { timeout: 10000 });
check("dans la liste : badge « Démo »", (await page.textContent(`.ad-card[data-slug="${slug}"]`)).includes("Démo"));
const stats = (await local("GET", "/stats")).data;
check("le bandeau de chiffres ignore la démo (0 galerie, aucun supplément dû)",
      stats.galleriesCount === 0 && stats.extrasDueCount === 0, JSON.stringify(stats));
const sub = (await local("GET", "/subscription")).data;
check("la démo ne compte pas dans les galeries actives de la formule", sub.usage?.activeGalleries === 0, JSON.stringify(sub.usage || {}));
const real = [];
for (let i = 1; i <= 3; i++) real.push(await local("POST", "/galleries", { title: `Vraie séance ${i}`, clientName: "Client" }));
const fourth = await local("POST", "/galleries", { title: "Quatrième séance", clientName: "Client" });
check("formule gratuite : 3 vraies galeries possibles en plus de la démo, pas une de plus",
      real.every((r) => r.status === 201) && fourth.status === 402, real.map((r) => r.status).concat(fourth.status).join(", "));
const second = await local("POST", "/demo");
check("une seule démo à la fois", second.status === 409, second.status);
for (const r of real) await local("DELETE", `/galleries/${r.data.slug}`);

/* ---------- Suppression, puis recréation depuis l'onglet Galeries ---------- */

await page.click(`.ad-card[data-slug="${slug}"]`);
await page.waitForSelector("#ad-demo-delete", { timeout: 10000 });
await page.click("#ad-demo-delete");
await page.click("#ad-confirm-ok");
await page.waitForSelector("#ad-start-demo", { timeout: 10000 });
check("démo supprimée : l'écran vide propose d'en revoir une", await page.isVisible("#ad-start-demo"));
await shot("03-empty-with-demo");
await page.click("#ad-start-demo");
await page.waitForSelector("#ad-demo", { timeout: 15000 });
check("…et la recrée d'un clic", /#\/g\/demo-/.test(page.url()) && decodeURIComponent(page.url().split("#/g/")[1]) !== slug);

/* ---------- Mobile ---------- */

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("sur téléphone, le guide tient dans la largeur", overflow <= 1, overflow);
await shot("04-demo-mobile");

check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));

/* ---------- Nettoyage ---------- */

const left = (await local("GET", "/galleries")).data.galleries || [];
for (const g of left) await local("DELETE", `/galleries/${g.slug}`);
await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
