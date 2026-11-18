// Adresse d'envoi au nom du studio (formule Pro) : les relances et les
// campagnes partent de « bonjour@studio-lumiere.be » plutôt que d'une
// adresse Holypixx — plus personnel, et mieux reçu par les messageries.
//
// Le domaine est déclaré chez Resend (le service d'envoi de Holypixx) ;
// Resend donne les enregistrements DNS à ajouter chez l'hébergeur du nom de
// domaine (SPF, DKIM, et un MX de retour) ; une fois vérifié, l'expéditeur
// devient « Studio Lumière <bonjour@studio-lumiere.be> ».
//
//   GET    /api/admin/mailing/sender           état, enregistrements à ajouter
//   POST   /api/admin/mailing/sender           { domain, localPart } : déclarer
//   POST   /api/admin/mailing/sender/verify    relancer la vérification
//   DELETE /api/admin/mailing/sender           revenir à l'adresse Holypixx

import { json, fail } from "./http.js";
import { hasFeature, featureRefusal } from "./subscription.js";
import { now, senderFor } from "./mailing.js";

const DOMAIN_RE = /^(?=.{4,253}$)(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;
const LOCAL_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
// Domaines de messagerie publics : impossible de prouver qu'ils sont à soi.
const PUBLIC_DOMAINS = ["gmail.com", "googlemail.com", "hotmail.com", "hotmail.fr", "hotmail.be", "outlook.com", "outlook.fr", "live.com", "live.be",
  "yahoo.com", "yahoo.fr", "icloud.com", "me.com", "skynet.be", "telenet.be", "proximus.be", "voo.be", "orange.fr", "free.fr", "sfr.fr", "gmx.com", "proton.me", "protonmail.com"];

async function resend(env, method, path, body) {
  if (!env.RESEND_API_KEY) return { error: "Le service d'envoi n'est pas configuré" };
  try {
    const response = await fetch(`https://api.resend.com${path}`, {
      method,
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { error: data?.message || `Resend : erreur ${response.status}`, status: response.status };
    return { data };
  } catch (err) {
    return { error: "Resend est injoignable : réessayez dans un instant" };
  }
}

function recordsOut(records) {
  return (Array.isArray(records) ? records : []).map((r) => ({
    type: r.type || "", name: r.name || "", value: r.value || "", priority: r.priority ?? null, ttl: r.ttl || "Auto", status: r.status || "",
  }));
}

function statusOf(resendStatus) {
  return resendStatus === "verified" ? "verified" : resendStatus === "failed" ? "failed" : "pending";
}

async function stateFor(env, photographer) {
  const row = await env.DB.prepare("SELECT * FROM sender_domains WHERE photographer_id = ?").bind(photographer.id).first();
  return {
    available: hasFeature(env, photographer, "campaigns"),
    from: await senderFor(env, photographer),
    domain: row ? {
      domain: row.domain, localPart: row.local_part, address: `${row.local_part}@${row.domain}`, status: row.status,
      records: JSON.parse(row.records || "[]"), checkedAt: row.checked_at, verifiedAt: row.verified_at,
    } : null,
  };
}

// Relit l'état chez Resend (vérification asynchrone de leur côté).
async function refresh(env, photographer, row, { verify } = {}) {
  if (!row?.resend_id) return;
  if (verify) await resend(env, "POST", `/domains/${encodeURIComponent(row.resend_id)}/verify`);
  const got = await resend(env, "GET", `/domains/${encodeURIComponent(row.resend_id)}`);
  if (got.error) return;
  const status = statusOf(got.data?.status);
  await env.DB.prepare("UPDATE sender_domains SET status = ?, records = ?, checked_at = ?, verified_at = CASE WHEN ? = 'verified' THEN COALESCE(verified_at, ?) ELSE verified_at END WHERE photographer_id = ?")
    .bind(status, JSON.stringify(recordsOut(got.data?.records || JSON.parse(row.records || "[]"))), now(), status, now(), photographer.id).run();
}

export async function handleSenderAdmin(request, env, photographer, parts) {
  const method = request.method;
  const row = await env.DB.prepare("SELECT * FROM sender_domains WHERE photographer_id = ?").bind(photographer.id).first();

  if (!parts.length && method === "GET") {
    // Un domaine en attente : on regarde où en est la vérification (une fois par minute au plus).
    if (row && row.status !== "verified" && (!row.checked_at || row.checked_at < now() - 60)) await refresh(env, photographer, row);
    return json(await stateFor(env, photographer));
  }
  if (!parts.length && method === "POST") {
    if (!hasFeature(env, photographer, "campaigns")) return featureRefusal(env, photographer, "campaigns");
    const body = await request.json().catch(() => ({}));
    const domain = String(body.domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    const localPart = String(body.localPart || "bonjour").trim().toLowerCase();
    if (!DOMAIN_RE.test(domain)) return fail(400, "Nom de domaine invalide (ex. studio-lumiere.be)");
    if (PUBLIC_DOMAINS.includes(domain) || domain.endsWith("holypixx.com")) return fail(400, "Il faut un nom de domaine à vous (pas Gmail, Outlook…)");
    if (!LOCAL_RE.test(localPart)) return fail(400, "Début d'adresse invalide (ex. bonjour)");
    // Même domaine : on change seulement le début de l'adresse.
    if (row && row.domain === domain) {
      await env.DB.prepare("UPDATE sender_domains SET local_part = ? WHERE photographer_id = ?").bind(localPart, photographer.id).run();
      return json(await stateFor(env, photographer));
    }
    if (row?.resend_id) await resend(env, "DELETE", `/domains/${encodeURIComponent(row.resend_id)}`);
    const created = await resend(env, "POST", "/domains", { name: domain, region: "eu-west-1" });
    if (created.error) {
      return fail(created.status === 422 || created.status === 409 ? 409 : 502,
        created.status === 422 || created.status === 409 ? "Ce domaine est déjà déclaré : contactez-nous pour le récupérer" : created.error);
    }
    await env.DB.prepare(
      `INSERT INTO sender_domains (photographer_id, domain, local_part, resend_id, status, records, checked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(photographer_id) DO UPDATE SET domain = excluded.domain, local_part = excluded.local_part, resend_id = excluded.resend_id,
         status = excluded.status, records = excluded.records, checked_at = excluded.checked_at, verified_at = NULL, created_at = excluded.created_at`
    ).bind(photographer.id, domain, localPart, created.data?.id || "", statusOf(created.data?.status), JSON.stringify(recordsOut(created.data?.records)), now(), now()).run();
    return json(await stateFor(env, photographer), { status: 201 });
  }
  if (parts[0] === "verify" && method === "POST") {
    if (!row) return fail(404, "Aucun domaine déclaré");
    await refresh(env, photographer, row, { verify: true });
    return json(await stateFor(env, photographer));
  }
  if (!parts.length && method === "DELETE") {
    if (row?.resend_id) await resend(env, "DELETE", `/domains/${encodeURIComponent(row.resend_id)}`);
    await env.DB.prepare("DELETE FROM sender_domains WHERE photographer_id = ?").bind(photographer.id).run();
    return json(await stateFor(env, photographer));
  }
  return fail(404, "Route inconnue");
}
