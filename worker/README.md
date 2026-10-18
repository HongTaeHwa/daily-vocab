# AI 사진 인식·사전 프록시 (Cloudflare Worker)

앱(GitHub Pages)은 Anthropic API를 직접 부르지 않고 이 Worker만 호출합니다. 사진 인식(`/recognize`), 영어 단어 목록의 뜻·발음을 찾는 AI 사전(`/define`), 아이 기기가 보낸 시험 기록을 저장해 보호자 폰에 보여 주는 가족 기록함(`/sync`, `/family`), 아이 단위 세트 저장소(`/sets`, `/family/<childId>/sets`), 그리고 매일 아이 수준에 맞는 ‘오늘의 단어’를 만드는 생성기(`/daily`, 크론)를 처리합니다. Anthropic API 키는 Worker의 비밀값에만 있고, 앱·저장소·태블릿 어디에도 들어가지 않습니다. 가족용 **접속 코드**가 맞는 요청만 처리합니다.

```
태블릿 앱 ──(사진 + 접속 코드)──▶ Worker ──(API 키)──▶ Anthropic
            ◀── 번호·영어·뜻·허용 답안 ──┘
아이 기기 ──(시험 기록 + 접속 코드)──▶ Worker 가족 기록함(Durable Object)
보호자 폰 ◀──(아이별 기록, 보호자 코드)── ┘
```

## 처음 한 번 배포하기 (약 5분)

필요한 것: [Cloudflare 계정](https://dash.cloudflare.com/sign-up)(무료), [Anthropic API 키](https://platform.claude.com/settings/keys)(아래 ‘Anthropic 키 만들기’ 참고), Node.js.

```bash
cd worker
npm install
```

1. Cloudflare 로그인 (브라우저가 열리면 허용):
   ```bash
   npm run login
   ```
2. 비밀값 두 개 입력 (키와 코드는 화면에 표시되지 않습니다. 접속 코드는 가족끼리 쓸 4자 이상 문자열을 정하세요):
   ```bash
   npm run secrets
   ```
3. 배포. 마지막 줄에 `https://daily-vocab-ai.<계정이름>.workers.dev` 형태의 주소가 나옵니다:
   ```bash
   npm run deploy
   ```
4. 태블릿에서 앱을 열고 `🔒 보호자 설정 · AI 연결`에 접속 코드를 입력 → `저장` → `연결 확인`. 서버 주소는 앱에 기본값(`https://daily-vocab-ai.reonwipe.workers.dev`)으로 들어 있고, 다른 주소로 배포했다면 그 주소로 바꿉니다.
5. (선택) 보호자 폰에서 아이들의 시험 기록을 보려면 **보호자 코드**도 등록합니다(아래 ‘가족 기록함’ 참고):
   ```bash
   npm run parent-code
   ```

Anthropic 콘솔에서 **월 사용 한도(spend limit)** 를 꼭 설정하세요. 이 키는 이 Worker 전용으로 만들어 두면 문제가 생겼을 때 그 키만 삭제하면 됩니다.

## Anthropic 키 만들기 (워크스페이스 + 월 한도)

1. https://platform.claude.com → **Settings → Workspaces → Create workspace** → 이름 `daily-vocab`.
2. 만든 워크스페이스를 선택 → **Spend limits**에서 월 한도와 알림을 설정합니다. 기본 워크스페이스에는 한도를 걸 수 없습니다.
3. **Settings → API keys → Create key** → 이름 `daily-vocab-worker`, Expiration `Never`(Worker 비밀값으로만 보관), Linked account 본인, Workspace `daily-vocab`. 키는 한 번만 표시되므로 바로 `npm run secrets`에 붙여넣습니다.
4. 크레딧은 조직 단위로 공유됩니다(Max/Team 플랜의 월간 API 크레딧 포함). **Settings → Billing**에서 잔액과 자동 충전 여부를 확인하세요. 키가 샜다고 의심되면 같은 API keys 페이지에서 **Delete** 합니다.

## 가족 기록함 (아이들 시험 기록 · 보호자 코드)

아이 기기는 시험을 마칠 때마다 압축 기록(아이 이름, 세트 이름·단어 수, 방식·범위, 점수, 푼 시간, 틀린 단어의 영어·뜻)을 `POST /sync`로 보내고, 보호자 폰은 `GET /family`로 아이별 기록을 읽습니다. 저장소는 `worker.js`의 `FamilyStore`(SQLite 기반 Durable Object, `wrangler.jsonc`의 `FAMILY` 바인딩과 마이그레이션 `v2`)이며 무료 플랜에서 동작합니다. 외부 서비스는 쓰지 않습니다.

- **코드 두 가지**: 가족 코드(`APP_PASSCODE`)는 사진 인식·AI 사전·기록 보내기에, 보호자 코드(`PARENT_PASSCODE`)는 기록 읽기·삭제에 씁니다. 보호자 코드는 가족 코드가 통하는 곳에 모두 통하지만 그 반대는 아닙니다. 아이 기기에는 가족 코드만 넣으므로 형제의 기록을 볼 수 없습니다.
- **아이와 아이 코드**: 보호자 폰이 `POST /family/children`으로 아이를 만들면 6자리 아이 코드가 발급됩니다(`code:<코드>` → 아이 번호). 아이 기기는 `POST /join`(가족 코드)에 코드와 기기 정보를 보내 아이 번호를 받고, 이후 `/sync`에 그 번호로 기록을 보냅니다. 같은 코드를 넣은 기기(아이폰·태블릿)는 한 아이로 묶이며 `child.devices`에 기기 종류·마지막 접속이 남습니다(최대 10대). 코드는 `POST /family/<childId>/code`로 새로 만들 수 있고(옛 코드 무효), 이름은 `POST /family/<childId>/name`으로 바꿉니다. 아이 이름은 서버가 기준이라 기기가 보낸 이름으로 덮어쓰지 않습니다. 전용 링크 `…/daily-vocab/?child=<코드>`는 앱이 열릴 때 코드를 읽어 자동 연결합니다.
- 보호자 코드 등록·변경: `npm run parent-code`(= `npx wrangler secret put PARENT_PASSCODE`, 4자 이상). 등록하지 않으면 `/family…`가 500으로 “보호자 코드(PARENT_PASSCODE)가 아직 설정되지 않았습니다”를 돌려줍니다.
- 보관: 아이(기기)마다 최근 5,000개까지, 넘으면 오래된 것부터 지웁니다. 같은 기록을 다시 보내면 덮어씁니다. 아이 항목과 기록은 보호자 폰의 ‘아이들’ 탭에서 삭제(`DELETE /family/<childId>`)할 수 있고, 아이 기기에서 기록을 지워도 서버 사본은 남습니다. 지운 아이 id는 `gone:<childId>` 묘비로 남아 연결돼 있던 기기가 `/sync`를 보내도 되살아나지 않고 404 `unknown_child`를 받습니다(앱은 ‘보호자가 이 아이를 서버에서 지웠어요’ 안내 뒤 새 코드로 다시 연결할 때까지 요청을 멈춥니다). 모르는 새 id의 `/sync`는 옛 앱 호환으로 아이를 만듭니다. 기기를 바꾸면 새 `childId`로 새 아이처럼 보입니다.
- 한도: 본문 256KB, 기록 100개/회, 틀린 단어 200개/기록, 이름 20자. 요청 제한은 `/sync`, `/family` 버킷으로 IP당 분당 30회(공통 설정).
- **세트 동기화(아이 단위)**: 세트는 `set:<childId>:<setId>` 키로 아이에게 속합니다. 아이 기기는 `POST /sets/<childId>`(가족 코드)에 기기의 세트 목록(`known`: id·수정 시각), 새로 만들거나 고친 세트 전체(`sets`), 지운 세트 묘비(`deleted`)를 보내고, 서버에 없거나 더 새 버전인 세트 전체와 지워진 id, 전체 요약을 받습니다. 세트마다 `updatedAt`이 나중인 쪽이 이기고 삭제는 `deletedAt` 묘비로 남아 다른 기기에서도 지워집니다(지운 뒤 다른 기기가 고치면 되살아남). 보호자 폰은 `GET /family/<childId>/sets`로 목록을 보고 `POST`로 세트를 만들어 보내거나 고치며(`updatedAt`은 서버가 붙임) `DELETE …/sets/<setId>`로 지웁니다. 아이 항목의 `sets` 요약은 서버가 계산하고, 동기화를 시작한 아이는 옛 앱이 `/sync`로 보낸 세트 목록으로 덮어쓰지 않습니다. 한도: 아이당 50세트, 세트당 2,000단어, 본문 2MB. 아이를 지우면 세트도 지워집니다.
- 2026-10-18 이전에 배포한 Worker에는 이 기능이 없어 앱이 “다시 배포” 안내를 띄웁니다. `npm run deploy` 뒤 `npm run parent-code`를 실행하세요.

## 오늘의 단어 (매일 생성 · 크론)

보호자가 아이별 계획(`POST /family/<childId>/plan`: 켜기, 수준, 하루 단어 수 5~20, 만드는 시각 0~23시 KST)을 저장하면, 매시 0분에 실행되는 크론(`wrangler.jsonc`의 `triggers.crons`)이 한국 시각 기준 계획 시각이 지난 아이의 그날 단어를 만들어 `FamilyStore`에 저장합니다. 아이 기기가 먼저 열리면 `POST /daily/<childId>`로 그 자리에서 만듭니다(같은 날 두 번 만들지 않음).

- 구성: 복습 최대 3개(최근 14일 기록의 틀린 단어, 최신순) + 새 단어. 새 단어는 `DAILY_MODEL`(기본 `claude-sonnet-5-5`)에 수준 문구, 아이 기기가 `/sync`로 보낸 최근 세트 단어(교재 앵커, 최대 60개; 손대지 않은 기본 예제 세트는 제외하고, 기기가 `words`가 빈 `anchor`를 보내면 저장된 앵커를 지우며 `anchor`를 아예 보내지 않으면 그대로 둠), 최근에 이미 낸 단어(최대 200개), 복습 단어를 넘겨 필요한 수의 2배를 받은 뒤 앵커·이미 낸 단어·규칙 위반을 걸러 채웁니다. 모자라면 한 번 더 요청합니다. 아이별 ‘이미 낸 단어’는 5,000개까지 기억합니다.
- 형식은 AI 사전과 같아(영어·뜻·발음·허용 답안) 앱의 시험 엔진이 그대로 채점합니다. 기록에 `daily: "YYYY-MM-DD"`가 붙어 오면 그날 것에 완료(점수)를 표시합니다(중단 기록 제외).
- 비용: 아이당 하루 1회, 텍스트 20단어 안팎이라 1원 미만 수준입니다. 품질이 아쉬우면 `DAILY_MODEL`을 `claude-opus-5-5`로 바꾸고 `npm run deploy`.
- 크론은 Workers 무료 플랜에서 동작합니다. 배포 로그의 `scheduled` 항목 또는 `npm run tail`의 `daily_cron` 줄로 확인할 수 있습니다.

## 지역 차단과 북미 중계 (Durable Object)

한국에서 온 요청은 Cloudflare의 홍콩(HKG) 데이터센터에서 실행될 때가 있는데, Anthropic은 홍콩발 요청을 `403 forbidden: Request not allowed`로 거절합니다. 그래서 Worker는 Anthropic 호출만 북미에 고정된 Durable Object(`AnthropicRelay`, `locationHint: wnam`)를 통해 보냅니다. `wrangler.jsonc`의 `durable_objects`와 `migrations`가 이 설정이며, 무료 플랜에서 동작합니다.

확인 방법(비밀값 불필요): `https://daily-vocab-ai.reonwipe.workers.dev/diag` 를 열면 `{"colo":"HKG","relay":true,"upstreamStatus":401,"ok":true,…}` 처럼 나와야 합니다. `ok`가 `false`이고 `upstreamStatus`가 403이면 중계가 동작하지 않는 것입니다.

같은 이유로 앱의 오류 안내는 Anthropic의 응답 코드·종류·메시지를 `[Anthropic 403 forbidden: Request not allowed]` 형태로 덧붙여 보여 줍니다. 키 형식이 잘못 등록된 경우(공백·줄바꿈·제어 문자)는 Anthropic에 보내기 전에 걸러서 "키가 올바른 형식이 아닙니다(길이 N, …)"로 알려 줍니다. 터미널에서 Ctrl+V가 붙여넣기 대신 제어 문자를 입력하는 경우가 있으니, `wrangler secret put` 프롬프트에는 마우스 오른쪽 클릭이나 Ctrl+Shift+V로 붙여넣으세요.

## 설정 바꾸기

| 항목 | 방법 |
|---|---|
| 모델 | `wrangler.jsonc`의 `CLAUDE_MODEL` (`claude-opus-5-5` 기본 / `claude-sonnet-5-5` / `claude-haiku-5-5`) 수정 후 `npm run deploy`. 2차 채점 모델은 `GRADE_MODEL`(기본 `claude-haiku-5-5`), 단어 찾기는 `LOOKUP_MODEL`(기본 `claude-sonnet-5-5`), 오늘의 단어는 `DAILY_MODEL` |
| 오늘의 단어 모델 | `wrangler.jsonc`의 `DAILY_MODEL` (기본 `claude-sonnet-5-5`) 수정 후 `npm run deploy` |
| 오늘의 단어 크론 | `wrangler.jsonc`의 `triggers.crons` (기본 매시 0분; 생성 시각은 아이별 계획의 `hour`) |
| 허용 주소 | `wrangler.jsonc`의 `ALLOWED_ORIGINS` (쉼표로 여러 개). 앱 주소가 바뀌면 여기도 바꿉니다 |
| 분당 요청 제한 | `wrangler.jsonc`의 `ratelimits[0].simple.limit` (기본 30회/분, IP당) |
| 접속 코드 변경 | `npx wrangler secret put APP_PASSCODE` 후 태블릿의 보호자 설정에서 새 코드 저장 |
| 보호자 코드 등록·변경 | `npm run parent-code`(= `npx wrangler secret put PARENT_PASSCODE`) 후 보호자 폰의 설정 → 가족 기록함에 새 코드 저장 |
| 워크스페이스 지정 | 키가 특정 워크스페이스에 묶여 있지 않아 `anthropic-workspace-id` 오류가 나면 `wrangler.jsonc`의 `vars`에 `"ANTHROPIC_WORKSPACE_ID": "wrkspc_…"`(Settings → Workspaces의 ID 열) 추가 후 `npm run deploy` |
| API 키 교체 | `npx wrangler secret put ANTHROPIC_API_KEY` |
| 요청 로그 보기 | `npm run tail` |

## 로컬에서 실행해 보기

`worker/.dev.vars` 파일(커밋 금지)에 아래를 적고 `npm run dev`를 실행하면 `http://localhost:8787`에서 동작합니다. 앱은 `node .claude/dev-server.cjs`로 띄운 뒤 보호자 설정에 `http://localhost:8787`을 넣습니다.

```
ANTHROPIC_API_KEY=sk-ant-...
APP_PASSCODE=family-1234
ALLOWED_ORIGINS=http://127.0.0.1:8000,http://localhost:8000
```

## API

| 요청 | 설명 |
|---|---|
| `POST /ping` · 헤더 `X-App-Passcode` | 접속 코드와 Anthropic 연결을 확인. `{ ok: true, model }` |
| `POST /recognize` · 헤더 `X-App-Passcode` · JSON `{ image: base64, mediaType }` | 사진 한 장에서 단어 추출. `{ words: [{ number, en, ko, ipa, aliases, generated }], note, model, usage }`. 사진에 뜻이 인쇄되지 않은 단어(영어만 있는 목록·시험지)는 AI가 뜻·발음을 채우고 `generated: true`로 표시합니다 |
| `POST /lookup` · 헤더 `X-App-Passcode` · JSON `{ word }` | 단어 찾기(아이 기기의 🔍 찾기 탭). 영어 단어·짧은 구 하나 → `{ found, en, suggestion, pos, ko, ipa, aliases, examples: [{ en, ko }], similar, note, model, usage }`. 모르는 단어·철자 오류는 `found: false`와 철자 제안 `suggestion`. 모델은 `LOOKUP_MODEL`(기본 `claude-sonnet-5-5`) |
| `POST /grade` · 헤더 `X-App-Passcode` · JSON `{ en, ko, aliases?, answer }` | AI 2차 채점. 앱이 책의 뜻·허용 답안과 글자 그대로 맞지 않는 답만 보내면 ‘같은 뜻인지’ 판정 → `{ accept, reason, model, usage }`. 모델은 `GRADE_MODEL`(기본 `claude-haiku-5-5`, 빠르고 저렴). 동의어·조사/어미 차이·합성어·한 글자 오타는 인정, 다른 뜻·막연한 답·여러 뜻 나열은 거절 |
| `POST /define` · 헤더 `X-App-Passcode` · JSON `{ words: ["apple", …] }` | AI 사전. 영어 단어·짧은 구 최대 60개(영문자·공백·.'’- 40자 이하) → `{ words: [{ en, ko, ipa, aliases }], note, model, usage }`. 요청한 철자 그대로 한 번씩 돌려주고 모르는 단어는 빠집니다(전부 모르면 422). 앱의 ‘빈 뜻 AI로 채우기’가 40개씩 보냅니다 |
| `POST /sync` · 헤더 `X-App-Passcode`(가족 또는 보호자 코드) · JSON `{ child: { id, name }, records: [{ id, setName, mode, range, startedAt, completedAt, total, correct, partial, activeMs, daily?, awayCount?, awayMs?, timeouts?, missed: [{ en, ko, unknown? }] }], sets: [{ name, count }], anchor?: { setName, words }, device?: { id, label } }` | 아이 기기의 시험 기록 저장(기록 최대 100개, 같은 id는 덮어씀). `anchor.words`가 비어 있으면 저장된 수준 기준을 지웁니다. 보호자가 지운 아이 id는 404 `unknown_child`. `{ ok, stored, trimmed, syncedAt }` |
| `GET /family` · 헤더 `X-App-Passcode`(보호자 코드만) | 아이별 요약 `{ children: [{ id, name, sets, lastTestAt, updatedAt, records }], serverTime }`. `records`는 최근 14일(20개 미만이면 최근 20개), 최신순 |
| `GET /family/<childId>` · 보호자 코드 | 한 아이의 전체 기록 `{ child, records }`(최신순). 모르는 아이는 404 `unknown_child` |
| `DELETE /family/<childId>` · 보호자 코드 | 아이 항목과 기록·오늘의 단어 삭제. `{ ok, deleted }` |
| `POST /family/<childId>/plan` · 보호자 코드 · JSON `{ enabled, level, dailyCount, hour, timeLimitSec }` | 오늘의 단어 계획과 문제당 제한 시간(0 또는 5~120초, 모든 시험에 적용) 저장(빠진 항목은 유지). `{ ok, child }` |
| `GET /settings/<childId>` · 가족 또는 보호자 코드 | 아이 기기가 받아 가는 보호자 설정 `{ childId, name, timeLimitSec }` |
| `POST /family/children` · 보호자 코드 · JSON `{ name }` | 아이 만들기. 6자리 `joinCode`가 든 `{ ok, child }` |
| `POST /family/<childId>/code` · 보호자 코드 | 아이 코드 새로 발급(옛 코드 무효). `{ ok, child }` |
| `POST /family/<childId>/name` · 보호자 코드 · JSON `{ name }` | 이름 바꾸기. `{ ok, child }` |
| `POST /join` · 가족 또는 보호자 코드 · JSON `{ code, device: { id, label } }` | 아이 기기 연결. `{ ok, childId, name, timeLimitSec }`. 모르는 코드는 404 `unknown_code` |
| `POST /sets/<childId>` · 가족 또는 보호자 코드 · JSON `{ device?, known: [{ id, updatedAt }], sets: [{ id, name, words, updatedAt }], deleted: [{ id, deletedAt }] }` | 아이 기기의 세트 동기화. `{ ok, sets: [기기에 없거나 더 새 세트 전체], deleted: [지워진 id], summary: [{ id, name, count, updatedAt }], syncedAt }`. 아이당 50세트 초과는 400 `too_many_sets` |
| `GET /family/<childId>/sets` · 보호자 코드 | 아이의 세트 요약 `{ sets: [{ id, name, count, updatedAt }] }` |
| `POST /family/<childId>/sets` · 보호자 코드 · JSON `{ set: { id?, name, words } }` | 세트 만들어 보내기(또는 같은 id로 고치기). `{ ok, set: { id, name, count, updatedAt }, summary }` |
| `GET /family/<childId>/sets/<setId>` · 보호자 코드 | 세트 하나(단어 포함) `{ set }`. 없거나 지워졌으면 404 `unknown_set` |
| `DELETE /family/<childId>/sets/<setId>` · 보호자 코드 | 세트 삭제(묘비). `{ ok, summary }` |
| `GET /daily/<childId>?date=YYYY-MM-DD` · 가족 또는 보호자 코드 | 그날의 단어 `{ date, level, words: [{ id, en, ko, ipa, aliases, kind: "review"\|"new" }], note, completed? }`. 없으면 404 `no_daily`, 계획이 꺼져 있으면 409 `plan_disabled` |
| `POST /daily/<childId>` · 가족 또는 보호자 코드 · JSON `{ date? }` | 그날 것이 없으면 Claude로 만들어 저장하고 돌려줍니다(있으면 그대로) |

오류는 `{ error, message }` JSON으로 돌려주며(원인은 `npm run tail` 로그의 `anthropic_error` 줄에서 확인) `message`는 앱이 그대로 보여 주는 한국어 안내입니다. 접속 코드 오류는 401, 허용되지 않은 주소는 403, 요청 과다는 429, Anthropic 쪽 문제는 502/503/504입니다. 보호자 코드가 필요한 요청(`/family…`)에 가족 코드를 쓰면 401 “보호자 코드가 맞지 않습니다”, 보호자 코드를 등록하지 않았으면 500, 가족 기록함에 닿지 못하면 503, 모르는 아이 코드는 404 `unknown_code`입니다. Anthropic 키 문제는 앱의 접속 코드 오류(401)와 구분하기 위해 502로 돌려줍니다.

보안 메모: Origin 검사와 CORS는 다른 웹사이트가 이 Worker를 쓰지 못하게 막고, 접속 코드는 주소를 아는 사람의 무단 사용을 막습니다. 접속 코드는 태블릿 브라우저에 저장되므로, 기기를 잃어버리면 코드를 바꾸세요. 피해 범위는 어차피 Anthropic 콘솔의 사용 한도로 제한됩니다.

`tests/worker.cjs`가 CORS·접속 코드·요청 제한·입력 검증·결과 정리·AI 사전·오류 변환·가족 기록함(저장소 모의)·오늘의 단어(계획·앵커·생성·완료·크론)·아이 코드(아이 만들기·연결·기기·코드 재발급·이름)를 Node에서 확인합니다 (`node tests/worker.cjs`).

2026-10-18 이전에 배포한 Worker에는 `/define`과 가족 기록함(`/sync`, `/family`), 세트 동기화(`/sets`)가 없어 앱의 ‘빈 뜻 AI로 채우기’와 가족 기록함이 “다시 배포” 안내를 띄웁니다. `npm run deploy`로 다시 배포하면 됩니다(앱 배포와 별개, 먼저 배포해도 옛 앱과 호환).
