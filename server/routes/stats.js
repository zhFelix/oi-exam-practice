// ============================================================
// stats.js —— 学习统计接口（F5）
// GET /api/stats/overview    总体概览
// GET /api/stats/categories  7 类知识点正确率
// GET /api/stats/types       4 种题型正确率
// （由 answers 记录实时聚合；trend 为 P1 暂不实现）
// ============================================================
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { answersStore, examResultsStore, questionBank, findQuestion } from '../store/collections.js';
import { QUESTION_TYPES } from '../config.js';

const router = Router();
router.use(requireAuth);

function myAnswers(userId) {
  return answersStore.find({ user_id: userId });
}

function rateOf(correct, total) {
  return total === 0 ? 0 : Number((correct / total).toFixed(4));
}

/** 总体概览（F5.1）：总刷题数 / 总正确率 / 累计练习时长（估算） */
router.get('/overview', (req, res) => {
  const answers = myAnswers(req.user.id);
  const totalAnswered = answers.length;
  const totalCorrect = answers.filter((a) => a.is_correct).length;

  // 练习时长：优先累加 elapsed_seconds；无记录时按每题 1 分钟估算（架构文档 §6.6 P0）
  const withElapsed = answers.filter((a) => Number.isFinite(a.elapsed_seconds) && a.elapsed_seconds > 0);
  const totalSeconds = withElapsed.length
    ? withElapsed.reduce((s, a) => s + a.elapsed_seconds, 0)
    : totalAnswered * 60;

  res.json({
    totalAnswered,
    totalCorrect,
    overallRate: rateOf(totalCorrect, totalAnswered),
    totalPracticeMinutes: Math.round(totalSeconds / 60),
    examCount: examResultsStore.count({ user_id: req.user.id }), // 模拟考次数（F5.1）
  });
});

/** 分类正确率（F5.2）：7 类全覆盖（无记录的分类返回 0） */
router.get('/categories', (req, res) => {
  const answers = myAnswers(req.user.id);
  const map = new Map(questionBank.knowledgeCategories.map((c) => [c.id, { answered: 0, correct: 0 }]));
  for (const a of answers) {
    const q = findQuestion(a.question_id);
    const cat = q ? q.knowledge_category : 'unknown';
    if (!map.has(cat)) map.set(cat, { answered: 0, correct: 0 });
    const row = map.get(cat);
    row.answered += 1;
    if (a.is_correct) row.correct += 1;
  }
  const items = [...map.entries()].map(([category, row]) => ({
    category,
    answered: row.answered,
    correct: row.correct,
    rate: rateOf(row.correct, row.answered),
  }));
  res.json({ items });
});

/** 题型正确率（F5.3）：4 种题型全覆盖 */
router.get('/types', (req, res) => {
  const answers = myAnswers(req.user.id);
  const map = new Map(QUESTION_TYPES.map((t) => [t, { answered: 0, correct: 0 }]));
  for (const a of answers) {
    const q = findQuestion(a.question_id);
    const t = q ? q.type : 'unknown';
    if (!map.has(t)) map.set(t, { answered: 0, correct: 0 });
    const row = map.get(t);
    row.answered += 1;
    if (a.is_correct) row.correct += 1;
  }
  const items = [...map.entries()].map(([type, row]) => ({
    type,
    answered: row.answered,
    correct: row.correct,
    rate: rateOf(row.correct, row.answered),
  }));
  res.json({ items });
});

export default router;
