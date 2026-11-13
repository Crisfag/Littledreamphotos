// Modèles de contrat, dans un vrai navigateur : le photographe crée ses
// modèles à partir des exemples (naissance, mariage…), en attache un à une
// formule ; depuis la réservation, le contrat proposé est celui de la
// formule, avec son acompte suggéré, et peut être changé avant l'envoi.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/modelescontrat.test.mjs

import { chromium } from "playwright";
import { WorkerClient } from "../lib/client.mjs";
import { createTestAccount } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const SHOTS = process.env.SCREENSHOT_DIR || "";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}
function dayAhead(days) {
  return new Date(Date.now() + days * 86400000).toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
}

const account = await createTestAccount(API, "modeles");
const client = new WorkerClient({ api: API, ...account });
const other = new WorkerClient({ api: API, ...(await createTestAccount(API, "modeles-autre")) });
const CAMILLE = `camille.${Date.now().toString(36)}@test.invalid`;

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
async function toastText() {
  await page.waitForSelector(".ad-toast", { timeout: 10000 });
  return page.locator(".ad-toast").last().textContent();
}

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.fill('#ad-login-form [name="email"]', account.email);
  await page.fill('#ad-login-form [name="password"]', account.password);
  await page.click("#ad-login-submit");
  await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });

  /* ---------- Créer ses modèles à partir des exemples ---------- */
  await page.click("#ad-tab-contracts");
  await page.waitForSelector("#ad-ctt", { timeout: 10000 });
  check("onglet Devis et contrats : exemples proposés (grossesse, naissance, mariage, mini-séance)",
        (await page.locator("[data-ctt-starter]").count()) === 4);
  await page.click('[data-ctt-starter="Séance naissance"]');
  await page.waitForSelector("#ad-ctt-form");
  const terms = await page.inputValue('#ad-ctt-form [name="terms"]');
  check("exemple naissance : nom, acompte 30 %, conditions du studio + article propre",
        (await page.inputValue('#ad-ctt-form [name="name"]')) === "Séance naissance" && (await page.inputValue('#ad-ctt-form [name="depositPercent"]')) === "30" &&
        terms.startsWith("1. Objet") && /\n8\. Séance naissance\nLa séance a lieu de préférence/.test(terms), terms.slice(-200));
  if (SHOTS) await page.locator("#ad-ctt").screenshot({ path: `${SHOTS}/modeles-form.png` });
  await page.click('#ad-ctt-form [type="submit"]');
  await toastText();
  await page.waitForSelector(".ad-ctt-item");
  await page.click('[data-ctt-starter="Mariage"]');
  await page.fill('#ad-ctt-form [name="depositPercent"]', "40");
  await page.click('#ad-ctt-form [type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll(".ad-ctt-item").length === 2);
  check("deux modèles, l'exemple déjà utilisé n'est plus proposé",
        (await page.locator(".ad-ctt-item").allTextContents()).join("|").includes("Acompte suggéré : 40 %") &&
        (await page.locator('[data-ctt-starter="Séance naissance"]').count()) === 0);
  if (SHOTS) await page.locator("#ad-ctt").screenshot({ path: `${SHOTS}/modeles-liste.png` });

  let contracts = await client.request("GET", "/api/admin/contracts");
  const birthTpl = contracts.templates.find((t) => t.name === "Séance naissance");
  const weddingTpl = contracts.templates.find((t) => t.name === "Mariage");
  const bad = await client.request("POST", "/api/admin/contracts/templates", { name: "X", terms: "x".repeat(40), depositPercent: 150 }).catch((err) => err);
  check("acompte suggéré > 100 % refusé (400)", bad.status === 400, bad.message);
  const foreign = await other.request("POST", `/api/admin/contracts/templates/${birthTpl.id}`, { name: "Volé", terms: "x".repeat(40) }).catch((err) => err);
  check("le modèle d'un autre photographe est introuvable (404)", foreign.status === 404);

  /* ---------- Éditeur de devis : choisir un modèle ---------- */
  await page.click("#ad-ct-new");
  await page.waitForSelector("#ad-ct-form");
  await page.fill("#ad-ct-form .ad-ct-line-amount", "1500");
  await page.selectOption('#ad-ct-form [name="template"]', weddingTpl.id);
  check("éditeur : le modèle remplit les conditions et l'acompte suggéré (40 % de 1 500 €)",
        (await page.inputValue('#ad-ct-form [name="terms"]')).includes("Mariage\nLe photographe est présent") && (await page.inputValue('#ad-ct-form [name="deposit"]')) === "600");
  await page.click("#ad-ct-cancel");

  /* ---------- Formule : son modèle de contrat ---------- */
  let admin = await client.request("POST", "/api/admin/booking/offers", { title: "Séance naissance", durationMin: 90, priceCents: 18000, depositCents: 0, contractTemplateId: birthTpl.id });
  const offer = admin.offers.find((o) => o.title === "Séance naissance");
  check("formule : modèle « Séance naissance » attaché", offer.contractTemplateId === birthTpl.id);
  const wrong = await other.request("POST", "/api/admin/booking/offers", { title: "Test", durationMin: 30, contractTemplateId: birthTpl.id }).catch((err) => err);
  check("une formule ne peut pas prendre le modèle d'un autre (400)", wrong.status === 400, wrong.message);
  admin = await client.request("POST", "/api/admin/booking/slots", { offerIds: [offer.id], date: dayAhead(10), times: ["10:00"] });
  admin = await client.request("POST", `/api/admin/booking/slots/${admin.slots[0].id}/book`, { name: "Camille Dubois", email: CAMILLE, notify: false });
  const booking = admin.bookings.find((b) => b.clientEmail === CAMILLE);

  await page.click("#ad-tab-booking");
  await page.waitForSelector(".ad-bk-session", { timeout: 10000 });
  await page.click(`[data-booking="${booking.id}"] [data-flow="contract"]`);
  await page.waitForSelector('.ad-flow-panel [name="template"]');
  check("depuis la réservation : modèle de la formule proposé, acompte 30 % (54 €)",
        (await page.inputValue('.ad-flow-panel [name="template"]')) === birthTpl.id && (await page.inputValue('.ad-flow-panel [name="deposit"]')) === "54");
  await page.selectOption('.ad-flow-panel [name="template"]', weddingTpl.id);
  check("changer de modèle recalcule l'acompte (40 % → 72 €)", (await page.inputValue('.ad-flow-panel [name="deposit"]')) === "72");
  await page.selectOption('.ad-flow-panel [name="template"]', birthTpl.id);
  if (SHOTS) await page.locator(`[data-booking="${booking.id}"]`).screenshot({ path: `${SHOTS}/modeles-envoi.png` });
  await page.click('.ad-flow-panel [type="submit"]');
  const sentToast = await page.waitForFunction(() => /Contrat envoyé/.test(document.body.innerText), null, { timeout: 10000 }).then(() => true, () => false);
  check("contrat envoyé", sentToast);
  contracts = await client.request("GET", "/api/admin/contracts");
  const sent = contracts.contracts.find((c) => c.clientEmail === CAMILLE);
  check("le contrat reprend les conditions du modèle naissance et l'acompte de 54 €",
        sent && sent.terms.includes("Séance naissance\nLa séance a lieu de préférence") && sent.depositCents === 5400 && sent.status === "sent", sent && String(sent.depositCents));

  /* ---------- Supprimer un modèle ---------- */
  await client.request("DELETE", `/api/admin/contracts/templates/${birthTpl.id}`);
  admin = await client.request("GET", "/api/admin/booking");
  check("modèle supprimé : la formule revient aux conditions par défaut, le contrat envoyé garde son texte",
        admin.offers.find((o) => o.id === offer.id).contractTemplateId === "" &&
        (await client.request("GET", "/api/admin/contracts")).contracts.find((c) => c.id === sent.id).terms.includes("Séance naissance"));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.click("#ad-tab-contracts").catch(() => page.evaluate(() => document.getElementById("ad-tab-contracts").click()));
  await page.waitForSelector("#ad-ctt");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : les modèles tiennent dans l'écran", overflow <= 0, `${overflow}px`);
  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
