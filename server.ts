import express from "express";
import adminHandler from "./api/admin";
import path from "path";
import marketWatcherCronHandler from "./api/cron/market-watcher";
import testCronHandler from "./api/cron/test";
import liveRatesHandler from "./api/live-rates";
import telegramWebhookHandler from "./api/telegram/webhook";
import watcherStartHandler from "./api/watcher/start";
import watcherScanHandler from "./api/watcher/scan";
import watcherStopHandler from "./api/watcher/stop";
import watcherResolveTradeHandler from "./api/watcher/resolve-trade";
import watcherReplayHandler from "./api/watcher/replay";
import strategySummaryHandler from "./api/strategy/summary";
import performanceSnapshotHandler from "./api/performance/snapshot";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // CORS Middleware
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigins = [
      "https://gaks-ai.vercel.app",
      "http://localhost:5173",
      "http://localhost:3000"
    ];
    
    if (origin && (allowedOrigins.includes(origin) || origin.endsWith(".vercel.app") || origin.endsWith(".run.app"))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    } else {
      res.setHeader("Access-Control-Allow-Origin", "https://gaks-ai.vercel.app");
    }

    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    res.setHeader("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  app.use(express.json());

  // Admin Verification Guard Middleware


  app.use("/api/admin", adminGuard);
  app.all(["/api/admin", "/api/admin/*"], adminHandler as any);

  async function adminGuard(req: express.Request, res: express.Response, next: express.NextFunction) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
    
    if (!token) {
      return res.status(401).json({ success: false, error: "Unauthorized: Missing authentication token." });
    }
    
    try {
      const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
      const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase configuration missing');
      }
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return res.status(401).json({ success: false, error: "Unauthorized: Invalid authentication token." });
      }
      
      const email = user.email?.trim().toLowerCase();
      const ADMIN_EMAIL = "gaks6535@gmail.com";
      if (email !== ADMIN_EMAIL) {
        return res.status(403).json({ success: false, error: "Unauthorized: Insufficient privileges." });
      }
      
      (req as any).user = user;
      next();
    } catch (err: any) {
      console.error("[DIAGNOSTIC] Admin guard error:", err);
      return res.status(500).json({ success: false, error: "Internal server error during authorization check.", details: err.message });
    }
  }

  // Admin APIs
                      
  // Strategy APIs
  app.post("/api/strategy/summary", strategySummaryHandler as any);

  // Performance Visibility APIs
  app.get("/api/performance/snapshot", performanceSnapshotHandler as any);
  app.post("/api/performance/snapshot", performanceSnapshotHandler as any);

  // Watcher APIs
  app.post("/api/watcher/start", watcherStartHandler as any);
  app.post("/api/watcher/scan", watcherScanHandler as any);
  app.post("/api/watcher/activate", watcherStartHandler as any);
  app.post("/api/watcher/stop", watcherStopHandler as any);
  app.delete("/api/watcher/stop", watcherStopHandler as any);
  app.post("/api/watcher/resolve-trade", watcherResolveTradeHandler as any);
  app.all("/api/watcher/replay", watcherReplayHandler as any);

  // Live Rates
  app.get("/api/live-rates", liveRatesHandler as any);

  // Telegram Webhook
  app.post("/api/telegram/webhook", telegramWebhookHandler as any);
  app.get("/api/telegram/webhook", telegramWebhookHandler as any);

  // Scheduled Cron execution for active market watchers
  app.post("/api/cron/market-watcher", marketWatcherCronHandler as any);
  app.all("/api/cron/test", testCronHandler as any);

  app.post("/api/log-error", (req, res) => {
    require('fs').writeFileSync('client-error.log', JSON.stringify(req.body, null, 2) + '\n', { flag: 'a' });
    res.sendStatus(200);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
