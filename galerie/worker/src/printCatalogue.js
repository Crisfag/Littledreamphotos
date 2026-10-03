// Catalogue de tirages intégré : ce que le photographe choisit en menus
// déroulants (catégorie → produit → format → finition), traduit ici en
// référence Prodigi (SKU) et options. Le photographe n'a jamais à connaître
// un SKU ; chaque choix est de toute façon vérifié par un devis réel avant
// d'être ajouté à sa boutique (un format que le labo ne propose pas est
// simplement signalé « indisponible »).
//
// Sources : catalogue Prodigi vérifié contre leur API (projet open source
// jonasdhunter/prodigi-direct, MIT, 2026-09-06), fiches produits Prodigi
// (plexiglas, aluminium, Photo Rag, mugs, coussins, cartes) et devis réels
// passés depuis l'admin. Les formats listés ici sont des candidats : l'admin
// ne propose que ceux que Prodigi confirme (route « availability », qui lit
// la fiche de chaque SKU), puis chaque choix est encore vérifié par un devis.

// Formats en pouces (référence Prodigi) → libellé en centimètres.
const SIZE_CM = {
  "4x6": "10 × 15", "5x7": "13 × 18", "8x8": "20 × 20", "8x10": "20 × 25", "8x12": "20 × 30",
  "10x10": "25 × 25", "11x14": "28 × 36", "12x12": "30 × 30", "12x16": "30 × 40", "12x18": "30 × 45",
  "16x16": "40 × 40", "16x20": "40 × 50", "18x24": "45 × 60", "20x20": "50 × 50", "20x30": "50 × 75",
  "24x24": "60 × 60", "24x30": "60 × 75", "24x32": "60 × 80", "24x36": "60 × 90", "28x28": "70 × 70",
  "30x30": "75 × 75", "30x40": "75 × 100", "32x32": "80 × 80",
  "6x6": "15 × 15", "16x24": "40 × 60", "6x4": "10 × 15", "7x5": "13 × 18", "18x18": "45 × 45",
};

// Formats qui ne s'écrivent pas en pouces chez Prodigi.
const SIZE_TEXT = {
  A4: "A4 · 21 × 29,7 cm", A3: "A3 · 29,7 × 42 cm", A2: "A2 · 42 × 59,4 cm",
  "11oz": "330 ml",
};

function sizeLabel(product, size) {
  if (product.sizeLabels?.[size]) return product.sizeLabels[size];
  if (SIZE_CM[size]) return `${SIZE_CM[size]} cm`;
  return SIZE_TEXT[size] || size;
}

const FRAME_COLORS_CLASSIC = {
  black: "Noir", white: "Blanc", natural: "Bois naturel", brown: "Brun",
  "dark grey": "Gris foncé", "light grey": "Gris clair", gold: "Or antique", silver: "Argent antique",
};
const FRAME_COLORS_BOX = { black: "Noir", white: "Blanc", natural: "Bois naturel" };
const FRAME_COLORS_FLOAT = { black: "Noir", white: "Blanc", natural: "Bois naturel", brown: "Brun", gold: "Or antique", silver: "Argent antique" };

const WALL_SIZES = ["8x10", "11x14", "12x16", "16x20", "18x24", "20x30", "24x36", "30x40", "8x8", "12x12", "16x16", "20x20", "24x24", "30x30"];

// option : { attribute, label, choices: { valeurProdigi: libellé } } — la
// première valeur est proposée par défaut. fixed : options imposées.
export const CATALOGUE = [
  {
    key: "photo",
    label: "Tirages photo",
    products: [
      {
        key: "photo-ctype",
        label: "Tirage photo argentique",
        description: "Papier photo traditionnel (C-type), rendu photographique classique.",
        skuPattern: "GLOBAL-PHO-{size}",
        sizes: ["4x6", "5x7", "8x10", "8x12", "11x14", "12x18"],
        option: { attribute: "finish", label: "Finition", choices: { lustre: "Lustrée (satinée)", gloss: "Brillante" } },
      },
    ],
  },
  {
    key: "art",
    label: "Tirages d'art & posters",
    products: [
      {
        key: "art-fineart",
        label: "Tirage d'art (papier beaux-arts mat 200 g)",
        description: "Impression giclée aux encres pigmentaires, qualité archive.",
        skuPattern: "GLOBAL-FAP-{size}",
        sizes: WALL_SIZES,
      },
      {
        key: "art-photorag",
        label: "Tirage d'art Hahnemühle Photo Rag",
        description: "Papier 100 % coton 308 g, la référence des photographes : giclée aux encres pigmentaires, qualité musée.",
        skuPattern: "GLOBAL-HPR-{size}",
        sizes: ["8x10", "8x12", "11x14", "12x12", "12x16", "12x18", "16x20", "16x24", "18x24", "20x30", "24x36", "A4", "A3", "A2"],
      },
      {
        key: "art-budget-poster",
        label: "Poster",
        description: "Poster économique, papier satiné.",
        skuPattern: "GLOBAL-BLP-{size}",
        sizes: ["12x16", "16x20", "18x24", "24x36"],
      },
    ],
  },
  {
    key: "canvas",
    label: "Toiles",
    products: [
      {
        key: "canvas-stretched",
        label: "Toile sur châssis",
        description: "Toile tendue sur châssis bois de 38 mm, prête à accrocher.",
        skuPattern: "GLOBAL-CAN-{size}",
        sizes: WALL_SIZES,
        option: {
          attribute: "wrap", label: "Bords",
          choices: { MirrorWrap: "Effet miroir", ImageWrap: "Image prolongée", Black: "Bords noirs", White: "Bords blancs" },
        },
      },
      {
        key: "canvas-rolled",
        label: "Toile roulée (sans châssis)",
        description: "Toile d'artiste 400 g livrée roulée, à tendre ou encadrer.",
        skuPattern: "GLOBAL-CAN-ROL-SC-{size}",
        sizes: WALL_SIZES,
      },
      {
        key: "canvas-float",
        label: "Toile encadrée (caisse américaine)",
        description: "Toile sur châssis dans un cadre flottant.",
        skuPattern: "GLOBAL-FRA-CAN-{size}",
        sizes: ["8x10", "11x14", "16x20", "18x24", "24x36", "30x40", "8x8", "12x12", "16x16", "20x20", "24x24", "30x30"],
        option: { attribute: "color", label: "Couleur du cadre", choices: FRAME_COLORS_FLOAT },
        fixed: { wrap: "MirrorWrap" },
      },
    ],
  },
  {
    key: "frames",
    label: "Cadres",
    products: [
      {
        key: "frame-classic-mount",
        label: "Cadre classique avec passe-partout",
        description: "Tirage d'art sous verre, passe-partout blanc.",
        skuPattern: "GLOBAL-CFPM-{size}",
        sizes: ["8x10", "11x14", "16x20", "18x24", "20x30", "24x36", "30x40", "8x8", "12x12", "16x16", "20x20", "24x24", "30x30"],
        option: { attribute: "color", label: "Couleur du cadre", choices: FRAME_COLORS_CLASSIC },
      },
      {
        key: "frame-classic",
        label: "Cadre classique",
        description: "Tirage d'art sous verre, sans passe-partout.",
        skuPattern: "GLOBAL-CFP-{size}",
        sizes: ["8x10", "11x14", "16x20", "18x24", "24x36", "30x40", "8x8", "12x12", "16x16", "20x20", "24x24", "30x30"],
        option: { attribute: "color", label: "Couleur du cadre", choices: FRAME_COLORS_CLASSIC },
      },
      {
        key: "frame-box-mount",
        label: "Cadre caisse avec passe-partout",
        description: "Cadre profond, passe-partout blanc.",
        skuPattern: "GLOBAL-BOXM-{size}",
        sizes: ["8x10", "11x14", "16x20", "18x24", "24x36", "30x40", "12x12", "16x16", "20x20", "24x24"],
        option: { attribute: "color", label: "Couleur du cadre", choices: FRAME_COLORS_BOX },
      },
      {
        key: "frame-box",
        label: "Cadre caisse",
        description: "Cadre profond, sans passe-partout.",
        skuPattern: "GLOBAL-BOX-{size}",
        sizes: ["8x10", "11x14", "16x20", "18x24", "24x36", "30x40", "8x8", "12x12", "16x16", "20x20", "24x24", "30x30"],
        option: { attribute: "color", label: "Couleur du cadre", choices: FRAME_COLORS_BOX },
      },
    ],
  },
  {
    key: "panels",
    label: "Plexiglas & aluminium",
    products: [
      {
        key: "acrylic-panel",
        label: "Photo sous plexiglas",
        description: "Tirage d'art contrecollé sous plexiglas brillant de 10 mm, accroche invisible : effet galerie, couleurs profondes.",
        skuPattern: "GLOBAL-MOU-ACRY-{size}",
        sizes: ["8x8", "8x10", "8x12", "11x14", "12x12", "12x16", "12x18", "16x16", "16x20", "16x24", "18x24", "20x20", "20x30", "24x24", "24x36"],
      },
      {
        key: "metal-aluminium",
        label: "Photo sur aluminium",
        description: "Impression par sublimation sur aluminium ChromaLuxe brillant : couleurs éclatantes, léger, résiste à l'humidité.",
        skuPattern: "GLOBAL-MET-{size}",
        sizes: ["4x6", "5x7", "8x8", "8x10", "8x12", "10x10", "11x14", "12x12", "12x16", "12x18", "16x16", "16x20", "16x24", "20x20", "20x30", "24x24", "24x36", "30x40"],
      },
    ],
  },
  {
    key: "gifts",
    label: "Objets & cadeaux",
    products: [
      {
        key: "gift-board",
        label: "Panneau photo rigide",
        description: "Tirage contrecollé sur un panneau rigide, à poser ou à accrocher.",
        skuPattern: "GLOBAL-BOARD-{size}",
        sizes: ["4x6", "5x7", "6x6", "8x8", "8x10", "10x10", "11x14"],
      },
      {
        key: "gift-mug",
        label: "Mug en céramique blanc",
        description: "Mug 330 ml imprimé par sublimation, compatible lave-vaisselle et micro-ondes. La photo entière est centrée sur le mug, sans recadrage.",
        skuPattern: "GLOBAL-MUG-W",
        sizes: ["11oz"],
        sizing: "fitPrintArea",
      },
      {
        key: "gift-cushion",
        label: "Coussin en suédine",
        description: "Housse douce effet velours imprimée sur une face, dos uni, avec garnissage.",
        skuPattern: "GLOBAL-CUSH-{size}-SUE",
        sizes: ["12x12", "16x16", "18x18", "20x20", "24x24"],
      },
    ],
  },
  {
    key: "cards",
    label: "Cartes",
    products: [
      {
        key: "card-matte",
        label: "Carte de vœux mate",
        description: "Carte pliée sur papier d'art Mohawk 324 g, votre photo en couverture.",
        skuPattern: "GLOBAL-GRE-MOH-{size}-BLA",
        sizes: ["6x4", "7x5", "6x6"],
        sizeLabels: { "6x6": "14 × 14 cm" },
      },
      {
        key: "card-gloss",
        label: "Carte de vœux brillante",
        description: "Carte pliée pelliculée brillante 280 g, votre photo en couverture.",
        skuPattern: "GLOBAL-GRE-GLOS-{size}-BLA",
        sizes: ["6x4", "7x5", "6x6"],
        sizeLabels: { "6x6": "14 × 14 cm" },
      },
    ],
  },
];

// Aspect de chaque produit pour l'aperçu dessiné côté client avec la photo
// du client (aucune image du labo) : forme, passe-partout, profondeur.
const LOOKS = {
  "photo-ctype": { kind: "print" },
  "art-fineart": { kind: "print", matte: true },
  "art-photorag": { kind: "print", matte: true },
  "art-budget-poster": { kind: "print" },
  "canvas-stretched": { kind: "canvas" },
  "canvas-rolled": { kind: "canvas-flat" },
  "canvas-float": { kind: "float" },
  "frame-classic-mount": { kind: "frame", mat: true },
  "frame-classic": { kind: "frame" },
  "frame-box-mount": { kind: "frame", mat: true, deep: true },
  "frame-box": { kind: "frame", deep: true },
  "acrylic-panel": { kind: "acrylic" },
  "metal-aluminium": { kind: "metal" },
  "gift-board": { kind: "board" },
  "gift-mug": { kind: "mug" },
  "gift-cushion": { kind: "cushion" },
  "card-matte": { kind: "card", matte: true },
  "card-gloss": { kind: "card" },
};

const PAPER_MM = { A4: [210, 297], A3: [297, 420], A2: [420, 594] };

// Proportions d'un format (« 16x20 », « A4 ») ; null si le format n'en a pas
// (contenance d'un mug).
function ratioOf(size) {
  if (PAPER_MM[size]) return PAPER_MM[size];
  const m = /^(\d+)x(\d+)$/i.exec(String(size || ""));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

// Ce que la page client reçoit pour dessiner l'aperçu d'un produit en
// boutique : d'après sa référence de catalogue, ou à défaut son SKU (produit
// ajouté en mode avancé), sinon un simple tirage aux proportions de la photo.
export function lookFor(row) {
  const [productKey, refSize] = String(row.catalog_ref || "").split("|");
  let found = productKey ? findProduct(productKey) : null;
  const sku = String(row.sku || "").toUpperCase();
  if (!found) {
    let bestLength = 0;
    for (const category of CATALOGUE) {
      for (const product of category.products) {
        const prefix = skuPrefix(product);
        if (sku.startsWith(prefix) && prefix.length > bestLength) {
          found = { category, product };
          bestLength = prefix.length;
        }
      }
    }
  }
  const look = { kind: "print", ...(found ? LOOKS[found.product.key] : {}) };
  const skuSize = /-(\d+X\d+|A[234])(?:-|$)/.exec(sku);
  look.ratio = ratioOf(refSize) || (skuSize ? ratioOf(skuSize[1]) : null);
  let attributes = {};
  try { attributes = JSON.parse(row.attributes || "{}") || {}; } catch { attributes = {}; }
  if (typeof attributes.color === "string") look.color = attributes.color.toLowerCase();
  return look;
}

export function findProduct(productKey) {
  for (const category of CATALOGUE) {
    for (const product of category.products) {
      if (product.key === productKey) return { category, product };
    }
  }
  return null;
}

// Traduit un choix fait en menus déroulants en { sku, attributes, label,
// ref }. Refuse tout ce qui n'est pas dans le catalogue : le photographe ne
// peut jamais envoyer de référence arbitraire par ce chemin.
export function resolveSelection({ product: productKey, size, option }) {
  const found = findProduct(String(productKey || ""));
  if (!found) return { error: "Produit inconnu" };
  const { product } = found;
  if (!product.sizes.includes(String(size || ""))) return { error: "Format non proposé pour ce produit" };
  const attributes = { ...(product.fixed || {}) };
  let optionLabel = "";
  if (product.option) {
    const value = option === undefined || option === null || option === "" ? Object.keys(product.option.choices)[0] : String(option);
    if (!(value in product.option.choices)) return { error: `${product.option.label} non proposée` };
    attributes[product.option.attribute] = value;
    optionLabel = product.option.choices[value];
  } else if (option) {
    return { error: "Ce produit n'a pas d'option" };
  }
  return {
    sku: skuFor(product, size),
    attributes,
    label: `${product.label} ${sizeLabel(product, size)}${optionLabel ? ` — ${optionLabel.toLowerCase()}` : ""}`,
    ref: [product.key, size, product.option ? attributes[product.option.attribute] : ""].join("|"),
  };
}

// Début fixe du SKU (avant le format) : sert à reconnaître un produit
// ajouté hors menus d'après sa seule référence.
function skuPrefix(product) {
  return product.skuPattern.split("{size}")[0].toUpperCase();
}

export function skuFor(product, size) {
  return product.skuPattern.replace("{size}", size);
}

// Recadrage demandé au labo : la photo remplit la zone d'impression (tirages,
// toiles…), sauf pour les produits dont la zone est très allongée (mug), où
// elle est posée en entier au centre.
export function sizingForSku(sku) {
  const upper = String(sku || "").toUpperCase();
  for (const category of CATALOGUE) {
    for (const product of category.products) {
      if (product.sizing && upper.startsWith(skuPrefix(product))) return product.sizing;
    }
  }
  return "fillPrintArea";
}

// Version envoyée à l'admin pour construire les menus (libellés en cm).
export function catalogueForAdmin() {
  return CATALOGUE.map((category) => ({
    key: category.key,
    label: category.label,
    products: category.products.map((p) => ({
      key: p.key,
      label: p.label,
      description: p.description,
      sizes: p.sizes.map((s) => ({ key: s, label: sizeLabel(p, s) })),
      option: p.option ? { label: p.option.label, choices: Object.entries(p.option.choices).map(([value, label]) => ({ value, label })) } : null,
    })),
  }));
}

// Retrouve la catégorie d'un produit déjà en boutique (pour le regrouper
// dans l'admin), d'après sa référence de catalogue ou, à défaut, son SKU.
export function categoryLabelFor(row) {
  const productKey = String(row.catalog_ref || "").split("|")[0];
  const found = productKey ? findProduct(productKey) : null;
  if (found) return found.category.label;
  // Produit ajouté avant les menus, ou en mode avancé : on se fie au plus
  // long préfixe de SKU connu (GLOBAL-CAN-ROL-SC- avant GLOBAL-CAN-).
  const sku = String(row.sku || "").toUpperCase();
  let best = null;
  for (const category of CATALOGUE) {
    for (const product of category.products) {
      const prefix = skuPrefix(product);
      if (sku.startsWith(prefix) && (!best || prefix.length > best.prefix.length)) best = { prefix, label: category.label };
    }
  }
  return best ? best.label : "Autres produits";
}

// Formats proposés d'un clic (« Ajouter les formats suggérés »).
export const SUGGESTED_SELECTIONS = [
  { product: "photo-ctype", size: "4x6", option: "lustre", priceCents: 400 },
  { product: "photo-ctype", size: "8x12", option: "lustre", priceCents: 1200 },
  { product: "art-fineart", size: "12x16", priceCents: 3900 },
  { product: "canvas-stretched", size: "12x16", option: "MirrorWrap", priceCents: 7900 },
  { product: "frame-classic-mount", size: "16x20", option: "black", priceCents: 11900 },
];
