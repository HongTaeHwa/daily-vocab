# CLAUDE.md — daily-vocab (매일 영단어)

## 프로젝트 개요
- 한국 학생용 영단어 학습 PWA. 음성 인식(읽기·뜻 말하기·알파벳 철자 말하기), 손글씨 입력, 사진에서 단어 세트 추가(AI 인식; 영어만 있는 사진은 AI 사전이 뜻·발음 보완), 빈 뜻·발음 AI 채우기, 쉬기·이어서 하기, 시험 기록·오답 복습, 가족 기록함(보호자가 만든 아이에 아이 기기를 6자리 아이 코드·전용 링크로 연결 → 기록이 가족 Worker로 → 보호자 폰의 ‘아이들’ 탭), 오늘의 단어(보호자가 켜면 매일 Claude가 아이 수준에 맞춰 만드는 퀴즈), 단어 찾기(🔍 찾기 탭: AI 사전으로 뜻·발음·예문, 찾은 단어는 ‘찾아본 단어’ 세트에 자동 저장 → 시험), 세트 동기화(연결된 기기의 세트를 아이 단위로 Worker에 두어 같은 아이의 기기가 같은 세트를 보고, 보호자가 사진으로 만들어 보냄)를 제공한다. 사용자는 아이와 보호자이므로 화면 문구는 쉬운 한국어로, 선택지는 최소로 유지한다.
- **앱은 순수 정적 사이트**: 빌드 단계·런타임 패키지·서버 없음. HTML + vanilla JS + localStorage. 외부 네트워크는 브라우저 음성 인식 서비스와 가족용 AI 서버(아래)뿐이다.
- **AI 서버는 별도 배포하는 Cloudflare Worker**(`worker/`). Anthropic API 키는 Worker 비밀값에만 있고 앱·저장소·기기 어디에도 두지 않는다. 앱은 Worker 주소 + 가족용 접속 코드(보호자 폰은 보호자 코드도)만 저장한다.
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
| `family.js` | 가족 기록함 + 오늘의 단어 + 아이 코드. 아이 기기: `joinChild`(아이 코드 → `POST /join`, 전용 링크 `?child=코드`는 `linkCodeFromUrl`로 읽어 자동 연결·접속 코드가 없으면 `pendingCode`로 대기 후 `onAiSettingsSaved`에서 연결)·‘기록 보내기’ 스위치·연결 해제, `checkDaily`(앱 시작·화면 복귀: `GET /daily` → `no_daily`면 `POST /daily`) → 홈 `#dailyCard` → `newSession(..., {daily})`, `queueFamilySync`(기록 확정 시) → `flushFamilySync`(50개씩 `POST /sync`, 실패분은 `pending`에 남겨 앱 열 때·화면 복귀·온라인 복귀 때 재전송). 보호자 폰: 보호자 코드 저장 → `#tabFamily` 표시, `renderFamily`(`GET /family` 캐시+새로고침, 아이 카드, 상세 `GET /family/<id>`, 삭제, 아이 추가 `POST /family/children`·코드 새로 만들기 `/code`·이름 `/name`·링크 복사·연결 기기 표시, 오늘의 단어 계획 `#planBox` → `POST /family/<id>/plan`, 지금 만들기 `POST /daily/<id>`). **세트 동기화**: 아이 기기 `syncSets`(앱 시작·화면 복귀 10분 간격·온라인 복귀·세트 변경 뒤 `queueSetsSync`; `POST /sets/<childId>`에 `known`/`sets`(수정된 것만)/`deleted` 묘비 → `applySetsResponse`가 받은 세트 반영·지워진 세트 제거·손대지 않은 예제 세트(`isUntouchedExample`) 제거·`setsAcked` 갱신 → `selectSet`), `noteSetDeleted`(sets.js 삭제 시 묘비). 보호자 `renderChildSets`(상세 📚 세트 목록), `openChildSetEditor`/`window.editorForChild`(sets.js 편집기 재사용, 저장은 `sendSetToChild` → `POST /family/<id>/sets`), `openChildSet`(`GET …/sets/<setId>`), `deleteChildSet`, `returnToChild`. quiz.js 다음·sets.js 앞에 로드되고 sets.js가 `initFamily()`를 부른다. |
| `sets.js` | 세트 만들기·수정(단어 표 편집기 ↔ `#wordDraft` 텍스트 동기화, 이름 바꾸기, 사진 → AI 서버, 빈 뜻·발음 AI 채우기), 백업/가져오기, 보호자 설정(AI 연결), AI 2차 채점 요청(`judgeMeaning`), 단어 찾기(`lookupWord` → `POST /lookup`, `rememberLookup`(`daily_vocab_lookups_v1`), `addToLookupSet`(세트 id `lookup` ‘찾아본 단어’), `renderLookup`), 설치·서비스워커. 마지막에 `initFamily()`와 `window.markVocabAppReady()` 호출. |
| `sw.js` | 서비스워커. 앱 셸 캐시(`CACHE` 상수) + network-first/cache-fallback. 교차 출처 요청(AI 서버)은 건드리지 않는다. |
| `manifest.webmanifest` | PWA 매니페스트 (`/daily-vocab/` 경로 고정). |
| `parent.html`, `manifest-parent.webmanifest`, `icons/parent-*.png` | 보호자 전용 설치 페이지와 매니페스트(`start_url: /daily-vocab/?mode=parent`, 이름 ‘매일 영단어 보호자’, 별도 아이콘). 앱 본체는 `index.html` 하나이고 `?mode=parent`를 `family.js`가 읽어 `daily_vocab_mode_v1`에 기억한다. `parent.html`은 설치 안내만 하고 자동 이동하지 않는다(iOS가 설치 시 그 페이지의 매니페스트를 쓰기 때문). |
| `icons/` | 192/512/maskable/apple-touch 아이콘. |
| `worker/worker.js` | Cloudflare Worker 프록시. `POST /ping`, `POST /recognize`, `POST /define`(AI 사전), `POST /grade`(AI 2차 채점), `POST /lookup`(단어 찾기: 뜻·품사·발음·허용 답안·예문·비슷한 말, `LOOKUP_MODEL` 기본 sonnet), `GET /diag`, 가족 기록함 `POST /sync`·`GET /family`·`GET|DELETE /family/<childId>`(Durable Object `FamilyStore`), 아이 코드 `POST /family/children`·`POST /family/<childId>/code|name`·`POST /join`(기기 등록, `code:<코드>` 키), 오늘의 단어 `POST /family/<childId>/plan`·`GET|POST /daily/<childId>`·크론 `scheduled()`(`FamilyStore.buildDaily`, `DAILY_SYSTEM`, `DAILY_MODEL`), 세트 동기화 `POST /sets/<childId>`(가족 코드, `parseSetsSync` → `FamilyStore.syncSets`)·`GET|POST /family/<childId>/sets`·`GET|DELETE /family/<childId>/sets/<setId>`(보호자, `parseSetUpload`; 키 `set:<childId>:<setId>`, 묘비 `deletedAt`). 시스템 프롬프트·JSON 스키마·모델 선택·오류 변환·북미 중계(Durable Object)·코드 역할(`roleOf`)이 여기 있다. |
| `worker/wrangler.jsonc`, `worker/package.json`, `worker/README.md` | Worker 설정(`vars`, `ratelimits`, `durable_objects` RELAY·FAMILY, `migrations` v1·v2), 배포 스크립트(`npm run parent-code` = PARENT_PASSCODE 등록), 보호자용 배포 안내. 비밀값(ANTHROPIC_API_KEY, APP_PASSCODE, PARENT_PASSCODE)은 `wrangler secret put`으로만 넣는다. |
| `tests/*.cjs` | Playwright 브라우저 테스트 + Worker 단위 테스트 (아래 참고). |
| `docs/DESIGN.md` | 2026-10-12 전면 개편 설계서(전수 검사 결과, 화면 구조, 데이터 모델, 진행 상태). |
| `.nojekyll` | GitHub Pages가 Jekyll 처리하지 않도록 함. 삭제 금지. |
| `.claude/` | Claude Code 로컬 도구: `dev-server.cjs`, `run-tests.cjs`, `launch.json`. 앱 동작과 무관. |
| `android/` | 갤럭시 태블릿용 네이티브 래퍼 앱(Kotlin, WebView). `MainActivity.kt`(FLAG_SECURE로 화면 캡처·서클 투 서치 차단, 사진 선택·촬영, 마이크 권한, 뒤로 가기, 아이 링크), `SpeechBridge.kt` + `assets/bridge.js`(WebView에 없는 Web Speech API를 안드로이드 음성 인식·TTS로 채움 — 웹앱 코드 수정 없음), `scripts/setup-signing.sh`(서명 키 생성 + GitHub Secrets 등록), `README.md`(설치·업데이트). 빌드는 `.github/workflows/android-apk.yml`(PR은 아티팩트, main·수동은 Release `android-vN`). 웹앱과 별개로 버전 관리(`app/build.gradle.kts` versionCode/versionName). |

## 화면 구조와 ID
- 뷰: `#home`(세트 선택 `#setPicker`·세트 0개면 `#noSets` 빈 상태(시작 버튼 비활성)·시험 설정·최근 결과·이어서 하기 카드), `#quiz`, `#finish`(결과), `#editor`(세트 편집; 보호자 모드에서는 `window.editorForChild`가 있을 때만 열리고 저장이 아이에게 보내기가 됨), `#lookup`(단어 찾기: `#lookupInput #lookupGo #lookupMic #lookupStatus`, 결과 카드 `#lookupResult`(`#lookupWord #lookupIpa #lookupHear #lookupMeaning #lookupExamples #lookupSimilar #lookupNote #lookupSaved`), 최근 목록 `#lookupRecent #lookupCount #lookupQuiz`; 탭 `#tabLookup`은 보호자 모드에서 숨김), `#history`, `#family`(보호자 폰 ‘아이들’ 관리: `#parentSetup` 코드 입력, `#familyMain` 오늘 한눈에 `#familyOverview`, `#childrenCard`, `#childDetail`의 `#linkBox`·`#setsBox`(📚 세트: `#childSets`·`#sendNewSet`·`#setsStatus`)·`#planBox`), `#settings`. **보호자 모드**(`isParentMode()`: 보호자 코드가 있거나 `?mode=parent`로 설치, `parentModeOff`가 아닐 때)에서는 `body.parent-mode`가 붙고 `showView`가 아이용 화면 요청(home·quiz·finish·editor·history)을 `family`로 바꾸며 `.child-only` 요소(마이크·백업 카드, 가족 기록함의 아이 기기 부분)가 숨는다. `showView(name)`이 `.view.active`를 바꾸고 `body.in-quiz`로 하단 탭을 숨긴다.
- 하단 탭 `#tabHome #tabLookup #tabHistory #tabFamily #tabSettings`(`#tabFamily`는 보호자 코드가 있거나 보호자 모드일 때만, 보호자 모드에서는 `#tabHome #tabLookup #tabHistory`가 숨음), 상단 `#openSettings`(시험 중 숨김), `#brandTagline`(보호자 모드 문구). 시험 중에는 탭이 숨고 `#pauseQuiz`(쉬기)·`#backSettings`(그만하기)가 있다. `showView`는 시험 중 다른 화면 요청을 쉬기로 바꾸고, `history.pushState`/`popstate`로 Android 뒤로 가기를 화면 되돌리기로 처리한다.
- 세트 삭제·이름 바꾸기(`#renameSet #deleteSet #renameBox`)는 편집 화면의 `#manageBox`(기존 세트일 때만, 보호자가 아이 세트를 고칠 때는 숨김)에 있다. 아이가 쓰는 홈에는 두지 않는다. 마지막 세트도 지울 수 있다(세트 0개 허용). 미저장 초안(`draftDirty`)은 닫기·다른 세트 열기 전에 확인한다.
- 사진 선택은 `selectedFiles` 배열: `#photos`는 바꿔치기, `#camera`는 누적(최대 10장), 썸네일 ✕로 제거. 가져오기 성공한 사진은 목록에서 빠진다.
- 테스트가 참조하는 ID는 유지한다: `#start #review #reviewCount #range #shuffle #setSelect #createSet #editSet #renameSet #deleteSet #setStatus #resumeCard #resumeQuiz #discardSession #resumeEditor #unknown #next #check #answerInput #readInput #checkRead #parentConfirm #progressText #finalScore #missedList #againSame #newTest #historyList #historyFilter #historySummary #exportHistory #clearHistory #setName #photos #camera #pickPhotos #takePhoto #extractWords #cancelExtract #extractStatus #fillMeanings #wordTableBody #addRow #toggleDraftText #wordDraft #wordCount #confirmed #saveSet #closeEditor #editorTitle #manageBox #manageStatus #finishTitle #aiSettings #aiServer #aiPasscode #saveAi #testAi #clearAi #aiState #aiStatus #backupStatus #appStatus #refreshApp #checkApp #familySettings #familyState #joinBox #childCode #joinChild #linkedBox #childName(연결된 아이 이름 표시) #deviceLabelText #familySend #saveFamily #syncNow #unlinkChild #familyStatus #newChildName #addChild #addChildStatus #linkBox #childCodeText #childLinkText #copyLink #copyCode #regenCode #deviceList #renameChild #saveChildName #linkStatus #parentCode #saveParent #clearParent #parentStatus #parentState #tabFamily #refreshFamily #familyLoadStatus #childrenList #childDetail #childDetailTitle #childDetailSummary #childRecords #closeChildDetail #deleteChild #dailyCard #dailyTitle #dailyText #startDaily #planBox #planEnabled #planLevel #planLevelCustom #planCount #planHour #planTimeLimit #savePlan #makeDailyNow #planAnchor #planStatus #dailyPreview #timeLeft #parentSetup #parentCodeStart #saveParentStart #parentSetupStatus #familyMain #familyOverview #childrenCard #missedTop #parentModeRow #parentModeOff #familyChildPart #brandTagline #noSets #setPicker #setsSyncText #setsBox #childSets #sendNewSet #setsStatus`.
- 상태 문구도 테스트가 본다: "사진을 선택했습니다", "가져오지 못했습니다", "취소", "보호자 설정", "연결 성공", "중단", "AI 사전으로 채웠어요", "노란 칸", "못 찾은 단어", "먼저 영어 단어", "다시 배포", 가족 기록함의 "화면 이탈"("⚠️ 문제 중 화면 이탈 N회", "⚠️ 오늘 화면 이탈 N회"), "접속 코드를 저장", "연결했어요", "찾을 수 없어요", "6자리", "연결 안 됨", "아이 코드 N N", "아직 연결된 기기가 없어요", "연결 기기:", "마지막 전송", "못 보낸 기록 N개", "보낼 기록 N개", "꺼짐"/"켜짐", "보호자 코드가 맞지 않아요", "연결 성공", "방금 확인했어요", "오늘 ✅ N회", "최근 7일 N회", "아직 기록을 보낸 아이가 없어요", "시험 N회", 오늘의 단어의 "📬 오늘의 단어", "새 단어 N개", "복습 N개", "✅ 오늘의 단어 … 끝!", "N / N 맞았어요", 제한 시간의 "⏱ N초", "시간이 다 됐어요", "⏱ 시간 초과 N개", "제한 시간 N초", 보호자 모드의 "보호자 · 아이들 관리", "오늘 시험 ✅ N회", "이번 주 N회", "N회"(자주 틀린 단어 칩), "한 번 더 풀기", "오늘의 단어 ✅ N / N", "저장했어요", "준비됐어요", "만들지 않아요", "꺼져 있어요", 세트 동기화의 "세트 N개"(설정·상세 요약), "N에게 보내기"(편집기 제목), "보냈어요", "N단어"(세트 목록 "이름 · N단어"), "모두 지웠어요", "아직 세트가 없어요", AI 2차 채점의 "AI 판정", "확인하는 중", "🤖 AI 인정 N개", 단어 찾기의 "아직 찾아본 단어가 없어요", "찾는 중", "찾았어요", "N번으로 넣었어요", "이미 있어요", "N번째 찾기", "전에 찾아본", "찾지 못했어요", "혹시 ‘N’인가요", "영어 단어나 짧은 구만".
- 표의 뜻·발음 칸에 AI 사전이 채운 값은 `.ai-filled`(노란 칸) 클래스로 표시한다(`aiFilled` Map, 편집 중에만; 직접 고치면 사라지고 저장 데이터·초안 텍스트에는 남지 않는다).

## 핵심 데이터 구조
- 단어 객체: `{ id:number|string, en, ko, ipa, hangul, aliases:string[] }`. 기본 세트는 121~160번 40개(`quiz.js`의 `WORDS` 배열).
- 시험 모드(`data-mode`): `read_meaning`(읽기+뜻), `en_ko`(영어→한글), `ko_en`(한글→영어·철자).
- 초안(`#wordDraft`) 형식: 한 줄에 `번호\t영어\t뜻\t별칭|별칭\t발음`(발음은 선택). `parseDraft`가 읽고 `appendDraftRows`·`tableToDraft`가 쓴다. 표 편집기는 이 텍스트와 양방향 동기화되며 300단어를 넘으면 텍스트 모드로 자동 전환.
- localStorage 키 (버전 접미사 유지, 깨뜨리면 사용자 기록 유실):
  - `daily_vocab_sets_v2` — 세트 배열 `[{id,name,words,updatedAt?}]`. 빈 배열도 정상(세트 0개: `activeSetId=null`, `WORDS=[]`, 홈 `#noSets`). 기본 예제 `day04`는 연결된 기기에서 손대지 않았으면 첫 세트 동기화 뒤 제거된다. `updatedAt`은 세트 동기화의 충돌 기준(나중 것 우선)이라 저장·이름 바꾸기·가져오기 때 반드시 갱신한다.
  - `daily_vocab_history_v2` — 시험 기록 `[{id,setId,setName,mode,range,startedAt,completedAt,activeMs?,daily?,awayCount?,awayMs?,timeouts?,results,partial?}]` (`activeMs`는 실제 푼 시간; `daily`는 오늘의 단어 날짜; `awayCount/awayMs`는 문제 중 화면 이탈 횟수·시간, `results[i].away/awayMs`는 문제별; `timeouts`는 제한 시간 초과로 모름 처리된 문제 수, `results[i].timeout`. 2026-10-18) (`partial`은 그만하기·쉬던 시험 포기로 끝난 중단 기록; `results[i].self`는 ‘소리 내어 읽었어요’로 직접 확인한 읽기). 기록 탭의 세트 필터는 그 세트 기록만, ‘전체 세트’는 삭제된 세트 기록까지 보여 준다.
  - `daily_vocab_missed_<setId>` — 세트별 오답 id 배열
  - `daily_vocab_session_v1` — 쉬는 중인 시험 `{meta, mode, queue, position, results, pausedAt}` (문제를 넘길 때마다·쉬기·화면 숨김 시 저장, 완료·그만하기 시 삭제). `meta.activeMs/resumedAt`로 실제 푼 시간을 누적한다. 쉬기 전에 채점이 끝난 문제는 결과로 넣고 넘긴다. 틀린 단어는 `meta.setId`의 키에 저장한다(선택 세트와 달라도).
  - `daily_vocab_prefs_v1` — `{mode, range, shuffle, setId}` 마지막 선택
  - `daily_vocab_legacy_backup_v1` — 구버전(`day04_wordtest_*`) 자동 변환 백업
  - `daily_vocab_ai_v2` — `{server, passcode}` AI 서버 주소·접속 코드. **백업 JSON/CSV에 절대 포함하지 않는다.**
  - `daily_vocab_ai_v1` — (폐기) 예전에 API 키를 저장하던 키. 시작 시 지운다.
  - `daily_vocab_lookups_v1` — 단어 찾기 기록 `[{en, ko, ipa, pos, aliases, examples:[{en,ko}], similar, note, firstAt, lastAt, count}]`(최신순, 최대 500, 이 기기에만, 백업 JSON에 넣지 않음). 찾은 단어 자체는 세트 `lookup`(‘찾아본 단어’, 보통 세트라 동기화됨)에 들어간다.
  - `daily_vocab_family_v1` — 가족 기록함 `{childId, childName, joinCode, pendingCode, deviceId, sendEnabled, lastSyncAt, lastError, pending:[기록 id], parentCode, setsAcked:{세트 id: 수정 시각}, setsDeleted:[{id, deletedAt}], setsSyncedAt, setsError}`(`childId`는 보호자가 만든 아이의 서버 id, `deviceId`는 기기마다 1회 생성, `setsAcked`는 서버가 아는 세트 요약으로 이와 다른 세트만 다시 올린다). **백업 JSON/CSV에 절대 포함하지 않는다.**
  - `daily_vocab_family_cache_v1` — 보호자 폰의 마지막 `GET /family` 응답(+`fetchedAt`). 보호자 코드를 지우면 함께 지운다.
  - `daily_vocab_mode_v1` — `"parent"`면 보호자 아이콘으로 설치된 기기(`?mode=parent`로 설정, `?mode=child`로 해제). `daily_vocab_family_v1.parentModeOff`는 ‘아이 기기처럼 보기’.
  - `daily_vocab_daily_v1` — 오늘의 단어 하루치 `{childId, date, words:[{id,en,ko,ipa,aliases,kind}], level, note, fetchedAt, result?:{id,correct,total,completedAt}, disabled?, lastCheckedAt, lastError?}`. 세트 목록에는 넣지 않는다.
- 저장 데이터는 **검증 실패 시 덮어쓰지 않는다**(`storageAvailable=false`로 보호). 이 원칙을 유지한다.

## AI 사진 인식 구조
- 흐름: 앱이 사진을 `preparePhoto`(긴 변 2000px) → JPEG(0.92) base64 → `POST {server}/recognize` (헤더 `x-app-passcode`, JSON `{image, mediaType}`) → Worker가 Anthropic `POST /v1/messages`(모델 기본 `claude-opus-5-5`, `thinking` 생략=adaptive, `output_config.effort: "medium"`, `output_config.format` json_schema) → `{words:[{number,en,ko,ipa,aliases,generated}], note, model, usage}` → 앱 `appendDraftRows`가 초안에 추가(인쇄 번호 유지, 없거나 겹치면 이어서 번호) → 표 갱신.
- **영어만 있는 사진**: 프롬프트는 뜻이 인쇄된 항목은 인쇄된 뜻만 쓰고, 뜻이 인쇄되지 않은 항목(단어 목록·시험지·손글씨)은 학습자 사전처럼 뜻·발음을 채워 `generated:true`로 표시하게 한다(읽기 어려운 뜻은 생성하지 않고 건너뛰어 note). 앱은 `generated` 행을 노란 칸으로 표시하고 상태 문구에 ‘뜻 N개는 사진에 없어 AI 사전으로 채웠어요’를 넣는다.
- **AI 2차 채점 `/grade`(2026-10-18)**: quiz.js `grade()`는 먼저 기기에서 `correctKo`(자리표시 조사 `…을/~에게/(…)` 제거 `stripKoPlaceholders`, 뜻으로 끝나는 두 글자 이내 합성어 인정)로 채점하고, 오답이면서 `ko_en`이 아니고 `judgeMeaning.available()`(sets.js: `aiConfig()` 있고 온라인)이면 `question.aiPending` 상태로 입력을 잠그고 `POST {server}/grade {en, ko, aliases, answer}` → `{accept, reason}`(Worker `gradeAnswer`, `GRADE_SYSTEM`/`GRADE_SCHEMA`, 모델 `GRADE_MODEL` 기본 `claude-haiku-5-5`, fallbacks 없음) → `finishGrade`. 인정되면 `question.aiPass`·`sessionMeta.aiPass`·기록 `aiPass`/`results[i].ai`, `learnAlias`가 그 세트 단어의 허용 답안에 답을 추가(`persistSets` + `queueSetsSync`). 실패·8초 초과·404면 null → 오답 유지. 쉬기·그만하기로 문제가 바뀌면 늦은 판정은 버린다(`question !== target`). 오늘의 단어 시험은 학습하지 않는다.
- **단어 찾기 `/lookup`(2026-10-18)**: 아이 기기의 🔍 찾기 탭. `POST {server}/lookup {word}`(`WORD_PATTERN`, 모델 `LOOKUP_MODEL` 기본 `claude-sonnet-5-5`, `LOOKUP_SYSTEM`/`LOOKUP_SCHEMA`, effort low) → `{found, en, suggestion, pos, ko, ipa, aliases, examples:[{en,ko}], similar, note}`. 앱 `lookupWord`는 저장된 결과(`daily_vocab_lookups_v1`)가 있으면 AI를 부르지 않고, 찾으면 `addToLookupSet`이 세트 `lookup`(‘찾아본 단어’, 번호는 찾은 순서, 허용 답안은 AI 결과)에 넣고 `queueSetsSync`. 못 찾으면 `suggestion`을 입력칸에 넣어 준다. 네이버 사전 등 외부 링크는 넣지 않는다(사용자 결정).
- **AI 사전 `/define`**: `POST {server}/define` JSON `{words:["apple",…]}`(최대 60개, `WORD_PATTERN` = 영문자로 시작·공백·.'’-·40자 이하, Worker와 앱에 같은 규칙) → `{words:[{en,ko,ipa,aliases}], note, model, usage}`. 요청한 철자 그대로 한 번씩만 돌려주고 모르는 단어는 빠진다(전부 모르면 422). 앱의 `#fillMeanings`(빈 뜻 AI로 채우기)는 뜻이나 발음이 빈 행의 영어만 40개씩 순차 전송해 빈 칸만 채운다(뜻이 빈 행: 뜻·허용 답안·발음, 발음만 빈 행: 발음; 적힌 칸은 바꾸지 않음). 옛 Worker(404)면 ‘다시 배포’ 안내. 사진 인식과 같은 `startOperation`(한 번에 하나, 취소·시간 초과·버튼 잠금·늦은 결과 폐기)을 쓴다.
- 한 장당 요청 1개, 순차 처리, 앱 120초 타임아웃, 취소는 `AbortController`. Worker는 Anthropic 호출에 110초 타임아웃.
- **북미 중계**: Anthropic은 홍콩(HKG) 등 미지원 지역발 요청을 `403 forbidden: Request not allowed`로 거절하는데, 한국발 요청이 Cloudflare HKG에서 실행될 때가 있다(2026-10-12 실측). 그래서 Anthropic 호출은 `locationHint: "wnam"`으로 북미에 고정한 Durable Object `AnthropicRelay`(RELAY 바인딩)를 거친다. RELAY가 없거나 실패하면 직접 호출로 폴백. `GET /diag`(비밀값 불필요)로 `ok:true`(upstream 401)를 확인할 수 있다. 이 구조를 없애면 안 된다.
- 키 위생: 등록된 키는 trim 후 출력 가능한 ASCII·`sk-ant-` 접두사를 검사해 잘못 붙여넣은 키를 Anthropic 호출 전에 걸러 준다(길이·문자 종류만 알려 주고 값은 절대 로그·응답에 넣지 않는다). Anthropic 오류는 `[Anthropic <status> <type>: <message>]`를 덧붙여 앱에 전달한다. `wrangler tail` 로그에는 요청 헤더(접속 코드 포함)가 찍히므로 디버깅 외에는 보지 않는다.
- Worker 보안: Origin 허용 목록(`ALLOWED_ORIGINS`, 경로 무관 origin만), 접속 코드 상수 시간 비교, 선택적 `RATE_LIMITER`(IP당 분당 30회), base64 검증과 8MB 상한, 모델 허용 목록. Anthropic 401/403은 앱의 접속 코드 오류(401)와 구분하려고 502로 바꿔 돌려준다.
- Opus/Sonnet에는 `fallbacks: "default"` + `anthropic-beta: server-side-fallback-2026-07-01`을 붙이고, 400 메시지에 "fallback"이 있으면 둘 다 빼고 한 번 재시도한다. Haiku에는 붙이지 않는다.
- 배포된 Worker: `https://daily-vocab-ai.reonwipe.workers.dev` (Cloudflare 계정 reonwipe, Worker 이름 `daily-vocab-ai`). `sets.js`의 `AI_SERVER_DEFAULT`에 들어 있어 보호자는 접속 코드만 입력한다. 재배포는 `cd worker && npm run deploy`(로그인 상태 유지됨).
- 프롬프트·스키마를 바꾸면 Worker 재배포가 필요하다(앱 배포와 별개). 응답 형식을 바꾸면 `tests/worker.cjs`와 `tests/ai-recognition.cjs` 둘 다 고친다.
- 실제 Anthropic 호출 테스트는 없다(키 필요). 키·접속 코드를 코드·문서·테스트에 절대 넣지 않는다. 보호자 설정(AI 연결) UI·동작은 사용자 요청으로 그대로 유지한다.

## 가족 기록함 (보호자 폰에서 아이들 기록 보기)
- 설계·결정 배경은 `docs/DESIGN.md` 10절. 아이들은 각자 기기(기기별 localStorage), 보호자는 자기 폰. 기록은 기기에 남고 사본이 가족 Worker로 간다. 세트는 2026-10-18부터 아이 단위로 Worker에 두고 연결된 모든 기기가 맞춘다(아래 ‘세트 동기화’).
- **코드 역할**: 가족 코드 `APP_PASSCODE`(AI + `/sync`), 보호자 코드 `PARENT_PASSCODE`(`/family…` 읽기·삭제, 가족 코드가 통하는 곳에도 통함). 아이 기기에는 가족 코드만 두므로 ‘아이들’ 탭이 생기지 않는다. 이 분리를 없애면 안 된다.
- **아이 코드(2026-10-18, `docs/DESIGN.md` 12절)**: 아이 한 명이 아이폰·태블릿 여러 대를 쓰므로 아이 = 서버가 만든 항목, 기기 = `devices`. 보호자가 `POST /family/children {name}`으로 만들면 6자리 `joinCode`(`code:<코드>` 키). 아이 기기는 `POST /join {code, device}`로 `childId`를 받아 저장하고 이후 `/sync`에 `child.id`·`device`를 보낸다(서버 이름이 기준). 전용 링크 `…/?child=<코드>`는 `initFamily`에서 읽어 자동 연결하고 주소에서 지운다. iOS는 Safari와 홈 화면 앱의 저장 공간이 달라 설치한 앱에서 코드를 넣어야 한다(README에 안내). 기기별 identity(이름 입력)로 만들던 옛 흐름은 없앴다.
- **부정행위 대응(2026-10-18, `docs/DESIGN.md` 13절)**: 시험 화면 `.word-box`는 `user-select:none`·`-webkit-touch-callout:none` + contextmenu/copy 차단(선택 → 번역 방지). 화면 이탈 기록은 quiz.js의 `awayStart/awayEnd`(visibilitychange·blur/focus, 1초 미만과 마이크 버튼 직후 2초는 제외, 채점 전 문제만) → `question.away/awayMs`, `sessionMeta.awayCount/awayMs` → 기록 → `compactRecord` → Worker → 보호자 기록에 `.away-flag`. OS의 서클 투 서치·Apple Intelligence는 웹앱이 막을 수 없다: 갤럭시는 `android/` 래퍼 앱(FLAG_SECURE, 준비 중)으로, 아이폰은 스크린 타임 안내로 대응한다.
- **보호자 모드(2026-10-18, `docs/DESIGN.md` 14절)**: 보호자 폰은 문제를 풀 일이 없으므로 관리 전용 화면으로 시작한다. `family.js`의 `isParentMode`/`applyParentMode`(탭·문구·`.child-only` 토글, 화면 이동은 모드가 바뀌는 곳에서만), `saveParentCode`(설정의 `#parentBox`와 첫 화면 `#parentSetup`이 공용, 저장 시 `showView("family")`; `#parentBox`·`#parentModeRow`는 보호자 기기(`?mode=parent`로 열었거나 코드가 저장된 기기)에서만 보이고 아이 기기에는 없다), `renderFamily`(코드 없으면 설정 카드만), `renderOverview`(오늘 한눈에: 오늘 시험·오늘의 단어·이번 주·⚠️/⏱ 경고), `missedTop`/`renderMissedTop`(최근 2주 틀린 단어 상위 10). `initFamily`가 `?mode=` 를 읽고 보호자 모드면 `showView("family")`. 아이 기기 동작은 바뀌지 않는다.
- **문제당 제한 시간(2026-10-18)**: 보호자가 `POST /family/<id>/plan {timeLimitSec}`(0 또는 5~120)로 정하면 아이 기기가 앱을 열 때 `GET /settings/<childId>`(가족 코드, `fetchSettings`, 10분 간격·시작 때 즉시)로 받아 `family.settings.timeLimitSec`에 둔다(`/join` 응답에도 포함). quiz.js `startQuestionTimer`(displayQuestion마다, 절대 마감 시각이라 앱 밖에 있어도 흐름) → `#timeLeft` 카운트다운(5초 이하 `.urgent`) → 0이면 `question.timedOut`·`sessionMeta.timeouts++`·`markUnknown()`·"시간이 다 됐어요". 채점·모름·쉬기·그만하기·완료에서 `stopQuestionTimer`. 기록 `timeouts`·`results[i].timeout` → 아이 기록 탭·보호자 기록에 "⏱ 시간 초과 N개". 오늘의 단어 계획과 같은 `plan` 객체지만 `enabled`와 무관하게 모든 시험에 적용.
- **아이 기기**: `saveSession`(완료·중단) → `queueFamilySync(record)` → `compactRecord`(id, setName, mode, range, startedAt, completedAt, total, correct, partial, activeMs, missed[{en,ko,unknown?}] 최대 200) → `POST /sync {child:{id,name}, records(≤50), sets:[{name,count}]}`. 처음 켤 때 기존 기록 전체를 대기 목록에 넣는다. 기기에서 지운 기록은 보내지 않지만 서버 사본은 지우지 않는다. 단어별 전체 결과·세트 단어·사진은 보내지 않는다.
- **세트 동기화(2026-10-18, `docs/DESIGN.md` 15절)**: 아이가 기기마다 다른 세트(새 설치는 예제 하나)를 보던 문제의 해결. 세트는 `set:<childId>:<setId>` 키로 아이에게 속하고 아이 기기는 `POST /sets/<childId>`(가족 코드)에 `known`(전체 id·updatedAt)·`sets`(`setsAcked`와 다른 것만 전체)·`deleted`(묘비)·`device`를 보내 `sets`(없거나 더 새 것)·`deleted`(기기가 아는데 지워진 id)·`summary`(→ `setsAcked`)를 받는다. 세트별 `updatedAt` 나중 것 우선, 삭제는 `deletedAt` 묘비(지운 뒤 다른 기기가 고치면 부활). 손대지 않은 예제 세트는 올리지 않고 첫 성공 뒤 기기에서 제거(옛 Worker 404면 그대로 둠). 보호자는 `GET|POST /family/<id>/sets`·`GET|DELETE …/sets/<setId>`로 목록·보내기(서버가 updatedAt 부여, id 없으면 UUID)·고치기·삭제. 아이 항목 `sets` 요약은 서버가 계산하며 `setsSyncedAt`이 있으면 옛 앱의 `/sync` 세트 목록을 무시한다. 한도 아이당 50세트, 세트당 2,000단어, 본문 2MB. 시험 중에는 동기화하지 않는다. 보호자 폰의 `aiConfig()`는 AI 코드가 없으면 보호자 코드를 쓴다(사진 인식으로 세트 만들어 보내기).
- **Worker**: `FamilyStore`(SQLite 기반 DO, `idFromName("family")`)의 키-값 저장소. 키 `child:<id>`(이름·세트·lastTestAt·recordCount), `rec:<childId>:<completedAt ISO>:<recordId>`(압축 기록 + receivedAt, 같은 키는 덮어씀). `GET /family`는 아이별 최근 14일(20개 미만이면 최근 20개) 기록, `GET /family/<id>`는 전체, 아이당 5,000개 초과분은 오래된 것부터 삭제. 검증은 `parseSync`(하나라도 틀리면 전체 400). 모르는 아이는 404 `unknown_child`(옛 Worker 404 `not_found`와 앱이 구분해 ‘다시 배포’ 안내).
- **보호자 폰**: 보호자 코드 저장 즉시 `GET /family`로 확인 → `#tabFamily` 표시. 오늘·최근 7일은 폰의 현지 날짜로 계산(`dayKey`). 마지막 응답은 `daily_vocab_family_cache_v1`에 캐시.
- 배포 순서: Worker 먼저(`cd worker && npm run deploy`, 마이그레이션 v2 포함) → `npm run parent-code`로 보호자 코드 등록 → 앱 배포. 옛 Worker에 앱이 요청하면 404 → ‘다시 배포’ 문구.
- 응답 형식을 바꾸면 `tests/worker.cjs`와 `tests/family.cjs`·`tests/daily.cjs`(가짜 Worker 라우트)를 함께 고친다. 2B 푸시·2C 수준 조절은 미구현(3단계 세트 보내기는 세트 동기화로 구현).
- **오늘의 단어(2A, `docs/DESIGN.md` 11절)**: 보호자가 `POST /family/<id>/plan`으로 `{enabled, level, dailyCount 5~20, hour 0~23(KST)}`를 저장하면 크론(매시, `scheduled()` → DO `/cron`)이 계획 시각이 지난 아이의 `daily:<childId>:<YYYY-MM-DD>`를 만든다. 아이 기기는 `checkDaily`로 `GET /daily/<id>?date=` → 404 `no_daily`면 `POST /daily/<id>`(즉시 생성, 같은 날 중복 생성 없음), 409 `plan_disabled`면 카드 숨김. 구성은 복습 최대 3개(최근 14일 틀린 단어) + 새 단어(`DAILY_SYSTEM` + 수준 라벨 + 교재 앵커 `child.anchor`(아이 기기가 `/sync`마다 최근 세트 영어 60개) + 최근 200개 제외, 2배수 요청 후 `served:<childId>`·앵커·`WORD_PATTERN`으로 걸러 채움, 최대 2회). 홈 `#dailyCard` → `newSession(false, words, {setId:"daily:<date>", setName}, {rangeLabel:"오늘의 단어", daily:date})` → 기록 `daily` → `/sync` → `completed`(중단 기록 제외). 세트로 저장하지 않으며 `daily_vocab_missed_daily:*` 키도 만들지 않는다. 모델은 `DAILY_MODEL`(기본 sonnet).

## 갤럭시 앱 (`android/`)
- 목적: 웹앱은 OS의 서클 투 서치·스크린샷을 막을 수 없으므로, 안드로이드 앱의 `FLAG_SECURE`로 **이 앱 화면에서만** 막는다. 아이폰은 해당 수단이 없다(스크린 타임 안내).
- 화면 분할 차단(v1.2, `docs/DESIGN.md` 13.2절): 매니페스트 `resizeableActivity="false"` + `MainActivity`의 멀티윈도우 감지(`onMultiWindowModeChanged`/`isInMultiWindowMode`) → WebView `INVISIBLE` + 남색 가림막(`split_blocked_*` 문자열). WebView를 숨기면 페이지가 `visibilitychange(hidden)`을 받아 웹앱의 화면 이탈 기록이 동작한다. 이 두 겹을 없애면 안 된다.
- 창 여백: Android 15(targetSdk 35)의 edge-to-edge 강제로 상태 표시줄이 가려지던 문제를 `MainActivity`가 `setDecorFitsSystemWindows(false)` + 인셋 리스너로 위(남색)·아래(흰색, 키보드 포함) 여백을 직접 두어 해결했다(v1.1). 웹 쪽 `.topbar`도 `env(safe-area-inset-top)` 여백을 둔다.
- 웹앱과의 관계: 앱은 `https://hongtaehwa.github.io/daily-vocab/` 주소만 안다. `assets/bridge.js`가 페이지 스크립트보다 먼저 실행되어(`WebViewCompat.addDocumentStartJavaScript`) `window.SpeechRecognition`·`speechSynthesis`를 `AndroidSpeech` 브리지로 바꾸므로 quiz.js의 음성 코드는 그대로다. UA에 `DailyVocabApp/버전`이 붙는다(가족 기록함의 기기 종류 표시에 쓸 수 있음). WebView 저장 공간은 Chrome과 별개다.
- 빌드·배포: 로컬에 JDK/Android SDK가 없어도 된다. `android/**`를 바꾼 PR은 GitHub Actions가 APK를 아티팩트로 만들고, `main`에 올라가거나 수동 실행하면 Release `android-vN`에 APK를 붙인다. 서명 키는 보호자가 `bash android/scripts/setup-signing.sh`로 한 번 만들어 Secrets(`ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`)에 넣는다. Secrets가 없으면 debug 키로 서명된다(업데이트 때 기존 앱 삭제 필요). 키 파일(`android/keystore/`, `*.p12`, `*.jks`)은 절대 커밋하지 않는다.
- 테스트: 자동 테스트 없음(실기기·CI 빌드로 확인). 브리지 이벤트 형식(`{type:"start"|"result"|"error"|"end", text|code}`)을 바꾸면 `bridge.js`와 `SpeechBridge.kt`를 함께 고친다.

## 버전·캐시 올리기 (앱 셸을 바꿀 때 반드시)
릴리스 문자열 `20261018-12` 와 캐시 이름 `daily-vocab-shell-v21` 가 여러 곳에 있다. **한 곳만 바꾸면 테스트가 깨지거나 사용자에게 옛 캐시가 남는다.**
1. `index.html` `#appStatus` 초기 텍스트의 버전
2. `index.html` `var release = '...'`
3. `index.html` 마지막 `<script src="./quiz.js?v=...">`, `./family.js?v=...`, `./sets.js?v=...` (셋 다)
4. `sw.js` — `CACHE` 상수(`-v21` → `-v22`)와 `SHELL` 배열의 `./quiz.js?v=...`, `./family.js?v=...`, `./sets.js?v=...`
5. `tests/app-update.cjs` — 버전 문자열 검사
확인: `grep -rn "20261018-12\|daily-vocab-shell-v" index.html sw.js tests/`

## 로컬 실행
```bash
node .claude/dev-server.cjs
```
→ http://127.0.0.1:8000/daily-vocab/ (Pages와 같은 경로. 의존성 없음. `PORT=8001`처럼 포트 변경 가능.)
Claude Code 브라우저 미리보기(`.claude/launch.json`)가 예전 폴더 설정을 잡을 때가 있으니, 미리보기 주소가 404면 위 명령으로 직접 띄우고 탭에서 연다. Worker를 로컬에서 함께 띄우려면 `worker/README.md`의 `.dev.vars` 안내를 따른다(`npm run dev`, 8787 포트).

## 테스트
Playwright는 **전역 설치**되어 있다(`npm i -g playwright` + `npx playwright install chromium`). 저장소 루트에는 `package.json`을 두지 않는다(앱 런타임 무의존 원칙). `worker/package.json`은 Worker 배포 전용이다.
```bash
node .claude/run-tests.cjs            # 전체 9개 (약 35초)
node .claude/run-tests.cjs session    # 특정 테스트만
node tests/worker.cjs                 # Worker 단위 테스트만 (서버·Playwright 불필요)
```
실행기가 NODE_PATH를 전역 모듈로 잡고, 8000 포트에 서버가 없으면 자동으로 띄운다.
| 테스트 | 확인 내용 |
|---|---|
| `worker.cjs` | Worker: CORS/Origin, 접속 코드, 비밀값 누락, 요청 제한, 입력 검증, 결과 정리(`generated` 플래그), AI 사전 `/define`(검증·철자 매칭·중복 제거·빈 결과 422·거부), AI 2차 채점 `/grade`(검증·POST만·401·haiku 기본·fallbacks 없음·프롬프트·accept/reason 전달·`GRADE_MODEL`·거부 422), 단어 찾기 `/lookup`(검증·POST만·401·sonnet 기본·프롬프트/스키마·결과 정리(괄호 IPA·중복 별칭·빈 예문·비단어 제외)·못 찾음 제안·뜻 없는 found 처리·`LOOKUP_MODEL`), fallbacks 재시도, Anthropic 오류 변환, 북미 중계·폴백, diag, 키 형식 검사, 타임아웃, 가족 기록함(`/sync` 검증·덮어쓰기·14일 요약·5,000개 상한, 코드 역할, 미설정 안내, 삭제, DO 저장소 모의, 503), 오늘의 단어(계획 검증·권한, 앵커 정리, 생성: 복습+새 단어·앵커/이미 낸 단어 제외·2회 재요청·같은 날 중복 없음, 완료 표시(중단 제외), 거부 422, 크론 시각·중복·꺼진 아이, 삭제 정리), 아이 코드(아이 만들기 권한·검증, `/join` 코드 형식·모르는 코드·기기 등록·보호자 코드 허용, 두 기기 기록 병합·서버 이름 우선·화면 이탈 필드 보존, 이름 바꾸기, 코드 재발급 후 옛 코드 무효, 목록의 코드·기기, 삭제 시 코드 삭제), 제한 시간(plan `timeLimitSec` 검증, `GET /settings`, 기록 `timeouts` 보존), 세트 동기화(`/sets` 검증·권한·첫 올리기·새 기기 내려받기·나중 수정 우선·보호자 목록/보내기/보기/고치기/삭제·묘비 전파·삭제 뒤 수정 부활·옛 `/sync` 요약 무시·상한 50·아이 삭제 시 세트 키 삭제) |
| `browser.cjs` | 기본 세트 40단어, 3가지 모드 시험 흐름(그만하기 → 중단 기록), 세트 저장(텍스트 모드), 엄격 채점과 기기 채점 규칙(`correctKo`: 자리표시 조사·괄호 무시, 합성어 인정, 그 밖은 오답), 세트별 기록 격리, 삭제된 세트 기록 재시험, 구버전 이전, 백업 JSON 왕복, 저장 실패 안내 |
| `pwa.cjs` | 서비스워커, 반응형 폭(768/1024/390) 오버플로 없음, 매니페스트 아이콘, 오프라인 셸, AI 서버 오류 안내·취소 |
| `app-update.cjs` | 옛 `sets.js` 캐시 상황에서 버전 표시·초기화 실패 안내·자료 보존 |
| `ten-photos.cjs` | 사진 10장 순차 전송·결과 보존, 11장 거부, 10단어 세트 시험 |
| `ai-recognition.cjs` | v1 키 제거, 보호자 설정 검증·저장·삭제(설정 뷰), 연결 확인, 편집 복귀, 사진 2장 인식과 번호 병합·표 표시, `generated` 뜻 노란 칸 표시·수정 시 해제, 저장·시험, AI 2차 채점(다른 답 → `/grade` 요청·인정 시 정답·허용 답안 학습, 거절 시 오답, 일치하는 답은 요청 없음), 단어 찾기(빈 상태 → weight 찾기 → 카드 내용·‘찾아본 단어’ 세트 생성·최근 목록 → 다시 찾기는 요청 없이 횟수 2 → 모르는 철자는 제안·미저장 → 비단어 거절 → 이 단어들로 시험 보기), 빈 뜻·발음 AI 채우기(빈 칸만, 두 번째 호출 범위, 옛 Worker 404 안내), 401/503/연결 실패 안내, 취소 |
| `session.cjs` | 탭 전환, 시험 글자 선택 차단(`user-select:none`), 책 번호 기준 범위 라벨, 쉬기 → 새로고침 → 이어서 하기 → 완료(틀린 단어 목록·같은 범위 다시), 그만하기 중단 기록, 세트 이름 바꾸기(기록 반영·유지), 표 편집기 ↔ 텍스트 동기화·행 삭제·저장, 마지막 선택 기억, 편집 중 설정 다녀오기 |
| `family.cjs` | 가족 기록함 + 아이 코드 + 보호자 모드: `parent.html` 안내 페이지, `?mode=parent`로 보호자 모드 시작(코드 입력 카드·탭(찾기 탭 숨김)·문구)과 `?mode=child` 해제, 전용 링크(`?child=`)로 열면 접속 코드 대기·주소 정리 → AI 연결 저장 시 자동 연결(`/join` 기기 정보)·등록 전송(기기·세트·앵커), 문제 중 화면 이탈(깜빡임 제외·1.2초 가림 1회 집계·기록·전송·보호자 카드/기록 ⚠️), 시험 완료 → 압축 기록 내용, 연결 실패 → ‘못 보낸 기록 1개’ → 새로고침 후 재전송(재연결 없음), 끄기 후 미전송, 연결 해제 → 코드 길이·모르는 코드 안내 → 재연결·기록 재전송, 보호자 코드 길이·오류·옛 Worker 안내, 아이 기기에는 보호자 코드 칸 없음 → 보호자 화면(`?mode=parent`)에서 저장 → 연결 성공 → 보호자 모드 자동 전환(아이들 화면·탭 숨김) → 오늘 한눈에(3회·이탈 경고)·카드(오늘 3회·최근 7일·연결 기기)·상세(코드 ‘483 921’·링크·기기 목록·자주 틀린 단어 10개·틀린 단어)·한눈에 줄로 상세 열기·‘아이 기기처럼 보기’ 켜고 끄기, 아이 추가(이름 검증·코드 ‘777 777’·상세 자동 열림·카드에 코드 표시)·이름 바꾸기·코드 새로 만들기(링크 갱신)·삭제, 코드 삭제 → 탭·캐시 제거; 세트 동기화 — 연결 시 예제 대신 서버 세트 받기(`known/sets/deleted` 빈 본문·`setsAcked`), 상세 📚 세트 목록, ‘세트 만들어 보내기’ → 보호자 모드 편집기(제목 ‘하늘에게 보내기’, 관리 상자 없음) → 텍스트 모드 입력 → 서버 전송·목록 갱신·기기에는 사본 없음, 보기·수정으로 단어 채움 → 닫기 → 상세, 아이 기기(`?mode=child`)에서 보호자 세트 수신, 편집기 삭제 → 묘비 전송·서버 삭제, 마지막 세트 삭제 → 빈 상태(`#noSets`·시작 비활성)·새로고침 유지·기록 필터 ‘전체’ |
| `daily.cjs` | 오늘의 단어: 계획 꺼짐이면 GET만 하고 카드 없음·앵커 전송, 옛 Worker(`/sets` 404)면 예제 세트 유지, 켠 뒤 새로고침 → GET(no_daily)→POST 생성 1회 → 카드 문구(새 단어 7 + 복습 3·수준) → 풀기(세션 범위·10문제) → 기록 `daily`·setId `daily:<date>`·missed 키 없음 → 전송 → ✅ 카드(한 번 더 풀기) → 새로고침 후 재생성 없음; 보호자 — 아이 카드 ‘오늘의 단어 ✅ 0 / 10’, 상세 계획 필드·앵커 안내·미리보기(복습 태그 3)·저장 본문·직접 입력 수준·지금 만들기(보호자 코드)·끄기 문구·제한 시간 저장(20초); 제한 시간 10초 — 앱 시작 시 `/settings` 수신 → 타이머 표시·카운트다운 → 시간 초과 시 모름·안내·다음 문제에서 재시작·채점 후 숨김 → 기록 `timeouts`·전송·아이 기록 탭·보호자 기록 표시·계획 폼 값 |
UI 요소를 바꾸면 위 ID 목록과 상태 문구를 테스트와 함께 맞춘다. 표 편집기 기본 화면에서는 `#wordDraft`가 숨겨져 있으므로 테스트에서 텍스트를 채우려면 먼저 `#toggleDraftText`를 누른다.

## 작업 규칙
- 변경 전 관련 테스트를 실행하고, 변경 후 `node .claude/run-tests.cjs`가 모두 PASS인지 확인한다.
- 기능·문구를 바꾸면 `README.md`의 해당 절도 같이 갱신한다(README는 사용 설명서 역할). Worker 설정을 바꾸면 `worker/README.md`도.
- 실제 교재 사진, 학생 개인정보, 녹음 파일, API 키, 접속 코드, 보호자 코드는 절대 커밋하지 않는다. `worker/.dev.vars`, `samples/`, `*key*.txt`는 gitignore 대상이다. 커밋 전 `git status`로 낯선 파일이 없는지 본다.
- 외부 CDN·추적 스크립트를 추가하지 않는다. 기기 밖으로 나가는 데이터는 브라우저 음성 인식과 가족 Worker(사진·AI 사전 단어·가족 기록함의 시험 기록)뿐이어야 하며, 새 외부 전송을 추가하려면 README의 개인정보 절도 함께 고친다.
- 아이가 쓰는 화면(홈·시험·결과)에 기술 선택지(엔진, 모델, 키, 백업)를 노출하지 않는다. 보호자용 기능은 설정 뷰에만 둔다.
- Git 흐름: `main`에서 `fix/...` 또는 `feat/...` 브랜치 → 커밋 → push → PR → 머지. `main` 직접 push는 사용자가 요청할 때만.
- 커밋 제목은 영어 명령형(기존 관례), 필요하면 본문에 한국어 설명.
- `gh` CLI는 `HongTaeHwa` 계정으로 로그인되어 있어 PR 생성·확인·머지가 가능하다. `gh pr edit`은 토큰 범위 부족으로 실패하므로 base 변경 등은 `gh api -X PATCH repos/.../pulls/N`을 쓴다. PR의 base 브랜치를 먼저 지우면 PR이 닫히니 머지 순서에 주의한다. GitHub 푸시 보호가 비밀값을 감지하면 푸시가 거부된다(커밋에서 빼고 다시 푸시).

## 알려진 환경 메모 (Windows)
- Bash 도구는 Git Bash이므로 경로는 `/d/Claude/Project/daily-vocab` 형식.
- Bash 히어독 본문에 ASCII 작은따옴표(`'`)가 홀수 개 있으면 명령이 깨지고, 백슬래시는 한 겹 벗겨진다(`\\x21`이 `\x21`로 도착). 긴 파일은 Write 도구로 쓰고, 기존 파일 수정은 Write로 만든 파이썬 치환 스크립트(개수 assert 포함)를 `python -I`로 실행한다.
- 앱 터미널 패널의 입력 프롬프트에서 Ctrl+V는 붙여넣기가 아니라 제어 문자를 넣는다. 비밀값 입력은 마우스 오른쪽 클릭이나 Ctrl+Shift+V.
- 작업 트리 파일은 CRLF일 수 있다(core.autocrlf). 치환 스크립트는 읽을 때 LF로 바꾸고 쓸 때 원래대로 되돌린다.
