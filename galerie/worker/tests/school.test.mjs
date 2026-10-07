// Module écoles, crèches et clubs (school.js), de bout en bout contre un
// `wrangler dev --local` : accès selon la formule, établissements, années,
// groupes, reprise des groupes d'une année sur l'autre, cloisonnement.
//
//   npm run dev:local
//   node tests/school.test.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE || "http://127.0.0.1:8788";
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const WORKER_ROOT = fileURLToPath(new URL("..", import.meta.url));

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

async function account(label) {
  const email = `ecole-${label}-${RUN}@test.invalid`;
  const response = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "mot-de-passe-de-test-1234", studioName: `Studio ${label}` }),
  });
  const data = await response.json();
  if (!data.token) throw new Error(`Inscription impossible : ${JSON.stringify(data)}`);
  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { connection: "close", authorization: `Bearer ${data.token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  return { email, call };
}

// Écrire dans la base locale fait recharger `wrangler dev` : on attend
// qu'il réponde à nouveau avant de continuer.
async function setPlan(email, plan) {
  execFileSync("npx", ["wrangler", "d1", "execute", "galerie-protegee", "--local", "--command",
    `UPDATE photographers SET plan = '${plan}', plan_status = 'active' WHERE email = '${email}'`], { cwd: WORKER_ROOT, stdio: "pipe" });
  for (let i = 0; i < 20; i++) {
    try {
      if ((await fetch(`${BASE}/health`, { headers: { connection: "close" } })).ok) return;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 500));
  }
}

const studio = await account("studio");
const free = await account("gratuit");
await setPlan(studio.email, "studio");

/* ---------- Accès ---------- */

const freeOverview = await free.call("GET", "/api/admin/school");
const freeCreate = await free.call("POST", "/api/admin/school/schools", { kind: "ecole", name: "École refusée" });
check("sans formule qui l'inclut : la vue d'ensemble dit « non autorisé », la création est refusée (402)",
      freeOverview.status === 200 && freeOverview.body.access.allowed === false && freeCreate.status === 402, freeCreate.body.error);
const meStudio = await studio.call("GET", "/api/auth/me");
const meFree = await free.call("GET", "/api/auth/me");
check("l'onglet Écoles & clubs apparaît pour Studio, pas pour un compte gratuit (module pas encore ouvert)",
      meStudio.body.photographer?.schoolTab === true && meFree.body.photographer?.schoolTab === false);
const plans = await (await fetch(`${BASE}/api/public/plans`)).json();
check("tant que le module n'est pas ouvert, la page d'accueil ne propose ni Scolaire ni Studio",
      !plans.plans.some((p) => p.key === "studio" || p.key === "scolaire") && !plans.studioFounders);
const studioSub = await studio.call("GET", "/api/admin/subscription");
check("un abonné Studio voit les formules du module et l'offre Fondateurs Studio (30 places)",
      studioSub.body.plans.some((p) => p.key === "studio" && p.priceCents === 4900 && p.founderYearlyCents === 44000) &&
      studioSub.body.studioFounders?.limit === 30);
const scolaireOn = await free.call("POST", "/api/admin/subscription/scolaire", { on: true });
check("la formule Scolaire ne s'active pas tant que le module n'est pas ouvert", scolaireOn.status === 409);

/* ---------- Établissements ---------- */

const badKind = await studio.call("POST", "/api/admin/school/schools", { kind: "lycee", name: "X" });
const noName = await studio.call("POST", "/api/admin/school/schools", { kind: "ecole", name: "  " });
check("type inconnu ou nom vide refusés", badKind.status === 400 && noName.status === 400);

const created = await studio.call("POST", "/api/admin/school/schools", {
  kind: "ecole", name: "École communale de Rotheux", address: "Rue de l'École 1, 4120 Rotheux",
  contactName: "Mme Directrice", contactEmail: "direction@ecole.invalid",
});
check("un établissement se crée avec l'année scolaire en cours", created.status === 201 && created.body.id && created.body.yearId);
const schoolId = created.body.id;
const yearId = created.body.yearId;

let overview = (await studio.call("GET", "/api/admin/school")).body;
let school = overview.schools.find((s) => s.id === schoolId);
check("la vue d'ensemble liste l'établissement, son année (en préparation) et le vocabulaire par type",
      school && school.years.length === 1 && school.years[0].label === overview.suggestedYear && school.years[0].status === "draft" &&
      overview.kinds.club.group === "Équipe" && overview.kinds.creche.groups === "Sections");

/* ---------- Groupes ---------- */

const groups = await studio.call("POST", `/api/admin/school/years/${yearId}/groups`, { names: ["M1", "P3", " ", "P6"] });
check("plusieurs classes ajoutées d'un coup (lignes vides ignorées)", groups.status === 201 && groups.body.ids.length === 3);
const renamed = await studio.call("POST", `/api/admin/school/groups/${groups.body.ids[1]}`, { name: "P3 A", leader: "M. Dethier" });
const emptied = await studio.call("POST", `/api/admin/school/groups/${groups.body.ids[1]}`, { name: "" });
check("une classe se renomme, avec son enseignant ; un nom vide est refusé", renamed.status === 200 && emptied.status === 400);
await studio.call("DELETE", `/api/admin/school/groups/${groups.body.ids[2]}`);

/* ---------- Année : dates et statut ---------- */

const dates = await studio.call("POST", `/api/admin/school/years/${yearId}`, { status: "open", orderDeadline: "2026-10-24", lateDeadline: "2026-11-15" });
const badDates = await studio.call("POST", `/api/admin/school/years/${yearId}`, { orderDeadline: "2026-11-20", lateDeadline: "2026-11-15" });
const badStatus = await studio.call("POST", `/api/admin/school/years/${yearId}`, { status: "publie" });
check("dates de commande et ouverture des ventes ; incohérences refusées",
      dates.status === 200 && badDates.status === 400 && badStatus.status === 400, badDates.body.error);

/* ---------- Année suivante : reprise des groupes ---------- */

const next = await studio.call("POST", `/api/admin/school/schools/${schoolId}/years`, {});
const again = await studio.call("POST", `/api/admin/school/schools/${schoolId}/years`, { label: next.body.label });
overview = (await studio.call("GET", "/api/admin/school")).body;
school = overview.schools.find((s) => s.id === schoolId);
const nextYear = school.years.find((y) => y.id === next.body.id);
const firstYear = school.years.find((y) => y.id === yearId);
check("l'année suivante reprend les classes et leurs enseignants, en préparation",
      next.status === 201 && nextYear && nextYear.status === "draft" &&
      nextYear.groups.map((g) => g.name).join(",") === "M1,P3 A" && nextYear.groups[1].leader === "M. Dethier",
      nextYear && nextYear.groups.map((g) => g.name).join(","));
check("l'année d'origine garde ses dates et ses classes ; la même année ne se crée pas deux fois",
      firstYear.status === "open" && firstYear.orderDeadline > 0 && firstYear.groups.length === 2 && again.status === 409);

/* ---------- Cloisonnement ---------- */

await setPlan(free.email, "studio");
const otherSees = (await free.call("GET", "/api/admin/school")).body.schools.length;
const otherEdit = await free.call("POST", `/api/admin/school/schools/${schoolId}`, { kind: "ecole", name: "Piratée" });
const otherGroup = await free.call("DELETE", `/api/admin/school/groups/${groups.body.ids[0]}`);
const otherYear = await free.call("POST", `/api/admin/school/years/${yearId}/groups`, { names: ["Intrus"] });
check("un autre photographe ne voit ni ne modifie rien de cet établissement",
      otherSees === 0 && otherEdit.status === 404 && otherGroup.status === 404 && otherYear.status === 404);

/* ---------- Suppression ---------- */

const del = await studio.call("DELETE", `/api/admin/school/schools/${schoolId}`);
overview = (await studio.call("GET", "/api/admin/school")).body;
check("supprimer l'établissement emporte ses années et ses classes", del.status === 200 && overview.schools.length === 0);

execFileSync("npx", ["wrangler", "d1", "execute", "galerie-protegee", "--local", "--command",
  `DELETE FROM photographers WHERE email IN ('${studio.email}', '${free.email}')`], { cwd: WORKER_ROOT, stdio: "pipe" });

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
