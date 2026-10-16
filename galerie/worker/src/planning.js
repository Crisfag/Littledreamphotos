// Planning du photographe : tout ce qui a une date ou une action à faire,
// au même endroit.
//
// - Agenda : séances réservées (confirmées), dates à retenir des clients
//   (anniversaires, étapes d'un bébé…), temps forts du studio, rendez-vous
//   ajoutés à la main.
// - À faire : sélections reçues à retoucher, séances passées sans galerie,
//   clients à recontacter (le rappel d'une date est arrivé), tâches perso.
//
// Rien n'est recopié : tout est relu à chaque affichage depuis les tables
// d'origine (bookings, galleries, client_dates…). Seules les tâches perso
// (planning_items) et les tâches calculées marquées « faites »
// (planning_done) sont propres au planning. Les expirations de galerie n'y
// figurent pas, à dessein.

import { json, fail } from "./http.js";
import { randomBytes, b64url } from "./auth.js";
import { collect, dateOut, messageFor, bookingPageUrl, mailtoUrl, todayIn, addDays } from "./clients.js";
import { displayName } from "./portfolio.js";

const HORIZON_DAYS = 120; // agenda : jusqu'à quatre mois devant
const PAST_BOOKING_DAYS = 30; // « créer la galerie » : séances du dernier mois
const MAX_ITEMS = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_ZONE = "Europe/Brussels";

function now() {
  return Math.floor(Date.now() / 1000);
}

// Jour (AAAA-MM-JJ) d'un instant, à l'heure du studio.
function dayOf(ts) {
  return new Date(ts * 1000).toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

function clean(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/* ---------- Lecture ---------- */

export async function planningFor(env, photographer) {
  const today = todayIn();
  const horizon = addDays(today, HORIZON_DAYS);
  const ts = now();
  const [all, bookingUrl, bookingsRes, galleriesRes, itemsRes, doneRes] = await Promise.all([
    collect(env, photographer.id),
    bookingPageUrl(env, photographer),
    env.DB.prepare(
      `SELECT id, offer_title, location, starts_at, duration_min, deposit_cents, paid_at, photos, tier_label,
              client_name, client_email, client_phone, message
         FROM bookings WHERE photographer_id = ? AND status = 'confirmed' AND starts_at >= ? ORDER BY starts_at ASC`
    ).bind(photographer.id, ts - PAST_BOOKING_DAYS * 86400).all(),
    env.DB.prepare(
      `SELECT g.id, g.slug, g.title, g.client_name, g.client_email, g.created_at, g.selection_done_at, g.delivery_open,
              (SELECT COUNT(*) FROM photos p WHERE p.gallery_id = g.id AND p.selected = 1) AS selected_count
         FROM galleries g WHERE g.photographer_id = ? AND g.kind != 'school' AND g.demo = 0`
    ).bind(photographer.id).all(),
    env.DB.prepare("SELECT * FROM planning_items WHERE photographer_id = ? ORDER BY created_at ASC").bind(photographer.id).all(),
    env.DB.prepare("SELECT item_key FROM planning_done WHERE photographer_id = ?").bind(photographer.id).all(),
  ]);
  const studioName = displayName(photographer);
  const done = new Set((doneRes.results || []).map((r) => r.item_key));
  const galleries = galleriesRes.results || [];
  const events = [];
  const tasks = [];

  // Séances réservées à venir (confirmées : acompte réglé ou sans acompte).
  for (const b of bookingsRes.results || []) {
    if (b.starts_at < ts - 3600) continue; // passées : voir « créer la galerie »
    events.push({
      id: `bkg:${b.id}`, type: "booking", date: dayOf(b.starts_at), startsAt: b.starts_at,
      title: b.offer_title, durationMin: b.duration_min, location: b.location,
      depositCents: b.deposit_cents, depositPaid: Boolean(b.paid_at),
      tier: b.tier_label || (b.photos ? `${b.photos} photos` : ""),
      clientName: b.client_name, clientEmail: b.client_email, clientPhone: b.client_phone, message: b.message,
    });
  }

  // Dates à retenir des clients, et ce qu'elles demandent de faire.
  for (const c of all) {
    for (const d of c.dates) {
      const out = dateOut(d, today);
      if (!out.next || out.next.date > horizon) continue;
      const message = messageFor(d, out.next, c.name, studioName, bookingUrl);
      const base = {
        kind: d.kind, label: d.label, years: out.next.years, months: out.next.months,
        title: out.next.title, remindOn: out.next.remindOn, daysUntil: out.next.daysUntil,
        clientName: c.name || c.email, clientEmail: c.email, mailto: mailtoUrl(c.email, message),
      };
      events.push({ id: `cld:${d.id}`, type: "reminder", date: out.next.date, ...base });
      // Le jour du rappel est passé : écrire au client, jusqu'à la date.
      const key = `cld:${d.id}:${out.next.date}`;
      if (d.remind && out.next.remindOn <= today && !done.has(key)) {
        tasks.push({ key, type: "contact", date: out.next.date, since: out.next.remindOn, ...base });
      }
    }
  }
  // Temps forts du studio (séances de Noël…), à proposer à tous.
  for (const d of all.studio || []) {
    const out = dateOut(d, today);
    if (!out.next || out.next.date > horizon) continue;
    events.push({
      id: `cld:${d.id}`, type: "season", date: out.next.date, kind: d.kind, label: d.label,
      title: out.next.title, remindOn: out.next.remindOn, daysUntil: out.next.daysUntil,
    });
  }

  // Sélection reçue : à retoucher puis livrer. Faite d'elle-même quand la
  // livraison HD est ouverte, ou d'un clic.
  for (const g of galleries) {
    if (!g.selection_done_at || g.delivery_open) continue;
    const key = `sel:${g.id}`;
    if (done.has(key)) continue;
    tasks.push({
      key, type: "selection", since: dayOf(g.selection_done_at), at: g.selection_done_at,
      title: g.title, slug: g.slug, selectedCount: g.selected_count,
      clientName: g.client_name, clientEmail: g.client_email,
    });
  }

  // Séance passée (dernier mois) sans galerie créée depuis pour ce client.
  for (const b of bookingsRes.results || []) {
    if (b.starts_at > ts) continue;
    const key = `gal:${b.id}`;
    if (done.has(key)) continue;
    const email = String(b.client_email || "").toLowerCase();
    const hasGallery = galleries.some((g) => String(g.client_email || "").toLowerCase() === email && g.created_at >= b.starts_at - 86400);
    if (hasGallery) continue;
    tasks.push({
      key, type: "gallery", since: dayOf(b.starts_at), at: b.starts_at,
      title: b.offer_title, clientName: b.client_name, clientEmail: b.client_email,
    });
  }

  // Tâches et rendez-vous ajoutés à la main.
  for (const item of itemsRes.results || []) {
    const out = {
      key: `itm:${item.id}`, id: item.id, type: "item", title: item.title,
      date: item.date || "", time: item.time || "", note: item.note || "",
      clientEmail: item.client_email || "", clientName: clientNameFor(all, item.client_email),
      done: Boolean(item.done_at), doneAt: item.done_at,
    };
    // Daté et pas encore passé : à l'agenda ; sinon (ou en retard) : à faire.
    if (out.date && out.date >= today && out.date <= horizon) events.push({ ...out, id: out.key });
    if (!out.done && (!out.date || out.date <= today)) tasks.push(out);
    if (out.done && out.doneAt > ts - 7 * 86400) tasks.push(out); // faites récemment : visibles une semaine
  }

  events.sort((a, b) => (a.date === b.date ? (a.startsAt || timeRank(a.time)) - (b.startsAt || timeRank(b.time)) : a.date < b.date ? -1 : 1));
  tasks.sort((a, b) => Number(Boolean(a.done)) - Number(Boolean(b.done)) || String(a.since || a.date || "9").localeCompare(String(b.since || b.date || "9")));

  // Clients connus, pour rattacher une tâche à une fiche.
  const clients = all.map((c) => ({ email: c.email, name: c.name || "" })).sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).slice(0, 1000);
  return { today, horizon, events, tasks, clients, counts: { todo: tasks.filter((t) => !t.done).length }, bookingUrl };
}

function timeRank(time) {
  return time ? Number(time.replace(":", "")) : 0;
}

function clientNameFor(all, email) {
  const key = String(email || "").toLowerCase();
  if (!key) return "";
  const c = all.find((x) => x.email === key);
  return c ? c.name || c.email : key;
}

/* ---------- Écriture ---------- */

function readItem(body, partial) {
  const out = {};
  if (!partial || body.title !== undefined) {
    out.title = clean(body.title, 160);
    if (!out.title) return { error: "Le libellé est requis" };
  }
  if (!partial || body.date !== undefined) {
    out.date = clean(body.date, 10);
    if (out.date && !DATE_RE.test(out.date)) return { error: "Date illisible" };
  }
  if (!partial || body.time !== undefined) {
    out.time = clean(body.time, 5);
    if (out.time && !TIME_RE.test(out.time)) return { error: "Heure illisible" };
  }
  if (!partial || body.note !== undefined) out.note = String(body.note ?? "").trim().slice(0, 1000);
  if (!partial || body.clientEmail !== undefined) {
    out.client_email = clean(body.clientEmail, 200).toLowerCase();
    if (out.client_email && !EMAIL_RE.test(out.client_email)) return { error: "Adresse e-mail invalide" };
  }
  if (out.time && out.date === "") return { error: "Une heure demande une date" };
  return { item: out };
}

// /api/admin/planning[/…]
export async function handlePlanningAdmin(request, env, photographer, parts) {
  const method = request.method;
  if (parts.length === 0 && method === "GET") return json(await planningFor(env, photographer));

  const body = method === "POST" ? await request.json().catch(() => null) : null;

  // Tâches et rendez-vous perso.
  if (parts[0] === "items" && parts.length === 1 && method === "POST") {
    if (!body) return fail(400, "Requête invalide");
    const read = readItem(body, false);
    if (read.error) return fail(400, read.error);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM planning_items WHERE photographer_id = ?").bind(photographer.id).first();
    if ((count?.n || 0) >= MAX_ITEMS) return fail(400, `Au plus ${MAX_ITEMS} tâches : supprimez les anciennes`);
    const id = `pli_${b64url(randomBytes(9))}`;
    const it = read.item;
    await env.DB.prepare(
      "INSERT INTO planning_items (id, photographer_id, title, date, time, note, client_email, done_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)"
    ).bind(id, photographer.id, it.title, it.date, it.time, it.note, it.client_email, now()).run();
    return json({ ok: true, id }, { status: 201 });
  }
  if (parts[0] === "items" && parts.length === 2) {
    const item = await env.DB.prepare("SELECT * FROM planning_items WHERE id = ? AND photographer_id = ?").bind(parts[1], photographer.id).first();
    if (!item) return fail(404, "Tâche introuvable");
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM planning_items WHERE id = ?").bind(item.id).run();
      return json({ ok: true });
    }
    if (method === "POST") {
      if (!body) return fail(400, "Requête invalide");
      const read = readItem({ date: item.date, ...body }, true);
      if (read.error) return fail(400, read.error);
      const fields = { ...read.item };
      if (body.done !== undefined) fields.done_at = body.done === true ? now() : null;
      const keys = Object.keys(fields);
      if (!keys.length) return json({ ok: true });
      await env.DB.prepare(`UPDATE planning_items SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
        .bind(...keys.map((k) => fields[k]), item.id).run();
      return json({ ok: true });
    }
  }

  // Tâche calculée (sélection, galerie, client à recontacter) : faite ou non.
  if (parts[0] === "done" && parts.length === 1 && method === "POST") {
    const key = clean(body?.key, 120);
    if (!/^(sel|gal|cld):[A-Za-z0-9_:-]+$/.test(key)) return fail(400, "Tâche inconnue");
    if (body.done === false) {
      await env.DB.prepare("DELETE FROM planning_done WHERE photographer_id = ? AND item_key = ?").bind(photographer.id, key).run();
    } else {
      await env.DB.prepare("INSERT OR IGNORE INTO planning_done (photographer_id, item_key, done_at) VALUES (?, ?, ?)")
        .bind(photographer.id, key, now()).run();
    }
    return json({ ok: true });
  }

  return fail(404, "Route inconnue");
}
