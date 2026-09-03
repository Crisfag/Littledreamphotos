#!/usr/bin/env node
// Préparation et envoi d'une galerie protégée.
//
//   node prepare.mjs --slug dupont-mai --title "Séance famille Dupont" \
//     --client "Famille Dupont" --password "un-mot-de-passe-solide" \
//     --expires 2026-12-31 ./photos/*.jpg
//
// Pour chaque photo : réduction à une taille d'écran, gravure de l'empreinte
// invisible, application du filigrane visible, découpage en tuiles, envoi.
// L'original haute définition ne quitte jamais votre disque.

import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { basename } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { embed, forensicIdFor } from "./lib/forensic.mjs";
import { watermarkSvg } from "./lib/watermark.mjs";
import { gridFor, tileRect, LEVEL_PREVIEW, LEVEL_FULL, PREVIEW_MAX, PREVIEW_COLS, PREVIEW_ROWS } from "./lib/tiles.mjs";

function parseArgs(argv) {
  const options = {
    api: process.env.GALERIE_API || "",
    adminToken: process.env.GALERIE_ADMIN_TOKEN || "",
    forensicKey: process.env.GALERIE_FORENSIC_KEY || "",
    brand: process.env.GALERIE_BRAND || "Little Dream Photos",
    maxWidth: 1600,
    quality: 82,
    opacity: 0.11,
    dryRun: false,
    files: [],
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--api": options.api = next(); break;
      case "--slug": options.slug = next(); break;
      case "--title": options.title = next(); break;
      case "--client": options.client = next(); break;
      case "--password": options.password = next(); break;
      case "--expires": options.expires = next(); break;
      case "--brand": options.brand = next(); break;
      case "--max-width": options.maxWidth = Number(next()); break;
      case "--quality": options.quality = Number(next()); break;
      case "--opacity": options.opacity = Number(next()); break;
      case "--dry-run": options.dryRun = true; break;
      case "--out": options.out = next(); break;
      case "-h": case "--help": options.help = true; break;
      default:
        if (arg.startsWith("--")) throw new Error(`Option inconnue : ${arg}`);
        options.files.push(arg);
    }
  }
  return options;
}

const USAGE = `
Préparer et envoyer une galerie protégée.

  node prepare.mjs --slug <identifiant-url> --password <mot-de-passe> [options] <photos…>

Options
  --slug        identifiant dans l'URL de la galerie (minuscules, tirets)
  --title       titre affiché au client
  --client      nom du client, inscrit dans le filigrane
  --password    mot de passe d'accès (8 caractères minimum)
  --expires     date d'expiration, ex. 2026-12-31
  --brand       votre marque dans le filigrane        (défaut : Little Dream Photos)
  --max-width   largeur maximale livrée en pixels     (défaut : 1600)
  --quality     qualité JPEG des tuiles               (défaut : 82)
  --opacity     opacité du filigrane visible          (défaut : 0.11)
  --dry-run     écrit le résultat en local, n'envoie rien
  --out         dossier de sortie pour --dry-run      (défaut : ./apercu)

Variables d'environnement
  GALERIE_API           URL du Worker
  GALERIE_ADMIN_TOKEN   jeton d'administration
  GALERIE_FORENSIC_KEY  clé du filigrane invisible — à conserver précieusement :
                        sans elle, plus aucune fuite n'est traçable
`;

async function api(options, method, path, body, raw = false) {
  const response = await fetch(`${options.api.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${options.adminToken}`,
      ...(raw ? { "content-type": "application/octet-stream" } : body ? { "content-type": "application/json" } : {}),
    },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${method} ${path} → ${response.status} ${detail}`);
  }
  return response.status === 204 ? null : response.json();
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help || options.files.length === 0) {
    console.log(USAGE);
    process.exit(options.help ? 0 : 1);
  }
  if (!options.slug) throw new Error("--slug est requis");
  if (!options.dryRun) {
    if (!options.api) throw new Error("--api ou GALERIE_API est requis");
    if (!options.adminToken) throw new Error("GALERIE_ADMIN_TOKEN est requis");
    if (!options.password) throw new Error("--password est requis");
  }
  if (!options.forensicKey) {
    throw new Error(
      "GALERIE_FORENSIC_KEY est requis : c'est la clé qui rend les fuites traçables.\n" +
      "  Générez-la une fois pour toutes et gardez-la : openssl rand -hex 32"
    );
  }

  const expiresAt = options.expires
    ? Math.floor(new Date(`${options.expires}T23:59:59`).getTime() / 1000)
    : null;
  if (options.expires && !Number.isFinite(expiresAt)) {
    throw new Error(`Date d'expiration illisible : ${options.expires}`);
  }

  const watermarkText = [options.brand, options.client].filter(Boolean).join("  ·  ");

  let galleryId = "local";
  if (!options.dryRun) {
    const created = await api(options, "POST", "/api/admin/galleries", {
      slug: options.slug,
      title: options.title || options.slug,
      clientName: options.client || "",
      password: options.password,
      watermarkText,
      expiresAt,
    });
    galleryId = created.id;
    console.log(`Galerie créée : ${options.slug} (${galleryId})`);
  }

  const outDir = options.out || "./apercu";
  if (options.dryRun) await mkdir(outDir, { recursive: true });

  const index = [];
  for (const [position, file] of options.files.entries()) {
    const label = basename(file);

    // 1. Réduction à une taille d'écran. C'est la protection la plus efficace
    //    et la plus simple : une capture d'écran de 1600 px ne s'imprime pas.
    const resized = sharp(file)
      .rotate() // respecte l'orientation EXIF avant de perdre les métadonnées
      .resize({ width: options.maxWidth, height: options.maxWidth, fit: "inside", withoutEnlargement: true })
      .removeAlpha()
      .toColourspace("srgb");
    const { data, info } = await resized.raw().toBuffer({ resolveWithObject: true });

    // 2. L'identifiant de la photo est tiré ici, pas côté serveur : l'empreinte
    //    en dépend, et il faut donc la connaître avant de graver les pixels.
    const { cols, rows } = gridFor(info.width, info.height);
    const photoId = `pho_${randomBytes(9).toString("base64url")}`;
    const forensicId = forensicIdFor(galleryId, photoId, options.forensicKey);

    // 3. Empreinte invisible, gravée avant le filigrane visible : elle reste
    //    donc lisible même si quelqu'un parvient à retirer la trame.
    const pixels = Buffer.from(data);
    const stats = embed({ data: pixels, width: info.width, height: info.height, channels: info.channels }, forensicId, options.forensicKey);


    // 4. Filigrane visible par-dessus.
    const watermarked = await sharp(pixels, {
      raw: { width: info.width, height: info.height, channels: info.channels },
    })
      .composite([{ input: watermarkSvg({ width: info.width, height: info.height, text: watermarkText, opacity: options.opacity }) }])
      .jpeg({ quality: 95 })
      .toBuffer();

    // 5. Version réduite pour la grille de vignettes.
    const previewBuffer = await sharp(watermarked)
      .resize({ width: PREVIEW_MAX, height: PREVIEW_MAX, fit: "inside" })
      .toBuffer();
    const preview = await sharp(previewBuffer).metadata();

    // 6. Enregistrement auprès du Worker, une fois toutes les dimensions connues.
    if (!options.dryRun) {
      await api(options, "POST", `/api/admin/galleries/${options.slug}/photos`, {
        id: photoId,
        position,
        width: info.width,
        height: info.height,
        cols,
        rows,
        previewWidth: preview.width,
        previewHeight: preview.height,
        forensicId: String(forensicId),
      });
    }

    // 7. Découpage et envoi, niveau par niveau.
    const levels = [
      { level: LEVEL_PREVIEW, source: previewBuffer, width: preview.width, height: preview.height, cols: PREVIEW_COLS, rows: PREVIEW_ROWS },
      { level: LEVEL_FULL, source: watermarked, width: info.width, height: info.height, cols, rows },
    ];

    let sent = 0;
    for (const target of levels) {
      for (let row = 0; row < target.rows; row++) {
        for (let col = 0; col < target.cols; col++) {
          const rect = tileRect(target.width, target.height, target.cols, target.rows, col, row);
          const tile = await sharp(target.source)
            .extract(rect)
            .jpeg({ quality: options.quality, chromaSubsampling: "4:2:0", mozjpeg: true })
            .toBuffer();
          if (options.dryRun) {
            await mkdir(`${outDir}/${position}/${target.level}`, { recursive: true });
            await writeFile(`${outDir}/${position}/${target.level}/${col}_${row}.jpg`, tile);
          } else {
            await api(options, "PUT", `/api/admin/tiles/${photoId}/${target.level}/${col}/${row}`, tile, true);
          }
          sent++;
        }
      }
    }

    if (options.dryRun) {
      await writeFile(`${outDir}/${position}-complet.jpg`, watermarked);
    }
    index.push({ position, photoId, forensicId, file: label, width: info.width, height: info.height });
    console.log(
      `  ${String(position + 1).padStart(3)}. ${label.padEnd(28)} ` +
      `${info.width}×${info.height}  ${sent} tuiles  empreinte ${forensicId}  (${stats.blocks} blocs)`
    );
  }

  // Journal local des empreintes : c'est lui qu'on consulte quand une photo fuite.
  const manifest = { slug: options.slug, galleryId, createdAt: new Date().toISOString(), photos: index };
  await writeFile(`galerie-${options.slug}.json`, JSON.stringify(manifest, null, 2));
  console.log(`\n${index.length} photo(s) traitée(s). Empreintes consignées dans galerie-${options.slug}.json`);
  if (options.dryRun) console.log(`Aperçu écrit dans ${outDir}/`);
}

main().catch((err) => {
  console.error(`\nÉchec : ${err.message}`);
  process.exit(1);
});
