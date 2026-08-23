// ============================================================
// migrate-to-supabase.mjs —— 种子数据迁移脚本（t11 阶段1）
// 把 data/questions.json + data/questions-extra.json（60 题）与
// data/exams.json（5 套卷）批量 upsert 到 Supabase 对应表。
// - 幂等：按 id upsert（onConflict: 'id'），可重复执行
// - 未配置真实凭据时直接退出并给出指引（不发起请求）
// - 运行期表（users/answers/wrong_book/exam_sessions/exam_results）
//   由业务接口写入，不属于种子迁移范围
// 用法：
//   set SUPABASE_URL=... ; set SUPABASE_KEY=...
//   node scripts/migrate-to-supabase.mjs
//   （或 npm run migrate:supabase）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabase, isSupabaseConfigured } from '../server/store/supabase.js';
import { questionTotalScore } from '../server/services/grader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const BATCH_SIZE = 100;

// ---------- 读取并合并题库 ----------

function readJson(file) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** 合并多个题库文件并按 id 去重（先出现者优先） */
function loadQuestions() {
  const seen = new Set();
  const questions = [];
  for (const file of ['questions.json', 'questions-extra.json']) {
    const doc = readJson(file);
    if (!doc) continue;
    for (const q of doc.questions || []) {
      if (!seen.has(q.id)) {
        seen.add(q.id);
        questions.push(q);
      }
    }
  }
  return questions;
}

function loadExams() {
  const doc = readJson('exams.json');
  return doc ? doc.exams || [] : [];
}

// ---------- 行映射（数据字段 → 表字段） ----------

/** 题目 → questions 表行（score 实时计算，避免冗余字段失同步） */
function toQuestionRow(q) {
  return {
    id: q.id,
    type: q.type,
    stem: q.stem,
    options: q.options ?? null,
    answer: q.answer,
    analysis: q.analysis || '',
    knowledge_category: q.knowledge_category,
    knowledge_points: q.knowledge_points || [],
    competition_types: q.competition_types || [],
    difficulty: q.difficulty || 'beginner',
    source: q.source || '',
    year: q.year ?? null,
    code: q.code ?? null,
    sub_questions: q.sub_questions ?? null,
    score: questionTotalScore(q),
  };
}

/** 试卷 → exams 表行（题数/总分由 question_ids 实时计算） */
function toExamRow(e, questionsById) {
  const ids = (e.question_ids || []).filter((id) => questionsById.has(id));
  const totalScore = ids.reduce((s, id) => s + questionTotalScore(questionsById.get(id)), 0);
  return {
    id: e.id,
    title: e.title,
    competition_type: e.competition_type,
    duration_minutes: e.duration_minutes,
    question_count: ids.length,
    total_score: totalScore,
    rules: { unansweredAsWrong: e.unanswered_as_wrong !== false },
    question_ids: ids,
    is_auto_generated: e.is_auto_generated === true,
    created_at: e.created_at || new Date().toISOString(),
  };
}

// ---------- 批量 upsert ----------

async function upsertBatch(table, rows) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: 'id' });
    if (error) {
      throw new Error(`upsert ${table} 失败（第 ${i / BATCH_SIZE + 1} 批）: ${error.message} (${error.code})`);
    }
    inserted += chunk.length;
  }
  return inserted;
}

// ---------- 主流程 ----------

async function main() {
  console.log('[migrate] Supabase 种子数据迁移开始');

  if (!isSupabaseConfigured) {
    console.error(
      '[migrate] ✘ 未配置真实 Supabase 凭据（占位配置）。\n' +
      '  请先设置环境变量后重试：\n' +
      '    PowerShell: set SUPABASE_URL=https://<project>.supabase.co ; set SUPABASE_KEY=<anon 或 service_role key>\n' +
      '    Linux:      export SUPABASE_URL=... ; export SUPABASE_KEY=...\n' +
      '  另请先在 Supabase SQL Editor 执行 docs/supabase.md 中的建表 SQL。'
    );
    process.exit(1);
  }

  const questions = loadQuestions();
  const exams = loadExams();
  console.log(`[migrate] 读取题库 ${questions.length} 题、模拟卷 ${exams.length} 套`);

  // 1) questions 表
  const qRows = questions.map(toQuestionRow);
  const t0 = Date.now();
  const qCount = await upsertBatch('questions', qRows);
  console.log(`[migrate] ✔ questions upsert ${qCount} 行（${Date.now() - t0}ms）`);

  // 2) exams 表（先建题号索引，计算题数/总分）
  const questionsById = new Map(questions.map((q) => [q.id, q]));
  const eRows = exams.map((e) => toExamRow(e, questionsById));
  const t1 = Date.now();
  const eCount = await upsertBatch('exams', eRows);
  console.log(`[migrate] ✔ exams upsert ${eCount} 行（${Date.now() - t1}ms）`);

  console.log('[migrate] ✅ 迁移完成（幂等，可重复执行）');
}

main().catch((e) => {
  console.error('[migrate] ✘ 迁移失败:', e.message);
  process.exit(1);
});
