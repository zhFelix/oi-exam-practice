// ============================================================
// meta.js —— 元数据接口（匿名可访问）
// GET /api/meta/competition-types  竞赛类型枚举（动态渲染筛选标签）
// GET /api/meta/categories         知识点分类枚举
// GET /api/meta/types              题型枚举
// ============================================================
import { Router } from 'express';
import { questionBank } from '../store/collections.js';

const router = Router();

/** 竞赛类型：{ code, label } 数组（架构文档 §6.2，前端据此渲染筛选标签，新增赛事无需改前端） */
router.get('/competition-types', (_req, res) => {
  const items = questionBank.competitionTypes.map((c) => ({ code: c.id, label: c.name }));
  res.json({ items });
});

/** 知识点分类枚举（7 类固定） */
router.get('/categories', (_req, res) => {
  res.json({ items: questionBank.knowledgeCategories });
});

/** 题型枚举（4 种固定） */
router.get('/types', (_req, res) => {
  res.json({ items: questionBank.questionTypes });
});

/** 难度枚举 */
router.get('/difficulty-levels', (_req, res) => {
  res.json({ items: questionBank.difficultyLevels });
});

export default router;
