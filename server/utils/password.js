// ============================================================
// password.js —— 密码哈希（bcryptjs，无原生编译依赖）
// ============================================================
import bcrypt from 'bcryptjs';

/** 生成密码哈希（成本因子 10） */
export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

/** 校验明文密码与哈希是否匹配 */
export function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}
