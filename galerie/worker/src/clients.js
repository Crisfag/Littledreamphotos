// Fiches clients et relances : une fiche par adresse e-mail, construite à
// partir de ce que Holypixx connaît déjà (galeries, réservations, contrats,
// paiements) et complétée par le photographe (téléphone, notes, dates à
// retenir). Une date à retenir (anniversaire d'un enfant, de mariage…)
// prévient le photographe trois semaines avant, avec un message prêt à
// envoyer pour proposer une nouvelle séance.
//
//   /api/admin/clients                 liste, dates à venir, clients à recontacter
//   /api/admin/clients/detail?email=   fiche complète
//   /api/admin/clients        (POST)   créer ou compléter une fiche
//   /api/admin/clients/dates  (POST)   ajouter une date à retenir
//   /api/admin/clients/dates/:id       modifier (POST) ou retirer (DELETE)

import { json, fail } from "./http.js";
import { randomBytes, b64url } from "./auth.js";
import { cleanLine, cleanText, normalizePhone, displayName, portfolioUrls } from "./portfolio.js";
import { hasFeature } from "./subscription.js";
import { sendClientDateReminder } from "./notify.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const REMINDER_LEAD_DAYS = 21;
// Sans séance depuis ce délai, un client est proposé à recontacter.
const DORMANT_SECONDS = 330 * 86400;
const DATE_KINDS = ["birthday", "wedding", "other"];
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

// « Léa aura 1 an », « 10 ans de mariage », « Rendez-vous annuel ».
export function occasionLabel(kind, label, years) {
  const n = years ? `${years} an${years > 1 ? "s" : ""}` : "";
  if (kind === "birthday") return n ? `${label} aura ${n}` : `Anniversaire de ${label}`;
  if (kind === "wedding") return n ? `${n} de mariage : ${label}` : `Anniversaire de mariage : ${label}`;
  return label;
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

// Message proposé au photographe pour relancer son client (sujet + corps),
// à envoyer tel quel ou à retoucher.
export function suggestedMessage({ kind, label, years, clientName, studioName, bookingUrl, dormant }) {
  const hello = firstName(clientName) ? `Bonjour ${firstName(clientName)},` : "Bonjour,";
  const book = bookingUrl ? `\n\nVous pouvez choisir votre créneau directement ici : ${bookingUrl}` : "\n\nDites-moi simplement quelles dates vous conviendraient.";
  const sign = `\n\nÀ très bientôt,\n${studioName || ""}`.trimEnd();
  if (dormant) {
    return {
      subject: "Une nouvelle séance photo ?",
      body: `${hello}\n\nCela fait un moment depuis notre dernière séance ensemble ! Si l'envie vous prend d'immortaliser ce qui a changé depuis, ce serait un plaisir de vous retrouver.${book}${sign}`,
    };
  }
  if (kind === "birthday") {
    // « son premier anniversaire », « ses 3 ans », ou simplement « son anniversaire ».
    const age = years === 1 ? "son premier anniversaire" : years ? `ses ${years} ans` : "son anniversaire";
    const occasion = years === 1 ? "le premier anniversaire" : years ? `les ${years} ans` : "l'anniversaire";
    return {
      subject: `Une séance pour ${occasion} de ${label} ?`,
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

async function bookingPageUrl(env, photographer) {
  if (!hasFeature(env, photographer, "booking")) return "";
  const portfolio = await env.DB.prepare("SELECT handle, published FROM portfolios WHERE photographer_id = ?").bind(photographer.id).first();
  if (!portfolio?.published) return "";
  const urls = portfolioUrls(env, photographer, portfolio.handle);
  return (urls.studio || urls.site) + "#reserver";
}

// Tout ce que Holypixx sait des clients d'un photographe, regroupé par e-mail.
async function collect(env, photographerId) {
  const [galleries, bookings, contracts, payments, records, dates] = await Promise.all([
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
  ]);

  const map = new Map();
  const get = (email) => {
    const key = normEmail(email);
    if (!map.has(key)) {
      map.set(key, {
        email: key, name: "", phone: "", notes: "", recordId: "", createdAt: null,
        galleries: [], bookings: [], contracts: [], payments: [], dates: [],
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
  for (const r of records.results || []) {
    const c = get(r.email);
    c.recordId = r.id;
    if (r.name) c.name = r.name;
    if (r.phone) c.phone = r.phone;
    c.notes = r.notes;
    c.createdAt = r.created_at;
    seen(c, r.created_at);
  }
  for (const d of dates.results || []) {
    get(d.client_email).dates.push(d);
  }
  map.delete("");
  return [...map.values()];
}

function dateOut(d, today) {
  const next = nextOccurrence(d.date, today);
  return {
    id: d.id,
    label: d.label,
    kind: d.kind,
    date: d.date,
    remind: Boolean(d.remind),
    next: next ? { date: next.date, daysUntil: next.daysUntil, years: next.years, title: occasionLabel(d.kind, d.label, next.years) } : null,
  };
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
  };
}

async function listForAdmin(env, photographer) {
  const today = todayIn();
  const all = await collect(env, photographer.id);
  const bookingUrl = await bookingPageUrl(env, photographer);
  const studioName = displayName(photographer);
  const clients = all.map((c) => summaryOut(c, today)).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  const ts = now();

  // À relancer : les dates des 45 prochains jours, puis les clients sans
  // séance depuis près d'un an (et sans séance prévue).
  const upcoming = [];
  for (const c of all) {
    for (const d of c.dates) {
      const out = dateOut(d, today);
      if (!out.next || out.next.daysUntil > 45) continue;
      const message = suggestedMessage({ kind: d.kind, label: d.label, years: out.next.years, clientName: c.name, studioName, bookingUrl });
      upcoming.push({ ...out, email: c.email, name: c.name || c.email, mailto: mailtoUrl(c.email, message) });
    }
  }
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
  return { clients, upcoming, dormant, bookingUrl };
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
    const message = out.next ? suggestedMessage({ kind: d.kind, label: d.label, years: out.next.years, clientName: c.name, studioName, bookingUrl }) : null;
    return { ...out, mailto: message ? mailtoUrl(c.email, message) : "" };
  }).sort((a, b) => (a.next?.daysUntil ?? 999) - (b.next?.daysUntil ?? 999));

  // Historique, du plus récent au plus ancien.
  const history = [
    ...c.galleries.map((g) => ({ type: "gallery", at: g.createdAt, title: g.title, slug: g.slug })),
    ...c.bookings.map((b) => ({ type: "booking", at: b.startsAt, title: b.title, status: b.status, amountCents: b.paidAt ? b.depositCents : 0 })),
    ...c.contracts.map((k) => ({ type: "contract", at: k.signedAt || k.createdAt, title: k.title, number: k.number, status: k.status, amountCents: k.totalCents })),
    ...c.payments.map((p) => ({ type: "payment", at: p.paidAt, title: p.gallery, kind: p.kind, amountCents: p.amountCents, slug: p.slug })),
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
  if (existing) {
    await env.DB.prepare("UPDATE clients SET name = ?, phone = ?, notes = ?, updated_at = ? WHERE id = ?").bind(
      fields.name ?? existing.name, fields.phone ?? existing.phone, fields.notes ?? existing.notes, ts, existing.id
    ).run();
    return existing.id;
  }
  const id = newId("cli");
  await env.DB.prepare(
    "INSERT INTO clients (id, photographer_id, email, name, phone, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, photographerId, email, fields.name || "", fields.phone || "", fields.notes || "", ts, ts).run();
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
    const email = normEmail(body.email);
    if (!EMAIL_RE.test(email)) return fail(400, "Adresse e-mail invalide");
    const label = cleanLine(body.label, 80);
    const kind = DATE_KINDS.includes(body.kind) ? body.kind : "other";
    if (!label) return fail(400, kind === "birthday" ? "Indiquez le prénom" : "Donnez un nom à cette date");
    if (!parseDay(body.date)) return fail(400, "Date invalide");
    if (String(body.date) > todayIn() && kind !== "other") return fail(400, "Cette date est dans le futur : indiquez la date de naissance ou de mariage");
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM client_dates WHERE photographer_id = ? AND client_email = ?").bind(photographer.id, email).first();
    if ((count?.n || 0) >= 20) return fail(409, "20 dates au maximum par client");
    await env.DB.prepare(
      "INSERT INTO client_dates (id, photographer_id, client_email, label, kind, date, remind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(newId("cld"), photographer.id, email, label, kind, String(body.date), body.remind === false ? 0 : 1, now()).run();
    return json(await detailForAdmin(env, photographer, email), { status: 201 });
  }
  if (parts[0] === "dates" && parts[1] && parts.length === 2) {
    const row = await env.DB.prepare("SELECT * FROM client_dates WHERE id = ? AND photographer_id = ?").bind(decodeURIComponent(parts[1]), photographer.id).first();
    if (!row) return fail(404, "Date introuvable");
    if (method === "POST") {
      await env.DB.prepare("UPDATE client_dates SET remind = ? WHERE id = ?").bind(body.remind ? 1 : 0, row.id).run();
    } else if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM client_dates WHERE id = ?").bind(row.id).run();
    } else {
      return fail(405, "Méthode non autorisée");
    }
    return json(await detailForAdmin(env, photographer, row.client_email));
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
    `SELECT d.*, p.email AS photographer_email, p.studio_name, p.first_name, p.last_name, p.id AS pid, p.plan, p.plan_status, p.subdomain
       FROM client_dates d JOIN photographers p ON p.id = d.photographer_id
      WHERE d.remind = 1`
  ).all();
  let sent = 0;
  for (const d of results || []) {
    const next = nextOccurrence(d.date, today);
    if (!next || next.daysUntil > REMINDER_LEAD_DAYS || (d.notified_year || 0) >= next.year) continue;
    // Marqué d'abord : un rappel manqué vaut mieux qu'un rappel en double.
    const claim = await env.DB.prepare("UPDATE client_dates SET notified_year = ? WHERE id = ? AND (notified_year IS NULL OR notified_year < ?)")
      .bind(next.year, d.id, next.year).run();
    if (!claim.meta?.changes) continue;
    const photographer = { id: d.pid, email: d.photographer_email, studio_name: d.studio_name, first_name: d.first_name, last_name: d.last_name, plan: d.plan, plan_status: d.plan_status, subdomain: d.subdomain };
    const client = await env.DB.prepare("SELECT name FROM clients WHERE photographer_id = ? AND email = ?").bind(d.photographer_id, d.client_email).first();
    const fromGallery = client?.name ? null : await env.DB.prepare("SELECT client_name FROM galleries WHERE photographer_id = ? AND client_email = ? AND client_name != '' ORDER BY created_at DESC LIMIT 1").bind(d.photographer_id, d.client_email).first();
    const clientName = client?.name || fromGallery?.client_name || d.client_email;
    const studioName = displayName(photographer);
    const bookingUrl = await bookingPageUrl(env, photographer);
    const message = suggestedMessage({ kind: d.kind, label: d.label, years: next.years, clientName, studioName, bookingUrl });
    await sendClientDateReminder(env, {
      to: d.photographer_email,
      clientName,
      clientEmail: d.client_email,
      title: occasionLabel(d.kind, d.label, next.years),
      date: next.date,
      daysUntil: next.daysUntil,
      message,
      mailto: mailtoUrl(d.client_email, message),
      adminUrl: env.ADMIN_URL ? `${String(env.ADMIN_URL).replace(/\/$/, "")}/#/clients/${encodeURIComponent(d.client_email)}` : "",
    });
    sent++;
  }
  return sent;
}
