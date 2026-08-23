/* ============================================================
   utils.js —— 通用工具函数
   依赖：本地 vendor/katex（零 CDN），仅用于 Markdown/LaTeX 渲染
   ============================================================ */

import * as katexESM from "../vendor/katex/katex.mjs";

/** HTML 转义，防止题目文本中的特殊字符破坏页面结构 */
export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ============================================================
   Markdown / LaTeX 渲染
   支持语法（新增 LaTeX 与常用 Markdown，兼容原有调用点）：
   - 代码块 ```...``` / ```lang ...```
   - LaTeX 公式：块级 $$...$$（居中）、行内 $...$（KaTeX 本地渲染）
   - 标题：# / ## / ###
   - 列表：无序（- / * / + 开头）、有序（1. 2. …）
   - 加粗 **text**、斜体 *text*、删除线 ~~text~~、行内代码 `code`
   - 链接 [text](url)（仅 http(s)/相对路径/#hash，防伪协议）
   - 普通段落（换行分段）
   安全：所有 Markdown 文本先 escapeHtml 再加工，不渲染原始 HTML（防 XSS）；
   公式内容在转义前提取并交由 KaTeX 渲染（KaTeX 输出为安全 HTML）。
   ============================================================ */

// KaTeX 实例：优先用 index.html 中 katex.min.js 提供的 window.katex，否则用 ESM 版
const katexImpl = (typeof window !== "undefined" && window.katex) || katexESM || null;

// 占位符前缀：\x00 不会被 escapeHtml 转义，且题目/解析文本中不会出现
const PH = "\u0000KX";

export function renderMarkdown(text) {
  if (!text) return "";
  const tokens = []; // 占位 → 最终 HTML（代码块 / 公式）
  let body = String(text);

  // 1) 切分代码块：代码块内不做任何 Markdown / LaTeX 解析
  const codeParts = body.split(/```/);
  let src = "";
  for (let i = 0; i < codeParts.length; i++) {
    if (i % 2 === 1) {
      const code = codeParts[i].replace(/^[a-zA-Z0-9+#-]*\n/, "").trim();
      src += pushToken(tokens, `<pre class="code-block">${escapeHtml(code)}</pre>`);
    } else {
      src += codeParts[i];
    }
  }

  // 2) 提取 LaTeX：先块级 $$...$$，再行内 $...$（渲染结果直接入 token，
  //    公式内容不会经过 Markdown 转义/加粗等处理）
  src = src.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => pushToken(tokens, renderLatex(tex, true)));
  src = src.replace(/\$([^$\n]+?)\$/g, (m, tex) => pushToken(tokens, renderLatex(tex, false)));

  // 3) 行级处理：标题 / 列表 / 段落
  const lines = src.split("\n");
  const out = [];
  let listType = null; // 'ul' | 'ol' | null
  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { closeList(); continue; }

    // 标题
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      out.push(`<h${level}>${processInline(h[2])}</h${level}>`);
      continue;
    }

    // 无序列表
    const ul = line.match(/^[-*+]\s+(.*)$/);
    if (ul) {
      if (listType !== "ul") { closeList(); out.push("<ul>"); listType = "ul"; }
      out.push(`<li>${processInline(ul[1])}</li>`);
      continue;
    }

    // 有序列表
    const ol = line.match(/^\d+[.、]\s+(.*)$/);
    if (ol) {
      if (listType !== "ol") { closeList(); out.push("<ol>"); listType = "ol"; }
      out.push(`<li>${processInline(ol[1])}</li>`);
      continue;
    }

    // 普通段落（与旧版一致：每行一个 <p>）
    closeList();
    out.push(`<p>${processInline(line)}</p>`);
  }
  closeList();

  // 4) 恢复占位符（代码块 / 公式）
  return out.join("").replace(new RegExp(PH + "(\\d+)" + PH, "g"), (m, i) => tokens[Number(i)] || "");
}

/** 行内处理：转义 → 行内代码 → 加粗 → 斜体 → 删除线 → 链接（顺序保证互不干扰） */
function processInline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, (m, c) => `<code class="inline">${c}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|#\/[^\s)]+|\/[^\s)]+)\)/g,
    (m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  return s;
}

/**
 * 行内渲染（用于选项文本等单行场景）：LaTeX 公式（$...$ / $$...$$）+ 行内 Markdown，
 * 不做块级包装（不产生 <p>/<ul>/<h>），避免块级元素嵌套进 <span> 破坏 DOM 结构。
 * 安全：与 renderMarkdown 一致——公式经 KaTeX 安全渲染，其余文本先转义。
 */
export function renderInline(text) {
  if (!text) return "";
  const tokens = [];
  let src = String(text);
  src = src.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => pushToken(tokens, renderLatex(tex, false)));
  src = src.replace(/\$([^$\n]+?)\$/g, (m, tex) => pushToken(tokens, renderLatex(tex, false)));
  const html = processInline(src);
  return html.replace(new RegExp(PH + "(\\d+)" + PH, "g"), (m, i) => tokens[Number(i)] || "");
}

/** KaTeX 渲染：失败或未加载时转义原文兜底 */
function renderLatex(tex, displayMode) {
  const source = tex.trim();
  if (!source) return "";
  try {
    if (katexImpl) {
      const html = katexImpl.renderToString(source, {
        throwOnError: false,
        displayMode,
        strict: false,
      });
      return displayMode ? `<div class="katex-block">${html}</div>` : html;
    }
  } catch (e) {
    console.warn("[markdown] KaTeX 渲染失败，按原文显示：", source, e);
  }
  return `<span class="katex-fallback">${escapeHtml(source)}</span>`;
}

/** 登记 token 并返回占位符 */
function pushToken(tokens, html) {
  tokens.push(html);
  return PH + (tokens.length - 1) + PH;
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
