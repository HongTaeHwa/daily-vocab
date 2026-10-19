// 오늘의 단어·제한 시간·세트 잠금 — 아이 기기: 계획이 꺼져 있으면 카드 없음 → 보호자가 켠 뒤 앱을 열면 GET(no_daily) → POST 생성 → 홈 카드 →
// 풀기(기존 시험 엔진) → 기록에 daily 날짜가 붙어 전송 → ✅ 카드 → 새로고침해도 재생성 없음 → 제한 시간 수신·카운트다운·시간 초과 → 세트 잠금 수신·읽기 전용.
// 보호자 쪽(계획 폼·제한 시간·잠금 저장)은 보호자 앱 tests/parent.cjs 가 시험하고, 여기서는 가짜 Worker 의 계획을 직접 바꾼다(tests/lib/fake-family-worker.cjs).
// 수준 기준(앵커): 손대지 않은 예제 세트뿐이면 빈 앵커를 보낸다.
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
  const waitFor = async (fn, m, ms = 6000) => {
    const t0 = Date.now();
    while (!(await fn())) {
      if (Date.now() - t0 > ms) throw Error("timeout: " + m);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const SERVER = "https://ai.test", FAMILY_CODE = "family-1234", PARENT_CODE = "parent-9999";
  const HANEUL = "11111111-2222-4333-8444-555555555555", HANEUL_CODE = "483921"; // 보호자가 미리 만들어 둔 아이
  const localDate = () => {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
  };
  // 가짜 가족 Worker(tests/lib/fake-family-worker.cjs): 옛 Worker처럼 /sets 는 404 not_found(예제 세트 유지), 오늘의 단어는 계획을 켜면 복습 최대 3개 + 새 단어로 만든다.
  const { children, paths, seedChild } = await createFakeWorker(page, { server: SERVER, familyCode: FAMILY_CODE, parentCode: PARENT_CODE, setSync: false });
  seedChild(HANEUL, "하늘", HANEUL_CODE);
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
  assert(anchor && anchor.setName === "" && anchor.words.length === 0, "untouched example set is not a level anchor (empty anchor clears the server's): " + JSON.stringify(anchor));
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

  // 문제당 제한 시간: 아이 기기는 앱을 열 때 설정을 받아 두고, 시간이 지나면 그 문제를 모름 처리한다(앱 밖에 있어도 시간은 흐른다)
  children.get(childId).plan.timeLimitSec = 10; // 보호자가 보호자 앱에서 정했다
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
  // 세트 수정 잠금: 보호자가 잠그면 아이 기기는 앱을 열 때 /settings 로 받아 새 세트·수정·삭제·가져오기를 막고 단어는 보기만 한다
  children.get(childId).plan.setsLocked = true; // 보호자가 보호자 앱 📚 세트 탭에서 잠갔다
  await page.reload();
  await waitFor(() => page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_family_v1")).settings.setsLocked === true), "lock stored on the device");
  await page.click("#tabHome");
  assert((await page.isHidden("#createSet")) && (await page.isVisible("#setsLockNote")) && (await page.textContent("#editSet")).trim() === "📖 단어 보기", "home hides new-set and shows the lock note: " + (await page.textContent("#editSet")));
  await page.click("#editSet");
  await waitFor(() => page.isVisible("#editor"), "view-only editor opens");
  assert((await page.textContent("#editorTitle")).includes("📖 단어 보기") && (await page.textContent("#extractStatus")).includes("잠갔어요"), "editor titled as view-only with the lock notice");
  for (const id of ["photoRow", "fillMeanings", "toggleDraftText", "addRow", "confirmedRow", "saveSet", "manageBox"]) assert(await page.isHidden("#" + id), id + " hidden in the view-only editor");
  assert((await page.$eval("#setName", (i) => i.readOnly)) && (await page.$eval("#wordTableBody .cell.en", (i) => i.readOnly)) && (await page.$$eval("#wordTableBody .row-delete", (b) => b.length)) === 0, "name and cells read-only, no delete buttons");
  assert((await page.$$eval("#wordTableBody tr", (r) => r.length)) === 40, "all words listed for viewing");
  await page.evaluate(() => document.getElementById("saveSet").click());
  assert((await page.textContent("#draftWarnings")).includes("잠갔어요"), "save refused even when triggered");
  await page.click("#closeEditor");
  await waitFor(() => page.isVisible("#home"), "back home without a discard prompt");
  await page.click("#tabSettings");
  assert(await page.isHidden("#importSetsLabel"), "JSON import hidden while locked");
  await openFamilySettings();
  assert((await page.textContent("#setsSyncText")).includes("🔒 보호자가 세트 고치기를 잠갔어요"), "family card mentions the lock: " + (await page.textContent("#setsSyncText")));
  // 보호자가 풀면 다음에 앱을 열 때부터 다시 고칠 수 있다
  children.get(childId).plan.setsLocked = false;
  await page.reload();
  await waitFor(() => page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_family_v1")).settings.setsLocked === false), "lock released on the device");
  await page.click("#tabHome");
  assert((await page.isVisible("#createSet")) && (await page.isHidden("#setsLockNote")) && (await page.textContent("#editSet")).trim() === "📖 단어 보기·수정", "home editing back after unlocking");
  await page.click("#tabSettings");
  assert(await page.isVisible("#importSetsLabel"), "JSON import back");

  assert(errors.length === 0, "page errors: " + errors.join(" | "));
  console.log("PASS: daily words — child card/generation/quiz/record flag/completion, time limit received/countdown/timeout, sets lock received/view-only editor");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
