// Nouveautés de la plateforme, dans un vrai navigateur : la propriétaire
// publie (aussi en annonçant une suggestion réalisée), chaque photographe
// voit les nouveautés en tête de l'onglet Suggestions, avec une pastille
// tant qu'il ne les a pas vues, dans sa langue ; l'auteur d'une suggestion
// voit « Votre suggestion, réalisée », les autres « Suggestion de … ».
//
//   npm run dev:local                                         (depuis worker/)
//   GALERIE_API=http://127.0.0.1:8788 GALERIE_FORENSIC_KEY=… \
//     node admin-server.mjs                                  (depuis tools/)
//   node tests/nouveautes.test.mjs

import { chromium } from "playwright";
import { join } from "node:path";
import { WorkerClient } from "../lib/client.mjs";
import { createTestAccount, localSql } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const SHOTS = process.env.SHOTS || "";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}
const flat = (t) => String(t || "").replace(/[  ]/g, " ").replace(/\s+/g, " ");

const OWNER_EMAIL = "fagnantchristine@gmail.com";
const OWNER_PASSWORD = "mot-de-passe-de-la-proprietaire-1234";
await fetch(`${API}/api/auth/signup`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD, studioName: "Holypixx" }),
});
const owner = new WorkerClient({ api: API, email: OWNER_EMAIL, password: OWNER_PASSWORD });
const reader = await createTestAccount(API, "nouveautes-lecteur");
const author = await createTestAccount(API, "nouveautes-auteur");
const readerClient = new WorkerClient({ api: API, ...reader });
const authorClient = new WorkerClient({ api: API, ...author });
const tag = Date.now().toString(36);
await localSql(API, `UPDATE photographers SET studio_name = 'Studio Pixel ${tag}' WHERE email = '${author.email}'`);
await authorClient.request("POST", "/api/admin/account/language", { language: "nl" });

/* ---------- Compte neuf : l'historique, sans pastille ---------- */

const fresh = await readerClient.request("GET", "/api/admin/feedback");
check("compte neuf : les nouveautés passées sont là, sans pastille", fresh.news.entries.length >= 17 && fresh.news.unseen === 0, `${fresh.news.entries.length} / ${fresh.news.unseen}`);
check("chaque entrée en trois langues (premières nouveautés)", fresh.news.entries.filter((e) => e.id.startsWith("chg_seed_")).every((e) => e.title.fr && e.title.en && e.title.nl));

/* ---------- Une suggestion, annoncée comme réalisée ---------- */

const sent = await authorClient.request("POST", "/api/admin/feedback", { kind: "idea", title: `Raccourci clavier pour valider ${tag}`, body: "Gagner du temps." });
const forbidden = await readerClient.request("GET", "/api/owner/changelog").catch((err) => err);
check("publier : réservé à la propriétaire", forbidden.status === 403);
const published = await owner.request("POST", "/api/owner/changelog", {
  kind: "shortcut", link: "#/relances", feedbackId: sent.createdId, credit: true,
  title: { fr: `Valider d'un raccourci ${tag}`, en: `Confirm with a shortcut ${tag}`, nl: "" },
  body: { fr: "Appuyez sur Entrée pour valider.", en: "Press Enter to confirm.", nl: "" },
});
const mine = published.entries.find((e) => e.title.fr.includes(tag));
check("nouveauté publiée, reliée à la suggestion et créditée", mine && mine.feedbackId === sent.createdId && /Studio Pixel/.test(mine.suggestedBy));
const authorFeedback = await authorClient.request("GET", "/api/admin/feedback");
check("la suggestion passe en « Réalisée »", authorFeedback.items.find((i) => i.id === sent.createdId)?.status === "done");
const old = await owner.request("POST", "/api/owner/changelog", {
  kind: "fix", date: new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10), title: { fr: `Ancienne correction ${tag}` }, body: { fr: "Il y a deux mois." },
});
const oldId = old.entries.find((e) => e.title.fr.includes("Ancienne correction " + tag)).id;
const bad = await owner.request("POST", "/api/owner/changelog", { title: { fr: "x" }, link: "https://evil.example" }).catch((err) => err);
check("lien vers un site extérieur refusé (écrans de l'espace seulement)", bad.status === 400);

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const exceptions = [];
async function open(email, password, viewport = { width: 1280, height: 1000 }) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: "block" });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => exceptions.push(String(err)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.fill('#ad-login-form [name="email"]', email);
  await page.fill('#ad-login-form [name="password"]', password);
  await page.click("#ad-login-submit");
  await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });
  return page;
}

try {
  /* ---------- Lecteur : pastille, puis nouveautés ---------- */

  const page = await open(reader.email, reader.password);
  await page.waitForSelector("#ad-tab-feedback .ad-tab-count", { timeout: 10000 });
  check("pastille sur Suggestions : la nouveauté du jour", (await page.textContent("#ad-tab-feedback .ad-tab-count")) === "1" &&
        /nouveauté/.test(await page.getAttribute("#ad-tab-feedback .ad-tab-count", "aria-label")));
  await page.click("#ad-tab-feedback");
  await page.waitForSelector("#ad-news");
  const news = flat(await page.textContent("#ad-news"));
  check("en tête de l'onglet : Nouveautés des 15 derniers jours, les 6 dernières, par date", /Nouveautés/.test(news) && /15 derniers jours/.test(news) && (await page.locator(".ad-news-item").count()) === 6 && (await page.locator(".ad-news-day").count()) >= 2);
  const item = page.locator(".ad-news-item", { hasText: `Valider d'un raccourci ${tag}` });
  check("la nouveauté : type, « Nouveau », texte, auteur crédité, bouton Essayer",
        (await item.count()) === 1 && /Raccourci/.test(await item.textContent()) && /Nouveau/.test(await item.textContent()) &&
        /Suggestion de Studio Pixel/.test(await item.textContent()) && (await item.locator('a[href="#/relances"]').count()) === 1, flat(await item.textContent()));
  check("une seule marquée « Nouveau » (les anciennes, non)", (await page.locator(".ad-news-item.is-new").count()) === 1);
  check("les autres restent repliées", /Voir toutes les nouveautés \(\d+ de plus\)/.test(await page.textContent("#ad-news-more")) && !/Ancienne correction/.test(news));
  await page.click("#ad-news-more");
  check("…et s'affichent d'un clic", /Ancienne correction/.test(await page.textContent("#ad-news")) && /Tout l'historique/.test(await page.textContent("#ad-news")));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "nouveautes-onglet.png"), fullPage: true });
  await page.waitForTimeout(800);
  check("vue : la pastille disparaît", await page.locator("#ad-tab-feedback .ad-tab-count").isHidden().catch(() => true));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#ad-news");
  check("au retour, plus rien n'est marqué « Nouveau »", (await page.locator(".ad-news-item.is-new").count()) === 0);
  await page.click(".ad-news-item a[href='#/relances']");
  await page.waitForSelector(".ad-ml-list", { timeout: 10000 });
  check("« Essayer » ouvre l'écran concerné", (await page.evaluate(() => location.hash)) === "#/relances");

  /* ---------- Auteur : en néerlandais, « Votre suggestion » ---------- */

  const nl = await open(author.email, author.password, { width: 390, height: 844 });
  await nl.click("#ad-tab-feedback");
  await nl.waitForSelector("#ad-news");
  const authorItem = nl.locator(".ad-news-item", { hasText: tag });
  check("l'auteur, en néerlandais : « Jouw suggestie, gerealiseerd », titre en français faute de version NL",
        /Jouw suggestie, gerealiseerd/.test(await authorItem.textContent()) && /Valider d'un raccourci/.test(await authorItem.textContent()) &&
        /Nieuw/.test(await nl.textContent("#ad-news-h")) && /Snelkoppeling/.test(await authorItem.textContent()), flat(await authorItem.textContent()));
  const overflow = await nl.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("téléphone : pas de débordement", overflow <= 1, overflow + " px");
  if (SHOTS) await nl.screenshot({ path: join(SHOTS, "nouveautes-mobile-nl.png"), fullPage: true });

  /* ---------- Propriétaire : publier depuis l'onglet Admin ---------- */

  const own = await open(OWNER_EMAIL, OWNER_PASSWORD);
  await own.click("#ad-tab-owner");
  await own.waitForSelector("#ad-news-form", { timeout: 20000 });
  const fbItem = own.locator(".ad-fb-item", { hasText: `Raccourci clavier pour valider ${tag}` });
  await fbItem.locator("[data-fb-announce]").click();
  check("« Annoncer dans les nouveautés » remplit le formulaire depuis la suggestion",
        (await own.inputValue("#ad-news-form [name=title_fr]")).includes(tag) && (await own.inputValue("#ad-news-form [name=feedbackId]")) === sent.createdId && await own.isChecked("#ad-news-form [name=credit]"));
  await own.fill("#ad-news-form [name=title_fr]", `Publiée depuis l'Admin ${tag}`);
  await own.selectOption("#ad-news-form [name=feedbackId]", "");
  await own.click("#ad-news-submit");
  await own.waitForSelector(`#ad-news-owner li:has-text("Publiée depuis l'Admin ${tag}")`, { timeout: 8000 });
  check("publiée depuis l'onglet Admin, marquée « FR seulement »", /FR seulement/.test(await own.locator(`#ad-news-owner li:has-text("Publiée depuis l'Admin ${tag}")`).textContent()));
  const row = own.locator(`#ad-news-owner li:has-text("Publiée depuis l'Admin ${tag}")`);
  await row.locator("[data-news-edit]").click();
  await own.fill("#ad-news-form [name=title_fr]", `Modifiée ${tag}`);
  await own.click("#ad-news-submit");
  await own.waitForSelector(`#ad-news-owner li:has-text("Modifiée ${tag}")`, { timeout: 8000 });
  check("modifiée", (await own.locator(`#ad-news-owner li:has-text("Publiée depuis l'Admin ${tag}")`).count()) === 0);
  await own.locator(`#ad-news-owner li:has-text("Modifiée ${tag}")`).locator("[data-news-delete]").click();
  await own.click("#ad-confirm-ok");
  await own.waitForFunction((t) => !document.getElementById("ad-news-owner").textContent.includes("Modifiée " + t), tag, { timeout: 8000 });
  check("retirée", true);
  if (SHOTS) await own.locator("#ad-news-owner").screenshot({ path: join(SHOTS, "nouveautes-admin.png") });
} catch (err) {
  check("déroulé sans exception", false, err.message.split("\n")[0]);
}

check("aucune erreur JavaScript", exceptions.length === 0, exceptions.join(" | "));
await browser.close();
// Nettoyage : les entrées de test.
const all = await owner.request("GET", "/api/owner/changelog");
for (const e of all.entries.filter((x) => x.title.fr.includes(tag))) await owner.request("DELETE", `/api/owner/changelog/${e.id}`).catch(() => {});

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
