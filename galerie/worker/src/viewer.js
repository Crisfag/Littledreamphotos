// API côté client : ouverture de session, manifeste de la galerie,
// distribution des tuiles, journal d'accès.

import { json, fail } from "./http.js";
import { isValidTag, parseMarks, normalizeMarks } from "./marks.js";
import { verifyPassword, signToken, verifyToken, hashIp, randomBytes, b64url } from "./auth.js";
import { sendCaptureAlert, sendSelectionValidated } from "./notify.js";
import { supplementFor } from "./admin.js";
import { shopForClient, handlePrintOrder } from "./shop.js";
import { createCheckoutSession } from "./stripe.js";
import { paymentFeeCents } from "./fees.js";
import { musicForClient, audioKeyFor, serveAudio, getTrack } from "./music.js";
import { deliveryForClient, createDownloadLink, downloadFile, downloadZip } from "./delivery.js";
import { saveCart } from "./campaigns.js";

const SESSION_TTL_SECONDS = 2 * 60 * 60; // 2 h
const MAX_FAILED_LOGINS = 10;
const FAILED_WINDOW_SECONDS = 15 * 60;
const MAX_COMMENT_LENGTH = 500;

const EVENTS_ALLOWED = new Set(["view", "capture_suspected", "blur", "print", "devtools"]);

// "impr-ecran" et "capture-macos" sont des raccourcis de capture sans
// ambiguïté. "absence-breve" est un signal plus indirect mais nécessaire
// sur macOS, où le système intercepte Cmd+Maj+3/4/5 avant que le navigateur
// ne puisse voir passer le raccourci lui-même : le client n'a alors journalisé
// qu'un changement de fenêtre ou d'onglet très bref (voir gallery.js), plus
// probablement l'éclair d'une capture qu'un vrai changement d'application.
const EMAIL_ALERT_REASONS = new Set(["impr-ecran", "capture-macos", "absence-breve"]);
const ALERT_COOLDOWN_SECONDS = 120;

function now() {
  return Math.floor(Date.now() / 1000);
}

async function logAccess(env, entry) {
  await env.DB.prepare(
    `INSERT INTO access_log (gallery_id, viewer_id, event, detail, photo_id, ip_hash, user_agent, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      entry.galleryId,
      entry.viewerId || "",
      entry.event,
      (entry.detail || "").slice(0, 200),
      entry.photoId || "",
      entry.ipHash || "",
      (entry.userAgent || "").slice(0, 200),
      now()
    )
    .run();
}

async function getGallery(env, slug) {
  return env.DB.prepare("SELECT * FROM galleries WHERE slug = ?").bind(slug).first();
}

function isExpired(gallery) {
  return gallery.expires_at != null && gallery.expires_at < now();
}

// Somme des suppléments déjà couverts par un paiement confirmé — jamais un
// paiement "pending" (créé mais jamais terminé, ou en cours) : seul le
// webhook Stripe fait passer une ligne à "paid" (voir schema.sql).
async function paidExtraCount(env, galleryId) {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(extra_count), 0) AS n FROM payments WHERE gallery_id = ? AND status = 'paid'`
  )
    .bind(galleryId)
    .first();
  return row?.n || 0;
}

async function tooManyFailures(env, ipHash) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM access_log
     WHERE ip_hash = ? AND event = 'login_failed' AND ts > ?`
  )
    .bind(ipHash, now() - FAILED_WINDOW_SECONDS)
    .first();
  return (row?.n || 0) >= MAX_FAILED_LOGINS;
}

async function handleLogin(request, env, slug) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const userAgent = request.headers.get("User-Agent") || "";
  const ipHash = await hashIp(ip, env.TOKEN_SECRET);

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const password = typeof body?.password === "string" ? body.password : "";

  if (await tooManyFailures(env, ipHash)) {
    return fail(429, "Trop de tentatives. Réessayez dans quelques minutes.");
  }

  const gallery = await getGallery(env, slug);
  // Même message d'erreur si la galerie n'existe pas ou si le mot de passe est
  // faux : inutile de confirmer à un inconnu qu'une galerie existe.
  const ok = gallery && !isExpired(gallery)
    ? await verifyPassword(password, gallery.password_hash, gallery.password_salt)
    : false;

  if (!ok) {
    if (gallery) {
      await logAccess(env, {
        galleryId: gallery.id,
        event: isExpired(gallery) ? "login_expired" : "login_failed",
        ipHash,
        userAgent,
      });
    }
    if (gallery && isExpired(gallery)) {
      return fail(410, "Cette galerie a expiré. Contactez votre photographe.");
    }
    return fail(401, "Mot de passe incorrect.");
  }

  const viewerId = b64url(randomBytes(9));
  const token = await signToken(env.TOKEN_SECRET, {
    g: gallery.id,
    v: viewerId,
    exp: now() + SESSION_TTL_SECONDS,
  });

  await logAccess(env, { galleryId: gallery.id, viewerId, event: "login", ipHash, userAgent });

  const { results: photos } = await env.DB.prepare(
    `SELECT id, width, height, cols, rows, preview_width, preview_height, selected, comment, tag, marks, has_original FROM photos
     WHERE gallery_id = ? ORDER BY position ASC, created_at ASC`
  )
    .bind(gallery.id)
    .all();

  const photographer = await env.DB.prepare(
    "SELECT stripe_account_id, stripe_charges_enabled, studio_name FROM photographers WHERE id = ?"
  )
    .bind(gallery.photographer_id)
    .first();

  const { results: invoices } = await env.DB.prepare(
    `SELECT id, number, amount_cents, issued_at FROM invoices WHERE gallery_id = ? ORDER BY issued_at DESC`
  )
    .bind(gallery.id)
    .all();

  const { shop, printOrders } = await shopForClient(env, gallery);
  const music = musicForClient(gallery, gallery.music_track_id ? await getTrack(env, gallery.music_track_id) : null);

  return json({
    token,
    expiresIn: SESSION_TTL_SECONDS,
    gallery: {
      shop,
      printOrders,
      title: gallery.title,
      clientName: gallery.client_name,
      watermark: gallery.watermark_text,
      expiresAt: gallery.expires_at,
      layout: gallery.layout || "grille",
      delivery: await deliveryForClient(env, gallery),
      hasMusic: music?.kind === "audio",
      music,
      selectionDoneAt: gallery.selection_done_at || null,
      studioName: photographer?.studio_name || "",
      includedPhotos: gallery.included_photos,
      extraPhotoPriceCents: gallery.extra_photo_price_cents || 0,
      paidExtraCount: await paidExtraCount(env, gallery.id),
      canPayOnline: Boolean(photographer?.stripe_account_id) && Boolean(photographer?.stripe_charges_enabled),
      invoices: invoices.map((i) => ({
        id: i.id,
        number: i.number,
        amountCents: i.amount_cents,
        issuedAt: i.issued_at,
      })),
    },
    photos: photos.map((p) => ({
      id: p.id,
      width: p.width,
      height: p.height,
      cols: p.cols,
      rows: p.rows,
      previewWidth: p.preview_width,
      previewHeight: p.preview_height,
      selected: !!p.selected,
      comment: p.comment || "",
      tag: p.tag || "",
      marks: parseMarks(p.marks),
      printable: Boolean(shop) && Boolean(p.has_original),
    })),
  });
}

async function authorize(request, env, slug) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = await verifyToken(env.TOKEN_SECRET, token);
  if (!payload) return { error: fail(401, "Session expirée") };

  const gallery = await getGallery(env, slug);
  if (!gallery || gallery.id !== payload.g) return { error: fail(403, "Accès refusé") };
  if (isExpired(gallery)) return { error: fail(410, "Cette galerie a expiré.") };
  return { gallery, viewerId: payload.v };
}

const PREVIEW_COLS = 2;
const PREVIEW_ROWS = 2;

async function handleTile(request, env, slug, photoId, level, col, row) {
  const auth = await authorize(request, env, slug);
  if (auth.error) return auth.error;

  const photo = await env.DB.prepare("SELECT * FROM photos WHERE id = ? AND gallery_id = ?")
    .bind(photoId, auth.gallery.id)
    .first();
  if (!photo) return fail(404, "Photo introuvable");

  // Bornes strictes : la grille attendue dépend du niveau demandé.
  const cols = level === 0 ? PREVIEW_COLS : photo.cols;
  const rows = level === 0 ? PREVIEW_ROWS : photo.rows;
  if (!(level === 0 || level === 1)) return fail(404, "Niveau inconnu");
  if (!(col >= 0 && col < cols && row >= 0 && row < rows)) {
    return fail(404, "Tuile introuvable");
  }

  const object = await env.TILES.get(`${auth.gallery.id}/${photoId}/${level}/${col}_${row}.jpg`);
  if (!object) return fail(404, "Tuile introuvable");

  return new Response(object.body, {
    headers: {
      "content-type": "image/jpeg",
      // Jamais de cache : une tuile en cache disque est une tuile récupérable.
      "cache-control": "no-store, no-cache, must-revalidate, private",
      "content-disposition": "inline",
    },
  });
}

// Coup de cœur du client : n'importe quel visiteur connecté à la galerie
// peut le poser ou le retirer — c'est une sélection partagée (le couple, la
// famille), pas un compte individuel. Persistée en base plutôt que dans le
// navigateur : le photographe doit la voir même si le client change d'appareil.
async function handleSelect(request, env, slug) {
  const auth = await authorize(request, env, slug);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const photoId = typeof body?.photoId === "string" ? body.photoId : "";
  const selected = body?.selected === true;
  if (!photoId) return fail(400, "Photo manquante");

  const photo = await env.DB.prepare("SELECT id FROM photos WHERE id = ? AND gallery_id = ?")
    .bind(photoId, auth.gallery.id)
    .first();
  if (!photo) return fail(404, "Photo introuvable");

  await env.DB.prepare("UPDATE photos SET selected = ?, selected_at = ? WHERE id = ?")
    .bind(selected ? 1 : 0, selected ? now() : null, photoId)
    .run();

  await logAccess(env, {
    galleryId: auth.gallery.id,
    viewerId: auth.viewerId,
    event: selected ? "select" : "deselect",
    detail: photoId,
    ipHash: await hashIp(request.headers.get("CF-Connecting-IP") || "", env.TOKEN_SECRET),
    userAgent: request.headers.get("User-Agent") || "",
  });

  return json({ ok: true, selected });
}

// Note du client sur une photo précise (« celle-ci en noir et blanc ? »).
// Même modèle que le coup de cœur : partagée entre tous les visiteurs de la
// galerie, dernier écrit gagne — pas de compte individuel à gérer.
async function handleComment(request, env, slug) {
  const auth = await authorize(request, env, slug);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const photoId = typeof body?.photoId === "string" ? body.photoId : "";
  if (!photoId) return fail(400, "Photo manquante");
  if (typeof body?.comment !== "string") return fail(400, "Commentaire invalide");
  const comment = body.comment.trim().slice(0, MAX_COMMENT_LENGTH);

  const photo = await env.DB.prepare("SELECT id FROM photos WHERE id = ? AND gallery_id = ?")
    .bind(photoId, auth.gallery.id)
    .first();
  if (!photo) return fail(404, "Photo introuvable");

  await env.DB.prepare("UPDATE photos SET comment = ?, comment_at = ? WHERE id = ?")
    .bind(comment, comment ? now() : null, photoId)
    .run();

  await logAccess(env, {
    galleryId: auth.gallery.id,
    viewerId: auth.viewerId,
    event: "comment",
    detail: photoId,
    ipHash: await hashIp(request.headers.get("CF-Connecting-IP") || "", env.TOKEN_SECRET),
    userAgent: request.headers.get("User-Agent") || "",
  });

  return json({ ok: true, comment });
}

// Code couleur posé par le client sur une photo (validée / à retoucher / à
// écarter). Indépendant du coup de cœur : un client peut marquer « à
// retoucher » une photo qu'il n'a pas (encore) choisie, ou l'inverse.
async function handleTag(request, env, slug) {
  const auth = await authorize(request, env, slug);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const photoId = typeof body?.photoId === "string" ? body.photoId : "";
  if (!photoId) return fail(400, "Photo manquante");
  const tag = typeof body?.tag === "string" ? body.tag : "";
  if (!isValidTag(tag)) return fail(400, "Code couleur inconnu");

  const photo = await env.DB.prepare("SELECT id FROM photos WHERE id = ? AND gallery_id = ?")
    .bind(photoId, auth.gallery.id)
    .first();
  if (!photo) return fail(404, "Photo introuvable");

  await env.DB.prepare("UPDATE photos SET tag = ? WHERE id = ?").bind(tag, photoId).run();

  await logAccess(env, {
    galleryId: auth.gallery.id,
    viewerId: auth.viewerId,
    event: "tag",
    detail: photoId,
    ipHash: await hashIp(request.headers.get("CF-Connecting-IP") || "", env.TOKEN_SECRET),
    userAgent: request.headers.get("User-Agent") || "",
  });

  return json({ ok: true, tag });
}

// Repères annotés : la liste complète est renvoyée à chaque enregistrement
// (dernier écrit gagne, comme le commentaire) — bien plus simple à relire
// qu'une suite d'ajouts/retraits, pour une liste qui ne dépasse jamais
// quelques éléments.
async function handleMarks(request, env, slug) {
  const auth = await authorize(request, env, slug);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const photoId = typeof body?.photoId === "string" ? body.photoId : "";
  if (!photoId) return fail(400, "Photo manquante");
  const normalized = normalizeMarks(body?.marks);
  if (normalized.error) return fail(400, normalized.error);

  const photo = await env.DB.prepare("SELECT id FROM photos WHERE id = ? AND gallery_id = ?")
    .bind(photoId, auth.gallery.id)
    .first();
  if (!photo) return fail(404, "Photo introuvable");

  await env.DB.prepare("UPDATE photos SET marks = ? WHERE id = ?")
    .bind(JSON.stringify(normalized.marks), photoId)
    .run();

  await logAccess(env, {
    galleryId: auth.gallery.id,
    viewerId: auth.viewerId,
    event: "mark",
    detail: photoId,
    ipHash: await hashIp(request.headers.get("CF-Connecting-IP") || "", env.TOKEN_SECRET),
    userAgent: request.headers.get("User-Agent") || "",
  });

  return json({ ok: true, marks: normalized.marks });
}

// « Valider ma sélection » : le client signale que son choix est fait. Le
// moment est mémorisé (arrête les relances automatiques), consigné au
// journal, et le photographe est prévenu par e-mail avec le détail. Peut
// être refait si le client change d'avis ensuite ; l'e-mail, lui, n'est pas
// renvoyé plus d'une fois par heure pour ne pas noyer le photographe.
async function handleValidate(request, env, ctx, slug) {
  const auth = await authorize(request, env, slug);
  if (auth.error) return auth.error;
  const gallery = auth.gallery;
  const ts = now();

  await env.DB.prepare("UPDATE galleries SET selection_done_at = ? WHERE id = ?").bind(ts, gallery.id).run();

  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM access_log WHERE gallery_id = ? AND event = 'validate' AND ts > ?"
  )
    .bind(gallery.id, ts - 3600)
    .first();

  await logAccess(env, {
    galleryId: gallery.id,
    viewerId: auth.viewerId,
    event: "validate",
    detail: "",
    ipHash: await hashIp(request.headers.get("CF-Connecting-IP") || "", env.TOKEN_SECRET),
    userAgent: request.headers.get("User-Agent") || "",
  });

  const selectedRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM photos WHERE gallery_id = ? AND selected = 1")
    .bind(gallery.id)
    .first();
  const selectedCount = selectedRow?.n || 0;
  const supplement = supplementFor(gallery.included_photos, gallery.extra_photo_price_cents, selectedCount, await paidExtraCount(env, gallery.id));

  if (!(recent?.n > 0)) {
    ctx.waitUntil(
      (async () => {
        const photographer = await photographerOf(env, gallery.photographer_id);
        if (!photographer?.email) return;
        await sendSelectionValidated(env, {
          to: photographer.email,
          galleryTitle: gallery.title,
          clientName: gallery.client_name,
          selectedCount,
          dueExtraCount: supplement.dueExtraCount,
          dueTotalCents: supplement.dueTotalCents,
          adminUrl: env.ADMIN_URL || "",
        });
      })().catch((err) => console.error("E-mail de sélection validée :", err && err.message ? err.message : err))
    );
  }

  return json({ ok: true, selectionDoneAt: ts, selectedCount, emailed: !(recent?.n > 0) });
}

function newPaymentId() {
  return `pay_${b64url(randomBytes(9))}`;
}

// Ouvre une page de paiement Stripe pour le supplément RÉELLEMENT dû à cet
// instant — jamais pour le total brut : un règlement déjà confirmé (webhook)
// est toujours déduit, pour ne jamais faire payer deux fois la même photo si
// le client en sélectionne encore d'autres ensuite.
async function handleCheckout(request, env, slug) {
  const auth = await authorize(request, env, slug);
  if (auth.error) return auth.error;
  const gallery = auth.gallery;

  if (gallery.included_photos === null || gallery.included_photos === undefined) {
    return fail(400, "Aucun forfait n'est défini pour cette galerie");
  }

  const photographer = await env.DB.prepare(
    "SELECT * FROM photographers WHERE id = ?"
  )
    .bind(gallery.photographer_id)
    .first();
  if (!photographer?.stripe_account_id || !photographer.stripe_charges_enabled) {
    return fail(503, "Le paiement en ligne n'est pas encore activé pour cette galerie");
  }

  const selectedRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM photos WHERE gallery_id = ? AND selected = 1"
  )
    .bind(gallery.id)
    .first();
  const grossExtraCount = Math.max(0, (selectedRow?.n || 0) - gallery.included_photos);
  const alreadyPaid = await paidExtraCount(env, gallery.id);
  const outstanding = Math.max(0, grossExtraCount - alreadyPaid);
  if (outstanding <= 0) return fail(400, "Rien à régler pour le moment");

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const successUrl = String(body?.successUrl || "");
  const cancelUrl = String(body?.cancelUrl || "");
  if (!successUrl || !cancelUrl) return fail(400, "URL de retour manquante");

  const paymentId = newPaymentId();
  const amountCents = outstanding * (gallery.extra_photo_price_cents || 0);
  const feeCents = paymentFeeCents(env, photographer, amountCents);

  let session;
  try {
    session = await createCheckoutSession(env, photographer.stripe_account_id, {
      label: `${outstanding} photo${outstanding > 1 ? "s" : ""} supplémentaire${outstanding > 1 ? "s" : ""} — ${gallery.title}`,
      unitAmountCents: gallery.extra_photo_price_cents || 0,
      quantity: outstanding,
      successUrl,
      cancelUrl,
      metadata: { gallery_id: gallery.id, gallery_slug: slug, payment_id: paymentId },
      applicationFeeCents: feeCents,
    });
  } catch (err) {
    console.error("Échec de la création de la session Stripe :", err);
    return fail(502, "Stripe a refusé la demande de paiement");
  }

  await env.DB.prepare(
    `INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, fee_cents, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
  )
    .bind(paymentId, gallery.id, session.id, outstanding, amountCents, feeCents, now())
    .run();

  return json({ url: session.url });
}

// Facture d'un règlement déjà confirmé — jamais accessible sans session, et
// jamais celle d'une autre galerie (voir schema.sql : gallery_id est bien
// celui de la facture, pas déduit du paiement).
async function handleInvoice(request, env, slug, invoiceId) {
  const auth = await authorize(request, env, slug);
  if (auth.error) return auth.error;

  const invoice = await env.DB.prepare("SELECT * FROM invoices WHERE id = ? AND gallery_id = ?")
    .bind(invoiceId, auth.gallery.id)
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

// Le photographe n'est prévenu que si on n'en a pas déjà avisé un pour
// cette galerie dans les dernières minutes : un client qui reste appuyé
// sur une touche ou déclenche plusieurs raccourcis coup sur coup ne doit
// pas déclencher une rafale d'e-mails.
async function recentAlertAlreadySent(env, galleryId) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM access_log
     WHERE gallery_id = ? AND event = 'capture_suspected' AND detail IN ('impr-ecran', 'capture-macos', 'absence-breve')
       AND ts > ?`
  )
    .bind(galleryId, now() - ALERT_COOLDOWN_SECONDS)
    .first();
  // > 1 : l'évènement qu'on vient d'insérer compte déjà pour 1.
  return (row?.n || 0) > 1;
}

async function photographerOf(env, photographerId) {
  return env.DB.prepare("SELECT email, studio_name FROM photographers WHERE id = ?")
    .bind(photographerId)
    .first();
}

async function handleEvent(request, env, ctx, slug) {
  const auth = await authorize(request, env, slug);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête invalide");
  }
  const event = typeof body?.event === "string" ? body.event : "";
  if (!EVENTS_ALLOWED.has(event)) return fail(400, "Évènement inconnu");
  const detail = typeof body.detail === "string" ? body.detail : "";

  // La photo référencée doit vraiment appartenir à cette galerie : sinon on
  // l'ignore plutôt que de consigner une référence trompeuse ou de laisser
  // fuiter l'existence d'une photo d'une autre galerie via ce canal.
  let photoId = "";
  let photo = null;
  if (typeof body.photoId === "string" && body.photoId) {
    photo = await env.DB.prepare("SELECT position FROM photos WHERE id = ? AND gallery_id = ?")
      .bind(body.photoId, auth.gallery.id)
      .first();
    if (photo) photoId = body.photoId;
  }

  await logAccess(env, {
    galleryId: auth.gallery.id,
    viewerId: auth.viewerId,
    event,
    detail,
    photoId,
    ipHash: await hashIp(request.headers.get("CF-Connecting-IP") || "", env.TOKEN_SECRET),
    userAgent: request.headers.get("User-Agent") || "",
  });

  if (event === "capture_suspected" && EMAIL_ALERT_REASONS.has(detail)) {
    ctx.waitUntil(
      (async () => {
        if (await recentAlertAlreadySent(env, auth.gallery.id)) {
          console.log(`Alerte de capture ignorée (déjà une alerte récente) — galerie ${auth.gallery.id}`);
          return;
        }
        const photographer = await photographerOf(env, auth.gallery.photographer_id);
        if (!photographer?.email) {
          console.log(`Alerte de capture ignorée (photographe introuvable ou sans e-mail) — galerie ${auth.gallery.id}, photographe ${auth.gallery.photographer_id}`);
          return;
        }
        if (!env.RESEND_API_KEY) {
          console.log("Alerte de capture ignorée : RESEND_API_KEY n'est pas configurée sur ce Worker.");
          return;
        }
        console.log(`Envoi d'une alerte de capture à ${photographer.email} (galerie ${auth.gallery.id}, raison ${detail})`);
        await sendCaptureAlert(env, {
          to: photographer.email,
          studioName: photographer.studio_name,
          galleryTitle: auth.gallery.title,
          clientName: auth.gallery.client_name,
          photoLabel: photo ? `Photo n° ${photo.position + 1}` : "",
          reason: detail,
          ts: now(),
          adminUrl: env.ADMIN_URL || "",
        });
      })()
    );
  }

  return json({ ok: true });
}

// Arrière-plan de l'écran de mot de passe : public, avant toute
// authentification. Doit donc rester muet sur l'existence de la galerie —
// une galerie inconnue ou expirée renvoie la même réponse par défaut qu'une
// galerie qui n'a simplement pas personnalisé son arrière-plan.
async function handleBackground(env, slug) {
  const gallery = await getGallery(env, slug);
  if (!gallery || isExpired(gallery)) {
    return json({ type: "color", color: "" });
  }
  return json({ type: gallery.login_background_type, color: gallery.login_background_color });
}

// Non trouvée dans les mêmes conditions que ci-dessus (galerie inconnue,
// expirée, ou qui n'a simplement pas choisi d'image) : toujours un 404 sans
// distinction, pour ne rien révéler.
async function handleBackgroundImage(env, slug) {
  const gallery = await getGallery(env, slug);
  if (!gallery || isExpired(gallery) || gallery.login_background_type !== "image") {
    return fail(404, "Aucune image");
  }
  const object = await env.TILES.get(`backgrounds/${gallery.id}.jpg`);
  if (!object) return fail(404, "Aucune image");
  return new Response(object.body, {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=3600" },
  });
}

// Musique d'ambiance choisie par le photographe : un décor, pas une
// livraison — servie publiquement comme l'image d'arrière-plan, et muette
// sur l'existence de la galerie dans les mêmes conditions (404 identique
// qu'elle soit inconnue, expirée ou simplement sans musique). Les requêtes
// partielles (Range) sont honorées : Safari refuse de lire un média sans ça.
async function handleMusic(request, env, slug) {
  const gallery = await getGallery(env, slug);
  const key = gallery && !isExpired(gallery) ? audioKeyFor(gallery) : null;
  if (!key) return fail(404, "Aucune musique");
  return serveAudio(request, env, key);
}

export async function handleViewer(request, env, ctx, path) {
  // /api/gallery/<slug>/<action>[/...]
  const parts = path.split("/").filter(Boolean); // api, gallery, slug, action, …
  const slug = parts[2];
  const action = parts[3];
  if (!slug) return fail(404, "Galerie inconnue");

  if (action === "login" && request.method === "POST") {
    return handleLogin(request, env, slug);
  }
  if (action === "background" && request.method === "GET" && parts.length === 4) {
    return handleBackground(env, slug);
  }
  if (action === "background-image" && request.method === "GET" && parts.length === 4) {
    return handleBackgroundImage(env, slug);
  }
  if (action === "music" && request.method === "GET" && parts.length === 4) {
    return handleMusic(request, env, slug);
  }
  // /api/gallery/<slug>/tile/<photoId>/<niveau>/<colonne>/<ligne>
  if (action === "tile" && request.method === "GET" && parts.length === 8) {
    return handleTile(
      request, env, slug, parts[4],
      Number(parts[5]), Number(parts[6]), Number(parts[7])
    );
  }
  if (action === "select" && request.method === "POST") {
    return handleSelect(request, env, slug);
  }
  if (action === "comment" && request.method === "POST") {
    return handleComment(request, env, slug);
  }
  if (action === "tag" && request.method === "POST") {
    return handleTag(request, env, slug);
  }
  if (action === "marks" && request.method === "POST") {
    return handleMarks(request, env, slug);
  }
  if (action === "validate" && request.method === "POST") {
    return handleValidate(request, env, ctx, slug);
  }
  // Panier de tirages enregistré côté serveur (retrouvé sur un autre
  // appareil, rappel s'il est oublié — voir campaigns.js).
  if (action === "cart" && request.method === "POST" && parts.length === 4) {
    const auth = await authorize(request, env, slug);
    if (auth.error) return auth.error;
    return saveCart(request, env, auth.gallery);
  }
  if (action === "print-order" && request.method === "POST" && parts.length === 4) {
    const auth = await authorize(request, env, slug);
    if (auth.error) return auth.error;
    return handlePrintOrder(request, env, auth.gallery);
  }
  if (action === "event" && request.method === "POST") {
    return handleEvent(request, env, ctx, slug);
  }
  if (action === "checkout" && request.method === "POST") {
    return handleCheckout(request, env, slug);
  }
  // Livraison des photos définitives : lien signé, puis téléchargement.
  if (action === "delivery") {
    if (parts[4] === "link" && parts.length === 5 && request.method === "POST") {
      const auth = await authorize(request, env, slug);
      if (auth.error) return auth.error;
      return createDownloadLink(request, env, auth.gallery, auth.viewerId, new URL(request.url).origin);
    }
    if (request.method === "GET" && ((parts[4] === "file" && parts.length === 6) || (parts[4] === "zip" && parts.length === 5))) {
      const gallery = await getGallery(env, slug);
      if (!gallery || isExpired(gallery)) return fail(404, "Aucune livraison");
      const log = (entry) => logAccess(env, { galleryId: gallery.id, ...entry, userAgent: request.headers.get("user-agent") || "" });
      return parts[4] === "zip"
        ? downloadZip(request, env, ctx, gallery, log)
        : downloadFile(request, env, gallery, decodeURIComponent(parts[5]), log);
    }
  }
  // /api/gallery/<slug>/invoice/<invoiceId>
  if (action === "invoice" && request.method === "GET" && parts.length === 5) {
    return handleInvoice(request, env, slug, parts[4]);
  }
  return fail(404, "Route inconnue");
}
