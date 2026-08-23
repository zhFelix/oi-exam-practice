# 题库数据结构设计文档（Data Model）

| 项 | 内容 |
| --- | --- |
| 文档版本 | v1.2 |
| 编写人 | backend-dev（后端/数据工程师） |
| 依据 | `docs/requirements.md` §7「数据字段要点」（PRD v1.0）+ 需求变更（竞赛类型扩展、题库扩充） |
| 数据文件 | `data/questions.json`（种子题库 26 题）、`data/questions-extra.json`（其他竞赛扩展样例题 34 题） |

> 本文档只描述**题库数据结构与种子数据**，不含后端代码、接口或数据库表实现（由后续后端任务落地）。
> 判分规则以 PRD 为准：单选唯一、多选全对才得分、判断二选一、阅读程序各小题独立判分。

---

## 1. 文件组织

```
oi-exam-practice/
├── docs/
│   ├── requirements.md   # 产品需求文档（PRD）
│   └── data-model.md     # 本文档：题库数据结构设计
└── data/
    ├── questions.json        # 种子题库（主文件，26 题，CSP-J/S 与 NOIP 风格）
    └── questions-extra.json  # 扩展题库（其他竞赛样例题，34 题：蓝桥杯/省市校级/其他）
```

设计原则（对应 PRD §8.4）：**题目数据与代码分离**，题库以纯 JSON 文件承载，后续扩充题库只需追加 `questions` 数组元素，无需改动代码。多个数据文件共用同一数据结构，合并导入时以 `id` 为唯一键去重（§8）。

---

## 2. 顶层结构

`data/questions.json` 顶层为一个对象，包含：元信息、枚举定义、题目数组（`data/questions-extra.json` 为追加题库，复用同一枚举定义，不重复声明枚举）。

```jsonc
{
  "schema_version": "1.0",
  "meta": {
    "name": "信息学竞赛初赛笔试种子题库",
    "description": "CSP-J/S 与 NOIP 初赛笔试风格题目（自编/真题风格改编）",
    "created_at": "2025-01-01",
    "total_questions": 26
  },
  "question_types":      [ { "id": "single", "name": "单选题", ... }, ... ],
  "knowledge_categories":[ { "id": "computer-basics", "name": "计算机基础", ... }, ... ],
  "competition_types":   [ { "id": "csp-j", "name": "CSP-J", ... }, { "id": "lanqiao", ... }, ... ],
  "difficulty_levels":   [ "beginner", "intermediate", "advanced" ],
  "questions": [ ... ]
}
```

- `schema_version`：数据结构版本号，向后兼容扩展时递增。
- `question_types` / `knowledge_categories`：**固定 4 种题型、7 个知识点分类**（与 PRD F1.2/F1.4 一致），前端可直接消费做筛选项；知识点分类对所有竞赛通用，不随竞赛类型扩展而变化。
- `competition_types` / `difficulty_levels`：枚举值字典；其中 `competition_types` 为**通用可扩展枚举**（8 项，见 §5.3），题目上的 `competition_types` 为 id 数组。
- `questions`：题目数组，**每题一个对象**。

---

## 3. 题目对象字段

### 3.1 通用字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | ✅ | 全局唯一题号，如 `q001`；阅读程序小题为 `q021-1` 形式（见 3.4） |
| `type` | string | ✅ | 题型，取 `question_types[].id` 之一：`single` / `multiple` / `judge` / `reading` |
| `knowledge_category` | string | ✅ | 知识点分类，取 `knowledge_categories[].id` 之一（7 类，见 §5） |
| `knowledge_points` | string[] | ✅ | 细粒度知识点标签数组，如 `["进制转换","位权"]`，用于后续搜索/统计 |
| `competition_types` | string[] | ✅ | 适用竞赛类型 id 数组，可多选，取 §5.3 通用枚举（`csp-j`/`csp-s`/`noip`/`lanqiao`/`provincial`/`municipal`/`school`/`other`，可扩展） |
| `difficulty` | string | ✅ | 难度，取 `difficulty_levels` 之一：`beginner`（入门）/ `intermediate`（提高）/ `advanced`（挑战） |
| `source` | string | ✅ | 来源，如 `"自编（真题风格）"`、`"NOIP 初赛真题改编"` |
| `year` | number | 可选 | 来源年份（真题标注），无年份的原创题可省略 |
| `stem` | string | ✅ | 题干，支持 Markdown（含代码块、公式等） |
| `analysis` | string | ✅ | 答案解析（思路 + 结论 + 知识点），练习/考后展示 |
| `created_at` | string | 可选 | 数据录入时间（ISO 8601），默认数据文件生成时间 |

### 3.2 题型相关字段

| 字段 | 类型 | 适用题型 | 说明 |
| --- | --- | --- | --- |
| `options` | array | single / multiple | 选项数组，元素为 `{ "key": "A", "text": "..." }`；single 固定 4 项，multiple 为 4~5 项 |
| `answer` | string / array / boolean | 全部（除 reading 以小题为准） | 正确答案，**按题型变化**（见下表） |
| `code` | string | reading | 阅读程序题的代码块（C/C++ 风格，含 `#include` 与 `main`），前端代码高亮渲染 |
| `sub_questions` | array | reading | 阅读程序题的 1~N 道子小题数组，每道子小题为独立可判分的题目对象 |

### 3.3 `answer` 字段按题型的格式约定

| 题型 | `answer` 格式 | 判分规则（PRD F2.1） |
| --- | --- | --- |
| `single` 单选题 | 字符串，如 `"B"` | 与用户选择**唯一匹配**即得分 |
| `multiple` 多选题 | 字符串数组，如 `["A","B","D"]`（**顺序无关**） | 与正确答案**集合完全相同（全对）**才得分，多选/少选/错选均不得分 |
| `judge` 判断题 | 布尔值：`true` = 正确，`false` = 错误 | 与用户选择匹配即得分；**该题型无 `options` 字段**，前端固定渲染「正确 / 错误」两项 |
| `reading` 阅读程序题 | 子小题答案数组，如 `["B", true]`（冗余字段，见 3.4） | 各子小题**独立判分**，每题 1 分 |

### 3.4 阅读程序题（`reading`）结构

阅读程序题的 `stem` 简述题意，`code` 放完整程序，子小题以 `sub_questions` 内嵌：

```jsonc
{
  "id": "q021",
  "type": "reading",
  "knowledge_category": "reading",
  "stem": "阅读下列 C++ 程序，回答后面的问题。",
  "code": "#include <iostream>...",
  "sub_questions": [
    {
      "id": "q021-1",          // 格式：<父题号>-<序号>，全局唯一
      "type": "single",        // 子小题仅可为 single 或 judge
      "stem": "程序输出的值是（ ）。",
      "options": [ { "key": "A", "text": "45" }, ... ],
      "answer": "B",
      "analysis": "1+2+...+10 = 55。"
    },
    {
      "id": "q021-2",
      "type": "judge",
      "stem": "若将 n 改为 100，输出为 5050。（ ）",
      "answer": true,
      "analysis": "1+2+...+100 = 5050。"
    }
  ],
  "answer": ["B", true],       // 冗余汇总：子小题答案数组，判分以 sub_questions 内 answer 为准
  "analysis": "本题考查循环累加。"
}
```

约束：

- 子小题 `type` 仅允许 `single` / `judge`（PRD F2.1：阅读程序附带的小题可为单选或判断）。
- 子小题 `id` 必须全局唯一（`<父题号>-<序号>`），便于错题本/答题记录定位到具体小题。
- 顶层 `answer` 为子小题答案的汇总数组，与 `sub_questions[].answer` 保持一一对应；**判分以子小题自身 `answer` 为准**，顶层字段供列表/统计快速读取。
- 顶层 `analysis` 为题组总评；每个子小题有独立 `analysis`。
- 顶层 `options` 不出现（由 `sub_questions` 各自承载）。

---

## 4. 题型与判分规则汇总

| 题型 | 选项形态 | 答案形态 | 得分条件 |
| --- | --- | --- | --- |
| single 单选 | 4 个选项 A~D | `"B"` | 唯一匹配 |
| multiple 多选 | 4~5 个选项 A~E | `["A","B"]` | 与答案集合完全一致（全对） |
| judge 判断 | 无 options，固定「正确/错误」 | `true` / `false` | 匹配 |
| reading 阅读程序 | code + 1~N 子小题（single/judge） | 子小题数组 | 各小题独立判分 |

> 卷面计分建议（供后端实现参考，非本任务范围）：每题 1 分；reading 题每个子小题 1 分，题组得分为各小题得分之和。

---

## 5. 枚举定义（与 PRD F1.2 / F1.4 对齐）

### 5.1 题型 `question_types`

| id | name | 说明 |
| --- | --- | --- |
| `single` | 单选题 | 4 选 1 |
| `multiple` | 多选题 | 4~5 选多，全对得分 |
| `judge` | 判断题 | 正确/错误 |
| `reading` | 阅读程序题 | 代码 + 子小题 |

### 5.2 知识点分类 `knowledge_categories`（固定 7 类）

| id | name | 覆盖内容（PRD F1.2） |
| --- | --- | --- |
| `cplusplus` | C++ 语言基础 | 语法、类型、运算符、输入输出、作用域、STL 基础 |
| `data-structure` | 数据结构 | 数组、链表、栈、队列、树、图、哈希、堆 |
| `algorithm` | 算法 | 排序、二分、递归、贪心、DP、搜索、图论、字符串 |
| `math` | 数学 | 数论、组合数学、概率、进制、逻辑（**数制与编码相关计算归此类**） |
| `computer-basics` | 计算机基础 | 硬件、操作系统、网络、编码、计算机史与人物、竞赛常识 |
| `reading` | 阅读程序 | 程序阅读类专项分类 |
| `noi-knowledge` | NOI 相关知识 | 历年真题、赛制规则、OI 竞赛常识 |

> 边界约定：**进制/数制换算**（十进制↔二进制↔十六进制等）归 `math`；**编码**（ASCII、原码/反码/补码等）归 `computer-basics`。

### 5.3 竞赛类型 `competition_types`（通用可扩展枚举）

| id | name | 说明 |
| --- | --- | --- |
| `csp-j` | CSP-J | CCF CSP 认证入门级（第一轮笔试） |
| `csp-s` | CSP-S | CCF CSP 认证提高级（第一轮笔试） |
| `noip` | NOIP | 全国青少年信息学奥林匹克联赛（初赛笔试） |
| `lanqiao` | 蓝桥杯 | 蓝桥杯全国软件和信息技术专业人才大赛（青少组等笔试环节） |
| `provincial` | 省级赛事 | 各省信息学竞赛 / 省选相关笔试 |
| `municipal` | 市级赛事 | 市级信息学竞赛笔试 |
| `school` | 校级赛事 | 校内选拔赛 / 校级信息学竞赛 |
| `other` | 其他 | 其他信息学竞赛笔试题目 |

> - 同一题可打多个竞赛类型标签（PRD §1.3 的 CSP-J/CSP-S/NOIP 为本枚举的子集，v1.1 起统一使用小写 id）。
> - 该枚举为**通用可扩展**枚举：新增比赛类型时，只需在顶层 `competition_types` 追加 `{id, name, description}` 条目，题目引用其 id 即可，无需改动数据结构；**知识点分类（7 类）与题型（4 种）对所有竞赛通用，保持不变**。
> - 字段名沿用 `competition_types`（与 PRD §7 及现有文档一致）；若后续前后端希望简称为 `contest`，可做别名映射，不影响数据文件。

### 5.4 难度 `difficulty_levels`

| id | 名称 | 参考定位 |
| --- | --- | --- |
| `beginner` | 入门 | 对应 CSP-J 常规难度 |
| `intermediate` | 提高 | 对应 CSP-J 难题 / CSP-S 常规 |
| `advanced` | 挑战 | 对应 CSP-S 难题 / NOIP 初赛压轴 |

---

## 6. 设计约束与约定

1. **`id` 全局唯一**（含子小题），作为题目主键，跨表引用（答题记录、错题本、试卷组卷）均用 `id`。
2. **`answer` 格式随题型变化**，消费方（前端判分、后端校验）必须按 `type` 分支处理；多选答案数组**顺序无关**，比较时先排序或按集合比较。
3. **judge 题不写 `options`**，前端固定渲染「正确 / 错误」；避免与单选混淆。
4. **reading 题必有 `code` 与 `sub_questions`（≥1）**；子小题仅 single/judge。
5. **字段完整性**：每题的通用字段（§3.1）与题型相关字段（§3.2）按必填要求齐全；`analysis` 必须完整（思路 + 结论），禁止只给答案不给解析。
6. **编码**：文件为 UTF-8（无 BOM），中文字符直接存储。
7. **难度字段**：PRD 标注 P1，但种子数据已全部补齐，前端可提前支持难度筛选。
8. **source/year**：真题改编题注明出处年份；原创风格题标注「自编（真题风格）」。

---

## 7. 种子题库覆盖统计（data/questions.json）

| 知识点分类 | 题目数 | 题号 | 覆盖题型 |
| --- | --- | --- | --- |
| computer-basics 计算机基础 | 4 | q001~q004 | single×3、judge×1（含 ASCII/补码等编码知识） |
| math 数学 | 4 | q005~q008 | single×3、judge×1（含进制转换×2、组合、逻辑） |
| data-structure 数据结构 | 4 | q009~q012 | single×2、judge×1、multiple×1 |
| algorithm 算法 | 4 | q013~q016 | single×2、judge×1、multiple×1 |
| cplusplus C++ 语言基础 | 4 | q017~q020 | single×2、judge×1、multiple×1 |
| reading 阅读程序 | 3 | q021~q023 | 各含 2 道子小题（single+judge），共 6 道独立小题 |
| noi-knowledge NOI 相关知识 | 3 | q024~q026 | single×2、judge×1（含 Pascal 语法历史真题风格题） |
| **合计** | **26** | q001~q026 | 4 种题型全覆盖，每类 ≥ 3 题 |

题型统计：single 17 题（含 3 道阅读子小题）、multiple 3 题、judge 9 题（含 3 道阅读子小题）、reading 3 题（6 道子小题）——满足「每类至少 2~3 题」要求。

### 7.1 扩展题库覆盖统计（data/questions-extra.json，竞赛类型扩展）

两批题目：第一批 q101~q113（13 题）+ 第二批 q040~q060（21 题，评审建议"题库 ≥ 60 题"扩充），共 **34 题**。

| 竞赛类型 | 题目数 | 题号 | 覆盖知识点分类 |
| --- | --- | --- | --- |
| `lanqiao` 蓝桥杯 | 10 | q040、q044、q047、q050、q053、q057、q101~q104 | 7 类全覆盖（含 reading） |
| `provincial` 省级赛事 | 6 | q042、q048、q054、q058、q105~q106 | reading 外 6 类 |
| `municipal` 市级赛事 | 7 | q045、q051、q055、q059、q107~q109 | 6 类 |
| `school` 校级赛事 | 6 | q041、q046、q052、q060、q110~q111 | 6 类 |
| `other` 其他 | 5 | q043、q049、q056、q112~q113 | 5 类 |
| **合计** | **34** | q040~q060、q101~q113 | 7 类知识点分类全覆盖 |

扩展题库题型：single 20、judge 8、multiple 4、reading 2（4 道子小题），全部含完整解析与难度；知识点分类（7 类）定义不变，对所有竞赛通用。主文件（26 题）+ 扩展（34 题）合并后总计 **60 题**（id 互不重叠：q001~q026、q040~q060、q101~q113，可直接合并导入）。

---

## 8. 校验与扩展指南

- **JSON 合法性校验**：`node -e "const d=require('./data/questions.json'); console.log('OK', d.questions.length)"`（扩展文件同理校验 `questions-extra.json`）。
- **多文件合并**：`data/questions.json` 与 `data/questions-extra.json` 共用同一数据结构，合并导入时按 `questions[].id` 合并（当前两文件 id 互不重叠：q001~q026、q040~q060、q101~q113），枚举定义以主文件为准。
- **导入幂等**（PRD F6 DoD）：导入脚本以 `questions[].id` 为唯一键 upsert，重复执行不产生重复数据。
- **扩充题库**：向任意数据文件的 `questions` 数组追加新对象即可，需同步保证：id 全局唯一（跨文件）、枚举值合法（竞赛类型 id 须在通用枚举内）、`meta.total_questions` 更新（或在导入时自动统计）。
- **扩展竞赛类型**：在顶层 `competition_types` 追加 `{id, name, description}` 条目，随后即可在题目中引用新 id；知识点分类与题型枚举保持不变。
- **向后兼容**：新增字段只做追加，不改变既有字段语义；`schema_version` 在结构性变更时 +1 并在此文档记录变更。

---

## 9. 与 PRD §7 字段对照

| PRD §7 字段 | 本模型字段 | 说明 |
| --- | --- | --- |
| `id` | `id` | 字符串题号 |
| `stem`（支持代码块/Markdown） | `stem` + `code` | reading 题的代码放独立 `code` 字段，便于前端代码高亮 |
| `type`（single/multiple/judge/reading） | `type` | 与 PRD 命名一致 |
| `options`（JSON） | `options` | `{key,text}` 数组 |
| `answer`（JSON，多选数组/阅读小题数组） | `answer` | 按题型变化（§3.3）；reading 题顶层为子小题答案汇总 |
| `analysis` | `analysis` | 含思路 + 结论 |
| `knowledge_category`（7 类之一） | `knowledge_category` | 枚举见 §5.2 |
| `competition_types`（数组） | `competition_types` | 通用可扩展枚举 id 数组（§5.3，v1.1 起 8 项；PRD 的 CSP-J/CSP-S/NOIP 为其子集） |
| `difficulty`（P1） | `difficulty` | 种子数据已全部补齐 |
| `source`（来源/年份） | `source` + `year` | 拆分为两个字段 |
| `created_at` | `created_at` | ISO 8601 |
| （PRD 未单列） | `knowledge_points` | 细粒度知识点标签，供搜索/统计/薄弱点分析 |
| （阅读程序内嵌 JSON） | `sub_questions` | 子小题数组，各小题独立判分 |

---

## 10. 变更记录

| 版本 | 日期 | 变更内容 |
| --- | --- | --- |
| v1.0 | 2025-01-01 | 初始版本：7 类知识点 × 4 种题型，竞赛类型为 CSP-J / CSP-S / NOIP 三值 |
| v1.1 | 2025-01-02 | 竞赛类型改为**通用可扩展枚举**：新增 `lanqiao`/`provincial`/`municipal`/`school`/`other` 共 8 项，现有题目竞赛类型迁移为小写 id；新增 `data/questions-extra.json` 扩展题库（13 题样例）；知识点分类与题型枚举保持不变 |
| v1.2 | 2025-01-03 | 按评审建议扩充题库至 **60 题**：扩展题库追加 q040~q060（21 题，覆盖 7 类知识点、以非 CSP/NOIP 赛事为主），扩展题库合计 34 题 |
