// Relances et campagnes, sans réseau ni D1 réel : mise en forme des e-mails
// du studio (langue, échappement, désinscription), variables, attribution
// des ventes, ciblage des campagnes, textes par défaut, routes publiques de
// désinscription et de clic, envoi groupé.
//
//   node tests/relances.test.mjs

import {
  renderStudioEmail, fillPlaceholders, firstNameOf, attribute, ATTRIBUTION_DAYS, trackedUrl, handleMailPublic,
  automationOffSql, deliverBatch, senderFor, percentLabel,
} from "../src/mailing.js";
import { selectAudience, cleanSegment } from "../src/broadcasts.js";
import { AUTOMATION_TEXTS, CAMPAIGN_TEMPLATES, automationTexts, occasionText } from "../src/mailingTexts.js";
import { AUTOMATIONS, enabledSql } from "../src/automations.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}
const DAY = 86400;
const now = Math.floor(Date.now() / 1000);

/* ---------- Mise en forme ---------- */

const mail = renderStudioEmail({
  lang: "nl", studioName: "Studio <Licht>", subject: "Dag Sofie", body: "Dag Sofie,\n\nJe **galerij** staat klaar.\nTot snel!\n\nStudio", ctaLabel: "Open mijn galerij",
  ctaUrl: "https://example.com/g?a=1&b=2", unsubscribe: "https://api.example/api/m/u/tok",
});
check("e-mail : langue, studio échappé, gras, sauts de ligne, bouton, désinscription en néerlandais",
      mail.html.includes('<html lang="nl">') && mail.html.includes("Studio &lt;Licht&gt;") && mail.html.includes("<strong>galerij</strong>") &&
      mail.html.includes("klaar.<br />Tot snel") && mail.html.includes("https://example.com/g?a=1&amp;b=2") && mail.html.includes(">Uitschrijven</a>") &&
      mail.html.includes("Je krijgt deze e-mail omdat je klant bent bij Studio &lt;Licht&gt;"));
check("version texte : paragraphes, bouton et lien de désinscription, sans **",
      mail.text.includes("Je galerij staat klaar.") && mail.text.includes("Open mijn galerij : https://example.com/g?a=1&b=2") && mail.text.includes("Uitschrijven : https://api.example/api/m/u/tok") && !mail.text.includes("**"));
const noCta = renderStudioEmail({ lang: "fr", studioName: "S", subject: "x", body: "a", ctaLabel: "", ctaUrl: "", unsubscribe: "" });
check("sans bouton ni lien : rien de vide dans l'e-mail", !noCta.html.includes("border-radius:999px;background") && !noCta.html.includes("Se désinscrire"));

check("variables remplacées, inconnues effacées", fillPlaceholders("Bonjour {prenom}, {studio} — {inconnue}!", { prenom: "Léa", studio: "Lumière" }) === "Bonjour Léa, Lumière — !");
check("prénom : « Sophie Martin » → Sophie ; « Famille Martin » reste entier", firstNameOf("Sophie Martin") === "Sophie" && firstNameOf("Famille Martin") === "Famille Martin" && firstNameOf("") === "");
check("remise à la française et à l'anglaise", percentLabel(20, "fr") === "20 %" && percentLabel(20, "en") === "20%" && percentLabel(20, "nl") === "20%");

/* ---------- Attribution des ventes ---------- */

const sends = [
  { id: "a", client_email: "x@ex.be", status: "sent", sent_at: now - 20 * DAY },
  { id: "b", client_email: "x@ex.be", status: "sent", sent_at: now - 5 * DAY },
  { id: "c", client_email: "y@ex.be", status: "sent", sent_at: now - 30 * DAY },
  { id: "d", client_email: "z@ex.be", status: "failed", sent_at: now - 2 * DAY },
];
const conversions = [
  { email: "x@ex.be", at: now - 4 * DAY, cents: 4500, type: "print" },
  { email: "x@ex.be", at: now - 3 * DAY, cents: 5000, type: "booking" },
  { email: "x@ex.be", at: now - 25 * DAY, cents: 9900, type: "supplement" }, // avant tout e-mail
  { email: "y@ex.be", at: now - 10 * DAY, cents: 2000, type: "print" },     // 20 jours après : hors fenêtre
  { email: "z@ex.be", at: now - 1 * DAY, cents: 3000, type: "print" },      // e-mail non parti
];
const att = attribute(sends, conversions);
check(`attribution : au dernier e-mail reçu dans les ${ATTRIBUTION_DAYS} jours, une seule fois`,
      att.get("b")?.cents === 9500 && att.get("b")?.bookings === 1 && att.get("b")?.sales === 1 && !att.get("a") && !att.get("c") && !att.get("d"), JSON.stringify([...att]));

/* ---------- Ciblage des campagnes ---------- */

const client = (over) => ({ email: "", name: "", tags: [], galleries: [], bookings: [], paidCents: 0, consent: false, unsubscribedAt: null, lang: "", lastSessionAt: null, upcomingSessionAt: null, ...over });
const clients = [
  client({ email: "ok@ex.be", name: "Ok", consent: true, tags: ["mariage"], galleries: [{ sessionType: "mariage", createdAt: now - 400 * DAY, language: "fr" }], lastSessionAt: now - 400 * DAY, paidCents: 50000 }),
  client({ email: "nl@ex.be", name: "Lotte", consent: true, galleries: [{ sessionType: "famille", createdAt: now - 30 * DAY, language: "nl" }], lastSessionAt: now - 30 * DAY, paidCents: 2000 }),
  client({ email: "buyer@ex.be", name: "Acheteur", galleries: [{ sessionType: "famille", createdAt: now - 60 * DAY, language: "en" }], lastSessionAt: now - 60 * DAY, paidCents: 9000 }),
  client({ email: "gone@ex.be", consent: true, unsubscribedAt: now - DAY }),
  client({ email: "prospect@ex.be" }),
  client({ email: "", name: "Sans e-mail", consent: true }),
];
const base = selectAudience(clients, { audience: "consent" }, now);
check("ciblage par défaut : seulement les accords, jamais un désinscrit ni une fiche sans e-mail",
      base.recipients.map((r) => r.email).join() === "ok@ex.be,nl@ex.be" && base.excluded.unsubscribed === 1 && base.excluded.noConsent === 2 && base.excluded.noEmail === 1, JSON.stringify(base.excluded));
check("langue du client : celle de sa dernière galerie", base.recipients.find((r) => r.email === "nl@ex.be").lang === "nl");
const customers = selectAudience(clients, { audience: "customers" }, now);
check("« aussi les clients » : l'acheteur sans accord explicite s'ajoute, pas le prospect", customers.recipients.length === 3 && !customers.recipients.some((r) => r.email === "prospect@ex.be"));
check("filtre type de séance", selectAudience(clients, { audience: "customers", sessionTypes: ["famille"] }, now).recipients.length === 2);
check("filtre tag", selectAudience(clients, { audience: "consent", tags: ["mariage"] }, now).recipients.map((r) => r.email).join() === "ok@ex.be");
check("filtre langue", selectAudience(clients, { audience: "customers", langs: ["en"] }, now).recipients.map((r) => r.email).join() === "buyer@ex.be");
check("filtre « sans séance depuis 12 mois »", selectAudience(clients, { audience: "customers", inactiveMonths: 12 }, now).recipients.map((r) => r.email).join() === "ok@ex.be");
check("filtre « séance dans les 3 derniers mois »", selectAudience(clients, { audience: "customers", activeMonths: 3 }, now).recipients.length === 2);
check("filtre dépense minimale", selectAudience(clients, { audience: "customers", minSpentCents: 5000 }, now).recipients.map((r) => r.email).join() === "ok@ex.be,buyer@ex.be");
const seg = cleanSegment({ audience: "tous", langs: ["fr", "de"], inactiveMonths: "abc", minSpentCents: -5, tags: ["  vip  "] });
check("ciblage nettoyé (valeurs inconnues ignorées)", seg.audience === "consent" && seg.langs.join() === "fr" && seg.inactiveMonths === 0 && seg.minSpentCents === 0 && seg.tags[0] === "vip");

/* ---------- Textes ---------- */

const vars = (text) => [...String(text).matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).sort().join();
let textsOk = true;
for (const [key, langs] of Object.entries(AUTOMATION_TEXTS)) {
  for (const l of ["fr", "en", "nl"]) {
    const t = langs[l];
    if (!t.subject || !t.body || !t.cta) { textsOk = false; console.log("  texte manquant", key, l); }
    if (vars(t.subject + t.body) !== vars(langs.fr.subject + langs.fr.body)) { textsOk = false; console.log("  variables différentes", key, l); }
  }
}
for (const t of CAMPAIGN_TEMPLATES) {
  for (const l of ["fr", "en", "nl"]) {
    if (!t.texts[l].subject || !t.texts[l].body || !t.name[l]) { textsOk = false; console.log("  modèle incomplet", t.key, l); }
    if (vars(t.texts[l].subject + t.texts[l].body) !== vars(t.texts.fr.subject + t.texts.fr.body)) { textsOk = false; console.log("  variables du modèle", t.key, l); }
  }
}
check("relances et modèles : objet, message et bouton dans les trois langues, mêmes variables", textsOk);
check("chaque relance « à votre nom » a ses textes par défaut", AUTOMATIONS.filter((a) => a.kind === "custom").every((a) => AUTOMATION_TEXTS[a.key]));
const own = automationTexts("selection_nudge", "en", { en: { subject: "Your photos, {prenom}", body: "Hi", cta: "" } });
check("texte du photographe prioritaire ; bouton vide → bouton proposé", own.subject === "Your photos, {prenom}" && own.body === "Hi" && own.cta === AUTOMATION_TEXTS.selection_nudge.en.cta && own.custom);
check("langue sans texte du photographe : texte proposé de cette langue", automationTexts("review", "nl", { fr: { subject: "x", body: "y" } }).subject === AUTOMATION_TEXTS.review.nl.subject);
check("occasions dans la langue du client",
      occasionText("fr", { kind: "baby", label: "Léa", months: 6 }) === "Les 6 mois de Léa" && occasionText("en", { kind: "birthday", label: "Tom", years: 3 }) === "Tom's 3rd birthday" &&
      occasionText("nl", { kind: "season", label: "noel" }) === "Kerstmis" && occasionText("en", { kind: "wedding", years: 11 }) === "Your 11th wedding anniversary");
check("SQL des interrupteurs : relance coupée, valeur par défaut, colonne du photographe",
      automationOffSql("cart").includes("key = 'cart' AND a_cart.enabled = 0") && enabledSql("dormant").includes(", 0) = 1") && enabledSql("selection_nudge").includes(", 1) = 1") && enabledSql("unpaid") === "p.unpaid_reminders_enabled = 1");

/* ---------- Routes publiques ---------- */

const env = { TOKEN_SECRET: "secret-de-test", PUBLIC_API_ORIGIN: "https://api.example" };
const updates = [];
const send = { id: "snd_1", photographer_id: "pho_1", client_email: "x@ex.be", lang: "en", studio_name: "Studio Lumière", token: "tok123" };
env.DB = {
  prepare(sql) {
    let args = [];
    const st = {
      bind(...a) { args = a; return st; },
      async first() { return /FROM email_sends s JOIN photographers/.test(sql) ? (args[0] === "tok123" ? send : null) : null; },
      async run() { updates.push({ sql, args }); return { meta: { changes: 1 } }; },
    };
    return st;
  },
};
const link = await trackedUrl(env, "tok123", "https://www.holypixx.com/reserver?x=1");
check("lien suivi : sur l'adresse du Worker, signé", link.startsWith("https://api.example/api/m/c/"));
const click = await handleMailPublic(new Request(link), env, new URL(link).pathname);
check("clic : compté puis redirigé vers le bon lien", click.status === 302 && click.headers.get("location") === "https://www.holypixx.com/reserver?x=1" && updates.some((u) => /clicks = clicks \+ 1/.test(u.sql) && u.args[1] === "tok123"));
const forged = link.slice(0, -4) + "AAAA";
const bad = await handleMailPublic(new Request(forged), env, new URL(forged).pathname);
check("lien falsifié : refusé, aucune redirection", bad.status === 400);
updates.length = 0;
const page = await handleMailPublic(new Request("https://api.example/api/m/u/tok123"), env, "/api/m/u/tok123");
const pageHtml = await page.text();
check("désinscription : une page à confirmer, dans la langue du client, sans rien changer encore",
      page.status === 200 && pageHtml.includes('lang="en"') && pageHtml.includes("Studio Lumière") && pageHtml.includes('method="post"') && updates.length === 0);
const done = await handleMailPublic(new Request("https://api.example/api/m/u/tok123", { method: "POST" }), env, "/api/m/u/tok123");
check("désinscription confirmée (bouton, ou un clic dans la messagerie)", done.status === 200 && (await done.text()).includes("Done") && updates.some((u) => /unsubscribed_at = \?/.test(u.sql)));
const unknown = await handleMailPublic(new Request("https://api.example/api/m/u/nope"), env, "/api/m/u/nope");
check("jeton inconnu : page polie, pas d'erreur", unknown.status === 200 && (await unknown.text()).includes("plus valable"));

/* ---------- Envoi groupé et expéditeur ---------- */

const realFetch = globalThis.fetch;
let captured = null;
globalThis.fetch = async (url, init) => { captured = { url, body: JSON.parse(init.body) }; return new Response("{}", { status: 200 }); };
const results = await deliverBatch({ RESEND_API_KEY: "k" }, [
  { from: "A <a@x.be>", to: "c@x.be", subject: "s", html: "h", text: "t", replyTo: "studio@x.be", unsubscribe: "https://u" },
  { from: "A <a@x.be>", to: "d@x.be", subject: "s", html: "h", text: "t" },
]);
check("envoi groupé : un seul appel, réponse au studio, désinscription en un clic",
      captured.url.endsWith("/emails/batch") && captured.body.length === 2 && captured.body[0].reply_to === "studio@x.be" &&
      captured.body[0].headers["List-Unsubscribe"] === "<https://u>" && captured.body[0].headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click" &&
      !captured.body[1].headers && results.join() === "true,true");
globalThis.fetch = realFetch;
check("sans clé Resend : rien ne part, aucune erreur", (await deliverBatch({}, [{ to: "x" }])).join() === "false");
const dbWith = (row) => ({ prepare: () => ({ bind: () => ({ first: async () => row }) }) });
check("expéditeur : adresse du studio une fois le domaine vérifié",
      (await senderFor({ DB: dbWith({ domain: "lumiere.be", local_part: "bonjour", status: "verified" }) }, { id: "p", studio_name: "Studio Lumière" })) === "Studio Lumière <bonjour@lumiere.be>");
check("expéditeur : sinon « Studio via Holypixx »",
      (await senderFor({ DB: dbWith({ domain: "lumiere.be", local_part: "bonjour", status: "pending" }), RESEND_FROM: "Holypixx <alertes@holypixx.com>" }, { id: "p", studio_name: "Studio Lumière" })) === "Studio Lumière via Holypixx <alertes@holypixx.com>");

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} vérifications réussies`);
process.exit(failed ? 1 : 0);
