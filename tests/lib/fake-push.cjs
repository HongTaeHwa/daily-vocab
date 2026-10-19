// 알림 테스트용 가짜 — tests/family.cjs · parent.cjs 공용. context.addInitScript(fakePushScript) 처럼 페이지 스크립트보다 먼저 넣는다.
// fakePushScript: window.__dailyVocabPushImpl(shared.js Shared.notify 의 테스트 훅). 상태는 localStorage "__test_push" 에 둬서 새로고침해도 이어진다:
//   {support("push" 기본 | "install" | "none"), answer(권한 요청 결과, 기본 "granted"), permission, requests(요청 횟수), key(받은 서버 키), n, sub(지금 구독)}
//   구독 endpoint 는 https://push.test/sub/<n>. 브라우저가 구독을 바꾼 상황은 테스트가 sub.endpoint 를 직접 바꿔 만든다.
// fakeNativeScript: 갤럭시 앱 브리지 window.DailyVocabNotify(N2 계약: available, permission(), schedule(o), skipToday(kind), cancel()). 부른 기록은 localStorage "__test_native" 배열.
"use strict";

function fakePushScript() {
  const KEY = "__test_push";
  const read = () => JSON.parse(localStorage.getItem(KEY) || "{}");
  const write = (v) => localStorage.setItem(KEY, JSON.stringify(v));
  window.__dailyVocabPushImpl = {
    support: () => read().support || "push",
    permission: () => read().permission || "prompt",
    request: async () => {
      const s = read();
      s.permission = s.answer || "granted";
      s.requests = (s.requests || 0) + 1;
      write(s);
      return s.permission;
    },
    subscribe: async (key) => {
      const s = read();
      s.key = key;
      if (!s.sub) {
        s.n = (s.n || 0) + 1;
        s.sub = { endpoint: "https://push.test/sub/" + s.n, expirationTime: null, keys: { p256dh: "B" + "A".repeat(86), auth: "A".repeat(22) } };
      }
      write(s);
      return s.sub;
    },
    current: async () => read().sub || null,
    unsubscribe: async () => {
      const s = read();
      const had = Boolean(s.sub);
      delete s.sub;
      write(s);
      return had;
    },
  };
}

function fakeNativeScript() {
  const log = (entry) => {
    const list = JSON.parse(localStorage.getItem("__test_native") || "[]");
    list.push(entry);
    localStorage.setItem("__test_native", JSON.stringify(list));
  };
  window.DailyVocabNotify = {
    available: true,
    permission: () => (log(["permission"]), "granted"),
    schedule: (o) => log(["schedule", o]),
    skipToday: (kind) => log(["skipToday", kind]),
    cancel: () => log(["cancel"]),
  };
}

module.exports = { fakePushScript, fakeNativeScript };
