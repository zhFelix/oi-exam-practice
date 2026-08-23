/* ============================================================
   render-test.mjs —— 前端页面渲染集成测试（jsdom）
   模拟真实浏览器 DOM，走完用户主流程：
   首页(匿名) → 登录(demo) → 练习(即时判分) → 模拟考(考试/交卷/成绩) → 错题本 → 统计

   运行（jsdom 为临时测试依赖，安装到系统临时目录，不进入项目依赖）：
     npm install jsdom --prefix $env:TEMP\oi-jsdom-test --cache $env:TEMP\oi-jsdom-test\.npm-cache
     Copy-Item scripts\render-test.mjs $env:TEMP\oi-jsdom-test\
     node $env:TEMP\oi-jsdom-test\render-test.mjs
   通过 0 项失败即通过。
   ============================================================ */

import { createRequire } from "module";
import { readFileSync } from "fs";

const PROJECT = "D:/Felix/project/oi-exam-practice";
const require = createRequire(import.meta.url);
const { JSDOM } = require(process.env.TMP + "/oi-jsdom-test/node_modules/jsdom");

// ---- 加载 index.html 到 jsdom ----
const html = readFileSync(`${PROJECT}/public/index.html`, "utf8");
const dom = new JSDOM(html, { url: "http://localhost:4173/", pretendToBeVisual: true, runScripts: "outside-only" });
const { window } = dom;

// ---- 全局注入浏览器 API ----
globalThis.window = window;
globalThis.document = window.document;
globalThis.location = window.location;
globalThis.localStorage = window.localStorage;
globalThis.CustomEvent = window.CustomEvent;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Event = window.Event;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
// jsdom 未实现的滚动 API（浏览器原生支持，仅测试环境需要垫片）
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLElement.prototype.scrollTo = () => {};

let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ FAIL: ${name}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = () => document.getElementById("app");
const modal = () => document.querySelector("#modal-root .modal");
const text = (sel) => app().querySelector(sel)?.textContent?.trim() || "";

// 等待条件成立（轮询，最多 3s）
async function waitFor(fn, name, timeout = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (fn()) return true;
    await sleep(60);
  }
  console.error(`  ✗ TIMEOUT: ${name}`);
  fail++;
  return false;
}

// 导航辅助：设置 hash（jsdom 会触发 hashchange），等待路由渲染
async function nav(hash) {
  window.location.hash = hash;
  await sleep(600);
}

console.log("\n[1] 启动应用（匿名访问首页）");
await import(`file:///${PROJECT}/public/js/app.js`);
await sleep(400);
assert(app().innerHTML.includes("题库"), "首页渲染出页面标题");
await waitFor(() => text("#total-num") === "26", "题库总数显示 26");
assert(app().querySelectorAll(".q-list-item").length === 20, "列表渲染 20 条（第 1 页）");
assert(app().querySelectorAll("#f-cat .chip").length === 7, "知识点筛选 7 个 chip");
assert(app().querySelectorAll("#f-comp button").length === 9, "竞赛类型 Segmented 8 项 + 全部");

console.log("\n[2] 登录（演示账号 demo / 123456）");
await nav("#/login");
assert(app().querySelector("#login-form"), "登录页渲染");
const loginForm = app().querySelector("#login-form");
loginForm.querySelector("#login-user").value = "demo";
loginForm.querySelector("#login-pass").value = "123456";
loginForm.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
await sleep(800);
assert(text("#nav-user") === "", "导航用户区存在");
assert(document.querySelector("#nav-user a[href='#/profile']") !== null, "登录后导航显示用户名入口");

console.log("\n[3] 练习答题（ids=q001,q003，单选+判断）");
await nav("#/practice?ids=q001,q003");
await waitFor(() => app().querySelector(".question-card") !== null, "练习页渲染题目卡片");
assert(app().querySelectorAll(".option").length === 4, "单选题 4 个选项");
// 作答并提交
const firstOpt = app().querySelector(".option[data-opt='A']");
firstOpt.click();
const submitBtn = app().querySelector('[data-act="submit"]');
assert(!!submitBtn, "存在提交按钮");
submitBtn.click();
await waitFor(() => app().querySelector(".qc-result") !== null, "判分反馈出现");
assert(text(".qc-result").includes("回答正确"), "单选答对反馈");
assert(app().querySelector(".analysis") !== null, "解析区出现");
// 下一题（判断题）
app().querySelector("#btn-next").click();
await waitFor(() => app().querySelector(".judge-option") !== null, "判断题渲染");
app().querySelector('.judge-option[data-opt="true"]').click();
app().querySelector('[data-act="submit"]').click();
await waitFor(() => app().querySelector(".qc-result") !== null, "判断题判分反馈");
assert(text(".qc-result").includes("回答正确"), "判断题答对（q003 答案 true）");
app().querySelector("#btn-next").click();
await waitFor(() => modal() !== null, "会话小结弹窗");
assert(modal().textContent.includes("答对 2 题"), "小结：答对 2 题");
modal().querySelector('[data-act="cancel"]').click();
await sleep(200);

console.log("\n[4] 模拟考试全流程");
await nav("#/exams");
await waitFor(() => app().querySelectorAll(".exam-card").length === 3, "3 套模拟卷");
app().querySelector('.exam-card [data-start]').click(); // CSP-J
await waitFor(() => modal() !== null, "规则确认弹窗");
modal().querySelector('[data-act="ok"]').click();
await sleep(1000);
await waitFor(() => app().querySelector(".exam-shell") !== null, "进入考试页");
assert(app().querySelector("#exam-timer").textContent.includes(":"), "倒计时显示");
assert(app().querySelector(".as-grid .as-cell") !== null, "答题卡渲染");
assert(!app().textContent.includes("解析"), "考试页不出现解析（F3.3）");
assert(!app().textContent.includes("回答正确") && !app().textContent.includes("回答错误"), "考试页不出现对错反馈");
// 作答第 1 题并跳转第 2 题
const q1 = app().querySelector(".option");
q1.click();
await sleep(200);
app().querySelector("#btn-next").click();
await sleep(400);
const asCells = app().querySelectorAll("#answer-sheet .as-cell");
assert(asCells.length === 12, "答题卡 12 题（侧栏）");
assert(app().querySelectorAll("#sheet-drawer .as-cell").length === 12, "答题卡 12 题（移动端抽屉）");
// 交卷
app().querySelector("#btn-submit").click();
await waitFor(() => modal() !== null, "交卷二次确认弹窗");
assert(modal().textContent.includes("确认交卷"), "交卷确认文案");
modal().querySelector('[data-act="ok"]').click();
await sleep(1500);
await waitFor(() => app().querySelector(".score-ring") !== null, "成绩报告渲染");
assert(text(".score-num") !== "", "得分数字显示");
assert(app().querySelectorAll(".review-item").length === 12, "逐题回顾 12 条");
assert(app().querySelectorAll(".bar-row").length >= 3, "分类/题型条形图渲染");

console.log("\n[5] 错题本");
await nav("#/wrong-book");
await waitFor(() => app().querySelectorAll(".wrong-item").length > 0, "错题列表非空");
assert(app().querySelector(".wrong-item .wrong-yours"), "错题含你的答案");

console.log("\n[6] 学习统计");
await nav("#/stats");
await waitFor(() => app().querySelector(".stat-card") !== null, "统计概览卡渲染");
assert(text(".stat-cards").includes("总刷题数"), "概览卡标签");
assert(app().querySelectorAll(".bar-row").length >= 3, "统计条形图渲染");

console.log(`\n===== 渲染集成测试：通过 ${pass} 项，失败 ${fail} 项 =====`);
process.exit(fail ? 1 : 0);
