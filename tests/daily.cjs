// 오늘의 단어: 아이 기기 — 계획이 꺼져 있으면 카드 없음 → 보호자가 켠 뒤 앱을 열면 GET(no_daily) → POST 생성 → 홈 카드 →
// 풀기(기존 시험 엔진) → 기록에 daily 날짜가 붙어 전송 → ✅ 카드 → 새로고침해도 재생성 없음.
// 보호자 폰 — 아이 카드의 오늘의 단어 상태, 상세의 계획 저장(요청 본문)·미리보기·지금 만들기. 가족 서버는 라우트로 가짜 응답을 준다.
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 1100 }, serviceWorkers: "block" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const assert = (v, m) => {
    if (!v) throw Error(m);
  };
  const waitFor = async (fn, m, ms = 6000) => {
    const t0 = Date.now();
    while (!(await fn())) {
      if (Date.now() - t0 > ms) throw Error("timeout: " + m);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const SERVER = "https://ai.test", FAMILY_CODE = "family-1234", PARENT_CODE = "parent-9999";
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS" };
  const reply = (route, status, body) => route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
  const requests = [];
  const children = new Map();
  const dailies = new Map(); // childId:date → daily
  const HANEUL = "11111111-2222-4333-8444-555555555555", HANEUL_CODE = "483921"; // 보호자가 미리 만들어 둔 아이
  children.set(HANEUL, { id: HANEUL, name: "하늘", joinCode: HANEUL_CODE, devices: {}, sets: [], records: new Map(), lastTestAt: null });
  const NEW_WORDS = ["glimpse", "verdict", "linger", "thrive", "plead", "subtle", "wither", "forge", "ample", "dwell", "exert", "notion"];
  const localDate = () => {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
  };
  const planOf = (c) => ({ enabled: false, level: "중2 상위권", dailyCount: 10, hour: 16, timeLimitSec: 0, ...(c.plan || {}) });
  const todayOf = (c, date) => {
    const d = dailies.get(c.id + ":" + date);
    return { date, exists: Boolean(d), count: d ? d.words.length : 0, completed: d?.completed || null };
  };
  const summaryOf = (c) => ({
    id: c.id, name: c.name, sets: c.sets, anchor: c.anchor, plan: planOf(c), updatedAt: c.updatedAt, lastTestAt: c.lastTestAt, today: todayOf(c, localDate()),
    records: [...c.records.values()].sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
  });
  const makeDaily = (c, date) => {
    const plan = planOf(c);
    const latest = [...c.records.values()].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    const review = [];
    for (const r of latest) for (const m of r.missed || []) if (review.length < 3 && !review.some((x) => x.en === m.en)) review.push({ en: m.en, ko: m.ko, kind: "review" });
    const fresh = NEW_WORDS.filter((w) => !review.some((r) => r.en === w)).slice(0, plan.dailyCount - review.length).map((w) => ({ en: w, ko: w + "의 뜻", kind: "new" }));
    const words = [...review, ...fresh].map((w, i) => ({ id: i + 1, en: w.en, ko: w.ko, ipa: "ˈ" + w.en, aliases: [w.ko, w.en + "뜻"], kind: w.kind }));
    const daily = { childId: c.id, date, level: plan.level, model: "claude-sonnet-5-5", createdAt: new Date().toISOString(), words, note: "" };
    dailies.set(c.id + ":" + date, daily);
    return daily;
  };
  await page.route(SERVER + "/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const passcode = req.headers()["x-app-passcode"];
    requests.push({ method: req.method(), path: url.pathname, search: url.search, passcode, body });
    const family = [FAMILY_CODE, PARENT_CODE].includes(passcode);
    if (url.pathname === "/join" && req.method() === "POST") {
      if (!family) return reply(route, 401, { error: "unauthorized", message: "접속 코드가 맞지 않습니다." });
      const c = [...children.values()].find((x) => x.joinCode === String(body.code || "").replace(/\D/g, ""));
      if (!c) return reply(route, 404, { error: "unknown_code", message: "그 아이 코드를 찾을 수 없어요." });
      if (body.device?.id) c.devices[body.device.id] = { label: body.device.label, joinedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() };
      return reply(route, 200, { ok: true, childId: c.id, name: c.name, timeLimitSec: planOf(c).timeLimitSec });
    }
    const sm = /^\/settings\/([A-Za-z0-9-]+)$/.exec(url.pathname);
    if (sm && req.method() === "GET") {
      if (!family) return reply(route, 401, { error: "unauthorized", message: "접속 코드가 맞지 않습니다." });
      const c = children.get(sm[1]);
      if (!c) return reply(route, 404, { error: "unknown_child", message: "그 아이의 기록이 없습니다." });
      return reply(route, 200, { childId: c.id, name: c.name, timeLimitSec: planOf(c).timeLimitSec });
    }
    if (url.pathname === "/sync" && req.method() === "POST") {
      if (!family) return reply(route, 401, { error: "unauthorized", message: "접속 코드가 맞지 않습니다." });
      const c = children.get(body.child.id) || { id: body.child.id, sets: [], records: new Map(), lastTestAt: null, devices: {} };
      if (!c.name) c.name = body.child.name;
      if (body.sets) c.sets = body.sets;
      if (body.anchor) c.anchor = body.anchor;
      c.updatedAt = new Date().toISOString();
      for (const r of body.records) {
        c.records.set(r.id, r);
        if (!c.lastTestAt || r.completedAt > c.lastTestAt) c.lastTestAt = r.completedAt;
        const d = r.daily && !r.partial ? dailies.get(c.id + ":" + r.daily) : null;
        if (d) d.completed = { recordId: r.id, correct: r.correct, total: r.total, completedAt: r.completedAt };
      }
      children.set(c.id, c);
      return reply(route, 200, { ok: true, stored: body.records.length, trimmed: 0, syncedAt: c.updatedAt });
    }
    const dm = /^\/daily\/([A-Za-z0-9-]+)$/.exec(url.pathname);
    if (dm) {
      if (!family) return reply(route, 401, { error: "unauthorized", message: "접속 코드가 맞지 않습니다." });
      const c = children.get(dm[1]);
      if (!c) return reply(route, 404, { error: "unknown_child", message: "그 아이의 기록이 없습니다." });
      const date = (req.method() === "GET" ? url.searchParams.get("date") : body?.date) || localDate();
      const existing = dailies.get(c.id + ":" + date);
      if (existing) return reply(route, 200, existing);
      if (!planOf(c).enabled) return reply(route, 409, { error: "plan_disabled", message: "보호자가 아직 오늘의 단어를 켜지 않았어요." });
      if (req.method() === "GET") return reply(route, 404, { error: "no_daily", message: "오늘의 단어가 아직 없어요." });
      return reply(route, 200, makeDaily(c, date));
    }
    const pm = /^\/family\/([A-Za-z0-9-]+)\/plan$/.exec(url.pathname);
    const m = /^\/family(?:\/([A-Za-z0-9-]+))?$/.exec(url.pathname);
    if (!pm && !m) return reply(route, 404, { error: "not_found", message: "지원하지 않는 요청입니다." });
    if (passcode !== PARENT_CODE) return reply(route, 401, { error: "unauthorized", message: "보호자 코드가 맞지 않습니다." });
    if (pm) {
      const c = children.get(pm[1]);
      if (!c) return reply(route, 404, { error: "unknown_child", message: "그 아이의 기록이 없습니다." });
      c.plan = { ...planOf(c), ...body, updatedAt: new Date().toISOString() };
      return reply(route, 200, { ok: true, child: { ...summaryOf(c), records: undefined } });
    }
    if (!m[1]) return reply(route, 200, { children: [...children.values()].map(summaryOf), serverTime: new Date().toISOString() });
    const c = children.get(m[1]);
    if (!c) return reply(route, 404, { error: "unknown_child", message: "그 아이의 기록이 없습니다." });
    if (req.method() === "DELETE") {
      children.delete(m[1]);
      return reply(route, 200, { ok: true, deleted: c.records.size });
    }
    const s = summaryOf(c);
    const d = dailies.get(c.id + ":" + localDate());
    return reply(route, 200, {
      child: { id: s.id, name: s.name, sets: s.sets, anchor: s.anchor, plan: s.plan },
      records: s.records,
      today: { date: localDate(), exists: Boolean(d), words: d?.words || [], note: "", completed: d?.completed || null },
    });
  });
  const paths = (p, method) => requests.filter((r) => r.path === p && (!method || r.method === method));
  const openFamilySettings = () => page.evaluate(() => { document.getElementById("familySettings").open = true; });
  const statusHas = (id, text) => page.evaluate(([i, t]) => document.getElementById(i).textContent.includes(t), [id, text]);
  const url = process.env.APP_URL || "http://127.0.0.1:8000/daily-vocab/";
  const today = localDate();
  await page.goto(url);
  await page.evaluate((cfg) => localStorage.setItem("daily_vocab_ai_v2", JSON.stringify(cfg)), { server: SERVER, passcode: FAMILY_CODE });
  await page.reload();

  // 아이 기기: 아이 코드로 연결한다(보내기 자동 켜짐). 계획이 꺼져 있으므로 오늘의 단어 카드는 없다.
  await page.click("#tabSettings");
  await openFamilySettings();
  await page.fill("#childCode", HANEUL_CODE);
  await page.click("#joinChild");
  await waitFor(() => statusHas("familyStatus", "마지막 전송"), "joined and registered");
  const childId = paths("/sync")[0].body.child.id;
  assert(childId === HANEUL && (await page.textContent("#childName")) === "하늘", "joined as the pre-made child");
  await waitFor(() => paths("/daily/" + childId, "GET").length >= 1, "daily checked after enabling");
  assert(paths("/daily/" + childId, "POST").length === 0, "no generation while the plan is off");
  assert(await page.isHidden("#dailyCard"), "no daily card while the plan is off");
  const anchor = paths("/sync")[0].body.anchor;
  assert(anchor && anchor.setName === "기본 예제 DAY04" && anchor.words.length === 40 && anchor.words.includes("authority"), "anchor words sent from the current set: " + JSON.stringify(anchor).slice(0, 80));
  await waitFor(() => paths("/sets/" + childId, "POST").length >= 1, "set sync attempted");
  assert((await page.evaluate(() => sets.length)) === 1 && (await page.evaluate(() => sets[0].id)) === "day04", "old Worker (404 /sets): example set kept");

  // 시험 한 번 → 틀린 단어가 생긴다(복습 후보)
  await page.click("#tabHome");
  await page.click('[data-mode="en_ko"]');
  await page.selectOption("#range", "0");
  await page.uncheck("#shuffle");
  await page.click("#start");
  for (let i = 0; i < 10; i++) {
    await page.click("#unknown");
    await page.click("#next");
  }
  await waitFor(() => paths("/sync").some((r) => r.body.records.length === 1 && r.body.records[0].total === 10), "test record synced");

  // 보호자가 계획을 켠다(가짜 서버) → 앱을 다시 열면 GET(no_daily) → POST 생성 → 카드
  children.get(childId).plan = { enabled: true, level: "중2 상위권", dailyCount: 10, hour: 16 };
  await page.reload();
  await waitFor(() => page.isVisible("#dailyCard"), "daily card appears");
  assert(paths("/daily/" + childId, "POST").length === 1, "generated once");
  assert(paths("/daily/" + childId, "POST")[0].body.date === today, "generation asks for today");
  const cardText = await page.textContent("#dailyCard");
  assert(cardText.includes("📬 오늘의 단어") && cardText.includes("새 단어 7개") && cardText.includes("복습 3개") && cardText.includes("중2 상위권"), "card text: " + cardText);
  const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("daily_vocab_daily_v1")));
  assert(stored.date === today && stored.words.length === 10 && stored.words[0].kind === "review" && stored.words[0].en === "authority", "daily stored locally: " + JSON.stringify(stored).slice(0, 120));

  // 풀기 → 기존 시험 엔진 → 기록에 daily 날짜 → 전송 → ✅ 카드
  await page.click("#startDaily");
  assert(await page.isVisible("#quiz"), "quiz started from the daily card");
  assert((await page.textContent("#sessionScope")).includes("오늘의 단어"), "scope shows 오늘의 단어");
  assert((await page.textContent("#progressText")).startsWith("1 / 10"), "ten daily words");
  for (let i = 0; i < 10; i++) {
    await page.click("#unknown");
    await page.click("#next");
  }
  assert(await page.isVisible("#finish"), "daily quiz finished");
  const saved = await page.evaluate(() => historyRecords[0]);
  assert(saved.daily === today && saved.setId === "daily:" + today && saved.setName.startsWith("오늘의 단어"), "record carries the daily date: " + JSON.stringify({ daily: saved.daily, setId: saved.setId }));
  await waitFor(() => paths("/sync").some((r) => r.body.records.some((x) => x.daily === today && x.total === 10)), "daily record synced");
  assert((await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("daily_vocab_missed_daily")).length)) === 0, "no missed-key for the transient daily set");
  await page.click("#newTest");
  await waitFor(() => page.evaluate(() => document.getElementById("dailyTitle").textContent.includes("✅")), "card shows completion");
  const doneText = await page.textContent("#dailyCard");
  assert(doneText.includes("0 / 10 맞았어요") && doneText.includes("한 번 더 풀기"), "completion text: " + doneText);
  // 새로고침해도 다시 만들지 않고 ✅ 상태가 남는다
  await page.reload();
  await waitFor(() => page.isVisible("#dailyCard"), "card after reload");
  assert((await page.textContent("#dailyTitle")).includes("✅"), "completion kept after reload");
  await new Promise((r) => setTimeout(r, 400));
  assert(paths("/daily/" + childId, "POST").length === 1, "no regeneration after reload");

  // 보호자 폰: 아이 카드의 오늘의 단어 상태, 상세의 계획·미리보기 (보호자 화면으로 열어야 코드 칸이 보인다)
  await page.goto(url + "?mode=parent");
  await waitFor(() => page.isVisible("#parentSetup"), "parent setup screen");
  await page.fill("#parentCodeStart", PARENT_CODE);
  await page.click("#saveParentStart");
  await waitFor(() => statusHas("parentSetupStatus", "연결 성공"), "parent connected");
  await waitFor(() => statusHas("familyLoadStatus", "방금 확인했어요"), "family loaded");
  assert((await page.textContent("#childrenList")).includes("오늘의 단어 ✅ 0 / 10"), "child card shows daily completion: " + (await page.textContent("#childrenList")));
  await page.click("#childrenList button");
  await waitFor(() => page.evaluate(() => document.querySelectorAll("#dailyPreview .daily-word").length === 10), "preview lists today's words");
  assert((await page.$$eval("#dailyPreview .tag.review", (t) => t.length)) === 3, "three review tags");
  assert(await page.isChecked("#planEnabled"), "plan enabled shown");
  assert((await page.inputValue("#planLevel")) === "중2 상위권" && (await page.inputValue("#planCount")) === "10" && (await page.inputValue("#planHour")) === "16", "plan fields");
  assert((await page.textContent("#planAnchor")).includes("기본 예제 DAY04") && (await page.textContent("#planAnchor")).includes("40단어"), "anchor info shown");
  assert((await page.textContent("#dailyPreview")).includes("✅ 0 / 10"), "preview shows completion");
  await page.selectOption("#planCount", "15");
  await page.selectOption("#planLevel", "고1·수능 기초");
  await page.click("#savePlan");
  await waitFor(() => statusHas("planStatus", "저장했어요"), "plan saved");
  const planReq = paths("/family/" + childId + "/plan", "POST")[0];
  assert(planReq && planReq.passcode === PARENT_CODE, "plan saved with the parent code");
  assert(JSON.stringify(planReq.body) === JSON.stringify({ enabled: true, level: "고1·수능 기초", dailyCount: 15, hour: 16, timeLimitSec: 0 }), "plan body: " + JSON.stringify(planReq.body));
  assert((await page.textContent("#planStatus")).includes("15개"), "status mentions the count");
  await page.selectOption("#planLevel", "__custom");
  assert(await page.isVisible("#planLevelCustom"), "custom level input appears");
  await page.fill("#planLevelCustom", "중3 상위권");
  await page.click("#savePlan");
  await waitFor(() => paths("/family/" + childId + "/plan", "POST").length === 2, "second plan save");
  assert(paths("/family/" + childId + "/plan", "POST")[1].body.level === "중3 상위권", "custom level sent");
  await page.click("#makeDailyNow");
  await waitFor(() => statusHas("planStatus", "준비됐어요"), "make now reports the existing set");
  assert(paths("/daily/" + childId, "POST").length === 2 && paths("/daily/" + childId, "POST")[1].passcode === PARENT_CODE, "make-now uses the parent code");
  await page.uncheck("#planEnabled");
  await page.selectOption("#planTimeLimit", "20");
  await page.click("#savePlan");
  await waitFor(() => statusHas("planStatus", "만들지 않아요"), "plan disabled message");
  assert((await page.textContent("#dailyPreview")).includes("꺼져 있어요"), "preview reflects the disabled plan");
  const limitReq = paths("/family/" + childId + "/plan", "POST").slice(-1)[0];
  assert(limitReq.body.timeLimitSec === 20 && limitReq.body.enabled === false, "time limit sent with the plan: " + JSON.stringify(limitReq.body));
  assert((await page.textContent("#planStatus")).includes("제한 시간 20초"), "status mentions the time limit");

  // 문제당 제한 시간: 아이 기기는 앱을 열 때 설정을 받아 두고, 시간이 지나면 그 문제를 모름 처리한다(앱 밖에 있어도 시간은 흐른다)
  // (이 테스트 페이지는 보호자 코드도 저장돼 보호자 모드이므로, 아이용 화면을 쓰려고 ‘아이 기기처럼 보기’를 켠다)
  await page.click("#tabSettings");
  await openFamilySettings();
  await page.check("#parentModeOff");
  await waitFor(() => page.isVisible("#home"), "child UI back for the quiz");
  children.get(childId).plan.timeLimitSec = 10;
  await page.reload();
  await waitFor(() => paths("/settings/" + childId, "GET").length >= 1, "settings fetched on launch");
  await waitFor(() => page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_family_v1")).settings.timeLimitSec === 10), "time limit stored");
  await page.click("#tabHome");
  await page.selectOption("#range", "0");
  await page.click("#start");
  await waitFor(() => page.isVisible("#timeLeft"), "timer shown");
  assert(/⏱ (10|9)초/.test(await page.textContent("#timeLeft")), "timer counts down from the limit: " + (await page.textContent("#timeLeft")));
  await page.waitForFunction(() => question.unknown === true, null, { timeout: 15000 });
  assert((await page.textContent("#answerFeedback")).includes("시간이 다 됐어요"), "timeout feedback");
  assert((await page.textContent("#timeLeft")) === "⏱ 0초", "timer shows zero");
  assert(!(await page.isDisabled("#next")), "next enabled after timeout");
  await page.click("#next");
  assert(/⏱ (10|9)초/.test(await page.textContent("#timeLeft")), "timer restarts on the next question");
  await page.click("#unknown");
  assert(await page.isHidden("#timeLeft"), "timer hidden once the question is answered");
  await page.click("#next");
  page.once("dialog", (d) => d.accept());
  await page.click("#backSettings");
  assert(await page.isVisible("#finish"), "stopped after two questions");
  const timed = await page.evaluate(() => ({ timeouts: historyRecords[0].timeouts, first: historyRecords[0].results[0].timeout, second: historyRecords[0].results[1].timeout }));
  assert(timed.timeouts === 1 && timed.first === true && timed.second === undefined, "timeout recorded per question: " + JSON.stringify(timed));
  await waitFor(() => paths("/sync").some((r) => r.body.records.some((x) => x.timeouts === 1)), "timeouts synced");
  assert((await page.textContent("#historyList")) !== null, "history exists");
  await page.click("#tabHistory");
  assert((await page.textContent("#historyList")).includes("⏱ 시간 초과 1개"), "child history shows the timeout");
  await page.click("#tabSettings");
  await openFamilySettings();
  await page.uncheck("#parentModeOff");
  await waitFor(() => page.isVisible("#family"), "parent mode back");
  await waitFor(() => statusHas("familyLoadStatus", "방금 확인했어요"), "family reloaded");
  await page.click("#childrenList button");
  await waitFor(() => page.evaluate(() => document.getElementById("childRecords").textContent.includes("⏱ 시간 초과 1개")), "parent record shows the timeout");
  assert((await page.textContent("#familyOverview")).includes("⏱ 시간 초과 1개"), "overview warns about the timeout");
  assert((await page.inputValue("#planTimeLimit")) === "10", "plan form shows the current limit");

  assert(errors.length === 0, "page errors: " + errors.join(" | "));
  console.log("PASS: daily words — child card/generation/quiz/record flag/completion, parent plan form/preview/make-now");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
