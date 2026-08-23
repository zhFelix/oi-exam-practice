// ============================================================
// auth.js —— JWT 鉴权中间件
// requireAuth：必须登录（挂 req.user），未带/失效返回 401
// optionalAuth：可选登录（有有效 token 则挂 req.user，否则放行）
// ============================================================
import { verifyToken } from '../utils/jwt.js';
import { ApiError } from './error.js';

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

function payloadToUser(payload) {
  return { id: payload.sub, username: payload.username };
}

/** 必须登录 */
export function requireAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next(new ApiError(401, 'UNAUTHORIZED', '请先登录'));
  try {
    req.user = payloadToUser(verifyToken(token));
    next();
  } catch {
    next(new ApiError(401, 'UNAUTHORIZED', '登录已过期，请重新登录'));
  }
}

/** 可选登录：匿名可访问接口中，登录后可额外获取敏感字段 */
export function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next();
  try {
    req.user = payloadToUser(verifyToken(token));
  } catch {
    // 无效 token 按匿名处理，不阻断访问
  }
  next();
}
