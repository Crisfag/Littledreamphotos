// Onglet « Statistiques » dans un vrai navigateur, contre admin-server.mjs
// et un Worker local : type de séance à la création et sur la fiche,
// chiffres de la période (séances, photos choisies, suppléments, panier),
// points à retenir, séances par type, forfaits, séances devinées à classer
// (une par une ou toutes d'un coup), période, téléphone.
// SHOTS=<dossier> enregistre des captures.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/insights.test.mjs

import { chromium } from "playwright";
import { join } from "node:path";
import { WorkerClient } from "../lib/client.mjs";
import { createTestAccount, localSql } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const SHOTS = process.env.SHOTS || "";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

/* ---------- Séances de test : types, photos choisies, paiements ---------- */

const account = await createTestAccount(API, "statistiques");
const client = new WorkerClient({ api: API, ...account });
const RUN = Date.now().toString(36);
// [titre, type choisi, forfait, photos livrées, photos choisies, suppléments payés €, tirages €]
const SESSIONS = [
  ["Naissance de Léo", "", 10, 30, 14, 60, 0],
  ["Galerie Dupont", "naissance", 10, 25, 10, 0, 35],
  ["Naissance Martin", "", 15, 30, 18, 45, 0],
  ["Séance grossesse Emma", "", 10, 20, 12, 30, 0],
  ["Galerie Lambert", "grossesse", 10, 20, 10, 0, 0],
  ["Famille Rulmont", "famille", 15, 40, 15, 0, 25],
  ["Mini-séance de Noël", "", null, 12, 5, 0, 0],
];
const slugs = [];
for (const [i, [title, sessionType, included]] of SESSIONS.entries()) {
  const slug = `stats-${RUN}-${i}`;
  await client.createGallery({ slug, title, clientName: "Client " + i, password: "mot-de-passe-stats", includedPhotos: included ?? undefined, extraPhotoPrice: included ? 15 : undefined, sessionType: sessionType || undefined });
  slugs.push(slug);
}
const sql = [];
for (const [i, [, , , delivered, selected, supplement, prints]] of SESSIONS.entries()) {
  const gid = `(SELECT id FROM galleries WHERE slug = '${slugs[i]}')`;
  for (let p = 0; p < delivered; p++) {
    sql.push(`INSERT INTO photos (id, gallery_id, width, height, cols, rows, position, selected, created_at) VALUES ('ph_${RUN}_${i}_${p}', ${gid}, 1, 1, 1, 1, ${p}, ${p < selected ? 1 : 0}, strftime('%s','now'))`);
  }
  if (supplement) sql.push(`INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, status, kind, created_at, paid_at) VALUES ('pay_${RUN}_${i}s', ${gid}, 'cs_${RUN}_${i}s', ${supplement / 15}, ${supplement * 100}, 'paid', 'supplement', strftime('%s','now'), strftime('%s','now'))`);
  if (prints) sql.push(`INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, status, kind, created_at, paid_at) VALUES ('pay_${RUN}_${i}p', ${gid}, 'cs_${RUN}_${i}p', 0, ${prints * 100}, 'paid', 'print', strftime('%s','now'), strftime('%s','now'))`);
}
await localSql(API, sql.join("; "));

/* ---------- Navigateur ---------- */

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-login-form", { timeout: 10000 });
await page.fill('#ad-login-form [name="email"]', account.email);
await page.fill('#ad-login-form [name="password"]', account.password);
await page.click("#ad-login-submit");
await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });

// Type de séance proposé à la création.
await page.click("#ad-new-gallery");
await page.waitForSelector("#ad-create-modal:not([hidden])");
const createOptions = await page.$$eval('#ad-create-form [name="sessionType"] option', (o) => o.map((x) => x.textContent));
check("création : choix du type de séance, « deviné d'après le titre » par défaut", createOptions[0] === "Deviné d'après le titre" && createOptions.includes("Naissance") && createOptions.includes("Grossesse"));
await page.click("#ad-create-modal [data-close-modal]");

await page.click("#ad-tab-insights");
await page.waitForSelector(".ad-ins-bars", { timeout: 10000 });
const tiles = await page.$$eval(".ad-stats .ad-stat", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ")));
check("7 séances sur 12 mois", tiles[0].startsWith("7 Séances"), tiles[0]);
check("photos choisies en moyenne : 12 sur 25,3", tiles[1].includes("12") && tiles[1].includes("25,3"), tiles[1]);
check("séances avec suppléments : 50 % (3 sur 6 avec forfait)", tiles[2].startsWith("50"), tiles[2]);
check("panier moyen : 39 € (195 € sur 5 séances qui achètent)", tiles[3].includes("39,00") && tiles[3].includes("5 séances"), tiles[3]);

const highlights = await page.innerText(".ad-ins-highlights");
check("à retenir : naissance la plus demandée, famille la moins pratiquée, forfait 10 photos le plus fréquent",
      /La plus demandée\s+Naissance/.test(highlights) && /La moins pratiquée\s+(Famille|Mini-séance)/.test(highlights) && /Forfait le plus fréquent\s+10 photos/.test(highlights),
      highlights.replace(/\s+/g, " ").slice(0, 200));
const bars = await page.$$eval(".ad-ins-bars:first-of-type .ad-ins-bar-label", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ")));
check("séances par type : naissance en tête, avec la mention des types devinés", bars[0].startsWith("Naissance") && /deviné/.test(bars[0]), bars.join(" | "));
const packages = await page.innerText("section:has(> .ad-section-header h3:text('Forfaits'))").catch(() => "");
check("forfaits : 10 photos, 15 photos et sans forfait", packages.includes("10 photos") && packages.includes("15 photos") && packages.includes("Sans forfait"));
if (SHOTS) await page.screenshot({ path: join(SHOTS, "01-statistiques.png"), fullPage: true });

// Séances devinées : à classer, une par une ou toutes d'un coup.
const toClassify = await page.$$eval("#ad-ins-classify [data-ins-type]", (els) => els.map((e) => ({ slug: e.getAttribute("data-ins-type"), value: e.value })));
check("4 séances devinées à classer, type proposé (naissance, grossesse, mini-séance)",
      toClassify.length === 4 && toClassify.filter((t) => t.value === "naissance").length === 2 && toClassify.some((t) => t.value === "grossesse") && toClassify.some((t) => t.value === "mini"),
      toClassify.map((t) => t.value).join(", "));
await page.selectOption(`#ad-ins-classify [data-ins-type="${slugs[6]}"]`, "famille");
await page.waitForTimeout(1200);
check("corriger un type : la séance quitte la liste", await page.locator(`#ad-ins-classify [data-ins-type="${slugs[6]}"]`).count() === 0);
await page.click("#ad-ins-confirm-all");
await page.waitForTimeout(2000);
check("« Valider les types devinés » : plus rien à classer", await page.locator("#ad-ins-classify").count() === 0);
const detail = await client.getGallery(slugs[0]);
check("le type validé est enregistré sur la galerie", detail.gallery.session_type === "naissance", detail.gallery.session_type);

// Fiche galerie : le type se change aussi là.
await page.goto(`${BASE}/#/g/${slugs[5]}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-session-type", { timeout: 10000 });
check("fiche galerie : type de séance affiché", await page.inputValue("#ad-session-type") === "famille");
await page.selectOption("#ad-session-type", "enfant");
await page.waitForTimeout(800);
check("…et modifiable", (await client.getGallery(slugs[5])).gallery.session_type === "enfant");

// Période.
await page.click("#ad-tab-insights");
await page.waitForSelector(".ad-ins-bars", { timeout: 10000 });
await page.click('[data-ins-period="3m"]');
await page.waitForSelector('[data-ins-period="3m"][aria-pressed="true"]', { timeout: 10000 });
check("période « 3 mois » sélectionnée, séances toujours là (créées aujourd'hui)", (await page.innerText(".ad-stats")).startsWith("7"));

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("sur téléphone, l'onglet tient dans la largeur", overflow <= 1, overflow);
if (SHOTS) await page.screenshot({ path: join(SHOTS, "02-statistiques-mobile.png"), fullPage: true });
check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));

/* ---------- Nettoyage ---------- */

for (const slug of slugs) await client.deleteGallery(slug).catch(() => {});
await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
