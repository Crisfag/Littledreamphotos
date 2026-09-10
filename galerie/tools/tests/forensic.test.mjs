import sharp from "sharp";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { embed, extract, identify, isMatch, forensicIdFor } from "../lib/forensic.mjs";

const KEY = "cle-secrete-du-photographe";
const SRC = process.env.SRC ||
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "images", "famille", "famille-04.jpeg");
// 1600 px est la taille de livraison par défaut : c'est celle sur laquelle les
// seuils de détection sont calibrés. On peut en passer une autre en argument
// pour explorer les limites.
const WIDTH = Number(process.argv[2] || 1600);
const SUPPORTED = WIDTH >= 1200;

const base = sharp(SRC).resize({ width: WIDTH }).removeAlpha().toColourspace("srgb");
const { data, info } = await base.raw().toBuffer({ resolveWithObject: true });
console.log(`Image de test : ${info.width} × ${info.height}, ${info.channels} canaux`);

const original = Buffer.from(data);
const id = forensicIdFor("gal_demo", "pho_demo", KEY);
const marked = Buffer.from(data);
const stats = embed({ data: marked, width: info.width, height: info.height, channels: info.channels }, id, KEY);
console.log(`Identifiant gravé : ${id} sur ${stats.blocks} blocs (${stats.skipped} ignorés)`);

// Base d'identifiants du photographe : le vrai + 999 autres galeries.
const candidates = [id];
for (let i = 0; i < 999; i++) candidates.push((Math.random() * 0x100000000) >>> 0);

let sumSq = 0, maxDiff = 0;
for (let i = 0; i < original.length; i++) {
  const d = marked[i] - original[i];
  sumSq += d * d;
  if (Math.abs(d) > maxDiff) maxDiff = Math.abs(d);
}
console.log(
  `Qualité : PSNR ${(10 * Math.log10(255 * 255 / (sumSq / original.length))).toFixed(1)} dB, ` +
  `écart maximal ${maxDiff} niveaux sur 255`
);

const markedImg = sharp(marked, { raw: { width: info.width, height: info.height, channels: info.channels } });
const results = [];

// `atLimit` : scénario connu pour approcher la limite en dessous de la taille
// de livraison. On l'annonce au lieu de le compter comme un défaut — ou de le
// masquer en abaissant les seuils, ce qui exposerait à accuser un client à tort.
async function scenario(label, pipeline, expectFound = true, atLimit = false) {
  const t0 = Date.now();
  const { data: d, info: i } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const raw = { data: d, width: i.width, height: i.height, channels: i.channels };
  const match = identify(raw, KEY, candidates);
  const blind = extract(raw, KEY);
  const found = isMatch(match) && match.id === id;
  const ok = found === expectFound;
  const tolerated = !ok && atLimit && !SUPPORTED;
  results.push(ok || tolerated);
  console.log(
    `${ok ? "✓" : tolerated ? "~" : "✗"} ${label.padEnd(40)} ` +
    `id=${match.id === id ? "bon " : "AUTRE"} snr=${match.snr.toFixed(2).padStart(5)} ` +
    `bits=${String(match.matchingBits).padStart(2)}/32 aveugle=${blind.id === id ? "bon" : "non"} ` +
    `(${((Date.now() - t0) / 1000).toFixed(1)} s)` +
    (tolerated ? `  ← limite connue en dessous de 1200 px` : "")
  );
}

await scenario("pixels bruts", markedImg.clone());

const jpeg85 = await markedImg.clone().jpeg({ quality: 85 }).toBuffer();
await scenario("JPEG qualité 85", sharp(jpeg85));
await scenario("JPEG qualité 45 (recompression forte)", sharp(await markedImg.clone().jpeg({ quality: 45 }).toBuffer()));

// Capture d'écran : affiché plus petit, capturé en PNG, remis à l'échelle connue.
const shot = await sharp(jpeg85).resize({ width: Math.round(info.width * 0.75) }).png().toBuffer();
await scenario("capture d'écran 75 % puis remise à l'échelle", sharp(shot).resize({ width: info.width }));

const shot2 = await sharp(jpeg85).resize({ width: Math.round(info.width * 1.4) }).png().toBuffer();
await scenario("capture d'écran agrandie 140 %", sharp(shot2).resize({ width: info.width }));

// Recadrage : 60 % au centre, échelle d'origine conservée.
await scenario(
  "recadrage 60 %",
  sharp(await sharp(jpeg85)
    .extract({
      left: Math.floor(info.width * 0.2), top: Math.floor(info.height * 0.2),
      width: Math.floor(info.width * 0.6), height: Math.floor(info.height * 0.6),
    })
    .toBuffer()),
  true,
  true
);

await scenario("noir et blanc", sharp(jpeg85).grayscale());
await scenario("luminosité +10 %", sharp(jpeg85).modulate({ brightness: 1.1 }));

// Contrôle : une image jamais marquée ne doit correspondre à aucun identifiant.
await scenario("image vierge (aucun filigrane)", sharp(SRC).resize({ width: WIDTH }).removeAlpha(), false);

console.log(
  results.every(Boolean)
    ? `\nTous les scénarios passent à ${WIDTH} px.`
    : `\n${results.filter((r) => !r).length} scénario(s) en échec à ${WIDTH} px.`
);
process.exit(results.every(Boolean) ? 0 : 1);
