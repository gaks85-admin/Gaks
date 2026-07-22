import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from "@google/genai";
import { analyzeMarket, Candle } from "../../src/lib/strategy-engine.js";


async function generateContentWithDiagnostics(ai: any, params: any) {
   const contents = params.contents;
   let promptText = "";
   if (typeof contents === "string") promptText = contents;
   else if (Array.isArray(contents)) promptText = JSON.stringify(contents);
   else promptText = contents?.toString() || "";

   if (!promptText || promptText.trim().length === 0) {
      throw new Error("Invalid prompt: prompt is empty or only whitespace.");
   }
   
   console.log(`\n=== GEMINI REQUEST DIAGNOSTIC ===`);
   const apiKeyPresent = !!process.env.GEMINI_API_KEY;
   console.log(`API key present: ${apiKeyPresent}`);
   console.log(`Model: ${params.model}`);
   console.log(`Request Payload: ${JSON.stringify(params).substring(0, 500)}`);
   console.log(`Prompt Length: ${promptText.length}`);
   
   try {
      const response = await ai.models.generateContent(params);
      console.log(`=== GEMINI RESPONSE ===\n${JSON.stringify(response)}\n=======================`);
      return response;
   } catch (error: any) {
      console.error(`=== GEMINI ERROR DIAGNOSTIC ===`);
      console.error(`Error Message: ${error.message}`);
      console.error(`Status: ${error.status}`);
      console.error(`Stack: ${error.stack}`);
      console.error(`Response Body:`, error.response || error.responseBody || 'None');
      console.error(`Full Error Object: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`);
      console.error(`===============================`);
      throw error;
   }
}


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

async function sendTelegramMessage(chatId: string | number, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN is not defined in environment variables.");
    return false;
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
      return false;
    }
    return true;
  } catch (err) {
    console.error("Error sending Telegram message:", err);
    return false;
  }
}

async function fetchWithRetry(url: string, options: RequestInit = {}, maxRetries = 3, baseDelayMs = 1000): Promise<Response> {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return response;
      }
      if (response.status === 404 || response.status === 400) {
        // Do not retry client errors (like 404 Not Found)
        return response;
      }
      console.warn(`[Fetch Retry] Attempt ${attempt} returned status ${response.status}. Retrying in ${baseDelayMs * Math.pow(2, attempt - 1)}ms...`);
    } catch (err: any) {
      if (attempt >= maxRetries) {
        throw err;
      }
      console.warn(`[Fetch Retry] Attempt ${attempt} threw network error: ${err.message || err}. Retrying in ${baseDelayMs * Math.pow(2, attempt - 1)}ms...`);
    }
    await new Promise(resolve => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt - 1)));
  }
  throw new Error(`Fetch failed after ${maxRetries} attempts`);
}

async function validateSymbolWithTwelveData(symbol: string, apiKey: string): Promise<{ isValid: boolean; matchedSymbol?: string; instrumentType?: string }> {
  try {
    const searchUrl = `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
    const response = await fetchWithRetry(searchUrl, {}, 2, 500);
    if (!response.ok) {
      console.warn(`[Symbol Search] API returned HTTP ${response.status} for search. Skipping search validation and proceeding.`);
      return { isValid: true };
    }
    const data = await response.json();
    if (data.status === "error") {
      console.warn(`[Symbol Search] API returned error status: ${data.message}`);
      return { isValid: true };
    }
    if (data.data && Array.isArray(data.data) && data.data.length > 0) {
      const symbolUpper = symbol.toUpperCase().replace('/', '');
      const exactMatch = data.data.find((item: any) => 
        item.symbol.toUpperCase().replace('/', '') === symbolUpper
      );
      if (exactMatch) {
        return { isValid: true, matchedSymbol: exactMatch.symbol, instrumentType: exactMatch.instrument_type };
      }
      return { isValid: true, matchedSymbol: data.data[0].symbol, instrumentType: data.data[0].instrument_type };
    }
    // No matching symbols found in Twelve Data database - warn and proceed with original symbol as fallback
    console.warn(`[Symbol Search] No matching symbols found in search results for "${symbol}". Proceeding with original symbol.`);
    return { isValid: true, matchedSymbol: symbol };
  } catch (err: any) {
    console.error(`[Symbol Search] Error validating symbol ${symbol}:`, err.message || err);
    return { isValid: true };
  }
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

export default async function handler(req: any, res: any) {
  console.log("LOG: Manual scan started");
  const supabase = getSupabase();
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

  // 1. Load Environment Variables
  const twelveDataKey = process.env.TWELVE_DATA_API_KEY;
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  console.log("LOG: Environment variables loaded", {
    TWELVE_DATA_API_KEY: !!twelveDataKey,
    TELEGRAM_BOT_TOKEN: !!telegramBotToken
  });

  let userId = req.body.userId;

  // 2. Supabase Connection & Auth
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

    if (token) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (user) userId = user.id;
    }
    console.log("LOG: Supabase connected");
  } catch (err: any) {
    console.error("LOG ERROR: Supabase connection/auth failed");
    console.error(`Exception: ${err.message}`);
    console.error(`Stack: ${err.stack}`);
  }

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: "Authentication failed."
    });
  }

  try {
    // 3. Active Watchers Found
    const { data: watcher, error: watcherError } = await supabase
      .from("watchers")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (watcherError) throw watcherError;
    if (!watcher) throw new Error("No watcher found.");
    
    console.log(`LOG: Active watchers found: 1`);

    // 4. Strategy Loaded
    const { data: prefsRecord } = await supabase
      .from("trading_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    const strategyText = extractStrategyTextById(prefsRecord?.strategy_text || '', watcher.strategy_id);
    console.log(`LOG: Strategy loaded`);

    // 5. Parsed Strategy Loaded
    let parsed_strategy: any = null;
    if (watcher.strategy_id) {
      const { data: strategyRecord } = await supabase
        .from("strategies")
        .select("parsed_strategy")
        .eq("id", watcher.strategy_id)
        .maybeSingle();
      parsed_strategy = strategyRecord?.parsed_strategy;
    }
    console.log(`LOG: Parsed strategy loaded: ${!!parsed_strategy ? 'YES' : 'NO'}`);

    if (!parsed_strategy) throw new Error("Parsed strategy missing.");

    // 6. Candle Data Downloaded
    const symbol = watcher.selected_pair;
    const mappedSymbol = symbol; // Simplified for logging
    const selectedTimeframe = watcher.selected_timeframe || 'H1';
    const interval = '1h'; // Simplified

    const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(mappedSymbol)}&interval=${interval}&outputsize=20&apikey=${twelveDataKey}`;
    
    const tsRes = await fetch(timeSeriesUrl);
    const tsData = await tsRes.json();
    const candleData = tsData.values?.map((v: any) => ({
      timestamp: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close)
    })) || [];

    if (candleData.length < 2) throw new Error("Insufficient candle data.");
    console.log(`LOG: Candle data downloaded: YES (${candleData.length} candles)`);

    // 7. Strategy Engine Executed
    console.log("LOG: Strategy engine executed");
    const analysis = analyzeMarket(candleData, parsed_strategy);

    // 8. Signal Result
    console.log(`LOG: Signal result: ${analysis.signal}`);

    // 9. Telegram Send Decision
    const shouldSend = analysis.signal !== 'NO_TRADE' && analysis.confidence >= 70;
    console.log(`LOG: Telegram send decision: ${shouldSend ? 'YES' : 'NO'}`);

    console.log("LOG: Manual scan completed");
    return res.json({ success: true, analysis });

  } catch (err: any) {
    console.error("LOG FATAL ERROR: Manual scan failed");
    console.error(`Exception: ${err.message}`);
    console.error(`Stack: ${err.stack}`);
    return res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
}

