// Vérifie la fabrication du ZIP de livraison sans réseau ni D1 : le plan
// (en-têtes, décalages, taille totale) produit un ZIP que des outils
// standards ouvrent et vérifient (Python zipfile : CRC de chaque fichier).
//
//   node tests/delivery.test.mjs

import { writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipPlan, crc32, uniqueNames, safeFileName } from "../src/delivery.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

check("CRC-32 conforme à la valeur de référence", crc32(new TextEncoder().encode("123456789")) === 0xcbf43926);

const files = [
  { name: "IMG_0001.jpg", bytes: new Uint8Array(70000).map((_, i) => (i * 31 + 7) & 0xff) },
  { name: "Séance été — n°2.jpg", bytes: new Uint8Array(1234).map((_, i) => (i * 3) & 0xff) },
  { name: "vide.jpg", bytes: new Uint8Array(0) },
];
const plan = zipPlan(files.map((f) => ({ name: f.name, size: f.bytes.length, crc32: crc32(f.bytes), date: new Date("2026-10-03T12:34:56Z") })));
const chunks = [];
plan.placed.forEach((item, i) => {
  chunks.push(item.local, files[i].bytes);
});
chunks.push(...plan.central, plan.end);
const zip = Buffer.concat(chunks.map((c) => Buffer.from(c)));
check("la taille annoncée d'avance est exactement celle du ZIP produit", zip.length === plan.totalSize, `${zip.length} / ${plan.totalSize}`);

const dir = mkdtempSync(join(tmpdir(), "livraison-"));
const path = join(dir, "photos.zip");
writeFileSync(path, zip);
let listing = "";
try {
  listing = execFileSync("python3", ["-c", `
import zipfile, sys, json
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip()
print(json.dumps({"bad": bad, "names": z.namelist(), "sizes": [i.file_size for i in z.infolist()], "ok": z.read("IMG_0001.jpg")[:3].hex()}))
`, path]).toString();
} catch (err) {
  listing = String(err.stderr || err.message);
}
let parsed = null;
try { parsed = JSON.parse(listing); } catch { /* sortie d'erreur */ }
check("un lecteur ZIP standard ouvre l'archive et valide le CRC de chaque fichier", parsed && parsed.bad === null, listing.trim().slice(0, 200));
check("les noms (accents compris) et les tailles sont conservés",
      parsed && parsed.names.join("|") === files.map((f) => f.name).join("|") && parsed.sizes.join(",") === files.map((f) => f.bytes.length).join(","),
      parsed && parsed.names.join("|"));
check("le contenu est relu à l'identique", parsed && parsed.ok === Buffer.from(files[0].bytes.slice(0, 3)).toString("hex"));

check("deux fichiers du même nom reçoivent des noms distincts dans le ZIP",
      uniqueNames(["a.jpg", "A.jpg", "a.jpg", "b"]).join("|") === "a.jpg|A (2).jpg|a (3).jpg|b",
      uniqueNames(["a.jpg", "A.jpg", "a.jpg", "b"]).join("|"));
check("un nom de fichier ne garde ni chemin, ni guillemet, ni caractère de contrôle",
      safeFileName("../../etc/pa\"ss\u0000wd.jpg") === "passwd.jpg" && safeFileName("C:\\\\photos\\\\IMG 1.jpg") === "IMG 1.jpg" && safeFileName("") === "photo.jpg",
      safeFileName("../../etc/pa\"ss\u0000wd.jpg"));

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
