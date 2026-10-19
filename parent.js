"use strict";
// parent.js — 보호자 앱(parent.html). shared.js · editor.js 다음에 불러온다. 전역은 window.ParentApp(디버깅·테스트용: store, router, computeStats, api) 하나.
// 흐름: storage(daily_vocab_parent_v1, 옛 키는 처음 한 번 이전) → store(patch 마다 저장 + 화면 다시 그리기) → api(Shared.apiRequest + 보호자 코드)
//       → router(해시 라우트; 뒤로 가기 = 해시 history) → views(라우트마다 한 화면을 store 스냅샷으로 그림) → actions(요청 → store.patch → 결과는 토스트·칸 아래 문구).
// 캐시 우선: 마지막 응답을 먼저 그리고 앱 시작·화면 복귀·온라인 복귀·화면 진입 때 10분이 지났으면 뒤에서 새로 받는다.
// 목록은 Shared.h 로 만들고(innerHTML 없음), 폼은 parent.html 의 정적 마크업에 값만 채운다(테스트가 보는 ID 유지).
// 라우트: #/ 오늘 · #/children 아이들 · #/child/<id>/<records|sets|daily|settings|questions> · #/child/<id>/sets/<new|세트 id> 편집기 · #/settings · #/setup(코드 없으면 언제나 여기)
(function () {
  // ===== [core] 상수·도우미·저장소·상태·서버 요청·라우터·그리기 =====
  const { $, h, setFeedback, tidy, formatCode, hourLabel, relativeTime, durationText, dayKey, pctOf, WEEKDAYS, modeLabels,
    AI_SERVER_DEFAULT, normalizeServer, PLAN_LEVELS, TIME_LIMIT_CHOICES, planDefaults, apiRequest, readJson, writeJson } = Shared;
  const PARENT_KEY = "daily_vocab_parent_v1";
  // 옛 아이 앱 보호자 모드가 쓰던 키(처음 한 번 이전한 뒤 보호자 것만 지운다. 아이 키의 다른 필드는 건드리지 않는다)
  const OLD_FAMILY_KEY = "daily_vocab_family_v1", OLD_AI_KEY = "daily_vocab_ai_v2", OLD_CACHE_KEY = "daily_vocab_family_cache_v1", OLD_MODE_KEY = "daily_vocab_mode_v1";
  const STALE_MS = 10 * 60 * 1000; // 이보다 오래된 캐시는 뒤에서 새로 받는다
  const RECORDS_KEEP = 200; // 아이 상세에 캐시·표시하는 최신 기록 수(나머지는 C단계 ‘더 보기’)
  const STORE_LIMIT = 1000000; // 저장 크기(문자) 상한: 넘으면 가장 오래 본 아이의 상세부터 저장하지 않는다
  const TIMEOUT_MS = 20000, SETS_TIMEOUT_MS = 60000, DAILY_TIMEOUT_MS = 90000, AI_TIMEOUT_MS = 130000;
  const JOIN_CODE = /^\d{6}$/;
  const TABS = ["records", "sets", "daily", "settings", "questions"];
  const VIEW_IDS = ["setup", "today", "children", "child", "editor", "settings"];
  const NOTE_IDS = ["setsStatus", "planStatus", "linkStatus", "nameStatus", "limitStatus", "deleteStatus"];

  const enc = encodeURIComponent;
  const nowIso = () => new Date().toISOString();
  const isFresh = (iso) => Boolean(iso) && Date.now() - Date.parse(iso) < STALE_MS;
  const timeText = (iso) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  const dateText = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  // n일 전 0시(현지 시각)의 ms
  const startOfDay = (daysAgo) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - daysAgo);
    return d.getTime();
  };
  const avgOf = (rs) => (rs.length ? Math.round(rs.reduce((s, r) => s + pctOf(r), 0) / rs.length) : null);
  const byNewest = (a, b) => String(b.completedAt).localeCompare(String(a.completedAt));
  const linkFor = (code) => new URL("./", location.href).href + "?child=" + code; // 아이용 앱 주소(…/daily-vocab/?child=코드)
  const childPath = (id, tab) => "#/child/" + enc(id) + (tab && tab !== "records" ? "/" + tab : "");
  const editorPath = (id, setId) => "#/child/" + enc(id) + "/sets/" + (setId ? enc(setId) : "new");
  const validChild = (c) => Boolean(c && typeof c === "object" && typeof c.id === "string" && c.id && typeof c.name === "string");
  const validRecord = (r) => Boolean(r && typeof r.id === "string" && Number.isFinite(Date.parse(r.completedAt)) && Number.isInteger(r.total) && r.total > 0 && Number.isInteger(r.correct));
  const devicesOf = (c) => Object.values(c?.devices || {}).filter((d) => d && typeof d === "object");
  function devicesSummary(c) {
    const counts = new Map();
    for (const d of devicesOf(c)) counts.set(d.label || "기기", (counts.get(d.label || "기기") || 0) + 1);
    return [...counts].map(([label, n]) => `${label} ${n}`).join(" · ");
  }

  // ---- 저장소: daily_vocab_parent_v1 ----
  // { parentCode, server, children:[GET /family 의 아이(최근 기록 포함)], details:{ [id]: {child, records(최신 200), recordTotal, questions, today, fetchedAt, viewedAt} },
  //   fetchedAt, prefs:{ recordsSet, recordsDays } }
  const emptyState = () => ({ parentCode: "", server: AI_SERVER_DEFAULT, children: [], details: {}, fetchedAt: "", prefs: { recordsSet: "all", recordsDays: 30 } });
  function normalizeListChild(c) {
    return { ...c, records: (Array.isArray(c.records) ? c.records : []).filter(validRecord).sort(byNewest) };
  }
  function sanitize(saved) {
    const s = emptyState();
    if (!saved || typeof saved !== "object") return s;
    if (typeof saved.parentCode === "string") s.parentCode = saved.parentCode.trim();
    s.server = normalizeServer(saved.server) || AI_SERVER_DEFAULT;
    if (Array.isArray(saved.children)) s.children = saved.children.filter(validChild).map(normalizeListChild);
    if (saved.details && typeof saved.details === "object")
      for (const [id, d] of Object.entries(saved.details))
        if (d && typeof d === "object" && validChild(d.child))
          s.details[id] = {
            ...d,
            records: (Array.isArray(d.records) ? d.records : []).filter(validRecord),
            questions: Array.isArray(d.questions) ? d.questions.filter((q) => q && typeof q === "object") : null,
          };
    if (typeof saved.fetchedAt === "string") s.fetchedAt = saved.fetchedAt;
    const p = saved.prefs;
    if (p && typeof p === "object") {
      if (typeof p.recordsSet === "string") s.prefs.recordsSet = p.recordsSet;
      if ([0, 7, 30].includes(p.recordsDays)) s.prefs.recordsDays = p.recordsDays;
    }
    return s;
  }
  // 처음 한 번: 옛 보호자 모드(아이 앱 index.html?mode=parent)의 보호자 코드·서버 주소·목록 캐시를 가져오고, 보호자 것만 지운다.
  function migrate() {
    const existing = readJson(PARENT_KEY, (v) => v && typeof v === "object" && !Array.isArray(v));
    if (existing) return sanitize(existing);
    const state = emptyState();
    const fam = readJson(OLD_FAMILY_KEY, (v) => v && typeof v === "object" && !Array.isArray(v));
    const ai = readJson(OLD_AI_KEY, (v) => v && typeof v === "object");
    const cache = readJson(OLD_CACHE_KEY, (v) => v && typeof v === "object");
    if (typeof fam?.parentCode === "string") state.parentCode = fam.parentCode.trim();
    state.server = normalizeServer(ai?.server) || AI_SERVER_DEFAULT;
    if (Array.isArray(cache?.children)) {
      state.children = cache.children.filter(validChild).map(normalizeListChild);
      if (typeof cache.fetchedAt === "string") state.fetchedAt = cache.fetchedAt;
    }
    if (!writeJson(PARENT_KEY, state)) return state; // 저장하지 못하면 옛 키를 지우지 않는다(다음에 다시 이전)
    try {
      localStorage.removeItem(OLD_CACHE_KEY);
      localStorage.removeItem(OLD_MODE_KEY);
    } catch {}
    if (fam && ("parentCode" in fam || "parentModeOff" in fam)) {
      const { parentCode, parentModeOff, ...rest } = fam; // 아이 기기 연결 정보(childId 등)는 그대로 둔다
      writeJson(OLD_FAMILY_KEY, rest);
    }
    return state;
  }
  // 저장: 너무 크거나 저장 공간이 모자라면 가장 오래 본 아이의 상세부터 빼고 다시 시도한다(화면의 상태는 그대로).
  function persist(state) {
    let s = state;
    for (let attempt = 0; attempt < 20; attempt++) {
      const text = JSON.stringify(s);
      if (text.length <= STORE_LIMIT) {
        try {
          localStorage.setItem(PARENT_KEY, text);
          return true;
        } catch {}
      }
      const ids = Object.keys(s.details);
      if (!ids.length) break;
      const oldest = ids.sort((a, b) => String(s.details[a].viewedAt || "").localeCompare(String(s.details[b].viewedAt || "")))[0];
      const { [oldest]: dropped, ...rest } = s.details;
      s = { ...s, details: rest };
    }
    return writeJson(PARENT_KEY, { ...s, details: {} });
  }
  function createStore(initial) {
    let state = initial;
    const subscribers = new Set();
    return {
      get: () => state,
      patch(partial) {
        state = { ...state, ...(typeof partial === "function" ? partial(state) : partial) };
        persist(state);
        for (const fn of subscribers) fn(state);
      },
      subscribe(fn) {
        subscribers.add(fn);
        return () => subscribers.delete(fn);
      },
    };
  }
  const store = createStore(migrate());

  // ---- 아이 데이터 읽기·고치기 (목록 children[] 과 상세 details[id].child 를 함께 맞춘다) ----
  function childById(id) {
    const s = store.get();
    return s.children.find((c) => c.id === id) || s.details[id]?.child || null;
  }
  // 그 아이의 기록: 상세(최신 200개)와 목록(최근 14일)을 합친다(겹치는 id 는 한 번).
  function recordsOf(id) {
    const s = store.get();
    const list = s.children.find((c) => c.id === id)?.records || [];
    const detail = s.details[id]?.records || [];
    if (!detail.length) return list;
    const seen = new Set(detail.map((r) => r.id));
    return [...detail, ...list.filter((r) => !seen.has(r.id))].sort(byNewest);
  }
  // 목록의 오늘 요약(today: {date, exists, count, completed})을 상세의 오늘(단어 포함)에 맞춘다.
  function mergeToday(full, summary) {
    if (!summary) return full || null;
    if (full && full.date === summary.date) return { ...full, exists: summary.exists, completed: summary.completed || null };
    return { date: summary.date, exists: Boolean(summary.exists), words: [], note: "", completed: summary.completed || null };
  }
  // 서버 응답의 child 하나로 목록·상세를 함께 갱신한다(records·today 는 있을 때만 바꾼다).
  function putChild(child) {
    if (!validChild(child)) return;
    const { records, today, ...info } = child;
    store.patch((s) => {
      const exists = s.children.some((c) => c.id === child.id);
      const children = exists
        ? s.children.map((c) => (c.id === child.id ? { ...c, ...info, ...(Array.isArray(records) ? { records: records.filter(validRecord).sort(byNewest) } : {}), ...(today ? { today } : {}) } : c))
        : [...s.children, { ...info, records: Array.isArray(records) ? records.filter(validRecord).sort(byNewest) : [], today: today || null }];
      const d = s.details[child.id];
      const details = d ? { ...s.details, [child.id]: { ...d, child: { ...d.child, ...info }, today: today ? mergeToday(d.today, today) : d.today } } : s.details;
      return { children, details };
    });
  }
  function patchChild(id, fields) {
    const c = childById(id);
    if (c) putChild({ id, name: c.name, ...fields });
  }
  // 계획 저장 응답: child 가 오면 그것으로, 없으면 보낸 값으로 plan 을 맞춘다.
  function putPlan(id, data, sent) {
    if (validChild(data?.child)) putChild({ ...data.child, plan: data.child.plan || { ...planDefaults(childById(id)?.plan), ...sent } });
    else patchChild(id, { plan: { ...planDefaults(childById(id)?.plan), ...sent } });
  }
  function removeChild(id) {
    store.patch((s) => {
      const { [id]: dropped, ...details } = s.details;
      return { children: s.children.filter((c) => c.id !== id), details };
    });
    for (const key of [...notes.keys()]) if (key.startsWith(id + ":")) notes.delete(key);
  }
  // GET /family 응답 → 목록 교체. 상세는 아직 있는 아이만 남기고 이름·계획 등을 목록에 맞춘다.
  function listPatch(s, data) {
    const list = (Array.isArray(data?.children) ? data.children : []).filter(validChild).map(normalizeListChild);
    const details = {};
    for (const [id, d] of Object.entries(s.details)) {
      const fresh = list.find((c) => c.id === id);
      if (!fresh) continue;
      const { records, today, ...info } = fresh;
      details[id] = { ...d, child: { ...d.child, ...info }, today: mergeToday(d.today, today) };
    }
    return { children: list, details, fetchedAt: nowIso() };
  }

  // ---- 통계 (순수 함수): 이 폰의 현지 날짜 기준 ----
  // records: 압축 기록 [{completedAt, total, correct, setName, missed, awayCount, timeouts, …}]. days: 날짜 띠·창 크기(0 = 전체).
  // → { today, week(최근 7일), prevWeek(그 앞 7일), window(days 창), streak(오늘 또는 어제까지 연속 학습일), days:[{key, weekday, label, count, avg, today}],
  //     bySet:[{name, count, avg, last}](창 안), missedTop:[{en, ko, n}](최근 2주 상위 10) }  각 요약 = {count, avg, away, timeouts}
  function computeStats(records, { days = 30, now = new Date() } = {}) {
    const list = (Array.isArray(records) ? records : []).filter((r) => r && Number.isFinite(Date.parse(r.completedAt))).sort(byNewest);
    const noon = new Date(now);
    noon.setHours(12, 0, 0, 0);
    const dayAt = (offset) => {
      const d = new Date(noon);
      d.setDate(noon.getDate() - offset);
      return d;
    };
    const byDay = new Map();
    for (const r of list) {
      const k = dayKey(r.completedAt);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(r);
    }
    const span = (from, to) => {
      const out = [];
      for (let i = from; i <= to; i++) out.push(...(byDay.get(dayKey(dayAt(i))) || []));
      return out;
    };
    const sum = (rs) => ({ count: rs.length, avg: avgOf(rs), away: rs.reduce((s, r) => s + (r.awayCount || 0), 0), timeouts: rs.reduce((s, r) => s + (r.timeouts || 0), 0) });
    const dayList = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = dayAt(i);
      const rs = byDay.get(dayKey(d)) || [];
      dayList.push({ key: dayKey(d), weekday: WEEKDAYS[d.getDay()], label: `${d.getMonth() + 1}/${d.getDate()}`, count: rs.length, avg: avgOf(rs), today: i === 0 });
    }
    let streak = 0;
    for (let i = byDay.has(dayKey(dayAt(0))) ? 0 : 1; i < 400 && byDay.has(dayKey(dayAt(i))); i++) streak++;
    const windowRecords = (days > 0 ? span(0, days - 1) : list).sort(byNewest);
    const sets = new Map();
    for (const r of windowRecords) {
      const name = String(r.setName || "");
      if (!sets.has(name)) sets.set(name, { name, records: [] });
      sets.get(name).records.push(r);
    }
    const counts = new Map();
    for (const r of span(0, 13))
      for (const m of Array.isArray(r.missed) ? r.missed : []) {
        const key = String(m?.en || "").toLowerCase();
        if (!key) continue;
        const entry = counts.get(key) || { en: m.en, ko: m.ko || "", n: 0 };
        entry.n++;
        counts.set(key, entry);
      }
    return {
      today: sum(span(0, 0)),
      week: sum(span(0, 6)),
      prevWeek: sum(span(7, 13)),
      window: sum(windowRecords),
      streak,
      days: dayList,
      bySet: [...sets.values()].map((x) => ({ name: x.name, count: x.records.length, avg: avgOf(x.records), last: x.records[0] })),
      missedTop: [...counts.values()].sort((a, b) => b.n - a.n || a.en.localeCompare(b.en)).slice(0, 10),
    };
  }

  // ---- 서버 요청 (보호자 코드) ----
  const api = {
    request(path, { method = "GET", body, timeout = TIMEOUT_MS, passcode } = {}) {
      const s = store.get();
      return apiRequest(s.server, path, { method, body, passcode: passcode ?? s.parentCode, timeout });
    },
    verifyCode: (code) => api.request("/family", { passcode: code }),
    listChildren: () => api.request("/family"),
    childDetail: (id) => api.request("/family/" + enc(id)),
    getSet: (id, setId) => api.request(`/family/${enc(id)}/sets/${enc(setId)}`, { timeout: SETS_TIMEOUT_MS }),
    sendSet: (id, set) => api.request(`/family/${enc(id)}/sets`, { method: "POST", body: { set }, timeout: SETS_TIMEOUT_MS }),
    deleteSet: (id, setId) => api.request(`/family/${enc(id)}/sets/${enc(setId)}`, { method: "DELETE" }),
    savePlan: (id, patch) => api.request(`/family/${enc(id)}/plan`, { method: "POST", body: patch }),
    createChild: (name) => api.request("/family/children", { method: "POST", body: { name } }),
    renameChild: (id, name) => api.request(`/family/${enc(id)}/name`, { method: "POST", body: { name } }),
    regenCode: (id) => api.request(`/family/${enc(id)}/code`, { method: "POST", body: {} }),
    deleteChild: (id) => api.request("/family/" + enc(id), { method: "DELETE" }),
    makeDaily: (id) => api.request("/daily/" + enc(id), { method: "POST", body: {}, timeout: DAILY_TIMEOUT_MS }),
  };
  const WRONG_CODE = "보호자 코드가 맞지 않아요. 다시 입력해 주세요.";
  let setupNote = null; // 코드 입력 화면에 보일 안내 {kind, text}
  let offlineToastShown = false;
  // 요청 실패 → 보일 문구. 401(보호자 코드가 틀림)은 코드 입력 화면으로 보낸다(코드는 지우지 않음). 서버에 닿지 못하면 캐시를 그대로 두고 토스트는 한 번만.
  function failure(e) {
    if (e?.status === 401) {
      setupNote = { kind: "bad", text: WRONG_CODE };
      if (router.current.name !== "setup") router.go("#/setup");
      else render();
      return WRONG_CODE;
    }
    const text = e?.message || String(e);
    if (e?.status === 0 && e.code !== "aborted") {
      if (!offlineToastShown) toast(text + " 마지막으로 확인한 내용을 보여 줘요.", "bad");
      offlineToastShown = true;
    }
    return text;
  }

  // ---- 토스트·칸 아래 문구 ----
  let toastTimer = 0;
  function toast(text, kind = "info") {
    const el = $("toast");
    el.textContent = text;
    el.className = "toast " + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), kind === "bad" ? 5000 : 3500);
  }
  // 아이 화면의 결과 문구(#setsStatus 등)는 아이별로 기억했다가 그 아이 화면을 그릴 때 다시 보여 준다.
  const notes = new Map(); // "아이 id:요소 id" → {kind, text}
  function note(childId, id, kind, text) {
    notes.set(childId + ":" + id, { kind, text });
    if (router.current.id === childId) setFeedback($(id), kind, text);
  }
  function showNotes(childId) {
    for (const id of NOTE_IDS) {
      const n = notes.get(childId + ":" + id);
      setFeedback($(id), n?.kind || "info", n?.text || "");
    }
  }
  async function copyText(text, label, childId) {
    let message, kind = "good";
    try {
      await navigator.clipboard.writeText(text);
      message = `${label}을(를) 복사했어요. 카톡 등으로 아이 기기에 보내 주세요.`;
    } catch {
      message = `${label}: ${text} (길게 눌러 복사하세요)`;
      kind = "info";
    }
    toast(message, kind);
    if (childId) note(childId, "linkStatus", kind, message);
  }

  // ---- 불러오기 ----
  let loading = false, lastLoadError = "";
  const detailLoading = new Set(), detailErrors = new Map();
  // 아이 목록(GET /family). force 가 아니면 10분이 지났을 때만.
  async function refreshAll({ force = false } = {}) {
    const s = store.get();
    if (!s.parentCode || loading || (!force && isFresh(s.fetchedAt))) return;
    loading = true;
    renderLoadStatus();
    try {
      const data = await api.listChildren();
      lastLoadError = "";
      offlineToastShown = false;
      store.patch((st) => listPatch(st, data));
    } catch (e) {
      lastLoadError = failure(e);
      if (e?.status && e.status !== 401) toast(lastLoadError, "bad");
    } finally {
      loading = false;
      renderLoadStatus();
      scheduleRender();
    }
  }
  // 아이 상세(GET /family/<id>): 기록은 최신 200개만 캐시하고, 질문·오늘의 단어도 함께 둔다.
  async function loadDetail(id, { force = false } = {}) {
    const s = store.get();
    const d = s.details[id];
    if (!s.parentCode || detailLoading.has(id) || (!force && d && isFresh(d.fetchedAt))) return;
    detailLoading.add(id);
    scheduleRender();
    try {
      const data = await api.childDetail(id);
      const all = (Array.isArray(data?.records) ? data.records : []).filter(validRecord).sort(byNewest);
      const child = validChild(data?.child) ? data.child : childById(id);
      const at = nowIso();
      detailErrors.delete(id);
      store.patch((st) => ({
        details: {
          ...st.details,
          [id]: {
            child: { ...(st.details[id]?.child || {}), ...child, records: undefined, today: undefined },
            records: all.slice(0, RECORDS_KEEP),
            recordTotal: all.length,
            questions: (Array.isArray(data?.questions) ? data.questions : []).filter((q) => q && typeof q === "object"),
            today: data?.today || null,
            fetchedAt: at,
            viewedAt: at,
          },
        },
      }));
      if (validChild(data?.child)) putChild(data.child);
    } catch (e) {
      if (e?.code === "unknown_child") {
        const name = childById(id)?.name || "그 아이";
        removeChild(id);
        toast(`‘${name}’은(는) 서버에 없어요. 목록을 새로 불러왔어요.`, "bad");
        if (router.current.id === id) router.replace("#/children");
        refreshAll({ force: true });
      } else detailErrors.set(id, failure(e));
    } finally {
      detailLoading.delete(id);
      scheduleRender();
    }
  }
  function autoRefresh() {
    if (router.current.name === "setup") return; // 코드 입력 화면에서는 묻지 않는다(틀린 코드로 되풀이하지 않게)
    refreshAll();
    const id = router.current.id;
    if (id) loadDetail(id);
  }
  function renderLoadStatus() {
    const s = store.get();
    const el = $("familyLoadStatus");
    if (!s.parentCode) el.textContent = "아이들 기록 · 오늘의 단어 · 세트 관리";
    else if (loading) el.textContent = "아이들 기록을 불러오는 중…";
    else if (lastLoadError) el.textContent = (s.fetchedAt ? `마지막 확인 ${relativeTime(s.fetchedAt)} · ` : "") + "새로 불러오지 못했어요";
    else if (s.fetchedAt)
      el.textContent = (Date.now() - Date.parse(s.fetchedAt) < 60000 ? "방금 확인했어요" : "마지막 확인 " + relativeTime(s.fetchedAt)) + " · " + timeText(s.fetchedAt);
    else el.textContent = "아직 불러온 기록이 없어요";
    $("refreshFamily").disabled = loading;
  }

  // ---- 라우터 (해시) ----
  function parseRoute(hash) {
    let parts;
    try {
      parts = String(hash || "").replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    } catch {
      parts = [];
    }
    const [a, b, c, d] = parts;
    if (a === "children" && !b) return { name: "children" };
    if (a === "settings") return { name: "settings" };
    if (a === "setup") return { name: "setup" };
    if (a === "child" && b) {
      if (c === "sets" && d) return { name: "editor", id: b, setId: d === "new" ? null : d, tab: "sets" };
      return { name: "child", id: b, tab: TABS.includes(c) ? c : "records" };
    }
    return { name: "today" };
  }
  const navIdx = () => (Number.isInteger(history.state?.idx) ? history.state.idx : 0);
  let lastIdx = 0;
  const router = {
    current: { name: "" },
    go(path) {
      if (location.hash === path) render();
      else location.hash = path;
    },
    replace(path) {
      history.replaceState({ idx: navIdx() }, "", path);
      onRoute();
    },
    // 앱 안에서 온 화면이면 history 로 되돌아가고, 처음 연 화면이면 fallback 으로 바꾼다(앱을 벗어나지 않게).
    back(fallback = "#/") {
      if (navIdx() > 0) history.back();
      else router.replace(fallback);
    },
  };
  // 편집기 상태(세트 화면 절에서 쓴다): 열어 둔 편집기의 라우트 키와 서버에서 받은 원래 세트
  // editorDone: 저장·닫기로 닫은 편집기의 키(해시가 바뀌기 전에 render 가 다시 열지 않게)
  let editorKey = "", editingSet = null, editorDone = "";
  const editorKeyOf = (r) => (r?.name === "editor" ? r.id + "/" + (r.setId || "new") : "");
  function onRoute() {
    const next = parseRoute(location.hash);
    const prev = router.current;
    // 편집기를 떠날 때: 저장하지 않은 초안이 있으면 묻고, 취소하면 편집기로 되돌린다.
    if (editorKey && SetEditor.isOpen() && editorKeyOf(next) !== editorKey) {
      if (!SetEditor.confirmDiscard()) {
        if (navIdx() < lastIdx) history.forward();
        else history.back();
        return;
      }
      SetEditor.close();
      editorKey = "";
      editingSet = null;
    }
    if (editorKeyOf(next) !== editorKeyOf(prev)) editorDone = "";
    const s = store.get();
    if (!s.parentCode && next.name !== "setup") {
      router.replace("#/setup");
      return;
    }
    if (next.id !== prev.id) {
      if (prev.id) for (const key of [...notes.keys()]) if (key.startsWith(prev.id + ":")) notes.delete(key);
      if (next.id && s.details[next.id]) store.patch((st) => (st.details[next.id] ? { details: { ...st.details, [next.id]: { ...st.details[next.id], viewedAt: nowIso() } } } : {}));
      resetChildForms();
    }
    const moved = prev.name !== next.name || prev.id !== next.id;
    router.current = next;
    lastIdx = navIdx();
    render();
    if (moved) window.scrollTo({ top: 0, behavior: "auto" });
    autoRefresh();
  }

  // ---- 그리기: 라우트의 화면 하나만 보이고, store 가 바뀔 때마다 다시 그린다 ----
  const views = {}; // 화면 이름 → 그리는 함수(아래 화면 절에서 채운다)
  const panels = {}; // 아이 화면 하위 탭 → 그리는 함수
  const formResets = []; // 다른 아이로 옮길 때 폼 상태를 지우는 함수들
  function resetChildForms() {
    for (const fn of formResets) fn();
  }
  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => {
      renderQueued = false;
      render();
    });
  }
  function render() {
    const s = store.get();
    let r = router.current;
    document.body.classList.toggle("no-code", !s.parentCode);
    let name = r.name;
    if (name === "editor") {
      if (views.editor?.(r)) name = "editor";
      else {
        name = "child"; // 세트를 불러오는 동안은 세트 탭을 보여 준다
        r = { ...r, name: "child", tab: "sets" };
      }
    }
    for (const id of VIEW_IDS) $(id).classList.toggle("active", id === name);
    const tab = name === "today" ? "tabToday" : name === "settings" ? "tabSettings" : ["children", "child", "editor"].includes(name) ? "tabChildren" : "";
    for (const t of ["tabToday", "tabChildren", "tabSettings"]) {
      $(t).classList.toggle("active", t === tab);
      $(t).setAttribute("aria-current", t === tab ? "page" : "false");
    }
    renderLoadStatus();
    if (name !== "editor") views[name]?.(r);
  }

  // ===== [setup] 코드 입력 (#/setup) =====
  views.setup = () => {
    if (setupNote) setFeedback($("parentSetupStatus"), setupNote.kind, setupNote.text);
  };
  // 보호자 코드를 GET /family 로 확인한 뒤에만 저장한다(틀린 코드는 저장하지 않는다). 성공하면 받은 목록이 곧 첫 화면의 캐시다.
  async function verifyAndSave(input, button, status, done) {
    const code = input.value.trim();
    if (code.length < 4) {
      setFeedback(status, "bad", "보호자 코드를 4자 이상 입력하세요.");
      return;
    }
    button.disabled = true;
    setFeedback(status, "info", "보호자 코드를 확인하는 중…");
    try {
      const data = await api.verifyCode(code);
      input.value = "";
      setupNote = null;
      lastLoadError = "";
      offlineToastShown = false;
      store.patch((s) => ({ parentCode: code, ...listPatch(s, data) }));
      const text = `연결 성공 · 등록된 아이 ${store.get().children.length}명`;
      setFeedback(status, "good", text);
      done?.(text);
    } catch (e) {
      setFeedback(status, "bad", e?.status === 401 ? WRONG_CODE : e?.message || String(e));
    } finally {
      button.disabled = false;
    }
  }
  $("saveParentStart").onclick = () =>
    verifyAndSave($("parentCodeStart"), $("saveParentStart"), $("parentSetupStatus"), (text) => {
      toast(text, "good");
      router.replace("#/");
    });
  $("parentCodeStart").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("saveParentStart").click();
  });

  // ===== [today] 오늘 (#/): 아이마다 카드 한 장 =====
  function dailyText(c) {
    const plan = planDefaults(c.plan);
    if (!plan.enabled) return "📬 오늘의 단어 꺼짐";
    const t = c.today;
    if (t?.completed) return `오늘의 단어 ✅ ${t.completed.correct} / ${t.completed.total}`;
    if (t?.exists) return "📬 오늘의 단어 도착 · 아직 안 풀었어요";
    return `📬 오늘의 단어 아직 없음 (${hourLabel(plan.hour)}에 만들어요)`;
  }
  function weekStrip(days) {
    return h(
      "div",
      { class: "week-dots", "aria-label": "최근 7일 시험" },
      days.map((d) =>
        h(
          "span",
          { class: "day" + (d.count ? " done" : "") + (d.today ? " today" : ""), title: d.count ? `${d.label}: ${d.count}회 · 평균 ${d.avg}점` : `${d.label}: 시험 없음` },
          h("small", null, d.weekday),
          h("b", null, d.count ? `${d.avg}점` : "·"),
        ),
      ),
    );
  }
  function trendText(week, prev) {
    const parts = [`이번 주 ${week.count}회` + (week.count ? ` · 평균 ${week.avg}점` : "")];
    parts.push(prev.count ? `지난주 ${prev.count}회 · ${prev.avg}점` : "지난주 기록 없음");
    const line = h("p", { class: "muted" }, parts.join(" · "));
    if (week.count && prev.count && week.avg !== prev.avg) {
      const up = week.avg > prev.avg;
      line.append(" ", h("span", { class: up ? "trend-up" : "trend-down" }, `${up ? "▲" : "▼"} ${Math.abs(week.avg - prev.avg)}점`));
    }
    return line;
  }
  function childCard(c) {
    const linked = devicesOf(c).length > 0;
    const go = () => router.go(childPath(c.id, linked ? "records" : "settings"));
    const card = h("article", { class: "child-card" + (linked ? "" : " unlinked"), dataset: { child: c.id }, tabindex: 0, role: "link", "aria-label": `${c.name} 자세히 보기`, onclick: go });
    card.onkeydown = (e) => {
      if (e.key === "Enter") go();
    };
    const stop = (fn) => (e) => {
      e.stopPropagation();
      fn();
    };
    const head = h("div", { class: "child-head" }, h("strong", { class: "child-name" }, "🧒 " + c.name));
    if (!linked) {
      // 아직 기기가 없는 아이: 지금 할 일(코드·링크 보내기) 하나만
      const code = JOIN_CODE.test(c.joinCode || "") ? c.joinCode : "";
      head.append(h("span", { class: "pill warn" }, "연결 전"));
      card.append(
        head,
        h("p", { class: "card-line" }, "📲 아이 기기를 연결해 주세요"),
        code ? h("p", { class: "card-line" }, "아이 코드 ", h("strong", { class: "code-text" }, formatCode(code))) : h("p", { class: "muted" }, "아이 코드가 없어요. 설정에서 코드를 새로 만들어 주세요."),
        h(
          "div",
          { class: "actionbar" },
          code ? h("button", { type: "button", class: "btn small primary", onclick: stop(() => copyText(linkFor(code), "아이 전용 링크", c.id)) }, "링크 복사") : null,
          h("button", { type: "button", class: "btn small outline", onclick: stop(go) }, "연결 방법 보기"),
        ),
      );
      return card;
    }
    const records = recordsOf(c.id);
    const stats = computeStats(records, { days: 7 });
    const t = stats.today;
    head.append(
      h(
        "span",
        { class: "badges" },
        h("span", { class: "pill " + (t.count ? "ok" : "warn") }, t.count ? `오늘 시험 ✅ ${t.count}회 · 평균 ${t.avg}점` : "오늘 시험 아직"),
        stats.streak ? h("span", { class: "streak" }, `🔥 ${stats.streak}일`) : null,
      ),
    );
    const latest = records[0];
    const warnings = [t.away ? `⚠️ 오늘 화면 이탈 ${t.away}회` : "", t.timeouts ? `⏱ 시간 초과 ${t.timeouts}개` : ""].filter(Boolean);
    card.append(
      head,
      h("p", { class: "card-line" }, dailyText(c)),
      warnings.length ? h("p", { class: "warn-line" }, warnings.join(" · ")) : null,
      c.questionCount ? h("p", { class: "card-line" }, `📷 물어본 문제 ${c.questionCount}개` + (c.lastQuestionAt ? ` · 마지막 ${relativeTime(c.lastQuestionAt)}` : "")) : null,
      weekStrip(stats.days),
      trendText(stats.week, stats.prevWeek),
      h(
        "p",
        { class: "muted" },
        latest ? `마지막 시험: ${relativeTime(latest.completedAt)} · ${latest.setName} · ${pctOf(latest)}점${latest.partial ? " (중단)" : ""}` : "아직 시험 기록이 없어요.",
      ),
    );
    return card;
  }
  views.today = () => {
    const s = store.get();
    $("todayDate").textContent = dateText(new Date());
    const box = $("familyOverview");
    box.textContent = "";
    if (!s.children.length) {
      const fetched = Boolean(s.fetchedAt);
      box.append(
        h(
          "div",
          { class: "empty-box" },
          h("strong", null, fetched ? "아직 등록된 아이가 없어요" : loading ? "아이들 기록을 불러오는 중…" : "아직 불러온 기록이 없어요"),
          fetched ? h("p", { class: "muted" }, "‘아이 추가’에서 아이를 만들고, 받은 아이 코드를 아이 기기에 넣어 주세요.") : null,
          fetched ? h("div", { class: "actionbar", style: "justify-content:center" }, h("button", { type: "button", class: "btn primary", id: "goAddChild", onclick: () => router.go("#/children") }, "➕ 아이 추가")) : null,
        ),
      );
      return;
    }
    if (!s.children.some((c) => recordsOf(c.id).length))
      box.append(h("p", { class: "muted", style: "grid-column:1/-1;margin:0" }, "아직 기록을 보낸 아이가 없어요. 아이 기기를 연결하면 시험을 마칠 때마다 여기에 보여요."));
    for (const c of s.children) box.append(childCard(c));
  };

  // ===== [records] 아이들 목록 (#/children) · 아이 화면 (#/child/<id>) · 기록 탭 =====
  views.children = () => {
    const s = store.get();
    const list = $("childrenList");
    list.textContent = "";
    if (!s.children.length) {
      list.append(h("p", { class: "muted" }, loading ? "불러오는 중…" : "아직 등록된 아이가 없어요. 아래 ‘아이 추가’에 이름을 적어 아이를 만들고, 받은 아이 코드를 아이 기기에 넣어 주세요."));
      return;
    }
    for (const c of s.children) {
      const summary = devicesSummary(c);
      list.append(
        h(
          "button",
          { type: "button", class: "list-row", dataset: { child: c.id }, onclick: () => router.go(childPath(c.id)) },
          h(
            "span",
            { class: "row-text" },
            h("strong", null, "🧒 " + c.name),
            h("small", null, summary ? "연결 기기: " + summary : JOIN_CODE.test(c.joinCode || "") ? `아직 연결된 기기 없음 · 아이 코드 ${formatCode(c.joinCode)}` : "연결된 기기 정보 없음"),
          ),
          h("span", { class: "chev", "aria-hidden": "true" }, "›"),
        ),
      );
    }
  };
  $("addChild").onclick = async () => {
    const name = tidy($("newChildName").value).slice(0, 20);
    if (!name) {
      setFeedback($("addChildStatus"), "bad", "아이 이름을 적어 주세요.");
      return;
    }
    $("addChild").disabled = true;
    setFeedback($("addChildStatus"), "info", "아이를 만드는 중…");
    try {
      const data = await api.createChild(name);
      if (!validChild(data?.child)) throw Error("서버 응답이 올바르지 않아요.");
      $("newChildName").value = "";
      putChild({ ...data.child, records: [], today: null });
      const text = `‘${data.child.name}’을(를) 만들었어요. 아이 코드 ${formatCode(data.child.joinCode)} · 링크를 복사해 아이 기기로 보내 주세요.`;
      setFeedback($("addChildStatus"), "good", text);
      toast(text, "good");
      router.go(childPath(data.child.id, "settings"));
    } catch (e) {
      setFeedback($("addChildStatus"), "bad", "만들지 못했어요: " + failure(e));
    } finally {
      $("addChild").disabled = false;
    }
  };
  $("newChildName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("addChild").click();
  });

  // 아이 화면 머리: 이름·요약·하위 탭. 탭 내용은 panels[tab].
  views.child = (r) => {
    const s = store.get();
    const c = childById(r.id);
    const d = s.details[r.id];
    for (const t of TABS) {
      const on = t === r.tab;
      $("sub" + t[0].toUpperCase() + t.slice(1)).classList.toggle("active", on);
      $("sub" + t[0].toUpperCase() + t.slice(1)).setAttribute("aria-selected", on ? "true" : "false");
      $("panel" + t[0].toUpperCase() + t.slice(1)).classList.toggle("hidden", !on || !c);
    }
    if (!c) {
      $("childDetailTitle").textContent = "🧒 …";
      $("childDetailSummary").textContent = loading || detailLoading.has(r.id) ? "불러오는 중…" : "그 아이를 찾을 수 없어요. 아이들 목록에서 다시 골라 주세요.";
      return;
    }
    $("childDetailTitle").textContent = "🧒 " + c.name;
    const total = Math.max(d?.recordTotal || 0, Number.isInteger(c.recordCount) ? c.recordCount : 0, recordsOf(c.id).length);
    const sets = Array.isArray(c.sets) ? c.sets.length : 0;
    const devices = devicesOf(c).length;
    const state = detailLoading.has(c.id) ? " · 불러오는 중…" : detailErrors.has(c.id) ? " · " + detailErrors.get(c.id) : "";
    $("childDetailSummary").textContent = `전체 시험 ${total}회 · 세트 ${sets}개 · ` + (devices ? `연결 기기 ${devices}대` : "연결된 기기 없음") + state;
    panels[r.tab]?.(c, d, r);
    showNotes(c.id);
  };
  for (const t of TABS)
    $("sub" + t[0].toUpperCase() + t.slice(1)).onclick = () => {
      const id = router.current.id;
      if (id) router.replace(childPath(id, t)); // 하위 탭은 history 를 늘리지 않는다(뒤로 가기는 아이 화면 전체를 닫는다)
    };
  $("closeChildDetail").onclick = () => router.back("#/children");

  function recordItem(r) {
    const missed = Array.isArray(r.missed) ? r.missed : [];
    const duration = durationText(r.activeMs);
    const score =
      `${r.correct} / ${r.total} · ${pctOf(r)}점${r.partial ? " · 중단" : ""}${r.daily ? " · 📬 오늘의 단어" : ""}` +
      `${r.timeouts ? ` · ⏱ 시간 초과 ${r.timeouts}개` : ""}${r.aiPass ? ` · 🤖 AI 인정 ${r.aiPass}개` : ""}`;
    return h(
      "article",
      { class: "history-entry" },
      h("div", { class: "history-head" }, h("span", { class: "history-score" }, score)),
      h("p", { class: "history-meta" }, `${timeText(r.completedAt)} · ${r.setName || ""} · ${modeLabels[r.mode] || r.mode || ""} · ${r.range || ""}` + (duration ? ` · ${duration}` : "")),
      r.awayCount ? h("p", { class: "away-flag" }, `⚠️ 문제 중 화면 이탈 ${r.awayCount}회 · 총 ${Math.round((r.awayMs || 0) / 1000)}초 (앱이 가려지거나 다른 앱으로 나감)`) : null,
      missed.length
        ? h("details", null, h("summary", null, `틀린 단어 ${missed.length}개 보기`), h("p", null, missed.map((m) => `${m.en} — ${m.ko}${m.unknown ? " [모름]" : ""}`).join(" · ")))
        : h("p", { class: "muted" }, "틀린 단어 없음 🎉"),
    );
  }
  function statTile(label, main, sub) {
    return h("div", { class: "stat" }, h("small", null, label), h("b", null, main), h("span", null, sub));
  }
  panels.records = (c, d) => {
    const s = store.get();
    const records = recordsOf(c.id);
    const stats = computeStats(records, { days: 30 });
    const { week, prevWeek, window: month, streak } = stats;
    const tiles = $("recordsSummary");
    tiles.textContent = "";
    tiles.append(
      statTile("이번 주", `${week.count}회`, week.count ? `평균 ${week.avg}점` : "시험 없음"),
      statTile("지난주", `${prevWeek.count}회`, prevWeek.count ? `평균 ${prevWeek.avg}점` : "시험 없음"),
      statTile("최근 30일", month.count ? `${month.avg}점` : "-", `시험 ${month.count}회 평균`),
      statTile("연속 학습", `🔥 ${streak}일`, streak ? "오늘·어제까지 이어서" : "오늘 시작해 봐요"),
    );
    const chips = $("missedTop");
    chips.textContent = "";
    if (!stats.missedTop.length) chips.append(h("span", { class: "muted" }, "최근 2주 동안 틀린 단어가 없어요."));
    for (const w of stats.missedTop) chips.append(h("span", { class: "chip" }, h("span", null, w.en), h("b", null, `${w.n}회`), h("small", null, w.ko || "")));
    // 필터: 세트(기록에 나온 이름, 최근 것부터)·기간
    const names = [...new Set(records.map((r) => String(r.setName || "")).filter(Boolean))];
    const prefs = s.prefs;
    const setFilter = names.includes(prefs.recordsSet) ? prefs.recordsSet : "all";
    const select = $("recordsSet");
    const optionsKey = JSON.stringify(names);
    if (select.dataset.key !== optionsKey) {
      select.dataset.key = optionsKey;
      select.textContent = "";
      select.append(h("option", { value: "all" }, "전체 세트"), ...names.map((n) => h("option", { value: n }, n)));
    }
    select.value = setFilter;
    $("recordsDays").value = String(prefs.recordsDays);
    const since = prefs.recordsDays ? startOfDay(prefs.recordsDays - 1) : 0;
    const filtered = records.filter((r) => (setFilter === "all" || r.setName === setFilter) && Date.parse(r.completedAt) >= since);
    $("recordsNote").textContent = !d
      ? detailLoading.has(c.id) ? "전체 기록을 불러오는 중… 지금은 최근 2주 기록만 보여요." : "최근 2주 기록만 보여요."
      : d.recordTotal > d.records.length ? `전체 ${d.recordTotal}회 중 최근 ${d.records.length}개를 보여 줘요.` : "";
    const list = $("childRecords");
    const key = JSON.stringify([c.id, d?.fetchedAt || "", s.fetchedAt, setFilter, prefs.recordsDays, dayKey(new Date()), records.length]);
    if (list.dataset.key === key) return; // 같은 내용이면 다시 만들지 않는다(펼쳐 둔 ‘틀린 단어 보기’ 유지)
    list.dataset.key = key;
    list.textContent = "";
    if (!filtered.length) {
      list.append(h("p", { class: "muted" }, records.length ? "이 조건의 기록이 없어요." : "아직 시험 기록이 없어요."));
      return;
    }
    const groups = new Map();
    for (const r of filtered) {
      const k = dayKey(r.completedAt);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    for (const rs of groups.values())
      list.append(
        h("section", { class: "day-group" }, h("h4", { class: "day-title" }, `${dateText(new Date(rs[0].completedAt))} · ${rs.length}회 · 평균 ${avgOf(rs)}점`), rs.map(recordItem)),
      );
  };
  $("recordsSet").onchange = () => store.patch((s) => ({ prefs: { ...s.prefs, recordsSet: $("recordsSet").value } }));
  $("recordsDays").onchange = () => store.patch((s) => ({ prefs: { ...s.prefs, recordsDays: Number($("recordsDays").value) } }));

  // ===== [sets] 세트 탭 · 세트 편집기 (#/child/<id>/sets/<new|세트 id>) =====
  const validWord = (w) => w && ["string", "number"].includes(typeof w.id) && typeof w.en === "string" && w.en.trim() && typeof w.ko === "string" && Array.isArray(w.aliases);
  const validSet = (s) => Boolean(s && typeof s.id === "string" && typeof s.name === "string" && Array.isArray(s.words) && s.words.length > 0 && s.words.every(validWord));
  let lockBusy = false;
  panels.sets = (c) => {
    if (!lockBusy) $("setsLock").checked = planDefaults(c.plan).setsLocked === true;
    const list = $("childSets");
    list.textContent = "";
    const summary = (Array.isArray(c.sets) ? c.sets : []).filter((s) => s && typeof s.name === "string");
    if (!summary.length) {
      list.append(h("p", { class: "muted" }, "아직 세트가 없어요. 아래 ‘세트 만들어 보내기’로 교재 사진에서 만들어 주면 아이 기기가 다음에 앱을 열 때 들어가요."));
      return;
    }
    const bySet = computeStats(recordsOf(c.id), { days: 30 }).bySet;
    for (const s of summary) {
      const st = bySet.find((x) => x.name === s.name);
      const info = [st ? `최근 ${pctOf(st.last)}점 · 30일 시험 ${st.count}회` : "최근 30일 시험 없음", s.id && s.updatedAt ? `고침 ${relativeTime(s.updatedAt)}` : ""].filter(Boolean).join(" · ");
      list.append(
        h(
          "div",
          { class: "set-row", dataset: { set: s.id || "" } },
          h("span", { class: "set-info" }, h("span", { class: "set-name" }, `${s.name} · ${s.count}단어`), h("small", null, info)),
          s.id
            ? [
                h("button", { type: "button", class: "btn small", onclick: () => router.go(editorPath(c.id, s.id)) }, "보기·수정"),
                h("button", { type: "button", class: "btn small outline danger", onclick: () => deleteSet(c, s) }, "삭제"),
              ]
            : h("small", { class: "muted" }, "아이 기기가 새 버전으로 보내면 여기서 고칠 수 있어요"),
        ),
      );
    }
  };
  async function deleteSet(c, s) {
    if (!confirm(`‘${s.name}’ 세트를 ${c.name}의 모든 기기에서 지울까요? 시험 기록은 남아요.`)) return;
    note(c.id, "setsStatus", "info", "지우는 중…");
    try {
      const data = await api.deleteSet(c.id, s.id);
      patchChild(c.id, { sets: Array.isArray(data?.summary) ? data.summary : (childById(c.id)?.sets || []).filter((x) => x.id !== s.id) });
      const text = `‘${s.name}’을(를) 지웠어요. 아이 기기에서는 다음에 앱을 열 때 사라져요.`;
      note(c.id, "setsStatus", "good", text);
      toast(text, "good");
    } catch (e) {
      note(c.id, "setsStatus", "bad", "지우지 못했어요: " + failure(e));
    }
  }
  $("sendNewSet").onclick = () => {
    const id = router.current.id;
    if (id) router.go(editorPath(id, null));
  };
  // 세트 고치기 잠금: 바꾸는 즉시 계획(plan)에 setsLocked 만 저장한다. 아이 기기는 다음에 앱을 열 때 /settings 로 받는다.
  $("setsLock").onchange = async () => {
    const id = router.current.id;
    if (!id || !childById(id)) return;
    const setsLocked = $("setsLock").checked;
    $("setsLock").disabled = true;
    lockBusy = true;
    note(id, "setsStatus", "info", setsLocked ? "잠그는 중…" : "잠금을 푸는 중…");
    try {
      putPlan(id, await api.savePlan(id, { setsLocked }), { setsLocked });
      const text = setsLocked
        ? "잠갔어요. 아이 기기가 다음에 앱을 열 때부터 세트를 만들거나 고치거나 지울 수 없고 단어를 보기만 해요."
        : "잠금을 풀었어요. 아이 기기가 다음에 앱을 열 때부터 세트를 다시 고칠 수 있어요.";
      note(id, "setsStatus", "good", text);
      toast(setsLocked ? "🔒 잠갔어요" : "잠금을 풀었어요", "good");
    } catch (e) {
      $("setsLock").checked = !setsLocked;
      note(id, "setsStatus", "bad", "저장 실패: " + failure(e));
    } finally {
      $("setsLock").disabled = false;
      lockBusy = false;
      scheduleRender();
    }
  };

  // 편집기: editor.js 의 화면을 그대로 쓰고, 저장은 아이의 세트로 서버에 보낸다. 사진 인식·AI 사전은 보호자 코드로 부른다.
  function aiBridge() {
    const s = store.get();
    if (!s.parentCode) return null;
    const call = (path, body, signal) =>
      apiRequest(s.server, path, { method: "POST", body, passcode: s.parentCode, signal, timeout: AI_TIMEOUT_MS }).catch((e) => {
        if (e?.status === 401) {
          const err = Error("보호자 코드가 맞지 않아요. 설정에서 코드를 확인해 주세요.");
          err.status = 401;
          throw err;
        }
        throw e;
      });
    return {
      recognize: (image, mediaType, signal) => call("/recognize", { image, mediaType }, signal),
      define: (words, signal) => call("/define", { words }, signal),
    };
  }
  // 고친 세트는 번호·영어가 같은 단어의 원래 id(숫자)·발음을 이어받는다(아이 기기의 틀린 단어 목록이 id 로 이어지게).
  function keepWordDetails(set, previous) {
    if (!previous) return;
    for (const w of set.words) {
      const old = previous.words.find((x) => String(x.id) === String(w.id) && x.en === w.en);
      if (old) {
        w.id = old.id;
        w.ipa = w.ipa || old.ipa || "";
        w.hangul = old.hangul || "";
      }
    }
  }
  async function sendSet(set) {
    const r = router.current;
    const c = r.name === "editor" ? childById(r.id) : null;
    if (!c) return false;
    keepWordDetails(set, editingSet);
    SetEditor.lockSave(true);
    SetEditor.setWarning(`‘${c.name}’에게 보내는 중…`);
    try {
      const data = await api.sendSet(c.id, { id: set.id, name: set.name, words: set.words });
      if (Array.isArray(data?.summary)) patchChild(c.id, { sets: data.summary });
      const text = `‘${set.name}’(${set.words.length}단어)을(를) ${c.name}에게 보냈어요. 아이 기기가 다음에 앱을 열 때 들어가요.`;
      SetEditor.setWarning("");
      SetEditor.close();
      editorDone = editorKey;
      editorKey = "";
      editingSet = null;
      note(c.id, "setsStatus", "good", text);
      toast(text, "good");
      router.back(childPath(c.id, "sets"));
      return true;
    } catch (e) {
      SetEditor.setWarning("보내지 못했어요: " + failure(e));
      return false;
    } finally {
      SetEditor.lockSave(false);
    }
  }
  SetEditor.mount($("editor"), {
    ai: aiBridge,
    onSave: sendSet,
    onClose() {
      const id = router.current.id;
      editorDone = editorKey;
      editorKey = "";
      editingSet = null;
      router.back(id ? childPath(id, "sets") : "#/children");
    },
  });
  // render 가 부른다: 편집기가 이 라우트로 열려 있으면 true. 새 세트는 바로 열고, 있는 세트는 서버에서 받은 뒤 연다(그동안은 세트 탭).
  let editorLoadingKey = "";
  views.editor = (r) => {
    const key = editorKeyOf(r);
    if (editorKey === key && SetEditor.isOpen()) return true;
    if (editorDone === key) return false;
    const c = childById(r.id);
    if (!c) return false;
    if (!r.setId) {
      if (!SetEditor.open(null, { targetName: c.name })) return false;
      editorKey = key;
      editingSet = null;
      return true;
    }
    if (editorLoadingKey !== key) loadSetForEditor(r, key, c);
    return false;
  };
  async function loadSetForEditor(r, key, c) {
    editorLoadingKey = key;
    note(c.id, "setsStatus", "info", "세트를 불러오는 중…");
    try {
      const data = await api.getSet(r.id, r.setId);
      if (!validSet(data?.set)) throw Error("세트 내용이 올바르지 않아요.");
      if (editorKeyOf(router.current) !== key) return;
      note(c.id, "setsStatus", "info", "");
      editingSet = data.set;
      if (SetEditor.open({ id: data.set.id, name: data.set.name, words: data.set.words }, { targetName: c.name })) {
        editorKey = key;
        render();
        window.scrollTo({ top: 0, behavior: "auto" });
      }
    } catch (e) {
      note(c.id, "setsStatus", "bad", "세트를 불러오지 못했어요: " + failure(e));
      if (editorKeyOf(router.current) === key && e?.status !== 401) router.replace(childPath(r.id, "sets"));
    } finally {
      if (editorLoadingKey === key) editorLoadingKey = "";
    }
  }

  // ===== [start] 시작: 탭·새로고침·라우터·자동 갱신 =====
  $("tabToday").onclick = () => router.go("#/");
  $("tabChildren").onclick = () => router.go("#/children");
  $("tabSettings").onclick = () => router.go("#/settings");
  $("refreshFamily").onclick = () => {
    refreshAll({ force: true });
    const id = router.current.id;
    if (id) loadDetail(id, { force: true });
  };
  if (!Number.isInteger(history.state?.idx)) history.replaceState({ ...(history.state || {}), idx: 0 }, "", location.href);
  lastIdx = navIdx();
  // 해시가 바뀔 때(탭·카드·뒤로 가기): 새 history 항목에는 번호를 붙여 router.back 이 앱 안에서만 되돌아가게 한다.
  window.addEventListener("hashchange", () => {
    if (!Number.isInteger(history.state?.idx)) history.replaceState({ idx: lastIdx + 1 }, "", location.href);
    onRoute();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) autoRefresh();
  });
  window.addEventListener("online", () => {
    offlineToastShown = false;
    autoRefresh();
  });
  setInterval(renderLoadStatus, 60000);
  store.subscribe(scheduleRender);
  onRoute();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  window.ParentApp = Object.freeze({ store, router, computeStats, api });
  if (window.markVocabAppReady) window.markVocabAppReady();
})();
