// Langue d'une galerie client : ce que voit le client (page de la galerie,
// e-mails qu'il reçoit, libellés de la boutique, facture). Choisie par le
// photographe galerie par galerie : français, anglais ou néerlandais.
//
// L'espace photographe existe dans les mêmes langues (UI_LANGUAGES). Les
// e-mails adressés au PHOTOGRAPHE, eux, n'existent qu'en français et en
// anglais : voir photographerMailLanguage.

export const LANGUAGES = ["fr", "en", "nl"];
export const UI_LANGUAGES = LANGUAGES;

export function languageOf(value) {
  return LANGUAGES.includes(value) ? value : "fr";
}

// Langue de l'espace photographe (ui_language) : « fr » par défaut.
export function uiLanguageOf(value) {
  return UI_LANGUAGES.includes(value) ? value : "fr";
}

// Langue des e-mails envoyés au photographe (alerte de capture, sélection
// validée, commande reçue, purge de stockage, mot de passe…) : ils n'existent
// qu'en français et en anglais. Un photographe dont l'espace est en
// néerlandais reçoit la version anglaise ; les e-mails qui n'ont pas de
// version anglaise restent en français pour tout le monde.
export function photographerMailLanguage(uiLanguage) {
  return uiLanguage === "en" || uiLanguage === "nl" ? "en" : "fr";
}

// pick(lang, "Bonjour", "Hello", "Hallo") : le texte de la langue demandée.
// Sans version néerlandaise, une galerie en néerlandais reçoit l'anglais
// (jamais le français).
export function pick(lang, fr, en, nl) {
  if (lang === "nl") return nl === undefined ? en : nl;
  return lang === "en" ? en : fr;
}

export function plural(count, one, many) {
  return count > 1 ? many : one;
}

// Locale Intl de chaque langue de galerie (dates, nombres).
export function localeOf(lang) {
  return pick(lang, "fr-BE", "en-GB", "nl-BE");
}

// Montant en euros dans les usages de chaque langue :
// « 45,00 € » (fr), « €45.00 » (en), « € 45,00 » (nl).
export function formatAmount(cents, lang) {
  const amount = ((cents || 0) / 100).toLocaleString(localeOf(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return pick(lang, `${amount} €`, `€${amount}`, `€ ${amount}`);
}

// Date d'un horodatage (secondes) dans la langue de la galerie, à l'heure
// de Bruxelles. `options` : celles de toLocaleDateString.
export function formatDate(ts, lang, options = { day: "numeric", month: "long", year: "numeric" }) {
  return new Date(ts * 1000).toLocaleDateString(localeOf(lang), { ...options, timeZone: "Europe/Brussels" });
}
