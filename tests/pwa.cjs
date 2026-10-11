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
  await p.goto(process.env.APP_URL || "http://127.0.0.1:8000/daily-vocab/");
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
  // 이후 요청 가로채기를 위해 서비스워커 해제
  await p.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  });
  await p.reload();
  await p.evaluate(() =>
    localStorage.setItem(
      "daily_vocab_ai_v2",
      JSON.stringify({ server: "https://ai.test", passcode: "family-1234" }),
    ),
  );
  let mode = "error";
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "POST, OPTIONS",
  };
  await p.route("https://ai.test/**", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    if (mode === "error")
      return route.fulfill({
        status: 503,
        headers: cors,
        contentType: "application/json",
        body: JSON.stringify({ error: "upstream", message: "AI 서버가 혼잡합니다." }),
      });
    await new Promise((r) => setTimeout(r, 1500));
    return route.fulfill({
      status: 200,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({ words: [{ number: 0, en: "apple", ko: "사과", aliases: [] }], note: "" }),
    });
  });
  await p.click("#createSet");
  await p.setInputFiles("#photos", {
    name: "valid.png",
    mimeType: "image/png",
    buffer: await p.screenshot(),
  });
  await p.click("#extractWords");
  await p.waitForFunction(() => !document.getElementById("extractWords").disabled);
  if (!(await p.textContent("#extractStatus")).includes("가져오지 못했습니다"))
    throw Error("server error surfaced");
  mode = "slow";
  await p.click("#extractWords");
  await p.click("#cancelExtract");
  await p.waitForTimeout(2000);
  if (await p.inputValue("#wordDraft")) throw Error("cancel stale write");
  if (errors.length) throw Error(errors.join(","));
  console.log(
    "PASS: tablet portrait/landscape/mobile layout, manifest/icons, offline shell, AI error/cancellation",
  );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
