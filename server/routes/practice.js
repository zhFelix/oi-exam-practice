// ============================================================
// practice.js —— 练习判分（F2）
// POST /api/practice/submit  提交答案 → 即时判分 + 写答题记录 + 错题自动入本
// POST /api/submit           与 practice/submit 等价（任务要求的别名路径）
// ============================================================
import { Router } from 'express';
import { ApiError } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { findQuestion, answersStore, wrongBookStore } from '../store/collections.js';
import { gradeQuestion, validateAnswerShape } from '../services/grader.js';
import { recordWrong } from '../services/wrong-book-service.js';
import { genId } from '../utils/id.js';
import { toApiQuestion, toApiCorrectAnswer } from './helpers.js';

const router = Router();

/** 判分提交处理（practice 与 wrong-book/review 共用核心，此处为 practice 入口） */
export function handleSubmit(req, res) {
  const { questionId, answer, elapsedSeconds } = req.body || {};
  if (typeof questionId !== 'string') throw new ApiError(400, 'INVALID_REQUEST', '缺少 questionId');
  const question = findQuestion(questionId);
  if (!question) throw new ApiError(404, 'QUESTION_NOT_FOUND', '题目不存在');
  if (!validateAnswerShape(question, answer)) {
    throw new ApiError(400, 'INVALID_ANSWER', '答案格式不正确，请按题型提交答案');
  }

  const result = gradeQuestion(question, answer);
  const at = new Date().toISOString();

  // 写答题记录（source=practice）
  answersStore.insert({
    id: genId('a'),
    user_id: req.user.id,
    question_id: questionId,
    user_answer: answer,
    is_correct: result.isCorrect,
    score: result.score,
    source: 'practice',
    exam_id: null,
    elapsed_seconds: Number.isFinite(elapsedSeconds) ? elapsedSeconds : null,
    submitted_at: at,
  });

  // 答错 → 错题自动入本（F2.5）
  if (!result.isCorrect) {
    recordWrong(wrongBookStore, req.user.id, questionId, answer, at);
  }

  res.json({
    isCorrect: result.isCorrect,
    score: result.score,
    totalScore: result.totalScore,
    correctAnswer: toApiCorrectAnswer(result),
    analysis: question.analysis || '',
    knowledgeCategory: question.knowledge_category || null,
    perSub: result.perSub || null,
    question: toApiQuestion(question, { withAnswer: true }), // 附完整题目（含答案），前端可即时渲染解析
  });
}

router.post('/submit', requireAuth, handleSubmit);
export default router;
