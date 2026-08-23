// ============================================================
// id.js —— 生成唯一 id（时间戳 + 随机后缀，无自增依赖）
// ============================================================

/**
 * 生成形如 `<prefix>_<时间戳36进制>_<随机6位>` 的唯一 id
 * @param {string} prefix 前缀（如 u / a / w）
 */
export function genId(prefix = 'id') {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ts}_${rand}`;
}
