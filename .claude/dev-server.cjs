// 로컬 개발 서버: 저장소 루트를 GitHub Pages와 같은 경로(/day04-vocab/)로 제공합니다.
// 의존성 없음. 실행: node .claude/dev-server.cjs  (기본 http://127.0.0.1:8000/day04-vocab/)
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PREFIX = "/day04-vocab/";
const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".cjs": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".gz": "application/gzip",
};

function send(res, code, body, type) {
  res.writeHead(code, {
    "Content-Type": type || "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    return send(res, 400, "Bad request");
  }
  if (pathname === "/" || pathname === PREFIX.slice(0, -1)) {
    res.writeHead(302, { Location: PREFIX });
    return res.end();
  }
  if (!pathname.startsWith(PREFIX)) return send(res, 404, "Not found: " + pathname);

  const rel = pathname.slice(PREFIX.length) || "index.html";
  let file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT)) return send(res, 403, "Forbidden");

  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, "index.html");
    fs.readFile(file, (err2, data) => {
      if (err2) return send(res, 404, "Not found: " + pathname);
      send(res, 200, data, MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`day04-vocab dev server: http://${HOST}:${PORT}${PREFIX}  (root: ${ROOT})`);
});
