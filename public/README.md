# 前端（public/）说明

信息学竞赛笔试练习网站前端：**原生 HTML + CSS + 原生 JavaScript（ES Modules）**，零构建、hash 路由单页应用。Markdown/LaTeX 渲染依赖**本地 vendor/kaTeX**（零 CDN）。

## 目录结构

```
public/
├── index.html          # SPA 唯一入口（引入 KaTeX CSS/JS）
├── README.md           # 本文档
├── css/
│   ├── base.css        # 设计令牌（CSS 变量，规范：docs/ui-design.md §2）+ 重置
│   └── main.css        # 布局 / 组件 / 页面样式（深色科技风，响应式，含 KaTeX 适配）
├── vendor/
│   └── katex/          # KaTeX 本地构建（katex.min.css / katex.min.js / katex.mjs + fonts/，npm run katex:vendor 重新生成）
└── js/
    ├── app.js          # 入口：hash 路由表 + 鉴权守卫 + 导航/页脚
    ├── api.js          # fetch 封装（JWT 注入、统一错误处理、演示模式降级）
    ├── mock.js         # 本地演示模式后端（无后端时的兜底，数据存 localStorage）
    ├── mock-data.js    # 演示数据（由 data/questions.json 自动生成，勿手改）
    ├── utils.js        # 工具函数（Markdown/LaTeX 渲染、格式化、防抖等）
    ├── components.js   # 全局组件：Toast / Modal / 倒计时 / 答题卡 / 题目卡片
    └── pages/
        ├── home.js         # P1 题库浏览（竞赛/知识点/题型/难度筛选 + 搜索 + 分页）
        ├── practice.js     # P2 练习答题（即时判分 + 解析 + 会话小结）
        ├── exam.js         # P3 模拟考列表 / P4 考试页 / P5 成绩报告
        ├── wrong-book.js   # P6 错题本 / P7 错题重练
        ├── stats.js        # P8 学习统计（概览卡 + 分类/题型条形图）
        └── auth.js         # P9 登录 / P10 注册 / P11 个人中心
```

## Markdown / LaTeX 支持语法

题目题干（`stem`）、解析（`analysis`）、子题内容统一由 `js/utils.js` 的 `renderMarkdown` 渲染；**选项文本（`options[].text`）由 `renderInline` 渲染**（同样的公式/行内 Markdown 语法，但不做块级包装，保证 `<span>` 内 DOM 合法），支持：

| 语法 | 说明 |
| --- | --- |
| `$...$` | **行内 LaTeX 公式**（如 `$O(n\log n)$` → O(n log n)） |
| `$$...$$` | **块级 LaTeX 公式**（居中显示，如 `$$\frac{1}{2}$$`） |
| `` ```lang ... ``` `` | 代码块（阅读程序题；块内公式/标记不解析） |
| `` `code` `` | 行内代码 |
| `**加粗**` / `*斜体*` / `~~删除线~~` | 强调样式 |
| `#` `##` `###` | 标题 |
| `- 项` / `1. 项` | 无序 / 有序列表 |
| `[文字](url)` | 链接（仅 http(s) / 相对路径 / `#/` 路由，防伪协议） |
| 换行 | 分段（每行一个 `<p>`） |

**安全**：所有 Markdown 文本先经 `escapeHtml` 转义再加工，不渲染原始 HTML（防 XSS）；LaTeX 内容在转义前提取并交给 KaTeX 渲染（KaTeX 输出为安全 HTML）。公式渲染失败或 KaTeX 未加载时降级为转义原文显示（`.katex-fallback`）。

**KaTeX 本地化**（零 CDN）：`index.html` 引入 `vendor/katex/katex.min.css`（字体相对路径 `fonts/` 与 CSS 同级）与 `katex.min.js`（提供 `window.katex` 兜底）；`utils.js` 通过 ESM 导入 `vendor/katex/katex.mjs` 渲染。深色主题下公式颜色随 `--text-main`，块级公式居中、长公式横向滚动。

## 如何启动

### 方式一：纯前端静态预览（推荐先看效果）

```bash
cd D:\Felix\project\oi-exam-practice
node scripts/preview.mjs        # 默认端口 4173
# 浏览器打开 http://localhost:4173
```

没有后端时，前端自动进入**本地演示模式**（`js/mock.js`）：

- 注册/登录（登录标识为**邮箱**，内置演示账号 `demo@example.com` / `123456`，登录页有提示）；
- 注册字段：邮箱（登录账号）+ 昵称（显示名）+ 密码 + 确认密码；
- 题库筛选、练习判分、模拟考试（限时/答题卡/成绩报告）、错题本、统计全部可用；
- 数据持久化在浏览器 `localStorage`（key：`oi_mock_db`），刷新不丢。

> 注意：演示模式仅用于预览与联调，正式数据以真实后端为准。

### 方式二：与真实后端联调

后端（`server/`，见 `docs/architecture.md` §9）启动后：

1. Express 将 `public/` 作为静态资源目录托管（`app.use(express.static('public'))`），并实现 `docs/architecture.md` §6 的全部 `/api/*` 接口；
2. 直接访问后端地址（默认 `http://localhost:3000`）；
3. `js/api.js` 会**优先请求 `/api/*`**；请求失败（网络错误/非 JSON 响应）才自动降级演示模式。

## 与后端对接的 API 约定（前端按此实现）

| 前端调用 | 后端接口（docs/architecture.md §6） |
| --- | --- |
| `GET /api/questions` | 题库列表/筛选：`competition`、`category`、`type`、`difficulty`、`keyword`、`page`、`pageSize` |
| `GET /api/questions/:id` | 题目详情；练习模式带 `?withAnswer=1`（需登录返回答案） |
| `POST /api/practice/submit` | 练习判分 `{questionId, answer}` → `{isCorrect, score, correctAnswer, analysis}` |
| `GET /api/exams` · `GET /api/exams/:id` | 模拟卷列表/详情（详情仅返回卷元信息 + 规则，题目由 start 下发） |
| `POST /api/exams/:id/start` | 开始考试 → `{sessionId, startedAt, questions}`（题目**不含 answer/analysis**） |
| `POST /api/exams/session/:sid/submit` | 交卷 `{answers, auto}` → `{resultId, score, total, rate, detail}` |
| `GET /api/exams/results/:resultId` | 成绩报告（逐题对错 + 解析） |
| `GET /api/wrong-book` | 错题列表；`POST /api/wrong-book/review` 重练；`DELETE /api/wrong-book/:questionId` 移除 |
| `GET /api/stats/overview` · `categories` · `types` | 学习统计 |
| `POST /api/auth/register` | 注册（Supabase Auth 代理）：`{email, username, password, confirmPassword}` → `{token, user:{id, username, email}}`，注册即登录 |
| `POST /api/auth/login` | 登录：`{email, password}` → `{token, user:{id, username, email}}`（登录标识为**邮箱**；失败统一 401 提示"用户名或密码错误"） |
| `GET /api/auth/me` | 当前用户 `{id, username, email}`（JWT 存 `localStorage.oi_token`，请求头 `Authorization: Bearer <token>` 不变） |

**多选筛选约定**：知识点 `category` 与题型 `type` 支持多选，前端以逗号拼接传参（如 `category=math,algorithm`、`type=single,judge`），请后端兼容逗号分隔解析（或先支持单值，前端多选功能依赖此项）。

**竞赛类型参数**：使用数据配置中的 id（如 `csp-j` / `csp-s` / `noip` / `lanqiao` 等，见 `data/questions.json` 顶层 `competition_types`），展示名由前端 `utils.js` 的 `META.competitions` 映射；新增竞赛类型只需扩展该配置数据。

**难度参数**：使用 `beginner / intermediate / advanced`（与 `data/questions.json` 一致）；若后端按架构文档采用 `1/2/3`，在 `mock.js` 中已做兼容映射，前端传值可保持不变（字符串）或由后端兼容两种。

**答案形态**（`answer` 数组）：
- 单选 `["B"]`、判断 `[true]` / `[false]`、多选 `["A","C"]`（集合相等判分）；
- 阅读程序 `[["B"], [true]]`（子题答案数组的数组，子题仅单选/判断）。

## 路由清单

| 路由 | 页面 | 登录 |
| --- | --- | --- |
| `#/` | 题库浏览 | 匿名可看，答题需登录 |
| `#/practice` | 练习答题（支持 `?ids=` 单题、筛选参数） | 需登录 |
| `#/exams` | 模拟考列表 | 需登录 |
| `#/exam/:id` | 模拟考试（全屏） | 需登录 |
| `#/exam/:id/result?resultId=` | 成绩报告 | 需登录 |
| `#/wrong-book` | 错题本 | 需登录 |
| `#/wrong-book/review` | 错题重练 | 需登录 |
| `#/stats` | 学习统计 | 需登录 |
| `#/login` · `#/register` | 登录 / 注册（登录后回跳 redirect） | 匿名 |
| `#/profile` | 个人中心 | 需登录 |
| `#/about` | 关于/帮助 | 匿名 |

## 测试

项目提供两套零业务依赖的验证脚本（无需安装任何 npm 包即可运行逻辑测试）：

```bash
node scripts/smoke-frontend.mjs   # 逻辑冒烟测试：mock 后端全数据流（注册/筛选/判分/考试/错题/统计/Markdown），50 项断言
```

页面渲染集成测试（jsdom，需临时安装到系统临时目录，**不进入项目依赖**）：

```bash
npm install jsdom --prefix $env:TEMP\oi-jsdom-test --cache $env:TEMP\oi-jsdom-test\.npm-cache
Copy-Item scripts\render-test.mjs $env:TEMP\oi-jsdom-test\
node $env:TEMP\oi-jsdom-test\render-test.mjs   # 35 项断言：首页→登录→练习→模拟考→错题本→统计→LaTeX
```

## 设计规范落地

- 全部颜色/字体/间距使用 `css/base.css` 中的 CSS 变量，无硬编码色值（ui-design.md §8 验收）；
- 四种题型（单选/多选/判断/阅读程序）在练习与考试模式均正确呈现；
- 练习提交 1 秒内展示对错反馈（绿框✓/红框✗ + 解析区，图标+文字双重编码）；
- 考试页全屏、无导航、无答案/解析，答题卡蓝/橙/青状态，倒计时最后 5 分钟橙色、1 分钟红色脉冲，到时自动交卷；
- 错题重练连续答对 2 次自动移出并 toast 提示；
- 移动端（<768px）单列流式，考试答题卡收为底部抽屉。
