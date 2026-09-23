// Vérifie POST /local/detect (identification d'une photo suspecte à partir de
// son empreinte invisible), contre un admin-server.mjs et un Worker locaux
// déjà lancés :
//
//   npx wrangler dev --local --port 8788                     (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/detect.test.mjs

import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tileRect } from "../lib/tiles.mjs";

const ADMIN = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PHOTO_A = join(REPO_ROOT, "images", "famille", "famille-01.jpeg");
const PHOTO_B = join(REPO_ROOT, "images", "maternite", "maternite-01.jpeg");

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

// Chaque compte a son propre cookie : deux sessions cloisonnées, comme deux
// personnes différentes derrière deux navigateurs.
function makeSession() {
  let cookie = "";
  return {
    headers(extra) {
      return cookie ? { ...extra, cookie } : extra;
    },
    capture(response) {
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
    },
  };
}

async function signupAndLogin(session, email, password, studioName) {
  const response = await fetch(`${ADMIN}/local/auth/signup`, {
    method: "POST",
    headers: session.headers({ "content-type": "application/json" }),
    body: JSON.stringify({ email, password, studioName }),
  });
  session.capture(response);
  return response.ok;
}

async function createGallery(session, slug, title) {
  const response = await fetch(`${ADMIN}/local/galleries`, {
    method: "POST",
    headers: session.headers({ "content-type": "application/json" }),
    body: JSON.stringify({ slug, title, password: "mot-de-passe-solide" }),
  });
  return response.json();
}

async function uploadPhoto(session, slug, filePath) {
  const buffer = await readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([buffer]), "photo.jpg");
  const response = await fetch(`${ADMIN}/local/galleries/${slug}/photos`, {
    method: "POST",
    headers: session.headers({}),
    body: form,
  });
  const data = await response.json();
  return data.photo;
}

// Reconstruit l'image telle que le client la voit réellement : tuile par
// tuile, niveau plein écran — le même canevas que gallery.js peint dans un
// <canvas>. C'est ce document-là, pas le fichier d'origine, qui doit rester
// reconnaissable après avoir « fuité ».
async function reconstructDelivered(session, photo) {
  const composites = [];
  for (let row = 0; row < photo.rows; row++) {
    for (let col = 0; col < photo.cols; col++) {
      const response = await fetch(`${ADMIN}/local/tiles/${photo.id}/1/${col}/${row}`, {
        headers: session.headers({}),
      });
      const tileBuffer = Buffer.from(await response.arrayBuffer());
      const rect = tileRect(photo.width, photo.height, photo.cols, photo.rows, col, row);
      composites.push({ input: tileBuffer, left: rect.left, top: rect.top });
    }
  }
  return sharp({ create: { width: photo.width, height: photo.height, channels: 3, background: "#000000" } })
    .composite(composites)
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function detect(session, buffer, name) {
  const form = new FormData();
  form.append("file", new Blob([buffer]), name);
  const response = await fetch(`${ADMIN}/local/detect`, { method: "POST", headers: session.headers({}), body: form });
  return { response, data: await response.json() };
}

const owner = makeSession();
const ownerEmail = `detect-owner-${RUN}@test.invalid`;
await signupAndLogin(owner, ownerEmail, "mot-de-passe-de-test-1234", "Studio Détection");
const gallery = await createGallery(owner, `detect-${RUN}`, "Séance détection");
const photo = await uploadPhoto(owner, gallery.slug, PHOTO_A);
check("la photo envoyée porte une empreinte", Boolean(photo && photo.forensicId));

const delivered = await reconstructDelivered(owner, photo);

const matchResult = await detect(owner, delivered, "leak-recomposed.jpg");
check("l'image livrée (recomposée à partir des tuiles) est reconnue",
      matchResult.response.ok && matchResult.data.status === "match", JSON.stringify(matchResult.data));
check("la bonne galerie est identifiée",
      matchResult.data.gallery?.slug === gallery.slug, matchResult.data.gallery?.slug);
check("la bonne photo est identifiée",
      matchResult.data.photo?.id === photo.id, matchResult.data.photo?.id);
check("la fiabilité dépasse largement les seuils de décision",
      matchResult.data.snr > 5 && matchResult.data.matchingBits === 32, JSON.stringify(matchResult.data));

const unrelated = await sharp(await readFile(PHOTO_B)).resize({ width: 1600 }).jpeg({ quality: 90 }).toBuffer();
const noMatchResult = await detect(owner, unrelated, "sans-rapport.jpg");
check("une image jamais envoyée n'est jamais présentée comme une correspondance",
      noMatchResult.data.status !== "match", JSON.stringify(noMatchResult.data));

// Cloisonnement : un second compte, avec ses propres galeries, ne doit
// jamais pouvoir identifier une photo qui appartient au premier — l'outil de
// détection ne corrèle qu'avec VOS propres empreintes, jamais celles d'un
// autre photographe (même logique que le reste de l'admin).
const peer = makeSession();
const peerEmail = `detect-peer-${RUN}@test.invalid`;
await signupAndLogin(peer, peerEmail, "mot-de-passe-du-voisin-1234", "Studio Voisin");
const peerResult = await detect(peer, delivered, "leak-recomposed.jpg");
check("un autre compte ne peut jamais identifier la photo de quelqu'un d'autre",
      peerResult.data.status !== "match", JSON.stringify(peerResult.data));

const noAuth = await fetch(`${ADMIN}/local/detect`, { method: "POST" });
check("vérifier une photo sans session est refusé", noAuth.status === 401);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
