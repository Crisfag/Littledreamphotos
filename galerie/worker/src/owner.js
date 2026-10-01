// Page propriétaire : vue d'ensemble de toute la plateforme, tous
// photographes confondus (comptes créés, activité, argent qui transite) —
// jamais accessible à un compte normal, même en connaissant les URLs.
//
// Chaque fonction ici revérifie elle-même l'identité de l'appelant
// (comparaison de son e-mail à OWNER_EMAIL, en relisant sa ligne en base)
// plutôt que de se fier au champ `isOwner` renvoyé au client par
// authPhotographer.js : ce champ n'est qu'un indicateur d'affichage, jamais
// une autorisation en soi.

import { json, fail } from "./http.js";
import { authenticatePhotographer } from "./authPhotographer.js";
import { supplementFor } from "./admin.js";
import { runReminders } from "./reminders.js";

async function requireOwner(env, photographerId) {
  if (!env.OWNER_EMAIL) return null;
  const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?")
    .bind(photographerId)
    .first();
  if (!photographer || photographer.email !== env.OWNER_EMAIL) return null;
  return photographer;
}

// Tous les comptes de la plateforme, avec de quoi les identifier et jauger
// leur activité — jamais les mots de passe ni rien qui n'appartienne pas
// déjà à chaque photographe sur son propre profil.
async function listPhotographers(env, photographerId) {
  const owner = await requireOwner(env, photographerId);
  if (!owner) return fail(403, "Accès réservé");

  const { results } = await env.DB.prepare(
    `SELECT p.id, p.email, p.first_name, p.last_name, p.studio_name, p.created_at,
            p.stripe_charges_enabled,
            (SELECT COUNT(*) FROM galleries g WHERE g.photographer_id = p.id) AS galleries_count,
            (SELECT COUNT(*) FROM photos ph JOIN galleries g ON g.id = ph.gallery_id
             WHERE g.photographer_id = p.id) AS photos_count
     FROM photographers p ORDER BY p.created_at DESC`
  ).all();

  const photographers = results.map((p) => ({
    id: p.id,
    email: p.email,
    firstName: p.first_name || "",
    lastName: p.last_name || "",
    studioName: p.studio_name || "",
    createdAt: p.created_at,
    galleriesCount: p.galleries_count,
    photosCount: p.photos_count,
    stripeChargesEnabled: Boolean(p.stripe_charges_enabled),
  }));

  return json({ photographers });
}

// Compteurs plateforme — même calcul que getStats (admin.js), mais sans
// filtrer par photographer_id : c'est tout l'intérêt de cette vue-ci.
async function platformStats(env, photographerId) {
  const owner = await requireOwner(env, photographerId);
  if (!owner) return fail(403, "Accès réservé");

  const photographersRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM photographers").first();
  const galleriesRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM galleries").first();
  const photosRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM photos").first();

  const salesRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS amount_cents,
            COALESCE(SUM(extra_count), 0) AS extra_count
     FROM payments WHERE status = 'paid'`
  ).first();

  // Suppléments encore dus, toutes galeries confondues : même calcul que
  // listGalleries/getStats (admin.js), recalculé plutôt que stocké — un
  // client peut toujours sélectionner plus de photos après un premier
  // paiement.
  const { results: galleries } = await env.DB.prepare(
    `SELECT g.included_photos, g.extra_photo_price_cents,
            (SELECT COUNT(*) FROM photos p WHERE p.gallery_id = g.id AND p.selected = 1) AS selected_count,
            (SELECT COALESCE(SUM(extra_count), 0) FROM payments
             WHERE payments.gallery_id = g.id AND payments.status = 'paid') AS paid_extra_count
     FROM galleries g`
  ).all();

  let dueExtraCount = 0;
  let dueTotalCents = 0;
  for (const g of galleries) {
    const supplement = supplementFor(g.included_photos, g.extra_photo_price_cents, g.selected_count, g.paid_extra_count);
    dueExtraCount += supplement.dueExtraCount;
    dueTotalCents += supplement.dueTotalCents;
  }

  // Inscriptions par mois (12 derniers mois) — un simple décompte, assez
  // pour voir la croissance d'un coup d'œil sans construire un vrai système
  // de séries temporelles pour une seule page.
  const { results: signupRows } = await env.DB.prepare(
    `SELECT strftime('%Y-%m', created_at, 'unixepoch') AS month, COUNT(*) AS n
     FROM photographers GROUP BY month ORDER BY month DESC LIMIT 12`
  ).all();

  return json({
    photographersCount: photographersRow?.n || 0,
    galleriesCount: galleriesRow?.n || 0,
    photosCount: photosRow?.n || 0,
    salesCount: salesRow?.n || 0,
    salesAmountCents: salesRow?.amount_cents || 0,
    extrasPaidCount: salesRow?.extra_count || 0,
    extrasDueCount: dueExtraCount,
    extrasDueAmountCents: dueTotalCents,
    signupsByMonth: signupRows.map((r) => ({ month: r.month, count: r.n })),
  });
}

export async function handleOwner(request, env, path) {
  const photographerId = await authenticatePhotographer(request, env);
  if (!photographerId) return fail(401, "Session invalide ou expirée");

  const parts = path.split("/").filter(Boolean); // api, owner, action
  const action = parts[2];
  if (action === "photographers" && parts.length === 3 && request.method === "GET") {
    return listPhotographers(env, photographerId);
  }
  if (action === "stats" && parts.length === 3 && request.method === "GET") {
    return platformStats(env, photographerId);
  }
  // Lance la passe de relances tout de suite, sans attendre le déclencheur
  // quotidien — même passe, mêmes garde-fous (jamais deux fois la même).
  if (action === "reminders" && parts[3] === "run" && parts.length === 4 && request.method === "POST") {
    const owner = await requireOwner(env, photographerId);
    if (!owner) return fail(403, "Accès réservé");
    return json(await runReminders(env));
  }
  return fail(404, "Route inconnue");
}
