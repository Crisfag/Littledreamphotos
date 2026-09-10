// Filigrane invisible (« forensique ») : grave un identifiant de 32 bits dans
// les pixels, indétectable à l'œil mais lisible après capture d'écran,
// redimensionnement, recadrage ou ré-encodage JPEG.
//
// Principe — chaque bloc de 16 × 16 px est découpé en quatre quadrants 8 × 8
// disposés en damier :
//
//     A B        On ajoute +δ de luminance au groupe A et −δ au groupe B
//     B A        (ou l'inverse) selon le bit à encoder.
//
// À la lecture on calcule (A − B). Sur une image naturelle cette différence est
// nulle en moyenne : la disposition diagonale annule exactement tout dégradé
// linéaire, quelle que soit sa direction. Le signe de la somme sur des centaines
// de blocs révèle donc le bit, sans jamais avoir besoin de l'image d'origine.
//
// Les blocs sont attribués aux bits par un motif périodique (8 × 8 blocs, soit
// 128 × 128 px) tiré d'une clé secrète. La périodicité rend la lecture
// insensible au recadrage ; la clé fait que sans elle, on ne sait pas où le
// filigrane se trouve — donc pas comment l'effacer proprement.

import { createHash } from "node:crypto";

export const BLOCK = 16;
export const QUAD = BLOCK / 2;
export const PAYLOAD_BITS = 32;
export const PERIOD = 8; // en blocs : le motif se répète tous les 8 × 8 blocs

// Amplitude en niveaux de luminance (sur 255) : bien en dessous de ce que le
// JPEG lui-même déplace, donc invisible sur une photo. On monte d'un cran dans
// les zones texturées, où le bruit naturel masque totalement la modification.
const DELTA_FLAT = 3;
const DELTA_TEXTURED = 4;
const FLAT_SPREAD = 6;

/**
 * Motif clé : 64 emplacements, chacun portant un des 32 bits (deux fois chacun),
 * mélangés de façon déterministe par la clé du photographe.
 */
export function patternFor(key) {
  const slots = PERIOD * PERIOD;
  const pattern = new Uint8Array(slots);
  for (let i = 0; i < slots; i++) pattern[i] = i % PAYLOAD_BITS;

  // Mélange de Fisher-Yates piloté par un flux d'octets dérivé de la clé.
  let stream = createHash("sha256").update(`${key}|pattern`).digest();
  let cursor = 0;
  const nextByte = () => {
    if (cursor >= stream.length) {
      stream = createHash("sha256").update(stream).digest();
      cursor = 0;
    }
    return stream[cursor++];
  };
  for (let i = slots - 1; i > 0; i--) {
    const j = ((nextByte() << 8) | nextByte()) % (i + 1);
    const tmp = pattern[i];
    pattern[i] = pattern[j];
    pattern[j] = tmp;
  }
  return pattern;
}

export function idToBits(id) {
  const value = BigInt.asUintN(32, BigInt(id));
  const bits = new Uint8Array(PAYLOAD_BITS);
  for (let i = 0; i < PAYLOAD_BITS; i++) {
    bits[i] = Number((value >> BigInt(PAYLOAD_BITS - 1 - i)) & 1n);
  }
  return bits;
}

export function bitsToId(bits) {
  let value = 0n;
  for (let i = 0; i < PAYLOAD_BITS; i++) value = (value << 1n) | BigInt(bits[i] ? 1 : 0);
  return Number(value);
}

// Identifiant dérivé de la galerie et de la photo : reproductible, donc
// retrouvable en base après détection d'une fuite.
export function forensicIdFor(galleryId, photoId, key) {
  return createHash("sha256").update(`${key}|${galleryId}|${photoId}`).digest().readUInt32BE(0);
}

// Moyennes de luminance des quatre quadrants d'un bloc, et différence en damier.
function quadrantMeans(data, width, channels, x0, y0, out) {
  for (let q = 0; q < 4; q++) {
    const qx = x0 + (q % 2) * QUAD;
    const qy = y0 + (q >> 1) * QUAD;
    let sum = 0;
    for (let y = qy; y < qy + QUAD; y++) {
      let idx = (y * width + qx) * channels;
      for (let x = 0; x < QUAD; x++) {
        sum += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        idx += channels;
      }
    }
    out[q] = sum / (QUAD * QUAD);
  }
  // Quadrants 0 (haut-gauche) et 3 (bas-droite) = groupe A ; 1 et 2 = groupe B.
  return (out[0] + out[3]) / 2 - (out[1] + out[2]) / 2;
}

/**
 * Grave l'identifiant dans un buffer de pixels bruts (modifié sur place).
 * @param {{data: Uint8Array, width: number, height: number, channels: number}} raw
 * @param {number} id identifiant 32 bits
 * @param {string} key clé secrète du photographe
 */
export function embed(raw, id, key) {
  const { data, width, height, channels } = raw;
  const bits = idToBits(id);
  const pattern = patternFor(key);
  const blocksX = Math.floor(width / BLOCK);
  const blocksY = Math.floor(height / BLOCK);
  const means = new Float64Array(4);
  let embedded = 0;
  let skipped = 0;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const x0 = bx * BLOCK;
      const y0 = by * BLOCK;
      quadrantMeans(data, width, channels, x0, y0, means);

      const mean = (means[0] + means[1] + means[2] + means[3]) / 4;
      // Un bloc quasiment noir ou brûlé serait écrêté : la modification y serait
      // perdue à la lecture, on le laisse intact.
      if (mean < 8 || mean > 247) {
        skipped++;
        continue;
      }

      const spread = Math.sqrt(means.reduce((a, m) => a + (m - mean) ** 2, 0) / 4);
      const delta = spread > FLAT_SPREAD ? DELTA_TEXTURED : DELTA_FLAT;
      const bit = bits[pattern[(by % PERIOD) * PERIOD + (bx % PERIOD)]];

      for (let q = 0; q < 4; q++) {
        const inGroupA = q === 0 || q === 3;
        const adjust = ((bit === 1) === inGroupA ? 1 : -1) * delta;
        const qx = x0 + (q % 2) * QUAD;
        const qy = y0 + (q >> 1) * QUAD;
        for (let y = qy; y < qy + QUAD; y++) {
          let idx = (y * width + qx) * channels;
          for (let x = 0; x < QUAD; x++) {
            for (let c = 0; c < 3 && c < channels; c++) {
              const v = data[idx + c] + adjust;
              data[idx + c] = v < 0 ? 0 : v > 255 ? 255 : v;
            }
            idx += channels;
          }
        }
      }
      embedded++;
    }
  }
  return { blocks: embedded, skipped };
}

// Les blocs très contrastés (un contour net traversant le damier) produisent
// des différences énormes qui noieraient le signal du filigrane dans la somme.
// On les écrête : leur vote compte, mais il ne domine plus.
const CLIP = 10;

// Carte des différences en damier pour un alignement pixel donné.
function diffMap(raw, offsetX, offsetY) {
  const { data, width, height, channels } = raw;
  const blocksX = Math.floor((width - offsetX) / BLOCK);
  const blocksY = Math.floor((height - offsetY) / BLOCK);
  const map = new Float64Array(Math.max(0, blocksX * blocksY));
  const means = new Float64Array(4);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const d = quadrantMeans(data, width, channels, offsetX + bx * BLOCK, offsetY + by * BLOCK, means);
      map[by * blocksX + bx] = d > CLIP ? CLIP : d < -CLIP ? -CLIP : d;
    }
  }
  return { map, blocksX, blocksY };
}

// Accumulateur : pour chaque bit, la somme des différences des blocs qui le
// portent, normalisée par √N (le bruit croît en √N, le signal en N).
function accumulate(map, blocksX, blocksY, pattern, blockOffsetX, blockOffsetY) {
  const acc = new Float64Array(PAYLOAD_BITS);
  const counts = new Uint32Array(PAYLOAD_BITS);
  for (let by = 0; by < blocksY; by++) {
    const py = (by + blockOffsetY) % PERIOD;
    for (let bx = 0; bx < blocksX; bx++) {
      const bit = pattern[py * PERIOD + ((bx + blockOffsetX) % PERIOD)];
      acc[bit] += map[by * blocksX + bx];
      counts[bit]++;
    }
  }
  for (let i = 0; i < PAYLOAD_BITS; i++) {
    if (counts[i]) acc[i] /= Math.sqrt(counts[i]);
  }
  return acc;
}

// Énergie du signal d'un accumulateur : au bon alignement, tous les bits
// ressortent franchement ; au mauvais, il ne reste que du bruit centré.
function energy(acc) {
  let total = 0;
  for (let i = 0; i < PAYLOAD_BITS; i++) total += Math.abs(acc[i]);
  return total / PAYLOAD_BITS;
}

// Parcourt les alignements plausibles : décalage pixel (une capture
// redimensionnée n'est plus sur la grille) et décalage de bloc (un recadrage
// déplace le motif). Il y en a 16 × 16 × 8 × 8 = 16 384 ; corréler chacun avec
// toute la base d'identifiants coûterait une demi-minute, alors on retient
// d'abord les meilleurs candidats par énergie, puis on ne note que ceux-là.
function searchAlignments(raw, key, score, shortlist = 32) {
  const pattern = patternFor(key);
  const best = [];
  // Les 16 000 mauvais alignements ne contiennent que du bruit : leur énergie
  // médiane donne gratuitement le niveau de référence auquel comparer le
  // meilleur alignement. C'est la mesure qui distingue une image marquée d'une
  // image vierge, sans rien connaître du contenu.
  const energies = [];

  const consider = (candidate) => {
    if (best.length < shortlist) {
      best.push(candidate);
      if (best.length === shortlist) best.sort((a, b) => a.energy - b.energy);
      return;
    }
    if (candidate.energy <= best[0].energy) return;
    best[0] = candidate;
    best.sort((a, b) => a.energy - b.energy);
  };

  for (let oy = 0; oy < BLOCK; oy++) {
    for (let ox = 0; ox < BLOCK; ox++) {
      const { map, blocksX, blocksY } = diffMap(raw, ox, oy);
      if (blocksX < PERIOD || blocksY < PERIOD) continue;
      for (let by = 0; by < PERIOD; by++) {
        for (let bx = 0; bx < PERIOD; bx++) {
          const acc = accumulate(map, blocksX, blocksY, pattern, bx, by);
          energies.push(energy(acc));
          consider({
            acc,
            energy: energy(acc),
            offsetX: ox,
            offsetY: oy,
            blockOffsetX: bx,
            blockOffsetY: by,
          });
        }
      }
    }
  }

  if (!energies.length) return null;
  energies.sort((a, b) => a - b);
  const noiseFloor = energies[Math.floor(energies.length / 2)] || 1e-9;

  let winner = null;
  for (const candidate of best) {
    const result = score(candidate.acc);
    if (!winner || result.value > winner.value) winner = { ...candidate, ...result };
  }
  return winner ? { ...winner, noiseFloor, snr: winner.energy / noiseFloor } : null;
}

function correlation(acc, id) {
  const bits = idToBits(id);
  let sum = 0;
  for (let i = 0; i < PAYLOAD_BITS; i++) sum += bits[i] ? acc[i] : -acc[i];
  return sum / PAYLOAD_BITS;
}

/**
 * Décodage aveugle : lit l'identifiant sans rien connaître d'avance.
 * Utile pour un diagnostic, mais moins fiable que `identify`.
 * @returns {{id: number, strength: number, offsetX: number, offsetY: number}}
 */
export function extract(raw, key) {
  const best = searchAlignments(raw, key, (acc) => {
    const bits = new Uint8Array(PAYLOAD_BITS);
    for (let i = 0; i < PAYLOAD_BITS; i++) bits[i] = acc[i] > 0 ? 1 : 0;
    return { value: energy(acc), id: bitsToId(bits) };
  });
  if (!best) return { id: 0, snr: 0, offsetX: 0, offsetY: 0 };
  return {
    id: best.id,
    snr: best.snr,
    offsetX: best.offsetX,
    offsetY: best.offsetY,
  };
}

/**
 * Identification par corrélation avec les identifiants connus du photographe.
 * Nettement plus robuste que le décodage aveugle : au lieu de trancher chaque
 * bit isolément, on cherche lequel des identifiants déjà émis explique le mieux
 * ce qu'on mesure — et on vérifie qu'il se détache nettement des autres.
 *
 * @param {object} raw pixels bruts de l'image suspecte
 * @param {string} key clé secrète du photographe
 * @param {number[]} candidates identifiants forensiques enregistrés
 * @returns {{id: number, score: number, zScore: number, offsetX: number, offsetY: number}|null}
 */
export function identify(raw, key, candidates) {
  if (!candidates || candidates.length === 0) return null;

  const best = searchAlignments(raw, key, (acc) => {
    let top = -Infinity;
    let topId = 0;
    for (const candidate of candidates) {
      const value = correlation(acc, candidate);
      if (value > top) {
        top = value;
        topId = candidate;
      }
    }
    return { value: top, id: topId };
  });
  if (!best) return null;

  // Deux indices indépendants, à confronter :
  //  - `snr` : l'image porte-t-elle un filigrane ? (énergie du meilleur
  //    alignement rapportée au bruit des mauvais alignements)
  //  - `matchingBits` : lequel des identifiants émis est-ce ? (sur 32 bits,
  //    32/32 est une correspondance parfaite, 16/32 le pur hasard)
  const bits = idToBits(best.id);
  let matchingBits = 0;
  for (let i = 0; i < PAYLOAD_BITS; i++) {
    if ((best.acc[i] > 0 ? 1 : 0) === bits[i]) matchingBits++;
  }

  return {
    id: best.id,
    snr: best.snr,
    matchingBits,
    offsetX: best.offsetX,
    offsetY: best.offsetY,
    blockOffsetX: best.blockOffsetX,
    blockOffsetY: best.blockOffsetY,
  };
}

// Seuils de décision, calibrés sur 77 photos réelles confrontées à 2 000
// empreintes émises (voir tests/calibration.mjs) :
//
//                        photos marquées     photos vierges
//   signal/bruit         5,58 au minimum     1,63 au maximum
//   bits concordants     32/32 partout       30/32 au maximum
//
// Les seuils sont placés dans cet écart, volontairement plus près du haut : un
// faux positif accuserait un client à tort, ce qui est bien plus grave qu'une
// fuite non attribuée. Une image très dégradée peut donc passer sous le seuil —
// `detect.mjs` affiche alors les mesures brutes pour un examen manuel.
export const MATCH_MIN_SNR = 2.5;
export const MATCH_MIN_BITS = 31;

export function isMatch(result) {
  return Boolean(result) && result.snr >= MATCH_MIN_SNR && result.matchingBits >= MATCH_MIN_BITS;
}
