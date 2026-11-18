// Fiche client complète, dans un vrai navigateur : ce qui a été créé sans
// e-mail rejoint le client du même nom, factures (automatiques et libres)
// avec leur PDF, règlements (moyen, détail), reste à régler, tirages
// commandés par un proche sur sa propre fiche, fiche sans e-mail à qui l'on
// donne une adresse. SHOTS=<dossier> enregistre des captures.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/fiche.test.mjs

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
const flat = (t) => String(t || "").replace(/[  ]/g, " ").replace(/\s+/g, " ");

const account = await createTestAccount(API, "fiche");
const client = new WorkerClient({ api: API, ...account });
const now = Math.floor(Date.now() / 1000);
const tag = Date.now().toString(36);
const P = `(SELECT id FROM photographers WHERE email = '${account.email}')`;
const G = (slug) => `(SELECT id FROM galleries WHERE slug = '${slug}')`;

// Sophie : une galerie avec e-mail, une autre créée avec son nom seul (mots inversés).
const sA = `sophie-a-${tag}`, sB = `sophie-b-${tag}`, sC = `dupont-${tag}`;
await client.createGallery({ slug: sA, title: "Séance famille au parc", clientName: "Sophie Martin", clientEmail: "sophie@example.com", password: "mot-de-passe-1" });
await client.createGallery({ slug: sB, title: "Mini-séance de Noël", clientName: "martin  sophie", password: "mot-de-passe-2" });
await client.createGallery({ slug: sC, title: "Baptême de Lucas", clientName: "Famille Dupont", password: "mot-de-passe-3" });
// Forfait de 10 photos à 5 € l'unité, 12 coups de cœur, sélection validée ; 1 supplément déjà réglé.
await localSql(API, `UPDATE galleries SET included_photos = 10, extra_photo_price_cents = 500, selection_done_at = ${now - 86400}, session_type = 'famille' WHERE slug = '${sA}'`);
const photoValues = Array.from({ length: 12 }, (_, i) => `('pho_f${i}_${tag}', ${G(sA)}, ${i}, 100, 100, 1, 1, 1, ${now})`).join(", ");
await localSql(API, `INSERT INTO photos (id, gallery_id, position, width, height, cols, rows, selected, created_at) VALUES ${photoValues}`);
await localSql(API, `INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, status, method, kind, created_at, paid_at)
  VALUES ('pay_s_${tag}', ${G(sA)}, 'cs_s_${tag}', 1, 500, 'paid', 'card', 'supplement', ${now - 3600}, ${now - 3600})`);
await localSql(API, `INSERT INTO invoices (id, photographer_id, gallery_id, payment_id, number, issued_at, amount_cents, net_amount_cents, client_name, created_at)
  VALUES ('inv_s_${tag}', ${P}, ${G(sA)}, 'pay_s_${tag}', '2026-0042', ${now - 3600}, 500, 500, 'Sophie Martin', ${now - 3600})`);
// Tirages commandés par la grand-mère, sur la galerie de Sophie.
await localSql(API, `INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, status, method, kind, created_at, paid_at)
  VALUES ('pay_p_${tag}', ${G(sA)}, 'cs_p_${tag}', 0, 4290, 'paid', 'card', 'print', ${now - 1800}, ${now - 1800})`);
await localSql(API, `INSERT INTO print_orders (id, gallery_id, photographer_id, payment_id, status, items, recipient, client_email, items_cents, shipping_cents, total_cents, created_at, paid_at, updated_at)
  VALUES ('ord_${tag}', ${G(sA)}, ${P}, 'pay_p_${tag}', 'shipped', '[{"photoId":"x","productId":"y","copies":3}]', '{}', 'mamie@example.com', 3700, 590, 4290, ${now - 1800}, ${now - 1800}, ${now})`);
// Suppléments de la mini-séance annoncés en espèces, pas encore reçus.
await localSql(API, `INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, status, method, kind, created_at)
  VALUES ('pay_w_${tag}', ${G(sB)}, 'offline_w_${tag}', 3, 1500, 'awaiting', 'cash', 'supplement', ${now - 600})`);
// Facture libre faite au nom de Sophie, sans e-mail, pas encore réglée.
await localSql(API, `INSERT INTO client_invoices (id, photographer_id, token, kind, number, status, client_name, client_email, title, lines, schedule, total_cents, issued_at, created_at, updated_at)
  VALUES ('cin_${tag}', ${P}, 'tok_${tag}', 'invoice', 'F-2026-007', 'issued', 'Sophie Martin', '', 'Album 30 × 30', '[]', '[]', 30000, ${now - 7200}, ${now - 7200}, ${now - 7200})`);

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: "block" });
const page = await context.newPage();
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + ".png"), fullPage: true }); };

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.fill('#ad-login-form [name="email"]', account.email);
  await page.fill('#ad-login-form [name="password"]', account.password);
  await page.click("#ad-login-submit");
  await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });

  /* ---------- Liste ---------- */

  await page.click("#ad-tab-clients");
  await page.waitForSelector("#ad-cl-rows", { timeout: 10000 });
  const keys = await page.locator("#ad-cl-rows tr[data-cl-email]").evaluateAll((r) => r.map((x) => x.dataset.clEmail));
  check("trois fiches : Sophie (ses deux galeries), la grand-mère, les Dupont sans e-mail",
        keys.length === 3 && keys.includes("sophie@example.com") && keys.includes("mamie@example.com") && keys.some((k) => k.startsWith("~")), keys.join(", "));
  const sophieRow = flat(await page.locator('#ad-cl-rows tr[data-cl-email="sophie@example.com"]').innerText());
  check("liste : deux séances et le même reste à régler que la fiche (320 €)", / 2 /.test(" " + sophieRow + " ") && /320,00 € à régler/.test(sophieRow), sophieRow);
  check("liste : les Dupont, « Sans adresse e-mail »", /Famille Dupont Sans adresse e-mail/.test(flat(await page.locator('#ad-cl-rows tr[data-cl-email^="~"]').innerText())));

  /* ---------- Fiche de Sophie ---------- */

  await page.click('#ad-cl-rows tr[data-cl-email="sophie@example.com"]');
  await page.waitForSelector(".ad-cl-tabs");
  const stats = flat(await page.locator(".ad-stats").innerText());
  check("chiffres : 2 séances, 5,00 € encaissés, 320,00 € à régler", /2\s*Séances/.test(stats) && /5,00 €\s*Encaissé/.test(stats) && /320,00 €\s*Reste à régler/.test(stats), stats);
  check("ce qui a été rattaché par le nom est signalé", /2 éléments créés sans e-mail, rattachés à ce client par son nom/.test(flat(await page.textContent(".ad-cl-byname"))));
  const due = flat(await page.locator(".ad-cl-due").innerText());
  check("à régler : 1 photo en supplément, les espèces annoncées, la facture ouverte",
        /1 photo en supplément/.test(due) && /5,00 €/.test(due) && /annoncé en espèces/.test(due) && /15,00 €/.test(due) && /Facture F-2026-007/.test(due) && /300,00 €/.test(due), due);
  const sessions = flat(await page.locator(".ad-cl-sessions").innerText());
  check("dernières séances : les deux galeries, type de séance, coups de cœur, état",
        /Séance famille au parc/.test(sessions) && /Famille · 12 photos · 12 coups de cœur/.test(sessions) && /5,00 € à régler/.test(sessions) &&
        /Mini-séance de Noël/.test(sessions) && /rattachée par le nom/.test(sessions), sessions);
  await shot("fiche-vue");

  await page.click('[data-cl-tab="billing"]');
  const billing = page.locator(".ad-cl-ledger tbody tr");
  const billingText = flat(await page.locator(".ad-cl-ledger").innerText());
  check("factures : l'automatique des suppléments et la libre, avec leur statut", (await billing.count()) === 2 &&
        /2026-0042/.test(billingText) && /Suppléments · Séance famille au parc/.test(billingText) && /Réglée/.test(billingText) &&
        /F-2026-007/.test(billingText) && /Album 30 × 30/.test(billingText) && /À régler/.test(billingText), billingText);
  const pdfs = await page.locator(".ad-cl-ledger a", { hasText: "PDF" }).evaluateAll((a) => a.map((x) => x.getAttribute("href")));
  check("chaque facture a son PDF", pdfs.includes(`/local/invoices/inv_s_${tag}`) && pdfs.includes(`/local/client-invoices/cin_${tag}/pdf`), pdfs.join(" "));
  await shot("fiche-factures");

  await page.click('[data-cl-tab="paid"]');
  const paid = flat(await page.locator(".ad-cl-ledger").innerText());
  check("règlements : le supplément payé par carte, sans les tirages de la grand-mère",
        (await page.locator(".ad-cl-ledger tbody tr").count()) === 1 && /Suppléments/.test(paid) && /1 photo/.test(paid) && /carte/.test(paid) && !/Tirages/.test(paid), paid);
  check("l'onglet garde son choix, la page se recharge sans erreur", (await page.getAttribute('[data-cl-tab="paid"]', "aria-selected")) === "true");

  /* ---------- Fiche de la grand-mère ---------- */

  await page.goto(`${BASE}/#/clients/mamie@example.com`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".ad-cl-tabs");
  await page.click('[data-cl-tab="paid"]');
  const mamie = flat(await page.locator(".ad-cl-ledger").innerText());
  check("la grand-mère : ses 3 tirages, expédiés, sur sa propre fiche", /Tirages/.test(mamie) && /3 tirages/.test(mamie) && /Expédiée/.test(mamie) && /42,90 €/.test(mamie), mamie);

  /* ---------- Fiche sans e-mail : on lui donne une adresse ---------- */

  await page.click("#ad-tab-clients");
  await page.waitForSelector("#ad-cl-rows");
  await page.click('#ad-cl-rows tr[data-cl-email^="~"]');
  await page.waitForSelector("#ad-cl-attach");
  check("fiche sans e-mail : ni « Écrire » ni notes, un formulaire pour l'adresse",
        !(await page.$('.ad-cl-head-actions a[href^="mailto:"]')) && !(await page.$("#ad-cl-notes")) && /Sans adresse e-mail/.test(await page.textContent(".ad-cl-contact")));
  await shot("fiche-sans-email");
  await page.fill("#ad-cl-attach [name=email]", "Dupont@Example.com");
  await page.click("#ad-cl-attach button[type=submit]");
  await page.waitForFunction(() => decodeURIComponent(location.hash) === "#/clients/dupont@example.com", null, { timeout: 10000 });
  await page.waitForSelector("#ad-cl-notes");
  check("adresse ajoutée : la fiche devient complète (e-mail, notes, galerie)",
        /dupont@example.com/.test(await page.textContent(".ad-cl-contact")) && /Baptême de Lucas/.test(await page.textContent(".ad-cl-sessions")));
  const stored = await page.evaluate(async (s) => (await (await fetch(`/local/galleries/${s}`)).json()).gallery.client_email, sC);
  check("la galerie des Dupont porte maintenant l'adresse", stored === "dupont@example.com", stored);

  // Téléphone : rien ne déborde.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/#/clients/sophie@example.com`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".ad-cl-tabs");
  await page.click('[data-cl-tab="billing"]');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : pas de débordement horizontal", overflow <= 1, overflow + " px");
  await shot("fiche-mobile");
} catch (err) {
  check("déroulé sans exception", false, err.message);
}

check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
await browser.close();
for (const s of [sA, sB, sC]) await client.deleteGallery(s).catch(() => {});

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
