import sharp from "sharp";
import { readdirSync } from "node:fs";
import { embed, identify, forensicIdFor } from "../lib/forensic.mjs";

const KEY = "cle-de-calibration";
const root = "/home/user/Littledreamphotos/images";
const files = [];
for (const dir of readdirSync(root, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const f of readdirSync(`${root}/${dir.name}`)) {
    if (/\.(jpe?g|png|webp)$/i.test(f)) files.push(`${root}/${dir.name}/${f}`);
  }
}
console.log(`${files.length} photos de calibration\n`);

const candidates = [];
for (let i = 0; i < 2000; i++) candidates.push((Math.random() * 0x100000000) >>> 0);

const marked = [];
const clean = [];

for (const [n, file] of files.entries()) {
  const { data, info } = await sharp(file)
    .resize({ width: 1600, withoutEnlargement: true })
    .removeAlpha().toColourspace("srgb")
    .raw().toBuffer({ resolveWithObject: true });

  // Cas négatif : photo jamais marquée, confrontée à 2000 identifiants émis.
  const vierge = identify({ data, width: info.width, height: info.height, channels: info.channels }, KEY, candidates);
  clean.push(vierge);

  // Cas positif : filigrane gravé, puis JPEG 85 comme à la livraison.
  const id = forensicIdFor("gal_cal", `pho_${n}`, KEY);
  const buf = Buffer.from(data);
  embed({ data: buf, width: info.width, height: info.height, channels: info.channels }, id, KEY);
  const jpeg = await sharp(buf, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .jpeg({ quality: 85 }).toBuffer();
  const { data: d2, info: i2 } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const found = identify({ data: d2, width: i2.width, height: i2.height, channels: i2.channels }, KEY, [id, ...candidates]);
  marked.push({ ...found, correct: found.id === id });

  if ((n + 1) % 20 === 0) process.stdout.write(`  ${n + 1}/${files.length}\r`);
}

const stat = (arr, pick) => {
  const v = arr.map(pick).sort((a, b) => a - b);
  return { min: v[0], p05: v[Math.floor(v.length * 0.05)], med: v[Math.floor(v.length / 2)], p95: v[Math.floor(v.length * 0.95)], max: v[v.length - 1] };
};
const show = (label, s, digits = 2) =>
  console.log(`${label.padEnd(22)} min=${s.min.toFixed(digits)} p05=${s.p05.toFixed(digits)} médiane=${s.med.toFixed(digits)} p95=${s.p95.toFixed(digits)} max=${s.max.toFixed(digits)}`);

console.log("\n— Photos MARQUÉES (doivent être détectées) —");
show("SNR", stat(marked, (r) => r.snr));
show("bits concordants", stat(marked, (r) => r.matchingBits), 0);
console.log(`identifiant correct : ${marked.filter((r) => r.correct).length}/${marked.length}`);

console.log("\n— Photos VIERGES (ne doivent JAMAIS correspondre) —");
show("SNR", stat(clean, (r) => r.snr));
show("bits concordants", stat(clean, (r) => r.matchingBits), 0);

const worstMarked = Math.min(...marked.map((r) => r.snr));
const bestClean = Math.max(...clean.map((r) => r.snr));
console.log(`\nMarge : pire marquée SNR ${worstMarked.toFixed(2)} / meilleure vierge SNR ${bestClean.toFixed(2)}`);
console.log(`bits : pire marquée ${Math.min(...marked.map((r) => r.matchingBits))} / meilleure vierge ${Math.max(...clean.map((r) => r.matchingBits))}`);
