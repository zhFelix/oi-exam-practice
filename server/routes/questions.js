// ============================================================
// questions.js —— 题库接口（F1）
// GET /api/questions         列表 + 筛选（competition/category/type/difficulty/keyword）+ 分页
// GET /api/questions/:id     单题详情（默认不含答案；?withAnswer=1 且已登录时含答案）
// ============================================================
import { Router } from 'express';
import { ApiError } from '../middleware/error.js';
import { optionalAuth } from '../middleware/auth.js';
import { questionBank, findQuestion } from '../store/collections.js';
import { QUESTION_TYPES, DIFFICULTY_MAP } from '../config.js';
import { toApiQuestion, toSummary, parsePagination, paged } from './helpers.js';

const router = Router();

/** 题库列表（匿名可访问；摘要不含答案） */
router.get('/', optionalAuth, (req, res) => {
  const q = req.query;
  const { page, pageSize, offset } = parsePagination(q);

  // 竞赛类型白名单校验（架构文档 §5.1.3：未知枚举返回 400）
  const competitionCodes = questionBank.competitionTypes.map((c) => c.id);
  if (q.competition) {
    const codes = String(q.competition).split(',').filter(Boolean);
    for (const c of codes) {
      if (!competitionCodes.includes(c)) {
        throw new ApiError(400, 'INVALID_COMPETITION', `未知竞赛类型: ${c}`);
      }
    }
  }
  // 题型校验
  if (q.type && !QUESTION_TYPES.includes(q.type)) {
    throw new ApiError(400, 'INVALID_TYPE', `未知题型: ${q.type}`);
  }
  // 难度校验（兼容 1|2|3 与 beginner/intermediate/advanced）
  let difficulty = null;
  if (q.difficulty) {
    difficulty = DIFFICULTY_MAP[String(q.difficulty)];
    if (!difficulty) throw new ApiError(400, 'INVALID_DIFFICULTY', `未知难度: ${q.difficulty}`);
  }

  const keyword = q.keyword ? String(q.keyword).trim().toLowerCase() : '';

  const filtered = questionBank.questions.filter((item) => {
    if (q.competition) {
      const codes = String(q.competition).split(',').filter(Boolean);
      if (!codes.some((c) => (item.competition_types || []).includes(c))) return false;
    }
    if (q.category && item.knowledge_category !== q.category) return false;
    if (q.type && item.type !== q.type) return false;
    if (difficulty && item.difficulty !== difficulty) return false;
    if (keyword && !(item.stem || '').toLowerCase().includes(keyword)) return false;
    return true;
  });

  const total = filtered.length;
  const items = filtered.slice(offset, offset + pageSize).map(toSummary);
  res.json(paged(items, total, page, pageSize));
});

/** 单题详情（匿名可看题目/选项/代码/解析，但不含答案；登录 + withAnswer=1 才返回答案） */
router.get('/:id', optionalAuth, (req, res) => {
  const question = findQuestion(req.params.id);
  if (!question) throw new ApiError(404, 'QUESTION_NOT_FOUND', '题目不存在');
  const withAnswer = req.query.withAnswer === '1' || req.query.withAnswer === 'true';
  const canSeeAnswer = withAnswer && !!req.user;
  res.json(toApiQuestion(question, { withAnswer: canSeeAnswer }));
});

export default router;
