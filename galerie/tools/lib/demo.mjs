// Galerie de démonstration, créée à l'inscription : le photographe voit
// tout de suite ce que vit son client (galerie protégée, filigrane à son
// nom, sélection, forfait et suppléments) sans avoir rien à téléverser.
//
// Photos libres de droits (Unsplash, voir demo/*.json), traitées exactement
// comme de vraies photos : tuiles, filigrane, empreinte invisible. Une
// « cliente » simulée ouvre ensuite la galerie par l'API publique, comme le
// ferait un vrai client : coups de cœur, commentaire, codes couleur — de
// vraies lignes dans le journal, rien d'inventé côté base.
//
// Hors quota (une seule par compte, voir worker/src/admin.js), jamais
// comptée dans les statistiques ; le photographe la supprime quand il veut.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { processPhoto, DEFAULTS } from "./pipeline.mjs";

const DEMO_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "demo");

// Forfait de la démo : 5 photos incluses, 15 € la suivante ; la cliente en
// garde 7, soit 2 suppléments (30 €) à régler en ligne.
const INCLUDED = 5;
const EXTRA_PRICE = 15;
const FAVORITES = [0, 1, 2, 4, 6, 8, 9];
const TAGS = { 1: "green", 4: "yellow", 9: "red" };

const TEXTS = {
  fr: {
    title: "Séance famille Martin (démo)",
    clientName: "Famille Martin",
    comment: "Celle-ci, ce serait possible en noir et blanc aussi ?",
  },
  en: {
    title: "The Martin family session (demo)",
    clientName: "The Martins",
    comment: "Could we have this one in black and white too?",
  },
};

export async function demoPhotoFiles(dir = DEMO_DIR) {
  try {
    return (await readdir(dir)).filter((f) => /\.(webp|jpe?g|png)$/i.test(f)).sort((a, b) => a.localeCompare(b)).map((f) => join(dir, f));
  } catch {
    return []; // dossier absent (image Docker sans démo) : pas de démo, sans erreur
  }
}

// Ordre d'affichage voulu (famille, puis bébé), indépendant de l'ordre
// alphabétique des fichiers.
const ORDER = ["famille-champ", "parents", "plage", "famille-lit", "lecture", "garcon", "ourson", "petons", "nouveau-ne", "grossesse", "epaules"];
function ordered(files) {
  const rank = (f) => {
    const i = ORDER.findIndex((name) => f.includes(name));
    return i === -1 ? ORDER.length : i;
  };
  return [...files].sort((a, b) => rank(a) - rank(b));
}

function demoSlug() {
  return `demo-${randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "")}`.slice(0, 20);
}

function demoPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i % 4 === 3 && i !== 11) out += "-";
  }
  return out;
}

/**
 * Crée la galerie (rapide) et renvoie aussitôt `{ slug, total, done }` ;
 * `done` se résout une fois les photos envoyées et la cliente simulée passée.
 * Ne lève jamais : une démo ratée ne doit pas gêner l'inscription.
 *
 * @param {import("./client.mjs").WorkerClient} client session du photographe
 * @param {object} options
 * @param {string} options.api URL du Worker (API publique de la galerie)
 * @param {string} options.forensicKey
 * @param {string} options.studioName
 * @param {"fr"|"en"} [options.language]
 * @param {(fn: () => Promise<any>) => Promise<any>} [options.slot] file d'attente du traitement d'image
 */
export async function createDemoGallery(client, { api, forensicKey, studioName, language = "fr", slot = (fn) => fn() }) {
  const files = ordered(await demoPhotoFiles());
  if (!files.length) return null;
  const t = TEXTS[language] || TEXTS.fr;
  const password = demoPassword();
  let slug = demoSlug();
  let created;
  try {
    created = await client.createGallery({
      demo: true, slug, title: t.title, clientName: t.clientName, password,
      watermarkText: [studioName, t.clientName].filter(Boolean).join("  ·  "),
      includedPhotos: INCLUDED, extraPhotoPrice: EXTRA_PRICE, language,
    });
  } catch (err) {
    // Déjà une démo (409) ou Worker indisponible : rien à faire.
    if (err?.status !== 409) console.error("Galerie de démonstration non créée :", err?.message || err);
    return null;
  }

  const done = (async () => {
    const photoIds = [];
    for (let i = 0; i < files.length; i++) {
      try {
        const input = await readFile(files[i]);
        const { photo, tiles } = await slot(() =>
          processPhoto(input, { galleryId: created.id, forensicKey, watermarkText: [studioName, t.clientName].filter(Boolean).join("  ·  "), position: i, maxWidth: DEFAULTS.maxWidth })
        );
        await client.addPhoto(slug, { ...photo, sourceName: files[i].split("/").pop() });
        for (const tile of tiles) await client.putTile(photo.id, tile.level, tile.col, tile.row, tile.buffer);
        photoIds.push(photo.id);
      } catch (err) {
        // Galerie supprimée entre-temps (le photographe n'a pas attendu) :
        // inutile d'envoyer la suite, ni de simuler la cliente.
        if (err?.status === 404) return;
        console.error(`Démo : photo ${i + 1} non envoyée :`, err?.message || err);
        photoIds.push(null);
      }
    }
    await simulateClient(api, slug, password, photoIds, t).catch((err) =>
      console.error("Démo : visite de la cliente simulée interrompue :", err?.message || err));
  })();

  return { slug, total: files.length, done };
}

// La cliente ouvre sa galerie et fait sa sélection, par l'API publique.
async function simulateClient(api, slug, password, photoIds, t) {
  const base = `${api.replace(/\/$/, "")}/api/gallery/${encodeURIComponent(slug)}`;
  const post = async (action, body, token) => {
    const res = await fetch(`${base}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${action} : HTTP ${res.status}`);
    return res.json().catch(() => ({}));
  };
  const { token } = await post("login", { password });
  for (const index of FAVORITES) {
    if (photoIds[index]) await post("select", { photoId: photoIds[index], selected: true }, token);
  }
  for (const [index, tag] of Object.entries(TAGS)) {
    if (photoIds[index]) await post("tag", { photoId: photoIds[index], tag }, token);
  }
  if (photoIds[2]) await post("comment", { photoId: photoIds[2], comment: t.comment }, token);
}
