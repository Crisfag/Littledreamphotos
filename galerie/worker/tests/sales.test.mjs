// Vérifie le calcul du tableau de bord des ventes sans réseau ni D1 :
// mois calendaires belges, répartition suppléments/tirages, panier moyen,
// marge estimée, classements et conversion.
//
//   node tests/sales.test.mjs

import { summarizeSales, lastMonths, calendarMonth } from "../src/sales.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const at = (iso) => Math.floor(Date.parse(iso) / 1000);
const NOW = at("2026-10-03T10:00:00Z");

const months = lastMonths(NOW);
check("douze mois, du plus ancien au mois en cours",
      months.length === 12 && months[0].key === "2025-11" && months[11].key === "2026-10" && months[11].label === "oct. 2026",
      `${months[0].key} … ${months[11].key}`);
check("le passage d'année est correct", lastMonths(at("2026-01-15T12:00:00Z"), 2).map((m) => m.key).join(",") === "2025-12,2026-01");
check("les mois suivent l'heure belge, pas l'UTC",
      calendarMonth(at("2026-08-31T22:30:00Z")).month === 9 && calendarMonth(at("2026-08-31T22:30:00Z"), "UTC").month === 8);

const galleries = [
  { id: "g1", slug: "dupont", title: "Séance Dupont", created_at: at("2026-06-01T10:00:00Z") },
  { id: "g2", slug: "martin", title: "Mariage Martin", created_at: at("2026-08-01T10:00:00Z") },
  { id: "g3", slug: "vide", title: "Sans vente", created_at: at("2026-09-01T10:00:00Z") },
  { id: "g4", slug: "ancienne", title: "Ancienne", created_at: at("2024-01-01T10:00:00Z") },
];
const payments = [
  { id: "pay1", gallery_id: "g1", kind: "supplement", amount_cents: 3000, paid_at: at("2026-06-10T10:00:00Z") },
  { id: "pay2", gallery_id: "g1", kind: "print", amount_cents: 9890, fee_cents: 228, paid_at: at("2026-07-02T10:00:00Z") },
  { id: "pay3", gallery_id: "g2", kind: "print", amount_cents: 2400, paid_at: at("2026-08-31T22:30:00Z") },
  { id: "pay4", gallery_id: "g4", kind: "supplement", amount_cents: 5000, paid_at: at("2024-02-01T10:00:00Z") },
];
const orders = [
  { payment_id: "pay2", items: JSON.stringify([
    { productId: "prd_canvas", label: "Toile 40 × 50 cm", copies: 1, lineCents: 8900 },
    { productId: "prd_old", label: "Format retiré", copies: 2, lineCents: 400 },
  ]) },
  { payment_id: "pay3", items: JSON.stringify([{ productId: "prd_photo", label: "Tirage 10 × 15 cm", copies: 4, lineCents: 1600 }]) },
  { payment_id: "pay4", items: "[]" },
];
const products = [{ id: "prd_canvas", cost_cents: 2300 }, { id: "prd_photo", cost_cents: 150 }];
const s = summarizeSales({ payments, orders, products, galleries, nowSeconds: NOW });

const byKey = Object.fromEntries(s.months.map((m) => [m.key, m]));
check("chaque paiement tombe dans son mois et sa catégorie",
      byKey["2026-06"].supplementCents === 3000 && byKey["2026-07"].printCents === 9890 && byKey["2026-09"].printCents === 2400 && byKey["2026-08"].printCents === 0);
check("un paiement hors des douze mois est ignoré", s.totals.revenueCents === 15290 && s.totals.orders === 3, `${s.totals.revenueCents}`);
check("totaux par catégorie et panier moyen arrondi",
      s.totals.supplementCents === 3000 && s.totals.printCents === 12290 && s.totals.averageOrderCents === 5097);
check("la marge estimée ne compte que les produits au coût connu, frais de paiement déduits",
      s.printMargin.marginCents === (8900 - 2300) + (1600 - 600) - 228 && s.printMargin.coveredRevenueCents === 10500 && s.printMargin.lineRevenueCents === 10900,
      `${s.printMargin.marginCents}`);
check("frais de paiement totalisés, et montant reçu après frais",
      s.totals.feeCents === 228 && s.totals.netCents === 15290 - 228);
check("la couverture de l'estimation est donnée", Math.abs(s.printMargin.coverage - 10500 / 10900) < 1e-9);
check("les formats sont classés par chiffre d'affaires",
      s.topProducts.map((p) => p.label).join("|") === "Toile 40 × 50 cm|Tirage 10 × 15 cm|Format retiré" && s.topProducts[1].copies === 4);
check("les galeries sont classées par chiffre d'affaires",
      s.topGalleries.map((g) => g.slug).join("|") === "dupont|martin" && s.topGalleries[0].revenueCents === 12890 && s.topGalleries[0].orders === 2);
check("conversion : galeries de la période ayant vendu",
      s.conversion.galleries === 3 && s.conversion.withSales === 2, `${s.conversion.withSales}/${s.conversion.galleries}`);

// Ventes scolaires : commandes familles réglées, par établissement et par article.
const schoolOrders = [
  { id: "sco1", amount_cents: 2500, fee_cents: 113, paid_at: at("2026-09-20T09:00:00Z"), school_id: "sch1", school_name: "École du Centre", year_id: "y1", year_label: "2026-2027" },
  { id: "sco2", amount_cents: 4000, fee_cents: 180, paid_at: at("2026-10-01T09:00:00Z"), school_id: "sch1", school_name: "École du Centre", year_id: "y1", year_label: "2026-2027" },
  { id: "sco3", amount_cents: 1500, fee_cents: 68, paid_at: at("2026-10-02T09:00:00Z"), school_id: "sch2", school_name: "Crèche Les Lutins", year_id: "y2", year_label: "2026-2027" },
  { id: "sco_old", amount_cents: 9900, fee_cents: 0, paid_at: at("2024-10-02T09:00:00Z"), school_id: "sch1", school_name: "École du Centre", year_id: "y0", year_label: "2024-2025" },
];
const schoolLines = [
  { order_id: "sco1", name: "Pochette Classique", quantity: 1, price_cents: 2500 },
  { order_id: "sco2", name: "Pochette Classique", quantity: 1, price_cents: 2500 },
  { order_id: "sco2", name: "Photo de classe 20 × 30", quantity: 2, price_cents: 750 },
  { order_id: "sco3", name: "Photo de classe 20 × 30", quantity: 2, price_cents: 750 },
  { order_id: "sco_old", name: "Ancien article", quantity: 9, price_cents: 1100 },
];
const withSchool = summarizeSales({ payments, orders, products, galleries, schoolOrders, schoolLines, nowSeconds: NOW });
const wk = Object.fromEntries(withSchool.months.map((m) => [m.key, m]));
check("ventes scolaires : leur propre série, dans le mois du paiement (hors fenêtre ignorées)",
      wk["2026-09"].schoolCents === 2500 && wk["2026-10"].schoolCents === 5500 && withSchool.totals.schoolCents === 8000,
      `${withSchool.totals.schoolCents}`);
check("ventes scolaires comprises dans le chiffre d'affaires, les paiements, les frais et le net",
      withSchool.totals.revenueCents === 15290 + 8000 && withSchool.totals.orders === 6 &&
      withSchool.totals.feeCents === 228 + 113 + 180 + 68 && withSchool.totals.netCents === 23290 - 589 &&
      withSchool.totals.averageOrderCents === Math.round(23290 / 6));
check("établissements classés par chiffre d'affaires, avec leur année",
      withSchool.topSchools.map((x) => `${x.name} ${x.yearLabel} ${x.revenueCents} ${x.orders}`).join("|") ===
      "École du Centre 2026-2027 6500 2|Crèche Les Lutins 2026-2027 1500 1" && withSchool.topSchools[0].yearId === "y1");
check("articles scolaires classés (quantités × prix unitaire), hors commandes anciennes",
      withSchool.topSchoolProducts.map((x) => `${x.label} ${x.copies} ${x.revenueCents}`).join("|") ===
      "Pochette Classique 2 5000|Photo de classe 20 × 30 4 3000");
check("la marge des tirages et la conversion des galeries ne bougent pas",
      withSchool.printMargin.marginCents === s.printMargin.marginCents && withSchool.conversion.withSales === s.conversion.withSales);

const empty = summarizeSales({ payments: [], orders: [], products: [], galleries: [], nowSeconds: NOW });
check("sans vente, tout vaut zéro sans division par zéro",
      empty.totals.revenueCents === 0 && empty.totals.averageOrderCents === 0 && empty.conversion.rate === 0 && empty.printMargin.coverage === 0 && empty.months.length === 12 &&
      empty.totals.schoolCents === 0 && empty.topSchools.length === 0 && empty.topSchoolProducts.length === 0);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
