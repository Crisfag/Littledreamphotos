#!/usr/bin/env node
// Prévisualisation locale d'une galerie préparée avec `--dry-run`.
//
//   node prepare.mjs --slug essai --client "Famille Dupont" --dry-run photos/*.jpg
//   node preview-server.mjs --slug essai
//   → http://localhost:8787  (mot de passe : apercu)
//
// Parle exactement le même protocole que le Worker : c'est donc l'interface
// réelle du client qu'on regarde, sans rien déployer ni exposer.
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "web");

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = args.indexOf(name);
  return at !== -1 && args[at + 1] ? args[at + 1] : fallback;
};
const OUT = argOf("--out", "./apercu");
const SLUG = argOf("--slug", "essai");
const PASSWORD = argOf("--password", "apercu");
const PORT = Number(argOf("--port", 8787));

const manifest = JSON.parse(await readFile(`galerie-${SLUG}.json`, "utf8"));
// Reconstitue le manifeste que renverrait le Worker en inspectant les tuiles.
async function gridOf(dir) {
  const names = await readdir(dir);
  let cols = 0, rows = 0;
  for (const name of names) {
    const [c, r] = name.replace(".jpg", "").split("_").map(Number);
    cols = Math.max(cols, c + 1);
    rows = Math.max(rows, r + 1);
  }
  return { cols, rows };
}

// Les dimensions d'un niveau sont la somme des tuiles de la première ligne et
// de la première colonne : `tileRect` répartit les pixels restants, donc les
// tuiles n'ont pas toutes exactement la même taille.
async function sizeOf(dir, grid) {
  let width = 0, height = 0;
  for (let c = 0; c < grid.cols; c++) width += (await sharp(`${dir}/${c}_0.jpg`).metadata()).width;
  for (let r = 0; r < grid.rows; r++) height += (await sharp(`${dir}/0_${r}.jpg`).metadata()).height;
  return { width, height };
}

const photos = [];
for (const photo of manifest.photos) {
  const previewDir = `${OUT}/${photo.position}/0`;
  const fullDir = `${OUT}/${photo.position}/1`;
  const previewGrid = await gridOf(previewDir);
  const fullGrid = await gridOf(fullDir);
  const previewSize = await sizeOf(previewDir, previewGrid);
  const fullSize = await sizeOf(fullDir, fullGrid);
  if (fullSize.width !== photo.width || fullSize.height !== photo.height) {
    throw new Error(
      `Les tuiles de la photo ${photo.position} ne se recomposent pas : ` +
      `${fullSize.width}×${fullSize.height} au lieu de ${photo.width}×${photo.height}`
    );
  }
  photos.push({
    id: `pho_${photo.position}`,
    position: photo.position,
    width: photo.width,
    height: photo.height,
    cols: fullGrid.cols,
    rows: fullGrid.rows,
    previewWidth: previewSize.width,
    previewHeight: previewSize.height,
  });
}
console.log(`${photos.length} photo(s), tuiles recomposées aux bonnes dimensions`);

const TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8" };
const events = [];
let issued = null;

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const send = (status, body, type = "application/json") => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };

  try {
    if (url.pathname === `/api/gallery/${SLUG}/login` && req.method === "POST") {
      const body = JSON.parse(await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d || "{}")); }));
      if (body.password !== PASSWORD) return send(401, { error: "Mot de passe incorrect." });
      issued = `jeton-${Date.now()}`;
      return send(200, {
        token: issued,
        expiresIn: 7200,
        gallery: {
          title: `Aperçu — ${SLUG}`,
          clientName: "",
          watermark: "",
          expiresAt: Math.floor(Date.now() / 1000) + 86400,
        },
        photos: photos.map(({ position, ...p }) => p),
      });
    }

    const tile = url.pathname.match(new RegExp(`^/api/gallery/${SLUG}/tile/([^/]+)/(\\d)/(\\d+)/(\\d+)$`));
    if (tile && req.method === "GET") {
      if (req.headers.authorization !== `Bearer ${issued}`) return send(401, { error: "Session expirée" });
      const photo = photos.find((p) => p.id === tile[1]);
      if (!photo) return send(404, { error: "Photo introuvable" });
      const file = `${OUT}/${photo.position}/${tile[2]}/${tile[3]}_${tile[4]}.jpg`;
      return send(200, await readFile(file), "image/jpeg");
    }

    if (url.pathname === `/api/gallery/${SLUG}/event` && req.method === "POST") {
      const body = JSON.parse(await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d || "{}")); }));
      events.push(body);
      console.log(`  journal: ${body.event} ${body.detail || ""}`);
      return send(200, { ok: true });
    }

    if (url.pathname === "/__events") return send(200, { events });

    // Fichiers statiques de l'interface. La page est servie avec l'adresse de
    // l'API réécrite vers ce serveur.
    const name = url.pathname === "/" ? "/galerie.html" : url.pathname;
    const ext = name.split(".").pop();
    let body = await readFile(`${WEB}${name}`);
    if (ext === "html") {
      body = body.toString().replace(/api: "[^"]*"/, `api: "http://localhost:${PORT}"`);
    }
    return send(200, body, TYPES[ext] || "application/octet-stream");
  } catch (err) {
    return send(err.code === "ENOENT" ? 404 : 500, { error: String(err.message) });
  }
}).listen(PORT, () =>
  console.log(
    `Aperçu sur http://localhost:${PORT}/galerie.html?g=${SLUG}\n` +
    `Mot de passe : ${PASSWORD}\n` +
    `Les évènements de dissuasion sont affichés ici au fur et à mesure.`
  )
);
