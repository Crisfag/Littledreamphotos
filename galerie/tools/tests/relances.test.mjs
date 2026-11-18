// Relances & e-mails, de bout en bout contre le Worker local et l'espace
// photographe : passe planifiée (sélection pas commencée, un an déjà),
// accord donné dans la galerie, onglet Relances (interrupteurs, texte
// personnalisé, aperçu, test), campagne envoyée à un ciblage, désinscription
// par le lien de l'e-mail, contacts, adresse d'envoi, fiche client.
//
//   npm run dev:local -- --test-scheduled                     (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/relances.test.mjs

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../lib/client.mjs";
import { createTestAccount, localSql } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const SHOTS = process.env.SHOTS || "";
const WORKER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "worker");

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}
// Passe planifiée (wrangler dev --test-scheduled) : le Worker local se
// relance parfois juste après une écriture directe en base, on réessaie.
async function runCron() {
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetch(`${API}/__scheduled?cron=0+8+*+*+*`);
      if (r.ok) return;
    } catch { /* Worker en train de redémarrer */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Passe planifiée injoignable : lancez dev:local avec --test-scheduled");
}
const flat = (t) => String(t || "").replace(/[  ]/g, " ").replace(/\s+/g, " ");
function select(sql) {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "galerie-protegee", "--local", "--json", "--command", sql], { cwd: WORKER_DIR, stdio: "pipe" }).toString();
  // wrangler --json écrit les NULL sous forme de texte « null ».
  return JSON.parse(out.slice(out.indexOf("[")))[0].results.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === "null" ? null : v])));
}

const account = await createTestAccount(API, "relances");
const client = new WorkerClient({ api: API, ...account });
const now = Math.floor(Date.now() / 1000);
const DAY = 86400;
const tag = Date.now().toString(36);
const P = `(SELECT id FROM photographers WHERE email = '${account.email}')`;
const pid = select(`SELECT id FROM photographers WHERE email = '${account.email}'`)[0].id;
await localSql(API, `UPDATE photographers SET studio_name = 'Studio Lumière' WHERE id = '${pid}'`);

// Sophie : galerie envoyée il y a 6 jours, rien choisi. Paul : séance il y a un an.
const sA = `sophie-${tag}`, sB = `paul-${tag}`;
await client.createGallery({ slug: sA, title: "Séance famille au parc", clientName: "Sophie Martin", clientEmail: "sophie@example.com", password: "mot-de-passe-1" });
await client.createGallery({ slug: sB, title: "Mariage de Paul et Léa", clientName: "Paul Dubois", clientEmail: "paul@example.com", password: "mot-de-passe-2" });
await localSql(API, `UPDATE galleries SET created_at = ${now - 6 * DAY}, invite_sent_at = ${now - 6 * DAY}, session_type = 'famille' WHERE slug = '${sA}'`);
await localSql(API, `UPDATE galleries SET created_at = ${now - 367 * DAY}, session_type = 'mariage', language = 'en' WHERE slug = '${sB}'`);
await localSql(API, `INSERT INTO photos (id, gallery_id, position, width, height, cols, rows, created_at) SELECT 'pho_r1_${tag}', id, 0, 100, 100, 1, 1, ${now} FROM galleries WHERE slug = '${sA}'`);

// Sophie accepte les offres du studio dans sa galerie.
const login = await (await fetch(`${API}/api/gallery/${sA}/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "mot-de-passe-1" }) })).json();
const consentRes = await fetch(`${API}/api/gallery/${sA}/consent`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${login.token}` }, body: JSON.stringify({ email: "Sophie@Example.com", consent: true }),
});
const refused = await fetch(`${API}/api/gallery/${sA}/consent`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${login.token}` }, body: JSON.stringify({ email: "sophie@example.com" }),
});
const sophieRow = select(`SELECT marketing_consent, consent_source, lang FROM clients WHERE photographer_id = '${pid}' AND email = 'sophie@example.com'`)[0];
check("galerie : l'accord coché est noté (source, langue) ; sans case cochée, refus",
      consentRes.ok && refused.status === 400 && sophieRow?.marketing_consent === 1 && sophieRow.consent_source === "gallery" && sophieRow.lang === "fr", JSON.stringify(sophieRow));

// Passe planifiée du matin.
await runCron();
await new Promise((r) => setTimeout(r, 2500));
const autoSends = select(`SELECT client_email, kind, lang, subject FROM email_sends WHERE photographer_id = '${pid}' ORDER BY kind`);
check("passe planifiée : « sélection pas commencée » à Sophie, « un an déjà » à Paul (en anglais)",
      autoSends.some((s) => s.kind === "auto:selection_nudge" && s.client_email === "sophie@example.com" && /Sophie/.test(s.subject)) &&
      autoSends.some((s) => s.kind === "auto:anniversary" && s.client_email === "paul@example.com" && s.lang === "en"), JSON.stringify(autoSends));
await runCron();
await new Promise((r) => setTimeout(r, 1500));
check("une seule fois : la passe suivante n'envoie rien de plus",
      select(`SELECT COUNT(*) AS n FROM email_sends WHERE photographer_id = '${pid}'`)[0].n === autoSends.length);

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: "block" });
const page = await context.newPage();
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));
page.on("dialog", (d) => d.accept());
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + ".png"), fullPage: true }); };
// Attend le message dont le texte correspond (un message précédent peut encore être affiché).
const toastText = async (re) => {
  if (re) await page.waitForFunction((src) => { const t = document.getElementById("ad-toast"); return t && !t.hidden && new RegExp(src).test(t.textContent); }, re.source, { timeout: 8000 }).catch(() => {});
  else await page.waitForSelector("#ad-toast:not([hidden])", { timeout: 8000 });
  return page.textContent("#ad-toast");
};

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.fill('#ad-login-form [name="email"]', account.email);
  await page.fill('#ad-login-form [name="password"]', account.password);
  await page.click("#ad-login-submit");
  await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });

  /* ---------- Relances automatiques ---------- */

  await page.click("#ad-tab-mailing");
  await page.waitForSelector(".ad-ml-list", { timeout: 10000 });
  check("onglet Relances : #/relances, chiffres, 5 familles de relances",
        (await page.evaluate(() => location.hash)) === "#/relances" && (await page.locator(".ad-ml-group").count()) === 5 && /E-mails envoyés/.test(await page.textContent(".ad-stats")));
  const nudge = page.locator('.ad-ml-item[data-ml-key="selection_nudge"]');
  check("chaque relance : interrupteur, description, chiffres des 30 jours",
        await nudge.locator('input[data-ml-toggle]').isChecked() && /1 (envoyé|non parti)/.test(flat(await nudge.innerText())), flat(await nudge.innerText()));
  check("relances neuves coupées par défaut (client à revoir, offre de bienvenue, avis)",
        !(await page.isChecked('[data-ml-toggle="dormant"]')) && !(await page.isChecked('[data-ml-toggle="early_bird"]')) && !(await page.isChecked('[data-ml-toggle="review"]')));
  await shot("relances-liste");

  await page.click('[data-ml-toggle="dormant"]');
  check("interrupteur : activé, et retenu", /activée/.test(await toastText(/activée/)) &&
        select(`SELECT enabled FROM automation_settings WHERE photographer_id = '${pid}' AND key = 'dormant'`)[0]?.enabled === 1);
  await page.click('[data-ml-toggle="review"]');
  check("demande d'avis sans lien : refusée, l'éditeur s'ouvre pour le donner", /lien de votre page d'avis/.test(await toastText(/lien de votre page d'avis/)) && await page.isVisible('[data-ml-form="review"] [name="value"]'));
  await page.fill('[data-ml-form="review"] [name="value"]', "https://g.page/r/studio-lumiere/review");
  await page.click('[data-ml-form="review"] button[type="submit"]');
  await page.waitForTimeout(600);
  await page.click('[data-ml-toggle="review"]');
  await page.waitForTimeout(600);
  check("avec le lien : la demande d'avis s'active", await page.isChecked('[data-ml-toggle="review"]'));

  await page.click('[data-ml-edit="selection_nudge"]');
  await page.waitForSelector('[data-ml-form="selection_nudge"] [data-ml-frame]');
  await page.waitForTimeout(1200);
  const frameHtml = await page.locator('[data-ml-form="selection_nudge"] [data-ml-frame]').getAttribute("srcdoc");
  check("aperçu : l'e-mail tel que le client le verra (studio, prénom d'exemple, désinscription)",
        /Studio Lumière/.test(frameHtml || "") && /Sophie/.test(frameHtml || "") && /Se désinscrire/.test(frameHtml || ""));
  await page.click('[data-ml-form="selection_nudge"] [data-ml-lang="en"]');
  await page.waitForTimeout(300);
  check("textes en anglais déjà proposés", /photos/i.test(await page.inputValue('[data-ml-form="selection_nudge"] [name="subject"]')));
  await page.click('[data-ml-form="selection_nudge"] [data-ml-lang="fr"]');
  await page.fill('[data-ml-form="selection_nudge"] [name="subject"]', "{prenom}, vos photos sont prêtes");
  await page.click('[data-ml-form="selection_nudge"] [name="body"]');
  await page.click('[data-ml-form="selection_nudge"] [data-ml-var="{galerie}"]');
  check("variables insérées d'un clic dans le message", /\{galerie\}/.test(await page.inputValue('[data-ml-form="selection_nudge"] [name="body"]')));
  await page.click('[data-ml-form="selection_nudge"] [data-ml-test]');
  check("« M'envoyer un test » : part à l'adresse du photographe", (await toastText(/Test envoyé/)).includes(account.email));
  await page.click('[data-ml-form="selection_nudge"] button[type="submit"]');
  await page.waitForTimeout(800);
  const saved = JSON.parse(select(`SELECT texts FROM automation_settings WHERE photographer_id = '${pid}' AND key = 'selection_nudge'`)[0].texts);
  check("texte personnalisé enregistré (français), les autres langues gardées", saved.fr.subject === "{prenom}, vos photos sont prêtes" && Boolean(saved.en?.subject), JSON.stringify(saved).slice(0, 120));
  await shot("relances-editeur");

  /* ---------- Campagne ---------- */

  await page.click('[data-ml-view="campaigns"]');
  await page.waitForSelector(".ad-ml-templates");
  check("campagnes : 7 modèles et le message libre", (await page.locator(".ad-ml-template").count()) === 8);
  await page.click('[data-ml-template="noel"]');
  await page.waitForSelector("#ad-ml-campaign");
  await page.waitForFunction(() => /destinataire/.test(document.getElementById("ad-ml-count").textContent), null, { timeout: 8000 });
  check("par défaut : seuls les clients qui ont accepté (Sophie)", flat(await page.textContent("#ad-ml-count")) === "1 destinataire" && /Sophie/.test(await page.textContent("#ad-ml-sample")));
  await page.check('input[name="audience"][value="customers"]');
  await page.waitForFunction(() => /2 destinataires/.test(document.getElementById("ad-ml-count").textContent), null, { timeout: 8000 });
  check("« aussi les clients » : Paul s'ajoute", true);
  await page.check('input[name="sessionTypes"][value="mariage"]');
  await page.waitForFunction(() => /^1 destinataire/.test(document.getElementById("ad-ml-count").textContent), null, { timeout: 8000 });
  check("filtre « mariage » : Paul seul", /Paul/.test(await page.textContent("#ad-ml-sample")));
  await page.uncheck('input[name="sessionTypes"][value="mariage"]');
  await page.waitForFunction(() => /2 destinataires/.test(document.getElementById("ad-ml-count").textContent), null, { timeout: 8000 });
  await page.waitForTimeout(1500);
  const campFrame = await page.locator("#ad-ml-campaign [data-ml-frame]").getAttribute("srcdoc");
  check("aperçu de la campagne (modèle de Noël, bouton de réservation)", /Noël/.test(campFrame || "") && /Réserver/.test(campFrame || ""), String(campFrame).slice(0, 160));
  await shot("campagne-editeur");
  await page.click("[data-ml-send]");
  await page.waitForSelector("#ad-confirm-modal:not([hidden])");
  check("confirmation avant l'envoi, avec le nombre de clients", /2 clients/.test(await page.textContent("#ad-confirm-text")));
  await page.click("#ad-confirm-ok");
  await page.waitForFunction(() => /envoie/.test(document.getElementById("ad-toast").textContent), null, { timeout: 10000 });
  await page.waitForTimeout(1500);
  const campSends = select(`SELECT client_email, lang, status, subject FROM email_sends WHERE photographer_id = '${pid}' AND kind = 'campaign' ORDER BY client_email`);
  check("campagne partie : un e-mail par destinataire, dans sa langue",
        campSends.length === 2 && campSends.find((s) => s.client_email === "paul@example.com")?.lang === "en" && campSends.every((s) => s.status !== "queued" && s.subject), JSON.stringify(campSends));
  check("campagne marquée envoyée", select(`SELECT status, recipients FROM broadcasts WHERE photographer_id = '${pid}'`)[0]?.status === "sent");

  /* ---------- Désinscription par le lien de l'e-mail ---------- */

  const token = select(`SELECT token FROM email_sends WHERE photographer_id = '${pid}' AND kind = 'campaign' AND client_email = 'paul@example.com'`)[0].token;
  const unsubPage = await (await fetch(`${API}/api/m/u/${token}`)).text();
  await fetch(`${API}/api/m/u/${token}`, { method: "POST" });
  check("lien de désinscription : page en anglais pour Paul, puis désinscrit",
        /Unsubscribe/.test(unsubPage) && /Studio Lumière/.test(unsubPage) &&
        Boolean(select(`SELECT unsubscribed_at FROM clients WHERE photographer_id = '${pid}' AND email = 'paul@example.com'`)[0]?.unsubscribed_at));

  /* ---------- Contacts ---------- */

  await page.click("#ad-ml-back");
  await page.click('[data-ml-view="contacts"]');
  await page.waitForSelector("#ad-ml-csearch");
  const contactsText = flat(await page.textContent("#ad-ml-body"));
  check("contacts : Sophie « Accord, dans sa galerie », Paul désinscrit", /Accord .*dans sa galerie/.test(contactsText) && /1\s*Désinscrits/.test(contactsText) && (await page.locator('[data-ml-c="resub"]').count()) === 1, contactsText.slice(0, 200));
  await page.click('[data-ml-c="resub"]');
  await page.waitForSelector("#ad-confirm-modal:not([hidden])");
  await page.click("#ad-confirm-ok");
  await page.waitForTimeout(800);
  check("réinscription possible (à la demande du client)", !select(`SELECT unsubscribed_at FROM clients WHERE photographer_id = '${pid}' AND email = 'paul@example.com'`)[0].unsubscribed_at);
  await shot("relances-contacts");

  /* ---------- Adresse d'envoi ---------- */

  await page.click('[data-ml-view="sender"]');
  await page.waitForSelector("#ad-ml-sender");
  check("adresse d'envoi : expéditeur actuel « Studio via Holypixx »", /Studio Lumière via Holypixx/.test(await page.textContent("#ad-ml-body")));
  await page.fill('#ad-ml-sender [name="domain"]', "gmail.com");
  await page.click('#ad-ml-sender button[type="submit"]');
  check("domaine de messagerie public refusé", /nom de domaine à vous/.test(await toastText(/nom de domaine/)));

  /* ---------- Journal ---------- */

  await page.click('[data-ml-view="journal"]');
  await page.waitForSelector("#ad-ml-body table");
  check("journal : les envois, avec leur type", /Sélection pas commencée/.test(await page.textContent("#ad-ml-body")) && /Campagne · Séances de Noël/.test(await page.textContent("#ad-ml-body")));

  /* ---------- Fiche client ---------- */

  await page.goto(`${BASE}/#/clients/sophie@example.com`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".ad-cl-consent");
  check("fiche : « Offres du studio » montre l'accord", /Accord/.test(await page.textContent(".ad-cl-consent")));
  await page.click("#ad-cl-write");
  await page.waitForSelector("#ad-ml-direct:not([hidden])");
  await page.fill('#ad-ml-direct-form [name="subject"]', "Votre album");
  await page.fill('#ad-ml-direct-form [name="body"]', "Bonjour Sophie,\n\nVotre album est prêt !");
  await page.click('#ad-ml-direct-form button[type="submit"]');
  check("« Écrire » : message envoyé depuis Holypixx, au nom du studio", /Message envoyé/.test(await toastText(/Message envoyé/)) &&
        select(`SELECT COUNT(*) AS n FROM email_sends WHERE photographer_id = '${pid}' AND kind = 'direct' AND subject = 'Votre album'`)[0].n === 1);

  // Téléphone : rien ne déborde.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/#/relances`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-ml-view="automations"]');
  await page.click('[data-ml-view="automations"]');
  await page.waitForSelector(".ad-ml-list");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : pas de débordement horizontal", overflow <= 1, overflow + " px");
  await shot("relances-mobile");
} catch (err) {
  check("déroulé sans exception", false, err.message.split("\n")[0] + " @ " + (err.stack || "").split("\n").find((l) => l.includes("relances.test")));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "erreur.png"), fullPage: true }).catch(() => {});
}

check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
await browser.close();
for (const s of [sA, sB]) await client.deleteGallery(s).catch(() => {});

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
