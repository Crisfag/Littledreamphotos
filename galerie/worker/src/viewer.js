// API côté client : ouverture de session, manifeste de la galerie,
// distribution des tuiles, journal d'accès.

import { json, fail } from "./http.js";
import { verifyPassword, signToken, verifyToken, hashIp, randomBytes, b64url } from "./auth.js";

const SESSION_TTL_SECONDS = 2 * 60 * 60; // 2 h
const MAX_FAILED_LOGINS = 10;
const FAILED_WINDOW_SECONDS = 15 * 60;
const MAX_COMMENT_LENGTH = 500;

const EVENTS_ALLOWED = new Set(["view", "capture_suspected", "blur", "print", "devtools"]);

function now() {
  return Math.floor(Date.now() / 1000);
}

async function logAccess(env, entry) {
  await env.DB.prepare(
    `INSERT INTO access_log (gallery_id, viewer_id, event, detail, ip_hash, user_agent, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      entry.galleryId,
      entry.viewerId || "",
      entry.event,
      (entry.detail || "").slice(0, 200),
      entry.ipHash || "",
      (entry.userAgent || "").slice(0, 200),
      now()
    )
    .run();
}

async function getGallery(env, slug) {
  return env.DB.prepare("SELECT * FROM galleries WHERE slug = ?").bind(slug).first();
}

function isExpired(gallery) {
  return gallery.expires_at != null && gallery.expires_at < now();
}

async function tooManyFailures(env, ipHash) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM access_log
     WHERE ip_hash = ? AND event = 'login_failed' AND ts > ?`
  )
    .bind(ipHash, now() - FAILED_WINDOW_SECONDS)
    .first();
  return (row?.n || 0) >= MAX_FAILED_LOGINS;
}

async function handleLogin(request, env, slug) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const userAgent = request.headers.get("User-Agent") || "";
  const ipHash = await hashIp(ip, env.TOKEN_SECRET);

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const password = typeof body?.password === "string" ? body.password : "";

  if (await tooManyFailures(env, ipHash)) {
    return fail(429, "Trop de tentatives. Réessayez dans quelques minutes.");
  }

  const gallery = await getGallery(env, slug);
  // Même message d'erreur si la galerie n'existe pas ou si le mot de passe est
  // faux : inutile de confirmer à un inconnu qu'une galerie existe.
  const ok = gallery && !isExpired(gallery)
    ? await verifyPassword(password, gallery.password_hash, gallery.password_salt)
    : false;

  if (!ok) {
    if (gallery) {
      await logAccess(env, {
        galleryId: gallery.id,
        event: isExpired(gallery) ? "login_expired" : "login_failed",
        ipHash,
        userAgent,
      });
    }
    if (gallery && isExpired(gallery)) {
      return fail(410, "Cette galerie a expiré. Contactez votre photographe.");
    }
    return fail(401, "Mot de passe incorrect.");
  }

  const viewerId = b64url(randomBytes(9));
  const token = await signToken(env.TOKEN_SECRET, {
    g: gallery.id,
    v: viewerId,
    exp: now() + SESSION_TTL_SECONDS,
  });

  await logAccess(env, { galleryId: gallery.id, viewerId, event: "login", ipHash, userAgent });

  const { results: photos } = await env.DB.prepare(
    `SELECT id, width, height, cols, rows, preview_width, preview_height, selected, comment FROM photos
     WHERE gallery_id = ? ORDER BY position ASC, created_at ASC`
  )
    .bind(gallery.id)
    .all();

  return json({
    token,
    expiresIn: SESSION_TTL_SECONDS,
    gallery: {
      title: gallery.title,
      clientName: gallery.client_name,
      watermark: gallery.watermark_text,
      expiresAt: gallery.expires_at,
    },
    photos: photos.map((p) => ({
      id: p.id,
      width: p.width,
      height: p.height,
      cols: p.cols,
      rows: p.rows,
      previewWidth: p.preview_width,
      previewHeight: p.preview_height,
      selected: !!p.selected,
      comment: p.comment || "",
    })),
  });
}

async function authorize(request, env, slug) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = await verifyToken(env.TOKEN_SECRET, token);
  if (!payload) return { error: fail(401, "Session expirée") };

  const gallery = await getGallery(env, slug);
  if (!gallery || gallery.id !== payload.g) return { error: fail(403, "Accès refusé") };
  if (isExpired(gallery)) return { error: fail(410, "Cette galerie a expiré.") };
  return { gallery, viewerId: payload.v };
}

const PREVIEW_COLS = 2;
const PREVIEW_ROWS = 2;

async function handleTile(request, env, slug, photoId, level, col, row) {
  const auth = await authorize(request, env, slug);
  if (auth.error) return auth.error;

  const photo = await env.DB.prepare("SELECT * FROM photos WHERE id = ? AND gallery_id = ?")
    .bind(photoId, auth.gallery.id)
    .first();
  if (!photo) return fail(404, "Photo introuvable");

  // Bornes strictes : la grille attendue dépend du niveau demandé.
  const cols = level === 0 ? PREVIEW_COLS : photo.cols;
  const rows = level === 0 ? PREVIEW_ROWS : photo.rows;
  if (!(level === 0 || level === 1)) return fail(404, "Niveau inconnu");
  if (!(col >= 0 && col < cols && row >= 0 && row < rows)) {
    return fail(404, "Tuile introuvable");
  }

  const object = await env.TILES.get(`${auth.gallery.id}/${photoId}/${level}/${col}_${row}.jpg`);
  if (!object) return fail(404, "Tuile introuvable");

  return new Response(object.body, {
    headers: {
      "content-type": "image/jpeg",
      // Jamais de cache : une tuile en cache disque est une tuile récupérable.
      "cache-control": "no-store, no-cache, must-revalidate, private",
      "content-disposition": "inline",
    },
  });
}

// Coup de cœur du client : n'importe quel visiteur connecté à la galerie
// peut le poser ou le retirer — c'est une sélection partagée (le couple, la
// famille), pas un compte individuel. Persistée en base plutôt que dans le
// navigateur : le photographe doit la voir même si le client change d'appareil.
async function handleSelect(request, env, slug) {
  const auth = await authorize(request, env, slug);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const photoId = typeof body?.photoId === "string" ? body.photoId : "";
  const selected = body?.selected === true;
  if (!photoId) return fail(400, "Photo manquante");

  const photo = await env.DB.prepare("SELECT id FROM photos WHERE id = ? AND gallery_id = ?")
    .bind(photoId, auth.gallery.id)
    .first();
  if (!photo) return fail(404, "Photo introuvable");

  await env.DB.prepare("UPDATE photos SET selected = ?, selected_at = ? WHERE id = ?")
    .bind(selected ? 1 : 0, selected ? now() : null, photoId)
    .run();

  await logAccess(env, {
    galleryId: auth.gallery.id,
    viewerId: auth.viewerId,
    event: selected ? "select" : "deselect",
    detail: photoId,
    ipHash: await hashIp(request.headers.get("CF-Connecting-IP") || "", env.TOKEN_SECRET),
    userAgent: request.headers.get("User-Agent") || "",
  });

  return json({ ok: true, selected });
}

// Note du client sur une photo précise (« celle-ci en noir et blanc ? »).
// Même modèle que le coup de cœur : partagée entre tous les visiteurs de la
// galerie, dernier écrit gagne — pas de compte individuel à gérer.
async function handleComment(request, env, slug) {
  const auth = await authorize(request, env, slug);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const photoId = typeof body?.photoId === "string" ? body.photoId : "";
  if (!photoId) return fail(400, "Photo manquante");
  if (typeof body?.comment !== "string") return fail(400, "Commentaire invalide");
  const comment = body.comment.trim().slice(0, MAX_COMMENT_LENGTH);

  const photo = await env.DB.prepare("SELECT id FROM photos WHERE id = ? AND gallery_id = ?")
    .bind(photoId, auth.gallery.id)
    .first();
  if (!photo) return fail(404, "Photo introuvable");

  await env.DB.prepare("UPDATE photos SET comment = ?, comment_at = ? WHERE id = ?")
    .bind(comment, comment ? now() : null, photoId)
    .run();

  await logAccess(env, {
    galleryId: auth.gallery.id,
    viewerId: auth.viewerId,
    event: "comment",
    detail: photoId,
    ipHash: await hashIp(request.headers.get("CF-Connecting-IP") || "", env.TOKEN_SECRET),
    userAgent: request.headers.get("User-Agent") || "",
  });

  return json({ ok: true, comment });
}

async function handleEvent(request, env, slug) {
  const auth = await authorize(request, env, slug);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const event = typeof body?.event === "string" ? body.event : "";
  if (!EVENTS_ALLOWED.has(event)) return fail(400, "Évènement inconnu");

  await logAccess(env, {
    galleryId: auth.gallery.id,
    viewerId: auth.viewerId,
    event,
    detail: typeof body.detail === "string" ? body.detail : "",
    ipHash: await hashIp(request.headers.get("CF-Connecting-IP") || "", env.TOKEN_SECRET),
    userAgent: request.headers.get("User-Agent") || "",
  });

  return json({ ok: true });
}

export async function handleViewer(request, env, ctx, path) {
  // /api/gallery/<slug>/<action>[/...]
  const parts = path.split("/").filter(Boolean); // api, gallery, slug, action, …
  const slug = parts[2];
  const action = parts[3];
  if (!slug) return fail(404, "Galerie inconnue");

  if (action === "login" && request.method === "POST") {
    return handleLogin(request, env, slug);
  }
  // /api/gallery/<slug>/tile/<photoId>/<niveau>/<colonne>/<ligne>
  if (action === "tile" && request.method === "GET" && parts.length === 8) {
    return handleTile(
      request, env, slug, parts[4],
      Number(parts[5]), Number(parts[6]), Number(parts[7])
    );
  }
  if (action === "select" && request.method === "POST") {
    return handleSelect(request, env, slug);
  }
  if (action === "comment" && request.method === "POST") {
    return handleComment(request, env, slug);
  }
  if (action === "event" && request.method === "POST") {
    return handleEvent(request, env, slug);
  }
  return fail(404, "Route inconnue");
}
