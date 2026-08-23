# Supabase 集成设计（阶段 1：框架与迁移脚本）

| 项 | 内容 |
| --- | --- |
| 文档版本 | v1.2 |
| 编写人 | backend-dev（后端/数据工程师）；v1.2 验收与修订：reviewer（评审/测试/文档，t13） |
| 分支 | `feature/supabase` |
| 目标 | 将存储层从 JSON 文件（`data/*.json`）迁移到 Supabase（PostgreSQL + PostgREST），本阶段只做**框架与迁移脚本**，不改业务路由（阶段 2 再替换 `server/store/*` 存储实现） |
| 状态 | ✅ 阶段 1~3 全部完成：真实凭据已配置（项目根 `.env`，已被 .gitignore 排除），**7 张表已建、种子数据已迁移**（60 题 + 5 卷，2025-01 实测）；阶段 2 存储实现替换 + 阶段 3 验收（t13）通过，见 §6 |

---

## 1. 配置

环境变量（`server/config.js` 读取；**项目根 `.env` 会被自动加载**（`server/utils/load-env.js`，不覆盖已有环境变量），未配置时使用占位值并打警告日志）：

| 变量 | 说明 | 占位默认 |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase 项目 URL（`https://<project>.supabase.co`） | `https://placeholder.supabase.co` |
| `SUPABASE_KEY` / `SUPABASE_SERVICE_KEY` | key（**后端使用 service_role key**，绕过 RLS，仅限服务端，绝不能暴露给前端；二者任一即可，优先 SUPABASE_KEY） | `placeholder-anon-key` |

```bash
# 项目根 .env（已被 .gitignore 排除，不会进 Git）：
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_KEY=eyJ...   # service_role key，严禁提交/输出
```

客户端单例：`server/store/supabase.js`（`createClient` + `auth.persistSession=false`；导出 `supabase` 与 `isSupabaseConfigured` 标志）。

---

## 2. 建表 SQL

> 规范文件：**`scripts/supabase-schema.sql`**（与本文档 §2 同步维护）。全部语句幂等（`if not exists`），可在 Supabase Dashboard → SQL Editor 粘贴执行。
> 当前项目：7 张表**已建好**且列结构与本文档一致（2025-01 通过 PostgREST OpenAPI 核对），无需重复执行；如新建项目则先执行本脚本再跑迁移。

```sql
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
```

### RLS 说明

- 阶段 1 迁移脚本使用 **service_role** key 写入，默认绕过 RLS；
- 阶段 2 接入业务路由时建议：对 `users/answers/wrong_book/exam_sessions/exam_results` 启用 RLS，policy 按 `auth.uid() = user_id` 隔离（`questions/exams` 为公开读）；
- 若用 anon key 写数据，需先为各表创建 INSERT/SELECT policy，否则 upsert 会 403。

---

## 3. 迁移脚本（scripts/migrate-to-supabase.mjs）

```bash
# 配置在项目根 .env（自动加载），直接执行（幂等，可重复执行）
npm run migrate:supabase
# 等价：node scripts/migrate-to-supabase.mjs
```

行为：

1. 合并读取 `data/questions.json`（26 题）+ `data/questions-extra.json`（34 题）= 60 题，以及 `data/exams.json`（5 套卷）；
2. 题目映射：`options/answer/knowledge_points/competition_types/sub_questions` 写入 `jsonb`；`score` 由 `questionTotalScore()` 实时计算（避免与数据文件中的冗余字段失同步）；
3. 试卷映射：`question_count` 与 `total_score` 由 `question_ids` 实时计算；`rules` 组装为 `{unansweredAsWrong}`；
4. `supabase.from(t).upsert(rows, { onConflict: 'id' })` 批量写入（每批 100 条），按 id upsert **幂等**；
5. 未配置真实凭据（占位配置）时直接退出并给出指引，不发起请求；
6. 每张表打印写入条数与耗时；任一步失败非零退出。

### 实测记录（2025-01，真实凭据）

- 项目 7 张表已存在且列结构与本文档 schema 一致（PostgREST OpenAPI 核对）；
- `npm run migrate:supabase`：`questions upsert 60 行`、`exams upsert 5 行`，全部成功；
- 落库校验：60 题按 7 类知识点分布 10/10/10/10/10/5/5；多选 `q020` answer 为 `["A","C"]`、score=2；阅读 `q021` sub_questions 含 2 道子题、score=2；`exam-001` question_count=12、total_score=14、rules 正确；
- 幂等：重复执行 upsert 60+5，计数不增；
- 运行期表 CRUD 实测（users）：INSERT 201 / SELECT / PATCH 204 / DELETE 204，无残留（service_role 可写，阶段 2 存储替换的基础已验证）。

> 运行期表（users / answers / wrong_book / exam_sessions / exam_results）由业务接口写入，不属于种子迁移范围（阶段 2 实现）。

---

## 4. 与现有存储的对应关系

| JSON 文件 | Supabase 表 | 主键 |
| --- | --- | --- |
| data/questions.json + questions-extra.json | `questions` | id（q001...） |
| data/exams.json | `exams` | id（exam-001...） |
| data/users.json | `users` | id（u_xxx） |
| data/answers.json | `answers` | id（a_xxx） |
| data/wrong-book.json | `wrong_book` | id（w_xxx）+ unique(user_id, question_id) |
| data/exam-sessions.json | `exam_sessions` | id（s_xxx） |
| data/exam-results.json | `exam_results` | id（r_xxx） |

---

## 5. 阶段 2：存储实现替换（t12，已完成）

### 5.1 架构

```
业务路由 / 服务（判分/错题状态机/考试）  ← 接口不变：find/findById/insert/update/remove/count（同步）
                    │
   server/store/collections.js（启动时选择存储后端）
     ├─ SupabaseStore（server/store/supabase-store.js）—— Supabase 可用时
     │    内存缓存（启动整表 load()）+ 同步读 + 串行异步持久化（_queue + 优雅退出 flush）
     └─ DataStore（server/store/datastore.js）—— JSON 文件降级
```

- **题库/试卷**：`initQuestionBank()` / `initExams()` 启动时优先从 Supabase `questions` / `exams` 表读取；失败或未配置时回退数据文件。**枚举定义（竞赛类型/知识点/题型/难度）始终来自数据文件**（数据库无枚举表，保持 /api/meta 可用）。
- **运行期集合**：`initStores()` 按 `isSupabaseConfigured` + 启动整表载入是否成功决定 `SupabaseStore` 或 `DataStore`；store 实例为 ESM live binding，业务路由零改动。
- **SupabaseStore 持久化语义（t13 修订）**：写操作先更新内存缓存（读立即可见），再按调用顺序**串行**写入 Supabase（`_queue` 链式队列）——保证 insert→update 同键操作不乱序（修复了"update 先于 insert 落库导致行静默丢失"的竞态）；**优雅退出（SIGINT/SIGTERM）通过 `flushStores()` 排空写队列后再退出**（`server/index.js`），正常部署（pm2/systemd/docker stop、开发 Ctrl+C）不丢数据；进程被强杀（kill -9 / 断电）时未落库的写会丢失，属"内存缓存 + 异步落库"固有限制。

### 5.2 验证记录（t12，真实凭据）

- Supabase 模式：启动日志确认「题库 60 题 / 模拟卷 5 套 / Supabase 存储模式」；`npm run smoke` **61/61 通过**；落库核实 users/answers/wrong_book/exam_sessions/exam_results 均有 smoke 写入数据（验证后已清理）。
- JSON 降级模式：占位配置启动（无 Supabase 日志），`npm run smoke` **61/61 通过**，运行期 JSON 文件正常生成（验证后已清理）。
- `npm test` 判分 9 用例全过（与存储无关）。
- 建议阶段 2 后启用 RLS：users/answers/wrong_book/exam_sessions/exam_results 按 `auth.uid()` 隔离（业务仍走 service_role，RLS 作为纵深防御）。

阶段 2 计划：将 `server/store/datastore.js` 的读写替换为 supabase 查询（保留现有 API 契约），数据访问层接口签名不变，业务路由零改动或最小改动。

---

## 6. 阶段 3：验收与文档（t13，已完成）

### 6.1 验收结论

**通过（有条件）**。Supabase 模式与 JSON 降级模式全流程可用，接口契约与 DataStore 一致（业务路由零改动）；验收发现并修复 **1 个 P0 数据一致性缺陷**（见 §6.2）。完整测试记录见 `docs/supabase-test-report.md`。

### 6.2 发现并修复的缺陷（t13）

| # | 级别 | 问题 | 修复 |
| --- | --- | --- | --- |
| 1 | **P0** | **写持久化竞态与丢失**：原 `SupabaseStore._persist` 为 fire-and-forget 并发写——(a) 同键 insert→update 可乱序，update 先于 insert 落库时按 id 更新不到行 → 错题本条目等**静默丢失**（实测重启后错题本整条消失）；(b) 进程被重启/杀掉时未完成的上行请求被中止 → 内存与 DB 分叉，且注释声称"下次启动 load 会恢复一致"并不成立（load 读的是已丢失的 DB） | 改为**串行写队列**（`_queue` 链式，保证落库顺序与内存操作一致）+ `flush()`；`server/index.js` 增加 **SIGINT/SIGTERM 优雅退出**（`flushStores()` 排空队列后再退出）；多行 update/remove 单行失败容错续行；修正误导性注释 |
| 2 | P2 | `.env` 虽已被 .gitignore 排除，但缺少示例文件 | 新增 `.env.example`（含 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` 占位与安全提示，不含真实密钥） |
| 3 | P2 | 登录限流（默认 20 次/10 分钟/IP）会阻断自动化测试的连续注册 | 测试/CI 通过 `AUTH_RATE_LIMIT_MAX` 调大或改造限流豁免 localhost（见 `docs/supabase-test-report.md` §遗留） |

### 6.3 验收实测（真实凭据，2025-01）

- `npm run migrate:supabase`：questions 60 行 + exams 5 行 upsert，**幂等可重复执行**（重复执行计数不增）。
- Supabase 模式启动日志：「题库 60 题 / 模拟卷 5 套 / Supabase 存储模式」；`npm run smoke` **61/61 通过**（含登录限流 429）。
- 全流程 HTTP 联调（注册→答题→错题→重练→模拟考交卷→成绩报告→统计）在 Supabase 模式通过。
- **重启持久化**：写全流程 → 优雅退出（`flushStores()`）→ 重启 → 6 条答题记录 / 错题本（wrong_count=2）/ 考试会话 / 成绩报告 **全部完整**（修复后）。
- **JSON 降级**：占位配置启动 → 题库 60 题（数据文件）→ `npm run smoke` 61/61。
- 测试数据已清理；`npm test` 判分 9 用例全过。

### 6.4 已知限制（Supabase 模式）

1. **强杀丢数据**：进程被 `kill -9` / 断电强杀时，写队列中尚未落库的变更会丢失（优雅退出无此问题）；单机 MVP 可接受，如需要更强一致性可改为同步等待落库（牺牲写延迟）或引入本地 WAL。
2. **RLS 未启用**：当前用 service_role key 直连（绕过 RLS）。上线多用户前建议启用 RLS 做纵深防御（users/answers/wrong_book/exam_sessions/exam_results 按 `auth.uid()` 隔离，questions/exams 公开读），或改走 Supabase Auth + anon key（需为各表补 policy，见 §2 RLS 说明）。
3. **`numeric` 列类型**：`score/total_score` 等为 `numeric`，PostgREST 对大数值可能返回字符串；当前分值范围（≤2）实测为数字，若未来分值增大需在读取端做 Number() 归一。
4. **考试会话恢复**：仍为前端 localStorage 方案（服务端会话仅记开始时间与状态），多端/清缓存丢进度（v1.1 项，与 JSON 模式一致）。
5. **凭据管理**：`SUPABASE_SERVICE_KEY` 仅限后端；前端静态资源不接触任何 key（已核对 `/api` 无泄露端点）。
