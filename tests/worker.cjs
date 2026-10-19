// Cloudflare Worker 프록시(worker/worker.js) 단위 테스트. Node만 필요(Playwright 불필요).
// Anthropic 호출은 globalThis.fetch 를 바꿔 가짜 응답으로 대체한다.
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");
(async () => {
  const { default: worker, AnthropicRelay, FamilyStore } = await import(
    pathToFileURL(path.join(__dirname, "..", "worker", "worker.js")).href
  );
  const ORIGIN = "https://hongtaehwa.github.io";
  const env = {
    ANTHROPIC_API_KEY: "sk-ant-test",
    APP_PASSCODE: "family-1234",
    CLAUDE_MODEL: "claude-opus-5-5",
    ALLOWED_ORIGINS: "https://hongtaehwa.github.io",
  };
  const okWords = {
    words: [
      { number: 121, english: "authority", ipa: "əˈθɔːrəti", korean: "권위 · 권한", aliases: ["권위", "권한", "권위"], generated: "yes" },
      { number: 0, english: " devote ", ipa: "[dɪˈvoʊt]", korean: "바치다", aliases: ["바치다", "바치"], generated: true },
      { number: 5, english: "", ipa: "", korean: "x", aliases: [] },
    ],
    note: "",
  };
  const okResponse = (body) => ({
    status: 200,
    json: {
      id: "msg_1",
      model: body.model,
      stop_reason: "end_turn",
      content: [{ type: "text", text: body.system ? JSON.stringify(okWords) : "확인" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  });
  const calls = [];
  let upstream = okResponse;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), headers: init.headers, body });
    const r = upstream(body);
    return new Response(JSON.stringify(r.json), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  };
  const req = (p, { method = "POST", origin = ORIGIN, passcode = "family-1234", body, raw } = {}) =>
    new Request("https://ai.example.workers.dev" + p, {
      method,
      headers: {
        ...(origin ? { origin } : {}),
        ...(passcode !== null ? { "x-app-passcode": passcode } : {}),
        "content-type": "application/json",
      },
      body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
    });

  // CORS preflight
  let res = await worker.fetch(req("/recognize", { method: "OPTIONS" }), env);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
  assert(res.headers.get("access-control-allow-headers").includes("x-app-passcode"));
  res = await worker.fetch(req("/recognize", { method: "OPTIONS", origin: "https://evil.example" }), env);
  assert.equal(res.headers.get("access-control-allow-origin"), null, "no CORS for unknown origin");

  // origin / passcode / config / routing
  res = await worker.fetch(req("/ping", { origin: "https://evil.example", body: {} }), env);
  assert.equal(res.status, 403);
  res = await worker.fetch(req("/ping", { passcode: "nope", body: {} }), env);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN, "CORS on error responses");
  res = await worker.fetch(req("/ping", { passcode: null, body: {} }), env);
  assert.equal(res.status, 401);
  res = await worker.fetch(req("/ping", { body: {} }), { ...env, ANTHROPIC_API_KEY: "" });
  assert.equal(res.status, 500);
  res = await worker.fetch(req("/ping", { body: {} }), { ...env, APP_PASSCODE: "" });
  assert.equal(res.status, 500);
  res = await worker.fetch(req("/other", { body: {} }), env);
  assert.equal(res.status, 404);
  res = await worker.fetch(new Request("https://ai.example.workers.dev/ping", { method: "GET" }), env);
  assert.equal(res.status, 404);
  assert.equal(calls.length, 0, "no upstream call before auth passes");

  // ping: headers, fallbacks, model
  res = await worker.fetch(req("/ping", { body: {} }), env);
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.deepEqual(data, { ok: true, model: "claude-opus-5-5" });
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].headers["x-api-key"], "sk-ant-test");
  assert.equal(calls[0].headers["anthropic-version"], "2023-06-01");
  assert.equal(calls[0].headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.equal(calls[0].body.fallbacks, "default");
  assert.equal(calls[0].body.model, "claude-opus-5-5");
  assert(!JSON.stringify(calls[0].headers).includes("family-1234"), "passcode never forwarded");

  // trailing slash path, rate limiter binding
  res = await worker.fetch(req("/ping/", { body: {} }), env);
  assert.equal(res.status, 200);
  const limiter = { keys: [], allow: true, limit: async ({ key }) => (limiter.keys.push(key), { success: limiter.allow }) };
  limiter.allow = false;
  res = await worker.fetch(req("/ping", { body: {} }), { ...env, RATE_LIMITER: limiter });
  assert.equal(res.status, 429);
  assert(limiter.keys[0].startsWith("/ping:"));

  // model selection
  calls.length = 0;
  res = await worker.fetch(req("/ping", { body: {} }), { ...env, CLAUDE_MODEL: "claude-haiku-5-5" });
  assert.equal(res.status, 200);
  assert.equal(calls[0].body.model, "claude-haiku-5-5");
  assert.equal(calls[0].body.fallbacks, undefined, "haiku has no fallbacks");
  assert.equal(calls[0].headers["anthropic-beta"], undefined);
  calls.length = 0;
  await worker.fetch(req("/ping", { body: {} }), { ...env, CLAUDE_MODEL: "not-a-model" });
  assert.equal(calls[0].body.model, "claude-opus-5-5", "unknown model falls back to default");

  // recognize validation
  res = await worker.fetch(req("/recognize", { body: { image: "" } }), env);
  assert.equal(res.status, 400);
  res = await worker.fetch(req("/recognize", { body: { image: "not base64!!" } }), env);
  assert.equal(res.status, 400);
  res = await worker.fetch(req("/recognize", { raw: "nope" }), env);
  assert.equal(res.status, 400);
  res = await worker.fetch(req("/recognize", { body: { image: "A".repeat(8 * 1024 * 1024 + 4) } }), env);
  assert.equal(res.status, 413);

  // recognize success → sanitized rows
  calls.length = 0;
  res = await worker.fetch(req("/recognize", { body: { image: "aGVsbG8=", mediaType: "image/png" } }), env);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.deepEqual(data.words, [
    { number: 121, en: "authority", ko: "권위 · 권한", ipa: "əˈθɔːrəti", aliases: ["권위", "권한"], generated: false },
    { number: 0, en: "devote", ko: "바치다", ipa: "dɪˈvoʊt", aliases: ["바치다", "바치"], generated: true },
  ]);
  assert.equal(data.note, "");
  assert.equal(data.model, "claude-opus-5-5");
  assert.deepEqual(data.usage, { input: 10, output: 5 });
  const sent = calls[0].body;
  assert.equal(sent.messages[0].content[0].type, "image");
  assert.equal(sent.messages[0].content[0].source.data, "aGVsbG8=");
  assert.equal(sent.messages[0].content[0].source.media_type, "image/png");
  assert.equal(sent.output_config.format.type, "json_schema");
  assert.equal(sent.output_config.format.schema.additionalProperties, false);
  assert(sent.system.includes("aliases"));
  assert(sent.output_config.format.schema.properties.words.items.properties.ipa, "schema has ipa");
  assert(sent.output_config.format.schema.properties.words.items.required.includes("generated"), "schema requires generated");
  assert(sent.system.includes("generated") && sent.system.includes("no Korean meaning"), "prompt covers english-only pages");
  assert(sent.messages[0].content[1].text.includes("generated"), "user text asks to flag generated meanings");
  assert.equal(sent.max_tokens, 8192);
  assert.equal(sent.thinking, undefined, "adaptive thinking by omission");

  // define (AI 사전): validation, prompt, matching back to the requested spelling, dedup, unknown words dropped
  res = await worker.fetch(req("/define", { body: {} }), env);
  assert.equal(res.status, 400);
  res = await worker.fetch(req("/define", { body: { words: "apple" } }), env);
  assert.equal(res.status, 400);
  res = await worker.fetch(req("/define", { body: { words: ["apple", "drop table;"] } }), env);
  assert.equal(res.status, 400);
  assert((await res.json()).message.includes("drop table;"));
  res = await worker.fetch(req("/define", { body: { words: Array.from({ length: 61 }, (_, i) => "w" + i) } }), env);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "too_many");
  res = await worker.fetch(req("/define", { raw: "nope" }), env);
  assert.equal(res.status, 400);
  res = await worker.fetch(new Request("https://ai.example.workers.dev/define", { method: "GET" }), env);
  assert.equal(res.status, 404);
  calls.length = 0;
  upstream = (body) => ({
    status: 200,
    json: {
      model: body.model,
      stop_reason: "end_turn",
      usage: { input_tokens: 3, output_tokens: 4 },
      content: [
        {
          type: "text",
          text: JSON.stringify({
            words: [
              { english: "Apple", ipa: "[ˈæpəl]", korean: "사과", aliases: ["사과", "사과"] },
              { english: "give up", ipa: "", korean: "포기하다", aliases: ["포기하다", "포기"] },
              { english: "zzz", ipa: "", korean: "", aliases: [] },
              { english: "banana", ipa: "", korean: "바나나", aliases: [] },
              { english: "apple", ipa: "", korean: "중복", aliases: [] },
            ],
            note: "zzz는 영어 단어가 아닙니다.",
          }),
        },
      ],
    },
  });
  res = await worker.fetch(req("/define", { body: { words: ["apple", " give  up ", "zzz", "APPLE"] } }), env);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.deepEqual(data.words, [
    { en: "apple", ko: "사과", ipa: "ˈæpəl", aliases: ["사과"] },
    { en: "give up", ko: "포기하다", ipa: "", aliases: ["포기하다", "포기"] },
  ]);
  assert.equal(data.note, "zzz는 영어 단어가 아닙니다.");
  assert.equal(data.model, "claude-opus-5-5");
  assert.deepEqual(data.usage, { input: 3, output: 4 });
  assert.equal(calls.length, 1, "one upstream call per define request");
  const defineSent = calls[0].body;
  assert(defineSent.system.includes("dictionary"), "dictionary prompt");
  assert.equal(
    defineSent.messages[0].content,
    "다음 영어 단어들의 뜻·발음·허용 답안을 JSON으로 만드세요.\n1. apple\n2. give up\n3. zzz",
    "deduped, numbered word list",
  );
  assert.equal(defineSent.output_config.format.type, "json_schema");
  assert.deepEqual(defineSent.output_config.format.schema.properties.words.items.required, ["english", "ipa", "korean", "aliases"]);
  assert.equal(defineSent.fallbacks, "default");
  assert.equal(defineSent.thinking, undefined);
  upstream = (body) => ({
    status: 200,
    json: {
      model: body.model,
      stop_reason: "end_turn",
      usage: {},
      content: [{ type: "text", text: JSON.stringify({ words: [{ english: "zzz", ipa: "", korean: "", aliases: [] }], note: "모르는 단어입니다" }) }],
    },
  });
  res = await worker.fetch(req("/define", { body: { words: ["zzz"] } }), env);
  assert.equal(res.status, 422, "nothing defined → 422");
  assert((await res.json()).message.includes("모르는 단어입니다"));
  upstream = (body) => ({ status: 200, json: { model: body.model, usage: {}, stop_reason: "refusal", content: [] } });
  res = await worker.fetch(req("/define", { body: { words: ["apple"] } }), env);
  assert.equal(res.status, 422);
  assert((await res.json()).message.includes("거부"));
  limiter.keys.length = 0;
  limiter.allow = true;
  upstream = okResponse;
  res = await worker.fetch(req("/define", { body: { words: ["apple"] } }), { ...env, RATE_LIMITER: limiter });
  assert(limiter.keys[0].startsWith("/define:"), "define has its own rate-limit bucket");

  // grade (2차 채점): 검증, 라우팅, 기본 haiku 모델(fallbacks 없음), 프롬프트, 판정 전달, GRADE_MODEL
  res = await worker.fetch(req("/grade", { body: {} }), env);
  assert.equal(res.status, 400, "grade needs en/ko/answer");
  res = await worker.fetch(req("/grade", { body: { en: "weight", ko: "무게", answer: "  " } }), env);
  assert.equal(res.status, 400, "blank answer rejected");
  res = await worker.fetch(req("/grade", { raw: "nope" }), env);
  assert.equal(res.status, 400);
  res = await worker.fetch(new Request("https://ai.example.workers.dev/grade", { method: "GET" }), env);
  assert.equal(res.status, 404, "grade is POST only");
  res = await worker.fetch(req("/grade", { passcode: "nope", body: { en: "weight", ko: "무게", answer: "몸무게" } }), env);
  assert.equal(res.status, 401);
  calls.length = 0;
  upstream = (body) => ({
    status: 200,
    json: { id: "msg_g", model: body.model, stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ accept: true, reason: "무게와 같은 뜻" }) }], usage: { input_tokens: 5, output_tokens: 3 } },
  });
  res = await worker.fetch(req("/grade", { body: { en: " weight ", ko: "무게", aliases: ["무게", "무게", " 중량 ", ""], answer: "몸무게" } }), env);
  assert.equal(res.status, 200);
  let graded = await res.json();
  assert.deepEqual([graded.accept, graded.reason, graded.model, graded.usage.input], [true, "무게와 같은 뜻", "claude-haiku-5-5", 5], "grade result: " + JSON.stringify(graded));
  assert.equal(calls.length, 1, "one upstream call per grade");
  const gradeSent = calls[0].body;
  assert.equal(gradeSent.model, "claude-haiku-5-5", "grade uses the cheap model by default");
  assert.equal(gradeSent.fallbacks, undefined, "haiku: no fallbacks");
  assert.equal(calls[0].headers["anthropic-beta"], undefined, "haiku: no fallback beta header");
  assert.equal(gradeSent.thinking, undefined);
  assert(gradeSent.system.includes("vocabulary quiz"), "grade prompt");
  assert.equal(gradeSent.messages[0].content, "영어 단어: weight\n교재의 뜻: 무게\n이미 정답으로 인정하는 답: 무게, 중량\n학생의 답: 몸무게", "grade user message: " + gradeSent.messages[0].content);
  assert.deepEqual(gradeSent.output_config.format.schema.required, ["accept", "reason"]);
  await worker.fetch(req("/grade", { body: { en: "weight", ko: "무게", answer: "몸무게" } }), { ...env, GRADE_MODEL: "claude-sonnet-5-5" });
  assert.equal(calls[1].body.model, "claude-sonnet-5-5", "GRADE_MODEL overrides the default");
  assert.equal(calls[1].body.fallbacks, "default", "sonnet keeps fallbacks");
  upstream = (body) => ({
    status: 200,
    json: { id: "msg_g", model: body.model, stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ accept: "yes", reason: "다른 뜻이에요" }) }], usage: {} },
  });
  graded = await (await worker.fetch(req("/grade", { body: { en: "weight", ko: "무게", answer: "기다리다" } }), env)).json();
  assert.deepEqual([graded.accept, graded.reason], [false, "다른 뜻이에요"], "non-boolean accept counts as reject");
  upstream = (body) => ({ status: 200, json: { id: "msg_g", model: body.model, stop_reason: "refusal", content: [], usage: {} } });
  res = await worker.fetch(req("/grade", { body: { en: "weight", ko: "무게", answer: "기다리다" } }), env);
  assert.equal(res.status, 422, "refusal → 422");
  upstream = okResponse;

  // lookup (단어 찾기): 검증, 라우팅, sonnet 기본(fallbacks 있음), 프롬프트, 결과 정리, 못 찾음·철자 제안, LOOKUP_MODEL
  res = await worker.fetch(req("/lookup", { body: {} }), env);
  assert.equal(res.status, 400, "lookup needs a word");
  res = await worker.fetch(req("/lookup", { body: { word: "drop table;" } }), env);
  assert.equal(res.status, 400, "lookup rejects non-words");
  res = await worker.fetch(new Request("https://ai.example.workers.dev/lookup", { method: "GET" }), env);
  assert.equal(res.status, 404, "lookup is POST only");
  res = await worker.fetch(req("/lookup", { passcode: "nope", body: { word: "weight" } }), env);
  assert.equal(res.status, 401);
  calls.length = 0;
  const lookupJson = (data) => (body) => ({
    status: 200,
    json: { id: "msg_l", model: body.model, stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(data) }], usage: { input_tokens: 7, output_tokens: 9 } },
  });
  upstream = lookupJson({
    found: true, english: " Weight ", suggestion: "", pos: "명사", korean: "무게 · 체중", ipa: "[weɪt]", aliases: ["무게", "체중", "무게", ""],
    examples: [{ english: "What is your weight?", korean: "네 몸무게는 얼마니?" }, { english: "", korean: "x" }, { english: "The box has a heavy weight.", korean: "그 상자는 무겁다." }, { english: "Four.", korean: "넷." }],
    similar: ["mass", "heaviness", "drop table;"], note: "",
  });
  res = await worker.fetch(req("/lookup", { body: { word: " weight " } }), env);
  assert.equal(res.status, 200);
  let looked = await res.json();
  assert.deepEqual(
    [looked.found, looked.en, looked.pos, looked.ko, looked.ipa, looked.aliases, looked.examples.length, looked.examples[1].en, looked.similar, looked.model, looked.usage.output],
    [true, "Weight", "명사", "무게 · 체중", "weɪt", ["무게", "체중"], 3, "The box has a heavy weight.", ["mass", "heaviness"], "claude-sonnet-5-5", 9],
    "lookup result cleaned: " + JSON.stringify(looked),
  );
  assert.equal(calls.length, 1, "one upstream call per lookup");
  const lookupSent = calls[0].body;
  assert.equal(lookupSent.model, "claude-sonnet-5-5", "lookup uses sonnet by default");
  assert.equal(lookupSent.fallbacks, "default", "sonnet keeps fallbacks");
  assert(lookupSent.system.includes("dictionary") && lookupSent.messages[0].content === "단어: weight", "lookup prompt: " + lookupSent.messages[0].content);
  assert(lookupSent.output_config.format.schema.required.includes("examples") && lookupSent.output_config.effort === "low", "lookup schema/effort");
  upstream = lookupJson({ found: false, english: "recieve", suggestion: "receive", pos: "", korean: "", ipa: "", aliases: [], examples: [], similar: [], note: "" });
  looked = await (await worker.fetch(req("/lookup", { body: { word: "recieve" } }), env)).json();
  assert.deepEqual([looked.found, looked.en, looked.suggestion, looked.ko, looked.aliases], [false, "recieve", "receive", "", []], "not found → suggestion");
  upstream = lookupJson({ found: true, english: "zzz", suggestion: "", pos: "", korean: "  ", ipa: "", aliases: [], examples: [], similar: [], note: "모르는 단어" });
  looked = await (await worker.fetch(req("/lookup", { body: { word: "zzz" } }), env)).json();
  assert.deepEqual([looked.found, looked.note], [false, "모르는 단어"], "found without a meaning counts as not found");
  await worker.fetch(req("/lookup", { body: { word: "apple" } }), { ...env, LOOKUP_MODEL: "claude-haiku-5-5" });
  assert.equal(calls[calls.length - 1].body.model, "claude-haiku-5-5", "LOOKUP_MODEL overrides");
  assert.equal(calls[calls.length - 1].body.fallbacks, undefined, "haiku lookup has no fallbacks");
  upstream = okResponse;

  // tutor (문제 물어보기): 검증, 라우팅, sonnet 기본, 사진 + 도움 종류 프롬프트, 결과 정리, 모르는 종류 → explain, TUTOR_MODEL
  res = await worker.fetch(req("/tutor", { body: {} }), env);
  assert.equal(res.status, 400, "tutor needs an image");
  res = await worker.fetch(req("/tutor", { body: { image: "!!!", kind: "explain" } }), env);
  assert.equal(res.status, 400, "tutor rejects non-base64");
  res = await worker.fetch(new Request("https://ai.example.workers.dev/tutor", { method: "GET" }), env);
  assert.equal(res.status, 404, "tutor is POST only");
  res = await worker.fetch(req("/tutor", { passcode: "nope", body: { image: "aGVsbG8=" } }), env);
  assert.equal(res.status, 401);
  calls.length = 0;
  const tutorJson = (data) => (body) => ({
    status: 200,
    json: { id: "msg_t", model: body.model, stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(data) }], usage: { input_tokens: 100, output_tokens: 50 } },
  });
  const tutorData = {
    problem: " 1번 3) 요지 고르기 ", summary: "아기 마사지와 체중 증가 이야기예요.", translation: "첫 줄 해석\n둘째 줄 해석", steps: ["질문이 무엇을 묻는지 보세요.", "", "글 전체의 중심 생각을 찾아요."],
    grammar: ["3인칭 단수 동사에 -s"], answer: "③ — 접촉이 아기 성장에 도움이 된다는 글이에요", checked: "✓한 ①은 지나친 일반화예요.",
    words: [{ english: "gauge", korean: "측정하다" }, { english: "", korean: "x" }, { english: "absorption", korean: "흡수" }], note: "",
  };
  upstream = tutorJson(tutorData);
  res = await worker.fetch(req("/tutor", { body: { image: "aGVsbG8=", mediaType: "image/png", kind: "check", question: " 3번이 왜 3번이에요? " } }), env);
  assert.equal(res.status, 200);
  const tutored = await res.json();
  assert.deepEqual(
    [tutored.kind, tutored.problem, tutored.steps, tutored.words, tutored.answer.startsWith("③"), tutored.translation, tutored.model, tutored.usage.input],
    ["check", "1번 3) 요지 고르기", ["질문이 무엇을 묻는지 보세요.", "글 전체의 중심 생각을 찾아요."], [{ en: "gauge", ko: "측정하다" }, { en: "absorption", ko: "흡수" }], true, "첫 줄 해석\n둘째 줄 해석", "claude-sonnet-5-5", 100],
    "tutor result cleaned: " + JSON.stringify(tutored),
  );
  const tutorSent = calls[0].body;
  assert.equal(tutorSent.model, "claude-sonnet-5-5", "tutor uses sonnet by default");
  assert(tutorSent.messages[0].content[0].type === "image" && tutorSent.messages[0].content[0].source.media_type === "image/png", "tutor sends the image");
  assert(tutorSent.messages[0].content[1].text.includes("표시한 답") && tutorSent.messages[0].content[1].text.includes("3번이 왜 3번이에요?"), "tutor prompt: " + tutorSent.messages[0].content[1].text);
  assert(tutorSent.system.includes("tutor") && tutorSent.output_config.format.schema.required.includes("answer") && tutorSent.output_config.effort === "medium", "tutor schema/effort");
  await worker.fetch(req("/tutor", { body: { image: "aGVsbG8=", kind: "weird" } }), env);
  assert(calls[1].body.messages[0].content[1].text.includes("단계별로 설명") && (await (await worker.fetch(req("/tutor", { body: { image: "aGVsbG8=", kind: "weird" } }), env)).json()).kind === "explain", "unknown kind falls back to explain");
  await worker.fetch(req("/tutor", { body: { image: "aGVsbG8=", kind: "translate" } }), { ...env, TUTOR_MODEL: "claude-opus-5-5" });
  assert.equal(calls[calls.length - 1].body.model, "claude-opus-5-5", "TUTOR_MODEL overrides");
  upstream = okResponse;

  // fallbacks unsupported (400) → retried without
  calls.length = 0;
  upstream = (body) =>
    body.fallbacks
      ? { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "fallbacks: unsupported" } } }
      : okResponse(body);
  res = await worker.fetch(req("/ping", { body: {} }), env);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.fallbacks, undefined);
  assert.equal(calls[1].headers["anthropic-beta"], undefined);

  // upstream error mapping (never exposes 401 as app passcode failure)
  const upstreamCase = async (status, type, expect, includes) => {
    upstream = () => ({ status, json: { type: "error", error: { type, message: "upstream says " + status } } });
    const r = await worker.fetch(req("/ping", { body: {} }), env);
    assert.equal(r.status, expect, `upstream ${status} → ${expect}`);
    const j = await r.json();
    assert(j.message.includes(includes), `message for ${status}: ${j.message}`);
    assert.equal(j.upstreamStatus, status);
  };
  await upstreamCase(401, "authentication_error", 502, "Anthropic API 키");
  await upstreamCase(403, "permission_error", 502, "권한");
  await upstreamCase(404, "not_found_error", 502, "모델");
  await upstreamCase(413, "invalid_request_error", 413, "사진이 너무");
  await upstreamCase(429, "rate_limit_error", 429, "한도");
  await upstreamCase(529, "overloaded_error", 503, "혼잡");
  await upstreamCase(500, "api_error", 503, "혼잡");
  await upstreamCase(400, "invalid_request_error", 502, "upstream says 400");

  // specific Anthropic 400s get actionable guidance; optional workspace header
  upstream = () => ({ status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } } });
  res = await worker.fetch(req("/ping", { body: {} }), env);
  assert.equal(res.status, 402);
  assert((await res.json()).message.includes("크레딧"));
  upstream = () => ({ status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "anthropic-workspace-id is required when authenticating with an identity-linked API key" } } });
  res = await worker.fetch(req("/ping", { body: {} }), env);
  assert.equal(res.status, 502);
  assert((await res.json()).message.includes("워크스페이스"));
  upstream = okResponse;
  calls.length = 0;
  await worker.fetch(req("/ping", { body: {} }), { ...env, ANTHROPIC_WORKSPACE_ID: "wrkspc_123" });
  assert.equal(calls[0].headers["anthropic-workspace-id"], "wrkspc_123", "workspace header forwarded");
  calls.length = 0;
  await worker.fetch(req("/ping", { body: {} }), env);
  assert.equal(calls[0].headers["anthropic-workspace-id"], undefined, "no workspace header by default");

  // stop reasons and bad payloads
  const recognizeCase = async (json, expect, includes) => {
    upstream = (body) => ({ status: 200, json: { model: body.model, usage: {}, ...json } });
    const r = await worker.fetch(req("/recognize", { body: { image: "aGVsbG8=" } }), env);
    assert.equal(r.status, expect, `recognize case → ${expect}`);
    const j = await r.json();
    assert(j.message.includes(includes), j.message);
  };
  await recognizeCase({ stop_reason: "refusal", content: [] }, 422, "거부");
  await recognizeCase({ stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] }, 422, "잘렸");
  await recognizeCase({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }, 502, "해석");
  await recognizeCase(
    { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ words: [], note: "사진이 흐립니다" }) }] },
    422,
    "흐립니다",
  );

  // Durable Object relay: Worker forwards through env.RELAY (pinned to North America); the object forwards to Anthropic
  upstream = okResponse;
  const relayCalls = [];
  const relayObject = new AnthropicRelay({}, env);
  const RELAY = {
    idFromName: (name) => "id:" + name,
    get: (id, opts) => {
      relayCalls.push({ id, opts });
      return { fetch: (url, init) => relayObject.fetch(new Request(url, init)) };
    },
  };
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const headers = Object.fromEntries(new Headers(init.headers));
    const body = JSON.parse(init.body);
    seen.push({ url: String(url), headers, body });
    const r = okResponse(body);
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  };
  res = await worker.fetch(req("/ping", { body: {} }), { ...env, RELAY });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, model: "claude-opus-5-5" });
  assert.equal(relayCalls.length, 1, "relay used once");
  assert.equal(relayCalls[0].opts.locationHint, "wnam", "relay pinned to North America");
  assert.equal(seen.length, 1, "one upstream call via relay");
  assert.equal(seen[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(seen[0].headers["x-api-key"], "sk-ant-test", "relay forwards the key header");
  assert.equal(seen[0].headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.equal(seen[0].headers["x-app-passcode"], undefined, "relay never forwards the passcode");
  assert.equal(seen[0].body.model, "claude-opus-5-5");
  // relay failure falls back to a direct call
  seen.length = 0;
  res = await worker.fetch(req("/ping", { body: {} }), { ...env, RELAY: { idFromName: () => "x", get: () => ({ fetch: async () => { throw new Error("relay down"); } }) } });
  assert.equal(res.status, 200, "falls back to direct fetch when relay fails");
  assert.equal(seen.length, 1);
  // region block from Anthropic is reported as temporary (503), not as a key problem
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { type: "forbidden", message: "Request not allowed" } }), { status: 403, headers: { "content-type": "application/json" } });
  res = await worker.fetch(req("/ping", { body: {} }), env);
  assert.equal(res.status, 503);
  assert((await res.json()).message.includes("지역"));
  // diag route needs no passcode and reports upstream status
  globalThis.fetch = async () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401, headers: { "content-type": "application/json" } });
  res = await worker.fetch(new Request("https://ai.example.workers.dev/diag"), env);
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.upstreamStatus, 401);
  assert.equal(d.ok, true);
  assert.equal(d.relay, false);

  // network failure / timeout
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  res = await worker.fetch(req("/ping", { body: {} }), env);
  assert.equal(res.status, 504);
  assert.equal((await res.json()).error, "upstream_unreachable");
  globalThis.fetch = async () => {
    throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
  };
  res = await worker.fetch(req("/recognize", { body: { image: "aGVsbG8=" } }), env);
  assert.equal(res.status, 504);
  assert.equal((await res.json()).error, "upstream_timeout");

  // ---- 가족 기록함: /sync(가족·보호자 코드) → FamilyStore(Durable Object), /family(보호자 코드만) ----
  // Anthropic은 부르지 않는다(지금 globalThis.fetch 는 던지는 상태 그대로 둔다).
  const familyStorage = () => {
    const m = new Map();
    const copy = (v) => structuredClone(v);
    return {
      async get(k) {
        if (Array.isArray(k)) return new Map(k.filter((x) => m.has(x)).map((x) => [x, copy(m.get(x))])); // 여러 키: 있는 것만 Map
        return m.has(k) ? copy(m.get(k)) : undefined;
      },
      async put(k, v) {
        if (typeof k === "object") for (const [a, b] of Object.entries(k)) m.set(a, copy(b));
        else m.set(k, copy(v));
      },
      async delete(k) {
        if (Array.isArray(k)) return k.filter((x) => m.delete(x)).length;
        return m.delete(k);
      },
      async list({ prefix = "", start, end, reverse = false, limit } = {}) {
        // Durable Object storage.list 와 같은 뜻: start 포함·end 미포함, reverse 는 순서만 바꾼다(limit 는 그 순서로)
        let keys = [...m.keys()].filter((k) => k.startsWith(prefix) && (start === undefined || k >= start) && (end === undefined || k < end)).sort();
        if (reverse) keys.reverse();
        if (limit) keys = keys.slice(0, limit);
        return new Map(keys.map((k) => [k, copy(m.get(k))]));
      },
    };
  };
  const familyObject = new FamilyStore({ storage: familyStorage() }, { ...env, PARENT_PASSCODE: "parent-9999" });
  const FAMILY = { idFromName: (n) => "id:" + n, get: () => ({ fetch: (u, init) => familyObject.fetch(new Request(u, init)) }) };
  const fenv = { ...env, PARENT_PASSCODE: "parent-9999", FAMILY };
  const PARENT = { passcode: "parent-9999" };
  const child = { id: "11111111-2222-4333-8444-555555555555", name: " 하늘 " };
  const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const rec = (id, completedAt, extra = {}) => ({
    id, setName: "DAY04", mode: "en_ko", range: "121~130번", startedAt: completedAt, completedAt, total: 10, correct: 7, partial: false, activeMs: 65000,
    missed: [{ en: " authority ", ko: "권위", unknown: true }, { en: "devote", ko: "바치다" }, { en: "", ko: "x" }],
    ...extra,
  });
  const familyCase = async (p, opts, expect, includes) => {
    const r = await worker.fetch(req(p, opts), opts.env || fenv);
    assert.equal(r.status, expect, `${opts.method || "POST"} ${p} → ${expect}`);
    const j = await r.json();
    if (includes) assert(JSON.stringify(j).includes(includes), `${p}: ${JSON.stringify(j)}`);
    return j;
  };
  res = await worker.fetch(req("/family", { method: "OPTIONS" }), fenv);
  assert(res.headers.get("access-control-allow-methods").includes("DELETE"), "CORS allows GET/DELETE for the family routes");
  // 바인딩·코드·설정
  await familyCase("/sync", { body: { child }, env: { ...env } }, 500, "가족 기록함");
  await familyCase("/sync", { body: { child }, passcode: "nope" }, 401);
  await familyCase("/sync", { body: { child }, origin: "https://evil.example" }, 403);
  await familyCase("/sync", { body: { child }, env: { ...fenv, APP_PASSCODE: "" } }, 500, "APP_PASSCODE");
  await familyCase("/family", { method: "GET" }, 401, "보호자 코드"); // 가족 코드로는 읽을 수 없다
  await familyCase("/family", { method: "GET", ...PARENT, env: { ...fenv, PARENT_PASSCODE: "" } }, 500, "PARENT_PASSCODE");
  await familyCase("/family", { method: "POST", ...PARENT, body: {} }, 404);
  await familyCase("/sync", { method: "GET" }, 404);
  await familyCase("/family/short", { method: "GET", ...PARENT }, 404, "not_found");
  // 검증(하나라도 틀리면 전체 거절)
  await familyCase("/sync", { body: { child: { id: "short", name: "a" } } }, 400, "child.id");
  await familyCase("/sync", { body: { child: { ...child, name: "  " } } }, 400, "이름");
  await familyCase("/sync", { body: { child: { ...child, name: "가".repeat(21) } } }, 400, "20자");
  await familyCase("/sync", { body: { child, records: Array.from({ length: 101 }, (_, i) => rec("r" + i, hoursAgo(1))) } }, 400, "100개");
  await familyCase("/sync", { body: { child, records: [rec("bad", "not-a-date")] } }, 400, "시각");
  await familyCase("/sync", { body: { child, records: [rec("bad", hoursAgo(1), { correct: 11 })] } }, 400, "점수");
  await familyCase("/sync", { body: { child, records: [rec("bad", hoursAgo(1), { total: 0 })] } }, 400, "점수");
  await familyCase("/sync", { body: { child, records: [rec("bad", hoursAgo(1), { mode: "x" })] } }, 400, "시험 방식");
  await familyCase("/sync", { body: { child, records: [rec("bad id!", hoursAgo(1))] } }, 400, "기록 id");
  await familyCase("/sync", { body: { child, records: [rec("bad", hoursAgo(1), { missed: Array(201).fill({ en: "a", ko: "b" }) })] } }, 400, "틀린 단어");
  await familyCase("/sync", { body: { child, sets: "nope" } }, 400, "세트");
  await familyCase("/sync", { raw: "{" }, 400);
  await familyCase("/sync", { raw: JSON.stringify({ child, pad: "x".repeat(256 * 1024) }) }, 413);
  // 아이 등록만(기록 0개) → 목록에 나타난다
  data = await familyCase("/sync", { body: { child, sets: [{ name: "DAY04", count: 40 }, { name: "", count: 3 }] } }, 200);
  assert.deepEqual([data.ok, data.stored, data.trimmed], [true, 0, 0]);
  data = await familyCase("/family", { method: "GET", ...PARENT }, 200);
  assert.equal(data.children.length, 1);
  assert.equal(data.children[0].name, "하늘", "name trimmed");
  assert.deepEqual(data.children[0].sets, [{ name: "DAY04", count: 40 }]);
  assert.deepEqual(data.children[0].records, []);
  assert.equal(data.children[0].lastTestAt, null);
  // 기록 저장 → 최신순, 틀린 단어 정리, 14일 요약
  const r1 = rec("r1", hoursAgo(1)), r2 = rec("r2", hoursAgo(25), { partial: true, total: 5, correct: 3 });
  data = await familyCase("/sync", { body: { child, records: [r2, r1] } }, 200);
  assert.equal(data.stored, 2);
  data = await familyCase("/family", { method: "GET", ...PARENT }, 200);
  let c = data.children[0];
  assert.equal(c.lastTestAt, r1.completedAt);
  assert.deepEqual(c.sets, [{ name: "DAY04", count: 40 }], "sets kept when omitted");
  assert.deepEqual(c.records.map((r) => r.id), ["r1", "r2"], "newest first");
  assert.deepEqual(c.records[0].missed, [{ en: "authority", ko: "권위", unknown: true }, { en: "devote", ko: "바치다" }]);
  assert.equal(c.records[1].partial, true);
  assert.equal(c.records[0].activeMs, 65000);
  assert(typeof c.records[0].receivedAt === "string");
  const recent = Array.from({ length: 25 }, (_, i) => rec("recent" + i, hoursAgo(2 + i)));
  data = await familyCase("/sync", { body: { child, records: [...recent, rec("old", hoursAgo(24 * 30))] } }, 200);
  assert.equal(data.stored, 26);
  data = await familyCase("/family", { method: "GET", ...PARENT }, 200);
  c = data.children[0];
  assert.equal(c.records.length, 27, "summary = last 14 days when that is 20+ records");
  assert(!c.records.some((r) => r.id === "old"), "30-day-old record not in summary");
  assert.equal(c.records[0].id, "r1");
  data = await familyCase("/family/" + child.id, { method: "GET", ...PARENT }, 200);
  assert.equal(data.child.name, "하늘");
  assert.equal(data.records.length, 27, "detail = last 30 days by default");
  assert(!data.records.some((r) => r.id === "old") && data.records[0].id === "r1", "30-day-old record left for ‘more’, newest first");
  assert.deepEqual([data.recordCount, data.more], [28, true], "recordCount = every record, more = older ones exist");
  assert(Array.isArray(data.questions) && data.today && typeof data.today.date === "string", "questions and today unchanged");
  data = await familyCase("/family/" + child.id + "?days=31", { method: "GET", ...PARENT }, 200);
  assert.deepEqual([data.records.length, data.records[27].id, data.more], [28, "old", false], "days=31 reaches the old record, nothing more");
  data = await familyCase("/family/" + child.id + "?days=365&limit=5", { method: "GET", ...PARENT }, 200);
  assert.deepEqual([data.records.map((r) => r.id), data.recordCount, data.more], [["r1", "recent0", "recent1", "recent2", "recent3"], 28, true], "limit keeps the newest");
  for (const bad of ["days=0", "days=366", "days=abc", "days=1.5", "limit=0", "limit=501", "limit=-1", "limit=x"])
    await familyCase("/family/" + child.id + "?" + bad, { method: "GET", ...PARENT }, 400, bad.split("=")[0]);
  // GET /family?days=1~30 (기본 14): 아이별 요약 기록 창
  data = await familyCase("/family?days=1", { method: "GET", ...PARENT }, 200);
  assert(data.children[0].records.length >= 20 && data.children[0].records.length < 27 && data.children[0].records.every((r) => Date.parse(r.completedAt) > Date.now() - 86400000), "1-day window");
  data = await familyCase("/family?days=30", { method: "GET", ...PARENT }, 200);
  assert.equal(data.children[0].records.length, 27, "30-day window");
  assert.equal(data.children[0].recordCount, 28, "list shows the exact count too");
  await familyCase("/family?days=31", { method: "GET", ...PARENT }, 400, "days");
  await familyCase("/family?days=0", { method: "GET", ...PARENT }, 400, "days");
  // 같은 기록을 다시 보내면 덮어쓴다(중복 없음, 개수도 그대로)
  await familyCase("/sync", { body: { child, records: [rec("r1", r1.completedAt, { correct: 9 }), rec("r1b", hoursAgo(0.5))] } }, 200);
  data = await familyCase("/family/" + child.id + "?days=365", { method: "GET", ...PARENT }, 200);
  assert.equal(data.records.length, 29, "resend does not duplicate");
  assert.equal(data.recordCount, 29, "resend is not counted again, the new record is");
  assert.equal(data.records.find((r) => r.id === "r1").correct, 9, "resend overwrites");
  // ‘더 보기’ 페이지(보호자 코드만): before 이전(미포함) 최신순
  const page1 = await familyCase("/family/" + child.id + "/records?limit=10", { method: "GET", ...PARENT }, 200);
  assert.deepEqual([page1.records.length, page1.records[0].id, page1.more], [10, "r1b", true], "first page from the newest");
  assert(typeof page1.serverTime === "string", "serverTime on pages");
  const page2 = await familyCase("/family/" + child.id + "/records?before=" + encodeURIComponent(page1.records[9].completedAt) + "&limit=10", { method: "GET", ...PARENT }, 200);
  const page3 = await familyCase("/family/" + child.id + "/records?before=" + encodeURIComponent(page2.records[9].completedAt) + "&limit=10", { method: "GET", ...PARENT }, 200);
  const paged = [...page1.records, ...page2.records, ...page3.records].map((r) => r.id);
  assert.deepEqual([page2.more, page3.records.length, page3.more, new Set(paged).size, paged[28]], [true, 9, false, 29, "old"], "pages continue without overlap: " + paged.join(","));
  data = await familyCase("/family/" + child.id + "/records", { method: "GET", ...PARENT }, 200);
  assert.deepEqual([data.records.length, data.more], [29, false], "default page size 100");
  await familyCase("/family/" + child.id + "/records", { method: "GET" }, 401, "보호자 코드"); // 가족 코드로는 읽을 수 없다
  await familyCase("/family/" + child.id + "/records", { body: {}, ...PARENT }, 404, "not_found");
  await familyCase("/family/99999999-aaaa-4bbb-8ccc-dddddddddddd/records", { method: "GET", ...PARENT }, 404, "unknown_child");
  await familyCase("/family/" + child.id + "/records?before=nope", { method: "GET", ...PARENT }, 400, "before");
  await familyCase("/family/" + child.id + "/records?limit=0", { method: "GET", ...PARENT }, 400, "limit");
  await familyCase("/family/" + child.id + "/records?limit=501", { method: "GET", ...PARENT }, 400, "limit");
  // 옛 대략값 recordCount(다시 보낸 기록까지 셈)는 상세를 처음 볼 때 한 번 실제로 센다
  await familyObject.storage.put("child:" + child.id, { ...(await familyObject.storage.get("child:" + child.id)), recordCount: 57, recordCountExact: undefined });
  data = await familyCase("/family/" + child.id, { method: "GET", ...PARENT }, 200);
  assert.equal(data.recordCount, 29, "legacy approximate count recounted");
  assert.equal((await familyObject.storage.get("child:" + child.id)).recordCountExact, true, "recount remembered");
  // 보호자 코드는 /sync 에도, AI 요청에도 통한다
  await familyCase("/sync", { body: { child }, ...PARENT }, 200);
  globalThis.fetch = async (url, init) => {
    const r = okResponse(JSON.parse(init.body));
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  };
  res = await worker.fetch(req("/ping", { body: {}, ...PARENT }), fenv);
  assert.equal(res.status, 200, "parent code accepted for AI routes");
  res = await worker.fetch(req("/ping", { body: {}, ...PARENT }), env);
  assert.equal(res.status, 401, "parent code unknown when PARENT_PASSCODE is unset");
  // 모르는 아이, 요청 제한 버킷, 저장소 장애
  await familyCase("/family/99999999-aaaa-4bbb-8ccc-dddddddddddd", { method: "GET", ...PARENT }, 404, "unknown_child");
  await familyCase("/family/99999999-aaaa-4bbb-8ccc-dddddddddddd", { method: "DELETE", ...PARENT }, 404, "unknown_child");
  limiter.keys.length = 0;
  limiter.allow = true;
  await familyCase("/sync", { body: { child }, env: { ...fenv, RATE_LIMITER: limiter } }, 200);
  await familyCase("/family/" + child.id, { method: "GET", ...PARENT, env: { ...fenv, RATE_LIMITER: limiter } }, 200);
  await familyCase("/family/" + child.id + "/records", { method: "GET", ...PARENT, env: { ...fenv, RATE_LIMITER: limiter } }, 200);
  assert(limiter.keys[0].startsWith("/sync:") && limiter.keys[1].startsWith("/family:") && limiter.keys[2].startsWith("/family:"), "family rate-limit buckets (pages share /family): " + limiter.keys.join(","));
  limiter.allow = false;
  await familyCase("/sync", { body: { child }, env: { ...fenv, RATE_LIMITER: limiter } }, 429);
  limiter.allow = true;
  await familyCase("/sync", { body: { child }, env: { ...fenv, FAMILY: { idFromName: () => "x", get: () => ({ fetch: async () => { throw Error("down"); } }) } } }, 503, "가족 기록함");
  // 상한: 아이당 5,000개를 넘으면 오래된 것부터 지운다
  let lastTrim = 0;
  for (let b = 0; b < 51; b++) {
    const bulk = Array.from({ length: 100 }, (_, i) => rec("bulk" + (b * 100 + i), hoursAgo(2000 + b * 100 + i)));
    const j = await familyCase("/sync", { body: { child, records: bulk } }, 200);
    lastTrim = j.trimmed;
  }
  assert(lastTrim > 0, "last bulk sync trimmed old records");
  // 기록 5,000개 아이의 상세 첫 응답은 200개 이하(보호자 앱이 받는 양), 전체 수는 recordCount
  data = await familyCase("/family/" + child.id, { method: "GET", ...PARENT }, 200);
  assert(data.records.length <= 200 && data.recordCount === 5000 && data.more === true, `detail of a 5,000-record child: ${data.records.length} records, recordCount ${data.recordCount}`);
  data = await familyCase("/family/" + child.id + "?days=365", { method: "GET", ...PARENT }, 200);
  assert.deepEqual([data.records.length, data.recordCount, data.more], [200, 5000, true], "a year of records is still capped at limit 200");
  // ‘더 보기’ 페이지로 끝까지 받으면 정확히 5,000개(겹침 없음): 오래된 bulk 는 지워지고 최근 것은 남는다
  const everything = [];
  let cursor = "", pages = 0, more = true;
  while (more && pages < 20) {
    const p = await familyCase("/family/" + child.id + "/records?limit=500" + (cursor ? "&before=" + encodeURIComponent(cursor) : ""), { method: "GET", ...PARENT }, 200);
    everything.push(...p.records);
    cursor = p.records[p.records.length - 1].completedAt;
    more = p.more;
    pages++;
  }
  assert.equal(everything.length, 5000, "capped at 5000 records per child");
  assert.equal(new Set(everything.map((r) => r.id)).size, 5000, "pages never overlap");
  assert(everything.some((r) => r.id === "old") && !everything.some((r) => r.id === "bulk5099"), "oldest bulk records dropped, newer kept");
  // 삭제(보호자만) → 목록에서 사라진다
  await familyCase("/family/" + child.id, { method: "DELETE" }, 401);
  data = await familyCase("/family/" + child.id, { method: "DELETE", ...PARENT }, 200);
  assert.equal(data.deleted, 5000);
  data = await familyCase("/family", { method: "GET", ...PARENT }, 200);
  assert.deepEqual(data.children, []);
  // 지운 아이 id로 온 기기의 /sync 는 404 unknown_child(되살리지 않음). 모르는 새 아이는 옛 앱 호환으로 그대로 만든다(아래 kid).
  await familyCase("/sync", { body: { child, records: [rec("ghost", hoursAgo(1))] } }, 404, "unknown_child");
  await familyCase("/settings/" + child.id, { method: "GET" }, 404, "unknown_child");
  data = await familyCase("/family", { method: "GET", ...PARENT }, 200);
  assert.deepEqual(data.children, [], "a deleted child is not re-created by a device sync");

  // ---- 오늘의 단어: 계획(plan)·교재 앵커·생성(복습+새 단어, 제외 규칙, 재요청)·완료 표시·크론 ----
  const kid = { id: "22222222-3333-4444-8555-666666666666", name: "한결" };
  const kstDate = (offsetDays = 0) => new Date(Date.now() + 9 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10);
  const today = kstDate(0), tomorrow = kstDate(1), day3 = kstDate(2), day4 = kstDate(3);
  const anthropicCalls = [];
  const candidateQueue = [];
  const define = (en) => ({ english: en, ipa: "ˈ" + en, korean: en + "의 뜻", aliases: [en + "뜻", en + "뜻2"] });
  const dailyMock = async (url, init) => {
    const body = JSON.parse(init.body);
    anthropicCalls.push(body);
    const content = body.messages[0].content;
    const review = (/복습 단어\(그대로 정의\): ([^\n]+)/.exec(content)?.[1] || "").split(",").map((s) => s.trim()).filter(Boolean);
    const count = Number(/새 단어 (\d+)개/.exec(content)?.[1] || 0);
    const letters = "abcdefghijklmnopqrstuvwxyz";
    const fresh = candidateQueue.length ? candidateQueue.shift() : Array.from({ length: count }, (_, i) => "auto" + letters[anthropicCalls.length % 26] + letters[i % 26]); // 숫자 없는 가짜 단어(WORD_PATTERN 통과)
    const payload = { words: [...review.map(define), ...fresh.map(define)], note: "" };
    return new Response(
      JSON.stringify({ model: body.model, stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: JSON.stringify(payload) }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  globalThis.fetch = dailyMock;
  // 아이 등록 + 교재 앵커 + 틀린 단어가 있는 기록
  await familyCase("/sync", {
    body: {
      child: kid,
      sets: [{ name: "중등 DAY05", count: 40 }],
      anchor: { setName: "중등 DAY05", words: ["authority", "devote", " evident ", "bad word!!", "authority"] },
      records: [rec("k1", hoursAgo(5), { missed: [{ en: "linger", ko: "남다" }, { en: "glimpse", ko: "흘끗 봄", unknown: true }] })],
    },
  }, 200);
  data = await familyCase("/family/" + kid.id, { method: "GET", ...PARENT }, 200);
  assert.deepEqual(data.child.anchor.words, ["authority", "devote", "evident"], "anchor cleaned and deduped");
  assert.equal(data.child.anchor.setName, "중등 DAY05");
  assert.deepEqual(data.child.plan, { enabled: false, level: "중2 상위권", dailyCount: 10, hour: 16, timeLimitSec: 0, setsLocked: false }, "default plan");
  assert.equal(data.today.exists, false);
  await familyCase("/sync", { body: { child: kid, anchor: { words: "nope" } } }, 400, "anchor");
  // 빈 앵커(기기에 손대지 않은 예제 세트뿐)는 저장된 수준 기준을 지우고, 앵커를 아예 안 보내면 그대로 둔다
  await familyCase("/sync", { body: { child: kid, anchor: { setName: "", words: [] } } }, 200);
  data = await familyCase("/family/" + kid.id, { method: "GET", ...PARENT }, 200);
  assert.equal(data.child.anchor, undefined, "empty anchor clears the stored anchor");
  await familyCase("/sync", { body: { child: kid, anchor: { setName: "중등 DAY05", words: ["authority", "devote", "evident"] } } }, 200);
  await familyCase("/sync", { body: { child: kid } }, 200);
  data = await familyCase("/family/" + kid.id, { method: "GET", ...PARENT }, 200);
  assert.deepEqual(data.child.anchor.words, ["authority", "devote", "evident"], "anchor kept when a sync carries none");
  // 계획이 꺼져 있으면 409
  await familyCase("/daily/" + kid.id, { method: "GET" }, 409, "plan_disabled");
  await familyCase("/daily/" + kid.id, { body: {} }, 409, "plan_disabled");
  // 계획 저장: 보호자만, 검증
  await familyCase("/family/" + kid.id + "/plan", { body: { enabled: true } }, 401, "보호자 코드");
  await familyCase("/family/" + kid.id + "/plan", { ...PARENT, body: { dailyCount: 30 } }, 400, "5~20");
  await familyCase("/family/" + kid.id + "/plan", { ...PARENT, body: { hour: 24 } }, 400, "0~23");
  await familyCase("/family/" + kid.id + "/plan", { ...PARENT, body: { level: "  " } }, 400, "수준");
  await familyCase("/family/" + kid.id + "/plan", { ...PARENT, body: { enabled: "yes" } }, 400, "enabled");
  await familyCase("/family/99999999-aaaa-4bbb-8ccc-dddddddddddd/plan", { ...PARENT, body: { enabled: true } }, 404, "unknown_child");
  data = await familyCase("/family/" + kid.id + "/plan", { ...PARENT, body: { enabled: true, dailyCount: 5, level: " 고1·수능 기초 " } }, 200);
  assert.deepEqual([data.child.plan.enabled, data.child.plan.dailyCount, data.child.plan.level, data.child.plan.hour], [true, 5, "고1·수능 기초", 16]);
  // 문제당 제한 시간: 0(없음) 또는 5~120초. 아이 기기는 GET /settings 로 받아 간다(가족 코드).
  await familyCase("/family/" + kid.id + "/plan", { ...PARENT, body: { timeLimitSec: 3 } }, 400, "5~120");
  await familyCase("/family/" + kid.id + "/plan", { ...PARENT, body: { timeLimitSec: 200 } }, 400, "5~120");
  await familyCase("/family/" + kid.id + "/plan", { ...PARENT, body: { timeLimitSec: "15" } }, 400, "5~120");
  data = await familyCase("/family/" + kid.id + "/plan", { ...PARENT, body: { timeLimitSec: 15 } }, 200);
  assert.equal(data.child.plan.timeLimitSec, 15);
  assert.equal(data.child.plan.dailyCount, 5, "other plan fields kept");
  data = await familyCase("/settings/" + kid.id, { method: "GET" }, 200);
  assert.deepEqual(data, { childId: kid.id, name: "한결", timeLimitSec: 15, setsLocked: false }, "settings for the device");
  await familyCase("/settings/99999999-aaaa-4bbb-8ccc-dddddddddddd", { method: "GET" }, 404, "unknown_child");
  await familyCase("/settings/" + kid.id, { method: "GET", passcode: "nope" }, 401);
  await familyCase("/settings/" + kid.id, { method: "POST", body: {} }, 404);
  // 세트 수정 잠금: true/false 만 받고 다른 계획 항목은 그대로. 아이 기기는 /settings 로 받아 간다.
  await familyCase("/family/" + kid.id + "/plan", { ...PARENT, body: { setsLocked: "yes" } }, 400, "true 또는 false");
  data = await familyCase("/family/" + kid.id + "/plan", { ...PARENT, body: { setsLocked: true } }, 200);
  assert.deepEqual([data.child.plan.setsLocked, data.child.plan.timeLimitSec, data.child.plan.dailyCount], [true, 15, 5], "lock stored without touching the other plan fields");
  data = await familyCase("/settings/" + kid.id, { method: "GET" }, 200);
  assert.deepEqual(data, { childId: kid.id, name: "한결", timeLimitSec: 15, setsLocked: true }, "settings carry the lock to the device");
  data = await familyCase("/family/" + kid.id + "/plan", { ...PARENT, body: { setsLocked: false } }, 200);
  assert.equal(data.child.plan.setsLocked, false, "lock released");
  await familyCase("/sync", { body: { child: kid, records: [rec("kt", hoursAgo(0.2), { total: 4, correct: 2, timeouts: 2, missed: [] })] } }, 200);
  data = await familyCase("/family/" + kid.id, { method: "GET", ...PARENT }, 200);
  assert.equal(data.records.find((r) => r.id === "kt").timeouts, 2, "timeouts kept on the record");
  await familyCase("/family/" + kid.id + "/plan", { ...PARENT, body: { timeLimitSec: 0 } }, 200);
  assert.equal(anthropicCalls.length, 0, "no Claude call so far");
  // 아직 없음 → 404 no_daily (옛 Worker의 not_found 와 구분)
  await familyCase("/daily/" + kid.id, { method: "GET" }, 404, "no_daily");
  // 생성: 복습 2개(linger, glimpse) + 새 단어 3개. 앵커(authority, devote)는 걸러진다.
  candidateQueue.push(["authority", "devote", "verdict", "thrive", "plead", "subtle"]);
  data = await familyCase("/daily/" + kid.id, { body: {} }, 200);
  assert.equal(anthropicCalls.length, 1, "one Claude call when candidates suffice");
  assert.equal(anthropicCalls[0].model, "claude-sonnet-5-5", "daily model default");
  assert(anthropicCalls[0].system.includes("daily English vocabulary quiz"), "daily prompt");
  assert.equal(anthropicCalls[0].output_config.format.type, "json_schema");
  const sentContent = anthropicCalls[0].messages[0].content;
  assert(
    sentContent.includes("학생 수준: 고1·수능 기초") && sentContent.includes("authority, devote, evident") &&
      sentContent.includes("복습 단어(그대로 정의): linger, glimpse") && sentContent.includes("새 단어 6개"),
    "prompt content: " + sentContent,
  );
  assert.equal(data.date, today);
  assert.deepEqual(data.words.map((w) => w.en), ["linger", "glimpse", "verdict", "thrive", "plead"], "review first, anchor words filtered");
  assert.deepEqual(data.words.map((w) => w.kind), ["review", "review", "new", "new", "new"]);
  assert.deepEqual(data.words.map((w) => w.id), [1, 2, 3, 4, 5]);
  assert.equal(data.words[0].ko, "linger의 뜻", "review word defined by the model");
  assert.deepEqual(data.words[2].aliases, ["verdict뜻", "verdict뜻2"]);
  assert.equal(data.level, "고1·수능 기초");
  assert.equal(data.model, "claude-sonnet-5-5");
  assert.equal(data.completed, undefined);
  // 같은 날 다시 요청하면 만들지 않고 그대로, 보호자 코드로 조회도 된다
  await familyCase("/daily/" + kid.id, { body: {} }, 200);
  assert.equal(anthropicCalls.length, 1, "no second generation for the same day");
  data = await familyCase("/daily/" + kid.id + "?date=" + today, { method: "GET", ...PARENT }, 200);
  assert.equal(data.words.length, 5);
  data = await familyCase("/family", { method: "GET", ...PARENT }, 200);
  let k = data.children.find((c) => c.id === kid.id);
  assert.deepEqual([k.today.exists, k.today.count, k.today.completed, k.plan.dailyCount], [true, 5, null, 5]);
  // 완료 표시: daily 날짜가 붙은 기록(중단 기록은 완료로 치지 않는다)
  const k2At = hoursAgo(0.5);
  await familyCase("/sync", { body: { child: kid, records: [rec("k2p", hoursAgo(0.7), { total: 2, correct: 1, partial: true, daily: today, missed: [] })] } }, 200);
  data = await familyCase("/family", { method: "GET", ...PARENT }, 200);
  assert.equal(data.children.find((c) => c.id === kid.id).today.completed, null, "partial record does not complete the daily quiz");
  await familyCase("/sync", { body: { child: kid, records: [rec("k2", k2At, { total: 5, correct: 4, daily: today, missed: [{ en: "plead", ko: "plead의 뜻" }] })] } }, 200);
  data = await familyCase("/family", { method: "GET", ...PARENT }, 200);
  assert.deepEqual(data.children.find((c) => c.id === kid.id).today.completed, { recordId: "k2", correct: 4, total: 5, completedAt: k2At });
  data = await familyCase("/family/" + kid.id, { method: "GET", ...PARENT }, 200);
  assert.equal(data.today.words.length, 5);
  assert.equal(data.today.completed.correct, 4);
  assert.equal(data.records.find((r) => r.id === "k2").daily, today, "daily date kept on the record");
  // 다음 날: 복습은 최신 틀린 단어부터 3개, 이미 낸 단어(verdict, thrive)는 걸러지고 모자라면 한 번 더 요청한다
  candidateQueue.push(["verdict", "thrive", "plead", "wither"], ["forge", "ample", "dwell", "exert"]);
  anthropicCalls.length = 0;
  data = await familyCase("/daily/" + kid.id, { body: { date: tomorrow } }, 200);
  assert.equal(anthropicCalls.length, 2, "second call when the first batch was mostly used words");
  assert(anthropicCalls[0].messages[0].content.includes("새 단어 4개"), "first call asks 2× the need");
  assert(anthropicCalls[1].messages[0].content.includes("새 단어 2개"), "retry asks 2× the remaining need");
  assert(anthropicCalls[1].messages[0].content.includes("wither"), "already picked words are excluded in the retry");
  assert(anthropicCalls[0].messages[0].content.includes("최근에 이미 낸 단어(제외): "), "served words sent as avoid list");
  assert.deepEqual(data.words.map((w) => w.en), ["plead", "linger", "glimpse", "wither", "forge"], "review newest-first then new words");
  assert.deepEqual(data.words.map((w) => w.kind), ["review", "review", "review", "new", "new"]);
  // 거부 → 422 (저장되지 않음)
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ model: "m", stop_reason: "refusal", usage: {}, content: [] }), { status: 200, headers: { "content-type": "application/json" } });
  await familyCase("/daily/" + kid.id, { body: { date: day3 } }, 422, "거부");
  await familyCase("/daily/" + kid.id + "?date=" + day3, { method: "GET" }, 404, "no_daily");
  // 크론: 계획 시각(16시 KST)이 지나면 1회 생성, 다시 돌려도 중복 없음, 시각 전이면 생성 안 함, 계획 꺼진 아이는 건너뜀
  globalThis.fetch = dailyMock;
  anthropicCalls.length = 0;
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  const runCron = async (iso) => {
    pending.length = 0;
    await worker.scheduled({ scheduledTime: Date.parse(iso) }, fenv, ctx);
    await Promise.all(pending);
  };
  await runCron(day3 + "T07:00:00Z"); // 16:00 KST
  assert.equal(anthropicCalls.length, 1, "cron generated once for the enabled child");
  data = await familyCase("/daily/" + kid.id + "?date=" + day3, { method: "GET" }, 200);
  assert.equal(data.date, day3);
  await runCron(day3 + "T08:00:00Z");
  assert.equal(anthropicCalls.length, 1, "cron does not regenerate");
  await runCron(day4 + "T01:00:00Z"); // 10:00 KST, before the plan hour
  assert.equal(anthropicCalls.length, 1, "cron waits for the plan hour");
  await familyCase("/daily/" + kid.id + "?date=" + day4, { method: "GET" }, 404, "no_daily");
  const kid2 = { id: "33333333-3333-4444-8555-666666666666", name: "둘째" };
  await familyCase("/sync", { body: { child: kid2 } }, 200);
  await runCron(day4 + "T07:00:00Z");
  assert.equal(anthropicCalls.length, 2, "cron generated day4 for the enabled child only");
  await familyCase("/daily/" + kid2.id + "?date=" + day4, { method: "GET" }, 409, "plan_disabled");
  await worker.scheduled({ scheduledTime: Date.parse(day4 + "T07:00:00Z") }, { ...env }, ctx); // FAMILY 없음 → 조용히 종료
  // 삭제하면 오늘의 단어·이미 낸 단어도 지운다
  await familyCase("/family/" + kid.id, { method: "DELETE", ...PARENT }, 200);
  await familyCase("/daily/" + kid.id, { method: "GET" }, 404, "unknown_child");
  await familyCase("/family/" + kid2.id, { method: "DELETE", ...PARENT }, 200);

  // ---- 아이 코드·전용 링크: 보호자가 아이를 만들고(코드 발급) 아이 기기가 코드로 연결한다. 같은 아이의 두 기기는 한곳에 모인다. ----
  await familyCase("/family/children", { body: { name: "하늘" } }, 401, "보호자 코드");
  await familyCase("/family/children", { ...PARENT, body: { name: "  " } }, 400, "이름");
  await familyCase("/family/children", { ...PARENT, body: { name: "가".repeat(21) } }, 400, "이름");
  data = await familyCase("/family/children", { ...PARENT, body: { name: " 하늘 " } }, 200);
  const made = data.child;
  assert(/^[0-9a-f-]{36}$/.test(made.id) && /^\d{6}$/.test(made.joinCode) && made.name === "하늘" && made.createdBy === "parent", "child created with a 6-digit code: " + JSON.stringify(made));
  assert.deepEqual(made.devices, {});
  assert.equal(made.plan.enabled, false);
  await familyCase("/join", { body: { code: "12" } }, 400, "6자리");
  await familyCase("/join", { body: { code: "000000" } }, 404, "unknown_code");
  await familyCase("/join", { passcode: "nope", body: { code: made.joinCode } }, 401);
  const phone = { id: "aaaaaaaa-1111-4222-8333-444444444444", label: "iPhone" };
  const tablet = { id: "bbbbbbbb-1111-4222-8333-444444444444", label: " Android 태블릿 " };
  data = await familyCase("/join", { body: { code: made.joinCode.slice(0, 3) + " " + made.joinCode.slice(3), device: phone } }, 200);
  assert.deepEqual([data.childId, data.name, data.timeLimitSec, data.setsLocked], [made.id, "하늘", 0, false], "join returns the child id, the server name, the time limit and the lock (space in the code tolerated)");
  await familyCase("/join", { ...PARENT, body: { code: made.joinCode, device: tablet } }, 200); // 보호자 코드로도 연결된다
  await familyCase("/join", { body: { code: made.joinCode, device: { id: "bad id", label: "x" } } }, 200); // 잘못된 기기 정보는 무시
  data = await familyCase("/family/" + made.id, { method: "GET", ...PARENT }, 200);
  assert.deepEqual(Object.keys(data.child.devices).sort(), [phone.id, tablet.id].sort(), "both devices registered, invalid one ignored");
  assert.equal(data.child.devices[tablet.id].label, "Android 태블릿", "device label cleaned");
  assert.equal(data.child.joinCode, made.joinCode);
  // 같은 아이의 두 기기에서 온 기록은 한곳에 모이고, 기기가 보낸 이름은 서버 이름을 덮어쓰지 않는다
  await familyCase("/sync", { body: { child: { id: made.id, name: "다른이름" }, device: phone, records: [rec("p1", hoursAgo(3), { awayCount: 2, awayMs: 5000 })] } }, 200);
  await familyCase("/sync", { body: { child: { id: made.id, name: "하늘" }, device: tablet, records: [rec("t1", hoursAgo(2))] } }, 200);
  data = await familyCase("/family/" + made.id, { method: "GET", ...PARENT }, 200);
  assert.equal(data.child.name, "하늘", "server name is authoritative");
  assert.deepEqual(data.records.map((r) => r.id), ["t1", "p1"], "records from both devices merged");
  assert.deepEqual([data.records[1].awayCount, data.records[1].awayMs, data.records[0].awayCount], [2, 5000, undefined], "away fields kept only when present");
  assert(data.child.devices[phone.id].lastSeenAt >= data.child.devices[phone.id].joinedAt, "lastSeenAt updated on sync");
  await familyCase("/sync", { body: { child: { id: made.id, name: "하늘" }, records: [rec("a1", hoursAgo(1), { aiPass: 2 }), rec("a2", hoursAgo(1), { aiPass: 0 })] } }, 200);
  data = await familyCase("/family/" + made.id, { method: "GET", ...PARENT }, 200);
  assert.deepEqual([data.records.find((r) => r.id === "a1").aiPass, data.records.find((r) => r.id === "a2").aiPass], [2, undefined], "aiPass kept only when present");
  // 이름 바꾸기·코드 새로 만들기(옛 코드는 무효)
  await familyCase("/family/" + made.id + "/name", { body: { name: "하늘이" } }, 401, "보호자 코드");
  await familyCase("/family/" + made.id + "/name", { ...PARENT, body: { name: "" } }, 400, "이름");
  data = await familyCase("/family/" + made.id + "/name", { ...PARENT, body: { name: "하늘이" } }, 200);
  assert.equal(data.child.name, "하늘이");
  data = await familyCase("/family/" + made.id + "/code", { ...PARENT }, 200);
  const newCode = data.child.joinCode;
  assert(/^\d{6}$/.test(newCode) && newCode !== made.joinCode, "new code issued");
  await familyCase("/join", { body: { code: made.joinCode, device: phone } }, 404, "unknown_code");
  data = await familyCase("/join", { body: { code: newCode, device: phone } }, 200);
  assert.equal(data.name, "하늘이", "join uses the renamed name");
  await familyCase("/family/99999999-aaaa-4bbb-8ccc-dddddddddddd/code", { ...PARENT }, 404, "unknown_child");
  // 목록에도 코드·기기가 나온다(보호자 전용 응답)
  data = await familyCase("/family", { method: "GET", ...PARENT }, 200);
  const listed = data.children.find((c) => c.id === made.id);
  assert.equal(listed.joinCode, newCode);
  assert.equal(Object.keys(listed.devices).length, 2);
  // 삭제하면 코드도 지워져 더 연결할 수 없다
  await familyCase("/family/" + made.id, { method: "DELETE", ...PARENT }, 200);
  await familyCase("/join", { body: { code: newCode } }, 404, "unknown_code");

  // ---- 세트 동기화: 아이 기기 POST /sets/<childId>(가족 코드), 보호자 /family/<childId>/sets ----
  const sid = (await familyCase("/family/children", { ...PARENT, body: { name: "세트아이" } }, 200)).child.id;
  const word = (id, en, ko) => ({ id, en, ko, ipa: "", hangul: "", aliases: [ko] });
  const setA = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "DAY 05", words: [word(161, "amend", "수정하다"), word(162, "alter", "바꾸다")], updatedAt: hoursAgo(5) };
  await familyCase("/sets/" + sid, { method: "GET" }, 404, "not_found");
  await familyCase("/sets/99999999-aaaa-4bbb-8ccc-dddddddddddd", { body: { sets: [] } }, 404, "unknown_child");
  await familyCase("/sets/" + sid, { body: { sets: [setA] }, passcode: "nope" }, 401);
  await familyCase("/sets/" + sid, { body: { sets: "x" } }, 400, "세트");
  await familyCase("/sets/" + sid, { body: { sets: [{ ...setA, name: " " }] } }, 400, "이름");
  await familyCase("/sets/" + sid, { body: { sets: [{ ...setA, words: [] }] } }, 400, "단어");
  await familyCase("/sets/" + sid, { body: { sets: [{ ...setA, words: [word(1, "a", "ㄱ"), word(1, "b", "ㄴ")] }] } }, 400, "겹치는");
  await familyCase("/sets/" + sid, { body: { sets: [{ ...setA, words: [word(1, "", "ㄱ")] }] } }, 400, "빈 단어");
  await familyCase("/sets/" + sid, { body: { sets: [{ ...setA, updatedAt: "nope" }] } }, 400, "시각");
  await familyCase("/sets/" + sid, { body: { known: [{ id: "bad id" }] } }, 400, "known");
  await familyCase("/sets/" + sid, { body: { deleted: [{ id: setA.id }] } }, 400, "deleted");
  // 기기 A 첫 동기화: 올리기 → 요약만 돌아온다
  let sr = await familyCase("/sets/" + sid, { body: { device: tablet, known: [{ id: setA.id, updatedAt: setA.updatedAt }], sets: [{ ...setA, name: " DAY 05 " }] } }, 200);
  assert.deepEqual(sr.summary.map((s) => [s.id, s.name, s.count, s.updatedAt]), [[setA.id, "DAY 05", 2, setA.updatedAt]], "summary after the first upload");
  assert.deepEqual([sr.sets, sr.deleted], [[], []], "uploader has nothing to pull");
  data = await familyCase("/family/" + sid, { method: "GET", ...PARENT }, 200);
  assert.deepEqual(data.child.sets, sr.summary, "child summary carries the set list");
  assert(data.child.devices[tablet.id], "device registered by the sets sync");
  // 기기 B(아무것도 모름): 세트 전체를 내려받는다
  sr = await familyCase("/sets/" + sid, { body: { device: phone, known: [], sets: [] } }, 200);
  assert.equal(sr.sets.length, 1, "new device pulls the set");
  assert.deepEqual([sr.sets[0].words[0].en, sr.sets[0].words[0].aliases, sr.sets[0].updatedAt], ["amend", ["수정하다"], setA.updatedAt], "pulled set keeps words and time");
  // 기기 B가 더 새 버전을 올리면 A가 받고, 오래된 버전을 올리면 무시하고 새 것을 돌려준다
  const newer = { ...setA, name: "DAY 05 (수정)", words: [...setA.words, word(163, "assess", "평가하다")], updatedAt: hoursAgo(1) };
  sr = await familyCase("/sets/" + sid, { body: { known: [{ id: setA.id, updatedAt: newer.updatedAt }], sets: [newer] } }, 200);
  assert.equal(sr.summary[0].count, 3, "newer version stored");
  sr = await familyCase("/sets/" + sid, { body: { known: [{ id: setA.id, updatedAt: setA.updatedAt }], sets: [{ ...setA, name: "옛날" }] } }, 200);
  assert.deepEqual([sr.sets.length, sr.sets[0].name, sr.summary[0].name], [1, "DAY 05 (수정)", "DAY 05 (수정)"], "older upload ignored, newer pulled");
  // 보호자: 목록(보호자 코드만)·보내기·보기·삭제
  await familyCase("/family/" + sid + "/sets", { method: "GET" }, 401, "보호자 코드");
  sr = await familyCase("/family/" + sid + "/sets", { method: "GET", ...PARENT }, 200);
  assert.deepEqual(sr.sets.map((s) => s.name), ["DAY 05 (수정)"], "parent list");
  await familyCase("/family/" + sid + "/sets", { ...PARENT, body: {} }, 400, "set");
  await familyCase("/family/" + sid + "/sets", { ...PARENT, body: { set: { name: "x", words: [] } } }, 400, "단어");
  sr = await familyCase("/family/" + sid + "/sets", { ...PARENT, body: { set: { name: " 보호자 세트 ", words: [word(1, " apple ", "사과"), word(2, "banana", "바나나")] } } }, 200);
  assert(/^[0-9a-f-]{36}$/.test(sr.set.id) && sr.set.name === "보호자 세트" && sr.set.count === 2 && sr.summary.length === 2, "parent upload: " + JSON.stringify(sr));
  const parentSetId = sr.set.id;
  sr = await familyCase("/family/" + sid + "/sets/" + parentSetId, { method: "GET", ...PARENT }, 200);
  assert.deepEqual([sr.set.words[0].en, sr.set.words[1].en, typeof sr.set.updatedAt], ["apple", "banana", "string"], "parent reads the set with words");
  await familyCase("/family/" + sid + "/sets/nope-id", { method: "GET", ...PARENT }, 404, "unknown_set");
  await familyCase("/family/99999999-aaaa-4bbb-8ccc-dddddddddddd/sets", { ...PARENT, body: { set: { name: "x", words: [word(1, "a", "ㄱ")] } } }, 404, "unknown_child");
  // 보호자가 같은 id로 다시 보내면 고쳐진다(수정 시각 갱신)
  const before = sr.set.updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  sr = await familyCase("/family/" + sid + "/sets", { ...PARENT, body: { set: { id: parentSetId, name: "보호자 세트 2", words: [word(1, "apple", "사과")] } } }, 200);
  assert(sr.set.count === 1 && sr.set.updatedAt > before && sr.summary.length === 2, "parent edit replaces the set");
  // 아이 기기가 보호자 세트를 받고, 기기에서 지운 세트는 묘비로 남아 다른 기기에서도 지워진다
  sr = await familyCase("/sets/" + sid, { body: { known: [{ id: setA.id, updatedAt: newer.updatedAt }], sets: [] } }, 200);
  assert.deepEqual(sr.sets.map((s) => s.id), [parentSetId], "device pulls the parent set only");
  const pulledAt = sr.sets[0].updatedAt;
  sr = await familyCase("/sets/" + sid, { body: { known: [{ id: parentSetId, updatedAt: pulledAt }], sets: [], deleted: [{ id: setA.id, deletedAt: new Date().toISOString() }] } }, 200);
  assert.deepEqual([sr.summary.map((s) => s.id), sr.deleted, sr.sets], [[parentSetId], [], []], "deleting device: summary without the set");
  sr = await familyCase("/sets/" + sid, { body: { known: [{ id: setA.id, updatedAt: newer.updatedAt }, { id: parentSetId, updatedAt: "2000-01-01T00:00:00.000Z" }], sets: [] } }, 200);
  assert.deepEqual([sr.deleted, sr.sets.map((s) => s.id)], [[setA.id], [parentSetId]], "other device told to delete and given the newer parent set");
  // 지운 뒤에 다른 기기가 고친 세트는 살아난다(나중 시각 우선)
  sr = await familyCase("/sets/" + sid, { body: { known: [], sets: [{ ...newer, name: "되살림", updatedAt: new Date(Date.now() + 1000).toISOString() }] } }, 200);
  assert.deepEqual(sr.summary.map((s) => s.name).sort(), ["되살림", "보호자 세트 2"], "edit after delete wins");
  // 보호자 삭제 → 기기에서도 지워짐; 옛 앱의 /sync 세트 요약은 서버 요약을 덮어쓰지 못한다
  sr = await familyCase("/family/" + sid + "/sets/" + parentSetId, { method: "DELETE", ...PARENT }, 200);
  assert.deepEqual(sr.summary.map((s) => s.name), ["되살림"], "parent delete");
  await familyCase("/family/" + sid + "/sets/" + parentSetId, { method: "DELETE", ...PARENT }, 404, "unknown_set");
  sr = await familyCase("/sets/" + sid, { body: { known: [{ id: parentSetId, updatedAt: pulledAt }] } }, 200);
  assert.deepEqual(sr.deleted, [parentSetId], "device learns about the parent delete");
  await familyCase("/sync", { body: { child: { id: sid, name: "세트아이" }, sets: [{ name: "옛 앱", count: 40 }] } }, 200);
  data = await familyCase("/family/" + sid, { method: "GET", ...PARENT }, 200);
  assert.deepEqual(data.child.sets.map((s) => s.name), ["되살림"], "legacy /sync summary ignored once sets are synced");
  // 상한: 한 번에 50개 초과, 아이당 50개 초과
  const many = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: "many-" + (from + i), name: "s" + (from + i), words: [word(1, "a", "ㄱ")], updatedAt: hoursAgo(1) }));
  await familyCase("/sets/" + sid, { body: { sets: many(51) } }, 400, "50");
  await familyCase("/sets/" + sid, { body: { sets: many(49) } }, 200);
  await familyCase("/sets/" + sid, { body: { sets: many(1, 60) } }, 400, "too_many_sets");
  await familyCase("/family/" + sid + "/sets", { ...PARENT, body: { set: { name: "x", words: [word(1, "a", "ㄱ")] } } }, 400, "too_many_sets");
  // 문제 물어보기 질문 요약: 연결된 아이 id 를 보내면 사진 없이 요약만 남아 보호자 상세의 questions 로 보인다
  const savedFetch = globalThis.fetch; // 이 구간의 fetch 는 오늘의 단어 모의라 tutor 응답으로 잠시 바꾼다
  globalThis.fetch = async (url, init) => {
    const r = tutorJson(tutorData)(JSON.parse(init.body));
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  };
  await familyCase("/tutor", { body: { image: "aGVsbG8=", kind: "grammar", question: "왜 aids 인가요?", child: { id: sid } } }, 200);
  await familyCase("/tutor", { body: { image: "aGVsbG8=", kind: "explain", child: { id: "99999999-aaaa-4bbb-8ccc-dddddddddddd" } } }, 200); // 모르는 아이여도 답은 준다
  await familyCase("/tutor", { body: { image: "aGVsbG8=", kind: "explain" } }, 200); // 연결 안 된 기기: 저장 없음
  data = await familyCase("/family/" + sid, { method: "GET", ...PARENT }, 200);
  assert.equal(data.questions.length, 1, "one question logged for the linked child");
  assert.deepEqual([data.questions[0].kind, data.questions[0].question, data.questions[0].problem, data.child.questionCount], ["grammar", "왜 aids 인가요?", "1번 3) 요지 고르기", 1], "question summary: " + JSON.stringify(data.questions[0]));
  assert(!JSON.stringify(data.questions[0]).includes("aGVsbG8=") && typeof data.questions[0].askedAt === "string", "no image stored");
  globalThis.fetch = savedFetch;
  // 아이를 지우면 세트·질문 키도 지워진다
  await familyCase("/family/" + sid, { method: "DELETE", ...PARENT }, 200);
  await familyCase("/sets/" + sid, { body: {} }, 404, "unknown_child");
  assert.equal([...(await familyObject.storage.list({ prefix: "set:" + sid + ":" })).keys()].length, 0, "set keys removed with the child");
  assert.equal([...(await familyObject.storage.list({ prefix: "q:" + sid + ":" })).keys()].length, 0, "question keys removed with the child");

  // ---- 기록 복원: 아이 기기가 GET /records/<childId>(가족 코드)로 서버 사본을 내려받는다(since 이후 오름차순 또는 최신순, 최대 500개) ----
  const rid = (await familyCase("/family/children", { ...PARENT, body: { name: "복원아이" } }, 200)).child.id;
  const rchild = { id: rid, name: "복원아이" };
  const at = (h) => new Date(Date.parse("2026-10-01T00:00:00Z") + h * 3600000).toISOString();
  await familyCase("/sync", { body: { child: rchild, records: [rec("x3", at(3)), rec("x1", at(1), { daily: "2026-10-01", aiPass: 1, awayCount: 1, awayMs: 2000 }), rec("x2", at(2), { partial: true, timeouts: 1 })] } }, 200);
  await familyCase("/records/" + rid, { method: "GET", passcode: "nope" }, 401);
  await familyCase("/records/" + rid, { body: {} }, 404, "not_found"); // POST는 없다
  await familyCase("/records/short", { method: "GET" }, 404, "not_found");
  await familyCase("/records/99999999-aaaa-4bbb-8ccc-dddddddddddd", { method: "GET" }, 404, "unknown_child");
  await familyCase("/records/" + rid + "?since=nope", { method: "GET" }, 400, "since");
  await familyCase("/records/" + rid, { method: "GET", env: { ...fenv, APP_PASSCODE: "" } }, 500, "APP_PASSCODE");
  await familyCase("/records/" + rid, { method: "GET", origin: "https://evil.example" }, 403);
  let rr = await familyCase("/records/" + rid, { method: "GET" }, 200);
  assert.deepEqual(rr.records.map((r) => r.id), ["x3", "x2", "x1"], "newest first without since");
  assert.equal(rr.more, false);
  assert(typeof rr.serverTime === "string" && Number.isFinite(Date.parse(rr.serverTime)), "serverTime");
  assert.deepEqual(
    [rr.records[2].daily, rr.records[2].aiPass, rr.records[2].awayCount, rr.records[1].partial, rr.records[1].timeouts, rr.records[0].missed, rr.records[0].total, rr.records[0].correct],
    ["2026-10-01", 1, 1, true, 1, [{ en: "authority", ko: "권위", unknown: true }, { en: "devote", ko: "바치다" }], 10, 7],
    "compact records returned as stored: " + JSON.stringify(rr.records),
  );
  rr = await familyCase("/records/" + rid + "?limit=2", { method: "GET" }, 200);
  assert.deepEqual([rr.records.map((r) => r.id), rr.more], [["x3", "x2"], true], "limit with more");
  rr = await familyCase("/records/" + rid + "?since=" + encodeURIComponent(at(1)) + "&limit=2", { method: "GET" }, 200);
  assert.deepEqual([rr.records.map((r) => r.id), rr.more], [["x1", "x2"], true], "ascending from since (inclusive)");
  rr = await familyCase("/records/" + rid + "?since=" + encodeURIComponent(at(2)) + "&limit=2", { method: "GET" }, 200);
  assert.deepEqual([rr.records.map((r) => r.id), rr.more], [["x2", "x3"], false], "next page from the last completedAt");
  rr = await familyCase("/records/" + rid + "?since=" + encodeURIComponent("2026-10-01T09:00:00+09:00") + "&limit=9999", { method: "GET" }, 200); // 09:00 KST = 00:00Z → 전부, limit 상한 500
  assert.deepEqual(rr.records.map((r) => r.id), ["x1", "x2", "x3"], "since normalized to ISO, limit capped");
  rr = await familyCase("/records/" + rid + "?since=" + encodeURIComponent(at(4)), { method: "GET" }, 200);
  assert.deepEqual([rr.records, rr.more], [[], false], "nothing after the newest record");
  rr = await familyCase("/records/" + rid, { method: "GET", ...PARENT }, 200); // 보호자 코드로도 읽을 수 있다
  assert.equal(rr.records.length, 3);
  // 보호자 ‘더 보기’ 경계: before 는 미포함, ISO 로 맞춘 뒤 비교한다(아이 기기 복원 경로 /records 와 따로)
  rr = await familyCase("/family/" + rid + "/records?before=" + encodeURIComponent(at(3)), { method: "GET", ...PARENT }, 200);
  assert.deepEqual([rr.records.map((r) => r.id), rr.more], [["x2", "x1"], false], "before is exclusive");
  rr = await familyCase("/family/" + rid + "/records?before=" + encodeURIComponent(at(3)) + "&limit=1", { method: "GET", ...PARENT }, 200);
  assert.deepEqual([rr.records.map((r) => r.id), rr.more], [["x2"], true], "page of one with more");
  rr = await familyCase("/family/" + rid + "/records?before=" + encodeURIComponent("2026-10-01T11:00:00+09:00"), { method: "GET", ...PARENT }, 200); // 11:00 KST = 02:00Z
  assert.deepEqual(rr.records.map((r) => r.id), ["x1"], "before normalized to ISO");
  rr = await familyCase("/family/" + rid + "/records?before=" + encodeURIComponent(at(1)), { method: "GET", ...PARENT }, 200);
  assert.deepEqual([rr.records, rr.more], [[], false], "nothing before the oldest record");
  rr = await familyCase("/family/" + rid + "/records?before=" + encodeURIComponent(at(9)), { method: "GET", ...PARENT }, 200);
  assert.equal(rr.records[0].daily === undefined && rr.records[2].daily, "2026-10-01", "compact records as stored on pages");
  limiter.keys.length = 0;
  limiter.allow = true;
  await familyCase("/records/" + rid, { method: "GET", env: { ...fenv, RATE_LIMITER: limiter } }, 200);
  assert(limiter.keys[0].startsWith("/records:"), "records has its own rate-limit bucket: " + limiter.keys[0]);
  await familyCase("/family/" + rid, { method: "DELETE", ...PARENT }, 200);
  await familyCase("/records/" + rid, { method: "GET" }, 404, "unknown_child");
  await familyCase("/family/" + rid + "/records", { method: "GET", ...PARENT }, 404, "unknown_child");

  console.log(
    "PASS: worker CORS/origin/passcode/rate-limit/validation/sanitization/generated flag/define dictionary/grade judge/word lookup/tutor help/fallback retry/upstream error mapping/family store/detail window+record pages/daily words/child codes/set sync/record restore",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
