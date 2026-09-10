// Petites aides de réponse HTTP, isolées pour éviter un cycle d'imports
// entre le routeur et les modules de routes.

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

export function fail(status, message) {
  return json({ error: message }, { status });
}
