// Page d'accueil néerlandaise (/nl/) et sélecteur de langue des trois pages
// d'accueil, dans un vrai navigateur : textes, liens d'inscription en
// néerlandais, aucun débordement (téléphone et largeurs intermédiaires),
// newsletter avec consentement contre le Worker local.
//
//   npm run dev:local                      (depuis worker/)
//   node tests/accueil-nl.test.mjs         (depuis tools/)

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { localSql } from "./lib/testAccount.mjs";

const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const SHOTS = process.env.SHOTS || "";
const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web");

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", webp: "image/webp", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", xml: "application/xml" };
const site = createServer(async (req, res) => {
  let pathname = decodeURIComponent(req.url.split("?")[0]);
  if (pathname.endsWith("/")) pathname += "index.html";
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
// Port 8000 : origine autorisée par le Worker local (ALLOWED_ORIGINS).
await new Promise((resolve, reject) => {
  site.once("error", reject);
  site.listen(Number(process.env.SITE_PORT || 8000), "localhost", resolve);
});
const base = `http://localhost:${process.env.SITE_PORT || 8000}`;

const browser = await chromium.launch({ ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}), args: ["--disable-features=LocalNetworkAccessChecks"] });
const exceptions = [];
async function open(path, width, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => exceptions.push(path + " " + String(err)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(base + path, { waitUntil: "load" });
  await page.waitForTimeout(400);
  return page;
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/* ---------- Page néerlandaise ---------- */

const page = await open("/nl/", 1280);
check("langue, titre et URL canonique", await page.getAttribute("html", "lang") === "nl" && /foto/i.test(await page.title()) &&
      await page.getAttribute('link[rel="canonical"]', "href") === "https://www.holypixx.com/nl/", await page.title());
const text = await page.evaluate(() => {
  document.querySelectorAll("details").forEach((d) => { d.open = true; });
  return document.body.innerText;
});
const french = text.split("\n").filter((l) => /\b(vous|votre|vos|galerie|photographe|Créer|séance|Afficher)\b/i.test(l) && !/Version française/.test(l));
check("aucun reste de français visible (FAQ ouvertes)", french.length === 0, french.slice(0, 4).join(" | "));
const signups = await page.$$eval("a[href*='inscription']", (as) => as.map((a) => a.href));
check("liens d'inscription vers l'espace en néerlandais", signups.length > 0 && signups.every((h) => /lang=nl/.test(h)), signups[0]);
check("hreflang fr, en, nl et x-default", (await page.$$eval('link[rel="alternate"][hreflang]', (ls) => ls.map((l) => l.hreflang).sort().join())) === "en,fr,nl,x-default");
check("FAQ : la question du néerlandais, avec lien vers la newsletter", text.includes("Is Holypixx in het Nederlands?") && await page.isVisible('a[href="#nieuwsbrief"]'));
const ld = await page.$$eval('script[type="application/ld+json"]', (ss) => ss.map((s) => { try { JSON.parse(s.textContent); return true; } catch { return false; } }));
check("données structurées valides", ld.length >= 2 && ld.every(Boolean));
if (SHOTS) await page.screenshot({ path: join(SHOTS, "accueil-nl-1280.png"), fullPage: true });

// Newsletter
await page.locator("#newsletter-form").scrollIntoViewIfNeeded();
const email = `accueil-nl-${Date.now().toString(36)}@test.invalid`;
await page.fill("#newsletter-form [name=email]", email);
await page.click("#newsletter-submit");
check("sans case cochée : refus en néerlandais", /Vink het vakje aan/.test(await page.textContent("#newsletter-status")));
await page.check("#newsletter-form [name=consent]");
await page.click("#newsletter-submit");
await page.waitForFunction(() => /Bedankt/.test(document.getElementById("newsletter-status").textContent), null, { timeout: 10000 });
check("inscription confirmée en néerlandais, formulaire vidé", (await page.inputValue("#newsletter-form [name=email]")) === "");
if (SHOTS) await page.locator(".closing").screenshot({ path: join(SHOTS, "accueil-nl-newsletter.png") });

/* ---------- Sélecteur de langue et débordements ---------- */

for (const [path, others] of [["/", ["/en/", "/nl/"]], ["/en/", ["/", "/nl/"]], ["/nl/", ["/", "/en/"]]]) {
  const p = await open(path, 1440);
  const links = await p.$$eval("footer a[hreflang], .nav a[hreflang], header a[hreflang]", (as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
  check(`${path} : liens vers les deux autres langues`, others.every((o) => links.includes(o)), links.join(" "));
  for (const width of [390, 768, 1180, 1200, 1240, 1280, 1300]) {
    await p.setViewportSize({ width, height: 900 });
    await p.waitForTimeout(120);
    const o = await overflow(p);
    if (o > 1) check(`${path} à ${width} px : pas de débordement`, false, o + " px");
  }
  check(`${path} : aucun débordement de 390 à 1300 px`, true);
  if (SHOTS && path === "/nl/") {
    await p.setViewportSize({ width: 390, height: 844 });
    await p.screenshot({ path: join(SHOTS, "accueil-nl-390.png"), fullPage: true });
  }
}
const en = await open("/en/", 1280);
const toggle = await en.evaluate(() => {
  const s = document.querySelector(".lab-toggle strong");
  return s ? getComputedStyle(s, "::after").content : "none";
});
check("page anglaise : étiquette de couche en anglais (plus « Afficher »)", toggle === "none" || !/Afficher/.test(toggle), toggle);

check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));

await browser.close();
site.close();
await localSql(API, `DELETE FROM newsletter_subscribers WHERE email = '${email}'`).catch(() => {});

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
