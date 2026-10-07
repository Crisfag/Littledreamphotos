// Regroupement d'une séance scolaire par enfant (rafales), sans réseau.
//
//   node tests/bursts.test.mjs

import { splitIntoBursts, MIN_BREAK_MS } from "../src/school.js";

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail !== undefined ? "  — " + detail : ""}`);
}

// Séance fictive : n enfants, poses espacées de `inner` ms, pause `pause` ms entre enfants.
function session(counts, inner, pause, start = Date.UTC(2026, 9, 7, 9, 0, 0)) {
  const items = [];
  let t = start;
  counts.forEach((n, child) => {
    for (let k = 0; k < n; k++) {
      items.push({ id: `c${child}-${k}`, takenAt: t, sourceName: `IMG_${String(items.length).padStart(4, "0")}.jpg` });
      t += inner + (k % 2) * 400;
    }
    t += pause;
  });
  return items;
}
const sizes = (r) => r.bursts.map((b) => b.length).join(",");
const pure = (r) => r.bursts.every((b) => new Set(b.map((id) => id.split("-")[0])).size === 1);

const a = splitIntoBursts(session([5, 6, 4, 6, 5], 1500, 25000));
check("séance classique (poses à 1,5 s, 25 s entre enfants) : un groupe par enfant", sizes(a) === "5,6,4,6,5" && pure(a), `${sizes(a)} · seuil ${a.thresholdMs} ms`);

const b = splitIntoBursts(session([2, 3, 1, 2, 4, 3], 2000, 12000));
check("peu de poses par enfant, enfants qui s'enchaînent vite (12 s) : séparés quand même", sizes(b) === "2,3,1,2,4,3" && pure(b), `${sizes(b)} · seuil ${b.thresholdMs} ms`);

const c = splitIntoBursts(session([6, 5, 7], 3000, 40000).reverse());
check("ordre des fichiers indifférent : seule l'heure de prise de vue compte", sizes(c) === "6,5,7" && pure(c), sizes(c));

const d = splitIntoBursts(session([4, 4], 800, 3000));
check(`une pause trop courte (3 s, sous ${MIN_BREAK_MS / 1000} s) n'est jamais prise pour un changement d'enfant`, d.bursts.length === 1, sizes(d));

const withLate = [...session([3, 2, 4], 2000, 30000), { id: "classe-0", takenAt: Date.UTC(2026, 9, 7, 9, 20, 0) }];
const h = splitIntoBursts(withLate);
check("une longue pause plus tard (photo de classe prise à part) ne fait pas réunir les enfants", sizes(h) === "3,2,4,1", `${sizes(h)} · seuil ${h.thresholdMs} ms`);

const withUndated = [...session([3, 3], 1000, 20000), { id: "x1", takenAt: null }, { id: "x2" }];
const e = splitIntoBursts(withUndated);
check("photos sans heure de prise de vue : laissées à trier", e.undated.join(",") === "x1,x2" && sizes(e) === "3,3", sizes(e));

const f = splitIntoBursts([{ id: "solo", takenAt: 1 }]);
const g = splitIntoBursts([]);
check("cas limites : une seule photo, aucune photo", sizes(f) === "1" && g.bursts.length === 0 && g.undated.length === 0);

const failed = checks.filter((x) => !x.ok);
console.log(failed.length ? `\n${failed.length} vérification(s) en échec.` : `\n${checks.length} vérifications, toutes passent.`);
process.exit(failed.length ? 1 : 0);
