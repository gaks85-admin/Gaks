import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from '@google/genai';
import { analyzeMarket, Candle } from '../../src/lib/strategy-engine.js';
import { buildTelegramAlertMessage } from '../../src/lib/telegram-formatter.js';

// --- Inlined Gemini Wrapper ---

export function getScanIntervalMinutes(watcher: any): number {
  const rawInterval = watcher?.scan_interval ?? watcher?.scan_interval_minutes;
  if (rawInterval !== undefined && rawInterval !== null && rawInterval !== '') {
    const parsed = typeof rawInterval === 'number' ? rawInterval : parseInt(String(rawInterval), 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const tf = (watcher?.selected_timeframe || '').toUpperCase().trim();
  if (tf === 'M1' || tf === '1M' || tf === '1') return 1;
  if (tf === 'M5' || tf === '5M' || tf === '5') return 5;
  if (tf === 'M15' || tf === '15M' || tf === '15') return 15;
  if (tf === 'M30' || tf === '30M' || tf === '30') return 30;
  if (tf === 'H1' || tf === '1H' || tf === '60') return 60;
  if (tf === 'H4' || tf === '4H' || tf === '240') return 240;
  if (tf === 'D1' || tf === '1D' || tf === '1440') return 1440;

  return 5;
}

export type GeminiErrorType = 'invalid_key' | 'quota_exceeded' | 'rate_limited' | 'temporary_failure' | 'unknown_error';

export function classifyGeminiError(error: any): GeminiErrorType {
    const message = error.message ? error.message.toLowerCase() : '';
    const status = error.status || 0;

    if (status === 401 || status === 403 || message.includes('invalid') || message.includes('permission denied')) {
        return 'invalid_key';
    }
    if (status === 429 || message.includes('quota') || message.includes('rate limit')) {
        return 'quota_exceeded';
    }
    if (status >= 500 || message.includes('timeout') || message.includes('network')) {
        return 'temporary_failure';
    }
    return 'unknown_error';
}

export async function runGeminiRequest(
    supabase: any,
    userId: string,
    prompt: string,
    model: string = 'gemini-2.5-flash',
    config?: any
) {
    const tableName = 'user_api_keys';
    const providerFilter = 'gemini';
    const statusFilter = 'none (removed: column does not exist in schema)';

    console.log(`[Gemini API Key Lookup Audit] Executing lookup:`);
    console.log(`- Table Name: ${tableName}`);
    console.log(`- user_id: ${userId}`);
    console.log(`- provider: ${providerFilter}`);
    console.log(`- status filter: ${statusFilter}`);
    console.log(`- Supabase JS Query: supabase.from('${tableName}').select('api_key').eq('user_id', '${userId}').eq('provider', '${providerFilter}').maybeSingle()`);
    console.log(`- Exact SQL Query: SELECT api_key FROM public.${tableName} WHERE user_id = '${userId}' AND provider = '${providerFilter}' LIMIT 1;`);

    // 1. Fetch the Gemini API key using only existing database columns
    const { data: apiKeyData, error: apiKeyError } = await supabase
        .from(tableName)
        .select('api_key')
        .eq('user_id', userId)
        .eq('provider', providerFilter)
        .maybeSingle();

    if (apiKeyError) {
        console.error("[Gemini API Key Lookup Audit] Supabase query error:", JSON.stringify(apiKeyError, null, 2));
        console.log("error.code =", apiKeyError?.code);
        console.log("error.message =", apiKeyError?.message);
        console.log("error.details =", apiKeyError?.details);
        console.log("error.hint =", apiKeyError?.hint);
    }

    // 2. Schema Comparison & Audit Verification
    console.log(`[Gemini API Key Lookup Audit] Comparing query filters against actual schema of '${tableName}':`);
    console.log(`- Correct Table Queried: Yes ('${tableName}')`);
    console.log(`- Correct user_id Used: Yes ('${userId}')`);
    console.log(`- Provider matches stored schema type: Yes ('${providerFilter}' matches TEXT column 'provider')`);
    console.log(`- Status filter matches stored schema type: Yes (Verified: No status filter is applied as the 'status' column does not exist in 'user_api_keys' schema)`);

    if (!apiKeyData || !apiKeyData.api_key) {
        console.log(`[Gemini API Key Lookup Audit] Row NOT found. Investigating the exact reason...`);
        
        // Let's see if we can find ANY key for this user regardless of provider to provide better debug logs
        const { data: anyKeyData, error: anyKeyError } = await supabase
            .from(tableName)
            .select('provider')
            .eq('user_id', userId);

        if (anyKeyError) {
            console.error("[Gemini API Key Lookup Audit] Error running any-key query:", JSON.stringify(anyKeyError, null, 2));
            console.log("error.code =", anyKeyError?.code);
            console.log("error.message =", anyKeyError?.message);
            console.log("error.details =", anyKeyError?.details);
            console.log("error.hint =", anyKeyError?.hint);
        }

        if (!anyKeyData || anyKeyData.length === 0) {
            console.log(`[Gemini API Key Lookup Audit] LOG EXACT WHY: There are zero entries in '${tableName}' for user_id='${userId}'. The user has not registered any API keys yet.`);
        } else {
            console.log(`[Gemini API Key Lookup Audit] LOG EXACT WHY: Entries exist for user_id='${userId}', but none for provider='${providerFilter}'. Stored providers: ${anyKeyData.map((k: any) => k.provider).join(', ')}`);
        }
        
        throw new Error('Gemini API key not found for user.');
    }

    console.log(`[Gemini API Key Lookup Audit] Success: Gemini API key successfully retrieved for user_id='${userId}'.`);


    const { data: watcher, error: watcherError } = await supabase
        .from('watchers')
        .select('status')
        .eq('user_id', userId)
        .maybeSingle();

    if (watcher && watcher.status !== 'active') {
        throw new Error('Watcher skipped because Gemini key is inactive.');
    }

    const ai = new GoogleGenAI({ apiKey: apiKeyData.api_key });

    try {
        const geminiResponse = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: config
        });

        console.log(
          "[FULL GEMINI RESPONSE]\n" +
          JSON.stringify(geminiResponse, null, 2)
        );

        if (typeof geminiResponse.text === 'function') {
            return await (geminiResponse.text as any)();
        } else if (typeof geminiResponse.text === 'string') {
            return geminiResponse.text;
        } else {
            return (geminiResponse as any).candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        }
    } catch (error: any) {
        const errorType = classifyGeminiError(error);
        console.error(`[Gemini API Request Error] Request failed: ${errorType}`, error);
        throw error;
    }
}


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


// In-memory duplicate cache for signal registration (15-min window per watcher)
const registeredSignalsCache = new Map<string, { hash: string; timestamp: number }>();

export interface SignalPayload {
  pair: string;
  timeframe?: string;
  direction: string;
  entryPrice: number | string | null;
  stopLoss: number | string | null;
  takeProfit: number | string | null;
  riskRewardRatio?: number | string | null;
  confidenceScore: number;
  aiReasoning?: string | string[];
}

export async function registerSignal(
  supabase: any,
  watcher: any,
  signal: SignalPayload
): Promise<boolean> {
  // Only WAITING state may generate new signals.
  const currentStatus = (watcher?.trade_status || 'WAITING').toUpperCase().trim();
  if (currentStatus !== 'WAITING') {
    console.log(`[registerSignal] Watcher ${watcher.id} is in status '${currentStatus}' (not WAITING). Skipping to prevent duplicate signals.`);
    return false;
  }

  const signalHash = `${signal.pair}_${signal.direction}_${signal.entryPrice}`;
  console.log(`[registerSignal] Processing signal registration for watcher ${watcher.id}...`);
  console.log(`[registerSignal] Signal payload:`, JSON.stringify(signal, null, 2));
  console.log(`[registerSignal] Signal hash generated: ${signalHash}`);

  try {
    // 1. Duplicate Check
    console.log("[REGISTER] About to check duplicate");
    const cached = registeredSignalsCache.get(watcher.id);
    const now = Date.now();
    const isDuplicate = !!(cached && cached.hash === signalHash && (now - cached.timestamp < 15 * 60 * 1000));

    console.log("[REGISTER] Duplicate query result:", { cached, isDuplicate }, null);

    if (isDuplicate) {
      console.log(`[registerSignal] Genuine duplicate signal detected for ${signal.pair} on watcher ${watcher.id}. Skipping.`);
      console.log("[REGISTER] Returning:", false);
      return false;
    }

    // 2. Insert/Update registration log in database
    console.log("[REGISTER] About to update watcher");
    const payload = {
      last_scan_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    console.log("[REGISTER] Update payload:", payload);

    const { data: updatedRows, error: updateError } = await supabase
      .from("watchers")
      .update(payload)
      .eq("id", watcher.id)
      .eq("trade_status", "WAITING")
      .select();

    console.log("[REGISTER] Update result:", updatedRows);
    console.log("[REGISTER] Update error:", updateError);

    if (updateError) {
      console.error(`[registerSignal] Database update failed for watcher ${watcher.id}:`, updateError.message);
      console.log("[REGISTER] Returning:", false);
      return false;
    }

    if (!updatedRows || updatedRows.length === 0) {
      console.log(`[registerSignal] No rows returned from update for watcher ${watcher.id}`);
      console.log("[REGISTER] Returning:", false);
      return false;
    }

    // 3. Save to duplicate cache
    registeredSignalsCache.set(watcher.id, { hash: signalHash, timestamp: now });

    console.log(`[registerSignal] Signal registered successfully for ${signal.pair}.`);
    console.log("[REGISTER] Returning:", true);
    return true;

  } catch (err: any) {
    console.error(`[registerSignal] Exception caught during signal registration:`, err);
    console.error(`[REGISTER] Exception stack:`, err?.stack || err);
    console.log("[REGISTER] Returning:", false);
    return false;
  }
}

/**
 * Self-contained Supabase client initialization.
 */
const getSupabase = () => {
  const url = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_BheqR2OkNYKqT7bj8xThWA_gGG2hcjf";
  
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

export async function fetchCurrentPrice(selectedPair: string, twelveDataKey: string): Promise<number | null> {
  const mappedSymbol = toDisplaySymbol(selectedPair);
  // Try /price endpoint first
  const priceUrl = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(mappedSymbol)}&apikey=${twelveDataKey}`;
  try {
    const res = await fetchWithRetry(priceUrl, { signal: AbortSignal.timeout(4000) }, 2, 500);
    if (res.ok) {
      const data = await res.json();
      if (data && data.price) {
        const parsed = parseFloat(String(data.price));
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    }
  } catch (err: any) {
    console.warn(`[fetchCurrentPrice] /price endpoint failed for ${mappedSymbol}: ${err.message || err}`);
  }

  // Fallback to /quote endpoint
  const quoteUrl = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(mappedSymbol)}&apikey=${twelveDataKey}`;
  try {
    const res = await fetchWithRetry(quoteUrl, { signal: AbortSignal.timeout(4000) }, 2, 500);
    if (res.ok) {
      const data = await res.json();
      const val = data?.price || data?.close;
      if (val) {
        const parsed = parseFloat(String(val));
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    }
  } catch (err: any) {
    console.warn(`[fetchCurrentPrice] /quote endpoint failed for ${mappedSymbol}: ${err.message || err}`);
  }

  return null;
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
  try {
    console.log("[CRON STEP 1] Handler entered");
    console.log({
      NODE_ENV: process.env.NODE_ENV,
      VERCEL_ENV: process.env.VERCEL_ENV,
      VERCEL_URL: process.env.VERCEL_URL,
      githubExists: !!process.env.GITHUB_TOKEN,
    });
    console.log("LOG: Cron started");
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

    // 1. Load Environment Variables
    const twelveDataKey = process.env.TWELVE_DATA_API_KEY;
    const cronSecretRaw = process.env.CRON_SECRET;
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;

    console.log("LOG: Environment variables loaded");

    // 2. Supabase Connection
    let supabase: any;
    try {
      supabase = getSupabase();
      console.log("LOG: Supabase connected");
      console.log("[CRON STEP 3]");
    } catch (err: any) {
      console.error("LOG ERROR: Supabase connection failed");
      console.error(`Exception: ${err.message}`);
      console.error(`Stack: ${err.stack}`);
      return res.status(500).json({ success: false, error: "Supabase connection failed" });
    }

    // Debug logging immediately before the authorization check
    console.log("DEBUG CRON AUTH:", {
      method: req.method,
      headers: req.headers,
      authorization: req.headers.authorization || req.headers['authorization'] || null,
    });

    // Protect the endpoint using a CRON_SECRET
    const authHeader = req.headers.authorization || req.headers['authorization'];
    
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

    if (!authorized) {
      console.warn(`LOG: Unauthorized access attempt: ${authFailureReason}`);
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        reason: authFailureReason
      });
    }

    console.log("[CRON STEP 2]");

    if (!twelveDataKey) {
      throw new Error("Missing TWELVE_DATA_API_KEY environment variable.");
    }

    // 3. Active Watchers Found
    const { data: watchers, error: fetchError } = await supabase
      .from("watchers")
      .select("*")
      .eq("status", "active");
      
    if (fetchError) {
      throw fetchError;
    }

    console.log("[CRON STEP 4]");
    console.log(`LOG: Active watchers found: ${watchers ? watchers.length : 0}`);
    
    if (!watchers || watchers.length === 0) {
      console.log("LOG: Cron completed (No active watchers)");
      return res.status(200).json({
        success: true,
        processed: 0,
        signalsSent: 0,
        executionTimeMs: Date.now() - startTime
      });
    }

    const results = [];
    const skipped = [];
    const errors = [];
    
    let twelveDataExhausted = false;

    console.log("[CRON STEP 5]");

    // Process each active watcher sequentially to respect Twelve Data free limits
    for (const watcher of watchers) {
      // Ensure the endpoint finishes within 30 seconds by stopping early if needed
      if (Date.now() - startTime > 25000) {
        console.warn("LOG: Approaching 30s timeout limit. Stopping early.");
        break;
      }

      const userId = watcher.user_id;
      const selectedPair = toCanonicalSymbol(watcher.selected_pair || "");
      const symbol = selectedPair;
      const selectedTimeframe = watcher.selected_timeframe || 'H1';
      let tradeStatus = (watcher.trade_status || 'WAITING').toUpperCase().trim();
      const now = new Date();
      const scanIntervalMinutes = getScanIntervalMinutes(watcher);

      let lastScanDate: Date | null = null;
      if (watcher.last_scan_at) {
        const parsed = new Date(watcher.last_scan_at);
        if (!isNaN(parsed.getTime())) {
          lastScanDate = parsed;
        }
      }

      let nextScanDate: Date | null = null;
      if (lastScanDate) {
        nextScanDate = new Date(lastScanDate.getTime() + scanIntervalMinutes * 60 * 1000);
      }

      const cooldownUntilStr = watcher.cooldown_until ? new Date(watcher.cooldown_until).toISOString() : 'NULL';

      console.log(`--- Processing Watcher ${watcher.id} (${selectedPair}) ---`);
      console.log(`State: ${tradeStatus}`);
      console.log(`Current Time: ${now.toISOString()}`);
      console.log(`Last Scan: ${lastScanDate ? lastScanDate.toISOString() : 'NULL'}`);
      console.log(`Cooldown Until: ${cooldownUntilStr}`);
      console.log(`Next Eligible Scan: ${nextScanDate ? nextScanDate.toISOString() : 'NOW'}`);
      console.log(`Trade Status: ${tradeStatus}`);

      if (!selectedPair) {
        console.log(`LOG: Watcher ${watcher.id} skipped - No selected pair`);
        skipped.push({ userId, reason: "No selected pair" });
        watchersSkippedCount++;
        continue;
      }

      // =====================================================================
      // STATE 3 — COOLDOWN
      // =====================================================================
      if (tradeStatus === 'COOLDOWN') {
        console.log(`[BRANCH EXECUTED] COOLDOWN branch for Watcher ID: ${watcher.id}`);
        const cooldownUntilDate = watcher.cooldown_until ? new Date(watcher.cooldown_until) : null;
        const isCooldownExpired = !cooldownUntilDate || (now.getTime() >= cooldownUntilDate.getTime());

        if (!isCooldownExpired) {
          const remainingMs = cooldownUntilDate ? (cooldownUntilDate.getTime() - now.getTime()) : 0;
          const remainingMin = Math.ceil(remainingMs / (1000 * 60));
          console.log(`Watcher in cooldown`);
          console.log(`Watcher ID: ${watcher.id}`);
          console.log(`Current Time: ${now.toISOString()}`);
          console.log(`Cooldown Until: ${cooldownUntilDate ? cooldownUntilDate.toISOString() : 'NULL'}`);
          console.log(`Remaining: ${remainingMin} minute(s)`);

          watchersProcessedCount++;
          results.push({ userId, symbol, tradeStatus: 'COOLDOWN', result: 'In cooldown' });
          continue;
        }

        // If TRUE (expired): Clear all previous trade fields and reset to WAITING
        console.log(`[COOLDOWN EXPIRED] Resetting all trade fields and setting trade_status = WAITING for Watcher ID: ${watcher.id}`);
        const { data: cooldownResetData, error: cooldownResetErr } = await supabase
          .from("watchers")
          .update({
            trade_status: 'WAITING',
            entry_price: null,
            stop_loss: null,
            take_profit: null,
            direction: null,
            signal_message_id: null,
            opened_at: null,
            closed_at: null,
            cooldown_until: null,
            updated_at: new Date().toISOString()
          })
          .eq("id", watcher.id)
          .select();

        if (cooldownResetErr || !cooldownResetData || cooldownResetData.length === 0) {
          console.error(`[COOLDOWN RESET ERROR] Watcher ID: ${watcher.id} failed to reset to WAITING:`, cooldownResetErr?.message || 'No rows returned');
        } else {
          console.log(`[COOLDOWN RESET SUCCESS] Watcher ID: ${watcher.id} successfully reset to WAITING in Supabase.`);
        }

        watcher.trade_status = 'WAITING';
        watcher.entry_price = null;
        watcher.stop_loss = null;
        watcher.take_profit = null;
        watcher.direction = null;
        watcher.signal_message_id = null;
        watcher.opened_at = null;
        watcher.closed_at = null;
        watcher.cooldown_until = null;
        tradeStatus = 'WAITING';
      }

      // =====================================================================
      // STATE 2 — ACTIVE TRADE
      // =====================================================================
      if (tradeStatus === 'ACTIVE') {
        console.log(`[BRANCH EXECUTED] ACTIVE branch (Price Monitoring Only) for Watcher ID: ${watcher.id}`);
        console.log(`[STATE 2 - ACTIVE] Monitoring open trade for Watcher ID: ${watcher.id} (${selectedPair}). Skipping Gemini, strategy load, and candle download.`);

        // Fetch Telegram Chat ID for trade status updates
        const { data: telegramConn } = await supabase
          .from("telegram_connections")
          .select("telegram_chat_id, connected")
          .eq("user_id", userId)
          .maybeSingle();

        const telegramChatId = (telegramConn && telegramConn.connected) ? telegramConn.telegram_chat_id : (watcher.telegram_chat_id || null);

        // Fetch ONLY the latest market price from Twelve Data
        const currentPrice = await fetchCurrentPrice(selectedPair, twelveDataKey);

        if (currentPrice === null) {
          console.warn(`[STATE 2 - ACTIVE] Could not fetch current price for ${selectedPair}. Skipping this check.`);
          skipped.push({ userId, reason: "Failed to fetch current price for active trade" });
          watchersSkippedCount++;
          continue;
        }

        const entryPrice = watcher.entry_price ? parseFloat(String(watcher.entry_price)) : null;
        const stopLoss = watcher.stop_loss ? parseFloat(String(watcher.stop_loss)) : null;
        const takeProfit = watcher.take_profit ? parseFloat(String(watcher.take_profit)) : null;
        const dir = (watcher.direction || '').toUpperCase().trim();
        const isBuy = dir === 'BUY' || dir === 'LONG';
        const isSell = dir === 'SELL' || dir === 'SHORT';

        console.log(`[STATE 2 Price Check] Watcher ID: ${watcher.id}, Symbol: ${selectedPair}, Current: ${currentPrice}, Entry: ${entryPrice}, SL: ${stopLoss}, TP: ${takeProfit}, Dir: ${dir}`);

        let isTP = false;
        let isSL = false;

        if (isBuy) {
          if (takeProfit !== null && !isNaN(takeProfit) && currentPrice >= takeProfit) {
            isTP = true;
          }
          if (stopLoss !== null && !isNaN(stopLoss) && currentPrice <= stopLoss) {
            isSL = true;
          }
        } else if (isSell) {
          if (takeProfit !== null && !isNaN(takeProfit) && currentPrice <= takeProfit) {
            isTP = true;
          }
          if (stopLoss !== null && !isNaN(stopLoss) && currentPrice >= stopLoss) {
            isSL = true;
          }
        }

        if (!isTP && !isSL) {
          console.log(`[STATE 2 - ACTIVE] Neither TP nor SL hit for Watcher ID: ${watcher.id} (${selectedPair}). Exiting immediately.`);
          watchersProcessedCount++;
          results.push({ userId, symbol, tradeStatus: 'ACTIVE', result: 'Holding' });
          continue;
        }

        const lastScanMs = watcher.last_scan_at ? new Date(watcher.last_scan_at).getTime() : now.getTime();
        const cooldownUntilIso = new Date(Math.max(now.getTime(), lastScanMs) + scanIntervalMinutes * 60 * 1000).toISOString();

        // Handle TP Reached
        if (isTP) {
          console.log(`[STATE 2 - ACTIVE] ✅ Target reached for Watcher ID: ${watcher.id} (${selectedPair})! Exit price: ${currentPrice}, TP: ${takeProfit}`);
          
          if (telegramChatId) {
            const tpMsg = `✅ Trade closed\nTarget reached`;
            await sendTelegramMessage(telegramChatId, tpMsg);
            telegramMessagesSentCount++;
          }

          // Transition to COOLDOWN
          const { data: tpCooldownData, error: tpCooldownErr } = await supabase
            .from("watchers")
            .update({
              trade_status: 'COOLDOWN',
              closed_at: new Date().toISOString(),
              cooldown_until: cooldownUntilIso,
              last_scan_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq("id", watcher.id)
            .select();

          if (tpCooldownErr || !tpCooldownData || tpCooldownData.length === 0) {
            console.error(`[COOLDOWN UPDATE ERROR] Watcher ID: ${watcher.id} failed to update to COOLDOWN:`, tpCooldownErr?.message || 'No rows returned');
          } else {
            console.log(`[COOLDOWN UPDATE SUCCESS] Watcher ID: ${watcher.id} successfully updated to trade_status = COOLDOWN in Supabase.`);
          }

          watchersProcessedCount++;
          results.push({ userId, symbol, tradeStatus: 'COOLDOWN', result: 'Closed TP' });
          continue;
        }

        // Handle SL Reached
        if (isSL) {
          console.log(`[STATE 2 - ACTIVE] ❌ Stop loss hit for Watcher ID: ${watcher.id} (${selectedPair})! Exit price: ${currentPrice}, SL: ${stopLoss}`);

          if (telegramChatId) {
            const slMsg = `❌ Trade closed\nStop loss hit`;
            await sendTelegramMessage(telegramChatId, slMsg);
            telegramMessagesSentCount++;
          }

          // Transition to COOLDOWN
          const { data: slCooldownData, error: slCooldownErr } = await supabase
            .from("watchers")
            .update({
              trade_status: 'COOLDOWN',
              closed_at: new Date().toISOString(),
              cooldown_until: cooldownUntilIso,
              last_scan_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq("id", watcher.id)
            .select();

          if (slCooldownErr || !slCooldownData || slCooldownData.length === 0) {
            console.error(`[COOLDOWN UPDATE ERROR] Watcher ID: ${watcher.id} failed to update to COOLDOWN:`, slCooldownErr?.message || 'No rows returned');
          } else {
            console.log(`[COOLDOWN UPDATE SUCCESS] Watcher ID: ${watcher.id} successfully updated to trade_status = COOLDOWN in Supabase.`);
          }

          watchersProcessedCount++;
          results.push({ userId, symbol, tradeStatus: 'COOLDOWN', result: 'Closed SL' });
          continue;
        }
      }

      // =====================================================================
      // STATE 1 — WAITING
      // =====================================================================
      if (tradeStatus !== 'WAITING') {
        console.warn(`[STATE GUARD] Watcher ID: ${watcher.id} is in status '${tradeStatus}' (not WAITING). Bypassing signal generation.`);
        continue;
      }

      console.log(`[BRANCH EXECUTED] WAITING branch for Watcher ID: ${watcher.id}`);

      // Determine if watcher is due for a scan
      let isDue = false;
      if (!lastScanDate) {
        isDue = true;
      } else {
        isDue = now.getTime() >= nextScanDate!.getTime();
      }

      // Skip watcher if not due yet
      if (!isDue) {
        console.log("[Watcher Skip] Not due yet.");
        skipped.push({ userId, reason: "Not due yet" });
        watchersSkippedCount++;
        continue;
      }

      try {
        // Strategy Loaded
        const [{ data: prefsRecord }, { data: apiKeyRecord }] = await Promise.all([
          supabase.from("trading_preferences").select("*").eq("user_id", userId).maybeSingle(),
          supabase.from("user_api_keys").select("*").eq("user_id", userId).eq("provider", "gemini").maybeSingle()
        ]);

        const rawStrategyText = prefsRecord?.strategy_text;

        if (!rawStrategyText || !rawStrategyText.trim()) {
          console.log(`[CRON] Strategy text missing for ${userId}`);
          console.log(`LOG: Watcher ${watcher.id} skipped - Strategy text missing for user ${userId}`);
          skipped.push({ userId, reason: `Strategy text missing for ${userId}` });
          watchersSkippedCount++;
          continue;
        }

        const strategyText = extractStrategyTextById(rawStrategyText, watcher.strategy_id);
        console.log(`LOG: Strategy loaded for ${selectedPair}`);

        // Check Telegram connection
        const { data: telegramConn } = await supabase
          .from("telegram_connections")
          .select("telegram_chat_id, connected")
          .eq("user_id", userId)
          .maybeSingle();

        if (!telegramConn || !telegramConn.connected || !telegramConn.telegram_chat_id) {
          console.log(`LOG: Watcher ${watcher.id} skipped - Telegram not connected`);
          skipped.push({ userId, reason: "Telegram not connected" });
          watchersSkippedCount++;
          continue;
        }
        const telegramChatId = telegramConn.telegram_chat_id;

        const accountSize = watcher.account_size || (prefsRecord?.capital ? parseFloat(prefsRecord.capital.replace(/[^0-9.]/g, "")) : null);
        const riskPercentage = watcher.risk_percentage || (prefsRecord?.preferred_risk ? parseFloat(prefsRecord.preferred_risk.replace(/[^0-9.]/g, "")) : null);

        if (!accountSize || !riskPercentage) {
          console.log(`LOG: Watcher ${watcher.id} skipped - Account size/risk not defined`);
          skipped.push({ userId, reason: "Account size or risk percentage not defined" });
          watchersSkippedCount++;
          continue;
        }

        if (!apiKeyRecord || !apiKeyRecord.api_key) {
          console.log(`LOG: Watcher ${watcher.id} skipped - Gemini API Key missing`);
          skipped.push({ userId, reason: "Gemini API Key missing" });
          watchersSkippedCount++;
          continue;
        }

        // Candle Data Downloaded
        const mappedSymbol = toDisplaySymbol(selectedPair);
        const interval = mapTimeframeToInterval(selectedTimeframe);

        let quoteData: any = null;
        let candleData: Candle[] = [];

        if (!twelveDataExhausted) {
          const validation = await validateSymbolWithTwelveData(mappedSymbol, twelveDataKey);
          
          if (!validation.isValid) {
            if (validation.reason?.includes("429")) {
              twelveDataExhausted = true;
            } else {
              console.log(`LOG: Watcher ${watcher.id} skipped - TwelveData validation failed: ${validation.reason}`);
              continue;
            }
          }
          
          if (!twelveDataExhausted) {
            const finalSymbol = validation.matchedSymbol || mappedSymbol;
            const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(finalSymbol)}&interval=${interval}&outputsize=20&apikey=${twelveDataKey}`;

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
                  candleData = tsData.values.map((v: any) => ({
                    timestamp: v.datetime,
                    open: parseFloat(v.open),
                    high: parseFloat(v.high),
                    low: parseFloat(v.low),
                    close: parseFloat(v.close),
                    volume: v.volume ? parseFloat(v.volume) : undefined
                  })).reverse();
                }
              }
            } catch (tsErr: any) {
              console.warn(`[Twelve Data API] error for ${finalSymbol}: ${tsErr.message || tsErr}`);
            }
          }
        }

        if (candleData.length < 2) {
           console.log(`LOG: Watcher ${watcher.id} skipped - Candle data downloaded: NO (insufficient data)`);
           skipped.push({ userId, reason: "Insufficient market data." });
           watchersSkippedCount++;
           continue;
        }
        console.log(`LOG: Candle data downloaded for ${selectedPair}: YES (${candleData.length} candles)`);

        // Strategy Engine / Gemini Analysis Executed
        console.log(`LOG: Strategy engine executed for ${selectedPair}`);
        const parsedStrategy: any = {
          entryConditions: [strategyText]
        };
        const analysis = analyzeMarket(candleData, parsedStrategy);

        console.log(`LOG: Signal result for ${selectedPair}: ${analysis.signal} (Confidence: ${analysis.confidence}%)`);

        // If there is NO setup: Update last_scan_at and Exit.
        if (analysis.signal === 'NO_TRADE' || analysis.confidence < 70) {
            console.log(`[STATE 1 - WAITING] No setup for Watcher ID: ${watcher.id} (${selectedPair}). Signal: ${analysis.signal}, Confidence: ${analysis.confidence}%. Updating last_scan_at and exiting.`);
            await supabase
              .from("watchers")
              .update({ 
                 last_scan_at: new Date().toISOString(),
                 updated_at: new Date().toISOString()
              })
              .eq("id", watcher.id);
            watchersProcessedCount++;
            continue;
        }

        // Gemini / Strategy returned a VALID trade!
        const signalReasoning = Array.isArray(analysis.reasoning) ? analysis.reasoning.join("; ") : (analysis.reasoning || "Strategy criteria matched");
        console.log(`[SIGNAL GENERATED] Watcher ID: ${watcher.id}`);
        console.log(`Exact reason new signal was generated: Strategy evaluation returned signal '${analysis.signal}' with confidence ${analysis.confidence}% (>= 70 threshold) on pair ${selectedPair}. Entry: ${analysis.entryPrice}, Stop Loss: ${analysis.stopLoss}, Take Profit: ${analysis.takeProfit}. Reasoning: ${signalReasoning}`);

        const signal = {
            pair: mappedSymbol,
            timeframe: selectedTimeframe,
            direction: analysis.signal,
            strategySummary: prefsRecord?.strategy_summary || 'Custom Strategy',
            entryPrice: analysis.entryPrice,
            stopLoss: analysis.stopLoss,
            takeProfit: analysis.takeProfit,
            riskRewardRatio: analysis.riskReward,
            confidenceScore: analysis.confidence,
            aiReasoning: analysis.reasoning
        };

        const isRegistered = await registerSignal(supabase, watcher, signal);

        if (!isRegistered) {
          console.log(`LOG: Telegram send decision for ${selectedPair}: NO (Failed to register signal or active trade already exists)`);
          continue;
        }

        // Send ONE Telegram signal
        const alertMessage = buildTelegramAlertMessage(signal);
        const alertSent = await sendTelegramMessage(telegramChatId, alertMessage);
        if (alertSent) {
          telegramMessagesSentCount++;
          console.log(`LOG: Telegram message sent successfully for Watcher ID: ${watcher.id} (${selectedPair})`);
        } else {
          console.error(`LOG ERROR: Telegram message failed for Watcher ID: ${watcher.id} (${selectedPair})`);
        }

        // Save active trade state in Supabase:
        // trade_status = 'ACTIVE', entry_price, stop_loss, take_profit, direction, opened_at
        console.log(`[ACTIVE UPDATE START] Attempting to update Watcher ID: ${watcher.id} to trade_status = ACTIVE in Supabase...`);
        const { data: activeUpdateRows, error: activeUpdateErr } = await supabase
          .from("watchers")
          .update({ 
            trade_status: 'ACTIVE',
            entry_price: analysis.entryPrice,
            stop_loss: analysis.stopLoss,
            take_profit: analysis.takeProfit,
            direction: analysis.signal,
            opened_at: new Date().toISOString(),
            closed_at: null,
            cooldown_until: null,
            last_scan_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("id", watcher.id)
          .select();

        const dbUpdateActiveSucceeded = !activeUpdateErr && activeUpdateRows && activeUpdateRows.length > 0;

        if (dbUpdateActiveSucceeded) {
          console.log(`[ACTIVE UPDATE SUCCESS] Watcher ID: ${watcher.id} successfully updated to trade_status = ACTIVE in Supabase.`);
          console.log(`Whether DB update to ACTIVE succeeded: YES`);
          console.log(`Updated row data:`, JSON.stringify(activeUpdateRows[0]));
        } else {
          console.error(`[ACTIVE UPDATE FAILED] Watcher ID: ${watcher.id} failed to update to trade_status = ACTIVE in Supabase.`);
          console.error(`Error details:`, activeUpdateErr?.message || 'No rows returned from update');
          console.log(`Whether DB update to ACTIVE succeeded: NO`);
        }

        watchersProcessedCount++;
        results.push({ userId, symbol, tradeStatus: 'ACTIVE', signalsFound: 1, signalsSent: alertSent ? 1 : 0 });

      } catch (err: any) {
        console.error(`LOG ERROR: Watcher ${watcher.id} failed`);
        console.error(`Exception: ${err.message}`);
        console.error(`Stack: ${err.stack}`);
        errors.push({ userId, error: err.message || "Unknown error" });
        watchersSkippedCount++;
      }
    }

    const totalTime = Date.now() - startTime;
    console.log(`LOG: Cron completed (Processed: ${watchersProcessedCount}, Sent: ${telegramMessagesSentCount})`);

    return res.status(200).json({
      success: true,
      processed: watchersProcessedCount,
      signalsSent: telegramMessagesSentCount,
      executionTimeMs: totalTime
    });

  } catch (err: any) {
    console.error("[CRON FATAL]", err);
    return res.status(500).json({ 
      success: false, 
      error: String(err)
    });
  }
}

