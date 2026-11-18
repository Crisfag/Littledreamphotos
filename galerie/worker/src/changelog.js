// Nouveautés de la plateforme : ce qui a été ajouté ou amélioré, date par
// date, affiché en tête de l'onglet Suggestions de l'espace photographe
// (pastille tant qu'il ne les a pas vues). Publiées par le propriétaire
// depuis l'onglet Admin ; une suggestion réalisée peut y être reliée, et son
// auteur crédité (« Suggestion de Studio Lumière », « Votre suggestion »).
//
//   newsFor(env, photographer)          entrées, non vues (onglet Suggestions)
//   markNewsSeen(env, photographerId)   l'onglet a été ouvert
//   /api/owner/changelog          GET liste · POST publier (propriétaire)
//   /api/owner/changelog/:id      POST modifier · DELETE retirer

import { json, fail } from "./http.js";
import { randomBytes, b64url } from "./auth.js";
import { cleanLine, cleanText, displayName } from "./portfolio.js";

export const CHANGELOG_KINDS = ["feature", "improvement", "shortcut", "fix"];
const LANGS = ["fr", "en", "nl"];
const HISTORY_DAYS = 400;

function now() {
  return Math.floor(Date.now() / 1000);
}

function entryOut(row, viewerId) {
  return {
    id: row.id,
    publishedAt: row.published_at,
    kind: row.kind,
    title: { fr: row.title_fr, en: row.title_en, nl: row.title_nl },
    body: { fr: row.body_fr, en: row.body_en, nl: row.body_nl },
    link: row.link,
    feedbackId: row.feedback_id,
    credit: row.credit === 1,
    // Auteur de la suggestion : nommé seulement si le propriétaire l'a choisi ;
    // l'auteur, lui, voit toujours que c'est la sienne.
    suggestedBy: row.feedback_id && row.credit === 1 && row.author_id ? displayName({ studio_name: row.author_studio, first_name: row.author_first, last_name: row.author_last }) : "",
    mine: Boolean(viewerId && row.author_id === viewerId),
  };
}

const SELECT = `SELECT c.*, f.photographer_id AS author_id, p.studio_name AS author_studio, p.first_name AS author_first, p.last_name AS author_last
  FROM changelog c LEFT JOIN feedback f ON f.id = c.feedback_id AND c.feedback_id != '' LEFT JOIN photographers p ON p.id = f.photographer_id`;

// Nouveautés pour un photographe. Non vues : publiées depuis sa dernière
// visite (et, pour un compte neuf, depuis son inscription).
export async function newsFor(env, photographer) {
  const ts = now();
  const { results } = await env.DB.prepare(`${SELECT} WHERE c.published_at <= ? AND c.published_at > ? ORDER BY c.published_at DESC LIMIT 120`)
    .bind(ts, ts - HISTORY_DAYS * 86400).all();
  const since = Math.max(photographer.changelog_seen_at || 0, photographer.created_at || 0);
  const entries = (results || []).map((r) => entryOut(r, photographer.id));
  return { entries, unseen: entries.filter((e) => e.publishedAt > since).length, seenAt: since };
}

export async function markNewsSeen(env, photographerId) {
  await env.DB.prepare("UPDATE photographers SET changelog_seen_at = ? WHERE id = ?").bind(now(), photographerId).run();
}

/* ---------- Propriétaire ---------- */

function readEntry(body) {
  const b = body && typeof body === "object" ? body : {};
  const title = {}, text = {};
  for (const l of LANGS) {
    title[l] = cleanLine(b.title?.[l], 120);
    text[l] = cleanText(b.body?.[l], 2000);
  }
  if (!title.fr) return { error: "Donnez un titre (en français)" };
  const kind = CHANGELOG_KINDS.includes(b.kind) ? b.kind : "feature";
  const link = String(b.link || "").trim();
  if (link && !/^#\/[a-z0-9/_-]*$/i.test(link)) return { error: "Lien : un écran de l'espace photographe, ex. #/relances" };
  let publishedAt = now();
  if (b.date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(b.date));
    if (!m) return { error: "Date invalide" };
    publishedAt = Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 10) / 1000);
    // Une date du jour ou passée paraît tout de suite ; une date future attend.
    if (publishedAt > now() + 400 * 86400) return { error: "Date trop lointaine" };
  }
  return { entry: { title, text, kind, link: link.slice(0, 80), publishedAt, feedbackId: String(b.feedbackId || "").slice(0, 40), credit: b.credit === false ? 0 : 1 } };
}

async function listForOwner(env) {
  const { results } = await env.DB.prepare(`${SELECT} ORDER BY c.published_at DESC LIMIT 300`).all();
  return { entries: (results || []).map((r) => ({ ...entryOut(r, ""), suggestedBy: r.author_id ? displayName({ studio_name: r.author_studio, first_name: r.author_first, last_name: r.author_last }) : "" })) };
}

export async function handleChangelogOwner(request, env, parts) {
  // parts : ce qui suit /api/owner/changelog
  const method = request.method;
  if (!parts.length && method === "GET") return json(await listForOwner(env));
  if (!parts.length && method === "POST") {
    const read = readEntry(await request.json().catch(() => null));
    if (read.error) return fail(400, read.error);
    const e = read.entry;
    if (e.feedbackId) {
      const fb = await env.DB.prepare("SELECT id FROM feedback WHERE id = ?").bind(e.feedbackId).first();
      if (!fb) return fail(404, "Suggestion introuvable");
      // Annoncée dans les nouveautés : la suggestion passe en « Réalisée ».
      await env.DB.prepare("UPDATE feedback SET status = 'done', updated_at = ? WHERE id = ? AND status != 'done'").bind(now(), e.feedbackId).run();
    }
    const ts = now();
    await env.DB.prepare(
      `INSERT INTO changelog (id, published_at, kind, title_fr, body_fr, title_en, body_en, title_nl, body_nl, link, feedback_id, credit, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(`chg_${b64url(randomBytes(9))}`, e.publishedAt, e.kind, e.title.fr, e.text.fr, e.title.en, e.text.en, e.title.nl, e.text.nl, e.link, e.feedbackId, e.credit, ts, ts).run();
    return json(await listForOwner(env), { status: 201 });
  }
  const id = decodeURIComponent(parts[0] || "");
  const row = await env.DB.prepare("SELECT id FROM changelog WHERE id = ?").bind(id).first();
  if (!row) return fail(404, "Nouveauté introuvable");
  if (parts.length === 1 && method === "DELETE") {
    await env.DB.prepare("DELETE FROM changelog WHERE id = ?").bind(id).run();
    return json(await listForOwner(env));
  }
  if (parts.length === 1 && method === "POST") {
    const read = readEntry(await request.json().catch(() => null));
    if (read.error) return fail(400, read.error);
    const e = read.entry;
    await env.DB.prepare(
      `UPDATE changelog SET published_at = ?, kind = ?, title_fr = ?, body_fr = ?, title_en = ?, body_en = ?, title_nl = ?, body_nl = ?, link = ?, feedback_id = ?, credit = ?, updated_at = ? WHERE id = ?`
    ).bind(e.publishedAt, e.kind, e.title.fr, e.text.fr, e.title.en, e.text.en, e.title.nl, e.text.nl, e.link, e.feedbackId, e.credit, now(), id).run();
    return json(await listForOwner(env));
  }
  return fail(404, "Route inconnue");
}
