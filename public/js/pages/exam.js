/* ============================================================
   pages/exam.js —— 模拟考
   - ExamListPage   P3 模拟考列表（规则确认 → 进入考试）
   - ExamTakingPage P4 模拟考试（全屏：倒计时 + 答题卡 + 手动/自动交卷，禁答案）
   - ExamResultPage P5 成绩报告（得分/分类/题型/逐题对错与解析）
   规范来源：docs/ui-design.md §5 P3/P4/P5；考试纪律 F3.3：任何位置不出现答案/解析
   ============================================================ */

import { api } from "../api.js";
import { toast, confirmDialog, alertDialog, startTimer, renderAnswerSheet, renderQuestionCard } from "../components.js";
import { escapeHtml, fmtNum, fmtPercent, fmtDate, META, TYPE_NAMES, categoryName, compName, hasAnyAnswer } from "../utils.js";

const SESSION_KEY = "oi_exam_session";

/* ================= P3 模拟考列表 ================= */

export const ExamListPage = {
  async render(app) {
    app.innerHTML = `
      <div class="page-head">
        <h1>📄 模拟考试</h1>
        <div class="segmented" id="exam-comp">
          <button class="on" data-v="">全部</button>
          ${META.competitions.map((c) => `<button data-v="${c.id}">${escapeHtml(c.name)}</button>`).join("")}
        </div>
      </div>
      <div class="exam-list" id="exam-list"><div class="skeleton" style="width:100%;height:90px"></div></div>
      <div style="margin-top:16px;color:var(--text-muted);font-size:12px">考试规则：限时作答 · 交卷后统一判分 · 考试中不显示答案与解析 · 未答题按错误计 0 分</div>`;

    const listEl = app.querySelector("#exam-list");
    let competition = "";

    async function load() {
      listEl.innerHTML = `<div class="skeleton" style="width:100%;height:90px"></div>`;
      try {
        const data = await api.get("/exams", { competition: competition || undefined });
        renderList(data.items || []);
      } catch (e) {
        listEl.innerHTML = `<div class="error-state">加载失败：${escapeHtml(e.message)}</div>`;
      }
    }

    function renderList(items) {
      if (!items.length) {
        listEl.innerHTML = `<div class="empty-state"><div class="empty-emoji">🗂️</div><p>暂无可用的模拟卷</p></div>`;
        return;
      }
      listEl.innerHTML = items.map((e) => `
        <div class="card hoverable exam-card" data-id="${escapeHtml(e.id)}">
          <div class="exam-icon">📄</div>
          <div class="exam-info">
            <div class="exam-title">${escapeHtml(e.title)}</div>
            <div class="exam-meta">
              <span>类型：<span class="badge badge-comp">${escapeHtml(compName(e.competitionType))}</span></span>
              <span>时长 <span class="mono">${e.durationMinutes}</span> 分钟</span>
              <span>共 <span class="mono">${e.questionCount}</span> 题</span>
              <span>满分 <span class="mono">${e.totalScore}</span> 分</span>
            </div>
          </div>
          <button class="btn btn-primary btn-sm" data-start="${escapeHtml(e.id)}">开始考试 ▶</button>
        </div>`).join("");

      listEl.querySelectorAll("[data-start]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.start;
          try {
            const meta = await api.get(`/exams/${id}`);
            const ok = await confirmDialog({
              title: "考试规则确认",
              body: `《${meta.title}》\n\n· 时长 ${meta.durationMinutes} 分钟，到时自动交卷\n· 共 ${meta.questionCount} 题，满分 ${meta.totalScore}\n· 考试中不显示答案与解析\n· 未答题按错误计 0 分\n\n确认开始考试？`,
              confirmText: "开始考试",
            });
            if (ok) location.hash = `#/exam/${id}`;
          } catch (e) {
            toast(e.message || "获取考试信息失败", "error");
          }
        });
      });
    }

    app.querySelector("#exam-comp").querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        competition = b.dataset.v;
        app.querySelector("#exam-comp").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
        load();
      });
    });

    load();
  },
  destroy() {},
};

/* ================= P4 模拟考试（全屏） ================= */

export const ExamTakingPage = {
  // 模块级引用，供 destroy() 清理计时器与事件
  _timerCtrl: null,
  _beforeUnload: null,

  render(app, query) {
    const examId = query.id;
    let session = null;        // { sessionId, examId, questions, answers, startedAt, durationMinutes }
    let questions = [];
    let idx = 0;
    let timerCtrl = null;
    let submitted = false;
    let answers = {};          // qid → 数组形态答案
    ExamTakingPage._timerCtrl = null;

    // ---- 读取本地进行中的会话 ----
    function readStored() {
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (s.examId !== examId) return null;
        return s;
      } catch (e) {
        return null;
      }
    }

    function persist() {
      if (!session) return;
      session.answers = answers;
      session.questions = questions;
      session.idx = idx;
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* ignore */ }
    }

    function clearStored() {
      try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    }

    // ---- 渲染外壳 ----
    document.body.classList.add("exam-mode");
    app.innerHTML = `
      <div class="exam-shell">
        <div class="exam-topbar">
          <div class="exam-logo"><span class="logo-badge">◈</span> OI练习</div>
          <span class="exam-title" id="exam-title">加载中…</span>
          <span class="timer" id="exam-timer">--:--</span>
          <button class="btn btn-warning btn-sm" id="btn-submit">交卷</button>
        </div>
        <div class="exam-body">
          <div class="exam-main">
            <div id="exam-q-wrap"></div>
            <div class="exam-nav-btns">
              <button class="btn btn-secondary" id="btn-prev">‹ 上一题</button>
              <button class="btn btn-primary" id="btn-next">下一题 ›</button>
            </div>
          </div>
          <aside class="answer-sheet" id="answer-sheet"></aside>
        </div>
        <button class="exam-sheet-toggle" id="sheet-toggle" aria-label="打开答题卡">☰</button>
        <div class="exam-sheet-drawer" id="sheet-drawer"></div>
      </div>`;

    const qWrap = app.querySelector("#exam-q-wrap");
    const timerEl = app.querySelector("#exam-timer");
    const sheetEl = app.querySelector("#answer-sheet");
    const drawerEl = app.querySelector("#sheet-drawer");
    const titleEl = app.querySelector("#exam-title");

    // ---- 离开/刷新提示（考试纪律 F3.3） ----
    const onBeforeUnload = (e) => {
      if (submitted) return;
      e.preventDefault();
      e.returnValue = "考试进行中，离开将丢失本次进度，确认离开？";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    ExamTakingPage._beforeUnload = onBeforeUnload;

    init();

    async function init() {
      try {
        // 1) 试卷元信息
        const meta = await api.get(`/exams/${examId}`);
        titleEl.textContent = meta.title;

        // 2) 恢复会话或新开
        const stored = readStored();
        if (stored && stored.sessionId) {
          session = stored;
          questions = stored.questions;
          answers = stored.answers || {};
          idx = stored.idx || 0;
          toast("已恢复上次考试进度", "info");
        } else {
          const started = await api.post(`/exams/${examId}/start`);
          session = { sessionId: started.sessionId, examId, startedAt: started.startedAt, answers: {}, idx: 0 };
          questions = started.questions || [];
          answers = {};
          idx = 0;
        }
        persist();

        // 3) 计算剩余时间
        const durationSec = meta.durationMinutes * 60;
        const startedMs = new Date(session.startedAt || Date.now()).getTime();
        const elapsedSec = Math.floor((Date.now() - startedMs) / 1000);
        let remaining = durationSec - elapsedSec;
        if (remaining <= 0) {
          remaining = 0;
          toast("考试时间已到，正在自动交卷…", "info");
          await doSubmit(true);
          return;
        }
        timerCtrl = startTimer(timerEl, remaining, {
          onExpire: async () => {
            toast("考试时间到，自动交卷", "info");
            await doSubmit(true);
          },
          onTick: (r) => {
            if (r === 60) alertDialog({ title: "时间提醒", body: "距考试结束还有 1 分钟，请检查未答题！" });
          },
        });
        ExamTakingPage._timerCtrl = timerCtrl;

        // 4) 渲染当前题
        showQuestion();
      } catch (e) {
        qWrap.innerHTML = `<div class="error-state">考试初始化失败：${escapeHtml(e.message)}</div>`;
      }
    }

    function showQuestion() {
      persist();
      const q = questions[idx];
      qWrap.innerHTML = `<div class="question-card-wrap"></div>`;
      const holder = qWrap.querySelector(".question-card-wrap");
      renderQuestionCard(holder, {
        mode: "exam",
        question: q,
        index: idx + 1,
        total: questions.length,
        initialAnswer: answers[q.id] || [],
        onExamChange: (answer) => {
          answers[q.id] = answer;
          persist();
          renderSheet();
        },
      });
      app.querySelector("#btn-prev").disabled = idx <= 0;
      app.querySelector("#btn-next").textContent = idx >= questions.length - 1 ? "最后一题" : "下一题 ›";
      renderSheet();
      // 移动端：切题后收起抽屉
      drawerEl.classList.remove("show");
    }

    /** 已答集合（下标集合） */
    function answeredIndexes() {
      const set = new Set();
      questions.forEach((q, i) => {
        if (hasAnyAnswer(answers[q.id])) set.add(i);
      });
      return set;
    }

    function renderSheet() {
      const opts = { count: questions.length, answeredSet: answeredIndexes(), currentIndex: idx, onJump: (i) => { idx = i; showQuestion(); } };
      renderAnswerSheet(sheetEl, opts);
      renderAnswerSheet(drawerEl, opts);
      app.querySelector("#sheet-toggle").textContent = `☰ ${answeredIndexes().size}/${questions.length}`;
    }

    // ---- 导航 ----
    app.querySelector("#btn-prev").addEventListener("click", () => {
      if (idx > 0) { idx -= 1; showQuestion(); }
    });
    app.querySelector("#btn-next").addEventListener("click", () => {
      if (idx < questions.length - 1) { idx += 1; showQuestion(); }
    });

    // ---- 移动端答题卡抽屉 ----
    const sheetToggle = app.querySelector("#sheet-toggle");
    sheetToggle.addEventListener("click", () => drawerEl.classList.toggle("show"));

    // ---- 手动交卷（二次确认） ----
    app.querySelector("#btn-submit").addEventListener("click", async () => {
      const unanswered = questions.length - answeredIndexes().size;
      const ok = await confirmDialog({
        title: "确认交卷",
        body: unanswered > 0 ? `还有 ${unanswered} 题未作答，未答题将按错误计 0 分。确认交卷？` : "所有题目已作答，确认交卷？",
        confirmText: "确认交卷",
        danger: true,
      });
      if (ok) await doSubmit(false);
    });

    async function doSubmit(auto) {
      if (submitted) return;
      submitted = true;
      if (timerCtrl) timerCtrl.stop();
      window.removeEventListener("beforeunload", onBeforeUnload);
      toast("正在判分…", "info");
      try {
        const res = await api.post(`/exams/session/${session.sessionId}/submit`, { answers, auto: !!auto });
        clearStored();
        location.hash = `#/exam/${examId}/result?resultId=${res.resultId}`;
      } catch (e) {
        submitted = false;
        toast(e.message || "交卷失败，请重试", "error");
      }
    }
  },

  destroy() {
    // 路由离开时清理：停止倒计时、移除离开提示、恢复页面外壳
    if (ExamTakingPage._timerCtrl) { ExamTakingPage._timerCtrl.stop(); ExamTakingPage._timerCtrl = null; }
    if (ExamTakingPage._beforeUnload) {
      window.removeEventListener("beforeunload", ExamTakingPage._beforeUnload);
      ExamTakingPage._beforeUnload = null;
    }
    document.body.classList.remove("exam-mode");
    // 注：本地会话保留在 localStorage，意外离开后再次进入可恢复进度
  },
};

/* ================= P5 成绩报告 ================= */

export const ExamResultPage = {
  async render(app, query) {
    const resultId = query.resultId;
    app.innerHTML = `
      <div class="page-head"><h1>🏆 成绩报告</h1><a class="btn-text" href="#/exams">‹ 返回模拟考</a></div>
      <div id="result-body"><div class="skeleton" style="width:100%;height:160px"></div></div>`;

    const body = app.querySelector("#result-body");
    try {
      const r = await api.get(`/exams/results/${resultId}`);
      const perQuestion = r.perQuestion || (r.detail && r.detail.perQuestion) || [];
      body.innerHTML = renderReport(r);
      wireReport(body, r);
      const wrongCount = perQuestion.filter((p) => !p.isCorrect).length;
      if (wrongCount > 0) toast(`本次 ${wrongCount} 道错题已加入错题本`, "info", 4000);
    } catch (e) {
      body.innerHTML = `<div class="error-state">加载成绩失败：${escapeHtml(e.message)}<br><a class="btn-text" href="#/exams">返回模拟考列表</a></div>`;
    }
  },
  destroy() {},
};

function renderReport(r) {
  const rate = r.rate || 0;
  const perQuestion = r.perQuestion || (r.detail && r.detail.perQuestion) || [];
  const wrongCount = perQuestion.filter((p) => !p.isCorrect).length;

  // 分类条形（薄弱 <60% 橙色）
  const detail = r.detail || {};
  const byCategory = detail.byCategory || detail.by_category || {};
  const byType = detail.byType || detail.by_type || {};
  const catRows = Object.entries(byCategory)
    .map(([k, v]) => ({ name: categoryName(k), correct: v.correct, total: v.total, rate: v.total ? v.correct / v.total : 0 }))
    .filter((x) => x.total > 0);
  const typeRows = Object.entries(byType)
    .map(([k, v]) => ({ name: TYPE_NAMES[k] || k, correct: v.correct, total: v.total, rate: v.total ? v.correct / v.total : 0 }))
    .filter((x) => x.total > 0);

  const barHtml = (rows) => rows.map((x) => `
    <div class="bar-row">
      <span class="bar-label" title="${escapeHtml(x.name)}">${escapeHtml(x.name)}</span>
      <span class="bar-track"><span class="bar-fill ${x.rate < 0.6 ? "weak" : ""}" style="width:${Math.max(2, Math.round(x.rate * 100))}%"></span></span>
      <span class="bar-val">${x.correct}/${x.total} · ${fmtPercent(x.rate)}</span>
    </div>`).join("");

  // 逐题回顾
  const reviewHtml = perQuestion.map((p) => {
    const sub = p.sub || p.perSub || null;
    const ico = p.isCorrect
      ? `<span class="review-ico ok">✓</span>`
      : p.answered === false || p.answered === undefined && !p.yourAnswer
        ? `<span class="review-ico skip">○</span>`
        : sub && sub.some((s) => s.isCorrect)
          ? `<span class="review-ico skip">○</span>`
          : `<span class="review-ico no">✗</span>`;
    let answerLine = "";
    if (p.type === "reading") {
      const subLines = (sub || []).map((s, i) => `
        <span style="display:inline-block;margin-right:14px">
          第${i + 1}题：${s.isCorrect ? `<span class="correct-ans">✓ ${fmtSubAnswer(s.yourAnswer, s.correctAnswer)}</span>` : `<span class="wrong-ans">你的答案 ${fmtSubAnswer(s.yourAnswer, null)}</span> · <span class="correct-ans">正确答案 ${fmtSubAnswer(null, s.correctAnswer)}</span>`}
        </span>`).join("");
      answerLine = `<div class="review-meta">${subLines}<span>得分 ${p.score}/${p.totalScore}</span></div>`;
    } else {
      const yours = p.yourAnswer && p.yourAnswer.length ? fmtSimpleAnswer(p.type, p.yourAnswer) : "未作答";
      const correct = fmtSimpleAnswer(p.type, p.correctAnswer);
      answerLine = `<div class="review-meta">
        <span class="${p.isCorrect ? "correct-ans" : "wrong-ans"}">你的答案：${escapeHtml(yours)}</span>
        <span class="correct-ans">正确答案：${escapeHtml(correct)}</span>
        <span>得分 ${p.score}/${p.totalScore}</span>
      </div>`;
    }
    return `
    <div class="review-item" data-ridx="${p.questionId}">
      ${ico}
      <div class="review-body">
        <div class="review-stem" data-toggle>${escapeHtml(truncate(p.stem, 100))}</div>
        ${answerLine}
        <div class="review-analysis" style="display:none">
          ${sub ? sub.map((s, i) => `<div style="margin-top:6px"><b>第${i + 1}题</b>：${escapeHtml(s.stem)}<br><div class="analysis-inner">${escapeHtml(s.analysis || "")}</div></div>`).join("") : `<div class="analysis-inner">${escapeHtml(p.analysis || "")}</div>`}
        </div>
      </div>
    </div>`;
  }).join("");

  return `
    <div class="card result-hero" style="display:flex;align-items:center;gap:24px;flex-wrap:wrap">
      <div class="score-ring" style="--rate:${(rate * 100).toFixed(1)}">
        <span class="score-num">${r.score}</span>
        <span class="score-label">/${r.total} 分</span>
      </div>
      <div class="result-hero-info">
        <div style="font-size:18px;font-weight:600">${escapeHtml(r.examTitle || "")}</div>
        <div class="row">得分 <span class="mono">${r.score}</span> / ${r.total} · 正确率 <span class="mono">${fmtPercent(rate)}</span></div>
        <div class="row">错题 <span class="mono">${wrongCount}</span> 道（已自动加入错题本）</div>
        <div class="row">交卷时间 ${fmtDate(r.submittedAt)}</div>
      </div>
    </div>

    <div class="card stat-section">
      <h2>按知识点分类</h2>
      ${catRows.length ? barHtml(catRows) : '<div class="card-sub">无数据</div>'}
      ${catRows.some((x) => x.rate < 0.6) ? '<div style="color:var(--warning);font-size:12px">⚠ 橙色为薄弱分类（正确率 &lt; 60%），建议针对性练习</div>' : ""}
    </div>

    <div class="card stat-section">
      <h2>按题型</h2>
      ${typeRows.length ? barHtml(typeRows) : '<div class="card-sub">无数据</div>'}
    </div>

    <div class="card stat-section">
      <h2>逐题回顾 <span class="card-sub">（点击题干展开解析）</span></h2>
      ${reviewHtml}
    </div>

    <div class="empty-actions" style="justify-content:center;gap:12px;margin-top:20px">
      <a class="btn btn-secondary" href="#/wrong-book">去错题本</a>
      <button class="btn btn-primary" id="btn-retake">再考一次</button>
    </div>`;
}

function wireReport(body, r) {
  // 逐题解析展开
  body.querySelectorAll(".review-item").forEach((item) => {
    const stem = item.querySelector(".review-stem");
    const analysis = item.querySelector(".review-analysis");
    stem.addEventListener("click", () => {
      analysis.style.display = analysis.style.display === "none" ? "block" : "none";
    });
  });
  // 再考一次
  body.querySelector("#btn-retake")?.addEventListener("click", () => {
    location.hash = `#/exam/${r.exam_id || r.examId}`;
  });
}

/** 阅读题子题答案展示 */
function fmtSubAnswer(your, correct) {
  const v = your ?? correct;
  if (v === true || v === "true") return "正确";
  if (v === false || v === "false") return "错误";
  return v == null ? "未作答" : String(v);
}

/** 普通题型答案展示（兼容数组与标量形态） */
function fmtSimpleAnswer(type, answer) {
  const arr = Array.isArray(answer) ? answer : answer === null || answer === undefined ? [] : [answer];
  if (type === "judge") return arr[0] === true ? "正确" : arr[0] === false ? "错误" : "未作答";
  if (type === "multiple") return arr.join("、");
  return arr[0] === null || arr[0] === undefined ? "未作答" : String(arr[0]);
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
