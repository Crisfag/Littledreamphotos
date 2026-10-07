// Fiches parents du module scolaire : une fiche par enfant, avec son
// portrait en vignette, le nom de l'établissement et du groupe, la date
// limite de commande, le code d'accès et un QR code qui ouvre l'espace
// famille avec ce code déjà rempli.
//
// Deux sorties, pensées pour l'impression :
//   - PDF A4 paysage, 4 fiches par feuille (une coupe en croix au massicot),
//     chaque groupe sur ses propres feuilles, précédées d'une feuille-paquet
//     pour l'enseignant (liste des enfants à cocher à la distribution) ;
//   - images 10×15 (une par enfant), à envoyer telles quelles au labo.
//
// Le texte est dessiné en SVG par sharp (librsvg) : la police DejaVu Sans
// doit être installée sur la machine (voir le Dockerfile).

import sharp from "sharp";
import QRCode from "qrcode";

const FONT = "DejaVu Sans, Liberation Sans, Arial, sans-serif";
const SERIF = "DejaVu Serif, Liberation Serif, Georgia, serif";
const INK = "#2b2521";
const MUTED = "#7c716a";
const ROSE = "#9c6f61";
const SAND = "#efe6db";
const LINE = "#d9cbbd";

export const COUPON_MM = { width: 148.5, height: 105 }; // quart d'A4 paysage
export const LAB_MM = { width: 152, height: 102 }; // tirage 10×15

function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function mmToPx(mm, dpi) {
  return Math.round((mm / 25.4) * dpi);
}

// Raccourcit un texte trop long pour sa ligne (approximation : largeur
// moyenne d'un caractère ≈ 0,55 × la taille de police).
function fit(text, maxMm, sizeMm) {
  const s = String(text || "");
  const max = Math.max(4, Math.floor(maxMm / (sizeMm * 0.55)));
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function formatDeadline(ts) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Brussels" });
}

async function qrSvgPath(text) {
  // Le SVG de la bibliothèque, réduit à ses chemins pour être posé dans le nôtre.
  const svg = await QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 0, color: { dark: "#000000", light: "#ffffff" } });
  const size = Number(/viewBox="0 0 (\d+) /.exec(svg)?.[1] || 0);
  const paths = (svg.match(/<path[^>]*\/>/g) || []).join("");
  return { size, paths };
}

/**
 * Dessine la fiche d'un enfant.
 * @returns {Promise<Buffer>} JPEG
 */
export async function renderCoupon({ widthMm, heightMm, dpi, school, kind, group, child, deadline, studioName, familyUrl, portrait }) {
  const W = widthMm;
  const H = heightMm;
  const left = W * 0.35;
  const px = (mm) => mmToPx(mm, dpi);
  const code = child.codeDisplay || "";
  const url = `${familyUrl}?c=${encodeURIComponent(child.code || "")}`;
  const qr = await qrSvgPath(url);
  const qrSize = Math.min(30, H * 0.29);
  const qrX = W - 7 - qrSize;
  const qrY = H - 9 - qrSize;
  const portraitBox = { x: 7, y: 8, w: left - 14, h: (left - 14) * 4 / 3 };
  if (portraitBox.y + portraitBox.h > H * 0.62) {
    portraitBox.h = H * 0.62 - portraitBox.y;
    portraitBox.w = portraitBox.h * 3 / 4;
    portraitBox.x = (left - portraitBox.w) / 2;
  }
  const rx = left + 6; // début de la colonne de droite
  const rw = W - rx - 7;
  const host = familyUrl.replace(/^https?:\/\//, "");
  const who = child.firstName ? `${child.firstName}` : `n° ${child.number}`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px(W)}" height="${px(H)}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect x="0" y="0" width="${left}" height="${H}" fill="#faf6f1"/>
  <line x1="${left}" y1="6" x2="${left}" y2="${H - 6}" stroke="${LINE}" stroke-width="0.25"/>
  <rect x="${portraitBox.x}" y="${portraitBox.y}" width="${portraitBox.w}" height="${portraitBox.h}" rx="1.5" fill="${SAND}"/>
  ${portrait ? "" : `<text x="${portraitBox.x + portraitBox.w / 2}" y="${portraitBox.y + portraitBox.h / 2}" font-family="${FONT}" font-size="3" fill="${MUTED}" text-anchor="middle">Photo</text>`}
  ${deadline ? `
  <text x="${left / 2}" y="${portraitBox.y + portraitBox.h + 8}" font-family="${FONT}" font-size="2.9" fill="${INK}" text-anchor="middle">Commande avec livraison</text>
  <text x="${left / 2}" y="${portraitBox.y + portraitBox.h + 11.6}" font-family="${FONT}" font-size="2.9" fill="${INK}" text-anchor="middle">à l'établissement jusqu'au</text>
  <rect x="${left / 2 - 15}" y="${portraitBox.y + portraitBox.h + 14}" width="30" height="7.5" rx="3.75" fill="none" stroke="${ROSE}" stroke-width="0.6"/>
  <text x="${left / 2}" y="${portraitBox.y + portraitBox.h + 19.3}" font-family="${FONT}" font-size="4" font-weight="bold" fill="${INK}" text-anchor="middle">${esc(deadline)}</text>` : ""}
  <text x="${left / 2}" y="${H - 9}" font-family="${FONT}" font-size="2.6" fill="${MUTED}" text-anchor="middle">Merci !</text>
  <text x="${left / 2}" y="${H - 5.6}" font-family="${FONT}" font-size="2.6" fill="${MUTED}" text-anchor="middle">${esc(fit(studioName || "Votre photographe", left - 6, 2.6))}</text>

  <text x="${rx}" y="15" font-family="${SERIF}" font-size="6.4" font-weight="bold" fill="${INK}">Vos photos sont prêtes</text>
  <text x="${rx}" y="22" font-family="${FONT}" font-size="3.4" fill="${ROSE}" font-weight="bold">${esc(fit(school.name, rw, 3.4))}</text>
  <text x="${rx}" y="26.8" font-family="${FONT}" font-size="3.2" fill="${INK}">${esc(fit(`${kind.group} ${group.name}${group.leader ? " · " + group.leader : ""}`, rw, 3.2))}</text>

  <circle cx="${rx + 2.4}" cy="35.2" r="2.4" fill="${ROSE}"/>
  <text x="${rx + 2.4}" y="36.3" font-family="${FONT}" font-size="2.8" font-weight="bold" fill="#ffffff" text-anchor="middle">1</text>
  <text x="${rx + 7}" y="34.2" font-family="${FONT}" font-size="2.9" fill="${INK}">Scannez le QR code avec votre téléphone,</text>
  <text x="${rx + 7}" y="38" font-family="${FONT}" font-size="2.9" fill="${INK}">ou allez sur <tspan font-weight="bold">${esc(fit(host, rw - 22, 2.9))}</tspan></text>
  <circle cx="${rx + 2.4}" cy="45.2" r="2.4" fill="${ROSE}"/>
  <text x="${rx + 2.4}" y="46.3" font-family="${FONT}" font-size="2.8" font-weight="bold" fill="#ffffff" text-anchor="middle">2</text>
  <text x="${rx + 7}" y="44.2" font-family="${FONT}" font-size="2.9" fill="${INK}">Entrez votre adresse e-mail</text>
  <text x="${rx + 7}" y="48" font-family="${FONT}" font-size="2.9" fill="${INK}">et le code d'accès ci-dessous</text>

  <text x="${rx}" y="${qrY + 6}" font-family="${FONT}" font-size="2.8" fill="${MUTED}" letter-spacing="0.3">CODE D'ACCÈS</text>
  <rect x="${rx}" y="${qrY + 9}" width="${Math.min(46, qrX - rx - 4)}" height="11" rx="5.5" fill="none" stroke="${ROSE}" stroke-width="0.7"/>
  <text x="${rx + Math.min(46, qrX - rx - 4) / 2}" y="${qrY + 16.6}" font-family="DejaVu Sans Mono, monospace" font-size="5.4" font-weight="bold" fill="${INK}" text-anchor="middle" letter-spacing="0.4">${esc(code)}</text>
  <text x="${rx}" y="${qrY + 25.5}" font-family="${FONT}" font-size="2.3" fill="${MUTED}">Code réservé à la famille.</text>

  <rect x="${qrX - 1.5}" y="${qrY - 1.5}" width="${qrSize + 3}" height="${qrSize + 3}" fill="#ffffff"/>
  <g transform="translate(${qrX} ${qrY}) scale(${qrSize / qr.size})">${qr.paths}</g>
  <text x="${W - 7}" y="${H - 4.4}" font-family="${FONT}" font-size="2.1" fill="${MUTED}" text-anchor="end">${esc(fit(`${group.name} · ${who}`, W - rx - 7, 2.1))}</text>
</svg>`;

  const layers = [];
  if (portrait) {
    const w = px(portraitBox.w);
    const h = px(portraitBox.h);
    const thumb = await sharp(portrait).rotate().resize({ width: w, height: h, fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toBuffer();
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${px(1.5)}" fill="#fff"/></svg>`);
    const rounded = await sharp(thumb).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
    layers.push({ input: rounded, left: px(portraitBox.x), top: px(portraitBox.y) });
  }
  return sharp(Buffer.from(svg)).composite(layers).flatten({ background: "#ffffff" }).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
}

/**
 * Feuille-paquet d'un groupe (A4 paysage) : à poser sur la pile de fiches
 * remise à l'enseignant. Prénoms et numéros seulement, jamais les codes.
 */
export async function renderPacketSheet({ dpi, school, kind, year, group, children, studioName }) {
  const W = 297;
  const H = 210;
  const px = (mm) => mmToPx(mm, dpi);
  const perColumn = 18;
  const columns = Math.max(1, Math.ceil(children.length / perColumn));
  const colWidth = Math.min(80, (W - 40) / columns);
  const rows = children.map((c, i) => {
    const col = Math.floor(i / perColumn);
    const row = i % perColumn;
    const x = 20 + col * colWidth;
    const y = 82 + row * 6.4;
    return `<rect x="${x}" y="${y - 3.6}" width="4" height="4" rx="0.6" fill="none" stroke="${MUTED}" stroke-width="0.35"/>
      <text x="${x + 6.5}" y="${y}" font-family="${FONT}" font-size="3.6" fill="${INK}">n° ${c.number}${c.firstName ? " · " + esc(fit(c.firstName, colWidth - 20, 3.6)) : ""}</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px(W)}" height="${px(H)}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect x="0" y="0" width="${W}" height="10" fill="${ROSE}"/>
  <text x="20" y="34" font-family="${FONT}" font-size="4.2" fill="${ROSE}" font-weight="bold" letter-spacing="0.4">${esc(fit(school.name.toUpperCase(), W - 40, 4.2))} · ${esc(year.label)}</text>
  <text x="20" y="52" font-family="${SERIF}" font-size="14" font-weight="bold" fill="${INK}">${esc(fit(`${kind.group} ${group.name}`, W - 40, 14))}</text>
  <text x="20" y="62" font-family="${FONT}" font-size="4.6" fill="${INK}">${esc(group.leader ? group.leader + " · " : "")}${children.length} fiche${children.length > 1 ? "s" : ""} à remettre aux familles</text>
  <text x="20" y="70" font-family="${FONT}" font-size="3.4" fill="${MUTED}">Feuilles suivantes : 4 fiches par page, à couper en croix. Cochez chaque enfant à la distribution.</text>
  ${rows}
  <text x="${W - 20}" y="${H - 10}" font-family="${FONT}" font-size="3" fill="${MUTED}" text-anchor="end">${esc(studioName || "")}</text>
</svg>`;
  return sharp(Buffer.from(svg)).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
}

/**
 * Assemble jusqu'à 4 fiches sur une feuille A4 paysage, avec repères de coupe.
 * @param {Buffer[]} coupons JPEG rendus en COUPON_MM au même `dpi`
 */
export async function composeA4(coupons, dpi) {
  const W = mmToPx(297, dpi);
  const H = mmToPx(210, dpi);
  const cw = Math.floor(W / 2);
  const ch = Math.floor(H / 2);
  const guides = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <line x1="${cw}" y1="0" x2="${cw}" y2="${H}" stroke="#c8c0b8" stroke-width="${Math.max(1, dpi / 150)}" stroke-dasharray="${dpi / 10} ${dpi / 10}"/>
    <line x1="0" y1="${ch}" x2="${W}" y2="${ch}" stroke="#c8c0b8" stroke-width="${Math.max(1, dpi / 150)}" stroke-dasharray="${dpi / 10} ${dpi / 10}"/>
  </svg>`);
  const layers = [];
  for (let i = 0; i < coupons.length; i++) {
    const tile = await sharp(coupons[i]).resize({ width: cw, height: ch, fit: "fill" }).toBuffer();
    layers.push({ input: tile, left: (i % 2) * cw, top: Math.floor(i / 2) * ch });
  }
  layers.push({ input: guides, left: 0, top: 0 });
  return sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } }).composite(layers).jpeg({ quality: 86 }).toBuffer();
}
