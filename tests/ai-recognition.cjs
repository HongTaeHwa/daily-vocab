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
    if (mode === "slow") await new Promise((r) => setTimeout(r, 1500));
    if (url.pathname === "/ping") return reply(route, 200, { ok: true, model: "claude-opus-5-5" });
    const imageCount = requests.filter((r) => r.path === "/recognize").length;
    const words =
      imageCount % 2 === 1
        ? [
            { number: 121, en: "authority", ko: "권위 · 권한", ipa: "əˈθɔːrəti", aliases: ["권위", "권한"] },
            { number: 122, en: "devote", ko: "바치다 · 헌신하다", aliases: ["바치다", "바치", "헌신하다", "헌신"] },
          ]
        : [
            { number: 0, en: "indicate", ko: "나타내다", aliases: ["나타내"] },
            { number: 122, en: "function", ko: "기능", aliases: [] },
          ];
    return reply(route, 200, { words, note: "", model: "claude-opus-5-5", usage: { input: 1, output: 1 } });
  });
  const url = process.env.APP_URL || "http://127.0.0.1:8000/day04-vocab/";
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

  // 오류 안내: 접속 코드 오류, 서버 혼잡, 연결 실패 → 취소 → 설정 삭제
  await page.goto(url);
  assert((await page.textContent("#aiState")).includes("연결 설정됨"), "config survives reload");
  await page.click("#createSet");
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
  await page.evaluate(() => (document.getElementById("aiSettings").open = true));
  await page.click("#clearAi");
  assert((await page.textContent("#aiState")).includes("설정 필요"), "state after clear");
  assert((await page.evaluate(() => localStorage.getItem("daily_vocab_ai_v2"))) === null, "storage cleared");
  if (errors.length) throw Error(errors.join(","));
  console.log(
    "PASS: legacy key purge, guardian settings, ping, two-photo recognition with numbering, save/quiz, error guidance, cancel, clear",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
