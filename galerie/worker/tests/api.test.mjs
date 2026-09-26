// Vérification de bout en bout de l'API, contre un `wrangler dev --local`
// (D1 et R2 émulés localement).
//
//   npx wrangler dev --local --port 8788
//   node tests/api.test.mjs

const BASE = process.env.BASE || "http://127.0.0.1:8788";
const SLUG = `essai-${Date.now().toString(36)}`;
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

async function signup(email, password) {
  const response = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, studioName: "Studio de test" }),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function adminClient(token) {
  return (method, path, body, raw = false) =>
    fetch(BASE + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(raw ? { "content-type": "application/octet-stream" } : body ? { "content-type": "application/json" } : {}),
      },
      body: raw ? body : body ? JSON.stringify(body) : undefined,
    });
}

/* ---------- Comptes photographes ---------- */

const EMAIL = `photographe-${RUN}@test.invalid`;
const PASSWORD = "mot-de-passe-de-test-1234";

const { response: signupResponse, data: signupData } = await signup(EMAIL, PASSWORD);
check("l'inscription crée un compte et ouvre une session",
      signupResponse.status === 201 && Boolean(signupData.token) && signupData.photographer?.email === EMAIL);

const duplicateSignup = await signup(EMAIL, PASSWORD);
check("un e-mail déjà utilisé est refusé à l'inscription", duplicateSignup.response.status === 409);

const weakPasswordSignup = await signup(`autre-${RUN}@test.invalid`, "court");
check("un mot de passe trop court est refusé à l'inscription", weakPasswordSignup.response.status === 400);

const badEmailSignup = await signup("pas-un-email", PASSWORD);
check("un e-mail invalide est refusé à l'inscription", badEmailSignup.response.status === 400);

const loginResponse = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const loginData = await loginResponse.json();
check("la connexion renvoie une session valide", loginResponse.ok && Boolean(loginData.token));

const wrongPasswordLogin = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: "mauvais-mot-de-passe" }),
});
check("un mauvais mot de passe est refusé à la connexion", wrongPasswordLogin.status === 401);

const unknownEmailLogin = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: `inconnu-${RUN}@test.invalid`, password: PASSWORD }),
});
check("un compte inconnu ne se distingue pas d'un mauvais mot de passe", unknownEmailLogin.status === 401);

const meResponse = await fetch(`${BASE}/api/auth/me`, { headers: { authorization: `Bearer ${loginData.token}` } });
const meData = await meResponse.json();
check("la session permet de relire son profil", meResponse.ok && meData.photographer?.email === EMAIL);

/* ---------- Mot de passe oublié ---------- */
// Le jeton de réinitialisation ne transite jamais par l'API — seulement par
// l'e-mail envoyé au photographe — donc le trajet complet « je reçois le
// lien, je choisis un nouveau mot de passe » ne peut pas être automatisé
// sans affaiblir la sécurité (ça reviendrait à exposer le jeton ailleurs
// que dans la boîte mail). Ce qui EST vérifiable depuis l'API, en revanche,
// c'est que rien ne fuite sur l'existence d'un compte, et que les entrées
// invalides sont refusées.

async function forgotPassword(email) {
  const response = await fetch(`${BASE}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return { response, data: await response.json().catch(() => ({})) };
}

const forgotKnown = await forgotPassword(EMAIL);
const forgotUnknown = await forgotPassword(`inconnu-${RUN}@test.invalid`);
const forgotMalformed = await forgotPassword("pas-un-email");
check("demander un lien pour un compte existant renvoie un succès générique",
      forgotKnown.response.status === 200 && forgotKnown.data.ok === true);
check("un compte inconnu reçoit exactement la même réponse qu'un compte existant",
      forgotUnknown.response.status === forgotKnown.response.status &&
      JSON.stringify(forgotUnknown.data) === JSON.stringify(forgotKnown.data));
check("une adresse mal formée reçoit aussi la même réponse générique",
      forgotMalformed.response.status === forgotKnown.response.status &&
      JSON.stringify(forgotMalformed.data) === JSON.stringify(forgotKnown.data));

const resetMissingToken = await fetch(`${BASE}/api/auth/reset-password`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "un-nouveau-mot-de-passe" }),
});
check("réinitialiser sans jeton est refusé", resetMissingToken.status === 400);

const resetBogusToken = await fetch(`${BASE}/api/auth/reset-password`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ token: "ce-jeton-n-existe-pas", password: "un-nouveau-mot-de-passe" }),
});
check("un jeton de réinitialisation inconnu est refusé", resetBogusToken.status === 400);

const resetWeakPassword = await fetch(`${BASE}/api/auth/reset-password`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ token: "peu-importe", password: "court" }),
});
check("un nouveau mot de passe trop court est refusé avant même de vérifier le jeton",
      resetWeakPassword.status === 400);

const admin = adminClient(signupData.token);

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

// La photo affichée au moment d'une capture est référencée, pour que le
// photographe sache laquelle est concernée — pas seulement qu'une capture
// a eu lieu quelque part dans la galerie.
await fetch(`${BASE}/api/gallery/${SLUG}/event`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ event: "capture_suspected", detail: "capture-macos", photoId }),
});
await fetch(`${BASE}/api/gallery/${SLUG}/event`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ event: "capture_suspected", detail: "perte-focus", photoId: "pho_NExistePas000" }),
});
// Sur macOS, le raccourci de capture est intercepté par le système avant
// d'atteindre le navigateur : "absence-breve" (changement de fenêtre très
// bref, mesuré côté client) est le signal de repli qui déclenche quand même
// une alerte — voir gallery.js et viewer.js pour le détail.
await fetch(`${BASE}/api/gallery/${SLUG}/event`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ event: "capture_suspected", detail: "absence-breve", photoId }),
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
check("une capture avec une photo réellement ouverte référence cette photo",
      log.some((e) => e.event === "capture_suspected" && e.detail === "capture-macos" && e.photo_id === photoId));
check("le signal de repli macOS (absence très brève) est accepté et référence la photo",
      log.some((e) => e.event === "capture_suspected" && e.detail === "absence-breve" && e.photo_id === photoId));
check("un identifiant de photo inconnu n'est jamais enregistré comme référence",
      log.some((e) => e.event === "capture_suspected" && e.detail === "perte-focus" && e.photo_id === ""));
check("le journal ne contient aucune IP en clair",
      log.every((e) => !/^\d+\.\d+\.\d+\.\d+$/.test(e.ip_hash || "")));

/* ---------- Empreintes ---------- */

const prints = await (await admin("GET", "/api/admin/forensic")).json();
check("les empreintes sont consultables",
      prints.prints.some((p) => p.forensic_id === "123456789" && p.slug === SLUG));

/* ---------- Cloisonnement entre comptes photographes ---------- */
// C'est le cœur de la promesse de sécurité : un compte ne doit jamais
// pouvoir lire, modifier ou même deviner l'existence des galeries d'un
// autre. On crée un second photographe et on essaie, depuis son compte,
// chaque opération sur les galeries/photos du premier.

const peerEmail = `voisin-${RUN}@test.invalid`;
const { data: peerSignup } = await signup(peerEmail, "mot-de-passe-du-voisin-1234");
const peerAdmin = adminClient(peerSignup.token);

const foreignList = await (await peerAdmin("GET", "/api/admin/galleries")).json();
check("un photographe ne voit aucune galerie d'un autre compte dans sa liste",
      !foreignList.galleries.some((g) => g.slug === SLUG));

const foreignDetail = await peerAdmin("GET", `/api/admin/galleries/${SLUG}`);
check("un photographe ne peut pas lire le détail de la galerie d'un autre compte", foreignDetail.status === 404);

const foreignAddPhoto = await peerAdmin("POST", `/api/admin/galleries/${SLUG}/photos`, {
  width: 10, height: 10, cols: 1, rows: 1,
});
check("un photographe ne peut pas ajouter une photo dans la galerie d'un autre compte",
      foreignAddPhoto.status === 404);

const foreignTileRead = await peerAdmin("GET", `/api/admin/tiles/${photoId}/1/0/0`);
check("un photographe ne peut pas lire les tuiles d'une photo d'un autre compte",
      foreignTileRead.status === 404);

const foreignTileWrite = await peerAdmin("PUT", `/api/admin/tiles/${photoId}/1/0/0`, TILE, true);
check("un photographe ne peut pas écraser les tuiles d'une photo d'un autre compte",
      foreignTileWrite.status === 404);

const foreignLog = await peerAdmin("GET", `/api/admin/galleries/${SLUG}/log`);
check("un photographe ne peut pas lire le journal d'une galerie d'un autre compte", foreignLog.status === 404);

const foreignPrints = await (await peerAdmin("GET", "/api/admin/forensic")).json();
check("les empreintes d'un photographe n'apparaissent pas chez un autre compte",
      !foreignPrints.prints.some((p) => p.forensic_id === "123456789"));

const foreignDelete = await peerAdmin("DELETE", `/api/admin/galleries/${SLUG}`);
check("un photographe ne peut pas supprimer la galerie d'un autre compte", foreignDelete.status === 404);

const stillThere = await (await admin("GET", `/api/admin/galleries/${SLUG}`)).json();
check("la galerie existe toujours après la tentative de suppression étrangère",
      stillThere.gallery?.slug === SLUG);

/* ---------- Régénération du mot de passe ---------- */

const foreignRegen = await peerAdmin("POST", `/api/admin/galleries/${SLUG}/password`, { password: "un-autre-mot-de-passe" });
check("un photographe ne peut pas régénérer le mot de passe d'une galerie d'un autre compte",
      foreignRegen.status === 404);

const weakRegen = await admin("POST", `/api/admin/galleries/${SLUG}/password`, { password: "court" });
check("un mot de passe de remplacement trop court est refusé", weakRegen.status === 400);

const NEW_PASSWORD = "nouveau-mot-de-passe-solide";
const regen = await admin("POST", `/api/admin/galleries/${SLUG}/password`, { password: NEW_PASSWORD });
check("le photographe peut régénérer le mot de passe de sa propre galerie", regen.ok);

const oldPasswordLogin = await fetch(`${BASE}/api/gallery/${SLUG}/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "mot-de-passe-solide" }),
});
check("l'ancien mot de passe ne fonctionne plus après régénération", oldPasswordLogin.status === 401);

const newPasswordLogin = await fetch(`${BASE}/api/gallery/${SLUG}/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: NEW_PASSWORD }),
});
check("le nouveau mot de passe fonctionne", newPasswordLogin.ok);

/* ---------- Arrière-plan de l'écran de connexion ---------- */

const unknownBackground = await (await fetch(`${BASE}/api/gallery/galerie-inexistante-xyz/background`)).json();
check("l'arrière-plan d'une galerie inconnue ne se distingue pas d'un arrière-plan par défaut",
      unknownBackground.type === "color" && unknownBackground.color === "", JSON.stringify(unknownBackground));

const unknownBackgroundImage = await fetch(`${BASE}/api/gallery/galerie-inexistante-xyz/background-image`);
check("l'image d'arrière-plan d'une galerie inconnue est un 404, comme pour une galerie sans image",
      unknownBackgroundImage.status === 404);

const defaultBackground = await (await fetch(`${BASE}/api/gallery/${SLUG}/background`)).json();
check("par défaut, une galerie n'a pas d'arrière-plan personnalisé",
      defaultBackground.type === "color" && defaultBackground.color === "", JSON.stringify(defaultBackground));

const foreignColorSet = await peerAdmin("POST", `/api/admin/galleries/${SLUG}/background/color`, { color: "#112233" });
check("un photographe ne peut pas changer l'arrière-plan d'une galerie d'un autre compte", foreignColorSet.status === 404);

const badColor = await admin("POST", `/api/admin/galleries/${SLUG}/background/color`, { color: "pas-une-couleur" });
check("une couleur mal formée est refusée", badColor.status === 400);

const colorSet = await admin("POST", `/api/admin/galleries/${SLUG}/background/color`, { color: "#112233" });
check("le photographe peut fixer une couleur d'arrière-plan", colorSet.ok);

const backgroundAfterColor = await (await fetch(`${BASE}/api/gallery/${SLUG}/background`)).json();
check("la couleur choisie est bien renvoyée au client",
      backgroundAfterColor.type === "color" && backgroundAfterColor.color === "#112233", JSON.stringify(backgroundAfterColor));

const foreignImageSet = await peerAdmin("PUT", `/api/admin/galleries/${SLUG}/background/image`, TILE, true);
check("un photographe ne peut pas importer une image d'arrière-plan pour une galerie d'un autre compte",
      foreignImageSet.status === 404);

const imageSet = await admin("PUT", `/api/admin/galleries/${SLUG}/background/image`, TILE, true);
check("le photographe peut importer une image d'arrière-plan", imageSet.ok);

const backgroundAfterImage = await (await fetch(`${BASE}/api/gallery/${SLUG}/background`)).json();
check("le type bascule sur « image » après import", backgroundAfterImage.type === "image", JSON.stringify(backgroundAfterImage));

const backgroundImage = await fetch(`${BASE}/api/gallery/${SLUG}/background-image`);
const backgroundImageBytes = await backgroundImage.arrayBuffer();
check("l'image d'arrière-plan est servie publiquement, sans authentification",
      backgroundImage.ok && backgroundImageBytes.byteLength === TILE.length &&
      backgroundImage.headers.get("content-type") === "image/jpeg");

const foreignReset = await peerAdmin("DELETE", `/api/admin/galleries/${SLUG}/background`);
check("un photographe ne peut pas réinitialiser l'arrière-plan d'une galerie d'un autre compte",
      foreignReset.status === 404);

const backgroundReset = await admin("DELETE", `/api/admin/galleries/${SLUG}/background`);
check("le photographe peut réinitialiser l'arrière-plan à la couleur par défaut", backgroundReset.ok);

const backgroundAfterReset = await (await fetch(`${BASE}/api/gallery/${SLUG}/background`)).json();
check("après réinitialisation, l'arrière-plan redevient la couleur par défaut",
      backgroundAfterReset.type === "color" && backgroundAfterReset.color === "", JSON.stringify(backgroundAfterReset));

const backgroundImageAfterReset = await fetch(`${BASE}/api/gallery/${SLUG}/background-image`);
check("l'image d'arrière-plan n'est plus servie après réinitialisation", backgroundImageAfterReset.status === 404);

/* ---------- Mise en page de la galerie ---------- */

const galleryBeforeLayout = await (await admin("GET", `/api/admin/galleries/${SLUG}`)).json();
check("par défaut, une galerie s'affiche en grille",
      galleryBeforeLayout.gallery?.layout === "grille", JSON.stringify(galleryBeforeLayout.gallery?.layout));

const foreignLayoutSet = await peerAdmin("POST", `/api/admin/galleries/${SLUG}/layout`, { layout: "mosaique" });
check("un photographe ne peut pas changer la mise en page d'une galerie d'un autre compte", foreignLayoutSet.status === 404);

const badLayout = await admin("POST", `/api/admin/galleries/${SLUG}/layout`, { layout: "n-importe-quoi" });
check("une mise en page inconnue est refusée", badLayout.status === 400);

const layoutSet = await admin("POST", `/api/admin/galleries/${SLUG}/layout`, { layout: "mosaique" });
check("le photographe peut choisir la mosaïque", layoutSet.ok);

const galleryAfterLayout = await (await admin("GET", `/api/admin/galleries/${SLUG}`)).json();
check("la mise en page choisie est bien renvoyée au tableau de bord",
      galleryAfterLayout.gallery?.layout === "mosaique", JSON.stringify(galleryAfterLayout.gallery?.layout));

const clientLoginAfterLayout = await (await fetch(`${BASE}/api/gallery/${SLUG}/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: NEW_PASSWORD }),
})).json();
check("la mise en page choisie est bien transmise au client",
      clientLoginAfterLayout.gallery?.layout === "mosaique", JSON.stringify(clientLoginAfterLayout.gallery?.layout));

const layoutBackToGrille = await admin("POST", `/api/admin/galleries/${SLUG}/layout`, { layout: "defilement" });
check("le photographe peut basculer vers le défilement", layoutBackToGrille.ok);

/* ---------- Forfait et suppléments ---------- */

check("par défaut, une galerie n'a pas de forfait défini",
      galleryBeforeLayout.gallery?.included_photos === null &&
      galleryBeforeLayout.gallery?.extra_count === 0 &&
      galleryBeforeLayout.gallery?.extra_total_cents === 0,
      JSON.stringify(galleryBeforeLayout.gallery));

const quotaSlug = `${SLUG}-quota`;
const quotaCreated = await admin("POST", "/api/admin/galleries", {
  slug: quotaSlug, title: "Séance forfait", password: "mot-de-passe-solide",
  includedPhotos: 2, extraPhotoPrice: "15",
});
const quotaGallery = await quotaCreated.json();
check("une galerie peut être créée avec un forfait", quotaCreated.status === 201);

const badIncluded = await admin("POST", "/api/admin/galleries", {
  slug: `${quotaSlug}-b`, password: "mot-de-passe-solide", includedPhotos: -1,
});
check("un nombre de photos incluses négatif est refusé à la création", badIncluded.status === 400);

const badPrice = await admin("POST", "/api/admin/galleries", {
  slug: `${quotaSlug}-c`, password: "mot-de-passe-solide", extraPhotoPrice: "pas-un-prix",
});
check("un prix de supplément invalide est refusé à la création", badPrice.status === 400);

const quotaPhotoIds = [];
for (let i = 0; i < 4; i++) {
  const id = `pho_Quota${RUN}${i}`;
  const added = await admin("POST", `/api/admin/galleries/${quotaSlug}/photos`, {
    id, position: i, width: 100, height: 100, cols: 1, rows: 1,
  });
  check(`la photo de test forfait n° ${i} est enregistrée`, added.status === 201);
  quotaPhotoIds.push(id);
}

const quotaLogin = await fetch(`${BASE}/api/gallery/${quotaSlug}/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "mot-de-passe-solide" }),
});
const quotaSession = await quotaLogin.json();
check("le forfait est transmis au client dès la connexion",
      quotaSession.gallery?.includedPhotos === 2 && quotaSession.gallery?.extraPhotoPriceCents === 1500,
      JSON.stringify(quotaSession.gallery));
const quotaBearer = { authorization: `Bearer ${quotaSession.token}` };

// Le client sélectionne ses 4 photos : 2 incluses dans le forfait, 2 en supplément.
for (const id of quotaPhotoIds) {
  await fetch(`${BASE}/api/gallery/${quotaSlug}/select`, {
    method: "POST",
    headers: { ...quotaBearer, "content-type": "application/json" },
    body: JSON.stringify({ photoId: id, selected: true }),
  });
}

const quotaDetail = await (await admin("GET", `/api/admin/galleries/${quotaSlug}`)).json();
check("le nombre de suppléments est calculé à partir des coups de cœur du client",
      quotaDetail.gallery?.selected_count === 4 &&
      quotaDetail.gallery?.extra_count === 2 &&
      quotaDetail.gallery?.extra_total_cents === 3000,
      JSON.stringify(quotaDetail.gallery));

const quotaList = await (await admin("GET", "/api/admin/galleries")).json();
const quotaListRow = quotaList.galleries.find((g) => g.slug === quotaSlug);
check("le supplément apparaît aussi dans la liste des galeries",
      quotaListRow?.extra_count === 2 && quotaListRow?.extra_total_cents === 3000,
      JSON.stringify(quotaListRow));

const foreignQuotaSet = await peerAdmin("POST", `/api/admin/galleries/${quotaSlug}/quota`, { includedPhotos: 0, extraPhotoPrice: "1" });
check("un photographe ne peut pas modifier le forfait d'une galerie d'un autre compte", foreignQuotaSet.status === 404);

const badQuotaUpdate = await admin("POST", `/api/admin/galleries/${quotaSlug}/quota`, { includedPhotos: "beaucoup" });
check("une valeur de forfait non entière est refusée", badQuotaUpdate.status === 400);

const quotaUpdated = await admin("POST", `/api/admin/galleries/${quotaSlug}/quota`, { includedPhotos: 10, extraPhotoPrice: "20" });
check("le photographe peut modifier le forfait après coup", quotaUpdated.ok);

const quotaAfterUpdate = await (await admin("GET", `/api/admin/galleries/${quotaSlug}`)).json();
check("aucun supplément n'est dû une fois le forfait relevé au-dessus du nombre sélectionné",
      quotaAfterUpdate.gallery?.included_photos === 10 && quotaAfterUpdate.gallery?.extra_count === 0,
      JSON.stringify(quotaAfterUpdate.gallery));

const quotaCleared = await admin("POST", `/api/admin/galleries/${quotaSlug}/quota`, {});
check("le forfait peut être retiré (retour à « aucun forfait défini »)", quotaCleared.ok);

const quotaAfterClear = await (await admin("GET", `/api/admin/galleries/${quotaSlug}`)).json();
check("après retrait, plus aucun supplément n'est jamais calculé",
      quotaAfterClear.gallery?.included_photos === null && quotaAfterClear.gallery?.extra_count === 0,
      JSON.stringify(quotaAfterClear.gallery));

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

/* ---------- Paiement en ligne (Stripe Connect) et facturation ---------- */
// Sans STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET configurées en local (comme
// en environnement de test ici), les appels à l'API Stripe elle-même ne
// peuvent pas être exercés de bout en bout — seul leur câblage l'est : refus
// propre plutôt que plantage, cloisonnement, persistance du profil.

const meBeforeBilling = await (await admin("GET", "/api/auth/me")).json();
check("par défaut, aucun compte Stripe n'est connecté",
      meBeforeBilling.photographer?.stripeConnected === false &&
      meBeforeBilling.photographer?.stripeChargesEnabled === false &&
      meBeforeBilling.photographer?.billingCompanyName === "",
      JSON.stringify(meBeforeBilling.photographer));

const connectNoStripe = await admin("POST", "/api/admin/stripe/connect", {
  returnUrl: "https://example.test/retour", refreshUrl: "https://example.test/reprise",
});
check("la connexion Stripe échoue proprement quand la plateforme n'est pas configurée",
      connectNoStripe.status === 503, `HTTP ${connectNoStripe.status}`);

const connectNoReturnUrl = await admin("POST", "/api/admin/stripe/connect", {});
check("la connexion Stripe exige les URL de retour", connectNoReturnUrl.status === 400);

const refreshNotConnected = await (await admin("POST", "/api/admin/stripe/refresh")).json();
check("relire le statut sans compte connecté ne contacte jamais Stripe",
      refreshNotConnected.connected === false && refreshNotConnected.chargesEnabled === false,
      JSON.stringify(refreshNotConnected));

const billingSet = await admin("POST", "/api/admin/billing", {
  companyName: "Little Dream Photos SRL", address: "Rue de la Paix 1, 1000 Bruxelles, Belgique", vatNumber: "BE0123456789",
});
check("le profil de facturation peut être enregistré", billingSet.ok);

const meAfterBilling = await (await admin("GET", "/api/auth/me")).json();
check("le profil de facturation enregistré est bien relu",
      meAfterBilling.photographer?.billingCompanyName === "Little Dream Photos SRL" &&
      meAfterBilling.photographer?.billingAddress === "Rue de la Paix 1, 1000 Bruxelles, Belgique" &&
      meAfterBilling.photographer?.billingVatNumber === "BE0123456789",
      JSON.stringify(meAfterBilling.photographer));

const peerMeAfterBilling = await (await peerAdmin("GET", "/api/auth/me")).json();
check("le profil de facturation d'un compte n'apparaît jamais chez un autre",
      peerMeAfterBilling.photographer?.billingCompanyName === "", JSON.stringify(peerMeAfterBilling.photographer));

const webhookNoSecret = await fetch(`${BASE}/api/stripe/webhook`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "account.updated" }),
});
check("le webhook Stripe refuse proprement quand il n'est pas configuré",
      webhookNoSecret.status === 503, `HTTP ${webhookNoSecret.status}`);

/* ---------- Règlement d'un supplément (/checkout) ---------- */
// Toujours sans compte Stripe réel en local : seules les vérifications qui
// précèdent l'appel Stripe lui-même sont exerçables ici (authentification,
// forfait absent, plateforme non activée) — la création effective d'une
// session est couverte séparément dans stripe.test.mjs, sans réseau.

// Le forfait de cette galerie a été retiré plus haut (voir "après retrait,
// plus aucun supplément..." ci-dessus) — on le remet pour que le refus testé
// ici soit bien celui de Stripe, pas celui de l'absence de forfait.
await admin("POST", `/api/admin/galleries/${quotaSlug}/quota`, { includedPhotos: 10, extraPhotoPrice: "20" });

const checkoutNoAuth = await fetch(`${BASE}/api/gallery/${quotaSlug}/checkout`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ successUrl: "https://example.test/succes", cancelUrl: "https://example.test/annule" }),
});
check("régler un supplément sans jeton est refusé", checkoutNoAuth.status === 401);

const checkoutNoStripe = await fetch(`${BASE}/api/gallery/${quotaSlug}/checkout`, {
  method: "POST",
  headers: { ...quotaBearer, "content-type": "application/json" },
  body: JSON.stringify({ successUrl: "https://example.test/succes", cancelUrl: "https://example.test/annule" }),
});
check("régler un supplément échoue proprement quand le photographe n'a pas activé Stripe",
      checkoutNoStripe.status === 503, `HTTP ${checkoutNoStripe.status}`);

const noQuotaSlug = `${SLUG}-sans-forfait`;
await admin("POST", "/api/admin/galleries", { slug: noQuotaSlug, password: "mot-de-passe-solide" });
const noQuotaLogin = await (await fetch(`${BASE}/api/gallery/${noQuotaSlug}/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "mot-de-passe-solide" }),
})).json();
const noQuotaBearer = { authorization: `Bearer ${noQuotaLogin.token}` };
const checkoutNoQuota = await fetch(`${BASE}/api/gallery/${noQuotaSlug}/checkout`, {
  method: "POST",
  headers: { ...noQuotaBearer, "content-type": "application/json" },
  body: JSON.stringify({ successUrl: "https://example.test/succes", cancelUrl: "https://example.test/annule" }),
});
check("régler un supplément est refusé quand la galerie n'a aucun forfait défini",
      checkoutNoQuota.status === 400, `HTTP ${checkoutNoQuota.status}`);
await admin("DELETE", `/api/admin/galleries/${noQuotaSlug}`);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
