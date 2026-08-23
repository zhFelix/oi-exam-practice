/* ============================================================
   pages/wrong-book.js —— P6 错题本 + P7 错题重练
   - 列表：时间倒序，错选答案/正确思路摘要，重练 / 手动移除
   - 重练：复用练习卡片，连对 2 次自动移出（toast 庆祝提示）
   规范来源：docs/ui-design.md §5 P6/P7；架构 §5.4.1 状态机
   ============================================================ */

import { api } from "../api.js";
import { toast, confirmDialog, renderQuestionCard } from "../components.js";
import { escapeHtml, fmtDate, TYPE_NAMES } from "../utils.js";

/* ================= P6 错题本 ================= */

export const WrongBookPage = {
  async render(app) {
    app.innerHTML = `
      <div class="page-head">
        <h1>📕 错题本 <span class="card-sub" id="wb-total"></span></h1>
        <button class="btn btn-primary" id="btn-review-all">开始重练全部 ▶</button>
      </div>
      <div class="q-list" id="wb-list"><div class="skeleton" style="width:100%;height:90px"></div></div>`;

    const listEl = app.querySelector("#wb-list");
    let items = [];

    async function load() {
      listEl.innerHTML = `<div class="skeleton" style="width:100%;height:90px"></div>`;
      try {
        const data = await api.get("/wrong-book", { pageSize: 50 });
        items = data.items || [];
        app.querySelector("#wb-total").textContent = `共 ${items.length} 题`;
        render();
      } catch (e) {
        listEl.innerHTML = `<div class="error-state">加载失败：${escapeHtml(e.message)}</div>`;
      }
    }

    function render() {
      if (!items.length) {
        listEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-emoji">🎉</div>
            <p>太棒了，目前没有错题！</p>
            <div class="empty-actions"><a class="btn btn-primary" href="#/">去刷题</a></div>
          </div>`;
        return;
      }
      listEl.innerHTML = items.map((w) => `
        <div class="card wrong-item" data-qid="${escapeHtml(w.questionId)}">
          <div class="wrong-head">
            <span class="wrong-x">✗</span>
            <span class="badge badge-type">${TYPE_NAMES[w.type] || w.type}</span>
            <span class="badge badge-cat">${escapeHtml(w.knowledgeCategory || "")}</span>
            <span class="wrong-stats">被错 ${w.wrongCount} 次 · 最近 ${fmtDate(w.lastWrongAt)}</span>
          </div>
          <div class="q-item-stem">${escapeHtml(truncate(w.stem, 120))}</div>
          <div class="wrong-answers">
            你的答案：<span class="wrong-yours">${escapeHtml(fmtLastAnswer(w))}</span>
            &nbsp;·&nbsp; 正确答案：<span class="wrong-correct">${escapeHtml(w.correctAnswerSummary || "")}</span>
          </div>
          <div class="q-item-bottom">
            <span></span>
            <div style="display:flex;gap:8px">
              <button class="btn btn-sm btn-primary" data-review="${escapeHtml(w.questionId)}">重练</button>
              <button class="btn btn-sm btn-danger" data-del="${escapeHtml(w.questionId)}">移除</button>
            </div>
          </div>
        </div>`).join("");

      listEl.querySelectorAll("[data-review]").forEach((btn) => {
        btn.addEventListener("click", () => {
          location.hash = `#/wrong-book/review?ids=${encodeURIComponent(btn.dataset.review)}`;
        });
      });
      listEl.querySelectorAll("[data-del]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const ok = await confirmDialog({
            title: "移出错题本",
            body: "确定将该题从错题本移除吗？（历史统计保留）",
            confirmText: "移除",
            danger: true,
          });
          if (!ok) return;
          try {
            await api.del(`/wrong-book/${btn.dataset.del}`);
            toast("已移出错题本", "success");
            load();
          } catch (e) {
            toast(e.message || "移除失败", "error");
          }
        });
      });
    }

    app.querySelector("#btn-review-all").addEventListener("click", () => {
      if (!items.length) { toast("错题本为空", "info"); return; }
      location.hash = "#/wrong-book/review";
    });

    load();
  },
  destroy() {},
};

/* ================= P7 错题重练 ================= */

export const WrongReviewPage = {
  render(app, query) {
    const ids = (query.ids || "").split(",").map((s) => s.trim()).filter(Boolean);
    const state = { queue: ids, idx: 0, removed: 0 };

    app.innerHTML = `
      <div class="practice-bar">
        <a class="btn-text" href="#/wrong-book">‹ 返回错题本</a>
        <span class="card-sub">重练模式 · 连续答对 2 次自动移出错题本</span>
        <span class="practice-progress">进度 <span class="pct" id="rv-progress">--/--</span></span>
      </div>
      <div id="rv-body" class="card"><div class="skeleton" style="width:80%"></div></div>`;

    const bodyEl = app.querySelector("#rv-body");

    init();

    async function init() {
      if (!state.queue.length) {
        try {
          const data = await api.get("/wrong-book", { pageSize: 50 });
          state.queue = (data.items || []).map((w) => w.questionId);
        } catch (e) {
          bodyEl.innerHTML = `<div class="error-state">加载错题失败：${escapeHtml(e.message)}</div>`;
          return;
        }
      }
      if (!state.queue.length) {
        bodyEl.innerHTML = `<div class="empty-state"><div class="empty-emoji">🎉</div><p>没有需要重练的错题</p><div class="empty-actions"><a class="btn btn-primary" href="#/wrong-book">返回错题本</a></div></div>`;
        return;
      }
      showCurrent();
    }

    async function showCurrent() {
      updateBar();
      const qid = state.queue[state.idx];
      bodyEl.innerHTML = `<div class="skeleton" style="width:70%"></div>`;
      try {
        const q = await api.get(`/questions/${qid}`, { withAnswer: "1" });
        bodyEl.innerHTML = "";
        renderQuestionCard(bodyEl, {
          mode: "practice",
          question: q,
          index: state.idx + 1,
          total: state.queue.length,
          onSubmit: async (answer) => {
            const result = await api.post("/wrong-book/review", { questionId: qid, answer });
            if (result.isCorrect) {
              if (result.autoRemoved) {
                state.removed += 1;
                toast(`✓ 回答正确！连续答对 ${result.reviewStreak} 次，已移出错题本 🎉`, "success", 4000);
              } else {
                toast(`✓ 回答正确！连续答对 ${result.reviewStreak} 次`, "success");
              }
            } else {
              toast("✗ 回答错误，连续答对已清零", "error");
            }
            // 下一题按钮
            const actions = bodyEl.querySelector(".qc-actions");
            if (actions) actions.style.display = "none";
            const next = document.createElement("div");
            next.className = "qc-actions";
            next.innerHTML = `<button class="btn btn-primary" id="rv-next">${state.idx >= state.queue.length - 1 ? "完成重练 ✓" : "下一题 ▶"}</button>`;
            bodyEl.appendChild(next);
            bodyEl.querySelector("#rv-next").addEventListener("click", onNext);
            return result;
          },
        });
      } catch (e) {
        bodyEl.innerHTML = `<div class="error-state">加载题目失败：${escapeHtml(e.message)}</div>`;
      }
    }

    function onNext() {
      if (state.idx >= state.queue.length - 1) {
        finish();
        return;
      }
      state.idx += 1;
      showCurrent();
      app.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function updateBar() {
      app.querySelector("#rv-progress").textContent = `${Math.min(state.idx + 1, state.queue.length)}/${state.queue.length}`;
    }

    async function finish() {
      const ok = await confirmDialog({
        title: "重练完成 🎉",
        body: state.removed > 0 ? `本次共移出 ${state.removed} 道错题，继续保持！` : "本次重练完成，暂无错题被移出（需连续答对 2 次）。",
        confirmText: "返回错题本",
      });
      location.hash = ok ? "#/wrong-book" : "#/";
    }
  },
  destroy() {},
};

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** 错题列表中的"你的答案"展示 */
function fmtLastAnswer(w) {
  const a = w.lastWrongAnswer;
  if (!a || !a.length) return "未作答";
  if (Array.isArray(a[0])) {
    // reading：子题答案
    return a.map((sub, i) => `第${i + 1}题 ${fmtSub(sub)}`).join("；");
  }
  if (a[0] === true) return "正确";
  if (a[0] === false) return "错误";
  return a.join("、");
}
function fmtSub(sub) {
  if (sub[0] === true) return "正确";
  if (sub[0] === false) return "错误";
  return String(sub[0]);
}
