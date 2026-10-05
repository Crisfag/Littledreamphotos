// Espace de stockage, contre le vrai Worker local : mesure (tuiles,
// livraison HD, portfolio), quota de la formule, refus quand l'espace est
// plein, préavis puis purge des fichiers HD des galeries expirées depuis
// 90 jours. Autonome : crée ses comptes et ses galeries, nettoie derrière lui.
//
//   npm run dev:local                      (depuis worker/)
//   node tests/storage.test.mjs            (depuis tools/)

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { WorkerClient } from "../lib/client.mjs";
import { processPhoto } from "../lib/pipeline.mjs";
import { createTestAccount } from "./lib/testAccount.mjs";

const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKER_DIR = join(REPO_ROOT, "galerie", "worker");
const PHOTO = join(REPO_ROOT, "images", "famille", "famille-01.jpeg");
const DAY = 86400;

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

async function d1(sql) {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "galerie-protegee", "--local", "--json", "--command", sql], { cwd: WORKER_DIR, stdio: "pipe" });
  for (let i = 0; i < 20; i++) {
    try {
      if ((await fetch(`${API}/health`)).ok) break;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  try {
    // wrangler peut écrire une ligne d'information avant le JSON.
    const text = out.toString();
    return JSON.parse(text.slice(text.indexOf("[")))[0]?.results || [];
  } catch {
    return [];
  }
}

const OWNER_EMAIL = "fagnantchristine@gmail.com";
const OWNER_PASSWORD = "mot-de-passe-de-la-proprietaire-1234";
await fetch(`${API}/api/auth/signup`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD, studioName: "Holypixx" }),
});
const owner = new WorkerClient({ api: API, email: OWNER_EMAIL, password: OWNER_PASSWORD });

// Formule gratuite : 5 Go.
const account = await createTestAccount(API, "stockage", { plan: "" });
const client = new WorkerClient({ api: API, ...account });
const stamp = Date.now().toString(36);

async function storage() {
  return (await client.request("GET", "/api/admin/subscription")).usage.storage;
}
const crcOf = (buffer) => (zlib.crc32(buffer) >>> 0).toString(16).padStart(8, "0");
async function deliver(slug, name, buffer) {
  return client.request("PUT", `/api/admin/galleries/${slug}/delivery/files?name=${name}&crc=${crcOf(buffer)}`, buffer, true);
}

let s = await storage();
check("un compte neuf : rien d'utilisé, 5 Go en formule Découverte",
      s.usedBytes === 0 && s.quotaBytes === 5e9 && s.quotaLabel === "5 Go" && s.purgeAfterExpiryDays === 90, JSON.stringify(s));

/* ---------- Mesure ---------- */

const slugOld = `stock-vieille-${stamp}`;
const slugSoon = `stock-bientot-${stamp}`;
const old = await client.createGallery({ slug: slugOld, title: "Mariage 2025", clientName: "Martin", password: "mot-de-passe-stockage-1" });
const soon = await client.createGallery({ slug: slugSoon, title: "Séance printemps", clientName: "Dupont", password: "mot-de-passe-stockage-2" });
const input = await readFile(PHOTO);
const { photo, tiles } = await processPhoto(input, { galleryId: old.id, forensicKey: "cle-stockage", watermarkText: "Test", position: 0 });
await client.addPhoto(slugOld, photo);
for (const tile of tiles) await client.putTile(photo.id, tile.level, tile.col, tile.row, tile.buffer);
const hdOld = Buffer.alloc(400000, 3);
const hdSoon = Buffer.alloc(250000, 5);
await deliver(slugOld, "final-01.jpg", hdOld);
await deliver(slugSoon, "final-01.jpg", hdSoon);
await client.request("PUT", `/api/admin/photos/${photo.id}/original`, Buffer.alloc(120000, 9), true);

s = await storage();
check("l'espace compte les tuiles (estimées), les fichiers HD et le fichier d'impression",
      s.parts.galleries === 600000 && s.parts.delivery === 650000 && s.parts.originals === 120000 && s.usedBytes === 1370000, JSON.stringify(s.parts));
check("libellés lisibles", s.usedLabel === "1,4 Mo", s.usedLabel);

/* ---------- Quota ---------- */

// Simule un compte presque plein : un fichier livré fictif de 4,999 Go.
const fakeId = `dlv_fake_${stamp}`;
await d1(`INSERT INTO delivery_files (id, gallery_id, name, size, crc32, content_type, position, created_at) VALUES ('${fakeId}', '${soon.id}', 'enorme.jpg', 4999000000, 0, 'image/jpeg', 9, ${Math.floor(Date.now() / 1000)})`);
const refusedDelivery = await deliver(slugSoon, "final-02.jpg", Buffer.alloc(300000, 1)).catch((err) => err);
check("espace plein : un nouveau fichier HD est refusé avec un message clair",
      refusedDelivery.status === 402 && refusedDelivery.detail.includes("espace de stockage est plein") && refusedDelivery.detail.includes("5 Go"),
      refusedDelivery.detail);
const { photo: photo2 } = await processPhoto(input, { galleryId: old.id, forensicKey: "cle-stockage", watermarkText: "Test", position: 1 });
const refusedPhoto = await client.addPhoto(slugOld, photo2).catch((err) => err);
check("espace plein : une nouvelle photo de galerie est refusée aussi", refusedPhoto.status === 402);
s = await storage();
check("rien de ce qui était en ligne n'a été retiré", s.parts.delivery === 650000 + 4999000000 && s.parts.originals === 120000);
const ownerStorage = (await owner.request("GET", "/api/admin/subscription")).usage.storage;
check("la propriétaire n'a pas de limite", ownerStorage.quotaBytes === null && ownerStorage.quotaLabel === "illimité");
await d1(`DELETE FROM delivery_files WHERE id = '${fakeId}'`);
check("après suppression, les envois sont à nouveau acceptés",
      (await deliver(slugSoon, "final-02.jpg", Buffer.alloc(300000, 1)).catch((err) => err)).ok === true);

/* ---------- Préavis et purge ---------- */

const now = Math.floor(Date.now() / 1000);
await d1(`UPDATE galleries SET expires_at = ${now - 100 * DAY}, delivery_open = 1 WHERE id = '${old.id}'; UPDATE galleries SET expires_at = ${now - 80 * DAY} WHERE id = '${soon.id}'`);
const report = await owner.request("POST", "/api/owner/storage/purge");
check("la passe prévient pour la galerie expirée depuis 80 jours et purge celle expirée depuis 100 jours",
      report.notices >= 1 && report.purged >= 1, JSON.stringify(report));
const notices = await d1(`SELECT kind FROM reminders_sent WHERE gallery_id = '${soon.id}'`);
check("le préavis est enregistré avec la date d'expiration (une seule fois)",
      notices.length === 1 && notices[0].kind === `storage_purge_notice:${now - 80 * DAY}`, JSON.stringify(notices));
const again = await owner.request("POST", "/api/owner/storage/purge");
check("relancer la passe ne renvoie pas de second préavis",
      (await d1(`SELECT kind FROM reminders_sent WHERE gallery_id = '${soon.id}'`)).length === 1 && again.purged === 0, JSON.stringify(again));

const oldDetail = await client.request("GET", `/api/admin/galleries/${slugOld}`);
s = await storage();
check("purge : fichiers HD et d'impression effacés, livraison refermée",
      oldDetail.gallery.delivery.files.length === 0 && oldDetail.gallery.delivery.open === false && s.parts.originals === 0, JSON.stringify(oldDetail.gallery.delivery));
check("purge : les photos de la galerie restent en ligne", oldDetail.photos.length === 1);
check("la galerie prévenue garde ses fichiers jusqu'à la date annoncée", s.parts.delivery === 250000 + 300000, JSON.stringify(s.parts));
const firstTile = tiles[0];
const tileStill = await client.getTileResponse(photo.id, firstTile.level, firstTile.col, firstTile.row);
check("les tuiles de la galerie purgée sont toujours là", tileStill.ok, tileStill.status);

/* ---------- Nettoyage ---------- */

await client.request("POST", "/api/admin/account/delete", { confirm: "SUPPRIMER", password: account.password });

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
