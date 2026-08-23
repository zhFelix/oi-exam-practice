# 集成联调与测试验收报告（Test Report）

| 项 | 内容 |
| --- | --- |
| 报告版本 | v1.0 |
| 编写人 | reviewer（评审/测试/文档） |
| 验收对象 | 信息学竞赛笔试题目练习网站（CSP-J/S、NOIP、蓝桥杯等）MVP |
| 项目目录 | `D:\Felix\project\oi-exam-practice` |
| 验收日期 | 2025-01（本次联调） |
| 测试方式 | 单元测试 + 后端接口冒烟 + API 契约测试 + 前端 × 真实后端 E2E（jsdom）+ mock 模式回归 |

---

## 1. 测试环境

| 项 | 值 |
| --- | --- |
| Node.js | v24.11.0（≥18 满足） |
| 后端 | `npm start` → http://localhost:3000（Express 4.19） |
| 前端 | 原生 HTML/CSS/JS，hash 路由单页应用（public/，由 Express 托管） |
| 数据 | data/questions.json（26 题）+ questions-extra.json（13 题）= 39 题；exams.json 5 套卷 |
| 浏览器验证 | 本会话 GUI 浏览器禁止访问 localhost，改用 jsdom + 真实后端联调（等价覆盖渲染与交互路径） |

## 2. 测试执行清单与结果汇总

| # | 测试套件 | 执行方式 | 结果 |
| --- | --- | --- | --- |
| 1 | 判分核心单元测试 | `npm test`（server/__tests__/grader.test.js） | **9/9 通过** |
| 2 | 后端接口冒烟 | `npm run smoke`（scripts/smoke.js，真实 HTTP） | **60/60 通过**（含超时自动交卷 6 秒卷） |
| 3 | API 契约测试（本报告新增） | Node fetch 直连：题库列表/筛选/详情、注册登录、4 题型判分、错题本状态机、模拟考全流程、统计、分页、鉴权矩阵 | **约 50 项通过**（详见 §3） |
| 4 | 成绩报告契约测试（本报告新增） | 交卷 → 成绩报告逐字段校验（阅读子题、你的答案、分类/题型聚合、得分合计） | **13/13 通过** |
| 5 | 前端 mock 模式冒烟 | `node scripts/smoke-frontend.mjs`（MockBackend 数据流） | **34/34 通过** |
| 6 | 前端渲染集成（mock） | `node scripts/render-test.mjs`（jsdom 全流程） | **26/26 通过** |
| 7 | 前端 × 真实后端 E2E（本报告新增） | `node %TEMP%\oi-jsdom-test\e2e-real.mjs`（jsdom + fetch→真实后端，覆盖首页/登录态/4 题型练习判分反馈/错题本/模拟考交卷/成绩报告/统计） | **21/21 通过** |
| 8 | 数据完整性校验（本报告新增） | 39 题 × 字段/枚举/答案格式/子题/试卷引用交叉校验 | **无错误** |

**合计：≥ 163 项自动化检查全部通过（修复后）。**

## 3. 验收标准覆盖（对照 PRD §6 DoD）

### 全局标准
- [x] 关键操作有加载态（骨架屏/按钮 loading）与错误提示（Toast/错误态）。
- [x] 刷新后登录态保持（`GET /api/auth/me` 恢复）；未登录访问受保护页跳登录并回跳（路由守卫 + 后端 401 双重保障）。

### F0 用户系统
- [x] 重名注册 409 `USERNAME_TAKEN` 明确提示且不创建账号。
- [x] 密码 ≥ 6 位；登录失败统一 401 `BAD_CREDENTIALS`（不区分用户名/密码）。
- [x] 退出后受保护页不可访问（token 清除 + 路由守卫）。

### F1 题库浏览与分类
- [x] 竞赛类型（8 项，元数据接口 `/api/meta/competition-types` 动态渲染）/ 7 类知识点 / 4 种题型筛选独立且可组合；非法竞赛类型 400 `INVALID_COMPETITION`。
- [x] 筛选结果与总数一致；分页默认 20 条、上限 50。
- [x] 种子题库 39 题覆盖 7 分类 × 4 题型 × 8 竞赛类型（≥3 满足），全部含解析与难度。
- [~] 竞赛类型可扩展性：枚举为数据配置驱动（新增类型仅改 data 文件）——代码层面已支持，未做"新增类型"实机演示。

### F2 练习模式
- [x] 四类题型均可作答提交；单选/判断唯一匹配、多选**集合完全相等才得分**（少选/多选/错选均 0 分、顺序无关）、阅读程序**子题独立判分**（得分累加）。
- [x] 提交后即时显示对/错、正确答案、解析（修复后 1 秒内，见 §4 Bug-2/3）。
- [x] 答错自动写入错题本（含用户作答），错题本可见。

### F3 模拟考试
- [x] 5 套模拟卷（CSP-J/CSP-S/NOIP/蓝桥杯 + 6 秒自动交卷测试卷），按竞赛类型筛选。
- [x] 限时考试：倒计时显示、归零自动交卷（测试卷实测 `auto=true` 按已答计分）。
- [x] 考试纪律：开始考试返回题目**不含 answer/analysis**，考试页无对错反馈（E2E 断言通过）。
- [x] 答题卡已答/未答标记、题号跳转、手动交卷二次确认。
- [x] 成绩报告：总分/得分率/分类/题型得分/逐题对错与解析；错题自动入错题本。
- [x] 重复交卷 409、未开始交卷 400、越权查看他人成绩 403。

### F4 错题本
- [x] 练习与模拟考错题自动入本（含错选答案）；重练连对 2 次自动移出（状态机实测），手动移除 204。
- [x] 错题分类排行 `/api/wrong-book/stats` 可用（P1 项已实现）。

### F5 学习统计
- [x] 总刷题数/总正确率/练习时长/模拟考次数实时聚合，与 answers/exam-results 记录一致（E2E 实测）。
- [x] 分类（7 类）与题型（4 种）正确率条形图；薄弱分类（<60%）橙色高亮可点击跳转题库。

### F6 数据与内容
- [x] 种子题库 39 题 ≥ 60 题目标未达成（见 §5 遗留问题 1）；两数据文件合并导入按 id 去重，无重复。
- [x] 竞赛类型为数据配置驱动（代码无硬编码枚举，白名单校验动态读取）。

### 安全审查（代码走查）
- [x] **XSS**：所有用户/题库文本渲染均经 `escapeHtml` / `renderMarkdown`（先转义后渲染代码块），选项 key/text、题干、解析、错误信息均转义；未发现 innerHTML 直插未转义数据。
- [x] 密码 bcryptjs 哈希存储，绝不明文；JWT 7 天有效期；统一错误响应不泄露堆栈。
- [~] 默认 JWT_SECRET 为开发密钥（config.js 注释要求生产覆盖）；无登录频率限制（单机 MVP 可接受，见 §5）。

## 4. 发现并修复的问题（本验收直接修复）

| # | 级别 | 位置 | 问题描述 | 修复 |
| --- | --- | --- | --- | --- |
| 1 | **P0** | public/js/api.js | GET 请求把 `body: "null"`（JSON.stringify(null)）传给 fetch，触发 Fetch 规范 TypeError（"Request with GET/HEAD method cannot have body"）——**真实浏览器中所有 GET 请求必失败，前端会永远降级到 mock 演示模式**（此前所有前端验证均在 mock 模式下进行，掩盖了此问题） | GET/HEAD 不传 body |
| 2 | **P0** | server/routes/practice.js、wrong-book.js | `correctAnswer` 返回标量（单选 `"A"`、判断 `true`、阅读 `["B",true]`），而架构文档 §6.3 约定数组形态 `["C"]`，前端 `showFeedback` 执行 `correctAnswer.map(...)` 直接 TypeError——**练习模式判分反馈对单选/判断/阅读程序题全部崩溃**（仅多选正常） | 新增 `toApiCorrectAnswer()` 统一归一为数组形态（单选 `["A"]`、判断 `[true]`、阅读 `[["B"],[true]]`），practice 与 wrong-book/review 响应均使用 |
| 3 | **P0** | server/services/grader.js | `normBoolean` 不拆解数组，阅读程序题的 judge 子题（前端按 `[true]` 提交）被判为 null → **3 道阅读题的判断题子题永远判错**（练习与模拟考均受影响） | `normBoolean` 支持单元素数组解包 |
| 4 | **P0** | server/routes/exams.js | 成绩报告接口 `perQuestion` 嵌在 `detail` 内且缺 `yourAnswer`、阅读子题缺 stem/analysis、judge 的 `correctAnswer` 为标量 → 前端成绩报告页 `r.perQuestion.filter` 抛 TypeError，**交卷后成绩报告页必然报错无法展示** | 结果接口顶层返回 `perQuestion`；逐题行补 `yourAnswer`；阅读子题改 `sub`（含 stem/yourAnswer/correctAnswer/analysis）；`byCategory/byType` 补 `total` 分值口径 |
| 5 | **P1** | public/js/components.js | 真实后端返回 `subQuestions`（camelCase），前端读 `q.sub_questions`（mock 返回 snake_case）→ 阅读程序题渲染失败（"加载题目失败"） | 兼容两种字段名 |
| 6 | **P1** | public/js/pages/stats.js | 分类条形图标签取 `x.name`（服务端字段为 `category` id）→ 标签渲染为空；`答/对` 顺序颠倒 | 用 `categoryName(x.category)` 映射显示名，`答 X 对 Y` 修正 |
| 7 | **P1** | scripts/smoke.js | 断言 `correctAnswer === 'B'`（旧标量契约），与文档化数组契约冲突 | 改为 `correctAnswer[0] === 'B'` |
| 8 | **P1** | public/js/pages/exam.js | 成绩报告对判断题 `correctAnswer` 为布尔标量时 `fmtSimpleAnswer` 显示"未作答" | 归一化数组 + 兼容标量 |

> 修复后回归：npm test 9/9、npm run smoke 60/60、mock 冒烟 34/34、mock 渲染 26/26、真实后端 E2E 21/21，全部通过。

## 5. 遗留问题与建议（未修复，反馈给对应工程师/队长）

| # | 级别 | 归属 | 问题 | 建议 |
| --- | --- | --- | --- | --- |
| 1 | P1 | backend-dev（数据） | 种子题库 39 题，未达 PRD F6.1「≥ 60 道」验收线；扩展题库仅覆盖 5/7 知识点分类 | 继续扩充至 ≥ 60 题并补齐全部分类 |
| 2 | P1 | 前后端 | `GET /api/exams/:id` 匿名可返回整卷题目（架构 §6.4 卷详情仅应返回元信息；虽题目本身在题库公开，但考试卷可被预先完整导出） | 卷详情仅返回元信息 + rules，题目由 start 接口下发 |
| 3 | P1 | backend-dev | 试卷元信息 `questionCount`/`totalScore` 由 question_ids 实时计算，exams.json 中冗余的 `total_score` 字段无人消费（易失同步） | 数据冗余字段移除或加导入校验 |
| 4 | P2 | backend-dev | 无登录/接口频率限制；默认 JWT 密钥为开发值 | 生产部署前覆盖 `JWT_SECRET` 并加简单限流 |
| 5 | P2 | backend-dev | `stats/overview` 练习时长：部分记录带 elapsed_seconds 时，无时长记录按 0 计而非按 1 分钟估算（口径不一致） | 统一估算口径 |
| 6 | P2 | frontend-dev | 成绩报告中"未答的阅读程序题"逐题回顾不显示各子题行（仅整题得分）；未答题图标用 ✗ 而非 ○（与 UI 规范 P5 不一致） | 未答阅读题也渲染子题"未作答"行；`answered=false` 显示 ○ |
| 7 | P2 | 全栈 | 考试中刷新恢复依赖 localStorage（服务端会话不含答案），多端/换浏览器丢进度 | v1.1 按架构 §5.6 落服务端会话 |
| 8 | P2 | frontend-dev | 移动端适配与 `prefers-reduced-motion` 降级未验证（jsdom 无法覆盖真实响应式） | 发布前用真实浏览器（Chrome/Edge 桌面 + 移动视口）人工走查 |

## 6. 结论

**验收结论：通过（有条件）**

- 核心 P0 流程（注册登录 → 题库筛选 → 四题型练习即时判分 → 错题本重练移出 → 模拟考限时交卷 → 成绩报告 → 统计）经真实后端联调 **全部可用**；
- 本验收发现并修复 **3 个 P0 + 5 个 P1 集成缺陷**（其中 2 个会导致前端在真实浏览器中整体降级/崩溃），修复后 163+ 项自动化检查全部通过；
- 建议在进入交付前处理 §5 遗留问题 1（题库数量）与 2（考试卷信息泄露面）；其余为二期优化项。
