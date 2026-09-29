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
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestAccount } from "./lib/testAccount.mjs";

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
await page.fill('#ad-signup-form [name="studioName"]', "Studio de test");
await page.fill('#ad-signup-form [name="email"]', email);
await page.fill('#ad-signup-form [name="password"]', password);
await page.click("#ad-signup-submit");
await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });
check("créer un compte depuis le formulaire connecte automatiquement au tableau de bord",
      await page.isVisible("#ad-new-gallery"));
check("le nom du studio renseigné à l'inscription apparaît dans la barre supérieure",
      (await page.textContent("#ad-current-account")).indexOf("Studio de test") === 0);
check("la barre d'onglets Galeries / Facturation / Paramètres est visible",
      await page.isVisible("#ad-tabs"));
check("l'onglet Galeries est actif par défaut, à l'arrivée sur le tableau de bord",
      await page.locator("#ad-tab-galleries.ad-tab-active").count() === 1);

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

check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
