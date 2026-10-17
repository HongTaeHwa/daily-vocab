"use strict";
// family.js — 가족 기록함. 아이 기기는 시험을 마칠 때마다 압축 기록(점수·틀린 단어·세트 이름)을 가족 서버(Worker)에 보내고,
// 보호자 폰은 보호자 코드를 저장하면 생기는 ‘아이들’ 탭에서 아이별 기록을 본다.
// quiz.js(기록·뷰 전환) 다음, sets.js(AI 서버 주소·접속 코드) 앞에 불러온다. sets.js가 마지막에 initFamily()를 부른다.
// 저장 키 daily_vocab_family_v1 = {childId, childName, sendEnabled, lastSyncAt, lastError, pending:[기록 id], parentCode}
// 보호자 코드·아이 이름은 이 기기에만 두고 백업 JSON/CSV에 넣지 않는다.
const FAMILY_KEY = "daily_vocab_family_v1";
const FAMILY_CACHE_KEY = "daily_vocab_family_cache_v1";
const FAMILY_BATCH = 50; // 한 번에 보내는 기록 수 (Worker 상한 100)
const FAMILY_TIMEOUT_MS = 20000;
const FAMILY_MISSED_LIMIT = 200; // 기록 하나에 담는 틀린 단어 수 (Worker 상한과 같음)
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const tidy = (s) => String(s ?? "").replace(/[\t\r\n]+/g, " ").trim();

function readFamily() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(FAMILY_KEY) || "null");
  } catch {}
  const f = saved && typeof saved === "object" ? saved : {};
  return {
    childId: typeof f.childId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(f.childId) ? f.childId : "",
    childName: typeof f.childName === "string" ? tidy(f.childName).slice(0, 20) : "",
    sendEnabled: f.sendEnabled === true,
    lastSyncAt: typeof f.lastSyncAt === "string" ? f.lastSyncAt : "",
    lastError: typeof f.lastError === "string" ? f.lastError : "",
    pending: Array.isArray(f.pending) ? f.pending.filter((x) => typeof x === "string").slice(0, 5000) : [],
    parentCode: typeof f.parentCode === "string" ? f.parentCode : "",
  };
}
let family = readFamily();
function writeFamily() {
  try {
    localStorage.setItem(FAMILY_KEY, JSON.stringify(family));
    return true;
  } catch {
    return false;
  }
}

// ---- 가족 서버 요청 (서버 주소는 sets.js 의 AI 연결 설정과 같다) ----
function familyServer() {
  return normalizeServer(savedAi()?.server || AI_SERVER_DEFAULT);
}
// 기록 보내기는 가족 코드(AI 접속 코드)로, 없으면 보호자 코드로 보낸다.
function syncPasscode() {
  return aiConfig()?.passcode || family.parentCode || "";
}
async function familyRequest(path, { method = "POST", body, passcode } = {}) {
  const server = familyServer();
  if (!server) throw Object.assign(Error("AI 서버 주소가 올바르지 않아요. 보호자 설정 · AI 연결을 확인하세요."), { status: 0 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FAMILY_TIMEOUT_MS);
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
  let message;
  if (response.status === 401) message = viewing ? "보호자 코드가 맞지 않아요. 다시 입력해 주세요." : "접속 코드가 맞지 않아요. 보호자 설정 · AI 연결에서 다시 입력하세요.";
  else if (response.status === 404 && payload?.error !== "unknown_child")
    message = "AI 서버가 아직 가족 기록함을 지원하지 않아요. 보호자가 Worker를 새 버전으로 다시 배포해 주세요.";
  else if (response.status === 403) message = "이 주소에서는 가족 서버를 쓸 수 없어요. 보호자가 ALLOWED_ORIGINS를 확인해 주세요.";
  else if (typeof payload?.message === "string" && payload.message) message = payload.message;
  else if (response.status === 429) message = "요청이 너무 많아요. 잠시 후 다시 시도하세요.";
  else message = `가족 서버 오류 ${response.status}`;
  throw Object.assign(Error(message), { status: response.status, code: payload?.error });
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
    missed: r.results
      .filter((x) => !x.pass)
      .slice(0, FAMILY_MISSED_LIMIT)
      .map((x) => ({ en: x.word.en, ko: x.word.ko, ...(x.unknown ? { unknown: true } : {}) })),
  };
}
function syncReady() {
  return family.sendEnabled && Boolean(family.childName && family.childId && syncPasscode());
}
// quiz.js 의 saveSession 이 기록을 확정할 때(완료·중단) 부른다.
function queueFamilySync(record) {
  if (!family.sendEnabled) return;
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
  let force = options.force === true; // 기록이 없어도 아이 이름·세트 목록을 한 번 보낸다
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
          records,
          sets: sets.map((s) => ({ name: s.name, count: s.words.length })),
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

// ---- 설정 화면(아이 기기 + 보호자 폰) ----
function renderFamilySettings(progress) {
  const pill = $("familyState");
  pill.textContent = !family.sendEnabled ? "꺼짐" : family.pending.length ? `보낼 기록 ${family.pending.length}개` : syncInFlight ? "보내는 중" : "기록 보내기 켜짐";
  $("syncNow").disabled = !syncReady() || syncInFlight;
  let text = progress || "", type = "info";
  if (!text) {
    if (!family.sendEnabled) text = "꺼져 있어요. 아이 이름을 적고 스위치를 켜서 저장하면 시험을 마칠 때마다 기록을 보내요.";
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
  $("tabFamily").classList.toggle("hidden", !family.parentCode);
}
$("saveFamily").onclick = () => {
  const name = tidy($("childName").value).slice(0, 20);
  const enable = $("familySend").checked;
  if (enable && !name) {
    setFeedback($("familyStatus"), "bad", "아이 이름을 먼저 적어 주세요.");
    return;
  }
  if (enable && !syncPasscode()) {
    setFeedback($("familyStatus"), "bad", "먼저 위의 ‘보호자 설정 · AI 연결’에서 접속 코드를 저장하세요.");
    return;
  }
  if (!family.childId) family.childId = crypto.randomUUID();
  const turningOn = enable && !family.sendEnabled;
  family.childName = name;
  family.sendEnabled = enable;
  family.lastError = "";
  if (turningOn) family.pending = [...new Set([...historyRecords.map((r) => r.id), ...family.pending])]; // 처음 켤 때는 지금까지의 기록도 함께 보낸다
  if (!writeFamily()) {
    setFeedback($("familyStatus"), "bad", "저장 실패: 브라우저 저장 공간을 확인하세요.");
    return;
  }
  $("childName").value = family.childName;
  if (enable) flushFamilySync({ force: true });
  else renderFamilySettings("저장했어요. 이제 기록을 보내지 않아요.");
};
$("syncNow").onclick = () => flushFamilySync({ force: true });
$("saveParent").onclick = async () => {
  const code = $("parentCode").value.trim();
  if (code.length < 4) {
    setFeedback($("parentStatus"), "bad", "보호자 코드를 4자 이상 입력하세요.");
    return;
  }
  family.parentCode = code;
  if (!writeFamily()) {
    setFeedback($("parentStatus"), "bad", "저장 실패: 브라우저 저장 공간을 확인하세요.");
    return;
  }
  $("parentCode").value = "";
  renderFamilySettings();
  setFeedback($("parentStatus"), "info", "저장했어요. 아이들 기록을 확인하는 중…");
  $("saveParent").disabled = true;
  try {
    const data = await familyRequest("/family", { method: "GET", passcode: code });
    cacheFamily(data);
    setFeedback($("parentStatus"), "good", `연결 성공 · 기록을 보낸 아이 ${familyData.children.length}명. 아래 ‘아이들’ 탭에서 볼 수 있어요.`);
  } catch (e) {
    setFeedback($("parentStatus"), "bad", "연결 실패: " + e.message);
  } finally {
    $("saveParent").disabled = false;
  }
};
$("clearParent").onclick = () => {
  family.parentCode = "";
  writeFamily();
  familyData = null;
  try {
    localStorage.removeItem(FAMILY_CACHE_KEY);
  } catch {}
  renderFamilySettings();
  setFeedback($("parentStatus"), "info", "보호자 코드를 삭제했어요. ‘아이들’ 탭이 사라져요.");
  if (currentView === "family") showView("settings");
};

// ---- 보호자 폰: 아이들 화면 ----
let familyData = null; // 마지막 /family 응답 {children, serverTime, fetchedAt}
let familyDetail = null; // 열어 둔 아이 {child, records}
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
// showView("family") 가 부른다: 캐시를 먼저 그리고 새로 불러온다.
function renderFamily() {
  loadFamilyCache();
  $("childDetail").classList.add("hidden");
  familyDetail = null;
  renderChildren();
  refreshFamily();
}
// 오늘·최근 7일은 이 폰의 현지 날짜로 센다(서버는 UTC로 저장).
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
  const list = $("childrenList");
  list.textContent = "";
  if (!familyData) {
    list.textContent = "아직 불러온 기록이 없어요.";
    return;
  }
  if (!familyData.children.length) {
    list.textContent = "아직 기록을 보낸 아이가 없어요. 아이 기기의 설정 → 가족 기록함에서 이름을 적고 ‘시험 기록을 보호자에게 보내기’를 켜 주세요.";
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
    detail.textContent = "기록 자세히 보기";
    detail.addEventListener("click", () => openChild(c));
    actions.append(detail);
    card.append(head, last, dots, week, actions);
    list.append(card);
  }
}
async function openChild(c) {
  familyDetail = { child: c, records: Array.isArray(c.records) ? c.records : [] };
  $("childDetail").classList.remove("hidden");
  $("childDetailTitle").textContent = "🧒 " + c.name;
  renderChildRecords("전체 기록을 불러오는 중…");
  $("childDetail").scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const data = await familyRequest("/family/" + encodeURIComponent(c.id), { method: "GET", passcode: family.parentCode });
    if (familyDetail?.child.id !== c.id) return;
    familyDetail = { child: data.child || c, records: Array.isArray(data.records) ? data.records : [] };
    renderChildRecords();
  } catch (e) {
    if (familyDetail?.child.id === c.id) renderChildRecords("전체 기록을 불러오지 못했어요: " + e.message + " · 최근 기록만 보여 줘요.");
  }
}
function renderChildRecords(note) {
  const { child, records } = familyDetail;
  const sorted = records.slice().sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  const avg = sorted.length ? Math.round(sorted.reduce((s, r) => s + pctOf(r), 0) / sorted.length) : 0;
  const setsText = (Array.isArray(child.sets) ? child.sets : []).map((s) => `${s.name} ${s.count}단어`).join(", ");
  $("childDetailSummary").textContent =
    `시험 ${sorted.length}회` + (sorted.length ? ` · 평균 ${avg}점` : "") + (setsText ? ` · 세트: ${setsText}` : "") + (note ? " · " + note : "");
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
    score.textContent = `${r.correct} / ${r.total} · ${pctOf(r)}점${r.partial ? " · 중단" : ""}`;
    head.append(score);
    const meta = document.createElement("p");
    meta.className = "history-meta";
    const duration = durationText(r.activeMs);
    meta.textContent = `${new Date(r.completedAt).toLocaleString("ko-KR")} · ${r.setName} · ${modeLabels[r.mode] || r.mode} · ${r.range}` + (duration ? ` · ${duration}` : "");
    entry.append(head, meta);
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
$("closeChildDetail").onclick = () => {
  $("childDetail").classList.add("hidden");
  familyDetail = null;
};
$("refreshFamily").onclick = () => refreshFamily();
$("deleteChild").onclick = async () => {
  const c = familyDetail?.child;
  if (!c) return;
  if (!confirm(`‘${c.name}’의 기록을 가족 서버에서 모두 지울까요? 아이 기기에 있는 기록은 그대로예요.`)) return;
  $("deleteChild").disabled = true;
  try {
    await familyRequest("/family/" + encodeURIComponent(c.id), { method: "DELETE", passcode: family.parentCode });
    $("childDetail").classList.add("hidden");
    familyDetail = null;
    if (familyData) cacheFamily({ ...familyData, children: familyData.children.filter((x) => x.id !== c.id) });
    renderChildren();
    setFeedback($("familyLoadStatus"), "info", `‘${c.name}’의 기록을 지웠어요.`);
  } catch (e) {
    setFeedback($("familyLoadStatus"), "bad", "지우지 못했어요: " + e.message);
  } finally {
    $("deleteChild").disabled = false;
  }
};

// sets.js 가 보호자 설정을 준비한 뒤 부른다.
function initFamily() {
  $("childName").value = family.childName;
  $("familySend").checked = family.sendEnabled;
  renderFamilySettings();
  if (family.sendEnabled && family.pending.length) flushFamilySync();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && family.pending.length) flushFamilySync();
  });
  window.addEventListener("online", () => {
    if (family.pending.length) flushFamilySync();
  });
}
