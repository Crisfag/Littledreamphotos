// Espace famille du module scolaire (page web/ecole.html) : les parents y
// entrent avec leur e-mail et le code de la fiche remise par
// l'établissement, et retrouvent tous leurs enfants — frères et sœurs,
// écoles différentes, années suivantes — au même endroit.
//
// Pas de mot de passe : le code prouve le droit de voir les photos d'un
// enfant ; l'adresse e-mail rattache ces enfants à une même famille et sert
// à revenir plus tard (lien de connexion envoyé par e-mail, valable une
// demi-heure, une seule fois).
//
// Une famille ne voit jamais que :
//   - les photos de ses enfants (photos.child_id) ;
//   - les photos de groupe (school_role = 'group') des groupes où elle a un
//     enfant ;
// et seulement tant que l'année est en vente ou close (pas en préparation,
// pas archivée). Les tuiles sont servies une à une, avec le jeton famille,
// jamais en cache — comme la galerie classique.

import { json, fail } from "./http.js";
import { signToken, verifyToken, hashValue, hashToken, randomBytes, b64url } from "./auth.js";
import { normalizeAccessCode, SCHOOL_KINDS } from "./school.js";
import { sendFamilyLoginLink } from "./notify.js";

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const LINK_TTL_SECONDS = 30 * 60;
const FAILED_WINDOW_SECONDS = 15 * 60;
const MAX_FAILED_CODES = 12;
const MAX_CHILDREN = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VIEWABLE = new Set(["open", "closed"]);
const PREVIEW_COLS = 2;
const PREVIEW_ROWS = 2;

function now() {
  return Math.floor(Date.now() / 1000);
}

function newId(prefix) {
  return `${prefix}_${b64url(randomBytes(9))}`;
}

async function readJson(request) {
  return request.json().catch(() => null);
}

/* ---------- Session ---------- */

function issueFamilyToken(env, familyId) {
  return signToken(env.AUTH_SECRET, { typ: "family", sub: familyId, exp: now() + SESSION_TTL_SECONDS });
}

async function authenticateFamily(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = await verifyToken(env.AUTH_SECRET, token);
  if (!payload || payload.typ !== "family" || !payload.sub) return null;
  return env.DB.prepare("SELECT * FROM families WHERE id = ?").bind(payload.sub).first();
}

async function getOrCreateFamily(env, email) {
  const existing = await env.DB.prepare("SELECT * FROM families WHERE email = ?").bind(email).first();
  if (existing) return existing;
  const id = newId("fam");
  await env.DB.prepare("INSERT OR IGNORE INTO families (id, email, created_at) VALUES (?, ?, ?)").bind(id, email, now()).run();
  return env.DB.prepare("SELECT * FROM families WHERE email = ?").bind(email).first();
}

/* ---------- Codes : vérification et limite d'essais ---------- */

async function ipHashOf(request, env) {
  return hashValue(request.headers.get("CF-Connecting-IP") || "", env.AUTH_SECRET);
}

async function tooManyFailures(env, ipHash) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM auth_log WHERE event = 'family_code_failed' AND ip_hash = ? AND ts > ?"
  ).bind(ipHash, now() - FAILED_WINDOW_SECONDS).first();
  return (row?.n || 0) >= MAX_FAILED_CODES;
}

async function logFailure(env, ipHash) {
  await env.DB.prepare("INSERT INTO auth_log (email_hash, event, ip_hash, ts) VALUES ('', 'family_code_failed', ?, ?)")
    .bind(ipHash, now()).run();
}

// L'enfant d'un code, avec son groupe, son année et son établissement.
async function childForCode(env, code) {
  if (!code) return null;
  return env.DB.prepare(
    `SELECT c.id, c.first_name, y.status AS year_status, g.name AS group_name, s.kind AS school_kind
     FROM school_children c JOIN school_groups g ON g.id = c.group_id
     JOIN school_years y ON y.id = g.year_id JOIN schools s ON s.id = y.school_id
     WHERE c.access_code = ?`
  ).bind(code).first();
}

// Vérifie un code et rattache l'enfant à la famille ; renvoie une erreur
// HTTP prête à l'emploi, ou null.
async function linkChild(request, env, family, rawCode) {
  const ipHash = await ipHashOf(request, env);
  if (await tooManyFailures(env, ipHash)) {
    return fail(429, "Trop d'essais de code. Réessayez dans un quart d'heure.");
  }
  const child = await childForCode(env, normalizeAccessCode(rawCode));
  if (!child) {
    await logFailure(env, ipHash);
    return fail(404, "Ce code d'accès est inconnu. Vérifiez-le sur la fiche remise par l'établissement.");
  }
  if (child.year_status === "draft") {
    const kind = SCHOOL_KINDS[child.school_kind] || SCHOOL_KINDS.ecole;
    return fail(409, `Les photos de ${kind.group.toLowerCase()} ${child.group_name} ne sont pas encore en ligne. Réessayez dans quelques jours.`);
  }
  if (child.year_status === "archived") return fail(410, "Ces photos ne sont plus en ligne. Contactez votre photographe.");
  if (!family) return { child };
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM family_children WHERE family_id = ?").bind(family.id).first();
  if ((count?.n || 0) >= MAX_CHILDREN) return fail(400, `${MAX_CHILDREN} enfants au maximum par espace famille.`);
  await env.DB.prepare("INSERT OR IGNORE INTO family_children (family_id, child_id, added_at) VALUES (?, ?, ?)")
    .bind(family.id, child.id, now()).run();
  return { child };
}

/* ---------- Ce que voit la famille ---------- */

async function familyView(env, family) {
  const { results: rows } = await env.DB.prepare(
    `SELECT c.id, c.number, c.first_name, c.group_id, g.name AS group_name, g.leader, g.gallery_id,
            y.id AS year_id, y.label AS year_label, y.status, y.order_deadline, y.late_deadline,
            s.name AS school_name, s.kind AS school_kind, p.studio_name, fc.added_at
     FROM family_children fc
     JOIN school_children c ON c.id = fc.child_id
     JOIN school_groups g ON g.id = c.group_id
     JOIN school_years y ON y.id = g.year_id
     JOIN schools s ON s.id = y.school_id
     JOIN photographers p ON p.id = s.photographer_id
     WHERE fc.family_id = ?
     ORDER BY y.label DESC, fc.added_at`
  ).bind(family.id).all();

  const children = [];
  for (const r of rows) {
    const viewable = VIEWABLE.has(r.status);
    let photos = [];
    let groupPhotos = [];
    if (viewable && r.gallery_id) {
      const { results } = await env.DB.prepare(
        `SELECT id, width, height, cols, rows, preview_width, preview_height, child_id, school_role
         FROM photos WHERE gallery_id = ? AND (child_id = ? OR school_role = 'group')
         ORDER BY COALESCE(taken_at, 0), position`
      ).bind(r.gallery_id, r.id).all();
      const out = (p) => ({ id: p.id, width: p.width, height: p.height, cols: p.cols, rows: p.rows });
      photos = results.filter((p) => p.school_role !== "group" && p.child_id === r.id).map(out);
      groupPhotos = results.filter((p) => p.school_role === "group").map(out);
    }
    const kind = SCHOOL_KINDS[r.school_kind] || SCHOOL_KINDS.ecole;
    children.push({
      id: r.id,
      firstName: r.first_name,
      number: r.number,
      school: { name: r.school_name, kind: r.school_kind },
      vocabulary: { group: kind.group, groupPhoto: kind.groupPhoto },
      group: { name: r.group_name, leader: r.leader },
      year: { label: r.year_label, status: r.status, orderDeadline: r.order_deadline, lateDeadline: r.late_deadline },
      studioName: r.studio_name || "",
      viewable,
      photos,
      groupPhotos,
    });
  }
  return { email: family.email, children };
}

/* ---------- Routes ---------- */

// POST /api/family/access { email, code } — première visite (ou nouvel
// enfant) : le code ouvre l'accès, l'e-mail rattache à la famille.
async function access(request, env) {
  const body = await readJson(request);
  const email = String(body?.email || "").trim().toLowerCase().slice(0, 200);
  if (!EMAIL_RE.test(email)) return fail(400, "Adresse e-mail invalide");
  // Le code d'abord : une adresse ne crée un espace que si le code est bon.
  const checked = await linkChild(request, env, null, body?.code);
  if (checked instanceof Response) return checked;
  const family = await getOrCreateFamily(env, email);
  const linked = await linkChild(request, env, family, body?.code);
  if (linked instanceof Response) return linked;
  await env.DB.prepare("UPDATE families SET last_login_at = ? WHERE id = ?").bind(now(), family.id).run();
  return json({ token: await issueFamilyToken(env, family.id), expiresIn: SESSION_TTL_SECONDS, childId: linked.child.id, ...(await familyView(env, family)) });
}

// POST /api/family/children { code } — ajouter un enfant à son espace.
async function addChild(request, env, family) {
  const body = await readJson(request);
  const linked = await linkChild(request, env, family, body?.code);
  if (linked instanceof Response) return linked;
  return json({ childId: linked.child.id, ...(await familyView(env, family)) });
}

// DELETE /api/family/children/:id — retirer un enfant de son espace (le
// code reste valable : on peut le rajouter plus tard).
async function removeChild(env, family, childId) {
  await env.DB.prepare("DELETE FROM family_children WHERE family_id = ? AND child_id = ?").bind(family.id, childId).run();
  return json(await familyView(env, family));
}

// POST /api/family/login-link { email } — revenir sans fiche sous la main :
// un lien de connexion part par e-mail si l'adresse a déjà un espace. La
// réponse est toujours la même : rien ne révèle si une adresse est connue.
async function requestLink(request, env) {
  const body = await readJson(request);
  const email = String(body?.email || "").trim().toLowerCase().slice(0, 200);
  if (!EMAIL_RE.test(email)) return fail(400, "Adresse e-mail invalide");
  const family = await env.DB.prepare("SELECT * FROM families WHERE email = ?").bind(email).first();
  if (family) {
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM family_links WHERE family_id = ? AND created_at > ?")
      .bind(family.id, now() - 3600).first();
    if ((recent?.n || 0) < 5) {
      const token = b64url(randomBytes(24));
      await env.DB.prepare("INSERT INTO family_links (token_hash, family_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
        .bind(await hashToken(token, env.AUTH_SECRET), family.id, now() + LINK_TTL_SECONDS, now()).run();
      const origin = String(env.PUBLIC_SITE_ORIGIN || "https://www.holypixx.com").replace(/\/+$/, "");
      await sendFamilyLoginLink(env, { to: family.email, loginUrl: `${origin}/ecole?l=${encodeURIComponent(token)}`, ts: now() });
    }
  }
  return json({ ok: true });
}

// POST /api/family/login-link/verify { token } — ouvre la session.
async function verifyLink(request, env) {
  const body = await readJson(request);
  const token = String(body?.token || "");
  if (!token) return fail(400, "Lien invalide");
  const hash = await hashToken(token, env.AUTH_SECRET);
  const link = await env.DB.prepare("SELECT * FROM family_links WHERE token_hash = ?").bind(hash).first();
  if (!link || link.used_at || link.expires_at < now()) {
    return fail(410, "Ce lien a expiré ou a déjà servi. Demandez-en un nouveau.");
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE family_links SET used_at = ? WHERE token_hash = ?").bind(now(), hash),
    env.DB.prepare("UPDATE families SET last_login_at = ? WHERE id = ?").bind(now(), link.family_id),
  ]);
  const family = await env.DB.prepare("SELECT * FROM families WHERE id = ?").bind(link.family_id).first();
  return json({ token: await issueFamilyToken(env, family.id), expiresIn: SESSION_TTL_SECONDS, ...(await familyView(env, family)) });
}

// GET /api/family/tile/:photoId/:level/:col/:row — une tuile, si la photo
// appartient à un enfant de la famille (ou est la photo de groupe d'un de
// ses groupes) et que l'année est en ligne.
async function tile(env, family, photoId, level, col, row) {
  const photo = await env.DB.prepare(
    `SELECT p.id, p.gallery_id, p.cols, p.rows, p.child_id, p.school_role
     FROM photos p
     JOIN school_groups g ON g.gallery_id = p.gallery_id AND g.gallery_id != ''
     JOIN school_years y ON y.id = g.year_id
     WHERE p.id = ? AND y.status IN ('open', 'closed')
       AND EXISTS (
         SELECT 1 FROM family_children fc JOIN school_children c ON c.id = fc.child_id
         WHERE fc.family_id = ? AND c.group_id = g.id
           AND (c.id = p.child_id OR p.school_role = 'group')
       )`
  ).bind(photoId, family.id).first();
  if (!photo) return fail(404, "Photo introuvable");
  if (!(level === 0 || level === 1)) return fail(404, "Niveau inconnu");
  const cols = level === 0 ? PREVIEW_COLS : photo.cols;
  const rows = level === 0 ? PREVIEW_ROWS : photo.rows;
  if (!(col >= 0 && col < cols && row >= 0 && row < rows)) return fail(404, "Tuile introuvable");
  const object = await env.TILES.get(`${photo.gallery_id}/${photo.id}/${level}/${col}_${row}.jpg`);
  if (!object) return fail(404, "Tuile introuvable");
  return new Response(object.body, {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "no-store, no-cache, must-revalidate, private",
      "content-disposition": "inline",
    },
  });
}

export async function handleFamily(request, env, path) {
  const parts = path.split("/").filter(Boolean).slice(2); // après api/family
  const method = request.method;
  if (parts[0] === "access" && parts.length === 1 && method === "POST") return access(request, env);
  if (parts[0] === "login-link" && parts.length === 1 && method === "POST") return requestLink(request, env);
  if (parts[0] === "login-link" && parts[1] === "verify" && parts.length === 2 && method === "POST") return verifyLink(request, env);

  const family = await authenticateFamily(request, env);
  if (!family) return fail(401, "Session expirée : entrez à nouveau votre e-mail et votre code.");
  if (parts[0] === "me" && parts.length === 1 && method === "GET") return json(await familyView(env, family));
  if (parts[0] === "children" && parts.length === 1 && method === "POST") return addChild(request, env, family);
  if (parts[0] === "children" && parts.length === 2 && method === "DELETE") return removeChild(env, family, decodeURIComponent(parts[1]));
  if (parts[0] === "tile" && parts.length === 5 && method === "GET") {
    return tile(env, family, decodeURIComponent(parts[1]), Number(parts[2]), Number(parts[3]), Number(parts[4]));
  }
  return fail(404, "Route inconnue");
}

// Passe quotidienne : un espace famille sans enfant (tous retirés, ou
// établissements supprimés) et sans connexion depuis un an est effacé ; les
// liens de connexion, valables une demi-heure, ne sont pas gardés au-delà de
// deux jours.
export async function purgeFamilies(env, at = now()) {
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM families WHERE COALESCE(last_login_at, created_at) < ?
         AND NOT EXISTS (SELECT 1 FROM family_children fc WHERE fc.family_id = families.id)`
    ).bind(at - 365 * 24 * 60 * 60),
    env.DB.prepare("DELETE FROM family_links WHERE created_at < ?").bind(at - 2 * 24 * 60 * 60),
  ]);
}
