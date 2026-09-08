#!/usr/bin/env node
// Interface d'administration — équivalent web de prepare.mjs / detect.mjs.
//
//   node admin-server.mjs
//   → http://127.0.0.1:4000
//
// Tourne sur un vrai processus Node (traitement des photos avec sharp, que
// Cloudflare Workers ne sait pas exécuter). En local, elle n'écoute que sur
// la boucle 127.0.0.1 — seule votre machine peut la joindre. Hébergée,
// plusieurs photographes peuvent l'utiliser : chacun se connecte avec son
// propre compte, dans le navigateur ; le jeton de session voyage dans un
// cookie httpOnly que le JavaScript de la page ne voit jamais, et chaque
// requête n'agit qu'au nom du compte qui l'a envoyée.
//
// Réutilise exactement le code de prepare.mjs (lib/pipeline.mjs, lib/client.mjs)
// : une galerie créée depuis le navigateur ou depuis la ligne de commande
// produit des tuiles identiques.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { processPhoto, DEFAULTS } from "./lib/pipeline.mjs";
import { PREVIEW_COLS, PREVIEW_ROWS } from "./lib/tiles.mjs";
import { WorkerClient } from "./lib/client.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, "admin");
// 127.0.0.1 par défaut : c'est ce qui rend l'usage local sûr sans rien
// configurer. Une fois hébergée derrière un vrai reverse proxy (Fly.io,
// Railway…), GALERIE_ADMIN_HOST=0.0.0.0 rend le service joignable — la
// protection vient alors des comptes/sessions, plus de la boucle locale.
const HOST = process.env.GALERIE_ADMIN_HOST || "127.0.0.1";
// PORT : beaucoup d'hébergeurs (Render, Railway…) imposent leur propre port
// via cette variable plutôt que de laisser le service choisir.
const PORT = Number(process.env.GALERIE_ADMIN_PORT || process.env.PORT || 4000);
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
const SESSION_COOKIE = "galerie_session";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // aligné sur la durée du jeton côté Worker

// Le navigateur peut envoyer plusieurs photos en parallèle (voir
// UPLOAD_CONCURRENCY dans admin.js), mais le traitement d'une photo (sharp)
// est gourmand en mémoire. Sur un petit conteneur hébergé, en traiter
// plusieurs à la fois peut faire planter le processus (constaté : échecs
// 502 sous Render, offre gratuite). On sérialise donc le traitement lui-même
// ici, indépendamment du nombre de requêtes reçues en même temps — 1 par
// défaut, à monter avec GALERIE_PROCESS_CONCURRENCY si l'hébergement le permet.
const PROCESS_CONCURRENCY = Math.max(1, Number(process.env.GALERIE_PROCESS_CONCURRENCY) || 1);
let activeProcessing = 0;
const processingQueue = [];

function withProcessingSlot(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeProcessing++;
      fn().then(resolve, reject).finally(() => {
        activeProcessing--;
        const next = processingQueue.shift();
        if (next) next();
      });
    };
    if (activeProcessing < PROCESS_CONCURRENCY) run();
    else processingQueue.push(run);
  });
}

const config = {
  api: process.env.GALERIE_API || "",
  forensicKey: process.env.GALERIE_FORENSIC_KEY || "",
  brand: process.env.GALERIE_BRAND || "",
  // URL publique de web/galerie.html, pour reconstituer le lien complet à
  // donner au client. Sans elle, l'interface affiche seulement « ?g=slug ».
  site: (process.env.GALERIE_SITE || "").replace(/\/$/, ""),
};

const ENV_NAMES = { api: "GALERIE_API", forensicKey: "GALERIE_FORENSIC_KEY" };
const missing = Object.keys(ENV_NAMES).filter((k) => !config[k]);
if (missing.length) {
  console.error(`Configuration manquante : ${missing.map((k) => ENV_NAMES[k]).join(", ")}`);
  console.error(
    "\nCes variables d'environnement sont requises (voir README.md « Installation ») :\n" +
    "  export GALERIE_API=https://galerie-protegee.votre-sous-domaine.workers.dev\n" +
    "  export GALERIE_FORENSIC_KEY=…\n" +
    "\nChaque photographe se connecte ensuite depuis le navigateur avec son\n" +
    "propre compte (créé une fois avec « node signup.mjs »).\n"
  );
  process.exit(1);
}

/* ---------- Utilitaires ---------- */

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

function slugify(text) {
  return text
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // retire les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 55);
}

// Lisible au téléphone : pas de 0/O/1/l/I, groupé par quatre.
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function generatePassword() {
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
    if (i % 4 === 3 && i !== 15) out += "-";
  }
  return out;
}

// Slug demandé, ou dérivé du titre ; en cas de collision, on suffixe -2, -3…
async function uniqueSlug(client, requested, title) {
  const base = slugify(requested || title || "galerie") || "galerie";
  const padded = base.length < 2 ? `${base}xx` : base;
  const { galleries } = await client.listGalleries();
  const taken = new Set(galleries.map((g) => g.slug));
  if (!taken.has(padded)) return padded;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${padded}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("Impossible de générer un identifiant unique");
}

function nodeRequestToWebRequest(req, body) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return new Request(`http://${HOST}${req.url}`, { method: req.method, headers, body });
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES) throw Object.assign(new Error("Fichier trop volumineux"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const STATIC_TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", svg: "image/svg+xml" };

async function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const full = normalize(join(PUBLIC_DIR, rel));
  // Comparaison de préfixe avec limite de séparateur : "/admin" ne doit pas
  // matcher un répertoire voisin comme "/admin-secrets". Ceinture et
  // bretelles — decodeURIComponent(pathname) ne peut de toute façon pas
  // produire de « .. » ici, la normalisation de l'URL les a déjà retirés.
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + sep)) {
    return json(res, 403, { error: "Interdit" });
  }
  try {
    const info = await stat(full);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile(full);
    const ext = full.split(".").pop();
    res.writeHead(200, { "content-type": STATIC_TYPES[ext] || "application/octet-stream" });
    res.end(body);
  } catch {
    json(res, 404, { error: "Introuvable" });
  }
}

/* ---------- Sessions ---------- */
// Le jeton renvoyé par le Worker EST la session : signé par le Worker,
// vérifié par le Worker à chaque appel. Ce serveur n'a besoin d'aucun état
// à lui — juste de le transporter dans un cookie que le JavaScript de la
// page ne peut pas lire (HttpOnly), pour qu'une faille XSS dans l'interface
// ne suffise pas à voler la session.

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key) out[key] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function isSecureRequest(req) {
  return req.headers["x-forwarded-proto"] === "https" || process.env.GALERIE_ADMIN_FORCE_SECURE_COOKIES === "1";
}

function setSessionCookie(req, res, token, maxAgeSeconds) {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecureRequest(req)) attrs.push("Secure");
  res.setHeader("set-cookie", attrs.join("; "));
}

function clearSessionCookie(req, res) {
  const attrs = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isSecureRequest(req)) attrs.push("Secure");
  res.setHeader("set-cookie", attrs.join("; "));
}

// Renvoie un WorkerClient authentifié au nom du visiteur, ou répond 401 et
// renvoie null. Toutes les routes protégées démarrent par cet appel.
async function requireSession(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) {
    json(res, 401, { error: "Non connecté" });
    return null;
  }
  return new WorkerClient({ api: config.api, token });
}

/* ---------- Traduction des erreurs du Worker ---------- */

function relayError(res, err, fallback) {
  const status = err && err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
  let message = fallback;
  try {
    const parsed = JSON.parse(err.detail || "{}");
    if (parsed.error) message = parsed.error;
  } catch {
    /* le Worker ne répond pas toujours en JSON (ex. délai réseau) */
  }
  json(res, status, { error: message });
}

/* ---------- Authentification ---------- */

async function handleAuth(req, res, parts) {
  if (parts.length === 2 && parts[1] === "login" && req.method === "POST") {
    let body;
    try {
      body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    } catch {
      return json(res, 400, { error: "Requête invalide" });
    }
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    if (!email || !password) return json(res, 400, { error: "E-mail et mot de passe requis" });

    let loginRes;
    try {
      loginRes = await fetch(`${config.api}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      return json(res, 502, { error: "Worker injoignable" });
    }
    const data = await loginRes.json().catch(() => ({}));
    if (!loginRes.ok) return json(res, loginRes.status, { error: data.error || "Connexion refusée" });

    setSessionCookie(req, res, data.token, Math.min(data.expiresIn || SESSION_MAX_AGE, SESSION_MAX_AGE));
    return json(res, 200, { photographer: data.photographer });
  }

  if (parts.length === 2 && parts[1] === "logout" && req.method === "POST") {
    clearSessionCookie(req, res);
    return json(res, 200, { ok: true });
  }

  if (parts.length === 2 && parts[1] === "me" && req.method === "GET") {
    const client = await requireSession(req, res);
    if (!client) return;
    try {
      const { photographer } = await client.me();
      return json(res, 200, { photographer });
    } catch (err) {
      clearSessionCookie(req, res);
      return relayError(res, err, "Session invalide");
    }
  }

  return json(res, 404, { error: "Route inconnue" });
}

/* ---------- Routes protégées ---------- */

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean); // local, galleries, …

  if (parts.length === 1 && parts[0] === "config" && req.method === "GET") {
    return json(res, 200, {
      site: config.site, api: config.api,
      previewCols: PREVIEW_COLS, previewRows: PREVIEW_ROWS,
    });
  }

  if (parts[0] === "auth") return handleAuth(req, res, parts);

  // Tout ce qui suit agit au nom d'un compte : session obligatoire.
  const client = await requireSession(req, res);
  if (!client) return;

  // GET /local/tiles/:photoId/:level/:col/:row — relais vers le Worker.
  if (parts[0] === "tiles" && parts.length === 5 && req.method === "GET") {
    try {
      const upstream = await client.getTileResponse(parts[1], Number(parts[2]), Number(parts[3]), Number(parts[4]));
      if (!upstream.ok) return json(res, upstream.status, { error: "Tuile introuvable" });
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "private, max-age=300" });
      return res.end(buffer);
    } catch (err) {
      return json(res, 502, { error: "Worker injoignable" });
    }
  }

  if (parts[0] !== "galleries") return json(res, 404, { error: "Route inconnue" });

  // GET/POST /local/galleries
  if (parts.length === 1) {
    if (req.method === "GET") {
      const { galleries } = await client.listGalleries();
      return json(res, 200, { galleries });
    }
    if (req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const title = String(body.title || "").trim();
      if (!title) return json(res, 400, { error: "Le titre est requis" });

      const slug = await uniqueSlug(client, body.slug, title);
      const password = String(body.password || "").trim() || generatePassword();
      if (password.length < 8) return json(res, 400, { error: "Mot de passe trop court (8 caractères minimum)" });

      const expiresAt = body.expires
        ? Math.floor(new Date(`${body.expires}T23:59:59`).getTime() / 1000)
        : null;
      if (body.expires && !Number.isFinite(expiresAt)) {
        return json(res, 400, { error: "Date d'expiration illisible" });
      }

      const brand = await brandFor(client);
      const watermarkText = [brand, String(body.clientName || "").trim()].filter(Boolean).join("  ·  ");
      try {
        const created = await client.createGallery({
          slug, title, clientName: body.clientName || "", password, watermarkText, expiresAt,
        });
        return json(res, 201, { id: created.id, slug, password, link: linkFor(slug) });
      } catch (err) {
        return relayError(res, err, "Impossible de créer la galerie");
      }
    }
    return json(res, 405, { error: "Méthode non autorisée" });
  }

  const slug = decodeURIComponent(parts[1]);

  // GET/DELETE /local/galleries/:slug
  if (parts.length === 2) {
    if (req.method === "GET") {
      try {
        const [detail, logResult] = await Promise.all([
          client.getGallery(slug),
          client.galleryLog(slug, 100).catch(() => ({ log: [] })),
        ]);
        return json(res, 200, { ...detail, log: logResult.log, link: linkFor(slug) });
      } catch (err) {
        return relayError(res, err, "Galerie introuvable");
      }
    }
    if (req.method === "DELETE") {
      try {
        await client.deleteGallery(slug);
        return json(res, 200, { ok: true });
      } catch (err) {
        return relayError(res, err, "Impossible de supprimer la galerie");
      }
    }
    return json(res, 405, { error: "Méthode non autorisée" });
  }

  // POST /local/galleries/:slug/photos  (une photo par requête, multipart)
  if (parts.length === 3 && parts[2] === "photos" && req.method === "POST") {
    let galleryInfo;
    try {
      galleryInfo = await client.getGallery(slug);
    } catch (err) {
      return relayError(res, err, "Galerie introuvable");
    }

    const contentLength = Number(req.headers["content-length"] || 0);
    if (contentLength > MAX_UPLOAD_BYTES) return json(res, 413, { error: "Fichier trop volumineux" });

    let form;
    try {
      const body = await readBody(req);
      form = await nodeRequestToWebRequest(req, body).formData();
    } catch (err) {
      return json(res, err.status || 400, { error: err.status ? err.message : "Fichier illisible" });
    }

    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") return json(res, 400, { error: "Aucun fichier reçu" });
    const position = Number(form.get("position")) || galleryInfo.photos.length;
    const watermarkText = galleryInfo.gallery.watermark_text || (await brandFor(client));

    try {
      const input = Buffer.from(await file.arrayBuffer());
      const { photo, tiles, stats } = await withProcessingSlot(() =>
        processPhoto(input, {
          galleryId: galleryInfo.gallery.id,
          forensicKey: config.forensicKey,
          watermarkText,
          maxWidth: Number(form.get("maxWidth")) || DEFAULTS.maxWidth,
          quality: Number(form.get("quality")) || DEFAULTS.quality,
          opacity: Number(form.get("opacity")) || DEFAULTS.opacity,
          position,
        })
      );

      await client.addPhoto(slug, photo);
      for (const tile of tiles) {
        await client.putTile(photo.id, tile.level, tile.col, tile.row, tile.buffer);
      }

      return json(res, 201, { photo, blocks: stats.blocks, name: file.name || "" });
    } catch (err) {
      console.error(`Échec du traitement de ${file.name || "?"} :`, err);
      return relayError(res, err, `Échec du traitement de ${file.name || "cette photo"}`);
    }
  }

  // DELETE /local/galleries/:slug/photos/:photoId
  if (parts.length === 4 && parts[2] === "photos" && req.method === "DELETE") {
    try {
      await client.deletePhoto(slug, decodeURIComponent(parts[3]));
      return json(res, 200, { ok: true });
    } catch (err) {
      return relayError(res, err, "Impossible de supprimer la photo");
    }
  }

  return json(res, 404, { error: "Route inconnue" });
}

// Marque par défaut du filigrane : celle du studio du compte connecté, avec
// GALERIE_BRAND comme filet de secours (utile en développement local).
const brandCache = new Map(); // jeton -> studioName, pour ne pas rappeler /me à chaque photo
async function brandFor(client) {
  if (brandCache.has(client.token)) return brandCache.get(client.token) || config.brand;
  try {
    const { photographer } = await client.me();
    const brand = photographer.studioName || config.brand;
    brandCache.set(client.token, brand);
    return brand;
  } catch {
    return config.brand;
  }
}

function linkFor(slug) {
  return config.site ? `${config.site}?g=${encodeURIComponent(slug)}` : `?g=${encodeURIComponent(slug)}`;
}

/* ---------- Serveur ---------- */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  try {
    if (url.pathname.startsWith("/local/")) {
      await handleApi(req, res, { pathname: url.pathname.slice("/local".length) || "/" });
    } else {
      await serveStatic(req, res, url.pathname);
    }
  } catch (err) {
    console.error("Erreur non gérée :", err);
    json(res, 500, { error: "Erreur interne" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Interface d'administration sur http://${HOST}:${PORT}`);
  console.log(`Worker : ${config.api}`);
  if (!config.site) {
    console.log(`GALERIE_SITE n'est pas défini : les liens client seront relatifs (« ?g=… »).`);
  }
});
