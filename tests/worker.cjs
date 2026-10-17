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
      async list({ prefix = "", start, reverse = false, limit } = {}) {
        let keys = [...m.keys()].filter((k) => k.startsWith(prefix) && (start === undefined || k >= start)).sort();
        if (reverse) keys.reverse();
        if (limit) keys = keys.slice(0, limit);
        return new Map(keys.map((k) => [k, copy(m.get(k))]));
      },
    };
  };
  const familyObject = new FamilyStore({ storage: familyStorage() });
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
  assert.equal(data.records.length, 28, "detail = all records");
  assert.equal(data.records[27].id, "old", "oldest last");
  // 같은 기록을 다시 보내면 덮어쓴다(중복 없음)
  await familyCase("/sync", { body: { child, records: [rec("r1", r1.completedAt, { correct: 9 })] } }, 200);
  data = await familyCase("/family/" + child.id, { method: "GET", ...PARENT }, 200);
  assert.equal(data.records.length, 28, "resend does not duplicate");
  assert.equal(data.records.find((r) => r.id === "r1").correct, 9, "resend overwrites");
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
  assert(limiter.keys[0].startsWith("/sync:") && limiter.keys[1].startsWith("/family:"), "family rate-limit buckets: " + limiter.keys.join(","));
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
  data = await familyCase("/family/" + child.id, { method: "GET", ...PARENT }, 200);
  assert.equal(data.records.length, 5000, "capped at 5000 records per child");
  assert(data.records.some((r) => r.id === "old") && !data.records.some((r) => r.id === "bulk5099"), "oldest bulk records dropped, newer kept");
  // 삭제(보호자만) → 목록에서 사라진다
  await familyCase("/family/" + child.id, { method: "DELETE" }, 401);
  data = await familyCase("/family/" + child.id, { method: "DELETE", ...PARENT }, 200);
  assert.equal(data.deleted, 5000);
  data = await familyCase("/family", { method: "GET", ...PARENT }, 200);
  assert.deepEqual(data.children, []);

  console.log(
    "PASS: worker CORS/origin/passcode/rate-limit/validation/sanitization/generated flag/define dictionary/fallback retry/upstream error mapping/family store",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
