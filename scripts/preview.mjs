/* ============================================================
   preview.mjs —— 零依赖静态预览服务器（仅用于前端演示/联调）
   - 托管 public/ 目录（npm run preview 或 node scripts/preview.mjs）
   - 无后端时前端自动进入"本地演示模式"（js/mock.js 兜底）
   - 后端就绪后（server/ 提供 /api 与静态托管），直接访问后端地址即可联调
   用法：node scripts/preview.mjs   （默认端口 4173，可用 PORT 环境变量覆盖）
   ============================================================ */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "public");
const port = Number(process.env.PORT || 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch (e) {
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }
  if (urlPath === "/") urlPath = "/index.html";

  const file = path.resolve(root, "." + urlPath);
  // 防目录穿越
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found: " + urlPath);
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`[preview] 前端静态预览已启动: http://localhost:${port}`);
  console.log(`[preview] 说明：未启动后端时，页面自动使用本地演示数据；后端就绪后请通过后端地址访问联调。`);
});
