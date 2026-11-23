// Fichiers livrés par la salle de presse : crédit, légende, licence et refus
// de l'entraînement d'IA écrits dans le fichier JPEG au moment du
// téléchargement, pour chaque destinataire.
//
// Le fichier HD est gardé tel qu'envoyé (R2 : {galleryId}/{photoId}/hd). À
// l'envoi, l'outil d'administration en a relevé la « carte » (voir
// tools/lib/pressmeta.mjs) :
//   - head_end : fin de la zone d'en-tête à réécrire (segments APPn) ;
//   - insert_at : où placer notre segment XMP (après JFIF et Exif) ;
//   - strip : les segments XMP d'origine à retirer (un seul XMP par fichier) ;
//   - tail_crc : CRC-32 de tout ce qui suit head_end.
// Au téléchargement, on relit seulement l'en-tête (quelques dizaines de Ko),
// on le réécrit, puis on enchaîne la suite du fichier sans la toucher. Le
// CRC du fichier final (pour le ZIP) se déduit de celui de l'en-tête et de
// tail_crc, sans relire les mégaoctets d'image : un ZIP de 500 photos reste
// léger pour le Worker.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, crc = 0) {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// crc32_combine de zlib : CRC de A‖B à partir de CRC(A), CRC(B) et de la
// longueur de B (arithmétique sur GF(2), en O(log longueur)).
function gf2Times(mat, vec) {
  let sum = 0;
  let i = 0;
  while (vec) {
    if (vec & 1) sum ^= mat[i];
    vec >>>= 1;
    i++;
  }
  return sum >>> 0;
}
function gf2Square(square, mat) {
  for (let n = 0; n < 32; n++) square[n] = gf2Times(mat, mat[n]);
}
export function crc32Combine(crc1, crc2, len2) {
  if (len2 <= 0) return crc1 >>> 0;
  const even = new Uint32Array(32);
  const odd = new Uint32Array(32);
  odd[0] = 0xedb88320;
  let row = 1;
  for (let n = 1; n < 32; n++) {
    odd[n] = row;
    row <<= 1;
  }
  gf2Square(even, odd);
  gf2Square(odd, even);
  let c1 = crc1 >>> 0;
  let len = len2;
  do {
    gf2Square(even, odd);
    if (len % 2) c1 = gf2Times(even, c1);
    len = Math.floor(len / 2);
    if (!len) break;
    gf2Square(odd, even);
    if (len % 2) c1 = gf2Times(odd, c1);
    len = Math.floor(len / 2);
  } while (len);
  return (c1 ^ crc2) >>> 0;
}

/* ---------- XMP ---------- */

function xml(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function alt(value) {
  return `<rdf:Alt><rdf:li xml:lang="x-default">${xml(value)}</rdf:li></rdf:Alt>`;
}

export const DATA_MINING_PROHIBITED = "http://ns.useplus.org/ldf/vocab/DMI-PROHIBITED-AIMLTRAINING";

// Paquet XMP (IPTC Photo Metadata + PLUS). `m` : { credit, byline, copyright,
// headline, caption, keywords[], city, dateCreated, usageTerms, instructions,
// webStatement, licensor, licensorEmail, licensee, licenseeId, licenceId,
// licenceDate, aiReservation }.
export function xmpPacket(m) {
  const attrs = [
    m.credit && `photoshop:Credit="${xml(m.credit)}"`,
    m.headline && `photoshop:Headline="${xml(m.headline)}"`,
    m.city && `photoshop:City="${xml(m.city)}"`,
    m.dateCreated && `photoshop:DateCreated="${xml(m.dateCreated)}"`,
    m.instructions && `photoshop:Instructions="${xml(m.instructions)}"`,
    `xmpRights:Marked="True"`,
    m.webStatement && `xmpRights:WebStatement="${xml(m.webStatement)}"`,
    m.aiReservation && `plus:DataMining="${DATA_MINING_PROHIBITED}"`,
    m.licenceId && `plus:LicenseID="${xml(m.licenceId)}"`,
    m.licenceDate && `plus:LicenseTransactionDate="${xml(m.licenceDate)}"`,
  ].filter(Boolean).join("\n    ");
  const keywords = (m.keywords || []).filter(Boolean);
  const body = [
    m.byline && `<dc:creator><rdf:Seq><rdf:li>${xml(m.byline)}</rdf:li></rdf:Seq></dc:creator>`,
    m.copyright && `<dc:rights>${alt(m.copyright)}</dc:rights>`,
    m.caption && `<dc:description>${alt(m.caption)}</dc:description>`,
    m.headline && `<dc:title>${alt(m.headline)}</dc:title>`,
    keywords.length && `<dc:subject><rdf:Bag>${keywords.map((k) => `<rdf:li>${xml(k)}</rdf:li>`).join("")}</rdf:Bag></dc:subject>`,
    m.usageTerms && `<xmpRights:UsageTerms>${alt(m.usageTerms)}</xmpRights:UsageTerms>`,
    m.aiReservation && `<plus:OtherConstraints>${alt("No text and data mining, no AI/ML training (EU Directive 2019/790, art. 4(3)).")}</plus:OtherConstraints>`,
    m.licensor && `<plus:Licensor><rdf:Seq><rdf:li rdf:parseType="Resource"><plus:LicensorName>${xml(m.licensor)}</plus:LicensorName>${m.licensorEmail ? `<plus:LicensorEmail>${xml(m.licensorEmail)}</plus:LicensorEmail>` : ""}</rdf:li></rdf:Seq></plus:Licensor>`,
    m.licensee && `<plus:Licensee><rdf:Seq><rdf:li rdf:parseType="Resource"><plus:LicenseeName>${xml(m.licensee)}</plus:LicenseeName>${m.licenseeId ? `<plus:LicenseeID>${xml(m.licenseeId)}</plus:LicenseeID>` : ""}</rdf:li></rdf:Seq></plus:Licensee>`,
  ].filter(Boolean).join("\n   ");
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Holypixx">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
    xmlns:plus="http://ns.useplus.org/ldf/xmp/1.0/"
    ${attrs}>
   ${body}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="r"?>`;
}

const XMP_NS = "http://ns.adobe.com/xap/1.0/\u0000";
const MAX_SEGMENT = 65533;

// Segment APP1 complet (FF E1, longueur, espace de noms, paquet). Un texte
// trop long pour un segment JPEG est raccourci, champ par champ.
export function xmpSegment(meta) {
  const enc = new TextEncoder();
  let m = { ...meta };
  let payload = enc.encode(XMP_NS + xmpPacket(m));
  for (const field of ["usageTerms", "caption", "instructions", "keywords"]) {
    if (payload.length + 2 <= MAX_SEGMENT) break;
    m = { ...m, [field]: field === "keywords" ? [] : String(m[field] || "").slice(0, 2000) };
    payload = enc.encode(XMP_NS + xmpPacket(m));
  }
  if (payload.length + 2 > MAX_SEGMENT) payload = enc.encode(XMP_NS + xmpPacket({ credit: m.credit, copyright: m.copyright, aiReservation: m.aiReservation }));
  const out = new Uint8Array(payload.length + 4);
  out[0] = 0xff;
  out[1] = 0xe1;
  const len = payload.length + 2;
  out[2] = (len >> 8) & 0xff;
  out[3] = len & 0xff;
  out.set(payload, 4);
  return out;
}

export function parseStrip(text) {
  try {
    const list = JSON.parse(text || "[]");
    return Array.isArray(list) ? list.filter((r) => Array.isArray(r) && r.length === 2 && r[0] < r[1]).map(([a, b]) => [Number(a), Number(b)]) : [];
  } catch {
    return [];
  }
}

// Le fichier HD peut-il recevoir notre XMP ? (JPEG dont l'en-tête a été relevé.)
export function canStamp(pp) {
  return /jpe?g/i.test(pp.hd_type || "") && pp.head_end >= 2 && pp.insert_at >= 2 && pp.insert_at <= pp.head_end && pp.hd_size > pp.head_end;
}

// Taille du fichier final, sans le lire.
export function stampedSize(pp, segment) {
  if (!canStamp(pp)) return pp.hd_size;
  const removed = parseStrip(pp.strip).reduce((n, [a, b]) => n + (b - a), 0);
  return pp.hd_size - removed + segment.length;
}

// En-tête réécrit : l'en-tête d'origine (head_end octets) sans ses XMP, avec
// le nôtre inséré à insert_at.
export function stampHead(head, pp, segment) {
  const strip = parseStrip(pp.strip);
  const parts = [];
  let pos = 0;
  const cut = (until) => {
    while (pos < until) {
      const r = strip.find(([a, b]) => pos >= a && pos < b);
      if (r) {
        pos = r[1];
        continue;
      }
      const next = strip.filter(([a]) => a > pos).reduce((m, [a]) => Math.min(m, a), until);
      const end = Math.min(next, until);
      parts.push(head.subarray(pos, end));
      pos = end;
    }
  };
  cut(pp.insert_at);
  parts.push(segment);
  cut(pp.head_end);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// CRC-32 du fichier final : en-tête réécrit, puis la suite d'origine.
export function stampedCrc(newHead, pp) {
  return crc32Combine(crc32(newHead), pp.tail_crc >>> 0, pp.hd_size - pp.head_end);
}
