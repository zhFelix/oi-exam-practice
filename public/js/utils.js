/* ============================================================
   utils.js —— 通用工具函数（无依赖）
   ============================================================ */

/** HTML 转义，防止题目文本中的特殊字符破坏页面结构 */
export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 极简 Markdown 渲染（覆盖题目实际用到的语法）：
 *  - ```代码块``` / ```lang ...``` → <pre class="code-block">
 *  - 行内 `code` → <code class="inline">
 *  - **加粗** → <strong>
 *  - 普通换行 → <p> 分段
 * 返回安全 HTML 字符串（已转义）。
 */
export function renderMarkdown(text) {
  if (!text) return "";
  // 1) 先按代码块切分
  const parts = String(text).split(/```/);
  let html = "";
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      // 代码块内容（首行可能带语言标注，忽略之）
      const code = parts[i].replace(/^[a-zA-Z0-9+#-]*\n/, "").trim();
      html += `<pre class="code-block">${escapeHtml(code)}</pre>`;
    } else {
      // 普通文本：转义 → 行内代码 → 加粗 → 分段
      let seg = escapeHtml(parts[i]);
      seg = seg.replace(/`([^`]+)`/g, (m, c) => `<code class="inline">${c}</code>`);
      seg = seg.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      const paras = seg.split(/\n+/).map((p) => p.trim()).filter(Boolean);
      html += paras.map((p) => `<p>${p}</p>`).join("");
    }
  }
  return html;
}

/** 从 URL 中解析查询参数（支持 #/path?a=1&b=2 形式） */
export function parseQuery(search) {
  const q = {};
  new URLSearchParams(search || "").forEach((v, k) => {
    q[k] = v;
  });
  return q;
}

/** 构建查询字符串（跳过空值） */
export function buildQuery(params) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") sp.set(k, v);
  });
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** 防抖 */
export function debounce(fn, ms = 300) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

/** 数字格式化 */
export function fmtNum(n) {
  return Number(n ?? 0).toLocaleString("zh-CN");
}

/** 百分比（保留 0~1 位小数） */
export function fmtPercent(rate) {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return "--";
  return `${Math.round(rate * 1000) / 10}%`;
}

/** 时间格式化：MM:SS / HH:MM:SS */
export function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** 日期格式化：YYYY-MM-DD HH:mm */
export function fmtDate(iso) {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 题型名称映射 */
export const TYPE_NAMES = {
  single: "单选题",
  multiple: "多选题",
  judge: "判断题",
  reading: "阅读程序题",
};

/** 难度映射（种子数据为字符串 id，架构 API 为数字，兼容两者） */
export const DIFF_NAMES = {
  beginner: "入门",
  intermediate: "提高",
  advanced: "挑战",
  1: "入门",
  2: "提高",
  3: "挑战",
};

/** 题型难度徽标（●○○ 形式） */
export function diffDots(difficulty) {
  const idx = { beginner: 1, intermediate: 2, advanced: 3, 1: 1, 2: 2, 3: 3 }[difficulty] || 1;
  return "●".repeat(idx) + "○".repeat(3 - idx);
}

/** 创建元素（轻量 DOM 帮助） */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null) return;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return node;
}

/** 从 hash 路由解析路径与查询：'#/exam/e1?x=1' → { path:'/exam/e1', query: {x:'1'} } */
export function parseHash() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const [pathPart, queryPart] = hash.split("?");
  return { path: pathPart || "/", query: parseQuery(queryPart) };
}

/* ============================================================
   筛选维度元数据（与 docs/data-model.md §5 枚举对齐）
   竞赛类型为数据配置驱动（id+name），新增竞赛类型只需扩展数据；
   知识点固定 7 类 × 题型 4 种（MVP）
   ============================================================ */
export const META = {
  competitions: [
    { id: "csp-j", name: "CSP-J" },
    { id: "csp-s", name: "CSP-S" },
    { id: "noip", name: "NOIP" },
    { id: "lanqiao", name: "蓝桥杯" },
    { id: "provincial", name: "省级赛事" },
    { id: "municipal", name: "市级赛事" },
    { id: "school", name: "校级赛事" },
    { id: "other", name: "其他" },
  ],
  categories: [
    { id: "cplusplus", name: "C++ 语言基础" },
    { id: "data-structure", name: "数据结构" },
    { id: "algorithm", name: "算法" },
    { id: "math", name: "数学" },
    { id: "computer-basics", name: "计算机基础" },
    { id: "reading", name: "阅读程序" },
    { id: "noi-knowledge", name: "NOI 相关知识" },
  ],
  types: [
    { id: "single", name: "单选题" },
    { id: "multiple", name: "多选题" },
    { id: "judge", name: "判断题" },
    { id: "reading", name: "阅读程序题" },
  ],
  difficulties: [
    { id: "beginner", name: "入门" },
    { id: "intermediate", name: "提高" },
    { id: "advanced", name: "挑战" },
  ],
};

/** 分类 id → 名称 */
export function categoryName(id) {
  const c = META.categories.find((x) => x.id === id);
  return c ? c.name : id;
}

/** 竞赛类型 id → 名称（如 'csp-j' → 'CSP-J'） */
export function compName(id) {
  const c = META.competitions.find((x) => x.id === id);
  return c ? c.name : id;
}

/* ------------------------------------------------------------
   答案有效性判断（answer 为数组形态：["B"] / [true] / ["A","C"] /
   阅读题 [["B"], [true]]，其中判断题为布尔标量，非数组元素）
   ------------------------------------------------------------ */
function isAnsweredUnit(a) {
  if (Array.isArray(a)) return a.length > 0;
  return a !== null && a !== undefined && a !== "";
}

/** 至少一个单元已作答（答题卡"已答"标记用） */
export function hasAnyAnswer(answer) {
  return Array.isArray(answer) && answer.length > 0 && answer.some(isAnsweredUnit);
}

/** 全部单元已作答（阅读题整题提交用） */
export function hasAllAnswer(answer) {
  return Array.isArray(answer) && answer.length > 0 && answer.every(isAnsweredUnit);
}
