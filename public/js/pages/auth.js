/* ============================================================
   pages/auth.js —— P9 登录 / P10 注册 / P11 个人中心
   - Supabase Auth 适配（t18）：登录标识为 email，username 为昵称/显示名
   - 登录成功回跳 redirect 参数指向的页面
   - 表单内联校验（邮箱格式、昵称格式、密码 ≥6 位、两次一致、重复注册提示）
   ============================================================ */

import { api } from "../api.js";
import { toast, confirmDialog } from "../components.js";
import { escapeHtml } from "../utils.js";

/** 邮箱格式（与后端 server/routes/auth.js 的 EMAIL_PATTERN 保持一致） */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ================= P9 登录 ================= */

export const LoginPage = {
  render(app, query) {
    const redirect = query.redirect || "/";
    app.innerHTML = `
      <div class="auth-wrap">
        <div class="card auth-card">
          <div class="auth-logo">
            <div class="logo-badge">◈</div>
            <div class="name">OI练习</div>
            <div class="slogan">欢迎回来，继续刷题</div>
          </div>
          <form id="login-form" novalidate>
            <div class="form-item">
              <label for="login-email">邮箱</label>
              <input id="login-email" name="email" type="email" autocomplete="email" placeholder="请输入邮箱" required>
              <div class="form-error" id="err-email"></div>
            </div>
            <div class="form-item">
              <label for="login-pass">密码</label>
              <input id="login-pass" name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required>
              <div class="form-error" id="err-pass"></div>
            </div>
            <button class="btn btn-primary btn-block" type="submit" id="btn-login">登 录</button>
          </form>
          <div class="form-footer">没有账号？<a href="#/register">立即注册</a></div>
          <div class="form-footer" id="demo-hint" style="display:none">💡 演示账号：<span class="mono">demo@example.com</span> / <span class="mono">123456</span></div>
        </div>
      </div>`;

    if (api.isMock) app.querySelector("#demo-hint").style.display = "block";

    const form = app.querySelector("#login-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const els = form.elements;
      const email = els.email.value.trim().toLowerCase();
      const password = els.password.value;
      const errEmail = app.querySelector("#err-email");
      const errPass = app.querySelector("#err-pass");
      errEmail.textContent = ""; errPass.textContent = "";
      if (!EMAIL_PATTERN.test(email)) { errEmail.textContent = "请输入正确的邮箱地址"; return; }
      if (!password) { errPass.textContent = "请输入密码"; return; }
      const btn = app.querySelector("#btn-login");
      btn.disabled = true; btn.textContent = "登录中…";
      try {
        const data = await api.post("/auth/login", { email, password });
        api.setToken(data.token);
        window.dispatchEvent(new CustomEvent("auth:change", { detail: data.user }));
        toast(`欢迎回来，${data.user.username || data.user.email} 👋`, "success");
        location.hash = `#${redirect}`;
      } catch (err) {
        // 统一提示"用户名或密码错误"（不区分具体错误，DoD F0）
        errPass.textContent = err.message || "用户名或密码错误";
        btn.disabled = false; btn.textContent = "登 录";
      }
    });
  },
  destroy() {},
};

/* ================= P10 注册 ================= */

export const RegisterPage = {
  render(app, query) {
    const redirect = query.redirect || "/";
    app.innerHTML = `
      <div class="auth-wrap">
        <div class="card auth-card">
          <div class="auth-logo">
            <div class="logo-badge">◈</div>
            <div class="name">OI练习</div>
            <div class="slogan">注册账号，开始刷题之旅</div>
          </div>
          <form id="reg-form" novalidate>
            <div class="form-item">
              <label for="reg-email">邮箱（登录账号）</label>
              <input id="reg-email" name="email" type="email" autocomplete="email" placeholder="请输入邮箱">
              <div class="form-error" id="err-email"></div>
            </div>
            <div class="form-item">
              <label for="reg-user">昵称（显示名）</label>
              <input id="reg-user" name="username" autocomplete="nickname" placeholder="3~20 位字母、数字或下划线">
              <div class="form-error" id="err-user"></div>
            </div>
            <div class="form-item">
              <label for="reg-pass">密码</label>
              <input id="reg-pass" name="password" type="password" autocomplete="new-password" placeholder="至少 6 位">
              <div class="form-error" id="err-pass"></div>
            </div>
            <div class="form-item">
              <label for="reg-pass2">确认密码</label>
              <input id="reg-pass2" name="confirmPassword" type="password" autocomplete="new-password" placeholder="再次输入密码">
              <div class="form-error" id="err-pass2"></div>
            </div>
            <button class="btn btn-primary btn-block" type="submit" id="btn-reg">注 册</button>
          </form>
          <div class="form-footer">已有账号？<a href="#/login">去登录</a></div>
        </div>
      </div>`;

    const form = app.querySelector("#reg-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const els = form.elements;
      const email = els.email.value.trim().toLowerCase();
      const username = els.username.value.trim();
      const password = els.password.value;
      const confirmPassword = els.confirmPassword.value;
      const errEmail = app.querySelector("#err-email");
      const errUser = app.querySelector("#err-user");
      const errPass = app.querySelector("#err-pass");
      const errPass2 = app.querySelector("#err-pass2");
      errEmail.textContent = ""; errUser.textContent = ""; errPass.textContent = ""; errPass2.textContent = "";

      // 内联校验
      if (!EMAIL_PATTERN.test(email)) { errEmail.textContent = "请输入正确的邮箱地址"; return; }
      if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) { errUser.textContent = "昵称需为 3~20 位字母、数字或下划线"; return; }
      if (password.length < 6) { errPass.textContent = "密码至少 6 位"; return; }
      if (password !== confirmPassword) { errPass2.textContent = "两次输入的密码不一致"; return; }

      const btn = app.querySelector("#btn-reg");
      btn.disabled = true; btn.textContent = "注册中…";
      try {
        const data = await api.post("/auth/register", { email, username, password, confirmPassword });
        api.setToken(data.token);
        window.dispatchEvent(new CustomEvent("auth:change", { detail: data.user }));
        toast("注册成功，已自动登录 🎉", "success");
        location.hash = `#${redirect}`;
      } catch (err) {
        // 服务端错误按错误码就地显示
        if (err.code === "EMAIL_TAKEN" || err.code === "INVALID_EMAIL") errEmail.textContent = err.message;
        else if (err.code === "USERNAME_TAKEN" || err.code === "INVALID_USERNAME") errUser.textContent = err.message;
        else if (err.code === "WEAK_PASSWORD") errPass.textContent = err.message;
        else if (err.code === "PASSWORD_MISMATCH") errPass2.textContent = err.message;
        else toast(err.message || "注册失败", "error");
        btn.disabled = false; btn.textContent = "注 册";
      }
    });
  },
  destroy() {},
};

/* ================= P11 个人中心 ================= */

export const ProfilePage = {
  async render(app) {
    app.innerHTML = `
      <div class="page-head"><h1>👤 个人中心</h1></div>
      <div class="card profile-card">
        <div class="profile-user">
          <div class="profile-avatar" id="pf-avatar">◈</div>
          <div>
            <div class="profile-username" id="pf-name">--</div>
            <div class="profile-email" id="pf-email" style="color:var(--text-secondary);font-size:13px">--</div>
            <div class="card-sub" style="margin-top:4px">信息学竞赛笔试刷题 · 备考 CSP-J/S · NOIP</div>
          </div>
        </div>
        <div class="profile-actions">
          <a class="btn btn-secondary" href="#/wrong-book">📕 错题本</a>
          <a class="btn btn-secondary" href="#/stats">📊 学习统计</a>
          <a class="btn btn-secondary" href="#/exams">📄 模拟考试</a>
          <button class="btn btn-danger" id="btn-logout">退出登录</button>
        </div>
      </div>`;

    try {
      const me = await api.get("/auth/me");
      app.querySelector("#pf-name").textContent = me.username || me.email || "--";
      app.querySelector("#pf-email").textContent = me.email ? `邮箱：${me.email}` : "--";
      const initial = (me.username || me.email || "◈").slice(0, 1).toUpperCase();
      app.querySelector("#pf-avatar").textContent = initial;
    } catch (e) {
      app.querySelector("#pf-name").textContent = "未登录";
    }

    app.querySelector("#btn-logout").addEventListener("click", async () => {
      const ok = await confirmDialog({ title: "退出登录", body: "确定要退出登录吗？", confirmText: "退出", danger: true });
      if (!ok) return;
      api.setToken("");
      window.dispatchEvent(new CustomEvent("auth:change", { detail: null }));
      toast("已退出登录", "info");
      location.hash = "#/";
    });
  },
  destroy() {},
};

/** 供 app.js 使用的登录态管理（简单的全局单例） */
export const Auth = {
  user: null,
  setUser(u) { this.user = u; },
  isLoggedIn() { return !!this.user || !!api.getToken(); },
};
