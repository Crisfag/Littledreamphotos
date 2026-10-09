// Vérifie les règles du portfolio sans réseau ni D1 : adresse, prestations,
// Instagram, site, téléphone, adresses publiques, e-mail de contact.
//
//   node tests/portfolio.test.mjs

import { normalizeHandle, suggestHandle, normalizeServices, normalizeInstagram, normalizeWebsite, normalizePhone, portfolioUrls, portfolioSeo, injectPortfolioSeo } from "../src/portfolio.js";
import { readFileSync } from "node:fs";
import { buildPortfolioContactEmail } from "../src/notify.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

check("l'adresse suit les règles d'un sous-domaine (minuscules, réservés refusés)",
      normalizeHandle(" Julie-Photo ").handle === "julie-photo" && normalizeHandle("www").error && normalizeHandle("a").error && normalizeHandle("").error);
check("adresse proposée : le sous-domaine, sinon le nom du studio sans accents",
      suggestHandle({ subdomain: "julie" }) === "julie" && suggestHandle({ studio_name: "Élodie & Co — Photo" }) === "elodie-co-photo",
      suggestHandle({ studio_name: "Élodie & Co — Photo" }));
check("prestations : lignes vides et doublons retirés, 8 au plus",
      normalizeServices("Mariages\n\n Mariages \nFamille").services.join("|") === "Mariages|Famille" &&
      Boolean(normalizeServices(Array.from({ length: 9 }, (_, i) => `P${i}`)).error));
check("Instagram : @compte, lien complet ou nom nu, le reste refusé",
      normalizeInstagram("@julie.photo").instagram === "julie.photo" &&
      normalizeInstagram("https://www.instagram.com/julie.photo/?hl=fr").instagram === "julie.photo" &&
      Boolean(normalizeInstagram("julie photo").error));
check("site : https ajouté si absent, schémas dangereux refusés",
      normalizeWebsite("exemple.be").website === "https://exemple.be/" &&
      Boolean(normalizeWebsite("javascript:alert(1)").error) && Boolean(normalizeWebsite("pas un site").error));
check("téléphone : chiffres et séparateurs usuels seulement",
      normalizePhone("+32 470 12 34 56").phone === "+32 470 12 34 56" && Boolean(normalizePhone("appelez-moi").error));
const env = { STUDIO_DOMAIN: "holypixx.com", PUBLIC_SITE_ORIGIN: "https://www.holypixx.com" };
check("l'adresse du studio n'est proposée qu'avec la formule Pro",
      portfolioUrls(env, { subdomain: "julie", plan: "pro", plan_status: "active" }, "julie").studio === "https://julie.holypixx.com/" &&
      portfolioUrls(env, { subdomain: "julie", plan: "free" }, "julie").studio === "" &&
      portfolioUrls(env, {}, "julie").site === "https://www.holypixx.com/portfolio.html?s=julie");
const mail = buildPortfolioContactEmail({ studioName: "Studio", name: "Camille <b>", email: "c@test.invalid", phone: "", eventDate: "avril", message: "Bonjour\n<script>x</script>" });
check("l'e-mail de contact échappe le contenu du visiteur et garde ses coordonnées",
      mail.subject.includes("Camille") && !mail.html.includes("<script>") && mail.html.includes("&lt;script&gt;") &&
      mail.html.includes("mailto:c@test.invalid") && mail.text.includes("Date souhaitée : avril") && !mail.text.includes("Téléphone"));

// Référencement : balises écrites par le serveur sous l'adresse du studio.
const row = {
  photographer_id: "ph1", handle: "julie", published: 1, studio_name: "Julie <Photo> & Co", email: "julie@test.invalid",
  subdomain: "julie", plan: "pro", plan_status: "active", city: "Liège", headline: "Portraits de famille en lumière naturelle — prix $& détails",
  bio: "", services: JSON.stringify(["Famille", "Naissance"]), phone: "+32 470 12 34 56", instagram: "julie.photo", website: "",
};
const fakeDb = {
  prepare(sql) {
    return {
      bind() { return this; },
      async first() { return /FROM portfolios p JOIN photographers/.test(sql) ? row : null; },
      async all() { return { results: [{ id: "p1", width: 2000, height: 1333 }, { id: "p2", width: 1333, height: 2000 }] }; },
    };
  },
};
const seo = await portfolioSeo({ ...env, DB: fakeDb }, "julie", "https://julie.holypixx.com");
const page = injectPortfolioSeo(readFileSync(new URL("../../web/portfolio.html", import.meta.url), "utf8"), seo);
const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
check("portfolio : titre et description du studio écrits dans la page (ville, accroche)",
      page.includes("<title>Julie &lt;Photo&gt; &amp; Co — Photographe à Liège</title>") &&
      page.includes('<meta name="description" content="Portraits de famille en lumière naturelle — prix $&amp; détails" />') &&
      !page.includes("Portfolio — Holypixx"));
check("portfolio : adresse de référence = adresse du studio (Pro), aperçu de lien avec la première photo",
      page.includes('<link rel="canonical" href="https://julie.holypixx.com/" />') &&
      page.includes('<meta property="og:image" content="https://julie.holypixx.com/api/portfolio/julie/photo/p1" />') &&
      page.includes('<meta property="og:image:width" content="2000" />') && page.includes("summary_large_image"));
check("portfolio : données structurées d'un photographe (ville, Instagram, prestations), texte du studio sans balise",
      ld["@type"] === "ProfessionalService" && ld.address.addressLocality === "Liège" &&
      ld.sameAs[0] === "https://www.instagram.com/julie.photo/" && ld.hasOfferCatalog.itemListElement.length === 2 &&
      ld.name === "Julie <Photo> & Co" && !/<Photo>/.test(page.match(/ld\+json">([\s\S]*?)<\/script>/)[1]));
const freeSeo = await portfolioSeo({ ...env, DB: { prepare: (sql) => ({ bind() { return this; }, first: async () => (/JOIN photographers/.test(sql) ? { ...row, plan: "free" } : null), all: async () => ({ results: [] }) }) } }, "julie", "https://x");
check("portfolio sans formule Pro : adresse de référence sur www, pas d'image, carte simple",
      freeSeo.canonical === "https://www.holypixx.com/portfolio.html?s=julie" && freeSeo.image === null &&
      injectPortfolioSeo("<head><title>a</title></head>", freeSeo).includes('content="summary"'));

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
