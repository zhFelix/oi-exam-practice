-- ============================================================
-- 信息学竞赛笔试刷题平台 —— Supabase 表结构
-- 与现有 data/*.json 集合字段对齐（docs/data-model.md）
-- 注意：id 使用 text 主键，与现有文本 id（q001 / u_xxx / exam-001）一致
-- ============================================================

-- 用户（对齐 data/users.json）
create table if not exists public.users (
  id            text primary key,            -- u_xxx
  username      text not null unique,        -- 唯一用户名
  password_hash text not null,               -- bcrypt 哈希，绝不明文
  created_at    timestamptz not null default now()
);

-- 题目（对齐 data/questions.json + questions-extra.json，60 题）
create table if not exists public.questions (
  id                 text primary key,       -- q001 / q040 / q101 ...
  type               text not null,          -- single | multiple | judge | reading
  stem               text not null,          -- 题干（支持 Markdown/代码块）
  options            jsonb,                  -- [{key,text}, ...]（judge 题为 null）
  answer             jsonb not null,         -- 按题型：single "B" / multiple ["A","C"] / judge true / reading [子题答案]
  analysis           text not null,          -- 解析
  knowledge_category text not null,          -- 7 类知识点 id
  knowledge_points   jsonb not null default '[]',  -- 知识点标签数组
  competition_types  jsonb not null default '[]',  -- 竞赛类型枚举 id 数组（csp-j/noip/lanqiao/...）
  difficulty         text not null default 'beginner', -- beginner | intermediate | advanced
  source             text not null default '',        -- 来源
  year               integer,                         -- 年份（可空）
  code               text,                            -- reading 题程序代码
  sub_questions      jsonb,                           -- reading 子题数组 [{id,type,stem,options,answer,analysis}, ...]
  score              numeric not null default 0,      -- 单题分值（reading = 子题分值之和）
  created_at         timestamptz not null default now()
);

-- 模拟卷（对齐 data/exams.json，5 套）
create table if not exists public.exams (
  id                 text primary key,       -- exam-001
  title              text not null,
  competition_type   text not null,          -- csp-j | csp-s | noip | lanqiao | ...
  duration_minutes   numeric not null,       -- 时长（分钟，可为小数便于测试卷）
  question_count     integer not null,       -- 题数
  total_score        numeric not null,       -- 总分（由题目分值汇总）
  rules              jsonb not null default '{"unansweredAsWrong": true}',  -- 卷面规则
  question_ids       jsonb not null,         -- [q001, q002, ...]
  is_auto_generated  boolean not null default false,
  created_at         timestamptz not null default now()
);

-- 答题记录（对齐 data/answers.json）
create table if not exists public.answers (
  id              text primary key,          -- a_xxx
  user_id         text not null references public.users(id),
  question_id     text not null references public.questions(id),
  user_answer     jsonb not null,            -- 用户作答（形态与题目 answer 一致）
  is_correct      boolean not null,
  score           numeric not null,
  source          text not null,             -- practice | exam | wrong-review
  exam_id         text references public.exams(id),  -- source=exam 时关联
  elapsed_seconds integer,                   -- 用时（秒，可空）
  submitted_at    timestamptz not null default now()
);

-- 错题本（对齐 data/wrong-book.json，唯一键 user_id+question_id）
create table if not exists public.wrong_book (
  id                    text primary key,   -- w_xxx
  user_id               text not null references public.users(id),
  question_id           text not null references public.questions(id),
  wrong_count           integer not null default 1,
  review_correct_streak integer not null default 0,  -- 重练连对次数
  status                text not null default 'active',  -- active | removed
  last_wrong_answer     jsonb,               -- 最近一次错选答案
  last_wrong_at         timestamptz not null default now(),
  added_at              timestamptz not null default now(),
  unique (user_id, question_id)
);

-- 考试会话（对齐 data/exam-sessions.json）
create table if not exists public.exam_sessions (
  id           text primary key,             -- s_xxx
  user_id      text not null references public.users(id),
  exam_id      text not null references public.exams(id),
  answers      jsonb not null default '{}',  -- {question_id: answer, ...}
  started_at   timestamptz not null default now(),
  status       text not null default 'ongoing',  -- ongoing | submitted
  submitted_at timestamptz
);

-- 考试成绩（对齐 data/exam-results.json）
create table if not exists public.exam_results (
  id               text primary key,         -- r_xxx
  user_id          text not null references public.users(id),
  exam_id          text not null references public.exams(id),
  exam_title       text not null,
  competition_type text not null,
  score            numeric not null,
  total            numeric not null,
  rate             numeric not null,         -- 得分率 0~1
  elapsed_seconds  integer not null,
  auto             boolean not null default false,  -- 是否超时自动交卷
  answers          jsonb not null default '{}',     -- 作答快照
  detail           jsonb not null default '{}',     -- {byCategory, byType, perQuestion}
  submitted_at     timestamptz not null default now()
);

-- ---- 索引（常用查询路径） ----
create index if not exists idx_answers_user    on public.answers(user_id, submitted_at desc);
create index if not exists idx_answers_question on public.answers(question_id);
create index if not exists idx_wrong_book_user  on public.wrong_book(user_id, status);
create index if not exists idx_exam_results_user on public.exam_results(user_id, submitted_at desc);
create index if not exists idx_exam_sessions_user on public.exam_sessions(user_id, exam_id);