// ============================================================
// rate-limit.js —— 简单内存限流中间件（按 IP 滑动窗口计数）
// 说明：单机单进程场景够用；进程重启即重置计数。
// 超出限额返回 429，错误码可配置（默认 RATE_LIMITED），并附带 Retry-After 响应头。
// ============================================================

/**
 * 创建限流中间件
 * @param {object} opts
 *   windowMs 窗口毫秒数
 *   max      窗口内最大请求数
 *   code     错误码（默认 RATE_LIMITED）
 *   message  错误提示（默认"请求过于频繁，请稍后再试"）
 * @returns Express 中间件
 */
export function rateLimit({ windowMs, max, code = 'RATE_LIMITED', message = '请求过于频繁，请稍后再试' }) {
  const hits = new Map(); // ip -> { count, resetAt }

  return function rateLimitMiddleware(req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();

    let rec = hits.get(ip);
    if (!rec || now >= rec.resetAt) {
      rec = { count: 0, resetAt: now + windowMs };
      hits.set(ip, rec);
    }
    rec.count += 1;

    if (rec.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((rec.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfterSec));
      return res.status(429).json({ error: { code, message } });
    }
    next();
  };
}
