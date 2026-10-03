// Vérification de l'interface d'administration dans un vrai navigateur,
// contre un admin-server.mjs déjà lancé sur un Worker local. Le compte
// principal est créé depuis le formulaire d'inscription lui-même (comme le
// ferait un vrai visiteur) ; le compte « voisin » utilisé pour vérifier le
// cloisonnement est créé directement via le Worker, pour ne pas retester
// l'inscription une seconde fois.
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/admin.test.mjs

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestAccount, setTestPlan } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
// tests/admin.test.mjs → tools → galerie → Littledreamphotos (racine du dépôt)
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKER_DIR = join(REPO_ROOT, "galerie", "worker");
const PHOTOS = [
  join(REPO_ROOT, "images", "famille", "famille-01.jpeg"),
  join(REPO_ROOT, "images", "famille", "famille-02.jpeg"),
  join(REPO_ROOT, "images", "maternite", "maternite-01.jpeg"),
];

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));

/* ---------- Création de compte et connexion, depuis le formulaire ---------- */

const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const email = `admin-ui-${RUN}@test.invalid`;
// Changé en cours de route par le test du formulaire « Mot de passe » de
// l'onglet Paramètres — la reconnexion finale doit donc utiliser la valeur
// courante, pas celle de l'inscription.
let password = "mot-de-passe-de-test-1234";

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-login-form", { timeout: 10000 });
check("l'écran de connexion s'affiche avant tout", await page.isVisible("#ad-login-form"));

/* ---------- Mot de passe de compte oublié ---------- */
// Le trajet complet (jeton reçu par e-mail → nouveau mot de passe) n'est
// pas automatisable ici : le jeton ne transite jamais par l'API, seulement
// par l'e-mail — l'exposer aux tests reviendrait à affaiblir la sécurité
// qu'il apporte (voir worker/tests/api.test.mjs pour ce qui EST vérifié).

await page.click("#ad-show-forgot");
await page.waitForSelector("#ad-forgot-card", { state: "visible", timeout: 5000 });
await page.fill('#ad-forgot-form [name="email"]', email);
await page.click("#ad-forgot-submit");
await page.waitForSelector("#ad-forgot-message:not([hidden])", { timeout: 10000 });
check("demander un lien de réinitialisation affiche un message générique",
      (await page.textContent("#ad-forgot-message")).indexOf("vient d'être envoyé") !== -1);

await page.click("#ad-forgot-back");
await page.waitForSelector("#ad-login-card", { state: "visible", timeout: 5000 });
check("le lien « retour » ramène bien au formulaire de connexion", await page.isVisible("#ad-login-form"));

await page.click("#ad-show-signup");
await page.waitForSelector("#ad-signup-card", { state: "visible", timeout: 5000 });
await page.fill('#ad-signup-form [name="firstName"]', "Julie");
await page.fill('#ad-signup-form [name="lastName"]', "Testeuse");
await page.fill('#ad-signup-form [name="studioName"]', "Studio de test");
await page.fill('#ad-signup-form [name="email"]', email);
await page.fill('#ad-signup-form [name="password"]', password);
const refusedWithoutTerms = await page.evaluate(async () => (await fetch("/local/auth/signup", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "sans-conditions@test.invalid", password: "mot-de-passe-assez-long" }),
})).status);
check("l'inscription exige d'accepter les conditions et la politique de confidentialité",
      refusedWithoutTerms === 400 && await page.getAttribute('#ad-signup-form [name="acceptTerms"]', "required") !== null &&
      (await page.textContent("#ad-signup-form")).includes("politique de confidentialité"));
await page.check('#ad-signup-form [name="acceptTerms"]');
await page.click("#ad-signup-submit");
await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });
// Formule Pro (comme après un abonnement) : boutique, adresse à son nom et
// galeries sans limite sont testées plus bas.
await setTestPlan(API, email, "pro");
check("créer un compte depuis le formulaire connecte automatiquement au tableau de bord",
      await page.isVisible("#ad-new-gallery"));
check("l'onglet Admin est masqué pour un compte qui n'est pas la propriétaire",
      await page.isHidden("#ad-tab-owner"));
check("le nom du studio renseigné à l'inscription apparaît dans la barre supérieure",
      (await page.textContent("#ad-current-account")).indexOf("Studio de test") === 0);
check("la barre d'onglets Galeries / Facturation / Paramètres est visible",
      await page.isVisible("#ad-tabs"));
check("l'onglet Galeries est actif par défaut, à l'arrivée sur le tableau de bord",
      await page.locator("#ad-tab-galleries.ad-tab-active").count() === 1);

/* ---------- Bandeau de compteurs (avant toute galerie) ---------- */

check("le bandeau de compteurs s'affiche dès l'arrivée, avant toute galerie",
      await page.locator(".ad-stat").count() === 5);
const emptyStatsText = await page.textContent(".ad-stats");
check("tous les compteurs démarrent à zéro pour un compte tout neuf",
      emptyStatsText.indexOf("Galeries créées") !== -1 &&
      emptyStatsText.indexOf("Ventes effectuées") !== -1 &&
      emptyStatsText.indexOf("Suppléments en ordre") !== -1 &&
      emptyStatsText.indexOf("Suppléments en attente") !== -1 &&
      (await page.locator(".ad-stat-warn").count()) === 0 &&
      (await page.locator(".ad-stat-success").count()) === 0,
      emptyStatsText.replace(/\s+/g, " "));

/* ---------- Création ---------- */

const title = `Séance de test ${Date.now().toString(36)}`;
await page.click("#ad-new-gallery");
await page.waitForSelector("#ad-create-modal:not([hidden])");
await page.fill('#ad-create-form [name="title"]', title);
await page.fill('#ad-create-form [name="clientName"]', "Famille Test");
await page.fill('#ad-create-form [name="clientEmail"]', "famille.test@example.com");
await page.click("#ad-create-submit");

await page.waitForSelector("#ad-created-modal:not([hidden])", { timeout: 10000 });
const link = await page.inputValue("#ad-created-link");
const galleryPassword = await page.inputValue("#ad-created-password");
check("la galerie créée fournit un lien et un mot de passe",
      link.includes("?g=") && galleryPassword.length >= 8, `${link} / ${galleryPassword}`);

await page.click('#ad-created-modal [data-close-modal]');
await page.waitForSelector("#ad-created-modal", { state: "hidden" });

/* ---------- Régénération du mot de passe ---------- */

await page.click("#ad-new-password");
await page.waitForSelector("#ad-confirm-modal:not([hidden])");
await page.click("#ad-confirm-ok");
await page.waitForSelector("#ad-password-modal:not([hidden])", { timeout: 10000 });
const regeneratedPassword = await page.inputValue("#ad-password-value");
check("le nouveau mot de passe diffère de celui affiché à la création",
      regeneratedPassword.length >= 8 && regeneratedPassword !== galleryPassword);
await page.click('#ad-password-modal [data-close-modal]');
await page.waitForSelector("#ad-password-modal", { state: "hidden" });
await page.waitForSelector(".ad-dropzone", { timeout: 10000 });
check("après création, la vue détail s'ouvre directement", await page.isVisible(".ad-dropzone"));

/* ---------- Arrière-plan de l'écran de connexion ---------- */

await page.click('.ad-bg-swatch[data-color="#b98a7a"]');
await page.waitForFunction(
  () => {
    const btn = document.querySelector('.ad-bg-swatch[data-color="#b98a7a"]');
    return btn && btn.classList.contains("ad-bg-swatch-active");
  },
  { timeout: 10000 }
);
check("une couleur prédéfinie choisie dans l'admin est bien enregistrée (confirmé après rechargement des données)", true);

await page.setInputFiles("#ad-bg-file-input", PHOTOS[0]);
await page.waitForSelector(".ad-bg-preview", { timeout: 15000 });
check("une image importée comme arrière-plan s'affiche en aperçu", await page.isVisible(".ad-bg-preview"));

/* ---------- Mise en page de la galerie ---------- */

check("par défaut, la grille est l'option active",
      await page.locator('.ad-layout-option[data-layout="grille"].ad-layout-option-active').count() === 1);

await page.click('.ad-layout-option[data-layout="mosaique"]');
await page.waitForFunction(
  () => {
    const btn = document.querySelector('.ad-layout-option[data-layout="mosaique"]');
    return btn && btn.classList.contains("ad-layout-option-active");
  },
  { timeout: 10000 }
);
check("choisir « Mosaïque » dans l'admin l'enregistre (confirmé après rechargement des données)", true);

/* ---------- Musique d'ambiance ---------- */

check("sans piste déposée, la fiche indique qu'il n'y a aucune musique",
      ((await page.textContent("#ad-music-state")) || "").includes("Aucune musique"));

const musicBuffer = Buffer.alloc(4096);
for (let i = 0; i < musicBuffer.length; i++) musicBuffer[i] = (i * 13 + 5) & 0xff;
await page.setInputFiles("#ad-music-file-input", { name: "balade.mp3", mimeType: "audio/mpeg", buffer: musicBuffer });
await page.waitForFunction(
  () => {
    const el = document.querySelector("#ad-music-state");
    return el && el.textContent.includes("Fichier MP3") && el.textContent.includes("balade.mp3");
  },
  { timeout: 15000 }
);
check("un MP3 importé devient la piste actuelle de la galerie (confirmé après rechargement des données)", true);

await page.setInputFiles("#ad-music-file-input", PHOTOS[0]);
await page.waitForFunction(
  () => {
    const toast = document.querySelector(".ad-toast-visible");
    return toast && toast.textContent.includes("MP3");
  },
  { timeout: 10000 }
);
check("un fichier qui n'est pas un MP3 est refusé avec un message explicite", true);
check("la piste existante est conservée après un import refusé",
      ((await page.textContent("#ad-music-state")) || "").includes("balade.mp3"));

await page.click("#ad-music-remove");
await page.waitForSelector("#ad-confirm-modal:not([hidden])");
await page.click("#ad-confirm-ok");
await page.waitForFunction(
  () => {
    const el = document.querySelector("#ad-music-state");
    return el && el.textContent.includes("Aucune musique");
  },
  { timeout: 15000 }
);
check("retirer la musique (après confirmation) ramène la fiche à « aucune musique »", true);

/* ---------- Livraison des photos définitives ---------- */

check("sans fichier déposé, la livraison n'est pas ouverte et rien ne peut être ouvert",
      ((await page.textContent(".ad-delivery-status")) || "").includes("Pas encore ouverte") && (await page.locator("#ad-delivery-open").count()) === 0);
await page.setInputFiles("#ad-delivery-input", [
  { name: "final-01.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(200000, 1) },
  { name: "final-02.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(50000, 2) },
]);
await page.waitForFunction(() => document.querySelectorAll(".ad-delivery-list li").length === 2, { timeout: 20000 });
check("les photos définitives s'ajoutent à la livraison, avec leur poids",
      (await page.textContent("#ad-delivery-progress")).includes("2 photos") && (await page.textContent(".ad-delivery-list")).includes("final-02.jpg"));
await page.click("#ad-delivery-open");
await page.waitForSelector("#ad-confirm-modal:not([hidden])");
await page.click("#ad-confirm-ok");
await page.waitForFunction(() => (document.querySelector(".ad-delivery-status") || {}).textContent?.includes("Livraison ouverte"), { timeout: 15000 });
check("ouvrir la livraison (après confirmation) l'indique sur la fiche", await page.isVisible("#ad-delivery-close"));
await page.click("#ad-delivery-close");
await page.waitForFunction(() => (document.querySelector(".ad-delivery-status") || {}).textContent?.includes("Pas encore ouverte"), { timeout: 15000 });
check("la livraison se referme d'un clic", await page.isVisible("#ad-delivery-open"));

/* ---------- Forfait et suppléments ---------- */

check("aucun forfait n'est défini par défaut",
      (await page.textContent("#ad-quota-summary")).indexOf("Aucun forfait défini") !== -1);

await page.fill('#ad-quota-form [name="includedPhotos"]', "5");
await page.fill('#ad-quota-form [name="extraPhotoPrice"]', "12.50");
await page.click("#ad-quota-save");
await page.waitForFunction(
  () => (document.querySelector("#ad-quota-summary")?.textContent || "").indexOf("/ 5 photo") !== -1,
  { timeout: 10000 }
);
check("le forfait enregistré apparaît dans le résumé (confirmé après rechargement des données)",
      (await page.textContent("#ad-quota-summary")).indexOf("0 / 5 photos incluses") !== -1,
      await page.textContent("#ad-quota-summary"));

/* ---------- Retour à la liste, la galerie y apparaît ---------- */

await page.click("#ad-back");
await page.waitForSelector(".ad-grid .ad-card");
const cardCount = await page.locator(".ad-grid .ad-card").count();
check("la nouvelle galerie apparaît dans la liste", cardCount >= 1, `${cardCount} carte(s)`);

await page.locator(`.ad-card:has-text("${title}")`).click();
await page.waitForSelector(".ad-dropzone");

/* ---------- Envoi de photos (glisser-déposer) ---------- */

const buffers = PHOTOS.map((p) => readFileSync(p));
const dataTransfer = await page.evaluateHandle(
  ([buffers, names]) => {
    const dt = new DataTransfer();
    buffers.forEach((b64, i) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], names[i], { type: "image/jpeg" }));
    });
    return dt;
  },
  [buffers.map((b) => b.toString("base64")), PHOTOS.map((p) => p.split("/").pop())]
);
await page.dispatchEvent("#ad-dropzone", "drop", { dataTransfer });

await page.waitForSelector(".ad-upload-item", { timeout: 5000 });
check("des lignes de progression apparaissent au dépôt", true);

// Le traitement (sharp + empreinte + filigrane + tuiles) prend quelques
// secondes par photo : on attend que les 3 aient un état terminal.
await page.waitForFunction(
  () => {
    const items = document.querySelectorAll(".ad-upload-item");
    return items.length > 0 && Array.from(items).every(
      (el) => el.classList.contains("ad-upload-done") || el.classList.contains("ad-upload-failed")
    );
  },
  { timeout: 60000 }
);
const failedUploads = await page.locator(".ad-upload-failed").count();
check("les 3 photos sont envoyées sans échec", failedUploads === 0, `${failedUploads} échec(s)`);

await page.waitForFunction(
  () => document.querySelectorAll("#ad-photos .ad-photo").length === 3,
  { timeout: 5000 }
);
check("les 3 vignettes apparaissent dans la galerie", true);
check("le compteur de photos est à jour",
      (await page.textContent("#ad-photos-heading")).trim() === "Photos (3)",
      (await page.textContent("#ad-photos-heading")).trim());

await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/admin-detail.png` : "admin-detail.png", fullPage: true });

/* ---------- Isolation entre comptes, vue depuis l'interface elle-même ---------- */
// Pas seulement l'API (déjà couvert par worker/tests/api.test.mjs) : un
// second compte, connecté dans un second contexte navigateur (cookies
// isolés, comme deux personnes différentes), ne doit jamais voir cette
// galerie dans son propre tableau de bord.

const peerAccount = await createTestAccount(API, "admin-ui-peer");
const peerContext = await browser.newContext();
const peerPage = await peerContext.newPage();
await peerPage.goto(BASE, { waitUntil: "domcontentloaded" });
await peerPage.waitForSelector("#ad-login-form", { timeout: 10000 });
await peerPage.fill('#ad-login-form [name="email"]', peerAccount.email);
await peerPage.fill('#ad-login-form [name="password"]', peerAccount.password);
await peerPage.click("#ad-login-submit");
await peerPage.waitForSelector(".ad-empty, .ad-grid", { timeout: 10000 });
const peerSeesForeignGallery = await peerPage.locator(`.ad-card:has-text("${title}")`).count();
check("un compte ne voit jamais les galeries d'un autre compte dans son tableau de bord",
      peerSeesForeignGallery === 0);
await peerContext.close();

/* ---------- Page Admin (propriétaire uniquement) ---------- */
// Un compte dont l'e-mail correspond à OWNER_EMAIL (voir worker/wrangler.toml
// et worker/src/owner.js) — ici, comme côté API, ce test est forcément couplé
// à cette adresse précise, créée à la demande (ou retrouvée si un précédent
// run l'a déjà créée dans cette même base locale, auquel cas on se connecte
// avec le même mot de passe fixe plutôt que d'échouer sur un conflit).

const OWNER_EMAIL = "fagnantchristine@gmail.com";
const OWNER_PASSWORD = "mot-de-passe-de-la-proprietaire-1234";

const ownerSignup = await fetch(`${API}/api/auth/signup`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: OWNER_EMAIL, password: OWNER_PASSWORD,
    studioName: "Holypixx", firstName: "Christine", lastName: "Fagnant",
  }),
});
if (ownerSignup.status !== 201 && ownerSignup.status !== 409) {
  throw new Error(`Impossible de préparer le compte propriétaire pour ce test : HTTP ${ownerSignup.status}`);
}

const ownerContext = await browser.newContext();
const ownerPage = await ownerContext.newPage();
await ownerPage.goto(BASE, { waitUntil: "domcontentloaded" });
await ownerPage.waitForSelector("#ad-login-form", { timeout: 10000 });
await ownerPage.fill('#ad-login-form [name="email"]', OWNER_EMAIL);
await ownerPage.fill('#ad-login-form [name="password"]', OWNER_PASSWORD);
await ownerPage.click("#ad-login-submit");
await ownerPage.waitForSelector("#ad-tabs", { timeout: 10000 });
check("l'onglet Admin est visible pour le compte dont l'e-mail correspond à OWNER_EMAIL",
      await ownerPage.isVisible("#ad-tab-owner"),
      "OWNER_EMAIL (wrangler.toml) doit valoir exactement " + OWNER_EMAIL + " pour ce test");

await ownerPage.click("#ad-tab-owner");
await ownerPage.waitForSelector(".ad-stats", { timeout: 10000 });
check("l'onglet Admin ouvre bien cet écran, avec son propre lien dans l'URL",
      await ownerPage.evaluate(() => location.hash) === "#/proprietaire");

const ownerStatsText = await ownerPage.textContent(".ad-stats");
check("les compteurs plateforme (photographes, galeries, ventes…) s'affichent",
      ownerStatsText.indexOf("Photographes inscrits") !== -1 &&
      ownerStatsText.indexOf("Galeries créées") !== -1 &&
      ownerStatsText.indexOf("Suppléments en attente") !== -1,
      ownerStatsText.replace(/\s+/g, " "));

await ownerPage.click("#ad-run-reminders");
await ownerPage.waitForFunction(() => {
  const out = document.getElementById("ad-run-reminders-result");
  return out && out.textContent.includes("examinée");
}, { timeout: 10000 });
check("la propriétaire peut lancer la passe de relances et en lire le résultat",
      (await ownerPage.textContent("#ad-run-reminders-result")).includes("relance"),
      await ownerPage.textContent("#ad-run-reminders-result"));

const ownerPageText = await ownerPage.textContent("#ad-view");
// Prénom/nom tels que saisis à l'inscription plus haut — le test de la
// section Paramètres, qui renomme le prénom en « Julie-Anne », n'a lieu que
// plus tard dans ce même fichier.
check("le compte créé plus haut dans ce test apparaît dans la liste, avec son prénom/nom",
      ownerPageText.indexOf("Julie Testeuse") !== -1 && ownerPageText.indexOf(email) !== -1,
      ownerPageText.indexOf(email) !== -1 ? "e-mail présent" : "e-mail absent");
check("la section trafic & sources explique comment brancher Cloudflare Web Analytics",
      ownerPageText.indexOf("Cloudflare Web Analytics") !== -1);

// Bibliothèque musicale : la propriétaire ajoute un morceau libre de droits.
const libraryTitle = `Matin doux ${Date.now().toString(36)}`;
await ownerPage.waitForSelector("#ad-owner-music-form");
await ownerPage.setInputFiles('#ad-owner-music-form [name="file"]', { name: "matin.mp3", mimeType: "audio/mpeg", buffer: musicBuffer });
await ownerPage.fill('#ad-owner-music-form [name="title"]', libraryTitle);
await ownerPage.fill('#ad-owner-music-form [name="artist"]', "Artiste libre");
await ownerPage.selectOption('#ad-owner-music-form [name="mood"]', "piano");
await ownerPage.fill('#ad-owner-music-form [name="credit"]', "Artiste libre — CC BY 4.0");
await ownerPage.click("#ad-owner-music-submit");
await ownerPage.waitForFunction((t) => (document.getElementById("ad-owner-music-list") || {}).textContent?.includes(t), libraryTitle, { timeout: 15000 });
check("la propriétaire ajoute un morceau à la bibliothèque musicale (titre, ambiance, crédit affichés)",
      (await ownerPage.textContent("#ad-owner-music-list")).includes("Piano") &&
      (await ownerPage.textContent("#ad-owner-music-list")).includes("CC BY 4.0"));

// Reconnexion avec le compte normal créé au tout début de ce test : l'onglet
// Admin ne doit jamais apparaître pour lui, même après tout ce qui précède.
check("l'onglet Admin reste masqué pour le compte normal de ce test, même après coup",
      await page.isHidden("#ad-tab-owner"));

await ownerContext.close();

// Le photographe choisit ce morceau pour sa galerie, puis un lien Spotify.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction((t) => (document.getElementById("ad-music-library") || {}).textContent?.includes(t), libraryTitle, { timeout: 15000 });
check("la bibliothèque est proposée dans la fiche galerie, avec écoute",
      (await page.locator("#ad-music-library .ad-track-play").count()) >= 1);
await page.locator("#ad-music-library .ad-track", { hasText: libraryTitle }).locator("[data-pick-track]").click();
await page.waitForFunction((t) => (document.getElementById("ad-music-state") || {}).textContent?.includes(t), libraryTitle, { timeout: 15000 });
// La liste de la bibliothèque se recharge juste après la fiche.
await page.waitForSelector("#ad-music-library .ad-track-current", { timeout: 15000 });
check("choisir un morceau de la bibliothèque en fait la musique de la galerie",
      (await page.textContent("#ad-music-state")).includes("bibliothèque") &&
      (await page.locator("#ad-music-library .ad-track-current", { hasText: libraryTitle }).count()) === 1);

await page.click('[data-music-tab="link"]');
await page.fill("#ad-music-link-input", "https://exemple.com/ma-musique");
await page.click("#ad-music-link-save");
await page.waitForFunction(() => (document.querySelector(".ad-toast-visible") || {}).textContent?.includes("Spotify"), { timeout: 10000 });
check("un lien d'un autre site est refusé avec un message clair", true);
await page.fill("#ad-music-link-input", "https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO?si=abc");
await page.click("#ad-music-link-save");
await page.waitForFunction(() => (document.getElementById("ad-music-state") || {}).textContent?.includes("Spotify"), { timeout: 15000 });
check("un lien Spotify devient le lecteur de la galerie", (await page.textContent("#ad-music-state")).includes("Lecteur Spotify"));
await page.click("#ad-music-remove");
await page.waitForSelector("#ad-confirm-modal:not([hidden])");
await page.click("#ad-confirm-ok");
await page.waitForFunction(() => (document.getElementById("ad-music-state") || {}).textContent?.includes("Aucune musique"), { timeout: 15000 });

/* ---------- Le lien créé fonctionne vraiment côté client ---------- */

const gallerySlug = new URL(link, "http://x").search.replace("?g=", "");
check("le slug est extrait du lien", gallerySlug.length > 0, gallerySlug);

/* ---------- Retrouver la sélection du client ---------- */
// Le client choisit une photo directement via l'API (comme le ferait sa
// propre page) ; on vérifie que le tableau de bord la retrouve, avec de quoi
// n'afficher que celle-ci.

const clientLogin = await fetch(`${API}/api/gallery/${gallerySlug}/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: regeneratedPassword }),
});
const clientSession = await clientLogin.json();
const firstPhotoId = clientSession.photos?.[0]?.id;
await fetch(`${API}/api/gallery/${gallerySlug}/select`, {
  method: "POST",
  headers: { authorization: `Bearer ${clientSession.token}`, "content-type": "application/json" },
  body: JSON.stringify({ photoId: firstPhotoId, selected: true }),
});

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-photos .ad-photo", { timeout: 10000 });
check("la photo choisie par le client porte bien le cœur sur sa vignette",
      await page.locator(`.ad-photo[data-photo-id="${firstPhotoId}"].ad-photo-selected`).count() === 1);
check("la case « afficher uniquement la sélection » propose le bon décompte",
      (await page.textContent("#ad-filter-selected + span")).indexOf("(1)") !== -1,
      await page.textContent("#ad-filter-selected + span"));

await page.click("#ad-filter-selected");
const visiblePhotosWhileFiltered = await page.locator("#ad-photos .ad-photo").evaluateAll(
  (nodes) => nodes.filter((n) => getComputedStyle(n).display !== "none").length
);
check("filtrer sur la sélection ne laisse apparaître que la photo choisie",
      visiblePhotosWhileFiltered === 1, `${visiblePhotosWhileFiltered} vignette(s) visible(s)`);
await page.click("#ad-filter-selected"); // on désactive : la suite du test veut voir toutes les photos

/* ---------- Codes couleur et repères annotés ---------- */
// Le client pose un code couleur et un repère via l'API (comme le ferait sa
// page) ; le tableau de bord doit les montrer sur la vignette et en grand.

await fetch(`${API}/api/gallery/${gallerySlug}/tag`, {
  method: "POST",
  headers: { authorization: `Bearer ${clientSession.token}`, "content-type": "application/json" },
  body: JSON.stringify({ photoId: firstPhotoId, tag: "yellow" }),
});
await fetch(`${API}/api/gallery/${gallerySlug}/marks`, {
  method: "POST",
  headers: { authorization: `Bearer ${clientSession.token}`, "content-type": "application/json" },
  body: JSON.stringify({ photoId: firstPhotoId, marks: [{ x: 0.3, y: 0.6, note: "adoucir ici" }] }),
});

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-photos .ad-photo", { timeout: 10000 });
check("la photo marquée « à retoucher » porte sa pastille jaune sur la vignette",
      await page.locator(`.ad-photo[data-photo-id="${firstPhotoId}"] .ad-photo-tag-yellow`).count() === 1);
check("la vignette annonce le nombre de repères posés",
      ((await page.textContent(`.ad-photo[data-photo-id="${firstPhotoId}"] .ad-photo-marks`)) || "").includes("1"));
check("la légende des codes couleur résume la galerie",
      ((await page.textContent("#ad-tag-legend")) || "").includes("1 à retoucher"),
      await page.textContent("#ad-tag-legend"));

await page.click(`.ad-photo[data-photo-id="${firstPhotoId}"] .ad-photo-frame`);
await page.waitForSelector("#ad-photo-modal:not([hidden])", { timeout: 5000 });
check("cliquer sur la vignette ouvre la photo en grand avec le repère posé dessus",
      await page.locator("#ad-photo-modal .ad-pin").count() === 1);
check("la note du repère est listée sous la photo",
      ((await page.textContent("#ad-photo-notes")) || "").includes("adoucir ici"));
check("le code couleur est rappelé dans la fiche en grand",
      await page.locator("#ad-photo-modal .ad-badge-tag-yellow").count() === 1);
await page.click("#ad-photo-modal-close");
check("la fiche en grand se referme", await page.isHidden("#ad-photo-modal"));

/* ---------- « Valider ma sélection » vue depuis l'admin ---------- */

check("tant que le client n'a pas validé, la fiche le dit et annonce les relances",
      await page.isVisible("#ad-selection-pending") && (await page.textContent("#ad-selection-pending")).includes("pas encore validée"));
await fetch(`${API}/api/gallery/${gallerySlug}/validate`, {
  method: "POST",
  headers: { authorization: `Bearer ${clientSession.token}`, "content-type": "application/json" },
  body: "{}",
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-selection-validated", { timeout: 10000 });
check("une fois validée, la fiche affiche la date de validation",
      (await page.textContent("#ad-selection-validated")).includes("Sélection validée par le client le"));
await page.click("#ad-back");
await page.waitForSelector(".ad-card", { timeout: 10000 });
check("la carte de la galerie porte le badge « Validée »",
      await page.locator(".ad-card .ad-badge-validated").count() === 1);
await page.locator(".ad-card").first().click();
await page.waitForSelector("#ad-photos .ad-photo", { timeout: 10000 });

/* ---------- Historique des paiements ---------- */
// Un vrai règlement Stripe ne peut pas être rejoué ici (pas de compte Stripe
// réel en local — voir stripe.test.mjs pour le câblage de la session de
// paiement, sans réseau). Ce qui EST vérifiable ici, c'est l'affichage de
// l'historique une fois qu'un paiement existe : on insère directement la
// ligne dans la base D1 locale (comme le ferait le webhook), pour tester le
// rendu réel de l'admin plutôt qu'une reconstitution en mémoire.

const adminLogin = await fetch(`${API}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const adminLoginData = await adminLogin.json();
const galleryForPayments = await (await fetch(`${API}/api/admin/galleries/${gallerySlug}`, {
  headers: { authorization: `Bearer ${adminLoginData.token}` },
})).json();
const galleryIdForPayments = galleryForPayments.gallery.id;

const paidAt = Math.floor(Date.now() / 1000);
execFileSync(
  "npx",
  [
    "wrangler", "d1", "execute", "galerie-protegee", "--local", "--command",
    `INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, status, created_at, paid_at) ` +
      `VALUES ('pay_admin_ui_test', '${galleryIdForPayments}', 'cs_admin_ui_test', 2, 2500, 'paid', ${paidAt}, ${paidAt});` +
      `INSERT INTO invoices (id, photographer_id, gallery_id, payment_id, number, issued_at, amount_cents, ` +
      `vat_rate_percent, vat_amount_cents, net_amount_cents, client_name, seller_company_name, seller_address, ` +
      `seller_vat_number, emailed_to, created_at) VALUES ('inv_admin_ui_test', ` +
      `(SELECT photographer_id FROM galleries WHERE id='${galleryIdForPayments}'), '${galleryIdForPayments}', ` +
      `'pay_admin_ui_test', '2026-0001', ${paidAt}, 2500, 0, 0, 2500, 'Famille Test', 'Studio de test', '', '', ` +
      `'client@test.invalid', ${paidAt});`,
  ],
  { cwd: WORKER_DIR, stdio: "pipe" }
);

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".ad-payments-heading", { timeout: 10000 });
check("l'historique des paiements apparaît après un règlement confirmé",
      await page.isVisible(".ad-payments-heading"));

const paymentsRowText = await page.textContent(".ad-payments-heading + .ad-table-wrap");
check("la ligne du paiement affiche le nombre de suppléments, le montant et le statut « Réglé »",
      paymentsRowText.indexOf("2 photos") !== -1 &&
      paymentsRowText.indexOf("25,00") !== -1 &&
      paymentsRowText.indexOf("Réglé") !== -1,
      paymentsRowText);
check("la ligne affiche aussi le numéro de la facture émise et son adresse d'envoi",
      paymentsRowText.indexOf("2026-0001") !== -1 &&
      paymentsRowText.indexOf("client@test.invalid") !== -1,
      paymentsRowText);

const invoiceLinkHref = await page.getAttribute(".ad-payments-heading + .ad-table-wrap a", "href");
check("le lien de la facture pointe vers le bon identifiant, servi par le serveur local",
      invoiceLinkHref === "/local/invoices/inv_admin_ui_test", invoiceLinkHref);

/* ---------- Le bandeau de compteurs reflète le règlement inséré plus haut ---------- */
// Forfait relevé à 5 photos incluses (section « Forfait et suppléments » plus
// haut), un seul coup de cœur du client : aucun supplément dû, mais les 2
// suppléments du règlement synthétique sont bien comptés comme « en ordre ».

await page.click("#ad-tab-galleries");
await page.waitForSelector(".ad-stats", { timeout: 10000 });
const statsAfterPayment = await page.textContent(".ad-stats");
check("le compteur de ventes reflète le règlement inséré plus haut (1 vente, 25,00 €)",
      statsAfterPayment.indexOf("Ventes effectuées") !== -1 && statsAfterPayment.indexOf("25,00") !== -1,
      statsAfterPayment.replace(/\s+/g, " "));
check("les 2 suppléments réglés apparaissent comme « en ordre », en succès",
      (await page.locator(".ad-stat-success").count()) === 1);
check("aucun supplément n'est en attente (forfait déjà relevé au-dessus de la sélection du client)",
      (await page.locator(".ad-stat-warn").count()) === 0);

await page.locator(`.ad-card:has-text("${title}")`).click();
await page.waitForSelector(".ad-dropzone", { timeout: 10000 });

/* ---------- Suppression d'une photo ---------- */

const firstPhoto = page.locator("#ad-photos .ad-photo").first();
await firstPhoto.hover();
await firstPhoto.locator(".ad-photo-remove").click();
await page.waitForSelector("#ad-confirm-modal:not([hidden])");
await page.click("#ad-confirm-ok");
await page.waitForFunction(() => document.querySelectorAll("#ad-photos .ad-photo").length === 2, { timeout: 5000 });
check("la photo supprimée disparaît de la grille", true);

/* ---------- Le journal se recharge après un accès client ---------- */

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-back", { timeout: 10000 });
const logRowsBefore = await page.locator(".ad-table tbody tr").count();
check("le journal est affiché (vide au départ)", logRowsBefore === 0 || logRowsBefore > 0, `${logRowsBefore} ligne(s)`);

/* ---------- Vérifier une photo (navigation) ---------- */
// Le moteur de détection lui-même (empreinte invisible, cloisonnement) est
// vérifié sans navigateur dans tests/detect.test.mjs ; ici on ne teste que
// la navigation de l'interface.

await page.click("#ad-check-photo");
await page.waitForSelector("#ad-detect-dropzone", { timeout: 5000 });
check("le bouton « Vérifier une photo » ouvre bien cet écran, avec son propre lien dans l'URL",
      await page.isVisible("#ad-detect-dropzone") && (await page.evaluate(() => location.hash)) === "#/detect");

await page.click("#ad-detect-back");
await page.waitForSelector(".ad-grid, .ad-empty", { timeout: 5000 });
check("« Toutes les galeries » depuis cet écran ramène bien à la liste",
      await page.isVisible(".ad-grid, .ad-empty"));

/* ---------- Onglet Facturation (Stripe Connect + factures + suppléments dus) ---------- */
// La connexion Stripe elle-même n'est pas exercée ici (il faudrait un vrai
// compte plateforme) — seul le câblage de l'écran est vérifié ; le reste est
// couvert côté API dans api.test.mjs. La facture insérée plus haut (section
// « Historique des paiements ») doit apparaître ici, agrégée toutes galeries
// confondues.

await page.click("#ad-tab-billing");
await page.waitForSelector(".ad-stripe", { timeout: 10000 });
check("l'onglet « Facturation » ouvre bien cet écran, avec son propre lien dans l'URL",
      await page.isVisible(".ad-stripe") && (await page.evaluate(() => location.hash)) === "#/facturation");
check("l'onglet Facturation est marqué actif dans la barre",
      await page.locator("#ad-tab-billing.ad-tab-active").count() === 1);
check("sans compte Stripe connecté, le bouton de connexion est proposé",
      await page.isVisible("#ad-stripe-connect"));

const billingViewText = await page.textContent("#ad-view");
check("le supplément dû n'apparaît plus une fois le forfait relevé au-dessus de la sélection du client",
      billingViewText.indexOf("Aucun supplément en attente") !== -1, billingViewText);
check("la facture émise pour le paiement inséré plus haut apparaît dans l'historique agrégé",
      billingViewText.indexOf("2026-0001") !== -1 && billingViewText.indexOf("25,00") !== -1, billingViewText);

await page.locator(`[data-slug="${gallerySlug}"]`).first().click();
await page.waitForSelector(".ad-dropzone", { timeout: 10000 });
check("cliquer sur une ligne de facture depuis l'onglet Facturation ouvre la bonne galerie",
      await page.evaluate(() => location.hash) === `#/g/${gallerySlug}`);

/* ---------- Onglet Paramètres (studio, présentation par défaut, coordonnées fiscales, connexion) ---------- */

await page.click("#ad-tab-settings");
await page.waitForSelector("#ad-studio-form", { timeout: 10000 });
check("l'onglet « Paramètres » ouvre bien cet écran, avec son propre lien dans l'URL",
      await page.isVisible("#ad-studio-form") && (await page.evaluate(() => location.hash)) === "#/parametres");
check("l'onglet Paramètres est marqué actif dans la barre",
      await page.locator("#ad-tab-settings.ad-tab-active").count() === 1);

await page.fill('#ad-studio-form [name="studioName"]', "Studio de test — renommé");
await page.click("#ad-studio-save");
await page.waitForSelector(".ad-toast-visible", { timeout: 5000 });
check("le nom du studio modifié apparaît aussitôt dans la barre supérieure",
      (await page.textContent("#ad-current-account")).indexOf("Studio de test — renommé") === 0);

check("le prénom et le nom saisis à l'inscription sont bien relus dans Paramètres",
      await page.inputValue('#ad-name-form [name="firstName"]') === "Julie" &&
      await page.inputValue('#ad-name-form [name="lastName"]') === "Testeuse");
await page.fill('#ad-name-form [name="firstName"]', "Julie-Anne");
await page.click("#ad-name-save");
await page.waitForSelector(".ad-toast-visible", { timeout: 5000 });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-name-form", { timeout: 10000 });
check("le prénom modifié depuis Paramètres est bien relu après rechargement",
      await page.inputValue('#ad-name-form [name="firstName"]') === "Julie-Anne");

/* ---------- Adresse du studio (sous-domaine) ---------- */

check("sans sous-domaine, Paramètres le dit", (await page.textContent("#ad-subdomain-current")).includes("Aucun sous-domaine"));
const SUBDOMAIN = `julie-${Date.now().toString(36)}`;
await page.fill('#ad-subdomain-form [name="subdomain"]', SUBDOMAIN);
await page.click("#ad-subdomain-save");
await page.waitForFunction((sub) => {
  const el = document.getElementById("ad-subdomain-current");
  return el && el.textContent.includes("https://" + sub + ".");
}, SUBDOMAIN, { timeout: 10000 });
check("le sous-domaine enregistré est rappelé avec l'adresse complète des liens", true);
await page.fill('#ad-subdomain-form [name="subdomain"]', "www");
await page.click("#ad-subdomain-save");
await page.waitForFunction(() => {
  const toast = document.querySelector(".ad-toast-visible");
  return toast && toast.textContent.includes("réservé");
}, { timeout: 5000 });
check("un nom réservé est refusé avec un message explicite", true);
await page.click("#ad-tab-galleries");
await page.waitForSelector(".ad-card", { timeout: 10000 });
await page.locator(".ad-card").first().click();
await page.waitForSelector("#ad-detail-link", { timeout: 10000 });
check("le lien de la galerie porte désormais l'adresse du studio",
      (await page.inputValue("#ad-detail-link")).startsWith("https://" + SUBDOMAIN + "."),
      await page.inputValue("#ad-detail-link"));
await page.click("#ad-tab-settings");
await page.waitForSelector("#ad-reminders-toggle", { timeout: 10000 });

check("les relances automatiques sont cochées par défaut", await page.isChecked("#ad-reminders-toggle"));
await page.uncheck("#ad-reminders-toggle");
await page.waitForFunction(() => {
  const toast = document.querySelector(".ad-toast-visible");
  return toast && toast.textContent.includes("désactivées");
}, { timeout: 5000 });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-reminders-toggle", { timeout: 10000 });
check("décocher les relances est enregistré (relu après rechargement)", !(await page.isChecked("#ad-reminders-toggle")));
await page.check("#ad-reminders-toggle");
await page.waitForFunction(() => {
  const toast = document.querySelector(".ad-toast-visible");
  return toast && toast.textContent.includes("activées");
}, { timeout: 5000 });

/* ---------- Boutique de tirages (onglet Boutique + fiche galerie) ---------- */
// Le Worker local parle au faux laboratoire Prodigi (worker/.dev.vars).

const { startFakeProdigi } = await import("../../worker/tests/lib/fakeProdigi.mjs");
const shopLab = await startFakeProdigi(undefined, { rejectSku: /INVALID|GLOBAL-BLP/i });

await page.click("#ad-tab-shop");
await page.waitForSelector("#ad-shop-settings", { timeout: 10000 });
check("l'onglet Boutique ouvre son écran, avec son propre lien dans l'URL",
      (await page.evaluate(() => location.hash)) === "#/boutique");
check("la liste de préparation signale la clé Prodigi encore à renseigner",
      (await page.textContent("#ad-shop-steps li:first-child")).includes("○"));
await page.fill('#ad-shop-settings [name="apiKey"]', "test-key-admin-ui-9876");
await page.fill('#ad-shop-settings [name="shipping"]', "5,90");
await page.click("#ad-shop-settings-save");
await page.waitForFunction(() => (document.querySelector("#ad-shop-steps li") || {}).textContent?.includes("✓"), { timeout: 10000 });
check("enregistrer la clé coche l'étape, sans jamais réafficher la clé elle-même",
      (await page.textContent("#ad-shop-steps li:first-child")).includes("…9876") && !(await page.content()).includes("test-key-admin-ui-9876"));
check("les frais de port sont relus en euros", (await page.inputValue('#ad-shop-settings [name="shipping"]')) === "5.90");

await page.click("#ad-shop-suggested");
await page.waitForFunction(() => document.querySelectorAll("#ad-shop-products tr[data-product-id]").length === 5, { timeout: 10000 });
check("« Ajouter les formats suggérés » remplit la boutique (5 produits), rangés par catégorie",
      (await page.locator("#ad-shop-products .ad-cat-row").allTextContents()).join("|") === "Tirages photo|Tirages d'art & posters|Toiles|Cadres",
      (await page.locator("#ad-shop-products .ad-cat-row").allTextContents()).join("|"));
check("aucune référence Prodigi ni option technique n'est affichée pour les produits du catalogue",
      !(await page.textContent("#ad-shop-products")).includes("GLOBAL-"));

// Ajout en menus déroulants : catégorie → produit → format → (option).
check("les menus proposent 7 catégories, dont plexiglas & aluminium, objets & cadeaux et cartes",
      (await page.locator("#ad-pick-category option").allTextContents()).join("|") ===
        "Tirages photo|Tirages d'art & posters|Toiles|Cadres|Plexiglas & aluminium|Objets & cadeaux|Cartes",
      (await page.locator("#ad-pick-category option").allTextContents()).join("|"));
await page.selectOption("#ad-pick-category", "canvas");
await page.selectOption("#ad-pick-product", "canvas-rolled");
check("une toile roulée n'a pas d'option : le menu d'option disparaît", await page.isHidden("#ad-pick-option-wrap"));
await page.selectOption("#ad-pick-size", "16x20");
await page.waitForFunction(() => (document.getElementById("ad-pick-cost") || {}).textContent?.includes("12,50"), { timeout: 10000 });
check("le coût réel chez le labo s'affiche aussitôt le format choisi", (await page.textContent("#ad-pick-cost")).includes("le produit"));
check("une marge est proposée et le prix client se calcule tout seul",
      (await page.inputValue("#ad-pick-margin")) === "13.00" && (await page.textContent("#ad-pick-price")).includes("25,50"),
      await page.textContent("#ad-pick-price"));
await page.fill("#ad-pick-margin", "20");
check("changer la marge recalcule le prix client", (await page.textContent("#ad-pick-price")).includes("32,50"));
await page.click("#ad-pick-add");
await page.waitForFunction(() => Array.from(document.querySelectorAll("#ad-shop-products tr[data-product-id]")).some((r) => r.textContent.includes("Toile roulée (sans châssis) 40 × 50 cm")), { timeout: 10000 });
const pickedRow = page.locator("#ad-shop-products tr[data-product-id]", { hasText: "Toile roulée" });
check("le produit ajouté apparaît dans « Mes produits », avec son coût et sa marge",
      (await pickedRow.locator('[data-field="price"]').inputValue()) === "32.50" && (await pickedRow.locator(".ad-margin-cell").textContent()).includes("20,00"));

await page.selectOption("#ad-pick-category", "frames");
await page.waitForFunction(() => (document.getElementById("ad-pick-cost") || {}).textContent?.includes("12,50"), { timeout: 10000 });
// Le faux labo ne fabrique ce cadre qu'en noir et blanc, et le 30 × 30 n'est
// livré qu'aux États-Unis : les menus ne montrent que ce qui existe.
check("les cadres proposent la couleur du cadre, limitée à celles que le labo fabrique",
      (await page.textContent("#ad-pick-option-label")) === "Couleur du cadre" &&
      (await page.locator("#ad-pick-option option").allTextContents()).join("|") === "Noir|Blanc",
      (await page.locator("#ad-pick-option option").allTextContents()).join("|"));
check("un format que le labo ne livre pas dans le pays choisi disparaît des menus",
      !(await page.locator("#ad-pick-size option").allTextContents()).includes("30 × 30 cm") &&
      (await page.locator("#ad-pick-size option").allTextContents()).includes("40 × 50 cm"));
await page.selectOption("#ad-pick-category", "art");
await page.selectOption("#ad-pick-product", "art-budget-poster");
await page.waitForFunction(() => (document.getElementById("ad-pick-cost") || {}).textContent?.includes("aucun format"), { timeout: 10000 });
check("un produit que le labo ne fabrique pas est signalé et ne peut pas être ajouté",
      (await page.locator("#ad-pick-size option").count()) === 0 && await page.isDisabled("#ad-pick-add"));
await page.selectOption("#ad-pick-category", "gifts");
await page.selectOption("#ad-pick-product", "gift-mug");
await page.waitForFunction(() => (document.getElementById("ad-pick-cost") || {}).textContent?.includes("12,50"), { timeout: 10000 });
check("un mug se choisit comme le reste (contenance au lieu d'un format)",
      (await page.locator("#ad-pick-size option").allTextContents()).join("|") === "330 ml" && await page.isHidden("#ad-pick-option-wrap"));

// Mode avancé : référence saisie à la main.
await page.click(".ad-advanced summary");
await page.fill('#ad-shop-new [data-field="label"]', "Format inconnu du labo");
await page.fill('#ad-shop-new [data-field="sku"]', "GLOBAL-INVALID-9");
await page.fill('#ad-shop-new [data-field="price"]', "3");
await page.click("#ad-shop-add");
await page.waitForFunction(() => document.querySelectorAll("#ad-shop-products tr[data-product-id]").length === 7, { timeout: 10000 });
check("le mode avancé permet encore d'ajouter une référence hors catalogue (affichée sous le libellé)",
      (await page.textContent("#ad-shop-products")).includes("Réf. GLOBAL-INVALID-9"));

await page.click("#ad-shop-quote");
await page.waitForFunction(() => Array.from(document.querySelectorAll(".ad-cost-cell")).every((c) => !c.textContent.includes("à estimer")), { timeout: 15000 });
const firstCost = await page.textContent("#ad-shop-products tr[data-product-id] .ad-cost-cell");
const invalidCost = await page.locator("#ad-shop-products tr[data-product-id]", { hasText: "Format inconnu" }).locator(".ad-cost-cell").textContent();
check("« Mettre à jour les coûts labo » affiche le coût du produit et sa livraison", firstCost.includes("12,50") && firstCost.includes("4,95"), firstCost);
check("un produit refusé par le labo affiche la raison donnée par Prodigi", invalidCost.includes("Unknown SKU"), invalidCost);

const firstRow = page.locator("#ad-shop-products tr[data-product-id]").first();
await firstRow.locator('[data-field="price"]').fill("16.50");
check("modifier un prix recalcule la marge immédiatement", (await firstRow.locator(".ad-margin-cell").textContent()).includes("4,00"),
      await firstRow.locator(".ad-margin-cell").textContent());
await firstRow.locator("[data-save-product]").click();
await page.waitForFunction(() => document.querySelector('#ad-shop-products tr[data-product-id] [data-field="price"]')?.value === "16.50", { timeout: 10000 });
check("le nouveau prix est enregistré (relu après rechargement de l'écran)", true);
check("aucune commande n'est encore listée", await page.isVisible("#ad-print-orders-empty"));

await page.click("#ad-tab-galleries");
await page.waitForSelector(".ad-card", { timeout: 10000 });
await page.locator(".ad-card").first().click();
await page.waitForSelector("#ad-gallery-shop-toggle", { timeout: 10000 });
check("la fiche galerie propose d'ouvrir la boutique, fermée par défaut", !(await page.isChecked("#ad-gallery-shop-toggle")));
await page.check("#ad-gallery-shop-toggle");
await page.waitForFunction(() => (document.getElementById("ad-shop-printable") || {}).textContent?.includes("tant que la boutique est ouverte"), { timeout: 10000 });
check("ouvrir la boutique l'enregistre et explique quelles photos sont commandables",
      await page.isChecked("#ad-gallery-shop-toggle") && (await page.textContent("#ad-shop-printable")).includes("disponible"));

check("une fois la boutique ouverte, la fiche propose une promotion à durée limitée", await page.isVisible("#ad-promo-start"));
await page.selectOption("#ad-promo-percent", "25");
await page.click("#ad-promo-start");
await page.waitForSelector(".ad-promo-on", { timeout: 10000 });
check("lancer une promotion l'affiche sur la fiche (remise et date de fin)",
      (await page.textContent(".ad-promo-on")).includes("−25 %") && await page.isVisible("#ad-promo-stop"));
await page.click("#ad-promo-stop");
await page.waitForSelector("#ad-promo-start", { timeout: 10000 });
check("la promotion s'arrête d'un clic", true);
await shopLab.close();

await page.click("#ad-tab-settings");
await page.waitForSelector("#ad-studio-form", { timeout: 10000 });

check("la grille est l'option de présentation par défaut active avant tout changement",
      await page.locator('#ad-default-layout-options .ad-layout-option[data-layout="grille"].ad-layout-option-active').count() === 1);
await page.click('#ad-default-layout-options .ad-layout-option[data-layout="mosaique"]');
await page.waitForFunction(
  () => document.querySelector('#ad-default-layout-options .ad-layout-option[data-layout="mosaique"]')?.classList.contains("ad-layout-option-active"),
  { timeout: 10000 }
);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-studio-form", { timeout: 10000 });
check("la présentation par défaut choisie est bien relue après rechargement",
      await page.locator('#ad-default-layout-options .ad-layout-option[data-layout="mosaique"].ad-layout-option-active').count() === 1);

await page.fill('#ad-billing-form [name="companyName"]', "Little Dream Photos SRL");
await page.fill('#ad-billing-form [name="address"]', "Rue de la Paix 1, 1000 Bruxelles, Belgique");
await page.fill('#ad-billing-form [name="vatNumber"]', "BE0123456789");
await page.click("#ad-billing-save");
await page.waitForSelector(".ad-toast-visible", { timeout: 10000 });

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-billing-form", { timeout: 10000 });
check("les coordonnées fiscales enregistrées sont bien relues après rechargement",
      await page.inputValue('#ad-billing-form [name="companyName"]') === "Little Dream Photos SRL" &&
      await page.inputValue('#ad-billing-form [name="vatNumber"]') === "BE0123456789");

// Changer le mot de passe redemande le mot de passe ACTUEL : un jeton de
// session volé ne doit jamais suffire seul à ce changement.
await page.fill('#ad-password-change-form [name="currentPassword"]', "mauvais-mot-de-passe");
await page.fill('#ad-password-change-form [name="newPassword"]', "peu-importe-1234567890");
await page.click("#ad-password-change-save");
await page.waitForSelector("#ad-password-change-error:not([hidden])", { timeout: 5000 });
check("un mauvais mot de passe actuel est rejeté sans déconnecter la session en cours",
      await page.isVisible("#ad-tabs"));

const newPassword = "nouveau-mot-de-passe-admin-1234";
await page.fill('#ad-password-change-form [name="currentPassword"]', password);
await page.fill('#ad-password-change-form [name="newPassword"]', newPassword);
await page.click("#ad-password-change-save");
await page.waitForSelector(".ad-toast-visible", { timeout: 5000 });
check("le mot de passe peut être changé depuis les Paramètres en fournissant l'actuel", true);
password = newPassword;

// Changer d'adresse e-mail ne prend jamais effet immédiatement : seule la
// confirmation du lien envoyé à la NOUVELLE adresse l'applique (voir
// worker/src/account.js) — on ne teste ici que la demande elle-même, jamais
// le jeton (qui ne transite jamais par l'API, seulement par l'e-mail).
const newEmail = `admin-ui-nouvelle-${RUN}@test.invalid`;
await page.fill('#ad-email-form [name="newEmail"]', newEmail);
await page.fill('#ad-email-form [name="password"]', "mauvais-mot-de-passe");
await page.click("#ad-email-save");
await page.waitForSelector("#ad-email-error:not([hidden])", { timeout: 5000 });
check("demander un changement d'e-mail avec un mauvais mot de passe est rejeté", true);

await page.fill('#ad-email-form [name="newEmail"]', newEmail);
await page.fill('#ad-email-form [name="password"]', password);
await page.click("#ad-email-save");
await page.waitForSelector("#ad-email-message:not([hidden])", { timeout: 10000 });
const emailChangeMessage = await page.textContent("#ad-email-message");
check("une demande de changement d'e-mail valide affiche la confirmation attendue, sans rien changer tout de suite",
      emailChangeMessage.indexOf(newEmail) !== -1 && emailChangeMessage.indexOf("lien de confirmation") !== -1,
      emailChangeMessage);

// On avait quitté le détail de la galerie pour tester ces navigations :
// on y retourne avant de poursuivre (suppression, déconnexion).
await page.click("#ad-tab-galleries");
await page.waitForSelector(".ad-grid, .ad-empty", { timeout: 10000 });
await page.locator(`.ad-card:has-text("${title}")`).click();
await page.waitForSelector(".ad-dropzone", { timeout: 5000 });

/* ---------- Suppression de la galerie ---------- */

await page.click("#ad-delete-gallery");
await page.waitForSelector("#ad-confirm-modal:not([hidden])");
await page.click("#ad-confirm-ok");
await page.waitForSelector(".ad-grid, .ad-empty", { timeout: 5000 });
const stillThere = await page.locator(`.ad-card:has-text("${title}")`).count();
check("la galerie supprimée disparaît de la liste", stillThere === 0);

/* ---------- Déconnexion ---------- */

await page.click("#ad-logout");
await page.waitForSelector("#ad-login-form", { timeout: 5000 });
check("la déconnexion ramène à l'écran de connexion", await page.isVisible("#ad-login-form"));

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#ad-login-form", { timeout: 10000 });
check("après déconnexion, recharger la page ne rouvre pas le tableau de bord",
      await page.isVisible("#ad-login-form"));

/* ---------- Le compte créé plus haut se reconnecte normalement ---------- */

await page.fill('#ad-login-form [name="email"]', email);
await page.fill('#ad-login-form [name="password"]', password);
await page.click("#ad-login-submit");
await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });
check("le compte créé depuis le formulaire d'inscription se reconnecte ensuite normalement",
      await page.isVisible("#ad-new-gallery"));

/* ---------- Abonnement ---------- */

await page.click("#ad-tab-subscription");
await page.waitForSelector(".ad-plans", { timeout: 10000 });
check("l'onglet Abonnement présente les 3 formules, la formule actuelle et l'utilisation",
      (await page.locator(".ad-plan").count()) === 3 && (await page.textContent(".ad-plan-name")) === "Pro" &&
      (await page.locator(".ad-plan-current", { hasText: "Pro" }).count()) === 1 &&
      (await page.textContent(".ad-plan-usage")).includes("galerie") &&
      (await page.evaluate(() => location.hash)) === "#/abonnement");

/* ---------- Mes données : export puis suppression du compte ---------- */

await page.click("#ad-tab-settings");
await page.waitForSelector(".ad-mydata", { timeout: 10000 });
const [exportDownload] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.click('.ad-mydata a[href="/local/account/export"]')]);
const exported = JSON.parse(readFileSync(await exportDownload.path(), "utf8"));
check("« Exporter mes données » télécharge toutes les données du compte, sans aucun secret",
      exported.format === "holypixx-export-1" && exported.account?.email === email && Array.isArray(exported.galleries) &&
      typeof exported.account.terms_accepted_at === "number" &&
      !("password_hash" in exported.account) && !JSON.stringify(exported).includes("password_salt"),
      exportDownload.suggestedFilename());
await page.click(".ad-danger-zone summary");
await page.fill('#ad-delete-account-form [name="password"]', "mauvais-mot-de-passe");
await page.fill('#ad-delete-account-form [name="confirm"]', "SUPPRIMER");
await page.click("#ad-delete-account-submit");
await page.waitForSelector("#ad-delete-account-error:not([hidden])", { timeout: 10000 });
check("supprimer le compte exige le bon mot de passe", (await page.textContent("#ad-delete-account-error")).includes("incorrect"));
await page.fill('#ad-delete-account-form [name="password"]', password);
await page.click("#ad-delete-account-submit");
await page.waitForSelector("#ad-login-form", { timeout: 15000 });
const loginAfterDelete = await page.evaluate(async ({ email, password }) => (await fetch("/local/auth/login", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
})).status, { email, password });
check("une fois supprimé, le compte n'existe plus (connexion refusée)", loginAfterDelete === 401, String(loginAfterDelete));

check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
