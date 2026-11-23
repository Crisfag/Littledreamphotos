// Salle de presse, dans un vrai navigateur et de bout en bout : la
// photographe crée l'événement, dépose ses JPEG (légendes IPTC reprises),
// ajoute commanditaire et média, envoie pour validation ; le commanditaire
// valide sur sa page ; la photographe publie ; le média accepte la licence
// et télécharge une photo (crédit, licence et refus de l'IA écrits dans le
// fichier) puis le ZIP ; journal, accréditation, embargo, téléphone.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/presse.test.mjs

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { WorkerClient } from "../lib/client.mjs";
import { createTestAccount, localSql } from "./lib/testAccount.mjs";
import { readPressMeta } from "../lib/pressmeta.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const SITE_PORT = Number(process.env.SITE_PORT || 8000);
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const SHOTS = process.env.SHOTS || "";
const here = dirname(fileURLToPath(import.meta.url));
const WEB = join(here, "..", "..", "web");

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}
const flat = (t) => String(t || "").replace(/[  ]/g, " ").replace(/\s+/g, " ");

// Site local (presse.html) branché sur le Worker local.
const site = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = join(WEB, path === "/" ? "index.html" : path);
  try {
    let body = await readFile(file);
    const ext = extname(file).slice(1);
    if (ext === "html") body = body.toString().replace(/api: "[^"]*"/, `api: "${API}"`);
    res.writeHead(200, { "content-type": { html: "text/html", js: "text/javascript", css: "text/css", woff2: "font/woff2", svg: "image/svg+xml" }[ext] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve, reject) => { site.once("error", reject); site.listen(SITE_PORT, "localhost", resolve); });

/* ---------- Photos de test : JPEG avec légende IPTC ---------- */

function seg(marker, payload) {
  const b = Buffer.alloc(4 + payload.length);
  b[0] = 0xff; b[1] = marker; b.writeUInt16BE(payload.length + 2, 2);
  payload.copy(b, 4);
  return b;
}
function iim(records) {
  const parts = [Buffer.from([0x1c, 1, 90, 0, 3, 0x1b, 0x25, 0x47])];
  for (const [ds, text] of records) {
    const v = Buffer.from(text, "utf8");
    const h = Buffer.from([0x1c, 2, ds, 0, 0]);
    h.writeUInt16BE(v.length, 3);
    parts.push(h, v);
  }
  const data = Buffer.concat(parts);
  const r = Buffer.alloc(12);
  r.write("8BIM", 0, "latin1"); r.writeUInt16BE(0x0404, 4); r.writeUInt32BE(data.length, 8);
  return Buffer.concat([Buffer.from("Photoshop 3.0\u0000", "latin1"), r, data, data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
}
const DIR = join(tmpdir(), `presse-${Date.now()}`);
await mkdir(DIR, { recursive: true });
const DEMO = join(here, "..", "demo");
const files = [];
for (const [i, name] of ["famille-champ", "parents", "plage"].entries()) {
  const jpg = await sharp(join(DEMO, `${name}.webp`)).resize(2400).jpeg({ quality: 88 }).withMetadata().toBuffer();
  const withIptc = Buffer.concat([jpg.subarray(0, 2), seg(0xed, iim([[105, `Scène ${i + 1}`], [120, `Le public pendant le concert, photo ${i + 1}`], [80, "Studio Test"]])), jpg.subarray(2)]);
  const file = join(DIR, `CONCERT_${i + 1}.jpg`);
  await writeFile(file, withIptc);
  files.push(file);
}

/* ---------- Compte Pro ---------- */

const account = await createTestAccount(API, "presse", { plan: "pro" });
const client = new WorkerClient({ api: API, ...account });
const tag = Date.now().toString(36);

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const exceptions = [];
async function newPage(viewport = { width: 1280, height: 1000 }, opts = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: "block", acceptDownloads: true, ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => exceptions.push(String(err)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  return page;
}
async function openAdmin(viewport) {
  const page = await newPage(viewport);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.fill('#ad-login-form [name="email"]', account.email);
  await page.fill('#ad-login-form [name="password"]', account.password);
  await page.click("#ad-login-submit");
  await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });
  return page;
}

try {
  /* ---------- Création et dépôt ---------- */

  const admin = await openAdmin();
  await admin.click("#ad-tab-press");
  await admin.waitForSelector(".ad-pr-steps");
  check("onglet Salle de presse : les 4 étapes expliquées", (await admin.locator(".ad-pr-steps li").count()) === 4);
  if (SHOTS) await admin.screenshot({ path: join(SHOTS, "presse-vide.png") });
  await admin.click("#ad-pr-new");
  await admin.fill("#ad-pr-create [name=title]", `Nuits du Parc ${tag}`);
  await admin.fill("#ad-pr-create [name=eventDate]", "2026-11-14");
  await admin.fill("#ad-pr-create [name=venue]", "Parc de la Boverie");
  await admin.fill("#ad-pr-create [name=city]", "Liège");
  await admin.fill("#ad-pr-create [name=organiser]", "Les Nuits du Parc");
  await admin.fill("#ad-pr-create [name=creditLine]", "Studio Test / Les Nuits du Parc");
  await admin.click("#ad-pr-create [type=submit]");
  await admin.waitForSelector("#ad-file-input", { state: "attached", timeout: 10000 });
  const slug = decodeURIComponent((await admin.evaluate(() => location.hash)).replace("#/presse/", ""));
  check("événement créé, fiche ouverte sur les photos", slug.startsWith("presse-") && (await admin.textContent(".ad-pr-head h2")).includes(tag), slug);
  await admin.setInputFiles("#ad-file-input", files);
  await admin.waitForFunction(() => document.querySelectorAll(".ad-pr-photo").length === 3, null, { timeout: 90000 });
  await admin.waitForFunction(() => document.querySelectorAll(".ad-pr-photo .ad-pr-file").length === 3 && [...document.querySelectorAll(".ad-pr-file")].every((e) => /HD/.test(e.textContent)), null, { timeout: 30000 });
  const cards = flat(await admin.textContent(".ad-pr-photos"));
  check("3 photos déposées, HD gardées, légendes IPTC reprises", /Scène 1/.test(cards) && (await admin.locator(".ad-pr-file", { hasText: "crédit inscrit" }).count()) === 3, cards.slice(0, 160));

  // Étiquette sponsor et droit à l'image sur la photo 2.
  await admin.locator(".ad-pr-photo").nth(1).locator("[data-pr-edit]").click();
  await admin.fill(".ad-pr-editor [name=tags]", "acme");
  await admin.selectOption(".ad-pr-editor [name=people]", "release");
  await admin.click(".ad-pr-editor [type=submit]");
  await admin.waitForSelector(".ad-pr-tags", { timeout: 8000 });
  check("photo modifiée : étiquette et droit à l'image", (await admin.textContent(".ad-pr-photos")).includes("acme") && (await admin.textContent(".ad-pr-photos")).includes("Autorisation signée"));
  if (SHOTS) await admin.screenshot({ path: join(SHOTS, "presse-photos.png"), fullPage: true });

  /* ---------- Destinataires ---------- */

  await admin.click('[data-pr-tab="people"]');
  const addRecipient = async (role, name, org, email) => {
    await admin.selectOption("#ad-pr-add [name=role]", role);
    await admin.fill("#ad-pr-add [name=name]", name);
    await admin.fill("#ad-pr-add [name=organisation]", org);
    await admin.fill("#ad-pr-add [name=email]", email);
    await admin.click("#ad-pr-add [type=submit]");
    await admin.waitForSelector(`.ad-pr-people-table td:has-text("${name}")`, { timeout: 8000 });
  };
  await addRecipient("client", "Julie Martin", "Les Nuits du Parc", `julie-${tag}@example.com`);
  await addRecipient("press", "Marc Leroy", "Le Quotidien", `marc-${tag}@example.com`);
  check("deux destinataires, chacun son lien", (await admin.locator("[data-pr-copy]").count()) === 2);
  await admin.click('[data-pr-stage="review"]');
  await admin.click("#ad-confirm-ok");
  await admin.waitForSelector(".ad-pr-state-review", { timeout: 8000 });
  check("validation ouverte", true);
  if (SHOTS) await admin.screenshot({ path: join(SHOTS, "presse-destinataires.png"), fullPage: true });

  const detail = await client.request("GET", `/api/admin/press/${encodeURIComponent(slug)}`);
  const linkOf = (name) => detail.recipients.find((r) => r.name === name).link.replace(/^https?:\/\/[^/]+/, `http://localhost:${SITE_PORT}`);

  /* ---------- Le commanditaire valide ---------- */

  const julie = await newPage();
  julie.on("dialog", (d) => d.accept(d.type() === "prompt" ? "yeux fermés" : undefined));
  await julie.goto(linkOf("Julie Martin"), { waitUntil: "domcontentloaded" });
  await julie.waitForSelector(".pr-card");
  check("page du commanditaire : 3 photos à valider, crédit affiché", (await julie.locator(".pr-card").count()) === 3 && (await julie.textContent(".pr-credit")).includes("Studio Test / Les Nuits du Parc"));
  await julie.waitForFunction(() => [...document.querySelectorAll(".pr-thumb img")].filter((i) => i.complete && i.naturalWidth > 0).length >= 4, null, { timeout: 15000 });
  check("aperçus filigranés chargés (tuiles)", true);
  if (SHOTS) await julie.screenshot({ path: join(SHOTS, "presse-validation.png"), fullPage: true });
  await julie.locator('[data-decide="rejected"]').nth(2).click();
  await julie.waitForFunction(() => document.querySelectorAll(".pr-card").length === 2, null, { timeout: 8000 });
  await julie.click("#pr-approve-all");
  await julie.waitForFunction(() => /0/.test(document.querySelector('[data-tab="pending"] span')?.textContent || ""), null, { timeout: 8000 });
  const decided = await client.request("GET", `/api/admin/press/${encodeURIComponent(slug)}`);
  check("2 validées, 1 refusée (avec motif)", decided.photos.filter((p) => p.status === "approved").length === 2 && decided.photos.find((p) => p.status === "rejected")?.note === "yeux fermés");

  /* ---------- Publication, le média télécharge ---------- */

  await admin.click('[data-pr-tab="photos"]');
  await admin.click('[data-pr-stage="publish"]');
  await admin.click("#ad-confirm-ok");
  await admin.waitForSelector(".ad-pr-state-live", { timeout: 8000 });
  const marc = await newPage();
  await marc.goto(linkOf("Marc Leroy"), { waitUntil: "domcontentloaded" });
  await marc.waitForSelector("#pr-accept");
  check("page du média : seulement les 2 photos validées, licence à accepter", (await marc.locator(".pr-card").count()) === 2 && (await marc.locator(".pr-block", { hasText: "Acceptez la licence" }).count()) === 2);
  await marc.click("#pr-licence-toggle");
  check("texte de la licence : éditorial, crédit, réserve IA", /usage éditorial/i.test(await marc.textContent("#pr-licence pre")) && /2019\/790/.test(await marc.textContent("#pr-licence pre")));
  if (SHOTS) await marc.screenshot({ path: join(SHOTS, "presse-licence.png"), fullPage: true });
  await marc.check("#pr-accept [name=accept]");
  await marc.click("#pr-accept [type=submit]");
  await marc.waitForSelector(".pr-licence-ok", { timeout: 8000 });
  check("licence acceptée : téléchargements ouverts", (await marc.locator("[data-dl]").count()) === 2);
  const [download] = await Promise.all([marc.waitForEvent("download", { timeout: 20000 }), marc.locator("[data-dl]").first().click()]);
  const filePath = join(DIR, "telecharge.jpg");
  await download.saveAs(filePath);
  const got = await readFile(filePath);
  const meta = readPressMeta(got);
  const xmp = (await sharp(got).metadata()).xmp?.toString("utf8") || "";
  check("fichier HD : crédit imposé, légende, licencié et refus de l'IA écrits", meta.credit === "Studio Test / Les Nuits du Parc" && /Le public pendant le concert/.test(meta.caption) && /Le Quotidien/.test(xmp) && /DMI-PROHIBITED-AIMLTRAINING/.test(xmp), JSON.stringify(meta).slice(0, 160));
  const dims = await sharp(got).metadata();
  check("fichier HD intact (pleine définition, lisible)", dims.width === 2400 && dims.format === "jpeg", `${dims.width} ${dims.format}`);
  const [zipDl] = await Promise.all([marc.waitForEvent("download", { timeout: 30000 }), marc.click("#pr-zip")]);
  const zipPath = join(DIR, "tout.zip");
  await zipDl.saveAs(zipPath);
  const zip = await readFile(zipPath);
  let entries = 0;
  for (let o = 0; zip.readUInt32LE(o) === 0x04034b50; entries++) o += 30 + zip.readUInt16LE(o + 26) + zip.readUInt32LE(o + 18);
  check("ZIP : les 2 photos validées", entries === 2 && zipDl.suggestedFilename().endsWith(".zip"), zipDl.suggestedFilename());
  await marc.click(".pr-thumb");
  await marc.waitForSelector("#pr-lightbox:not([hidden]) .pr-lb-image img");
  check("visionneuse : grande image, légende, bouton « Copier légende et crédit »", (await marc.locator("[data-lb-copy]").count()) === 1);
  await marc.keyboard.press("Escape");

  /* ---------- Journal et licences côté photographe ---------- */

  await admin.click('[data-pr-tab="journal"]');
  await admin.waitForSelector(".ad-pr-best");
  check("journal : 3 téléchargements notés (1 + ZIP de 2)", (await admin.locator("#ad-pr-panel table tbody tr").count()) === 3);
  const csv = await admin.evaluate(async (s) => (await fetch(`/local/press/${encodeURIComponent(s)}/journal.csv`)).text(), slug);
  check("export CSV : licence et empreinte", csv.split("\r\n").length === 4 && /Le Quotidien/.test(csv));
  await admin.click('[data-pr-tab="licences"]');
  await admin.click("[data-pr-licence]");
  await admin.waitForSelector("#ad-pr-licence-view:not([hidden])");
  check("licence signée consultable : texte exact, signataire, empreinte", /Marc Leroy/.test(await admin.textContent("#ad-pr-licence-view")) && /SHA-256/.test(await admin.textContent("#ad-pr-licence-view")));
  if (SHOTS) await admin.screenshot({ path: join(SHOTS, "presse-licences.png"), fullPage: true });

  /* ---------- Accréditation ---------- */

  await admin.click('[data-pr-tab="settings"]');
  await admin.check("#ad-pr-settings [name=accreditationOpen]");
  await admin.click("#ad-pr-settings [type=submit]");
  await admin.waitForTimeout(800);
  const zoe = await newPage({ width: 390, height: 844 });
  await zoe.goto(`http://localhost:${SITE_PORT}/presse.html?e=${encodeURIComponent(slug)}&lang=en`, { waitUntil: "domcontentloaded" });
  await zoe.waitForSelector("#pr-accr-form");
  check("page d'accréditation publique, en anglais", /Accreditation request/.test(await zoe.textContent("body")) && (await zoe.textContent("h1")).includes(tag));
  await zoe.fill("[name=name]", "Zoé Lambert");
  await zoe.fill("[name=organisation]", "Radio Ouest");
  await zoe.fill("[name=email]", `zoe-${tag}@example.com`);
  await zoe.fill("[name=pressCard]", "BE-1234");
  await zoe.click("#pr-accr-form [type=submit]");
  await zoe.waitForSelector(".pr-note-ok");
  const overflowZ = await zoe.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : pas de débordement (accréditation)", overflowZ <= 1, overflowZ + " px");
  if (SHOTS) await zoe.screenshot({ path: join(SHOTS, "presse-accreditation-mobile.png"), fullPage: true });
  await admin.click('[data-pr-tab="people"]');
  await admin.waitForSelector(".ad-pr-requests");
  check("la demande arrive chez la photographe, carte de presse comprise", /Zoé Lambert/.test(await admin.textContent(".ad-pr-requests")) && /BE-1234/.test(await admin.textContent(".ad-pr-requests")));
  await admin.click('.ad-pr-requests [data-pr-r="accept"]');
  await admin.waitForSelector('.ad-pr-people-table td:has-text("Zoé Lambert")', { timeout: 8000 });
  check("accréditation acceptée : Zoé devient destinataire", true);

  /* ---------- Embargo ---------- */

  await client.request("POST", `/api/admin/press/${encodeURIComponent(slug)}`, { embargoAt: Math.floor(Date.now() / 1000) + 3 * 3600 });
  const marc2 = await newPage({ width: 390, height: 844 });
  await marc2.goto(linkOf("Marc Leroy"), { waitUntil: "domcontentloaded" });
  await marc2.waitForSelector("#pr-count div");
  check("embargo : compte à rebours, aucune photo", (await marc2.locator(".pr-card").count()) === 0 && /Sous embargo/.test(await marc2.textContent("body")));
  const overflowM = await marc2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : pas de débordement (embargo)", overflowM <= 1, overflowM + " px");
  if (SHOTS) await marc2.screenshot({ path: join(SHOTS, "presse-embargo-mobile.png"), fullPage: true });
  await client.request("POST", `/api/admin/press/${encodeURIComponent(slug)}`, { embargoAt: null });

  /* ---------- Téléphone, côté photographe et côté média ---------- */

  const phone = await openAdmin({ width: 390, height: 844 });
  await phone.goto(`${BASE}/#/presse/${encodeURIComponent(slug)}`);
  await phone.waitForSelector(".ad-pr-photo", { timeout: 10000 });
  const overflowA = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : fiche de l'événement sans débordement", overflowA <= 1, overflowA + " px");
  if (SHOTS) await phone.screenshot({ path: join(SHOTS, "presse-admin-mobile.png"), fullPage: true });
  const marc3 = await newPage({ width: 390, height: 844 });
  await marc3.goto(linkOf("Marc Leroy"), { waitUntil: "domcontentloaded" });
  await marc3.waitForSelector(".pr-card");
  const overflowP = await marc3.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : salle de presse du média sans débordement", overflowP <= 1, overflowP + " px");
  if (SHOTS) await marc3.screenshot({ path: join(SHOTS, "presse-media-mobile.png"), fullPage: true });

  /* ---------- Néerlandais ---------- */

  await client.request("POST", "/api/admin/account/language", { language: "nl" });
  const nl = await openAdmin();
  await nl.click("#ad-tab-press");
  await nl.waitForSelector(".ad-pr-event");
  check("en néerlandais : « Perskamer »", /Perskamer/.test(await nl.textContent("#ad-tab-press")) && /Perskamer/.test(await nl.textContent("h2")) && !/Salle de presse/.test(await nl.textContent("#ad-view")));
  await client.request("POST", "/api/admin/account/language", { language: "fr" });
} catch (err) {
  check("déroulé sans exception", false, err.message.split("\n")[0]);
}

check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
await browser.close();
site.close();
const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
