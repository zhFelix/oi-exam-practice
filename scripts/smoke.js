// ============================================================
// smoke.js —— 后端接口冒烟测试（对运行中的服务发起真实 HTTP 请求）
// 用法：
//   1. 启动后端：npm start（默认端口 3000）
//   2. 运行本脚本：npm run smoke   （或 BASE_URL=http://localhost:3000 npm run smoke）
// 覆盖：元数据 / 题库列表与筛选 / 题目详情 / 注册登录 / 判分（4 题型）/
//       错题本（入本-重练-自动移出）/ 手动移除 / 模拟考试（限时/交卷/报告）/
//       统计 / 登录限流（429）
// 注意：登录/注册有限流（20 次/10 分钟/IP，内存实现）。10 分钟内重复运行本脚本
//       可能触发 429，请重启服务（限流随进程重置）或等待窗口过期。
// ============================================================
const BASE = process.env.BASE_URL || 'http://localhost:3000';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, extra = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ✘ ${name} ${extra}`);
  }
}

async function api(method, path, body, token) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
  return { status: res.status, data };
}

async function main() {
  const suffix = Date.now().toString(36).slice(-6);
  const username = `smoke_${suffix}`;
  console.log(`[smoke] 目标: ${BASE}（测试用户: ${username}）\n`);

  // ---- 元数据 ----
  console.log('· 元数据接口');
  let r = await api('GET', '/meta/competition-types');
  check('GET /meta/competition-types → 200 且含 8 个竞赛类型', r.status === 200 && r.data.items.length === 8, `got ${r.status}`);
  r = await api('GET', '/meta/categories');
  check('GET /meta/categories → 7 个知识点分类', r.status === 200 && r.data.items.length === 7);
  r = await api('GET', '/meta/types');
  check('GET /meta/types → 4 种题型', r.status === 200 && r.data.items.length === 4);

  // ---- 题库列表与筛选 ----
  console.log('· 题库列表与筛选');
  r = await api('GET', '/questions?page=1&pageSize=10');
  check('GET /questions 分页 → 200 且 items≤10、total=65', r.status === 200 && r.data.items.length <= 10 && r.data.total === 65, `total=${r.data && r.data.total}`);
  check('列表摘要不含 answer', r.data.items.every((q) => q.answer === undefined));
  r = await api('GET', '/questions?competition=lanqiao');
  check('筛选 competition=lanqiao → 13 题', r.status === 200 && r.data.total === 13, `total=${r.data && r.data.total}`);
  r = await api('GET', '/questions?category=math&type=single');
  check('组合筛选 category=math&type=single 可用', r.status === 200 && r.data.items.every((q) => q.knowledgeCategory === 'math' && q.type === 'single'));
  r = await api('GET', '/questions?keyword=补码');
  check('关键词筛选 keyword=补码 命中', r.status === 200 && r.data.total >= 1, `total=${r.data && r.data.total}`);
  r = await api('GET', '/questions?competition=unknown-xx');
  check('未知竞赛类型 → 400 INVALID_COMPETITION', r.status === 400 && r.data.error.code === 'INVALID_COMPETITION');

  // ---- 题目详情 ----
  console.log('· 题目详情');
  r = await api('GET', '/questions/q001');
  check('GET /questions/q001 → 200 且匿名不含 answer', r.status === 200 && r.data.answer === undefined);
  r = await api('GET', '/questions/q021');
  check('阅读程序题 q021 含 code 与子题、子题不含答案', r.status === 200 && r.data.code && r.data.subQuestions.length === 2 && r.data.subQuestions.every((s) => s.answer === undefined));
  r = await api('GET', '/questions/q999');
  check('不存在题目 → 404 QUESTION_NOT_FOUND', r.status === 404 && r.data.error.code === 'QUESTION_NOT_FOUND');

  // ---- 注册 / 登录 ----
  console.log('· 用户系统');
  r = await api('POST', '/auth/register', { username, password: 'secret123', confirmPassword: 'secret123' });
  check('注册 → 201 且返回 token', r.status === 201 && !!r.data.token);
  const token = r.data.token;
  r = await api('POST', '/auth/register', { username, password: 'secret123', confirmPassword: 'secret123' });
  check('重复注册 → 409 USERNAME_TAKEN', r.status === 409 && r.data.error.code === 'USERNAME_TAKEN');
  r = await api('POST', '/auth/login', { username, password: 'secret123' });
  check('登录 → 200 返回 token', r.status === 200 && !!r.data.token);
  const token2 = r.data.token;
  r = await api('POST', '/auth/login', { username, password: 'wrong-pass' });
  check('错误密码 → 401 BAD_CREDENTIALS', r.status === 401 && r.data.error.code === 'BAD_CREDENTIALS');
  r = await api('GET', '/auth/me', undefined, token2);
  check('GET /auth/me 携带 token → 200 返回用户名', r.status === 200 && r.data.username === username);
  r = await api('GET', '/auth/me');
  check('GET /auth/me 未登录 → 401', r.status === 401);

  // ---- 判分（4 题型）----
  console.log('· 判分');
  r = await api('POST', '/practice/submit', { questionId: 'q001', answer: 'A' }, token);
  check('单选答对 → isCorrect=true', r.status === 200 && r.data.isCorrect === true, JSON.stringify(r.data));
  r = await api('POST', '/practice/submit', { questionId: 'q001', answer: 'C' }, token);
  check('单选答错 → isCorrect=false 且返回解析', r.status === 200 && r.data.isCorrect === false && !!r.data.analysis);
  r = await api('POST', '/submit', { questionId: 'q012', answer: ['A', 'B', 'D'] }, token);
  check('别名路径 /api/submit 多选全对 → 得 2 分', r.status === 200 && r.data.isCorrect === true && r.data.score === 2, JSON.stringify(r.data));
  r = await api('POST', '/submit', { questionId: 'q012', answer: ['A', 'B'] }, token);
  check('多选少选 → 不得分', r.status === 200 && r.data.isCorrect === false && r.data.score === 0);
  r = await api('POST', '/submit', { questionId: 'q003', answer: true }, token);
  check('判断题答对 → isCorrect=true', r.status === 200 && r.data.isCorrect === true);
  r = await api('POST', '/submit', { questionId: 'q021', answer: ['B', true] }, token);
  check('阅读程序题全对 → 得 2 分', r.status === 200 && r.data.isCorrect === true && r.data.score === 2 && r.data.perSub.length === 2, JSON.stringify(r.data));
  r = await api('POST', '/submit', { questionId: 'q021', answer: ['A', true] }, token);
  check('阅读程序题答对 1 小题 → 得 1 分', r.status === 200 && r.data.isCorrect === false && r.data.score === 1);
  r = await api('POST', '/submit', { questionId: 'q001', answer: ['A', 'B'] }, token);
  check('非法答案形态 → 400 INVALID_ANSWER', r.status === 400 && r.data.error.code === 'INVALID_ANSWER');
  r = await api('POST', '/submit', { questionId: 'q001', answer: 'A' });
  check('未登录提交 → 401', r.status === 401);

  // ---- 错题本 ----
  console.log('· 错题本');
  r = await api('GET', '/wrong-book', undefined, token);
  const wrongTotalBefore = r.data.total;
  check('错题本列表 → 200（q001 已因答错入本）', r.status === 200 && r.data.items.some((w) => w.questionId === 'q001'));
  check('错题本条目含正确思路摘要', r.data.items.find((w) => w.questionId === 'q001')?.analysisSummary?.length > 0);
  r = await api('POST', '/wrong-book/review', { questionId: 'q001', answer: 'A' }, token);
  check('重练答对第 1 次 → reviewStreak=1 不自动移出', r.status === 200 && r.data.reviewStreak === 1 && r.data.autoRemoved === false, JSON.stringify(r.data));
  r = await api('POST', '/wrong-book/review', { questionId: 'q001', answer: 'A' }, token);
  check('重练答对第 2 次 → 自动移出错题本', r.status === 200 && r.data.reviewStreak === 2 && r.data.autoRemoved === true);
  r = await api('GET', '/wrong-book', undefined, token);
  check('自动移出后列表不再包含 q001', !r.data.items.some((w) => w.questionId === 'q001'));
  r = await api('GET', '/wrong-book/stats', undefined, token);
  check('错题分类排行 → 200', r.status === 200 && Array.isArray(r.data.items));
  // 手动移除：先制造一条错题再删除
  await api('POST', '/submit', { questionId: 'q002', answer: 'A' }, token);
  r = await api('DELETE', '/wrong-book/q002', undefined, token);
  check('手动移出错题 → 204', r.status === 204);

  // ---- 统计 ----
  console.log('· 统计');
  r = await api('GET', '/stats/overview', undefined, token);
  check('总体概览 → 200 且刷题数>0', r.status === 200 && r.data.totalAnswered > 0, JSON.stringify(r.data));
  r = await api('GET', '/stats/categories', undefined, token);
  check('分类正确率 → 7 类全覆盖', r.status === 200 && r.data.items.length === 7);
  r = await api('GET', '/stats/types', undefined, token);
  check('题型正确率 → 4 种全覆盖', r.status === 200 && r.data.items.length === 4);
  r = await api('GET', '/stats/overview');
  check('统计未登录 → 401', r.status === 401);

  // ---- 模拟考试（F3）----
  console.log('· 模拟考试');
  r = await api('GET', '/exams');
  check('GET /exams 匿名 → 200 且 5 套卷', r.status === 200 && r.data.items.length === 5, `count=${r.data && r.data.items.length}`);
  r = await api('GET', '/exams?competition=csp-j');
  check('按竞赛类型筛选卷 → 全部为 csp-j', r.status === 200 && r.data.items.length >= 1 && r.data.items.every((e) => e.competitionType === 'csp-j'));
  r = await api('GET', '/exams/exam-001');
  check('GET /exams/exam-001 匿名详情 → 仅元信息与规则（不含题目）', r.status === 200 && r.data.questions === undefined && r.data.title === 'CSP-J 入门级模拟卷（第一轮）' && r.data.questionCount === 12 && r.data.totalScore === 14 && r.data.rules?.unansweredAsWrong === true, JSON.stringify(r.data && Object.keys(r.data)));
  r = await api('GET', '/exams/exam-999');
  check('不存在试卷 → 404 EXAM_NOT_FOUND', r.status === 404 && r.data.error.code === 'EXAM_NOT_FOUND');
  r = await api('POST', '/exams/exam-001/start');
  check('未登录开始考试 → 401', r.status === 401);

  // 开始考试（服务端记时）
  r = await api('POST', '/exams/exam-001/start', {}, token);
  const sessionId = r.data && r.data.sessionId;
  check('开始考试 → 201 返回会话与题目（无答案）', r.status === 201 && !!sessionId && r.data.questions.every((q) => q.answer === undefined), JSON.stringify(r.data && r.data.sessionId));
  r = await api('POST', '/exams/exam-001/start', {}, token);
  check('重复开始 → 恢复同一会话（幂等）', r.status === 200 && r.data.resumed === true && r.data.sessionId === sessionId);

  // 交卷（部分作答，手动交卷）
  const answers1 = { q001: 'A', q002: 'B', q005: '1011' }; // q005 正确答案 1101，故意答错
  r = await api('POST', '/exams/exam-001/submit', { answers: answers1 }, token);
  const resultId = r.data && r.data.resultId;
  check('交卷 → 200 成绩报告（总分/得分/用时/每题对错）', r.status === 200 && !!resultId && r.data.total === 14 && r.data.perQuestion.length === 12 && r.data.auto === false, JSON.stringify(r.data && { score: r.data.score, total: r.data.total, auto: r.data.auto }));
  check('交卷报告：答对 q001 得 1 分', r.data.perQuestion.find((p) => p.questionId === 'q001')?.isCorrect === true);
  check('交卷报告：答错 q005 得 0 分且给出正确答案', r.data.perQuestion.find((p) => p.questionId === 'q005')?.isCorrect === false && r.data.perQuestion.find((p) => p.questionId === 'q005')?.correctAnswer?.[0] === 'B');
  check('交卷报告：未答题目 answered=false 得 0 分', r.data.perQuestion.every((p) => (p.answered ? true : p.score === 0)));
  check('交卷报告含分类/题型汇总', !!r.data.detail.byCategory && !!r.data.detail.byType);

  // 重复交卷 → 409
  r = await api('POST', '/exams/exam-001/submit', { answers: answers1 }, token);
  check('重复交卷 → 409 ALREADY_SUBMITTED', r.status === 409 && r.data.error.code === 'ALREADY_SUBMITTED');

  // 历史成绩 + 成绩报告回看
  r = await api('GET', '/exams/history', undefined, token);
  check('历史成绩 → 包含本次成绩', r.status === 200 && r.data.items.some((x) => x.resultId === resultId));
  r = await api('GET', `/exams/results/${resultId}`, undefined, token);
  check('成绩报告回看 → 逐题含解析（考后可见）', r.status === 200 && r.data.detail.perQuestion[0].analysis.length > 0);
  r = await api('GET', '/exams/results', undefined, token);
  check('GET /exams/results 别名 → 与 history 一致', r.status === 200 && r.data.items.length >= 1);
  r = await api('GET', '/exams/results/not-exist', undefined, token);
  check('成绩不存在 → 404 RESULT_NOT_FOUND', r.status === 404);

  // 未开始即交卷 → 400（exam-002 从未开始）
  r = await api('POST', '/exams/exam-002/submit', { answers: {} }, token);
  check('未开始交卷 → 400 EXAM_NOT_STARTED', r.status === 400 && r.data.error.code === 'EXAM_NOT_STARTED');

  // 会话路径别名交卷（架构文档路径）
  r = await api('POST', '/exams/exam-002/start', {}, token);
  const sessionId2 = r.data && r.data.sessionId;
  r = await api('POST', `/exams/session/${sessionId2}/submit`, { answers: { q004: 'C', q006: 'BA' } }, token);
  check('会话路径别名交卷 → 200', r.status === 200 && !!r.data.resultId, `status=${r.status}`);

  // 超时自动交卷（exam-005 时长 6 秒，等待后提交按已答计分）
  r = await api('POST', '/exams/exam-005/start', {}, token);
  check('自动交卷测试卷开始 → 201', r.status === 201);
  await new Promise((resolve) => setTimeout(resolve, 7000)); // 等待超时
  r = await api('POST', '/exams/exam-005/submit', { answers: { q001: 'A', q002: 'B' } }, token);
  check('超时提交 → auto=true 且按已答计分（答对 2 题得 2 分）', r.status === 200 && r.data.auto === true && r.data.score === 2, JSON.stringify(r.data && { auto: r.data.auto, score: r.data.score }));

  // 统计含模拟考次数
  r = await api('GET', '/stats/overview', undefined, token);
  check('统计 overview 的 examCount 计入模拟考次数', r.status === 200 && r.data.examCount >= 2, JSON.stringify(r.data));

  // 登录限流：连续登录失败触发 429（默认 20 次/10 分钟/IP；内存实现，重启服务即重置）
  console.log('· 登录限流');
  let saw429 = false;
  for (let i = 0; i < 30; i++) {
    r = await api('POST', '/auth/login', { username, password: 'wrong-rate-limit-pass' });
    if (r.status === 429) { saw429 = true; break; }
  }
  check('登录接口限流 → 429 RATE_LIMITED', saw429 === true && r.data?.error?.code === 'RATE_LIMITED', JSON.stringify(r && r.data));

  // ---- 汇总 ----
  console.log(`\n[smoke] 结果: ${passed} 通过, ${failed} 失败`);
  if (failed) {
    console.log('失败项:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
  console.log('[smoke] 全部接口冒烟测试通过 ✅');
}

main().catch((e) => {
  console.error('[smoke] 脚本异常:', e.message);
  process.exit(1);
});
