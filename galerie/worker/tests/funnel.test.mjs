// Vérifie le parcours d'inscription sans réseau : lecture des évènements
// (étapes, pages, sources, robots), compteurs anonymes par jour, page et
// source d'arrivée gardées à l'inscription, puis la vue propriétaire sur une
// vraie base SQLite (schema.sql) : haut du parcours, comptes de la période
// jusqu'au premier client, répartition par source et par page.
//
//   node tests/funnel.test.mjs

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  readFunnelEvent, cleanSource, cleanPage, signupAttribution, recordFunnelEvent, countFunnelEvent, funnelForOwner, dayOf,
} from "../src/funnel.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}
const DAY = 86400;

/* ---------- Fonctions pures ---------- */

check("étape, page et source lues ; source vide = accès direct",
      JSON.stringify(readFunnelEvent({ step: "visit", page: "mariage", source: "" }).event) === JSON.stringify({ step: "visit", page: "mariage", source: "direct" }));
check("étape inconnue ignorée, corps absent refusé",
      readFunnelEvent({ step: "achat" }).ignore === true && Boolean(readFunnelEvent(null).error));
check("robots écartés (Googlebot, navigateur sans écran, aperçu Facebook)",
      ["Mozilla/5.0 (compatible; Googlebot/2.1)", "Mozilla/5.0 HeadlessChrome/120", "facebookexternalhit/1.1"]
        .every((ua) => readFunnelEvent({ step: "visit" }, ua).ignore === true) &&
      Boolean(readFunnelEvent({ step: "visit" }, "Mozilla/5.0 (Macintosh) Safari/605").event));
check("source de campagne propre gardée, valeur farfelue rangée en « autre site »",
      cleanSource("Newsletter-Oct") === "newsletter-oct" && cleanSource("<script>") === "autre-site" && cleanSource("x".repeat(31)) === "autre-site");
check("page inconnue vidée", cleanPage("mariage") === "mariage" && cleanPage("../admin") === "");
check("inscription : page et source gardées ; lien direct vers l'inscription = accès direct",
      JSON.stringify(signupAttribution({ signupPage: "contrat", signupSource: "google" })) === JSON.stringify({ page: "contrat", source: "google" }) &&
      JSON.stringify(signupAttribution({})) === JSON.stringify({ page: "", source: "direct" }));

/* ---------- Base SQLite ---------- */

function fakeD1(db) {
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes) } };
    },
  });
  return { prepare: (sql) => statement(sql) };
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(":memory:");
db.exec(await readFile(join(root, "schema.sql"), "utf8"));
const env = { DB: fakeD1(db), OWNER_EMAIL: "proprio@exemple.be" };

const t0 = Date.parse("2026-10-20T12:00:00Z") / 1000;

// Haut du parcours : 10 visites Google sur la page mariage, 4 en direct sur
// l'accueil ; 3 clics depuis mariage, 1 depuis l'accueil ; 3 écrans
// d'inscription. Une visite d'il y a 40 jours, hors période de 30 jours.
for (let i = 0; i < 10; i++) await countFunnelEvent(env, { step: "visit", page: "mariage", source: "google" }, t0);
for (let i = 0; i < 4; i++) await countFunnelEvent(env, { step: "visit", page: "accueil", source: "direct" }, t0 - DAY);
for (let i = 0; i < 3; i++) await countFunnelEvent(env, { step: "signup_click", page: "mariage", source: "google" }, t0);
await countFunnelEvent(env, { step: "signup_click", page: "accueil", source: "direct" }, t0);
for (let i = 0; i < 3; i++) await countFunnelEvent(env, { step: "signup_view", page: "mariage", source: "google" }, t0);
await countFunnelEvent(env, { step: "visit", page: "accueil", source: "direct" }, t0 - 40 * DAY);

const rows = db.prepare("SELECT * FROM funnel_daily ORDER BY day, step").all();
check("une ligne par jour, étape, page et source ; le compteur s'incrémente",
      rows.length === 6 && rows.find((r) => r.step === "visit" && r.page === "mariage").count === 10, `${rows.length} lignes`);
check("aucune donnée personnelle dans les compteurs (jour, étape, page, source, nombre)",
      Object.keys(rows[0]).sort().join(",") === "count,day,page,source,step");

// Envoi du navigateur : text/plain (sendBeacon), robot ignoré.
const beacon = (body, ua = "Mozilla/5.0 Safari") => new Request("https://w.example/api/public/funnel", {
  method: "POST", headers: { "content-type": "text/plain", "user-agent": ua }, body,
});
const ok = await recordFunnelEvent(beacon(JSON.stringify({ step: "visit", page: "contrat", source: "instagram" })), env, t0);
await recordFunnelEvent(beacon(JSON.stringify({ step: "visit", page: "contrat", source: "instagram" }), "Googlebot/2.1"), env, t0);
const bad = await recordFunnelEvent(beacon("pas du json"), env, t0);
check("balise du site comptée (text/plain), robot non compté, corps illisible refusé",
      ok.status === 200 && bad.status === 400 &&
      db.prepare("SELECT count FROM funnel_daily WHERE page = 'contrat'").get().count === 1);

// Comptes : la propriétaire (exclue), 3 comptes de la période, 1 ancien.
let n = 0;
function addPhotographer(fields = {}) {
  const id = "ph_" + ++n;
  const row = { id, email: `${id}@exemple.be`, password_hash: "x", password_salt: "x", created_at: t0, ...fields };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO photographers (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c]));
  return id;
}
function addGallery(photographerId, { demo = 0, photo = false, clientLogin = false } = {}) {
  const id = "g_" + ++n;
  db.prepare(`INSERT INTO galleries (id, slug, title, photographer_id, password_hash, password_salt, created_at, demo)
              VALUES (?, ?, 'Séance', ?, 'x', 'x', ?, ?)`).run(id, id, photographerId, t0, demo);
  if (photo) db.prepare("INSERT INTO photos (id, gallery_id, width, height, cols, rows, position, created_at) VALUES (?, ?, 100, 100, 1, 1, 0, ?)").run("p_" + id, id, t0);
  if (clientLogin) db.prepare("INSERT INTO access_log (gallery_id, event, ts) VALUES (?, 'login', ?)").run(id, t0);
  return id;
}

addPhotographer({ email: "proprio@exemple.be", signup_page: "mariage", signup_source: "google" });
const a = addPhotographer({ signup_page: "mariage", signup_source: "google" });
const b = addPhotographer({ signup_page: "mariage", signup_source: "google" });
const c = addPhotographer({ signup_page: "accueil", signup_source: "direct" });
addPhotographer({ created_at: t0 - 60 * DAY, signup_page: "accueil", signup_source: "direct" });
// Compte de la période créé avant la mise en place de la mesure (sans source).
addPhotographer({ created_at: t0 - DAY });
// a : galerie, photos, client venu, abonnée (Stripe) ; b : seulement la
// démo (qui ne compte pas) ; c : galerie vide, essai pris.
addGallery(a, { photo: true, clientLogin: true });
db.prepare("UPDATE photographers SET plan = 'pro', plan_status = 'active', plan_started_at = ?, stripe_subscription_id = 'sub_1' WHERE id = ?").run(t0, a);
addGallery(b, { demo: 1, photo: true, clientLogin: true });
addGallery(c);
db.prepare("UPDATE photographers SET trial_used_at = ? WHERE id = ?").run(t0, c);

const view = await funnelForOwner(env, { days: 30, at: t0 });
const count = (key) => view.steps.find((s) => s.key === key).count;
check("haut du parcours sur 30 jours : 15 visiteurs, 4 clics, 3 écrans d'inscription (la visite d'il y a 40 jours exclue)",
      count("visit") === 15 && count("signup_click") === 4 && count("signup_view") === 3,
      view.steps.slice(0, 3).map((s) => s.count).join(" → "));
check("comptes de la période : 3 (propriétaire, ancien compte et compte d'avant la mesure exclus)", count("signup") === 3, count("signup"));
check("suite : 2 premières galeries (démo exclue), 1 avec photos, 1 ouverte par un client, 2 formules choisies dont 1 payante",
      count("gallery") === 2 && count("photos") === 1 && count("client") === 1 && count("subscribed") === 2 && view.paying === 1,
      view.steps.slice(4).map((s) => `${s.key}=${s.count}`).join(", ") + `, payants=${view.paying}`);
const google = view.bySource.find((s) => s.id === "google");
check("par source : Google 10 visiteurs, 3 clics, 2 comptes, 1 jusqu'au client ; libellé lisible",
      google.visits === 10 && google.clicks === 3 && google.signups === 2 && google.activated === 1 && google.label === "Google");
const mariage = view.byPage.find((p) => p.id === "mariage");
check("par page : « Galerie photo de mariage » en tête avec 2 comptes",
      view.byPage[0].id === "mariage" && mariage.signups === 2 && mariage.label === "Galerie photo de mariage");
check("période : 7, 30, 90 ou 365 jours ; autre valeur ramenée à 30",
      (await funnelForOwner(env, { days: 7, at: t0 })).days === 7 && (await funnelForOwner(env, { days: "abc", at: t0 })).days === 30 &&
      view.since === dayOf(t0 - 29 * DAY));
const week = await funnelForOwner(env, { days: 7, at: t0 + 10 * DAY });
check("sur 7 jours, dix jours plus tard : plus rien dans la période", week.steps.every((s) => s.count === 0));

const failed = checks.filter((x) => !x.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
