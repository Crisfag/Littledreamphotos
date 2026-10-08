// Envoi des commandes scolaires au labo, par lots.
//
// Le photographe encaisse les commandes des familles sur son compte Stripe,
// puis, une ou deux fois pendant la vente (conseil du labo), regroupe les
// articles payés pas encore partis en un LOT : un pour l'établissement
// (livraison groupée), un pour les envois à domicile. Un article
// n'appartient qu'à un lot : il ne part jamais deux fois. Chaque lot a son
// fichier de production (admin-server) ; il peut partir à la main, ou
// directement chez BePhoto si le photographe a connecté son compte.
//
// Envoi à BePhoto pas à pas : chaque appel transmet quelques lignes et
// avance un curseur, pour rester sous les limites d'un appel du Worker et
// reprendre là où l'on s'était arrêté après une coupure. BePhoto vient
// chercher chaque fichier d'impression par une adresse signée, valable tant
// que le lot est récent.

import { json, fail } from "./http.js";
import { randomBytes, b64url } from "./auth.js";
import { encryptApiKey, decryptApiKey, signFor, verifySignature } from "./prodigi.js";
import { originalKey } from "./storage.js";
import {
  BephotoError, PAPERS, bephotoLogin, bephotoProducts, bephotoCreateOrder, bephotoAddProduct,
  bephotoCloseOrder, bephotoGetOrder, labFilename, normalizeLabItems,
} from "./bephoto.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Lignes transmises par appel : quelques requêtes chacune (fichier, labo,
// base), bien sous les limites d'un appel du Worker.
export const SEND_CHUNK = 8;
// Le labo peut retélécharger un fichier pendant ce délai après l'envoi.
const FILE_LINK_DAYS = 60;

function now() {
  return Math.floor(Date.now() / 1000);
}
function newId(prefix) {
  return `${prefix}_${b64url(randomBytes(9))}`;
}
function parseJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

/* ---------- Compte BePhoto du photographe ---------- */

function labAccountOut(photographer) {
  return { connected: Boolean(photographer.bephoto_password_enc), email: photographer.bephoto_email || "", papers: PAPERS };
}

async function connectAccount(request, env, photographer) {
  const body = await request.json().catch(() => null);
  const email = String(body?.email || "").trim().toLowerCase().slice(0, 200);
  const password = String(body?.password || "");
  if (!EMAIL_RE.test(email)) return fail(400, "Adresse e-mail invalide");
  if (!password || password.length > 200) return fail(400, "Mot de passe requis");
  let token;
  try {
    token = await bephotoLogin(env, email, password);
  } catch (err) {
    if (err instanceof BephotoError) {
      return fail(err.unauthorized ? 400 : 502, err.unauthorized ? "BePhoto refuse cet e-mail ou ce mot de passe." : err.message);
    }
    throw err;
  }
  await env.DB.prepare("UPDATE photographers SET bephoto_email = ?, bephoto_password_enc = ?, bephoto_token_enc = ? WHERE id = ?")
    .bind(email, await encryptApiKey(env.AUTH_SECRET, password), await encryptApiKey(env.AUTH_SECRET, token), photographer.id).run();
  return json({ connected: true, email, papers: PAPERS });
}

async function disconnectAccount(env, photographer) {
  await env.DB.prepare("UPDATE photographers SET bephoto_email = '', bephoto_password_enc = '', bephoto_token_enc = '' WHERE id = ?")
    .bind(photographer.id).run();
  return json({ connected: false, email: "", papers: PAPERS });
}

// Appelle BePhoto avec le jeton gardé ; s'il a expiré, se reconnecte une
// fois avec les identifiants chiffrés et garde le nouveau jeton.
async function withBephoto(env, photographer, fn) {
  if (!photographer.bephoto_password_enc) throw new BephotoError("Connectez d'abord votre compte BePhoto.", { status: 409 });
  let token = await decryptApiKey(env.AUTH_SECRET, photographer.bephoto_token_enc);
  const relogin = async () => {
    const password = await decryptApiKey(env.AUTH_SECRET, photographer.bephoto_password_enc);
    token = await bephotoLogin(env, photographer.bephoto_email, password);
    photographer.bephoto_token_enc = await encryptApiKey(env.AUTH_SECRET, token);
    await env.DB.prepare("UPDATE photographers SET bephoto_token_enc = ? WHERE id = ?").bind(photographer.bephoto_token_enc, photographer.id).run();
  };
  if (!token) await relogin();
  try {
    return await fn(token);
  } catch (err) {
    if (!(err instanceof BephotoError) || !err.unauthorized) throw err;
    await relogin();
    return fn(token);
  }
}

function labFailure(err) {
  if (err instanceof BephotoError) {
    if (err.status === 409) return fail(409, err.message);
    return fail(502, err.unauthorized ? "BePhoto refuse la connexion : vérifiez votre compte BePhoto." : err.message);
  }
  throw err;
}

async function labProducts(env, photographer) {
  try {
    return json({ products: await withBephoto(env, photographer, (token) => bephotoProducts(env, token)), papers: PAPERS });
  } catch (err) {
    return labFailure(err);
  }
}

/* ---------- Composition labo d'un produit ---------- */

async function setProductLab(request, env, photographer, productId) {
  const product = await env.DB.prepare(
    `SELECT p.id, p.kind FROM school_products p JOIN school_years y ON y.id = p.year_id JOIN schools s ON s.id = y.school_id
     WHERE p.id = ? AND s.photographer_id = ?`
  ).bind(productId, photographer.id).first();
  if (!product) return fail(404, "Produit introuvable");
  if (product.kind === "numerique") return fail(400, "Un fichier numérique ne s'imprime pas");
  const body = await request.json().catch(() => null);
  const checked = normalizeLabItems(body?.items);
  if (checked.error) return fail(400, checked.error);
  await env.DB.prepare("UPDATE school_products SET lab_items = ? WHERE id = ?")
    .bind(checked.items.length ? JSON.stringify(checked.items) : "", productId).run();
  return json({ labItems: checked.items });
}

/* ---------- Lots ---------- */

async function ownedYear(env, photographerId, yearId) {
  return env.DB.prepare(
    `SELECT y.*, s.name AS school_name, s.address AS school_address
     FROM school_years y JOIN schools s ON s.id = y.school_id WHERE y.id = ? AND s.photographer_id = ?`
  ).bind(yearId, photographerId).first();
}

async function ownedBatch(env, photographerId, batchId) {
  return env.DB.prepare(
    `SELECT b.*, y.label AS year_label, s.name AS school_name, s.address AS school_address
     FROM school_lab_batches b JOIN school_years y ON y.id = b.year_id JOIN schools s ON s.id = y.school_id
     WHERE b.id = ? AND s.photographer_id = ?`
  ).bind(batchId, photographerId).first();
}

// Articles payés, imprimables, pas encore dans un lot.
const PENDING_WHERE = `o.year_id = ? AND o.status = 'paid' AND o.delivery = ? AND l.kind != 'numerique' AND l.batch_id = ''`;

async function batchesForYear(env, photographer, year) {
  const pending = {};
  for (const delivery of ["school", "home"]) {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS lines, COALESCE(SUM(l.quantity), 0) AS quantity, COUNT(DISTINCT l.child_id) AS children,
              COUNT(DISTINCT o.id) AS orders
       FROM school_order_lines l JOIN school_orders o ON o.id = l.order_id WHERE ${PENDING_WHERE}`
    ).bind(year.id, delivery).first();
    pending[delivery] = { lines: row?.lines || 0, quantity: row?.quantity || 0, children: row?.children || 0, orders: row?.orders || 0 };
  }
  const { results } = await env.DB.prepare(
    `SELECT b.*, (SELECT COUNT(*) FROM school_order_lines l WHERE l.batch_id = b.id) AS lines,
            (SELECT COALESCE(SUM(l.quantity), 0) FROM school_order_lines l WHERE l.batch_id = b.id) AS quantity,
            (SELECT COUNT(DISTINCT l.child_id) FROM school_order_lines l WHERE l.batch_id = b.id) AS children
     FROM school_lab_batches b WHERE b.year_id = ? ORDER BY b.number DESC`
  ).bind(year.id).all();
  const { results: unmapped } = await env.DB.prepare(
    "SELECT name FROM school_products WHERE year_id = ? AND kind != 'numerique' AND active = 1 AND lab_items = '' ORDER BY sort"
  ).bind(year.id).all();
  return json({
    pending,
    batches: results.map((b) => ({
      id: b.id, number: b.number, delivery: b.delivery, status: b.status, lab: b.lab, labOrderId: b.lab_order_id,
      lines: b.lines, quantity: b.quantity, children: b.children, createdAt: b.created_at, sentAt: b.sent_at,
      error: b.error, progress: b.status === "sending" ? { sent: b.lab_cursor, total: parseJson(b.lab_items, []).length } : null,
      labTotal: parseJson(b.lab_total, null),
    })),
    lab: labAccountOut(photographer),
    unmappedProducts: unmapped.map((p) => p.name),
  });
}

// POST …/years/:id/batches { delivery: "school" | "home" }
async function createBatch(request, env, year) {
  const body = await request.json().catch(() => ({}));
  const delivery = body?.delivery === "home" ? "home" : "school";
  const waiting = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM school_order_lines l JOIN school_orders o ON o.id = l.order_id WHERE ${PENDING_WHERE}`
  ).bind(year.id, delivery).first();
  if (!waiting?.n) return fail(400, delivery === "home" ? "Aucun envoi à domicile en attente." : "Aucun article en attente pour l'établissement.");
  const id = newId("slb");
  const next = await env.DB.prepare("SELECT COALESCE(MAX(number), 0) + 1 AS n FROM school_lab_batches WHERE year_id = ?").bind(year.id).first();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO school_lab_batches (id, year_id, number, delivery, status, created_at) VALUES (?, ?, ?, ?, 'ready', ?)")
      .bind(id, year.id, next?.n || 1, delivery, now()),
    env.DB.prepare(
      `UPDATE school_order_lines SET batch_id = ? WHERE id IN (
         SELECT l.id FROM school_order_lines l JOIN school_orders o ON o.id = l.order_id WHERE ${PENDING_WHERE})`
    ).bind(id, year.id, delivery),
  ]);
  return json({ id, number: next?.n || 1 }, { status: 201 });
}

// POST …/batches/:id { status: "sent" } — parti à la main (fichier de production).
async function markSent(request, env, batch) {
  const body = await request.json().catch(() => null);
  if (body?.status !== "sent") return fail(400, "Statut inconnu");
  if (batch.status !== "ready") return fail(409, "Ce lot est déjà parti ou en cours d'envoi.");
  await env.DB.prepare("UPDATE school_lab_batches SET status = 'sent', sent_at = ? WHERE id = ? AND status = 'ready'").bind(now(), batch.id).run();
  return json({ ok: true });
}

// DELETE …/batches/:id — annule un lot pas encore parti : ses articles
// retournent en attente.
async function cancelBatch(env, batch) {
  if (batch.status !== "ready") return fail(409, "Un lot parti (ou en cours d'envoi) ne s'annule plus.");
  await env.DB.batch([
    env.DB.prepare("UPDATE school_order_lines SET batch_id = '' WHERE batch_id = ?").bind(batch.id),
    env.DB.prepare("DELETE FROM school_lab_batches WHERE id = ? AND status = 'ready'").bind(batch.id),
  ]);
  return json({ ok: true });
}

// Ce qui part chez BePhoto, ligne par ligne, figé au début de l'envoi :
// chaque article commandé × sa composition labo, rangé par groupe puis par
// enfant (le nom de fichier porte ce rangement).
async function labItemsForBatch(env, batch) {
  const { results: lines } = await env.DB.prepare(
    `SELECT l.id, l.photo_id, l.name, l.quantity, l.group_id, p.lab_items, c.number AS child_number, c.first_name,
            g.name AS group_name, g.sort AS group_sort, ph.gallery_id
     FROM school_order_lines l
     LEFT JOIN school_products p ON p.id = l.product_id
     LEFT JOIN school_children c ON c.id = l.child_id
     LEFT JOIN school_groups g ON g.id = l.group_id
     LEFT JOIN photos ph ON ph.id = l.photo_id
     WHERE l.batch_id = ?
     ORDER BY g.sort, g.name COLLATE NOCASE, c.number, l.id`
  ).bind(batch.id).all();
  const missing = [...new Set(lines.filter((l) => !parseJson(l.lab_items, []).length).map((l) => l.name))];
  if (missing.length) return { error: `Indiquez d'abord ce que le labo imprime pour : ${missing.join(", ")} (Gamme et prix → Labo).` };
  if (lines.some((l) => !l.gallery_id)) return { error: "Une photo commandée n'existe plus : retirez-la du lot avant l'envoi." };
  const groupIndex = new Map();
  const items = [];
  for (const l of lines) {
    if (!groupIndex.has(l.group_id)) groupIndex.set(l.group_id, groupIndex.size + 1);
    for (const part of parseJson(l.lab_items, [])) {
      items.push({
        lineId: l.id, photoId: l.photo_id, galleryId: l.gallery_id,
        idproduct: part.idproduct, idpaper: part.idpaper, quantity: part.quantity * l.quantity,
        filename: labFilename({
          groupIndex: groupIndex.get(l.group_id), groupName: l.group_name, childNumber: l.child_number,
          childFirstName: l.first_name, productName: l.name, part: part.label || `p${part.idproduct}`,
        }),
      });
    }
  }
  return { items };
}

function fileUrl(origin, batchId, photoId, signature) {
  return `${origin}/api/school-lab-files/${encodeURIComponent(batchId)}/${encodeURIComponent(photoId)}.jpg?s=${signature}`;
}

// POST …/batches/:id/send — une étape de l'envoi à BePhoto ; l'interface
// rappelle jusqu'à `done`.
async function sendStep(env, photographer, batch, origin) {
  if (batch.status === "sent") return json({ done: true, sent: 0, total: 0 });
  if (batch.delivery === "home") {
    return fail(409, "L'API BePhoto ne prévoit pas encore d'adresse de livraison : envoyez ce lot avec son fichier de production.");
  }
  try {
    if (batch.status === "ready") {
      const prepared = await labItemsForBatch(env, batch);
      if (prepared.error) return fail(409, prepared.error);
      const metadata = [
        "Holypixx", batch.school_name, batch.year_label, `Lot ${batch.number}`,
        batch.school_address ? `Livraison : ${batch.school_address}` : "",
      ].filter(Boolean).join(" · ");
      const order = await withBephoto(env, photographer, (token) => bephotoCreateOrder(env, token, metadata));
      const started = await env.DB.prepare(
        `UPDATE school_lab_batches SET status = 'sending', lab = 'bephoto', lab_order_id = ?, lab_items = ?, lab_cursor = 0, error = ''
         WHERE id = ? AND status = 'ready'`
      ).bind(String(order.idorder), JSON.stringify(prepared.items), batch.id).run();
      if (!started?.meta?.changes) return fail(409, "Ce lot vient d'être envoyé depuis une autre fenêtre.");
      return json({ done: false, sent: 0, total: prepared.items.length, labOrderId: String(order.idorder) });
    }

    const items = parseJson(batch.lab_items, []);
    let cursor = batch.lab_cursor;
    const end = Math.min(items.length, cursor + SEND_CHUNK);
    for (; cursor < end; cursor++) {
      const item = items[cursor];
      const head = await env.TILES.head(originalKey(item.galleryId, item.photoId));
      if (!head) throw new BephotoError(`Fichier d'impression introuvable (${item.filename})`, { status: 409 });
      const signature = await signFor(env.AUTH_SECRET, `school-lab:${batch.id}:${item.photoId}`);
      await withBephoto(env, photographer, (token) => bephotoAddProduct(env, token, batch.lab_order_id, {
        idproduct: item.idproduct, idpaper: item.idpaper, quantity: item.quantity,
        fileurl: fileUrl(origin, batch.id, item.photoId, signature), filename: item.filename, filesize: head.size,
      }));
      // Avancé ligne par ligne : une coupure ne renvoie jamais deux fois la même.
      await env.DB.prepare("UPDATE school_lab_batches SET lab_cursor = ?, error = '' WHERE id = ?").bind(cursor + 1, batch.id).run();
    }
    if (cursor < items.length) return json({ done: false, sent: cursor, total: items.length });

    await withBephoto(env, photographer, (token) => bephotoCloseOrder(env, token, batch.lab_order_id));
    let total = null;
    try {
      const order = await withBephoto(env, photographer, (token) => bephotoGetOrder(env, token, batch.lab_order_id));
      total = { totalOrder: order.totalorder ?? null, totalCost: order.totalcost ?? null, shippingMethod: order.shippingmethod ?? null };
    } catch {
      /* le total est une information, pas une condition */
    }
    await env.DB.prepare("UPDATE school_lab_batches SET status = 'sent', sent_at = ?, lab_total = ?, error = '' WHERE id = ?")
      .bind(now(), total ? JSON.stringify(total) : "", batch.id).run();
    return json({ done: true, sent: items.length, total: items.length, labTotal: total });
  } catch (err) {
    if (err instanceof BephotoError) {
      await env.DB.prepare("UPDATE school_lab_batches SET error = ? WHERE id = ?").bind(err.message.slice(0, 300), batch.id).run();
    }
    return labFailure(err);
  }
}

/* ---------- Fichier d'impression, téléchargé par le labo ---------- */

// GET /api/school-lab-files/:batchId/:photoId.jpg?s=… — adresse signée,
// valable pour une photo de ce lot, tant que le lot est récent.
export async function handleLabFile(request, env, batchId, photoFile) {
  const photoId = photoFile.replace(/\.jpg$/i, "");
  const s = new URL(request.url).searchParams.get("s") || "";
  if (!(await verifySignature(env.AUTH_SECRET, `school-lab:${batchId}:${photoId}`, s))) return fail(403, "Lien invalide");
  const row = await env.DB.prepare(
    `SELECT b.status, b.sent_at, ph.gallery_id FROM school_lab_batches b
     JOIN school_order_lines l ON l.batch_id = b.id AND l.photo_id = ?
     JOIN photos ph ON ph.id = l.photo_id
     WHERE b.id = ? LIMIT 1`
  ).bind(photoId, batchId).first();
  if (!row || row.status === "ready") return fail(404, "Fichier indisponible");
  if (row.sent_at && now() - row.sent_at > FILE_LINK_DAYS * 86400) return fail(410, "Lien expiré");
  const object = await env.TILES.get(originalKey(row.gallery_id, photoId));
  if (!object) return fail(404, "Fichier indisponible");
  return new Response(object.body, {
    headers: { "content-type": "image/jpeg", "content-length": String(object.size), "cache-control": "private, no-store" },
  });
}

/* ---------- Routeur : /api/admin/school/… (null si la route n'est pas d'ici) ---------- */

export async function handleSchoolLabAdmin(request, env, photographer, rest, origin) {
  const [kind, id, sub] = rest;
  const method = request.method;
  if (kind === "lab" && rest.length === 1) {
    if (method === "GET") return json(labAccountOut(photographer));
    if (method === "POST") return connectAccount(request, env, photographer);
    if (method === "DELETE") return disconnectAccount(env, photographer);
  }
  if (kind === "lab" && id === "products" && rest.length === 2 && method === "GET") return labProducts(env, photographer);
  if (kind === "products" && sub === "lab" && rest.length === 3 && method === "POST") return setProductLab(request, env, photographer, id);
  if (kind === "years" && sub === "batches" && rest.length === 3) {
    const year = await ownedYear(env, photographer.id, id);
    if (!year) return fail(404, "Année introuvable");
    if (method === "GET") return batchesForYear(env, photographer, year);
    if (method === "POST") return createBatch(request, env, year);
  }
  if (kind === "batches" && (rest.length === 2 || (rest.length === 3 && sub === "send"))) {
    const batch = await ownedBatch(env, photographer.id, id);
    if (!batch) return fail(404, "Lot introuvable");
    if (rest.length === 3 && method === "POST") return sendStep(env, photographer, batch, origin);
    if (rest.length === 2 && method === "POST") return markSent(request, env, batch);
    if (rest.length === 2 && method === "DELETE") return cancelBatch(env, batch);
  }
  return null;
}
