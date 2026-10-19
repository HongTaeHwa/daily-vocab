# 매일 영단어 갤럭시용 앱 (웹앱 래퍼)

웹앱 https://hongtaehwa.github.io/daily-vocab/ 을 WebView로 여는 작은 안드로이드 앱입니다. 하는 일은 여섯 가지뿐이고 세트·기록·가족 기록함·오늘의 단어는 웹앱 그대로입니다.

1. **화면 캡처 금지(FLAG_SECURE)**: 이 앱 화면에서는 스크린샷·화면 녹화·**서클 투 서치**가 동작하지 않습니다(은행 앱과 같은 방식). 다른 앱에는 영향이 없습니다.
2. **화면 분할 차단**(v1.2): 앱을 화면 분할·팝업 화면으로 열어 옆에 브라우저나 AI 앱을 띄우지 못합니다. 매니페스트에 분할 비지원(`resizeableActivity="false"`)을 선언하고, Android 12 이상 태블릿처럼 OS가 분할을 강제하는 경우에는 분할이 감지되는 동안 웹앱을 가리고 **‘화면 분할은 쓸 수 없어요’** 안내만 보여 줍니다(그동안 웹앱은 ‘화면 이탈’로 기록하고 제한 시간은 계속 흐릅니다). 전체 화면으로 돌아오면 그대로 이어서 쓸 수 있습니다.
3. **음성 인식·발음 듣기 연결**: WebView에는 브라우저 음성 인식이 없어서 안드로이드 기본 음성 인식기(삼성/구글)와 TTS를 웹앱에 연결합니다(`SpeechBridge.kt`, `assets/bridge.js`). 웹앱 코드는 바뀌지 않습니다.
4. 사진 선택·촬영(세트 만들기)과 설정의 JSON 가져오기 파일 선택(v1.3: 입력의 accept를 따라 .json 파일을 고를 수 있음), 마이크 권한, 뒤로 가기(웹앱의 화면 되돌리기), 아이 전용 링크를 이 앱으로 열기.
5. **파일 내려받기**(v1.4): 설정의 **전체 백업 JSON**과 기록 탭의 **CSV 내려받기**가 앱 안에서도 됩니다. Android 10 이상은 ‘다운로드’ 폴더(내 파일 → 다운로드)에 바로 저장하고 ‘다운로드 폴더에 저장했어요: 파일 이름’이 잠깐 보입니다. Android 8·9나 저장에 실패하면 ‘다른 이름으로 저장’ 창이 열립니다. 웹앱 코드는 바뀌지 않습니다(`DownloadBridge.kt`, `assets/bridge.js`).
6. **알림**(v1.5): 앱 안의 화면(WebView)은 웹 알림(Web Push)을 받을 수 없어서, 웹앱 설정 → 가족 기록함의 **🔔 이 기기에서 알림 받기**를 누르면 앱이 스스로 알림을 띄웁니다. 보호자가 보호자 앱에서 정한 시각(한국 시각)에 **📬 오늘의 단어가 도착했어요**(오늘의 단어 시각 5분 뒤)와 **✏️ 오늘 아직 단어 시험을 안 봤어요**(공부 알림 시각, 그날 시험을 끝냈으면 울리지 않음)가 뜹니다. 처음 켤 때 Android 13 이상은 알림 권한을 묻습니다. 재부팅·앱 업데이트 뒤에도 다시 걸립니다. 웹앱 코드는 바뀌지 않습니다(`NotifyBridge.kt`, `NotifyScheduler.kt`, `assets/bridge.js`).

아이폰에는 같은 방법이 없습니다(iOS는 앱이 스크린샷·Siri 화면 읽기를 막을 수 없음). 아이폰은 스크린 타임 제한을 쓰세요.

## 설치 (갤럭시 태블릿)

1. 태블릿 브라우저로 https://github.com/HongTaeHwa/daily-vocab/releases 를 열고 가장 최근 `android-vN` 릴리스의 `daily-vocab-app-vN.apk`를 내려받습니다.
2. 알림에서 파일을 열면 “알 수 없는 앱 설치” 허용을 물어봅니다. 그 브라우저(또는 내 파일)에 대해 허용하고 설치합니다.
3. **매일 영단어** 앱을 엽니다. Chrome과 저장 공간이 다르므로 앱 안에서 다시 설정합니다: 설정 → `보호자 설정 · AI 연결`에 가족 접속 코드 저장 → `가족 기록함`에 아이 코드 입력(또는 보호자가 보낸 아이 전용 링크를 열 때 ‘매일 영단어’ 앱으로 열기). 세트는 가족 기록함에 연결하면 아이의 세트가 자동으로 들어오고, 그 밖에는 설정 → **JSON 가져오기**(v1.3부터 앱 안에서 .json 파일을 고를 수 있음)나 사진으로 만듭니다.
4. 처음 마이크 버튼을 누르면 마이크 권한을 묻습니다. 허용하면 이후 시험에서 음성 인식이 됩니다.

확인: 앱 화면에서 홈 버튼을 길게 눌러 서클 투 서치를 해 보면 “이 화면에서는 사용할 수 없음” 또는 검은 화면이 나와야 합니다. 스크린샷도 찍히지 않습니다. 최근 앱 화면에서 이 앱을 분할 화면으로 열어 보면 분할이 거부되거나, 분할된 동안 남색 바탕의 ‘화면 분할은 쓸 수 없어요’만 보여야 합니다.

## 업데이트

새 릴리스의 APK를 같은 방법으로 설치하면 덮어쓰기 됩니다. 단, **같은 서명 키**로 만든 APK여야 합니다. 아래 ‘서명 키’를 등록하지 않은 상태의 빌드는 매번 다른 debug 키로 서명되어, 업데이트 전에 기존 앱을 지워야 합니다(앱 안의 설정·세트·기록도 지워지므로 백업 JSON을 먼저 받으세요. v1.4부터 앱 안에서 설정 → 전체 백업 JSON으로 받을 수 있습니다).

## 서명 키 (한 번만)

GitHub Actions가 APK를 만들 때 쓸 서명 키를 만들어 저장소 Secrets에 넣습니다. 키 파일은 저장소에 커밋하지 않습니다.

```bash
bash android/scripts/setup-signing.sh
```

- Git Bash의 `openssl`로 PKCS12 키를 만들고(`android/keystore/daily-vocab-upload.p12`, 비밀번호는 옆의 `.password.txt`), `gh secret set`으로 `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`를 등록합니다. `gh`가 `HongTaeHwa`로 로그인되어 있어야 합니다.
- `android/keystore/`는 `.gitignore`에 들어 있습니다. 이 폴더를 안전한 곳에 백업하세요. 키를 잃으면 이후 APK를 덮어쓰기 설치할 수 없습니다.
- 등록 뒤 Actions → **Android APK** → Run workflow 로 다시 빌드하면 정식 서명 APK가 Release에 올라갑니다.

## 빌드

- GitHub Actions `.github/workflows/android-apk.yml`: PR에서는 아티팩트(`daily-vocab-app`)만 만들고, `main`에 `android/`가 바뀌어 올라가거나 수동 실행(Run workflow)하면 Release `android-vN`에 APK를 붙입니다. JDK 17, Android SDK 35, Gradle 8.9, AGP 8.7, Kotlin 2.0.
- 로컬 빌드(선택): Android Studio로 `android/` 폴더를 열거나, JDK 17과 Android SDK가 있으면 `cd android && gradle assembleRelease`.
- 버전을 올리려면 `app/build.gradle.kts`의 `versionCode`/`versionName`을 올립니다. 웹앱은 UA의 `DailyVocabApp/버전`으로 앱을 구분합니다.

## 구조

| 파일 | 역할 |
|---|---|
| `app/src/main/java/kr/dailyvocab/app/MainActivity.kt` | WebView, FLAG_SECURE, 화면 분할 가림막(`onMultiWindowModeChanged`), 권한·사진 선택·뒤로 가기·링크 처리, 내려받기 `DownloadListener`·‘다른 이름으로 저장’ 대화상자 |
| `app/src/main/java/kr/dailyvocab/app/SpeechBridge.kt` | `@JavascriptInterface AndroidSpeech`: 음성 인식(SpeechRecognizer)·TTS(TextToSpeech) → `window.__androidSpeechEvent` |
| `app/src/main/java/kr/dailyvocab/app/DownloadBridge.kt` | `@JavascriptInterface AndroidDownload`: base64 조각(begin/append/finish/abort)을 모아 MediaStore ‘다운로드’ 폴더에 저장(Android 10+), 실패·8·9는 저장 대화상자 |
| `app/src/main/java/kr/dailyvocab/app/NotifyBridge.kt` | `@JavascriptInterface AndroidNotify`: `permission()`(Android 13+ 알림 권한을 묻고 답을 기다려 `granted`/`denied`), `schedule(JSON)`, `skipToday(kind)`, `cancel()` |
| `app/src/main/java/kr/dailyvocab/app/NotifyScheduler.kt` | 로컬 알림: 설정 저장(SharedPreferences `daily_vocab_notify`), `AlarmManager.setAndAllowWhileIdle`로 다음 한 번만 예약(한국 시각), 울리면 알림 채널 ‘공부 알림’에 표시·다음 날 예약, `NotifyReceiver`(알람)·`BootReceiver`(재부팅·업데이트 뒤 재예약) |
| `app/src/main/assets/bridge.js` | 페이지 스크립트보다 먼저 실행되어 `window.SpeechRecognition`·`speechSynthesis`를 브리지로 채우고, `<a download>`·blob: 내려받기를 가로채 `AndroidDownload`로 넘기고, 웹앱의 알림 계약 `window.DailyVocabNotify`를 `AndroidNotify`로 만든다 |
| `app/src/main/AndroidManifest.xml` | 권한(INTERNET, RECORD_AUDIO, POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED), 패키지 가시성(음성 인식·카메라), 링크 인텐트 필터, 알림 수신기 2개, FileProvider |
| `scripts/setup-signing.sh` | 서명 키 생성 + Secrets 등록 |

## 버전
- v1.5 (versionCode 6): 알림 — 웹앱 설정 → 가족 기록함의 ‘🔔 이 기기에서 알림 받기’로 오늘의 단어 도착·공부 리마인더를 앱이 직접 띄움(보호자가 정한 시각, 시험을 끝낸 날은 리마인더 없음). 이전에는 ‘이 브라우저는 알림을 지원하지 않아요’로 켤 수 없었음.
- v1.4 (versionCode 5): 설정의 전체 백업 JSON·기록 탭의 CSV 내려받기가 앱 안에서 동작(Android 10 이상은 다운로드 폴더에 저장, Android 8·9와 실패 시 저장 창). 이전에는 눌러도 아무 일이 없었음.
- v1.3 (versionCode 4): 파일 선택기가 입력의 accept를 따름 — 설정의 JSON 가져오기에서 .json 파일을 고를 수 있음(이전에는 늘 사진만 보여 가져오기가 불가능했음). 사진 선택·촬영은 그대로.
- v1.2 (versionCode 3): 화면 분할·팝업 화면 차단(분할 비지원 선언 + 분할 중 가림막).
- v1.1 (versionCode 2): 상태 표시줄·내비게이션 바·키보드 여백 처리(Android 15에서 상단 시계가 가려지던 문제).
- v1.0 (versionCode 1): 첫 버전.

## 문제가 생기면

- 음성 인식이 “서비스가 차단됐습니다”로 나오면 태블릿에 Google 앱(음성 서비스)이 꺼져 있는 것입니다. 설정 → 일반 → 키보드 목록 및 기본값 → 음성 입력에서 Google 음성 인식을 켜세요.
- 사진 촬영 버튼이 반응하지 않으면 카메라 앱이 없는 기기입니다. ‘사진 선택’으로 갤러리에서 고르세요.
- 설정 → JSON 가져오기에서 .json 파일이 회색으로 보이거나 사진만 고를 수 있으면 v1.2 이하입니다. v1.3 이상으로 업데이트하세요.
- 설정 → 전체 백업 JSON이나 기록 탭 → CSV 내려받기를 눌러도 아무 일이 없으면 v1.3 이하입니다. v1.4 이상으로 업데이트하세요. 저장된 파일은 내 파일 → 다운로드에 있습니다.
- 설정 → 가족 기록함에 ‘이 브라우저는 알림을 지원하지 않아요’가 보이면 v1.4 이하입니다. v1.5 이상으로 업데이트하세요. ‘알림 권한이 꺼져 있어요’면 태블릿 설정 → 애플리케이션 → 매일 영단어 → 알림을 켜세요. 알림이 늦게 오면(몇 분) 절전 때문이며 정상입니다. 시각은 보호자 앱 → 아이 화면 → 설정의 ‘⏰ 공부 알림 시각’과 오늘의 단어 시각을 따릅니다.
- 앱이 옛 화면을 보여 주면 앱을 완전히 닫았다 다시 열거나, 웹앱 설정 → 새 버전 불러오기를 누르세요.
