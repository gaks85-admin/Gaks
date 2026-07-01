import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_BheqR2OkNYKqT7bj8xThWA_gGG2hcjf";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

export default async function handler(req: any, res: any) {
  // CORS configuration
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

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
}
