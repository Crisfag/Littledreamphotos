// Espace de stockage des photographes : mesure, quota par formule, et purge
// des gros fichiers des galeries expirées depuis longtemps.
//
// Mesure. Le Worker ne relit jamais R2 pour compter (trop lent, trop
// coûteux) : il additionne ce qu'il sait déjà en base.
//   - fichiers livrés en haute définition : delivery_files.size (exact) ;
//   - fichiers d'impression : photos.original_bytes (exact, renseigné à l'envoi) ;
//   - photos du portfolio : portfolio_photos.bytes (exact) ;
//   - tuiles des galeries : une ESTIMATION par photo (TILE_BYTES_PER_PHOTO),
//     les tuiles étant petites et de taille très régulière.
//
// Quota. Chaque formule a son espace (voir PLANS dans subscription.js). Un
// envoi qui le ferait dépasser est refusé (402) avec un message clair ;
// rien de ce qui est déjà en ligne n'est jamais retiré pour cause de quota.
//
// Purge. Les fichiers HD livrés et les fichiers d'impression d'une galerie
// expirée depuis PURGE_AFTER_EXPIRY_DAYS jours sont effacés (les tuiles,
// légères, restent : la galerie peut être prolongée). Le photographe est
// prévenu par e-mail PURGE_NOTICE_DAYS jours avant ; prolonger la galerie
// repousse la purge d'autant.

import { fail } from "./http.js";
import { planFor, isOwner } from "./subscription.js";
import { sendStoragePurgeNotice } from "./notify.js";

export const TILE_BYTES_PER_PHOTO = 600 * 1000;
export const PURGE_AFTER_EXPIRY_DAYS = 90;
export const PURGE_NOTICE_DAYS = 14;
const DAY = 24 * 60 * 60;
// Galeries traitées par passe quotidienne : borne le travail d'une passe,
// le reste attend le lendemain.
const PURGE_BATCH = 25;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function originalKey(galleryId, photoId) {
  // Sous le préfixe de la photo : effacé avec elle (et avec la galerie) par
  // les boucles de suppression existantes, sans rien à ajouter. Jamais
  // atteignable par la route des tuiles, qui n'accepte que des nombres.
  return `${galleryId}/${photoId}/original.jpg`;
}

function deliveryObjectKey(galleryId, fileId) {
  return `${galleryId}/delivery/${fileId}`;
}

// « 850 Mo », « 12,3 Go », « 1 To » (unités décimales, comme les offres du marché).
export function formatBytes(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  const fmt = (v, unit) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: v < 10 ? 1 : 0 })} ${unit}`;
  if (n >= 1e12) return fmt(n / 1e12, "To");
  if (n >= 1e9) return fmt(n / 1e9, "Go");
  return fmt(n / 1e6, "Mo");
}

// Quota en octets, ou null (illimité : la propriétaire de la plateforme).
export function storageQuotaFor(env, photographer) {
  if (isOwner(env, photographer)) return null;
  return planFor(env, photographer).storageBytes ?? null;
}

export async function storageUsage(env, photographerId) {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM photos ph JOIN galleries g ON g.id = ph.gallery_id WHERE g.photographer_id = ?1) AS photos,
       (SELECT COALESCE(SUM(ph.original_bytes), 0) FROM photos ph JOIN galleries g ON g.id = ph.gallery_id WHERE g.photographer_id = ?1) AS originals,
       (SELECT COALESCE(SUM(d.size), 0) FROM delivery_files d JOIN galleries g ON g.id = d.gallery_id WHERE g.photographer_id = ?1) AS delivery,
       (SELECT COALESCE(SUM(bytes), 0) FROM portfolio_photos WHERE photographer_id = ?1) AS portfolio`
  )
    .bind(photographerId)
    .first();
  const parts = {
    galleries: (row?.photos || 0) * TILE_BYTES_PER_PHOTO,
    originals: row?.originals || 0,
    delivery: row?.delivery || 0,
    portfolio: row?.portfolio || 0,
  };
  return { totalBytes: parts.galleries + parts.originals + parts.delivery + parts.portfolio, parts };
}

export function storageRefusalMessage(plan, quotaBytes) {
  return `Votre espace de stockage est plein (${formatBytes(quotaBytes)} avec la formule ${plan.label}). ` +
    "Supprimez d'anciennes galeries ou livraisons, ou passez à la formule supérieure (onglet Abonnement).";
}

// null si `extraBytes` de plus tiennent dans le quota, sinon la réponse 402.
export async function storageRefusal(env, photographer, extraBytes) {
  const quota = storageQuotaFor(env, photographer);
  if (quota === null) return null;
  const { totalBytes } = await storageUsage(env, photographer.id);
  if (totalBytes + Math.max(0, Number(extraBytes) || 0) <= quota) return null;
  return fail(402, storageRefusalMessage(planFor(env, photographer), quota));
}

export async function storageForAdmin(env, photographer) {
  const usage = await storageUsage(env, photographer.id);
  const quota = storageQuotaFor(env, photographer);
  return {
    usedBytes: usage.totalBytes,
    quotaBytes: quota,
    parts: usage.parts,
    usedLabel: formatBytes(usage.totalBytes),
    quotaLabel: quota === null ? "illimité" : formatBytes(quota),
    purgeAfterExpiryDays: PURGE_AFTER_EXPIRY_DAYS,
  };
}

/* ---------- Purge des galeries expirées ---------- */

// Date (secondes) à laquelle les gros fichiers d'une galerie seront effacés.
export function purgeDateFor(expiresAt) {
  return expiresAt ? expiresAt + PURGE_AFTER_EXPIRY_DAYS * DAY : null;
}

async function heavyFilesOf(env, galleryId) {
  const [{ results: delivery }, { results: originals }] = await Promise.all([
    env.DB.prepare("SELECT id, size FROM delivery_files WHERE gallery_id = ?").bind(galleryId).all(),
    env.DB.prepare("SELECT id, original_bytes FROM photos WHERE gallery_id = ? AND has_original = 1").bind(galleryId).all(),
  ]);
  return { delivery: delivery || [], originals: originals || [] };
}

// Une commande de tirages payée mais pas encore partie au labo a encore
// besoin de ses fichiers d'impression : on ne les efface pas.
async function hasPendingPrintOrder(env, galleryId) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM print_orders WHERE gallery_id = ? AND status IN ('paid', 'failed')"
  )
    .bind(galleryId)
    .first();
  return (row?.n || 0) > 0;
}

async function purgeGallery(env, gallery) {
  const files = await heavyFilesOf(env, gallery.id);
  const keepOriginals = files.originals.length > 0 && (await hasPendingPrintOrder(env, gallery.id));
  for (const f of files.delivery) await env.TILES.delete(deliveryObjectKey(gallery.id, f.id));
  if (!keepOriginals) for (const p of files.originals) await env.TILES.delete(originalKey(gallery.id, p.id));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM delivery_files WHERE gallery_id = ?").bind(gallery.id),
    env.DB.prepare("UPDATE galleries SET delivery_open = 0 WHERE id = ?").bind(gallery.id),
    ...(keepOriginals ? [] : [env.DB.prepare("UPDATE photos SET has_original = 0, original_bytes = 0 WHERE gallery_id = ?").bind(gallery.id)]),
  ]);
  return {
    deliveryFiles: files.delivery.length,
    originals: keepOriginals ? 0 : files.originals.length,
    bytes: files.delivery.reduce((n, f) => n + (f.size || 0), 0) +
      (keepOriginals ? 0 : files.originals.reduce((n, p) => n + (p.original_bytes || 0), 0)),
  };
}

// Galeries expirées qui portent encore des fichiers HD ou d'impression.
async function galleriesWithHeavyFiles(env, { expiredBefore, expiredAfter = 0 }) {
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.slug, g.title, g.expires_at, p.email AS photographer_email, p.studio_name,
            (SELECT COUNT(*) FROM delivery_files d WHERE d.gallery_id = g.id) AS delivery_count,
            (SELECT COALESCE(SUM(d.size), 0) FROM delivery_files d WHERE d.gallery_id = g.id) AS delivery_bytes,
            (SELECT COUNT(*) FROM photos ph WHERE ph.gallery_id = g.id AND ph.has_original = 1) AS original_count
     FROM galleries g JOIN photographers p ON p.id = g.photographer_id
     WHERE g.expires_at IS NOT NULL AND g.expires_at <= ? AND g.expires_at > ?
       AND (EXISTS (SELECT 1 FROM delivery_files d WHERE d.gallery_id = g.id)
            OR (EXISTS (SELECT 1 FROM photos ph WHERE ph.gallery_id = g.id AND ph.has_original = 1)
                AND NOT EXISTS (SELECT 1 FROM print_orders po WHERE po.gallery_id = g.id AND po.status IN ('paid', 'failed'))))
     ORDER BY g.expires_at ASC
     LIMIT ?`
  )
    .bind(expiredBefore, expiredAfter, PURGE_BATCH)
    .all();
  return results || [];
}

// Passe quotidienne (déclencheur planifié) : préavis, puis purge.
export async function runStoragePurge(env, options = {}) {
  const now = options.now || nowSeconds();
  const report = { notices: 0, purged: 0, bytes: 0 };

  // 1. Préavis : purge prévue dans moins de PURGE_NOTICE_DAYS jours. La clé
  // du rappel porte la date d'expiration : une galerie prolongée puis à
  // nouveau expirée sera prévenue à nouveau.
  const soon = await galleriesWithHeavyFiles(env, {
    expiredBefore: now - (PURGE_AFTER_EXPIRY_DAYS - PURGE_NOTICE_DAYS) * DAY,
    expiredAfter: now - PURGE_AFTER_EXPIRY_DAYS * DAY,
  });
  for (const g of soon) {
    const kind = `storage_purge_notice:${g.expires_at}`;
    const inserted = await env.DB.prepare("INSERT OR IGNORE INTO reminders_sent (gallery_id, kind, sent_at) VALUES (?, ?, ?)")
      .bind(g.id, kind, now)
      .run();
    if (!inserted?.meta?.changes) continue;
    await sendStoragePurgeNotice(env, {
      to: g.photographer_email,
      studioName: g.studio_name,
      galleryTitle: g.title,
      deliveryCount: g.delivery_count,
      originalCount: g.original_count,
      sizeLabel: formatBytes(g.delivery_bytes),
      purgeAt: purgeDateFor(g.expires_at),
      adminUrl: env.ADMIN_URL ? `${env.ADMIN_URL.replace(/\/+$/, "")}/#/g/${encodeURIComponent(g.slug)}` : "",
    });
    report.notices += 1;
  }

  // 2. Purge : expirées depuis plus de PURGE_AFTER_EXPIRY_DAYS jours.
  const due = await galleriesWithHeavyFiles(env, { expiredBefore: now - PURGE_AFTER_EXPIRY_DAYS * DAY });
  for (const g of due) {
    const result = await purgeGallery(env, g);
    report.purged += 1;
    report.bytes += result.bytes;
  }
  return report;
}
