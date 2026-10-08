// Espace famille du module scolaire (web/ecole.html) dans un vrai
// navigateur, contre le vrai Worker local : connexion par e-mail + code de
// la fiche, photos de l'enfant et photo de classe, deuxième enfant ajouté
// par son code, photo en grand, lien de connexion par e-mail, et
// cloisonnement (une famille ne charge jamais les photos d'un autre enfant).
//
//   npm run dev:local                      (depuis worker/)
//   node tests/family.test.mjs             (depuis tools/)

import { chromium } from "playwright";
import sharp from "sharp";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../lib/client.mjs";
import { processPhoto } from "../lib/pipeline.mjs";
import { createTestAccount } from "./lib/testAccount.mjs";

const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web");
const SITE_PORT = Number(process.env.SITE_PORT || 8000);

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

/* ---------- Une école, une classe, deux enfants, une photo de classe ---------- */

const account = await createTestAccount(API, "famille", { plan: "studio" });
const PARENT = `parent-${Date.now().toString(36)}@test.invalid`;
const client = new WorkerClient({ api: API, ...account });
const school = await client.request("POST", "/api/admin/school/schools", { kind: "ecole", name: "École des familles" });
const { ids: [groupId] } = await client.request("POST", `/api/admin/school/years/${school.yearId}/groups`, { names: ["P2"] });
const { slug } = await client.request("POST", `/api/admin/school/groups/${groupId}/gallery`, {});
const gallery = await client.getGallery(slug);

const base = Date.UTC(2026, 9, 7, 9, 0, 0);
const shots = [["#c98", 0], ["#c98", 2000], ["#89c", 40000], ["#89c", 42000], ["#bbb", 600000]];
let position = 0;
for (const [color, offset] of shots) {
  const input = await sharp({ create: { width: 800, height: 1000, channels: 3, background: color } }).jpeg().toBuffer();
  const { photo, tiles } = await processPhoto(input, { galleryId: gallery.gallery.id, forensicKey: "cle-de-test-famille", watermarkText: "Test", position: position++ });
  await client.addPhoto(slug, { ...photo, takenAt: base + offset });
  for (const t of tiles) await client.putTile(photo.id, t.level, t.col, t.row, t.buffer);
}
await client.request("POST", `/api/admin/school/groups/${groupId}/arrange`, {});
let detail = await client.request("GET", `/api/admin/school/groups/${groupId}`);
// La 5e photo (prise 10 minutes plus tard) est la photo de classe.
const lonely = detail.children.find((c) => detail.photos.filter((p) => p.childId === c.id).length === 1);
await client.request("POST", `/api/admin/school/groups/${groupId}/assign`, {
  photoIds: detail.photos.filter((p) => p.childId === lonely.id).map((p) => p.id), to: "group",
});
await client.request("POST", `/api/admin/school/children/${(await client.request("GET", `/api/admin/school/groups/${groupId}`)).children[0].id}`, { firstName: "Léa" });
const coupons = await client.request("POST", `/api/admin/school/years/${school.yearId}/coupons`, {});
const [kidA, kidB] = coupons.groups[0].children;
detail = await client.request("GET", `/api/admin/school/groups/${groupId}`);
const photoOfB = detail.photos.find((p) => p.childId === kidB.id);

/* ---------- Avant l'ouverture des ventes ---------- */

const early = await fetch(`${API}/api/family/access`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: PARENT, code: kidA.code }),
});
check("tant que l'année est « en préparation », le code est reconnu mais les photos ne s'ouvrent pas", early.status === 409, (await early.json()).error);
await client.request("POST", `/api/admin/school/years/${school.yearId}`, { status: "open", orderDeadline: "2030-06-04" });

/* ---------- Navigateur ---------- */

const site = createServer(async (req, res) => {
  let pathname = req.url.split("?")[0];
  if (pathname === "/ecole") pathname = "/ecole.html";
  try {
    const body = await readFile(join(WEB_DIR, pathname));
    const type = pathname.endsWith(".css") ? "text/css" : pathname.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8";
    res.writeHead(200, { "content-type": type });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => site.listen(SITE_PORT, "localhost", resolve));

const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ["--disable-features=LocalNetworkAccessChecks"],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
// La page appelle le Worker de production : on la redirige vers le Worker local.
await page.route(/workers\.dev\/api\//, async (route) => {
  const url = route.request().url().replace(/^https:\/\/[^/]+/, API);
  const upstream = await fetch(url, {
    method: route.request().method(),
    headers: route.request().headers(),
    body: route.request().postData() || undefined,
  });
  await route.fulfill({
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") || "application/json", "access-control-allow-origin": "*" },
    body: Buffer.from(await upstream.arrayBuffer()),
  });
});

await page.goto(`http://localhost:${SITE_PORT}/ecole?c=${kidA.code}`, { waitUntil: "domcontentloaded" });
check("le QR code de la fiche pré-remplit le code d'accès",
      (await page.inputValue("#ec-code")).replace(/\s/g, "") === kidA.code, await page.inputValue("#ec-code"));
await page.fill("#ec-code", "ZZZZ ZZZZ");
await page.fill("#ec-email", PARENT);
await page.click("#ec-access-submit");
await page.waitForSelector("#ec-access-error:not([hidden])");
check("un code inconnu est refusé avec un message clair", (await page.textContent("#ec-access-error")).includes("inconnu"));

await page.fill("#ec-code", kidA.code);
await page.click("#ec-access-submit");
await page.waitForSelector("#ec-app:not([hidden]) .ec-child-head");
check("e-mail + code ouvrent l'espace famille sur l'enfant de la fiche",
      (await page.textContent(".ec-child-head h1")) === "Léa" && (await page.textContent(".ec-child-head")).includes("P2"));
await page.waitForFunction(() => document.querySelectorAll(".ec-thumb canvas.ec-loaded").length === 3, null, { timeout: 15000 });
const sections = await page.$$eval(".ec-section h3", (els) => els.map((e) => e.textContent).join(" | "));
check("ses 2 photos et la photo de classe se dessinent (tuiles protégées)",
      (await page.locator(".ec-thumb canvas.ec-loaded").count()) === 3 && sections.includes("Photo de classe"), sections);
check("la date de commande groupée est annoncée", (await page.textContent(".ec-banner")).includes("2030"));
if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, "famille.png"), fullPage: true });

await page.locator(".ec-thumb").first().click();
await page.waitForSelector("#ec-lightbox-canvas.ec-loaded", { timeout: 10000 });
const big = await page.$eval("#ec-lightbox-canvas", (c) => c.width);
check("une photo s'ouvre en grand, en pleine définition", big >= 700, `${big} px`);
await page.keyboard.press("Escape");

await page.fill("#ec-add-code", kidB.code);
await page.click("#ec-add-form [type=submit]");
await page.waitForSelector(".ec-kids .ec-kid:nth-child(2), #ec-add-error:not([hidden])");
check("un deuxième enfant s'ajoute avec son code : deux onglets, un seul espace",
      (await page.locator(".ec-kid").count()) === 2, await page.locator("#ec-add-error").textContent().catch(() => ""));

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#ec-app:not([hidden]) .ec-child-head");
check("la session est gardée au retour sur la page", (await page.locator(".ec-kid").count()) === 2);

const token = await page.evaluate(() => JSON.parse(localStorage.getItem("holypixx-famille")).token);
const other = await createTestAccount(API, "famille-autre", { plan: "studio" });
const otherClient = new WorkerClient({ api: API, ...other });
const otherSchool = await otherClient.request("POST", "/api/admin/school/schools", { kind: "ecole", name: "Autre école" });
const { ids: [otherGroup] } = await otherClient.request("POST", `/api/admin/school/years/${otherSchool.yearId}/groups`, { names: ["X"] });
const strangerTile = await fetch(`${API}/api/family/tile/${photoOfB.id}/0/0/0`, { headers: { authorization: "Bearer " + token } });
check("la famille charge les photos de ses deux enfants…", strangerTile.status === 200);
await page.locator(".ec-kid").nth(1).click();
await page.locator("#ec-remove").click();
await page.locator("#ec-remove").click();
await page.waitForFunction(() => !document.querySelector(".ec-kids"));
const afterRemove = await fetch(`${API}/api/family/tile/${photoOfB.id}/0/0/0`, { headers: { authorization: "Bearer " + token } });
check("…mais plus celles d'un enfant retiré de son espace", afterRemove.status === 404);
const forged = await fetch(`${API}/api/family/tile/${photoOfB.id}/0/0/0`, { headers: { authorization: "Bearer faux.jeton" } });
check("sans jeton valide, aucune tuile", forged.status === 401);
void otherGroup;

await page.click("#ec-logout");
await page.waitForSelector("#ec-login:not([hidden])");
await page.click("#ec-switch");
await page.fill("#ec-link-email", PARENT);
await page.click("#ec-link-submit");
await page.waitForSelector("#ec-link-ok:not([hidden])");
check("sans fiche sous la main : demande d'un lien de connexion par e-mail (réponse neutre)",
      (await page.textContent("#ec-link-ok")).includes("lien de connexion"));
const badLink = await fetch(`${API}/api/family/login-link/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "inconnu" }) });
check("un lien de connexion inconnu ou expiré est refusé", badLink.status === 410);

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await mobile.goto(`http://localhost:${SITE_PORT}/ecole?c=${kidA.code}`, { waitUntil: "domcontentloaded" });
check("sur téléphone, pas de défilement horizontal", await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await mobile.route(/workers\.dev\/api\//, async (route) => {
  const upstream = await fetch(route.request().url().replace(/^https:\/\/[^/]+/, API), {
    method: route.request().method(), headers: route.request().headers(), body: route.request().postData() || undefined,
  });
  await route.fulfill({ status: upstream.status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: Buffer.from(await upstream.arrayBuffer()) });
});
await mobile.goto(`http://localhost:${SITE_PORT}/ecole?stop=fam_inconnu.faux`, { waitUntil: "domcontentloaded" });
await mobile.waitForSelector("#ec-login-notice:not([hidden])");
check("un lien de désinscription falsifié est signalé, sans rien casser", (await mobile.textContent("#ec-login-notice")).includes("invalide") && !mobile.url().includes("stop="));
if (process.env.SCREENSHOT_DIR) await mobile.screenshot({ path: join(process.env.SCREENSHOT_DIR, "famille-connexion.png") });
check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

await browser.close();
site.close();

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
