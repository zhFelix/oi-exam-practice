// ============================================================
// collections.js —— 各数据集合的存取封装
// - 题库（questions.json + questions-extra.json 合并，只读）
// - 模拟卷（exams.json，只读）
// - users / answers / wrong-book / exam-sessions / exam-results
//   （JSON 文件持久化，可写）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { DataStore } from './datastore.js';

// ---- 可写集合 ----
export const usersStore = new DataStore('users.json');
export const answersStore = new DataStore('answers.json');
export const wrongBookStore = new DataStore('wrong-book.json');
export const examSessionsStore = new DataStore('exam-sessions.json');
export const examResultsStore = new DataStore('exam-results.json');

// ---- 题库（只读，启动时从数据文件加载合并） ----
const QUESTION_FILES = ['questions.json', 'questions-extra.json'];

export const questionBank = {
  questions: [],      // 合并去重后的题目数组
  competitionTypes: [],  // 竞赛类型枚举（[{id,name,description}]）
  knowledgeCategories: [], // 知识点分类枚举
  questionTypes: [],   // 题型枚举
  difficultyLevels: [], // 难度枚举
};

/** 模拟卷（只读，从 data/exams.json 加载） */
export const exams = [];

/** 加载题库：合并多个数据文件，按 id 去重（先出现者优先），枚举以主文件为准 */
export function initQuestionBank() {
  const seen = new Set();
  for (const file of QUESTION_FILES) {
    const p = path.join(DATA_DIR, file);
    if (!fs.existsSync(p)) continue;
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!questionBank.competitionTypes.length && Array.isArray(doc.competition_types)) {
      questionBank.competitionTypes = doc.competition_types;
    }
    if (!questionBank.knowledgeCategories.length && Array.isArray(doc.knowledge_categories)) {
      questionBank.knowledgeCategories = doc.knowledge_categories;
    }
    if (!questionBank.questionTypes.length && Array.isArray(doc.question_types)) {
      questionBank.questionTypes = doc.question_types;
    }
    if (!questionBank.difficultyLevels.length && Array.isArray(doc.difficulty_levels)) {
      questionBank.difficultyLevels = doc.difficulty_levels;
    }
    for (const q of doc.questions || []) {
      if (!seen.has(q.id)) {
        seen.add(q.id);
        questionBank.questions.push(q);
      }
    }
  }
  return questionBank;
}

/** 加载模拟卷：data/exams.json → exams[]（题目 id 不存在的条目跳过并告警） */
export function initExams() {
  const p = path.join(DATA_DIR, 'exams.json');
  if (!fs.existsSync(p)) return exams;
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const e of doc.exams || []) {
    const validIds = (e.question_ids || []).filter((id) => findQuestion(id));
    if (validIds.length !== (e.question_ids || []).length) {
      console.warn(`[exams] ${e.id} 存在题库中不存在的题目 id，已过滤`);
    }
    exams.push({ ...e, question_ids: validIds });
  }
  return exams;
}

/** 按 id 查卷 */
export function findExam(id) {
  return exams.find((e) => e.id === id) || null;
}

/** 按 id 查题（含子小题 id 查找） */
export function findQuestion(id) {
  const q = questionBank.questions.find((x) => x.id === id);
  if (q) return q;
  // reading 题的子小题也可被单独引用（如错题本定位到小题）
  for (const parent of questionBank.questions) {
    const sub = (parent.sub_questions || []).find((s) => s.id === id);
    if (sub) return { ...sub, parent_id: parent.id };
  }
  return null;
}
