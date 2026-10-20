"use strict";
// parent.js — 보호자 앱(parent.html). shared.js · editor.js 다음에 불러온다. 전역은 window.ParentApp(디버깅·테스트용: store, router, computeStats, suggestLevel, api) 하나.
// 흐름: storage(daily_vocab_parent_v1, 옛 키는 처음 한 번 이전) → store(patch 마다 저장 + 화면 다시 그리기) → api(Shared.apiRequest + 보호자 코드)
//       → router(해시 라우트; 뒤로 가기 = 해시 history) → views(라우트마다 한 화면을 store 스냅샷으로 그림) → actions(요청 → store.patch → 결과는 토스트·칸 아래 문구).
// 캐시 우선: 마지막 응답을 먼저 그리고 앱 시작·화면 복귀·온라인 복귀·화면 진입 때 10분이 지났으면 뒤에서 새로 받는다.
// 목록은 Shared.h 로 만들고(innerHTML 없음), 폼은 parent.html 의 정적 마크업에 값만 채운다(테스트가 보는 ID 유지).
// 라우트: #/ 오늘 · #/children 아이들 · #/child/<id>/<records|sets|daily|settings|questions> · #/child/<id>/sets/<new|세트 id> 편집기 · #/settings · #/setup(코드 없으면 언제나 여기)
(function () {
  // ===== [core] 상수·도우미·저장소·상태·서버 요청·라우터·그리기 =====
  const { $, h, setFeedback, tidy, formatCode, hourLabel, relativeTime, durationText, dayKey, pctOf, WEEKDAYS, modeLabels,
    AI_SERVER_DEFAULT, normalizeServer, PLAN_LEVELS, TIME_LIMIT_CHOICES, REMIND_HOUR_CHOICES, planDefaults, deviceLabel, apiRequest, readJson, writeJson } = Shared;
  const PARENT_KEY = "daily_vocab_parent_v1";
  // 옛 아이 앱 보호자 모드가 쓰던 키(처음 한 번 이전한 뒤 보호자 것만 지운다. 아이 키의 다른 필드는 건드리지 않는다)
  const OLD_FAMILY_KEY = "daily_vocab_family_v1", OLD_AI_KEY = "daily_vocab_ai_v2", OLD_CACHE_KEY = "daily_vocab_family_cache_v1", OLD_MODE_KEY = "daily_vocab_mode_v1";
  const STALE_MS = 10 * 60 * 1000; // 이보다 오래된 캐시는 뒤에서 새로 받는다
  const RECORDS_KEEP = 200; // 아이 상세에 캐시하는 최신 기록 수(Worker 에 최근 30일·200개만 달라고 한다. 옛 Worker 가 전체를 주면 앱이 자른다)
  const DETAIL_DAYS = 30;
  const OLDER_PAGE = 100; // ‘더 보기’ 한 번에 받는 옛 기록 수
  const SUGGEST_HIDE_MS = 7 * 86400000; // 수준 제안에 ‘적용’·‘다음에’를 누르면 7일 동안 다시 묻지 않는다
  const STORE_LIMIT = 1000000; // 저장 크기(문자) 상한: 넘으면 가장 오래 본 아이의 상세부터 저장하지 않는다
  const TIMEOUT_MS = 20000, SETS_TIMEOUT_MS = 60000, DAILY_TIMEOUT_MS = 90000, AI_TIMEOUT_MS = 130000;
  const JOIN_CODE = /^\d{6}$/;
  const TABS = ["records", "sets", "daily", "settings", "questions"];
  const VIEW_IDS = ["setup", "today", "children", "child", "editor", "settings"];
  const NOTE_IDS = ["setsStatus", "planStatus", "linkStatus", "nameStatus", "limitStatus", "remindStatus", "deleteStatus", "missedStatus", "recordsStatus", "dailySetStatus"];

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
  // ‘…로/으로’: 받침이 없거나 ㄹ 받침(숫자 1·7·8 포함)이면 ‘로’
  const ro = (word) => {
    const ch = String(word || "").trim().slice(-1);
    const code = ch.charCodeAt(0) - 0xac00;
    if (code >= 0 && code < 11172) return code % 28 === 0 || code % 28 === 8 ? "로" : "으로";
    if (/\d/.test(ch)) return "036".includes(ch) ? "으로" : "로";
    return "(으)로";
  };
  const monthDay = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
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
  // { parentCode, server, children:[GET /family 의 아이(최근 기록 포함)],
  //   details:{ [id]: {child, records(최근 30일 중 최신 200), recordTotal(전체 기록 수), more(더 오래된 기록 있음), questions, today, fetchedAt, viewedAt} },
  //   fetchedAt, prefs:{ recordsSet, recordsDays, levelSuggestDismissed:{ [id]: 'YYYY-MM-DD' },
  //                      deviceId(이 폰의 알림 기기 id, 처음 켤 때 한 번 만든다), push:{deviceId, endpoint, kinds:{finish, summary}, summaryHour} | null(이 폰에서 켠 알림) } }
  // ‘더 보기’로 받은 옛 기록은 저장하지 않고 이 세션 동안만 olderPages(아래 [core] 불러오기)에 둔다.
  const emptyState = () => ({ parentCode: "", server: AI_SERVER_DEFAULT, children: [], details: {}, fetchedAt: "", prefs: { recordsSet: "all", recordsDays: 30, levelSuggestDismissed: {}, deviceId: "", push: null } });
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
      if (p.levelSuggestDismissed && typeof p.levelSuggestDismissed === "object")
        for (const [id, day] of Object.entries(p.levelSuggestDismissed)) if (/^\d{4}-\d{2}-\d{2}$/.test(String(day))) s.prefs.levelSuggestDismissed[id] = day;
      if (typeof p.deviceId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(p.deviceId)) s.prefs.deviceId = p.deviceId;
      const push = p.push;
      if (push && typeof push === "object" && typeof push.deviceId === "string" && typeof push.endpoint === "string")
        s.prefs.push = {
          deviceId: push.deviceId,
          endpoint: push.endpoint,
          kinds: { finish: push.kinds?.finish !== false, summary: push.kinds?.summary !== false },
          summaryHour: Number.isInteger(push.summaryHour) && push.summaryHour >= 0 && push.summaryHour <= 23 ? push.summaryHour : 21,
          registeredAt: typeof push.registeredAt === "string" ? push.registeredAt : "",
        };
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
  // 그 아이의 기록: 상세(최근 30일 중 최신 200개)·‘더 보기’로 받은 옛 기록·목록(최근 14일 또는 최신 20개)을 합친다(겹치는 id 는 한 번).
  function recordsOf(id) {
    const s = store.get();
    const list = s.children.find((c) => c.id === id)?.records || [];
    const detail = s.details[id]?.records || [];
    const older = olderPages.get(id)?.records || [];
    if (!detail.length && !older.length) return list;
    const seen = new Set();
    return [...detail, ...older, ...list].filter((r) => !seen.has(r.id) && seen.add(r.id)).sort(byNewest);
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
  // → { today, week(최근 7일), prevWeek(그 앞 7일), window(days 창), streak(받은 기록으로 센 오늘 또는 어제까지 연속 학습일 — 화면은 streakFor), days:[{key, weekday, label, count, avg, today}],
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
        if (!entry.ko && m.ko) entry.ko = m.ko;
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

  // 연속 학습(🔥, 순수 함수): Worker 가 전체 기록으로 센 streakDays(streakLastDay 까지 이어진 날 수)가 있으면 그것을 쓴다 — 받은 기록(목록 14일·상세 30일)만으로
  // 세면 그보다 긴 연속이 14·30일로 잘린다. streakLastDay 가 이 폰의 오늘이면 그대로, 어제면 오늘 기록이 있을 때 +1(없어도 어제까지 이어진 것),
  // 그보다 전이면 끊긴 것. 옛 Worker(값 없음)는 받은 기록으로 센 stats.streak. 둘 중 큰 값.
  function streakFor(c, stats, now = new Date()) {
    const n = c?.streakDays;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(c?.streakLastDay || ""));
    if (!Number.isInteger(n) || n < 1 || !m) return stats.streak;
    const noon = new Date(now);
    noon.setHours(12, 0, 0, 0);
    const gap = Math.round((noon - new Date(+m[1], +m[2] - 1, +m[3], 12)) / 86400000); // 마지막 날부터 이 폰의 오늘까지 며칠
    const server = gap <= 0 ? n : gap === 1 ? n + (stats.today.count ? 1 : 0) : 0;
    return Math.max(stats.streak, server);
  }

  // ---- 수준 제안 (순수 함수, 2C): 제안만 하고 바꾸지는 않는다(보호자가 ‘적용’을 눌러야 저장) ----
  // stats: computeStats 결과(week = 최근 7일, prevWeek = 그 앞 7일, missedTop = 최근 2주 틀린 단어 상위 10). plan: 아이의 오늘의 단어 계획. levels: 수준 목록(쉬운 것부터).
  // 올리기: 두 주 모두 시험 3회 이상·평균 90점 이상이고 최근 2주 틀린 단어가 5개 이하 → 다음 단계. 내리기: 두 주 평균이 모두 60점 미만 → 한 단계 아래.
  // 직접 입력한 수준이거나 더 올릴(내릴) 단계가 없으면 null.  → { direction: "up"|"down", from, to, avg(최근 2주 평균), week, prevWeek, missed } | null
  function suggestLevel(stats, plan, levels = PLAN_LEVELS) {
    const week = stats?.week, prev = stats?.prevWeek;
    if (!week?.count || !prev?.count || week.avg == null || prev.avg == null) return null;
    const from = planDefaults(plan).level;
    const i = levels.indexOf(from);
    if (i < 0) return null;
    const missed = Array.isArray(stats.missedTop) ? stats.missedTop.length : 0;
    const avg = Math.round((week.avg * week.count + prev.avg * prev.count) / (week.count + prev.count));
    const base = { from, avg, week: { count: week.count, avg: week.avg }, prevWeek: { count: prev.count, avg: prev.avg }, missed };
    if (week.count >= 3 && prev.count >= 3 && week.avg >= 90 && prev.avg >= 90 && missed <= 5)
      return i + 1 < levels.length ? { ...base, direction: "up", to: levels[i + 1] } : null;
    if (week.avg < 60 && prev.avg < 60) return i > 0 ? { ...base, direction: "down", to: levels[i - 1] } : null;
    return null;
  }

  // ---- 서버 요청 (보호자 코드) ----
  const api = {
    request(path, { method = "GET", body, timeout = TIMEOUT_MS, passcode } = {}) {
      const s = store.get();
      return apiRequest(s.server, path, { method, body, passcode: passcode ?? s.parentCode, timeout });
    },
    verifyCode: (code) => api.request("/family", { passcode: code }),
    listChildren: () => api.request("/family"),
    // 상세는 최근 30일 중 최신 200개만(옛 Worker 는 인자를 무시하고 전체를 준다 → loadDetail 이 자른다)
    childDetail: (id) => api.request(`/family/${enc(id)}?days=${DETAIL_DAYS}&limit=${RECORDS_KEEP}`),
    // ‘더 보기’: before(목록의 마지막 completedAt)보다 먼저 끝난 기록 한 페이지. 옛 Worker 에는 없다(404 not_found)
    childRecords: (id, before) => api.request(`/family/${enc(id)}/records?limit=${OLDER_PAGE}` + (before ? "&before=" + enc(before) : "")),
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
  // ‘더 보기’로 받은 옛 기록(세션 동안만, 저장하지 않음): 아이 id → { records, more, loading, unsupported(옛 Worker), token }
  const olderPages = new Map();
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
  // 아이 상세(GET /family/<id>?days=30&limit=200): 기록(최근 30일 중 최신 200개)·전체 수·더 있음·질문·오늘의 단어를 둔다.
  // 옛 Worker 는 인자를 무시하고 전체 기록을 주며 recordCount·more 가 없다: 최신 200개만 쓰고 받은 개수를 전체로 삼으며 ‘더 보기’는 없다.
  async function loadDetail(id, { force = false } = {}) {
    const s = store.get();
    const d = s.details[id];
    if (!s.parentCode || detailLoading.has(id) || (!force && d && isFresh(d.fetchedAt))) return;
    detailLoading.add(id);
    scheduleRender();
    try {
      const data = await api.childDetail(id);
      const all = (Array.isArray(data?.records) ? data.records : []).filter(validRecord).sort(byNewest);
      const records = all.slice(0, RECORDS_KEEP);
      const child = validChild(data?.child) ? data.child : childById(id);
      const at = nowIso();
      detailErrors.delete(id);
      olderPages.delete(id); // 새 창을 받으면 이어 받던 옛 기록은 버린다(창이 옮겨 가 그 사이에 빈틈이 생기지 않게). ‘더 보기’로 다시 받는다
      store.patch((st) => ({
        details: {
          ...st.details,
          [id]: {
            child: { ...(st.details[id]?.child || {}), ...child, records: undefined, today: undefined },
            records,
            recordTotal: Number.isInteger(data?.recordCount) ? Math.max(data.recordCount, records.length) : all.length,
            more: data?.more === true,
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
  // ‘더 보기’: 지금 목록의 마지막(가장 오래된) 기록보다 먼저 끝난 기록을 100개씩 받아 이 세션 동안 붙여 둔다.
  // 옛 Worker(경로 없음, 404 not_found)면 토스트 없이 버튼만 숨긴다.
  async function loadMoreRecords(id) {
    const page = olderPages.get(id) || { records: [], more: true };
    if (!store.get().details[id] || page.loading || page.unsupported) return;
    const list = recordsOf(id);
    const token = {};
    olderPages.set(id, { ...page, loading: true, token });
    note(id, "recordsStatus", "info", "");
    scheduleRender();
    try {
      const data = await api.childRecords(id, list.length ? list[list.length - 1].completedAt : "");
      if (olderPages.get(id)?.token !== token) return; // 그동안 상세를 새로 받았으면 버린다
      const seen = new Set(page.records.map((r) => r.id));
      const got = (Array.isArray(data?.records) ? data.records : []).filter((r) => validRecord(r) && !seen.has(r.id));
      olderPages.set(id, { records: [...page.records, ...got].sort(byNewest), more: data?.more === true });
      if (!got.length && data?.more !== true) note(id, "recordsStatus", "info", "더 이전 기록은 없어요.");
    } catch (e) {
      if (olderPages.get(id)?.token !== token) return;
      if (e?.status === 404 && e.code === "not_found") olderPages.set(id, { ...page, more: false, unsupported: true });
      else {
        olderPages.set(id, page);
        note(id, "recordsStatus", "bad", "이전 기록을 불러오지 못했어요: " + failure(e));
      }
    } finally {
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
    const streak = streakFor(c, stats);
    head.append(
      h(
        "span",
        { class: "badges" },
        h("span", { class: "pill " + (t.count ? "ok" : "warn") }, t.count ? `오늘 시험 ✅ ${t.count}회 · 평균 ${t.avg}점` : "오늘 시험 아직"),
        streak ? h("span", { class: "streak" }, `🔥 ${streak}일`) : null,
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
    const loaded = recordsOf(c.id).length;
    const total = d && Number.isInteger(d.recordTotal) ? Math.max(d.recordTotal, loaded) : Math.max(Number.isInteger(c.recordCount) ? c.recordCount : 0, loaded);
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
    const { week, prevWeek, window: month } = stats;
    const streak = streakFor(c, stats);
    const tiles = $("recordsSummary");
    tiles.textContent = "";
    tiles.append(
      statTile("이번 주", `${week.count}회`, week.count ? `평균 ${week.avg}점` : "시험 없음"),
      statTile("지난주", `${prevWeek.count}회`, prevWeek.count ? `평균 ${prevWeek.avg}점` : "시험 없음"),
      statTile("최근 30일", month.count ? `${month.avg}점` : "-", `시험 ${month.count}회 평균`),
      statTile("연속 학습", `🔥 ${streak}일`, streak ? "오늘·어제까지 이어서" : "오늘 시작해 봐요"),
    );
    renderMissed(c, stats.missedTop);
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
    // ‘더 보기’: 서버가 더 있다고 했고(상세의 more 또는 마지막 페이지의 more) 받은 기록이 전체보다 적을 때만
    const page = olderPages.get(c.id);
    const total = d && Number.isInteger(d.recordTotal) ? d.recordTotal : 0;
    const canMore = Boolean(d && !page?.unsupported && (page ? page.more : d.more) && records.length < total);
    const more = $("loadMoreRecords");
    more.classList.toggle("hidden", !canMore);
    more.disabled = Boolean(page?.loading);
    more.textContent = page?.loading ? "이전 기록을 불러오는 중…" : "⬇ 이전 기록 더 보기";
    $("recordsNote").textContent = !d
      ? detailLoading.has(c.id) ? "기록을 불러오는 중… 지금은 최근 2주 기록만 보여요." : "최근 2주 기록만 보여요."
      : total > records.length ? `전체 ${total}회 중 최근 ${records.length}개를 받았어요.` + (canMore ? " 맨 아래 ‘더 보기’로 이전 기록을 볼 수 있어요." : "") : "";
    const list = $("childRecords");
    const key = JSON.stringify([c.id, d?.fetchedAt || "", s.fetchedAt, setFilter, prefs.recordsDays, dayKey(new Date()), records.length, page?.records.length || 0]);
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
  // ‘더 보기’는 30일보다 오래된 기록을 받으므로 기간을 ‘전체’로 바꿔 보여 준다.
  $("loadMoreRecords").onclick = () => {
    const id = router.current.id;
    if (!id) return;
    if (store.get().prefs.recordsDays !== 0) store.patch((s) => ({ prefs: { ...s.prefs, recordsDays: 0 } }));
    loadMoreRecords(id);
  };

  // 📉 자주 틀린 단어: 칩을 눌러 빼거나 넣고(기본 전부), 고른 단어로 ‘복습 M/D’ 세트를 만들어 보낸다.
  const missedOff = new Map(); // 아이 id → 뺀 단어(소문자 영어)
  formResets.push(() => missedOff.clear());
  let setSending = false; // 복습 세트·오늘의 단어 세트를 보내는 중
  const pickedMissed = (id, top) => top.filter((w) => !missedOff.get(id)?.has(w.en.toLowerCase()));
  function renderMissed(c, top) {
    const chips = $("missedTop");
    const picked = pickedMissed(c.id, top);
    $("missedActions").classList.toggle("hidden", !top.length);
    $("missedPicked").textContent = top.length ? `${picked.length}개 골랐어요 · 단어를 눌러 빼거나 넣어요` : "";
    $("sendMissedSet").disabled = !picked.length || setSending;
    const key = JSON.stringify([c.id, top.map((w) => [w.en, w.n, w.ko]), picked.map((w) => w.en)]);
    if (chips.dataset.key === key) return;
    chips.dataset.key = key;
    chips.textContent = "";
    if (!top.length) chips.append(h("span", { class: "muted" }, "최근 2주 동안 틀린 단어가 없어요."));
    for (const w of top) {
      const on = picked.includes(w);
      chips.append(
        h(
          "button",
          { type: "button", class: "chip pick" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false", dataset: { word: w.en }, onclick: () => toggleMissed(c.id, w.en) },
          h("span", null, (on ? "✓ " : "") + w.en),
          h("b", null, `${w.n}회`),
          h("small", null, w.ko || "뜻 없음"),
        ),
      );
    }
  }
  function toggleMissed(id, en) {
    const key = en.toLowerCase();
    const off = missedOff.get(id) || new Set();
    if (off.has(key)) off.delete(key);
    else off.add(key);
    missedOff.set(id, off);
    scheduleRender();
  }
  // 세트 이름이 이미 있으면 ‘ (2)’, ‘ (3)’…을 붙인다(아이 세트 요약 기준).
  function uniqueSetName(c, base) {
    const names = new Set((Array.isArray(c.sets) ? c.sets : []).map((x) => x?.name));
    if (!names.has(base)) return base;
    for (let n = 2; ; n++) if (!names.has(`${base} (${n})`)) return `${base} (${n})`;
  }
  // 만든 세트를 아이에게 보내고 세트 탭으로 옮긴다(복습 세트·오늘의 단어 세트 공용). 실패 문구는 statusId 칸에.
  async function sendNamedSet(c, set, statusId, extra = "") {
    if (setSending) return false;
    setSending = true;
    note(c.id, statusId, "info", `‘${set.name}’을(를) 보내는 중…`);
    scheduleRender();
    try {
      const data = await api.sendSet(c.id, set);
      const summary = Array.isArray(data?.summary) ? data.summary : [...(childById(c.id)?.sets || []), { id: set.id, name: set.name, count: set.words.length, updatedAt: nowIso() }];
      patchChild(c.id, { sets: summary });
      const text = `‘${set.name}’ ${set.words.length}단어를 ${c.name}에게 보냈어요.`;
      note(c.id, statusId, "info", "");
      note(c.id, "setsStatus", "good", text + " 아이 기기가 다음에 앱을 열 때 들어가요." + extra);
      toast(text + extra, "good");
      if (router.current.id === c.id) router.replace(childPath(c.id, "sets"));
      return true;
    } catch (e) {
      note(c.id, statusId, "bad", "보내지 못했어요: " + failure(e));
      return false;
    } finally {
      setSending = false;
      scheduleRender();
    }
  }
  // 틀린 단어로 복습 세트: 이름 ‘복습 M/D’(오늘, 이 폰 날짜), 번호 1…n, 뜻은 기록의 뜻(뜻이 없는 단어는 빼고 알린다).
  function sendMissedAsSet(childId, words) {
    const c = childById(childId);
    if (!c) return Promise.resolve(false);
    const usable = words.filter((w) => tidy(w.en) && tidy(w.ko));
    const skipped = words.length - usable.length;
    if (!usable.length) {
      note(childId, "missedStatus", "bad", "고른 단어에 뜻이 기록되지 않아 세트를 만들 수 없어요.");
      return Promise.resolve(false);
    }
    const set = {
      id: crypto.randomUUID(),
      name: uniqueSetName(c, "복습 " + monthDay(new Date())),
      words: usable.map((w, i) => ({ id: i + 1, en: tidy(w.en), ko: tidy(w.ko), aliases: [], ipa: "" })),
    };
    return sendNamedSet(c, set, "missedStatus", skipped ? ` 뜻이 기록되지 않은 단어 ${skipped}개는 뺐어요.` : "").then((ok) => {
      if (ok) missedOff.delete(childId); // 보낸 뒤에는 다시 전부 고른 상태로
      return ok;
    });
  }
  $("sendMissedSet").onclick = () => {
    const id = router.current.id;
    if (id) sendMissedAsSet(id, pickedMissed(id, computeStats(recordsOf(id), { days: DETAIL_DAYS }).missedTop));
  };

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
            ? h(
                "span",
                { class: "set-actions" },
                h("button", { type: "button", class: "btn small", onclick: () => router.go(editorPath(c.id, s.id)) }, "보기·수정"),
                h("button", { type: "button", class: "btn small outline danger", onclick: () => deleteSet(c, s) }, "삭제"),
              )
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

  // ===== [daily] 오늘의 단어 탭 =====
  function fillPlanSelects() {
    $("planLevel").append(...PLAN_LEVELS.map((l) => h("option", { value: l }, l)), h("option", { value: "__custom" }, "직접 입력…"));
    $("planCount").append(...[5, 10, 15, 20].map((n) => h("option", { value: String(n) }, n + "개")));
    for (let hr = 0; hr < 24; hr++) $("planHour").append(h("option", { value: String(hr) }, hourLabel(hr)));
  }
  fillPlanSelects();
  // 폼 값은 아이가 바뀌거나 서버 계획이 바뀔 때만 채운다(고치는 중에 뒤에서 새로 받아도 입력이 지워지지 않게).
  function fillPlanForm(c) {
    const plan = planDefaults(c.plan);
    const key = c.id + JSON.stringify([plan.enabled, plan.level, plan.dailyCount, plan.hour]);
    if ($("planBox").dataset.key === key) return;
    $("planBox").dataset.key = key;
    $("planEnabled").checked = plan.enabled;
    const known = PLAN_LEVELS.includes(plan.level);
    $("planLevel").value = known ? plan.level : "__custom";
    $("planLevelCustom").classList.toggle("hidden", known);
    $("planLevelCustom").value = known ? "" : plan.level;
    $("planCount").value = String(plan.dailyCount);
    $("planHour").value = String(plan.hour);
  }
  formResets.push(() => delete $("planBox").dataset.key);
  // 수준 제안: ‘적용’·‘다음에’를 누른 날부터 7일 동안은 묻지 않는다(오늘의 단어가 꺼져 있어도 보인다).
  function levelSuggestionFor(c) {
    const day = store.get().prefs.levelSuggestDismissed?.[c.id];
    if (day && Date.now() - Date.parse(day + "T00:00:00") < SUGGEST_HIDE_MS) return null;
    return suggestLevel(computeStats(recordsOf(c.id), { days: DETAIL_DAYS }), c.plan);
  }
  function hideLevelSuggestion(id) {
    store.patch((s) => ({ prefs: { ...s.prefs, levelSuggestDismissed: { ...(s.prefs.levelSuggestDismissed || {}), [id]: dayKey(new Date()) } } }));
  }
  function renderLevelSuggestion(c) {
    const sug = levelSuggestionFor(c);
    $("levelSuggest").classList.toggle("hidden", !sug);
    if (!sug) return;
    const up = sug.direction === "up";
    $("levelSuggest").classList.toggle("down", !up);
    $("levelSuggestText").textContent = `최근 2주 평균 ${sug.avg}점이에요. 수준을 ‘${sug.to}’${ro(sug.to)} ${up ? "올려" : "낮춰"} 볼까요?`;
    $("levelSuggestWhy").textContent =
      `이번 주 ${sug.week.count}회 · 평균 ${sug.week.avg}점, 지난주 ${sug.prevWeek.count}회 · 평균 ${sug.prevWeek.avg}점` +
      (up ? `, 자주 틀린 단어 ${sug.missed}개` : "") +
      ` · 지금 수준 ‘${sug.from}’. 제안만 해요(‘적용’을 눌러야 바뀌어요).`;
  }
  panels.daily = (c, d) => {
    const plan = planDefaults(c.plan);
    fillPlanForm(c);
    renderLevelSuggestion(c);
    const anchor = c.anchor;
    $("planAnchor").textContent = anchor?.words?.length
      ? `수준 기준 세트: ${anchor.setName || "(이름 없음)"} · ${anchor.words.length}단어 (아이 기기가 기록을 보낼 때 최근 세트에서 가져와요)`
      : "수준 기준 세트가 아직 없어요. 아이 기기가 기록을 한 번 보내면 최근 세트의 단어를 수준 기준으로 삼아요.";
    const today = d?.today || mergeToday(null, c.today);
    const words = Array.isArray(today?.words) ? today.words : [];
    const box = $("dailyPreview");
    box.textContent = "";
    let head;
    if (!plan.enabled) head = `오늘의 단어가 꺼져 있어요. 켜고 저장하면 매일 ${hourLabel(plan.hour)}에 만들어요.`;
    else if (!today?.exists) head = `오늘 것은 아직 없어요. ${hourLabel(plan.hour)}에 만들거나 아이가 앱을 열면 바로 만들어요.`;
    else head = `오늘의 단어 ${words.length ? words.length + "개" : ""}` + (today.completed ? ` · ✅ ${today.completed.correct} / ${today.completed.total} 맞았어요` : " · 아직 안 풀었어요");
    box.append(h("p", { class: "muted" }, head));
    if (today?.exists && !words.length && detailLoading.has(c.id)) box.append(h("p", { class: "muted" }, "단어를 불러오는 중…"));
    for (const w of words)
      box.append(h("div", { class: "daily-word" }, h("span", { class: "tag" + (w.kind === "review" ? " review" : "") }, w.kind === "review" ? "복습" : "새"), h("span", null, `${w.en} — ${w.ko}`)));
    $("dailySetBox").classList.toggle("hidden", !(today?.exists && words.length));
    $("saveDailyAsSet").disabled = setSending;
  };
  // 오늘의 단어를 세트로 저장해 보내기: 이름 ‘오늘의 단어 M/D’(그 오늘의 단어 날짜). 세트로만 저장하고 오늘의 단어 시험 기록과는 무관하다.
  $("saveDailyAsSet").onclick = () => {
    const c = currentChild();
    if (!c) return;
    const today = store.get().details[c.id]?.today;
    const words = (Array.isArray(today?.words) ? today.words : []).filter((w) => w && tidy(w.en) && tidy(w.ko));
    if (!words.length) return;
    const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(today.date || ""));
    const set = {
      id: crypto.randomUUID(),
      name: uniqueSetName(c, "오늘의 단어 " + (m ? `${Number(m[1])}/${Number(m[2])}` : monthDay(new Date()))),
      words: words.map((w, i) => ({
        id: Number.isInteger(w.id) ? w.id : i + 1,
        en: tidy(w.en),
        ko: tidy(w.ko),
        ipa: typeof w.ipa === "string" ? w.ipa : "",
        aliases: Array.isArray(w.aliases) ? w.aliases.filter((a) => typeof a === "string") : [],
      })),
    };
    sendNamedSet(c, set, "dailySetStatus");
  };
  // 수준 제안 ‘적용’: 수준만 저장한다(켜고 끄기·개수·시각은 그대로). ‘다음에’: 7일 동안 숨긴다.
  $("applyLevel").onclick = async () => {
    const c = currentChild();
    const sug = c && levelSuggestionFor(c);
    if (!sug) return;
    $("applyLevel").disabled = true;
    note(c.id, "planStatus", "info", "수준을 바꾸는 중…");
    try {
      putPlan(c.id, await api.savePlan(c.id, { level: sug.to }), { level: sug.to });
      hideLevelSuggestion(c.id);
      const text = `수준을 ‘${sug.to}’${ro(sug.to)} 바꿨어요.` + (planDefaults(childById(c.id)?.plan).enabled ? " 다음 오늘의 단어부터 이 수준으로 만들어요." : " 오늘의 단어는 아직 꺼져 있어요.");
      note(c.id, "planStatus", "good", text);
      toast(text, "good");
    } catch (e) {
      note(c.id, "planStatus", "bad", "저장 실패: " + failure(e));
    } finally {
      $("applyLevel").disabled = false;
    }
  };
  $("dismissLevel").onclick = () => {
    const id = router.current.id;
    if (!id) return;
    hideLevelSuggestion(id);
    toast("수준 제안은 일주일 뒤에 다시 볼게요.", "info");
  };
  $("planLevel").onchange = () => $("planLevelCustom").classList.toggle("hidden", $("planLevel").value !== "__custom");
  $("savePlan").onclick = async () => {
    const id = router.current.id;
    if (!id || !childById(id)) return;
    const choice = $("planLevel").value;
    const level = choice === "__custom" ? tidy($("planLevelCustom").value).slice(0, 40) : choice;
    if (!level) {
      note(id, "planStatus", "bad", "수준을 고르거나 적어 주세요.");
      return;
    }
    const body = { enabled: $("planEnabled").checked, level, dailyCount: Number($("planCount").value), hour: Number($("planHour").value) };
    $("savePlan").disabled = true;
    note(id, "planStatus", "info", "저장하는 중…");
    try {
      putPlan(id, await api.savePlan(id, body), body);
      const text = body.enabled ? `저장했어요. 매일 ${hourLabel(body.hour)}에 ${body.dailyCount}개를 만들어요.` : "저장했어요. 오늘의 단어를 만들지 않아요.";
      note(id, "planStatus", "good", text);
      toast(text, "good");
    } catch (e) {
      note(id, "planStatus", "bad", "저장 실패: " + failure(e));
    } finally {
      $("savePlan").disabled = false;
    }
  };
  $("makeDailyNow").onclick = async () => {
    const id = router.current.id;
    if (!id || !childById(id)) return;
    $("makeDailyNow").disabled = true;
    note(id, "planStatus", "info", "오늘의 단어를 만드는 중… (10초쯤 걸려요)");
    try {
      const d = await api.makeDaily(id);
      const words = Array.isArray(d?.words) ? d.words : [];
      const today = { date: d?.date || "", exists: true, words, note: d?.note || "", completed: d?.completed || null };
      store.patch((s) => ({
        details: s.details[id] ? { ...s.details, [id]: { ...s.details[id], today } } : s.details,
        children: s.children.map((c) => (c.id === id ? { ...c, today: { date: today.date, exists: true, count: words.length, completed: today.completed } } : c)),
      }));
      const text = `오늘의 단어 ${words.length}개가 준비됐어요.` + (d?.note ? " " + d.note : "");
      note(id, "planStatus", "good", text);
      toast(text, "good");
    } catch (e) {
      note(id, "planStatus", "bad", "만들지 못했어요: " + failure(e));
    } finally {
      $("makeDailyNow").disabled = false;
    }
  };

  // ===== [settings] 아이 설정 탭(연결·이름·제한 시간·삭제) · 보호자 설정 (#/settings) =====
  const timeLimitLabel = (sec) => (sec ? `${sec}초` : "없음");
  $("planTimeLimit").append(...TIME_LIMIT_CHOICES.map((sec) => h("option", { value: String(sec) }, timeLimitLabel(sec))));
  let limitBusy = false;
  // 공부 알림 시각(plan.remindHour): 없음 또는 오후 3시~오후 10시(한국 시각). 아이 기기에서 알림을 켜 두면 그 시각까지 시험이 없을 때 한 번 알려 준다.
  const remindLabel = (hr) => (Number.isInteger(hr) ? hourLabel(hr) : "없음");
  $("planRemindHour").append(...REMIND_HOUR_CHOICES.map((hr) => h("option", { value: Number.isInteger(hr) ? String(hr) : "" }, remindLabel(hr))));
  let remindBusy = false;
  panels.settings = (c) => {
    const code = JOIN_CODE.test(c.joinCode || "") ? c.joinCode : "";
    $("childCodeText").textContent = code ? formatCode(code) : "(없음 · ‘코드 새로 만들기’를 누르세요)";
    $("childLinkText").textContent = code ? linkFor(code) : "";
    $("copyLink").disabled = !code;
    $("copyCode").disabled = !code;
    const devices = devicesOf(c).sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
    $("deviceList").textContent = devices.length
      ? "연결된 기기: " + devices.map((d) => `${d.label || "기기"} (${relativeTime(d.lastSeenAt)})`).join(" · ")
      : "아직 연결된 기기가 없어요. 아이 기기에서 코드를 넣거나 링크를 열어 주세요.";
    const nameKey = c.id + ":" + c.name;
    if ($("renameChild").dataset.key !== nameKey) {
      $("renameChild").dataset.key = nameKey;
      $("renameChild").value = c.name;
    }
    const limit = planDefaults(c.plan).timeLimitSec;
    const select = $("planTimeLimit");
    if (!limitBusy && select.dataset.key !== c.id + ":" + limit) {
      select.dataset.key = c.id + ":" + limit;
      if (![...select.options].some((o) => o.value === String(limit))) select.append(h("option", { value: String(limit) }, timeLimitLabel(limit)));
      select.value = String(limit);
    }
    const remind = planDefaults(c.plan).remindHour;
    const remindValue = Number.isInteger(remind) ? String(remind) : "";
    const remindSelect = $("planRemindHour");
    if (!remindBusy && remindSelect.dataset.key !== c.id + ":" + remindValue) {
      remindSelect.dataset.key = c.id + ":" + remindValue;
      if (![...remindSelect.options].some((o) => o.value === remindValue)) remindSelect.append(h("option", { value: remindValue }, remindLabel(remind)));
      remindSelect.value = remindValue;
    }
    $("deleteConfirmText").textContent = `지우려면 아이 이름 ‘${c.name}’을(를) 그대로 적고 ‘삭제’를 누르세요.`;
    $("deleteChildGo").disabled = tidy($("deleteConfirmName").value) !== c.name;
  };
  formResets.push(() => {
    delete $("renameChild").dataset.key;
    delete $("planTimeLimit").dataset.key;
    delete $("planRemindHour").dataset.key;
    $("deleteConfirm").classList.add("hidden");
    $("deleteConfirmName").value = "";
  });
  const currentChild = () => (router.current.id ? childById(router.current.id) : null);
  $("copyLink").onclick = () => {
    const c = currentChild();
    if (c && JOIN_CODE.test(c.joinCode || "")) copyText(linkFor(c.joinCode), "아이 전용 링크", c.id);
  };
  $("copyCode").onclick = () => {
    const c = currentChild();
    if (c && JOIN_CODE.test(c.joinCode || "")) copyText(c.joinCode, "아이 코드", c.id);
  };
  $("regenCode").onclick = async () => {
    const c = currentChild();
    if (!c) return;
    if (!confirm("아이 코드를 새로 만들면 옛 코드와 옛 링크로는 더 연결할 수 없어요. 이미 연결된 기기는 그대로예요. 새로 만들까요?")) return;
    $("regenCode").disabled = true;
    try {
      const data = await api.regenCode(c.id);
      putChild({ ...c, ...(validChild(data?.child) ? data.child : {}), records: undefined, today: undefined });
      note(c.id, "linkStatus", "good", `새 아이 코드 ${formatCode(childById(c.id)?.joinCode)}을(를) 만들었어요.`);
    } catch (e) {
      note(c.id, "linkStatus", "bad", "코드를 만들지 못했어요: " + failure(e));
    } finally {
      $("regenCode").disabled = false;
    }
  };
  $("saveChildName").onclick = async () => {
    const c = currentChild();
    if (!c) return;
    const name = tidy($("renameChild").value).slice(0, 20);
    if (!name) {
      note(c.id, "nameStatus", "bad", "이름을 적어 주세요.");
      return;
    }
    $("saveChildName").disabled = true;
    try {
      const data = await api.renameChild(c.id, name);
      putChild({ ...c, ...(validChild(data?.child) ? data.child : {}), name: data?.child?.name || name, records: undefined, today: undefined });
      const text = `이름을 ‘${childById(c.id).name}’(으)로 바꿨어요. 아이 기기에는 다음에 앱을 열 때 반영돼요.`;
      note(c.id, "nameStatus", "good", text);
      toast(text, "good");
    } catch (e) {
      note(c.id, "nameStatus", "bad", "이름을 바꾸지 못했어요: " + failure(e));
    } finally {
      $("saveChildName").disabled = false;
    }
  };
  // 문제당 제한 시간: 바꾸는 즉시 계획(plan)에 timeLimitSec 만 저장한다.
  $("planTimeLimit").onchange = async () => {
    const c = currentChild();
    if (!c) return;
    const timeLimitSec = Number($("planTimeLimit").value);
    const before = planDefaults(c.plan).timeLimitSec;
    limitBusy = true;
    $("planTimeLimit").disabled = true;
    note(c.id, "limitStatus", "info", "저장하는 중…");
    try {
      putPlan(c.id, await api.savePlan(c.id, { timeLimitSec }), { timeLimitSec });
      const text = timeLimitSec
        ? `저장했어요. 문제당 제한 시간 ${timeLimitSec}초는 아이 기기가 다음에 앱을 열 때부터 적용돼요.`
        : "저장했어요. 제한 시간 없이 풀어요(아이 기기가 다음에 앱을 열 때부터).";
      note(c.id, "limitStatus", "good", text);
      toast(text, "good");
    } catch (e) {
      $("planTimeLimit").value = String(before);
      note(c.id, "limitStatus", "bad", "저장 실패: " + failure(e));
    } finally {
      limitBusy = false;
      $("planTimeLimit").disabled = false;
      delete $("planTimeLimit").dataset.key;
      scheduleRender();
    }
  };
  // 공부 알림 시각: 바꾸는 즉시 계획(plan)에 remindHour 만 저장한다(제한 시간과 같은 방식).
  $("planRemindHour").onchange = async () => {
    const c = currentChild();
    if (!c) return;
    const raw = $("planRemindHour").value;
    const remindHour = raw === "" ? null : Number(raw);
    const before = planDefaults(c.plan).remindHour;
    remindBusy = true;
    $("planRemindHour").disabled = true;
    note(c.id, "remindStatus", "info", "저장하는 중…");
    try {
      putPlan(c.id, await api.savePlan(c.id, { remindHour }), { remindHour });
      const text = Number.isInteger(remindHour)
        ? `저장했어요. 아이 기기에서 알림을 켜 두면 매일 ${hourLabel(remindHour)}까지 시험이 없을 때 한 번 알려 줘요.`
        : "저장했어요. 공부 알림을 보내지 않아요.";
      note(c.id, "remindStatus", "good", text);
      toast(text, "good");
    } catch (e) {
      $("planRemindHour").value = Number.isInteger(before) ? String(before) : "";
      note(c.id, "remindStatus", "bad", "저장 실패: " + failure(e));
    } finally {
      remindBusy = false;
      $("planRemindHour").disabled = false;
      delete $("planRemindHour").dataset.key;
      scheduleRender();
    }
  };
  // 삭제는 두 단계: ‘삭제…’ → 아이 이름을 그대로 적어야 ‘삭제’가 눌린다.
  $("deleteChild").onclick = () => {
    $("deleteConfirm").classList.remove("hidden");
    $("deleteConfirmName").value = "";
    $("deleteChildGo").disabled = true;
    $("deleteConfirmName").focus();
  };
  $("deleteChildCancel").onclick = () => $("deleteConfirm").classList.add("hidden");
  $("deleteConfirmName").oninput = () => {
    const c = currentChild();
    $("deleteChildGo").disabled = !c || tidy($("deleteConfirmName").value) !== c.name;
  };
  $("deleteChildGo").onclick = async () => {
    const c = currentChild();
    if (!c || tidy($("deleteConfirmName").value) !== c.name) return;
    $("deleteChildGo").disabled = true;
    note(c.id, "deleteStatus", "info", "지우는 중…");
    try {
      await api.deleteChild(c.id);
      removeChild(c.id);
      toast(`‘${c.name}’을(를) 서버에서 지웠어요.`, "good");
      router.replace("#/children");
    } catch (e) {
      note(c.id, "deleteStatus", "bad", "지우지 못했어요: " + failure(e));
      $("deleteChildGo").disabled = false;
    }
  };

  // 보호자 설정 (#/settings)
  views.settings = () => {
    const s = store.get();
    $("parentState").textContent = s.parentCode ? `연결됨 · 아이 ${s.children.length}명` : "";
    $("clearParent").disabled = !s.parentCode;
    if (document.activeElement !== $("parentServer")) $("parentServer").value = s.server;
    renderNotifyCard();
  };
  $("saveParent").onclick = () =>
    verifyAndSave($("parentCode"), $("saveParent"), $("parentStatus"), (text) => {
      $("parentStatus").textContent = text + " · 보호자 코드를 바꿨어요.";
      toast("보호자 코드를 바꿨어요.", "good");
    });
  $("parentCode").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("saveParent").click();
  });
  $("clearParent").onclick = () => {
    if (!confirm("보호자 코드를 이 폰에서 지울까요? 이 폰에 저장한 아이들 기록(캐시)도 함께 지워져요. 서버의 기록은 그대로예요.")) return;
    const s = store.get();
    notes.clear();
    lastLoadError = "";
    // 이 폰의 알림도 끈다: 서버 구독은 지우는 코드가 남아 있는 지금 지운다(실패해도 다음 전송 때 만료로 정리된다)
    const push = s.prefs.push;
    if (push) {
      api.request("/push/unsubscribe", { method: "POST", body: { role: "parent", device: { id: push.deviceId } } }).catch(() => {});
      Shared.notify.unsubscribe().catch(() => {});
    }
    pushNote = null;
    store.patch({ ...emptyState(), server: s.server, prefs: { ...s.prefs, push: null } });
    setupNote = { kind: "info", text: "보호자 코드를 지웠어요. 다시 쓰려면 코드를 넣어 주세요." };
    router.replace("#/setup");
  };
  $("saveServer").onclick = () => {
    const raw = $("parentServer").value.trim();
    const server = raw ? normalizeServer(raw) : AI_SERVER_DEFAULT;
    if (!server) {
      setFeedback($("serverStatus"), "bad", "https:// 로 시작하는 Worker 주소를 넣어 주세요.");
      return;
    }
    store.patch({ server, fetchedAt: "" });
    setFeedback($("serverStatus"), "good", "저장했어요. 이 서버에서 아이들 기록을 다시 불러와요.");
    refreshAll({ force: true });
  };

  // ===== [notify] 알림(2B): 이 폰에서 받기 · 🧒 시험 마침 · 🌙 저녁 요약 · 테스트 알림 =====
  // 켜기: 권한(터치 직후 맨 먼저) → GET /push/key → 브라우저 구독 → POST /push/subscribe {role:"parent", device, subscription, kinds, summaryHour}(보호자 코드) → prefs.push.
  // 체크·시각을 바꾸면 같은 구독으로 바로 다시 보낸다. 앱 시작·화면 복귀 때 구독이 없어졌거나 endpoint 가 바뀌었으면, 또는 마지막 등록이 하루 전이면
  // 다시 등록한다(권한이 granted 일 때만): Worker 는 전송이 연달아 5번 실패한 구독을 지우는데 폰은 모르므로, 하루에 한 번은 같은 구독을 다시 보낸다.
  // 끄기·보호자 코드 삭제는 브라우저 구독과 서버 구독(POST /push/unsubscribe)을 함께 지운다. 문구는 Worker 가 만든다.
  const SUMMARY_HOURS = [18, 19, 20, 21, 22, 23];
  $("notifySummaryHour").append(...SUMMARY_HOURS.map((hr) => h("option", { value: String(hr) }, hourLabel(hr))));
  $("notifySummaryHour").value = "21";
  const PUSH_REFRESH_MS = 24 * 3600000;
  let pushBusy = false;
  let pushRefreshing = false;
  let pushNote = null; // #notifyStatus 에 보일 {kind, text}(없으면 지원 여부 안내)
  function pushDeviceId() {
    const s = store.get();
    if (s.prefs.deviceId) return s.prefs.deviceId;
    const id = crypto.randomUUID();
    store.patch((st) => ({ prefs: { ...st.prefs, deviceId: id } }));
    return id;
  }
  const pushChoices = () => ({ kinds: { finish: $("notifyFinish").checked, summary: $("notifySummary").checked }, summaryHour: Number($("notifySummaryHour").value) });
  const choicesText = (c) => [c.kinds.finish ? "시험을 마치면 바로" : "", c.kinds.summary ? `저녁 요약 ${hourLabel(c.summaryHour)}` : ""].filter(Boolean).join(" · ") || "받을 알림 없음";
  async function registerParentPush(choices) {
    const { publicKey } = await api.request("/push/key");
    const subscription = await Shared.notify.subscribe(publicKey);
    const deviceId = pushDeviceId();
    await api.request("/push/subscribe", { method: "POST", body: { role: "parent", device: { id: deviceId, label: deviceLabel() }, subscription, ...choices } });
    store.patch((s) => ({ prefs: { ...s.prefs, push: { deviceId, endpoint: subscription.endpoint, kinds: choices.kinds, summaryHour: choices.summaryHour, registeredAt: nowIso() } } }));
  }
  function renderNotifyCard() {
    const push = store.get().prefs.push;
    const on = Boolean(push);
    const support = Shared.notify.support();
    $("notifyState").textContent = on ? "켜짐" : "꺼짐";
    $("notifyState").className = "pill" + (on ? " ok" : "");
    const button = $("notifyEnable");
    button.textContent = on ? "🔕 알림 끄기" : "🔔 이 폰에서 알림 받기";
    button.className = "btn " + (on ? "outline" : "primary");
    button.classList.toggle("hidden", !on && support !== "push");
    button.disabled = pushBusy;
    $("notifyOptions").classList.toggle("hidden", !on);
    if (on && !pushBusy) {
      $("notifyFinish").checked = push.kinds.finish;
      $("notifySummary").checked = push.kinds.summary;
      $("notifySummaryHour").value = String(push.summaryHour);
    }
    for (const id of ["notifyFinish", "notifySummary", "notifyTest"]) $(id).disabled = pushBusy;
    $("notifySummaryHour").disabled = pushBusy || !$("notifySummary").checked;
    if (pushNote) return setFeedback($("notifyStatus"), pushNote.kind, pushNote.text);
    const denied = support === "push" && Shared.notify.permission() === "denied";
    setFeedback(
      $("notifyStatus"),
      denied ? "bad" : "info",
      denied
        ? "알림 권한이 꺼져 있어요. 폰 설정에서 이 앱의 알림을 허용해 주세요."
        : on
          ? `🔔 알림 켜짐 · ${choicesText(push)}`
          : support === "install"
            ? "홈 화면에 설치한 앱에서만 알림을 켤 수 있어요. Safari 공유(⬆) → ‘홈 화면에 추가’로 설치한 뒤 그 앱에서 켜 주세요(iOS 16.4 이상)."
            : support === "push"
              ? "알림 꺼짐"
              : "이 브라우저는 알림을 지원하지 않아요. 폰의 Chrome·Safari에서 설치한 보호자 앱으로 열어 주세요.",
    );
  }
  async function pushAction(busyText, run) {
    if (pushBusy) return;
    pushBusy = true;
    pushNote = { kind: "info", text: busyText };
    renderNotifyCard();
    try {
      pushNote = await run();
    } catch (e) {
      pushNote = { kind: "bad", text: e?.code === "push_unconfigured" ? e.message : "알림 설정을 바꾸지 못했어요: " + failure(e) };
    } finally {
      pushBusy = false;
      renderNotifyCard();
    }
  }
  $("notifyEnable").onclick = () => {
    if (store.get().prefs.push)
      return pushAction("알림을 끄는 중…", async () => {
        const prev = store.get().prefs.push;
        store.patch((s) => ({ prefs: { ...s.prefs, push: null } }));
        await Shared.notify.unsubscribe().catch(() => {});
        await api.request("/push/unsubscribe", { method: "POST", body: { role: "parent", device: { id: prev.deviceId } } }).catch(() => {}); // 남은 구독은 다음 전송 때 만료로 정리된다
        return { kind: "good", text: "알림을 껐어요." };
      });
    if (Shared.notify.support() !== "push") return renderNotifyCard();
    pushAction("알림을 켜는 중…", async () => {
      const permission = await Shared.notify.request(); // 터치 직후 맨 먼저(아이폰은 사용자 터치 안에서만 묻는다)
      if (permission !== "granted") return { kind: "bad", text: "알림 권한이 꺼져 있어요. 폰 설정에서 이 앱의 알림을 허용해 주세요." };
      const choices = pushChoices();
      await registerParentPush(choices);
      toast("🔔 알림을 켰어요", "good");
      return { kind: "good", text: `알림을 켰어요(${choicesText(choices)}). ‘테스트 알림 보내기’로 이 폰에 오는지 확인해 보세요.` };
    });
  };
  // 체크·시각 변경: 같은 구독으로 바로 다시 등록한다(구독이 바뀌었으면 새로 만든다).
  function savePushChoices() {
    const prev = store.get().prefs.push;
    if (!prev) return;
    const choices = pushChoices();
    pushAction("저장하는 중…", async () => {
      const current = await Shared.notify.current();
      if (current && current.endpoint === prev.endpoint) {
        await api.request("/push/subscribe", { method: "POST", body: { role: "parent", device: { id: prev.deviceId, label: deviceLabel() }, subscription: current, ...choices } });
        store.patch((s) => ({ prefs: { ...s.prefs, push: { ...prev, ...choices, registeredAt: nowIso() } } }));
      } else await registerParentPush(choices);
      return { kind: "good", text: `저장했어요. ${choicesText(choices)}` };
    });
  }
  for (const id of ["notifyFinish", "notifySummary", "notifySummaryHour"]) $(id).onchange = savePushChoices;
  $("notifyTest").onclick = () => {
    const push = store.get().prefs.push;
    if (!push) return;
    pushAction("테스트 알림을 보내는 중…", async () => {
      try {
        await api.request("/push/test", { method: "POST", body: { role: "parent", device: { id: push.deviceId } } });
      } catch (e) {
        if (e?.code === "no_subscription" || e?.code === "push_failed") return { kind: "bad", text: e.message };
        throw e;
      }
      return { kind: "good", text: "테스트 알림을 보냈어요. 몇 초 안에 이 폰에 알림이 와요. 안 오면 폰의 알림 설정을 확인해 주세요." };
    });
  };
  // 앱 시작·화면 복귀 때: 켜 둔 알림의 구독이 사라졌거나 바뀌었으면(브라우저 갱신·키 교체), 또는 마지막 등록이 하루 전이면 조용히 다시 등록한다.
  async function refreshParentPush() {
    const s = store.get();
    const prev = s.prefs.push;
    if (!prev || !s.parentCode || pushBusy || pushRefreshing || Shared.notify.support() !== "push" || Shared.notify.permission() !== "granted") return;
    pushRefreshing = true;
    try {
      const current = await Shared.notify.current();
      const recent = Date.now() - Date.parse(prev.registeredAt || "") < PUSH_REFRESH_MS; // 기록이 없으면(이 규칙 전에 켠 알림) 한 번 다시 보낸다
      if (current && current.endpoint === prev.endpoint && recent) return;
      await registerParentPush({ kinds: prev.kinds, summaryHour: prev.summaryHour });
    } catch {
      // 오프라인·옛 Worker: 다음에 앱을 열 때 다시
    } finally {
      pushRefreshing = false;
    }
  }

  // ===== [questions] 질문 탭: 아이가 AI 선생님에게 물어본 문제(요약만, 사진 없음) =====
  const TUTOR_KIND_TEXT = { explain: "풀이 설명", translate: "해석", grammar: "어법 설명", check: "내 답 확인", ask: "직접 질문" };
  panels.questions = (c, d) => {
    const questions = d?.questions;
    const total = Math.max(c.questionCount || 0, questions?.length || 0);
    $("childQuestionCount").textContent = `${total}개`;
    const box = $("childQuestions");
    if (!questions) {
      $("questionsSummary").textContent = "";
      box.textContent = detailLoading.has(c.id) ? "불러오는 중…" : "아직 불러오지 못했어요. 위의 🔄 새로고침을 눌러 주세요.";
      return;
    }
    const week = questions.filter((q) => Date.parse(q.askedAt) >= startOfDay(6)).length;
    $("questionsSummary").textContent = `이번 주 ${week}개 · 전체 ${total}개` + (total > questions.length ? ` (최근 ${questions.length}개를 보여 줘요)` : "");
    const key = JSON.stringify([c.id, d.fetchedAt]);
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = "";
    if (!questions.length) {
      box.append(h("p", { class: "muted" }, "아직 물어본 문제가 없어요."));
      return;
    }
    for (const q of questions)
      box.append(
        h(
          "div",
          { class: "question-row" },
          h("strong", null, q.problem || "(문제)"),
          h("span", { class: "q-kind" }, (TUTOR_KIND_TEXT[q.kind] || q.kind || "") + (q.question ? ` · ${q.question}` : "")),
          h("small", null, Number.isFinite(Date.parse(q.askedAt)) ? new Date(q.askedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""),
          q.summary ? h("p", null, q.summary) : null,
        ),
      );
  };

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
    if (document.hidden) return;
    autoRefresh();
    refreshParentPush(); // 폰에 오래 떠 있는 앱도 하루에 한 번은 알림 구독을 다시 보낸다
  });
  window.addEventListener("online", () => {
    offlineToastShown = false;
    autoRefresh();
  });
  setInterval(renderLoadStatus, 60000);
  store.subscribe(scheduleRender);
  onRoute();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
    // 알림을 눌러 이미 열린 보호자 앱으로 돌아오면 sw.js 가 {type:"navigate", url} 을 보낸다: 그 화면(해시)으로 옮긴다.
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type !== "navigate") return;
      try {
        const target = new URL(e.data.url, location.href);
        if (target.pathname.endsWith("parent.html")) router.go(target.hash || "#/");
      } catch {}
    });
  }
  refreshParentPush();
  window.ParentApp = Object.freeze({ store, router, computeStats, suggestLevel, streakFor, api });
  if (window.markVocabAppReady) window.markVocabAppReady();
})();
