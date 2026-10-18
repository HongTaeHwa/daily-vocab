# daily-vocab 전면 개편 설계서 (2026-10-12)

사용자: 초등~중학 학생(시험 보는 사람)과 보호자(세트 만들기·설정). 기기: Android 태블릿 Chrome, 가끔 휴대폰.
목표: 아이가 설명 없이 "세트 고르고 → 시작 → 풀고 → 결과 보기"를 할 수 있고, 보호자는 사진으로 세트를 쉽게 만들고 관리할 수 있는 앱. API/AI 서버 설정은 이번 범위에서 손대지 않는다.

## 1. 현재 앱 전수 검사 결과

### 1.1 첫 화면 (정보 구조)
- 한 페이지에 9개 패널이 세로로 나열: 상태 배너 → 세트 → 보호자 설정 → 마이크 점검(매우 김) → 시험 방식/범위 → 시험 → 결과 → 기록 → 안내/푸터. 아이가 해야 할 "시작" 버튼이 화면 2~3장 아래에 있다.
- 맨 위에 버전·앱 점검·새 버전 불러오기 같은 기술 정보가 노출된다.
- 마이크 점검 패널이 항상 펼쳐져 있고 안내문이 길다(태블릿에서 화면 절반).
- 백업 JSON/가져오기 버튼이 세트 선택 바로 옆에 있어 아이가 누르기 쉽다.
- 세트 선택 `<select>`에 이름·단어 수만 있고 최근 점수·오답 수가 없다.

### 1.2 세트 관리
- 세트 이름 바꾸기 기능 없음(수정하려면 편집기에서 전체 단어와 함께 저장해야 함).
- 편집기가 탭으로 구분된 텍스트 영역이라 태블릿에서 수정이 어렵다(탭 입력 불가, 줄 밀림).
- 사진 여러 장 미리보기가 세로로 무한히 길어진다.
- 새 세트 이름 기본값이 날짜(2026-10-12)뿐이라 어떤 교재인지 알기 어렵다.
- 마지막 세트는 삭제 불가(기본 예제가 영구히 남음).

### 1.3 시험 진행
- 중간에 멈출 방법이 "설정으로"뿐이고, 누르면 진행 내용이 모두 사라진다. 탭을 닫거나 화면이 꺼져도 진행이 사라진다.
- 일시정지·이어서 하기 없음. 중단 기록 없음.
- 안내 문장이 많고 길다(각 단계마다 2~3문장 + 키보드 마이크 힌트 + S펜 설명).
- 범위 선택이 "1~10번째 단어"처럼 순서 기준이라 책 번호(161~170)와 다르다.
- 마지막 선택(방식·범위·섞기)을 기억하지 않는다.
- 결과 화면에 틀린 단어 목록이 없고 점수만 있다.

### 1.4 기록
- 세트별 필터가 선택 세트에 묶여 있어 다른 세트 기록을 보려면 세트를 바꿔야 한다.
- 전체 요약(누적 문제 수, 최근 점수 추세)이 없다.

### 1.5 코드 구조
- 핵심 엔진(시험·채점·음성·기록, 약 150줄 한 줄 코드)이 index.html 안에 인라인으로 들어 있어 수정·검토가 어렵다.
- 화면 전환이 `style.display` 토글로 흩어져 있어 상태를 추적하기 어렵다.
- 저장 데이터 검증·보호 로직은 양호(유지).

## 2. UX 원칙
1. **아이 화면에는 한 번에 한 가지 일만.** 홈(세트 고르기·시작) / 시험 / 결과 / 기록 / 설정을 화면 단위로 분리하고 하단 탭으로 오간다.
2. **큰 글씨, 큰 버튼, 짧은 문장.** 주요 버튼은 높이 52px 이상, 본문 16px, 단계 안내는 한 문장.
3. **언제든 멈추고 이어서.** 시험 상태를 저장해 탭이 닫혀도 "이어서 하기"가 가능. 그만두면 중단 기록을 남긴다.
4. **보호자 기능은 보이되 눌리지 않게.** 백업·가져오기·AI 설정·마이크 점검·앱 정보는 설정 화면으로 모은다.
5. **기존 데이터·저장 키·테스트 ID는 유지.** 사용자 기록 호환과 회귀 방지.

## 3. 화면 구조 (단일 HTML, 뷰 전환)

```
[상단] 매일 영단어                      ⚙(설정 화면으로)
[뷰]   #viewHome | #viewQuiz | #viewResult | #viewSets(편집기) | #viewHistory | #viewSettings
[하단 탭] 🏠 홈 · 📚 기록 · ⚙ 설정   (시험 중에는 숨김)
```

### 3.1 홈 `#viewHome`
- "이어서 하기" 카드(저장된 시험이 있을 때만): 세트·방식·진행(7/20) + [이어서 하기] [그만두기].
- 세트 카드: `#setSelect`(세트 선택) + 최근 점수·오답 수 요약 + [✏ 이름 바꾸기] [단어 보기·수정] [➕ 새 세트].
- 시험 설정: 방식 3타일(`[data-mode]`), 범위 `#range`(책 번호 기준 라벨: "161~170번"), `#shuffle`, 큰 [시작!] `#start`, [틀린 단어 다시 풀기] `#review` + `#reviewCount`.
- 최근 결과 3개(점수·날짜) + "기록 전체 보기".

### 3.2 시험 `#viewQuiz` (기존 `#quiz`)
- 상단 바: 문제 n/N, 정답·오답, [⏸ 쉬기] `#pauseQuiz`, [그만하기] `#backSettings`.
- 단어 카드(기존), 1단계·2단계(기존 ID 유지), 힌트는 "도움말" 토글 안으로.
- 하단: [모름·정답 보기] `#unknown`, [다음] `#next`.
- 쉬기: 상태 저장 → 홈으로. 그만하기: confirm → 푼 문제가 있으면 "중단" 기록 저장 → 홈.

### 3.3 결과 `#viewResult` (기존 `#finish`)
- 점수·정답률·소요 시간, 틀린 단어 목록(번호·영어·뜻), [틀린 단어 다시 풀기] `#retryMissed`, [같은 범위 다시] `#againSame`, [홈으로] `#newTest`.

### 3.4 세트 편집 `#viewSets` (기존 `#editor`)
- 이름 `#setName`, 사진 선택/촬영, [✨ 사진에서 단어 가져오기] `#extractWords` [취소] `#cancelExtract`, 상태 `#extractStatus`, 사진 썸네일 줄(가로 스크롤) `#photoPreview`.
- **단어 표** `#wordTable`: 번호 / 영어 / 뜻 / 허용 답안 / 발음, 행 삭제, [행 추가]. 표와 숨은 `#wordDraft`(텍스트)는 양방향 동기화. [텍스트로 편집] 토글 `#toggleDraftText`.
- 확인란 `#confirmed`, [저장] `#saveSet`, [닫기] `#closeEditor`.

### 3.5 기록 `#viewHistory`
- 세트 필터 `#historyFilter`(전체/세트별), 요약(시험 수·평균 점수), 목록(기존 `#historyList`), CSV `#exportHistory`, 전체 삭제 `#clearHistory`.

### 3.6 설정 `#viewSettings`
- 보호자 설정(AI 연결) — 기존 `#aiSettings` 블록 그대로(ID·동작 불변).
- 마이크 점검(기존 `#micPanel` 내용, 접힘), 백업 JSON/가져오기, 홈 화면 설치 `#installApp`, 앱 정보(`#appStatus`, `#refreshApp`, `#checkApp`).

## 4. 데이터 모델
- 세트 `{id, name, words, updatedAt?}` — 기존 호환, `updatedAt` 추가(선택).
- 기록 `{id, setId, setName, mode, range, startedAt, completedAt, results, partial?}` — `partial: true`면 중단 기록("중단" 표시).
- 진행 중 시험 `daily_vocab_session_v1` = `{id, setId, setName, mode, range, rangeValue, shuffle, startedAt, queue:[word], position, results, pausedAt}`. 재개 시 세트가 없어도 queue 스냅샷으로 진행.
- 환경 설정 `daily_vocab_prefs_v1` = `{mode, range, shuffle}`.
- 기존 키(`daily_vocab_sets_v2`, `daily_vocab_history_v2`, `daily_vocab_missed_<id>`, `daily_vocab_ai_v2`)는 그대로.

## 5. 파일 구조
| 파일 | 역할 |
|---|---|
| `index.html` | 마크업 + CSS + 부트스트랩(버전·오류 배너) |
| `quiz.js` (신규) | 데이터 로드/이전, 뷰 전환, 시험 진행(쉬기·이어서·그만하기), 결과, 기록, 음성 인식·마이크 점검, 환경 설정 |
| `sets.js` | 세트 관리(이름 바꾸기·표 편집기·사진·AI 호출·백업/가져오기), 보호자 설정(불변), 설치·서비스워커 |
| `sw.js` | 캐시 v8, `quiz.js?v=`·`sets.js?v=` 포함 |
| `tests/` | 기존 6개 갱신 + `session.cjs`(쉬기·이어서·그만하기·이름 바꾸기·표 편집·환경 설정) |

## 6. 구현 단계
1. 설계서 작성·커밋 (이 문서)
2. 엔진을 `quiz.js`로 분리하고 뷰 전환 체계(`showView`) 도입, 마크업·CSS 재구성(홈/시험/결과/편집/기록/설정 + 하단 탭)
3. 시험: 쉬기/이어서/그만하기(중단 기록), 결과 화면 틀린 단어 목록·같은 범위 다시, 마지막 선택 기억, 책 번호 기준 범위 라벨
4. 세트: 이름 바꾸기, 단어 표 편집기(텍스트와 동기화), 썸네일 줄, 새 세트 기본 이름
5. 기록: 세트 필터·요약, 중단 기록 표시
6. 설정 화면으로 보호자·마이크·백업·앱 정보 이동(ID·동작 유지)
7. 버전 `20261012-4`, 캐시 v8, README/CLAUDE.md 갱신
8. 테스트 갱신·추가, 전체 PASS
9. Opus 5.5 리뷰(UX·코드) 반영
10. PR → 머지 → Pages 배포 확인(`/daily-vocab/`) → 메모리 갱신

## 7. 테스트 계획
- 기존: worker, browser(흐름 갱신), pwa(뷰 폭·오프라인·AI 오류), app-update(버전), ten-photos, ai-recognition.
- 신규 `session.cjs`: 시작 → 2문제 → 쉬기 → 새로고침 → 이어서 하기 카드 → 재개 → 완료 → 기록 1건 / 시작 → 1문제 → 그만하기(확인) → 중단 기록(partial) / 이름 바꾸기 → 선택 목록·기록 반영 / 표 편집(행 추가·삭제) ↔ 텍스트 동기화 / 환경 설정(방식·범위·섞기) 새로고침 후 유지 / 하단 탭 전환.

## 8. 진행 상태 (자동 재개 기준)
- [x] 1. 설계서 작성·커밋
- [x] 2. quiz.js 분리 + 뷰 전환 + 마크업/CSS 재구성
- [x] 3. 시험 쉬기/이어서/그만하기 + 결과 화면 + 환경 설정 기억 + 범위 라벨
- [x] 4. 세트 이름 바꾸기 + 단어 표 편집기 + 썸네일
- [x] 5. 기록 필터·요약·중단 표시
- [x] 6. 설정 화면 통합
- [x] 7. 버전·캐시·문서 갱신
- [x] 8. 테스트 갱신·추가 전체 PASS
- [x] 9. Opus 5.5 리뷰 반영 — UX 리뷰 P1 5건·P2 11건·P3 일부, 코드 리뷰 13건 반영(시험 중 설정 진입 차단, 채점 후 모름 비활성화, 읽기 실패 안내, 삭제·이름 바꾸기를 편집 화면으로, 미저장 초안 보호·뒤로 가기, 중단 결과 화면, 쉰 시간 제외, 방금 틀린 단어로 복습, 세트 간 오답 분리, 쉬기 저장 실패 안내, 채점된 문제 쉬기 처리, 사진 누적·중복 건너뛰기·실패 지점 안내, 행 오류 줄 번호, 쉼표 구분, 탭 문자 정리, 행 추가 번호, 기록 필터·가져오기 정렬 등). 테스트 7개 PASS.
- [x] 10. PR #12 머지 완료(2026-10-13), https://hongtaehwa.github.io/daily-vocab/ 배포 확인. 남은 권장 사항(P3: 문구 해요체 통일 일부, 결과 화면 포커스 이동 등)은 미반영.

## 9. AI 사전 — 영어만 있는 사진·빈 뜻 채우기 (2026-10-18)

배경: 교재 페이지가 아니라 영어 단어만 적힌 사진(단어 목록·시험지·손글씨)을 찍는 경우가 있고, 보호자가 영어만 적어 두고 뜻을 채우고 싶은 경우가 있다. 기존 프롬프트는 “뜻을 지어내지 말 것”이라 이런 사진은 결과가 비었다.

- `/recognize` 프롬프트: 인쇄된 뜻이 있으면 인쇄된 뜻만(기존), 뜻이 인쇄되지 않은 항목은 학습자 사전처럼 뜻·발음을 채우고 `generated:true`. 읽기 어려운 뜻은 생성하지 않고 건너뛰어 note. 사진 한 장당 요청 1개는 그대로라 비용·대기 시간이 늘지 않는다.
- `/define`(AI 사전): 영어 목록(최대 60개) → 뜻·발음·허용 답안. 요청한 철자 그대로, 모르는 단어는 제외하고 note로 알린다. 사진 없이 텍스트만 보내므로 비용이 적다.
- 앱: 편집 화면 단어 표 위의 ‘✨ 빈 뜻 AI로 채우기’가 뜻·발음이 빈 행의 영어만 40개씩 순차 전송해 빈 칸만 채운다(적힌 칸은 바꾸지 않음). 사진 인식과 같은 작업 공통 `startOperation`(한 번에 하나, 취소, 시간 초과, 버튼 잠금, 늦은 결과 폐기)을 쓴다.
- 표시: AI가 채운 뜻·발음 칸은 `.ai-filled`(노란 칸)로 표시하고 직접 고치면 사라진다. 편집 중에만 기억하며 저장 데이터·초안 텍스트에는 남기지 않는다(데이터 모델·저장 키 불변).
- 안내: ‘뜻 N개는 사진에 없어 AI 사전으로 채웠어요(노란 칸)’, ‘못 찾은 단어: …’, 옛 Worker(404)면 ‘다시 배포’. 확인란 문구는 그대로 두고 경고에 “사전과 비교해 확인”을 더했다.
- 배포 순서: Worker 먼저(`generated` 필드 추가는 옛 앱과 호환), 그다음 앱(버전 `20261018-1`, 캐시 v10).

## 10. 가족 기록함 — 보호자 폰에서 아이들 기록 보기 (2026-10-18 설계, 1단계)

배경: 중2 아들에 이어 초5 딸도 각자 기기에서 쓰게 되었다. 기기별 localStorage라 데이터는 저절로 분리되지만, 부모가 자기 폰에서 두 아이의 시험 여부·점수를 선생님처럼 보려면 기록이 기기 밖으로 나가는 경로가 필요하다. 외부 서비스(Firebase 등)는 개인정보 원칙에 어긋나고 JSON 백업 전달은 매일 보기에 불편해, 이미 있는 가족 Worker에 “가족 기록함”을 붙인다. 앱 분리는 같은 계정의 GitHub Pages가 origin을 공유해 localStorage가 섞이므로 제외했다.

결정(2026-10-18, 보호자 확인): ① 보호자 코드를 가족 코드와 따로 둔다 ② 저장소는 Worker의 SQLite 기반 Durable Object ③ 부모 화면은 보호자 코드가 있을 때만 보이는 하단 탭 ④ 기록 보내기는 아이 이름 저장 + 스위치 켜기 두 조건.

### 10.1 역할과 코드
- 가족 코드(`APP_PASSCODE`, 기존): AI 사진 인식·사전, 기록 보내기(`/sync`). 아이 기기에 저장.
- 보호자 코드(`PARENT_PASSCODE`, 새 비밀값): 기록 읽기·삭제(`/family…`). 보호자 폰에만 저장. 가족 코드가 통하는 곳에서는 보호자 코드도 통한다.
- 이유: 아이 기기에는 가족 코드가 이미 있어 그 코드로 읽기까지 열면 형제 기록을 볼 수 있다. 코드를 나누면 아이 기기에는 ‘아이들’ 탭 자체가 없다.

### 10.2 아이 기기(보내는 쪽) — `family.js`
- 설정 → ‘👨‍👩‍👧 가족 기록함’: 아이 이름(20자), ‘시험 기록을 보호자에게 보내기’ 스위치, 저장, 지금 보내기. 기기마다 한 번 만드는 `childId`(UUID).
- 언제: `saveSession`이 기록을 확정할 때(완료·중단 모두) `queueFamilySync(record)` → 대기 목록(`pending`)에 id를 넣고 바로 전송. 실패하면 대기 목록에 남겨 앱을 열 때·화면 복귀·온라인 복귀 때 다시 보낸다. 처음 켤 때는 기존 기록 전체를 보낸다.
- 무엇: 압축 기록 `{id, setName, mode, range, startedAt, completedAt, total, correct, partial, activeMs, missed:[{en,ko,unknown?}]}`(틀린 단어 최대 200개) + 세트 목록 `[{name,count}]`. 단어별 전체 결과·세트 단어는 보내지 않는다. 한 번에 50개씩.
- 홈·시험·결과 화면은 바뀌지 않는다. 상태 문구는 설정에만(‘마지막 전송 …’, ‘못 보낸 기록 N개’).

### 10.3 Worker — `FamilyStore`(Durable Object)
- 저장소: SQLite 기반 DO 하나(`idFromName("family")`)의 내장 키-값 저장소. 키: `child:<childId>` = `{id,name,sets,createdAt,updatedAt,lastTestAt,recordCount}`, `rec:<childId>:<completedAt ISO>:<recordId>` = 압축 기록(+`receivedAt`). 같은 기록을 다시 보내면 같은 키라 덮어쓴다. 아이당 5,000개를 넘으면 오래된 것부터 지운다.
- 엔드포인트: `POST /sync`(가족·보호자 코드) → `{ok, stored, trimmed, syncedAt}` / `GET /family`(보호자) → `{children:[{…child, records}], serverTime}`(아이별 최근 14일 기록, 20개 미만이면 최근 20개) / `GET /family/<childId>`(보호자) → `{child, records}`(전체, 최신순) / `DELETE /family/<childId>`(보호자) → `{ok, deleted}`.
- 검증: 본문 256KB, 기록 100개/회, 이름 1~20자, id 형식, 시각·점수·방식 검사, 하나라도 틀리면 전체 거절. Origin 허용 목록·상수 시간 비교·요청 제한(`/sync`, `/family` 버킷)은 그대로.
- 오류: 보호자 코드 미설정 500(`PARENT_PASSCODE` 안내), FAMILY 바인딩 없음 500(‘다시 배포’), 가족 코드로 읽기 401 ‘보호자 코드가 맞지 않습니다’, 모르는 아이 404 `unknown_child`(옛 Worker의 404 `not_found`와 구분).
- 배포: `wrangler.jsonc`에 `FAMILY` 바인딩과 마이그레이션 `v2`(`new_sqlite_classes: ["FamilyStore"]`), `npx wrangler secret put PARENT_PASSCODE`, `npm run deploy`. Worker 먼저, 앱 나중.

### 10.4 보호자 폰(보는 쪽)
- 설정의 가족 기록함 아래 ‘보호자 폰’ 칸에 보호자 코드 저장 → 하단 ‘👨‍👩‍👧 아이들’ 탭 등장(`#tabFamily`, 코드 없으면 숨김) + 즉시 연결 확인.
- 아이들 화면(`#family`): 아이별 카드 — 이름, ‘오늘 ✅ N회’/‘오늘 아직 안 했어요’, 마지막 시험(상대 시각·세트·점수), 최근 7일 칸(요일·평균 점수), 이번 주 횟수·평균. ‘기록 자세히 보기’ → 전체 기록 목록(기록 화면과 같은 모양: 점수·날짜·세트·방식·범위·소요 시간·중단, 틀린 단어 펼치기) + ‘이 아이 기록 삭제’.
- 오늘·7일·이번 주는 폰의 현지 시간으로 계산한다(서버는 UTC로 저장). 마지막 응답은 `daily_vocab_family_cache_v1`에 두어 오프라인에도 직전 상태가 보인다.

### 10.5 데이터 키(앱)
- `daily_vocab_family_v1` = `{childId, childName, sendEnabled, lastSyncAt, lastError, pending:[기록 id], parentCode}` — 백업 JSON/CSV에 넣지 않는다.
- `daily_vocab_family_cache_v1` = 마지막 `/family` 응답 + `fetchedAt`.
- 기록 객체에 `activeMs`(실제 푼 시간, 선택)를 추가 저장한다. 기존 키·형식은 그대로.

### 10.6 테스트·문서
- `tests/worker.cjs`: /sync 검증·덮어쓰기·14일 요약·상한, 코드 역할(가족 코드로 /family 401, 보호자 코드로 /ping 허용), 미설정 안내, 삭제, DO 저장소 모의, 503 폴백.
- `tests/family.cjs`: 아이 기기 — 켜기(기존 기록 전송) → 시험 완료 → 보낸 내용 검증 → 연결 실패 → 대기 → 새로고침 후 재전송 → 끄기; 보호자 폰 — 코드 오류·옛 Worker 안내 → 저장·탭 등장 → 카드(오늘·7일·이번 주) → 상세·틀린 단어 → 삭제 → 코드 삭제로 탭 숨김.
- README(사용법·개인정보 절), worker/README(보호자 코드·마이그레이션·API), CLAUDE.md(파일·ID·문구·키·버전 체크리스트). 버전 `20261018-2`, 캐시 v11, `family.js?v=` 추가.

### 10.7 이후 단계
- 2단계는 11절의 ‘오늘의 단어’(2A)로 구체화했다(2026-10-18). 부모 한마디는 보류.
- 3단계 세트 보내기: 15절의 ‘세트 동기화’로 구현했다(2026-10-18).
- 하지 않는 것: 푸시 알림, 계정·로그인, 외부 서비스. 기기를 바꾸면 새 childId로 새 아이처럼 보이므로 옛 항목을 삭제한다(이름 합치기는 2단계 검토).

## 11. 오늘의 단어 — 매일 자동 생성 퀴즈 (2026-10-18 설계, 2A 구현)

배경: 아이에게 매일 그날의 단어 퀴즈를 자동으로 주고(2A), 푸시로 알리고(2B), 부모가 풀었는지 확인하게 한다. 단어 출처는 “웹에서 임의로 가져오기” 대신 **가족 Worker의 Claude 생성 + 교재 수준 앵커**로 결정했다(저작권·수준 통제·형식 일관성). 사용자 결정(2026-10-18): 생성 방식 AI + 교재 앵커, 기본 하루 10개·오후 4시(아이별로 보호자가 변경).

### 11.1 생성 규칙 (Worker `FamilyStore.buildDaily`)
- 하루 구성 = 복습 최대 3개 + 새 단어(나머지). 복습은 가족 기록함의 최근 14일 기록에서 틀린 단어를 최신순·중복 제거로 고른다. 복습 단어도 같은 요청에 “그대로 정의”로 넣어 뜻·발음·허용 답안을 채운다.
- 수준: ① 보호자가 고른 수준 라벨(`plan.level`, 기본 ‘중2 상위권’, 직접 입력 가능 40자) ② **교재 앵커** `child.anchor` — 아이 기기가 `/sync`마다 가장 최근에 고친 세트의 영어 단어 최대 60개를 보내고, 요청에 “지금 공부 중인 단어(수준 기준, 제외)”로 넣는다 ③ 점수 기반 자동 조절은 2C.
- 중복 방지: `served:<childId>` = `{단어(소문자): 날짜}`(최대 5,000개, 오래된 것부터 정리). 요청은 필요한 수의 2배를 받아 앵커·이미 낸 단어·철자 규칙 위반·중복을 걸러 채우고, 모자라면 한 번 더(최대 2회) 요청한다. 최근 200개는 요청에 “최근에 이미 낸 단어(제외)”로도 넣는다.
- 형식: `DEFINE_SCHEMA`(english, ipa, korean, aliases) 그대로 → 앱 시험 엔진이 그대로 채점. 결과 `daily:<childId>:<YYYY-MM-DD>` = `{childId, date, level, model, createdAt, words:[{id,en,ko,ipa,aliases,kind:"review"|"new"}], note, completed?:{recordId,correct,total,completedAt}}`.
- 모델: `DAILY_MODEL`(wrangler vars, 기본 `claude-sonnet-5-5`). 사진 인식 모델과 별개.
- 같은 날짜 생성이 겹치면(크론·기기 동시 요청) DO 안의 `generating` 맵으로 Claude 호출을 한 번만 한다.

### 11.2 Worker 엔드포인트·크론
- `POST /family/<childId>/plan`(보호자 코드) `{enabled, level, dailyCount(5~20), hour(0~23, KST)}` → `{ok, child}`. 계획은 `child.plan`에 저장, 기본값 `{enabled:false, level:"중2 상위권", dailyCount:10, hour:16}`.
- `GET /daily/<childId>?date=`(가족·보호자 코드) → 그날 것(200) / 계획 꺼짐 409 `plan_disabled` / 아직 없음 404 `no_daily`(옛 Worker의 404 `not_found`와 구분). `POST /daily/<childId>` `{date?}` → 있으면 그대로, 없으면 생성.
- `/sync` 확장: `anchor:{setName, words}` 저장, 기록의 `daily:"YYYY-MM-DD"`가 있으면 그날 것에 `completed` 표시(더 최근 기록으로 갱신).
- `GET /family`: 아이별 `plan`, `today:{date, exists, count, completed}` 추가. `GET /family/<childId>`: `plan`, `anchor`, `today:{date, exists, words, note, completed}` 추가. `DELETE /family/<childId>`는 `daily:`·`served:`도 지운다.
- 크론: `wrangler.jsonc` `triggers.crons = ["0 * * * *"]`(매시). `scheduled()`가 KST 날짜·시각을 DO `POST /cron`에 넘기고, DO는 `plan.enabled && plan.hour <= hour`이면서 그날 것이 없는 아이에게 생성한다. 기기가 먼저 열면 즉시 생성(`POST /daily`)되므로 비는 날이 없다. 서버 시간은 KST 고정(가족이 한국).

### 11.3 아이 기기 (`family.js`)
- 저장 키 `daily_vocab_daily_v1` = `{childId, date, words, level, note, fetchedAt, result?:{id,correct,total,completedAt}, disabled?, lastCheckedAt, lastError?}`. 하루치만 보관한다.
- `checkDaily()`: 앱 시작·화면 복귀·보내기 켤 때. 조건은 기록 보내기 켜짐 + childId + 접속 코드. 오늘 것이 기기에 있으면 서버에 묻지 않는다. 없으면 `GET /daily` → `no_daily`면 `POST /daily`로 생성 → 저장. `plan_disabled`면 카드 숨김(10분간 재조회 안 함). 오류는 조용히(카드 숨김, 설정 문구 없음).
- 홈 카드 `#dailyCard`(이어서 하기 카드 아래): ‘📬 오늘의 단어 10/19 · 새 단어 7개 + 복습 3개 · 중2 상위권’ + `▶ 풀기`. 풀면 `newSession(false, words, {setId:"daily:<date>", setName:"오늘의 단어 M/D"}, {rangeLabel:"오늘의 단어", daily:date})`로 기존 엔진 실행(방식은 아이가 고른 대로, 섞기 설정 그대로). `sessionMeta.daily` → 기록 `daily` → `compactRecord` → 서버 `completed`. 끝나면 카드가 ‘✅ 오늘의 단어 끝! 9 / 10’ + `한 번 더 풀기`로 바뀐다.
- 세트로는 남기지 않는다(홈 선택 목록 오염 방지). 틀린 단어는 `daily:` setId가 세트 목록에 없어 `daily_vocab_missed_*`를 만들지 않고, 기록의 틀린 단어와 서버 복습 풀에 남는다. ‘오늘의 단어 모음’ 세트는 필요해지면 별도.

### 11.4 보호자 폰 (`family.js` 아이들 탭)
- 아이 카드에 ‘오늘의 단어 ✅ 9/10’ / ‘📬 도착, 아직 안 풀었어요’ / ‘아직 없음 (16시에 만들어요)’ / ‘꺼짐’ 한 줄.
- 상세 화면 `#planBox`: 켜기 스위치, 수준(목록 + 직접 입력), 하루 단어 수(5·10·15·20), 만드는 시각(0~23시), `저장`(→ `POST /family/<id>/plan`), `오늘 것 지금 만들기`(→ `POST /daily/<id>`, 보호자 코드), 수준 기준 세트(앵커) 안내, 오늘 단어 미리보기(복습/새 표시, 완료 점수).

### 11.5 테스트·문서·배포
- `tests/worker.cjs`: 계획 검증·권한, 앵커 저장, 생성(복습 포함·앵커/이미 낸 단어 제외·2회 재요청·같은 날 중복 생성 없음), 완료 표시, 요약·상세 필드, 거부/빈 결과, 크론(시각 도달 시 1회), 삭제 정리.
- `tests/daily.cjs`: 아이 — 계획 꺼짐이면 카드 없음 → 켜진 뒤 새로고침 시 GET→POST 생성 → 카드 문구 → 풀기 → 기록 `daily` 전송 → ✅ 카드 → 새로고침 후 재생성 없음; 보호자 — 카드의 오늘 상태, 상세 계획 저장 요청 본문, 미리보기.
- README(아이·보호자 사용법, 개인정보: 앵커 단어 전송), worker/README(엔드포인트·크론·DAILY_MODEL), CLAUDE.md. 버전 `20261018-3`, 캐시 v12.
- 배포 순서: Worker 먼저(`npm run deploy`, 크론 등록 포함) → 앱. 보호자가 아이들 탭에서 계획을 켜야 생성이 시작된다.

### 11.6 2B·2C (미구현)
- 2B 푸시: VAPID 키(비밀값)·`POST /push/subscribe`(가족 코드, 구독을 `child.push`에 저장)·`sw.js` push/notificationclick·크론 생성 직후 전송·부모 완료 알림. Android Chrome은 바로, iOS는 홈 화면 설치 앱에서만(16.4+) 되므로 ‘알림 켜기’ 버튼과 설치 안내 필요. 아이들 기기 OS 확인 뒤 설계 확정.
- 2C 수준 피드백: 더 쉽게·더 어렵게, 최근 평균 90%↑/60%↓ 자동 조절, 틀린 단어 1·3·7일 재출제.

## 12. 아이 코드·전용 링크 — 아이 한 명, 기기 여러 대 (2026-10-18)

배경: 아이들이 각자 아이폰 한 대와 갤럭시 태블릿 한 대를 쓴다. 10절의 “기기 = 아이” 식별(기기에서 이름 입력, 기기마다 childId 생성)로는 한 아이가 두 명으로 보이고 오늘의 단어도 기기마다 따로 만들어진다. 사용자는 “아이마다 다른 링크”를 제안했고, 링크는 코드를 전달하는 수단으로 채택하되 식별은 서버의 아이 코드로 한다(같은 origin은 저장 공간을 공유하고, iOS는 Safari와 홈 화면 앱의 저장 공간이 달라 링크만으로는 안 된다).

- **아이 = 보호자가 만든 서버 항목.** `POST /family/children {name}` → `child:<uuid>` + 6자리 `joinCode`(`code:<코드>` → childId). 아이 카드·상세에 코드와 전용 링크 `…/daily-vocab/?child=<코드>`(복사 버튼), 연결된 기기 목록, 이름 바꾸기, 코드 새로 만들기(옛 코드·옛 링크 무효).
- **기기 연결.** 아이 기기는 설정 → 가족 기록함에 코드를 넣거나(`POST /join {code, device:{id,label}}`), 전용 링크를 열면 `linkCodeFromUrl`이 코드를 읽어 자동 연결한다(주소에서 코드 제거). 접속 코드가 없으면 `pendingCode`로 두고 설정 화면을 열어 안내, 접속 코드를 저장하면 `onAiSettingsSaved`가 바로 연결한다. 연결되면 보내기 켜짐 + 지금까지의 기록 전송. `연결 해제`는 기기만 뺀다.
- **기기 식별.** 기기마다 `deviceId`(UUID)와 `deviceLabel`(iPhone / iPad / Android 폰 / Android 태블릿 / Windows PC / Mac)을 `/join`·`/sync`에 보내 `child.devices`(최대 10대, 종류·연결·마지막 접속)에 남긴다. 아이 이름은 서버가 기준(기기가 보낸 이름으로 덮어쓰지 않음).
- **같은 아이의 두 기기**: 기록은 한 아이에게 모이고(기록 id로 중복 없음), 오늘의 단어는 같은 `daily:<childId>:<date>`를 받으며, 한 기기에서 풀면 다른 기기는 `checkDaily`가 10분 간격으로 서버의 `completed`를 받아 ✅로 바꾼다. 교재 앵커는 마지막에 보낸 기기의 최근 세트.
- **iOS 안내**: 홈 화면에 설치한 앱을 연 뒤 접속 코드 → 아이 코드 입력. Safari에서 링크로 연결한 내용은 설치한 앱에 넘어가지 않는다. 갤럭시(Chrome)는 링크로 연결 후 설치해도 이어진다.
- 옛 흐름(기기에서 이름 입력 → childId 자동 생성)은 없앴다. `/sync`는 모르는 childId도 받아 만들지만(옛 앱 호환) 새 앱은 늘 연결된 id로 보낸다.
- 테스트: `tests/worker.cjs`(아이 만들기 권한·검증, `/join` 형식·모르는 코드·기기 등록·보호자 코드 허용, 두 기기 병합·서버 이름 우선, 이름·코드 재발급·삭제), `tests/family.cjs`(링크 → 접속 코드 대기 → 자동 연결, 연결 해제·재연결, 아이 추가·코드·링크·이름·코드 재발급), `tests/daily.cjs`(코드로 연결한 아이의 오늘의 단어). 버전 `20261018-4`, 캐시 v13.

## 13. 부정행위 대응 — 화면 번역·AI 검색 (2026-10-18)

배경: 갤럭시 태블릿에서 내비게이션 바를 길게 누르면 서클 투 서치가 화면의 영어 단어를 바로 번역한다(아이폰은 Apple Intelligence·Siri·선택 → 번역). 사용자는 “이 앱에서만 서클 투 서치를 막기 + 화면 이탈 기록”을 원했다. 듣기 모드·제한 시간 제안은 보류.

- **웹앱의 한계**: 서클 투 서치·Apple Intelligence는 OS가 화면을 캡처해 읽으므로 웹 페이지는 막을 수도, 알아챌 수도 없다. 웹앱에서 가능한 것은 ① 글자 선택·복사·길게 누르기 메뉴 차단(`.word-box` `user-select:none`, `-webkit-touch-callout:none`, contextmenu/copy/cut/dragstart 차단) ② 화면 이탈 기록뿐이다.
- **화면 이탈 기록(구현)**: `visibilitychange`(hidden)·`blur`로 시작, `visible`·`focus`로 끝. 1초 미만은 깜빡임으로 보고 세지 않으며, 마이크 버튼 직후 2초 안에 시작된 가림(권한 요청 창)과 채점이 끝난 문제의 이탈은 제외한다. `question.away/awayMs`(문제별), `sessionMeta.awayCount/awayMs`(시험별) → 기록(`results[i].away`, `record.awayCount`) → `compactRecord` → Worker(`awayCount` ≤ 10000, `awayMs` ≤ 1일) → 보호자 기록 ‘⚠️ 문제 중 화면 이탈 N회 · 총 M초’, 아이 카드 ‘⚠️ 오늘 화면 이탈 N회’, 아이 기기 기록 탭에도 표시. 서클 투 서치 호출이 `visibilitychange`를 일으키는지는 실기기 확인 필요(앱 전환은 확실).
- **갤럭시 태블릿용 네이티브 래퍼 앱(다음 작업, `android/`)**: WebView로 `https://hongtaehwa.github.io/daily-vocab/`를 열고 액티비티 창에 `FLAG_SECURE`를 걸어 이 앱 화면에서만 스크린샷·화면 녹화·서클 투 서치를 막는다(은행 앱 방식, 다른 앱에는 영향 없음). WebView에는 Web Speech API(음성 인식)가 없으므로 `android.speech.SpeechRecognizer`를 `@JavascriptInterface`(`AndroidSpeech.start/stop`, 결과는 `window.onAndroidSpeech`)로 연결하고, TTS도 `TextToSpeech`로 브리지한다. 웹앱은 `window.AndroidSpeech`가 있으면 그것을 쓰도록 `startRecognition`/`speak`에 어댑터를 둔다. 사진 선택(`<input type=file>`)은 `onShowFileChooser`로, 마이크는 RECORD_AUDIO 런타임 권한으로 처리. 뒤로 가기는 WebView 히스토리(앱의 pushState)로. UA에 `DailyVocabApp/버전`을 붙여 기기 종류를 ‘Android 태블릿(앱)’으로 표시. 빌드는 GitHub Actions(JDK 17 + Android SDK, `assembleRelease`)로 APK를 만들어 Release에 첨부하고, 서명 키는 보호자가 한 번 만든 keystore를 GitHub Secrets에 넣어 쓴다(저장소에 키 없음). 태블릿은 ‘알 수 없는 앱 설치 허용’ 후 설치.
- **아이폰**: iOS는 네이티브 앱에도 스크린샷·Siri 화면 읽기 차단 수단을 주지 않는다. 스크린 타임의 ‘Intelligence 및 Siri’ 제한과 사용 안내 모드 안내로 대응하고, 화면 이탈 기록으로 보완한다.

### 13.1 보완 (2026-10-18)
- **문제당 제한 시간**: 사용자가 “인터넷으로 나가 단어를 찾아볼 수 있으니” 요청. 보호자가 아이별 계획에 `timeLimitSec`(0 또는 5~120초)을 저장하면 아이 기기가 앱을 열 때 `GET /settings/<childId>`로 받아 모든 시험에 적용한다(`/join` 응답에도 포함). 마감은 절대 시각이라 앱 밖에 있어도 흐르고, 시간이 지나면 `markUnknown()`으로 모름 처리하고 안내한다. 기록 `timeouts`·`results[i].timeout` → 아이 기록 탭·보호자 기록에 ‘⏱ 시간 초과 N개’. 기본값 없음(0).
- **상단 시계 겹침**: 갤럭시 앱이 Android 15(targetSdk 35)의 edge-to-edge 강제로 상태 표시줄 아래까지 그려지던 문제. `MainActivity`에서 `setDecorFitsSystemWindows(false)` + 인셋 리스너로 위(남색)·아래(흰색, 키보드 높이 포함) 여백을 직접 둔다(앱 v1.1). 웹앱 `.topbar`에도 `env(safe-area-inset-top)` 여백을 넣어 아이폰 설치형에서도 안전하다.

### 13.2 화면 분할 차단 (2026-10-18, 앱 v1.2)
- 배경: 태블릿에서 앱을 화면 분할로 열면 아래쪽에 브라우저·AI 앱을 함께 쓸 수 있었다. 사용자가 “앱 분할(화면 분할) 안 되게” 요청.
- 매니페스트 `android:resizeableActivity="false"`(분할·팝업 화면 비지원 선언). 폰과 Android 11 이하에서는 이것만으로 막힌다.
- Android 12+ 큰 화면(sw ≥ 600dp, 태블릿)은 OS가 앱 설정과 무관하게 멀티윈도우를 허용(호환 모드)할 수 있으므로 `MainActivity`가 `onMultiWindowModeChanged`·`onResume`·`onCreate`에서 `isInMultiWindowMode`를 보고, 분할 중이면 WebView를 `INVISIBLE`로 숨기고 남색 가림막(“화면 분할은 쓸 수 없어요 · 전체 화면에서만 열려요”)을 보여 준다. WebView를 숨기면 페이지에 `visibilitychange(hidden)`가 전달되어 웹앱의 기존 화면 이탈 기록이 그대로 동작하고(보호자에게 ⚠️), 제한 시간도 계속 흐른다. 전체 화면으로 돌아오면 가림막을 내린다. 삼성 팝업 화면·DeX 창도 멀티윈도우라 같이 막힌다.
- 웹앱·Worker 변경 없음. 앱 versionCode 3 / 1.2(UA `DailyVocabApp/1.2`). 실기기 확인 필요(분할 시도 → 거부 또는 가림막).

## 14. 보호자 모드 — 보호자 폰은 관리 전용 (2026-10-18)

배경: 보호자는 문제를 풀 일이 없는데 보호자 폰에도 아이용 홈(세트·시작)이 먼저 뜨고 ‘아이들’ 탭이 하나 붙은 모양이었다. 사용자 요청으로 보호자 경험을 관리 전용으로 바꿨다. 별도 앱 없이 같은 코드로 화면만 다르게 시작한다.

- **모드 판정** `isParentMode()`: 보호자 코드가 저장되어 있거나(설정 또는 첫 화면에서 저장 → 자동 전환) `?mode=parent`로 설치된 기기(`daily_vocab_mode_v1`), 단 ‘아이 기기처럼 보기’(`parentModeOff`)가 꺼져 있을 때. `?mode=child`로 해제.
- **화면**: `body.parent-mode` + `.child-only` 숨김(홈·기록 탭, 마이크·백업 카드, 가족 기록함의 아이 기기 부분). `showView`가 아이용 화면 요청을 `family`로 돌린다(시험 중 제외). 상단 문구 ‘보호자 · 아이들 관리’. 아이들 화면은 코드가 없으면 `#parentSetup`(코드 입력)만, 있으면 ‘👀 오늘 한눈에’(`#familyOverview`: 아이별 오늘 시험 횟수·평균, 오늘의 단어 ✅/📬/–, 이번 주 횟수·평균·마지막 시험, ⚠️ 화면 이탈·⏱ 시간 초과) → 아이 카드 → 아이 추가. 상세는 🔗 기기 연결 → ⚙️ 오늘의 단어·제한 시간 → 📉 자주 틀린 단어(최근 2주 상위 10, 횟수·뜻) → 🕒 기록 순.
- **별도 아이콘**: `parent.html`(설치 안내 전용, 자동 이동 없음 — iOS는 설치 시 현재 페이지의 매니페스트를 쓰므로) + `manifest-parent.webmanifest`(`id: /daily-vocab/parent`, `start_url: /daily-vocab/?mode=parent`, 이름 ‘매일 영단어 보호자’) + `icons/parent-*.png`(기존 아이콘에 가족 배지, Playwright로 SVG 렌더링). iOS는 설치형 앱마다 저장 공간이 달라 보호자 코드가 아이용 설치와 섞이지 않는다. Android Chrome은 같은 origin이라 저장 공간을 공유하지만 보호자 폰에 아이용 앱을 함께 쓸 일은 없다.
- 아이 기기 동작·서버는 바뀌지 않았다. 버전 `20261018-7`, 캐시 v16(셸에 parent.html·보호자 매니페스트·아이콘 추가).
- 보완(2026-10-18): 아이 기기에는 보호자 코드 칸(`#parentBox`)과 ‘아이 기기처럼 보기’를 아예 보이지 않는다. 보호자 코드는 보호자 화면(`parent.html` 설치 또는 ‘설치 없이 보호자 화면 열기’ = `?mode=parent`)에서만 넣는다. 보호자는 갤럭시 APK가 필요 없다(APK는 시험을 푸는 아이 태블릿용). 이미 코드를 저장한 기기는 그대로 보호자 모드다. 버전 `20261018-8`, 캐시 v17.

## 15. 세트 동기화 — 세트는 아이 단위 (2026-10-18)

배경: 보호자 화면에서 모든 아이가 똑같은 세트 하나(기본 예제)를 보였다. 세트는 기기 안(localStorage)에만 있고 가족 기록함은 세트 이름·개수만 받았기 때문이다. 새로 설치한 앱(갤럭시 APK의 WebView, 아이폰 홈 화면 앱)은 모두 예제 세트 하나로 시작하고, 아들이 예전 브라우저에서 만든 세트 3개는 그 브라우저에만 남아 있었다. 사용자가 ‘아이 단위 세트 동기화(빈 상태 허용·보호자 세트 보내기)’를 승인했다.

- **원칙**: 세트는 아이에게 속한다. 아이 코드로 연결된 기기는 서버의 그 아이 세트와 같아지고, 보호자는 아이 세트를 만들어 보내거나 고치고 지운다. 시험 기록·오답은 전처럼 기기별(+서버 사본).
- **Worker** (`FamilyStore`): 키 `set:<childId>:<setId>` = `{id, name, words, updatedAt, deletedAt?}`(묘비는 `words: []`). `POST /sets/<childId>`(가족 코드, `parseSetsSync`): 요청 `{device, known:[{id, updatedAt}], sets:[세트 전체…], deleted:[{id, deletedAt}]}` → 묘비·세트를 `updatedAt` 나중 것 우선으로 적용(지운 뒤 고친 세트는 부활) → 응답 `{sets: 기기에 없거나 더 새 것, deleted: 기기가 아는데 지워진 id, summary: 살아 있는 세트 [{id,name,count,updatedAt}]}`. 보호자 `GET /family/<id>/sets`, `POST …/sets {set:{id?, name, words}}`(서버가 `updatedAt` 부여), `GET|DELETE …/sets/<setId>`. 아이 항목의 `sets` 요약은 서버가 다시 계산하고 `setsSyncedAt`이 있으면 옛 앱의 `/sync` 세트 목록을 무시한다. 아이 삭제 때 세트 키도 지운다. 한도: 아이당 50세트, 세트당 2,000단어(앱과 같음), 본문 2MB, 묘비 200개/회.
- **아이 기기** (`family.js` `syncSets`): 앱 시작·화면 복귀(10분)·온라인 복귀·세트 저장/이름 바꾸기/삭제/가져오기 뒤(`queueSetsSync`). `setsAcked`(서버 요약)와 `updatedAt`이 다른 세트만 전체를 올리고 나머지는 `known`으로만 알린다. 삭제는 `noteSetDeleted`가 `setsDeleted` 묘비를 남긴다. 응답을 `applySetsResponse`가 반영하고 `selectSet`으로 WORDS·범위·기록 필터를 새로 잡는다. 시험 중에는 건너뛴다. 수정 시각이 없는 옛 세트는 올리기 전에 지금 시각을 붙인다. 가져오기한 세트에는 새 `updatedAt`을 붙인다.
- **예제 세트**: `day04`가 기본 단어와 같으면(`isUntouchedExample`) 올리지도 알리지도 않고, 첫 동기화가 성공하면 기기에서 제거한다. 옛 Worker(404)면 그대로 두어 예제로 계속 쓸 수 있다. 고친 예제는 보통 세트처럼 동기화한다.
- **빈 상태**: 세트 0개를 허용한다(`daily_vocab_sets_v2 = []`, `activeSetId = null`, `WORDS = []`). 홈 `#noSets`(‘아직 세트가 없어요 · 보호자가 보내 준 세트가 여기에 나타나요’), 세트 선택·수정 버튼 숨김, 시작 비활성, 기록 필터는 ‘전체’. 마지막 세트도 지울 수 있다.
- **보호자 폰**: 아이 상세에 `#setsBox`(📚 세트: 목록 ‘이름 · N단어 · 언제’, 보기·수정, 삭제, ‘➕ 세트 만들어 보내기 (사진)’). 편집기는 아이용 `#editor`를 그대로 쓰되 `window.editorForChild`가 있으면 `showView`가 보호자 모드에서도 편집 화면을 허용하고 제목에 ‘→ 🧒 이름에게 보내기’를 붙이며 `#manageBox`를 숨긴다. 저장은 `sendSetToChild` → `POST /family/<id>/sets` → `returnToChild`(상세 다시 열기, 요약 반영). 보호자 폰의 `aiConfig()`는 AI 코드가 없으면 보호자 코드를 써서 사진 인식이 바로 된다.
- **마이그레이션**: 기존 연결 기기는 새 버전을 열면 첫 `syncSets`에서 자기 세트를 올리고 예제를 치운다. 아들의 세트 3개는 그 세트가 있는 브라우저를 열어 같은 아이 코드로 연결하면 올라간다(JSON 전달 불필요). Worker 먼저 배포.
- 테스트: `tests/worker.cjs` 세트 동기화 절, `tests/family.cjs`(연결 시 예제 교체, 보호자 보내기/보기/삭제, 아이 기기 수신·삭제·빈 상태), `tests/daily.cjs`(옛 Worker면 예제 유지). 버전 `20261018-9`, 캐시 v18.

## 16. AI 2차 채점 — 뜻 채점에 융통성 (2026-10-18)

배경: 책의 뜻이 ‘…을 제출하다’인데 ‘제출하다’라고 쓰면 오답, ‘무게’에 ‘몸무게’도 오답이었다(글자 그대로 일치만 인정). 사용자가 “평가에 AI를 도입해 약간의 융통성을” 요청.

- **1단계(기기, 즉시·오프라인)**: `stripKoPlaceholders`가 비교 전에 자리표시 조사(`…을/를`, `~에게`, `-에`, `(법 등을)` 같은 괄호 설명)와 문장 앞 조사를 뗀다. `correctKo`는 뜻·허용 답안과 일치하거나, 답이 뜻으로 끝나는 짧은 합성어(두 글자 이내 차이, 뜻 두 글자 이상: 몸무게↔무게)면 정답. 그 밖에는 여전히 엄격(‘사과가 아님’은 오답).
- **2단계(AI, 틀린 답에만)**: AI 서버가 설정되고 온라인이면 `grade()`가 입력을 잠그고 ‘AI가 같은 뜻인지 확인하는 중…’ 상태(`question.aiPending`)로 `POST /grade {en, ko, aliases, answer}`를 보낸다. Worker `gradeAnswer`는 `GRADE_SYSTEM`(동의어·조사/어미·합성어·한 글자 오타 인정, 다른 뜻·교재에 없는 의미·막연한 답·여러 뜻 나열 거절)으로 `claude-haiku-5-5`(`GRADE_MODEL`, 빠르고 저렴, fallbacks 없음)에 JSON `{accept, reason}`을 받는다. 인정되면 정답 + ‘AI 판정: 이유’, 거절되면 오답 + 이유. 8초 초과·오프라인·옛 Worker(404)·오류면 null → 기기 채점 결과(오답). 쉬기·그만하기로 문제가 바뀌면 늦은 판정은 버린다. 스펠링(`ko_en`)에는 쓰지 않는다. 제한 시간은 답을 낸 순간 멈춘다.
- **학습**: 인정된 답은 `learnAlias`가 그 세트 단어의 허용 답안에 넣는다(`updatedAt` 갱신 → 세트 동기화로 같은 아이의 다른 기기·보호자 폰에도 반영). 다음부터는 기기에서 바로 정답. 오늘의 단어·기록 복습 시험은 세트가 아니므로 학습하지 않는다.
- **기록**: `results[i].ai`, 기록 `aiPass`(개수) → 아이 기록 탭·보호자 기록에 ‘🤖 AI 인정 N개’. Worker `parseSync`가 보존.
- 버전 `20261018-10`, 캐시 v19. Worker 재배포 필요(`/grade`).

## 17. 전반 점검 보완 — 작은 결함 4건 (2026-10-18)

점검에서 나온 작은 결함 네 가지를 한 PR로 고쳤다. 버전 `20261018-11`, 캐시 v20, 갤럭시 앱 v1.3(versionCode 4). Worker 재배포 필요(`/sync`의 빈 앵커 삭제·지운 아이 묘비).

- **갤럭시 앱의 파일 선택기가 JSON을 막음**: `onShowFileChooser`가 늘 `image/*`로 열어 설정의 ‘JSON 가져오기’(`<input accept="application/json">`)에서 .json을 고를 수 없었다. `params.acceptTypes`를 MIME로 바꿔(`acceptedMimeTypes`, `.json` → `application/json`) 사진이면 전처럼 사진·카메라, 그 밖이면 요청한 종류를 기본으로 하되 `EXTRA_MIME_TYPES`에 `*/*`를 함께 넣어 파일 관리자가 .json을 `text/plain` 등으로 보고해도 고를 수 있게 했다(내용 검사는 웹앱 `importSets`가 한다). 선택기 제목 ‘파일 선택’. 앱에 `DownloadListener`가 없어 ‘전체 백업 JSON’ 내려받기는 앱 안에서 동작하지 않을 수 있다(실기기 미확인, 세트는 세트 동기화로 받으므로 급하지 않음).
- **시험 중 생긴 세트 변경이 늦게 올라감**: `syncSets`는 시험 중 건너뛰므로 `learnAlias`(AI가 인정한 답을 허용 답안에 추가)의 `queueSetsSync`가 다음 화면 복귀(10분 간격)나 앱 재시작까지 미뤄졌다. 시험 중의 강제 동기화 요청은 `setsSyncDeferred`로 표시만 하고, quiz.js가 완료(`complete`)·그만하기(`stopQuiz`)·쉬기(`pauseQuiz`)에서 `sessionRunning`을 끈 뒤 `notifyQuizEnded` → family.js `onQuizEnded`가 한 번 `syncSets({force:true})`를 부른다.
- **세트가 없는 아이의 수준 기준이 예제로 남음**: `anchorPayload`가 손대지 않은 기본 예제(`isUntouchedExample`)를 후보에서 빼고, 보낼 세트가 없으면 `{setName:"", words:[]}`를 보낸다. Worker `sync()`는 `words`가 빈 앵커를 받으면 저장된 `anchor`를 지우고(앵커를 아예 안 보내면 그대로), 보호자 계획 상자는 ‘수준 기준 세트가 아직 없어요’를 보인다. 옛 Worker는 빈 앵커를 빈 목록으로 저장하므로 결과는 같다(`words.length` 0).
- **서버에서 지운 아이의 기기 안내**: 기기가 `/sync`·`/sets`·`/settings`·`/daily`에서 404 `unknown_child`를 받으면 `noteChildGone`이 `family.childGone`을 켜고, 설정의 가족 기록함에 ‘보호자가 이 아이를 서버에서 지웠어요. … 새로 만든 아이 코드로 다시 연결하세요’(상태 칩 ‘서버에서 지워짐’, 연결 해제 버튼 강조 `.btn.attention`, 세트 줄 안내)를 보이며 그 뒤 기록·세트·설정·오늘의 단어 요청을 모두 멈춘다(`syncReady`·`setsSyncReady`·`fetchSettings`·`checkDaily`). 연결 해제나 재연결(`joinChild`)이 풀어 주고 그동안의 기록은 재연결 때 올라간다. `checkDaily`의 옛 ‘다시 등록’(`flushFamilySync` 재시도)은 없앴다 — 아이 코드 체계에서는 코드 없는 유령 아이만 만들었다. Worker는 `/sync`가 모르는 id를 만들던 옛 앱 호환 때문에 지운 아이가 되살아날 수 있었으므로, 아이를 지울 때 `gone:<childId>` 묘비를 남겨 그 id의 `/sync`만 404 `unknown_child`로 거절한다(모르는 새 id는 계속 만든다).
- 테스트: `tests/worker.cjs`(빈 앵커 삭제·앵커 없으면 유지, 지운 아이 `/sync`·`/settings` 404), `tests/family.cjs`(예제뿐이면 빈 앵커·동기화된 세트의 앵커와 보호자 표시, 시험 중 `/grade` 인정 → 시험 중 `/sets` 없음 → 완료 직후 전송, 지운 아이 안내·요청 중단·연결 해제·새 코드로 재연결), `tests/daily.cjs`(예제뿐이면 빈 앵커·‘아직 없어요’). 갤럭시 앱은 Actions ‘Android APK’ 빌드로 확인(실기기에서 .json 선택 확인 필요).
