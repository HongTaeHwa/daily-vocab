const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  const context = await b.newContext({ serviceWorkers: "block" });
  const p = await context.newPage();
  const url = process.env.APP_URL || "http://127.0.0.1:8000/daily-vocab/";
  await p.route("**/sets.js", (r) =>
    r.fulfill({
      status: 200,
      body: 'throw Error("old cached script")',
      contentType: "application/javascript",
    }),
  );
  await p.goto(url);
  if (!(await p.textContent("#appStatus")).includes("20261018-28"))
    throw Error("version missing");
  await p.click("#createSet");
  await p.setInputFiles("#photos", {
    name: "test.png",
    mimeType: "image/png",
    buffer: await p.screenshot(),
  });
  if (!(await p.textContent("#extractStatus")).includes("사진을 선택했습니다"))
    throw Error("current photo handler missing");
  await p.click("#tabSettings");
  await p.click("#checkApp");
  if (
    !(await p.textContent("#appStatus")).includes("사진 1장 · 추출 버튼 연결됨")
  )
    throw Error("diagnostic missing");
  await p.evaluate(() => localStorage.setItem("update-preserve", "yes"));
  p.once("dialog", (d) => d.accept());
  await p.click("#refreshApp");
  await p.waitForURL(/update=/);
  if (
    (await p.evaluate(() => localStorage.getItem("update-preserve"))) !== "yes"
  )
    throw Error("refresh erased data");
  // 보호자 앱(parent.html)도 같은 릴리스: 버전 표시, 스크립트 3개(shared → editor → parent)·스타일의 ?v=, 앱 점검
  const parent = await context.newPage();
  await parent.goto(url + "parent.html");
  if (!(await parent.textContent("#appStatus")).includes("20261018-28")) throw Error("parent version missing");
  const parentAssets = await parent.evaluate(() => [...document.querySelectorAll("script[src], link[rel=stylesheet]")].map((e) => e.getAttribute("src") || e.getAttribute("href")));
  if (JSON.stringify(parentAssets) !== JSON.stringify(["./parent.css?v=20261018-28", "./shared.js?v=20261018-28", "./editor.js?v=20261018-28", "./parent.js?v=20261018-28"]))
    throw Error("parent assets: " + JSON.stringify(parentAssets));
  await parent.evaluate(() => document.getElementById("checkApp").click()); // 코드가 없으면 설정 화면이 숨어 있어 직접 누른다
  if (!(await parent.textContent("#appStatus")).includes("앱 준비 완료 · 편집기 연결됨")) throw Error("parent diagnostic: " + (await parent.textContent("#appStatus")));
  const failed = await context.newPage();
  await failed.route("**/sets.js?*", (r) => r.abort());
  await failed.goto(url);
  if (!(await failed.textContent("#appStatus")).includes("다운로드 실패"))
    throw Error("script failure invisible");
  console.log(
    "PASS: versioned script bypasses old cache, photo feedback, app diagnostics, refresh preserves data, failed initialization visible, parent app version/assets/diagnostics",
  );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
