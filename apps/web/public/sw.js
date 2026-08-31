const revision = new URL(self.location.href).searchParams.get("revision") ?? "development";
const shellCache = `foldthink-shell-${revision}`;
const shellAssets = [
  "/",
  "/assets/app.js",
  "/assets/app.css",
  "/assets/public-browser.js",
  "/assets/scene-element.js",
  "/widget-frame.html",
  "/assets/widget-frame.js",
  "/manifest.webmanifest",
  "/icon.svg",
];

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
    const fallback = url.pathname === "/widget-frame.html" ? "/widget-frame.html" : "/";
    event.respondWith(fetch(request).catch(() => caches.match(fallback, { ignoreVary: true })));
    return;
  }
  event.respondWith(
    caches.match(url.pathname, { ignoreVary: true }).then(async (cached) => {
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && ["font", "image", "script", "style"].includes(request.destination)) {
        const cache = await caches.open(shellCache);
        await cache.put(request, response.clone());
      }
      return response;
    }),
  );
});
