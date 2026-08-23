// ============================================================
// index.js —— 后端入口：启动 HTTP 服务
// 启动：npm start（生产） / npm run dev（Node watch 热重启）
// ============================================================
import { createApp } from './app.js';
import { PORT } from './config.js';
import { flushStores } from './store/collections.js';

const app = await createApp();

app.listen(PORT, () => {
  console.log(`[oi-exam-practice] 后端已启动: http://localhost:${PORT}`);
  console.log(`[oi-exam-practice] 健康检查: GET /api/meta/competition-types`);
});

// 优雅退出：先排空 Supabase 写队列再退出（避免重启丢数据）
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[oi-exam-practice] 收到 ${signal}，排空存储写队列后退出…`);
  try {
    await flushStores();
  } catch (e) {
    console.error('[oi-exam-practice] 退出前排空写队列失败:', e.message);
  }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
