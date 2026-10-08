// Rappels de commande aux familles, de bout en bout contre le vrai Worker
// local : passage planifié déclenché à la demande (wrangler dev
// --test-scheduled), familles sans commande relancées, jamais deux fois le
// même rappel, familles qui ont commandé ou se sont désinscrites laissées en
// paix, rappels coupés par le photographe, suivi dans le tableau de bord.
// (Pas de clé Resend en local : on vérifie ce qui est noté en base.)
//
//   npm run dev:local -- --test-scheduled  (depuis worker/)
//   node tests/schoolreminders.test.mjs     (depuis tools/)

import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../lib/client.mjs";
import { createTestAccount, localSql } from "./lib/testAccount.mjs";

const API = process.env.GALERIE_API || "http://127.0.0.1:8788";
const WORKER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "worker");
const CRON = "*/30 7-18 * * *";
const RUN = Date.now().toString(36);

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

async function sqlRows(sql) {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "galerie-protegee", "--local", "--json", "--command", sql], { cwd: WORKER_DIR, stdio: "pipe" }).toString();
  // Même un accès en lecture peut faire redémarrer wrangler dev un instant.
  for (let i = 0; i < 20; i++) {
    try {
      if ((await fetch(`${API}/health`, { headers: { connection: "close" } })).ok) break;
    } catch { /* pas encore prêt */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return JSON.parse(out.slice(out.indexOf("[")))[0].results;
}
// Après un accès direct à la base locale, wrangler dev coupe parfois ses
// connexions un instant : on attend qu'il réponde, et on réessaie.
async function runScheduled() {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const r = await fetch(`${API}/__scheduled?cron=${encodeURIComponent(CRON)}`, { headers: { connection: "close" } });
      await r.text();
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return r.status;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return 0;
}
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

/* ---------- Une école, deux enfants, quatre familles ---------- */

const account = await createTestAccount(API, "rappels", { plan: "studio" });
const client = new WorkerClient({ api: API, ...account });
const school = await client.request("POST", "/api/admin/school/schools", { kind: "ecole", name: "École des rappels" });
const yearId = school.yearId;
const { ids: [groupId] } = await client.request("POST", `/api/admin/school/years/${yearId}/groups`, { names: ["P1"] });
const codes = [`R${RUN}A`.slice(0, 8).toUpperCase().padEnd(8, "Z"), `R${RUN}B`.slice(-8).toUpperCase().padEnd(8, "Y")];
await localSql(API, [
  `INSERT INTO school_children (id, group_id, number, first_name, access_code, created_at) VALUES ('kid1_${RUN}', '${groupId}', 1, 'Léa', '${codes[0]}', 0)`,
  `INSERT INTO school_children (id, group_id, number, first_name, access_code, created_at) VALUES ('kid2_${RUN}', '${groupId}', 2, 'Tom', '${codes[1]}', 0)`,
].join("; "));
await client.request("POST", `/api/admin/school/years/${yearId}`, { status: "open", orderDeadline: day(5) });

const email = (k) => `parent-${k}-${RUN}@test.invalid`;
async function access(k, code) {
  const r = await fetch(`${API}/api/family/access`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email(k), code }) });
  return r.json();
}
const famA = await access("a", codes[0]);
const famB = await access("b", codes[1]);
await access("c", codes[0]);
const famD = await access("d", codes[1]);
check("quatre familles ont ouvert leur espace", [famA, famB, famD].every((f) => f.token), famA.error);
check("une famille voit ses rappels activés par défaut", famA.remindersOn === true);

// B a déjà commandé (payé) : jamais relancée.
const famBId = (await sqlRows(`SELECT id FROM families WHERE email = '${email("b")}'`))[0].id;
await localSql(API, `INSERT INTO school_orders (id, year_id, family_id, email, delivery, amount_cents, status, created_at, paid_at) VALUES ('scorm_${RUN}', '${yearId}', '${famBId}', '${email("b")}', 'school', 2200, 'paid', 0, 0)`);

// C se désinscrit par le lien de l'e-mail (jeton signé).
const famCId = (await sqlRows(`SELECT id FROM families WHERE email = '${email("c")}'`))[0].id;
const secret = readFileSync(join(WORKER_DIR, ".dev.vars"), "utf8").match(/^AUTH_SECRET\s*=\s*"?([^"\n]+)"?/m)[1];
const sig = createHmac("sha256", `${secret}:prodigi-urls`).update(`family-stop:${famCId}`).digest("base64url");
const forged = await fetch(`${API}/api/family/unsubscribe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: `${famCId}.faux` }) });
const unsubscribed = await fetch(`${API}/api/family/unsubscribe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: `${famCId}.${sig}` }) });
check("le lien « ne plus recevoir de rappels » marche sans connexion ; un jeton falsifié est refusé", forged.status === 400 && unsubscribed.status === 200);

// D coupe puis remet ses rappels depuis son espace.
const toggle = async (on) => (await fetch(`${API}/api/family/reminders`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${famD.token}` }, body: JSON.stringify({ on }),
})).json();
const off = await toggle(false);
const on = await toggle(true);
check("une famille coupe et remet ses rappels depuis son espace", off.remindersOn === false && on.remindersOn === true);

/* ---------- Passages planifiés ---------- */

const rowsFor = async (kind) => (await sqlRows(`SELECT f.email FROM school_reminders r JOIN families f ON f.id = r.family_id WHERE r.year_id = '${yearId}' AND r.kind = '${kind}' ORDER BY f.email`)).map((r) => r.email);
const status = await runScheduled();
let j7 = await rowsFor("j7");
check("à 5 jours de la date limite : premier rappel aux seules familles sans commande et pas désinscrites",
      status === 200 && j7.join() === [email("a"), email("d")].join(), j7.join(", "));
await runScheduled();
check("un rappel déjà envoyé ne repart jamais", (await rowsFor("j7")).length === 2);
let shop = await client.request("GET", `/api/admin/school/years/${yearId}/shop`);
check("le tableau de bord compte les rappels envoyés", shop.familyReminders === true && shop.reminders.j7?.families === 2, JSON.stringify(shop.reminders));

await localSql(API, `UPDATE school_years SET order_deadline = ${Math.floor(Date.now() / 1000) + 30 * 3600} WHERE id = '${yearId}'`);
await runScheduled();
const j2 = await rowsFor("j2");
check("à moins de 2 jours : le dernier rappel, aux mêmes familles", j2.join() === [email("a"), email("d")].join(), j2.join(", "));

await client.request("POST", `/api/admin/school/years/${yearId}`, { familyReminders: false });
await localSql(API, `DELETE FROM school_reminders WHERE year_id = '${yearId}' AND kind = 'j2'`);
await runScheduled();
const overview = await client.request("GET", "/api/admin/school");
const yearView = overview.schools.find((s) => s.id === school.id).years.find((y) => y.id === yearId);
check("rappels coupés par le photographe : plus rien ne part", (await rowsFor("j2")).length === 0 && yearView.familyReminders === false);

/* ---------- Effacement ---------- */

await client.request("DELETE", `/api/admin/school/schools/${school.id}`);
check("supprimer l'établissement efface aussi la trace des rappels",
      (await sqlRows(`SELECT COUNT(*) AS n FROM school_reminders WHERE year_id = '${yearId}'`))[0].n === 0);

await localSql(API, `DELETE FROM families WHERE email LIKE 'parent-%-${RUN}@test.invalid'`);

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
