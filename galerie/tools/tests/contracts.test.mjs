// Devis et contrats signés en ligne, de bout en bout dans un vrai
// navigateur : le photographe rédige et envoie un devis ; le client le lit,
// le signe ; chacun récupère le PDF signé. Puis refus, modification après
// envoi, expiration, acompte, formule Découverte.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/contracts.test.mjs

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
const SITE_PORT = Number(process.env.SITE_PORT || 8000); // seule origine locale autorisée par le Worker

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}
const nbsp = (t) => String(t || "").replace(/[  ]/g, " ");

const account = await createTestAccount(API, "contrats");
const client = new WorkerClient({ api: API, ...account });
const freeClient = new WorkerClient({ api: API, ...(await createTestAccount(API, "contrats-free", { plan: "" })) });
const tokenOf = (url) => new URL(url).searchParams.get("t");
const publicCall = async (token, path = "", method = "GET", body) => {
  const res = await fetch(`${API}/api/contract/${token}${path}`, {
    method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: res.headers.get("content-type")?.includes("json") ? await res.json() : await res.arrayBuffer() };
};

const TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", svg: "image/svg+xml" };
const site = createServer(async (req, res) => {
  const pathname = req.url.split("?")[0];
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

const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ["--disable-features=LocalNetworkAccessChecks"],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-login-form", { timeout: 10000 });
  await page.fill('#ad-login-form [name="email"]', account.email);
  await page.fill('#ad-login-form [name="password"]', account.password);
  await page.click("#ad-login-submit");
  await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });

  /* ---------- Le photographe rédige et envoie un devis ---------- */

  await page.click("#ad-tab-contracts");
  await page.waitForSelector("#ad-ct-new", { timeout: 10000 });
  check("l'onglet Devis & contrats ouvre #/contrats", (await page.evaluate(() => location.hash)) === "#/contrats");
  await page.click("#ad-ct-new");
  await page.waitForSelector("#ad-ct-form");
  check("les conditions par défaut du studio pré-remplissent le devis",
        (await page.inputValue('#ad-ct-form [name="terms"]')).includes("Droit à l'image"));
  await page.fill('#ad-ct-form [name="clientName"]', "Camille Dubois");
  await page.fill('#ad-ct-form [name="clientEmail"]', "camille.contrat@example.com");
  await page.fill('#ad-ct-form [name="title"]', "Séance nouveau-né");
  // Sélecteur de date : l'heure ne s'ouvre qu'une fois le jour choisi.
  const timeLockedFirst = await page.isDisabled('#ad-ct-form [name="sessionTime"]');
  await page.fill('#ad-ct-form [name="sessionDay"]', "2027-11-13");
  await page.fill('#ad-ct-form [name="sessionTime"]', "10:00");
  check("date de séance au sélecteur : l'heure s'ouvre une fois le jour choisi", timeLockedFirst && !(await page.isDisabled('#ad-ct-form [name="sessionTime"]')));
  await page.fill("#ad-ct-lines .ad-ct-line-label", "Séance au studio, 2 h");
  await page.fill("#ad-ct-lines .ad-ct-line-amount", "220");
  await page.click("#ad-ct-add-line");
  await page.locator("#ad-ct-lines .ad-ct-line-label").nth(1).fill("Album 20×20");
  await page.locator("#ad-ct-lines .ad-ct-line-amount").nth(1).fill("95,50");
  check("le total se calcule pendant la saisie", nbsp(await page.textContent("#ad-ct-total")) === "315,50 €", nbsp(await page.textContent("#ad-ct-total")));
  await page.click('[data-ct-submit="send"]');
  await page.waitForSelector(".ad-ct-table tbody tr", { timeout: 10000 });
  let list = await client.request("GET", "/api/admin/contracts");
  const first = list.contracts[0];
  check("le devis est envoyé : numéroté, statut « Envoyé », lien client disponible",
        /^\d{4}-001$/.test(first.number) && first.status === "sent" && first.url.includes("contrat.html?t=") && (await page.textContent(".ad-ct-table tbody tr")).includes("Envoyé"),
        `${first.number} ${first.status}`);
  check("la date choisie s'écrit en toutes lettres dans le contrat, et reste un vrai jour",
        first.sessionDate === "samedi 13 novembre 2027 à 10 h" && first.sessionDay === "2027-11-13" && first.sessionTime === "10:00", first.sessionDate);

  /* ---------- Le client lit et signe ---------- */

  const visitor = await browser.newPage({ viewport: { width: 390, height: 844 } });
  visitor.on("pageerror", (err) => exceptions.push(String(err)));
  const token = tokenOf(first.url);
  await visitor.goto(`http://localhost:${SITE_PORT}/contrat.html?t=${token}`, { waitUntil: "domcontentloaded" });
  await visitor.waitForSelector("#ct-page:not([hidden])", { timeout: 10000 });
  check("la page du client affiche le devis : titre, lignes, total, conditions",
        (await visitor.textContent("#ct-title")) === "Séance nouveau-né" && (await visitor.locator("#ct-lines tr").count()) === 2 &&
        nbsp(await visitor.textContent("#ct-total")) === "315,50 €" && (await visitor.textContent("#ct-terms")).includes("Droits d'auteur"));
  list = await client.request("GET", "/api/admin/contracts");
  check("l'ouverture par le client passe le devis en « lu »", list.contracts[0].status === "viewed" && Boolean(list.contracts[0].viewedAt));

  await visitor.fill('#ct-sign-form [name="signerName"]', "Camille Dubois");
  await visitor.click("#ct-sign-submit");
  check("signer sans cocher l'acceptation est refusé", (await visitor.textContent("#ct-sign-error")).includes("Cochez"));
  await visitor.check('#ct-sign-form [name="accept"]');
  check("sans acompte, le bouton dit « Signer le contrat »", (await visitor.textContent("#ct-sign-submit")) === "Signer le contrat");
  await visitor.click("#ct-sign-submit");
  await visitor.waitForSelector("#ct-done:not([hidden])", { timeout: 10000 });
  check("le contrat est signé à l'écran, avec le lien du PDF",
        (await visitor.textContent("#ct-done-text")).includes("Signé électroniquement par Camille Dubois") && (await visitor.isHidden("#ct-sign")));

  const pdf = await publicCall(token, "/pdf");
  check("le client télécharge le PDF signé", pdf.status === 200 && Buffer.from(pdf.body).subarray(0, 4).toString() === "%PDF");
  const again = await publicCall(token, "/sign", "POST", { accept: true, signerName: "Quelqu'un d'autre" });
  check("un contrat signé ne peut pas être signé une seconde fois", again.status === 409);
  list = await client.request("GET", "/api/admin/contracts");
  check("côté photographe : signé, signataire, empreinte du document",
        list.contracts[0].status === "signed" && list.contracts[0].signerName === "Camille Dubois" && /^[0-9a-f]{64}$/.test(list.contracts[0].documentHash));
  const editSigned = await client.request("POST", `/api/admin/contracts/${first.id}`, { title: "Autre" }).catch((err) => err);
  check("un contrat signé ne se modifie plus", editSigned.status === 409);
  const adminPdf = await page.request.get(`${BASE}/local/contracts/${first.id}/pdf`);
  check("le photographe télécharge le PDF signé depuis l'admin",
        adminPdf.status() === 200 && (await adminPdf.body()).subarray(0, 4).toString() === "%PDF");

  /* ---------- Modification après envoi, refus ---------- */

  const base = { clientName: "Paul Martin", clientEmail: "paul@example.com", title: "Séance famille", lines: [{ label: "Séance 1 h", amountCents: 18000 }] };
  let created = await client.request("POST", "/api/admin/contracts", { ...base, send: true });
  const second = created.contracts.find((c) => c.clientEmail === "paul@example.com");
  created = await client.request("POST", `/api/admin/contracts/${second.id}`, { ...base, lines: [{ label: "Séance 1 h 30", amountCents: 22000 }] });
  check("modifier un devis envoyé le repasse en brouillon (à renvoyer)", created.contracts.find((c) => c.id === second.id).status === "draft");
  const hidden = await publicCall(tokenOf(second.url), "");
  check("un brouillon n'est pas lisible par le client", hidden.status === 404);
  await client.request("POST", `/api/admin/contracts/${second.id}/send`, {});
  const declined = await publicCall(tokenOf(second.url), "/decline", "POST", { reason: "Nous préférons attendre le printemps." });
  list = await client.request("GET", "/api/admin/contracts");
  const secondNow = list.contracts.find((c) => c.id === second.id);
  check("le client peut refuser, avec un mot : le photographe le voit",
        declined.status === 200 && secondNow.status === "declined" && secondNow.declineReason.includes("printemps"));

  /* ---------- Expiration, acompte, formule ---------- */

  const yesterday = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  created = await client.request("POST", "/api/admin/contracts", { ...base, clientEmail: "expire@example.com", validUntil: yesterday, send: true });
  const expired = created.contracts.find((c) => c.clientEmail === "expire@example.com");
  const expiredView = await publicCall(tokenOf(expired.url));
  const expiredSign = await publicCall(tokenOf(expired.url), "/sign", "POST", { accept: true, signerName: "Paul Martin" });
  check("un devis expiré s'affiche comme tel et ne se signe plus", expiredView.body.contract.expired === true && expiredSign.status === 409);

  await localSql(API, `UPDATE photographers SET stripe_account_id = 'acct_test', stripe_charges_enabled = 1 WHERE email = '${account.email}'`);
  created = await client.request("POST", "/api/admin/contracts", { ...base, clientEmail: "acompte@example.com", depositCents: 5000, send: true });
  const withDeposit = created.contracts.find((c) => c.clientEmail === "acompte@example.com");
  const signedDeposit = await publicCall(tokenOf(withDeposit.url), "/sign", "POST", { accept: true, signerName: "Paul Martin", returnUrl: `http://localhost:${SITE_PORT}/contrat.html` });
  check("avec acompte et Stripe indisponible : la signature est gardée, l'acompte reste dû",
        signedDeposit.status === 200 && signedDeposit.body.contract.status === "signed" && signedDeposit.body.contract.depositDue === true && Boolean(signedDeposit.body.paymentError),
        signedDeposit.body.paymentError);
  const tooBig = await client.request("POST", "/api/admin/contracts", { ...base, depositCents: 99999 }).catch((err) => err);
  check("un acompte supérieur au total est refusé", tooBig.status === 400);
  // Numérotation : un brouillon supprimé ne fait pas réattribuer un numéro.
  let numbered = await client.request("POST", "/api/admin/contracts", { ...base, clientEmail: "num-a@example.com" });
  const draftA = numbered.contracts.find((c) => c.clientEmail === "num-a@example.com");
  numbered = await client.request("POST", "/api/admin/contracts", { ...base, clientEmail: "num-b@example.com" });
  const draftB = numbered.contracts.find((c) => c.clientEmail === "num-b@example.com");
  await client.request("DELETE", `/api/admin/contracts/${draftA.id}`);
  numbered = await client.request("POST", "/api/admin/contracts", { ...base, clientEmail: "num-c@example.com" });
  const draftC = numbered.contracts.find((c) => c.clientEmail === "num-c@example.com");
  check("après suppression d'un brouillon, le numéro suivant reste unique",
        new Set(numbered.contracts.map((c) => c.number)).size === numbered.contracts.length && draftC.number > draftB.number,
        `${draftB.number} → ${draftC.number}`);
  const blocked = await freeClient.request("POST", "/api/admin/contracts", base).catch((err) => err);
  check("la formule Découverte n'inclut pas les devis et contrats (402)", blocked.status === 402);
  check("un lien inconnu ne révèle rien", (await publicCall("x".repeat(32))).status === 404);

  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} finally {
  await browser.close();
  site.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
