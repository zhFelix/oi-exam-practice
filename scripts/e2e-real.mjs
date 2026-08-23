/* ============================================================
   e2e-real.mjs —— 前端 × 真实后端 集成测试（jsdom）
   与 render-test.mjs 不同：fetch 指向真实后端 http://localhost:3000，
   验证前端代码（app.js/pages/components）与真实 API 契约一致，
   覆盖此前崩溃的 showFeedback 判分反馈路径、考试/成绩报告/错题本/统计。
   前置：后端已启动（npm start）；jsdom 安装到临时目录（同 render-test.mjs）：
     npm install jsdom --prefix $env:TEMP\oi-jsdom-test --cache $env:TEMP\oi-jsdom-test\.npm-cache
     Copy-Item scripts\e2e-real.mjs $env:TEMP\oi-jsdom-test\
     node $env:TEMP\oi-jsdom-test\e2e-real.mjs
   通过 0 项失败即通过（本文件亦可直接 node scripts/e2e-real.mjs 运行，需 jsdom 位于 %TEMP%\oi-jsdom-test）。
   ============================================================ */
import { createRequire } from "module";
import { readFileSync } from "fs";

const PROJECT = "D:/Felix/project/oi-exam-practice";
const BASE = "http://localhost:3000";
const require = createRequire(import.meta.url);
const { JSDOM } = require(process.env.TMP + "/oi-jsdom-test/node_modules/jsdom");

// ---- 真实后端 fetch 封装（相对路径 → BASE）----
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => realFetch(new URL(url, BASE).toString(), opts);

async function api(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await realFetch(BASE + "/api" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (res.headers.get("content-type") || "").includes("json") ? await res.json() : null;
  return { status: res.status, data };
}

// 注册新用户并获取 token（注册即登录）
const uname = "e2e_" + Date.now().toString(36);
const reg = await api("POST", "/auth/register", { username: uname, password: "secret123", confirmPassword: "secret123" });
if (reg.status !== 201) { console.error("注册失败", reg); process.exit(1); }
const token = reg.data.token;

// ---- jsdom 环境 ----
const html = readFileSync(`${PROJECT}/public/index.html`, "utf8");
const dom = new JSDOM(html, { url: BASE + "/", pretendToBeVisual: true, runScripts: "outside-only" });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.location = window.location;
globalThis.localStorage = window.localStorage;
globalThis.CustomEvent = window.CustomEvent;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Event = window.Event;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLElement.prototype.scrollTo = () => {};

// 预置登录态（boot 时通过 /auth/me 恢复）
localStorage.setItem("oi_token", token);

let pass = 0, fail = 0;
function assert(cond, name, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ FAIL: ${name}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = () => document.getElementById("app");
const modal = () => document.querySelector("#modal-root .modal");
const text = (sel) => app().querySelector(sel)?.textContent?.trim() || "";
async function waitFor(fn, name, timeout = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (fn()) return true;
    await sleep(80);
  }
  console.error(`  ✗ TIMEOUT: ${name}`); fail++; return false;
}
async function nav(hash) { window.location.hash = hash; await sleep(700); }

console.log(`\n[1] 启动（真实后端，用户 ${uname}）`);
await import(`file:///${PROJECT}/public/js/app.js`);
await sleep(500);
assert(app().innerHTML.includes("题库"), "首页渲染");
await waitFor(() => text("#total-num") === "39", "题库总数 = 39（真实后端合并题库）");
assert(app().querySelectorAll(".q-list-item").length === 20, "第 1 页 20 条");
assert(document.querySelector("#nav-user a[href='#/profile']") !== null, "登录态恢复，导航显示用户名");

console.log("\n[2] 练习判分反馈（此前崩溃路径：单选/判断/阅读/多选）");
await nav("#/practice?ids=q001,q003,q021,q012");
await waitFor(() => app().querySelector(".question-card") !== null, "练习页渲染");
// 单选 q001 答对
app().querySelector(".option[data-opt='A']").click();
app().querySelector('[data-act="submit"]').click();
await waitFor(() => app().querySelector(".qc-result") !== null, "单选判分反馈出现");
assert(text(".qc-result").includes("回答正确"), "单选反馈：回答正确");
assert(app().querySelector(".analysis") !== null, "解析区出现");
app().querySelector("#btn-next").click();
// 判断 q003 答对
await waitFor(() => app().querySelector(".judge-option") !== null, "判断题渲染");
app().querySelector('.judge-option[data-opt="true"]').click();
app().querySelector('[data-act="submit"]').click();
await waitFor(() => app().querySelector(".qc-result") !== null, "判断题判分反馈");
assert(text(".qc-result").includes("回答正确"), "判断反馈：回答正确（q003=true）");
app().querySelector("#btn-next").click();
// 阅读 q021 全对（子题1 选 B，子题2 选 正确）
await waitFor(() => app().querySelector(".sub-question") !== null, "阅读题渲染");
app().querySelector('.sub-question [data-opt="B"]').click();
app().querySelector('.sub-question [data-opt="true"]').click();
app().querySelector('[data-act="submit"]').click();
await waitFor(() => app().querySelector(".qc-result") !== null, "阅读题判分反馈");
assert(text(".qc-result").includes("回答正确"), "阅读题反馈：全对（含 judge 子题）");
assert(app().querySelectorAll(".analysis").length >= 3, "阅读题解析区渲染（子题2+整题1）");
app().querySelector("#btn-next").click();
// 多选 q012 全对（B,D,A 顺序无关）
await waitFor(() => app().querySelector(".option") !== null, "多选题渲染");
app().querySelector('.option[data-opt="B"]').click();
app().querySelector('.option[data-opt="D"]').click();
app().querySelector('.option[data-opt="A"]').click();
app().querySelector('[data-act="submit"]').click();
await waitFor(() => app().querySelector(".qc-result") !== null, "多选判分反馈");
assert(text(".qc-result").includes("回答正确"), "多选反馈：全对（顺序无关）");
app().querySelector("#btn-next").click();
await waitFor(() => modal() !== null, "会话小结弹窗");
assert(modal().textContent.includes("答对 4 题"), "小结：答对 4 题");
modal().querySelector('[data-act="cancel"]').click();

console.log("\n[3] 错题本（真实后端写入）");
// 先故意答错一题制造错题
await api("POST", "/practice/submit", { questionId: "q002", answer: ["A"] }, token); // q002 正确答案 B
await nav("#/wrong-book");
await waitFor(() => app().querySelector(".wrong-item") !== null, "错题列表非空");
assert(app().querySelector(".wrong-item .wrong-yours") !== null, "错题含你的答案");
assert(app().querySelectorAll(".wrong-item").length >= 1, "错题条目渲染");

console.log("\n[4] 模拟考试（真实后端，含阅读题）");
await nav("#/exams");
await waitFor(() => app().querySelectorAll(".exam-card").length === 5, "5 套模拟卷");
app().querySelector('.exam-card [data-start]').click(); // CSP-J
await waitFor(() => modal() !== null, "规则确认弹窗");
modal().querySelector('[data-act="ok"]').click();
await waitFor(() => app().querySelector(".exam-shell") !== null, "进入考试页");
assert(app().querySelector("#exam-timer").textContent.includes(":"), "倒计时显示");
assert(!app().textContent.includes("解析"), "考试页无解析（F3.3）");
// 答第 1 题（q001 单选 A）
app().querySelector(".option[data-opt='A']").click();
await sleep(200);
assert(app().querySelectorAll("#answer-sheet .as-cell").length === 12, "答题卡 12 题");
app().querySelector("#btn-submit").click();
await waitFor(() => modal() !== null, "交卷确认");
modal().querySelector('[data-act="ok"]').click();
await waitFor(() => app().querySelector(".score-ring") !== null, "成绩报告渲染");
assert(text(".score-num") !== "", "得分显示");
assert(app().querySelectorAll(".review-item").length === 12, "逐题回顾 12 条");
assert(app().querySelectorAll(".bar-row").length >= 3, "分类/题型条形图");
const q021Review = document.querySelector('.review-item[data-ridx="q021"]');
assert(q021Review !== null && q021Review.textContent.includes("得分"), "阅读题逐题回顾渲染（未答显示得分）");

console.log("\n[5] 学习统计（真实后端聚合）");
await nav("#/stats");
await waitFor(() => app().querySelector(".stat-card") !== null, "统计渲染");
assert(text(".stat-cards").includes("总刷题数"), "概览卡");
const catLabels = [...document.querySelectorAll("#stat-cats .bar-label")].map((x) => x.textContent);
assert(catLabels.length > 0 && catLabels.every((l) => l && l !== "undefined"), "分类条形图有名称（非 undefined）", catLabels);

console.log(`\n===== E2E 集成测试：通过 ${pass} 项，失败 ${fail} 项 =====`);
process.exit(fail ? 1 : 0);
