// ============================================================
// wrong-book-service.js —— 错题本规则（入本 / 连对 / 自动移出）
// 状态机（PRD F4.3/F4.4，架构文档 §5.4.1）：
//   首次答错 → 插入 active（wrong_count=1, streak=0）
//   再次答错 → wrong_count+1，streak 清零（保持 active）
//   重练答对 → streak+1；streak ≥ WRONG_BOOK_REMOVE_STREAK 时自动移出（removed）
//   手动移除 → status=removed（记录保留用于统计，列表只展示 active）
// ============================================================
import { WRONG_BOOK_REMOVE_STREAK } from '../config.js';

/**
 * 答错入本（练习/模拟考/重练答错均调用）
 * @param {import('../store/datastore.js').DataStore} store 错题本存储
 * @param {string} userId
 * @param {string} questionId
 * @param {*} wrongAnswer 本次错选答案
 * @param {string} at ISO 时间
 * @returns 更新后的错题本记录
 */
export function recordWrong(store, userId, questionId, wrongAnswer, at = new Date().toISOString()) {
  const existing = store.find({ user_id: userId, question_id: questionId })[0] || null;
  if (existing) {
    store.update(
      (r) => r.user_id === userId && r.question_id === questionId,
      {
        wrong_count: existing.wrong_count + 1,
        review_correct_streak: 0,
        status: 'active',
        last_wrong_answer: wrongAnswer,
        last_wrong_at: at,
      }
    );
    return store.find({ user_id: userId, question_id: questionId })[0];
  }
  const record = {
    id: `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    user_id: userId,
    question_id: questionId,
    wrong_count: 1,
    review_correct_streak: 0,
    status: 'active',
    last_wrong_answer: wrongAnswer,
    last_wrong_at: at,
    added_at: at,
  };
  store.insert(record);
  return record;
}

/**
 * 重练提交后的状态更新（答对推进连对/自动移出，答错回退入本）
 * @param {import('../store/datastore.js').DataStore} store
 * @param {string} userId
 * @param {string} questionId
 * @param {boolean} isCorrect 本次重练是否答对
 * @param {*} answer 本次答案
 * @param {string} at
 * @returns {object} { record, reviewStreak, autoRemoved }
 *   reviewStreak：当前连对次数（不在错题本且答对时为 0）
 *   autoRemoved：本次是否因连对达标自动移出
 */
export function applyReviewResult(store, userId, questionId, isCorrect, answer, at = new Date().toISOString()) {
  const existing = store.find({ user_id: userId, question_id: questionId })[0] || null;
  if (!existing) {
    // 不在错题本：答对不建记录；答错按首次入本处理
    if (!isCorrect) {
      const record = recordWrong(store, userId, questionId, answer, at);
      return { record, reviewStreak: 0, autoRemoved: false };
    }
    return { record: null, reviewStreak: 0, autoRemoved: false };
  }

  if (isCorrect) {
    const streak = existing.review_correct_streak + 1;
    const autoRemoved = streak >= WRONG_BOOK_REMOVE_STREAK;
    store.update(
      (r) => r.user_id === userId && r.question_id === questionId,
      { review_correct_streak: streak, status: autoRemoved ? 'removed' : existing.status }
    );
    const record = store.find({ user_id: userId, question_id: questionId })[0];
    return { record, reviewStreak: streak, autoRemoved };
  }

  // 答错：连对清零，wrong_count+1，重新激活
  const record = recordWrong(store, userId, questionId, answer, at);
  return { record, reviewStreak: 0, autoRemoved: false };
}

/** 手动移出错题本（status=removed，记录保留） */
export function removeWrong(store, userId, questionId) {
  return store.update(
    (r) => r.user_id === userId && r.question_id === questionId && r.status === 'active',
    { status: 'removed' }
  );
}
