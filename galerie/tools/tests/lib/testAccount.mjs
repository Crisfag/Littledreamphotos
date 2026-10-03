import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "worker");

// Crée un compte photographe jetable pour un test autonome (galerie créée et
// nettoyée par le test lui-même). Évite de dupliquer l'inscription dans
// chaque fichier de test qui a besoin d'un WorkerClient authentifié.

export async function createTestAccount(api, label, { plan = "pro" } = {}) {
  const email = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@test.invalid`;
  const password = `mot-de-passe-de-test-${Math.random().toString(36).slice(2, 10)}`;

  const response = await fetch(`${api.replace(/\/$/, "")}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, studioName: `Suite de tests — ${label}` }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Impossible de créer le compte de test : ${response.status} ${detail}`);
  }

  if (plan) await setTestPlan(api, email, plan);
  return { email, password };
}

// Formule d'abonnement posée directement dans la base locale (comme le
// ferait le webhook Stripe) : par défaut Pro, pour que les tests ne butent
// pas sur les limites de la formule gratuite (testées dans api.test.mjs).
export async function setTestPlan(api, email, plan, status = "active") {
  execFileSync("npx", ["wrangler", "d1", "execute", "galerie-protegee", "--local", "--command",
    `UPDATE photographers SET plan = '${plan}', plan_status = '${status}' WHERE email = '${email}'`], { cwd: WORKER_DIR, stdio: "pipe" });
  // Juste après une écriture directe, le Worker local coupe parfois ses
  // connexions : on attend qu'il réponde à nouveau.
  for (let i = 0; i < 20; i++) {
    try {
      if ((await fetch(`${api.replace(/\/$/, "")}/health`, { headers: { connection: "close" } })).ok) return;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 500));
  }
}
