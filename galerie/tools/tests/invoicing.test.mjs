// Facturation libre, relances et fiches clients, dans de vrais navigateurs
// contre le Worker local : le photographe rédige une facture (lignes à 21 %
// et à 6 % pour la cession de droits, échéancier acompte + solde), l'émet ;
// le client la lit sur sa page (TVA, échéances, virement) ; le photographe
// note l'acompte reçu, annule par une note de crédit, facture un contrat
// signé d'un clic ; une demande reçue par le portfolio devient un prospect,
// qu'on tague et qu'on filtre ; l'onglet Ventes compte la facture.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/invoicing.test.mjs

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../lib/client.mjs";
import { createTestAccount, localSql } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web");
const SITE_PORT = Number(process.env.SITE_PORT || 8000);
const SHOTS = process.env.SCREENSHOT_DIR || "";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const account = await createTestAccount(API, "facturation");
const client = new WorkerClient({ api: API, ...account });
const RUN = Date.now().toString(36);
await client.request("POST", "/api/admin/billing", { companyName: "Julie SRL", address: "Rue des Fleurs 1\n4000 Liège", vatNumber: "BE0123456789", iban: "be68539007547034" });
const me = await client.request("GET", "/api/auth/me").catch(() => null);
check("IBAN enregistré et mis en forme par groupes de 4", !me || me.photographer.billingIban === "BE68 5390 0754 7034", me && me.photographer.billingIban);
const badIban = await fetch(`${API}/api/admin/billing`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${client.token}` },
  body: JSON.stringify({ companyName: "Julie SRL", address: "x", vatNumber: "BE0123456789", iban: "12" }),
});
check("IBAN illisible refusé", badIban.status === 400);

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
await new Promise((resolve, reject) => { site.once("error", reject); site.listen(SITE_PORT, "localhost", resolve); });

const browser = await chromium.launch({ ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}), args: ["--disable-features=LocalNetworkAccessChecks"] });
const exceptions = [];
const admin = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
admin.on("pageerror", (err) => exceptions.push("admin: " + String(err)));
await admin.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

try {
  await admin.goto(BASE, { waitUntil: "domcontentloaded" });
  await admin.fill('#ad-login-form [name="email"]', account.email);
  await admin.fill('#ad-login-form [name="password"]', account.password);
  await admin.click("#ad-login-submit");
  await admin.waitForSelector("#ad-new-gallery", { timeout: 10000 });

  /* ---------- Rédiger et émettre une facture ---------- */

  await admin.click("#ad-tab-billing");
  await admin.waitForSelector("#ad-ci-new", { timeout: 10000 });
  await admin.click("#ad-ci-new");
  await admin.fill('#ad-ci-form [name="clientName"]', "Famille Rulmont");
  await admin.fill('#ad-ci-form [name="clientEmail"]', `rulmont-${RUN}@test.invalid`);
  await admin.fill('#ad-ci-form [name="clientAddress"]', "Rue Haute 5\n1000 Bruxelles");
  await admin.fill('#ad-ci-form [name="title"]', "Séance famille du 12 décembre");
  const row0 = admin.locator(".ad-ci-line").first();
  await row0.locator(".ad-ci-desc").fill("Séance famille, 1 h 30");
  await row0.locator(".ad-ci-unit").fill("250");
  await admin.click("#ad-ci-add-line");
  const row1 = admin.locator(".ad-ci-line").nth(1);
  await row1.locator(".ad-ci-desc").fill("Cession de droits d'auteur, usage privé");
  await row1.locator(".ad-ci-unit").fill("106");
  await row1.locator(".ad-ci-vat").selectOption("6");
  const vatOptions = await row1.locator(".ad-ci-vat option").allTextContents();
  check("taux proposés : 21, 12, 6 (cession de droits d'auteur) et 0 %", vatOptions.join("|") === "21 %|12 %|6 % (cession de droits d'auteur)|0 %", vatOptions.join("|"));
  check("total calculé en direct, TVA comprise", /356,00/.test(await admin.textContent("#ad-ci-totals")) && /dont TVA/.test(await admin.textContent("#ad-ci-totals")), await admin.textContent("#ad-ci-totals"));
  await admin.check('#ad-ci-form [name="payMode"][value="schedule"]');
  await admin.waitForFunction(() => document.querySelectorAll(".ad-ci-step").length === 2);
  check("échéancier : acompte 30 % + solde, et la somme est vérifiée",
        (await admin.inputValue(".ad-ci-step:first-child .ad-ci-step-amount")) === "106,80" && /✓/.test(await admin.textContent("#ad-ci-steps-sum")),
        await admin.textContent("#ad-ci-steps-sum"));
  if (SHOTS) await admin.locator("#ad-ci-editor").screenshot({ path: join(SHOTS, "fac-01-editeur.png") });
  await admin.click('[data-ci-submit="send"]');
  await admin.waitForSelector(".ad-ci-table tbody tr", { timeout: 10000 });
  let list = await client.request("GET", "/api/admin/client-invoices");
  const inv = list.invoices[0];
  check("facture émise : numéro de la série, deux échéances, 356 € TTC dont 6 € de TVA à 6 %",
        /^\d{4}-\d{4}$/.test(inv.number) && inv.schedule.length === 2 && inv.totalCents === 35600 && inv.breakdown.find((b) => b.rate === 6).vatCents === 600, inv.number);
  check("la liste affiche la facture « À régler » avec la prochaine échéance",
        /À régler/.test(await admin.textContent(".ad-ci-table")) && /106,80/.test(await admin.textContent(".ad-ci-table")));

  /* ---------- Page du client ---------- */

  const token = new URL(inv.pageUrl).searchParams.get("t");
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  page.on("pageerror", (err) => exceptions.push("facture: " + String(err)));
  await page.goto(`http://localhost:${SITE_PORT}/facture?t=${token}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#fa-page:not([hidden])", { timeout: 15000 });
  check("page client : objet, émetteur avec TVA, client, deux lignes",
        (await page.textContent("#fa-title")) === "Séance famille du 12 décembre" && /BE0123456789/.test(await page.textContent("#fa-seller-lines")) &&
        (await page.locator("#fa-lines tr").count()) === 2);
  check("totaux : HT, TVA 21 %, TVA 6 %, TTC", /TVA 21/.test(await page.textContent("#fa-totals")) && /TVA 6/.test(await page.textContent("#fa-totals")) && /356,00/.test(await page.textContent("#fa-totals")));
  check("échéancier et virement (IBAN, communication) ; pas de paiement en ligne sans Stripe",
        (await page.locator("#fa-schedule li").count()) === 2 && /BE68 5390 0754 7034/.test(await page.textContent("#fa-iban")) && await page.isHidden("#fa-pay"));
  const pdf = await page.evaluate(async () => { const r = await fetch(document.getElementById("fa-pdf").href); return { s: r.status, t: r.headers.get("content-type") }; });
  check("PDF téléchargeable depuis la page", pdf.s === 200 && pdf.t === "application/pdf", JSON.stringify(pdf));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "fac-02-page-client.png"), fullPage: true });

  /* ---------- Paiement noté, note de crédit ---------- */

  await admin.click(`[data-ci-paid="${inv.id}"]`);
  await admin.waitForFunction(() => /Acompte reçu/.test(document.querySelector(".ad-ci-table").textContent), null, { timeout: 10000 });
  check("« Acompte reçu » noté : la facture reste due pour le solde", (await client.request("GET", "/api/admin/client-invoices")).invoices[0].paidCents === 10680);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#fa-page:not([hidden])");
  check("…et le client voit l'acompte réglé", /Réglé le/.test(await page.textContent("#fa-schedule")));
  await admin.click(`[data-ci-credit="${inv.id}"]`);
  await admin.click(`[data-ci-credit="${inv.id}"]`);
  await admin.waitForFunction(() => /Note de crédit/.test(document.querySelector(".ad-ci-table").textContent) && /Annulée/.test(document.querySelector(".ad-ci-table").textContent), null, { timeout: 10000 });
  list = await client.request("GET", "/api/admin/client-invoices");
  check("note de crédit (double clic de confirmation) : facture annulée, crédit au numéro suivant",
        list.invoices.some((f) => f.kind === "credit" && f.totalCents === -35600) && list.invoices.find((f) => f.id === inv.id).status === "credited");

  /* ---------- Facturer un contrat signé ---------- */

  const ts = Math.floor(Date.now() / 1000);
  const sessionDay = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
  await localSql(API, `INSERT INTO contracts (id, photographer_id, token, number, status, studio_name, client_name, client_email, title, session_day, lines, total_cents, deposit_cents, signed_at, paid_at, created_at, updated_at)
    VALUES ('ctr_${RUN}', (SELECT id FROM photographers WHERE email = '${account.email}'), 'tok_${RUN}', '2026-001', 'paid', 'Studio', 'Emma Martin', 'emma-${RUN}@test.invalid', 'Mariage Emma & Tom', '${sessionDay}',
      '[{"label":"Reportage mariage","amountCents":200000},{"label":"Album 30×30","amountCents":40000}]', 240000, 72000, ${ts}, ${ts}, ${ts}, ${ts})`);
  await admin.click("#ad-tab-contracts");
  await admin.waitForSelector('[data-invoice-from="contract"]', { timeout: 10000 });
  await admin.click('[data-invoice-from="contract"]');
  await admin.waitForSelector("#ad-ci-form", { timeout: 10000 });
  check("« Facturer » un contrat : la facture s'ouvre préremplie (client, lignes, acompte réglé, solde le jour J)",
        (await admin.inputValue('#ad-ci-form [name="clientName"]')) === "Emma Martin" && (await admin.locator(".ad-ci-line").count()) === 2 &&
        (await admin.locator(".ad-ci-step").count()) === 2 && (await admin.locator(".ad-ci-step [data-paid-at]").count()) === 1 &&
        (await admin.inputValue(".ad-ci-step:last-child .ad-ci-step-date")) === sessionDay);
  await admin.click('[data-ci-submit="issue"]');
  await admin.waitForFunction(() => !document.getElementById("ad-ci-form"), null, { timeout: 10000 });
  list = await client.request("GET", "/api/admin/client-invoices");
  const fromContract = list.invoices.find((f) => f.source === "contract");
  check("…émise : acompte déjà réglé, 1 680 € de solde", fromContract && fromContract.status === "partial" && fromContract.totalCents - fromContract.paidCents === 168000);

  /* ---------- Prospects et tags ---------- */

  await localSql(API, `INSERT INTO portfolio_messages (id, photographer_id, name, email, phone, event_date, message, ip_hash, created_at)
    VALUES ('msg_${RUN}', (SELECT id FROM photographers WHERE email = '${account.email}'), 'Nora', 'nora-${RUN}@test.invalid', '', 'juin 2027', 'Bonjour, je me marie en juin 2027 !', 'h', ${ts})`);
  await admin.click("#ad-tab-clients");
  await admin.waitForSelector('[data-cl-filter="prospects"]', { timeout: 10000 });
  check("filtre « Prospects (1) »", /Prospects \(1\)/.test(await admin.textContent('[data-cl-filter="prospects"]')));
  await admin.click('[data-cl-filter="prospects"]');
  const prospects = await admin.$$eval("#ad-cl-rows tr", (rows) => rows.map((r) => r.innerText.replace(/\s+/g, " ")));
  check("la demande du portfolio est un prospect ; Emma (contrat payé) n'en est pas un",
        prospects.length === 1 && /Nora/.test(prospects[0]) && /Prospect/.test(prospects[0]), prospects.join(" | "));
  await admin.click("#ad-cl-rows tr");
  await admin.waitForSelector("#ad-cl-tag-form", { timeout: 10000 });
  check("fiche du prospect : la demande dans l'historique", /me marie en juin/.test(await admin.textContent(".ad-cl-history")));
  await admin.fill('#ad-cl-tag-form [name="tag"]', "mariage");
  await admin.press('#ad-cl-tag-form [name="tag"]', "Enter");
  await admin.waitForSelector('[data-cl-untag="mariage"]', { timeout: 10000 });
  await admin.fill('#ad-cl-tag-form [name="tag"]', "salon 2027");
  await admin.press('#ad-cl-tag-form [name="tag"]', "Enter");
  await admin.waitForSelector('[data-cl-untag="salon 2027"]', { timeout: 10000 });
  check("deux tags posés", (await admin.locator("#ad-cl-tags .ad-cl-tag").count()) === 2);
  if (SHOTS) await admin.screenshot({ path: join(SHOTS, "fac-03-fiche-prospect.png"), fullPage: true });
  await admin.click("#ad-cl-back");
  await admin.waitForSelector('[data-cl-tag="mariage"]', { timeout: 10000 });
  await admin.click('[data-cl-filter="all"]');
  await admin.click('[data-cl-tag="mariage"]');
  const tagged = await admin.$$eval("#ad-cl-rows tr", (rows) => rows.map((r) => r.innerText.replace(/\s+/g, " ")));
  check("filtre par tag « mariage » : seule Nora", tagged.length === 1 && /Nora/.test(tagged[0]), tagged.join(" | "));

  /* ---------- Ventes ---------- */

  await admin.click("#ad-tab-sales");
  await admin.waitForSelector(".ad-stats", { timeout: 10000 });
  const salesText = await admin.innerText("#ad-view");
  check("Ventes : l'acompte du contrat compté une seule fois (720 €), même repris dans la facture",
        /720 € séances/.test(salesText.replace(/\u202f|\u00a0/g, " ")) && /Séances et factures/.test(salesText), salesText.slice(0, 260).replace(/\s+/g, " "));

  await admin.setViewportSize({ width: 390, height: 844 });
  await admin.click("#ad-tab-billing").catch(() => {});
  await admin.evaluate(() => { location.hash = "#/facturation"; });
  await admin.waitForSelector(".ad-ci-table", { timeout: 10000 });
  await admin.waitForTimeout(300);
  check("onglet Facturation sur téléphone : pas de défilement horizontal de la page", await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
} finally {
  check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));
  await browser.close();
  site.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
