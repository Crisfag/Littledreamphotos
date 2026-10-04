// Vérifie la musique d'ambiance sans réseau ni D1 : lecture des liens
// Spotify / Deezer / SoundCloud / YouTube et ce que reçoit la page client.
//
//   node tests/music.test.mjs

import { embedFromLink, providerOfEmbed, musicForClient, audioKeyFor, MUSIC_MOODS } from "../src/music.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const SPOTIFY_ID = "4uLU6hMCjMI75M1A2tKUQC";
const cases = [
  [`https://open.spotify.com/track/${SPOTIFY_ID}?si=abc123`, "spotify", `https://open.spotify.com/embed/track/${SPOTIFY_ID}`],
  [`https://open.spotify.com/intl-fr/playlist/${SPOTIFY_ID}`, "spotify", `https://open.spotify.com/embed/playlist/${SPOTIFY_ID}`],
  [`open.spotify.com/album/${SPOTIFY_ID}`, "spotify", `https://open.spotify.com/embed/album/${SPOTIFY_ID}`],
  [`spotify:track:${SPOTIFY_ID}`, "spotify", `https://open.spotify.com/embed/track/${SPOTIFY_ID}`],
  ["https://www.deezer.com/fr/track/3135556", "deezer", "https://widget.deezer.com/widget/auto/track/3135556"],
  ["https://www.deezer.com/playlist/908622995", "deezer", "https://widget.deezer.com/widget/auto/playlist/908622995"],
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42", "youtube", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
  ["https://youtu.be/dQw4w9WgXcQ", "youtube", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
  ["https://music.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
  ["https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG", "youtube", "https://www.youtube-nocookie.com/embed/videoseries?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG"],
];
for (const [link, provider, embedUrl] of cases) {
  const parsed = embedFromLink(link);
  check(`lien ${provider} reconnu : ${link.slice(0, 50)}`, parsed.provider === provider && parsed.embedUrl === embedUrl, JSON.stringify(parsed));
}

const sc = embedFromLink("https://soundcloud.com/artiste-1/un-morceau?in=x");
check("lien SoundCloud converti en lecteur officiel, sans lecture automatique",
      sc.provider === "soundcloud" && sc.embedUrl.startsWith("https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fartiste-1%2Fun-morceau&") &&
      sc.embedUrl.includes("auto_play=false"), sc.embedUrl);
check("playlist SoundCloud (sets) reconnue", embedFromLink("https://soundcloud.com/artiste/sets/ma-playlist").provider === "soundcloud");

const refused = [
  "",
  "https://example.com/musique.mp3",
  "javascript:alert(1)",
  "https://open.spotify.com/track/court",
  "https://open.spotify.com/user/quelquun",
  "https://www.deezer.com/fr/artist/27",
  "https://www.youtube.com/watch?v=trop-court",
  "https://soundcloud.com/artiste",
  "https://soundcloud.com/a/b/c/d",
  "https://evil.com/open.spotify.com/track/" + SPOTIFY_ID,
  "https://open.spotify.com.evil.com/track/" + SPOTIFY_ID,
];
check("tout autre lien est refusé avec une explication (site inconnu, identifiant invalide, piège)",
      refused.every((l) => typeof embedFromLink(l).error === "string" && !embedFromLink(l).embedUrl),
      refused.filter((l) => !embedFromLink(l).error).join(" | "));
check("un lien raccourci est refusé avec la marche à suivre",
      /adresse complète/.test(embedFromLink("https://spotify.link/AbCdEf").error || "") &&
      /adresse complète/.test(embedFromLink("https://deezer.page.link/xyz").error || ""));
const injected = embedFromLink(`https://open.spotify.com/track/${SPOTIFY_ID}"><script>`);
check("rien de ce qui est collé n'arrive tel quel dans l'adresse du lecteur",
      !injected.embedUrl || !/[<>"]/.test(injected.embedUrl), JSON.stringify(injected));

check("le fournisseur se retrouve d'après l'adresse du lecteur",
      providerOfEmbed(`https://open.spotify.com/embed/track/${SPOTIFY_ID}`) === "spotify" && providerOfEmbed("https://ailleurs.com/x") === "");

const base = { id: "gal_1", music_name: "", music_track_id: "", music_embed: "" };
check("sans musique, la page client ne reçoit rien", musicForClient(base, null) === null && audioKeyFor(base) === null);
const track = { id: "mus_abcdefgh", title: "Matin doux", artist: "Kevin MacLeod", credit: "CC BY 4.0" };
const lib = musicForClient({ ...base, music_track_id: track.id }, track);
check("une piste de bibliothèque est jouée comme un MP3, avec son crédit",
      lib.kind === "audio" && lib.title === "Matin doux" && lib.credit === "CC BY 4.0" &&
      audioKeyFor({ ...base, music_track_id: track.id }) === "library/music/mus_abcdefgh.mp3");
check("un MP3 importé reste lu depuis son emplacement habituel",
      musicForClient({ ...base, music_name: "a.mp3" }, null).kind === "audio" && audioKeyFor({ ...base, music_name: "a.mp3" }) === "music/gal_1.mp3");
const embed = musicForClient({ ...base, music_embed: `https://open.spotify.com/embed/track/${SPOTIFY_ID}` }, null);
check("un lien est transmis comme lecteur intégré, avec le nom du service",
      embed.kind === "embed" && embed.provider === "spotify" && embed.providerLabel === "Spotify");
check("une adresse de lecteur inattendue en base n'est jamais transmise",
      musicForClient({ ...base, music_embed: "https://evil.com/x" }, null) === null);
check("les ambiances de la bibliothèque sont définies", Object.keys(MUSIC_MOODS).length >= 5);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
