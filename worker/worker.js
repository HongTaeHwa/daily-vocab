// 매일 영단어 · AI 사진 인식 프록시 (Cloudflare Worker)
//
// GitHub Pages의 앱은 이 Worker만 호출한다. Anthropic API 키는 Worker의 비밀값(ANTHROPIC_API_KEY)에만 있고
// 앱·저장소·기기 어디에도 들어가지 않는다. 가족용 접속 코드(APP_PASSCODE)가 맞는 요청만 처리한다.
//
//   POST /ping       헤더 X-App-Passcode            → { ok, model }  (Anthropic 연결까지 확인)
//   POST /recognize  헤더 X-App-Passcode, JSON {image, mediaType} → { words:[{number,en,ko,ipa,aliases}], note, model, usage }
//
// 비밀값: ANTHROPIC_API_KEY, APP_PASSCODE   (wrangler secret put ...)
// 변수:   CLAUDE_MODEL(기본 claude-opus-5-5), ALLOWED_ORIGINS(쉼표 구분)   (wrangler.jsonc vars)
// 바인딩: RATE_LIMITER(선택, wrangler.jsonc ratelimits)

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-opus-5-5";
const ALLOWED_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
const DEFAULT_ORIGINS = ["https://hongtaehwa.github.io"];
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BASE64 = 8 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 110000;

// 실제 교재(예: 0161 amend [əménd] 동 (법 등을) 수정하다, 개정하다 ⊜ alter, revise / 예문 / ⊕ amendment …) 레이아웃 기준.
const SYSTEM = `You read photos of pages from Korean English-vocabulary workbooks (영단어장) and extract every headword entry on the page as JSON.
Typical layout of one entry: an item number such as "0161" with small checkboxes, the English headword in bold, its pronunciation in square brackets such as [əménd], a part-of-speech tag (동/명/형/부), the Korean meanings (sometimes numbered "1. … 2. …", sometimes with a short parenthetical context such as "(법 등을)"), English synonyms after ⊜, one or more example sentences with Korean translations, and derived words after ⊕.
For each headword entry output:
- number: the printed item number as an integer ("0161" → 161). Use 0 when no number is printed.
- english: the headword exactly as printed, without part-of-speech tags, symbols, or pronunciation.
- ipa: the pronunciation printed inside the square brackets, without the brackets. Empty string when none is printed. Never invent one.
- korean: the Korean meanings only, joined with " · " (for example "(법 등을) 수정하다 · 개정하다" or "완화하다 · 안심시키다"). Drop sense numbers, part-of-speech tags, and English synonyms. Keep a short parenthetical context when the page prints one. Do not add meanings of your own.
- aliases: 2 to 10 short Korean answers that should count as correct for this word: each meaning without its parenthetical context (for example "수정하다", "개정하다") plus natural stem forms without 다/하다/시키다 endings (for example "수정", "개정", "완화", "안심"). No duplicates, no English.
Rules:
- Include only headword entries. Skip derived words (⊕ lines), synonyms (⊜), example sentences and their translations, phrases, page headers and footers, page numbers, QR codes, and exercise or review pages.
- Ignore faint mirrored text showing through from the other side of the page.
- Read multi-column layouts one column at a time, top to bottom, left column first. Keep the page order.
- Transcribe exactly; never invent entries that are not on the page. If an entry is cut off or illegible, skip it and mention it in note.
- note: one short Korean sentence about anything skipped or uncertain, or an empty string.`;

const SCHEMA = {
  type: "object",
  properties: {
    words: {
      type: "array",
      items: {
        type: "object",
        properties: {
          number: { type: "integer" },
          english: { type: "string" },
          ipa: { type: "string" },
          korean: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
        },
        required: ["number", "english", "ipa", "korean", "aliases"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["words", "note"],
  additionalProperties: false,
};

function allowedOrigins(env) {
  const configured = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ORIGINS;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const headers = { vary: "Origin" };
  if (allowedOrigins(env).includes(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "POST, OPTIONS";
    headers["access-control-allow-headers"] = "content-type, x-app-passcode";
    headers["access-control-max-age"] = "86400";
  }
  return headers;
}

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

// 길이가 같을 때 비교 시간이 입력값에 따라 달라지지 않도록 한다.
function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  if (x.length !== y.length || !x.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function pickModel(env) {
  return ALLOWED_MODELS.includes(env.CLAUDE_MODEL) ? env.CLAUDE_MODEL : DEFAULT_MODEL;
}

async function anthropicPost(env, body, beta) {
  const headers = {
    "content-type": "application/json",
    "x-api-key": env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
  };
  if (beta) headers["anthropic-beta"] = beta;
  const response = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {}
  return { status: response.status, payload };
}

function describeUpstream(status, payload) {
  const message = payload?.error?.message || "";
  const type = payload?.error?.type || "";
  if (status === 401 || status === 403)
    return { status: 502, message: "AI 서버에 저장된 Anthropic API 키가 올바르지 않습니다. 보호자가 Worker 비밀값을 확인해 주세요." };
  if (status === 404)
    return { status: 502, message: "AI 서버에 설정된 모델을 사용할 수 없습니다. 보호자가 CLAUDE_MODEL 설정을 확인해 주세요." };
  if (status === 413)
    return { status: 413, message: "사진이 너무 커서 보낼 수 없습니다. 한 장씩 다시 시도해 주세요." };
  if (status === 429)
    return { status: 429, message: "AI 사용 한도를 넘었습니다. 잠시 후 다시 시도하거나 보호자가 Anthropic 콘솔의 한도·잔액을 확인해 주세요." };
  if (status === 529 || type === "overloaded_error" || status >= 500)
    return { status: 503, message: "AI 서버가 혼잡합니다. 잠시 후 다시 시도해 주세요." };
  return { status: 502, message: "AI 요청이 실패했습니다" + (message ? ": " + message : "") };
}

// Opus/Sonnet: 정책 거부 시 서버가 대체 모델로 이어 주는 fallbacks를 켠다.
// 계정에서 그 베타를 쓸 수 없어 400이 오면 fallbacks 없이 한 번 더 보낸다.
async function callAnthropic(env, model, body) {
  const useFallback = model !== "claude-haiku-5-5";
  let result;
  try {
    result = useFallback
      ? await anthropicPost(env, { ...body, fallbacks: "default" }, "server-side-fallback-2026-07-01")
      : await anthropicPost(env, body);
    if (useFallback && result.status === 400 && /fallback/i.test(result.payload?.error?.message || ""))
      result = await anthropicPost(env, body);
  } catch (e) {
    const timeout = e?.name === "TimeoutError" || e?.name === "AbortError";
    return {
      failure: {
        status: 504,
        body: {
          error: timeout ? "upstream_timeout" : "upstream_unreachable",
          message: timeout
            ? "AI 응답이 너무 오래 걸립니다. 잠시 후 다시 시도해 주세요."
            : "AI 서버가 Anthropic에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        },
      },
    };
  }
  if (result.status !== 200 || !result.payload) {
    const mapped = describeUpstream(result.status, result.payload);
    return {
      failure: {
        status: mapped.status,
        body: { error: "upstream", upstreamStatus: result.status, message: mapped.message },
      },
    };
  }
  return { message: result.payload };
}

const clean = (s) => String(s ?? "").replace(/[\t\r\n]+/g, " ").trim();

function sanitizeWords(data) {
  return (Array.isArray(data?.words) ? data.words : [])
    .map((w) => ({
      number: Number.isInteger(w?.number) && w.number > 0 ? w.number : 0,
      en: clean(w?.english),
      ko: clean(w?.korean),
      ipa: clean(w?.ipa).replace(/^\[|\]$/g, "").trim().slice(0, 60),
      aliases: [
        ...new Set((Array.isArray(w?.aliases) ? w.aliases : []).map(clean).filter(Boolean)),
      ].slice(0, 12),
    }))
    .filter((w) => w.en && w.ko)
    .slice(0, 300);
}

async function ping(env, model, cors) {
  const outcome = await callAnthropic(env, model, {
    model,
    max_tokens: 256,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: "연결 확인입니다. ‘확인’이라고만 답하세요." }],
  });
  if (outcome.failure) return json(outcome.failure.status, outcome.failure.body, cors);
  return json(200, { ok: true, model: outcome.message.model || model }, cors);
}

async function recognize(request, env, model, cors) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "bad_request", message: "JSON 본문이 필요합니다." }, cors);
  }
  const image = typeof body?.image === "string" ? body.image : "";
  const mediaType = MEDIA_TYPES.includes(body?.mediaType) ? body.mediaType : "image/jpeg";
  if (!image || !/^[A-Za-z0-9+/]+={0,2}$/.test(image))
    return json(400, { error: "bad_request", message: "image 필드에 base64 사진이 필요합니다." }, cors);
  if (image.length > MAX_IMAGE_BASE64)
    return json(413, { error: "too_large", message: "사진이 너무 큽니다. 한 장씩, 더 작은 크기로 시도해 주세요." }, cors);

  const outcome = await callAnthropic(env, model, {
    model,
    max_tokens: 8192,
    system: SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          { type: "text", text: "이 사진은 영단어장 페이지입니다. 페이지에 있는 모든 표제어 항목을 JSON으로 추출하세요." },
        ],
      },
    ],
  });
  if (outcome.failure) return json(outcome.failure.status, outcome.failure.body, cors);
  const message = outcome.message;
  if (message.stop_reason === "refusal")
    return json(422, { error: "refused", message: "AI가 이 사진의 처리를 거부했습니다. 교재 페이지만 나오도록 다시 찍어 주세요." }, cors);
  if (message.stop_reason === "max_tokens")
    return json(422, { error: "truncated", message: "결과가 너무 길어 잘렸습니다. 페이지를 나누어 찍어 주세요." }, cors);
  const text = (message.content || [])
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return json(502, { error: "bad_upstream", message: "AI 응답을 해석하지 못했습니다. 다시 시도해 주세요." }, cors);
  }
  const words = sanitizeWords(data);
  const note = clean(data?.note);
  if (!words.length)
    return json(422, {
      error: "empty",
      message: "사진에서 단어 항목을 찾지 못했습니다." + (note ? " " + note : "") + " 더 선명하게 찍어 다시 시도해 주세요.",
    }, cors);
  return json(200, {
    words,
    note,
    model: message.model || model,
    usage: { input: message.usage?.input_tokens ?? null, output: message.usage?.output_tokens ?? null },
  }, cors);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (request.method !== "POST" || !["/ping", "/recognize"].includes(path))
      return json(404, { error: "not_found", message: "지원하지 않는 요청입니다." }, cors);
    const origin = request.headers.get("Origin");
    if (origin && !allowedOrigins(env).includes(origin))
      return json(403, { error: "forbidden_origin", message: "이 주소에서는 AI 서버를 쓸 수 없습니다. 보호자가 ALLOWED_ORIGINS를 확인해 주세요." }, cors);
    if (!env.ANTHROPIC_API_KEY || !env.APP_PASSCODE)
      return json(500, { error: "misconfigured", message: "AI 서버에 비밀값(ANTHROPIC_API_KEY, APP_PASSCODE)이 설정되지 않았습니다." }, cors);
    if (!safeEqual(request.headers.get("x-app-passcode") || "", env.APP_PASSCODE))
      return json(401, { error: "unauthorized", message: "접속 코드가 맞지 않습니다." }, cors);
    if (env.RATE_LIMITER) {
      const ip = request.headers.get("cf-connecting-ip") || "unknown";
      const { success } = await env.RATE_LIMITER.limit({ key: path + ":" + ip });
      if (!success)
        return json(429, { error: "rate_limited", message: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, cors);
    }
    const model = pickModel(env);
    return path === "/ping" ? ping(env, model, cors) : recognize(request, env, model, cors);
  },
};
