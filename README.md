# OI练习 · 信息学竞赛笔试刷题平台

面向**所有信息学竞赛笔试**选手的轻量刷题网站（CSP-J/S、NOIP 初赛、蓝桥杯、省市校级比赛等）：题库浏览与分类筛选、四类笔试题型即时判分、限时模拟考试、错题本自动沉淀与重练移出、学习统计。

> 非 OJ 编程评测平台：本平台不编译、不运行代码，只做**笔试题的作答、判分与解析**。

---

## 功能特性

- **用户系统**：注册 / 登录 / 退出（JWT 鉴权、密码 bcrypt 哈希、登录态持久化）；未登录可浏览题库，练习/模拟考/错题本/统计需登录。
- **题库浏览与分类**：竞赛类型（8 项，数据配置驱动、可扩展）+ 知识点分类（7 类）+ 题型（4 种）+ 难度 + 关键词搜索，可组合筛选、分页展示。
- **练习模式**：单选 / 多选 / 判断 / 阅读程序四种题型全部支持；提交即时判分（多选全对才得分、阅读题各子题独立判分）、即时显示对错与解析；答错自动写入错题本。
- **模拟考试**：按竞赛类型选择模拟卷，限时作答 + 答题卡导航 + 倒计时自动交卷；考试期间不显示答案与解析；交卷后统一出成绩报告（总分/得分率/分类与题型得分/逐题对错与解析），错题自动沉淀。
- **错题本**：错题列表（时间倒序、含错选答案与正确思路摘要）；单题/全部重练，连续答对 2 次自动移出，支持手动移除与分类排行。
- **学习统计**：总刷题数 / 总正确率 / 练习时长 / 模拟考次数概览，分类与题型正确率条形图，薄弱分类（<60%）高亮并一键跳转针对性练习。
- **演示模式兜底**：前端在真实后端 API 不可用时自动降级为本地演示模式（MockBackend + localStorage），便于纯静态预览。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | 原生 HTML5 + CSS3 + 原生 JavaScript（ES Modules），hash 路由单页应用，零构建、零运行时依赖 |
| 后端 | Node.js（≥18）+ Express 4 |
| 数据存储 | JSON 文件存储（自封装 DataStore：内存缓存 + 原子落盘），题库与代码分离 |
| 认证 | jsonwebtoken（JWT，7 天有效期）+ bcryptjs 密码哈希 |
| 测试 | Node 内置 test runner（单元测试）+ 自研冒烟/集成脚本 |

## 目录结构

```
oi-exam-practice/
├── package.json            # 依赖与脚本（start/dev/test/smoke）
├── README.md               # 本文档
├── docs/                   # 项目文档（PRD / 架构 / UI / 数据模型 / 测试报告 / 交付总结）
│   ├── requirements.md     # 产品需求文档（PRD）
│   ├── architecture.md     # 技术架构设计
│   ├── ui-design.md        # UI/UX 设计规范与页面线框
│   ├── data-model.md       # 题库数据结构设计
│   ├── test-report.md      # 集成联调与测试验收报告
│   └── summary.md          # 交付总结
├── data/                   # 数据文件（即"数据库"）
│   ├── questions.json      # 种子题库（26 题，CSP-J/S 与 NOIP 风格）
│   ├── questions-extra.json# 扩展题库（13 题，蓝桥杯/省市校级等）
│   ├── exams.json          # 模拟卷（5 套，含 6 秒自动交卷测试卷）
│   └── users.json / answers.json / wrong-book.json /
│       exam-results.json / exam-sessions.json   # 运行时生成（可删除重置）
├── public/                 # 前端静态资源（Express 托管）
│   ├── index.html          # SPA 唯一入口
│   ├── css/                # base.css（设计令牌） + main.css（组件/页面样式）
│   └── js/                 # app.js 路由入口、api.js、components.js、
│                           # pages/（首页/练习/考试/错题本/统计/登录注册等）
├── server/                 # 后端（Node.js + Express）
│   ├── index.js / app.js   # 入口与应用组装
│   ├── config.js           # 端口、JWT、分页、枚举等配置
│   ├── middleware/         # auth（JWT 鉴权）/ error（统一错误响应）
│   ├── routes/             # auth / meta / questions / practice / exams /
│   │                       # wrong-book / stats + helpers
│   ├── services/           # grader（判分核心）/ wrong-book-service（错题状态机）
│   ├── store/              # datastore（JSON 存储）/ collections（集合封装）
│   ├── utils/              # id / jwt / password
│   └── __tests__/          # 判分单元测试
└── scripts/                # smoke.js（后端冒烟）、smoke-frontend.mjs（mock 冒烟）、
                            # render-test.mjs / e2e-real.mjs（jsdom 集成测试）、preview.mjs
```

## 快速开始

前置要求：**Node.js ≥ 18**（开发验证环境为 Node 24）。

```bash
# 1. 安装依赖（express / jsonwebtoken / bcryptjs，无原生编译依赖）
npm install

# 2. 启动后端（同时托管前端页面，默认端口 3000）
npm start

# 3. 浏览器访问
#    http://localhost:3000
```

开发模式（Node watch 热重启）：

```bash
npm run dev
```

常用脚本：

| 命令 | 说明 |
| --- | --- |
| `npm start` | 启动服务（生产/本地） |
| `npm run dev` | watch 模式开发启动 |
| `npm test` | 判分核心单元测试（9 项） |
| `npm run smoke` | 后端接口冒烟测试（**需先启动服务**，60 项） |
| `node scripts/smoke-frontend.mjs` | 前端 mock 模式数据流冒烟（34 项） |
| `node scripts/render-test.mjs` | jsdom 前端渲染集成测试（26 项，需临时安装 jsdom，见脚本头注释） |
| `node scripts/e2e-real.mjs` | jsdom 前端 × 真实后端 E2E（21 项，需先启动服务 + jsdom） |

### 数据说明

- 题库与试卷直接读取 `data/questions.json` + `data/questions-extra.json`（启动时按 `id` 去重合并）与 `data/exams.json`，**扩充题库只需向数据文件追加题目**，无需改代码。
- `data/users.json`、`answers.json`、`wrong-book.json`、`exam-results.json`、`exam-sessions.json` 由运行时自动生成/写入；想重置环境删除这些文件即可。
- 竞赛类型为**通用可扩展枚举**：在数据文件顶层 `competition_types` 追加一条记录并引用其 id，筛选标签与模拟卷入口即自动出现（元数据接口驱动，无需改前端）。

## 使用说明

1. **注册/登录**：点击右上角"注册"创建账号（用户名 3~20 位字母数字下划线、密码 ≥ 6 位），注册即登录；未登录也可浏览题库。
2. **刷题**：首页按竞赛类型 / 知识点 / 题型 / 难度筛选（可组合），点"开始练习"逐题作答；提交后即时显示对错与解析，答错自动进入错题本。
3. **模拟考**：模拟考页选择卷子 → 确认规则（时长/题量/未答计错）→ 限时作答（答题卡可跳题）→ 交卷（二次确认，超时自动交卷）→ 查看成绩报告，错题自动沉淀。
4. **错题本**：查看错题（含你的答案与正确思路）→ 单题或全部重练 → 连续答对 2 次自动移出；也可手动移除。
5. **统计**：查看总刷题数/正确率/时长/模拟考次数与分类/题型正确率，点击薄弱分类直达针对性练习。

## 与设计文档的差异说明

- 前端目录采用 **`public/`**（架构文档规划的 `web/` 未采用；`server/config.js` 会自动回退探测两者）。
- 架构文档中的 `npm run seed` 导入脚本**未实现**：题库数据已就绪并直接由服务启动时加载（按 id 去重合并，等效幂等导入）。
- 考试会话（防刷新恢复）为 **P0 本地方案**：答案存于浏览器 localStorage，服务端会话仅记录开始时间与状态（服务端会话恢复为 v1.1 项，见架构文档 §5.6）。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/requirements.md](docs/requirements.md) | 产品需求文档（功能范围、验收标准 DoD） |
| [docs/architecture.md](docs/architecture.md) | 技术架构设计（数据流、API 契约、权限矩阵） |
| [docs/ui-design.md](docs/ui-design.md) | UI/UX 设计规范与页面线框 |
| [docs/data-model.md](docs/data-model.md) | 题库数据结构设计（字段/枚举/判分规则） |
| [docs/test-report.md](docs/test-report.md) | 集成联调与测试验收报告（163+ 项检查、已修复缺陷、遗留问题） |
| [docs/summary.md](docs/summary.md) | 交付总结（协作过程、完成情况、已知限制、迭代建议） |

---

© 2024 OI练习 · 备考各类信息学竞赛笔试 · 题库持续扩充
