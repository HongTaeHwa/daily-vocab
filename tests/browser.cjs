const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 800, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.APP_URL || "http://127.0.0.1:8000/daily-vocab/");
  await page.waitForTimeout(500);
  const assert = (v, m) => {
    if (!v) throw Error(m);
  };
  assert(
    (await page.locator("#setSelect option").count()) === 1,
    "default set",
  );
  assert((await page.evaluate(() => WORDS.length)) === 40, "40 default words");
  // 기록이 하나도 없는 기기: 빈 화면 문구, 연결되지 않은 기기라 서버 가져오기 버튼은 없다
  await page.click("#tabHistory");
  assert((await page.textContent("#historyList")).includes("아직 이 기기에서 본 시험이 없어요") && (await page.locator("#historyRestore").count()) === 0, "empty history without a restore button on an unlinked device");
  await page.click("#tabHome");
  for (const mode of ["read_meaning", "en_ko", "ko_en"]) {
    await page.click(`[data-mode="${mode}"]`);
    await page.click("#start");
    await page.click("#unknown");
    await page.click("#next");
    assert(
      (await page.evaluate(() => position)) === 1,
      "mode progression " + mode,
    );
    page.once("dialog", (d) => d.accept());
    await page.click("#backSettings");
    await page.click("#newTest");
  }
  await page.click("#createSet");
  await page.fill("#setName", "2026-10-11 테스트");
  await page.click("#toggleDraftText");
  await page.fill("#wordDraft", "1\tapple\t사과\t사과 열매\n2\tbook\t책\t도서");
  // 저장하지 않은 초안: 홈에서 ‘새 세트’를 다시 눌러도 묻고, 취소하면 초안이 그대로 남는다(전에는 말없이 지워졌다)
  await page.click("#tabHome");
  let draftPrompt = "";
  page.once("dialog", (d) => { draftPrompt = d.message(); d.dismiss(); });
  await page.click("#createSet");
  assert(draftPrompt.includes("저장하지 않은 단어 2개") && (await page.isVisible("#home")), "reopening a new set asks before dropping the draft: " + draftPrompt);
  await page.click("#resumeEditor");
  assert((await page.inputValue("#wordDraft")).includes("apple") && (await page.inputValue("#setName")) === "2026-10-11 테스트", "cancelled reopen keeps the unsaved draft");
  await page.check("#confirmed");
  await page.click("#saveSet");
  assert((await page.evaluate(() => WORDS.length)) === 2, "save new set");
  // 기록 탭은 처음에 ‘전체 세트’: 새 세트(기록 없음)를 골라 둬도 다른 세트의 기록이 보인다
  await page.click("#tabHistory");
  assert((await page.evaluate(() => document.getElementById("historyFilter").value)) === "all" && (await page.locator("#historyList .history-entry").count()) === 3, "history defaults to all sets even when the selected set has no records");
  await page.selectOption("#historyFilter", await page.evaluate(() => activeSetId));
  const emptyText = await page.textContent("#historyList");
  assert(emptyText.includes("이 세트로 본 시험은 아직 없어요") && emptyText.includes("전체 세트에는 시험 3회"), "empty set filter points to the other records: " + emptyText);
  await page.click("#showAllHistory");
  assert((await page.evaluate(() => document.getElementById("historyFilter").value)) === "all" && (await page.locator("#historyList .history-entry").count()) === 3, "show all sets button");
  await page.click("#tabHome");
  await page.click('[data-mode="en_ko"]');
  await page.uncheck("#shuffle");
  await page.click("#start");
  await page.fill("#answerInput", "사과가 아님");
  await page.click("#check");
  assert(
    (await page.evaluate(() => question.answerPass)) === false,
    "strict meaning",
  );
  // 기기 채점 규칙: 자리표시 조사(…을/…에게)·괄호 설명은 무시, 뜻으로 끝나는 짧은 합성어(몸무게)는 인정, 그 밖에는 여전히 엄격
  assert(
    await page.evaluate(
      () =>
        correctKo("제출하다", { ko: "…을 제출하다", aliases: [] }) &&
        correctKo("주다", { ko: "…에게 …을 주다", aliases: [] }) &&
        correctKo("수정하다", { ko: "(법 등을) 수정하다 · 개정하다", aliases: [] }) &&
        correctKo("몸무게", { ko: "무게", aliases: ["무게"] }) &&
        !correctKo("무", { ko: "무게", aliases: [] }) &&
        !correctKo("가방무게추", { ko: "무게", aliases: [] }) &&
        !correctKo("아주무거운무게", { ko: "무게", aliases: [] }),
    ),
    "particle/compound leniency without losing strictness",
  );
  // 영어 읽기 채점: 구·대문자·하이픈 단어도 인식되면 통과, 구의 일부만 말하면 아님
  assert(
    await page.evaluate(
      () =>
        correctEn("give up", { en: "give up" }) &&
        correctEn("I will give up now", { en: "give up" }) &&
        correctEn("christmas", { en: "Christmas" }) &&
        correctEn("email", { en: "e-mail" }) &&
        correctEn("the word is apple", { en: "apple" }) &&
        !correctEn("give", { en: "give up" }) &&
        !correctEn("apples", { en: "apple" }),
    ),
    "reading check handles phrases, capitals and hyphens",
  );
  await page.click("#next");
  await page.click("#unknown");
  await page.click("#next");
  assert(
    (await page.evaluate(() => historyRecords[0].results[0].word.en)) ===
      "apple",
    "snapshot",
  );
  await page.click("#newTest");
  await page.selectOption("#setSelect", "day04");
  // 홈에서 세트를 바꿔도 기록 탭 필터는 그대로(전체), 홈의 최근 결과는 세트와 상관없이 최근 3개
  assert((await page.evaluate(() => document.getElementById("historyFilter").value)) === "all" && (await page.locator("#historyList .history-entry").count()) === 4, "history filter does not follow the selected set");
  const recentText = await page.textContent("#recentResults");
  assert((await page.locator("#recentResults .recent-row").count()) === 3 && recentText.includes("2026-10-11 테스트") && recentText.includes("기본 예제 DAY04"), "home recent results span every set: " + recentText);
  await page.click("#tabHistory");
  await page.selectOption("#historyFilter", "day04");
  await page.click("#tabHome");
  assert(
    (await page.locator("#historyList .history-entry").count()) === 3,
    "set isolation (only the three partial day04 records)",
  );
  const custom = await page.evaluate(
    () => sets.find((s) => s.id !== "day04").id,
  );
  await page.selectOption("#setSelect", custom);
  await page.click("#editSet");
  page.once("dialog", (d) => d.accept());
  await page.click("#deleteSet");
  assert(
    (await page.locator("#historyList .history-entry").count()) === 3,
    "set filter shows only its own records after delete",
  );
  await page.click("#tabHistory");
  await page.selectOption("#historyFilter", "all");
  assert(
    (await page.locator("#historyList .history-entry").count()) === 4,
    "deleted history visible under all sets",
  );
  await page.click("#historyList details:has(.history-retry) summary");
  await page.click(".history-retry");
  assert(
    (await page.evaluate(() => queue.length)) === 2,
    "deleted snapshot retry",
  );
  page.once("dialog", (d) => d.accept());
  await page.click("#backSettings");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      "day04_wordtest_history_v1",
      JSON.stringify([
        {
          id: "legacy",
          mode: "en_ko",
          range: "121~160",
          completedAt: new Date().toISOString(),
          results: [{ id: 121, pass: false, unknown: true }],
        },
      ]),
    );
    localStorage.setItem("day04_wordtest_missed_v2", "[121]");
  });
  await page.reload();
  assert(
    (await page.evaluate(() => historyRecords[0].results[0].word.en)) ===
      "authority",
    "migration",
  );
  assert(
    await page.evaluate(
      () => !!localStorage.getItem("daily_vocab_legacy_backup_v1"),
    ),
    "migration backup",
  );
  assert((await page.evaluate(() => lastMissed[0])) === 121, "migrate missed");
  // 서버에서 복원한 요약 기록(restored: 점수는 total/correct, results 는 틀린 단어만)도 저장·새로고침·백업 왕복을 지난다(같은 id는 한 번만 가져옴)
  await page.evaluate(() =>
    persistHistory([
      { id: "restored-1", setId: "day04", setName: "기본 예제 DAY04", mode: "en_ko", range: "121~130번", startedAt: "2026-10-01T00:00:00.000Z", completedAt: "2026-10-01T00:05:00.000Z", activeMs: 1000, restored: true, restoredAt: "2026-10-02T00:00:00.000Z", total: 10, correct: 9, results: [{ id: 121, word: { id: 121, en: "authority", ko: "권위", ipa: "", hangul: "", aliases: [] }, pass: false, unknown: true }] },
      ...historyRecords,
    ]),
  );
  await page.reload();
  assert((await page.evaluate(() => [historyRecords.length, historyRecords.filter((r) => r.restored).length, recordScore(historyRecords.find((r) => r.restored)).pct])).join() === "2,1,90", "restored summary record survives a reload with its own score");
  await page.click("#tabHistory");
  assert((await page.textContent("#historyList")).includes("9 / 10 · 90점") && (await page.textContent("#historyList")).includes("☁️ 다른 기기"), "restored record rendered from total/correct");
  // 범위 시험을 끝내면 이번에 푼 단어만 오답이 바뀌고 다른 범위의 틀린 단어(150)는 남는다(전에는 이번 시험의 오답으로 통째로 바뀌었다)
  await page.evaluate(() => { localStorage.setItem("daily_vocab_missed_day04", "[150,125]"); selectSet("day04"); });
  await page.click("#tabHome");
  await page.click('[data-mode="en_ko"]');
  await page.uncheck("#shuffle");
  await page.selectOption("#range", "0");
  await page.click("#start");
  for (let i = 0; i < 10; i++) {
    if ((await page.evaluate(() => question.w.id)) === 125) {
      await page.fill("#answerInput", "방해하다");
      await page.click("#check");
    } else await page.click("#unknown");
    await page.click("#next");
  }
  assert(await page.isVisible("#finish"), "range test finished");
  const missedAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_missed_day04")).sort((a, b) => a - b).join());
  assert(missedAfter === "121,122,123,124,126,127,128,129,130,150", "missed list keeps other ranges: " + missedAfter);
  // Android 뒤로 가기: 끝난 시험 화면(버튼이 동작하지 않고 하단 탭이 없음)으로 돌아가지 않고 홈으로
  await page.goBack();
  assert((await page.isVisible("#home")) && (await page.isHidden("#quiz")) && (await page.isVisible(".tabbar")), "back after finishing lands on home, not the dead quiz screen");
  // 쉬던 시험을 버리고 새로 시작해도 지금 고른 방식(한글 → 영어)으로 시작한다
  await page.click("#start");
  await page.click("#unknown");
  await page.click("#next");
  await page.click("#pauseQuiz");
  await page.click('[data-mode="ko_en"]');
  page.once("dialog", (d) => d.accept());
  await page.click("#start");
  assert((await page.evaluate(() => [mode, sessionMeta.mode, historyRecords[0].mode, historyRecords[0].partial].join())) === "ko_en,ko_en,en_ko,true", "abandoned paused test keeps its own mode and the new test uses the chosen one");
  page.once("dialog", (d) => d.accept());
  await page.click("#backSettings");
  await page.click("#tabHistory");
  await page.click("#tabSettings");
  const downloadPromise = page.waitForEvent("download");
  await page.click("#exportSets");
  const download = await downloadPromise;
  const path = await download.path();
  await page.setInputFiles("#importSets", path);
  await page.waitForTimeout(200);
  assert((await page.evaluate(() => sets.length)) === 2, "JSON import");
  assert((await page.evaluate(() => [historyRecords.length, historyRecords.filter((r) => r.restored).length])).join() === "7,1", "import copies normal records and keeps a single copy of the restored record (4 on the device: restored, legacy, range test, abandoned pause)");
  await page.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw Error("quota");
    };
  });
  await page.click("#tabHome");
  await page.click("#createSet");
  await page.fill("#setName", "저장 실패");
  await page.click("#toggleDraftText");
  await page.fill("#wordDraft", "1\tcat\t고양이");
  await page.check("#confirmed");
  await page.click("#saveSet");
  assert(
    (await page.textContent("#setStatus")).includes("저장 실패"),
    "quota warning",
  );
  assert(errors.length === 0, "browser errors " + errors.join(","));
  console.log(
    "PASS: 3 modes, 40-word default, editing, strict grading, set isolation, deleted history retry, migration backup, restored record format, JSON round trip, quota failure",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
