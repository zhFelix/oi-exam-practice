/* ============================================================
   pages/auth.js —— P9 登录 / P10 注册 / P11 个人中心
   - 登录成功回跳 redirect 参数指向的页面
   - 表单内联校验（用户名格式、密码 ≥6 位、两次一致、重名提示）
   ============================================================ */

import { api } from "../api.js";
import { toast, confirmDialog } from "../components.js";
import { escapeHtml } from "../utils.js";

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
              <label for="login-user">用户名</label>
              <input id="login-user" name="username" autocomplete="username" placeholder="请输入用户名" required>
              <div class="form-error" id="err-user"></div>
            </div>
            <div class="form-item">
              <label for="login-pass">密码</label>
              <input id="login-pass" name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required>
              <div class="form-error" id="err-pass"></div>
            </div>
            <button class="btn btn-primary btn-block" type="submit" id="btn-login">登 录</button>
          </form>
          <div class="form-footer">没有账号？<a href="#/register">立即注册</a></div>
          <div class="form-footer" id="demo-hint" style="display:none">💡 演示账号：<span class="mono">demo</span> / <span class="mono">123456</span></div>
        </div>
      </div>`;

    if (api.isMock) app.querySelector("#demo-hint").style.display = "block";

    const form = app.querySelector("#login-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const els = form.elements;
      const username = els.username.value.trim();
      const password = els.password.value;
      const errUser = app.querySelector("#err-user");
      const errPass = app.querySelector("#err-pass");
      errUser.textContent = ""; errPass.textContent = "";
      if (!username) { errUser.textContent = "请输入用户名"; return; }
      if (!password) { errPass.textContent = "请输入密码"; return; }
      const btn = app.querySelector("#btn-login");
      btn.disabled = true; btn.textContent = "登录中…";
      try {
        const data = await api.post("/auth/login", { username, password });
        api.setToken(data.token);
        window.dispatchEvent(new CustomEvent("auth:change", { detail: data.user }));
        toast(`欢迎回来，${data.user.username} 👋`, "success");
        location.hash = `#${redirect}`;
      } catch (err) {
        app.querySelector("#err-pass").textContent = err.message || "登录失败";
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
              <label for="reg-user">用户名</label>
              <input id="reg-user" name="username" autocomplete="username" placeholder="3~20 位字母、数字或下划线">
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
      const username = els.username.value.trim();
      const password = els.password.value;
      const confirmPassword = els.confirmPassword.value;
      const errUser = app.querySelector("#err-user");
      const errPass = app.querySelector("#err-pass");
      const errPass2 = app.querySelector("#err-pass2");
      errUser.textContent = ""; errPass.textContent = ""; errPass2.textContent = "";

      // 内联校验
      if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) { errUser.textContent = "用户名需为 3~20 位字母、数字或下划线"; return; }
      if (password.length < 6) { errPass.textContent = "密码至少 6 位"; return; }
      if (password !== confirmPassword) { errPass2.textContent = "两次输入的密码不一致"; return; }

      const btn = app.querySelector("#btn-reg");
      btn.disabled = true; btn.textContent = "注册中…";
      try {
        const data = await api.post("/auth/register", { username, password, confirmPassword });
        api.setToken(data.token);
        window.dispatchEvent(new CustomEvent("auth:change", { detail: data.user }));
        toast("注册成功，已自动登录 🎉", "success");
        location.hash = `#${redirect}`;
      } catch (err) {
        // 服务端错误（如重名 409）按错误码就地显示
        if (err.code === "USERNAME_TAKEN") errUser.textContent = err.message;
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
            <div class="card-sub">信息学竞赛笔试刷题 · 备考 CSP-J/S · NOIP</div>
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
      app.querySelector("#pf-name").textContent = me.username;
      app.querySelector("#pf-avatar").textContent = me.username ? me.username.slice(0, 1).toUpperCase() : "◈";
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
