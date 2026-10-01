// API côté photographe : création de galeries, envoi des tuiles, journaux.
// Protégée par une session de compte photographe (Authorization: Bearer …,
// jeton obtenu via /api/auth/login) — jamais par un jeton partagé entre tous
// les photographes. Chaque requête est cloisonnée : un photographe ne peut
// lire, modifier ou lister que ses propres galeries, jamais celles d'un
// autre compte.

import { json, fail } from "./http.js";
import { parseMarks } from "./marks.js";
import { hashPassword, randomBytes, b64url } from "./auth.js";
import { authenticatePhotographer } from "./authPhotographer.js";
import { connectStripe, refreshStripeStatus, setBillingProfile } from "./billing.js";
import { updateStudioName, updateName, changePassword, requestEmailChange, updateDefaults, updateReminders, updateSubdomain } from "./account.js";

function now() {
  return Math.floor(Date.now() / 1000);
}

function newId(prefix) {
  return `${prefix}_${b64url(randomBytes(9))}`;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;
// Volontairement permissive (pas de validation RFC complète) : ce champ ne
// sert qu'à recevoir la facture, jamais à authentifier qui que ce soit — un
// format grossièrement valide suffit à éviter les fautes de frappe évidentes.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Prix saisi par le photographe en euros (ex. "15", "15.5") converti en
// centimes — l'unité stockée, qui évite les erreurs d'arrondi d'un flottant.
// Vide/absent = 0 (pas de supplément facturé) ; une valeur invalide ou
// négative est signalée à l'appelant plutôt que silencieusement ramenée à 0.
function priceToCents(value) {
  if (value === undefined || value === null || value === "") return 0;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

// Photos au-delà du forfait et montants correspondants. `includedPhotos` à
// null signifie qu'aucun forfait n'a été défini pour cette galerie : jamais
// de supplément calculé, quel que soit le nombre de coups de cœur.
// `paidExtraCount` (somme des règlements confirmés par le webhook Stripe,
// voir schema.sql) est toujours déduit du brut : c'est ce qui distingue ce
// qui est dû aujourd'hui de ce que le client a déjà réglé, si jamais il
// sélectionne encore plus de photos après un premier paiement.
export function supplementFor(includedPhotos, extraPhotoPriceCents, selectedCount, paidExtraCount) {
  if (includedPhotos === null || includedPhotos === undefined) {
    return { extraCount: 0, extraTotalCents: 0, paidExtraCount: 0, dueExtraCount: 0, dueTotalCents: 0 };
  }
  const extraCount = Math.max(0, selectedCount - includedPhotos);
  const paid = Math.min(extraCount, paidExtraCount || 0);
  const due = Math.max(0, extraCount - paid);
  return {
    extraCount,
    extraTotalCents: extraCount * extraPhotoPriceCents,
    paidExtraCount: paid,
    dueExtraCount: due,
    dueTotalCents: due * extraPhotoPriceCents,
  };
}

// Vérifie que la galerie désignée par `slug` existe et appartient bien au
// photographe appelant. Renvoie la ligne complète, ou null.
async function ownedGallery(env, photographerId, slug) {
  return env.DB.prepare("SELECT * FROM galleries WHERE slug = ? AND photographer_id = ?")
    .bind(slug, photographerId)
    .first();
}

// Même vérification en partant d'une photo : on remonte à sa galerie pour
// s'assurer qu'elle appartient au photographe appelant. Utilisé par les
// routes de tuiles, qui n'ont que l'identifiant de la photo, pas le slug.
async function ownedPhoto(env, photographerId, photoId) {
  return env.DB.prepare(
    `SELECT p.* FROM photos p
     JOIN galleries g ON g.id = p.gallery_id
     WHERE p.id = ? AND g.photographer_id = ?`
  )
    .bind(photoId, photographerId)
    .first();
}

async function createGallery(request, env, photographerId) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }

  const slug = String(body.slug || "").toLowerCase();
  if (!SLUG_RE.test(slug)) {
    return fail(400, "Slug invalide (minuscules, chiffres et tirets, 2 à 61 caractères)");
  }
  const password = String(body.password || "");
  if (password.length < 8) return fail(400, "Mot de passe trop court (8 caractères minimum)");

  const clientEmail = String(body.clientEmail || "").trim().slice(0, 200);
  if (clientEmail && !EMAIL_RE.test(clientEmail)) return fail(400, "E-mail du client invalide");

  // Forfait facultatif : nombre de photos déjà payées par le client. Non
  // renseigné = pas de forfait (aucun supplément jamais calculé).
  let includedPhotos = null;
  if (body.includedPhotos !== undefined && body.includedPhotos !== null && body.includedPhotos !== "") {
    includedPhotos = Number(body.includedPhotos);
    if (!Number.isInteger(includedPhotos) || includedPhotos < 0) {
      return fail(400, "Nombre de photos incluses invalide");
    }
  }
  const extraPhotoPriceCents = priceToCents(body.extraPhotoPrice);
  if (extraPhotoPriceCents === null) return fail(400, "Prix du supplément invalide");

  // Les slugs forment l'URL publique de la galerie : ils doivent rester
  // uniques sur toute la plateforme, pas seulement pour ce photographe.
  const existing = await env.DB.prepare("SELECT id FROM galleries WHERE slug = ?")
    .bind(slug)
    .first();
  if (existing) return fail(409, "Ce slug est déjà utilisé");

  const { hash, salt } = await hashPassword(password);
  const id = newId("gal");

  // Mise en page de départ : celle choisie par défaut dans les paramètres du
  // compte (voir account.js), jamais imposée — modifiable au cas par cas
  // ensuite comme n'importe quelle galerie déjà créée.
  const photographer = await env.DB.prepare("SELECT default_layout FROM photographers WHERE id = ?")
    .bind(photographerId)
    .first();

  await env.DB.prepare(
    `INSERT INTO galleries
       (id, photographer_id, slug, title, client_name, client_email, password_hash, password_salt, watermark_text, expires_at,
        included_photos, extra_photo_price_cents, layout, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      photographerId,
      slug,
      String(body.title || slug).slice(0, 120),
      String(body.clientName || "").slice(0, 120),
      clientEmail,
      hash,
      salt,
      String(body.watermarkText || "").slice(0, 120),
      body.expiresAt ? Number(body.expiresAt) : null,
      includedPhotos,
      extraPhotoPriceCents,
      photographer?.default_layout || "grille",
      now()
    )
    .run();

  return json({ id, slug }, { status: 201 });
}

async function listGalleries(env, photographerId) {
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.slug, g.title, g.client_name, g.expires_at, g.created_at,
            g.included_photos, g.extra_photo_price_cents, g.selection_done_at,
            (SELECT COUNT(*) FROM photos p WHERE p.gallery_id = g.id) AS photo_count,
            (SELECT COUNT(*) FROM photos p WHERE p.gallery_id = g.id AND p.selected = 1) AS selected_count,
            (SELECT COUNT(*) FROM photos p WHERE p.gallery_id = g.id AND p.comment != '') AS comment_count,
            (SELECT COALESCE(SUM(extra_count), 0) FROM payments WHERE payments.gallery_id = g.id AND payments.status = 'paid') AS paid_extra_count
     FROM galleries g WHERE g.photographer_id = ? ORDER BY g.created_at DESC`
  )
    .bind(photographerId)
    .all();

  const galleries = results.map((g) => {
    const supplement = supplementFor(g.included_photos, g.extra_photo_price_cents, g.selected_count, g.paid_extra_count);
    return {
      ...g,
      extra_count: supplement.extraCount,
      extra_total_cents: supplement.extraTotalCents,
      due_extra_count: supplement.dueExtraCount,
      due_total_cents: supplement.dueTotalCents,
    };
  });
  return json({ galleries });
}

async function getGallery(env, photographerId, slug) {
  const gallery = await ownedGallery(env, photographerId, slug);
  if (!gallery) return fail(404, "Galerie introuvable");

  const { results: photos } = await env.DB.prepare(
    `SELECT id, position, width, height, cols, rows, preview_width, preview_height,
            forensic_id, selected, selected_at, comment, comment_at, tag, marks, created_at
     FROM photos WHERE gallery_id = ? ORDER BY position ASC, created_at ASC`
  )
    .bind(gallery.id)
    .all();
  for (const photo of photos) {
    photo.tag = photo.tag || "";
    photo.marks = parseMarks(photo.marks);
  }

  const selectedCount = photos.filter((p) => p.selected).length;

  const { results: payments } = await env.DB.prepare(
    `SELECT payments.id, payments.extra_count, payments.amount_cents, payments.status,
            payments.created_at, payments.paid_at,
            invoices.id AS invoice_id, invoices.number AS invoice_number, invoices.emailed_to AS invoice_emailed_to
     FROM payments LEFT JOIN invoices ON invoices.payment_id = payments.id
     WHERE payments.gallery_id = ? ORDER BY payments.created_at DESC`
  )
    .bind(gallery.id)
    .all();
  const paidExtraCountTotal = payments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.extra_count, 0);

  const supplement = supplementFor(gallery.included_photos, gallery.extra_photo_price_cents, selectedCount, paidExtraCountTotal);

  return json({
    gallery: {
      id: gallery.id,
      slug: gallery.slug,
      title: gallery.title,
      client_name: gallery.client_name,
      client_email: gallery.client_email,
      watermark_text: gallery.watermark_text,
      expires_at: gallery.expires_at,
      created_at: gallery.created_at,
      login_background_type: gallery.login_background_type,
      login_background_color: gallery.login_background_color,
      layout: gallery.layout,
      music_name: gallery.music_name || "",
      selection_done_at: gallery.selection_done_at,
      included_photos: gallery.included_photos,
      extra_photo_price_cents: gallery.extra_photo_price_cents,
      selected_count: selectedCount,
      extra_count: supplement.extraCount,
      extra_total_cents: supplement.extraTotalCents,
      paid_extra_count: supplement.paidExtraCount,
      due_extra_count: supplement.dueExtraCount,
      due_total_cents: supplement.dueTotalCents,
    },
    photos,
    payments,
  });
}

// Remplace le mot de passe d'une galerie — l'ancien cesse aussitôt de
// fonctionner. Le mot de passe n'étant jamais stocké qu'en empreinte à sens
// unique, c'est la seule façon d'en redonner un valide au photographe s'il a
// perdu celui affiché à la création : pas de « récupération », une rotation.
async function regeneratePassword(request, env, photographerId, slug) {
  const gallery = await ownedGallery(env, photographerId, slug);
  if (!gallery) return fail(404, "Galerie introuvable");

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const password = String(body.password || "");
  if (password.length < 8) return fail(400, "Mot de passe trop court (8 caractères minimum)");

  const { hash, salt } = await hashPassword(password);
  await env.DB.prepare("UPDATE galleries SET password_hash = ?, password_salt = ? WHERE id = ?")
    .bind(hash, salt, gallery.id)
    .run();

  return json({ ok: true });
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ALLOWED_LAYOUTS = new Set(["grille", "mosaique", "defilement"]);

// Couleur unie (ou remise à la couleur par défaut si `color` est vide).
// N'affecte jamais une éventuelle image déjà stockée dans R2 — juste le
// type actif, comme un interrupteur entre les deux façons de personnaliser.
async function setBackgroundColor(request, env, photographerId, slug) {
  const gallery = await ownedGallery(env, photographerId, slug);
  if (!gallery) return fail(404, "Galerie introuvable");

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const color = String(body.color || "");
  if (color && !HEX_COLOR_RE.test(color)) return fail(400, "Couleur invalide (format #rrggbb)");

  await env.DB.prepare(
    "UPDATE galleries SET login_background_type = 'color', login_background_color = ? WHERE id = ?"
  )
    .bind(color, gallery.id)
    .run();

  return json({ ok: true });
}

// Image d'ambiance importée par le photographe — jamais une photo de la
// galerie elle-même (voir le commentaire sur la colonne dans schema.sql) :
// l'appelant (admin-server.mjs) est responsable de fournir une image déjà
// redimensionnée, ce Worker se contente de la stocker.
async function setBackgroundImage(request, env, photographerId, slug) {
  const gallery = await ownedGallery(env, photographerId, slug);
  if (!gallery) return fail(404, "Galerie introuvable");

  await env.TILES.put(`backgrounds/${gallery.id}.jpg`, request.body, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  await env.DB.prepare("UPDATE galleries SET login_background_type = 'image' WHERE id = ?")
    .bind(gallery.id)
    .run();

  return json({ ok: true });
}

// Retour à la couleur par défaut de la marque. L'éventuelle image importée
// reste dans R2 (pas de suppression immédiate) — orpheline mais inoffensive,
// jamais servie tant que login_background_type n'est pas « image ».
async function resetBackground(env, photographerId, slug) {
  const gallery = await ownedGallery(env, photographerId, slug);
  if (!gallery) return fail(404, "Galerie introuvable");

  await env.DB.prepare(
    "UPDATE galleries SET login_background_type = 'color', login_background_color = '' WHERE id = ?"
  )
    .bind(gallery.id)
    .run();

  return json({ ok: true });
}

// Musique d'ambiance : un seul fichier par galerie, remplacé à chaque envoi.
// L'appelant (admin-server.mjs) a déjà vérifié le type et la taille ; ici on
// se contente de stocker, avec un garde-fou sur la taille annoncée pour ne
// jamais remplir R2 avec un fichier aberrant.
const MAX_MUSIC_BYTES = 15 * 1024 * 1024;

async function setMusic(request, env, photographerId, slug) {
  const gallery = await ownedGallery(env, photographerId, slug);
  if (!gallery) return fail(404, "Galerie introuvable");

  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_MUSIC_BYTES) return fail(413, "Fichier trop volumineux (15 Mo maximum)");

  const url = new URL(request.url);
  const name = (url.searchParams.get("name") || "musique.mp3").slice(0, 120);

  await env.TILES.put(`music/${gallery.id}.mp3`, request.body, {
    httpMetadata: { contentType: "audio/mpeg" },
  });
  await env.DB.prepare("UPDATE galleries SET music_name = ? WHERE id = ?")
    .bind(name, gallery.id)
    .run();

  return json({ ok: true, musicName: name });
}

async function deleteMusic(env, photographerId, slug) {
  const gallery = await ownedGallery(env, photographerId, slug);
  if (!gallery) return fail(404, "Galerie introuvable");

  await env.TILES.delete(`music/${gallery.id}.mp3`);
  await env.DB.prepare("UPDATE galleries SET music_name = '' WHERE id = ?")
    .bind(gallery.id)
    .run();

  return json({ ok: true });
}

// Mise en page proposée au client — purement visuel (voir schema.sql) :
// n'affecte ni les tuiles servies, ni leur niveau de définition.
async function setLayout(request, env, photographerId, slug) {
  const gallery = await ownedGallery(env, photographerId, slug);
  if (!gallery) return fail(404, "Galerie introuvable");

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const layout = String(body.layout || "");
  if (!ALLOWED_LAYOUTS.has(layout)) return fail(400, "Mise en page inconnue");

  await env.DB.prepare("UPDATE galleries SET layout = ? WHERE id = ?")
    .bind(layout, gallery.id)
    .run();

  return json({ ok: true });
}

// Forfait et prix du supplément — modifiables après coup : le photographe ne
// connaît pas toujours ces chiffres dès la création de la galerie.
async function setQuota(request, env, photographerId, slug) {
  const gallery = await ownedGallery(env, photographerId, slug);
  if (!gallery) return fail(404, "Galerie introuvable");

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }

  let includedPhotos = null;
  if (body.includedPhotos !== undefined && body.includedPhotos !== null && body.includedPhotos !== "") {
    includedPhotos = Number(body.includedPhotos);
    if (!Number.isInteger(includedPhotos) || includedPhotos < 0) {
      return fail(400, "Nombre de photos incluses invalide");
    }
  }
  const extraPhotoPriceCents = priceToCents(body.extraPhotoPrice);
  if (extraPhotoPriceCents === null) return fail(400, "Prix du supplément invalide");

  await env.DB.prepare("UPDATE galleries SET included_photos = ?, extra_photo_price_cents = ? WHERE id = ?")
    .bind(includedPhotos, extraPhotoPriceCents, gallery.id)
    .run();

  return json({ ok: true });
}

async function deleteGallery(env, photographerId, slug) {
  const gallery = await ownedGallery(env, photographerId, slug);
  if (!gallery) return fail(404, "Galerie introuvable");

  // R2 ne supprime pas récursivement : on liste puis on efface par lots.
  let cursor;
  do {
    const listed = await env.TILES.list({ prefix: `${gallery.id}/`, cursor });
    if (listed.objects.length) {
      await env.TILES.delete(listed.objects.map((o) => o.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  // Sous des préfixes distincts des tuiles (backgrounds/, music/ — pas
  // ${gallery.id}/) : la boucle ci-dessus ne les voit pas, il faut les
  // effacer explicitement.
  await env.TILES.delete([`backgrounds/${gallery.id}.jpg`, `music/${gallery.id}.mp3`]);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM photos WHERE gallery_id = ?").bind(gallery.id),
    env.DB.prepare("DELETE FROM access_log WHERE gallery_id = ?").bind(gallery.id),
    env.DB.prepare("DELETE FROM galleries WHERE id = ?").bind(gallery.id),
  ]);

  return json({ ok: true });
}

async function addPhoto(request, env, photographerId, slug) {
  const gallery = await ownedGallery(env, photographerId, slug);
  if (!gallery) return fail(404, "Galerie introuvable");

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }

  const width = Number(body.width);
  const height = Number(body.height);
  const cols = Number(body.cols);
  const rows = Number(body.rows);
  if (![width, height, cols, rows].every((n) => Number.isInteger(n) && n > 0)) {
    return fail(400, "Dimensions invalides");
  }
  if (cols > 12 || rows > 12) return fail(400, "Trop de tuiles (12 × 12 maximum)");

  // L'outil de préparation fournit l'identifiant : l'empreinte invisible en
  // dérive, il doit donc être fixé avant la gravure des pixels.
  const provided = String(body.id || "");
  if (provided && !/^pho_[A-Za-z0-9_-]{6,40}$/.test(provided)) {
    return fail(400, "Identifiant de photo invalide");
  }
  const id = provided || newId("pho");
  if (provided) {
    const clash = await env.DB.prepare("SELECT id FROM photos WHERE id = ?").bind(id).first();
    if (clash) return fail(409, "Identifiant de photo déjà utilisé");
  }

  await env.DB.prepare(
    `INSERT INTO photos
       (id, gallery_id, position, width, height, cols, rows,
        preview_width, preview_height, forensic_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      gallery.id,
      Number.isInteger(Number(body.position)) ? Number(body.position) : 0,
      width,
      height,
      cols,
      rows,
      Number(body.previewWidth) || 0,
      Number(body.previewHeight) || 0,
      String(body.forensicId || "").slice(0, 64),
      now()
    )
    .run();

  return json({ id, galleryId: gallery.id }, { status: 201 });
}

async function deletePhoto(env, photographerId, slug, photoId) {
  const gallery = await ownedGallery(env, photographerId, slug);
  if (!gallery) return fail(404, "Galerie introuvable");

  const photo = await env.DB.prepare("SELECT id FROM photos WHERE id = ? AND gallery_id = ?")
    .bind(photoId, gallery.id)
    .first();
  if (!photo) return fail(404, "Photo introuvable");

  let cursor;
  do {
    const listed = await env.TILES.list({ prefix: `${gallery.id}/${photoId}/`, cursor });
    if (listed.objects.length) {
      await env.TILES.delete(listed.objects.map((o) => o.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  await env.DB.prepare("DELETE FROM photos WHERE id = ?").bind(photoId).run();
  return json({ ok: true });
}

async function putTile(request, env, photographerId, photoId, level, col, row) {
  const photo = await ownedPhoto(env, photographerId, photoId);
  if (!photo) return fail(404, "Photo introuvable");
  if (level !== 0 && level !== 1) return fail(400, "Niveau inconnu");
  const cols = level === 0 ? 2 : photo.cols;
  const rows = level === 0 ? 2 : photo.rows;
  if (!(col >= 0 && col < cols && row >= 0 && row < rows)) {
    return fail(400, "Coordonnées de tuile hors limites");
  }

  await env.TILES.put(`${photo.gallery_id}/${photoId}/${level}/${col}_${row}.jpg`, request.body, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  return json({ ok: true });
}

// Lecture d'une tuile côté administration : sert à afficher de vraies
// vignettes dans l'interface d'admin, sans passer par une session client.
async function getTile(env, photographerId, photoId, level, col, row) {
  const photo = await ownedPhoto(env, photographerId, photoId);
  if (!photo) return fail(404, "Photo introuvable");
  if (level !== 0 && level !== 1) return fail(400, "Niveau inconnu");
  const cols = level === 0 ? 2 : photo.cols;
  const rows = level === 0 ? 2 : photo.rows;
  if (!(col >= 0 && col < cols && row >= 0 && row < rows)) return fail(404, "Tuile introuvable");

  const object = await env.TILES.get(`${photo.gallery_id}/${photoId}/${level}/${col}_${row}.jpg`);
  if (!object) return fail(404, "Tuile introuvable");
  return new Response(object.body, {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=300" },
  });
}

// Toutes les factures du compte, toutes galeries confondues — l'onglet
// Facturation du tableau de bord, qui n'a plus à ouvrir chaque galerie une
// par une pour retrouver ce qui a été réglé.
async function listInvoices(env, photographerId) {
  const { results } = await env.DB.prepare(
    `SELECT invoices.id, invoices.number, invoices.issued_at, invoices.amount_cents,
            invoices.vat_rate_percent, invoices.emailed_to,
            galleries.title AS gallery_title, galleries.slug AS gallery_slug
     FROM invoices JOIN galleries ON galleries.id = invoices.gallery_id
     WHERE invoices.photographer_id = ?
     ORDER BY invoices.issued_at DESC`
  )
    .bind(photographerId)
    .all();

  const totalCents = results.reduce((sum, inv) => sum + inv.amount_cents, 0);
  return json({ invoices: results, totalCents });
}

// Compteurs globaux du compte, affichés en aperçu sur l'onglet Galeries —
// galeries créées, ventes effectuées et leur montant, suppléments déjà
// réglés et encore en attente. Les suppléments en attente reprennent
// exactement le même calcul que listGalleries/supplementFor (jamais une
// simple somme stockée : le client peut sélectionner plus de photos après
// un premier paiement), pour rester cohérents avec ce qu'affiche déjà
// l'onglet Facturation.
async function getStats(env, photographerId) {
  const galleriesRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM galleries WHERE photographer_id = ?"
  )
    .bind(photographerId)
    .first();

  const salesRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(payments.amount_cents), 0) AS amount_cents,
            COALESCE(SUM(payments.extra_count), 0) AS extra_count
     FROM payments JOIN galleries ON galleries.id = payments.gallery_id
     WHERE galleries.photographer_id = ? AND payments.status = 'paid'`
  )
    .bind(photographerId)
    .first();

  const { results: galleries } = await env.DB.prepare(
    `SELECT g.included_photos, g.extra_photo_price_cents,
            (SELECT COUNT(*) FROM photos p WHERE p.gallery_id = g.id AND p.selected = 1) AS selected_count,
            (SELECT COALESCE(SUM(extra_count), 0) FROM payments WHERE payments.gallery_id = g.id AND payments.status = 'paid') AS paid_extra_count
     FROM galleries g WHERE g.photographer_id = ?`
  )
    .bind(photographerId)
    .all();

  let dueExtraCount = 0;
  let dueTotalCents = 0;
  for (const g of galleries) {
    const supplement = supplementFor(g.included_photos, g.extra_photo_price_cents, g.selected_count, g.paid_extra_count);
    dueExtraCount += supplement.dueExtraCount;
    dueTotalCents += supplement.dueTotalCents;
  }

  return json({
    galleriesCount: galleriesRow?.n || 0,
    salesCount: salesRow?.n || 0,
    salesAmountCents: salesRow?.amount_cents || 0,
    extrasPaidCount: salesRow?.extra_count || 0,
    extrasDueCount: dueExtraCount,
    extrasDueAmountCents: dueTotalCents,
  });
}

// Cloisonnée directement par photographer_id (colonne stockée sur la
// facture elle-même à l'émission) — pas besoin de remonter par la galerie.
async function getInvoice(env, photographerId, invoiceId) {
  const invoice = await env.DB.prepare("SELECT * FROM invoices WHERE id = ? AND photographer_id = ?")
    .bind(invoiceId, photographerId)
    .first();
  if (!invoice) return fail(404, "Facture introuvable");

  const object = await env.TILES.get(`invoices/${invoiceId}.pdf`);
  if (!object) return fail(404, "Facture introuvable");
  return new Response(object.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="facture-${invoice.number}.pdf"`,
      "cache-control": "private, max-age=300",
    },
  });
}

async function galleryLog(request, env, photographerId, slug) {
  const gallery = await ownedGallery(env, photographerId, slug);
  if (!gallery) return fail(404, "Galerie introuvable");

  const limit = Math.min(Number(new URL(request.url).searchParams.get("limit")) || 200, 1000);
  const { results } = await env.DB.prepare(
    `SELECT event, viewer_id, detail, photo_id, ip_hash, user_agent, ts FROM access_log
     WHERE gallery_id = ? ORDER BY ts DESC LIMIT ?`
  )
    .bind(gallery.id, limit)
    .all();
  return json({ log: results });
}

export async function handleAdmin(request, env, ctx, path) {
  const photographerId = await authenticatePhotographer(request, env);
  if (!photographerId) return fail(401, "Session invalide ou expirée");

  const parts = path.split("/").filter(Boolean); // api, admin, …
  const section = parts[2];

  if (section === "galleries") {
    if (parts.length === 3) {
      if (request.method === "POST") return createGallery(request, env, photographerId);
      if (request.method === "GET") return listGalleries(env, photographerId);
    }
    const slug = parts[3];
    if (parts.length === 4 && request.method === "GET") return getGallery(env, photographerId, slug);
    if (parts.length === 4 && request.method === "DELETE") return deleteGallery(env, photographerId, slug);
    if (parts.length === 5 && parts[4] === "photos" && request.method === "POST") {
      return addPhoto(request, env, photographerId, slug);
    }
    if (parts.length === 6 && parts[4] === "photos" && request.method === "DELETE") {
      return deletePhoto(env, photographerId, slug, parts[5]);
    }
    if (parts.length === 5 && parts[4] === "log" && request.method === "GET") {
      return galleryLog(request, env, photographerId, slug);
    }
    if (parts.length === 5 && parts[4] === "password" && request.method === "POST") {
      return regeneratePassword(request, env, photographerId, slug);
    }
    if (parts.length === 6 && parts[4] === "background" && parts[5] === "color" && request.method === "POST") {
      return setBackgroundColor(request, env, photographerId, slug);
    }
    if (parts.length === 6 && parts[4] === "background" && parts[5] === "image" && request.method === "PUT") {
      return setBackgroundImage(request, env, photographerId, slug);
    }
    if (parts.length === 5 && parts[4] === "background" && request.method === "DELETE") {
      return resetBackground(env, photographerId, slug);
    }
    if (parts.length === 5 && parts[4] === "layout" && request.method === "POST") {
      return setLayout(request, env, photographerId, slug);
    }
    if (parts.length === 5 && parts[4] === "music" && request.method === "PUT") {
      return setMusic(request, env, photographerId, slug);
    }
    if (parts.length === 5 && parts[4] === "music" && request.method === "DELETE") {
      return deleteMusic(env, photographerId, slug);
    }
    if (parts.length === 5 && parts[4] === "quota" && request.method === "POST") {
      return setQuota(request, env, photographerId, slug);
    }
  }

  // Table des empreintes : c'est la liste des candidats que l'outil de
  // détection corrèle avec une image suspecte — cloisonnée par photographe,
  // comme tout le reste : une empreinte identifie l'une de VOS galeries.
  if (section === "forensic" && parts.length === 3 && request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT p.forensic_id, p.id AS photo_id, p.position, g.slug, g.title, g.client_name
       FROM photos p JOIN galleries g ON g.id = p.gallery_id
       WHERE p.forensic_id != '' AND g.photographer_id = ?
       ORDER BY g.created_at DESC, p.position ASC`
    )
      .bind(photographerId)
      .all();
    return json({ prints: results });
  }

  // /api/admin/tiles/<photoId>/<niveau>/<colonne>/<ligne>
  if (section === "tiles" && parts.length === 7 && request.method === "PUT") {
    return putTile(request, env, photographerId, parts[3], Number(parts[4]), Number(parts[5]), Number(parts[6]));
  }
  if (section === "tiles" && parts.length === 7 && request.method === "GET") {
    return getTile(env, photographerId, parts[3], Number(parts[4]), Number(parts[5]), Number(parts[6]));
  }

  // Paiement en ligne (Stripe Connect) et profil de facturation : propres au
  // compte, pas à une galerie en particulier.
  if (section === "stripe" && parts[3] === "connect" && parts.length === 4 && request.method === "POST") {
    const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(photographerId).first();
    if (!photographer) return fail(401, "Session invalide");
    return connectStripe(request, env, photographer);
  }
  if (section === "stripe" && parts[3] === "refresh" && parts.length === 4 && request.method === "POST") {
    const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(photographerId).first();
    if (!photographer) return fail(401, "Session invalide");
    return refreshStripeStatus(request, env, photographer);
  }
  if (section === "billing" && parts.length === 3 && request.method === "POST") {
    const photographer = await env.DB.prepare("SELECT * FROM photographers WHERE id = ?").bind(photographerId).first();
    if (!photographer) return fail(401, "Session invalide");
    return setBillingProfile(request, env, photographer);
  }

  if (section === "invoices" && parts.length === 3 && request.method === "GET") {
    return listInvoices(env, photographerId);
  }
  if (section === "invoices" && parts.length === 4 && request.method === "GET") {
    return getInvoice(env, photographerId, parts[3]);
  }

  if (section === "stats" && parts.length === 3 && request.method === "GET") {
    return getStats(env, photographerId);
  }

  // Paramètres du compte : nom de studio, mot de passe, e-mail (avec
  // confirmation), présentation par défaut des futures galeries.
  if (section === "account" && parts.length === 3 && request.method === "POST") {
    return updateStudioName(request, env, photographerId);
  }
  if (section === "account" && parts[3] === "name" && parts.length === 4 && request.method === "POST") {
    return updateName(request, env, photographerId);
  }
  if (section === "account" && parts[3] === "password" && parts.length === 4 && request.method === "POST") {
    return changePassword(request, env, photographerId);
  }
  if (section === "account" && parts[3] === "email" && parts.length === 4 && request.method === "POST") {
    return requestEmailChange(request, env, ctx, photographerId);
  }
  if (section === "account" && parts[3] === "subdomain" && parts.length === 4 && request.method === "POST") {
    return updateSubdomain(request, env, photographerId);
  }
  if (section === "account" && parts[3] === "reminders" && parts.length === 4 && request.method === "POST") {
    return updateReminders(request, env, photographerId);
  }
  if (section === "account" && parts[3] === "defaults" && parts.length === 4 && request.method === "POST") {
    return updateDefaults(request, env, photographerId);
  }

  return fail(404, "Route inconnue");
}
