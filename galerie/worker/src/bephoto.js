// Client de l'API BePhoto (labo belge des photos scolaires).
//
// L'API est minimaliste : connexion par e-mail et mot de passe du compte
// (jeton Bearer), catalogue des produits, puis une commande se crée, reçoit
// ses lignes une à une (produit, papier, quantité, adresse publique du
// fichier JPEG que le labo vient télécharger) et se confirme. Chaque
// photographe connecte SON compte : c'est lui que le labo facture.
//
// Tout ce qui ne touche pas au réseau est exporté pour être testé sans lui.

export const BEPHOTO_BASE = "https://api.bephoto.be";
export const PAPERS = { 1: "Brillant", 2: "Lustré" };
export const METADATA_MAX = 255;

// BEPHOTO_API_BASE ne sert qu'aux tests locaux (faux labo sur localhost).
export function bephotoBase(env) {
  return String(env.BEPHOTO_API_BASE || BEPHOTO_BASE).replace(/\/+$/, "");
}

export class BephotoError extends Error {
  constructor(message, { status = 0, unauthorized = false } = {}) {
    super(message);
    this.status = status;
    this.unauthorized = unauthorized;
  }
}

function ok(data) {
  return data && (data.status === 1 || data.status === "1");
}

async function call(env, method, path, { token, body } = {}) {
  let response;
  try {
    response = await fetch(bephotoBase(env) + path, {
      method,
      headers: {
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new BephotoError("BePhoto ne répond pas");
  }
  const data = await response.json().catch(() => null);
  if (response.status === 401 || response.status === 403 || data?.error === "Unauthorized") {
    throw new BephotoError("Connexion à BePhoto refusée", { status: response.status, unauthorized: true });
  }
  if (!response.ok || !ok(data)) {
    const detail = typeof data?.error === "string" ? data.error : typeof data?.message === "string" ? data.message : `HTTP ${response.status}`;
    throw new BephotoError(`BePhoto a refusé la demande (${detail.slice(0, 160)})`, { status: response.status });
  }
  return data;
}

export async function bephotoLogin(env, email, password) {
  const data = await call(env, "POST", "/user/login", { body: { email, password } });
  if (typeof data.token !== "string" || !data.token) throw new BephotoError("BePhoto n'a pas renvoyé de jeton");
  return data.token;
}

// Catalogue normalisé : nombres en nombres, prix en centimes par papier.
export function normalizeProducts(products) {
  return (Array.isArray(products) ? products : []).map((p) => ({
    idproduct: Number(p.idproduct),
    name: String(p.product ?? "").trim(),
    dimensions: String(p.dimensions ?? "").trim(),
    prices: (Array.isArray(p.prices) ? p.prices : [])
      .map((pr) => ({ idpaper: Number(pr.idpaper), cents: Math.round(Number(pr.price) * 100) }))
      .filter((pr) => Number.isInteger(pr.idpaper) && Number.isFinite(pr.cents)),
  })).filter((p) => Number.isInteger(p.idproduct) && p.idproduct > 0 && p.name);
}

export async function bephotoProducts(env, token) {
  return normalizeProducts((await call(env, "GET", "/products", { token })).products);
}

function firstOrder(data) {
  const order = Array.isArray(data.order) ? data.order[0] : data.order;
  if (!order || order.idorder === undefined || order.idorder === null) throw new BephotoError("BePhoto n'a pas renvoyé de commande");
  return order;
}

export async function bephotoCreateOrder(env, token, metadata) {
  return firstOrder(await call(env, "POST", "/orders", { token, body: { metadata: String(metadata || "").slice(0, METADATA_MAX) } }));
}

export async function bephotoGetOrder(env, token, idorder) {
  return firstOrder(await call(env, "GET", `/orders/${encodeURIComponent(idorder)}`, { token }));
}

export async function bephotoAddProduct(env, token, idorder, item) {
  await call(env, "POST", `/orders/${encodeURIComponent(idorder)}/products`, {
    token,
    body: {
      idproduct: item.idproduct, idpaper: item.idpaper, quantity: item.quantity,
      fileurl: item.fileurl, filename: item.filename, filesize: item.filesize,
    },
  });
}

export async function bephotoCloseOrder(env, token, idorder) {
  await call(env, "POST", `/orders/${encodeURIComponent(idorder)}/close`, { token, body: {} });
}

// Nom de fichier lisible au labo, qui trie de lui-même par groupe puis par
// enfant : 01_P2_007_Lea_Pochette-Classique_13x18.jpg (ASCII, sans espace).
export function labFilename({ groupIndex, groupName, childNumber, childFirstName, productName, part }) {
  const safe = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/×/g, "x").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return [
    String(groupIndex).padStart(2, "0"), safe(groupName) || "groupe", String(childNumber || 0).padStart(3, "0"),
    safe(childFirstName), safe(productName), safe(part),
  ].filter(Boolean).join("_").slice(0, 150) + ".jpg";
}

// Composition labo d'un produit Holypixx (ce qui s'imprime pour un
// exemplaire), validée : 1 à 12 éléments, quantités 1 à 50, papier connu.
export function normalizeLabItems(items) {
  if (!Array.isArray(items)) return { error: "Composition invalide" };
  if (items.length > 12) return { error: "12 éléments au maximum par produit" };
  const out = [];
  for (const item of items) {
    const idproduct = Number(item?.idproduct);
    const idpaper = Number(item?.idpaper);
    const quantity = Number(item?.quantity);
    if (!Number.isInteger(idproduct) || idproduct <= 0) return { error: "Produit BePhoto invalide" };
    if (!PAPERS[idpaper]) return { error: "Papier inconnu (1 brillant, 2 lustré)" };
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) return { error: "Quantité invalide (1 à 50)" };
    out.push({ idproduct, idpaper, quantity, label: String(item?.label ?? "").trim().slice(0, 80) });
  }
  return { items: out };
}

/* ---------- Planches (montages composés par le labo) ---------- */

// Grille publique « Planches / Montages » de BePhoto
// (https://www.bephoto.be/fr/prices, relevée le 8 octobre 2026) : le labo
// compose la planche à partir d'UNE photo envoyée. Prix TTC par palier
// (à partir de 1, 25 ou 50 photos du lot), en centimes. `preview` = visuel
// d'exemple sur neworder.bephoto.be, recopié une fois chez nous (R2) par
// handleLabPreview : les familles ne chargent jamais rien chez le labo. Les
// visuels sont des schémas de composition (une case par photo, formats en
// cm, cases grises en noir et blanc) ; `label` les décrit en français,
// `name` garde le nom du labo.
export const BEPHOTO_PREVIEW_BASE = "https://neworder.bephoto.be";
export const BEPHOTO_PLANCHES = [
  { id: 163, label: "2 photos 6,5×9", name: "2 6x9 on9x13", dimensions: "127 x 90mm", preview: "/images/products/formats/montages/163-1600185466.jpg", cents: { from1: 14, from25: 20, from50: 14 } },
  { id: 1013, label: "4 photos 5×7,5", name: "4 5x7,5 on 10x15", dimensions: "152 x 102mm", preview: "/images/products/formats/montages/1013-1600239820.jpg", cents: { from1: 15, from25: 25, from50: 16 } },
  { id: 1033, label: "1 photo 9×13 + 2 photos 6×9 (dont 1 noir et blanc)", name: "1 9x13 - 1 6x9 - 1 6x9 BW on 13x18", dimensions: "127 x 178mm", preview: "/images/products/formats/montages/1033-1600243157.jpg", cents: { from1: 32, from25: 55, from50: 32 } },
  { id: 130, label: "8 photos 4×6", name: "8 4x6 on 13x18", dimensions: "178 x 127mm", preview: "/images/products/formats/montages/130-1600378947.jpg", cents: { from1: 65, from25: 55, from50: 32 } },
  { id: 132, label: "2 photos 9×13", name: "2 9x13 on 13x18", dimensions: "127 x 178mm", preview: "/images/products/formats/montages/132-1600182457.jpg", cents: { from1: 65, from25: 55, from50: 32 } },
  { id: 180, label: "2 photos 9×13", name: "2 9x13 on 13x18", dimensions: "127 x 178mm", preview: "/images/products/formats/montages/180-1600239486.jpg", cents: { from1: 65, from25: 55, from50: 32 } },
  { id: 181, label: "8 photos 4×6", name: "8 photos on 13x18", dimensions: "127 x 178mm", preview: "/images/products/formats/montages/181-1600239414.jpg", cents: { from1: 65, from25: 55, from50: 32 } },
  { id: 188, label: "4 photos 6×9", name: "4 6x9 on 13x18", dimensions: "127 x 178mm", preview: "/images/products/formats/montages/188-1600182454.jpg", cents: { from1: 65, from25: 55, from50: 32 } },
  { id: 1031, label: "2 photos 6×9 + 4 photos 4×6", name: "2 6x9 - 4 4x6 on 13x18", dimensions: "127 x 178mm", preview: "/images/products/formats/montages/1031-1600241538.jpg", cents: { from1: 65, from25: 55, from50: 32 } },
  { id: 1032, label: "9 photos 4×5,5", name: "montage_13x18_9_3x5", dimensions: "127 x 178mm", preview: "/images/products/formats/montages/1032-1600240685.jpg", cents: { from1: 65, from25: 55, from50: 32 } },
  { id: 1034, label: "1 photo 8×11 + 5 photos 4×5,5 (dont 2 noir et blanc)", name: "1 8x12 - 3 4x6 - 2 4x6 BW on 13x18", dimensions: "127 x 178mm", preview: "/images/products/formats/montages/1034-1600244243.jpg", cents: { from1: 65, from25: 55, from50: 32 } },
  { id: 1051, label: "3 photos 6×9 + 4 photos d'identité", name: "3 6x9 - 4 ID on 13x18", dimensions: "127 x 178mm", preview: "/images/products/formats/montages/1051-1600242027.jpg", cents: { from1: 65, from25: 55, from50: 32 } },
  { id: 1025, label: "1 photo 9×13 + 5 photos 4×6", name: "1 9x13 - 5 4x6 on 13x19", dimensions: "127 x 190mm", preview: "/images/products/formats/montages/1025-1600240054.jpg", cents: { from1: 69, from25: 59, from50: 35 } },
  { id: 156, label: "8 photos 5×7,5", name: "lefour15x20", dimensions: "152 x 203mm", preview: "/images/products/formats/montages/156-1600246537.jpg", cents: { from1: 75, from25: 65, from50: 39 } },
  { id: 157, label: "4 photos 5×7 (dont 1 noir et blanc, 1 sépia) + 6 photos d'identité", name: "hamoline15x21", dimensions: "152 x 210mm", preview: "/images/products/formats/montages/157-1600246556.jpg", cents: { from1: 79, from25: 69, from50: 40 } },
  { id: 1054, label: "1 photo 11×14 + 2 photos 5×6,5 + 4 photos 4×5", name: "scolaire15x21", dimensions: "152 x 210mm", preview: "/images/products/formats/montages/1054-1600244549.jpg", cents: { from1: 79, from25: 69, from50: 40 } },
  { id: 1057, label: "4 photos 5×7 (dont 2 noir et blanc) + 6 photos d'identité", name: "planche15x21", dimensions: "152 x 210mm", preview: "/images/products/formats/montages/1057-1600245575.jpg", cents: { from1: 79, from25: 69, from50: 40 } },
  { id: 1066, label: "4 photos 5×7 + 6 photos d'identité", name: "plancheCouleur15x21", dimensions: "152 x 210mm", preview: "/images/products/formats/montages/1066-1600245634.jpg", cents: { from1: 79, from25: 69, from50: 40 } },
  { id: 160, label: "1 photo 9×13 + 2 photos 4×6 + 8 photos d'identité", name: "9x13 ,ID sur 15x23", dimensions: "152 x 230mm", preview: "/images/products/formats/montages/160-1600184965.jpg", cents: { from1: 85, from25: 70, from50: 45 } },
  { id: 1073, label: "1 photo 10×15 + 2 photos 6×9 + 4 photos 3×5", name: "dekoninck_15x23", dimensions: "152 x 228mm", preview: "/images/products/formats/montages/1073-1600246620.jpg", cents: { from1: 85, from25: 70, from50: 45 } },
  { id: 165, label: "2 photos 9×13 + 8 photos d'identité", name: "lackner18x24id", dimensions: "178 x 240mm", preview: "/images/products/formats/montages/165-1600237920.jpg", cents: { from1: 150, from25: 99, from50: 69 } },
  { id: 1079, label: "1 photo 12×18 + 1 photo 6×9 + 4 photos 4×6", name: "scolaire_20x21_12x18_6x9_4_4X6", dimensions: "203 x 210mm", preview: "/images/products/formats/montages/1079-1600245979.jpg", cents: { from1: 150, from25: 120, from50: 99 } },
  { id: 1120, label: "2 photos 9×13 + 3 photos 6×8 + 5 photos 3×4 (sans visuel)", name: "18x24_2_9x13_3_8x6_5_4x3", dimensions: "178 x 240mm", preview: "", cents: { from1: 150, from25: 99, from50: 69 } },
  { id: 118, label: "1 photo 13×19 + 2 photos 6,5×9,5 + 4 photos 4×6,5 + 4 photos d'identité", name: "bephoto_20x30", dimensions: "203 x 300mm", preview: "/images/products/formats/montages/118-1600237777.jpg", cents: { from1: 219, from25: 171, from50: 120 } },
  { id: 178, label: "2 photos 8×12 + 3 photos 6×9 + 11 photos d'identité", name: "marotte20x30", dimensions: "203 x 305mm", preview: "/images/products/formats/montages/178-1600239288.jpg", cents: { from1: 219, from25: 171, from50: 120 } },
  { id: 420, label: "Planche 20×30 à l'italienne (sans visuel)", name: "Planche20x30", dimensions: "305 x 203mm", preview: "", cents: { from1: 219, from25: 171, from50: 120 } },
];

export function plancheById(id) {
  return BEPHOTO_PLANCHES.find((p) => p.id === Number(id)) || null;
}

// Adresse (relative à l'API) du visuel d'une planche, ou "" sans visuel.
export function planchePreviewPath(id) {
  const planche = plancheById(id);
  return planche?.preview ? `/api/lab-previews/bephoto/${planche.id}.jpg` : "";
}

// Visuel d'un produit Holypixx : celui de la première planche de sa
// composition labo.
export function previewForLabItems(items) {
  for (const item of Array.isArray(items) ? items : []) {
    const path = planchePreviewPath(item.idproduct);
    if (path) return path;
  }
  return "";
}

// Format de la feuille, en cm (« 13×18 ») d'après ses dimensions en mm.
export function plancheSheet(planche) {
  const m = /(\d+)\s*x\s*(\d+)/.exec(planche.dimensions);
  if (!m) return "";
  const [a, b] = [Number(m[1]), Number(m[2])].sort((x, y) => x - y);
  // Formats du commerce : 305 mm se lit 30 cm (20×30), 178 mm 18 cm (13×18).
  const cm = (mm) => Math.round(mm / 10 - 0.05);
  return `${cm(a)}×${cm(b)}`;
}

// Fourchette de prix d'une planche (les paliers de la grille ne sont pas
// toujours dans l'ordre : on prend le plus bas et le plus haut).
export function plancheRange(planche) {
  const values = Object.values(planche.cents);
  return { minCents: Math.min(...values), maxCents: Math.max(...values) };
}
