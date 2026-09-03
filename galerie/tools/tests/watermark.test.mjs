// Le filigrane visible doit se voir partout — pas seulement sur les zones
// sombres. On mesure donc son effet séparément dans les hautes lumières, les
// tons moyens et les ombres : un filigrane d'une seule couleur s'effondre sur
// l'une des trois plages, et une moyenne globale le cacherait.
//
// Deux grandeurs, pas une :
//   · couverture — quelle part de la plage la trame traverse. Trop faible, et
//     un détatouage n'a presque rien à reconstruire ;
//   · force — de combien de niveaux elle déplace les pixels qu'elle touche.
//     C'est ce qu'on perçoit. Une moyenne sur tous les pixels la diluerait
//     dans les 92 % de surface que la trame ne touche pas.

import sharp from "sharp";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { watermarkSvg } from "../lib/watermark.mjs";

// Photos de référence : le dossier images/ du dépôt, ou PHOTOS_DIR.
const root = process.env.PHOTOS_DIR ||
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "images");
const files = [];
for (const dir of readdirSync(root, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const f of readdirSync(`${root}/${dir.name}`)) {
    if (/\.(jpe?g|png|webp)$/i.test(f)) files.push(`${root}/${dir.name}/${f}`);
  }
}

const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

// Contraste apporté par le filigrane, par plage de luminosité du fond.
async function contrastByBand(file) {
  const { data, info } = await sharp(file)
    .resize({ width: 1600, withoutEnlargement: true })
    .removeAlpha().toColourspace("srgb")
    .raw().toBuffer({ resolveWithObject: true });

  // `composite` ajoute un canal alpha : sans ce removeAlpha, les deux buffers
  // n'ont pas le même nombre de canaux et on comparerait des pixels décalés.
  const { data: marked, info: markedInfo } = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .composite([{ input: watermarkSvg({ width: info.width, height: info.height, text: "Little Dream Photos  ·  Famille Dupont" }) }])
    .removeAlpha()
    .raw().toBuffer({ resolveWithObject: true });
  if (markedInfo.channels !== info.channels) {
    throw new Error(`canaux incohérents : ${info.channels} contre ${markedInfo.channels}`);
  }

  const bands = {
    ombres: { touched: 0, total: 0, sum: 0 },
    moyens: { touched: 0, total: 0, sum: 0 },
    lumieres: { touched: 0, total: 0, sum: 0 },
  };
  for (let i = 0; i < data.length; i += info.channels) {
    const before = luma(data, i);
    const diff = Math.abs(luma(marked, i) - before);
    const band = bands[before < 85 ? "ombres" : before < 190 ? "moyens" : "lumieres"];
    band.total++;
    if (diff >= 1) {
      band.touched++;
      band.sum += diff;
    }
  }

  const result = {};
  for (const [name, band] of Object.entries(bands)) {
    // Une plage quasi absente de la photo (pas de vraies hautes lumières, par
    // exemple) ne dit rien d'utile : on l'écarte au lieu de la compter à zéro.
    result[name] = band.total < 20000 ? null : {
      coverage: band.touched / band.total,
      strength: band.touched ? band.sum / band.touched : 0,
    };
  }
  return result;
}

const totals = { ombres: [], moyens: [], lumieres: [] };
for (const file of files) {
  const result = await contrastByBand(file);
  for (const band of Object.keys(totals)) {
    if (result[band]) totals[band].push(result[band]);
  }
}

// Seuils : en dessous de 4 niveaux la trame n'est plus perçue, et en dessous
// de 4 % de couverture elle laisse trop de surface intacte pour gêner un
// détatouage automatique.
const MIN_STRENGTH = 4;
const MIN_COVERAGE = 0.04;

console.log(`${files.length} photos analysées\n`);
let failed = 0;
for (const band of ["ombres", "moyens", "lumieres"]) {
  const values = totals[band];
  if (values.length === 0) {
    console.log(`· ${band.padEnd(9)} absente des photos de test`);
    continue;
  }
  const strengths = values.map((v) => v.strength).sort((a, b) => a - b);
  const coverages = values.map((v) => v.coverage).sort((a, b) => a - b);
  const p05 = (arr) => arr[Math.floor(arr.length * 0.05)];
  const ok = p05(strengths) >= MIN_STRENGTH && p05(coverages) >= MIN_COVERAGE;
  if (!ok) failed++;
  console.log(
    `${ok ? "✓" : "✗"} ${band.padEnd(9)} force ${p05(strengths).toFixed(1)} à ` +
    `${strengths[strengths.length - 1].toFixed(1)} niveaux (5e centile ${p05(strengths).toFixed(1)}, seuil ${MIN_STRENGTH})  ` +
    `couverture ${(p05(coverages) * 100).toFixed(1)} à ${(coverages[coverages.length - 1] * 100).toFixed(1)} %`
  );
}
console.log(failed ? `\n${failed} plage(s) où le filigrane s'efface.` : "\nLe filigrane porte sur toute la plage tonale.");
process.exit(failed ? 1 : 0);
