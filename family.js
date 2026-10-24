"use strict";
// family.js — 아이 기기의 가족 기록함 + 오늘의 단어 + 아이 코드 연결.
// 보호자는 보호자 앱(parent.html · parent.js)에서 아이를 만들고(6자리 아이 코드·전용 링크), 아이별 기록을 보고, 오늘의 단어·제한 시간·세트 잠금을 정한다.
// 아이 기기(아이폰·태블릿)는 아이 코드나 전용 링크(?child=코드)로 연결되어 시험을 마칠 때마다 압축 기록을 보내고 매일 ‘오늘의 단어’를 받는다.
// 같은 코드를 넣은 기기는 한 아이로 묶인다. shared.js·quiz.js 다음, editor.js·sets.js 앞에 불러오고 sets.js가 마지막에 initFamily()를 부른다.
// 세트는 아이에게 속한다: 연결된 기기는 POST /sets/<childId>로 세트를 올리고 다른 기기·보호자가 바꾼 것을 받아 같은 아이의 기기가 항상 같은 세트를 본다(아래 ‘세트 동기화’).
// 기록 가져오기: 같은 아이의 다른 기기에서 본 시험(그리고 다시 설치하기 전 기록)은 GET /records/<childId>로 서버 사본(압축 기록)을 내려받아 ‘요약 기록’(restored: true)으로 기록 탭에 넣는다.
// 연결된 기기는 앱 시작·화면 복귀·기록 탭을 열 때 마지막 확인 뒤의 것을 자동으로 가져온다(아래 ‘다른 기기 기록 가져오기’).
// 저장 키 daily_vocab_family_v1 = {childId, childName, joinCode, pendingCode, deviceId, sendEnabled, lastSyncAt, lastError, pending:[기록 id],
//        setsAcked:{세트 id: 수정 시각}, setsDeleted:[{id, deletedAt}], setsSyncedAt, setsError, restoreCheckedAt, restoreError,
//        restoreFloor(‘기록 전체 삭제’ 시각: 그 전에 끝난 기록은 자동으로 가져오지 않음), restoreSkip:[이 기기에서 하나씩 지운 기록 id](자동으로 가져오지 않음),
//        childGone(보호자가 서버에서 지운 아이: 연결 해제 → 새 코드로 다시 연결할 때까지 서버 요청 중단),
//        goneChildIds:[보호자가 서버에서 지운 아이 id](그 아이로 본 시험은 다음에 연결하는 아이가 이어받는다 — 아래 ‘기록의 주인’),
//        settings:{timeLimitSec, setsLocked, dailyEnabled, dailyHour, remindHour, exam, fetchedAt}(보호자 설정, exam = 보호자가 보낸 종합 시험 | null),
//        examResult:{examId, id, correct, total, completedAt} | null(이 기기에서 그 종합 시험을 처음 끝낸 결과),
//        push:{mode:"push"|"native", deviceId, childId, endpoint, enabledAt, registeredAt(마지막으로 서버에 구독을 보낸 시각)} | null(이 기기에서 켠 알림)}
//        daily_vocab_daily_v1  = {childId, date, words, level, note, fetchedAt, result?, disabled?, lastCheckedAt, lastError?}
// 아이 코드·아이 이름·알림 구독은 이 기기에만 두고 백업 JSON/CSV에 넣지 않는다. 옛 보호자 모드가 이 키에 두던 parentCode·parentModeOff 는 보호자 앱으로 옮겨 갔고, 남아 있으면 지운다(initFamily).
const FAMILY_KEY = "daily_vocab_family_v1";
const DAILY_KEY = "daily_vocab_daily_v1";
const FAMILY_BATCH = 50; // 한 번에 보내는 기록 수 (Worker 상한 100)
const FAMILY_TIMEOUT_MS = 20000;
const DAILY_TIMEOUT_MS = 90000; // 오늘의 단어 생성은 Claude 호출이라 더 기다린다
const FAMILY_MISSED_LIMIT = 200; // 기록 하나에 담는 틀린 단어 수 (Worker 상한과 같음)
const ANCHOR_LIMIT = 60; // 교재 앵커: 최근 세트에서 보내는 영어 단어 수 (Worker 상한과 같음)
const DAILY_CHECK_MS = 10 * 60 * 1000; // 오늘 것이 없거나 꺼져 있을 때, 또는 다른 기기의 완료를 확인할 때 다시 물어보는 간격
const JOIN_CODE_PATTERN = /^\d{6}$/;
const NOTIFY_REFRESH_MS = 24 * 60 * 60 * 1000; // 알림: 마지막 등록 뒤 이만큼 지나면 구독이 같아도 앱을 열 때 서버에 다시 보낸다(Worker 가 실패가 쌓인 구독을 지웠을 수 있다)
const RESTORE_SKIP_LIMIT = 500; // 하나씩 지운 기록 id 를 기억하는 수(오래된 것부터 잊음)
// shared.js 의 서식. $·setFeedback·modeLabels 는 quiz.js, AI_SERVER_DEFAULT·normalizeServer·WORD_PATTERN 은 sets.js 머리에서 꺼낸다(sets.js 의 clean 도 tidy 를 쓴다).
const { tidy, formatCode, hourLabel, deviceLabel } = Shared;
const hourOrNull = (v) => (Number.isInteger(v) && v >= 0 && v <= 23 ? v : null);

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
    // 세트 동기화: 서버가 아는 세트 id → 수정 시각(이와 다르면 다시 올림), 아직 못 보낸 삭제 묘비, 마지막 동기화·오류
    setsAcked:
      f.setsAcked && typeof f.setsAcked === "object" && !Array.isArray(f.setsAcked)
        ? Object.fromEntries(Object.entries(f.setsAcked).filter(([, v]) => typeof v === "string"))
        : {},
    setsDeleted: Array.isArray(f.setsDeleted) ? f.setsDeleted.filter((d) => d && typeof d.id === "string" && typeof d.deletedAt === "string").slice(-200) : [],
    setsSyncedAt: typeof f.setsSyncedAt === "string" ? f.setsSyncedAt : "",
    setsError: typeof f.setsError === "string" ? f.setsError : "",
    // 기록 가져오기: 마지막으로 서버 기록을 확인한 시각(다음 자동 확인은 이 시각에서 14일 겹쳐 묻는다), 마지막 오류
    restoreCheckedAt: typeof f.restoreCheckedAt === "string" ? f.restoreCheckedAt : "",
    restoreError: typeof f.restoreError === "string" ? f.restoreError : "",
    // 사용자가 지운 기록은 자동으로 되살리지 않는다: 기록 전체 삭제 시각(바닥)과 하나씩 지운 기록 id. 버튼(‘서버 기록 다시 가져오기’)으로는 모두 가져오고 둘 다 비운다.
    // 2026-10-20 전 판은 전체 삭제 때 restoreCheckedAt 만 찍었다: 확인한 적이 있는데 기록이 비어 있으면 지운 뒤일 수 있으니 지금을 바닥으로 둔다(빈 기록 탭의 버튼으로는 가져온다).
    restoreFloor:
      typeof f.restoreFloor === "string"
        ? f.restoreFloor
        : typeof f.restoreCheckedAt === "string" && f.restoreCheckedAt && typeof historyRecords !== "undefined" && !historyRecords.length
          ? new Date().toISOString()
          : "",
    restoreSkip: Array.isArray(f.restoreSkip) ? f.restoreSkip.filter((x) => typeof x === "string").slice(-RESTORE_SKIP_LIMIT) : [],
    childGone: f.childGone === true, // 서버가 404 unknown_child 를 돌려준 아이(보호자가 지움): 다시 연결할 때까지 요청하지 않는다
    goneChildIds: Array.isArray(f.goneChildIds) ? f.goneChildIds.map(idLike).filter(Boolean).slice(-20) : [],
    // 보호자가 정한 아이 설정(서버 plan에서 받아 둠). timeLimitSec 0 = 제한 없음, setsLocked = 아이 기기에서 세트 고치기 잠금,
    // dailyEnabled·dailyHour = 오늘의 단어(도착 알림 시각), remindHour = 공부 알림 시각(null 이면 없음)
    settings: {
      timeLimitSec: Number.isInteger(f.settings?.timeLimitSec) && f.settings.timeLimitSec >= 0 ? f.settings.timeLimitSec : 0,
      setsLocked: f.settings?.setsLocked === true,
      dailyEnabled: f.settings?.dailyEnabled === true,
      dailyHour: hourOrNull(f.settings?.dailyHour) ?? 16,
      remindHour: hourOrNull(f.settings?.remindHour),
      exam: validExam(f.settings?.exam),
      fetchedAt: typeof f.settings?.fetchedAt === "string" ? f.settings.fetchedAt : "",
    },
    examResult:
      f.examResult && typeof f.examResult.examId === "string" && Number.isInteger(f.examResult.correct) && Number.isInteger(f.examResult.total) && typeof f.examResult.completedAt === "string"
        ? { examId: f.examResult.examId, id: String(f.examResult.id || ""), correct: f.examResult.correct, total: f.examResult.total, completedAt: f.examResult.completedAt }
        : null,
    // 이 기기에서 켠 알림(Web Push 구독 또는 갤럭시 앱 로컬 알림). 없으면 null
    push:
      f.push && typeof f.push === "object" && ["push", "native"].includes(f.push.mode) && typeof f.push.childId === "string"
        ? {
            mode: f.push.mode,
            deviceId: idLike(f.push.deviceId),
            childId: idLike(f.push.childId),
            endpoint: typeof f.push.endpoint === "string" ? f.push.endpoint : "",
            enabledAt: typeof f.push.enabledAt === "string" ? f.push.enabledAt : "",
            registeredAt: typeof f.push.registeredAt === "string" ? f.push.registeredAt : "",
          }
        : null,
  };
}
// 보호자가 보낸 종합 시험(GET /settings·/join 의 exam: {id, name, missedWords, createdAt, words:[{setId,id,en,ko,ipa,hangul,aliases,missed}], completed?}). 형식이 틀리면 null.
function validExam(e) {
  if (!e || typeof e !== "object" || typeof e.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(e.id) || !Array.isArray(e.words)) return null;
  const words = e.words.filter((w) => w && typeof w.en === "string" && w.en && typeof w.ko === "string" && w.ko).slice(0, 100);
  if (!words.length) return null;
  const c = e.completed;
  return {
    id: e.id,
    name: typeof e.name === "string" && e.name ? e.name.slice(0, 60) : "종합 시험",
    missedWords: Number.isInteger(e.missedWords) && e.missedWords >= 0 ? e.missedWords : 0,
    createdAt: typeof e.createdAt === "string" ? e.createdAt : "",
    words,
    completed:
      c && typeof c === "object" && Number.isInteger(c.correct) && Number.isInteger(c.total) && typeof c.completedAt === "string"
        ? { recordId: String(c.recordId || ""), correct: c.correct, total: c.total, completedAt: c.completedAt }
        : null,
  };
}
let family = readFamily();
// quiz.js 가 문제마다 부른다: 보호자가 정한 문제당 제한 시간(초). 연결되지 않은 기기는 0.
function childTimeLimitSec() {
  return isLinked() ? family.settings.timeLimitSec : 0;
}
// sets.js·홈이 본다: 보호자가 이 아이의 기기에서 세트 고치기를 잠갔는지. 연결되지 않은 기기는 잠그지 않는다.
function childSetsLocked() {
  return isLinked() && family.settings.setsLocked === true;
}
// 잠금을 홈·설정의 세트 버튼에 반영한다(새 세트 숨김, ‘단어 보기’, 안내 줄, JSON 가져오기 숨김). 편집 화면은 열 때 sets.js openEditor 가 읽기 전용으로 바꾼다.
function applySetsLock() {
  const locked = childSetsLocked();
  $("createSet").classList.toggle("hidden", locked);
  $("editSet").textContent = locked ? "📖 단어 보기" : "📖 단어 보기·수정";
  $("setsLockNote").classList.toggle("hidden", !locked);
  $("importSetsLabel").classList.toggle("hidden", locked);
}
let settingsFetching = false;
function applySettings(data) {
  family.settings = {
    timeLimitSec: Number.isInteger(data?.timeLimitSec) && data.timeLimitSec >= 0 ? data.timeLimitSec : 0,
    setsLocked: data?.setsLocked === true,
    dailyEnabled: data?.dailyEnabled === true,
    dailyHour: hourOrNull(data?.dailyHour) ?? 16,
    remindHour: hourOrNull(data?.remindHour),
    exam: validExam(data?.exam), // 옛 Worker 는 보내지 않는다(null)
    fetchedAt: new Date().toISOString(),
  };
  if (typeof data?.name === "string" && tidy(data.name)) family.childName = tidy(data.name).slice(0, 20); // 보호자가 이름을 바꿨으면 반영
  writeFamily();
  applySetsLock();
  renderExamCard();
  // 알림: 갤럭시 앱은 바뀐 시각으로 다시 예약하고, Web Push 는 구독이 사라졌거나 바뀌었으면 다시 등록한다
  nativeSchedule();
  refreshNotify();
}
// 앱 시작·화면 복귀 때 보호자 설정을 받아 둔다(10분 간격, 시작 때는 바로). 실패하면 조용히 다음 기회에.
async function fetchSettings(options = {}) {
  if (settingsFetching || !isLinked() || family.childGone || !syncPasscode()) return;
  if (!options.force && family.settings.fetchedAt && Date.now() - Date.parse(family.settings.fetchedAt) < DAILY_CHECK_MS) return;
  settingsFetching = true;
  try {
    applySettings(await familyRequest("/settings/" + encodeURIComponent(family.childId), { method: "GET", passcode: syncPasscode() }));
    renderFamilySettings();
  } catch (e) {
    noteChildGone(e); // 보호자가 지운 아이면 안내하고 이후 요청을 멈춘다. 옛 Worker(404)·일시 오류: 기존 설정 유지
  } finally {
    settingsFetching = false;
  }
}
function writeFamily() {
  return Shared.writeJson(FAMILY_KEY, family);
}
// 보호자 화면에 보일 기기 이름은 Shared.deviceLabel(위 별칭 deviceLabel).
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
// 기록 보내기·연결·오늘의 단어 받기는 가족 코드(AI 접속 코드)로 보낸다.
function syncPasscode() {
  return aiConfig()?.passcode || "";
}
// 요청·오류 문구는 shared.js apiRequest/describeApiError(오류는 ApiError{status, code, message}).
async function familyRequest(path, { method = "POST", body, passcode, timeout = FAMILY_TIMEOUT_MS } = {}) {
  return Shared.apiRequest(familyServer(), path, { method, body, passcode, timeout });
}

// ---- 아이 기기: 기록 보내기 ----
// 단어별 전체 결과·세트 단어는 보내지 않고 점수와 틀린 단어(영어·뜻)만 보낸다. 점수는 quiz.js recordScore(오래되어 줄인 요약 기록은 total/correct).
function compactRecord(r) {
  const { correct, total } = recordScore(r);
  return {
    id: r.id,
    setName: r.setName,
    mode: r.mode,
    range: r.range,
    startedAt: r.startedAt || null,
    completedAt: r.completedAt,
    total,
    correct,
    partial: r.partial === true,
    activeMs: Number.isInteger(r.activeMs) && r.activeMs >= 0 ? r.activeMs : null,
    ...(typeof r.daily === "string" ? { daily: r.daily } : {}),
    ...(typeof r.exam === "string" ? { exam: r.exam } : {}),
    ...(Number.isInteger(r.awayCount) && r.awayCount > 0 ? { awayCount: r.awayCount, awayMs: Number.isInteger(r.awayMs) ? r.awayMs : 0 } : {}),
    ...(Number.isInteger(r.timeouts) && r.timeouts > 0 ? { timeouts: r.timeouts } : {}),
    ...(Number.isInteger(r.aiPass) && r.aiPass > 0 ? { aiPass: r.aiPass } : {}),
    missed: r.results
      .filter((x) => !x.pass)
      .slice(0, FAMILY_MISSED_LIMIT)
      .map((x) => ({ en: x.word.en, ko: x.word.ko, ...(x.unknown ? { unknown: true } : {}) })),
  };
}
// 교재 앵커: 가장 최근에 고친 세트의 영어 단어. 오늘의 단어 수준 기준으로 쓴다.
// 손대지 않은 기본 예제 세트는 아이 수준과 무관하므로 빼고, 보낼 세트가 없으면 빈 앵커를 보내 서버의 옛 수준 기준을 지운다.
function anchorPayload() {
  const set = sets
    .filter((s) => !isUntouchedExample(s))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0];
  if (!set) return { setName: "", words: [] };
  const words = [...new Set(set.words.map((w) => tidy(w.en)).filter((w) => WORD_PATTERN.test(w)))].slice(0, ANCHOR_LIMIT);
  return { setName: set.name, words };
}
const isLinked = () => Boolean(family.childId && family.childName);
// ---- 기록의 주인 ----
// 연결된 기기에서 본 시험에는 그 아이 id 를 붙인다(record.childId, quiz.js saveSession 이 recordChildId 로). 연결하기 전에 본 시험은 주인이 없다가
// 처음 연결하는 아이의 것이 된다(claimRecords). 아이 A로 쓰던 기기를 B 코드로 연결해도 A로 본 시험은 B에게 보내지 않는다(B의 통계·자주 틀린 단어·수준 제안이
// 섞이지 않게; A로 다시 연결하면 A에게 다시 보낸다 — 서버는 같은 기록을 덮어쓴다). 보호자가 서버에서 지운 아이(goneChildIds)로 본 시험은 다음에 연결하는 아이가
// 이어받는다(지운 아이를 새로 만들어 다시 연결하는 흐름). 서버에서 복원한 기록은 어느 아이에게도 다시 보내지 않는다.
function recordChildId() {
  return isLinked() ? family.childId : "";
}
const ownerOf = (r) => (typeof r.childId === "string" ? r.childId : "");
function sendableHere(r) {
  if (r.restored) return false;
  const owner = ownerOf(r);
  return !owner || owner === family.childId || family.goneChildIds.includes(owner);
}
// 지금 연결된 아이에게 보낼 기록을 고르고, 주인이 없거나 지운 아이의 기록에는 이 아이 id 를 붙여 저장한다. 고른 기록 id 를 돌려준다(최신순).
// 연결·보내기 켜기 때와 앱을 열 때(이 기능 전에 쌓인 기록은 지금 연결된 아이의 것) 부른다.
function claimRecords() {
  if (!isLinked()) return [];
  const mine = historyRecords.filter(sendableHere);
  const retag = new Set(mine.filter((r) => ownerOf(r) !== family.childId).map((r) => r.id));
  let saved = true;
  if (retag.size) {
    const next = historyRecords.map((r) => (retag.has(r.id) ? { ...r, childId: family.childId } : r));
    saved = persistHistory(next, { quiet: true });
    if (!saved) historyRecords = next; // 저장하지 못해도 이번 실행에서는 이 아이의 기록으로 다룬다(지운 아이 표시는 남겨 다음에 다시 붙인다)
  }
  // 지운 아이의 기록을 이 아이가 이어받았으니 표시를 지운다. 이 아이도 지워진 상태면 남긴다(다시 연결할 아이가 이어받게).
  if (saved && !family.childGone && family.goneChildIds.length) {
    family.goneChildIds = [];
    writeFamily();
  }
  return mine.map((r) => r.id);
}
// 서버가 404 unknown_child 를 돌려주면 보호자가 이 아이를 지운 것이다: 표시해 두고 다시 연결할 때까지
// 기록·세트·설정·오늘의 단어 요청을 모두 멈춘다(같은 요청을 반복하지 않는다). 연결 해제·재연결이 풀어 준다.
function noteChildGone(e) {
  if (e?.code !== "unknown_child" || !isLinked()) return false;
  if (!family.childGone) {
    family.childGone = true;
    family.goneChildIds = [...new Set([...family.goneChildIds, family.childId])].slice(-20); // 이 아이로 본 시험은 다음에 연결하는 아이가 이어받는다
    // 서버가 이 아이의 알림 구독을 이미 지웠다: 이 기기의 구독·예약만 정리한다(다시 연결하면 알림을 새로 켠다)
    const prev = family.push;
    family.push = null;
    writeFamily();
    dropPush(prev, { server: false });
    renderFamilySettings();
  }
  return true;
}
function syncReady() {
  return isLinked() && !family.childGone && family.sendEnabled && Boolean(syncPasscode());
}
// quiz.js 의 saveSession 이 기록을 확정할 때(완료·중단) 부른다.
function queueFamilySync(record) {
  if (record.daily) noteDailyResult(record);
  if (record.exam) noteExamResult(record);
  // 갤럭시 앱 로컬 알림: 오늘 시험을 끝냈으니 오늘의 공부 리마인더는 건너뛴다(Web Push 리마인더는 서버가 기록을 보고 정한다)
  if (!record.partial && family.push?.mode === "native")
    try {
      Shared.notify.native()?.skipToday("reminder");
    } catch {}
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
  family.pending = family.pending.filter((id) => historyRecords.some((r) => r.id === id && sendableHere(r))); // 기기에서 지운 기록, 서버에서 복원한 기록, 다른 아이로 본 시험은 보내지 않는다
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
    family.lastError = noteChildGone(e) ? "" : e?.message || String(e);
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
// 앱을 열 때·화면 복귀(10분 간격)·온라인 복귀·세트 저장/이름 바꾸기/삭제/가져오기 뒤에 맞춘다.
// 시험 중에는 건드리지 않고, 시험 중에 바뀐 세트(AI가 인정한 답을 허용 답안에 학습)는 시험이 끝난 직후 올린다(onQuizEnded).
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
  return isLinked() && !family.childGone && Boolean(syncPasscode()) && storageAvailable;
}
// sets.js 가 세트를 지울 때 부른다: 같은 아이의 다른 기기에서도 지워지도록 묘비를 남긴다.
function noteSetDeleted(id) {
  if (!isLinked()) return;
  if (id === EXAMPLE_SET_ID && !(id in family.setsAcked)) return; // 서버가 모르는 예제 세트는 묘비가 필요 없다
  family.setsDeleted = [...family.setsDeleted.filter((d) => d.id !== id), { id, deletedAt: new Date().toISOString() }].slice(-200);
  delete family.setsAcked[id];
  writeFamily();
}
// sets.js 가 세트를 저장·이름 바꾸기·삭제·가져오기 한 뒤, quiz.js 의 learnAlias 가 AI가 인정한 답을 허용 답안에 넣은 뒤 부른다.
function queueSetsSync() {
  syncSets({ force: true });
}
// 시험 중에 세트가 바뀌면 그때는 올리지 않고 표시만 해 두었다가, quiz.js 가 시험 완료·그만하기·쉬기 직후 부르는 onQuizEnded 에서 바로 올린다.
let setsSyncDeferred = false;
function onQuizEnded() {
  if (!setsSyncDeferred) return;
  setsSyncDeferred = false;
  syncSets({ force: true });
}
let setsSyncInFlight = false, setsSyncAgain = false;
async function syncSets(options = {}) {
  if (!setsSyncReady()) {
    renderFamilySettings();
    return;
  }
  if (sessionRunning) {
    if (options.force) setsSyncDeferred = true; // 시험 중에는 세트를 바꾸지 않는다. 바뀐 세트는 시험이 끝난 직후 올린다(onQuizEnded)
    return;
  }
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
    family.setsError = noteChildGone(e) ? "" : e?.message || String(e);
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
    if (i >= 0 && Date.parse(next[i].updatedAt) > Date.parse(s.updatedAt)) continue; // 요청 중에 이 기기에서 더 나중에 고친 세트(찾아본 단어·학습한 답)는 지키고 다음 동기화로 올린다
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
    setFeedback($("familyStatus"), "bad", "아이 코드는 숫자 6자리예요. 보호자 앱의 ‘아이들’에서 확인하세요.");
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
    family.childGone = false; // 새(또는 같은) 아이로 다시 연결했으니 서버 요청을 다시 한다
    // 연결하면 이 아이의 기록을 함께 보낸다: 연결하기 전에 본 시험·이 아이로 본 시험·지운 아이로 본 시험(다른 아이로 본 시험과 서버에서 복원한 기록은 제외).
    // 예전 아이의 못 보낸 기록도 대기 목록에서 빠진다(그 아이로 다시 연결하면 다시 보낸다).
    family.pending = claimRecords();
    writeFamily();
    applySettings(data); // 연결 응답에 제한 시간 등 보호자 설정이 함께 온다
    if (switching || daily.childId !== family.childId) {
      daily = emptyDaily();
      writeDaily();
    }
    // 새 아이의 세트·기록과 처음부터 맞춘다(전체 삭제 바닥은 옛 아이의 기록에 대한 것이라 비운다)
    if (switching) family = { ...family, setsAcked: {}, setsDeleted: [], setsSyncedAt: "", setsError: "", restoreCheckedAt: "", restoreError: "", restoreFloor: "" };
    $("childCode").value = "";
    $("familySend").checked = true;
    renderFamilySettings(`이 기기를 ‘${family.childName}’의 기기로 연결했어요. 기록을 보내는 중…`);
    // 이 기기의 기록을 올리고 이 아이의 세트를 받은 뒤, 서버에 있는 이 아이의 기록(다른 기기·다시 설치하기 전 것)을 기록 탭에 가져온다
    Promise.all([flushFamilySync({ force: true }), syncSets({ force: true })]).then(() => restoreRecords());
    checkDaily({ force: true });
    return true;
  } catch (e) {
    setFeedback(
      $("familyStatus"),
      "bad",
      e.code === "unknown_code" ? "그 아이 코드를 찾을 수 없어요. 보호자 앱의 ‘아이들’에서 코드를 다시 확인해 주세요." : "연결 실패: " + e.message,
    );
    return false;
  } finally {
    $("joinChild").disabled = false;
  }
}
async function handleLinkCode(code) {
  if (isLinked() && !family.childGone && family.joinCode === code) {
    renderFamilySettings();
    fetchSettings({ force: true });
    checkDaily({ ignoreThrottle: true });
    syncSets({ force: true }).then(() => restoreRecords());
    return;
  }
  if (isLinked() && !family.childGone && !confirm(`이 기기는 이미 ‘${family.childName}’의 기기로 연결되어 있어요. 링크의 아이로 바꿀까요? 지금까지의 기록은 각자에게 남고, 이 기기의 세트는 링크의 아이 세트와 합쳐져요.`)) return;
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
  const prevPush = family.push;
  family = {
    ...family, childId: "", childName: "", joinCode: "", pendingCode: "", sendEnabled: false, pending: [], lastError: "", childGone: false,
    setsAcked: {}, setsDeleted: [], setsSyncedAt: "", setsError: "", restoreCheckedAt: "", restoreError: "", push: null, examResult: null,
    settings: { timeLimitSec: 0, setsLocked: false, dailyEnabled: false, dailyHour: 16, remindHour: null, exam: null, fetchedAt: "" },
  };
  writeFamily();
  dropPush(prevPush); // 이 기기의 알림도 끈다(서버 구독 삭제)
  notifyNote = null;
  daily = emptyDaily();
  writeDaily();
  $("familySend").checked = false;
  renderFamilySettings("연결을 해제했어요. 다시 연결하려면 아이 코드를 넣으세요.");
  renderDailyCard();
};

// ---- 아이 기기: 다른 기기 기록 가져오기(기록 복원) ----
// 기록의 원본은 기기(daily_vocab_history_v2)마다 있고 서버에는 압축 사본(점수·틀린 단어)이 모인다. 같은 아이의 다른 기기에서 본 시험과 새 기기·다시 설치한 앱의 빈 기록 탭은
// GET /records/<childId>(가족 코드)로 서버 사본을 내려받아 ‘요약 기록’(restored: true, total/correct 점수, results 는 틀린 단어만)으로 기록 탭에 넣는다.
// 자동: 연결 직후(기록을 올리고 세트를 받은 뒤)·앱 시작(세트를 맞춘 뒤)·화면 복귀·온라인 복귀(10분 간격)·기록 탭을 열 때(1분 간격).
//   since = 마지막 확인 시각 − 14일(늦게 올라온 기록: 오프라인이던 기기가 나중에 보낸 것도 놓치지 않게 넉넉히 겹친다), 기기에 이미 있는 id는 건너뛴다.
//   사용자가 지운 기록은 되살리지 않는다: 하나씩 지운 기록 id(restoreSkip)와 ‘기록 전체 삭제’ 시각(restoreFloor, 그 전에 끝난 기록) 은 건너뛴다.
// 버튼(설정의 ‘서버 기록 다시 가져오기’, 빈 기록 탭의 ‘서버 기록 가져오기’): 처음부터 모두 가져오고(지운 기록 포함) 바닥·지운 id 를 비운다.
// 가져온 기록은 다시 서버로 보내지 않으며(pending 제외, sendableHere) 세트별 오답(daily_vocab_missed_*)은 건드리지 않는다. 시험 중에는 하지 않는다.
const RESTORE_PAGE = 500; // Worker 상한과 같음
const RESTORE_MAX_PAGES = 10; // 아이당 보관 상한 5,000개
const RESTORE_SINCE_START = "1970-01-01T00:00:00.000Z";
const RESTORE_OVERLAP_MS = 14 * 86400000; // 자동 확인은 마지막 확인보다 14일 앞부터 다시 묻는다
const RESTORE_CHECK_MS = DAILY_CHECK_MS; // 화면 복귀·온라인 복귀 때 다시 묻는 간격
const RESTORE_TAB_MS = 60 * 1000; // 기록 탭을 열 때 다시 묻는 간격
let restoreInFlight = false, restoreFailedAt = 0; // 실패한 시각(실패해도 간격을 지켜 같은 요청을 거듭하지 않는다)
function restoreReady() {
  return isLinked() && !family.childGone && Boolean(syncPasscode()) && storageAvailable;
}
// 자동 확인의 시작 시각: 마지막 확인 − 14일, 단 ‘기록 전체 삭제’ 시각보다 앞으로는 가지 않는다. 처음이면 처음부터.
function autoRestoreSince() {
  const checked = Date.parse(family.restoreCheckedAt);
  const since = Number.isFinite(checked) ? new Date(Math.max(0, checked - RESTORE_OVERLAP_MS)).toISOString() : RESTORE_SINCE_START;
  return family.restoreFloor && family.restoreFloor > since ? family.restoreFloor : since;
}
const validServerRecord = (r) =>
  Boolean(r && typeof r.id === "string" && Number.isFinite(Date.parse(r.completedAt)) && modeLabels[r.mode] && Number.isInteger(r.total) && r.total >= 1 && r.total <= 2000 && Number.isInteger(r.correct) && r.correct >= 0 && r.correct <= r.total);
// 압축 기록 → 기기 기록 형식. 세트는 이름이 같은 이 기기의 세트에 연결하고(기록 탭 세트 필터·홈 요약), 틀린 단어는 그 세트에 있으면 번호·발음·허용 답안까지 채운다.
function expandRecord(r) {
  const setName = tidy(r.setName).slice(0, 120) || "(이름 없음)";
  const dailyDate = typeof r.daily === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.daily) ? r.daily : "";
  const set = dailyDate ? null : sets.find((s) => s.name === setName) || null;
  const missed = (Array.isArray(r.missed) ? r.missed : []).filter((m) => m && typeof m.en === "string" && m.en.trim()).slice(0, Math.min(FAMILY_MISSED_LIMIT, r.total - r.correct));
  const results = missed.map((m, i) => {
    const known = set?.words.find((w) => w.en === m.en);
    const word = known ? structuredClone(known) : { id: i + 1, en: tidy(m.en).slice(0, 80), ko: tidy(m.ko).slice(0, 200), ipa: "", hangul: "", aliases: [] };
    return { id: word.id, word, pass: false, unknown: m.unknown === true };
  });
  return {
    id: r.id,
    setId: dailyDate ? "daily:" + dailyDate : set ? set.id : "restored:" + setName,
    setName,
    mode: r.mode,
    range: tidy(r.range).slice(0, 60),
    startedAt: typeof r.startedAt === "string" && Number.isFinite(Date.parse(r.startedAt)) ? r.startedAt : r.completedAt,
    completedAt: r.completedAt,
    activeMs: Number.isInteger(r.activeMs) && r.activeMs >= 0 ? r.activeMs : 0,
    ...(r.partial === true ? { partial: true } : {}),
    ...(dailyDate ? { daily: dailyDate } : {}),
    ...(Number.isInteger(r.awayCount) && r.awayCount > 0 ? { awayCount: r.awayCount, awayMs: Number.isInteger(r.awayMs) && r.awayMs >= 0 ? r.awayMs : 0 } : {}),
    ...(Number.isInteger(r.timeouts) && r.timeouts > 0 ? { timeouts: r.timeouts } : {}),
    ...(Number.isInteger(r.aiPass) && r.aiPass > 0 ? { aiPass: r.aiPass } : {}),
    restored: true,
    restoredAt: new Date().toISOString(),
    childId: family.childId, // 이 아이의 서버 사본(다시 보내지는 않는다)
    total: r.total,
    correct: r.correct,
    results,
  };
}
// manual: 버튼(처음부터 모두, 지운 기록 포함). 그 밖에는 자동(since 는 autoRestoreSince, 지운 기록 제외). throttle: 마지막 확인·시도 뒤 이 시간(ms) 안이면 하지 않는다.
// 돌려주는 값: 가져온 기록 수, 실패하면 null, 이번에 하지 않았으면 undefined.
async function restoreRecords(options = {}) {
  if (restoreInFlight || !restoreReady() || sessionRunning) return;
  const manual = options.manual === true;
  if (!manual && options.throttle && Date.now() - Math.max(restoreFailedAt, Date.parse(family.restoreCheckedAt) || 0) < options.throttle) return;
  restoreInFlight = true;
  const startedAt = new Date().toISOString();
  renderFamilySettings(manual ? "서버에 보낸 기록을 가져오는 중…" : undefined);
  let added = 0;
  try {
    const known = new Set(historyRecords.map((r) => r.id));
    const skip = new Set(manual ? [] : family.restoreSkip); // 이 기기에서 지운 기록
    const floor = manual ? "" : family.restoreFloor; // 기록 전체 삭제 시각
    const fresh = [];
    let since = manual ? RESTORE_SINCE_START : autoRestoreSince();
    for (let page = 0; page < RESTORE_MAX_PAGES; page++) {
      const data = await familyRequest(`/records/${encodeURIComponent(family.childId)}?since=${encodeURIComponent(since)}&limit=${RESTORE_PAGE}`, { method: "GET", passcode: syncPasscode() });
      const list = (Array.isArray(data?.records) ? data.records : []).filter(validServerRecord);
      for (const r of list) {
        if (known.has(r.id)) continue; // 이 기기에 이미 있는 기록(또는 앞 페이지와 겹친 기록)
        known.add(r.id);
        if (skip.has(r.id) || (floor && Date.parse(r.completedAt) < Date.parse(floor))) continue; // 사용자가 지운 기록은 자동으로 되살리지 않는다
        fresh.push(expandRecord(r));
      }
      const last = list[list.length - 1];
      if (!data?.more || !last || last.completedAt <= since) break;
      since = last.completedAt;
    }
    if (fresh.length) {
      const merged = [...fresh, ...historyRecords].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
      if (!persistHistory(merged)) throw Error("기록을 저장하지 못했어요. 저장 공간을 확인하세요.");
      added = fresh.length;
      setFeedback(
        $("historyStatus"),
        "good",
        manual ? `보호자에게 보냈던 기록 ${added}개를 서버에서 가져왔어요(점수·틀린 단어).` : `다른 기기에서 본 시험 기록 ${added}개를 서버에서 가져왔어요(점수·틀린 단어).`,
      );
      renderHome();
    }
    family.restoreCheckedAt = startedAt; // 다음 자동 확인은 이 시각에서 14일 겹쳐 묻는다
    family.restoreError = "";
    if (manual) {
      family.restoreFloor = ""; // 모두 가져왔으니 지운 기록 표시는 더 필요 없다(다시 지우면 다시 기억한다)
      family.restoreSkip = [];
    }
    writeFamily();
  } catch (e) {
    restoreFailedAt = Date.now();
    family.restoreError = noteChildGone(e) ? "" : e?.message || String(e);
    writeFamily();
  } finally {
    restoreInFlight = false;
    renderFamilySettings(manual && !family.restoreError ? (added ? `서버에서 기록 ${added}개를 가져왔어요.` : "서버에 더 가져올 기록이 없어요. 이 기기에 모두 있어요.") : undefined);
  }
  return family.restoreError ? null : added;
}
// quiz.js 가 기록 탭을 열 때 부른다: 다른 기기에서 방금 본 시험도 보이게(1분 간격).
function onHistoryShown() {
  restoreRecords({ throttle: RESTORE_TAB_MS });
}
// quiz.js 가 기록 하나를 지운 뒤 부른다: 서버 사본은 남아 있으니 자동으로 다시 가져오지 않게 id 를 기억한다(연결 전이어도, 연결 해제 뒤에도).
function noteRecordDeleted(id) {
  if (typeof id !== "string" || family.restoreSkip.includes(id)) return;
  family.restoreSkip = [...family.restoreSkip, id].slice(-RESTORE_SKIP_LIMIT);
  writeFamily();
}
// quiz.js 가 ‘시험 기록 전체 삭제’를 마친 뒤 부른다: 지금 시각을 바닥으로 두어 그 전에 끝난 기록은 자동으로 되살리지 않는다(버튼으로는 가져올 수 있다).
// 그 뒤에 다른 기기에서 본 시험은 계속 들어온다. 하나씩 지운 id 는 모두 바닥보다 앞이라 비운다.
function noteHistoryCleared() {
  if (!isLinked()) return;
  family.restoreFloor = new Date().toISOString();
  family.restoreSkip = [];
  writeFamily();
  renderFamilySettings();
}
$("restoreRecords").onclick = () => restoreRecords({ manual: true });

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
        // 보호자가 서버에서 지운 아이: 다시 등록하지 않는다(새 아이 코드로 다시 연결해야 한다). 안내만 남기고 요청을 멈춘다.
        daily = { ...emptyDaily(), childId: family.childId, date: today, lastCheckedAt: now, lastError: e.message };
        writeDaily();
        noteChildGone(e);
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
    noteChildGone(e);
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

// ---- 아이 기기: 보호자가 보낸 종합 시험 ----
// 보호자가 보호자 앱(세트 탭)에서 아이 세트의 자주 틀린 단어 등으로 만들어 보내면, 이 기기는 GET /settings·/join 응답의 exam 으로 받아(family.settings.exam)
// 홈 카드에서 푼다. 문제마다 출처 세트(setId)가 있어 틀린 단어는 그 세트의 오답 목록에 들어간다(quiz.js 종합 시험과 같은 setId "combo" 기록, exam = 시험 id).
// 처음 끝낸 결과(이 기기 examResult 또는 서버의 completed — 다른 기기에서 푼 것)를 보여 주고, 끝낸 다음 날부터는 홈에서 내린다(보호자가 새로 보내면 다시 나타난다).
function currentExam() {
  return isLinked() && !family.childGone ? family.settings.exam : null;
}
function examDone(exam) {
  if (family.examResult?.examId === exam.id) return family.examResult;
  return resultFrom(exam.completed);
}
function noteExamResult(record) {
  const exam = family.settings.exam;
  if (record.partial || !exam || record.exam !== exam.id || family.examResult?.examId === exam.id) return;
  const { correct, total } = recordScore(record);
  family.examResult = { examId: exam.id, id: record.id, correct, total, completedAt: record.completedAt };
  writeFamily();
  renderExamCard();
}
function renderExamCard() {
  const card = $("examCard");
  const exam = currentExam();
  const done = exam ? examDone(exam) : null;
  const show = Boolean(exam) && (!done || Shared.dayKey(done.completedAt) === Shared.dayKey(new Date()));
  card.classList.toggle("hidden", !show);
  if (!show) return;
  if (done) {
    const wrong = done.total - done.correct;
    $("examTitle").textContent = "✅ 종합 시험 끝!";
    $("examText").textContent = `${done.correct} / ${done.total} 맞았어요` + (wrong ? ` · 틀린 단어 ${wrong}개는 한 번 더 복습해 봐요` : " · 모두 정답 🎉");
    $("startExam").textContent = "한 번 더 풀기";
  } else {
    $("examTitle").textContent = "📝 보호자가 보낸 종합 시험";
    $("examText").textContent = `${exam.words.length}문제` + (exam.missedWords ? ` · 자주 틀린 단어 ${exam.missedWords}개` : "") + ` · ${exam.name}`;
    $("startExam").textContent = "▶ 풀기";
  }
  $("startExam").disabled = sessionRunning;
}
// 홈 카드·결과 화면의 ‘같은 범위 다시’(quiz.js)가 부른다. 문제 순서는 풀 때마다 섞는다.
function startExam() {
  const exam = currentExam();
  if (!exam || sessionRunning) return false;
  const words = exam.words.map((w, i) => ({
    id: Number.isInteger(w.id) || (typeof w.id === "string" && w.id) ? w.id : i + 1,
    en: w.en,
    ko: w.ko,
    ipa: typeof w.ipa === "string" ? w.ipa : "",
    hangul: typeof w.hangul === "string" ? w.hangul : "",
    aliases: Array.isArray(w.aliases) ? w.aliases.filter((a) => typeof a === "string") : [],
    ...(typeof w.setId === "string" && w.setId ? { _setId: w.setId } : {}),
  }));
  return newSession(false, words, { setId: COMBO_SET_ID, setName: exam.name }, { rangeLabel: `보호자 종합 시험 · ${words.length}문제`, exam: exam.id, shuffle: true });
}
$("startExam").onclick = () => startExam();

// ---- 아이 기기: 알림(2B) ----
// 아이는 ‘🔔 이 기기에서 알림 받기’ 하나만 켠다. 시각은 보호자가 보호자 앱에서 정한다(오늘의 단어 시각 → 📬 도착, 공부 알림 시각 remindHour → ✏️ 리마인더).
// Web Push(아이폰 홈 화면 앱·Android Chrome): 권한(사용자 터치 안) → GET /push/key → 구독 → POST /push/subscribe(가족 코드) → family.push.
// 갤럭시 래퍼 앱(window.DailyVocabNotify, N2): 권한 → schedule({daily, reminder}) 로 앱이 스스로 띄운다(서버 구독 없음). 시험을 끝내면 skipToday("reminder").
// 앱 시작·설정을 받을 때(applySettings) 구독이 사라졌거나 endpoint 가 바뀌었으면(브라우저 갱신·키 교체·다른 아이로 연결) 다시 등록한다(권한이 granted 일 때만).
// 구독이 그대로여도 마지막 등록이 하루(NOTIFY_REFRESH_MS) 전이면 같은 구독을 다시 보낸다: Worker 는 전송이 연달아 5번 실패한 구독을 지우는데
// 브라우저 쪽은 모르므로 ‘🔔 알림 켜짐’인데 알림이 영영 오지 않는 일을 막는다(서버 등록은 같은 기기면 덮어써서 몇 번 보내도 같다).
// 연결 해제·알림 끄기는 브라우저 구독과 서버 구독을 함께 지우고, 서버에서 지워진 아이(childGone)면 이 기기 것만 정리한다.
let notifyBusy = false, notifyRefreshing = false;
let notifyNote = null; // #notifyHelp 에 보일 {kind, text}
const pushDeviceInfo = () => ({ id: ensureDeviceId(), label: deviceLabel() });
// 갤럭시 앱에 지금 보호자 설정의 시각을 알려 준다(로컬 알림 예약).
function nativeSchedule() {
  const bridge = Shared.notify.native();
  if (!bridge || family.push?.mode !== "native" || !isLinked() || family.childGone) return;
  const s = family.settings;
  try {
    bridge.schedule({ daily: { enabled: s.dailyEnabled, hour: s.dailyHour }, reminder: Number.isInteger(s.remindHour) ? { hour: s.remindHour } : null });
  } catch {}
}
// 서버 공개 키 → 브라우저 구독 → POST /push/subscribe. 성공하면 family.push 에 남긴다.
async function registerPush() {
  const { publicKey } = await familyRequest("/push/key", { method: "GET", passcode: syncPasscode() });
  const subscription = await Shared.notify.subscribe(publicKey);
  await familyRequest("/push/subscribe", { body: { role: "child", childId: family.childId, device: pushDeviceInfo(), subscription }, passcode: syncPasscode() });
  const now = new Date().toISOString();
  family.push = { mode: "push", deviceId: family.deviceId, childId: family.childId, endpoint: subscription.endpoint, enabledAt: family.push?.enabledAt || now, registeredAt: now };
  writeFamily();
}
async function enableNotify() {
  const support = Shared.notify.support();
  if (notifyBusy || !isLinked() || family.childGone || !["push", "native"].includes(support)) return;
  notifyBusy = true;
  notifyNote = { kind: "info", text: "알림을 켜는 중…" };
  renderNotify();
  try {
    const permission = await Shared.notify.request(); // 권한 요청은 터치 직후 맨 먼저(아이폰은 사용자 터치 안에서만 묻는다)
    if (permission !== "granted") {
      notifyNote = { kind: "bad", text: "알림 권한이 꺼져 있어요. 기기 설정에서 이 앱의 알림을 허용해 주세요." };
      return;
    }
    if (support === "native") {
      family.push = { mode: "native", deviceId: ensureDeviceId(), childId: family.childId, endpoint: "", enabledAt: new Date().toISOString() };
      writeFamily();
      nativeSchedule();
    } else {
      if (!syncPasscode()) throw Error("먼저 위의 ‘보호자 설정 · AI 연결’에서 접속 코드를 저장하세요.");
      await registerPush();
    }
    notifyNote = { kind: "good", text: "알림을 켰어요. 보호자가 정한 시각에 이 기기로 알려 줘요." };
  } catch (e) {
    noteChildGone(e);
    notifyNote = { kind: "bad", text: e?.code === "push_unconfigured" ? e.message : "알림을 켜지 못했어요: " + (e?.message || e) };
  } finally {
    notifyBusy = false;
    renderNotify();
  }
}
// 이 기기의 알림을 끈다: 브라우저 구독 해지 + 서버 구독 삭제(server), 갤럭시 앱은 예약 취소. 실패해도 넘어간다(서버에 남은 구독은 다음 전송 때 만료로 지워진다).
async function dropPush(prev, { server = true } = {}) {
  if (!prev) return;
  if (prev.mode === "native") {
    try {
      Shared.notify.native()?.cancel();
    } catch {}
    return;
  }
  try {
    await Shared.notify.unsubscribe();
  } catch {}
  if (server && prev.childId && syncPasscode())
    await familyRequest("/push/unsubscribe", { body: { role: "child", childId: prev.childId, device: { id: prev.deviceId || ensureDeviceId() } }, passcode: syncPasscode() }).catch(() => {});
}
async function disableNotify() {
  if (notifyBusy || !family.push) return;
  notifyBusy = true;
  const prev = family.push;
  family.push = null;
  writeFamily();
  notifyNote = { kind: "info", text: "알림을 끄는 중…" };
  renderNotify();
  try {
    await dropPush(prev);
  } finally {
    notifyBusy = false;
    notifyNote = { kind: "good", text: "알림을 껐어요." };
    renderNotify();
  }
}
// 앱 시작·설정 수신 때: 켜 둔 알림이 그대로인지 확인하고, 구독이 없어졌거나 바뀌었으면(또는 다른 아이로 연결했으면, 마지막 등록이 하루 전이면) 다시 등록한다.
async function refreshNotify() {
  const prev = family.push;
  if (!prev || prev.mode !== "push" || notifyBusy || notifyRefreshing || !isLinked() || family.childGone || !syncPasscode()) return; // 갤럭시 앱은 applySettings 의 nativeSchedule 이 맡는다
  if (Shared.notify.support() !== "push" || Shared.notify.permission() !== "granted") return;
  notifyRefreshing = true;
  try {
    const current = await Shared.notify.current();
    const recent = Date.now() - Date.parse(prev.registeredAt || "") < NOTIFY_REFRESH_MS; // 기록이 없으면(이 규칙 전에 켠 알림) 한 번 다시 보낸다
    if (current && current.endpoint === prev.endpoint && prev.childId === family.childId && recent) return;
    if (prev.childId && prev.childId !== family.childId)
      // 다른 아이로 바꿔 연결했다: 옛 아이에게 등록한 이 기기의 구독은 지운다
      await familyRequest("/push/unsubscribe", { body: { role: "child", childId: prev.childId, device: { id: prev.deviceId || ensureDeviceId() } }, passcode: syncPasscode() }).catch(() => {});
    await registerPush();
  } catch (e) {
    noteChildGone(e); // 그 밖의 오류(오프라인·옛 Worker)는 다음에 앱을 열 때 다시 해 본다
  } finally {
    notifyRefreshing = false;
    renderNotify();
  }
}
function renderNotify() {
  const support = Shared.notify.support();
  const on = Boolean(family.push);
  const s = family.settings;
  const denied = support === "push" && Shared.notify.permission() === "denied";
  let text;
  if (on && denied && family.push.mode === "push") text = "알림 권한이 꺼져 있어요. 기기 설정에서 켜 주세요";
  else if (on)
    text = ["🔔 알림 켜짐", s.dailyEnabled ? "오늘의 단어 도착" : "", Number.isInteger(s.remindHour) ? "공부 알림 " + hourLabel(s.remindHour) : "공부 알림 없음(보호자 설정)"].filter(Boolean).join(" · ");
  else if (support === "none") text = "이 브라우저는 알림을 지원하지 않아요";
  else if (support === "install") text = "홈 화면에 설치한 앱에서만 알림을 켤 수 있어요";
  else if (denied) text = "알림 권한이 꺼져 있어요. 기기 설정에서 켜 주세요";
  else text = "알림 꺼짐";
  $("notifyText").textContent = text;
  const button = $("notifyEnable");
  button.textContent = on ? "🔕 알림 끄기" : "🔔 이 기기에서 알림 받기";
  button.classList.toggle("hidden", !on && !["push", "native"].includes(support));
  button.disabled = notifyBusy || family.childGone;
  const guide =
    support === "install" && !on ? "아이폰·아이패드: Safari 공유(⬆) → ‘홈 화면에 추가’로 설치한 앱을 열고, 그 앱의 설정 → 가족 기록함에서 아이 코드를 넣은 뒤 알림을 켜 주세요(iOS 16.4 이상)." : "";
  setFeedback($("notifyHelp"), notifyNote?.kind || "info", notifyNote?.text || guide);
}
$("notifyEnable").onclick = () => (family.push ? disableNotify() : enableNotify());

// ---- 설정 화면(가족 기록함) ----
function renderFamilySettings(progress) {
  const linked = isLinked();
  applySetsLock();
  $("joinBox").classList.toggle("hidden", linked);
  $("linkedBox").classList.toggle("hidden", !linked);
  if (linked) {
    $("childName").textContent = family.childName;
    $("deviceLabelText").textContent = deviceLabel();
    $("setsSyncText").textContent = family.childGone
      ? "보호자가 이 아이를 서버에서 지워서 세트를 맞추지 않아요."
      : setsSyncInFlight
        ? "세트를 보호자·다른 기기와 맞추는 중…"
        : family.setsError
          ? "세트를 맞추지 못했어요: " + family.setsError
          : family.setsSyncedAt
            ? `세트 ${sets.length}개 · 보호자·다른 기기와 같은 세트 (마지막 확인 ${new Date(family.setsSyncedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })})`
            : "세트는 아직 맞추지 않았어요. 인터넷이 되면 자동으로 보호자·다른 기기와 같아져요.";
    if (childSetsLocked()) $("setsSyncText").textContent += " · 🔒 보호자가 세트 고치기를 잠갔어요";
    const restoredCount = historyRecords.filter((r) => r.restored).length;
    const checkedAt = family.restoreCheckedAt ? new Date(family.restoreCheckedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "";
    const skipped = family.restoreFloor || family.restoreSkip.length ? " · 지운 기록은 다시 가져오지 않아요(‘서버 기록 다시 가져오기’로는 모두 가져와요)" : "";
    $("restoreText").textContent = family.childGone
      ? ""
      : restoreInFlight
        ? "서버에서 다른 기기의 기록을 확인하는 중…"
        : family.restoreError
          ? "서버 기록을 가져오지 못했어요: " + family.restoreError
          : (restoredCount
              ? `☁️ 다른 기기에서 가져온 기록 ${restoredCount}개 (점수·틀린 단어)`
              : "같은 아이의 다른 기기에서 본 시험은 앱을 열 때·돌아올 때 서버에서 자동으로 가져와요") +
            skipped +
            (checkedAt ? ` · 마지막 확인 ${checkedAt}` : "");
    $("restoreRecords").disabled = !restoreReady() || restoreInFlight;
    renderNotify();
  }
  $("unlinkChild").classList.toggle("attention", linked && family.childGone); // 지워진 아이는 ‘연결 해제’가 다음 할 일이라 눈에 띄게
  renderExamCard(); // 연결 해제·서버에서 지워진 아이면 카드를 내린다
  const pill = $("familyState");
  pill.textContent = !linked
    ? "연결 안 됨"
    : family.childGone
      ? "서버에서 지워짐"
      : !family.sendEnabled
        ? "꺼짐"
        : family.pending.length
          ? `보낼 기록 ${family.pending.length}개`
          : syncInFlight
            ? "보내는 중"
            : "기록 보내기 켜짐";
  $("syncNow").disabled = !syncReady() || syncInFlight;
  let text = progress || "", type = "info";
  if (!text) {
    if (!linked)
      text = family.pendingCode
        ? `아이 코드 ${formatCode(family.pendingCode)}을(를) 연결하려면 먼저 위의 ‘보호자 설정 · AI 연결’에서 접속 코드를 저장하세요.`
        : "보호자 앱의 ‘아이들’에서 만든 아이 코드 6자리를 넣고 ‘연결’을 누르세요. 아이 전용 링크를 열어도 돼요.";
    else if (family.childGone) {
      text = `보호자가 이 아이(${family.childName})를 서버에서 지웠어요. 아래 ‘연결 해제’를 누른 뒤, 보호자 앱의 ‘아이들’에서 새로 만든 아이 코드로 다시 연결하세요. 이 기기의 세트와 기록은 그대로 남고, 다시 연결하면 기록도 함께 올라가요.`;
      type = "bad";
    } else if (!family.sendEnabled) text = "연결은 되어 있지만 보내기가 꺼져 있어요. 스위치를 켜고 저장하면 시험을 마칠 때마다 기록을 보내요.";
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
  if (turningOn) family.pending = claimRecords(); // 다시 켤 때는 그동안 이 아이로 본 시험도 함께 보낸다(복원한 기록·다른 아이로 본 시험은 제외)
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

// sets.js 가 AI 연결 설정을 준비한 뒤 부른다.
function initFamily() {
  // 옛 보호자 모드가 남긴 보호자 코드·‘아이 기기처럼 보기’는 아이 앱이 쓰지 않는다(보호자 앱 parent.html 의 것). 남아 있으면 지운다.
  if (Shared.readJson(FAMILY_KEY, (v) => v && typeof v === "object" && ("parentCode" in v || "parentModeOff" in v))) writeFamily();
  claimRecords(); // 주인 표시가 없는 기록(이 기능 전에 쌓인 것)은 지금 연결된 아이의 것이다: 표시만 붙이고 대기 목록은 그대로 둔다
  $("familySend").checked = family.sendEnabled;
  renderFamilySettings();
  renderDailyCard();
  const linkCode = linkCodeFromUrl();
  if (linkCode) handleLinkCode(linkCode);
  else {
    if (family.pending.length) flushFamilySync();
    fetchSettings({ force: true }); // 보호자가 바꾼 제한 시간 등을 앱을 열 때 받아 둔다
    checkDaily({ ignoreThrottle: true }); // 앱을 새로 열 때는 10분 제한 없이 확인한다(보호자가 방금 켰을 수 있다)
    syncSets({ force: true }).then(() => restoreRecords()); // 보호자·다른 기기가 바꾼 세트를 받고 이 기기의 변경을 올린 뒤, 다른 기기에서 본 시험(새 기기·재설치면 전부)을 가져온다
  }
  // 알림을 눌러 이미 열린 앱으로 돌아오면 sw.js 가 {type:"navigate"} 를 보낸다: 시험 중이 아니면 홈(오늘의 단어·종합 시험 카드)으로, 오늘의 단어와
  // 보호자 설정(📝 보호자가 보낸 종합 시험)은 간격 제한 없이 바로 확인한다.
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type !== "navigate") return;
      if (!sessionRunning) showView("home");
      fetchSettings({ force: true });
      checkDaily({ ignoreThrottle: true });
    });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (family.pending.length) flushFamilySync();
    fetchSettings();
    checkDaily();
    syncSets();
    restoreRecords({ throttle: RESTORE_CHECK_MS }); // 그사이 다른 기기에서 본 시험
  });
  window.addEventListener("online", () => {
    if (family.pending.length) flushFamilySync();
    fetchSettings();
    checkDaily();
    syncSets();
    restoreRecords({ throttle: RESTORE_CHECK_MS });
  });
}
