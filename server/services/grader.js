// ============================================================
// grader.js —— 判分核心（练习/模拟考/错题重练共用同一规则）
// 判分规则（PRD F2.1 / 架构文档 §5.1.2）：
//   single  单选题：答案唯一匹配
//   multiple 多选题：集合完全相等（全对才得分，顺序无关）
//   judge   判断题：布尔匹配
//   reading 阅读程序题：各子小题独立判分，大题得分 = Σ子题得分
// 数据中 answer 形态（data-model.md §3.3）：
//   single="B"  multiple=["A","C"]  judge=true/false
//   reading=子题答案数组（子题 single 为字符串 / judge 为布尔）
// 用户提交的 answer 兼容少量等价形态（如数组包一层 / "T"/"F" 文本）。
// ============================================================
import { DEFAULT_SCORE } from '../config.js';

/** 单选答案归一化："B" | ["B"] -> "B" */
function normSingle(v) {
  if (Array.isArray(v)) return v.length ? v[0] : null;
  return v == null ? null : String(v);
}

/** 判断题答案归一化：true | "T" | "true" | "正确" | [true] -> true */
function normBoolean(v) {
  // 兼容前端数组形态 [true] / ["T"]（单选/阅读子题提交均按数组包裹）
  if (Array.isArray(v)) return v.length ? normBoolean(v[0]) : null;
  if (typeof v === 'boolean') return v;
  if (v === 'T' || v === 'true' || v === '正确') return true;
  if (v === 'F' || v === 'false' || v === '错误') return false;
  return null;
}

/** 多选答案归一化：["C","A"] -> ["A","C"]（排序去重，集合比较） */
function normMultiple(v) {
  const arr = Array.isArray(v) ? v : v == null ? [] : [v];
  return [...new Set(arr.map((x) => String(x)))].sort();
}

/** 题目总分（数据未标注 score 时按题型默认分计算） */
export function questionTotalScore(question) {
  if (typeof question.score === 'number') return question.score;
  if (question.type === 'reading') {
    const subs = question.sub_questions || [];
    return subs.reduce((s, x) => s + (typeof x.score === 'number' ? x.score : DEFAULT_SCORE[x.type] ?? 1), 0);
  }
  return DEFAULT_SCORE[question.type] ?? 1;
}

/** 判分子题（single / judge） */
function gradeSub(sub, userAnswer) {
  const total = typeof sub.score === 'number' ? sub.score : DEFAULT_SCORE[sub.type] ?? 1;
  if (sub.type === 'judge') {
    const a = normBoolean(userAnswer);
    const c = normBoolean(sub.answer);
    const isCorrect = a !== null && c !== null && a === c;
    return { isCorrect, score: isCorrect ? total : 0, totalScore: total, correctAnswer: c };
  }
  // 默认按单选处理
  const a = normSingle(userAnswer);
  const c = normSingle(sub.answer);
  const isCorrect = a !== null && c !== null && a === c;
  return { isCorrect, score: isCorrect ? total : 0, totalScore: total, correctAnswer: c };
}

/**
 * 判分主函数
 * @param {object} question 题目对象（含 type/answer/sub_questions 等）
 * @param {*} userAnswer 用户答案
 * @returns {object} { isCorrect, score, totalScore, correctAnswer, perSub, invalid }
 *   - correctAnswer：single 字符串 / multiple 数组 / judge 布尔 / reading 子题答案数组
 *   - perSub：reading 题的逐子题判分详情（[{isCorrect,score,totalScore,correctAnswer,analysis}]）
 *   - invalid：答案形态不合法（提交前应先用 validateAnswerShape 拦截）
 */
export function gradeQuestion(question, userAnswer) {
  switch (question.type) {
    case 'single': {
      const a = normSingle(userAnswer);
      const c = normSingle(question.answer);
      const isCorrect = a !== null && c !== null && a === c;
      const total = questionTotalScore(question);
      return { isCorrect, score: isCorrect ? total : 0, totalScore: total, correctAnswer: c, perSub: null, invalid: false };
    }
    case 'judge': {
      const a = normBoolean(userAnswer);
      const c = normBoolean(question.answer);
      const isCorrect = a !== null && c !== null && a === c;
      const total = questionTotalScore(question);
      return { isCorrect, score: isCorrect ? total : 0, totalScore: total, correctAnswer: c, perSub: null, invalid: false };
    }
    case 'multiple': {
      const a = normMultiple(userAnswer);
      const c = normMultiple(question.answer);
      const isCorrect = a.length > 0 && JSON.stringify(a) === JSON.stringify(c);
      const total = questionTotalScore(question);
      return { isCorrect, score: isCorrect ? total : 0, totalScore: total, correctAnswer: c, perSub: null, invalid: false };
    }
    case 'reading': {
      const subs = question.sub_questions || [];
      if (!Array.isArray(userAnswer) || userAnswer.length !== subs.length) {
        return { isCorrect: false, score: 0, totalScore: questionTotalScore(question), correctAnswer: null, perSub: null, invalid: true };
      }
      const perSub = subs.map((sub, i) => {
        const r = gradeSub(sub, userAnswer[i]);
        return { ...r, analysis: sub.analysis || '' };
      });
      const score = perSub.reduce((s, x) => s + x.score, 0);
      const total = questionTotalScore(question);
      const isCorrect = perSub.every((x) => x.isCorrect);
      const correctAnswer = perSub.map((x) => x.correctAnswer);
      return { isCorrect, score, totalScore: total, correctAnswer, perSub, invalid: false };
    }
    default:
      return { isCorrect: false, score: 0, totalScore: 0, correctAnswer: null, perSub: null, invalid: true };
  }
}

/** 校验用户答案形态（提交前调用，不合法返回 false → 400 INVALID_ANSWER） */
export function validateAnswerShape(question, userAnswer) {
  if (userAnswer === undefined || userAnswer === null) return false;
  switch (question.type) {
    case 'single':
      return typeof userAnswer === 'string' || (Array.isArray(userAnswer) && userAnswer.length === 1 && typeof userAnswer[0] === 'string');
    case 'judge':
      return typeof userAnswer === 'boolean' || ['T', 'F', 'true', 'false', '正确', '错误'].includes(String(userAnswer));
    case 'multiple':
      return Array.isArray(userAnswer) && userAnswer.length >= 1 && userAnswer.every((k) => typeof k === 'string');
    case 'reading': {
      const subs = question.sub_questions || [];
      if (!Array.isArray(userAnswer) || userAnswer.length !== subs.length) return false;
      return subs.every((sub, i) => {
        const v = userAnswer[i];
        if (sub.type === 'judge') return typeof v === 'boolean' || ['T', 'F', 'true', 'false', '正确', '错误'].includes(String(v));
        return typeof v === 'string' || (Array.isArray(v) && v.length === 1);
      });
    }
    default:
      return false;
  }
}
