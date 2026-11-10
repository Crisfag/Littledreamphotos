// Fenêtre « Vous venez de faire une capture d'écran » côté client, dans un
// vrai navigateur : une capture signalée au photographe (touche Impr. écran)
// l'affiche, avec le nom du studio ; un geste qui n'alerte pas le
// photographe (Ctrl+S) ne l'affiche pas.
//
//   npm run dev:local                          (depuis worker/)
//   node tests/capturenotice.test.mjs          (depuis tools/)

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../lib/client.mjs";
import { processPhoto } from "../lib/pipeline.mjs";
import { createTestAccount } from "./lib/testAccount.mjs";

const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_DIR = join(REPO_ROOT, "galerie", "web");
const SITE_PORT = Number(process.env.SITE_PORT || 8000);
const SHOTS = process.env.SCREENSHOT_DIR || "";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const account = await createTestAccount(API, "capture");
const client = new WorkerClient({ api: API, ...account });
const slug = `capture-${Date.now().toString(36)}`;
const created = await client.createGallery({ slug, title: "Séance de Noël", clientName: "Léa", password: "mot-de-passe-capture" });
const { photo, tiles } = await processPhoto(await readFile(join(REPO_ROOT, "images", "famille", "famille-01.jpeg")), { galleryId: created.id, forensicKey: "cle-capture", watermarkText: "Test", position: 0 });
await client.addPhoto(slug, photo);
for (const tile of tiles) await client.putTile(photo.id, tile.level, tile.col, tile.row, tile.buffer);

const TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8" };
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

const browser = await chromium.launch({ ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}), args: ["--disable-features=LocalNetworkAccessChecks"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

try {
  await page.goto(`http://localhost:${SITE_PORT}/galerie.html?g=${slug}`, { waitUntil: "domcontentloaded" });
  await page.fill("#gp-password", "mot-de-passe-capture");
  await page.click("#gp-submit");
  await page.waitForSelector("#gp-gallery:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(500);
  check("au départ, aucune fenêtre", await page.isHidden("#gp-capture"));

  await page.keyboard.press("Control+s");
  await page.waitForTimeout(1200);
  check("Ctrl+S (pas d'alerte au photographe) : pas de fenêtre", await page.isHidden("#gp-capture"));

  await page.keyboard.press("PrintScreen");
  await page.waitForSelector("#gp-capture:not([hidden])", { timeout: 5000 });
  const text = await page.innerText("#gp-capture");
  check("Impr. écran : « Vous venez de faire une capture d'écran », signalement au studio nommé",
        /Vous venez de faire une capture d'écran/.test(text) && /signalement a été envoyé à votre photographe \(Suite de tests — capture\)/.test(text), text.replace(/\n/g, " | "));
  check("le bouton « J'ai compris » a le focus", await page.evaluate(() => document.activeElement?.id === "gp-capture-ok"));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "capture-fenetre.png") });
  const log = await client.request("GET", `/api/admin/galleries/${slug}/log`);
  const events = (log.events || log.log || log.entries || log).filter?.((e) => e.event === "capture_suspected") || [];
  check("la capture est bien inscrite au journal du photographe", events.some((e) => e.detail === "impr-ecran"), JSON.stringify(events.map((e) => e.detail)));
  await page.click("#gp-capture-ok");
  check("« J'ai compris » ferme la fenêtre", await page.isHidden("#gp-capture"));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press("PrintScreen");
  await page.waitForSelector("#gp-capture:not([hidden])", { timeout: 5000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : la fenêtre tient dans l'écran", overflow <= 0, `${overflow}px`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "capture-fenetre-mobile.png") });
  await page.keyboard.press("Escape");
  check("Échap ferme aussi la fenêtre", await page.isHidden("#gp-capture"));
  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} finally {
  await browser.close();
  site.close();
  await client.deleteGallery(slug).catch(() => {});
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
