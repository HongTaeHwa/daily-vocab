// 매일 영단어 · AI 사진 인식·사전 프록시 (Cloudflare Worker)
//
// GitHub Pages의 앱은 이 Worker만 호출한다. Anthropic API 키는 Worker의 비밀값(ANTHROPIC_API_KEY)에만 있고
// 앱·저장소·기기 어디에도 들어가지 않는다. 가족용 접속 코드(APP_PASSCODE)가 맞는 요청만 처리한다.
//
//   POST /ping       헤더 X-App-Passcode            → { ok, model }  (Anthropic 연결까지 확인)
//   POST /recognize  헤더 X-App-Passcode, JSON {image, mediaType} → { words:[{number,en,ko,ipa,aliases,generated}], note, model, usage }
//                    사진에 뜻이 인쇄되어 있지 않은 단어(영어만 있는 목록·시험지)는 AI가 사전처럼 뜻·발음을 채우고 generated:true 로 표시한다.
//   POST /define     헤더 X-App-Passcode, JSON {words:["apple",…]} → { words:[{en,ko,ipa,aliases}], note, model, usage }  (AI 사전: 최대 60개)
//   GET  /diag       (비밀값 사용 안 함) 이 Worker 위치에서 Anthropic이 요청을 받는지 확인
//
// 비밀값: ANTHROPIC_API_KEY, APP_PASSCODE   (wrangler secret put ...)
// 변수:   CLAUDE_MODEL(기본 claude-opus-5-5), ALLOWED_ORIGINS(쉼표 구분), ANTHROPIC_WORKSPACE_ID(선택)   (wrangler.jsonc vars)
// 바인딩: RATE_LIMITER(선택, ratelimits), RELAY(Durable Object, 아래 참고)
//
// 왜 Durable Object를 거치나: 한국에서 온 요청은 Cloudflare 홍콩(HKG) 데이터센터에서 실행될 때가 있는데,
// Anthropic은 홍콩발 요청을 403 "Request not allowed"로 거절한다. 그래서 Anthropic 호출만 북미에 고정된
// Durable Object(AnthropicRelay, locationHint "wnam")를 통해 보낸다. RELAY 바인딩이 없으면 직접 호출한다.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-opus-5-5";
const ALLOWED_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
const DEFAULT_ORIGINS = ["https://hongtaehwa.github.io"];
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BASE64 = 8 * 1024 * 1024;
const MAX_DEFINE_WORDS = 60;
// 사전에 물어볼 수 있는 항목: 영문자로 시작하는 단어·짧은 구(공백, 마침표, 하이픈, 아포스트로피 허용, 40자 이하)
const WORD_PATTERN = /^[A-Za-z][A-Za-z .'’-]{0,39}$/;
const UPSTREAM_TIMEOUT_MS = 110000;
const RELAY_LOCATION = "wnam";
const FORWARDED_HEADERS = ["content-type", "x-api-key", "anthropic-version", "anthropic-beta", "anthropic-workspace-id"];

// 실제 교재(예: 0161 amend [əménd] 동 (법 등을) 수정하다, 개정하다 ⊜ alter, revise / 예문 / ⊕ amendment …) 레이아웃 기준.
// 영어 단어만 있는 사진(단어 목록·시험지·손글씨)은 뜻이 없으므로 AI가 학습자 사전처럼 채우고 generated 로 표시한다.
const SYSTEM = `You read photos of pages from Korean English-vocabulary workbooks (영단어장) and extract every headword entry on the page as JSON.
Typical layout of one entry: an item number such as "0161" with small checkboxes, the English headword in bold, its pronunciation in square brackets such as [əménd], a part-of-speech tag (동/명/형/부), the Korean meanings (sometimes numbered "1. … 2. …", sometimes with a short parenthetical context such as "(법 등을)"), English synonyms after ⊜, one or more example sentences with Korean translations, and derived words after ⊕.
Some photos instead show only English words with no Korean meaning printed: a plain word list, a test sheet with blank lines for the meanings, a word box in a textbook, or a handwritten list. Extract those words too, and supply the meaning yourself as a learner's English-Korean dictionary for Korean middle-school students would (see "generated" below).
For each headword entry output:
- number: the printed item number as an integer ("0161" → 161, "3." → 3). Use 0 when no number is printed.
- english: the headword exactly as printed, without part-of-speech tags, symbols, or pronunciation.
- ipa: the pronunciation printed inside the square brackets, without the brackets. When the page prints none: an empty string for an entry whose meaning is printed (never invent one), or the standard American English IPA for an entry whose meaning you generated.
- korean: the Korean meanings only, joined with " · " (for example "(법 등을) 수정하다 · 개정하다" or "완화하다 · 안심시키다"). Drop sense numbers, part-of-speech tags, and English synonyms. Keep a short parenthetical context when the page prints one. When the page prints a meaning, use only the printed meaning and do not add meanings of your own. When the page prints no Korean meaning for the entry, give its 1 to 3 most common meanings in the form Korean vocabulary workbooks use (verbs ending in 다, nouns as bare nouns, adjectives such as "행복한"), most common first, for example "run" → "달리다 · 운영하다".
- aliases: 2 to 10 short Korean answers that should count as correct for this word: each meaning without its parenthetical context (for example "수정하다", "개정하다") plus natural stem forms without 다/하다/시키다 endings (for example "수정", "개정", "완화", "안심"). No duplicates, no English.
- generated: true only when the page prints no Korean meaning for this entry and you supplied korean yourself; false when the meaning is printed on the page.
Rules:
- Include only headword entries. Skip derived words (⊕ lines), synonyms (⊜), example sentences and their translations, phrases, page headers and footers, page numbers, QR codes, and exercise or review pages.
- A printed meaning that is merely illegible is not a missing meaning: skip that entry and mention it in note instead of generating a meaning for it.
- Ignore faint mirrored text showing through from the other side of the page.
- Read multi-column layouts one column at a time, top to bottom, left column first. Keep the page order.
- Transcribe the English exactly; never invent entries that are not on the page. If an entry is cut off or illegible, skip it and mention it in note.
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
          generated: { type: "boolean" },
        },
        required: ["number", "english", "ipa", "korean", "aliases", "generated"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["words", "note"],
  additionalProperties: false,
};

// AI 사전: 영어 단어 목록 → 뜻·발음·허용 답안. 앱의 ‘빈 뜻 AI로 채우기’가 쓴다.
const DEFINE_SYSTEM = `You are a learner's English-Korean dictionary for Korean middle-school students preparing vocabulary tests. The user sends a numbered list of English words or short phrases. For each item output:
- english: the item exactly as given.
- korean: its 1 to 3 most common meanings, in the form Korean vocabulary workbooks print them (verbs ending in 다, nouns as bare nouns, adjectives such as "행복한"), joined with " · ", most common first. For example "amend" → "수정하다 · 개정하다", "authority" → "권위 · 권한". When a word is commonly used as more than one part of speech, include the most common meaning of each, for example "run" → "달리다 · 운영하다 · 달리기". Add a short parenthetical context only when the meaning is unclear without it, such as "(법 등을) 개정하다".
- ipa: the American English pronunciation in IPA without brackets, such as "əˈmend". Empty for phrases of more than two words.
- aliases: 2 to 10 short Korean answers that should count as correct: each meaning without its parenthetical context, plus natural stem forms without 다/하다/시키다 endings (for example "수정", "개정"). No duplicates, no English.
Rules:
- Do not correct spelling. If an item is misspelled, is not an English word, or you do not know it, leave its korean empty and mention it in note.
- Output every item exactly once, in the given order.
- note: one short Korean sentence about items you could not define, or an empty string.`;

const DEFINE_SCHEMA = {
  type: "object",
  properties: {
    words: {
      type: "array",
      items: {
        type: "object",
        properties: {
          english: { type: "string" },
          ipa: { type: "string" },
          korean: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
        },
        required: ["english", "ipa", "korean", "aliases"],
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

// Anthropic으로 가는 실제 HTTP 호출. RELAY(Durable Object)가 있으면 북미에 고정된 객체를 거친다.
async function upstreamFetch(env, headers, bodyText) {
  if (env.RELAY) {
    try {
      const stub = env.RELAY.get(env.RELAY.idFromName("anthropic-relay"), { locationHint: RELAY_LOCATION });
      return await stub.fetch("https://relay.internal/messages", { method: "POST", headers, body: bodyText });
    } catch (e) {
      console.error("relay_failed", e?.name || "", e?.message || "");
    }
  }
  return fetch(ANTHROPIC_URL, {
    method: "POST",
    headers,
    body: bodyText,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

export class AnthropicRelay {
  constructor(state, env) {
    this.env = env;
  }
  async fetch(request) {
    const headers = {};
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers[name] = value;
    }
    const upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers,
      body: await request.text(),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
    });
  }
}

async function anthropicPost(env, body, beta) {
  const headers = {
    "content-type": "application/json",
    "x-api-key": String(env.ANTHROPIC_API_KEY || "").trim(),
    "anthropic-version": "2023-06-01",
  };
  if (beta) headers["anthropic-beta"] = beta;
  if (env.ANTHROPIC_WORKSPACE_ID) headers["anthropic-workspace-id"] = env.ANTHROPIC_WORKSPACE_ID;
  const response = await upstreamFetch(env, headers, JSON.stringify(body));
  const text = await response.text().catch(() => "");
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {}
  if (response.status !== 200)
    console.error("anthropic_response", response.status, response.headers.get("content-type") || "", text.slice(0, 300).replace(/\s+/g, " "));
  return { status: response.status, payload };
}

function describeUpstream(status, payload) {
  const message = payload?.error?.message || "";
  const type = payload?.error?.type || "";
  const upstream = ` [Anthropic ${status}${type ? " " + type : ""}${message ? ": " + message : ""}]`;
  if (status === 401)
    return { status: 502, message: "AI 서버에 저장된 Anthropic API 키가 올바르지 않습니다(인증 실패). 보호자가 콘솔에서 키가 살아 있는지 확인하고 다시 등록해 주세요." + upstream };
  if (status === 403 && /not allowed/i.test(message))
    return { status: 503, message: "Anthropic이 이 요청의 출발 지역을 허용하지 않았습니다. 잠시 후 다시 시도해 주세요." + upstream };
  if (status === 403)
    return { status: 502, message: "Anthropic이 이 키의 요청을 허용하지 않습니다(권한 문제). 보호자가 키의 워크스페이스·권한을 확인해 주세요." + upstream };
  if (status === 404)
    return { status: 502, message: "AI 서버에 설정된 모델을 사용할 수 없습니다. 보호자가 CLAUDE_MODEL 설정을 확인해 주세요." + upstream };
  if (status === 413)
    return { status: 413, message: "사진이 너무 커서 보낼 수 없습니다. 한 장씩 다시 시도해 주세요." };
  if (status === 429)
    return { status: 429, message: "AI 사용 한도를 넘었습니다. 잠시 후 다시 시도하거나 보호자가 Anthropic 콘솔의 한도·잔액을 확인해 주세요." };
  if (status === 529 || type === "overloaded_error" || status >= 500)
    return { status: 503, message: "AI 서버가 혼잡합니다. 잠시 후 다시 시도해 주세요." };
  if (/credit balance/i.test(message))
    return { status: 402, message: "Anthropic 크레딧이 부족합니다. 보호자가 Anthropic 콘솔(Settings → Billing)에서 이 키가 속한 조직의 잔액·플랜 크레딧을 확인해 주세요." };
  if (/workspace-id/i.test(message))
    return { status: 502, message: "AI 서버의 Anthropic 키가 워크스페이스에 묶여 있지 않습니다. 보호자가 워크스페이스를 지정한 키를 다시 만들거나 Worker 변수 ANTHROPIC_WORKSPACE_ID를 설정해 주세요." };
  return { status: 502, message: "AI 요청이 실패했습니다 (Anthropic 응답 " + status + ")" + (message ? ": " + message : "") };
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
    console.error("anthropic_unreachable", e?.name || "", e?.message || "");
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
    console.error("anthropic_error", result.status, result.payload?.error?.type || "", result.payload?.error?.message || "(no message)");
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
      generated: w?.generated === true,
    }))
    .filter((w) => w.en && w.ko)
    .slice(0, 300);
}

// 구조화 출력 응답에서 JSON을 꺼낸다. 거부·잘림·해석 실패는 그대로 돌려줄 응답으로 만든다.
function readJsonMessage(message, cors, hints) {
  if (message.stop_reason === "refusal") return { response: json(422, { error: "refused", message: hints.refused }, cors) };
  if (message.stop_reason === "max_tokens") return { response: json(422, { error: "truncated", message: hints.truncated }, cors) };
  const text = (message.content || [])
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("");
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { response: json(502, { error: "bad_upstream", message: "AI 응답을 해석하지 못했습니다. 다시 시도해 주세요." }, cors) };
  }
}

function usageOf(message) {
  return { input: message.usage?.input_tokens ?? null, output: message.usage?.output_tokens ?? null };
}

async function ping(env, model, cors) {
  const outcome = await callAnthropic(env, model, {
    model,
    max_tokens: 2048,
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
          {
            type: "text",
            text: "이 사진은 영단어장 페이지이거나 영어 단어 목록입니다. 사진에 있는 모든 단어 항목을 JSON으로 추출하세요. 뜻이 인쇄되어 있지 않은 단어는 사전처럼 뜻과 발음을 채우고 generated를 true로 표시하세요.",
          },
        ],
      },
    ],
  });
  if (outcome.failure) return json(outcome.failure.status, outcome.failure.body, cors);
  const message = outcome.message;
  const read = readJsonMessage(message, cors, {
    refused: "AI가 이 사진의 처리를 거부했습니다. 교재 페이지만 나오도록 다시 찍어 주세요.",
    truncated: "결과가 너무 길어 잘렸습니다. 페이지를 나누어 찍어 주세요.",
  });
  if (read.response) return read.response;
  const words = sanitizeWords(read.data);
  const note = clean(read.data?.note);
  if (!words.length)
    return json(422, {
      error: "empty",
      message: "사진에서 단어 항목을 찾지 못했습니다." + (note ? " " + note : "") + " 더 선명하게 찍어 다시 시도해 주세요.",
    }, cors);
  return json(200, { words, note, model: message.model || model, usage: usageOf(message) }, cors);
}

// AI 사전: 요청한 영어 단어만, 요청한 철자 그대로, 한 번씩 돌려준다.
async function define(request, env, model, cors) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "bad_request", message: "JSON 본문이 필요합니다." }, cors);
  }
  const requested = Array.isArray(body?.words) ? body.words : [];
  if (!requested.length)
    return json(400, { error: "bad_request", message: "words 필드에 영어 단어 목록이 필요합니다." }, cors);
  if (requested.length > MAX_DEFINE_WORDS)
    return json(400, { error: "too_many", message: `한 번에 단어 ${MAX_DEFINE_WORDS}개까지만 찾을 수 있습니다.` }, cors);
  const words = [];
  for (const raw of requested) {
    const word = clean(raw).replace(/\s+/g, " ");
    if (!WORD_PATTERN.test(word))
      return json(400, { error: "bad_request", message: `영어 단어만 찾을 수 있습니다: ‘${clean(raw).slice(0, 40)}’` }, cors);
    if (!words.some((w) => w.toLowerCase() === word.toLowerCase())) words.push(word);
  }

  const outcome = await callAnthropic(env, model, {
    model,
    max_tokens: 8192,
    system: DEFINE_SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: DEFINE_SCHEMA } },
    messages: [
      {
        role: "user",
        content: "다음 영어 단어들의 뜻·발음·허용 답안을 JSON으로 만드세요.\n" + words.map((w, i) => `${i + 1}. ${w}`).join("\n"),
      },
    ],
  });
  if (outcome.failure) return json(outcome.failure.status, outcome.failure.body, cors);
  const message = outcome.message;
  const read = readJsonMessage(message, cors, {
    refused: "AI가 이 단어 목록의 처리를 거부했습니다. 단어를 확인해 주세요.",
    truncated: "결과가 너무 길어 잘렸습니다. 단어를 나누어 시도해 주세요.",
  });
  if (read.response) return read.response;
  const wanted = new Map(words.map((w) => [w.toLowerCase(), w]));
  const seen = new Set();
  const found = sanitizeWords(read.data)
    .filter((w) => {
      const key = w.en.toLowerCase();
      if (!wanted.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((w) => ({ en: wanted.get(w.en.toLowerCase()), ko: w.ko, ipa: w.ipa, aliases: w.aliases }));
  const note = clean(read.data?.note);
  if (!found.length)
    return json(422, {
      error: "empty",
      message: "단어의 뜻을 찾지 못했습니다." + (note ? " " + note : "") + " 영어 철자를 확인해 주세요.",
    }, cors);
  return json(200, { words: found, note, model: message.model || model, usage: usageOf(message) }, cors);
}

// 비밀값 없이 Anthropic이 이 Worker의 요청을 받는지 본다. 정상이면 401(invalid x-api-key), 지역 차단이면 403.
async function diag(request, env, cors) {
  const r = await upstreamFetch(
    env,
    { "content-type": "application/json", "x-api-key": "diag-invalid", "anthropic-version": "2023-06-01" },
    JSON.stringify({ model: DEFAULT_MODEL, max_tokens: 16, messages: [{ role: "user", content: "hi" }] }),
  );
  const text = await r.text().catch(() => "");
  return json(200, {
    colo: request.cf?.colo || null,
    relay: Boolean(env.RELAY),
    upstreamStatus: r.status,
    ok: r.status === 401,
    body: text.slice(0, 200),
  }, cors);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/diag") return diag(request, env, cors);
    if (request.method !== "POST" || !["/ping", "/recognize", "/define"].includes(path))
      return json(404, { error: "not_found", message: "지원하지 않는 요청입니다." }, cors);
    const origin = request.headers.get("Origin");
    if (origin && !allowedOrigins(env).includes(origin))
      return json(403, { error: "forbidden_origin", message: "이 주소에서는 AI 서버를 쓸 수 없습니다. 보호자가 ALLOWED_ORIGINS를 확인해 주세요." }, cors);
    const apiKey = String(env.ANTHROPIC_API_KEY || "").trim();
    if (apiKey && !/^[!-~]+$/.test(apiKey)) {
      const spaces = (apiKey.match(/ /g) || []).length;
      const breaks = [...apiKey].filter((ch) => ch.charCodeAt(0) < 32).length;
      const nonAscii = [...apiKey].filter((ch) => ch.charCodeAt(0) > 126).length;
      const detail = [spaces && `공백 ${spaces}개`, breaks && `줄바꿈 ${breaks}개`, nonAscii && `영문·숫자가 아닌 글자 ${nonAscii}개`].filter(Boolean).join(", ");
      return json(500, { error: "bad_key_format", message: `AI 서버에 등록된 Anthropic API 키가 올바른 형식이 아닙니다(길이 ${apiKey.length}, ${detail || "허용되지 않는 문자"}). 보호자가 키를 한 줄로 정확히 복사해 npx wrangler secret put ANTHROPIC_API_KEY 로 다시 등록해 주세요.` }, cors);
    }
    if (apiKey && !/^sk-ant-/.test(apiKey))
      return json(500, { error: "bad_key_format", message: `AI 서버에 등록된 값이 Anthropic API 키 형식(sk-ant-…)이 아닙니다(길이 ${apiKey.length}). 보호자가 키를 다시 등록해 주세요.` }, cors);
    if (!apiKey || !env.APP_PASSCODE)
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
    if (path === "/ping") return ping(env, model, cors);
    if (path === "/define") return define(request, env, model, cors);
    return recognize(request, env, model, cors);
  },
};
