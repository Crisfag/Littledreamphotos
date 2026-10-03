// Vérifie les campagnes de vente sans réseau ni D1 : promotion (période,
// remise, plancher au coût du labo), prix encaissé à la commande, panier
// enregistré, et contenu des e-mails.
//
//   node tests/campaigns.test.mjs

import { activePromo, discountedCents, applyPromo, normalizeCartLines, PROMO_PERCENTS } from "../src/campaigns.js";
import { buildOrderLines } from "../src/prodigi.js";
import { buildPrintPromoEmail, buildCartReminderEmail, buildFavoritesPrintEmail } from "../src/notify.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const NOW = 1_800_000_000;
check("une promotion n'est active qu'avec une remise prévue et avant sa date de fin",
      activePromo({ promo_percent: 20, promo_ends_at: NOW + 10 }, NOW)?.percent === 20 &&
      activePromo({ promo_percent: 20, promo_ends_at: NOW - 1 }, NOW) === null &&
      activePromo({ promo_percent: 0, promo_ends_at: NOW + 10 }, NOW) === null &&
      activePromo({ promo_percent: 33, promo_ends_at: NOW + 10 }, NOW) === null);
check("les remises proposées vont de 10 à 50 %", PROMO_PERCENTS[0] === 10 && PROMO_PERCENTS.at(-1) === 50);
check("la remise s'arrondit au centime", discountedCents(3900, 0, 20) === 3120 && discountedCents(999, 0, 15) === 849);
check("jamais en dessous du coût du labo, jamais au-dessus du prix normal",
      discountedCents(3900, 3500, 20) === 3500 && discountedCents(450, 1250, 20) === 450 && discountedCents(3900, 0, 50) === 1950);

const products = [
  { id: "prd_a", label: "Toile 40 × 50 cm", sku: "GLOBAL-CAN-16x20", attributes: "{}", price_cents: 8900, cost_cents: 2300, active: 1 },
  { id: "prd_b", label: "Tirage 10 × 15 cm", sku: "GLOBAL-PHO-4x6", attributes: "{}", price_cents: 400, cost_cents: 380, active: 1 },
];
const promoted = applyPromo(products, { promo_percent: 30, promo_ends_at: NOW + 3600 }, NOW);
check("pendant la promotion, le prix payé baisse et le prix normal reste connu (prix barré)",
      promoted[0].price_cents === 6230 && promoted[0].list_price_cents === 8900 && promoted[1].price_cents === 380,
      promoted.map((p) => `${p.list_price_cents}→${p.price_cents}`).join(" "));
check("hors promotion, rien ne change", applyPromo(products, { promo_percent: 30, promo_ends_at: NOW - 1 }, NOW)[0].price_cents === 8900);
const order = buildOrderLines([{ photoId: "pho_1", productId: "prd_a", copies: 2 }], {
  photosById: new Map([["pho_1", { id: "pho_1", position: 0, has_original: 1 }]]),
  productsById: new Map(promoted.map((p) => [p.id, p])),
});
check("la commande encaisse le prix remisé (calculé par le serveur, pas par la page)", order.itemsCents === 12460, String(order.itemsCents));

const cart = normalizeCartLines([
  { photoId: "pho_1", productId: "prd_a", copies: 2 },
  { photoId: "pho_2", productId: "prd_b", copies: 0 },
  { photoId: "../x", productId: "prd_b", copies: 1 },
  { photoId: "pho_3", productId: "prd_b", copies: 11 },
  "n'importe quoi",
]);
check("le panier enregistré ne garde que des lignes bien formées", cart.length === 1 && cart[0].copies === 2 && normalizeCartLines("x") === null);

const promoMail = buildPrintPromoEmail({ studioName: "Studio", galleryTitle: "Séance Dupont", clientName: "Julie", percent: 20, endsAt: NOW + 7 * 86400, favoritesCount: 5, galleryUrl: "https://x/galerie.html?g=s" });
check("l'e-mail de promotion annonce la remise, la date de fin et les coups de cœur",
      promoMail.subject.startsWith("−20 % sur vos tirages jusqu'au") && promoMail.html.includes("5 coups de cœur") && promoMail.html.includes("Choisir mes tirages"));
const cartMail = buildCartReminderEmail({ galleryTitle: "Séance Dupont", items: [{ label: "Toile 40 × 50 cm", copies: 2 }, { label: "Tirage", copies: 1 }], promo: { percent: 20, endsAt: NOW + 86400 }, galleryUrl: "https://x" });
check("le rappel de panier liste les articles et rappelle la promotion en cours",
      cartMail.subject === "Votre panier vous attend : 3 tirages" && cartMail.html.includes("2 × Toile 40 × 50 cm") && cartMail.html.includes("−20 %"));
const favMail = buildFavoritesPrintEmail({ galleryTitle: "Séance Dupont", favoritesCount: 1, promo: null, galleryUrl: "https://x" });
check("la relance des coups de cœur s'accorde au singulier", favMail.html.includes("1 coup de cœur ") && !favMail.html.includes("−"));

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
