// Droits des personnes (RGPD) côté photographe : export de toutes ses
// données dans un fichier lisible (portabilité, art. 20), suppression
// définitive du compte (effacement, art. 17), et purge automatique des
// journaux d'accès anciens (limitation de la conservation, art. 5).
//
// Les données des clients d'un photographe (nom, e-mail, sélections,
// adresse de livraison…) sont traitées pour son compte : Holypixx n'en est
// que sous-traitant. Elles figurent donc dans l'export du photographe et
// disparaissent avec son compte.

import { json, fail } from "./http.js";
import { verifyPassword } from "./auth.js";

// Version des conditions acceptées à l'inscription (date de publication des
// pages legales du site, voir web/conditions.html).
export const TERMS_VERSION = "2026-10-06";

// Journaux d'accès aux galeries conservés 13 mois, puis effacés.
export const ACCESS_LOG_RETENTION_SECONDS = 395 * 24 * 60 * 60;

function now() {
  return Math.floor(Date.now() / 1000);
}

async function all(env, sql, ...binds) {
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return results;
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// Tout ce que la plateforme conserve pour ce compte — sauf ce qui ne doit
// jamais sortir : empreintes de mots de passe, clé Prodigi chiffrée.
export async function exportAccount(env, photographerId) {
  const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(photographerId).first();
  if (!photographer) return fail(401, "Session invalide");
  const account = { ...photographer };
  for (const secret of ["password_hash", "password_salt", "prodigi_api_key_enc"]) delete account[secret];
  account.prodigi_api_key = photographer.prodigi_api_key_enc ? "(enregistrée, non exportée)" : "";

  const galleries = await all(env, "SELECT * FROM galleries WHERE photographer_id = ? ORDER BY created_at ASC", photographerId);
  const out = [];
  for (const gallery of galleries) {
    const g = { ...gallery };
    delete g.password_hash;
    delete g.password_salt;
    g.photos = (await all(env,
      `SELECT id, position, width, height, selected, selected_at, comment, comment_at, tag, marks, has_original, created_at
       FROM photos WHERE gallery_id = ? ORDER BY position ASC`, gallery.id))
      .map((p) => ({ ...p, marks: parseJson(p.marks || "[]", []) }));
    g.access_log = await all(env,
      "SELECT event, detail, photo_id, viewer_id, user_agent, ts FROM access_log WHERE gallery_id = ? ORDER BY ts ASC", gallery.id);
    g.payments = await all(env, "SELECT * FROM payments WHERE gallery_id = ? ORDER BY created_at ASC", gallery.id);
    g.delivery_files = await all(env, "SELECT id, name, size, created_at FROM delivery_files WHERE gallery_id = ? ORDER BY position ASC", gallery.id);
    out.push(g);
  }

  const data = {
    format: "holypixx-export-1",
    exported_at: new Date().toISOString(),
    note: "Données de votre compte Holypixx. Les photos elles-mêmes (tuiles, fichiers livrés) ne sont pas incluses : vous en avez les originaux.",
    account,
    galleries: out,
    invoices: await all(env, "SELECT id, gallery_id, number, amount_cents, issued_at FROM invoices WHERE photographer_id = ? ORDER BY issued_at ASC", photographerId),
    print_products: await all(env, "SELECT * FROM print_products WHERE photographer_id = ? ORDER BY position ASC", photographerId),
    print_orders: (await all(env, "SELECT * FROM print_orders WHERE photographer_id = ? ORDER BY created_at ASC", photographerId))
      .map((o) => ({ ...o, items: parseJson(o.items || "[]", []), recipient: parseJson(o.recipient || "{}", {}) })),
    portfolio: (await all(env, "SELECT * FROM portfolios WHERE photographer_id = ?", photographerId))
      .map((p) => ({ ...p, services: parseJson(p.services || "[]", []) }))[0] || null,
    portfolio_photos: await all(env, "SELECT id, position, width, height, bytes, created_at FROM portfolio_photos WHERE photographer_id = ? ORDER BY position ASC", photographerId),
    portfolio_messages: await all(env,
      "SELECT id, name, email, phone, event_date, message, read_at, created_at FROM portfolio_messages WHERE photographer_id = ? ORDER BY created_at ASC", photographerId),
  };
  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="holypixx-mes-donnees-${day}.json"`,
      "cache-control": "no-store",
    },
  });
}

// Suppression définitive : mot de passe redemandé (une session volée ne
// suffit pas), puis chaque galerie effacée comme depuis la fiche (fichiers
// R2 compris), puis le compte — les tables liées suivent (ON DELETE CASCADE).
export async function deleteAccount(request, env, photographerId, deleteGalleryFiles, deleteOtherFiles = async () => {}) {
  const body = await request.json().catch(() => null);
  const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(photographerId).first();
  if (!photographer) return fail(401, "Session invalide");
  if (body?.confirm !== "SUPPRIMER") return fail(400, "Confirmation manquante");
  const ok = await verifyPassword(String(body?.password || ""), photographer.password_hash, photographer.password_salt);
  if (!ok) return fail(400, "Mot de passe incorrect");

  const galleries = await all(env, "SELECT id, slug FROM galleries WHERE photographer_id = ?", photographerId);
  for (const gallery of galleries) await deleteGalleryFiles(gallery);
  await deleteOtherFiles();

  await env.DB.batch([
    ...galleries.map((g) => env.DB.prepare("DELETE FROM access_log WHERE gallery_id = ?").bind(g.id)),
    env.DB.prepare("DELETE FROM galleries WHERE photographer_id = ?").bind(photographerId),
    env.DB.prepare("DELETE FROM photographers WHERE id = ?").bind(photographerId),
  ]);
  return json({ ok: true, deletedGalleries: galleries.length });
}

// Passe quotidienne (déclencheur planifié) : efface les journaux d'accès
// plus vieux que la durée de conservation annoncée.
export async function purgeOldAccessLogs(env) {
  const result = await env.DB.prepare("DELETE FROM access_log WHERE ts < ?")
    .bind(now() - ACCESS_LOG_RETENTION_SECONDS)
    .run();
  return result?.meta?.changes || 0;
}
