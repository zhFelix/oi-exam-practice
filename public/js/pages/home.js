/* ============================================================
   pages/home.js —— P1 首页/题库浏览页
   - 竞赛类型 Segmented + 知识点/题型/难度 Chip（可组合筛选）
   - 关键词搜索（防抖）
   - 题目列表（分页）+ 开始练习（携带当前筛选）
   - 点击题目卡片 → 详情弹窗（view 模式，匿名可看）
   ============================================================ */

import { api } from "../api.js";
import { renderQuestionCard } from "../components.js";
import { escapeHtml, debounce, buildQuery, fmtNum, META, TYPE_NAMES, DIFF_NAMES, compName } from "../utils.js";

const PAGE_SIZE = 20;

export default {
  render(app) {
    app.innerHTML = `
      <div class="page-head"><h1>📚 题库</h1></div>
      <div class="card filter-panel">
        <div class="filter-row">
          <span class="filter-label">竞赛类型</span>
          <div class="segmented" id="f-comp"></div>
        </div>
        <div class="filter-row">
          <span class="filter-label">知识点</span>
          <div class="filter-chips" id="f-cat"></div>
        </div>
        <div class="filter-row">
          <span class="filter-label">题型</span>
          <div class="filter-chips" id="f-type"></div>
        </div>
        <div class="filter-row">
          <span class="filter-label">难度</span>
          <div class="filter-chips" id="f-diff"></div>
        </div>
        <div class="filter-row">
          <span class="filter-label">搜索</span>
          <input id="f-kw" type="search" placeholder="输入关键词搜索题干…" style="max-width:320px;flex:1">
        </div>
      </div>
      <div class="bank-toolbar">
        <div class="bank-total">共 <span class="num" id="total-num">--</span> 题</div>
        <button class="btn btn-primary" id="btn-start">开始练习 ▶</button>
      </div>
      <div class="q-list" id="q-list"></div>
      <div class="pagination" id="pagination"></div>`;

    // ---- 筛选状态 ----
    const state = {
      competition: "",        // '' = 全部
      categories: new Set(),  // 多选
      types: new Set(),       // 多选
      difficulties: new Set(),// 多选
      keyword: "",
      page: 1,
    };

    // ---- 渲染筛选控件 ----
    const compEl = app.querySelector("#f-comp");
    compEl.innerHTML = `<button class="${state.competition === "" ? "on" : ""}" data-v="">全部</button>` +
      META.competitions.map((c) => `<button class="${state.competition === c.id ? "on" : ""}" data-v="${c.id}">${escapeHtml(c.name)}</button>`).join("");
    compEl.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        state.competition = b.dataset.v;
        state.page = 1;
        renderComp();
        load();
      });
    });

    const renderChips = (id, list, get, toggle) => {
      const box = app.querySelector(id);
      box.innerHTML = list.map((x) => {
        const v = typeof x === "string" ? x : x.id;
        const label = typeof x === "string" ? x : x.name;
        return `<span class="chip ${get().has(v) ? "on" : ""}" data-v="${v}">${label}</span>`;
      }).join("");
      box.querySelectorAll(".chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          const v = chip.dataset.v;
          const s = get();
          if (s.has(v)) s.delete(v);
          else s.add(v);
          state.page = 1;
          renderChips(id, list, get, toggle);
          load();
        });
      });
    };
    renderChips("#f-cat", META.categories, () => state.categories);
    renderChips("#f-type", META.types, () => state.types);
    renderChips("#f-diff", META.difficulties, () => state.difficulties);

    const kwInput = app.querySelector("#f-kw");
    const doSearch = debounce(() => {
      state.keyword = kwInput.value.trim();
      state.page = 1;
      load();
    }, 300);
    kwInput.addEventListener("input", doSearch);

    const renderComp = () => {
      compEl.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === state.competition));
    };

    // ---- 构建查询参数 ----
    const buildParams = () => {
      const p = { page: state.page, pageSize: PAGE_SIZE };
      if (state.competition) p.competition = state.competition;
      if (state.categories.size) p.category = [...state.categories].join(",");
      if (state.types.size) p.type = [...state.types].join(",");
      if (state.difficulties.size) p.difficulty = [...state.difficulties].join(",");
      if (state.keyword) p.keyword = state.keyword;
      return p;
    };

    // ---- 加载列表 ----
    const listEl = app.querySelector("#q-list");
    async function load() {
      listEl.innerHTML = skeleton();
      try {
        const data = await api.get("/questions", buildParams());
        app.querySelector("#total-num").textContent = fmtNum(data.total || 0);
        renderList(data.items || []);
        renderPagination(data.total || 0);
      } catch (e) {
        listEl.innerHTML = `<div class="error-state">加载失败：${escapeHtml(e.message)}<br><button class="btn btn-secondary" style="margin-top:12px" onclick="location.reload()">重试</button></div>`;
      }
    }

    function renderList(items) {
      if (!items.length) {
        listEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-emoji">🔍</div>
            <p>没有符合条件的题目，试试调整筛选条件</p>
            <div class="empty-actions"><button class="btn btn-secondary" id="btn-clear">清除筛选</button></div>
          </div>`;
        app.querySelector("#btn-clear")?.addEventListener("click", () => {
          state.competition = ""; state.categories.clear(); state.types.clear(); state.difficulties.clear();
          kwInput.value = ""; state.keyword = ""; state.page = 1;
          renderComp(); renderChips("#f-cat", META.categories, () => state.categories);
          renderChips("#f-type", META.types, () => state.types);
          renderChips("#f-diff", META.difficulties, () => state.difficulties);
          load();
        });
        return;
      }
      listEl.innerHTML = items.map((q) => `
        <div class="card hoverable q-list-item" data-id="${escapeHtml(q.id)}">
          <div class="q-item-top">
            <span class="q-item-id">${escapeHtml(q.id)}</span>
            <span class="badge badge-type">${TYPE_NAMES[q.type] || q.type}</span>
            <span class="badge badge-cat">${escapeHtml(q.knowledgeCategory || q.knowledge_category || "")}</span>
            ${(q.competitionTypes || q.competition_types || []).map((c) => `<span class="badge badge-comp">${escapeHtml(compName(c))}</span>`).join("")}
          </div>
          <div class="q-item-stem" title="查看详情">${escapeHtml(truncate(q.stem, 140))}</div>
          <div class="q-item-bottom">
            <span class="q-item-source">${escapeHtml(q.source || "")}${q.year ? " · " + q.year : ""} · ${DIFF_NAMES[q.difficulty] || ""} · ${q.score ?? 1} 分</span>
            <button class="btn btn-sm btn-secondary" data-practice="${escapeHtml(q.id)}">练习</button>
          </div>
        </div>`).join("");

      // 单题练习
      listEl.querySelectorAll("[data-practice]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          location.hash = `#/practice?ids=${encodeURIComponent(btn.dataset.practice)}`;
        });
      });
      // 详情弹窗
      listEl.querySelectorAll(".q-list-item").forEach((card) => {
        card.addEventListener("click", () => openDetail(card.dataset.id));
      });
    }

    function renderPagination(total) {
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const box = app.querySelector("#pagination");
      if (pages <= 1) { box.innerHTML = ""; return; }
      let html = `<button data-p="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}>‹</button>`;
      for (let i = 1; i <= pages; i++) {
        if (pages > 9 && Math.abs(i - state.page) > 2 && i !== 1 && i !== pages) {
          if (html.endsWith("…</button>") === false) html += `<span>…</span>`;
          continue;
        }
        html += `<button class="${i === state.page ? "on" : ""}" data-p="${i}">${i}</button>`;
      }
      html += `<button data-p="${state.page + 1}" ${state.page >= pages ? "disabled" : ""}>›</button>`;
      box.innerHTML = html;
      box.querySelectorAll("button[data-p]").forEach((b) => {
        b.addEventListener("click", () => {
          const p = Number(b.dataset.p);
          if (p < 1 || p > pages) return;
          state.page = p;
          load();
          app.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
    }

    // ---- 开始练习（携带当前筛选）----
    app.querySelector("#btn-start").addEventListener("click", () => {
      const qs = buildQuery(buildParams());
      location.hash = `#/practice${qs}`;
    });

    load();
  },

  destroy() {},
};

/** 题干截断 */
function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** 骨架屏 */
function skeleton() {
  return Array.from({ length: 4 }, () => `
    <div class="card">
      <div class="skeleton" style="width:40%;margin-bottom:12px"></div>
      <div class="skeleton" style="width:90%;margin-bottom:8px"></div>
      <div class="skeleton" style="width:70%"></div>
    </div>`).join("");
}

/** 题目详情弹窗（view 模式，匿名可看） */
async function openDetail(id) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="modal-mask" data-act="close"></div>
    <div class="modal modal-lg" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <h3 id="modal-title">题目详情 · ${escapeHtml(id)}</h3>
      <div class="modal-body" id="detail-body" style="margin-bottom:0;max-height:60vh;overflow:auto;color:var(--text-main)">
        <div class="skeleton" style="width:60%"></div>
      </div>
    </div>`;
  root.classList.add("show");
  root.querySelector('[data-act="close"]').addEventListener("click", close);
  const body = root.querySelector("#detail-body");
  try {
    const q = await api.get(`/questions/${id}`, { withAnswer: localStorage.getItem("oi_token") ? "1" : undefined });
    const holder = document.createElement("div");
    renderQuestionCard(holder, { mode: "view", question: q, showAnalysis: true });
    body.innerHTML = "";
    body.appendChild(holder);
  } catch (e) {
    body.innerHTML = `<div class="error-state">加载失败：${escapeHtml(e.message)}</div>`;
  }
  function close() {
    root.classList.remove("show");
    root.innerHTML = "";
  }
}
