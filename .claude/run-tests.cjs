// Playwright 브라우저 테스트 실행기.
//   node .claude/run-tests.cjs              → 전체 (worker, browser, pwa, app-update, ten-photos, ai-recognition)
//   node .claude/run-tests.cjs --all        → 위와 같음 (느린 테스트 없음)
//   node .claude/run-tests.cjs browser pwa  → 지정한 테스트만
// 전역 설치된 playwright(npm i -g playwright)를 NODE_PATH로 연결하고,
// 127.0.0.1:8000 에 서버가 없으면 .claude/dev-server.cjs 를 자동으로 띄웁니다.
"use strict";
const { spawn, spawnSync, execSync } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const APP_URL = process.env.APP_URL || "http://127.0.0.1:8000/daily-vocab/";
const FAST = ["worker", "browser", "pwa", "app-update", "ten-photos", "ai-recognition", "session"];
const ALL = [...FAST];

const args = process.argv.slice(2);
const names = args.includes("--all")
  ? ALL
  : args.filter((a) => !a.startsWith("--")).length
    ? args.filter((a) => !a.startsWith("--"))
    : FAST;

function globalRoot() {
  try {
    return execSync("npm root -g", { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function isUp(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode > 0);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

(async () => {
  const env = { ...process.env, APP_URL };
  const g = globalRoot();
  if (g) env.NODE_PATH = env.NODE_PATH ? `${g}${path.delimiter}${env.NODE_PATH}` : g;

  let server = null;
  if (!(await isUp(APP_URL))) {
    server = spawn(process.execPath, [path.join(__dirname, "dev-server.cjs")], {
      cwd: ROOT,
      stdio: "ignore",
    });
    for (let i = 0; i < 40 && !(await isUp(APP_URL)); i++)
      await new Promise((r) => setTimeout(r, 250));
    if (!(await isUp(APP_URL))) {
      console.error("dev server did not start at " + APP_URL);
      server.kill();
      process.exit(2);
    }
    console.log("started dev server for tests");
  }

  const results = [];
  for (const name of names) {
    const file = path.join(ROOT, "tests", name.endsWith(".cjs") ? name : name + ".cjs");
    if (!fs.existsSync(file)) {
      results.push({ name, ok: false, note: "file not found" });
      continue;
    }
    console.log(`\n=== tests/${path.basename(file)} ===`);
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [file], { cwd: ROOT, env, stdio: "inherit" });
    results.push({ name, ok: r.status === 0, note: `${((Date.now() - t0) / 1000).toFixed(1)}s` });
  }

  if (server) server.kill();

  console.log("\n=== summary ===");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${r.note})`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
