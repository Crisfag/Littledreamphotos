// Vérifie sans réseau les bons cadeaux : montants, validité, QR code, PDF,
// puis sur une vraie base SQLite (schema.sql) avec un faux Stripe : achat
// depuis le mini-site (minimum, forfait, frais), paiement confirmé, page
// privée du bon (code, essais ratés limités), suivi du photographe (bon
// utilisé, annulé, émis à la main), et cloisonnement entre studios.
//
//   node tests/giftcards.test.mjs

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  parseEuros, validUntil, normalizeGiftCode, formatGiftCode, qrMatrix, buildGiftCardPdf, giftStatus,
  handleGiftShop, handleGiftPublic, handleGiftAdmin, markGiftCardPaid, purgeAbandonedGiftCards,
} from "../src/giftcards.js";
import { buildGiftCardBuyerEmail } from "../src/notify.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

/* ---------- Fonctions pures ---------- */

check("montants : « 45 », « 45,50 », « 45.5 € » ; illisible refusé",
      parseEuros("45") === 4500 && parseEuros("45,50") === 4550 && parseEuros("45.5 €") === 4550 && Number.isNaN(parseEuros("abc")));
const day = (ts) => new Date(ts * 1000).toLocaleString("fr-BE", { timeZone: "Europe/Brussels", dateStyle: "short", timeStyle: "short" });
check("validité : 12 mois plus tard, 23 h 59 à Bruxelles", day(validUntil(Date.parse("2026-10-27T10:00:00Z") / 1000, 12)) === "27/10/27 23:59", day(validUntil(Date.parse("2026-10-27T10:00:00Z") / 1000, 12)));
check("validité : 31 janvier + 1 mois = dernier jour de février", day(validUntil(Date.parse("2027-01-31T10:00:00Z") / 1000, 1)).startsWith("28/02/27"));
check("code tapé à la main : minuscules, espaces et tiret acceptés ; affiché ABCD-2345",
      normalizeGiftCode(" abcd-2345 ") === "ABCD2345" && formatGiftCode("ABCD2345") === "ABCD-2345");
const matrix = qrMatrix("https://julie.holypixx.com/bon-cadeau?c=ABCD2345");
check("QR code : matrice carrée lisible (version 3 ou 4)", matrix.length >= 29 && matrix.every((r) => r.length === matrix.length));
const pdf = await buildGiftCardPdf({
  studioName: "Studio Julie", studioEmail: "julie@x.be", studioPhone: "+32 470 00 00 00", code: "ABCD2345",
  pageUrl: "https://julie.holypixx.com/bon-cadeau?c=ABCD2345", typedUrl: "julie.holypixx.com/bon-cadeau",
  amountCents: 15000, offerTitle: "Séance naissance 😍", durationMin: 90, tierLabel: "", tierPhotos: 15,
  fromName: "Mamie Jeanne", toName: "Léa et Tom", message: "Pour garder un souvenir de ces premiers jours… Avec tout notre amour !",
  validUntil: Date.parse("2027-10-27T22:59:00Z") / 1000, terms: "Bon non remboursable, à utiliser en une fois.",
});
check("PDF du bon : généré (émoji ignoré, accents gardés), une page", Buffer.from(pdf.subarray(0, 5)).toString() === "%PDF-" && pdf.length > 3000, `${pdf.length} octets`);
const mail = buildGiftCardBuyerEmail({ studioName: "Studio Julie", code: "ABCD-2345", pageUrl: "https://x/bon-cadeau?c=ABCD2345", typedUrl: "x/bon-cadeau",
  amount: "150,00 €", offerTitle: "Séance naissance", duration: "1 h 30", tierPhotos: 15, fromName: "Mamie <b>", toName: "Léa", message: "Bisous", validUntil: "27 octobre 2027" });
check("e-mail à l'acheteur : résumé, petit mot, bouton, noms échappés",
      mail.subject.includes("Léa") && mail.html.includes("ABCD-2345") && mail.html.includes("Bisous") && mail.html.includes("Mamie &lt;b&gt;") && !mail.html.includes("Mamie <b>"));

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
const env = { DB: fakeD1(db), STRIPE_SECRET_KEY: "sk_test_faux", TOKEN_SECRET: "secret", PUBLIC_SITE_ORIGIN: "https://www.holypixx.com", STUDIO_DOMAIN: "holypixx.com", ADMIN_URL: "https://admin.holypixx.com" };
const t = Math.floor(Date.now() / 1000);
const run = (sql, ...args) => db.prepare(sql).run(...args);
run(`INSERT INTO photographers (id, email, password_hash, password_salt, created_at, studio_name, stripe_account_id, stripe_charges_enabled, plan, plan_status, subdomain)
     VALUES ('ph', 'julie@x.be', 'x', 'x', ?, 'Studio Julie', 'acct_1', 1, 'pro', 'active', 'julie')`, t);
run(`INSERT INTO photographers (id, email, password_hash, password_salt, created_at, studio_name, plan, plan_status, subdomain)
     VALUES ('ph2', 'autre@x.be', 'x', 'x', ?, 'Autre', 'pro', 'active', 'autre')`, t);
run("INSERT INTO portfolios (photographer_id, handle, published, phone, updated_at) VALUES ('ph', 'julie', 1, '+32 470 00 00 00', ?)", t);
run(`INSERT INTO booking_offers (id, photographer_id, title, description, duration_min, price_cents, deposit_cents, tiers, included, image_id, active, position, created_at)
     VALUES ('off', 'ph', 'Séance naissance', 'À domicile, en douceur', 90, 15000, 5000, ?, 'Retouches\nGalerie en ligne', 'bki_abcdefgh', 1, 0, ?)`,
    JSON.stringify([{ label: "", photos: 10, priceCents: 15000 }, { label: "", photos: 20, priceCents: 22000 }]), t);

let stripeBody = null;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("/checkout/sessions")) {
    stripeBody = new URLSearchParams(init.body);
    return { ok: true, status: 200, json: async () => ({ id: "cs_gift_1", url: "https://checkout.stripe.test/cs_gift_1" }) };
  }
  throw new Error("Appel inattendu : " + url);
};
const req = (url, body, method = body ? "POST" : "GET", ip = "1.1.1.1") =>
  new Request("https://w" + url, { method, headers: { "CF-Connecting-IP": ip, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
const shop = (path, body) => handleGiftShop(req(path, body), env, path.split("?")[0]);

let res = await shop("/api/giftcard/julie");
check("vente fermée tant que le photographe ne l'a pas ouverte", (await res.json()).enabled === false);
const admin = (parts, body, method) => handleGiftAdmin(req("/api/admin/giftcards/" + parts.join("/"), body, method), env, db.prepare("SELECT * FROM photographers WHERE id = 'ph'").get(), parts);
res = await admin(["settings"], { enabled: true, min: "40", validityMonths: 6, terms: "Non remboursable." });
check("réglages : ouverture, minimum 40 €, validité 6 mois", res.status === 200 && (await res.json()).settings.minCents === 4000);
res = await admin(["settings"], { min: "2" });
check("un minimum sous 10 € est refusé", res.status === 400);

const open = await (await shop("/api/giftcard/julie")).json();
check("mini-site : bons ouverts, minimum, validité, séances offrables avec leurs forfaits",
      open.enabled && open.minCents === 4000 && open.validityMonths === 6 && open.offers[0].tiers.length === 2 && open.offers[0].hasImage && !("imageId" in open.offers[0]));

const base = { fromName: "Mamie Jeanne", toName: "Léa", message: "Avec tout notre amour", email: "mamie@x.be", returnUrl: "https://julie.holypixx.com/" };
res = await shop("/api/giftcard/julie/buy", { ...base, amount: "30" });
check("sous le minimum : refusé avec le montant à atteindre", res.status === 400 && /40,00/.test((await res.json()).error));
res = await shop("/api/giftcard/julie/buy", { ...base, amount: "150", offerId: "off" });
check("séance à plusieurs forfaits : le forfait est demandé", res.status === 400 && /forfait/.test((await res.json()).error));
res = await shop("/api/giftcard/julie/buy", { ...base, toName: "", amount: "150" });
check("« pour » obligatoire", res.status === 400);
res = await shop("/api/giftcard/julie/buy", { ...base, amount: "220", offerId: "off", tier: 1, recipientEmail: "lea@x.be" });
const bought = await res.json();
check("achat : session Stripe vers le compte du photographe, avec frais de plateforme",
      res.status === 201 && bought.url.includes("checkout.stripe.test") && stripeBody.get("payment_intent_data[transfer_data][destination]") === "acct_1" &&
      stripeBody.get("line_items[0][price_data][unit_amount]") === "22000" && stripeBody.get("metadata[kind]") === "giftcard" &&
      stripeBody.get("line_items[0][price_data][product_data][name]") === "Bon cadeau — Séance naissance — pour Léa",
      stripeBody.get("line_items[0][price_data][product_data][name]"));
let card = db.prepare("SELECT * FROM gift_cards WHERE id = ?").get(bought.giftId);
check("le bon attend son paiement, séance recopiée (durée, forfait 20 photos, compris, image)",
      card.status === "pending" && card.duration_min === 90 && card.tier_photos === 20 && card.included.includes("Retouches") && card.image_id === "bki_abcdefgh" && card.code.length === 8);
const pendingLookup = await handleGiftPublic(req("/api/gift/" + card.code), env, "/api/gift/" + card.code);
check("un bon pas encore payé n'a pas de page", pendingLookup.status === 404);

res = await shop(`/api/giftcard/julie/order/${bought.giftId}?session_id=cs_autre`);
const wrongSession = await res.json();
check("retour de Stripe sans la bonne session : pas de code dévoilé", res.status === 200 && !("code" in wrongSession), JSON.stringify(wrongSession));
await markGiftCardPaid(env, { id: "cs_gift_1", payment_status: "paid", payment_intent: "pi_1", metadata: { kind: "giftcard", gift_id: bought.giftId } });
card = db.prepare("SELECT * FROM gift_cards WHERE id = ?").get(bought.giftId);
check("paiement confirmé : bon valable 6 mois", card.status === "paid" && card.paid_at && Math.abs(card.valid_until - (t + 182 * 86400)) < 5 * 86400);
await markGiftCardPaid(env, { id: "cs_gift_1", payment_status: "paid", payment_intent: "pi_1", metadata: { kind: "giftcard", gift_id: bought.giftId } });
check("webhook rejoué : rien ne change", db.prepare("SELECT paid_at FROM gift_cards WHERE id = ?").get(bought.giftId).paid_at === card.paid_at);
res = await shop(`/api/giftcard/julie/order/${bought.giftId}?session_id=cs_gift_1`);
const order = await res.json();
check("retour de Stripe : code et lien de la page du bon, sur l'adresse du studio",
      order.status === "valid" && order.code === formatGiftCode(card.code) && order.pageUrl === `https://julie.holypixx.com/bon-cadeau?c=${card.code}`, JSON.stringify(order));

/* ---------- Page privée du bon ---------- */

const lookup = (code, ip = "2.2.2.2", opts) => handleGiftPublic(req("/api/gift/" + encodeURIComponent(code), null, "GET", ip), env, "/api/gift/" + encodeURIComponent(code), opts);
res = await lookup(formatGiftCode(card.code).toLowerCase());
const voucher = (await res.json()).voucher;
check("page du bon (code tapé en minuscules avec tiret) : ce qui est offert",
      res.status === 200 && voucher.toName === "Léa" && voucher.fromName === "Mamie Jeanne" && voucher.message === "Avec tout notre amour" &&
      voucher.offerTitle === "Séance naissance" && voucher.durationMin === 90 && voucher.tierPhotos === 20 && voucher.amountCents === 22000 &&
      voucher.status === "valid" && voucher.studioPhone === "+32 470 00 00 00" && voucher.qr.size >= 29 && voucher.qr.path.startsWith("M") && voucher.hasImage);
check("la page ne révèle ni l'acheteur ni son e-mail", !JSON.stringify(voucher).includes("mamie@x.be"));
res = await handleGiftPublic(req(`/api/gift/${card.code}/pdf`), env, `/api/gift/${card.code}/pdf`);
check("PDF à télécharger depuis la page", res.status === 200 && res.headers.get("content-type") === "application/pdf" && /bon-cadeau-[A-Z0-9]{4}-[A-Z0-9]{4}\.pdf/.test(res.headers.get("content-disposition")));
res = await lookup(card.code, "2.2.2.2", { studioId: "ph2" });
check("sous l'adresse d'un autre studio, le bon n'existe pas", res.status === 404);
for (let i = 0; i < 12; i++) await lookup("ZZZZ2222", "3.3.3.3");
res = await lookup(card.code, "3.3.3.3");
check("12 codes erronés : la même adresse IP attend un quart d'heure, même avec le bon code", res.status === 429);

/* ---------- Suivi du photographe ---------- */

let overview = await (await admin([])).json();
check("suivi : 1 bon vendu, 220 € en circulation, lien de vente du mini-site",
      overview.cards.length === 1 && overview.totals.openCents === 22000 && overview.portfolio.shopUrl === "https://julie.holypixx.com/#offrir" && overview.cards[0].buyerEmail === "mamie@x.be");
res = await admin([bought.giftId, "redeem"], { note: "Séance du 12 décembre" });
overview = await res.json();
check("marqué comme utilisé (avec une note)", overview.cards[0].status === "redeemed" && overview.cards[0].redeemedNote === "Séance du 12 décembre");
check("…la page du bon l'indique", (await (await lookup(card.code, "4.4.4.4")).json()).voucher.status === "redeemed");
res = await admin([bought.giftId, "redeem"], {});
check("déjà utilisé : refusé", res.status === 409);
res = await admin([bought.giftId, "redeem"], { undo: true });
check("erreur de clic : le marquage s'annule", (await res.json()).cards[0].status === "valid");

res = await admin(["manual"], { fromName: "Le studio", toName: "Gagnante du concours", amount: "80", validityMonths: 3 });
const manual = await res.json();
const manualCard = manual.cards.find((c) => c.id === manual.createdId);
check("bon émis à la main : valable de suite, sans frais, sous le minimum de vente en ligne autorisé",
      res.status === 201 && manualCard.status === "valid" && manualCard.source === "manual" && manualCard.feeCents === 0 && manualCard.amountCents === 8000);
res = await admin([manual.createdId, "cancel"], {});
check("bon annulé : sort du montant en circulation", (await res.json()).totals.openCents === 22000);

db.prepare("UPDATE gift_cards SET valid_until = ? WHERE id = ?").run(t - 10, bought.giftId);
check("passé sa date : périmé", giftStatus(db.prepare("SELECT * FROM gift_cards WHERE id = ?").get(bought.giftId)) === "expired");

db.prepare("UPDATE photographers SET plan = 'essentiel' WHERE id = 'ph'").run();
check("hors formule Pro : vente fermée sur le mini-site", (await (await shop("/api/giftcard/julie")).json()).enabled === false);

db.prepare("INSERT INTO gift_cards (id, photographer_id, code, status, amount_cents, valid_until, created_at) VALUES ('old', 'ph', 'OLDC2222', 'pending', 5000, ?, ?)").run(t, t - 3 * 86400);
check("achats abandonnés depuis deux jours : effacés", (await purgeAbandonedGiftCards(env)) === 1);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
