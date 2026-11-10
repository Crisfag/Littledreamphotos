// Vérifie sur une vraie base SQLite (schema.sql) les options payantes et
// la relance des suppléments non réglés :
// - catalogue du studio (création, contrôles, cloisonnement, suppression) ;
// - le client coche, change la quantité, décoche ; galerie sans options ;
// - le dû = suppléments + options, y compris sans forfait ;
// - paiement par carte (page Stripe à plusieurs lignes, webhook signé),
//   en espèces ou par virement, ou réglé à la main : options figées au prix
//   payé, facture détaillée ;
// - relances 3 et 7 jours après la validation, une seule fois, avec le
//   numéro de compte ; relance à la main.
//
//   node tests/options.test.mjs

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { inflateSync } from "node:zlib";
import {
  createOption, updateOption, deleteOption, getOptionsCatalog, handleOptionChoice, optionsForClient,
  amountDueFor, markOptionsPaid, setGalleryOptionsEnabled, optionsForAdmin,
} from "../src/options.js";
import { handleOfflineRequest, confirmOfflinePayment, settleSupplement, listDueSupplements } from "../src/offlinepay.js";
import { handleStripeWebhook } from "../src/billing.js";
import { handleViewer } from "../src/viewer.js";
import { signToken } from "../src/auth.js";
import { unpaidReminderDue, runUnpaidReminders, remindUnpaidNow } from "../src/unpaidreminders.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

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
const files = new Map();
const env = {
  DB: fakeD1(db), TOKEN_SECRET: "secret", RESEND_API_KEY: "re_test", STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET_PLATFORM: "whsec_test", PUBLIC_SITE_ORIGIN: "https://www.holypixx.com",
  TILES: { put: async (key, value) => { files.set(key, value); }, get: async (key) => (files.has(key) ? { body: files.get(key) } : null) },
};
const DAY = 86400;
const t = Math.floor(Date.now() / 1000);
const run = (sql, ...args) => db.prepare(sql).run(...args);
run(`INSERT INTO photographers (id, email, password_hash, password_salt, created_at, studio_name, billing_address, billing_company_name, billing_iban, plan, plan_status,
       offline_cash, offline_cash_address, offline_transfer, stripe_account_id, stripe_charges_enabled)
     VALUES ('ph', 'julie@x.be', 'x', 'x', ?, 'Studio Julie', 'Rue des Fleurs 1', 'Little Dream Photos SRL', 'BE68 5390 0754 7034', 'pro', 'active',
       1, 'Rue des Fleurs 1, Bruxelles', 1, 'acct_julie', 1)`, t);
run(`INSERT INTO photographers (id, email, password_hash, password_salt, created_at, studio_name, plan, plan_status)
     VALUES ('ph2', 'autre@x.be', 'x', 'x', ?, 'Autre', 'pro', 'active')`, t);
function gallery(id, photographerId, { selected = 0, included = 2, email = "lea@client.be", validatedAt = null } = {}) {
  run(`INSERT INTO galleries (id, slug, title, photographer_id, password_hash, password_salt, created_at, client_name, client_email, included_photos, extra_photo_price_cents, language, selection_done_at)
       VALUES (?, ?, ?, ?, 'x', 'x', ?, 'Léa Martin', ?, ?, 1500, 'fr', ?)`, id, id, `Galerie ${id}`, photographerId, t, email, included, validatedAt);
  for (let i = 0; i < 6; i++) {
    run("INSERT INTO photos (id, gallery_id, width, height, cols, rows, position, selected, created_at) VALUES (?, ?, 1, 1, 1, 1, ?, ?, ?)",
        `${id}_p${i}`, id, i, i < selected ? 1 : 0, t);
  }
  return db.prepare("SELECT * FROM galleries WHERE id = ?").get(id);
}
const row = (id) => db.prepare("SELECT * FROM galleries WHERE id = ?").get(id);

const mails = [];
const stripeCalls = [];
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.includes("api.resend.com")) {
    mails.push(JSON.parse(init.body));
    return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
  }
  if (url.includes("api.stripe.com")) {
    stripeCalls.push({ url, body: new URLSearchParams(init.body || "") });
    return { ok: true, status: 200, json: async () => ({ id: `cs_test_${stripeCalls.length}`, url: "https://checkout.stripe.com/x" }) };
  }
  throw new Error("réseau inattendu : " + url);
};
const post = (body) => new Request("https://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const choose = async (g, optionId, quantity) => {
  const res = await handleOptionChoice(post({ optionId, quantity }), env, row(g.id));
  return { status: res.status, body: await res.json() };
};

/* ---------- Catalogue ---------- */

let res = await createOption(post({ label: "", price: 10 }), env, "ph");
check("option sans nom : refusée", res.status === 400);
res = await createOption(post({ label: "Clé USB", price: "0" }), env, "ph");
check("option à 0 € : refusée", res.status === 400);
const retouche = (await (await createOption(post({ label: "Retouche avancée", description: "Peau, objet gênant retiré", price: "15", perUnit: true }), env, "ph")).json()).option;
const express = (await (await createOption(post({ label: "Livraison express 48 h", price: "29,90" }), env, "ph")).json()).option;
const usb = (await (await createOption(post({ label: "Clé USB", price: 25 }), env, "ph")).json()).option;
const foreign = (await (await createOption(post({ label: "Autre studio", price: 5 }), env, "ph2")).json()).option;
check("trois options créées, prix à la virgule compris (29,90 €)", express.priceCents === 2990 && retouche.perUnit && !express.perUnit);
const catalog = (await (await getOptionsCatalog(env, "ph")).json()).options;
check("catalogue : seulement les options du studio, dans l'ordre", catalog.map((o) => o.label).join() === "Retouche avancée,Livraison express 48 h,Clé USB");
res = await updateOption(post({ active: false }), env, "ph2", usb.id);
check("un autre studio ne peut pas modifier l'option", res.status === 404);

/* ---------- Le client coche ---------- */

const g1 = gallery("g1", "ph", { selected: 4 });          // 2 suppléments × 15 €
let client = await optionsForClient(env, row("g1"));
check("galerie client : 3 options proposées, rien de coché", client.available.length === 3 && client.chosen.length === 0);
let r = await choose(g1, retouche.id, 3);
check("retouche avancée × 3 cochée", r.status === 200 && r.body.options.chosen[0].quantity === 3 && !r.body.options.chosen[0].paid);
r = await choose(g1, retouche.id, 2);
check("quantité changée : 2, pas de doublon", r.body.options.chosen.length === 1 && r.body.options.chosen[0].quantity === 2);
r = await choose(g1, express.id, 5);
check("option sans quantité : ramenée à 1", r.body.options.chosen.find((c) => c.optionId === express.id).quantity === 1);
r = await choose(g1, foreign.id, 1);
check("option d'un autre studio : refusée", r.status === 404);
r = await choose(g1, usb.id, 1);
r = await choose(g1, usb.id, 0);
check("décochée : la clé USB disparaît", !r.body.options.chosen.some((c) => c.optionId === usb.id));
let due = await amountDueFor(env, row("g1"));
check("dû : 2 × 15 € de suppléments + 2 × 15 € retouche + 29,90 € express = 89,90 €",
      due.dueTotalCents === 3000 && due.optionsCents === 5990 && due.totalCents === 8990, JSON.stringify({ e: due.dueTotalCents, o: due.optionsCents }));

// Prix changé avant paiement : le client paie le prix actuel.
await updateOption(post({ label: "Retouche avancée", description: "Peau, objet gênant retiré", price: 20, perUnit: true }), env, "ph", retouche.id);
due = await amountDueFor(env, row("g1"));
check("prix de l'option modifié avant paiement : le nouveau prix compte", due.optionsCents === 4000 + 2990);

/* ---------- Carte : page Stripe à plusieurs lignes, webhook ---------- */

const token = await signToken(env.TOKEN_SECRET, { g: "g1", v: "visiteur", exp: t + 3600 });
res = await handleViewer(new Request("https://x/api/gallery/g1/checkout", {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({ successUrl: "https://x/ok", cancelUrl: "https://x/ko" }),
}), env, { waitUntil() {} }, "/api/gallery/g1/checkout");
const sent = stripeCalls.at(-1).body;
check("page de paiement : 3 lignes (suppléments, retouche × 2, express)",
      res.status === 200 && sent.get("line_items[0][quantity]") === "2" && sent.get("line_items[1][price_data][product_data][name]").startsWith("Retouche avancée") &&
      sent.get("line_items[1][quantity]") === "2" && sent.get("line_items[2][price_data][unit_amount]") === "2990", [...sent.keys()].filter((k) => k.startsWith("line_items")).length + " champs");
let pay = db.prepare("SELECT * FROM payments WHERE gallery_id = 'g1' AND status = 'pending'").get();
check("paiement en attente : 99,90 €, options figées dans le paiement", pay.amount_cents == 9990 && JSON.parse(pay.options_json).length === 2);

// Pendant ce temps, le client passe la retouche à 3.
await choose(g1, retouche.id, 3);

async function webhook(sessionId) {
  const payload = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: sessionId, payment_status: "paid", payment_intent: "pi_x", metadata: {} } } });
  const ts = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec_test"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${payload}`))).toString("hex");
  return handleStripeWebhook(new Request("https://x/stripe", { method: "POST", headers: { "Stripe-Signature": `t=${ts},v1=${sig}` }, body: payload }), env);
}
res = await webhook(pay.stripe_checkout_session_id);
client = await optionsForClient(env, row("g1"));
const paidRetouche = client.chosen.find((c) => c.optionId === retouche.id && c.paid);
check("webhook : retouche × 2 et express réglées, au prix payé", res.status === 200 && paidRetouche?.quantity === 2 && paidRetouche.unitCents === 2000 && client.chosen.some((c) => c.optionId === express.id && c.paid));
check("la 3e retouche ajoutée entre-temps reste à régler (1 × 20 €)",
      client.chosen.some((c) => c.optionId === retouche.id && !c.paid && c.quantity === 1) && (await amountDueFor(env, row("g1"))).totalCents === 2000);
let invoice = db.prepare("SELECT * FROM invoices WHERE gallery_id = 'g1'").get();
const pdf = pdfText(files.get(`invoices/${invoice.id}.pdf`));
check("facture : 99,90 € détaillée (suppléments, retouche × 2, express)",
      invoice.amount_cents === 9990 && hasText(pdf, "Photos supplémentaires et options") && hasText(pdf, "2 × Retouche avancée") && hasText(pdf, "Livraison express 48 h"));

/* ---------- Options seules, sans forfait : espèces ---------- */

const g2 = gallery("g2", "ph", { selected: 6, included: null });
await choose(g2, usb.id, 1);
due = await amountDueFor(env, row("g2"));
check("galerie sans forfait : seules les options sont dues (25 €)", due.dueExtraCount === 0 && due.totalCents === 2500);
const before = mails.length;
res = await handleOfflineRequest(post({ method: "cash" }), env, null, row("g2"));
let body = await res.json();
check("demande en espèces pour les options seules", res.status === 200 && body.pending.amountCents === 2500);
check("e-mails : la clé USB y est nommée", mails.slice(before).every((m) => m.text.includes("Clé USB")));
pay = db.prepare("SELECT * FROM payments WHERE gallery_id = 'g2' AND status = 'awaiting'").get();
res = await confirmOfflinePayment(env, row("g2"), pay.id);
check("« Marquer comme reçu » : la clé USB passe en réglée", res.status === 200 && (await amountDueFor(env, row("g2"))).totalCents === 0 && (await optionsForClient(env, row("g2"))).chosen[0].paid);
invoice = db.prepare("SELECT * FROM invoices WHERE gallery_id = 'g2'").get();
check("facture « Options — … » avec la clé USB", hasText(pdfText(files.get(`invoices/${invoice.id}.pdf`)), "Options") && hasText(pdfText(files.get(`invoices/${invoice.id}.pdf`)), "Clé USB"));

/* ---------- Tableau des suppléments, réglé à la main ---------- */

const g3 = gallery("g3", "ph", { selected: 3 });          // 1 supplément
await choose(g3, express.id, 1);
let list = await (await listDueSupplements(env, "ph")).json();
const line3 = list.supplements.find((s) => s.slug === "g3");
check("tableau : supplément + option, total 44,90 €", line3 && line3.extrasCents === 1500 && line3.optionsCents === 2990 && line3.dueTotalCents === 4490);
check("tableau : la retouche restante de g1 (options seules) y figure aussi", list.supplements.some((s) => s.slug === "g1" && s.dueTotalCents === 2000 && s.dueExtraCount === 0));
res = await settleSupplement(post({ method: "transfer", amountCents: 4490 }), env, row("g3"));
check("« Réglé par virement » : supplément et option réglés d'un coup", res.status === 200 && (await amountDueFor(env, row("g3"))).totalCents === 0 && (await optionsForAdmin(env, row("g3"))).chosen.every((c) => c.paid));

/* ---------- Galerie sans options, option supprimée ---------- */

const g4 = gallery("g4", "ph", { selected: 1 });
await choose(g4, usb.id, 1);
await setGalleryOptionsEnabled(post({ enabled: false }), env, row("g4"));
check("options désactivées sur la galerie : plus rien proposé ni dû", (await optionsForClient(env, row("g4"))) === null && (await amountDueFor(env, row("g4"))).totalCents === 0);
r = await choose(g4, usb.id, 1);
check("et le client ne peut plus cocher", r.status === 400);
await setGalleryOptionsEnabled(post({ enabled: true }), env, row("g4"));
await deleteOption(env, "ph", usb.id);
check("option supprimée du catalogue : plus due…", (await amountDueFor(env, row("g4"))).totalCents === 0);
check("…mais ce qui a été payé reste lisible (clé USB de g2)", (await optionsForClient(env, row("g2"))).chosen.some((c) => c.label === "Clé USB" && c.paid));

/* ---------- Instantané : option décochée pendant le paiement ---------- */

const g5 = gallery("g5", "ph", { selected: 0 });
await choose(g5, express.id, 1);
const snapshot = (await amountDueFor(env, row("g5"))).options;
await choose(g5, express.id, 0);
await markOptionsPaid(env, { id: "pay_x", gallery_id: "g5", paid_at: t, options_json: JSON.stringify(snapshot) });
check("décochée pendant le paiement : la ligne payée est recréée", (await optionsForClient(env, row("g5"))).chosen.some((c) => c.paid && c.optionId === express.id));

/* ---------- Relances des impayés ---------- */

check("relance : rien avant 3 jours", unpaidReminderDue({ validatedAt: t, now: t + 2 * DAY, sentKinds: new Set() }) === null);
check("relance à 3 jours, puis à 7, plus rien à 14", unpaidReminderDue({ validatedAt: t, now: t + 3 * DAY, sentKinds: new Set() }) === `unpaid_d3_${t}` &&
      unpaidReminderDue({ validatedAt: t, now: t + 8 * DAY, sentKinds: new Set([`unpaid_d3_${t}`]) }) === `unpaid_d7_${t}` &&
      unpaidReminderDue({ validatedAt: t, now: t + 15 * DAY, sentKinds: new Set() }) === null);

run("DELETE FROM payments"); run("DELETE FROM gallery_option_choices"); run("DELETE FROM reminders_sent");
const validated = t - 4 * DAY;
gallery("r1", "ph", { selected: 4, validatedAt: validated });                     // 30 € dus
gallery("r2", "ph", { selected: 4, validatedAt: validated, email: "" });          // pas d'e-mail
gallery("r3", "ph", { selected: 2, validatedAt: validated });                     // rien de dû
gallery("r4", "ph", { selected: 4, validatedAt: t - 20 * DAY });                  // trop ancien
gallery("r5", "ph2", { selected: 4, validatedAt: validated });                    // studio : relances coupées
run("UPDATE photographers SET unpaid_reminders_enabled = 0 WHERE id = 'ph2'");
mails.length = 0;
let result = await runUnpaidReminders(env, { now: t });
check("passe du matin : seule la galerie concernée est relancée", result.sent.map((s) => s.slug).join() === "r1", result.sent.map((s) => s.slug).join());
const mail = mails[0];
check("e-mail : montant, carte, virement avec le numéro de compte, espèces",
      mail.subject.includes("30,00 €") && mail.text.includes("En ligne, par carte") && mail.text.includes("BE68 5390 0754 7034") &&
      mail.text.includes("Little Dream Photos SRL") && mail.text.includes("Rue des Fleurs 1, Bruxelles") && mail.reply_to === "julie@x.be", mail.text);
result = await runUnpaidReminders(env, { now: t + 3600 });
check("repassée le même jour : pas de second e-mail", result.sent.length === 0);
result = await runUnpaidReminders(env, { now: t + 4 * DAY });
check("7 jours après la validation : deuxième relance", result.sent.map((s) => s.slug).join() === "r1");
result = await runUnpaidReminders(env, { now: t + 5 * DAY });
check("puis plus rien", result.sent.length === 0);

run("DELETE FROM reminders_sent");  // les passes ci-dessus étaient datées dans le futur
res = await remindUnpaidNow(env, row("r1"));
check("« Relancer » à la main : e-mail parti", res.status === 200 && mails.at(-1).to === "lea@client.be");
res = await remindUnpaidNow(env, row("r1"));
check("double clic : une seule relance", res.status === 409);
res = await remindUnpaidNow(env, row("r2"));
check("sans e-mail client : refusé avec explication", res.status === 400);
res = await remindUnpaidNow(env, row("r3"));
check("rien à régler : refusé", res.status === 409);
list = await (await listDueSupplements(env, "ph")).json();
check("tableau : « relancé le … » renseigné", list.supplements.find((s) => s.slug === "r1").remindedAt > 0);

function pdfText(bytes) {
  const raw = Buffer.from(bytes).toString("latin1");
  let out = raw;
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    try { out += inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"); } catch { /* flux non compressé */ }
  }
  return out;
}
function hasText(text, str) {
  const hex = Buffer.from(str, "latin1").toString("hex").toUpperCase();
  return text.includes(str) || text.toUpperCase().includes(hex);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
