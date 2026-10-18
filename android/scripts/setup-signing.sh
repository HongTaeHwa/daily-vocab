#!/usr/bin/env bash
# 갤럭시 앱 서명 키를 한 번 만들어 GitHub Secrets에 넣는다. Git Bash에서 실행:  bash android/scripts/setup-signing.sh
# - JDK(keytool) 없이 Git Bash의 openssl로 PKCS12 키 저장소를 만든다.
# - 키 파일과 비밀번호는 android/keystore/ 에 남는다(.gitignore 대상). 안전한 곳에 백업하고 절대 커밋하지 말 것.
# - 같은 키로 계속 서명해야 태블릿에서 덮어쓰기 업데이트가 된다. 키를 잃으면 앱을 지우고 새로 설치해야 한다.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p keystore
KS="keystore/daily-vocab-upload.p12"
PW_FILE="keystore/daily-vocab-upload.password.txt"
ALIAS="dailyvocab"
if [ -f "$KS" ] && [ -f "$PW_FILE" ]; then
  echo "이미 키가 있습니다: $KS (Secrets만 다시 등록합니다)"
else
  PW="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
  TMP="$(mktemp -d)"
  openssl req -x509 -newkey rsa:2048 -sha256 -days 10000 -nodes \
    -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -subj "/CN=daily-vocab/O=family" >/dev/null 2>&1
  openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$ALIAS" \
    -out "$KS" -passout "pass:$PW"
  rm -rf "$TMP"
  printf '%s' "$PW" > "$PW_FILE"
  echo "키를 만들었습니다: $KS"
fi
PW="$(cat "$PW_FILE")"
B64="$(base64 -w0 "$KS" 2>/dev/null || base64 "$KS" | tr -d '\n')"
gh secret set ANDROID_KEYSTORE_B64 --body "$B64"
gh secret set ANDROID_KEYSTORE_PASSWORD --body "$PW"
gh secret set ANDROID_KEY_ALIAS --body "$ALIAS"
gh secret set ANDROID_KEY_PASSWORD --body "$PW"
echo "GitHub Secrets 등록 완료 (ANDROID_KEYSTORE_B64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD)."
echo "android/keystore/ 폴더(키 파일과 비밀번호)를 안전한 곳에 백업하세요. 다음 빌드부터 정식 서명으로 만들어집니다."
