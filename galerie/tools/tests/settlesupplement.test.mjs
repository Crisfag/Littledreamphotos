// Suppléments réglés hors galerie, dans un vrai navigateur : l'onglet
// Facturation liste tous les suppléments en attente de règlement (où en est
// chaque client), et « Réglé par virement » / « Réglé en espèces » les
// passent en réglé — facture émise — depuis ce tableau comme depuis la
// fiche de la galerie.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/settlesupplement.test.mjs

import { chromium } from "playwright";
import { join } from "node:path";
import { WorkerClient } from "../lib/client.mjs";
import { createTestAccount, localSql } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const SHOTS = process.env.SCREENSHOT_DIR || "";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const account = await createTestAccount(API, "reglement");
const client = new WorkerClient({ api: API, ...account });
const RUN = Date.now().toString(36);
const slugs = { martin: `martin-${RUN}`, dupont: `dupont-${RUN}`, leroy: `leroy-${RUN}` };
await client.createGallery({ slug: slugs.martin, title: "Famille Martin", clientName: "Léa Martin", clientEmail: "lea@client.invalid", password: "mot-de-passe-m" });
await client.createGallery({ slug: slugs.dupont, title: "Noël Dupont", clientName: "Paul Dupont", clientEmail: "paul@client.invalid", password: "mot-de-passe-d" });
await client.createGallery({ slug: slugs.leroy, title: "Mariage Leroy", clientName: "", password: "mot-de-passe-l" });
for (const slug of Object.values(slugs)) await client.setQuota(slug, 2, 15);

// Coups de cœur du client : 5, 4 et 3 photos choisies (forfait de 2).
const selected = { martin: 5, dupont: 4, leroy: 3 };
const ts = Math.floor(Date.now() / 1000);
const rows = [];
for (const [key, n] of Object.entries(selected)) {
  for (let i = 0; i < 6; i++) {
    rows.push(`('ph_${RUN}_${key}_${i}', (SELECT id FROM galleries WHERE slug = '${slugs[key]}'), 100, 100, 1, 1, ${i}, ${i < n ? 1 : 0}, ${ts})`);
  }
}
await localSql(API, `INSERT INTO photos (id, gallery_id, width, height, cols, rows, position, selected, created_at) VALUES ${rows.join(", ")}`);
// Noël Dupont a demandé à payer par virement depuis sa galerie.
await localSql(API, `INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, status, kind, method, created_at)
  VALUES ('pay_req_${RUN}', (SELECT id FROM galleries WHERE slug = '${slugs.dupont}'), 'offline_pay_req_${RUN}', 2, 3000, 'awaiting', 'supplement', 'transfer', ${ts})`);

const browser = await chromium.launch({ ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
const dialogs = [];
page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const due = async (slug) => (await client.getGallery(slug)).gallery.due_extra_count;

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.fill('#ad-login-form [name="email"]', account.email);
  await page.fill('#ad-login-form [name="password"]', account.password);
  await page.click("#ad-login-submit");
  await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });

  /* ---------- Le tableau de la Facturation ---------- */

  await page.goto(`${BASE}/#/facturation`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".ad-due-table", { timeout: 15000 });
  const rowText = async (title) => (await page.locator(".ad-due-table tbody tr", { hasText: title }).innerText()).replace(/\s+/g, " ");
  check("3 suppléments en attente, total 90 €", (await page.locator(".ad-due-table tbody tr").count()) === 3 && /90,00 €/.test(await page.textContent("#ad-due .ad-quota-due")));
  const martinRow = await rowText("Famille Martin");
  check("ligne : galerie, client, 45 € = 3 photos × 15 €", /Léa Martin/.test(martinRow) && /45,00 €/.test(martinRow) && /3 photos × 15,00 €/.test(martinRow), martinRow);
  check("demande de virement du client : signalée", /A demandé à payer par virement/.test(await rowText("Noël Dupont")));
  check("deux boutons par ligne : Réglé par virement, Réglé en espèces",
        (await page.locator(".ad-due-table [data-settle=transfer]").count()) === 3 && (await page.locator(".ad-due-table [data-settle=cash]").count()) === 3);
  if (SHOTS) await page.locator("#ad-due").screenshot({ path: join(SHOTS, "supplements-dus.png") });

  // Martin a viré sur le compte du studio, par habitude.
  await page.locator(".ad-due-table tbody tr", { hasText: "Famille Martin" }).locator("[data-settle=transfer]").click();
  await page.waitForFunction(() => /Supplément réglé par virement/.test(document.querySelector(".ad-toast")?.textContent || ""), null, { timeout: 30000 });
  check("confirmation demandée avec montant et destinataire de la facture",
        /Famille Martin/.test(dialogs[0] || "") && /45,00 €/.test(dialogs[0] || "") && /lea@client\.invalid/.test(dialogs[0] || ""), dialogs[0]);
  check("annonce : facture envoyée au client", /facture \S+ envoyée à lea@client\.invalid/.test(await page.textContent(".ad-toast")), await page.textContent(".ad-toast"));
  await page.waitForFunction(() => document.querySelectorAll(".ad-due-table tbody tr").length === 2, null, { timeout: 15000 });
  check("la ligne disparaît du tableau, le total suit (45 €)", /45,00 €/.test(await page.textContent("#ad-due .ad-quota-due")));
  check("côté serveur : plus rien de dû sur Famille Martin", (await due(slugs.martin)) === 0);
  const invoices = (await client.listInvoices()).invoices;
  check("la facture apparaît dans l'historique des factures", invoices.length === 1 && invoices[0].amount_cents === 4500);

  // Dupont avait demandé le virement, finalement payé en espèces.
  await page.locator(".ad-due-table tbody tr", { hasText: "Noël Dupont" }).locator("[data-settle=cash]").click();
  await page.waitForFunction(() => document.querySelectorAll(".ad-due-table tbody tr").length === 1, null, { timeout: 30000 });
  const dupont = await client.getGallery(slugs.dupont);
  check("« Réglé en espèces » : réglé, la demande de virement n'attend plus",
        dupont.gallery.due_extra_count === 0 && !dupont.payments.some((p) => p.status === "awaiting") && dupont.payments.some((p) => p.status === "paid" && p.method === "cash"));

  /* ---------- Même chose depuis la fiche de la galerie ---------- */

  await page.goto(`${BASE}/#/g/${slugs.leroy}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-quota-summary", { timeout: 10000 });
  check("fiche galerie : « Déjà réglé directement avec vous ? » et les deux boutons",
        /Déjà réglé directement avec vous/.test(await page.textContent("#ad-quota-summary")) && (await page.locator("#ad-quota-summary [data-settle]").count()) === 2);
  await page.click("#ad-quota-summary [data-settle=cash]");
  check("sans e-mail client : la confirmation le dit", /aucune adresse e-mail client/.test(dialogs.at(-1) || ""), dialogs.at(-1));
  await page.waitForFunction(() => /déjà réglé/.test(document.getElementById("ad-quota-summary")?.textContent || ""), null, { timeout: 30000 });
  check("fiche : supplément réglé, boutons partis, « Réglé en espèces » dans l'historique",
        (await page.locator("#ad-quota-summary [data-settle]").count()) === 0 && /Réglé en espèces/.test(await page.textContent(".ad-quota")));

  await page.goto(`${BASE}/#/facturation`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => /Aucun supplément en attente/.test(document.getElementById("ad-due")?.textContent || ""), null, { timeout: 15000 });
  check("tout est réglé : le tableau l'annonce", true);

  // Téléphone : une carte par galerie, pas de défilement de côté.
  await localSql(API, `UPDATE photos SET selected = 1 WHERE gallery_id = (SELECT id FROM galleries WHERE slug = '${slugs.martin}')`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/#/facturation`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".ad-due-table", { timeout: 15000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : le tableau tient dans l'écran", overflow <= 0, `${overflow}px`);
  if (SHOTS) await page.locator("#ad-due").screenshot({ path: join(SHOTS, "supplements-dus-mobile.png") });

  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} finally {
  await browser.close();
  for (const slug of Object.values(slugs)) await client.deleteGallery(slug).catch(() => {});
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
