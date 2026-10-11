// AI 사진 인식(Claude API) 흐름: 키 저장 → 연결 확인 → 사진 2장 인식 → 초안 병합 → 저장 → 시험,
// 그리고 인증 오류·fallbacks 미지원 재시도·취소·키 삭제. Anthropic API는 라우트로 가로채 가짜 응답을 준다.
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
  const KEY = "sk-ant-api03-test-key-0000000000000000ABCD";
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "POST, OPTIONS",
  };
  const requests = [];
  let mode = "ok";
  const reply = (route, status, body) =>
    route.fulfill({
      status,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await page.route("https://api.anthropic.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(req.postData() || "{}");
    requests.push({ headers: req.headers(), body });
    if (mode === "auth")
      return reply(route, 401, {
        type: "error",
        error: { type: "authentication_error", message: "invalid x-api-key" },
      });
    if (mode === "fallback400" && body.fallbacks)
      return reply(route, 400, {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "fallbacks: not available for this account",
        },
      });
    if (mode === "slow") await new Promise((r) => setTimeout(r, 1500));
    const isImage = body.messages?.[0]?.content?.[0]?.type === "image";
    const imageCount = requests.filter(
      (r) => r.body.messages?.[0]?.content?.[0]?.type === "image",
    ).length;
    const words = !isImage
      ? []
      : imageCount % 2 === 1
        ? [
            { number: 121, english: "authority", korean: "권위 · 권한", aliases: ["권위", "권한"] },
            { number: 122, english: "devote", korean: "바치다 · 헌신하다", aliases: ["바치다", "바치", "헌신하다", "헌신"] },
          ]
        : [
            { number: 0, english: "indicate", korean: "나타내다", aliases: ["나타내"] },
            { number: 122, english: "function", korean: "기능", aliases: [] },
          ];
    return reply(route, 200, {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: body.model,
      stop_reason: "end_turn",
      content: [
        { type: "text", text: isImage ? JSON.stringify({ words, note: "" }) : "확인" },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  });
  const url = process.env.APP_URL || "http://127.0.0.1:8000/day04-vocab/";
  await page.goto(url);

  // 키 없음: 기본 엔진은 기존 OCR, AI 선택 시 키 안내
  await page.click("#createSet");
  assert((await page.inputValue("#ocrEngine")) === "tesseract", "default engine without key");
  assert(await page.isDisabled("#testApiKey"), "test button disabled without key");
  await page.selectOption("#ocrEngine", "claude");
  const shot = await page.screenshot();
  await page.setInputFiles("#photos", { name: "p1.png", mimeType: "image/png", buffer: shot });
  await page.click("#runOcr");
  assert((await page.textContent("#ocrStatus")).includes("API 키"), "missing key guidance");
  assert(await page.evaluate(() => document.getElementById("aiSettings").open), "settings opened");
  assert(!(await page.isDisabled("#runOcr")), "run button stays enabled");

  // 키 저장
  await page.fill("#apiKey", KEY);
  await page.click("#saveApiKey");
  assert((await page.textContent("#aiKeyState")).includes("ABCD"), "key state shows suffix");
  assert((await page.inputValue("#apiKey")) === "", "key field cleared after save");
  assert((await page.inputValue("#ocrEngine")) === "claude", "engine switched to claude");
  assert(
    JSON.parse(await page.evaluate(() => localStorage.getItem("daily_vocab_ai_v1"))).key === KEY,
    "key persisted",
  );

  // 연결 확인
  await page.click("#testApiKey");
  await page.waitForFunction(() =>
    document.getElementById("aiStatus").textContent.includes("연결 성공"),
  );
  const ping = requests[0];
  assert(ping.headers["x-api-key"] === KEY, "api key header");
  assert(ping.headers["anthropic-dangerous-direct-browser-access"] === "true", "browser access header");
  assert(ping.headers["anthropic-version"] === "2023-06-01", "version header");
  assert(ping.headers["anthropic-beta"] === "server-side-fallback-2026-07-01", "fallback beta header");
  assert(ping.body.model === "claude-opus-5-5" && ping.body.fallbacks === "default", "default model + fallbacks");

  // 사진 2장 인식 → 초안 병합 (인쇄 번호 유지, 없거나 겹치면 이어서 번호)
  await page.setInputFiles("#photos", [
    { name: "p1.png", mimeType: "image/png", buffer: shot },
    { name: "p2.png", mimeType: "image/png", buffer: shot },
  ]);
  await page.click("#runOcr");
  assert((await page.textContent("#ocrStatus")).includes("AI 사진 인식을 시작"), "immediate feedback");
  await page.waitForFunction(() => !document.getElementById("runOcr").disabled);
  const draft = await page.inputValue("#wordDraft");
  const expected = [
    "121\tauthority\t권위 · 권한\t권위|권한",
    "122\tdevote\t바치다 · 헌신하다\t바치다|바치|헌신하다|헌신",
    "3\tindicate\t나타내다\t나타내",
    "4\tfunction\t기능\t",
  ].join("\n");
  assert(draft === expected, "draft rows: " + JSON.stringify(draft));
  const imageReqs = requests.filter((r) => r.body.messages?.[0]?.content?.[0]?.type === "image");
  assert(imageReqs.length === 2, "one request per photo");
  const img = imageReqs[0].body.messages[0].content[0].source;
  assert(img.type === "base64" && img.media_type === "image/jpeg" && img.data.length > 100, "jpeg base64 image");
  assert(imageReqs[0].body.output_config?.format?.type === "json_schema", "structured output schema");
  assert(imageReqs[0].body.output_config?.format?.schema?.properties?.words, "schema has words");
  assert(typeof imageReqs[0].body.system === "string" && imageReqs[0].body.system.includes("aliases"), "system prompt");
  assert(imageReqs[0].body.max_tokens >= 4096, "max_tokens large enough");
  assert((await page.textContent("#ocrStatus")).includes("2/2장 인식 완료"), "completion status");
  assert((await page.textContent("#draftWarnings")).includes("원본과 비교"), "review reminder");

  // 저장 → 시험
  await page.fill("#setName", "AI 세트");
  await page.check("#confirmed");
  await page.click("#saveSet");
  await page.click('[data-mode="en_ko"]');
  await page.click("#start");
  assert((await page.evaluate(() => queue.length)) === 4, "ai set quiz has 4 words");

  // 인증 오류 → 안내, fallbacks 미지원 400 → 재시도 성공, 취소, 키 삭제
  await page.goto(url);
  await page.click("#createSet");
  assert((await page.inputValue("#ocrEngine")) === "claude", "engine defaults to claude with saved key");
  await page.setInputFiles("#photos", { name: "p3.png", mimeType: "image/png", buffer: shot });
  mode = "auth";
  await page.click("#runOcr");
  await page.waitForFunction(() => !document.getElementById("runOcr").disabled);
  assert((await page.textContent("#ocrStatus")).includes("API 키가 올바르지 않습니다"), "auth error guidance");
  assert((await page.inputValue("#wordDraft")) === "", "no draft on auth error");
  mode = "fallback400";
  const before = requests.length;
  await page.click("#runOcr");
  await page.waitForFunction(() => !document.getElementById("runOcr").disabled);
  assert((await page.inputValue("#wordDraft")).split("\n").length === 2, "retry without fallbacks produced rows");
  const retry = requests.slice(before);
  assert(
    retry.length === 2 &&
      retry[0].body.fallbacks === "default" &&
      !("fallbacks" in retry[1].body) &&
      !retry[1].headers["anthropic-beta"],
    "retry drops fallbacks and beta header",
  );
  mode = "slow";
  await page.fill("#wordDraft", "");
  await page.click("#runOcr");
  await page.click("#cancelOcr");
  assert((await page.textContent("#ocrStatus")).includes("취소"), "cancel status");
  await page.waitForTimeout(2000);
  assert((await page.inputValue("#wordDraft")) === "", "cancel discards late result");
  assert(!(await page.isDisabled("#runOcr")), "run button re-enabled after cancel");
  mode = "ok";
  await page.evaluate(() => (document.getElementById("aiSettings").open = true));
  await page.click("#clearApiKey");
  assert((await page.textContent("#aiKeyState")).includes("키 없음"), "key cleared");
  assert((await page.inputValue("#ocrEngine")) === "tesseract", "engine falls back after clearing key");
  assert((await page.evaluate(() => localStorage.getItem("daily_vocab_ai_v1"))) === null, "storage cleared");
  if (errors.length) throw Error(errors.join(","));
  console.log(
    "PASS: Claude key settings, connection test, two-photo AI recognition with numbering, save/quiz, auth error, fallback retry, cancel, key removal",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
