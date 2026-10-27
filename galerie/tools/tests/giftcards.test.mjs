// Bons cadeaux, de bout en bout dans de vrais navigateurs : le photographe
// ouvre la vente (minimum, validité, conditions) dans l'onglet « Bons
// cadeaux » ; un client compose son bon sur le mini-site (séance, forfait,
// valeur au moins égale au minimum, de la part de, pour, petit mot) ; au
// retour du paiement, il retrouve son code ; la personne gâtée ouvre la page
// privée du bon (QR code ou code tapé) ; le photographe émet un bon à la
// main, le télécharge en PDF et le marque comme utilisé.
//
// Stripe n'est pas configuré en local : le paiement est refusé proprement,
// puis un bon payé est posé directement dans la base, comme le webhook.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/giftcards.test.mjs

import { chromium } from "playwright";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../lib/client.mjs";
import { createTestAccount, localSql } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_DIR = join(REPO_ROOT, "galerie", "web");
const WORKER_DIR = join(REPO_ROOT, "galerie", "worker");
const PHOTO = join(REPO_ROOT, "images", "famille", "famille-01.jpeg");
const SITE_PORT = Number(process.env.SITE_PORT || 8000); // seule origine locale autorisée par le Worker
const SHOTS = process.env.SCREENSHOT_DIR || "";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const account = await createTestAccount(API, "bons-cadeaux");
const client = new WorkerClient({ api: API, ...account });
const RUN = Date.now().toString(36);
const HANDLE = `cadeau-${RUN}`;

/* ---------- Site principal local (mini-site et page du bon) ---------- */

const TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8" };
const site = createServer(async (req, res) => {
  let pathname = req.url.split("?")[0];
  if (!pathname.includes(".")) pathname += ".html";
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
const exceptions = [];
const admin = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
admin.on("pageerror", (err) => exceptions.push("admin: " + String(err)));
await admin.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

try {
  await admin.goto(BASE, { waitUntil: "domcontentloaded" });
  await admin.fill('#ad-login-form [name="email"]', account.email);
  await admin.fill('#ad-login-form [name="password"]', account.password);
  await admin.click("#ad-login-submit");
  await admin.waitForSelector("#ad-new-gallery", { timeout: 10000 });

  // Mini-site publié, et une formule à deux forfaits.
  await admin.click("#ad-tab-portfolio");
  await admin.waitForSelector("#ad-pf-form", { timeout: 10000 });
  await admin.setInputFiles("#ad-pf-files", [PHOTO]);
  await admin.waitForFunction(() => document.querySelectorAll(".ad-pf-photo").length === 1, null, { timeout: 60000 });
  await admin.fill('#ad-pf-form [name="handle"]', HANDLE);
  await admin.check('#ad-pf-form [name="published"]');
  await admin.click("#ad-pf-save");
  for (let i = 0; i < 20 && !(await client.request("GET", "/api/admin/portfolio")).published; i++) await admin.waitForTimeout(300);
  await client.request("POST", "/api/admin/booking/offers", {
    title: "Séance naissance", durationMin: 90, depositCents: 0, location: "À domicile",
    description: "En douceur, à la maison, pendant les premiers jours.", included: "Retouches soignées\nGalerie privée en ligne",
    tiers: [{ label: "", photos: 10, priceCents: 15000 }, { label: "", photos: 20, priceCents: 22000 }],
  });

  /* ---------- Onglet Bons cadeaux : ouverture de la vente ---------- */

  await admin.click("#ad-tab-giftcards");
  await admin.waitForSelector("#ad-gift-settings", { timeout: 10000 });
  check("l'onglet Bons cadeaux ouvre #/bons-cadeaux", (await admin.evaluate(() => location.hash)) === "#/bons-cadeaux");
  await admin.check('#ad-gift-settings [name="enabled"]');
  await admin.fill('#ad-gift-settings [name="min"]', "40");
  await admin.selectOption('#ad-gift-settings [name="validityMonths"]', "12");
  await admin.fill('#ad-gift-settings [name="terms"]', "Bon non remboursable, à utiliser en une fois, sur rendez-vous.");
  await admin.click('#ad-gift-settings [type="submit"]');
  await admin.waitForSelector("#ad-view .ad-banner", { timeout: 10000 });
  let overview = await client.request("GET", "/api/admin/giftcards");
  check("réglages enregistrés : vente ouverte, minimum 40 €, 12 mois",
        overview.settings.enabled && overview.settings.minCents === 4000 && overview.settings.validityMonths === 12);
  check("sans paiement en ligne activé, l'onglet le signale", /paiement en ligne/.test(await admin.innerText("#ad-view .ad-banner")));
  check("tant que Stripe n'est pas prêt, rien n'est proposé sur le mini-site",
        (await (await fetch(`${API}/api/giftcard/${HANDLE}`)).json()).enabled === false);
  await localSql(API, `UPDATE photographers SET stripe_account_id = 'acct_test_${RUN}', stripe_charges_enabled = 1 WHERE email = '${account.email}'`);

  /* ---------- Mini-site : composer le bon ---------- */

  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.on("pageerror", (err) => exceptions.push("mini-site: " + String(err)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(`http://localhost:${SITE_PORT}/portfolio.html?s=${HANDLE}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#offrir:not([hidden])", { timeout: 15000 });
  check("la section « Offrir une séance » et le lien « Offrir » apparaissent", await page.isVisible("#pf-nav-gift"));
  const choices = await page.$$eval(".pf-gift-offer strong", (els) => els.map((e) => e.textContent));
  check("au choix : la formule du studio, ou un montant libre", choices.join(" | ") === "Séance naissance | Un montant libre", choices.join(" | "));
  check("la première séance est choisie, ses forfaits proposés, la valeur préremplie au prix du forfait",
        (await page.locator("#pf-gift-tiers .pf-bk-tier").count()) === 2 && (await page.inputValue('#pf-gift-form [name="amount"]')) === "150");
  await page.locator("#pf-gift-tiers .pf-bk-tier").nth(1).click();
  check("forfait 20 photos : valeur 220 €, récapitulatif et bouton à jour",
        (await page.inputValue('#pf-gift-form [name="amount"]')) === "220" && /20 photos/.test(await page.textContent("#pf-gift-summary")) &&
        /220/.test(await page.textContent("#pf-gift-submit")), await page.textContent("#pf-gift-summary"));
  check("validité et conditions du studio annoncées", /12 mois/.test(await page.textContent("#pf-gift-terms")) && /non remboursable/.test(await page.textContent("#pf-gift-terms")));
  await page.locator(".pf-gift-offer").nth(1).click();
  check("montant libre : valeur ramenée au minimum, sans forfait", (await page.inputValue('#pf-gift-form [name="amount"]')) === "40" && await page.isHidden("#pf-gift-tier-step"));
  await page.fill('#pf-gift-form [name="amount"]', "30");
  await page.fill('#pf-gift-form [name="fromName"]', "Mamie Jeanne");
  await page.fill('#pf-gift-form [name="toName"]', "Léa et Tom");
  await page.fill('#pf-gift-form [name="message"]', "Pour garder un souvenir de ces premiers jours.");
  await page.fill('#pf-gift-form [name="email"]', `mamie-${RUN}@test.invalid`);
  await page.click("#pf-gift-submit");
  check("sous le minimum : refusé avant même le paiement", /au moins 40/.test(await page.textContent("#pf-gift-error")), await page.textContent("#pf-gift-error"));
  await page.fill('#pf-gift-form [name="amount"]', "75");
  await page.click("#pf-gift-submit");
  await page.waitForFunction(() => /paiement en ligne/i.test(document.getElementById("pf-gift-error").textContent), null, { timeout: 10000 });
  check("paiement indisponible (pas de Stripe en local) : message clair, aucun bon fantôme",
        (await client.request("GET", "/api/admin/giftcards")).cards.length === 0 && (await localSqlCount("SELECT COUNT(*) AS n FROM gift_cards WHERE status = 'pending'")) === 0);
  if (SHOTS) await page.locator("#offrir").screenshot({ path: join(SHOTS, "bon-01-mini-site.png") });

  /* ---------- Retour du paiement (bon payé posé comme par le webhook) ---------- */

  const CODE = "K7QX2M9T".slice(0, 4) + RUN.slice(-4).toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "Z");
  const GIFT = `gft_test_${RUN}`;
  const ts = Math.floor(Date.now() / 1000);
  const offerId = (await client.request("GET", "/api/admin/giftcards")).offers[0].id;
  await localSql(API, `INSERT INTO gift_cards (id, photographer_id, code, status, source, amount_cents, fee_cents, offer_id, offer_title, offer_description, duration_min,
      tier_label, tier_photos, included, from_name, to_name, message, buyer_email, terms, valid_until, stripe_session_id, paid_at, created_at)
    VALUES ('${GIFT}', (SELECT id FROM photographers WHERE email = '${account.email}'), '${CODE}', 'paid', 'online', 22000, 300, '${offerId}', 'Séance naissance',
      'En douceur, à la maison, pendant les premiers jours.', 90, '', 20, 'Retouches soignées\nGalerie privée en ligne', 'Mamie Jeanne', 'Léa et Tom',
      'Pour garder un souvenir de ces premiers jours.', 'mamie-${RUN}@test.invalid', 'Bon non remboursable, à utiliser en une fois, sur rendez-vous.',
      ${ts + 365 * 86400}, 'cs_test_${RUN}', ${ts}, ${ts})`);
  await page.goto(`http://localhost:${SITE_PORT}/portfolio.html?s=${HANDLE}&bon=${GIFT}&session_id=cs_test_${RUN}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#pf-gift-result:not([hidden]) .pf-gift-code", { timeout: 15000 });
  check("au retour du paiement : merci, code du bon, lien vers sa page et PDF",
        (await page.textContent("#pf-gift-result")).includes("Léa et Tom") && (await page.textContent(".pf-gift-code")) === `${CODE.slice(0, 4)}-${CODE.slice(4)}` &&
        (await page.getAttribute("#pf-gift-result a.pf-btn", "href")).includes(`c=${CODE}`) && await page.isHidden("#pf-gift-form"));
  check("l'adresse est nettoyée (plus de session dans la barre)", !(await page.evaluate(() => location.search)).includes("session_id"));
  if (SHOTS) await page.locator("#offrir").screenshot({ path: join(SHOTS, "bon-02-merci.png") });

  /* ---------- Page privée du bon ---------- */

  const voucher = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  voucher.on("pageerror", (err) => exceptions.push("bon: " + String(err)));
  await voucher.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await voucher.goto(`http://localhost:${SITE_PORT}/bon-cadeau?c=${CODE}`, { waitUntil: "domcontentloaded" });
  await voucher.waitForSelector("#gc-card:not([hidden])", { timeout: 15000 });
  const facts = await voucher.$$eval("#gc-facts > div", (rows) => rows.map((r) => r.innerText.replace(/\s+/g, " ")));
  check("la page du bon (QR code) : pour, de la part de, petit mot, séance",
        (await voucher.textContent("#gc-to")) === "Léa et Tom" && (await voucher.textContent("#gc-from")).includes("Mamie Jeanne") &&
        (await voucher.textContent("#gc-message")).includes("premiers jours") && (await voucher.textContent("#gc-gift-title")) === "Séance naissance");
  check("durée, nombre de photos, valeur, validité et compris détaillés",
        facts.some((f) => /1 h 30/.test(f)) && facts.some((f) => /20/.test(f) && /PHOTOS/i.test(f)) && facts.some((f) => /220/.test(f)) &&
        (await voucher.locator("#gc-included-list li").count()) === 2, facts.join(" | "));
  check("état « valable jusqu'au… », QR code dessiné, code affiché",
        /Valable jusqu'au/.test(await voucher.textContent("#gc-status")) && ((await voucher.getAttribute("#gc-qr path", "d")) || "").startsWith("M") &&
        (await voucher.textContent("#gc-code-text")) === `${CODE.slice(0, 4)}-${CODE.slice(4)}`);
  check("comment en profiter : contact du studio, lien de réservation du mini-site",
        (await voucher.textContent("#gc-contact")).includes(account.email) && (await voucher.getAttribute("#gc-book", "href")).includes("#reserver"));
  const pdf = await voucher.evaluate(async () => {
    const res = await fetch(document.getElementById("gc-pdf").href);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, type: res.headers.get("content-type"), head: String.fromCharCode(...bytes.slice(0, 5)) };
  });
  check("le PDF du bon se télécharge", pdf.status === 200 && pdf.type === "application/pdf" && pdf.head === "%PDF-", JSON.stringify(pdf));
  if (SHOTS) await voucher.screenshot({ path: join(SHOTS, "bon-03-page.png"), fullPage: true });

  // Adresse tapée à la main : le code se saisit.
  await voucher.goto(`http://localhost:${SITE_PORT}/bon-cadeau`, { waitUntil: "domcontentloaded" });
  await voucher.waitForSelector("#gc-enter:not([hidden])");
  await voucher.fill("#gc-code", "ZZZZ-2222");
  await voucher.click('#gc-form [type="submit"]');
  await voucher.waitForSelector("#gc-error:not([hidden])", { timeout: 10000 });
  check("code inconnu : message clair", /aucun bon cadeau/.test(await voucher.textContent("#gc-error")), await voucher.textContent("#gc-error"));
  await voucher.fill("#gc-code", `${CODE.slice(0, 4).toLowerCase()} ${CODE.slice(4).toLowerCase()}`);
  await voucher.click('#gc-form [type="submit"]');
  await voucher.waitForSelector("#gc-card:not([hidden])", { timeout: 10000 });
  check("code tapé en minuscules avec une espace : le bon s'ouvre, l'adresse garde le code",
        (await voucher.textContent("#gc-to")) === "Léa et Tom" && (await voucher.evaluate(() => location.search)) === `?c=${CODE}`);

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  phone.on("pageerror", (err) => exceptions.push("bon mobile: " + String(err)));
  await phone.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await phone.goto(`http://localhost:${SITE_PORT}/bon-cadeau?c=${CODE}`, { waitUntil: "domcontentloaded" });
  await phone.waitForSelector("#gc-card:not([hidden])", { timeout: 15000 });
  check("sur téléphone, la page du bon tient dans la largeur", await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (SHOTS) await phone.screenshot({ path: join(SHOTS, "bon-04-mobile.png"), fullPage: true });

  /* ---------- Suivi du photographe ---------- */

  await admin.click("#ad-tab-giftcards");
  await admin.waitForSelector(".ad-gift-table", { timeout: 10000 });
  check("le bon vendu apparaît dans « Bons à utiliser », avec l'acheteur",
        (await admin.textContent(".ad-gift-table")).includes("Léa et Tom") && (await admin.textContent(".ad-gift-table")).includes(`mamie-${RUN}@test.invalid`));
  await admin.click("#ad-gift-manual-toggle");
  await admin.waitForSelector("#ad-gift-manual");
  await admin.selectOption('#ad-gift-manual [name="offerId"]', offerId);
  check("bon à la main : la séance choisie propose ses forfaits et préremplit la valeur",
        await admin.isVisible("#ad-gift-tier-field") && (await admin.inputValue('#ad-gift-manual [name="amount"]')) === "150");
  await admin.fill('#ad-gift-manual [name="fromName"]', "Le studio");
  await admin.fill('#ad-gift-manual [name="toName"]', "Gagnante du concours");
  await admin.click('#ad-gift-manual [type="submit"]');
  await admin.waitForFunction(() => document.querySelectorAll(".ad-gift-table tbody tr").length === 2, null, { timeout: 10000 });
  overview = await client.request("GET", "/api/admin/giftcards");
  const manual = overview.cards.find((c) => c.source === "manual");
  check("bon émis à la main : valable, 150 €, forfait 10 photos", manual && manual.status === "valid" && manual.amountCents === 15000 && manual.tierPhotos === 10);
  const pdfAdmin = await admin.evaluate(async (id) => {
    const res = await fetch(`/local/giftcards/${encodeURIComponent(id)}/pdf`);
    return { status: res.status, type: res.headers.get("content-type") };
  }, manual.id);
  check("PDF du bon depuis l'onglet", pdfAdmin.status === 200 && pdfAdmin.type === "application/pdf", JSON.stringify(pdfAdmin));
  await admin.click(`[data-gift-redeem="${GIFT}"]`);
  await admin.waitForFunction(() => document.querySelectorAll("#ad-gift-list > .ad-table-wrap tbody tr").length === 1, null, { timeout: 10000 });
  check("« Utilisé » : le bon quitte la liste des bons à utiliser", (await client.request("GET", "/api/admin/giftcards")).cards.find((c) => c.id === GIFT).status === "redeemed");
  await voucher.reload({ waitUntil: "domcontentloaded" });
  await voucher.waitForSelector("#gc-card:not([hidden])", { timeout: 10000 });
  check("…et sa page affiche « Utilisé le … », sans bouton de réservation",
        /Utilisé le/.test(await voucher.textContent("#gc-status")) && await voucher.isHidden("#gc-book"));
  if (SHOTS) await admin.screenshot({ path: join(SHOTS, "bon-05-admin.png"), fullPage: true });

  await admin.setViewportSize({ width: 390, height: 844 });
  await admin.waitForTimeout(300);
  check("onglet Bons cadeaux sur téléphone : pas de défilement horizontal de la page", await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
} finally {
  check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));
  await browser.close();
  site.close();
}

async function localSqlCount(sql) {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "galerie-protegee", "--local", "--json", "--command", sql], { cwd: WORKER_DIR, stdio: "pipe" });
  const text = out.toString();
  // Comme localSql : le Worker local coupe parfois ses connexions juste après.
  for (let i = 0; i < 20; i++) {
    try { if ((await fetch(`${API}/health`, { headers: { connection: "close" } })).ok) break; } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return JSON.parse(text.slice(text.indexOf("[")))[0].results[0].n; // wrangler peut écrire une ligne avant le JSON
}

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
