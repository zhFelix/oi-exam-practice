# 后端服务实现说明（server/）

信息学竞赛笔试刷题平台后端：**Node.js + Express + JSON 文件存储**，实现 PRD P0 中的题库浏览、练习判分、模拟考试（整卷限时）、错题本、学习统计与用户系统（依据 `docs/architecture.md` §5~§7 与 `docs/data-model.md`）。

## 快速开始

```bash
cd D:\Felix\project\oi-exam-practice
npm install          # 安装依赖（express / jsonwebtoken / bcryptjs / @supabase/supabase-js）
npm start            # 启动（默认端口 3000，环境变量 PORT 可覆盖）
npm run dev          # 开发模式（Node --watch 热重启）
npm test             # 判分核心单元测试
npm run smoke        # 接口冒烟测试（需先启动服务；BASE_URL 可覆盖）
npm run migrate:supabase  # Supabase 种子数据迁移（需先配置 SUPABASE_URL/SUPABASE_KEY）
```

- 题库数据：启动时自动合并加载 `data/questions.json`（26 题）+ `data/questions-extra.json`（34 题，含 q040~q060 第二批扩充题），按 `id` 去重，共 **60 题**；模拟卷加载 `data/exams.json`（5 套卷）。
- 运行期数据：`data/users.json` / `data/answers.json` / `data/wrong-book.json` / `data/exam-sessions.json` / `data/exam-results.json` 由服务自动创建（内存缓存 + 同步落盘，临时文件 + rename 原子替换）。
- 前端静态托管：存在 `public/` 时托管 `public/`（回退 `web/`），`GET /` 返回 SPA 入口。
- 环境变量：`PORT`（默认 3000）、`JWT_SECRET`（**生产必须设置**；未设置时用开发默认值并打警告日志）、`AUTH_RATE_LIMIT_MAX`（登录/注册限流次数，默认 20）、`SUPABASE_URL` / `SUPABASE_SERVICE_KEY`（Supabase 配置，详见 `docs/supabase.md`）。**项目根 `.env` 会被自动加载**（`server/utils/load-env.js`，不覆盖已有环境变量；`.env` 已被 .gitignore 排除）。

## Supabase 集成（t11 框架 + t12 存储替换 + t17 Auth 迁移）

- **存储层已替换**（t12）：`server/store/collections.js` 启动时选择存储后端——Supabase 可用则 `SupabaseStore`（`server/store/supabase-store.js`，内存缓存 + 串行异步持久化 + 优雅退出 flush，接口与 DataStore 一致），否则回退 JSON `DataStore`；题库/试卷启动时优先从 Supabase `questions`/`exams` 表读取，失败回退数据文件（枚举定义始终来自数据文件）。业务路由零改动。
- **认证已迁移**（t17，后端代理模式）：Supabase Auth 模式下注册用 `supabase.auth.admin.createUser`（email_confirm 免确认）并写入自建 `public.users`（id = auth uid）；登录用 `signInWithPassword`（**登录标识为 email**）；鉴权中间件用 `supabase.auth.getUser(token)` 验证；未配置 Supabase 时回退自建 bcrypt+JWT（登录兼容 username 或 email）。users 表迁移 SQL：`scripts/supabase-auth-migration.sql`（新增 email/auth_uid 列、username 取消唯一、password_hash 可空）。
- `server/store/supabase.js`：`createClient` 单例（导出 `supabase` 与 `isSupabaseConfigured` 标志；`auth.persistSession=false`；后端用 service_role key，**严禁暴露给前端**）。
- `docs/supabase.md`：建表 SQL + 配置/迁移/阶段 2 存储/阶段 3 Auth 说明。
- `scripts/migrate-to-supabase.mjs`（`npm run migrate:supabase`）：合并读取 65 题 + 5 套卷，按 id upsert 到 `questions` / `exams`（幂等可重复执行；未配置真实凭据时直接退出并提示）。
- 验证：Supabase 模式与 JSON 降级模式 `npm run smoke` 均全部通过（t17 起注册/登录用 email；真实凭据实测 Supabase Auth 注册/登录/鉴权全流程）。

## 目录结构

```
server/
├── index.js              # 入口：启动 HTTP 服务
├── app.js                # 组装 Express：静态资源 + 中间件 + 路由
├── config.js             # 端口/JWT/路径/枚举常量（含环境变量覆盖）
├── middleware/
│   ├── auth.js           # requireAuth（必须登录）/ optionalAuth（可选登录）
│   ├── rate-limit.js     # 内存限流中间件（按 IP 滑动窗口，429 + Retry-After）
│   └── error.js          # ApiError + 统一错误响应 + 404
├── routes/
│   ├── auth.js           # /api/auth/*   注册/登录/当前用户
│   ├── meta.js           # /api/meta/*   竞赛类型/分类/题型/难度枚举
│   ├── questions.js      # /api/questions 题库列表（筛选+分页）/详情
│   ├── practice.js       # /api/practice/submit 判分提交（+ /api/submit 别名）
│   ├── wrong-book.js     # /api/wrong-book/* 错题本列表/重练/移除/排行
│   ├── exams.js          # /api/exams/*   模拟卷列表/详情/开始/交卷/历史/报告
│   ├── stats.js          # /api/stats/*  总体概览/分类/题型正确率
│   └── helpers.js        # 题目 API 形态转换（snake_case→camelCase）/分页
├── services/
│   ├── grader.js         # 判分核心（4 题型统一规则）
│   └── wrong-book-service.js # 错题本状态机（入本/连对/自动移出）
├── store/
│   ├── datastore.js      # 通用 JSON 文件集合（内存 + 同步落盘，降级后端）
│   ├── supabase-store.js # Supabase 存储实现（内存缓存 + 异步持久化，接口与 DataStore 一致）
│   ├── supabase.js       # Supabase 客户端单例（service_role）
│   └── collections.js    # 存储后端选择（Supabase 优先/JSON 降级）+ 题库/模拟卷加载
├── utils/                # id 生成 / JWT / bcrypt / .env 加载
└── __tests__/
    └── grader.test.js    # 判分单元测试（node:test，9 用例）
```

## API 一览（契约与架构文档 §6 一致）

统一约定：Base URL `/api`；JSON；错误格式 `{ "error": { "code", "message" } }`；列表 `{ items, total, page, pageSize }`（pageSize ≤ 50）；需登录接口带 `Authorization: Bearer <JWT>`。

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | 注册（注册即登录；`{email, username, password, confirmPassword}`） | 匿名 |
| POST | `/api/auth/login` | 登录（`{email, password}`；Legacy 模式兼容 username） | 匿名 |
| GET | `/api/auth/me` | 当前用户（`{id, username, email}`） | 登录 |
| GET | `/api/meta/competition-types` | 竞赛类型枚举 `[{code,label}]`（8 项，前端动态渲染筛选） | 匿名 |
| GET | `/api/meta/categories` / `/types` / `/difficulty-levels` | 分类/题型/难度枚举 | 匿名 |
| GET | `/api/questions` | 列表+筛选+分页 | 匿名（不含答案） |
| GET | `/api/questions/:id` | 详情（`?withAnswer=1` 且登录才含答案） | 匿名（不含答案） |
| POST | `/api/practice/submit` | 判分 + 答题记录 + 错题自动入本 | 登录 |
| POST | `/api/submit` | 与上等价（任务要求的别名路径） | 登录 |
| GET | `/api/wrong-book` | 错题列表（active，时间倒序，可筛选/分页） | 登录 |
| POST | `/api/wrong-book/review` | 错题重练（判分 + 连对/自动移出状态机） | 登录 |
| DELETE | `/api/wrong-book/:questionId` | 手动移除 | 登录 |
| GET | `/api/wrong-book/stats` | 错题分类排行 | 登录 |
| GET | `/api/stats/overview` | 总体概览（含 examCount 模拟考次数） | 登录 |
| GET | `/api/stats/categories` | 7 类知识点正确率 | 登录 |
| GET | `/api/stats/types` | 4 种题型正确率 | 登录 |
| GET | `/api/exams` | 模拟卷列表（可选 `competition` 筛选） | 匿名 |
| GET | `/api/exams/:id` | 试卷详情（**仅卷元信息 + 规则**；题目由 start 下发，防整卷预先导出） | 匿名 |
| POST | `/api/exams/:id/start` | 开始考试（服务端记时，创建/恢复会话，返回脱敏题目） | 登录 |
| POST | `/api/exams/:id/submit` | 交卷（限时校验，超时自动交卷，生成成绩报告） | 登录 |
| POST | `/api/exams/session/:sessionId/submit` | 交卷（架构文档路径别名） | 登录 |
| GET | `/api/exams/history` | 历史成绩（倒序分页） | 登录 |
| GET | `/api/exams/results` | 历史成绩（架构文档路径别名） | 登录 |
| GET | `/api/exams/results/:resultId` | 单次成绩报告（考后逐题对错+解析） | 登录 |

**筛选参数**（GET /api/questions，可组合）：`competition`（枚举码，白名单校验）、`category`（7 类知识点 id）、`type`（single/multiple/judge/reading）、`difficulty`（兼容 `1|2|3` 与 `beginner/intermediate/advanced`）、`keyword`（题干模糊）、`page`/`pageSize`。

## 判分规则（services/grader.js）

数据中 answer 形态（`docs/data-model.md` §3.3）：

| 题型 | 用户提交 answer | 得分条件 | 默认分值 |
| --- | --- | --- | --- |
| single 单选 | `"B"`（兼容 `["B"]`） | 与标准答案一致 | 1 |
| multiple 多选 | `["A","C"]` | 集合完全相同（全对，顺序无关） | 2 |
| judge 判断 | `true`/`false`（兼容 `"T"`/`"F"`/`"正确"`/`"错误"`） | 与标准答案一致 | 1 |
| reading 阅读程序 | `["B", true]`（子题答案数组） | 各子题独立判分，得分=Σ子题得分；`isCorrect`=全部正确 | Σ子题 |

- 判分前校验答案形态，不合法返回 `400 INVALID_ANSWER`。
- 练习、错题重练共用同一 grader，保证规则一致（架构文档 §7.2）。
- 提交响应包含：`isCorrect / score / totalScore / correctAnswer / analysis / knowledgeCategory / perSub`（reading 时含逐子题对错与解析）。

## 错题本状态机（services/wrong-book-service.js）

```
答错(练习) ──► 入本 active（wrong_count=1, streak=0）
再次答错 ──► wrong_count+1, streak 清零
重练答对 ──► streak+1；streak ≥ 2 自动移出（status=removed）
重练答错 ──► 重新入本（wrong_count+1, streak=0）
手动移除 ──► status=removed（记录保留用于统计，列表只展示 active）
```

## 模拟考试（routes/exams.js）

- **卷数据**：`data/exams.json`（5 套固定卷：CSP-J/CSP-S/NOIP/蓝桥杯 + 1 套 6 秒自动交卷测试卷），字段 `id/title/competition_type/duration_minutes/question_ids/is_auto_generated/unanswered_as_wrong`（架构文档 §5.5）。
- **服务端记时**：`start` 记录 `started_at` 创建会话（`data/exam-sessions.json`）；重复 start 恢复进行中会话（幂等，返回 `remainingSeconds`）。
- **限时与自动交卷**：`submit` 时服务端计算用时，`elapsed ≥ duration` 判定为超时自动交卷（`auto=true`），**按剩余已答题目计分**（未答题 0 分）。
- **判分复用**：逐题调用 t4 的 `grader.gradeQuestion`（4 题型统一规则）；答错写答题记录（source=exam，统计自动计入）并自动入错题本（F3.6；未答题不入错题本）。
- **成绩报告**：`data/exam-results.json` 存成绩单（总分/得分/得分率/用时/是否自动/分类与题型汇总/逐题对错含解析），交卷响应一次返回；考后可经 `GET /api/exams/results/:resultId` 回看。
- 交卷响应：`{ resultId, examId, examTitle, competitionType, score, total, rate, elapsedSeconds, auto, detail: { byCategory, byType }, perQuestion: [...] }`。
- 未开始即交卷 → `400 EXAM_NOT_STARTED`；重复交卷 → `409 ALREADY_SUBMITTED`；非本人成绩 → `403 FORBIDDEN`。

## 安全加固（评审建议，t10）

- **JWT 密钥**：`JWT_SECRET` 从环境变量读取；未设置时使用开发默认值 `oi-exam-practice-dev-secret` 并在启动时输出警告日志（仅限本地开发，生产必须设置）。
- **登录/注册限流**：`middleware/rate-limit.js` 内存滑动窗口限流，默认**每 IP 每 10 分钟 20 次**（`server/config.js` 的 `AUTH_RATE_LIMIT`，可用环境变量 `AUTH_RATE_LIMIT_MAX` 覆盖），超出返回 `429 { error: { code: "RATE_LIMITED" } }` 并附 `Retry-After` 头；重启服务即重置计数。

## 与架构文档的差异说明（实现取舍）

1. **模拟考接口**：t9 已实现（上节），会话/交卷/成绩单齐全。
2. **难度字段**：数据存储为 `beginner/intermediate/advanced`（data-model.md），接口筛选兼容架构文档的 `1|2|3` 两种写法。
3. **题库加载**：架构文档设计 seed 脚本生成 `questions.json`；实际直接加载 `data/questions.json` + `data/questions-extra.json` 合并（两文件即种子数据，启动时按 id 去重）；模拟卷同样直接加载 `data/exams.json`。
4. **前端目录**：架构文档建议 `web/`，前端实际使用 `public/`，托管逻辑两个目录都支持（public 优先）。
5. **judge 答案**：数据为布尔值（data-model.md §3.3），接口按布尔接收，同时兼容 `"T"/"F"/"正确"/"错误"` 文本。
6. **交卷路径**：任务要求 `POST /api/exams/:id/submit`，架构文档为 `/session/:sessionId/submit`，两个路径均已实现。
7. **试卷详情**：评审建议（test-report §5-2）已落实——`GET /api/exams/:id` 只返回卷元信息 + 规则，题目内容仅在登录并 `start` 后下发；前端考试页原本就只消费元信息，无需改动。
8. **未答题处理**：未答题统一 0 分（`answered=false`）；不入错题本（只有实际答错才入本）。
9. **题库规模**：评审建议（test-report §5-1）已落实——合并题库扩充至 60 题（扩展题库追加 q040~q060 共 21 题，覆盖全部 7 类知识点，以蓝桥杯/省市校级/其他赛事为主）。
10. **测试运行方式**：`npm test` 直接执行测试文件（`node:test` 在部分受限环境（沙箱）下 `--test` 的进程 spawn 会被拦截，直接执行文件不受影响；两种方式断言一致）。

## 验证记录（已通过）

- `npm test`：判分核心 9 个用例全部通过（单选/多选/判断/阅读程序、形态校验、总分计算）。
- `npm run smoke`：62 项接口冒烟检查全部通过（元数据、题库列表筛选分页（60 题）、详情脱敏、注册/登录/鉴权、4 题型判分、错题入本-重练-自动移出、手动移除、统计；模拟考试：列表/详情仅元信息/开始考试/恢复会话/交卷成绩报告/重复交卷 409/未开始 400/历史成绩/成绩回看/会话路径别名/超时自动交卷/统计计入模拟考次数；登录限流 429）。
- 数据完整性：60 题 × 字段/枚举/答案格式/子题/试卷引用交叉校验无错误（id 分区：q001~q026、q040~q060、q101~q113 互不重叠）。
- 静态托管：`GET /` 返回前端 index.html（200）。
