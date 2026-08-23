/* ============================================================
   app.js —— 前端入口：hash 路由 + 全局导航 + 鉴权守卫 + 登录态恢复
   路由表对应 docs/ui-design.md §4.2 / PRD §5 页面清单
   ============================================================ */

import { api } from "./api.js";
import { toast, confirmDialog } from "./components.js";
import { parseHash, escapeHtml } from "./utils.js";

import HomePage from "./pages/home.js";
import PracticePage from "./pages/practice.js";
import { ExamListPage, ExamTakingPage, ExamResultPage } from "./pages/exam.js";
import { WrongBookPage, WrongReviewPage } from "./pages/wrong-book.js";
import StatsPage from "./pages/stats.js";
import { LoginPage, RegisterPage, ProfilePage, Auth } from "./pages/auth.js";

const appEl = document.getElementById("app");
const navbarEl = document.getElementById("navbar");
const footerEl = document.getElementById("footer");

/* ---------------- 路由表 ---------------- */
const routes = [
  { path: "/", page: HomePage, title: "题库" },
  { path: "/practice", page: PracticePage, title: "练习", auth: true },
  { path: "/exams", page: ExamListPage, title: "模拟考", auth: true },
  { path: "/exam/:id", page: ExamTakingPage, title: "考试", auth: true, fullscreen: true },
  { path: "/exam/:id/result", page: ExamResultPage, title: "成绩报告", auth: true },
  { path: "/wrong-book", page: WrongBookPage, title: "错题本", auth: true },
  { path: "/wrong-book/review", page: WrongReviewPage, title: "错题重练", auth: true },
  { path: "/stats", page: StatsPage, title: "学习统计", auth: true },
  { path: "/login", page: LoginPage, title: "登录", noFooter: true },
  { path: "/register", page: RegisterPage, title: "注册", noFooter: true },
  { path: "/profile", page: ProfilePage, title: "个人中心", auth: true },
  { path: "/about", page: AboutPage, title: "关于" },
];

/** 路径匹配：'/exam/:id' → 支持 '/exam/exam-cspj'，返回 { route, params } */
function matchRoute(path) {
  const segs = path.split("/").filter(Boolean);
  for (const route of routes) {
    const parts = route.path.split("/").filter(Boolean);
    if (parts.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(":")) params[parts[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (parts[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}

/* ---------------- 路由执行 ---------------- */

let currentPage = null;

async function route() {
  const { path, query } = parseHash();
  const matched = matchRoute(path);
  if (!matched) {
    location.hash = "#/";
    return;
  }
  const { route: r, params } = matched;

  // 鉴权守卫：需登录页 → 跳登录并回跳
  if (r.auth && !Auth.isLoggedIn()) {
    const qs = new URLSearchParams(query).toString();
    const redirect = encodeURIComponent(path + (qs ? `?${qs}` : ""));
    location.hash = `#/login?redirect=${redirect}`;
    return;
  }

  // 清理上一页
  if (currentPage && currentPage.destroy) {
    try { currentPage.destroy(); } catch (e) { /* ignore */ }
  }
  currentPage = r.page;

  // 导航/页脚可见性（考试页全屏无导航；登录/注册/考试页无页脚，规范 §4.1）
  navbarEl.classList.toggle("hidden", !!r.fullscreen);
  footerEl.classList.toggle("hidden", !!r.fullscreen || !!r.noFooter);
  updateNav(path);

  document.title = `${r.title} · OI练习`;
  window.scrollTo(0, 0);

  try {
    await r.page.render(appEl, { ...query, ...params });
  } catch (e) {
    console.error("[router] 页面渲染失败：", e);
    appEl.innerHTML = `<div class="error-state">页面加载失败：${escapeHtml(e.message || "未知错误")}</div>`;
  }
}

function updateNav(path) {
  navbarEl.querySelectorAll("[data-nav]").forEach((a) => {
    const href = a.dataset.nav;
    const active = path === href || (href !== "/" && path.startsWith(href));
    a.classList.toggle("active", active);
  });
}

/* ---------------- 导航 / 页脚 ---------------- */

function renderNavbar() {
  navbarEl.innerHTML = `
    <div class="logo" id="logo"><span class="logo-badge">◈</span> OI练习</div>
    <nav class="nav-links">
      <a href="#/" data-nav="/">题库</a>
      <a href="#/exams" data-nav="/exams">模拟考</a>
      <a href="#/wrong-book" data-nav="/wrong-book">错题本</a>
      <a href="#/stats" data-nav="/stats">统计</a>
      <a href="#/about" data-nav="/about">关于</a>
    </nav>
    <div class="nav-user" id="nav-user"></div>`;
  navbarEl.classList.remove("hidden");
  navbarEl.querySelector("#logo").addEventListener("click", () => { location.hash = "#/"; });

  const userBox = navbarEl.querySelector("#nav-user");
  const renderUser = () => {
    if (Auth.isLoggedIn()) {
      const u = Auth.user || {};
      // 导航栏：昵称（username）为主，邮箱桌面端可见（移动端隐藏）
      userBox.innerHTML = `
        <a class="btn-text" href="#/profile" title="${escapeHtml(u.email || "")}">👤 ${escapeHtml(u.username || u.email || "")}</a>
        ${u.email ? `<span class="nav-email" title="${escapeHtml(u.email)}">${escapeHtml(u.email)}</span>` : ""}
        <button class="btn btn-secondary btn-sm" id="nav-logout">退出</button>`;
      userBox.querySelector("#nav-logout").addEventListener("click", async () => {
        const ok = await confirmDialog({ title: "退出登录", body: "确定要退出登录吗？", confirmText: "退出", danger: true });
        if (!ok) return;
        api.setToken("");
        Auth.setUser(null);
        renderUser();
        toast("已退出登录", "info");
        if (["/wrong-book", "/stats", "/exams", "/practice", "/profile"].some((p) => location.hash.startsWith(`#${p}`))) {
          location.hash = "#/";
        }
      });
    } else {
      userBox.innerHTML = `
        <a class="btn btn-secondary btn-sm" href="#/login">登录</a>
        <a class="btn btn-primary btn-sm" href="#/register">注册</a>`;
    }
  };
  renderUser();
  // 登录态变化（登录/注册/退出）时刷新导航
  window.addEventListener("auth:change", (e) => {
    Auth.setUser(e.detail || null);
    renderUser();
  });
}

function renderFooter() {
  footerEl.innerHTML = `<p>© 2024 OI练习 · 信息学竞赛笔试刷题平台 · 备考 CSP-J/S · NOIP 初赛</p>`;
  footerEl.classList.remove("hidden");
}

/* ---------------- P14 关于页 ---------------- */

function AboutPage() {}
AboutPage.render = (app) => {
  app.innerHTML = `
    <div class="page-head"><h1>ℹ️ 关于 OI练习</h1></div>
    <div class="card about-section">
      <h2>支持的赛事</h2>
      <ul>
        <li>CSP-J/S 第一轮（初赛笔试）</li>
        <li>NOIP 初赛笔试</li>
        <li>蓝桥杯等各类信息学竞赛笔试</li>
      </ul>
    </div>
    <div class="card about-section">
      <h2>使用说明</h2>
      <ul>
        <li>题库：按竞赛类型 / 知识点 / 题型 / 难度筛选刷题</li>
        <li>练习：提交即判分，即时查看解析，错题自动进入错题本</li>
        <li>模拟考：限时作答 + 答题卡，交卷后统一出成绩报告</li>
        <li>错题本：重练连续答对 2 次自动移出</li>
        <li>统计：查看总体与分类/题型正确率，定位薄弱分类</li>
      </ul>
    </div>
    <div class="card about-section">
      <h2>技术说明</h2>
      <ul>
        <li>前端：原生 HTML/CSS/JS（零依赖），hash 路由单页应用</li>
        <li>判分与数据：优先请求后端 REST API；后端不可用时自动切换本地演示模式</li>
        <li>项目文档：docs/ 目录（PRD / 架构 / UI 设计 / 数据模型）</li>
      </ul>
    </div>`;
};
AboutPage.destroy = () => {};

/* ---------------- 启动 ---------------- */

async function boot() {
  renderNavbar();
  renderFooter();

  // 恢复登录态（刷新后保持，PRD F0.2）；通过事件更新导航用户区，避免重复绑定监听
  if (api.getToken()) {
    try {
      const me = await api.get("/auth/me");
      Auth.setUser(me);
      window.dispatchEvent(new CustomEvent("auth:change", { detail: me }));
    } catch (e) {
      // token 失效：api.js 已清理；继续以匿名身份浏览
    }
  }

  window.addEventListener("hashchange", route);
  route();
}

boot();
