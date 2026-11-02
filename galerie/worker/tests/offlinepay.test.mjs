// Vérifie sur une vraie base SQLite (schema.sql) le règlement des
// suppléments sans carte : réglages du photographe, demande du client
// (espèces, virement), e-mails envoyés une seule fois, remplacement d'une
// demande, réception confirmée par le photographe (supplément réglé,
// facture « réglé en espèces »), annulation, cloisonnement entre galeries.
//
//   node tests/offlinepay.test.mjs

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { inflateSync } from "node:zlib";
import {
  offlineOptionsFor, offlineForClient, handleOfflineRequest, updateOfflineSettings,
  confirmOfflinePayment, cancelOfflinePayment,
} from "../src/offlinepay.js";
import { buildOfflinePaymentRequestEmail, buildOfflinePaymentInstructionsEmail } from "../src/notify.js";
import { buildInvoicePdf } from "../src/invoices.js";

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
  DB: fakeD1(db), TOKEN_SECRET: "secret", RESEND_API_KEY: "re_test", ADMIN_URL: "https://admin.holypixx.com",
  PUBLIC_SITE_ORIGIN: "https://www.holypixx.com",
  TILES: { put: async (key, value) => { files.set(key, value); }, get: async (key) => (files.has(key) ? { body: files.get(key) } : null) },
};
const t = Math.floor(Date.now() / 1000);
const run = (sql, ...args) => db.prepare(sql).run(...args);
run(`INSERT INTO photographers (id, email, password_hash, password_salt, created_at, studio_name, billing_address, plan, plan_status)
     VALUES ('ph', 'julie@x.be', 'x', 'x', ?, 'Studio Julie', 'Rue des Fleurs 1, 1000 Bruxelles', 'essentiel', 'active')`, t);
run(`INSERT INTO photographers (id, email, password_hash, password_salt, created_at, studio_name, plan, plan_status)
     VALUES ('ph2', 'autre@x.be', 'x', 'x', ?, 'Autre', 'essentiel', 'active')`, t);
function gallery(id, photographerId, selected, total = 8) {
  run(`INSERT INTO galleries (id, slug, title, photographer_id, password_hash, password_salt, created_at, client_name, client_email, included_photos, extra_photo_price_cents, language)
       VALUES (?, ?, 'Famille Martin', ?, 'x', 'x', ?, 'Léa Martin', 'lea@client.be', 2, 1000, 'fr')`, id, id, photographerId, t);
  for (let i = 0; i < total; i++) {
    run("INSERT INTO photos (id, gallery_id, width, height, cols, rows, position, selected, created_at) VALUES (?, ?, 1, 1, 1, 1, ?, ?, ?)",
        `${id}_p${i}`, id, i, i < selected ? 1 : 0, t);
  }
  return db.prepare("SELECT * FROM galleries WHERE id = ?").get(id);
}
const g1 = gallery("g1", "ph", 5);
const g2 = gallery("g2", "ph2", 4);

const mails = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes("api.resend.com")) {
    mails.push(JSON.parse(init.body));
    return { ok: true, status: 200, text: async () => "" };
  }
  throw new Error("réseau inattendu : " + url);
};
const post = (body) => new Request("https://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const photographer = (id) => db.prepare("SELECT * FROM photographers WHERE id = ?").get(id);
const payments = (galleryId) => db.prepare("SELECT * FROM payments WHERE gallery_id = ? ORDER BY created_at").all(galleryId);

/* ---------- Réglages ---------- */

check("par défaut : ni espèces ni virement", JSON.stringify(offlineOptionsFor(photographer("ph"))) === JSON.stringify({ cash: false, cashAddress: "", transfer: false }));
check("rien de proposé : la galerie client ne reçoit rien", (await offlineForClient(env, g1, photographer("ph"))) === null);
let res = await handleOfflineRequest(post({ method: "cash" }), env, null, g1);
check("demande refusée tant que le studio ne propose pas les espèces", res.status === 400);

res = await updateOfflineSettings(post({ cash: true, cashAddress: "  ", transfer: false }), env, "ph");
check("espèces sans adresse : refusé", res.status === 400, (await res.json()).error);
res = await updateOfflineSettings(post({ cash: true, cashAddress: "Studio Julie, rue des Fleurs 1, Bruxelles (sur rendez-vous)", transfer: true }), env, "ph");
check("réglages enregistrés (espèces + adresse, virement)", res.status === 200 && photographer("ph").offline_cash === 1 && photographer("ph").offline_transfer === 1);
const options = await offlineForClient(env, g1, photographer("ph"));
check("la galerie client reçoit les deux moyens, l'adresse et le contact du studio",
      options.cash && options.transfer && options.cashAddress.includes("rue des Fleurs") && options.contactEmail === "julie@x.be" && options.pending === null);

/* ---------- Demande du client ---------- */

res = await handleOfflineRequest(post({ method: "cheque" }), env, null, g1);
check("moyen inconnu : refusé", res.status === 400);
res = await handleOfflineRequest(post({ method: "cash" }), env, null, g1);
let body = await res.json();
check("demande en espèces : 3 photos au-delà du forfait, 30 €", res.status === 200 && body.pending.method === "cash" && body.pending.extraCount === 3 && body.pending.amountCents === 3000, JSON.stringify(body));
let rows = payments("g1");
check("une ligne « awaiting », sans frais, méthode espèces", rows.length === 1 && rows[0].status === "awaiting" && rows[0].method === "cash" && rows[0].fee_cents === 0 && rows[0].stripe_checkout_session_id === `offline_${rows[0].id}`);
check("deux e-mails : au photographe (réponse au client) et au client (réponse au studio)",
      mails.length === 2 && mails[0].to === "julie@x.be" && mails[0].reply_to === "lea@client.be" && mails[1].to === "lea@client.be" && mails[1].reply_to === "julie@x.be");
check("e-mail au client : montant et adresse où régler", mails[1].text.includes("30,00") && mails[1].text.includes("rue des Fleurs"));
check("une demande en attente ne vaut pas règlement", db.prepare("SELECT COALESCE(SUM(extra_count),0) AS n FROM payments WHERE gallery_id='g1' AND status='paid'").get().n === 0);

res = await handleOfflineRequest(post({ method: "cash" }), env, null, g1);
check("même demande renvoyée (double clic) : pas de doublon ni de second e-mail", res.status === 200 && payments("g1").length === 1 && mails.length === 2);

res = await handleOfflineRequest(post({ method: "transfer" }), env, null, g1);
rows = payments("g1");
check("passage au virement : la demande est remplacée, pas ajoutée", rows.length === 1 && rows[0].method === "transfer" && mails.length === 4);
check("e-mail au photographe (virement) : l'inviter à envoyer son numéro de compte", mails[2].text.includes("numéro de compte") && mails[2].subject.includes("par virement"));
const client = await offlineForClient(env, g1, photographer("ph"));
check("la galerie client voit la demande en cours", client.pending && client.pending.method === "transfer" && client.pending.amountCents === 3000);

run("UPDATE photos SET selected = 1 WHERE id = 'g1_p5'");
res = await handleOfflineRequest(post({ method: "transfer" }), env, null, g1);
body = await res.json();
check("sélection agrandie : nouvelle demande au bon montant (4 photos, 40 €)", body.pending.extraCount === 4 && payments("g1").length === 1 && payments("g1")[0].amount_cents === 4000);

/* ---------- Réception confirmée par le photographe ---------- */

const pendingId = payments("g1")[0].id;
res = await confirmOfflinePayment(env, g2, pendingId);
check("une autre galerie ne peut pas confirmer ce paiement", res.status === 404 && payments("g1")[0].status === "awaiting");
const before = mails.length;
res = await confirmOfflinePayment(env, g1, pendingId);
rows = payments("g1");
check("« Marquer comme reçu » : supplément réglé", res.status === 200 && rows[0].status === "paid" && rows[0].paid_at > 0);
const invoice = db.prepare("SELECT * FROM invoices WHERE payment_id = ?").get(pendingId);
check("facture émise pour 40 € et rangée", invoice && invoice.amount_cents === 4000 && files.has(`invoices/${invoice.id}.pdf`));
check("facture envoyée au client avec le PDF joint", mails.length === before + 1 && mails.at(-1).to === "lea@client.be" && mails.at(-1).attachments?.length === 1);
res = await confirmOfflinePayment(env, g1, pendingId);
check("confirmer deux fois : refusé, pas de seconde facture", res.status === 404 && db.prepare("SELECT COUNT(*) AS n FROM invoices").get().n === 1);
res = await handleOfflineRequest(post({ method: "cash" }), env, null, g1);
check("plus rien à régler : demande refusée", res.status === 400);

/* ---------- Annulation ---------- */

run("UPDATE photos SET selected = 1 WHERE id = 'g1_p6'");
await handleOfflineRequest(post({ method: "cash" }), env, null, g1);
const second = payments("g1").find((p) => p.status === "awaiting");
check("nouvelle photo choisie : 1 supplément à régler", second && second.extra_count === 1 && second.amount_cents === 1000);
res = await cancelOfflinePayment(env, g2, second.id);
check("une autre galerie ne peut pas annuler", res.status === 404);
res = await cancelOfflinePayment(env, g1, second.id);
check("demande annulée par le photographe", res.status === 200 && !payments("g1").some((p) => p.status === "awaiting"));

/* ---------- Textes ---------- */

const en = buildOfflinePaymentInstructionsEmail({ method: "cash", studioName: "Studio <Julie>", galleryTitle: "Smith", extraCount: 1, amountCents: 1000, cashAddress: "1 Main St", photographerEmail: "j@x.be", lang: "en" });
check("e-mail client en anglais, nom du studio échappé", en.subject.includes("in cash") && en.html.includes("Studio &lt;Julie&gt;") && !en.html.includes("Studio <Julie>"));
const fr = buildOfflinePaymentRequestEmail({ method: "transfer", galleryTitle: "Martin", clientName: "", clientEmail: "", extraCount: 2, amountCents: 2000, lang: "fr" });
check("e-mail photographe sans e-mail client : le dire", fr.text.includes("aucun e-mail client"));

// Le texte d'une page pdf-lib est dans un flux compressé (FlateDecode) :
// on décompresse chaque flux pour y chercher la mention.
function pdfText(bytes) {
  const raw = Buffer.from(bytes).toString("latin1");
  let out = raw;
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    try { out += inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"); } catch { /* flux non compressé */ }
  }
  return out;
}
function hasPdfText(bytes, str) {
  const text = pdfText(bytes);
  const hex = Buffer.from(str, "latin1").toString("hex").toUpperCase();
  return text.includes(str) || text.toUpperCase().includes(hex);
}
const base = { number: "2026-0001", issuedAt: t, seller: { name: "Studio", address: "", vatNumber: "" }, lang: "fr", clientName: "Léa", description: "2 photos", details: [], amountCents: 2000, netCents: 2000, vatCents: 0, vatRate: 0 };
check("facture : « Réglé en espèces »", hasPdfText(await buildInvoicePdf({ ...base, paidBy: "cash" }), "Réglé en espèces"));
check("facture : « Réglé par virement bancaire »", hasPdfText(await buildInvoicePdf({ ...base, paidBy: "transfer" }), "Réglé par virement bancaire"));
check("facture : en ligne par défaut", hasPdfText(await buildInvoicePdf(base), "via Stripe"));

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
