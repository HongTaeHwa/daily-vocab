const CACHE = "daily-vocab-shell-v31";
const SHELL = [
  "./",
  "./index.html",
  "./shared.js?v=20261018-22",
  "./quiz.js?v=20261018-22",
  "./family.js?v=20261018-22",
  "./editor.js?v=20261018-22",
  "./sets.js?v=20261018-22",
  "./manifest.webmanifest",
  "./parent.html",
  "./parent.js?v=20261018-22",
  "./parent.css?v=20261018-22",
  "./manifest-parent.webmanifest",
  "./icons/parent-192.png",
  "./icons/parent-512.png",
  "./icons/parent-maskable-512.png",
  "./icons/parent-apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
];
// 오프라인 내비게이션: 보호자 앱(parent.html)으로 연 화면은 보호자 앱 셸로, 그 밖은 아이 앱 셸로 되돌린다.
const navigationFallback = (request) =>
  new URL(request.url).pathname.endsWith("parent.html") ? "./parent.html" : "./index.html";
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("daily-vocab-shell-") && key !== CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== self.location.origin
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE).then((cache) => cache.put(event.request, copy)),
          );
        }
        return response;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then(
            (cached) =>
              cached ||
              (event.request.mode === "navigate"
                ? caches.match(navigationFallback(event.request))
                : Response.error()),
          ),
      ),
  );
});
