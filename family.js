"use strict";
// family.js — 가족 기록함 + 오늘의 단어 + 아이 코드 연결.
// 보호자 폰은 보호자 코드를 저장하면 생기는 ‘아이들’ 탭에서 아이를 만들고(6자리 아이 코드·전용 링크), 아이별 기록을 보고, 오늘의 단어 계획을 정한다.
// 아이 기기(아이폰·태블릿)는 아이 코드나 전용 링크(?child=코드)로 연결되어 시험을 마칠 때마다 압축 기록을 보내고 매일 ‘오늘의 단어’를 받는다.
// 같은 코드를 넣은 기기는 한 아이로 묶인다. quiz.js 다음, sets.js 앞에 불러오고 sets.js가 마지막에 initFamily()를 부른다.
// 세트는 아이에게 속한다: 연결된 기기는 POST /sets/<childId>로 세트를 올리고 다른 기기·보호자가 바꾼 것을 받아 같은 아이의 기기가 항상 같은 세트를 본다(아래 ‘세트 동기화’).
// 저장 키 daily_vocab_family_v1 = {childId, childName, joinCode, pendingCode, deviceId, sendEnabled, lastSyncAt, lastError, pending:[기록 id], parentCode,
//        setsAcked:{세트 id: 수정 시각}, setsDeleted:[{id, deletedAt}], setsSyncedAt, setsError}
//        daily_vocab_daily_v1  = {childId, date, words, level, note, fetchedAt, result?, disabled?, lastCheckedAt, lastError?}
// 보호자 코드·아이 코드·아이 이름은 이 기기에만 두고 백업 JSON/CSV에 넣지 않는다.
const FAMILY_KEY = "daily_vocab_family_v1";
const MODE_KEY = "daily_vocab_mode_v1"; // "parent": 보호자 전용 아이콘(parent.html → ?mode=parent)으로 설치된 기기
const FAMILY_CACHE_KEY = "daily_vocab_family_cache_v1";
const DAILY_KEY = "daily_vocab_daily_v1";
const FAMILY_BATCH = 50; // 한 번에 보내는 기록 수 (Worker 상한 100)
const FAMILY_TIMEOUT_MS = 20000;
const DAILY_TIMEOUT_MS = 90000; // 오늘의 단어 생성은 Claude 호출이라 더 기다린다
const FAMILY_MISSED_LIMIT = 200; // 기록 하나에 담는 틀린 단어 수 (Worker 상한과 같음)
const ANCHOR_LIMIT = 60; // 교재 앵커: 최근 세트에서 보내는 영어 단어 수 (Worker 상한과 같음)
const DAILY_CHECK_MS = 10 * 60 * 1000; // 오늘 것이 없거나 꺼져 있을 때, 또는 다른 기기의 완료를 확인할 때 다시 물어보는 간격
const JOIN_CODE_PATTERN = /^\d{6}$/;
const PLAN_LEVELS = ["초등 고학년 상위권", "중1", "중2 상위권", "중3·고1", "고1·수능 기초", "고2·수능 실전"];
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const tidy = (s) => String(s ?? "").replace(/[\t\r\n]+/g, " ").trim();
const hourLabel = (h) => (h < 12 ? "오전 " : "오후 ") + (h % 12 || 12) + "시";
const formatCode = (code) => (code ? String(code).slice(0, 3) + " " + String(code).slice(3) : "");
const appBaseUrl = () => new URL("./", location.href).href;
const linkFor = (code) => appBaseUrl() + "?child=" + code;

function readFamily() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(FAMILY_KEY) || "null");
  } catch {}
  const f = saved && typeof saved === "object" ? saved : {};
  const idLike = (v) => (typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : "");
  return {
    childId: idLike(f.childId),
    childName: typeof f.childName === "string" ? tidy(f.childName).slice(0, 20) : "",
    joinCode: typeof f.joinCode === "string" && JOIN_CODE_PATTERN.test(f.joinCode) ? f.joinCode : "",
    pendingCode: typeof f.pendingCode === "string" && JOIN_CODE_PATTERN.test(f.pendingCode) ? f.pendingCode : "",
    deviceId: idLike(f.deviceId),
    sendEnabled: f.sendEnabled === true,
    lastSyncAt: typeof f.lastSyncAt === "string" ? f.lastSyncAt : "",
    lastError: typeof f.lastError === "string" ? f.lastError : "",
    pending: Array.isArray(f.pending) ? f.pending.filter((x) => typeof x === "string").slice(0, 5000) : [],
    parentCode: typeof f.parentCode === "string" ? f.parentCode : "",
    parentModeOff: f.parentModeOff === true, // 보호자 코드가 있어도 아이용 화면을 쓰고 싶을 때(설정의 ‘아이 기기처럼 보기’)
    // 세트 동기화: 서버가 아는 세트 id → 수정 시각(이와 다르면 다시 올림), 아직 못 보낸 삭제 묘비, 마지막 동기화·오류
    setsAcked:
      f.setsAcked && typeof f.setsAcked === "object" && !Array.isArray(f.setsAcked)
        ? Object.fromEntries(Object.entries(f.setsAcked).filter(([, v]) => typeof v === "string"))
        : {},
    setsDeleted: Array.isArray(f.setsDeleted) ? f.setsDeleted.filter((d) => d && typeof d.id === "string" && typeof d.deletedAt === "string").slice(-200) : [],
    setsSyncedAt: typeof f.setsSyncedAt === "string" ? f.setsSyncedAt : "",
    setsError: typeof f.setsError === "string" ? f.setsError : "",
    // 보호자가 정한 아이 설정(서버 plan에서 받아 둠). timeLimitSec 0 = 제한 없음
    settings: {
      timeLimitSec: Number.isInteger(f.settings?.timeLimitSec) && f.settings.timeLimitSec >= 0 ? f.settings.timeLimitSec : 0,
      fetchedAt: typeof f.settings?.fetchedAt === "string" ? f.settings.fetchedAt : "",
    },
  };
}
let family = readFamily();
// ---- 보호자 모드: 보호자 코드가 있거나 보호자 아이콘으로 설치된 기기는 아이들 화면이 첫 화면이고 홈·시험·기록 탭이 숨는다 ----
let appMode = "";
try {
  appMode = localStorage.getItem(MODE_KEY) === "parent" ? "parent" : "";
} catch {}
// ?mode=parent(보호자 아이콘 설치)·?mode=child 를 읽어 기억하고 주소에서 지운다.
function modeFromUrl() {
  try {
    const u = new URL(location.href);
    const m = u.searchParams.get("mode");
    if (!m) return "";
    u.searchParams.delete("mode");
    history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    return m;
  } catch {
    return "";
  }
}
function isParentMode() {
  return (appMode === "parent" || Boolean(family.parentCode)) && !family.parentModeOff;
}
// 모드에 따라 탭·문구·아이용 요소를 토글한다. 화면 이동은 하지 않는다(모드가 바뀌는 곳에서 showView).
function applyParentMode() {
  const on = isParentMode();
  document.body.classList.toggle("parent-mode", on);
  $("tabHome").classList.toggle("hidden", on);
  $("tabHistory").classList.toggle("hidden", on);
  $("tabFamily").classList.toggle("hidden", !(on || family.parentCode));
  $("brandTagline").textContent = on ? "보호자 · 아이들 관리" : "사진으로 만드는 나만의 단어장";
  const parentDevice = appMode === "parent" || Boolean(family.parentCode);
  $("parentBox").classList.toggle("hidden", !parentDevice); // 아이 기기에는 보호자 코드 칸을 보이지 않는다(parent.html로 연 기기에서만)
  $("parentModeRow").classList.toggle("hidden", !parentDevice);
  $("parentModeOff").checked = Boolean(family.parentModeOff);
}
// quiz.js 가 문제마다 부른다: 보호자가 정한 문제당 제한 시간(초). 연결되지 않은 기기는 0.
function childTimeLimitSec() {
  return isLinked() ? family.settings.timeLimitSec : 0;
}
let settingsFetching = false;
function applySettings(data) {
  family.settings = {
    timeLimitSec: Number.isInteger(data?.timeLimitSec) && data.timeLimitSec >= 0 ? data.timeLimitSec : 0,
    fetchedAt: new Date().toISOString(),
  };
  if (typeof data?.name === "string" && tidy(data.name)) family.childName = tidy(data.name).slice(0, 20); // 보호자가 이름을 바꿨으면 반영
  writeFamily();
}
// 앱 시작·화면 복귀 때 보호자 설정을 받아 둔다(10분 간격, 시작 때는 바로). 실패하면 조용히 다음 기회에.
async function fetchSettings(options = {}) {
  if (settingsFetching || !isLinked() || !syncPasscode()) return;
  if (!options.force && family.settings.fetchedAt && Date.now() - Date.parse(family.settings.fetchedAt) < DAILY_CHECK_MS) return;
  settingsFetching = true;
  try {
    applySettings(await familyRequest("/settings/" + encodeURIComponent(family.childId), { method: "GET", passcode: syncPasscode() }));
    renderFamilySettings();
  } catch (e) {
    // 옛 Worker(404)·일시 오류: 기존 설정 유지
  } finally {
    settingsFetching = false;
  }
}
function writeFamily() {
  try {
    localStorage.setItem(FAMILY_KEY, JSON.stringify(family));
    return true;
  } catch {
    return false;
  }
}
// 보호자 화면에 보일 기기 이름. iPadOS는 Mac처럼 보이므로 터치 지원으로 가른다.
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
function ensureDeviceId() {
  if (!family.deviceId) {
    family.deviceId = crypto.randomUUID();
    writeFamily();
  }
  return family.deviceId;
}

// ---- 가족 서버 요청 (서버 주소는 sets.js 의 AI 연결 설정과 같다) ----
function familyServer() {
  return normalizeServer(savedAi()?.server || AI_SERVER_DEFAULT);
}
// 기록 보내기·연결·오늘의 단어 받기는 가족 코드(AI 접속 코드)로, 없으면 보호자 코드로 보낸다.
function syncPasscode() {
  return aiConfig()?.passcode || family.parentCode || "";
}
async function familyRequest(path, { method = "POST", body, passcode, timeout = FAMILY_TIMEOUT_MS } = {}) {
  const server = familyServer();
  if (!server) throw Object.assign(Error("AI 서버 주소가 올바르지 않아요. 보호자 설정 · AI 연결을 확인하세요."), { status: 0 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response;
  try {
    response = await fetch(server + path, {
      method,
      headers: { "content-type": "application/json", "x-app-passcode": passcode },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    throw Object.assign(
      Error(e?.name === "AbortError" ? "가족 서버가 응답하지 않아요(시간 초과)." : "가족 서버에 연결하지 못했어요. 인터넷 연결을 확인하세요."),
      { status: 0 },
    );
  } finally {
    clearTimeout(timer);
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {}
  if (response.status === 200 && payload) return payload;
  const viewing = path.startsWith("/family");
  const code = payload?.error;
  let message;
  if (response.status === 401) message = viewing ? "보호자 코드가 맞지 않아요. 다시 입력해 주세요." : "접속 코드가 맞지 않아요. 보호자 설정 · AI 연결에서 다시 입력하세요.";
  else if (response.status === 404 && !["unknown_child", "no_daily", "unknown_code"].includes(code))
    message = "AI 서버가 아직 이 기능을 지원하지 않아요. 보호자가 Worker를 새 버전으로 다시 배포해 주세요.";
  else if (response.status === 403) message = "이 주소에서는 가족 서버를 쓸 수 없어요. 보호자가 ALLOWED_ORIGINS를 확인해 주세요.";
  else if (typeof payload?.message === "string" && payload.message) message = payload.message;
  else if (response.status === 429) message = "요청이 너무 많아요. 잠시 후 다시 시도하세요.";
  else message = `가족 서버 오류 ${response.status}`;
  throw Object.assign(Error(message), { status: response.status, code });
}

// ---- 아이 기기: 기록 보내기 ----
// 단어별 전체 결과·세트 단어는 보내지 않고 점수와 틀린 단어(영어·뜻)만 보낸다.
function compactRecord(r) {
  const correct = r.results.filter((x) => x.pass).length;
  return {
    id: r.id,
    setName: r.setName,
    mode: r.mode,
    range: r.range,
    startedAt: r.startedAt || null,
    completedAt: r.completedAt,
    total: r.results.length,
    correct,
    partial: r.partial === true,
    activeMs: Number.isInteger(r.activeMs) && r.activeMs >= 0 ? r.activeMs : null,
    ...(typeof r.daily === "string" ? { daily: r.daily } : {}),
    ...(Number.isInteger(r.awayCount) && r.awayCount > 0 ? { awayCount: r.awayCount, awayMs: Number.isInteger(r.awayMs) ? r.awayMs : 0 } : {}),
    ...(Number.isInteger(r.timeouts) && r.timeouts > 0 ? { timeouts: r.timeouts } : {}),
    missed: r.results
      .filter((x) => !x.pass)
      .slice(0, FAMILY_MISSED_LIMIT)
      .map((x) => ({ en: x.word.en, ko: x.word.ko, ...(x.unknown ? { unknown: true } : {}) })),
  };
}
// 교재 앵커: 가장 최근에 고친 세트의 영어 단어. 오늘의 단어 수준 기준으로 쓴다.
function anchorPayload() {
  const set = sets.slice().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0];
  if (!set) return undefined;
  const words = [...new Set(set.words.map((w) => tidy(w.en)).filter((w) => WORD_PATTERN.test(w)))].slice(0, ANCHOR_LIMIT);
  return { setName: set.name, words };
}
const isLinked = () => Boolean(family.childId && family.childName);
function syncReady() {
  return isLinked() && family.sendEnabled && Boolean(syncPasscode());
}
// quiz.js 의 saveSession 이 기록을 확정할 때(완료·중단) 부른다.
function queueFamilySync(record) {
  if (record.daily) noteDailyResult(record);
  if (!syncReady() && !family.sendEnabled) return;
  if (!family.pending.includes(record.id)) family.pending.push(record.id);
  writeFamily();
  flushFamilySync();
}
let syncInFlight = false, syncAgain = false;
// 대기 중인 기록을 50개씩 보낸다. 실패하면 대기 목록에 남겨 앱을 열 때·화면 복귀·온라인 복귀 때 다시 시도한다.
async function flushFamilySync(options = {}) {
  if (syncInFlight) {
    syncAgain = true;
    return;
  }
  if (!syncReady()) {
    renderFamilySettings();
    return;
  }
  family.pending = family.pending.filter((id) => historyRecords.some((r) => r.id === id)); // 기기에서 지운 기록은 보내지 않는다
  let force = options.force === true; // 기록이 없어도 아이 이름·기기·세트 목록·앵커를 한 번 보낸다
  if (!family.pending.length && !force) {
    writeFamily();
    renderFamilySettings();
    return;
  }
  syncInFlight = true;
  renderFamilySettings("기록을 보내는 중…");
  try {
    while (family.pending.length || force) {
      force = false;
      const ids = family.pending.slice(0, FAMILY_BATCH);
      const records = ids.map((id) => compactRecord(historyRecords.find((r) => r.id === id)));
      await familyRequest("/sync", {
        body: {
          child: { id: family.childId, name: family.childName },
          device: { id: ensureDeviceId(), label: deviceLabel() },
          records,
          sets: sets.map((s) => ({ name: s.name, count: s.words.length })),
          anchor: anchorPayload(),
        },
        passcode: syncPasscode(),
      });
      family.pending = family.pending.filter((id) => !ids.includes(id));
      family.lastSyncAt = new Date().toISOString();
      family.lastError = "";
      writeFamily();
    }
  } catch (e) {
    family.lastError = e?.message || String(e);
    writeFamily();
  } finally {
    syncInFlight = false;
    renderFamilySettings();
    if (syncAgain) {
      syncAgain = false;
      flushFamilySync();
    }
  }
}

// ---- 아이 기기: 세트 동기화(아이 단위) ----
// 연결된 기기는 POST /sets/<childId>에 known(기기의 세트 id·수정 시각 전부) + sets(새로 만들거나 고친 세트 전체) + deleted(지운 세트 묘비)를 보내고,
// 다른 기기·보호자가 만들거나 고친 세트(sets)와 지워진 id(deleted), 서버의 전체 요약(summary → setsAcked)을 받는다. 세트별 updatedAt이 나중인 쪽이 이긴다.
// 기본 예제 세트(day04)는 손대지 않았으면 올리지 않고 첫 동기화가 끝나면 기기에서 치운다(아이마다 세트가 다르므로 예제가 모든 기기에 보이면 안 된다).
// 앱을 열 때·화면 복귀(10분 간격)·온라인 복귀·세트 저장/이름 바꾸기/삭제/가져오기 뒤에 맞춘다. 시험 중에는 건드리지 않는다.
const SETS_CHECK_MS = DAILY_CHECK_MS;
const SETS_TIMEOUT_MS = 60000;
const EXAMPLE_SET_ID = "day04";
const wordSignature = (words) => JSON.stringify(words.map((w) => [w.en, w.ko, w.aliases]));
let exampleSignature = null;
function isUntouchedExample(set) {
  if (!set || set.id !== EXAMPLE_SET_ID || typeof defaultWords === "undefined") return false;
  if (exampleSignature === null) exampleSignature = wordSignature(defaultWords);
  return wordSignature(set.words) === exampleSignature;
}
const validSyncedWord = (w) =>
  w && ["string", "number"].includes(typeof w.id) && typeof w.en === "string" && w.en.trim() && typeof w.ko === "string" && w.ko.trim() && Array.isArray(w.aliases);
function validSyncedSet(s) {
  return Boolean(
    s && typeof s.id === "string" && typeof s.name === "string" && s.name.trim() && typeof s.updatedAt === "string" && Array.isArray(s.words) && s.words.length > 0 && s.words.every(validSyncedWord),
  );
}
function setsSyncReady() {
  return isLinked() && Boolean(syncPasscode()) && storageAvailable;
}
// sets.js 가 세트를 지울 때 부른다: 같은 아이의 다른 기기에서도 지워지도록 묘비를 남긴다.
function noteSetDeleted(id) {
  if (!isLinked()) return;
  if (id === EXAMPLE_SET_ID && !(id in family.setsAcked)) return; // 서버가 모르는 예제 세트는 묘비가 필요 없다
  family.setsDeleted = [...family.setsDeleted.filter((d) => d.id !== id), { id, deletedAt: new Date().toISOString() }].slice(-200);
  delete family.setsAcked[id];
  writeFamily();
}
// sets.js 가 세트를 저장·이름 바꾸기·삭제·가져오기 한 뒤 부른다.
function queueSetsSync() {
  syncSets({ force: true });
}
let setsSyncInFlight = false, setsSyncAgain = false;
async function syncSets(options = {}) {
  if (!setsSyncReady()) {
    renderFamilySettings();
    return;
  }
  if (sessionRunning) return; // 시험 중에는 세트를 바꾸지 않는다(끝나고 화면 복귀 때 다시)
  if (setsSyncInFlight) {
    setsSyncAgain = true;
    return;
  }
  if (!options.force && family.setsSyncedAt && Date.now() - Date.parse(family.setsSyncedAt) < SETS_CHECK_MS) return;
  setsSyncInFlight = true;
  renderFamilySettings();
  try {
    // 수정 시각이 없는 옛 세트(동기화 전에 만든 것)는 지금 시각을 붙여 올린다
    if (sets.some((s) => !s.updatedAt && !isUntouchedExample(s))) {
      const stamp = new Date().toISOString();
      if (!persistSets(sets.map((s) => (s.updatedAt || isUntouchedExample(s) ? s : { ...s, updatedAt: stamp })))) throw Error("세트를 저장하지 못했어요. 저장 공간을 확인하세요.");
    }
    const mine = sets.filter((s) => !isUntouchedExample(s));
    const dirty = mine.filter((s) => family.setsAcked[s.id] !== s.updatedAt);
    const deleted = family.setsDeleted.slice();
    const data = await familyRequest("/sets/" + encodeURIComponent(family.childId), {
      body: {
        device: { id: ensureDeviceId(), label: deviceLabel() },
        known: mine.map((s) => ({ id: s.id, updatedAt: s.updatedAt })),
        sets: dirty.map((s) => ({ id: s.id, name: s.name, words: s.words, updatedAt: s.updatedAt })),
        deleted,
      },
      passcode: syncPasscode(),
      timeout: SETS_TIMEOUT_MS,
    });
    applySetsResponse(data, deleted);
  } catch (e) {
    family.setsError = e?.message || String(e);
    writeFamily();
  } finally {
    setsSyncInFlight = false;
    renderFamilySettings();
    if (setsSyncAgain) {
      setsSyncAgain = false;
      syncSets({ force: true });
    }
  }
}
// 서버 응답을 기기에 반영: 받은 세트는 넣거나 바꾸고, 지워진 세트는 빼고, 손대지 않은 예제 세트는 치운다.
function applySetsResponse(data, sentDeleted) {
  const incoming = (Array.isArray(data?.sets) ? data.sets : []).filter(validSyncedSet);
  const removed = new Set((Array.isArray(data?.deleted) ? data.deleted : []).filter((id) => typeof id === "string"));
  const next = sets.filter((s) => !removed.has(s.id) && !isUntouchedExample(s));
  for (const s of incoming) {
    const normalized = { id: s.id, name: tidy(s.name).slice(0, 120), words: s.words, updatedAt: s.updatedAt };
    const i = next.findIndex((x) => x.id === s.id);
    if (i >= 0) next[i] = normalized;
    else next.push(normalized);
  }
  const changed = next.length !== sets.length || incoming.length > 0 || removed.size > 0;
  if (changed && !persistSets(next)) throw Error("세트를 저장하지 못했어요. 저장 공간을 확인하세요.");
  for (const id of removed) {
    try {
      localStorage.removeItem("daily_vocab_missed_" + id);
    } catch {}
  }
  family.setsAcked = Object.fromEntries(
    (Array.isArray(data?.summary) ? data.summary : []).filter((s) => s && typeof s.id === "string" && typeof s.updatedAt === "string").map((s) => [s.id, s.updatedAt]),
  );
  family.setsDeleted = family.setsDeleted.filter((d) => !sentDeleted.some((x) => x.id === d.id && x.deletedAt === d.deletedAt));
  family.setsSyncedAt = new Date().toISOString();
  family.setsError = "";
  writeFamily();
  if (changed) selectSet(sets.some((s) => s.id === activeSetId) ? activeSetId : sets[0]?.id ?? null); // WORDS·범위·기록 필터를 새 세트 목록으로
}

// ---- 아이 기기: 아이 코드·전용 링크로 연결 ----
// 전용 링크(…/?child=483921)로 열렸으면 코드를 꺼내고 주소에서 지운다.
function linkCodeFromUrl() {
  try {
    const u = new URL(location.href);
    const fromHash = /child=(\d{6})/.exec(u.hash);
    const raw = u.searchParams.get("child") || (fromHash ? fromHash[1] : "");
    if (u.searchParams.has("child") || fromHash) {
      u.searchParams.delete("child");
      u.hash = u.hash.replace(/#?child=\d+/, "");
      history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    }
    const code = String(raw || "").replace(/\D/g, "");
    return JOIN_CODE_PATTERN.test(code) ? code : "";
  } catch {
    return "";
  }
}
async function joinChild(code) {
  code = String(code || "").replace(/\D/g, "");
  if (!JOIN_CODE_PATTERN.test(code)) {
    setFeedback($("familyStatus"), "bad", "아이 코드는 숫자 6자리예요. 보호자 폰의 아이들 탭에서 확인하세요.");
    return false;
  }
  const passcode = syncPasscode();
  if (!passcode) {
    family.pendingCode = code;
    writeFamily();
    $("childCode").value = code;
    $("aiSettings").open = true; // 접속 코드를 넣을 곳을 바로 보여 준다
    renderFamilySettings();
    setFeedback($("familyStatus"), "bad", `아이 코드 ${formatCode(code)}을(를) 연결하려면 먼저 위의 ‘보호자 설정 · AI 연결’에서 접속 코드를 저장하세요. 저장하면 바로 연결돼요.`);
    return false;
  }
  $("joinChild").disabled = true;
  setFeedback($("familyStatus"), "info", "아이 코드를 확인하는 중…");
  try {
    const data = await familyRequest("/join", { body: { code, device: { id: ensureDeviceId(), label: deviceLabel() } }, passcode });
    const switching = family.childId && family.childId !== data.childId;
    family.childId = data.childId;
    family.childName = tidy(data.name).slice(0, 20) || "아이";
    family.joinCode = code;
    family.pendingCode = "";
    family.sendEnabled = true;
    family.lastError = "";
    family.pending = [...new Set([...historyRecords.map((r) => r.id), ...family.pending])]; // 연결하면 지금까지의 기록도 함께 보낸다
    writeFamily();
    applySettings(data); // 연결 응답에 제한 시간 등 보호자 설정이 함께 온다
    if (switching || daily.childId !== family.childId) {
      daily = emptyDaily();
      writeDaily();
    }
    if (switching) family = { ...family, setsAcked: {}, setsDeleted: [], setsSyncedAt: "", setsError: "" }; // 새 아이의 세트와 처음부터 맞춘다
    $("childCode").value = "";
    $("familySend").checked = true;
    renderFamilySettings(`이 기기를 ‘${family.childName}’의 기기로 연결했어요. 기록을 보내는 중…`);
    flushFamilySync({ force: true });
    checkDaily({ force: true });
    syncSets({ force: true }); // 이 아이의 세트를 받고 이 기기의 세트를 올린다
    return true;
  } catch (e) {
    setFeedback(
      $("familyStatus"),
      "bad",
      e.code === "unknown_code" ? "그 아이 코드를 찾을 수 없어요. 보호자 폰의 아이들 탭에서 코드를 다시 확인해 주세요." : "연결 실패: " + e.message,
    );
    return false;
  } finally {
    $("joinChild").disabled = false;
  }
}
async function handleLinkCode(code) {
  if (isLinked() && family.joinCode === code) {
    renderFamilySettings();
    fetchSettings({ force: true });
    checkDaily({ ignoreThrottle: true });
    syncSets({ force: true });
    return;
  }
  if (isLinked() && !confirm(`이 기기는 이미 ‘${family.childName}’의 기기로 연결되어 있어요. 링크의 아이로 바꿀까요? 지금까지의 기록은 각자에게 남고, 이 기기의 세트는 링크의 아이 세트와 합쳐져요.`)) return;
  showView("settings");
  $("familySettings").open = true;
  $("childCode").value = code;
  $("familySettings").scrollIntoView({ behavior: "smooth", block: "start" });
  await joinChild(code);
}
// sets.js 가 접속 코드를 저장한 뒤 부른다: 링크로 받아 둔 아이 코드가 있으면 바로 연결한다.
function onAiSettingsSaved() {
  renderFamilySettings();
  if (family.pendingCode && syncPasscode()) joinChild(family.pendingCode);
}
$("joinChild").onclick = () => joinChild($("childCode").value);
$("childCode").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("joinChild").click();
});
$("unlinkChild").onclick = () => {
  if (!isLinked()) return;
  if (!confirm(`이 기기를 ‘${family.childName}’에서 연결 해제할까요? 이 기기의 세트와 기록은 그대로 남고, 서버에 보낸 기록도 지워지지 않아요.`)) return;
  family = {
    ...family, childId: "", childName: "", joinCode: "", pendingCode: "", sendEnabled: false, pending: [], lastError: "",
    setsAcked: {}, setsDeleted: [], setsSyncedAt: "", setsError: "", settings: { timeLimitSec: 0, fetchedAt: "" },
  };
  writeFamily();
  daily = emptyDaily();
  writeDaily();
  $("familySend").checked = false;
  renderFamilySettings("연결을 해제했어요. 다시 연결하려면 아이 코드를 넣으세요.");
  renderDailyCard();
};

// ---- 아이 기기: 오늘의 단어 ----
function emptyDaily() {
  return { childId: "", date: "", words: [], level: "", note: "", fetchedAt: "", result: null, disabled: false, lastCheckedAt: "", lastError: "" };
}
function readDaily() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(DAILY_KEY) || "null");
  } catch {}
  const d = { ...emptyDaily(), ...(saved && typeof saved === "object" ? saved : {}) };
  d.words = Array.isArray(d.words) ? d.words.filter((w) => w && typeof w.en === "string" && typeof w.ko === "string") : [];
  return d;
}
let daily = readDaily();
let dailyChecking = false;
function writeDaily() {
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(daily));
  } catch {}
}
const todayKey = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
};
const dailyLabel = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const resultFrom = (completed) =>
  completed ? { id: completed.recordId, correct: completed.correct, total: completed.total, completedAt: completed.completedAt } : null;
// 앱 시작·화면 복귀·연결 때. 오늘 것이 기기에 있으면 서버에 묻지 않고(다른 기기의 완료만 가끔 확인), 없으면 받고, 아직 없으면 만들어 달라고 한다.
async function checkDaily(options = {}) {
  const today = todayKey();
  if (dailyChecking || !syncReady()) {
    renderDailyCard();
    return;
  }
  const fresh = daily.childId === family.childId && daily.date === today;
  const throttled = Boolean(daily.lastCheckedAt) && Date.now() - Date.parse(daily.lastCheckedAt) < DAILY_CHECK_MS;
  if (fresh && !options.force && daily.words.length && (daily.result || throttled || options.ignoreThrottle)) {
    renderDailyCard();
    return;
  }
  if (fresh && !options.force && !options.ignoreThrottle && !daily.words.length && throttled) {
    renderDailyCard();
    return;
  }
  dailyChecking = true;
  const now = new Date().toISOString();
  try {
    let data;
    try {
      data = await familyRequest("/daily/" + encodeURIComponent(family.childId) + "?date=" + today, { method: "GET", passcode: syncPasscode() });
    } catch (e) {
      if (e.code === "no_daily")
        data = await familyRequest("/daily/" + encodeURIComponent(family.childId), { method: "POST", body: { date: today }, passcode: syncPasscode(), timeout: DAILY_TIMEOUT_MS });
      else if (e.code === "plan_disabled") {
        daily = { ...emptyDaily(), childId: family.childId, date: today, disabled: true, lastCheckedAt: now };
        writeDaily();
        return;
      } else if (e.code === "unknown_child") {
        // 보호자가 서버에서 지운 경우: 다시 등록을 시도한다
        daily = { ...emptyDaily(), childId: family.childId, date: today, lastCheckedAt: now, lastError: e.message };
        writeDaily();
        flushFamilySync({ force: true });
        return;
      } else throw e;
    }
    const words = (Array.isArray(data?.words) ? data.words : []).filter((w) => w && typeof w.en === "string" && typeof w.ko === "string");
    daily = {
      ...emptyDaily(),
      childId: family.childId,
      date: typeof data.date === "string" ? data.date : today,
      words,
      level: typeof data.level === "string" ? data.level : "",
      note: typeof data.note === "string" ? data.note : "",
      fetchedAt: now,
      lastCheckedAt: now,
      result: (fresh && daily.result) || resultFrom(data.completed), // 다른 기기에서 풀었으면 그 결과를 보여 준다
    };
    writeDaily();
  } catch (e) {
    daily = { ...daily, childId: family.childId, date: fresh ? daily.date : today, lastCheckedAt: now, lastError: e?.message || String(e) };
    writeDaily();
  } finally {
    dailyChecking = false;
    renderDailyCard();
  }
}
function noteDailyResult(record) {
  if (record.partial || record.daily !== daily.date) return;
  const correct = record.results.filter((x) => x.pass).length;
  daily.result = { id: record.id, correct, total: record.results.length, completedAt: record.completedAt };
  writeDaily();
  renderDailyCard();
}
function renderDailyCard() {
  const card = $("dailyCard");
  const show = syncReady() && !daily.disabled && daily.childId === family.childId && daily.date === todayKey() && daily.words.length > 0;
  card.classList.toggle("hidden", !show);
  if (!show) return;
  const total = daily.words.length, review = daily.words.filter((w) => w.kind === "review").length;
  const label = dailyLabel(daily.date);
  if (daily.result) {
    const wrong = daily.result.total - daily.result.correct;
    $("dailyTitle").textContent = `✅ 오늘의 단어 ${label} 끝!`;
    $("dailyText").textContent = `${daily.result.correct} / ${daily.result.total} 맞았어요` + (wrong ? ` · 틀린 단어 ${wrong}개는 내일 복습에 나와요` : " · 모두 정답 🎉");
    $("startDaily").textContent = "한 번 더 풀기";
  } else {
    $("dailyTitle").textContent = `📬 오늘의 단어 ${label}`;
    $("dailyText").textContent = `새 단어 ${total - review}개` + (review ? ` + 복습 ${review}개` : "") + (daily.level ? ` · ${daily.level}` : "");
    $("startDaily").textContent = "▶ 풀기";
  }
  $("startDaily").disabled = sessionRunning;
}
$("startDaily").onclick = () => {
  if (!daily.words.length || sessionRunning) return;
  const words = daily.words.map((w, i) => ({
    id: Number.isInteger(w.id) ? w.id : i + 1,
    en: w.en,
    ko: w.ko,
    ipa: typeof w.ipa === "string" ? w.ipa : "",
    hangul: "",
    aliases: Array.isArray(w.aliases) ? w.aliases.filter((a) => typeof a === "string") : [],
  }));
  newSession(false, words, { setId: "daily:" + daily.date, setName: "오늘의 단어 " + dailyLabel(daily.date) }, { rangeLabel: "오늘의 단어", daily: daily.date });
};

// ---- 설정 화면(아이 기기 + 보호자 폰) ----
function renderFamilySettings(progress) {
  const linked = isLinked();
  $("joinBox").classList.toggle("hidden", linked);
  $("linkedBox").classList.toggle("hidden", !linked);
  if (linked) {
    $("childName").textContent = family.childName;
    $("deviceLabelText").textContent = deviceLabel();
    $("setsSyncText").textContent = setsSyncInFlight
      ? "세트를 보호자·다른 기기와 맞추는 중…"
      : family.setsError
        ? "세트를 맞추지 못했어요: " + family.setsError
        : family.setsSyncedAt
          ? `세트 ${sets.length}개 · 보호자·다른 기기와 같은 세트 (마지막 확인 ${new Date(family.setsSyncedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })})`
          : "세트는 아직 맞추지 않았어요. 인터넷이 되면 자동으로 보호자·다른 기기와 같아져요.";
  }
  const pill = $("familyState");
  pill.textContent = !linked ? "연결 안 됨" : !family.sendEnabled ? "꺼짐" : family.pending.length ? `보낼 기록 ${family.pending.length}개` : syncInFlight ? "보내는 중" : "기록 보내기 켜짐";
  $("syncNow").disabled = !syncReady() || syncInFlight;
  let text = progress || "", type = "info";
  if (!text) {
    if (!linked)
      text = family.pendingCode
        ? `아이 코드 ${formatCode(family.pendingCode)}을(를) 연결하려면 먼저 위의 ‘보호자 설정 · AI 연결’에서 접속 코드를 저장하세요.`
        : "보호자 폰의 아이들 탭에서 만든 아이 코드 6자리를 넣고 ‘연결’을 누르세요. 아이 전용 링크를 열어도 돼요.";
    else if (!family.sendEnabled) text = "연결은 되어 있지만 보내기가 꺼져 있어요. 스위치를 켜고 저장하면 시험을 마칠 때마다 기록을 보내요.";
    else if (!syncPasscode()) {
      text = "보내려면 먼저 위의 ‘보호자 설정 · AI 연결’에서 접속 코드를 저장하세요.";
      type = "bad";
    } else {
      text =
        (family.lastSyncAt ? "마지막 전송: " + new Date(family.lastSyncAt).toLocaleString("ko-KR") : "아직 보낸 기록이 없어요") +
        (family.pending.length ? ` · 못 보낸 기록 ${family.pending.length}개 (다음에 앱을 열 때 다시 보내요)` : " · 보낼 기록 없음");
      if (family.lastError) {
        text += " · 마지막 오류: " + family.lastError;
        type = "bad";
      }
    }
  }
  setFeedback($("familyStatus"), type, text);
  $("parentState").textContent = family.parentCode ? "보호자 코드 저장됨" : "";
  $("clearParent").disabled = !family.parentCode;
  applyParentMode();
}
$("saveFamily").onclick = () => {
  if (!isLinked()) return;
  const enable = $("familySend").checked;
  if (enable && !syncPasscode()) {
    setFeedback($("familyStatus"), "bad", "먼저 위의 ‘보호자 설정 · AI 연결’에서 접속 코드를 저장하세요.");
    return;
  }
  const turningOn = enable && !family.sendEnabled;
  family.sendEnabled = enable;
  family.lastError = "";
  if (turningOn) family.pending = [...new Set([...historyRecords.map((r) => r.id), ...family.pending])]; // 다시 켤 때는 그동안의 기록도 함께 보낸다
  if (!writeFamily()) {
    setFeedback($("familyStatus"), "bad", "저장 실패: 브라우저 저장 공간을 확인하세요.");
    return;
  }
  if (enable) {
    flushFamilySync({ force: true });
    checkDaily({ force: true });
    syncSets({ force: true });
  } else {
    renderFamilySettings("저장했어요. 이제 기록을 보내지 않아요.");
    renderDailyCard();
  }
};
$("syncNow").onclick = () => {
  flushFamilySync({ force: true });
  syncSets({ force: true });
};
// 보호자 코드 저장(설정의 보호자 폰 칸과 보호자 모드 첫 화면이 함께 쓴다). 저장되면 보호자 모드로 바뀌고 아이들 화면으로 간다.
async function saveParentCode(input, button, status) {
  const code = input.value.trim();
  if (code.length < 4) {
    setFeedback(status, "bad", "보호자 코드를 4자 이상 입력하세요.");
    return;
  }
  family.parentCode = code;
  family.parentModeOff = false;
  if (!writeFamily()) {
    setFeedback(status, "bad", "저장 실패: 브라우저 저장 공간을 확인하세요.");
    return;
  }
  input.value = "";
  renderFamilySettings();
  if (typeof renderAiSettings === "function") renderAiSettings(); // 보호자 코드로 사진 인식도 쓸 수 있다
  setFeedback(status, "info", "저장했어요. 아이들 기록을 확인하는 중…");
  button.disabled = true;
  try {
    const data = await familyRequest("/family", { method: "GET", passcode: code });
    cacheFamily(data);
    setFeedback(status, "good", `연결 성공 · 등록된 아이 ${familyData.children.length}명. 보호자 모드로 바뀌었어요.`);
    showView("family");
  } catch (e) {
    setFeedback(status, "bad", "연결 실패: " + e.message);
    if (currentView === "family") renderFamily();
  } finally {
    button.disabled = false;
  }
}
$("saveParent").onclick = () => saveParentCode($("parentCode"), $("saveParent"), $("parentStatus"));
$("saveParentStart").onclick = () => saveParentCode($("parentCodeStart"), $("saveParentStart"), $("parentSetupStatus"));
$("parentCodeStart").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("saveParentStart").click();
});
$("parentModeOff").onchange = () => {
  family.parentModeOff = $("parentModeOff").checked;
  writeFamily();
  applyParentMode();
  showView(family.parentModeOff ? "home" : "family");
};
$("clearParent").onclick = () => {
  family.parentCode = "";
  family.parentModeOff = false;
  writeFamily();
  if (typeof renderAiSettings === "function") renderAiSettings();
  familyData = null;
  try {
    localStorage.removeItem(FAMILY_CACHE_KEY);
  } catch {}
  renderFamilySettings();
  setFeedback($("parentStatus"), "info", appMode === "parent" ? "보호자 코드를 삭제했어요. 아이들 화면에서 다시 입력할 수 있어요." : "보호자 코드를 삭제했어요. ‘아이들’ 탭이 사라져요.");
  if (currentView === "family") showView(isParentMode() ? "family" : "settings");
  else if (isParentMode()) renderFamily();
};

// ---- 보호자 폰: 아이들 화면 ----
let familyData = null; // 마지막 /family 응답 {children, serverTime, fetchedAt}
let familyDetail = null; // 열어 둔 아이 {child, records, today}
let familyLoading = false;
function cacheFamily(data) {
  familyData = { children: Array.isArray(data?.children) ? data.children : [], serverTime: data?.serverTime || "", fetchedAt: new Date().toISOString() };
  try {
    localStorage.setItem(FAMILY_CACHE_KEY, JSON.stringify(familyData));
  } catch {}
}
function loadFamilyCache() {
  if (familyData) return;
  try {
    const cached = JSON.parse(localStorage.getItem(FAMILY_CACHE_KEY) || "null");
    if (cached && Array.isArray(cached.children)) familyData = cached;
  } catch {}
}
// 목록 캐시 안의 아이 하나를 바꾼다(이름·코드·기기 갱신 뒤).
function updateCachedChild(child) {
  if (!familyData) return;
  cacheFamily({ ...familyData, children: familyData.children.map((c) => (c.id === child.id ? { ...c, ...child, records: c.records, today: child.today ?? c.today } : c)) });
}
async function refreshFamily() {
  if (!family.parentCode || familyLoading) return;
  familyLoading = true;
  $("refreshFamily").disabled = true;
  setFeedback($("familyLoadStatus"), "info", "아이들 기록을 불러오는 중…");
  try {
    cacheFamily(await familyRequest("/family", { method: "GET", passcode: family.parentCode }));
    renderChildren();
    setFeedback($("familyLoadStatus"), "info", "방금 확인했어요 · " + new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }));
  } catch (e) {
    setFeedback($("familyLoadStatus"), "bad", e.message + (familyData ? " · 마지막으로 확인한 내용을 보여 줘요." : ""));
  } finally {
    familyLoading = false;
    $("refreshFamily").disabled = false;
  }
}
// showView("family") 가 부른다: 보호자 코드가 없으면 코드 입력 화면만, 있으면 캐시를 먼저 그리고 새로 불러온다.
function renderFamily() {
  const hasCode = Boolean(family.parentCode);
  $("parentSetup").classList.toggle("hidden", hasCode);
  $("familyMain").classList.toggle("hidden", !hasCode);
  $("childrenCard").classList.toggle("hidden", !hasCode);
  $("childDetail").classList.add("hidden");
  familyDetail = null;
  if (!hasCode) {
    setFeedback($("parentSetupStatus"), "info", "");
    return;
  }
  loadFamilyCache();
  renderChildren();
  refreshFamily();
}
// 오늘 한눈에: 아이별 한 줄(오늘 시험·오늘의 단어·이번 주·경고). 누르면 상세.
function renderOverview() {
  const box = $("familyOverview");
  box.textContent = "";
  if (!familyData) {
    box.textContent = "아직 불러온 기록이 없어요.";
    return;
  }
  if (!familyData.children.length) {
    box.textContent = "아직 등록된 아이가 없어요. 아래 ‘아이 추가’에서 아이를 만들어 주세요.";
    return;
  }
  for (const c of familyData.children) {
    const info = describeChild(c);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "overview-row";
    row.addEventListener("click", () => openChild(c));
    const name = document.createElement("span");
    name.className = "ov-name";
    name.textContent = "🧒 " + c.name;
    const main = document.createElement("span");
    main.className = "ov-main";
    const todayAvg = info.todays.length ? Math.round(info.todays.reduce((s, r) => s + pctOf(r), 0) / info.todays.length) : null;
    const dailyText = planOf(c).enabled
      ? c.today?.completed
        ? ` · 오늘의 단어 ✅ ${c.today.completed.correct}/${c.today.completed.total}`
        : c.today?.exists
          ? " · 오늘의 단어 📬 아직"
          : " · 오늘의 단어 –"
      : "";
    main.textContent = (info.todays.length ? `오늘 시험 ✅ ${info.todays.length}회 · ${todayAvg}점` : "오늘 시험 ⬜ 아직") + dailyText;
    const sub = document.createElement("span");
    sub.className = "ov-sub";
    sub.textContent = info.week.length ? `이번 주 ${info.week.length}회 · 평균 ${info.weekAvg}점 · 마지막 ${info.latest ? relativeTime(info.latest.completedAt) : "-"}` : "이번 주 시험 없음";
    const warn = document.createElement("span");
    warn.className = "ov-warn";
    const awayToday = info.todays.reduce((s, r) => s + (r.awayCount || 0), 0);
    const timeoutsToday = info.todays.reduce((s, r) => s + (r.timeouts || 0), 0);
    const warnings = [awayToday ? `⚠️ 화면 이탈 ${awayToday}회` : "", timeoutsToday ? `⏱ 시간 초과 ${timeoutsToday}개` : ""].filter(Boolean);
    warn.textContent = warnings.join(" · ");
    warn.classList.toggle("hidden", !warnings.length);
    row.append(name, main, sub, warn);
    box.append(row);
  }
}
// 자주 틀린 단어: 최근 2주 기록의 틀린 단어를 세어 상위 10개.
function missedTop(records, days = 14) {
  const since = Date.now() - days * 86400000;
  const counts = new Map();
  for (const r of records) {
    if (!(Date.parse(r.completedAt) >= since)) continue;
    for (const m of Array.isArray(r.missed) ? r.missed : []) {
      const key = String(m.en || "").toLowerCase();
      if (!key) continue;
      const entry = counts.get(key) || { en: m.en, ko: m.ko, n: 0 };
      entry.n++;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.en.localeCompare(b.en)).slice(0, 10);
}
function renderMissedTop(records) {
  const box = $("missedTop");
  box.textContent = "";
  const top = missedTop(records);
  if (!top.length) {
    box.textContent = "최근 2주 동안 틀린 단어가 없어요.";
    return;
  }
  for (const w of top) {
    const chip = document.createElement("span");
    chip.className = "chip";
    const en = document.createElement("span");
    en.textContent = w.en;
    const n = document.createElement("b");
    n.textContent = `${w.n}회`;
    const ko = document.createElement("small");
    ko.textContent = w.ko || "";
    chip.append(en, n, ko);
    box.append(chip);
  }
}
// 오늘·최근 7일은 이 폰의 현지 날짜로 센다(서버는 한국 시각으로 저장).
const dayKey = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : [d.getFullYear(), d.getMonth() + 1, d.getDate()].join("-");
};
const pctOf = (r) => (r.total ? Math.round((r.correct / r.total) * 100) : 0);
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
function planOf(child) {
  return { enabled: false, level: "중2 상위권", dailyCount: 10, hour: 16, timeLimitSec: 0, ...(child?.plan || {}) };
}
const TIME_LIMIT_CHOICES = [0, 10, 15, 20, 30, 45, 60];
const timeLimitLabel = (s) => (s ? `${s}초` : "없음");
function dailyStatusText(c) {
  const plan = planOf(c);
  if (!plan.enabled) return "오늘의 단어: 꺼짐";
  const t = c.today;
  if (t?.completed) return `오늘의 단어 ✅ ${t.completed.correct} / ${t.completed.total}`;
  if (t?.exists) return "오늘의 단어 📬 도착 · 아직 안 풀었어요";
  return `오늘의 단어: 아직 없음 (${hourLabel(plan.hour)}에 만들어요)`;
}
function devicesSummary(devices) {
  const counts = new Map();
  for (const d of Object.values(devices || {})) counts.set(d.label || "기기", (counts.get(d.label || "기기") || 0) + 1);
  return [...counts].map(([label, n]) => `${label} ${n}`).join(" · ");
}
function describeChild(c) {
  const records = (Array.isArray(c.records) ? c.records : []).slice().sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    const mine = records.filter((r) => dayKey(r.completedAt) === key);
    days.push({ key, weekday: WEEKDAYS[d.getDay()], count: mine.length, avg: mine.length ? Math.round(mine.reduce((s, r) => s + pctOf(r), 0) / mine.length) : null });
  }
  const week = records.filter((r) => days.some((d) => d.key === dayKey(r.completedAt)));
  return {
    records,
    todays: records.filter((r) => dayKey(r.completedAt) === days[6].key),
    days,
    week,
    weekAvg: week.length ? Math.round(week.reduce((s, r) => s + pctOf(r), 0) / week.length) : null,
    latest: records[0] || null,
  };
}
function renderChildren() {
  renderOverview();
  const list = $("childrenList");
  list.textContent = "";
  if (!familyData) {
    list.textContent = "아직 불러온 기록이 없어요.";
    return;
  }
  if (!familyData.children.length) {
    list.textContent = "아직 등록된 아이가 없어요. 아래 ‘아이 추가’에 이름을 적어 아이를 만들고, 받은 아이 코드를 아이 기기에 넣어 주세요.";
    return;
  }
  for (const c of familyData.children) {
    const info = describeChild(c);
    const card = document.createElement("article");
    card.className = "child-card";
    const head = document.createElement("div");
    head.className = "child-head";
    const name = document.createElement("strong");
    name.className = "child-name";
    name.textContent = "🧒 " + c.name;
    const today = document.createElement("span");
    today.className = "pill " + (info.todays.length ? "ok" : "warn");
    today.textContent = info.todays.length ? `오늘 ✅ ${info.todays.length}회` : "오늘 아직 안 했어요";
    head.append(name, today);
    const last = document.createElement("p");
    last.className = "muted";
    last.textContent = info.latest
      ? `마지막 시험: ${relativeTime(info.latest.completedAt)} · ${info.latest.setName} · ${pctOf(info.latest)}점${info.latest.partial ? " (중단)" : ""}`
      : "아직 시험 기록이 없어요.";
    const devices = document.createElement("p");
    devices.className = "muted device-line";
    const summary = devicesSummary(c.devices);
    devices.textContent = summary ? "연결 기기: " + summary : c.joinCode ? `아직 연결된 기기 없음 · 아이 코드 ${formatCode(c.joinCode)}` : "연결된 기기 정보 없음";
    const dailyLine = document.createElement("p");
    dailyLine.className = "muted daily-line";
    dailyLine.textContent = dailyStatusText(c);
    const awayToday = info.todays.reduce((s, r) => s + (r.awayCount || 0), 0);
    const awayLine = document.createElement("p");
    awayLine.className = "away-flag";
    awayLine.textContent = awayToday ? `⚠️ 오늘 화면 이탈 ${awayToday}회 (문제 중 앱이 가려짐)` : "";
    awayLine.classList.toggle("hidden", !awayToday);
    const dots = document.createElement("div");
    dots.className = "week-dots";
    dots.setAttribute("aria-label", "최근 7일 시험");
    for (const d of info.days) {
      const day = document.createElement("span");
      day.className = "day" + (d.count ? " done" : "") + (d.key === info.days[6].key ? " today" : "");
      const weekday = document.createElement("small");
      weekday.textContent = d.weekday;
      const mark = document.createElement("b");
      mark.textContent = d.count ? `${d.avg}점` : "·";
      day.title = d.count ? `${d.key}: ${d.count}회 · 평균 ${d.avg}점` : `${d.key}: 시험 없음`;
      day.append(weekday, mark);
      dots.append(day);
    }
    const week = document.createElement("p");
    week.className = "muted";
    week.textContent = info.week.length ? `최근 7일 ${info.week.length}회 · 평균 ${info.weekAvg}점` : "최근 7일 동안 시험을 보지 않았어요.";
    const actions = document.createElement("div");
    actions.className = "actionbar";
    const detail = document.createElement("button");
    detail.type = "button";
    detail.className = "btn small";
    detail.textContent = summary ? "기록 자세히 보기" : "연결 코드·설정 보기";
    detail.addEventListener("click", () => openChild(c));
    actions.append(detail);
    card.append(head, last, devices, dailyLine, awayLine, dots, week, actions);
    list.append(card);
  }
}
$("addChild").onclick = async () => {
  const name = tidy($("newChildName").value).slice(0, 20);
  if (!name) {
    setFeedback($("addChildStatus"), "bad", "아이 이름을 적어 주세요.");
    return;
  }
  $("addChild").disabled = true;
  setFeedback($("addChildStatus"), "info", "아이를 만드는 중…");
  try {
    const data = await familyRequest("/family/children", { method: "POST", body: { name }, passcode: family.parentCode });
    const child = { ...data.child, records: [], today: null };
    $("newChildName").value = "";
    cacheFamily({ ...(familyData || { children: [] }), children: [...(familyData?.children || []), child] });
    renderChildren();
    setFeedback($("addChildStatus"), "good", `‘${child.name}’을(를) 만들었어요. 아이 코드 ${formatCode(child.joinCode)} · 아래에서 링크를 복사해 아이 기기로 보내세요.`);
    openChild(child);
  } catch (e) {
    setFeedback($("addChildStatus"), "bad", "만들지 못했어요: " + e.message);
  } finally {
    $("addChild").disabled = false;
  }
};
async function openChild(c) {
  const summaryToday = c.today ? { date: c.today.date, exists: c.today.exists, words: [], note: "", completed: c.today.completed || null } : null;
  familyDetail = { child: c, records: Array.isArray(c.records) ? c.records : [], today: summaryToday };
  $("childDetail").classList.remove("hidden");
  $("childDetailTitle").textContent = "🧒 " + c.name;
  renderLinkBox(c);
  renderChildSets(c);
  renderPlan(c, summaryToday);
  setFeedback($("planStatus"), "info", "");
  setFeedback($("linkStatus"), "info", "");
  setFeedback($("setsStatus"), "info", "");
  renderChildRecords("전체 기록을 불러오는 중…");
  $("childDetail").scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const data = await familyRequest("/family/" + encodeURIComponent(c.id), { method: "GET", passcode: family.parentCode });
    if (familyDetail?.child.id !== c.id) return;
    familyDetail = { child: data.child || c, records: Array.isArray(data.records) ? data.records : [], today: data.today || summaryToday };
    renderLinkBox(familyDetail.child);
    renderChildSets(familyDetail.child);
    renderPlan(familyDetail.child, familyDetail.today);
    renderChildRecords();
  } catch (e) {
    if (familyDetail?.child.id === c.id) renderChildRecords("전체 기록을 불러오지 못했어요: " + e.message + " · 최근 기록만 보여 줘요.");
  }
}
function renderLinkBox(child) {
  const code = JOIN_CODE_PATTERN.test(child.joinCode || "") ? child.joinCode : "";
  $("childCodeText").textContent = code ? formatCode(code) : "(없음 · ‘코드 새로 만들기’를 누르세요)";
  $("childLinkText").textContent = code ? linkFor(code) : "";
  $("copyLink").disabled = !code;
  $("copyCode").disabled = !code;
  $("renameChild").value = child.name || "";
  const devices = Object.values(child.devices || {}).sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
  $("deviceList").textContent = devices.length
    ? "연결된 기기: " + devices.map((d) => `${d.label || "기기"} (${relativeTime(d.lastSeenAt)})`).join(" · ")
    : "아직 연결된 기기가 없어요. 아이 기기에서 코드를 넣거나 링크를 열어 주세요.";
}
async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    setFeedback($("linkStatus"), "good", `${label}을(를) 복사했어요. 카톡 등으로 아이 기기에 보내 주세요.`);
  } catch {
    setFeedback($("linkStatus"), "info", `${label}: ${text} (길게 눌러 복사하세요)`);
  }
}
$("copyLink").onclick = () => familyDetail?.child.joinCode && copyText(linkFor(familyDetail.child.joinCode), "아이 전용 링크");
$("copyCode").onclick = () => familyDetail?.child.joinCode && copyText(familyDetail.child.joinCode, "아이 코드");
$("regenCode").onclick = async () => {
  const c = familyDetail?.child;
  if (!c) return;
  if (!confirm("아이 코드를 새로 만들면 옛 코드와 옛 링크로는 더 연결할 수 없어요. 이미 연결된 기기는 그대로예요. 새로 만들까요?")) return;
  $("regenCode").disabled = true;
  try {
    const data = await familyRequest("/family/" + encodeURIComponent(c.id) + "/code", { method: "POST", body: {}, passcode: family.parentCode });
    familyDetail.child = { ...c, ...(data.child || {}) };
    updateCachedChild(familyDetail.child);
    renderLinkBox(familyDetail.child);
    renderChildren();
    setFeedback($("linkStatus"), "good", `새 아이 코드 ${formatCode(familyDetail.child.joinCode)}을(를) 만들었어요.`);
  } catch (e) {
    setFeedback($("linkStatus"), "bad", "코드를 만들지 못했어요: " + e.message);
  } finally {
    $("regenCode").disabled = false;
  }
};
$("saveChildName").onclick = async () => {
  const c = familyDetail?.child;
  if (!c) return;
  const name = tidy($("renameChild").value).slice(0, 20);
  if (!name) {
    setFeedback($("linkStatus"), "bad", "이름을 적어 주세요.");
    return;
  }
  $("saveChildName").disabled = true;
  try {
    const data = await familyRequest("/family/" + encodeURIComponent(c.id) + "/name", { method: "POST", body: { name }, passcode: family.parentCode });
    familyDetail.child = { ...c, ...(data.child || {}), name: data.child?.name || name };
    updateCachedChild(familyDetail.child);
    $("childDetailTitle").textContent = "🧒 " + familyDetail.child.name;
    renderLinkBox(familyDetail.child);
    renderChildren();
    setFeedback($("linkStatus"), "good", `이름을 ‘${familyDetail.child.name}’(으)로 바꿨어요. 아이 기기에는 다음 전송 때 반영돼요.`);
  } catch (e) {
    setFeedback($("linkStatus"), "bad", "이름을 바꾸지 못했어요: " + e.message);
  } finally {
    $("saveChildName").disabled = false;
  }
};
function renderChildRecords(note) {
  const { child, records } = familyDetail;
  const sorted = records.slice().sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  const avg = sorted.length ? Math.round(sorted.reduce((s, r) => s + pctOf(r), 0) / sorted.length) : 0;
  const setCount = Array.isArray(child.sets) ? child.sets.length : 0;
  $("childDetailSummary").textContent = `시험 ${sorted.length}회` + (sorted.length ? ` · 평균 ${avg}점` : "") + ` · 세트 ${setCount}개` + (note ? " · " + note : "");
  renderMissedTop(sorted);
  const list = $("childRecords");
  list.textContent = "";
  if (!sorted.length) {
    list.textContent = "아직 시험 기록이 없어요.";
    return;
  }
  for (const r of sorted) {
    const entry = document.createElement("article");
    entry.className = "history-entry";
    const head = document.createElement("div");
    head.className = "history-head";
    const score = document.createElement("span");
    score.className = "history-score";
    score.textContent = `${r.correct} / ${r.total} · ${pctOf(r)}점${r.partial ? " · 중단" : ""}${r.daily ? " · 📬 오늘의 단어" : ""}${r.timeouts ? ` · ⏱ 시간 초과 ${r.timeouts}개` : ""}`;
    head.append(score);
    const meta = document.createElement("p");
    meta.className = "history-meta";
    const duration = durationText(r.activeMs);
    meta.textContent = `${new Date(r.completedAt).toLocaleString("ko-KR")} · ${r.setName} · ${modeLabels[r.mode] || r.mode} · ${r.range}` + (duration ? ` · ${duration}` : "");
    entry.append(head, meta);
    if (r.awayCount) {
      const away = document.createElement("p");
      away.className = "away-flag";
      away.textContent = `⚠️ 문제 중 화면 이탈 ${r.awayCount}회 · 총 ${Math.round((r.awayMs || 0) / 1000)}초 (앱이 가려지거나 다른 앱으로 나감)`;
      entry.append(away);
    }
    const missed = Array.isArray(r.missed) ? r.missed : [];
    if (missed.length) {
      const details = document.createElement("details"), summary = document.createElement("summary"), words = document.createElement("p");
      summary.textContent = `틀린 단어 ${missed.length}개 보기`;
      words.textContent = missed.map((m) => `${m.en} — ${m.ko}${m.unknown ? " [모름]" : ""}`).join(" · ");
      details.append(summary, words);
      entry.append(details);
    } else {
      const perfect = document.createElement("p");
      perfect.className = "muted";
      perfect.textContent = "틀린 단어 없음 🎉";
      entry.append(perfect);
    }
    list.append(entry);
  }
}
// ---- 보호자 폰: 아이 세트 (아이 기기와 자동으로 같아짐) ----
// 서버의 세트 요약(child.sets = [{id, name, count, updatedAt}])을 보여 주고, 사진으로 세트를 만들어 보내거나(편집기 재사용) 고치고 지운다.
function renderChildSets(child) {
  const list = $("childSets");
  list.textContent = "";
  const summary = (Array.isArray(child.sets) ? child.sets : []).filter((s) => s && typeof s.name === "string");
  if (!summary.length) {
    list.textContent = "아직 세트가 없어요. 아래 ‘세트 만들어 보내기’로 교재 사진에서 만들어 주면 아이 기기가 다음에 앱을 열 때 들어가요.";
    return;
  }
  for (const s of summary) {
    const row = document.createElement("div");
    row.className = "set-row";
    const name = document.createElement("span");
    name.className = "set-name";
    name.textContent = `${s.name} · ${s.count}단어`;
    const when = document.createElement("small");
    when.className = "muted";
    when.textContent = s.id && s.updatedAt ? relativeTime(s.updatedAt) : "아이 기기가 새 버전으로 보내면 여기서 고칠 수 있어요";
    row.append(name, when);
    if (s.id) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn small";
      edit.textContent = "보기·수정";
      edit.addEventListener("click", () => openChildSet(child, s));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn small outline danger";
      del.textContent = "삭제";
      del.addEventListener("click", () => deleteChildSet(child, s));
      row.append(edit, del);
    }
    list.append(row);
  }
}
async function openChildSet(child, s) {
  setFeedback($("setsStatus"), "info", `‘${s.name}’을(를) 불러오는 중…`);
  try {
    const data = await familyRequest("/family/" + encodeURIComponent(child.id) + "/sets/" + encodeURIComponent(s.id), {
      method: "GET", passcode: family.parentCode, timeout: SETS_TIMEOUT_MS,
    });
    if (!validSyncedSet(data?.set)) throw Error("세트 내용이 올바르지 않아요.");
    setFeedback($("setsStatus"), "info", "");
    openChildSetEditor(child, data.set);
  } catch (e) {
    setFeedback($("setsStatus"), "bad", "세트를 불러오지 못했어요: " + e.message);
  }
}
// 보호자 편집기: sets.js 의 편집 화면을 그대로 쓰되 저장은 기기가 아니라 아이의 세트로 서버에 보낸다(editorForChild).
function openChildSetEditor(child, set) {
  window.editorForChild = { id: child.id, name: child.name };
  openEditor(set ? { id: set.id, name: set.name, words: set.words } : null); // sets.js
}
// sets.js 의 저장 버튼이 보호자 편집 중일 때 부른다.
async function sendSetToChild(set) {
  const target = window.editorForChild;
  if (!target) return;
  $("saveSet").disabled = true;
  $("draftWarnings").textContent = `‘${target.name}’에게 보내는 중…`;
  try {
    const data = await familyRequest("/family/" + encodeURIComponent(target.id) + "/sets", {
      method: "POST", body: { set: { id: set.id, name: set.name, words: set.words } }, passcode: family.parentCode, timeout: SETS_TIMEOUT_MS,
    });
    $("draftWarnings").textContent = "";
    finishEditor(); // sets.js
    returnToChild(Array.isArray(data?.summary) ? data.summary : null);
    setFeedback($("setsStatus"), "good", `‘${set.name}’(${set.words.length}단어)을(를) ${target.name}에게 보냈어요. 아이 기기가 다음에 앱을 열 때 들어가요.`);
  } catch (e) {
    $("draftWarnings").textContent = "보내지 못했어요: " + e.message;
  } finally {
    $("saveSet").disabled = false;
  }
}
// 보호자 편집기를 닫거나 보낸 뒤 아이 상세로 돌아간다(세트 요약을 받았으면 반영).
function returnToChild(summary) {
  const target = window.editorForChild;
  window.editorForChild = null;
  const cached = target ? familyData?.children.find((c) => c.id === target.id) : null;
  if (cached && summary) {
    cached.sets = summary;
    updateCachedChild(cached);
  }
  showView("family");
  if (cached) openChild(cached);
}
async function deleteChildSet(child, s) {
  if (!confirm(`‘${s.name}’ 세트를 ${child.name}의 모든 기기에서 지울까요? 시험 기록은 남아요.`)) return;
  setFeedback($("setsStatus"), "info", "지우는 중…");
  try {
    const data = await familyRequest("/family/" + encodeURIComponent(child.id) + "/sets/" + encodeURIComponent(s.id), { method: "DELETE", passcode: family.parentCode });
    const summary = Array.isArray(data?.summary) ? data.summary : (child.sets || []).filter((x) => x.id !== s.id);
    if (familyDetail?.child.id === child.id) {
      familyDetail.child = { ...familyDetail.child, sets: summary };
      updateCachedChild(familyDetail.child);
      renderChildSets(familyDetail.child);
      renderChildRecords();
    }
    setFeedback($("setsStatus"), "good", `‘${s.name}’을(를) 지웠어요. 아이 기기에서는 다음에 앱을 열 때 사라져요.`);
  } catch (e) {
    setFeedback($("setsStatus"), "bad", "지우지 못했어요: " + e.message);
  }
}
$("sendNewSet").onclick = () => {
  if (familyDetail?.child) openChildSetEditor(familyDetail.child, null);
};
// ---- 보호자 폰: 오늘의 단어 계획 ----
function fillPlanSelects() {
  const level = $("planLevel");
  level.textContent = "";
  for (const l of PLAN_LEVELS) {
    const o = document.createElement("option");
    o.value = l;
    o.textContent = l;
    level.append(o);
  }
  const custom = document.createElement("option");
  custom.value = "__custom";
  custom.textContent = "직접 입력…";
  level.append(custom);
  const count = $("planCount");
  count.textContent = "";
  for (const n of [5, 10, 15, 20]) {
    const o = document.createElement("option");
    o.value = String(n);
    o.textContent = n + "개";
    count.append(o);
  }
  const hour = $("planHour");
  hour.textContent = "";
  for (let h = 0; h < 24; h++) {
    const o = document.createElement("option");
    o.value = String(h);
    o.textContent = hourLabel(h);
    hour.append(o);
  }
  const limit = $("planTimeLimit");
  limit.textContent = "";
  for (const s of TIME_LIMIT_CHOICES) {
    const o = document.createElement("option");
    o.value = String(s);
    o.textContent = timeLimitLabel(s);
    limit.append(o);
  }
}
function renderPlan(child, today) {
  const plan = planOf(child);
  $("planEnabled").checked = plan.enabled;
  const known = PLAN_LEVELS.includes(plan.level);
  $("planLevel").value = known ? plan.level : "__custom";
  $("planLevelCustom").classList.toggle("hidden", known);
  $("planLevelCustom").value = known ? "" : plan.level;
  $("planCount").value = String(plan.dailyCount);
  $("planHour").value = String(plan.hour);
  const limitSelect = $("planTimeLimit");
  if (!TIME_LIMIT_CHOICES.includes(plan.timeLimitSec)) {
    const o = document.createElement("option");
    o.value = String(plan.timeLimitSec);
    o.textContent = timeLimitLabel(plan.timeLimitSec);
    limitSelect.append(o);
  }
  limitSelect.value = String(plan.timeLimitSec);
  const anchor = child.anchor;
  $("planAnchor").textContent = anchor?.words?.length
    ? `수준 기준 세트: ${anchor.setName || "(이름 없음)"} · ${anchor.words.length}단어 (아이 기기가 기록을 보낼 때 최근 세트에서 가져와요)`
    : "수준 기준 세트가 아직 없어요. 아이 기기가 기록을 한 번 보내면 최근 세트의 단어를 수준 기준으로 삼아요.";
  const box = $("dailyPreview");
  box.textContent = "";
  const head = document.createElement("p");
  head.className = "muted";
  if (!plan.enabled) head.textContent = `오늘의 단어가 꺼져 있어요. 켜고 저장하면 매일 ${hourLabel(plan.hour)}에 만들어요.`;
  else if (!today?.exists) head.textContent = `오늘 것은 아직 없어요. ${hourLabel(plan.hour)}에 만들거나 아이가 앱을 열면 바로 만들어요.`;
  else head.textContent = `오늘의 단어 ${today.words.length ? today.words.length + "개" : ""}` + (today.completed ? ` · ✅ ${today.completed.correct} / ${today.completed.total} 맞았어요` : " · 아직 안 풀었어요");
  box.append(head);
  for (const w of today?.words || []) {
    const row = document.createElement("div");
    row.className = "daily-word";
    const tag = document.createElement("span");
    tag.className = "tag" + (w.kind === "review" ? " review" : "");
    tag.textContent = w.kind === "review" ? "복습" : "새";
    const text = document.createElement("span");
    text.textContent = `${w.en} — ${w.ko}`;
    row.append(tag, text);
    box.append(row);
  }
}
$("planLevel").onchange = () => $("planLevelCustom").classList.toggle("hidden", $("planLevel").value !== "__custom");
$("savePlan").onclick = async () => {
  const c = familyDetail?.child;
  if (!c) return;
  const choice = $("planLevel").value;
  const level = choice === "__custom" ? tidy($("planLevelCustom").value).slice(0, 40) : choice;
  if (!level) {
    setFeedback($("planStatus"), "bad", "수준을 고르거나 적어 주세요.");
    return;
  }
  const body = { enabled: $("planEnabled").checked, level, dailyCount: Number($("planCount").value), hour: Number($("planHour").value), timeLimitSec: Number($("planTimeLimit").value) };
  $("savePlan").disabled = true;
  setFeedback($("planStatus"), "info", "저장하는 중…");
  try {
    const data = await familyRequest("/family/" + encodeURIComponent(c.id) + "/plan", { method: "POST", body, passcode: family.parentCode });
    familyDetail.child = { ...c, ...(data.child || {}), plan: data.child?.plan || body };
    updateCachedChild(familyDetail.child);
    renderPlan(familyDetail.child, familyDetail.today);
    renderChildren();
    const limitNote = body.timeLimitSec ? ` 문제당 제한 시간 ${body.timeLimitSec}초는 아이 기기가 다음에 앱을 열 때부터 적용돼요.` : "";
    setFeedback($("planStatus"), "good", (body.enabled ? `저장했어요. 매일 ${hourLabel(body.hour)}에 ${body.dailyCount}개를 만들어요.` : "저장했어요. 오늘의 단어를 만들지 않아요.") + limitNote);
  } catch (e) {
    setFeedback($("planStatus"), "bad", "저장 실패: " + e.message);
  } finally {
    $("savePlan").disabled = false;
  }
};
$("makeDailyNow").onclick = async () => {
  const c = familyDetail?.child;
  if (!c) return;
  $("makeDailyNow").disabled = true;
  setFeedback($("planStatus"), "info", "오늘의 단어를 만드는 중… (10초쯤 걸려요)");
  try {
    const d = await familyRequest("/daily/" + encodeURIComponent(c.id), { method: "POST", body: {}, passcode: family.parentCode, timeout: DAILY_TIMEOUT_MS });
    familyDetail.today = { date: d.date, exists: true, words: Array.isArray(d.words) ? d.words : [], note: d.note || "", completed: d.completed || null };
    renderPlan(familyDetail.child, familyDetail.today);
    setFeedback($("planStatus"), "good", `오늘의 단어 ${familyDetail.today.words.length}개가 준비됐어요.` + (d.note ? " " + d.note : ""));
  } catch (e) {
    setFeedback($("planStatus"), "bad", "만들지 못했어요: " + e.message);
  } finally {
    $("makeDailyNow").disabled = false;
  }
};
$("closeChildDetail").onclick = () => {
  $("childDetail").classList.add("hidden");
  familyDetail = null;
};
$("refreshFamily").onclick = () => refreshFamily();
$("deleteChild").onclick = async () => {
  const c = familyDetail?.child;
  if (!c) return;
  if (!confirm(`‘${c.name}’을(를) 가족 서버에서 지울까요? 기록과 아이 코드가 모두 지워지고 연결된 기기는 다시 연결할 수 없어요. 아이 기기에 있는 기록은 그대로예요.`)) return;
  $("deleteChild").disabled = true;
  try {
    await familyRequest("/family/" + encodeURIComponent(c.id), { method: "DELETE", passcode: family.parentCode });
    $("childDetail").classList.add("hidden");
    familyDetail = null;
    if (familyData) cacheFamily({ ...familyData, children: familyData.children.filter((x) => x.id !== c.id) });
    renderChildren();
    setFeedback($("familyLoadStatus"), "info", `‘${c.name}’을(를) 지웠어요.`);
  } catch (e) {
    setFeedback($("familyLoadStatus"), "bad", "지우지 못했어요: " + e.message);
  } finally {
    $("deleteChild").disabled = false;
  }
};

// sets.js 가 보호자 설정을 준비한 뒤 부른다.
function initFamily() {
  const urlMode = modeFromUrl();
  if (urlMode === "parent" || urlMode === "child") {
    appMode = urlMode === "parent" ? "parent" : "";
    if (urlMode === "child") family.parentModeOff = false;
    try {
      localStorage.setItem(MODE_KEY, appMode);
    } catch {}
    writeFamily();
  }
  $("familySend").checked = family.sendEnabled;
  fillPlanSelects();
  renderFamilySettings();
  renderDailyCard();
  if (isParentMode()) showView("family"); // 보호자 모드는 아이들 화면으로 시작
  const linkCode = linkCodeFromUrl();
  if (linkCode) handleLinkCode(linkCode);
  else {
    if (family.pending.length) flushFamilySync();
    fetchSettings({ force: true }); // 보호자가 바꾼 제한 시간 등을 앱을 열 때 받아 둔다
    checkDaily({ ignoreThrottle: true }); // 앱을 새로 열 때는 10분 제한 없이 확인한다(보호자가 방금 켰을 수 있다)
    syncSets({ force: true }); // 보호자·다른 기기가 바꾼 세트를 받고 이 기기의 변경을 올린다
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (family.pending.length) flushFamilySync();
    fetchSettings();
    checkDaily();
    syncSets();
  });
  window.addEventListener("online", () => {
    if (family.pending.length) flushFamilySync();
    fetchSettings();
    checkDaily();
    syncSets();
  });
}
