// Espace photographe installé sur l'écran d'accueil (manifest.webmanifest).
// Rien n'est mis en cache, sauf une page « hors connexion » : les données
// (galeries, réservations, paiements) viennent toujours du serveur, à jour.
const CACHE = "holypixx-admin-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Pages seulement : le réseau d'abord ; sans connexion, la page d'attente.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
