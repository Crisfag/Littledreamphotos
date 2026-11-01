// Bons cadeaux : le photographe ouvre la vente sur son mini-site, avec une
// valeur minimum et une durée de validité ; un client offre une séance (une
// de ses formules, et son forfait s'il y en a plusieurs) ou une valeur
// libre, au montant de son choix tant qu'il atteint le minimum, avec « de la
// part de », « pour » et un petit mot. Il paie par Stripe, directement sur le
// compte du photographe (comme l'acompte d'une réservation), et reçoit le
// bon en PDF à imprimer ou à transférer.
//
// Le bon porte un code (8 caractères sans 0/O ni 1/I) et un QR code vers sa
// page privée, sur l'adresse du studio quand il en a une : la personne qui
// le reçoit scanne, ou tape l'adresse imprimée et le code, et découvre ce
// qui lui est offert (séance, durée, forfait, compris, petit mot, validité).
// Le photographe suit ses bons, les marque comme utilisés à la séance, et
// peut en émettre à la main (vendu en studio, offert…).
//
//   Public (mini-site)  /api/giftcard/:handle                  réglages et formules offrables
//                       /api/giftcard/:handle/buy              acheter (→ paiement Stripe)
//                       /api/giftcard/:handle/order/:id        retour de Stripe
//   Public (le bon)     /api/gift/:code[/pdf|/image]           page privée, PDF, image de la séance
//   Photographe         /api/admin/giftcards[/settings|/manual|/:id/redeem|/:id/cancel|/:id/pdf]

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCodeCore from "qrcode/lib/core/qrcode.js";
import { json, fail } from "./http.js";
import { randomBytes, b64url, hashIp } from "./auth.js";
import { hasFeature, featureRefusal } from "./subscription.js";
import { publishedPortfolioByHandle, cleanLine, cleanText, displayName, portfolioUrls } from "./portfolio.js";
import { parseTiers, localToEpoch, serveOfferImage, BOOKING_TIME_ZONE } from "./booking.js";
import { createCheckoutSession, retrieveCheckoutSession } from "./stripe.js";
import { paymentFeeCents } from "./fees.js";
import { sendGiftCardToBuyer, sendGiftCardToRecipient, sendGiftCardSoldNotice } from "./notify.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_AMOUNT_CENTS = 1000;
const MAX_AMOUNT_CENTS = 500000;
const DEFAULT_MIN_CENTS = 5000;
const DEFAULT_VALIDITY_MONTHS = 12;
const CHECKOUT_SECONDS = 30 * 60 + 30;
const PURCHASES_PER_VISITOR_PER_HOUR = 8;
// Codes erronés tolérés par adresse IP, comme pour les fiches parents.
const MAX_FAILED_CODES = 12;
const FAILED_WINDOW_SECONDS = 15 * 60;

function now() {
  return Math.floor(Date.now() / 1000);
}

function newId(prefix) {
  return `${prefix}_${b64url(randomBytes(9))}`;
}

export function newGiftCode() {
  return [...randomBytes(8)].map((b) => CODE_ALPHABET[b % 32]).join("");
}

// Ce que tape la personne : espaces, tirets et minuscules acceptés.
export function normalizeGiftCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
}

export function formatGiftCode(code) {
  return code ? `${code.slice(0, 4)}-${code.slice(4)}` : "";
}

// « 45 », « 45,50 », « 45.5 € » → centimes ; NaN si illisible.
export function parseEuros(value) {
  if (typeof value === "number") return Math.round(value * 100);
  const text = String(value ?? "").replace(/[€\s]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return NaN;
  return Math.round(Number(text) * 100);
}

function formatEuros(cents) {
  return (cents / 100).toLocaleString("fr-BE", { style: "currency", currency: "EUR" });
}

export function formatGiftDate(ts) {
  return new Date(ts * 1000).toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric", timeZone: BOOKING_TIME_ZONE });
}

// Fin de validité : même jour, `months` mois plus tard, à 23 h 59 (heure de
// Bruxelles). Le 31 janvier + 1 mois donne le dernier jour de février.
export function validUntil(fromTs, months) {
  const day = new Date(fromTs * 1000).toLocaleDateString("en-CA", { timeZone: BOOKING_TIME_ZONE }); // AAAA-MM-JJ
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const date = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
  return localToEpoch(date, "23:59");
}

export function durationText(minutes) {
  if (!minutes) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

function stripeReady(photographer) {
  return Boolean(photographer?.stripe_account_id && photographer?.stripe_charges_enabled);
}

async function photographerById(env, id) {
  return env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(id).first();
}

/* ---------- Réglages ---------- */

async function settingsOf(env, photographerId) {
  const row = await env.DB.prepare("SELECT * FROM gift_settings WHERE photographer_id = ?").bind(photographerId).first();
  return {
    enabled: Boolean(row?.enabled),
    minCents: row?.min_cents ?? DEFAULT_MIN_CENTS,
    validityMonths: row?.validity_months ?? DEFAULT_VALIDITY_MONTHS,
    terms: row?.terms || "",
  };
}

async function offersOf(env, photographerId) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM booking_offers WHERE photographer_id = ? AND active = 1 ORDER BY position ASC, created_at ASC"
  ).bind(photographerId).all();
  return (results || []).map((o) => ({
    id: o.id,
    title: o.title,
    description: o.description || "",
    durationMin: o.duration_min,
    priceCents: o.price_cents,
    tiers: parseTiers(o.tiers),
    included: o.included || "",
    imageId: o.image_id || "",
  }));
}

/* ---------- Adresses ---------- */

// Page du bon : sur l'adresse du studio quand il en a une (formule Pro),
// sinon sur le site principal. `typed` est l'adresse à recopier à la main.
export function giftPageUrls(env, photographer, code) {
  const origin = env.STUDIO_DOMAIN && photographer?.subdomain && hasFeature(env, photographer, "subdomain")
    ? `https://${photographer.subdomain}.${env.STUDIO_DOMAIN}`
    : (env.PUBLIC_SITE_ORIGIN || "https://www.holypixx.com").replace(/\/+$/, "");
  const base = `${origin}/bon-cadeau`;
  return { page: `${base}?c=${encodeURIComponent(code)}`, typed: base.replace(/^https?:\/\//, "") };
}

/* ---------- QR code ---------- */

// Modules du QR code (vrai = noir), avec la marge blanche réglementaire
// laissée à l'appelant.
export function qrMatrix(text) {
  const qr = QRCodeCore.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const rows = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) row.push(Boolean(qr.modules.get(r, c)));
    rows.push(row);
  }
  return rows;
}

// Chemin SVG (une unité par module) : la page le dessine sans bibliothèque.
export function qrSvgPath(matrix) {
  let d = "";
  matrix.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x} ${y}h1v1h-1z`; }));
  return d;
}

/* ---------- PDF ---------- */

// Les polices standard du PDF (WinAnsi) ne connaissent ni les émojis ni
// certains signes : on les remplace plutôt que de faire échouer le PDF.
function pdfSafe(text) {
  return String(text || "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[  ]/g, " ")
    .replace(/\t/g, "  ")
    .replace(/[^\n\x20-\x7E -ÿŒœŸ€]/g, "");
}

function wrap(text, font, size, width, maxLines) {
  const lines = [];
  for (const paragraph of pdfSafe(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  const kept = lines.slice(0, maxLines);
  if (lines.length > maxLines) kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, "") + "...";
  return kept;
}

const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const PDF_CREAM = hex("#f7f2ec");
const PDF_ROSE = hex("#b98a7a");
const PDF_INK = hex("#2b2521");
const PDF_MUTED = hex("#7c716a");

// Le bon à imprimer : A5 paysage, une seule page. Fonction pure de ses
// paramètres (vérifiable sans réseau).
export async function buildGiftCardPdf(card) {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`Bon cadeau ${card.studioName}`));
  const page = doc.addPage([595.28, 419.53]);
  const { width: W, height: H } = page.getSize();
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: PDF_CREAM });
  page.drawRectangle({ x: 14, y: 14, width: W - 28, height: H - 28, borderColor: PDF_ROSE, borderWidth: 0.8 });
  page.drawRectangle({ x: 18, y: 18, width: W - 36, height: H - 36, borderColor: PDF_ROSE, borderWidth: 0.3 });

  const left = 44;
  const colWidth = 330;
  let y = H - 62;
  const text = (value, { font = sans, size = 10, color = PDF_INK, x = left } = {}) => {
    page.drawText(pdfSafe(value), { x, y, size, font, color });
  };

  text(String(card.studioName || "").toUpperCase(), { size: 9, color: PDF_ROSE, font: bold });
  y -= 46;
  text("Bon cadeau", { font: italic, size: 42 });
  y -= 34;
  if (card.toName) {
    text(`Pour ${card.toName}`, { font: serif, size: 20 });
    y -= 18;
  }
  if (card.fromName) {
    text(`De la part de ${card.fromName}`, { size: 10.5, color: PDF_MUTED });
    y -= 10;
  }
  if (card.message) {
    y -= 12;
    for (const line of wrap(`« ${card.message} »`, italic, 13, colWidth, 4)) {
      text(line, { font: italic, size: 13 });
      y -= 16;
    }
  }

  y -= 14;
  text(card.offerTitle || "Une séance photo, au choix", { font: bold, size: 12 });
  y -= 16;
  const details = [
    card.durationMin ? `Séance de ${durationText(card.durationMin)}` : "",
    card.tierPhotos ? `${card.tierPhotos} photo${card.tierPhotos > 1 ? "s" : ""}${card.tierLabel ? ` (${card.tierLabel})` : ""}` : card.tierLabel || "",
    `Valeur ${formatEuros(card.amountCents)}`,
  ].filter(Boolean).join("  ·  ");
  text(details, { size: 10 });
  y -= 15;
  text(`Valable jusqu'au ${formatGiftDate(card.validUntil)}`, { size: 10, color: PDF_MUTED });

  // QR code et code, à droite.
  const matrix = qrMatrix(card.pageUrl);
  const qrSize = 132;
  const qrX = W - 44 - qrSize;
  const qrY = H - 66 - qrSize - 40;
  const cell = qrSize / matrix.length;
  page.drawRectangle({ x: qrX - 8, y: qrY - 8, width: qrSize + 16, height: qrSize + 16, color: rgb(1, 1, 1) });
  // Modules noirs regroupés par ligne et légèrement chevauchants : pas de
  // fins liserés blancs entre deux modules à l'affichage.
  matrix.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (!row[c]) continue;
      let end = c;
      while (end + 1 < row.length && row[end + 1]) end++;
      page.drawRectangle({ x: qrX + c * cell, y: qrY + (matrix.length - 1 - r) * cell - 0.2, width: (end - c + 1) * cell, height: cell + 0.4, color: PDF_INK });
      c = end;
    }
  });
  const centre = (value, font, size, at, color = PDF_INK) => {
    const s = pdfSafe(value);
    page.drawText(s, { x: qrX + qrSize / 2 - font.widthOfTextAtSize(s, size) / 2, y: at, size, font, color });
  };
  centre("Code", sans, 8.5, qrY - 26, PDF_MUTED);
  centre(formatGiftCode(card.code), bold, 15, qrY - 43);
  const hint = wrap(`Scannez le QR code, ou rendez-vous sur ${card.typedUrl} et entrez le code.`, sans, 7.5, qrSize + 20, 4);
  hint.forEach((line, i) => centre(line, sans, 7.5, qrY - 60 - i * 10, PDF_MUTED));

  // Pied : conditions et contact du studio.
  let foot = 40;
  const contact = [card.studioEmail, card.studioPhone].filter(Boolean).join("  ·  ");
  if (contact) {
    page.drawText(pdfSafe(`Pour réserver votre séance : ${contact}`), { x: left, y: foot, size: 8.5, font: sans, color: PDF_INK });
    foot += 12;
  }
  for (const line of wrap(card.terms || "", sans, 7.5, W - 88, 2).reverse()) {
    if (!line) continue;
    page.drawText(line, { x: left, y: foot, size: 7.5, font: sans, color: PDF_MUTED });
    foot += 10;
  }
  return doc.save();
}

/* ---------- Lecture d'un bon ---------- */

export function giftStatus(card, at = now()) {
  if (card.status === "paid" && card.valid_until < at) return "expired";
  if (card.status === "paid") return "valid";
  return card.status; // redeemed | cancelled | pending
}

function cardForPdf(env, card, photographer, portfolio) {
  const urls = giftPageUrls(env, photographer, card.code);
  return {
    studioName: displayName(photographer),
    studioEmail: photographer.email || "",
    studioPhone: portfolio?.phone || "",
    code: card.code,
    pageUrl: urls.page,
    typedUrl: urls.typed,
    amountCents: card.amount_cents,
    offerTitle: card.offer_title,
    durationMin: card.duration_min,
    tierLabel: card.tier_label,
    tierPhotos: card.tier_photos,
    fromName: card.from_name,
    toName: card.to_name,
    message: card.message,
    validUntil: card.valid_until,
    terms: card.terms,
  };
}

async function portfolioOf(env, photographerId) {
  return env.DB.prepare("SELECT * FROM portfolios WHERE photographer_id = ?").bind(photographerId).first();
}

// Ce que voit la personne qui a reçu le bon.
async function voucherOut(env, card) {
  const photographer = await photographerById(env, card.photographer_id);
  const portfolio = await portfolioOf(env, card.photographer_id);
  const urls = giftPageUrls(env, photographer, card.code);
  let bookingUrl = "";
  if (portfolio?.published && portfolio.handle) {
    const p = portfolioUrls(env, photographer, portfolio.handle);
    bookingUrl = p.studio || p.site;
  }
  return {
    studioName: displayName(photographer),
    studioEmail: photographer.email || "",
    studioPhone: portfolio?.phone || "",
    siteUrl: bookingUrl,
    code: formatGiftCode(card.code),
    status: giftStatus(card),
    amountCents: card.amount_cents,
    offerTitle: card.offer_title,
    description: card.offer_description,
    durationMin: card.duration_min,
    tierLabel: card.tier_label,
    tierPhotos: card.tier_photos,
    included: card.included,
    hasImage: Boolean(card.image_id),
    fromName: card.from_name,
    toName: card.to_name,
    message: card.message,
    validUntil: card.valid_until,
    redeemedAt: card.redeemed_at,
    terms: card.terms,
    pageUrl: urls.page,
    typedUrl: urls.typed,
    qr: (() => { const m = qrMatrix(urls.page); return { size: m.length, path: qrSvgPath(m) }; })(),
  };
}

async function ipHashOf(request, env) {
  return hashIp(request.headers.get("CF-Connecting-IP") || "", env.TOKEN_SECRET);
}

// GET /api/gift/:code[/pdf|/image] — le code fait office de clé : un code
// inconnu compte comme un essai raté, et trop d'essais bloquent un moment.
export async function handleGiftPublic(request, env, path, { studioId = "" } = {}) {
  if (request.method !== "GET") return fail(405, "Méthode non autorisée");
  const parts = path.split("/").filter(Boolean); // api, gift, code, …
  const code = normalizeGiftCode(decodeURIComponent(parts[2] || ""));
  const ipHash = await ipHashOf(request, env);
  const failures = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM auth_log WHERE event = 'gift_code_failed' AND ip_hash = ? AND ts > ?"
  ).bind(ipHash, now() - FAILED_WINDOW_SECONDS).first();
  if ((failures?.n || 0) >= MAX_FAILED_CODES) return fail(429, "Trop de codes essayés. Réessayez dans un quart d'heure.");

  const card = code.length === 8
    ? await env.DB.prepare("SELECT * FROM gift_cards WHERE code = ? AND status != 'pending'").bind(code).first()
    : null;
  // Sous l'adresse d'un studio, seuls ses propres bons existent.
  if (!card || (studioId && card.photographer_id !== studioId)) {
    await env.DB.prepare("INSERT INTO auth_log (email_hash, event, ip_hash, ts) VALUES ('', 'gift_code_failed', ?, ?)").bind(ipHash, now()).run();
    return fail(404, "Ce code ne correspond à aucun bon cadeau. Vérifiez-le sur votre bon.");
  }
  if (parts.length === 3) return json({ voucher: await voucherOut(env, card) }, { headers: { "cache-control": "private, no-store" } });
  if (parts[3] === "pdf" && parts.length === 4) return pdfResponse(env, card);
  if (parts[3] === "image" && parts.length === 4) {
    if (!card.image_id) return fail(404, "Image introuvable");
    return serveOfferImage(env, card.photographer_id, card.image_id, "private, max-age=3600");
  }
  return fail(404, "Route inconnue");
}

async function pdfResponse(env, card) {
  const photographer = await photographerById(env, card.photographer_id);
  const portfolio = await portfolioOf(env, card.photographer_id);
  const bytes = await buildGiftCardPdf(cardForPdf(env, card, photographer, portfolio));
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="bon-cadeau-${formatGiftCode(card.code)}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}

/* ---------- Achat depuis le mini-site : /api/giftcard/:handle[/…] ---------- */

export async function handleGiftShop(request, env, path) {
  const parts = path.split("/").filter(Boolean); // api, giftcard, handle, …
  const handle = decodeURIComponent(parts[2] || "");
  const row = handle ? await publishedPortfolioByHandle(env, handle) : null;
  if (!row) return fail(404, "Portfolio introuvable");
  const photographer = await photographerById(env, row.photographer_id);
  const settings = await settingsOf(env, row.photographer_id);
  const open = Boolean(photographer && hasFeature(env, photographer, "booking") && settings.enabled && stripeReady(photographer));

  if (parts.length === 3 && request.method === "GET") {
    if (!open) return json({ enabled: false });
    return json({
      enabled: true,
      studioName: displayName(row),
      minCents: settings.minCents,
      validityMonths: settings.validityMonths,
      terms: settings.terms,
      offers: (await offersOf(env, photographer.id)).map(({ imageId, ...o }) => ({ ...o, hasImage: Boolean(imageId) })),
    });
  }
  if (!open) return fail(404, "Les bons cadeaux ne sont pas proposés par ce studio.");
  if (parts[3] === "buy" && parts.length === 4 && request.method === "POST") return buy(request, env, photographer, settings);
  if (parts[3] === "order" && parts[4] && parts.length === 5 && request.method === "GET") {
    const url = new URL(request.url);
    return orderStatus(env, photographer, decodeURIComponent(parts[4]), url.searchParams.get("session_id") || "");
  }
  return fail(404, "Route inconnue");
}

// Champs communs à l'achat en ligne et au bon émis par le photographe.
export async function readGiftFields(env, photographerId, body, { minCents }) {
  const fromName = cleanLine(body.fromName, 80);
  const toName = cleanLine(body.toName, 80);
  const message = cleanText(body.message, 400);
  if (!fromName) return { error: "Indiquez de la part de qui est le bon" };
  if (!toName) return { error: "Indiquez à qui le bon est offert" };
  const amountCents = body.amountCents !== undefined ? Math.round(Number(body.amountCents)) : parseEuros(body.amount);
  if (!Number.isFinite(amountCents) || amountCents <= 0) return { error: "Indiquez la valeur du bon" };
  if (amountCents < minCents) return { error: `La valeur d'un bon cadeau est d'au moins ${formatEuros(minCents)}` };
  if (amountCents > MAX_AMOUNT_CENTS) return { error: `La valeur d'un bon cadeau est de ${formatEuros(MAX_AMOUNT_CENTS)} au plus` };

  // Séance offerte : une formule du photographe, et son forfait s'il en a
  // plusieurs ; sans formule, le bon vaut pour la séance de son choix.
  let offer = null;
  let tier = null;
  if (body.offerId) {
    offer = (await offersOf(env, photographerId)).find((o) => o.id === String(body.offerId));
    if (!offer) return { error: "Cette séance n'est plus proposée" };
    if (offer.tiers.length) {
      const index = Number(body.tier);
      tier = Number.isInteger(index) ? offer.tiers[index] : null;
      if (!tier) return { error: "Choisissez le forfait offert" };
    }
  }
  return {
    fields: {
      fromName, toName, message, amountCents,
      offerId: offer?.id || "",
      offerTitle: offer?.title || "",
      offerDescription: offer?.description || "",
      durationMin: offer?.durationMin || null,
      tierLabel: tier?.label || "",
      tierPhotos: tier?.photos || null,
      included: offer?.included || "",
      imageId: offer?.imageId || "",
    },
  };
}

// Crée la ligne du bon ; le code est unique sur toute la plateforme.
async function insertCard(env, photographerId, f, extra) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newId("gft");
    const code = newGiftCode();
    try {
      await env.DB.prepare(
        `INSERT INTO gift_cards (id, photographer_id, code, status, source, amount_cents, fee_cents, offer_id, offer_title, offer_description,
           duration_min, tier_label, tier_photos, included, image_id, from_name, to_name, message, buyer_email, recipient_email,
           terms, valid_until, paid_at, ip_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id, photographerId, code, extra.status, extra.source, f.amountCents, extra.feeCents || 0, f.offerId, f.offerTitle, f.offerDescription,
        f.durationMin, f.tierLabel, f.tierPhotos, f.included, f.imageId, f.fromName, f.toName, f.message, extra.buyerEmail || "", extra.recipientEmail || "",
        extra.terms || "", extra.validUntil, extra.paidAt || null, extra.ipHash || "", now()
      ).run();
      return { id, code };
    } catch (err) {
      if (!/UNIQUE/i.test(String(err && err.message))) throw err;
    }
  }
  throw new Error("Impossible d'attribuer un code de bon cadeau");
}

function returnUrl(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString().replace(encodeURIComponent("{CHECKOUT_SESSION_ID}"), "{CHECKOUT_SESSION_ID}");
}

async function buy(request, env, photographer, settings) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return fail(400, "Requête invalide");
  if (cleanLine(body.website, 200)) return fail(400, "Requête invalide"); // piège à robots
  const email = cleanLine(body.email, 200).toLowerCase();
  const recipientEmail = cleanLine(body.recipientEmail, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) return fail(400, "Indiquez votre adresse e-mail : le bon vous y sera envoyé");
  if (recipientEmail && !EMAIL_RE.test(recipientEmail)) return fail(400, "Adresse e-mail du bénéficiaire invalide");
  const base = String(body.returnUrl || "");
  if (!/^https?:\/\//.test(base)) return fail(400, "Adresse de retour invalide");
  const { fields, error } = await readGiftFields(env, photographer.id, body, { minCents: Math.max(settings.minCents, MIN_AMOUNT_CENTS) });
  if (error) return fail(400, error);

  const ts = now();
  const ipHash = await ipHashOf(request, env);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM gift_cards WHERE ip_hash = ? AND created_at > ?").bind(ipHash, ts - 3600).first();
  if ((recent?.n || 0) >= PURCHASES_PER_VISITOR_PER_HOUR) return fail(429, "Trop d'achats tentés. Réessayez un peu plus tard.");

  const feeCents = paymentFeeCents(env, photographer, fields.amountCents);
  const { id } = await insertCard(env, photographer.id, fields, {
    status: "pending", source: "online", feeCents, buyerEmail: email, recipientEmail, terms: settings.terms,
    validUntil: validUntil(ts, settings.validityMonths), ipHash,
  });
  let session;
  try {
    session = await createCheckoutSession(env, photographer.stripe_account_id, {
      label: `Bon cadeau — ${fields.offerTitle || "séance photo"} — pour ${fields.toName}`,
      unitAmountCents: fields.amountCents,
      quantity: 1,
      successUrl: returnUrl(base, { bon: id, session_id: "{CHECKOUT_SESSION_ID}" }),
      cancelUrl: returnUrl(base, { bon: id, annule: "1" }) + "#offrir",
      metadata: { kind: "giftcard", gift_id: id, photographer_id: photographer.id },
      applicationFeeCents: feeCents,
      expiresAt: ts + CHECKOUT_SECONDS,
      customerEmail: email,
    });
  } catch (err) {
    await env.DB.prepare("DELETE FROM gift_cards WHERE id = ? AND status = 'pending'").bind(id).run();
    if (err && err.stripeNotConfigured) return fail(503, "Le paiement en ligne n'est pas encore disponible.");
    console.error("Bon cadeau : création de la session Stripe impossible :", err);
    return fail(502, "Le paiement n'a pas pu être préparé. Réessayez dans un instant.");
  }
  await env.DB.prepare("UPDATE gift_cards SET stripe_session_id = ? WHERE id = ?").bind(session.id, id).run();
  return json({ giftId: id, url: session.url }, { status: 201 });
}

// Retour de Stripe : sans attendre le webhook, on relit la session. Le code
// n'est montré qu'avec la session de paiement qui l'a réglé.
async function orderStatus(env, photographer, id, sessionId) {
  let card = await env.DB.prepare("SELECT * FROM gift_cards WHERE id = ? AND photographer_id = ?").bind(id, photographer.id).first();
  if (!card) return fail(404, "Bon cadeau introuvable");
  const own = Boolean(sessionId) && sessionId === card.stripe_session_id;
  if (card.status === "pending" && own) {
    try {
      await markGiftCardPaid(env, await retrieveCheckoutSession(env, sessionId));
      card = await env.DB.prepare("SELECT * FROM gift_cards WHERE id = ?").bind(id).first();
    } catch (err) {
      console.error("Bon cadeau : relecture de la session Stripe impossible :", err);
    }
  }
  if (!own || card.status === "pending") return json({ status: card.status === "pending" ? "pending" : "unknown" });
  const urls = giftPageUrls(env, photographer, card.code);
  return json({
    status: giftStatus(card),
    code: formatGiftCode(card.code),
    toName: card.to_name,
    email: card.buyer_email,
    recipientEmail: card.recipient_email,
    pageUrl: urls.page,
  });
}

/* ---------- Paiement confirmé (webhook Stripe ou retour du client) ---------- */

export async function markGiftCardPaid(env, session) {
  if (!session || session.payment_status !== "paid" || session.metadata?.kind !== "giftcard") return;
  const card = await env.DB.prepare("SELECT * FROM gift_cards WHERE id = ? AND stripe_session_id = ?")
    .bind(session.metadata.gift_id || "", session.id)
    .first();
  if (!card || card.status !== "pending") return;
  const ts = now();
  const settings = await settingsOf(env, card.photographer_id);
  const result = await env.DB.prepare(
    "UPDATE gift_cards SET status = 'paid', paid_at = ?, valid_until = ?, stripe_payment_intent_id = ? WHERE id = ? AND status = 'pending'"
  ).bind(ts, validUntil(ts, settings.validityMonths), session.payment_intent || "", card.id).run();
  if (!result.meta?.changes) return;
  await deliverCard(env, card.id, { notifyPhotographer: true });
}

// Envoie le bon (PDF joint) à l'acheteur, au bénéficiaire s'il a une
// adresse, et prévient le photographe d'une vente en ligne.
async function deliverCard(env, id, { notifyPhotographer = false } = {}) {
  const card = await env.DB.prepare("SELECT * FROM gift_cards WHERE id = ?").bind(id).first();
  const photographer = await photographerById(env, card.photographer_id);
  const portfolio = await portfolioOf(env, card.photographer_id);
  const pdf = cardForPdf(env, card, photographer, portfolio);
  const bytes = await buildGiftCardPdf(pdf);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const attachment = { filename: `bon-cadeau-${formatGiftCode(card.code)}.pdf`, content: btoa(binary) };
  const params = {
    studioName: pdf.studioName,
    studioEmail: pdf.studioEmail,
    studioPhone: pdf.studioPhone,
    code: formatGiftCode(card.code),
    pageUrl: pdf.pageUrl,
    typedUrl: pdf.typedUrl,
    amount: formatEuros(card.amount_cents),
    offerTitle: card.offer_title,
    duration: durationText(card.duration_min),
    tierPhotos: card.tier_photos,
    tierLabel: card.tier_label,
    fromName: card.from_name,
    toName: card.to_name,
    message: card.message,
    validUntil: formatGiftDate(card.valid_until),
    buyerEmail: card.buyer_email,
    adminUrl: env.ADMIN_URL ? `${String(env.ADMIN_URL).replace(/\/$/, "")}/#/bons-cadeaux` : "",
  };
  if (card.buyer_email) await sendGiftCardToBuyer(env, { ...params, to: card.buyer_email, replyTo: photographer.email, attachment });
  if (card.recipient_email) await sendGiftCardToRecipient(env, { ...params, to: card.recipient_email, replyTo: photographer.email, attachment });
  if (notifyPhotographer) await sendGiftCardSoldNotice(env, { ...params, to: photographer.email, replyTo: card.buyer_email });
}

// Achats jamais payés : effacés après deux jours (passe quotidienne).
export async function purgeAbandonedGiftCards(env) {
  const result = await env.DB.prepare("DELETE FROM gift_cards WHERE status = 'pending' AND created_at < ?").bind(now() - 2 * 86400).run();
  return result.meta?.changes || 0;
}

/* ---------- Photographe : /api/admin/giftcards[/…] ---------- */

function cardAdminOut(env, photographer, c) {
  return {
    id: c.id,
    code: formatGiftCode(c.code),
    status: giftStatus(c),
    source: c.source,
    amountCents: c.amount_cents,
    feeCents: c.fee_cents,
    offerTitle: c.offer_title,
    tierLabel: c.tier_label,
    tierPhotos: c.tier_photos,
    durationMin: c.duration_min,
    fromName: c.from_name,
    toName: c.to_name,
    message: c.message,
    buyerEmail: c.buyer_email,
    recipientEmail: c.recipient_email,
    validUntil: c.valid_until,
    paidAt: c.paid_at,
    redeemedAt: c.redeemed_at,
    redeemedNote: c.redeemed_note || "",
    cancelledAt: c.cancelled_at,
    createdAt: c.created_at,
    pageUrl: giftPageUrls(env, photographer, c.code).page,
  };
}

async function giftsForAdmin(env, photographer) {
  const settings = await settingsOf(env, photographer.id);
  const { results } = await env.DB.prepare(
    "SELECT * FROM gift_cards WHERE photographer_id = ? AND status != 'pending' ORDER BY created_at DESC LIMIT 500"
  ).bind(photographer.id).all();
  const cards = (results || []).map((c) => cardAdminOut(env, photographer, c));
  const portfolio = await portfolioOf(env, photographer.id);
  let shopUrl = "";
  if (portfolio?.handle) {
    const p = portfolioUrls(env, photographer, portfolio.handle);
    shopUrl = (p.studio || p.site) + "#offrir";
  }
  const sum = (list) => list.reduce((n, c) => n + c.amountCents, 0);
  return {
    enabled: hasFeature(env, photographer, "booking"),
    stripeReady: stripeReady(photographer),
    portfolio: { handle: portfolio?.handle || "", published: Boolean(portfolio?.published), shopUrl },
    settings,
    offers: (await offersOf(env, photographer.id)).map(({ imageId, ...o }) => o),
    cards,
    totals: {
      sold: cards.filter((c) => c.status !== "cancelled").length,
      soldCents: sum(cards.filter((c) => c.status !== "cancelled")),
      openCount: cards.filter((c) => c.status === "valid").length,
      openCents: sum(cards.filter((c) => c.status === "valid")),
      redeemed: cards.filter((c) => c.status === "redeemed").length,
    },
  };
}

export async function handleGiftAdmin(request, env, photographer, parts) {
  const method = request.method;
  if (!parts.length && method === "GET") return json(await giftsForAdmin(env, photographer));
  const id = parts[0] && !["settings", "manual"].includes(parts[0]) ? decodeURIComponent(parts[0]) : "";
  if (id && parts[1] === "pdf" && parts.length === 2 && method === "GET") {
    const card = await env.DB.prepare("SELECT * FROM gift_cards WHERE id = ? AND photographer_id = ? AND status != 'pending'").bind(id, photographer.id).first();
    if (!card) return fail(404, "Bon cadeau introuvable");
    return pdfResponse(env, card);
  }
  if (!hasFeature(env, photographer, "booking")) return featureRefusal("booking");
  const body = method === "POST" ? await request.json().catch(() => ({})) : {};
  const ts = now();

  if (parts[0] === "settings" && parts.length === 1 && method === "POST") {
    const current = await settingsOf(env, photographer.id);
    const minCents = body.min !== undefined ? parseEuros(body.min) : body.minCents !== undefined ? Math.round(Number(body.minCents)) : current.minCents;
    const months = body.validityMonths !== undefined ? Math.round(Number(body.validityMonths)) : current.validityMonths;
    if (!Number.isFinite(minCents) || minCents < MIN_AMOUNT_CENTS || minCents > MAX_AMOUNT_CENTS) {
      return fail(400, `Valeur minimum entre ${formatEuros(MIN_AMOUNT_CENTS)} et ${formatEuros(MAX_AMOUNT_CENTS)}`);
    }
    if (!(months >= 1 && months <= 36)) return fail(400, "Validité de 1 à 36 mois");
    const enabled = body.enabled === undefined ? current.enabled : Boolean(body.enabled);
    const terms = body.terms === undefined ? current.terms : cleanText(body.terms, 300);
    await env.DB.prepare(
      `INSERT INTO gift_settings (photographer_id, enabled, min_cents, validity_months, terms, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(photographer_id) DO UPDATE SET enabled = excluded.enabled, min_cents = excluded.min_cents,
         validity_months = excluded.validity_months, terms = excluded.terms, updated_at = excluded.updated_at`
    ).bind(photographer.id, enabled ? 1 : 0, minCents, months, terms, ts).run();
    return json(await giftsForAdmin(env, photographer));
  }

  // Bon émis à la main (vendu au studio, offert…) : déjà réglé, sans frais.
  if (parts[0] === "manual" && parts.length === 1 && method === "POST") {
    const settings = await settingsOf(env, photographer.id);
    const email = cleanLine(body.email, 200).toLowerCase();
    if (email && !EMAIL_RE.test(email)) return fail(400, "Adresse e-mail invalide");
    const { fields, error } = await readGiftFields(env, photographer.id, body, { minCents: 100 });
    if (error) return fail(400, error);
    const months = body.validityMonths ? Math.round(Number(body.validityMonths)) : settings.validityMonths;
    if (!(months >= 1 && months <= 36)) return fail(400, "Validité de 1 à 36 mois");
    const { id: cardId } = await insertCard(env, photographer.id, fields, {
      status: "paid", source: "manual", buyerEmail: email, terms: settings.terms, validUntil: validUntil(ts, months), paidAt: ts,
    });
    if (email) await deliverCard(env, cardId);
    return json({ ...(await giftsForAdmin(env, photographer)), createdId: cardId }, { status: 201 });
  }

  if (id && parts.length === 2 && method === "POST") {
    const card = await env.DB.prepare("SELECT * FROM gift_cards WHERE id = ? AND photographer_id = ? AND status != 'pending'").bind(id, photographer.id).first();
    if (!card) return fail(404, "Bon cadeau introuvable");
    // Utilisé à la séance (ou annuler ce marquage, en cas d'erreur).
    if (parts[1] === "redeem") {
      if (body.undo) {
        if (card.status !== "redeemed") return fail(409, "Ce bon n'est pas marqué comme utilisé");
        await env.DB.prepare("UPDATE gift_cards SET status = 'paid', redeemed_at = NULL, redeemed_note = '' WHERE id = ?").bind(id).run();
      } else {
        if (card.status !== "paid") return fail(409, card.status === "redeemed" ? "Ce bon est déjà utilisé" : "Ce bon est annulé");
        await env.DB.prepare("UPDATE gift_cards SET status = 'redeemed', redeemed_at = ?, redeemed_note = ? WHERE id = ?")
          .bind(ts, cleanLine(body.note, 200), id).run();
      }
      return json(await giftsForAdmin(env, photographer));
    }
    // Annulé (remboursé depuis Stripe par le photographe, ou erreur de saisie).
    if (parts[1] === "cancel") {
      if (card.status === "cancelled") return fail(409, "Ce bon est déjà annulé");
      await env.DB.prepare("UPDATE gift_cards SET status = 'cancelled', cancelled_at = ? WHERE id = ?").bind(ts, id).run();
      return json(await giftsForAdmin(env, photographer));
    }
    if (parts[1] === "resend") {
      if (!card.buyer_email && !card.recipient_email) return fail(400, "Aucune adresse e-mail sur ce bon");
      await deliverCard(env, id);
      return json({ ok: true });
    }
  }
  return fail(404, "Route inconnue");
}
