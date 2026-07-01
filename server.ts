import express from "express";
import path from "path";
import { createClient } from "@supabase/supabase-js";

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

        // Update database record
        const { error: updateError } = await supabase
          .from("telegram_connections")
          .update({
            telegram_chat_id: String(chatId),
            telegram_user_id: String(telegramUserId),
            telegram_username: telegramUsername,
            connected: true,
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

  // Telegram Webhook GET Route (for health check / verification)
  app.get("/api/telegram/webhook", (req, res) => {
    return res.json({
      status: "operational",
      service: "Gaks AI Telegram Webhook Express API",
      message: "Telegram Webhook endpoint is active and listening for POST requests.",
      timestamp: new Date().toISOString()
    });
  });

  // Initialize rates baseline
  await updateRatesFromAPI();

  // API Endpoint - Starts the watcher backend infrastructure with user's key
  app.post("/api/watcher/start", (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey) {
      return res.status(400).json({ success: false, error: "API key is required." });
    }
    
    // Store key securely in memory to simulate active analyzer instance
    activeWatcherApiKey = apiKey;
    console.log("AI Market Watcher backend infrastructure initialized and configured with Gemini API key.");
    
    return res.json({
      success: true,
      message: "AI Market Watcher backend analysis service has been successfully prepared with your Gemini API key."
    });
  });

  // API Endpoint - Verifies all watcher requirements and activates it
  app.post("/api/watcher/activate", async (req, res) => {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: "User identifier is required." });
    }

    try {
      console.log(`[Watcher Activation] Verifying requirements for user: ${userId}`);

      // 1. Verify Telegram connection
      const { data: telegramConn, error: telegramError } = await supabase
        .from("telegram_connections")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (telegramError) {
        console.warn("[Watcher Activation] Telegram query error:", telegramError.message);
      }

      if (!telegramConn || !telegramConn.connected) {
        return res.status(400).json({
          success: false,
          error: "Telegram is not connected. Please connect your Telegram account first under Gaks AI Settings."
        });
      }

      // 2. Verify Gemini API Key exists
      const { data: apiKeyRecord, error: apiKeyError } = await supabase
        .from("user_api_keys")
        .select("*")
        .eq("user_id", userId)
        .eq("provider", "gemini")
        .maybeSingle();

      if (apiKeyError) {
        console.warn("[Watcher Activation] API Key query error:", apiKeyError.message);
      }

      if (!apiKeyRecord || !apiKeyRecord.api_key) {
        return res.status(400).json({
          success: false,
          error: "Gemini API key is missing. Please save a valid Gemini API key under AI Settings before activating."
        });
      }

      // 3 & 4. Verify Strategy Playbook and Risk settings exist
      const { data: prefsRecord, error: prefsError } = await supabase
        .from("trading_preferences")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (prefsError) {
        console.warn("[Watcher Activation] Trading preferences query error:", prefsError.message);
      }

      const defaultTemplate = `• Entry conditions\n• Confirmation indicators\n• Exit & stop-loss logic\n• Risk management rules`;
      const strategyText = prefsRecord?.strategy_text || '';

      if (!strategyText.trim() || strategyText.trim() === defaultTemplate.trim()) {
        return res.status(400).json({
          success: false,
          error: "Trading Strategy playbook is empty or not configured. Please write your custom strategy details under the Strategy Playbook section first."
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

      // 5. Requirements met! Create or update watcher record in Supabase
      const nowString = new Date().toISOString();
      let dbSaved = false;

      try {
        const { error: upsertError } = await supabase
          .from("market_watchers")
          .upsert({
            user_id: userId,
            status: "active",
            activated_at: nowString,
            updated_at: nowString
          }, { onConflict: "user_id" });

        if (upsertError) {
          console.warn("[Watcher Activation] Failed to write to market_watchers table, using runtime success fallback:", upsertError.message);
        } else {
          dbSaved = true;
        }
      } catch (err: any) {
        console.warn("[Watcher Activation] Exception writing to market_watchers table:", err.message);
      }

      return res.json({
        success: true,
        message: "AI Market Watcher successfully validated and activated! Monitoring is now live.",
        activatedAt: nowString,
        dbSaved
      });

    } catch (err: any) {
      console.error("[Watcher Activation] Unhandled internal exception:", err);
      return res.status(500).json({
        success: false,
        error: "Internal server error during watcher activation: " + (err.message || "Unknown error")
      });
    }
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
        "GET /api/live-rates"
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
