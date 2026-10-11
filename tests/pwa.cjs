const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  const p = await b.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(process.env.APP_URL || "http://127.0.0.1:8000/day04-vocab/");
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload();
  for (const size of [
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await p.setViewportSize(size);
    if (
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    )
      throw Error("layout overflow " + JSON.stringify(size));
  }
  const m = await p.evaluate(
    async () => await (await fetch("./manifest.webmanifest")).json(),
  );
  for (const icon of m.icons) {
    if (!(await p.evaluate(async (path) => (await fetch(path)).ok, icon.src)))
      throw Error("icon missing");
  }
  await p.context().setOffline(true);
  await p.reload();
  if ((await p.locator("#setSelect option").count()) !== 1)
    throw Error("offline shell");
  await p.context().setOffline(false);
  await p.click("#createSet");
  await p.setInputFiles("#photos", {
    name: "bad.png",
    mimeType: "image/png",
    buffer: Buffer.from("bad image"),
  });
  await p.evaluate(() => {
    window.Tesseract = {
      createWorker: async () => ({
        recognize: async () => {
          throw Error("Invalid image");
        },
        terminate: async () => {},
      }),
    };
  });
  await p.click("#runOcr");
  await p.waitForFunction(() => !document.getElementById("runOcr").disabled);
  if (!(await p.textContent("#ocrStatus")).includes("인식 실패"))
    throw Error("invalid image");
  await p.evaluate(() => {
    window.Tesseract = {
      createWorker: async () => ({
        recognize: () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ data: { text: "apple 사과", confidence: 90 } }),
              500,
            ),
          ),
        terminate: async () => {},
      }),
    };
  });
  await p.setInputFiles("#photos", {
    name: "valid.png",
    mimeType: "image/png",
    buffer: await p.screenshot(),
  });
  await p.click("#runOcr");
  await p.click("#cancelOcr");
  await p.waitForTimeout(700);
  if (await p.inputValue("#wordDraft")) throw Error("cancel stale write");
  if (errors.length) throw Error(errors.join(","));
  console.log(
    "PASS: tablet portrait/landscape/mobile layout, manifest/icons, offline shell, OCR error/cancellation",
  );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
