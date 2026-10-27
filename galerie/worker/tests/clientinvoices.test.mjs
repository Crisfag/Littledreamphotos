// Vérifie sans réseau la facturation libre : lignes et TVA par taux (6 %
// pour une cession de droits d'auteur), échéancier, relances (3 jours avant,
// le lendemain, une semaine après), PDF ; puis sur une vraie base SQLite
// (schema.sql) avec un faux Stripe : brouillon, émission (numéro dans la
// série du photographe), paiement d'une échéance en ligne puis à la main,
// note de crédit, factures préparées depuis un contrat et un bon cadeau,
// relance d'acompte de contrat, et fiches clients (tags, prospects).
//
//   node tests/clientinvoices.test.mjs

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  readLines, computeTotals, readSchedule, reminderDue, buildClientInvoicePdf, addDays,
  handleClientInvoicesAdmin, handleInvoicePublic, markInvoicePaid, runPaymentReminders,
} from "../src/clientinvoices.js";
import { handleClientsAdmin } from "../src/clients.js";
import { buildClientInvoiceReminderEmail } from "../src/notify.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

/* ---------- Fonctions pures ---------- */

const { lines } = readLines([
  { description: "Séance famille, 1 h 30", quantity: 1, unitCents: 25000, vatRate: 21 },
  { description: "Cession de droits d'auteur, usage privé", quantity: 1, unitCents: 10600, vatRate: 6 },
  { description: "Tirages 13×18", quantity: 3, unitCents: 1210, vatRate: 21 },
], { hasVat: true });
const totals = computeTotals(lines);
check("TVA par taux : 21 % sur 286,30 €, 6 % sur 106 €, TTC 392,30 €",
      totals.totalCents === 39230 && totals.breakdown.length === 2 &&
      totals.breakdown.find((b) => b.rate === 6).netCents === 10000 && totals.breakdown.find((b) => b.rate === 6).vatCents === 600 &&
      totals.breakdown.find((b) => b.rate === 21).netCents === 23661 && totals.netCents + totals.vatCents === 39230,
      JSON.stringify(totals.breakdown));
check("sans numéro de TVA (franchise) : toutes les lignes à 0 %",
      readLines([{ description: "Séance", quantity: 1, unitCents: 20000, vatRate: 21 }], { hasVat: false }).lines[0].vatRate === 0);
check("taux inconnu et ligne vide refusés",
      Boolean(readLines([{ description: "X", quantity: 1, unitCents: 100, vatRate: 19 }], { hasVat: true }).error) &&
      Boolean(readLines([], { hasVat: true }).error));
const one = readSchedule([], 39230, { dueDate: "", today: "2026-10-27" }).schedule;
check("sans échéancier : une seule échéance à 14 jours", one.length === 1 && one[0].dueDate === "2026-11-10" && one[0].amountCents === 39230);
const two = readSchedule([{ amountCents: 10000, dueDate: "2026-10-27" }, { amountCents: 29230, dueDate: "2026-12-12" }], 39230, { today: "2026-10-27" }).schedule;
check("échéancier acompte + solde, libellés par défaut", two[0].label === "Acompte" && two[1].label === "Solde");
check("échéancier qui ne fait pas le total : refusé avec les deux montants",
      /392,30/.test(readSchedule([{ amountCents: 1000, dueDate: "2026-10-27" }], 39230, { today: "2026-10-27" }).error || ""));
const inst = { dueDate: "2026-11-10", amountCents: 100, paidAt: null, reminded: 0 };
check("relances : J-3, le lendemain, J+8 — rien entre-temps, rien deux fois",
      reminderDue(inst, "2026-11-06") === null && reminderDue(inst, "2026-11-07").stage === 1 &&
      reminderDue({ ...inst, reminded: 1 }, "2026-11-09") === null && reminderDue({ ...inst, reminded: 1 }, "2026-11-11").stage === 2 &&
      reminderDue({ ...inst, reminded: 2 }, "2026-11-18").stage === 3 && reminderDue({ ...inst, reminded: 3 }, "2026-12-30") === null);
check("rattrapage : échéance passée sans rappel → directement « dépassée », jamais « dans 3 jours »",
      reminderDue(inst, "2026-11-12").stage === 2 && reminderDue(inst, "2026-11-25").stage === 3);
check("une échéance réglée n'est jamais relancée", reminderDue({ ...inst, paidAt: 1 }, "2026-11-12") === null);
const mail = buildClientInvoiceReminderEmail({ studioName: "Studio Julie", number: "2026-0007", installment: { label: "Solde", amountCents: 29230, dueDate: "2026-12-12" }, stage: 2, pageUrl: "https://x/facture?t=a", canPayOnline: true, iban: "BE68 5390 0754 7034" });
check("e-mail de relance : échéance, montant, lien, virement", /dépassée/.test(mail.subject) && mail.html.includes("292,30") && mail.html.includes("BE68 5390 0754 7034"));
const pdf = await buildClientInvoicePdf({
  kind: "invoice", number: "2026-0007", issuedDay: "2026-10-27", dueDay: "2026-12-12", title: "Séance famille Rulmont",
  seller: { name: "Studio Julie", address: "Rue des Fleurs 1\n4000 Liège", vat: "BE0123456789", iban: "BE68 5390 0754 7034", email: "julie@x.be" },
  client: { name: "Famille Rulmont", email: "r@x.be", address: "Rue Haute 5\n1000 Bruxelles", vat: "" },
  lines, breakdown: totals.breakdown, netCents: totals.netCents, vatCents: totals.vatCents, totalCents: totals.totalCents,
  schedule: two, notes: "Merci pour votre confiance !", payUrl: "https://www.holypixx.com/facture?t=abc",
});
check("PDF de la facture généré", Buffer.from(pdf.subarray(0, 5)).toString() === "%PDF-" && pdf.length > 2000, `${pdf.length} octets`);

/* ---------- Base SQLite ---------- */

function fakeD1(db) {
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  return { prepare: (sql) => statement(sql), batch: async (list) => { for (const st of list) await st.run(); } };
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(":memory:");
db.exec(await readFile(join(root, "schema.sql"), "utf8"));
const env = { DB: fakeD1(db), STRIPE_SECRET_KEY: "sk_test_faux", PUBLIC_SITE_ORIGIN: "https://www.holypixx.com", ADMIN_URL: "https://admin.holypixx.com" };
const t = Math.floor(Date.now() / 1000);
const run = (sql, ...args) => db.prepare(sql).run(...args);
run(`INSERT INTO photographers (id, email, password_hash, password_salt, created_at, studio_name, stripe_account_id, stripe_charges_enabled, plan, plan_status,
       billing_company_name, billing_address, billing_vat_number, billing_iban, invoice_counter, invoice_counter_year)
     VALUES ('ph', 'julie@x.be', 'x', 'x', ?, 'Studio Julie', 'acct_1', 1, 'pro', 'active', 'Julie SRL', 'Rue des Fleurs 1', 'BE0123456789', 'BE68 5390 0754 7034', 6, ?)`,
    t, new Date().getFullYear());
const photographer = () => db.prepare("SELECT * FROM photographers WHERE id = 'ph'").get();
let stripeBody = null;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("/checkout/sessions")) {
    stripeBody = new URLSearchParams(init.body);
    return { ok: true, status: 200, json: async () => ({ id: "cs_inv_1", url: "https://checkout.stripe.test/cs_inv_1" }) };
  }
  throw new Error("Appel inattendu : " + url);
};
const req = (path, body, method) => new Request("https://w" + path, { method: method || (body ? "POST" : "GET"), headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
const admin = async (parts, body, method) => {
  const res = await handleClientInvoicesAdmin(req("/api/admin/client-invoices/" + parts.join("/"), body, method), env, photographer(), parts);
  return { status: res.status, body: res.headers.get("content-type")?.includes("json") ? await res.json() : null, res };
};
const year = new Date().getFullYear();
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });

let r = await admin([], { clientName: "Famille Rulmont", clientEmail: "rulmont@x.be", clientAddress: "Rue Haute 5", title: "Séance famille",
  lines: lines, schedule: [{ amountCents: 10000, dueDate: today }, { amountCents: 29230, dueDate: addDays(today, 30) }] });
const draftId = r.body.createdId;
let inv = r.body.invoices.find((i) => i.id === draftId);
check("brouillon : pas de numéro, pas de lien client", r.status === 201 && inv.status === "draft" && !inv.number && !inv.pageUrl);
r = await admin([draftId], { clientName: "Famille Rulmont", clientEmail: "rulmont@x.be", title: "Séance famille (corrigée)", lines: lines,
  schedule: [{ amountCents: 10000, dueDate: today }, { amountCents: 29230, dueDate: addDays(today, 30) }] });
check("un brouillon se corrige", r.body.invoices.find((i) => i.id === draftId).title === "Séance famille (corrigée)");
r = await admin([draftId, "issue"], { send: true });
inv = r.body.invoices.find((i) => i.id === draftId);
check("émission : numéro suivant de la série (après les 6 factures automatiques), lien client",
      inv.number === `${year}-0007` && inv.status === "issued" && inv.pageUrl.startsWith("https://www.holypixx.com/facture?t="), inv.number);
r = await admin([draftId], { clientName: "X", lines, schedule: [] });
check("une facture émise ne se modifie plus", r.status === 409);
r = await admin([draftId], null, "DELETE");
check("…ni ne se supprime", r.status === 409);

const token = db.prepare("SELECT token FROM client_invoices WHERE id = ?").get(draftId).token;
const pub = (path, body, method) => handleInvoicePublic(req(`/api/invoice/${token}${path}`, body, method), env, `/api/invoice/${token}${path}`);
let res = await pub("");
let view = (await res.json()).invoice;
check("page client : lignes, TVA 6 % et 21 %, prochaine échéance (acompte), paiement en ligne possible, IBAN",
      view.lines.length === 3 && view.breakdown.length === 2 && view.nextDue.label === "Acompte" && view.canPayOnline && view.seller.iban.startsWith("BE68") &&
      !("sourceId" in view && view.sourceId));
check("la consultation est notée", Boolean(db.prepare("SELECT viewed_at FROM client_invoices WHERE id = ?").get(draftId).viewed_at));
res = await pub("/pay", { returnUrl: "https://www.holypixx.com/facture" });
check("régler en ligne : l'acompte (100 €) chez Stripe, vers le compte du photographe",
      res.status === 200 && stripeBody.get("line_items[0][price_data][unit_amount]") === "10000" &&
      stripeBody.get("payment_intent_data[transfer_data][destination]") === "acct_1" && stripeBody.get("metadata[installment]") === "0" &&
      stripeBody.get("success_url").includes("session_id={CHECKOUT_SESSION_ID}"), stripeBody.get("line_items[0][price_data][product_data][name]"));
await markInvoicePaid(env, { id: "cs_inv_1", payment_status: "paid", metadata: { kind: "invoice", invoice_id: draftId, installment: "0" } });
inv = (await admin([])).body.invoices.find((i) => i.id === draftId);
check("acompte payé : facture partiellement réglée, le solde reste dû", inv.status === "partial" && inv.paidCents === 10000 && inv.nextDue.label === "Solde");
await markInvoicePaid(env, { id: "cs_inv_1", payment_status: "paid", metadata: { kind: "invoice", invoice_id: draftId, installment: "0" } });
check("webhook rejoué : rien ne change", (await admin([])).body.invoices.find((i) => i.id === draftId).paidCents === 10000);
r = await admin([draftId, "paid"], { index: 1 });
inv = r.body.invoices.find((i) => i.id === draftId);
check("solde reçu par virement, marqué à la main : facture réglée", inv.status === "paid" && inv.paidCents === 39230);
r = await admin([draftId, "paid"], { index: 1, undo: true });
check("…marquage annulable", r.body.invoices.find((i) => i.id === draftId).status === "partial");
check("totaux de l'onglet : reste dû 292,30 €", r.body.totals.dueCents === 29230);

r = await admin([draftId, "credit"], { reason: "Séance annulée" });
const creditId = r.body.createdId;
const credit = r.body.invoices.find((i) => i.id === creditId);
check("note de crédit : numéro suivant, montants négatifs, facture d'origine annulée et plus relancée",
      credit.kind === "credit" && credit.number === `${year}-0008` && credit.totalCents === -39230 &&
      r.body.invoices.find((i) => i.id === draftId).status === "credited" && !r.body.invoices.find((i) => i.id === draftId).reminders);
res = await handleClientInvoicesAdmin(req(`/api/admin/client-invoices/${creditId}/pdf`), env, photographer(), [creditId, "pdf"]);
check("PDF de la note de crédit", res.status === 200 && /note-de-credit-/.test(res.headers.get("content-disposition")));
res = await pub("/pay", { returnUrl: "https://www.holypixx.com/facture" });
check("une facture annulée ne se règle plus", res.status === 409);

// Facture préparée depuis un contrat signé (acompte réglé) et un bon cadeau.
run(`INSERT INTO contracts (id, photographer_id, token, number, status, studio_name, client_name, client_email, title, session_day, lines, total_cents, deposit_cents, signed_at, paid_at, created_at, updated_at)
     VALUES ('ctr', 'ph', 'tok_ctr', '2026-003', 'paid', 'Studio Julie', 'Emma Martin', 'emma@x.be', 'Mariage Emma & Tom', ?, ?, 240000, 72000, ?, ?, ?, ?)`,
    addDays(today, 60), JSON.stringify([{ label: "Reportage mariage", amountCents: 200000 }, { label: "Album 30×30", amountCents: 40000 }]), t, t, t, t);
r = await admin(["from", "contract", "ctr"]);
const prefill = r.body.prefill;
check("depuis un contrat : lignes, client, acompte déjà réglé, solde au jour du mariage",
      prefill.lines.length === 2 && prefill.clientEmail === "emma@x.be" && prefill.schedule[0].paidAt && prefill.schedule[1].amountCents === 168000 &&
      prefill.schedule[1].dueDate === addDays(today, 60) && prefill.lines[0].vatRate === 21);
r = await admin([], { ...prefill, issue: true });
const fromContract = r.body.invoices.find((i) => i.id === r.body.createdId);
check("…émise d'un coup : partiellement réglée", fromContract.status === "partial" && fromContract.source === "contract" && fromContract.paidCents === 72000);
run(`INSERT INTO gift_cards (id, photographer_id, code, status, source, amount_cents, offer_title, from_name, to_name, buyer_email, valid_until, paid_at, created_at)
     VALUES ('gft', 'ph', 'ABCD2345', 'paid', 'online', 15000, 'Séance naissance', 'Mamie Jeanne', 'Léa', 'mamie@x.be', ?, ?, ?)`, t + 86400 * 365, t, t);
r = await admin(["from", "gift", "gft"]);
check("depuis un bon cadeau : facture déjà réglée à l'acheteur", r.body.prefill.clientEmail === "mamie@x.be" && r.body.prefill.schedule[0].paidAt && r.body.prefill.lines[0].unitCents === 15000);

/* ---------- Relances ---------- */

r = await admin([], { clientName: "Paul", clientEmail: "paul@x.be", lines: [{ description: "Séance portrait", quantity: 1, unitCents: 12000, vatRate: 21 }], dueDate: addDays(today, -1), issue: true });
const lateId = r.body.createdId;
check("facture échue : marquée en retard", r.body.invoices.find((i) => i.id === lateId).status === "overdue");
run(`INSERT INTO contracts (id, photographer_id, token, number, status, studio_name, studio_email, client_name, client_email, title, lines, total_cents, deposit_cents, signed_at, created_at, updated_at)
     VALUES ('ctr2', 'ph', 'tok_ctr2', '2026-004', 'signed', 'Studio Julie', 'julie@x.be', 'Zoé', 'zoe@x.be', 'Séance grossesse', '[]', 30000, 9000, ?, ?, ?)`, t - 4 * 86400, t, t);
let sent = await runPaymentReminders(env);
const lateSchedule = JSON.parse(db.prepare("SELECT schedule FROM client_invoices WHERE id = ?").get(lateId).schedule);
check("passe quotidienne : la facture échue est relancée (étape « dépassée »), l'acompte du contrat signé il y a 4 jours aussi",
      sent >= 2 && lateSchedule[0].reminded === 2 && db.prepare("SELECT deposit_reminded FROM contracts WHERE id = 'ctr2'").get().deposit_reminded === 1, `${sent} envoi(s)`);
sent = await runPaymentReminders(env);
check("repassée le même jour : rien de plus", sent === 0, `${sent}`);
await admin([lateId, "reminders"], { on: false });
db.prepare("UPDATE client_invoices SET schedule = ? WHERE id = ?").run(JSON.stringify([{ ...lateSchedule[0], dueDate: addDays(today, -9) }]), lateId);
check("relances coupées sur une facture : plus rien ne part", (await runPaymentReminders(env)) === 0);

/* ---------- Fiches clients : prospects et tags ---------- */

run("INSERT INTO portfolio_messages (id, photographer_id, name, email, phone, event_date, message, ip_hash, created_at) VALUES ('msg', 'ph', 'Nora', 'nora@x.be', '', 'juin 2027', 'Bonjour, je me marie en juin…', 'h', ?)", t);
const clients = (parts, body, method, url = "https://w/api/admin/clients") =>
  handleClientsAdmin(req("/api/admin/clients", body, method), env, photographer(), parts, new URL(url)).then((x) => x.json());
let list = await clients([]);
const nora = list.clients.find((c) => c.email === "nora@x.be");
check("une demande du formulaire de contact devient un prospect", nora && nora.prospect && nora.messages === 1 && list.prospects >= 1);
check("une cliente qui a payé (facture, contrat) n'est pas un prospect", list.clients.find((c) => c.email === "emma@x.be").prospect === false);
check("l'acheteuse d'un bon cadeau est une cliente, avec son achat compté", list.clients.find((c) => c.email === "mamie@x.be").paidCents === 15000);
let detail = await clients([], { email: "nora@x.be", tags: ["mariage", "#Mariage", "2027", "salon de juin"] });
check("tags posés sur la fiche (doublons et # ignorés)", detail.client.tags.join("|") === "mariage|2027|salon de juin", detail.client.tags.join("|"));
check("l'historique montre la demande reçue", detail.history.some((h) => h.type === "message" && /me marie/.test(h.title)));
list = await clients([]);
check("liste : tags disponibles pour filtrer, avec leur nombre", list.tags.some((x) => x.tag === "mariage" && x.count === 1));
detail = await clients(["detail"], null, "GET", "https://w/api/admin/clients/detail?email=emma@x.be");
check("historique d'Emma : sa facture (préparée depuis le contrat) apparaît", detail.history.some((h) => h.type === "invoice" && h.number === `${year}-0009`));

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
