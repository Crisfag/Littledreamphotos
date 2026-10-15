// Langue d'une galerie client : ce que voit le client (page de la galerie,
// e-mails qu'il reçoit, libellés de la boutique, facture). Choisie par le
// photographe galerie par galerie ; l'espace photographe reste en français.

export const LANGUAGES = ["fr", "en"];

export function languageOf(value) {
  return LANGUAGES.includes(value) ? value : "fr";
}

// pick(lang, "Bonjour", "Hello") : le texte de la langue demandée.
export function pick(lang, fr, en) {
  return lang === "en" ? en : fr;
}

export function plural(count, one, many) {
  return count > 1 ? many : one;
}
