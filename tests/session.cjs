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
  assert((await page.$eval("#promptWord", (el) => getComputedStyle(el).userSelect)) === "none", "quiz word is not selectable (no select → translate)");
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
  page.once("dialog", (d) => d.dismiss());
  await page.click("#start");
  assert(await page.isVisible("#home") && (await page.isVisible("#resumeCard")), "start with a paused quiz asks first; cancel keeps it");
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
  assert(await page.isVisible("#finish") && (await page.textContent("#finishTitle")).includes("여기까지"), "stop shows partial result");
  await page.click("#newTest");
  assert(await page.isVisible("#home"), "home after partial result");
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

  // 세트 이름 바꾸기(편집 화면의 세트 관리) → 선택 목록·기록 반영
  await page.click("#editSet");
  assert(await page.isVisible("#manageBox"), "manage box for existing set");
  await page.click("#renameSet");
  await page.fill("#renameInput", "DAY 04 복습");
  await page.click("#renameSave");
  assert((await page.inputValue("#setName")) === "DAY 04 복습", "editor name updated");
  await page.click("#closeEditor");
  assert((await page.textContent("#setSelect option:checked")).startsWith("DAY 04 복습"), "select shows new name");
  assert((await page.evaluate(() => historyRecords.every((r) => r.setName === "DAY 04 복습"))), "history records renamed");
  await page.reload();
  assert((await page.textContent("#setSelect option:checked")).startsWith("DAY 04 복습"), "rename persisted");

  // 단어 표 편집기 ↔ 텍스트 동기화
  await page.click("#createSet");
  assert(await page.isVisible("#editor") && (await page.textContent("#editorTitle")).includes("새 세트"), "editor view");
  assert(await page.isHidden("#manageBox"), "no manage box for new set");
  await page.fill("#setName", "표 편집 테스트");
  await page.click("#addRow");
  await page.fill('#wordTableBody tr:nth-child(1) [data-key="en"]', "apple");
  await page.fill('#wordTableBody tr:nth-child(1) [data-key="ko"]', "사과");
  await page.click("#addRow");
  await page.fill('#wordTableBody tr:nth-child(2) [data-key="en"]', "book");
  await page.fill('#wordTableBody tr:nth-child(2) [data-key="ko"]', "책");
  await page.fill('#wordTableBody tr:nth-child(2) [data-key="aliases"]', "책|도서");
  assert((await page.inputValue("#wordDraft")) === "1\tapple\t사과\t\n2\tbook\t책\t책|도서", "table → text: " + JSON.stringify(await page.inputValue("#wordDraft")));
  assert((await page.textContent("#wordCount")).includes("2단어"), "word count");
  await page.click("#toggleDraftText");
  assert(await page.isVisible("#wordDraft"), "text mode visible");
  await page.fill("#wordDraft", "1\tapple\t사과\t\n2\tbook\t책\t책|도서\n3\tcat\t고양이\t고양이|야옹\tkæt");
  await page.click("#toggleDraftText");
  assert((await page.locator("#wordTableBody tr").count()) === 3, "text → table rows");
  assert((await page.inputValue('#wordTableBody tr:nth-child(3) [data-key="ipa"]')) === "kæt", "ipa cell");
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

  // 미저장 초안 보호: 단어를 바꾼 뒤 닫기 → 확인창, 취소하면 유지
  await page.click("#editSet");
  await page.click("#addRow");
  await page.fill('#wordTableBody tr:last-child [data-key="en"]', "dog");
  page.once("dialog", (d) => d.dismiss());
  await page.click("#closeEditor");
  assert(await page.isVisible("#editor"), "cancel keeps editor open");
  page.once("dialog", (d) => d.accept());
  await page.click("#closeEditor");
  assert(await page.isVisible("#home"), "accept discards draft");
  assert((await page.evaluate(() => WORDS.length)) === 2, "discarded draft not saved");

  // 종합 시험: 세트 2개를 세트별 골고루 10문제로 → 번갈아 뽑힘 → 완료 → 기록 ‘종합 시험 (세트 2개)’ → 틀린 단어가 원래 세트 오답에 반영 → 같은 범위 다시
  const waitFor = async (fn, m, ms = 5000) => {
    const t0 = Date.now();
    while (!(await fn())) {
      if (Date.now() - t0 > ms) throw Error("timeout: " + m);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  await page.click("#tabHome");
  assert(await page.isVisible("#comboCard"), "combo card shown with two sets");
  await page.evaluate(() => { document.getElementById("comboPanel").open = true; });
  assert((await page.$$eval("#comboSets input", (i) => i.length)) === 2 && (await page.$$eval("#comboSets input:checked", (i) => i.length)) === 2, "all sets checked by default");
  const totalWords = await page.evaluate(() => sets.reduce((n, s) => n + s.words.length, 0));
  // 기본 뽑는 방법은 ‘자주 틀린 단어 먼저’: 요약에 지금까지 틀린 적 있는 단어 수(영어 단어 기준)가 붙는다
  const oftenNow = await page.evaluate(() => {
    const missed = new Set();
    for (const r of historyRecords) for (const x of r.results) if (!x.pass) missed.add(x.word.en.toLowerCase());
    return sets.flatMap((s) => s.words).filter((w) => missed.has(w.en.toLowerCase())).length;
  });
  assert((await page.inputValue("#comboPick")) === "missed" && oftenNow > 0, "missed-first is the default pick");
  assert((await page.textContent("#comboSummary")) === `세트 2개 · ${totalWords}단어 · 자주 틀린 단어 ${oftenNow}개`, "combo summary: " + (await page.textContent("#comboSummary")));
  await page.selectOption("#comboCount", "10");
  await page.selectOption("#comboPick", "even");
  await page.click('[data-mode="en_ko"]');
  await page.click("#comboStart");
  await waitFor(() => page.isVisible("#quiz"), "combo quiz started");
  const comboSets = await page.evaluate(() => queue.map((w) => w._setId));
  assert(comboSets.length === 10 && new Set(comboSets).size === 2 && comboSets[0] !== comboSets[1], "even pick alternates between the two sets: " + JSON.stringify(comboSets));
  assert((await page.textContent("#sessionScope")).includes("종합 시험 (세트 2개)") && (await page.textContent("#sessionScope")).includes("10문제 · 세트별 골고루"), "combo scope label: " + (await page.textContent("#sessionScope")));
  assert(JSON.stringify((await page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_prefs_v1")).combo))) === JSON.stringify({ setIds: null, count: 10, pick: "even" }), "combo prefs remembered (all sets → null)");
  for (let i = 0; i < 10; i++) {
    await page.fill("#answerInput", "틀린답");
    await page.click("#check");
    await page.click("#next");
  }
  await waitFor(() => page.isVisible("#finish"), "combo finished");
  assert((await page.textContent("#finalScore")).trim() === "0 / 10", "combo score: " + (await page.textContent("#finalScore")));
  assert(!(await page.isDisabled("#againSame")), "same combo again is allowed");
  assert(await page.evaluate(() => historyRecords[0].setId === "combo" && historyRecords[0].setName === "종합 시험 (세트 2개)" && historyRecords[0].results.length === 10 && historyRecords[0].combo === undefined), "combo record saved under setId combo");
  const missedOk = await page.evaluate(() => results.every((x) => JSON.parse(localStorage.getItem("daily_vocab_missed_" + x.word._setId) || "[]").includes(x.id)));
  assert(missedOk, "missed words written back to each source set");
  await page.click("#tabHistory");
  await page.selectOption("#historyFilter", "all");
  assert((await page.textContent("#historyList")).includes("종합 시험 (세트 2개)"), "combo record listed under all sets");
  await page.selectOption("#historyFilter", "@combo");
  assert((await page.locator("#historyList .history-entry").count()) === 1 && (await page.textContent("#historyList")).includes("종합 시험 (세트 2개)"), "combo filter lists only the combo record");
  await page.selectOption("#historyFilter", "all");
  await page.click("#tabHome");
  await page.evaluate(() => { document.getElementById("comboPanel").open = true; });
  await page.evaluate(() => { document.querySelector("#comboSets input").checked = false; document.querySelector("#comboSets input").dispatchEvent(new Event("change")); });
  assert((await page.textContent("#comboSummary")).startsWith("세트 1개"), "unchecking a set updates the summary");
  await page.evaluate(() => { document.querySelectorAll("#comboSets input").forEach((i) => { i.checked = false; i.dispatchEvent(new Event("change")); }); });
  assert((await page.isDisabled("#comboStart")) && (await page.textContent("#comboSummary")).includes("골라"), "no set → start disabled");
  // 결과 화면의 ‘같은 범위 다시’는 같은 설정으로 다시 뽑는다 → 그만하기(푼 문제 없음)
  await page.evaluate(() => startCombo({ setIds: null, count: 10, pick: "even" }));
  await waitFor(() => page.isVisible("#quiz"), "combo restarted with the same settings");
  assert((await page.evaluate(() => sessionMeta.combo && sessionMeta.combo.pick)) === "even" && (await page.evaluate(() => queue.length)) === 10, "combo settings kept on restart");
  page.once("dialog", (d) => d.accept());
  await page.click("#backSettings");
  await waitFor(() => page.isVisible("#home"), "stopped the restarted combo");
  // 자주 틀린 단어 먼저: 기록 전체에서 틀린 횟수가 가장 많은 단어(cat, 6번)가 1문제 시험에 나온다. 같은 영어 단어(Cat)가 다른 세트에 있어도 한 번만.
  await page.evaluate(() => {
    const set = sets.find((x) => x.words.some((w) => w.en === "cat"));
    const word = set.words.find((w) => w.en === "cat");
    const seed = (i) => ({ id: "seed-miss-" + i, setId: set.id, setName: set.name, mode: "en_ko", range: "전체", startedAt: new Date().toISOString(), completedAt: new Date(Date.now() - i * 60000).toISOString(), results: [{ id: word.id, word: structuredClone(word), pass: false, unknown: false }] });
    persistHistory([1, 2, 3, 4, 5, 6].map(seed).concat(historyRecords));
    const other = sets.find((x) => x !== set);
    other.words.push({ id: 999, en: "Cat", ko: "고양이", ipa: "", hangul: "", aliases: [] });
  });
  await page.evaluate(() => startCombo({ setIds: null, count: 1, pick: "missed" }));
  await waitFor(() => page.isVisible("#quiz"), "missed-first combo started");
  assert((await page.evaluate(() => queue.map((w) => w.en.toLowerCase()).join(","))) === "cat", "most-missed word first: " + (await page.evaluate(() => queue.map((w) => w.en).join(","))));
  assert((await page.textContent("#sessionScope")).includes("1문제 · 자주 틀린 단어 먼저"), "missed-first scope label: " + (await page.textContent("#sessionScope")));
  page.once("dialog", (d) => d.accept());
  await page.click("#backSettings");
  await waitFor(() => page.isVisible("#home"), "stopped the missed-first combo");
  assert(await page.evaluate(() => buildComboPool(sets.map((x) => x.id), 0, "random").filter((w) => w.en.toLowerCase() === "cat").length === 1), "the same English word is asked once across sets");

  // 세트 삭제는 편집 화면에서만, 확인 후 홈으로
  await page.click("#editSet");
  page.once("dialog", (d) => d.accept());
  await page.click("#deleteSet");
  assert(await page.isVisible("#home") && (await page.evaluate(() => sets.length)) === 1, "delete from editor");

  if (errors.length) throw Error(errors.join(","));
  console.log("PASS: tabs, range labels, pause/resume across reload, finish details, stop with partial record, rename, table editor sync, prefs, editor return, combo test (even pick, record, per-set missed, restart, missed-first default/summary/most-missed word, duplicate words once)");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
