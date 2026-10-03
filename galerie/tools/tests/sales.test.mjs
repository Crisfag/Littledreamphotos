// Onglet « Ventes » du tableau de bord, dans un vrai navigateur, contre le
// vrai Worker local : indicateurs, graphique mensuel (survol), vue tableau
// et classements. Autonome : crée son compte, ses galeries et ses paiements,
// nettoie derrière lui.
//
//   npm run dev:local                      (depuis worker/)
//   node admin-server.mjs                  (depuis tools/, GALERIE_API=http://127.0.0.1:8788)
//   node tests/sales.test.mjs              (depuis tools/)

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../lib/client.mjs";
import { createTestAccount } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const WORKER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "worker");
const SCREENSHOT = process.env.SALES_SCREENSHOT || "";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

async function d1(sql) {
  execFileSync("npx", ["wrangler", "d1", "execute", "galerie-protegee", "--local", "--command", sql], { cwd: WORKER_DIR, stdio: "pipe" });
  for (let i = 0; i < 20; i++) {
    try {
      if ((await fetch(`${API}/health`)).ok) return;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/* ---------- Compte, galeries, ventes ---------- */

const account = await createTestAccount(API, "ventes");
const client = new WorkerClient({ api: API, ...account });
const stamp = Date.now().toString(36);
const slugA = `ventes-a-${stamp}`;
const slugB = `ventes-b-${stamp}`;
const slugC = `ventes-c-${stamp}`;
const galleryA = await client.createGallery({ slug: slugA, title: "Mariage Martin", clientName: "Martin", password: "mot-de-passe-ventes-a" });
const galleryB = await client.createGallery({ slug: slugB, title: "Séance Dupont", clientName: "Dupont", password: "mot-de-passe-ventes-b" });
await client.createGallery({ slug: slugC, title: "Sans vente", clientName: "Vide", password: "mot-de-passe-ventes-c" });
const me = await client.request("GET", "/api/auth/me");
const photographerId = me.photographer?.id || me.id;

const now = Math.floor(Date.now() / 1000);
const daysAgo = (n) => now - n * 86400;
const product = `prd_ventes_${stamp}`;
const payment = (id, gallery, kind, cents, paidAt) =>
  `INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, status, kind, created_at, paid_at) ` +
  `VALUES ('${id}_${stamp}', '${gallery}', 'cs_${id}_${stamp}', 0, ${cents}, 'paid', '${kind}', ${paidAt}, ${paidAt});`;
await d1(
  `INSERT INTO print_products (id, photographer_id, label, sku, price_cents, cost_cents, created_at) VALUES ('${product}', '${photographerId}', 'Toile 40 × 50 cm', 'GLOBAL-CAN-16x20', 8900, 2300, ${now});` +
  payment("pay1", galleryA.id, "supplement", 4500, daysAgo(70)) +
  payment("pay2", galleryA.id, "print", 18390, daysAgo(40)) +
  payment("pay3", galleryB.id, "supplement", 2500, daysAgo(5)) +
  payment("pay4", galleryB.id, "supplement", 1500, daysAgo(400)) +
  `INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, status, kind, created_at) VALUES ('pend_${stamp}', '${galleryB.id}', 'cs_pend_${stamp}', 0, 99900, 'pending', 'print', ${now});` +
  `INSERT INTO print_orders (id, gallery_id, photographer_id, payment_id, status, items, recipient, client_email, items_cents, shipping_cents, total_cents, created_at, paid_at, updated_at) ` +
  `VALUES ('ord_${stamp}', '${galleryA.id}', '${photographerId}', 'pay2_${stamp}', 'shipped', '[{"productId":"${product}","label":"Toile 40 × 50 cm","copies":2,"lineCents":17800}]', '{}', 'client@test.invalid', 17800, 590, 18390, ${daysAgo(40)}, ${daysAgo(40)}, ${daysAgo(40)});`
);

/* ---------- API ---------- */

const sales = await client.request("GET", "/api/admin/sales");
check("l'API renvoie douze mois", sales.months?.length === 12);
check("seuls les paiements réglés des douze derniers mois comptent",
      sales.totals.revenueCents === 4500 + 18390 + 2500 && sales.totals.orders === 3, `${sales.totals.revenueCents}`);
check("la marge estimée retire le coût du labo", sales.printMargin.marginCents === 17800 - 2 * 2300, `${sales.printMargin.marginCents}`);
check("conversion : 2 galeries sur 3 ont vendu", sales.conversion.withSales === 2 && sales.conversion.galleries === 3);
const other = new WorkerClient({ api: API, ...(await createTestAccount(API, "ventes-autre")) });
const otherSales = await other.request("GET", "/api/admin/sales");
check("un autre photographe ne voit aucune de ces ventes", otherSales.totals.revenueCents === 0 && otherSales.topGalleries.length === 0);

/* ---------- Navigateur ---------- */

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-login-form", { timeout: 10000 });
await page.fill('#ad-login-form [name="email"]', account.email);
await page.fill('#ad-login-form [name="password"]', account.password);
await page.click("#ad-login-submit");
await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });

await page.click("#ad-tab-sales");
await page.waitForSelector(".ad-chart-svg", { timeout: 10000 });
check("l'onglet Ventes ouvre #/ventes", (await page.evaluate(() => location.hash)) === "#/ventes");
const statsText = await page.textContent(".ad-stats");
check("les indicateurs affichent le chiffre d'affaires, le panier moyen et la marge",
      statsText.includes("253,90") && statsText.includes("84,63") && statsText.includes("132,00") && statsText.includes("67 %"),
      statsText.replace(/\s+/g, " "));
check("douze colonnes, une légende pour les deux séries",
      (await page.locator(".ad-chart-col").count()) === 12 && (await page.locator(".ad-legend li").count()) === 2);
check("les colonnes ne dépassent pas 24 px de large",
      await page.evaluate(() => [...document.querySelectorAll(".ad-chart-col path, .ad-chart-col rect:not(.ad-chart-hit)")].every((n) => n.getBBox().width <= 24)));

const tallest = page.locator(".ad-chart-col").filter({ has: page.locator("path") }).first();
await tallest.hover();
await page.waitForSelector("#ad-sales-tip:not([hidden])", { timeout: 3000 });
const tipText = await page.textContent("#ad-sales-tip");
check("le survol d'un mois affiche le détail par série et le total", tipText.includes("Suppléments") && tipText.includes("Tirages") && tipText.includes("Total"), tipText);
if (SCREENSHOT) await page.screenshot({ path: SCREENSHOT, fullPage: true });

await page.click('[data-sales-mode="table"]');
const tableText = await page.textContent(".ad-sales-table");
check("la vue tableau donne les mêmes montants",
      (await page.locator(".ad-sales-table tbody tr").count()) === 12 && tableText.includes("183,90") && tableText.includes("45,00"));
await page.click('[data-sales-mode="chart"]');
check("retour au graphique", await page.isVisible(".ad-chart-svg"));

const ranks = await page.textContent(".ad-sales-ranks");
check("classements des formats et des galeries",
      ranks.includes("Toile 40 × 50 cm") && ranks.includes("2 ex.") && ranks.indexOf("Mariage Martin") < ranks.indexOf("Séance Dupont") && !ranks.includes("Sans vente"));
await page.click(`.ad-rank a[href="#/g/${slugB}"]`);
await page.waitForFunction((s) => location.hash === `#/g/${s}`, slugB, { timeout: 5000 });
check("une galerie du classement mène à sa fiche", true);

await page.setViewportSize({ width: 375, height: 800 });
await page.goto(`${BASE}/#/ventes`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".ad-chart-svg", { timeout: 10000 });
check("sur téléphone, le graphique tient dans la largeur",
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 &&
        document.querySelector(".ad-chart-svg").getBoundingClientRect().right <= window.innerWidth));
if (SCREENSHOT) await page.screenshot({ path: SCREENSHOT.replace(/\.png$/, "-mobile.png"), fullPage: true });

check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

/* ---------- Nettoyage ---------- */

await browser.close();
for (const slug of [slugA, slugB, slugC]) await client.deleteGallery(slug).catch(() => {});
await d1(`DELETE FROM print_products WHERE id = '${product}'`);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
