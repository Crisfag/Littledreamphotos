// Grille tarifaire dans un vrai navigateur, contre le vrai Worker local :
// onglet Abonnement d'un compte gratuit (prix, offre Fondateurs, essai,
// bascule mensuel/annuel) et section Tarifs de la page d'accueil (places
// Fondateurs restantes lues sur l'API publique). Autonome.
//
//   npm run dev:local                      (depuis worker/)
//   node admin-server.mjs                  (depuis tools/, GALERIE_API=http://127.0.0.1:8788)
//   node tests/pricing.test.mjs            (depuis tools/)

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../lib/client.mjs";
import { createTestAccount } from "./lib/testAccount.mjs";

const BASE = process.env.ADMIN_BASE || "http://127.0.0.1:4000";
const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web");
const SITE_PORT = Number(process.env.SITE_PORT || 8000);

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

const account = await createTestAccount(API, "tarifs", { plan: "" });
const client = new WorkerClient({ api: API, ...account });
const publicPlans = await (await fetch(`${API}/api/public/plans`)).json();
const remaining = publicPlans.founders.remaining;

const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ["--disable-features=LocalNetworkAccessChecks"],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const exceptions = [];
page.on("pageerror", (err) => exceptions.push(String(err)));

/* ---------- Onglet Abonnement ---------- */

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.fill('#ad-login-form [name="email"]', account.email);
await page.fill('#ad-login-form [name="password"]', account.password);
await page.click("#ad-login-submit");
await page.waitForSelector("#ad-new-gallery", { timeout: 10000 });
await page.click("#ad-tab-subscription");
await page.waitForSelector("#ad-plans", { timeout: 10000 });

const essentiel = page.locator(".ad-plan", { hasText: "Essentiel" });
const pro = page.locator(".ad-plan", { hasText: "Pro" }).last();
if (remaining > 0) {
  check("offre Fondateurs annoncée avec les places restantes",
        (await page.textContent(".ad-founders")).includes(`plus que ${remaining} place`), await page.textContent(".ad-founders"));
  check("prix Fondateurs la 1re année, prix normal barré (mensuel)",
        (await essentiel.locator(".ad-plan-price").textContent()).includes("15 €") && (await essentiel.locator(".ad-plan-price s").textContent()) === "15 €" &&
        (await essentiel.locator(".ad-plan-price").textContent()).includes("12 € / mois") && (await pro.locator(".ad-plan-price").textContent()).includes("24 € / mois") &&
        (await pro.locator(".ad-plan-price").textContent()).includes("la 1re année, puis 29 € / mois"),
        await pro.locator(".ad-plan-price").textContent());
} else {
  check("plus de place Fondateurs : prix normaux", (await essentiel.locator(".ad-plan-price").textContent()).includes("15 € / mois"));
  check("pas de bandeau Fondateurs", (await page.locator(".ad-founders").count()) === 0);
}
check("un compte jamais abonné se voit proposer l'essai de 10 jours",
      (await essentiel.locator("[data-subscribe]").textContent()) === "Essayer 10 jours gratuitement" &&
      (await essentiel.textContent()).includes("Aucun prélèvement pendant l'essai"));

await page.click('[data-interval="year"]');
check("en annuel : 150 € / 290 € par an (ou 120 € / 240 € la 1re année en Fondateurs)",
      remaining > 0
        ? (await essentiel.locator(".ad-plan-price").textContent()).includes("120 € / an") && (await pro.locator(".ad-plan-price s").textContent()) === "290 €"
        : (await essentiel.locator(".ad-plan-price").textContent()).includes("150 € / an") && (await pro.locator(".ad-plan-price").textContent()).includes("2 mois offerts"),
      await essentiel.locator(".ad-plan-price").textContent());
// En local, Stripe n'est pas configuré : boutons désactivés et message.
check("sans Stripe configuré (local), boutons désactivés et message clair",
      await essentiel.locator("[data-subscribe]").isDisabled() && (await page.textContent("body")).includes("pas encore ouvert"));
// On force tout de même l'envoi pour vérifier la demande transmise.
await essentiel.locator("[data-subscribe]").evaluate((b) => { b.disabled = false; });
const checkoutRequest = page.waitForRequest((r) => r.url().endsWith("/local/subscription/checkout"));
await essentiel.locator("[data-subscribe]").click();
const sent = JSON.parse((await checkoutRequest).postData() || "{}");
check("le choix annuel part avec la demande de paiement", sent.plan === "essentiel" && sent.interval === "year", JSON.stringify(sent));
await page.waitForSelector(".ad-toast-visible", { timeout: 5000 }).catch(() => {});
check("le refus du serveur est expliqué", (await page.textContent("body")).includes("pas encore configuré"));
await page.click('[data-interval="month"]');
check("retour au mensuel", (await essentiel.locator(".ad-plan-price").textContent()).includes("/ mois"));

/* ---------- Page d'accueil ---------- */

const site = createServer(async (req, res) => {
  const pathname = req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    const body = await readFile(join(WEB_DIR, pathname));
    res.writeHead(200, { "content-type": pathname.endsWith(".css") ? "text/css" : pathname.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => site.listen(SITE_PORT, "localhost", resolve));
const home = await browser.newPage({ viewport: { width: 1200, height: 900 } });
home.on("pageerror", (err) => exceptions.push(String(err)));
// L'API de production est remplacée par le Worker local.
await home.route(/workers\.dev\/api\/public\/plans/, async (route) => {
  const upstream = await fetch(`${API}/api/public/plans`);
  await route.fulfill({ status: upstream.status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: await upstream.text() });
});
await home.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await home.goto(`http://localhost:${SITE_PORT}/`, { waitUntil: "domcontentloaded" });
const tarifs = await home.textContent("#tarifs");
check("page d'accueil : 15 € / 29 € par mois, 150 € / 290 € par an, essai de 10 jours",
      tarifs.includes("15 €") && tarifs.includes("29 €") && tarifs.includes("150 € / an") && tarifs.includes("290 € / an") &&
      tarifs.includes("Essayer 10 jours gratuitement") && !tarifs.includes("24 € / mois"));
if (remaining > 0) {
  await home.waitForSelector("#founders:not([hidden])", { timeout: 5000 });
  check("page d'accueil : l'offre Fondateurs s'affiche avec les places restantes",
        (await home.textContent("#founders")).includes(`plus que ${remaining} place`));
}

check("aucune exception JavaScript", exceptions.length === 0, exceptions.join(" | "));

await browser.close();
site.close();
await client.request("POST", "/api/admin/account/delete", { confirm: "SUPPRIMER", password: account.password });

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
