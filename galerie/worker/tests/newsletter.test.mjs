// Newsletter Holypixx, sans réseau ni D1 réel : validation, consentement,
// réinscription, lecture et retrait côté propriétaire.
//
//   node tests/newsletter.test.mjs

import { readNewsletterSignup, joinNewsletter, newsletterForOwner, removeFromNewsletter } from "../src/newsletter.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

// D1 minimal en mémoire : juste les requêtes de newsletter.js.
function fakeDb() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) { args = a; return stmt; },
        async first() {
          if (/COUNT\(\*\)/.test(sql)) return { n: rows.size };
          return null;
        },
        async run() {
          if (/^INSERT INTO newsletter_subscribers/.test(sql)) {
            const [email, lang, source, consentAt, createdAt] = args;
            const old = rows.get(email);
            rows.set(email, { email, lang, source, consent_at: consentAt, created_at: old ? old.created_at : createdAt });
            return { meta: { changes: 1 } };
          }
          if (/^DELETE FROM newsletter_subscribers/.test(sql)) {
            const had = rows.delete(args[0]);
            return { meta: { changes: had ? 1 : 0 } };
          }
          throw new Error("SQL inattendu : " + sql);
        },
        async all() {
          if (/GROUP BY lang/.test(sql)) {
            const by = {};
            rows.forEach((r) => { by[r.lang] = (by[r.lang] || 0) + 1; });
            return { results: Object.keys(by).map((lang) => ({ lang, n: by[lang] })) };
          }
          return { results: [...rows.values()].sort((a, b) => b.created_at - a.created_at) };
        },
      };
      return stmt;
    },
  };
}

function post(body) {
  return new Request("https://api.example/api/public/newsletter", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

// Validation
check("adresse invalide refusée, message en néerlandais", readNewsletterSignup({ email: "pas-une-adresse", lang: "nl", consent: true }).error === "Vul een geldig e-mailadres in.");
check("sans case cochée : refus, message en néerlandais", /Vink het vakje aan/.test(readNewsletterSignup({ email: "an@studio.be", lang: "nl" }).error || ""));
check("consentement « true » en texte : refusé (il faut le booléen)", Boolean(readNewsletterSignup({ email: "an@studio.be", lang: "nl", consent: "true" }).error));
check("champ invisible rempli : robot", readNewsletterSignup({ website: "x", email: "a@b.cd", consent: true }).bot === true);
const ok = readNewsletterSignup({ email: "  An@Studio.BE ", lang: "nl", consent: true, source: "admin" });
check("adresse nettoyée, langue et origine gardées", ok.entry && ok.entry.email === "an@studio.be" && ok.entry.lang === "nl" && ok.entry.source === "admin", JSON.stringify(ok));
const odd = readNewsletterSignup({ email: "a@b.cd", lang: "de", consent: true, source: "<script>" });
check("langue et origine inconnues → fr et vide", odd.entry.lang === "fr" && odd.entry.source === "");
check("message d'erreur en français par défaut", readNewsletterSignup({ email: "x" }).error === "Adresse e-mail invalide");

// Inscription
const env = { DB: fakeDb() };
let res = await joinNewsletter(post({ email: "an@studio.be", lang: "nl", consent: true, source: "admin" }), env);
check("inscription acceptée", res.status === 200 && (await res.json()).ok === true);
const firstCreated = env.DB.rows.get("an@studio.be").created_at;
res = await joinNewsletter(post({ email: "AN@studio.be", lang: "en", consent: true, source: "home-nl" }), env);
check("réinscription : même réponse, une seule ligne, langue mise à jour, date d'origine gardée",
      res.status === 200 && env.DB.rows.size === 1 && env.DB.rows.get("an@studio.be").lang === "en" && env.DB.rows.get("an@studio.be").created_at === firstCreated);
res = await joinNewsletter(post({ email: "bot@spam.io", website: "http://spam", consent: true }), env);
check("robot : « ok » mais rien d'enregistré", res.status === 200 && env.DB.rows.size === 1);
res = await joinNewsletter(post({ email: "lies@foto.be", lang: "nl" }), env);
check("sans consentement : 400, rien d'enregistré", res.status === 400 && env.DB.rows.size === 1);
await joinNewsletter(post({ email: "lies@foto.be", lang: "nl", consent: true }), env);

// Propriétaire
const owner = await newsletterForOwner(env);
check("propriétaire : total, langues, consentement daté", owner.total === 2 && owner.byLang.length === 2 && owner.subscribers.every((s) => s.consentAt > 0), JSON.stringify(owner.byLang));
const removed = await removeFromNewsletter(env, " Lies@Foto.be ");
check("retrait d'une adresse (casse et espaces ignorés)", removed.removed === 1 && env.DB.rows.size === 1);

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} vérifications réussies`);
process.exit(failed ? 1 : 0);
