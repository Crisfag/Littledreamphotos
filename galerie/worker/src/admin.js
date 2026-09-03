// API côté photographe : création de galeries, envoi des tuiles, journaux.
// Protégée par le secret ADMIN_TOKEN (en-tête Authorization: Bearer …).

import { json, fail } from "./http.js";
import { hashPassword, timingSafeEqual, randomBytes, b64url } from "./auth.js";

const enc = new TextEncoder();

function now() {
  return Math.floor(Date.now() / 1000);
}

function newId(prefix) {
  return `${prefix}_${b64url(randomBytes(9))}`;
}

function isAdmin(request, env) {
  const header = request.headers.get("Authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = env.ADMIN_TOKEN || "";
  if (!expected || !given) return false;
  return timingSafeEqual(enc.encode(given), enc.encode(expected));
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;

async function createGallery(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }

  const slug = String(body.slug || "").toLowerCase();
  if (!SLUG_RE.test(slug)) {
    return fail(400, "Slug invalide (minuscules, chiffres et tirets, 2 à 61 caractères)");
  }
  const password = String(body.password || "");
  if (password.length < 8) return fail(400, "Mot de passe trop court (8 caractères minimum)");

  const existing = await env.DB.prepare("SELECT id FROM galleries WHERE slug = ?")
    .bind(slug)
    .first();
  if (existing) return fail(409, "Ce slug est déjà utilisé");

  const { hash, salt } = await hashPassword(password);
  const id = newId("gal");

  await env.DB.prepare(
    `INSERT INTO galleries
       (id, slug, title, client_name, password_hash, password_salt, watermark_text, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      slug,
      String(body.title || slug).slice(0, 120),
      String(body.clientName || "").slice(0, 120),
      hash,
      salt,
      String(body.watermarkText || "").slice(0, 120),
      body.expiresAt ? Number(body.expiresAt) : null,
      now()
    )
    .run();

  return json({ id, slug }, { status: 201 });
}

async function listGalleries(env) {
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.slug, g.title, g.client_name, g.expires_at, g.created_at,
            (SELECT COUNT(*) FROM photos p WHERE p.gallery_id = g.id) AS photo_count
     FROM galleries g ORDER BY g.created_at DESC`
  ).all();
  return json({ galleries: results });
}

async function deleteGallery(env, slug) {
  const gallery = await env.DB.prepare("SELECT id FROM galleries WHERE slug = ?")
    .bind(slug)
    .first();
  if (!gallery) return fail(404, "Galerie introuvable");

  // R2 ne supprime pas récursivement : on liste puis on efface par lots.
  let cursor;
  do {
    const listed = await env.TILES.list({ prefix: `${gallery.id}/`, cursor });
    if (listed.objects.length) {
      await env.TILES.delete(listed.objects.map((o) => o.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM photos WHERE gallery_id = ?").bind(gallery.id),
    env.DB.prepare("DELETE FROM access_log WHERE gallery_id = ?").bind(gallery.id),
    env.DB.prepare("DELETE FROM galleries WHERE id = ?").bind(gallery.id),
  ]);

  return json({ ok: true });
}

async function addPhoto(request, env, slug) {
  const gallery = await env.DB.prepare("SELECT id FROM galleries WHERE slug = ?")
    .bind(slug)
    .first();
  if (!gallery) return fail(404, "Galerie introuvable");

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }

  const width = Number(body.width);
  const height = Number(body.height);
  const cols = Number(body.cols);
  const rows = Number(body.rows);
  if (![width, height, cols, rows].every((n) => Number.isInteger(n) && n > 0)) {
    return fail(400, "Dimensions invalides");
  }
  if (cols > 12 || rows > 12) return fail(400, "Trop de tuiles (12 × 12 maximum)");

  // L'outil de préparation fournit l'identifiant : l'empreinte invisible en
  // dérive, il doit donc être fixé avant la gravure des pixels.
  const provided = String(body.id || "");
  if (provided && !/^pho_[A-Za-z0-9_-]{6,40}$/.test(provided)) {
    return fail(400, "Identifiant de photo invalide");
  }
  const id = provided || newId("pho");
  if (provided) {
    const clash = await env.DB.prepare("SELECT id FROM photos WHERE id = ?").bind(id).first();
    if (clash) return fail(409, "Identifiant de photo déjà utilisé");
  }

  await env.DB.prepare(
    `INSERT INTO photos
       (id, gallery_id, position, width, height, cols, rows,
        preview_width, preview_height, forensic_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      gallery.id,
      Number.isInteger(Number(body.position)) ? Number(body.position) : 0,
      width,
      height,
      cols,
      rows,
      Number(body.previewWidth) || 0,
      Number(body.previewHeight) || 0,
      String(body.forensicId || "").slice(0, 64),
      now()
    )
    .run();

  return json({ id, galleryId: gallery.id }, { status: 201 });
}

async function putTile(request, env, photoId, level, col, row) {
  const photo = await env.DB.prepare("SELECT * FROM photos WHERE id = ?").bind(photoId).first();
  if (!photo) return fail(404, "Photo introuvable");
  if (level !== 0 && level !== 1) return fail(400, "Niveau inconnu");
  const cols = level === 0 ? 2 : photo.cols;
  const rows = level === 0 ? 2 : photo.rows;
  if (!(col >= 0 && col < cols && row >= 0 && row < rows)) {
    return fail(400, "Coordonnées de tuile hors limites");
  }

  await env.TILES.put(`${photo.gallery_id}/${photoId}/${level}/${col}_${row}.jpg`, request.body, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  return json({ ok: true });
}

async function galleryLog(request, env, slug) {
  const gallery = await env.DB.prepare("SELECT id FROM galleries WHERE slug = ?")
    .bind(slug)
    .first();
  if (!gallery) return fail(404, "Galerie introuvable");

  const limit = Math.min(Number(new URL(request.url).searchParams.get("limit")) || 200, 1000);
  const { results } = await env.DB.prepare(
    `SELECT event, viewer_id, detail, ip_hash, user_agent, ts FROM access_log
     WHERE gallery_id = ? ORDER BY ts DESC LIMIT ?`
  )
    .bind(gallery.id, limit)
    .all();
  return json({ log: results });
}

export async function handleAdmin(request, env, ctx, path) {
  if (!isAdmin(request, env)) return fail(401, "Jeton d'administration invalide");

  const parts = path.split("/").filter(Boolean); // api, admin, …
  const section = parts[2];

  if (section === "galleries") {
    if (parts.length === 3) {
      if (request.method === "POST") return createGallery(request, env);
      if (request.method === "GET") return listGalleries(env);
    }
    const slug = parts[3];
    if (parts.length === 4 && request.method === "DELETE") return deleteGallery(env, slug);
    if (parts.length === 5 && parts[4] === "photos" && request.method === "POST") {
      return addPhoto(request, env, slug);
    }
    if (parts.length === 5 && parts[4] === "log" && request.method === "GET") {
      return galleryLog(request, env, slug);
    }
  }

  // Table des empreintes : c'est la liste des candidats que l'outil de
  // détection corrèle avec une image suspecte.
  if (section === "forensic" && parts.length === 3 && request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT p.forensic_id, p.id AS photo_id, p.position, g.slug, g.title, g.client_name
       FROM photos p JOIN galleries g ON g.id = p.gallery_id
       WHERE p.forensic_id != '' ORDER BY g.created_at DESC, p.position ASC`
    ).all();
    return json({ prints: results });
  }

  // /api/admin/tiles/<photoId>/<niveau>/<colonne>/<ligne>
  if (section === "tiles" && parts.length === 7 && request.method === "PUT") {
    return putTile(request, env, parts[3], Number(parts[4]), Number(parts[5]), Number(parts[6]));
  }

  return fail(404, "Route inconnue");
}
