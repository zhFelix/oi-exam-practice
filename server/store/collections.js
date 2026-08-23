// ============================================================
// collections.js —— 各数据集合的存取封装（t12：Supabase 优先，JSON 降级）
// - 题库（questions）：Supabase questions 表优先，失败回退 questions.json +
//   questions-extra.json 合并；枚举定义始终来自数据文件（数据库无枚举表）
// - 模拟卷（exams）：Supabase exams 表优先，失败回退 exams.json
// - 运行期集合 users/answers/wrong_book/exam_sessions/exam_results：
//   启动时 initStores() 按 Supabase 可用性选择
//   SupabaseStore（内存缓存+异步持久化）或 DataStore（JSON 文件）
// 接口不变（find/findById/insert/update/remove/count 均同步），业务路由零改动；
// store 实例为 ESM live binding，initStores 赋值后路由可见。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { supabase, isSupabaseConfigured } from './supabase.js';
import { DataStore } from './datastore.js';
import { SupabaseStore } from './supabase-store.js';

// ---- 运行期集合（懒初始化：initStores() 后可用） ----
export let usersStore = null;
export let answersStore = null;
export let wrongBookStore = null;
export let examSessionsStore = null;
export let examResultsStore = null;

/** 是否运行在 Supabase 存储模式（false = JSON 文件降级） */
export let supabaseMode = false;

const JSON_FILES = {
  users: 'users.json',
  answers: 'answers.json',
  wrongBook: 'wrong-book.json',
  examSessions: 'exam-sessions.json',
  examResults: 'exam-results.json',
};
const SUPABASE_TABLES = {
  users: 'users',
  answers: 'answers',
  wrongBook: 'wrong_book',
  examSessions: 'exam_sessions',
  examResults: 'exam_results',
};

/** 初始化运行期存储：Supabase 可用则用 SupabaseStore，否则回退 JSON DataStore */
export async function initStores() {
  if (isSupabaseConfigured) {
    const candidates = {
      usersStore: new SupabaseStore(SUPABASE_TABLES.users),
      answersStore: new SupabaseStore(SUPABASE_TABLES.answers),
      wrongBookStore: new SupabaseStore(SUPABASE_TABLES.wrongBook),
      examSessionsStore: new SupabaseStore(SUPABASE_TABLES.examSessions),
      examResultsStore: new SupabaseStore(SUPABASE_TABLES.examResults),
    };
    try {
      await Promise.all(Object.values(candidates).map((s) => s.load()));
      ({ usersStore, answersStore, wrongBookStore, examSessionsStore, examResultsStore } = candidates);
      supabaseMode = true;
      console.log('[store] Supabase 存储模式：users/answers/wrong_book/exam_sessions/exam_results');
      return;
    } catch (e) {
      console.warn(`[store] Supabase 存储不可用（${e.message}），回退 JSON 文件存储`);
    }
  }
  usersStore = new DataStore(JSON_FILES.users);
  answersStore = new DataStore(JSON_FILES.answers);
  wrongBookStore = new DataStore(JSON_FILES.wrongBook);
  examSessionsStore = new DataStore(JSON_FILES.examSessions);
  examResultsStore = new DataStore(JSON_FILES.examResults);
  supabaseMode = false;
}

/** 优雅退出前排空所有 Supabase 写队列（JSON 模式为同步落盘，无需等待） */
export async function flushStores() {
  if (!supabaseMode) return;
  const stores = [usersStore, answersStore, wrongBookStore, examSessionsStore, examResultsStore]
    .filter((s) => s && typeof s.flush === 'function');
  await Promise.all(stores.map((s) => s.flush()));
  console.log('[store] Supabase 写队列已排空');
}

// ---- 题库（只读） ----
const QUESTION_FILES = ['questions.json', 'questions-extra.json'];

export const questionBank = {
  questions: [],      // 题目数组（Supabase 或数据文件）
  competitionTypes: [],  // 竞赛类型枚举（[{id,name,description}]，来自数据文件）
  knowledgeCategories: [], // 知识点分类枚举（来自数据文件）
  questionTypes: [],   // 题型枚举（来自数据文件）
  difficultyLevels: [], // 难度枚举（来自数据文件）
};

/** 模拟卷（只读） */
export const exams = [];

/** 从数据文件加载枚举定义（数据库无枚举表，枚举始终以数据文件为准） */
function loadEnumsFromFiles() {
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
    if (questionBank.competitionTypes.length && questionBank.knowledgeCategories.length) break;
  }
}

/** 从数据文件合并加载题库（降级路径） */
function loadQuestionsFromFiles() {
  const seen = new Set();
  questionBank.questions.length = 0;
  for (const file of QUESTION_FILES) {
    const p = path.join(DATA_DIR, file);
    if (!fs.existsSync(p)) continue;
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const q of doc.questions || []) {
      if (!seen.has(q.id)) {
        seen.add(q.id);
        questionBank.questions.push(q);
      }
    }
  }
}

/** 题库按题号（id）排序：q001、q002、…、q101、q113（数字序，非字典序） */
function sortQuestionsById() {
  questionBank.questions.sort((a, b) =>
    String(a.id).localeCompare(String(b.id), undefined, { numeric: true, sensitivity: 'base' })
  );
}

/** 加载题库：Supabase questions 表优先，失败回退数据文件（t12）；统一按 id 排序 */
export async function initQuestionBank() {
  if (isSupabaseConfigured) {
    try {
      // 显式按 id 排序：PostgREST 默认返回物理存储顺序，不保证题号顺序
      const { data, error } = await supabase.from('questions').select('*').order('id');
      if (!error && Array.isArray(data)) {
        questionBank.questions.length = 0;
        questionBank.questions.push(...data); // 行字段与 data-model 同名（knowledge_category 等）
        loadEnumsFromFiles();
        sortQuestionsById();
        console.log(`[bank] 题库从 Supabase questions 表加载：${data.length} 题（按题号排序）`);
        return questionBank;
      }
      console.warn(`[bank] Supabase 题库加载失败（${error && error.message}），回退数据文件`);
    } catch (e) {
      console.warn(`[bank] Supabase 题库加载异常（${e.message}），回退数据文件`);
    }
  }
  loadEnumsFromFiles();
  loadQuestionsFromFiles();
  sortQuestionsById();
  return questionBank;
}

/** 加载模拟卷：Supabase exams 表优先，失败回退 exams.json（t12） */
export async function initExams() {
  exams.length = 0;
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase.from('exams').select('*');
      if (!error && Array.isArray(data)) {
        for (const e of data) {
          // DB 行用 rules jsonb 存规则；回填 unanswered_as_wrong 供路由复用
          exams.push({ ...e, unanswered_as_wrong: (e.rules && e.rules.unansweredAsWrong) !== false });
        }
        console.log(`[bank] 模拟卷从 Supabase exams 表加载：${exams.length} 套`);
        return exams;
      }
      console.warn(`[bank] Supabase 模拟卷加载失败（${error && error.message}），回退数据文件`);
    } catch (e) {
      console.warn(`[bank] Supabase 模拟卷加载异常（${e.message}），回退数据文件`);
    }
  }
  const p = path.join(DATA_DIR, 'exams.json');
  if (fs.existsSync(p)) {
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const e of doc.exams || []) {
      const validIds = (e.question_ids || []).filter((id) => findQuestion(id));
      if (validIds.length !== (e.question_ids || []).length) {
        console.warn(`[exams] ${e.id} 存在题库中不存在的题目 id，已过滤`);
      }
      exams.push({ ...e, question_ids: validIds });
    }
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
