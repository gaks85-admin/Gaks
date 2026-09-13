import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

// Import all API handlers
// @ts-ignore
import liveRatesHandler from './api/live-rates.ts';
// @ts-ignore
import marketWatcherCronHandler from './api/cron/market-watcher.ts';
// @ts-ignore
import watcherHandler from './api/watcher.ts';
// @ts-ignore
import strategySummaryHandler from './api/strategy/summary.ts';
// @ts-ignore
import telegramWebhookHandler from './api/telegram/webhook.ts';
// @ts-ignore
import performanceSnapshotHandler from './api/performance/snapshot.ts';
// @ts-ignore
import adminHandler from './api/admin.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware for body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // API Routes mapping
  app.all('/api/live-rates', (req, res) => liveRatesHandler(req, res));
  app.all('/api/cron/market-watcher', (req, res) => marketWatcherCronHandler(req, res));
  app.all('/api/watcher*', (req, res) => watcherHandler(req, res));
  app.all('/api/strategy/summary', (req, res) => strategySummaryHandler(req, res));
  app.all('/api/telegram-webhook', (req, res) => telegramWebhookHandler(req, res));
  app.all('/api/telegram/webhook', (req, res) => telegramWebhookHandler(req, res));
  app.all('/api/performance/snapshot', (req, res) => performanceSnapshotHandler(req, res));
  app.all('/api/admin*', (req, res) => adminHandler(req, res));
  app.all('/api/*', (req, res) => res.status(404).json({ error: 'API route not found' }));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.warn("Vite dev server failed to start. Continuing without it.", err);
    }
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
