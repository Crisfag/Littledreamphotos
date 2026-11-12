// Textes d'accompagnement enregistrés : le photographe écrit une fois son
// texte (« Merci pour cette séance de Noël… »), le garde, et le retrouve
// dans un menu déroulant pour ses galeries suivantes, au lieu de le
// copier-coller à chaque fois. Propres à chaque photographe.

import { json, fail } from "./http.js";
import { randomBytes, b64url } from "./auth.js";

const MAX_TEXTS = 50;
const MAX_BODY = 600;   // comme le texte d'accompagnement d'une galerie
const MAX_LABEL = 60;

const now = () => Math.floor(Date.now() / 1000);

// Nom par défaut : le début du texte.
export function defaultLabel(body) {
  const flat = String(body || "").replace(/\s+/g, " ").trim();
  return flat.length > 45 ? flat.slice(0, 44).replace(/\s+\S*$/, "") + "…" : flat;
}

function out(row) {
  return { id: row.id, label: row.label, body: row.body };
}

export async function listIntroTexts(env, photographerId) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM intro_texts WHERE photographer_id = ? ORDER BY used_at DESC, created_at DESC"
  ).bind(photographerId).all();
  return results.map(out);
}

// GET /api/admin/intro-texts
export async function getIntroTexts(env, photographerId) {
  return json({ texts: await listIntroTexts(env, photographerId) });
}

// POST /api/admin/intro-texts { body, label? } — le même texte déjà
// enregistré n'est pas doublé (seul son nom est mis à jour s'il en a un).
export async function saveIntroText(request, env, photographerId) {
  let payload;
  try { payload = await request.json(); } catch { return fail(400, "Requête invalide"); }
  const body = String(payload?.body || "").trim().slice(0, MAX_BODY);
  if (!body) return fail(400, "Écrivez d'abord le texte à enregistrer");
  const label = String(payload?.label || "").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL) || defaultLabel(body);
  const ts = now();

  const existing = await env.DB.prepare("SELECT * FROM intro_texts WHERE photographer_id = ? AND body = ?")
    .bind(photographerId, body).first();
  if (existing) {
    const newLabel = String(payload?.label || "").trim() ? label : existing.label;
    await env.DB.prepare("UPDATE intro_texts SET label = ?, used_at = ? WHERE id = ?").bind(newLabel, ts, existing.id).run();
    return json({ text: { id: existing.id, label: newLabel, body }, texts: await listIntroTexts(env, photographerId) });
  }
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM intro_texts WHERE photographer_id = ?").bind(photographerId).first();
  if ((count?.n || 0) >= MAX_TEXTS) return fail(400, `${MAX_TEXTS} textes enregistrés au maximum : supprimez-en un d'abord`);
  const id = `itx_${b64url(randomBytes(9))}`;
  await env.DB.prepare(
    "INSERT INTO intro_texts (id, photographer_id, label, body, created_at, used_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, photographerId, label, body, ts, ts).run();
  return json({ text: { id, label, body }, texts: await listIntroTexts(env, photographerId) }, { status: 201 });
}

// POST /api/admin/intro-texts/:id/used — choisi dans le menu : remonte en
// tête de liste (les textes du moment d'abord).
export async function touchIntroText(env, photographerId, id) {
  const result = await env.DB.prepare("UPDATE intro_texts SET used_at = ? WHERE id = ? AND photographer_id = ?")
    .bind(now(), id, photographerId).run();
  if (!(result.meta && result.meta.changes > 0)) return fail(404, "Texte introuvable");
  return json({ ok: true });
}

// DELETE /api/admin/intro-texts/:id — retiré du menu ; les galeries qui
// l'utilisent gardent leur texte.
export async function deleteIntroText(env, photographerId, id) {
  const result = await env.DB.prepare("DELETE FROM intro_texts WHERE id = ? AND photographer_id = ?").bind(id, photographerId).run();
  if (!(result.meta && result.meta.changes > 0)) return fail(404, "Texte introuvable");
  return json({ ok: true, texts: await listIntroTexts(env, photographerId) });
}
