/* ============================================================
   smoke-frontend.mjs —— 前端逻辑冒烟测试（零依赖，Node 运行）
   验证 js/mock.js（本地演示后端）的完整数据流：
   注册/登录 → 题库筛选 → 练习判分 → 错题入本 → 模拟考交卷 → 成绩报告
   → 错题重练自动移出 → 学习统计
   运行：node scripts/smoke-frontend.mjs
   ============================================================ */

// ---- localStorage 垫片（Node 环境无浏览器 localStorage） ----
const mem = {};
globalThis.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; },
};

const { MockBackend } = await import("../public/js/mock.js");

let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ FAIL: ${name}`); }
}
async function expectError(promise, code, name) {
  try { await promise; console.error(`  ✗ FAIL: ${name}（未抛错）`); fail++; }
  catch (e) { if (e.code === code) { pass++; console.log(`  ✓ ${name}（${code}）`); } else { console.error(`  ✗ FAIL: ${name}（错误码 ${e.code} 期望 ${code}）`); fail++; } }
}

console.log("\n[1] 用户系统（t18：邮箱登录 + 昵称）");
// 演示账号昵称占用
await expectError(MockBackend.handle("POST", "/auth/register", { email: "x@example.com", username: "demo", password: "123456", confirmPassword: "123456" }), "USERNAME_TAKEN", "昵称被占用被拒绝");
// 邮箱格式 / 弱密码 / 密码不一致
await expectError(MockBackend.handle("POST", "/auth/register", { email: "not-an-email", username: "alice", password: "123456", confirmPassword: "123456" }), "INVALID_EMAIL", "邮箱格式错误被拒绝");
await expectError(MockBackend.handle("POST", "/auth/register", { email: "alice@example.com", username: "alice", password: "123", confirmPassword: "123" }), "WEAK_PASSWORD", "弱密码被拒绝");
await expectError(MockBackend.handle("POST", "/auth/register", { email: "alice@example.com", username: "alice", password: "123456", confirmPassword: "654321" }), "PASSWORD_MISMATCH", "两次密码不一致被拒绝");
const reg = await MockBackend.handle("POST", "/auth/register", { email: "alice@example.com", username: "alice", password: "123456", confirmPassword: "123456" });
assert(reg.token && reg.user.username === "alice" && reg.user.email === "alice@example.com", "注册成功并返回 token + user{username, email}");
await expectError(MockBackend.handle("POST", "/auth/register", { email: "alice@example.com", username: "alice2", password: "123456", confirmPassword: "123456" }), "EMAIL_TAKEN", "邮箱重复注册被拒绝");
await expectError(MockBackend.handle("POST", "/auth/login", { email: "alice@example.com", password: "wrong" }), "BAD_CREDENTIALS", "错误密码登录被拒");
const login = await MockBackend.handle("POST", "/auth/login", { email: "alice@example.com", password: "123456" });
assert(!!login.token && login.user.email === "alice@example.com", "邮箱登录成功");
const me = await MockBackend.handle("GET", "/auth/me", null, {});
assert(me.username === "alice" && me.email === "alice@example.com", "GET /auth/me 返回 username + email");

console.log("\n[2] 题库筛选");
const all = await MockBackend.handle("GET", "/questions", null, { page: 1, pageSize: 20 });
assert(all.total === 26 && all.items.length === 20, `题库共 26 题，分页 20 条（实际 ${all.total}/${all.items.length}）`);
const filtered = await MockBackend.handle("GET", "/questions", null, { competition: "csp-j", category: "math,algorithm", type: "single,judge", page: 1, pageSize: 50 });
assert(filtered.items.length === 7, `组合筛选生效（${filtered.total} 条，期望 7）`);
const kw = await MockBackend.handle("GET", "/questions", null, { keyword: "补码", page: 1, pageSize: 50 });
assert(kw.total === 1, "关键词搜索命中（补码 → 1 题）");
const detail = await MockBackend.handle("GET", "/questions/q001", null, {});
assert(!("answer" in detail), "匿名详情不含 answer");
const detailW = await MockBackend.handle("GET", "/questions/q001", null, { withAnswer: "1" });
assert(detailW.answer === "A", "登录 + withAnswer=1 返回答案");

console.log("\n[3] 练习判分（4 题型）");
const r1 = await MockBackend.handle("POST", "/practice/submit", { questionId: "q001", answer: ["A"] });
assert(r1.isCorrect === true && r1.score === 1, "单选判分正确");
const r2 = await MockBackend.handle("POST", "/practice/submit", { questionId: "q012", answer: ["A", "B", "C"] });
assert(r2.isCorrect === false, "多选少选不得分");
const r3 = await MockBackend.handle("POST", "/practice/submit", { questionId: "q012", answer: ["A", "B", "D"] });
assert(r3.isCorrect === true, "多选全对得分（顺序无关）");
const r4 = await MockBackend.handle("POST", "/practice/submit", { questionId: "q003", answer: [true] });
assert(r4.isCorrect === true, "判断题判分正确");
const r5 = await MockBackend.handle("POST", "/practice/submit", { questionId: "q021", answer: [["B"], [true]] });
assert(r5.isCorrect === true, "阅读程序子题全对判分正确");
await expectError(MockBackend.handle("POST", "/practice/submit", { questionId: "q001", answer: ["X"] }), "INVALID_ANSWER", "非法选项被拒绝");

console.log("\n[4] 错题入本");
const wrongList = await MockBackend.handle("GET", "/wrong-book", null, {});
assert(wrongList.items.some((w) => w.questionId === "q012"), "答错的多选题已入错题本");
const w012 = wrongList.items.find((w) => w.questionId === "q012");
assert(w012.wrongCount === 1 && w012.lastWrongAnswer.join() === "A,B,C", "错题含错选答案与次数");

console.log("\n[5] 模拟考试全流程");
const examList = await MockBackend.handle("GET", "/exams", null, {});
assert(examList.items.length === 3, "3 套模拟卷");
const started = await MockBackend.handle("POST", "/exams/exam-cspj/start", {});
assert(started.sessionId && started.questions.length === 12, "开始考试返回会话与 12 题");
const noAnswerLeak = started.questions.every((q) => !("answer" in q) && !("analysis" in q));
assert(noAnswerLeak, "考试题目不含答案/解析（F3.3 纪律）");
const answers = {};
started.questions.forEach((q, i) => { answers[q.id] = i % 2 === 0 ? [q.type === "judge" ? true : q.options[0]?.key ?? true] : []; });
const sub = await MockBackend.handle("POST", `/exams/session/${started.sessionId}/submit`, { answers, auto: false });
assert(sub.resultId && sub.total === 13, `交卷成功（总分 ${sub.total}，含阅读题子题计分）`);
const result = await MockBackend.handle("GET", `/exams/results/${sub.resultId}`, null, {});
assert(result.perQuestion.length === 12, "成绩报告含逐题回顾");
assert(result.detail.byCategory && Object.keys(result.detail.byCategory).length > 0, "成绩报告含分类聚合");
const scoreSum = result.perQuestion.reduce((s, p) => s + p.score, 0);
assert(scoreSum === result.score, "逐题得分合计 = 总分");

console.log("\n[6] 错题重练状态机");
// 挑一道考试中答错的题（index 0 答对，index 1 未答计错 → q 列表第二个）
const wrongQid = started.questions[1].id;
const review1 = await MockBackend.handle("POST", "/wrong-book/review", { questionId: wrongQid, answer: ["B"] });
assert(review1.isCorrect === true && review1.reviewStreak === 1 && review1.autoRemoved === false, "重练答对 1 次：streak=1 未移出");
const review2 = await MockBackend.handle("POST", "/wrong-book/review", { questionId: wrongQid, answer: ["B"] });
assert(review2.reviewStreak === 2 && review2.autoRemoved === true, "连续答对 2 次自动移出");
const wbAfter = await MockBackend.handle("GET", "/wrong-book", null, {});
assert(!wbAfter.items.some((w) => w.questionId === wrongQid), "已移出后不再出现在错题本列表");
const del = await MockBackend.handle("DELETE", "/wrong-book/q012", {});
assert(del === null, "手动移除返回 204");

console.log("\n[7] 学习统计");
const ov = await MockBackend.handle("GET", "/stats/overview", null, {});
assert(ov.totalAnswered >= 5 && ov.overallRate > 0, `概览数据（答 ${ov.totalAnswered} 题，正确率 ${(ov.overallRate * 100).toFixed(0)}%）`);
const cats = await MockBackend.handle("GET", "/stats/categories", null, {});
assert(cats.items.length === 7, "7 个分类统计项");
const types = await MockBackend.handle("GET", "/stats/types", null, {});
assert(types.items.length === 4, "4 个题型统计项");

console.log("\n[8] Markdown / LaTeX 渲染（renderMarkdown，KaTeX 本地渲染）");
const { renderMarkdown } = await import("../public/js/utils.js");
// 行内公式：$O(n\log n)$
const mdInline = renderMarkdown("时间复杂度为 $O(n\\log n)$ 的排序算法");
assert(mdInline.includes('class="katex"') && !mdInline.includes("$O(n"), "行内公式 $O(n\\log n)$ 渲染为 KaTeX");
// 块级公式：$$\frac{1}{2}$$
const mdBlock = renderMarkdown("公式：\n\n$$\\frac{1}{2}+\\frac{1}{4}=\\frac{3}{4}$$\n\n完毕");
assert(mdBlock.includes('class="katex-block"') && mdBlock.includes("katex-display"), "块级公式 $$\\frac{1}{2}$$ 渲染（katex-block+display）");
// 公式与 Markdown 共存互不干扰
const mdMix = renderMarkdown("$a_1 < b_2$ 与 **加粗**、`code` 并存");
assert(mdMix.includes("katex") && mdMix.includes("<strong>加粗</strong>") && mdMix.includes('<code class="inline">code</code>'), "公式与加粗/行内代码共存");
// 新 Markdown 语法
assert(renderMarkdown("## 二级标题").includes("<h2>二级标题</h2>"), "标题 ##");
const mdList = renderMarkdown("- 甲\n- 乙\n1. 一\n2. 二");
assert(mdList.includes("<ul><li>甲</li><li>乙</li></ul>") && mdList.includes("<ol><li>一</li><li>二</li></ol>"), "无序/有序列表");
assert(renderMarkdown("*斜体* 和 ~~删除线~~").includes("<em>斜体</em>") && renderMarkdown("~~删除线~~").includes("<del>删除线</del>"), "斜体与删除线");
assert(renderMarkdown("[链接](https://example.com/x)").includes('<a href="https://example.com/x"'), "链接渲染");
assert(!renderMarkdown("[x](javascript:alert(1))").includes("<a "), "伪协议链接被拒绝（安全）");
// 安全与兼容
assert(!renderMarkdown("<script>alert(1)</script>").includes("<script>"), "原始 HTML 不渲染（XSS 安全）");
assert(renderMarkdown("```cpp\nint a = 1; // $O(n)$\n```").includes("$O(n)$") && !renderMarkdown("```x\n$y$\n```").includes("katex"), "代码块内 $...$ 不解析");
assert(renderMarkdown("**加粗** 与 `code` 回归正常").includes("<strong>加粗</strong>"), "原有语法回归（加粗/行内代码）");
// 行内渲染（选项文本路径，t16 验收修复）：公式渲染、无块级嵌套、XSS 安全
const { renderInline } = await import("../public/js/utils.js");
const ri = renderInline("$\\binom{5}{2}=10$ 且 **加粗**");
assert(ri.includes('class="katex"') && !ri.includes("$"), "选项行内公式 renderInline 渲染且无残留 $");
assert(!ri.includes("<p>") && !ri.includes("<ul>"), "renderInline 无块级包装（span 内合法）");
assert(!renderInline("<script>alert(1)</script>").includes("<script>"), "renderInline 原始 HTML 不渲染（XSS 安全）");

console.log(`\n===== 冒烟测试结果：通过 ${pass} 项，失败 ${fail} 项 =====`);
process.exit(fail ? 1 : 0);
