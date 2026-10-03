// Vérifie les règles du portfolio sans réseau ni D1 : adresse, prestations,
// Instagram, site, téléphone, adresses publiques, e-mail de contact.
//
//   node tests/portfolio.test.mjs

import { normalizeHandle, suggestHandle, normalizeServices, normalizeInstagram, normalizeWebsite, normalizePhone, portfolioUrls } from "../src/portfolio.js";
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

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
