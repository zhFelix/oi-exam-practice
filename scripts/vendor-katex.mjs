/* ============================================================
   vendor-katex.mjs —— KaTeX 本地化脚本（零 CDN）
   从 node_modules/katex/dist 拷贝构建产物到 public/vendor/katex/：
   katex.min.css / katex.min.js / katex.mjs + fonts/（60 个字体文件）
   用法：npm run katex:vendor   （需先 npm install katex）
   ============================================================ */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const src = path.join(root, "node_modules", "katex", "dist");
const dst = path.join(root, "public", "vendor", "katex");

if (!fs.existsSync(src)) {
  console.error("[vendor-katex] 未找到 node_modules/katex，请先执行：npm install katex");
  process.exit(1);
}

fs.mkdirSync(dst, { recursive: true });
fs.mkdirSync(path.join(dst, "fonts"), { recursive: true });

for (const f of ["katex.min.css", "katex.min.js", "katex.mjs"]) {
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
}

const fontDir = path.join(src, "fonts");
let fontCount = 0;
for (const f of fs.readdirSync(fontDir)) {
  fs.copyFileSync(path.join(fontDir, f), path.join(dst, "fonts", f));
  fontCount++;
}

const ver = JSON.parse(fs.readFileSync(path.join(root, "node_modules", "katex", "package.json"), "utf8")).version;
console.log(`[vendor-katex] KaTeX v${ver} 已本地化 → public/vendor/katex/（css/js/esm + ${fontCount} 个字体文件）`);
