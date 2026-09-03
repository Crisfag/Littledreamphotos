// Primitives cryptographiques (WebCrypto, disponible nativement dans un Worker).
//
// Deux mécanismes distincts :
//  - hachage de mot de passe (PBKDF2-SHA256) pour l'accès client à une galerie ;
//  - jetons de session signés (HMAC-SHA256) pour autoriser le chargement des tuiles.

const enc = new TextEncoder();

const PBKDF2_ITERATIONS = 150000;

export function b64(bytes) {
  let s = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
  return btoa(s);
}

export function unb64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// URL-safe, sans padding : utilisable dans un jeton.
export function b64url(bytes) {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64url(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return unb64(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

// Comparaison à temps constant : évite qu'un attaquant devine un secret
// octet par octet en mesurant le temps de réponse.
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password, saltBytes) {
  const salt = saltBytes || randomBytes(16);
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return { hash: b64(bits), salt: b64(salt) };
}

export async function verifyPassword(password, storedHash, storedSalt) {
  const { hash } = await hashPassword(password, unb64(storedSalt));
  return timingSafeEqual(unb64(hash), unb64(storedHash));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

// Jeton compact : <payload base64url>.<signature base64url>
// Le payload contient la galerie visée, l'identifiant anonyme du visiteur
// (utile pour les journaux d'accès) et l'expiration.
export async function signToken(secret, payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

export async function verifyToken(secret, token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".", 2);
  let expected;
  try {
    expected = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  } catch {
    return null;
  }
  let given;
  try {
    given = unb64url(sig);
  } catch {
    return null;
  }
  if (!timingSafeEqual(new Uint8Array(expected), given)) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(unb64url(body)));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
  return payload;
}

// Les journaux d'accès ne doivent pas stocker d'IP en clair (RGPD) :
// on garde une empreinte salée, suffisante pour distinguer deux visiteurs.
export async function hashIp(ip, secret) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(`${secret}:${ip || "?"}`));
  return b64(digest).slice(0, 16);
}
