// Traitement d'une photo : réduction, empreinte invisible, filigrane visible,
// découpage en tuiles. Point commun entre l'outil en ligne de commande
// (prepare.mjs) et le serveur d'administration (admin-server.mjs) : les deux
// doivent produire des tuiles identiques, donc partagent ce code plutôt que
// de le dupliquer.

import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { embed, forensicIdFor } from "./forensic.mjs";
import { watermarkSvg } from "./watermark.mjs";
import { gridFor, tileRect, LEVEL_PREVIEW, LEVEL_FULL, PREVIEW_MAX, PREVIEW_COLS, PREVIEW_ROWS } from "./tiles.mjs";

export const DEFAULTS = {
  maxWidth: 1600,
  quality: 82,
  opacity: 0.11,
};

/**
 * Traite une photo jusqu'aux tuiles prêtes à l'envoi. Ne fait aucun appel
 * réseau : c'est à l'appelant d'envoyer `photo` et `tiles` au Worker (ou de
 * les écrire sur disque, comme le fait `--dry-run`).
 *
 * @param {Buffer|string} input fichier source ou son chemin
 * @param {object} options
 * @param {string} options.galleryId identifiant de la galerie (dérive l'empreinte)
 * @param {string} options.forensicKey clé secrète du photographe
 * @param {string} options.watermarkText texte du filigrane visible
 * @param {number} [options.maxWidth]
 * @param {number} [options.quality]
 * @param {number} [options.opacity]
 * @param {string} [options.photoId] identifiant à réutiliser (sinon généré)
 * @param {number} [options.position] position dans la galerie
 * @returns {Promise<{photo: object, tiles: Array<{level:number,col:number,row:number,buffer:Buffer}>, watermarkedFull: Buffer, stats: object}>}
 */
export async function processPhoto(input, options) {
  const maxWidth = options.maxWidth ?? DEFAULTS.maxWidth;
  const quality = options.quality ?? DEFAULTS.quality;
  const opacity = options.opacity ?? DEFAULTS.opacity;

  if (!options.galleryId) throw new Error("processPhoto: galleryId requis");
  if (!options.forensicKey) throw new Error("processPhoto: forensicKey requis");

  // 1. Réduction à une taille d'écran. C'est la protection la plus efficace
  //    et la plus simple : une capture d'écran de 1600 px ne s'imprime pas.
  const resized = sharp(input)
    .rotate() // respecte l'orientation EXIF avant de perdre les métadonnées
    .resize({ width: maxWidth, height: maxWidth, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .toColourspace("srgb");
  const { data, info } = await resized.raw().toBuffer({ resolveWithObject: true });

  // 2. L'identifiant de la photo est tiré ici, pas côté serveur : l'empreinte
  //    en dépend, et il faut donc la connaître avant de graver les pixels.
  const { cols, rows } = gridFor(info.width, info.height);
  const photoId = options.photoId || `pho_${randomBytes(9).toString("base64url")}`;
  const forensicId = forensicIdFor(options.galleryId, photoId, options.forensicKey);

  // 3. Empreinte invisible, gravée avant le filigrane visible : elle reste
  //    donc lisible même si quelqu'un parvient à retirer la trame.
  const pixels = Buffer.from(data);
  const stats = embed(
    { data: pixels, width: info.width, height: info.height, channels: info.channels },
    forensicId,
    options.forensicKey
  );

  // 4. Filigrane visible par-dessus.
  const watermarkedFull = await sharp(pixels, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .composite([{ input: watermarkSvg({ width: info.width, height: info.height, text: options.watermarkText || "", opacity }) }])
    .jpeg({ quality: 95 })
    .toBuffer();

  // 5. Version réduite pour la grille de vignettes.
  const previewBuffer = await sharp(watermarkedFull)
    .resize({ width: PREVIEW_MAX, height: PREVIEW_MAX, fit: "inside" })
    .toBuffer();
  const preview = await sharp(previewBuffer).metadata();

  // 6. Découpage, niveau par niveau.
  const levels = [
    { level: LEVEL_PREVIEW, source: previewBuffer, width: preview.width, height: preview.height, cols: PREVIEW_COLS, rows: PREVIEW_ROWS },
    { level: LEVEL_FULL, source: watermarkedFull, width: info.width, height: info.height, cols, rows },
  ];

  const tiles = [];
  for (const target of levels) {
    for (let row = 0; row < target.rows; row++) {
      for (let col = 0; col < target.cols; col++) {
        const rect = tileRect(target.width, target.height, target.cols, target.rows, col, row);
        const buffer = await sharp(target.source)
          .extract(rect)
          .jpeg({ quality, chromaSubsampling: "4:2:0", mozjpeg: true })
          .toBuffer();
        tiles.push({ level: target.level, col, row, buffer });
      }
    }
  }

  return {
    photo: {
      id: photoId,
      position: options.position ?? 0,
      width: info.width,
      height: info.height,
      cols,
      rows,
      previewWidth: preview.width,
      previewHeight: preview.height,
      forensicId: String(forensicId),
    },
    tiles,
    watermarkedFull,
    stats,
  };
}
