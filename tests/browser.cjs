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
  page.once("dialog", (d) => d.accept());
  await page.click("#deleteSet");
  assert(
    (await page.locator("#historyList .history-entry").count()) === 4,
    "deleted history visible",
  );
  await page.click("#tabHistory");
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
  await page.click("#tabSettings");
  const downloadPromise = page.waitForEvent("download");
  await page.click("#exportSets");
  const download = await downloadPromise;
  const path = await download.path();
  await page.setInputFiles("#importSets", path);
  await page.waitForTimeout(200);
  assert((await page.evaluate(() => sets.length)) === 2, "JSON import");
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
    "PASS: 3 modes, 40-word default, editing, strict grading, set isolation, deleted history retry, migration backup, JSON round trip, quota failure",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
