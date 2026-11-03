// HD livrées reliées à leur épreuve (delivery.js, shop.js) sur une vraie
// base SQLite (schema.sql) : lien, exclusivité, retrait, numéro affiché,
// fichier supprimé, et règle des photos proposées en tirage.
//
//   node tests/hddelivery.test.mjs

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { handleDeliveryAdmin, deliveryForAdmin } from "../src/delivery.js";
import { isPrintable } from "../src/shop.js";

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
const files = new Map([["g1/delivery/dlv_1", new Uint8Array([1, 2, 3])]]);
const env = { DB: fakeD1(db), TILES: { get: async (k) => (files.has(k) ? { body: files.get(k), size: 3 } : null), delete: async (k) => files.delete(k) } };
const t = 1_700_000_000;
const run = (sql, ...args) => db.prepare(sql).run(...args);
run("INSERT INTO photographers (id, email, password_hash, password_salt, created_at) VALUES ('ph', 'a@x.be', 'x', 'x', ?)", t);
for (const g of ["g1", "g2"]) {
  run("INSERT INTO galleries (id, slug, title, photographer_id, password_hash, password_salt, created_at) VALUES (?, ?, 'T', 'ph', 'x', 'x', ?)", g, g, t);
}
for (let i = 0; i < 3; i++) {
  run("INSERT INTO photos (id, gallery_id, width, height, cols, rows, position, has_original, created_at) VALUES (?, 'g1', 1600, 1067, 4, 3, ?, 1, ?)", `p${i}`, i, t);
}
run("INSERT INTO photos (id, gallery_id, width, height, cols, rows, position, created_at) VALUES ('other', 'g2', 10, 10, 1, 1, 0, ?)", t);
for (const [id, g] of [["dlv_1", "g1"], ["dlv_2", "g1"], ["dlv_x", "g2"]]) {
  run("INSERT INTO delivery_files (id, gallery_id, name, size, crc32, created_at) VALUES (?, ?, ?, 3, 0, ?)", id, g, id + ".jpg", t);
}
const g1 = db.prepare("SELECT * FROM galleries WHERE id = 'g1'").get();
const req = (method, body) => new Request("https://x/api", { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
const link = (fileId, body) => handleDeliveryAdmin(req("POST", body), env, g1, ["files", fileId, "link"]);
const photo = (id) => db.prepare("SELECT * FROM photos WHERE id = ?").get(id);
const geometry = { width: 1067, height: 1600, cols: 3, rows: 4, previewWidth: 600, previewHeight: 900 };

check("HD d'une autre galerie : refusée", (await link("dlv_x", { photoId: "p0", ...geometry })).status === 404);
check("épreuve d'une autre galerie : refusée", (await link("dlv_1", { photoId: "other", ...geometry })).status === 404);
check("dimensions illisibles : refusées", (await link("dlv_1", { photoId: "p0", width: 0 })).status === 400);
let res = await link("dlv_1", { photoId: "p1", ...geometry });
check("HD reliée : dimensions de la retouche, lien enregistré",
      res.status === 200 && photo("p1").width === 1067 && photo("p1").cols === 3 && photo("p1").preview_height === 900 && photo("p1").delivery_file_id === "dlv_1");
let admin = await deliveryForAdmin(env, g1);
check("livraison : la HD indique la photo n° 2 qu'elle remplace", admin.files[0].photoId === "p1" && admin.files[0].photoNumber === 2 && admin.files[1].photoId === "");
res = await link("dlv_1", { photoId: "p2", ...geometry });
check("relier ailleurs : l'ancienne épreuve n'est plus reliée", photo("p1").delivery_file_id === "" && photo("p2").delivery_file_id === "dlv_1");
res = await link("dlv_1", { photoId: "" });
check("{ photoId: \"\" } : lien retiré", res.status === 200 && photo("p2").delivery_file_id === "");
await link("dlv_2", { photoId: "p0", ...geometry });
res = await handleDeliveryAdmin(req("GET"), env, g1, ["files", "dlv_1"]);
check("l'outil d'administration relit la HD", res.status === 200 && (await res.arrayBuffer()).byteLength === 3);
await handleDeliveryAdmin(req("DELETE"), env, g1, ["files", "dlv_2"]);
check("HD supprimée : le lien disparaît, la photo garde ses aperçus retouchés", photo("p0").delivery_file_id === "" && photo("p0").width === 1067);

check("tirages : sans HD livrée, toute photo avec fichier d'impression", isPrintable({ has_original: 1, delivery_file_id: "" }, false));
check("tirages : HD livrées → seulement les photos reliées",
      isPrintable({ has_original: 1, delivery_file_id: "dlv_1" }, true) && !isPrintable({ has_original: 1, delivery_file_id: "" }, true));
check("tirages : jamais sans fichier d'impression", !isPrintable({ has_original: 0, delivery_file_id: "dlv_1" }, true));

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
