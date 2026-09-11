// API côté photographe : création de galeries, envoi des tuiles, journaux.
// Protégée par une session de compte photographe (Authorization: Bearer …,
// jeton obtenu via /api/auth/login) — jamais par un jeton partagé entre tous
// les photographes. Chaque requête est cloisonnée : un photographe ne peut
// lire, modifier ou lister que ses propres galeries, jamais celles d'un
// autre compte.

import { json, fail } from "./http.js";
import { hashPassword, randomBytes, b64url } from "./auth.js";
import { authenticatePhotographer } from "./authPhotographer.js";

function now() {
  return Math.floor(Date.now() / 1000);
}

function newId(prefix) {
  return `${prefix}_${b64url(randomBytes(9))}`;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;

// Vérifie que la galerie désignée par `slug` existe et appartient bien au
// photographe appelant. Renvoie la ligne complète, ou null.
async function ownedGallery(env, photographerId, slug) {
  return env.DB.prepare("SELECT * FROM galleries WHERE slug = ? AND photographer_id = ?")
    .bind(slug, photographerId)
    .first();
}

// Même vérification en partant d'une photo : on remonte à sa galerie pour
// s'assurer qu'elle appartient au photographe appelant. Utilisé par les
// routes de tuiles, qui n'ont que l'identifiant de la photo, pas le slug.
async function ownedPhoto(env, photographerId, photoId) {
  return env.DB.prepare(
    `SELECT p.* FROM photos p
     JOIN galleries g ON g.id = p.gallery_id
     WHERE p.id = ? AND g.photographer_id = ?`
  )
    .bind(photoId, photographerId)
    .first();
}

async function createGallery(request, env, photographerId) {
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

  // Les slugs forment l'URL publique de la galerie : ils doivent rester
  // uniques sur toute la plateforme, pas seulement pour ce photographe.
  const existing = await env.DB.prepare("SELECT id FROM galleries WHERE slug = ?")
    .bind(slug)
    .first();
  if (existing) return fail(409, "Ce slug est déjà utilisé");

  const { hash, salt } = await hashPassword(password);
  const id = newId("gal");

  await env.DB.prepare(
    `INSERT INTO galleries
       (id, photographer_id, slug, title, client_name, password_hash, password_salt, watermark_text, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      photographerId,
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

async function listGalleries(env, photographerId) {
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.slug, g.title, g.client_name, g.expires_at, g.created_at,
            (SELECT COUNT(*) FROM photos p WHERE p.gallery_id = g.id) AS photo_count,
            (SELECT COUNT(*) FROM photos p WHERE p.gallery_id = g.id AND p.selected = 1) AS selected_count,
            (SELECT COUNT(*) FROM photos p WHERE p.gallery_id = g.id AND p.comment != '') AS comment_count
     FROM galleries g WHERE g.photographer_id = ? ORDER BY g.created_at DESC`
  )
    .bind(photographerId)
    .all();
  return json({ galleries: results });
}

async function getGallery(env, photographerId, slug) {
  const gallery = await ownedGallery(env, photographerId, slug);
  if (!gallery) return fail(404, "Galerie introuvable");

  const { results: photos } = await env.DB.prepare(
    `SELECT id, position, width, height, cols, rows, preview_width, preview_height,
            forensic_id, selected, selected_at, comment, comment_at, created_at
     FROM photos WHERE gallery_id = ? ORDER BY position ASC, created_at ASC`
  )
    .bind(gallery.id)
    .all();

  return json({
    gallery: {
      id: gallery.id,
      slug: gallery.slug,
      title: gallery.title,
      client_name: gallery.client_name,
      watermark_text: gallery.watermark_text,
      expires_at: gallery.expires_at,
      created_at: gallery.created_at,
      login_background_type: gallery.login_background_type,
      login_background_color: gallery.login_background_color,
    },
    photos,
  });
}

// Remplace le mot de passe d'une galerie — l'ancien cesse aussitôt de
// fonctionner. Le mot de passe n'étant jamais stocké qu'en empreinte à sens
// unique, c'est la seule façon d'en redonner un valide au photographe s'il a
// perdu celui affiché à la création : pas de « récupération », une rotation.
async function regeneratePassword(request, env, photographerId, slug) {
  const gallery = await ownedGallery(env, photographerId, slug);
  if (!gallery) return fail(404, "Galerie introuvable");

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const password = String(body.password || "");
  if (password.length < 8) return fail(400, "Mot de passe trop court (8 caractères minimum)");

  const { hash, salt } = await hashPassword(password);
  await env.DB.prepare("UPDATE galleries SET password_hash = ?, password_salt = ? WHERE id = ?")
    .bind(hash, salt, gallery.id)
    .run();

  return json({ ok: true });
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// Couleur unie (ou remise à la couleur par défaut si `color` est vide).
// N'affecte jamais une éventuelle image déjà stockée dans R2 — juste le
// type actif, comme un interrupteur entre les deux façons de personnaliser.
async function setBackgroundColor(request, env, photographerId, slug) {
  const gallery = await ownedGallery(env, photographerId, slug);
  if (!gallery) return fail(404, "Galerie introuvable");

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const color = String(body.color || "");
  if (color && !HEX_COLOR_RE.test(color)) return fail(400, "Couleur invalide (format #rrggbb)");

  await env.DB.prepare(
    "UPDATE galleries SET login_background_type = 'color', login_background_color = ? WHERE id = ?"
  )
    .bind(color, gallery.id)
    .run();

  return json({ ok: true });
}

// Image d'ambiance importée par le photographe — jamais une photo de la
// galerie elle-même (voir le commentaire sur la colonne dans schema.sql) :
// l'appelant (admin-server.mjs) est responsable de fournir une image déjà
// redimensionnée, ce Worker se contente de la stocker.
async function setBackgroundImage(request, env, photographerId, slug) {
  const gallery = await ownedGallery(env, photographerId, slug);
  if (!gallery) return fail(404, "Galerie introuvable");

  await env.TILES.put(`backgrounds/${gallery.id}.jpg`, request.body, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  await env.DB.prepare("UPDATE galleries SET login_background_type = 'image' WHERE id = ?")
    .bind(gallery.id)
    .run();

  return json({ ok: true });
}

// Retour à la couleur par défaut de la marque. L'éventuelle image importée
// reste dans R2 (pas de suppression immédiate) — orpheline mais inoffensive,
// jamais servie tant que login_background_type n'est pas « image ».
async function resetBackground(env, photographerId, slug) {
  const gallery = await ownedGallery(env, photographerId, slug);
  if (!gallery) return fail(404, "Galerie introuvable");

  await env.DB.prepare(
    "UPDATE galleries SET login_background_type = 'color', login_background_color = '' WHERE id = ?"
  )
    .bind(gallery.id)
    .run();

  return json({ ok: true });
}

async function deleteGallery(env, photographerId, slug) {
  const gallery = await ownedGallery(env, photographerId, slug);
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
  // Sous un préfixe distinct des tuiles (backgrounds/, pas ${gallery.id}/) :
  // la boucle ci-dessus ne le voit pas, il faut l'effacer explicitement.
  await env.TILES.delete(`backgrounds/${gallery.id}.jpg`);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM photos WHERE gallery_id = ?").bind(gallery.id),
    env.DB.prepare("DELETE FROM access_log WHERE gallery_id = ?").bind(gallery.id),
    env.DB.prepare("DELETE FROM galleries WHERE id = ?").bind(gallery.id),
  ]);

  return json({ ok: true });
}

async function addPhoto(request, env, photographerId, slug) {
  const gallery = await ownedGallery(env, photographerId, slug);
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

async function deletePhoto(env, photographerId, slug, photoId) {
  const gallery = await ownedGallery(env, photographerId, slug);
  if (!gallery) return fail(404, "Galerie introuvable");

  const photo = await env.DB.prepare("SELECT id FROM photos WHERE id = ? AND gallery_id = ?")
    .bind(photoId, gallery.id)
    .first();
  if (!photo) return fail(404, "Photo introuvable");

  let cursor;
  do {
    const listed = await env.TILES.list({ prefix: `${gallery.id}/${photoId}/`, cursor });
    if (listed.objects.length) {
      await env.TILES.delete(listed.objects.map((o) => o.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  await env.DB.prepare("DELETE FROM photos WHERE id = ?").bind(photoId).run();
  return json({ ok: true });
}

async function putTile(request, env, photographerId, photoId, level, col, row) {
  const photo = await ownedPhoto(env, photographerId, photoId);
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

// Lecture d'une tuile côté administration : sert à afficher de vraies
// vignettes dans l'interface d'admin, sans passer par une session client.
async function getTile(env, photographerId, photoId, level, col, row) {
  const photo = await ownedPhoto(env, photographerId, photoId);
  if (!photo) return fail(404, "Photo introuvable");
  if (level !== 0 && level !== 1) return fail(400, "Niveau inconnu");
  const cols = level === 0 ? 2 : photo.cols;
  const rows = level === 0 ? 2 : photo.rows;
  if (!(col >= 0 && col < cols && row >= 0 && row < rows)) return fail(404, "Tuile introuvable");

  const object = await env.TILES.get(`${photo.gallery_id}/${photoId}/${level}/${col}_${row}.jpg`);
  if (!object) return fail(404, "Tuile introuvable");
  return new Response(object.body, {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=300" },
  });
}

async function galleryLog(request, env, photographerId, slug) {
  const gallery = await ownedGallery(env, photographerId, slug);
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
  const photographerId = await authenticatePhotographer(request, env);
  if (!photographerId) return fail(401, "Session invalide ou expirée");

  const parts = path.split("/").filter(Boolean); // api, admin, …
  const section = parts[2];

  if (section === "galleries") {
    if (parts.length === 3) {
      if (request.method === "POST") return createGallery(request, env, photographerId);
      if (request.method === "GET") return listGalleries(env, photographerId);
    }
    const slug = parts[3];
    if (parts.length === 4 && request.method === "GET") return getGallery(env, photographerId, slug);
    if (parts.length === 4 && request.method === "DELETE") return deleteGallery(env, photographerId, slug);
    if (parts.length === 5 && parts[4] === "photos" && request.method === "POST") {
      return addPhoto(request, env, photographerId, slug);
    }
    if (parts.length === 6 && parts[4] === "photos" && request.method === "DELETE") {
      return deletePhoto(env, photographerId, slug, parts[5]);
    }
    if (parts.length === 5 && parts[4] === "log" && request.method === "GET") {
      return galleryLog(request, env, photographerId, slug);
    }
    if (parts.length === 5 && parts[4] === "password" && request.method === "POST") {
      return regeneratePassword(request, env, photographerId, slug);
    }
    if (parts.length === 6 && parts[4] === "background" && parts[5] === "color" && request.method === "POST") {
      return setBackgroundColor(request, env, photographerId, slug);
    }
    if (parts.length === 6 && parts[4] === "background" && parts[5] === "image" && request.method === "PUT") {
      return setBackgroundImage(request, env, photographerId, slug);
    }
    if (parts.length === 5 && parts[4] === "background" && request.method === "DELETE") {
      return resetBackground(env, photographerId, slug);
    }
  }

  // Table des empreintes : c'est la liste des candidats que l'outil de
  // détection corrèle avec une image suspecte — cloisonnée par photographe,
  // comme tout le reste : une empreinte identifie l'une de VOS galeries.
  if (section === "forensic" && parts.length === 3 && request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT p.forensic_id, p.id AS photo_id, p.position, g.slug, g.title, g.client_name
       FROM photos p JOIN galleries g ON g.id = p.gallery_id
       WHERE p.forensic_id != '' AND g.photographer_id = ?
       ORDER BY g.created_at DESC, p.position ASC`
    )
      .bind(photographerId)
      .all();
    return json({ prints: results });
  }

  // /api/admin/tiles/<photoId>/<niveau>/<colonne>/<ligne>
  if (section === "tiles" && parts.length === 7 && request.method === "PUT") {
    return putTile(request, env, photographerId, parts[3], Number(parts[4]), Number(parts[5]), Number(parts[6]));
  }
  if (section === "tiles" && parts.length === 7 && request.method === "GET") {
    return getTile(env, photographerId, parts[3], Number(parts[4]), Number(parts[5]), Number(parts[6]));
  }

  return fail(404, "Route inconnue");
}
