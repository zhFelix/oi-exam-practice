/* ============================================================
   components.js —— 全局可复用组件
   - toast：顶部滑入提示（成功绿/错误红/提示蓝）
   - modal：二次确认 / 信息弹窗（role=dialog）
   - timer：考试倒计时（最后 5 分钟橙色、1 分钟红色脉冲）
   - answerSheet：答题卡（题号网格，蓝=已答 橙=未答 青边=当前）
   - questionCard：题目卡片（view 浏览 / practice 练习即时判分 / exam 考试无反馈）
   规范来源：docs/ui-design.md §3 组件规范
   ============================================================ */

import { escapeHtml, renderMarkdown, renderInline, TYPE_NAMES, DIFF_NAMES, diffDots, hasAnyAnswer, hasAllAnswer } from "./utils.js";

/* ================= Toast ================= */

export function toast(message, type = "info", duration = 3000) {
  let root = document.getElementById("toast-root");
  if (!root) return;
  const ico = type === "success" ? "✓" : type === "error" ? "✕" : "ℹ";
  const box = document.createElement("div");
  box.className = `toast ${type}`;
  box.setAttribute("role", "status");
  box.innerHTML = `<span class="toast-ico">${ico}</span><span>${escapeHtml(message)}</span>`;
  root.appendChild(box);
  setTimeout(() => {
    box.classList.add("toast-leave");
    box.addEventListener("animationend", () => box.remove(), { once: true });
  }, duration);
}

/* ================= Modal ================= */

function openModal({ title, bodyHtml, confirmText, cancelText, danger, onConfirm }) {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    root.innerHTML = `
      <div class="modal-mask" data-act="cancel"></div>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h3 id="modal-title">${escapeHtml(title)}</h3>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-actions">
          ${cancelText ? `<button class="btn btn-secondary" data-act="cancel">${escapeHtml(cancelText)}</button>` : ""}
          <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-act="ok">${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    root.classList.add("show");
    const done = (ok) => {
      root.classList.remove("show");
      root.innerHTML = "";
      resolve(ok);
    };
    root.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => done(btn.dataset.act === "ok"));
    });
  });
}

/** 二次确认弹窗 → Promise<boolean> */
export function confirmDialog({ title = "确认操作", body = "确定要继续吗？", confirmText = "确定", danger = false }) {
  return openModal({ title, bodyHtml: `<p>${escapeHtml(body)}</p>`, confirmText, cancelText: "取消", danger });
}

/** 信息提示弹窗 → Promise<void> */
export function alertDialog({ title = "提示", body = "" }) {
  return openModal({ title, bodyHtml: `<p>${escapeHtml(body)}</p>`, confirmText: "知道了" }).then(() => {});
}

/* ================= Timer ================= */

/**
 * 启动倒计时
 * @param {HTMLElement} el 显示元素
 * @param {number} totalSeconds 总秒数
 * @param {object} opts { onExpire, onTick }
 * @returns {{stop: Function}}
 */
export function startTimer(el, totalSeconds, opts = {}) {
  let remaining = totalSeconds;
  const tick = () => {
    remaining = Math.max(0, remaining - 1);
    render();
    if (remaining <= 0) {
      clearInterval(timerId);
      opts.onExpire && opts.onExpire();
      return;
    }
    opts.onTick && opts.onTick(remaining);
  };
  const render = () => {
    const s = remaining;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    el.textContent = h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
    el.classList.toggle("warn", s <= 300 && s > 60);
    el.classList.toggle("danger", s <= 60);
  };
  const timerId = setInterval(tick, 1000);
  render();
  return { stop: () => clearInterval(timerId), get remaining() { return remaining; } };
}

/* ================= 答题卡 ================= */

/**
 * 渲染答题卡
 * @param {HTMLElement} container
 * @param {object} opts { count, answeredSet(Set<index>), currentIndex, onJump(i) }
 */
export function renderAnswerSheet(container, opts) {
  const { count, answeredSet, currentIndex, onJump } = opts;
  container.innerHTML = `
    <h3>答题卡</h3>
    <div class="as-progress">已答 <span class="num">${answeredSet.size}</span> / ${count}</div>
    <div class="as-grid"></div>
    <div class="as-legend">
      <span><span class="dot blue"></span>已答</span>
      <span><span class="dot orange"></span>未答</span>
      <span><span class="dot cyan"></span>当前</span>
    </div>`;
  const grid = container.querySelector(".as-grid");
  for (let i = 0; i < count; i++) {
    const cell = document.createElement("button");
    cell.className = "as-cell";
    cell.textContent = i + 1;
    cell.classList.toggle("answered", answeredSet.has(i));
    cell.classList.toggle("unanswered", !answeredSet.has(i));
    cell.classList.toggle("current", i === currentIndex);
    cell.addEventListener("click", () => onJump(i));
    grid.appendChild(cell);
  }
}

/* ================= 题目卡片 ================= */

/**
 * 渲染题目卡片
 * @param {HTMLElement} container
 * @param {object} opts
 *  - mode: 'view' | 'practice' | 'exam'
 *  - question: 完整题目对象（view/exam 无需 answer；practice 需正确解析时依赖服务端返回）
 *  - index/total: 可选，显示"第 N 题"
 *  - initialAnswer: 数组形态的初始作答（exam 恢复进度用）
 *  - onSubmit: practice 模式 (answer) => Promise<{isCorrect, correctAnswer, analysis, score, ...}>
 *  - onExamChange: exam 模式 (answer) => void
 *  - showAnalysis: view 模式是否展示解析
 */
export function renderQuestionCard(container, opts) {
  const { mode, question: q } = opts;
  const isReading = q.type === "reading";
  // 兼容两种字段命名：真实后端 toApiQuestion 返回 camelCase subQuestions，
  // mock 演示模式返回 snake_case sub_questions
  const subs = q.subQuestions || q.sub_questions || [];
  const units = isReading ? subs : [q]; // 作答单元：阅读题为子题

  // 初始作答 → 单元值数组（null 表示未答）
  const initial = opts.initialAnswer || [];
  const unitValues = units.map((u, i) => {
    if (isReading) {
      const a = initial[i];
      return a && a.length === 1 ? a[0] : null;
    }
    if (!initial.length) return null;
    return initial.length === 1 ? initial[0] : [...initial];
  });

  // ---- 组装 HTML ----
  const html = [];
  html.push(`<div class="qc-head">`);
  if (opts.index) html.push(`<span class="qc-no">第 ${opts.index} 题</span>`);
  html.push(`<span class="badge badge-type">${TYPE_NAMES[q.type] || q.type}</span>`);
  html.push(`<span class="badge badge-cat">${catName(q)}</span>`);
  if (q.source) html.push(`<span class="qc-meta">${escapeHtml(q.source)}</span>`);
  html.push(`<span class="qc-meta mono">${diffDots(q.difficulty)}</span>`);
  html.push(`</div>`);

  html.push(`<div class="qc-stem">${renderMarkdown(q.stem)}</div>`);

  if (isReading && q.code) {
    html.push(`<pre class="code-block">${escapeHtml(q.code)}</pre>`);
  }

  if (isReading) {
    // 阅读程序：逐子题渲染
    units.forEach((sub, i) => {
      html.push(`<div class="sub-question" data-unit="${i}">`);
      html.push(`<div class="sub-no">小题 ${i + 1} · ${TYPE_NAMES[sub.type]}</div>`);
      html.push(`<div class="qc-stem">${renderMarkdown(sub.stem)}</div>`);
      html.push(renderUnitBody(sub, i, mode, q.type));
      html.push(`</div>`);
    });
  } else {
    html.push(renderUnitBody(q, 0, mode, q.type));
  }

  if (mode === "practice") {
    html.push(`<div class="qc-actions"><button class="btn btn-primary" data-act="submit">提交答案</button></div>`);
  }

  container.innerHTML = html.join("");

  // ---- 交互绑定 ----
  const qc = container.querySelector(".question-card") || container;
  qc.classList.add("question-card");

  // 绑定选项点击（view 模式不可交互）
  if (mode !== "view") {
    container.querySelectorAll("[data-opt]").forEach((optEl) => {
      const onClick = () => {
        const unitIdx = Number(optEl.dataset.unit);
        const key = parseKey(optEl.dataset.opt);
        if (optEl.classList.contains("locked")) return;
        toggleUnit(unitIdx, key, optEl);
        if (mode === "exam" && opts.onExamChange) opts.onExamChange(buildAnswer());
      };
      optEl.addEventListener("click", onClick);
      // 键盘可达性：Tab 聚焦 + Enter/Space 操作（无障碍 §6.5）
      optEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      });
    });
  }

  // 练习提交
  const submitBtn = container.querySelector('[data-act="submit"]');
  if (submitBtn) {
    submitBtn.addEventListener("click", async () => {
      const answer = buildAnswer();
      if (!hasAnswer(answer)) {
        toast("请先作答", "error");
        return;
      }
      submitBtn.disabled = true;
      submitBtn.classList.add("btn-loading");
      submitBtn.textContent = "判分中…";
      try {
        const result = await opts.onSubmit(answer);
        showFeedback(result, answer);
        submitBtn.style.display = "none";
        qc.dispatchEvent(new CustomEvent("submitted", { detail: { result, answer } }));
      } catch (e) {
        toast(e.message || "提交失败，请重试", "error");
        submitBtn.disabled = false;
        submitBtn.classList.remove("btn-loading");
        submitBtn.textContent = "提交答案";
      }
    });
  }

  /* ---- 单元选择状态（unitValues 为事实源） ---- */
  function toggleUnit(unitIdx, key, optEl) {
    const unit = units[unitIdx];
    const cur = unitValues[unitIdx];
    if (unit.type === "multiple") {
      const arr = Array.isArray(cur) ? [...cur] : [];
      const pos = arr.indexOf(key);
      if (pos >= 0) arr.splice(pos, 1);
      else arr.push(key);
      unitValues[unitIdx] = arr;
    } else {
      // 单选/判断：点同一项取消，点其他项替换
      unitValues[unitIdx] = cur === key ? null : key;
    }
    syncSelection();
  }

  function syncSelection() {
    container.querySelectorAll("[data-opt]").forEach((optEl) => {
      const unitIdx = Number(optEl.dataset.unit);
      const key = parseKey(optEl.dataset.opt);
      const cur = unitValues[unitIdx];
      const selected = Array.isArray(cur) ? cur.includes(key) : cur === key;
      optEl.classList.toggle("selected", selected);
      if (optEl.getAttribute("role")) optEl.setAttribute("aria-checked", selected ? "true" : "false");
    });
  }

  /** 判断题选项值统一为布尔（true/false），与 API 约定一致 */
  function parseKey(raw) {
    if (raw === "true") return true;
    if (raw === "false") return false;
    return raw;
  }

  /** 由单元值构建 API 数组形态答案 */
  function buildAnswer() {
    if (isReading) {
      return unitValues.map((v) => (Array.isArray(v) ? [...v] : v == null ? [] : [v]));
    }
    const v = unitValues[0];
    if (v == null) return [];
    return Array.isArray(v) ? [...v] : [v];
  }

  /** 判分后反馈渲染 */
  function showFeedback(result, answer) {
    const correctAnswer = result.correctAnswer || [];
    const isCorrect = result.isCorrect;
    const banner = document.createElement("div");
    banner.className = `qc-result ${isCorrect ? "right" : "wrong"}`;
    banner.innerHTML = `<span>${isCorrect ? "✓ 回答正确" : "✗ 回答错误"}</span><span class="qc-score">${isCorrect ? `+${result.score ?? 1} 分` : "0 分"}</span>`;
    qc.appendChild(banner);

    // 锁定选项并标记对错
    container.querySelectorAll("[data-opt]").forEach((optEl) => {
      optEl.classList.add("locked");
      optEl.style.cursor = "default";
    });

    if (isReading) {
      units.forEach((sub, i) => {
        const subAnswer = (correctAnswer[i] || []).map(String);
        const userSub = (answer[i] || []).map(String);
        markUnits(sub, i, subAnswer, userSub);
        // 子题解析
        appendAnalysis(qc, sub.analysis, i);
      });
    } else {
      markUnits(q, 0, correctAnswer.map(String), answer.map(String));
    }

    // 整题解析
    appendAnalysis(qc, result.analysis || q.analysis, -1);

    // 反馈淡入
    banner.style.animation = "analysis-in .2s ease";
  }

  function markUnits(unit, unitIdx, correctKeys, userKeys) {
    const scope = unit.type === "judge" ? "judge-option" : "option";
    const keys = unit.type === "judge" ? ["true", "false"] : (unit.options || []).map((o) => o.key);
    keys.forEach((key) => {
      const el = container.querySelector(`[data-unit="${unitIdx}"][data-opt="${key}"]`);
      if (!el) return;
      const isCorrectKey = correctKeys.includes(key);
      const isUserKey = userKeys.includes(key);
      if (isCorrectKey) el.classList.add("correct");
      else if (isUserKey) el.classList.add("wrong");
      else el.classList.add("dim");
      el.querySelector(".opt-flag, .j-flag")?.remove();
      const flag = document.createElement("span");
      flag.className = unit.type === "judge" ? "j-flag" : "opt-flag";
      if (isCorrectKey) flag.textContent = "✓";
      else if (isUserKey) flag.textContent = "✗";
      if (flag.textContent) el.appendChild(flag);
    });
  }

  /** 追加解析区（title 为 null 时用默认标题） */
  function appendAnalysis(parent, text, subIdx) {
    if (!text) return;
    const div = document.createElement("div");
    div.className = "analysis";
    div.style.animation = "analysis-in .2s ease";
    const title = subIdx === -1 ? "解析" : `小题 ${subIdx + 1} 解析`;
    div.innerHTML = `<div class="analysis-title">📖 ${title}</div><div class="analysis-body">${renderMarkdown(text)}</div>`;
    parent.appendChild(div);
  }

  function hasAnswer(answer) {
    // 阅读程序题：整题一次提交，需全部小题作答；其余题型至少答一项
    return isReading ? hasAllAnswer(answer) : hasAnyAnswer(answer);
  }

  syncSelection();
  if (mode === "view" && opts.showAnalysis && q.analysis) {
    appendAnalysis(qc, q.analysis, -1);
  }
}

/** 单个作答单元（单选/多选/判断）的选项区 HTML */
function renderUnitBody(unit, unitIdx, mode, parentType) {
  const noInteract = mode === "view" ? " style=\"cursor:default\"" : "";
  if (unit.type === "judge") {
    return `
      <div class="judge-options">
        <button type="button" class="judge-option" data-unit="${unitIdx}" data-opt="true"${noInteract}>
          <span class="j-key">T</span> 正确 <span class="j-flag"></span>
        </button>
        <button type="button" class="judge-option" data-unit="${unitIdx}" data-opt="false"${noInteract}>
          <span class="j-key">F</span> 错误 <span class="j-flag"></span>
        </button>
      </div>`;
  }
  const isMultiple = unit.type === "multiple";
  const cls = isMultiple ? "option checkbox" : "option";
  const options = unit.options || [];
  return `
    <div class="options">
      ${options.map((o) => `
        <div class="${cls}" data-unit="${unitIdx}" data-opt="${escapeHtml(o.key)}"${noInteract} role="${isMultiple ? "checkbox" : "radio"}" aria-checked="false" tabindex="0">
          <span class="opt-key">${escapeHtml(o.key)}</span>
          <span class="opt-text">${renderInline(o.text)}</span>
          <span class="opt-flag"></span>
        </div>`).join("")}
    </div>`;
}

/** 兼容架构文档的字段命名（camelCase 与 snake_case 均可） */
export function catName(q) {
  const c = q && (q.knowledgeCategory || q.knowledge_category);
  if (c) return c;
  // 兜底：已知分类 id → 名称
  const MAP = { cplusplus: "C++ 语言基础", "data-structure": "数据结构", algorithm: "算法", math: "数学", "computer-basics": "计算机基础", reading: "阅读程序", "noi-knowledge": "NOI 相关知识" };
  return MAP[c] || "";
}
