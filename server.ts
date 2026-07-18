import express from "express";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI, Type } from "@google/genai";
import yahooFinance from 'yahoo-finance2';
const YahooFinance = (yahooFinance as any).default || yahooFinance;
const yf = new YahooFinance();

import { convertSymbol, convertSymbolToYahoo } from "./src/lib/market-utils";
import marketWatcherCronHandler from "./api/cron/market-watcher";
import adminStatsHandler from "./api/_admin/stats";
import adminUsersHandler from "./api/_admin/users";
import adminUsersActionHandler from "./api/_admin/users/action";
import adminWatchersHandler from "./api/_admin/watchers";
import adminWatchersActionHandler from "./api/_admin/watchers/action";
import adminSignalsHandler from "./api/_admin/signals";
import adminHealthHandler from "./api/_admin/health";
import adminSettingsHandler from "./api/_admin/settings";
import adminSendTestAlertHandler from "./api/_admin/send-test-alert";

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
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
  history: number[];
  status?: 'active' | 'unavailable';
}

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
const FETCH_COOLDOWN = 10 * 1000; // 10 seconds cache for UI pipeline

async function updateRatesFromAPI(supabase?: any) {
  // Respect cache
  if (Date.now() - lastFetchTime < FETCH_COOLDOWN && Object.keys(pairsCache).length > 0) {
    return;
  }

  try {
    // Determine symbols to monitor dynamically from watchers table
    let monitoredSymbols: string[] = [
      'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'BTCUSD', 'ETHUSD', 'NAS100', 'US30'
    ]; // Base default set
    
    if (supabase) {
      try {
        const { data: watchers } = await supabase.from('watchers').select('selected_pair');
        if (watchers && watchers.length > 0) {
          const watcherPairs = watchers.map((w: any) => w.selected_pair.toUpperCase());
          monitoredSymbols = Array.from(new Set([...monitoredSymbols, ...watcherPairs]));
        }
      } catch (dbErr) {
        console.warn("[Rates Update] Could not fetch watcher symbols from DB:", dbErr);
      }
    }

    const processedSymbols = new Set<string>();

    // 1. PIPELINE 1: Yahoo Finance (Primary for UI)
    const yahooSymbolMap: Record<string, string> = {};
    monitoredSymbols.forEach(s => {
      yahooSymbolMap[convertSymbolToYahoo(s)] = s;
    });
    const yahooSymbolsToFetch = Object.keys(yahooSymbolMap);

    try {
      console.log(`[Rates Update] Fetching ${yahooSymbolsToFetch.length} symbols from Yahoo Finance...`);
      // Fetch quotes in batch
      const yahooQuotes = await yf.quote(yahooSymbolsToFetch);
      const quotesArray = Array.isArray(yahooQuotes) ? yahooQuotes : [yahooQuotes];
      
      console.log(`[Rates Update] Yahoo Response: Received ${quotesArray.length} quotes.`);
      
      quotesArray.forEach((quote: any) => {
        if (!quote || !quote.symbol) return;
        const originalSymbol = yahooSymbolMap[quote.symbol];
        if (!originalSymbol) return;

        const currentPrice = quote.regularMarketPrice;
        if (currentPrice === undefined || currentPrice === null) {
          console.warn(`[Rates Update] Yahoo Quote for ${quote.symbol} missing price.`);
          return;
        }

        const basePrice = quote.regularMarketPreviousClose || currentPrice;
        const change = quote.regularMarketChangePercent || 0;
        const name = quote.shortName || quote.longName || originalSymbol;

        pairsCache[originalSymbol] = {
          symbol: originalSymbol,
          name,
          basePrice,
          currentPrice,
          change,
          sentiment: change > 0.05 ? 'Bullish' : (change < -0.05 ? 'Bearish' : 'Neutral'),
          history: [], 
          status: 'active'
        };
        processedSymbols.add(originalSymbol);
      });
    } catch (yfErr) {
      console.warn("[Rates Update] Yahoo Finance batch failed:", yfErr.message);
      // Individual fallback if batch fails
      for (const symbol of monitoredSymbols) {
        if (processedSymbols.has(symbol)) continue;
        try {
          const ySym = convertSymbolToYahoo(symbol);
          const quote: any = await yf.quote(ySym);
          if (quote && quote.regularMarketPrice !== undefined) {
            const currentPrice = quote.regularMarketPrice;
            const basePrice = quote.regularMarketPreviousClose || currentPrice;
            const change = quote.regularMarketChangePercent || 0;
            pairsCache[symbol] = {
              symbol,
              name: quote.shortName || quote.longName || symbol,
              basePrice,
              currentPrice,
              change,
              sentiment: change > 0.05 ? 'Bullish' : (change < -0.05 ? 'Bearish' : 'Neutral'),
              history: [],
              status: 'active'
            };
            processedSymbols.add(symbol);
          }
        } catch (e) {}
      }
    }

    // 2. FALLBACK: Exchange Rate API (Forex Only)
    const remainingForex = monitoredSymbols.filter(s => !processedSymbols.has(s) && s.length === 6);
    if (remainingForex.length > 0) {
      try {
        const erRes = await fetch("https://open.er-api.com/v6/latest/USD");
        if (erRes.ok) {
          const erData = await erRes.json();
          if (erData.result === "success" && erData.rates) {
            remainingForex.forEach(symbol => {
              const base = symbol.slice(0, 3);
              const quote = symbol.slice(3);
              
              let price = 0;
              if (quote === 'USD') {
                const rate = erData.rates[base];
                if (rate) price = 1 / rate;
              } else if (base === 'USD') {
                const rate = erData.rates[quote];
                if (rate) price = rate;
              } else {
                // Cross rate
                const rateBase = erData.rates[base];
                const rateQuote = erData.rates[quote];
                if (rateBase && rateQuote) price = rateQuote / rateBase;
              }

              if (price > 0) {
                pairsCache[symbol] = {
                  symbol,
                  name: `${base} / ${quote}`,
                  basePrice: price,
                  currentPrice: price,
                  change: 0,
                  sentiment: 'Neutral',
                  history: [],
                  status: 'active'
                };
                processedSymbols.add(symbol);
              }
            });
          }
        }
      } catch (e) {}
    }

    // 3. Mark unavailable symbols
    monitoredSymbols.forEach(symbol => {
      if (!processedSymbols.has(symbol)) {
        if (pairsCache[symbol]) {
          pairsCache[symbol].status = 'unavailable';
        } else {
          pairsCache[symbol] = {
            symbol,
            name: symbol,
            basePrice: 0,
            currentPrice: 0,
            change: 0,
            sentiment: 'Neutral',
            history: [],
            status: 'unavailable'
          };
        }
      }
    });

    // Cleanup cache: remove symbols that are no longer monitored
    Object.keys(pairsCache).forEach(symbol => {
      if (!monitoredSymbols.includes(symbol)) {
        delete pairsCache[symbol];
      }
    });

    lastFetchTime = Date.now();
  } catch (err) {
    console.error("[Rates Update] Critical failure in UI pipeline:", err);
  }
}

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

  // Initial fetch and setup intervals
  updateRatesFromAPI(supabase);
  
  setInterval(() => {
    if (Date.now() - lastFetchTime > FETCH_COOLDOWN) {
      updateRatesFromAPI(supabase);
    }
  }, 60 * 1000);

  // Keep track of user's active watcher key in memory
  let activeWatcherApiKey: string | null = null;

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
  app.get("/api/admin/stats", adminStatsHandler);
  app.get("/api/admin/users", adminUsersHandler);
  app.post("/api/admin/users/action", adminUsersActionHandler);
  app.get("/api/admin/watchers", adminWatchersHandler);
  app.post("/api/admin/watchers/action", adminWatchersActionHandler);
  app.get("/api/admin/signals", adminSignalsHandler);
  app.get("/api/admin/health", adminHealthHandler);
  app.post("/api/admin/health", adminHealthHandler);
  app.get("/api/admin/settings", adminSettingsHandler);
  app.post("/api/admin/settings", adminSettingsHandler);
  app.post("/api/admin/send-test-alert", adminSendTestAlertHandler);

  // Initialize rates baseline
  await updateRatesFromAPI();

  // API Endpoint - Verifies all watcher requirements and activates it
  app.post("/api/watcher/start", async (req, res) => {
    console.log("[Watcher Start] Request received", req.body);
    let userId = req.body.userId;

    // 1. Verify the user is authenticated (using authorization header)
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

    let userObj: any = null;

    if (token) {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
          console.warn("[Watcher Start] Bearer token auth validation failed:", authError?.message);
        } else {
          userId = user.id;
          userObj = user;
          console.log("[Watcher Start] Authenticated user ID:", userId);
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
      console.log(`[Watcher Start] Pair: ${req.body.selectedPair}, Timeframe: ${req.body.selectedTimeframe}`);

      // 2. Retrieve the authenticated user's profile
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (profileError) {
        console.warn("[Watcher Start] Profile query warning:", profileError.message);
      }

      // Check if user is admin. If not, enforce 1 active watcher limit.
      const ADMIN_EMAIL = "gaks6535@gmail.com";
      const isUserAdmin = 
        (profile?.role === "admin") || 
        (profile?.email?.trim().toLowerCase() === ADMIN_EMAIL) ||
        (userObj?.email?.trim().toLowerCase() === ADMIN_EMAIL);

      console.log(`[Watcher Start] User ${userId} is admin: ${isUserAdmin}`);

      if (!isUserAdmin) {
        // Query active watchers for this user in public.watchers
        const { data: activeWatchers, error: activeError } = await supabase
          .from("watchers")
          .select("*")
          .eq("user_id", userId)
          .eq("status", "active");

        if (activeError) {
          console.warn("[Watcher Start] Error querying active watchers:", activeError.message);
        }

        if (activeWatchers && activeWatchers.length > 0) {
          // If they already have an active watcher, and it is NOT for the same pair they are starting/updating now, reject.
          const currentPair = (req.body.selectedPair || "").trim().toUpperCase();
          const hasDifferentActiveWatcher = activeWatchers.some(
            w => (w.selected_pair || "").trim().toUpperCase() !== currentPair
          );

          if (hasDifferentActiveWatcher) {
            return res.status(403).json({
              success: false,
              error: "Free accounts can monitor one market at a time."
            });
          }
        }
      }

      // 3. Verify Telegram is connected by checking the telegram_connections table
      const { data: telegramConn, error: telegramError } = await supabase
        .from("telegram_connections")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      console.log("[Watcher Start] Telegram connection lookup result:", telegramConn);

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

      console.log("[Watcher Start] API Key found:", !!apiKeyRecord?.api_key);

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
      console.log("[Watcher Start] Strategy found:", !!strategyText);

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
      const watcherUpsertData = {
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
        };
      console.log("[Watcher Start] About to upsert watcher:", watcherUpsertData);

      const { error: watchersError } = await supabase
        .from("watchers")
        .upsert(watcherUpsertData, { onConflict: "user_id,selected_pair" });

      if (watchersError) {
        console.error("[Watcher Start] Supabase error:", watchersError);
        return res.status(500).json({
          success: false,
          error: "Failed to write watcher state to DB: " + watchersError.message
        });
      }
      console.log("[Watcher Start] Upsert successful");
      return res.status(200).json({ success: true, message: "Watcher activated successfully" });

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

      // Load Watchlist (currency pairs) from watchers table
      const { data: activeWatchers, error: watchersError2 } = await supabase
        .from("watchers")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "active");

      if (watchersError2) {
        console.error("[Watcher Scan] Watchers query error:", watchersError2.message);
        return res.status(500).json({ success: false, error: "Database error fetching active watchers: " + watchersError2.message });
      }

      if (!activeWatchers || activeWatchers.length === 0) {
        return res.json({
          success: true,
          message: "No active watchers found. No currency pairs to scan.",
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

      // 7. Fetch live market data from Twelve Data for every pair in the user's watchers
      const collectedData: Record<string, any> = {};

      for (const watcherItem of activeWatchers) {
        const symbol = watcherItem.selected_pair;
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
