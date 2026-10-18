// 가족 기록함 + 아이 코드: 아이 기기는 전용 링크(?child=코드)나 아이 코드로 연결해 시험 기록을 가족 서버로 보내고
// (접속 코드가 없으면 대기 → 저장 뒤 자동 연결, 완료 전송, 연결 실패 → 재시작 후 재전송, 끄기, 연결 해제 → 재연결),
// 보호자 폰은 보호자 코드로 ‘아이들’ 탭에서 아이를 만들고(코드·링크·이름·기기 표시) 아이별 기록을 본다(상세·틀린 단어·삭제·코드 삭제).
// Worker는 라우트로 가짜 응답을 준다.
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
  const HANEUL = "11111111-2222-4333-8444-555555555555", HANEUL_CODE = "483921";
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS" };
  const reply = (route, status, body) => route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
  const requests = [];
  const children = new Map(); // 가짜 가족 기록함(Worker의 FamilyStore 역할)
  const codes = new Map(); // 아이 코드 → childId
  let nextCode = 777777;
  const now = () => new Date().toISOString();
  const seedChild = (id, name, code) => {
    children.set(id, { id, name, joinCode: code, devices: {}, sets: [], records: new Map(), lastTestAt: null, createdBy: "parent" });
    codes.set(code, id);
    return children.get(id);
  };
  seedChild(HANEUL, "하늘", HANEUL_CODE); // 보호자가 미리 만들어 둔 아이
  const touchDevice = (c, device) => {
    if (device && device.id) c.devices[device.id] = { label: device.label || "기기", joinedAt: c.devices[device.id]?.joinedAt || now(), lastSeenAt: now() };
  };
  let mode = "ok";
  const summaryOf = (c) => ({
    id: c.id, name: c.name, joinCode: c.joinCode, devices: c.devices, sets: c.sets, anchor: c.anchor, updatedAt: c.updatedAt, lastTestAt: c.lastTestAt,
    plan: { enabled: false, level: "중2 상위권", dailyCount: 10, hour: 16, timeLimitSec: 0 }, today: { date: "", exists: false, count: 0, completed: null },
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
    const familyOk = [FAMILY_CODE, PARENT_CODE].includes(passcode);
    if (url.pathname === "/join" && req.method() === "POST") {
      if (!familyOk) return reply(route, 401, { error: "unauthorized", message: "접속 코드가 맞지 않습니다." });
      const code = String(body.code || "").replace(/\D/g, "");
      const c = children.get(codes.get(code));
      if (!c || c.joinCode !== code) return reply(route, 404, { error: "unknown_code", message: "그 아이 코드를 찾을 수 없어요." });
      touchDevice(c, body.device);
      return reply(route, 200, { ok: true, childId: c.id, name: c.name, timeLimitSec: 0 });
    }
    const sm = /^\/settings\/([A-Za-z0-9-]+)$/.exec(url.pathname);
    if (sm && req.method() === "GET") {
      const c = children.get(sm[1]);
      if (!c) return reply(route, 404, { error: "unknown_child", message: "그 아이의 기록이 없습니다." });
      return reply(route, 200, { childId: c.id, name: c.name, timeLimitSec: 0 });
    }
    if (url.pathname === "/sync" && req.method() === "POST") {
      if (!familyOk) return reply(route, 401, { error: "unauthorized", message: "접속 코드가 맞지 않습니다." });
      const c = children.get(body.child.id) || { id: body.child.id, name: body.child.name, devices: {}, sets: [], records: new Map(), lastTestAt: null };
      if (body.sets) c.sets = body.sets;
      if (body.anchor) c.anchor = body.anchor;
      touchDevice(c, body.device);
      c.updatedAt = now();
      for (const r of body.records) {
        c.records.set(r.id, r);
        if (!c.lastTestAt || r.completedAt > c.lastTestAt) c.lastTestAt = r.completedAt;
      }
      children.set(c.id, c);
      return reply(route, 200, { ok: true, stored: body.records.length, trimmed: 0, syncedAt: c.updatedAt });
    }
    if (url.pathname.startsWith("/daily/")) return reply(route, 409, { error: "plan_disabled", message: "보호자가 아직 오늘의 단어를 켜지 않았어요." });
    const cm = /^\/family\/children$/.test(url.pathname) && req.method() === "POST";
    const am = /^\/family\/([A-Za-z0-9-]+)\/(plan|code|name)$/.exec(url.pathname);
    const m = /^\/family(?:\/([A-Za-z0-9-]+))?$/.exec(url.pathname);
    if (!cm && !am && !m) return reply(route, 404, { error: "not_found", message: "지원하지 않는 요청입니다." });
    if (passcode !== PARENT_CODE) return reply(route, 401, { error: "unauthorized", message: "보호자 코드가 맞지 않습니다." });
    if (cm) {
      const code = String(nextCode++);
      const c = seedChild("child-" + code, String(body.name || "").trim(), code);
      return reply(route, 200, { ok: true, child: { ...summaryOf(c), records: undefined, today: undefined } });
    }
    if (am) {
      const c = children.get(am[1]);
      if (!c) return reply(route, 404, { error: "unknown_child", message: "그 아이의 기록이 없습니다." });
      if (am[2] === "code") {
        codes.delete(c.joinCode);
        c.joinCode = String(nextCode++);
        codes.set(c.joinCode, c.id);
      } else if (am[2] === "name") c.name = String(body.name || "").trim();
      else c.plan = { ...summaryOf(c).plan, ...body };
      return reply(route, 200, { ok: true, child: { ...summaryOf(c), records: undefined, today: undefined } });
    }
    if (!m[1]) return reply(route, 200, { children: [...children.values()].map(summaryOf), serverTime: now() });
    const c = children.get(m[1]);
    if (!c) return reply(route, 404, { error: "unknown_child", message: "그 아이의 기록이 없습니다." });
    if (req.method() === "DELETE") {
      children.delete(m[1]);
      codes.delete(c.joinCode);
      return reply(route, 200, { ok: true, deleted: c.records.size });
    }
    const s = summaryOf(c);
    return reply(route, 200, { child: { ...s, records: undefined, today: undefined }, records: s.records, today: s.today });
  });
  const syncs = () => requests.filter((r) => r.path === "/sync");
  const joins = () => requests.filter((r) => r.path === "/join");
  const openFamilySettings = () => page.evaluate(() => { document.getElementById("familySettings").open = true; });
  const statusHas = (id, text) => page.evaluate(([i, t]) => document.getElementById(i).textContent.includes(t), [id, text]);
  const url = process.env.APP_URL || "http://127.0.0.1:8000/daily-vocab/";

  // 보호자 아이콘으로 설치된 기기(?mode=parent): 코드가 없어도 보호자 모드로 시작해 코드 입력 화면만 보인다
  await page.goto(url + "parent.html");
  assert((await page.title()).includes("보호자") && (await page.$eval('a[href="./?mode=parent"]', (a) => a.textContent)).includes("보호자 화면"), "parent.html install page");
  await page.goto(url + "?mode=parent");
  await waitFor(() => page.evaluate(() => document.body.classList.contains("parent-mode")), "parent mode from the install link");
  assert(!page.url().includes("mode="), "mode removed from the address: " + page.url());
  assert(await page.isVisible("#family") && (await page.isVisible("#parentSetup")) && (await page.isHidden("#familyMain")), "setup card only");
  assert((await page.isHidden("#tabHome")) && (await page.isHidden("#tabHistory")) && (await page.isVisible("#tabFamily")), "parent tabs");
  assert((await page.textContent("#brandTagline")).includes("보호자"), "tagline for the parent mode");
  await page.goto(url + "?mode=child");
  await waitFor(() => page.evaluate(() => !document.body.classList.contains("parent-mode")), "back to the child mode");
  assert(await page.isVisible("#tabHome"), "child tabs restored");

  // 아이 기기: 전용 링크로 열었지만 접속 코드가 아직 없다 → 설정 화면에 코드가 채워지고 안내, 주소에서 코드는 지워진다
  await page.goto(url + "?child=" + HANEUL_CODE);
  await waitFor(() => statusHas("familyStatus", "접속 코드를 저장"), "link code waits for the family passcode");
  assert(await page.isVisible("#settings") && (await page.inputValue("#childCode")) === HANEUL_CODE, "settings opened with the code prefilled");
  assert(!page.url().includes("child="), "code removed from the address: " + page.url());
  assert(await page.isHidden("#tabFamily"), "no family tab without a parent code");
  assert(joins().length === 0, "no join attempt without a passcode");
  // 접속 코드를 저장하면 바로 연결되고, 등록 전송(기록 0개, 세트·앵커·기기)이 나간다
  assert(await page.evaluate(() => document.getElementById("aiSettings").open), "AI settings opened for the passcode");
  await page.fill("#aiServer", SERVER);
  await page.fill("#aiPasscode", FAMILY_CODE);
  await page.click("#saveAi");
  await waitFor(() => statusHas("familyStatus", "마지막 전송"), "auto-joined after saving the passcode and registered");
  assert(joins().length === 1 && joins()[0].body.code === HANEUL_CODE && joins()[0].passcode === FAMILY_CODE, "join sent with the family code");
  const device = joins()[0].body.device;
  assert(/^[0-9a-f-]{36}$/.test(device.id) && typeof device.label === "string" && device.label.length > 0, "device id and label sent: " + JSON.stringify(device));
  assert(await page.isVisible("#linkedBox") && (await page.isHidden("#joinBox")), "linked box shown");
  assert((await page.textContent("#childName")) === "하늘", "child name from the server");
  assert(await page.isChecked("#familySend"), "sending turned on by joining");
  assert((await page.textContent("#familyState")).includes("켜짐"), "state pill on");
  assert(syncs().length === 1, "one registration sync: " + syncs().length);
  const first = syncs()[0];
  assert(first.body.child.id === HANEUL && first.body.child.name === "하늘" && first.body.device.id === device.id, "registration carries the joined child and device");
  assert(first.body.records.length === 0 && first.body.sets.length === 1 && first.body.sets[0].count === 40, "registration carries sets, no records");
  assert(first.body.anchor && first.body.anchor.words.length === 40, "anchor words sent");
  const local = await page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_family_v1")));
  assert(local.childId === HANEUL && local.joinCode === HANEUL_CODE && !local.pendingCode && local.sendEnabled === true && local.deviceId === device.id, "family state stored: " + JSON.stringify(local));

  // 시험 완료 → 압축 기록 전송(점수·틀린 단어만, 단어별 전체 결과 없음)
  await page.click("#tabHome");
  await page.click('[data-mode="en_ko"]');
  await page.selectOption("#range", "0");
  await page.uncheck("#shuffle");
  await page.click("#start");
  // 문제 중 화면 이탈: 1초 넘게 가려지면 1회로 세고, 짧은 깜빡임(권한 창 등)은 세지 않는다
  const setHidden = (hidden) =>
    page.evaluate((h) => {
      Object.defineProperty(document, "hidden", { value: h, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
  });
  assert(!(await page.evaluate(() => question.away)), "a blink is not counted");
  await setHidden(true);
  await new Promise((r) => setTimeout(r, 1200));
  await setHidden(false);
  assert((await page.evaluate(() => question.away)) === 1, "away episode counted on the question");
  for (let i = 0; i < 10; i++) {
    await page.click("#unknown");
    await page.click("#next");
  }
  assert(await page.isVisible("#finish"), "finished");
  assert((await page.evaluate(() => [historyRecords[0].awayCount, historyRecords[0].results[0].away])).join() === "1,1", "away count stored on the record and the question");
  await waitFor(() => syncs().length === 2, "sync after finishing");
  const sent = syncs()[1].body;
  assert(sent.child.id === HANEUL && sent.records.length === 1, "one record sent");
  const rec = sent.records[0];
  assert(rec.total === 10 && rec.correct === 0 && rec.mode === "en_ko" && rec.partial === false && rec.range.startsWith("121~130번"), "record summary: " + JSON.stringify(rec));
  assert(rec.missed.length === 10 && rec.missed[0].en === "authority" && rec.missed[0].ko.includes("권위") && rec.missed[0].unknown === true, "missed words with meanings");
  assert(Number.isInteger(rec.activeMs) && rec.activeMs >= 0 && Number.isFinite(Date.parse(rec.completedAt)) && typeof rec.id === "string", "activeMs/completedAt/id");
  assert(rec.awayCount === 1 && rec.awayMs >= 1000, "away count sent: " + JSON.stringify([rec.awayCount, rec.awayMs]));
  assert(!JSON.stringify(sent).includes('"results"') && !JSON.stringify(sent).includes('"aliases"'), "full per-word results are not sent");
  await waitFor(() => page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_family_v1")).pending.length === 0), "pending cleared after the response");
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
  assert(joins().length === 1, "reload does not join again");

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

  // 연결 해제 → 코드로 다시 연결(모르는 코드는 안내)
  await page.click("#tabSettings");
  await openFamilySettings();
  page.once("dialog", (d) => d.accept());
  await page.click("#unlinkChild");
  assert(await page.isVisible("#joinBox") && (await page.textContent("#familyState")).includes("연결 안 됨"), "unlinked");
  assert(!(await page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_family_v1")).childId)), "child id cleared");
  await page.fill("#childCode", "12");
  await page.click("#joinChild");
  assert((await page.textContent("#familyStatus")).includes("6자리"), "code length check");
  await page.fill("#childCode", "000000");
  await page.click("#joinChild");
  await waitFor(() => statusHas("familyStatus", "찾을 수 없어요"), "unknown code message");
  await page.fill("#childCode", "483 921");
  await page.click("#joinChild");
  await waitFor(() => statusHas("familyStatus", "마지막 전송"), "re-joined and synced");
  assert((await page.textContent("#childName")) === "하늘", "linked again as the same child");
  assert(syncs().slice(4).some((r) => r.body.records.length >= 1), "history resent after re-joining");

  // 아이 기기에는 보호자 코드 칸이 보이지 않는다. 보호자 화면(?mode=parent)으로 열어야 나타난다.
  assert(await page.isHidden("#parentBox"), "no parent-code box on a child device");
  await page.goto(url + "?mode=parent");
  await waitFor(() => page.evaluate(() => document.body.classList.contains("parent-mode")), "parent screen opened");
  assert(await page.isVisible("#parentSetup"), "setup card asks for the code");
  await page.click("#tabSettings");
  await openFamilySettings();
  assert(await page.isVisible("#parentBox"), "parent-code box visible on the parent screen");
  // 보호자 폰: 코드 길이·코드 오류·옛 Worker 안내
  await page.fill("#parentCode", "bad");
  await page.click("#saveParent");
  assert((await page.textContent("#parentStatus")).includes("4자"), "parent code length check");
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
  // 보호자 코드를 저장하면 보호자 모드로 자동 전환: 아이들 화면으로 이동, 홈·기록 탭과 아이용 설정은 숨김
  await waitFor(() => page.isVisible("#family"), "switched to the family view");
  assert(await page.evaluate(() => document.body.classList.contains("parent-mode")), "parent mode on");
  assert((await page.isHidden("#tabHome")) && (await page.isHidden("#tabHistory")), "child tabs hidden");
  assert(await page.isVisible("#familyMain") && (await page.isHidden("#parentSetup")), "overview shown once the code exists");

  // 아이들 화면: 카드(오늘 3회 = 완료 1 + 중단 2, 재연결 때 보내기가 꺼져 있던 기록도 올라감; 연결 기기), 상세(코드·링크·기기·기록·틀린 단어)
  await page.click("#tabFamily");
  assert(await page.isVisible("#family") && (await page.isHidden("#settings")), "family view");
  await waitFor(() => statusHas("familyLoadStatus", "방금 확인했어요"), "family loaded");
  const overview = await page.textContent("#familyOverview");
  assert(overview.includes("🧒 하늘") && overview.includes("오늘 시험 ✅ 3회") && overview.includes("이번 주 3회") && overview.includes("⚠️ 화면 이탈 1회"), "overview row: " + overview);
  const card = await page.textContent("#childrenList");
  assert(card.includes("하늘") && card.includes("오늘 ✅ 3회") && card.includes("최근 7일 3회") && card.includes("마지막 시험") && /연결 기기: .+ 1/.test(card), "child card: " + card);
  assert(card.includes("⚠️ 오늘 화면 이탈 1회"), "card warns about today's away episodes");
  assert((await page.$$eval("#childrenList .day", (d) => d.length)) === 7, "seven day cells");
  assert((await page.$$eval("#childrenList .day.done", (d) => d.length)) === 1, "today marked done");
  await page.click("#childrenList button");
  await waitFor(() => requests.some((r) => r.path === "/family/" + HANEUL && r.method === "GET"), "detail requested");
  await waitFor(() => page.evaluate(() => document.querySelectorAll("#childRecords .history-entry").length === 3), "three records in detail");
  assert((await page.textContent("#childCodeText")) === "483 921", "code shown in the detail");
  assert((await page.textContent("#childLinkText")) === url + "?child=" + HANEUL_CODE, "child link shown: " + (await page.textContent("#childLinkText")));
  assert((await page.textContent("#deviceList")).includes("연결된 기기: "), "device list shown");
  const missedTop = await page.textContent("#missedTop");
  assert(missedTop.includes("authority") && missedTop.includes("3회") && missedTop.includes("권위"), "most-missed words: " + missedTop);
  assert((await page.$$eval("#missedTop .chip", (c) => c.length)) === 10, "top ten chips");
  const detail = await page.textContent("#childDetail");
  assert(detail.includes("시험 3회") && detail.includes("중단") && detail.includes("0 / 10") && detail.includes("기본 예제 DAY04 40단어"), "detail summary: " + detail);
  assert(detail.includes("⚠️ 문제 중 화면 이탈 1회"), "record shows the away flag: " + detail.slice(0, 200));
  await page.click("#childRecords .history-entry:nth-child(2) summary");
  assert((await page.textContent("#childRecords")).includes("authority — 권위"), "missed words shown");

  // 아이 추가 → 코드·링크가 생기고 상세가 열린다 → 이름 바꾸기 → 코드 새로 만들기
  await page.click("#addChild");
  assert((await page.textContent("#addChildStatus")).includes("이름"), "name required to add a child");
  await page.fill("#newChildName", " 둘째 ");
  await page.click("#addChild");
  await waitFor(() => statusHas("addChildStatus", "아이 코드 777 777"), "child created with a code");
  const created = requests.find((r) => r.path === "/family/children" && r.method === "POST");
  assert(created && created.passcode === PARENT_CODE && created.body.name === "둘째", "create request: " + JSON.stringify(created && created.body));
  await waitFor(() => page.evaluate(() => document.getElementById("childDetailTitle").textContent.includes("둘째")), "new child's detail opened");
  assert((await page.textContent("#childCodeText")) === "777 777" && (await page.textContent("#childLinkText")).endsWith("?child=777777"), "new child's code and link");
  assert((await page.textContent("#deviceList")).includes("아직 연결된 기기가 없어요"), "no devices yet");
  assert((await page.textContent("#childrenList")).includes("아이 코드 777 777"), "card shows the code until a device joins");
  await page.fill("#renameChild", "둘째야");
  await page.click("#saveChildName");
  await waitFor(() => page.evaluate(() => document.getElementById("childDetailTitle").textContent.includes("둘째야")), "renamed");
  const renamed = requests.find((r) => r.path === "/family/child-777777/name");
  assert(renamed && renamed.body.name === "둘째야", "rename request body");
  assert((await page.textContent("#childrenList")).includes("둘째야"), "card renamed");
  page.once("dialog", (d) => d.accept());
  await page.click("#regenCode");
  await waitFor(() => page.evaluate(() => document.getElementById("childCodeText").textContent === "777 778"), "new code shown");
  assert(requests.some((r) => r.path === "/family/child-777777/code" && r.passcode === PARENT_CODE), "regenerate request sent");
  assert((await page.textContent("#childLinkText")).endsWith("?child=777778"), "link follows the new code");

  // 한눈에 보기 줄을 누르면 상세가 열린다
  await page.click("#closeChildDetail");
  assert(await page.isHidden("#childDetail"), "detail closed by the back link");
  await page.click("#familyOverview .overview-row");
  await waitFor(() => page.isVisible("#childDetail"), "overview row opens the detail");
  assert((await page.textContent("#childDetailTitle")).includes("하늘"), "first child's detail");
  await page.click("#closeChildDetail");
  await page.click("#childrenList button >> nth=1");
  await waitFor(() => page.evaluate(() => document.getElementById("childDetailTitle").textContent.includes("둘째야")), "second child's detail reopened");

  // 아이 기기처럼 보기: 보호자 모드를 끄면 홈 탭이 돌아오고, 다시 켜면 아이들 화면으로
  await page.click("#tabSettings");
  await openFamilySettings();
  assert(await page.isVisible("#parentModeRow") && (await page.isHidden("#familyChildPart")) && (await page.isHidden("#micPanel")), "parent mode hides child-only settings");
  assert(await page.isVisible("#parentBox"), "parent-code box stays on a parent device");
  await page.check("#parentModeOff");
  await waitFor(() => page.isVisible("#home"), "home shown when parent mode is off");
  assert((await page.isVisible("#tabHome")) && !(await page.evaluate(() => document.body.classList.contains("parent-mode"))), "child UI back");
  await page.click("#tabSettings");
  await openFamilySettings();
  await page.uncheck("#parentModeOff");
  await waitFor(() => page.isVisible("#family"), "parent mode back on");
  await page.click("#childrenList button >> nth=1");
  await waitFor(() => page.evaluate(() => document.getElementById("childDetailTitle").textContent.includes("둘째야")), "detail open again");

  // 삭제 → 목록에서 빠짐, 보호자 코드 삭제 → 탭 숨김·캐시 삭제
  page.once("dialog", (d) => d.accept());
  await page.click("#deleteChild");
  await waitFor(() => requests.some((r) => r.method === "DELETE" && r.path === "/family/child-777777"), "delete requested");
  await waitFor(() => page.evaluate(() => !document.getElementById("childrenList").textContent.includes("둘째야")), "deleted child removed from the list");
  assert(await page.isHidden("#childDetail"), "detail closed");
  await page.click("#tabSettings");
  await page.click("#clearParent");
  assert(await page.isVisible("#tabFamily"), "family tab stays on a parent-installed device (code can be entered again)");
  assert(await page.evaluate(() => document.body.classList.contains("parent-mode")), "parent-installed device stays in parent mode after clearing the code");
  await page.goto(url + "?mode=child");
  await waitFor(() => page.evaluate(() => !document.body.classList.contains("parent-mode")), "child mode after ?mode=child");
  assert((await page.isHidden("#tabFamily")) && (await page.isVisible("#tabHome")), "child tabs after leaving the parent mode");
  assert((await page.evaluate(() => localStorage.getItem("daily_vocab_family_cache_v1"))) === null, "cache cleared");
  assert(!(await page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_family_v1")).parentCode)), "parent code removed");

  assert(errors.length === 0, "page errors: " + errors.join(" | "));
  console.log("PASS: child link/code join (pending passcode, auto-join, unlink/rejoin) + sync (finish/offline retry/off) + parent dashboard (add child, code/link, rename, regen, cards/detail/delete)");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
