// Salle de presse (press.js, pressfile.js) sur une vraie base SQLite
// (schema.sql) : création, HD et légendes lues à l'envoi, validation par le
// commanditaire, embargo, publics (presse, sponsor filtré), licence acceptée
// et gardée, droit à l'image, fichiers livrés avec crédit/licence/refus IA,
// ZIP valide (CRC calculés sans relire les fichiers), journal, accréditation,
// nouvelle version de licence.
//
//   node tests/presse.test.mjs

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import zlib from "node:zlib";
import { handlePressAdmin, handlePressPublic } from "../src/press.js";
import { headerMap, readPressMeta } from "../../tools/lib/pressmeta.mjs";

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
async function bytesOf(body) {
  if (body instanceof Uint8Array) return body;
  return new Uint8Array(await new Response(body).arrayBuffer());
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(":memory:");
db.exec(await readFile(join(root, "schema.sql"), "utf8"));
const store = new Map();
const streamOf = (bytes) => new Response(bytes).body;
const env = {
  DB: fakeD1(db),
  TOKEN_SECRET: "secret-de-test", OWNER_EMAIL: "studio@x.be", PUBLIC_SITE_ORIGIN: "https://site.test", PUBLIC_API_ORIGIN: "https://api.test",
  TILES: {
    put: async (key, body) => {
      const b = await bytesOf(body);
      store.set(key, b);
      return { size: b.length };
    },
    get: async (key, opts) => {
      if (!store.has(key)) return null;
      const all = store.get(key);
      const r = opts?.range;
      const slice = r ? all.subarray(r.offset || 0, r.length !== undefined ? (r.offset || 0) + r.length : all.length) : all;
      return { body: streamOf(slice), size: all.length };
    },
    delete: async (k) => store.delete(k),
    list: async ({ prefix }) => ({ objects: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
  },
};
const t0 = Math.floor(Date.now() / 1000);
db.prepare("INSERT INTO photographers (id, email, password_hash, password_salt, studio_name, created_at) VALUES ('ph', 'studio@x.be', 'x', 'x', 'Studio Lumière', ?)").run(t0);
const photographer = db.prepare("SELECT * FROM photographers WHERE id = 'ph'").get();

const jreq = (method, body, headers = {}) => new Request("https://api.test/x", { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const admin = (method, parts, body) => handlePressAdmin(jreq(method, body), env, photographer, parts);
const pub = (method, path, body, token) => handlePressPublic(new Request(`https://api.test${path}`, {
  method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), "CF-Connecting-IP": "1.2.3.4", "user-agent": "test" },
  body: body === undefined ? undefined : JSON.stringify(body),
}), env, undefined, path);
const js = async (res) => res.json();

/* ---------- JPEG de test : JFIF + Exif + XMP d'origine + IPTC + image ---------- */

function seg(marker, payload) {
  const b = Buffer.alloc(4 + payload.length);
  b[0] = 0xff;
  b[1] = marker;
  b.writeUInt16BE(payload.length + 2, 2);
  payload.copy(b, 4);
  return b;
}
function iim(records) {
  const parts = [Buffer.from([0x1c, 1, 90, 0, 3, 0x1b, 0x25, 0x47])];
  for (const [ds, text] of records) {
    const v = Buffer.from(text, "utf8");
    const h = Buffer.from([0x1c, 2, ds, 0, 0]);
    h.writeUInt16BE(v.length, 3);
    parts.push(h, v);
  }
  const data = Buffer.concat(parts);
  const res = Buffer.alloc(12);
  res.write("8BIM", 0, "latin1");
  res.writeUInt16BE(0x0404, 4);
  res.writeUInt32BE(data.length, 8);
  return Buffer.concat([Buffer.from("Photoshop 3.0\u0000", "latin1"), res, data, data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
}
const oldXmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" photoshop:Credit="ANCIEN-CREDIT"><dc:description><rdf:Alt><rdf:li xml:lang="x-default">Le chanteur salue la foule</rdf:li></rdf:Alt></dc:description></rdf:Description></rdf:RDF></x:xmpmeta>`;
const image = Buffer.concat([Buffer.from([0xff, 0xda, 0, 8, 1, 2, 3, 4, 5, 6]), Buffer.from(Array.from({ length: 200000 }, (_, i) => (i * 7) % 251)), Buffer.from([0xff, 0xd9])]);
const jpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  seg(0xe0, Buffer.from("JFIF\u0000\u0001\u0002\u0000\u0000\u0001\u0000\u0001\u0000\u0000", "latin1")),
  seg(0xe1, Buffer.concat([Buffer.from("Exif\u0000\u0000", "latin1"), Buffer.alloc(40, 1)])),
  seg(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\u0000" + oldXmp, "utf8")),
  seg(0xed, iim([[105, "Concert de clôture"], [80, "Camille Dubois"], [25, "concert"], [25, "festival"], [90, "Liège"]])),
  seg(0xdb, Buffer.alloc(65, 2)),
  image,
]);
const plainJpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from("JFIF\u0000\u0001\u0002\u0000\u0000\u0001\u0000\u0001\u0000\u0000", "latin1")), seg(0xdb, Buffer.alloc(65, 3)), image]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(5000, 9)]);

/* ---------- Création ---------- */

let res = await admin("POST", [], { title: "Les Nuits du Parc 2026", eventDate: "2026-11-14", venue: "Parc de la Boverie", city: "Liège", creditLine: "Studio Lumière / Les Nuits du Parc", embargoAt: t0 + 3600 });
const created = await js(res);
check("événement créé (galerie de type « press »)", res.status === 201 && /^presse-/.test(created.slug), created.slug);
const slug = created.slug;
const gal = db.prepare("SELECT * FROM galleries WHERE slug = ?").get(slug);
check("hors des galeries clients", gal.kind === "press");
const list = await js(await admin("GET", []));
check("liste : l'événement et 3 modèles de licence par défaut", list.events.length === 1 && list.templates.length === 3 && list.templates.map((t) => t.kind).join() === "editorial,communication,advertising");

for (const [i, id] of ["p1", "p2", "p3"].entries()) {
  db.prepare("INSERT INTO photos (id, gallery_id, width, height, cols, rows, position, created_at) VALUES (?, ?, 1600, 1067, 4, 3, ?, ?)").run(id, gal.id, i, t0);
  store.set(`${gal.id}/${id}/0/0_0.jpg`, new Uint8Array([1, 2, 3]));
}

/* ---------- HD et légendes ---------- */

const putHd = async (id, name, bytes) => handlePressAdmin(new Request(`https://api.test/x?name=${encodeURIComponent(name)}`, { method: "PUT", headers: { "content-length": String(bytes.length) }, body: bytes }), env, photographer, [slug, "photos", id, "hd"]);
const meta1 = readPressMeta(jpeg);
check("légendes lues dans le fichier (XMP puis IPTC)", meta1.caption === "Le chanteur salue la foule" && meta1.headline === "Concert de clôture" && meta1.byline === "Camille Dubois" && meta1.keywords.join() === "concert,festival" && meta1.city === "Liège", JSON.stringify(meta1));
const map1 = headerMap(jpeg);
check("carte de l'en-tête : XMP d'origine à retirer, insertion après Exif", map1 && map1.strip.length === 1 && map1.insertAt <= map1.strip[0][0], JSON.stringify(map1));
res = await putHd("p1", "NDP_0001.jpg", jpeg);
check("HD envoyée telle quelle", res.status === 201 && store.get(`${gal.id}/p1/hd`).length === jpeg.length);
res = await admin("POST", [slug, "photos", "p1", "meta"], { ...meta1, layout: map1 });
check("légendes et carte enregistrées", (await js(res)).stamped === true);
await putHd("p2", "NDP_0002.jpg", plainJpeg);
await admin("POST", [slug, "photos", "p2", "meta"], { layout: headerMap(plainJpeg) });
await putHd("p3", "affiche.png", png);
await admin("POST", [slug, "photos", "p3", "meta"], { fullCrc: zlib.crc32(png) });
await admin("POST", [slug, "photos", "p1"], { tags: "Acme, scène" });

/* ---------- Destinataires ---------- */

const addR = async (body) => js(await admin("POST", [slug, "recipients"], body));
const client = await addR({ role: "client", name: "Julie Martin", organisation: "Les Nuits du Parc", email: "julie@nuits.be" });
const press = await addR({ role: "press", name: "Marc Leroy", organisation: "Le Quotidien", email: "marc@quotidien.be", lang: "fr" });
const sponsor = await addR({ role: "sponsor", name: "Eva", organisation: "Acme Drinks", email: "eva@acme.be", tagFilter: "acme" });
const tok = (r) => decodeURIComponent(r.link.split("t=")[1]);
const tc = tok(client), tp = tok(press), ts = tok(sponsor);
check("liens personnels vers la page publique", client.link.startsWith("https://site.test/presse.html?t="));

let me = await js(await pub("GET", "/api/press/me", undefined, tc));
check("avant ouverture : rien de visible", me.open === false && me.photos.length === 0);

await admin("POST", [slug, "review"]);
me = await js(await pub("GET", "/api/press/me", undefined, tc));
check("validation ouverte : le commanditaire voit tout et peut valider", me.open && me.photos.length === 3 && me.canValidate);
me = await js(await pub("GET", "/api/press/me", undefined, tp));
check("…la presse, rien encore", me.open === false);
res = await pub("POST", "/api/press/me/decide", { ids: ["p1"], status: "approved" }, tp);
check("la presse ne peut pas valider", res.status === 403);
await pub("POST", "/api/press/me/decide", { ids: ["p1", "p3"], status: "approved" }, tc);
await pub("POST", "/api/press/me/decide", { ids: ["p2"], status: "rejected", note: "yeux fermés" }, tc);
const st = db.prepare("SELECT photo_id, status, decided_by FROM press_photos ORDER BY photo_id").all();
check("décisions enregistrées, avec leur auteur", st.map((s) => s.status).join() === "approved,rejected,approved" && st[0].decided_by === client.id);

await admin("POST", [slug, "publish"]);
me = await js(await pub("GET", "/api/press/me", undefined, tp));
check("publié, mais embargo : la presse ne voit pas encore les photos", me.open === false && me.event.embargoed === true);
check("tuile refusée pendant l'embargo", (await pub("GET", "/api/press/tile/p1/0/0/0", undefined, tp)).status === 404);
db.prepare("UPDATE press_events SET embargo_at = ? WHERE gallery_id = ?").run(t0 - 10, gal.id);
me = await js(await pub("GET", "/api/press/me", undefined, tp));
check("après l'embargo : seulement les photos validées", me.open && me.photos.map((p) => p.id).join() === "p1,p3");
const ms = await js(await pub("GET", "/api/press/me", undefined, ts));
check("sponsor : seulement les photos de son étiquette", ms.photos.map((p) => p.id).join() === "p1");
check("tuile servie à un destinataire autorisé", (await pub("GET", "/api/press/tile/p1/0/0/0", undefined, tp)).status === 200);
check("tuile d'une photo refusée : jamais", (await pub("GET", "/api/press/tile/p2/0/0/0", undefined, tp)).status === 404);

/* ---------- Licence ---------- */

check("licence éditoriale proposée à la presse", me.licence.kind === "editorial" && me.licence.needed && /Studio Lumière \/ Les Nuits du Parc/.test(me.licence.text) && /2019\/790/.test(me.licence.text));
res = await pub("POST", "/api/press/me/link", { all: true }, tp);
check("téléchargement refusé avant acceptation", res.status === 403);
res = await pub("POST", "/api/press/me/licence", { name: "Marc Leroy", accept: true, sha256: "faux" }, tp);
check("texte changé entre-temps : il faut relire", res.status === 409);
res = await pub("POST", "/api/press/me/licence", { name: "Marc Leroy", accept: true, sha256: me.licence.sha256 }, tp);
const lic = await js(res);
check("licence acceptée et gardée (texte exact, empreinte)", res.status === 200 && db.prepare("SELECT text_sha256, text FROM press_licences WHERE id = ?").get(lic.id).text_sha256 === me.licence.sha256);
me = await js(await pub("GET", "/api/press/me", undefined, tp));
check("ensuite : les photos sont téléchargeables", !me.licence.needed && me.photos.every((p) => p.block === ""));

/* ---------- Fichier livré ---------- */

const linkRes = await js(await pub("POST", "/api/press/me/link", { photo: "p1" }, tp));
const dlPath = new URL(linkRes.urls[0]).pathname;
res = await pub("GET", dlPath);
const file = Buffer.from(await res.arrayBuffer());
const text = file.toString("latin1");
check("fichier JPEG complet, de la taille annoncée", res.status === 200 && file[0] === 0xff && file[1] === 0xd8 && Number(res.headers.get("content-length")) === file.length);
check("crédit, licencié, n° de licence et refus de l'IA écrits", text.includes('photoshop:Credit="Studio Lumière / Les Nuits du Parc"'.replace("è", "Ã¨")) && text.includes("Le Quotidien") && text.includes(lic.id) && text.includes("DMI-PROHIBITED-AIMLTRAINING"));
check("légende reprise, ancien XMP retiré (un seul XMP)", text.includes("Le chanteur salue la foule") && !text.includes("ANCIEN-CREDIT") && text.split("http://ns.adobe.com/xap/1.0/\u0000").length === 2);
check("image et IPTC d'origine intacts", file.subarray(file.length - image.length).equals(image) && text.includes("Photoshop 3.0"));
check("en-têtes anti-IA sur la réponse", res.headers.get("tdm-reservation") === "1" && /noai/.test(res.headers.get("x-robots-tag")));
const reread = readPressMeta(file);
check("le fichier livré se relit (légende, crédit)", reread.caption === "Le chanteur salue la foule" && reread.credit === "Studio Lumière / Les Nuits du Parc", JSON.stringify(reread));

/* ---------- ZIP ---------- */

const zipLinks = await js(await pub("POST", "/api/press/me/link", { all: true }, tp));
res = await pub("GET", new URL(zipLinks.urls[0]).pathname);
const zip = Buffer.from(await res.arrayBuffer());
check("ZIP de la taille annoncée", zip.length === Number(res.headers.get("content-length")), `${zip.length}`);
const entries = [];
for (let o = 0; zip.readUInt32LE(o) === 0x04034b50;) {
  const crc = zip.readUInt32LE(o + 14), size = zip.readUInt32LE(o + 18), nameLen = zip.readUInt16LE(o + 26);
  const name = zip.toString("utf8", o + 30, o + 30 + nameLen);
  const data = zip.subarray(o + 30 + nameLen, o + 30 + nameLen + size);
  entries.push({ name, ok: zlib.crc32(data) === crc, size });
  o += 30 + nameLen + size;
}
check("ZIP : les deux photos validées, CRC justes (calculés sans relire les fichiers)", entries.length === 2 && entries.every((e) => e.ok), JSON.stringify(entries));
check("ZIP : le PNG livré tel quel", entries.some((e) => e.name === "affiche.png" && e.size === png.length));

/* ---------- Droit à l'image, journal, retrait ---------- */

await admin("POST", [slug, "photos", "p1"], { people: "minor" });
await pub("POST", "/api/press/me/licence", { name: "Eva", accept: true, sha256: (await js(await pub("GET", "/api/press/me", undefined, ts))).licence.sha256 }, ts);
const ms2 = await js(await pub("GET", "/api/press/me", undefined, ts));
check("photo d'un mineur : bloquée pour une licence de communication", ms2.photos[0].block === "rights");
me = await js(await pub("GET", "/api/press/me", undefined, tp));
check("…mais permise en usage éditorial", me.photos.find((p) => p.id === "p1").block === "");
const csv = await (await admin("GET", [slug, "journal.csv"])).text();
check("journal exportable : 3 téléchargements, licence et empreinte", csv.split("\r\n").length === 4 && csv.includes(lic.id) && csv.includes(me.licence.sha256), csv.split("\r\n")[1]);
await admin("POST", [slug, "recipients", press.id], { action: "revoke" });
check("accès retiré : plus rien", (await pub("GET", "/api/press/me", undefined, tp)).status === 403 && (await pub("GET", dlPath)).status === 403);

/* ---------- Accréditation ---------- */

check("page publique fermée par défaut", (await pub("GET", `/api/press/event/${slug}`)).status === 404);
await admin("POST", [slug], { accreditationOpen: true });
const pe = await js(await pub("GET", `/api/press/event/${slug}`));
check("page publique : l'événement, sans photo", pe.event.title === "Les Nuits du Parc 2026" && !("photos" in pe));
res = await pub("POST", `/api/press/event/${slug}/accreditation`, { name: "Zoé", organisation: "Radio Ouest", email: "zoe@radio.be", pressCard: "BE-1234" });
check("demande d'accréditation reçue, en attente", res.status === 201 && db.prepare("SELECT status FROM press_recipients WHERE email = 'zoe@radio.be'").get().status === "pending");
const detail = await js(await admin("GET", [slug]));
const zoe = detail.recipients.find((r) => r.email === "zoe@radio.be");
const acc = await js(await admin("POST", [slug, "recipients", zoe.id], { action: "accept" }));
check("accréditation acceptée : lien personnel", acc.ok && acc.link.includes("presse.html?t="));

/* ---------- Nouvelle version de licence ---------- */

const edFam = detail.templates.find((t) => t.kind === "editorial").family;
res = await admin("POST", ["templates", edFam], { name: "Presse : usage éditorial", kind: "editorial", usages: ["print", "web"], territory: "europe", durationMonths: 6 });
const versions = db.prepare("SELECT version, superseded_at FROM press_licence_templates WHERE family = ? ORDER BY version").all(edFam);
check("modèle modifié : nouvelle version, l'ancienne gardée", versions.length === 2 && versions[0].superseded_at && !versions[1].superseded_at);
const mz = await js(await pub("GET", "/api/press/me", undefined, tok(acc)));
check("le texte proposé suit la nouvelle version (6 mois, UE)", /6 mois/.test(mz.licence.text) && /Union européenne/.test(mz.licence.text) && mz.licence.version === 2);
check("la licence déjà acceptée reste telle quelle", db.prepare("SELECT text FROM press_licences WHERE id = ?").get(lic.id).text === me.licence.text);

res = await admin("DELETE", [slug]);
check("événement supprimé, licences gardées comme preuve", res.status === 200 && !db.prepare("SELECT id FROM galleries WHERE id = ?").get(gal.id) && db.prepare("SELECT COUNT(*) AS n FROM press_licences").get().n === 2);

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
