// Module photo de groupe : écoles, crèches et clubs sportifs.
//
// Organisation : un établissement (schools) se crée une fois ; chaque année
// scolaire ou saison (school_years) regroupe ses groupes (school_groups :
// classes, sections, équipes). Une nouvelle année peut reprendre les
// groupes de la précédente. Les enfants, leurs photos, les fiches parents et
// les commandes viennent se rattacher aux groupes (étapes suivantes).
//
// Accès : formules qui incluent la fonctionnalité `school` (Scolaire,
// Studio) et la propriétaire de la plateforme.

import { json, fail } from "./http.js";
import { randomBytes, b64url } from "./auth.js";
import { hasFeature, isOwner, featureRefusal, schoolLaunched } from "./subscription.js";

// Vocabulaire selon le type d'établissement (affiché tel quel par le
// tableau de bord).
export const SCHOOL_KINDS = {
  ecole: { label: "École", period: "Année scolaire", group: "Classe", groups: "Classes", leader: "Enseignant·e", groupPhoto: "Photo de classe" },
  creche: { label: "Crèche", period: "Année", group: "Section", groups: "Sections", leader: "Puériculteur·rice", groupPhoto: "Photo de section" },
  club: { label: "Club sportif", period: "Saison", group: "Équipe", groups: "Équipes", leader: "Entraîneur·e", groupPhoto: "Photo d'équipe" },
};

const YEAR_STATUSES = ["draft", "open", "closed", "archived"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const YEAR_LABEL_RE = /^\d{4}-\d{4}$/;
const MAX_GROUPS_PER_YEAR = 80;

function now() {
  return Math.floor(Date.now() / 1000);
}

function newId(prefix) {
  return `${prefix}_${b64url(randomBytes(9))}`;
}

function text(value, max) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

// Année en cours : « 2026-2027 » à partir d'août, sinon « 2025-2026 ».
export function currentYearLabel(date = new Date()) {
  const y = date.getUTCFullYear();
  return date.getUTCMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

// L'année qui suit « 2026-2027 » : « 2027-2028 ».
export function nextYearLabel(label) {
  const m = /^(\d{4})-(\d{4})$/.exec(label || "");
  return m ? `${Number(m[1]) + 1}-${Number(m[2]) + 1}` : currentYearLabel();
}

// Date limite envoyée par le tableau de bord : « 2026-10-24 » (fin de
// journée, heure belge approximée en UTC+2) ou vide.
function deadline(value) {
  if (value === null || value === undefined || value === "") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!m) return undefined;
  const ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 21, 59, 59) / 1000;
  return Number.isFinite(ts) ? ts : undefined;
}

export function schoolAccess(env, photographer) {
  const owner = isOwner(env, photographer);
  return { allowed: owner || hasFeature(env, photographer, "school"), owner, launched: schoolLaunched(env) };
}

/* ---------- Lecture ---------- */

async function schoolsOverview(env, photographerId) {
  const { results: schools } = await env.DB.prepare(
    "SELECT * FROM schools WHERE photographer_id = ? ORDER BY name COLLATE NOCASE"
  ).bind(photographerId).all();
  if (!schools.length) return [];
  const ids = schools.map((s) => s.id);
  const marks = ids.map(() => "?").join(",");
  const { results: years } = await env.DB.prepare(
    `SELECT * FROM school_years WHERE school_id IN (${marks}) ORDER BY label DESC`
  ).bind(...ids).all();
  const yearIds = years.map((y) => y.id);
  let groups = [];
  if (yearIds.length) {
    ({ results: groups } = await env.DB.prepare(
      `SELECT * FROM school_groups WHERE year_id IN (${yearIds.map(() => "?").join(",")}) ORDER BY sort, name COLLATE NOCASE`
    ).bind(...yearIds).all());
  }
  return schools.map((s) => ({
    id: s.id,
    kind: s.kind,
    name: s.name,
    address: s.address,
    contactName: s.contact_name,
    contactEmail: s.contact_email,
    contactPhone: s.contact_phone,
    createdAt: s.created_at,
    years: years.filter((y) => y.school_id === s.id).map((y) => ({
      id: y.id,
      label: y.label,
      status: y.status,
      orderDeadline: y.order_deadline,
      lateDeadline: y.late_deadline,
      createdAt: y.created_at,
      groups: groups.filter((g) => g.year_id === y.id).map((g) => ({
        id: g.id, name: g.name, leader: g.leader, sort: g.sort,
      })),
    })),
  }));
}

async function overview(env, photographer) {
  return json({
    access: schoolAccess(env, photographer),
    kinds: SCHOOL_KINDS,
    suggestedYear: currentYearLabel(),
    schools: await schoolsOverview(env, photographer.id),
  });
}

/* ---------- Établissements ---------- */

function schoolFields(body) {
  const kind = SCHOOL_KINDS[body?.kind] ? body.kind : null;
  const name = text(body?.name, 120);
  const contactEmail = text(body?.contactEmail, 200);
  if (!kind) return { error: "Type d'établissement inconnu" };
  if (!name) return { error: "Nom de l'établissement requis" };
  if (contactEmail && !EMAIL_RE.test(contactEmail)) return { error: "E-mail de contact invalide" };
  return {
    kind, name, contactEmail,
    address: text(body?.address, 240),
    contactName: text(body?.contactName, 120),
    contactPhone: text(body?.contactPhone, 40),
  };
}

async function ownedSchool(env, photographerId, schoolId) {
  return env.DB.prepare("SELECT * FROM schools WHERE id = ? AND photographer_id = ?").bind(schoolId, photographerId).first();
}

async function ownedYear(env, photographerId, yearId) {
  return env.DB.prepare(
    `SELECT y.*, s.kind FROM school_years y JOIN schools s ON s.id = y.school_id
     WHERE y.id = ? AND s.photographer_id = ?`
  ).bind(yearId, photographerId).first();
}

async function ownedGroup(env, photographerId, groupId) {
  return env.DB.prepare(
    `SELECT g.* FROM school_groups g JOIN school_years y ON y.id = g.year_id JOIN schools s ON s.id = y.school_id
     WHERE g.id = ? AND s.photographer_id = ?`
  ).bind(groupId, photographerId).first();
}

// Un nouvel établissement arrive avec l'année en cours, vide.
async function createSchool(request, env, photographer) {
  const f = schoolFields(await request.json().catch(() => null));
  if (f.error) return fail(400, f.error);
  const id = newId("sch");
  const yearId = newId("scy");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO schools (id, photographer_id, kind, name, address, contact_name, contact_email, contact_phone, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, photographer.id, f.kind, f.name, f.address, f.contactName, f.contactEmail, f.contactPhone, now()),
    env.DB.prepare("INSERT INTO school_years (id, school_id, label, status, created_at) VALUES (?, ?, ?, 'draft', ?)")
      .bind(yearId, id, currentYearLabel(), now()),
  ]);
  return json({ id, yearId }, { status: 201 });
}

async function updateSchool(request, env, photographer, schoolId) {
  if (!(await ownedSchool(env, photographer.id, schoolId))) return fail(404, "Établissement introuvable");
  const f = schoolFields(await request.json().catch(() => null));
  if (f.error) return fail(400, f.error);
  await env.DB.prepare(
    `UPDATE schools SET kind = ?, name = ?, address = ?, contact_name = ?, contact_email = ?, contact_phone = ?
     WHERE id = ? AND photographer_id = ?`
  ).bind(f.kind, f.name, f.address, f.contactName, f.contactEmail, f.contactPhone, schoolId, photographer.id).run();
  return json({ ok: true });
}

async function deleteSchool(env, photographer, schoolId) {
  if (!(await ownedSchool(env, photographer.id, schoolId))) return fail(404, "Établissement introuvable");
  // Années et groupes partent avec (ON DELETE CASCADE) ; on les efface
  // explicitement aussi, D1 n'appliquant les clés étrangères que si activées.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM school_groups WHERE year_id IN (SELECT id FROM school_years WHERE school_id = ?)").bind(schoolId),
    env.DB.prepare("DELETE FROM school_years WHERE school_id = ?").bind(schoolId),
    env.DB.prepare("DELETE FROM schools WHERE id = ? AND photographer_id = ?").bind(schoolId, photographer.id),
  ]);
  return json({ ok: true });
}

/* ---------- Années ---------- */

// POST …/schools/:id/years { label?, copyGroupsFrom? } — nouvelle année ; par
// défaut l'année qui suit la plus récente, avec ses groupes et leurs
// responsables repris (à ajuster ensuite : les élèves changent de classe).
async function createYear(request, env, photographer, schoolId) {
  if (!(await ownedSchool(env, photographer.id, schoolId))) return fail(404, "Établissement introuvable");
  const body = await request.json().catch(() => ({}));
  const latest = await env.DB.prepare("SELECT * FROM school_years WHERE school_id = ? ORDER BY label DESC LIMIT 1").bind(schoolId).first();
  const label = body?.label ? text(body.label, 9) : nextYearLabel(latest?.label);
  if (!YEAR_LABEL_RE.test(label)) return fail(400, "Année invalide (format 2026-2027)");
  const taken = await env.DB.prepare("SELECT id FROM school_years WHERE school_id = ? AND label = ?").bind(schoolId, label).first();
  if (taken) return fail(409, `L'année ${label} existe déjà pour cet établissement`);

  const id = newId("scy");
  const statements = [
    env.DB.prepare("INSERT INTO school_years (id, school_id, label, status, created_at) VALUES (?, ?, ?, 'draft', ?)")
      .bind(id, schoolId, label, now()),
  ];
  const sourceId = body?.copyGroupsFrom === undefined ? latest?.id : body.copyGroupsFrom;
  if (sourceId) {
    const source = await env.DB.prepare("SELECT id FROM school_years WHERE id = ? AND school_id = ?").bind(sourceId, schoolId).first();
    if (!source) return fail(400, "Année à reprendre introuvable");
    const { results } = await env.DB.prepare("SELECT name, leader, sort FROM school_groups WHERE year_id = ? ORDER BY sort").bind(source.id).all();
    for (const g of results) {
      statements.push(env.DB.prepare("INSERT INTO school_groups (id, year_id, name, leader, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(newId("scg"), id, g.name, g.leader, g.sort, now()));
    }
  }
  await env.DB.batch(statements);
  return json({ id, label }, { status: 201 });
}

async function updateYear(request, env, photographer, yearId) {
  const year = await ownedYear(env, photographer.id, yearId);
  if (!year) return fail(404, "Année introuvable");
  const body = await request.json().catch(() => null);
  const status = body?.status === undefined ? year.status : body.status;
  if (!YEAR_STATUSES.includes(status)) return fail(400, "Statut inconnu");
  const orderDeadline = body?.orderDeadline === undefined ? year.order_deadline : deadline(body.orderDeadline);
  const lateDeadline = body?.lateDeadline === undefined ? year.late_deadline : deadline(body.lateDeadline);
  if (orderDeadline === undefined || lateDeadline === undefined) return fail(400, "Date invalide");
  if (orderDeadline && lateDeadline && lateDeadline < orderDeadline) {
    return fail(400, "La commande à domicile doit se terminer après la commande groupée");
  }
  await env.DB.prepare("UPDATE school_years SET status = ?, order_deadline = ?, late_deadline = ? WHERE id = ?")
    .bind(status, orderDeadline, lateDeadline, yearId).run();
  return json({ ok: true });
}

async function deleteYear(env, photographer, yearId) {
  const year = await ownedYear(env, photographer.id, yearId);
  if (!year) return fail(404, "Année introuvable");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM school_groups WHERE year_id = ?").bind(yearId),
    env.DB.prepare("DELETE FROM school_years WHERE id = ?").bind(yearId),
  ]);
  return json({ ok: true });
}

/* ---------- Groupes ---------- */

// POST …/years/:id/groups { names: ["P1", "P2"], leader? } ou { name, leader }
// — plusieurs groupes d'un coup (une ligne par classe, copiée depuis une liste).
async function createGroups(request, env, photographer, yearId) {
  const year = await ownedYear(env, photographer.id, yearId);
  if (!year) return fail(404, "Année introuvable");
  const body = await request.json().catch(() => null);
  const names = (Array.isArray(body?.names) ? body.names : [body?.name])
    .map((n) => text(n, 60)).filter(Boolean);
  if (!names.length) return fail(400, "Nom du groupe requis");
  const row = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(sort), -1) AS last FROM school_groups WHERE year_id = ?").bind(yearId).first();
  if ((row?.n || 0) + names.length > MAX_GROUPS_PER_YEAR) return fail(400, `${MAX_GROUPS_PER_YEAR} groupes au maximum par année`);
  const leader = names.length === 1 ? text(body?.leader, 80) : "";
  const ids = names.map(() => newId("scg"));
  await env.DB.batch(names.map((name, i) =>
    env.DB.prepare("INSERT INTO school_groups (id, year_id, name, leader, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(ids[i], yearId, name, leader, (row?.last ?? -1) + 1 + i, now())
  ));
  return json({ ids }, { status: 201 });
}

async function updateGroup(request, env, photographer, groupId) {
  const group = await ownedGroup(env, photographer.id, groupId);
  if (!group) return fail(404, "Groupe introuvable");
  const body = await request.json().catch(() => null);
  const name = body?.name === undefined ? group.name : text(body.name, 60);
  if (!name) return fail(400, "Nom du groupe requis");
  const leader = body?.leader === undefined ? group.leader : text(body.leader, 80);
  const sort = Number.isInteger(body?.sort) ? body.sort : group.sort;
  await env.DB.prepare("UPDATE school_groups SET name = ?, leader = ?, sort = ? WHERE id = ?").bind(name, leader, sort, groupId).run();
  return json({ ok: true });
}

async function deleteGroup(env, photographer, groupId) {
  if (!(await ownedGroup(env, photographer.id, groupId))) return fail(404, "Groupe introuvable");
  await env.DB.prepare("DELETE FROM school_groups WHERE id = ?").bind(groupId).run();
  return json({ ok: true });
}

/* ---------- Routeur : /api/admin/school/… ---------- */

export async function handleSchoolAdmin(request, env, photographer, rest) {
  const access = schoolAccess(env, photographer);
  const method = request.method;
  // La vue d'ensemble répond toujours : elle dit au tableau de bord si le
  // module est accessible, pour afficher la présentation des formules sinon.
  if (rest.length === 0 && method === "GET") return overview(env, photographer);
  if (!access.allowed) return featureRefusal("school");

  const [kind, id, sub] = rest;
  if (kind === "schools" && rest.length === 1 && method === "POST") return createSchool(request, env, photographer);
  if (kind === "schools" && rest.length === 2 && method === "POST") return updateSchool(request, env, photographer, id);
  if (kind === "schools" && rest.length === 2 && method === "DELETE") return deleteSchool(env, photographer, id);
  if (kind === "schools" && sub === "years" && rest.length === 3 && method === "POST") return createYear(request, env, photographer, id);
  if (kind === "years" && rest.length === 2 && method === "POST") return updateYear(request, env, photographer, id);
  if (kind === "years" && rest.length === 2 && method === "DELETE") return deleteYear(env, photographer, id);
  if (kind === "years" && sub === "groups" && rest.length === 3 && method === "POST") return createGroups(request, env, photographer, id);
  if (kind === "groups" && rest.length === 2 && method === "POST") return updateGroup(request, env, photographer, id);
  if (kind === "groups" && rest.length === 2 && method === "DELETE") return deleteGroup(env, photographer, id);
  return fail(404, "Route inconnue");
}
