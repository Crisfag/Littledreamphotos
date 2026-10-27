// Vérifie sans réseau le pack « toutes les photos de l'enfant » et la liste
// de prénoms collée : sur une vraie base SQLite (schema.sql) avec un faux
// Stripe, le pack devient une ligne par portrait (prix réparti au centime
// près, groupe exclu), un seul article chez Stripe et chez la famille, et
// ses fichiers restent téléchargeables un à un ; deux tirages ordinaires du
// même produit ne sont jamais fusionnés.
//
//   node tests/schoolpack.test.mjs

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { familyCheckout, shopForFamily, groupPackLines } from "../src/schoolshop.js";
import { parseNameList } from "../src/school.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

/* ---------- Liste de prénoms ---------- */

const names = parseNameList("Léo\nEmma Martin\n\nJules;Dupont\nInès\tLeroy\r\n  Noé  ");
check("liste de prénoms : une ligne par enfant, « ; » et tabulation de tableur, ligne vide gardée vide",
      JSON.stringify(names) === JSON.stringify(["Léo", "Emma Martin", "", "Jules Dupont", "Inès Leroy", "Noé"]), JSON.stringify(names));
check("« Martin, Léo » (virgule de tableur) devient « Martin Léo »", parseNameList("Martin, Léo")[0] === "Martin Léo");

/* ---------- Regroupement des lignes ---------- */

const grouped = groupPackLines([
  { id: "a", order_id: "o", child_id: "c1", product_id: "pack", quantity: 1, price_cents: 667, pack_size: 3 },
  { id: "b", order_id: "o", child_id: "c1", product_id: "pack", quantity: 1, price_cents: 667, pack_size: 3 },
  { id: "c", order_id: "o", child_id: "c1", product_id: "pack", quantity: 1, price_cents: 666, pack_size: 3 },
  { id: "d", order_id: "o", child_id: "c1", product_id: "tirage", quantity: 1, price_cents: 800, pack_size: 0 },
  { id: "e", order_id: "o", child_id: "c1", product_id: "tirage", quantity: 1, price_cents: 800, pack_size: 0 },
]);
check("un pack redevient un article (20,00 €, 3 fichiers) ; deux tirages ordinaires restent deux lignes",
      grouped.length === 3 && grouped[0].price_cents === 2000 && grouped[0].line_ids.join() === "a,b,c" && grouped[1].id === "d" && grouped[2].id === "e");

/* ---------- Commande sur une vraie base ---------- */

function fakeD1(db) {
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  return { prepare: (sql) => statement(sql), batch: async (list) => { for (const st of list) await st.run(); } };
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(":memory:");
db.exec(await readFile(join(root, "schema.sql"), "utf8"));
const env = { DB: fakeD1(db), STRIPE_SECRET_KEY: "sk_test_faux", PUBLIC_SITE_ORIGIN: "https://www.holypixx.com" };
const t = 1_800_000_000;
const run = (sql, ...args) => db.prepare(sql).run(...args);
run("INSERT INTO photographers (id, email, password_hash, password_salt, created_at, stripe_account_id, stripe_charges_enabled, plan, plan_status) VALUES ('ph', 'p@x.be', 'x', 'x', ?, 'acct_1', 1, 'studio', 'active')", t);
run("INSERT INTO schools (id, photographer_id, kind, name, created_at) VALUES ('sc', 'ph', 'creche', 'Les Petits Pas', ?)", t);
run("INSERT INTO school_years (id, school_id, label, status, created_at) VALUES ('yr', 'sc', 'Noël 2026', 'open', ?)", t);
run("INSERT INTO galleries (id, slug, title, photographer_id, password_hash, password_salt, kind, created_at) VALUES ('gal', 'gal', 'Groupe', 'ph', 'x', 'x', 'school', ?)", t);
run("INSERT INTO school_groups (id, year_id, name, gallery_id, created_at) VALUES ('grp', 'yr', 'Les Lapins', 'gal', ?)", t);
run("INSERT INTO school_children (id, group_id, number, first_name, created_at) VALUES ('ch', 'grp', 1, 'Léo', ?)", t);
for (const [id, pos, child, role] of [["p1", 0, "ch", ""], ["p2", 1, "ch", ""], ["p3", 2, "ch", ""], ["pg", 3, "", "group"]]) {
  run("INSERT INTO photos (id, gallery_id, width, height, cols, rows, position, child_id, school_role, created_at) VALUES (?, 'gal', 1, 1, 1, 1, ?, ?, ?, ?)", id, pos, child, role, t);
}
run("INSERT INTO school_products (id, year_id, kind, scope, name, description, price_cents, sort, created_at) VALUES ('pack', 'yr', 'numerique', 'all', 'Toutes les photos en numérique', 'Tous les portraits HD', 2000, 0, ?)", t);
run("INSERT INTO school_products (id, year_id, kind, scope, name, price_cents, sort, created_at) VALUES ('tir', 'yr', 'tirage', 'portrait', 'Tirage 13×18', 800, 1, ?)", t);
run("INSERT INTO families (id, email, created_at) VALUES ('fam', 'parent@x.be', ?)", t);
run("INSERT INTO family_children (family_id, child_id, added_at) VALUES ('fam', 'ch', ?)", t);

let stripeBody = null;
globalThis.fetch = async (url, init) => {
  if (!String(url).includes("/checkout/sessions")) throw new Error("Appel inattendu : " + url);
  stripeBody = new URLSearchParams(init.body);
  return { ok: true, status: 200, json: async () => ({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" }) };
};
const family = { id: "fam", email: "parent@x.be" };
const checkout = (items) => familyCheckout(new Request("https://w/api/family/checkout", { method: "POST", body: JSON.stringify({ items }) }), env, family);

const res = await checkout([
  { childId: "ch", productId: "pack", photoId: "*", quantity: 1 },
  { childId: "ch", productId: "tir", photoId: "p2", quantity: 2 },
]);
const out = await res.json();
check("commande lancée chez Stripe", res.status === 200 && out.url.includes("checkout.stripe.test"), res.status + " " + (out.error || ""));
const lines = db.prepare("SELECT * FROM school_order_lines WHERE product_id = 'pack' ORDER BY price_cents DESC, photo_id").all();
check("le pack devient 3 lignes (les 3 portraits, pas la photo de groupe), 6,67 + 6,67 + 6,66 = 20,00 €",
      lines.length === 3 && lines.map((l) => l.photo_id).sort().join() === "p1,p2,p3" && lines.reduce((n, l) => n + l.price_cents, 0) === 2000 &&
      lines.every((l) => l.pack_size === 3 && l.kind === "numerique"), lines.map((l) => `${l.photo_id}:${l.price_cents}`).join(", "));
const order = db.prepare("SELECT * FROM school_orders").get();
check("montant de la commande : 20 € + 2 × 8 € = 36 €", order.amount_cents === 3600, order.amount_cents);
check("chez Stripe : un seul article pour le pack, avec le nombre de photos",
      stripeBody.get("line_items[0][price_data][product_data][name]") === "Toutes les photos en numérique (3 photos) — Léo" &&
      stripeBody.get("line_items[0][price_data][unit_amount]") === "2000" && stripeBody.get("line_items[1][quantity]") === "2",
      stripeBody.get("line_items[0][price_data][product_data][name]"));

run("UPDATE school_orders SET status = 'paid', paid_at = ?", t);
const view = await shopForFamily(env, family, [{ id: "ch", yearId: "yr" }]);
const famLines = view.orders[0].lines;
const packLine = famLines.find((l) => l.pack);
check("chez la famille : le pack est un seul article, 3 fichiers à télécharger un à un",
      famLines.length === 2 && packLine.pack === 3 && packLine.lineIds.length === 3 && packLine.priceCents === 2000);

const pochettePack = await checkout([{ childId: "ch", productId: "tir", photoId: "pg", quantity: 1 }]);
check("garde-fou inchangé : une photo de groupe ne passe pas pour un portrait", pochettePack.status === 400);
run("UPDATE photos SET child_id = '' WHERE child_id = 'ch'");
const empty = await checkout([{ childId: "ch", productId: "pack", photoId: "*", quantity: 1 }]);
check("pack sans aucune photo : refusé avec un message clair", empty.status === 400 && (await empty.json()).error === "Aucune photo pour ce pack.");

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
