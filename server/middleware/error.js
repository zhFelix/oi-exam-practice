// ============================================================
// error.js —— 业务错误类型 + 统一错误响应中间件
// 错误响应格式：{ "error": { "code": "...", "message": "..." } }
// ============================================================

/** 业务错误：throw new ApiError(status, code, message) 在路由中抛出 */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** API 404：仅对 /api 前缀返回 JSON，静态资源 404 交给 Express 默认处理 */
export function notFoundHandler(req, res) {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
  } else {
    res.status(404).send('Not Found');
  }
}

/** 统一错误处理中间件（必须 4 参数，Express 据此识别为错误处理） */
export function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  // 请求体 JSON 解析失败
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: '请求体不是合法 JSON' } });
  }
  console.error('[server error]', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: '服务器内部错误' } });
}
