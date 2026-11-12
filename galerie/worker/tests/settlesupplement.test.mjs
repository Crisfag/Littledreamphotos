// Vérifie sur une vraie base SQLite (schema.sql) le tableau des suppléments
// en attente de règlement (onglet Facturation) et le règlement noté à la
// main par le photographe — « Réglé par virement », « Réglé en espèces » —
// quand le client a payé hors galerie : supplément réglé, facture envoyée,
// demande en cours effacée, paiement par carte abandonné fermé chez Stripe,
// montant périmé refusé, cloisonnement entre photographes.
//
//   node tests/settlesupplement.test.mjs

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { listDueSupplements, settleSupplement } from "../src/offlinepay.js";

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
  PUBLIC_SITE_ORIGIN: "https://www.holypixx.com",
  TILES: { put: async (key, value) => { files.set(key, value); }, get: async (key) => (files.has(key) ? { body: files.get(key) } : null) },
};
const t = Math.floor(Date.now() / 1000);
const run = (sql, ...args) => db.prepare(sql).run(...args);
run(`INSERT INTO photographers (id, email, password_hash, password_salt, created_at, studio_name, billing_address, plan, plan_status)
     VALUES ('ph', 'julie@x.be', 'x', 'x', ?, 'Studio Julie', 'Rue des Fleurs 1, 1000 Bruxelles', 'essentiel', 'active')`, t);
run(`INSERT INTO photographers (id, email, password_hash, password_salt, created_at, studio_name, plan, plan_status)
     VALUES ('ph2', 'autre@x.be', 'x', 'x', ?, 'Autre', 'essentiel', 'active')`, t);
function gallery(id, photographerId, { selected, included = 2, email = "lea@client.be", title = "Famille Martin", extra = {} }) {
  run(`INSERT INTO galleries (id, slug, title, photographer_id, password_hash, password_salt, created_at, client_name, client_email, included_photos, extra_photo_price_cents, language, demo, selection_done_at)
       VALUES (?, ?, ?, ?, 'x', 'x', ?, 'Léa Martin', ?, ?, 1500, 'fr', ?, ?)`,
      id, id, title, photographerId, t, email, included, extra.demo ? 1 : 0, extra.selectionDoneAt ?? null);
  for (let i = 0; i < 8; i++) {
    run("INSERT INTO photos (id, gallery_id, width, height, cols, rows, position, selected, created_at) VALUES (?, ?, 1, 1, 1, 1, ?, ?, ?)",
        `${id}_p${i}`, id, i, i < selected ? 1 : 0, t);
  }
  return db.prepare("SELECT * FROM galleries WHERE id = ?").get(id);
}
const martin = gallery("martin", "ph", { selected: 5, extra: { selectionDoneAt: t - 3600 } });     // 3 × 15 € dus
const dupont = gallery("dupont", "ph", { selected: 4, title: "Noël Dupont" });                    // 2 × 15 €, demande virement
const leroy = gallery("leroy", "ph", { selected: 3, title: "Leroy", email: "" });                 // 1 × 15 €, carte commencée
gallery("dansforfait", "ph", { selected: 2, title: "Dans le forfait" });                          // rien de dû
gallery("demo", "ph", { selected: 6, title: "Démo", extra: { demo: true } });                     // démo : ignorée
gallery("ailleurs", "ph2", { selected: 6, title: "Autre studio" });                               // autre photographe

run(`INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, status, kind, method, created_at)
     VALUES ('pay_req', 'dupont', 'offline_pay_req', 2, 3000, 'awaiting', 'supplement', 'transfer', ?)`, t - 600);
run(`INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, status, kind, created_at)
     VALUES ('pay_card', 'leroy', 'cs_test_leroy', 1, 1500, 'pending', 'supplement', ?)`, t - 300);
run(`INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, status, kind, created_at)
     VALUES ('pay_old', 'martin', 'cs_test_old', 3, 4500, 'pending', 'supplement', ?)`, t - 3 * 86400);

const mails = [];
const expired = [];
let stripeRefuses = false;
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.includes("api.resend.com")) {
    mails.push(JSON.parse(init.body));
    return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
  }
  const m = /api\.stripe\.com\/v1\/checkout\/sessions\/([^/]+)\/expire$/.exec(url);
  if (m && init.method === "POST") {
    if (stripeRefuses) return { ok: false, status: 400, json: async () => ({ error: { message: "Only Checkout Sessions with a status of open can be expired." } }) };
    expired.push(decodeURIComponent(m[1]));
    return { ok: true, status: 200, json: async () => ({ id: m[1], status: "expired" }) };
  }
  throw new Error("réseau inattendu : " + url);
};
const post = (body) => new Request("https://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const payments = (galleryId) => db.prepare("SELECT * FROM payments WHERE gallery_id = ? ORDER BY created_at").all(galleryId);
const paidExtra = (galleryId) => db.prepare("SELECT COALESCE(SUM(extra_count),0) AS n FROM payments WHERE gallery_id = ? AND status = 'paid'").get(galleryId).n;

/* ---------- Le tableau ---------- */

let list = await (await listDueSupplements(env, "ph")).json();
const bySlug = Object.fromEntries(list.supplements.map((s) => [s.slug, s]));
check("tableau : les 3 galeries où le client doit quelque chose, rien d'autre",
      list.supplements.map((s) => s.slug).sort().join() === "dupont,leroy,martin", list.supplements.map((s) => s.slug).join());
check("ni la galerie dans le forfait, ni la démo, ni celles d'un autre studio", !bySlug.dansforfait && !bySlug.demo && !bySlug.ailleurs);
check("montant et détail : 3 photos × 15 € = 45 €", bySlug.martin.dueExtraCount === 3 && bySlug.martin.dueTotalCents === 4500 && bySlug.martin.unitPriceCents === 1500);
check("total : 45 + 30 + 15 = 90 €", list.totalCents === 9000);
check("demande de virement en cours : signalée", bySlug.dupont.awaiting?.method === "transfer");
check("paiement par carte commencé il y a 5 min : signalé", bySlug.leroy.cardStartedAt === t - 300);
check("carte abandonnée il y a 3 jours : plus signalée", bySlug.martin.cardStartedAt === null && bySlug.martin.selectionDoneAt === t - 3600);
check("nom et e-mail du client fournis", bySlug.martin.clientName === "Léa Martin" && bySlug.martin.clientEmail === "lea@client.be");

/* ---------- Réglé par virement (sans demande préalable) ---------- */

let res = await settleSupplement(post({ method: "cheque" }), env, martin);
check("moyen inconnu : refusé", res.status === 400);
res = await settleSupplement(post({ method: "transfer", amountCents: 3000 }), env, martin);
check("montant affiché périmé (le client a changé sa sélection) : refusé, rien d'enregistré", res.status === 409 && paidExtra("martin") === 0, (await res.json()).error);

res = await settleSupplement(post({ method: "transfer", amountCents: 4500 }), env, martin);
let body = await res.json();
let paid = payments("martin").filter((p) => p.status === "paid");
check("« Réglé par virement » : 3 suppléments réglés, 45 €", res.status === 200 && paid.length === 1 && paid[0].extra_count === 3 && paid[0].amount_cents === 4500 && paid[0].method === "transfer");
check("règlement hors Stripe : aucun frais, identifiant « offline_ »", paid[0].fee_cents === 0 && paid[0].stripe_checkout_session_id === `offline_${paid[0].id}` && paid[0].paid_at > 0);
let invoice = db.prepare("SELECT * FROM invoices WHERE payment_id = ?").get(paid[0].id);
check("facture émise et rangée", invoice && invoice.amount_cents === 4500 && files.has(`invoices/${invoice.id}.pdf`));
check("facture envoyée au client, PDF joint ; numéro renvoyé à l'écran",
      mails.at(-1)?.to === "lea@client.be" && mails.at(-1).attachments?.length === 1 && body.invoiceNumber === invoice.number && body.emailedTo === "lea@client.be");
check("vieille session carte (3 jours, déjà expirée chez Stripe) : on n'y touche pas", expired.length === 0 && payments("martin").some((p) => p.id === "pay_old"));
res = await settleSupplement(post({ method: "transfer", amountCents: 4500 }), env, martin);
check("cliqué deux fois : refusé, pas de seconde facture", res.status === 409 && db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE gallery_id = 'martin'").get().n === 1);

/* ---------- Réglé en espèces alors qu'une demande de virement attendait ---------- */

res = await settleSupplement(post({ method: "cash", amountCents: 3000 }), env, dupont);
check("« Réglé en espèces » : réglé, la demande de virement disparaît",
      res.status === 200 && payments("dupont").length === 1 && payments("dupont")[0].status === "paid" && payments("dupont")[0].method === "cash");

/* ---------- Paiement par carte commencé : fermé chez Stripe ---------- */

const mailsBefore = mails.length;
res = await settleSupplement(post({ method: "cash", amountCents: 1500 }), env, leroy);
body = await res.json();
check("carte commencée : la page de paiement Stripe est fermée (le client ne paiera pas deux fois)",
      res.status === 200 && expired.join() === "cs_test_leroy" && !payments("leroy").some((p) => p.status === "pending"));
check("pas d'e-mail client sur la galerie : facture émise quand même, aucun envoi",
      body.invoiceNumber !== "" && body.emailedTo === "" && mails.length === mailsBefore);

/* ---------- Stripe refuse (payée à l'instant) : la ligne carte reste ---------- */

const late = gallery("late", "ph", { selected: 3, title: "Course" });
run(`INSERT INTO payments (id, gallery_id, stripe_checkout_session_id, extra_count, amount_cents, status, kind, created_at)
     VALUES ('pay_late', 'late', 'cs_test_late', 1, 1500, 'pending', 'supplement', ?)`, t - 60);
stripeRefuses = true;
res = await settleSupplement(post({ method: "transfer" }), env, late);
check("Stripe refuse de fermer : réglé quand même, la ligne carte reste pour le webhook",
      res.status === 200 && payments("late").some((p) => p.id === "pay_late" && p.status === "pending") && paidExtra("late") === 1);
stripeRefuses = false;

/* ---------- Cloisonnement, état final ---------- */

list = await (await listDueSupplements(env, "ph2")).json();
check("l'autre studio ne voit que sa galerie", list.supplements.length === 1 && list.supplements[0].slug === "ailleurs");
list = await (await listDueSupplements(env, "ph")).json();
check("tout est réglé : le tableau est vide", list.supplements.length === 0 && list.totalCents === 0);

const noQuota = db.prepare("SELECT * FROM galleries WHERE id = 'ailleurs'").get();
run("UPDATE galleries SET included_photos = NULL WHERE id = 'ailleurs'");
res = await settleSupplement(post({ method: "cash" }), env, { ...noQuota, included_photos: null });
check("galerie sans forfait ni option : rien à régler, refusé", res.status === 409);

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length} vérifications, ${failed.length ? failed.length + " en échec" : "toutes passent"}.`);
process.exit(failed.length ? 1 : 0);
