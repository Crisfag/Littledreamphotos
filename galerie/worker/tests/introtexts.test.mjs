// Vérifie sur une vraie base SQLite (schema.sql) les textes
// d'accompagnement enregistrés : enregistrer, nom par défaut, pas de
// doublon, ordre (le dernier utilisé d'abord), retrait, limites,
// cloisonnement entre photographes.
//
//   node tests/introtexts.test.mjs

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { getIntroTexts, saveIntroText, touchIntroText, deleteIntroText, defaultLabel } from "../src/introtexts.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}
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
const t = Math.floor(Date.now() / 1000);
for (const id of ["ph", "ph2"]) {
  db.prepare("INSERT INTO photographers (id, email, password_hash, password_salt, created_at) VALUES (?, ?, 'x', 'x', ?)").run(id, `${id}@x.be`, t);
}
const post = (body) => new Request("https://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const list = async (ph) => (await (await getIntroTexts(env, ph)).json()).texts;

const NOEL = "Merci pour cette jolie séance de Noël ! Choisissez vos photos préférées en cliquant sur le cœur, puis validez votre sélection.";
let res = await saveIntroText(post({ body: "   " }), env, "ph");
check("texte vide : refusé", res.status === 400);
res = await saveIntroText(post({ body: NOEL }), env, "ph");
let body = await res.json();
check("texte enregistré, nommé par son début", res.status === 201 && body.text.label === defaultLabel(NOEL) && body.text.label.endsWith("…") && body.text.label.length <= 46, body.text.label);
res = await saveIntroText(post({ body: "Merci pour ce beau mariage !", label: "  Mariage  " }), env, "ph");
const mariage = (await res.json()).text;
check("nom choisi par le photographe, espaces retirés", mariage.label === "Mariage");
res = await saveIntroText(post({ body: NOEL, label: "Noël 2026" }), env, "ph");
check("même texte enregistré deux fois : pas de doublon, le nom est mis à jour", res.status === 200 && (await list("ph")).length === 2 && (await list("ph")).some((x) => x.label === "Noël 2026"));
const noel = (await list("ph")).find((x) => x.label === "Noël 2026");

db.prepare("UPDATE intro_texts SET used_at = ? WHERE id = ?").run(t - 100, noel.id);
check("le dernier utilisé vient en premier", (await list("ph"))[0].label === "Mariage");
db.prepare("UPDATE intro_texts SET used_at = ? WHERE id = ?").run(t - 50, mariage.id);
await touchIntroText(env, "ph", noel.id);
check("choisi dans le menu : il remonte en tête", (await list("ph"))[0].label === "Noël 2026");

check("un autre photographe ne voit rien", (await list("ph2")).length === 0);
res = await touchIntroText(env, "ph2", noel.id);
check("ni ne peut s'en servir", res.status === 404);
res = await deleteIntroText(env, "ph2", noel.id);
check("ni le supprimer", res.status === 404 && (await list("ph")).length === 2);

res = await deleteIntroText(env, "ph", mariage.id);
check("retiré du menu", res.status === 200 && (await res.json()).texts.length === 1);

res = await saveIntroText(post({ body: "x".repeat(900) }), env, "ph");
check("texte trop long : coupé à 600 caractères comme celui de la galerie", (await res.json()).text.body.length === 600);
for (let i = 0; i < 60; i++) await saveIntroText(post({ body: `Texte ${i}` }), env, "ph2");
res = await saveIntroText(post({ body: "Un de trop" }), env, "ph2");
check("50 textes au maximum, avec explication", res.status === 400 && /50 textes/.test((await res.json()).error) && (await list("ph2")).length === 50);

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
