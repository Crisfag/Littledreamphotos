#!/usr/bin/env node
// Interface d'administration — équivalent web de prepare.mjs / detect.mjs.
//
//   node admin-server.mjs
//   → http://127.0.0.1:4000
//
// Tourne en local, sur votre machine : c'est elle qui a accès au jeton
// d'administration et à la clé forensique — le navigateur ne les voit jamais,
// il ne parle qu'à ce serveur sur la boucle locale (127.0.0.1). Le traitement
// des photos (sharp) a besoin d'un vrai processus Node ; c'est pour ça que
// cette interface tourne chez vous plutôt que d'être hébergée quelque part.
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
const HOST = "127.0.0.1"; // jamais 0.0.0.0 : ce serveur porte des secrets d'administration
const PORT = Number(process.env.GALERIE_ADMIN_PORT || 4000);
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

const config = {
  api: process.env.GALERIE_API || "",
  adminToken: process.env.GALERIE_ADMIN_TOKEN || "",
  forensicKey: process.env.GALERIE_FORENSIC_KEY || "",
  brand: process.env.GALERIE_BRAND || "Little Dream Photos",
  // URL publique de web/galerie.html, pour reconstituer le lien complet à
  // donner au client. Sans elle, l'interface affiche seulement « ?g=slug ».
  site: (process.env.GALERIE_SITE || "").replace(/\/$/, ""),
};

const ENV_NAMES = { api: "GALERIE_API", adminToken: "GALERIE_ADMIN_TOKEN", forensicKey: "GALERIE_FORENSIC_KEY" };
const missing = Object.keys(ENV_NAMES).filter((k) => !config[k]);
if (missing.length) {
  console.error(`Configuration manquante : ${missing.map((k) => ENV_NAMES[k]).join(", ")}`);
  console.error(
    "\nCes trois variables d'environnement sont requises (voir README.md « Installation ») :\n" +
    "  export GALERIE_API=https://galerie-protegee.votre-sous-domaine.workers.dev\n" +
    "  export GALERIE_ADMIN_TOKEN=…\n" +
    "  export GALERIE_FORENSIC_KEY=…\n"
  );
  process.exit(1);
}

const client = new WorkerClient(config);

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
async function uniqueSlug(requested, title) {
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

/* ---------- Routes ---------- */

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean); // local, galleries, …

  if (parts.length === 1 && parts[0] === "config" && req.method === "GET") {
    return json(res, 200, {
      brand: config.brand, site: config.site, api: config.api,
      previewCols: PREVIEW_COLS, previewRows: PREVIEW_ROWS,
    });
  }

  // GET /local/tiles/:photoId/:level/:col/:row — relais vers le Worker, sans
  // jamais exposer le jeton d'administration au navigateur.
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

      const slug = await uniqueSlug(body.slug, title);
      const password = String(body.password || "").trim() || generatePassword();
      if (password.length < 8) return json(res, 400, { error: "Mot de passe trop court (8 caractères minimum)" });

      const expiresAt = body.expires
        ? Math.floor(new Date(`${body.expires}T23:59:59`).getTime() / 1000)
        : null;
      if (body.expires && !Number.isFinite(expiresAt)) {
        return json(res, 400, { error: "Date d'expiration illisible" });
      }

      const watermarkText = [config.brand, String(body.clientName || "").trim()].filter(Boolean).join("  ·  ");
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
    const watermarkText = galleryInfo.gallery.watermark_text || config.brand;

    try {
      const input = Buffer.from(await file.arrayBuffer());
      const { photo, tiles, stats } = await processPhoto(input, {
        galleryId: galleryInfo.gallery.id,
        forensicKey: config.forensicKey,
        watermarkText,
        maxWidth: Number(form.get("maxWidth")) || DEFAULTS.maxWidth,
        quality: Number(form.get("quality")) || DEFAULTS.quality,
        opacity: Number(form.get("opacity")) || DEFAULTS.opacity,
        position,
      });

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
