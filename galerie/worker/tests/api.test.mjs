// Vérification de bout en bout de l'API, contre un `wrangler dev --local`
// (D1 et R2 émulés localement).
//
//   npx wrangler dev --local --port 8788
//   node tests/api.test.mjs

const BASE = process.env.BASE || "http://127.0.0.1:8788";
const ADMIN = process.env.ADMIN_TOKEN || "jeton-admin-de-test";
const SLUG = `essai-${Date.now().toString(36)}`;

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const admin = (method, path, body, raw = false) =>
  fetch(BASE + path, {
    method,
    headers: {
      authorization: `Bearer ${ADMIN}`,
      ...(raw ? { "content-type": "application/octet-stream" } : body ? { "content-type": "application/json" } : {}),
    },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });

// Un JPEG minuscule mais valide, pour que les tuiles stockées soient réalistes.
const TILE = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/wAALCAABAAEBAREA/8QAFAABAQAAAAAA" +
  "AAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/E" +
  "ABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJQA/9k=",
  "base64"
);

/* ---------- Configuration et garde d'administration ---------- */

const health = await fetch(`${BASE}/health`);
check("le service répond", health.ok, `HTTP ${health.status}`);

const noToken = await fetch(`${BASE}/api/admin/galleries`);
check("l'administration refuse les requêtes sans jeton", noToken.status === 401);

const wrongToken = await fetch(`${BASE}/api/admin/galleries`, {
  headers: { authorization: "Bearer mauvais-jeton" },
});
check("l'administration refuse un mauvais jeton", wrongToken.status === 401);

/* ---------- Création de galerie ---------- */

const created = await admin("POST", "/api/admin/galleries", {
  slug: SLUG,
  title: "Séance de test",
  clientName: "Famille Test",
  password: "mot-de-passe-solide",
  watermarkText: "Test · Famille Test",
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
});
const gallery = await created.json();
check("la galerie est créée", created.status === 201 && Boolean(gallery.id), gallery.id);

const duplicate = await admin("POST", "/api/admin/galleries", { slug: SLUG, password: "mot-de-passe-solide" });
check("un slug déjà pris est refusé", duplicate.status === 409);

const weak = await admin("POST", "/api/admin/galleries", { slug: `${SLUG}-b`, password: "court" });
check("un mot de passe trop court est refusé", weak.status === 400);

const badSlug = await admin("POST", "/api/admin/galleries", { slug: "Slug Invalide!", password: "mot-de-passe-solide" });
check("un slug invalide est refusé", badSlug.status === 400);

/* ---------- Photos et tuiles ---------- */

const photoId = "pho_TestPhoto01";
const addPhoto = await admin("POST", `/api/admin/galleries/${SLUG}/photos`, {
  id: photoId,
  position: 0,
  width: 1600,
  height: 1067,
  cols: 4,
  rows: 3,
  previewWidth: 500,
  previewHeight: 334,
  forensicId: "123456789",
});
check("la photo est enregistrée", addPhoto.status === 201);

const clashId = await admin("POST", `/api/admin/galleries/${SLUG}/photos`, {
  id: photoId, width: 10, height: 10, cols: 1, rows: 1,
});
check("un identifiant de photo déjà pris est refusé", clashId.status === 409);

const badId = await admin("POST", `/api/admin/galleries/${SLUG}/photos`, {
  id: "../evasion", width: 10, height: 10, cols: 1, rows: 1,
});
check("un identifiant de photo malformé est refusé", badId.status === 400);

const tooManyTiles = await admin("POST", `/api/admin/galleries/${SLUG}/photos`, {
  width: 100, height: 100, cols: 40, rows: 40,
});
check("une grille démesurée est refusée", tooManyTiles.status === 400);

let uploaded = 0;
for (const [level, cols, rows] of [[0, 2, 2], [1, 4, 3]]) {
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const put = await admin("PUT", `/api/admin/tiles/${photoId}/${level}/${col}/${row}`, TILE, true);
      if (put.ok) uploaded++;
    }
  }
}
check("les tuiles des deux niveaux sont envoyées", uploaded === 16, `${uploaded}/16`);

const outOfBounds = await admin("PUT", `/api/admin/tiles/${photoId}/1/9/9`, TILE, true);
check("une tuile hors grille est refusée à l'envoi", outOfBounds.status === 400);

const badLevel = await admin("PUT", `/api/admin/tiles/${photoId}/7/0/0`, TILE, true);
check("un niveau inconnu est refusé", badLevel.status === 400);

/* ---------- Lecture de tuile côté administration ---------- */

const adminTile = await admin("GET", `/api/admin/tiles/${photoId}/1/0/0`);
const adminTileBytes = await adminTile.arrayBuffer();
check("l'administration peut relire une tuile", adminTile.ok && adminTileBytes.byteLength === TILE.length,
      `${adminTileBytes.byteLength} octets, ${adminTile.headers.get("content-type")}`);

const adminTileMissing = await admin("GET", `/api/admin/tiles/${photoId}/1/99/99`);
check("une tuile administrative hors grille est refusée", adminTileMissing.status === 404);

const adminTileNoAuth = await fetch(`${BASE}/api/admin/tiles/${photoId}/1/0/0`);
check("la lecture administrative refuse les requêtes sans jeton", adminTileNoAuth.status === 401);

/* ---------- Accès client ---------- */

const wrongPassword = await fetch(`${BASE}/api/gallery/${SLUG}/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "pas-le-bon" }),
});
check("un mauvais mot de passe est refusé", wrongPassword.status === 401);

const unknownGallery = await fetch(`${BASE}/api/gallery/galerie-inexistante/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "peu importe" }),
});
check("une galerie inconnue ne se distingue pas d'un mauvais mot de passe",
      unknownGallery.status === 401, `HTTP ${unknownGallery.status}`);

const login = await fetch(`${BASE}/api/gallery/${SLUG}/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "mot-de-passe-solide" }),
});
const session = await login.json();
check("le bon mot de passe ouvre une session", login.ok && Boolean(session.token));
check("le manifeste décrit les photos",
      session.photos?.length === 1 && session.photos[0].previewWidth === 500,
      JSON.stringify(session.photos?.[0]));
check("une photo n'est sélectionnée par personne au départ",
      session.photos?.[0]?.selected === false);
check("une photo n'a aucun commentaire au départ",
      session.photos?.[0]?.comment === "");
check("le mot de passe n'est jamais renvoyé",
      !JSON.stringify(session).includes("password_hash") && !JSON.stringify(session).includes("mot-de-passe-solide"));

const bearer = { authorization: `Bearer ${session.token}` };

const tileNoAuth = await fetch(`${BASE}/api/gallery/${SLUG}/tile/${photoId}/1/0/0`);
check("une tuile sans jeton est refusée", tileNoAuth.status === 401);

const tileForged = await fetch(`${BASE}/api/gallery/${SLUG}/tile/${photoId}/1/0/0`, {
  headers: { authorization: "Bearer jeton.falsifie" },
});
check("un jeton falsifié est refusé", tileForged.status === 401);

const tile = await fetch(`${BASE}/api/gallery/${SLUG}/tile/${photoId}/1/0/0`, { headers: bearer });
const bytes = await tile.arrayBuffer();
check("la tuile est servie au client", tile.ok && bytes.byteLength === TILE.length,
      `${bytes.byteLength} octets, ${tile.headers.get("content-type")}`);
check("la tuile n'est jamais mise en cache",
      /no-store/.test(tile.headers.get("cache-control") || ""), tile.headers.get("cache-control"));

const tileOut = await fetch(`${BASE}/api/gallery/${SLUG}/tile/${photoId}/1/99/99`, { headers: bearer });
check("une tuile hors grille est refusée au client", tileOut.status === 404);

const previewTile = await fetch(`${BASE}/api/gallery/${SLUG}/tile/${photoId}/0/1/1`, { headers: bearer });
check("le niveau vignette est servi", previewTile.ok);
const previewOut = await fetch(`${BASE}/api/gallery/${SLUG}/tile/${photoId}/0/3/0`, { headers: bearer });
check("les bornes du niveau vignette sont propres", previewOut.status === 404, `HTTP ${previewOut.status}`);

/* ---------- Détail d'une galerie ---------- */

const detail = await (await admin("GET", `/api/admin/galleries/${SLUG}`)).json();
check("le détail décrit la galerie et ses photos",
      detail.gallery?.slug === SLUG && detail.photos?.length === 1 &&
      detail.photos[0].id === photoId && detail.photos[0].preview_width === 500,
      JSON.stringify(detail.photos?.[0]));
check("le détail ne renvoie pas le mot de passe",
      !JSON.stringify(detail).includes("password"));

const missingDetail = await admin("GET", "/api/admin/galleries/galerie-inexistante");
check("le détail d'une galerie inconnue renvoie 404", missingDetail.status === 404);

/* ---------- Suppression d'une photo isolée ---------- */

const secondPhotoId = "pho_TestPhoto02";
await admin("POST", `/api/admin/galleries/${SLUG}/photos`, {
  id: secondPhotoId, position: 1, width: 400, height: 300, cols: 1, rows: 1,
});
await admin("PUT", `/api/admin/tiles/${secondPhotoId}/0/0/0`, TILE, true);
await admin("PUT", `/api/admin/tiles/${secondPhotoId}/1/0/0`, TILE, true);

const removedPhoto = await admin("DELETE", `/api/admin/galleries/${SLUG}/photos/${secondPhotoId}`);
check("une photo isolée est supprimée", removedPhoto.ok);

const afterPhotoDelete = await (await admin("GET", `/api/admin/galleries/${SLUG}`)).json();
check("la photo supprimée disparaît du détail",
      afterPhotoDelete.photos.length === 1 && afterPhotoDelete.photos[0].id === photoId);

const orphanTileOfDeletedPhoto = await fetch(`${BASE}/api/gallery/${SLUG}/tile/${secondPhotoId}/1/0/0`, { headers: bearer });
check("les tuiles de la photo supprimée ont disparu", orphanTileOfDeletedPhoto.status === 403 || orphanTileOfDeletedPhoto.status === 404);

const missingPhotoDelete = await admin("DELETE", `/api/admin/galleries/${SLUG}/photos/pho_NExistePas000`);
check("supprimer une photo inconnue renvoie 404", missingPhotoDelete.status === 404);

/* ---------- Cloisonnement entre galeries ---------- */

const other = await admin("POST", "/api/admin/galleries", {
  slug: `${SLUG}-voisine`, title: "Voisine", password: "mot-de-passe-solide",
});
const otherGallery = await other.json();
const crossTile = await fetch(`${BASE}/api/gallery/${SLUG}-voisine/tile/${photoId}/1/0/0`, { headers: bearer });
check("un jeton ne donne accès qu'à sa galerie", crossTile.status === 403, `HTTP ${crossTile.status}`);

/* ---------- Sélection client (coup de cœur) ---------- */

const selectNoAuth = await fetch(`${BASE}/api/gallery/${SLUG}/select`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ photoId, selected: true }),
});
check("sélectionner sans jeton est refusé", selectNoAuth.status === 401);

const selectOn = await fetch(`${BASE}/api/gallery/${SLUG}/select`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ photoId, selected: true }),
});
const selectOnBody = await selectOn.json();
check("le client peut sélectionner une photo", selectOn.ok && selectOnBody.selected === true);

const detailAfterSelect = await (await admin("GET", `/api/admin/galleries/${SLUG}`)).json();
const selectedPhoto = detailAfterSelect.photos.find((p) => p.id === photoId);
check("la sélection apparaît côté administration",
      selectedPhoto?.selected === 1 && Number.isInteger(selectedPhoto?.selected_at),
      JSON.stringify(selectedPhoto));

const listAfterSelect = await (await admin("GET", "/api/admin/galleries")).json();
const galleryRow = listAfterSelect.galleries.find((g) => g.slug === SLUG);
check("le compteur de sélection apparaît dans la liste des galeries",
      galleryRow?.selected_count === 1, JSON.stringify(galleryRow));

const reLogin = await fetch(`${BASE}/api/gallery/${SLUG}/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "mot-de-passe-solide" }),
});
const reLoginBody = await reLogin.json();
check("la sélection est visible à la reconnexion",
      reLoginBody.photos?.find((p) => p.id === photoId)?.selected === true);

const selectOff = await fetch(`${BASE}/api/gallery/${SLUG}/select`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ photoId, selected: false }),
});
const selectOffBody = await selectOff.json();
check("le client peut retirer une sélection", selectOff.ok && selectOffBody.selected === false);

const detailAfterDeselect = await (await admin("GET", `/api/admin/galleries/${SLUG}`)).json();
const deselectedPhoto = detailAfterDeselect.photos.find((p) => p.id === photoId);
check("le retrait de sélection efface la date de sélection",
      deselectedPhoto?.selected === 0 && deselectedPhoto?.selected_at == null,
      JSON.stringify(deselectedPhoto));

const selectMissingPhoto = await fetch(`${BASE}/api/gallery/${SLUG}/select`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ photoId: "pho_NExistePas000", selected: true }),
});
check("sélectionner une photo inconnue est refusé", selectMissingPhoto.status === 404);

const selectCrossGallery = await fetch(`${BASE}/api/gallery/${SLUG}-voisine/select`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ photoId, selected: true }),
});
check("le jeton d'une autre galerie ne permet pas de sélectionner",
      selectCrossGallery.status === 403, `HTTP ${selectCrossGallery.status}`);

const selectBadBody = await fetch(`${BASE}/api/gallery/${SLUG}/select`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ selected: true }),
});
check("sélectionner sans identifiant de photo est refusé", selectBadBody.status === 400);

/* ---------- Commentaire du client ---------- */

const commentNoAuth = await fetch(`${BASE}/api/gallery/${SLUG}/comment`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ photoId, comment: "en noir et blanc svp" }),
});
check("commenter sans jeton est refusé", commentNoAuth.status === 401);

const commentOn = await fetch(`${BASE}/api/gallery/${SLUG}/comment`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ photoId, comment: "  en noir et blanc svp  " }),
});
const commentOnBody = await commentOn.json();
check("le client peut laisser un commentaire, avec les espaces superflus retirés",
      commentOn.ok && commentOnBody.comment === "en noir et blanc svp", JSON.stringify(commentOnBody));

const detailAfterComment = await (await admin("GET", `/api/admin/galleries/${SLUG}`)).json();
const commentedPhoto = detailAfterComment.photos.find((p) => p.id === photoId);
check("le commentaire apparaît côté administration",
      commentedPhoto?.comment === "en noir et blanc svp" && Number.isInteger(commentedPhoto?.comment_at),
      JSON.stringify(commentedPhoto));

const listAfterComment = await (await admin("GET", "/api/admin/galleries")).json();
const galleryRowAfterComment = listAfterComment.galleries.find((g) => g.slug === SLUG);
check("le compteur de commentaires apparaît dans la liste des galeries",
      galleryRowAfterComment?.comment_count === 1, JSON.stringify(galleryRowAfterComment));

const reLoginAfterComment = await fetch(`${BASE}/api/gallery/${SLUG}/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "mot-de-passe-solide" }),
});
const reLoginAfterCommentBody = await reLoginAfterComment.json();
check("le commentaire est visible à la reconnexion",
      reLoginAfterCommentBody.photos?.find((p) => p.id === photoId)?.comment === "en noir et blanc svp");

const tooLong = "x".repeat(600);
const commentTruncated = await fetch(`${BASE}/api/gallery/${SLUG}/comment`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ photoId, comment: tooLong }),
});
const commentTruncatedBody = await commentTruncated.json();
check("un commentaire trop long est tronqué plutôt que refusé",
      commentTruncated.ok && commentTruncatedBody.comment.length === 500);

const commentCleared = await fetch(`${BASE}/api/gallery/${SLUG}/comment`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ photoId, comment: "" }),
});
const commentClearedBody = await commentCleared.json();
check("un commentaire vide efface la note", commentCleared.ok && commentClearedBody.comment === "");

const detailAfterClear = await (await admin("GET", `/api/admin/galleries/${SLUG}`)).json();
const clearedPhoto = detailAfterClear.photos.find((p) => p.id === photoId);
check("effacer un commentaire efface aussi sa date",
      clearedPhoto?.comment === "" && clearedPhoto?.comment_at == null, JSON.stringify(clearedPhoto));

const commentMissingPhoto = await fetch(`${BASE}/api/gallery/${SLUG}/comment`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ photoId: "pho_NExistePas000", comment: "test" }),
});
check("commenter une photo inconnue est refusé", commentMissingPhoto.status === 404);

const commentCrossGallery = await fetch(`${BASE}/api/gallery/${SLUG}-voisine/comment`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ photoId, comment: "test" }),
});
check("le jeton d'une autre galerie ne permet pas de commenter",
      commentCrossGallery.status === 403, `HTTP ${commentCrossGallery.status}`);

const commentBadBody = await fetch(`${BASE}/api/gallery/${SLUG}/comment`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ photoId }),
});
check("commenter sans champ comment est refusé", commentBadBody.status === 400);

/* ---------- Journal d'accès ---------- */

await fetch(`${BASE}/api/gallery/${SLUG}/event`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ event: "capture_suspected", detail: "impr-ecran" }),
});
const bogusEvent = await fetch(`${BASE}/api/gallery/${SLUG}/event`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ event: "n-importe-quoi" }),
});
check("un évènement inconnu est refusé", bogusEvent.status === 400);

const logResponse = await admin("GET", `/api/admin/galleries/${SLUG}/log`);
const { log } = await logResponse.json();
check("le journal consigne connexion, échec, capture, sélection et commentaire",
      log.some((e) => e.event === "login") &&
      log.some((e) => e.event === "login_failed") &&
      log.some((e) => e.event === "capture_suspected") &&
      log.some((e) => e.event === "select" && e.detail === photoId) &&
      log.some((e) => e.event === "deselect" && e.detail === photoId) &&
      log.some((e) => e.event === "comment" && e.detail === photoId),
      log.map((e) => e.event).join(", "));
check("le journal ne contient aucune IP en clair",
      log.every((e) => !/^\d+\.\d+\.\d+\.\d+$/.test(e.ip_hash || "")));

/* ---------- Empreintes ---------- */

const prints = await (await admin("GET", "/api/admin/forensic")).json();
check("les empreintes sont consultables",
      prints.prints.some((p) => p.forensic_id === "123456789" && p.slug === SLUG));

/* ---------- Expiration ---------- */

const expired = await admin("POST", "/api/admin/galleries", {
  slug: `${SLUG}-expiree`, title: "Expirée", password: "mot-de-passe-solide",
  expiresAt: Math.floor(Date.now() / 1000) - 60,
});
await expired.json();
const expiredLogin = await fetch(`${BASE}/api/gallery/${SLUG}-expiree/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "mot-de-passe-solide" }),
});
check("une galerie expirée refuse l'accès", expiredLogin.status === 410, `HTTP ${expiredLogin.status}`);

/* ---------- Limitation des tentatives ---------- */

let throttled = false;
for (let i = 0; i < 14; i++) {
  const attempt = await fetch(`${BASE}/api/gallery/${SLUG}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: `essai-${i}` }),
  });
  if (attempt.status === 429) {
    throttled = true;
    break;
  }
}
check("les tentatives répétées sont bloquées", throttled);

/* ---------- Suppression ---------- */

const removed = await admin("DELETE", `/api/admin/galleries/${SLUG}`);
check("la galerie est supprimée", removed.ok);
const afterDelete = await fetch(`${BASE}/api/gallery/${SLUG}/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "mot-de-passe-solide" }),
});
check("la galerie supprimée n'est plus accessible", afterDelete.status === 401);
const orphanTile = await fetch(`${BASE}/api/gallery/${SLUG}/tile/${photoId}/1/0/0`, { headers: bearer });
check("les tuiles de la galerie supprimée ont disparu", orphanTile.status === 403 || orphanTile.status === 404,
      `HTTP ${orphanTile.status}`);

await admin("DELETE", `/api/admin/galleries/${SLUG}-voisine`);
await admin("DELETE", `/api/admin/galleries/${SLUG}-expiree`);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
