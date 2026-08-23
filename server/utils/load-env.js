// ============================================================
// load-env.js —— 极简 .env 加载器（零依赖）
// 读取项目根目录 .env（若存在），写入 process.env；
// 不覆盖已存在的环境变量（shell 环境优先）。
// 在 server/config.js 顶部引入，所有入口（server/migrate/apply）自动生效。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '..', '.env'); // 项目根 .env

if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // 去除可选引号
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
