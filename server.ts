import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

import adminHandler from './api/admin.js';
import watcherHandler from './api/watcher.js';
import liveRatesHandler from './api/live-rates.js';
import performanceSnapshotHandler from './api/performance/snapshot.js';
import strategySummaryHandler from './api/strategy/summary.js';
import telegramWebhookHandler from './api/telegram/webhook.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const port = process.env.PORT || 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Global CORS middleware
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    next();
  });

  // API status endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // API handlers
  app.all('/api/admin*', (req, res) => adminHandler(req as any, res as any));
  app.all('/api/watcher*', (req, res) => watcherHandler(req as any, res as any));
  app.all('/api/live-rates*', (req, res) => liveRatesHandler(req as any, res as any));
  app.all('/api/cron/market-watcher*', async (req, res) => {
    try {
      const { default: cronHandler } = await import('./api/cron/market-watcher.js');
      return cronHandler(req as any, res as any);
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });
  app.all('/api/performance/snapshot*', (req, res) => performanceSnapshotHandler(req as any, res as any));
  app.all('/api/strategy/summary*', (req, res) => strategySummaryHandler(req as any, res as any));
  app.all('/api/telegram/webhook*', (req, res) => telegramWebhookHandler(req as any, res as any));
  app.all('/api/telegram-webhook*', (req, res) => telegramWebhookHandler(req as any, res as any));

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(Number(port), '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
  });
}

startServer().catch(console.error);

