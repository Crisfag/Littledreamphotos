// Livraison des photos définitives, côté client, dans un vrai navigateur,
// contre le vrai Worker local : encart « Vos photos sont prêtes », ZIP et
// téléchargement d'une seule photo. Autonome : crée son compte et sa
// galerie, nettoie derrière lui.
//
//   npm run dev:local                      (depuis worker/)
//   node tests/delivery.test.mjs           (depuis tools/)

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { WorkerClient } from "../lib/client.mjs";
import { processPhoto } from "../lib/pipeline.mjs";
import { createTestAccount } from "./lib/testAccount.mjs";

const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_DIR = join(REPO_ROOT, "galerie", "web");
const PHOTO = join(REPO_ROOT, "images", "famille", "famille-01.jpeg");
const SITE_PORT = Number(process.env.SITE_PORT || 8000); // seule origine locale autorisée par le Worker

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const account = await createTestAccount(API, "livraison");
const client = new WorkerClient({ api: API, ...account });
const slug = `livraison-${Date.now().toString(36)}`;
const PASSWORD = "mot-de-passe-livraison-test";
const created = await client.createGallery({ slug, title: "Séance Dupont", clientName: "Famille Dupont", password: PASSWORD });
const input = await readFile(PHOTO);
const { photo, tiles } = await processPhoto(input, { galleryId: created.id, forensicKey: "cle-de-test-livraison", watermarkText: "Test", position: 0 });
await client.addPhoto(slug, photo);
for (const tile of tiles) await client.putTile(photo.id, tile.level, tile.col, tile.row, tile.buffer);

const finals = [["final-01.jpg", Buffer.alloc(300000, 9)], ["final-02.jpg", Buffer.alloc(120000, 4)]];
for (const [name, buffer] of finals) {
  const crc = (zlib.crc32(buffer) >>> 0).toString(16).padStart(8, "0");
  await client.request("PUT", `/api/admin/galleries/${slug}/delivery/files?name=${name}&crc=${crc}`, buffer, true);
}

const TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8" };
const site = createServer(async (req, res) => {
  const pathname = req.url.split("?")[0] === "/" ? "/galerie.html" : req.url.split("?")[0];
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
await new Promise((resolve, reject) => {
  site.once("error", reject);
  site.listen(SITE_PORT, "localhost", resolve);
});

// Système en UTF-8 : sans cela, Chromium sous Linux remplace par
// « download » tout nom de fichier accentué (« Séance Dupont.zip »).
const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ["--disable-features=LocalNetworkAccessChecks"],
  env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
});
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1200, height: 900 } });
const page = await context.newPage();
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));

async function login() {
  await page.goto(`http://localhost:${SITE_PORT}/galerie.html?g=${slug}`, { waitUntil: "domcontentloaded" });
  await page.fill("#gp-password", PASSWORD);
  await page.click("#gp-submit");
  await page.waitForSelector("#gp-gallery:not([hidden])", { timeout: 10000 });
  await page.waitForTimeout(400);
}

await login();
check("tant que la livraison est fermée, le client ne voit aucun encart", await page.isHidden("#gp-delivery"));

await client.request("POST", `/api/admin/galleries/${slug}/delivery`, { open: true });
await login();
check("une fois ouverte, l'encart « Vos photos sont prêtes » annonce le nombre et le poids",
      await page.isVisible("#gp-delivery") && (await page.textContent("#gp-delivery-summary")).includes("2 photos") &&
      (await page.textContent("#gp-delivery-zip")).includes("Tout télécharger"));

const [zipDownload] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.click("#gp-delivery-zip")]);
const zipPath = await zipDownload.path();
const zipBytes = await readFile(zipPath);
check("« Tout télécharger » enregistre un ZIP nommé d'après la galerie, avec les deux photos",
      zipDownload.suggestedFilename() === "Séance Dupont.zip" && zipBytes.length > 420000 && zipBytes.subarray(0, 4).toString("hex") === "504b0304",
      `${zipDownload.suggestedFilename()} ${zipBytes.length}`);

await page.click(".gp-delivery-files summary");
const [oneDownload] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.locator(".gp-delivery-one").nth(1).click()]);
const oneBytes = await readFile(await oneDownload.path());
check("une photo se télécharge seule, à l'identique",
      oneDownload.suggestedFilename() === "final-02.jpg" && oneBytes.equals(finals[1][1]), oneDownload.suggestedFilename());

check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

await browser.close();
site.close();
await client.request("DELETE", `/api/admin/galleries/${slug}`).catch(() => {});

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
