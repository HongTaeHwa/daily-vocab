// 보호자 앱(parent.html)의 세트 보내기: 편집기 모듈(editor.js)을 그대로 쓰고 저장은 아이의 세트로 서버에 보낸다.
// 세트 탭 → ‘세트 만들어 보내기’(#/child/<id>/sets/new, 제목 ‘…에게 보내기’, 관리 상자 없음) → 사진 인식은 보호자 코드로 → 텍스트 모드 입력 → 전송 본문·목록 갱신
// → 보호자 기기에는 세트 사본이 없다 → 보기·수정(서버에서 받아 채움, 원래 단어 id·발음 유지) → 저장하지 않은 초안은 뒤로 가기 전에 묻는다 → 삭제.
// → 📝 종합 시험 보내기(세트 고르기·문제 수·뽑는 방법 본문, 보낸 시험·틀린 횟수, 안 푼 시험 바꾸기 확인, 결과, 거두기, 옛 Worker 안내).
// 가족 Worker 는 tests/lib/fake-family-worker.cjs 가 가짜로 응답한다(보호자 앱 기본 서버 주소를 가로챈다).
const { chromium } = require("playwright");
const { createFakeWorker } = require("./lib/fake-family-worker.cjs");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 }, serviceWorkers: "block" });
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
  const url = process.env.APP_URL || "http://127.0.0.1:8000/daily-vocab/";
  const DEFAULT_SERVER = "https://daily-vocab-ai.reonwipe.workers.dev"; // shared.js AI_SERVER_DEFAULT (라우트로 가로챈다)
  const FAMILY_CODE = "family-1234", PARENT_CODE = "parent-9999";
  const HANEUL = "11111111-2222-4333-8444-555555555555";
  const fake = await createFakeWorker(page, { server: DEFAULT_SERVER, familyCode: FAMILY_CODE, parentCode: PARENT_CODE });
  const { requests, children, paths, liveSets } = fake;
  const haneul = fake.seedChild(HANEUL, "하늘", "483921");
  haneul.devices = { "dev-a": { label: "iPhone", joinedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() } };
  haneul.setStore.set("haneul-day04", {
    id: "haneul-day04",
    name: "하늘 DAY04",
    words: [
      { id: 121, en: "authority", ko: "권위", aliases: ["권한"], ipa: "əˈθɔːrəti", hangul: "어쏘러티" },
      { id: 122, en: "devote", ko: "바치다", aliases: [], ipa: "dɪˈvoʊt", hangul: "" },
    ],
    updatedAt: "2026-10-01T00:00:00.000Z",
  });
  const textHas = (sel, t) => page.evaluate(([s, x]) => (document.querySelector(s)?.textContent || "").includes(x), [sel, t]);
  const hash = () => page.evaluate(() => location.hash);
  const sentSets = () => paths("/family/" + HANEUL + "/sets", "POST");

  // 코드 입력 → 오늘 → 아이 카드 → 세트 탭
  await page.goto(url + "parent.html");
  await page.fill("#parentCodeStart", PARENT_CODE);
  await page.click("#saveParentStart");
  await waitFor(() => page.isVisible("#today"), "today screen");
  await page.click("#familyOverview .child-card");
  await waitFor(() => page.isVisible("#child"), "child screen");
  await page.click("#subSets");
  await waitFor(() => textHas("#childSets", "하늘 DAY04 · 2단어"), "child sets listed");

  // ---- 새 세트 만들어 보내기 ----
  await page.click("#sendNewSet");
  await waitFor(() => page.isVisible("#editor"), "editor opens for a new set");
  assert((await hash()) === "#/child/" + HANEUL + "/sets/new", "editor route: " + (await hash()));
  assert((await page.textContent("#editorTitle")).includes("새 세트 만들기 → 🧒 하늘에게 보내기") && (await page.isHidden("#manageBox")), "editor titled for the child without the manage box: " + (await page.textContent("#editorTitle")));
  assert(await page.evaluate(() => document.getElementById("editor").classList.contains("active")), "editor view active");
  // 사진 인식은 보호자 코드로 부른다
  await page.setInputFiles("#photos", { name: "page.png", mimeType: "image/png", buffer: await page.screenshot() });
  assert(await textHas("#extractStatus", "사진을 선택했습니다"), "photo picked");
  await page.click("#extractWords");
  await waitFor(() => textHas("#extractStatus", "1/1장 완료"), "recognized with the parent code");
  const recognize = paths("/recognize", "POST");
  assert(recognize.length === 1 && recognize[0].passcode === PARENT_CODE && typeof recognize[0].body.image === "string" && recognize[0].body.mediaType === "image/jpeg", "recognize request with the parent code");
  await page.fill("#setName", "보호자 세트");
  await page.click("#toggleDraftText");
  await page.fill("#wordDraft", "1\tapple\t사과\t사과\n2\tbanana\t바나나\t바나나");
  await page.check("#confirmed");
  await page.click("#saveSet");
  await waitFor(() => textHas("#setsStatus", "보냈어요"), "set sent");
  assert(await page.isVisible("#panelSets") && (await hash()) === "#/child/" + HANEUL + "/sets", "back on the sets tab after sending: " + (await hash()));
  const sent = sentSets()[0];
  assert(sent && sent.passcode === PARENT_CODE && sent.body.set.name === "보호자 세트" && sent.body.set.words.length === 2 && sent.body.set.words[1].en === "banana", "set upload body: " + JSON.stringify(sent && sent.body).slice(0, 160));
  assert(/^[0-9a-f-]{36}$/.test(sent.body.set.id), "the editor's set id (UUID) is sent: " + sent.body.set.id);
  const newSetId = sent.body.set.id;
  await waitFor(() => textHas("#childSets", "보호자 세트 · 2단어"), "new set listed");
  assert((await page.textContent("#toast")).includes("하늘에게 보냈어요"), "toast confirms");
  const local = await page.evaluate(() => ({ sets: localStorage.getItem("daily_vocab_sets_v2"), parent: localStorage.getItem("daily_vocab_parent_v1") }));
  assert(local.sets === null && !local.parent.includes("banana"), "parent device keeps no copy of the child's set");
  // 보낸 뒤 뒤로 가기는 편집기가 아니라 세트 탭을 연 곳(오늘)으로 간다
  await page.goBack();
  await waitFor(() => page.isVisible("#today"), "back skips the closed editor");
  await page.goForward();
  await waitFor(() => page.isVisible("#panelSets"), "forward to the sets tab");

  // ---- 보기·수정: 서버에서 받아 채우고, 원래 단어 id(숫자)·발음을 이어받아 보낸다 ----
  await page.click('#childSets .set-row[data-set="haneul-day04"] button:has-text("보기·수정")');
  await waitFor(() => page.isVisible("#editor"), "editor opens the server set");
  assert(paths("/family/" + HANEUL + "/sets/haneul-day04", "GET").length === 1 && paths("/family/" + HANEUL + "/sets/haneul-day04", "GET")[0].passcode === PARENT_CODE, "set fetched with the parent code");
  assert((await page.inputValue("#setName")) === "하늘 DAY04" && (await page.textContent("#editorTitle")).includes("세트 수정 → 🧒 하늘에게 보내기"), "editor filled from the server set");
  assert((await page.$$eval("#wordTableBody tr", (r) => r.length)) === 2, "two rows");
  await page.click("#toggleDraftText");
  await page.fill("#wordDraft", (await page.inputValue("#wordDraft")) + "\n123\tindicate\t나타내다\t나타내다");
  await page.check("#confirmed");
  await page.click("#saveSet");
  await waitFor(() => sentSets().length === 2, "edited set sent");
  const edited = sentSets()[1].body.set;
  assert(edited.id === "haneul-day04" && edited.words.length === 3 && edited.words[0].id === 121 && edited.words[0].ipa === "əˈθɔːrəti" && edited.words[0].hangul === "어쏘러티" && edited.words[2].id === "123", "edited words keep their ids and details: " + JSON.stringify(edited.words.map((w) => [w.id, w.ipa])));
  await waitFor(() => textHas("#childSets", "하늘 DAY04 · 3단어"), "list shows the new count");

  // ---- 저장하지 않은 초안: 뒤로 가기 전에 묻고, 취소하면 편집기에 남는다 → 닫기(확인) → 세트 탭 ----
  await page.click('#childSets .set-row[data-set="' + newSetId + '"] button:has-text("보기·수정")');
  await waitFor(() => page.evaluate(() => document.getElementById("editor").classList.contains("active") && document.getElementById("setName").value === "보호자 세트"), "parent set opened");
  await page.click("#toggleDraftText");
  await page.fill("#wordDraft", "1\tapple\t사과\t사과");
  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    d.dismiss();
  });
  await page.goBack();
  await waitFor(() => asked.includes("저장하지 않은"), "discard question on back");
  await new Promise((r) => setTimeout(r, 300));
  assert((await page.evaluate(() => document.getElementById("editor").classList.contains("active"))) && (await hash()) === "#/child/" + HANEUL + "/sets/" + newSetId, "cancel keeps the editor: " + (await hash()));
  assert((await page.inputValue("#wordDraft")) === "1\tapple\t사과\t사과", "draft kept");
  page.once("dialog", (d) => d.accept());
  await page.click("#closeEditor");
  await waitFor(() => page.isVisible("#panelSets"), "closed back to the sets tab");
  assert(sentSets().length === 2, "nothing sent when closing");

  // ---- 삭제 ----
  page.once("dialog", (d) => d.accept());
  await page.click('#childSets .set-row[data-set="' + newSetId + '"] button:has-text("삭제")');
  await waitFor(() => textHas("#setsStatus", "지웠어요"), "set deleted");
  assert(paths("/family/" + HANEUL + "/sets/" + newSetId, "DELETE").length === 1 && liveSets(children.get(HANEUL)).length === 1, "delete request and server state");
  assert(!(await textHas("#childSets", "보호자 세트")), "deleted set removed from the list");
  // 편집기 주소로 바로 열어도(새로고침) 서버에서 받아 연다
  await page.goto(url + "parent.html#/child/" + HANEUL + "/sets/haneul-day04");
  await page.reload();
  await waitFor(() => page.evaluate(() => document.getElementById("editor").classList.contains("active") && document.getElementById("setName").value === "하늘 DAY04"), "deep link opens the editor");
  await page.click("#closeEditor");
  await waitFor(() => page.isVisible("#panelSets"), "closing a deep-linked editor stays in the app");
  assert((await hash()) === "#/child/" + HANEUL + "/sets", "fallback route: " + (await hash()));
  assert(requests.every((r) => r.passcode === PARENT_CODE), "every request uses the parent code");

  // ---- 📝 종합 시험 보내기: 세트 고르기(기본 전부)·문제 수·뽑는 방법 → POST /family/<id>/exam → 보낸 시험·결과 → 바꾸기 확인 → 거두기 ----
  const examPath = "/family/" + HANEUL + "/exam";
  const ago = (hours) => new Date(Date.now() - hours * 3600000).toISOString();
  haneul.setStore.set("haneul-fruit", { id: "haneul-fruit", name: "과일", words: [{ id: 1, en: "apple", ko: "사과", aliases: [], ipa: "", hangul: "" }, { id: 2, en: "grape", ko: "포도", aliases: [], ipa: "", hangul: "" }], updatedAt: ago(1) });
  const examRecord = (id, hours, missed) => ({ id, setName: "하늘 DAY04", mode: "en_ko", range: "전체", startedAt: ago(hours), completedAt: ago(hours), total: 3, correct: 3 - missed.length, partial: false, missed: missed.map((en) => ({ en, ko: en + " 뜻" })) });
  haneul.records.set("x1", examRecord("x1", 5, ["devote", "indicate"]));
  haneul.records.set("x2", examRecord("x2", 3, ["devote"]));
  await page.click("#refreshFamily");
  await waitFor(() => textHas("#examSets", "과일"), "exam box lists the child's sets");
  assert((await page.isVisible("#examBox")) && (await page.$$eval("#examSets input:checked", (i) => i.length)) === 2 && (await page.isHidden("#examCurrent")), "every set checked by default, nothing sent yet");
  assert((await page.inputValue("#examPick")) === "missed" && (await page.inputValue("#examCount")) === "20", "defaults: missed first, 20 questions");
  await page.click('#examSets input[value="haneul-fruit"]');
  await page.selectOption("#examCount", "10");
  await page.click("#sendExam");
  await waitFor(() => textHas("#examStatus", "보냈어요"), "exam sent");
  let examReqs = paths(examPath, "POST");
  assert(examReqs.length === 1 && examReqs[0].passcode === PARENT_CODE && JSON.stringify(examReqs[0].body) === JSON.stringify({ setIds: ["haneul-day04"], count: 10, pick: "missed" }), "exam request body: " + JSON.stringify(examReqs[0]?.body));
  const examToast = await page.textContent("#toast");
  assert(/‘종합 시험 \d+\/\d+’ 3문제를 하늘에게 보냈어요\. 자주 틀린 단어 2개가 들어 있어요\./.test(examToast), "toast: " + examToast);
  const current = await page.textContent("#examCurrent");
  assert(current.includes("3문제") && current.includes("자주 틀린 단어 2개 포함") && current.includes("⏳ 아직 풀지 않았어요"), "sent exam shown: " + current);
  assert((await page.textContent("#examCurrent li")) === "devote — 바치다 (틀림 2회)", "most-missed word first in the list: " + (await page.textContent("#examCurrent li")));
  // 아직 안 푼 시험이 있으면 바꾸기 전에 묻는다(취소하면 안 보냄) → 모든 세트(setIds null)·세트별 골고루로 다시 보냄
  await page.click('#examSets input[value="haneul-fruit"]');
  await page.selectOption("#examPick", "even");
  let replaceAsked = "";
  page.once("dialog", (d) => {
    replaceAsked = d.message();
    d.dismiss();
  });
  await page.click("#sendExam");
  await waitFor(() => replaceAsked.includes("아직 풀지 않은"), "asked before replacing an unsolved exam");
  await new Promise((r) => setTimeout(r, 200));
  assert(paths(examPath, "POST").length === 1, "cancel keeps the unsolved exam");
  page.once("dialog", (d) => d.accept());
  await page.click("#sendExam");
  await waitFor(() => paths(examPath, "POST").length === 2 && textHas("#examCurrent", "5문제"), "replaced with an all-sets exam");
  examReqs = paths(examPath, "POST");
  assert(JSON.stringify(examReqs[1].body) === JSON.stringify({ setIds: null, count: 10, pick: "even" }), "all sets → setIds null: " + JSON.stringify(examReqs[1].body));
  // 아이가 풀면(서버의 completed) 새로고침 때 결과가 보인다
  haneul.exam.completed = { recordId: "r-exam", correct: 4, total: 5, completedAt: new Date().toISOString() };
  await page.click("#refreshFamily");
  await waitFor(() => textHas("#examCurrent", "✅ 4 / 5 맞았어요 (80점)"), "exam result shown");
  // 거두기(확인) → 서버에서 지워지고 칸이 사라진다
  page.once("dialog", (d) => d.accept());
  await page.click("#deleteExam");
  await waitFor(() => textHas("#examStatus", "거뒀어요"), "exam withdrawn");
  assert(paths(examPath, "DELETE").length === 1 && !haneul.exam && (await page.isHidden("#examCurrent")), "withdraw request and state");
  // 옛 Worker(경로 없음) → ‘다시 배포’ 안내
  fake.setMode("notfound");
  await page.click("#sendExam");
  await waitFor(() => textHas("#examStatus", "다시 배포"), "old Worker asks to redeploy");
  fake.setMode("ok");
  assert(requests.every((r) => r.passcode === PARENT_CODE), "exam requests use the parent code");

  assert(errors.length === 0, "page errors: " + errors.join(" | "));
  console.log("PASS: parent set editor — new set (title, photo recognition with the parent code, text mode, upload body, list, no local copy, back skips the editor), edit (server set, ids/details kept), unsaved draft guard on back, delete, deep link, exam (sets/count/pick body, sent exam and missed counts, replace confirm, result, withdraw, old Worker)");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
