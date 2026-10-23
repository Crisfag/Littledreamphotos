// Vérifie les statistiques des séances sans réseau : type deviné d'après le
// titre, périodes, calculs (séances par type, sélection, forfaits,
// suppléments, panier), puis la lecture sur une vraie base SQLite
// (schema.sql) : démos et groupes scolaires exclus, type choisi prioritaire
// sur le type deviné, réservations par prestation.
//
//   node tests/insights.test.mjs

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { guessSessionType, cleanSessionType, periodStart, computeInsights, insightsForAdmin, setSessionType } from "../src/insights.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}
const DAY = 86400;

/* ---------- Type deviné ---------- */

const guesses = {
  "Séance grossesse Julie": "grossesse",
  "Maternité — Emma": "grossesse",
  "Naissance de Léo": "naissance",
  "Nouveau-né Martin": "naissance",
  "Bébé 6 mois": "bebe",
  "Smash cake Lou": "smash",
  "Mini-séance de Noël en famille": "mini",
  "Famille Rulmont": "famille",
  "Mariage Sophie & Tom": "mariage",
  "Baptême de Jules": "bapteme",
  "Portrait LinkedIn": "portrait",
  "Galerie Dupont": "",
};
const wrong = Object.entries(guesses).filter(([title, key]) => guessSessionType(title) !== key);
check("type deviné d'après le titre (grossesse, naissance, bébé, smash, mini-séance avant famille…)", wrong.length === 0,
      wrong.map(([t]) => `${t} → ${guessSessionType(t)}`).join(", "));
check("type choisi : seules les clés connues passent", cleanSessionType("Naissance") === "naissance" && cleanSessionType("licorne") === "");
const t0 = Date.parse("2026-10-23T12:00:00Z") / 1000;
check("périodes : 3 mois, année en cours, tout",
      new Date(periodStart("3m", t0) * 1000).toISOString().slice(0, 10) === "2026-07-23" &&
      new Date(periodStart("year", t0) * 1000).toISOString().slice(0, 10) === "2026-01-01" && periodStart("all", t0) === 0);

/* ---------- Calculs ---------- */

const s = (type, included, selected, supplementCents = 0, printCents = 0, extra = {}) =>
  ({ slug: type + Math.random(), title: type, type, guessed: false, included, extraPriceCents: 1500, photos: 40, selected, paidExtras: 0, supplementCents, printCents, validated: true, ...extra });
const sessions = [
  s("naissance", 10, 14, 6000), s("naissance", 10, 10), s("naissance", 15, 18, 4500, 3000),
  s("grossesse", 10, 10), s("grossesse", 10, 12, 3000),
  s("famille", 15, 15, 0, 2500),
  s("", null, 8),
];
const r = computeInsights(sessions);
const naissance = r.byType.find((t) => t.key === "naissance");
check("séances par type : naissance en tête (3 sur 7)", r.byType[0].key === "naissance" && naissance.count === 3 && Math.abs(naissance.share - 3 / 7) < 1e-9);
check("naissance : 14 photos choisies en moyenne, forfait moyen 11,7, suppléments 2 fois sur 3 (3,5 en moyenne)",
      naissance.avgSelected === 14 && naissance.avgIncluded === 11.7 && Math.abs(naissance.extrasRate - 2 / 3) < 1e-9 && naissance.avgExtras === 3.5,
      JSON.stringify({ sel: naissance.avgSelected, inc: naissance.avgIncluded, rate: naissance.extrasRate, extras: naissance.avgExtras }));
check("naissance : 135 € encaissés, 45 € par séance, panier moyen 67,50 € (2 séances qui achètent)",
      naissance.revenueCents === 13500 && naissance.avgRevenueCents === 4500 && naissance.basketCents === 6750 && naissance.buyers === 2);
check("forfaits : 10 photos le plus fréquent (4 séances), puis 15, « sans forfait » en dernier",
      r.byPackage[0].included === 10 && r.byPackage[0].count === 4 && r.byPackage[1].included === 15 && r.byPackage.at(-1).included === null);
check("forfait 10 : suppléments 2 fois sur 4, surtout en naissance",
      r.byPackage[0].extrasRate === 0.5 && r.byPackage[0].topType === "naissance");
check("à retenir : plus demandée naissance, moins pratiquée famille, meilleur panier naissance, plus de suppléments naissance, forfait 10",
      r.highlights.mostRequested === "naissance" && r.highlights.leastPractised === "famille" && r.highlights.bestBasket === "naissance" &&
      r.highlights.mostExtras === "naissance" && r.highlights.topPackage === 10, JSON.stringify(r.highlights));
check("une séance sans type est comptée à part et à classer", r.byType.some((t) => t.key === "") && r.toClassify === 1);
check("aucune séance : rien ne casse", computeInsights([]).total === 0 && computeInsights([]).highlights.mostRequested === null);

/* ---------- Base SQLite ---------- */

function fakeD1(db) {
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  return { prepare: (sql) => statement(sql) };
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(":memory:");
db.exec(await readFile(join(root, "schema.sql"), "utf8"));
const env = { DB: fakeD1(db) };
db.prepare("INSERT INTO photographers (id, email, password_hash, password_salt, created_at) VALUES ('ph_1', 'a@b.be', 'x', 'x', ?)").run(t0);
db.prepare("INSERT INTO photographers (id, email, password_hash, password_salt, created_at) VALUES ('ph_2', 'c@d.be', 'x', 'x', ?)").run(t0);
let n = 0;
function gallery(fields) {
  const id = "g_" + ++n;
  const row = { id, slug: "s" + n, title: "Séance", photographer_id: "ph_1", password_hash: "x", password_salt: "x", created_at: t0 - DAY, ...fields };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO galleries (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c]));
  return id;
}
function photos(galleryId, total, selected) {
  for (let i = 0; i < total; i++) {
    db.prepare("INSERT INTO photos (id, gallery_id, width, height, cols, rows, position, selected, created_at) VALUES (?, ?, 1, 1, 1, 1, ?, ?, ?)")
      .run(`${galleryId}_p${i}`, galleryId, i, i < selected ? 1 : 0, t0);
  }
}
function payment(galleryId, kind, amount, extra = 0, status = "paid") {
  db.prepare("INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, status, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("pay_" + ++n, galleryId, "cs_" + n, extra, amount, status, kind, t0);
}

const g1 = gallery({ title: "Naissance de Léo", included_photos: 10 });
photos(g1, 30, 13); payment(g1, "supplement", 4500, 3); payment(g1, "print", 2000); payment(g1, "supplement", 9900, 6, "pending");
const g2 = gallery({ title: "Galerie Dupont", session_type: "grossesse", included_photos: 10 });
photos(g2, 25, 10);
const g3 = gallery({ title: "Famille Martin", session_type: "naissance" }); // choisi l'emporte sur le titre
photos(g3, 20, 5);
gallery({ title: "Démo", demo: 1 });
gallery({ title: "Groupe CP", kind: "school" });
gallery({ title: "Naissance ancienne", created_at: t0 - 400 * DAY });
gallery({ title: "Naissance d'un autre", photographer_id: "ph_2" });
db.prepare(`INSERT INTO bookings (id, photographer_id, slot_id, offer_id, offer_title, starts_at, duration_min, price_cents, client_name, client_email, status, created_at)
            VALUES ('b1', 'ph_1', 'sl1', 'o1', 'Séance naissance', ?, 60, 25000, 'X', 'x@y.be', 'confirmed', ?)`).run(t0 - DAY, t0);

const view = await (await insightsForAdmin(env, "ph_1", "12m", t0)).json();
check("séances de la période : 3 (démo, groupe scolaire, ancienne et autre photographe exclues)", view.total === 3, view.total);
const nai = view.byType.find((t) => t.key === "naissance");
check("type choisi prioritaire : « Famille Martin » classée naissance ; « Naissance de Léo » devinée",
      nai.count === 2 && nai.guessed === 1 && view.byType.find((t) => t.key === "grossesse").count === 1);
check("argent : seuls les paiements réglés comptent (45 € suppléments + 20 € tirages)",
      nai.supplementCents === 4500 && nai.printCents === 2000 && view.overall.revenueCents === 6500);
check("à classer : la séance devinée, avec son type proposé",
      view.sessions.length === 1 && view.sessions[0].title === "Naissance de Léo" && view.sessions[0].type === "naissance" && view.sessions[0].guessed);
check("réservations par prestation", view.bookings.length === 1 && view.bookings[0].title === "Séance naissance" && view.bookings[0].count === 1);

const req = (body) => new Request("https://w/x", { method: "POST", body: JSON.stringify(body) });
const set = await setSessionType(req({ sessionType: "naissance" }), env, "ph_1", "s1");
const bad = await setSessionType(req({ sessionType: "licorne" }), env, "ph_1", "s1");
const other = await setSessionType(req({ sessionType: "famille" }), env, "ph_2", "s1");
check("classer une séance : enregistré, type inconnu refusé, galerie d'un autre introuvable",
      set.status === 200 && bad.status === 400 && other.status === 404 &&
      db.prepare("SELECT session_type FROM galleries WHERE slug = 's1'").get().session_type === "naissance");
const after = await (await insightsForAdmin(env, "ph_1", "12m", t0)).json();
check("une fois classée, la séance n'est plus « à classer »", after.sessions.length === 0 && after.toClassify === 0);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
