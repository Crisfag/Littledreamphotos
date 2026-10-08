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
