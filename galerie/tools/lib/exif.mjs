// Heure de prise de vue d'une photo, lue dans ses métadonnées EXIF : sert à
// regrouper les photos d'une séance scolaire par enfant (rafales, voir
// worker/src/school.js). Lecture minimale, sans dépendance : on ne cherche
// que DateTimeOriginal (0x9003) et ses centièmes (SubSecTimeOriginal,
// 0x9291), avec DateTime (0x0132) en secours.
//
// Le résultat est un nombre de millisecondes « à l'heure de l'appareil »,
// sans fuseau : seuls les écarts entre photos d'une même séance comptent.

const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME = 0x0132;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_SUBSEC_ORIGINAL = 0x9291;

function asciiAt(view, offset, count) {
  let out = "";
  for (let i = 0; i < count && offset + i < view.byteLength; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
}

// Lit les entrées d'un IFD : { tag: valeur } pour les chaînes ASCII et les
// pointeurs (LONG) qui nous intéressent.
function readIfd(view, tiffStart, ifdOffset, little) {
  const out = {};
  const base = tiffStart + ifdOffset;
  if (base + 2 > view.byteLength) return out;
  const count = view.getUint16(base, little);
  for (let i = 0; i < count; i++) {
    const entry = base + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const n = view.getUint32(entry + 4, little);
    if (type === 2) {
      // ASCII : dans l'entrée si 4 octets ou moins, sinon à l'offset indiqué.
      const at = n <= 4 ? entry + 8 : tiffStart + view.getUint32(entry + 8, little);
      out[tag] = asciiAt(view, at, n);
    } else if (type === 4) {
      out[tag] = view.getUint32(entry + 8, little);
    }
  }
  return out;
}

// « 2026:10:07 09:02:14 » (+ « 37 » centièmes) → millisecondes.
export function exifDateToMs(value, subsec = "") {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(value || "").trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  if (!Number.isFinite(ms) || Number(m[1]) < 1990) return null;
  const digits = String(subsec || "").trim().replace(/\D/g, "").slice(0, 3);
  const fraction = digits ? Math.round(Number(digits.padEnd(3, "0"))) : 0;
  return ms + fraction;
}

/**
 * @param {Buffer|Uint8Array} exif bloc EXIF tel que renvoyé par sharp
 *   (metadata().exif), avec ou sans l'en-tête « Exif\0\0 »
 * @returns {number|null} millisecondes, ou null si l'heure est absente
 */
export function takenAtFromExif(exif) {
  if (!exif || !exif.length) return null;
  const bytes = exif instanceof Uint8Array ? exif : new Uint8Array(exif);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let start = 0;
  if (asciiAt(view, 0, 4) === "Exif") start = 6;
  if (start + 8 > view.byteLength) return null;
  const order = asciiAt(view, start, 2);
  const little = order === "II";
  if (!little && order !== "MM") return null;
  if (view.getUint16(start + 2, little) !== 42) return null;
  try {
    const ifd0 = readIfd(view, start, view.getUint32(start + 4, little), little);
    let original = null;
    let subsec = "";
    if (ifd0[TAG_EXIF_IFD]) {
      const exifIfd = readIfd(view, start, ifd0[TAG_EXIF_IFD], little);
      original = exifIfd[TAG_DATETIME_ORIGINAL] || null;
      subsec = exifIfd[TAG_SUBSEC_ORIGINAL] || "";
    }
    return exifDateToMs(original || ifd0[TAG_DATETIME], original ? subsec : "");
  } catch {
    return null;
  }
}
