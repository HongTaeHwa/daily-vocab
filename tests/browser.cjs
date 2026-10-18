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
  await page.check("#confirmed");
  await page.click("#saveSet");
  assert((await page.evaluate(() => WORDS.length)) === 2, "save new set");
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
  assert((await page.textContent("#historyList")).includes("9 / 10 · 90점") && (await page.textContent("#historyList")).includes("서버에서 복원"), "restored record rendered from total/correct");
  await page.click("#tabSettings");
  const downloadPromise = page.waitForEvent("download");
  await page.click("#exportSets");
  const download = await downloadPromise;
  const path = await download.path();
  await page.setInputFiles("#importSets", path);
  await page.waitForTimeout(200);
  assert((await page.evaluate(() => sets.length)) === 2, "JSON import");
  assert((await page.evaluate(() => [historyRecords.length, historyRecords.filter((r) => r.restored).length])).join() === "3,1", "import copies normal records and keeps a single copy of the restored record");
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
