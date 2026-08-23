// ============================================================
// helpers.js —— 路由共用工具：题目 API 形态转换 / 分页
// 数据文件字段为 snake_case，API 传输统一 camelCase（架构文档 §6）
// ============================================================
import { questionTotalScore } from '../services/grader.js';

/**
 * 题目 → API 对象
 * @param {object} q 题目数据
 * @param {object} opts
 *   withAnswer=false  是否包含 answer（含子题答案）
 *   withAnalysis=true 是否包含 analysis（考试期间须为 false，F3.3 纪律）
 */
export function toApiQuestion(q, { withAnswer = false, withAnalysis = true } = {}) {
  const out = {
    id: q.id,
    type: q.type,
    stem: q.stem,
    knowledgeCategory: q.knowledge_category || null,
    knowledgePoints: q.knowledge_points || [],
    competitionTypes: q.competition_types || [],
    difficulty: q.difficulty || 'beginner',
    source: q.source || '',
    year: q.year || null,
    score: questionTotalScore(q),
  };
  if (q.options) out.options = q.options;
  if (q.code) out.code = q.code;
  if (q.analysis && withAnalysis) out.analysis = q.analysis;
  if (q.sub_questions) {
    out.subQuestions = q.sub_questions.map((s) => {
      const sub = { id: s.id, type: s.type, stem: s.stem };
      if (s.options) sub.options = s.options;
      if (s.analysis && withAnalysis) sub.analysis = s.analysis;
      if (withAnswer) sub.answer = s.answer;
      return sub;
    });
  }
  if (withAnswer) out.answer = q.answer;
  return out;
}

/** 列表摘要（不含答案与解析细节，防止未登录窥探） */
export function toSummary(q) {
  const a = toApiQuestion(q, { withAnswer: false });
  const stem = a.stem && a.stem.length > 80 ? `${a.stem.slice(0, 80)}…` : a.stem;
  return {
    id: a.id,
    type: a.type,
    stem,
    knowledgeCategory: a.knowledgeCategory,
    competitionTypes: a.competitionTypes,
    difficulty: a.difficulty,
    source: a.source,
    score: a.score,
  };
}

/** 从查询串解析分页参数（page ≥ 1，pageSize ≤ 50），返回 { page, pageSize, offset } */
export function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(query.pageSize, 10) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** 列表响应包装：{ items, total, page, pageSize } */
export function paged(items, total, page, pageSize) {
  return { items, total, page, pageSize };
}

/**
 * 判分结果 → API 形态 correctAnswer（统一为数组，与架构文档 §6.3 及 mock 后端一致）：
 *   single → ["B"]；judge → [true]；multiple → ["A","C"]；reading → [["B"],[true]]
 * 前端 showFeedback / 成绩报告按数组形态消费。
 */
export function toApiCorrectAnswer(result) {
  if (!result) return [];
  if (result.perSub) return result.perSub.map((x) => [x.correctAnswer]);
  const c = result.correctAnswer;
  if (Array.isArray(c)) return c; // multiple
  return c === null || c === undefined ? [] : [c]; // single / judge
}
