// Devis et contrats signés en ligne : le photographe prépare un devis
// (prestations, total, acompte, conditions) et l'envoie ; son client le
// lit sur une page dédiée, le signe en tapant son nom (signature
// électronique simple, avec sa trace : date, empreinte du document,
// adresse IP chiffrée, navigateur), puis règle l'acompte par Stripe sur le
// compte du photographe si un acompte est demandé. Le contrat signé part en
// PDF aux deux parties et reste téléchargeable.
//
//   Public (lien secret)  /api/contract/:token            lire (et marquer comme vu)
//                         /api/contract/:token/sign       signer (→ acompte Stripe éventuel)
//                         /api/contract/:token/decline    refuser
//                         /api/contract/:token/pdf        PDF signé
//                         /api/contract/:token/sync       retour de Stripe
//   Photographe           /api/admin/contracts[/…]

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { json, fail } from "./http.js";
import { randomBytes, b64url, hashIp } from "./auth.js";
import { hasFeature, featureRefusal } from "./subscription.js";
import { cleanLine, cleanText, displayName } from "./portfolio.js";
import { createCheckoutSession, retrieveCheckoutSession } from "./stripe.js";
import { paymentFeeCents } from "./fees.js";
import {
  sendContractToClient,
  sendContractSigned,
  sendContractSignedNotice,
  sendContractDepositPaid,
  sendContractDeclined,
} from "./notify.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LINES = 20;
const CHECKOUT_SECONDS = 23 * 3600; // un acompte peut se régler jusqu'au lendemain
export const CONTRACT_STATUSES = ["draft", "sent", "viewed", "signed", "paid", "declined", "cancelled"];

// Conditions proposées par défaut, que chaque studio adapte (onglet Devis &
// contrats). Neutres et courtes : ce n'est pas un conseil juridique.
export const DEFAULT_TERMS = `1. Objet
Le présent contrat porte sur la séance photo décrite ci-dessus et sur la remise des photos retouchées par le photographe.

2. Réservation et acompte
La date de la séance est réservée à la signature du contrat et au paiement de l'acompte éventuel. Le solde est réglé au plus tard le jour de la séance, sauf mention contraire.

3. Report et annulation
Le client peut reporter la séance une fois, sans frais, en prévenant au moins 7 jours à l'avance. En cas d'annulation par le client moins de 7 jours avant la séance, l'acompte reste acquis au photographe. En cas d'annulation par le photographe, l'acompte est intégralement remboursé.

4. Livraison
Les photos sont livrées dans une galerie en ligne protégée, dans le délai annoncé par le photographe. Le choix des photos et leur retouche relèvent du style artistique du photographe.

5. Droits d'auteur et usage des photos
Le photographe reste titulaire des droits d'auteur. Le client peut utiliser les photos livrées pour un usage privé (impression, partage avec ses proches, réseaux sociaux personnels), sans les modifier ni les utiliser à des fins commerciales.

6. Droit à l'image
Le photographe ne publie aucune photo du client (site, réseaux sociaux, portfolio) sans son accord écrit préalable.

7. Données personnelles
Les coordonnées du client servent uniquement à l'organisation de la séance et à la livraison des photos.`;

function now() {
  return Math.floor(Date.now() / 1000);
}

function newId(prefix) {
  return `${prefix}_${b64url(randomBytes(9))}`;
}

function newToken() {
  return b64url(randomBytes(24));
}

function parseLines(raw) {
  try {
    const lines = JSON.parse(raw || "[]");
    return Array.isArray(lines) ? lines : [];
  } catch {
    return [];
  }
}

/* ---------- Règles pures (testées sans réseau) ---------- */

// Lignes de prestation saisies par le photographe : libellé et montant TTC
// en centimes, entiers positifs ; les lignes vides sont ignorées.
export function normalizeLines(input) {
  if (!Array.isArray(input)) return { error: "Ajoutez au moins une prestation" };
  const lines = [];
  for (const raw of input.slice(0, MAX_LINES)) {
    const label = cleanLine(raw?.label, 160);
    const amountCents = Math.round(Number(raw?.amountCents));
    if (!label && !amountCents) continue;
    if (!label) return { error: "Chaque prestation a besoin d'un libellé" };
    if (!Number.isFinite(amountCents) || amountCents < 0 || amountCents > 10000000) return { error: `Montant invalide pour « ${label} »` };
    lines.push({ label, amountCents });
  }
  if (!lines.length) return { error: "Ajoutez au moins une prestation" };
  return { lines, totalCents: lines.reduce((sum, l) => sum + l.amountCents, 0) };
}

// Ce qui est signé : tout ce que le client lit, figé. L'empreinte SHA-256 de
// ce texte est gravée dans le PDF et l'historique : une modification du
// contenu après signature se verrait aussitôt.
export function canonicalContent(c) {
  return JSON.stringify({
    number: c.number,
    studio: c.studio_name,
    client: c.client_name,
    email: c.client_email,
    title: c.title,
    sessionDate: c.session_date,
    lines: parseLines(c.lines),
    totalCents: c.total_cents,
    depositCents: c.deposit_cents,
    terms: c.terms,
  });
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function formatEurosPdf(cents) {
  return ((cents || 0) / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " EUR";
}

function formatDateTime(ts) {
  return new Date(ts * 1000).toLocaleString("fr-BE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Brussels" });
}

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

// Contrat en PDF : en-tête, parties, prestations, conditions, puis la trace
// de signature. Mise en page multi-pages, texte coupé à la largeur.
export async function buildContractPdf(c) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28;
  const H = 841.89;
  const left = 56;
  const right = W - 56;
  const INK = rgb(0.043, 0.043, 0.063);
  const MUTED = rgb(0.384, 0.384, 0.435);
  const ACCENT = rgb(0.231, 0.231, 0.965);
  let page = doc.addPage([W, H]);
  let y = H - 64;

  function ensure(space) {
    if (y - space < 64) {
      page = doc.addPage([W, H]);
      y = H - 64;
    }
  }
  function wrap(text, f, size, width) {
    const out = [];
    for (const paragraph of pdfSafe(text).split("\n")) {
      if (!paragraph.trim()) { out.push(""); continue; }
      let current = "";
      for (const word of paragraph.split(/\s+/)) {
        const candidate = current ? `${current} ${word}` : word;
        if (f.widthOfTextAtSize(candidate, size) <= width) current = candidate;
        else { if (current) out.push(current); current = word; }
      }
      out.push(current);
    }
    return out;
  }
  function write(text, { size = 10, f = font, color = INK, x = left, width = right - left, gap = 4 } = {}) {
    for (const line of wrap(text, f, size, width)) {
      ensure(size + gap);
      if (line) page.drawText(line, { x, y, size, font: f, color });
      y -= size + gap;
    }
  }
  function rule() {
    ensure(12);
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: rgb(0.84, 0.84, 0.89) });
    y -= 14;
  }

  write(c.studio_name, { size: 16, f: bold, color: ACCENT });
  write(`Devis et contrat n° ${c.number}`, { size: 12, f: bold });
  write(`Établi le ${formatDateTime(c.created_at)}`, { size: 9, color: MUTED });
  y -= 10;

  write("Photographe", { size: 9, color: MUTED });
  write(c.seller_name || c.studio_name, { size: 11, f: bold });
  if (c.seller_address) write(c.seller_address, { size: 10 });
  if (c.seller_vat) write(`TVA : ${c.seller_vat}`, { size: 10 });
  if (c.studio_email) write(c.studio_email, { size: 10 });
  y -= 8;
  write("Client", { size: 9, color: MUTED });
  write(c.client_name, { size: 11, f: bold });
  write(c.client_email, { size: 10 });
  y -= 12;

  write(c.title, { size: 13, f: bold });
  if (c.session_date) write(`Date prévue : ${c.session_date}`, { size: 10, color: MUTED });
  y -= 6;
  rule();
  for (const line of parseLines(c.lines)) {
    const amount = formatEurosPdf(line.amountCents);
    const amountWidth = font.widthOfTextAtSize(amount, 10);
    const lines = wrap(line.label, font, 10, right - left - amountWidth - 20);
    ensure(14 * lines.length);
    page.drawText(amount, { x: right - amountWidth, y, size: 10, font, color: INK });
    for (const l of lines) {
      page.drawText(l, { x: left, y, size: 10, font, color: INK });
      y -= 14;
    }
  }
  rule();
  const total = formatEurosPdf(c.total_cents);
  ensure(18);
  page.drawText("Total TTC", { x: left, y, size: 11, font: bold, color: INK });
  page.drawText(total, { x: right - bold.widthOfTextAtSize(total, 11), y, size: 11, font: bold, color: INK });
  y -= 16;
  if (c.deposit_cents) {
    const deposit = formatEurosPdf(c.deposit_cents);
    page.drawText("Acompte à la signature", { x: left, y, size: 10, font, color: MUTED });
    page.drawText(deposit, { x: right - font.widthOfTextAtSize(deposit, 10), y, size: 10, font, color: MUTED });
    y -= 14;
  }
  y -= 14;

  write("Conditions", { size: 12, f: bold });
  y -= 2;
  write(c.terms, { size: 9.5, gap: 4.5 });
  y -= 16;

  ensure(120);
  write("Signature", { size: 12, f: bold });
  if (c.signed_at) {
    write(`Signé électroniquement par ${c.signer_name}, le ${formatDateTime(c.signed_at)} (heure de Bruxelles).`, { size: 10 });
    write("Le signataire a déclaré avoir lu et accepté le devis et les conditions ci-dessus.", { size: 9, color: MUTED });
    write(`Empreinte SHA-256 du document signé : ${c.document_hash}`, { size: 8, color: MUTED });
    if (c.signer_ip_hash) write(`Trace de connexion (chiffrée) : ${c.signer_ip_hash.slice(0, 16)}`, { size: 8, color: MUTED });
    if (c.paid_at) write(`Acompte de ${formatEurosPdf(c.deposit_cents)} réglé en ligne le ${formatDateTime(c.paid_at)}.`, { size: 9, color: MUTED });
  } else {
    write("Non signé.", { size: 10, color: MUTED });
  }
  y -= 10;
  write("Document établi et signé via Holypixx (holypixx.com).", { size: 8, color: MUTED });
  return doc.save();
}

/* ---------- Lecture ---------- */

function stripeReady(photographer) {
  return Boolean(photographer?.stripe_account_id && photographer?.stripe_charges_enabled);
}

async function photographerById(env, id) {
  return env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(id).first();
}

function publicOut(c, photographer) {
  return {
    number: c.number,
    status: c.status,
    studioName: c.studio_name,
    studioEmail: c.studio_email,
    clientName: c.client_name,
    clientEmail: c.client_email,
    title: c.title,
    sessionDate: c.session_date,
    lines: parseLines(c.lines),
    totalCents: c.total_cents,
    depositCents: c.deposit_cents,
    terms: c.terms,
    validUntil: c.valid_until,
    expired: Boolean(c.valid_until && c.valid_until < now() && ["sent", "viewed"].includes(c.status)),
    signedAt: c.signed_at,
    signerName: c.signer_name,
    paidAt: c.paid_at,
    // L'acompte se règle en ligne à la signature (paiement du studio actif).
    depositOnline: c.deposit_cents > 0 && stripeReady(photographer),
    // Un acompte reste à régler (signé, pas encore payé) : le client peut y revenir.
    depositDue: c.status === "signed" && c.deposit_cents > 0 && stripeReady(photographer),
  };
}

function adminOut(c, env) {
  return {
    id: c.id,
    // Lien du client : seulement une fois le devis envoyé.
    url: env && c.status !== "draft" ? publicUrl(env, c.token) : "",
    number: c.number,
    status: c.status,
    clientName: c.client_name,
    clientEmail: c.client_email,
    title: c.title,
    sessionDate: c.session_date,
    lines: parseLines(c.lines),
    totalCents: c.total_cents,
    depositCents: c.deposit_cents,
    terms: c.terms,
    validUntil: c.valid_until,
    sentAt: c.sent_at,
    viewedAt: c.viewed_at,
    signedAt: c.signed_at,
    signerName: c.signer_name,
    documentHash: c.document_hash,
    paidAt: c.paid_at,
    declinedAt: c.declined_at,
    declineReason: c.decline_reason,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

function publicUrl(env, token) {
  const site = (env.PUBLIC_SITE_ORIGIN || "https://www.holypixx.com").replace(/\/+$/, "");
  return `${site}/contrat.html?t=${encodeURIComponent(token)}`;
}

async function contractByToken(env, token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return env.DB.prepare("SELECT * FROM contracts WHERE token = ?").bind(token).first();
}

/* ---------- Public : /api/contract/:token[/…] ---------- */

export async function handleContractPublic(request, env, path) {
  const parts = path.split("/").filter(Boolean); // api, contract, token, …
  const contract = await contractByToken(env, decodeURIComponent(parts[2] || ""));
  if (!contract || contract.status === "draft") return fail(404, "Document introuvable");
  const photographer = await photographerById(env, contract.photographer_id);
  if (!photographer) return fail(404, "Document introuvable");
  const action = parts[3] || "";

  if (!action && request.method === "GET") {
    if (contract.status === "sent") {
      await env.DB.prepare("UPDATE contracts SET status = 'viewed', viewed_at = ? WHERE id = ? AND status = 'sent'").bind(now(), contract.id).run();
      contract.status = "viewed";
    }
    return json({ contract: publicOut(contract, photographer) });
  }
  if (action === "pdf" && request.method === "GET") {
    if (!["signed", "paid"].includes(contract.status)) return fail(409, "Le contrat n'est pas encore signé");
    return pdfResponse(env, contract);
  }
  if (action === "sign" && request.method === "POST") return sign(request, env, contract, photographer);
  if (action === "pay" && request.method === "POST") return startDeposit(request, env, contract, photographer);
  if (action === "decline" && request.method === "POST") {
    if (!["sent", "viewed"].includes(contract.status)) return fail(409, "Ce document ne peut plus être refusé");
    const body = await request.json().catch(() => ({}));
    const reason = cleanText(body.reason, 1000);
    await env.DB.prepare("UPDATE contracts SET status = 'declined', declined_at = ?, decline_reason = ? WHERE id = ?").bind(now(), reason, contract.id).run();
    await sendContractDeclined(env, { to: photographer.email, ...mailParams(env, contract), reason });
    return json({ contract: publicOut({ ...contract, status: "declined" }, photographer) });
  }
  if (action === "sync" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const sessionId = String(body.sessionId || "");
    if (contract.status === "signed" && sessionId && sessionId === contract.stripe_session_id) {
      try {
        await markContractPaid(env, await retrieveCheckoutSession(env, sessionId));
      } catch (err) {
        console.error("Contrat : relecture de la session Stripe impossible :", err);
      }
    }
    const fresh = await env.DB.prepare("SELECT * FROM contracts WHERE id = ?").bind(contract.id).first();
    return json({ contract: publicOut(fresh, photographer) });
  }
  return fail(404, "Route inconnue");
}

async function pdfResponse(env, contract) {
  let bytes = null;
  const stored = contract.pdf_key ? await env.TILES.get(contract.pdf_key) : null;
  if (stored) bytes = await stored.arrayBuffer();
  else bytes = await buildContractPdf(contract);
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="contrat-${contract.number}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}

function mailParams(env, c) {
  return {
    studioName: c.studio_name,
    studioEmail: c.studio_email,
    clientName: c.client_name,
    clientEmail: c.client_email,
    number: c.number,
    title: c.title,
    sessionDate: c.session_date,
    totalCents: c.total_cents,
    depositCents: c.deposit_cents,
    validUntil: c.valid_until,
    url: publicUrl(env, c.token),
    adminUrl: env.ADMIN_URL ? `${String(env.ADMIN_URL).replace(/\/$/, "")}/#/contrats` : "",
  };
}

function bytesToBase64(bytes) {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode.apply(null, view.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Génère et range le PDF signé, puis l'envoie aux deux parties.
async function storeAndSendSigned(env, contract, photographer) {
  const pdf = await buildContractPdf(contract);
  const key = `contracts/${contract.id}.pdf`;
  try {
    await env.TILES.put(key, pdf, { httpMetadata: { contentType: "application/pdf" } });
    await env.DB.prepare("UPDATE contracts SET pdf_key = ? WHERE id = ?").bind(key, contract.id).run();
  } catch (err) {
    console.error("Contrat : rangement du PDF impossible :", err);
  }
  const attachment = { filename: `contrat-${contract.number}.pdf`, content: bytesToBase64(pdf) };
  const params = mailParams(env, contract);
  await sendContractSigned(env, { ...params, to: contract.client_email, replyTo: photographer.email, attachment, depositDue: contract.status === "signed" && contract.deposit_cents > 0 });
  await sendContractSignedNotice(env, { ...params, to: photographer.email, replyTo: contract.client_email, attachment, signerName: contract.signer_name });
}

async function sign(request, env, contract, photographer) {
  if (!["sent", "viewed"].includes(contract.status)) return fail(409, contract.status === "signed" || contract.status === "paid" ? "Ce contrat est déjà signé" : "Ce document n'est plus à signer");
  if (contract.valid_until && contract.valid_until < now()) return fail(409, "Ce devis a expiré : demandez-en un nouveau au photographe.");
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return fail(400, "Requête invalide");
  const signerName = cleanLine(body.signerName, 120);
  if (signerName.length < 3) return fail(400, "Tapez votre nom complet pour signer");
  if (body.accept !== true) return fail(400, "Cochez la case d'acceptation pour signer");

  const ts = now();
  const hash = await sha256Hex(canonicalContent(contract));
  const ipHash = await hashIp(request.headers.get("CF-Connecting-IP") || "", env.TOKEN_SECRET);
  const agent = cleanLine(request.headers.get("User-Agent"), 300);
  const result = await env.DB.prepare(
    `UPDATE contracts SET status = 'signed', signed_at = ?, signer_name = ?, signer_ip_hash = ?, signer_agent = ?, document_hash = ?
      WHERE id = ? AND status IN ('sent', 'viewed')`
  ).bind(ts, signerName, ipHash, agent, hash, contract.id).run();
  if (!result.meta?.changes) return fail(409, "Ce contrat est déjà signé");
  const signed = await env.DB.prepare("SELECT * FROM contracts WHERE id = ?").bind(contract.id).first();

  // Sans acompte (ou paiement en ligne indisponible) : le contrat est conclu.
  await storeAndSendSigned(env, signed, photographer);
  if (!(signed.deposit_cents > 0 && stripeReady(photographer))) {
    return json({ contract: publicOut(signed, photographer) });
  }
  // La signature est acquise même si le paiement ne peut pas être préparé :
  // le client voit son contrat signé, avec le message, et pourra régler
  // l'acompte plus tard depuis le même lien.
  const payment = await startDeposit(request, env, signed, photographer, body.returnUrl);
  if (payment.status >= 400) {
    const problem = await payment.json().catch(() => ({}));
    return json({ contract: publicOut(signed, photographer), paymentError: problem.error || "Le paiement n'a pas pu être préparé." });
  }
  return payment;
}

// Paiement de l'acompte d'un contrat signé (aussitôt après la signature, ou
// plus tard si le client a fermé la page de paiement).
async function startDeposit(request, env, contract, photographer, returnUrlFromSign) {
  if (contract.status !== "signed" || !(contract.deposit_cents > 0)) return fail(409, "Aucun acompte à régler");
  if (!stripeReady(photographer)) return fail(409, "Le paiement en ligne de ce studio n'est pas disponible pour le moment.");
  let base = returnUrlFromSign;
  if (base === undefined) {
    const body = await request.json().catch(() => ({}));
    base = body.returnUrl;
  }
  base = String(base || publicUrl(env, contract.token));
  if (!/^https?:\/\//.test(base)) return fail(400, "Adresse de retour invalide");
  const url = new URL(base);
  url.searchParams.set("t", contract.token);
  const success = new URL(url);
  success.searchParams.set("paye", "1");
  success.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  const feeCents = paymentFeeCents(env, photographer, contract.deposit_cents);
  let session;
  try {
    session = await createCheckoutSession(env, photographer.stripe_account_id, {
      label: `Acompte — ${contract.title} (contrat ${contract.number})`,
      unitAmountCents: contract.deposit_cents,
      quantity: 1,
      successUrl: success.toString().replace(encodeURIComponent("{CHECKOUT_SESSION_ID}"), "{CHECKOUT_SESSION_ID}"),
      cancelUrl: url.toString(),
      metadata: { kind: "contract", contract_id: contract.id, photographer_id: photographer.id },
      applicationFeeCents: feeCents,
      expiresAt: now() + CHECKOUT_SECONDS,
      customerEmail: contract.client_email,
    });
  } catch (err) {
    if (err && err.stripeNotConfigured) return fail(503, "Le paiement en ligne n'est pas encore disponible.");
    console.error("Contrat : création de la session Stripe impossible :", err);
    return fail(502, "Le paiement n'a pas pu être préparé. Réessayez dans un instant.");
  }
  await env.DB.prepare("UPDATE contracts SET stripe_session_id = ?, deposit_fee_cents = ? WHERE id = ?").bind(session.id, feeCents, contract.id).run();
  const fresh = await env.DB.prepare("SELECT * FROM contracts WHERE id = ?").bind(contract.id).first();
  return json({ contract: publicOut(fresh, photographer), url: session.url });
}

/* ---------- Acompte payé (webhook Stripe ou retour du client) ---------- */

export async function markContractPaid(env, session) {
  if (!session || session.payment_status !== "paid" || session.metadata?.kind !== "contract") return;
  const contract = await env.DB.prepare("SELECT * FROM contracts WHERE id = ? AND stripe_session_id = ?")
    .bind(session.metadata.contract_id || "", session.id)
    .first();
  if (!contract) return;
  const ts = now();
  const result = await env.DB.prepare(
    "UPDATE contracts SET status = 'paid', paid_at = ?, stripe_payment_intent_id = ? WHERE id = ? AND status = 'signed'"
  ).bind(ts, session.payment_intent || "", contract.id).run();
  if (!result.meta?.changes) return;
  const paid = await env.DB.prepare("SELECT * FROM contracts WHERE id = ?").bind(contract.id).first();
  const photographer = await photographerById(env, paid.photographer_id);
  // Le PDF rangé est régénéré : il mentionne désormais l'acompte réglé.
  try {
    await env.TILES.put(`contracts/${paid.id}.pdf`, await buildContractPdf(paid), { httpMetadata: { contentType: "application/pdf" } });
    await env.DB.prepare("UPDATE contracts SET pdf_key = ? WHERE id = ?").bind(`contracts/${paid.id}.pdf`, paid.id).run();
  } catch (err) {
    console.error("Contrat : mise à jour du PDF impossible :", err);
  }
  await sendContractDepositPaid(env, { ...mailParams(env, paid), to: paid.client_email, photographerTo: photographer?.email, replyTo: photographer?.email });
}

/* ---------- Photographe : /api/admin/contracts[/…] ---------- */

async function termsOf(env, photographerId) {
  const row = await env.DB.prepare("SELECT terms FROM contract_settings WHERE photographer_id = ?").bind(photographerId).first();
  return row?.terms || DEFAULT_TERMS;
}

async function nextNumber(env, photographerId) {
  const year = new Date().getFullYear();
  // Le plus grand numéro de l'année + 1 (et non le nombre de devis) : un
  // brouillon supprimé ne fait jamais réattribuer un numéro existant.
  const row = await env.DB.prepare(
    "SELECT MAX(CAST(SUBSTR(number, 6) AS INTEGER)) AS n FROM contracts WHERE photographer_id = ? AND number LIKE ?"
  ).bind(photographerId, `${year}-%`).first();
  return `${year}-${String((row?.n || 0) + 1).padStart(3, "0")}`;
}

function readDraft(body, defaults = {}) {
  const merged = { ...defaults, ...body };
  const clientName = cleanLine(merged.clientName, 120);
  const clientEmail = cleanLine(merged.clientEmail, 200).toLowerCase();
  const title = cleanLine(merged.title, 160);
  if (!clientName) return { error: "Indiquez le nom du client" };
  if (!EMAIL_RE.test(clientEmail)) return { error: "Adresse e-mail du client invalide" };
  if (!title) return { error: "Donnez un titre au devis (ex. Séance famille)" };
  const { lines, totalCents, error } = normalizeLines(merged.lines);
  if (error) return { error };
  const depositCents = Math.round(Number(merged.depositCents) || 0);
  if (depositCents < 0 || depositCents > totalCents) return { error: "L'acompte doit être compris entre 0 et le total" };
  if (depositCents > 0 && depositCents < 100) return { error: "L'acompte en ligne est d'au moins 1 €" };
  const terms = cleanText(merged.terms, 20000);
  if (terms.length < 20) return { error: "Les conditions du contrat sont trop courtes" };
  let validUntil = null;
  if (typeof merged.validUntil === "number") {
    validUntil = merged.validUntil; // date déjà enregistrée, reprise telle quelle
  } else if (merged.validUntil) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(merged.validUntil));
    if (!m) return { error: "Date de validité invalide" };
    validUntil = Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 21, 59, 59) / 1000);
  }
  return {
    draft: {
      clientName, clientEmail, title, lines, totalCents, depositCents, terms, validUntil,
      sessionDate: cleanLine(merged.sessionDate, 120),
    },
  };
}

async function listForAdmin(env, photographer) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM contracts WHERE photographer_id = ? ORDER BY created_at DESC LIMIT 300"
  ).bind(photographer.id).all();
  return {
    enabled: hasFeature(env, photographer, "contracts"),
    stripeReady: stripeReady(photographer),
    terms: await termsOf(env, photographer.id),
    defaultTerms: DEFAULT_TERMS,
    contracts: (results || []).map((c) => adminOut(c, env)),
  };
}

export async function handleContractsAdmin(request, env, photographer, parts) {
  // parts : ce qui suit /api/admin/contracts
  const method = request.method;
  if (!parts.length && method === "GET") return json(await listForAdmin(env, photographer));
  if (parts[0] && parts[1] === "pdf" && parts.length === 2 && method === "GET") {
    const contract = await env.DB.prepare("SELECT * FROM contracts WHERE id = ? AND photographer_id = ?").bind(decodeURIComponent(parts[0]), photographer.id).first();
    if (!contract) return fail(404, "Contrat introuvable");
    return pdfResponse(env, contract);
  }
  if (!hasFeature(env, photographer, "contracts")) return featureRefusal("contracts");
  const body = method === "POST" ? await request.json().catch(() => ({})) : {};
  const ts = now();

  // Conditions par défaut du studio.
  if (parts[0] === "terms" && parts.length === 1 && method === "POST") {
    const terms = cleanText(body.terms, 20000);
    if (terms.length < 20) return fail(400, "Les conditions sont trop courtes");
    await env.DB.prepare(
      `INSERT INTO contract_settings (photographer_id, terms, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(photographer_id) DO UPDATE SET terms = excluded.terms, updated_at = excluded.updated_at`
    ).bind(photographer.id, terms, ts).run();
    return json(await listForAdmin(env, photographer));
  }

  // Nouveau devis (brouillon, ou envoyé tout de suite).
  if (!parts.length && method === "POST") {
    const { draft, error } = readDraft(body, { terms: await termsOf(env, photographer.id) });
    if (error) return fail(400, error);
    const id = newId("ctr");
    const studio = displayName(photographer);
    await env.DB.prepare(
      `INSERT INTO contracts (id, photographer_id, token, number, status, studio_name, studio_email, seller_name, seller_address, seller_vat,
         client_name, client_email, title, session_date, lines, total_cents, deposit_cents, terms, valid_until, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, photographer.id, newToken(), await nextNumber(env, photographer.id), studio, photographer.email,
      photographer.billing_company_name || "", photographer.billing_address || "", photographer.billing_vat_number || "",
      draft.clientName, draft.clientEmail, draft.title, draft.sessionDate, JSON.stringify(draft.lines), draft.totalCents,
      draft.depositCents, draft.terms, draft.validUntil, ts, ts
    ).run();
    if (body.send) return sendContract(env, photographer, id);
    return json({ ...(await listForAdmin(env, photographer)), createdId: id }, { status: 201 });
  }

  const id = decodeURIComponent(parts[0] || "");
  const contract = id ? await env.DB.prepare("SELECT * FROM contracts WHERE id = ? AND photographer_id = ?").bind(id, photographer.id).first() : null;
  if (!contract) return fail(404, "Contrat introuvable");

  // Modifier un devis pas encore signé (un devis déjà envoyé repasse en
  // brouillon : il faudra le renvoyer, le client verra la nouvelle version).
  if (parts.length === 1 && method === "POST") {
    if (!["draft", "sent", "viewed"].includes(contract.status)) return fail(409, "Un contrat signé ou refusé ne se modifie plus");
    const { draft, error } = readDraft(body, adminOut(contract));
    if (error) return fail(400, error);
    await env.DB.prepare(
      `UPDATE contracts SET status = 'draft', client_name = ?, client_email = ?, title = ?, session_date = ?, lines = ?, total_cents = ?,
         deposit_cents = ?, terms = ?, valid_until = ?, updated_at = ? WHERE id = ?`
    ).bind(draft.clientName, draft.clientEmail, draft.title, draft.sessionDate, JSON.stringify(draft.lines), draft.totalCents,
      draft.depositCents, draft.terms, draft.validUntil, ts, id).run();
    if (body.send) return sendContract(env, photographer, id);
    return json(await listForAdmin(env, photographer));
  }
  if (parts[1] === "send" && parts.length === 2 && method === "POST") {
    if (!["draft", "sent", "viewed"].includes(contract.status)) return fail(409, "Ce document ne s'envoie plus");
    return sendContract(env, photographer, id);
  }
  if (parts[1] === "cancel" && parts.length === 2 && method === "POST") {
    if (!["sent", "viewed", "draft"].includes(contract.status)) return fail(409, "Un contrat signé ne s'annule pas ici : contactez votre client.");
    await env.DB.prepare("UPDATE contracts SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(ts, id).run();
    return json(await listForAdmin(env, photographer));
  }
  if (parts.length === 1 && method === "DELETE") {
    if (!["draft", "cancelled", "declined"].includes(contract.status)) return fail(409, "Seuls les brouillons, devis annulés ou refusés se suppriment");
    await env.DB.prepare("DELETE FROM contracts WHERE id = ?").bind(id).run();
    return json(await listForAdmin(env, photographer));
  }
  return fail(404, "Route inconnue");
}

async function sendContract(env, photographer, id) {
  const ts = now();
  await env.DB.prepare("UPDATE contracts SET status = 'sent', sent_at = ?, viewed_at = NULL, updated_at = ? WHERE id = ?").bind(ts, ts, id).run();
  const contract = await env.DB.prepare("SELECT * FROM contracts WHERE id = ?").bind(id).first();
  await sendContractToClient(env, { ...mailParams(env, contract), to: contract.client_email, replyTo: photographer.email });
  return json({ ...(await listForAdmin(env, photographer)), sentId: id, url: publicUrl(env, contract.token) });
}
