# 技术架构设计文档（Architecture Design）

| 项 | 内容 |
| --- | --- |
| 文档版本 | v1.0 |
| 编写人 | designer（UI/UX 设计与架构设计） |
| 输入依据 | `docs/requirements.md`（PRD v1.0） |
| 状态 | 已验收（MVP v1.0 交付；验收结果见 `docs/test-report.md`；实现差异见 `README.md`「与设计文档的差异说明」） |
| 项目定位 | 信息学竞赛笔试刷题练习网站（CSP-J/S、NOIP、蓝桥杯、省市校级及所有信息学竞赛笔试），浏览器端使用，单机可部署 |

---

## 1. 设计目标与原则

### 1.1 总体目标

搭建一个**简单、可运行、可维护、可扩展**的前后端分离单体 Web 应用，覆盖 PRD 中全部 P0 功能：

- F0 用户系统（注册/登录/退出/JWT）
- F1 题库浏览与分类筛选
- F2 练习模式（4 种题型即时判分 + 解析 + 错题自动沉淀）
- F3 模拟考试（限时/答题卡/自动交卷/成绩报告）
- F4 错题本（重练/移出规则）
- F5 学习统计（总体概览/分类/题型正确率）
- F6 种子题库（≥60 题、4 题型 × 7 分类全覆盖）

### 1.2 架构原则

| 原则 | 说明 |
| --- | --- |
| 简单优先 | 不引入数据库、不引入构建工具链、不引入前端框架运行时依赖，保证"npm install + npm start"即可运行 |
| 前后端分离 | 前端静态资源由 Express 托管，通过 REST API 通信；API 与页面解耦，未来可替换前端实现 |
| 数据与代码分离 | 题库/试卷为 JSON 数据文件，与业务代码分离，便于扩充题库与内容维护 |
| 服务端权威判分 | 判分逻辑在服务端实现（唯一事实源），前端只做展示与交互，防止绕过判分、保证练习与模拟考规则一致 |
| 幂等与安全 | 种子导入可重复执行；密码哈希存储；JWT 鉴权保护业务接口 |

---

## 2. 技术栈选型

### 2.1 选型总览

| 层 | 选型 | 版本建议 | 说明 |
| --- | --- | --- | --- |
| 前端 | 原生 HTML5 + CSS3 + 原生 JavaScript（ES Modules） | 现代浏览器（Chrome/Edge 最近两个大版本） | 零构建、零依赖，无需 npm 打包即可运行 |
| 前端路由 | Hash 路由（自实现 `#/` 路由表） | — | 纯静态部署友好，无需服务端路由配置 |
| 后端 | Node.js + Express | Node ≥ 18，Express 4.x | 生态成熟、轻量，与前端同语言 |
| 数据存储 | JSON 文件存储（自封装 DataStore 模块） | — | 单机单进程场景，文件即数据库，无需安装数据库服务 |
| 认证 | JWT（`jsonwebtoken`）+ 密码哈希（`bcryptjs`） | jsonwebtoken 9.x，bcryptjs 2.x | 无原生编译依赖，跨平台安装稳定 |
| 判分 | 服务端判分模块（`services/grader.js`） | — | 统一规则，前端不持有标准答案（模拟考模式） |
| 种子数据 | JSON 种子文件 + 幂等导入脚本 | — | `npm run seed` 可重复执行 |

### 2.2 选型理由

1. **前端为何不用框架（Vue/React）？**
   - 页面共 14 个，交互以"表单 + 列表 + 状态切换"为主，原生 JS 完全可承载；
   - 无构建步骤意味着**浏览器直接打开即可开发调试**，降低前后端联调门槛；
   - 避免引入 node_modules 构建链，符合"简单可运行"的第一原则；
   - 预留演进路径：API 契约稳定后，如需框架可平滑替换前端（架构文档 §8）。
2. **后端为何用 Node.js + Express？**
   - 与前端同语言，团队（前端工程师）无需切换语言心智；
   - JSON 处理原生友好，适合"读 JSON 题库 → 判分 → 写 JSON 记录"的数据流；
   - 单文件即可启动，适合单机部署（systemd/pm2 均可）。
3. **为何用 JSON 文件而非 SQLite/MySQL？**
   - MVP 数据量小（题库 ≤ 数百题、用户与记录为个人级/小规模），JSON 文件读写足够；
   - **零运维**：不需要数据库安装、迁移、备份脚本；
   - 题目数据本身就是结构化 JSON，天然一致；
   - 风险与升级路径见 §8：数据量或并发上来后，可平滑迁移到 SQLite（仅替换 DataStore 层）。
4. **为何判分放服务端？**
   - 模拟考（F3.3）要求考试期间不显示答案，前端不能持有标准答案，判分必须服务端；
   - 练习模式虽可前端即时判分，但统一走服务端可保证"错题本沉淀、统计记录"与判分原子一致（一次提交同时完成判分 + 记录 + 错题更新）；
   - 满足验收标准"统计数值与服务端记录一致"（§6 F5）。

### 2.3 依赖清单（package.json）

```json
{
  "name": "oi-exam-practice",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server/index.js",
    "dev": "node --watch server/index.js",
    "seed": "node scripts/seed.js",
    "test": "node --test server/**/*.test.js"
  },
  "dependencies": {
    "express": "^4.19.0",
    "jsonwebtoken": "^9.0.2",
    "bcryptjs": "^2.4.3"
  }
}
```

> `"type": "module"` 使前后端统一使用 ES Module 语法；测试用 Node 内置 test runner，不额外引入测试框架。

---

## 3. 总体架构与数据流

### 3.1 架构图（部署视角）

```
┌─────────────────────────────────────────────────────────────┐
│                    单机服务器（Node.js）                        │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Express 应用 (server/app.js)                            │ │
│  │                                                         │ │
│  │  ┌──────────────┐    ┌──────────────────────────────┐  │ │
│  │  │ 静态资源托管   │◄───│  前端 (web/)                  │  │ │
│  │  │ (web/*)       │    │  HTML/CSS/原生JS 单页应用      │  │ │
│  │  └──────────────┘    └──────────────┬───────────────┘  │ │
│  │                                     │ REST API         │ │
│  │  ┌──────────────────────────────────▼───────────────┐  │ │
│  │  │  API 路由 (server/routes/*.js)                    │  │ │
│  │  │  /api/auth  /api/questions  /api/practice         │  │ │
│  │  │  /api/exams  /api/wrong-book  /api/stats          │  │ │
│  │  └──────────────────────────────────┬───────────────┘  │ │
│  │                                     │                   │ │
│  │  ┌──────────────────────────────────▼───────────────┐  │ │
│  │  │  业务服务层 (server/services/*.js)                │  │ │
│  │  │  grader(判分) stats(统计) exam-builder(组卷)      │  │ │
│  │  │  wrong-book(错题规则)                             │  │ │
│  │  └──────────────────────────────────┬───────────────┘  │ │
│  │                                     │                   │ │
│  │  ┌──────────────────────────────────▼───────────────┐  │ │
│  │  │  DataStore 数据访问层 (server/store/)             │  │ │
│  │  │  内存缓存 + JSON 文件落盘（同步写入保证不丢）        │  │ │
│  │  └──────────────────────────────────┬───────────────┘  │ │
│  └─────────────────────────────────────┼─────────────────┘ │
│                                        │                     │
│                        ┌───────────────▼──────────────┐     │
│                        │  data/ JSON 数据文件           │     │
│                        │  users/questions/answers/     │     │
│                        │  wrong-book/exams/results     │     │
│                        └──────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 一次练习判分的数据流（时序）

```
浏览器                          Express                     DataStore
  │  POST /api/practice/submit   │                            │
  │  {questionId, answer, token} │                            │
  │─────────────────────────────►│ ① auth 中间件验证 JWT       │
  │                              │ ② 读取题目（内存缓存）       │
  │                              │ ③ grader 判分              │
  │                              │ ④ 写 answers 记录          │
  │                              │ ⑤ 若错 → 更新错题本         │
  │                              │ ⑥ 返回 {correct, answer,   │
  │                              │    analysis, explanation}  │
  │◄─────────────────────────────│                            │
  │ 展示 对/错 + 解析             │                            │
```

### 3.3 数据目录（data/）文件职责

| 文件 | 内容 | 写入者 |
| --- | --- | --- |
| `questions.seed.json` | 种子题库（源头数据，≥60 题，人工维护） | 内容维护者 |
| `questions.json` | 运行时题库（由 seed 导入生成） | seed 脚本 / 内容接口 |
| `exams.seed.json` | 模拟卷定义（组卷，含真题卷） | 内容维护者 |
| `exams.json` | 运行时试卷（由 seed 导入生成） | seed 脚本 |
| `users.json` | 用户账号（用户名、密码哈希） | 注册接口 |
| `answers.json` | 答题记录（练习 + 模拟考） | 判分流程 |
| `wrong-book.json` | 错题本记录 | 判分流程 / 重练流程 |
| `exam-results.json` | 模拟考成绩单 | 交卷流程 |
| `exam-sessions.json` | 考试进行中会话（防刷新丢进度，P1） | 考试流程 |

---

## 4. 目录结构规划

```
oi-exam-practice/
├── package.json                  # 依赖与脚本
├── README.md                     # 项目说明与启动指引
├── docs/                         # 文档
│   ├── requirements.md           # PRD（已存在）
│   ├── architecture.md           # 本文档
│   └── ui-design.md              # UI/UX 设计规范
├── data/                         # 数据文件（JSON 存储，即"数据库"）
│   ├── questions.seed.json       # 种子题库（≥60 题，4 题型 × 7 分类）
│   ├── exams.seed.json           # 模拟卷种子
│   └── (运行时生成) questions.json / exams.json / users.json /
│       answers.json / wrong-book.json / exam-results.json / exam-sessions.json
├── scripts/
│   └── seed.js                   # 幂等导入种子数据（npm run seed）
├── server/                       # 后端（Node.js + Express）
│   ├── index.js                  # 入口：启动 HTTP 服务
│   ├── app.js                    # 组装 Express：静态资源 + 中间件 + 路由
│   ├── config.js                 # 端口、JWT 密钥、路径等配置（含环境变量覆盖）
│   ├── middleware/
│   │   ├── auth.js               # JWT 鉴权中间件（挂 req.user）
│   │   └── error.js              # 统一错误响应中间件
│   ├── routes/
│   │   ├── auth.js               # /api/auth/*  注册/登录/当前用户
│   │   ├── questions.js          # /api/questions/* 题库列表/详情
│   │   ├── practice.js           # /api/practice/* 练习判分提交
│   │   ├── exams.js              # /api/exams/*  模拟卷/会话/交卷/成绩
│   │   ├── wrong-book.js         # /api/wrong-book/* 错题本 CRUD/重练
│   │   └── stats.js              # /api/stats/*  统计聚合
│   ├── services/
│   │   ├── grader.js             # 判分核心（4 题型统一规则）
│   │   ├── exam-builder.js       # 组卷逻辑（固定卷/随机组卷）
│   │   ├── wrong-book-service.js # 错题本规则（入本/连对/移出）
│   │   └── stats-service.js      # 统计聚合逻辑
│   ├── store/                    # 数据访问层
│   │   ├── datastore.js          # 通用 JSON 文件读写（内存缓存 + 落盘）
│   │   └── collections.js        # 各集合的存取封装（users/questions/...）
│   ├── utils/
│   │   ├── password.js           # bcryptjs 封装
│   │   ├── jwt.js                # 签发/校验 JWT
│   │   └── id.js                 # 生成唯一 id（时间戳+随机）
│   └── __tests__/                # Node test runner 单元测试
│       ├── grader.test.js
│       └── wrong-book.test.js
└── web/                          # 前端（静态资源，Express 托管）
    ├── index.html                # SPA 唯一 HTML 入口
    ├── css/
    │   ├── base.css              # 变量/重置/排版基础
    │   ├── layout.css            # 布局（导航/容器/页脚）
    │   ├── components.css        # 组件样式（按钮/卡片/答题卡/弹窗/Toast）
    │   └── pages.css             # 各页面专用样式
    ├── js/
    │   ├── main.js               # 入口：初始化路由、鉴权态、全局组件
    │   ├── router.js             # hash 路由表（#/ → 页面模块）
    │   ├── api.js                # fetch 封装（baseURL、token、错误统一处理）
    │   ├── store.js              # 前端状态（user、筛选条件、练习会话）
    │   ├── utils.js              # 工具（格式化、DOM 帮助、防抖）
    │   ├── components/           # 可复用组件
    │   │   ├── navbar.js
    │   │   ├── question-card.js  # 题目渲染（含代码块/选项/解析）
    │   │   ├── answer-sheet.js   # 答题卡（题号导航）
    │   │   ├── timer.js          # 倒计时
    │   │   ├── modal.js
    │   │   └── toast.js
    │   └── pages/                # 页面模块（一一对应 PRD §5）
    │       ├── home.js           # P1 首页/题库浏览
    │       ├── practice.js       # P2 练习答题页
    │       ├── exam-list.js      # P3 模拟考列表
    │       ├── exam-taking.js    # P4 模拟考试页
    │       ├── exam-result.js    # P5 成绩报告页
    │       ├── wrong-book.js     # P6 错题本页
    │       ├── wrong-review.js   # P7 错题重练页
    │       ├── stats.js          # P8 学习统计页
    │       ├── login.js          # P9 登录页
    │       ├── register.js       # P10 注册页
    │       ├── profile.js        # P11 个人中心
    │       ├── question-detail.js# P12 题目详情（P1）
    │       ├── exam-history.js   # P13 历史成绩（P1）
    │       └── about.js          # P14 关于/帮助（P1）
    └── assets/                   # 图标、logo 等静态资源
```

> 前端为**单页应用（SPA）**：所有页面通过 hash 路由在 `index.html` 中切换，Express 只需托管静态文件即可，无服务端路由。未登录可访问题库浏览/题目详情；练习、模拟考、错题本、统计需登录（前端路由守卫 + 后端 API 鉴权双重保障）。

---

## 5. 数据模型设计

所有数据以 JSON 文件存储，集合间通过 `id` 关联。以下为各集合的 Schema 定义。

### 5.1 题目（questions.json / questions.seed.json）

```jsonc
{
  "id": "q0001",                          // 唯一 id（q + 4 位数字，或年份+序号）
  "type": "single",                        // single | multiple | judge | reading
  "stem": "以下哪个是合法的 C++ 变量名？",    // 题干，支持 Markdown（代码块 ``` 渲染）
  "options": [                             // 选项（reading 题无顶层 options）
    { "key": "A", "text": "2abc" },
    { "key": "B", "text": "_abc" },
    { "key": "C", "text": "abc-1" },
    { "key": "D", "text": "int" }
  ],
  "answer": ["B"],                          // 标准答案：single/judge 为 1 元素数组；
                                            // multiple 为 1..N 元素数组；reading 为子题答案数组的数组
  "analysis": "变量名不能以数字开头……",        // 解析（思路 + 知识点）
  "knowledge_category": "C++语言基础",       // 7 类之一（见 5.1.1）
  "competition_types": ["csp-j", "csp-s"], // 通用可扩展枚举，见 5.1.3（勿硬编码仅 CSP/NOIP）
  "difficulty": 1,                          // 1 入门 | 2 提高 | 3 挑战（P1 可用，默认 1）
  "source": "CSP-J 2023 第一轮 第 2 题",     // 来源/年份（真题标注）
  "code": "",                               // 阅读程序题：代码文本（其余题型为空）
  "sub_questions": [                        // 阅读程序题：子题数组（其余题型为空数组）
    {
      "id": "q0001-1",
      "type": "single",                     // 子题可为 single | judge
      "stem": "程序输出的第一行是？",
      "options": [ { "key": "A", "text": "10" }, { "key": "B", "text": "20" } ],
      "answer": ["A"],
      "analysis": "循环执行到 i=10 时输出……"
    }
  ],
  "score": 1,                               // 单题分值（默认 1；reading 题 = 子题分值之和，可缺省）
  "created_at": "2024-01-01T00:00:00.000Z"
}
```

#### 5.1.1 knowledge_category 固定枚举（7 类，与 PRD F1.2 一致）

| 值 | 含义 |
| --- | --- |
| `C++语言基础` | 语法、类型、运算符、输入输出、作用域、STL 基础 |
| `数据结构` | 数组、链表、栈、队列、树、图、哈希、堆 |
| `算法` | 排序、二分、递归、贪心、DP、搜索、图论、字符串 |
| `数学` | 数论、组合数学、概率、进制、逻辑 |
| `计算机基础` | 硬件、操作系统、网络、编码、计算机史与人物、竞赛常识 |
| `阅读程序` | 程序阅读类专项分类 |
| `NOI相关知识` | 历年真题、赛制规则、OI 竞赛常识 |

> 枚举值在 `server/config.js` 中定义常量数组，前后端共用同一份语义；数据校验时校验分类合法性。

#### 5.1.2 type 枚举与判分规则

| type | 选项数 | 标准答案形态 | 判分规则 | 分值 |
| --- | --- | --- | --- | --- |
| `single` | 4 | `["B"]` | 用户答案与标准答案完全一致 | 1 |
| `multiple` | 4~5 | `["A","C"]` | 用户答案集合与标准答案集合**完全相同**（多选/少选/错选均不得分） | 2 |
| `judge` | 无（二选一） | `["T"]` 或 `["F"]` | 与标准答案一致 | 1 |
| `reading` | 无（子题含选项/判断） | 子题答案数组的数组 | **子题独立判分**，大题得分 = Σ子题得分 | Σ子题分值 |

> 多选按 PRD F2.1 要求"全对才得分"，严格集合相等比较（顺序无关）。

#### 5.1.3 竞赛类型枚举（通用可扩展，不限于 CSP/NOIP）

竞赛范围覆盖**所有信息学竞赛笔试**（CSP-J/S、NOIP、蓝桥杯、省市校级比赛、其他赛事等）。`competition_types`（题目字段，数组可多标）与 `competition_type`（模拟卷字段，单值）统一使用**小写连字符枚举码**，禁止硬编码死仅 CSP/NOIP：

| 枚举码 | 展示名 | 说明 |
| --- | --- | --- |
| `csp-j` | CSP-J | CSP 入门级第一轮（初赛笔试） |
| `csp-s` | CSP-S | CSP 提高级第一轮（初赛笔试） |
| `noip` | NOIP | NOIP 初赛笔试 |
| `lanqiao` | 蓝桥杯 | 蓝桥杯青少组等赛事 |
| `provincial` | 省赛 | 省级比赛 |
| `municipal` | 市赛 | 市级比赛 |
| `school` | 校赛 | 校级比赛 |
| `other` | 其他 | 其他信息学竞赛笔试 |

**扩展机制（新增赛事三步走，不涉及 schema/API/前端改动）**：

1. **枚举即配置**：枚举白名单定义在 `server/config.js` 的 `COMPETITION_TYPES` 常量（`[{ code, label }]`），新增赛事只需追加一条记录；
2. **元数据接口驱动前端**：提供 `GET /api/meta/competition-types`（匿名可访问，见 §6.2 说明），返回全部 `{ code, label }`，题库页/模拟考页的竞赛类型筛选标签**由该接口动态渲染**（见 ui-design.md §3 filter-bar 与 P1 线框），新增赛事无需改前端代码；
3. **后端白名单校验**：`competition` 筛选参数按枚举白名单校验，未知枚举返回 `400 INVALID_COMPETITION`；模拟卷 `competition_type` 写入前同样校验。

> 兼容性：题库数据中历史题目以 `csp-j/csp-s/noip` 枚举码存储（seed 时统一规范化）；展示名（如"蓝桥杯"）由前端按 code 映射，数据层只存 code 不存展示名，避免文案与数据耦合。

### 5.2 用户（users.json）

```jsonc
{
  "id": "u0001",
  "username": "alice",          // 唯一，3~20 字符，字母数字下划线
  "password_hash": "$2a$10$...", // bcryptjs 哈希，绝不存明文
  "created_at": "2024-01-01T00:00:00.000Z"
}
```

### 5.3 答题记录（answers.json）

```jsonc
{
  "id": "a0001",
  "user_id": "u0001",
  "question_id": "q0001",
  "user_answer": ["B"],          // 用户作答（题型形态与题目 answer 一致）
  "is_correct": true,
  "score": 1,                    // 该题得分
  "source": "practice",          // practice | exam
  "exam_id": null,               // source=exam 时关联考试成绩
  "submitted_at": "2024-01-01T10:00:00.000Z"
}
```

### 5.4 错题本（wrong-book.json）

```jsonc
{
  "user_id": "u0001",
  "question_id": "q0002",
  "wrong_count": 3,              // 累计答错次数
  "review_correct_streak": 1,    // 重练连续答对次数（重练答对 +1，答错清零）
  "status": "active",            // active | removed
  "last_wrong_answer": ["A"],    // 最近一次错选答案
  "last_wrong_at": "2024-01-01T10:05:00.000Z",
  "added_at": "2024-01-01T09:00:00.000Z"
}
```

#### 5.4.1 错题本状态机（F4.3/F4.4）

```
答错（练习/模拟考）         重练答对 ×1          重练答对 ×2
   ────────────────►  ┌──────────► ┌──────────►  ┌─────────────┐
   不在错题本（首次）    │  active     │  active     │  removed     │
                      └──────────┘  (streak=1)  (streak=2) 自动移出
                        ▲                           │
                        │ 重练答错（streak 清零）      └──► 可再次答错重新入本
```

- 首次答错：插入记录 `wrong_count=1, streak=0, status=active`；
- 再次答错：`wrong_count+1`，`streak` 清零；
- 重练答对：`streak+1`；`streak ≥ 2`（默认阈值，可配置）时 `status=removed`（**自动移出**）；
- 手动移除：`status=removed`（P0 提供按钮，F4.4）；
- `status=removed` 的记录保留（用于统计历史），错题本列表只展示 `active`。

### 5.5 模拟卷（exams.json / exams.seed.json）

```jsonc
{
  "id": "exam-001",
  "title": "CSP-J 2023 第一轮 真题模拟卷",
  "competition_type": "csp-j",          // 通用可扩展枚举码，见 5.1.3
  "duration_minutes": 120,              // 整卷时长，到时自动交卷
  "question_ids": ["q0001", "q0005", ...],
  "is_auto_generated": false,           // false=真题/固定卷；true=按分类随机组卷
  "total_score": 100,                   // 可由 question_ids 的 score 汇总，冗余存储便于展示
  "unanswered_as_wrong": true,          // 未答题按错误处理（默认 true）
  "created_at": "2024-01-01T00:00:00.000Z"
}
```

> 组卷规则（exam-builder.js）：固定卷直接用 `question_ids`；随机组卷（P1，`is_auto_generated=true`）按 `competition_type + knowledge_category` 配额从题库抽取。

### 5.6 考试会话（exam-sessions.json，P1 防刷新）

```jsonc
{
  "id": "s0001",
  "user_id": "u0001",
  "exam_id": "exam-001",
  "answers": { "q0001": ["B"], "q0005": ["A","C"] },  // 题号 → 用户答案
  "started_at": "2024-01-01T10:00:00.000Z",
  "status": "ongoing"               // ongoing | submitted
}
```

> P0 阶段：考试会话保存在浏览器 localStorage + 刷新二次确认；P1 落服务端实现防刷新恢复（接口 §6.5）。

### 5.7 考试成绩（exam-results.json）

```jsonc
{
  "id": "r0001",
  "user_id": "u0001",
  "exam_id": "exam-001",
  "score": 82,
  "total": 100,
  "rate": 0.82,                      // 得分率
  "answers": { "q0001": ["B"], ... },// 全部作答快照
  "detail": {
    "by_category": { "C++语言基础": { "correct": 8, "total": 10 }, ... },
    "by_type": { "single": { "correct": 20, "total": 25 }, ... }
  },
  "submitted_at": "2024-01-01T12:00:00.000Z"
}
```

---

## 6. API 接口设计

统一约定：

- Base URL：`/api`；请求/响应均为 JSON，`Content-Type: application/json`。
- 鉴权：需要登录的接口携带 `Authorization: Bearer <JWT>`；未携带/失效返回 `401`。
- 分页：`?page=1&pageSize=20`，`pageSize ≤ 50`（PRD 非功能 §8.1）。
- 错误响应统一格式：
  ```json
  { "error": { "code": "USERNAME_TAKEN", "message": "用户名已存在" } }
  ```
- 成功响应：直接返回资源对象/数组；列表接口返回 `{ "items": [...], "total": N, "page": 1, "pageSize": 20 }`。

### 6.1 认证 —— POST /api/auth/register、POST /api/auth/login

**POST /api/auth/register**
- 入参：`{ "username": "alice", "password": "secret123", "confirmPassword": "secret123" }`
- 校验：用户名唯一（409 `USERNAME_TAKEN`）；密码 ≥ 6 位（400 `WEAK_PASSWORD`）；两次密码一致（400 `PASSWORD_MISMATCH`）。
- 出参：`201 { "token": "<jwt>", "user": { "id": "u0001", "username": "alice" } }`（注册即登录，F0.1 + 低门槛）。

**POST /api/auth/login**
- 入参：`{ "username": "alice", "password": "secret123" }`
- 出参：`200 { "token": "<jwt>", "user": { "id": "u0001", "username": "alice" } }`
- 失败统一返回 `401 { error: { code: "BAD_CREDENTIALS", message: "用户名或密码错误" } }`（不区分具体错误，满足 F0 DoD）。

**GET /api/auth/me**（需登录）
- 出参：`200 { "id": "u0001", "username": "alice" }`；用于刷新页面后恢复登录态（F0.2 持久化）。

### 6.2 题库 —— GET /api/questions（需登录：练习/查看；未登录可浏览列表与详情）

> **元数据接口（前置）**：`GET /api/meta/competition-types`（匿名可访问）返回全部竞赛类型枚举 `[{ "code": "csp-j", "label": "CSP-J" }, ...]`，题库页/模拟考页的竞赛类型筛选标签据此动态渲染（见 §5.1.3 与 ui-design.md）。知识点分类与题型枚举由前端常量表承载（固定项）。

**GET /api/questions** 题库列表/筛选（F1）
- Query 参数（可组合，全部可选）：
  - `competition`: 竞赛类型枚举码，如 `csp-j | csp-s | noip | lanqiao | provincial | municipal | school | other`（F1.1，白名单校验，见 §5.1.3）
  - `category`: 7 类知识点之一（F1.2）
  - `type`: `single | multiple | judge | reading`（F1.4）
  - `difficulty`: `1 | 2 | 3`（F1.3，P1）
  - `keyword`: 题干关键词模糊匹配（F1.6，P1）
  - `page` / `pageSize`（F1.5 分页）
- 出参：`200 { "items": [题目摘要…], "total": 42, "page": 1, "pageSize": 20 }`
- 题目摘要字段（列表不含 answer，防止未登录窥探）：`id, type, stem(截断), knowledge_category, competition_types, difficulty, source, score`。

**GET /api/questions/:id** 单题详情（F1.5 / P12）
- 出参：`200` 完整题目（含 options、code、sub_questions、analysis；**不含 answer**，除非 `?withAnswer=1` 且已登录）。
- 404：`QUESTION_NOT_FOUND`。

### 6.3 练习 —— POST /api/practice/submit（需登录，F2）

**POST /api/practice/submit**
- 入参：`{ "questionId": "q0001", "answer": ["B"] }`（answer 形态与题型对应：single/judge 单元素、multiple 多元素、reading 传子题答案数组的数组）
- 处理流程（服务端原子完成）：
  1. 读取题目，校验答案格式合法性（400 `INVALID_ANSWER`）；
  2. grader 判分 → `{ isCorrect, score, correctAnswer }`；
  3. 写 answers 记录（source=practice）；
  4. 答错 → 更新错题本（F2.5 自动入本）。
- 出参：`200`
  ```json
  {
    "isCorrect": false,
    "score": 0,
    "correctAnswer": ["C"],
    "analysis": "解析内容…",
    "knowledgeCategory": "C++语言基础"
  }
  ```
  （练习模式即时反馈：对/错 + 正确答案 + 解析，F2.3/F2.4 一次返回，前端 1 秒内渲染。）

### 6.4 模拟考试 —— /api/exams/*（需登录，F3）

**GET /api/exams** 模拟卷列表（F3.1）
- Query：`competition`（可选）
- 出参：`200 { "items": [{ "id", "title", "competitionType", "durationMinutes", "questionCount", "totalScore" }] }`
- 列表不含题目内容（避免考试前泄露）。

**GET /api/exams/:id** 卷详情（开始前确认页）
- 出参：`200 { "id", "title", "competitionType", "durationMinutes", "questionCount", "totalScore", "rules": { "unansweredAsWrong": true } }`

**POST /api/exams/:id/start** 开始考试（创建会话）
- 出参：`201 { "sessionId": "s0001", "startedAt": "...", "questions": [题目(不含answer/analysis)…] }`
- 考试期间返回的题目**绝不含 answer/analysis**（F3.3 纪律）。

**POST /api/exams/session/:sessionId/submit** 交卷（手动 + 自动，F3.4）
- 入参：`{ "answers": { "q0001": ["B"], ... }, "auto": false }`（auto=true 表示到时自动交卷）
- 处理：
  1. 校验会话归属与状态（非本人 403；已交卷 409 `ALREADY_SUBMITTED`）；
  2. 未答题按 `unanswered_as_wrong` 处理（默认计错/0 分）；
  3. grader 逐题判分 → 汇总 total/rate/by_category/by_type；
  4. 写 exam-results 成绩单；写 answers 记录（source=exam, exam_id）；错题入错题本；
  5. 会话标记 submitted。
- 出参：`200 { "resultId": "r0001", "score": 82, "total": 100, "rate": 0.82, "detail": { "byCategory": {...}, "byType": {...} } }`
- 成绩报告页（P5）再取 **GET /api/exams/results/:resultId** 获取逐题对错 + 解析（考后可看，F3.5）。

**GET /api/exams/results** 历史成绩（P1，F3.7）
- 出参：`200 { "items": [{ "resultId", "examId", "examTitle", "score", "total", "rate", "submittedAt" }] }`

**GET /api/exams/session/:sessionId** 恢复考试会话（P1，F3.8）
- 出参：`200 { "sessionId", "remainingSeconds", "answers": {...}, "questions": [...] }`

### 6.5 错题本 —— /api/wrong-book/*（需登录，F4）

**GET /api/wrong-book** 错题列表（F4.1）
- Query：`category`、`type`（P1，F4.2）、`page/pageSize`
- 出参：`200 { "items": [{ "questionId", "stem", "type", "knowledgeCategory", "wrongCount", "lastWrongAnswer", "correctAnswerSummary", "lastWrongAt" }], "total": N }`
- 仅返回 `status=active`（F4.1 列表），时间倒序。

**POST /api/wrong-book/review** 错题重练提交（F4.3）
- 入参：`{ "questionId": "q0002", "answer": ["C"] }`
- 处理：判分（同 practice）+ 更新错题本状态机（连对/清零/自动移出）。
- 出参：`200 { "isCorrect": true, "correctAnswer": ["C"], "analysis": "...", "reviewStreak": 2, "autoRemoved": true }`
  - `autoRemoved=true` 表示达到连对阈值已自动移出（前端提示"已移出错题本"）。

**DELETE /api/wrong-book/:questionId** 手动移除（F4.4）
- 出参：`204`。

**GET /api/wrong-book/stats** 错题分类排行（P1，F4.5）
- 出参：`200 { "items": [{ "knowledgeCategory": "数学", "wrongCount": 12 }, ...] }`

### 6.6 统计 —— /api/stats/*（需登录，F5）

**GET /api/stats/overview** 总体概览（F5.1）
- 出参：`200 { "totalAnswered": 320, "totalCorrect": 240, "overallRate": 0.75, "totalPracticeMinutes": 185, "examCount": 3 }`
- `totalPracticeMinutes`：由 practice 答题记录的答题时长字段累计（记录时可选传 `elapsedSeconds`，P1 精确化；P0 可由题数估算）。

**GET /api/stats/categories** 分类正确率（F5.2）
- 出参：`200 { "items": [{ "category": "C++语言基础", "answered": 60, "correct": 45, "rate": 0.75 }, ...7 类] }`

**GET /api/stats/types** 题型正确率（F5.3）
- 出参：`200 { "items": [{ "type": "single", "answered": 120, "correct": 100, "rate": 0.83 }, ...4 种] }`

**GET /api/stats/trend** 近 7/30 天趋势（P1，F5.4）
- 出参：`200 { "items": [{ "date": "2024-01-01", "answered": 20, "correct": 15 }, ...] }`

> 统计全部由 answers / exam-results / wrong-book 实时聚合（stats-service.js），数据量小无需预聚合。

### 6.7 API 权限矩阵

| 接口 | 匿名可访问 | 需登录 |
| --- | --- | --- |
| POST /api/auth/register、login | ✅ | — |
| GET /api/auth/me | — | ✅ |
| GET /api/meta/competition-types | ✅ | — |
| GET /api/questions、/api/questions/:id | ✅（不含答案） | ✅（可含答案） |
| POST /api/practice/submit | — | ✅ |
| /api/exams/* 全部 | — | ✅ |
| /api/wrong-book/* 全部 | — | ✅ |
| /api/stats/* 全部 | — | ✅ |

> 对应 PRD F0.4 登录保护策略：**未登录可浏览题库，答题/模拟考/错题本/统计需登录**，前后端双重校验。

---

## 7. 关键技术设计

### 7.1 认证与登录态

- 注册/登录成功签发 JWT（`jsonwebtoken`），payload：`{ sub: userId, username }`，有效期 7 天（可配置）。
- 前端将 token 存 `localStorage`，`api.js` 统一在请求头注入；刷新页面后调 `GET /api/auth/me` 恢复登录态（PRD F0.2 持久化）。
- 退出登录：前端清除 token 并跳转首页；受保护页面路由守卫检测无 token 跳 `/login?redirect=<原页面>`，登录后回跳（PRD §6 全局标准）。
- 密码：`bcryptjs.hashSync(password, 10)` 存储，绝不明文；登录用 `bcryptjs.compareSync`。

### 7.2 判分核心（services/grader.js）

```js
// 输入：题目对象 + 用户答案
// 输出：{ isCorrect, score, correctAnswer, perSubQuestion? }
function grade(question, userAnswer) {
  switch (question.type) {
    case 'single':
    case 'judge':
      // 单元素严格相等
      return eq(userAnswer, question.answer) ? { isCorrect: true, score: question.score ?? 1 } : {...};
    case 'multiple':
      // 集合相等（顺序无关、多选少选均错）
      return setEq(userAnswer, question.answer) ? ... : ...;
    case 'reading':
      // 逐子题判分（子题走 single/judge 规则），得分累加；
      // isCorrect = 全部子题正确
      ...
  }
}
```

- 判分前校验答案形态：`single/judge` 必须 1 个元素；`multiple` 1~N 个元素且为合法选项 key；`reading` 子题数与 `sub_questions` 一致（否则 400 `INVALID_ANSWER`）。
- **练习与模拟考共用同一 grader**，保证规则一致（F2/F3 DoD 对齐）。

### 7.3 DataStore（store/datastore.js）

- 每个集合一个 JSON 文件；启动时加载进内存（`Map`/对象），读写走内存，变更后**同步写盘**（`fs.writeFileSync` 临时文件 + rename 原子替换），避免进程退出丢数据；
- 提供 `find(filter)` / `findById(id)` / `insert(doc)` / `update(predicate, patch)` / `delete(predicate)` / `count(filter)` 基础 API；
- id 生成：`utils/id.js`（时间戳 + 随机后缀），无自增依赖；
- 单机单进程场景无需锁；写操作在 Express 同步处理器中顺序执行，天然串行。

### 7.4 防作弊与考试纪律（F3.3）

- 考试开始后接口返回的题目对象由 `services/exam-builder.js` 做 **answer/analysis 字段剥离**（白名单字段输出），从源头保证考试页拿不到答案；
- 前端考试页：禁右键、禁复制答案相关区域（基础防呆，不追求强防作弊）；
- 手动交卷二次确认 Modal；倒计时归零自动调用 submit（auto=true）；
- P1：刷新/离开提示 + 服务端会话恢复（§5.6、§6.4）。

### 7.5 错误处理与日志

- `middleware/error.js`：统一捕获路由异常 → `500 { error: { code: "INTERNAL", message: "服务器内部错误" } }`，控制台打印堆栈；
- 业务错误用 `throw new ApiError(status, code, message)` 传递（401/403/404/409/400）；
- 静态资源 404 与 API 404 分别处理（API 返回 JSON，避免前端拿到 HTML）。

---

## 8. 演进与风险

| 事项 | 当前方案 | 演进路径 | 触发条件 |
| --- | --- | --- | --- |
| 数据存储 | JSON 文件 | 替换 DataStore 底层为 SQLite（better-sqlite3），接口不变 | 题库 > 2000 题或并发写显著增加 |
| 前端框架 | 原生 JS | 迁移 Vue3/React（API 契约已稳定，仅替换渲染层） | 页面交互复杂度上升 |
| 组卷 | 固定卷 | 按分类/难度/知识点权重随机组卷（P1） | v1.1 |
| 防作弊 | 本地会话 + 确认提示 | 服务端会话 + 答案加密传输 + 断点恢复 | v1.1（F3.8） |
| 内容管理 | 种子 JSON + seed 脚本 | 管理后台接口/页面（需鉴权） | v2.0（F6.3） |
| 部署 | 单机 node | Docker 化 + 反向代理（nginx） | 有公网部署需求 |

---

## 9. 开发与运行指引（供前后端工程师）

```bash
cd D:\Felix\project\oi-exam-practice
npm install          # 安装 express / jsonwebtoken / bcryptjs
npm run seed         # 导入种子题库（可重复执行，幂等；会生成 data/*.json）
npm run dev          # 启动开发服务（Node watch 模式，默认端口 3000）
# 浏览器打开 http://localhost:3000
```

- 环境变量：`PORT`（默认 3000）、`JWT_SECRET`（默认 dev 密钥，生产必须覆盖）。
- 前后端联调顺序建议：后端先完成 §6 全部接口 + seed → 前端按页面清单逐页接入 → reviewer 按 PRD §6 DoD 验收。
- 单元测试：`npm test` 覆盖 grader 与错题本状态机（判分/移出规则是核心业务逻辑）。

---

*本文档与 `docs/ui-design.md`（UI 设计规范）配套使用；接口字段命名统一 camelCase（JSON 传输），前端展示时转换。*
