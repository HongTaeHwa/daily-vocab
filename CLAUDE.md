# CLAUDE.md — day04-vocab (매일 영단어)

## 프로젝트 개요
- 한국 학생용 영단어 학습 PWA. 음성 인식(읽기·뜻 말하기·알파벳 철자 말하기), 손글씨 입력, 사진에서 단어 세트 추가(AI 인식), 시험 기록·오답 복습을 제공한다. 사용자는 아이와 보호자이므로 화면 문구는 쉬운 한국어로, 선택지는 최소로 유지한다.
- **앱은 순수 정적 사이트**: 빌드 단계·런타임 패키지·서버 없음. HTML + vanilla JS + localStorage. 외부 네트워크는 브라우저 음성 인식 서비스와 가족용 AI 서버(아래)뿐이다.
- **AI 서버는 별도 배포하는 Cloudflare Worker**(`worker/`). Anthropic API 키는 Worker 비밀값에만 있고 앱·저장소·기기 어디에도 두지 않는다. 앱은 Worker 주소 + 가족용 접속 코드만 저장한다.
- 배포: GitHub 저장소 `HongTaeHwa/day04-vocab`의 `main` 브랜치 루트가 그대로 GitHub Pages로 서비스된다.
  - 저장소: https://github.com/HongTaeHwa/day04-vocab
  - 서비스 URL: https://HongTaeHwa.github.io/day04-vocab/
  - `main`에 머지되면 바로 배포된다. 배포 경로 `/day04-vocab/` 가 manifest `start_url`/`scope`, 테스트 기본 URL에 하드코딩되어 있다. Worker는 `cd worker && npm run deploy`로 따로 배포한다.
- UI 텍스트·README·커밋 메시지 본문은 한국어.

## 파일 구조
| 경로 | 역할 |
|---|---|
| `index.html` | 화면 전체 + 인라인 스크립트 2개. (1) 부트스트랩/진단 — 버전 표시, 전역 오류 배너, `앱 점검`, `새 버전 불러오기`. (2) 핵심 엔진 — 기본 40단어 `WORDS`, 시험 모드, 음성 인식, 채점, 시험 기록(`historyKey`), 오답 캐시. |
| `sets.js` | 학습 세트 관리(생성·편집·삭제·JSON 백업/가져오기), 사진 → AI 서버 → 초안 흐름(`#extractWords`), 보호자 설정 UI(`#aiSettings`), PWA 설치 버튼, 서비스워커 등록. 마지막에 `window.markVocabAppReady()` 호출로 초기화 완료를 알린다. |
| `sw.js` | 서비스워커. 앱 셸 캐시(`CACHE` 상수) + network-first/cache-fallback. 교차 출처 요청(AI 서버)은 건드리지 않는다. |
| `manifest.webmanifest` | PWA 매니페스트 (`/day04-vocab/` 경로 고정). |
| `icons/` | 192/512/maskable/apple-touch 아이콘. |
| `worker/worker.js` | Cloudflare Worker 프록시. `POST /ping`, `POST /recognize`. 시스템 프롬프트·JSON 스키마·모델 선택·오류 변환이 여기 있다. 표준 `fetch`/`Request`/`Response`만 써서 Node에서도 테스트된다. |
| `worker/wrangler.jsonc`, `worker/package.json`, `worker/README.md` | Worker 설정(`vars`: CLAUDE_MODEL, ALLOWED_ORIGINS; `ratelimits`), 배포 스크립트, 보호자용 배포 안내. 비밀값(ANTHROPIC_API_KEY, APP_PASSCODE)은 `wrangler secret put`으로만 넣는다. |
| `tests/*.cjs` | Playwright 브라우저 테스트 + Worker 단위 테스트 (아래 참고). |
| `.nojekyll` | GitHub Pages가 Jekyll 처리하지 않도록 함. 삭제 금지. |
| `.claude/` | Claude Code 로컬 도구: `dev-server.cjs`, `run-tests.cjs`, `launch.json`. 앱 동작과 무관. |

## 핵심 데이터 구조
- 단어 객체: `{ id:number, en, ko, ipa, hangul, aliases:string[] }`. 기본 세트는 121~160번 40개(`index.html`의 `WORDS` 배열).
- 시험 모드(`data-mode`): `read_meaning`(읽기+뜻), `en_ko`(영어→한글), `ko_en`(한글→영어·철자).
- localStorage 키 (버전 접미사 유지, 깨뜨리면 사용자 기록 유실):
  - `daily_vocab_sets_v2` — 세트 배열 `[{id,name,words}]`
  - `daily_vocab_history_v2` — 시험 기록
  - `daily_vocab_missed_<setId>` — 세트별 오답 id 배열
  - `daily_vocab_legacy_backup_v1` — 구버전(`day04_wordtest_*`) 자동 변환 백업
  - `daily_vocab_ai_v2` — `{server, passcode}` AI 서버 주소·접속 코드. **백업 JSON/CSV에 절대 포함하지 않는다.**
  - `daily_vocab_ai_v1` — (폐기) 예전에 Anthropic API 키를 저장하던 키. 앱 시작 시 `removeItem`으로 지운다. 되살리지 않는다.
- 초안(`#wordDraft`) 형식: 한 줄에 `번호\t영어\t뜻\t별칭|별칭\t발음`(발음은 선택, 책에 인쇄된 IPA). `parseDraft`가 읽고 `appendDraftRows`가 쓴다. 편집 시 발음이 비어 있으면 기존 값을 유지한다.
- 저장 데이터는 **검증 실패 시 덮어쓰지 않는다**(`storageAvailable=false`로 보호). 이 원칙을 유지한다.

## AI 사진 인식 구조
- 흐름: 앱이 사진을 `preparePhoto`(긴 변 2000px) → JPEG(0.92) base64 → `POST {server}/recognize` (헤더 `x-app-passcode`, JSON `{image, mediaType}`) → Worker가 Anthropic `POST /v1/messages`(모델 기본 `claude-opus-5-5`, `thinking` 생략=adaptive, `output_config.effort: "medium"`, `output_config.format` json_schema) → Worker가 `{words:[{number,en,ko,ipa,aliases}], note, model, usage}`로 정리해 반환 → 앱 `appendDraftRows`가 초안에 추가(인쇄 번호 유지, 없거나 겹치면 이어서 번호).
- 한 장당 요청 1개, 순차 처리, 앱 120초 타임아웃, 취소는 `AbortController`. Worker는 Anthropic 호출에 110초 타임아웃.
- Worker 보안: Origin 허용 목록(`ALLOWED_ORIGINS`), 접속 코드 상수 시간 비교, 선택적 `RATE_LIMITER` 바인딩(IP당 분당 30회), base64 검증과 8MB 상한, 모델 허용 목록. Anthropic 401/403은 앱의 접속 코드 오류(401)와 구분하려고 502로 바꿔 돌려준다.
- Opus/Sonnet에는 `fallbacks: "default"` + `anthropic-beta: server-side-fallback-2026-07-01`을 붙이고, 400 메시지에 "fallback"이 있으면 둘 다 빼고 한 번 재시도한다. Haiku에는 붙이지 않는다.
- 프롬프트·스키마를 바꾸면 Worker 재배포가 필요하다(앱 배포와 별개). 응답 형식을 바꾸면 `tests/worker.cjs`와 `tests/ai-recognition.cjs` 둘 다 고친다.
- 배포된 Worker: `https://daily-vocab-ai.reonwipe.workers.dev` (2026-10-12 배포, Cloudflare 계정 reonwipe, Worker 이름 `daily-vocab-ai`). `sets.js`의 `AI_SERVER_DEFAULT`에 들어 있어 보호자는 접속 코드만 입력한다. 주소가 바뀌면 이 상수와 README 두 곳을 같이 고친다. 재배포는 `cd worker && npm run deploy`(로그인 상태 유지됨).
- 실제 Anthropic 호출 테스트는 없다(키 필요). 키·접속 코드를 코드·문서·테스트에 절대 넣지 않는다.

## 버전·캐시 올리기 (앱 셸을 바꿀 때 반드시)
릴리스 문자열 `20261012-3` 와 캐시 이름 `daily-vocab-shell-v7` 가 여러 곳에 있다. **한 곳만 바꾸면 테스트가 깨지거나 사용자에게 옛 캐시가 남는다.**
1. `index.html` `#appStatus` 초기 텍스트의 버전
2. `index.html` `var release = '...'`
3. `index.html` 마지막 `<script src="./sets.js?v=...">`
4. `sw.js` — `CACHE` 상수(`-v7` → `-v8`)와 `SHELL` 배열의 `./sets.js?v=...`
5. `tests/app-update.cjs` — 버전 문자열 검사
확인: `grep -rn "20261012-3\|daily-vocab-shell-v" index.html sw.js tests/`

## 로컬 실행
```bash
node .claude/dev-server.cjs
```
→ http://127.0.0.1:8000/day04-vocab/ (Pages와 같은 경로. 의존성 없음.)
Claude Code 브라우저 미리보기는 `.claude/launch.json`의 `day04-vocab` 설정을 사용한다. Worker를 로컬에서 함께 띄우려면 `worker/README.md`의 `.dev.vars` 안내를 따른다(`npm run dev`, 8787 포트).

## 테스트
Playwright는 **전역 설치**되어 있다(`npm i -g playwright` + `npx playwright install chromium`). 저장소 루트에는 `package.json`을 두지 않는다(앱 런타임 무의존 원칙). `worker/package.json`은 Worker 배포 전용이다.
```bash
node .claude/run-tests.cjs            # 전체 6개 (약 20초)
node .claude/run-tests.cjs browser    # 특정 테스트만
node tests/worker.cjs                 # Worker 단위 테스트만 (서버·Playwright 불필요)
```
실행기가 NODE_PATH를 전역 모듈로 잡고, 8000 포트에 서버가 없으면 자동으로 띄운다.
| 테스트 | 확인 내용 |
|---|---|
| `worker.cjs` | Worker: CORS/Origin, 접속 코드, 비밀값 누락, 요청 제한, 입력 검증, 결과 정리, fallbacks 재시도, Anthropic 오류 변환, 타임아웃 |
| `browser.cjs` | 기본 세트 40단어, 3가지 모드 시험 흐름, 모름 처리, 기록 저장, 편집, 백업 JSON 왕복 |
| `pwa.cjs` | 서비스워커, 반응형 폭(768/1024/390) 오버플로 없음, 매니페스트 아이콘, 오프라인 셸, AI 서버 오류 안내·취소 |
| `app-update.cjs` | 옛 `sets.js` 캐시 상황에서 버전 표시·초기화 실패 안내·자료 보존 |
| `ten-photos.cjs` | 사진 10장 순차 전송·결과 보존, 11장 거부, 10단어 세트 시험 |
| `ai-recognition.cjs` | v1 키 제거, 보호자 설정 검증·저장·삭제, 연결 확인, 사진 2장 인식과 번호 병합, 저장·시험, 401/503/연결 실패 안내, 취소 |
UI 요소를 바꾸면 테스트가 참조하는 `id`(`#start`, `#unknown`, `#next`, `#createSet`, `#photos`, `#extractWords`, `#cancelExtract`, `#extractStatus`, `#wordDraft`, `#confirmed`, `#saveSet`, `#appStatus`, `#setSelect`, `#range`, `#aiSettings`, `#aiServer`, `#aiPasscode`, `#saveAi`, `#testAi`, `#clearAi`, `#aiState`, `#aiStatus` 등)와 상태 문구(예: "사진을 선택했습니다", "가져오지 못했습니다", "취소")를 함께 맞춘다.

## 작업 규칙
- 변경 전 관련 테스트를 실행하고, 변경 후 `node .claude/run-tests.cjs`가 모두 PASS인지 확인한다.
- 기능·문구를 바꾸면 `README.md`의 해당 절도 같이 갱신한다(README는 사용 설명서 역할). Worker 설정을 바꾸면 `worker/README.md`도.
- 실제 교재 사진, 학생 개인정보, 녹음 파일, API 키, 접속 코드는 절대 커밋하지 않는다. `worker/.dev.vars`는 gitignore 대상이다.
- 외부 CDN·추적 스크립트를 추가하지 않는다. 기기 밖으로 나가는 데이터는 브라우저 음성 인식과 AI 서버(사진)뿐이어야 하며, 새 외부 전송을 추가하려면 README의 개인정보 절도 함께 고친다.
- 아이가 쓰는 화면에 기술 선택지(엔진, 모델, 키)를 노출하지 않는다. 보호자용 설정은 `#aiSettings` 안에만 둔다.
- Git 흐름: `main`에서 `fix/...` 또는 `feat/...` 브랜치 → 커밋 → push → PR → 머지. `main` 직접 push는 사용자가 요청할 때만.
- 커밋 제목은 영어 명령형(기존 관례), 필요하면 본문에 한국어 설명.
- `gh` CLI는 `HongTaeHwa` 계정으로 로그인되어 있어 PR 생성·확인·머지가 가능하다. 단, `gh pr edit`은 토큰 범위 부족으로 실패하므로 base 변경 등은 `gh api -X PATCH repos/.../pulls/N`을 쓴다. PR의 base 브랜치를 먼저 지우면 PR이 닫히니 머지 순서에 주의한다.

## 알려진 환경 메모 (Windows)
- Bash 도구는 Git Bash이므로 경로는 `D:/Claude/Project/Word Test` 형식, 공백 때문에 반드시 따옴표.
- Bash 히어독 본문에 작은따옴표(’ 아님, ASCII `'`)가 홀수 개 있으면 이 환경에서 명령이 깨진다. 긴 파일은 Write 도구로 쓰고, 기존 파일 수정은 Python 스크립트(문자열 치환 + 개수 assert)로 한다.
- 작업 트리 파일은 CRLF일 수 있다(core.autocrlf). 치환 스크립트는 읽을 때 LF로 바꾸고 쓸 때 원래대로 되돌린다.
