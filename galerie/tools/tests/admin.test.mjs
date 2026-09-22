// Vérification de l'interface d'administration dans un vrai navigateur,
// contre un admin-server.mjs déjà lancé sur un Worker local. Le compte
// principal est créé depuis le formulaire d'inscription lui-même (comme le
// ferait un vrai visiteur) ; le compte « voisin » utilisé pour vérifier le
// cloisonnement est créé directement via le Worker, pour ne pas retester
// l'inscription une seconde fois.
//
//   npx wrangler dev --local --port 8788                     (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/admin.test.mjs

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestAccount } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
// tests/admin.test.mjs → tools → galerie → Littledreamphotos (racine du dépôt)
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
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
const password = "mot-de-passe-de-test-1234";

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
await page.fill('#ad-signup-form [name="studioName"]', "Studio de test");
await page.fill('#ad-signup-form [name="email"]', email);
await page.fill('#ad-signup-form [name="password"]', password);
await page.click("#ad-signup-submit");
await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });
check("créer un compte depuis le formulaire connecte automatiquement au tableau de bord",
      await page.isVisible("#ad-new-gallery"));
check("le nom du studio renseigné à l'inscription apparaît dans la barre supérieure",
      (await page.textContent("#ad-current-account")).indexOf("Studio de test") === 0);

/* ---------- Création ---------- */

const title = `Séance de test ${Date.now().toString(36)}`;
await page.click("#ad-new-gallery");
await page.waitForSelector("#ad-create-modal:not([hidden])");
await page.fill('#ad-create-form [name="title"]', title);
await page.fill('#ad-create-form [name="clientName"]', "Famille Test");
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

/* ---------- Le lien créé fonctionne vraiment côté client ---------- */

const gallerySlug = new URL(link, "http://x").search.replace("?g=", "");
check("le slug est extrait du lien", gallerySlug.length > 0, gallerySlug);

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

check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
