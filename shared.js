"use strict";
// shared.js — 아이 앱(index.html)과 보호자 앱(B단계 parent.html)이 함께 쓰는 도우미. 가장 먼저 불러온다.
// 상태를 갖지 않는다(순수 함수와 상수만; watchViewport 는 앱이 시작할 때 한 번 부르는 화면 감시). window.Shared 하나만 노출하고, 각 파일은 머리에서 필요한 이름을 별칭으로 꺼내 쓴다
// (예: quiz.js `const { $, setFeedback, modeLabels } = Shared;`). 같은 이름을 두 파일에서 const 로 선언하면 안 된다(전역 어휘 범위를 함께 쓴다).
(function () {
  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  // createElement 축약(innerHTML 은 쓰지 않는다). attrs:
  //   class/className → className, dataset → data-*, style(객체) → style, on<이벤트>(함수) → 프로퍼티 처리기(el.onclick = …),
  //   true(hidden, disabled, multiple, readOnly …) → 같은 이름의 프로퍼티(없으면 빈 속성), 그 밖의 값(id, type, for, aria-*, style 문자열 …) → 속성.
  //   값이 undefined·null·false 면 건너뛴다. children: 노드·문자열·숫자·배열(펼침), null·false 는 건너뛴다.
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class" || key === "className") el.className = value;
      else if (key === "dataset") Object.assign(el.dataset, value);
      else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
      else if (/^on[a-z]+$/.test(key) && typeof value === "function") el[key] = value;
      else if (value === true) {
        if (key in el) el[key] = true;
        else el.setAttribute(key, "");
      } else el.setAttribute(key, String(value));
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : String(child));
    }
    return el;
  }
  function setFeedback(el, type, text) {
    el.className = "feedback " + type;
    el.textContent = text;
  }

  // ---- 서식·날짜 ----
  const tidy = (s) => String(s ?? "").replace(/[\t\r\n]+/g, " ").trim();
  const formatCode = (code) => (code ? String(code).slice(0, 3) + " " + String(code).slice(3) : "");
  const hourLabel = (h) => (h < 12 ? "오전 " : "오후 ") + (h % 12 || 12) + "시";
  function relativeTime(iso) {
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms)) return "";
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return "방금";
    if (minutes < 60) return minutes + "분 전";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + "시간 전";
    const days = Math.floor(hours / 24);
    if (days < 7) return days + "일 전";
    return new Date(iso).toLocaleDateString("ko-KR");
  }
  function durationText(ms) {
    if (!Number.isInteger(ms) || ms < 0) return "";
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}분 ${s % 60}초`;
  }
  // 오늘·최근 7일은 이 기기의 현지 날짜로 센다(서버는 한국 시각으로 저장).
  const dayKey = (value) => {
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? "" : [d.getFullYear(), d.getMonth() + 1, d.getDate()].join("-");
  };
  const pctOf = (r) => (r.total ? Math.round((r.correct / r.total) * 100) : 0);
  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const modeLabels = { read_meaning: "읽기 + 뜻", en_ko: "영어 → 한글", ko_en: "한글 → 영어·스펠링" };

  // ---- 상수 ----
  // 배포한 Worker 주소. 보호자는 접속 코드만 입력하면 된다.
  const AI_SERVER_DEFAULT = "https://daily-vocab-ai.reonwipe.workers.dev";
  // https 주소(또는 로컬 개발용 http://localhost·127.0.0.1)만 받아 끝의 / 를 뗀다. 비면 "", 잘못된 주소면 null.
  function normalizeServer(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const u = new URL(raw);
      const local = ["localhost", "127.0.0.1"].includes(u.hostname);
      if (u.protocol === "https:" || (u.protocol === "http:" && local)) return u.origin + u.pathname.replace(/\/+$/, "");
    } catch {}
    return null;
  }
  // 사전에 물어볼 수 있는 영어: 영문자로 시작하는 단어·짧은 구(공백, 마침표, 하이픈, 아포스트로피, 40자 이하). Worker와 같은 규칙.
  const WORD_PATTERN = /^[A-Za-z][A-Za-z .'’-]{0,39}$/;
  // 오늘의 단어 수준·문제당 제한 시간 선택지와 계획 기본값(Worker parsePlan 과 같은 항목).
  const PLAN_LEVELS = ["초등 고학년 상위권", "중1", "중2 상위권", "중3·고1", "고1·수능 기초", "고2·수능 실전"];
  const TIME_LIMIT_CHOICES = [0, 10, 15, 20, 30, 45, 60];
  const planDefaults = (plan) => ({ enabled: false, level: "중2 상위권", dailyCount: 10, hour: 16, timeLimitSec: 0, setsLocked: false, remindHour: null, ...(plan || {}) });
  // 공부 알림 시각 선택지(보호자 앱 아이 설정 탭, 한국 시각): 없음(null) 또는 오후 3시~오후 10시
  const REMIND_HOUR_CHOICES = [null, 15, 16, 17, 18, 19, 20, 21, 22];

  // ---- 기기 ----
  // 보호자 화면·알림 구독에 보일 기기 이름. iPadOS는 Mac처럼 보이므로 터치 지원으로 가른다.
  function deviceLabel() {
    const ua = navigator.userAgent || "";
    if (/DailyVocabApp\//.test(ua)) return /Mobile/.test(ua) ? "Android 폰(앱)" : "Android 태블릿(앱)"; // 갤럭시용 래퍼 앱(android/)
    if (/iPhone/.test(ua)) return "iPhone";
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android 폰" : "Android 태블릿";
    if (/Windows/.test(ua)) return "Windows PC";
    if (/Macintosh/.test(ua)) return "Mac";
    return "기타 기기";
  }

  // ---- 세트 초안 텍스트 ----
  // 한 줄에 `번호\t영어\t뜻\t별칭|별칭\t발음`(발음은 선택). 탭이 모자라면 ‘번호 영어 뜻’ 공백 구분도 읽는다. 편집기와 백업 검증이 함께 쓴다.
  function parseDraft(text) {
    return String(text ?? "")
      .split("\n")
      .filter((l) => l.trim())
      .map((line, i) => {
        let parts = line.split("\t");
        if (parts.length < 3) {
          const match = line.trim().match(/^(?:(\d+)\s+)?([A-Za-z][A-Za-z '-]*?)\s+([가-힣].*)$/);
          parts = match ? [match[1] || String(i + 1), match[2], match[3], ""] : ["" + (i + 1), line, "", ""];
        }
        return {
          id: parts[0].trim(),
          en: parts[1].trim(),
          ko: parts[2].trim(),
          aliases: (parts[3] || "").split("|").map((x) => x.trim()).filter(Boolean),
          ipa: (parts[4] || "").trim(),
          hangul: "",
        };
      });
  }

  // ---- 사진 (사진 인식·문제 물어보기 공용) ----
  // 긴 변을 2000px 이하로 줄인 canvas.
  async function preparePhoto(file) {
    const image = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 2000 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas;
    } finally {
      image.close();
    }
  }
  // canvas → JPEG(품질 0.92) base64(머리말 data:… 없이).
  function canvasToBase64Jpeg(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(Error("사진 변환 실패"));
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
          reader.onerror = () => reject(Error("사진 변환 실패"));
          reader.readAsDataURL(blob);
        },
        "image/jpeg",
        0.92,
      );
    });
  }

  // ---- 서버 요청 (가족 Worker) ----
  // 오류는 ApiError{status, code, message}. status 0 = 서버에 닿지 못함(code: no_server · timeout · network · aborted), code 는 Worker 의 error 값.
  class ApiError extends Error {
    constructor(message, status = 0, code = "") {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
    }
  }
  // 오류 정보 → 화면에 보일 한국어 문구(한 곳). info = {status, code, message(서버가 준 문구), path(요청 경로)}.
  // 401 은 보호자 경로(/family…)면 보호자 코드, 그 밖은 접속 코드 안내. 404 중 아는 오류(unknown_child·no_daily·unknown_code)가 아니면 옛 Worker → ‘다시 배포’.
  function describeApiError({ status = 0, code = "", message = "", path = "" } = {}) {
    if (!status) {
      if (code === "no_server") return "AI 서버 주소가 올바르지 않아요. 보호자 설정 · AI 연결을 확인하세요.";
      if (code === "timeout") return "가족 서버가 응답하지 않아요(시간 초과).";
      if (code === "aborted") return "요청을 취소했어요.";
      return "가족 서버에 연결하지 못했어요. 인터넷 연결을 확인하세요.";
    }
    if (status === 401) return String(path).startsWith("/family") ? "보호자 코드가 맞지 않아요. 다시 입력해 주세요." : "접속 코드가 맞지 않아요. 보호자 설정 · AI 연결에서 다시 입력하세요.";
    if (code === "push_unconfigured") return "알림 서버가 아직 준비되지 않았어요. 보호자가 Worker에 알림 키를 등록하면 켤 수 있어요.";
    if (status === 404 && !["unknown_child", "no_daily", "unknown_code", "no_subscription"].includes(code))
      return "AI 서버가 아직 이 기능을 지원하지 않아요. 보호자가 Worker를 새 버전으로 다시 배포해 주세요.";
    if (status === 403) return "이 주소에서는 가족 서버를 쓸 수 없어요. 보호자가 ALLOWED_ORIGINS를 확인해 주세요.";
    if (typeof message === "string" && message) return message;
    if (status === 429) return "요청이 너무 많아요. 잠시 후 다시 시도하세요.";
    return `가족 서버 오류 ${status}`;
  }
  // server + path 로 JSON 요청(x-app-passcode 헤더). 200 + JSON 이면 그 값을, 아니면 ApiError 를 던진다.
  // timeout(ms)이 지나거나 signal 이 끊으면 멈춘다.
  async function apiRequest(server, path, { method = "POST", body, passcode, timeout = 20000, signal } = {}) {
    const fail = (status, code, message) => new ApiError(describeApiError({ status, code, message, path }), status, code);
    if (!server) throw fail(0, "no_server");
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);
    const stop = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", stop, { once: true });
    }
    let response;
    try {
      response = await fetch(server + path, {
        method,
        headers: { "content-type": "application/json", "x-app-passcode": passcode },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      throw fail(0, e?.name === "AbortError" ? (timedOut || !signal?.aborted ? "timeout" : "aborted") : "network");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {}
    if (response.status === 200 && payload) return payload;
    throw fail(response.status, payload?.error, payload?.message);
  }

  // ---- 저장소 (localStorage, 오류는 삼킨다) ----
  // 없거나 읽지 못하거나 validate 가 거절하면 null.
  function readJson(key, validate) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      const value = JSON.parse(raw);
      return !validate || validate(value) ? value : null;
    } catch {
      return null;
    }
  }
  // 저장에 성공하면 true(공간 부족·차단이면 false).
  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  // ---- 알림 (Web Push · 갤럭시 앱 로컬 알림) ----
  // support(): "native"(갤럭시 래퍼 앱의 window.DailyVocabNotify — N2 에서 생긴다) | "push"(PushManager) | "install"(아이폰·아이패드의 Safari 탭: 홈 화면에 설치한 앱에서만 된다) | "none"
  // permission(): 지금 권한 "granted"|"denied"|"prompt"(묻지 않음). request(): 권한 요청(사용자 터치 안에서 부른다) → 같은 값. 네이티브는 브리지의 permission()(요청 포함).
  // subscribe(서버 공개 키) → 구독 {endpoint, keys:{p256dh, auth}}(PushSubscription.toJSON; 같은 키의 구독이 있으면 그것), current() → 지금 구독 | null, unsubscribe() → boolean.
  // native() → 갤럭시 브리지 {available, permission(), schedule({daily, reminder}), skipToday(kind), cancel()} | null.
  // 테스트: window.__dailyVocabPushImpl 이 있으면 support·permission·request·subscribe·current·unsubscribe 를 그것으로 바꿔 쓴다(Playwright addInitScript 의 가짜 구독).
  const testPush = () => window.__dailyVocabPushImpl || null;
  const nativeNotify = () => (window.DailyVocabNotify && window.DailyVocabNotify.available ? window.DailyVocabNotify : null);
  const appleMobile = () => /iPhone|iPad|iPod/.test(navigator.userAgent || "") || (/Macintosh/.test(navigator.userAgent || "") && navigator.maxTouchPoints > 1);
  const standalone = () => navigator.standalone === true || (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches);
  const permissionOf = (p) => (p === "granted" || p === "denied" ? p : "prompt");
  function base64UrlBytes(text) {
    const s = String(text || "").trim().replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(s + "===".slice((s.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  // 서비스워커 등록을 기다린다(앱이 sw.js 를 등록한다). 10초 안에 준비되지 않으면 실패.
  function pushRegistration() {
    if (!("serviceWorker" in navigator)) return Promise.reject(Error("이 브라우저는 알림을 지원하지 않아요."));
    return Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(Error("앱 준비가 끝나지 않았어요. 앱을 다시 열어 주세요.")), 10000)),
    ]);
  }
  async function currentPushSubscription() {
    if (!("serviceWorker" in navigator)) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg && reg.pushManager ? reg.pushManager.getSubscription() : null;
  }
  const notify = Object.freeze({
    support() {
      const t = testPush();
      if (t) return t.support ? t.support() : "push";
      if (nativeNotify()) return "native";
      if (appleMobile() && !standalone()) return "install";
      if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return "push";
      return "none";
    },
    native: nativeNotify,
    permission() {
      const t = testPush();
      if (t) return permissionOf(t.permission());
      return typeof Notification === "undefined" ? "denied" : permissionOf(Notification.permission);
    },
    async request() {
      const t = testPush();
      if (t) return permissionOf(await t.request());
      const bridge = nativeNotify();
      if (bridge) return permissionOf(bridge.permission());
      if (typeof Notification === "undefined") return "denied";
      return permissionOf(await Notification.requestPermission());
    },
    async subscribe(serverKey) {
      const t = testPush();
      if (t) return t.subscribe(serverKey);
      const key = base64UrlBytes(serverKey);
      const reg = await pushRegistration();
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        const old = existing.options && existing.options.applicationServerKey;
        if (!old || sameBytes(new Uint8Array(old), key)) return existing.toJSON();
        await existing.unsubscribe(); // 서버 키가 바뀌었다(Worker 키 교체): 새 키로 다시 만든다
      }
      return (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })).toJSON();
    },
    async current() {
      const t = testPush();
      if (t) return t.current();
      const sub = await currentPushSubscription();
      return sub ? sub.toJSON() : null;
    },
    async unsubscribe() {
      const t = testPush();
      if (t) return t.unsubscribe();
      const sub = await currentPushSubscription();
      return sub ? sub.unsubscribe() : false;
    },
  });

  // ---- 화면 키보드·확대 감지 (하단 탭) ----
  // 고정된 하단 탭(position:fixed; bottom:0)은 화면 키보드가 떠 있거나 화면이 확대된 동안 ‘보이는 영역’이 아니라 페이지 틀의 아래에 붙어 있어서,
  // 스크롤하면 화면 가운데로 떠오른다(특히 iPhone: 16px보다 작은 입력칸을 누르면 확대된 채로 남는다). 그동안 body.viewport-busy 를 붙여 두면
  // 각 앱 CSS 가 하단 탭을 숨긴다. 조건: 터치 기기에서 글자 입력칸에 초점이 있을 때, 보이는 영역이 페이지 틀보다 150px 넘게 작을 때(키보드),
  // 확대 배율이 1.05를 넘을 때. 아이 앱(quiz.js)과 보호자 앱(parent.js)이 시작할 때 한 번 부른다.
  function watchViewport() {
    const vv = window.visualViewport;
    const touch = Boolean(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    const NOT_TEXT = /^(checkbox|radio|button|submit|reset|file|range|color|image|hidden)$/;
    const typing = () => {
      const el = document.activeElement;
      if (!el || el.readOnly || el.disabled) return false;
      if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
      return el.tagName === "INPUT" && !NOT_TEXT.test(el.type);
    };
    let timer = 0;
    const update = () => {
      timer = 0;
      const layoutHeight = document.documentElement.clientHeight;
      const zoomed = Boolean(vv && vv.scale > 1.05);
      const keyboard = Boolean(vv && layoutHeight - vv.height * vv.scale > 150);
      document.body.classList.toggle("viewport-busy", zoomed || keyboard || (touch && typing()));
    };
    const later = () => {
      if (!timer) timer = setTimeout(update, 0); // 스크롤·크기 변경이 몰려도 한 번만
    };
    if (vv) {
      vv.addEventListener("resize", later);
      vv.addEventListener("scroll", later);
    }
    window.addEventListener("resize", later);
    document.addEventListener("focusin", later);
    document.addEventListener("focusout", later); // 초점이 옮겨 간 뒤(다음 차례)에 activeElement 를 본다
    update();
  }

  window.Shared = Object.freeze({
    $, h, setFeedback, watchViewport,
    tidy, formatCode, hourLabel, relativeTime, durationText, dayKey, pctOf, WEEKDAYS, modeLabels,
    AI_SERVER_DEFAULT, normalizeServer, WORD_PATTERN, PLAN_LEVELS, TIME_LIMIT_CHOICES, REMIND_HOUR_CHOICES, planDefaults,
    deviceLabel,
    parseDraft, preparePhoto, canvasToBase64Jpeg,
    ApiError, apiRequest, describeApiError,
    readJson, writeJson,
    notify,
  });
})();
