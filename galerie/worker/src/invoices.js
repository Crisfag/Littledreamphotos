// Facture émise automatiquement dès qu'un règlement de supplément est
// confirmé (voir billing.js) — jamais à la main, jamais différée. Le PDF est
// une fonction pure de ses paramètres (pdf-lib, pas de dépendance Node) :
// facile à vérifier sans réseau ni wrangler dev.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { randomBytes, b64url } from "./auth.js";

// Taux belge normal. Les photographes en régime de la franchise (pas de
// numéro de TVA renseigné) n'en facturent aucune — voir `computeVat`.
const VAT_RATE_PERCENT = 21;

function newInvoiceId() {
  return `inv_${b64url(randomBytes(9))}`;
}

export function formatEuros(cents) {
  return ((cents || 0) / 100).toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

// Le prix affiché au client (et réellement encaissé par Stripe) est TTC :
// on retrouve le HT et la TVA par différence, jamais l'inverse — qui
// donnerait un total facturé différent de ce qui a été payé.
export function computeVat(photographer, amountCents) {
  const hasVat = Boolean(photographer.billing_vat_number);
  if (!hasVat) {
    return { ratePercent: 0, vatCents: 0, netCents: amountCents };
  }
  const netCents = Math.round(amountCents / (1 + VAT_RATE_PERCENT / 100));
  return { ratePercent: VAT_RATE_PERCENT, vatCents: amountCents - netCents, netCents };
}

// Numérotation continue et sans trou par photographe, en séries annuelles
// (ex. 2026-0001) — l'incrémentation via une seule requête UPDATE...RETURNING
// évite la course entre deux paiements confirmés au même instant (D1 sérialise
// les écritures sur une même base, donc cette requête est atomique).
export async function nextInvoiceNumber(env, photographerId) {
  const year = new Date().getFullYear();
  await env.DB.prepare(
    `UPDATE photographers SET invoice_counter = 0, invoice_counter_year = ?
     WHERE id = ? AND invoice_counter_year != ?`
  )
    .bind(year, photographerId, year)
    .run();
  const row = await env.DB.prepare(
    `UPDATE photographers SET invoice_counter = invoice_counter + 1
     WHERE id = ? RETURNING invoice_counter`
  )
    .bind(photographerId)
    .first();
  return `${year}-${String(row.invoice_counter).padStart(4, "0")}`;
}

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const INK = rgb(0.169, 0.145, 0.129);
const MUTED = rgb(0.486, 0.443, 0.416);
const ROSE = rgb(0.725, 0.541, 0.478);

// Fonction pure (aucun accès réseau ni D1) : le contenu du PDF ne dépend que
// de ce qu'on lui passe, ce qui la rend directement testable.
export async function buildInvoicePdf(data) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const left = 50;
  const right = A4_WIDTH - 50;
  let y = A4_HEIGHT - 60;

  function text(str, x, opts = {}) {
    page.drawText(String(str), { x, y, size: opts.size || 10, font: opts.bold ? bold : font, color: opts.color || INK });
  }
  function line() {
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: MUTED });
  }

  text("Holypixx", left, { size: 20, bold: true, color: ROSE });
  text(`Facture n° ${data.number}`, right - 170, { size: 12, bold: true });
  y -= 16;
  text(new Date(data.issuedAt * 1000).toLocaleDateString("fr-BE"), right - 170, { size: 10, color: MUTED });
  y -= 40;

  text("Émise par", left, { size: 9, color: MUTED });
  y -= 14;
  text(data.seller.name || "—", left, { size: 11, bold: true });
  y -= 14;
  for (const l of (data.seller.address || "").split("\n").filter(Boolean)) {
    text(l, left, { size: 10 });
    y -= 13;
  }
  if (data.seller.vatNumber) {
    text(`TVA : ${data.seller.vatNumber}`, left, { size: 10 });
    y -= 13;
  }
  y -= 20;

  text("Destinataire", left, { size: 9, color: MUTED });
  y -= 14;
  text(data.clientName || "Client", left, { size: 11, bold: true });
  y -= 30;

  text("Description", left, { size: 9, color: MUTED });
  text("Montant HT", right - 230, { size: 9, color: MUTED });
  text("TVA", right - 130, { size: 9, color: MUTED });
  text("Total TTC", right - 60, { size: 9, color: MUTED });
  y -= 6;
  line();
  y -= 20;

  text(data.description, left, { size: 10 });
  text(formatEuros(data.netCents), right - 230, { size: 10 });
  text(data.vatRate > 0 ? `${data.vatRate}%` : "—", right - 130, { size: 10 });
  text(formatEuros(data.amountCents), right - 60, { size: 10 });
  for (const detail of data.details || []) {
    y -= 13;
    text(detail, left + 10, { size: 9, color: MUTED });
  }
  y -= 30;
  line();
  y -= 24;

  text("Total réglé", right - 170, { size: 12, bold: true });
  text(formatEuros(data.amountCents), right - 60, { size: 12, bold: true });
  y -= 40;

  if (data.vatRate === 0) {
    text("Petite entreprise soumise au régime de la franchise de taxe.", left, { size: 9, color: MUTED });
    y -= 12;
    text("TVA non applicable, article 56bis du Code de la TVA.", left, { size: 9, color: MUTED });
    y -= 20;
  }

  text("Réglé en ligne (carte, Bancontact ou Apple Pay) via Stripe.", left, { size: 9, color: MUTED });

  return doc.save();
}

// Orchestration complète : calcule la TVA, tire le numéro, construit le PDF,
// le range dans R2 (TILES, sous invoices/{id}.pdf — même compartiment que
// les tuiles et arrière-plans, juste un préfixe différent), puis enregistre
// la ligne. `seller_*` fige les coordonnées de facturation du photographe
// telles qu'elles sont AU MOMENT de l'émission : une facture déjà émise ne
// doit jamais changer si le photographe modifie ensuite son profil.
export async function createInvoiceForPayment(env, { payment, gallery, photographer, description, details, clientName }) {
  const { ratePercent, vatCents, netCents } = computeVat(photographer, payment.amount_cents);
  const number = await nextInvoiceNumber(env, photographer.id);
  const issuedAt = Math.floor(Date.now() / 1000);
  const sellerName = photographer.billing_company_name || photographer.studio_name;
  const extraCount = payment.extra_count;

  const pdfBytes = await buildInvoicePdf({
    number,
    issuedAt,
    seller: { name: sellerName, address: photographer.billing_address, vatNumber: photographer.billing_vat_number },
    clientName: clientName || gallery.client_name || "Client",
    description: description || `${extraCount} photo${extraCount > 1 ? "s" : ""} supplémentaire${extraCount > 1 ? "s" : ""} — ${gallery.title}`,
    details: details || [],
    amountCents: payment.amount_cents,
    netCents,
    vatCents,
    vatRate: ratePercent,
  });

  const id = newInvoiceId();
  await env.TILES.put(`invoices/${id}.pdf`, pdfBytes, {
    httpMetadata: { contentType: "application/pdf" },
  });

  await env.DB.prepare(
    `INSERT INTO invoices
       (id, photographer_id, gallery_id, payment_id, number, issued_at, amount_cents,
        vat_rate_percent, vat_amount_cents, net_amount_cents, client_name,
        seller_company_name, seller_address, seller_vat_number, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      photographer.id,
      gallery.id,
      payment.id,
      number,
      issuedAt,
      payment.amount_cents,
      ratePercent,
      vatCents,
      netCents,
      clientName || gallery.client_name || "",
      sellerName,
      photographer.billing_address,
      photographer.billing_vat_number,
      issuedAt
    )
    .run();

  return { id, number, pdfBytes };
}
