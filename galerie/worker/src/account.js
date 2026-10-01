// Paramètres du compte photographe, toujours en session (Authorization:
// Bearer …) — sauf la confirmation d'un changement d'adresse e-mail, qui n'a
// jamais besoin d'une session (voir plus bas) : même logique que
// forgot-password/reset-password dans authPhotographer.js.

import { json, fail } from "./http.js";
import { normalizeSubdomain } from "./studio.js";
import { hashPassword, verifyPassword, randomBytes, b64url, hashToken } from "./auth.js";
import { sendEmailChangeConfirmation } from "./notify.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_CHANGE_TTL_SECONDS = 30 * 60; // 30 minutes
const LAYOUT_VALUES = new Set(["grille", "mosaique", "defilement"]);

function now() {
  return Math.floor(Date.now() / 1000);
}

function newId(prefix) {
  return `${prefix}_${b64url(randomBytes(9))}`;
}

export async function updateStudioName(request, env, photographerId) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const studioName = String(body.studioName || "").trim().slice(0, 120);
  if (!studioName) return fail(400, "Le nom du studio est requis");

  await env.DB.prepare("UPDATE photographers SET studio_name = ? WHERE id = ?")
    .bind(studioName, photographerId)
    .run();
  return json({ ok: true });
}

// Identité de la personne derrière le compte — jamais affichée au client,
// contrairement au nom de studio : utile à la page propriétaire pour
// identifier qui est qui. Facultatif, contrairement au nom de studio.
export async function updateName(request, env, photographerId) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const firstName = String(body.firstName || "").trim().slice(0, 80);
  const lastName = String(body.lastName || "").trim().slice(0, 80);

  await env.DB.prepare("UPDATE photographers SET first_name = ?, last_name = ? WHERE id = ?")
    .bind(firstName, lastName, photographerId)
    .run();
  return json({ ok: true });
}

// Contrairement à la réinitialisation (compte perdu), ici le photographe est
// déjà connecté : on redemande son mot de passe ACTUEL plutôt que de se fier
// à la seule session, pour qu'un jeton de session volé ne suffise jamais à
// lui seul à changer le mot de passe.
export async function changePassword(request, env, photographerId) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");
  if (newPassword.length < 10) return fail(400, "Nouveau mot de passe trop court (10 caractères minimum)");

  const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?")
    .bind(photographerId)
    .first();
  if (!photographer) return fail(401, "Session invalide");
  const ok = await verifyPassword(currentPassword, photographer.password_hash, photographer.password_salt);
  if (!ok) return fail(400, "Mot de passe actuel incorrect");

  const { hash, salt } = await hashPassword(newPassword);
  await env.DB.prepare("UPDATE photographers SET password_hash = ?, password_salt = ? WHERE id = ?")
    .bind(hash, salt, photographerId)
    .run();
  return json({ ok: true });
}

// Le mot de passe redemandé ici sert le même rôle que pour changePassword —
// mais c'est surtout la confirmation par lien envoyé à la NOUVELLE adresse
// (jamais l'ancienne) qui protège vraiment : sans elle, un jeton de session
// volé suffirait à rediriger silencieusement toutes les notifications futures
// du compte (donc, entre autres, les prochaines réinitialisations de mot de
// passe) vers une adresse contrôlée par l'attaquant.
export async function requestEmailChange(request, env, ctx, photographerId) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const newEmail = String(body.newEmail || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!EMAIL_RE.test(newEmail)) return fail(400, "Adresse e-mail invalide");

  const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?")
    .bind(photographerId)
    .first();
  if (!photographer) return fail(401, "Session invalide");
  const ok = await verifyPassword(password, photographer.password_hash, photographer.password_salt);
  if (!ok) return fail(400, "Mot de passe incorrect");

  if (newEmail === photographer.email) return fail(400, "C'est déjà votre adresse actuelle");
  const existing = await env.DB.prepare("SELECT id FROM photographers WHERE email = ?")
    .bind(newEmail)
    .first();
  if (existing) return fail(409, "Cette adresse est déjà utilisée par un autre compte");

  const token = b64url(randomBytes(24));
  const tokenHash = await hashToken(token, env.AUTH_SECRET);
  await env.DB.prepare(
    `INSERT INTO email_changes (id, photographer_id, new_email, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(newId("emc"), photographerId, newEmail, tokenHash, now() + EMAIL_CHANGE_TTL_SECONDS, now())
    .run();

  const adminUrl = env.ADMIN_URL || "";
  const confirmUrl = adminUrl ? `${adminUrl.replace(/\/$/, "")}/?confirm-email=${token}` : "";
  ctx.waitUntil(
    sendEmailChangeConfirmation(env, {
      to: newEmail,
      studioName: photographer.studio_name,
      confirmUrl,
      ts: now(),
    })
  );

  return json({ ok: true });
}

// Public : pas de session ici, exactement comme reset-password — le lien
// envoyé par e-mail en tient lieu. Peut donc être confirmé depuis un autre
// appareil ou navigateur que celui où le changement a été demandé.
export async function confirmEmailChange(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const token = String(body.token || "");
  if (!token) return fail(400, "Lien invalide ou expiré");

  const tokenHash = await hashToken(token, env.AUTH_SECRET);
  const change = await env.DB.prepare("SELECT * FROM email_changes WHERE token_hash = ?")
    .bind(tokenHash)
    .first();
  if (!change || change.used_at != null || change.expires_at < now()) {
    return fail(400, "Lien invalide ou expiré");
  }

  // L'adresse visée a pu être prise par un autre compte entre la demande et
  // la confirmation (30 minutes de fenêtre) — mieux vaut le vérifier une
  // seconde fois que de violer la contrainte d'unicité en base.
  const existing = await env.DB.prepare("SELECT id FROM photographers WHERE email = ?")
    .bind(change.new_email)
    .first();
  if (existing) return fail(409, "Cette adresse est déjà utilisée par un autre compte");

  await env.DB.prepare("UPDATE photographers SET email = ? WHERE id = ?")
    .bind(change.new_email, change.photographer_id)
    .run();
  await env.DB.prepare("UPDATE email_changes SET used_at = ? WHERE id = ?")
    .bind(now(), change.id)
    .run();
  return json({ ok: true, email: change.new_email });
}

// Valeur de départ proposée à la création d'une nouvelle galerie — jamais
// imposée, le photographe peut toujours la changer au cas par cas ensuite.
export async function updateDefaults(request, env, photographerId) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const layout = String(body.defaultLayout || "grille");
  if (!LAYOUT_VALUES.has(layout)) return fail(400, "Mise en page inconnue");

  await env.DB.prepare("UPDATE photographers SET default_layout = ? WHERE id = ?")
    .bind(layout, photographerId)
    .run();
  return json({ ok: true });
}

// Relances automatiques (client à J-7/J-2, photographe à J-2) : actives par
// défaut, désactivables d'un clic dans Paramètres.
export async function updateReminders(request, env, photographerId) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const enabled = body.enabled === true;
  await env.DB.prepare("UPDATE photographers SET reminders_enabled = ? WHERE id = ?")
    .bind(enabled ? 1 : 0, photographerId)
    .run();
  return json({ ok: true, enabled });
}

// Sous-domaine du studio (julie.holypixx.com). Unique entre comptes ; les
// noms réservés sont refusés ; vide = retirer.
export async function updateSubdomain(request, env, photographerId) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const normalized = normalizeSubdomain(body.subdomain);
  if (normalized.error) return fail(400, normalized.error);
  const { subdomain } = normalized;

  if (subdomain) {
    const taken = await env.DB.prepare("SELECT id FROM photographers WHERE subdomain = ? AND id != ?")
      .bind(subdomain, photographerId)
      .first();
    if (taken) return fail(409, "Ce sous-domaine est déjà pris");
  }
  try {
    await env.DB.prepare("UPDATE photographers SET subdomain = ? WHERE id = ?").bind(subdomain, photographerId).run();
  } catch {
    // L'index unique tranche en cas de course entre deux comptes.
    return fail(409, "Ce sous-domaine est déjà pris");
  }
  return json({ ok: true, subdomain });
}
