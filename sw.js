// Cache do "app shell": deixa o app abrir instantâneo (e funcionar offline
// pra tudo que não depende da API do Scryfall) quando instalado no celular.
// Chamadas pra outras origens (Scryfall, imagens de carta) passam direto pra
// rede — não fazem sentido em cache aqui.
const CACHE_NAME = "token-printer-shell-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/mesa.js",
  "./js/dither.js",
  "./js/image-compose.js",
  "./js/players-store.js",
  "./js/scryfall.js",
  "./js/voice-query.js",
  "./vendor/niimbot.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
