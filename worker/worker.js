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
//   POST /sync       헤더 X-App-Passcode(가족 또는 보호자 코드), JSON {child:{id,name}, records:[…], sets:[…]} → { ok, stored, trimmed, syncedAt }
//                    아이 기기가 시험 기록(점수·틀린 단어·세트 이름)을 가족 기록함(FamilyStore)에 보낸다.
//   GET  /family     헤더 X-App-Passcode(보호자 코드만) → { children:[{id,name,sets,lastTestAt,…,records}], serverTime }  (아이별 최근 기록)
//   GET  /family/<childId>     보호자 코드 → { child, records }  (전체 기록, 최신순)
//   DELETE /family/<childId>   보호자 코드 → { ok, deleted }
//   POST /family/<childId>/plan  보호자 코드, JSON {enabled, level, dailyCount, hour} → { ok, child }   (오늘의 단어 계획)
//   GET  /daily/<childId>?date=  가족·보호자 코드 → 그날의 단어 { date, words:[{id,en,ko,ipa,aliases,kind}], level, completed? }
//                                없으면 404 no_daily, 계획이 꺼져 있으면 409 plan_disabled
//   POST /daily/<childId>        가족·보호자 코드, JSON {date?} → 없으면 Claude로 생성해 저장하고 돌려준다
//   POST /family/children        보호자 코드, JSON {name} → { ok, child }   (아이 만들기: 6자리 아이 코드 발급)
//   POST /family/<childId>/code  보호자 코드 → 아이 코드 새로 발급 { ok, child }  (옛 코드는 무효)
//   POST /family/<childId>/name  보호자 코드, JSON {name} → 이름 바꾸기 { ok, child }
//   POST /join                   가족·보호자 코드, JSON {code, device:{id,label}} → { ok, childId, name, timeLimitSec }   (아이 기기 연결)
//   GET  /settings/<childId>     가족·보호자 코드 → { childId, name, timeLimitSec }   (아이 기기가 보호자 설정을 받아 감)
//   GET  /records/<childId>?since=<ISO>&limit=<n>  가족·보호자 코드 → { records:[압축 기록…], more, serverTime }
//                                아이 기기의 기록 복원(새 기기·재설치). since가 있으면 그 시각부터(포함) 오름차순, 없으면 최신순. 최대 500개
//   (크론, 매시) scheduled() → FamilyStore /cron: 계획 시각이 지난 아이의 그날 단어를 만든다
//
// 비밀값: ANTHROPIC_API_KEY, APP_PASSCODE, PARENT_PASSCODE(선택: 보호자 폰에서 아이들 기록 보기)   (wrangler secret put ...)
// 변수:   CLAUDE_MODEL(기본 claude-opus-5-5), DAILY_MODEL(오늘의 단어 생성, 기본 claude-sonnet-5-5), ALLOWED_ORIGINS(쉼표 구분), ANTHROPIC_WORKSPACE_ID(선택)   (wrangler.jsonc vars)
// 바인딩: RATE_LIMITER(선택, ratelimits), RELAY(Durable Object, 아래 참고), FAMILY(Durable Object FamilyStore: 가족 기록함)
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
const LOOKUP_MODEL_DEFAULT = "claude-sonnet-5-5"; // 단어 찾기(뜻·발음·예문)는 한 단어씩이라 sonnet 이면 충분하다(`LOOKUP_MODEL`로 변경)
const GRADE_MODEL_DEFAULT = "claude-haiku-5-5"; // 2차 채점(뜻 판정)은 짧고 잦아서 빠르고 싼 모델을 쓴다(`GRADE_MODEL`로 바꿀 수 있음)
const MAX_GRADE_ANSWER = 100;
// 사전에 물어볼 수 있는 항목: 영문자로 시작하는 단어·짧은 구(공백, 마침표, 하이픈, 아포스트로피 허용, 40자 이하)
const WORD_PATTERN = /^[A-Za-z][A-Za-z .'’-]{0,39}$/;
const UPSTREAM_TIMEOUT_MS = 110000;
const RELAY_LOCATION = "wnam";
const FORWARDED_HEADERS = ["content-type", "x-api-key", "anthropic-version", "anthropic-beta", "anthropic-workspace-id"];

// ---- 가족 기록함(FamilyStore) 규칙 ----
// 보내는 쪽(/sync)은 가족 코드, 보는 쪽(/family…)은 보호자 코드만. 아이 기기에는 가족 코드만 있으므로 형제 기록을 볼 수 없다.
const FAMILY_PATH = /^\/family(?:\/([A-Za-z0-9-]{8,64}))?$/;
const FAMILY_MODES = ["read_meaning", "en_ko", "ko_en"];
const CHILD_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_SYNC_BODY = 256 * 1024;
const MAX_SYNC_RECORDS = 100;
const MAX_SYNC_SETS = 100;
const MAX_MISSED_WORDS = 200;
const MAX_CHILD_NAME = 20;
const MAX_CHILD_RECORDS = 5000; // 아이당 보관 기록 수. 넘으면 오래된 것부터 지운다.
const SUMMARY_DAYS = 14; // GET /family 가 아이별로 돌려주는 최근 기록 범위
const SUMMARY_MIN_RECORDS = 20; // 최근 14일 기록이 이보다 적으면 최근 20개를 돌려준다
const STORAGE_BATCH = 128; // Durable Object storage put/delete 한 번에 넣을 수 있는 키 수

// ---- 오늘의 단어(매일 자동 생성 퀴즈) 규칙 ----
const CHILD_ACTION_PATH = /^\/family\/([A-Za-z0-9-]{8,64})\/(plan|code|name)$/; // 계획 저장·아이 코드 새로 만들기·이름 바꾸기(보호자)
const CHILDREN_PATH = /^\/family\/children$/; // 아이 만들기(보호자). 아이 id는 UUID라 "children"과 겹치지 않는다.
const JOIN_CODE_PATTERN = /^\d{6}$/; // 아이 기기 연결용 아이 코드(전용 링크 ?child=코드 에도 쓴다)
const MAX_DEVICES = 10; // 아이당 연결 기기 수
const MAX_DEVICE_LABEL = 40;
const DAILY_PATH = /^\/daily\/([A-Za-z0-9-]{8,64})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAILY_MODEL_DEFAULT = "claude-sonnet-5-5";
const DAILY_DEFAULTS = { enabled: false, level: "중2 상위권", dailyCount: 10, hour: 16, timeLimitSec: 0 }; // hour는 한국 시각, timeLimitSec 0 = 제한 없음(모든 시험에 적용)
const SETTINGS_PATH = /^\/settings\/([A-Za-z0-9-]{8,64})$/; // 아이 기기가 보호자 설정(제한 시간 등)을 받아 가는 경로
const RECORDS_PATH = /^\/records\/([A-Za-z0-9-]{8,64})$/; // 아이 기기가 자기 기록의 서버 사본을 내려받는 경로(기록 복원, 가족 코드)
const RECORDS_PAGE_MAX = 500; // GET /records 한 번에 돌려주는 기록 수 상한
const TIME_LIMIT_MIN = 5;
const TIME_LIMIT_MAX = 120;
const DAILY_COUNT_MIN = 5;
const DAILY_COUNT_MAX = 20;
const DAILY_REVIEW_MAX = 3; // 하루치 중 복습(최근 틀린 단어) 수
const DAILY_REVIEW_DAYS = 14;
const DAILY_EXCLUDE_RECENT = 200; // 요청에 “최근에 이미 낸 단어”로 넣는 수
const DAILY_SERVED_MAX = 5000; // 아이별 ‘이미 낸 단어’ 보관 수
const DAILY_ATTEMPTS = 2;
const MAX_ANCHOR_WORDS = 60; // 교재 앵커: 아이 기기가 보내는 현재 세트 단어 수
const MAX_PLAN_BODY = 16 * 1024;
const KST_OFFSET_MS = 9 * 3600000;

// ---- 세트 동기화(아이 단위) 규칙 ----
// 세트는 아이 항목에 속한다(set:<childId>:<setId>). 아이 기기는 POST /sets/<childId>(가족 코드)로 자기 세트를 올리고
// 다른 기기·보호자가 바꾼 것을 받는다: 세트별 updatedAt이 나중인 쪽이 이기고 삭제는 묘비(deletedAt)로 남겨 다른 기기에서도 지운다.
// 보호자는 /family/<childId>/sets 로 목록을 보고 세트를 만들어 보내거나(사진 → 편집기) 고치고 지운다. 아이 항목의 sets 요약은 서버가 다시 계산한다.
const SETS_PATH = /^\/sets\/([A-Za-z0-9-]{8,64})$/;
const CHILD_SETS_PATH = /^\/family\/([A-Za-z0-9-]{8,64})\/sets(?:\/([A-Za-z0-9_-]{1,64}))?$/;
const SET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_SETS_BODY = 2 * 1024 * 1024;
const MAX_CHILD_SETS = 50; // 아이당 세트 수
const MAX_SET_WORDS = 2000; // 앱의 세트 저장 상한과 같다
const MAX_SET_NAME = 120;
const MAX_WORD_ALIASES = 30;
const MAX_SET_TOMBSTONES = 200;

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

// 단어 찾기(/lookup): 아이가 공부하다 만난 모르는 단어 하나의 뜻·품사·발음·허용 답안·예문·비슷한 말. 못 찾으면 found:false + 철자 제안.
const LOOKUP_SYSTEM = `You are a learner's English-Korean dictionary for Korean middle-school students. The user sends one English word or short phrase that the student met while studying. Output JSON:
- found: true when the input is a real English word or phrase you can define; false when it is misspelled, not English, or unknown to you.
- english: the word in its base dictionary form (lowercase unless it is a proper noun) when found; otherwise the input as given.
- suggestion: when found is false and the input looks like a misspelling of an English word, the most likely intended word; otherwise an empty string.
- pos: the main part of speech in the style of Korean workbooks (명사, 동사, 형용사, 부사, 전치사, 접속사, 숙어 등), or an empty string.
- korean: its 1 to 3 most common meanings in the form Korean vocabulary workbooks print them (verbs ending in 다, nouns as bare nouns, adjectives such as "행복한"), joined with " · ", most common first.
- ipa: the American English pronunciation in IPA without brackets.
- aliases: 2 to 10 short Korean answers that should count as correct in a quiz: each meaning without its parenthetical context plus natural stem forms without 다/하다/시키다 endings. No duplicates, no English.
- examples: 2 or 3 short, natural example sentences that a middle-school student can read (under 12 words each), the most common sense first, each with a natural Korean translation.
- similar: up to 4 English synonyms or closely related words the student may also meet (an empty array if none).
- note: one short Korean sentence about anything the student should know (a very different second meaning, an informal word, a common confusion), or an empty string.
When found is false, leave pos, korean, ipa, aliases, examples and similar empty.`;
const LOOKUP_SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    english: { type: "string" },
    suggestion: { type: "string" },
    pos: { type: "string" },
    korean: { type: "string" },
    ipa: { type: "string" },
    aliases: { type: "array", items: { type: "string" } },
    examples: { type: "array", items: { type: "object", properties: { english: { type: "string" }, korean: { type: "string" } }, required: ["english", "korean"], additionalProperties: false } },
    similar: { type: "array", items: { type: "string" } },
    note: { type: "string" },
  },
  required: ["found", "english", "suggestion", "pos", "korean", "ipa", "aliases", "examples", "similar", "note"],
  additionalProperties: false,
};
function pickLookupModel(env) {
  return ALLOWED_MODELS.includes(env.LOOKUP_MODEL) ? env.LOOKUP_MODEL : LOOKUP_MODEL_DEFAULT;
}

// 2차 채점(/grade): 앱이 책의 뜻·허용 답안과 글자 그대로 맞지 않는 답만 보내면, ‘같은 뜻인가’를 판정한다.
// 동의어·조사/어미 차이·합성어(몸무게↔무게)·한 글자 오타는 인정하고, 다른 뜻·교재에 없는 다른 의미·막연한 답·여러 뜻 나열은 거절한다.
const GRADE_SYSTEM = `You grade one answer in a Korean student's English vocabulary quiz. The user gives the English word, the meaning(s) printed in the student's textbook, the answers already accepted as correct, and the student's answer (typed or transcribed from speech).
Decide whether the student's answer shows that they know the word in the textbook sense.
Accept when the answer has the same meaning as a textbook meaning or an accepted answer: a synonym or near-synonym in that sense, the same word with a different particle, ending or spacing (…을 제출하다 vs 제출하다, 수정 vs 수정하다), a natural compound or narrower everyday form (몸무게 for 무게), a dictionary form vs a stem, or an obvious one-character typo or speech-recognition slip of the same word.
Reject when the answer means something else, is a different sense of the English word that the textbook does not list, is too vague or general to show knowledge of this word, is in English, is empty or meaningless, or lists several unrelated meanings as guesses.
Output JSON: accept (true or false) and reason: one short Korean phrase under 30 characters that the student can read, such as "무게와 같은 뜻" or "다른 뜻이에요".`;
const GRADE_SCHEMA = {
  type: "object",
  properties: { accept: { type: "boolean" }, reason: { type: "string" } },
  required: ["accept", "reason"],
  additionalProperties: false,
};
function pickGradeModel(env) {
  return ALLOWED_MODELS.includes(env.GRADE_MODEL) ? env.GRADE_MODEL : GRADE_MODEL_DEFAULT;
}

// 오늘의 단어: 수준 라벨 + 교재 앵커(지금 공부 중인 단어) + 제외 목록 + 복습 단어 → 새 단어 제안과 전체 정의.
const DAILY_SYSTEM = `You create a short daily English vocabulary quiz for one Korean student. The user message gives the student's level, the words the student is currently studying (the "anchor" list, which shows the difficulty they already handle), words to avoid because they were used recently, review words to define exactly as given, and how many NEW words to propose.
Rules for NEW words:
- Choose words that are similar to or slightly harder than the anchor words and useful for Korean school English tests at the given level (textbook and academic vocabulary). Avoid rare, technical, archaic or slang words, proper nouns, abbreviations and phrases longer than two words. Use the base dictionary form in lowercase.
- Never propose an anchor word, an avoid-list word, a review word, or another form of one of them (plural, -ing, -ed, -ly, -ness).
- Vary parts of speech and topics across the list. Propose exactly the number of new words requested.
For every item, review words first and exactly as given, then the new words, output:
- english: the word.
- korean: its 1 to 3 most common meanings, in the form Korean vocabulary workbooks print them (verbs ending in 다, nouns as bare nouns, adjectives such as "행복한"), joined with " · ", most common first.
- ipa: the American English pronunciation in IPA without brackets.
- aliases: 2 to 10 short Korean answers that should count as correct: each meaning without its parenthetical context, plus natural stem forms without 다/하다/시키다 endings. No duplicates, no English.
- note: one short Korean sentence about anything you could not do, or an empty string.`;

function dailyUserMessage(level, anchor, avoid, review, count) {
  return [
    `학생 수준: ${level}`,
    anchor.length ? `지금 공부 중인 단어(수준 기준, 제외): ${anchor.join(", ")}` : "지금 공부 중인 단어: (없음)",
    avoid.length ? `최근에 이미 낸 단어(제외): ${avoid.join(", ")}` : "",
    review.length ? `복습 단어(그대로 정의): ${review.map((r) => r.en).join(", ")}` : "",
    `새 단어 ${count}개를 제안하세요.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function pickDailyModel(env) {
  return ALLOWED_MODELS.includes(env.DAILY_MODEL) ? env.DAILY_MODEL : DAILY_MODEL_DEFAULT;
}

// 한국 시각 기준 날짜(YYYY-MM-DD)와 시(0~23). 가족이 한국에 있으므로 서버 시간은 KST로 고정한다.
function kstNow(now = Date.now()) {
  const d = new Date(now + KST_OFFSET_MS);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

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
    headers["access-control-allow-methods"] = "GET, POST, DELETE, OPTIONS";
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

// 접속 코드의 역할: 보호자 코드(PARENT_PASSCODE)는 모든 요청에, 가족 코드(APP_PASSCODE)는 AI와 기록 보내기에 쓴다.
function roleOf(request, env) {
  const given = request.headers.get("x-app-passcode") || "";
  if (env.PARENT_PASSCODE && safeEqual(given, env.PARENT_PASSCODE)) return "parent";
  if (env.APP_PASSCODE && safeEqual(given, env.APP_PASSCODE)) return "family";
  return null;
}

async function rateLimited(request, env, bucket, cors) {
  if (!env.RATE_LIMITER) return null;
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const { success } = await env.RATE_LIMITER.limit({ key: bucket + ":" + ip });
  return success ? null : json(429, { error: "rate_limited", message: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, cors);
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

// ---- 가족 기록함: 아이 기기가 보낸 시험 기록을 저장하고 보호자 폰에 보여 준다 ----
// SQLite 기반 Durable Object 하나(idFromName("family"))의 내장 키-값 저장소를 쓴다. 키 배치:
//   child:<childId>                              {id, name, sets:[{name,count}], createdAt, updatedAt, lastTestAt, recordCount}
//   rec:<childId>:<completedAt ISO>:<recordId>   압축 기록 {id, setName, mode, range, startedAt, completedAt, total, correct, partial, activeMs, missed, receivedAt}
// 같은 기록을 다시 보내면 같은 키라 덮어쓴다. 키가 완료 시각 순이라 prefix 나열이 곧 시간순이다.
export class FamilyStore {
  constructor(state, env = {}) {
    this.storage = state.storage;
    this.env = env;
    this.generating = new Map(); // 같은 날짜의 생성 요청이 겹치면(크론·기기) Claude를 한 번만 부른다
  }
  async fetch(request) {
    const url = new URL(request.url);
    const method = request.method;
    const readBody = () => request.json().catch(() => ({}));
    if (url.pathname === "/sync" && method === "POST") return this.sync(await request.json());
    if (url.pathname === "/cron" && method === "POST") return this.cron(await readBody());
    if (url.pathname === "/join" && method === "POST") return this.join(await readBody());
    if (CHILDREN_PATH.test(url.pathname) && method === "POST") return this.createChild(await readBody());
    const action = CHILD_ACTION_PATH.exec(url.pathname);
    if (action && method === "POST") {
      const body = await readBody();
      if (action[2] === "plan") return this.savePlan(action[1], body);
      if (action[2] === "code") return this.regenerateCode(action[1]);
      return this.rename(action[1], body);
    }
    const settings = SETTINGS_PATH.exec(url.pathname);
    if (settings && method === "GET") return this.settings(settings[1]);
    const records = RECORDS_PATH.exec(url.pathname);
    if (records && method === "GET") return this.records(records[1], url.searchParams);
    const setsSync = SETS_PATH.exec(url.pathname);
    if (setsSync && method === "POST") return this.syncSets(setsSync[1], await readBody());
    const childSets = CHILD_SETS_PATH.exec(url.pathname);
    if (childSets && !childSets[2] && method === "GET") return this.listSets(childSets[1]);
    if (childSets && !childSets[2] && method === "POST") return this.putSet(childSets[1], await readBody());
    if (childSets && childSets[2] && method === "GET") return this.getSet(childSets[1], childSets[2]);
    if (childSets && childSets[2] && method === "DELETE") return this.deleteSet(childSets[1], childSets[2]);
    const daily = DAILY_PATH.exec(url.pathname);
    if (daily && method === "GET") return this.getDaily(daily[1], url.searchParams.get("date"));
    if (daily && method === "POST") return this.generateDaily(daily[1], (await readBody())?.date);
    const match = FAMILY_PATH.exec(url.pathname);
    if (match && method === "GET") return match[1] ? this.child(match[1]) : this.summary();
    if (match && match[1] && method === "DELETE") return this.remove(match[1]);
    return json(404, { error: "not_found", message: "지원하지 않는 요청입니다." });
  }
  recordPrefix(childId) {
    return "rec:" + childId + ":";
  }
  dailyKey(childId, date) {
    return "daily:" + childId + ":" + date;
  }
  planOf(child) {
    return { ...DAILY_DEFAULTS, ...(child?.plan || {}) };
  }
  async putMany(entries) {
    const keys = Object.keys(entries);
    for (let i = 0; i < keys.length; i += STORAGE_BATCH)
      await this.storage.put(Object.fromEntries(keys.slice(i, i + STORAGE_BATCH).map((k) => [k, entries[k]])));
  }
  async deleteMany(keys) {
    for (let i = 0; i < keys.length; i += STORAGE_BATCH) await this.storage.delete(keys.slice(i, i + STORAGE_BATCH));
  }
  async sync({ child, records, sets, anchor, device }) {
    const now = new Date().toISOString();
    const key = "child:" + child.id;
    const current = (await this.storage.get(key)) || { id: child.id, createdAt: now, createdBy: "device", sets: [], recordCount: 0, devices: {} };
    const entries = {};
    let lastTestAt = current.lastTestAt || null;
    for (const r of records) {
      entries[this.recordPrefix(child.id) + r.completedAt + ":" + r.id] = { ...r, receivedAt: now };
      if (!lastTestAt || r.completedAt > lastTestAt) lastTestAt = r.completedAt;
    }
    const next = {
      ...current,
      name: current.name || child.name, // 보호자가 만든 아이의 이름은 서버가 기준이다(기기가 보낸 이름으로 덮어쓰지 않는다)
      devices: registerDevice(current.devices, device, now),
      // 세트 동기화(/sets)를 시작한 아이는 서버가 계산한 요약이 기준이다(옛 앱이 보낸 이름·개수 목록으로 덮어쓰지 않는다).
      sets: current.setsSyncedAt ? current.sets || [] : sets === undefined ? current.sets || [] : sets,
      ...(anchor ? { anchor: { ...anchor, updatedAt: now } } : {}),
      updatedAt: now,
      lastTestAt,
      // 다시 보낸 기록도 세므로 대략값이다. 상한을 넘었을 때만 실제로 세어 정리한다.
      recordCount: (current.recordCount || 0) + records.length,
    };
    await this.putMany({ ...entries, [key]: next });
    for (const r of records) if (r.daily && !r.partial) await this.markDaily(child.id, r); // 오늘의 단어로 본 시험(중단 제외)이면 그날 것에 완료 표시
    let trimmed = 0;
    if (next.recordCount > MAX_CHILD_RECORDS) {
      const all = await this.storage.list({ prefix: this.recordPrefix(child.id) });
      const extra = [...all.keys()].slice(0, Math.max(0, all.size - MAX_CHILD_RECORDS));
      await this.deleteMany(extra);
      trimmed = extra.length;
      await this.storage.put(key, { ...next, recordCount: all.size - extra.length });
    }
    return json(200, { ok: true, stored: records.length, trimmed, syncedAt: now });
  }
  async markDaily(childId, r) {
    const key = this.dailyKey(childId, r.daily);
    const d = await this.storage.get(key);
    if (!d) return;
    if (d.completed && d.completed.completedAt >= r.completedAt) return;
    await this.storage.put(key, { ...d, completed: { recordId: r.id, correct: r.correct, total: r.total, completedAt: r.completedAt } });
  }
  async todayOf(childId, date) {
    const d = await this.storage.get(this.dailyKey(childId, date));
    return { date, exists: Boolean(d), count: d ? d.words.length : 0, completed: d?.completed || null };
  }
  // 아이별 최근 14일 기록(20개 미만이면 최근 20개). 오늘·7일·이번 주 계산은 폰의 현지 시간으로 앱이 한다.
  async summary() {
    const since = new Date(Date.now() - SUMMARY_DAYS * 86400000).toISOString();
    const { date: today } = kstNow();
    const children = [];
    for (const c of (await this.storage.list({ prefix: "child:" })).values()) {
      const prefix = this.recordPrefix(c.id);
      let records = [...(await this.storage.list({ prefix, start: prefix + since })).values()].reverse();
      if (records.length < SUMMARY_MIN_RECORDS)
        records = [...(await this.storage.list({ prefix, reverse: true, limit: SUMMARY_MIN_RECORDS })).values()];
      children.push({ ...c, plan: this.planOf(c), today: await this.todayOf(c.id, today), records });
    }
    children.sort((a, b) => String(a.name).localeCompare(String(b.name), "ko"));
    return json(200, { children, serverTime: new Date().toISOString() });
  }
  async child(childId) {
    const c = await this.storage.get("child:" + childId);
    if (!c) return json(404, { error: "unknown_child", message: "그 아이의 기록이 없습니다. 목록을 새로고침해 주세요." });
    const records = [...(await this.storage.list({ prefix: this.recordPrefix(childId), reverse: true })).values()];
    const { date: today } = kstNow();
    const daily = await this.storage.get(this.dailyKey(childId, today));
    return json(200, {
      child: { ...c, plan: this.planOf(c) },
      records,
      today: { date: today, exists: Boolean(daily), words: daily?.words || [], note: daily?.note || "", completed: daily?.completed || null },
    });
  }
  async remove(childId) {
    const c = await this.storage.get("child:" + childId);
    if (!c) return json(404, { error: "unknown_child", message: "그 아이의 기록이 없습니다. 목록을 새로고침해 주세요." });
    const keys = [...(await this.storage.list({ prefix: this.recordPrefix(childId) })).keys()];
    const dailies = [...(await this.storage.list({ prefix: "daily:" + childId + ":" })).keys()];
    const setKeys = [...(await this.storage.list({ prefix: this.setPrefix(childId) })).keys()];
    await this.deleteMany([...keys, ...dailies, ...setKeys, "served:" + childId, "child:" + childId, ...(c.joinCode ? ["code:" + c.joinCode] : [])]);
    return json(200, { ok: true, deleted: keys.length });
  }
  // ---- 아이 만들기·아이 코드·기기 연결 ----
  // 보호자가 아이를 만들면 6자리 아이 코드를 발급하고(code:<코드> → childId), 아이 기기는 코드나 전용 링크로 연결한다.
  // 같은 코드를 넣은 기기(아이폰·태블릿)는 한 아이로 묶여 기록이 모이고 오늘의 단어도 같은 것을 받는다.
  async newJoinCode() {
    for (let i = 0; i < 20; i++) {
      const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
      if (!(await this.storage.get("code:" + code))) return code;
    }
    throw Error("join code space exhausted");
  }
  async createChild(body) {
    const name = clean(body?.name);
    if (!name || name.length > MAX_CHILD_NAME) return json(400, { error: "bad_request", message: `아이 이름은 1~${MAX_CHILD_NAME}자로 적어 주세요.` });
    const now = new Date().toISOString();
    const joinCode = await this.newJoinCode();
    const child = { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now, createdBy: "parent", joinCode, devices: {}, sets: [], recordCount: 0, lastTestAt: null };
    await this.storage.put({ ["child:" + child.id]: child, ["code:" + joinCode]: { childId: child.id, createdAt: now } });
    return json(200, { ok: true, child: { ...child, plan: this.planOf(child) } });
  }
  async regenerateCode(childId) {
    const c = await this.storage.get("child:" + childId);
    if (!c) return json(404, { error: "unknown_child", message: "그 아이의 기록이 없습니다. 목록을 새로고침해 주세요." });
    const now = new Date().toISOString();
    const joinCode = await this.newJoinCode();
    const next = { ...c, joinCode, updatedAt: now };
    await this.storage.put({ ["child:" + childId]: next, ["code:" + joinCode]: { childId, createdAt: now } });
    if (c.joinCode) await this.storage.delete("code:" + c.joinCode);
    return json(200, { ok: true, child: { ...next, plan: this.planOf(next) } });
  }
  async rename(childId, body) {
    const c = await this.storage.get("child:" + childId);
    if (!c) return json(404, { error: "unknown_child", message: "그 아이의 기록이 없습니다. 목록을 새로고침해 주세요." });
    const name = clean(body?.name);
    if (!name || name.length > MAX_CHILD_NAME) return json(400, { error: "bad_request", message: `아이 이름은 1~${MAX_CHILD_NAME}자로 적어 주세요.` });
    const next = { ...c, name, updatedAt: new Date().toISOString() };
    await this.storage.put("child:" + childId, next);
    return json(200, { ok: true, child: { ...next, plan: this.planOf(next) } });
  }
  async join(body) {
    const code = String(body?.code ?? "").replace(/\D/g, "");
    if (!JOIN_CODE_PATTERN.test(code)) return json(400, { error: "bad_request", message: "아이 코드는 숫자 6자리예요." });
    const ref = await this.storage.get("code:" + code);
    const c = ref ? await this.storage.get("child:" + ref.childId) : null;
    if (!c || c.joinCode !== code)
      return json(404, { error: "unknown_code", message: "그 아이 코드를 찾을 수 없어요. 보호자 폰의 아이들 탭에서 코드를 다시 확인해 주세요." });
    const now = new Date().toISOString();
    await this.storage.put("child:" + c.id, { ...c, devices: registerDevice(c.devices, parseDevice(body?.device), now), updatedAt: now });
    return json(200, { ok: true, childId: c.id, name: c.name, timeLimitSec: this.planOf(c).timeLimitSec });
  }
  // 아이 기기용 보호자 설정(이름·문제당 제한 시간). 가족 코드로 읽는다.
  async settings(childId) {
    const c = await this.storage.get("child:" + childId);
    if (!c) return json(404, { error: "unknown_child", message: "그 아이의 기록이 없습니다." });
    return json(200, { childId, name: c.name, timeLimitSec: this.planOf(c).timeLimitSec });
  }
  // 기록 복원(아이 기기, 가족 코드): 서버에 있는 이 아이의 압축 기록을 돌려준다. 새 기기나 다시 설치한 앱이 기록 탭을 채우는 데 쓴다.
  // since(ISO)가 있으면 그 시각부터(포함) 오름차순으로 limit개(앱은 마지막 completedAt을 다음 since로 넘기며 id로 겹침을 걸러낸다), 없으면 최신순 limit개.
  async records(childId, params) {
    const c = await this.storage.get("child:" + childId);
    if (!c) return json(404, { error: "unknown_child", message: "그 아이의 기록이 없습니다." });
    const since = isoDate(params.get("since"));
    if (since === undefined) return json(400, { error: "bad_request", message: "since는 ISO 시각이어야 합니다." });
    const wanted = Number(params.get("limit"));
    const limit = Number.isInteger(wanted) && wanted > 0 ? Math.min(wanted, RECORDS_PAGE_MAX) : RECORDS_PAGE_MAX;
    const prefix = this.recordPrefix(childId);
    const listed = since
      ? await this.storage.list({ prefix, start: prefix + since, limit: limit + 1 })
      : await this.storage.list({ prefix, reverse: true, limit: limit + 1 });
    const all = [...listed.values()];
    return json(200, { records: all.slice(0, limit), more: all.length > limit, serverTime: new Date().toISOString() });
  }
  // ---- 세트 동기화(아이 단위) ----
  setPrefix(childId) {
    return "set:" + childId + ":";
  }
  async storedSets(childId) {
    return [...(await this.storage.list({ prefix: this.setPrefix(childId) })).values()];
  }
  // 보호자 목록·아이 항목에 두는 요약(살아 있는 세트만, 이름순).
  setSummary(stored) {
    return stored
      .filter((s) => !s.deletedAt)
      .map((s) => ({ id: s.id, name: s.name, count: s.words.length, updatedAt: s.updatedAt }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id));
  }
  unknownSet() {
    return json(404, { error: "unknown_set", message: "그 세트가 없어요. 목록을 새로고침해 주세요." });
  }
  // 아이 기기: known(기기에 있는 세트 id·수정 시각 전부) + sets(새로 만들거나 고친 세트 전체) + deleted(지운 세트 묘비).
  // 응답: sets(기기에 없거나 더 새 버전이 있는 세트 전체), deleted(기기가 아는데 서버에서 지워진 id), summary(살아 있는 세트 전부).
  async syncSets(childId, { known, sets, deleted, device }) {
    const c = await this.storage.get("child:" + childId);
    if (!c) return json(404, { error: "unknown_child", message: "그 아이의 기록이 없습니다. 보호자 폰에서 아이를 다시 만들어 주세요." });
    const now = new Date().toISOString();
    const byId = new Map((await this.storedSets(childId)).map((s) => [s.id, s]));
    const changes = {};
    for (const d of deleted) {
      const cur = byId.get(d.id);
      if (cur && cur.updatedAt >= d.deletedAt) continue; // 지운 뒤 다른 기기가 고쳤으면 고친 쪽이 남는다
      const tomb = { id: d.id, name: cur?.name || "", words: [], updatedAt: d.deletedAt, deletedAt: d.deletedAt };
      byId.set(d.id, tomb);
      changes[this.setPrefix(childId) + d.id] = tomb;
    }
    for (const s of sets) {
      const cur = byId.get(s.id);
      if (cur && cur.updatedAt >= s.updatedAt) continue; // 더 오래된 버전은 무시
      byId.set(s.id, s);
      changes[this.setPrefix(childId) + s.id] = s;
    }
    const live = [...byId.values()].filter((s) => !s.deletedAt);
    if (live.length > MAX_CHILD_SETS)
      return json(400, { error: "too_many_sets", message: `세트는 아이당 ${MAX_CHILD_SETS}개까지 둘 수 있어요. 안 쓰는 세트를 지워 주세요.` });
    const knownMap = new Map(known.map((k) => [k.id, k.updatedAt]));
    const pull = live.filter((s) => !knownMap.has(s.id) || knownMap.get(s.id) < s.updatedAt);
    const removed = [...byId.values()].filter((s) => s.deletedAt && knownMap.has(s.id)).map((s) => s.id);
    const summary = this.setSummary(live);
    await this.putMany({
      ...changes,
      ["child:" + childId]: { ...c, devices: registerDevice(c.devices, device, now), sets: summary, setsSyncedAt: now, updatedAt: now },
    });
    return json(200, { ok: true, sets: pull, deleted: removed, summary, syncedAt: now });
  }
  // 보호자: 목록·세트 하나(단어 포함)·만들어 보내기(또는 고치기)·삭제
  async listSets(childId) {
    const c = await this.storage.get("child:" + childId);
    if (!c) return json(404, { error: "unknown_child", message: "그 아이의 기록이 없습니다. 목록을 새로고침해 주세요." });
    return json(200, { sets: this.setSummary(await this.storedSets(childId)) });
  }
  async getSet(childId, setId) {
    const s = await this.storage.get(this.setPrefix(childId) + setId);
    if (!s || s.deletedAt) return this.unknownSet();
    return json(200, { set: s });
  }
  async putSet(childId, { set }) {
    const c = await this.storage.get("child:" + childId);
    if (!c) return json(404, { error: "unknown_child", message: "그 아이의 기록이 없습니다. 목록을 새로고침해 주세요." });
    const now = new Date().toISOString();
    const stored = { ...set, updatedAt: now };
    const others = (await this.storedSets(childId)).filter((s) => s.id !== set.id);
    const live = [...others.filter((s) => !s.deletedAt), stored];
    if (live.length > MAX_CHILD_SETS)
      return json(400, { error: "too_many_sets", message: `세트는 아이당 ${MAX_CHILD_SETS}개까지 둘 수 있어요. 안 쓰는 세트를 지워 주세요.` });
    const summary = this.setSummary(live);
    await this.putMany({ [this.setPrefix(childId) + set.id]: stored, ["child:" + childId]: { ...c, sets: summary, setsSyncedAt: now, updatedAt: now } });
    return json(200, { ok: true, set: { id: stored.id, name: stored.name, count: stored.words.length, updatedAt: now }, summary });
  }
  async deleteSet(childId, setId) {
    const c = await this.storage.get("child:" + childId);
    if (!c) return json(404, { error: "unknown_child", message: "그 아이의 기록이 없습니다. 목록을 새로고침해 주세요." });
    const cur = await this.storage.get(this.setPrefix(childId) + setId);
    if (!cur || cur.deletedAt) return this.unknownSet();
    const now = new Date().toISOString();
    const tomb = { id: setId, name: cur.name, words: [], updatedAt: now, deletedAt: now };
    const live = (await this.storedSets(childId)).filter((s) => !s.deletedAt && s.id !== setId);
    const summary = this.setSummary(live);
    await this.putMany({ [this.setPrefix(childId) + setId]: tomb, ["child:" + childId]: { ...c, sets: summary, setsSyncedAt: now, updatedAt: now } });
    return json(200, { ok: true, summary });
  }
  // ---- 오늘의 단어 ----
  async savePlan(childId, body) {
    const c = await this.storage.get("child:" + childId);
    if (!c) return json(404, { error: "unknown_child", message: "그 아이의 기록이 없습니다. 목록을 새로고침해 주세요." });
    const parsed = parsePlan(body, c.plan);
    if (parsed.error) return json(400, { error: "bad_request", message: parsed.error });
    const next = { ...c, plan: parsed.plan, updatedAt: new Date().toISOString() };
    await this.storage.put("child:" + childId, next);
    return json(200, { ok: true, child: { ...next, plan: this.planOf(next) } });
  }
  async getDaily(childId, dateParam) {
    const c = await this.storage.get("child:" + childId);
    if (!c) return json(404, { error: "unknown_child", message: "그 아이의 기록이 없습니다." });
    const date = DATE_PATTERN.test(dateParam || "") ? dateParam : kstNow().date;
    const d = await this.storage.get(this.dailyKey(childId, date));
    if (d) return json(200, d);
    if (!this.planOf(c).enabled) return json(409, { error: "plan_disabled", message: "보호자가 아직 오늘의 단어를 켜지 않았어요." });
    return json(404, { error: "no_daily", message: "오늘의 단어가 아직 없어요." });
  }
  async generateDaily(childId, dateParam) {
    const c = await this.storage.get("child:" + childId);
    if (!c) return json(404, { error: "unknown_child", message: "그 아이의 기록이 없습니다." });
    const date = DATE_PATTERN.test(dateParam || "") ? dateParam : kstNow().date;
    const existing = await this.storage.get(this.dailyKey(childId, date));
    if (existing) return json(200, existing);
    const plan = this.planOf(c);
    if (!plan.enabled) return json(409, { error: "plan_disabled", message: "보호자가 아직 오늘의 단어를 켜지 않았어요." });
    const outcome = await this.ensureDaily(c, plan, date);
    if (outcome.failure) return json(outcome.failure.status, outcome.failure.body);
    return json(200, outcome.daily);
  }
  ensureDaily(child, plan, date) {
    const key = this.dailyKey(child.id, date);
    if (!this.generating.has(key)) this.generating.set(key, this.buildDaily(child, plan, date).finally(() => this.generating.delete(key)));
    return this.generating.get(key);
  }
  // 크론(매시): 계획이 켜져 있고 시각이 지났는데 그날 것이 없는 아이에게 만든다.
  async cron({ date, hour }) {
    if (!DATE_PATTERN.test(date || "") || !Number.isInteger(hour)) return json(400, { error: "bad_request", message: "date, hour가 필요합니다." });
    const generated = [], failed = [];
    for (const c of (await this.storage.list({ prefix: "child:" })).values()) {
      const plan = this.planOf(c);
      if (!plan.enabled || plan.hour > hour) continue;
      if (await this.storage.get(this.dailyKey(c.id, date))) continue;
      const outcome = await this.ensureDaily(c, plan, date);
      (outcome.failure ? failed : generated).push(c.id);
      if (outcome.failure) console.error("daily_generate_failed", c.id, outcome.failure.status, outcome.failure.body?.message || "");
    }
    return json(200, { date, hour, generated, failed });
  }
  // 복습(최근 14일 틀린 단어, 최대 3개) + 새 단어(Claude 제안에서 앵커·이미 낸 단어·규칙 위반을 걸러 채움).
  async buildDaily(child, plan, date) {
    const childId = child.id;
    const prefix = this.recordPrefix(childId);
    const since = new Date(Date.parse(date + "T00:00:00+09:00") - DAILY_REVIEW_DAYS * 86400000).toISOString();
    const recent = [...(await this.storage.list({ prefix, start: prefix + since })).values()].reverse();
    const review = [];
    const seen = new Set();
    outer: for (const r of recent) {
      for (const m of r.missed || []) {
        const k = String(m.en).toLowerCase();
        if (seen.has(k) || !WORD_PATTERN.test(m.en)) continue;
        seen.add(k);
        review.push({ en: m.en, ko: m.ko });
        if (review.length >= DAILY_REVIEW_MAX) break outer;
      }
    }
    const served = (await this.storage.get("served:" + childId)) || { words: {} };
    const servedSet = new Set(Object.keys(served.words));
    const anchor = Array.isArray(child.anchor?.words) ? child.anchor.words : [];
    const anchorSet = new Set(anchor.map((w) => w.toLowerCase()));
    const avoid = Object.entries(served.words)
      .sort((a, b) => b[1].localeCompare(a[1]))
      .slice(0, DAILY_EXCLUDE_RECENT)
      .map(([w]) => w);
    const need = Math.max(1, plan.dailyCount - review.length);
    const model = pickDailyModel(this.env);
    const fresh = [];
    const defined = new Map();
    const notes = [];
    for (let attempt = 0; attempt < DAILY_ATTEMPTS && fresh.length < need; attempt++) {
      const outcome = await callAnthropic(this.env, model, {
        model,
        max_tokens: 8192,
        system: DAILY_SYSTEM,
        output_config: { effort: "medium", format: { type: "json_schema", schema: DEFINE_SCHEMA } },
        messages: [{ role: "user", content: dailyUserMessage(plan.level, anchor, [...avoid, ...fresh.map((w) => w.en)], review, (need - fresh.length) * 2) }],
      });
      if (outcome.failure) return { failure: outcome.failure };
      const parsed = parseJsonMessage(outcome.message, {
        refused: "AI가 오늘의 단어 만들기를 거부했어요. 수준 문구를 확인해 주세요.",
        truncated: "AI 응답이 잘렸어요. 하루 단어 수를 줄여 보세요.",
      });
      if (!parsed.data) return { failure: { status: parsed.status, body: parsed.body } };
      for (const w of sanitizeWords(parsed.data)) {
        const k = w.en.toLowerCase();
        if (seen.has(k)) {
          if (!defined.has(k)) defined.set(k, w);
          continue;
        }
        if (!WORD_PATTERN.test(w.en) || servedSet.has(k) || anchorSet.has(k) || fresh.some((f) => f.en.toLowerCase() === k)) continue;
        if (fresh.length < need) fresh.push(w);
      }
      const note = clean(parsed.data?.note);
      if (note) notes.push(note);
    }
    if (!fresh.length && !review.length)
      return { failure: { status: 422, body: { error: "empty", message: "오늘의 단어를 만들지 못했어요. 잠시 후 다시 시도해 주세요." + (notes.length ? " " + notes.join(" ") : "") } } };
    const words = [
      ...review.map((r) => {
        const d = defined.get(r.en.toLowerCase());
        return { en: r.en, ko: d?.ko || r.ko, ipa: d?.ipa || "", aliases: d?.aliases || [], kind: "review" };
      }),
      ...fresh.map((w) => ({ en: w.en, ko: w.ko, ipa: w.ipa, aliases: w.aliases, kind: "new" })),
    ].map((w, i) => ({ id: i + 1, ...w }));
    const daily = { childId, date, level: plan.level, model, createdAt: new Date().toISOString(), words, note: notes.join(" ") };
    for (const w of fresh) served.words[w.en.toLowerCase()] = date;
    const entries = Object.entries(served.words);
    if (entries.length > DAILY_SERVED_MAX) served.words = Object.fromEntries(entries.sort((a, b) => b[1].localeCompare(a[1])).slice(0, DAILY_SERVED_MAX));
    await this.storage.put({ [this.dailyKey(childId, date)]: daily, ["served:" + childId]: served });
    return { daily };
  }
}

// 오늘의 단어 계획(보호자가 아이들 탭에서 저장). 빠진 항목은 기존 값(없으면 기본값)을 유지한다.
function parsePlan(body, current) {
  const plan = { ...DAILY_DEFAULTS, ...(current || {}) };
  if (body?.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") return { error: "enabled는 true 또는 false여야 합니다." };
    plan.enabled = body.enabled;
  }
  if (body?.level !== undefined) {
    const level = clean(body.level);
    if (!level || level.length > 40) return { error: "수준은 1~40자로 적어 주세요." };
    plan.level = level;
  }
  if (body?.dailyCount !== undefined) {
    if (!Number.isInteger(body.dailyCount) || body.dailyCount < DAILY_COUNT_MIN || body.dailyCount > DAILY_COUNT_MAX)
      return { error: `하루 단어 수는 ${DAILY_COUNT_MIN}~${DAILY_COUNT_MAX}개여야 합니다.` };
    plan.dailyCount = body.dailyCount;
  }
  if (body?.hour !== undefined) {
    if (!Number.isInteger(body.hour) || body.hour < 0 || body.hour > 23) return { error: "만드는 시각은 0~23시여야 합니다." };
    plan.hour = body.hour;
  }
  if (body?.timeLimitSec !== undefined) {
    const s = body.timeLimitSec;
    if (!Number.isInteger(s) || s < 0 || (s > 0 && s < TIME_LIMIT_MIN) || s > TIME_LIMIT_MAX)
      return { error: `문제당 제한 시간은 0(없음) 또는 ${TIME_LIMIT_MIN}~${TIME_LIMIT_MAX}초여야 합니다.` };
    plan.timeLimitSec = s;
  }
  plan.updatedAt = new Date().toISOString();
  return { plan };
}

// 아이 기기 정보(선택). 형식이 틀리면 무시한다.
function parseDevice(d) {
  if (!d || typeof d !== "object" || !CHILD_ID_PATTERN.test(String(d.id || ""))) return null;
  return { id: d.id, label: clean(d.label).slice(0, MAX_DEVICE_LABEL) || "기기" };
}
function registerDevice(devices, device, now) {
  const next = { ...(devices || {}) };
  if (!device) return next;
  next[device.id] = { label: device.label, joinedAt: next[device.id]?.joinedAt || now, lastSeenAt: now };
  const ids = Object.keys(next);
  if (ids.length > MAX_DEVICES)
    for (const id of ids.sort((a, b) => String(next[a].lastSeenAt).localeCompare(String(next[b].lastSeenAt))).slice(0, ids.length - MAX_DEVICES)) delete next[id];
  return next;
}

function isoDate(value) {
  if (value == null || value === "") return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

// 아이 기기가 보낸 기록 묶음을 검사·정리한다. 하나라도 틀리면 전체를 거절한다(부분 저장 없음).
function parseSync(body) {
  const id = typeof body?.child?.id === "string" ? body.child.id : "";
  const name = clean(body?.child?.name);
  if (!CHILD_ID_PATTERN.test(id)) return { error: "아이 기기 식별자(child.id)가 올바르지 않습니다." };
  if (!name) return { error: "아이 이름이 필요합니다." };
  if (name.length > MAX_CHILD_NAME) return { error: `아이 이름은 ${MAX_CHILD_NAME}자 이하여야 합니다.` };
  const rawRecords = body.records === undefined ? [] : body.records;
  if (!Array.isArray(rawRecords)) return { error: "records는 배열이어야 합니다." };
  if (rawRecords.length > MAX_SYNC_RECORDS) return { error: `기록은 한 번에 ${MAX_SYNC_RECORDS}개까지 보낼 수 있습니다.` };
  const records = [];
  for (const r of rawRecords) {
    const rid = typeof r?.id === "string" ? r.id : "";
    if (!RECORD_ID_PATTERN.test(rid)) return { error: "기록 id가 올바르지 않습니다." };
    const completedAt = isoDate(r.completedAt);
    const startedAt = isoDate(r.startedAt);
    if (!completedAt || startedAt === undefined) return { error: `기록 ${rid}의 시각이 올바르지 않습니다.` };
    if (!Number.isInteger(r.total) || r.total < 1 || r.total > 2000 || !Number.isInteger(r.correct) || r.correct < 0 || r.correct > r.total)
      return { error: `기록 ${rid}의 점수가 올바르지 않습니다.` };
    if (!FAMILY_MODES.includes(r.mode)) return { error: `기록 ${rid}의 시험 방식이 올바르지 않습니다.` };
    const rawMissed = r.missed === undefined ? [] : r.missed;
    if (!Array.isArray(rawMissed) || rawMissed.length > MAX_MISSED_WORDS) return { error: `기록 ${rid}의 틀린 단어 목록이 올바르지 않습니다.` };
    const missed = rawMissed
      .map((m) => ({ en: clean(m?.en).slice(0, 80), ko: clean(m?.ko).slice(0, 200), ...(m?.unknown === true ? { unknown: true } : {}) }))
      .filter((m) => m.en);
    records.push({
      id: rid,
      setName: clean(r.setName).slice(0, 120) || "(이름 없음)",
      mode: r.mode,
      range: clean(r.range).slice(0, 60),
      startedAt,
      completedAt,
      total: r.total,
      correct: r.correct,
      partial: r.partial === true,
      activeMs: Number.isInteger(r.activeMs) && r.activeMs >= 0 ? Math.min(r.activeMs, 7 * 86400000) : null,
      missed,
      ...(typeof r.daily === "string" && DATE_PATTERN.test(r.daily) ? { daily: r.daily } : {}), // 오늘의 단어로 본 시험
      // 문제 중 화면 이탈(앱이 가려짐·다른 앱) 횟수·시간: 보호자 폰에 ⚠️로 표시
      ...(Number.isInteger(r.awayCount) && r.awayCount > 0
        ? { awayCount: Math.min(r.awayCount, 10000), awayMs: Number.isInteger(r.awayMs) && r.awayMs >= 0 ? Math.min(r.awayMs, 86400000) : 0 }
        : {}),
      ...(Number.isInteger(r.timeouts) && r.timeouts > 0 ? { timeouts: Math.min(r.timeouts, 2000) } : {}), // 제한 시간 초과로 모름 처리된 문제 수
      ...(Number.isInteger(r.aiPass) && r.aiPass > 0 ? { aiPass: Math.min(r.aiPass, 2000) } : {}), // AI 2차 채점이 정답으로 인정한 문제 수
    });
  }
  let sets;
  if (body.sets !== undefined) {
    if (!Array.isArray(body.sets) || body.sets.length > MAX_SYNC_SETS) return { error: "세트 목록이 올바르지 않습니다." };
    sets = body.sets
      .map((s) => ({ name: clean(s?.name).slice(0, 120), count: Number.isInteger(s?.count) && s.count >= 0 ? Math.min(s.count, 5000) : 0 }))
      .filter((s) => s.name);
  }
  let anchor;
  if (body.anchor !== undefined) {
    if (!body.anchor || typeof body.anchor !== "object" || !Array.isArray(body.anchor.words)) return { error: "anchor 형식이 올바르지 않습니다." };
    const words = [...new Set(body.anchor.words.map((w) => clean(w)).filter((w) => WORD_PATTERN.test(w)))].slice(0, MAX_ANCHOR_WORDS);
    anchor = { setName: clean(body.anchor.setName).slice(0, 120), words };
  }
  return { child: { id, name }, records, sets, anchor, device: parseDevice(body.device) };
}

// 세트의 단어 하나. 번호·영어·뜻이 없으면 null.
function parseSetWord(w) {
  if (!w || typeof w !== "object") return null;
  const id = Number.isInteger(w.id) ? w.id : typeof w.id === "string" ? clean(w.id).slice(0, 32) : "";
  if (id === "") return null;
  const en = clean(w.en).slice(0, 80);
  const ko = clean(w.ko).slice(0, 200);
  if (!en || !ko) return null;
  const aliases = [...new Set((Array.isArray(w.aliases) ? w.aliases : []).map((a) => clean(a).slice(0, 60)).filter(Boolean))].slice(0, MAX_WORD_ALIASES);
  return { id, en, ko, ipa: clean(w.ipa).slice(0, 80), hangul: clean(w.hangul).slice(0, 80), aliases };
}
// 세트 하나(앱의 저장 형식과 같다). 아이 기기가 올릴 때는 updatedAt이 필수, 보호자가 보낼 때는 서버가 붙인다.
function parseSet(raw, { requireUpdatedAt }) {
  if (!raw || typeof raw !== "object") return { error: "세트 형식이 올바르지 않습니다." };
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!SET_ID_PATTERN.test(id)) return { error: "세트 id가 올바르지 않습니다." };
  const name = clean(raw.name).slice(0, MAX_SET_NAME);
  if (!name) return { error: "세트 이름이 비어 있습니다." };
  if (!Array.isArray(raw.words) || !raw.words.length || raw.words.length > MAX_SET_WORDS)
    return { error: `세트 ‘${name}’의 단어는 1~${MAX_SET_WORDS}개여야 합니다.` };
  const words = [];
  const ids = new Set();
  for (const w of raw.words) {
    const p = parseSetWord(w);
    if (!p) return { error: `세트 ‘${name}’에 번호·영어·뜻이 빈 단어가 있습니다.` };
    if (ids.has(String(p.id))) return { error: `세트 ‘${name}’에 번호가 겹치는 단어가 있습니다.` };
    ids.add(String(p.id));
    words.push(p);
  }
  let updatedAt;
  if (requireUpdatedAt) {
    updatedAt = isoDate(raw.updatedAt);
    if (!updatedAt) return { error: `세트 ‘${name}’의 수정 시각이 올바르지 않습니다.` };
  }
  return { set: { id, name, words, ...(updatedAt ? { updatedAt } : {}) } };
}
// 아이 기기의 세트 동기화 요청(POST /sets/<childId>). 하나라도 틀리면 전체 거절.
function parseSetsSync(body) {
  if (!body || typeof body !== "object") return { error: "JSON 본문이 필요합니다." };
  const rawKnown = body.known === undefined ? [] : body.known;
  const rawSets = body.sets === undefined ? [] : body.sets;
  const rawDeleted = body.deleted === undefined ? [] : body.deleted;
  if (!Array.isArray(rawKnown) || rawKnown.length > MAX_CHILD_SETS * 2) return { error: "known은 세트 목록 배열이어야 합니다." };
  if (!Array.isArray(rawSets) || rawSets.length > MAX_CHILD_SETS) return { error: `세트는 한 번에 ${MAX_CHILD_SETS}개까지 보낼 수 있습니다.` };
  if (!Array.isArray(rawDeleted) || rawDeleted.length > MAX_SET_TOMBSTONES) return { error: "deleted 형식이 올바르지 않습니다." };
  const known = [];
  for (const k of rawKnown) {
    if (!k || !SET_ID_PATTERN.test(String(k.id || ""))) return { error: "known의 세트 id가 올바르지 않습니다." };
    known.push({ id: k.id, updatedAt: isoDate(k.updatedAt) || "" });
  }
  const sets = [];
  for (const raw of rawSets) {
    const p = parseSet(raw, { requireUpdatedAt: true });
    if (p.error) return p;
    sets.push(p.set);
  }
  const deleted = [];
  for (const d of rawDeleted) {
    if (!d || !SET_ID_PATTERN.test(String(d.id || ""))) return { error: "deleted의 세트 id가 올바르지 않습니다." };
    const t = isoDate(d.deletedAt);
    if (!t) return { error: "deleted의 시각이 올바르지 않습니다." };
    deleted.push({ id: d.id, deletedAt: t });
  }
  return { known, sets, deleted, device: parseDevice(body.device) };
}
// 보호자가 보내는 세트(POST /family/<childId>/sets). id가 없으면 새로 만든다.
function parseSetUpload(body) {
  const raw = body?.set;
  if (!raw || typeof raw !== "object") return { error: "set이 필요합니다." };
  const p = parseSet({ ...raw, id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID() }, { requireUpdatedAt: false });
  if (p.error) return p;
  return { set: p.set };
}

// /sync, /join, /sets, /daily…, /family… 처리. 오늘의 단어 생성 외에는 Anthropic을 부르지 않는다.
// kind: sync·join·sets·daily·settings·records(가족 또는 보호자 코드) / view(보호자 코드만: 기록 보기·삭제·아이 만들기·계획·코드·이름·세트)
async function family(request, env, path, cors) {
  if (!env.APP_PASSCODE)
    return json(500, { error: "misconfigured", message: "AI 서버에 비밀값(APP_PASSCODE)이 설정되지 않았습니다." }, cors);
  const kind =
    path === "/sync" ? "sync" : path === "/join" ? "join" : SETS_PATH.test(path) ? "sets" : DAILY_PATH.test(path) ? "daily" : SETTINGS_PATH.test(path) ? "settings" : RECORDS_PATH.test(path) ? "records" : "view";
  const setsRoute = kind === "sets" || (kind === "view" && CHILD_SETS_PATH.test(path)); // 세트 본문은 크다(2MB까지)
  if (kind === "view" && !env.PARENT_PASSCODE)
    return json(500, {
      error: "misconfigured",
      message: "보호자 코드(PARENT_PASSCODE)가 아직 설정되지 않았습니다. 보호자가 worker 폴더에서 npx wrangler secret put PARENT_PASSCODE 로 등록한 뒤 다시 시도해 주세요.",
    }, cors);
  const role = roleOf(request, env);
  if (!role) return json(401, { error: "unauthorized", message: "접속 코드가 맞지 않습니다." }, cors);
  if (kind === "view" && role !== "parent") return json(401, { error: "unauthorized", message: "보호자 코드가 맞지 않습니다." }, cors);
  const limited = await rateLimited(request, env, "/" + (kind === "view" ? "family" : kind), cors);
  if (limited) return limited;
  if (!env.FAMILY)
    return json(500, { error: "misconfigured", message: "AI 서버에 가족 기록함(FAMILY)이 아직 없습니다. 보호자가 Worker를 새 버전으로 다시 배포해 주세요." }, cors);
  let payload;
  if (request.method === "POST") {
    const text = await request.text();
    if (text.length > (setsRoute ? MAX_SETS_BODY : kind === "sync" ? MAX_SYNC_BODY : MAX_PLAN_BODY))
      return json(413, { error: "too_large", message: "보내는 내용이 너무 큽니다. 앱을 새 버전으로 불러온 뒤 다시 시도해 주세요." }, cors);
    let body = {};
    if (text || kind === "sync" || setsRoute) {
      try {
        body = JSON.parse(text);
      } catch {
        return json(400, { error: "bad_request", message: "JSON 본문이 필요합니다." }, cors);
      }
    }
    if (kind === "sync" || setsRoute) {
      const parsed = kind === "sync" ? parseSync(body) : kind === "sets" ? parseSetsSync(body) : parseSetUpload(body);
      if (parsed.error) return json(400, { error: "bad_request", message: parsed.error }, cors);
      payload = parsed;
    } else payload = body && typeof body === "object" ? body : {};
  }
  try {
    const stub = env.FAMILY.get(env.FAMILY.idFromName("family"));
    const response = await stub.fetch("https://family.internal" + path + (request.method === "GET" ? new URL(request.url).search : ""), {
      method: request.method,
      headers: { "content-type": "application/json" },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    return json(response.status, await response.json(), cors);
  } catch (e) {
    console.error("family_store_failed", e?.name || "", e?.message || "");
    return json(503, { error: "family_unavailable", message: "가족 기록함에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." }, cors);
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

// 구조화 출력 응답에서 JSON을 꺼낸다. 거부·잘림·해석 실패는 상태 코드와 본문으로 돌려준다.
function parseJsonMessage(message, hints) {
  if (message.stop_reason === "refusal") return { status: 422, body: { error: "refused", message: hints.refused } };
  if (message.stop_reason === "max_tokens") return { status: 422, body: { error: "truncated", message: hints.truncated } };
  const text = (message.content || [])
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("");
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { status: 502, body: { error: "bad_upstream", message: "AI 응답을 해석하지 못했습니다. 다시 시도해 주세요." } };
  }
}
function readJsonMessage(message, cors, hints) {
  const parsed = parseJsonMessage(message, hints);
  return parsed.data ? { data: parsed.data } : { response: json(parsed.status, parsed.body, cors) };
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

// 단어 찾기: POST /lookup {word} → {found, en, suggestion, pos, ko, ipa, aliases, examples:[{en,ko}], similar, note, model, usage}.
async function lookupWord(request, env, cors) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "bad_request", message: "JSON 본문이 필요합니다." }, cors);
  }
  const word = clean(body?.word).replace(/\s+/g, " ");
  if (!word) return json(400, { error: "bad_request", message: "word 필드에 찾을 영어 단어가 필요합니다." }, cors);
  if (!WORD_PATTERN.test(word)) return json(400, { error: "bad_request", message: `영어 단어만 찾을 수 있습니다: ‘${word.slice(0, 40)}’` }, cors);
  const model = pickLookupModel(env);
  const outcome = await callAnthropic(env, model, {
    model,
    max_tokens: 2048,
    system: LOOKUP_SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: LOOKUP_SCHEMA } },
    messages: [{ role: "user", content: `단어: ${word}` }],
  });
  if (outcome.failure) return json(outcome.failure.status, outcome.failure.body, cors);
  const read = readJsonMessage(outcome.message, cors, { refused: "AI가 이 단어의 처리를 거부했습니다.", truncated: "AI 응답이 잘렸습니다. 다시 시도해 주세요." });
  if (read.response) return read.response;
  const d = read.data || {};
  const ko = clean(d.korean).slice(0, 200);
  const found = d.found === true && Boolean(ko);
  const strings = (list, max, limit) => [...new Set((Array.isArray(list) ? list : []).map((s) => clean(s).slice(0, limit)).filter(Boolean))].slice(0, max);
  const examples = (Array.isArray(d.examples) ? d.examples : [])
    .map((e) => ({ en: clean(e?.english).slice(0, 200), ko: clean(e?.korean).slice(0, 200) }))
    .filter((e) => e.en && e.ko)
    .slice(0, 3);
  return json(200, {
    found,
    en: (clean(d.english).slice(0, 60) || word),
    suggestion: found ? "" : clean(d.suggestion).slice(0, 60),
    pos: found ? clean(d.pos).slice(0, 20) : "",
    ko: found ? ko : "",
    ipa: found ? clean(d.ipa).replace(/^\[|\]$/g, "").slice(0, 80) : "",
    aliases: found ? strings(d.aliases, 10, 60) : [],
    examples: found ? examples : [],
    similar: found ? strings(d.similar, 4, 40).filter((s) => WORD_PATTERN.test(s)) : [],
    note: clean(d.note).slice(0, 200),
    model: outcome.message.model || model,
    usage: usageOf(outcome.message),
  }, cors);
}

// 2차 채점: POST /grade {en, ko, aliases?, answer} → {accept, reason, model, usage}. 앱은 기기 채점이 오답일 때만 부르고, 실패하면 오답으로 둔다.
async function gradeAnswer(request, env, cors) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "bad_request", message: "JSON 본문이 필요합니다." }, cors);
  }
  const en = clean(body?.en).slice(0, 80);
  const ko = clean(body?.ko).slice(0, 200);
  const answer = clean(body?.answer).slice(0, MAX_GRADE_ANSWER);
  if (!en || !ko || !answer) return json(400, { error: "bad_request", message: "en, ko, answer가 필요합니다." }, cors);
  const aliases = [...new Set((Array.isArray(body?.aliases) ? body.aliases : []).map((a) => clean(a).slice(0, 60)).filter(Boolean))].slice(0, 30);
  const model = pickGradeModel(env);
  const outcome = await callAnthropic(env, model, {
    model,
    max_tokens: 256,
    system: GRADE_SYSTEM,
    output_config: { format: { type: "json_schema", schema: GRADE_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `영어 단어: ${en}\n교재의 뜻: ${ko}\n이미 정답으로 인정하는 답: ${aliases.join(", ") || "(없음)"}\n학생의 답: ${answer}`,
      },
    ],
  });
  if (outcome.failure) return json(outcome.failure.status, outcome.failure.body, cors);
  const read = readJsonMessage(outcome.message, cors, { refused: "AI가 이 답의 판정을 거부했습니다.", truncated: "AI 응답이 잘렸습니다." });
  if (read.response) return read.response;
  return json(200, {
    accept: read.data?.accept === true,
    reason: clean(read.data?.reason).slice(0, 60),
    model: outcome.message.model || model,
    usage: usageOf(outcome.message),
  }, cors);
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
  // 크론(매시 0분): 한국 시각 기준 날짜·시를 가족 기록함에 넘겨 계획 시각이 지난 아이의 오늘의 단어를 만든다.
  async scheduled(controller, env, ctx) {
    if (!env.FAMILY) return;
    const run = env.FAMILY.get(env.FAMILY.idFromName("family"))
      .fetch("https://family.internal/cron", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kstNow(Number.isFinite(controller?.scheduledTime) ? controller.scheduledTime : Date.now())),
      })
      .then(async (r) => console.log("daily_cron", r.status, (await r.text()).slice(0, 300)))
      .catch((e) => console.error("daily_cron_failed", e?.name || "", e?.message || ""));
    if (ctx?.waitUntil) ctx.waitUntil(run);
    else await run;
  },
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/diag") return diag(request, env, cors);
    const familyRoute =
      (path === "/sync" && request.method === "POST") ||
      (FAMILY_PATH.test(path) && ["GET", "DELETE"].includes(request.method)) ||
      (CHILDREN_PATH.test(path) && request.method === "POST") ||
      (CHILD_ACTION_PATH.test(path) && request.method === "POST") ||
      (path === "/join" && request.method === "POST") ||
      (SETS_PATH.test(path) && request.method === "POST") ||
      (CHILD_SETS_PATH.test(path) && ["GET", "POST", "DELETE"].includes(request.method)) ||
      (DAILY_PATH.test(path) && ["GET", "POST"].includes(request.method)) ||
      (SETTINGS_PATH.test(path) && request.method === "GET") ||
      (RECORDS_PATH.test(path) && request.method === "GET");
    const aiRoute = request.method === "POST" && ["/ping", "/recognize", "/define", "/grade", "/lookup"].includes(path);
    if (!familyRoute && !aiRoute)
      return json(404, { error: "not_found", message: "지원하지 않는 요청입니다." }, cors);
    const origin = request.headers.get("Origin");
    if (origin && !allowedOrigins(env).includes(origin))
      return json(403, { error: "forbidden_origin", message: "이 주소에서는 AI 서버를 쓸 수 없습니다. 보호자가 ALLOWED_ORIGINS를 확인해 주세요." }, cors);
    if (familyRoute) return family(request, env, path, cors);
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
    if (!roleOf(request, env))
      return json(401, { error: "unauthorized", message: "접속 코드가 맞지 않습니다." }, cors);
    const limited = await rateLimited(request, env, path, cors);
    if (limited) return limited;
    const model = pickModel(env);
    if (path === "/ping") return ping(env, model, cors);
    if (path === "/define") return define(request, env, model, cors);
    if (path === "/grade") return gradeAnswer(request, env, cors);
    if (path === "/lookup") return lookupWord(request, env, cors);
    return recognize(request, env, model, cors);
  },
};
