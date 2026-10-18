// 가족 기록함: 아이 기기가 시험 기록을 가족 서버로 보내고(켜기·완료·연결 실패·재전송·끄기), 보호자 폰은 보호자 코드로
// ‘아이들’ 탭에서 아이별 기록을 본다(코드 오류·옛 Worker 안내·카드·상세·틀린 단어·삭제·코드 삭제). Worker는 라우트로 가짜 응답을 준다.
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
  const waitFor = async (fn, m, ms = 5000) => {
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
  const children = new Map(); // 가짜 가족 기록함(Worker의 FamilyStore 역할)
  let mode = "ok";
  const summaryOf = (c) => ({
    id: c.id, name: c.name, sets: c.sets, updatedAt: c.updatedAt, lastTestAt: c.lastTestAt,
    records: [...c.records.values()].sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
  });
  await page.route(SERVER + "/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const passcode = req.headers()["x-app-passcode"];
    requests.push({ method: req.method(), path: url.pathname, passcode, body });
    if (mode === "abort") return route.abort("connectionrefused");
    if (mode === "notfound") return reply(route, 404, { error: "not_found", message: "지원하지 않는 요청입니다." });
    if (url.pathname === "/sync" && req.method() === "POST") {
      if (![FAMILY_CODE, PARENT_CODE].includes(passcode)) return reply(route, 401, { error: "unauthorized", message: "접속 코드가 맞지 않습니다." });
      const c = children.get(body.child.id) || { id: body.child.id, sets: [], records: new Map(), lastTestAt: null };
      c.name = body.child.name;
      if (body.sets) c.sets = body.sets;
      c.updatedAt = new Date().toISOString();
      for (const r of body.records) {
        c.records.set(r.id, r);
        if (!c.lastTestAt || r.completedAt > c.lastTestAt) c.lastTestAt = r.completedAt;
      }
      children.set(c.id, c);
      return reply(route, 200, { ok: true, stored: body.records.length, trimmed: 0, syncedAt: c.updatedAt });
    }
    if (url.pathname.startsWith("/daily/")) return reply(route, 409, { error: "plan_disabled", message: "보호자가 아직 오늘의 단어를 켜지 않았어요." });
    const m = /^\/family(?:\/([A-Za-z0-9-]+))?$/.exec(url.pathname);
    if (!m) return reply(route, 404, { error: "not_found", message: "지원하지 않는 요청입니다." });
    if (passcode !== PARENT_CODE) return reply(route, 401, { error: "unauthorized", message: "보호자 코드가 맞지 않습니다." });
    if (!m[1]) return reply(route, 200, { children: [...children.values()].map(summaryOf), serverTime: new Date().toISOString() });
    const c = children.get(m[1]);
    if (!c) return reply(route, 404, { error: "unknown_child", message: "그 아이의 기록이 없습니다." });
    if (req.method() === "DELETE") {
      children.delete(m[1]);
      return reply(route, 200, { ok: true, deleted: c.records.size });
    }
    const s = summaryOf(c);
    return reply(route, 200, { child: { id: s.id, name: s.name, sets: s.sets }, records: s.records });
  });
  const syncs = () => requests.filter((r) => r.path === "/sync");
  const openFamilySettings = () => page.evaluate(() => { document.getElementById("familySettings").open = true; });
  const statusHas = (id, text) => page.evaluate(([i, t]) => document.getElementById(i).textContent.includes(t), [id, text]);
  const url = process.env.APP_URL || "http://127.0.0.1:8000/daily-vocab/";
  await page.goto(url);
  await page.evaluate((cfg) => localStorage.setItem("daily_vocab_ai_v2", JSON.stringify(cfg)), { server: SERVER, passcode: FAMILY_CODE });
  await page.reload();

  // 아이 기기: 보호자 코드가 없으면 ‘아이들’ 탭이 없다. 이름 없이 켜면 거절한다.
  assert(await page.isHidden("#tabFamily"), "no family tab without a parent code");
  await page.click("#tabSettings");
  await openFamilySettings();
  assert((await page.textContent("#familyState")).includes("꺼짐"), "sending off by default");
  await page.check("#familySend");
  await page.click("#saveFamily");
  assert((await page.textContent("#familyStatus")).includes("아이 이름"), "name required");
  assert(syncs().length === 0, "nothing sent without a name");
  // 이름 + 스위치 → 저장: 기록이 없어도 아이 등록 요청 1번(기록 0개, 세트 목록 포함)
  await page.fill("#childName", " 하늘 ");
  await page.click("#saveFamily");
  await waitFor(() => statusHas("familyStatus", "마지막 전송"), "first sync status");
  assert(syncs().length === 1, "one registration sync: " + syncs().length);
  const first = syncs()[0];
  assert(first.passcode === FAMILY_CODE, "family code used for /sync");
  assert(first.body.child.name === "하늘" && /^[0-9a-f-]{36}$/.test(first.body.child.id), "child name trimmed, uuid id: " + JSON.stringify(first.body.child));
  assert(first.body.records.length === 0 && first.body.sets.length === 1 && first.body.sets[0].count === 40, "registration carries sets, no records");
  assert((await page.textContent("#familyState")).includes("켜짐"), "state pill on");
  assert((await page.inputValue("#childName")) === "하늘", "name field shows the saved name");
  const childId = first.body.child.id;

  // 시험 완료 → 압축 기록 전송(점수·틀린 단어만, 단어별 전체 결과 없음)
  await page.click("#tabHome");
  await page.click('[data-mode="en_ko"]');
  await page.selectOption("#range", "0");
  await page.uncheck("#shuffle");
  await page.click("#start");
  for (let i = 0; i < 10; i++) {
    await page.click("#unknown");
    await page.click("#next");
  }
  assert(await page.isVisible("#finish"), "finished");
  await waitFor(() => syncs().length === 2, "sync after finishing");
  const sent = syncs()[1].body;
  assert(sent.child.id === childId && sent.records.length === 1, "one record sent");
  const rec = sent.records[0];
  assert(rec.total === 10 && rec.correct === 0 && rec.mode === "en_ko" && rec.partial === false && rec.range.startsWith("121~130번"), "record summary: " + JSON.stringify(rec));
  assert(rec.missed.length === 10 && rec.missed[0].en === "authority" && rec.missed[0].ko.includes("권위") && rec.missed[0].unknown === true, "missed words with meanings");
  assert(Number.isInteger(rec.activeMs) && rec.activeMs >= 0 && Number.isFinite(Date.parse(rec.completedAt)) && typeof rec.id === "string", "activeMs/completedAt/id");
  assert(!JSON.stringify(sent).includes('"results"') && !JSON.stringify(sent).includes('"aliases"'), "full per-word results are not sent");
  await waitFor(() => page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_family_v1")).pending.length === 0), "pending cleared after the response");
  const local = await page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_family_v1")));
  assert(local.sendEnabled === true && local.childName === "하늘" && !local.parentCode, "family settings stored, no parent code");
  assert((await page.evaluate(() => historyRecords[0].activeMs)) >= 0, "record stores activeMs locally");

  // 연결 실패 → 대기 목록에 남김 → 새로고침 후 재전송
  mode = "abort";
  await page.click("#newTest");
  await page.click("#start");
  await page.click("#unknown");
  await page.click("#next");
  page.once("dialog", (d) => d.accept());
  await page.click("#backSettings");
  assert(await page.isVisible("#finish"), "partial result");
  await waitFor(() => syncs().length === 3, "attempted sync while offline");
  await page.click("#tabSettings");
  await waitFor(() => statusHas("familyStatus", "못 보낸 기록 1개"), "pending status shown");
  assert((await page.textContent("#familyState")).includes("보낼 기록 1개"), "pill shows pending count");
  mode = "ok";
  await page.reload();
  await waitFor(() => syncs().length === 4, "retry on next launch");
  const retried = syncs()[3].body.records;
  assert(retried.length === 1 && retried[0].partial === true && retried[0].total === 1, "partial record resent: " + JSON.stringify(retried));
  await waitFor(() => page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_family_v1")).pending.length === 0), "pending cleared after retry");

  // 끄기 → 시험을 봐도 보내지 않는다
  await page.click("#tabSettings");
  await openFamilySettings();
  assert(await page.isChecked("#familySend"), "switch restored after reload");
  await page.uncheck("#familySend");
  await page.click("#saveFamily");
  assert((await page.textContent("#familyState")).includes("꺼짐"), "state off");
  await page.click("#tabHome");
  await page.click("#start");
  await page.click("#unknown");
  await page.click("#next");
  page.once("dialog", (d) => d.accept());
  await page.click("#backSettings");
  await new Promise((r) => setTimeout(r, 700));
  assert(syncs().length === 4, "no sync while off");
  assert(await page.isHidden("#tabFamily"), "still no family tab");

  // 보호자 폰: 코드 길이·코드 오류·옛 Worker 안내
  await page.click("#tabSettings");
  await openFamilySettings();
  await page.fill("#parentCode", "bad");
  await page.click("#saveParent");
  assert((await page.textContent("#parentStatus")).includes("4자"), "parent code length check");
  assert(await page.isHidden("#tabFamily"), "no tab for a rejected code");
  await page.fill("#parentCode", "wrong-code");
  await page.click("#saveParent");
  await waitFor(() => statusHas("parentStatus", "보호자 코드가 맞지 않아요"), "wrong parent code message");
  mode = "notfound";
  await page.fill("#parentCode", PARENT_CODE);
  await page.click("#saveParent");
  await waitFor(() => statusHas("parentStatus", "다시 배포"), "old worker message");
  mode = "ok";
  await page.fill("#parentCode", PARENT_CODE);
  await page.click("#saveParent");
  await waitFor(() => statusHas("parentStatus", "연결 성공"), "parent connected");
  assert((await page.textContent("#parentStatus")).includes("1명"), "one child reported");
  assert(await page.isVisible("#tabFamily"), "family tab appears");
  assert((await page.inputValue("#parentCode")) === "", "code field cleared after save");
  assert((await page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_family_v1")).parentCode)) === PARENT_CODE, "parent code stored locally");

  // 아이들 화면: 카드(오늘 2회 = 완료 1 + 중단 1), 최근 7일 칸, 상세·틀린 단어
  await page.click("#tabFamily");
  assert(await page.isVisible("#family") && (await page.isHidden("#settings")), "family view");
  await waitFor(() => statusHas("familyLoadStatus", "방금 확인했어요"), "family loaded");
  const card = await page.textContent("#childrenList");
  assert(card.includes("하늘") && card.includes("오늘 ✅ 2회") && card.includes("최근 7일 2회") && card.includes("마지막 시험"), "child card: " + card);
  assert((await page.$$eval("#childrenList .day", (d) => d.length)) === 7, "seven day cells");
  assert((await page.$$eval("#childrenList .day.done", (d) => d.length)) === 1, "today marked done");
  await page.click("#childrenList button");
  await waitFor(() => requests.some((r) => r.path === "/family/" + childId && r.method === "GET"), "detail requested");
  await waitFor(() => page.evaluate(() => document.querySelectorAll("#childRecords .history-entry").length === 2), "two records in detail");
  const detail = await page.textContent("#childDetail");
  assert(detail.includes("시험 2회") && detail.includes("중단") && detail.includes("0 / 10") && detail.includes("기본 예제 DAY04 40단어"), "detail summary: " + detail);
  await page.click("#childRecords .history-entry:nth-child(2) summary");
  assert((await page.textContent("#childRecords")).includes("authority — 권위"), "missed words shown");

  // 삭제 → 목록이 빈다
  page.once("dialog", (d) => d.accept());
  await page.click("#deleteChild");
  await waitFor(() => requests.some((r) => r.method === "DELETE" && r.path === "/family/" + childId), "delete requested");
  await waitFor(() => statusHas("childrenList", "아직 기록을 보낸 아이가 없어요"), "list empty after delete");
  assert(await page.isHidden("#childDetail"), "detail closed");

  // 보호자 코드 삭제 → 탭 숨김, 캐시 삭제
  await page.click("#tabSettings");
  await page.click("#clearParent");
  assert(await page.isHidden("#tabFamily"), "family tab hidden after clearing the code");
  assert((await page.evaluate(() => localStorage.getItem("daily_vocab_family_cache_v1"))) === null, "cache cleared");
  assert(!(await page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_family_v1")).parentCode)), "parent code removed");

  assert(errors.length === 0, "page errors: " + errors.join(" | "));
  console.log("PASS: family sync (register/finish/offline retry/off) + parent dashboard (codes/cards/detail/missed words/delete)");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
