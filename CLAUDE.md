# CLAUDE.md — day04-vocab (매일 영단어)

## 프로젝트 개요
- 한국 학생용 영단어 학습 PWA. 음성 인식(읽기·뜻 말하기·알파벳 철자 말하기), 손글씨 입력, 사진에서 단어 세트 추가(AI 인식 또는 기기 내 OCR), 시험 기록·오답 복습을 제공한다.
- **순수 정적 사이트**: 빌드 단계·런타임 패키지·서버 없음. HTML + vanilla JS + localStorage. 외부 네트워크는 브라우저 음성 인식 서비스와, 사용자가 키를 저장한 경우에만 Anthropic API(`api.anthropic.com`)를 쓴다.
- 배포: GitHub 저장소 `HongTaeHwa/day04-vocab`의 `main` 브랜치 루트가 그대로 GitHub Pages로 서비스된다.
  - 저장소: https://github.com/HongTaeHwa/day04-vocab
  - 서비스 URL: https://HongTaeHwa.github.io/day04-vocab/
  - `main`에 머지되면 바로 배포된다. 배포 경로 `/day04-vocab/` 가 manifest `start_url`/`scope`, 테스트 기본 URL에 하드코딩되어 있다.
- UI 텍스트·README·커밋 메시지 본문은 한국어. 사용자(학생·보호자)가 읽는 안내 문구는 쉬운 한국어로 쓴다.

## 파일 구조
| 경로 | 역할 |
|---|---|
| `index.html` | 화면 전체 + 인라인 스크립트 2개. (1) 187행~: 부트스트랩/진단 — 버전 표시, 전역 오류 배너, `앱 점검`, `새 버전 불러오기`. (2) 221행~: 핵심 엔진 — 기본 40단어 `WORDS`, 시험 모드, 음성 인식, 채점, 시험 기록(`historyKey`), 오답 캐시. |
| `sets.js` | 학습 세트 관리(생성·편집·삭제·JSON 백업/가져오기), 사진 인식 — AI(Claude API, `recognizeWithClaude`) 와 기본 OCR(Tesseract.js) 두 경로를 `#ocrEngine`으로 분기, AI 설정 UI, PWA 설치 버튼, 서비스워커 등록. 마지막에 `window.markVocabAppReady()` 호출로 초기화 완료를 알린다. |
| `sw.js` | 서비스워커. 앱 셸 캐시(`CACHE` 상수) + network-first/cache-fallback. |
| `manifest.webmanifest` | PWA 매니페스트 (`/day04-vocab/` 경로 고정). |
| `icons/` | 192/512/maskable/apple-touch 아이콘. |
| `vendor/ocr/` | Tesseract.js 5.1.1 엔진·워커·wasm·`eng`/`kor` 언어 데이터(약 25MB). `SHA256SUMS`로 무결성 관리. CDN 없이 로컬 서빙. 임의 수정 금지. |
| `tests/*.cjs` | Playwright 브라우저 테스트 (아래 참고). |
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
  - `daily_vocab_ai_v1` — `{key, model}` Claude API 키·모델. **백업 JSON/CSV에 절대 포함하지 않는다.** 키가 있으면 새 세트의 기본 인식 방식이 AI가 된다.
- 저장 데이터는 **검증 실패 시 덮어쓰지 않는다**(`storageAvailable=false`로 보호). 이 원칙을 유지한다.

## AI 사진 인식 (Claude API) 구현 메모
- 브라우저에서 `POST https://api.anthropic.com/v1/messages`를 직접 호출한다(공식 SDK는 번들러 없이 쓸 수 없어 `fetch` 사용). 헤더: `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`.
- 모델 기본값 `claude-opus-5-5`(선택: `claude-sonnet-5-5`, `claude-haiku-5-5`). `thinking`은 생략(adaptive), `output_config.effort: "medium"`, `output_config.format`은 `json_schema`(`CLAUDE_SCHEMA`: words[{number, english, korean, aliases}], note). 응답은 `content`의 `text` 블록을 JSON.parse. `stop_reason`이 `refusal`/`max_tokens`면 오류로 안내.
- Opus/Sonnet에는 `fallbacks: "default"` + `anthropic-beta: server-side-fallback-2026-07-01`을 붙이고, 400에 "fallback"이 언급되면 둘 다 빼고 한 번 재시도한다. Haiku에는 붙이지 않는다.
- 사진은 `prepareOcrPhoto`(긴 변 2000px)로 줄인 뒤 JPEG(0.92) base64로 보낸다. 한 장당 요청 1개, 순차 처리, 120초 타임아웃, 취소는 `AbortController`.
- 결과는 `appendDraftRows`로 초안에 추가: 인쇄 번호가 있고 겹치지 않으면 사용, 아니면 이어서 번호. 기본 OCR 경로도 같은 함수를 쓴다.
- 실제 API 호출 테스트는 없다(키 필요). `tests/claude-ocr.cjs`는 `page.route`로 API를 가짜 응답으로 대체한다. 요청 형식을 바꾸면 이 테스트의 검증 항목도 같이 고친다.
- 보안 전제: 키는 기기 localStorage에만 있고 사이트는 공개 저장소다. 키를 코드·문서·테스트에 절대 넣지 않는다.

## 버전·캐시 올리기 (앱 셸을 바꿀 때 반드시)
릴리스 문자열 `20261012-1` 와 캐시 이름 `daily-vocab-shell-v6` 가 여러 곳에 있다. **한 곳만 바꾸면 테스트가 깨지거나 사용자에게 옛 캐시가 남는다.**
1. `index.html` 78행 `#appStatus` 초기 텍스트의 버전
2. `index.html` 189행 `var release = '...'`
3. `index.html` 마지막 `<script src="./sets.js?v=...">`
4. `sw.js` — `CACHE` 상수(`-v6` → `-v7`)와 `SHELL` 배열의 `./sets.js?v=...`
5. `tests/app-update.cjs` — 버전 문자열 검사
확인: `grep -rn "20261012-1\|daily-vocab-shell-v" index.html sw.js tests/`

## 로컬 실행
```bash
node .claude/dev-server.cjs
```
→ http://127.0.0.1:8000/day04-vocab/ (Pages와 같은 경로. 의존성 없음.)
Claude Code 브라우저 미리보기는 `.claude/launch.json`의 `day04-vocab` 설정을 사용한다.
README가 안내하는 `python3 -m http.server 8000` 방식은 저장소 폴더 이름이 `day04-vocab`일 때만 경로가 맞으므로, 이 체크아웃(`Word Test` 폴더)에서는 위 Node 서버를 쓴다.

## 테스트
Playwright는 **전역 설치**되어 있다(`npm i -g playwright` + `npx playwright install chromium`). 저장소에는 `package.json`을 두지 않는다(런타임 무의존 원칙).
```bash
node .claude/run-tests.cjs          # 빠른 6개: browser, pwa, app-update, ten-photos, ocr-failures, claude-ocr (약 20초)
node .claude/run-tests.cjs --all    # + ocr.cjs 실제 OCR 엔진 (최대 3분)
node .claude/run-tests.cjs browser  # 특정 테스트만
```
실행기가 NODE_PATH를 전역 모듈로 잡고, 8000 포트에 서버가 없으면 자동으로 띄운다. 테스트를 직접 실행할 때는:
```bash
NODE_PATH="$(npm root -g)" APP_URL=http://127.0.0.1:8000/day04-vocab/ node tests/browser.cjs
```
| 테스트 | 확인 내용 |
|---|---|
| `browser.cjs` | 기본 세트 40단어, 3가지 모드 시험 흐름, 모름 처리, 기록 저장 |
| `pwa.cjs` | 서비스워커, 반응형 폭(768/1024/390) 오버플로 없음, 매니페스트 아이콘, 오프라인 셸 |
| `app-update.cjs` | 옛 `sets.js` 캐시 상황에서 버전 표시·초기화 실패 안내·자료 보존 |
| `ten-photos.cjs` | 사진 10장 순차 OCR, 11장 거부, 10단어 세트 시험 |
| `ocr-failures.cjs` | OCR 도구 다운로드 타임아웃(30초)·취소·오류 안내 |
| `ocr.cjs` | 합성 영/한 이미지 2장을 실제 Tesseract로 인식 → 검토·저장·시험 (느림) |
| `claude-ocr.cjs` | Claude API를 가짜 응답으로 대체: 키 저장/삭제, 연결 확인, 요청 헤더·스키마, 사진 2장 인식과 번호 병합, 저장·시험, 401 안내, fallbacks 400 재시도, 취소 |
UI 요소를 바꾸면 테스트가 참조하는 `id`(`#start`, `#unknown`, `#next`, `#createSet`, `#photos`, `#runOcr`, `#ocrStatus`, `#wordDraft`, `#confirmed`, `#saveSet`, `#appStatus`, `#setSelect`, `#range` 등)와 상태 문구(예: "사진을 선택했습니다", "시간이 초과")를 함께 맞춘다.

## 작업 규칙
- 변경 전 관련 테스트를 실행하고, 변경 후 `node .claude/run-tests.cjs`가 모두 PASS인지 확인한다. 셸(index.html/sets.js/sw.js/manifest/icons)을 바꿨으면 `--all`.
- 기능·문구를 바꾸면 `README.md`의 해당 절도 같이 갱신한다(README는 사용 설명서 역할).
- 실제 교재 사진, 학생 개인정보, 녹음 파일은 절대 커밋하지 않는다.
- `vendor/ocr/`는 Tesseract 5.1.1로 고정. 교체 시 `SHA256SUMS`·라이선스 파일·README 모두 갱신.
- 외부 CDN·추적 스크립트를 추가하지 않는다. 기기 밖으로 나가는 데이터는 브라우저 음성 인식과, 사용자가 켠 AI 사진 인식(Anthropic API)뿐이어야 하며 새 외부 전송을 추가하려면 README의 개인정보 절도 함께 고친다.
- Git 흐름: `main`에서 `fix/...` 또는 `feat/...` 브랜치 → 커밋 → push → PR → 머지(기존 PR #2~#5와 같은 방식). `main` 직접 push는 사용자가 요청할 때만.
- 커밋 제목은 영어 명령형(기존 관례), 필요하면 본문에 한국어 설명.
- `gh` CLI는 `HongTaeHwa` 계정으로 로그인되어 있어 PR 생성·확인이 가능하다.

## 알려진 환경 메모 (Windows)
- `tests/ocr.cjs`는 `/tmp/ocr-fixture.png`를 쓴다. Windows에서는 현재 드라이브의 `\tmp`(예: `D:\tmp`)로 해석되며 Playwright가 폴더를 만들어 준다.
- Bash 도구는 Git Bash이므로 경로는 `D:/Claude/Project/Word Test` 형식, 공백 때문에 반드시 따옴표.
