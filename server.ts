import express from "express";
import adminHandler from "./api/admin";
import path from "path";
import { createClient } from "@supabase/supabase-js";

/**
 * Self-contained Supabase client initialization.
 */
const getSupabase = () => {
  const url = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  
  if (!url || !key) {
    throw new Error('Supabase configuration missing (VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required)');
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
};

import marketWatcherCronHandler from "./api/cron/market-watcher";
import liveRatesHandler from "./api/live-rates";
import telegramWebhookHandler from "./api/telegram/webhook";
import watcherStartHandler from "./api/watcher/start";
import watcherScanHandler from "./api/watcher/scan";

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
  app.all("/api/admin/*", adminHandler as any);

  async function adminGuard(req: express.Request, res: express.Response, next: express.NextFunction) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
    
    if (!token) {
      return res.status(401).json({ success: false, error: "Unauthorized: Missing authentication token." });
    }
    
    try {
      const supabase = getSupabase();
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
      console.error("Admin guard error:", err);
      return res.status(500).json({ success: false, error: "Internal server error during authorization check." });
    }
  }

  // Admin APIs
                      
  // Watcher APIs
  app.post("/api/watcher/start", watcherStartHandler as any);
  app.post("/api/watcher/scan", watcherScanHandler as any);
  app.post("/api/watcher/activate", watcherStartHandler as any);

  // Live Rates
  app.get("/api/live-rates", liveRatesHandler as any);

  // Telegram Webhook
  app.post("/api/telegram/webhook", telegramWebhookHandler as any);
  app.get("/api/telegram/webhook", telegramWebhookHandler as any);

  // Scheduled Cron execution for active market watchers
  app.post("/api/cron/market-watcher", marketWatcherCronHandler as any);

  // Catch-all route to serve API list/health indicator since we are an API-only server now
  app.get("/", (req, res) => {
    res.json({
      status: "online",
      service: "Gaks AI Backend API",
      message: "This server is acting strictly as an API backend.",
      endpoints: [
        "GET /",
        "GET /api/telegram/webhook",
        "POST /api/telegram/webhook",
        "POST /api/watcher/start",
        "GET /api/live-rates",
        "POST /api/cron/market-watcher"
      ],
      timestamp: new Date().toISOString()
    });
  });

  // Catch-all 404 for other unhandled routes
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: "Endpoint not found",
      message: `The route ${req.method} ${req.path} is not registered on this backend.`
    });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
