// Vérifie le calcul de TVA et la génération du PDF de facture — pur, sans
// réseau ni wrangler dev (aucun des deux n'a besoin de D1 ni R2).
//
//   node tests/invoices.test.mjs

import { computeVat, buildInvoicePdf, formatEuros } from "../src/invoices.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

/* ---------- TVA : franchise vs régime normal ---------- */

const franchise = computeVat({ billing_vat_number: "" }, 3000);
check("sans numéro de TVA, aucune TVA n'est calculée (régime de la franchise)",
      franchise.ratePercent === 0 && franchise.vatCents === 0 && franchise.netCents === 3000,
      JSON.stringify(franchise));

const normal = computeVat({ billing_vat_number: "BE0123456789" }, 3000);
check("avec un numéro de TVA, le taux belge normal (21%) est appliqué",
      normal.ratePercent === 21, JSON.stringify(normal));
check("le HT et la TVA calculés à partir du TTC se recomposent exactement en TTC",
      normal.netCents + normal.vatCents === 3000, JSON.stringify(normal));
check("le HT est bien inférieur au TTC (la TVA n'est jamais ajoutée par-dessus)",
      normal.netCents < 3000);

// Un montant qui ne se divise pas rond par 1,21 : l'arrondi ne doit jamais
// faire dériver la somme HT + TVA du montant réellement encaissé.
const odd = computeVat({ billing_vat_number: "BE0123456789" }, 1501);
check("l'arrondi HT/TVA reste cohérent même sur un montant impair",
      odd.netCents + odd.vatCents === 1501, JSON.stringify(odd));

/* ---------- Affichage des montants ---------- */

check("formatEuros affiche toujours deux décimales, virgule et symbole €",
      formatEuros(150000) === "1 500,00 €" || formatEuros(150000).replace(/\s/g, " ") === "1 500,00 €",
      formatEuros(150000));
check("formatEuros gère l'absence de montant sans lever d'exception",
      formatEuros(undefined) === "0,00 €", formatEuros(undefined));

/* ---------- Génération du PDF ---------- */
// Fonction pure : le contenu ne dépend que de ses paramètres, jamais d'un
// accès réseau ou d'une base — on peut donc vérifier sa robustesse ici.

const pdfNormal = await buildInvoicePdf({
  number: "2026-0001",
  issuedAt: Math.floor(Date.now() / 1000),
  seller: { name: "Studio Test SRL", address: "Rue de la Paix 1, 1000 Bruxelles", vatNumber: "BE0123456789" },
  clientName: "Famille Test",
  description: "2 photos supplémentaires — Séance test",
  amountCents: 3000,
  netCents: normal.netCents,
  vatCents: normal.vatCents,
  vatRate: normal.ratePercent,
});
check("le PDF généré (régime normal) est un vrai fichier PDF non vide",
      pdfNormal.length > 500 && Buffer.from(pdfNormal.slice(0, 5)).toString() === "%PDF-",
      `${pdfNormal.length} octets`);

const pdfFranchise = await buildInvoicePdf({
  number: "2026-0002",
  issuedAt: Math.floor(Date.now() / 1000),
  seller: { name: "Studio Test", address: "", vatNumber: "" },
  clientName: "Client",
  description: "1 photo supplémentaire — Séance sans TVA",
  amountCents: 1500,
  netCents: 1500,
  vatCents: 0,
  vatRate: 0,
});
check("le PDF généré (franchise, sans coordonnées complètes) reste un PDF valide malgré les champs vides",
      pdfFranchise.length > 500 && Buffer.from(pdfFranchise.slice(0, 5)).toString() === "%PDF-",
      `${pdfFranchise.length} octets`);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
