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
//
// Photos (étape B) : chaque groupe a sa galerie protégée (galleries.kind =
// 'school', créée au premier import) qui reçoit les photos comme n'importe
// quelle galerie — mêmes tuiles, filigrane, empreinte et fichiers
// d'impression. Les photos se regroupent ensuite par enfant d'après leur
// heure de prise de vue (rafales), puis le photographe vérifie et corrige.

import { json, fail } from "./http.js";
import { randomBytes, b64url, hashPassword } from "./auth.js";
import { isOwner, featureRefusal, schoolLaunched, schoolEnabled } from "./subscription.js";
import { handleSchoolShopAdmin, copyProducts, eraseShopStatements } from "./schoolshop.js";
import { handleSchoolLabAdmin } from "./schoollab.js";

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
const MAX_ASSIGN = 500;

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
  return { allowed: schoolEnabled(env, photographer), owner, launched: schoolLaunched(env) };
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
      `SELECT g.*,
              (SELECT COUNT(*) FROM school_children c WHERE c.group_id = g.id) AS children_count,
              (SELECT COUNT(*) FROM photos p WHERE g.gallery_id != '' AND p.gallery_id = g.gallery_id) AS photo_count
       FROM school_groups g WHERE g.year_id IN (${yearIds.map(() => "?").join(",")}) ORDER BY g.sort, g.name COLLATE NOCASE`
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
      familyReminders: Boolean(y.family_reminders),
      createdAt: y.created_at,
      groups: groups.filter((g) => g.year_id === y.id).map((g) => ({
        id: g.id, name: g.name, leader: g.leader, sort: g.sort,
        childrenCount: g.children_count || 0, photoCount: g.photo_count || 0,
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

// Efface les galeries (photos, tuiles, fichiers d'impression) et les enfants
// des groupes donnés, avant que les groupes eux-mêmes ne disparaissent.
async function eraseGroups(env, groups, helpers) {
  for (const g of groups) {
    if (g.gallery_id) {
      const gallery = await env.DB.prepare("SELECT * FROM galleries WHERE id = ? AND kind = 'school'").bind(g.gallery_id).first();
      if (gallery) await helpers.eraseGallery(env, gallery);
    }
    await env.DB.prepare("DELETE FROM school_children WHERE group_id = ?").bind(g.id).run();
  }
}

async function deleteSchool(env, photographer, schoolId, helpers) {
  if (!(await ownedSchool(env, photographer.id, schoolId))) return fail(404, "Établissement introuvable");
  const { results: groups } = await env.DB.prepare(
    "SELECT g.id, g.gallery_id FROM school_groups g JOIN school_years y ON y.id = g.year_id WHERE y.school_id = ?"
  ).bind(schoolId).all();
  await eraseGroups(env, groups, helpers);
  // Années et groupes partent avec (ON DELETE CASCADE) ; on les efface
  // explicitement aussi, D1 n'appliquant les clés étrangères que si activées.
  await env.DB.batch([
    ...eraseShopStatements(env, "school_id = ?", schoolId),
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
    // La gamme et les frais de port suivent aussi : mêmes produits, mêmes prix.
    statements.push(...(await copyProducts(env, source.id, id)));
    statements.push(env.DB.prepare("UPDATE school_years SET home_shipping_cents = (SELECT home_shipping_cents FROM school_years WHERE id = ?) WHERE id = ?").bind(source.id, id));
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
  const reminders = body?.familyReminders === undefined ? year.family_reminders : (body.familyReminders ? 1 : 0);
  await env.DB.prepare("UPDATE school_years SET status = ?, order_deadline = ?, late_deadline = ?, family_reminders = ? WHERE id = ?")
    .bind(status, orderDeadline, lateDeadline, reminders, yearId).run();
  return json({ ok: true });
}

async function deleteYear(env, photographer, yearId, helpers) {
  const year = await ownedYear(env, photographer.id, yearId);
  if (!year) return fail(404, "Année introuvable");
  const { results: groups } = await env.DB.prepare("SELECT id, gallery_id FROM school_groups WHERE year_id = ?").bind(yearId).all();
  await eraseGroups(env, groups, helpers);
  await env.DB.batch([
    ...eraseShopStatements(env, "id = ?", yearId),
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

async function deleteGroup(env, photographer, groupId, helpers) {
  const group = await ownedGroup(env, photographer.id, groupId);
  if (!group) return fail(404, "Groupe introuvable");
  await eraseGroups(env, [group], helpers);
  await env.DB.prepare("DELETE FROM school_groups WHERE id = ?").bind(groupId).run();
  return json({ ok: true });
}


/* ---------- Photos d'un groupe : regroupement par enfant ---------- */

// Coupe une séance en rafales d'après l'heure de prise de vue : les poses
// d'un même enfant se suivent de près, une pause plus longue sépare deux
// enfants. Le seuil s'adapte à la séance : dans les écarts triés du plus
// court au plus long, on retient la PREMIÈRE cassure nette (un écart au
// moins BREAK_RATIO fois plus long que le précédent, et d'au moins
// MIN_BREAK_MS) — celle entre « poses d'un même enfant » et « enfant
// suivant ». Les cassures plus loin (pause récréation, photo de classe prise
// à part) ne doivent pas faire monter le seuil. Sans cassure nette,
// DEFAULT_BREAK_MS. Dans le doute, mieux vaut couper un enfant en deux (une
// fusion d'un clic) que réunir deux enfants.
//   items : [{ id, takenAt (ms) | null, sourceName }]
//   → { bursts: [[id…]…], undated: [id…], thresholdMs }
export const MIN_BREAK_MS = 5000;
export const DEFAULT_BREAK_MS = 15000;
export const BREAK_RATIO = 2.5;
export function splitIntoBursts(items) {
  const dated = items.filter((p) => Number.isFinite(p.takenAt) && p.takenAt > 0)
    .sort((a, b) => a.takenAt - b.takenAt || String(a.sourceName).localeCompare(String(b.sourceName)));
  const undated = items.filter((p) => !(Number.isFinite(p.takenAt) && p.takenAt > 0)).map((p) => p.id);
  if (!dated.length) return { bursts: [], undated, thresholdMs: null };
  const gaps = [];
  for (let i = 1; i < dated.length; i++) gaps.push(dated[i].takenAt - dated[i - 1].takenAt);
  const sorted = gaps.slice().sort((a, b) => a - b);
  let threshold = DEFAULT_BREAK_MS;
  for (let i = 0; i + 1 < sorted.length; i++) {
    const below = Math.max(sorted[i], 1000);
    const above = sorted[i + 1];
    if (above < MIN_BREAK_MS || above / below < BREAK_RATIO) continue;
    threshold = Math.max(MIN_BREAK_MS, Math.sqrt(below * above));
    break;
  }
  const bursts = [[dated[0].id]];
  for (let i = 1; i < dated.length; i++) {
    if (gaps[i - 1] >= threshold) bursts.push([]);
    bursts[bursts.length - 1].push(dated[i].id);
  }
  return { bursts, undated, thresholdMs: Math.round(threshold) };
}

async function groupContext(env, photographerId, groupId) {
  return env.DB.prepare(
    `SELECT g.*, y.label AS year_label, y.id AS year_id, y.order_deadline AS year_order_deadline, s.id AS school_id, s.name AS school_name, s.kind AS school_kind
     FROM school_groups g JOIN school_years y ON y.id = g.year_id JOIN schools s ON s.id = y.school_id
     WHERE g.id = ? AND s.photographer_id = ?`
  ).bind(groupId, photographerId).first();
}

// Galerie protégée du groupe, créée au premier import. Son mot de passe est
// tiré au hasard et jamais montré : les familles y accéderont par leur code
// (étape suivante), jamais par l'écran de mot de passe classique.
async function ensureGroupGallery(env, photographer, group) {
  if (group.gallery_id) {
    const existing = await env.DB.prepare("SELECT id, slug FROM galleries WHERE id = ? AND photographer_id = ?").bind(group.gallery_id, photographer.id).first();
    if (existing) return existing;
  }
  const id = `gal_${b64url(randomBytes(9))}`;
  const slug = `groupe-${[...randomBytes(6)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  const { hash, salt } = await hashPassword(b64url(randomBytes(24)));
  const title = `${group.school_name} · ${group.name} · ${group.year_label}`.slice(0, 200);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO galleries (id, photographer_id, slug, title, password_hash, password_salt, shop_enabled, kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'school', ?)`
    ).bind(id, photographer.id, slug, title, hash, salt, now()),
    env.DB.prepare("UPDATE school_groups SET gallery_id = ? WHERE id = ?").bind(id, group.id),
  ]);
  return { id, slug };
}

// POST …/groups/:id/gallery — prépare l'import (renvoie la galerie du groupe).
async function groupGallery(env, photographer, groupId) {
  const group = await groupContext(env, photographer.id, groupId);
  if (!group) return fail(404, "Groupe introuvable");
  const gallery = await ensureGroupGallery(env, photographer, group);
  return json({ galleryId: gallery.id, slug: gallery.slug });
}

// Numérote les enfants dans l'ordre de la séance (première photo), ceux
// sans photo datée à la suite : « Enfant 1 » est le premier photographié.
async function renumberChildren(env, group) {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.created_at,
            (SELECT MIN(p.taken_at) FROM photos p WHERE p.child_id = c.id AND p.gallery_id = ?) AS first_at
     FROM school_children c WHERE c.group_id = ?`
  ).bind(group.gallery_id || "", group.id).all();
  results.sort((a, b) =>
    (a.first_at ?? Infinity) - (b.first_at ?? Infinity) || a.created_at - b.created_at || a.id.localeCompare(b.id));
  if (!results.length) return;
  await env.DB.batch(results.map((c, i) => env.DB.prepare("UPDATE school_children SET number = ? WHERE id = ?").bind(i + 1, c.id)));
}

async function groupDetail(env, photographer, groupId) {
  const group = await groupContext(env, photographer.id, groupId);
  if (!group) return fail(404, "Groupe introuvable");
  // Une photo supprimée depuis la grille peut laisser un enfant sans photo.
  if (group.gallery_id) {
    await env.DB.prepare(
      `DELETE FROM school_children WHERE group_id = ? AND NOT EXISTS
         (SELECT 1 FROM photos p WHERE p.child_id = school_children.id AND p.gallery_id = ?)`
    ).bind(group.id, group.gallery_id).run();
  }
  const [{ results: children }, { results: photos }] = await Promise.all([
    env.DB.prepare("SELECT id, number, first_name, access_code FROM school_children WHERE group_id = ? ORDER BY number").bind(group.id).all(),
    group.gallery_id
      ? env.DB.prepare(
          `SELECT id, position, width, height, preview_width, preview_height, taken_at, source_name, child_id, school_role
           FROM photos WHERE gallery_id = ? ORDER BY COALESCE(taken_at, 0), position, created_at`
        ).bind(group.gallery_id).all()
      : Promise.resolve({ results: [] }),
  ]);
  const gallery = group.gallery_id
    ? await env.DB.prepare("SELECT slug FROM galleries WHERE id = ?").bind(group.gallery_id).first()
    : null;
  return json({
    kinds: SCHOOL_KINDS,
    school: { id: group.school_id, name: group.school_name, kind: group.school_kind },
    year: { id: group.year_id, label: group.year_label, orderDeadline: group.year_order_deadline },
    group: { id: group.id, name: group.name, leader: group.leader, gallerySlug: gallery?.slug || "" },
    children: children.map((c) => ({ id: c.id, number: c.number, firstName: c.first_name, code: formatAccessCode(c.access_code) })),
    photos: photos.map((p) => ({
      id: p.id, position: p.position, width: p.width, height: p.height,
      takenAt: p.taken_at, sourceName: p.source_name, childId: p.child_id, role: p.school_role,
    })),
  });
}

// POST …/groups/:id/arrange — regroupe par rafale les photos encore « à
// trier » (ni rattachées à un enfant, ni photo de groupe) : chaque rafale
// devient un nouvel enfant. Ce qui a déjà été vérifié n'est jamais touché.
async function arrangeGroup(env, photographer, groupId) {
  const group = await groupContext(env, photographer.id, groupId);
  if (!group) return fail(404, "Groupe introuvable");
  if (!group.gallery_id) return json({ created: 0, undated: 0 });
  const { results } = await env.DB.prepare(
    "SELECT id, taken_at, source_name FROM photos WHERE gallery_id = ? AND child_id = '' AND school_role = ''"
  ).bind(group.gallery_id).all();
  const { bursts, undated, thresholdMs } = splitIntoBursts(results.map((p) => ({ id: p.id, takenAt: p.taken_at, sourceName: p.source_name })));
  const statements = [];
  for (const burst of bursts) {
    const childId = newId("chd");
    statements.push(env.DB.prepare("INSERT INTO school_children (id, group_id, number, first_name, created_at) VALUES (?, ?, 0, '', ?)")
      .bind(childId, group.id, now()));
    statements.push(env.DB.prepare(
      `UPDATE photos SET child_id = ? WHERE gallery_id = ? AND id IN (${burst.map(() => "?").join(",")})`
    ).bind(childId, group.gallery_id, ...burst));
  }
  if (statements.length) await env.DB.batch(statements);
  await renumberChildren(env, group);
  return json({ created: bursts.length, undated: undated.length, thresholdMs });
}

// POST …/groups/:id/assign { photoIds, to } — to : identifiant d'un enfant
// du groupe, « new » (nouvel enfant), « group » (photo de groupe) ou
// « unsorted » (retour au bac à trier).
async function assignPhotos(request, env, photographer, groupId) {
  const group = await groupContext(env, photographer.id, groupId);
  if (!group) return fail(404, "Groupe introuvable");
  if (!group.gallery_id) return fail(400, "Aucune photo dans ce groupe");
  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.photoIds) ? [...new Set(body.photoIds.map(String))].slice(0, MAX_ASSIGN) : [];
  if (!ids.length) return fail(400, "Aucune photo choisie");
  const to = String(body?.to || "");
  let childId = "";
  let role = "";
  const statements = [];
  if (to === "new") {
    childId = newId("chd");
    statements.push(env.DB.prepare("INSERT INTO school_children (id, group_id, number, first_name, created_at) VALUES (?, ?, 0, '', ?)")
      .bind(childId, group.id, now()));
  } else if (to === "group") {
    role = "group";
  } else if (to !== "unsorted") {
    const child = await env.DB.prepare("SELECT id FROM school_children WHERE id = ? AND group_id = ?").bind(to, group.id).first();
    if (!child) return fail(404, "Enfant introuvable");
    childId = child.id;
  }
  statements.push(env.DB.prepare(
    `UPDATE photos SET child_id = ?, school_role = ? WHERE gallery_id = ? AND id IN (${ids.map(() => "?").join(",")})`
  ).bind(childId, role, group.gallery_id, ...ids));
  // Un enfant qui n'a plus aucune photo disparaît.
  statements.push(env.DB.prepare(
    `DELETE FROM school_children WHERE group_id = ? AND NOT EXISTS
       (SELECT 1 FROM photos p WHERE p.child_id = school_children.id AND p.gallery_id = ?)`
  ).bind(group.id, group.gallery_id));
  await env.DB.batch(statements);
  await renumberChildren(env, group);
  return json({ ok: true, childId: childId || null });
}

async function ownedChild(env, photographerId, childId) {
  return env.DB.prepare(
    `SELECT c.*, g.gallery_id FROM school_children c JOIN school_groups g ON g.id = c.group_id
     JOIN school_years y ON y.id = g.year_id JOIN schools s ON s.id = y.school_id
     WHERE c.id = ? AND s.photographer_id = ?`
  ).bind(childId, photographerId).first();
}

async function updateChild(request, env, photographer, childId) {
  const child = await ownedChild(env, photographer.id, childId);
  if (!child) return fail(404, "Enfant introuvable");
  const body = await request.json().catch(() => null);
  await env.DB.prepare("UPDATE school_children SET first_name = ? WHERE id = ?").bind(text(body?.firstName, 60), childId).run();
  return json({ ok: true });
}

// POST …/children/:id/merge { into } — les photos de cet enfant rejoignent
// celles d'un autre enfant du même groupe (deux rafales du même enfant).
async function mergeChild(request, env, photographer, childId) {
  const child = await ownedChild(env, photographer.id, childId);
  if (!child) return fail(404, "Enfant introuvable");
  const body = await request.json().catch(() => null);
  const into = await env.DB.prepare("SELECT id, first_name FROM school_children WHERE id = ? AND group_id = ?").bind(String(body?.into || ""), child.group_id).first();
  if (!into || into.id === child.id) return fail(400, "Enfant de destination invalide");
  await env.DB.batch([
    env.DB.prepare("UPDATE photos SET child_id = ? WHERE child_id = ? AND gallery_id = ?").bind(into.id, child.id, child.gallery_id),
    env.DB.prepare("UPDATE school_order_lines SET child_id = ? WHERE child_id = ?").bind(into.id, child.id),
    env.DB.prepare("INSERT OR IGNORE INTO family_children (family_id, child_id, added_at) SELECT family_id, ?, added_at FROM family_children WHERE child_id = ?").bind(into.id, child.id),
    ...(child.first_name && !into.first_name ? [env.DB.prepare("UPDATE school_children SET first_name = ? WHERE id = ?").bind(child.first_name, into.id)] : []),
    env.DB.prepare("DELETE FROM school_children WHERE id = ?").bind(child.id),
  ]);
  await renumberChildren(env, { id: child.group_id, gallery_id: child.gallery_id });
  return json({ ok: true });
}

// DELETE …/children/:id — l'enfant disparaît, ses photos retournent à trier.
async function deleteChild(env, photographer, childId) {
  const child = await ownedChild(env, photographer.id, childId);
  if (!child) return fail(404, "Enfant introuvable");
  await env.DB.batch([
    env.DB.prepare("UPDATE photos SET child_id = '' WHERE child_id = ? AND gallery_id = ?").bind(child.id, child.gallery_id),
    env.DB.prepare("DELETE FROM school_children WHERE id = ?").bind(child.id),
  ]);
  await renumberChildren(env, { id: child.group_id, gallery_id: child.gallery_id });
  return json({ ok: true });
}

/* ---------- Fiches parents : codes d'accès ---------- */

// 32 symboles sans ambiguïté à la lecture (ni 0/O ni 1/I) : 8 caractères
// font ~10^12 combinaisons, affichés « K7P4 29QX ».
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newAccessCode() {
  return [...randomBytes(8)].map((b) => CODE_ALPHABET[b % 32]).join("");
}
// Ce que tape un parent : espaces, tirets et minuscules acceptés.
export function normalizeAccessCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
}
export function formatAccessCode(code) {
  return code ? `${code.slice(0, 4)} ${code.slice(4)}` : "";
}

// POST …/years/:id/coupons { groupId? } — attribue un code à chaque enfant
// qui n'en a pas encore, puis renvoie de quoi composer les fiches : groupes
// dans l'ordre, enfants dans l'ordre de la séance, portrait (première photo
// de l'enfant), date limite. Les fiches elles-mêmes sont dessinées par
// admin-server (PDF à imprimer, ou images 10×15 pour le labo).
async function couponsForYear(request, env, photographer, yearId) {
  const year = await ownedYear(env, photographer.id, yearId);
  if (!year) return fail(404, "Année introuvable");
  const body = await request.json().catch(() => ({}));
  const school = await env.DB.prepare("SELECT * FROM schools WHERE id = ?").bind(year.school_id).first();
  const { results: allGroups } = await env.DB.prepare("SELECT * FROM school_groups WHERE year_id = ? ORDER BY sort, name COLLATE NOCASE").bind(yearId).all();
  const groups = body?.groupId ? allGroups.filter((g) => g.id === body.groupId) : allGroups;
  if (body?.groupId && !groups.length) return fail(404, "Groupe introuvable");

  const out = [];
  for (const g of groups) {
    const { results: children } = await env.DB.prepare("SELECT * FROM school_children WHERE group_id = ? ORDER BY number").bind(g.id).all();
    for (const c of children.filter((c) => !c.access_code)) {
      // Collision quasi impossible ; on retente simplement si l'index unique refuse.
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newAccessCode();
        try {
          await env.DB.prepare("UPDATE school_children SET access_code = ? WHERE id = ? AND access_code = ''").bind(code, c.id).run();
          c.access_code = code;
          break;
        } catch (err) {
          if (attempt === 4) throw err;
        }
      }
    }
    const portraits = new Map();
    if (g.gallery_id && children.length) {
      const { results: photos } = await env.DB.prepare(
        `SELECT id, child_id, has_original FROM photos WHERE gallery_id = ? AND child_id != '' AND school_role = ''
         ORDER BY COALESCE(taken_at, 0), position`
      ).bind(g.gallery_id).all();
      for (const p of photos) if (!portraits.has(p.child_id)) portraits.set(p.child_id, p.has_original ? p.id : "");
    }
    out.push({
      id: g.id, name: g.name, leader: g.leader,
      children: children.map((c) => ({
        id: c.id, number: c.number, firstName: c.first_name,
        code: c.access_code, codeDisplay: formatAccessCode(c.access_code),
        portraitPhotoId: portraits.get(c.id) || "",
      })),
    });
  }
  const origin = String(env.PUBLIC_SITE_ORIGIN || "https://www.holypixx.com").replace(/\/+$/, "");
  return json({
    school: { name: school.name, kind: school.kind },
    kind: SCHOOL_KINDS[school.kind] || SCHOOL_KINDS.ecole,
    year: { id: year.id, label: year.label, orderDeadline: year.order_deadline },
    studioName: photographer.studio_name || "",
    familyUrl: `${origin}/ecole`,
    groups: out,
  });
}

/* ---------- Routeur : /api/admin/school/… ---------- */

export async function handleSchoolAdmin(request, env, photographer, rest, helpers = {}) {
  const access = schoolAccess(env, photographer);
  const method = request.method;
  // La vue d'ensemble répond toujours : elle dit au tableau de bord si le
  // module est accessible, pour afficher la présentation des formules sinon.
  if (rest.length === 0 && method === "GET") return overview(env, photographer);
  if (!access.allowed) return featureRefusal("school");

  const shop = await handleSchoolShopAdmin(request, env, photographer, rest);
  if (shop) return shop;
  const lab = await handleSchoolLabAdmin(request, env, photographer, rest, new URL(request.url).origin);
  if (lab) return lab;
  const [kind, id, sub] = rest;
  if (kind === "schools" && rest.length === 1 && method === "POST") return createSchool(request, env, photographer);
  if (kind === "schools" && rest.length === 2 && method === "POST") return updateSchool(request, env, photographer, id);
  if (kind === "schools" && rest.length === 2 && method === "DELETE") return deleteSchool(env, photographer, id, helpers);
  if (kind === "schools" && sub === "years" && rest.length === 3 && method === "POST") return createYear(request, env, photographer, id);
  if (kind === "years" && rest.length === 2 && method === "POST") return updateYear(request, env, photographer, id);
  if (kind === "years" && rest.length === 2 && method === "DELETE") return deleteYear(env, photographer, id, helpers);
  if (kind === "years" && sub === "groups" && rest.length === 3 && method === "POST") return createGroups(request, env, photographer, id);
  if (kind === "years" && sub === "coupons" && rest.length === 3 && method === "POST") return couponsForYear(request, env, photographer, id);
  if (kind === "groups" && rest.length === 2 && method === "POST") return updateGroup(request, env, photographer, id);
  if (kind === "groups" && rest.length === 2 && method === "DELETE") return deleteGroup(env, photographer, id, helpers);
  if (kind === "groups" && rest.length === 2 && method === "GET") return groupDetail(env, photographer, id);
  if (kind === "groups" && sub === "gallery" && rest.length === 3 && method === "POST") return groupGallery(env, photographer, id);
  if (kind === "groups" && sub === "arrange" && rest.length === 3 && method === "POST") return arrangeGroup(env, photographer, id);
  if (kind === "groups" && sub === "assign" && rest.length === 3 && method === "POST") return assignPhotos(request, env, photographer, id);
  if (kind === "children" && rest.length === 2 && method === "POST") return updateChild(request, env, photographer, id);
  if (kind === "children" && rest.length === 2 && method === "DELETE") return deleteChild(env, photographer, id);
  if (kind === "children" && sub === "merge" && rest.length === 3 && method === "POST") return mergeChild(request, env, photographer, id);
  return fail(404, "Route inconnue");
}
