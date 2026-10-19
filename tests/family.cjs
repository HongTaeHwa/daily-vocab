// 가족 기록함 + 아이 코드(아이 기기): 전용 링크(?child=코드)나 아이 코드로 연결해 시험 기록을 가족 서버로 보낸다
// (접속 코드가 없으면 대기 → 저장 뒤 자동 연결, 완료 전송, 연결 실패 → 재시작 후 재전송, 끄기, 연결 해제 → 재연결). 아이 앱에는 보호자 화면이 없다.
// 보호자 화면(아이 만들기·코드·기록·세트 보내기·계획)은 보호자 앱 tests/parent.cjs · tests/parent-sets.cjs 가 시험한다.
// 세트 동기화: 연결하면 예제 세트 대신 아이의 세트를 받고, 보호자가 보낸 세트(가짜 Worker 에 직접 심음)가 아이 기기에 들어오며, 기기에서 지우면 서버에도 지워진다(마지막 세트 삭제 → 빈 상태).
// 시험 중 AI가 인정한 답을 허용 답안에 학습하면 시험 중에는 /sets 를 보내지 않고 시험이 끝난 직후 한 번 올린다.
// 수준 기준(앵커): 손대지 않은 예제 세트뿐이면 빈 앵커를 보내고, 동기화된 세트가 있으면 그 단어를 앵커로 보낸다.
// 보호자가 서버에서 아이를 지우면(404 unknown_child) 기기는 안내·연결 해제 강조 뒤 요청을 멈추고, 연결 해제 → 새 코드로 다시 연결한다.
// 기록 복원: 연결하면 서버에 있던 이 아이의 기록이 요약 기록으로 기록 탭에 들어오고(다시 보내지 않음, 틀린 단어 다시 풀기), ‘서버 기록 다시 가져오기’는 겹치지 않게 여러 페이지를 받으며, 기록 전체 삭제 뒤에는 자동 복원하지 않는다.
// Worker는 라우트로 가짜 응답을 준다(tests/lib/fake-family-worker.cjs).
const { chromium } = require("playwright");
const { createFakeWorker } = require("./lib/fake-family-worker.cjs");
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
  // 가짜 가족 Worker(tests/lib/fake-family-worker.cjs): /records 는 페이지 넘김을 시험하려고 한 번에 2개만, /daily 는 언제나 꺼짐(409 plan_disabled).
  const { requests, children, codes, gone, seedChild, liveSets, setMode } = await createFakeWorker(page, { server: SERVER, familyCode: FAMILY_CODE, parentCode: PARENT_CODE, recordsPageSize: 2, daily: false });
  seedChild(HANEUL, "하늘", HANEUL_CODE); // 보호자가 미리 만들어 둔 아이
  children.get(HANEUL).questions.push({ id: "q1", kind: "grammar", question: "왜 aids 인가요?", problem: "UNT 02 2) 어법", summary: "주어가 3인칭 단수라 aids 가 맞아요.", askedAt: new Date(Date.now() - 3600000).toISOString() });
  const syncs = () => requests.filter((r) => r.path === "/sync");
  const joins = () => requests.filter((r) => r.path === "/join");
  const openFamilySettings = () => page.evaluate(() => { document.getElementById("familySettings").open = true; });
  const statusHas = (id, text) => page.evaluate(([i, t]) => document.getElementById(i).textContent.includes(t), [id, text]);
  const url = process.env.APP_URL || "http://127.0.0.1:8000/daily-vocab/";

  // 아이용 앱(index.html)에는 보호자 화면이 없다(보호자 앱은 parent.html — tests/parent.cjs)
  await page.goto(url);
  await waitFor(() => page.evaluate(() => typeof defaultWords !== "undefined"), "child app loaded");
  assert((await page.$("#tabFamily")) === null && (await page.$("#family")) === null && (await page.$("#parentBox")) === null && (await page.$("#parentModeOff")) === null, "no parent mode in the child app");
  // 하늘에게는 서버에 세트가 하나 있다(예제와 같은 단어, 이름만 다름). 연결하면 예제 대신 이 세트를 받는다.
  const exampleWords = await page.evaluate(() => defaultWords);
  children.get(HANEUL).setStore.set("haneul-day04", { id: "haneul-day04", name: "하늘 DAY04", words: exampleWords, updatedAt: "2026-10-01T00:00:00.000Z" });
  // 하늘의 다른 기기(또는 다시 설치하기 전 기기)가 보낸 기록 두 개가 서버에 있다(2주 넘게 전이라 보호자 화면의 오늘·7일·자주 틀린 단어에는 들어가지 않음). 연결하면 기록 탭에 요약 기록으로 들어온다.
  const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
  const serverRecord = (id, completedAt, extra = {}) => ({
    id, setName: "하늘 DAY04", mode: "en_ko", range: "121~130번", startedAt: completedAt, completedAt, total: 10, correct: 7, partial: false, activeMs: 65000, receivedAt: completedAt,
    missed: [{ en: "authority", ko: "권위 · 권한 · 당국", unknown: true }, { en: "devote", ko: "바치다" }, { en: "indicate", ko: "나타내다" }],
    ...extra,
  });
  const srvA = serverRecord("srv-a", daysAgo(20));
  children.get(HANEUL).records.set("srv-a", srvA);
  children.get(HANEUL).records.set("srv-b", serverRecord("srv-b", daysAgo(30), { setName: "옛 세트", mode: "read_meaning", range: "전체 5단어", total: 5, correct: 5, missed: [] }));
  assert(!(await page.textContent("#brandTagline")).includes("보호자"), "child tagline");

  // 아이 기기: 전용 링크로 열었지만 접속 코드가 아직 없다 → 설정 화면에 코드가 채워지고 안내, 주소에서 코드는 지워진다
  await page.goto(url + "?child=" + HANEUL_CODE);
  await waitFor(() => statusHas("familyStatus", "접속 코드를 저장"), "link code waits for the family passcode");
  assert(await page.isVisible("#settings") && (await page.inputValue("#childCode")) === HANEUL_CODE, "settings opened with the code prefilled");
  assert(!page.url().includes("child="), "code removed from the address: " + page.url());
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
  assert(first.body.anchor && first.body.anchor.setName === "" && first.body.anchor.words.length === 0, "untouched example set is not sent as the level anchor (empty anchor): " + JSON.stringify(first.body.anchor));
  const local = await page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_family_v1")));
  assert(local.childId === HANEUL && local.joinCode === HANEUL_CODE && !local.pendingCode && local.sendEnabled === true && local.deviceId === device.id, "family state stored: " + JSON.stringify(local));
  // 세트 동기화: 손대지 않은 예제 세트는 올리지도 알리지도 않고, 서버의 세트를 받으면 예제 대신 그 세트만 남는다
  await waitFor(() => page.evaluate(() => sets.length === 1 && sets[0].id === "haneul-day04"), "example set replaced by the child's synced set");
  const setSyncs = requests.filter((r) => r.path === "/sets/" + HANEUL);
  assert(setSyncs.length === 1 && setSyncs[0].passcode === FAMILY_CODE && setSyncs[0].body.device.id === device.id, "one set sync with the family code: " + setSyncs.length);
  assert(setSyncs[0].body.known.length === 0 && setSyncs[0].body.sets.length === 0 && setSyncs[0].body.deleted.length === 0, "untouched example neither listed nor uploaded: " + JSON.stringify(setSyncs[0].body).slice(0, 160));
  assert((await page.textContent("#setsSyncText")).includes("세트 1개"), "sets line in the settings: " + (await page.textContent("#setsSyncText")));
  assert((await page.textContent("#setSelect option:checked")).startsWith("하늘 DAY04"), "home shows the synced set");
  assert(JSON.parse(await page.evaluate(() => localStorage.getItem("daily_vocab_family_v1"))).setsAcked["haneul-day04"] === "2026-10-01T00:00:00.000Z", "server summary remembered as acked");

  // 기록 복원: 연결 직후(기록을 올리고 세트를 받은 뒤) 서버에 있던 이 아이의 기록이 요약 기록(restored)으로 들어온다. 다시 서버로 보내지는 않는다.
  const restoreReqs = () => requests.filter((r) => r.path === "/records/" + HANEUL);
  await waitFor(() => page.evaluate(() => historyRecords.length === 2 && historyRecords.every((r) => r.restored === true)), "two restored records on the device");
  assert(restoreReqs().length === 1 && restoreReqs()[0].method === "GET" && restoreReqs()[0].passcode === FAMILY_CODE && decodeURIComponent(restoreReqs()[0].search) === "?since=1970-01-01T00:00:00.000Z&limit=500", "records fetched once with the family code: " + JSON.stringify(restoreReqs()));
  const restored = await page.evaluate(() => historyRecords.map((r) => ({ id: r.id, setId: r.setId, total: r.total, correct: r.correct, results: r.results.length, wordId: r.results[0]?.word.id, aliases: r.results[0]?.word.aliases.length, unknown: r.results[0]?.unknown, mode: r.mode })));
  assert(restored[0].id === "srv-a" && restored[0].setId === "haneul-day04" && restored[0].total === 10 && restored[0].correct === 7 && restored[0].results === 3 && restored[0].wordId === 121 && restored[0].aliases > 0 && restored[0].unknown === true, "restored record linked to the synced set with enriched words: " + JSON.stringify(restored[0]));
  assert(restored[1].id === "srv-b" && restored[1].setId === "restored:옛 세트" && restored[1].results === 0 && restored[1].correct === 5 && restored[1].mode === "read_meaning", "perfect-score record without missed words: " + JSON.stringify(restored[1]));
  assert(JSON.parse(await page.evaluate(() => localStorage.getItem("daily_vocab_family_v1"))).pending.length === 0 && syncs().length === 1, "restored records are neither queued nor sent back");
  assert((await page.textContent("#restoreText")).includes("기록 2개 복원"), "restore status line: " + (await page.textContent("#restoreText")));
  // 기록 탭: 세트 필터는 이름이 같은 세트에 연결된 기록만, 항목에 점수·‘서버에서 복원’·틀린 단어(세트의 번호·뜻)·다시 풀기
  await page.click("#tabHistory");
  assert((await page.evaluate(() => document.getElementById("historyFilter").value)) === "haneul-day04", "history filter on the synced set");
  let historyText = await page.textContent("#historyList");
  assert((await page.locator("#historyList .history-entry").count()) === 1 && historyText.includes("7 / 10 · 70점") && historyText.includes("서버에서 복원") && historyText.includes("틀린 단어 3개 보기") && historyText.includes("모름 1개 포함"), "restored entry rendered: " + historyText);
  assert((await page.textContent("#historyStatus")).includes("기록 2개를 서버에서 가져왔어요"), "history status explains the restore: " + (await page.textContent("#historyStatus")));
  await page.selectOption("#historyFilter", "all");
  historyText = await page.textContent("#historyList");
  assert((await page.locator("#historyList .history-entry").count()) === 2 && historyText.includes("5 / 5 · 100점") && (await page.textContent("#historySummary")).includes("시험 2회"), "all sets lists both restored records: " + historyText);
  await page.selectOption("#historyFilter", "haneul-day04");
  await page.click("#historyList details summary");
  assert((await page.textContent("#historyList")).includes("121. authority — 권위"), "missed words shown with the set's numbers");
  await page.click("#historyList .history-retry");
  await waitFor(() => page.isVisible("#quiz"), "retry starts a quiz from the restored record");
  assert((await page.evaluate(() => [queue.length, sessionMeta.setId, sessionMeta.range, mode].join("|"))) === "3|haneul-day04|오답 복습|en_ko", "retry queue built from the restored missed words: " + (await page.evaluate(() => [queue.length, sessionMeta.setId, sessionMeta.range, mode].join("|"))));
  page.once("dialog", (d) => d.accept());
  await page.click("#backSettings"); // 아무 문제도 풀지 않았으니 기록 없이 홈으로
  await waitFor(() => page.isVisible("#home"), "back home without a record");
  assert((await page.evaluate(() => historyRecords.length)) === 2, "abandoned retry leaves no record");
  // ‘서버 기록 다시 가져오기’: 그사이 다른 기기가 보낸 기록을 여러 페이지로 받되 겹치지 않게 합친다. 기록 전체 삭제 뒤에는 앱을 다시 열어도 자동으로 되살리지 않고 버튼으로만 가져온다.
  children.get(HANEUL).records.set("srv-c", serverRecord("srv-c", daysAgo(16), { total: 8, correct: 6, missed: [{ en: "function", ko: "기능" }, { en: "strike", ko: "치다" }] }));
  await page.click("#tabSettings");
  await openFamilySettings();
  const fetchedBefore = restoreReqs().length;
  await page.click("#restoreRecords");
  await waitFor(() => page.evaluate(() => historyRecords.length === 3), "manual restore adds the new server record");
  await waitFor(() => statusHas("restoreText", "기록 3개 복원"), "status line counts three restored records");
  assert(restoreReqs().length === fetchedBefore + 2 && decodeURIComponent(restoreReqs()[fetchedBefore + 1].search).startsWith("?since=" + srvA.completedAt), "second page starts at the last completedAt of the first: " + JSON.stringify(restoreReqs().slice(fetchedBefore).map((r) => r.search)));
  assert((await page.evaluate(() => new Set(historyRecords.map((r) => r.id)).size)) === 3 && (await page.evaluate(() => historyRecords[0].id)) === "srv-c", "no duplicates after paging, newest first");
  assert((await page.textContent("#familyStatus")).includes("기록 1개를 가져왔어요"), "manual restore reports how many were new: " + (await page.textContent("#familyStatus")));
  page.once("dialog", (d) => d.accept());
  await page.click("#clearHistory");
  await waitFor(() => page.evaluate(() => historyRecords.length === 0), "history cleared on the device");
  assert(children.get(HANEUL).records.size === 3, "server copies stay after clearing the device");
  await page.reload();
  await waitFor(() => page.evaluate(() => typeof sets !== "undefined" && document.getElementById("appStatus").textContent.includes("준비")), "app ready after the reload");
  await waitFor(() => requests.filter((r) => r.path === "/sets/" + HANEUL).length >= 2, "set sync ran on launch");
  await new Promise((r) => setTimeout(r, 400));
  assert((await page.evaluate(() => historyRecords.length)) === 0 && restoreReqs().length === fetchedBefore + 2, "cleared history is not restored automatically on launch");
  await page.click("#tabSettings");
  await openFamilySettings();
  assert((await page.textContent("#restoreText")).includes("서버 기록 다시 가져오기"), "status line points to the button after clearing: " + (await page.textContent("#restoreText")));
  await page.click("#restoreRecords");
  await waitFor(() => page.evaluate(() => historyRecords.length === 3 && historyRecords.every((r) => r.restored)), "manual restore after clearing brings the records back");
  assert(syncs().length === 1 && JSON.parse(await page.evaluate(() => localStorage.getItem("daily_vocab_family_v1"))).pending.length === 0, "still nothing sent back");

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
  assert(sent.anchor && sent.anchor.setName === "하늘 DAY04" && sent.anchor.words.length === 40 && sent.anchor.words.includes("authority"), "level anchor from the child's synced set: " + JSON.stringify(sent.anchor).slice(0, 80));
  await waitFor(() => page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_family_v1")).pending.length === 0), "pending cleared after the response");
  assert((await page.evaluate(() => historyRecords[0].activeMs)) >= 0, "record stores activeMs locally");

  // 연결 실패 → 대기 목록에 남김 → 새로고침 후 재전송
  setMode("abort");
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
  setMode("ok");
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

  // 시험 중에 AI 2차 채점이 인정한 답을 허용 답안에 학습하면 세트가 바뀌지만, 시험 중에는 /sets 를 보내지 않고 시험이 끝난 직후 한 번 올린다
  await waitFor(() => page.evaluate(() => !setsSyncInFlight && Boolean(JSON.parse(localStorage.getItem("daily_vocab_family_v1")).setsSyncedAt)), "set sync settled after re-joining");
  const setSyncsBefore = requests.filter((r) => r.path === "/sets/" + HANEUL).length;
  await page.click("#tabHome");
  await page.click('[data-mode="en_ko"]');
  await page.selectOption("#range", "0");
  await page.uncheck("#shuffle");
  await page.click("#start");
  const learnedEn = await page.evaluate(() => question.w.en);
  await page.fill("#answerInput", "비슷한뜻");
  await page.click("#check");
  await waitFor(() => page.evaluate(() => question.aiPass === true), "AI accepted the answer");
  assert(await page.evaluate((en) => sets[0].words.find((w) => w.en === en).aliases.includes("비슷한뜻"), learnedEn), "accepted answer learned into the set during the quiz");
  await new Promise((r) => setTimeout(r, 400));
  assert(requests.filter((r) => r.path === "/sets/" + HANEUL).length === setSyncsBefore, "no set sync while the quiz is running");
  await page.click("#next");
  for (let i = 0; i < 9; i++) {
    await page.click("#unknown");
    await page.click("#next");
  }
  assert(await page.isVisible("#finish"), "quiz with the learned alias finished");
  await waitFor(() => requests.filter((r) => r.path === "/sets/" + HANEUL).length === setSyncsBefore + 1, "set sync sent right after the quiz ends");
  const learnedSync = requests.filter((r) => r.path === "/sets/" + HANEUL).slice(-1)[0].body;
  assert(learnedSync.sets.length === 1 && learnedSync.sets[0].id === "haneul-day04" && learnedSync.sets[0].words.find((w) => w.en === learnedEn).aliases.includes("비슷한뜻"), "learned alias uploaded with the set: " + JSON.stringify(learnedSync.sets.map((s) => s.id)));
  await waitFor(() => syncs().some((r) => r.body.records.some((x) => x.aiPass === 1 && x.correct === 1 && x.total === 10)), "record with the AI-accepted answer synced");

  // 보호자가 보호자 앱에서 세트를 만들어 보냈다(가짜 Worker 에 직접 심는다; 보내는 화면은 tests/parent-sets.cjs)
  const parentSetId = "6c1f0e2a-3b4c-4d5e-8f60-718293a4b5c6";
  children.get(HANEUL).setStore.set(parentSetId, {
    id: parentSetId,
    name: "보호자 세트",
    words: [{ id: "1", en: "apple", ko: "사과", aliases: ["사과"], ipa: "", hangul: "" }, { id: "2", en: "banana", ko: "바나나", aliases: ["바나나"], ipa: "", hangul: "" }],
    updatedAt: new Date().toISOString(),
  });
  await page.reload();

  // 아이 기기: 앱을 열면 보호자가 보낸 세트가 들어온다 → 기기에서 지우면 묘비가 올라가 서버에서도 지워진다 → 마지막 세트를 지우면 빈 상태(시작 불가), 새로고침해도 그대로
  await waitFor(() => page.evaluate(() => sets.length === 2 && sets.some((s) => s.name === "보호자 세트")), "child device received the parent's set");
  assert((await page.$$eval("#setSelect option", (o) => o.map((x) => x.textContent))).some((t) => t.startsWith("보호자 세트 · 2단어")), "set select lists the parent's set");
  await page.selectOption("#setSelect", await page.evaluate(() => sets.find((s) => s.name === "보호자 세트").id));
  await page.click("#editSet");
  page.once("dialog", (d) => d.accept());
  await page.click("#deleteSet");
  await waitFor(() => requests.some((r) => r.path === "/sets/" + HANEUL && r.body.deleted.length === 1 && r.body.deleted[0].id === parentSetId), "tombstone sent for the deleted set");
  await waitFor(() => liveSets(children.get(HANEUL)).length === 1, "server removed the set");
  await waitFor(() => page.evaluate(() => sets.length === 1 && JSON.parse(localStorage.getItem("daily_vocab_family_v1")).setsDeleted.length === 0), "tombstone acknowledged");
  await page.click("#editSet");
  page.once("dialog", (d) => d.accept());
  await page.click("#deleteSet");
  await waitFor(() => page.evaluate(() => sets.length === 0), "last set deleted");
  assert((await page.isVisible("#noSets")) && (await page.isHidden("#setPicker")) && (await page.isHidden("#editSet")) && (await page.isDisabled("#start")), "empty state: no picker, start disabled");
  assert((await page.textContent("#setStatus")).includes("모두 지웠어요"), "status explains the empty state");
  await waitFor(() => liveSets(children.get(HANEUL)).length === 0, "server has no sets left");
  await page.reload();
  await waitFor(() => page.evaluate(() => typeof sets !== "undefined" && document.getElementById("appStatus").textContent.includes("준비")), "app ready after reload with no sets");
  assert((await page.evaluate(() => sets.length)) === 0 && (await page.isVisible("#noSets")) && (await page.isDisabled("#start")), "empty state survives a reload");
  await page.click("#tabHistory");
  assert((await page.evaluate(() => document.getElementById("historyFilter").value)) === "all", "history filter falls back to all sets");

  // 보호자가 (다른 폰에서) 서버에서 아이를 지우면: 기기는 404 unknown_child 를 받아 안내하고 연결 해제를 강조하며 같은 요청을 반복하지 않는다 → 연결 해제 → 새 아이 코드로 다시 연결
  children.delete(HANEUL);
  codes.delete(HANEUL_CODE);
  gone.add(HANEUL);
  await page.reload();
  await waitFor(() => page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_family_v1")).childGone === true), "child marked gone after 404 unknown_child");
  await page.click("#tabSettings");
  await openFamilySettings();
  const goneText = await page.textContent("#familyStatus");
  assert(goneText.includes("서버에서 지웠어요") && goneText.includes("새로 만든 아이 코드로 다시 연결"), "gone message: " + goneText);
  assert((await page.textContent("#familyState")).includes("서버에서 지워짐"), "pill shows the gone state");
  assert(await page.$eval("#unlinkChild", (b) => b.classList.contains("attention")), "unlink button highlighted");
  assert(await page.isDisabled("#syncNow"), "send-now disabled while the child is gone");
  assert((await page.textContent("#setsSyncText")).includes("서버에서 지워서"), "sets line explains: " + (await page.textContent("#setsSyncText")));
  const goneCount = requests.length;
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    flushFamilySync({ force: true });
    syncSets({ force: true });
    checkDaily({ force: true });
    fetchSettings({ force: true });
    queueSetsSync();
  });
  await new Promise((r) => setTimeout(r, 600));
  assert(requests.length === goneCount, "no further requests while the child is gone: " + JSON.stringify(requests.slice(goneCount).map((r) => r.method + " " + r.path)));
  page.once("dialog", (d) => d.accept());
  await page.click("#unlinkChild");
  assert((await page.isVisible("#joinBox")) && !(await page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_family_v1")).childGone)), "unlinked and the gone flag cleared");
  assert(!(await page.$eval("#unlinkChild", (b) => b.classList.contains("attention"))), "highlight removed after unlinking");
  const HANEUL2 = "66666666-7777-4888-8999-000000000000";
  seedChild(HANEUL2, "하늘", "222333"); // 보호자가 아이를 새로 만들었다
  await page.fill("#childCode", "222333");
  await page.click("#joinChild");
  await waitFor(() => statusHas("familyStatus", "마지막 전송"), "re-joined with the new code and synced");
  assert((await page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_family_v1")).childId)) === HANEUL2, "linked to the new child");
  assert((await page.textContent("#familyState")).includes("켜짐"), "state pill back on");
  assert(syncs().slice(-1)[0].body.child.id === HANEUL2 && syncs().slice(-1)[0].body.records.length >= 1 || syncs().some((r) => r.body.child.id === HANEUL2 && r.body.records.length >= 1), "history resent to the new child");

  assert(errors.length === 0, "page errors: " + errors.join(" | "));
  console.log("PASS: child app without a parent mode + child link/code join (pending passcode, auto-join, unlink/rejoin) + sync (finish/offline retry/off) + record restore (on join, history tab/retry, manual paging, no auto-restore after clearing) + set sync (pull on join, parent's set received, device delete, empty state) + deferred set sync after a quiz + level anchor (example excluded) + deleted child notice/stop/rejoin");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
