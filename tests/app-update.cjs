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
  if (!(await p.textContent("#appStatus")).includes("20261018-7"))
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
  const failed = await context.newPage();
  await failed.route("**/sets.js?*", (r) => r.abort());
  await failed.goto(url);
  if (!(await failed.textContent("#appStatus")).includes("다운로드 실패"))
    throw Error("script failure invisible");
  console.log(
    "PASS: versioned script bypasses old cache, photo feedback, app diagnostics, refresh preserves data, failed initialization visible",
  );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
