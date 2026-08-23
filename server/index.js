// ============================================================
// index.js —— 后端入口：启动 HTTP 服务
// 启动：npm start（生产） / npm run dev（Node watch 热重启）
// ============================================================
import { createApp } from './app.js';
import { PORT } from './config.js';

const app = createApp();

app.listen(PORT, () => {
  console.log(`[oi-exam-practice] 后端已启动: http://localhost:${PORT}`);
  console.log(`[oi-exam-practice] 健康检查: GET /api/meta/competition-types`);
});
