// ============================================================
// app.js —— 组装 Express 应用：静态资源 + 中间件 + 路由
// ============================================================
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { FRONTEND_DIR } from './config.js';
import { initQuestionBank, initExams, initStores } from './store/collections.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';
import { requireAuth } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import metaRoutes from './routes/meta.js';
import questionsRoutes from './routes/questions.js';
import practiceRoutes, { handleSubmit } from './routes/practice.js';
import wrongBookRoutes from './routes/wrong-book.js';
import statsRoutes from './routes/stats.js';
import examsRoutes from './routes/exams.js';

/**
 * 创建 Express 应用（t12：启动时先加载题库/模拟卷并初始化存储层
 * —— Supabase 优先，不可用时回退 JSON 文件）
 */
export async function createApp() {
  await initQuestionBank();
  await initExams();
  await initStores();

  const app = express();
  app.use(express.json());

  // 前端静态资源托管（public/ 或 web/，存在才启用）
  if (FRONTEND_DIR) {
    app.use(express.static(FRONTEND_DIR));
    // SPA：未匹配的 GET 请求回退到 index.html（hash 路由由前端接管）
    app.get(/^\/(?!api\/).*/, (req, res) => {
      const index = path.join(FRONTEND_DIR, 'index.html');
      if (fs.existsSync(index)) res.sendFile(index);
      else res.status(404).send('Not Found');
    });
  }

  // API 路由
  app.use('/api/auth', authRoutes);
  app.use('/api/meta', metaRoutes);
  app.use('/api/questions', questionsRoutes);
  app.use('/api/practice', practiceRoutes);
  app.post('/api/submit', requireAuth, handleSubmit); // 任务要求的别名路径（与 /api/practice/submit 等价）
  app.use('/api/wrong-book', wrongBookRoutes);
  app.use('/api/stats', statsRoutes);
  app.use('/api/exams', examsRoutes);

  // 兜底：404 + 统一错误处理
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
