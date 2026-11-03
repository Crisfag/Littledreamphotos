// Retrouve l'épreuve (photo de la galerie de sélection) qu'un fichier HD
// livré remplace. Fonction pure, testée dans tests/hdmatch.test.mjs.
//
// 1. Par le nom : « DSC_3662.jpg » ↔ « DSC_3662.jpg », « DSC_3662-Edit.jpg »,
//    « DSC_3662 (retouche).tif », « Simon-Alexandre_DSC_3662.jpg »… Le nom
//    de l'épreuve doit apparaître entier dans celui de la HD (pas « 366 »
//    dans « 3662 »). Plusieurs épreuves possibles : la plus longue l'emporte
//    (« DSC_3662-2 » plutôt que « DSC_3662 »), sinon rien.
// 2. Par l'heure de prise de vue (EXIF, au millième) quand le fichier a été
//    renommé à l'export : seulement si une seule épreuve a cette heure-là.
// Rien de sûr : null — le photographe choisit alors lui-même.

function stem(name) {
  return String(name || "")
    .split(/[\\/]/).pop()
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .trim()
    .toLowerCase();
}

// Le nom de l'épreuve, entier, dans celui de la HD : bordé par le début, la
// fin ou un caractère qui n'est ni lettre ni chiffre.
function containsWhole(haystack, needle) {
  if (!needle) return false;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? "" : haystack[at - 1];
    const after = haystack[at + needle.length] || "";
    const isWord = (c) => /[\p{L}\p{N}]/u.test(c);
    if (!isWord(before) && !isWord(after)) return true;
    from = at + 1;
  }
}

/**
 * @param {{ name: string, takenAt?: number|null }} file  fichier HD livré
 * @param {Array<{ id: string, source_name?: string, taken_at?: number|null, delivery_file_id?: string }>} photos
 * @param {{ fileId?: string }} [options] fichier déjà relié : son épreuve
 *   actuelle reste candidate, les épreuves reliées à d'AUTRES fichiers non.
 * @returns {{ photo: object, by: "name"|"time" } | null}
 */
export function matchDeliveredFile(file, photos, options = {}) {
  const free = photos.filter((p) => !p.delivery_file_id || p.delivery_file_id === options.fileId);
  const hd = stem(file.name);
  if (hd) {
    const byName = free
      .map((p) => ({ p, s: stem(p.source_name) }))
      .filter(({ s }) => s.length >= 3 && containsWhole(hd, s));
    if (byName.length) {
      byName.sort((a, b) => b.s.length - a.s.length);
      if (byName.length === 1 || byName[0].s.length > byName[1].s.length) return { photo: byName[0].p, by: "name" };
      return null;
    }
  }
  if (Number.isFinite(file.takenAt) && file.takenAt > 0) {
    const byTime = free.filter((p) => p.taken_at === file.takenAt);
    if (byTime.length === 1) return { photo: byTime[0], by: "time" };
  }
  return null;
}
