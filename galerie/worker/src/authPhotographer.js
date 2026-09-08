// Comptes photographes : inscription, connexion, session.
//
// Jetons signés avec AUTH_SECRET — une clé distincte de TOKEN_SECRET (sessions
// client d'une galerie) : même en cas d'erreur de câblage, un jeton de session
// client ne peut jamais être rejoué comme jeton d'administration, et
// inversement, puisque les deux sont signés avec des clés différentes.

import { json, fail } from "./http.js";
import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  hashValue,
  randomBytes,
  b64url,
} from "./auth.js";

// Outil utilisé au long cours (CLI, admin locale) plutôt qu'une session web
// ponctuelle : durée de vie longue, à l'image d'un jeton d'API.
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 jours
const MAX_FAILED_LOGINS = 10;
const FAILED_WINDOW_SECONDS = 15 * 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function now() {
  return Math.floor(Date.now() / 1000);
}

function newId() {
  return `pho_${b64url(randomBytes(9))}`;
}

async function logAuth(env, { emailHash, event, ipHash }) {
  await env.DB.prepare(
    `INSERT INTO auth_log (email_hash, event, ip_hash, ts) VALUES (?, ?, ?, ?)`
  )
    .bind(emailHash, event, ipHash || "", now())
    .run();
}

async function tooManyFailures(env, emailHash) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM auth_log
     WHERE email_hash = ? AND event = 'login_failed' AND ts > ?`
  )
    .bind(emailHash, now() - FAILED_WINDOW_SECONDS)
    .first();
  return (row?.n || 0) >= MAX_FAILED_LOGINS;
}

function issueSession(env, photographer) {
  return signToken(env.AUTH_SECRET, {
    typ: "photographer",
    sub: photographer.id,
    exp: now() + SESSION_TTL_SECONDS,
  });
}

function profileOf(photographer) {
  return { id: photographer.id, email: photographer.email, studioName: photographer.studio_name || "" };
}

async function signup(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const studioName = String(body.studioName || "").slice(0, 120);

  if (!EMAIL_RE.test(email)) return fail(400, "Adresse e-mail invalide");
  if (password.length < 10) return fail(400, "Mot de passe trop court (10 caractères minimum)");

  const existing = await env.DB.prepare("SELECT id FROM photographers WHERE email = ?")
    .bind(email)
    .first();
  if (existing) return fail(409, "Un compte existe déjà avec cette adresse e-mail");

  const { hash, salt } = await hashPassword(password);
  const id = newId();

  await env.DB.prepare(
    `INSERT INTO photographers (id, email, password_hash, password_salt, studio_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, email, hash, salt, studioName, now())
    .run();

  const photographer = { id, email, studio_name: studioName };
  const token = await issueSession(env, photographer);
  return json(
    { token, expiresIn: SESSION_TTL_SECONDS, photographer: profileOf(photographer) },
    { status: 201 }
  );
}

async function login(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ipHash = await hashValue(ip, env.AUTH_SECRET);

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const emailHash = await hashValue(email, env.AUTH_SECRET);

  if (await tooManyFailures(env, emailHash)) {
    return fail(429, "Trop de tentatives. Réessayez dans quelques minutes.");
  }

  const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE email = ?")
    .bind(email)
    .first();

  // Même message d'erreur si le compte n'existe pas ou si le mot de passe est
  // faux : inutile de confirmer à un inconnu qu'un compte existe.
  const ok = photographer
    ? await verifyPassword(password, photographer.password_hash, photographer.password_salt)
    : false;

  if (!ok) {
    await logAuth(env, { emailHash, event: "login_failed", ipHash });
    return fail(401, "E-mail ou mot de passe incorrect");
  }

  await logAuth(env, { emailHash, event: "login", ipHash });
  const token = await issueSession(env, photographer);
  return json({ token, expiresIn: SESSION_TTL_SECONDS, photographer: profileOf(photographer) });
}

// Utilisé par admin.js pour vérifier une requête et en extraire le
// photographe appelant — c'est la base du cloisonnement des données.
export async function authenticatePhotographer(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = await verifyToken(env.AUTH_SECRET, token);
  if (!payload || payload.typ !== "photographer" || !payload.sub) return null;
  return payload.sub;
}

async function me(request, env) {
  const photographerId = await authenticatePhotographer(request, env);
  if (!photographerId) return fail(401, "Session invalide");
  const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?")
    .bind(photographerId)
    .first();
  if (!photographer) return fail(401, "Session invalide");
  return json({ photographer: profileOf(photographer) });
}

export async function handleAuth(request, env, ctx, path) {
  const parts = path.split("/").filter(Boolean); // api, auth, action
  const action = parts[2];
  if (action === "signup" && request.method === "POST") return signup(request, env);
  if (action === "login" && request.method === "POST") return login(request, env);
  if (action === "me" && request.method === "GET") return me(request, env);
  return fail(404, "Route inconnue");
}
