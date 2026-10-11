const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
    serviceWorkers: "block",
  });
  await page.route("https://**/*", (route) => route.abort());
  await page.setContent(
    '<html lang="ko"><body style="font:48px sans-serif;background:white;color:black;padding:50px;line-height:2">1 apple 사과<br>2 book 책</body></html>',
  );
  await page.screenshot({ path: "/tmp/ocr-fixture.png" });
  await page.goto(process.env.APP_URL || "http://127.0.0.1:8000/day04-vocab/");
  await page.click("#createSet");
  await page.setInputFiles("#photos", [
    "/tmp/ocr-fixture.png",
    "/tmp/ocr-fixture.png",
  ]);
  await page.click("#runOcr");
  await page.waitForFunction(
    () => !document.getElementById("runOcr").disabled,
    {},
    { timeout: 180000 },
  );
  console.log("OCR STATUS", await page.textContent("#ocrStatus"));
  console.log("OCR DRAFT", await page.inputValue("#wordDraft"));
  if (!(await page.inputValue("#wordDraft")).includes("apple"))
    throw Error("OCR did not extract apple");
  if ((await page.inputValue("#wordDraft")).match(/apple/g)?.length !== 2)
    throw Error("multiple photos");
  await page.fill("#setName", "OCR 확인");
  await page.check("#confirmed");
  await page.click("#saveSet");
  if (!(await page.textContent("#draftWarnings")).includes("중복"))
    throw Error("duplicate review");
  await page.fill("#wordDraft", "1\tapple\t사과\n2\tbook\t책");
  await page.check("#confirmed");
  await page.click("#saveSet");
  await page.click('[data-mode="en_ko"]');
  await page.click("#start");
  if ((await page.evaluate(() => queue.length)) !== 2)
    throw Error("OCR corrected set quiz failed");
  console.log("PASS synthetic bilingual OCR -> correction -> save -> quiz");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
