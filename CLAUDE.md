# CLAUDE.md — daily-vocab (매일 영단어)

## 프로젝트 개요
- 한국 학생용 영단어 학습 PWA. 음성 인식(읽기·뜻 말하기·알파벳 철자 말하기), 손글씨 입력, 사진에서 단어 세트 추가(AI 인식), 쉬기·이어서 하기, 시험 기록·오답 복습을 제공한다. 사용자는 아이와 보호자이므로 화면 문구는 쉬운 한국어로, 선택지는 최소로 유지한다.
- **앱은 순수 정적 사이트**: 빌드 단계·런타임 패키지·서버 없음. HTML + vanilla JS + localStorage. 외부 네트워크는 브라우저 음성 인식 서비스와 가족용 AI 서버(아래)뿐이다.
- **AI 서버는 별도 배포하는 Cloudflare Worker**(`worker/`). Anthropic API 키는 Worker 비밀값에만 있고 앱·저장소·기기 어디에도 두지 않는다. 앱은 Worker 주소 + 가족용 접속 코드만 저장한다.
- 배포: GitHub 저장소 `HongTaeHwa/daily-vocab`의 `main` 브랜치 루트가 그대로 GitHub Pages로 서비스된다.
  - 저장소: https://github.com/HongTaeHwa/daily-vocab
  - 서비스 URL: https://hongtaehwa.github.io/daily-vocab/
  - `main`에 머지되면 바로 배포된다. 배포 경로 `/daily-vocab/` 가 manifest `start_url`/`scope`, 테스트 기본 URL, `.claude/dev-server.cjs`에 하드코딩되어 있다. Worker는 `cd worker && npm run deploy`로 따로 배포한다.
- UI 텍스트·README·커밋 메시지 본문은 한국어. 설계 배경은 `docs/DESIGN.md`.

## 파일 구조
| 경로 | 역할 |
|---|---|
| `index.html` | 마크업(홈·시험·결과·세트 편집·기록·설정 뷰 + 하단 탭) + CSS + 부트스트랩 스크립트(버전·오류 배너 `#appStatus`/`#globalNotice`, `앱 점검`, `새 버전 불러오기`). |
| `quiz.js` | 데이터 로드/이전, `showView` 뷰 전환, 세트 선택·범위, 시험 진행(쉬기·이어서·그만하기), 채점·음성 인식·마이크 점검, 결과, 기록, 환경 설정 기억. 기본 40단어 `WORDS`도 여기. |
| `sets.js` | 세트 만들기·수정(단어 표 편집기 ↔ `#wordDraft` 텍스트 동기화, 이름 바꾸기, 사진 → AI 서버), 백업/가져오기, 보호자 설정(AI 연결), 설치·서비스워커. 마지막에 `window.markVocabAppReady()` 호출. |
| `sw.js` | 서비스워커. 앱 셸 캐시(`CACHE` 상수) + network-first/cache-fallback. 교차 출처 요청(AI 서버)은 건드리지 않는다. |
| `manifest.webmanifest` | PWA 매니페스트 (`/daily-vocab/` 경로 고정). |
| `icons/` | 192/512/maskable/apple-touch 아이콘. |
| `worker/worker.js` | Cloudflare Worker 프록시. `POST /ping`, `POST /recognize`, `GET /diag`. 시스템 프롬프트·JSON 스키마·모델 선택·오류 변환·북미 중계(Durable Object)가 여기 있다. |
| `worker/wrangler.jsonc`, `worker/package.json`, `worker/README.md` | Worker 설정(`vars`, `ratelimits`, `durable_objects`), 배포 스크립트, 보호자용 배포 안내. 비밀값(ANTHROPIC_API_KEY, APP_PASSCODE)은 `wrangler secret put`으로만 넣는다. |
| `tests/*.cjs` | Playwright 브라우저 테스트 + Worker 단위 테스트 (아래 참고). |
| `docs/DESIGN.md` | 2026-10-12 전면 개편 설계서(전수 검사 결과, 화면 구조, 데이터 모델, 진행 상태). |
| `.nojekyll` | GitHub Pages가 Jekyll 처리하지 않도록 함. 삭제 금지. |
| `.claude/` | Claude Code 로컬 도구: `dev-server.cjs`, `run-tests.cjs`, `launch.json`. 앱 동작과 무관. |

## 화면 구조와 ID
- 뷰: `#home`(세트 선택·시험 설정·최근 결과·이어서 하기 카드), `#quiz`, `#finish`(결과), `#editor`(세트 편집), `#history`, `#settings`. `showView(name)`이 `.view.active`를 바꾸고 `body.in-quiz`로 하단 탭을 숨긴다.
- 하단 탭 `#tabHome #tabHistory #tabSettings`, 상단 `#openSettings`(시험 중 숨김). 시험 중에는 탭이 숨고 `#pauseQuiz`(쉬기)·`#backSettings`(그만하기)가 있다. `showView`는 시험 중 다른 화면 요청을 쉬기로 바꾸고, `history.pushState`/`popstate`로 Android 뒤로 가기를 화면 되돌리기로 처리한다.
- 세트 삭제·이름 바꾸기(`#renameSet #deleteSet #renameBox`)는 편집 화면의 `#manageBox`(기존 세트일 때만)에 있다. 아이가 쓰는 홈에는 두지 않는다. 미저장 초안(`draftDirty`)은 닫기·다른 세트 열기 전에 확인한다.
- 사진 선택은 `selectedFiles` 배열: `#photos`는 바꿔치기, `#camera`는 누적(최대 10장), 썸네일 ✕로 제거. 가져오기 성공한 사진은 목록에서 빠진다.
- 테스트가 참조하는 ID는 유지한다: `#start #review #reviewCount #range #shuffle #setSelect #createSet #editSet #renameSet #deleteSet #setStatus #resumeCard #resumeQuiz #discardSession #resumeEditor #unknown #next #check #answerInput #readInput #checkRead #parentConfirm #progressText #finalScore #missedList #againSame #newTest #historyList #historyFilter #historySummary #exportHistory #clearHistory #setName #photos #camera #pickPhotos #takePhoto #extractWords #cancelExtract #extractStatus #wordTableBody #addRow #toggleDraftText #wordDraft #wordCount #confirmed #saveSet #closeEditor #editorTitle #manageBox #manageStatus #finishTitle #aiSettings #aiServer #aiPasscode #saveAi #testAi #clearAi #aiState #aiStatus #backupStatus #appStatus #refreshApp #checkApp`.
- 상태 문구도 테스트가 본다: "사진을 선택했습니다", "가져오지 못했습니다", "취소", "보호자 설정", "연결 성공", "중단".

## 핵심 데이터 구조
- 단어 객체: `{ id:number|string, en, ko, ipa, hangul, aliases:string[] }`. 기본 세트는 121~160번 40개(`quiz.js`의 `WORDS` 배열).
- 시험 모드(`data-mode`): `read_meaning`(읽기+뜻), `en_ko`(영어→한글), `ko_en`(한글→영어·철자).
- 초안(`#wordDraft`) 형식: 한 줄에 `번호\t영어\t뜻\t별칭|별칭\t발음`(발음은 선택). `parseDraft`가 읽고 `appendDraftRows`·`tableToDraft`가 쓴다. 표 편집기는 이 텍스트와 양방향 동기화되며 300단어를 넘으면 텍스트 모드로 자동 전환.
- localStorage 키 (버전 접미사 유지, 깨뜨리면 사용자 기록 유실):
  - `daily_vocab_sets_v2` — 세트 배열 `[{id,name,words,updatedAt?}]`
  - `daily_vocab_history_v2` — 시험 기록 `[{id,setId,setName,mode,range,startedAt,completedAt,results,partial?}]` (`partial`은 그만하기·쉬던 시험 포기로 끝난 중단 기록; `results[i].self`는 ‘소리 내어 읽었어요’로 직접 확인한 읽기). 기록 탭의 세트 필터는 그 세트 기록만, ‘전체 세트’는 삭제된 세트 기록까지 보여 준다.
  - `daily_vocab_missed_<setId>` — 세트별 오답 id 배열
  - `daily_vocab_session_v1` — 쉬는 중인 시험 `{meta, mode, queue, position, results, pausedAt}` (문제를 넘길 때마다·쉬기·화면 숨김 시 저장, 완료·그만하기 시 삭제). `meta.activeMs/resumedAt`로 실제 푼 시간을 누적한다. 쉬기 전에 채점이 끝난 문제는 결과로 넣고 넘긴다. 틀린 단어는 `meta.setId`의 키에 저장한다(선택 세트와 달라도).
  - `daily_vocab_prefs_v1` — `{mode, range, shuffle, setId}` 마지막 선택
  - `daily_vocab_legacy_backup_v1` — 구버전(`day04_wordtest_*`) 자동 변환 백업
  - `daily_vocab_ai_v2` — `{server, passcode}` AI 서버 주소·접속 코드. **백업 JSON/CSV에 절대 포함하지 않는다.**
  - `daily_vocab_ai_v1` — (폐기) 예전에 API 키를 저장하던 키. 시작 시 지운다.
- 저장 데이터는 **검증 실패 시 덮어쓰지 않는다**(`storageAvailable=false`로 보호). 이 원칙을 유지한다.

## AI 사진 인식 구조
- 흐름: 앱이 사진을 `preparePhoto`(긴 변 2000px) → JPEG(0.92) base64 → `POST {server}/recognize` (헤더 `x-app-passcode`, JSON `{image, mediaType}`) → Worker가 Anthropic `POST /v1/messages`(모델 기본 `claude-opus-5-5`, `thinking` 생략=adaptive, `output_config.effort: "medium"`, `output_config.format` json_schema) → `{words:[{number,en,ko,ipa,aliases}], note, model, usage}` → 앱 `appendDraftRows`가 초안에 추가(인쇄 번호 유지, 없거나 겹치면 이어서 번호) → 표 갱신.
- 한 장당 요청 1개, 순차 처리, 앱 120초 타임아웃, 취소는 `AbortController`. Worker는 Anthropic 호출에 110초 타임아웃.
- **북미 중계**: Anthropic은 홍콩(HKG) 등 미지원 지역발 요청을 `403 forbidden: Request not allowed`로 거절하는데, 한국발 요청이 Cloudflare HKG에서 실행될 때가 있다(2026-10-12 실측). 그래서 Anthropic 호출은 `locationHint: "wnam"`으로 북미에 고정한 Durable Object `AnthropicRelay`(RELAY 바인딩)를 거친다. RELAY가 없거나 실패하면 직접 호출로 폴백. `GET /diag`(비밀값 불필요)로 `ok:true`(upstream 401)를 확인할 수 있다. 이 구조를 없애면 안 된다.
- 키 위생: 등록된 키는 trim 후 출력 가능한 ASCII·`sk-ant-` 접두사를 검사해 잘못 붙여넣은 키를 Anthropic 호출 전에 걸러 준다(길이·문자 종류만 알려 주고 값은 절대 로그·응답에 넣지 않는다). Anthropic 오류는 `[Anthropic <status> <type>: <message>]`를 덧붙여 앱에 전달한다. `wrangler tail` 로그에는 요청 헤더(접속 코드 포함)가 찍히므로 디버깅 외에는 보지 않는다.
- Worker 보안: Origin 허용 목록(`ALLOWED_ORIGINS`, 경로 무관 origin만), 접속 코드 상수 시간 비교, 선택적 `RATE_LIMITER`(IP당 분당 30회), base64 검증과 8MB 상한, 모델 허용 목록. Anthropic 401/403은 앱의 접속 코드 오류(401)와 구분하려고 502로 바꿔 돌려준다.
- Opus/Sonnet에는 `fallbacks: "default"` + `anthropic-beta: server-side-fallback-2026-07-01`을 붙이고, 400 메시지에 "fallback"이 있으면 둘 다 빼고 한 번 재시도한다. Haiku에는 붙이지 않는다.
- 배포된 Worker: `https://daily-vocab-ai.reonwipe.workers.dev` (Cloudflare 계정 reonwipe, Worker 이름 `daily-vocab-ai`). `sets.js`의 `AI_SERVER_DEFAULT`에 들어 있어 보호자는 접속 코드만 입력한다. 재배포는 `cd worker && npm run deploy`(로그인 상태 유지됨).
- 프롬프트·스키마를 바꾸면 Worker 재배포가 필요하다(앱 배포와 별개). 응답 형식을 바꾸면 `tests/worker.cjs`와 `tests/ai-recognition.cjs` 둘 다 고친다.
- 실제 Anthropic 호출 테스트는 없다(키 필요). 키·접속 코드를 코드·문서·테스트에 절대 넣지 않는다. 보호자 설정(AI 연결) UI·동작은 사용자 요청으로 그대로 유지한다.

## 버전·캐시 올리기 (앱 셸을 바꿀 때 반드시)
릴리스 문자열 `20261012-5` 와 캐시 이름 `daily-vocab-shell-v9` 가 여러 곳에 있다. **한 곳만 바꾸면 테스트가 깨지거나 사용자에게 옛 캐시가 남는다.**
1. `index.html` `#appStatus` 초기 텍스트의 버전
2. `index.html` `var release = '...'`
3. `index.html` 마지막 `<script src="./quiz.js?v=...">`와 `./sets.js?v=...` (둘 다)
4. `sw.js` — `CACHE` 상수(`-v9` → `-v10`)와 `SHELL` 배열의 `./quiz.js?v=...`, `./sets.js?v=...`
5. `tests/app-update.cjs` — 버전 문자열 검사
확인: `grep -rn "20261012-5\|daily-vocab-shell-v" index.html sw.js tests/`

## 로컬 실행
```bash
node .claude/dev-server.cjs
```
→ http://127.0.0.1:8000/daily-vocab/ (Pages와 같은 경로. 의존성 없음. `PORT=8001`처럼 포트 변경 가능.)
Claude Code 브라우저 미리보기(`.claude/launch.json`)가 예전 폴더 설정을 잡을 때가 있으니, 미리보기 주소가 404면 위 명령으로 직접 띄우고 탭에서 연다. Worker를 로컬에서 함께 띄우려면 `worker/README.md`의 `.dev.vars` 안내를 따른다(`npm run dev`, 8787 포트).

## 테스트
Playwright는 **전역 설치**되어 있다(`npm i -g playwright` + `npx playwright install chromium`). 저장소 루트에는 `package.json`을 두지 않는다(앱 런타임 무의존 원칙). `worker/package.json`은 Worker 배포 전용이다.
```bash
node .claude/run-tests.cjs            # 전체 7개 (약 25초)
node .claude/run-tests.cjs session    # 특정 테스트만
node tests/worker.cjs                 # Worker 단위 테스트만 (서버·Playwright 불필요)
```
실행기가 NODE_PATH를 전역 모듈로 잡고, 8000 포트에 서버가 없으면 자동으로 띄운다.
| 테스트 | 확인 내용 |
|---|---|
| `worker.cjs` | Worker: CORS/Origin, 접속 코드, 비밀값 누락, 요청 제한, 입력 검증, 결과 정리, fallbacks 재시도, Anthropic 오류 변환, 북미 중계·폴백, diag, 키 형식 검사, 타임아웃 |
| `browser.cjs` | 기본 세트 40단어, 3가지 모드 시험 흐름(그만하기 → 중단 기록), 세트 저장(텍스트 모드), 엄격 채점, 세트별 기록 격리, 삭제된 세트 기록 재시험, 구버전 이전, 백업 JSON 왕복, 저장 실패 안내 |
| `pwa.cjs` | 서비스워커, 반응형 폭(768/1024/390) 오버플로 없음, 매니페스트 아이콘, 오프라인 셸, AI 서버 오류 안내·취소 |
| `app-update.cjs` | 옛 `sets.js` 캐시 상황에서 버전 표시·초기화 실패 안내·자료 보존 |
| `ten-photos.cjs` | 사진 10장 순차 전송·결과 보존, 11장 거부, 10단어 세트 시험 |
| `ai-recognition.cjs` | v1 키 제거, 보호자 설정 검증·저장·삭제(설정 뷰), 연결 확인, 편집 복귀, 사진 2장 인식과 번호 병합·표 표시, 저장·시험, 401/503/연결 실패 안내, 취소 |
| `session.cjs` | 탭 전환, 책 번호 기준 범위 라벨, 쉬기 → 새로고침 → 이어서 하기 → 완료(틀린 단어 목록·같은 범위 다시), 그만하기 중단 기록, 세트 이름 바꾸기(기록 반영·유지), 표 편집기 ↔ 텍스트 동기화·행 삭제·저장, 마지막 선택 기억, 편집 중 설정 다녀오기 |
UI 요소를 바꾸면 위 ID 목록과 상태 문구를 테스트와 함께 맞춘다. 표 편집기 기본 화면에서는 `#wordDraft`가 숨겨져 있으므로 테스트에서 텍스트를 채우려면 먼저 `#toggleDraftText`를 누른다.

## 작업 규칙
- 변경 전 관련 테스트를 실행하고, 변경 후 `node .claude/run-tests.cjs`가 모두 PASS인지 확인한다.
- 기능·문구를 바꾸면 `README.md`의 해당 절도 같이 갱신한다(README는 사용 설명서 역할). Worker 설정을 바꾸면 `worker/README.md`도.
- 실제 교재 사진, 학생 개인정보, 녹음 파일, API 키, 접속 코드는 절대 커밋하지 않는다. `worker/.dev.vars`, `samples/`, `*key*.txt`는 gitignore 대상이다. 커밋 전 `git status`로 낯선 파일이 없는지 본다.
- 외부 CDN·추적 스크립트를 추가하지 않는다. 기기 밖으로 나가는 데이터는 브라우저 음성 인식과 AI 서버(사진)뿐이어야 하며, 새 외부 전송을 추가하려면 README의 개인정보 절도 함께 고친다.
- 아이가 쓰는 화면(홈·시험·결과)에 기술 선택지(엔진, 모델, 키, 백업)를 노출하지 않는다. 보호자용 기능은 설정 뷰에만 둔다.
- Git 흐름: `main`에서 `fix/...` 또는 `feat/...` 브랜치 → 커밋 → push → PR → 머지. `main` 직접 push는 사용자가 요청할 때만.
- 커밋 제목은 영어 명령형(기존 관례), 필요하면 본문에 한국어 설명.
- `gh` CLI는 `HongTaeHwa` 계정으로 로그인되어 있어 PR 생성·확인·머지가 가능하다. `gh pr edit`은 토큰 범위 부족으로 실패하므로 base 변경 등은 `gh api -X PATCH repos/.../pulls/N`을 쓴다. PR의 base 브랜치를 먼저 지우면 PR이 닫히니 머지 순서에 주의한다. GitHub 푸시 보호가 비밀값을 감지하면 푸시가 거부된다(커밋에서 빼고 다시 푸시).

## 알려진 환경 메모 (Windows)
- Bash 도구는 Git Bash이므로 경로는 `/d/Claude/Project/daily-vocab` 형식.
- Bash 히어독 본문에 ASCII 작은따옴표(`'`)가 홀수 개 있으면 명령이 깨지고, 백슬래시는 한 겹 벗겨진다(`\\x21`이 `\x21`로 도착). 긴 파일은 Write 도구로 쓰고, 기존 파일 수정은 Write로 만든 파이썬 치환 스크립트(개수 assert 포함)를 `python -I`로 실행한다.
- 앱 터미널 패널의 입력 프롬프트에서 Ctrl+V는 붙여넣기가 아니라 제어 문자를 넣는다. 비밀값 입력은 마우스 오른쪽 클릭이나 Ctrl+Shift+V.
- 작업 트리 파일은 CRLF일 수 있다(core.autocrlf). 치환 스크립트는 읽을 때 LF로 바꾸고 쓸 때 원래대로 되돌린다.
