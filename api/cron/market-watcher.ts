import { createClient } from '@supabase/supabase-js';
import { Type } from '@google/genai';
import { runGeminiRequest } from '../../src/lib/geminiWrapper';


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

/**
 * Canonicalizes a symbol to a standard internal format (uppercase, alphanumeric only).
 */
const toCanonicalSymbol = (symbol: string): string => {
  if (!symbol) return '';
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
};

/**
 * Converts a canonical symbol to a human-friendly display format.
 */
const toDisplaySymbol = (symbol: string): string => {
  const canonical = toCanonicalSymbol(symbol);
  const mappings: Record<string, string> = {
    'EURUSD': 'EUR/USD', 'GBPUSD': 'GBP/USD', 'USDJPY': 'USD/JPY', 'AUDUSD': 'AUD/USD',
    'USDCAD': 'USD/CAD', 'USDCHF': 'USD/CHF', 'NZDUSD': 'NZD/USD', 'BTCUSD': 'BTC/USD',
    'ETHUSD': 'ETH/USD', 'XAUUSD': 'XAU/USD', 'XAGUSD': 'XAG/USD', 'NAS100': 'NAS100',
    'US30': 'US30', 'SPX500': 'SPX500', 'GER30': 'GER30', 'UK100': 'UK100'
  };
  if (mappings[canonical]) return mappings[canonical];
  if (canonical.length === 6 && /^[A-Z]{6}$/.test(canonical)) {
    return `${canonical.slice(0, 3)}/${canonical.slice(3)}`;
  }
  return canonical;
};

/**
 * Maps application timeframes to Twelve Data intervals.
 */
const mapTimeframeToInterval = (tf: string): string => {
  if (!tf) return '1h';
  const u = tf.toUpperCase();
  if (u === 'M1' || u === '1M') return '1min';
  if (u === 'M5' || u === '5M') return '5min';
  if (u === 'M15' || u === '15M') return '15min';
  if (u === 'M30' || u === '30M') return '30min';
  if (u === 'H1' || u === '1H') return '1h';
  if (u === 'H2' || u === '2H') return '2h';
  if (u === 'H4' || u === '4H') return '4h';
  if (u === 'D1' || u === 'D' || u === 'DAILY') return '1day';
  if (u === 'W1' || u === 'W' || u === 'WEEKLY') return '1week';
  return '1h';
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
      const errText = await response.text();
      console.error(`Telegram API Error: ${response.status} - ${errText}`);
      return false;
    }
    return true;
  } catch (error: any) {
    console.error("Error sending Telegram message:", error);
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

// Global cache for symbol validation to save Twelve Data credits
const symbolValidationCache: Record<string, { isValid: boolean; matchedSymbol?: string; instrumentType?: string; reason?: string }> = {};

async function validateSymbolWithTwelveData(symbol: string, apiKey: string): Promise<{ isValid: boolean; matchedSymbol?: string; instrumentType?: string; reason?: string }> {
  if (symbolValidationCache[symbol]) return symbolValidationCache[symbol];
  
  try {
    const searchUrl = `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
    const response = await fetchWithRetry(searchUrl, {}, 2, 500);
    if (response.status === 429) {
      return { isValid: false, reason: "429: API credits exhausted" };
    }
    if (!response.ok) {
      console.warn(`[Symbol Search] API returned HTTP ${response.status} for search.`);
      return { isValid: false, reason: `API returned HTTP ${response.status}` };
    }
    const data = await response.json();
    if (data.status === "error") {
      console.warn(`[Symbol Search] API returned error status: ${data.message}`);
      const res = { isValid: false, reason: data.message };
      if (data.code !== 429) symbolValidationCache[symbol] = res;
      return res;
    }
    if (data.data && Array.isArray(data.data) && data.data.length > 0) {
      const symbolUpper = toCanonicalSymbol(symbol);
      // Try to find the exact symbol match (ignoring slashes)
      const exactMatch = data.data.find((item: any) => 
        toCanonicalSymbol(item.symbol) === symbolUpper
      );
      
      let res;
      if (exactMatch) {
        res = { isValid: true, matchedSymbol: exactMatch.symbol, instrumentType: exactMatch.instrument_type };
      } else {
        // If we got matches but none are exact, return the first one as matchedSymbol
        res = { isValid: true, matchedSymbol: data.data[0].symbol, instrumentType: data.data[0].instrument_type };
      }
      
      symbolValidationCache[symbol] = res;
      return res;
    }
    // No matching symbols found in Twelve Data database - warn and proceed with original symbol as fallback
    console.warn(`[Symbol Search] No matching symbols found in search results for "${symbol}".`);
    const finalRes = { isValid: false, reason: `No matching symbols found for "${symbol}"` };
    symbolValidationCache[symbol] = finalRes;
    return finalRes;
  } catch (err: any) {
    console.error(`[Symbol Search] Error validating symbol ${symbol}:`, err.message || err);
    return { isValid: false, reason: "Error validating symbol" };
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
  const supabase = getSupabase();
  const startTime = Date.now();
  const requestTimestamp = new Date().toISOString();

  // Metrics trackers
  let watchersProcessedCount = 0;
  let watchersSkippedCount = 0;
  let signalsGeneratedCount = 0;
  let telegramMessagesSentCount = 0;

  // Enforce JSON content type from the very beginning
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: "Method Not Allowed. Use POST." });
  }

  // Debug logging immediately before the authorization check
  console.log("DEBUG CRON AUTH:", {
    method: req.method,
    headers: req.headers,
    rawHeaders: (req as any).rawHeaders || null,
    authorization: req.headers.authorization || req.headers['authorization'] || null,
    authHeaderExists: !!(req.headers.authorization || req.headers['authorization']),
    authHeaderLength: (req.headers.authorization || req.headers['authorization'])?.length ?? 0
  });

  // Protect the endpoint using a CRON_SECRET
  const authHeader = req.headers.authorization || req.headers['authorization'];
  const cronSecretRaw = process.env.CRON_SECRET;
  
  // Robust parsing of Bearer token
  let token: string | null = null;
  if (authHeader) {
    const trimmedHeader = authHeader.trim();
    if (trimmedHeader.toLowerCase().startsWith("bearer ")) {
      token = trimmedHeader.substring(7).trim();
    } else {
      token = trimmedHeader;
    }
  }

  // Clean quotes or whitespace
  const cleanToken = token ? token.replace(/^['"]|['"]$/g, '').trim() : "";
  const cleanCronSecret = cronSecretRaw ? cronSecretRaw.trim().replace(/^['"]|['"]$/g, '').trim() : "";

  // Log the debug information WITHOUT exposing secrets
  console.log(JSON.stringify({
    event: "debug_auth_info",
    authorizationHeaderPresent: !!authHeader,
    authorizationHeaderLength: authHeader ? authHeader.length : 0,
    startsWithBearer: !!(authHeader && authHeader.trim().toLowerCase().startsWith("bearer ")),
    cronSecretPresent: !!process.env.CRON_SECRET,
    cronSecretLength: process.env.CRON_SECRET ? process.env.CRON_SECRET.length : 0,
    tokenMatches: cleanToken === cleanCronSecret
  }));

  let authorized = true;
  let authFailureReason = "";

  if (cleanCronSecret) {
    if (!authHeader) {
      authorized = false;
      authFailureReason = "Authorization header is missing.";
    } else if (!cleanToken) {
      authorized = false;
      authFailureReason = "No token could be extracted from Authorization header.";
    } else if (cleanToken !== cleanCronSecret) {
      authorized = false;
      authFailureReason = "Token mismatch.";
    }
  }

  // Structured Log: Request Received
  console.log(JSON.stringify({
    event: "request_received",
    timestamp: requestTimestamp,
    method: req.method,
    url: req.url || "/api/cron/market-watcher",
    authHeaderPresent: !!authHeader
  }));

  // Structured Log: Authentication Result
  console.log(JSON.stringify({
    event: "authentication_result",
    success: authorized,
    reason: authFailureReason || "Passed"
  }));

  if (!authorized) {
    const totalTime = Date.now() - startTime;
    console.log(JSON.stringify({
      event: "cycle_complete",
      status: "unauthorized",
      totalWatchers: 0,
      processedCount: 0,
      skippedCount: 0,
      geminiAnalysesCount: 0,
      telegramMessagesSentCount: 0,
      executionTimeMs: totalTime
    }));
    return res.status(401).json({
      success: false,
      receivedAuthorization: req.headers.authorization || null,
      method: req.method,
      headersPresent: Object.keys(req.headers)
    });
  }

  try {
    const twelveDataKey = process.env.TWELVE_DATA_API_KEY;
    if (!twelveDataKey) {
      console.error("Missing TWELVE_DATA_API_KEY environment variable.");
      const totalTime = Date.now() - startTime;
      console.log(JSON.stringify({
        event: "cycle_complete",
        status: "config_error",
        error: "Missing TWELVE_DATA_API_KEY",
        totalWatchers: 0,
        processedCount: 0,
        skippedCount: 0,
        geminiAnalysesCount: 0,
        telegramMessagesSentCount: 0,
        executionTimeMs: totalTime
      }));
      return res.status(500).json({ success: false, error: "Internal Server Error" });
    }

    // Read all active watchers
    const { data: watchers, error: fetchError } = await supabase
      .from("watchers")
      .select("*")
      .eq("status", "active");
      
    if (fetchError) {
      console.error("[Market Watcher Cron] Failed to fetch active watchers:", fetchError);
      const totalTime = Date.now() - startTime;
      console.log(JSON.stringify({
        event: "cycle_complete",
        status: "database_error",
        error: fetchError.message || "Database error",
        totalWatchers: 0,
        processedCount: 0,
        skippedCount: 0,
        geminiAnalysesCount: 0,
        telegramMessagesSentCount: 0,
        executionTimeMs: totalTime
      }));
      return res.status(500).json({ success: false, error: "Internal Server Error" });
    }

    // Structured Log: Number of Watchers
    console.log(JSON.stringify({
      event: "watchers_fetched",
      total: watchers ? watchers.length : 0
    }));
    
    if (!watchers || watchers.length === 0) {
      const totalTime = Date.now() - startTime;
      console.log(JSON.stringify({
        event: "cycle_complete",
        status: "success",
        totalWatchers: 0,
        processedCount: 0,
        skippedCount: 0,
        geminiAnalysesCount: 0,
        telegramMessagesSentCount: 0,
        executionTimeMs: totalTime
      }));
      return res.status(200).json({
        success: true,
        processed: 0,
        signalsSent: 0,
        executionTimeMs: totalTime
      });
    }

    const results = [];
    const skipped = [];
    const errors = [];
    
    let twelveDataExhausted = false;

    // Process each active watcher sequentially to respect Twelve Data free limits
    for (const watcher of watchers) {
      // Ensure the endpoint finishes within 30 seconds by stopping early if needed
      if (Date.now() - startTime > 25000) {
        console.warn(JSON.stringify({
          event: "timeout_approaching",
          message: "Approaching 30s timeout limit. Terminating loop to guarantee graceful JSON response.",
          elapsedMs: Date.now() - startTime
        }));
        break;
      }

      const userId = watcher.user_id;
      const selectedPair = toCanonicalSymbol(watcher.selected_pair || "");
      const symbol = selectedPair;
      const selectedTimeframe = watcher.selected_timeframe || 'H1';
      console.log("[WATCHER START]\nwatcher_id: " + watcher.id + "\nuser_id: " + userId + "\nselected_pair: " + selectedPair + "\nselected_timeframe: " + selectedTimeframe);
      
      if (!selectedPair) {
        console.log("[WATCHER SKIPPED]\nwatcher_id: " + watcher.id + "\nuser_id: " + userId + "\nselected_pair: " + selectedPair + "\nselected_timeframe: " + selectedTimeframe + "\nreason: Missing selected_pair");
        skipped.push({ userId, reason: "No selected pair" });
        watchersSkippedCount++;
        continue;
      }

      try {
        // Check Telegram connection
        const { data: telegramConn } = await supabase
          .from("telegram_connections")
          .select("telegram_chat_id, connected")
          .eq("user_id", userId)
          .maybeSingle();

        if (!telegramConn || !telegramConn.connected || !telegramConn.telegram_chat_id) {
          console.log("[WATCHER SKIPPED]\nwatcher_id: " + watcher.id + "\nuser_id: " + userId + "\nselected_pair: " + selectedPair + "\nselected_timeframe: " + selectedTimeframe + "\nreason: Telegram not connected");
          skipped.push({ userId, reason: "Telegram not connected" });
          watchersSkippedCount++;
          continue;
        }
        const telegramChatId = telegramConn.telegram_chat_id;

        // Fetch Trading Preferences & Gemini API Key in parallel
        const [{ data: prefsRecord }, { data: apiKeyRecord }] = await Promise.all([
          supabase.from("trading_preferences").select("*").eq("user_id", userId).maybeSingle(),
          supabase.from("user_api_keys").select("*").eq("user_id", userId).eq("provider", "gemini").maybeSingle()
        ]);

        const strategyText = extractStrategyTextById(prefsRecord?.strategy_text || '', watcher.strategy_id);

        if (!strategyText.trim()) {
          console.log("[WATCHER SKIPPED]\nwatcher_id: " + watcher.id + "\nuser_id: " + userId + "\nselected_pair: " + selectedPair + "\nselected_timeframe: " + selectedTimeframe + "\nreason: Strategy text empty");
          skipped.push({ userId, reason: "Strategy text empty" });
          watchersSkippedCount++;
          continue;
        }

        const accountSize = watcher.account_size || (prefsRecord?.capital ? parseFloat(prefsRecord.capital.replace(/[^0-9.]/g, "")) : null);
        const riskPercentage = watcher.risk_percentage || (prefsRecord?.preferred_risk ? parseFloat(prefsRecord.preferred_risk.replace(/[^0-9.]/g, "")) : null);

        if (!accountSize || !riskPercentage) {
          console.log("[WATCHER SKIPPED]\nwatcher_id: " + watcher.id + "\nuser_id: " + userId + "\nselected_pair: " + selectedPair + "\nselected_timeframe: " + selectedTimeframe + "\nreason: Account size or risk percentage not defined");
          skipped.push({ userId, reason: "Account size or risk percentage not defined" });
          watchersSkippedCount++;
          continue;
        }

        if (!apiKeyRecord || !apiKeyRecord.api_key) {
          console.log("[WATCHER SKIPPED]\nwatcher_id: " + watcher.id + "\nuser_id: " + userId + "\nselected_pair: " + selectedPair + "\nselected_timeframe: " + selectedTimeframe + "\nreason: Gemini API Key missing");
          skipped.push({ userId, reason: "Gemini API Key missing" });
          watchersSkippedCount++;
          continue;
        }

        // Fetch live market data from Twelve Data
        const mappedSymbol = toDisplaySymbol(selectedPair);
        const interval = mapTimeframeToInterval(selectedTimeframe);

        let quoteData: any = null;
        let finalEndpoint = "unknown";

        if (!twelveDataExhausted) {
          // Validate symbol before making requests
          const validation = await validateSymbolWithTwelveData(mappedSymbol, twelveDataKey);
          
          if (!validation.isValid) {
            if (validation.reason?.includes("429")) {
              twelveDataExhausted = true;
            } else {
              console.log("[WATCHER SKIPPED]\nwatcher_id: " + watcher.id + "\nreason: TwelveData validation failed: " + validation.reason);
              continue;
            }
          }
          
          if (!twelveDataExhausted) {
            const finalSymbol = validation.matchedSymbol || mappedSymbol;
            finalEndpoint = "time_series";
            const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(finalSymbol)}&interval=${interval}&outputsize=1&apikey=${twelveDataKey}`;

            try {
              const tsRes = await fetchWithRetry(timeSeriesUrl, { signal: AbortSignal.timeout(4000) }, 2, 500);
              if (tsRes.status === 429) {
                twelveDataExhausted = true;
              } else if (tsRes.ok) {
                const tsData = await tsRes.json();
                if (tsData.status === "error" && tsData.code === 429) {
                  twelveDataExhausted = true;
                } else if (tsData.status === "ok" && tsData.values && tsData.values.length > 0) {
                  quoteData = tsData.values[0];
                }
              }
            } catch (tsErr) {
              console.warn(`[Twelve Data API] /time_series error for ${finalSymbol}: ${tsErr.message || tsErr}. Trying fallback /quote.`);
            }

            // Fallback to /quote if /time_series did not work
            if (!quoteData && !twelveDataExhausted) {
              finalEndpoint = "quote";
              const quoteUrl = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(finalSymbol)}&apikey=${twelveDataKey}`;
              
              const qRes = await fetchWithRetry(quoteUrl, { signal: AbortSignal.timeout(4000) }, 2, 500);
              if (qRes.status === 429) {
                twelveDataExhausted = true;
              } else if (qRes.ok) {
                const qData = await qRes.json();
                if (qData.status === "error") {
                  if (qData.code === 429) twelveDataExhausted = true;
                  else throw new Error(`TwelveData Error: ${qData.message}`);
                } else {
                  quoteData = qData;
                }
              }
            }
          }
        }

        // AI Market Watcher must ONLY use Twelve Data. 
        // If real market data is unavailable, skip the scan.
        if (!quoteData) {
           console.log("Skipped due to unavailable market data.");
           skipped.push({ userId, reason: "Skipped due to unavailable market data." });
           watchersSkippedCount++;
           continue;
        }

        const currentPrice = parseFloat(quoteData.close || quoteData.price || "0");
        const marketData = {
          current_price: currentPrice,
          open: parseFloat(quoteData.open || "0"),
          high: parseFloat(quoteData.high || "0"),
          low: parseFloat(quoteData.low || "0"),
          close: parseFloat(quoteData.close || "0"),
          bid: quoteData.bid ? parseFloat(quoteData.bid) : null,
          ask: quoteData.ask ? parseFloat(quoteData.ask) : null,
          volume: quoteData.volume ? parseFloat(quoteData.volume) : 0,
          timestamp: quoteData.timestamp || Math.floor(Date.now() / 1000),
          timeframe: selectedTimeframe
        };

        // Analyze market data with Gemini
        const promptText = `You are an expert AI trading assistant.
Analyze the following live market data against the user's trading strategy.
Return a structured JSON list of trading signals. Only generate a signal if the setup strongly matches the strategy.
If no valid setups are found, return an empty array for signals.

User's Trading Strategy:
${strategyText}

Account Size: $${accountSize}
Risk Percentage per trade: ${riskPercentage}%
Timeframe: ${selectedTimeframe}

Live Market Data (Twelve Data):
${JSON.stringify(marketData, null, 2)}`;

        const aiResponseText = await runGeminiRequest(supabase, userId, promptText, "gemini-2.5-flash", {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                signals: {
                    type: Type.ARRAY,
                    items: {
                    type: Type.OBJECT,
                    properties: {
                        pair: { type: Type.STRING },
                        direction: { type: Type.STRING },
                        entryPrice: { type: Type.NUMBER },
                        stopLoss: { type: Type.NUMBER },
                        takeProfit: { type: Type.NUMBER },
                        riskRewardRatio: { type: Type.STRING },
                        confidenceScore: { type: Type.NUMBER },
                        aiReasoning: { type: Type.STRING }
                    },
                    required: ["pair", "direction", "entryPrice", "stopLoss", "takeProfit", "riskRewardRatio", "confidenceScore", "aiReasoning"]
                    }
                }
                },
                required: ["signals"]
            }
        });

        const parsedResult = JSON.parse(aiResponseText || '{"signals": []}');
        const signals = parsedResult.signals || [];
        signalsGeneratedCount += signals.length;
        let signalsSent = 0;

        // Send Telegram Message if valid signals found
        if (signals.length > 0) {
          for (const signal of signals) {
            if (signal.confidenceScore >= 70) {
              const signalHash = `${signal.pair}_${signal.direction}_${signal.entryPrice}`;
              
              // 1. Local Cache check
              if (watcher.last_signal_data === signalHash) {
                console.log("[WATCHER SKIPPED]\nwatcher_id: " + watcher.id + "\nuser_id: " + userId + "\nselected_pair: " + selectedPair + "\nselected_timeframe: " + selectedTimeframe + "\nreason: Duplicate signal detected");
                console.log(`[User ${userId}] Duplicate signal detected for ${signal.pair} (checked local state). Skipping alert.`);
                continue;
              }

              // 2. Atomic test-and-set in Database to prevent concurrent races
              const { data: updatedRows, error: updateError } = await supabase
                .from("watchers")
                .update({ last_signal_data: signalHash })
                .eq("id", watcher.id)
                .or(`last_signal_data.is.null,last_signal_data.neq.${signalHash}`)
                .select();

              if (updateError) {
                console.log("[WATCHER SKIPPED]\nwatcher_id: " + watcher.id + "\nuser_id: " + userId + "\nselected_pair: " + selectedPair + "\nselected_timeframe: " + selectedTimeframe + "\nreason: Atomic update error: " + updateError.message);
                console.error(`[User ${userId}] Error performing atomic update for signal:`, updateError);
                continue;
              }

              if (!updatedRows || updatedRows.length === 0) {
                console.log("[WATCHER SKIPPED]\nwatcher_id: " + watcher.id + "\nuser_id: " + userId + "\nselected_pair: " + selectedPair + "\nselected_timeframe: " + selectedTimeframe + "\nreason: Concurrent or duplicate signal already registered");
                console.log(`[User ${userId}] Concurrent or duplicate signal already registered in database for ${signal.pair}. Skipping alert.`);
                continue;
              }

              // 3. We won the database lock, safe to send Telegram message
              const alertMessage = `🚨 *Autonomous AI Trading Alert* 🚨\n\n` +
                `*Pair:* ${signal.pair} (${selectedTimeframe})\n` +
                `*Direction:* ${signal.direction === 'BUY' ? '🟢 BUY' : '🔴 SELL'}\n` +
                `*Entry Price:* ${signal.entryPrice}\n` +
                `*Stop Loss:* ${signal.stopLoss}\n` +
                `*Take Profit:* ${signal.takeProfit}\n` +
                `*Risk/Reward:* ${signal.riskRewardRatio}\n` +
                `*Confidence:* ${signal.confidenceScore}/100\n\n` +
                `*AI Reasoning:* ${signal.aiReasoning}\n\n` +
                `*Time:* ${new Date().toUTCString()}`;

              const alertSent = await sendTelegramMessage(telegramChatId, alertMessage);
              if (alertSent) {
                signalsSent++;
                telegramMessagesSentCount++;
              }
            }
          }
        }

        // Update watcher last scan timestamp
        await supabase
          .from("watchers")
          .update({ 
            last_scan_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("id", watcher.id);

        console.log("[WATCHER SUCCESS]\nwatcher_id: " + watcher.id + "\nlast_scan_at: " + new Date().toISOString());

        watchersProcessedCount++;
        results.push({ userId, symbol, signalsFound: signals.length, signalsSent });

      } catch (err: any) {
        console.log("[WATCHER SKIPPED]\nwatcher_id: " + watcher.id + "\nuser_id: " + userId + "\nselected_pair: " + selectedPair + "\nselected_timeframe: " + selectedTimeframe + "\nreason: Error: " + (err.message || err));
        console.error(`[User ${userId}] Error processing watcher:`, err.message || err);
        errors.push({ userId, error: err.message || "Unknown error" });
        watchersSkippedCount++;
      }
    }

    const totalTime = Date.now() - startTime;

    // Structured Log: Skipped Watchers
    if (watchersSkippedCount > 0) {
      console.log(JSON.stringify({
        event: "watchers_skipped",
        skipped: watchersSkippedCount,
        details: skipped
      }));
    }

    // Structured Log: Gemini Analyses Run
    console.log(JSON.stringify({
      event: "gemini_analyses",
      count: watchersProcessedCount
    }));

    // Structured Log: Telegram Messages
    console.log(JSON.stringify({
      event: "telegram_messages_sent",
      count: telegramMessagesSentCount
    }));

    // Structured Log: Cycle Complete & Execution Time
    console.log(JSON.stringify({
      event: "cycle_complete",
      status: "success",
      totalWatchers: watchers.length,
      processedCount: watchersProcessedCount,
      skippedCount: watchersSkippedCount,
      geminiAnalysesCount: watchersProcessedCount,
      telegramMessagesSentCount: telegramMessagesSentCount,
      executionTimeMs: totalTime
    }));

    return res.status(200).json({
      success: true,
      processed: watchersProcessedCount,
      signalsSent: telegramMessagesSentCount,
      executionTimeMs: totalTime
    });

  } catch (err: any) {
    const totalTime = Date.now() - startTime;
    console.error("[Market Watcher Cron] Fatal Error Stack:", err.stack || err);
    
    let errorMsg = err.message || "Unknown error";
    if (errorMsg.includes("Gemini") || (err.stack && err.stack.includes("Gemini")) || errorMsg.includes("API key not valid") || errorMsg.includes("fetch failed") || errorMsg.includes("Invalid prompt")) {
       errorMsg = "Cron failed because Gemini request failed.";
    } else if (err.status && typeof err.status === 'number' && (err.status >= 400 && err.status < 600)) {
       errorMsg = "Cron failed because Gemini request failed.";
    }

    console.log(JSON.stringify({
      event: "cycle_complete",
      status: "fatal_error",
      error: errorMsg,
      totalWatchers: 0,
      processedCount: watchersProcessedCount,
      skippedCount: watchersSkippedCount,
      geminiAnalysesCount: watchersProcessedCount,
      telegramMessagesSentCount: telegramMessagesSentCount,
      executionTimeMs: totalTime
    }));

    return res.status(500).json({ success: false, error: errorMsg });
  }
}
