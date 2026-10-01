// Codes couleur et repères annotés posés par le client sur une photo.
//
// Le code couleur est un signal à trois valeurs, indépendant du coup de
// cœur (qui, lui, pilote le forfait et les suppléments) : « validée »,
// « à retoucher », « à écarter ». Les repères sont des points posés sur la
// photo avec une note courte — pas de dessin libre : un point et un texte
// se stockent en quelques octets, se relisent sans ambiguïté et s'affichent
// identiquement sur n'importe quelle taille d'écran, puisque les coordonnées
// sont relatives (0 à 1) à la largeur et à la hauteur de la photo.

export const TAGS = ["green", "yellow", "red"];
export const TAG_LABELS = { green: "Validée", yellow: "À retoucher", red: "À écarter" };
export const MAX_MARKS = 12;
export const MAX_MARK_NOTE_LENGTH = 200;

export function isValidTag(tag) {
  return tag === "" || TAGS.includes(tag);
}

// Relit la colonne `marks` (JSON) sans jamais faire confiance à son
// contenu : une valeur corrompue vaut « aucun repère », pas une erreur 500.
export function parseMarks(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((m) => m && typeof m === "object") : [];
  } catch {
    return [];
  }
}

// Valide et normalise une liste de repères envoyée par le client. Renvoie
// `{ marks }` ou `{ error }` (message lisible, à renvoyer en 400).
export function normalizeMarks(input) {
  if (!Array.isArray(input)) return { error: "Repères invalides" };
  if (input.length > MAX_MARKS) return { error: `Au plus ${MAX_MARKS} repères par photo` };
  const marks = [];
  for (const mark of input) {
    if (!mark || typeof mark !== "object") return { error: "Repère invalide" };
    const x = Number(mark.x);
    const y = Number(mark.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
      return { error: "Position de repère invalide" };
    }
    const note = typeof mark.note === "string" ? mark.note.trim().slice(0, MAX_MARK_NOTE_LENGTH) : "";
    marks.push({ x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000, note });
  }
  return { marks };
}
