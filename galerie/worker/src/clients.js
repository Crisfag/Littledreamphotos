// Fiches clients et relances : une fiche par adresse e-mail, construite à
// partir de ce que Holypixx connaît déjà (galeries, réservations, contrats,
// paiements) et complétée par le photographe (téléphone, notes, dates à
// retenir). Une date à retenir (anniversaire d'un enfant, étapes d'un bébé,
// mariage, séance de saison…) prévient le photographe à l'avance, au délai
// qu'il choisit, avec un message prêt à envoyer pour proposer une séance.
// Les « temps forts du studio » (séances de Noël, fête des mères…) sont des
// dates sans client : le rappel invite à les proposer à tous les clients.
//
//   /api/admin/clients                 liste, dates à venir, clients à recontacter
//   /api/admin/clients/detail?email=   fiche complète
//   /api/admin/clients        (POST)   créer ou compléter une fiche
//   /api/admin/clients/dates  (POST)   ajouter une date à retenir
//   /api/admin/clients/dates/:id       modifier (POST) ou retirer (DELETE)
//   (une date « studio: true » n'appartient à aucun client : temps fort du studio)

import { json, fail } from "./http.js";
import { randomBytes, b64url } from "./auth.js";
import { cleanLine, cleanText, normalizePhone, displayName, portfolioUrls } from "./portfolio.js";
import { hasFeature } from "./subscription.js";
import { sendClientDateReminder, sendStudioSeasonReminder } from "./notify.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const REMINDER_LEAD_DAYS = 21;
// Délais de rappel proposés, et délai par défaut selon le type de date.
export const LEAD_CHOICES = [14, 21, 30, 42, 60];
const DEFAULT_LEAD = { birthday: 30, baby: 30, wedding: 30, season: 42, other: REMINDER_LEAD_DAYS };
// Étapes d'un bébé, en mois ; « y » : chaque anniversaire à partir de 2 ans.
export const BABY_STEPS = [3, 6, 9, 12, 18];
// Séances de saison : nom, et « séance … » (de Noël, pour la fête des mères).
export const SEASONS = {
  noel: ["Noël", "de Noël"],
  valentin: ["Saint-Valentin", "de la Saint-Valentin"],
  paques: ["Pâques", "de Pâques"],
  meres: ["Fête des mères", "pour la fête des mères"],
  peres: ["Fête des pères", "pour la fête des pères"],
  rentree: ["Rentrée", "de rentrée"],
  halloween: ["Halloween", "d'Halloween"],
};
// Sans séance depuis ce délai, un client est proposé à recontacter.
const DORMANT_SECONDS = 330 * 86400;
const DATE_KINDS = ["birthday", "baby", "wedding", "season", "other"];
const TIME_ZONE = "Europe/Brussels";

function now() {
  return Math.floor(Date.now() / 1000);
}

function newId(prefix) {
  return `${prefix}_${b64url(randomBytes(9))}`;
}

function normEmail(value) {
  return String(value || "").trim().toLowerCase();
}

/* ---------- Dates (fonctions pures, testées sans réseau) ---------- */

export function todayIn(timeZone = TIME_ZONE, at = Date.now()) {
  return new Date(at).toLocaleDateString("en-CA", { timeZone });
}

function parseDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return { y, mo, d };
}

// Prochaine occurrence annuelle d'une date (aujourd'hui compris), en tenant
// compte du 29 février les années non bissextiles (fêté le 28).
export function nextOccurrence(dateStr, today) {
  const date = parseDay(dateStr);
  const t = parseDay(today);
  if (!date || !t) return null;
  const at = (year) => {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const day = date.mo === 2 && date.d === 29 && !leap ? 28 : date.d;
    return Date.UTC(year, date.mo - 1, day);
  };
  const todayMs = Date.UTC(t.y, t.mo - 1, t.d);
  let year = t.y;
  if (at(year) < todayMs) year += 1;
  return {
    year,
    date: new Date(at(year)).toISOString().slice(0, 10),
    daysUntil: Math.round((at(year) - todayMs) / 86400000),
    // Âge ou nombre d'années fêtées ce jour-là (null si la date est à venir).
    years: year - date.y > 0 ? year - date.y : null,
  };
}

// Date décalée de n mois (négatif : en arrière), au dernier jour du mois si
// besoin (31 janvier + 1 mois = 28 ou 29 février).
export function addMonths(dateStr, n) {
  const date = parseDay(dateStr);
  if (!date) return null;
  const total = date.y * 12 + (date.mo - 1) + n;
  const y = Math.floor(total / 12);
  const mo = total - y * 12;
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, mo, Math.min(date.d, last))).toISOString().slice(0, 10);
}

export function addDays(dateStr, n) {
  const date = parseDay(dateStr);
  return new Date(Date.UTC(date.y, date.mo - 1, date.d + n)).toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  const a = parseDay(from);
  const b = parseDay(to);
  return Math.round((Date.UTC(b.y, b.mo - 1, b.d) - Date.UTC(a.y, a.mo - 1, a.d)) / 86400000);
}

// Date de naissance estimée d'après l'âge à la séance (0 : nouveau-né, une
// dizaine de jours).
export function birthFromAge(sessionDate, ageMonths) {
  if (!parseDay(sessionDate)) return null;
  return ageMonths > 0 ? addMonths(sessionDate, -ageMonths) : addDays(sessionDate, -10);
}

export function parsePlan(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(",");
  const out = [];
  for (const item of items) {
    const v = String(item).trim();
    if (v === "y" || BABY_STEPS.includes(Number(v))) if (!out.includes(v === "y" ? "y" : String(Number(v)))) out.push(v === "y" ? "y" : String(Number(v)));
  }
  return out;
}

// Étapes d'un bébé à venir (aujourd'hui compris), dans l'ordre.
export function babySteps(birth, plan, today) {
  const steps = parsePlan(plan);
  const out = [];
  for (const m of BABY_STEPS) {
    if (!steps.includes(String(m))) continue;
    const date = addMonths(birth, m);
    if (date && date >= today) out.push({ date, months: m });
  }
  if (steps.includes("y")) {
    for (let y = 2; y <= 18; y++) {
      const date = addMonths(birth, 12 * y);
      if (date && date >= today) out.push({ date, months: 12 * y });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function leadOf(d) {
  const lead = Number(d.lead_days);
  return LEAD_CHOICES.includes(lead) ? lead : DEFAULT_LEAD[d.kind] || REMINDER_LEAD_DAYS;
}

// Prochain événement d'une date à retenir : sa date, les jours restants, la
// clé qui évite de rappeler deux fois le même (année, ou AAAAMMJJ pour les
// étapes d'un bébé), l'âge, le titre et le jour du rappel.
export function nextEvent(d, today) {
  const lead = leadOf(d);
  let ev = null;
  if (d.kind === "baby") {
    const step = babySteps(d.date, d.plan, today)[0];
    if (!step) return null;
    ev = {
      key: Number(step.date.replace(/-/g, "")),
      date: step.date,
      daysUntil: daysBetween(today, step.date),
      months: step.months % 12 === 0 ? null : step.months,
      years: step.months % 12 === 0 ? step.months / 12 : null,
    };
  } else {
    const n = nextOccurrence(d.date, today);
    if (!n) return null;
    ev = { key: n.year, date: n.date, daysUntil: n.daysUntil, months: null, years: d.kind === "season" || d.kind === "other" ? null : n.years };
  }
  ev.title = eventTitle(d.kind, d.label, ev, !d.client_email);
  ev.lead = lead;
  ev.remindOn = addDays(ev.date, -lead);
  return ev;
}

export function seasonName(key) {
  return SEASONS[key] ? SEASONS[key][0] : String(key || "");
}

// « Alexandre aura 9 mois », « Séance de Noël », « Séances de Noël » (studio).
export function eventTitle(kind, label, ev, studio) {
  if (kind === "baby") {
    if (ev.months) return `${label} aura ${ev.months} mois`;
    return occasionLabel("birthday", label, ev.years);
  }
  if (kind === "season") {
    const prep = SEASONS[label] ? SEASONS[label][1] : `: ${label}`;
    return `${studio ? "Séances" : "Séance"} ${prep}`;
  }
  return occasionLabel(kind, label, ev.years);
}

// « Léa aura 1 an », « 10 ans de mariage », « Rendez-vous annuel ».
export function occasionLabel(kind, label, years) {
  const n = years ? `${years} an${years > 1 ? "s" : ""}` : "";
  if (kind === "birthday") return n ? `${label} aura ${n}` : `Anniversaire ${ofName(label)}`;
  if (kind === "wedding") return n ? `${n} de mariage : ${label}` : `Anniversaire de mariage : ${label}`;
  return label;
}

// « de Léa », « d'Alexandre ».
export function ofName(label) {
  return /^[aeiouyàâäéèêëîïôöûü]/i.test(String(label || "")) ? `d'${label}` : `de ${label}`;
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

// Message proposé au photographe pour relancer son client (sujet + corps),
// à envoyer tel quel ou à retoucher.
export function suggestedMessage({ kind, label, years, months, clientName, studioName, bookingUrl, dormant, studio }) {
  const hello = firstName(clientName) ? `Bonjour ${firstName(clientName)},` : "Bonjour,";
  const book = bookingUrl ? `\n\nVous pouvez choisir votre créneau directement ici : ${bookingUrl}` : "\n\nDites-moi simplement quelles dates vous conviendraient.";
  const sign = `\n\nÀ très bientôt,\n${studioName || ""}`.trimEnd();
  if (dormant) {
    return {
      subject: "Une nouvelle séance photo ?",
      body: `${hello}\n\nCela fait un moment depuis notre dernière séance ensemble ! Si l'envie vous prend d'immortaliser ce qui a changé depuis, ce serait un plaisir de vous retrouver.${book}${sign}`,
    };
  }
  if (kind === "baby" && months) {
    const moment = {
      3: "les premiers sourires, la petite tête qui se tient toute seule… c'est le moment idéal pour une séance",
      6: "l'âge des premières positions assises et des grands éclats de rire : un très beau moment pour une séance",
      9: "l'âge où l'on explore tout, à quatre pattes ou déjà debout : un très beau moment pour une nouvelle séance",
      18: "les premiers pas assurés, les premiers mots… une nouvelle séance garderait une jolie trace de cette période",
    }[months] || "une belle occasion pour une nouvelle séance";
    return {
      subject: `${label} aura bientôt ${months} mois : une séance photo ?`,
      body: `${hello}\n\n${label} aura bientôt ${months} mois : ${moment}.${book}${sign}`,
    };
  }
  if (kind === "season") {
    const name = seasonName(label);
    const prep = SEASONS[label] ? SEASONS[label][1] : `: ${label}`;
    if (studio) {
      return {
        subject: `Les séances ${prep} sont ouvertes`,
        body: `Bonjour,\n\nLes séances ${prep} reviennent ! Des photos à offrir ou à garder, dans une ambiance douce et sans stress. Les créneaux partent vite : réservez le vôtre dès maintenant.${book}${sign}`,
      };
    }
    return {
      subject: `${name} approche : une nouvelle séance ?`,
      body: `${hello}\n\nLes séances ${prep} reviennent bientôt, et ce serait un plaisir de vous retrouver cette année encore.${book}${sign}`,
    };
  }
  if (kind === "birthday" || kind === "baby") {
    // « son premier anniversaire », « ses 3 ans », ou simplement « son anniversaire ».
    const age = years === 1 ? "son premier anniversaire" : years ? `ses ${years} ans` : "son anniversaire";
    const occasion = years === 1 ? "le premier anniversaire" : years ? `les ${years} ans` : "l'anniversaire";
    return {
      subject: `Une séance pour ${occasion} ${ofName(label)} ?`,
      body: `${hello}\n\n${label} va bientôt fêter ${age} : c'est le moment idéal pour une nouvelle séance photo, et garder une trace de cette année passée si vite.${book}${sign}`,
    };
  }
  if (kind === "wedding") {
    return {
      subject: years ? `${years} ans de mariage : une séance pour fêter ça ?` : "Une séance pour votre anniversaire de mariage ?",
      body: `${hello}\n\nVotre anniversaire de mariage approche${years ? ` (${years} ans déjà !)` : ""} : pourquoi ne pas le célébrer avec une séance photo ?${book}${sign}`,
    };
  }
  return {
    subject: `${label} : une nouvelle séance photo ?`,
    body: `${hello}\n\nJe pensais à vous à l'approche de cette date (${label}) : ce serait l'occasion d'une nouvelle séance photo.${book}${sign}`,
  };
}

export function mailtoUrl(email, { subject, body }) {
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/* ---------- Agrégation ---------- */

export async function bookingPageUrl(env, photographer) {
  if (!hasFeature(env, photographer, "booking")) return "";
  const portfolio = await env.DB.prepare("SELECT handle, published FROM portfolios WHERE photographer_id = ?").bind(photographer.id).first();
  if (!portfolio?.published) return "";
  const urls = portfolioUrls(env, photographer, portfolio.handle);
  return (urls.studio || urls.site) + "#reserver";
}

// Tout ce que Holypixx sait des clients d'un photographe, regroupé par e-mail.
export async function collect(env, photographerId) {
  const [galleries, bookings, contracts, payments, records, dates, messages, gifts, invoices] = await Promise.all([
    env.DB.prepare(
      "SELECT id, slug, title, client_name, client_email, created_at, expires_at FROM galleries WHERE photographer_id = ? AND kind != 'school' AND client_email != ''"
    ).bind(photographerId).all(),
    env.DB.prepare(
      "SELECT id, client_name, client_email, client_phone, offer_title, starts_at, status, deposit_cents, paid_at, created_at FROM bookings WHERE photographer_id = ? AND status IN ('confirmed', 'cancelled', 'conflict')"
    ).bind(photographerId).all(),
    env.DB.prepare(
      "SELECT id, number, title, client_name, client_email, status, total_cents, deposit_cents, signed_at, paid_at, created_at FROM contracts WHERE photographer_id = ? AND status != 'draft'"
    ).bind(photographerId).all(),
    env.DB.prepare(
      `SELECT p.id, p.kind, p.amount_cents, p.paid_at, g.client_email, g.title, g.slug
         FROM payments p JOIN galleries g ON g.id = p.gallery_id
        WHERE g.photographer_id = ? AND p.status = 'paid' AND g.client_email != ''`
    ).bind(photographerId).all(),
    env.DB.prepare("SELECT * FROM clients WHERE photographer_id = ?").bind(photographerId).all(),
    env.DB.prepare("SELECT * FROM client_dates WHERE photographer_id = ? ORDER BY date ASC").bind(photographerId).all(),
    // Prospects : demandes reçues par le formulaire de contact du portfolio.
    env.DB.prepare("SELECT id, name, email, phone, event_date, message, created_at FROM portfolio_messages WHERE photographer_id = ?").bind(photographerId).all(),
    env.DB.prepare(
      "SELECT id, code, status, source, amount_cents, offer_title, from_name, to_name, buyer_email, recipient_email, paid_at, created_at FROM gift_cards WHERE photographer_id = ? AND status != 'pending'"
    ).bind(photographerId).all(),
    env.DB.prepare(
      "SELECT id, kind, number, status, source, client_name, client_email, title, total_cents, schedule, issued_at, created_at FROM client_invoices WHERE photographer_id = ? AND issued_at IS NOT NULL AND client_email != ''"
    ).bind(photographerId).all(),
  ]);

  const map = new Map();
  const get = (email) => {
    const key = normEmail(email);
    if (!map.has(key)) {
      map.set(key, {
        email: key, name: "", phone: "", notes: "", tags: [], recordId: "", createdAt: null,
        galleries: [], bookings: [], contracts: [], payments: [], dates: [], messages: [], gifts: [], invoices: [],
        paidCents: 0, firstAt: null, lastAt: null, lastSessionAt: null, upcomingSessionAt: null,
      });
    }
    return map.get(key);
  };
  const seen = (c, ts) => {
    if (!ts) return;
    c.firstAt = c.firstAt === null ? ts : Math.min(c.firstAt, ts);
    c.lastAt = c.lastAt === null ? ts : Math.max(c.lastAt, ts);
  };
  const ts = now();

  for (const g of galleries.results || []) {
    const c = get(g.client_email);
    if (g.client_name) c.name = c.name || g.client_name;
    c.galleries.push({ slug: g.slug, title: g.title, createdAt: g.created_at, expiresAt: g.expires_at });
    seen(c, g.created_at);
    c.lastSessionAt = Math.max(c.lastSessionAt || 0, g.created_at);
  }
  for (const b of bookings.results || []) {
    const c = get(b.client_email);
    if (b.client_name) c.name = c.name || b.client_name;
    if (b.client_phone) c.phone = c.phone || b.client_phone;
    c.bookings.push({ id: b.id, title: b.offer_title, startsAt: b.starts_at, status: b.status, depositCents: b.deposit_cents, paidAt: b.paid_at });
    seen(c, b.created_at);
    if (b.status === "confirmed") {
      if (b.paid_at) c.paidCents += b.deposit_cents;
      if (b.starts_at > ts) c.upcomingSessionAt = Math.min(c.upcomingSessionAt || Infinity, b.starts_at);
      else c.lastSessionAt = Math.max(c.lastSessionAt || 0, b.starts_at);
    }
  }
  for (const k of contracts.results || []) {
    const c = get(k.client_email);
    if (k.client_name) c.name = c.name || k.client_name;
    c.contracts.push({ id: k.id, number: k.number, title: k.title, status: k.status, totalCents: k.total_cents, depositCents: k.deposit_cents, signedAt: k.signed_at, createdAt: k.created_at });
    seen(c, k.created_at);
    if (k.status === "paid") c.paidCents += k.deposit_cents;
  }
  for (const p of payments.results || []) {
    const c = get(p.client_email);
    c.paidCents += p.amount_cents;
    c.payments.push({ id: p.id, kind: p.kind, amountCents: p.amount_cents, paidAt: p.paid_at, gallery: p.title, slug: p.slug });
    seen(c, p.paid_at);
  }
  for (const m of messages.results || []) {
    const c = get(m.email);
    if (m.name) c.name = c.name || m.name;
    if (m.phone) c.phone = c.phone || m.phone;
    c.messages.push({ id: m.id, at: m.created_at, message: m.message, eventDate: m.event_date });
    seen(c, m.created_at);
  }
  for (const g of gifts.results || []) {
    // L'acheteur paie ; le bénéficiaire, s'il a une adresse, devient un contact.
    if (g.buyer_email) {
      const c = get(g.buyer_email);
      if (g.from_name) c.name = c.name || g.from_name;
      c.gifts.push({ id: g.id, role: "buyer", code: g.code, status: g.status, amountCents: g.amount_cents, title: g.offer_title, toName: g.to_name, at: g.paid_at || g.created_at });
      if (g.status !== "cancelled" && g.source === "online") c.paidCents += g.amount_cents;
      seen(c, g.paid_at || g.created_at);
    }
    if (g.recipient_email) {
      const c = get(g.recipient_email);
      if (g.to_name) c.name = c.name || g.to_name;
      c.gifts.push({ id: g.id, role: "recipient", code: g.code, status: g.status, amountCents: g.amount_cents, title: g.offer_title, fromName: g.from_name, at: g.paid_at || g.created_at });
      seen(c, g.paid_at || g.created_at);
    }
  }
  for (const f of invoices.results || []) {
    const c = get(f.client_email);
    if (f.client_name) c.name = c.name || f.client_name;
    let schedule = [];
    try { schedule = JSON.parse(f.schedule || "[]") || []; } catch { schedule = []; }
    const paid = schedule.filter((x) => x.paidAt).reduce((n, x) => n + x.amountCents, 0);
    c.invoices.push({ id: f.id, kind: f.kind, number: f.number, status: f.status, title: f.title, totalCents: f.total_cents, paidCents: paid, at: f.issued_at });
    // Les factures préparées depuis une réservation, un contrat ou un bon
    // cadeau reprennent des montants déjà comptés : seules les libres s'ajoutent.
    if (f.kind === "invoice" && f.source === "manual") c.paidCents += paid;
    seen(c, f.issued_at);
  }
  for (const r of records.results || []) {
    const c = get(r.email);
    c.recordId = r.id;
    if (r.name) c.name = r.name;
    if (r.phone) c.phone = r.phone;
    c.notes = r.notes;
    c.tags = parseTags(r.tags);
    c.createdAt = r.created_at;
    seen(c, r.created_at);
  }
  for (const d of dates.results || []) {
    get(d.client_email).dates.push(d);
  }
  // Les dates sans client sont les temps forts du studio.
  const studio = map.has("") ? map.get("").dates : [];
  map.delete("");
  const list = [...map.values()];
  list.studio = studio;
  return list;
}

export function dateOut(d, today) {
  const ev = nextEvent(d, today);
  return {
    id: d.id,
    label: d.label,
    kind: d.kind,
    date: d.date,
    approx: Boolean(d.approx),
    plan: d.kind === "baby" ? parsePlan(d.plan) : [],
    lead: leadOf(d),
    remind: Boolean(d.remind),
    next: ev ? { date: ev.date, daysUntil: ev.daysUntil, years: ev.years, months: ev.months, title: ev.title, remindOn: ev.remindOn } : null,
  };
}

export function messageFor(d, next, clientName, studioName, bookingUrl) {
  return suggestedMessage({ kind: d.kind, label: d.label, years: next.years, months: next.months, clientName, studioName, bookingUrl, studio: !d.client_email });
}

// Écrire à tous les clients en copie cachée : au-delà, la messagerie peine,
// le photographe copie plutôt les adresses.
const BCC_LIMIT = 60;
function bccMailto(emails, message) {
  const bcc = emails.length <= BCC_LIMIT ? `bcc=${emails.map((e) => encodeURIComponent(e).replace(/%40/g, "@")).join(",")}&` : "";
  return `mailto:?${bcc}subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.body)}`;
}

// Tags posés par le photographe : JSON en base, 12 au plus, 30 caractères.
export function parseTags(raw) {
  let list = raw;
  if (typeof raw === "string") {
    try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const t of list) {
    const tag = cleanLine(t, 30).replace(/^#/, "");
    if (tag && !out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, 12);
}

// Prospect : un contact sans séance, ni contrat signé, ni achat — souvent
// une demande reçue par le formulaire du portfolio.
function isProspect(c) {
  return !c.galleries.length &&
    !c.bookings.some((b) => b.status === "confirmed") &&
    !c.contracts.some((k) => ["signed", "paid"].includes(k.status)) &&
    !c.payments.length &&
    !c.gifts.some((g) => g.role === "buyer" && g.status !== "cancelled") &&
    !c.invoices.some((f) => f.kind === "invoice");
}

function summaryOut(c, today) {
  const dates = c.dates.map((d) => dateOut(d, today)).filter((d) => d.next);
  dates.sort((a, b) => a.next.daysUntil - b.next.daysUntil);
  return {
    email: c.email,
    name: c.name || c.email,
    phone: c.phone,
    sessions: c.galleries.length + c.bookings.filter((b) => b.status === "confirmed").length,
    galleries: c.galleries.length,
    paidCents: c.paidCents,
    firstAt: c.firstAt,
    lastAt: c.lastAt,
    lastSessionAt: c.lastSessionAt,
    upcomingSessionAt: c.upcomingSessionAt,
    nextDate: dates[0] || null,
    hasNotes: Boolean(c.notes),
    tags: c.tags,
    prospect: isProspect(c),
    messages: c.messages.length,
  };
}

async function listForAdmin(env, photographer) {
  const today = todayIn();
  const all = await collect(env, photographer.id);
  const bookingUrl = await bookingPageUrl(env, photographer);
  const studioName = displayName(photographer);
  const clients = all.map((c) => summaryOut(c, today)).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  const ts = now();

  // À relancer : les dates des 45 prochains jours (ou plus tôt si le
  // rappel est réglé plus en avance), puis les clients sans séance depuis
  // près d'un an (et sans séance prévue).
  const upcoming = [];
  for (const c of all) {
    for (const d of c.dates) {
      const out = dateOut(d, today);
      if (!out.next || out.next.daysUntil > Math.max(45, out.lead)) continue;
      const message = messageFor(d, out.next, c.name, studioName, bookingUrl);
      upcoming.push({ ...out, email: c.email, name: c.name || c.email, mailto: mailtoUrl(c.email, message) });
    }
  }
  // Temps forts du studio, à proposer à tous les clients.
  const emails = all.map((c) => c.email);
  const seasons = all.studio.map((d) => {
    const out = dateOut(d, today);
    const message = out.next ? messageFor(d, out.next, "", studioName, bookingUrl) : null;
    return { ...out, recipients: emails.length, mailto: message ? bccMailto(emails, message) : "", message };
  }).sort((a, b) => (a.next?.daysUntil ?? 999) - (b.next?.daysUntil ?? 999));
  upcoming.sort((a, b) => a.next.daysUntil - b.next.daysUntil);
  const dormant = all
    .filter((c) => c.lastSessionAt && c.lastSessionAt < ts - DORMANT_SECONDS && !c.upcomingSessionAt)
    .sort((a, b) => b.lastSessionAt - a.lastSessionAt)
    .slice(0, 12)
    .map((c) => ({
      email: c.email,
      name: c.name || c.email,
      lastSessionAt: c.lastSessionAt,
      mailto: mailtoUrl(c.email, suggestedMessage({ clientName: c.name, studioName, bookingUrl, dormant: true })),
    }));
  // Tous les tags utilisés, du plus fréquent au plus rare (filtres de la liste).
  const tagCounts = new Map();
  for (const c of clients) for (const t of c.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr")).map(([tag, count]) => ({ tag, count }));
  return { clients, upcoming, dormant, seasons, emails, bookingUrl, tags, prospects: clients.filter((c) => c.prospect).length };
}

async function detailForAdmin(env, photographer, email) {
  const key = normEmail(email);
  const all = await collect(env, photographer.id);
  const c = all.find((x) => x.email === key);
  if (!c) return null;
  const today = todayIn();
  const bookingUrl = await bookingPageUrl(env, photographer);
  const studioName = displayName(photographer);
  const dates = c.dates.map((d) => {
    const out = dateOut(d, today);
    const message = out.next ? messageFor(d, out.next, c.name, studioName, bookingUrl) : null;
    return { ...out, mailto: message ? mailtoUrl(c.email, message) : "" };
  }).sort((a, b) => (a.next?.daysUntil ?? 999) - (b.next?.daysUntil ?? 999));

  // Historique, du plus récent au plus ancien.
  const history = [
    ...c.galleries.map((g) => ({ type: "gallery", at: g.createdAt, title: g.title, slug: g.slug })),
    ...c.bookings.map((b) => ({ type: "booking", at: b.startsAt, title: b.title, status: b.status, amountCents: b.paidAt ? b.depositCents : 0 })),
    ...c.contracts.map((k) => ({ type: "contract", at: k.signedAt || k.createdAt, title: k.title, number: k.number, status: k.status, amountCents: k.totalCents })),
    ...c.payments.map((p) => ({ type: "payment", at: p.paidAt, title: p.gallery, kind: p.kind, amountCents: p.amountCents, slug: p.slug })),
    ...c.messages.map((m) => ({ type: "message", at: m.at, title: m.message.slice(0, 200), eventDate: m.eventDate })),
    ...c.gifts.map((g) => ({ type: "gift", at: g.at, role: g.role, title: g.title, code: g.code, status: g.status, amountCents: g.amountCents, toName: g.toName || "", fromName: g.fromName || "" })),
    ...c.invoices.map((f) => ({ type: "invoice", at: f.at, kind: f.kind, number: f.number, title: f.title, status: f.status, amountCents: f.totalCents, paidCents: f.paidCents })),
  ].filter((h) => h.at).sort((a, b) => b.at - a.at);

  return {
    client: { ...summaryOut(c, today), notes: c.notes, recordId: c.recordId },
    dates,
    history,
    contactMailto: mailtoUrl(c.email, { subject: "", body: "" }).replace(/\?subject=&body=$/, ""),
    dormantMailto: mailtoUrl(c.email, suggestedMessage({ clientName: c.name, studioName, bookingUrl, dormant: true })),
    bookingUrl,
  };
}

/* ---------- Photographe : /api/admin/clients[/…] ---------- */

async function upsertRecord(env, photographerId, email, fields) {
  const ts = now();
  const existing = await env.DB.prepare("SELECT * FROM clients WHERE photographer_id = ? AND email = ?").bind(photographerId, email).first();
  const tags = fields.tags === undefined ? undefined : JSON.stringify(parseTags(fields.tags));
  if (existing) {
    await env.DB.prepare("UPDATE clients SET name = ?, phone = ?, notes = ?, tags = ?, updated_at = ? WHERE id = ?").bind(
      fields.name ?? existing.name, fields.phone ?? existing.phone, fields.notes ?? existing.notes, tags ?? existing.tags, ts, existing.id
    ).run();
    return existing.id;
  }
  const id = newId("cli");
  await env.DB.prepare(
    "INSERT INTO clients (id, photographer_id, email, name, phone, notes, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, photographerId, email, fields.name || "", fields.phone || "", fields.notes || "", tags || "", ts, ts).run();
  return id;
}

export async function handleClientsAdmin(request, env, photographer, parts, url) {
  // parts : ce qui suit /api/admin/clients
  const method = request.method;
  if (!parts.length && method === "GET") return json(await listForAdmin(env, photographer));
  if (parts[0] === "detail" && parts.length === 1 && method === "GET") {
    const detail = await detailForAdmin(env, photographer, url.searchParams.get("email"));
    if (!detail) return fail(404, "Client introuvable");
    return json(detail);
  }

  const body = method === "POST" ? await request.json().catch(() => ({})) : {};

  // Créer une fiche, ou compléter celle d'un client connu (nom, téléphone, notes).
  if (!parts.length && method === "POST") {
    const email = normEmail(body.email);
    if (!EMAIL_RE.test(email)) return fail(400, "Adresse e-mail invalide");
    const fields = {};
    if (body.name !== undefined) {
      fields.name = cleanLine(body.name, 120);
      if (!fields.name && body.create) return fail(400, "Indiquez le nom du client");
    }
    if (body.phone !== undefined) {
      const phone = normalizePhone(body.phone);
      if (phone.error) return fail(400, phone.error);
      fields.phone = phone.phone;
    }
    if (body.notes !== undefined) fields.notes = cleanText(body.notes, 10000);
    if (body.tags !== undefined) {
      if (!Array.isArray(body.tags)) return fail(400, "Tags illisibles");
      fields.tags = body.tags;
    }
    if (body.create) {
      // Un client déjà connu garde sa fiche (et son nom) : on la rouvre.
      if (await detailForAdmin(env, photographer, email)) return fail(409, "Ce client a déjà une fiche");
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM clients WHERE photographer_id = ?").bind(photographer.id).first();
      if ((count?.n || 0) >= 5000) return fail(409, "5 000 fiches au maximum");
    }
    await upsertRecord(env, photographer.id, email, fields);
    return json(await detailForAdmin(env, photographer, email), { status: body.create ? 201 : 200 });
  }

  // Dates à retenir.
  if (parts[0] === "dates" && parts.length === 1 && method === "POST") {
    // Temps fort du studio : une séance de saison, sans client.
    const studio = body.studio === true;
    const email = studio ? "" : normEmail(body.email);
    if (!studio && !EMAIL_RE.test(email)) return fail(400, "Adresse e-mail invalide");
    const kind = studio ? "season" : DATE_KINDS.includes(body.kind) ? body.kind : "other";
    const today = todayIn();
    let label = cleanLine(body.label, 80);
    let date = String(body.date || "");
    let approx = 0;
    let plan = "";
    if (kind === "season") {
      if (!SEASONS[label]) return fail(400, "Choisissez l'occasion");
      if (!parseDay(date)) return fail(400, "Indiquez la date de la séance");
    } else {
      if (!label) return fail(400, kind === "birthday" || kind === "baby" ? "Indiquez le prénom" : "Donnez un nom à cette date");
      if (kind === "baby" && body.ageMonths !== undefined && body.ageMonths !== "") {
        // Âge à la séance + date de la séance : naissance estimée.
        const age = Number(body.ageMonths);
        if (!Number.isInteger(age) || age < 0 || age > 36) return fail(400, "Âge à la séance invalide");
        if (!parseDay(body.sessionDate)) return fail(400, "Indiquez la date de la séance");
        date = birthFromAge(String(body.sessionDate), age);
        approx = 1;
      }
      if (!parseDay(date)) return fail(400, "Date invalide");
      if (date > today && kind !== "other") return fail(400, "Cette date est dans le futur : indiquez la date de naissance ou de mariage");
      if (kind === "baby") {
        plan = parsePlan(body.plan).join(",");
        if (!plan) return fail(400, "Choisissez au moins une étape à proposer");
        if (!babySteps(date, plan, today).length) return fail(400, "Toutes ces étapes sont déjà passées : cochez « chaque anniversaire »");
      }
    }
    const lead = LEAD_CHOICES.includes(Number(body.lead)) ? Number(body.lead) : DEFAULT_LEAD[kind];
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM client_dates WHERE photographer_id = ? AND client_email = ?").bind(photographer.id, email).first();
    if ((count?.n || 0) >= 20) return fail(409, studio ? "20 temps forts au maximum" : "20 dates au maximum par client");
    await env.DB.prepare(
      "INSERT INTO client_dates (id, photographer_id, client_email, label, kind, date, remind, lead_days, plan, approx, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(newId("cld"), photographer.id, email, label, kind, date, body.remind === false ? 0 : 1, lead, plan, approx, now()).run();
    return json(studio ? await listForAdmin(env, photographer) : await detailForAdmin(env, photographer, email), { status: 201 });
  }
  if (parts[0] === "dates" && parts[1] && parts.length === 2) {
    const row = await env.DB.prepare("SELECT * FROM client_dates WHERE id = ? AND photographer_id = ?").bind(decodeURIComponent(parts[1]), photographer.id).first();
    if (!row) return fail(404, "Date introuvable");
    if (method === "POST") {
      const remind = body.remind === undefined ? row.remind : body.remind ? 1 : 0;
      const lead = LEAD_CHOICES.includes(Number(body.lead)) ? Number(body.lead) : row.lead_days;
      let plan = row.plan;
      if (row.kind === "baby" && body.plan !== undefined) {
        plan = parsePlan(body.plan).join(",");
        if (!plan) return fail(400, "Choisissez au moins une étape à proposer");
      }
      await env.DB.prepare("UPDATE client_dates SET remind = ?, lead_days = ?, plan = ? WHERE id = ?").bind(remind, lead, plan, row.id).run();
    } else if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM client_dates WHERE id = ?").bind(row.id).run();
    } else {
      return fail(405, "Méthode non autorisée");
    }
    return json(row.client_email ? await detailForAdmin(env, photographer, row.client_email) : await listForAdmin(env, photographer));
  }

  // Effacer ce que le photographe a ajouté (téléphone, notes, dates). Les
  // galeries, réservations et contrats du client restent, et sa fiche aussi.
  if (!parts.length && method === "DELETE") {
    const email = normEmail(url.searchParams.get("email"));
    await env.DB.prepare("DELETE FROM clients WHERE photographer_id = ? AND email = ?").bind(photographer.id, email).run();
    await env.DB.prepare("DELETE FROM client_dates WHERE photographer_id = ? AND client_email = ?").bind(photographer.id, email).run();
    return json(await listForAdmin(env, photographer));
  }
  return fail(404, "Route inconnue");
}

/* ---------- Rappels des dates à retenir (déclencheur planifié) ---------- */

export async function runClientReminders(env) {
  const today = todayIn();
  const { results } = await env.DB.prepare(
    `SELECT d.*, p.email AS photographer_email, p.studio_name, p.first_name, p.last_name, p.id AS pid, p.plan AS photographer_plan, p.plan_status, p.subdomain
       FROM client_dates d JOIN photographers p ON p.id = d.photographer_id
      WHERE d.remind = 1`
  ).all();
  let sent = 0;
  for (const d of results || []) {
    const next = nextEvent(d, today);
    if (!next || next.daysUntil > next.lead || (d.notified_year || 0) >= next.key) continue;
    // Marqué d'abord : un rappel manqué vaut mieux qu'un rappel en double.
    const claim = await env.DB.prepare("UPDATE client_dates SET notified_year = ? WHERE id = ? AND (notified_year IS NULL OR notified_year < ?)")
      .bind(next.key, d.id, next.key).run();
    if (!claim.meta?.changes) continue;
    const photographer = { id: d.pid, email: d.photographer_email, studio_name: d.studio_name, first_name: d.first_name, last_name: d.last_name, plan: d.photographer_plan, plan_status: d.plan_status, subdomain: d.subdomain };
    const studioName = displayName(photographer);
    const bookingUrl = await bookingPageUrl(env, photographer);
    const adminBase = env.ADMIN_URL ? String(env.ADMIN_URL).replace(/\/$/, "") : "";
    if (!d.client_email) {
      // Temps fort du studio : le rappel invite à écrire à tous les clients.
      const clients = await collect(env, d.pid);
      const message = messageFor(d, next, "", studioName, bookingUrl);
      await sendStudioSeasonReminder(env, {
        to: d.photographer_email,
        title: next.title,
        date: next.date,
        daysUntil: next.daysUntil,
        recipients: clients.length,
        message,
        mailto: bccMailto(clients.map((c) => c.email), message),
        adminUrl: adminBase ? `${adminBase}/#/clients` : "",
      });
      sent++;
      continue;
    }
    const client = await env.DB.prepare("SELECT name FROM clients WHERE photographer_id = ? AND email = ?").bind(d.photographer_id, d.client_email).first();
    const fromGallery = client?.name ? null : await env.DB.prepare("SELECT client_name FROM galleries WHERE photographer_id = ? AND client_email = ? AND client_name != '' ORDER BY created_at DESC LIMIT 1").bind(d.photographer_id, d.client_email).first();
    const clientName = client?.name || fromGallery?.client_name || d.client_email;
    const message = messageFor(d, next, clientName, studioName, bookingUrl);
    await sendClientDateReminder(env, {
      to: d.photographer_email,
      clientName,
      clientEmail: d.client_email,
      title: next.title,
      date: next.date,
      daysUntil: next.daysUntil,
      message,
      mailto: mailtoUrl(d.client_email, message),
      adminUrl: adminBase ? `${adminBase}/#/clients/${encodeURIComponent(d.client_email)}` : "",
    });
    sent++;
  }
  return sent;
}
