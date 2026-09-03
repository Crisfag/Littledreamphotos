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
//
// Wrapper en ligne de commande autour de lib/pipeline.mjs et lib/client.mjs —
// c'est le même code que le serveur d'administration (admin-server.mjs) utilise.

import { basename } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { processPhoto, DEFAULTS } from "./lib/pipeline.mjs";
import { WorkerClient } from "./lib/client.mjs";

function parseArgs(argv) {
  const options = {
    api: process.env.GALERIE_API || "",
    adminToken: process.env.GALERIE_ADMIN_TOKEN || "",
    forensicKey: process.env.GALERIE_FORENSIC_KEY || "",
    brand: process.env.GALERIE_BRAND || "Little Dream Photos",
    maxWidth: DEFAULTS.maxWidth,
    quality: DEFAULTS.quality,
    opacity: DEFAULTS.opacity,
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

Astuce : « node admin-server.mjs » ouvre une interface web équivalente, avec
glisser-déposer et suivi de progression — pratique pour l'usage courant.
`;

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
  const client = options.dryRun ? null : new WorkerClient(options);

  let galleryId = "local";
  if (client) {
    const created = await client.createGallery({
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
    const input = await readFile(file);

    const { photo, tiles, watermarkedFull, stats } = await processPhoto(input, {
      galleryId,
      forensicKey: options.forensicKey,
      watermarkText,
      maxWidth: options.maxWidth,
      quality: options.quality,
      opacity: options.opacity,
      position,
    });

    if (client) {
      await client.addPhoto(options.slug, photo);
      for (const tile of tiles) {
        await client.putTile(photo.id, tile.level, tile.col, tile.row, tile.buffer);
      }
    } else {
      for (const tile of tiles) {
        await mkdir(`${outDir}/${position}/${tile.level}`, { recursive: true });
        await writeFile(`${outDir}/${position}/${tile.level}/${tile.col}_${tile.row}.jpg`, tile.buffer);
      }
      await writeFile(`${outDir}/${position}-complet.jpg`, watermarkedFull);
    }

    index.push({ position, photoId: photo.id, forensicId: photo.forensicId, file: label, width: photo.width, height: photo.height });
    console.log(
      `  ${String(position + 1).padStart(3)}. ${label.padEnd(28)} ` +
      `${photo.width}×${photo.height}  ${tiles.length} tuiles  empreinte ${photo.forensicId}  (${stats.blocks} blocs)`
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
