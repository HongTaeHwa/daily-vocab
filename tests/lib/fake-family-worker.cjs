// 가짜 가족 Worker — tests/family.cjs · tests/daily.cjs 공용. Playwright 라우트로 worker/worker.js 의 FamilyStore 역할을 흉내 낸다.
// 라우트: /join /settings/<id> /records/<id> /sync /sets/<id> /daily/<id> /grade, 보호자 /family /family/<id> /family/children
//        /family/<id>/(plan|code|name) /family/<id>/sets(/<setId>). 질문(/tutor 의 FamilyStore /question)은 seedChild 뒤 child.questions 에 직접 넣는다.
//
// const fake = await createFakeWorker(page, { server, familyCode, parentCode, setSync, daily, recordsPageSize, newWords });
//   setSync (기본 true)       /sets/<id>·/family/<id>/sets 를 처리한다. false 면 옛 Worker처럼 404 not_found 이고 아이에게 세트 저장소가 없다(요약은 /sync 의 세트 목록).
//   daily (기본 true)         /daily/<id> 조회·생성(복습 최대 3 + newWords). false 면 언제나 409 plan_disabled.
//   recordsPageSize (기본 500) /records 한 페이지 최대 개수(페이지 넘김을 시험하려면 작게).
// → { requests, children, codes, gone, dailies, paths(path, method?), seedChild(id, name, code), liveSets(child), planOf(child), setMode("ok"|"abort"|"notfound") }
//   requests: [{method, path, search, passcode, body}], children: Map(id → 아이), codes: Map(아이 코드 → id), gone: 지운 아이 id(그 id 의 /sync 는 404 unknown_child).
"use strict";
const DEFAULT_NEW_WORDS = ["glimpse", "verdict", "linger", "thrive", "plead", "subtle", "wither", "forge", "ample", "dwell", "exert", "notion"];

async function createFakeWorker(page, { server, familyCode, parentCode, setSync = true, daily = true, recordsPageSize = 500, newWords = DEFAULT_NEW_WORDS } = {}) {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS" };
  const reply = (route, status, body) => route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
  const notFound = (route) => reply(route, 404, { error: "not_found", message: "지원하지 않는 요청입니다." });
  const requests = [];
  const children = new Map(); // 가짜 가족 기록함(Worker의 FamilyStore 역할)
  const codes = new Map(); // 아이 코드 → childId
  const gone = new Set(); // 보호자가 지운 아이 id(Worker의 gone:<id> 묘비): 그 id의 /sync 는 404 unknown_child
  const dailies = new Map(); // childId:date → 오늘의 단어
  let nextCode = 777777, nextSetId = 1, mode = "ok";
  const now = () => new Date().toISOString();
  const localDate = () => {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
  };
  const planOf = (c) => ({ enabled: false, level: "중2 상위권", dailyCount: 10, hour: 16, timeLimitSec: 0, setsLocked: false, ...(c.plan || {}) });
  const seedChild = (id, name, code) => {
    children.set(id, { id, name, joinCode: code, devices: {}, sets: [], ...(setSync ? { setStore: new Map() } : {}), records: new Map(), questions: [], lastTestAt: null, createdBy: "parent" });
    codes.set(code, id);
    return children.get(id);
  };
  const liveSets = (c) => [...c.setStore.values()].filter((s) => !s.deletedAt);
  const setSummary = (c) => liveSets(c).map((s) => ({ id: s.id, name: s.name, count: s.words.length, updatedAt: s.updatedAt })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const touchDevice = (c, device) => {
    if (device && device.id) c.devices[device.id] = { label: device.label || "기기", joinedAt: c.devices[device.id]?.joinedAt || now(), lastSeenAt: now() };
  };
  const todayOf = (c, date) => {
    const d = dailies.get(c.id + ":" + date);
    return { date, exists: Boolean(d), count: d ? d.words.length : 0, completed: d?.completed || null };
  };
  const summaryOf = (c) => ({
    id: c.id, name: c.name, joinCode: c.joinCode, devices: c.devices, sets: c.setStore ? setSummary(c) : c.sets, anchor: c.anchor, updatedAt: c.updatedAt, lastTestAt: c.lastTestAt,
    questionCount: (c.questions || []).length, lastQuestionAt: (c.questions || [])[0]?.askedAt || null,
    plan: planOf(c), today: todayOf(c, localDate()),
    records: [...c.records.values()].sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
  });
  const makeDaily = (c, date) => {
    const plan = planOf(c);
    const latest = [...c.records.values()].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    const review = [];
    for (const r of latest) for (const m of r.missed || []) if (review.length < 3 && !review.some((x) => x.en === m.en)) review.push({ en: m.en, ko: m.ko, kind: "review" });
    const fresh = newWords.filter((w) => !review.some((r) => r.en === w)).slice(0, plan.dailyCount - review.length).map((w) => ({ en: w, ko: w + "의 뜻", kind: "new" }));
    const words = [...review, ...fresh].map((w, i) => ({ id: i + 1, en: w.en, ko: w.ko, ipa: "ˈ" + w.en, aliases: [w.ko, w.en + "뜻"], kind: w.kind }));
    const made = { childId: c.id, date, level: plan.level, model: "claude-sonnet-5-5", createdAt: now(), words, note: "" };
    dailies.set(c.id + ":" + date, made);
    return made;
  };

  await page.route(server + "/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const passcode = req.headers()["x-app-passcode"];
    requests.push({ method: req.method(), path: url.pathname, search: url.search, passcode, body });
    if (mode === "abort") return route.abort("connectionrefused");
    if (mode === "notfound") return notFound(route);
    const familyOk = [familyCode, parentCode].includes(passcode);
    const unauthorized = () => reply(route, 401, { error: "unauthorized", message: "접속 코드가 맞지 않습니다." });
    const unknownChild = () => reply(route, 404, { error: "unknown_child", message: "그 아이의 기록이 없습니다." });
    if (url.pathname === "/join" && req.method() === "POST") {
      if (!familyOk) return unauthorized();
      const code = String(body.code || "").replace(/\D/g, "");
      const c = children.get(codes.get(code));
      if (!c || c.joinCode !== code) return reply(route, 404, { error: "unknown_code", message: "그 아이 코드를 찾을 수 없어요." });
      touchDevice(c, body.device);
      return reply(route, 200, { ok: true, childId: c.id, name: c.name, timeLimitSec: planOf(c).timeLimitSec, setsLocked: planOf(c).setsLocked });
    }
    const sm = /^\/settings\/([A-Za-z0-9-]+)$/.exec(url.pathname);
    if (sm && req.method() === "GET") {
      if (!familyOk) return unauthorized();
      const c = children.get(sm[1]);
      if (!c) return unknownChild();
      return reply(route, 200, { childId: c.id, name: c.name, timeLimitSec: planOf(c).timeLimitSec, setsLocked: planOf(c).setsLocked });
    }
    const rm = /^\/records\/([A-Za-z0-9-]+)$/.exec(url.pathname);
    if (rm && req.method() === "GET") {
      if (!familyOk) return unauthorized();
      const c = children.get(rm[1]);
      if (!c) return unknownChild();
      const since = url.searchParams.get("since") || "";
      const pageSize = Math.min(Number(url.searchParams.get("limit")) || 500, recordsPageSize);
      const all = [...c.records.values()].filter((r) => r.completedAt >= since).sort((a, b) => a.completedAt.localeCompare(b.completedAt));
      return reply(route, 200, { records: all.slice(0, pageSize), more: all.length > pageSize, serverTime: now() });
    }
    if (url.pathname === "/sync" && req.method() === "POST") {
      if (!familyOk) return unauthorized();
      if (gone.has(body.child.id)) return reply(route, 404, { error: "unknown_child", message: "그 아이의 기록이 없습니다. 보호자 폰에서 아이를 다시 만들어 주세요." });
      const c = children.get(body.child.id) || { id: body.child.id, name: body.child.name, devices: {}, sets: [], records: new Map(), lastTestAt: null };
      if (!c.name) c.name = body.child.name;
      if (body.sets) c.sets = body.sets;
      if (body.anchor) {
        if (body.anchor.words.length) c.anchor = body.anchor;
        else delete c.anchor; // 빈 앵커 = 수준 기준 삭제(Worker와 같은 규칙)
      }
      touchDevice(c, body.device);
      c.updatedAt = now();
      for (const r of body.records) {
        c.records.set(r.id, r);
        if (!c.lastTestAt || r.completedAt > c.lastTestAt) c.lastTestAt = r.completedAt;
        const d = r.daily && !r.partial ? dailies.get(c.id + ":" + r.daily) : null;
        if (d) d.completed = { recordId: r.id, correct: r.correct, total: r.total, completedAt: r.completedAt };
      }
      children.set(c.id, c);
      return reply(route, 200, { ok: true, stored: body.records.length, trimmed: 0, syncedAt: c.updatedAt });
    }
    const setsM = /^\/sets\/([A-Za-z0-9-]+)$/.exec(url.pathname);
    if (setsM && req.method() === "POST") {
      if (!setSync) return notFound(route); // 옛 Worker
      if (!familyOk) return unauthorized();
      const c = children.get(setsM[1]);
      if (!c) return unknownChild();
      touchDevice(c, body.device);
      for (const d of body.deleted || []) {
        const cur = c.setStore.get(d.id);
        if (cur && cur.updatedAt >= d.deletedAt) continue;
        c.setStore.set(d.id, { id: d.id, name: cur?.name || "", words: [], updatedAt: d.deletedAt, deletedAt: d.deletedAt });
      }
      for (const s of body.sets || []) {
        const cur = c.setStore.get(s.id);
        if (cur && cur.updatedAt >= s.updatedAt) continue;
        c.setStore.set(s.id, { ...s });
      }
      const known = new Map((body.known || []).map((k) => [k.id, k.updatedAt]));
      const pull = liveSets(c).filter((s) => !known.has(s.id) || known.get(s.id) < s.updatedAt);
      const removed = [...c.setStore.values()].filter((s) => s.deletedAt && known.has(s.id)).map((s) => s.id);
      c.updatedAt = now();
      return reply(route, 200, { ok: true, sets: pull, deleted: removed, summary: setSummary(c), syncedAt: c.updatedAt });
    }
    const dm = /^\/daily\/([A-Za-z0-9-]+)$/.exec(url.pathname);
    if (!daily && url.pathname.startsWith("/daily/")) return reply(route, 409, { error: "plan_disabled", message: "보호자가 아직 오늘의 단어를 켜지 않았어요." });
    if (dm) {
      if (!familyOk) return unauthorized();
      const c = children.get(dm[1]);
      if (!c) return unknownChild();
      const date = (req.method() === "GET" ? url.searchParams.get("date") : body?.date) || localDate();
      const existing = dailies.get(c.id + ":" + date);
      if (existing) return reply(route, 200, existing);
      if (!planOf(c).enabled) return reply(route, 409, { error: "plan_disabled", message: "보호자가 아직 오늘의 단어를 켜지 않았어요." });
      if (req.method() === "GET") return reply(route, 404, { error: "no_daily", message: "오늘의 단어가 아직 없어요." });
      return reply(route, 200, makeDaily(c, date));
    }
    if (url.pathname === "/grade" && req.method() === "POST") {
      // AI 2차 채점 가짜 응답: ‘비슷한뜻’만 같은 뜻으로 인정한다(시험 중 허용 답안 학습 → 시험 뒤 세트 동기화 확인용)
      if (!familyOk) return unauthorized();
      const accept = body.answer === "비슷한뜻";
      return reply(route, 200, { accept, reason: accept ? "같은 뜻으로 인정" : "다른 뜻이에요", model: "claude-haiku-5-5", usage: {} });
    }
    // ---- 보호자 코드 경로 ----
    const cm = /^\/family\/children$/.test(url.pathname) && req.method() === "POST";
    const am = /^\/family\/([A-Za-z0-9-]+)\/(plan|code|name)$/.exec(url.pathname);
    const m = /^\/family(?:\/([A-Za-z0-9-]+))?$/.exec(url.pathname);
    const csm = setSync ? /^\/family\/([A-Za-z0-9-]+)\/sets(?:\/([A-Za-z0-9_-]+))?$/.exec(url.pathname) : null;
    if (!cm && !am && !m && !csm) return notFound(route);
    if (passcode !== parentCode) return reply(route, 401, { error: "unauthorized", message: "보호자 코드가 맞지 않습니다." });
    if (csm) {
      const c = children.get(csm[1]);
      if (!c) return unknownChild();
      if (!csm[2] && req.method() === "GET") return reply(route, 200, { sets: setSummary(c) });
      if (!csm[2] && req.method() === "POST") {
        const set = body.set || {};
        if (!set.name || !Array.isArray(set.words) || !set.words.length) return reply(route, 400, { error: "bad_request", message: "세트 단어가 없습니다." });
        const stored = { id: set.id || "pset-" + nextSetId++, name: String(set.name).trim(), words: set.words, updatedAt: now() };
        c.setStore.set(stored.id, stored);
        return reply(route, 200, { ok: true, set: { id: stored.id, name: stored.name, count: stored.words.length, updatedAt: stored.updatedAt }, summary: setSummary(c) });
      }
      const cur = c.setStore.get(csm[2]);
      if (!cur || cur.deletedAt) return reply(route, 404, { error: "unknown_set", message: "그 세트가 없어요." });
      if (req.method() === "GET") return reply(route, 200, { set: cur });
      const t = now();
      c.setStore.set(cur.id, { ...cur, words: [], updatedAt: t, deletedAt: t });
      return reply(route, 200, { ok: true, summary: setSummary(c) });
    }
    if (cm) {
      const code = String(nextCode++);
      const c = seedChild("child-" + code, String(body.name || "").trim(), code);
      return reply(route, 200, { ok: true, child: { ...summaryOf(c), records: undefined, today: undefined } });
    }
    if (am) {
      const c = children.get(am[1]);
      if (!c) return unknownChild();
      if (am[2] === "plan") {
        c.plan = { ...planOf(c), ...body, updatedAt: now() };
        return reply(route, 200, { ok: true, child: { ...summaryOf(c), records: undefined } });
      }
      if (am[2] === "code") {
        codes.delete(c.joinCode);
        c.joinCode = String(nextCode++);
        codes.set(c.joinCode, c.id);
      } else c.name = String(body.name || "").trim();
      return reply(route, 200, { ok: true, child: { ...summaryOf(c), records: undefined, today: undefined } });
    }
    if (!m[1]) return reply(route, 200, { children: [...children.values()].map(summaryOf), serverTime: now() });
    const c = children.get(m[1]);
    if (!c) return unknownChild();
    if (req.method() === "DELETE") {
      children.delete(m[1]);
      codes.delete(c.joinCode);
      gone.add(m[1]);
      return reply(route, 200, { ok: true, deleted: c.records.size });
    }
    const s = summaryOf(c);
    const d = dailies.get(c.id + ":" + localDate());
    return reply(route, 200, {
      child: { ...s, records: undefined, today: undefined },
      records: s.records,
      today: { date: localDate(), exists: Boolean(d), words: d?.words || [], note: "", completed: d?.completed || null },
      questions: c.questions || [],
    });
  });

  return {
    requests,
    children,
    codes,
    gone,
    dailies,
    paths: (path, method) => requests.filter((r) => r.path === path && (!method || r.method === method)),
    seedChild,
    liveSets,
    planOf,
    setMode: (next) => {
      mode = next;
    },
  };
}

module.exports = { createFakeWorker };
