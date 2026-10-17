# AI 사진 인식·사전 프록시 (Cloudflare Worker)

앱(GitHub Pages)은 Anthropic API를 직접 부르지 않고 이 Worker만 호출합니다. 사진 인식(`/recognize`)과 영어 단어 목록의 뜻·발음을 찾는 AI 사전(`/define`)을 처리합니다. Anthropic API 키는 Worker의 비밀값에만 있고, 앱·저장소·태블릿 어디에도 들어가지 않습니다. 가족용 **접속 코드**가 맞는 요청만 처리합니다.

```
태블릿 앱 ──(사진 + 접속 코드)──▶ Worker ──(API 키)──▶ Anthropic
            ◀── 번호·영어·뜻·허용 답안 ──┘
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

Anthropic 콘솔에서 **월 사용 한도(spend limit)** 를 꼭 설정하세요. 이 키는 이 Worker 전용으로 만들어 두면 문제가 생겼을 때 그 키만 삭제하면 됩니다.

## Anthropic 키 만들기 (워크스페이스 + 월 한도)

1. https://platform.claude.com → **Settings → Workspaces → Create workspace** → 이름 `daily-vocab`.
2. 만든 워크스페이스를 선택 → **Spend limits**에서 월 한도와 알림을 설정합니다. 기본 워크스페이스에는 한도를 걸 수 없습니다.
3. **Settings → API keys → Create key** → 이름 `daily-vocab-worker`, Expiration `Never`(Worker 비밀값으로만 보관), Linked account 본인, Workspace `daily-vocab`. 키는 한 번만 표시되므로 바로 `npm run secrets`에 붙여넣습니다.
4. 크레딧은 조직 단위로 공유됩니다(Max/Team 플랜의 월간 API 크레딧 포함). **Settings → Billing**에서 잔액과 자동 충전 여부를 확인하세요. 키가 샜다고 의심되면 같은 API keys 페이지에서 **Delete** 합니다.

## 지역 차단과 북미 중계 (Durable Object)

한국에서 온 요청은 Cloudflare의 홍콩(HKG) 데이터센터에서 실행될 때가 있는데, Anthropic은 홍콩발 요청을 `403 forbidden: Request not allowed`로 거절합니다. 그래서 Worker는 Anthropic 호출만 북미에 고정된 Durable Object(`AnthropicRelay`, `locationHint: wnam`)를 통해 보냅니다. `wrangler.jsonc`의 `durable_objects`와 `migrations`가 이 설정이며, 무료 플랜에서 동작합니다.

확인 방법(비밀값 불필요): `https://daily-vocab-ai.reonwipe.workers.dev/diag` 를 열면 `{"colo":"HKG","relay":true,"upstreamStatus":401,"ok":true,…}` 처럼 나와야 합니다. `ok`가 `false`이고 `upstreamStatus`가 403이면 중계가 동작하지 않는 것입니다.

같은 이유로 앱의 오류 안내는 Anthropic의 응답 코드·종류·메시지를 `[Anthropic 403 forbidden: Request not allowed]` 형태로 덧붙여 보여 줍니다. 키 형식이 잘못 등록된 경우(공백·줄바꿈·제어 문자)는 Anthropic에 보내기 전에 걸러서 "키가 올바른 형식이 아닙니다(길이 N, …)"로 알려 줍니다. 터미널에서 Ctrl+V가 붙여넣기 대신 제어 문자를 입력하는 경우가 있으니, `wrangler secret put` 프롬프트에는 마우스 오른쪽 클릭이나 Ctrl+Shift+V로 붙여넣으세요.

## 설정 바꾸기

| 항목 | 방법 |
|---|---|
| 모델 | `wrangler.jsonc`의 `CLAUDE_MODEL` (`claude-opus-5-5` 기본 / `claude-sonnet-5-5` / `claude-haiku-5-5`) 수정 후 `npm run deploy` |
| 허용 주소 | `wrangler.jsonc`의 `ALLOWED_ORIGINS` (쉼표로 여러 개). 앱 주소가 바뀌면 여기도 바꿉니다 |
| 분당 요청 제한 | `wrangler.jsonc`의 `ratelimits[0].simple.limit` (기본 30회/분, IP당) |
| 접속 코드 변경 | `npx wrangler secret put APP_PASSCODE` 후 태블릿의 보호자 설정에서 새 코드 저장 |
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
| `POST /define` · 헤더 `X-App-Passcode` · JSON `{ words: ["apple", …] }` | AI 사전. 영어 단어·짧은 구 최대 60개(영문자·공백·.'’- 40자 이하) → `{ words: [{ en, ko, ipa, aliases }], note, model, usage }`. 요청한 철자 그대로 한 번씩 돌려주고 모르는 단어는 빠집니다(전부 모르면 422). 앱의 ‘빈 뜻 AI로 채우기’가 40개씩 보냅니다 |

오류는 `{ error, message }` JSON으로 돌려주며(원인은 `npm run tail` 로그의 `anthropic_error` 줄에서 확인) `message`는 앱이 그대로 보여 주는 한국어 안내입니다. 접속 코드 오류는 401, 허용되지 않은 주소는 403, 요청 과다는 429, Anthropic 쪽 문제는 502/503/504입니다. Anthropic 키 문제는 앱의 접속 코드 오류(401)와 구분하기 위해 502로 돌려줍니다.

보안 메모: Origin 검사와 CORS는 다른 웹사이트가 이 Worker를 쓰지 못하게 막고, 접속 코드는 주소를 아는 사람의 무단 사용을 막습니다. 접속 코드는 태블릿 브라우저에 저장되므로, 기기를 잃어버리면 코드를 바꾸세요. 피해 범위는 어차피 Anthropic 콘솔의 사용 한도로 제한됩니다.

`tests/worker.cjs`가 CORS·접속 코드·요청 제한·입력 검증·결과 정리·AI 사전·오류 변환을 Node에서 확인합니다 (`node tests/worker.cjs`).

2026-10-18 이전에 배포한 Worker에는 `/define`이 없어 앱의 ‘빈 뜻 AI로 채우기’가 “다시 배포” 안내를 띄웁니다. `npm run deploy`로 다시 배포하면 됩니다(앱 배포와 별개, 먼저 배포해도 옛 앱과 호환).
