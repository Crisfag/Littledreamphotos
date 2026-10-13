// Vérifie les règles des devis et contrats sans réseau ni D1 : prestations,
// empreinte du document signé, PDF (accents, émojis, plusieurs pages),
// e-mails, formules.
//
//   node tests/contracts.test.mjs

import { PDFDocument } from "pdf-lib";
import { normalizeLines, canonicalContent, sha256Hex, buildContractPdf, formatEurosPdf, DEFAULT_TERMS } from "../src/contracts.js";
import { PLANS } from "../src/subscription.js";
import { buildContractToClientEmail, buildContractSignedEmail, buildContractDeclinedEmail, buildContractDepositPaidEmail } from "../src/notify.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const ok = normalizeLines([{ label: "Séance famille 1 h", amountCents: 18000 }, { label: "", amountCents: 0 }, { label: "Album 20×20", amountCents: 9500 }]);
check("prestations : lignes vides ignorées, total calculé", ok.lines.length === 2 && ok.totalCents === 27500);
check("prestation sans libellé ou montant négatif refusés",
      Boolean(normalizeLines([{ label: "", amountCents: 500 }]).error) && Boolean(normalizeLines([{ label: "x", amountCents: -1 }]).error) && Boolean(normalizeLines([]).error));

const contract = {
  id: "ctr_test", number: "2026-001", studio_name: "Little Dream Photos", studio_email: "studio@example.com",
  seller_name: "Christine Fagnant", seller_address: "Rue de la Station 12\n4000 Liège", seller_vat: "",
  client_name: "Camille Dubois", client_email: "camille@example.com", title: "Séance nouveau-né « cocon » 🍼",
  session_date: "samedi 14 novembre, 10 h", lines: JSON.stringify(ok.lines), total_cents: 27500, deposit_cents: 5000,
  terms: DEFAULT_TERMS + "\n\n" + "Clause supplémentaire très longue. ".repeat(220), created_at: 1791000000,
  signed_at: 1791003600, signer_name: "Camille Dubois", signer_ip_hash: "a1b2c3d4e5f6a7b8c9d0", document_hash: "",
  paid_at: null, valid_until: null,
};
const hashA = await sha256Hex(canonicalContent(contract));
contract.document_hash = hashA;
const hashB = await sha256Hex(canonicalContent({ ...contract, total_cents: 27600 }));
check("l'empreinte SHA-256 change dès qu'un montant change", /^[0-9a-f]{64}$/.test(hashA) && hashA !== hashB);
check("l'empreinte ne dépend pas de la signature elle-même", hashA === await sha256Hex(canonicalContent({ ...contract, signer_name: "Autre" })));

const pdfBytes = await buildContractPdf(contract);
const pdf = await PDFDocument.load(pdfBytes);
check("PDF généré malgré accents, guillemets et émoji, sur plusieurs pages", pdf.getPageCount() >= 2, `${pdf.getPageCount()} pages`);
check("montants au format belge dans le PDF", formatEurosPdf(1234500) === "12 345,00 EUR" && formatEurosPdf(5000) === "50,00 EUR");

const params = {
  studioName: "Little Dream Photos", clientName: "Camille", number: "2026-001", title: "Séance nouveau-né",
  sessionDate: "14 novembre", totalCents: 27500, depositCents: 5000, url: "https://www.holypixx.com/contrat.html?t=abc",
  validUntil: 1795000000, adminUrl: "https://admin/#/contrats", reason: "Trop cher <désolée>",
};
const toClient = buildContractToClientEmail(params);
check("e-mail au client : lien de signature, total, acompte, validité",
      toClient.html.includes("contrat.html?t=abc") && toClient.html.includes("275,00") && toClient.html.includes("50,00") && toClient.text.includes("Valable"));
check("e-mail de contrat signé : rappel de l'acompte s'il reste dû", buildContractSignedEmail({ ...params, depositDue: true }).text.includes("Acompte à régler") && !buildContractSignedEmail(params).text.includes("Acompte à régler"));
check("e-mail de refus : motif échappé", buildContractDeclinedEmail(params).html.includes("&lt;désolée&gt;"));
check("e-mails d'acompte reçu, client et photographe", buildContractDepositPaidEmail(params, false).subject.startsWith("Acompte reçu") && buildContractDepositPaidEmail(params, true).html.includes("Camille"));
check("devis et contrats : Pro et Studio, pas Essentiel", !PLANS.essentiel.features.contracts && PLANS.pro.features.contracts && PLANS.studio.features.contracts && !PLANS.free.features.contracts && !PLANS.scolaire.features.contracts);

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} vérifications réussies`);
process.exit(failed ? 1 : 0);
