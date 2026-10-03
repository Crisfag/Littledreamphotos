// Vérifie la logique de la boutique de tirages sans réseau ni D1 :
// chiffrement de la clé Prodigi, URLs signées, validation de la commande
// client, construction des requêtes Prodigi et lecture de leurs réponses.
//
//   node tests/prodigi.test.mjs

import {
  encryptApiKey, decryptApiKey, signFor, verifySignature, normalizeRecipient, buildOrderLines,
  buildOrderPayload, buildQuotePayload, costFromQuote, statusFromProdigiOrder, prodigiErrorMessage,
  prodigiBase, SUGGESTED_PRODUCTS, availabilityFromDetails,
} from "../src/prodigi.js";
import { CATALOGUE, resolveSelection, catalogueForAdmin, categoryLabelFor, sizingForSku, lookFor } from "../src/printCatalogue.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const SECRET = "secret-de-test";

/* ---------- Clé d'API chiffrée ---------- */

const stored = await encryptApiKey(SECRET, "sandbox-key-1234");
check("la clé Prodigi n'est jamais stockée en clair", !stored.includes("sandbox-key-1234") && stored.startsWith("v1."));
check("la clé chiffrée se relit avec le bon secret", (await decryptApiKey(SECRET, stored)) === "sandbox-key-1234");
check("deux chiffrements de la même clé diffèrent (IV aléatoire)", (await encryptApiKey(SECRET, "sandbox-key-1234")) !== stored);
check("avec un autre secret, la clé est illisible (et ne fait pas planter)", (await decryptApiKey("autre-secret", stored)) === "");
check("une valeur vide ou corrompue vaut « pas de clé »",
      (await decryptApiKey(SECRET, "")) === "" && (await decryptApiKey(SECRET, "v1.abc.def")) === "");

/* ---------- URLs signées ---------- */

const sig = await signFor(SECRET, "asset:ord_1:pho_1");
check("une signature valide est acceptée", await verifySignature(SECRET, "asset:ord_1:pho_1", sig));
check("la signature d'une photo ne vaut pas pour une autre", !(await verifySignature(SECRET, "asset:ord_1:pho_2", sig)));
check("une signature vide ou mal formée est refusée",
      !(await verifySignature(SECRET, "asset:ord_1:pho_1", "")) && !(await verifySignature(SECRET, "asset:ord_1:pho_1", "!!!")));

/* ---------- Commande client ---------- */

const goodRecipient = {
  name: "  Julie Peters ", email: "Julie@Example.com", line1: "Rue de la Paix 1", line2: "",
  postalCode: "1000", city: "Bruxelles", countryCode: "be",
};
const r = normalizeRecipient(goodRecipient);
check("une adresse complète est acceptée, nettoyée (espaces, casse)",
      r.recipient?.name === "Julie Peters" && r.recipient?.email === "julie@example.com" && r.recipient?.countryCode === "BE",
      JSON.stringify(r));
check("un e-mail invalide est refusé", Boolean(normalizeRecipient({ ...goodRecipient, email: "pas-un-mail" }).error));
check("une adresse sans ville est refusée", Boolean(normalizeRecipient({ ...goodRecipient, city: " " }).error));
check("un pays non proposé est refusé", Boolean(normalizeRecipient({ ...goodRecipient, countryCode: "US" }).error));

const photosById = new Map([
  ["pho_a", { id: "pho_a", position: 0, has_original: 1 }],
  ["pho_b", { id: "pho_b", position: 4, has_original: 0 }],
]);
const productsById = new Map([
  ["prd_1", { id: "prd_1", label: "Tirage 10 × 15", sku: "GLOBAL-PHO-4x6", attributes: "{}", price_cents: 400, active: 1 }],
  ["prd_2", { id: "prd_2", label: "Toile", sku: "GLOBAL-CAN-12x16", attributes: '{"wrap":"MirrorWrap"}', price_cents: 7900, active: 1 }],
  ["prd_off", { id: "prd_off", label: "Retiré", sku: "GLOBAL-X", attributes: "{}", price_cents: 100, active: 0 }],
]);
const built = buildOrderLines(
  [{ photoId: "pho_a", productId: "prd_1", copies: 3 }, { photoId: "pho_a", productId: "prd_2", copies: 1 }],
  { photosById, productsById }
);
check("les lignes sont figées avec le prix du catalogue, jamais celui envoyé par la page",
      built.itemsCents === 3 * 400 + 7900 && built.lines[1].attributes.wrap === "MirrorWrap" && built.lines[0].photoNumber === 1,
      JSON.stringify(built));
check("une photo sans fichier d'impression est refusée",
      Boolean(buildOrderLines([{ photoId: "pho_b", productId: "prd_1", copies: 1 }], { photosById, productsById }).error));
check("un format désactivé est refusé",
      Boolean(buildOrderLines([{ photoId: "pho_a", productId: "prd_off", copies: 1 }], { photosById, productsById }).error));
check("une quantité hors limites est refusée",
      Boolean(buildOrderLines([{ photoId: "pho_a", productId: "prd_1", copies: 11 }], { photosById, productsById }).error) &&
      Boolean(buildOrderLines([{ photoId: "pho_a", productId: "prd_1", copies: 0 }], { photosById, productsById }).error));
check("un panier vide est refusé", Boolean(buildOrderLines([], { photosById, productsById }).error));

/* ---------- Requêtes Prodigi ---------- */

const payload = buildOrderPayload({
  order: { id: "ord_test", submit_attempts: 0 },
  lines: built.lines,
  recipient: r.recipient,
  assetUrlFor: (photoId) => `https://worker.example/api/print-assets/ord_test/${photoId}?s=x`,
  callbackUrl: "https://worker.example/api/prodigi/callback/ord_test?s=y",
});
check("la commande Prodigi reprend notre référence et une clé d'idempotence par tentative",
      payload.merchantReference === "ord_test" && payload.idempotencyKey === "ord_test-1");
check("l'adresse est au format Prodigi (postalOrZipCode, townOrCity, countryCode)",
      payload.recipient.address.postalOrZipCode === "1000" && payload.recipient.address.townOrCity === "Bruxelles" &&
      payload.recipient.address.countryCode === "BE" && !("line2" in payload.recipient.address));
check("chaque ligne porte SKU, quantité, recadrage et l'URL signée du fichier d'impression",
      payload.items.length === 2 && payload.items[0].sku === "GLOBAL-PHO-4x6" && payload.items[0].copies === 3 &&
      payload.items[0].sizing === "fillPrintArea" && payload.items[0].assets[0].printArea === "default" &&
      payload.items[0].assets[0].url.includes("/api/print-assets/ord_test/pho_a"));
check("les options d'un format (ex. bord de toile) sont transmises, et omises quand il n'y en a pas",
      payload.items[1].attributes?.wrap === "MirrorWrap" && !("attributes" in payload.items[0]));
check("l'URL de notification est transmise", payload.callbackUrl.includes("/api/prodigi/callback/ord_test"));

const quotePayload = buildQuotePayload({ sku: "GLOBAL-PHO-4x6", attributes: {}, countryCode: "FR" });
check("le devis demande une unité livrée dans le pays choisi, en euros",
      quotePayload.destinationCountryCode === "FR" && quotePayload.currencyCode === "EUR" && quotePayload.items[0].copies === 1);

const cost = costFromQuote({ quotes: [{ costSummary: { items: { amount: "12.50", currency: "EUR" }, shipping: { amount: "4.95", currency: "EUR" } } }] });
check("le coût d'un devis est lu en centimes (produit et port)", cost.itemsCents === 1250 && cost.shippingCents === 495, JSON.stringify(cost));
check("un devis vide est signalé plutôt que lu comme gratuit", costFromQuote({ quotes: [] }) === null);

check("une commande en cours de fabrication est « en fabrication »",
      statusFromProdigiOrder({ status: { stage: "InProgress", issues: [] }, shipments: [] }).status === "in_production");
const shipped = statusFromProdigiOrder({
  status: { stage: "InProgress", issues: [] },
  shipments: [{ status: "Shipped", tracking: { url: "https://track.example/1" } }],
});
check("dès qu'un colis part, la commande est « expédiée » avec son lien de suivi",
      shipped.status === "shipped" && shipped.trackingUrl === "https://track.example/1");
check("une commande annulée chez Prodigi est « annulée »",
      statusFromProdigiOrder({ status: { stage: "Cancelled", issues: [] } }).status === "cancelled");

check("les erreurs Prodigi deviennent un message lisible, détail compris",
      prodigiErrorMessage({ statusText: "ValidationFailed", data: { errors: [{ property: "items[0].sku", message: "Unknown SKU" }] } }, 400)
        === "ValidationFailed — items[0].sku : Unknown SKU");

check("les erreurs Prodigi au format objet ({ propriété: [détails] }) sont lues sans planter",
      prodigiErrorMessage({ outcome: "ValidationFailed", failures: { "items[0].attributes": [{ code: "MissingRequiredAttribute", description: "finish is required" }] } }, 400)
        === "ValidationFailed — items[0].attributes : finish is required");
check("un format inattendu de détails ne fait jamais planter la lecture",
      prodigiErrorMessage({ outcome: "ValidationFailed", failures: "oups", errors: { a: "b" } }, 400).startsWith("ValidationFailed"));
check("les tirages photo suggérés précisent leur finition (option exigée par Prodigi)",
      SUGGESTED_PRODUCTS.filter((p) => p.sku.startsWith("GLOBAL-PHO")).every((p) => p.attributes.finish));
check("une clé refusée (mauvais environnement) donne une explication claire",
      prodigiErrorMessage({ statusText: "NotAuthenticated", statusCode: 401 }, 401).includes("clé Sandbox"));
check("l'environnement choisit l'adresse de Prodigi (test ou production)",
      prodigiBase({}, "sandbox") === "https://api.sandbox.prodigi.com/v4.0" && prodigiBase({}, "live") === "https://api.prodigi.com/v4.0");
check("les formats suggérés ont tous un SKU et un prix", SUGGESTED_PRODUCTS.every((p) => p.sku && p.priceCents > 0));

/* ---------- Catalogue en menus déroulants ---------- */

check("le catalogue propose 7 catégories (tirages, art, toiles, cadres, plexiglas & alu, objets, cartes)",
      CATALOGUE.length === 7 && CATALOGUE.map((c) => c.key).join(",") === "photo,art,canvas,frames,panels,gifts,cards");
const adminCatalogue = catalogueForAdmin();
check("chaque format est présenté en centimètres (ou en ml pour un mug), jamais en référence Prodigi",
      adminCatalogue.every((c) => c.products.every((p) => p.sizes.every((s) => /(cm|ml)$/.test(s.label) && !/GLOBAL|x\d/.test(s.label)))),
      JSON.stringify(adminCatalogue.flatMap((c) => c.products.flatMap((p) => p.sizes.map((s) => s.label))).filter((l) => !/(cm|ml)$/.test(l))));
const keys = CATALOGUE.flatMap((c) => c.products.map((p) => p.key));
check("chaque produit a une clé unique", new Set(keys).size === keys.length);
const acrylic = resolveSelection({ product: "acrylic-panel", size: "16x20" });
const mug = resolveSelection({ product: "gift-mug", size: "11oz" });
const cushion = resolveSelection({ product: "gift-cushion", size: "16x16" });
const card = resolveSelection({ product: "card-matte", size: "7x5" });
const rag = resolveSelection({ product: "art-photorag", size: "A3" });
check("les nouveaux produits donnent les bonnes références Prodigi",
      acrylic.sku === "GLOBAL-MOU-ACRY-16x20" && mug.sku === "GLOBAL-MUG-W" && cushion.sku === "GLOBAL-CUSH-16x16-SUE" &&
      card.sku === "GLOBAL-GRE-MOH-7x5-BLA" && rag.sku === "GLOBAL-HPR-A3",
      [acrylic.sku, mug.sku, cushion.sku, card.sku, rag.sku].join(" "));
check("leurs libellés restent lisibles",
      mug.label === "Mug en céramique blanc 330 ml" && card.label === "Carte de vœux mate 13 × 18 cm" &&
      rag.label === "Tirage d'art Hahnemühle Photo Rag A3 · 29,7 × 42 cm" &&
      resolveSelection({ product: "card-gloss", size: "6x6" }).label === "Carte de vœux brillante 14 × 14 cm",
      [mug.label, card.label, rag.label].join(" | "));
check("la photo est posée en entier sur un mug, et remplit la zone partout ailleurs",
      sizingForSku("GLOBAL-MUG-W") === "fitPrintArea" && sizingForSku("global-mug-w") === "fitPrintArea" &&
      sizingForSku("GLOBAL-CAN-16x20") === "fillPrintArea" && sizingForSku("GLOBAL-GRE-MOH-7x5-BLA") === "fillPrintArea");
const canvas = resolveSelection({ product: "canvas-stretched", size: "12x16", option: "ImageWrap" });
check("un choix de menus devient la bonne référence Prodigi, ses options et un libellé lisible",
      canvas.sku === "GLOBAL-CAN-12x16" && canvas.attributes.wrap === "ImageWrap" && canvas.label === "Toile sur châssis 30 × 40 cm — image prolongée",
      JSON.stringify(canvas));
const photo = resolveSelection({ product: "photo-ctype", size: "4x6" });
check("sans option précisée, la première finition est prise (tirage photo lustré)", photo.attributes.finish === "lustre" && photo.sku === "GLOBAL-PHO-4x6");
const floatFrame = resolveSelection({ product: "canvas-float", size: "16x20", option: "natural" });
check("les options imposées par le produit sont ajoutées d'office (toile encadrée : bord miroir)",
      floatFrame.attributes.wrap === "MirrorWrap" && floatFrame.attributes.color === "natural" && floatFrame.sku === "GLOBAL-FRA-CAN-16x20");
check("un produit, un format ou une option hors catalogue sont refusés",
      Boolean(resolveSelection({ product: "inconnu", size: "4x6" }).error) &&
      Boolean(resolveSelection({ product: "photo-ctype", size: "30x40" }).error) &&
      Boolean(resolveSelection({ product: "photo-ctype", size: "4x6", option: "mat" }).error) &&
      Boolean(resolveSelection({ product: "art-fineart", size: "12x16", option: "lustre" }).error));
check("la catégorie d'un produit se retrouve, y compris pour une référence saisie à la main",
      categoryLabelFor({ catalog_ref: "frame-classic|16x20|black" }) === "Cadres" &&
      categoryLabelFor({ sku: "GLOBAL-CAN-ROL-SC-16x20" }) === "Toiles" &&
      categoryLabelFor({ sku: "GLOBAL-CFPM-16x20" }) === "Cadres" &&
      categoryLabelFor({ sku: "PRODUIT-MAISON" }) === "Autres produits" &&
      categoryLabelFor({ sku: "GLOBAL-CUSH-16X16-SUE" }) === "Objets & cadeaux" &&
      categoryLabelFor({ sku: "GLOBAL-GRE-GLOS-7X5-BLA" }) === "Cartes" &&
      categoryLabelFor({ sku: "GLOBAL-MET-8X10" }) === "Plexiglas & aluminium");

/* ---------- Aperçu dessiné côté client ---------- */

const frameLook = lookFor({ catalog_ref: "frame-box-mount|16x20|white", sku: "GLOBAL-BOXM-16x20", attributes: '{"color":"white"}' });
check("l'aperçu d'un cadre connaît sa forme, son passe-partout, sa profondeur, ses proportions et sa couleur",
      frameLook.kind === "frame" && frameLook.mat === true && frameLook.deep === true && frameLook.ratio.join("x") === "16x20" && frameLook.color === "white",
      JSON.stringify(frameLook));
check("un produit ajouté en mode avancé retrouve son aperçu d'après son SKU (format en pouces ou A3)",
      lookFor({ sku: "GLOBAL-CAN-ROL-SC-16X20" }).kind === "canvas-flat" && lookFor({ sku: "GLOBAL-CAN-ROL-SC-16X20" }).ratio.join("x") === "16x20" &&
      lookFor({ sku: "GLOBAL-HPR-A3" }).ratio.join("x") === "297x420");
check("un mug n'a pas de proportions imposées ; un produit inconnu est montré en simple tirage",
      lookFor({ catalog_ref: "gift-mug|11oz|", sku: "GLOBAL-MUG-W" }).kind === "mug" && lookFor({ catalog_ref: "gift-mug|11oz|" }).ratio === null &&
      lookFor({ sku: "PRODUIT-MAISON", attributes: "pas du json" }).kind === "print");

/* ---------- Fiche produit Prodigi (formats réellement proposés) ---------- */

const details = (product) => ({ outcome: "Ok", product });
const frameDetails = details({
  sku: "GLOBAL-CFPM-16X20",
  attributes: { color: ["black", "white", "natural"] },
  printAreas: { default: { required: true } },
  variants: [
    { attributes: { color: "black" }, shipsTo: ["BE", "FR"] },
    { attributes: { color: "white" }, shipsTo: ["BE"] },
    { attributes: { color: "natural" }, shipsTo: ["US"] },
  ],
});
const frameBE = availabilityFromDetails(frameDetails, { optionAttribute: "color", countryCode: "BE" });
check("une fiche produit donne les options vraiment livrables dans le pays",
      frameBE.available === true && frameBE.allowed.join(",") === "black,white", JSON.stringify(frameBE));
check("un produit qui n'est livré nulle part dans le pays est écarté",
      availabilityFromDetails(frameDetails, { optionAttribute: "color", countryCode: "LU" }).available === false);
check("un produit qui exige plusieurs images (recto, verso…) est écarté : la boutique n'en envoie qu'une",
      availabilityFromDetails(details({ printAreas: { default: { required: true }, back: { required: true } }, variants: [] })).available === false &&
      availabilityFromDetails(details({ printAreas: { front: { required: true } }, variants: [] })).available === false);
const plain = availabilityFromDetails(details({ attributes: {}, printAreas: { default: { required: true }, inside: { required: false } }, variants: [{ attributes: {}, shipsTo: ["BE"] }] }), { countryCode: "BE" });
check("une zone facultative en plus n'empêche rien, et sans option rien n'est filtré", plain.available === true && plain.allowed === null, JSON.stringify(plain));
check("une réponse sans fiche est considérée indisponible", availabilityFromDetails({}).available === false);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
