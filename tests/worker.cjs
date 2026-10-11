// Cloudflare Worker 프록시(worker/worker.js) 단위 테스트. Node만 필요(Playwright 불필요).
// Anthropic 호출은 globalThis.fetch 를 바꿔 가짜 응답으로 대체한다.
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");
(async () => {
  const { default: worker, AnthropicRelay } = await import(
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
      { number: 121, english: "authority", ipa: "əˈθɔːrəti", korean: "권위 · 권한", aliases: ["권위", "권한", "권위"] },
      { number: 0, english: " devote ", ipa: "[dɪˈvoʊt]", korean: "바치다", aliases: ["바치다", "바치"] },
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
    { number: 121, en: "authority", ko: "권위 · 권한", ipa: "əˈθɔːrəti", aliases: ["권위", "권한"] },
    { number: 0, en: "devote", ko: "바치다", ipa: "dɪˈvoʊt", aliases: ["바치다", "바치"] },
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
  assert.equal(sent.max_tokens, 8192);
  assert.equal(sent.thinking, undefined, "adaptive thinking by omission");

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

  console.log(
    "PASS: worker CORS/origin/passcode/rate-limit/validation/sanitization/fallback retry/upstream error mapping",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
