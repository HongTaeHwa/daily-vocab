// 사진 10장을 한 장씩 순서대로 AI 서버에 보내고 결과를 모두 보존하는지, 11장은 거부하는지 확인한다.
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ["--no-sandbox"],
  });
  const p = await b.newPage({ serviceWorkers: "block" });
  const names = ["apple", "book", "cat", "dog", "bird", "tree", "sun", "moon", "star", "sky"];
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "POST, OPTIONS",
  };
  let calls = 0,
    inFlight = 0,
    parallel = false;
  await p.route("https://ai.test/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (++inFlight !== 1) parallel = true;
    const i = calls++;
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return route.fulfill({
      status: 200,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({ words: [{ number: 0, en: names[i % 10], ko: "단어", aliases: [] }], note: "" }),
    });
  });
  await p.goto(process.env.APP_URL || "http://127.0.0.1:8000/daily-vocab/");
  await p.evaluate(() =>
    localStorage.setItem("daily_vocab_ai_v2", JSON.stringify({ server: "https://ai.test", passcode: "family-1234" })),
  );
  await p.click("#createSet");
  const image = await p.screenshot();
  const photos = Array.from({ length: 10 }, (_, i) => ({ name: `page-${i + 1}.png`, mimeType: "image/png", buffer: image }));
  await p.setInputFiles("#photos", photos);
  await p.click("#extractWords");
  await p.waitForFunction(() => !document.getElementById("extractWords").disabled);
  if (calls !== 10) throw Error("10 photos not processed: " + calls);
  if (parallel) throw Error("photos were sent in parallel");
  if ((await p.inputValue("#wordDraft")).split("\n").length !== 10) throw Error("10 results not preserved");
  await p.setInputFiles("#photos", [...photos, { name: "eleventh.png", mimeType: "image/png", buffer: image }]);
  await p.click("#extractWords");
  if (!(await p.textContent("#extractStatus")).includes("사진 11장")) throw Error("selection count missing");
  if (calls !== 10) throw Error("invalid batch processed");
  await p.check("#confirmed");
  await p.click("#saveSet");
  await p.click('[data-mode="en_ko"]');
  await p.click("#start");
  if ((await p.evaluate(() => queue.length)) !== 10) throw Error("10-photo set quiz");
  console.log("PASS: ten photos processed sequentially and retained, eleven-photo batch rejected with count");
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
