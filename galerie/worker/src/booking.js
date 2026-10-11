// Réservation en ligne : le photographe propose des formules de séance
// (durée, prix, acompte, lieu) et ouvre des créneaux, un par un ou en série
// pour les mini-séances ; ses clients réservent depuis son mini-site et
// règlent l'acompte par Stripe, directement sur le compte du photographe
// (comme la boutique de tirages). Le créneau est bloqué le temps du
// paiement, puis confirmé par le webhook Stripe (ou au retour du client).
//
//   Public (mini-site)  /api/booking/:handle                    formules et créneaux libres
//                       /api/booking/:handle/book                réserver (→ paiement Stripe)
//                       /api/booking/:handle/reservation/:id     état d'une réservation (retour de Stripe)
//                       /api/booking/:handle/release/:id         paiement abandonné : libère le créneau
//   Photographe         /api/admin/booking[/offers|/slots|/bookings…]

import { json, fail } from "./http.js";
import { randomBytes, b64url, hashIp } from "./auth.js";
import { hasFeature, featureRefusal } from "./subscription.js";
import { publishedPortfolioByHandle, cleanLine, cleanText, normalizePhone, displayName, portfolioUrls } from "./portfolio.js";
import { createCheckoutSession, retrieveCheckoutSession } from "./stripe.js";
import { paymentFeeCents } from "./fees.js";
import {
  sendBookingConfirmation,
  sendBookingPhotographerNotice,
  sendBookingCancelled,
  sendBookingReminder,
  sendBookingConflict,
} from "./notify.js";

export const BOOKING_TIME_ZONE = "Europe/Brussels";
// Le paiement de l'acompte dispose de 30 minutes (minimum imposé par Stripe
// pour l'expiration d'une session) ; le créneau reste bloqué un peu plus
// longtemps, pour qu'un paiement validé à la dernière seconde le trouve libre.
const CHECKOUT_SECONDS = 30 * 60 + 30;
const HOLD_SECONDS = 32 * 60;
// Un créneau trop proche n'est plus proposé : le photographe doit avoir le
// temps de voir passer la réservation.
const MIN_NOTICE_SECONDS = 12 * 3600;
// Créneaux proposés au plus loin, et nombre de créneaux créés d'un coup.
const MAX_AHEAD_SECONDS = 400 * 86400;
const MAX_SLOTS_PER_REQUEST = 80;
const BOOKINGS_PER_VISITOR_PER_HOUR = 6;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function now() {
  return Math.floor(Date.now() / 1000);
}

function newId(prefix) {
  return `${prefix}_${b64url(randomBytes(9))}`;
}

/* ---------- Heure de Bruxelles ---------- */

// Décalage (en minutes) de l'heure de Bruxelles par rapport à UTC à un
// instant donné : +60 en hiver, +120 en été.
function zoneOffsetMinutes(utcMs, timeZone = BOOKING_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - utcMs) / 60000);
}

// « 2026-12-06 » + « 10:20 » (heure de Bruxelles) → epoch secondes. null si
// la date ou l'heure sont invalides.
export function localToEpoch(date, time, timeZone = BOOKING_TIME_ZONE) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  const t = /^(\d{1,2}):(\d{2})$/.exec(String(time || ""));
  if (!d || !t) return null;
  const [y, m, day, h, min] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  if (m < 1 || m > 12 || day < 1 || day > 31 || h > 23 || min > 59) return null;
  const guess = Date.UTC(y, m - 1, day, h, min);
  const check = new Date(guess);
  if (check.getUTCDate() !== day || check.getUTCMonth() !== m - 1) return null; // 31 février…
  // Deux passes : le décalage peut changer entre l'heure « naïve » et l'heure
  // réelle (nuits de changement d'heure).
  let utc = guess - zoneOffsetMinutes(guess, timeZone) * 60000;
  utc = guess - zoneOffsetMinutes(utc, timeZone) * 60000;
  return Math.floor(utc / 1000);
}

// « 10:00 » → « 16:00 » toutes les 20 min, chaque séance durant `duration`
// minutes : 10:00, 10:20, … jusqu'à la dernière qui se termine à 16:00 au
// plus tard. La pause éventuelle entre deux séances est comprise dans le pas.
export function seriesTimes(from, to, every, duration) {
  const toMinutes = (v) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || ""));
    return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const start = toMinutes(from);
  const end = toMinutes(to);
  const step = Math.round(Number(every));
  const length = Math.round(Number(duration)) || 0;
  if (start === null || end === null || !(step >= 5) || end <= start) return [];
  const times = [];
  for (let t = start; t + Math.max(length, 1) <= end && times.length <= MAX_SLOTS_PER_REQUEST; t += step) {
    times.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
  }
  return times;
}

// « samedi 6 décembre 2026 à 10 h 20 » (heure de Bruxelles).
export function formatSlot(ts) {
  const date = new Date(ts * 1000);
  const day = date.toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: BOOKING_TIME_ZONE });
  const time = date.toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: BOOKING_TIME_ZONE }).replace(":", " h ");
  return `${day} à ${time}`;
}

// Invitation de calendrier (.ics) jointe aux e-mails de confirmation.
export function buildIcs({ uid, startsAt, durationMin, title, location, description, cancelled = false }) {
  const stamp = (ts) => new Date(ts * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  // RFC 5545 : virgules, points-virgules et retours à la ligne échappés.
  const text = (v) => String(v || "").replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\r?\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Holypixx//Reservation//FR",
    "CALSCALE:GREGORIAN",
    `METHOD:${cancelled ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${uid}@holypixx.com`,
    `DTSTAMP:${stamp(now())}`,
    `DTSTART:${stamp(startsAt)}`,
    `DTEND:${stamp(startsAt + durationMin * 60)}`,
    `SUMMARY:${text(title)}`,
    location ? `LOCATION:${text(location)}` : "",
    description ? `DESCRIPTION:${text(description)}` : "",
    cancelled ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].filter((line, i, all) => line !== "" || i === all.length - 1).join("\r\n");
}

/* ---------- Lecture ---------- */

function stripeReady(photographer) {
  return Boolean(photographer?.stripe_account_id && photographer?.stripe_charges_enabled);
}

// Les paiements abandonnés libèrent leur créneau : on les marque expirés
// avant toute lecture ou réservation.
async function expireHolds(env, photographerId) {
  await env.DB.prepare("UPDATE bookings SET status = 'expired' WHERE photographer_id = ? AND status = 'pending' AND hold_until < ?")
    .bind(photographerId, now())
    .run();
}

function offerOut(o) {
  return {
    id: o.id,
    title: o.title,
    description: o.description,
    durationMin: o.duration_min,
    priceCents: o.price_cents,
    depositCents: o.deposit_cents,
    location: o.location,
    active: Boolean(o.active),
  };
}

async function photographerById(env, id) {
  return env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(id).first();
}

// Formules actives et créneaux encore libres d'un photographe, pour son
// mini-site. Une formule avec acompte n'est proposée que si son compte
// Stripe peut encaisser.
async function publicOffers(env, photographer) {
  await expireHolds(env, photographer.id);
  const { results: offers } = await env.DB.prepare(
    "SELECT * FROM booking_offers WHERE photographer_id = ? AND active = 1 ORDER BY position ASC, created_at ASC"
  ).bind(photographer.id).all();
  const usable = (offers || []).filter((o) => o.deposit_cents === 0 || stripeReady(photographer));
  if (!usable.length) return [];
  const ts = now();
  const { results: slots } = await env.DB.prepare(
    `SELECT s.id, s.offer_id, s.starts_at FROM booking_slots s
      WHERE s.photographer_id = ? AND s.starts_at > ? AND s.starts_at < ?
        AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id = s.id AND b.status IN ('pending', 'confirmed'))
      ORDER BY s.starts_at ASC`
  ).bind(photographer.id, ts + MIN_NOTICE_SECONDS, ts + MAX_AHEAD_SECONDS).all();
  return usable
    .map((o) => ({
      ...offerOut(o),
      slots: (slots || []).filter((s) => s.offer_id === o.id).map((s) => ({ id: s.id, startsAt: s.starts_at })),
    }))
    .filter((o) => o.slots.length);
}

/* ---------- Public : /api/booking/:handle[/…] ---------- */

export async function handleBookingPublic(request, env, path) {
  const parts = path.split("/").filter(Boolean); // api, booking, handle, …
  const handle = decodeURIComponent(parts[2] || "");
  const row = handle ? await publishedPortfolioByHandle(env, handle) : null;
  if (!row) return fail(404, "Portfolio introuvable");
  const photographer = await photographerById(env, row.photographer_id);
  if (!photographer || !hasFeature(env, photographer, "booking")) return fail(404, "Réservation indisponible");

  if (parts.length === 3 && request.method === "GET") {
    return json({ studioName: displayName(row), offers: await publicOffers(env, photographer) });
  }
  if (parts[3] === "book" && parts.length === 4 && request.method === "POST") {
    return book(request, env, row, photographer);
  }
  if (parts[3] === "reservation" && parts[4] && parts.length === 5 && request.method === "GET") {
    const url = new URL(request.url);
    return reservationStatus(env, photographer, decodeURIComponent(parts[4]), url.searchParams.get("session_id") || "");
  }
  if (parts[3] === "release" && parts[4] && parts.length === 5 && request.method === "POST") {
    await env.DB.prepare("UPDATE bookings SET status = 'expired' WHERE id = ? AND photographer_id = ? AND status = 'pending'")
      .bind(decodeURIComponent(parts[4]), photographer.id)
      .run();
    return json({ ok: true });
  }
  return fail(404, "Route inconnue");
}

// Adresse de retour fournie par la page du mini-site, à laquelle on ajoute
// l'identifiant de la réservation (et celui de la session Stripe).
function returnUrl(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  // {CHECKOUT_SESSION_ID} est remplacé par Stripe : il ne doit pas être encodé.
  return url.toString().replace(encodeURIComponent("{CHECKOUT_SESSION_ID}"), "{CHECKOUT_SESSION_ID}");
}

async function book(request, env, row, photographer) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return fail(400, "Requête invalide");
  // Champ piège des robots (comme le formulaire de contact).
  if (cleanLine(body.website, 200)) return fail(400, "Requête invalide");

  const name = cleanLine(body.name, 100);
  const email = cleanLine(body.email, 200).toLowerCase();
  const phone = normalizePhone(body.phone);
  const message = cleanText(body.message, 2000);
  if (!name) return fail(400, "Indiquez votre nom");
  if (!EMAIL_RE.test(email)) return fail(400, "Adresse e-mail invalide");
  if (phone.error) return fail(400, phone.error);
  const base = String(body.returnUrl || "");
  if (!/^https?:\/\//.test(base)) return fail(400, "Adresse de retour invalide");

  const ts = now();
  const ipHash = await hashIp(request.headers.get("CF-Connecting-IP") || "", env.TOKEN_SECRET);
  // Garde-fou contre le blocage de créneaux en masse : seules comptent les
  // réservations qui tiennent encore un créneau (en cours ou confirmées).
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM bookings WHERE ip_hash = ? AND created_at > ? AND status IN ('pending', 'confirmed')"
  ).bind(ipHash, ts - 3600).first();
  if ((recent?.n || 0) >= BOOKINGS_PER_VISITOR_PER_HOUR) return fail(429, "Trop de réservations tentées. Réessayez un peu plus tard.");

  const slot = await env.DB.prepare(
    `SELECT s.*, o.title, o.duration_min, o.price_cents, o.deposit_cents, o.location, o.active
       FROM booking_slots s JOIN booking_offers o ON o.id = s.offer_id
      WHERE s.id = ? AND s.photographer_id = ?`
  ).bind(String(body.slotId || ""), photographer.id).first();
  if (!slot || !slot.active) return fail(404, "Ce créneau n'existe plus");
  if (slot.starts_at <= ts + MIN_NOTICE_SECONDS) return fail(409, "Ce créneau est trop proche pour être réservé en ligne. Contactez directement le studio.");
  if (slot.deposit_cents > 0 && !stripeReady(photographer)) return fail(409, "Le paiement en ligne de ce studio n'est pas disponible pour le moment.");

  await expireHolds(env, photographer.id);
  const id = newId("bkg");
  const withDeposit = slot.deposit_cents > 0;
  const feeCents = withDeposit ? paymentFeeCents(env, photographer, slot.deposit_cents) : 0;
  try {
    await env.DB.prepare(
      `INSERT INTO bookings (id, photographer_id, slot_id, offer_id, offer_title, location, starts_at, duration_min,
         price_cents, deposit_cents, fee_cents, client_name, client_email, client_phone, message, status, hold_until,
         ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, photographer.id, slot.id, slot.offer_id, slot.title, slot.location, slot.starts_at, slot.duration_min,
      slot.price_cents, slot.deposit_cents, feeCents, name, email, phone.phone, message,
      withDeposit ? "pending" : "confirmed", withDeposit ? ts + HOLD_SECONDS : null, ipHash, ts
    ).run();
  } catch (err) {
    // Index unique : quelqu'un d'autre vient de prendre ce créneau.
    if (/UNIQUE/i.test(String(err && err.message))) return fail(409, "Ce créneau vient d'être réservé. Choisissez-en un autre.");
    throw err;
  }

  if (!withDeposit) {
    const booking = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(id).first();
    await notifyConfirmed(env, row, photographer, booking);
    return json({ bookingId: id, status: "confirmed" }, { status: 201 });
  }

  let session;
  try {
    session = await createCheckoutSession(env, photographer.stripe_account_id, {
      label: `Acompte — ${slot.title} — ${formatSlot(slot.starts_at)}`,
      unitAmountCents: slot.deposit_cents,
      quantity: 1,
      successUrl: returnUrl(base, { reservation: id, session_id: "{CHECKOUT_SESSION_ID}" }),
      cancelUrl: returnUrl(base, { reservation: id, annule: "1" }),
      metadata: { kind: "booking", booking_id: id, photographer_id: photographer.id },
      applicationFeeCents: feeCents,
      expiresAt: ts + CHECKOUT_SECONDS,
      customerEmail: email,
    });
  } catch (err) {
    await env.DB.prepare("UPDATE bookings SET status = 'expired' WHERE id = ?").bind(id).run();
    if (err && err.stripeNotConfigured) return fail(503, "Le paiement en ligne n'est pas encore disponible.");
    console.error("Réservation : création de la session Stripe impossible :", err);
    return fail(502, "Le paiement n'a pas pu être préparé. Réessayez dans un instant.");
  }
  await env.DB.prepare("UPDATE bookings SET stripe_session_id = ? WHERE id = ?").bind(session.id, id).run();
  return json({ bookingId: id, status: "pending", url: session.url }, { status: 201 });
}

function reservationOut(b) {
  return {
    id: b.id,
    status: b.status,
    offerTitle: b.offer_title,
    startsAt: b.starts_at,
    durationMin: b.duration_min,
    location: b.location,
    depositCents: b.deposit_cents,
    priceCents: b.price_cents,
  };
}

// Retour de Stripe : sans attendre le webhook, on relit la session de
// paiement (les deux chemins sont idempotents).
async function reservationStatus(env, photographer, id, sessionId) {
  let booking = await env.DB.prepare("SELECT * FROM bookings WHERE id = ? AND photographer_id = ?").bind(id, photographer.id).first();
  if (!booking) return fail(404, "Réservation introuvable");
  if (booking.status === "pending" && sessionId && sessionId === booking.stripe_session_id) {
    try {
      const session = await retrieveCheckoutSession(env, sessionId);
      await markBookingPaid(env, session);
      booking = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(id).first();
    } catch (err) {
      console.error("Réservation : relecture de la session Stripe impossible :", err);
    }
  }
  return json({ reservation: reservationOut(booking) });
}

/* ---------- Paiement confirmé (webhook Stripe ou retour du client) ---------- */

export async function markBookingPaid(env, session) {
  if (!session || session.payment_status !== "paid" || session.metadata?.kind !== "booking") return;
  const booking = await env.DB.prepare("SELECT * FROM bookings WHERE id = ? AND stripe_session_id = ?")
    .bind(session.metadata.booking_id || "", session.id)
    .first();
  if (!booking || !["pending", "expired"].includes(booking.status)) return;
  const ts = now();
  let changes = 0;
  try {
    const result = await env.DB.prepare(
      `UPDATE bookings SET status = 'confirmed', paid_at = ?, hold_until = NULL, stripe_payment_intent_id = ?
        WHERE id = ? AND status IN ('pending', 'expired')`
    ).bind(ts, session.payment_intent || "", booking.id).run();
    changes = result.meta?.changes || 0;
  } catch (err) {
    if (!/UNIQUE/i.test(String(err && err.message))) throw err;
    // Payé après l'expiration du blocage, et le créneau a été repris
    // entre-temps : le photographe est prévenu pour rembourser l'acompte.
    await env.DB.prepare("UPDATE bookings SET status = 'conflict', paid_at = ?, stripe_payment_intent_id = ? WHERE id = ?")
      .bind(ts, session.payment_intent || "", booking.id)
      .run();
    const photographer = await photographerById(env, booking.photographer_id);
    await sendBookingConflict(env, { to: photographer?.email, ...emailParams(env, null, photographer, booking) });
    return;
  }
  if (!changes) return;
  const confirmed = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(booking.id).first();
  const photographer = await photographerById(env, booking.photographer_id);
  const portfolio = await env.DB.prepare("SELECT * FROM portfolios WHERE photographer_id = ?").bind(booking.photographer_id).first();
  await notifyConfirmed(env, portfolio, photographer, confirmed);
}

function emailParams(env, portfolio, photographer, booking) {
  const studioName = displayName(photographer || {});
  return {
    studioName,
    studioEmail: photographer?.email || "",
    studioPhone: portfolio?.phone || "",
    clientName: booking.client_name,
    clientEmail: booking.client_email,
    clientPhone: booking.client_phone,
    message: booking.message,
    offerTitle: booking.offer_title,
    when: formatSlot(booking.starts_at),
    durationMin: booking.duration_min,
    location: booking.location,
    depositCents: booking.deposit_cents,
    priceCents: booking.price_cents,
    adminUrl: env.ADMIN_URL ? `${String(env.ADMIN_URL).replace(/\/$/, "")}/#/reservations` : "",
  };
}

function icsAttachment(booking, studioName, cancelled = false) {
  const ics = buildIcs({
    uid: booking.id,
    startsAt: booking.starts_at,
    durationMin: booking.duration_min,
    title: `${booking.offer_title} — ${studioName}`,
    location: booking.location,
    description: cancelled ? "Séance annulée." : `Réservation ${booking.id}`,
    cancelled,
  });
  const bytes = new TextEncoder().encode(ics);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { filename: "seance.ics", content: btoa(binary) };
}

async function notifyConfirmed(env, portfolio, photographer, booking) {
  const params = emailParams(env, portfolio, photographer, booking);
  await sendBookingConfirmation(env, { ...params, to: booking.client_email, replyTo: photographer?.email, attachment: icsAttachment(booking, params.studioName) });
  await sendBookingPhotographerNotice(env, { ...params, to: photographer?.email, replyTo: booking.client_email, attachment: icsAttachment(booking, booking.client_name) });
}

/* ---------- Rappel la veille (déclencheur planifié) ---------- */

export async function runBookingReminders(env) {
  const ts = now();
  const { results } = await env.DB.prepare(
    `SELECT * FROM bookings WHERE status = 'confirmed' AND reminded_at IS NULL AND starts_at > ? AND starts_at < ? LIMIT 50`
  ).bind(ts + 20 * 3600, ts + 48 * 3600).all();
  let sent = 0;
  for (const booking of results || []) {
    // Marqué d'abord : un e-mail en double vaut moins bien qu'un rappel manqué.
    const claim = await env.DB.prepare("UPDATE bookings SET reminded_at = ? WHERE id = ? AND reminded_at IS NULL").bind(ts, booking.id).run();
    if (!claim.meta?.changes) continue;
    const photographer = await photographerById(env, booking.photographer_id);
    const portfolio = await env.DB.prepare("SELECT * FROM portfolios WHERE photographer_id = ?").bind(booking.photographer_id).first();
    await sendBookingReminder(env, { ...emailParams(env, portfolio, photographer, booking), to: booking.client_email, replyTo: photographer?.email });
    sent++;
  }
  return sent;
}

/* ---------- Photographe : /api/admin/booking[/…] ---------- */

function readOffer(body) {
  const title = cleanLine(body.title, 80);
  const durationMin = Math.round(Number(body.durationMin));
  const priceCents = Math.round(Number(body.priceCents) || 0);
  const depositCents = Math.round(Number(body.depositCents) || 0);
  if (!title) return { error: "Donnez un nom à la formule" };
  if (!(durationMin >= 5 && durationMin <= 720)) return { error: "Durée invalide (5 minutes à 12 heures)" };
  if (priceCents < 0 || priceCents > 1000000) return { error: "Prix invalide" };
  if (depositCents < 0 || depositCents > 1000000) return { error: "Acompte invalide" };
  if (depositCents > 0 && depositCents < 100) return { error: "L'acompte en ligne est d'au moins 1 €" };
  if (priceCents && depositCents > priceCents) return { error: "L'acompte ne peut pas dépasser le prix de la séance" };
  return {
    offer: {
      title,
      description: cleanText(body.description, 1000),
      durationMin,
      priceCents,
      depositCents,
      location: cleanLine(body.location, 160),
      active: body.active === undefined ? 1 : (body.active ? 1 : 0),
    },
  };
}

function bookingAdminOut(b) {
  return {
    ...reservationOut(b),
    slotId: b.slot_id,
    offerId: b.offer_id,
    feeCents: b.fee_cents,
    clientName: b.client_name,
    clientEmail: b.client_email,
    clientPhone: b.client_phone,
    message: b.message,
    paidAt: b.paid_at,
    cancelledAt: b.cancelled_at,
    createdAt: b.created_at,
  };
}

async function bookingForAdmin(env, photographer) {
  await expireHolds(env, photographer.id);
  const ts = now();
  const [{ results: offers }, { results: slots }, { results: bookings }, portfolio] = await Promise.all([
    env.DB.prepare("SELECT * FROM booking_offers WHERE photographer_id = ? ORDER BY position ASC, created_at ASC").bind(photographer.id).all(),
    env.DB.prepare(
      `SELECT s.id, s.offer_id, s.starts_at,
              (SELECT b.id FROM bookings b WHERE b.slot_id = s.id AND b.status IN ('pending', 'confirmed') LIMIT 1) AS booking_id
         FROM booking_slots s WHERE s.photographer_id = ? AND s.starts_at > ? ORDER BY s.starts_at ASC LIMIT 500`
    ).bind(photographer.id, ts - 86400).all(),
    env.DB.prepare(
      `SELECT * FROM bookings WHERE photographer_id = ? AND status IN ('pending', 'confirmed', 'cancelled', 'conflict') AND starts_at > ?
        ORDER BY starts_at ASC LIMIT 300`
    ).bind(photographer.id, ts - 60 * 86400).all(),
    env.DB.prepare("SELECT handle, published FROM portfolios WHERE photographer_id = ?").bind(photographer.id).first(),
  ]);
  return {
    enabled: hasFeature(env, photographer, "booking"),
    stripeReady: stripeReady(photographer),
    portfolio: {
      handle: portfolio?.handle || "",
      published: Boolean(portfolio?.published),
      // Page publique : l'adresse du studio quand il en a une, sinon le site.
      url: portfolio?.handle ? (() => { const u = portfolioUrls(env, photographer, portfolio.handle); return (u.studio || u.site) + "#reserver"; })() : "",
    },
    offers: (offers || []).map(offerOut),
    slots: (slots || []).map((s) => ({ id: s.id, offerId: s.offer_id, startsAt: s.starts_at, bookingId: s.booking_id || "" })),
    bookings: (bookings || []).map(bookingAdminOut),
  };
}

export async function handleBookingAdmin(request, env, photographer, parts) {
  // parts : ce qui suit /api/admin/booking
  const method = request.method;
  if (!parts.length && method === "GET") return json(await bookingForAdmin(env, photographer));
  if (!hasFeature(env, photographer, "booking")) return featureRefusal("booking");
  const body = method === "POST" ? await request.json().catch(() => ({})) : {};
  const ts = now();

  // Formules de séance.
  if (parts[0] === "offers" && parts.length === 1 && method === "POST") {
    const { offer, error } = readOffer(body);
    if (error) return fail(400, error);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM booking_offers WHERE photographer_id = ?").bind(photographer.id).first();
    if ((count?.n || 0) >= 30) return fail(409, "30 formules au maximum");
    const id = newId("bko");
    await env.DB.prepare(
      `INSERT INTO booking_offers (id, photographer_id, title, description, duration_min, price_cents, deposit_cents, location, active, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, photographer.id, offer.title, offer.description, offer.durationMin, offer.priceCents, offer.depositCents, offer.location, offer.active, count?.n || 0, ts).run();
    return json({ ...(await bookingForAdmin(env, photographer)), createdOfferId: id }, { status: 201 });
  }
  if (parts[0] === "offers" && parts[1] && parts.length === 2) {
    const id = decodeURIComponent(parts[1]);
    const existing = await env.DB.prepare("SELECT * FROM booking_offers WHERE id = ? AND photographer_id = ?").bind(id, photographer.id).first();
    if (!existing) return fail(404, "Formule introuvable");
    if (method === "POST") {
      const { offer, error } = readOffer({ ...offerOut(existing), ...body });
      if (error) return fail(400, error);
      await env.DB.prepare(
        `UPDATE booking_offers SET title = ?, description = ?, duration_min = ?, price_cents = ?, deposit_cents = ?, location = ?, active = ?
          WHERE id = ?`
      ).bind(offer.title, offer.description, offer.durationMin, offer.priceCents, offer.depositCents, offer.location, offer.active, id).run();
      return json(await bookingForAdmin(env, photographer));
    }
    if (method === "DELETE") {
      await expireHolds(env, photographer.id);
      const active = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM bookings WHERE offer_id = ? AND status IN ('pending', 'confirmed') AND starts_at > ?"
      ).bind(id, ts).first();
      if (active?.n) return fail(409, "Des séances à venir sont réservées sur cette formule : annulez-les d'abord, ou désactivez simplement la formule.");
      await env.DB.prepare("DELETE FROM booking_offers WHERE id = ?").bind(id).run();
      return json(await bookingForAdmin(env, photographer));
    }
  }

  // Créneaux : une date et une ou plusieurs heures, ou une série.
  if (parts[0] === "slots" && parts.length === 1 && method === "POST") {
    const offer = await env.DB.prepare("SELECT * FROM booking_offers WHERE id = ? AND photographer_id = ?")
      .bind(String(body.offerId || ""), photographer.id)
      .first();
    if (!offer) return fail(404, "Formule introuvable");
    const dates = (Array.isArray(body.dates) ? body.dates : [body.date]).map((d) => String(d || "")).filter(Boolean).slice(0, 31);
    const times = body.from
      ? seriesTimes(body.from, body.to, body.every || offer.duration_min, offer.duration_min)
      : (Array.isArray(body.times) ? body.times : [body.time]).map((t) => String(t || "")).filter(Boolean);
    if (!dates.length) return fail(400, "Choisissez une date");
    if (!times.length) return fail(400, body.from ? "Aucun créneau ne tient dans cette plage horaire" : "Indiquez une heure");
    const starts = [];
    for (const date of dates) {
      for (const time of times) {
        const at = localToEpoch(date, time);
        if (at === null) return fail(400, `Date ou heure invalide (${date} ${time})`);
        if (at <= ts) return fail(400, "Ce créneau est déjà passé");
        if (at > ts + MAX_AHEAD_SECONDS) return fail(400, "Les créneaux s'ouvrent au plus un an à l'avance");
        starts.push(at);
      }
    }
    if (starts.length > MAX_SLOTS_PER_REQUEST) return fail(400, `${MAX_SLOTS_PER_REQUEST} créneaux au maximum à la fois`);
    // Les horaires déjà ouverts pour cette formule ne sont pas recréés.
    const { results: existing } = await env.DB.prepare("SELECT starts_at FROM booking_slots WHERE offer_id = ?").bind(offer.id).all();
    const taken = new Set((existing || []).map((s) => s.starts_at));
    const fresh = [...new Set(starts)].filter((at) => !taken.has(at));
    if (fresh.length) {
      await env.DB.batch(fresh.map((at) =>
        env.DB.prepare("INSERT INTO booking_slots (id, photographer_id, offer_id, starts_at, created_at) VALUES (?, ?, ?, ?, ?)")
          .bind(newId("bks"), photographer.id, offer.id, at, ts)
      ));
    }
    return json({ ...(await bookingForAdmin(env, photographer)), created: fresh.length, skipped: starts.length - fresh.length }, { status: 201 });
  }
  if (parts[0] === "slots" && parts[1] && parts.length === 2 && method === "DELETE") {
    const id = decodeURIComponent(parts[1]);
    await expireHolds(env, photographer.id);
    const busy = await env.DB.prepare("SELECT id FROM bookings WHERE slot_id = ? AND status IN ('pending', 'confirmed')").bind(id).first();
    if (busy) return fail(409, "Ce créneau est réservé : annulez d'abord la réservation.");
    const result = await env.DB.prepare("DELETE FROM booking_slots WHERE id = ? AND photographer_id = ?").bind(id, photographer.id).run();
    if (!result.meta?.changes) return fail(404, "Créneau introuvable");
    return json(await bookingForAdmin(env, photographer));
  }

  // Annulation par le photographe : le créneau redevient libre, le client
  // est prévenu. L'acompte se rembourse depuis Stripe (paiements).
  if (parts[0] === "bookings" && parts[1] && parts[2] === "cancel" && parts.length === 3 && method === "POST") {
    const id = decodeURIComponent(parts[1]);
    const booking = await env.DB.prepare("SELECT * FROM bookings WHERE id = ? AND photographer_id = ?").bind(id, photographer.id).first();
    if (!booking) return fail(404, "Réservation introuvable");
    if (!["confirmed", "pending", "conflict"].includes(booking.status)) return fail(409, "Cette réservation n'est plus active");
    await env.DB.prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE id = ?").bind(ts, id).run();
    if (booking.status !== "pending") {
      const portfolio = await env.DB.prepare("SELECT * FROM portfolios WHERE photographer_id = ?").bind(photographer.id).first();
      const params = emailParams(env, portfolio, photographer, booking);
      await sendBookingCancelled(env, {
        ...params,
        to: booking.client_email,
        replyTo: photographer.email,
        note: cleanText(body.message, 1000),
        attachment: icsAttachment(booking, params.studioName, true),
      });
    }
    return json(await bookingForAdmin(env, photographer));
  }

  return fail(404, "Route inconnue");
}
