// Présentation d'une galerie client : son style (palette, typographie,
// en-tête — voir gallery.css, [data-theme]), les polices choisies par le
// photographe, un texte d'accompagnement et un en-tête (photo de couverture
// prise dans la galerie, ou vidéo YouTube/Vimeo, pour un film de mariage).
// Purement visuel : rien ici ne change la protection des photos (tuiles,
// filigrane, empreinte).

import { LANGUAGES, languageOf } from "./i18n.js";

// Styles proposés. "" (classique) est l'apparence historique.
export const THEMES = ["classique", "doux", "architectural", "moderne", "nuit", "editorial", "romantique", "boheme", "galerie"];

// Polices proposées (Google Fonts, chargées par la page de la galerie).
export const TITLE_FONTS = [
  "cormorant", "playfair", "bodoni", "fraunces", "dmserif", "marcellus", "italiana",
  "josefin", "manrope", "montserrat", "syne", "greatvibes", "parisienne",
];
export const BODY_FONTS = ["jost", "nunito", "worksans", "manrope", "karla", "lato", "inter", "lora", "ebgaramond", "montserrat"];

export const INTRO_MAX = 600;

export function themeOf(value) {
  return THEMES.includes(value) ? value : "classique";
}

// Lien d'une vidéo collé par le photographe → { embedUrl } ou { error }.
// Seuls des identifiants au format attendu sont recopiés dans l'adresse du
// lecteur (YouTube sans cookies, Vimeo sans suivi).
export function videoFromLink(raw) {
  const text = String(raw || "").trim();
  if (!text) return { embedUrl: "" };
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { error: "Ce lien n'est pas valide" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "Ce lien n'est pas valide" };
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    let video = null;
    if (host === "youtu.be") video = segments[0];
    else if (segments[0] === "watch") video = url.searchParams.get("v");
    else if (["shorts", "embed", "live"].includes(segments[0])) video = segments[1];
    if (video && /^[A-Za-z0-9_-]{11}$/.test(video)) {
      return { embedUrl: `https://www.youtube-nocookie.com/embed/${video}?rel=0&modestbranding=1&playsinline=1` };
    }
    return { error: "Lien YouTube non reconnu : copiez le lien de la vidéo (Partager → Copier le lien)." };
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    // vimeo.com/123456789, vimeo.com/123456789/abcdef1234 (vidéo non
    // répertoriée), player.vimeo.com/video/123456789?h=abcdef1234.
    const parts = host === "player.vimeo.com" ? segments.slice(segments[0] === "video" ? 1 : 0) : segments;
    const id = parts[0];
    const hash = parts[1] || url.searchParams.get("h") || "";
    if (id && /^\d{6,12}$/.test(id) && (!hash || /^[A-Za-z0-9]{6,20}$/.test(hash))) {
      return { embedUrl: `https://player.vimeo.com/video/${id}?dnt=1&title=0&byline=0&portrait=0${hash ? `&h=${hash}` : ""}` };
    }
    return { error: "Lien Vimeo non reconnu : copiez le lien de la vidéo." };
  }

  return { error: "Seuls les liens YouTube et Vimeo sont acceptés pour la vidéo d'en-tête." };
}

// Lien à afficher dans le tableau de bord pour une vidéo enregistrée.
export function linkOfEmbed(embedUrl) {
  const yt = /youtube-nocookie\.com\/embed\/([A-Za-z0-9_-]{11})/.exec(embedUrl || "");
  if (yt) return `https://youtu.be/${yt[1]}`;
  const vimeo = /player\.vimeo\.com\/video\/(\d+)(?:\?.*?\bh=([A-Za-z0-9]+))?/.exec(embedUrl || "");
  if (vimeo) return `https://vimeo.com/${vimeo[1]}${vimeo[2] ? `/${vimeo[2]}` : ""}`;
  return "";
}

// Valide les réglages envoyés par le tableau de bord. Seuls les champs
// présents sont modifiés : { fields } (colonnes SQL) ou { error }.
export function readPresentation(body, photoIds) {
  const fields = {};
  if (body.theme !== undefined) {
    if (!THEMES.includes(body.theme)) return { error: "Style inconnu" };
    fields.theme = body.theme;
  }
  if (body.titleFont !== undefined) {
    if (body.titleFont && !TITLE_FONTS.includes(body.titleFont)) return { error: "Police de titre inconnue" };
    fields.title_font = body.titleFont || "";
  }
  if (body.bodyFont !== undefined) {
    if (body.bodyFont && !BODY_FONTS.includes(body.bodyFont)) return { error: "Police de texte inconnue" };
    fields.body_font = body.bodyFont || "";
  }
  if (body.intro !== undefined) {
    const intro = String(body.intro || "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").replace(/\n{3,}/g, "\n\n").trim();
    if (intro.length > INTRO_MAX) return { error: `Texte d'accompagnement : ${INTRO_MAX} caractères au maximum` };
    fields.intro = intro;
  }
  if (body.coverPhotoId !== undefined) {
    const id = String(body.coverPhotoId || "");
    if (id && !photoIds.has(id)) return { error: "Cette photo n'est pas dans la galerie" };
    fields.cover_photo_id = id;
  }
  if (body.headerVideo !== undefined) {
    const video = videoFromLink(body.headerVideo);
    if (video.error) return { error: video.error };
    fields.header_video = video.embedUrl;
  }
  if (body.language !== undefined) {
    if (!LANGUAGES.includes(body.language)) return { error: "Langue inconnue" };
    fields.language = body.language;
  }
  return { fields };
}

// Ce que la page de la galerie reçoit (connexion du client).
export function presentationForClient(gallery, photoIds) {
  return {
    theme: themeOf(gallery.theme),
    titleFont: TITLE_FONTS.includes(gallery.title_font) ? gallery.title_font : "",
    bodyFont: BODY_FONTS.includes(gallery.body_font) ? gallery.body_font : "",
    intro: gallery.intro || "",
    coverPhotoId: gallery.cover_photo_id && photoIds.has(gallery.cover_photo_id) ? gallery.cover_photo_id : "",
    headerVideo: gallery.header_video || "",
    language: languageOf(gallery.language),
  };
}
