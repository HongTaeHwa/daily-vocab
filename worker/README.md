# AI 사진 인식·사전 프록시 (Cloudflare Worker)

앱(GitHub Pages)은 Anthropic API를 직접 부르지 않고 이 Worker만 호출합니다. 사진 인식(`/recognize`), 영어 단어 목록의 뜻·발음을 찾는 AI 사전(`/define`), 아이 기기가 보낸 시험 기록을 저장해 보호자 폰에 보여 주는 가족 기록함(`/sync`, `/family`), 아이 단위 세트 저장소(`/sets`, `/family/<childId>/sets`), 매일 아이 수준에 맞는 ‘오늘의 단어’를 만드는 생성기(`/daily`, 크론), 그리고 아이 기기·보호자 폰으로 보내는 알림(Web Push, `/push/…`, 크론)을 처리합니다. Anthropic API 키는 Worker의 비밀값에만 있고, 앱·저장소·태블릿 어디에도 들어가지 않습니다. 가족용 **접속 코드**가 맞는 요청만 처리합니다.

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
- 보관: 아이마다 최근 5,000개까지, 넘으면 오래된 것부터 지웁니다. 같은 기록을 다시 보내면 덮어쓰고 개수(`recordCount`)에도 다시 세지 않습니다. 아이 항목과 기록은 보호자 앱에서 삭제(`DELETE /family/<childId>`)할 수 있고, 아이 기기에서 기록을 지워도 서버 사본은 남습니다. 지운 아이 id는 `gone:<childId>` 묘비로 남아 연결돼 있던 기기가 `/sync`를 보내도 되살아나지 않고 404 `unknown_child`를 받습니다(앱은 ‘보호자가 이 아이를 서버에서 지웠어요’ 안내 뒤 연결을 해제하고 새 코드로 다시 연결할 때까지 요청을 멈춥니다). 모르는 아이 id의 `/sync`는 옛 앱 호환으로 아이를 만듭니다. 기기를 바꾸거나 앱을 다시 설치하면 아이 기기가 `GET /records/<childId>`(가족 코드, `since`로 최대 500개씩)로 서버 사본을 내려받아 기록 탭을 채웁니다(**기록 복원**). 그때 받은 요약 기록은 다시 `/sync`로 올라오지 않습니다.
- **보호자 상세 기록 창(2026-10-19)**: `GET /family/<childId>`는 기록을 최근 30일(`?days=1~365`) 안에서 최신 200개(`?limit=1~500`)까지만 보내고 `recordCount`(그 아이의 전체 기록 수)·`more`(더 오래된 기록이 있음)를 붙입니다(기록 5,000개 아이도 첫 응답은 200개 이하). 보호자 앱의 ‘더 보기’는 `GET /family/<childId>/records?before=<목록의 마지막 completedAt>&limit=100`(보호자 코드)으로 그 이전 기록을 페이지로 받습니다. `recordCount`는 `/sync`가 새 기록만 더하며, 이 규칙 전에 쌓인 대략값(다시 보낸 기록까지 센 값)은 상세를 처음 볼 때 한 번 실제로 다시 셉니다. 아이 기기의 기록 복원 경로(`GET /records/<childId>`, 가족 코드)는 그대로입니다.
- 한도: 본문 256KB, 기록 100개/회, 틀린 단어 200개/기록, 이름 20자. 요청 제한은 `/sync`, `/family` 버킷으로 IP당 분당 30회(공통 설정).
- **세트 동기화(아이 단위)**: 세트는 `set:<childId>:<setId>` 키로 아이에게 속합니다. 아이 기기는 `POST /sets/<childId>`(가족 코드)에 기기의 세트 목록(`known`: id·수정 시각), 새로 만들거나 고친 세트 전체(`sets`), 지운 세트 묘비(`deleted`)를 보내고, 서버에 없거나 더 새 버전인 세트 전체와 지워진 id, 전체 요약을 받습니다. 세트마다 `updatedAt`이 나중인 쪽이 이기고 삭제는 `deletedAt` 묘비로 남아 다른 기기에서도 지워집니다(지운 뒤 다른 기기가 고치면 되살아남). 보호자 폰은 `GET /family/<childId>/sets`로 목록을 보고 `POST`로 세트를 만들어 보내거나 고치며(`updatedAt`은 서버가 붙임) `DELETE …/sets/<setId>`로 지웁니다. 아이 항목의 `sets` 요약은 서버가 계산하고, 동기화를 시작한 아이는 옛 앱이 `/sync`로 보낸 세트 목록으로 덮어쓰지 않습니다. 한도: 아이당 50세트, 세트당 2,000단어, 본문 2MB. 아이를 지우면 세트도 지워집니다.
- 2026-10-18 이전에 배포한 Worker에는 이 기능이 없어 앱이 “다시 배포” 안내를 띄웁니다. `npm run deploy` 뒤 `npm run parent-code`를 실행하세요.

## 오늘의 단어 (매일 생성 · 크론)

보호자가 아이별 계획(`POST /family/<childId>/plan`: 켜기, 수준, 하루 단어 수 5~20, 만드는 시각 0~23시 KST)을 저장하면, 매시 0분에 실행되는 크론(`wrangler.jsonc`의 `triggers.crons`)이 한국 시각 기준 계획 시각이 지난 아이의 그날 단어를 만들어 `FamilyStore`에 저장합니다. 아이 기기가 먼저 열리면 `POST /daily/<childId>`로 그 자리에서 만듭니다(같은 날 두 번 만들지 않음).

- 구성: 복습 최대 3개(최근 14일 기록의 틀린 단어, 최신순) + 새 단어. 새 단어는 `DAILY_MODEL`(기본 `claude-sonnet-5-5`)에 수준 문구, 아이 기기가 `/sync`로 보낸 최근 세트 단어(교재 앵커, 최대 60개; 손대지 않은 기본 예제 세트는 제외하고, 기기가 `words`가 빈 `anchor`를 보내면 저장된 앵커를 지우며 `anchor`를 아예 보내지 않으면 그대로 둠), 최근에 이미 낸 단어(최대 200개), 복습 단어를 넘겨 필요한 수의 2배를 받은 뒤 앵커·이미 낸 단어·규칙 위반을 걸러 채웁니다. 모자라면 한 번 더 요청합니다. 아이별 ‘이미 낸 단어’는 5,000개까지 기억합니다.
- 두 번째 요청이 실패(시간 초과·거부·잘림 등)해도 첫 요청에서 얻은 새 단어가 있으면 그 단어로(하루 단어 수보다 적게) 저장합니다. 아이 기기가 오류(504) 대신 오늘의 단어를 받고, 크론이 다음 시간에 AI를 또 부르지 않습니다(`npm run tail`에 `daily_partial` 줄). 첫 요청부터 실패하면 저장하지 않고 다음에(아이 기기가 다시 열 때, 크론은 다음 시간에) 다시 만듭니다.
- 형식은 AI 사전과 같아(영어·뜻·발음·허용 답안) 앱의 시험 엔진이 그대로 채점합니다. 기록에 `daily: "YYYY-MM-DD"`가 붙어 오면 그날 것에 완료(점수)를 표시합니다(중단 기록 제외).
- 비용: 아이당 하루 1회, 텍스트 20단어 안팎이라 1원 미만 수준입니다. 품질이 아쉬우면 `DAILY_MODEL`을 `claude-opus-5-5`로 바꾸고 `npm run deploy`.
- 크론은 Workers 무료 플랜에서 동작합니다. 배포 로그의 `scheduled` 항목 또는 `npm run tail`의 `daily_cron` 줄로 확인할 수 있습니다.

## 알림 (Web Push · VAPID 키)

아이 기기에 📬 오늘의 단어 도착·✏️ 공부 리마인더를, 보호자 폰에 🧒 시험 마침·🌙 저녁 요약을 보냅니다. Worker가 **Web Push**(VAPID 서명 + RFC 8291 aes128gcm 본문 암호화, 외부 라이브러리 없이 WebCrypto)로 Apple·Google 푸시 서비스에 보내고, 앱의 서비스워커(`sw.js`)가 알림을 띄웁니다. 푸시 서비스는 지역 제한이 없어 북미 중계(RELAY)를 거치지 않습니다. 설계는 `docs/NOTIFICATIONS.md`.

**처음 한 번: 키 만들기·등록 (약 2분)**
1. 키 쌍 만들기(화면에만 출력되고 파일로 저장되지 않습니다):
   ```bash
   npm run vapid
   ```
2. 출력된 `VAPID_PUBLIC_KEY` 값을 `wrangler.jsonc`의 `vars`에서 `"VAPID_PUBLIC_KEY": ""` 자리에 붙입니다(공개 값이라 커밋해도 됩니다). `VAPID_SUBJECT`는 앱 주소(`https://hongtaehwa.github.io/daily-vocab/`) 그대로 둡니다(이메일을 저장소에 두지 않으려고 URL을 씁니다).
3. 출력된 `VAPID_PRIVATE_KEY` 값을 비밀값으로 넣습니다(프롬프트에 오른쪽 클릭이나 Ctrl+Shift+V로 붙여넣기). 이 값은 파일·메모·채팅에 남기지 마세요:
   ```bash
   npx wrangler secret put VAPID_PRIVATE_KEY
   ```
4. 배포:
   ```bash
   npm run deploy
   ```
5. 아이 기기(설정 → 가족 기록함 → 🔔 이 기기에서 알림 받기)와 보호자 폰(보호자 앱 ⚙️ 설정 → 🔔 알림)에서 켜고 `테스트 알림 보내기`로 확인합니다. 아이폰은 홈 화면에 설치한 앱에서만 됩니다(iOS 16.4+).

키가 없거나 형식이 틀리면 `/push/…`가 503 `push_unconfigured`를 돌려주고 앱은 ‘알림 서버가 아직 준비되지 않았어요’를 보입니다. 다른 기능에는 영향이 없습니다. 배포 순서는 앱(Pages)이 먼저 머지돼도 괜찮습니다(키 등록·배포 뒤 기기에서 켜면 됩니다).

**⚠️ 키를 바꾸지 마세요**: 이미 쓰고 있는 키를 바꾸면(`npm run vapid`를 다시 실행해 등록) 모든 기기의 구독이 무효가 되어 알림이 끊깁니다. 바꿔야 한다면 바꾼 뒤 **모든 아이 기기와 보호자 폰에서 알림을 껐다가 다시 켜야** 합니다(다시 켤 때 앱이 새 키로 구독을 새로 만듭니다. 옛 키의 구독은 전송이 5번 실패하면 서버가 지웁니다).

**보내는 것과 때**
- `daily`(아이 기기): 크론이 그날 오늘의 단어를 만든 직후, 또는 보호자가 ‘오늘 것 지금 만들기’(`POST /daily/<id>`를 보호자 코드로)로 만든 직후. 아이 기기가 앱을 열어 스스로 만든 때는 보내지 않습니다. 응답을 먼저 돌려준 뒤 보냅니다.
- `reminder`(아이 기기): 매시 크론에서 아이 계획의 `remindHour`(한국 시각)와 같은 시각에, 그날(한국 날짜) 끝낸 기록(중단 제외)이 없으면 하루 한 번(`sent:<childId>:<날짜>:reminder` 표시).
- `finish`(보호자 폰): `/sync`로 처음 들어온 완료 기록 중 6시간 안에 끝낸 가장 최근 1건. 한 번에 4개 이상 오면 밀린 기록으로 보고 보내지 않습니다. 보호자 기기의 `kinds.finish`가 꺼져 있으면 보내지 않습니다. 같은 아이 것은 `Topic`으로 합쳐집니다. `/sync`는 알림을 기다리지 않고 먼저 응답합니다(Durable Object 안에서 이어서 보냄) — 보호자 기기가 여러 대이고 푸시 서비스가 느려도 아이 기기의 기록 보내기(20초 제한)가 ‘못 보낸 기록’이 되지 않습니다.
- `summary`(보호자 폰): 매시 크론에서 보호자 기기의 `summaryHour`(기본 21)와 같은 시각에 하루 한 번, 아이별 그날 한 줄(기기도 기록도 없는 아이는 뺌, 보낼 아이가 없으면 보내지 않음).
- `test`: `POST /push/test`.
- 문구는 Worker가 만들고(`PUSH_TEXT`), 아이 이름·세트 이름·점수·경고 횟수 외에는 넣지 않습니다. TTL은 daily·reminder·summary 1일, finish 1시간, test 5분.
- 한 아이의 기기 여러 대·보호자 기기 여러 대에는 차례로가 아니라 한꺼번에 보냅니다(구독마다 10초 제한).

**구독 저장·정리**
- `push:child:<childId>:<deviceId>`(가족 코드로만 만듦, 아이당 10대), `push:parent:<deviceId>`(보호자 코드로만, 5대). 같은 기기는 덮어쓰고, 같은 브라우저(endpoint)가 다른 기기 id로 오면 옛 것을 지우며, 상한을 넘으면 가장 오래 소식이 없는 구독부터 지웁니다.
- 푸시 서비스가 404·410(만료)을 주면 바로 지우고, 그 밖의 실패(5xx·429·네트워크·400/401/403)가 5번 연달아면 지웁니다. 로그에는 상태 코드와 종류만 남고 endpoint·키는 남기지 않습니다(400/401/403은 키 문제일 수 있다는 표시).
- 앱(아이 기기·보호자 앱)은 마지막 등록 뒤 하루가 지나면 구독이 그대로여도 앱을 열 때 `/push/subscribe`를 다시 보냅니다(같은 기기는 덮어써 몇 번 보내도 같음). 일시적인 실패로 서버에서 지워진 구독이 하루 안에 되살아납니다.
- 아이를 지우면 그 아이 기기들의 구독과 ‘보냄’ 표시도 지웁니다. 크론이 3일 지난 `sent:` 표시를 지웁니다.

## 지역 차단과 북미 중계 (Durable Object)

한국에서 온 요청은 Cloudflare의 홍콩(HKG) 데이터센터에서 실행될 때가 있는데, Anthropic은 홍콩발 요청을 `403 forbidden: Request not allowed`로 거절합니다. 그래서 Worker는 Anthropic 호출만 북미에 고정된 Durable Object(`AnthropicRelay`, `locationHint: wnam`)를 통해 보냅니다. `wrangler.jsonc`의 `durable_objects`와 `migrations`가 이 설정이며, 무료 플랜에서 동작합니다.

확인 방법(비밀값 불필요): `https://daily-vocab-ai.reonwipe.workers.dev/diag` 를 열면 `{"colo":"HKG","relay":true,"upstreamStatus":401,"ok":true,…}` 처럼 나와야 합니다. `ok`가 `false`이고 `upstreamStatus`가 403이면 중계가 동작하지 않는 것입니다.

같은 이유로 앱의 오류 안내는 Anthropic의 응답 코드·종류·메시지를 `[Anthropic 403 forbidden: Request not allowed]` 형태로 덧붙여 보여 줍니다. 키 형식이 잘못 등록된 경우(공백·줄바꿈·제어 문자)는 Anthropic에 보내기 전에 걸러서 "키가 올바른 형식이 아닙니다(길이 N, …)"로 알려 줍니다. 터미널에서 Ctrl+V가 붙여넣기 대신 제어 문자를 입력하는 경우가 있으니, `wrangler secret put` 프롬프트에는 마우스 오른쪽 클릭이나 Ctrl+Shift+V로 붙여넣으세요.

## 설정 바꾸기

| 항목 | 방법 |
|---|---|
| 모델 | `wrangler.jsonc`의 `CLAUDE_MODEL` (`claude-opus-5-5` 기본 / `claude-sonnet-5-5` / `claude-haiku-5-5`) 수정 후 `npm run deploy`. 2차 채점 모델은 `GRADE_MODEL`(기본 `claude-haiku-5-5`), 단어 찾기는 `LOOKUP_MODEL`(기본 `claude-sonnet-5-5`), 문제 물어보기는 `TUTOR_MODEL`(기본 `claude-sonnet-5-5`, 더 정확하게는 `claude-opus-5-5`), 오늘의 단어는 `DAILY_MODEL` |
| 오늘의 단어 모델 | `wrangler.jsonc`의 `DAILY_MODEL` (기본 `claude-sonnet-5-5`) 수정 후 `npm run deploy` |
| 오늘의 단어 크론 | `wrangler.jsonc`의 `triggers.crons` (기본 매시 0분; 생성 시각은 아이별 계획의 `hour`) |
| 허용 주소 | `wrangler.jsonc`의 `ALLOWED_ORIGINS` (쉼표로 여러 개). 앱 주소가 바뀌면 여기도 바꿉니다 |
| 분당 요청 제한 | `wrangler.jsonc`의 `ratelimits[0].simple.limit` (기본 30회/분, IP당) |
| 접속 코드 변경 | `npx wrangler secret put APP_PASSCODE` 후 태블릿의 보호자 설정에서 새 코드 저장 |
| 보호자 코드 등록·변경 | `npm run parent-code`(= `npx wrangler secret put PARENT_PASSCODE`) 후 보호자 폰의 설정 → 가족 기록함에 새 코드 저장 |
| 알림 키 | `npm run vapid` → `wrangler.jsonc`의 `VAPID_PUBLIC_KEY` + `npx wrangler secret put VAPID_PRIVATE_KEY` → `npm run deploy`(위 ‘알림’ 절). 한 번 등록한 키는 바꾸지 않습니다 |
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
| `POST /tutor` · 헤더 `X-App-Passcode` · JSON `{ image: base64, mediaType, kind: "explain"\|"translate"\|"grammar"\|"check"\|"ask", question?, child?: { id } }` | 문제 물어보기(아이 기기의 찾기 탭). 문제지 사진 한 장을 읽어 `{ kind, problem, summary, translation, steps[], grammar[], answer, checked, words: [{ en, ko }], note, model, usage }`를 돌려줍니다. 모델은 `TUTOR_MODEL`(기본 `claude-sonnet-5-5`). `child.id`가 연결된 아이면 사진 없이 `{ id, kind, question, problem, summary, askedAt }` 요약만 가족 기록함에 남겨 `GET /family/<childId>`의 `questions`(최신 100개)와 아이의 `questionCount`/`lastQuestionAt`으로 보여 줍니다(아이당 300개 보관) |
| `POST /lookup` · 헤더 `X-App-Passcode` · JSON `{ word }` | 단어 찾기(아이 기기의 🔍 찾기 탭). 영어 단어·짧은 구 하나 → `{ found, en, suggestion, pos, ko, ipa, aliases, examples: [{ en, ko }], similar, note, model, usage }`. 모르는 단어·철자 오류는 `found: false`와 철자 제안 `suggestion`. 모델은 `LOOKUP_MODEL`(기본 `claude-sonnet-5-5`) |
| `POST /grade` · 헤더 `X-App-Passcode` · JSON `{ en, ko, aliases?, answer }` | AI 2차 채점. 앱이 책의 뜻·허용 답안과 글자 그대로 맞지 않는 답만 보내면 ‘같은 뜻인지’ 판정 → `{ accept, reason, model, usage }`. 모델은 `GRADE_MODEL`(기본 `claude-haiku-5-5`, 빠르고 저렴). 동의어·조사/어미 차이·합성어·한 글자 오타는 인정, 다른 뜻·막연한 답·여러 뜻 나열은 거절 |
| `POST /define` · 헤더 `X-App-Passcode` · JSON `{ words: ["apple", …] }` | AI 사전. 영어 단어·짧은 구 최대 60개(영문자·공백·.'’- 40자 이하) → `{ words: [{ en, ko, ipa, aliases }], note, model, usage }`. 요청한 철자 그대로 한 번씩 돌려주고 모르는 단어는 빠집니다(전부 모르면 422). 앱의 ‘빈 뜻 AI로 채우기’가 40개씩 보냅니다 |
| `POST /sync` · 헤더 `X-App-Passcode`(가족 또는 보호자 코드) · JSON `{ child: { id, name }, records: [{ id, setName, mode, range, startedAt, completedAt, total, correct, partial, activeMs, daily?, awayCount?, awayMs?, timeouts?, missed: [{ en, ko, unknown? }] }], sets: [{ name, count }], anchor?: { setName, words }, device?: { id, label } }` | 아이 기기의 시험 기록 저장(기록 최대 100개, 같은 id는 덮어씀). `anchor.words`가 비어 있으면 저장된 수준 기준을 지웁니다. 보호자가 지운 아이 id는 404 `unknown_child`. `{ ok, stored, trimmed, syncedAt }` |
| `GET /family?days=<1~30>` · 헤더 `X-App-Passcode`(보호자 코드만) | 아이별 요약 `{ children: [{ id, name, sets, lastTestAt, updatedAt, recordCount, streakDays, streakLastDay, records }], serverTime }`. `records`는 최근 `days`일(기본 14, 20개 미만이면 최근 20개), 최신순. `streakDays`는 시험을 본 날(한국 날짜, 중단 기록 포함)이 `streakLastDay`(가장 최근에 본 날)까지 며칠 이어졌는지로, 전체 기록 기준이라 `days` 창에 잘리지 않습니다(최근 400일까지; 오늘·어제까지 이어졌는지는 앱이 판단). 범위 밖 `days`는 400 |
| `GET /family/<childId>?days=<1~365>&limit=<1~500>` · 보호자 코드 | 한 아이의 상세 `{ child, records, recordCount, more, today, questions }`(`child`에 `streakDays`·`streakLastDay`). `records`는 최근 `days`일(기본 30) 안에서 최신순 최대 `limit`개(기본 200), `recordCount`는 전체 기록 수, `more`는 보낸 것보다 오래된 기록이 있으면 true(`questions`는 문제 물어보기 요약 최신 100개). 숫자가 아니거나 범위 밖이면 400, 모르는 아이는 404 `unknown_child` |
| `GET /family/<childId>/records?before=<ISO>&limit=<1~500>` · 보호자 코드 | 보호자 앱 ‘더 보기’: `before`보다 먼저 끝난(미포함) 기록을 최신순으로 `limit`개(기본 100), `before`가 없으면 가장 최근부터. `{ records, more, serverTime }`. 잘못된 `before`·`limit`는 400, 모르는 아이는 404 `unknown_child`. 요청 제한은 `/family` 버킷 |
| `DELETE /family/<childId>` · 보호자 코드 | 아이 항목과 기록·오늘의 단어 삭제. `{ ok, deleted }` |
| `POST /family/<childId>/plan` · 보호자 코드 · JSON `{ enabled, level, dailyCount, hour, timeLimitSec, setsLocked, remindHour }` | 오늘의 단어 계획과 문제당 제한 시간(0 또는 5~120초, 모든 시험에 적용)·세트 수정 잠금·공부 알림 시각(`null` 또는 0~23시, 한국 시각) 저장(빠진 항목은 유지). `{ ok, child }` |
| `GET /settings/<childId>` · 가족 또는 보호자 코드 | 아이 기기가 받아 가는 보호자 설정 `{ childId, name, timeLimitSec, setsLocked, dailyEnabled, dailyHour, remindHour }` |
| `GET /records/<childId>?since=<ISO>&limit=<n>` · 가족 또는 보호자 코드 | 기록 복원: 아이 기기가 자기 기록의 서버 사본을 내려받습니다. `since`가 있으면 그 시각부터(포함) 오름차순, 없으면 최신순으로 `limit`개(최대 500). `{ records: [/sync 와 같은 압축 기록 + receivedAt], more, serverTime }`. 앱은 마지막 `completedAt`을 다음 `since`로 넘기며 겹치는 id는 걸러냅니다. 모르는 아이는 404 `unknown_child`, 잘못된 `since`는 400 |
| `POST /family/children` · 보호자 코드 · JSON `{ name }` | 아이 만들기. 6자리 `joinCode`가 든 `{ ok, child }` |
| `POST /family/<childId>/code` · 보호자 코드 | 아이 코드 새로 발급(옛 코드 무효). `{ ok, child }` |
| `POST /family/<childId>/name` · 보호자 코드 · JSON `{ name }` | 이름 바꾸기. `{ ok, child }` |
| `POST /join` · 가족 또는 보호자 코드 · JSON `{ code, device: { id, label } }` | 아이 기기 연결. `{ ok, childId, name, timeLimitSec, setsLocked, dailyEnabled, dailyHour, remindHour }`. 모르는 코드는 404 `unknown_code` |
| `GET /push/key` · 가족 또는 보호자 코드 | 알림 공개 키 `{ publicKey }`. 키가 없거나 형식이 틀리면 503 `push_unconfigured`(아래 `/push/…` 모두 같음). 요청 제한 버킷 `/push` |
| `POST /push/subscribe` · 아이: 가족 코드 / 보호자: 보호자 코드 · JSON `{ role: "child", childId, device: { id, label }, subscription: { endpoint, keys: { p256dh, auth } } }` 또는 `{ role: "parent", device, subscription, kinds: { finish, summary }, summaryHour }` | 알림 구독 저장(같은 기기는 덮어씀). endpoint는 1,000자 이하 https, p256dh 87~88자·auth 22~24자 base64url, `summaryHour` 0~23(기본 21), `kinds` 기본 모두 켬. 보호자 구독에 가족 코드면 401, 모르는 아이는 404 `unknown_child`. `{ ok }` |
| `POST /push/unsubscribe` · 같은 코드 · JSON `{ role, childId?, device: { id } }` | 구독 삭제(없어도 `{ ok }`) |
| `POST /push/test` · 같은 코드 · JSON `{ role, childId?, device: { id } }` | 테스트 알림 ‘🔔 알림이 잘 와요’. `{ ok, status }`, 구독이 없으면 404 `no_subscription`, 푸시 서비스가 거절하면 502 `push_failed`(만료면 구독 삭제) |
| `POST /sets/<childId>` · 가족 또는 보호자 코드 · JSON `{ device?, known: [{ id, updatedAt }], sets: [{ id, name, words, updatedAt }], deleted: [{ id, deletedAt }] }` | 아이 기기의 세트 동기화. `{ ok, sets: [기기에 없거나 더 새 세트 전체], deleted: [지워진 id], summary: [{ id, name, count, updatedAt }], syncedAt }`. 아이당 50세트 초과는 400 `too_many_sets` |
| `GET /family/<childId>/sets` · 보호자 코드 | 아이의 세트 요약 `{ sets: [{ id, name, count, updatedAt }] }` |
| `POST /family/<childId>/sets` · 보호자 코드 · JSON `{ set: { id?, name, words } }` | 세트 만들어 보내기(또는 같은 id로 고치기). `{ ok, set: { id, name, count, updatedAt }, summary }` |
| `GET /family/<childId>/sets/<setId>` · 보호자 코드 | 세트 하나(단어 포함) `{ set }`. 없거나 지워졌으면 404 `unknown_set` |
| `DELETE /family/<childId>/sets/<setId>` · 보호자 코드 | 세트 삭제(묘비). `{ ok, summary }` |
| `GET /daily/<childId>?date=YYYY-MM-DD` · 가족 또는 보호자 코드 | 그날의 단어 `{ date, level, words: [{ id, en, ko, ipa, aliases, kind: "review"\|"new" }], note, completed? }`. 없으면 404 `no_daily`, 계획이 꺼져 있으면 409 `plan_disabled` |
| `POST /daily/<childId>` · 가족 또는 보호자 코드 · JSON `{ date? }` | 그날 것이 없으면 Claude로 만들어 저장하고 돌려줍니다(있으면 그대로) |

오류는 `{ error, message }` JSON으로 돌려주며(원인은 `npm run tail` 로그의 `anthropic_error` 줄에서 확인) `message`는 앱이 그대로 보여 주는 한국어 안내입니다. 접속 코드 오류는 401, 허용되지 않은 주소는 403, 요청 과다는 429, Anthropic 쪽 문제는 502/503/504입니다. 보호자 코드가 필요한 요청(`/family…`)에 가족 코드를 쓰면 401 “보호자 코드가 맞지 않습니다”, 보호자 코드를 등록하지 않았으면 500, 가족 기록함에 닿지 못하면 503, 모르는 아이 코드는 404 `unknown_code`입니다. Anthropic 키 문제는 앱의 접속 코드 오류(401)와 구분하기 위해 502로 돌려줍니다.

보안 메모: Origin 검사와 CORS는 다른 웹사이트가 이 Worker를 쓰지 못하게 막고, 접속 코드는 주소를 아는 사람의 무단 사용을 막습니다. 접속 코드는 태블릿 브라우저에 저장되므로, 기기를 잃어버리면 코드를 바꾸세요. 피해 범위는 어차피 Anthropic 콘솔의 사용 한도로 제한됩니다.

`tests/worker.cjs`가 CORS·접속 코드·요청 제한·입력 검증·결과 정리·AI 사전·오류 변환·가족 기록함(저장소 모의, 연속 학습 `streakDays`·옛 아이 채우기)·오늘의 단어(계획·앵커·생성·두 번째 요청 실패 때 첫 요청 단어로 저장·완료·크론)·아이 코드(아이 만들기·연결·기기·코드 재발급·이름)·알림(키·구독 검증·코드 역할, 가짜 푸시 서비스로 받은 요청의 VAPID JWT를 공개 키로 검증하고 본문을 RFC 8291로 복호화, 트리거 4종·하루 1번·만료 정리, 느린 푸시 서비스에서도 `/sync`가 먼저 응답하고 보호자 기기 여러 대에 한꺼번에 보냄)을 Node에서 확인합니다 (`node tests/worker.cjs`).

2026-10-18 이전에 배포한 Worker에는 `/define`과 가족 기록함(`/sync`, `/family`), 세트 동기화(`/sets`)가 없어 앱의 ‘빈 뜻 AI로 채우기’와 가족 기록함이 “다시 배포” 안내를 띄웁니다. `npm run deploy`로 다시 배포하면 됩니다(앱 배포와 별개, 먼저 배포해도 옛 앱과 호환).

2026-10-19(보호자 앱 C단계) 이전 Worker는 상세(`GET /family/<childId>`)에 `days`·`limit`를 무시하고 전체 기록을 주며 ‘더 보기’ 경로(`/family/<childId>/records`)가 없습니다. 보호자 앱은 그때도 오류 없이 최신 200개만 쓰고 ‘더 보기’ 버튼을 숨기니, 편할 때 `npm run deploy`로 다시 배포하면 됩니다(새 Worker는 옛 보호자 앱과도 호환).

2026-10-20 이전 Worker는 `/sync`가 시험 마침 알림을 다 보낸 뒤에 응답하고(보호자 기기가 많고 푸시 서비스가 느리면 아이 기기에 ‘못 보낸 기록’이 뜰 수 있음), 오늘의 단어 두 번째 요청이 실패하면 그날 것을 저장하지 않으며, 목록·상세에 `streakDays`가 없습니다(보호자 앱은 받은 기록으로 연속 학습을 세어 14일·30일에서 잘림). `npm run deploy`로 다시 배포하면 됩니다(새 Worker는 옛 앱과도 호환, 처음 목록을 볼 때 아이마다 기록으로 시험 본 날을 한 번 채웁니다).

2026-10-19(알림 N1) 이전 Worker에는 `/push/…`가 없어 앱의 ‘알림 받기’가 “다시 배포” 안내를 띄웁니다. 위 ‘알림’ 절대로 키를 등록하고 `npm run deploy` 하세요. 새 Worker의 `/settings`·`/join` 응답에 `dailyEnabled`·`dailyHour`·`remindHour`가 더해졌고 옛 앱은 이를 무시합니다.
