// Livraison des photos définitives : le photographe dépose les fichiers
// finaux (haute définition, sans filigrane) sur la galerie, puis ouvre la
// livraison ; le client les télécharge une par une ou toutes d'un coup dans
// un ZIP.
//
// Le ZIP est fabriqué au fil de l'eau, sans compression (des JPEG ne se
// compressent de toute façon pas) : le Worker se contente d'enchaîner
// en-têtes et contenus lus dans R2, sans jamais charger un fichier en
// mémoire ni le parcourir. Le CRC-32 de chaque fichier, exigé par le format
// ZIP, est donc calculé à l'envoi par l'outil d'administration et stocké avec
// le fichier. La taille totale est connue d'avance : le navigateur affiche
// une vraie progression.
//
// Les téléchargements passent par des liens signés valables quelques
// minutes (un lien de navigateur ne peut pas porter l'en-tête de session),
// signés avec une clé distincte de celle des sessions : un lien de
// téléchargement ne vaut jamais session.

import { json, fail } from "./http.js";
import { signToken, verifyToken, randomBytes, b64url } from "./auth.js";
import { storageRefusal } from "./storage.js";

export const MAX_DELIVERY_FILE_BYTES = 80 * 1024 * 1024;
// Au-delà de 4 Go, le format ZIP classique ne suffit plus (ZIP64) : on reste
// en dessous, largement assez pour une séance.
export const MAX_DELIVERY_TOTAL_BYTES = 4000 * 1024 * 1024;
const LINK_TTL_SECONDS = 15 * 60;
const MAX_FILES = 500;

const enc = new TextEncoder();

function now() {
  return Math.floor(Date.now() / 1000);
}

export function deliveryKey(galleryId, fileId) {
  // Sous le préfixe de la galerie : effacé avec elle (voir deleteGallery).
  return `${galleryId}/delivery/${fileId}`;
}

// Nom de fichier sûr pour un ZIP et un en-tête Content-Disposition : pas de
// chemin, pas de caractère de contrôle, extension conservée.
export function safeFileName(name) {
  const base = String(name || "").split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"]/g, "").trim();
  return (base || "photo.jpg").slice(-150);
}

// Noms uniques dans le ZIP : « photo.jpg », « photo (2).jpg »…
export function uniqueNames(names) {
  const seen = new Map();
  return names.map((name) => {
    const lower = name.toLowerCase();
    if (!seen.has(lower)) {
      seen.set(lower, 1);
      return name;
    }
    let n = seen.get(lower);
    let candidate;
    do {
      n += 1;
      const dot = name.lastIndexOf(".");
      candidate = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
    } while (seen.has(candidate.toLowerCase()));
    seen.set(lower, n);
    seen.set(candidate.toLowerCase(), 1);
    return candidate;
  });
}

/* ---------- Format ZIP (sans compression) ---------- */

function dosDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  const day = ((Math.max(1980, d.getUTCFullYear()) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, day };
}

function header(size) {
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
}

export function localFileHeader(entry) {
  const name = enc.encode(entry.name);
  const { bytes, view } = header(30 + name.length);
  const { time, day } = dosDateTime(entry.date);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true); // noms en UTF-8
  view.setUint16(8, 0, true); // stocké, sans compression
  view.setUint16(10, time, true);
  view.setUint16(12, day, true);
  view.setUint32(14, entry.crc32 >>> 0, true);
  view.setUint32(18, entry.size, true);
  view.setUint32(22, entry.size, true);
  view.setUint16(26, name.length, true);
  view.setUint16(28, 0, true);
  bytes.set(name, 30);
  return bytes;
}

export function centralDirectoryHeader(entry, offset) {
  const name = enc.encode(entry.name);
  const { bytes, view } = header(46 + name.length);
  const { time, day } = dosDateTime(entry.date);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, time, true);
  view.setUint16(14, day, true);
  view.setUint32(16, entry.crc32 >>> 0, true);
  view.setUint32(20, entry.size, true);
  view.setUint32(24, entry.size, true);
  view.setUint16(28, name.length, true);
  // extra, commentaire, disque, attributs : 0
  view.setUint32(42, offset, true);
  bytes.set(name, 46);
  return bytes;
}

export function endOfCentralDirectory(count, cdSize, cdOffset) {
  const { bytes, view } = header(22);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, cdSize, true);
  view.setUint32(16, cdOffset, true);
  return bytes;
}

// Plan complet du ZIP : décalage de chaque fichier, répertoire central et
// taille totale, sans lire aucun contenu.
export function zipPlan(entries) {
  let offset = 0;
  const placed = entries.map((entry) => {
    const local = localFileHeader(entry);
    const item = { ...entry, local, offset };
    offset += local.length + entry.size;
    return item;
  });
  const central = placed.map((item) => centralDirectoryHeader(item, item.offset));
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = endOfCentralDirectory(placed.length, cdSize, offset);
  return { placed, central, end, totalSize: offset + cdSize + end.length };
}

// CRC-32 (polynôme ZIP), pour les tests et les outils : le Worker lui-même
// ne le calcule jamais.
let crcTable = null;
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/* ---------- Données ---------- */

async function listFiles(env, galleryId) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM delivery_files WHERE gallery_id = ? ORDER BY position ASC, created_at ASC, name ASC"
  )
    .bind(galleryId)
    .all();
  return results;
}

function fileOut(row) {
  return { id: row.id, name: row.name, size: row.size, createdAt: row.created_at };
}

// Ce que la page client reçoit à la connexion.
export async function deliveryForClient(env, gallery) {
  if (!gallery.delivery_open) return null;
  const files = await listFiles(env, gallery.id);
  if (!files.length) return null;
  return {
    files: files.map((f) => ({ id: f.id, name: f.name, size: f.size })),
    totalBytes: files.reduce((n, f) => n + f.size, 0),
    openedAt: gallery.delivery_opened_at || null,
  };
}

/* ---------- Admin (galerie déjà vérifiée comme appartenant au photographe) ---------- */

export async function deliveryForAdmin(env, gallery) {
  const files = await listFiles(env, gallery.id);
  return {
    open: Boolean(gallery.delivery_open),
    openedAt: gallery.delivery_opened_at || null,
    notifiedAt: gallery.delivery_notified_at || null,
    files: files.map(fileOut),
    totalBytes: files.reduce((n, f) => n + f.size, 0),
  };
}

// PUT …/delivery/files?name=…&crc=… (corps : le fichier)
async function addFile(request, env, gallery) {
  const url = new URL(request.url);
  const name = safeFileName(url.searchParams.get("name"));
  const crcText = url.searchParams.get("crc") || "";
  if (!/^[0-9a-f]{8}$/i.test(crcText)) return fail(400, "Empreinte CRC-32 manquante (envoyez le fichier depuis l'interface d'administration)");
  if (!/\.(jpe?g|png|tiff?|webp|heic)$/i.test(name)) return fail(400, "Formats acceptés : JPEG, PNG, TIFF, WebP, HEIC");
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_DELIVERY_FILE_BYTES) return fail(413, "Fichier trop volumineux (80 Mo maximum)");

  const existing = await listFiles(env, gallery.id);
  if (existing.length >= MAX_FILES) return fail(409, `${MAX_FILES} fichiers maximum par galerie`);
  const used = existing.reduce((n, f) => n + f.size, 0);
  const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(gallery.photographer_id).first();
  const storageFull = await storageRefusal(env, photographer, declared);
  if (storageFull) return storageFull;

  const id = `dlv_${b64url(randomBytes(9))}`;
  const key = deliveryKey(gallery.id, id);
  const contentType = /\.png$/i.test(name) ? "image/png" : /\.tiff?$/i.test(name) ? "image/tiff"
    : /\.webp$/i.test(name) ? "image/webp" : /\.heic$/i.test(name) ? "image/heic" : "image/jpeg";
  const stored = await env.TILES.put(key, request.body, { httpMetadata: { contentType } });
  const size = stored?.size ?? 0;
  if (!size || size > MAX_DELIVERY_FILE_BYTES || used + size > MAX_DELIVERY_TOTAL_BYTES) {
    await env.TILES.delete(key);
    if (!size) return fail(400, "Fichier vide");
    if (size > MAX_DELIVERY_FILE_BYTES) return fail(413, "Fichier trop volumineux (80 Mo maximum)");
    return fail(413, "Livraison trop volumineuse (4 Go maximum par galerie)");
  }
  await env.DB.prepare(
    `INSERT INTO delivery_files (id, gallery_id, name, size, crc32, content_type, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, gallery.id, name, size, parseInt(crcText, 16) >>> 0, contentType, existing.length, now())
    .run();
  return json({ ok: true, file: { id, name, size } }, { status: 201 });
}

async function deleteFile(env, gallery, fileId) {
  const row = await env.DB.prepare("SELECT id FROM delivery_files WHERE id = ? AND gallery_id = ?")
    .bind(fileId, gallery.id)
    .first();
  if (!row) return fail(404, "Fichier introuvable");
  await env.TILES.delete(deliveryKey(gallery.id, row.id));
  await env.DB.prepare("DELETE FROM delivery_files WHERE id = ?").bind(row.id).run();
  return json({ ok: true });
}

// POST …/delivery { open: true|false, notify: true|false }
async function setOpen(request, env, gallery, helpers) {
  const body = await request.json().catch(() => null);
  const open = body?.open === true;
  if (open) {
    const files = await listFiles(env, gallery.id);
    if (!files.length) return fail(409, "Déposez d'abord les photos à livrer");
  }
  const openedAt = open ? gallery.delivery_opened_at || now() : null;
  await env.DB.prepare("UPDATE galleries SET delivery_open = ?, delivery_opened_at = ? WHERE id = ?")
    .bind(open ? 1 : 0, openedAt, gallery.id)
    .run();
  let notified = false;
  if (open && body?.notify === true && gallery.client_email && helpers?.notifyClient) {
    await helpers.notifyClient(gallery);
    await env.DB.prepare("UPDATE galleries SET delivery_notified_at = ? WHERE id = ?").bind(now(), gallery.id).run();
    notified = true;
  }
  return json({ ok: true, open, notified });
}

export async function handleDeliveryAdmin(request, env, gallery, rest, helpers) {
  // rest : segments après /api/admin/galleries/<slug>/delivery
  if (rest.length === 0 && request.method === "GET") return json(await deliveryForAdmin(env, gallery));
  if (rest.length === 0 && request.method === "POST") return setOpen(request, env, gallery, helpers);
  if (rest.length === 1 && rest[0] === "files" && request.method === "PUT") return addFile(request, env, gallery);
  if (rest.length === 2 && rest[0] === "files" && request.method === "DELETE") return deleteFile(env, gallery, decodeURIComponent(rest[1]));
  return fail(404, "Route inconnue");
}

/* ---------- Client ---------- */

function linkSecret(env) {
  return `${env.TOKEN_SECRET}:livraison`;
}

// POST /api/gallery/<slug>/delivery/link { fileId? } (session déjà vérifiée)
// → { url } : lien de téléchargement d'un fichier, ou du ZIP complet.
export async function createDownloadLink(request, env, gallery, viewerId, origin) {
  if (!gallery.delivery_open) return fail(404, "Aucune livraison");
  const body = await request.json().catch(() => ({}));
  const fileId = body && typeof body.fileId === "string" ? body.fileId : "";
  if (fileId) {
    const row = await env.DB.prepare("SELECT id FROM delivery_files WHERE id = ? AND gallery_id = ?")
      .bind(fileId, gallery.id)
      .first();
    if (!row) return fail(404, "Fichier introuvable");
  }
  const token = await signToken(linkSecret(env), { g: gallery.id, f: fileId || "*", v: viewerId || "", exp: now() + LINK_TTL_SECONDS });
  const path = fileId
    ? `/api/gallery/${encodeURIComponent(gallery.slug)}/delivery/file/${encodeURIComponent(fileId)}`
    : `/api/gallery/${encodeURIComponent(gallery.slug)}/delivery/zip`;
  return json({ url: `${origin}${path}?t=${encodeURIComponent(token)}`, expiresIn: LINK_TTL_SECONDS });
}

async function checkLink(request, env, gallery, expectedFile) {
  const token = new URL(request.url).searchParams.get("t") || "";
  const payload = await verifyToken(linkSecret(env), token);
  if (!payload || payload.g !== gallery.id || payload.f !== expectedFile) return null;
  return payload;
}

function disposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// GET …/delivery/file/<id>?t=…
export async function downloadFile(request, env, gallery, fileId, log) {
  if (!gallery.delivery_open) return fail(404, "Aucune livraison");
  const payload = await checkLink(request, env, gallery, fileId);
  if (!payload) return fail(403, "Lien expiré : relancez le téléchargement depuis la galerie");
  const row = await env.DB.prepare("SELECT * FROM delivery_files WHERE id = ? AND gallery_id = ?")
    .bind(fileId, gallery.id)
    .first();
  if (!row) return fail(404, "Fichier introuvable");
  const object = await env.TILES.get(deliveryKey(gallery.id, row.id));
  if (!object) return fail(404, "Fichier introuvable");
  await log?.({ viewerId: payload.v, event: "download", detail: row.name });
  return new Response(object.body, {
    headers: {
      "content-type": row.content_type || "application/octet-stream",
      "content-length": String(object.size),
      "content-disposition": disposition(row.name),
      "cache-control": "private, no-store",
    },
  });
}

// GET …/delivery/zip?t=…
export async function downloadZip(request, env, ctx, gallery, log) {
  if (!gallery.delivery_open) return fail(404, "Aucune livraison");
  const payload = await checkLink(request, env, gallery, "*");
  if (!payload) return fail(403, "Lien expiré : relancez le téléchargement depuis la galerie");
  const rows = await listFiles(env, gallery.id);
  if (!rows.length) return fail(404, "Aucune livraison");

  const names = uniqueNames(rows.map((r) => r.name));
  const plan = zipPlan(rows.map((r, i) => ({
    id: r.id, name: names[i], size: r.size, crc32: r.crc32, date: new Date((r.created_at || now()) * 1000),
  })));
  const { readable, writable } = new FixedLengthStream(plan.totalSize);
  const writer = writable.getWriter();

  const pump = (async () => {
    try {
      for (const item of plan.placed) {
        await writer.write(item.local);
        const object = await env.TILES.get(deliveryKey(gallery.id, item.id));
        if (!object || object.size !== item.size) throw new Error(`Fichier manquant ou modifié : ${item.name}`);
        const reader = object.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
      }
      for (const c of plan.central) await writer.write(c);
      await writer.write(plan.end);
      await writer.close();
    } catch (err) {
      console.error("ZIP de livraison interrompu :", err && err.message);
      await writer.abort(err).catch(() => {});
    }
  })();
  ctx?.waitUntil?.(pump);
  await log?.({ viewerId: payload.v, event: "download", detail: `ZIP (${rows.length} fichiers)` });

  const fileName = `${(gallery.title || gallery.slug).replace(/[\\/:*?"<>|]+/g, " ").trim() || "photos"}.zip`;
  return new Response(readable, {
    headers: {
      "content-type": "application/zip",
      "content-length": String(plan.totalSize),
      "content-disposition": disposition(fileName),
      "cache-control": "private, no-store",
    },
  });
}
