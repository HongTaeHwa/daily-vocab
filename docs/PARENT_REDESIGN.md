# 보호자 앱 전면 개편 — 분석과 설계도 (2026-10-19)

이 문서는 보호자 폰에서 쓰는 ‘매일 영단어 보호자’(보호자 모드)를 전면 개편하기 위한 **현황 분석**, **개선 목표**, **목표 코드베이스 설계**, **단계별 구현 계획**이다. 구현은 이 문서를 기준으로 단계(PR)마다 별도 세션이 맡는다. 기존 설계 배경은 `docs/DESIGN.md` 10·11·14·15절, 운영 규칙은 `CLAUDE.md`.

## 0. 한눈에

- **결론**: 보호자 앱을 아이 앱(`index.html`)의 ‘모드’에서 떼어 내어 **`parent.html` 자체를 보호자 앱**으로 만든다. 공통 코드(서버 요청·서식·세트 편집기)는 `shared.js`·`editor.js`로 분리해 두 앱이 함께 쓴다. 화면은 **오늘 · 아이들 · 설정** 세 탭과 아이별 하위 탭(기록·세트·오늘의 단어·설정·질문)으로 다시 짜고, 해시 라우터로 뒤로 가기를 지원한다. 데이터는 단일 상태 저장소 + 캐시 우선(stale-while-revalidate)으로 바꾸고, Worker에는 기록 페이지 단위 읽기를 더한다.
- **왜**: 지금은 아이 앱 4,300행이 보호자 폰에 통째로 실려 모드 분기(`isParentMode`)가 세 파일에 흩어져 있고, 보호자 화면은 한 카드 안에 여섯 상자가 인라인으로 펼쳐져 길며, 상세를 열 때마다 아이의 **전체 기록(최대 5,000개)** 을 받는다. 새 기능(알림 2B·수준 조절 2C)을 얹을 자리도 없다.
- **단계**: A. 공통 모듈 분리(동작 변화 없음) → B. 보호자 앱 새로 쓰기(`parent.html`·`parent.js`, 아이 앱에서 보호자 모드 제거) → C. Worker 보강(기록 페이지·30일 창)과 보호자 기능 추가(틀린 단어로 세트 보내기·주간 비교·수준 제안). 단계마다 PR 하나, 전체 테스트 PASS, README·CLAUDE.md·DESIGN.md 갱신.

## 1. 범위와 목표

- **범위**: 보호자가 쓰는 모든 것 — 설치·코드 입력, 오늘 한눈에, 아이 카드, 아이 상세(연결·세트·오늘의 단어·제한 시간·잠금·자주 틀린 단어·물어본 문제·기록), 세트 만들어 보내기(편집기 재사용), 설정. 그리고 그것을 떠받치는 코드 구조(파일·모듈·상태·라우팅·캐시·테스트)와 Worker의 보호자용 API.
- **범위 밖**: 아이 앱의 학습 흐름(시험·채점·음성·찾기·문제 물어보기)과 아이 기기 동기화(기록·세트·설정 수신)는 바꾸지 않는다. 단, 아이 앱에서 ‘보호자 모드’ 코드를 걷어 내는 것은 범위 안이다(B단계).
- **사용자**: 보호자 1명(자기 폰, 주로 아이폰·갤럭시 폰 PWA). 아이 2명(중2·초5), 아이마다 기기 2대. 보호자는 문제를 풀지 않는다.
- **목표(우선순위 순)**
  1. **한 번에 알기**: 앱을 열면 3초 안에 “오늘 누가 얼마나 했는지, 경고가 있는지”가 보인다.
  2. **짧고 얕게**: 어떤 작업도 탭 2번 안에 닿고, 한 화면에 한 가지 일만 보인다. 뒤로 가기가 화면 단위로 동작한다.
  3. **빠르고 가볍게**: 보호자 폰은 보호자 코드만 넣고 쓰며, 아이 앱 코드를 싣지 않는다. 캐시를 먼저 그리고 네트워크는 뒤에서 갱신한다. 기록은 필요한 만큼만 받는다.
  4. **행동으로 이어지기**: 틀린 단어·수준·질문이 ‘보기’에서 끝나지 않고 ‘세트 보내기·수준 바꾸기’로 이어진다.
  5. **확장 자리**: 알림(2B), 수준 자동 조절(2C), 주간 리포트가 들어갈 구조를 미리 둔다.
  6. **원칙 유지**: 빌드 없음·순수 정적·외부 CDN 없음, 비밀값은 Worker에만, 아이 기기에는 가족 코드만, 테스트 ID·문구 계약, 버전 체크리스트.

## 2. 현재 구조 분석

### 2.1 코드 지도 (2026-10-19 main 2ade8dc 기준)

| 위치 | 내용 | 비고 |
|---|---|---|
| `index.html` 420~487행 | `#family` 뷰 마크업: `#parentSetup`(코드 입력), `#familyMain`(오늘 한눈에), `#childrenCard`(아이 카드 + 아이 추가), `#childDetail`(🔗 연결 → 📚 세트 → 📬 오늘의 단어 설정(+제한 시간) → 📉 자주 틀린 단어 → 📷 물어본 문제 → 🕒 기록 → 삭제) | 상세 6개 상자가 모두 펼쳐진 채 한 카드 안에 인라인 |
| `index.html` 490~554행 | 설정 뷰: AI 연결(`#aiSettings`), 가족 기록함(`#familySettings`: 아이 기기 부분 `.child-only` + `#parentBox` 보호자 코드 + `#parentModeRow`), 마이크(`.child-only`), 백업(`.child-only`), 앱 정보 | 보호자는 AI 연결 UI가 필요 없는데 그대로 보임 |
| `index.html` 9~206행 CSS | 한 파일에 전 화면 CSS 200행. 보호자용은 `.child-card .week-dots .overview-row .chip .plan-box .set-list .code-text .add-child` 등 | 보호자 화면만의 스타일 분리 없음 |
| `family.js` 72~106행 | 모드 판정 `isParentMode`/`applyParentMode`(`body.parent-mode`, 탭 토글, `#parentBox`) | 모드 분기의 중심 |
| `family.js` 947~1700행 | 보호자 대시보드 전부: 캐시 `familyData`/`familyDetail`, `refreshFamily`, `renderFamily`, `renderOverview`, `missedTop`, `describeChild`, `renderChildren`, `addChild`, `openChild`, `renderLinkBox`, 코드 복사·재발급·이름, `renderChildRecords`, `renderChildQuestions`, `renderChildSets`/`openChildSet`/`sendSetToChild`/`returnToChild`/`deleteChildSet`, `setsLock`, `fillPlanSelects`/`renderPlan`/`savePlan`/`makeDailyNow`, `deleteChild` | 약 750행이 아이 기기 동기화 코드(224~790행)와 한 파일 |
| `quiz.js` 125~130행 | `showView`가 보호자 모드면 홈·시험·결과·편집·찾기·기록 요청을 `family`로 바꿈(편집은 `window.editorForChild`일 때만 허용) | 아이 앱 라우팅에 보호자 분기 |
| `sets.js` 85~140·376행 | `openEditor`가 `window.editorForChild`를 보고 제목·관리 상자를 바꾸고, 저장이 `sendSetToChild`로 분기. `aiConfig()`는 보호자 코드를 접속 코드 대신 씀 | 편집기가 아이 세트 저장소(`sets`, `persistSets`, `selectSet`, `historyRecords`)와 결합 |
| `parent.html`, `manifest-parent.webmanifest` | 설치 안내 페이지(자동 이동 없음) + 매니페스트 `start_url: /daily-vocab/?mode=parent` | 설치 페이지와 앱이 다른 주소 |
| `sw.js` | 셸 캐시에 `parent.html`·보호자 아이콘 포함, 내비게이션 폴백은 항상 `index.html` | |
| `worker/worker.js` `FamilyStore` | 보호자용: `GET /family`(아이별 최근 14일, 20개 미만이면 최근 20개), `GET /family/<id>`(**전체 기록** 최신순 + 질문 100개 + 오늘), `DELETE`, `POST …/children|code|name|plan`, `GET|POST …/sets`, `GET|DELETE …/sets/<setId>`, `POST /daily/<id>` | 기록 상한 아이당 5,000개를 상세 한 번에 전송 |
| `tests/family.cjs`(660행), `tests/daily.cjs`(349행) | 보호자 흐름이 아이 기기 흐름과 한 파일에 섞임. 가짜 Worker 라우트가 두 파일에 각각 복제 | 보호자 전용 테스트 파일 없음 |

### 2.2 데이터 흐름 (보호자 폰)

1. 앱 시작(`initFamily`) → `?mode=parent` 기억 → `showView("family")` → `renderFamily()`: 캐시(`daily_vocab_family_cache_v1`)를 그리고 `GET /family` → `cacheFamily` → `renderChildren()`(오늘 한눈에 + 카드를 **매번 전부 다시 그림**).
2. 카드/한눈에 줄 → `openChild(c)`: 캐시 요약으로 상세를 먼저 그리고 `GET /family/<id>`(전체 기록) → 상세 6개 상자 재렌더. 상세 데이터는 캐시하지 않는다(다시 열면 다시 전체 수신).
3. 저장류(`plan`, `name`, `code`, `sets`, `setsLock`)는 각자 `familyRequest` 뒤 `familyDetail.child`와 목록 캐시를 손으로 맞춘다(`updateCachedChild`).
4. 화면 복귀(visibilitychange)·온라인 복귀 때 보호자 목록은 **갱신하지 않는다**(아이 기기 동기화만 돈다, `family.js` 1719~1733행).

### 2.3 테스트 계약

보호자 흐름이 참조하는 ID·문구는 `CLAUDE.md` ‘화면 구조와 ID’에 있다. 핵심: `#parentSetup #parentCodeStart #saveParentStart #familyMain #familyOverview #familyLoadStatus #refreshFamily #childrenList #newChildName #addChild #addChildStatus #childDetail #childDetailTitle #childDetailSummary #linkBox #childCodeText #childLinkText #copyLink #copyCode #regenCode #deviceList #renameChild #saveChildName #linkStatus #setsBox #childSets #sendNewSet #setsLock #setsStatus #planBox #planEnabled #planLevel #planLevelCustom #planCount #planHour #planTimeLimit #savePlan #makeDailyNow #planAnchor #planStatus #dailyPreview #missedTop #childQuestionCount #childQuestions #childRecords #closeChildDetail #deleteChild #parentCode #saveParent #clearParent #parentStatus #parentState #tabFamily #parentModeRow #parentModeOff #brandTagline`, 문구 “보호자 · 아이들 관리”, “오늘 시험 ✅ N회”, “이번 주 N회”, “N회”(칩), “오늘의 단어 ✅ N / N”, “저장했어요”, “준비됐어요”, “만들지 않아요”, “꺼져 있어요”, “세트 N개”, “N에게 보내기”, “보냈어요”, “잠갔어요”, “잠금을 풀었어요”, “📷 물어본 문제 N개”, “방금 확인했어요”, “아직 기록을 보낸 아이가 없어요”, “보호자 코드가 맞지 않아요”.

## 3. 문제점

### 3.1 구조

| # | 문제 | 근거 | 영향 |
|---|---|---|---|
| S1 | 보호자 앱이 아이 앱의 ‘모드’라 아이 앱 전체(quiz.js 1,114 + family.js 1,736 + sets.js 1,427행)를 싣고 시작하며, 모드 분기가 `quiz.js showView`, `sets.js openEditor/aiConfig`, `family.js applyParentMode`, CSS `.child-only`에 흩어져 있다 | 2.1 표 | 아이 앱 수정이 보호자 화면을 깨뜨릴 수 있고(그 역도), 보호자 전용 기능을 넣을 때마다 세 파일을 건드린다 |
| S2 | `family.js` 한 파일에 아이 기기 동기화(기록·세트·설정·복원·오늘의 단어)와 보호자 대시보드가 함께 있다 | `family.js` 224~790행 vs 947~1700행 | 읽기·수정 비용, 테스트 분리 불가 |
| S3 | 세트 편집기가 아이 세트 저장소와 결합되어 보호자는 `window.editorForChild` 전역 플래그로 우회한다 | `sets.js` 85~140, 376행; `family.js` 1471~1507행 | 편집기를 다른 페이지에서 쓸 수 없고, 저장 경로가 플래그에 의존 |
| S4 | 화면 상태가 라우팅되지 않는다. `showView`는 뷰 단위만 `history.pushState`하고 상세(`#childDetail`) 열림·편집기는 history에 없다 | `quiz.js` 125~150행, `family.js` 1243·1675행 | Android 뒤로 가기가 상세를 닫지 않고 앱을 벗어나거나 다른 뷰로 간다. 딥링크(알림 → 아이 상세) 불가 |
| S5 | 렌더링이 “전부 다시 그리기”와 “손으로 캐시 맞추기”의 혼합이다 | `renderChildren`, `updateCachedChild`, 각 저장 핸들러 | 저장 뒤 화면 일부만 갱신되거나 중복 요청이 난다(예: `returnToChild` → `openChild`가 상세를 다시 전부 받음) |
| S6 | 상태 문구 영역이 7개(`familyLoadStatus addChildStatus linkStatus setsStatus planStatus parentSetupStatus parentStatus`)로 흩어져 같은 일이 다른 자리에 표시된다 | 2.3 | 사용자가 결과를 못 찾는다 |
| S7 | 설치 페이지(`parent.html`)와 앱(`index.html?mode=parent`)이 다른 주소라 두 단계이고, `?mode=` 값을 localStorage에 기억하는 우회가 필요하다 | `family.js` 72~90행, `manifest-parent.webmanifest` | 설치 뒤 첫 실행 경로가 길고, 모드 꼬임(`parentModeOff`) 같은 예외 처리가 생긴다 |

### 3.2 사용 경험(UX)

| # | 문제 | 근거 |
|---|---|---|
| U1 | ‘오늘 한눈에’와 ‘아이 카드’가 같은 정보(오늘 횟수·평균, 이번 주, 마지막 시험, 경고)를 두 번 보여 준다 | `renderOverview`·`renderChildren` |
| U2 | 상세가 목록 아래에 인라인으로 열리고 여섯 상자가 모두 펼쳐져(연결·세트·계획·틀린 단어·질문·전체 기록) 한 화면이 매우 길다. 닫기는 맨 위 ‘← 목록으로’ 뿐 | `index.html` 441~486행 |
| U3 | 제한 시간·세트 잠금처럼 ‘오늘의 단어’와 무관한 설정이 ‘📬 오늘의 단어 설정’ 상자와 📚 세트 상자에 나뉘어 있다 | `#planBox`의 `#planTimeLimit`, `#setsBox`의 `#setsLock` |
| U4 | 자주 틀린 단어·물어본 문제·오늘의 단어 미리보기가 ‘보기’에서 끝난다. 틀린 단어로 복습 세트를 보내거나, 수준을 바꾸는 행동으로 이어지지 않는다 | `renderMissedTop`(칩만), `renderChildQuestions`(요약만) |
| U5 | 기록 목록이 전체 기간 평균 하나와 평면 목록이라 추세(이번 주 vs 지난주, 연속 학습일)를 알 수 없고 날짜 그룹·필터가 없다 | `renderChildRecords` |
| U6 | 세트 목록에 그 세트의 최근 점수·시험 횟수가 없어 어떤 세트를 더 시켜야 할지 알 수 없다 | `renderChildSets` |
| U7 | 화면 복귀 때 자동 갱신이 없고 ‘새로고침’ 버튼에 의존한다 | 2.2 (4) |
| U8 | 보호자 설정 탭에 아이용 AI 연결(서버 주소·접속 코드)과 가족 기록함 아이 부분이 그대로 보인다 | `index.html` 490~525행 |
| U9 | 연결 안 된 아이(기기 0대)와 연결된 아이의 카드 구성이 같아 ‘지금 할 일’(코드 보내기)이 눈에 띄지 않는다 | `renderChildren`의 `detail` 버튼 문구만 다름 |

### 3.3 데이터·성능

| # | 문제 | 근거 |
|---|---|---|
| D1 | 상세를 열 때마다 아이의 **전체 기록**을 받는다(상한 5,000개, 압축 기록 1개 ≈ 0.5~3KB → 수 MB 가능) | `FamilyStore.child()` |
| D2 | 상세 응답은 캐시하지 않아 오프라인에서는 요약만 보이고, 같은 상세를 다시 열면 다시 받는다 | `openChild` |
| D3 | 통계(오늘·7일·2주 틀린 단어)를 클라이언트가 매 렌더마다 전체 기록을 훑어 계산한다 | `describeChild`, `missedTop` |
| D4 | `GET /family`가 아이별 14일(또는 20개) 기록을 모두 담아 한 번에 온다. 아이가 늘거나 시험이 잦으면 커진다 | `FamilyStore.summary()` |

### 3.4 운영·테스트

| # | 문제 | 근거 |
|---|---|---|
| T1 | 보호자 흐름 테스트가 `family.cjs`(660행)·`daily.cjs` 안에 아이 기기 흐름과 섞여 있고, 가짜 Worker 라우트가 두 파일에 중복 | 2.1 |
| T2 | 버전 체크리스트(5곳)가 보호자 전용 파일이 생기면 더 늘어난다 | `CLAUDE.md` ‘버전·캐시 올리기’ |
| T3 | 보호자 코드는 localStorage 평문(현행 유지: 계정 체계가 없고 기기 1대 전제). 다만 ‘코드 삭제’ 뒤 캐시가 남지 않도록 보장해야 한다 | `clearParent` |

## 4. 개선 목표와 원칙

- **분리**: 보호자 앱은 자기 페이지·자기 스크립트·자기 저장 키를 가진다. 공통 코드는 명시적 인터페이스(`shared.js`, `editor.js`)로만 공유한다. 아이 앱에서 보호자 분기는 모두 제거한다.
- **한 흐름**: 상태 저장소 하나 → 라우트 하나 → 화면 렌더 함수 하나. 저장은 “요청 → 저장소 갱신 → 해당 화면 재렌더”로 통일하고, 상태 문구는 토스트 하나 + 인라인 오류로 통일한다.
- **캐시 우선**: 목록·상세·세트·질문을 모두 `fetchedAt`과 함께 저장해 먼저 그리고 뒤에서 갱신한다. 화면 복귀·온라인 복귀 때 자동 갱신(10분 간격).
- **필요한 만큼만**: 상세는 최근 30일 기록(최대 200개)을 받고 ‘더 보기’로 페이지를 넘긴다. 통계는 30일 창에서 계산한다.
- **행동 연결**: 틀린 단어 → 복습 세트 보내기, 오늘의 단어 미리보기 → 세트로 저장, 수준 제안 → 한 번에 적용.
- **계약 유지**: 테스트 ID와 상태 문구는 되도록 그대로 쓰고(2.3), 바뀌는 것은 `CLAUDE.md`와 테스트를 같은 PR에서 고친다. 버전 체크리스트는 늘어나는 파일을 포함해 문서화한다.

## 5. 목표 아키텍처

### 5.1 파일 구성

```
index.html            아이 앱 (보호자 모드 코드 제거: #family 뷰·#tabFamily·#parentBox·#parentModeRow·.child-only 제거)
quiz.js               아이 앱 (showView 보호자 분기 제거)
sets.js               아이 앱: 세트 저장소·동기화 훅·찾기·문제 물어보기·백업·설정. 편집기는 editor.js 를 부른다
family.js             아이 기기 동기화만 남김(기록·세트·설정·복원·오늘의 단어·아이 코드). 보호자 대시보드 삭제
shared.js   (신규)    두 앱 공통: DOM 도우미, 서식, 상수, 서버 요청 apiRequest, 오류 문구, 저장소 도우미
editor.js   (신규)    세트 편집기 모듈(사진 인식·AI 사전 채우기·표/텍스트 편집·검증). sets.js 에서 추출
parent.html (개편)    보호자 앱 페이지(설치 안내는 첫 화면 안에). manifest-parent 의 start_url 이 여기를 가리킴
parent.js   (신규)    보호자 앱: 저장소(store)·라우터·화면·액션
parent.css  (신규)    보호자 앱 전용 스타일(공통 토큰은 shared.css 로 뺄지 B단계에서 결정; 기본은 parent.css 하나)
sw.js                 SHELL 에 parent.html·shared.js·editor.js·parent.js·parent.css 추가, 내비게이션 폴백을 요청 경로에 맞게(parent.html ↔ index.html)
worker/worker.js      C단계: 기록 페이지 읽기, 30일 창, (선택) 통계
tests/lib/fake-family-worker.cjs (신규)  가족 Worker 가짜 라우트 공용 모듈
tests/parent.cjs      (신규) 보호자 앱 E2E
tests/parent-sets.cjs (신규) 보호자 세트 보내기·편집기 재사용
tests/family.cjs      아이 기기 흐름만 남김
```

로드 순서(아이 앱): `shared.js → quiz.js → family.js → editor.js → sets.js`. 보호자 앱: `shared.js → editor.js → parent.js`. 모두 전역 스크립트(빌드 없음, ES 모듈은 `?v=` 캐시 무효화가 import 경로마다 필요해 쓰지 않는다). 각 파일은 전역 네임스페이스 하나만 노출한다: `window.Shared`, `window.SetEditor`, `window.ParentApp`(디버깅용).

### 5.2 `shared.js` — 공통 모듈

```js
window.Shared = {
  // DOM
  $, h(tag, attrs, ...children),        // h 는 createElement 축약: 속성·클래스·텍스트·자식. innerHTML 은 쓰지 않는다
  setFeedback(el, kind, text),          // 기존 setFeedback 이동
  // 서식·날짜 (family.js 에서 이동)
  tidy, formatCode, hourLabel, relativeTime, durationText, dayKey, pctOf, WEEKDAYS, modeLabels,
  // 상수
  AI_SERVER_DEFAULT, normalizeServer, WORD_PATTERN, PLAN_LEVELS, TIME_LIMIT_CHOICES, planDefaults(plan),
  // 서버 요청
  apiRequest(server, path, { method, body, passcode, timeout }),  // 기존 familyRequest 를 서버 인자로 일반화. 오류는 ApiError{status, code, message}
  describeApiError(e),                  // 401 → "보호자 코드가 맞지 않아요", 404 not_found → "Worker를 다시 배포해 주세요", unknown_child, 네트워크 등 한국어 문구 한 곳
  // 저장소
  readJson(key, validate), writeJson(key, value),  // try/catch 포함, 검증 실패 시 null
};
```

- `familyRequest`는 B단계까지 family.js에 남기되 내부에서 `Shared.apiRequest`를 부른다(아이 기기 테스트 변경 없음).
- `Shared`는 상태를 갖지 않는다(순수 함수와 상수만).

### 5.3 `editor.js` — 세트 편집기 모듈

편집기 DOM(`#editor` 섹션의 지금 마크업과 같은 ID)을 **모듈이 직접 만든다**. 두 HTML 파일에 마크업을 복제하지 않는다.

```js
window.SetEditor = {
  mount(host, {
    ai,                     // { recognize(imageBase64, mediaType, signal) → {words, note}, define(words, signal) → {words, note} } | null
    onSave(set) → Promise,  // 검증을 통과한 {id, name, words, updatedAt}. 호출자가 저장(아이 앱) 또는 전송(보호자 앱)
    onClose(),              // 닫기(미저장 확인 뒤) 후 어디로 갈지 호출자가 정함
    onRename(set, name)?,   // 있으면 ‘이 세트 관리’ 상자(이름 바꾸기·삭제)를 보인다(아이 앱만)
    onDelete(set)?,
  }),
  open(set | null, { readOnly = false, title, targetName })  // targetName 이 있으면 제목에 ‘→ 🧒 N에게 보내기’
  close(), isOpen(), isDirty(), confirmDiscard(),
  setStatus(text), setWarning(text), lockSave(on),           // 전송 중 표시 등
};
```

- 내부 상태(`editingId, selectedFiles, aiFilled, draftDirty, draftTextMode, editorReadOnly`)와 표/텍스트 동기화, `parseDraft`/`appendDraftRows`/`tableToDraft`, 사진 선택·썸네일·`preparePhoto`·순차 인식·취소(`startOperation`)·빈 뜻 채우기(`fillMeanings`)·검증·`.ai-filled` 표시가 모두 모듈 안으로 간다.
- `parseDraft`·`WORD_PATTERN`은 `Shared`에 두어 백업 검증(sets.js)도 쓴다.
- 아이 앱(sets.js)은 `SetEditor.mount($("editorHost"), { ai: aiBridge(), onSave: saveSetLocally, onClose: () => showView("home"), onRename, onDelete })`. `saveSetLocally`가 지금 `saveSet`의 저장 부분(이름 바뀐 기록 반영, `persistSets`, `selectSet`, `queueSetsSync`)을 한다. 잠금(`childSetsLocked`)은 `open(set, {readOnly})`로 전달한다.
- 보호자 앱은 `onSave: (set) => api.sendSet(childId, set)`, `onClose: () => router.back()`.
- 테스트 계약: `#editorTitle #setName #photos #camera #pickPhotos #takePhoto #extractWords #cancelExtract #extractStatus #fillMeanings #wordTableBody #addRow #toggleDraftText #wordDraft #wordCount #confirmed #confirmedRow #saveSet #closeEditor #manageBox #renameSet #deleteSet #renameBox #manageStatus #photoRow #photoHelp #draftWarnings #photoPreview`, 문구 “사진을 선택했습니다”, “가져오지 못했습니다”, “취소”, “AI 사전으로 채웠어요”, “노란 칸”, “못 찾은 단어”, “먼저 영어 단어”, “다시 배포”, “N에게 보내기” 유지.

### 5.4 `parent.js` — 보호자 앱 구조

```
parent.js
├─ storage   PARENT_KEY = "daily_vocab_parent_v1"
│            { parentCode, server, children:[요약…], details:{ [childId]: {child, records, questions, today, sets, fetchedAt} },
│              fetchedAt, prefs:{ childTab, recordsFilter }, pushSubscription?(2B) }
│            migrate(): daily_vocab_family_v1.parentCode, daily_vocab_ai_v2.server, daily_vocab_family_cache_v1 → 1회 이전 뒤 옛 캐시 삭제
├─ store     createStore(initial) → { get(), patch(partial), subscribe(fn) }  (patch 마다 writeJson + 구독자 호출)
├─ api       Shared.apiRequest(server, path, {passcode: parentCode}) 를 감싼 함수들:
│            listChildren(), childDetail(id, {since}), childRecords(id, {before, limit}), childSets(id), getSet(id, setId),
│            sendSet(id, set), deleteSet(id, setId), savePlan(id, patch), createChild(name), renameChild(id, name),
│            regenCode(id), deleteChild(id), makeDaily(id), verifyCode(code)
├─ router    해시 라우트. parse(location.hash) → {name, params}; go(path), back(), replace(path)
│            "#/"                     오늘(대시보드)      "#/children"             아이들·아이 추가
│            "#/child/:id"            아이(기본 탭 기록)  "#/child/:id/:tab"        tab = records|sets|daily|settings|questions
│            "#/child/:id/sets/new"   편집기(새 세트)     "#/child/:id/sets/:setId" 편집기(수정)
│            "#/settings"             보호자 설정         "#/setup"                 코드 입력(코드 없으면 어떤 경로든 여기로)
├─ views     render(route): 모든 뷰 섹션 중 하나만 .active. 각 뷰는 store 스냅샷으로 자기 DOM 을 다시 그린다(목록은 DOM 생성, 폼은 값 채우기)
│            viewSetup, viewToday, viewChildren, viewChild(tab), viewEditor(SetEditor), viewSettings
├─ components childCard(child, stats), statRow, weekStrip(days), recordItem(r), setRow(s, stats), questionRow(q), planForm, deviceList, toast
├─ stats     computeStats(records, {days:30}) → { today, week, prevWeek, streak, days[30], bySet, missedTop(14) }  순수 함수(테스트 가능)
└─ actions   refreshAll({force}), openChild(id), loadDetail(id, {force}), loadMoreRecords(id), savePlan, toggleLock, sendSet, deleteSet,
             createChild, renameChild, regenCode, deleteChild, makeDaily, sendMissedAsSet(id, words), applyLevelSuggestion(id)
             → 각 액션은 api 호출 → store.patch → (필요하면) router.go. 결과 문구는 toast(text, kind)
```

- **상태 갱신 규칙**: 서버 응답에 `child`가 오면 `children[]`의 그 항목과 `details[id].child`를 함께 갱신하는 `putChild(child)` 하나만 쓴다(지금의 `updateCachedChild`+`familyDetail.child` 이중 관리 제거).
- **자동 갱신**: 앱 시작, `visibilitychange`(보임), `online`, 라우트 진입 때 `fetchedAt`이 10분 지났으면 뒤에서 갱신. 수동 새로고침은 당겨서 새로고침 대신 상단 버튼 유지(`#refreshFamily`).
- **오류 처리**: 401이면 `#/setup`으로 보내고 코드가 틀렸다고 안내(코드는 지우지 않음). 404 `not_found`면 ‘Worker를 다시 배포’ 안내. 네트워크 오류는 캐시를 그대로 두고 토스트 1회.
- **뒤로 가기**: 해시 변경이 곧 history 항목이므로 Android 뒤로 가기가 상세 → 목록 → 앱 종료 순으로 동작한다. 편집기에서 뒤로 가기는 `SetEditor.confirmDiscard()`를 거친다.

### 5.5 화면 설계 (IA)

하단 탭 3개: **🏠 오늘 · 🧒 아이들 · ⚙️ 설정**. 상단 바: 앱 이름 ‘매일 영단어 보호자’ + 새로고침 + 마지막 확인 시각.

**(1) 오늘 `#/`** — 아이마다 카드 1장(기존 ‘한눈에’와 ‘카드’를 합침)
- 머리: 🧒 이름 · 오늘 상태 배지(`오늘 ✅ N회 · 평균 N점` / `오늘 아직`) · 연속 학습 `🔥 N일`
- 한 줄: 오늘의 단어 상태(✅ 9/10 · 📬 아직 · 꺼짐), ⚠️ 화면 이탈 N회, ⏱ 시간 초과 N개, 📷 물어본 문제 N개(오늘)
- 7일 띠(`weekStrip`: 요일·평균 점수, 오늘 강조) + ‘이번 주 N회 · 평균 N점 (지난주 N점)’ 추세 화살표
- 연결 안 된 아이(기기 0대): 카드 본문 대신 ‘📲 아이 기기를 연결해 주세요 — 코드 483 921 · 링크 복사’ 행동 1개
- 카드 탭 → `#/child/:id`. 아이가 0명이면 ‘아이 추가’ 안내 카드 → `#/children`
- 문구 계약 유지: “오늘 시험 ✅ N회”, “이번 주 N회”, “오늘의 단어 ✅ N / N”, “⚠️ 오늘 화면 이탈 N회”, “⏱ 시간 초과 N개”, “📷 물어본 문제 N개”, “아직 기록을 보낸 아이가 없어요”, “방금 확인했어요”

**(2) 아이들 `#/children`** — 아이 목록(이름·연결 기기·코드) + ➕ 아이 추가(`#newChildName #addChild #addChildStatus`). 추가하면 `#/child/:id/settings`로 가서 코드·링크를 바로 보여 준다(“아이 코드 N N”, 링크 복사).

**(3) 아이 `#/child/:id/:tab`** — 머리(이름, ← 뒤로) + 하위 탭 5개(세그먼트)
- **기록 `records`**(기본): 요약 띠(이번 주 N회·평균, 지난주, 30일 평균, 연속), 📉 자주 틀린 단어(최근 2주 상위 10, 칩 `N회`) + **‘이 단어들로 복습 세트 보내기’** 버튼(선택한 칩 → `sendMissedAsSet` → 세트 이름 ‘복습 M/D’ · 뜻은 기록의 `ko`), 필터(세트·기간 7/30/전체), 날짜별 그룹 기록 목록(`#childRecords`: 점수·방식·범위·소요·중단·📬·⏱·🤖·⚠️·틀린 단어 펼치기), ‘더 보기’(C단계 페이지)
- **세트 `sets`**: 세트 행(이름 · N단어 · 최근 점수/시험 N회 · 마지막 수정) + 보기·수정/삭제, ➕ 세트 만들어 보내기(사진) → `#/child/:id/sets/new`, 🔒 잠금 토글(`#setsLock`, 즉시 저장, “잠갔어요”/“잠금을 풀었어요”)
- **오늘의 단어 `daily`**: 켜기·수준·개수·시각·저장(`#planEnabled #planLevel #planLevelCustom #planCount #planHour #savePlan`), 오늘 것 지금 만들기, 수준 기준 세트(`#planAnchor`), 미리보기(`#dailyPreview`, 복습 태그) + **‘세트로 저장해 보내기’**, C단계: 수준 제안 카드(“최근 2주 평균 92점 → ‘중3·고1’로 올려 볼까요?” 한 번에 적용)
- **설정 `settings`**: 🔗 연결(코드 `#childCodeText`, 링크 `#childLinkText`, 복사 2개, 코드 새로 만들기, 기기 목록 `#deviceList`), 이름(`#renameChild #saveChildName`), ⏱ 문제당 제한 시간(`#planTimeLimit`, 즉시 저장), 🗑 이 아이 서버에서 삭제(`#deleteChild`, 확인 2단계: 이름 입력)
- **질문 `questions`**: 📷 물어본 문제 목록(`#childQuestions`, 종류·질문·요약·시각), 상단에 ‘이번 주 N개’ 요약

**(4) 설정 `#/settings`** — 보호자 코드 상태(`#parentState` 연결됨 · 서버 주소 접힘, 고급) · 코드 바꾸기 · 코드 삭제(`#clearParent`, 캐시도 삭제), 🔔 알림(2B 자리: ‘준비 중’ 또는 구독 토글), 앱 정보(버전 `#appStatus`, 새 버전 불러오기 `#refreshApp`, 앱 점검 `#checkApp`), 아이용 앱 열기 링크(`./`)와 설치 안내(iOS 공유 → 홈 화면에 추가)

**(5) 코드 입력 `#/setup`** — 첫 화면(`#parentSetup #parentCodeStart #saveParentStart #parentSetupStatus`): 코드 저장 → `verifyCode`(`GET /family`) → 성공 시 `#/`. 설치 안내 접힘 포함(지금 parent.html 안내 흡수).

- **토스트**: `#toast`(role=status) 하나. 저장·전송·오류 결과 3초. 폼 검증 오류는 폼 아래 인라인(`#planStatus #linkStatus #setsStatus #addChildStatus`는 호환을 위해 유지하되 토스트와 같은 문구를 쓴다).
- **반응형**: 폰 세로 기준. 760px 이상에서는 오늘 카드 2열. 편집기 표는 기존 가로 스크롤.

### 5.6 데이터·저장소·캐시

- 보호자 앱 저장 키는 **`daily_vocab_parent_v1`** 하나(5.4). 아이 앱 키(`daily_vocab_family_v1` 등)는 건드리지 않는다(같은 origin 의 Android Chrome 에서 아이 앱과 공존 가능).
- 이전(migrate, B단계 1회): `daily_vocab_family_v1.parentCode` → `parentCode`, `daily_vocab_ai_v2.server` → `server`(없으면 `AI_SERVER_DEFAULT`), `daily_vocab_family_cache_v1.children` → `children`. 이전 뒤 `daily_vocab_family_cache_v1`·`daily_vocab_mode_v1` 삭제, `daily_vocab_family_v1.parentCode`·`parentModeOff`는 제거(아이 앱이 그 필드를 더 읽지 않음).
- `details[id]`는 최근 30일 기록(최대 200)·질문 100·오늘·세트 요약과 `fetchedAt`. ‘더 보기’로 받은 옛 기록은 `details[id].olderRecords`에 세션 동안만 둔다(저장 안 함, 용량 제한).
- 저장 용량: `children`+`details`가 1MB를 넘으면 가장 오래 본 아이의 `details`부터 지운다(`writeJson` 실패 시도 같은 처리).
- 통계는 저장하지 않고 렌더 때 `computeStats`로 계산한다(30일·최대 200개라 가볍다).

### 5.7 Worker API 변경 (C단계)

| 변경 | 내용 | 호환 |
|---|---|---|
| `GET /family/<id>?days=30&limit=200` | 상세의 `records`를 최근 `days`일(기본 30) 최신순 최대 `limit`(기본 200, 상한 500)로 제한하고 `recordCount`(전체 수)·`more`를 추가. 질문·오늘·세트 요약은 그대로 | 인자 없으면 기본값. 옛 보호자 앱(캐시)은 30일만 보게 되지만 다음 로드에서 새 앱으로 바뀜 |
| `GET /family/<id>/records?before=<ISO>&limit=100` | 보호자 코드. `before` 이전(미포함) 최신순 페이지 `{records, more}` | 신규 |
| `GET /family?days=7` | 목록의 기록 창을 줄일 수 있게(기본 14 유지) | 선택 |
| (선택) `GET /family/<id>/stats?days=30` | 서버 집계 `{days:[{date,count,avg}], streak, missedTop, bySet}` | 클라이언트 계산으로 충분하면 생략 |
| 푸시(2B 자리) | `POST /family/push`(구독 저장)·크론 알림은 2B 설계에서. 이번 개편은 설정 화면 자리와 `pushSubscription` 키만 둔다 | — |

- 규칙 유지: 보호자 코드만 통하는 경로(`roleOf`), 요청 제한 버킷, `parseSync` 검증, 아이당 5,000개 상한, `unknown_child`/`not_found` 구분.
- 테스트: `tests/worker.cjs`에 `days/limit/before` 검증(범위 밖 400, `more` 계산, 보호자 코드 필수).

### 5.8 아이 앱에서 빠지는 것과 호환

B단계에서 아이 앱(`index.html`·`quiz.js`·`family.js`·`sets.js`)에서 제거: `#family` 뷰 마크업, `#tabFamily`, `#parentBox`·`#parentModeRow`·`#parentModeOff`, `.child-only` 클래스와 CSS, `isParentMode`/`applyParentMode`/`modeFromUrl`/`appMode`, `showView`의 보호자 분기, `window.editorForChild`·`sendSetToChild`·`returnToChild`, `aiConfig`의 보호자 코드 대체, `family.js` 947~1700행 전부, 보호자용 CSS. `brandTagline`은 아이 문구 고정.

호환(반드시):
- `index.html`이 `?mode=parent`로 열리거나 `daily_vocab_mode_v1 === "parent"`이면 부트스트랩 스크립트가 **`./parent.html`로 `location.replace`** 한다(옛 보호자 설치의 `start_url`이 `?mode=parent`이므로). 같은 scope 안이라 iOS 홈 화면 앱의 standalone 상태가 유지된다. `?mode=child`는 `daily_vocab_mode_v1`을 지우고 아이 앱을 연다(1회 호환).
- `manifest-parent.webmanifest`의 `start_url`을 `/daily-vocab/parent.html`로 바꾼다. 기존 설치는 위 리다이렉트로 동작하고, 새 설치는 바로 parent.html.
- 아이 기기에 보호자 코드가 저장돼 있던 비정상 상태(`daily_vocab_family_v1.parentCode`)는 아이 앱이 무시하고 지운다.
- 보호자 폰에서 ‘아이 기기처럼 보기’(`parentModeOff`)는 없어진다. 대신 설정의 ‘아이용 앱 열기’ 링크(`./`)로 아이 앱을 연다.
- 갤럭시 래퍼 앱(`android/`)은 `index.html` 주소만 알고 보호자는 쓰지 않으므로 영향 없음.

### 5.9 서비스워커·버전·배포

- `sw.js` SHELL: `./parent.html`, `./shared.js?v=…`, `./editor.js?v=…`, `./parent.js?v=…`, `./parent.css?v=…` 추가. 내비게이션 폴백: 요청 URL 경로가 `parent.html`로 끝나면 `./parent.html`, 아니면 `./index.html`.
- 버전 체크리스트(`CLAUDE.md`) 갱신: (1) `index.html` `#appStatus` (2) `index.html` `release` (3) `index.html` 스크립트 `?v=` **5개**(shared·quiz·family·editor·sets) (4) `parent.html` 스크립트·스타일 `?v=` **4개**(shared·editor·parent·parent.css) + `release` (5) `sw.js` CACHE·SHELL (6) `tests/app-update.cjs`. 확인 grep에 `parent.html` 추가.
- 배포 순서: C단계는 Worker 먼저(`cd worker && npm run deploy`) → 앱. A·B단계는 Worker 변경 없음.

### 5.10 테스트 설계

- `tests/lib/fake-family-worker.cjs`: 지금 `family.cjs`·`daily.cjs`에 복제된 가짜 Worker 라우트(`/join /settings /records /sync /daily /sets /family… /plan /children /code /name /question`)를 한 모듈로. `createFakeWorker(page, { server, familyCode, parentCode, children })` → `{ requests, children, paths(), seedChild(), seedRecords(), setMode() }`. 두 기존 테스트가 이 모듈을 쓰도록 바꾼다(동작 동일).
- `tests/parent.cjs`(신규, B): parent.html 직접 열기 → 코드 입력 화면 → 틀린 코드 401 문구 → 저장 → 오늘 카드(2명: 연결된 아이·연결 안 된 아이) → 뒤로 가기(해시) → 아이 상세 탭 5개(기록 요약·틀린 단어·필터·세트 목록·오늘의 단어 폼 저장 본문·제한 시간 즉시 저장·잠금·연결 코드·이름·삭제 2단계) → 아이 추가 → 설정(코드 삭제 → 캐시 삭제·`#/setup`) → 옛 설치 호환(`index.html?mode=parent` → parent.html 리다이렉트, `daily_vocab_family_v1.parentCode` 이전) → 오프라인 캐시(라우트 차단 뒤 새로고침해도 카드 보임).
- `tests/parent-sets.cjs`(신규, B): 세트 만들어 보내기(편집기 모듈 제목 ‘N에게 보내기’, 텍스트 모드, 전송 본문, 목록 갱신, 기기 사본 없음) → 보기·수정 → 삭제 → 틀린 단어로 복습 세트 보내기(C) → 오늘의 단어 미리보기 세트로 저장(C).
- `tests/family.cjs`: 보호자 부분(현재 439~600행)을 삭제하고 아이 기기 흐름만 남긴다. `daily.cjs`의 보호자 계획 폼 부분은 `parent.cjs`로 옮기고, 아이 기기 쪽(카드·풀기·제한 시간 수신)은 남긴다(보호자 코드 대신 가짜 Worker에 plan을 직접 심는다).
- 아이 앱 테스트(`browser session ai-recognition ten-photos pwa app-update`)는 편집기 추출(A) 뒤에도 그대로 PASS 여야 한다(ID·문구 계약).
- `node .claude/run-tests.cjs`가 새 파일을 포함하도록 목록 갱신(실행기는 `tests/*.cjs`를 읽는지 확인하고, 아니면 추가).

### 5.11 2B 알림 · 2C 수준 조절 연결 지점

- **2B(알림)**: 설정 화면 🔔 섹션과 `prefs.pushSubscription` 자리. Worker 쪽은 `POST /family/push`로 Web Push 구독 저장, 크론에서 ‘오늘 시험 안 함’·‘오늘의 단어 완료’ 알림. 딥링크는 `#/child/:id` 해시 라우트로 바로 연결된다(이번 개편에서 라우터가 마련됨).
- **2C(수준 자동 조절)**: `computeStats`의 `week.avg`·`prevWeek.avg`·`missedTop`을 재료로 보호자 앱이 **제안**만 한다(“최근 2주 평균 92점·틀린 단어 3개 → 수준을 한 단계 올려 볼까요?” → `savePlan({level})`). 자동 변경은 하지 않는다(보호자 결정 원칙). 제안 규칙은 `parent.js stats`에 순수 함수로 두어 테스트한다.

## 6. 단계별 구현 계획

각 단계는 PR 하나. `main`에서 `feat/parent-...` 브랜치. 머지와 Worker 배포는 사용자가 요청할 때만. 단계 안에서도 테스트 9개(+신규)가 PASS 인 상태로만 커밋한다.

### A. 공통 모듈 분리 (동작 변화 없음) — `feat/parent-shared`
1. `shared.js` 신설: 5.2의 함수·상수를 `quiz.js`/`family.js`/`sets.js`에서 옮기고 호출부를 `Shared.*` 또는 전역 별칭(`const { $, h, … } = Shared;` 파일 머리)로 바꾼다. 기존 전역 함수명은 유지해도 된다(별칭).
2. `editor.js` 신설: 5.3 인터페이스로 `sets.js`의 편집기(표·텍스트·사진·AI 채우기·검증·관리 상자)를 옮긴다. `#editor` 섹션 마크업은 `index.html`에서 빼고 `SetEditor.mount($("editorHost"))`가 만든다(`<section class="view" id="editor">` 껍데기는 남겨 `showView`의 `VIEWS`와 호환).
3. `sets.js`는 `SetEditor.mount(...)` 호출 + 로컬 저장(`saveSetLocally`)·이름 바꾸기·삭제 콜백만 남긴다. 보호자 분기(`editorForChild`)는 이 단계에서는 콜백으로 감싸 그대로 동작하게 둔다(B에서 제거).
4. `tests/lib/fake-family-worker.cjs` 신설 + `family.cjs`·`daily.cjs`가 쓰도록 변경.
5. 버전 올리기(`index.html` 스크립트 5개, `sw.js` SHELL에 shared·editor 추가, `app-update.cjs`), `CLAUDE.md` 파일 구조·체크리스트, `DESIGN.md` 23절(이 문서 링크).
- **완료 기준**: 9개 테스트 PASS(ID·문구 변경 없음), `index.html`에 편집기 마크업 없음, `sets.js` 편집기 코드 0행, `grep -n "familyRequest(" family.js`가 `Shared.apiRequest`를 감싼 한 곳.

### B. 보호자 앱 새로 쓰기 — `feat/parent-app`
1. `parent.html`(앱 페이지: 상단 바, 뷰 섹션 6개 껍데기, 하단 탭 3개, 토스트, `#editorHost`, 부트스트랩 스크립트(버전·오류 배너·새 버전 불러오기)), `parent.css`, `parent.js`(5.4) 작성. 화면은 5.5.
2. 이전(migrate)과 옛 설치 호환(5.8): `index.html` 부트스트랩의 `?mode=parent` 리다이렉트, 매니페스트 `start_url`.
3. 아이 앱에서 보호자 모드 제거(5.8 목록). `family.js`는 아이 기기 동기화만 남긴다.
4. `sw.js` SHELL·폴백, 버전 체크리스트 확장(5.9).
5. 테스트: `tests/parent.cjs`, `tests/parent-sets.cjs` 신설, `family.cjs`·`daily.cjs`에서 보호자 부분 이동, `pwa.cjs`에 parent.html 반응형·오프라인 셸 추가.
6. 문서: README ‘보호자 폰에서 아이들 기록 보기’·‘오늘의 단어’·‘백업·설치’ 절을 새 화면 기준으로 다시 쓰기, `CLAUDE.md` 화면 구조·ID·문구·파일 구조·테스트 표·버전 체크리스트, `DESIGN.md` 23절 갱신, 메모리.
- **완료 기준**: 새 테스트 2개 + 기존 9개 PASS. `parent.html`을 열면 코드 입력 → 오늘 카드까지 네트워크 1회(`GET /family`). `index.html`에 `parent-mode`·`child-only`·`editorForChild` 문자열이 없다. 폰 폭(390px)에서 가로 스크롤 없음.

### C. Worker 보강과 보호자 기능 — `feat/parent-insights`
1. Worker: `GET /family/<id>?days&limit`(+`recordCount`·`more`), `GET /family/<id>/records?before&limit`, 테스트.
2. 보호자 앱: 기록 ‘더 보기’, 30일 창 통계(이번 주·지난주·연속 학습일·세트별 최근 점수), 틀린 단어로 복습 세트 보내기, 오늘의 단어 미리보기 세트로 저장, 수준 제안 카드(제안만).
3. 문서·테스트(`worker.cjs`, `parent.cjs`, `parent-sets.cjs`) 갱신, Worker 재배포 안내.
- **완료 기준**: 기록 5,000개 아이의 상세 첫 응답이 200개 이하. 복습 세트가 아이 기기에 ‘복습 M/D’ 이름으로 들어온다(가짜 Worker 검증).

## 7. 리스크와 대응

| 리스크 | 대응 |
|---|---|
| 편집기 추출(A)이 아이 앱 테스트(ai-recognition·ten-photos·session·browser)를 깨뜨림 | ID·문구 계약을 바꾸지 않고 DOM을 모듈이 같은 구조로 생성. 단계 A를 작은 커밋으로 나누고 매 커밋 테스트. `#toggleDraftText` 뒤 `#wordDraft` 채우기 패턴 유지 |
| 옛 보호자 설치(iOS)가 `?mode=parent`로 열려 빈 화면 | `index.html` 부트스트랩의 최상단에서 동기 리다이렉트(스크립트 로드 전). 테스트 `parent.cjs`에 시나리오 포함 |
| 같은 origin(Android Chrome)에서 아이 앱과 보호자 앱이 저장소를 공유 | 키 분리(`daily_vocab_parent_v1`)와 아이 키 불변. 이전은 보호자 키가 비어 있을 때 1회 |
| 상세 30일 제한으로 옛 기록을 못 봄 | ‘더 보기’ 페이지(C). 전체 삭제·복원 기능은 아이 앱 쪽이라 영향 없음 |
| 버전 체크리스트 누락 | `CLAUDE.md` 체크리스트 확장 + grep 확인 명령에 parent.html 추가. `app-update.cjs`가 parent.html 버전도 검사 |
| 단계 B 규모가 큼(parent.js 약 1,200행 예상) | 화면별 커밋(setup → today → child/records → sets → daily → settings → questions) + 각 커밋에서 `tests/parent.cjs` 해당 블록 추가 |

## 8. 구현 세션 지시서 (Opus 5.5)

각 단계 세션은 이 문서의 해당 절(6.A/B/C)과 5절 설계를 따른다. 공통 지시:
1. 시작 전 `CLAUDE.md`·이 문서·`docs/DESIGN.md` 10~22절을 읽고, 관련 테스트(`node .claude/run-tests.cjs`, 포트가 잡혀 있으면 `PORT=8011 APP_URL=http://127.0.0.1:8011/daily-vocab/`)를 먼저 돌려 기준을 확인한다.
2. 설계와 다르게 해야 할 이유가 생기면 이 문서의 해당 절에 ‘결정 변경(날짜)’을 적고 PR 본문에도 쓴다. 테스트 ID·문구 계약을 바꾸면 같은 PR에서 `CLAUDE.md`와 테스트를 고친다.
3. 사용자 화면 문구는 쉬운 한국어, 선택지는 최소. 외부 CDN·추적 없음. 비밀값·개인정보 커밋 금지. 커밋 제목 영어 명령형, 본문 한국어. 앱 셸을 바꾸면 버전 체크리스트 전부.
4. 완료 보고에는 바뀐 파일, 새 테스트, PASS 결과, 사용자가 실기기에서 확인할 것, Worker 재배포 필요 여부를 적는다. PR 머지·Worker 배포는 사용자 요청 때만.
