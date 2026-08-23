/* ============================================================
   api.js —— fetch 封装
   - 统一注入 JWT（localStorage: oi_token）
   - 统一错误处理（ApiError）
   - 后端不可用时自动降级为本地演示模式（mock.js），方便无后端联调预览
   ============================================================ */

import { MockBackend } from "./mock.js";

/** 业务错误（携带后端返回的 code 与 message） */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || "请求失败");
    this.status = status;
    this.code = code;
  }
}

const TOKEN_KEY = "oi_token";
let mockMode = false; // 是否已降级到本地演示模式

export const api = {
  /** 是否处于演示模式（无后端时的本地兜底） */
  get isMock() {
    return mockMode;
  },

  getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  },
  setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  },

  /** GET 请求（params 转查询串） */
  async get(path, params) {
    return request("GET", path, null, params);
  },
  /** POST 请求 */
  async post(path, body) {
    return request("POST", path, body);
  },
  /** DELETE 请求 */
  async del(path) {
    return request("DELETE", path);
  },
};

/** 核心请求函数 */
async function request(method, path, body, params) {
  // ---- 尝试真实后端 ----
  try {
    const url = `/api${path}${params ? toQuery(params) : ""}`;
    const headers = { "Content-Type": "application/json" };
    const token = api.getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(url, {
      method,
      headers,
      // GET/HEAD 携带 body 会触发 fetch 规范 TypeError（"Request with GET/HEAD method cannot have body"）
      body: method === "GET" || method === "HEAD" ? undefined : (body === undefined ? undefined : JSON.stringify(body)),
    });

    const contentType = res.headers.get("content-type") || "";
    // 后端返回非 JSON（如静态服务器对 /api 的 404）→ 视为无后端，降级演示模式
    if (!contentType.includes("application/json")) {
      throw new NotBackendError();
    }

    const data = await res.json();
    if (!res.ok) {
      const err = data && data.error ? data.error : {};
      throw new ApiError(res.status, err.code || "ERROR", err.message || `请求失败(${res.status})`);
    }
    // 401 时清理登录态（登录接口自身的 401 除外）
    if (res.status === 401 && path !== "/auth/login" && path !== "/auth/register") {
      api.setToken("");
    }
    return data;
  } catch (e) {
    // 业务错误（后端正常返回的错误结构）直接抛出
    if (e instanceof ApiError) throw e;
    // 其余情况（网络错误 / 非 JSON 响应 / 解析失败）→ 视为无后端，降级本地演示模式
    mockMode = true;
    console.warn("[api] 后端 API 不可用，已切换到本地演示模式（MockBackend）。", e && e.message ? e.message : e);
    return MockBackend.handle(method, path, body, params);
  }
}

/** 内部标记：非 JSON 响应（说明没有真实后端） */
class NotBackendError extends Error {}

function toQuery(params) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") sp.set(k, v);
  });
  const s = sp.toString();
  return s ? `?${s}` : "";
}
