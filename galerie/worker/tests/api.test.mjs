// Vérification de bout en bout de l'API, contre un `wrangler dev --local`
// (D1 et R2 émulés localement).
//
//   npm run dev:local
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

// Formule d'abonnement posée directement dans la base locale (comme le
// ferait le webhook Stripe) : les comptes de test passent en Pro pour ne pas
// buter sur les limites de la formule gratuite, testées à part plus bas.
const { execFileSync: execSync } = await import("node:child_process");
const { fileURLToPath: pathOf } = await import("node:url");
const WORKER_ROOT = new URL("..", import.meta.url);
async function setPlan(email, plan, status = "active") {
  execSync("npx", ["wrangler", "d1", "execute", "galerie-protegee", "--local", "--command",
    `UPDATE photographers SET plan = '${plan}', plan_status = '${status}' WHERE email = '${email}'`], { cwd: pathOf(WORKER_ROOT), stdio: "pipe" });
  for (let i = 0; i < 20; i++) {
    try {
      if ((await fetch(`${BASE}/health`, { headers: { connection: "close" } })).ok) return;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 500));
  }
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
if (signupResponse.status === 201) await setPlan(EMAIL, "pro");
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

/* ---------- Codes couleur et repères annotés ---------- */

check("une photo n'a ni code couleur ni repère au départ",
      detailAfterClear.photos[0]?.tag === "" && Array.isArray(detailAfterClear.photos[0]?.marks) && detailAfterClear.photos[0].marks.length === 0,
      JSON.stringify({ tag: detailAfterClear.photos[0]?.tag, marks: detailAfterClear.photos[0]?.marks }));

const tagNoAuth = await fetch(`${BASE}/api/gallery/${SLUG}/tag`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ photoId, tag: "green" }),
});
check("poser un code couleur sans jeton est refusé", tagNoAuth.status === 401);

const tagUnknown = await fetch(`${BASE}/api/gallery/${SLUG}/tag`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ photoId, tag: "bleu" }),
});
check("un code couleur inconnu est refusé", tagUnknown.status === 400);

const tagSet = await fetch(`${BASE}/api/gallery/${SLUG}/tag`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ photoId, tag: "yellow" }),
});
const tagSetBody = await tagSet.json();
check("le client peut marquer une photo « à retoucher »", tagSet.ok && tagSetBody.tag === "yellow", JSON.stringify(tagSetBody));

const detailAfterTag = await (await admin("GET", `/api/admin/galleries/${SLUG}`)).json();
check("le code couleur apparaît côté administration, indépendamment du coup de cœur",
      detailAfterTag.photos.find((p) => p.id === photoId)?.tag === "yellow",
      JSON.stringify(detailAfterTag.photos.find((p) => p.id === photoId)?.tag));

const marksNoAuth = await fetch(`${BASE}/api/gallery/${SLUG}/marks`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ photoId, marks: [] }),
});
check("poser des repères sans jeton est refusé", marksNoAuth.status === 401);

const marksOutOfBounds = await fetch(`${BASE}/api/gallery/${SLUG}/marks`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ photoId, marks: [{ x: 1.4, y: 0.2, note: "hors cadre" }] }),
});
check("un repère hors de la photo est refusé", marksOutOfBounds.status === 400);

const tooManyMarks = Array.from({ length: 13 }, (_, i) => ({ x: i / 20, y: 0.5, note: "" }));
const marksTooMany = await fetch(`${BASE}/api/gallery/${SLUG}/marks`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ photoId, marks: tooManyMarks }),
});
check("plus de 12 repères sur une même photo est refusé", marksTooMany.status === 400);

const marksSet = await fetch(`${BASE}/api/gallery/${SLUG}/marks`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ photoId, marks: [
    { x: 0.25, y: 0.5, note: "  retirer ce reflet  " },
    { x: 0.8, y: 0.1, note: "x".repeat(300) },
  ] }),
});
const marksSetBody = await marksSet.json();
check("le client peut poser des repères annotés (notes nettoyées et bornées)",
      marksSet.ok && marksSetBody.marks?.length === 2 &&
      marksSetBody.marks[0].note === "retirer ce reflet" && marksSetBody.marks[0].x === 0.25 &&
      marksSetBody.marks[1].note.length === 200,
      JSON.stringify(marksSetBody));

const detailAfterMarks = await (await admin("GET", `/api/admin/galleries/${SLUG}`)).json();
const markedPhoto = detailAfterMarks.photos.find((p) => p.id === photoId);
check("les repères apparaissent côté administration, avec leurs coordonnées relatives",
      markedPhoto?.marks?.length === 2 && markedPhoto.marks[0].y === 0.5 && markedPhoto.marks[0].note === "retirer ce reflet",
      JSON.stringify(markedPhoto?.marks));

const reLoginAfterMarks = await (await fetch(`${BASE}/api/gallery/${SLUG}/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "mot-de-passe-solide" }),
})).json();
const reLoggedPhoto = reLoginAfterMarks.photos?.find((p) => p.id === photoId);
check("code couleur et repères sont visibles à la reconnexion du client",
      reLoggedPhoto?.tag === "yellow" && reLoggedPhoto?.marks?.length === 2, JSON.stringify(reLoggedPhoto));

const logAfterMarks = await (await admin("GET", `/api/admin/galleries/${SLUG}/log`)).json();
check("code couleur et repères sont consignés au journal",
      logAfterMarks.log.some((e) => e.event === "tag" && e.detail === photoId) &&
      logAfterMarks.log.some((e) => e.event === "mark" && e.detail === photoId));

const marksMissingPhoto = await fetch(`${BASE}/api/gallery/${SLUG}/marks`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ photoId: "pho_NExistePas000", marks: [] }),
});
check("poser un repère sur une photo inconnue est refusé", marksMissingPhoto.status === 404);

const tagCleared = await fetch(`${BASE}/api/gallery/${SLUG}/tag`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ photoId, tag: "" }),
});
const marksCleared = await fetch(`${BASE}/api/gallery/${SLUG}/marks`, {
  method: "POST",
  headers: { ...bearer, "content-type": "application/json" },
  body: JSON.stringify({ photoId, marks: [] }),
});
const detailAfterReset = await (await admin("GET", `/api/admin/galleries/${SLUG}`)).json();
const resetPhoto = detailAfterReset.photos.find((p) => p.id === photoId);
check("retirer le code couleur et les repères remet la photo à neuf",
      tagCleared.ok && marksCleared.ok && resetPhoto?.tag === "" && resetPhoto?.marks?.length === 0,
      JSON.stringify({ tag: resetPhoto?.tag, marks: resetPhoto?.marks }));

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
await setPlan(peerEmail, "pro");
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

/* ---------- Musique d'ambiance ---------- */

const MUSIC = new Uint8Array(20000);
for (let i = 0; i < MUSIC.length; i++) MUSIC[i] = (i * 31 + 7) & 0xff;

const foreignMusicSet = await peerAdmin("PUT", `/api/admin/galleries/${SLUG}/music?name=pirate.mp3`, MUSIC, true);
check("un photographe ne peut pas déposer une musique sur une galerie d'un autre compte", foreignMusicSet.status === 404);

const musicBefore = await (await fetch(`${BASE}/api/gallery/${SLUG}/music`)).ok;
check("sans musique déposée, la piste n'existe pas pour le client", musicBefore === false);

const musicSet = await admin("PUT", `/api/admin/galleries/${SLUG}/music?name=ambiance.mp3`, MUSIC, true);
const musicSetData = await musicSet.json();
check("le photographe peut déposer une musique d'ambiance", musicSet.ok && musicSetData.musicName === "ambiance.mp3",
      JSON.stringify(musicSetData));

const galleryAfterMusic = await (await admin("GET", `/api/admin/galleries/${SLUG}`)).json();
check("le nom de la piste est bien renvoyé au tableau de bord",
      galleryAfterMusic.gallery?.music_name === "ambiance.mp3", JSON.stringify(galleryAfterMusic.gallery?.music_name));

const clientLoginWithMusic = await (await fetch(`${BASE}/api/gallery/${SLUG}/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: NEW_PASSWORD }),
})).json();
check("le client est prévenu qu'une musique accompagne la galerie",
      clientLoginWithMusic.gallery?.hasMusic === true, JSON.stringify(clientLoginWithMusic.gallery?.hasMusic));

const musicGet = await fetch(`${BASE}/api/gallery/${SLUG}/music`);
const musicBytes = new Uint8Array(await musicGet.arrayBuffer());
check("la piste est servie au client en audio/mpeg, octet pour octet",
      musicGet.status === 200 &&
      (musicGet.headers.get("content-type") || "").startsWith("audio/mpeg") &&
      musicBytes.length === MUSIC.length && musicBytes.every((b, i) => b === MUSIC[i]),
      `status ${musicGet.status}, ${musicBytes.length} octets`);

const musicRange = await fetch(`${BASE}/api/gallery/${SLUG}/music`, { headers: { range: "bytes=0-99" } });
const musicRangeBytes = new Uint8Array(await musicRange.arrayBuffer());
check("le navigateur peut demander un morceau de la piste (lecture progressive)",
      musicRange.status === 206 &&
      musicRange.headers.get("content-range") === `bytes 0-99/${MUSIC.length}` &&
      musicRangeBytes.length === 100 && musicRangeBytes.every((b, i) => b === MUSIC[i]),
      `status ${musicRange.status}, content-range ${musicRange.headers.get("content-range")}`);

const foreignMusicDelete = await peerAdmin("DELETE", `/api/admin/galleries/${SLUG}/music`);
check("un photographe ne peut pas retirer la musique d'une galerie d'un autre compte", foreignMusicDelete.status === 404);

const musicDelete = await admin("DELETE", `/api/admin/galleries/${SLUG}/music`);
check("le photographe peut retirer la musique", musicDelete.ok);

const musicAfterDelete = await fetch(`${BASE}/api/gallery/${SLUG}/music`);
const clientLoginNoMusic = await (await fetch(`${BASE}/api/gallery/${SLUG}/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: NEW_PASSWORD }),
})).json();
check("une fois retirée, la piste n'est plus servie et le client n'en est plus informé",
      musicAfterDelete.status === 404 && clientLoginNoMusic.gallery?.hasMusic === false,
      `status ${musicAfterDelete.status}, hasMusic ${JSON.stringify(clientLoginNoMusic.gallery?.hasMusic)}`);

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

/* ---------- E-mail du client (pour l'envoi de la facture) ---------- */

const clientEmailSlug = `${SLUG}-email-client`;
const clientEmailCreated = await admin("POST", "/api/admin/galleries", {
  slug: clientEmailSlug, password: "mot-de-passe-solide", clientEmail: "famille.dupont@example.com",
});
check("une galerie peut être créée avec un e-mail client", clientEmailCreated.status === 201);

const clientEmailDetail = await (await admin("GET", `/api/admin/galleries/${clientEmailSlug}`)).json();
check("l'e-mail client enregistré est bien relu dans le détail de la galerie",
      clientEmailDetail.gallery?.client_email === "famille.dupont@example.com",
      JSON.stringify(clientEmailDetail.gallery?.client_email));

const badClientEmail = await admin("POST", "/api/admin/galleries", {
  slug: `${clientEmailSlug}-b`, password: "mot-de-passe-solide", clientEmail: "pas-un-email",
});
check("un e-mail client mal formé est refusé à la création", badClientEmail.status === 400);

await admin("DELETE", `/api/admin/galleries/${clientEmailSlug}`);

/* ---------- Téléchargement de facture (admin + client) ---------- */
// Aucune facture réelle n'existe en local (elle n'est émise qu'une fois un
// paiement confirmé par le vrai webhook Stripe — voir invoices.test.mjs pour
// le calcul de TVA et la génération du PDF, sans réseau). Ce qui EST
// vérifiable ici, c'est le cloisonnement et le refus propre d'un identifiant
// inconnu, pour les deux routes de téléchargement.

const invoiceAdminUnknown = await admin("GET", "/api/admin/invoices/inv_inexistante");
check("télécharger une facture inconnue depuis l'admin renvoie 404", invoiceAdminUnknown.status === 404);

const invoiceClientNoAuth = await fetch(`${BASE}/api/gallery/${quotaSlug}/invoice/inv_inexistante`);
check("télécharger une facture sans session client est refusé", invoiceClientNoAuth.status === 401);

const invoiceClientUnknown = await fetch(`${BASE}/api/gallery/${quotaSlug}/invoice/inv_inexistante`, {
  headers: quotaBearer,
});
check("télécharger une facture inconnue depuis la galerie cliente renvoie 404", invoiceClientUnknown.status === 404);

/* ---------- Paramètres du compte (studio, mot de passe, e-mail, présentation par défaut) ---------- */

const studioNameSet = await admin("POST", "/api/admin/account", { studioName: "Nouveau nom de studio" });
check("le nom du studio peut être modifié", studioNameSet.status === 200);

const meAfterStudioName = await (await admin("GET", "/api/auth/me")).json();
check("le nouveau nom du studio est relu dans le profil",
      meAfterStudioName.photographer?.studioName === "Nouveau nom de studio");

const emptyStudioName = await admin("POST", "/api/admin/account", { studioName: "   " });
check("un nom de studio vide est refusé", emptyStudioName.status === 400);

const badDefaultLayout = await admin("POST", "/api/admin/account/defaults", { defaultLayout: "n-importe-quoi" });
check("une présentation par défaut inconnue est refusée", badDefaultLayout.status === 400);

const defaultLayoutSet = await admin("POST", "/api/admin/account/defaults", { defaultLayout: "mosaique" });
check("la présentation par défaut peut être modifiée", defaultLayoutSet.status === 200);

const meAfterDefaultLayout = await (await admin("GET", "/api/auth/me")).json();
check("la présentation par défaut choisie est relue dans le profil",
      meAfterDefaultLayout.photographer?.defaultLayout === "mosaique");

const defaultLayoutInheritedSlug = `${SLUG}-defaut-mosaique`;
const defaultLayoutInherited = await admin("POST", "/api/admin/galleries", {
  slug: defaultLayoutInheritedSlug, password: "mot-de-passe-solide",
});
check("une nouvelle galerie est créée avec succès après le changement de présentation par défaut",
      defaultLayoutInherited.status === 201);
const defaultLayoutInheritedDetail = await (await admin("GET", `/api/admin/galleries/${defaultLayoutInheritedSlug}`)).json();
check("une nouvelle galerie hérite de la présentation par défaut du compte",
      defaultLayoutInheritedDetail.gallery?.layout === "mosaique",
      JSON.stringify(defaultLayoutInheritedDetail.gallery?.layout));
await admin("DELETE", `/api/admin/galleries/${defaultLayoutInheritedSlug}`);
await admin("POST", "/api/admin/account/defaults", { defaultLayout: "grille" });

// Changer le mot de passe redemande le mot de passe ACTUEL (jamais la seule
// session) — un jeton volé ne doit jamais suffire seul à ce changement.
const wrongCurrentPassword = await admin("POST", "/api/admin/account/password", {
  currentPassword: "mauvais-mot-de-passe", newPassword: "un-autre-mot-de-passe-1234",
});
check("changer de mot de passe avec un mauvais mot de passe actuel est refusé (400, jamais 401 — ne déconnecte pas la session)",
      wrongCurrentPassword.status === 400);

const weakNewPassword = await admin("POST", "/api/admin/account/password", {
  currentPassword: PASSWORD, newPassword: "court",
});
check("un nouveau mot de passe trop court est refusé", weakNewPassword.status === 400);

const ACCOUNT_NEW_PASSWORD = "un-nouveau-mot-de-passe-1234";
const passwordChanged = await admin("POST", "/api/admin/account/password", {
  currentPassword: PASSWORD, newPassword: ACCOUNT_NEW_PASSWORD,
});
check("le mot de passe peut être changé en fournissant l'actuel", passwordChanged.status === 200);

const loginWithOldPassword = await fetch(`${BASE}/api/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
check("l'ancien mot de passe ne fonctionne plus après le changement", loginWithOldPassword.status === 401);

const loginWithNewPassword = await fetch(`${BASE}/api/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: ACCOUNT_NEW_PASSWORD }),
});
check("le nouveau mot de passe fonctionne pour se connecter", loginWithNewPassword.status === 200);

// Changer d'adresse e-mail redemande aussi le mot de passe actuel, mais ne
// prend jamais effet immédiatement : seule la confirmation du lien envoyé à
// la NOUVELLE adresse (jamais l'ancienne) l'applique réellement — voir plus
// bas. Sans ça, un jeton de session volé suffirait à rediriger silencieusement
// toutes les notifications futures du compte (dont les prochaines
// réinitialisations de mot de passe) vers une adresse contrôlée par l'attaquant.
const NEW_EMAIL = `nouvelle-adresse-${RUN}@test.invalid`;

const emailChangeWrongPassword = await admin("POST", "/api/admin/account/email", {
  newEmail: NEW_EMAIL, password: "mauvais-mot-de-passe",
});
check("demander un changement d'e-mail avec un mauvais mot de passe est refusé (400, jamais 401)",
      emailChangeWrongPassword.status === 400);

const emailChangeBadFormat = await admin("POST", "/api/admin/account/email", {
  newEmail: "pas-un-email", password: ACCOUNT_NEW_PASSWORD,
});
check("une nouvelle adresse mal formée est refusée", emailChangeBadFormat.status === 400);

const emailChangeSameAddress = await admin("POST", "/api/admin/account/email", {
  newEmail: EMAIL, password: ACCOUNT_NEW_PASSWORD,
});
check("demander à changer vers sa propre adresse actuelle est refusé", emailChangeSameAddress.status === 400);

const emailChangeTaken = await admin("POST", "/api/admin/account/email", {
  newEmail: peerEmail, password: ACCOUNT_NEW_PASSWORD,
});
check("une adresse déjà utilisée par un autre compte est refusée", emailChangeTaken.status === 409);

const emailChangeRequested = await admin("POST", "/api/admin/account/email", {
  newEmail: NEW_EMAIL, password: ACCOUNT_NEW_PASSWORD,
});
check("une demande de changement d'e-mail valide est acceptée", emailChangeRequested.status === 200);

const meAfterEmailRequest = await (await admin("GET", "/api/auth/me")).json();
check("l'adresse du compte ne change pas tant que le lien de confirmation n'a pas été ouvert",
      meAfterEmailRequest.photographer?.email === EMAIL);

// Le jeton lui-même ne transite jamais par l'API — seulement par l'e-mail
// envoyé à la nouvelle adresse (même raisonnement que pour reset-password
// plus haut) : le trajet complet n'est donc pas automatisable ici sans
// affaiblir la sécurité qu'il apporte. Ce qui EST vérifiable, c'est le refus
// propre d'un lien absent ou invalide.
const confirmEmailMissingToken = await fetch(`${BASE}/api/auth/confirm-email`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
});
check("confirmer un changement d'e-mail sans jeton est refusé", confirmEmailMissingToken.status === 400);

const confirmEmailBogusToken = await fetch(`${BASE}/api/auth/confirm-email`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "jeton-invalide" }),
});
check("confirmer un changement d'e-mail avec un jeton invalide est refusé", confirmEmailBogusToken.status === 400);

/* ---------- Facturation agrégée (toutes galeries confondues) ---------- */

const invoicesEmpty = await (await admin("GET", "/api/admin/invoices")).json();
check("la liste des factures est vide pour un compte qui n'en a émis aucune",
      Array.isArray(invoicesEmpty.invoices) && invoicesEmpty.invoices.length === 0 && invoicesEmpty.totalCents === 0);

const peerInvoices = await (await peerAdmin("GET", "/api/admin/invoices")).json();
check("un photographe ne voit jamais les factures d'un autre compte dans la liste agrégée",
      Array.isArray(peerInvoices.invoices) && !peerInvoices.invoices.some((inv) => inv.gallery_slug === SLUG));

/* ---------- Compteurs globaux (galeries, ventes, suppléments) ---------- */
// Testés en différentiel (avant/après), jamais en valeur absolue : le compte
// utilisé dans ce fichier accumule d'autres galeries au fil des sections
// précédentes, et ce test ne doit pas dépendre de leur nombre exact.

const statsBefore = await (await admin("GET", "/api/admin/stats")).json();
const peerStatsBefore = await (await peerAdmin("GET", "/api/admin/stats")).json();

const statsSlug = `${SLUG}-stats`;
const statsGalleryCreated = await admin("POST", "/api/admin/galleries", {
  slug: statsSlug, password: "mot-de-passe-solide", includedPhotos: 1, extraPhotoPrice: "10",
});
check("une galerie de test pour les compteurs peut être créée", statsGalleryCreated.status === 201);

const statsAfterCreate = await (await admin("GET", "/api/admin/stats")).json();
check("créer une galerie incrémente aussitôt le compteur de galeries créées",
      statsAfterCreate.galleriesCount === statsBefore.galleriesCount + 1,
      JSON.stringify({ before: statsBefore.galleriesCount, after: statsAfterCreate.galleriesCount }));
check("créer une galerie ne modifie ni les ventes ni les suppléments",
      statsAfterCreate.salesCount === statsBefore.salesCount &&
      statsAfterCreate.extrasPaidCount === statsBefore.extrasPaidCount &&
      statsAfterCreate.extrasDueCount === statsBefore.extrasDueCount);

// Deux photos sélectionnées contre un forfait d'une seule photo incluse : un
// supplément dû, jamais compté comme réglé tant qu'aucun paiement n'existe.
const statsPhotoIds = [];
for (let i = 0; i < 2; i++) {
  const id = `pho_Stats${RUN}${i}`;
  await admin("POST", `/api/admin/galleries/${statsSlug}/photos`, {
    id, position: i, width: 100, height: 100, cols: 1, rows: 1,
  });
  statsPhotoIds.push(id);
}
const statsLogin = await (await fetch(`${BASE}/api/gallery/${statsSlug}/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "mot-de-passe-solide" }),
})).json();
const statsBearer = { authorization: `Bearer ${statsLogin.token}` };
for (const id of statsPhotoIds) {
  await fetch(`${BASE}/api/gallery/${statsSlug}/select`, {
    method: "POST",
    headers: { ...statsBearer, "content-type": "application/json" },
    body: JSON.stringify({ photoId: id, selected: true }),
  });
}

const statsAfterDue = await (await admin("GET", "/api/admin/stats")).json();
check("un supplément non réglé apparaît dans le compteur « en attente », jamais dans « en ordre »",
      statsAfterDue.extrasDueCount === statsBefore.extrasDueCount + 1 &&
      statsAfterDue.extrasDueAmountCents === statsBefore.extrasDueAmountCents + 1000 &&
      statsAfterDue.extrasPaidCount === statsBefore.extrasPaidCount &&
      statsAfterDue.salesCount === statsBefore.salesCount &&
      statsAfterDue.salesAmountCents === statsBefore.salesAmountCents,
      JSON.stringify(statsAfterDue));

const peerStatsAfterDue = await (await peerAdmin("GET", "/api/admin/stats")).json();
check("le supplément dû d'un compte n'apparaît jamais dans les compteurs d'un autre",
      peerStatsAfterDue.extrasDueCount === peerStatsBefore.extrasDueCount &&
      peerStatsAfterDue.galleriesCount === peerStatsBefore.galleriesCount,
      JSON.stringify(peerStatsAfterDue));

await admin("DELETE", `/api/admin/galleries/${statsSlug}`);

const statsAfterDelete = await (await admin("GET", "/api/admin/stats")).json();
check("supprimer la galerie ramène les compteurs à leur état de départ",
      statsAfterDelete.galleriesCount === statsBefore.galleriesCount &&
      statsAfterDelete.extrasDueCount === statsBefore.extrasDueCount &&
      statsAfterDelete.extrasDueAmountCents === statsBefore.extrasDueAmountCents,
      JSON.stringify(statsAfterDelete));

/* ---------- Prénom/nom du compte ---------- */
// Jamais affiché au client, contrairement au nom de studio — juste de quoi
// identifier qui est qui sur la page propriétaire (voir plus bas).

const meBeforeName = await (await admin("GET", "/api/auth/me")).json();
check("prénom et nom sont vides par défaut (facultatifs, contrairement au nom de studio)",
      meBeforeName.photographer?.firstName === "" && meBeforeName.photographer?.lastName === "");

const nameSet = await admin("POST", "/api/admin/account/name", { firstName: "Camille", lastName: "Durand" });
check("le prénom et le nom peuvent être enregistrés", nameSet.status === 200);

const meAfterName = await (await admin("GET", "/api/auth/me")).json();
check("le prénom et le nom enregistrés sont bien relus dans le profil",
      meAfterName.photographer?.firstName === "Camille" && meAfterName.photographer?.lastName === "Durand");

/* ---------- Page propriétaire (toutes galeries et tous comptes confondus) ---------- */
// L'accès n'est jamais déterminé par ce que le client prétend (isOwner dans
// le profil n'est qu'un indicateur d'affichage) — chaque route /api/owner/*
// revérifie elle-même l'e-mail de l'appelant contre OWNER_EMAIL (variable du
// Worker, voir wrangler.toml). Un compte ordinaire, quel qu'il soit, doit
// toujours se voir refuser ces routes.

const ownerStatsForbidden = await admin("GET", "/api/owner/stats");
check("un compte ordinaire ne peut jamais lire les compteurs plateforme (403)", ownerStatsForbidden.status === 403);

const ownerPhotographersForbidden = await admin("GET", "/api/owner/photographers");
check("un compte ordinaire ne peut jamais lire la liste de tous les photographes (403)",
      ownerPhotographersForbidden.status === 403);

const ownerStatsNoAuth = await fetch(`${BASE}/api/owner/stats`);
check("les routes propriétaire exigent une session, comme le reste de l'admin (401)", ownerStatsNoAuth.status === 401);

const peerOwnerForbidden = await peerAdmin("GET", "/api/owner/photographers");
check("ce refus vaut pour tous les comptes ordinaires, pas seulement le premier", peerOwnerForbidden.status === 403);

// Le compte propriétaire lui-même n'a pas d'identité dédiée en base : c'est
// un compte photographe ordinaire dont l'e-mail correspond à OWNER_EMAIL.
// On le crée ici avec l'adresse réellement configurée côté Worker pour ce
// test — s'il existe déjà (un run précédent sur cette même base locale), on
// se connecte avec le mot de passe fixe utilisé ci-dessous plutôt que de
// recréer le compte.
const OWNER_EMAIL = "fagnantchristine@gmail.com";
const OWNER_PASSWORD = "mot-de-passe-de-la-proprietaire-1234";

let ownerToken;
const { response: ownerSignupResponse, data: ownerSignupData } = await signup(OWNER_EMAIL, OWNER_PASSWORD);
if (ownerSignupResponse.status === 201) {
  ownerToken = ownerSignupData.token;
} else {
  const ownerLoginResponse = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  ownerToken = (await ownerLoginResponse.json()).token;
}
const ownerClient = adminClient(ownerToken);

const ownerMe = await (await ownerClient("GET", "/api/auth/me")).json();
// Ce test couple forcément l'adresse ci-dessus à OWNER_EMAIL tel que
// configuré côté Worker local (wrangler.toml) : s'ils ne correspondent pas
// (mauvaise config locale), cette seule vérification échoue avec un message
// clair plutôt que de laisser échouer en cascade les appels /owner/* qui
// suivent.
check("le compte dont l'e-mail correspond à OWNER_EMAIL se voit bien reconnaître isOwner",
      ownerMe.photographer?.isOwner === true,
      "OWNER_EMAIL (wrangler.toml) doit valoir exactement " + OWNER_EMAIL + " pour ce test");

const ownerStats = await (await ownerClient("GET", "/api/owner/stats")).json();
check("la propriétaire peut lire les compteurs plateforme",
      typeof ownerStats.photographersCount === "number" && typeof ownerStats.galleriesCount === "number",
      JSON.stringify(ownerStats));
check("les compteurs plateforme comptent bien plus que ce seul compte (les autres comptes créés par ce test)",
      ownerStats.photographersCount >= 3, JSON.stringify(ownerStats.photographersCount));

const ownerPhotographers = await (await ownerClient("GET", "/api/owner/photographers")).json();
const ownerRow = ownerPhotographers.photographers.find((p) => p.email === OWNER_EMAIL);
check("la propriétaire apparaît elle-même dans la liste de tous les comptes", Boolean(ownerRow));

const adminRow = ownerPhotographers.photographers.find((p) => p.email === EMAIL);
check("un compte créé plus haut dans ce test apparaît dans la liste, avec son prénom/nom",
      adminRow?.firstName === "Camille" && adminRow?.lastName === "Durand", JSON.stringify(adminRow));
check("les mots de passe ne figurent jamais dans la liste",
      !JSON.stringify(ownerPhotographers).toLowerCase().includes("password"));

/* ---------- Bibliothèque musicale et liens Spotify & co ---------- */

const TRACK = new Uint8Array(6000);
for (let i = 0; i < TRACK.length; i++) TRACK[i] = (i * 13 + 5) & 0xff;
const trackQuery = `title=${encodeURIComponent("Matin doux")}&artist=Test&mood=douce&credit=${encodeURIComponent("Artiste — CC BY 4.0")}&duration=95`;
const trackForbidden = await admin("PUT", `/api/owner/music?${trackQuery}`, TRACK, true);
check("seule la propriétaire peut ajouter un morceau à la bibliothèque (403)", trackForbidden.status === 403);
const trackBadMood = await ownerClient("PUT", "/api/owner/music?title=X&mood=inconnue", TRACK, true);
const trackNoTitle = await ownerClient("PUT", "/api/owner/music?mood=douce", TRACK, true);
check("un morceau sans titre ou d'ambiance inconnue est refusé (400)", trackBadMood.status === 400 && trackNoTitle.status === 400);
const trackAddedResponse = await ownerClient("PUT", `/api/owner/music?${trackQuery}`, TRACK, true);
const trackAdded = (await trackAddedResponse.json()).track;
check("la propriétaire ajoute un morceau libre de droits à la bibliothèque",
      trackAddedResponse.status === 201 && /^mus_/.test(trackAdded?.id || "") && trackAdded.moodLabel === "Douce", JSON.stringify(trackAdded));
const library = await (await admin("GET", "/api/admin/music-library")).json();
check("chaque photographe voit la bibliothèque (titre, artiste, ambiance, durée, crédit)",
      library.tracks.some((t) => t.id === trackAdded.id && t.title === "Matin doux" && t.durationSeconds === 95 && t.credit === "Artiste — CC BY 4.0") &&
      library.moods?.piano === "Piano");
const trackPreview = await fetch(`${BASE}/api/music-library/${trackAdded.id}`, { headers: { range: "bytes=0-9" } });
const trackPreviewBytes = new Uint8Array(await trackPreview.arrayBuffer());
check("un morceau de la bibliothèque s'écoute avant d'être choisi (lecture partielle comprise)",
      trackPreview.status === 206 && trackPreviewBytes.length === 10 && trackPreviewBytes.every((b, i) => b === TRACK[i]));
check("un morceau inconnu de la bibliothèque n'est pas servi (404)",
      (await fetch(`${BASE}/api/music-library/mus_inconnu00`)).status === 404 && (await fetch(`${BASE}/api/music-library/..%2Fmusic`)).status === 404);

const musicSlug = `${SLUG}-musique`;
await admin("POST", "/api/admin/galleries", { slug: musicSlug, password: "mot-de-passe-solide", title: "Séance musique", clientName: "Famille Musique" });
const musicLogin = async () => (await fetch(`${BASE}/api/gallery/${musicSlug}/login`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "mot-de-passe-solide" }),
})).json();

const peerChoice = await peerAdmin("POST", `/api/admin/galleries/${musicSlug}/music-choice`, { source: "library", trackId: trackAdded.id });
check("un autre compte ne peut pas choisir la musique de cette galerie (404)", peerChoice.status === 404);
await admin("PUT", `/api/admin/galleries/${musicSlug}/music?name=avant.mp3`, MUSIC, true);
const libraryChoice = await admin("POST", `/api/admin/galleries/${musicSlug}/music-choice`, { source: "library", trackId: trackAdded.id });
const afterLibrary = await (await admin("GET", `/api/admin/galleries/${musicSlug}`)).json();
const libraryAudio = new Uint8Array(await (await fetch(`${BASE}/api/gallery/${musicSlug}/music`)).arrayBuffer());
const libraryLogin = await musicLogin();
check("choisir un morceau de la bibliothèque remplace le MP3 importé, et la fiche l'indique",
      libraryChoice.ok && afterLibrary.gallery?.music?.source === "library" && afterLibrary.gallery.music.track?.id === trackAdded.id &&
      afterLibrary.gallery.music_name === "", JSON.stringify(afterLibrary.gallery?.music));
check("le client entend le morceau choisi, avec son titre et son crédit",
      libraryAudio.length === TRACK.length && libraryAudio.every((b, i) => b === TRACK[i]) &&
      libraryLogin.gallery?.hasMusic === true && libraryLogin.gallery.music?.kind === "audio" &&
      libraryLogin.gallery.music.title === "Matin doux" && libraryLogin.gallery.music.credit === "Artiste — CC BY 4.0",
      JSON.stringify(libraryLogin.gallery?.music));

const badLink = await admin("POST", `/api/admin/galleries/${musicSlug}/music-choice`, { source: "link", url: "https://example.com/ma-musique" });
const badLinkBody = await badLink.json();
check("un lien qui n'est ni Spotify, ni Deezer, ni SoundCloud, ni YouTube est refusé avec une explication",
      badLink.status === 400 && /Spotify/.test(badLinkBody.error || ""), badLinkBody.error);
const spotifyChoice = await (await admin("POST", `/api/admin/galleries/${musicSlug}/music-choice`, {
  source: "link", url: "https://open.spotify.com/intl-fr/playlist/37i9dQZF1DX4sWSpwq3LiO?si=1234",
})).json();
const spotifyLogin = await musicLogin();
check("un lien Spotify devient le lecteur officiel : le client reçoit son adresse, plus de MP3 servi",
      spotifyChoice.provider === "spotify" &&
      spotifyLogin.gallery?.music?.kind === "embed" && spotifyLogin.gallery.music.embedUrl === "https://open.spotify.com/embed/playlist/37i9dQZF1DX4sWSpwq3LiO" &&
      spotifyLogin.gallery.music.providerLabel === "Spotify" && spotifyLogin.gallery.hasMusic === false &&
      (await fetch(`${BASE}/api/gallery/${musicSlug}/music`)).status === 404,
      JSON.stringify(spotifyLogin.gallery?.music));

await admin("POST", `/api/admin/galleries/${musicSlug}/music-choice`, { source: "library", trackId: trackAdded.id });
const trackDeleteForbidden = await admin("DELETE", `/api/owner/music/${trackAdded.id}`);
const trackDeleted = await ownerClient("DELETE", `/api/owner/music/${trackAdded.id}`);
const afterTrackDelete = await musicLogin();
check("retirer un morceau de la bibliothèque (propriétaire seulement) laisse les galeries qui l'utilisaient sans musique",
      trackDeleteForbidden.status === 403 && trackDeleted.ok && afterTrackDelete.gallery?.music === null &&
      (await fetch(`${BASE}/api/music-library/${trackAdded.id}`)).status === 404);
const noneChoice = await admin("POST", `/api/admin/galleries/${musicSlug}/music-choice`, { source: "none" });
check("« Aucune musique » est un choix possible", noneChoice.ok && (await musicLogin()).gallery?.music === null);
await admin("DELETE", `/api/admin/galleries/${musicSlug}`);

/* ---------- Livraison des photos définitives ---------- */

const { crc32: zipCrc32 } = await import("../src/delivery.js");
const deliverySlug = `${SLUG}-livraison`;
await admin("POST", "/api/admin/galleries", {
  slug: deliverySlug, password: "mot-de-passe-solide", title: "Séance livrée", clientName: "Famille Livrée", clientEmail: "client-livraison@test.invalid",
});
const deliveryLogin = async () => (await fetch(`${BASE}/api/gallery/${deliverySlug}/login`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "mot-de-passe-solide" }),
})).json();
const HD1 = new Uint8Array(150000).map((_, i) => (i * 17 + 3) & 0xff);
const HD2 = new Uint8Array(4321).map((_, i) => (i * 5 + 1) & 0xff);
const hex = (bytes) => zipCrc32(bytes).toString(16).padStart(8, "0");
const deliveryBase = `/api/admin/galleries/${deliverySlug}/delivery`;

const peerDeliveryPut = await peerAdmin("PUT", `${deliveryBase}/files?name=a.jpg&crc=${hex(HD1)}`, HD1, true);
check("un autre compte ne peut pas déposer de fichier à livrer (404)", peerDeliveryPut.status === 404);
const noCrc = await admin("PUT", `${deliveryBase}/files?name=a.jpg`, HD1, true);
const badExt = await admin("PUT", `${deliveryBase}/files?name=script.exe&crc=${hex(HD1)}`, HD1, true);
check("un fichier sans empreinte CRC ou d'un format non photo est refusé (400)", noCrc.status === 400 && badExt.status === 400);
const openEmpty = await admin("POST", deliveryBase, { open: true });
check("impossible d'ouvrir une livraison vide (409)", openEmpty.status === 409);

const put1 = await admin("PUT", `${deliveryBase}/files?name=${encodeURIComponent("IMG_0001.jpg")}&crc=${hex(HD1)}`, HD1, true);
const put2 = await admin("PUT", `${deliveryBase}/files?name=${encodeURIComponent("../Séance été.jpg")}&crc=${hex(HD2)}`, HD2, true);
const file1 = (await put1.json()).file;
const file2 = (await put2.json()).file;
check("le photographe dépose les fichiers définitifs (nom nettoyé, taille relue dans R2)",
      put1.status === 201 && put2.status === 201 && file1.size === HD1.length && file2.name === "Séance été.jpg", JSON.stringify(file2));
const deliveryAdmin = await (await admin("GET", deliveryBase)).json();
const deliveryInDetail = (await (await admin("GET", `/api/admin/galleries/${deliverySlug}`)).json()).gallery?.delivery;
check("la fiche galerie liste les fichiers à livrer et leur poids total, livraison encore fermée",
      deliveryAdmin.files.length === 2 && deliveryAdmin.totalBytes === HD1.length + HD2.length && deliveryAdmin.open === false &&
      deliveryInDetail?.files?.length === 2);

const closedSession = await deliveryLogin();
const closedLink = await fetch(`${BASE}/api/gallery/${deliverySlug}/delivery/link`, {
  method: "POST", headers: { authorization: `Bearer ${closedSession.token}`, "content-type": "application/json" }, body: "{}",
});
check("tant que la livraison est fermée, le client n'en sait rien et ne peut rien télécharger",
      closedSession.gallery?.delivery === null && closedLink.status === 404);

const opened = await (await admin("POST", deliveryBase, { open: true, notify: true })).json();
check("ouvrir la livraison prévient le client par e-mail", opened.open === true && opened.notified === true, JSON.stringify(opened));
const openSession = await deliveryLogin();
check("le client voit la livraison à la connexion : fichiers et poids total",
      openSession.gallery?.delivery?.files?.length === 2 && openSession.gallery.delivery.totalBytes === HD1.length + HD2.length);

const linkNoAuth = await fetch(`${BASE}/api/gallery/${deliverySlug}/delivery/link`, { method: "POST", body: "{}" });
check("un lien de téléchargement exige la session du client (401)", linkNoAuth.status === 401);
const clientBearer = { authorization: `Bearer ${openSession.token}`, "content-type": "application/json" };
const zipLink = await (await fetch(`${BASE}/api/gallery/${deliverySlug}/delivery/link`, { method: "POST", headers: clientBearer, body: "{}" })).json();
const zipResponse = await fetch(zipLink.url);
const zipBytes = new Uint8Array(await zipResponse.arrayBuffer());
let zipCheck = "";
try {
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const zipPath = `${mkdtempSync(`${tmpdir()}/livraison-`)}/photos.zip`;
  writeFileSync(zipPath, zipBytes);
  zipCheck = execFileSync("python3", ["-c", "import zipfile,sys,json;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps([z.testzip(),z.namelist(),[i.file_size for i in z.infolist()]]))", zipPath]).toString().trim();
} catch (err) {
  zipCheck = String(err.message);
}
check("« Tout télécharger » donne un ZIP valide (CRC vérifiés), à la taille annoncée, nommé d'après la galerie",
      zipResponse.status === 200 && Number(zipResponse.headers.get("content-length")) === zipBytes.length &&
      (() => { try { const z = JSON.parse(zipCheck); return z[0] === null && z[1].join("|") === "IMG_0001.jpg|Séance été.jpg" && z[2].join(",") === `${HD1.length},${HD2.length}`; } catch { return false; } })() &&
      (zipResponse.headers.get("content-disposition") || "").includes("filename*=UTF-8''S%C3%A9ance%20livr%C3%A9e.zip"),
      `${zipResponse.status} ${zipCheck} ${zipResponse.headers.get("content-disposition")}`);

const oneLink = await (await fetch(`${BASE}/api/gallery/${deliverySlug}/delivery/link`, { method: "POST", headers: clientBearer, body: JSON.stringify({ fileId: file2.id }) })).json();
const oneResponse = await fetch(oneLink.url);
const oneBytes = new Uint8Array(await oneResponse.arrayBuffer());
check("une photo se télécharge seule, à l'identique, en pièce jointe",
      oneResponse.status === 200 && oneBytes.length === HD2.length && oneBytes.every((b, i) => b === HD2[i]) &&
      (oneResponse.headers.get("content-disposition") || "").startsWith("attachment;"));
const oneUrl = new URL(oneLink.url);
const deliverySwapped = await fetch(`${BASE}/api/gallery/${deliverySlug}/delivery/file/${file1.id}?t=${encodeURIComponent(oneUrl.searchParams.get("t"))}`);
const deliveryTampered = await fetch(`${BASE}/api/gallery/${deliverySlug}/delivery/zip?t=${encodeURIComponent(oneUrl.searchParams.get("t") + "x")}`);
const linkAsSession = await fetch(`${BASE}/api/gallery/${deliverySlug}/tile/${"x"}/0/0/0`, { headers: { authorization: `Bearer ${oneUrl.searchParams.get("t")}` } });
check("un lien ne vaut que pour son fichier, ne se falsifie pas et ne vaut jamais session",
      deliverySwapped.status === 403 && deliveryTampered.status === 403 && linkAsSession.status === 401,
      `${deliverySwapped.status} ${deliveryTampered.status} ${linkAsSession.status}`);
const otherGalleryUse = await fetch(`${BASE}/api/gallery/${SLUG}/delivery/zip?t=${encodeURIComponent(new URL(zipLink.url).searchParams.get("t"))}`);
check("un lien d'une galerie ne sert pas sur une autre", [403, 404].includes(otherGalleryUse.status));

const deliveryLog = await (await admin("GET", `/api/admin/galleries/${deliverySlug}/log`)).json();
check("les téléchargements apparaissent dans le journal d'accès",
      (deliveryLog.log || []).filter((e) => e.event === "download").length >= 2, JSON.stringify((deliveryLog.log || []).map((e) => e.event)));

await admin("POST", deliveryBase, { open: false });
const afterClose = await fetch(zipLink.url);
check("fermer la livraison coupe aussitôt les liens déjà distribués", afterClose.status === 404);
const deliveryRemoved = await admin("DELETE", `${deliveryBase}/files/${file1.id}`);
const peerRemove = await peerAdmin("DELETE", `${deliveryBase}/files/${file2.id}`);
check("le photographe retire un fichier (un autre compte ne peut pas)",
      deliveryRemoved.ok && peerRemove.status === 404 && (await (await admin("GET", deliveryBase)).json()).files.length === 1);
await admin("DELETE", `/api/admin/galleries/${deliverySlug}`);

/* ---------- Abonnements : formule gratuite, limites, formules payées ---------- */

const freeEmail = `gratuit-${RUN}@test.invalid`;
const freeSignup = (await signup(freeEmail, "mot-de-passe-gratuit-1234")).data;
const free = adminClient(freeSignup.token);
const freeSub = await (await free("GET", "/api/admin/subscription")).json();
check("un nouveau compte démarre en formule Découverte (gratuite), avec les 3 formules proposées",
      freeSub.plan?.key === "free" && freeSub.plan.maxActiveGalleries === 3 && freeSub.usage?.activeGalleries === 0 &&
      freeSub.plans?.map((p) => p.key).join(",") === "free,essentiel,pro" && freeSub.canManage === false,
      JSON.stringify(freeSub.plan));
for (let i = 1; i <= 3; i++) {
  await free("POST", "/api/admin/galleries", { slug: `${SLUG}-gratuit-${i}`, password: "mot-de-passe-solide", title: `Gratuite ${i}` });
}
const fourth = await free("POST", "/api/admin/galleries", { slug: `${SLUG}-gratuit-4`, password: "mot-de-passe-solide", title: "Gratuite 4" });
const fourthBody = await fourth.json();
check("la 4e galerie active est refusée en formule gratuite, avec la marche à suivre (402)",
      fourth.status === 402 && /Abonnement/.test(fourthBody.error || ""), fourthBody.error);
const expiredOk = await (async () => {
  await free("DELETE", `/api/admin/galleries/${SLUG}-gratuit-3`);
  return (await free("POST", "/api/admin/galleries", { slug: `${SLUG}-gratuit-4`, password: "mot-de-passe-solide", title: "Gratuite 4" })).status;
})();
check("supprimer une galerie libère une place", expiredOk === 201);
const freeShop = await free("POST", `/api/admin/galleries/${SLUG}-gratuit-1/shop`, { enabled: true });
const freeSubdomain = await free("POST", "/api/admin/account/subdomain", { subdomain: `gratuit-${RUN}`.slice(0, 30) });
check("la boutique et l'adresse à son nom sont réservées aux formules qui les incluent (402)",
      freeShop.status === 402 && freeSubdomain.status === 402 && /Essentiel/.test((await freeShop.json()).error || ""));
const badPlan = await free("POST", "/api/admin/subscription/checkout", { plan: "free", returnUrl: "http://localhost/" });
const noStripe = await free("POST", "/api/admin/subscription/checkout", { plan: "pro", returnUrl: "http://localhost/" });
const noPortal = await free("POST", "/api/admin/subscription/portal", { returnUrl: "http://localhost/" });
check("souscrire : formule inconnue refusée, Stripe non configuré signalé clairement, rien à gérer sans abonnement",
      badPlan.status === 400 && noStripe.status === 503 && noPortal.status === 409, `${badPlan.status} ${noStripe.status} ${noPortal.status}`);

await setPlan(freeEmail, "essentiel", "active");
const essentielSub = await (await free("GET", "/api/admin/subscription")).json();
const essentielShop = await free("POST", `/api/admin/galleries/${SLUG}-gratuit-1/shop`, { enabled: true });
const essentielSubdomain = await free("POST", "/api/admin/account/subdomain", { subdomain: `gratuit-${RUN}`.slice(0, 30) });
const essentielFifth = await free("POST", "/api/admin/galleries", { slug: `${SLUG}-gratuit-5`, password: "mot-de-passe-solide", title: "Gratuite 5" });
check("abonnement Essentiel actif : plus de galeries et la boutique, mais pas encore l'adresse à son nom",
      essentielSub.plan?.key === "essentiel" && essentielShop.ok && essentielFifth.status === 201 && essentielSubdomain.status === 402);
await setPlan(freeEmail, "essentiel", "past_due");
check("pendant que Stripe retente un prélèvement (past_due), la formule reste acquise",
      (await (await free("GET", "/api/admin/subscription")).json()).plan?.key === "essentiel");
await setPlan(freeEmail, "free", "canceled");
const afterCancel = await (await free("GET", "/api/admin/subscription")).json();
const afterCancelSixth = await free("POST", "/api/admin/galleries", { slug: `${SLUG}-gratuit-6`, password: "mot-de-passe-solide", title: "Gratuite 6" });
check("abonnement résilié : retour à la formule gratuite (plus de nouvelle galerie au-delà de 3)",
      afterCancel.plan?.key === "free" && afterCancelSixth.status === 402);
const ownerSub = await (await ownerClient("GET", "/api/admin/subscription")).json();
check("le compte propriétaire a toutes les fonctionnalités, sans abonnement", ownerSub.owner === true && ownerSub.plan?.key === "pro");
for (const n of [1, 2, 4, 5]) await free("DELETE", `/api/admin/galleries/${SLUG}-gratuit-${n}`);

/* ---------- Droits RGPD : consentement, export, suppression du compte ---------- */

const rgpdEmail = `rgpd-${RUN}@test.invalid`;
const rgpdPassword = "mot-de-passe-rgpd-1234";
const rgpdSignup = await (await fetch(`${BASE}/api/auth/signup`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: rgpdEmail, password: rgpdPassword, studioName: "Studio RGPD", acceptTerms: true }),
})).json();
const rgpd = adminClient(rgpdSignup.token);
const rgpdSlug = `${SLUG}-rgpd`;
await rgpd("POST", "/api/admin/galleries", { slug: rgpdSlug, password: "mot-de-passe-solide", title: "Séance RGPD", clientName: "Famille RGPD", clientEmail: "famille-rgpd@test.invalid" });
const rgpdPhotoId = `pho_Rgpd${RUN}`;
await rgpd("POST", `/api/admin/galleries/${rgpdSlug}/photos`, {
  id: rgpdPhotoId, position: 0, width: 800, height: 600, cols: 2, rows: 2, previewWidth: 400, previewHeight: 300, forensicId: "987654321",
});
await rgpd("PUT", `/api/admin/tiles/${rgpdPhotoId}/0/0/0`, new Uint8Array([1, 2, 3]), true);

const exportResponse = await rgpd("GET", "/api/admin/account/export");
const exportData = await exportResponse.json();
check("l'export contient le compte, ses galeries, photos et clients, et l'acceptation des conditions horodatée",
      exportResponse.ok && (exportResponse.headers.get("content-disposition") || "").includes("holypixx-mes-donnees-") &&
      exportData.account?.email === rgpdEmail && typeof exportData.account.terms_accepted_at === "number" &&
      exportData.account.terms_version === "2026-10-05" &&
      exportData.galleries?.[0]?.client_email === "famille-rgpd@test.invalid" && exportData.galleries[0].photos?.length === 1,
      JSON.stringify({ terms: exportData.account?.terms_accepted_at, g: exportData.galleries?.length }));
check("l'export ne contient jamais de secret (empreintes de mot de passe, clé Prodigi chiffrée)",
      !JSON.stringify(exportData).includes("password_hash") && !JSON.stringify(exportData).includes("password_salt") &&
      !("prodigi_api_key_enc" in exportData.account));
check("sans acceptation explicite, rien n'est horodaté (le compte de test principal n'a pas coché)",
      (await (await admin("GET", "/api/admin/account/export")).json()).account?.terms_accepted_at === null);

const deleteNoConfirm = await rgpd("POST", "/api/admin/account/delete", { password: rgpdPassword });
const deleteBadPassword = await rgpd("POST", "/api/admin/account/delete", { password: "faux", confirm: "SUPPRIMER" });
check("supprimer le compte exige la confirmation et le bon mot de passe", deleteNoConfirm.status === 400 && deleteBadPassword.status === 400);
const deleteOk = await (await rgpd("POST", "/api/admin/account/delete", { password: rgpdPassword, confirm: "SUPPRIMER" })).json();
const loginAfterDelete = await fetch(`${BASE}/api/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: rgpdEmail, password: rgpdPassword }),
});
const galleryAfterDelete = await fetch(`${BASE}/api/gallery/${rgpdSlug}/login`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "mot-de-passe-solide" }),
});
// Les identifiants de photo sont uniques sur toute la plateforme : pouvoir
// réutiliser celui-ci prouve que la photo a bien été effacée.
await admin("POST", "/api/admin/galleries", { slug: `${SLUG}-apres-rgpd`, password: "mot-de-passe-solide", title: "Après RGPD" });
const reusedPhotoId = await admin("POST", `/api/admin/galleries/${SLUG}-apres-rgpd/photos`, {
  id: rgpdPhotoId, position: 9, width: 800, height: 600, cols: 2, rows: 2, previewWidth: 400, previewHeight: 300, forensicId: "987654322",
});
check("la suppression efface le compte, ses galeries, photos et accès client",
      deleteOk.ok === true && deleteOk.deletedGalleries === 1 && loginAfterDelete.status === 401 && galleryAfterDelete.status !== 200 &&
      reusedPhotoId.status === 201, `${loginAfterDelete.status} ${galleryAfterDelete.status} ${reusedPhotoId.status}`);
await admin("DELETE", `/api/admin/galleries/${SLUG}-apres-rgpd`);

/* ---------- « Valider ma sélection » ---------- */

const validateSlug = `${SLUG}-validation`;
const validateCreated = await (await admin("POST", "/api/admin/galleries", {
  slug: validateSlug, password: "mot-de-passe-solide", title: "Séance à valider", clientName: "Famille Valide",
  expiresAt: Math.floor(Date.now() / 1000) + 10 * 86400,
})).json();
const validateSession = await (await fetch(`${BASE}/api/gallery/${validateSlug}/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "mot-de-passe-solide" }),
})).json();
check("une galerie neuve n'a pas de sélection validée",
      validateSession.gallery?.selectionDoneAt === null, JSON.stringify(validateSession.gallery?.selectionDoneAt));

const validateNoAuth = await fetch(`${BASE}/api/gallery/${validateSlug}/validate`, { method: "POST" });
check("valider sa sélection sans jeton est refusé", validateNoAuth.status === 401);

const validateBearer = { authorization: `Bearer ${validateSession.token}` };
const validateResponse = await fetch(`${BASE}/api/gallery/${validateSlug}/validate`, {
  method: "POST", headers: { ...validateBearer, "content-type": "application/json" }, body: "{}",
});
const validateBody = await validateResponse.json();
check("le client peut valider sa sélection (horodatée, photographe prévenu)",
      validateResponse.ok && Number.isInteger(validateBody.selectionDoneAt) && validateBody.emailed === true, JSON.stringify(validateBody));

const validateAgain = await (await fetch(`${BASE}/api/gallery/${validateSlug}/validate`, {
  method: "POST", headers: { ...validateBearer, "content-type": "application/json" }, body: "{}",
})).json();
check("revalider dans l'heure met l'horodatage à jour mais ne renvoie pas d'e-mail",
      Number.isInteger(validateAgain.selectionDoneAt) && validateAgain.emailed === false, JSON.stringify(validateAgain));

const validateDetail = await (await admin("GET", `/api/admin/galleries/${validateSlug}`)).json();
check("la validation apparaît sur la fiche de la galerie côté administration",
      validateDetail.gallery?.selection_done_at === validateAgain.selectionDoneAt, JSON.stringify(validateDetail.gallery?.selection_done_at));
const validateList = await (await admin("GET", "/api/admin/galleries")).json();
check("… et dans la liste des galeries",
      validateList.galleries.find((g) => g.slug === validateSlug)?.selection_done_at === validateAgain.selectionDoneAt);
const validateLog = await (await admin("GET", `/api/admin/galleries/${validateSlug}/log`)).json();
check("chaque validation est consignée au journal", validateLog.log.filter((e) => e.event === "validate").length === 2);
const validateRelogin = await (await fetch(`${BASE}/api/gallery/${validateSlug}/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "mot-de-passe-solide" }),
})).json();
check("le client retrouve sa validation à la reconnexion",
      validateRelogin.gallery?.selectionDoneAt === validateAgain.selectionDoneAt);

/* ---------- Relances automatiques ---------- */

const meBeforeReminders = await (await admin("GET", "/api/auth/me")).json();
check("les relances automatiques sont actives par défaut sur un compte", meBeforeReminders.photographer?.remindersEnabled === true);

const DAY = 86400;
const nowSec = Math.floor(Date.now() / 1000);
async function reminderGallery(suffix, extra) {
  const slug = `${SLUG}-rel-${suffix}`;
  const response = await admin("POST", "/api/admin/galleries", { slug, password: "mot-de-passe-solide", title: `Relance ${suffix}`, ...extra });
  check(`galerie de relance « ${suffix} » créée`, response.status === 201);
  return slug;
}
const relJ5 = await reminderGallery("j5", { clientEmail: "client-j5@example.com", expiresAt: nowSec + 5 * DAY });
const relJ1 = await reminderGallery("j1", { clientEmail: "client-j1@example.com", expiresAt: nowSec + 1 * DAY });
const relNoEmail = await reminderGallery("sans-email", { expiresAt: nowSec + 5 * DAY });
const relNoExpiry = await reminderGallery("sans-expiration", { clientEmail: "client-x@example.com" });
const relValidated = await reminderGallery("validee", { clientEmail: "client-v@example.com", expiresAt: nowSec + 1 * DAY });
const relValidatedSession = await (await fetch(`${BASE}/api/gallery/${relValidated}/login`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "mot-de-passe-solide" }),
})).json();
await fetch(`${BASE}/api/gallery/${relValidated}/validate`, {
  method: "POST", headers: { authorization: `Bearer ${relValidatedSession.token}`, "content-type": "application/json" }, body: "{}",
});

const remindersForbidden = await admin("POST", "/api/owner/reminders/run");
check("un compte ordinaire ne peut pas lancer la passe de relances (403)", remindersForbidden.status === 403);

const firstPass = await (await ownerClient("POST", "/api/owner/reminders/run")).json();
const sentFor = (slug) => firstPass.sent.filter((r) => r.slug === slug).map((r) => r.kind).sort();
check("à J-5, le client reçoit la première relance (et seulement elle)",
      JSON.stringify(sentFor(relJ5)) === '["client_j7"]' && firstPass.sent.find((r) => r.slug === relJ5)?.to === "client-j5@example.com",
      JSON.stringify(sentFor(relJ5)));
check("à J-1, le client reçoit la seconde relance et le photographe la sienne",
      JSON.stringify(sentFor(relJ1)) === '["client_j2","photographer_j2"]' &&
      firstPass.sent.find((r) => r.slug === relJ1 && r.kind === "photographer_j2")?.to === EMAIL,
      JSON.stringify(sentFor(relJ1)));
check("sans e-mail client à J-5, rien ne part", sentFor(relNoEmail).length === 0);
check("sans date d'expiration, rien ne part jamais", sentFor(relNoExpiry).length === 0);
check("une sélection déjà validée n'est plus relancée", sentFor(relValidated).length === 0);

const secondPass = await (await ownerClient("POST", "/api/owner/reminders/run")).json();
check("relancer la passe ne renvoie aucune relance déjà envoyée", secondPass.sent.length === 0, JSON.stringify(secondPass.sent));

const remindersOff = await admin("POST", "/api/admin/account/reminders", { enabled: false });
const meAfterReminders = await (await admin("GET", "/api/auth/me")).json();
check("le photographe peut désactiver les relances automatiques",
      remindersOff.ok && meAfterReminders.photographer?.remindersEnabled === false);
const relDisabled = await reminderGallery("desactivee", { clientEmail: "client-d@example.com", expiresAt: nowSec + 1 * DAY });
const thirdPass = await (await ownerClient("POST", "/api/owner/reminders/run")).json();
check("relances désactivées : plus rien ne part pour ce compte, ni au client ni au photographe",
      thirdPass.sent.filter((r) => r.slug === relDisabled).length === 0, JSON.stringify(thirdPass.sent));
await admin("POST", "/api/admin/account/reminders", { enabled: true });

/* ---------- Boutique de tirages (Prodigi) ---------- */
// Le Worker local parle à un faux laboratoire (PRODIGI_API_BASE dans
// worker/.dev.vars → tests/lib/fakeProdigi.mjs) : même format de requêtes
// et de réponses que Prodigi, rien n'est jamais imprimé. Stripe n'étant pas
// configuré en local, la commande payée est posée directement en base (comme
// le ferait le webhook), puis envoyée au labo par la route de relance.

const { startFakeProdigi } = await import("./lib/fakeProdigi.mjs");
const { execFileSync } = await import("node:child_process");
const { fileURLToPath: toPath } = await import("node:url");
const { dirname: dirOf, join: joinPath } = await import("node:path");
const WORKER_DIR = joinPath(dirOf(toPath(import.meta.url)), "..");
// Écriture directe dans la base locale. Juste après, le Worker local coupe
// parfois les connexions déjà ouvertes : on attend qu'il réponde à nouveau.
const d1 = async (sql) => {
  execFileSync("npx", ["wrangler", "d1", "execute", "galerie-protegee", "--local", "--command", sql], {
    cwd: WORKER_DIR, stdio: "pipe",
  });
  for (let i = 0; i < 20; i++) {
    try {
      if ((await fetch(`${BASE}/health`, { headers: { connection: "close" } })).ok) return;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 500));
  }
};
const lab = await startFakeProdigi();

const shopBefore = await (await admin("GET", "/api/admin/shop")).json();
check("sans réglage, la boutique n'a ni clé Prodigi ni format, mais propose des formats suggérés",
      shopBefore.settings?.connected === false && shopBefore.products?.length === 0 && shopBefore.suggested?.length === 5,
      JSON.stringify(shopBefore.settings));

const badShipping = await admin("POST", "/api/admin/shop/settings", { environment: "sandbox", shippingCents: -1 });
check("des frais de port négatifs sont refusés", badShipping.status === 400);
const shopSaved = await admin("POST", "/api/admin/shop/settings", { apiKey: "test-key-abcd1234", environment: "sandbox", shippingCents: 590 });
const shopAfter = await (await admin("GET", "/api/admin/shop")).json();
check("la clé Prodigi est enregistrée et seule sa fin est jamais renvoyée",
      shopSaved.ok && shopAfter.settings.connected === true && shopAfter.settings.keyHint === "…1234" &&
      shopAfter.settings.shippingCents === 590 && !JSON.stringify(shopAfter).includes("test-key-abcd1234"),
      JSON.stringify(shopAfter.settings));
const peerShop = await (await peerAdmin("GET", "/api/admin/shop")).json();
check("les réglages de boutique d'un compte n'apparaissent jamais chez un autre", peerShop.settings?.connected === false);

const suggestedAdded = await (await admin("POST", "/api/admin/shop/products/suggested")).json();
const suggestedAgain = await (await admin("POST", "/api/admin/shop/products/suggested")).json();
check("les formats suggérés s'ajoutent en un clic, sans doublon au second clic",
      suggestedAdded.added === 5 && suggestedAgain.added === 0, JSON.stringify([suggestedAdded, suggestedAgain]));

const badSku = await admin("POST", "/api/admin/shop/products", { label: "X", sku: "x", priceCents: 500 });
const badAttrs = await admin("POST", "/api/admin/shop/products", { label: "X", sku: "GLOBAL-PHO-5x7", priceCents: 500, attributes: [1] });
const badProductPrice = await admin("POST", "/api/admin/shop/products", { label: "X", sku: "GLOBAL-PHO-5x7", priceCents: 0 });
check("un format avec SKU, options ou prix invalides est refusé",
      badSku.status === 400 && badAttrs.status === 400 && badProductPrice.status === 400);
const invalidProduct = await admin("POST", "/api/admin/shop/products", { label: "Format inconnu du labo", sku: "GLOBAL-INVALID-1", priceCents: 500 });
const invalidProductId = (await invalidProduct.json()).id;
check("un format personnalisé peut être ajouté", invalidProduct.status === 201 && Boolean(invalidProductId));

const shopProducts = (await (await admin("GET", "/api/admin/shop")).json()).products;
const tirage = shopProducts.find((p) => p.sku === "GLOBAL-PHO-4x6");
const peerUpdate = await peerAdmin("PUT", `/api/admin/shop/products/${tirage.id}`, { priceCents: 1 });
const peerDelete = await peerAdmin("DELETE", `/api/admin/shop/products/${tirage.id}`);
check("un autre compte ne peut ni modifier ni supprimer un format (404)", peerUpdate.status === 404 && peerDelete.status === 404);
const priceUpdate = await admin("PUT", `/api/admin/shop/products/${tirage.id}`, { priceCents: 450 });
check("le photographe peut changer le prix d'un format", priceUpdate.ok &&
      (await (await admin("GET", "/api/admin/shop")).json()).products.find((p) => p.id === tirage.id).priceCents === 450);

const quote = await (await admin("POST", "/api/admin/shop/quote", { countryCode: "FR" })).json();
const tirageQuote = quote.quotes?.find((q) => q.productId === tirage.id);
const invalidQuote = quote.quotes?.find((q) => q.productId === invalidProductId);
check("le devis Prodigi donne le coût réel (produit + port) et la marge de chaque format (prix − coût du produit − frais de paiement)",
      quote.countryCode === "FR" && tirageQuote?.totalCostCents === 1745 && tirageQuote?.feeCents === 9 + 30 &&
      tirageQuote?.marginCents === 450 - 1250 - (9 + 30) &&
      lab.quotes.at(-1)?.destinationCountryCode === "FR",
      JSON.stringify(tirageQuote));
check("un format refusé par le labo est signalé avec la raison donnée par Prodigi",
      /Unknown SKU/.test(invalidQuote?.error || ""), JSON.stringify(invalidQuote));

const shopAfterQuote = await (await admin("GET", "/api/admin/shop")).json();
check("le devis mémorise le coût du labo sur chaque produit (marge affichée sans nouveau devis)",
      shopAfterQuote.products.find((p) => p.id === tirage.id)?.costCents === 1250 &&
      shopAfterQuote.products.find((p) => p.id === tirage.id)?.shipCostCents === 495);

// Ajout en menus déroulants (catalogue intégré).
check("l'admin reçoit le catalogue en menus (catégories, produits, formats en cm, options)",
      shopAfterQuote.catalogue?.length === 7 && shopAfterQuote.catalogue[2].products[0].sizes.some((x) => x.label === "30 × 40 cm"),
      JSON.stringify(shopAfterQuote.catalogue?.map((c) => c.label)));
check("les produits sont rangés par catégorie",
      shopAfterQuote.products.find((p) => p.id === tirage.id)?.category === "Tirages photo" &&
      shopAfterQuote.products.find((p) => p.sku === "GLOBAL-CAN-12x16")?.category === "Toiles");
const pickQuote = await (await admin("POST", "/api/admin/shop/quote-item", { product: "canvas-rolled", size: "16x20", countryCode: "BE" })).json();
check("choisir un produit dans les menus donne aussitôt son coût réel chez le labo",
      pickQuote.available === true && pickQuote.itemsCents === 1250 && pickQuote.shippingCents === 495 &&
      pickQuote.label === "Toile roulée (sans châssis) 40 × 50 cm" && lab.quotes.at(-1)?.items?.[0]?.sku === "GLOBAL-CAN-ROL-SC-16x20",
      JSON.stringify(pickQuote));
const pickBad = await admin("POST", "/api/admin/shop/quote-item", { product: "canvas-rolled", size: "99x99" });
check("un format hors catalogue est refusé avant même d'interroger le labo (400)", pickBad.status === 400);
const pickNoKey = await peerAdmin("POST", "/api/admin/shop/quote-item", { product: "canvas-rolled", size: "16x20" });
check("sans clé Prodigi, le devis demande d'abord d'enregistrer la clé (409)", pickNoKey.status === 409);
const lookupsBefore = lab.productLookups.length;
const avail = await (await admin("POST", "/api/admin/shop/availability", { product: "frame-classic-mount", countryCode: "BE" })).json();
check("les menus ne gardent que les formats que le labo fabrique et livre, avec les couleurs proposées",
      avail.sizes?.["16x20"]?.available === true && avail.sizes["16x20"].allowed?.join(",") === "black,white" &&
      avail.sizes["12x12"]?.available === false,
      JSON.stringify({ a: avail.sizes?.["16x20"], b: avail.sizes?.["12x12"] }));
// Le Worker garde les fiches en mémoire quelques heures : au premier passage
// (Worker tout juste démarré) les 13 formats sont demandés au labo, ensuite
// plus aucun — un autre pays ne redemande rien non plus.
const lookupsAfterFirst = lab.productLookups.length;
await admin("POST", "/api/admin/shop/availability", { product: "frame-classic-mount", countryCode: "FR" });
check("la fiche d'un produit n'est demandée qu'une fois au labo, même pour un autre pays",
      [0, 13].includes(lookupsAfterFirst - lookupsBefore) && lab.productLookups.length === lookupsAfterFirst,
      `${lookupsAfterFirst - lookupsBefore} puis ${lab.productLookups.length - lookupsAfterFirst}`);
const availBad = await admin("POST", "/api/admin/shop/availability", { product: "inconnu" });
const availNoKey = await peerAdmin("POST", "/api/admin/shop/availability", { product: "gift-mug" });
check("vérifier les formats : produit inconnu refusé (400), clé Prodigi exigée (409)", availBad.status === 400 && availNoKey.status === 409);
const pickAdd = await admin("POST", "/api/admin/shop/products", { product: "canvas-rolled", size: "16x20", priceCents: 2550, costCents: 1250, shipCostCents: 495, sku: "GLOBAL-PIRATE" });
const shopWithPick = await (await admin("GET", "/api/admin/shop")).json();
const picked = shopWithPick.products.find((p) => p.label === "Toile roulée (sans châssis) 40 × 50 cm");
check("ajouter depuis les menus crée le produit avec la référence déduite par le serveur, jamais celle envoyée par la page",
      pickAdd.status === 201 && picked?.sku === "GLOBAL-CAN-ROL-SC-16x20" && picked.fromCatalogue === true &&
      picked.costCents === 1250 && picked.priceCents === 2550 && picked.category === "Toiles",
      JSON.stringify(picked));
const pickAddBad = await admin("POST", "/api/admin/shop/products", { product: "photo-ctype", size: "4x6", option: "mat", priceCents: 500 });
check("une finition hors catalogue est refusée à l'ajout", pickAddBad.status === 400);
await admin("DELETE", `/api/admin/shop/products/${picked.id}`);

// Galerie et photos de la boutique.
const shopSlug = `${SLUG}-boutique`;
await admin("POST", "/api/admin/galleries", { slug: shopSlug, password: "mot-de-passe-solide", title: "Séance boutique", clientName: "Famille Boutique" });
const shopPhoto = `pho_ShopA${RUN}`;
const shopPhoto2 = `pho_ShopB${RUN}`;
for (const [id, position] of [[shopPhoto, 0], [shopPhoto2, 1]]) {
  await admin("POST", `/api/admin/galleries/${shopSlug}/photos`, {
    id, position, width: 1600, height: 1067, cols: 4, rows: 3, previewWidth: 500, previewHeight: 334, forensicId: "1",
  });
}
const shopLogin = async () => (await fetch(`${BASE}/api/gallery/${shopSlug}/login`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "mot-de-passe-solide" }),
})).json();

let shopSession = await shopLogin();
check("tant que la boutique n'est pas ouverte sur la galerie, le client n'en voit rien",
      shopSession.gallery?.shop === null && shopSession.photos?.every((p) => p.printable === false));

const peerOpen = await peerAdmin("POST", `/api/admin/galleries/${shopSlug}/shop`, { enabled: true });
check("un autre compte ne peut pas ouvrir la boutique d'une galerie (404)", peerOpen.status === 404);
const openShop = await admin("POST", `/api/admin/galleries/${shopSlug}/shop`, { enabled: true });
check("le photographe ouvre la boutique sur la galerie", openShop.ok);

shopSession = await shopLogin();
check("sans paiement en ligne Stripe actif, la boutique reste fermée côté client", shopSession.gallery?.shop === null);

const meShop = await (await admin("GET", "/api/auth/me")).json();
await d1(`UPDATE photographers SET stripe_account_id = 'acct_test_boutique', stripe_charges_enabled = 1 WHERE id = '${meShop.photographer.id}'`);
shopSession = await shopLogin();
check("clé Prodigi + Stripe actif + formats : le client voit les formats actifs, prix et frais de port",
      shopSession.gallery?.shop?.products?.length === 6 && shopSession.gallery.shop.shippingCents === 590 &&
      shopSession.gallery.shop.products.find((p) => p.id === tirage.id)?.priceCents === 450 &&
      !JSON.stringify(shopSession.gallery.shop).includes("GLOBAL-"),
      JSON.stringify(shopSession.gallery?.shop?.products?.[0]));
check("une photo sans fichier d'impression n'est pas proposée en tirage", shopSession.photos.every((p) => p.printable === false));
const looks = Object.fromEntries(shopSession.gallery.shop.products.map((p) => [p.label, p.look]));
const frameLook = shopSession.gallery.shop.products.find((p) => p.look?.kind === "frame")?.look;
check("chaque format arrive avec de quoi dessiner son aperçu (forme, proportions, couleur du cadre)",
      shopSession.gallery.shop.products.every((p) => p.look && typeof p.look.kind === "string") &&
      frameLook?.mat === true && frameLook?.color === "black" && frameLook?.ratio?.join("x") === "16x20" &&
      shopSession.gallery.shop.products.some((p) => p.look.kind === "canvas"),
      JSON.stringify(looks));

const ORIGINAL = new Uint8Array(50000);
for (let i = 0; i < ORIGINAL.length; i++) ORIGINAL[i] = (i * 7 + 3) & 0xff;
const peerOriginal = await peerAdmin("PUT", `/api/admin/photos/${shopPhoto}/original`, ORIGINAL, true);
check("un autre compte ne peut pas déposer de fichier d'impression (404)", peerOriginal.status === 404);
const putOriginal = await admin("PUT", `/api/admin/photos/${shopPhoto}/original`, ORIGINAL, true);
check("le fichier d'impression d'une photo est enregistré", putOriginal.ok);
shopSession = await shopLogin();
check("seule la photo qui a un fichier d'impression devient commandable",
      shopSession.photos.find((p) => p.id === shopPhoto)?.printable === true && shopSession.photos.find((p) => p.id === shopPhoto2)?.printable === false);
const tileRouteOriginal = await fetch(`${BASE}/api/gallery/${shopSlug}/tile/${shopPhoto}/1/original/x`, {
  headers: { authorization: `Bearer ${shopSession.token}` },
});
check("le fichier d'impression n'est jamais atteignable par la route des tuiles du client", !tileRouteOriginal.ok);

const shopBearer = { authorization: `Bearer ${shopSession.token}`, "content-type": "application/json" };
const RECIPIENT = { name: "Julie Peters", email: "julie@example.com", line1: "Rue de la Paix 1", postalCode: "1000", city: "Bruxelles", countryCode: "BE" };
const orderBody = (extra) => JSON.stringify({
  lines: [{ photoId: shopPhoto, productId: tirage.id, copies: 2 }],
  recipient: RECIPIENT,
  successUrl: "http://localhost:8000/galerie.html?g=x&tirages=succes",
  cancelUrl: "http://localhost:8000/galerie.html?g=x&tirages=annule",
  ...extra,
});
const orderNoAuth = await fetch(`${BASE}/api/gallery/${shopSlug}/print-order`, { method: "POST", headers: { "content-type": "application/json" }, body: orderBody() });
check("commander sans session client est refusé", orderNoAuth.status === 401);
const orderBadAddress = await fetch(`${BASE}/api/gallery/${shopSlug}/print-order`, { method: "POST", headers: shopBearer, body: orderBody({ recipient: { ...RECIPIENT, email: "nope" } }) });
const orderEmpty = await fetch(`${BASE}/api/gallery/${shopSlug}/print-order`, { method: "POST", headers: shopBearer, body: orderBody({ lines: [] }) });
const orderNoOriginal = await fetch(`${BASE}/api/gallery/${shopSlug}/print-order`, { method: "POST", headers: shopBearer, body: orderBody({ lines: [{ photoId: shopPhoto2, productId: tirage.id, copies: 1 }] }) });
check("une commande avec adresse invalide, panier vide ou photo non disponible est refusée (400)",
      orderBadAddress.status === 400 && orderEmpty.status === 400 && orderNoOriginal.status === 400);
const orderNoStripe = await fetch(`${BASE}/api/gallery/${shopSlug}/print-order`, { method: "POST", headers: shopBearer, body: orderBody() });
const galleryNoOrder = await (await admin("GET", `/api/admin/galleries/${shopSlug}`)).json();
check("une commande valide part vers le paiement Stripe — sans Stripe configuré, refus net et rien d'enregistré",
      orderNoStripe.status === 503 && galleryNoOrder.printOrders?.length === 0, `HTTP ${orderNoStripe.status}`);

// Commande payée, posée comme le ferait le webhook Stripe.
const shopGalleryId = galleryNoOrder.gallery.id;
const nowS = Math.floor(Date.now() / 1000);

/* ---------- Campagnes de vente : promotion, panier enregistré, relances ---------- */

const promoBase = `/api/admin/galleries/${shopSlug}/promo`;
const promoBadPercent = await admin("POST", promoBase, { percent: 33, endsAt: nowS + 3 * 86400 });
const promoPast = await admin("POST", promoBase, { percent: 20, endsAt: nowS - 10 });
const promoPeer = await peerAdmin("POST", promoBase, { percent: 20, endsAt: nowS + 3 * 86400 });
check("promotion : remise hors liste ou date passée refusées (400), autre compte refusé (404)",
      promoBadPercent.status === 400 && promoPast.status === 400 && promoPeer.status === 404);
const promoSet = await (await admin("POST", promoBase, { percent: 20, endsAt: nowS + 3 * 86400 })).json();
const promoSession = await shopLogin();
const promoProducts = promoSession.gallery?.shop?.products || [];
const bigProduct = promoProducts.slice().sort((a, b) => b.listPriceCents - a.listPriceCents)[0];
const promoTirage = promoProducts.find((p) => p.id === tirage.id);
check("pendant la promotion, le client voit les prix barrés et la date de fin",
      promoSet.promo?.percent === 20 && promoSession.gallery.shop.promo?.percent === 20 &&
      bigProduct && bigProduct.priceCents === Math.round(bigProduct.listPriceCents * 0.8) && bigProduct.priceCents < bigProduct.listPriceCents,
      JSON.stringify(bigProduct));
check("un format dont la remise passerait sous le coût du labo reste à prix coûtant ou plus",
      promoTirage && promoTirage.priceCents >= Math.min(promoTirage.listPriceCents, 1250), JSON.stringify(promoTirage));

const promoSendNoEmail = await admin("POST", `${promoBase}/send`);
check("annoncer la promotion exige un e-mail client (409)", promoSendNoEmail.status === 409);
await d1(`UPDATE galleries SET client_email = 'client-boutique@test.invalid' WHERE id = '${shopGalleryId}'`);
const promoSent = await admin("POST", `${promoBase}/send`);
const promoSentAgain = await admin("POST", `${promoBase}/send`);
const promoDetail = (await (await admin("GET", `/api/admin/galleries/${shopSlug}`)).json()).gallery?.sales;
check("la promotion s'annonce au client par e-mail, une seule fois, et la fiche l'indique",
      promoSent.ok && promoSentAgain.status === 409 && typeof promoDetail?.promo?.sentAt === "number");

const cartUrl = `${BASE}/api/gallery/${shopSlug}/cart`;
const cartNoAuth = await fetch(cartUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
const cartSaved = await (await fetch(cartUrl, {
  method: "POST", headers: { authorization: `Bearer ${promoSession.token}`, "content-type": "application/json" },
  body: JSON.stringify({ lines: [{ photoId: shopPhoto, productId: bigProduct.id, copies: 2 }, { photoId: "../x", productId: "y", copies: 1 }] }),
})).json();
const cartSession = await shopLogin();
const cartDetail = (await (await admin("GET", `/api/admin/galleries/${shopSlug}`)).json()).gallery?.sales;
check("le panier du client est enregistré (lignes invalides écartées) et retrouvé à la connexion, sur n'importe quel appareil",
      cartNoAuth.status === 401 && cartSaved.items === 2 && cartSession.gallery?.shop?.savedCart?.length === 1 &&
      cartSession.gallery.shop.savedCart[0].copies === 2 && cartDetail?.cart?.items === 2);

await d1(`UPDATE print_carts SET updated_at = ${nowS - 2 * 86400} WHERE gallery_id = '${shopGalleryId}'`);
const salesRun1 = await (await ownerClient("POST", "/api/owner/reminders/run")).json();
const salesRun2 = await (await ownerClient("POST", "/api/owner/reminders/run")).json();
check("un panier laissé 24 h sans commande est rappelé au client par e-mail, une seule fois",
      salesRun1.sent?.some((r) => r.slug === shopSlug && r.kind === "cart") && !salesRun2.sent?.some((r) => r.slug === shopSlug && r.kind === "cart"),
      JSON.stringify(salesRun1.sent?.filter((r) => r.slug === shopSlug)));

await d1(`UPDATE photos SET selected = 1 WHERE id = '${shopPhoto}'; UPDATE galleries SET selection_done_at = ${nowS - 4 * 86400} WHERE id = '${shopGalleryId}'`);
const favRun1 = await (await ownerClient("POST", "/api/owner/reminders/run")).json();
const favRun2 = await (await ownerClient("POST", "/api/owner/reminders/run")).json();
check("3 jours après la sélection validée, sans commande, les coups de cœur imprimables sont relancés une fois",
      favRun1.sent?.some((r) => r.slug === shopSlug && r.kind === "print_favorites") && !favRun2.sent?.some((r) => r.slug === shopSlug && r.kind === "print_favorites"),
      JSON.stringify(favRun1.sent?.filter((r) => r.slug === shopSlug)));

await admin("POST", promoBase, { percent: 0 });
await fetch(cartUrl, { method: "POST", headers: { authorization: `Bearer ${promoSession.token}`, "content-type": "application/json" }, body: JSON.stringify({ lines: [] }) });
const afterPromo = await shopLogin();
check("arrêter la promotion rétablit les prix ; un panier vidé n'est plus enregistré",
      afterPromo.gallery.shop.promo === null && afterPromo.gallery.shop.products.find((p) => p.id === bigProduct.id)?.priceCents === bigProduct.listPriceCents &&
      afterPromo.gallery.shop.savedCart.length === 0);
const paidLines = JSON.stringify([{ photoId: shopPhoto, photoNumber: 1, productId: tirage.id, label: tirage.label, sku: "GLOBAL-PHO-4x6", attributes: {}, copies: 2, unitCents: 450, lineCents: 900 }]);
const insertPaidOrder = (orderId, paymentId, lines) => d1(
  `INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, status, kind, created_at, paid_at) ` +
  `VALUES ('${paymentId}', '${shopGalleryId}', 'cs_${paymentId}', 0, 1490, 'paid', 'print', ${nowS}, ${nowS}); ` +
  `INSERT INTO print_orders (id, gallery_id, photographer_id, payment_id, status, items, recipient, client_email, items_cents, shipping_cents, total_cents, created_at, paid_at, updated_at) ` +
  `VALUES ('${orderId}', '${shopGalleryId}', '${meShop.photographer.id}', '${paymentId}', 'paid', '${lines}', '${JSON.stringify(RECIPIENT)}', 'julie@example.com', 900, 590, 1490, ${nowS}, ${nowS}, ${nowS});`
);
const ORDER_ID = `ord_test_${RUN}`;
await insertPaidOrder(ORDER_ID, `pay_print_${RUN}`, paidLines);

const galleryWithOrder = await (await admin("GET", `/api/admin/galleries/${shopSlug}`)).json();
check("la commande payée apparaît sur la fiche de la galerie, avec ses lignes",
      galleryWithOrder.printOrders?.length === 1 && galleryWithOrder.printOrders[0].status === "paid" &&
      galleryWithOrder.printOrders[0].lines[0].copies === 2 && galleryWithOrder.payments?.some((p) => p.kind === "print"),
      JSON.stringify(galleryWithOrder.printOrders?.[0]?.status));
check("le client retrouve sa commande, avec son statut", (await shopLogin()).gallery?.printOrders?.[0]?.statusLabel === "Payée");

const peerSubmit = await peerAdmin("POST", `/api/admin/print-orders/${ORDER_ID}/submit`);
check("un autre compte ne peut pas envoyer la commande au labo (404)", peerSubmit.status === 404);
const submit = await (await admin("POST", `/api/admin/print-orders/${ORDER_ID}/submit`)).json();
const sent = lab.received.at(-1);
check("la commande payée est transmise au labo et passe « en fabrication »",
      submit.ok === true && submit.status === "in_production" && Boolean(submit.prodigiOrderId), JSON.stringify(submit));
check("le labo reçoit la clé du photographe, notre référence, le SKU, la quantité et l'adresse au format Prodigi",
      sent?.key === "test-key-abcd1234" && sent.body.merchantReference === ORDER_ID && sent.body.items[0].sku === "GLOBAL-PHO-4x6" &&
      sent.body.items[0].copies === 2 && sent.body.recipient.address.postalOrZipCode === "1000" && sent.body.recipient.address.countryCode === "BE",
      JSON.stringify(sent?.body?.recipient));
const resubmit = await admin("POST", `/api/admin/print-orders/${ORDER_ID}/submit`);
check("une commande déjà transmise ne peut pas partir une seconde fois (409)", resubmit.status === 409);

const assetUrl = sent.body.items[0].assets[0].url;
const asset = await fetch(assetUrl);
const assetBytes = new Uint8Array(await asset.arrayBuffer());
check("le labo télécharge le fichier d'impression par son URL signée, octet pour octet",
      asset.status === 200 && assetBytes.length === ORIGINAL.length && assetBytes.every((b, i) => b === ORIGINAL[i]),
      `HTTP ${asset.status}, ${assetBytes.length} octets`);
const tampered = await fetch(assetUrl.replace(/s=[^&]+/, "s=AAAA"));
const otherPhoto = await fetch(assetUrl.replace(shopPhoto, shopPhoto2));
check("une URL de fichier falsifiée, ou détournée vers une autre photo, est refusée (403)", tampered.status === 403 && otherPhoto.status === 403);

const callback = sent.body.callbackUrl;
const callbackBad = await fetch(callback.replace(/s=[^&]+/, "s=AAAA"), { method: "POST", body: "{}" });
check("une notification de suivi non signée est refusée (403)", callbackBad.status === 403);
lab.ship(submit.prodigiOrderId, "https://suivi.example/colis/TRK123");
const callbackOk = await (await fetch(callback, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "com.prodigi.order.status.stage.changed#Complete", data: { order: { id: "ord_mensonge", status: { stage: "Cancelled" } } } }) })).json();
const afterShip = await (await admin("GET", `/api/admin/galleries/${shopSlug}`)).json();
check("la notification déclenche une relecture chez Prodigi (jamais son contenu cru) : commande expédiée, lien de suivi",
      callbackOk.status === "shipped" && afterShip.printOrders[0].status === "shipped" &&
      afterShip.printOrders[0].trackingUrl === "https://suivi.example/colis/TRK123", JSON.stringify(callbackOk));
const clientAfterShip = (await shopLogin()).gallery.printOrders[0];
check("le client voit sa commande expédiée et son lien de suivi",
      clientAfterShip.status === "shipped" && clientAfterShip.trackingUrl === "https://suivi.example/colis/TRK123");

// Commande refusée par le labo : à relancer, raison visible.
const FAILED_ID = `ord_fail_${RUN}`;
await insertPaidOrder(FAILED_ID, `pay_fail_${RUN}`, paidLines.replace("GLOBAL-PHO-4x6", "GLOBAL-INVALID-1"));
const failedSubmit = await (await admin("POST", `/api/admin/print-orders/${FAILED_ID}/submit`)).json();
check("un refus du labo passe la commande « à relancer », avec la raison donnée par Prodigi",
      failedSubmit.ok === false && failedSubmit.status === "failed" && /Unknown SKU/.test(failedSubmit.error), JSON.stringify(failedSubmit));
const clientFailed = (await shopLogin()).gallery.printOrders.find((o) => o.id === FAILED_ID);
check("le client ne voit jamais l'erreur technique du labo, seulement « en préparation »", clientFailed?.statusLabel === "En préparation");
const allOrders = await (await admin("GET", "/api/admin/print-orders")).json();
const peerOrders = await (await peerAdmin("GET", "/api/admin/print-orders")).json();
check("toutes les commandes du compte sont listées avec leur galerie, jamais chez un autre compte",
      allOrders.orders?.length === 2 && allOrders.orders.every((o) => o.galleryTitle === "Séance boutique") && peerOrders.orders?.length === 0);

await admin("DELETE", `/api/admin/galleries/${shopSlug}`);
const assetAfterDelete = await fetch(assetUrl);
check("supprimer la galerie rend le fichier d'impression inaccessible", assetAfterDelete.status === 404);
await lab.close();

/* ---------- Sous-domaine par studio ---------- */

const meBeforeSub = await (await admin("GET", "/api/auth/me")).json();
check("sans sous-domaine réglé, le profil le dit et annonce le domaine des studios",
      meBeforeSub.photographer?.subdomain === "" && meBeforeSub.photographer?.studioDomain === "holypixx.com",
      "STUDIO_DOMAIN (wrangler.toml ou .dev.vars) doit valoir holypixx.com pour ce test — reçu " + JSON.stringify(meBeforeSub.photographer?.studioDomain));

const subBad = await admin("POST", "/api/admin/account/subdomain", { subdomain: "Mon Studio!" });
check("un sous-domaine avec espaces ou caractères spéciaux est refusé", subBad.status === 400);
const subShort = await admin("POST", "/api/admin/account/subdomain", { subdomain: "ab" });
check("un sous-domaine trop court est refusé", subShort.status === 400);
const subReserved = await admin("POST", "/api/admin/account/subdomain", { subdomain: "www" });
const subReserved2 = await admin("POST", "/api/admin/account/subdomain", { subdomain: "api" });
check("les noms réservés (www, api…) sont refusés", subReserved.status === 400 && subReserved2.status === 400);

const SUB = `studio-${RUN}`;
const subSet = await admin("POST", "/api/admin/account/subdomain", { subdomain: SUB.toUpperCase() });
const subSetBody = await subSet.json();
check("le photographe peut choisir son sous-domaine (mis en minuscules)", subSet.ok && subSetBody.subdomain === SUB, JSON.stringify(subSetBody));
const meAfterSub = await (await admin("GET", "/api/auth/me")).json();
check("le sous-domaine est relu dans le profil", meAfterSub.photographer?.subdomain === SUB);

const subTaken = await peerAdmin("POST", "/api/admin/account/subdomain", { subdomain: SUB });
check("un autre compte ne peut pas prendre le même sous-domaine (409)", subTaken.status === 409);
const subPeer = await peerAdmin("POST", "/api/admin/account/subdomain", { subdomain: `${SUB}-bis` });
check("un autre compte peut en choisir un autre", subPeer.ok);

// Requêtes « comme depuis le sous-domaine » : même Worker, en-tête Host
// différent — exactement ce qu'il recevra en production derrière la route
// *.holypixx.com. `fetch` de Node ignore un Host fourni à la main : on passe
// par node:http, qui l'envoie tel quel.
const { request: httpRequest } = await import("node:http");
function asStudio(sub, path, init = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(`${BASE}${path}`);
    const req = httpRequest(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: init.method || "GET",
        headers: { ...(init.headers || {}), host: `${sub}.holypixx.com` } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            headers: { get: (k) => (res.headers[k.toLowerCase()] === undefined ? null : String(res.headers[k.toLowerCase()])) },
            text: async () => buf.toString("utf8"),
            json: async () => JSON.parse(buf.toString("utf8")),
          });
        });
      }
    );
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

const unknownStudio = await asStudio("studio-inexistant-" + RUN, "/");
check("un sous-domaine qui ne correspond à aucun studio renvoie une page 404 lisible",
      unknownStudio.status === 404 && (unknownStudio.headers.get("content-type") || "").includes("text/html"));

// La galerie principale du test a été supprimée plus haut (suppression en
// cascade) : on se sert de celle de la section « Valider ma sélection ».
const loginOnStudio = await asStudio(SUB, `/api/gallery/${validateSlug}/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "mot-de-passe-solide" }),
});
const loginOnStudioBody = await loginOnStudio.json();
check("une galerie du studio s'ouvre sous l'adresse du studio, avec le nom du studio pour le client",
      loginOnStudio.ok && loginOnStudioBody.gallery?.studioName === "Nouveau nom de studio",
      `HTTP ${loginOnStudio.status} — ${JSON.stringify(loginOnStudioBody.gallery?.studioName ?? loginOnStudioBody)}`);

const loginOnOtherStudio = await asStudio(`${SUB}-bis`, `/api/gallery/${validateSlug}/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "mot-de-passe-solide" }),
});
check("la même galerie n'existe pas sous l'adresse d'un autre studio (404)", loginOnOtherStudio.status === 404);

// La page elle-même est relue depuis PUBLIC_SITE_ORIGIN : en local, un petit
// serveur statique sur web/ (PUBLIC_SITE_ORIGIN=http://localhost:8000 dans
// .dev.vars). Si le port est déjà pris ou la variable absente, on le dit
// plutôt que d'échouer pour une raison étrangère au Worker.
{
  const { createServer } = await import("node:http");
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const webDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web");
  const types = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8" };
  const site = createServer(async (req, res) => {
    const pathname = req.url.split("?")[0] === "/" ? "/galerie.html" : req.url.split("?")[0];
    try {
      const body = await readFile(join(webDir, pathname));
      res.writeHead(200, { "content-type": types[pathname.split(".").pop()] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  const listening = await new Promise((resolve) => {
    site.once("error", () => resolve(false));
    site.listen(8000, "localhost", () => resolve(true));
  });
  if (listening) {
    const pageOnStudio = await asStudio(SUB, "/?g=" + validateSlug);
    const pageHtml = await pageOnStudio.text();
    check("la page de galerie est servie sous l'adresse du studio, l'API pointée sur ce même hôte (sans schéma)",
          pageOnStudio.status === 200 && (pageOnStudio.headers.get("content-type") || "").includes("text/html") &&
          pageHtml.includes(`api: "//${SUB}.holypixx.com"`),
          pageOnStudio.status === 200 ? (pageHtml.match(/api: "[^"]*"/) || [])[0] : `HTTP ${pageOnStudio.status} — PUBLIC_SITE_ORIGIN=http://localhost:8000 attendu dans worker/.dev.vars`);
    const cssOnStudio = await asStudio(SUB, "/gallery.css");
    check("la feuille de style suit, avec son bon type",
          cssOnStudio.status === 200 && (cssOnStudio.headers.get("content-type") || "").includes("text/css"));
    const otherOnStudio = await asStudio(SUB, "/autre-chose.html");
    check("rien d'autre que la page de galerie n'est servi sous l'adresse du studio", otherOnStudio.status === 404);
    site.close();
  } else {
    console.log("  (port 8000 déjà pris : page sous sous-domaine non vérifiée ici)");
  }
}

const subCleared = await admin("POST", "/api/admin/account/subdomain", { subdomain: "" });
const meAfterClear = await (await admin("GET", "/api/auth/me")).json();
check("vider le champ retire le sous-domaine", subCleared.ok && meAfterClear.photographer?.subdomain === "");
const loginAfterClear = await asStudio(SUB, `/api/gallery/${validateSlug}/login`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "mot-de-passe-solide" }),
});
check("une fois retiré, l'ancien sous-domaine ne mène plus nulle part", loginAfterClear.status === 404);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
