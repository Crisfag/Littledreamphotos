// Salle de presse : ce que l'outil d'administration relève sur le fichier HD
// à l'envoi.
//
// 1. Les légendes et crédits déjà saisis par le photographe (Photo Mechanic,
//    Lightroom…) : IPTC IIM (segment APP13 « Photoshop 3.0 ») et XMP.
// 2. La « carte » de l'en-tête JPEG, qui permet au Worker d'y écrire crédit,
//    licence et refus de l'IA au téléchargement sans relire tout le fichier
//    (voir worker/src/pressfile.js) : position d'insertion, segments XMP à
//    retirer, fin de la zone réécrite et CRC-32 de la suite.

import zlib from "node:zlib";

const XMP_NS = "http://ns.adobe.com/xap/1.0/\u0000";
const XMP_EXT = "http://ns.adobe.com/xmp/extension/\u0000";

function ascii(buf, start, len) {
  return buf.toString("latin1", start, Math.min(buf.length, start + len));
}

// Segments de l'en-tête, jusqu'au début des données d'image (SOS).
export function jpegSegments(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const segments = [];
  let pos = 2;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) return segments;
    let marker = buf[pos + 1];
    while (marker === 0xff && pos + 2 < buf.length) {
      pos++;
      marker = buf[pos + 1];
    }
    if (marker === 0xda || marker === 0xd9) return segments; // SOS / EOI
    if (marker >= 0xd0 && marker <= 0xd7) {
      pos += 2;
      continue;
    }
    const len = buf.readUInt16BE(pos + 2);
    if (len < 2 || pos + 2 + len > buf.length) return segments;
    segments.push({ marker, start: pos, end: pos + 2 + len, dataStart: pos + 4 });
    pos += 2 + len;
  }
  return segments;
}

export function headerMap(buf) {
  const segments = jpegSegments(buf);
  if (!segments || !segments.length) return null;
  // Notre XMP se place juste après le bloc Exif (qui doit rester le premier
  // lu), sinon après JFIF, sinon tout au début.
  const exif = segments.find((s) => s.marker === 0xe1 && ascii(buf, s.dataStart, 6) === "Exif\u0000\u0000");
  const jfif = segments.find((s) => s.marker === 0xe0);
  const insertAt = exif ? exif.end : jfif ? jfif.end : 2;
  const strip = segments
    .filter((s) => s.marker === 0xe1 && [XMP_NS, XMP_EXT].some((ns) => ascii(buf, s.dataStart, ns.length) === ns))
    .map((s) => [s.start, s.end]);
  const headEnd = Math.max(insertAt, ...strip.map(([, b]) => b));
  if (headEnd < 2 || headEnd >= buf.length) return null;
  return { insertAt, strip, headEnd, tailCrc: zlib.crc32(buf.subarray(headEnd)) >>> 0 };
}

/* ---------- Lecture IPTC IIM et XMP ---------- */

function decodeText(bytes, utf8) {
  if (utf8) return Buffer.from(bytes).toString("utf8");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return Buffer.from(bytes).toString("latin1");
  }
}

function readIim(buf, segments) {
  const out = {};
  for (const s of segments) {
    if (s.marker !== 0xed || ascii(buf, s.dataStart, 14) !== "Photoshop 3.0\u0000") continue;
    let p = s.dataStart + 14;
    while (p + 12 <= s.end) {
      if (ascii(buf, p, 4) !== "8BIM") break;
      const id = buf.readUInt16BE(p + 4);
      const nameLen = buf[p + 6];
      let q = p + 7 + nameLen;
      if ((nameLen + 1) % 2) q++;
      const size = buf.readUInt32BE(q);
      const data = q + 4;
      if (id === 0x0404) {
        let r = data;
        let utf8 = false;
        while (r + 5 <= data + size && buf[r] === 0x1c) {
          const rec = buf[r + 1];
          const ds = buf[r + 2];
          const len = buf.readUInt16BE(r + 3);
          const v = buf.subarray(r + 5, r + 5 + len);
          if (rec === 1 && ds === 90) utf8 = v.includes(0x47); // ESC % G
          if (rec === 2) {
            const text = decodeText(v, utf8).trim();
            const key = { 105: "headline", 120: "caption", 80: "byline", 110: "credit", 90: "city", 116: "copyright", 55: "date" }[ds];
            if (key && text && !out[key]) out[key] = text;
            if (ds === 25 && text) (out.keywords ||= []).push(text);
          }
          r += 5 + len;
        }
      }
      p = data + size + (size % 2);
    }
  }
  return out;
}

function unxml(s) {
  return String(s || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
}

function readXmp(buf, segments) {
  const out = {};
  for (const s of segments) {
    if (s.marker !== 0xe1 || ascii(buf, s.dataStart, XMP_NS.length) !== XMP_NS) continue;
    const x = buf.toString("utf8", s.dataStart + XMP_NS.length, s.end);
    const firstLi = (tag) => {
      const m = x.match(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<rdf:li[^>]*>([\\s\\S]*?)</rdf:li>`));
      return m ? unxml(m[1]) : "";
    };
    const attr = (name) => {
      const m = x.match(new RegExp(`${name}="([^"]*)"`)) || x.match(new RegExp(`<${name}>([^<]*)</${name}>`));
      return m ? unxml(m[1]) : "";
    };
    out.caption ||= firstLi("dc:description");
    out.headline ||= attr("photoshop:Headline") || firstLi("dc:title");
    out.byline ||= firstLi("dc:creator");
    out.credit ||= attr("photoshop:Credit");
    out.city ||= attr("photoshop:City");
    out.copyright ||= firstLi("dc:rights");
    const subj = x.match(/<dc:subject>[\s\S]*?<\/dc:subject>/);
    if (subj && !out.keywords) {
      const kws = [...subj[0].matchAll(/<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/g)].map((m) => unxml(m[1])).filter(Boolean);
      if (kws.length) out.keywords = kws;
    }
  }
  return out;
}

// Légendes et crédits trouvés dans le fichier (XMP d'abord, puis IIM).
export function readPressMeta(buf) {
  const segments = jpegSegments(buf);
  if (!segments) return {};
  const xmp = readXmp(buf, segments);
  const iim = readIim(buf, segments);
  const pick = (k) => String(xmp[k] || iim[k] || "").slice(0, 2000);
  return {
    headline: pick("headline").slice(0, 300),
    caption: pick("caption"),
    byline: pick("byline").slice(0, 200),
    credit: pick("credit").slice(0, 200),
    city: pick("city").slice(0, 120),
    copyright: pick("copyright").slice(0, 300),
    keywords: [...new Set([...(xmp.keywords || []), ...(iim.keywords || [])])].slice(0, 60).map((k) => k.slice(0, 80)),
  };
}
