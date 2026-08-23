// ============================================================
// wrong-book.js —— 错题本接口（F4）
// GET    /api/wrong-book               错题列表（仅 active，时间倒序，可筛选/分页）
// POST   /api/wrong-book/review        错题重练提交（判分 + 状态机）
// DELETE /api/wrong-book/:questionId   手动移除
// GET    /api/wrong-book/stats         错题分类排行
// ============================================================
import { Router } from 'express';
import { ApiError } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { findQuestion, answersStore, wrongBookStore } from '../store/collections.js';
import { gradeQuestion, validateAnswerShape, questionTotalScore } from '../services/grader.js';
import { applyReviewResult, removeWrong } from '../services/wrong-book-service.js';
import { genId } from '../utils/id.js';
import { parsePagination, paged, toApiCorrectAnswer } from './helpers.js';

const router = Router();
router.use(requireAuth);

/** 错题列表（F4.1）：仅 active，按 last_wrong_at 倒序 */
router.get('/', (req, res) => {
  const { page, pageSize, offset } = parsePagination(req.query);
  const category = req.query.category;
  const type = req.query.type;

  const active = wrongBookStore
    .find({ user_id: req.user.id, status: 'active' })
    .filter((w) => {
      const q = findQuestion(w.question_id);
      if (!q) return false;
      if (category && q.knowledge_category !== category) return false;
      if (type && q.type !== type) return false;
      return true;
    })
    .sort((a, b) => (a.last_wrong_at < b.last_wrong_at ? 1 : -1));

  const items = active.slice(offset, offset + pageSize).map((w) => {
    const q = findQuestion(w.question_id);
    return {
      questionId: w.question_id,
      stem: q ? (q.stem.length > 80 ? `${q.stem.slice(0, 80)}…` : q.stem) : '',
      type: q ? q.type : null,
      knowledgeCategory: q ? q.knowledge_category : null,
      wrongCount: w.wrong_count,
      lastWrongAnswer: w.last_wrong_answer,
      correctAnswerSummary: q ? summarizeAnswer(q) : '',
      analysisSummary: q ? firstSentence(q.analysis) : '',
      lastWrongAt: w.last_wrong_at,
      addedAt: w.added_at,
    };
  });

  res.json(paged(items, active.length, page, pageSize));
});

/** 错题重练提交（F4.3）：判分 + 状态机（连对/清零/自动移出） */
router.post('/review', (req, res) => {
  const { questionId, answer } = req.body || {};
  if (typeof questionId !== 'string') throw new ApiError(400, 'INVALID_REQUEST', '缺少 questionId');
  const question = findQuestion(questionId);
  if (!question) throw new ApiError(404, 'QUESTION_NOT_FOUND', '题目不存在');
  if (!validateAnswerShape(question, answer)) {
    throw new ApiError(400, 'INVALID_ANSWER', '答案格式不正确，请按题型提交答案');
  }

  const result = gradeQuestion(question, answer);
  const at = new Date().toISOString();
  const { reviewStreak, autoRemoved } = applyReviewResult(
    wrongBookStore, req.user.id, questionId, result.isCorrect, answer, at
  );

  // 写答题记录（source=wrong-review，统计计入 PRD F5 DoD）
  answersStore.insert({
    id: genId('a'),
    user_id: req.user.id,
    question_id: questionId,
    user_answer: answer,
    is_correct: result.isCorrect,
    score: result.score,
    source: 'wrong-review',
    exam_id: null,
    submitted_at: at,
  });

  res.json({
    isCorrect: result.isCorrect,
    score: result.score,
    totalScore: result.totalScore,
    correctAnswer: toApiCorrectAnswer(result),
    analysis: question.analysis || '',
    knowledgeCategory: question.knowledge_category || null,
    perSub: result.perSub || null,
    reviewStreak,
    autoRemoved,
  });
});

/** 手动移出错题本（F4.4） */
router.delete('/:questionId', (req, res) => {
  const changed = removeWrong(wrongBookStore, req.user.id, req.params.questionId);
  if (!changed) throw new ApiError(404, 'WRONG_BOOK_NOT_FOUND', '错题记录不存在');
  res.status(204).end();
});

/** 错题分类排行（F4.5）：active 记录按知识点分类汇总答错次数 */
router.get('/stats', (req, res) => {
  const map = new Map();
  for (const w of wrongBookStore.find({ user_id: req.user.id, status: 'active' })) {
    const q = findQuestion(w.question_id);
    const cat = q ? q.knowledge_category : 'unknown';
    map.set(cat, (map.get(cat) || 0) + w.wrong_count);
  }
  const items = [...map.entries()]
    .map(([knowledgeCategory, wrongCount]) => ({ knowledgeCategory, wrongCount }))
    .sort((a, b) => b.wrongCount - a.wrongCount);
  res.json({ items });
});

// ---- 工具 ----

/** 正确答案摘要（列表展示用，不含解析全文） */
function summarizeAnswer(q) {
  if (q.type === 'judge') return q.answer === true ? '正确' : '错误';
  if (q.type === 'multiple') return Array.isArray(q.answer) ? q.answer.join(', ') : String(q.answer);
  if (q.type === 'reading') return `共 ${(q.sub_questions || []).length} 道小题`;
  return String(q.answer);
}

/** 解析第一句（正确思路摘要，PRD F4.1） */
function firstSentence(text) {
  if (!text) return '';
  const idx = text.search(/[。！？!?]/);
  return idx >= 0 ? text.slice(0, idx + 1) : text.slice(0, 60);
}

export default router;
