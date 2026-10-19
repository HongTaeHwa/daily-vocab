// 알림(Web Push)용 VAPID 키 쌍 만들기: npm run vapid
// Node 의 WebCrypto(crypto.subtle)로 P-256 키를 만들어 두 값을 화면에만 출력한다(파일로 저장하지 않음).
//   VAPID_PUBLIC_KEY  = 공개 키(base64url, 비압축 65바이트) → wrangler.jsonc 의 vars 에 적는다(공개 값이라 커밋해도 된다)
//   VAPID_PRIVATE_KEY = 비밀 키(base64url, 32바이트 d)     → npx wrangler secret put VAPID_PRIVATE_KEY 로만 넣는다(저장소·앱·메모에 남기지 않는다)
// 키를 바꾸면 이미 켜 둔 모든 기기의 알림이 끊긴다(각 기기에서 알림을 다시 켜야 한다). 처음 한 번만 만든다.
"use strict";
const { webcrypto } = require("crypto");

const b64url = (bytes) => Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

(async () => {
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = b64url(new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey)));
  const { d } = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
  console.log(`새 VAPID 키를 만들었어요. 아래 두 값은 이 화면에만 있어요.

1) 공개 키 — worker/wrangler.jsonc 의 "vars" 에서 "VAPID_PUBLIC_KEY": "" 를 이 값으로 바꿉니다(공개 값, 커밋해도 됨):

VAPID_PUBLIC_KEY=${publicKey}

2) 비밀 키 — 아래 명령을 실행하고 프롬프트에 이 값을 붙여넣습니다(파일·메모·채팅에 남기지 마세요).
   붙여넣기는 마우스 오른쪽 클릭이나 Ctrl+Shift+V(Ctrl+V 는 제어 문자가 들어갈 수 있어요):

   npx wrangler secret put VAPID_PRIVATE_KEY

VAPID_PRIVATE_KEY=${d}

3) 배포: npm run deploy
   그다음 아이 기기·보호자 폰의 설정에서 ‘알림 받기’를 켜고 ‘테스트 알림 보내기’로 확인하세요.

⚠️ 이미 키를 등록해 쓰고 있다면 바꾸지 마세요. 키를 바꾸면 모든 기기에서 알림을 다시 켜야 해요.`);
})().catch((e) => {
  console.error("VAPID 키를 만들지 못했어요:", e?.message || e);
  process.exit(1);
});
