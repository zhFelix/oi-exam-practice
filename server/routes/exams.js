// ============================================================
// exams.js —— 模拟考试接口（F3，整卷限时）
// GET  /api/exams                    模拟卷列表（匿名可访问，按竞赛类型筛选）
// GET  /api/exams/history            历史成绩（需登录）
// GET  /api/exams/results            历史成绩（架构文档路径别名）
// GET  /api/exams/results/:resultId  单次成绩报告（考后含逐题对错+解析）
// GET  /api/exams/:id                试卷详情（脱敏：不含答案/解析）
// POST /api/exams/:id/start          开始考试（服务端记时，创建/恢复会话）
// POST /api/exams/:id/submit         交卷（限时校验，超时自动交卷按已答计分）
// POST /api/exams/session/:sessionId/submit  交卷（架构文档路径别名）
// ============================================================
import { Router } from 'express';
import { ApiError } from '../middleware/error.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import {
  exams, findExam, findQuestion, answersStore, wrongBookStore,
  examSessionsStore, examResultsStore,
} from '../store/collections.js';
import { gradeQuestion, questionTotalScore } from '../services/grader.js';
import { recordWrong } from '../services/wrong-book-service.js';
import { genId } from '../utils/id.js';
import { toApiQuestion, toApiCorrectAnswer, parsePagination, paged } from './helpers.js';

const router = Router();

// ---------- 工具 ----------

/** 试卷元信息（列表/详情用，不含题目内容） */
function toExamMeta(exam) {
  return {
    id: exam.id,
    title: exam.title,
    competitionType: exam.competition_type,
    durationMinutes: exam.duration_minutes,
    questionCount: exam.question_ids.length,
    totalScore: exam.question_ids.reduce((s, qid) => {
      const q = findQuestion(qid);
      return s + (q ? questionTotalScore(q) : 0);
    }, 0),
  };
}

/** 试卷题目（考试期间脱敏：不含 answer 与 analysis，F3.3 纪律） */
function examQuestions(exam) {
  return exam.question_ids
    .map((qid) => findQuestion(qid))
    .filter(Boolean)
    .map((q) => toApiQuestion(q, { withAnswer: false, withAnalysis: false }));
}

/** 查找用户在某卷的会话（任何状态） */
function findUserSession(userId, examId) {
  return examSessionsStore.find({ user_id: userId, exam_id: examId })[0] || null;
}

/** 逐题判分（核心，交卷共用） */
function gradeExam(exam, userId, answers, submittedAt) {
  const perQuestion = exam.question_ids
    .map((qid) => {
      const q = findQuestion(qid);
      if (!q) return null;
      const userAnswer = answers[qid];
      const answered = userAnswer !== undefined && userAnswer !== null;
      const row = {
        questionId: qid,
        type: q.type,
        stem: q.stem,
        knowledgeCategory: q.knowledge_category || null,
        answered,
        yourAnswer: answered ? userAnswer : null,
        isCorrect: false,
        score: 0,
        totalScore: questionTotalScore(q),
        correctAnswer: [],
        analysis: q.analysis || '',
        sub: null,
      };
      if (!answered) return row; // 未答题：0 分，不写答题记录、不入错题本

      const g = gradeQuestion(q, userAnswer);
      row.isCorrect = g.isCorrect;
      row.score = g.score;
      row.correctAnswer = toApiCorrectAnswer(g);
      if (q.type === 'reading') {
        // 阅读题：子题详情（含子题题干/你的答案/解析，成绩报告逐题回顾用）
        row.sub = (g.perSub || []).map((x, i) => ({
          stem: (q.sub_questions[i] || {}).stem || '',
          yourAnswer: (userAnswer[i] && userAnswer[i].length) ? userAnswer[i][0] : null,
          correctAnswer: x.correctAnswer,
          isCorrect: x.isCorrect,
          score: x.score,
          totalScore: x.totalScore,
          analysis: x.analysis || '',
        }));
      }

      // 写答题记录（source=exam，统计自动计入）
      answersStore.insert({
        id: genId('a'),
        user_id: userId,
        question_id: qid,
        user_answer: userAnswer,
        is_correct: g.isCorrect,
        score: g.score,
        source: 'exam',
        exam_id: exam.id,
        submitted_at: submittedAt,
      });

      // 答错 → 错题自动入本（F3.6；未答题不计入错题本）
      if (!g.isCorrect) {
        recordWrong(wrongBookStore, userId, qid, userAnswer, submittedAt);
      }
      return row;
    })
    .filter(Boolean);

  const score = perQuestion.reduce((s, x) => s + x.score, 0);
  const total = perQuestion.reduce((s, x) => s + x.totalScore, 0);
  const rate = total === 0 ? 0 : Number((score / total).toFixed(4));

  // 分类 / 题型得分汇总（成绩报告 detail，PRD F3.5）
  // correct/total 为"得分/满分"（分值口径，与前端报告条形图一致）；score/totalScore 为别名
  const byCategory = {};
  const byType = {};
  for (const row of perQuestion) {
    const cat = row.knowledgeCategory || 'unknown';
    const typ = row.type;
    byCategory[cat] = byCategory[cat] || { correct: 0, total: 0, score: 0, totalScore: 0 };
    byType[typ] = byType[typ] || { correct: 0, total: 0, score: 0, totalScore: 0 };
    byCategory[cat].correct += row.score;
    byCategory[cat].total += row.totalScore;
    byCategory[cat].score += row.score;
    byCategory[cat].totalScore += row.totalScore;
    byType[typ].correct += row.score;
    byType[typ].total += row.totalScore;
    byType[typ].score += row.score;
    byType[typ].totalScore += row.totalScore;
  }

  return { perQuestion, score, total, rate, byCategory, byType };
}

// ---------- 试卷列表 / 详情（匿名可访问，脱敏） ----------

/** 模拟卷列表（F3.1，匿名可访问；可选 competition 筛选） */
router.get('/', optionalAuth, (req, res) => {
  const competition = req.query.competition;
  const list = competition
    ? exams.filter((e) => e.competition_type === competition)
    : exams;
  res.json({ items: list.map(toExamMeta) });
});

/** 历史成绩响应（/history 与别名 /results 共用） */
function historyResponse(req, res) {
  const { page, pageSize, offset } = parsePagination(req.query);
  const results = examResultsStore
    .find({ user_id: req.user.id })
    .sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1));
  const items = results.slice(offset, offset + pageSize).map((r) => ({
    resultId: r.id,
    examId: r.exam_id,
    examTitle: r.exam_title,
    competitionType: r.competition_type,
    score: r.score,
    total: r.total,
    rate: r.rate,
    elapsedSeconds: r.elapsed_seconds,
    auto: r.auto,
    submittedAt: r.submitted_at,
  }));
  res.json(paged(items, results.length, page, pageSize));
}

/** 历史成绩（F3.7）：倒序分页 */
router.get('/history', requireAuth, historyResponse);

/** 架构文档路径别名：GET /api/exams/results 等价 /history */
router.get('/results', requireAuth, historyResponse);

/** 单次成绩报告（考后查看，F3.5：逐题对错 + 解析） */
router.get('/results/:resultId', requireAuth, (req, res) => {
  const r = examResultsStore.findById(req.params.resultId);
  if (!r) throw new ApiError(404, 'RESULT_NOT_FOUND', '成绩记录不存在');
  if (r.user_id !== req.user.id) throw new ApiError(403, 'FORBIDDEN', '无权查看他人成绩');
  res.json({
    resultId: r.id,
    examId: r.exam_id,
    examTitle: r.exam_title,
    competitionType: r.competition_type,
    score: r.score,
    total: r.total,
    rate: r.rate,
    elapsedSeconds: r.elapsed_seconds,
    auto: r.auto,
    submittedAt: r.submitted_at,
    detail: r.detail,
    perQuestion: (r.detail && r.detail.perQuestion) || [], // 逐题回顾（与 detail.perQuestion 同源，前端直接消费）
  });
});

/** 试卷详情（评审建议：仅返回卷元信息 + 规则，题目内容由 start 接口下发，防止整卷预先导出） */
router.get('/:id', optionalAuth, (req, res) => {
  const exam = findExam(req.params.id);
  if (!exam) throw new ApiError(404, 'EXAM_NOT_FOUND', '试卷不存在');
  res.json({
    ...toExamMeta(exam),
    rules: { unansweredAsWrong: exam.unanswered_as_wrong !== false },
  });
});

// ---------- 开始考试 / 交卷（需登录） ----------

/** 开始考试（F3.2）：创建会话并服务端记时；已有进行中会话则恢复（幂等） */
router.post('/:id/start', requireAuth, (req, res) => {
  const exam = findExam(req.params.id);
  if (!exam) throw new ApiError(404, 'EXAM_NOT_FOUND', '试卷不存在');

  const existing = examSessionsStore
    .find({ user_id: req.user.id, exam_id: exam.id, status: 'ongoing' })[0] || null;
  if (existing) {
    const remainingSeconds = remainingOf(exam, existing);
    return res.json({
      sessionId: existing.id,
      resumed: true,
      startedAt: existing.started_at,
      remainingSeconds,
      durationMinutes: exam.duration_minutes,
      questions: examQuestions(exam),
    });
  }

  const session = {
    id: genId('s'),
    user_id: req.user.id,
    exam_id: exam.id,
    answers: {},
    started_at: new Date().toISOString(),
    status: 'ongoing',
  };
  examSessionsStore.insert(session);
  res.status(201).json({
    sessionId: session.id,
    resumed: false,
    startedAt: session.started_at,
    remainingSeconds: Math.round(exam.duration_minutes * 60),
    durationMinutes: exam.duration_minutes,
    questions: examQuestions(exam),
  });
});

/** 交卷核心（手动 + 超时自动）：限时校验，超时按已答计分，生成成绩报告 */
function doSubmit(req, res, session) {
  const exam = findExam(session.exam_id);
  if (!exam) throw new ApiError(404, 'EXAM_NOT_FOUND', '试卷不存在');
  if (session.status !== 'ongoing') {
    throw new ApiError(409, 'ALREADY_SUBMITTED', '该试卷已交卷，请查看成绩报告');
  }

  const answers = (req.body && typeof req.body === 'object' && req.body.answers) || {};
  const submittedAt = new Date().toISOString();
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - Date.parse(session.started_at)) / 1000));
  // 超时自动交卷：服务端按 duration 校验，超时提交按剩余已答题目计分（F3.2/F3.4）
  const auto = elapsedSeconds >= Math.round(exam.duration_minutes * 60);

  const { perQuestion, score, total, rate, byCategory, byType } =
    gradeExam(exam, req.user.id, answers, submittedAt);

  // 成绩单（存储 detail 供报告页回看）
  const result = {
    id: genId('r'),
    user_id: req.user.id,
    exam_id: exam.id,
    exam_title: exam.title,
    competition_type: exam.competition_type,
    score,
    total,
    rate,
    elapsed_seconds: elapsedSeconds,
    auto,
    answers: answers, // 作答快照
    detail: { byCategory, byType, perQuestion },
    submitted_at: submittedAt,
  };
  examResultsStore.insert(result);

  // 会话标记已交卷
  examSessionsStore.update((s) => s.id === session.id, { status: 'submitted', submitted_at: submittedAt });

  res.json({
    resultId: result.id,
    examId: exam.id,
    examTitle: exam.title,
    competitionType: exam.competition_type,
    score,
    total,
    rate,
    elapsedSeconds,
    auto,
    detail: { byCategory, byType },
    perQuestion,
  });
}

/** 任务路径：POST /api/exams/:id/submit（按用户在该卷的进行中会话交卷） */
router.post('/:id/submit', requireAuth, (req, res) => {
  const exam = findExam(req.params.id);
  if (!exam) throw new ApiError(404, 'EXAM_NOT_FOUND', '试卷不存在');
  const session = findUserSession(req.user.id, exam.id);
  if (!session) throw new ApiError(400, 'EXAM_NOT_STARTED', '请先开始考试');
  doSubmit(req, res, session);
});

/** 架构文档路径别名：POST /api/exams/session/:sessionId/submit */
router.post('/session/:sessionId/submit', requireAuth, (req, res) => {
  const session = examSessionsStore.findById(req.params.sessionId);
  if (!session) throw new ApiError(404, 'SESSION_NOT_FOUND', '考试会话不存在');
  if (session.user_id !== req.user.id) throw new ApiError(403, 'FORBIDDEN', '无权操作他人会话');
  doSubmit(req, res, session);
});

/** 剩余秒数 */
function remainingOf(exam, session) {
  const elapsed = (Date.now() - Date.parse(session.started_at)) / 1000;
  return Math.max(0, Math.round(exam.duration_minutes * 60 - elapsed));
}

export default router;
