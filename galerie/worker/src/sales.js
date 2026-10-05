// Tableau de bord des ventes du photographe : chiffre d'affaires des douze
// derniers mois (suppléments et tirages), panier moyen, marge estimée sur
// les tirages, formats et galeries qui vendent le mieux.
//
// Tout part des paiements réglés (`payments.status = 'paid'`), la même
// source que les factures : le tableau de bord ne peut jamais afficher un
// montant différent de ce que le photographe a facturé. Les mois sont ceux
// du calendrier belge (Europe/Brussels), pas de l'UTC : un paiement reçu le
// 31 à 23 h 30 compte bien dans le mois du 31.
//
// La marge des tirages est une ESTIMATION : prix payé par le client moins
// le dernier coût Prodigi connu du produit (print_products.cost_cents) et
// moins les frais de paiement retenus, hors frais de port. Une ligne dont le produit a été
// supprimé ou n'a jamais eu de devis n'entre pas dans le calcul ; la part
// couverte est renvoyée pour que l'admin le dise.

import { json } from "./http.js";

export const SALES_MONTHS = 12;
export const SALES_TIME_ZONE = "Europe/Brussels";
const TOP_LIMIT = 5;

const MONTH_LABELS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// { year, month (1-12) } d'un instant (secondes) dans le fuseau donné.
export function calendarMonth(seconds, timeZone = SALES_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "numeric" }).formatToParts(new Date(seconds * 1000));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month") };
}

function monthKey({ year, month }) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

// Les `count` derniers mois calendaires, du plus ancien au mois en cours.
export function lastMonths(nowSeconds, count = SALES_MONTHS, timeZone = SALES_TIME_ZONE) {
  const current = calendarMonth(nowSeconds, timeZone);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const index = current.year * 12 + (current.month - 1) - i;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    out.push({ key: monthKey({ year, month }), year, month, label: `${MONTH_LABELS[month - 1]} ${year}` });
  }
  return out;
}

// Borne basse (secondes) large de la fenêtre : le 1er du plus ancien mois,
// moins un jour pour absorber le décalage horaire. Le filtrage exact se fait
// ensuite mois par mois dans summarizeSales.
export function windowStart(nowSeconds, count = SALES_MONTHS, timeZone = SALES_TIME_ZONE) {
  const first = lastMonths(nowSeconds, count, timeZone)[0];
  return Math.floor(Date.UTC(first.year, first.month - 1, 1) / 1000) - 86400;
}

// Calcul pur (testé à part) à partir des lignes déjà lues en base.
//   payments  : [{ id, gallery_id, kind, amount_cents, fee_cents, paid_at }]   (réglés)
//   orders    : [{ payment_id, items }]                             (tirages)
//   products  : [{ id, cost_cents }]                                (catalogue actuel)
//   galleries : [{ id, slug, title, created_at }]
export function summarizeSales({ payments, orders, products, galleries, nowSeconds, timeZone = SALES_TIME_ZONE, months = SALES_MONTHS }) {
  const monthList = lastMonths(nowSeconds, months, timeZone).map((m) => ({
    key: m.key,
    label: m.label,
    supplementCents: 0,
    printCents: 0,
    orders: 0,
  }));
  const byKey = new Map(monthList.map((m) => [m.key, m]));

  const inWindow = [];
  for (const p of payments) {
    if (!p.paid_at) continue;
    const month = byKey.get(monthKey(calendarMonth(p.paid_at, timeZone)));
    if (!month) continue;
    inWindow.push(p);
    const cents = p.amount_cents || 0;
    if (p.kind === "print") month.printCents += cents;
    else month.supplementCents += cents;
    month.orders += 1;
  }

  // Frais de paiement retenus sur ces ventes (voir fees.js).
  const feeCents = inWindow.reduce((sum, p) => sum + (p.fee_cents || 0), 0);
  const printFeeCents = inWindow.filter((p) => p.kind === "print").reduce((sum, p) => sum + (p.fee_cents || 0), 0);
  const supplementCents = monthList.reduce((s, m) => s + m.supplementCents, 0);
  const printCents = monthList.reduce((s, m) => s + m.printCents, 0);
  const revenueCents = supplementCents + printCents;
  const orderCount = inWindow.length;

  // Lignes de tirage des commandes réglées dans la fenêtre.
  const paidIds = new Set(inWindow.filter((p) => p.kind === "print").map((p) => p.id));
  const costById = new Map(products.map((p) => [p.id, p.cost_cents || 0]));
  const productTotals = new Map();
  let lineRevenueCents = 0;
  let coveredRevenueCents = 0;
  let marginCents = 0;
  for (const order of orders) {
    if (!paidIds.has(order.payment_id)) continue;
    for (const line of parseJson(order.items, [])) {
      const copies = Number(line.copies) || 0;
      const lineCents = Number(line.lineCents) || 0;
      lineRevenueCents += lineCents;
      const cost = costById.get(line.productId);
      if (cost > 0) {
        coveredRevenueCents += lineCents;
        marginCents += lineCents - cost * copies;
      }
      const key = `${line.productId || ""}|${line.label || ""}`;
      const entry = productTotals.get(key) || { label: line.label || "Produit", copies: 0, revenueCents: 0 };
      entry.copies += copies;
      entry.revenueCents += lineCents;
      productTotals.set(key, entry);
    }
  }

  const galleryById = new Map(galleries.map((g) => [g.id, g]));
  const galleryTotals = new Map();
  for (const p of inWindow) {
    const entry = galleryTotals.get(p.gallery_id) || { revenueCents: 0, orders: 0 };
    entry.revenueCents += p.amount_cents || 0;
    entry.orders += 1;
    galleryTotals.set(p.gallery_id, entry);
  }
  const topGalleries = [...galleryTotals.entries()]
    .map(([id, t]) => ({ slug: galleryById.get(id)?.slug || "", title: galleryById.get(id)?.title || "Galerie supprimée", ...t }))
    .sort((a, b) => b.revenueCents - a.revenueCents || a.title.localeCompare(b.title))
    .slice(0, TOP_LIMIT);
  const topProducts = [...productTotals.values()]
    .sort((a, b) => b.revenueCents - a.revenueCents || b.copies - a.copies || a.label.localeCompare(b.label))
    .slice(0, TOP_LIMIT);

  // Conversion : parmi les galeries créées dans la fenêtre, celles qui ont
  // vendu au moins une fois (supplément ou tirage, à n'importe quelle date).
  const start = windowStart(nowSeconds, months, timeZone);
  const firstKey = monthList[0].key;
  const recent = galleries.filter((g) => g.created_at >= start && monthKey(calendarMonth(g.created_at, timeZone)) >= firstKey);
  const sold = new Set(payments.map((p) => p.gallery_id));
  const withSales = recent.filter((g) => sold.has(g.id)).length;

  return {
    timeZone,
    months: monthList,
    totals: {
      revenueCents,
      supplementCents,
      printCents,
      orders: orderCount,
      averageOrderCents: orderCount ? Math.round(revenueCents / orderCount) : 0,
      feeCents,
      netCents: revenueCents - feeCents,
    },
    printMargin: {
      // Frais de paiement des commandes de tirages déduits de la marge.
      marginCents: marginCents - printFeeCents,
      coveredRevenueCents,
      lineRevenueCents,
      // Part du chiffre d'affaires des tirages (hors port) dont le coût est connu.
      coverage: lineRevenueCents ? coveredRevenueCents / lineRevenueCents : 0,
    },
    conversion: { galleries: recent.length, withSales, rate: recent.length ? withSales / recent.length : 0 },
    topProducts,
    topGalleries,
  };
}

// GET /api/admin/sales
export async function salesForAdmin(env, photographerId, nowSeconds = Math.floor(Date.now() / 1000)) {
  const since = windowStart(nowSeconds);
  const [payments, orders, products, galleries] = await Promise.all([
    env.DB.prepare(
      `SELECT p.id, p.gallery_id, p.kind, p.amount_cents, p.fee_cents, p.paid_at
         FROM payments p JOIN galleries g ON g.id = p.gallery_id
        WHERE g.photographer_id = ? AND p.status = 'paid'`
    ).bind(photographerId).all(),
    env.DB.prepare(
      "SELECT payment_id, items FROM print_orders WHERE photographer_id = ? AND paid_at >= ?"
    ).bind(photographerId, since).all(),
    env.DB.prepare("SELECT id, cost_cents FROM print_products WHERE photographer_id = ?").bind(photographerId).all(),
    env.DB.prepare("SELECT id, slug, title, created_at FROM galleries WHERE photographer_id = ?").bind(photographerId).all(),
  ]);
  return json(
    summarizeSales({
      payments: payments.results || [],
      orders: orders.results || [],
      products: products.results || [],
      galleries: galleries.results || [],
      nowSeconds,
    })
  );
}
