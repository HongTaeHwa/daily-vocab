const CACHE = "daily-vocab-shell-v36";
const SHELL = [
  "./",
  "./index.html",
  "./shared.js?v=20261018-27",
  "./quiz.js?v=20261018-27",
  "./family.js?v=20261018-27",
  "./editor.js?v=20261018-27",
  "./sets.js?v=20261018-27",
  "./manifest.webmanifest",
  "./parent.html",
  "./parent.js?v=20261018-27",
  "./parent.css?v=20261018-27",
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
// 알림(Web Push): Worker 가 암호화해 보낸 {title, body, url, tag} 를 그대로 띄운다(문구는 Worker 가 만든다).
// url 이 parent.html 로 시작하면 보호자 앱 아이콘, 아니면 아이 앱 아이콘. 같은 tag 의 알림은 새것으로 바뀐다.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {}
  const text = (v, fallback) => (typeof v === "string" && v.trim() ? v : fallback);
  const url = text(data.url, "./");
  const icon = url.replace(/^\.\//, "").startsWith("parent.html") ? "./icons/parent-192.png" : "./icons/icon-192.png";
  event.waitUntil(
    self.registration.showNotification(text(data.title, "매일 영단어"), {
      body: text(data.body, "앱을 열어 확인해 보세요"),
      icon,
      data: { url },
      ...(typeof data.tag === "string" && data.tag ? { tag: data.tag } : {}),
    }),
  );
});
// 알림을 누르면: 같은 앱(아이 앱 / 보호자 앱)이 열려 있으면 그 창을 앞으로 가져오고 앱에 {type:"navigate", url} 을 보내 화면만 바꾼다
// (다시 불러오지 않는다: 시험 중이던 아이 앱이 새로 열리지 않게). 열린 창이 없으면 새로 연다.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./", self.registration.scope);
  const isParent = (u) => new URL(u).pathname.endsWith("parent.html");
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (list) => {
      const scope = new URL(self.registration.scope).pathname;
      const same = list.find((c) => new URL(c.url).pathname.startsWith(scope) && isParent(c.url) === isParent(target.href));
      if (!same) return self.clients.openWindow(target.href);
      try {
        await same.focus();
      } catch {}
      same.postMessage({ type: "navigate", url: target.href });
    }),
  );
});
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
