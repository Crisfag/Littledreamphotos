// Module écoles, crèches et clubs dans un vrai navigateur, contre le vrai
// Worker local : création d'un établissement et d'une classe, import de
// photos (avec leur heure de prise de vue), regroupement automatique par
// enfant, puis corrections (photo de groupe, déplacement, fusion, prénom).
//
//   npm run dev:local                      (depuis worker/)
//   node admin-server.mjs                  (depuis tools/, GALERIE_API=http://127.0.0.1:8788)
//   node tests/school.test.mjs             (depuis tools/)

import { chromium } from "playwright";
import sharp from "sharp";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestAccount } from "./lib/testAccount.mjs";
import { takenAtFromExif, exifDateToMs } from "../lib/exif.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

// Séance fictive : 3 enfants (3, 2 et 4 poses à 2 s d'écart, 30 s entre
// enfants), une photo de classe, et une photo sans heure de prise de vue.
const dir = await mkdtemp(join(tmpdir(), "holypixx-ecole-"));
const files = [];
async function shot(name, color, time) {
  let img = sharp({ create: { width: 900, height: 1200, channels: 3, background: color } }).jpeg({ quality: 80 });
  if (time) img = img.withExif({ IFD0: { DateTime: time }, IFD2: { DateTimeOriginal: time, SubSecTimeOriginal: "20" } });
  const path = join(dir, name);
  await writeFile(path, await img.toBuffer());
  files.push(path);
}
const pad = (n) => String(n).padStart(2, "0");
let second = 0;
const children = [["#c98", 3], ["#89c", 2], ["#9c8", 4]];
let index = 1;
for (const [color, poses] of children) {
  for (let k = 0; k < poses; k++) {
    await shot(`IMG_${String(index++).padStart(4, "0")}.jpg`, color, `2026:10:07 09:${pad(Math.floor(second / 60))}:${pad(second % 60)}`);
    second += 2;
  }
  second += 30;
}
await shot("IMG_CLASSE.jpg", "#bbb", `2026:10:07 09:20:00`);
await shot("sans-heure.jpg", "#777", null);

const meta = await sharp(files[0]).metadata();
check("l'heure de prise de vue (centièmes compris) se lit dans les fichiers de l'appareil",
      takenAtFromExif(meta.exif) === exifDateToMs("2026:10:07 09:00:00", "20"));

const account = await createTestAccount(API, "ecole", { plan: "studio" });
const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ["--disable-features=LocalNetworkAccessChecks"],
});
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.fill('#ad-login-form [name="email"]', account.email);
await page.fill('#ad-login-form [name="password"]', account.password);
await page.click("#ad-login-submit");
await page.waitForSelector("#ad-tab-school:not([hidden])", { timeout: 10000 });
check("l'onglet Écoles & clubs est proposé à un abonné Studio", await page.isVisible("#ad-tab-school"));

await page.click("#ad-tab-school");
await page.click("#ad-sc-new");
await page.click('[data-kind="ecole"]');
await page.fill('#ad-sc-form [name="name"]', "École du test");
await page.click('#ad-sc-form [type="submit"]');
await page.waitForSelector("#ad-sc-add-groups");
await page.fill('#ad-sc-add-groups [name="names"]', "P3");
await page.click('#ad-sc-add-groups [type="submit"]');
await page.waitForSelector("[data-open-group]");
const emptyCoupons = await page.locator(".ad-sc-coupons").innerText();
check("sans enfant, pas de lien de fiches (le serveur les refuserait) mais une explication ; « sa classe » accordé",
      (await page.locator('.ad-sc-coupons a[href*="/coupons"]').count()) === 0 && /importées et regroupées par enfant/.test(emptyCoupons) && /son portrait, sa classe,/.test(emptyCoupons), emptyCoupons.slice(0, 80));
await page.click("[data-open-group]");
await page.waitForSelector("#ad-sc-files", { state: "attached" });

await page.setInputFiles("#ad-sc-files", files);
await page.waitForSelector(".ad-sc-child", { timeout: 60000 });
await page.waitForFunction(() => document.querySelectorAll(".ad-sc-child").length >= 3, null, { timeout: 30000 });
const childCounts = await page.$$eval(".ad-sc-child", (cards) => cards.map((c) => c.querySelectorAll("[data-photo]").length).join(","));
check("après l'import, les photos sont regroupées en enfants d'après l'heure de prise de vue",
      childCounts === "3,2,4,1", childCounts);
if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, "ecole-groupe.png"), fullPage: true });
const unsortedCount = await page.locator(".ad-sc-unsorted [data-photo]").count();
check("la photo sans heure de prise de vue attend « à trier »", unsortedCount === 1, String(unsortedCount));

// La photo de classe (prise à part) a formé un 4e « enfant » : on la passe en photo de groupe.
await page.locator(".ad-sc-child").nth(3).locator("[data-photo]").first().click();
await page.selectOption("#ad-sc-move", "group");
await page.waitForFunction(() => document.querySelectorAll(".ad-sc-child").length === 3, null, { timeout: 10000 });
const groupSection = await page.locator("section", { has: page.locator("h3", { hasText: "Photo de classe" }) }).locator("[data-photo]").count();
check("une photo passée en « photo de classe » quitte les enfants (l'enfant vide disparaît)", groupSection === 1, String(groupSection));

// La photo sans heure rejoint l'enfant 2.
await page.locator(".ad-sc-unsorted [data-photo]").first().click();
const secondChildId = await page.locator(".ad-sc-child").nth(1).getAttribute("data-child");
await page.selectOption("#ad-sc-move", secondChildId);
await page.waitForFunction(() => !document.querySelector(".ad-sc-unsorted"), null, { timeout: 10000 });
const afterMove = await page.$$eval(".ad-sc-child", (cards) => cards.map((c) => c.querySelectorAll("[data-photo]").length).join(","));
check("une photo à trier se rattache à un enfant ; le bac « à trier » disparaît", afterMove === "3,3,4", afterMove);

// Fusion : l'enfant 3 était en fait l'enfant 2.
await page.locator(".ad-sc-child").nth(2).locator("[data-merge]").click();
await page.waitForFunction(() => document.querySelectorAll(".ad-sc-child").length === 2, null, { timeout: 10000 });
const afterMerge = await page.$$eval(".ad-sc-child", (cards) => cards.map((c) => c.querySelectorAll("[data-photo]").length).join(","));
check("deux cartes du même enfant se fusionnent", afterMerge === "3,7", afterMerge);

await page.locator(".ad-sc-child").first().locator("[data-child-name]").fill("Léa");
await page.locator(".ad-sc-child").first().locator("[data-child-name]").dispatchEvent("change");
await page.waitForTimeout(500);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".ad-sc-child");
check("le prénom (facultatif) est enregistré", (await page.locator(".ad-sc-child").first().locator("[data-child-name]").inputValue()) === "Léa");

// Fiches parents : PDF (feuille-paquet + 4 fiches par feuille) et ZIP 10×15.
const pdfHref = await page.getAttribute('.ad-sc-coupons a[href*="format=pdf"]', "href");
const pdf = await page.request.get(BASE + pdfHref);
const pdfBody = await pdf.body();
const pdfPages = (pdfBody.toString("latin1").match(/\/Type \/Page\b/g) || []).length;
check("les fiches de la classe sortent en PDF : une feuille-paquet puis 4 fiches par feuille A4",
      pdf.status() === 200 && pdfBody.subarray(0, 5).toString() === "%PDF-" && pdfPages === 2 && pdfBody.toString("latin1").trim().endsWith("%%EOF"),
      `${pdf.status()} · ${pdfPages} page(s) · ${pdfBody.length} octets`);
const zip = await page.request.get(BASE + pdfHref.replace("format=pdf", "format=lab"));
const zipBody = await zip.body();
const zipNames = [];
for (let i = 0; i + 30 < zipBody.length; ) {
  if (zipBody.readUInt32LE(i) !== 0x04034b50) break;
  const size = zipBody.readUInt32LE(i + 18);
  const nameLength = zipBody.readUInt16LE(i + 26);
  zipNames.push(zipBody.subarray(i + 30, i + 30 + nameLength).toString("utf8"));
  i += 30 + nameLength + size;
}
const firstImage = await sharp(zipBody.subarray(30 + Buffer.byteLength(zipNames[0] || "", "utf8"))).metadata().catch(() => ({}));
check("et en images 10×15 pour le labo, une par enfant, rangées par classe",
      zip.status() === 200 && zipNames.length === 2 && zipNames.every((n) => n.startsWith("01_P3/P3_00")) && zipNames[0].endsWith("_Lea.jpg") &&
      firstImage.width >= 1790 && firstImage.height >= 1200, zipNames.join(", "));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".ad-sc-code");
const codes = await page.$$eval(".ad-sc-code", (els) => els.map((e) => e.textContent));
await page.request.get(BASE + pdfHref);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".ad-sc-code");
const codesAgain = await page.$$eval(".ad-sc-code", (els) => els.map((e) => e.textContent));
check("chaque enfant reçoit un code d'accès lisible (8 caractères sans 0/O ni 1/I), stable d'un téléchargement à l'autre",
      codes.length === 2 && codes.every((c) => /^[A-HJ-NP-Z2-9]{4} [A-HJ-NP-Z2-9]{4}$/.test(c)) && codes.join() === codesAgain.join() && codes[0] !== codes[1],
      codes.join(" / "));

await page.click("#ad-sc-back-school");
await page.waitForSelector("[data-open-group]");
const summary = await page.textContent("[data-open-group]");
check("la liste des classes résume enfants et photos", /2 enfants · 11 photos/.test(summary), summary);

await page.click("#ad-tab-galleries");
await page.waitForSelector("#ad-new-gallery");
check("la galerie du groupe n'apparaît pas parmi les galeries classiques",
      !(await page.textContent("#ad-view")).includes("École du test"));
check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

await browser.close();
await rm(dir, { recursive: true, force: true });

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
