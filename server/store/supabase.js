// ============================================================
// supabase.js —— Supabase 客户端单例（t11 阶段1：框架）
// 说明：
//   - 本文件只负责创建并导出客户端，不涉及业务路由改动（阶段2 再替换存储实现）。
//   - 未配置 SUPABASE_URL / SUPABASE_KEY 时，客户端对象仍可创建，
//     但任何请求都会失败（占位 URL），此时业务代码应继续使用 JSON 文件存储。
//   - 使用 createClient(url, key) 的默认选项即可：
//     * auth.persistSession=false  —— 服务端不使用浏览器 localStorage
//     * auth.autoRefreshToken=false —— 服务端无自动刷新需求
//     * global.headers 可注入额外请求头（如后续需要）
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

/** Supabase 客户端单例（进程内唯一实例；用于 Auth API：createUser / signInWithPassword / getUser） */
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

/**
 * 数据操作专用客户端（t17 修复）：用于所有 `.from(表)` 读写（SupabaseStore / 题库试卷加载 / 用户资料写入）。
 * 背景：signInWithPassword 会把用户会话注入客户端内存，此后 .from() 请求将携带**用户 token**
 * （authenticated 角色）而非 service_role，导致启用 RLS 的表（如 users）插入被策略拒绝。
 * 本客户端绝不执行登录/注册，始终保持 service_role 权限。
 */
export const supabaseData = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

/** 是否已配置真实凭据（false = 占位配置，未接入真实项目） */
const configuredKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;
export const isSupabaseConfigured = !!(
  process.env.SUPABASE_URL &&
  configuredKey &&
  SUPABASE_URL !== 'https://placeholder.supabase.co' &&
  SUPABASE_KEY !== 'placeholder-anon-key'
);
