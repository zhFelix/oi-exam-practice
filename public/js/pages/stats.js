/* ============================================================
   pages/stats.js —— P8 学习统计页
   - 四张概览卡：总刷题数 / 总正确率 / 练习时长 / 模拟考次数
   - 分类正确率 / 题型正确率横向条形图
   - 薄弱分类（<60%）橙色高亮，点击跳转题库并带该分类筛选
   规范来源：docs/ui-design.md §5 P8（F5）
   ============================================================ */

import { api } from "../api.js";
import { escapeHtml, fmtNum, fmtPercent, TYPE_NAMES, categoryName } from "../utils.js";

export default {
  async render(app) {
    app.innerHTML = `
      <div class="page-head"><h1>📊 学习统计</h1></div>
      <div class="stat-cards" id="stat-cards"></div>
      <div class="card stat-section">
        <h2>分类正确率 <span class="card-sub">（薄弱分类橙色，点击针对性练习）</span></h2>
        <div id="stat-cats"></div>
      </div>
      <div class="card stat-section">
        <h2>题型正确率</h2>
        <div id="stat-types"></div>
      </div>`;

    const cardsEl = app.querySelector("#stat-cards");
    const catsEl = app.querySelector("#stat-cats");
    const typesEl = app.querySelector("#stat-types");
    cardsEl.innerHTML = skeletonCards();

    try {
      const [overview, cats, types] = await Promise.all([
        api.get("/stats/overview"),
        api.get("/stats/categories"),
        api.get("/stats/types"),
      ]);

      // ---- 概览卡 ----
      cardsEl.innerHTML = `
        <div class="card stat-card"><div class="stat-num">${fmtNum(overview.totalAnswered || 0)}</div><div class="stat-label">总刷题数</div></div>
        <div class="card stat-card"><div class="stat-num">${fmtPercent(overview.overallRate)}</div><div class="stat-label">总正确率</div></div>
        <div class="card stat-card"><div class="stat-num">${fmtNum(overview.totalPracticeMinutes || 0)}</div><div class="stat-label">练习时长（分钟）</div></div>
        <div class="card stat-card"><div class="stat-num">${fmtNum(overview.examCount || 0)}</div><div class="stat-label">模拟考次数</div></div>`;

      // ---- 空状态 ----
      if (!overview.totalAnswered) {
        catsEl.innerHTML = `<div class="empty-state"><div class="empty-emoji">📈</div><p>答题后这里将展示你的学习数据</p><div class="empty-actions"><a class="btn btn-primary" href="#/">去刷题</a></div></div>`;
        typesEl.innerHTML = "";
        return;
      }

      // ---- 分类条形 ----
      const catItems = (cats.items || []).filter((x) => x.answered > 0);
      catsEl.innerHTML = catItems.length
        ? catItems.map((x) => barRow(categoryName(x.category) || x.category, x.rate, x.answered, x.correct, x.category)).join("")
        : `<div class="card-sub">暂无数据</div>`;
      catsEl.querySelectorAll(".bar-row[data-cat]").forEach((row) => {
        row.addEventListener("click", () => {
          location.hash = `#/?category=${encodeURIComponent(row.dataset.cat)}`;
        });
      });

      // ---- 题型条形 ----
      const typeItems = (types.items || []).filter((x) => x.answered > 0);
      typesEl.innerHTML = typeItems.length
        ? typeItems.map((x) => barRow(TYPE_NAMES[x.type] || x.type, x.rate, x.answered, x.correct)).join("")
        : `<div class="card-sub">暂无数据</div>`;
    } catch (e) {
      cardsEl.innerHTML = "";
      catsEl.innerHTML = `<div class="error-state">加载统计失败：${escapeHtml(e.message)}</div>`;
    }
  },
  destroy() {},
};

function barRow(name, rate, answered, correct, catId) {
  const weak = rate < 0.6;
  return `
    <div class="bar-row ${catId ? "clickable" : ""}" ${catId ? `data-cat="${escapeHtml(catId)}" style="cursor:pointer"` : ""}>
      <span class="bar-label" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
      <span class="bar-track"><span class="bar-fill ${weak ? "weak" : ""}" style="width:${Math.max(2, Math.round((rate || 0) * 100))}%"></span></span>
      <span class="bar-val">答 ${answered} 对 ${correct} · ${fmtPercent(rate)}</span>
    </div>`;
}

function skeletonCards() {
  return Array.from({ length: 4 }, () => `<div class="card stat-card"><div class="skeleton" style="width:50%;height:32px;margin:0 auto"></div><div class="skeleton" style="width:70%;height:12px;margin:12px auto 0"></div></div>`).join("");
}
