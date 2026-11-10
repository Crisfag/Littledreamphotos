// Options payantes cochées par le client dans sa galerie : retouche
// avancée, livraison express, clé USB… Le studio les définit une fois
// (catalogue, Paramètres), le client les coche, et elles se règlent avec
// les suppléments, par le même chemin : carte (Stripe), espèces ou
// virement, ou réglées à la main par le photographe.
//
// Le dû d'une galerie = suppléments (supplementFor) + options cochées pas
// encore réglées, au prix ACTUEL du catalogue (une option retirée ou
// désactivée n'est plus due). Au moment du paiement, ce qui est payé est
// figé dans payments.options_json, puis recopié sur chaque choix une fois
// le paiement confirmé (markOptionsPaid).

import { json, fail } from "./http.js";
import { randomBytes, b64url } from "./auth.js";
import { supplementFor } from "./admin.js";

const MAX_OPTIONS = 30;
const MAX_QUANTITY = 99;

const now = () => Math.floor(Date.now() / 1000);
const newId = (prefix) => `${prefix}_${b64url(randomBytes(9))}`;

function formatEuros(cents, lang) {
  const amount = ((cents || 0) / 100).toLocaleString(lang === "en" ? "en-GB" : "fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return lang === "en" ? `€${amount}` : `${amount} €`;
}

function optionOut(row) {
  return {
    id: row.id,
    label: row.label,
    description: row.description || "",
    priceCents: row.price_cents,
    perUnit: Boolean(row.per_unit),
    active: Boolean(row.active),
  };
}

/* ---------- Catalogue (photographe) ---------- */

export async function listOptions(env, photographerId) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM gallery_options WHERE photographer_id = ? ORDER BY position ASC, created_at ASC"
  ).bind(photographerId).all();
  return results;
}

function cleanOption(body) {
  const label = String(body?.label || "").trim().slice(0, 80);
  const description = String(body?.description || "").trim().slice(0, 300);
  const price = Number(String(body?.price ?? "").replace(",", "."));
  if (!label) return { error: "Donnez un nom à l'option" };
  if (!Number.isFinite(price) || price <= 0 || price > 10000) return { error: "Indiquez un prix entre 0,01 € et 10 000 €" };
  return { label, description, priceCents: Math.round(price * 100), perUnit: body?.perUnit === true, active: body?.active !== false };
}

// GET /api/admin/options
export async function getOptionsCatalog(env, photographerId) {
  return json({ options: (await listOptions(env, photographerId)).map(optionOut) });
}

// POST /api/admin/options — nouvelle option.
export async function createOption(request, env, photographerId) {
  let body;
  try { body = await request.json(); } catch { return fail(400, "Requête invalide"); }
  const option = cleanOption(body);
  if (option.error) return fail(400, option.error);
  const existing = await listOptions(env, photographerId);
  if (existing.length >= MAX_OPTIONS) return fail(400, `${MAX_OPTIONS} options au maximum`);
  const id = newId("opt");
  const position = existing.reduce((max, o) => Math.max(max, o.position), -1) + 1;
  await env.DB.prepare(
    `INSERT INTO gallery_options (id, photographer_id, label, description, price_cents, per_unit, active, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, photographerId, option.label, option.description, option.priceCents, option.perUnit ? 1 : 0, option.active ? 1 : 0, position, now()).run();
  return json({ option: optionOut(await env.DB.prepare("SELECT * FROM gallery_options WHERE id = ?").bind(id).first()) }, { status: 201 });
}

// POST /api/admin/options/:id — modifier (tous les champs, ou seulement
// `active` pour l'interrupteur de la liste).
export async function updateOption(request, env, photographerId, optionId) {
  let body;
  try { body = await request.json(); } catch { return fail(400, "Requête invalide"); }
  const current = await env.DB.prepare("SELECT * FROM gallery_options WHERE id = ? AND photographer_id = ?").bind(optionId, photographerId).first();
  if (!current) return fail(404, "Option introuvable");
  if (Object.keys(body || {}).length === 1 && typeof body.active === "boolean") {
    await env.DB.prepare("UPDATE gallery_options SET active = ? WHERE id = ?").bind(body.active ? 1 : 0, optionId).run();
  } else {
    const option = cleanOption({ active: Boolean(current.active), ...body });
    if (option.error) return fail(400, option.error);
    await env.DB.prepare(
      "UPDATE gallery_options SET label = ?, description = ?, price_cents = ?, per_unit = ?, active = ? WHERE id = ?"
    ).bind(option.label, option.description, option.priceCents, option.perUnit ? 1 : 0, option.active ? 1 : 0, optionId).run();
  }
  return json({ option: optionOut(await env.DB.prepare("SELECT * FROM gallery_options WHERE id = ?").bind(optionId).first()) });
}

// DELETE /api/admin/options/:id — ce qui a déjà été payé reste (figé sur
// le choix) ; ce qui était coché sans être réglé n'est plus dû.
export async function deleteOption(env, photographerId, optionId) {
  const result = await env.DB.prepare("DELETE FROM gallery_options WHERE id = ? AND photographer_id = ?").bind(optionId, photographerId).run();
  if (!(result.meta && result.meta.changes > 0)) return fail(404, "Option introuvable");
  await env.DB.prepare(
    `DELETE FROM gallery_option_choices WHERE option_id = ? AND payment_id = ''
       AND gallery_id IN (SELECT id FROM galleries WHERE photographer_id = ?)`
  ).bind(optionId, photographerId).run();
  return json({ ok: true });
}

// POST /api/admin/galleries/:slug/options { enabled } — proposer ou non les
// options dans cette galerie.
export async function setGalleryOptionsEnabled(request, env, gallery) {
  let body;
  try { body = await request.json(); } catch { return fail(400, "Requête invalide"); }
  const enabled = body?.enabled === true;
  await env.DB.prepare("UPDATE galleries SET options_enabled = ? WHERE id = ?").bind(enabled ? 1 : 0, gallery.id).run();
  return json({ ok: true, enabled });
}

/* ---------- Ce qui est dû ---------- */

// Options cochées et pas encore réglées, au prix actuel du catalogue.
export async function unpaidOptions(env, gallery) {
  if (gallery.options_enabled === 0) return [];
  const { results } = await env.DB.prepare(
    `SELECT c.id AS choice_id, c.option_id, c.quantity, o.label, o.price_cents, o.per_unit
     FROM gallery_option_choices c JOIN gallery_options o ON o.id = c.option_id
     WHERE c.gallery_id = ? AND c.payment_id = '' AND o.active = 1
     ORDER BY o.position ASC, c.created_at ASC`
  ).bind(gallery.id).all();
  return results.map((r) => {
    const quantity = r.per_unit ? Math.max(1, Math.min(MAX_QUANTITY, r.quantity)) : 1;
    return { choiceId: r.choice_id, optionId: r.option_id, label: r.label, unitCents: r.price_cents, quantity, totalCents: r.price_cents * quantity };
  });
}

// Tout ce que le client doit à cet instant : suppléments + options.
export async function amountDueFor(env, gallery) {
  const selected = await env.DB.prepare("SELECT COUNT(*) AS n FROM photos WHERE gallery_id = ? AND selected = 1")
    .bind(gallery.id).first();
  const paid = await env.DB.prepare(
    "SELECT COALESCE(SUM(extra_count), 0) AS n FROM payments WHERE gallery_id = ? AND status = 'paid'"
  ).bind(gallery.id).first();
  const supplement = supplementFor(gallery.included_photos, gallery.extra_photo_price_cents, selected?.n || 0, paid?.n || 0);
  const options = await unpaidOptions(env, gallery);
  const optionsCents = options.reduce((sum, o) => sum + o.totalCents, 0);
  return {
    ...supplement,
    options,
    optionsCents,
    totalCents: supplement.dueTotalCents + optionsCents,
  };
}

// Pour les listes (toutes les galeries d'un photographe d'un coup) :
// galleryId → { cents, count } des options dues.
export async function unpaidOptionsByGallery(env, photographerId) {
  const { results } = await env.DB.prepare(
    `SELECT c.gallery_id, COUNT(*) AS n,
            SUM(o.price_cents * CASE WHEN o.per_unit = 1 THEN MAX(1, MIN(${MAX_QUANTITY}, c.quantity)) ELSE 1 END) AS cents
     FROM gallery_option_choices c
     JOIN gallery_options o ON o.id = c.option_id AND o.active = 1
     JOIN galleries g ON g.id = c.gallery_id AND g.options_enabled = 1
     WHERE g.photographer_id = ? AND c.payment_id = ''
     GROUP BY c.gallery_id`
  ).bind(photographerId).all();
  return new Map(results.map((r) => [r.gallery_id, { cents: r.cents || 0, count: r.n || 0 }]));
}

// Instantané enregistré avec le paiement (payments.options_json).
export function optionsSnapshot(options) {
  return options.length
    ? JSON.stringify(options.map((o) => ({ choiceId: o.choiceId, optionId: o.optionId, label: o.label, unitCents: o.unitCents, quantity: o.quantity })))
    : "";
}

export function parseOptionsSnapshot(value) {
  try {
    const list = JSON.parse(value || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// Paiement confirmé : les options qu'il couvre passent en réglées, au prix
// et à la quantité payés. Si le client avait entre-temps augmenté la
// quantité, le reste demeure à régler ; s'il avait décoché, la ligne payée
// est recréée (il a payé, c'est acquis).
export async function markOptionsPaid(env, payment) {
  const items = parseOptionsSnapshot(payment.options_json);
  const ts = payment.paid_at || now();
  for (const item of items) {
    const row = await env.DB.prepare("SELECT * FROM gallery_option_choices WHERE id = ?").bind(item.choiceId).first();
    if (row && row.payment_id === "" && row.gallery_id === payment.gallery_id) {
      await env.DB.prepare(
        "UPDATE gallery_option_choices SET payment_id = ?, paid_at = ?, label = ?, unit_price_cents = ?, quantity = ? WHERE id = ? AND payment_id = ''"
      ).bind(payment.id, ts, item.label, item.unitCents, item.quantity, item.choiceId).run();
      if (row.quantity > item.quantity) {
        await env.DB.prepare(
          "INSERT INTO gallery_option_choices (id, gallery_id, option_id, quantity, created_at) VALUES (?, ?, ?, ?, ?)"
        ).bind(newId("och"), payment.gallery_id, row.option_id, row.quantity - item.quantity, ts).run();
      }
    } else {
      await env.DB.prepare(
        `INSERT INTO gallery_option_choices (id, gallery_id, option_id, quantity, label, unit_price_cents, payment_id, created_at, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(row ? newId("och") : item.choiceId, payment.gallery_id, item.optionId, item.quantity, item.label, item.unitCents, payment.id, ts, ts).run();
    }
  }
}

// Lignes de la facture et de la page de paiement Stripe.
export function optionLine(item, lang) {
  return item.quantity > 1
    ? `${item.quantity} × ${item.label} — ${formatEuros(item.unitCents * item.quantity, lang)}`
    : `${item.label} — ${formatEuros(item.unitCents, lang)}`;
}

export function paymentInvoiceText(payment, gallery, lang) {
  const options = parseOptionsSnapshot(payment.options_json);
  const n = payment.extra_count || 0;
  const extras = lang === "en"
    ? `${n} additional photo${n > 1 ? "s" : ""}`
    : `${n} photo${n > 1 ? "s" : ""} supplémentaire${n > 1 ? "s" : ""}`;
  if (!options.length) return { description: `${extras} — ${gallery.title}`, details: [] };
  const optionsCents = options.reduce((sum, o) => sum + o.unitCents * o.quantity, 0);
  const details = [];
  if (n > 0) details.push(`${extras} — ${formatEuros(payment.amount_cents - optionsCents, lang)}`);
  for (const o of options) details.push(optionLine(o, lang));
  const what = n > 0 ? (lang === "en" ? "Extra photos and options" : "Photos supplémentaires et options") : "Options";
  return { description: `${what} — ${gallery.title}`, details };
}

/* ---------- Côté client ---------- */

// Bloc « options » de la session client : null si rien n'est proposé et
// que rien n'a jamais été coché.
export async function optionsForClient(env, gallery) {
  const enabled = gallery.options_enabled !== 0;
  const catalog = enabled
    ? (await listOptions(env, gallery.photographer_id)).filter((o) => o.active)
    : [];
  const { results: choices } = await env.DB.prepare(
    "SELECT * FROM gallery_option_choices WHERE gallery_id = ? ORDER BY created_at ASC"
  ).bind(gallery.id).all();
  const byId = new Map(catalog.map((o) => [o.id, o]));
  const chosen = [];
  for (const c of choices) {
    if (c.payment_id) {
      chosen.push({ choiceId: c.id, optionId: c.option_id, label: c.label, unitCents: c.unit_price_cents, quantity: c.quantity, paid: true });
    } else if (byId.has(c.option_id)) {
      const o = byId.get(c.option_id);
      chosen.push({ choiceId: c.id, optionId: c.option_id, label: o.label, unitCents: o.price_cents, quantity: o.per_unit ? c.quantity : 1, paid: false });
    }
  }
  if (!catalog.length && !chosen.length) return null;
  return {
    available: catalog.map((o) => ({ id: o.id, label: o.label, description: o.description || "", priceCents: o.price_cents, perUnit: Boolean(o.per_unit) })),
    chosen,
  };
}

// POST /api/gallery/:slug/options { optionId, quantity } — cocher (ou
// changer la quantité), quantity 0 : décocher. Ce qui est déjà réglé ne
// bouge jamais.
export async function handleOptionChoice(request, env, gallery) {
  let body;
  try { body = await request.json(); } catch { return fail(400, "Requête invalide"); }
  if (gallery.options_enabled === 0) return fail(400, "Aucune option n'est proposée dans cette galerie");
  const optionId = String(body?.optionId || "");
  const option = await env.DB.prepare("SELECT * FROM gallery_options WHERE id = ? AND photographer_id = ? AND active = 1")
    .bind(optionId, gallery.photographer_id).first();
  if (!option) return fail(404, "Cette option n'est plus proposée");
  let quantity = Math.floor(Number(body?.quantity));
  if (!Number.isFinite(quantity) || quantity < 0) return fail(400, "Quantité invalide");
  quantity = option.per_unit ? Math.min(MAX_QUANTITY, quantity) : Math.min(1, quantity);

  const current = await env.DB.prepare(
    "SELECT id FROM gallery_option_choices WHERE gallery_id = ? AND option_id = ? AND payment_id = '' ORDER BY created_at ASC LIMIT 1"
  ).bind(gallery.id, optionId).first();
  if (quantity === 0) {
    await env.DB.prepare("DELETE FROM gallery_option_choices WHERE gallery_id = ? AND option_id = ? AND payment_id = ''")
      .bind(gallery.id, optionId).run();
  } else if (current) {
    await env.DB.prepare("UPDATE gallery_option_choices SET quantity = ? WHERE id = ?").bind(quantity, current.id).run();
  } else {
    await env.DB.prepare("INSERT INTO gallery_option_choices (id, gallery_id, option_id, quantity, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(newId("och"), gallery.id, optionId, quantity, now()).run();
  }
  return json({ options: await optionsForClient(env, gallery) });
}

/* ---------- Fiche de la galerie (photographe) ---------- */

export async function optionsForAdmin(env, gallery) {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.option_id, c.quantity, c.label, c.unit_price_cents, c.payment_id, c.created_at, c.paid_at,
            o.label AS option_label, o.price_cents AS option_price, o.per_unit, o.active
     FROM gallery_option_choices c LEFT JOIN gallery_options o ON o.id = c.option_id
     WHERE c.gallery_id = ? ORDER BY c.created_at ASC`
  ).bind(gallery.id).all();
  const chosen = [];
  for (const r of results) {
    if (r.payment_id) {
      chosen.push({ label: r.label, unitCents: r.unit_price_cents, quantity: r.quantity, paid: true, paidAt: r.paid_at });
    } else if (r.option_label && r.active && gallery.options_enabled !== 0) {
      const quantity = r.per_unit ? r.quantity : 1;
      chosen.push({ label: r.option_label, unitCents: r.option_price, quantity, paid: false, chosenAt: r.created_at });
    }
  }
  return { enabled: gallery.options_enabled !== 0, chosen };
}
