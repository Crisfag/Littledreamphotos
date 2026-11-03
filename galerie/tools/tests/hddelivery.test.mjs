// HD retouchées livrées, de bout en bout : déposées dans la livraison d'une
// galerie, elles remplacent leur épreuve (même nom de fichier, ou choix à
// la main) — aperçus refaits à partir de la retouche, fichier d'impression
// = la HD — et la boutique de tirages ne propose plus que ces photos-là.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/hddelivery.test.mjs

import { chromium } from "playwright";
import { readFile, writeFile, mkdtemp, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { WorkerClient } from "../lib/client.mjs";
import { processPhoto } from "../lib/pipeline.mjs";
import { createTestAccount, localSql } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PROOFS = ["famille-01.jpeg", "famille-02.jpeg", "famille-03.jpeg"].map((n) => join(REPO_ROOT, "images", "famille", n));
const RETOUCHE = join(REPO_ROOT, "images", "maternite", "maternite-01.jpeg");
const SHOTS = process.env.SCREENSHOT_DIR || "";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

/* ---------- Galerie de sélection : 3 épreuves, boutique ouverte ---------- */

const account = await createTestAccount(API, "hd-boutique");
const client = new WorkerClient({ api: API, ...account });
const slug = `hd-${Date.now().toString(36)}`;
const PASSWORD = "mot-de-passe-hd";
const created = await client.createGallery({ slug, title: "Simon Alexandre", clientName: "Simon", password: PASSWORD });
const proofIds = [];
for (const [position, file] of PROOFS.entries()) {
  const { photo, tiles } = await processPhoto(await readFile(file), { galleryId: created.id, forensicKey: "cle-hd", watermarkText: "Test", position });
  await client.addPhoto(slug, { ...photo, sourceName: file.split("/").pop() });
  for (const tile of tiles) await client.putTile(photo.id, tile.level, tile.col, tile.row, tile.buffer);
  await client.putOriginal(photo.id, await sharp(await readFile(file)).jpeg().toBuffer());
  proofIds.push(photo.id);
}
await localSql(API, `UPDATE photographers SET prodigi_api_key_enc = 'test', stripe_account_id = 'acct_hd', stripe_charges_enabled = 1 WHERE email = '${account.email}'`);
await localSql(API, `UPDATE galleries SET shop_enabled = 1 WHERE slug = '${slug}'`);
await localSql(API, `INSERT INTO print_products (id, photographer_id, label, sku, price_cents, created_at)
  SELECT 'prd_hd_${slug}', id, 'Tirage 13x18', 'GLOBAL-PHO-5x7', 900, 0 FROM photographers WHERE email = '${account.email}'`);

async function clientPhotos() {
  const res = await fetch(`${API}/api/gallery/${slug}/login`, {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:8000" }, body: JSON.stringify({ password: PASSWORD }),
  });
  return (await res.json()).photos;
}
let photos = await clientPhotos();
check("avant livraison : les 3 épreuves sont proposées en tirage", photos.length === 3 && photos.every((p) => p.printable));

// HD « retouchées » : une autre image (portrait), sous le nom de l'épreuve
// n° 2 avec le suffixe d'export Lightroom, et une autre renommée.
const dir = await mkdtemp(join(tmpdir(), "hd-"));
const hdByName = join(dir, "famille-02-Edit.jpg");
const hdRenamed = join(dir, "Simon-Alexandre-final-3.jpg");
await copyFile(RETOUCHE, hdByName);
await writeFile(hdRenamed, await sharp(RETOUCHE).rotate(90).jpeg().toBuffer());
const retoucheMeta = await sharp(RETOUCHE).metadata();

const browser = await chromium.launch({ ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}) });
const exceptions = [];
const admin = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
admin.on("pageerror", (err) => exceptions.push(String(err)));
await admin.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

try {
  await admin.goto(BASE, { waitUntil: "domcontentloaded" });
  await admin.fill('#ad-login-form [name="email"]', account.email);
  await admin.fill('#ad-login-form [name="password"]', account.password);
  await admin.click("#ad-login-submit");
  await admin.waitForSelector("#ad-new-gallery", { timeout: 10000 });
  await admin.goto(`${BASE}/#/g/${encodeURIComponent(slug)}`, { waitUntil: "domcontentloaded" });
  await admin.waitForSelector("#ad-delivery-input", { state: "attached", timeout: 10000 });

  /* ---------- Dépôt des HD ---------- */

  const proof3Before = (await client.getGallery(slug)).photos.find((p) => p.id === proofIds[2]);
  await admin.setInputFiles("#ad-delivery-input", [hdByName, hdRenamed]);
  await admin.waitForFunction(() => document.querySelectorAll("[data-link-delivery]").length === 2, null, { timeout: 60000 });
  const toast = await admin.textContent(".ad-toast");
  check("dépôt : 1 HD sur 2 reliée d'elle-même (même nom de fichier)", /dont 1 reliée/.test(toast), toast);
  let info = await client.getGallery(slug);
  let proof2 = info.photos.find((p) => p.id === proofIds[1]);
  check("l'épreuve n° 2 prend les proportions de la retouche, et la HD comme fichier d'impression",
        proof2.delivery_file_id !== "" && Math.sign(proof2.width - proof2.height) === Math.sign(retoucheMeta.width - retoucheMeta.height) && proof2.has_original === 1,
        `${proof2.width}×${proof2.height}`);
  check("le compteur annonce 1 / 2 et propose de relier automatiquement",
        /1 \/ 2/.test(await admin.textContent(".ad-delivery-links")) && await admin.isVisible("#ad-delivery-autolink"));
  const linkedSelect = admin.locator(`[data-link-delivery] >> nth=0`);
  check("le menu de la HD reliée affiche la photo n° 2", /n° 2/.test(await linkedSelect.locator("option:checked").textContent()));

  photos = await clientPhotos();
  check("boutique : seule la photo retouchée est proposée en tirage",
        photos.filter((p) => p.printable).map((p) => p.id).join() === proofIds[1]);
  const hd = await (await client.rawGet(`/api/admin/photos/${proofIds[1]}/original`)).arrayBuffer();
  const hdMeta = await sharp(Buffer.from(hd)).metadata();
  check("le fichier d'impression est bien la retouche (pas l'épreuve brute)", hdMeta.width === retoucheMeta.width && hdMeta.height === retoucheMeta.height, `${hdMeta.width}×${hdMeta.height}`);

  /* ---------- HD renommée : relier à la main ---------- */

  await admin.click("#ad-delivery-autolink");
  await admin.waitForFunction(() => /à relier à la main/.test(document.querySelector(".ad-toast")?.textContent || ""), null, { timeout: 30000 });
  check("« Relier automatiquement » : la HD renommée reste à relier à la main", true);
  await admin.waitForSelector("[data-link-delivery]", { timeout: 10000 });
  const second = admin.locator("[data-link-delivery] >> nth=1");
  check("dans le menu, l'épreuve déjà reliée est indisponible", await second.locator(`option[value="${proofIds[1]}"]`).isDisabled());
  await second.selectOption(proofIds[2]);
  await admin.waitForFunction(() => /2 \/ 2/.test(document.querySelector(".ad-delivery-links")?.textContent || ""), null, { timeout: 60000 });
  info = await client.getGallery(slug);
  const proof3 = info.photos.find((p) => p.id === proofIds[2]);
  const renamedMeta = await sharp(hdRenamed).metadata();
  const ratio = (w, h) => Math.round((w / h) * 100);
  check("choisie à la main : l'épreuve n° 3 prend les proportions de sa retouche",
        proof3.delivery_file_id !== "" && ratio(proof3.width, proof3.height) === ratio(renamedMeta.width, renamedMeta.height) &&
        `${proof3.width}×${proof3.height}` !== `${proof3Before.width}×${proof3Before.height}`,
        `${proof3Before.width}×${proof3Before.height} → ${proof3.width}×${proof3.height}`);
  photos = await clientPhotos();
  check("boutique : les 2 photos retouchées, pas l'épreuve brute n° 1",
        photos.filter((p) => p.printable).map((p) => p.id).sort().join() === [proofIds[1], proofIds[2]].sort().join());
  const tile = await client.rawGet(`/api/admin/tiles/${proofIds[2]}/0/0/0`);
  check("les aperçus de la galerie sont refaits (tuile servie)", tile.ok);
  if (SHOTS) await admin.locator(".ad-delivery").screenshot({ path: join(SHOTS, "hd-livraison.png") });

  /* ---------- Retirer un lien ---------- */

  await admin.locator("[data-link-delivery] >> nth=1").selectOption("");
  await admin.waitForFunction(() => /1 \/ 2/.test(document.querySelector(".ad-delivery-links")?.textContent || ""), null, { timeout: 30000 });
  photos = await clientPhotos();
  check("lien retiré : la photo n'est plus proposée en tirage", photos.filter((p) => p.printable).map((p) => p.id).join() === proofIds[1]);

  await admin.setViewportSize({ width: 390, height: 844 });
  await admin.waitForTimeout(300);
  const overflow = await admin.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : la liste de livraison tient dans l'écran", overflow <= 0, `${overflow}px`);
  if (SHOTS) await admin.locator(".ad-delivery").screenshot({ path: join(SHOTS, "hd-livraison-mobile.png") });

  check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
} finally {
  await browser.close();
  await client.deleteGallery(slug).catch(() => {});
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
