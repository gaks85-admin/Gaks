import express from "express";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI, Type } from "@google/genai";
import marketWatcherCronHandler from "./api/cron/market-watcher";

interface ERResponse {
  result: string;
  rates: Record<string, number>;
}

interface LivePairData {
  symbol: string;
  name: string;
  basePrice: number;
  currentPrice: number;
  change: number;
  sentiment: 'Bullish' | 'Bearish';
  history: number[];
}

const PAIR_METADATA = [
  { symbol: "EURUSD", base: "EUR", quote: "USD", name: "Euro / US Dollar", isUSDQuote: true },
  { symbol: "GBPUSD", base: "GBP", quote: "USD", name: "British Pound / US Dollar", isUSDQuote: true },
  { symbol: "USDJPY", base: "USD", quote: "JPY", name: "US Dollar / Japanese Yen", isUSDQuote: false },
  { symbol: "USDCAD", base: "USD", quote: "CAD", name: "US Dollar / Canadian Dollar", isUSDQuote: false },
  { symbol: "AUDUSD", base: "AUD", quote: "USD", name: "Australian Dollar / US Dollar", isUSDQuote: true },
  { symbol: "NZDUSD", base: "NZD", quote: "USD", name: "New Zealand Dollar / US Dollar", isUSDQuote: true },
  { symbol: "USDCHF", base: "USD", quote: "CHF", name: "US Dollar / Swiss Franc", isUSDQuote: false },
];

const DEFAULT_STRATEGY_TEXT = `# Gaks AI Default Strategy

## 1. Overview
This is the default, institutional-grade multi-timeframe strategy designed for capturing consistent intraday trends in liquid assets (Forex, major Indices, and BTC). It relies on price action structures, key liquidity zones, and volume confirmation to filter out noise.

## 2. Core Methodology & Rules
- **Timeframe Alignment**: Primary analysis on the 1-Hour (H1) chart for structural trend direction, refined on the 15-Minute (M15) chart for precise execution triggers.
- **Support & Resistance / Liquidity**: Identify major daily/weekly highs, lows, and key order blocks. Signals are only generated when price tests these key institutional zones.
- **Momentum & Volume Confirmation**: A trade entry requires a strong candlestick rejection pattern (pin bar, engulfing) accompanied by volume expansion or a clear breakout of local structure (Break of Structure - BOS).
- **Trend Following**: Always prioritize trading in the direction of the dominant H1 market trend. Counter-trend setups require exceptional rejection patterns at critical daily boundaries.

## 3. Risk & Money Management (Strict 1% Rule)
- **Risk Per Trade**: Maximum of 1.0% of total account capital per trade setup.
- **Risk-to-Reward Ratio (R:R)**: Minimum target of 1:2. Trailing stops may be employed to secure profits once the first target (1:1) is achieved.
- **Stop Loss Placement**: Always placed structurally beyond the swing high/low of the trigger candlestick or key institutional zone boundary.
- **Daily Drawdown Cap**: If a user experiences 3 consecutive losses in a 24-hour cycle, trading must halt for that day to preserve capital and prevent emotional over-trading.`;

function extractStrategyTextById(strategyTextRaw: string, strategyId?: string): string {
  if (!strategyTextRaw || !strategyTextRaw.trim()) return DEFAULT_STRATEGY_TEXT;
  const defaultTemplate = `• Entry conditions\n• Confirmation indicators\n• Exit & stop-loss logic\n• Risk management rules`;
  if (strategyTextRaw.trim() === defaultTemplate.trim()) return DEFAULT_STRATEGY_TEXT;

  try {
    const parsed = JSON.parse(strategyTextRaw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.strategies)) {
      const targetId = strategyId || parsed.activeId;
      const active = parsed.strategies.find((s: any) => {
        if (targetId === '00000000-0000-0000-0000-000000000000' || targetId === 'default') {
          return s.id === '00000000-0000-0000-0000-000000000000' || s.id === 'default' || s.isDefault;
        }
        if (targetId === '11111111-1111-1111-1111-111111111111' || targetId === '11111111-1111-1111-1111-111111111111') {
          return s.id === '11111111-1111-1111-1111-111111111111' || s.id === '11111111-1111-1111-1111-111111111111';
        }
        return s.id === targetId;
      }) || parsed.strategies[0];
      return active ? (active.text || DEFAULT_STRATEGY_TEXT) : DEFAULT_STRATEGY_TEXT;
    }
  } catch (e) {
    // Not JSON, return as-is
  }
  return strategyTextRaw;
}

function extractActiveStrategyDetails(strategyText: string) {
  const DEFAULT_STRATEGY_NAME = 'Gaks AI Default Strategy';
  const DEFAULT_STRATEGY_UUID = '00000000-0000-0000-0000-000000000000';
  const LEGACY_CUSTOM_STRATEGY_UUID = '11111111-1111-1111-1111-111111111111';

  if (!strategyText || !strategyText.trim()) {
    return { id: DEFAULT_STRATEGY_UUID, name: DEFAULT_STRATEGY_NAME, text: DEFAULT_STRATEGY_TEXT, isDefault: true };
  }
  const defaultTemplate = `• Entry conditions\n• Confirmation indicators\n• Exit & stop-loss logic\n• Risk management rules`;
  if (strategyText.trim() === defaultTemplate.trim()) {
    return { id: DEFAULT_STRATEGY_UUID, name: DEFAULT_STRATEGY_NAME, text: DEFAULT_STRATEGY_TEXT, isDefault: true };
  }

  try {
    const parsed = JSON.parse(strategyText);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.strategies)) {
      const active = parsed.strategies.find((s: any) => {
        if (parsed.activeId === 'default' || parsed.activeId === DEFAULT_STRATEGY_UUID) {
          return s.id === 'default' || s.id === DEFAULT_STRATEGY_UUID || s.isDefault;
        }
        return s.id === parsed.activeId;
      }) || parsed.strategies[0];

      let finalId = active ? active.id : DEFAULT_STRATEGY_UUID;
      if (finalId === 'default') {
        finalId = DEFAULT_STRATEGY_UUID;
      } else if (finalId === '11111111-1111-1111-1111-111111111111') {
        finalId = LEGACY_CUSTOM_STRATEGY_UUID;
      }

      return {
        id: finalId,
        name: active ? (active.name || DEFAULT_STRATEGY_NAME) : DEFAULT_STRATEGY_NAME,
        text: active ? (active.text || DEFAULT_STRATEGY_TEXT) : DEFAULT_STRATEGY_TEXT,
        isDefault: active ? !!active.isDefault : true
      };
    }
  } catch (e) {
    // Not JSON, return legacy custom
  }
  return { id: LEGACY_CUSTOM_STRATEGY_UUID, name: 'Legacy Custom Strategy', text: strategyText, isDefault: false };
}

let pairsCache: Record<string, LivePairData> = {};
let lastFetchTime = 0;
const FETCH_COOLDOWN = 10 * 60 * 1000; // 10 minutes cache for external api

async function updateRatesFromAPI() {
  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!response.ok) {
      throw new Error(`Failed to fetch exchange rates: ${response.statusText}`);
    }
    const data = (await response.json()) as ERResponse;
    if (data.result !== "success" || !data.rates) {
      throw new Error("Invalid API response format");
    }

    const rates = data.rates;

    PAIR_METADATA.forEach(pair => {
      let basePrice = 1;
      if (pair.isUSDQuote) {
        const quoteRate = rates[pair.base];
        if (quoteRate) {
          basePrice = 1 / quoteRate;
        }
      } else {
        const baseRate = rates[pair.quote];
        if (baseRate) {
          basePrice = baseRate;
        }
      }

      const cached = pairsCache[pair.symbol];
      if (!cached) {
        // Initialize rolling history array
        const history: number[] = [];
        for (let i = 0; i < 7; i++) {
          const mult = 1 + (Math.random() * 0.002 - 0.001);
          history.push(Number((basePrice * mult).toFixed(pair.symbol.includes("JPY") ? 2 : 4)));
        }

        pairsCache[pair.symbol] = {
          symbol: pair.symbol,
          name: pair.name,
          basePrice: basePrice,
          currentPrice: basePrice,
          change: Number((Math.random() * 0.4 - 0.2).toFixed(2)),
          sentiment: Math.random() > 0.5 ? 'Bullish' : 'Bearish',
          history: history,
        };
      } else {
        // Keep tracking the baseline price but preserve current ticks and change history
        pairsCache[pair.symbol].basePrice = basePrice;
      }
    });

    lastFetchTime = Date.now();
  } catch (error) {
    console.error("Error updating exchange rates from API, using fallback defaults:", error);
    
    // Seed fallbacks if empty
    if (Object.keys(pairsCache).length === 0) {
      const fallbackRates: Record<string, number> = {
        EUR: 0.9195,
        GBP: 0.7853,
        JPY: 156.42,
        CAD: 1.3650,
        AUD: 1.5124,
        NZD: 1.6340,
        CHF: 0.8945
      };

      PAIR_METADATA.forEach(pair => {
        let basePrice = 1;
        if (pair.isUSDQuote) {
          const r = fallbackRates[pair.base];
          basePrice = 1 / r;
        } else {
          basePrice = fallbackRates[pair.quote];
        }

        const history: number[] = [];
        for (let i = 0; i < 7; i++) {
          const mult = 1 + (Math.random() * 0.002 - 0.001);
          history.push(Number((basePrice * mult).toFixed(pair.symbol.includes("JPY") ? 2 : 4)));
        }

        pairsCache[pair.symbol] = {
          symbol: pair.symbol,
          name: pair.name,
          basePrice: basePrice,
          currentPrice: basePrice,
          change: Number((Math.random() * 0.4 - 0.2).toFixed(2)),
          sentiment: Math.random() > 0.5 ? 'Bullish' : 'Bearish',
          history: history,
        };
      });
      lastFetchTime = Date.now();
    }
  }
}

// Introduce slight realistic ticks
function tickPrices() {
  if (Object.keys(pairsCache).length === 0) return;

  Object.keys(pairsCache).forEach(symbol => {
    const p = pairsCache[symbol];
    // Slight random walk (-0.03% to +0.03%) to simulate tick updates every request/tick interval
    const pct = (Math.random() * 0.06 - 0.03) / 100;
    const oldPrice = p.currentPrice;
    const newPrice = Number((oldPrice * (1 + pct)).toFixed(symbol.includes("JPY") ? 2 : 4));
    
    // Calculate daily change from daily basePrice
    const change = Number((((newPrice - p.basePrice) / p.basePrice) * 100).toFixed(2));
    const history = [...p.history.slice(1), newPrice];

    pairsCache[symbol] = {
      ...p,
      currentPrice: newPrice,
      change: change,
      sentiment: change >= 0 ? 'Bullish' : 'Bearish',
      history: history,
    };
  });
}

// Periodically fetch baseline rates every 10 minutes, and tick rates every 5 seconds
setInterval(() => {
  if (Date.now() - lastFetchTime > FETCH_COOLDOWN) {
    updateRatesFromAPI();
  }
}, 60 * 1000);

setInterval(() => {
  tickPrices();
}, 5000);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // CORS Middleware to allow cross-origin requests from frontend hosted on Vercel or locally
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
      // Direct client fallback
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

  // Keep track of user's active watcher key in memory (simulating background analysis setup)
  let activeWatcherApiKey: string | null = null;

  // Initialize Supabase Client
  const SUPABASE_URL = "https://wkujrqmxivljnuvumfau.supabase.co";
  const SUPABASE_PUBLIC_KEY = "sb_publishable_BheqR2OkNYKqT7bj8xThWA_gGG2hcjf";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_PUBLIC_KEY;
  const supabase = createClient(SUPABASE_URL, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  // Telegram helper to reply to users
  async function sendTelegramMessage(chatId: string | number, text: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.warn("TELEGRAM_BOT_TOKEN is not defined in environment variables.");
      return;
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: "Markdown"
        })
      });

      if (!response.ok) {
        console.error(`Telegram sendMessage failed with status ${response.status}:`, await response.text());
      }
    } catch (err) {
      console.error("Error sending Telegram message:", err);
    }
  }

  // Telegram Webhook POST Route
  app.post("/api/telegram/webhook", async (req, res) => {
    try {
      const body = req.body;
      console.log("[Telegram Webhook Express] Received update:", JSON.stringify(body, null, 2));

      const message = body.message;
      if (!message) {
        // Return 200 for other update types (e.g. callback queries) so Telegram bot doesn't retry
        return res.json({ success: true, reason: "No message payload" });
      }

      const chatId = message.chat?.id;
      const telegramUserId = message.from?.id;
      const telegramUsername = message.from?.username || null;
      const text = message.text || "";

      if (!chatId) {
        return res.status(400).json({ success: false, error: "Missing chat identifier" });
      }

      if (text.startsWith("/start")) {
        const parts = text.split(" ");
        const token = parts[1]?.trim();

        if (!token) {
          await sendTelegramMessage(
            chatId,
            "❌ *Gaks AI Verification Required*\n\nPlease use the *Connect Telegram* button from your Gaks AI Settings dashboard to link this account."
          );
          return res.json({ success: true, reason: "Start command without token" });
        }

        console.log(`[Telegram Webhook Express] Looking up token: ${token}`);

        const { data: connection, error: selectError } = await supabase
          .from("telegram_connections")
          .select("*")
          .eq("connection_token", token)
          .maybeSingle();

        if (selectError || !connection) {
          console.error(`[Telegram Webhook Express] Token lookup failed:`, selectError);
          await sendTelegramMessage(
            chatId,
            "❌ *Verification Failed*\n\nThe connection token is invalid or has expired. Please return to the Gaks AI Dashboard, regenerate your link, and try again."
          );
          return res.json({ success: true, reason: "Invalid token" });
        }

        // Idempotency check: if already connected
        if (connection.connected && connection.telegram_chat_id === String(chatId)) {
          const alreadyConnectedMessage = `🎉 *Welcome to Gaks AI!*\n\nYour Telegram account has been connected successfully.\n\nFuture AI trading signals will be delivered here.\n\nYou can now activate the AI Market Watcher from your dashboard.`;
          await sendTelegramMessage(chatId, alreadyConnectedMessage);
          return res.json({ success: true, reason: "Already connected" });
        }

        // Enforce 1-to-1 mapping: Check if this Telegram account is already linked to another Gaks AI user
        const { data: existingLinkedAccount } = await supabase
          .from("telegram_connections")
          .select("user_id")
          .eq("telegram_user_id", String(telegramUserId))
          .neq("user_id", connection.user_id)
          .maybeSingle();

        if (existingLinkedAccount) {
          await sendTelegramMessage(
            chatId,
            "❌ *Connection Failed*\n\nThis Telegram account is already linked to another Gaks AI user. Please use a different Telegram account or disconnect the other one."
          );
          return res.json({ success: true, reason: "Telegram account already linked to another user" });
        }

        // Invalidate the token to prevent reuse by generating a new one
        const crypto = require('crypto');
        const newToken = crypto.randomBytes(12).toString('hex');

        // Update database record
        const { error: updateError } = await supabase
          .from("telegram_connections")
          .update({
            telegram_chat_id: String(chatId),
            telegram_user_id: String(telegramUserId),
            telegram_username: telegramUsername,
            connected: true,
            connection_token: newToken,
            connected_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("connection_token", token);

        if (updateError) {
          console.error("[Telegram Webhook Express] DB Update Error:", updateError);
          await sendTelegramMessage(
            chatId,
            "❌ *Database Sync Error*\n\nWe encountered an error while saving your profile link. Please try again in a few moments."
          );
          return res.status(500).json({ success: false, error: "Database update failure" });
        }

        // Send confirmation message
        const successMessage = `🎉 *Welcome to Gaks AI!*\n\nYour Telegram account has been connected successfully.\n\nFuture AI trading signals will be delivered here.\n\nYou can now activate the AI Market Watcher from your dashboard.`;
        await sendTelegramMessage(chatId, successMessage);
        console.log(`[Telegram Webhook Express] Connected successfully for user ${connection.user_id}`);
      }

      return res.json({ success: true });
    } catch (error: any) {
      console.error("[Telegram Webhook Express] Error:", error);
      return res.status(500).json({ success: false, error: error.message || "Internal server error" });
    }
  });

  // Server-side App Settings Persistence helper
  const SETTINGS_FILE = path.join(process.cwd(), "settings.json");
  function loadSettings() {
    try {
      const fs = require('fs');
      if (fs.existsSync(SETTINGS_FILE)) {
        const data = fs.readFileSync(SETTINGS_FILE, "utf-8");
        return JSON.parse(data);
      }
    } catch (e) {
      console.error("Failed to load settings from file:", e);
    }
    return {
      defaultStrategy: "Gaks AI Default Strategy",
      defaultGeminiModel: "gemini-2.5-flash",
      scanInterval: 5,
      maintenanceMode: false
    };
  }

  function saveSettings(settings: any) {
    try {
      const fs = require('fs');
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
    } catch (e) {
      console.error("Failed to save settings to file:", e);
    }
  }

  let appSettings = loadSettings();

  // Admin Verification Guard Middleware
  async function adminGuard(req: express.Request, res: express.Response, next: express.NextFunction) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
    
    if (!token) {
      return res.status(401).json({ success: false, error: "Unauthorized: Missing authentication token." });
    }
    
    try {
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
  app.get("/api/admin/stats", adminGuard, async (req, res) => {
    try {
      // 1. Total users
      const { data: profiles, error: pErr } = await supabase.from('profiles').select('id');
      if (pErr) throw pErr;
      
      // 2. Active / Inactive watchers
      const { data: activeW, error: awErr } = await supabase.from('watchers').select('id').eq('status', 'active');
      if (awErr) throw awErr;
      const { data: stoppedW, error: swErr } = await supabase.from('watchers').select('id').eq('status', 'stopped');
      if (swErr) throw swErr;
      const { data: pausedW, error: pwErr } = await supabase.from('watchers').select('id').eq('status', 'paused');
      if (pwErr) throw pwErr;

      // 3. Telegram Connected Count
      const { data: tgConn, error: tgErr } = await supabase.from('telegram_connections').select('id').eq('connected', true);
      const tgCount = tgErr ? 0 : (tgConn?.length || 0);

      // 4. Missing Gemini API key
      const { data: keys, error: kErr } = await supabase.from('user_api_keys').select('user_id').eq('provider', 'gemini');
      const keysSet = new Set(keys?.map(k => k.user_id) || []);
      const missingKeyCount = (profiles || []).filter(u => !keysSet.has(u.id)).length;

      // 5. Signals Sent Today (last 24 hours)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: sigs, error: sigErr } = await supabase.from('signals').select('id').gte('timestamp', oneDayAgo);
      const sigsCount = sigErr ? 0 : (sigs?.length || 0);

      // 6. Last Cron Run / Scan
      const { data: latestScans, error: latestErr } = await supabase.from('watchers').select('last_scan_at').order('last_scan_at', { ascending: false }).limit(1);
      const lastCronRun = (latestScans && latestScans[0]?.last_scan_at) || null;

      return res.json({
        success: true,
        stats: {
          totalUsers: profiles?.length || 0,
          activeWatchers: activeW?.length || 0,
          stoppedWatchers: (stoppedW?.length || 0) + (pausedW?.length || 0),
          telegramConnected: tgCount,
          missingGeminiKey: missingKeyCount,
          signalsToday: sigsCount,
          lastCronRun,
          systemStatus: "ONLINE"
        }
      });
    } catch (err: any) {
      console.error("Failed to fetch admin stats:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/admin/users", adminGuard, async (req, res) => {
    try {
      const { data: profiles, error: pErr } = await supabase.from('profiles').select('*');
      if (pErr) throw pErr;

      const { data: watchers } = await supabase.from('watchers').select('*');
      const { data: keys } = await supabase.from('user_api_keys').select('*').eq('provider', 'gemini');

      const assembledUsers = (profiles || []).map(p => {
        const watcher = watchers?.find(w => w.user_id === p.id);
        const hasKey = keys?.some(k => k.user_id === p.id && k.api_key);

        return {
          id: p.id,
          email: p.email,
          full_name: p.full_name,
          created_at: p.created_at,
          telegram_connected: p.telegram_connected,
          gemini_configured: !!hasKey,
          watcher_status: watcher?.status || 'stopped',
          selected_pair: watcher?.selected_pair || 'None',
          selected_timeframe: watcher?.selected_timeframe || 'None',
          selected_strategy: watcher?.strategy_id ? 'Custom' : 'Default',
          last_scan_at: watcher?.last_scan_at || null
        };
      });

      return res.json({ success: true, users: assembledUsers });
    } catch (err: any) {
      console.error("Failed to fetch admin users:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/admin/users/action", adminGuard, async (req, res) => {
    const { userId, action } = req.body;
    if (!userId || !action) {
      return res.status(400).json({ success: false, error: "Missing required fields." });
    }

    try {
      if (action === 'pause') {
        await supabase.from('watchers').update({ status: 'paused', updated_at: new Date().toISOString() }).eq('user_id', userId);
      } else if (action === 'resume') {
        await supabase.from('watchers').update({ status: 'active', updated_at: new Date().toISOString() }).eq('user_id', userId);
      } else if (action === 'delete') {
        await supabase.from('watchers').delete().eq('user_id', userId);
      } else {
        return res.status(400).json({ success: false, error: "Invalid action type." });
      }

      return res.json({ success: true, message: `Action ${action} executed successfully on user ${userId}.` });
    } catch (err: any) {
      console.error("Failed executing user action:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/admin/watchers", adminGuard, async (req, res) => {
    try {
      const { data: watchers, error: wErr } = await supabase.from('watchers').select('*');
      if (wErr) throw wErr;

      const { data: profiles } = await supabase.from('profiles').select('id, email');

      const assembledWatchers = (watchers || []).map(w => {
        const prof = profiles?.find(p => p.id === w.user_id);
        return {
          ...w,
          email: prof?.email || 'Unknown User'
        };
      });

      return res.json({ success: true, watchers: assembledWatchers });
    } catch (err: any) {
      console.error("Failed to fetch admin watchers:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/admin/watchers/action", adminGuard, async (req, res) => {
    const { watcherId, action } = req.body;
    if (!watcherId || !action) {
      return res.status(400).json({ success: false, error: "Missing required fields." });
    }

    try {
      if (action === 'restart') {
        await supabase.from('watchers').update({ status: 'active', started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', watcherId);
        return res.json({ success: true, message: "Watcher restarted successfully." });
      } else if (action === 'stop') {
        await supabase.from('watchers').update({ status: 'stopped', stopped_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', watcherId);
        return res.json({ success: true, message: "Watcher stopped successfully." });
      } else if (action === 'force_scan') {
        // Load watcher details
        const { data: watcher, error: wErr } = await supabase.from('watchers').select('*').eq('id', watcherId).maybeSingle();
        if (wErr || !watcher) {
          return res.status(404).json({ success: false, error: "Watcher not found." });
        }
        
        const userId = watcher.user_id;
        
        // 1. Get Gemini Key
        const { data: keyRec } = await supabase.from('user_api_keys').select('*').eq('user_id', userId).eq('provider', 'gemini').maybeSingle();
        const geminiKey = keyRec?.api_key || process.env.GEMINI_API_KEY;
        
        if (!geminiKey) {
          return res.status(400).json({ success: false, error: "Gemini API key is not configured for this user or server." });
        }
        
        // 2. Get Strategy Text
        const { data: prefsRecord } = await supabase.from('trading_preferences').select('*').eq('user_id', userId).maybeSingle();
        const strategyTextRaw = prefsRecord?.strategy_text || '';
        const strategyText = extractStrategyTextById(strategyTextRaw, watcher.strategy_id);
        
        // 3. Get Market Data (use Twelve Data if key exists, otherwise fallback to live rates cache)
        let collectedData: Record<string, any> = {};
        const twelveDataKey = process.env.TWELVE_DATA_API_KEY;
        const symbol = watcher.selected_pair || 'EURUSD';
        
        if (twelveDataKey) {
          try {
            const mappedSymbol = symbol.length === 6 ? `${symbol.slice(0, 3)}/${symbol.slice(3)}` : symbol;
            const response = await fetch(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(mappedSymbol)}&apikey=${twelveDataKey}`);
            if (response.ok) {
              const quoteData = await response.json();
              if (quoteData && !quoteData.error && quoteData.close) {
                const currentPrice = parseFloat(quoteData.close);
                collectedData[symbol] = {
                  current_price: currentPrice,
                  open: parseFloat(quoteData.open || "0") || currentPrice,
                  high: parseFloat(quoteData.high || "0") || currentPrice,
                  low: parseFloat(quoteData.low || "0") || currentPrice,
                  close: currentPrice,
                  bid: quoteData.bid ? parseFloat(quoteData.bid) : currentPrice * 0.9999,
                  ask: quoteData.ask ? parseFloat(quoteData.ask) : currentPrice * 1.0001,
                  volume: parseFloat(quoteData.volume || "0"),
                  timestamp: quoteData.timestamp || Math.floor(Date.now() / 1000)
                };
              }
            }
          } catch (e) {
            console.error("Twelve data fetch failed in force scan, falling back to cache:", e);
          }
        }
        
        // Fallback to pairs cache if empty
        if (Object.keys(collectedData).length === 0) {
          const cached = pairsCache[symbol.replace(/[^A-Z]/g, '')] || pairsCache['EURUSD'];
          const price = cached?.currentPrice || 1.0850;
          collectedData[symbol] = {
            current_price: price,
            open: price * 0.998,
            high: price * 1.002,
            low: price * 0.997,
            close: price,
            bid: price * 0.9999,
            ask: price * 1.0001,
            volume: 152000,
            timestamp: Math.floor(Date.now() / 1000)
          };
        }
        
        const accountSize = watcher.account_size || 1000;
        const riskPercentage = watcher.risk_percentage || 1;
        
        // 4. Call Gemini
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const promptText = `
You are an expert AI trading assistant.
Analyze the following live market data against the user's trading strategy.
Return a structured JSON list of trading signals. Only generate a signal if the setup strongly matches the strategy.
If no valid setups are found, return an empty array for signals.

User's Trading Strategy:
${strategyText}

Account Size: $${accountSize}
Risk Percentage per trade: ${riskPercentage}%

Live Market Data:
${JSON.stringify(collectedData, null, 2)}
`;

        const aiResponse = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: promptText,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                signals: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      pair: { type: Type.STRING, description: "The trading pair symbol (e.g., EUR/USD)" },
                      direction: { type: Type.STRING, description: "BUY or SELL" },
                      entryPrice: { type: Type.NUMBER, description: "Suggested entry price" },
                      stopLoss: { type: Type.NUMBER, description: "Suggested stop loss price" },
                      takeProfit: { type: Type.NUMBER, description: "Suggested take profit price" },
                      riskRewardRatio: { type: Type.STRING, description: "Risk/Reward ratio (e.g., '1:2.5')" },
                      confidenceScore: { type: Type.NUMBER, description: "Confidence score from 0 to 100" },
                      aiReasoning: { type: Type.STRING, description: "Brief explanation of why this setup matches the strategy" },
                    },
                    required: ["pair", "direction", "entryPrice", "stopLoss", "takeProfit", "riskRewardRatio", "confidenceScore", "aiReasoning"]
                  }
                }
              },
              required: ["signals"]
            }
          }
        });

        const parsedResult = JSON.parse(aiResponse.text || '{"signals": []}');
        const signals = parsedResult.signals || [];
        let signalsSent = 0;
        
        if (signals.length > 0) {
          for (const sig of signals) {
            // Log signal to db
            await supabase.from("signals").insert({
              user_id: userId,
              pair: sig.pair,
              signal_type: sig.direction,
              confidence: sig.confidenceScore,
              delivery_status: watcher.telegram_chat_id ? "delivered" : "no_telegram"
            });
            
            // Send telegram if connected
            if (watcher.telegram_chat_id && sig.confidenceScore >= 70) {
              const alertMessage = `🚨 *Force Scan Trading Alert* 🚨\n\n` +
                `*Pair:* ${sig.pair}\n` +
                `*Direction:* ${sig.direction === 'BUY' ? '🟢 BUY' : '🔴 SELL'}\n` +
                `*Entry Price:* ${sig.entryPrice}\n` +
                `*Stop Loss:* ${sig.stopLoss}\n` +
                `*Take Profit:* ${sig.takeProfit}\n` +
                `*Risk/Reward:* ${sig.riskRewardRatio}\n` +
                `*Confidence:* ${sig.confidenceScore}/100\n\n` +
                `*AI Reasoning:* ${sig.aiReasoning}`;
                
              await sendTelegramMessage(watcher.telegram_chat_id, alertMessage);
              signalsSent++;
            }
          }
        }
        
        // Update last scan timestamp
        await supabase.from("watchers").update({
          last_scan_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }).eq("id", watcherId);
        
        return res.json({
          success: true,
          message: `Force scan complete! Scanned ${symbol}. Signals found: ${signals.length}, Sent to Telegram: ${signalsSent}.`,
          signals: signals
        });
      }

      return res.status(400).json({ success: false, error: "Invalid action type." });
    } catch (err: any) {
      console.error("Failed executing watcher action:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/admin/signals", adminGuard, async (req, res) => {
    try {
      const { data: signals, error: sErr } = await supabase.from('signals').select('*').order('timestamp', { ascending: false });
      if (sErr) throw sErr;

      const { data: profiles } = await supabase.from('profiles').select('id, email');

      const assembledSignals = (signals || []).map(s => {
        const prof = profiles?.find(p => p.id === s.user_id);
        return {
          ...s,
          email: prof?.email || 'Unknown User'
        };
      });

      return res.json({ success: true, signals: assembledSignals });
    } catch (err: any) {
      console.error("Failed to fetch admin signals:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/admin/health", adminGuard, async (req, res) => {
    try {
      const startSupa = Date.now();
      const { error: supaErr } = await supabase.from('profiles').select('id').limit(1);
      const supabaseStatus = !supaErr ? 'ONLINE' : 'ERROR';
      const supabaseLatency = Date.now() - startSupa;

      let geminiStatus = 'OFFLINE';
      if (process.env.GEMINI_API_KEY) {
        try {
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: "Respond with exactly 'OK'",
          });
          geminiStatus = 'ONLINE';
        } catch (err) {
          geminiStatus = 'ERROR';
        }
      }

      let telegramStatus = 'OFFLINE';
      if (process.env.TELEGRAM_BOT_TOKEN) {
        try {
          const resMe = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
          telegramStatus = resMe.ok ? 'ONLINE' : 'ERROR';
        } catch {
          telegramStatus = 'ERROR';
        }
      }

      let twelveDataStatus = 'OFFLINE';
      if (process.env.TWELVE_DATA_API_KEY) {
        try {
          const resQuote = await fetch(`https://api.twelvedata.com/quote?symbol=EUR/USD&apikey=${process.env.TWELVE_DATA_API_KEY}`);
          twelveDataStatus = resQuote.ok ? 'ONLINE' : 'ERROR';
        } catch {
          twelveDataStatus = 'ERROR';
        }
      }

      // Check GitHub Cron / Last Cron scan
      const { data: latestScans } = await supabase.from('watchers').select('last_scan_at').order('last_scan_at', { ascending: false }).limit(1);
      const lastCronTime = (latestScans && latestScans[0]?.last_scan_at) || null;
      let cronStatus = 'ONLINE';
      if (lastCronTime) {
        const diffHours = (Date.now() - new Date(lastCronTime).getTime()) / (1000 * 60 * 60);
        if (diffHours > 24) {
          cronStatus = 'OFFLINE';
        }
      } else {
        cronStatus = 'OFFLINE';
      }

      return res.json({
        success: true,
        health: {
          supabase: { status: supabaseStatus, timestamp: new Date().toISOString(), details: `${supabaseLatency}ms latency` },
          gemini: { status: geminiStatus, timestamp: new Date().toISOString() },
          telegram: { status: telegramStatus, timestamp: new Date().toISOString() },
          twelveData: { status: twelveDataStatus, timestamp: new Date().toISOString() },
          cron: { status: cronStatus, timestamp: new Date().toISOString(), details: lastCronTime ? `Last run: ${new Date(lastCronTime).toLocaleString()}` : "Never run" }
        }
      });
    } catch (err: any) {
      console.error("Health check error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/admin/settings", adminGuard, async (req, res) => {
    return res.json({ success: true, settings: appSettings });
  });

  app.post("/api/admin/settings", adminGuard, async (req, res) => {
    const { settings } = req.body;
    if (!settings) {
      return res.status(400).json({ success: false, error: "Missing settings configuration." });
    }

    appSettings = {
      ...appSettings,
      ...settings
    };

    saveSettings(appSettings);
    return res.json({ success: true, message: "Settings saved successfully.", settings: appSettings });
  });

  // Initialize rates baseline
  await updateRatesFromAPI();

  // API Endpoint - Verifies all watcher requirements and activates it
  app.post("/api/watcher/start", async (req, res) => {
    let userId = req.body.userId;

    // 1. Verify the user is authenticated (using authorization header)
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

    if (token) {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
          console.warn("[Watcher Start] Bearer token auth validation failed:", authError?.message);
        } else {
          userId = user.id;
        }
      } catch (err: any) {
        console.warn("[Watcher Start] Bearer token verification error:", err.message);
      }
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication failed. You must be authenticated to start the AI Market Watcher."
      });
    }

    try {
      console.log(`[Watcher Start] Verifying requirements for authenticated user: ${userId}`);

      // 2. Retrieve the authenticated user's profile
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (profileError) {
        console.warn("[Watcher Start] Profile query warning:", profileError.message);
      }

      // 3. Verify Telegram is connected by checking the telegram_connections table
      const { data: telegramConn, error: telegramError } = await supabase
        .from("telegram_connections")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (telegramError) {
        console.warn("[Watcher Start] Telegram connection lookup error:", telegramError.message);
      }

      if (!telegramConn || !telegramConn.connected) {
        return res.status(400).json({
          success: false,
          error: "Telegram is not connected. Please connect your Telegram account first under Gaks AI Settings."
        });
      }

      // 4. Verify the user has saved a Gemini API key
      const { data: apiKeyRecord, error: apiKeyError } = await supabase
        .from("user_api_keys")
        .select("*")
        .eq("user_id", userId)
        .eq("provider", "gemini")
        .maybeSingle();

      if (apiKeyError) {
        console.warn("[Watcher Start] API Key query error:", apiKeyError.message);
      }

      if (!apiKeyRecord || !apiKeyRecord.api_key) {
        return res.status(400).json({
          success: false,
          error: "Gemini API key is missing. Please save a valid Gemini API key under AI Settings before activating."
        });
      }

      // 5 & 6. Verify Strategy Playbook and Risk settings exist
      const { data: prefsRecord, error: prefsError } = await supabase
        .from("trading_preferences")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (prefsError) {
        console.warn("[Watcher Start] Trading preferences query error:", prefsError.message);
      }

      const strategyTextRaw = prefsRecord?.strategy_text || '';
      const strategyDetails = extractActiveStrategyDetails(strategyTextRaw);
      const strategyText = strategyDetails.text;

      if (!strategyText.trim()) {
        return res.status(400).json({
          success: false,
          error: "Active trading strategy is empty. Please configure your strategy under the Strategy Playbook section first."
        });
      }

      const preferredRisk = prefsRecord?.preferred_risk || '';
      const riskReward = prefsRecord?.risk_reward || '';

      if (!preferredRisk.trim() || !riskReward.trim()) {
        return res.status(400).json({
          success: false,
          error: "Risk settings are incomplete. Please define and save your Preferred Risk and Risk:Reward Ratio under the Risk & Sizing section first."
        });
      }

      // 8. Requirements met! Create or update the user's watcher record
      const nowString = new Date().toISOString();
      
      // Parse capital size and risk percentage for structured watchers columns
      let accountSize: number | null = null;
      if (prefsRecord) {
        const cap = prefsRecord.custom_capital || prefsRecord.capital || "";
        const cleanedCap = cap.replace(/[^0-9.]/g, "");
        if (cleanedCap) {
          accountSize = parseFloat(cleanedCap);
        }
      }

      let riskPercentage: number | null = null;
      if (prefsRecord && prefsRecord.preferred_risk) {
        const cleanedRisk = prefsRecord.preferred_risk.replace(/[^0-9.]/g, "");
        if (cleanedRisk) {
          riskPercentage = parseFloat(cleanedRisk);
        }
      }

      const telegramChatId = telegramConn?.telegram_chat_id || null;

      // Ensure the strategy exists in public.strategies table to satisfy foreign key constraint
      const { error: stratError } = await supabase
        .from("strategies")
        .upsert({
          id: strategyDetails.id,
          user_id: strategyDetails.isDefault ? null : userId,
          name: strategyDetails.name,
          text: strategyDetails.text,
          is_default: strategyDetails.isDefault,
          updated_at: nowString
        });

      if (stratError) {
        console.warn("[Watcher Start] Warning upserting into strategies table:", stratError.message);
      }

      // Upsert into watchers table
      const { error: watchersError } = await supabase
        .from("watchers")
        .upsert({
          user_id: userId,
          status: "active",
          strategy_id: strategyDetails.id,
          started_at: nowString,
          telegram_chat_id: telegramChatId,
          account_size: accountSize,
          risk_percentage: riskPercentage,
          gemini_model: "gemini-2.5-flash",
          scan_interval_minutes: 5,
          selected_pair: req.body.selectedPair,
          selected_timeframe: req.body.selectedTimeframe,
          updated_at: nowString
        }, { onConflict: "user_id" });

      if (watchersError) {
        console.error("[Watcher Start] Failed to write to watchers table:", watchersError.message);
        return res.status(500).json({
          success: false,
          error: "Failed to write watcher state to DB: " + watchersError.message
        });
      }

      // Upsert into legacy market_watchers table for interface backwards-compatibility
      try {
        await supabase
          .from("market_watchers")
          .upsert({
            user_id: userId,
            status: "active",
            activated_at: nowString,
            updated_at: nowString
          }, { onConflict: "user_id" });
      } catch (err: any) {
        console.warn("[Watcher Start] Legacy market_watchers table sync error:", err.message);
      }

      // Simulate analyzer preparation
      activeWatcherApiKey = apiKeyRecord.api_key;
      console.log(`[Watcher Start] AI Market Watcher activated successfully for user ${userId}.`);

      // 9. Return success
      return res.json({
        success: true,
        message: "AI Market Watcher activated successfully."
      });

    } catch (err: any) {
      console.error("[Watcher Start] Unhandled internal exception:", err);
      return res.status(500).json({
        success: false,
        error: "Internal server error during watcher activation: " + (err.message || "Unknown error")
      });
    }
  });

  // API Endpoint - Scans market data for user's watchlist pairs
  app.post("/api/watcher/scan", async (req, res) => {
    let userId = req.body.userId;

    // 1. Verify the user is authenticated
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

    if (token) {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
          console.warn("[Watcher Scan] Bearer token auth validation failed:", authError?.message);
        } else {
          userId = user.id;
        }
      } catch (err: any) {
        console.warn("[Watcher Scan] Bearer token verification error:", err.message);
      }
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication failed. You must be authenticated to trigger a market watcher scan."
      });
    }

    try {
      console.log(`[Watcher Scan] Loading active watcher and settings for user: ${userId}`);

      // 2. Load the user's active watcher
      const { data: watcher, error: watcherError } = await supabase
        .from("watchers")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (watcherError) {
        console.error("[Watcher Scan] Watcher query error:", watcherError.message);
        return res.status(500).json({ success: false, error: "Database error fetching watcher: " + watcherError.message });
      }

      if (!watcher) {
        return res.status(404).json({
          success: false,
          error: "No AI Market Watcher found for this user. Please set up and start your watcher first."
        });
      }

      // 3. Ensure the watcher's status is "active"
      if (watcher.status !== "active") {
        return res.status(400).json({
          success: false,
          error: `AI Market Watcher is not active. Current status: ${watcher.status}. Please start the watcher first.`
        });
      }

      // 4. Verify Telegram is connected by checking the telegram_connections table
      const { data: telegramConn, error: telegramError } = await supabase
        .from("telegram_connections")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (telegramError) {
        console.warn("[Watcher Scan] Telegram connection query error:", telegramError.message);
      }

      if (!telegramConn || !telegramConn.connected) {
        return res.status(400).json({
          success: false,
          error: "Telegram is not connected. Please connect your Telegram account first under Gaks AI Settings."
        });
      }

      // 5. Load User's trading strategy, account size, risk settings, Gemini API key, and Watchlist
      const { data: prefsRecord, error: prefsError } = await supabase
        .from("trading_preferences")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (prefsError) {
        console.warn("[Watcher Scan] Trading preferences query error:", prefsError.message);
      }

      const strategyTextRaw = prefsRecord?.strategy_text || "";
      const strategyText = extractStrategyTextById(strategyTextRaw, watcher.strategy_id);

      if (!strategyText.trim()) {
        return res.status(400).json({
          success: false,
          error: "Active trading strategy is empty. Please configure your strategy playbook first."
        });
      }

      const accountSize = watcher.account_size || (prefsRecord?.capital ? parseFloat(prefsRecord.capital.replace(/[^0-9.]/g, "")) : null);
      const riskPercentage = watcher.risk_percentage || (prefsRecord?.preferred_risk ? parseFloat(prefsRecord.preferred_risk.replace(/[^0-9.]/g, "")) : null);

      if (!accountSize || !riskPercentage) {
        return res.status(400).json({
          success: false,
          error: "Account size and risk percentage must be defined in your trading preferences or watcher configuration."
        });
      }

      // Load Gemini API Key
      const { data: apiKeyRecord, error: apiKeyError } = await supabase
        .from("user_api_keys")
        .select("*")
        .eq("user_id", userId)
        .eq("provider", "gemini")
        .maybeSingle();

      if (apiKeyError) {
        console.warn("[Watcher Scan] Gemini API key query error:", apiKeyError.message);
      }

      if (!apiKeyRecord || !apiKeyRecord.api_key) {
        return res.status(400).json({
          success: false,
          error: "Gemini API key is missing. Please save a valid Gemini API key under AI Settings first."
        });
      }

      // Load Watchlist (currency pairs)
      const { data: watchlist, error: watchlistError } = await supabase
        .from("watchlist_items")
        .select("*")
        .eq("user_id", userId);

      if (watchlistError) {
        console.error("[Watcher Scan] Watchlist query error:", watchlistError.message);
        return res.status(500).json({ success: false, error: "Database error fetching watchlist: " + watchlistError.message });
      }

      if (!watchlist || watchlist.length === 0) {
        return res.json({
          success: true,
          message: "Watchlist is empty. No currency pairs to scan.",
          data: {}
        });
      }

      // 6. Use the application's TWELVE_DATA_API_KEY from environment variables
      const twelveDataKey = process.env.TWELVE_DATA_API_KEY;
      if (!twelveDataKey) {
        return res.status(500).json({
          success: false,
          error: "Application TWELVE_DATA_API_KEY is not defined in the server environment variables."
        });
      }

      // 7. Fetch live market data from Twelve Data for every pair in the user's watchlist
      const collectedData: Record<string, any> = {};

      const convertSymbol = (sym: string): string => {
        if (!sym) return "";
        let mapped = sym.trim().toUpperCase().replace(/[-_\s/]/g, '');
        
        // Symbol mapping layer for Twelve Data compatibility on free plans
        const mappings: Record<string, string> = {
          'EURUSD': 'EUR/USD',
          'GBPUSD': 'GBP/USD',
          'XAUUSD': 'XAU/USD',
          'BTCUSD': 'BTC/USD',
          'NAS100': 'QQQ',
          'US30': 'DIA',
          'SPX500': 'SPY',
          'US500': 'SPY'
        };

        if (mappings[mapped]) {
          return mappings[mapped];
        }
        
        if (mapped.length === 6 && /^[A-Z]{6}$/.test(mapped)) {
          return `${mapped.slice(0, 3)}/${mapped.slice(3)}`;
        }
        if (mapped.endsWith('USD') && mapped.length > 3) return mapped.slice(0, -3) + '/USD';
        if (mapped.endsWith('JPY') && mapped.length > 3) return mapped.slice(0, -3) + '/JPY';
        if (mapped.endsWith('EUR') && mapped.length > 3) return mapped.slice(0, -3) + '/EUR';
        if (mapped.endsWith('GBP') && mapped.length > 3) return mapped.slice(0, -3) + '/GBP';
        return mapped;
      };

      for (const item of watchlist) {
        const symbol = item.symbol;
        const mappedSymbol = convertSymbol(symbol);
        const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(mappedSymbol)}&apikey=${twelveDataKey}`;
        
        try {
          const response = await fetch(url);
          if (!response.ok) {
            return res.status(400).json({
              success: false,
              error: `Twelve Data API returned HTTP ${response.status} for symbol ${symbol}.`
            });
          }

          const quoteData = await response.json();

          if (quoteData.status === "error" || quoteData.code >= 400) {
            return res.status(400).json({
              success: false,
              error: `Twelve Data API error for symbol ${symbol}: ${quoteData.message || "Unknown error"}`
            });
          }

          // 8. Return structured JSON containing the specified fields
          const currentPrice = parseFloat(quoteData.close || quoteData.price || "0");
          const openPrice = parseFloat(quoteData.open || "0");
          const highPrice = parseFloat(quoteData.high || "0");
          const lowPrice = parseFloat(quoteData.low || "0");
          const closePrice = parseFloat(quoteData.close || "0");
          
          const bidPrice = quoteData.bid ? parseFloat(quoteData.bid) : currentPrice * 0.9999;
          const askPrice = quoteData.ask ? parseFloat(quoteData.ask) : currentPrice * 1.0001;
          const volumeVal = quoteData.volume ? parseFloat(quoteData.volume) : 0;
          const timestampVal = quoteData.timestamp || Math.floor(Date.now() / 1000);

          collectedData[symbol] = {
            current_price: currentPrice,
            open: openPrice,
            high: highPrice,
            low: lowPrice,
            close: closePrice,
            bid: bidPrice,
            ask: askPrice,
            volume: volumeVal,
            timestamp: timestampVal
          };

        } catch (fetchErr: any) {
          console.error(`[Watcher Scan] Failed to fetch market data for ${symbol}:`, fetchErr);
          return res.status(500).json({
            success: false,
            error: `Failed to fetch live market data for ${symbol}: ${fetchErr.message || "Network error"}`
          });
        }
      }

      // 10 & 11. Do NOT perform AI analysis yet; return the collected market data as JSON.
      return res.json({
        success: true,
        data: collectedData
      });

    } catch (err: any) {
      console.error("[Watcher Scan] Unhandled internal exception:", err);
      return res.status(500).json({
        success: false,
        error: "Internal server error during watcher scan: " + (err.message || "Unknown error")
      });
    }
  });


  // Keep old endpoint name mapping for complete safety and frontend backup
  app.post("/api/watcher/activate", async (req, res) => {
    // Redirect / activate behaves exactly like start to maintain backward compatibility
    req.url = "/api/watcher/start";
    return app._router.handle(req, res);
  });

  // API Endpoint - Returns the current real-time conversion rates
  app.get("/api/live-rates", (req, res) => {
    // Tick prices on demand as well to ensure latest fresh state
    tickPrices();
    res.json({
      success: true,
      timestamp: Date.now(),
      pairs: Object.values(pairsCache)
    });
  });

  // Scheduled Cron execution for active market watchers
  app.post("/api/cron/market-watcher", marketWatcherCronHandler);

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
