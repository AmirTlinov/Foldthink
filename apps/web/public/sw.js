const revision = new URL(self.location.href).searchParams.get("revision") ?? "development";
const shellCache = `foldthink-shell-${revision}`;
const shellAssets = ["/", "/assets/app.js", "/assets/app.css", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(shellCache).then((cache) => cache.addAll(shellAssets)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== shellCache).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api")) {
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/", { ignoreVary: true })));
    return;
  }
  event.respondWith(
    caches.match(url.pathname, { ignoreVary: true }).then((cached) => cached ?? fetch(request)),
  );
});
