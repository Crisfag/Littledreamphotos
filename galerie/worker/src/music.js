// Musique d'ambiance des galeries : trois sources possibles, une seule à la
// fois par galerie.
//
//  1. Bibliothèque commune : morceaux libres de droits ajoutés par la
//     propriétaire de la plateforme (onglet Admin), choisis en un clic par
//     les photographes, joués en fond chez le client sans aucun compte.
//  2. Lien Spotify / Deezer / SoundCloud / YouTube : converti ici en adresse
//     du lecteur intégré officiel de la plateforme (seule façon autorisée de
//     diffuser leur catalogue sur un site). Côté client, ce lecteur n'est
//     chargé qu'au clic.
//  3. Fichier MP3 du photographe (route historique, voir admin.js).
//
// Tout ce qui est « pur » (lecture des liens, présentation au client) est
// exporté pour être testé sans réseau (tests/music.test.mjs).

import { json, fail } from "./http.js";
import { randomBytes, b64url } from "./auth.js";

export const MUSIC_MOODS = {
  douce: "Douce",
  joyeuse: "Joyeuse",
  romantique: "Romantique",
  piano: "Piano",
  acoustique: "Acoustique",
  cinematique: "Cinématique",
  enfance: "Enfance",
};

export const MAX_MUSIC_BYTES = 15 * 1024 * 1024;

export const EMBED_PROVIDERS = {
  spotify: { label: "Spotify", prefix: "https://open.spotify.com/embed/" },
  deezer: { label: "Deezer", prefix: "https://widget.deezer.com/widget/auto/" },
  soundcloud: { label: "SoundCloud", prefix: "https://w.soundcloud.com/player/?url=" },
  youtube: { label: "YouTube", prefix: "https://www.youtube-nocookie.com/embed/" },
};

const SHORT_LINK = /(^|\.)(spotify\.link|deezer\.page\.link|link\.deezer\.com|on\.soundcloud\.com)$/;

// Lien collé par le photographe → { provider, embedUrl } ou { error }.
// Seuls des identifiants au format attendu sont recopiés dans l'adresse du
// lecteur : rien de ce qui est collé n'arrive tel quel dans la page client.
export function embedFromLink(raw) {
  const text = String(raw || "").trim();
  if (!text) return { error: "Collez le lien d'un morceau ou d'une playlist" };

  const spotifyUri = /^spotify:(track|album|playlist|episode|show):([A-Za-z0-9]{22})$/.exec(text);
  if (spotifyUri) return spotify(spotifyUri[1], spotifyUri[2]);

  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { error: "Ce lien n'est pas valide" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "Ce lien n'est pas valide" };
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  const segments = url.pathname.split("/").filter(Boolean);

  if (SHORT_LINK.test(host)) {
    return { error: "C'est un lien raccourci : ouvrez-le dans votre navigateur, puis copiez l'adresse complète qui s'affiche." };
  }

  if (host === "open.spotify.com") {
    const parts = segments[0] && /^intl-[a-z-]+$/i.test(segments[0]) ? segments.slice(1) : segments;
    const [type, id] = parts;
    if (/^(track|album|playlist|episode|show)$/.test(type || "") && /^[A-Za-z0-9]{22}$/.test(id || "")) return spotify(type, id);
    return { error: "Lien Spotify non reconnu : copiez le lien d'un titre, d'un album ou d'une playlist (Partager → Copier le lien)." };
  }

  if (host === "deezer.com") {
    const parts = segments[0] && /^[a-z]{2}$/i.test(segments[0]) ? segments.slice(1) : segments;
    const [type, id] = parts;
    if (/^(track|album|playlist)$/.test(type || "") && /^\d{1,15}$/.test(id || "")) {
      return { provider: "deezer", embedUrl: `${EMBED_PROVIDERS.deezer.prefix}${type}/${id}` };
    }
    return { error: "Lien Deezer non reconnu : copiez le lien d'un titre, d'un album ou d'une playlist." };
  }

  if (host === "soundcloud.com") {
    const ok = segments.length >= 2 && segments.length <= 3 && segments.every((s) => /^[A-Za-z0-9_-]{1,100}$/.test(s)) &&
      (segments.length === 2 || segments[1] === "sets");
    if (!ok) return { error: "Lien SoundCloud non reconnu : copiez le lien d'un morceau ou d'une playlist." };
    const page = `https://soundcloud.com/${segments.join("/")}`;
    return {
      provider: "soundcloud",
      embedUrl: `${EMBED_PROVIDERS.soundcloud.prefix}${encodeURIComponent(page)}&color=%23b98a7a&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=false`,
    };
  }

  if (host === "youtube.com" || host === "music.youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    const list = url.searchParams.get("list");
    let video = null;
    if (host === "youtu.be") video = segments[0];
    else if (segments[0] === "watch") video = url.searchParams.get("v");
    else if (segments[0] === "shorts" || segments[0] === "embed" || segments[0] === "live") video = segments[1];
    if (video && /^[A-Za-z0-9_-]{11}$/.test(video)) {
      return { provider: "youtube", embedUrl: `${EMBED_PROVIDERS.youtube.prefix}${video}` };
    }
    if (list && /^[A-Za-z0-9_-]{10,64}$/.test(list)) {
      return { provider: "youtube", embedUrl: `${EMBED_PROVIDERS.youtube.prefix}videoseries?list=${list}` };
    }
    return { error: "Lien YouTube non reconnu : copiez le lien d'une vidéo ou d'une playlist." };
  }

  return { error: "Seuls les liens Spotify, Deezer, SoundCloud et YouTube sont acceptés." };
}

function spotify(type, id) {
  return { provider: "spotify", embedUrl: `${EMBED_PROVIDERS.spotify.prefix}${type}/${id}` };
}

// Fournisseur d'une adresse de lecteur déjà enregistrée ("" si inconnue).
export function providerOfEmbed(embedUrl) {
  for (const [key, provider] of Object.entries(EMBED_PROVIDERS)) {
    if (String(embedUrl || "").startsWith(provider.prefix)) return key;
  }
  return "";
}

// Ce que la page client reçoit à la connexion. `track` : la ligne de la
// bibliothèque si la galerie en utilise une.
export function musicForClient(gallery, track) {
  if (gallery.music_embed) {
    const provider = providerOfEmbed(gallery.music_embed);
    if (provider) return { kind: "embed", provider, providerLabel: EMBED_PROVIDERS[provider].label, embedUrl: gallery.music_embed };
  }
  if (gallery.music_track_id && track) {
    return { kind: "audio", title: track.title, artist: track.artist, credit: track.credit };
  }
  if (gallery.music_name) return { kind: "audio" };
  return null;
}

// Clé R2 du fichier joué pour une galerie (bibliothèque ou MP3 importé).
export function audioKeyFor(gallery) {
  if (gallery.music_track_id) return `library/music/${gallery.music_track_id}.mp3`;
  if (gallery.music_name) return `music/${gallery.id}.mp3`;
  return null;
}

// Sert un MP3 de R2 en honorant les requêtes partielles (Range) : Safari
// refuse de lire un média sans ça.
export async function serveAudio(request, env, key) {
  const wantsRange = request.headers.has("range");
  let object;
  try {
    object = await env.TILES.get(key, wantsRange ? { range: request.headers } : undefined);
  } catch {
    return new Response(null, { status: 416, headers: { "content-range": "bytes */*" } });
  }
  if (!object) return fail(404, "Aucune musique");

  const headers = new Headers({
    "content-type": "audio/mpeg",
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=3600",
  });
  if (wantsRange && object.range && typeof object.range.offset === "number") {
    const start = object.range.offset;
    const length = object.range.length ?? object.size - start;
    headers.set("content-range", `bytes ${start}-${start + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
}

function trackOut(row) {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    mood: row.mood,
    moodLabel: MUSIC_MOODS[row.mood] || "",
    credit: row.credit,
    durationSeconds: row.duration_s || 0,
  };
}

export async function getTrack(env, trackId) {
  if (!trackId) return null;
  return env.DB.prepare("SELECT * FROM music_tracks WHERE id = ?").bind(trackId).first();
}

// Liste de la bibliothèque, pour l'admin (photographes et propriétaire).
export async function listLibrary(env) {
  const { results } = await env.DB.prepare("SELECT * FROM music_tracks ORDER BY mood ASC, title COLLATE NOCASE ASC").all();
  return json({ moods: MUSIC_MOODS, tracks: results.map(trackOut) });
}

// Écoute d'un morceau de la bibliothèque (aperçu dans l'admin) : ce sont des
// morceaux libres de droits, publics par nature.
export async function handleLibraryAudio(request, env, trackId) {
  if (!/^mus_[A-Za-z0-9_-]{6,40}$/.test(trackId || "")) return fail(404, "Morceau inconnu");
  const track = await getTrack(env, trackId);
  if (!track) return fail(404, "Morceau inconnu");
  return serveAudio(request, env, `library/music/${track.id}.mp3`);
}

// Choix de la musique d'une galerie (déjà vérifiée comme appartenant au
// photographe) : { source: "library", trackId } | { source: "link", url } |
// { source: "none" }. Choisir une source vide les deux autres ; le MP3
// importé éventuel est alors effacé de R2.
export async function setMusicChoice(request, env, gallery) {
  const body = await request.json().catch(() => null);
  const source = body?.source;
  let trackId = "";
  let embed = "";
  let result = {};
  if (source === "library") {
    const track = await getTrack(env, String(body.trackId || ""));
    if (!track) return fail(400, "Morceau introuvable dans la bibliothèque");
    trackId = track.id;
    result = { track: trackOut(track) };
  } else if (source === "link") {
    const parsed = embedFromLink(body.url);
    if (parsed.error) return fail(400, parsed.error);
    embed = parsed.embedUrl;
    result = { provider: parsed.provider, providerLabel: EMBED_PROVIDERS[parsed.provider].label, embedUrl: embed };
  } else if (source !== "none") {
    return fail(400, "Source de musique inconnue");
  }
  if (gallery.music_name) await env.TILES.delete(`music/${gallery.id}.mp3`);
  await env.DB.prepare("UPDATE galleries SET music_name = '', music_track_id = ?, music_embed = ? WHERE id = ?")
    .bind(trackId, embed, gallery.id)
    .run();
  return json({ ok: true, source, ...result });
}

// Ce que la fiche galerie de l'admin affiche de la musique actuelle.
export async function musicForAdmin(env, gallery) {
  if (gallery.music_embed) {
    const provider = providerOfEmbed(gallery.music_embed);
    return { source: "link", provider, providerLabel: EMBED_PROVIDERS[provider]?.label || "", embedUrl: gallery.music_embed };
  }
  if (gallery.music_track_id) {
    const track = await getTrack(env, gallery.music_track_id);
    if (track) return { source: "library", track: trackOut(track) };
  }
  if (gallery.music_name) return { source: "file", name: gallery.music_name };
  return { source: "none" };
}

/* =================================================================
   Propriétaire : gestion de la bibliothèque (appelant déjà vérifié)
   ================================================================= */

function cleanText(value, max) {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

// PUT /api/owner/music?title=…&artist=…&mood=…&credit=…&duration=… (corps : MP3)
async function addTrack(request, env) {
  const url = new URL(request.url);
  const title = cleanText(url.searchParams.get("title"), 120);
  const artist = cleanText(url.searchParams.get("artist"), 120);
  const mood = String(url.searchParams.get("mood") || "");
  const credit = cleanText(url.searchParams.get("credit"), 200);
  const duration = Math.max(0, Math.min(3600, Math.round(Number(url.searchParams.get("duration")) || 0)));
  if (!title) return fail(400, "Titre requis");
  if (!MUSIC_MOODS[mood]) return fail(400, "Ambiance inconnue");
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_MUSIC_BYTES) return fail(413, "Fichier trop volumineux (15 Mo maximum)");
  const body = await request.arrayBuffer();
  if (!body.byteLength) return fail(400, "Fichier vide");
  if (body.byteLength > MAX_MUSIC_BYTES) return fail(413, "Fichier trop volumineux (15 Mo maximum)");

  const id = `mus_${b64url(randomBytes(9))}`;
  await env.TILES.put(`library/music/${id}.mp3`, body, { httpMetadata: { contentType: "audio/mpeg" } });
  await env.DB.prepare(
    "INSERT INTO music_tracks (id, title, artist, mood, credit, duration_s, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, title, artist, mood, credit, duration, Math.floor(Date.now() / 1000))
    .run();
  return json({ ok: true, track: trackOut({ id, title, artist, mood, credit, duration_s: duration }) }, { status: 201 });
}

// Retirer un morceau : les galeries qui l'utilisaient repassent sans musique.
async function deleteTrack(env, trackId) {
  const track = await getTrack(env, trackId);
  if (!track) return fail(404, "Morceau inconnu");
  await env.DB.batch([
    env.DB.prepare("UPDATE galleries SET music_track_id = '' WHERE music_track_id = ?").bind(track.id),
    env.DB.prepare("DELETE FROM music_tracks WHERE id = ?").bind(track.id),
  ]);
  await env.TILES.delete(`library/music/${track.id}.mp3`);
  return json({ ok: true });
}

export async function handleOwnerMusic(request, env, parts) {
  if (parts.length === 3 && request.method === "GET") return listLibrary(env);
  if (parts.length === 3 && request.method === "PUT") return addTrack(request, env);
  if (parts.length === 4 && request.method === "DELETE") return deleteTrack(env, decodeURIComponent(parts[3]));
  return fail(404, "Route inconnue");
}
