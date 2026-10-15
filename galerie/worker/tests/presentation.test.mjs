// Vérifie la présentation des galeries sans réseau ni D1 : styles, polices,
// texte d'accompagnement, photo de couverture, vidéo d'en-tête (YouTube,
// Vimeo), et cohérence des styles entre le Worker, la page et l'admin.
//
//   node tests/presentation.test.mjs

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEMES, TITLE_FONTS, BODY_FONTS, themeOf, videoFromLink, linkOfEmbed, readPresentation, presentationForClient, INTRO_MAX } from "../src/presentation.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

/* ---------- Vidéo d'en-tête ---------- */

const yt = ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "https://youtu.be/dQw4w9WgXcQ", "youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ"]
  .map((l) => videoFromLink(l).embedUrl);
check("YouTube : lien, lien court, shorts, intégration → lecteur sans cookies",
      yt.every((u) => u === "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1&playsinline=1"), yt.join(" | "));
const vimeo = videoFromLink("https://vimeo.com/123456789").embedUrl;
const hidden = videoFromLink("https://vimeo.com/123456789/abcdef1234").embedUrl;
const player = videoFromLink("https://player.vimeo.com/video/123456789?h=abcdef1234").embedUrl;
check("Vimeo : public, non répertorié (lien privé), lecteur → lecteur sans suivi",
      vimeo === "https://player.vimeo.com/video/123456789?dnt=1&title=0&byline=0&portrait=0" &&
      hidden === player && hidden.endsWith("&h=abcdef1234"), hidden);
check("lien vide = pas de vidéo", videoFromLink("").embedUrl === "" && !videoFromLink("  ").error);
check("autres sites, liens douteux et identifiants malformés refusés",
      ["https://example.com/film.mp4", "javascript:alert(1)", "https://youtu.be/court", "https://vimeo.com/abc", "https://vimeo.com/123456789/<script>"]
        .every((l) => Boolean(videoFromLink(l).error)));
check("rien de ce qui est collé n'arrive tel quel dans l'adresse du lecteur",
      !/[<>"']/.test(videoFromLink("https://youtu.be/dQw4w9WgXcQ?x=\"><script>").embedUrl || ""));
check("le lien enregistré se réaffiche lisiblement dans l'admin",
      linkOfEmbed(yt[0]) === "https://youtu.be/dQw4w9WgXcQ" && linkOfEmbed(hidden) === "https://vimeo.com/123456789/abcdef1234" &&
      linkOfEmbed(vimeo) === "https://vimeo.com/123456789" && linkOfEmbed("") === "");

/* ---------- Réglages envoyés par l'admin ---------- */

const photos = new Set(["ph_1", "ph_2"]);
const all = readPresentation({ theme: "editorial", titleFont: "bodoni", bodyFont: "karla", intro: "  Merci !\r\n\r\n\r\nÀ bientôt\u0007  ", coverPhotoId: "ph_2", headerVideo: "https://youtu.be/dQw4w9WgXcQ" }, photos);
check("tous les réglages lus et nettoyés (fins de ligne, caractères de contrôle, espaces)",
      all.fields.theme === "editorial" && all.fields.title_font === "bodoni" && all.fields.body_font === "karla" &&
      all.fields.intro === "Merci !\n\nÀ bientôt" && all.fields.cover_photo_id === "ph_2" && all.fields.header_video.startsWith("https://www.youtube-nocookie.com/"),
      JSON.stringify(all.fields));
check("seuls les champs envoyés changent", Object.keys(readPresentation({ theme: "nuit" }, photos).fields).join() === "theme");
check("police vide = celle du style", readPresentation({ titleFont: "", bodyFont: "" }, photos).fields.title_font === "");
check("style, police, photo inconnus refusés ; texte trop long refusé",
      Boolean(readPresentation({ theme: "fluo" }, photos).error) && Boolean(readPresentation({ titleFont: "comic" }, photos).error) &&
      Boolean(readPresentation({ bodyFont: "greatvibes" }, photos).error) && Boolean(readPresentation({ coverPhotoId: "ph_9" }, photos).error) &&
      Boolean(readPresentation({ intro: "x".repeat(INTRO_MAX + 1) }, photos).error));
check("une police manuscrite ne peut pas servir au texte", !BODY_FONTS.includes("greatvibes") && TITLE_FONTS.includes("greatvibes"));

/* ---------- Ce que reçoit la page du client ---------- */

const out = presentationForClient({ theme: "", title_font: "inconnue", body_font: "lora", intro: "Bonjour", cover_photo_id: "ph_supprimee", header_video: "" }, photos);
check("valeurs par défaut sûres : style classique, police inconnue ignorée, couverture disparue ignorée",
      out.theme === "classique" && out.titleFont === "" && out.bodyFont === "lora" && out.coverPhotoId === "" && out.intro === "Bonjour", JSON.stringify(out));
check("themeOf : style inconnu → classique", themeOf("x") === "classique" && themeOf("nuit") === "nuit");

/* ---------- Cohérence Worker / page / admin ---------- */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = await readFile(join(root, "web", "gallery.css"), "utf8");
const pageJs = await readFile(join(root, "web", "gallery.js"), "utf8");
const adminJs = await readFile(join(root, "tools", "admin", "admin.js"), "utf8");
const missingCss = THEMES.filter((t) => t !== "classique" && !css.includes(`body[data-theme="${t}"]`));
check("chaque style a ses règles dans gallery.css", missingCss.length === 0, missingCss.join(", "));
const pageThemes = (/var THEME_FONTS = \{([\s\S]*?)\};/.exec(pageJs) || [])[1] || "";
check("chaque style a ses polices dans gallery.js", THEMES.every((t) => new RegExp(`\\b${t}: \\[`).test(pageThemes)));
check("chaque style a son aperçu dans l'admin", THEMES.every((t) => adminJs.includes(`{ key: "${t}", label:`)));
const fontKeys = [...new Set([...TITLE_FONTS, ...BODY_FONTS])];
check("chaque police est connue de la page et de l'admin (mêmes paramètres Google Fonts)",
      fontKeys.every((k) => {
        const page = new RegExp(`\\b${k}: \\["[^"]+", "([^"]+)"`).exec(pageJs);
        const admin = new RegExp(`\\b${k}: \\["[^"]+", "([^"]+)"`).exec(adminJs);
        return page && admin && page[1] === admin[1];
      }));

check("langue : anglais ou français acceptés, le reste refusé",
      readPresentation({ language: "en" }, new Set()).fields?.language === "en" && Boolean(readPresentation({ language: "de" }, new Set()).error));
check("langue transmise au client, français par défaut",
      presentationForClient({ language: "en" }, new Set()).language === "en" && presentationForClient({}, new Set()).language === "fr");

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} vérifications réussies`);
process.exit(failed ? 1 : 0);
