#!/usr/bin/env node
// Identification d'une photo qui a fuité.
//
//   node detect.mjs capture-trouvee-sur-instagram.jpg
//
// Relit l'empreinte invisible et la confronte aux empreintes émises, pour
// répondre à une seule question : de quelle galerie — donc de quel client —
// cette image provient-elle ?

import sharp from "sharp";
import { readdir, readFile } from "node:fs/promises";
import { identify, isMatch, MATCH_MIN_SNR, MATCH_MIN_BITS } from "./lib/forensic.mjs";

function parseArgs(argv) {
  const options = {
    api: process.env.GALERIE_API || "",
    adminToken: process.env.GALERIE_ADMIN_TOKEN || "",
    forensicKey: process.env.GALERIE_FORENSIC_KEY || "",
    files: [],
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--api") options.api = argv[++i];
    else if (arg === "--width") options.width = Number(argv[++i]);
    else if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg.startsWith("--")) throw new Error(`Option inconnue : ${arg}`);
    else options.files.push(arg);
  }
  return options;
}

// Empreintes connues : depuis le Worker si on a le jeton, sinon depuis les
// fichiers galerie-*.json laissés par prepare.mjs.
async function loadPrints(options) {
  if (options.api && options.adminToken) {
    const response = await fetch(`${options.api.replace(/\/$/, "")}/api/admin/forensic`, {
      headers: { authorization: `Bearer ${options.adminToken}` },
    });
    if (!response.ok) throw new Error(`Lecture des empreintes : ${response.status}`);
    const { prints } = await response.json();
    return prints.map((p) => ({
      id: Number(p.forensic_id),
      slug: p.slug,
      title: p.title,
      client: p.client_name,
      photo: p.photo_id,
      position: p.position,
    }));
  }

  const prints = [];
  for (const name of await readdir(".")) {
    if (!/^galerie-.*\.json$/.test(name)) continue;
    const manifest = JSON.parse(await readFile(name, "utf8"));
    for (const photo of manifest.photos || []) {
      prints.push({
        id: Number(photo.forensicId),
        slug: manifest.slug,
        title: manifest.slug,
        client: "",
        photo: photo.photoId,
        position: photo.position,
        width: photo.width,
      });
    }
  }
  return prints;
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help || options.files.length === 0) {
    console.log(`
Identifier l'origine d'une photo qui a fuité.

  node detect.mjs <image…> [--api <url>] [--width <px>]

  --width   force une remise à l'échelle avant analyse (sinon toutes les
            largeurs connues des galeries sont essayées)

Variables d'environnement : GALERIE_FORENSIC_KEY (obligatoire),
GALERIE_API et GALERIE_ADMIN_TOKEN (sinon lecture des galerie-*.json locaux).
`);
    process.exit(options.help ? 0 : 1);
  }
  if (!options.forensicKey) throw new Error("GALERIE_FORENSIC_KEY est requis");

  const prints = await loadPrints(options);
  if (prints.length === 0) throw new Error("Aucune empreinte connue : rien à comparer");
  const byId = new Map(prints.map((p) => [p.id, p]));
  const candidates = [...byId.keys()];
  console.log(`${candidates.length} empreinte(s) connue(s)\n`);

  // Une capture d'écran est presque toujours redimensionnée : on réessaie donc
  // l'analyse à chaque largeur de livraison connue, en plus de la taille reçue.
  const widths = options.width
    ? [options.width]
    : [...new Set([0, ...prints.map((p) => p.width).filter(Boolean), 1600])];

  for (const file of options.files) {
    let best = null;
    for (const width of widths) {
      const pipeline = sharp(file).removeAlpha().toColourspace("srgb");
      const { data, info } = await (width ? pipeline.resize({ width }) : pipeline)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const found = identify({ data, width: info.width, height: info.height, channels: info.channels }, options.forensicKey, candidates);
      if (found && (!best || found.snr > best.snr)) best = { ...found, testedWidth: width || info.width };
    }

    console.log(`── ${file}`);
    if (isMatch(best)) {
      const origin = byId.get(best.id);
      console.log(`   ORIGINE IDENTIFIÉE`);
      console.log(`   galerie   : ${origin.title} (${origin.slug})`);
      if (origin.client) console.log(`   client    : ${origin.client}`);
      console.log(`   photo     : ${origin.photo} (n° ${origin.position + 1})`);
      console.log(`   empreinte : ${best.id}`);
      console.log(`   fiabilité : signal/bruit ${best.snr.toFixed(2)}, ${best.matchingBits}/32 bits concordants`);
    } else if (best) {
      console.log(`   aucune correspondance fiable`);
      console.log(`   meilleur essai : empreinte ${best.id}, signal/bruit ${best.snr.toFixed(2)}, ` +
                  `${best.matchingBits}/32 bits (seuils : ${MATCH_MIN_SNR} et ${MATCH_MIN_BITS}/32)`);
      console.log(`   l'image ne vient probablement pas de vos galeries, ou a été trop dégradée.`);
    } else {
      console.log(`   image trop petite pour porter une empreinte lisible`);
    }
    console.log();
  }
}

main().catch((err) => {
  console.error(`Échec : ${err.message}`);
  process.exit(1);
});
