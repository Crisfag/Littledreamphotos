// Suggestions des photographes : une idée, une amélioration, une option qui
// manque, un souci — envoyées depuis l'onglet « Suggestions » de l'espace
// photographe. Le propriétaire de la plateforme (OWNER_EMAIL) est prévenu
// par e-mail, les lit toutes dans l'onglet Admin, change leur statut et y
// répond ; le photographe suit ses demandes et voit la réponse (pastille sur
// l'onglet tant qu'il ne l'a pas lue).
//
//   /api/admin/feedback            GET liste (les siennes) · POST envoyer
//   /api/admin/feedback/seen       POST réponses lues
//   /api/owner/feedback            GET toutes (propriétaire)
//   /api/owner/feedback/:id        POST { status?, reply? } (propriétaire)

import { json, fail } from "./http.js";
import { randomBytes, b64url } from "./auth.js";
import { cleanLine, cleanText, displayName } from "./portfolio.js";
import { sendFeedbackToOwner, sendFeedbackReply } from "./notify.js";

export const FEEDBACK_KINDS = ["idea", "improvement", "problem", "other"];
export const FEEDBACK_STATUSES = ["new", "considering", "planned", "done", "declined"];
const MAX_PER_DAY = 15;

function now() {
  return Math.floor(Date.now() / 1000);
}

function itemOut(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    status: row.status,
    reply: row.reply,
    repliedAt: row.replied_at,
    replyUnread: Boolean(row.reply) && !row.reply_seen,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Pure : valide une suggestion saisie par le photographe.
export function readFeedback(body) {
  const kind = FEEDBACK_KINDS.includes(body?.kind) ? body.kind : "idea";
  const title = cleanLine(body?.title, 120);
  const text = cleanText(body?.body, 4000);
  if (!title) return { error: "Donnez un titre à votre demande" };
  return { kind, title, body: text };
}

async function listOwn(env, photographerId) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM feedback WHERE photographer_id = ? ORDER BY created_at DESC LIMIT 200"
  ).bind(photographerId).all();
  const items = (results || []).map(itemOut);
  return { items, unread: items.filter((i) => i.replyUnread).length };
}

export async function handleFeedbackAdmin(request, env, photographerId, parts) {
  const method = request.method;
  if (!parts.length && method === "GET") return json(await listOwn(env, photographerId));
  if (parts[0] === "seen" && parts.length === 1 && method === "POST") {
    await env.DB.prepare("UPDATE feedback SET reply_seen = 1 WHERE photographer_id = ? AND reply_seen = 0").bind(photographerId).run();
    return json(await listOwn(env, photographerId));
  }
  if (!parts.length && method === "POST") {
    const body = await request.json().catch(() => null);
    const read = readFeedback(body);
    if (read.error) return fail(400, read.error);
    const ts = now();
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE photographer_id = ? AND created_at > ?")
      .bind(photographerId, ts - 86400).first();
    if ((recent?.n || 0) >= MAX_PER_DAY) return fail(429, "Beaucoup de demandes aujourd'hui : merci ! Les suivantes pourront partir demain.");
    const id = `fbk_${b64url(randomBytes(9))}`;
    await env.DB.prepare(
      `INSERT INTO feedback (id, photographer_id, kind, title, body, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'new', ?, ?)`
    ).bind(id, photographerId, read.kind, read.title, read.body, ts, ts).run();
    const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(photographerId).first();
    if (env.OWNER_EMAIL && photographer && photographer.email !== env.OWNER_EMAIL) {
      await sendFeedbackToOwner(env, {
        to: env.OWNER_EMAIL,
        replyTo: photographer.email,
        studioName: displayName(photographer),
        photographerEmail: photographer.email,
        kind: read.kind,
        title: read.title,
        body: read.body,
        adminUrl: env.ADMIN_URL ? `${String(env.ADMIN_URL).replace(/\/$/, "")}/#/proprietaire` : "",
      }).catch((err) => console.error("Suggestion : e-mail au propriétaire impossible :", err));
    }
    return json({ ...(await listOwn(env, photographerId)), createdId: id }, { status: 201 });
  }
  return fail(404, "Route inconnue");
}

/* ---------- Propriétaire ---------- */

export async function feedbackForOwner(env) {
  const { results } = await env.DB.prepare(
    `SELECT f.*, p.email AS photographer_email, p.studio_name, p.first_name, p.last_name, p.plan
       FROM feedback f JOIN photographers p ON p.id = f.photographer_id
      ORDER BY f.created_at DESC LIMIT 500`
  ).all();
  const items = (results || []).map((row) => ({
    ...itemOut(row),
    photographer: { email: row.photographer_email, name: displayName(row), plan: row.plan || "" },
  }));
  const counts = {};
  FEEDBACK_STATUSES.forEach((s) => { counts[s] = 0; });
  items.forEach((i) => { counts[i.status] = (counts[i.status] || 0) + 1; });
  return { items, counts };
}

export async function updateFeedbackAsOwner(request, env, id) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return fail(400, "Requête invalide");
  const row = await env.DB.prepare(
    `SELECT f.*, p.email AS photographer_email, p.studio_name, p.first_name, p.last_name, p.ui_language
       FROM feedback f JOIN photographers p ON p.id = f.photographer_id WHERE f.id = ?`
  ).bind(id).first();
  if (!row) return fail(404, "Suggestion introuvable");
  const status = body.status === undefined ? row.status : String(body.status);
  if (!FEEDBACK_STATUSES.includes(status)) return fail(400, "Statut inconnu");
  const reply = body.reply === undefined ? row.reply : cleanText(body.reply, 4000);
  const newReply = Boolean(reply) && reply !== row.reply;
  const ts = now();
  await env.DB.prepare(
    `UPDATE feedback SET status = ?, reply = ?, replied_at = ?, reply_seen = ?, updated_at = ? WHERE id = ?`
  ).bind(status, reply, newReply ? ts : row.replied_at, newReply ? 0 : row.reply_seen, ts, id).run();
  // Une nouvelle réponse part aussi par e-mail (le photographe la retrouve
  // dans son onglet Suggestions).
  if (newReply && body.notify !== false) {
    await sendFeedbackReply(env, {
      to: row.photographer_email,
      replyTo: env.OWNER_EMAIL || "",
      name: displayName(row),
      title: row.title,
      status,
      reply,
      adminUrl: env.ADMIN_URL ? `${String(env.ADMIN_URL).replace(/\/$/, "")}/#/suggestions` : "",
    }).catch((err) => console.error("Suggestion : e-mail de réponse impossible :", err));
  }
  return json(await feedbackForOwner(env));
}
