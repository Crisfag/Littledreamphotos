// Factures libres : le photographe facture ce qu'il veut, à qui il veut —
// une séance, un album, une cession de droits —, ligne par ligne, chacune
// à son taux de TVA (21, 12, 6 ou 0 % ; 6 % pour une cession de droits
// d'auteur), avec un échéancier (acompte, puis solde le jour de la séance…).
// Le client reçoit un lien vers sa facture : il la lit, la télécharge en
// PDF et règle chaque échéance en ligne (Stripe, directement sur le compte
// du photographe), ou par virement (IBAN et communication sur la facture).
// Une passe quotidienne relance les échéances : 3 jours avant, le lendemain,
// puis une semaine après ; une seule fois par étape.
//
// Une facture se prépare aussi d'un clic depuis un contrat signé, une
// réservation ou un bon cadeau (lignes, client et paiements déjà reçus
// repris). Émise, elle prend son numéro dans la même série que les
// factures automatiques et ne se modifie plus : elle s'annule par une note
// de crédit.
//
//   Public (lien secret)  /api/invoice/:token[/pdf|/pay|/sync]
//   Photographe           /api/admin/client-invoices[/…]

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { json, fail } from "./http.js";
import { randomBytes, b64url } from "./auth.js";
import { hasFeature, featureRefusal } from "./subscription.js";
import { nextInvoiceNumber, formatEuros } from "./invoices.js";
import { cleanLine, cleanText, displayName } from "./portfolio.js";
import { createCheckoutSession, retrieveCheckoutSession } from "./stripe.js";
import { paymentFeeCents } from "./fees.js";
import { sendClientInvoice, sendClientInvoiceReminder, sendClientInvoicePaidNotice, sendContractDepositReminder } from "./notify.js";

export const VAT_RATES = [21, 12, 6, 0];
export const VAT_LABELS = { 21: "21 %", 12: "12 %", 6: "6 % (cession de droits d'auteur)", 0: "0 %" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LINES = 40;
const MAX_INSTALLMENTS = 12;
const DEFAULT_DUE_DAYS = 14;
const CHECKOUT_SECONDS = 30 * 60 + 30;
const ZONE = "Europe/Brussels";
// Relances d'une échéance : 3 jours avant, le lendemain, une semaine après.
export const REMINDER_STAGES = [
  { stage: 1, offsetDays: -3 },
  { stage: 2, offsetDays: 1 },
  { stage: 3, offsetDays: 8 },
];

function now() {
  return Math.floor(Date.now() / 1000);
}

function newId(prefix) {
  return `${prefix}_${b64url(randomBytes(9))}`;
}

// Jour (AAAA-MM-JJ) à Bruxelles.
export function dayOf(ts) {
  return new Date(ts * 1000).toLocaleDateString("en-CA", { timeZone: ZONE });
}

export function addDays(day, days) {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export function daysBetween(fromDay, toDay) {
  return Math.round((Date.parse(toDay + "T00:00:00Z") - Date.parse(fromDay + "T00:00:00Z")) / 86400000);
}

function validDay(value) {
  if (!DAY_RE.test(String(value || ""))) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function formatDay(day) {
  if (!day) return "";
  return new Date(day + "T12:00:00Z").toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function parseJson(raw, fallback) {
  try {
    const value = JSON.parse(raw || "");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function stripeReady(photographer) {
  return Boolean(photographer?.stripe_account_id && photographer?.stripe_charges_enabled);
}

/* ---------- Lignes, TVA, échéancier (fonctions pures) ---------- */

// Lignes saisies : description, quantité (2 décimales), prix unitaire TTC
// (une remise est une ligne négative), taux de TVA. Sans numéro de TVA (régime
// de la franchise), toutes les lignes sont à 0 %.
export function readLines(value, { hasVat }) {
  if (!Array.isArray(value) || !value.length) return { error: "Ajoutez au moins une ligne" };
  if (value.length > MAX_LINES) return { error: `${MAX_LINES} lignes au maximum` };
  const lines = [];
  for (const raw of value) {
    const description = cleanLine(raw && raw.description, 200);
    const quantity = Math.round(Number(raw && raw.quantity) * 100) / 100;
    const unitCents = Math.round(Number(raw && raw.unitCents));
    const vatRate = hasVat ? Number(raw && raw.vatRate) : 0;
    if (!description) return { error: "Décrivez chaque ligne" };
    if (!(quantity > 0 && quantity <= 9999)) return { error: `Quantité invalide : « ${description} »` };
    if (!Number.isFinite(unitCents) || Math.abs(unitCents) > 10000000) return { error: `Prix invalide : « ${description} »` };
    if (!VAT_RATES.includes(vatRate)) return { error: `Taux de TVA invalide : « ${description} »` };
    lines.push({ description, quantity, unitCents, vatRate });
  }
  return { lines };
}

// Totaux : par taux, le TTC des lignes fait foi (c'est ce que paie le
// client) ; la base et la TVA s'en déduisent, taux par taux.
export function computeTotals(lines) {
  const byRate = new Map();
  for (const l of lines) {
    const gross = Math.round(l.quantity * l.unitCents);
    byRate.set(l.vatRate, (byRate.get(l.vatRate) || 0) + gross);
  }
  const breakdown = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, grossCents]) => {
      const netCents = Math.round(grossCents / (1 + rate / 100));
      return { rate, grossCents, netCents, vatCents: grossCents - netCents };
    });
  const sum = (key) => breakdown.reduce((n, b) => n + b[key], 0);
  return { breakdown, netCents: sum("netCents"), vatCents: sum("vatCents"), totalCents: sum("grossCents") };
}

// Échéancier : montants en centimes et dates ; leur somme fait le total.
// Vide : une seule échéance, à la date d'échéance (14 jours par défaut).
export function readSchedule(value, totalCents, { dueDate, today }) {
  if (!Array.isArray(value) || !value.length) {
    const due = dueDate && validDay(dueDate) ? dueDate : addDays(today, DEFAULT_DUE_DAYS);
    return { schedule: [{ label: "Paiement", dueDate: due, amountCents: totalCents, paidAt: null, method: "", reminded: 0 }] };
  }
  if (value.length > MAX_INSTALLMENTS) return { error: `${MAX_INSTALLMENTS} échéances au maximum` };
  const schedule = [];
  for (const [i, raw] of value.entries()) {
    const amountCents = Math.round(Number(raw && raw.amountCents));
    const due = String(raw && raw.dueDate || "");
    if (!(amountCents > 0)) return { error: `Montant de l'échéance ${i + 1} invalide` };
    if (!validDay(due)) return { error: `Date de l'échéance ${i + 1} invalide` };
    schedule.push({
      label: cleanLine(raw.label, 60) || (i === 0 && value.length > 1 ? "Acompte" : i === value.length - 1 && value.length > 1 ? "Solde" : `Échéance ${i + 1}`),
      dueDate: due,
      amountCents,
      paidAt: raw.paidAt ? Math.round(Number(raw.paidAt)) || null : null,
      method: raw.paidAt ? (raw.method === "online" ? "online" : "manual") : "",
      // Déjà encaissé ailleurs (acompte de réservation ou de contrat) : repris
      // sur la facture, mais compté une seule fois dans les ventes.
      ...(raw.paidAt && raw.carried ? { carried: true } : {}),
      reminded: 0,
    });
  }
  const sum = schedule.reduce((n, s) => n + s.amountCents, 0);
  if (sum !== totalCents) return { error: `Les échéances font ${formatEuros(sum)} pour un total de ${formatEuros(totalCents)}` };
  schedule.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  return { schedule };
}

export function nextUnpaid(schedule) {
  const index = schedule.findIndex((s) => !s.paidAt);
  return index === -1 ? null : { index, ...schedule[index] };
}

export function paidCents(schedule) {
  return schedule.filter((s) => s.paidAt).reduce((n, s) => n + s.amountCents, 0);
}

// Relance due aujourd'hui pour une échéance (étape suivante seulement, et
// jamais une étape « avant l'échéance » déjà dépassée).
export function reminderDue(installment, today) {
  if (installment.paidAt) return null;
  const done = installment.reminded || 0;
  const days = daysBetween(installment.dueDate, today); // > 0 : en retard
  let due = null;
  for (const s of REMINDER_STAGES) {
    if (s.stage <= done) continue;
    if (days >= s.offsetDays) due = s;
  }
  if (!due) return null;
  // Rattrapage : on n'envoie que l'étape la plus récente, et le rappel
  // « avant l'échéance » n'a plus de sens une fois l'échéance passée.
  if (due.stage === 1 && days > 0) return null;
  return due;
}

/* ---------- PDF ---------- */

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

const A4 = [595.28, 841.89];
const INK = rgb(0.169, 0.145, 0.129);
const MUTED = rgb(0.486, 0.443, 0.416);
const ACCENT = rgb(0.725, 0.541, 0.478);
const RULE = rgb(0.85, 0.83, 0.8);

function euros(cents) {
  return pdfSafe(formatEuros(cents));
}

function quantityText(q) {
  return Number.isInteger(q) ? String(q) : q.toLocaleString("fr-BE", { maximumFractionDigits: 2 });
}

// Facture (ou note de crédit) en PDF : fonction pure de ses paramètres.
export async function buildClientInvoicePdf(inv) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const left = 50;
  const right = A4[0] - 50;
  let page = doc.addPage(A4);
  let y = A4[1] - 56;
  const credit = inv.kind === "credit";

  const text = (value, x, { size = 10, b = false, color = INK, align = "left", width = 0 } = {}) => {
    const s = pdfSafe(value);
    const f = b ? bold : font;
    const at = align === "right" ? x - f.widthOfTextAtSize(s, size) : x;
    page.drawText(s, { x: at, y, size, font: f, color, ...(width ? { maxWidth: width } : {}) });
  };
  const rule = () => page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: RULE });
  const wrap = (value, size, width) => {
    const out = [];
    for (const para of pdfSafe(value).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= width) line = next;
        else { if (line) out.push(line); line = word; }
      }
      out.push(line);
    }
    return out;
  };
  const room = (needed) => {
    if (y - needed > 60) return;
    page = doc.addPage(A4);
    y = A4[1] - 56;
  };

  // En-tête : le photographe à gauche, le document à droite.
  text(inv.seller.name || "—", left, { size: 15, b: true });
  text(credit ? "Note de crédit" : "Facture", right, { size: 15, b: true, color: ACCENT, align: "right" });
  y -= 16;
  const sellerLines = [...String(inv.seller.address || "").split("\n").filter(Boolean),
    inv.seller.vat ? `TVA ${inv.seller.vat}` : "", inv.seller.email || ""].filter(Boolean);
  const metaLines = [`N° ${inv.number || "brouillon"}`, `Date : ${formatDay(inv.issuedDay)}`,
    !credit && inv.dueDay ? `Échéance : ${formatDay(inv.dueDay)}` : "",
    credit && inv.creditOfNumber ? `Annule la facture ${inv.creditOfNumber}` : ""].filter(Boolean);
  for (let i = 0; i < Math.max(sellerLines.length, metaLines.length); i++) {
    if (sellerLines[i]) text(sellerLines[i], left, { size: 9.5, color: MUTED });
    if (metaLines[i]) text(metaLines[i], right, { size: 9.5, align: "right" });
    y -= 13;
  }

  y -= 18;
  text("Client", left, { size: 8.5, color: MUTED });
  y -= 14;
  text(inv.client.name || inv.client.email || "—", left, { size: 11, b: true });
  for (const l of [...String(inv.client.address || "").split("\n").filter(Boolean), inv.client.vat ? `TVA ${inv.client.vat}` : ""].filter(Boolean)) {
    y -= 13;
    text(l, left, { size: 9.5 });
  }
  if (inv.title) {
    y -= 26;
    text(inv.title, left, { size: 12, b: true });
  }

  // Lignes.
  y -= 28;
  const col = { qty: right - 215, unit: right - 150, vat: right - 85, total: right };
  text("Description", left, { size: 8.5, color: MUTED });
  text("Qté", col.qty, { size: 8.5, color: MUTED, align: "right" });
  text("Prix TTC", col.unit, { size: 8.5, color: MUTED, align: "right" });
  text("TVA", col.vat, { size: 8.5, color: MUTED, align: "right" });
  text("Total TTC", col.total, { size: 8.5, color: MUTED, align: "right" });
  y -= 7;
  rule();
  for (const l of inv.lines) {
    const desc = wrap(l.description, 9.5, col.qty - left - 40);
    room(16 + desc.length * 12);
    y -= 15;
    text(desc[0], left, { size: 9.5 });
    text(quantityText(l.quantity), col.qty, { size: 9.5, align: "right" });
    text(euros(l.unitCents), col.unit, { size: 9.5, align: "right" });
    text(`${l.vatRate} %`, col.vat, { size: 9.5, align: "right" });
    text(euros(Math.round(l.quantity * l.unitCents)), col.total, { size: 9.5, align: "right" });
    for (const extra of desc.slice(1)) {
      y -= 12;
      text(extra, left, { size: 9.5 });
    }
    y -= 6;
    rule();
  }

  // Récapitulatif TVA et totaux.
  room(40 + inv.breakdown.length * 13);
  y -= 18;
  for (const b of inv.breakdown) {
    text(`Base ${b.rate} % : ${euros(b.netCents)}`, left, { size: 9, color: MUTED });
    text(`TVA ${b.rate} % : ${euros(b.vatCents)}`, left + 170, { size: 9, color: MUTED });
    y -= 13;
  }
  y -= 4;
  text("Total HT", col.vat, { size: 10, align: "right", color: MUTED });
  text(euros(inv.netCents), col.total, { size: 10, align: "right" });
  y -= 14;
  text("TVA", col.vat, { size: 10, align: "right", color: MUTED });
  text(euros(inv.vatCents), col.total, { size: 10, align: "right" });
  y -= 18;
  text(credit ? "Total crédité" : "Total TTC", col.vat, { size: 12, b: true, align: "right" });
  text(euros(inv.totalCents), col.total, { size: 12, b: true, align: "right" });

  // Échéancier.
  if (!credit && inv.schedule.length) {
    room(40 + inv.schedule.length * 14);
    y -= 32;
    text(inv.schedule.length > 1 ? "Échéancier" : "Paiement", left, { size: 10.5, b: true });
    y -= 6;
    for (const s of inv.schedule) {
      y -= 14;
      text(s.label, left, { size: 9.5 });
      text(formatDay(s.dueDate), left + 170, { size: 9.5, color: MUTED });
      text(euros(s.amountCents), left + 360, { size: 9.5, align: "right" });
      text(s.paidAt ? `Réglé le ${formatDay(dayOf(s.paidAt))}` : "À régler", right, { size: 9.5, align: "right", color: s.paidAt ? MUTED : INK });
    }
  }

  // Comment payer, mentions.
  const footer = [];
  if (!credit && inv.payUrl) footer.push(`Paiement en ligne (carte, Bancontact) : ${inv.payUrl}`);
  if (!credit && inv.seller.iban) footer.push(`Virement : ${inv.seller.iban} — communication : facture ${inv.number}`);
  if (inv.breakdown.some((b) => b.rate === 6)) footer.push("Taux réduit de 6 % appliqué à la cession de droits d'auteur.");
  if (!inv.seller.vat) footer.push("Petite entreprise soumise au régime de la franchise de taxe. TVA non applicable, article 56bis du Code de la TVA.");
  if (inv.notes) footer.push(inv.notes);
  if (footer.length) {
    y -= 30;
    for (const para of footer) {
      for (const line of wrap(para, 8.5, right - left)) {
        room(12);
        text(line, left, { size: 8.5, color: MUTED });
        y -= 11;
      }
      y -= 3;
    }
  }
  return doc.save();
}

/* ---------- Lecture ---------- */

function invoiceUrls(env, token) {
  const site = (env.PUBLIC_SITE_ORIGIN || "https://www.holypixx.com").replace(/\/+$/, "");
  return { page: `${site}/facture?t=${encodeURIComponent(token)}` };
}

function statusOf(row, schedule, today) {
  if (row.kind === "credit") return "credit";
  if (row.status !== "issued") return row.status; // draft | paid | credited
  const next = nextUnpaid(schedule);
  if (next && next.dueDate < today) return "overdue";
  return paidCents(schedule) ? "partial" : "issued";
}

export function invoiceOut(env, row, today = dayOf(now())) {
  const lines = parseJson(row.lines, []);
  const schedule = parseJson(row.schedule, []);
  const totals = computeTotals(lines.map((l) => (row.kind === "credit" ? { ...l, unitCents: -Math.abs(l.unitCents) } : l)));
  const next = nextUnpaid(schedule);
  return {
    id: row.id,
    kind: row.kind,
    number: row.number,
    status: statusOf(row, schedule, today),
    source: row.source,
    sourceId: row.source_id,
    creditOf: row.credit_of,
    title: row.title,
    client: { name: row.client_name, email: row.client_email, address: row.client_address, vat: row.client_vat },
    lines,
    schedule,
    breakdown: totals.breakdown,
    netCents: row.net_cents,
    vatCents: row.vat_cents,
    totalCents: row.total_cents,
    paidCents: paidCents(schedule),
    nextDue: next ? { index: next.index, label: next.label, dueDate: next.dueDate, amountCents: next.amountCents } : null,
    notes: row.notes,
    reminders: Boolean(row.reminders),
    issuedAt: row.issued_at,
    paidAt: row.paid_at,
    viewedAt: row.viewed_at,
    createdAt: row.created_at,
    pageUrl: row.issued_at ? invoiceUrls(env, row.token).page : "",
  };
}

async function pdfData(env, row) {
  const out = invoiceOut(env, row);
  let creditOfNumber = "";
  if (row.credit_of) {
    const original = await env.DB.prepare("SELECT number FROM client_invoices WHERE id = ?").bind(row.credit_of).first();
    creditOfNumber = original?.number || "";
  }
  const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(row.photographer_id).first();
  return {
    kind: row.kind,
    number: row.number,
    issuedDay: dayOf(row.issued_at || now()),
    dueDay: out.schedule.length ? out.schedule[out.schedule.length - 1].dueDate : "",
    creditOfNumber,
    title: row.title,
    seller: {
      name: row.seller_name || photographer?.billing_company_name || displayName(photographer || {}),
      address: row.seller_address || photographer?.billing_address || "",
      vat: row.issued_at ? row.seller_vat : photographer?.billing_vat_number || "",
      iban: row.issued_at ? row.seller_iban : photographer?.billing_iban || "",
      email: photographer?.email || "",
    },
    client: out.client,
    lines: row.kind === "credit" ? out.lines.map((l) => ({ ...l, unitCents: -Math.abs(l.unitCents) })) : out.lines,
    breakdown: out.breakdown,
    netCents: row.net_cents,
    vatCents: row.vat_cents,
    totalCents: row.total_cents,
    schedule: out.schedule,
    notes: row.notes,
    payUrl: row.kind === "invoice" && row.issued_at && stripeReady(photographer) ? out.pageUrl : "",
  };
}

async function pdfResponse(env, row) {
  const bytes = await buildClientInvoicePdf(await pdfData(env, row));
  const name = `${row.kind === "credit" ? "note-de-credit" : "facture"}-${row.number || "brouillon"}.pdf`;
  return new Response(bytes, {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" },
  });
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function mailParams(env, row, photographer) {
  const out = invoiceOut(env, row);
  const bytes = await buildClientInvoicePdf(await pdfData(env, row));
  return {
    studioName: displayName(photographer),
    studioEmail: photographer.email,
    clientName: row.client_name,
    number: row.number,
    title: row.title,
    totalCents: row.total_cents,
    paidCents: out.paidCents,
    nextDue: out.nextDue,
    schedule: out.schedule,
    pageUrl: out.pageUrl,
    canPayOnline: stripeReady(photographer),
    iban: row.seller_iban,
    attachment: { filename: `facture-${row.number}.pdf`, content: bytesToBase64(bytes) },
  };
}

/* ---------- Public : /api/invoice/:token[/…] ---------- */

export async function handleInvoicePublic(request, env, path) {
  const parts = path.split("/").filter(Boolean); // api, invoice, token, …
  const token = decodeURIComponent(parts[2] || "");
  const row = token.length >= 20
    ? await env.DB.prepare("SELECT * FROM client_invoices WHERE token = ? AND issued_at IS NOT NULL").bind(token).first()
    : null;
  if (!row) return fail(404, "Facture introuvable");
  const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(row.photographer_id).first();

  if (parts.length === 3 && request.method === "GET") {
    if (!row.viewed_at) await env.DB.prepare("UPDATE client_invoices SET viewed_at = ? WHERE id = ?").bind(now(), row.id).run();
    const out = invoiceOut(env, row);
    return json({
      invoice: {
        ...out,
        pageUrl: undefined,
        sourceId: undefined,
        reminders: undefined,
        seller: { name: row.seller_name, address: row.seller_address, vat: row.seller_vat, iban: row.seller_iban, email: photographer?.email || "" },
        canPayOnline: row.kind === "invoice" && stripeReady(photographer),
      },
    }, { headers: { "cache-control": "private, no-store" } });
  }
  if (parts[3] === "pdf" && parts.length === 4 && request.method === "GET") return pdfResponse(env, row);
  if (parts[3] === "pay" && parts.length === 4 && request.method === "POST") return payOnline(request, env, row, photographer);
  if (parts[3] === "sync" && parts.length === 4 && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (body.sessionId && body.sessionId === row.stripe_session_id) {
      try {
        await markInvoicePaid(env, await retrieveCheckoutSession(env, body.sessionId));
      } catch (err) {
        console.error("Facture : relecture de la session Stripe impossible :", err);
      }
    }
    const fresh = await env.DB.prepare("SELECT * FROM client_invoices WHERE id = ?").bind(row.id).first();
    return json({ status: invoiceOut(env, fresh).status, paidCents: paidCents(parseJson(fresh.schedule, [])) });
  }
  return fail(404, "Route inconnue");
}

// Règle l'échéance suivante (ou celle demandée, si elle n'est pas réglée).
async function payOnline(request, env, row, photographer) {
  if (row.kind !== "invoice" || row.status !== "issued") return fail(409, "Cette facture n'est plus à régler");
  if (!stripeReady(photographer)) return fail(409, "Le paiement en ligne n'est pas proposé par ce photographe : réglez par virement.");
  const body = await request.json().catch(() => ({}));
  const schedule = parseJson(row.schedule, []);
  const next = nextUnpaid(schedule);
  if (!next) return fail(409, "Cette facture est déjà réglée");
  const index = Number.isInteger(body.index) && schedule[body.index] && !schedule[body.index].paidAt ? body.index : next.index;
  const installment = schedule[index];
  const base = String(body.returnUrl || "");
  if (!/^https?:\/\//.test(base)) return fail(400, "Adresse de retour invalide");
  const url = new URL(base);
  url.searchParams.set("t", row.token);
  const success = `${url.toString()}&session_id={CHECKOUT_SESSION_ID}`;
  let session;
  try {
    session = await createCheckoutSession(env, photographer.stripe_account_id, {
      label: `Facture ${row.number}${schedule.length > 1 ? ` — ${installment.label}` : ""}`,
      unitAmountCents: installment.amountCents,
      quantity: 1,
      successUrl: success,
      cancelUrl: url.toString(),
      metadata: { kind: "invoice", invoice_id: row.id, installment: String(index), photographer_id: photographer.id },
      applicationFeeCents: paymentFeeCents(env, photographer, installment.amountCents),
      expiresAt: now() + CHECKOUT_SECONDS,
      customerEmail: row.client_email || undefined,
    });
  } catch (err) {
    if (err && err.stripeNotConfigured) return fail(503, "Le paiement en ligne n'est pas encore disponible.");
    console.error("Facture : création de la session Stripe impossible :", err);
    return fail(502, "Le paiement n'a pas pu être préparé. Réessayez dans un instant.");
  }
  await env.DB.prepare("UPDATE client_invoices SET stripe_session_id = ? WHERE id = ?").bind(session.id, row.id).run();
  return json({ url: session.url });
}

// Échéance réglée (en ligne ou à la main) : la facture est soldée quand
// toutes le sont.
async function setInstallmentPaid(env, row, index, { paidAt, method }) {
  const schedule = parseJson(row.schedule, []);
  if (!schedule[index]) return false;
  schedule[index] = { ...schedule[index], paidAt, method: paidAt ? method : "" };
  const done = schedule.every((s) => s.paidAt);
  const status = row.status === "credited" ? "credited" : done ? "paid" : "issued";
  await env.DB.prepare("UPDATE client_invoices SET schedule = ?, status = ?, paid_at = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(schedule), status, done ? paidAt || now() : null, now(), row.id).run();
  return true;
}

export async function markInvoicePaid(env, session) {
  if (!session || session.payment_status !== "paid" || session.metadata?.kind !== "invoice") return;
  const row = await env.DB.prepare("SELECT * FROM client_invoices WHERE id = ?").bind(session.metadata.invoice_id || "").first();
  if (!row) return;
  const index = Number(session.metadata.installment);
  const schedule = parseJson(row.schedule, []);
  if (!schedule[index] || schedule[index].paidAt) return;
  await setInstallmentPaid(env, row, index, { paidAt: now(), method: "online" });
  const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(row.photographer_id).first();
  await sendClientInvoicePaidNotice(env, {
    to: photographer?.email,
    clientName: row.client_name,
    clientEmail: row.client_email,
    number: row.number,
    label: schedule[index].label,
    amountCents: schedule[index].amountCents,
    adminUrl: env.ADMIN_URL ? `${String(env.ADMIN_URL).replace(/\/$/, "")}/#/facturation` : "",
  });
}

/* ---------- Relances (passe quotidienne) ---------- */

export async function runPaymentReminders(env, at = now()) {
  const today = dayOf(at);
  let sent = 0;
  const { results } = await env.DB.prepare(
    "SELECT * FROM client_invoices WHERE kind = 'invoice' AND status = 'issued' AND reminders = 1 AND client_email != '' LIMIT 500"
  ).all();
  for (const row of results || []) {
    const schedule = parseJson(row.schedule, []);
    const next = nextUnpaid(schedule);
    if (!next) continue;
    const due = reminderDue(next, today);
    if (!due) continue;
    // Marqué d'abord : un rappel manqué vaut mieux qu'un rappel en double.
    schedule[next.index] = { ...schedule[next.index], reminded: due.stage };
    const claim = await env.DB.prepare("UPDATE client_invoices SET schedule = ? WHERE id = ? AND schedule = ?")
      .bind(JSON.stringify(schedule), row.id, row.schedule).run();
    if (!claim.meta?.changes) continue;
    const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(row.photographer_id).first();
    if (!photographer) continue;
    const params = await mailParams(env, { ...row, schedule: JSON.stringify(schedule) }, photographer);
    await sendClientInvoiceReminder(env, { ...params, to: row.client_email, replyTo: photographer.email, stage: due.stage, installment: next, daysLate: daysBetween(next.dueDate, today) });
    sent++;
  }

  // Contrats signés dont l'acompte attend : rappel à 3 puis 8 jours.
  const { results: contracts } = await env.DB.prepare(
    "SELECT * FROM contracts WHERE status = 'signed' AND deposit_cents > 0 AND deposit_reminded < 2 AND signed_at < ? LIMIT 200"
  ).bind(at - 3 * 86400).all();
  for (const c of contracts || []) {
    const stage = c.signed_at < at - 8 * 86400 ? 2 : 1;
    if (stage <= c.deposit_reminded) continue;
    const claim = await env.DB.prepare("UPDATE contracts SET deposit_reminded = ? WHERE id = ? AND deposit_reminded < ?").bind(stage, c.id, stage).run();
    if (!claim.meta?.changes) continue;
    const site = (env.PUBLIC_SITE_ORIGIN || "https://www.holypixx.com").replace(/\/+$/, "");
    await sendContractDepositReminder(env, {
      to: c.client_email,
      replyTo: c.studio_email,
      studioName: c.studio_name,
      clientName: c.client_name,
      title: c.title,
      depositCents: c.deposit_cents,
      url: `${site}/contrat?t=${encodeURIComponent(c.token)}`,
      stage,
    });
    sent++;
  }
  return sent;
}

/* ---------- Photographe : /api/admin/client-invoices[/…] ---------- */

function readClient(body) {
  const email = cleanLine(body.clientEmail, 200).toLowerCase();
  if (email && !EMAIL_RE.test(email)) return { error: "Adresse e-mail du client invalide" };
  const name = cleanLine(body.clientName, 160);
  if (!name && !email) return { error: "Indiquez le nom ou l'e-mail du client" };
  return { client: { name, email, address: cleanText(body.clientAddress, 400), vat: cleanLine(body.clientVat, 40) } };
}

async function readDraft(env, photographer, body, today) {
  const { client, error: clientError } = readClient(body);
  if (clientError) return { error: clientError };
  const { lines, error: linesError } = readLines(body.lines, { hasVat: Boolean(photographer.billing_vat_number) });
  if (linesError) return { error: linesError };
  const totals = computeTotals(lines);
  if (totals.totalCents <= 0) return { error: "Le total de la facture doit être positif" };
  const { schedule, error: scheduleError } = readSchedule(body.schedule, totals.totalCents, { dueDate: body.dueDate, today });
  if (scheduleError) return { error: scheduleError };
  return {
    draft: {
      client, lines, schedule, totals,
      title: cleanLine(body.title, 160),
      notes: cleanText(body.notes, 1500),
      reminders: body.reminders === false ? 0 : 1,
    },
  };
}

async function listForAdmin(env, photographer) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM client_invoices WHERE photographer_id = ? ORDER BY created_at DESC LIMIT 500"
  ).bind(photographer.id).all();
  const today = dayOf(now());
  const invoices = (results || []).map((r) => invoiceOut(env, r, today));
  const open = invoices.filter((i) => i.kind === "invoice" && ["issued", "partial", "overdue"].includes(i.status));
  const year = today.slice(0, 4);
  return {
    enabled: hasFeature(env, photographer, "contracts"),
    stripeReady: stripeReady(photographer),
    hasVat: Boolean(photographer.billing_vat_number),
    seller: { name: photographer.billing_company_name, address: photographer.billing_address, vat: photographer.billing_vat_number, iban: photographer.billing_iban || "" },
    vatRates: VAT_RATES.map((r) => ({ rate: r, label: VAT_LABELS[r] })),
    invoices,
    totals: {
      dueCents: open.reduce((n, i) => n + i.totalCents - i.paidCents, 0),
      overdueCents: open.filter((i) => i.status === "overdue").reduce((n, i) => n + (i.nextDue ? i.nextDue.amountCents : 0), 0),
      overdueCount: open.filter((i) => i.status === "overdue").length,
      paidThisYearCents: invoices.filter((i) => i.kind === "invoice").reduce((n, i) => n + i.schedule
        .filter((s) => s.paidAt && dayOf(s.paidAt).startsWith(year)).reduce((m, s) => m + s.amountCents, 0), 0),
    },
  };
}

async function ownInvoice(env, photographer, id) {
  return env.DB.prepare("SELECT * FROM client_invoices WHERE id = ? AND photographer_id = ?").bind(id, photographer.id).first();
}

async function insertDraft(env, photographer, d, { source = "manual", sourceId = "" } = {}) {
  const id = newId("cin");
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO client_invoices (id, photographer_id, token, kind, status, source, source_id, client_name, client_email, client_address, client_vat,
       title, lines, schedule, net_cents, vat_cents, total_cents, notes, reminders, created_at, updated_at)
     VALUES (?, ?, ?, 'invoice', 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, photographer.id, b64url(randomBytes(24)), source, sourceId, d.client.name, d.client.email, d.client.address, d.client.vat,
    d.title, JSON.stringify(d.lines), JSON.stringify(d.schedule), d.totals.netCents, d.totals.vatCents, d.totals.totalCents, d.notes, d.reminders, ts, ts).run();
  return id;
}

// Émission : numéro dans la série du photographe, coordonnées figées.
async function issue(env, photographer, row) {
  const number = await nextInvoiceNumber(env, photographer.id);
  const ts = now();
  const schedule = parseJson(row.schedule, []);
  const done = schedule.length && schedule.every((s) => s.paidAt);
  await env.DB.prepare(
    `UPDATE client_invoices SET number = ?, status = ?, issued_at = ?, paid_at = ?, seller_name = ?, seller_address = ?, seller_vat = ?, seller_iban = ?, updated_at = ?
      WHERE id = ? AND status = 'draft'`
  ).bind(number, done ? "paid" : "issued", ts, done ? ts : null, photographer.billing_company_name || displayName(photographer),
    photographer.billing_address || "", photographer.billing_vat_number || "", photographer.billing_iban || "", ts, row.id).run();
  return env.DB.prepare("SELECT * FROM client_invoices WHERE id = ?").bind(row.id).first();
}

async function sendToClient(env, photographer, row) {
  if (!row.client_email) return fail(400, "Ajoutez l'e-mail du client pour lui envoyer la facture");
  const params = await mailParams(env, row, photographer);
  await sendClientInvoice(env, { ...params, to: row.client_email, replyTo: photographer.email, credit: row.kind === "credit" });
  return null;
}

// Brouillon prérempli depuis un contrat, une réservation ou un bon cadeau.
async function draftFrom(env, photographer, kind, id) {
  const today = dayOf(now());
  const hasVat = Boolean(photographer.billing_vat_number);
  const rate = hasVat ? 21 : 0;
  if (kind === "contract") {
    const c = await env.DB.prepare("SELECT * FROM contracts WHERE id = ? AND photographer_id = ?").bind(id, photographer.id).first();
    if (!c) return { error: "Contrat introuvable" };
    if (!["signed", "paid"].includes(c.status)) return { error: "Le contrat doit être signé" };
    const lines = parseJson(c.lines, []).map((l) => ({ description: l.label, quantity: 1, unitCents: l.amountCents, vatRate: rate }));
    const total = lines.reduce((n, l) => n + l.unitCents, 0);
    const sessionDay = c.session_day && validDay(c.session_day) ? c.session_day : addDays(today, DEFAULT_DUE_DAYS);
    const schedule = c.deposit_cents > 0 && c.deposit_cents < total
      ? [
        { label: "Acompte", dueDate: dayOf(c.signed_at || now()), amountCents: c.deposit_cents, paidAt: c.paid_at || null, method: c.paid_at ? "online" : "", carried: Boolean(c.paid_at) },
        { label: "Solde", dueDate: sessionDay < today ? today : sessionDay, amountCents: total - c.deposit_cents },
      ]
      : [{ label: "Paiement", dueDate: sessionDay < today ? today : sessionDay, amountCents: total }];
    return { body: { clientName: c.client_name, clientEmail: c.client_email, title: `${c.title} — contrat ${c.number}`, lines, schedule } };
  }
  if (kind === "booking") {
    const b = await env.DB.prepare("SELECT * FROM bookings WHERE id = ? AND photographer_id = ?").bind(id, photographer.id).first();
    if (!b) return { error: "Réservation introuvable" };
    const price = b.price_cents || b.deposit_cents;
    if (!price) return { error: "Cette séance n'a pas de prix" };
    const desc = `${b.offer_title}${b.photos ? ` (${b.photos} photos)` : ""} — ${new Date(b.starts_at * 1000).toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric", timeZone: ZONE })}`;
    const sessionDay = dayOf(b.starts_at);
    const schedule = b.deposit_cents > 0 && b.paid_at && b.deposit_cents < price
      ? [
        { label: "Acompte", dueDate: dayOf(b.created_at), amountCents: b.deposit_cents, paidAt: b.paid_at, method: "online", carried: true },
        { label: "Solde", dueDate: sessionDay < today ? today : sessionDay, amountCents: price - b.deposit_cents },
      ]
      : [{ label: "Paiement", dueDate: sessionDay < today ? today : sessionDay, amountCents: price, paidAt: b.deposit_cents >= price && b.paid_at ? b.paid_at : null, method: b.paid_at ? "online" : "", carried: b.deposit_cents >= price && Boolean(b.paid_at) }];
    return { body: { clientName: b.client_name, clientEmail: b.client_email, title: b.offer_title, lines: [{ description: desc, quantity: 1, unitCents: price, vatRate: rate }], schedule } };
  }
  if (kind === "gift") {
    const g = await env.DB.prepare("SELECT * FROM gift_cards WHERE id = ? AND photographer_id = ?").bind(id, photographer.id).first();
    if (!g || g.status === "pending") return { error: "Bon cadeau introuvable" };
    return {
      body: {
        clientName: g.from_name, clientEmail: g.buyer_email,
        title: `Bon cadeau ${g.code.slice(0, 4)}-${g.code.slice(4)}`,
        lines: [{ description: `Bon cadeau${g.offer_title ? ` — ${g.offer_title}` : ""}, pour ${g.to_name}`, quantity: 1, unitCents: g.amount_cents, vatRate: rate }],
        schedule: [{ label: "Paiement", dueDate: dayOf(g.paid_at || g.created_at), amountCents: g.amount_cents, paidAt: g.paid_at || now(), method: g.source === "online" ? "online" : "manual" }],
      },
    };
  }
  return { error: "Origine inconnue" };
}

export async function handleClientInvoicesAdmin(request, env, photographer, parts) {
  const method = request.method;
  if (!parts.length && method === "GET") return json(await listForAdmin(env, photographer));
  const id = parts[0] && !["from"].includes(parts[0]) ? decodeURIComponent(parts[0]) : "";
  if (id && parts[1] === "pdf" && parts.length === 2 && method === "GET") {
    const row = await ownInvoice(env, photographer, id);
    if (!row) return fail(404, "Facture introuvable");
    return pdfResponse(env, row);
  }
  if (!hasFeature(env, photographer, "contracts")) return featureRefusal("contracts");
  const body = method === "POST" ? await request.json().catch(() => ({})) : {};
  const today = dayOf(now());

  // Nouveau brouillon (émis et envoyé tout de suite si demandé).
  if (!parts.length && method === "POST") {
    const { draft, error } = await readDraft(env, photographer, body, today);
    if (error) return fail(400, error);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM client_invoices WHERE photographer_id = ?").bind(photographer.id).first();
    if ((count?.n || 0) >= 20000) return fail(409, "Nombre maximum de factures atteint");
    const newIdValue = await insertDraft(env, photographer, draft, { source: ["contract", "booking", "gift"].includes(body.source) ? body.source : "manual", sourceId: cleanLine(body.sourceId, 60) });
    if (body.issue) {
      let row = await issue(env, photographer, await ownInvoice(env, photographer, newIdValue));
      if (body.send && row.client_email) await sendToClient(env, photographer, row);
    }
    return json({ ...(await listForAdmin(env, photographer)), createdId: newIdValue }, { status: 201 });
  }

  // Préremplir depuis un contrat, une réservation ou un bon cadeau.
  if (parts[0] === "from" && parts[1] && parts[2] && parts.length === 3 && method === "GET") {
    const { body: prefill, error } = await draftFrom(env, photographer, parts[1], decodeURIComponent(parts[2]));
    if (error) return fail(404, error);
    return json({ prefill: { ...prefill, source: parts[1], sourceId: decodeURIComponent(parts[2]) } });
  }

  if (!id) return fail(404, "Route inconnue");
  const row = await ownInvoice(env, photographer, id);
  if (!row) return fail(404, "Facture introuvable");

  if (parts.length === 1 && method === "POST") {
    if (row.status !== "draft") return fail(409, "Une facture émise ne se modifie plus : annulez-la par une note de crédit.");
    const { draft, error } = await readDraft(env, photographer, body, today);
    if (error) return fail(400, error);
    await env.DB.prepare(
      `UPDATE client_invoices SET client_name = ?, client_email = ?, client_address = ?, client_vat = ?, title = ?, lines = ?, schedule = ?,
         net_cents = ?, vat_cents = ?, total_cents = ?, notes = ?, reminders = ?, updated_at = ? WHERE id = ?`
    ).bind(draft.client.name, draft.client.email, draft.client.address, draft.client.vat, draft.title, JSON.stringify(draft.lines), JSON.stringify(draft.schedule),
      draft.totals.netCents, draft.totals.vatCents, draft.totals.totalCents, draft.notes, draft.reminders, now(), id).run();
    return json(await listForAdmin(env, photographer));
  }
  if (parts.length === 1 && method === "DELETE") {
    if (row.status !== "draft") return fail(409, "Une facture émise ne se supprime pas : annulez-la par une note de crédit.");
    await env.DB.prepare("DELETE FROM client_invoices WHERE id = ?").bind(id).run();
    return json(await listForAdmin(env, photographer));
  }
  if (parts[1] === "issue" && method === "POST") {
    if (row.status !== "draft") return fail(409, "Cette facture est déjà émise");
    const issued = await issue(env, photographer, row);
    if (body.send && issued.client_email) await sendToClient(env, photographer, issued);
    return json(await listForAdmin(env, photographer));
  }
  if (parts[1] === "send" && method === "POST") {
    if (!row.issued_at) return fail(409, "Émettez d'abord la facture");
    const error = await sendToClient(env, photographer, row);
    if (error) return error;
    return json({ ok: true });
  }
  if (parts[1] === "reminders" && method === "POST") {
    await env.DB.prepare("UPDATE client_invoices SET reminders = ? WHERE id = ?").bind(body.on ? 1 : 0, id).run();
    return json(await listForAdmin(env, photographer));
  }
  // Échéance réglée à la main (virement, espèces) — ou annuler ce marquage.
  if (parts[1] === "paid" && method === "POST") {
    if (row.kind !== "invoice" || !row.issued_at || row.status === "credited") return fail(409, "Cette facture n'est pas à régler");
    const schedule = parseJson(row.schedule, []);
    const index = Number(body.index);
    if (!Number.isInteger(index) || !schedule[index]) return fail(400, "Échéance introuvable");
    if (body.undo ? !schedule[index].paidAt : schedule[index].paidAt) return fail(409, body.undo ? "Cette échéance n'est pas réglée" : "Cette échéance est déjà réglée");
    await setInstallmentPaid(env, row, index, { paidAt: body.undo ? null : now(), method: "manual" });
    return json(await listForAdmin(env, photographer));
  }
  // Note de crédit : annule une facture émise (mêmes lignes, en négatif).
  if (parts[1] === "credit" && method === "POST") {
    if (row.kind !== "invoice" || !row.issued_at || row.status === "credited") return fail(409, "Cette facture ne peut pas être annulée");
    const creditId = newId("cin");
    const ts = now();
    const number = await nextInvoiceNumber(env, photographer.id);
    await env.DB.prepare(
      `INSERT INTO client_invoices (id, photographer_id, token, kind, number, status, credit_of, source, source_id, client_name, client_email, client_address, client_vat,
         title, lines, schedule, net_cents, vat_cents, total_cents, notes, seller_name, seller_address, seller_vat, seller_iban, reminders, issued_at, created_at, updated_at)
       VALUES (?, ?, ?, 'credit', ?, 'issued', ?, 'manual', '', ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).bind(creditId, photographer.id, b64url(randomBytes(24)), number, row.id, row.client_name, row.client_email, row.client_address, row.client_vat,
      row.title, row.lines, -row.net_cents, -row.vat_cents, -row.total_cents, cleanText(body.reason, 500),
      row.seller_name, row.seller_address, row.seller_vat, row.seller_iban, ts, ts, ts).run();
    await env.DB.prepare("UPDATE client_invoices SET status = 'credited', reminders = 0, updated_at = ? WHERE id = ?").bind(ts, id).run();
    if (body.send && row.client_email) await sendToClient(env, photographer, await ownInvoice(env, photographer, creditId));
    return json({ ...(await listForAdmin(env, photographer)), createdId: creditId });
  }
  return fail(404, "Route inconnue");
}
