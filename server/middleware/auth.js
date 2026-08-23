// ============================================================
// auth.js —— 鉴权中间件（t17：Supabase Auth 优先，自建 JWT 降级）
// requireAuth：必须登录（挂 req.user），未带/失效返回 401
// optionalAuth：可选登录（有有效 token 则挂 req.user，否则放行）
//
// 双模式：
//   Supabase Auth 模式（supabaseMode=true）：Bearer 为 Supabase access_token，
//     通过 supabase.auth.getUser(token) 验证（不自行验签，交给 GoTrue）；
//     req.user.id = Supabase auth uid（uuid 字符串）
//   Legacy 模式（未配置 Supabase）：自建 JWT（jsonwebtoken）验证，逻辑不变
// ============================================================
import { verifyToken } from '../utils/jwt.js';
import { supabase } from '../store/supabase.js';
import { supabaseMode } from '../store/collections.js';
import { ApiError } from './error.js';

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/** 自建 JWT payload → req.user（Legacy 模式） */
function payloadToUser(payload) {
  return { id: payload.sub, username: payload.username, email: payload.email || null };
}

/** Supabase Auth user → req.user（id = auth uid；username 取自 user_metadata，缺省回退 email 前缀） */
function authUserToReqUser(authUser) {
  const username = (authUser.user_metadata && authUser.user_metadata.username) || null;
  return { id: authUser.id, username, email: authUser.email || null };
}

/** 必须登录 */
export function requireAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next(new ApiError(401, 'UNAUTHORIZED', '请先登录'));

  if (supabaseMode) {
    supabase.auth.getUser(token)
      .then(({ data, error }) => {
        if (error || !data.user) {
          return next(new ApiError(401, 'UNAUTHORIZED', '登录已过期，请重新登录'));
        }
        req.user = authUserToReqUser(data.user);
        next();
      })
      .catch(() => next(new ApiError(401, 'UNAUTHORIZED', '登录已过期，请重新登录')));
    return;
  }

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

  if (supabaseMode) {
    supabase.auth.getUser(token)
      .then(({ data, error }) => {
        if (!error && data.user) req.user = authUserToReqUser(data.user);
        next();
      })
      .catch(() => next()); // 无效 token 按匿名处理，不阻断访问
    return;
  }

  try {
    req.user = payloadToUser(verifyToken(token));
  } catch {
    // 无效 token 按匿名处理，不阻断访问
  }
  next();
}
