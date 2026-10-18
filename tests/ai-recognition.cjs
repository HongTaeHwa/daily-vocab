// AI 사진 인식(Cloudflare Worker 프록시) 앱 흐름: 보호자 설정 저장 → 연결 확인 → 사진 2장 인식 → 초안 병합 →
// 저장 → 시험, 그리고 오류 안내·취소·설정 삭제. Worker 주소는 라우트로 가로채 가짜 응답을 준다.
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
    serviceWorkers: "block",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const assert = (v, m) => {
    if (!v) throw Error(m);
  };
  const SERVER = "https://ai.test";
  const PASSCODE = "family-1234";
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "POST, OPTIONS",
  };
  const requests = [];
  let mode = "ok";
  const reply = (route, status, body) =>
    route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
  await page.route(SERVER + "/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const body = JSON.parse(req.postData() || "{}");
    requests.push({ path: url.pathname, headers: req.headers(), body });
    if (mode === "abort") return route.abort("connectionrefused");
    if (mode === "auth") return reply(route, 401, { error: "unauthorized", message: "접속 코드가 맞지 않습니다." });
    if (mode === "busy") return reply(route, 503, { error: "upstream", message: "AI 서버가 혼잡합니다. 잠시 후 다시 시도해 주세요." });
    if (mode === "notfound") return reply(route, 404, { error: "not_found", message: "지원하지 않는 요청입니다." });
    if (mode === "slow") await new Promise((r) => setTimeout(r, 1500));
    if (url.pathname === "/ping") return reply(route, 200, { ok: true, model: "claude-opus-5-5" });
    if (url.pathname === "/tutor") {
      // 문제 물어보기 가짜 응답
      return reply(route, 200, {
        kind: body.kind, problem: "1번 3) 요지 고르기", summary: "아기 마사지가 체중 증가를 돕는다는 글이에요.", translation: body.kind === "translate" ? "첫 줄 해석\n둘째 줄 해석" : "",
        steps: ["질문이 무엇을 묻는지 봐요.", "글 전체의 중심 생각을 찾아요.", "너무 좁거나 넓은 선택지를 지워요."], grammar: ["주어가 3인칭 단수이면 동사에 -s"],
        answer: "③ — 접촉이 아기 성장에 도움이 된다는 글이에요", checked: body.kind === "check" ? "✓한 ①은 지나친 일반화예요. 정답은 ③" : "",
        words: [{ en: "gauge", ko: "측정하다" }, { en: "absorption", ko: "흡수" }], note: "", model: "claude-sonnet-5-5", usage: { input: 1, output: 1 },
      });
    }
    if (url.pathname === "/lookup") {
      // 단어 찾기 가짜 응답: weight 만 안다. recieve 는 철자 제안.
      const w = String(body.word || "").toLowerCase();
      if (w === "weight")
        return reply(route, 200, { found: true, en: "weight", suggestion: "", pos: "명사", ko: "무게 · 체중", ipa: "weɪt", aliases: ["무게", "체중"], examples: [{ en: "What is your weight?", ko: "네 몸무게는 얼마니?" }, { en: "The box has a heavy weight.", ko: "그 상자는 무겁다." }], similar: ["mass"], note: "", model: "claude-sonnet-5-5", usage: { input: 1, output: 1 } });
      return reply(route, 200, { found: false, en: w, suggestion: w === "recieve" ? "receive" : "", pos: "", ko: "", ipa: "", aliases: [], examples: [], similar: [], note: "", model: "claude-sonnet-5-5", usage: {} });
    }
    if (url.pathname === "/grade") {
      // 2차 채점 가짜 응답: ‘비슷한뜻’만 같은 뜻으로 인정한다
      const accept = body.answer === "비슷한뜻";
      return reply(route, 200, { accept, reason: accept ? "같은 뜻으로 인정" : "다른 뜻이에요", model: "claude-haiku-5-5", usage: { input: 1, output: 1 } });
    }
    if (url.pathname === "/define") {
      // AI 사전 가짜 응답: 아는 단어만 돌려주고 모르는 단어(zzz)는 메모로 알린다. 버튼 잠금 확인이 응답보다 먼저 되도록 잠깐 기다린다.
      await new Promise((r) => setTimeout(r, 300));
      const dict = {
        apple: { ko: "사과", ipa: "ˈæpəl", aliases: ["사과", "애플"] },
        run: { ko: "달리다 · 뛰다", ipa: "rʌn", aliases: ["달리다", "뛰다"] },
        cat: { ko: "고양이", ipa: "kæt", aliases: ["고양이"] },
      };
      const words = (body.words || []).filter((w) => dict[w.toLowerCase()]).map((w) => ({ en: w, ...dict[w.toLowerCase()] }));
      return reply(route, 200, { words, note: "zzz는 영어 단어가 아닙니다.", model: "claude-opus-5-5", usage: { input: 1, output: 1 } });
    }
    const imageCount = requests.filter((r) => r.path === "/recognize").length;
    const words =
      imageCount % 2 === 1
        ? [
            { number: 121, en: "authority", ko: "권위 · 권한", ipa: "əˈθɔːrəti", aliases: ["권위", "권한"] },
            { number: 122, en: "devote", ko: "바치다 · 헌신하다", aliases: ["바치다", "바치", "헌신하다", "헌신"] },
          ]
        : [
            { number: 0, en: "indicate", ko: "나타내다", aliases: ["나타내"], generated: true },
            { number: 122, en: "function", ko: "기능", aliases: [] },
          ];
    return reply(route, 200, { words, note: "", model: "claude-opus-5-5", usage: { input: 1, output: 1 } });
  });
  const url = process.env.APP_URL || "http://127.0.0.1:8000/daily-vocab/";
  await page.goto(url);

  // 이전 버전이 기기에 저장했던 API 키(v1)는 시작 시 제거된다
  await page.evaluate(() => localStorage.setItem("daily_vocab_ai_v1", JSON.stringify({ key: "sk-ant-old" })));
  await page.reload();
  assert((await page.evaluate(() => localStorage.getItem("daily_vocab_ai_v1"))) === null, "legacy api key purged");

  // 설정 없음: 추출 시 보호자 설정 안내
  assert((await page.textContent("#aiState")).includes("설정 필요"), "initial state");
  assert(await page.isDisabled("#testAi"), "test disabled without config");
  await page.click("#createSet");
  assert(await page.isHidden("#ocrEngine").catch(() => true), "no engine selector");
  const shot = await page.screenshot();
  await page.setInputFiles("#photos", { name: "p1.png", mimeType: "image/png", buffer: shot });
  assert((await page.textContent("#extractStatus")).includes("사진을 선택했습니다"), "photo selected feedback");
  await page.click("#extractWords");
  assert((await page.textContent("#extractStatus")).includes("보호자 설정"), "missing config guidance");
  assert(await page.evaluate(() => document.getElementById("aiSettings").open), "settings opened");
  assert(!(await page.isDisabled("#extractWords")), "button stays enabled");

  // 보호자 설정 저장 (주소 끝 슬래시 제거, 코드 입력칸은 비움)
  await page.fill("#aiServer", "not a url");
  await page.fill("#aiPasscode", PASSCODE);
  await page.click("#saveAi");
  assert((await page.textContent("#aiStatus")).includes("주소"), "invalid server rejected");
  await page.fill("#aiServer", SERVER + "/");
  await page.fill("#aiPasscode", "12");
  await page.click("#saveAi");
  assert((await page.textContent("#aiStatus")).includes("접속 코드"), "short passcode rejected");
  await page.fill("#aiPasscode", PASSCODE);
  await page.click("#saveAi");
  assert((await page.textContent("#aiState")).includes("연결 설정됨"), "state after save");
  assert((await page.inputValue("#aiPasscode")) === "", "passcode field cleared");
  assert((await page.inputValue("#aiServer")) === SERVER, "server shown without trailing slash");
  const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("daily_vocab_ai_v2")));
  assert(stored.server === SERVER && stored.passcode === PASSCODE, "config persisted");

  // 연결 확인
  await page.click("#testAi");
  await page.waitForFunction(() => document.getElementById("aiStatus").textContent.includes("연결 성공"));
  assert(requests[0].path === "/ping", "ping path");
  assert(requests[0].headers["x-app-passcode"] === PASSCODE, "passcode header");
  assert(!JSON.stringify(requests[0].headers).includes("x-api-key"), "no api key header from app");

  // 사진 2장 인식 → 초안 병합
  await page.click("#tabHome");
  await page.click("#resumeEditor");
  assert(await page.isVisible("#editor"), "back to editor after settings");
  await page.setInputFiles("#photos", [
    { name: "p1.png", mimeType: "image/png", buffer: shot },
    { name: "p2.png", mimeType: "image/png", buffer: shot },
  ]);
  await page.click("#extractWords");
  assert((await page.textContent("#extractStatus")).includes("사진에서 단어를 가져옵니다"), "immediate feedback");
  assert(await page.isDisabled("#extractWords"), "button locked while running");
  await page.waitForFunction(() => !document.getElementById("extractWords").disabled);
  const draft = await page.inputValue("#wordDraft");
  const expected = [
    "121\tauthority\t권위 · 권한\t권위|권한\təˈθɔːrəti",
    "122\tdevote\t바치다 · 헌신하다\t바치다|바치|헌신하다|헌신",
    "3\tindicate\t나타내다\t나타내",
    "4\tfunction\t기능\t",
  ].join("\n");
  assert(draft === expected, "draft rows: " + JSON.stringify(draft));
  const recog = requests.filter((r) => r.path === "/recognize");
  assert(recog.length === 2, "one request per photo");
  assert(recog[0].body.mediaType === "image/jpeg" && recog[0].body.image.length > 100, "jpeg base64 sent");
  assert(/^[A-Za-z0-9+/]+={0,2}$/.test(recog[0].body.image), "clean base64");
  assert((await page.textContent("#extractStatus")).includes("2/2장 완료"), "completion status");
  assert((await page.textContent("#draftWarnings")).includes("책과 비교"), "review reminder");
  assert((await page.locator("#wordTableBody tr").count()) === 4, "table shows extracted rows");
  // 사진에 뜻이 없어 AI가 채운 단어(generated)는 안내하고 노란 칸으로 표시한다
  assert((await page.textContent("#extractStatus")).includes("뜻 1개는 사진에 없어 AI 사전으로 채웠어요"), "generated meaning announced");
  assert((await page.textContent("#draftWarnings")).includes("노란 칸"), "generated meaning warning");
  const cellClass = (row, key) => page.getAttribute(`#wordTableBody tr:nth-child(${row}) [data-key="${key}"]`, "class");
  assert((await cellClass(3, "ko")).includes("ai-filled"), "generated ko marked");
  assert(!(await cellClass(3, "ipa")).includes("ai-filled"), "empty ipa not marked");
  assert(!(await cellClass(1, "ko")).includes("ai-filled"), "printed meaning not marked");
  await page.fill('#wordTableBody tr:nth-child(3) [data-key="ko"]', "나타내다 · 가리키다");
  assert(!(await cellClass(3, "ko")).includes("ai-filled"), "mark cleared after edit");

  // 저장 → 시험
  await page.fill("#setName", "AI 세트");
  await page.check("#confirmed");
  await page.click("#saveSet");
  assert(
    (await page.evaluate(() => WORDS.find((w) => w.en === "authority")?.ipa)) === "əˈθɔːrəti",
    "ipa saved from fifth column",
  );
  assert((await page.evaluate(() => WORDS.find((w) => w.en === "devote")?.ipa)) === "", "missing ipa stays empty");
  await page.click('[data-mode="en_ko"]');
  await page.click("#start");
  assert((await page.evaluate(() => queue.length)) === 4, "ai set quiz has 4 words");
  // AI 2차 채점: 책의 뜻과 다른 답 → /grade 로 묻고 인정되면 정답 + 허용 답안에 학습, 거절되면 오답
  const judgedEn = await page.evaluate(() => question.w.en);
  await page.fill("#answerInput", "비슷한뜻");
  await page.click("#check");
  await page.waitForFunction(() => document.getElementById("answerFeedback").textContent.includes("AI 판정"));
  const grades = () => requests.filter((r) => r.path === "/grade");
  assert(grades().length === 1 && grades()[0].body.en === judgedEn && grades()[0].body.answer === "비슷한뜻" && Array.isArray(grades()[0].body.aliases) && grades()[0].headers["x-app-passcode"] === PASSCODE, "grade request: " + JSON.stringify(grades().map((g) => g.body)));
  assert((await page.evaluate(() => question.answerPass === true && question.aiPass === true)) && (await page.textContent("#answerFeedback")).includes("✓ 정답!") && (await page.textContent("#answerFeedback")).includes("같은 뜻으로 인정"), "AI-accepted answer counts as correct: " + (await page.textContent("#answerFeedback")));
  assert(await page.evaluate((en) => sets.find((s) => s.name === "AI 세트").words.find((w) => w.en === en).aliases.includes("비슷한뜻"), judgedEn), "accepted answer learned as an alias");
  await page.click("#next");
  await page.fill("#answerInput", "엉뚱한답");
  await page.click("#check");
  await page.waitForFunction(() => document.getElementById("answerFeedback").textContent.includes("AI 판정"));
  assert((await page.evaluate(() => question.answerPass === false && !question.aiPass)) && (await page.textContent("#answerFeedback")).includes("다른 뜻이에요"), "AI-rejected answer stays wrong");
  assert(grades().length === 2, "one grade call per non-matching answer");
  await page.click("#next");
  await page.fill("#answerInput", await page.evaluate(() => question.w.ko.split(" · ")[0]));
  await page.click("#check");
  assert(grades().length === 2 && (await page.evaluate(() => question.answerPass === true)), "exact answer never asks the AI");

  // 오류 안내: 접속 코드 오류, 서버 혼잡, 연결 실패 → 취소 → 설정 삭제
  await page.goto(url);
  assert((await page.textContent("#aiState")).includes("연결 설정됨"), "config survives reload");

  // 🔍 단어 찾기: AI 사전 결과 카드 → ‘찾아본 단어’ 세트 자동 저장 → 다시 찾으면 요청 없이 저장된 결과 → 못 찾는 단어는 철자 제안 → 이 단어들로 시험 보기
  await page.click("#tabLookup");
  assert((await page.isVisible("#lookup")) && (await page.textContent("#lookupRecent")).includes("아직 찾아본 단어가 없어요") && (await page.isDisabled("#lookupQuiz")), "lookup view empty state");
  await page.fill("#lookupInput", " Weight ");
  await page.click("#lookupGo");
  await page.waitForFunction(() => !document.getElementById("lookupResult").classList.contains("hidden"));
  const lookupsReq = () => requests.filter((r) => r.path === "/lookup");
  assert(lookupsReq().length === 1 && lookupsReq()[0].body.word === "Weight" && lookupsReq()[0].headers["x-app-passcode"] === PASSCODE, "lookup request: " + JSON.stringify(lookupsReq().map((l) => l.body)));
  assert((await page.textContent("#lookupWord")).includes("weight") && (await page.textContent("#lookupMeaning")) === "무게 · 체중" && (await page.textContent("#lookupIpa")).includes("weɪt") && (await page.$$eval("#lookupExamples li", (l) => l.length)) === 2 && (await page.textContent("#lookupSimilar")).includes("mass"), "lookup card contents");
  assert((await page.textContent("#lookupSaved")).includes("찾아본 단어") && (await page.textContent("#lookupSaved")).includes("1번"), "saved to the lookup set: " + (await page.textContent("#lookupSaved")));
  assert(await page.evaluate(() => { const s = sets.find((x) => x.id === "lookup"); return Boolean(s && s.name === "찾아본 단어" && s.words.length === 1 && s.words[0].en === "weight" && s.words[0].aliases.includes("체중") && typeof s.updatedAt === "string"); }), "lookup set created with the word");
  assert((await page.textContent("#lookupCount")) === "1개" && (await page.textContent("#lookupRecent")).includes("weight") && (await page.textContent("#lookupRecent")).includes("1번") && !(await page.isDisabled("#lookupQuiz")), "recent list and quiz button");
  await page.fill("#lookupInput", "weight");
  await page.click("#lookupGo");
  await page.waitForFunction(() => document.getElementById("lookupStatus").textContent.includes("전에 찾아본"));
  assert(lookupsReq().length === 1 && (await page.textContent("#lookupRecent")).includes("2번") && (await page.evaluate(() => sets.find((x) => x.id === "lookup").words.length)) === 1, "cached lookup: no request, count 2, no duplicate word");
  await page.fill("#lookupInput", "recieve");
  await page.click("#lookupGo");
  await page.waitForFunction(() => document.getElementById("lookupStatus").textContent.includes("찾지 못했어요"));
  assert((await page.textContent("#lookupStatus")).includes("receive") && (await page.inputValue("#lookupInput")) === "receive" && (await page.isHidden("#lookupResult")) && (await page.evaluate(() => sets.find((x) => x.id === "lookup").words.length)) === 1, "unknown word: suggestion offered, nothing saved");
  await page.fill("#lookupInput", "drop table;");
  await page.click("#lookupGo");
  assert((await page.textContent("#lookupStatus")).includes("영어 단어") && lookupsReq().length === 2, "invalid input rejected without a request");
  await page.click("#lookupQuiz");
  assert((await page.isVisible("#home")) && (await page.textContent("#setSelect option:checked")).startsWith("찾아본 단어"), "quiz button selects the lookup set");
  assert((await page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_lookups_v1")).length)) === 1, "lookups persisted on the device");

  // 📷 문제 물어보기: 사진 + 도움 종류 + 직접 질문 → /tutor → 요약·풀이·어법·내 답 확인, 정답은 접힘, 단어 후보 → 찾아본 단어 세트, 질문 기록
  await page.click("#tabLookup");
  await page.click("#tutorAsk");
  assert((await page.textContent("#tutorStatus")).includes("사진을 고르거나"), "tutor needs a photo first");
  await page.setInputFiles("#tutorPhoto", { name: "q1.png", mimeType: "image/png", buffer: shot });
  assert((await page.textContent("#tutorStatus")).includes("사진을 선택했어요") && (await page.$$eval("#tutorPreview img", (i) => i.length)) === 1, "tutor photo preview");
  await page.click('.tutor-kinds .kind[data-kind="check"]');
  await page.fill("#tutorQuestion", "3번이 왜 3번이에요?");
  await page.click("#tutorAsk");
  await page.waitForFunction(() => !document.getElementById("tutorAnswer").classList.contains("hidden"));
  const tutors = () => requests.filter((r) => r.path === "/tutor");
  assert(tutors().length === 1 && tutors()[0].body.kind === "check" && tutors()[0].body.question === "3번이 왜 3번이에요?" && tutors()[0].body.mediaType === "image/jpeg" && tutors()[0].body.image.length > 100 && tutors()[0].body.child === undefined, "tutor request: " + JSON.stringify({ ...tutors()[0].body, image: "…" }));
  assert((await page.textContent("#tutorProblem")).includes("1번 3)") && (await page.textContent("#tutorProblem")).includes("내 답 확인") && (await page.$$eval("#tutorSteps li", (l) => l.length)) === 3 && (await page.textContent("#tutorGrammar")).includes("3인칭") && (await page.textContent("#tutorChecked")).includes("정답은 ③") && (await page.isHidden("#tutorTranslationBox")), "tutor answer sections");
  assert(!(await page.evaluate(() => document.getElementById("tutorAnswerBox").open)) && (await page.textContent("#tutorAnswerText")).startsWith("③"), "answer stays folded until opened");
  assert((await page.$$eval("#tutorWords button.chip", (b) => b.length)) === 2, "word candidates as chips");
  await page.locator('#tutorWords button.chip:has-text("gauge")').evaluate((b) => b.click()); // 고정 하단 탭 바에 가려질 수 있어 직접 클릭
  assert(await page.evaluate(() => sets.find((x) => x.id === "lookup").words.some((w) => w.en === "gauge")), "candidate added to the lookup set");
  assert((await page.isDisabled('#tutorWords button.chip:has-text("gauge")')) && (await page.textContent("#lookupCount")) === "2개", "chip marked and lookup count updated");
  assert((await page.textContent("#tutorCount")) === "1개" && (await page.textContent("#tutorHistory")).includes("1번 3)") && (await page.textContent("#tutorHistory")).includes("내 답 확인"), "tutor history");
  assert((await page.evaluate(() => JSON.parse(localStorage.getItem("daily_vocab_tutor_v1")).length)) === 1 && (await page.isDisabled("#tutorCancel")) && !(await page.isDisabled("#tutorAsk")), "tutor history persisted, buttons reset");
  await page.click("#tabHome");
  await page.click("#createSet");

  // 영어만 적은 단어의 뜻·발음을 AI 사전으로 채우기: 빈 칸만 채우고 노란 칸으로 표시, 못 찾은 단어 안내
  await page.click("#fillMeanings");
  assert((await page.textContent("#extractStatus")).includes("먼저 영어 단어"), "fill needs words");
  await page.click("#toggleDraftText");
  await page.fill("#wordDraft", ["apple", "2\trun\t\t\trʌn", "zzz", "5\tcat\t고양이"].join("\n"));
  await page.click("#toggleDraftText");
  assert((await page.locator("#wordTableBody tr").count()) === 4, "english-only rows in table");
  await page.click("#fillMeanings");
  assert((await page.isDisabled("#extractWords")) && (await page.isDisabled("#fillMeanings")), "ai buttons locked while filling");
  await page.waitForFunction(() => !document.getElementById("fillMeanings").disabled);
  const defines = () => requests.filter((r) => r.path === "/define");
  assert(defines().length === 1 && JSON.stringify(defines()[0].body.words) === JSON.stringify(["apple", "run", "zzz", "cat"]), "define request lists words with blanks: " + JSON.stringify(defines().map((d) => d.body)));
  assert(defines()[0].headers["x-app-passcode"] === PASSCODE, "define passcode header");
  const filled = await page.inputValue("#wordDraft");
  assert(
    filled === ["1\tapple\t사과\t사과|애플\tˈæpəl", "2\trun\t달리다 · 뛰다\t달리다|뛰다\trʌn", "3\tzzz\t\t", "5\tcat\t고양이\t\tkæt"].join("\n"),
    "filled draft: " + JSON.stringify(filled),
  );
  const fillStatus = await page.textContent("#extractStatus");
  assert(fillStatus.includes("뜻 2개") && fillStatus.includes("발음 2개") && fillStatus.includes("못 찾은 단어: zzz") && fillStatus.includes("영어 단어가 아닙니다"), "fill status: " + fillStatus);
  assert((await cellClass(1, "ko")).includes("ai-filled") && (await cellClass(1, "ipa")).includes("ai-filled"), "filled ko/ipa marked");
  assert(!(await cellClass(2, "ipa")).includes("ai-filled"), "own ipa kept");
  assert(!(await cellClass(4, "ko")).includes("ai-filled") && (await cellClass(4, "ipa")).includes("ai-filled"), "own meaning kept, ipa-only fill marked");
  await page.click("#fillMeanings");
  await page.waitForFunction(() => !document.getElementById("fillMeanings").disabled);
  assert(defines().length === 2 && JSON.stringify(defines()[1].body.words) === JSON.stringify(["zzz"]), "second fill asks only the still-empty word");
  assert((await page.inputValue("#wordDraft")) === filled, "second fill changes nothing");
  mode = "notfound";
  await page.click("#fillMeanings");
  await page.waitForFunction(() => !document.getElementById("fillMeanings").disabled);
  assert((await page.textContent("#extractStatus")).includes("다시 배포"), "old worker (no /define) guidance");
  mode = "ok";
  await page.click("#toggleDraftText");
  await page.fill("#wordDraft", "");
  await page.click("#toggleDraftText");
  await page.setInputFiles("#photos", { name: "p3.png", mimeType: "image/png", buffer: shot });
  const runAndWait = async () => {
    await page.click("#extractWords");
    await page.waitForFunction(() => !document.getElementById("extractWords").disabled);
    return page.textContent("#extractStatus");
  };
  mode = "auth";
  assert((await runAndWait()).includes("접속 코드가 맞지 않습니다"), "auth error guidance");
  assert((await page.inputValue("#wordDraft")) === "", "no draft on error");
  mode = "busy";
  assert((await runAndWait()).includes("혼잡"), "server message surfaced");
  mode = "abort";
  assert((await runAndWait()).includes("연결하지 못했습니다"), "network failure guidance");
  mode = "slow";
  await page.click("#extractWords");
  await page.click("#cancelExtract");
  assert((await page.textContent("#extractStatus")).includes("취소"), "cancel status");
  await page.waitForTimeout(2000);
  assert((await page.inputValue("#wordDraft")) === "", "cancel discards late result");
  assert(!(await page.isDisabled("#extractWords")), "button re-enabled after cancel");
  mode = "ok";
  await page.click("#tabSettings");
  await page.evaluate(() => (document.getElementById("aiSettings").open = true));
  await page.click("#clearAi");
  assert((await page.textContent("#aiState")).includes("설정 필요"), "state after clear");
  assert((await page.evaluate(() => localStorage.getItem("daily_vocab_ai_v2"))) === null, "storage cleared");
  if (errors.length) throw Error(errors.join(","));
  console.log(
    "PASS: legacy key purge, guardian settings, ping, two-photo recognition with numbering and generated meanings, save/quiz, AI dictionary fill, error guidance, cancel, clear",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
