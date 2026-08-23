// ============================================================
// config.js —— 服务器配置与枚举定义（支持环境变量覆盖）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 路径
export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
/** 前端静态目录：优先 public/（前端工程师实际使用），回退 web/（架构文档建议），都没有则只提供 API */
export const FRONTEND_DIR = ['public', 'web']
  .map((c) => path.join(ROOT_DIR, c))
  .find((p) => fs.existsSync(p)) || null;

// 服务
export const PORT = Number(process.env.PORT || 3000);

/** JWT 签名密钥：生产环境必须通过环境变量 JWT_SECRET 注入；未设置时使用开发默认值并告警 */
export const JWT_SECRET = process.env.JWT_SECRET || 'oi-exam-practice-dev-secret';
export const JWT_EXPIRES_IN = '7d';
if (!process.env.JWT_SECRET) {
  console.warn(
    '[config] ⚠ 未设置 JWT_SECRET 环境变量，正在使用开发默认密钥（仅限本地开发）。' +
    '生产部署请设置环境变量：set JWT_SECRET=<随机长字符串>（PowerShell）/ export JWT_SECRET=...（Linux）'
  );
}

// 登录/注册接口限流（评审建议）：每 IP 每 10 分钟 20 次，超出返回 429（内存实现，重启服务即重置）
export const AUTH_RATE_LIMIT = {
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
};

// 题型（与 data/questions.json 顶层 question_types 一致）
export const QUESTION_TYPES = ['single', 'multiple', 'judge', 'reading'];

// 题型默认分值（题目数据未显式标注 score 时使用；reading 为子题分值之和）
export const DEFAULT_SCORE = { single: 1, multiple: 2, judge: 1 };

// 难度：数据存储为 beginner/intermediate/advanced，接口筛选兼容 1|2|3（架构文档 §6.2）
export const DIFFICULTY_MAP = {
  '1': 'beginner', '2': 'intermediate', '3': 'advanced',
  beginner: 'beginner', intermediate: 'intermediate', advanced: 'advanced',
};

// 错题本自动移出阈值：重练连续答对次数（PRD F4.4 默认 2 次）
export const WRONG_BOOK_REMOVE_STREAK = 2;

// 分页上限（PRD 非功能 §8.1：列表 ≤ 50 条/页）
export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 20;

// 用户名规则（3~20 位字母数字下划线）
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
export const MIN_PASSWORD_LEN = 6;
