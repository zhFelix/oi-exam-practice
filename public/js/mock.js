/* ============================================================
   mock.js —— 本地演示模式后端（MockBackend）
   - 当真实后端 API 不可用时（无后端 / 纯静态预览），由 api.js 降级调用本模块
   - 数据持久化于 localStorage（key: oi_mock_db），模拟：注册登录、题库筛选、
     练习判分、模拟考试（限时/自动交卷）、错题本状态机、学习统计
   - 判分规则与 docs/architecture.md §7.2 一致：
     single/judge 严格相等；multiple 集合相等（全对才得分）；
     reading 逐子题判分，得分累加
   ============================================================ */

import { MOCK_BANK } from "./mock-data.js";

const DB_KEY = "oi_mock_db";
const TOKEN_KEY = "oi_token";

/** 演示账号（登录页会提示，方便无后端演示；t18 起登录标识为邮箱） */
const DEMO_USER = { id: "u_demo", username: "demo", email: "demo@example.com", password: "123456", created_at: new Date().toISOString() };

/** 邮箱格式（与后端 EMAIL_PATTERN 一致） */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------- 基础数据访问 ---------- */

function loadDB() {
  const d = { users: [DEMO_USER], answers: [], wrongbook: [], examResults: [], sessions: [], seq: 1 };
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // 保证 demo 账号始终存在（按邮箱匹配；旧数据可能只有 username，补上 email）
      const hasDemo = (saved.users || []).some((u) => u.email === DEMO_USER.email || u.username === DEMO_USER.username);
      if (!hasDemo) saved.users.unshift(DEMO_USER);
      else (saved.users || []).forEach((u) => { if (u.username === DEMO_USER.username && !u.email) u.email = DEMO_USER.email; });
      return Object.assign(d, saved);
    }
  } catch (e) {
    console.warn("[mock] 读取本地数据失败，使用初始数据。", e);
  }
  return d;
}

function saveDB(db) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch (e) {
    console.warn("[mock] 保存本地数据失败。", e);
  }
}

function mkId(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

const sleep = (ms = 150) => new Promise((r) => setTimeout(r, ms));

function fail(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

/* ---------- 鉴权辅助 ---------- */

function currentUser(db) {
  const token = localStorage.getItem(TOKEN_KEY) || "";
  const email = token.replace(/^mock_/, "");
  return db.users.find((u) => u.email === email) || null;
}

/* ---------- 判分核心（与架构 §7.2 对齐） ---------- */

/** 单题分值：reading 按子题数，其余 1 分 */
function scoreOf(q) {
  return q.type === "reading" ? q.sub_questions.length : 1;
}

/** 集合相等（顺序无关） */
function setEq(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort().map(String);
  const sb = [...b].sort().map(String);
  return sa.every((v, i) => v === sb[i]);
}

/** 判分：question + 用户答案（数组形态）→ { isCorrect, score, correctAnswer } */
function gradeQuestion(q, userAnswer) {
  const correctAnswer = q.type === "reading" ? q.sub_questions.map((s) => [s.answer]) : [q.answer];
  let isCorrect = false;
  if (q.type === "single" || q.type === "judge") {
    isCorrect = userAnswer.length === 1 && String(userAnswer[0]) === String(q.answer);
  } else if (q.type === "multiple") {
    isCorrect = setEq(userAnswer, q.answer);
  } else if (q.type === "reading") {
    // 逐子题判分：得分 = 答对子题数；isCorrect = 全对
    const subs = q.sub_questions;
    if (!Array.isArray(userAnswer) || userAnswer.length !== subs.length) isCorrect = false;
    else {
      let ok = true;
      for (let i = 0; i < subs.length; i++) {
        const sub = subs[i];
        const a = userAnswer[i] || [];
        if (!(a.length === 1 && String(a[0]) === String(sub.answer))) ok = false;
      }
      isCorrect = ok;
    }
  }
  return { isCorrect, score: isCorrect ? scoreOf(q) : 0, correctAnswer };
}

/** 答案格式校验（判分前） */
function validateAnswer(q, userAnswer) {
  if (!Array.isArray(userAnswer)) return false;
  if (q.type === "reading") {
    return q.sub_questions.every((s, i) => {
      const a = userAnswer[i];
      if (!Array.isArray(a) || a.length !== 1) return false;
      const key = a[0];
      if (s.type === "judge") return key === true || key === false;
      return s.options.some((o) => o.key === key);
    });
  }
  if (q.type === "judge") return userAnswer.length === 1 && (userAnswer[0] === true || userAnswer[0] === false);
  if (q.type === "multiple") return userAnswer.length >= 1 && userAnswer.every((k) => q.options.some((o) => o.key === k));
  // single
  return userAnswer.length === 1 && q.options.some((o) => o.key === userAnswer[0]);
}

/* ---------- 错题本状态机（架构 §5.4.1） ---------- */

const REVIEW_THRESHOLD = 2; // 连续答对阈值

/** 记录错题（练习/模拟考答错时调用） */
function recordWrong(db, user, question, wrongAnswer) {
  const found = db.wrongbook.find((w) => w.user_id === user.id && w.question_id === question.id);
  if (found) {
    found.wrong_count += 1;
    found.review_correct_streak = 0;
    found.status = "active";
    found.last_wrong_answer = wrongAnswer;
    found.last_wrong_at = new Date().toISOString();
  } else {
    db.wrongbook.push({
      user_id: user.id,
      question_id: question.id,
      wrong_count: 1,
      review_correct_streak: 0,
      status: "active",
      last_wrong_answer: wrongAnswer,
      last_wrong_at: new Date().toISOString(),
      added_at: new Date().toISOString(),
    });
  }
}

/** 错题重练：连对 +1，达到阈值自动移出；答错清零 */
function reviewWrong(db, user, question, isCorrect) {
  const found = db.wrongbook.find((w) => w.user_id === user.id && w.question_id === question.id);
  let reviewStreak = 0;
  let autoRemoved = false;
  if (found) {
    if (isCorrect) {
      reviewStreak = (found.review_correct_streak || 0) + 1;
      found.review_correct_streak = reviewStreak;
      if (reviewStreak >= REVIEW_THRESHOLD) {
        found.status = "removed";
        autoRemoved = true;
      }
    } else {
      found.review_correct_streak = 0;
      found.wrong_count += 1;
      found.last_wrong_answer = question._lastAnswer;
      found.last_wrong_at = new Date().toISOString();
    }
  }
  return { reviewStreak, autoRemoved };
}

/* ---------- 题目辅助 ---------- */

function findQuestion(id) {
  if (id.includes("-")) {
    // 子题 id：q021-1 → 返回父题
    const parentId = id.replace(/-\d+$/, "");
    return MOCK_BANK.questions.find((q) => q.id === parentId) || null;
  }
  return MOCK_BANK.questions.find((q) => q.id === id) || null;
}

/** 列表摘要（不含 answer，防未登录窥探） */
function toSummary(q) {
  return {
    id: q.id,
    type: q.type,
    stem: q.stem.length > 120 ? q.stem.slice(0, 120) + "…" : q.stem,
    knowledgeCategory: q.knowledge_category,
    competitionTypes: q.competition_types,
    difficulty: q.difficulty,
    source: q.source,
    year: q.year || null,
    score: scoreOf(q),
  };
}

/** 详情（withAnswer=1 且已登录才带答案） */
function toDetail(q, withAnswer) {
  const d = JSON.parse(JSON.stringify(q));
  if (!withAnswer) {
    delete d.answer;
    (d.sub_questions || []).forEach((s) => delete s.answer);
  }
  return d;
}

/** 考试题目剥离答案/解析（F3.3 纪律：源头不含 answer/analysis） */
function toExamQuestion(q) {
  return {
    id: q.id,
    type: q.type,
    stem: q.stem,
    code: q.code || "",
    knowledgeCategory: q.knowledge_category,
    source: q.source,
    sub_questions: (q.sub_questions || []).map((s) => ({
      id: s.id,
      type: s.type,
      stem: s.stem,
      options: s.options || [],
    })),
    options: q.options || [],
  };
}

/* ---------- 演示用模拟卷定义 ---------- */

const DEMO_EXAMS = [
  {
    id: "exam-cspj",
    title: "CSP-J 模拟卷（演示）",
    competitionType: "csp-j",
    durationMinutes: 30,
    questionIds: ["q001", "q002", "q003", "q005", "q008", "q009", "q011", "q013", "q017", "q019", "q021", "q024"],
  },
  {
    id: "exam-csps",
    title: "CSP-S 模拟卷（演示）",
    competitionType: "csp-s",
    durationMinutes: 30,
    questionIds: ["q004", "q006", "q007", "q010", "q012", "q014", "q015", "q016", "q018", "q020", "q022", "q025"],
  },
  {
    id: "exam-noip",
    title: "NOIP 模拟卷（演示）",
    competitionType: "noip",
    durationMinutes: 30,
    questionIds: ["q001", "q004", "q005", "q009", "q013", "q017", "q021", "q023", "q025", "q026"],
  },
];

function examTotal(qIds) {
  return qIds.reduce((sum, id) => sum + scoreOf(findQuestion(id)), 0);
}

/* ---------- 入口：路由分发（method, path, body, params） ---------- */

export const MockBackend = {
  async handle(method, path, body, params) {
    await sleep(method === "GET" ? 120 : 220);
    const db = loadDB();
    const user = currentUser(db);

    // ===== 认证（t18：登录标识为 email，username 为昵称/显示名） =====
    if (method === "POST" && path === "/auth/register") {
      const { email, username, password, confirmPassword } = body || {};
      const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
      if (!EMAIL_PATTERN.test(normalizedEmail)) throw fail(400, "INVALID_EMAIL", "邮箱格式不正确");
      if (!username || !/^[A-Za-z0-9_]{3,20}$/.test(username)) throw fail(400, "INVALID_USERNAME", "昵称需为 3~20 位字母、数字或下划线");
      if (!password || password.length < 6) throw fail(400, "WEAK_PASSWORD", "密码至少 6 位");
      if (password !== confirmPassword) throw fail(400, "PASSWORD_MISMATCH", "两次输入的密码不一致");
      if (db.users.some((u) => u.email === normalizedEmail)) throw fail(409, "EMAIL_TAKEN", "该邮箱已被注册");
      if (db.users.some((u) => u.username === username)) throw fail(409, "USERNAME_TAKEN", "昵称已被占用");
      const nu = { id: mkId("u_"), username, email: normalizedEmail, password, created_at: new Date().toISOString() };
      db.users.push(nu);
      saveDB(db);
      localStorage.setItem(TOKEN_KEY, `mock_${normalizedEmail}`);
      return { token: `mock_${normalizedEmail}`, user: { id: nu.id, username: nu.username, email: nu.email } };
    }

    if (method === "POST" && path === "/auth/login") {
      const { email, password } = body || {};
      const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
      if (!EMAIL_PATTERN.test(normalizedEmail) || typeof password !== "string") {
        throw fail(401, "BAD_CREDENTIALS", "用户名或密码错误");
      }
      const u = db.users.find((x) => x.email === normalizedEmail && x.password === password);
      if (!u) throw fail(401, "BAD_CREDENTIALS", "用户名或密码错误");
      localStorage.setItem(TOKEN_KEY, `mock_${normalizedEmail}`);
      return { token: `mock_${normalizedEmail}`, user: { id: u.id, username: u.username, email: u.email } };
    }

    if (method === "GET" && path === "/auth/me") {
      if (!user) throw fail(401, "UNAUTHORIZED", "未登录");
      return { id: user.id, username: user.username, email: user.email || null };
    }

    // ===== 题库 =====
    if (method === "GET" && path === "/questions") {
      let list = [...MOCK_BANK.questions];
      if (params.competition) list = list.filter((q) => q.competition_types.includes(params.competition));
      if (params.category) {
        const cats = String(params.category).split(",");
        list = list.filter((q) => cats.includes(q.knowledge_category));
      }
      if (params.type) {
        const types = String(params.type).split(",");
        list = list.filter((q) => types.includes(q.type));
      }
      if (params.difficulty) {
        const diffs = String(params.difficulty).split(",").map((d) => ({ 1: "beginner", 2: "intermediate", 3: "advanced" }[d] || d));
        list = list.filter((q) => diffs.includes(q.difficulty));
      }
      if (params.keyword) {
        const kw = String(params.keyword).toLowerCase();
        list = list.filter((q) => (q.stem || "").toLowerCase().includes(kw) || (q.analysis || "").toLowerCase().includes(kw));
      }
      const page = parseInt(params.page || "1", 10) || 1;
      const pageSize = Math.min(parseInt(params.pageSize || "20", 10) || 20, 50);
      const total = list.length;
      const start = (page - 1) * pageSize;
      return { items: list.slice(start, start + pageSize).map(toSummary), total, page, pageSize };
    }

    if (method === "GET" && /^\/questions\/[^/]+$/.test(path)) {
      const id = path.split("/")[2];
      const q = findQuestion(id);
      if (!q) throw fail(404, "QUESTION_NOT_FOUND", "题目不存在");
      const withAnswer = params && params.withAnswer === "1" && !!user;
      return toDetail(q, withAnswer);
    }

    // ===== 练习判分 =====
    if (method === "POST" && path === "/practice/submit") {
      if (!user) throw fail(401, "UNAUTHORIZED", "请先登录");
      const { questionId, answer } = body || {};
      const q = findQuestion(questionId);
      if (!q) throw fail(404, "QUESTION_NOT_FOUND", "题目不存在");
      if (!validateAnswer(q, answer)) throw fail(400, "INVALID_ANSWER", "答案格式不正确");
      const { isCorrect, score, correctAnswer } = gradeQuestion(q, answer);
      db.answers.push({
        id: mkId("a_"), user_id: user.id, question_id: q.id, user_answer: answer,
        is_correct: isCorrect, score, source: "practice", exam_id: null, submitted_at: new Date().toISOString(),
      });
      if (!isCorrect) recordWrong(db, user, q, answer);
      saveDB(db);
      return {
        isCorrect, score,
        correctAnswer,
        analysis: q.analysis,
        knowledgeCategory: q.knowledge_category,
      };
    }

    // ===== 模拟考试 =====
    if (method === "GET" && path === "/exams") {
      if (!user) throw fail(401, "UNAUTHORIZED", "请先登录");
      let list = DEMO_EXAMS;
      if (params.competition) list = list.filter((e) => e.competitionType === params.competition);
      return {
        items: list.map((e) => ({
          id: e.id, title: e.title, competitionType: e.competitionType,
          durationMinutes: e.durationMinutes, questionCount: e.questionIds.length, totalScore: examTotal(e.questionIds),
        })),
      };
    }

    if (method === "GET" && /^\/exams\/[^/]+$/.test(path) && !path.includes("/results")) {
      if (!user) throw fail(401, "UNAUTHORIZED", "请先登录");
      const id = path.split("/")[2];
      const e = DEMO_EXAMS.find((x) => x.id === id);
      if (!e) throw fail(404, "EXAM_NOT_FOUND", "试卷不存在");
      return {
        id: e.id, title: e.title, competitionType: e.competitionType,
        durationMinutes: e.durationMinutes, questionCount: e.questionIds.length,
        totalScore: examTotal(e.questionIds), rules: { unansweredAsWrong: true },
      };
    }

    if (method === "POST" && /^\/exams\/[^/]+\/start$/.test(path)) {
      if (!user) throw fail(401, "UNAUTHORIZED", "请先登录");
      const id = path.split("/")[2];
      const e = DEMO_EXAMS.find((x) => x.id === id);
      if (!e) throw fail(404, "EXAM_NOT_FOUND", "试卷不存在");
      const session = {
        id: mkId("s_"), user_id: user.id, exam_id: e.id,
        answers: {}, started_at: new Date().toISOString(), status: "ongoing",
      };
      db.sessions.push(session);
      saveDB(db);
      return {
        sessionId: session.id, startedAt: session.started_at,
        questions: e.questionIds.map((qid) => toExamQuestion(findQuestion(qid))),
      };
    }

    if (method === "POST" && /^\/exams\/session\/[^/]+\/submit$/.test(path)) {
      if (!user) throw fail(401, "UNAUTHORIZED", "请先登录");
      const sessionId = path.split("/")[3];
      const session = db.sessions.find((s) => s.id === sessionId);
      if (!session) throw fail(404, "SESSION_NOT_FOUND", "考试会话不存在");
      if (session.user_id !== user.id) throw fail(403, "FORBIDDEN", "无权操作该考试");
      if (session.status !== "ongoing") throw fail(409, "ALREADY_SUBMITTED", "该考试已交卷");

      const exam = DEMO_EXAMS.find((e) => e.id === session.exam_id);
      const submittedAnswers = (body && body.answers) || {};
      const perQuestion = [];
      const detail = { byCategory: {}, byType: {} };
      let total = 0, score = 0;

      exam.questionIds.forEach((qid) => {
        const q = findQuestion(qid);
        const pts = scoreOf(q);
        total += pts;
        const userAnswer = submittedAnswers[qid] || [];
        const graded = gradeQuestion(q, userAnswer);
        const isCorrect = graded.isCorrect && userAnswer.length > 0;
        const got = isCorrect ? pts : 0;
        score += got;
        // 子题详情（reading）
        let sub = null;
        if (q.type === "reading") {
          sub = q.sub_questions.map((s, i) => {
            const a = (userAnswer[i] || [])[0];
            const ok = userAnswer[i] && userAnswer[i].length === 1 && String(a) === String(s.answer);
            return { stem: s.stem, yourAnswer: a === undefined ? null : a, correctAnswer: s.answer, isCorrect: ok, analysis: s.analysis };
          });
        }
        perQuestion.push({
          questionId: q.id, stem: q.stem, type: q.type, source: q.source,
          yourAnswer: userAnswer.length ? userAnswer : null,
          correctAnswer: q.type === "reading" ? q.sub_questions.map((s) => [s.answer]) : [q.answer],
          isCorrect, score: got, totalScore: pts, analysis: q.analysis, sub,
        });
        // 分类/题型聚合
        const cat = q.knowledge_category;
        const typ = q.type;
        detail.byCategory[cat] = detail.byCategory[cat] || { correct: 0, total: 0 };
        detail.byType[typ] = detail.byType[typ] || { correct: 0, total: 0 };
        detail.byCategory[cat].total += pts;
        detail.byType[typ].total += pts;
        if (isCorrect) { detail.byCategory[cat].correct += got; detail.byType[typ].correct += got; }
        // 答题记录 + 错题入本
        if (userAnswer.length) {
          db.answers.push({
            id: mkId("a_"), user_id: user.id, question_id: q.id, user_answer: userAnswer,
            is_correct: isCorrect, score: got, source: "exam", exam_id: exam.id, submitted_at: new Date().toISOString(),
          });
        }
        if (!isCorrect) recordWrong(db, user, q, userAnswer.length ? userAnswer : [null]);
      });

      const result = {
        resultId: mkId("r_"), user_id: user.id, exam_id: exam.id, examTitle: exam.title,
        competitionType: exam.competitionType, score, total, rate: total ? score / total : 0,
        submittedAt: new Date().toISOString(),
        answers: submittedAnswers, detail, perQuestion,
      };
      db.examResults.push(result);
      session.status = "submitted";
      saveDB(db);
      return {
        resultId: result.resultId, score, total, rate: result.rate,
        detail: {
          byCategory: result.detail.byCategory,
          byType: result.detail.byType,
        },
      };
    }

    if (method === "GET" && /^\/exams\/results\/[^/]+$/.test(path)) {
      if (!user) throw fail(401, "UNAUTHORIZED", "请先登录");
      const rid = path.split("/")[3];
      const r = db.examResults.find((x) => x.resultId === rid && x.user_id === user.id);
      if (!r) throw fail(404, "RESULT_NOT_FOUND", "成绩记录不存在");
      return r;
    }

    if (method === "GET" && path === "/exams/results") {
      if (!user) throw fail(401, "UNAUTHORIZED", "请先登录");
      const items = db.examResults
        .filter((r) => r.user_id === user.id)
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
        .map((r) => ({ resultId: r.resultId, examId: r.exam_id, examTitle: r.examTitle, score: r.score, total: r.total, rate: r.rate, submittedAt: r.submittedAt }));
      return { items, total: items.length };
    }

    // ===== 错题本 =====
    if (method === "GET" && path === "/wrong-book") {
      if (!user) throw fail(401, "UNAUTHORIZED", "请先登录");
      let list = db.wrongbook
        .filter((w) => w.user_id === user.id && w.status === "active")
        .sort((a, b) => b.last_wrong_at.localeCompare(a.last_wrong_at));
      if (params.category) {
        const cats = String(params.category).split(",");
        list = list.filter((w) => cats.includes(findQuestion(w.question_id)?.knowledge_category));
      }
      if (params.type) {
        const types = String(params.type).split(",");
        list = list.filter((w) => types.includes(findQuestion(w.question_id)?.type));
      }
      const items = list.map((w) => {
        const q = findQuestion(w.question_id);
        return {
          questionId: w.question_id, stem: q ? q.stem : "", type: q ? q.type : "",
          knowledgeCategory: q ? q.knowledge_category : "",
          wrongCount: w.wrong_count, lastWrongAnswer: w.last_wrong_answer,
          correctAnswerSummary: q ? (q.type === "reading" ? "见子题解析" : String(q.answer)) : "",
          lastWrongAt: w.last_wrong_at,
        };
      });
      return { items, total: items.length };
    }

    if (method === "POST" && path === "/wrong-book/review") {
      if (!user) throw fail(401, "UNAUTHORIZED", "请先登录");
      const { questionId, answer } = body || {};
      const q = findQuestion(questionId);
      if (!q) throw fail(404, "QUESTION_NOT_FOUND", "题目不存在");
      if (!validateAnswer(q, answer)) throw fail(400, "INVALID_ANSWER", "答案格式不正确");
      const { isCorrect, correctAnswer } = gradeQuestion(q, answer);
      q._lastAnswer = answer;
      const { reviewStreak, autoRemoved } = reviewWrong(db, user, q, isCorrect);
      db.answers.push({
        id: mkId("a_"), user_id: user.id, question_id: q.id, user_answer: answer,
        is_correct: isCorrect, score: isCorrect ? scoreOf(q) : 0, source: "review", exam_id: null, submitted_at: new Date().toISOString(),
      });
      saveDB(db);
      return { isCorrect, correctAnswer, analysis: q.analysis, reviewStreak, autoRemoved };
    }

    if (method === "DELETE" && /^\/wrong-book\/[^/]+$/.test(path)) {
      if (!user) throw fail(401, "UNAUTHORIZED", "请先登录");
      const qid = path.split("/")[2];
      const w = db.wrongbook.find((x) => x.user_id === user.id && x.question_id === qid && x.status === "active");
      if (w) { w.status = "removed"; saveDB(db); }
      return null; // 204
    }

    // ===== 学习统计 =====
    if (method === "GET" && path === "/stats/overview") {
      if (!user) throw fail(401, "UNAUTHORIZED", "请先登录");
      const mine = db.answers.filter((a) => a.user_id === user.id);
      const totalAnswered = mine.length;
      const totalCorrect = mine.filter((a) => a.is_correct).length;
      const examCount = db.examResults.filter((r) => r.user_id === user.id).length;
      return {
        totalAnswered,
        totalCorrect,
        overallRate: totalAnswered ? totalCorrect / totalAnswered : 0,
        totalPracticeMinutes: Math.round(totalAnswered * 0.8),
        examCount,
      };
    }

    if (method === "GET" && path === "/stats/categories") {
      if (!user) throw fail(401, "UNAUTHORIZED", "请先登录");
      const mine = db.answers.filter((a) => a.user_id === user.id);
      return {
        items: MOCK_BANK.knowledge_categories.map((c) => {
          const rows = mine.filter((a) => findQuestion(a.question_id)?.knowledge_category === c.id);
          const answered = rows.length;
          const correct = rows.filter((a) => a.is_correct).length;
          return { category: c.name, categoryId: c.id, answered, correct, rate: answered ? correct / answered : 0 };
        }),
      };
    }

    if (method === "GET" && path === "/stats/types") {
      if (!user) throw fail(401, "UNAUTHORIZED", "请先登录");
      const mine = db.answers.filter((a) => a.user_id === user.id);
      return {
        items: MOCK_BANK.question_types.map((t) => {
          const rows = mine.filter((a) => findQuestion(a.question_id)?.type === t.id);
          const answered = rows.length;
          const correct = rows.filter((a) => a.is_correct).length;
          return { type: t.id, answered, correct, rate: answered ? correct / answered : 0 };
        }),
      };
    }

    throw fail(404, "NOT_FOUND", `未实现的接口：${method} ${path}`);
  },
};
