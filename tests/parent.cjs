// 보호자 앱(parent.html): 코드 입력(짧은 코드·틀린 코드 401·옛 Worker 404) → 저장하면 GET /family 한 번으로 오늘 카드까지
// → 오늘 카드(연결된 아이: 오늘 횟수·평균·연속·오늘의 단어·화면 이탈·시간 초과·질문·7일 띠·이번 주 vs 지난주 / 연결 안 된 아이: 코드·링크 복사)
// → 해시 뒤로 가기 → 아이 화면 하위 탭 5개(기록 요약·자주 틀린 단어·필터·날짜별 기록 / 세트 목록·잠금 즉시 저장 / 오늘의 단어 계획 저장·지금 만들기·끄기
//   / 연결 코드·링크·기기·이름·제한 시간 즉시 저장·코드 새로 만들기 / 질문) → 아이 추가 → 이름 2단계 확인 삭제 → 오프라인 캐시 → 보호자 코드 삭제(캐시 삭제·#/setup)
// → 옛 설치 호환(index.html?mode=parent → parent.html, 옛 보호자 코드·서버 주소·목록 캐시 이전, 아이 키의 다른 필드 보존, ?mode=child, 보호자 코드만 있던 기기).
// C단계: 상세는 ?days=30&limit=200, 자주 틀린 단어 고르기 → ‘복습 M/D’ 세트 보내기(이름 겹치면 (2)) → 세트 탭, 오늘의 단어 → ‘오늘의 단어 M/D’ 세트,
//        ‘더 보기’ 페이지(겹침 없음·끝나면 숨김·옛 Worker 404면 조용히 숨김), 옛 Worker(전체 기록·recordCount 없음)면 최신 200개·버튼 없음,
//        수준 제안 규칙(올리기·내리기·없음)·카드 ‘적용’(수준만 저장)·‘다음에’(7일 숨김), 뜻 없는 틀린 단어는 빼고 알림.
// 알림(2B): 아이 설정 탭의 공부 알림 시각(#planRemindHour → plan {remindHour}), 보호자 설정 🔔(가짜 구독 tests/lib/fake-push.cjs: 켜기 → /push/key·/push/subscribe
//        role parent·kinds·summaryHour → 체크·시각 즉시 갱신 → 테스트 알림 → 새로고침 유지 → 끄기 → 코드 삭제 때 해지), 미설정 Worker(503) 안내.
// 가족 Worker 는 tests/lib/fake-family-worker.cjs 가 가짜로 응답한다(보호자 앱 기본 서버 주소를 가로챈다).
const { chromium } = require("playwright");
const { createFakeWorker } = require("./lib/fake-family-worker.cjs");
const { fakePushScript } = require("./lib/fake-push.cjs");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: "block" });
  await context.addInitScript(fakePushScript); // 알림: 가짜 구독(Shared.notify 테스트 훅)
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const assert = (v, m) => {
    if (!v) throw Error(m);
  };
  const waitFor = async (fn, m, ms = 5000) => {
    const t0 = Date.now();
    while (!(await fn())) {
      if (Date.now() - t0 > ms) throw Error("timeout: " + m);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const url = process.env.APP_URL || "http://127.0.0.1:8000/daily-vocab/";
  const DEFAULT_SERVER = "https://daily-vocab-ai.reonwipe.workers.dev"; // shared.js AI_SERVER_DEFAULT (라우트로 가로채 실제로는 나가지 않는다)
  const FAMILY_CODE = "family-1234", PARENT_CODE = "parent-9999";
  const HANEUL = "11111111-2222-4333-8444-555555555555", HANEUL_CODE = "483921";
  const DUL = "22222222-3333-4444-8555-666666666666", DUL_CODE = "555666";
  const fake = await createFakeWorker(page, { server: DEFAULT_SERVER, familyCode: FAMILY_CODE, parentCode: PARENT_CODE });
  const { requests, children, dailies, paths, setMode } = fake;
  const localDate = () => {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
  };
  const noonDaysAgo = (n) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return d.toISOString();
  };
  const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const rec = (id, completedAt, extra) => ({ id, setName: "하늘 DAY04", mode: "en_ko", range: "121~130번", startedAt: completedAt, completedAt, total: 10, correct: 8, partial: false, activeMs: 65000, missed: [], ...extra });
  // 하늘: 기기 2대 연결, 오늘 2회(화면 이탈 1·시간 초과 1)·어제 1회·8일 전 1회·40일 전 1회(옛 세트), 질문 1개, 세트 1개, 오늘의 단어 켜짐(7/10 완료)
  const haneul = fake.seedChild(HANEUL, "하늘", HANEUL_CODE);
  haneul.devices = { "dev-a": { label: "iPhone", joinedAt: noonDaysAgo(3), lastSeenAt: minutesAgo(1) }, "dev-b": { label: "Android 태블릿(앱)", joinedAt: noonDaysAgo(3), lastSeenAt: noonDaysAgo(1) } };
  for (const r of [
    rec("r1", minutesAgo(1), { correct: 6, awayCount: 1, awayMs: 3000, timeouts: 1, missed: [{ en: "authority", ko: "권위", unknown: true }, { en: "devote", ko: "바치다" }, { en: "indicate", ko: "나타내다" }, { en: "function", ko: "기능" }] }),
    rec("r2", minutesAgo(2), { mode: "read_meaning", correct: 9, missed: [{ en: "strike", ko: "치다" }] }),
    rec("r3", noonDaysAgo(1), { missed: [{ en: "authority", ko: "권위" }, { en: "devote", ko: "바치다" }] }),
    rec("r4", noonDaysAgo(8), { correct: 5, missed: [{ en: "linger", ko: "머무르다" }] }),
    rec("r5", noonDaysAgo(40), { setName: "옛 세트", range: "전체 5단어", total: 5, correct: 5 }),
  ])
    haneul.records.set(r.id, r);
  haneul.questions.push({ id: "q1", kind: "grammar", question: "왜 aids 인가요?", problem: "UNT 02 2) 어법", summary: "주어가 3인칭 단수라 aids 가 맞아요.", askedAt: minutesAgo(60) });
  haneul.setStore.set("haneul-day04", { id: "haneul-day04", name: "하늘 DAY04", words: [{ id: 121, en: "authority", ko: "권위", aliases: [], ipa: "əˈθɔːrəti" }], updatedAt: noonDaysAgo(2) });
  haneul.plan = { enabled: true, level: "중2 상위권", dailyCount: 10, hour: 16 };
  haneul.anchor = { setName: "하늘 DAY04", words: ["authority", "devote", "indicate"] };
  const dailyWords = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, en: "word" + i, ko: "뜻" + i, ipa: "", aliases: [], kind: i < 3 ? "review" : "new" }));
  dailies.set(HANEUL + ":" + localDate(), { childId: HANEUL, date: localDate(), level: "중2 상위권", words: dailyWords, note: "", completed: { recordId: "r1", correct: 7, total: 10, completedAt: minutesAgo(1) } });
  fake.seedChild(DUL, "둘째", DUL_CODE); // 아직 기기가 없다
  const parentState = () => page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_parent_v1") || "null"));
  const hash = () => page.evaluate(() => location.hash);
  const text = (sel) => page.textContent(sel);
  const textHas = (sel, t) => page.evaluate(([s, x]) => (document.querySelector(s)?.textContent || "").includes(x), [sel, t]);

  // ---- 코드 입력: 코드가 없으면 어떤 주소로 열어도 #/setup, 탭은 숨김, 요청 없음 ----
  await page.goto(url + "parent.html#/children");
  await waitFor(() => page.isVisible("#parentSetup"), "setup screen first");
  assert((await hash()) === "#/setup", "no code → #/setup: " + (await hash()));
  assert((await page.isHidden(".tabbar")) && (await page.isHidden("#refreshFamily")), "tabs and refresh hidden without a code");
  assert((await page.title()) === "매일 영단어 보호자" && (await page.getAttribute('link[rel="manifest"]', "href")) === "./manifest-parent.webmanifest", "parent page title and manifest");
  assert(requests.length === 0, "no requests without a code");
  assert(await page.evaluate(() => typeof window.ParentApp === "object" && typeof ParentApp.computeStats === "function"), "ParentApp exposed");
  await page.fill("#parentCodeStart", "abc");
  await page.click("#saveParentStart");
  assert(await textHas("#parentSetupStatus", "4자"), "short code refused");
  await page.fill("#parentCodeStart", "wrong-code");
  await page.click("#saveParentStart");
  await waitFor(() => textHas("#parentSetupStatus", "보호자 코드가 맞지 않아요"), "wrong code → 401 message");
  assert((await parentState()).parentCode === "", "wrong code is not saved");
  setMode("notfound");
  await page.fill("#parentCodeStart", PARENT_CODE);
  await page.click("#saveParentStart");
  await waitFor(() => textHas("#parentSetupStatus", "다시 배포"), "old Worker → redeploy message");
  setMode("ok");
  const before = requests.length;
  await page.fill("#parentCodeStart", PARENT_CODE);
  await page.press("#parentCodeStart", "Enter");
  await waitFor(() => page.isVisible("#today"), "today screen after saving the code");
  await waitFor(() => page.evaluate(() => document.querySelectorAll("#familyOverview .child-card").length === 2), "two child cards");
  await new Promise((r) => setTimeout(r, 500));
  const startup = requests.slice(before);
  assert(startup.length === 1 && startup[0].method === "GET" && startup[0].path === "/family" && startup[0].passcode === PARENT_CODE, "code → today cards with one GET /family: " + JSON.stringify(startup.map((r) => r.method + " " + r.path)));
  assert((await parentState()).parentCode === PARENT_CODE && (await hash()) === "#/", "code saved, route #/");
  assert((await page.isVisible(".tabbar")) && (await textHas("#familyLoadStatus", "방금 확인했어요")), "tabs and the checked time shown");
  assert((await textHas("#toast", "연결 성공")) && (await textHas("#toast", "2명")), "toast reports the children: " + (await text("#toast")));

  // ---- 오늘 카드 ----
  const card = '#familyOverview .child-card[data-child="' + HANEUL + '"]';
  const haneulCard = await text(card);
  for (const part of ["🧒 하늘", "오늘 시험 ✅ 2회 · 평균 75점", "🔥 2일", "오늘의 단어 ✅ 7 / 10", "⚠️ 오늘 화면 이탈 1회", "⏱ 시간 초과 1개", "📷 물어본 문제 1개", "이번 주 3회 · 평균 77점", "지난주 1회 · 50점", "▲ 27점", "마지막 시험"])
    assert(haneulCard.includes(part), "card has ‘" + part + "’: " + haneulCard);
  assert((await page.$$eval(card + " .day", (d) => d.length)) === 7 && (await page.$$eval(card + " .day.done", (d) => d.length)) === 2 && (await page.$$eval(card + " .day.today.done", (d) => d.length)) === 1, "7-day strip with today and yesterday done");
  const dulCard = await text('#familyOverview .child-card[data-child="' + DUL + '"]');
  assert(dulCard.includes("📲 아이 기기를 연결해 주세요") && dulCard.includes("아이 코드 555 666") && dulCard.includes("링크 복사") && !dulCard.includes("오늘 시험"), "unlinked child card shows one action: " + dulCard);

  // ---- 카드 → 아이 화면 → 뒤로 가기(해시) ----
  await page.click(card);
  await waitFor(() => page.isVisible("#child"), "child screen");
  assert((await hash()) === "#/child/" + HANEUL && (await page.isVisible("#panelRecords")) && (await page.isHidden("#panelSets")), "records tab by default: " + (await hash()));
  await waitFor(() => paths("/family/" + HANEUL, "GET").length === 1, "detail requested once");
  assert(paths("/family/" + HANEUL, "GET")[0].search === "?days=30&limit=200", "detail asks for the 30-day window: " + paths("/family/" + HANEUL, "GET")[0].search);
  await page.goBack();
  await waitFor(() => page.isVisible("#today"), "back to today");
  assert((await hash()) === "#/", "hash back to #/");
  await page.click(card);
  await waitFor(() => page.isVisible("#child"), "child screen again");
  await new Promise((r) => setTimeout(r, 300));
  assert(paths("/family/" + HANEUL, "GET").length === 1, "fresh detail cache is reused (no second detail request)");

  // ---- 기록 탭: 요약 띠·자주 틀린 단어·필터·날짜별 기록 ----
  await waitFor(() => page.evaluate(() => document.querySelectorAll("#childRecords .history-entry").length === 4), "four records in the last 30 days");
  const summary = await text("#recordsSummary");
  assert(summary.includes("이번 주3회평균 77점") && summary.includes("지난주1회평균 50점") && summary.includes("🔥 2일"), "summary strip: " + summary);
  assert((await text("#childDetailTitle")) === "🧒 하늘" && (await textHas("#childDetailSummary", "전체 시험 5회")) && (await textHas("#childDetailSummary", "세트 1개")) && (await textHas("#childDetailSummary", "연결 기기 2대")), "child head: " + (await text("#childDetailSummary")));
  const missed = await text("#missedTop");
  assert(missed.includes("authority") && missed.includes("2회") && missed.includes("권위") && missed.includes("linger"), "most-missed chips (2 weeks): " + missed);
  assert((await page.$$eval("#missedTop .chip", (c) => c.length)) === 6, "six distinct missed words in two weeks");
  const recordsText = await text("#childRecords");
  assert(recordsText.includes("6 / 10 · 60점 · ⏱ 시간 초과 1개") && recordsText.includes("⚠️ 문제 중 화면 이탈 1회") && recordsText.includes("읽기 + 뜻"), "record rows: " + recordsText.slice(0, 300));
  assert((await page.$$eval("#childRecords .day-group", (g) => g.length)) === 3 && (await text("#childRecords .day-group .day-title")).includes("2회 · 평균 75점"), "grouped by day");
  await page.click("#childRecords .history-entry summary");
  assert(await textHas("#childRecords", "authority — 권위 [모름]"), "missed words expand");
  await page.selectOption("#recordsDays", "7");
  await waitFor(() => page.evaluate(() => document.querySelectorAll("#childRecords .history-entry").length === 3), "7-day filter");
  await page.selectOption("#recordsDays", "0");
  await waitFor(() => page.evaluate(() => document.querySelectorAll("#childRecords .history-entry").length === 5), "all-time filter");
  await page.selectOption("#recordsSet", "옛 세트");
  await waitFor(() => page.evaluate(() => document.querySelectorAll("#childRecords .history-entry").length === 1), "set filter");
  assert((await parentState()).prefs.recordsSet === "옛 세트" && (await parentState()).prefs.recordsDays === 0, "filters remembered");
  await page.selectOption("#recordsSet", "all");
  await page.selectOption("#recordsDays", "30");
  assert((await page.isHidden("#loadMoreRecords")) && (await text("#recordsNote")) === "", "no ‘more’ when every record is already here (recordCount 5)");
  assert((await parentState()).details[HANEUL].recordTotal === 5 && (await parentState()).details[HANEUL].more === true, "detail cache keeps recordCount and more");

  // ---- 자주 틀린 단어 → 복습 세트 보내기: 기본 전부 선택, 눌러서 빼기, 이름 ‘복습 M/D’, 같은 이름이면 ‘(2)’ ----
  assert((await page.$$eval("#missedTop .chip.pick.on", (c) => c.length)) === 6 && (await textHas("#missedPicked", "6개 골랐어요")), "all missed words picked by default");
  await page.click('#missedTop .chip[data-word="strike"]');
  await page.click('#missedTop .chip[data-word="linger"]');
  await waitFor(() => textHas("#missedPicked", "4개 골랐어요"), "two chips unpicked");
  assert((await page.getAttribute('#missedTop .chip[data-word="strike"]', "aria-pressed")) === "false", "unpicked chip state");
  await page.click("#sendMissedSet");
  await waitFor(() => page.evaluate(() => location.hash.endsWith("/sets")), "moves to the sets tab after sending");
  const reviewName = "복습 " + md(new Date());
  let sent = paths("/family/" + HANEUL + "/sets", "POST");
  assert(sent.length === 1 && sent[0].passcode === PARENT_CODE, "review set sent with the parent code");
  assert(sent[0].body.set.name === reviewName && /^[0-9a-f-]{36}$/.test(sent[0].body.set.id), "review set name and id: " + JSON.stringify(sent[0].body.set).slice(0, 120));
  assert(
    JSON.stringify(sent[0].body.set.words) ===
      JSON.stringify([
        { id: 1, en: "authority", ko: "권위", aliases: [], ipa: "" },
        { id: 2, en: "devote", ko: "바치다", aliases: [], ipa: "" },
        { id: 3, en: "function", ko: "기능", aliases: [], ipa: "" },
        { id: 4, en: "indicate", ko: "나타내다", aliases: [], ipa: "" },
      ]),
    "review words (picked, numbered, meanings from the records): " + JSON.stringify(sent[0].body.set.words),
  );
  await waitFor(() => textHas("#childSets", reviewName + " · 4단어"), "review set listed");
  assert((await textHas("#setsStatus", "보냈어요")) && (await textHas("#toast", `‘${reviewName}’ 4단어를 하늘에게 보냈어요`)), "toast: " + (await text("#toast")));
  assert(fake.liveSets(children.get(HANEUL)).some((x) => x.name === reviewName && x.words.length === 4), "review set stored for the child's devices");
  await page.click("#subRecords");
  await waitFor(() => textHas("#missedPicked", "6개 골랐어요"), "picks reset to all");
  await page.click("#sendMissedSet");
  await waitFor(() => paths("/family/" + HANEUL + "/sets", "POST").length === 2, "second review set");
  sent = paths("/family/" + HANEUL + "/sets", "POST")[1].body.set;
  assert(sent.name === reviewName + " (2)" && sent.words.length === 6, "same name gets (2): " + sent.name);
  await waitFor(() => textHas("#childSets", reviewName + " (2) · 6단어"), "second review set listed");
  await page.click("#subRecords");
  await waitFor(() => page.isVisible("#panelRecords"), "records tab again");

  // ---- 세트 탭: 목록(최근 점수·시험 횟수)·잠금 즉시 저장 ----
  await page.click("#subSets");
  await waitFor(() => page.isVisible("#panelSets"), "sets tab");
  assert((await hash()) === "#/child/" + HANEUL + "/sets", "sets tab route");
  const setsText = await text("#childSets");
  assert(setsText.includes("하늘 DAY04 · 1단어") && setsText.includes("최근 60점 · 30일 시험 4회") && setsText.includes("고침"), "set row with stats: " + setsText);
  assert(!(await page.isChecked("#setsLock")), "lock off by default");
  await page.check("#setsLock");
  await waitFor(() => textHas("#setsStatus", "잠갔어요"), "lock saved");
  let planReqs = paths("/family/" + HANEUL + "/plan", "POST");
  assert(planReqs.length === 1 && planReqs[0].passcode === PARENT_CODE && JSON.stringify(planReqs[0].body) === JSON.stringify({ setsLocked: true }), "lock sent alone: " + JSON.stringify(planReqs.map((r) => r.body)));
  await page.uncheck("#setsLock");
  await waitFor(() => textHas("#setsStatus", "잠금을 풀었어요"), "unlock saved");
  assert(JSON.stringify(paths("/family/" + HANEUL + "/plan", "POST")[1].body) === JSON.stringify({ setsLocked: false }), "unlock body");
  assert(fake.planOf(children.get(HANEUL)).enabled === true && fake.planOf(children.get(HANEUL)).setsLocked === false, "other plan fields kept");

  // ---- 오늘의 단어 탭: 계획 폼·미리보기·저장 본문·직접 입력 수준·지금 만들기·끄기 ----
  await page.click("#subDaily");
  await waitFor(() => page.isVisible("#panelDaily"), "daily tab");
  await waitFor(() => page.evaluate(() => document.querySelectorAll("#dailyPreview .daily-word").length === 10), "preview lists today's words");
  assert((await page.$$eval("#dailyPreview .tag.review", (t) => t.length)) === 3 && (await textHas("#dailyPreview", "✅ 7 / 10 맞았어요")), "preview with review tags and completion");
  assert(await page.isVisible("#saveDailyAsSet"), "save-as-set shown when today's words exist");
  assert(await page.isHidden("#levelSuggest"), "no level suggestion for a mixed fortnight");
  await page.click("#saveDailyAsSet");
  await waitFor(() => paths("/family/" + HANEUL + "/sets", "POST").length === 3, "daily words sent as a set");
  const dailySet = paths("/family/" + HANEUL + "/sets", "POST")[2].body.set;
  const [, mm, dd] = localDate().split("-");
  assert(dailySet.name === `오늘의 단어 ${Number(mm)}/${Number(dd)}` && dailySet.words.length === 10, "daily set name: " + dailySet.name);
  assert(JSON.stringify(dailySet.words[0]) === JSON.stringify({ id: 1, en: "word0", ko: "뜻0", ipa: "", aliases: [] }) && !("kind" in dailySet.words[0]), "daily set words: " + JSON.stringify(dailySet.words[0]));
  await waitFor(() => textHas("#childSets", dailySet.name + " · 10단어"), "daily set listed on the sets tab");
  assert(paths("/family/" + HANEUL + "/plan", "POST").length === 2 && dailies.get(HANEUL + ":" + localDate()).words.length === 10, "saving as a set leaves the plan and today's words alone");
  await page.click("#subDaily");
  await waitFor(() => page.isVisible("#panelDaily"), "daily tab again");
  assert((await page.isChecked("#planEnabled")) && (await page.inputValue("#planLevel")) === "중2 상위권" && (await page.inputValue("#planCount")) === "10" && (await page.inputValue("#planHour")) === "16", "plan fields");
  assert((await textHas("#planAnchor", "하늘 DAY04")) && (await textHas("#planAnchor", "3단어")), "level anchor: " + (await text("#planAnchor")));
  await page.selectOption("#planCount", "15");
  await page.selectOption("#planLevel", "고1·수능 기초");
  await page.click("#savePlan");
  await waitFor(() => textHas("#planStatus", "저장했어요"), "plan saved");
  planReqs = paths("/family/" + HANEUL + "/plan", "POST");
  assert(JSON.stringify(planReqs[2].body) === JSON.stringify({ enabled: true, level: "고1·수능 기초", dailyCount: 15, hour: 16 }) && planReqs[2].passcode === PARENT_CODE, "plan body: " + JSON.stringify(planReqs[2].body));
  assert(await textHas("#planStatus", "15개"), "status mentions the count");
  await page.selectOption("#planLevel", "__custom");
  assert(await page.isVisible("#planLevelCustom"), "custom level input appears");
  await page.fill("#planLevelCustom", "중3 상위권");
  await page.click("#savePlan");
  await waitFor(() => paths("/family/" + HANEUL + "/plan", "POST").length === 4, "second plan save");
  assert(paths("/family/" + HANEUL + "/plan", "POST")[3].body.level === "중3 상위권", "custom level sent");
  await page.click("#makeDailyNow");
  await waitFor(() => textHas("#planStatus", "준비됐어요"), "make-now reports the words");
  assert(paths("/daily/" + HANEUL, "POST").length === 1 && paths("/daily/" + HANEUL, "POST")[0].passcode === PARENT_CODE, "make-now uses the parent code");
  await page.uncheck("#planEnabled");
  await page.click("#savePlan");
  await waitFor(() => textHas("#planStatus", "만들지 않아요"), "plan disabled message");
  assert(await textHas("#dailyPreview", "꺼져 있어요"), "preview reflects the disabled plan");
  await page.click("#tabToday");
  await waitFor(() => page.isVisible("#today"), "today again");
  assert(await textHas(card, "오늘의 단어 꺼짐"), "card follows the saved plan: " + (await text(card)));
  await page.click(card);
  await waitFor(() => page.isVisible("#child"), "child again");

  // ---- 설정 탭: 연결 코드·링크·기기, 제한 시간 즉시 저장, 이름, 코드 새로 만들기 ----
  await page.click("#subSettings");
  await waitFor(() => page.isVisible("#panelSettings"), "settings tab");
  assert((await text("#childCodeText")) === "483 921" && (await text("#childLinkText")) === url + "?child=" + HANEUL_CODE, "code and child link: " + (await text("#childLinkText")));
  assert((await textHas("#deviceList", "연결된 기기: iPhone")) && (await textHas("#deviceList", "Android 태블릿(앱)")), "device list");
  await page.selectOption("#planTimeLimit", "20");
  await waitFor(() => textHas("#limitStatus", "저장했어요"), "time limit saved at once");
  const limitReq = paths("/family/" + HANEUL + "/plan", "POST").slice(-1)[0];
  assert(JSON.stringify(limitReq.body) === JSON.stringify({ timeLimitSec: 20 }) && (await textHas("#limitStatus", "20초")), "time limit sent alone: " + JSON.stringify(limitReq.body));
  assert(fake.planOf(children.get(HANEUL)).level === "중3 상위권" && fake.planOf(children.get(HANEUL)).timeLimitSec === 20, "server plan keeps the level and stores the limit");
  // 공부 알림 시각: 없음 / 오후 3시~10시, 바꾸면 바로 {remindHour} 만 저장
  assert((await page.inputValue("#planRemindHour")) === "" && (await page.$$eval("#planRemindHour option", (o) => o.map((x) => x.textContent).join(","))) === "없음,오후 3시,오후 4시,오후 5시,오후 6시,오후 7시,오후 8시,오후 9시,오후 10시", "remind hour choices, off by default");
  await page.selectOption("#planRemindHour", "20");
  await waitFor(() => textHas("#remindStatus", "저장했어요"), "remind hour saved at once");
  let remindReq = paths("/family/" + HANEUL + "/plan", "POST").slice(-1)[0];
  assert(JSON.stringify(remindReq.body) === JSON.stringify({ remindHour: 20 }) && remindReq.passcode === PARENT_CODE && (await textHas("#remindStatus", "오후 8시까지 시험이 없을 때")), "remind hour sent alone: " + JSON.stringify(remindReq.body));
  assert(fake.planOf(children.get(HANEUL)).remindHour === 20 && fake.planOf(children.get(HANEUL)).timeLimitSec === 20, "server plan stores the remind hour, keeps the limit");
  await page.selectOption("#planRemindHour", "");
  await waitFor(() => textHas("#remindStatus", "보내지 않아요"), "remind hour cleared");
  remindReq = paths("/family/" + HANEUL + "/plan", "POST").slice(-1)[0];
  assert(JSON.stringify(remindReq.body) === JSON.stringify({ remindHour: null }) && fake.planOf(children.get(HANEUL)).remindHour === null, "null clears it: " + JSON.stringify(remindReq.body));
  await page.fill("#renameChild", "하늘이");
  await page.click("#saveChildName");
  await waitFor(() => page.evaluate(() => document.getElementById("childDetailTitle").textContent === "🧒 하늘이"), "renamed");
  assert(paths("/family/" + HANEUL + "/name", "POST")[0].body.name === "하늘이" && (await textHas("#nameStatus", "바꿨어요")), "rename request and message");
  page.once("dialog", (d) => d.accept());
  await page.click("#regenCode");
  await waitFor(() => page.evaluate(() => document.getElementById("childCodeText").textContent === "777 777"), "new code shown");
  assert((await text("#childLinkText")).endsWith("?child=777777") && (await textHas("#linkStatus", "새 아이 코드 777 777")), "link follows the new code");

  // ---- 질문 탭 ----
  await page.click("#subQuestions");
  await waitFor(() => page.isVisible("#panelQuestions"), "questions tab");
  const questions = await text("#childQuestions");
  assert((await text("#childQuestionCount")) === "1개" && (await textHas("#questionsSummary", "이번 주 1개")) && questions.includes("UNT 02 2) 어법") && questions.includes("어법 설명 · 왜 aids 인가요?") && questions.includes("3인칭 단수"), "question rows: " + questions);
  // ← 뒤로: 하위 탭은 history 를 늘리지 않으므로 아이 화면을 연 곳(오늘)으로 돌아간다
  await page.click("#closeChildDetail");
  await waitFor(() => page.isVisible("#today"), "back closes the child screen");

  // ---- 아이들: 목록·아이 추가(→ 설정 탭에 코드)·이름 확인 2단계 삭제 ----
  await page.click("#tabChildren");
  await waitFor(() => page.isVisible("#children"), "children screen");
  const list = await text("#childrenList");
  assert(list.includes("🧒 하늘이") && list.includes("연결 기기: iPhone 1 · Android 태블릿(앱) 1") && list.includes("아직 연결된 기기 없음 · 아이 코드 555 666"), "children list: " + list);
  await page.click("#addChild");
  assert(await textHas("#addChildStatus", "이름"), "name required");
  await page.fill("#newChildName", " 셋째 ");
  await page.click("#addChild");
  await waitFor(() => page.evaluate(() => location.hash === "#/child/child-777778/settings"), "new child's settings tab opened");
  assert(paths("/family/children", "POST")[0].body.name === "셋째" && paths("/family/children", "POST")[0].passcode === PARENT_CODE, "create request");
  await waitFor(() => page.evaluate(() => document.getElementById("childCodeText").textContent === "777 778"), "new code shown");
  assert((await textHas("#addChildStatus", "아이 코드 777 778")) && (await textHas("#deviceList", "아직 연결된 기기가 없어요")), "new child's code and no devices");
  await page.click("#deleteChild");
  assert((await page.isVisible("#deleteConfirm")) && (await page.isDisabled("#deleteChildGo")), "delete asks for the name first");
  await page.fill("#deleteConfirmName", "셋");
  assert(await page.isDisabled("#deleteChildGo"), "wrong name keeps delete disabled");
  await page.fill("#deleteConfirmName", "셋째");
  await page.click("#deleteChildGo");
  await waitFor(() => page.evaluate(() => location.hash === "#/children"), "back to the list after deleting");
  assert(paths("/family/child-777778", "DELETE").length === 1 && !children.has("child-777778"), "delete request");
  await waitFor(() => page.evaluate(() => !document.getElementById("childrenList").textContent.includes("셋째")), "deleted child removed from the list");
  assert(!JSON.stringify(await parentState()).includes("child-777778"), "deleted child removed from the cache");

  // ---- 오프라인: 서버에 닿지 못해도 마지막으로 받은 카드가 보인다 ----
  setMode("abort");
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("daily_vocab_parent_v1"));
    s.fetchedAt = new Date(Date.now() - 3600000).toISOString(); // 오래된 캐시 → 열 때 새로 받으려 한다
    localStorage.setItem("daily_vocab_parent_v1", JSON.stringify(s));
  });
  await page.evaluate(() => (location.hash = "#/"));
  await page.reload(); // 해시만 바꾸면 같은 문서라서 다시 연다
  await waitFor(() => page.evaluate(() => document.querySelectorAll("#familyOverview .child-card").length === 2), "cached cards while offline");
  await waitFor(() => textHas("#toast", "연결하지 못했어요"), "one offline toast");
  assert((await textHas("#familyLoadStatus", "새로 불러오지 못했어요")) && (await textHas(card, "오늘 시험 ✅ 2회")), "status line and cached stats");
  setMode("ok");

  // ---- 보호자 설정: 상태·코드 삭제(캐시도 삭제 → #/setup) ----
  await page.click("#tabSettings");
  await waitFor(() => page.isVisible("#settings"), "settings screen");
  assert((await textHas("#parentState", "연결됨 · 아이 2명")) && (await page.inputValue("#parentServer")) === DEFAULT_SERVER, "parent state and server");
  assert((await page.getAttribute("#openChildApp", "href")) === "./", "child app link");
  await page.click("#checkApp");
  assert((await textHas("#appStatus", "앱 준비 완료")) && (await textHas("#appStatus", "편집기 연결됨")), "app check: " + (await text("#appStatus")));
  // ---- 🔔 알림(이 폰): 켜기 → 구독 본문(role parent·kinds·summaryHour) → 체크·시각 즉시 갱신 → 테스트 알림 → 새로고침 유지 → 끄기 → 다시 켜기 ----
  const pushState = () => page.evaluate(() => JSON.parse(localStorage.getItem("__test_push") || "{}"));
  assert((await text("#notifyState")) === "꺼짐" && (await page.isHidden("#notifyOptions")) && (await textHas("#notifyStatus", "알림 꺼짐")) && !(await textHas("#settings", "준비 중")), "notify card starts off (no ready-soon chip)");
  assert(paths("/push/key").length === 0 && paths("/push/subscribe").length === 0, "nothing sent before turning it on");
  await page.click("#notifyEnable");
  await waitFor(() => textHas("#notifyStatus", "알림을 켰어요"), "parent notifications on");
  assert(paths("/push/key", "GET").length === 1 && paths("/push/key", "GET")[0].passcode === PARENT_CODE, "server key with the parent code");
  let pushSubs = paths("/push/subscribe", "POST");
  const pushDevice = pushSubs[0].body.device.id;
  assert(
    pushSubs.length === 1 && pushSubs[0].passcode === PARENT_CODE && pushSubs[0].body.role === "parent" && !("childId" in pushSubs[0].body) && /^[0-9a-f-]{36}$/.test(pushDevice) &&
      typeof pushSubs[0].body.device.label === "string" && pushSubs[0].body.subscription.endpoint === "https://push.test/sub/1" &&
      JSON.stringify(pushSubs[0].body.kinds) === JSON.stringify({ finish: true, summary: true }) && pushSubs[0].body.summaryHour === 21,
    "parent subscribe body: " + JSON.stringify(pushSubs[0].body).slice(0, 220),
  );
  let saved = (await parentState()).prefs;
  assert(saved.deviceId === pushDevice && JSON.stringify(saved.push) === JSON.stringify({ deviceId: pushDevice, endpoint: "https://push.test/sub/1", kinds: { finish: true, summary: true }, summaryHour: 21 }), "prefs.push stored: " + JSON.stringify(saved.push));
  assert((await text("#notifyState")) === "켜짐" && (await page.isVisible("#notifyOptions")) && (await text("#notifyEnable")) === "🔕 알림 끄기" && (await textHas("#toast", "알림을 켰어요")), "card shows on");
  assert((await page.inputValue("#notifySummaryHour")) === "21" && (await page.$$eval("#notifySummaryHour option", (o) => o.length)) === 6, "summary hour 18~23, default 21");
  await page.uncheck("#notifyFinish");
  await waitFor(() => paths("/push/subscribe", "POST").length === 2, "kinds change sent at once");
  pushSubs = paths("/push/subscribe", "POST");
  assert(JSON.stringify(pushSubs[1].body.kinds) === JSON.stringify({ finish: false, summary: true }) && pushSubs[1].body.device.id === pushDevice && pushSubs[1].body.subscription.endpoint === "https://push.test/sub/1", "same subscription, new kinds");
  await waitFor(() => textHas("#notifyStatus", "저장했어요"), "kinds saved message");
  await page.selectOption("#notifySummaryHour", "22");
  await waitFor(() => paths("/push/subscribe", "POST").length === 3, "summary hour sent at once");
  await waitFor(() => textHas("#notifyStatus", "저녁 요약 오후 10시"), "summary hour saved message");
  assert(paths("/push/subscribe", "POST")[2].body.summaryHour === 22, "summary hour 22");
  await waitFor(async () => (await parentState()).prefs.push.summaryHour === 22 && (await parentState()).prefs.push.kinds.finish === false, "prefs follow");
  await page.click("#notifyTest");
  await waitFor(() => textHas("#notifyStatus", "테스트 알림을 보냈어요"), "test push sent");
  const testReq = paths("/push/test", "POST")[0];
  assert(testReq.passcode === PARENT_CODE && JSON.stringify(testReq.body) === JSON.stringify({ role: "parent", device: { id: pushDevice } }), "test body: " + JSON.stringify(testReq.body));
  await page.reload();
  await waitFor(() => page.isVisible("#notifyOptions"), "card after reload");
  await new Promise((r) => setTimeout(r, 300));
  assert(!(await page.isChecked("#notifyFinish")) && (await page.isChecked("#notifySummary")) && (await page.inputValue("#notifySummaryHour")) === "22" && paths("/push/subscribe", "POST").length === 3, "choices kept, no re-registration for the same subscription");
  await page.click("#notifyEnable");
  await waitFor(() => paths("/push/unsubscribe", "POST").length === 1, "turned off: unsubscribe");
  assert(JSON.stringify(paths("/push/unsubscribe", "POST")[0].body) === JSON.stringify({ role: "parent", device: { id: pushDevice } }) && paths("/push/unsubscribe", "POST")[0].passcode === PARENT_CODE, "unsubscribe body");
  await waitFor(() => textHas("#notifyStatus", "알림을 껐어요"), "off message");
  assert((await parentState()).prefs.push === null && !(await pushState()).sub && fake.pushSubs.size === 0 && (await text("#notifyState")) === "꺼짐" && (await page.isHidden("#notifyOptions")), "everything off");
  await page.click("#notifyEnable");
  await waitFor(() => paths("/push/subscribe", "POST").length === 4 && fake.pushSubs.size === 1, "on again");
  assert(paths("/push/subscribe", "POST")[3].body.device.id === pushDevice, "the phone keeps its device id");
  page.once("dialog", (d) => d.accept());
  await page.click("#clearParent");
  await waitFor(() => page.isVisible("#parentSetup"), "setup after clearing");
  const cleared = await parentState();
  assert((await hash()) === "#/setup" && cleared.parentCode === "" && cleared.children.length === 0 && Object.keys(cleared.details).length === 0 && !cleared.fetchedAt, "code and cache cleared: " + JSON.stringify(cleared).slice(0, 160));
  await waitFor(() => paths("/push/unsubscribe", "POST").length === 2, "clearing the code removes the server subscription");
  assert(paths("/push/unsubscribe", "POST")[1].passcode === PARENT_CODE && cleared.prefs.push === null && !(await pushState()).sub && fake.pushSubs.size === 0, "push cleared with the code");
  assert(await page.isHidden(".tabbar"), "tabs hidden again");

  // ---- 옛 설치 호환: 보호자 아이콘(…/?mode=parent)으로 열면 parent.html 로 옮기고 옛 키를 이전한다 ----
  const old = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: "block" });
  const oldPage = await old.newPage();
  oldPage.on("pageerror", (e) => errors.push("old: " + e.message));
  const OLD_SERVER = "https://ai.test";
  const oldFake = await createFakeWorker(oldPage, { server: OLD_SERVER, familyCode: FAMILY_CODE, parentCode: PARENT_CODE });
  oldFake.seedChild(HANEUL, "하늘", HANEUL_CODE);
  await oldPage.goto(url + "manifest.webmanifest"); // 앱이 아닌 같은 출처 페이지에서 옛 키를 심는다
  await oldPage.evaluate(
    ([server, code, id]) => {
      localStorage.setItem("daily_vocab_family_v1", JSON.stringify({ childId: "", deviceId: "dev-12345678", sendEnabled: false, pending: [], lastSyncAt: "2026-10-01T00:00:00.000Z", parentCode: code, parentModeOff: true }));
      localStorage.setItem("daily_vocab_ai_v2", JSON.stringify({ server, passcode: "family-1234" }));
      localStorage.setItem("daily_vocab_family_cache_v1", JSON.stringify({ children: [{ id, name: "하늘(캐시)", devices: {}, records: [], joinCode: "483921" }], fetchedAt: new Date(Date.now() - 3600000).toISOString() }));
      localStorage.setItem("daily_vocab_mode_v1", "parent");
    },
    [OLD_SERVER, PARENT_CODE, HANEUL],
  );
  await oldPage.goto(url + "?mode=parent");
  await oldPage.waitForURL(/parent\.html/);
  await waitFor(() => oldPage.evaluate(() => typeof window.ParentApp === "object"), "parent app after the redirect");
  const migrated = await oldPage.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_parent_v1")));
  assert(migrated.parentCode === PARENT_CODE && migrated.server === OLD_SERVER, "code and server migrated: " + JSON.stringify(migrated).slice(0, 160));
  const leftovers = await oldPage.evaluate(() => ({
    cache: localStorage.getItem("daily_vocab_family_cache_v1"),
    mode: localStorage.getItem("daily_vocab_mode_v1"),
    family: JSON.parse(localStorage.getItem("daily_vocab_family_v1")),
    ai: JSON.parse(localStorage.getItem("daily_vocab_ai_v2")),
  }));
  assert(leftovers.cache === null && leftovers.mode === null, "old parent cache and mode removed");
  assert(!("parentCode" in leftovers.family) && !("parentModeOff" in leftovers.family) && leftovers.family.deviceId === "dev-12345678" && leftovers.family.lastSyncAt === "2026-10-01T00:00:00.000Z", "child key keeps its other fields: " + JSON.stringify(leftovers.family));
  assert(leftovers.ai.passcode === "family-1234", "child AI settings untouched");
  await waitFor(() => oldPage.evaluate(() => document.querySelector("#familyOverview")?.textContent.includes("🧒 하늘")), "cards shown after migration");
  await waitFor(() => oldFake.paths("/family", "GET").length === 1, "stale migrated cache refreshed from the old server");
  assert(oldFake.paths("/family", "GET")[0].passcode === PARENT_CODE, "refreshed with the migrated code");
  // 이전 뒤에는 아이용 앱 주소가 그대로 아이 앱이고(보호자 모드 화면 없음), 옛 보호자 아이콘 주소는 계속 보호자 앱으로 간다
  await oldPage.goto(url);
  await waitFor(() => oldPage.evaluate(() => typeof sets !== "undefined" && document.getElementById("appStatus").textContent.includes("준비")), "child app opens normally");
  assert(oldPage.url() === url && (await oldPage.isVisible("#home")) && (await oldPage.$("#tabFamily")) === null && (await oldPage.$("#family")) === null, "child app without a parent mode");
  await oldPage.goto(url + "?mode=parent");
  await oldPage.waitForURL(/parent\.html/);
  await waitFor(() => oldPage.isVisible("#today"), "old parent icon keeps opening the parent app");
  // ?mode=child 는 기억한 모드를 지우고 아이 앱을 연다
  await oldPage.evaluate(() => localStorage.setItem("daily_vocab_mode_v1", "parent"));
  await oldPage.goto(url + "?mode=child");
  await waitFor(() => oldPage.evaluate(() => typeof sets !== "undefined"), "child app with ?mode=child");
  assert(!oldPage.url().includes("parent.html") && !oldPage.url().includes("mode=") && (await oldPage.evaluate(() => localStorage.getItem("daily_vocab_mode_v1"))) === null, "mode cleared: " + oldPage.url());
  // 보호자 코드만 있고 아이로 연결되지 않은 기기(옛 설정 화면에서 코드를 넣은 보호자 폰)도 보호자 앱으로 옮긴다
  const bare = await browser.newContext({ serviceWorkers: "block" });
  const barePage = await bare.newPage();
  barePage.on("pageerror", (e) => errors.push("bare: " + e.message));
  await barePage.goto(url + "manifest.webmanifest");
  await barePage.evaluate((code) => localStorage.setItem("daily_vocab_family_v1", JSON.stringify({ parentCode: code })), PARENT_CODE);
  await barePage.route(DEFAULT_SERVER + "/**", (r) => r.abort());
  await barePage.goto(url);
  await barePage.waitForURL(/parent\.html/);
  await waitFor(() => barePage.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_parent_v1") || "{}").parentCode === "parent-9999"), "parent-code-only device migrated");

  // ---- 수준 제안 규칙(순수 함수 ParentApp.suggestLevel) ----
  const rules = await page.evaluate(() => {
    const S = (wc, wa, pc, pa, missed = 0) => ({ week: { count: wc, avg: wa }, prevWeek: { count: pc, avg: pa }, missedTop: Array.from({ length: missed }, (_, i) => ({ en: "w" + i })) });
    const f = (stats, level) => {
      const r = ParentApp.suggestLevel(stats, level === undefined ? null : { level });
      return r ? `${r.direction}:${r.to}:${r.avg}` : null;
    };
    return {
      up: f(S(3, 92, 4, 95, 3), "중2 상위권"),
      upDefault: f(S(5, 95, 3, 90, 5)),
      tooManyMissed: f(S(3, 92, 4, 95, 6), "중2 상위권"),
      fewTests: f(S(2, 100, 4, 100), "중2 상위권"),
      oneWeekLow: f(S(3, 89, 4, 95), "중2 상위권"),
      top: f(S(3, 95, 3, 95), "고2·수능 실전"),
      custom: f(S(3, 95, 3, 95), "중3 상위권"),
      down: f(S(1, 50, 2, 55, 9), "중2 상위권"),
      bottom: f(S(2, 40, 2, 50), "초등 고학년 상위권"),
      mixed: f(S(3, 95, 3, 55), "중2 상위권"),
      noPrev: f(S(4, 30, 0, null), "중2 상위권"),
    };
  });
  assert(
    JSON.stringify(rules) ===
      JSON.stringify({ up: "up:중3·고1:94", upDefault: "up:중3·고1:93", tooManyMissed: null, fewTests: null, oneWeekLow: null, top: null, custom: null, down: "down:중1:53", bottom: null, mixed: null, noPrev: null }),
    "suggestLevel rules: " + JSON.stringify(rules),
  );

  // ---- ‘더 보기’ · 뜻 없는 틀린 단어 · 수준 제안 카드: 기록 27개(최근 13일 22개 + 40일 전 5개) 아이, ‘더 보기’ 한 페이지 2개 ----
  const pg = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: "block" });
  await pg.addInitScript(fakePushScript);
  const pgPage = await pg.newPage();
  pgPage.on("pageerror", (e) => errors.push("paging: " + e.message));
  const pgFake = await createFakeWorker(pgPage, { server: DEFAULT_SERVER, familyCode: FAMILY_CODE, parentCode: PARENT_CODE, detailPageSize: 2, push: false }); // push:false = 알림 키가 없는 Worker
  const PG = "33333333-4444-4555-8666-777777777777";
  const pgChild = pgFake.seedChild(PG, "다온", "246810");
  pgChild.devices = { "dev-c": { label: "iPhone", joinedAt: noonDaysAgo(20), lastSeenAt: minutesAgo(5) } };
  const daysAgoAt = (n, h) => (n === 0 ? minutesAgo(10 + h * 5) : new Date(Date.parse(noonDaysAgo(n)) - h * 3600000).toISOString());
  for (let i = 0; i < 22; i++)
    pgChild.records.set("p" + i, rec("p" + i, daysAgoAt(i % 13, Math.floor(i / 13)), i === 0 ? { correct: 8, missed: [{ en: "fleeting", ko: "" }, { en: "vivid", ko: "생생한" }] } : { correct: 10 }));
  for (let i = 0; i < 5; i++) pgChild.records.set("old" + i, rec("old" + i, noonDaysAgo(40 + i), { correct: 6, setName: "옛 세트" }));
  const pgText = (sel) => pgPage.textContent(sel);
  const pgHas = (sel, t) => pgPage.evaluate(([x, y]) => (document.querySelector(x)?.textContent || "").includes(y), [sel, t]);
  const pgEntries = () => pgPage.evaluate(() => document.querySelectorAll("#childRecords .history-entry").length);
  const pgState = () => pgPage.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_parent_v1")));
  await pgPage.goto(url + "parent.html");
  await pgPage.fill("#parentCodeStart", PARENT_CODE);
  await pgPage.click("#saveParentStart");
  await waitFor(() => pgPage.isVisible("#today"), "paging: today");
  await pgPage.evaluate((id) => (location.hash = "#/child/" + id), PG);
  await waitFor(async () => (await pgEntries()) === 22, "paging: 22 records in the 30-day window");
  // 목록(최근 14일)도 22개라 상세가 오기 전에 22개가 먼저 보인다: 상세의 기록 수 문구가 나올 때까지 기다린다
  await waitFor(() => pgHas("#recordsNote", "전체 27회 중 최근 22개를 받았어요"), "paging: detail loaded");
  assert((await pgHas("#childDetailSummary", "전체 시험 27회")) && (await pgHas("#recordsNote", "더 보기")), "recordCount shown: " + (await pgText("#recordsNote")) + " / " + (await pgText("#childDetailSummary")));
  assert(await pgPage.isVisible("#loadMoreRecords"), "‘more’ button when older records exist");
  // 뜻이 없는 틀린 단어: 그것만 고르면 보내지 않고 알린다, 모두 빼면 버튼이 꺼진다, 섞여 있으면 빼고 보낸다
  assert((await pgPage.$$eval("#missedTop .chip", (c) => c.length)) === 2 && (await pgHas('#missedTop .chip[data-word="fleeting"]', "뜻 없음")), "missed chips with a missing meaning");
  await pgPage.click('#missedTop .chip[data-word="vivid"]');
  await waitFor(() => pgHas("#missedPicked", "1개 골랐어요"), "one picked");
  await pgPage.click("#sendMissedSet");
  await waitFor(() => pgHas("#missedStatus", "뜻이 기록되지 않아"), "no meaning → nothing to send");
  await pgPage.click('#missedTop .chip[data-word="fleeting"]');
  await waitFor(() => pgPage.isDisabled("#sendMissedSet"), "nothing picked → button disabled");
  assert(pgFake.paths("/family/" + PG + "/sets", "POST").length === 0, "nothing sent yet");
  await pgPage.click('#missedTop .chip[data-word="fleeting"]');
  await pgPage.click('#missedTop .chip[data-word="vivid"]');
  await pgPage.click("#sendMissedSet");
  await waitFor(() => pgFake.paths("/family/" + PG + "/sets", "POST").length === 1, "review set with a skipped word");
  assert(JSON.stringify(pgFake.paths("/family/" + PG + "/sets", "POST")[0].body.set.words) === JSON.stringify([{ id: 1, en: "vivid", ko: "생생한", aliases: [], ipa: "" }]), "word without a meaning skipped");
  await waitFor(() => pgHas("#toast", "뜻이 기록되지 않은 단어 1개는 뺐어요"), "skip reported");
  await pgPage.click("#subRecords");
  await waitFor(() => pgPage.isVisible("#panelRecords"), "paging: records tab again");
  // 더 보기 1쪽: 기간이 ‘전체’로 바뀌고 목록의 마지막 completedAt 을 before 로 보낸다
  const oldestShown = (await pgState()).details[PG].records.slice(-1)[0].completedAt;
  await pgPage.click("#loadMoreRecords");
  await waitFor(async () => (await pgEntries()) === 24, "first older page appended");
  const page1Req = pgFake.paths("/family/" + PG + "/records", "GET")[0];
  assert(page1Req.passcode === PARENT_CODE && page1Req.search === "?limit=100&before=" + encodeURIComponent(oldestShown), "page request: " + page1Req.search);
  assert((await pgPage.inputValue("#recordsDays")) === "0" && (await pgPage.isVisible("#loadMoreRecords")), "filter switched to all, more remains");
  // 옛 Worker처럼 404 not_found 면 토스트 없이 버튼만 숨긴다
  pgFake.setMode("notfound");
  await pgPage.click("#loadMoreRecords");
  await waitFor(() => pgPage.isHidden("#loadMoreRecords"), "404 hides the button");
  assert(!(await pgHas("#toast", "다시 배포")) && (await pgText("#recordsStatus")) === "" && (await pgEntries()) === 24, "quietly: " + (await pgText("#toast")));
  pgFake.setMode("ok");
  // 새로고침으로 상세를 다시 받으면 옛 페이지는 버리고 처음부터 다시 이어 받는다 → 끝까지(겹침 없음) → 버튼 숨김
  await pgPage.click("#refreshFamily");
  await waitFor(async () => (await pgEntries()) === 22 && (await pgPage.isVisible("#loadMoreRecords")), "refresh resets the older pages");
  for (const want of [24, 26, 27]) {
    await pgPage.click("#loadMoreRecords");
    await waitFor(async () => (await pgEntries()) === want, "older page → " + want);
  }
  await waitFor(() => pgPage.isHidden("#loadMoreRecords"), "button hidden after the last page");
  const befores = pgFake.paths("/family/" + PG + "/records", "GET").slice(2).map((r) => new URLSearchParams(r.search).get("before"));
  assert(befores.length === 3 && befores.every((b, i) => !i || b < befores[i - 1]), "each page continues before the previous one: " + befores.join(" | "));
  const shownIds = await pgPage.$$eval("#childRecords .history-meta", (m) => m.length);
  assert(shownIds === 27 && (await pgHas("#childRecords", "옛 세트")), "all 27 records shown once");
  const savedPg = await pgState();
  assert(savedPg.details[PG].records.length === 22 && !JSON.stringify(savedPg).includes('"old0"'), "older pages are not saved");
  // 수준 제안 카드: 두 주 모두 3회 이상·90점 이상·틀린 단어 2개 → 한 단계 올리기(오늘의 단어가 꺼져 있어도)
  await pgPage.click("#subDaily");
  await waitFor(() => pgPage.isVisible("#levelSuggest"), "level suggestion card");
  assert((await pgText("#levelSuggestText")) === "최근 2주 평균 99점이에요. 수준을 ‘중3·고1’로 올려 볼까요?", "suggestion text: " + (await pgText("#levelSuggestText")));
  assert((await pgHas("#levelSuggestWhy", "이번 주 14회")) && (await pgHas("#levelSuggestWhy", "지난주 8회")) && (await pgHas("#levelSuggestWhy", "자주 틀린 단어 2개")) && !(await pgPage.isChecked("#planEnabled")), "reasons shown with the plan off");
  await pgPage.click("#applyLevel");
  await waitFor(() => pgHas("#toast", "수준을 ‘중3·고1’로 바꿨어요"), "apply toast");
  let pgPlans = pgFake.paths("/family/" + PG + "/plan", "POST");
  assert(pgPlans.length === 1 && JSON.stringify(pgPlans[0].body) === JSON.stringify({ level: "중3·고1" }), "only the level is saved: " + JSON.stringify(pgPlans.map((r) => r.body)));
  assert(pgFake.planOf(pgFake.children.get(PG)).level === "중3·고1" && pgFake.planOf(pgFake.children.get(PG)).enabled === false, "plan stays off, level changed");
  await waitFor(() => pgPage.isHidden("#levelSuggest"), "card hidden after applying");
  assert((await pgPage.inputValue("#planLevel")) === "중3·고1" && (await pgState()).prefs.levelSuggestDismissed[PG] === localDate(), "form follows, hidden for a week");
  // 7일이 지나면 다시 묻는다(다음 단계) → ‘다음에’는 저장 없이 7일 숨김
  await pgPage.evaluate((id) => {
    const d = new Date();
    d.setDate(d.getDate() - 8); // 이 폰 날짜로 8일 전
    const st = JSON.parse(localStorage.getItem("daily_vocab_parent_v1"));
    st.prefs.levelSuggestDismissed[id] = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
    localStorage.setItem("daily_vocab_parent_v1", JSON.stringify(st));
  }, PG);
  await pgPage.reload();
  await waitFor(() => pgPage.isVisible("#levelSuggest"), "suggestion back after a week");
  assert(await pgHas("#levelSuggestText", "‘고1·수능 기초’로 올려"), "next level suggested: " + (await pgText("#levelSuggestText")));
  await pgPage.click("#dismissLevel");
  await waitFor(() => pgPage.isHidden("#levelSuggest"), "later hides the card");
  assert(pgFake.paths("/family/" + PG + "/plan", "POST").length === 1 && (await pgState()).prefs.levelSuggestDismissed[PG] === localDate(), "later saves nothing on the server");
  await pgPage.reload();
  await waitFor(() => pgPage.isVisible("#panelDaily"), "daily tab after reload");
  await new Promise((r) => setTimeout(r, 300));
  assert(await pgPage.isHidden("#levelSuggest"), "still hidden after reload");
  // 알림 키가 없는 Worker(503 push_unconfigured): 켜려 하면 안내만 하고 다른 기능은 그대로
  await pgPage.click("#tabSettings");
  await waitFor(() => pgPage.isVisible("#notifyEnable"), "paging: settings");
  await pgPage.click("#notifyEnable");
  await waitFor(() => pgHas("#notifyStatus", "알림 서버가 아직 준비되지 않았어요"), "unconfigured Worker message");
  assert((await pgState()).prefs.push === null && (await pgText("#notifyState")) === "꺼짐" && pgFake.paths("/push/subscribe").length === 0, "stays off without server keys");

  // ---- 옛 Worker(2026-10-19 이전): 상세가 인자를 무시하고 전체 기록(203개)을 주고 recordCount·more·‘더 보기’ 경로가 없다 ----
  const ow = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: "block" });
  const owPage = await ow.newPage();
  owPage.on("pageerror", (e) => errors.push("old worker: " + e.message));
  const owFake = await createFakeWorker(owPage, { server: DEFAULT_SERVER, familyCode: FAMILY_CODE, parentCode: PARENT_CODE, pagedDetail: false });
  const owChild = owFake.seedChild(PG, "다온", "246810");
  owChild.devices = { "dev-c": { label: "iPhone", joinedAt: noonDaysAgo(30), lastSeenAt: minutesAgo(5) } };
  for (let i = 0; i < 203; i++) owChild.records.set("w" + i, rec("w" + i, new Date(Date.now() - (i * 3 + 1) * 3600000).toISOString()));
  await owPage.goto(url + "parent.html");
  await owPage.fill("#parentCodeStart", PARENT_CODE);
  await owPage.click("#saveParentStart");
  await waitFor(() => owPage.isVisible("#today"), "old worker: today");
  await owPage.evaluate((id) => (location.hash = "#/child/" + id), PG);
  await waitFor(() => owPage.evaluate(() => (document.getElementById("recordsNote").textContent || "").includes("전체 203회 중 최근 200개를 받았어요")), "old worker: newest 200 of 203");
  const owState = await owPage.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_parent_v1")));
  assert(owState.details[PG].records.length === 200 && owState.details[PG].recordTotal === 203 && owState.details[PG].more === false, "old worker: cache trimmed to 200, total = received");
  assert(owFake.paths("/family/" + PG, "GET")[0].search === "?days=30&limit=200" && (await owPage.isHidden("#loadMoreRecords")) && !(await owPage.textContent("#recordsNote")).includes("더 보기"), "old worker: no ‘more’");
  assert((await owPage.textContent("#childDetailSummary")).includes("전체 시험 203회") && (await owPage.$$eval("#childRecords .history-entry", (e) => e.length)) === 200, "old worker: summary and list");
  await new Promise((r) => setTimeout(r, 300));
  assert(owFake.paths("/family/" + PG + "/records").length === 0 && !(await owPage.getAttribute("#toast", "class")).includes("bad"), "old worker: no page request, no error toast");

  assert(errors.length === 0, "page errors: " + errors.join(" | "));
  console.log("PASS: parent app — setup (length/401/404, one GET /family to the cards), today cards (linked/unlinked), hash back, child tabs (records summary/missed/filters, sets/lock, daily plan/make-now/off, link/code/devices/time limit/rename/regen, questions), add/delete child (name confirm), offline cache, clear code, old-install redirect + migration, 30-day detail + ‘more’ pages (404 quiet, old Worker 200), review set from missed words ((2) names, skipped meanings), daily words as a set, level suggestion rules/apply/later, notifications (remind hour, parent push on/kinds/hour/test/off/clear, 503)");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
