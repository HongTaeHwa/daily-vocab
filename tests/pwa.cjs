const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  const p = await b.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(process.env.APP_URL || "http://127.0.0.1:8000/daily-vocab/");
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload();
  for (const size of [
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await p.setViewportSize(size);
    if (
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    )
      throw Error("layout overflow " + JSON.stringify(size));
  }
  const m = await p.evaluate(
    async () => await (await fetch("./manifest.webmanifest")).json(),
  );
  for (const icon of m.icons) {
    if (!(await p.evaluate(async (path) => (await fetch(path)).ok, icon.src)))
      throw Error("icon missing");
  }
  await p.context().setOffline(true);
  await p.reload();
  if ((await p.locator("#setSelect option").count()) !== 1)
    throw Error("offline shell");
  // 보호자 앱(parent.html): 오프라인에서도 셸과 마지막으로 받은 카드가 열리고, 모든 화면이 3가지 폭에서 가로로 넘치지 않는다
  await p.evaluate(() => {
    const now = new Date().toISOString();
    const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
    const longName = "하늘 DAY04 아주 긴 세트 이름이 들어가도 줄이 넘치지 않아야 해요 (161~200번)";
    const rec = (id, n, extra) => ({ id, setName: longName, mode: "en_ko", range: "121~160번", startedAt: daysAgo(n), completedAt: daysAgo(n), total: 10, correct: 7, activeMs: 60000, missed: [{ en: "authority", ko: "권위 · 권한 · 당국 · 아주 긴 뜻 설명" }], ...extra });
    const records = [rec("a", 0, { awayCount: 1, awayMs: 2000, timeouts: 1, aiPass: 1 }), rec("b", 1), rec("c", 8, { partial: true })];
    const child = {
      id: "c1", name: "하늘", joinCode: "483921", devices: { d1: { label: "iPhone", lastSeenAt: now }, d2: { label: "Android 태블릿(앱)", lastSeenAt: now } },
      sets: [{ id: "s1", name: longName, count: 40, updatedAt: now }], anchor: { setName: longName, words: ["authority"] },
      plan: { enabled: true, level: "중2 상위권", dailyCount: 10, hour: 16, timeLimitSec: 15, setsLocked: false },
      today: { date: now.slice(0, 10), exists: true, count: 2, completed: null }, questionCount: 1, lastQuestionAt: now, records,
    };
    const words = [{ id: 1, en: "linger", ko: "머무르다", kind: "review" }, { id: 2, en: "glimpse", ko: "힐끗 봄", kind: "new" }];
    const questions = [{ id: "q", kind: "ask", question: "왜 이 답이 맞는지 아주 길게 물어본 질문입니다 왜 이 답이 맞나요?", problem: "UNIT 3 문제 2 아주 긴 문제 설명", summary: "요약", askedAt: now }];
    localStorage.setItem("daily_vocab_parent_v1", JSON.stringify({
      parentCode: "parent-9999", server: "https://ai.test", fetchedAt: now, prefs: { recordsSet: "all", recordsDays: 30 },
      children: [child, { id: "c2", name: "둘째", joinCode: "555666", devices: {}, sets: [], records: [] }],
      details: { c1: { child: { ...child, records: undefined }, records, recordTotal: 3, questions, today: { date: now.slice(0, 10), exists: true, words, note: "", completed: null }, fetchedAt: now, viewedAt: now } },
    }));
  });
  await p.goto((process.env.APP_URL || "http://127.0.0.1:8000/daily-vocab/") + "parent.html#/");
  await p.waitForFunction(() => document.querySelectorAll("#familyOverview .child-card").length === 2);
  for (const size of [
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await p.setViewportSize(size);
    for (const route of ["#/", "#/children", "#/child/c1", "#/child/c1/sets", "#/child/c1/daily", "#/child/c1/settings", "#/child/c1/questions", "#/child/c1/sets/new", "#/settings"]) {
      await p.evaluate((r) => (location.hash = r), route);
      await p.waitForTimeout(60);
      if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth))
        throw Error("parent layout overflow " + route + " " + JSON.stringify(size));
    }
  }
  if (!(await p.evaluate(() => document.getElementById("editor").classList.contains("active"))) && !(await p.isVisible("#settings")))
    throw Error("parent routes did not render");
  const pm = await p.evaluate(async () => await (await fetch("./manifest-parent.webmanifest")).json());
  if (pm.start_url !== "/daily-vocab/parent.html" || pm.scope !== "/daily-vocab/") throw Error("parent manifest start_url " + pm.start_url);
  for (const icon of pm.icons) {
    if (!(await p.evaluate(async (path) => (await fetch(path)).ok, icon.src)))
      throw Error("parent icon missing " + icon.src);
  }
  await p.context().setOffline(false);
  await p.goto(process.env.APP_URL || "http://127.0.0.1:8000/daily-vocab/");
  // 이후 요청 가로채기를 위해 서비스워커 해제
  await p.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  });
  await p.reload();
  await p.evaluate(() =>
    localStorage.setItem(
      "daily_vocab_ai_v2",
      JSON.stringify({ server: "https://ai.test", passcode: "family-1234" }),
    ),
  );
  let mode = "error";
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "POST, OPTIONS",
  };
  await p.route("https://ai.test/**", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    if (mode === "error")
      return route.fulfill({
        status: 503,
        headers: cors,
        contentType: "application/json",
        body: JSON.stringify({ error: "upstream", message: "AI 서버가 혼잡합니다." }),
      });
    await new Promise((r) => setTimeout(r, 1500));
    return route.fulfill({
      status: 200,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({ words: [{ number: 0, en: "apple", ko: "사과", aliases: [] }], note: "" }),
    });
  });
  await p.click("#createSet");
  await p.setInputFiles("#photos", {
    name: "valid.png",
    mimeType: "image/png",
    buffer: await p.screenshot(),
  });
  await p.click("#extractWords");
  await p.waitForFunction(() => !document.getElementById("extractWords").disabled);
  if (!(await p.textContent("#extractStatus")).includes("가져오지 못했습니다"))
    throw Error("server error surfaced");
  mode = "slow";
  await p.click("#extractWords");
  await p.click("#cancelExtract");
  await p.waitForTimeout(2000);
  if (await p.inputValue("#wordDraft")) throw Error("cancel stale write");
  if (errors.length) throw Error(errors.join(","));
  console.log(
    "PASS: tablet portrait/landscape/mobile layout, manifest/icons, offline shell, parent app offline shell/layout/manifest, AI error/cancellation",
  );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
