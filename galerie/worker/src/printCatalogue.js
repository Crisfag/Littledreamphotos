// Catalogue de tirages intégré : ce que le photographe choisit en menus
// déroulants (catégorie → produit → format → finition), traduit ici en
// référence Prodigi (SKU) et options. Le photographe n'a jamais à connaître
// un SKU ; chaque choix est de toute façon vérifié par un devis réel avant
// d'être ajouté à sa boutique (un format que le labo ne propose pas est
// simplement signalé « indisponible »).
//
// Sources : catalogue Prodigi vérifié contre leur API (projet open source
// jonasdhunter/prodigi-direct, MIT, 2026-09-06) et devis réels passés depuis
// l'admin (tirages photo, tirage d'art et toile 30 × 40, cadre 40 × 50).

// Formats en pouces (référence Prodigi) → libellé en centimètres.
const SIZE_CM = {
  "4x6": "10 × 15", "5x7": "13 × 18", "8x8": "20 × 20", "8x10": "20 × 25", "8x12": "20 × 30",
  "10x10": "25 × 25", "11x14": "28 × 36", "12x12": "30 × 30", "12x16": "30 × 40", "12x18": "30 × 45",
  "16x16": "40 × 40", "16x20": "40 × 50", "18x24": "45 × 60", "20x20": "50 × 50", "20x30": "50 × 75",
  "24x24": "60 × 60", "24x30": "60 × 75", "24x32": "60 × 80", "24x36": "60 × 90", "28x28": "70 × 70",
  "30x30": "75 × 75", "30x40": "75 × 100", "32x32": "80 × 80",
};

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
];

function findProduct(productKey) {
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
  const sizeLabel = SIZE_CM[size] || size;
  return {
    sku: product.skuPattern.replace("{size}", size),
    attributes,
    label: `${product.label} ${sizeLabel} cm${optionLabel ? ` — ${optionLabel.toLowerCase()}` : ""}`,
    ref: [product.key, size, product.option ? attributes[product.option.attribute] : ""].join("|"),
  };
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
      sizes: p.sizes.map((s) => ({ key: s, label: `${SIZE_CM[s] || s} cm` })),
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
      const prefix = product.skuPattern.replace("{size}", "").toUpperCase();
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
