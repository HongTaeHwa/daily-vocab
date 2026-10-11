const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ serviceWorkers: "block" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install();
  await page.route("**/vendor/ocr/tesseract.min.js", () => {});
  await page.goto(process.env.APP_URL || "http://127.0.0.1:8000/day04-vocab/");
  await page.click("#createSet");
  await page.setInputFiles("#photos", {
    name: "photo.png",
    mimeType: "image/png",
    buffer: await page.screenshot(),
  });
  await page.click("#runOcr");
  if (!(await page.textContent("#ocrStatus")).includes("사진 인식을 시작"))
    throw Error("missing immediate start feedback");
  await page.clock.fastForward(31000);
  await page.waitForFunction(() => !document.getElementById("runOcr").disabled);
  if (!(await page.textContent("#ocrStatus")).includes("시간이 초과"))
    throw Error(
      "missing download timeout: " + (await page.textContent("#ocrStatus")),
    );
  await page.evaluate(() => {
    window.Tesseract = { createWorker: () => new Promise(() => {}) };
  });
  await page.click("#runOcr");
  await page.click("#cancelOcr");
  if (await page.isDisabled("#runOcr"))
    throw Error("cancel during startup cannot retry");
  await page.click("#runOcr");
  await page.clock.fastForward(91000);
  await page.waitForFunction(() => !document.getElementById("runOcr").disabled);
  if (!(await page.textContent("#ocrStatus")).includes("시간이 초과"))
    throw Error("worker startup timeout");
  await page.evaluate(() => {
    window.Tesseract = {
      createWorker: async (a, b, options) => {
        options.errorHandler("인식 데이터 다운로드 오류");
        return new Promise(() => {});
      },
    };
  });
  await page.click("#runOcr");
  await page.waitForFunction(() => !document.getElementById("runOcr").disabled);
  if (
    !(await page.textContent("#ocrStatus")).includes(
      "인식 데이터 다운로드 오류",
    )
  )
    throw Error("worker error not surfaced");
  if (errors.length) throw Error(errors.join(","));
  console.log(
    "PASS: immediate start feedback, stalled script/worker timeout, cancel during initialization, worker error recovery",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
