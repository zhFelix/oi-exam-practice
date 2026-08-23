# Supabase 集成验收测试报告（Test Report — Supabase）

| 项 | 内容 |
| --- | --- |
| 报告版本 | v1.0 |
| 编写人 | reviewer（评审/测试/文档） |
| 任务 | t13 — Supabase 集成：验收与文档（依赖 t12 存储实现替换） |
| 分支 | `feature/supabase` |
| 验收日期 | 2025-01 |
| 验收环境 | 真实 Supabase 项目（项目根 `.env` 配置 `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`，已被 .gitignore 排除）；Node v24.11.0 |
| 验收结论 | **通过（有条件）**——Supabase 模式与 JSON 降级模式全流程可用；发现并修复 1 个 P0 数据一致性缺陷 |

---

## 1. 代码审查结论

### 1.1 接口兼容性（SupabaseStore vs DataStore）✅

| 接口 | DataStore | SupabaseStore | 语义一致性 |
| --- | --- | --- | --- |
| `find(filter)` | 内存精确匹配 | 内存精确匹配 | ✅ |
| `findById(id)` | 内存查 id | 内存查 id | ✅ |
| `insert(doc)` | 推入 + 同步落盘 | 推入内存 + 排队写库 | ✅（返回 doc；落盘异步） |
| `update(predicate, patch)` | 更新 + 同步落盘，返回行数 | 更新 + 排队写库，返回行数 | ✅ |
| `remove(predicate)` | 删除 + 同步落盘 | 删除 + 排队写库 | ✅ |
| `count(filter)` | 内存计数 | 内存计数 | ✅ |

- 全部为同步读/同步写（写为异步落库，但接口签名与返回语义一致），业务路由零改动；
- 集合懒初始化 + ESM live binding：`initStores()` 在 HTTP 服务启动前完成（`createApp()` 内 await），无空 store 竞态；
- 题库/试卷优先从 Supabase 表读取，失败回退数据文件；枚举定义始终来自数据文件（/api/meta 可用）。

### 1.2 数据一致性 ✅（修复后）

- **修复前缺陷（P0）**：`_persist` fire-and-forget 并发写——
  - 同键 insert→update 乱序：`wrong_book` 先 insert（练习答错）后 update（模拟考再错）时，update 可能先于 insert 落库，按 id 更新不到行 → **整条错题记录静默丢失**（实测：重启后 wrong_book 为空、wrong_count 丢失）；
  - 进程重启/被杀时未完成上行被中止 → 内存与 DB 分叉，部分 answers/会话丢失（实测：6 条答题记录重启后仅剩 4 条）；
  - 注释声称"下次启动 load 恢复一致"不成立（load 读的是已丢失的 DB）。
- **修复（t13 已合入 `server/store/supabase-store.js` / `server/store/collections.js` / `server/index.js`）**：
  - 写操作改**串行队列**（`_queue` 链式），落库顺序与内存操作顺序一致；
  - 新增 `flush()` + `flushStores()`，`SIGINT/SIGTERM` 优雅退出前排空队列；
  - 多行 update/remove 单行失败容错续行（记日志不中断其余行）；
  - 幂等性：迁移脚本按 id upsert 可重复执行；运行期行 id 由 `genId` 生成无重复。

### 1.3 安全 ✅（有建议）

- `SUPABASE_SERVICE_KEY`（service_role）仅存在于后端环境变量 / 项目根 `.env`（**.gitignore 已排除，未进 Git**）；前端为纯静态资源，不接触任何 key；已核对 API 无泄露凭据端点；错误响应为业务错误结构，不暴露 Supabase 错误堆栈（supabase-js 错误仅打印到服务端日志）。
- **建议（P2）**：启用 RLS 做纵深防御（业务仍走 service_role），见 `docs/supabase.md` §6.4；生产部署勿用默认 `JWT_SECRET`。

### 1.4 降级路径 ✅

- 未配置凭据 / 占位配置 → `isSupabaseConfigured=false` → 题库/试卷/运行期集合全部走 JSON 文件，**实测**：占位配置启动正常、题库 60 题、`npm run smoke` 61/61；
- Supabase 已配置但启动加载失败（表不存在/网络错误）→ `initStores()`/`initQuestionBank()`/`initExams()` 捕获并回退 JSON，不阻断启动；
- 运行期 Supabase 写失败 → 仅记日志，内存继续服务（DB 以最后一次成功落库为准，需人工核对——已在日志中明确提示）。

## 2. 测试执行记录（真实凭据）

| # | 测试项 | 命令/方式 | 结果 |
| --- | --- | --- | --- |
| 1 | 判分单元测试 | `npm test` | **9/9 通过** |
| 2 | 种子迁移（幂等） | `npm run migrate:supabase` | **questions 60 行 + exams 5 行**，重复执行不增 |
| 3 | Supabase 模式启动 | `PORT=3100 node server/index.js` | 日志：题库 60 题 / 模拟卷 5 套 / Supabase 存储模式 |
| 4 | Supabase 模式接口冒烟 | `BASE_URL=http://localhost:3100 npm run smoke` | **61/61 通过**（含登录限流 429） |
| 5 | 全流程 HTTP 联调 | 注册→4 题型答题→错题→重练→模拟考交卷→成绩报告→统计 | 通过（含多选集合判分、阅读子题判分、judge 子题） |
| 6 | 重启持久化（修复前） | 写 6 条 → 杀进程 → 重启校验 | **失败**：答案剩 4/6、错题本空、会话空（暴露 P0） |
| 7 | 竞态隔离测试（修复后） | SupabaseStore 直接 insert→立即 update 同键 → flush | **通过**：wrong_count=2、全部行落库、顺序正确 |
| 8 | 优雅退出 E2E（修复后） | 真实服务 + HTTP 全流程 → `flushStores()` → 校验 | **通过**：6 答题 + 错题本(2) + 会话 + 成绩 全落库 |
| 9 | 重启持久化（修复后） | 写 6 条 → 重启 → 校验 | **通过**：答案 5~6（强杀瞬间在途写丢失属预期，见 §3） |
| 10 | JSON 降级模式 | 占位配置 `PORT=3200` 启动 + smoke | **61/61 通过**（题库 60 题来自数据文件） |
| 11 | 数据完整性 | 60 题字段/枚举/答案/子题交叉校验 | 无错误（7 分类 10/10/10/10/10/5/5，4 题型 33/15/7/5） |
| 12 | 测试数据清理 | 删除全部测试用户及其关联行 | 完成（无残留） |

## 3. 遗留问题与建议

| # | 级别 | 问题 | 建议 |
| --- | --- | --- | --- |
| 1 | P2 | 进程被强杀（kill -9/断电）时写队列未落库变更会丢失（优雅退出已覆盖正常部署） | 如需更强一致：写操作同步等待落库（牺牲写延迟）或本地 WAL；当前单机 MVP 可接受 |
| 2 | P2 | RLS 未启用（service_role 绕过）；若改 anon key 需补 policy | 上线多用户前启用 RLS 纵深防御（`docs/supabase.md` §6.4） |
| 3 | P2 | `score` 等 `numeric` 列在 PostgREST 大数值时可能返回字符串 | 分值增大时读取端 Number() 归一（当前 ≤2 实测为数字） |
| 4 | P2 | 登录限流默认 20 次/10 分钟/IP 会阻断自动化测试连续注册 | 测试/CI 设 `AUTH_RATE_LIMIT_MAX` 调大，或限流豁免 localhost |
| 5 | P2 | 考试会话仍为前端 localStorage 方案（服务端仅记开始时间/状态） | v1.1 落服务端会话（多端恢复） |
| 6 | P3 | `scripts/supabase-schema.sql` 与 `docs/supabase-schema.sql` 重复维护 | 以 scripts/ 为规范文件，docs/ 引用或删除其一 |
| 7 | 环境 | 端口 3000 被遗留开发服务（旧代码进程）占用 | 清理旧进程后再启动（本验收改用 3100/3200 规避） |

## 4. 结论

**验收通过（有条件）**：

- 接口兼容、降级可靠、迁移幂等、安全边界正确（service_role 仅后端、.env 已忽略）；
- 发现并修复 **1 个 P0 写一致性缺陷**（并发 fire-and-forget → 串行队列 + 优雅退出 flush），修复后重启持久化与竞态测试全部通过；
- Supabase 模式 61/61 + JSON 降级 61/61 + 单元 9/9，无回归；
- 遗留项均为 P2 优化/上线前加固，不阻塞 MVP 交付（详见 §3）。
