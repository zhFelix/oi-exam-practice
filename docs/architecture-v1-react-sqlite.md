# 信息学竞赛笔试题训练网站 — 系统架构设计与技术选型

> 版本：v1.0 ｜ 作者：架构师 ｜ 状态：已定稿，可直接开工
> 依据：团队目标 + t2 任务要求（产品需求文档 t1 完成后如有增补，本文档按需修订，修订以版本号递增）
> 阅读对象：后端工程师、前端工程师、UI 设计师、测试评审员

---

## 1. 技术栈选型

### 1.1 选型结论（总表）

| 层 | 技术 | 版本 | 理由 |
| --- | --- | --- | --- |
| 前端框架 | React 18 | ^18.3 | 组件模型适合题目卡片/答题交互；生态成熟；本机 npm 缓存已有 |
| 构建工具 | Vite 5 | ^5.4 | 秒级冷启动、HMR 快、产物轻，MVP 最省心 |
| 前端路由 | react-router-dom | ^6 | SPA 路由 + 守卫（登录拦截、管理员页拦截） |
| HTTP 客户端 | axios | ^1.7 | 拦截器统一注入 token、统一处理 401 |
| Markdown 渲染 | react-markdown + remark-gfm | ^10 | 题干/解析支持 Markdown；**过滤原始 HTML** 防 XSS |
| 后端框架 | Express 4 | ^4.21 | 轻量、中间件生态成熟、单进程易部署 |
| 数据库 | SQLite（Node 内置 `node:sqlite` / DatabaseSync） | Node ≥ 23.4（本机 v24.11 ✓） | **零安装、零原生依赖、单文件**；同步 API 开发简单；本沙箱已实测可行（better-sqlite3 原生模块无法安装，已排除） |
| 鉴权 | JWT（jsonwebtoken）+ bcryptjs | ^9 / ^3 | 无状态鉴权适配前后端分离；bcryptjs 纯 JS 无原生依赖 |
| 辅助 | cors、dotenv | — | 开发期跨域、配置管理 |

**运行环境要求**：Node.js ≥ 23.4（本机 v24.11.0 已满足）、npm ≥ 10。无其他外部依赖（不装数据库服务、不装 Redis、不装编译器）。

### 1.2 为什么不用（决策记录）

- **不用 MySQL/PostgreSQL**：需独立服务、安装配置成本高。MVP 规模（校内训练：数百用户、万级题量/答题记录）SQLite 完全够用；`node:sqlite` 内置免部署。DAO 层保持 SQL 集中，后续可平滑迁移。
- **不用 Next.js/Nuxt**：本项目是纯交互型 SPA（练习/考试需登录，无 SSR/SEO 需求），Vite + React 更简单直接。
- **不用 TypeScript**：MVP 阶段降低前后端上手成本与构建复杂度，统一用 JS；接口契约以本文档 §4 字段表为准。团队如需 TS 可后续迁移，不影响架构。
- **不用 Ant Design 等 UI 组件库**：UI 设计师会输出统一设计令牌（design tokens），自研轻量组件保证视觉一致、依赖最少；若工期告急可引入 antd 加速，但本期按自定义 CSS 方案。
- **不用 Redis/消息队列/定时任务**：考试计时用"惰性过期"策略（§5.2），无需任何中间件。

### 1.3 部署形态（MVP）

单机、单进程部署：Express 同时提供 API（/api）与生产环境静态资源（web/dist），`node src/index.js` 一条命令跑通。开发期前端用 Vite dev server（5173）代理 /api 到 3000。

---

## 2. 系统整体架构

```
┌───────────────────────────────────────────────────────────┐
│ 浏览器（React SPA，web/）                                   │
│  页面/路由/状态 → axios 客户端（token 拦截、401 处理）        │
└──────────────────────────┬────────────────────────────────┘
                           │ HTTP/JSON（REST，前缀 /api）
┌──────────────────────────▼────────────────────────────────┐
│ Express 服务（server/，端口 3000，可配）                    │
│  ├─ 中间件：auth（JWT）→ admin（角色）→ validate → routes    │
│  ├─ 路由组：auth/categories/questions/practice/exams/      │
│  │          examRecords/wrongQuestions/stats/admin         │
│  ├─ 服务层：scoring（判分唯一实现）、examService（开考/惰性   │
│  │          过期/自动交卷）、statsService（统计口径）、       │
│  │          wrongService（错题写入/解决）                   │
│  ├─ 静态托管：生产模式托管 web/dist（同源部署）              │
│  └─ 统一错误处理（{code,message,data} 契约）                │
└──────────────────────────┬────────────────────────────────┘
                           │ node:sqlite（DatabaseSync，同步）
┌──────────────────────────▼────────────────────────────────┐
│ SQLite 单文件：data/contest.db                             │
│ users / categories / questions / exams / exam_questions / │
│ exam_records / practice_records / wrong_questions         │
└───────────────────────────────────────────────────────────┘
```

### 2.1 分层与职责边界

| 层 | 职责 | 禁止 |
| --- | --- | --- |
| routes | 参数校验、调用 service、拼响应 | 写业务逻辑、直接拼 SQL 判分 |
| services | 判分、开考、统计等核心逻辑（**唯一实现点**） | 被 routes 外的模块绕过 |
| db | schema、连接、事务 helper、种子数据 | 业务规则 |
| web/src/api | 唯一 HTTP 出口（baseURL、拦截器） | 页面内裸 fetch |
| web/src/pages | 页面编排 | 直接拼 API 字段（契约走 api 层） |

### 2.2 配置（server/.env）

```
PORT=3000
JWT_SECRET=<必填，生产必改>
JWT_EXPIRES_IN=7d
DATA_DIR=./data
DEFAULT_EXAM_DURATION_MIN=60
PRACTICE_MAX_COUNT=50
```

---

## 3. 数据模型设计

约定：主键 `id INTEGER PRIMARY KEY AUTOINCREMENT`；时间统一 ISO8601 UTC 字符串；布尔 0/1；JSON 用 TEXT 存储。所有表含 `created_at`（exam_records 另有 `submitted_at`）。

### 3.1 users — 用户表
| 字段 | 类型 | 约束/说明 |
| --- | --- | --- |
| id | INTEGER | PK |
| username | TEXT | UNIQUE NOT NULL，`^[a-zA-Z0-9_]{3,32}$` |
| password_hash | TEXT | NOT NULL，bcrypt |
| nickname | TEXT | 默认 = username，≤ 32 字符 |
| role | TEXT | NOT NULL DEFAULT 'user'：`user` / `admin` |
| created_at | TEXT | NOT NULL |

### 3.2 categories — 分类表
| 字段 | 类型 | 约束/说明 |
| --- | --- | --- |
| id | INTEGER | PK |
| name | TEXT | UNIQUE NOT NULL（C++语言 / 数据结构 / 算法 / 数学 / 计算机基础 …） |
| sort_order | INTEGER | DEFAULT 0，越小越靠前 |

### 3.3 questions — 题目表（核心）
| 字段 | 类型 | 约束/说明 |
| --- | --- | --- |
| id | INTEGER | PK |
| category_id | INTEGER | FK → categories.id |
| type | TEXT | NOT NULL：`single` 单选 / `multiple` 多选 / `judge` 判断 / `fill` 填空 |
| stem | TEXT | NOT NULL，题干（Markdown） |
| options | TEXT | JSON 数组 `[{"key":"A","text":"..."},...]`；判断/填空为 NULL |
| answer | TEXT | NOT NULL，标准答案（编码规则见下） |
| analysis | TEXT | 解析（Markdown，交卷/提交后展示） |
| score | INTEGER | NOT NULL DEFAULT 2，单题分值 |
| score_policy | TEXT | NOT NULL DEFAULT 'strict'：`strict` 全对得分 / `partial` 多选漏选部分分（§5.1） |
| difficulty | INTEGER | NOT NULL DEFAULT 1：1 简单 / 2 中等 / 3 困难 |
| visible | INTEGER | NOT NULL DEFAULT 1；0 = 隐藏（仅 admin 可见，软删） |
| created_at / updated_at | TEXT | NOT NULL |

**answer 编码规则（全系统唯一约定）**：
- 单选：单个大写字母，如 `"B"`
- 判断：`"true"` / `"false"`（前端选项渲染为「正确 / 错误」）
- 多选：字母升序去重后逗号连接，如 `"A,C"`
- 填空：多个可接受答案用 `|` 分隔，任一命中即对，如 `"128|一百二十八"`

### 3.4 exams — 试卷表（管理员维护的考试模板）
| 字段 | 类型 | 约束/说明 |
| --- | --- | --- |
| id | INTEGER | PK |
| title | TEXT | NOT NULL |
| description | TEXT | 考试说明（Markdown） |
| duration_min | INTEGER | NOT NULL，考试时长（分钟） |
| total_score | INTEGER | NOT NULL，创建时按题目分值求和冗余 |
| visible | INTEGER | DEFAULT 1 |
| created_at / updated_at | TEXT | NOT NULL |

### 3.5 exam_questions — 试卷-题目关联
| 字段 | 类型 | 约束/说明 |
| --- | --- | --- |
| id | INTEGER | PK |
| exam_id | INTEGER | FK → exams.id |
| question_id | INTEGER | FK → questions.id |
| sort_order | INTEGER | 题序 |
| — | — | UNIQUE(exam_id, question_id) |

### 3.6 exam_records — 考试记录表（一次考试实例 = 一次作答会话）
| 字段 | 类型 | 约束/说明 |
| --- | --- | --- |
| id | INTEGER | PK |
| exam_id | INTEGER | FK → exams.id |
| user_id | INTEGER | FK → users.id |
| status | TEXT | NOT NULL：`ongoing` 进行中 / `submitted` 已交卷 / `expired` 超时自动交卷 |
| start_time | TEXT | NOT NULL，开考时间 |
| end_time | TEXT | NOT NULL，= start_time + duration_min |
| submitted_at | TEXT | 实际交卷时间 |
| answers | TEXT | JSON 草稿 `{question_id: answer}`，随作答实时覆盖保存 |
| score | INTEGER | 交卷后写入 |
| total_score | INTEGER | 卷面总分（冗余） |
| correct_count | INTEGER | 交卷后写入 |
| result | TEXT | JSON：`[{question_id, correct, user_answer, right_answer, got_score}]`，交卷后写入 |
| created_at | TEXT | NOT NULL |

> 约束：同一 (exam_id, user_id) 同时只允许一条 `ongoing`。SQLite 无部分唯一索引，由应用层在 start 时先查重（§5.2）。

### 3.7 practice_records — 练习记录表（练习模式一次提交）
| 字段 | 类型 | 约束/说明 |
| --- | --- | --- |
| id | INTEGER | PK |
| user_id | INTEGER | FK → users.id |
| mode | TEXT | NOT NULL，练习配置描述，如 `category:3,count:10` / `random:10` / `wrong:5` |
| question_ids | TEXT | NOT NULL，JSON 数组（本次抽到的题） |
| answers | TEXT | NOT NULL，JSON `{question_id: answer}` |
| score / total_score | INTEGER | 得分 / 总分（按 questions.score 计） |
| correct_count | INTEGER | 答对题数 |
| result | TEXT | JSON 逐题结果（同 exam_records.result 结构） |
| created_at | TEXT | NOT NULL |

### 3.8 wrong_questions — 错题表
| 字段 | 类型 | 约束/说明 |
| --- | --- | --- |
| id | INTEGER | PK |
| user_id | INTEGER | FK → users.id |
| question_id | INTEGER | FK → questions.id |
| source_type | TEXT | `practice` / `exam` |
| source_id | INTEGER | practice_records.id / exam_records.id |
| user_answer | TEXT | 当时的错误答案 |
| wrong_at | TEXT | NOT NULL，错题时间 |
| status | TEXT | DEFAULT 'open'：`open` 未解决 / `resolved` 已掌握 |
| resolved_at | TEXT | 答对时间 |
| — | — | UNIQUE(user_id, question_id, source_id) 防重复 |

> 错题不物理删除：重练答对 → `status='resolved'`（保留历史供统计），用户也可手动删除记录。

### 3.9 关系速览
```
users 1─N exam_records / practice_records / wrong_questions
categories 1─N questions
questions N─M exams（经 exam_questions）
exams 1─N exam_records
```

---

## 4. API 设计（RESTful）

### 4.0 统一约定
- 前缀 `/api`。响应：`{code: 0, message: "ok", data: ...}`；业务错误 code 非 0：
  - `40001` 参数错误 ｜ `40101` 未登录/token 失效 ｜ `40301` 无权限 ｜ `40401` 资源不存在 ｜ `40901` 状态冲突（如重复开考、已交卷）。
- 分页：query `page`（默认 1）、`pageSize`（默认 20，≤ 100）；返回 `{items, total, page, pageSize}`。
- 鉴权：`Authorization: Bearer <token>`。
- **安全红线**：题库/试卷接口永不返回 `answer`/`analysis`；只有提交后通过 result 字段回带（含解析），或 admin 管理接口可见。前端不发明新字段。

### 4.1 认证 auth
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | `{username, password, nickname?}` → `{token, user}` |
| POST | `/api/auth/login` | `{username, password}` → `{token, user}` |
| GET | `/api/auth/me` | 当前用户信息（需登录） |
| PUT | `/api/auth/me` | `{nickname?, password?}` 修改资料（需登录） |

### 4.2 分类与题库
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/categories` | 分类列表（含各分类题目数，供筛选/入口展示） |
| GET | `/api/questions` | 分页+筛选：`category_id, type, difficulty, keyword`（题干模糊）→ 不含答案 |
| GET | `/api/questions/:id` | 单题详情（不含答案；hidden 题仅 admin 或已作答者可见） |
| POST | `/api/questions` | admin 新增 `{category_id, type, stem, options, answer, analysis, score, score_policy, difficulty}` |
| PUT | `/api/questions/:id` | admin 修改 |
| DELETE | `/api/questions/:id` | admin 删除；被考试/错题引用时拒绝并提示（MVP 不级联） |

### 4.3 练习模式
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/practice` | `{category_id?, type?, difficulty?, count, source}`，`source='all' \| 'wrong'`（仅错题）→ `{record_id, total_score, questions[]}`（不含答案） |
| POST | `/api/practice/:id/submit` | `{answers: {qid: ans}}` → `{score, total_score, correct_count, results[]}`；判分后自动写入错题表 |
| GET | `/api/practice/:id` | 已提交练习的结果重放（含逐题解析） |

### 4.4 模拟考试
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/exams` | 试卷列表（分页，含当前用户是否已考） |
| GET | `/api/exams/:id` | 试卷详情（题目不含答案，需登录） |
| POST | `/api/exams` | admin 创建 `{title, description, duration_min, question_ids[]}` |
| PUT | `/api/exams/:id` | admin 编辑 |
| DELETE | `/api/exams/:id` | admin 删除 |
| POST | `/api/exams/:id/start` | 开始考试 → 创建/复用 ongoing 记录 → `{record_id, end_time, remaining_seconds, questions[]}` |
| GET | `/api/exam-records/:id` | 进行中：`{status, remaining_seconds, answers, questions}`；已交卷：结果汇总 |
| PUT | `/api/exam-records/:id/answers` | 保存草稿 `{answers}`（整体覆盖；自动判过期，§5.2） |
| POST | `/api/exam-records/:id/submit` | 交卷（含自动交卷场景）→ `{score, total_score, correct_count, results[]}` |
| GET | `/api/exam-records` | 我的考试记录（分页，筛 `status, exam_id`） |
| GET | `/api/exam-records/:id/result` | 交卷后逐题结果+解析（本人/admin） |

### 4.5 错题本
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/wrong-questions` | 分页+筛选：`status, category_id, source_type`；返回题目+我的错误答案+解析 |
| POST | `/api/wrong-questions/:id/reanswer` | `{answer}` 重练本题 → 判分；答对 → `status='resolved'` |
| DELETE | `/api/wrong-questions/:id` | 手动移除 |

### 4.6 统计
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/stats/overview` | `{total_answered, correct_count, accuracy, practice_count, exam_count, avg_exam_score, best_exam_score, wrong_open_count, streak_days}` |
| GET | `/api/stats/categories` | 各分类已答/答对/正确率 |
| GET | `/api/stats/daily` | `?days=30` 每日答题数/正确率（热力图数据） |
| GET | `/api/admin/stats` | admin：用户数/题目数/各题型数/总答题数 |

---

## 5. 关键业务逻辑

### 5.1 判分规则（services/scoring.js — 唯一实现，前后端展示口径一致）

**输入归一化**（所有比较前必做）：
- 单选/判断：trim、转大写。
- 多选：拆成字母集合 → 去重 → 升序 → 逗号连接（`["A","C"]` → `"A,C"`）。
- 填空：trim、全角数字/字母转半角；多答案 `|` 拆分，任一相等即对。

**判分矩阵**：

| 题型 | 规则 |
| --- | --- |
| 单选 / 判断 | 归一化后与 answer 完全一致 → 满分；否则 0 分 |
| 填空 | 命中任一可接受答案 → 满分；否则 0 分 |
| 多选 strict（默认） | 与标准答案集合**完全一致** → 满分；多选/漏选/错选 → 一律 0 分 |
| 多选 partial | ① 选中任何非标准答案项 → 0 分；② 仅漏选：`got_score = round(score × 选对项数 ÷ 标准答案项数, 1)`；③ 全选对 → 满分 |

未作答视为答错（0 分、计入 incorrect、进错题本）。每题 `correct` 布尔 + `got_score` 写入 result。

### 5.2 模拟考试计时与自动交卷（services/examService.js）

1. **开考** `POST /start`：查该 (exam, user) 是否已有 ongoing → 有则复用（防重复开考，40901 语义）；无则创建 `{start_time=now, end_time=now+duration}`，返回剩余秒数与题目。
2. **草稿保存** `PUT /answers`：answers JSON 整体覆盖（后端校验 question 属于本卷）。
3. **惰性过期（核心，无需定时任务）**：对 record 的**任何**操作（拉取/存草稿/交卷）先检查 `now > end_time` 且 status='ongoing' → 服务端用已存草稿自动判分、置 `status='expired'`、写入 score/result、按 source 写错题表；再按请求语义返回（存草稿 → 提示已自动交卷并返回结果；交卷 → 直接返回结果）。
4. **主动交卷** `POST /submit`：服务端校验 `now ≤ end_time` 才接受；过期一律走自动交卷路径，**防前端绕过**。
5. **幂等**：对 `submitted/expired` 记录再次 submit → 直接返回已存结果，不重复判分。
6. **前端倒计时**：剩余秒数由服务端下发；最后 60s 红色提醒；归零时前端自动调 submit（把已保存草稿交出）。前端计时仅做展示——即使前端失效，后端惰性过期兜底，**以服务端时间为准**。

### 5.3 进度统计口径（services/statsService.js — 写死，前后端共用）

| 指标 | 口径 |
| --- | --- |
| 已答题数 total_answered | Σ practice_records.correct_count + Σ exam_records.correct_count（按"题次"计，重复练习同一题算多次） |
| 正确率 accuracy | Σcorrect ÷ Σanswered × 100% |
| 练习数 practice_count | practice_records 行数 |
| 考试数 exam_count | status ∈ {submitted, expired} 的 exam_records 行数（ongoing 不计） |
| 平均分 / 最高分 | Σscore ÷ exam_count / MAX(score)（仅已交卷） |
| 待解决错题 wrong_open_count | wrong_questions WHERE status='open'（按记录计，不去重） |
| 连续天数 streak_days | 有答题行为（练习/考试交卷/错题重练）的日期去重升序，从最近答题日往回数连续自然日；今天未答但昨天答过不中断 |
| 分类统计 | 汇总 practice_records.result + exam_records.result，按题目的 category_id 归集 answered/correct |

### 5.4 练习抽题逻辑

- 条件：`visible=1` + 筛选（category/type/difficulty）或 `source='wrong'`（仅错题 open 状态）；`ORDER BY RANDOM() LIMIT count`；count ≤ 50。
- 返回前剥离 answer/analysis 字段。

### 5.5 种子数据（db/seed.js）

- 默认管理员 `admin / admin123`（首次启动提示修改密码；生产环境通过环境变量覆盖）。
- 五个内置分类（C++语言、数据结构、算法、数学、计算机基础）+ 每分类若干样例题（覆盖 4 种题型，含一道 partial 多选），保证 MVP 开箱可练可考。
- 一份示例试卷（如「CSP 笔试模拟（一）」）。

---

## 6. 项目目录结构

```
D:\Felix\project\
├── docs\
│   ├── architecture.md        ← 本文档（契约唯一来源）
│   ├── requirements.md        ← 需求文档（产品思路官）
│   └── design.md              ← UI/UX 设计（UI 设计师）
├── server\                    后端
│   ├── package.json           scripts: start / dev(--watch) / seed / test
│   ├── .env.example
│   ├── data\                  SQLite 数据文件（.gitignore）
│   ├── src\
│   │   ├── index.js           入口：HTTP + 生产托管 web/dist
│   │   ├── app.js             Express 装配（中间件/路由/错误处理）
│   │   ├── config.js          env 读取与校验
│   │   ├── db\
│   │   │   ├── index.js       node:sqlite 实例 + 事务 helper
│   │   │   ├── schema.sql     全部建表 DDL
│   │   │   └── seed.js        管理员 + 分类 + 样例题 + 示例试卷
│   │   ├── middleware\
│   │   │   ├── auth.js        JWT → req.user
│   │   │   ├── admin.js       角色校验
│   │   │   ├── validate.js    参数校验
│   │   │   └── error.js       统一 {code,message,data}
│   │   ├── routes\            auth / categories / questions / practice /
│   │   │                       exams / examRecords / wrongQuestions / stats / admin
│   │   ├── services\
│   │   │   ├── scoring.js     判分（唯一实现，§5.1）
│   │   │   ├── examService.js 开考/惰性过期/自动交卷/幂等（§5.2）
│   │   │   ├── statsService.js 统计口径（§5.3）
│   │   │   └── wrongService.js 错题写入/解决
│   │   └── utils\             jwt.js / password.js / response.js
│   ├── tests\                 node:test：scoring 全题型用例、examService 过期/幂等用例
│   └── scripts\               （可选）批量导入题目脚本
└── web\                       前端
    ├── package.json
    ├── vite.config.js         dev 代理 /api → http://localhost:3000
    ├── index.html
    └── src\
        ├── main.jsx           React 入口
        ├── App.jsx            路由表 + AuthGuard / AdminGuard
        ├── api\client.js      axios 实例：token 注入、40101 统一跳登录
        ├── context\AuthContext.jsx   登录态
        ├── pages\
        │   ├── auth\Login.jsx / Register.jsx
        │   ├── home\HomePage.jsx           题库浏览/分类入口
        │   ├── practice\PracticeSetup.jsx / PracticePage.jsx / PracticeResult.jsx
        │   ├── exam\ExamList.jsx / ExamDetail.jsx / ExamTaking.jsx / ExamResult.jsx
        │   ├── wrongbook\WrongBookPage.jsx
        │   ├── stats\StatsPage.jsx
        │   └── admin\QuestionManage.jsx / ExamManage.jsx / AdminStats.jsx
        ├── components\        QuestionCard / ChoiceOption / FillInput / AnswerSheet /
        │                       ExamTimer / ResultTable / Pagination / MarkdownView 等（以设计稿为准）
        └── styles\global.css  设计令牌 CSS 变量
```

> 注意：`D:\Felix\project\OJ\` 是此前另一项目的遗留目录（在线判题系统），与本项目无关，**不要混用/依赖**；本项目代码放工作区根目录 `server\` 与 `web\`。

---

## 7. 给开发工程师的开工要点（checklist）

1. **后端**：先写 `schema.sql` + `db/index.js`（node:sqlite 事务 helper），再按 routes → services 顺序实现；`scoring.js` 先于其他逻辑完成并配测试。
2. **前端**：先搭 Vite + 路由骨架 + axios client + AuthContext，再按页面清单逐个实现；所有展示字段、状态枚举、接口路径严格对照 §4，不发明新字段。
3. **联调约定**：开发期 web `npm run dev`（5173，代理 /api），server `npm run dev`（3000）；生产 `cd web && npm run build` 后 server 直接托管。
4. **安全底线**：answer/analysis 只在 result 回带；JWT_SECRET 不硬编码；密码 bcrypt；Markdown 渲染过滤 HTML。
5. **测试**：scoring（4 题型 × 2 策略边界用例）、examService（过期自动交卷、幂等、重复开考）、stats（口径样例）。

## 8. P1 方向（本期不做，记录备查）

- 数据迁移至 MySQL/PostgreSQL（DAO 已隔离）。
- 题目批量导入（Excel/JSON 文件）。
- 刷题计划/每日打卡提醒、排行榜、成就体系。
- TypeScript 化、单元测试覆盖率门禁、Docker 部署包。
