// Mini-site portfolio du photographe : une page publique avec ses plus
// belles photos, sa présentation, ses prestations et un formulaire de
// contact. Inclus dans toutes les formules.
//
// Adresses :
//   - www.holypixx.com/portfolio.html?s=<identifiant>   (tout le monde)
//   - <sous-domaine>.holypixx.com/                     (formule Pro, voir studio.js)
//
// Les photos sont envoyées déjà réduites par le serveur d'administration
// (2000 px au plus grand côté, WebP, métadonnées EXIF/GPS retirées) : ce
// sont des images de vitrine, pas des originaux. Elles vivent dans R2 sous
// portfolio/{photographerId}/{photoId}.webp.
//
// Les messages du formulaire sont enregistrés (onglet Portfolio de l'admin)
// ET envoyés par e-mail au photographe, avec l'adresse du visiteur en
// « répondre à ». Un champ piège invisible écarte les robots, et le nombre
// de messages est plafonné par visiteur et par photographe.

import { json, fail } from "./http.js";
import { randomBytes, b64url, hashIp } from "./auth.js";
import { normalizeSubdomain } from "./studio.js";
import { sendPortfolioContact } from "./notify.js";
import { hasFeature } from "./subscription.js";

export const MAX_PORTFOLIO_PHOTOS = 40;
export const MAX_PORTFOLIO_PHOTO_BYTES = 4 * 1024 * 1024;
export const MAX_SERVICES = 8;
// Messages conservés un an, puis effacés (voir purgeOldPortfolioMessages).
export const MESSAGE_RETENTION_SECONDS = 365 * 24 * 60 * 60;
const MESSAGES_PER_VISITOR_PER_HOUR = 3;
const MESSAGES_PER_PHOTOGRAPHER_PER_DAY = 50;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function now() {
  return Math.floor(Date.now() / 1000);
}

function newId(prefix) {
  return `${prefix}_${b64url(randomBytes(9))}`;
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function photoKey(photographerId, photoId) {
  return `portfolio/${photographerId}/${photoId}.webp`;
}

/* ---------- Validation des champs ---------- */

function cleanText(value, max) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
}

function cleanLine(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

// « @julie.photo », « instagram.com/julie.photo/ » ou « julie.photo » → « julie.photo ».
export function normalizeInstagram(value) {
  let v = String(value || "").trim();
  if (!v) return { instagram: "" };
  v = v.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(v)) return { error: "Compte Instagram invalide (ex. @votre.studio)" };
  return { instagram: v };
}

export function normalizeWebsite(value) {
  let v = String(value || "").trim();
  if (!v) return { website: "" };
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  let url;
  try {
    url = new URL(v);
  } catch {
    return { error: "Adresse de site invalide" };
  }
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".") || v.length > 200) return { error: "Adresse de site invalide" };
  return { website: url.toString() };
}

export function normalizePhone(value) {
  const v = cleanLine(value, 40);
  if (!v) return { phone: "" };
  if (!/^\+?[0-9 ().\/-]{6,30}$/.test(v)) return { error: "Numéro de téléphone invalide" };
  return { phone: v };
}

export function normalizeServices(value) {
  const list = Array.isArray(value) ? value : String(value || "").split("\n");
  const out = [];
  for (const item of list) {
    const s = cleanLine(item, 60);
    if (s && !out.includes(s)) out.push(s);
  }
  if (out.length > MAX_SERVICES) return { error: `${MAX_SERVICES} prestations au plus` };
  return { services: out };
}

// Identifiant de l'adresse publique : mêmes règles que le sous-domaine.
export function normalizeHandle(value) {
  const { subdomain, error } = normalizeSubdomain(value);
  if (error) return { error: `Adresse du portfolio : ${error.charAt(0).toLowerCase()}${error.slice(1)}` };
  if (!subdomain) return { error: "Choisissez l'adresse de votre portfolio" };
  return { handle: subdomain };
}

// Proposition d'identifiant à partir du nom du studio (« Julie & Co Photo » → « julie-co-photo »).
export function suggestHandle(photographer) {
  if (photographer?.subdomain) return photographer.subdomain;
  const base = String(photographer?.studio_name || photographer?.email?.split("@")[0] || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");
  return normalizeSubdomain(base).subdomain || "";
}

/* ---------- Adresses publiques ---------- */

export function portfolioUrls(env, photographer, handle) {
  const site = (env.PUBLIC_SITE_ORIGIN || "https://www.holypixx.com").replace(/\/+$/, "");
  const urls = { site: handle ? `${site}/portfolio.html?s=${encodeURIComponent(handle)}` : "", studio: "" };
  // L'adresse du studio ne sert le portfolio qu'avec la formule Pro (studio.js).
  if (env.STUDIO_DOMAIN && photographer?.subdomain && hasFeature(env, photographer, "subdomain")) urls.studio = `https://${photographer.subdomain}.${env.STUDIO_DOMAIN}/`;
  return urls;
}

/* ---------- Lecture ---------- */

async function portfolioRow(env, photographerId) {
  return env.DB.prepare("SELECT * FROM portfolios WHERE photographer_id = ?").bind(photographerId).first();
}

async function photosOf(env, photographerId) {
  const { results } = await env.DB.prepare(
    "SELECT id, width, height, bytes, position FROM portfolio_photos WHERE photographer_id = ? ORDER BY position ASC, created_at ASC"
  )
    .bind(photographerId)
    .all();
  return results || [];
}

export async function publishedPortfolioByHandle(env, handle) {
  const row = await env.DB.prepare(
    `SELECT p.*, ph.studio_name, ph.first_name, ph.last_name, ph.email, ph.subdomain
       FROM portfolios p JOIN photographers ph ON ph.id = p.photographer_id
      WHERE p.handle = ? AND p.published = 1`
  )
    .bind(String(handle || "").toLowerCase())
    .first();
  return row || null;
}

export async function publishedPortfolioForStudio(env, photographerId) {
  const row = await env.DB.prepare("SELECT handle FROM portfolios WHERE photographer_id = ? AND published = 1").bind(photographerId).first();
  return row?.handle || "";
}

function displayName(row) {
  return row.studio_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || "Photographe";
}

function publicOut(row, photos) {
  return {
    handle: row.handle,
    studioName: displayName(row),
    headline: row.headline,
    bio: row.bio,
    city: row.city,
    services: parseJson(row.services || "[]", []),
    links: {
      instagram: row.instagram ? `https://www.instagram.com/${row.instagram}/` : "",
      instagramHandle: row.instagram || "",
      website: row.website || "",
      phone: row.phone || "",
    },
    contact: Boolean(row.contact_enabled),
    photos: photos.map((p) => ({ id: p.id, width: p.width, height: p.height })),
  };
}

/* ---------- Routes publiques : /api/portfolio/:handle[/…] ---------- */

export async function handlePortfolioPublic(request, env, path) {
  const parts = path.split("/").filter(Boolean); // api, portfolio, handle, …
  const handle = decodeURIComponent(parts[2] || "");
  const row = await publishedPortfolioByHandle(env, handle);
  if (!row) return fail(404, "Portfolio introuvable");

  if (parts.length === 3 && request.method === "GET") {
    return json(publicOut(row, await photosOf(env, row.photographer_id)));
  }
  if (parts.length === 5 && parts[3] === "photo" && request.method === "GET") {
    return servePhoto(env, row.photographer_id, decodeURIComponent(parts[4]), "public, max-age=86400");
  }
  if (parts.length === 4 && parts[3] === "contact" && request.method === "POST") {
    return receiveMessage(request, env, row);
  }
  return fail(404, "Route inconnue");
}

async function servePhoto(env, photographerId, photoId, cacheControl) {
  const photo = await env.DB.prepare("SELECT id FROM portfolio_photos WHERE id = ? AND photographer_id = ?")
    .bind(photoId, photographerId)
    .first();
  if (!photo) return fail(404, "Photo introuvable");
  const object = await env.TILES.get(photoKey(photographerId, photo.id));
  if (!object) return fail(404, "Photo introuvable");
  return new Response(object.body, {
    headers: { "content-type": "image/webp", "cache-control": cacheControl },
  });
}

/* ---------- Formulaire de contact ---------- */

async function receiveMessage(request, env, row) {
  if (!row.contact_enabled) return fail(404, "Formulaire indisponible");
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return fail(400, "Requête invalide");

  // Champ piège : invisible pour un humain, rempli par les robots. On fait
  // comme si tout allait bien, sans rien enregistrer ni envoyer.
  if (cleanLine(body.website, 200)) return json({ ok: true });

  const name = cleanLine(body.name, 100);
  const email = cleanLine(body.email, 200);
  const message = cleanText(body.message, 3000);
  const eventDate = cleanLine(body.eventDate, 40);
  const phone = normalizePhone(body.phone);
  if (!name) return fail(400, "Indiquez votre nom");
  if (!EMAIL_RE.test(email)) return fail(400, "Adresse e-mail invalide");
  if (phone.error) return fail(400, phone.error);
  if (message.length < 10) return fail(400, "Votre message est un peu court");

  const ipHash = await hashIp(request.headers.get("CF-Connecting-IP") || "", env.TOKEN_SECRET);
  const ts = now();
  const recent = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM portfolio_messages WHERE ip_hash = ? AND created_at > ?) AS by_visitor,
       (SELECT COUNT(*) FROM portfolio_messages WHERE photographer_id = ? AND created_at > ?) AS by_photographer`
  )
    .bind(ipHash, ts - 3600, row.photographer_id, ts - 86400)
    .first();
  if ((recent?.by_visitor || 0) >= MESSAGES_PER_VISITOR_PER_HOUR || (recent?.by_photographer || 0) >= MESSAGES_PER_PHOTOGRAPHER_PER_DAY) {
    return fail(429, "Trop de messages envoyés. Réessayez un peu plus tard.");
  }

  const id = newId("msg");
  await env.DB.prepare(
    `INSERT INTO portfolio_messages (id, photographer_id, name, email, phone, event_date, message, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, row.photographer_id, name, email, phone.phone, eventDate, message, ipHash, ts)
    .run();

  await sendPortfolioContact(env, {
    to: row.email,
    replyTo: email,
    studioName: displayName(row),
    name,
    email,
    phone: phone.phone,
    eventDate,
    message,
  });
  return json({ ok: true });
}

export async function purgeOldPortfolioMessages(env) {
  const result = await env.DB.prepare("DELETE FROM portfolio_messages WHERE created_at < ?")
    .bind(now() - MESSAGE_RETENTION_SECONDS)
    .run();
  return result?.meta?.changes || 0;
}

/* ---------- Admin : /api/admin/portfolio[/…] ---------- */

async function portfolioForAdmin(env, photographer) {
  const row = await portfolioRow(env, photographer.id);
  const photos = await photosOf(env, photographer.id);
  const { results: messages } = await env.DB.prepare(
    `SELECT id, name, email, phone, event_date, message, read_at, created_at
       FROM portfolio_messages WHERE photographer_id = ? ORDER BY created_at DESC LIMIT 50`
  )
    .bind(photographer.id)
    .all();
  const handle = row?.handle || suggestHandle(photographer);
  // Ouvrir l'onglet vaut lecture : les messages suivants seront « nouveaux ».
  if ((messages || []).some((m) => !m.read_at)) {
    await env.DB.prepare("UPDATE portfolio_messages SET read_at = ? WHERE photographer_id = ? AND read_at IS NULL")
      .bind(now(), photographer.id)
      .run();
  }
  return json({
    exists: Boolean(row),
    handle,
    published: Boolean(row?.published),
    headline: row?.headline || "",
    bio: row?.bio || "",
    city: row?.city || "",
    services: parseJson(row?.services || "[]", []),
    phone: row?.phone || "",
    instagram: row?.instagram || "",
    website: row?.website || "",
    contactEnabled: row ? Boolean(row.contact_enabled) : true,
    studioName: displayName(photographer),
    urls: portfolioUrls(env, photographer, row?.handle || ""),
    maxPhotos: MAX_PORTFOLIO_PHOTOS,
    photos: photos.map((p) => ({ id: p.id, width: p.width, height: p.height, bytes: p.bytes })),
    messages: (messages || []).map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      phone: m.phone,
      eventDate: m.event_date,
      message: m.message,
      unread: !m.read_at,
      createdAt: m.created_at,
    })),
  });
}

async function savePortfolio(request, env, photographer) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return fail(400, "Requête invalide");

  const handle = normalizeHandle(body.handle);
  if (handle.error) return fail(400, handle.error);
  const services = normalizeServices(body.services);
  if (services.error) return fail(400, services.error);
  const instagram = normalizeInstagram(body.instagram);
  if (instagram.error) return fail(400, instagram.error);
  const website = normalizeWebsite(body.website);
  if (website.error) return fail(400, website.error);
  const phone = normalizePhone(body.phone);
  if (phone.error) return fail(400, phone.error);
  const published = Boolean(body.published);

  // Un identifiant ne doit désigner qu'un seul studio, que ce soit comme
  // portfolio ou comme sous-domaine d'un autre compte.
  const taken = await env.DB.prepare(
    `SELECT 1 AS x FROM portfolios WHERE handle = ? AND photographer_id != ?
     UNION SELECT 1 FROM photographers WHERE subdomain = ? AND id != ?`
  )
    .bind(handle.handle, photographer.id, handle.handle, photographer.id)
    .first();
  if (taken) return fail(409, "Cette adresse est déjà prise par un autre studio");

  if (published) {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM portfolio_photos WHERE photographer_id = ?").bind(photographer.id).first();
    if (!count?.n) return fail(400, "Ajoutez au moins une photo avant de publier votre portfolio");
  }

  const values = [
    handle.handle,
    published ? 1 : 0,
    cleanLine(body.headline, 120),
    cleanText(body.bio, 2000),
    cleanLine(body.city, 80),
    JSON.stringify(services.services),
    phone.phone,
    instagram.instagram,
    website.website,
    body.contactEnabled === false ? 0 : 1,
    now(),
  ];
  try {
    await env.DB.prepare(
      `INSERT INTO portfolios (handle, published, headline, bio, city, services, phone, instagram, website, contact_enabled, updated_at, photographer_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(photographer_id) DO UPDATE SET handle = excluded.handle, published = excluded.published,
         headline = excluded.headline, bio = excluded.bio, city = excluded.city, services = excluded.services,
         phone = excluded.phone, instagram = excluded.instagram, website = excluded.website,
         contact_enabled = excluded.contact_enabled, updated_at = excluded.updated_at`
    )
      .bind(...values, photographer.id)
      .run();
  } catch {
    // L'index unique tranche en cas de course entre deux comptes.
    return fail(409, "Cette adresse est déjà prise par un autre studio");
  }
  return portfolioForAdmin(env, photographer);
}

function isWebp(bytes) {
  return bytes.length > 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
}

// PUT /api/admin/portfolio/photos?width=&height= — corps : l'image WebP.
async function addPhoto(request, env, photographer, url) {
  const width = Number(url.searchParams.get("width"));
  const height = Number(url.searchParams.get("height"));
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4000 || height > 4000) {
    return fail(400, "Dimensions invalides");
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_PORTFOLIO_PHOTO_BYTES) return fail(413, "Image trop lourde");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return fail(400, "Image vide");
  if (bytes.length > MAX_PORTFOLIO_PHOTO_BYTES) return fail(413, "Image trop lourde");
  if (!isWebp(bytes)) return fail(400, "Format d'image inattendu");

  const stats = await env.DB.prepare(
    "SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS last FROM portfolio_photos WHERE photographer_id = ?"
  )
    .bind(photographer.id)
    .first();
  if ((stats?.n || 0) >= MAX_PORTFOLIO_PHOTOS) return fail(409, `${MAX_PORTFOLIO_PHOTOS} photos au plus dans le portfolio`);

  const id = newId("pf");
  await env.TILES.put(photoKey(photographer.id, id), bytes, { httpMetadata: { contentType: "image/webp" } });
  await env.DB.prepare(
    "INSERT INTO portfolio_photos (id, photographer_id, position, width, height, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, photographer.id, (stats?.last ?? -1) + 1, width, height, bytes.length, now())
    .run();
  return json({ id, width, height, bytes: bytes.length }, { status: 201 });
}

async function deletePhoto(env, photographer, photoId) {
  const photo = await env.DB.prepare("SELECT id FROM portfolio_photos WHERE id = ? AND photographer_id = ?")
    .bind(photoId, photographer.id)
    .first();
  if (!photo) return fail(404, "Photo introuvable");
  await env.TILES.delete(photoKey(photographer.id, photo.id));
  await env.DB.prepare("DELETE FROM portfolio_photos WHERE id = ?").bind(photo.id).run();
  // Un portfolio publié sans photo n'aurait plus rien à montrer.
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM portfolio_photos WHERE photographer_id = ?").bind(photographer.id).first();
  if (!left?.n) await env.DB.prepare("UPDATE portfolios SET published = 0 WHERE photographer_id = ?").bind(photographer.id).run();
  return json({ ok: true, unpublished: !left?.n });
}

async function reorderPhotos(request, env, photographer) {
  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.map(String) : null;
  if (!ids) return fail(400, "Requête invalide");
  const current = await photosOf(env, photographer.id);
  const known = new Set(current.map((p) => p.id));
  if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
    return fail(400, "L'ordre envoyé ne correspond pas aux photos du portfolio");
  }
  await env.DB.batch(ids.map((id, i) => env.DB.prepare("UPDATE portfolio_photos SET position = ? WHERE id = ?").bind(i, id)));
  return json({ ok: true });
}

async function deleteMessage(env, photographer, messageId) {
  const result = await env.DB.prepare("DELETE FROM portfolio_messages WHERE id = ? AND photographer_id = ?")
    .bind(messageId, photographer.id)
    .run();
  if (!result?.meta?.changes) return fail(404, "Message introuvable");
  return json({ ok: true });
}

export async function handlePortfolioAdmin(request, env, photographerId, parts, url) {
  const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(photographerId).first();
  if (!photographer) return fail(401, "Session invalide");
  const method = request.method;
  if (parts.length === 3 && method === "GET") return portfolioForAdmin(env, photographer);
  if (parts.length === 3 && method === "PUT") return savePortfolio(request, env, photographer);
  if (parts.length === 4 && parts[3] === "photos" && method === "PUT") return addPhoto(request, env, photographer, url);
  if (parts.length === 4 && parts[3] === "order" && method === "POST") return reorderPhotos(request, env, photographer);
  if (parts.length === 5 && parts[3] === "photos" && method === "GET") return servePhoto(env, photographer.id, decodeURIComponent(parts[4]), "private, max-age=300");
  if (parts.length === 5 && parts[3] === "photos" && method === "DELETE") return deletePhoto(env, photographer, decodeURIComponent(parts[4]));
  if (parts.length === 5 && parts[3] === "messages" && method === "DELETE") return deleteMessage(env, photographer, decodeURIComponent(parts[4]));
  return fail(404, "Route inconnue");
}

// Fichiers R2 du portfolio, effacés avec le compte (privacy.js).
export async function deletePortfolioFiles(env, photographerId) {
  const photos = await photosOf(env, photographerId);
  for (const p of photos) await env.TILES.delete(photoKey(photographerId, p.id));
  return photos.length;
}
