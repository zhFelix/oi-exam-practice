// ============================================================
// jwt.js —— JWT 签发 / 校验（jsonwebtoken，Legacy 模式）
// payload: { sub: userId, username, email }
// ============================================================
import jwt from 'jsonwebtoken';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config.js';

/** 签发 JWT（有效期默认 7 天） */
export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, email: user.email || null },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/** 校验 JWT，返回 payload；无效/过期抛错 */
export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
