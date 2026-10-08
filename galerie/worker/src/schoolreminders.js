// Rappels de commande aux familles (module scolaire).
//
// Une famille qui a ouvert son espace (e-mail + code de la fiche) mais n'a
// encore rien payé pour l'année reçoit un rappel 7 jours puis 2 jours avant
// la date de commande groupée, et un dernier 2 jours avant la fin de la
// commande à domicile (si le photographe l'a fixée). Jamais deux fois le
// même rappel (table school_reminders), jamais à une famille qui a demandé à
// ne plus en recevoir, jamais si le photographe a coupé les rappels de
// l'année. Les familles qui n'ont pas encore ouvert leur espace ne sont pas
// connues : la fiche papier reste le premier rappel.
//
// Envoi par petits paquets (REMINDERS_PER_RUN), au déclencheur planifié des
// heures de journée (SCHOOL_REMINDERS_CRON, wrangler.toml) : une grande école
// part en quelques passages, jamais la nuit.

import { json, fail } from "./http.js";
import { signFor, verifySignature } from "./prodigi.js";
import { sendSchoolReminder } from "./notify.js";

export const SCHOOL_REMINDERS_CRON = "*/30 7-18 * * *";
export const REMINDERS_PER_RUN = 20;
const DAY = 86400;

function now() {
  return Math.floor(Date.now() / 1000);
}

// Le rappel dû aujourd'hui pour une année, ou null. Un seul à la fois : à
// 2 jours de l'échéance, c'est le dernier rappel, jamais les deux.
export function reminderKindFor(year, at = now()) {
  if (!year || year.status !== "open" || !Number(year.family_reminders)) return null;
  if (year.order_deadline && at <= year.order_deadline) {
    const days = Math.ceil((year.order_deadline - at) / DAY);
    if (days <= 2) return "j2";
    if (days <= 7) return "j7";
    return null;
  }
  if (year.late_deadline && at <= year.late_deadline) {
    return Math.ceil((year.late_deadline - at) / DAY) <= 2 ? "late2" : null;
  }
  return null;
}

/* ---------- Désinscription ---------- */

export async function stopToken(env, familyId) {
  return `${familyId}.${await signFor(env.AUTH_SECRET, `family-stop:${familyId}`)}`;
}

// POST /api/family/unsubscribe { token } — lien « ne plus recevoir de
// rappels » des e-mails, sans connexion (le jeton signé suffit).
export async function unsubscribeFamily(request, env) {
  const body = await request.json().catch(() => null);
  const [familyId, signature] = String(body?.token || "").split(".");
  if (!familyId || !(await verifySignature(env.AUTH_SECRET, `family-stop:${familyId}`, signature))) {
    return fail(400, "Lien de désinscription invalide");
  }
  await env.DB.prepare("UPDATE families SET reminders_off = 1 WHERE id = ?").bind(familyId).run();
  return json({ ok: true });
}

/* ---------- Passage planifié ---------- */

export async function runSchoolReminders(env, at = now(), limit = REMINDERS_PER_RUN) {
  const { results: years } = await env.DB.prepare(
    `SELECT y.*, s.name AS school_name, p.studio_name, p.email AS photographer_email
     FROM school_years y JOIN schools s ON s.id = y.school_id JOIN photographers p ON p.id = s.photographer_id
     WHERE y.status = 'open' AND y.family_reminders = 1`
  ).all();
  const origin = String(env.PUBLIC_SITE_ORIGIN || "https://www.holypixx.com").replace(/\/+$/, "");
  let sent = 0;
  for (const year of years) {
    if (sent >= limit) break;
    const kind = reminderKindFor(year, at);
    if (!kind) continue;
    const { results: families } = await env.DB.prepare(
      `SELECT f.id, f.email, GROUP_CONCAT(c.first_name, '|') AS names, COUNT(DISTINCT c.id) AS children
       FROM families f
       JOIN family_children fc ON fc.family_id = f.id
       JOIN school_children c ON c.id = fc.child_id
       JOIN school_groups g ON g.id = c.group_id
       WHERE g.year_id = ? AND f.reminders_off = 0
         AND NOT EXISTS (SELECT 1 FROM school_orders o WHERE o.year_id = ? AND o.family_id = f.id AND o.status = 'paid')
         AND NOT EXISTS (SELECT 1 FROM school_reminders r WHERE r.year_id = ? AND r.family_id = f.id AND r.kind = ?)
       GROUP BY f.id ORDER BY f.id LIMIT ?`
    ).bind(year.id, year.id, year.id, kind, limit - sent).all();
    if (!families.length) continue;
    // Noté AVANT l'envoi : un incident en route ne renvoie jamais deux fois
    // le même rappel (l'e-mail reste « au mieux », comme les autres).
    await env.DB.batch(families.map((f) =>
      env.DB.prepare("INSERT OR IGNORE INTO school_reminders (year_id, family_id, kind, sent_at) VALUES (?, ?, ?, ?)").bind(year.id, f.id, kind, at)
    ));
    for (const f of families) {
      const names = String(f.names || "").split("|").map((n) => n.trim()).filter(Boolean);
      await sendSchoolReminder(env, {
        to: f.email,
        replyTo: year.photographer_email || undefined,
        kind,
        studioName: year.studio_name || "",
        schoolName: year.school_name,
        childNames: [...new Set(names)],
        childrenCount: f.children,
        deadline: kind === "late2" ? year.late_deadline : year.order_deadline,
        familyUrl: `${origin}/ecole`,
        stopUrl: `${origin}/ecole?stop=${encodeURIComponent(await stopToken(env, f.id))}`,
      });
    }
    sent += families.length;
  }
  return { sent };
}

// Rappels envoyés pour une année (suivi du photographe).
export async function reminderStats(env, yearId) {
  const { results } = await env.DB.prepare(
    "SELECT kind, COUNT(*) AS n, MAX(sent_at) AS last FROM school_reminders WHERE year_id = ? GROUP BY kind"
  ).bind(yearId).all();
  const out = {};
  for (const r of results) out[r.kind] = { families: r.n, lastAt: r.last };
  return out;
}
