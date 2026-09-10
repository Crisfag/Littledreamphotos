// Découpage en tuiles.
//
// Une photo n'est jamais servie comme fichier unique : elle est débitée en
// tuiles réassemblées dans un canvas côté navigateur. Il n'existe donc aucune
// URL qui renvoie la photo entière — ni pour un « enregistrer l'image sous »,
// ni pour un aspirateur de site.
//
// La grille est calculée par la même formule des deux côtés (préparation et
// affichage) : les tuiles se rejoignent au pixel près, sans trou ni
// chevauchement, quelles que soient les dimensions.

export const TARGET_TILE = 400;

// Deux niveaux de détail. La grille de vignettes ne peut pas charger les tuiles
// pleine taille de toute une séance — ce serait plusieurs dizaines de mégaoctets
// sur mobile. L'aperçu est donc une version réduite, elle aussi découpée : même
// à 500 px, aucune URL ne renvoie jamais une photo entière.
export const LEVEL_PREVIEW = 0;
export const LEVEL_FULL = 1;
export const PREVIEW_MAX = 500;
export const PREVIEW_COLS = 2;
export const PREVIEW_ROWS = 2;

export function gridFor(width, height, target = TARGET_TILE) {
  return {
    cols: Math.max(1, Math.round(width / target)),
    rows: Math.max(1, Math.round(height / target)),
  };
}

export function tileRect(width, height, cols, rows, col, row) {
  const x = Math.floor((col * width) / cols);
  const y = Math.floor((row * height) / rows);
  return {
    left: x,
    top: y,
    width: Math.floor(((col + 1) * width) / cols) - x,
    height: Math.floor(((row + 1) * height) / rows) - y,
  };
}
