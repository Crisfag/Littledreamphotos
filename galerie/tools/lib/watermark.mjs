// Filigrane visible, pensé pour résister au détatouage automatique.
//
// Un logo dans un coin s'efface en trois secondes : l'outil recopie le décor
// voisin par-dessus, il n'a rien à inventer. Une trame qui traverse tout le
// sujet — visages, peau, tissus — oblige au contraire l'IA à reconstruire ce
// qu'elle ne voit pas. Elle y arrive, mais en hallucinant des détails, et ça se
// remarque immédiatement sur un portrait.
//
// Trois choix pour la lisibilité comme pour la résistance :
//  - texte répété sur toute la surface, en diagonale, jamais alignable ;
//  - double tracé, sombre puis clair, légèrement décalés : sur une chemise
//    blanche c'est le tracé sombre qui porte, sur un fond noir le tracé clair.
//    Un filigrane d'une seule couleur s'efface visuellement sur la moitié des
//    photos — et un simple seuillage suffirait à l'isoler ;
//  - opacité faible mais surface totale : discret à l'œil, coûteux à retirer.

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Construit le calque SVG du filigrane.
 * @param {object} options
 * @param {number} options.width largeur de l'image
 * @param {number} options.height hauteur de l'image
 * @param {string} options.text texte répété (marque + nom du client)
 * @param {number} [options.opacity] opacité du tracé clair (0,06 à 0,20)
 * @param {number} [options.angle] inclinaison en degrés
 * @param {number} [options.density] 1 = espacement standard ; < 1 = plus dense
 */
export function watermarkSvg({ width, height, text, opacity = 0.11, angle = -30, density = 1 }) {
  const label = escapeXml(text);
  // Taille de police proportionnelle à l'image : le filigrane occupe la même
  // place relative sur une vignette que sur une photo plein écran.
  const fontSize = Math.max(14, Math.round(Math.min(width, height) / 26));
  const tileWidth = Math.round(fontSize * label.length * 0.62 * density + fontSize * 4);
  const tileHeight = Math.round(fontSize * 5.2 * density);
  // La diagonale couvre toute l'image même après rotation du motif.
  const span = Math.ceil(Math.hypot(width, height));

  // Le texte est tracé deux fois, sombre puis clair, avec un léger décalage :
  // quelle que soit la luminosité du fond, l'un des deux ressort.
  const shift = Math.max(1, fontSize / 18);
  const stroke = Math.max(1, fontSize / 26).toFixed(2);
  const dark = (opacity * 0.85).toFixed(3);
  const light = opacity.toFixed(3);

  const line = (x, y) => `
      <text x="${(x + shift).toFixed(1)}" y="${(y + shift).toFixed(1)}"
            font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}"
            font-weight="600" letter-spacing="${(fontSize * 0.08).toFixed(1)}"
            fill="#000000" fill-opacity="${dark}">${label}</text>
      <text x="${x.toFixed(1)}" y="${y.toFixed(1)}"
            font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}"
            font-weight="600" letter-spacing="${(fontSize * 0.08).toFixed(1)}"
            fill="#ffffff" fill-opacity="${light}"
            stroke="#000000" stroke-opacity="${(opacity * 0.35).toFixed(3)}"
            stroke-width="${stroke}">${label}</text>`;

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <pattern id="trame" width="${tileWidth}" height="${tileHeight}" patternUnits="userSpaceOnUse">${line(0, Math.round(tileHeight * 0.45))}${line(Math.round(tileWidth * 0.5), Math.round(tileHeight * 0.95))}
    </pattern>
  </defs>
  <g transform="rotate(${angle} ${width / 2} ${height / 2})">
    <rect x="${(width - span) / 2}" y="${(height - span) / 2}"
          width="${span}" height="${span}" fill="url(#trame)"/>
  </g>
</svg>`);
}
