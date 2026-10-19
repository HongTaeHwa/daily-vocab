# 알림(2B) — 아이 기기 리마인더와 보호자 알림 (2026-10-19 설계)

보호자 앱 개편(`docs/PARENT_REDESIGN.md`)이 끝나 남은 큰 항목인 **알림(2B)** 의 설계다. 아이 기기에는 ‘오늘의 단어 도착’과 ‘공부 리마인더’를, 보호자 폰에는 ‘시험 마침’과 ‘저녁 요약’을 보낸다. 아이폰·Android Chrome은 Web Push, 갤럭시 래퍼 앱은 로컬 알림으로 받는다. 구현은 이 문서를 기준으로 단계(PR)마다 별도 세션이 맡는다.

## 0. 한눈에

- **받는 사람과 종류**
  - 아이 기기: 📬 **오늘의 단어 도착**(서버가 그날 단어를 만든 직후), ✏️ **공부 리마인더**(보호자가 정한 시각까지 오늘 시험이 없으면, 하루 1번).
  - 보호자 폰: 🧒 **시험 마침**(아이가 시험을 끝내면 바로, 점수·경고 포함), 🌙 **저녁 요약**(보호자가 정한 시각에 아이별 오늘 한 줄, 하루 1번).
- **전달 방식**: Worker가 **Web Push**(VAPID + RFC 8291 aes128gcm 암호화, 외부 라이브러리 없이 WebCrypto)로 보내고 `sw.js`가 알림을 띄운다. 아이폰은 홈 화면에 설치한 앱에서만(iOS 16.4+) 되므로 설치 안내를 함께 둔다. **갤럭시 래퍼 앱(WebView)은 Web Push가 없어** 앱이 AlarmManager 로컬 알림으로 같은 두 가지(도착·리마인더)를 띄운다(아이 앱이 브리지로 시각을 알려 줌).
- **설정 주체**: 보호자가 아이별 **공부 알림 시각**(`plan.remindHour`)을 정하고, 아이 기기는 **‘이 기기에서 알림 받기’** 한 번만 켠다. 보호자 폰은 ‘이 폰에서 알림 받기’ + ‘시험 마치면 바로’ + ‘저녁 요약(시각)’ 세 가지뿐.
- **단계**: N1 = Worker 푸시 기반 + `sw.js` + 아이 앱·보호자 앱 Web Push UI(한 PR, Worker 재배포 + VAPID 키 등록 필요) → N2 = 갤럭시 앱 v1.5 로컬 알림(android/ 전용 PR).

## 1. 목적·범위

- **목적**: 아이가 앱을 열지 않아도 오늘의 단어가 왔음을 알고, 정한 시각까지 안 했으면 한 번 상기시킨다. 보호자는 아이가 시험을 마쳤는지와 하루 요약을 앱을 열지 않고도 받는다.
- **범위 안**: Worker 푸시 전송 기반(키·구독·암호화·전송·실패 정리), 크론 트리거(도착·리마인더·요약), `/sync` 트리거(시험 마침), `sw.js` push/notificationclick, 아이 앱 알림 켜기·끄기 UI와 갤럭시 브리지 호출, 보호자 앱 알림 설정 UI와 아이별 공부 알림 시각, 갤럭시 앱 로컬 알림(N2), 테스트·문서·개인정보 안내.
- **범위 밖**: 계정·로그인, 외부 푸시 서비스(FCM 직접 연동 등), 보호자에게 아이의 단어별 결과를 보내는 것, 알림 안의 상호작용 버튼(답하기 등), 2C 자동 조절.
- **원칙 유지**: 순수 정적 앱, 외부 CDN·추적 없음, 비밀값은 Worker에만, 아이 기기에는 가족 코드만, 쉬운 한국어·최소 선택지, 테스트 ID·문구 계약, 버전 체크리스트.

## 2. 플랫폼 제약 (설계의 전제)

| 기기 | 방법 | 조건·제약 |
|---|---|---|
| 아이폰(아이·보호자) | Web Push(APNs 경유) | iOS 16.4+, **홈 화면에 설치한 앱(standalone)에서만**. 권한 요청은 사용자 터치 안에서. Safari 탭에서는 불가 → 안내 문구 |
| Android Chrome PWA(보호자 폰, 아이가 Chrome으로 쓸 때) | Web Push(FCM 경유) | 권한 요청 1회. 설치 안 해도 됨 |
| 갤럭시 래퍼 앱(아이 태블릿, `android/`) | **로컬 알림**(AlarmManager + 알림 채널) | WebView에는 PushManager가 없다. 앱이 시각을 알고 스스로 띄움. Android 13+는 `POST_NOTIFICATIONS` 런타임 권한 |
| PC 브라우저 | Web Push 가능하나 대상 아님 | 지원 여부만 보고 버튼은 보임(테스트용) |

Web Push 전송에는 VAPID 서명(ES256 JWT)과 본문 암호화(aes128gcm)가 필요하다. 둘 다 Cloudflare Workers의 WebCrypto로 구현할 수 있어 npm 의존성을 넣지 않는다. 푸시 서비스(Apple·Google) 주소는 지역 제한이 없어 북미 중계(RELAY)를 거치지 않고 Worker가 직접 보낸다.

## 3. 알림 종류

| 종류(`kind`) | 받는 쪽 | 언제 | 제목 / 본문 | 누르면 | 하루 상한 |
|---|---|---|---|---|---|
| `daily` | 아이 기기 | 크론이 그날 단어를 만든 직후, 또는 보호자가 ‘오늘 것 지금 만들기’로 만든 직후 (아이 기기가 앱을 열어 스스로 만든 때는 보내지 않음) | 📬 오늘의 단어 N개가 도착했어요 / 복습 M개 + 새 단어 K개 · 앱을 열어 풀어 보세요 | 아이 앱 홈 `./` | 1 |
| `reminder` | 아이 기기 | 크론 시각 == `plan.remindHour`(KST)이고 그날(KST) 완료 기록이 없을 때 | ✏️ 오늘 아직 단어 시험을 안 봤어요 / 짧게라도 한 번 풀어 볼까요? | `./` | 1 |
| `finish` | 보호자 폰 | `/sync`로 **방금 끝낸** 완료 기록이 들어올 때(중단 제외; 한 번에 4개 이상이거나 6시간 넘게 지난 기록은 재업로드로 보고 제외) | 🧒 용한 · DAY04 9/10 (90점) / 영어 → 한글 · 121~130번 ⚠️ 화면 이탈 1회 · ⏱ 시간 초과 1개 | `./parent.html#/child/<id>/records` | 제한 없음(`Topic: finish-<childId>`로 같은 아이 것은 합쳐짐) |
| `summary` | 보호자 폰 | 크론 시각 == 보호자 기기의 `summaryHour`(기본 21) | 🌙 오늘 공부 / 용한 ✅ 2회 · 평균 85점 · 오늘의 단어 ✅ ⏎ 한나 ⬜ 아직 | `./parent.html#/` | 1 |
| `test` | 요청한 기기 | 설정의 ‘테스트 알림 보내기’ | 🔔 알림이 잘 와요 / 매일 영단어 알림 설정이 끝났어요 | 각 앱 | — |

문구는 쉬운 한국어로 고정하고 Worker가 만든다(앱은 받은 `title/body/url`을 그대로 띄움). 아이 이름·세트 이름·점수·경고 횟수 외의 정보(단어, 틀린 단어, 사진)는 알림에 넣지 않는다.

## 4. 아키텍처

### 4.1 Worker (`worker/worker.js`)

- **키**: `npm run vapid`(새 스크립트 `worker/scripts/vapid.cjs`, Node `crypto.subtle`로 P-256 키 쌍 생성)가 `VAPID_PUBLIC_KEY`(base64url, 비압축 65바이트)와 `VAPID_PRIVATE_KEY`(base64url 32바이트)를 출력한다. 공개 키는 `wrangler.jsonc`의 `vars.VAPID_PUBLIC_KEY`(공개 값이라 커밋해도 됨), 비밀 키는 `wrangler secret put VAPID_PRIVATE_KEY`. `vars.VAPID_SUBJECT`는 `https://hongtaehwa.github.io/daily-vocab/`(RFC 8292는 URL도 허용; 이메일을 저장소에 두지 않는다). 키를 바꾸면 모든 구독이 무효가 되므로 `worker/README.md`에 경고한다. 키가 없으면 푸시 관련 경로는 503 `push_unconfigured`로 답하고 다른 기능은 영향 없음.
- **구독 저장**(`FamilyStore`): 아이 기기 `push:child:<childId>:<deviceId>` → `{endpoint, keys:{p256dh, auth}, label, createdAt, lastOkAt, failures}`; 보호자 기기 `push:parent:<deviceId>` → `{endpoint, keys, label, createdAt, lastOkAt, failures, kinds:{finish, summary}, summaryHour}`. 아이당 기기 수는 `MAX_DEVICES`(10)와 같이, 보호자 기기는 5대까지. 아이를 지우면 그 아이의 구독도 지운다. 같은 기기가 다시 구독하면 덮어쓴다.
- **하루 1번 표시**: `sent:<scope>:<YYYY-MM-DD>:<kind>`(scope = childId 또는 보호자 deviceId). 크론이 3일 지난 표시를 지운다.
- **전송** `sendPush(sub, {title, body, url, tag}, {ttl, topic, urgency})`:
  1. VAPID: JWT 헤더 `{typ:"JWT", alg:"ES256"}`, 본문 `{aud: endpoint의 origin, exp: now+12h, sub: VAPID_SUBJECT}`, `crypto.subtle.sign("ECDSA", P-256 비밀 키, SHA-256)` → DER가 아니라 raw r||s 64바이트(WebCrypto ECDSA는 raw를 돌려준다) → base64url. 헤더 `Authorization: vapid t=<jwt>, k=<publicKey>`.
  2. 본문 암호화(RFC 8291 + RFC 8188 aes128gcm): 임시 ECDH P-256 키 생성 → `ua_public`(p256dh)과 ECDH 공유 비밀 → `IKM = HKDF-SHA256(salt=auth, ikm=공유비밀, info="WebPush: info\0"+ua_public+as_public, 32)` → `salt` 16바이트 난수 → `CEK = HKDF(salt, IKM, "Content-Encoding: aes128gcm\0", 16)`, `NONCE = HKDF(salt, IKM, "Content-Encoding: nonce\0", 12)` → 평문 JSON + `0x02` 구분자 → AES-128-GCM → 본문 = `salt(16) | rs=4096(4) | idlen=65(1) | as_public(65) | 암호문`. 헤더 `Content-Encoding: aes128gcm`, `Content-Type: application/octet-stream`, `TTL`(daily·reminder·summary 86400, finish 3600, test 300), `Urgency: normal`, `Topic`(종류별; 같은 Topic은 미수신 시 새것으로 대체).
  3. 응답 처리: 201/200 성공(`lastOkAt`, `failures=0`); 404·410 → 구독 삭제; 429·5xx·네트워크 → `failures++`(5회 연속이면 삭제); 400·401·403은 키 문제라 `console.error`(endpoint·키는 로그에 넣지 않음, 상태 코드와 종류만).
  4. 한 번에 보내는 대상은 아이 기기 ≤ 10, 보호자 ≤ 5라 순차 `fetch`로 충분(타임아웃 10초).
- **트리거**:
  - `daily`: `ensureDaily`가 **크론 또는 보호자 코드 요청**으로 새로 만들었을 때(`origin: "cron"|"parent"`). 아이 기기가 `POST /daily`로 스스로 만든 때(`origin: "child"`)는 보내지 않는다.
  - `reminder`: `cron({date, hour})`에서 각 아이의 `plan.remindHour === hour`이고 `sent:` 표시가 없고 그날(KST, `completedAt`을 KST로 환산) `partial`이 아닌 기록이 0개면 전송 후 표시.
  - `finish`: `sync()`가 저장한 기록 중 조건(완료, `completedAt`이 6시간 이내, 이번 요청 기록 수 ≤ 3)을 만족하는 것들에 대해 아이별 가장 최근 1건으로 보호자 구독(`kinds.finish`)에 전송. 아이 이름은 서버 이름.
  - `summary`: `cron`에서 보호자 구독마다 `summaryHour === hour`이고 표시가 없으면 아이별 그날 기록으로 본문을 만들어 전송(아이 0명이면 보내지 않음).
  - `test`: `POST /push/test` 즉시.
- **아이 기기 설정 응답 확장**: `deviceSettingsOf` → `{timeLimitSec, setsLocked, dailyEnabled, dailyHour, remindHour}`(`/settings`·`/join`). 갤럭시 앱 로컬 알림 시각과 아이 앱 상태 문구에 쓴다.
- **계획 항목 추가**: `plan.remindHour`: `null`(끔) 또는 0~23 정수. `parsePlan`이 검증. 기본 `null`.

### 4.2 API

| 경로 | 코드 | 본문 → 응답 |
|---|---|---|
| `GET /push/key` | 가족·보호자 | → `{publicKey}` (없으면 503 `push_unconfigured`) |
| `POST /push/subscribe` | 아이: 가족 코드 / 보호자: 보호자 코드 | 아이 `{role:"child", childId, device:{id,label}, subscription:{endpoint, keys:{p256dh, auth}}}` / 보호자 `{role:"parent", device:{id,label}, subscription, kinds:{finish, summary}, summaryHour}` → `{ok}`. 검증: endpoint는 https URL 1,000자 이하, 키는 base64url(p256dh 87~88자, auth 22~24자), `childId` 존재(404 `unknown_child`), 보호자 role에 가족 코드만 오면 401, `summaryHour` 0~23 |
| `POST /push/unsubscribe` | 같음 | `{role, childId?, device:{id}}` → `{ok}` (없어도 ok) |
| `POST /push/test` | 같음 | `{role, childId?, device:{id}}` → `{ok, status}` (구독 없으면 404 `no_subscription`) |
| `POST /family/<id>/plan` | 보호자 | `{remindHour: null|0~23}` 추가(기존 항목 유지) |
| `GET /settings/<id>`, `POST /join` | 가족 | 응답에 `dailyEnabled, dailyHour, remindHour` 추가 |

요청 제한 버킷은 기존 규칙대로(`/push` 버킷 하나). `roleOf`에 `/push/…`를 더하고 role에 따라 코드 요구를 가른다.

### 4.3 서비스워커 (`sw.js`, 두 앱이 공유)

- `push`: `event.data?.json()`을 `{title, body, url, tag}`로 읽고(실패하면 제목 ‘매일 영단어’, 본문 ‘앱을 열어 확인해 보세요’), `self.registration.showNotification(title, {body, tag, data:{url}, icon, badge})`. 아이콘은 url이 `parent.html`로 시작하면 `./icons/parent-192.png`, 아니면 `./icons/icon-192.png`.
- `notificationclick`: 닫고 `clients.matchAll({type:"window", includeUncontrolled:true})`에서 같은 페이지(`parent.html` 여부)가 열려 있으면 `focus()` 후 `navigate(url)`(해시만 다르면 `postMessage({type:"navigate", url})`로 앱이 해시를 바꿈), 없으면 `clients.openWindow(url)`.
- `pushsubscriptionchange`: 새 구독을 만들어 Worker에 다시 등록하려면 코드가 필요한데 SW에는 없으므로, 앱이 다음에 열릴 때 재등록하도록 `IndexedDB`나 Cache에 플래그를 두지 않고 **앱 시작 때마다 `pushManager.getSubscription()`과 저장된 endpoint를 비교해 다르면 다시 `POST /push/subscribe`** 하는 쪽으로 단순화한다.
- 캐시 이름 올리기(앱 셸 변경).

### 4.4 아이 앱 (`family.js`, `index.html` 설정 → 가족 기록함 카드)

- `#notifyBox`(연결된 기기에서만): 상태 줄 `#notifyText`, 버튼 `#notifyEnable`(🔔 이 기기에서 알림 받기 / 🔕 알림 끄기), 안내 `#notifyHelp`.
- 켜기 흐름(사용자 터치 안): `Shared.notify.support()`가 `"native"`(갤럭시 앱 `window.DailyVocabNotify`)·`"push"`·`"install"`(iOS Safari 탭: standalone 아님)·`"none"` 중 하나를 돌려준다. `native` → 브리지 `permission()` 뒤 `schedule({daily:{enabled, hour}, reminder:{hour}})`; `push` → `Notification.requestPermission()` → `GET /push/key` → `registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey})` → `POST /push/subscribe` → `family.push = {deviceId, endpoint, enabledAt}`; `install` → “홈 화면에 설치한 앱에서만 알림을 켤 수 있어요(공유 → 홈 화면에 추가)”; 거부되면 “알림 권한이 꺼져 있어요. 기기 설정에서 켜 주세요”.
- 끄기: `unsubscribe()` + `POST /push/unsubscribe`(네이티브는 `cancel()`), `family.push = null`.
- 앱 시작·설정 수신 때: `family.push`가 있는데 실제 구독이 없거나 endpoint가 다르면 다시 등록(권한이 granted일 때만). 네이티브면 `applySettings` 때마다 `schedule(...)`을 다시 보내고, 시험을 **완료**해 `queueFamilySync`가 호출될 때 `skipToday("reminder")`.
- 상태 문구: “🔔 알림 켜짐 · 오늘의 단어 도착 · 공부 알림 오후 8시”(remindHour 없으면 ‘공부 알림 없음(보호자 설정)’), “알림 꺼짐”, “이 브라우저는 알림을 지원하지 않아요”.
- 갤럭시 앱 브리지 계약(`bridge.js`가 `window.DailyVocabNotify`로 노출, N2에서 구현; N1에서는 없으면 Web Push로): `available: true`, `permission() → "granted"|"denied"|"prompt"`(요청 포함), `schedule({daily:{enabled, hour}|null, reminder:{hour}|null})`, `skipToday(kind)`, `cancel()`. 모두 동기, 인자는 JSON 문자열로 넘긴다(`AndroidNotify.*`).

### 4.5 보호자 앱 (`parent.js`, `parent.html` 설정)

- 🔔 알림 카드: `#notifyEnable`(이 폰에서 알림 받기, 토글 버튼), `#notifyFinish`(체크: 아이가 시험을 마치면 바로), `#notifySummary`(체크: 저녁 요약) + `#notifySummaryHour`(select 18~23시, 기본 21), `#notifyTest`(테스트 알림 보내기), `#notifyStatus`. 체크·시각을 바꾸면 즉시 `POST /push/subscribe`로 갱신(구독은 그대로). 저장 `prefs.push = {deviceId, endpoint, kinds, summaryHour}`. 지원 판정·안내는 아이 앱과 같은 `Shared.notify`.
- 아이 설정 탭: `#planRemindHour`(⏰ 공부 알림 시각: 없음 / 오후 3시 … 오후 10시, 제한 시간처럼 즉시 `POST /family/<id>/plan {remindHour}`) + 설명 “아이 기기에서 알림을 켜 두면 이 시각까지 시험이 없을 때 한 번 알려 줘요. 오늘의 단어가 켜져 있으면 도착 알림도 가요.”
- 오늘 카드·상세에는 변화 없음.

### 4.6 공통 (`shared.js`)

`Shared.notify = { support(), permission(), subscribe(serverKey), current(), unsubscribe() }` — `window.DailyVocabNotify`(네이티브)·`PushManager`·standalone 여부를 감싼다. 테스트가 바꿔 끼울 수 있게 `window.__dailyVocabPushImpl`이 있으면 그것을 쓴다(Playwright `addInitScript`로 가짜 구독을 돌려줌).

### 4.7 갤럭시 앱 (N2, `android/`, v1.5)

- `NotifyBridge.kt`(`AndroidNotify`): `permission()`(API 33+ `POST_NOTIFICATIONS` 요청, 결과 문자열), `schedule(json)`(SharedPreferences에 저장 + `AlarmManager.setAndAllowWhileIdle`로 다음 발생 시각 예약; 정확 알람 권한은 쓰지 않음), `skipToday(kind)`(그날 건너뛰기 표시), `cancel()`.
- `NotifyReceiver`(BroadcastReceiver): 알람이 오면 표시 조건(건너뛰기·중복)을 보고 알림 채널 `daily-vocab`에 띄우고 다음 날을 다시 예약. `BOOT_COMPLETED`로 재부팅 뒤 재예약. 알림을 누르면 `MainActivity`(URL `./`).
- 문구는 Worker와 같은 한국어(`strings.xml`). `bridge.js`가 `window.DailyVocabNotify` 어댑터를 만든다. 매니페스트: `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, receiver 2개. `versionCode 6 / 1.5`.
- 리마인더는 ‘오늘 시험을 했는지’를 앱이 모르므로 아이 앱이 완료 때 `skipToday`를 부른다(앱이 꺼져 있던 날은 그대로 울림 — 허용).

## 5. 데이터

- Worker 키: `push:child:<childId>:<deviceId>`, `push:parent:<deviceId>`, `sent:<scope>:<date>:<kind>`, `plan.remindHour`.
- 아이 앱 `daily_vocab_family_v1.push = {deviceId, endpoint, enabledAt} | null`, `settings`에 `dailyEnabled, dailyHour, remindHour` 추가. 백업에 넣지 않음.
- 보호자 앱 `daily_vocab_parent_v1.prefs.push = {deviceId, endpoint, kinds:{finish, summary}, summaryHour} | null`.
- 비밀값·변수: `VAPID_PRIVATE_KEY`(secret), `VAPID_PUBLIC_KEY`·`VAPID_SUBJECT`(vars).

## 6. 개인정보·보안

- 알림은 Apple·Google 푸시 서비스를 거치지만 본문은 기기 키로 암호화(aes128gcm)되어 서비스는 내용을 못 본다. 알림 내용은 아이 이름·세트 이름·점수·경고 횟수뿐이며 단어·틀린 단어·사진은 넣지 않는다. README ‘개인정보’ 절에 “푸시 알림을 켜면 기기의 푸시 주소가 가족 Worker에 저장되고 알림이 Apple/Google 서비스를 거친다”를 추가한다(CLAUDE.md 규칙: 새 외부 전송은 README와 함께).
- 구독 endpoint는 비밀처럼 다룬다(로그·응답에 넣지 않음, 보호자 화면에도 표시하지 않음). 가족 코드로는 아이 구독만, 보호자 코드로는 보호자 구독만 만들 수 있다.
- 알림 끄기·연결 해제·보호자 코드 삭제 때 구독을 서버에서도 지운다.

## 7. 테스트

- `tests/worker.cjs`: `GET /push/key`(미설정 503·설정 200), 구독 검증(role·endpoint·키 형식·`unknown_child`·코드 역할·상한), 구독 갱신·해지, 테스트 푸시: 가짜 `fetch`로 endpoint 호출을 받아 **헤더 검사**(`Authorization: vapid t=…,k=…`의 JWT를 Node `crypto.verify`로 공개 키 검증, `aud`·`exp`·`sub`), **본문 복호화**(테스트에 RFC 8291 복호화를 Node WebCrypto로 구현해 JSON이 나오는지) → 이것이 암호화 구현의 유일한 자동 검증이므로 꼭 둔다; 트리거 — `daily`(크론·보호자 생성은 전송, 아이 생성은 없음), `reminder`(시각 일치·기록 없음 → 1회, 같은 시각 두 번째 크론 → 없음, 오늘 기록 있음 → 없음, `remindHour` null → 없음), `finish`(완료 1건 → 보호자 전송·본문 문구, 중단 → 없음, 5건 재업로드 → 없음, `kinds.finish` 꺼짐 → 없음), `summary`(시각·하루 1번·본문 두 아이), 410 → 구독 삭제, 5회 실패 → 삭제, 아이 삭제 → 구독 삭제, `plan.remindHour` 검증, `/settings` 응답 확장.
- `tests/family.cjs`: `window.__dailyVocabPushImpl` 가짜로 아이 기기 ‘알림 받기’ → `GET /push/key`·`POST /push/subscribe` 본문(role child·childId·device·subscription) → 상태 문구 → 끄기 → `unsubscribe`; 앱 시작 때 endpoint 달라지면 재등록; 네이티브 브리지 가짜(`window.DailyVocabNotify`)면 `schedule` 호출 내용·완료 뒤 `skipToday`.
- `tests/parent.cjs`: 설정 🔔 켜기 → 구독 본문(role parent·kinds·summaryHour) → 체크 변경 즉시 갱신 → 테스트 알림 → 끄기; 아이 설정 탭 `#planRemindHour` → plan 본문; 코드 삭제 때 unsubscribe.
- 가짜 Worker 모듈: `/push/key`·`/push/subscribe`·`/push/unsubscribe`·`/push/test` 라우트, `remindHour`·`dailyEnabled/dailyHour` 전달.
- `sw.js`의 push/notificationclick은 자동 테스트하지 않는다(실기기 확인 항목).

## 8. 단계별 구현 계획

### N1. Worker 푸시 기반 + 서비스워커 + 두 앱 UI — `feat/push-notify`
1. `worker/scripts/vapid.cjs`·`npm run vapid`, `wrangler.jsonc` vars(`VAPID_PUBLIC_KEY` 자리·`VAPID_SUBJECT`), `worker/README.md`(키 생성·등록·재생성 경고·배포 순서).
2. Worker: 구독 저장·검증·API, `sendPush`(VAPID·aes128gcm), 트리거 4종, `sent:` 표시·정리, `plan.remindHour`, `deviceSettingsOf` 확장, 아이 삭제 정리, 라우트 주석.
3. `sw.js` push/notificationclick(+캐시 이름).
4. `shared.js` `Shared.notify`; 아이 앱 `#notifyBox`·흐름·네이티브 브리지 호출(브리지가 없으면 Web Push); 보호자 앱 🔔 카드·아이 설정 탭 `#planRemindHour`.
5. 버전 체크리스트 전부(릴리스 `20261018-23`, 캐시 v32). 테스트(7절)·README(아이·보호자 사용법, 개인정보)·CLAUDE.md(파일 구조·ID·문구·키·테스트 표)·DESIGN.md 25절.
- **완료 기준**: 테스트 전체 PASS. `node tests/worker.cjs`가 JWT 검증과 본문 복호화를 통과. 키 미설정 Worker에서 앱이 “알림 서버가 아직 준비되지 않았어요”를 보이고 다른 기능은 그대로. 머지 뒤 사용자 작업: `cd worker && npm run vapid` → `wrangler secret put VAPID_PRIVATE_KEY` → `wrangler.jsonc`에 공개 키 → `npm run deploy`.

### N2. 갤럭시 앱 로컬 알림 — `feat/android-notify` (android/ 전용, v1.5)
1. `NotifyBridge.kt`·`NotifyReceiver`·채널·매니페스트·`strings.xml`, `bridge.js`의 `window.DailyVocabNotify` 어댑터(4.4 계약).
2. `android/README.md`·CLAUDE.md 갤럭시 절·DESIGN.md 25절 보강. CI APK 빌드 통과.
- **완료 기준**: 아이 앱에서 ‘알림 받기’를 켜면 브리지로 시각이 넘어가고, 정한 시각에 알림이 뜨며(실기기), 완료한 날은 리마인더가 안 뜬다(`skipToday`). 웹앱 변경 없음(N1의 브리지 호출 사용).

## 9. 리스크·대응

| 리스크 | 대응 |
|---|---|
| aes128gcm·VAPID 구현 오류로 푸시가 조용히 실패 | 테스트에서 Node WebCrypto로 복호화·JWT 검증(7절). 실기기 ‘테스트 알림 보내기’. 전송 실패는 상태 코드만 로그 |
| iOS에서 Safari 탭으로 켜려는 경우 | `support() === "install"` 안내. 설치한 앱이어도 iOS 16.3 이하면 `PushManager` 없음 → “이 기기는 알림을 지원하지 않아요” |
| 구독 만료·키 교체로 끊김 | 앱 시작 때 endpoint 비교 재등록, 410 정리, 5회 실패 삭제. 키 교체 시 README 경고(모든 기기에서 다시 켜기) |
| 재연결·일괄 업로드 때 보호자에게 알림 폭주 | `finish`는 6시간 이내·4개 미만만. `Topic`으로 합침 |
| 갤럭시 앱이 리마인더를 울리면 안 되는 날(시험 완료) | 아이 앱이 완료 때 `skipToday`. 앱을 안 연 날은 울려도 됨 |
| Worker 크론은 매시 정각(UTC)이라 KST 시각 단위 | 시각은 시 단위만 제공(분 선택 없음). `kstNow(scheduledTime)` 사용 |
| 비밀값 관리 | 비밀 키는 secret으로만, 공개 키는 vars. 저장소·앱·로그에 비밀 키 없음 |

## 10. 구현 세션 지시서

각 단계 세션은 이 문서와 `CLAUDE.md`를 읽고, 관련 테스트를 먼저 돌려 기준을 확인한 뒤 구현한다. 설계와 다르게 해야 하면 이 문서의 해당 절에 ‘결정 변경(날짜)’을 적고 PR 본문에도 쓴다. 테스트 ID·문구 계약을 바꾸면 같은 PR에서 CLAUDE.md와 테스트를 고친다. 화면 문구는 쉬운 한국어, 선택지는 최소. 외부 CDN·npm 런타임 의존성 없음(Worker 포함). 비밀값·개인정보 커밋 금지. 커밋 제목 영어 명령형, 본문 한국어. 앱 셸을 바꾸면 버전 체크리스트 전부. 완료 보고에는 바뀐 파일, 새 API, PASS 결과, 사용자가 해야 할 배포 작업(키 생성·secret·vars·deploy)과 실기기 확인 항목을 적는다. PR 머지·Worker 배포는 사용자 요청 때만.
