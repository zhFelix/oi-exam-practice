// ============================================================
// auth.js —— 认证接口（F0）
// POST /api/auth/register  注册（注册即登录）
// POST /api/auth/login     登录
// GET  /api/auth/me        当前用户（恢复登录态）
// ============================================================
import { Router } from 'express';
import { ApiError } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { usersStore } from '../store/collections.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { signToken } from '../utils/jwt.js';
import { genId } from '../utils/id.js';
import { USERNAME_PATTERN, MIN_PASSWORD_LEN, AUTH_RATE_LIMIT } from '../config.js';

const router = Router();

// 登录/注册限流：每 IP 每 10 分钟 20 次（评审建议；内存实现，重启服务即重置）
const authLimiter = rateLimit({
  windowMs: AUTH_RATE_LIMIT.windowMs,
  max: AUTH_RATE_LIMIT.max,
  code: 'RATE_LIMITED',
  message: '操作过于频繁，请 10 分钟后再试',
});

function publicUser(user) {
  return { id: user.id, username: user.username };
}

/** 注册：用户名唯一 / 密码 ≥ 6 位 / 两次密码一致（PRD F0 DoD） */
router.post('/register', authLimiter, (req, res) => {
  const { username, password, confirmPassword } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
    throw new ApiError(400, 'INVALID_USERNAME', '用户名须为 3~20 位字母、数字或下划线');
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LEN) {
    throw new ApiError(400, 'WEAK_PASSWORD', `密码至少 ${MIN_PASSWORD_LEN} 位`);
  }
  if (password !== confirmPassword) {
    throw new ApiError(400, 'PASSWORD_MISMATCH', '两次输入的密码不一致');
  }
  if (usersStore.find({ username }).length > 0) {
    throw new ApiError(409, 'USERNAME_TAKEN', '用户名已存在');
  }
  const user = {
    id: genId('u'),
    username,
    password_hash: hashPassword(password),
    created_at: new Date().toISOString(),
  };
  usersStore.insert(user);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

/** 登录：失败统一返回 401 BAD_CREDENTIALS（不区分用户名/密码错误）；受 authLimiter 限流 */
router.post('/login', authLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const user = typeof username === 'string' ? usersStore.find({ username })[0] : null;
  if (!user || typeof password !== 'string' || !verifyPassword(password, user.password_hash)) {
    throw new ApiError(401, 'BAD_CREDENTIALS', '用户名或密码错误');
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

/** 当前用户（需登录，刷新页面后恢复登录态） */
router.get('/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username });
});

export default router;
