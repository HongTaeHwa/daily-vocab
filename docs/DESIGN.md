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

> 2026-10-19: 이 절의 보호자 모드(아이 앱 안에서 `?mode=parent`·`isParentMode`로 화면을 바꾸던 방식)는 보호자 앱 `parent.html`로 대체됐다(24.2절). 옛 설치는 자동으로 옮겨진다.

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

## 17. 단어 찾기 — 모르는 단어를 찾고 시험으로 (2026-10-18)

배경: 공부하다 모르는 단어가 나오면 앱 밖(네이버 사전 등)으로 나가야 했고, 찾아본 단어가 어디에도 남지 않았다. 사용자 요청: 검색 → 뜻·예문·발음 → 자동 기록 → 시험 연결. 결정: 네이버 사전은 공식 API가 없고 외부 브라우저로 나가는 통로가 되므로 넣지 않고 **AI 사전만** 쓴다(사용자 확인).

- **Worker `POST /lookup {word}`**: `WORD_PATTERN` 검증, `LOOKUP_MODEL`(기본 sonnet, effort low) + `LOOKUP_SYSTEM`/`LOOKUP_SCHEMA` → `{found, en, suggestion, pos, ko, ipa, aliases, examples(≤3), similar(≤4), note}`. 뜻이 비면 `found:false`. 괄호 IPA·중복 별칭·빈 예문·비단어 similar 정리.
- **앱(sets.js, 🔍 찾기 탭 `#lookup`)**: 입력 또는 🎙 영어 인식(quiz.js `startRecognition` 재사용) → 저장된 결과(`daily_vocab_lookups_v1`, 최신순 500, 이 기기에만)가 있으면 AI를 부르지 않고 횟수만 올림 → 없으면 `/lookup`(30초) → 결과 카드(단어·품사·발음·🔊·뜻·예문·비슷한 말·메모) → `addToLookupSet`: 세트 id `lookup`(‘찾아본 단어’)에 번호 순으로 추가(허용 답안은 AI 결과, 없으면 뜻 분리), `persistSets` + `queueSetsSync`로 같은 아이의 다른 기기·보호자 폰에도. 세트가 하나도 없던 기기는 이 세트가 첫 세트가 된다. 못 찾으면 `suggestion`을 입력칸에 넣고 안내. ‘이 단어들로 시험 보기’ → `selectSet("lookup")` + 홈.
- 보호자 모드에서는 `#tabLookup`이 숨고 `showView("lookup")`은 아이들 화면으로 간다. 시험 중에는 탭 바가 숨는다. 예문은 세트 단어 형식에 없으므로 찾기 기록에만 남는다(세트 편집기로 고쳐도 사라지지 않음).
- 테스트: `tests/worker.cjs` lookup 절, `tests/ai-recognition.cjs` 찾기 흐름, `tests/family.cjs` 탭 숨김. 버전 `20261018-12`, 캐시 v21(11/v20은 같은 날 병행 작업용으로 비움). Worker 재배포 필요.

## 18. 문제 물어보기 — 문제지 사진으로 AI 선생님에게 묻기 (2026-10-18)

배경: EBS 독해·어법 복습 테스트처럼 지문·어법·요지 문제를 풀다 막히면 앱 밖에서 답을 찾아야 했다. 사용자 요청: 사진으로 묻고 AI가 도와주기. 결정(사용자 확인): **정답은 접어 두고 풀이 먼저**, **질문 요약은 보호자에게도** 보이게.

- **Worker `POST /tutor`**: `{image, mediaType, kind(explain|translate|grammar|check|ask), question?, child?:{id}}` → `TUTOR_SYSTEM`(인내심 있는 중학생 영어 선생님, 쉬운 존댓말, 답을 바로 주지 않고 단계별로) + `TUTOR_REQUESTS[kind]` + 학생 질문 → `TUTOR_SCHEMA` `{problem, summary, translation, steps, grammar, answer, checked, words, note}`. 모델 `TUTOR_MODEL`(기본 sonnet, effort medium, max_tokens 4096), 사진 8MB 상한(recognize 와 같음). 결과는 길이 제한으로 정리하고 `translation`만 줄바꿈을 보존한다.
- **질문 요약 저장**: `child.id`가 오고 FAMILY 가 있으면 Worker 가 DO `/question`에 `{id, kind, question, problem, summary, askedAt}`을 남긴다(키 `q:<childId>:<askedAt>:<id>`, 아이당 300개, 아이 항목에 `questionCount/lastQuestionAt`). 저장 실패는 답변에 영향 없음. 사진은 저장하지 않는다. `GET /family/<id>`가 `questions`(최신 100)를 돌려주고 아이 삭제 시 함께 지운다.
- **앱(sets.js, 찾기 탭 📷 카드)**: 사진 고르기/촬영(한 장, `preparePhoto`·`canvasToBase64Jpeg` 재사용) → 도움 종류 버튼(`.tutor-kinds .kind`, quiz 의 `.mode`와 분리) + 직접 질문(있고 종류가 explain 이면 `ask`) → `askTutor`(120초, 취소) → `renderTutorAnswer`: 요약·해석(있을 때)·풀이 단계·기억할 포인트·내 답 확인(있을 때)·**정답 `<details>` 접힘**·단어 후보 칩(누르면 `addToLookupSet` → ‘찾아본 단어’ 세트, 이미 있으면 ✓ 비활성)·메모. 기록은 `daily_vocab_tutor_v1`(최근 100, 기기만)에 남고 📒 물어본 문제에서 다시 볼 수 있다. 연결된 기기는 `child.id`를 보낸다.
- **보호자(family.js)**: 아이 카드에 ‘📷 물어본 문제 N개 · 마지막 …’, 상세에 📷 물어본 문제 목록(문제·종류·질문·시각·요약). 어떤 유형을 자주 묻는지 보는 용도.
- 시험 중에는 찾기 탭이 숨어 쓸 수 없다. 보호자가 끄는 스위치는 다음 단계. 테스트: `tests/worker.cjs` tutor 절(+ 질문 요약 저장·삭제), `tests/ai-recognition.cjs` 물어보기 흐름, `tests/family.cjs` 보호자 목록. 버전 `20261018-15`, 캐시 v24(13·14/v22·v23은 병행 PR #28·#29용). Worker 재배포 필요.

## 19. 전반 점검 보완 — 작은 결함 4건 (2026-10-18)

점검에서 나온 작은 결함 네 가지를 한 PR로 고쳤다. 버전 `20261018-13`, 캐시 v22(11/v20은 17절의 단어 찾기가 먼저 머지되어 건너뜀), 갤럭시 앱 v1.3(versionCode 4). Worker 재배포 필요(`/sync`의 빈 앵커 삭제·지운 아이 묘비).

- **갤럭시 앱의 파일 선택기가 JSON을 막음**: `onShowFileChooser`가 늘 `image/*`로 열어 설정의 ‘JSON 가져오기’(`<input accept="application/json">`)에서 .json을 고를 수 없었다. `params.acceptTypes`를 MIME로 바꿔(`acceptedMimeTypes`, `.json` → `application/json`) 사진이면 전처럼 사진·카메라, 그 밖이면 요청한 종류를 기본으로 하되 `EXTRA_MIME_TYPES`에 `*/*`를 함께 넣어 파일 관리자가 .json을 `text/plain` 등으로 보고해도 고를 수 있게 했다(내용 검사는 웹앱 `importSets`가 한다). 선택기 제목 ‘파일 선택’. 앱에 `DownloadListener`가 없어 ‘전체 백업 JSON’ 내려받기는 앱 안에서 동작하지 않을 수 있다(실기기 미확인, 세트는 세트 동기화로 받으므로 급하지 않음) → 23절(앱 v1.4)에서 해결.
- **시험 중 생긴 세트 변경이 늦게 올라감**: `syncSets`는 시험 중 건너뛰므로 `learnAlias`(AI가 인정한 답을 허용 답안에 추가)의 `queueSetsSync`가 다음 화면 복귀(10분 간격)나 앱 재시작까지 미뤄졌다. 시험 중의 강제 동기화 요청은 `setsSyncDeferred`로 표시만 하고, quiz.js가 완료(`complete`)·그만하기(`stopQuiz`)·쉬기(`pauseQuiz`)에서 `sessionRunning`을 끈 뒤 `notifyQuizEnded` → family.js `onQuizEnded`가 한 번 `syncSets({force:true})`를 부른다.
- **세트가 없는 아이의 수준 기준이 예제로 남음**: `anchorPayload`가 손대지 않은 기본 예제(`isUntouchedExample`)를 후보에서 빼고, 보낼 세트가 없으면 `{setName:"", words:[]}`를 보낸다. Worker `sync()`는 `words`가 빈 앵커를 받으면 저장된 `anchor`를 지우고(앵커를 아예 안 보내면 그대로), 보호자 계획 상자는 ‘수준 기준 세트가 아직 없어요’를 보인다. 옛 Worker는 빈 앵커를 빈 목록으로 저장하므로 결과는 같다(`words.length` 0).
- **서버에서 지운 아이의 기기 안내**: 기기가 `/sync`·`/sets`·`/settings`·`/daily`에서 404 `unknown_child`를 받으면 `noteChildGone`이 `family.childGone`을 켜고, 설정의 가족 기록함에 ‘보호자가 이 아이를 서버에서 지웠어요. … 새로 만든 아이 코드로 다시 연결하세요’(상태 칩 ‘서버에서 지워짐’, 연결 해제 버튼 강조 `.btn.attention`, 세트 줄 안내)를 보이며 그 뒤 기록·세트·설정·오늘의 단어 요청을 모두 멈춘다(`syncReady`·`setsSyncReady`·`fetchSettings`·`checkDaily`). 연결 해제나 재연결(`joinChild`)이 풀어 주고 그동안의 기록은 재연결 때 올라간다. `checkDaily`의 옛 ‘다시 등록’(`flushFamilySync` 재시도)은 없앴다 — 아이 코드 체계에서는 코드 없는 유령 아이만 만들었다. Worker는 `/sync`가 모르는 id를 만들던 옛 앱 호환 때문에 지운 아이가 되살아날 수 있었으므로, 아이를 지울 때 `gone:<childId>` 묘비를 남겨 그 id의 `/sync`만 404 `unknown_child`로 거절한다(모르는 새 id는 계속 만든다).
- 테스트: `tests/worker.cjs`(빈 앵커 삭제·앵커 없으면 유지, 지운 아이 `/sync`·`/settings` 404), `tests/family.cjs`(예제뿐이면 빈 앵커·동기화된 세트의 앵커와 보호자 표시, 시험 중 `/grade` 인정 → 시험 중 `/sets` 없음 → 완료 직후 전송, 지운 아이 안내·요청 중단·연결 해제·새 코드로 재연결), `tests/daily.cjs`(예제뿐이면 빈 앵커·‘아직 없어요’). 갤럭시 앱은 Actions ‘Android APK’ 빌드로 확인(실기기에서 .json 선택 확인 필요).

## 20. 기록 복원 — 새 기기·재설치 뒤 기록 탭 채우기 (2026-10-18)

배경: 2026-10-18 갤럭시 앱을 다시 설치하면서 기기 안 자료가 사라졌다. 세트는 아이 단위 동기화(15절)로 돌아오지만 시험 기록은 원본이 기기(`daily_vocab_history_v2`)에만 있고 서버에는 압축 사본(점수·틀린 단어)만 있어 기록 탭이 비었다. 사용자가 ‘서버 사본으로 기록 복원’을 요청.

- **Worker** (`FamilyStore.records`): `GET /records/<childId>?since=<ISO>&limit=<n>`(가족 코드, kind `records`, 요청 제한 버킷 `/records`). `since`가 있으면 `rec:<childId>:<since>`부터(포함) 오름차순 `limit`개, 없으면 최신순 `limit`개(최대 500, `limit+1`개를 읽어 `more` 판단). 응답 `{records:[압축 기록 + receivedAt], more, serverTime}`. 보호자 전용 `/family`와 달리 아이 기기가 자기 기록만 읽는다. 잘못된 `since`는 400, 모르는 아이는 404 `unknown_child`.
- **요약 기록 형식**(quiz.js `validRecord`): 압축 기록에는 단어별 결과가 없으므로 `results`에는 틀린 단어만 `{id, word, pass:false, unknown}`으로 두고(비어 있을 수 있음) 점수는 `total/correct` 필드에, `restored: true`·`restoredAt`을 붙인다. `recordScore`가 `restored`면 `total/correct`를 쓰므로 기록 탭·홈 최근 결과·세트 요약·CSV(‘비고: 서버에서 복원’)가 그대로 동작하고, 틀린 단어 목록·‘이 시험의 틀린 단어 다시 풀기’는 `results`로 그대로 된다. (가) results 없는 형식 대신 이 하이브리드를 고른 이유: 기록을 읽는 코드 대부분이 `results`를 틀린 단어 목록으로만 쓰고 점수 계산은 `recordScore` 한 곳이라 바꿀 곳이 적고, 옛 앱이 읽어도(틀린 단어가 있으면) 걸러내지 않는다.
- **아이 기기** (`family.js` `restoreRecords`): 연결 직후 `Promise.all([flushFamilySync, syncSets])` 뒤(기록을 올리고 세트를 받은 뒤라 이름이 같은 세트에 `setId`를 연결하고 틀린 단어를 세트 단어로 보강할 수 있다), 앱 시작 때 `syncSets` 뒤 자동(기록이 비어 있고 `family.restoreCheckedAt`이 없을 때만 — 재설치·새 기기), 설정의 ‘☁️ 서버 기록 다시 가져오기’(force). `since`를 epoch에서 시작해 마지막 `completedAt`으로 넘기며 최대 10페이지(5,000개), 기기에 있는 id는 건너뛴다(앞 페이지와 겹치는 같은 시각 기록도 id로 걸러짐). 받은 것이 있으면 `persistHistory`(최신순 정렬)·기록 탭 상태 ‘기록 N개를 서버에서 가져왔어요’. 오늘의 단어 기록은 `setId: daily:<date>`, 세트를 못 찾으면 `restored:<세트 이름>`(‘전체 세트’에서만 보임). 세트별 오답 키(`daily_vocab_missed_*`)는 건드리지 않는다. 시험 중에는 건너뛴다.
- **다시 보내지 않기**: `localRecordIds()`(`restored` 제외)를 `joinChild`·`saveFamily`의 pending 에 쓰고 `flushFamilySync`가 pending 을 `!r.restored`로 걸러 복원 기록이 `/sync`로 돌아가지 않는다. (2026-10-20: `localRecordIds`는 기록의 주인을 보는 `claimRecords`·`sendableHere`로 바뀌었다 — 27절.)
- **기록 전체 삭제와의 관계**: 기존 원칙(기기 기록만 지우고 서버 사본은 남음) 유지. 삭제 뒤 `noteHistoryCleared`가 `restoreCheckedAt`을 찍어 다음 실행 때 자동 복원으로 되살리지 않는다(확인 문구에 ‘서버 기록 다시 가져오기로 되살릴 수 있어요’ 안내). 연결 해제·아이 바꾸기 때 `restoreCheckedAt`·`restoreError` 초기화.
- **백업 JSON**: 내보내기에 복원 기록도 들어간다. 가져오기(sets.js)는 보통 기록에 새 id를 주지만 복원 기록은 id를 그대로 두고 이미 있으면 건너뛰어, 가져온 뒤 다시 복원해도 같은 시험이 두 번 생기지 않는다.
- **화면**: 기록 항목 메타 줄에 ‘☁️ 서버에서 복원’(2026-10-20부터 ‘☁️ 다른 기기’, 26절), 설정 → 가족 기록함 `#restoreText`(‘기록 N개 복원 (서버 사본: 점수·틀린 단어) · 마지막 확인 HH:MM’ / 가져오는 중 / 오류 / 삭제 뒤 안내)와 `#restoreRecords` 버튼. 기록 탭 안내문에 복원 설명 추가.
- 테스트: `tests/worker.cjs` 기록 복원 절, `tests/family.cjs`(연결 직후 복원·기록 탭·다시 풀기·수동 복원 페이지 넘김·전체 삭제 뒤 자동 복원 없음), `tests/browser.cjs`(복원 기록 형식 유지·백업 왕복), `tests/daily.cjs` 가짜 Worker에 `/records`. 버전 `20261018-13`, 캐시 v22(단어 찾기 PR #27의 12/v21 다음). Worker 재배포 필요(`/records`).

## 21. 종합 시험 — 여러 세트 묶어 보기 (2026-10-18)

배경: 시험은 세트(챕터) 하나 안의 범위만 고를 수 있었다. 사용자 요청: 전체 또는 일부 세트를 묶은 시험.

- **UI**: 홈 세트 카드 아래 `#comboCard`(세트 2개 이상일 때만 보임) → `<details>` 안에 세트 체크 목록(기본 전체), 문제 수(10·20·30·50·전부), 뽑는 방법(무작위·틀린 단어 먼저·세트별 골고루), 시작. 시험 방식·순서 섞기는 기존 카드 값. 마지막 선택은 `prefs.combo`(전부면 `setIds: null` → 나중에 생긴 세트도 포함).
- **뽑기** `buildComboPool`: 단어마다 `_setId`를 붙인다(세트끼리 번호가 겹칠 수 있음). 틀린 단어 먼저는 각 세트의 `daily_vocab_missed_<id>`에 있는 단어를 앞에, 골고루는 세트를 번갈아. 뽑은 순서를 지키려고 `newSession(..., {shuffle:false, combo})`.
- **기록**: `setId: "combo"`, `setName: "종합 시험 (세트 N개)"`, `range: "세트 N개 · M문제 · 방법"`. 기록 탭 ‘전체 세트’에 보이고 보호자에게도 같은 이름. `finishRecords`는 출처 세트별로 오답 목록을 갱신(그 세트에서 이번에 푼 단어는 결과대로, 안 푼 단어는 유지 — 부분 시험이므로 교체가 아니라 병합). `againSame`은 `sessionMeta.combo`로 같은 설정으로 다시 뽑는다. `learnAlias`는 `_setId`의 세트에 학습한다. 쉬기·이어서는 큐를 저장하므로 그대로 동작.
- Worker 변경 없음. 테스트 `tests/session.cjs`. 버전 `20261018-18`, 캐시 v27.

## 22. 세트 수정 잠금 — 아이 기기에서는 단어 보기만 (2026-10-19)

배경: 세트 동기화로 아이가 기기에서 고친 세트도 서버와 보호자 폰에 올라간다. 아이가 뜻·허용 답안을 고치거나 단어·세트를 지우면(부정행위·실수) 그대로 퍼지므로, 보호자가 세트 관리를 자기 폰으로 묶어 둘 수 있어야 한다.

- **설정 경로**: 제한 시간과 같은 길. 보호자가 아이 상세 📚 세트 상자의 체크박스 `#setsLock`을 바꾸면 즉시 `POST /family/<id>/plan {setsLocked}`(boolean, `parsePlan`이 다른 항목은 유지). 아이 기기는 `GET /settings/<childId>`·`POST /join` 응답(`deviceSettingsOf`)의 `setsLocked`를 `daily_vocab_family_v1.settings.setsLocked`에 둔다. 앱을 열 때·화면 복귀 10분 간격으로 받으므로 바꾼 값은 다음에 앱을 열 때부터 적용된다.
- **아이 기기**: `childSetsLocked()`(연결된 기기만) → `applySetsLock()`이 홈의 `#createSet`과 설정의 JSON 가져오기(`#importSetsLabel`)를 숨기고 `#editSet`을 ‘📖 단어 보기’로 바꾸며 `#setsLockNote`를 보인다. 편집기는 새 뷰 없이 같은 화면을 읽기 전용으로 연다(`openEditor` → `editorReadOnly`·`applyEditorReadOnly`: 사진 줄·AI 채우기·단어 추가·텍스트 편집·확인란·저장·관리 상자 숨김, 이름·칸·텍스트 readonly, ✕ 없음). 편집 중에 잠금이 도착해도 저장·이름 바꾸기·삭제·가져오기는 `setsLockedNow()`로 거절한다. 연결 해제 때 `settings`가 초기화되어 풀린다.
- **바뀌지 않는 것**: 찾기 탭의 ‘찾아본 단어’ 세트 추가, AI 2차 채점의 허용 답안 학습(`learnAlias`), 서버에서 받은 세트 반영, 손대지 않은 예제 제거. 연결되지 않은 기기와 보호자 모드(`editorForChild`)는 영향 없음.
- **서버에서 막지 않는 이유**: `/sets` 업로드에는 위의 자동 변경도 섞여 오고 서버는 아이가 손으로 고친 것과 구분할 수 없다. 아이폰·태블릿에서 아이가 UI를 우회할 현실적 방법이 없어 UI 잠금으로 둔다. 필요해지면 잠긴 아이의 묘비(삭제)와 `lookup` 외 새 세트만 서버가 거절하는 보강이 가능하다.
- 테스트 `tests/worker.cjs`(plan 검증·`/settings`·`/join`), `tests/daily.cjs`(보호자 체크 → 아이 기기 반영 → 해제). 버전 `20261018-19`, 캐시 v28. Worker 재배포 필요(`parsePlan`·`settings`).

## 23. 갤럭시 앱 파일 내려받기 — 백업 JSON·CSV를 앱 안에서 (2026-10-19, 앱 v1.4)

배경: 19절에서 파일 선택기를 고치며 남긴 항목. 웹앱의 ‘전체 백업 JSON’(sets.js `download`)과 ‘CSV 내려받기’(quiz.js `exportHistory`)는 `Blob` → `URL.createObjectURL` → DOM에 붙이지 않은 `<a download>` → `click()` → 1초 뒤 `revokeObjectURL`로 파일을 만든다. Android WebView는 이 흐름을 처리하지 못한다: `DownloadListener`를 달아도 `blob:https://…` 문자열만 받고 내용은 렌더러 안에 있어 네이티브가 읽을 수 없고, 달지 않으면 아무 일도 없다. 재설치 전 백업(android/README ‘업데이트’)이 앱 안에서 안 되는 셈이라 고쳤다. 원칙은 그대로: 웹앱 코드는 바꾸지 않고 `bridge.js`가 채운다.

- **`bridge.js`(문서 시작 스크립트, 음성 어댑터 옆)**: `URL.createObjectURL`/`revokeObjectURL`을 감싸 blob: 주소 → Blob 표를 두어 1초 뒤 revoke와 경쟁하지 않는다. `HTMLAnchorElement.prototype.click`을 덮어써 `download` 속성이 있고 href가 blob:/data:면 페이지 이동 대신 Blob을 `FileReader.readAsDataURL`로 읽어 base64를 `AndroidDownload.begin(이름, MIME, 길이)` → `append(token, 512KB 조각)` → `finish(token)`으로 넘긴다(조각으로 나누는 이유: 백업 JSON이 수 MB가 될 수 있어서. 조각 길이가 4의 배수라 따로 디코딩된다). 사용자가 직접 누르는 `<a download>`도 capture 단계 click 리스너가 같은 길로 보낸다. 표에 없으면(다른 경로의 blob:, data:) `fetch`로 Blob을 얻는다. `window.__dailyVocabDownload(url, name)`은 `DownloadListener` 폴백용.
- **`DownloadBridge.kt`(`@JavascriptInterface AndroidDownload`)**: 조각을 모아(상한 50MB) Android 10 이상은 MediaStore Downloads(`RELATIVE_PATH` Download, 쓰는 동안 `IS_PENDING`)에 저장 → 토스트 ‘다운로드 폴더에 저장했어요: 파일 이름’. 권한이 필요 없고 같은 이름은 OS가 ‘(1)’을 붙인다. MIME은 확장자에서 다시 구한다(`.csv`의 `text/csv;charset=utf-8`처럼 파라미터가 붙은 종류를 MediaStore가 받지 않고, 확장자와 MIME이 어긋나면 이름을 바꾸거나 거절해서). CSV의 BOM은 base64로 바이트 그대로 가므로 엑셀에서 한글이 유지된다. 파일 이름은 경로 구분자·제어 문자만 치환(한글 유지). Android 8·9와 MediaStore 실패 시에는 `MainActivity.saveWithDialog` → 시스템 ‘다른 이름으로 저장’(`ACTION_CREATE_DOCUMENT`, 기본 위치 다운로드) → 받은 uri에 쓰기(`"wt"` 뒤 `"w"`). 저장 권한은 어느 경로에도 필요 없다.
- **`MainActivity`의 `DownloadListener`**: 어댑터가 click 단계에서 가로채므로 보통 오지 않지만, blob:/data: 주소가 오면(어댑터를 거치지 않은 미래 경로) `__dailyVocabDownload`로 되돌리고 http(s)는 바깥 링크처럼 브라우저(`ACTION_VIEW`)로 보낸다. `DownloadManager`는 Android 8·9에서 저장 권한이 필요하고 앱에 http 내려받기가 없어 쓰지 않았다.
- **고려한 대안**: 항상 ‘다른 이름으로 저장’ 대화상자(경로 하나, 위치 선택 가능, 매번 한 번 더 누름) 대신 Chrome과 같은 ‘조용히 다운로드 폴더 + 토스트’를 택했다(사용자 확인). `DownloadListener`에서 `evaluateJavascript`로 blob을 fetch하는 흔한 방법은 1초 뒤 revoke와 경쟁하고 파일 이름 정보가 없어 쓰지 않았다.
- 웹앱·Worker 변경 없음(앱 셸 버전 그대로). 앱 versionCode 5 / 1.4(UA `DailyVocabApp/1.4`), 문자열 `download_saved`·`download_saved_as`·`download_failed`. 확인은 Actions ‘Android APK’ 빌드 + 실기기(설정 → 전체 백업 JSON, 기록 탭 → CSV 내려받기 → 내 파일 → 다운로드에 파일이 생기는지, 엑셀로 CSV 한글 확인). 인터페이스(begin/append/finish/abort)를 바꾸면 `bridge.js`와 `DownloadBridge.kt`를 함께 고친다.

## 24. 보호자 앱 전면 개편 (2026-10-19 설계)

분석·문제점·목표 아키텍처·단계별 계획은 `docs/PARENT_REDESIGN.md`. 요지: `parent.html`을 보호자 앱 자체로 분리하고 `shared.js`·`editor.js`를 두 앱이 공유, 오늘·아이들·설정 3탭 + 아이별 하위 탭, 해시 라우터, 단일 상태 저장소 + 캐시 우선, Worker 기록 페이지 읽기. 구현은 A(공통 모듈 분리) → B(보호자 앱 새로 쓰기, 아이 앱에서 보호자 모드 제거) → C(Worker 보강·행동 기능) 순서의 PR.

### 24.1 A단계 완료 — 공통 모듈 분리 (2026-10-19)

동작 변화 없이 두 앱이 함께 쓸 코드를 떼어 냈다. 로드 순서 `shared.js → quiz.js → family.js → editor.js → sets.js`. 버전 `20261018-20`, 캐시 v29. Worker 변경 없음.

- **`shared.js`** (`window.Shared`, 상태 없음): `$`, `h(tag, attrs, ...children)`, `setFeedback`, `tidy formatCode hourLabel relativeTime durationText dayKey pctOf WEEKDAYS modeLabels`, `AI_SERVER_DEFAULT normalizeServer WORD_PATTERN PLAN_LEVELS TIME_LIMIT_CHOICES planDefaults`, `parseDraft`, `preparePhoto`/`canvasToBase64Jpeg`, `apiRequest(server, path, {method, body, passcode, timeout, signal})`(오류 `ApiError{status, code, message}`)·`describeApiError({status, code, message, path})`, `readJson/writeJson`. 기존 전역 이름은 각 파일 머리의 별칭으로 남겨 호출부·테스트가 그대로다. family.js `familyRequest`는 `Shared.apiRequest`를 감싼 한 줄.
- **`editor.js`** (`window.SetEditor`): `mount(host, {ai, onSave, onClose, onRename?, onDelete?, guard?, onNeedAi?})`, `open(set|null, {readOnly, readOnlyText, title, targetName}) → boolean`, `close`, `isOpen`, `isDirty`, `confirmDiscard`, `setStatus`, `setWarning`, `lockSave`. 편집기 DOM(예전과 같은 ID·클래스·문구)을 모듈이 만들고 `index.html`에는 빈 `<section id="editor">`만 남았다. 표/텍스트 동기화·사진·순차 인식·`startOperation`·빈 뜻 AI 채우기·`.ai-filled`·검증·관리 상자·읽기 전용(9·15·22절)이 모두 모듈 안에 있다.
- **`sets.js`**: `SetEditor.mount($("editor"), {ai: aiBridge, guard, onSave, onClose, onRename, onDelete, onNeedAi})`와 기기 저장 콜백(`keepWordDetails`·`saveSetLocally`·`renameSetLocally`·`deleteSetLocally`), `openEditor` 래퍼만 남았다(1,428 → 약 810행). 보호자 분기(`editorForChild` → `sendSetToChild`/`returnToChild`)는 콜백으로 감싸 그대로 두었고 B단계에서 걷어 낸다.
- **테스트**: `tests/lib/fake-family-worker.cjs`(`createFakeWorker`)를 `family.cjs`·`daily.cjs`가 함께 쓴다. 검증 내용·순서는 그대로.
- 설계와 다르게 한 결정(편집기를 기존 `#editor` 섹션에 붙임, `ai`를 함수로도 받음, `guard`·`onNeedAi` 옵션, 사진 도우미를 `Shared`에 둠 등)은 `docs/PARENT_REDESIGN.md` 5.2·5.3·5.10의 ‘결정 변경’.

### 24.2 B단계 완료 — 보호자 앱 새로 쓰기 (2026-10-19)

보호자 앱을 아이 앱의 ‘모드’에서 떼어 `parent.html` 자체를 보호자 앱으로 만들었다(PR #36). 릴리스 `20261018-21`, 캐시 v30. Worker 변경 없음(재배포 불필요).

- **페이지·코드**: `parent.html`(상단 바·뷰 섹션 6개 `#setup #today #children #child #editor #settings`·하단 탭 3개·토스트·부트스트랩) + `parent.css`(공통 토큰·편집기 규칙은 index.html 에서 복사, 두 앱 CSS는 합치지 않음) + `parent.js`(약 1,350행, 전역 `window.ParentApp`). 로드 순서 `shared.js → editor.js → parent.js`. 아이 앱 코드(quiz.js·family.js·sets.js)는 싣지 않는다.
- **구조(5.4)**: 저장 키 `daily_vocab_parent_v1` 하나 + `migrate()`(키가 없을 때 1회: `daily_vocab_family_v1.parentCode`, `daily_vocab_ai_v2.server`, `daily_vocab_family_cache_v1.children` → 옛 캐시·`daily_vocab_mode_v1` 삭제, 아이 키에서는 `parentCode`·`parentModeOff`만 제거), `createStore`(patch 마다 저장·다시 그리기, 1MB 넘으면 오래 본 아이 상세부터 저장 제외), `putChild`(목록·상세 동시 갱신), `api`(`Shared.apiRequest` + 보호자 코드), 해시 라우터(`#/`·`#/children`·`#/child/<id>/<탭>`·`#/child/<id>/sets/<new|id>`·`#/settings`·`#/setup`, 코드 없으면 `#/setup`, `history.state.idx`로 앱 안에서만 되돌아가기, 하위 탭은 history 를 늘리지 않음, 편집기를 떠날 때 미저장 확인), `computeStats` 순수 함수, 캐시 우선 자동 갱신(시작·화면 복귀·온라인 복귀·라우트 진입 때 10분 경과 시).
- **화면(5.5)**: 오늘(아이마다 카드 1장 — 오늘 횟수·평균·🔥 연속·오늘의 단어·⚠️/⏱/📷·7일 띠·이번 주 vs 지난주 ▲▼, 기기 없는 아이는 코드·링크 복사), 아이들(목록·아이 추가 → 그 아이 설정 탭), 아이 화면 하위 탭 5개(기록: 요약 띠·자주 틀린 단어·세트/기간 필터·날짜별 기록 / 세트: 행 통계·보기·수정·삭제·보내기·🔒 잠금 즉시 저장 / 오늘의 단어: 계획 폼·지금 만들기·미리보기 / 설정: 코드·링크·기기·이름·⏱ 제한 시간 즉시 저장·이름 확인 2단계 삭제 / 질문), 설정(코드 바꾸기·삭제, 고급 서버 주소, 🔔 알림 자리, 아이용 앱 열기·설치 안내, 앱 정보), 코드 입력(확인 뒤에만 저장, 설치 안내 접힘). 결과 문구는 토스트 + 칸 아래 문구(아이별 기억).
- **데이터**: Worker 의 `GET /family/<id>`가 아직 전체 기록을 주므로 최신 200개만 캐시·표시하고 ‘전체 N회 중 최근 200개’를 알린다. 통계는 그 안(30일 창)에서 계산. 코드 입력 → 오늘 카드까지 요청은 `GET /family` 1회.
- **아이 앱 정리(5.8)**: `index.html`에서 `#family` 뷰·`#tabFamily`·`#parentBox`·`#parentModeRow`·`.child-only`·보호자 CSS 제거, `quiz.js` `showView` 보호자 분기 제거, `family.js` 보호자 대시보드·모드 판정 약 840행 제거(1,671 → 834행), `sets.js` `editorForChild` 분기·`aiConfig`의 보호자 코드 대체 제거. 남은 `parentCode`·`parentModeOff`는 `initFamily`가 지운다.
- **호환**: `index.html` `<head>`의 동기 스크립트가 `?mode=parent`, `daily_vocab_mode_v1 === "parent"`, 보호자 코드만 있고 아이로 연결되지 않은 기기를 `location.replace("./parent.html")`로 옮기고 `document.write('<plaintext>')`로 나머지 문서를 읽지 않는다(아이 앱 스크립트가 옛 코드를 지우기 전에 보호자 앱이 이전). `?mode=child`는 기억한 모드를 지운다. `manifest-parent.webmanifest`의 `start_url`은 `/daily-vocab/parent.html`.
- **서비스워커**: SHELL 에 `parent.js`·`parent.css` 추가, 오프라인 내비게이션은 경로가 `parent.html`이면 보호자 앱 셸.
- **테스트**: `tests/parent.cjs`·`tests/parent-sets.cjs` 신설(가짜 Worker 공용, `/recognize`·`/define` 추가), `family.cjs`·`daily.cjs`는 아이 기기 흐름만(보호자가 보낸 세트·계획은 가짜 Worker 에 직접 심음), `pwa.cjs`에 보호자 앱 오프라인 셸·모든 화면 3가지 폭·매니페스트, `app-update.cjs`에 보호자 앱 버전·자원. 11개 PASS.
- 설계와 다르게 한 결정은 `docs/PARENT_REDESIGN.md` 5.4·5.5·5.8·5.10의 ‘결정 변경(2026-10-19, B단계 구현)’.

### 24.3 C단계 완료 — Worker 보강과 보호자 행동 기능 (2026-10-19)

상세가 아이의 전체 기록을 받던 문제(D1)를 Worker 에서 고치고, ‘보기’에서 끝나던 보호자 화면을 ‘세트 보내기·수준 바꾸기’로 잇는다(U4). PR #37. 릴리스 `20261018-22`, 캐시 v31. **Worker 재배포 필요**(`cd worker && npm run deploy`; 새 Worker 는 옛 보호자 앱과도, 앱은 옛 Worker 와도 호환).

- **Worker(5.7)**: `GET /family/<id>?days=<1~365, 기본 30>&limit=<1~500, 기본 200>` — 기록을 최근 days일 안에서 최신순 limit개로 줄이고 `recordCount`(전체 기록 수)·`more`(보낸 것보다 오래된 기록이 있음: 창 안이 limit를 넘거나 창 앞에 기록이 하나라도 있음)를 붙인다. 질문·오늘·plan 은 그대로. `GET /family/<id>/records?before=<ISO>&limit=<1~500, 기본 100>`(보호자 코드, `FamilyStore.olderRecords`) — `storage.list({prefix, end: prefix + before, reverse, limit})`로 before 미포함 최신순 `{records, more, serverTime}`, before 가 없으면 최신부터. `GET /family?days=1~30`(기본 14 유지)도 받는다. 범위 밖·숫자가 아닌 인자는 400(`intParam`). 코드 역할(`/family…` 보호자 코드만, 새 경로는 kind `view`)·요청 제한 버킷(`/family`)·아이 기기 복원 경로 `GET /records/<id>`·5,000개 상한·`unknown_child`/`not_found` 구분은 그대로.
- **정확한 기록 수**: `recordCount`는 다시 보낸 기록까지 세던 대략값이었다(연결 해제 뒤 재연결이면 두 배). `/sync`가 받은 키를 `storage.get(keys)`로 확인해 새 키만 더하고, 이 규칙 전의 아이는 상세를 처음 볼 때 `child()`가 한 번 실제로 세어 `recordCountExact: true`로 기억한다(5,000개 정리 때도 정확한 값). 기록 5,000개 아이의 상세 첫 응답은 200개 이하(`tests/worker.cjs`).
- **보호자 앱 기록 탭**: 상세를 `?days=30&limit=200`으로 받아 `details[id] = {records, recordTotal(= recordCount), more, …}`. ‘전체 시험 N회’는 `recordTotal`. 맨 아래 **⬇ 이전 기록 더 보기**(`#loadMoreRecords`) → `loadMoreRecords`가 목록(상세+옛 페이지+목록 합침)의 마지막 `completedAt`을 before 로 100개씩 받아 세션 Map `olderPages`에 붙이고(저장 안 함), 누르면 기간 필터가 ‘전체’로 바뀐다. 버튼은 서버가 더 있다고 했고 받은 수가 전체보다 적을 때만 보인다. 상세를 새로 받으면 옛 페이지는 버린다(창이 옮겨 가 빈틈이 생기지 않게).
- **옛 Worker 호환**: Pages 는 머지 즉시, Worker 는 따로 배포되므로 옛 Worker(인자를 무시하고 전체 기록, `recordCount`·`more` 없음)에서는 최신 200개만 캐시하고 받은 개수를 전체로 삼으며 ‘더 보기’를 숨긴다. ‘더 보기’ 경로가 404 `not_found`면 토스트 없이 버튼만 숨긴다(`tests/parent.cjs`의 `pagedDetail: false`·`setMode("notfound")` 시나리오).
- **틀린 단어로 복습 세트**: 📉 자주 틀린 단어 칩을 눌러 고르고(기본 전부, `aria-pressed`, ‘N개 골랐어요’) **📚 이 단어들로 복습 세트 보내기**(`#sendMissedSet`) → `sendMissedAsSet` → `{id: UUID, name: "복습 M/D"(겹치면 "(2)"…), words: [{id: 1…n, en, ko(기록의 뜻), aliases: [], ipa: ""}]}`를 `POST /family/<id>/sets` → `patchChild({sets: summary})` → 토스트 “‘복습 M/D’ N단어를 N에게 보냈어요” → 세트 탭. 뜻이 기록되지 않은 단어는 빼고 알린다(전부 없으면 보내지 않음). 세트 동기화로 아이의 모든 기기에 들어간다.
- **오늘의 단어 → 세트**: 미리보기 아래 **📚 세트로 저장해 보내기**(`#saveDailyAsSet`, 오늘 것이 있을 때만) → ‘오늘의 단어 M/D’(그날 날짜) 세트, 단어는 `{id, en, ko, ipa, aliases}`. 기록의 `daily` 시험과는 무관하다.
- **수준 제안(2C, 5.11)**: 순수 함수 `suggestLevel(stats, plan, levels)`(`ParentApp`에 노출) — 이번 주·지난주 각각 3회 이상, 두 주 평균 모두 90점 이상, 최근 2주 틀린 단어 5개 이하면 `PLAN_LEVELS`의 다음 단계, 두 주 평균이 모두 60점 미만이면 한 단계 아래. 직접 입력 수준·끝 단계·한 주라도 기록이 없으면 없음. 오늘의 단어 탭 위 카드(`#levelSuggest`)가 “최근 2주 평균 N점이에요. 수준을 ‘…’로 올려(낮춰) 볼까요?”와 이유를 보이고, **적용**은 `savePlan({level})`만(켜기·개수·시각 불변, 꺼져 있으면 꺼진 채), **다음에**는 저장 없이 숨긴다. 둘 다 `prefs.levelSuggestDismissed[id] = 오늘`로 7일 동안 다시 묻지 않는다(적용 직후 같은 점수로 또 올리자고 하지 않게). 자동 변경은 없다.
- **다듬기**: 세트 탭의 ‘보기·수정’·‘삭제’를 `.set-actions` 묶음으로 한 줄에.
- **테스트**: `tests/worker.cjs`(상세 창·인자 검증·`recordCount`·`more`·5,000개 아이 첫 응답 200개 이하·‘더 보기’ 페이지로 5,000개 끝까지 겹침 없이·before 미포함·보호자 코드만·버킷·`GET /family?days`·옛 대략값 다시 세기), 가짜 Worker(`pagedDetail`·`detailPageSize`, 목록 14일 창), `tests/parent.cjs`(상세 인자, 복습 세트 본문·이름 (2)·세트 탭, 오늘의 단어 세트 본문, 규칙 11가지, 카드 적용·7일 숨김·8일 뒤 다음 단계·다음에, 기록 27개 아이의 ‘더 보기’ 페이지·404 조용히·끝나면 숨김, 뜻 없는 단어, 옛 Worker 203개 → 200개·버튼 없음). 11개 PASS.
- 설계와 다르게 한 결정은 `docs/PARENT_REDESIGN.md` 5.4·5.7·5.10·5.11의 ‘결정 변경(2026-10-19, C단계 구현)’.

## 25. 알림(2B) — 아이 기기 리마인더와 보호자 알림 (2026-10-19 설계)

설계는 `docs/NOTIFICATIONS.md`. 요지: Worker가 Web Push(VAPID + aes128gcm, WebCrypto만)로 아이 기기에 📬 오늘의 단어 도착·✏️ 공부 리마인더(보호자가 정한 `plan.remindHour`)를, 보호자 폰에 🧒 시험 마침(`/sync` 직후)·🌙 저녁 요약(`summaryHour`)을 보내고 `sw.js`가 띄운다. 아이폰은 홈 화면에 설치한 앱에서만, 갤럭시 래퍼 앱은 Web Push가 없어 로컬 알림(N2, v1.5)으로 같은 두 가지를 띄운다. 구현은 N1(Worker 푸시 기반 + sw.js + 두 앱 UI) → N2(android/) 순서의 PR.

### 25.1 N1 완료 — Worker Web Push 기반 + 서비스워커 + 두 앱 알림 UI (2026-10-19)

릴리스 `20261018-23`, 캐시 v32. **Worker 재배포와 VAPID 키 등록 필요**(`cd worker && npm run vapid` → `npx wrangler secret put VAPID_PRIVATE_KEY` → `wrangler.jsonc`의 `VAPID_PUBLIC_KEY` 채우기 → `npm run deploy`). 키가 없는 Worker 에서는 `/push/…`가 503 `push_unconfigured`이고 앱은 안내만 하며 다른 기능은 그대로다.

- **Worker**: `GET /push/key`, `POST /push/subscribe·unsubscribe·test`(아이 구독은 가족 코드, 보호자 구독은 보호자 코드만, 버킷 `/push`), 구독 키 `push:child:<childId>:<deviceId>`·`push:parent:<deviceId>`, `sendPush`(VAPID ES256 JWT + RFC 8291 aes128gcm, WebCrypto 만, RELAY 안 씀) → `deliver`(404·410 삭제, 5회 연속 실패 삭제, 로그엔 상태 코드만). 트리거: `daily`(크론·보호자 ‘지금 만들기’로 만든 직후, `origin`은 Worker 가 코드 역할로 정함), `reminder`(`plan.remindHour` 시각에 그날 완료 기록이 없으면), `finish`(`/sync`의 새 완료 기록, 6시간 안, 한 번에 3개 이하), `summary`(보호자 기기의 `summaryHour`), 하루 1번 표시 `sent:`(3일 뒤 크론이 정리). `plan.remindHour`(null|0~23), `/settings`·`/join`에 `dailyEnabled, dailyHour, remindHour`. 아이 삭제 때 구독·표시도 삭제.
- **sw.js**: `push`(→ `showNotification`, 보호자 알림은 보호자 아이콘)·`notificationclick`(같은 앱 창이 있으면 focus + `navigate` 메시지, 없으면 새 창).
- **shared.js**: `Shared.notify`(`support`·`permission`·`request`·`subscribe`·`current`·`unsubscribe`·`native`, 테스트 훅 `window.__dailyVocabPushImpl`), `deviceLabel`, `REMIND_HOUR_CHOICES`.
- **아이 앱**: 설정 → 가족 기록함 `#notifyBox`(‘🔔 이 기기에서 알림 받기’ 하나, 상태 ‘🔔 알림 켜짐 · 오늘의 단어 도착 · 공부 알림 오후 8시’). Web Push 구독 또는 갤럭시 브리지(`window.DailyVocabNotify`가 있으면 `schedule`·완료 뒤 `skipToday`·`cancel`), 설정을 받을 때마다 구독 확인·재등록, 연결 해제·지워진 아이 때 정리. `family.push`, `settings` 확장(백업 제외).
- **보호자 앱**: ⚙️ 설정 🔔 카드(이 폰에서 받기·시험 마침·저녁 요약 18~23시·테스트 알림, `prefs.push`·`prefs.deviceId`, 코드 삭제 때 해지), 아이 설정 탭 ⏰ 공부 알림 시각(`#planRemindHour`, 즉시 저장).
- **테스트**: `tests/worker.cjs`가 가짜 푸시 서비스로 받은 요청의 VAPID JWT 를 공개 키로 검증하고 본문을 RFC 8291로 복호화한다(암호화 구현의 자동 검증). `family.cjs`·`parent.cjs`는 가짜 구독(`tests/lib/fake-push.cjs`)으로 켜기·끄기·재등록·미설정 Worker 를, `family.cjs`는 가짜 갤럭시 브리지도 확인. 11개 PASS. `sw.js`의 알림 표시·누르기는 실기기 확인 항목.
- 설계와 다르게 한 결정은 `docs/NOTIFICATIONS.md` 11절 ‘결정 변경(2026-10-19, N1 구현)’.

### 25.2 N2 완료 — 갤럭시 앱 로컬 알림 (2026-10-19, 앱 v1.5)

웹앱·Worker 변경 없음(N1 이 정한 브리지 계약을 앱이 채움), 앱 versionCode 6 / 1.5. 머지하면 Android APK 워크플로가 Release `android-vN`에 APK를 붙이고, 정식 서명이라 기존 앱 위에 덮어쓰기 설치된다.

- **`NotifyBridge.kt`**(`AndroidNotify`) + `bridge.js` 어댑터 `window.DailyVocabNotify`: `permission()`(Android 13+ 권한을 묻고 답을 기다림, 동기 결과), `schedule(JSON)`, `skipToday(kind)`, `cancel()`.
- **`NotifyScheduler.kt`**: SharedPreferences 에 시각, `AlarmManager.setAndAllowWhileIdle`로 다음 한 번(Asia/Seoul; 오늘의 단어 :05, 리마인더 :00), 울리면 조건 확인(그날 건너뛰기·이미 띄움·3시간 넘게 늦음) 뒤 채널 ‘공부 알림’에 표시하고 다음 날 예약. `NotifyReceiver`(exported=false), `BootReceiver`(BOOT_COMPLETED·MY_PACKAGE_REPLACED). 매니페스트 `POST_NOTIFICATIONS`·`RECEIVE_BOOT_COMPLETED`.
- **검증**: Kotlin 은 PR 의 Android APK 워크플로 빌드. JS 어댑터는 로컬 Playwright 로 가짜 `AndroidNotify` + 실제 `bridge.js` + 실제 아이 앱을 묶어 확인(허용: permission → schedule `{daily:{enabled:true,hour:17}, reminder:{hour:20}}` 문자열·상태 문구·Web Push 요청 없음 → skipToday → 끄기 cancel / 거부: 안내 문구). 실제 알림 표시·권한 대화상자·재부팅 뒤 재예약은 실기기 확인 항목.
- 설계와 다르게 한 결정은 `docs/NOTIFICATIONS.md` 12절.

## 26. 다른 기기 기록 자동 가져오기 — 기록 탭에 같은 아이의 모든 시험 (2026-10-20)

배경: 아이 한 명이 아이폰·태블릿을 같은 아이 코드로 연결해 쓰는데, 세트는 기기끼리 맞춰지지만(15절) 기록은 기기마다 따로라 ‘아이폰에서 본 시험이 태블릿 기록 탭에 없다’는 혼란이 있었다. 20절의 기록 복원은 연결 직후와 ‘기록이 비어 있을 때 한 번’만 서버 사본을 가져왔다. 2026-10-20 PR #42(기록 탭 기본 ‘전체 세트’·빈 기록 탭의 ‘☁️ 서버 기록 가져오기’) 위에 자동 증분 병합을 더했다. **Worker 변경 없음**(20절의 `GET /records/<childId>?since=&limit=`를 그대로 쓴다).

- **언제**(family.js `restoreRecords`, 연결된 기기·시험 중이 아닐 때): 연결 직후(기록 올리기·세트 받기 뒤), 앱 시작(`syncSets` 뒤, 간격 없음), 화면 복귀·온라인 복귀(`RESTORE_CHECK_MS` 10분), 기록 탭을 열 때(quiz.js `showView` → `onHistoryShown`, `RESTORE_TAB_MS` 1분). 간격은 마지막 성공 확인(`restoreCheckedAt`, 요청을 시작한 시각)과 마지막 실패(메모리 `restoreFailedAt`) 중 늦은 것 기준.
- **어디서부터**(`autoRestoreSince`): `restoreCheckedAt` − 14일(`RESTORE_OVERLAP_MS`). 서버의 `since`는 `completedAt` 기준이라, 오프라인이던 기기가 며칠 뒤에 올린 기록(끝난 시각이 마지막 확인보다 앞)을 놓치지 않으려고 넉넉히 겹친다. 기기에 있는 id는 건너뛰므로 겹쳐도 중복이 없다. 처음(연결 직후·연결 해제 뒤)이면 epoch 부터. 14일 넘게 늦은 기록은 버튼으로. (가) Worker 에 `receivedAt` 기준 조회를 더하는 방법은 재배포가 필요하고 겹침으로 충분해 두지 않았다.
- **지운 기록은 되살리지 않는다**: 서버 사본은 남는다는 원칙(20절)과 자동 병합이 부딪히는 곳. 기록 하나 삭제 → quiz.js 가 `noteRecordDeleted(id)` → `family.restoreSkip`(최근 500개, 연결 전·연결 해제 뒤에도 기억). 기록 전체 삭제 → `noteHistoryCleared`가 `family.restoreFloor` = 그 시각(연결된 기기만), `restoreSkip`은 모두 바닥 앞이라 비운다. 자동 병합은 `restoreSkip` id 와 `completedAt` < 바닥인 기록을 건너뛰고 `since`도 바닥보다 앞으로 가지 않는다. 그래서 전체 삭제 뒤에는 그 뒤에 끝난 시험(다른 기기 것 포함)만 들어온다.
- **버튼은 모두**: 설정의 ‘☁️ 서버 기록 다시 가져오기’와 빈 기록 탭의 ‘☁️ 서버 기록 가져오기’(`{manual: true}`)는 epoch 부터 바닥·지운 id 를 무시하고 가져온 뒤 `restoreFloor`·`restoreSkip`을 비운다(모두 기기에 있으니 표시가 더 필요 없고, 다시 지우면 다시 기억한다).
- **옛 판에서 올라올 때**: 2026-10-20 전 판은 전체 삭제 때 `restoreCheckedAt`만 찍었다(이미 있으면 그대로). 저장된 상태에 `restoreFloor`가 없고 `restoreCheckedAt`이 있는데 기록이 비어 있으면 지운 뒤일 수 있으니 처음 읽을 때(`readFamily`) 지금을 바닥으로 둔다 — 빈 기록 탭에 버튼이 있어 잃는 것이 적다. 그 밖의 옛 기기는 바닥 없이 시작하므로, 이 판 전에 하나씩 지운 기록(서버에 보낸 것)은 한 번 다시 들어올 수 있다(지운 id 를 기억하지 않았으므로 알 수 없음).
- **다시 보내지 않기**: 가져온 기록은 `restored: true`라 `localRecordIds`(27절부터 `sendableHere`)·`flushFamilySync`의 pending 에서 빠진다(20절 그대로). 이 기기에서 본 기록은 id 가 같아 건너뛴다.
- **표시**: 기록 항목 메타 줄 ‘☁️ 다른 기기’(20절의 ‘☁️ 서버에서 복원’ 대신; 다시 설치하기 전 이 기기에서 본 시험도 같은 표시 — 압축 기록에 기기 정보가 없고 넣으려면 Worker `parseSync`를 고쳐야 한다), 요약 줄 ‘· ☁️ 다른 기기 N회 포함’, 기록 탭 상태 ‘다른 기기에서 본 시험 기록 N개를 서버에서 가져왔어요(점수·틀린 단어).’(버튼이면 ‘보호자에게 보냈던 기록 N개를 …’), CSV 비고 ‘다른 기기(서버 사본)’, 설정 `#restoreText` ‘☁️ 다른 기기에서 가져온 기록 N개 (점수·틀린 단어) · 지운 기록은 다시 가져오지 않아요(…) · 마지막 확인 HH:MM’. 전체 삭제 확인 문구에 ‘지운 기록은 자동으로 다시 가져오지 않고, 앞으로 다른 기기에서 보는 시험만 들어와요’.
- 세트별 오답(`daily_vocab_missed_*`, 홈의 ‘틀린 단어 복습’)은 여전히 기기마다 따로다(가져온 기록은 건드리지 않음).
- 테스트: `tests/family.cjs`(10분 안 화면 복귀는 묻지 않음 → 10분 뒤 `since` = 마지막 확인 − 14일로 방금 본 시험·3일 늦게 올라온 시험 → 기록 하나 삭제 → 기록 탭 1분 간격·지운 기록 안 돌아옴 → 새로고침 → 전체 삭제 뒤 바닥부터만), `tests/browser.cjs`(‘☁️ 다른 기기’ 표시). 버전 `20261018-25`, 캐시 v34.

## 27. 기록 저장 — 오래된 기록 줄이기와 기록의 주인 (2026-10-20)

배경: 2026-10-20 하단 탭·기록 탭 수정(PR #42) 때 코드 점검에서 찾은 아이 기기 기록 저장 문제 두 가지.

- **기록 용량**: 보통 기록은 단어 객체를 통째로 담아 40단어 시험 하나가 약 7.4K자이고 `saveSession`·`persistHistory`는 오래된 기록을 줄이지 않았다. 하루 1~2회면 몇 달 뒤 localStorage 한도(아이폰 약 2.6M자·Chrome 약 5M자)에 닿고, 그 뒤로는 기록·세트·쉬는 시험·가족 기록함 저장이 모두 실패한다.
  - quiz.js `compactHistory`(`persistHistory`가 저장할 때마다, 그리고 앱을 열 때 한 번): 최신 200개(`HISTORY_FULL_COUNT`, 합쳐 60만 자 `HISTORY_FULL_CHARS`까지 — 큰 세트의 ‘전체’ 시험 대비)는 그대로 두고, 그보다 오래된 보통 기록은 `summarizeRecord`로 **요약 기록**(`compacted: true`, 점수 `total/correct`, `results`는 틀린 단어만 최대 200개 — 복원 기록(20절)과 같은 모양)으로 바꾼다. 기록 전체가 150만 자(`HISTORY_MAX_CHARS`)를 넘으면 가장 오래된 요약 기록(복원 기록 포함)부터 틀린 단어 목록을 비운다(점수·날짜·방식은 남음). 가장 최근 기록은 언제나 그대로.
  - 기록을 읽는 곳: `isSummaryRecord`(restored 또는 compacted)로 `validRecord`·`recordScore`가 요약 기록을 받는다. 기록 탭·홈 최근 결과·세트 요약·틀린 단어 다시 풀기·CSV 는 그대로 동작하고(맞힌 단어 목록만 없어짐), ‘☁️ 다른 기기’ 표시는 붙지 않는다. 틀린 단어 목록이 비었거나 200개에서 잘린 기록(`missedComplete` false)은 기록 탭에서 ‘(모름 N개 포함)’을 빼고 CSV 비고에 ‘틀린 단어 일부 생략’. 가족 기록함 `compactRecord`는 점수를 `recordScore`로 읽어 줄인 기록도 같은 점수·틀린 단어로 보낸다(요약 기록도 이 기기에서 본 시험이라 보낼 대상).
  - 원본 보호: 앱을 열 때 줄이는 것은 읽은 기록이 모두 형식 검사를 통과했고 다른 저장 자료도 정상(`storageAvailable`)일 때만 쓴다(읽지 못한 기록이 섞여 있으면 손대지 않음).
  - 고르지 않은 안: 개수만으로 자르기(200개 × 7.4K자 = 1.5M자로 이미 아이폰 한도의 절반이고 큰 세트 시험이면 넘는다), 오래된 기록 지우기(점수 흐름이 사라진다). 맞힌 단어 목록은 화면 어디에도 쓰이지 않아 요약이 잃는 것이 거의 없다.
- **다른 아이로 재연결**: `joinChild`가 연결할 때마다 이 기기의 모든 기록(복원 기록 제외)을 대기 목록에 넣어, 아이 A로 쓰던 태블릿을 B 코드로 연결하면 A의 기록이 B로 올라갔다(B의 통계·자주 틀린 단어·수준 제안이 틀어짐). ‘링크의 아이로 바꿀까요?’ 확인 문구의 ‘기록은 각자에게 남고’와도 달랐다.
  - **기록의 주인** `record.childId`: 연결된 기기에서 본 시험에는 quiz.js `saveSession`이 family.js `recordChildId()`(연결된 아이 id, 보내기를 꺼 두었거나 서버에서 지워진 아이여도)를 붙인다. 복원 기록도 가져온 아이 id 를 가진다(보내지는 않음).
  - family.js `sendableHere(r)`: 복원 기록이 아니고 주인이 없거나(연결하기 전에 본 시험) 지금 아이이거나 보호자가 서버에서 지운 아이(`family.goneChildIds`)인 기록. `claimRecords()`가 이 기록들을 고르고 주인이 다른(없거나 지운 아이) 기록에 지금 아이 id 를 붙여 조용히 저장한 뒤 id 를 돌려준다. `joinChild`·‘기록 보내기’ 다시 켜기의 대기 목록은 `claimRecords()`, `flushFamilySync`는 대기 목록을 `sendableHere`로 거른다. 예전 아이의 못 보낸 기록은 대기 목록에서 빠지지만 그 아이로 다시 연결하면 다시 보낸다(서버는 같은 기록 키를 덮어써 중복 없음).
  - **지운 아이를 새로 만들어 다시 연결하는 흐름**(tests/family.cjs ‘deleted child … rejoin’)은 지금처럼 기록이 따라간다: `noteChildGone`이 그 아이 id 를 `goneChildIds`에 넣고(연결 해제해도 남음), 다음에 연결하는 아이가 `claimRecords`로 이어받으면 표시를 지운다(지금 아이도 지워진 상태거나 저장에 실패하면 남김).
  - 이 기능 전에 쌓인 기록(주인 없음): `initFamily`가 앱을 열 때 `claimRecords()`로 지금 연결된 아이의 것으로 표시만 한다(대기 목록은 그대로). 예전 방식으로 이미 다른 아이에게 올라간 기록은 서버에서 되돌리지 않는다.
- 26절(다른 기기 기록 자동 가져오기)과의 관계: 가져온 기록은 `restored`라 `sendableHere`가 보내지 않고, 가져온 아이 id(`childId`)를 가진다. 줄인 기록도 id 를 그대로 두므로 자동 가져오기가 같은 시험을 다시 넣지 않는다. 26절이 말하는 `localRecordIds`는 `sendableHere`·`claimRecords`로 바뀌었다.
- 저장 키는 그대로(`daily_vocab_history_v2`에 `compacted`·`childId` 필드, `daily_vocab_family_v1`에 `goneChildIds`). 옛 앱(새 셸을 받기 전)은 요약 기록을 틀린 단어만 있는 보통 기록으로 읽어 0점으로 보이고, 틀린 단어 목록을 비운 요약 기록은 걸러 낸다(그 상태로 새 기록을 저장하면 그 기록이 빠진다). 새 앱은 앱을 열 때 줄이므로 옛 앱과 섞여 도는 일은 드물다.
- 테스트: `tests/browser.cjs`(읽지 못한 기록이 섞이면 앱을 열어도 다시 쓰지 않음 → 230개 → 최신 200개 그대로·30개 요약·저장 자료 갱신 → 기록 탭 항목·다시 풀기·CSV 행 → 새 기록 저장 때 201번째 요약 → 200단어 시험 60개: 그대로 두는 기록 60만 자 이하·전체 150만 자 이하·가장 오래된 요약은 점수만), `tests/family.cjs`(줄인 기록도 같은 압축 기록으로 전송, 지운 아이의 기록 4개가 새 하늘로 가고 주인이 바뀜·`goneChildIds` 비움, 연결 해제 뒤 본 시험만 바다에게, 바다 서버에 하늘의 기록 없음, 링크로 하늘에게 돌아가면 하늘의 기록만 다시 보냄). 릴리스 `20261018-27`, 캐시 v36(같은 날 PR #45 가 -25/v34, PR #44 가 -26/v35 를 먼저 썼다). Worker 변경 없음.

## 28. 종합 시험 — 자주 틀린 단어 중심, 보호자가 만들어 보내기 (2026-10-24)

배경: 사용자 요청 “저장된 세트 중 많이 틀린 단어 중심으로 종합 시험을 볼 수 있으면 좋겠다. 아이가 직접 만들 수도 있지만 보호자가 만들어 보낼 수도 있게”. 아이 앱에는 2026-10-18 종합 시험(#31: 여러 세트 묶기, 무작위·틀린 단어 먼저·세트별 골고루)이 있었지만 ‘틀린 단어 먼저’는 세트별 오답 목록(마지막에 틀린 단어)만 보아 ‘얼마나 자주 틀렸는지’를 몰랐고, 보호자 앱에는 최근 2주 자주 틀린 단어로 ‘복습 세트’를 보내는 것(24.3)뿐이었다.

- **아이 앱(quiz.js)**: 뽑는 방법 `missed`의 이름을 ‘자주 틀린 단어 먼저’로 바꾸고 기본값으로 했다(`prefs.combo.pick` 기본 `missed`; 이미 고른 사람은 그대로). `comboMissCounts()`가 이 기기의 기록 전체(중단·요약·복원 기록 포함 — 요약 기록도 틀린 단어는 남아 있다)에서 영어 단어(소문자)별 틀린 횟수·마지막으로 틀린 시각을 센다(`historyRecords`가 바뀔 때만 다시). 지금 세트 오답 목록에 있는 단어는 적어도 1. `buildComboPool`은 횟수 많은 순(같으면 최근에 틀린 순)으로 문제 수만큼 고른 뒤 그 안에서 섞고, 모자라면 나머지에서 무작위로 채운다(고른 순서를 지키도록 `shuffle: false`는 그대로). `comboTagged`가 같은 영어 단어를 여러 세트에서 한 번만 낸다(먼저 나온 세트의 것, 세 방법 모두). 카드 요약 `#comboSummary`에 ‘· 자주 틀린 단어 N개’(뽑는 방법이 이것일 때, 홈을 그릴 때마다 갱신).
- **보호자가 보내는 종합 시험(Worker)**: `POST /family/<childId>/exam {setIds?, count 5~100, pick: missed|random|even}`(보호자 코드, kind `view`·버킷 `/family`) → `FamilyStore.makeExam`이 살아 있는 세트(고른 것만)의 단어를 모아 같은 영어 단어를 한 번만 두고, `missCounts`(그 아이의 `rec:` 전부, 5,000개까지)의 틀린 횟수로 `pickExamWords`(순수 함수, 아이 앱과 같은 규칙)를 돌려 `exam:<childId>` = `{id(UUID), name: "종합 시험 M/D"(KST), pick, setCount, missedWords, createdAt, words:[{setId, id, en, ko, ipa, hangul, aliases, missed}]}`로 저장한다. 아이당 하나라 새로 보내면 바뀐다. 응답 뒤(`later`)에 아이 기기에 📝 `exam` 알림(`PUSH_TEXT.exam`, TTL 하루). `DELETE …/exam`은 거두기. `GET /settings/<id>`·`/join`·`GET /family/<id>` 응답에 `exam`(없으면 null). `/sync`의 기록에 `exam`(시험 id, `parseSync`가 기록 id 형식만 받음)이 있고 중단이 아니면 `markExam`이 **처음 끝낸 결과**(`completedAt`이 가장 이른 것)를 `completed`에 둔다(오늘의 단어 `markDaily`는 마지막 결과지만, 시험은 첫 결과가 실력이라). 아이를 지우면 `exam:` 키도 지운다.
  - 서버에서 고르는 이유: 보호자 앱은 아이 기록을 최근 30일·200개만 받고 세트 단어도 없다(세트마다 GET 이 필요). Worker 는 기록 전체와 세트를 한곳에 갖고 있어 요청 한 번이면 된다. 미리 보기 단계는 두지 않았다(보낸 시험의 문제 목록을 보여 주고, 다시 보내면 바뀜).
- **아이 기기(family.js)**: `applySettings`가 `exam`을 `family.settings.exam`(`validExam`, 단어 100개까지)에 두고 `renderExamCard`가 홈 `#examCard`(오늘의 단어 카드 바로 아래, 같은 `.daily` 모양)를 그린다: ‘📝 보호자가 보낸 종합 시험’ · ‘20문제 · 자주 틀린 단어 13개 · 종합 시험 10/24’ · `▶ 풀기`. `startExam`은 단어에 `_setId`를 붙여 `newSession(false, words, {setId: "combo", setName: exam.name}, {rangeLabel: "보호자 종합 시험 · N문제", exam: id, shuffle: true})` — 아이가 만든 종합 시험과 같은 `combo` 기록이라 기록 탭 ‘📝 종합 시험’ 필터에 들어가고 `finishRecords`가 출처 세트(이 기기에 있는 것만)의 오답 목록에 반영한다. quiz.js 는 `sessionMeta.exam`을 기록 `exam`으로 남기고(쉬기·이어서 하기에도 유지), 결과 화면 ‘같은 범위 다시’는 `startExam()`. family.js `compactRecord`가 `exam`을 보내고 `queueFamilySync` → `noteExamResult`가 처음 끝낸 결과를 `family.examResult`에 둔다. 카드는 끝내면 ‘✅ 종합 시험 끝! 17 / 20 맞았어요’·`한 번 더 풀기`(이 기기 결과가 없으면 서버 `completed` — 다른 기기에서 푼 것), **끝낸 날이 지나면 홈에서 내린다**(보호자가 새로 보내면 다시). 연결 해제·서버에서 지워진 아이면 숨긴다. 알림을 눌러 돌아오면(`navigate` 메시지) `fetchSettings({force: true})`로 바로 받는다. 평소에는 앱 시작(즉시)·화면 복귀(10분 간격) 때 받는다.
- **보호자 앱(parent.js)**: 📚 세트 탭의 `#examBox`(세트가 있을 때): 세트 체크 `#examSets`(기본 전부, 뺀 세트는 세션 동안 아이별 `examOff`), `#examCount`(10·20·30·50, 기본 20)·`#examPick`(기본 자주 틀린 단어 먼저), `#sendExam` → `api.sendExam`(전부 고르면 `setIds: null` — 나중에 생긴 세트도 포함되는 뜻이 아니라 ‘지금 있는 전부’) → 상세 `exam` 갱신·토스트 ‘‘종합 시험 10/24’ 20문제를 하늘에게 보냈어요. 자주 틀린 단어 13개가 들어 있어요.’. 아직 안 푼 시험이 있으면 바꾸기 전에 묻는다. `#examCurrent`: 이름·문제 수·자주 틀린 단어 수·보낸 때, ‘⏳ 아직 풀지 않았어요’/‘✅ 17 / 20 맞았어요 (85점) · N분 전’, `문제 N개 보기`(단어 — 뜻 (틀림 N회)), `#deleteExam` 거두기. 상세 캐시(`details[id].exam`)에 저장된다. 옛 Worker 는 404 `not_found` → ‘다시 배포’ 문구(`describeApiError`).
- **배포 순서**: Worker 먼저(`cd worker && npm run deploy`, 마이그레이션 없음) → 앱. 앱만 먼저 나가도 아이 앱의 ‘자주 틀린 단어 먼저’는 동작하고, 보호자의 ‘종합 시험 보내기’만 ‘다시 배포’ 안내가 나온다(아이 기기는 `exam`이 없으니 카드 없음).
- 고르지 않은 안: (가) 종합 시험을 ‘세트’로 보내기(세트 동기화로 Worker 변경 없이 가능) — 세트 목록에 쌓이고, 틀린 단어가 원래 세트가 아니라 새 세트의 오답이 되며, 아이의 종합 시험에 같은 단어가 두 번 섞인다. 이미 ‘복습 세트 보내기’가 그 역할을 한다. (나) 규칙(세트·문제 수·방법)만 보내고 아이 기기가 고르기 — 기기마다 기록이 달라(다른 기기 기록은 요약으로만 들어옴) 같은 시험이 기기마다 달라지고 보호자가 문제를 볼 수 없다.
- 테스트: `tests/worker.cjs`(검증·코드 역할·no_words·자주 틀린 순서와 동점 처리·중복 단어·고른 세트·골고루·/settings·/join·상세·완료 표시(중단·다른 id 무시, 첫 결과, 더 이른 결과로 바뀜)·기록에 exam·거두기·아이 삭제·📝 알림 복호화), `tests/session.cjs`(기본값·요약 문구·가장 많이 틀린 단어가 1문제 시험에·같은 영어 단어 한 번), `tests/daily.cjs`(카드·풀기·출처 세트 오답·기록·전송·완료 카드·다음 날 숨김·새로 보내기·거두기), `tests/parent-sets.cjs`(본문·보낸 시험·틀린 횟수·바꾸기 확인·결과·거두기·옛 Worker). 가짜 Worker 옵션 `exam`. 릴리스 `20261018-29`, 캐시 v38.
