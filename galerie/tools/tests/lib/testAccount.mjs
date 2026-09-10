// Crée un compte photographe jetable pour un test autonome (galerie créée et
// nettoyée par le test lui-même). Évite de dupliquer l'inscription dans
// chaque fichier de test qui a besoin d'un WorkerClient authentifié.

export async function createTestAccount(api, label) {
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

  return { email, password };
}
