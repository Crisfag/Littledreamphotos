// Correspondance HD livrée ↔ épreuve de la galerie (lib/hdmatch.mjs).
//
//   node tests/hdmatch.test.mjs

import { matchDeliveredFile } from "../lib/hdmatch.mjs";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const photos = [
  { id: "a", source_name: "DSC_3662.jpg", taken_at: 1000 },
  { id: "b", source_name: "DSC_3664.JPG", taken_at: 2000 },
  { id: "c", source_name: "DSC_366.jpg", taken_at: 3000 },
  { id: "d", source_name: "DSC_3662-2.jpg", taken_at: 4000 },
  { id: "e", source_name: "", taken_at: 5000 },
  { id: "f", source_name: "IMG_0001.jpg", taken_at: 6000, delivery_file_id: "dlv_autre" },
];
const m = (name, takenAt, options) => matchDeliveredFile({ name, takenAt }, photos, options);
const id = (r) => (r ? `${r.photo.id}/${r.by}` : "aucune");

check("même nom", id(m("DSC_3662.jpg")) === "a/name");
check("casse et extension différentes", id(m("dsc_3664.tif")) === "b/name");
check("suffixe d'export Lightroom", id(m("DSC_3662-Edit.jpg")) === "a/name");
check("préfixe client et suffixe", id(m("Simon-Alexandre_DSC_3664 (retouche).jpg")) === "b/name");
check("« DSC_366 » ne correspond pas à « DSC_3662 »", id(m("DSC_3662.jpg")) !== "c/name");
check("le nom le plus long l'emporte (DSC_3662-2)", id(m("DSC_3662-2-Edit.jpg")) === "d/name");
check("fichier renommé : retrouvé par l'heure de prise de vue", id(m("Simon-Alexandre-012.jpg", 5000)) === "e/time");
check("renommé sans heure connue : aucune", id(m("Simon-Alexandre-012.jpg", null)) === "aucune");
check("heure partagée par deux épreuves : aucune", id(matchDeliveredFile({ name: "x.jpg", takenAt: 7 }, [{ id: "p", taken_at: 7 }, { id: "q", taken_at: 7 }])) === "aucune");
check("épreuve déjà reliée à une autre HD : écartée", id(m("IMG_0001-Edit.jpg")) === "aucune");
check("…sauf pour la HD qui lui est déjà reliée", id(m("IMG_0001-Edit.jpg", null, { fileId: "dlv_autre" })) === "f/name");
check("deux épreuves de même longueur dans le nom : aucune (ambigu)", id(m("DSC_3662+DSC_3664.jpg")) === "aucune");

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
