// ============================================================
// auth.js —— 认证接口（F0，t17：Supabase Auth 迁移 - 后端代理模式）
// POST /api/auth/register  注册（注册即登录；登录标识为 email）
// POST /api/auth/login     登录（{email, password}）
// GET  /api/auth/me        当前用户（恢复登录态）
//
// 双模式：
//   Supabase Auth 模式（supabaseMode=true）：
//     register → supabase.auth.admin.createUser（email_confirm: true，免邮件确认）
//                 + 写入自建 public.users（id = Supabase auth uid）
//     login    → supabase.auth.signInWithPassword，token 为 Supabase access_token
//   Legacy 模式（未配置 Supabase）：自建 bcrypt + JWT（data/users.json 路径），
//     登录标识兼容 username 或 email
// 错误码保持现有契约：USERNAME_TAKEN / BAD_CREDENTIALS / WEAK_PASSWORD 等，
// 新增 EMAIL_TAKEN / INVALID_EMAIL。
// ============================================================
import { Router } from 'express';
import { ApiError, asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { usersStore, supabaseMode } from '../store/collections.js';
import { supabase, supabaseData } from '../store/supabase.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { signToken } from '../utils/jwt.js';
import { genId } from '../utils/id.js';
import { USERNAME_PATTERN, MIN_PASSWORD_LEN, AUTH_RATE_LIMIT } from '../config.js';

const router = Router();

// 登录/注册限流：每 IP 每 10 分钟 20 次（内存实现，重启服务即重置）
const authLimiter = rateLimit({
  windowMs: AUTH_RATE_LIMIT.windowMs,
  max: AUTH_RATE_LIMIT.max,
  code: 'RATE_LIMITED',
  message: '操作过于频繁，请 10 分钟后再试',
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user) {
  return { id: user.id, username: user.username, email: user.email || null };
}

/** 统一入参校验（两种模式共用）：email / username / password / confirmPassword */
function validateRegisterBody(body) {
  const { email, username, password, confirmPassword } = body || {};
  if (typeof email !== 'string' || !EMAIL_PATTERN.test(email)) {
    throw new ApiError(400, 'INVALID_EMAIL', '邮箱格式不正确');
  }
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
    throw new ApiError(400, 'INVALID_USERNAME', '用户名须为 3~20 位字母、数字或下划线');
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LEN) {
    throw new ApiError(400, 'WEAK_PASSWORD', `密码至少 ${MIN_PASSWORD_LEN} 位`);
  }
  if (password !== confirmPassword) {
    throw new ApiError(400, 'PASSWORD_MISMATCH', '两次输入的密码不一致');
  }
  return { email: email.trim().toLowerCase(), username, password };
}

/** 写入自建 public.users（Supabase 模式，使用 supabaseData 保持 service_role）：id = auth uid；兼容迁移前 schema（缺 email/auth_uid 列、password_hash 仍 NOT NULL 时降级写入） */
async function insertPublicUser(row) {
  const { error } = await supabaseData.from('users').insert(row);
  const missingColumn = error && (error.code === '42703' || /column/i.test(String(error && error.message)));
  if (missingColumn && (row.email !== undefined || row.auth_uid !== undefined)) {
    // users 表尚未执行 scripts/supabase-auth-migration.sql（缺 email/auth_uid 列）
    console.warn('[auth] ⚠ users 表缺少 email/auth_uid 列（请执行 scripts/supabase-auth-migration.sql），本次以兼容模式写入（不含新增列，password_hash 置空串）');
    const { email, auth_uid, ...legacyRow } = row;
    const retry = await supabaseData.from('users').insert({
      ...legacyRow,
      password_hash: legacyRow.password_hash ?? '',
    });
    return retry;
  }
  return { error };
}

// ---------- 注册 ----------

/** 注册（Supabase Auth 模式）：createUser 免邮件确认，返回 Supabase session */
async function registerSupabase(email, username, password) {
  // 昵称唯一（自建表维护；email 唯一由 GoTrue 保证）
  if (usersStore.find({ username }).length > 0) {
    throw new ApiError(409, 'USERNAME_TAKEN', '用户名已存在');
  }
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // 免邮件确认流程（后端代理模式）
    user_metadata: { username },
  });
  if (createError) {
    const msg = String(createError.message || '');
    if (createError.status === 422 || /already.*regist|duplicate|exists/i.test(msg)) {
      throw new ApiError(409, 'EMAIL_TAKEN', '该邮箱已被注册');
    }
    throw new ApiError(500, 'AUTH_SERVICE_ERROR', `Supabase Auth 注册失败：${msg}`);
  }
  const authUser = created.user;
  // 写入自建 public.users（id = auth uid；密码由 GoTrue 管理，password_hash 置空）
  const row = {
    id: authUser.id,
    username,
    email,
    auth_uid: authUser.id,
    password_hash: null,
    created_at: new Date().toISOString(),
  };
  const { error: insertError } = await insertPublicUser(row);
  if (insertError) {
    throw new ApiError(500, 'AUTH_SERVICE_ERROR', `写入用户资料失败：${insertError.message}`);
  }
  usersStore.cachePush(row); // 同步内存缓存（避免重复持久化）

  // 注册即登录：取回 session（email_confirm 已置 true，可直接登录）
  const { data: sessionData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError || !sessionData.session) {
    throw new ApiError(500, 'AUTH_SERVICE_ERROR', '注册成功但登录失败，请直接登录');
  }
  return { token: sessionData.session.access_token, user: { id: authUser.id, username, email } };
}

/** 注册（Legacy 模式）：bcrypt 哈希 + 自建 JWT，邮箱与用户名均可作为登录标识 */
function registerLegacy(email, username, password) {
  if (usersStore.find({ username }).length > 0) {
    throw new ApiError(409, 'USERNAME_TAKEN', '用户名已存在');
  }
  if (usersStore.find({ email }).length > 0) {
    throw new ApiError(409, 'EMAIL_TAKEN', '该邮箱已被注册');
  }
  const user = {
    id: genId('u'),
    username,
    email,
    password_hash: hashPassword(password),
    created_at: new Date().toISOString(),
  };
  usersStore.insert(user);
  return { token: signToken(user), user: publicUser(user) };
}

router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const { email, username, password } = validateRegisterBody(req.body);
  const result = supabaseMode
    ? await registerSupabase(email, username, password)
    : registerLegacy(email, username, password);
  res.status(201).json(result);
}));

// ---------- 登录 ----------

router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || !EMAIL_PATTERN.test(email) || typeof password !== 'string') {
    throw new ApiError(401, 'BAD_CREDENTIALS', '用户名或密码错误');
  }
  const normalizedEmail = email.trim().toLowerCase();

  if (supabaseMode) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    if (error || !data.session || !data.user) {
      throw new ApiError(401, 'BAD_CREDENTIALS', '用户名或密码错误');
    }
    const u = data.user;
    res.json({
      token: data.session.access_token,
      user: {
        id: u.id,
        username: (u.user_metadata && u.user_metadata.username) || u.email,
        email: u.email || null,
      },
    });
    return;
  }

  // Legacy：兼容 username 或 email 登录
  const user = usersStore.find({ username: normalizedEmail })[0] || usersStore.find({ email: normalizedEmail })[0];
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new ApiError(401, 'BAD_CREDENTIALS', '用户名或密码错误');
  }
  res.json({ token: signToken(user), user: publicUser(user) });
}));

// ---------- 当前用户 ----------

/** 当前用户（需登录；Supabase 模式 req.user 来自 GoTrue，Legacy 模式来自自建 JWT） */
router.get('/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username || null, email: req.user.email || null });
});

export default router;
