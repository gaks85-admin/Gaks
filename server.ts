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

      // Upsert into watchers table
      const { error: watchersError } = await supabase
        .from("watchers")
        .upsert({
          user_id: userId,
          status: "active",
          started_at: nowString,
          telegram_chat_id: telegramChatId,
          account_size: accountSize,
          risk_percentage: riskPercentage,
          gemini_model: "gemini-2.5-flash",
          scan_interval_minutes: 5,
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

      const strategyText = watcher.strategy_id 
        ? "Active Custom Strategy ID: " + watcher.strategy_id 
        : (prefsRecord?.strategy_text || "");

      if (!strategyText.trim()) {
        return res.status(400).json({
          success: false,
          error: "Trading Strategy playbook is empty or not configured. Please write your custom strategy details first."
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

      for (const item of watchlist) {
        const symbol = item.symbol;
        const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${twelveDataKey}`;
        
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
