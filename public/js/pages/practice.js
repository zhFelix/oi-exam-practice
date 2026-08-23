/* ============================================================
   pages/practice.js —— P2 练习答题页（即时判分 + 解析 + 错题自动入本）
   - 入口：题库页「开始练习」（携带筛选条件）或单题「练习」按钮（ids=）
   - 逐题作答 → 提交 → 1 秒内判分反馈 + 解析 → 下一题
   - 会话小结：答对题数 / 正确率
   ============================================================ */

import { api } from "../api.js";
import { toast, confirmDialog, renderQuestionCard } from "../components.js";
import { escapeHtml, fmtPercent, compName, DIFF_NAMES } from "../utils.js";

export default {
  render(app, query) {
    // 解析筛选/题目参数
    const ids = (query.ids || "").split(",").map((s) => s.trim()).filter(Boolean);

    const state = {
      ids,            // 待练习题目 id 列表
      idx: 0,         // 当前题下标
      correct: 0,     // 答对数
      done: 0,        // 已答数
      loaded: false,  // 当前题详情是否已加载
    };

    app.innerHTML = `
      <div class="practice-bar">
        <a class="btn-text" href="#/">‹ 返回题库</a>
        <span class="card-sub" id="p-filter-desc"></span>
        <span class="practice-progress">进度 <span class="pct" id="p-progress">--/--</span> · 正确率 <span class="pct" id="p-rate">--</span></span>
      </div>
      <div id="p-body" class="card"><div class="skeleton" style="width:80%"></div></div>`;

    const bodyEl = app.querySelector("#p-body");
    const filterDesc = app.querySelector("#p-filter-desc");
    const filterParams = pick(query, ["competition", "category", "type", "difficulty", "keyword"]);

    // 筛选描述（如：CSP-J · 数学 · 单选题）
    const descParts = [];
    if (filterParams.competition) descParts.push(compName(filterParams.competition));
    if (filterParams.category) descParts.push(filterParams.category.split(",").join("/"));
    if (filterParams.type) descParts.push(filterParams.type.split(",").join("/"));
    if (filterParams.difficulty) descParts.push(filterParams.difficulty.split(",").map((d) => DIFF_NAMES[d] || d).join("/"));
    if (filterParams.keyword) descParts.push(`搜索"${filterParams.keyword}"`);
    filterDesc.textContent = descParts.length ? `练习中 · ${descParts.join(" · ")}` : "练习中";

    init();

    async function init() {
      // 确定题目列表
      if (!state.ids.length) {
        try {
          const data = await api.get("/questions", { ...filterParams, page: 1, pageSize: 50 });
          state.ids = (data.items || []).map((q) => q.id);
        } catch (e) {
          bodyEl.innerHTML = `<div class="error-state">加载题目失败：${escapeHtml(e.message)}</div>`;
          return;
        }
      }
      if (!state.ids.length) {
        bodyEl.innerHTML = `<div class="empty-state"><div class="empty-emoji">😶</div><p>当前筛选下没有题目，去题库调整筛选条件吧</p><div class="empty-actions"><a class="btn btn-primary" href="#/">返回题库</a></div></div>`;
        return;
      }
      state.loaded = true;
      await showCurrent();
    }

    async function showCurrent() {
      updateBar();
      const qid = state.ids[state.idx];
      bodyEl.innerHTML = `<div class="skeleton" style="width:70%"></div>`;
      try {
        // 练习模式需要答案与解析：已登录时携带 withAnswer=1
        const q = await api.get(`/questions/${qid}`, { withAnswer: "1" });
        bodyEl.innerHTML = "";
        renderQuestionCard(bodyEl, {
          mode: "practice",
          question: q,
          index: state.idx + 1,
          total: state.ids.length,
          onSubmit: async (answer) => {
            const result = await api.post("/practice/submit", { questionId: qid, answer });
            state.done += 1;
            if (result.isCorrect) {
              state.correct += 1;
              toast("✓ 回答正确！", "success");
            } else {
              toast("✗ 回答错误 · 已加入错题本", "error");
            }
            updateBar();
            // 追加"下一题"按钮
            const actions = bodyEl.querySelector(".qc-actions");
            if (actions) actions.style.display = "none";
            const next = document.createElement("div");
            next.className = "qc-actions";
            next.innerHTML = `<button class="btn btn-primary" id="btn-next">${state.idx >= state.ids.length - 1 ? "完成练习 ✓" : "下一题 ▶"}</button>`;
            bodyEl.appendChild(next);
            bodyEl.querySelector("#btn-next").addEventListener("click", onNext);
            return result;
          },
        });
      } catch (e) {
        bodyEl.innerHTML = `<div class="error-state">加载题目失败：${escapeHtml(e.message)}</div>`;
      }
    }

    function onNext() {
      if (state.idx >= state.ids.length - 1) {
        finish();
        return;
      }
      state.idx += 1;
      showCurrent();
      app.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function updateBar() {
      app.querySelector("#p-progress").textContent = `${Math.min(state.idx + 1, state.ids.length)}/${state.ids.length}`;
      app.querySelector("#p-rate").textContent = state.done ? fmtPercent(state.correct / state.done) : "--";
    }

    async function finish() {
      const rate = state.done ? state.correct / state.done : 0;
      const ok = await confirmDialog({
        title: "本次练习完成 🎉",
        body: `共练习 ${state.done} 题，答对 ${state.correct} 题，正确率 ${fmtPercent(rate)}。`,
        confirmText: "去错题本",
      });
      location.hash = ok ? "#/wrong-book" : "#/";
    }
  },

  destroy() {},
};

/** 仅保留筛选相关参数 */
function pick(obj, keys) {
  const out = {};
  keys.forEach((k) => {
    if (obj && obj[k]) out[k] = obj[k];
  });
  return out;
}
