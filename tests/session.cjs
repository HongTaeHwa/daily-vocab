// 개편된 UX: 하단 탭 전환, 쉬기 → 새로고침 → 이어서 하기, 그만하기(중단 기록), 세트 이름 바꾸기,
// 단어 표 편집기 ↔ 텍스트 동기화, 마지막 선택(방식·범위·섞기·세트) 기억, 결과 화면 틀린 단어 목록.
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
  const url = process.env.APP_URL || "http://127.0.0.1:8000/daily-vocab/";
  await page.goto(url);

  // 탭 전환
  assert(await page.isVisible("#home"), "home visible first");
  await page.click("#tabHistory");
  assert(await page.isVisible("#history") && (await page.isHidden("#home")), "history tab");
  await page.click("#tabSettings");
  assert(await page.isVisible("#settings"), "settings tab");
  await page.click("#tabHome");
  assert(await page.isVisible("#home"), "home tab");

  // 범위 라벨은 책 번호 기준
  const rangeLabels = await page.$$eval("#range option", (o) => o.map((x) => x.textContent));
  assert(rangeLabels[0].includes("전체 40단어") && rangeLabels[1].startsWith("121~130번"), "range labels: " + rangeLabels.slice(0, 2).join("|"));

  // 시작 → 2문제 → 쉬기 → 새로고침 → 이어서 하기 → 완료
  await page.click('[data-mode="en_ko"]');
  await page.selectOption("#range", "0");
  await page.uncheck("#shuffle");
  await page.click("#start");
  assert(await page.isVisible("#quiz") && (await page.isHidden(".tabbar")), "quiz view hides tabs");
  for (let i = 0; i < 2; i++) {
    await page.click("#unknown");
    await page.click("#next");
  }
  assert((await page.evaluate(() => position)) === 2, "two answered");
  await page.click("#pauseQuiz");
  assert(await page.isVisible("#home"), "pause returns home");
  assert(await page.isVisible("#resumeCard"), "resume card shown");
  assert((await page.textContent("#resumeText")).includes("2/10"), "resume text progress: " + (await page.textContent("#resumeText")));
  await page.reload();
  assert(await page.isVisible("#resumeCard"), "resume card survives reload");
  assert((await page.evaluate(() => localStorage.getItem("daily_vocab_prefs_v1"))).includes('"mode":"en_ko"'), "prefs saved");
  assert((await page.$eval('[data-mode="en_ko"]', (b) => b.classList.contains("active"))), "mode remembered");
  assert((await page.inputValue("#range")) === "0", "range remembered");
  assert(!(await page.isChecked("#shuffle")), "shuffle remembered");
  await page.click("#resumeQuiz");
  assert(await page.isVisible("#quiz"), "resumed quiz view");
  assert((await page.evaluate(() => position)) === 2 && (await page.evaluate(() => queue.length)) === 10, "resumed position/queue");
  assert((await page.textContent("#progressText")).startsWith("3 /"), "progress text after resume");
  for (let i = 2; i < 10; i++) {
    await page.fill("#answerInput", i === 2 ? "권위" : "틀린답");
    await page.click("#check");
    await page.click("#next");
  }
  assert(await page.isVisible("#finish"), "finish view");
  assert((await page.textContent("#finalScore")).trim() === "0 / 10" || (await page.textContent("#finalScore")).trim() === "1 / 10", "score shown: " + (await page.textContent("#finalScore")));
  assert((await page.locator("#missedList li").count()) >= 9, "missed list rendered");
  assert((await page.evaluate(() => localStorage.getItem("daily_vocab_session_v1"))) === null, "session cleared after finish");
  assert((await page.evaluate(() => historyRecords.length)) === 1 && !(await page.evaluate(() => historyRecords[0].partial)), "completed record saved");
  await page.click("#againSame");
  assert(await page.isVisible("#quiz") && (await page.evaluate(() => queue.length)) === 10, "same range again");

  // 그만하기 → 중단 기록
  await page.click("#unknown");
  await page.click("#next");
  page.once("dialog", (d) => d.accept());
  await page.click("#backSettings");
  assert(await page.isVisible("#home"), "stop returns home");
  assert(await page.isHidden("#resumeCard"), "no resume card after stop");
  const partial = await page.evaluate(() => historyRecords[0]);
  assert(partial.partial === true && partial.results.length === 1, "partial record saved");
  assert((await page.textContent("#setSummary")).includes("중단"), "summary marks partial");
  await page.click("#tabHistory");
  assert((await page.textContent("#historyList")).includes("중단"), "history shows partial");
  assert((await page.textContent("#historySummary")).includes("시험 2회"), "history summary");
  await page.click("#tabHome");

  // 그만하기(푼 문제 없음) → 기록 없음
  await page.click("#start");
  page.once("dialog", (d) => d.accept());
  await page.click("#backSettings");
  assert((await page.evaluate(() => historyRecords.length)) === 2, "no record without answers");

  // 세트 이름 바꾸기 → 선택 목록·기록 반영
  await page.click("#renameSet");
  await page.fill("#renameInput", "DAY 04 복습");
  await page.click("#renameSave");
  assert((await page.textContent("#setSelect option:checked")).startsWith("DAY 04 복습"), "select shows new name");
  assert((await page.evaluate(() => historyRecords.every((r) => r.setName === "DAY 04 복습"))), "history records renamed");
  await page.reload();
  assert((await page.textContent("#setSelect option:checked")).startsWith("DAY 04 복습"), "rename persisted");

  // 단어 표 편집기 ↔ 텍스트 동기화
  await page.click("#createSet");
  assert(await page.isVisible("#editor") && (await page.textContent("#editorTitle")).includes("새 세트"), "editor view");
  await page.fill("#setName", "표 편집 테스트");
  await page.click("#addRow");
  await page.fill('#wordTableBody tr:nth-child(1) input[data-key="en"]', "apple");
  await page.fill('#wordTableBody tr:nth-child(1) input[data-key="ko"]', "사과");
  await page.click("#addRow");
  await page.fill('#wordTableBody tr:nth-child(2) input[data-key="en"]', "book");
  await page.fill('#wordTableBody tr:nth-child(2) input[data-key="ko"]', "책");
  await page.fill('#wordTableBody tr:nth-child(2) input[data-key="aliases"]', "책|도서");
  assert((await page.inputValue("#wordDraft")) === "1\tapple\t사과\t\n2\tbook\t책\t책|도서", "table → text: " + JSON.stringify(await page.inputValue("#wordDraft")));
  assert((await page.textContent("#wordCount")).includes("2단어"), "word count");
  await page.click("#toggleDraftText");
  assert(await page.isVisible("#wordDraft"), "text mode visible");
  await page.fill("#wordDraft", "1\tapple\t사과\t\n2\tbook\t책\t책|도서\n3\tcat\t고양이\t고양이|야옹\tkæt");
  await page.click("#toggleDraftText");
  assert((await page.locator("#wordTableBody tr").count()) === 3, "text → table rows");
  assert((await page.inputValue('#wordTableBody tr:nth-child(3) input[data-key="ipa"]')) === "kæt", "ipa cell");
  await page.click('#wordTableBody tr:nth-child(1) .row-delete');
  assert((await page.inputValue("#wordDraft")).startsWith("2\tbook"), "row delete syncs text");
  await page.click("#saveSet");
  assert((await page.textContent("#draftWarnings")).includes("확인란"), "confirm required");
  await page.check("#confirmed");
  await page.click("#saveSet");
  assert(await page.isVisible("#home"), "save returns home");
  assert((await page.evaluate(() => WORDS.length)) === 2 && (await page.evaluate(() => WORDS[1].ipa)) === "kæt", "saved words with ipa");
  assert((await page.textContent("#setStatus")).includes("표 편집 테스트"), "save status");
  await page.reload();
  assert((await page.textContent("#setSelect option:checked")).startsWith("표 편집 테스트"), "last set remembered");

  // 편집 중 설정으로 갔다가 돌아오기
  await page.click("#editSet");
  await page.click("#tabSettings");
  await page.click("#tabHome");
  assert(await page.isVisible("#resumeEditor"), "resume editor button");
  await page.click("#resumeEditor");
  assert(await page.isVisible("#editor") && (await page.inputValue("#setName")) === "표 편집 테스트", "editor state kept");
  await page.click("#closeEditor");
  assert(await page.isVisible("#home") && (await page.isHidden("#resumeEditor")), "close editor");

  if (errors.length) throw Error(errors.join(","));
  console.log("PASS: tabs, range labels, pause/resume across reload, finish details, stop with partial record, rename, table editor sync, prefs, editor return");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
