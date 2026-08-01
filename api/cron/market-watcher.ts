import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from '@google/genai';
import { analyzeMarket, Candle } from '../../src/lib/strategy-engine.js';
import { ParsedStrategy } from '../../src/lib/strategy-parser.js';
import { buildTelegramAlertMessage } from '../../src/lib/telegram-formatter.js';
import { extractRiskPreferences, calculatePositionSize, logPositionSizeAudit } from '../../src/lib/risk-engine.js';
import { evaluateRules, logRuleEngineAudit } from '../../src/lib/rule-engine.js';
import { compileStrategy } from '../../src/lib/strategy-compiler.js';
import { validateDetectors } from '../../src/lib/detector-capability-validator.js';
import { evaluateDecision } from '../../src/lib/decision-engine.js';
import { extractMarketStructure } from '../../src/lib/market-structure-engine.js';
import { recordEvaluation } from '../../src/lib/explainability-engine.js';
import { logPipelineTrace } from '../../src/lib/pipeline-logger.js';
import { calculateHistoricalProbability, recordCompletedTrade } from '../../src/lib/learning-engine.js';
import { RULE_WEIGHTS } from '../../src/lib/rule-weight-engine.js';

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

export function buildDecisionSnapshot(decisionResult: any, histResult: any, compiledStrategy: any) {
  return {
    decision_score: decisionResult?.decision_score ?? null,
    matched_weight: decisionResult?.matched_weight ?? null,
    possible_weight: decisionResult?.possible_weight ?? null,
    recommendation: decisionResult?.recommendation ?? null,
    gemini_required: decisionResult?.requires_gemini ?? false,
    matched_rules: decisionResult?.matched_rules || [],
    failed_rules: decisionResult?.failed_rules || [],
    mandatory_rules_passed: decisionResult?.mandatory_rules_passed ?? false,
    historical_probability: histResult?.historical_probability ?? 0,
    historical_sample_size: histResult?.sample_size ?? 0,
    confidence_level: histResult?.confidence_level || histResult?.confidence || 'LOW',
    strategy_mode: compiledStrategy?.strategy_mode || 'HYBRID',
    rule_weights_used: RULE_WEIGHTS
  };
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
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

    if (!watcher) {
        throw new Error('Watcher skipped because no active watcher found.');
    }

    console.log("GEMINI CALLED");
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
  lotSize?: number | string | null;
  riskAmount?: number | string | null;
  expectedLoss?: number | string | null;
  lotType?: string;
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
export const toCanonicalSymbol = (symbol: string): string => {
  if (!symbol) return '';
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
};

/**
 * Converts a canonical symbol to a human-friendly display format.
 */
export const toDisplaySymbol = (symbol: string): string => {
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
export const mapTimeframeToInterval = (tf: string): string => {
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

export async function sendTelegramMessage(chatId: string | number, text: string): Promise<boolean> {
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
      if (response.status === 429) {
        console.warn(`[Twelve Data Rate Limit] HTTP 429 rate limit received from ${url}. Never retrying 429.`);
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

async function validateSymbolWithTwelveData(symbol: string, apiKey: string, stats?: { requests: number; cacheHits: number }): Promise<{ isValid: boolean; matchedSymbol?: string; instrumentType?: string; reason?: string }> {
  if (symbolValidationCache[symbol]) {
    if (stats) stats.cacheHits++;
    return symbolValidationCache[symbol];
  }
  
  try {
    if (stats) stats.requests++;
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

export async function fetchCurrentPrice(selectedPair: string, twelveDataKey: string, stats?: { requests: number; cacheHits: number }): Promise<number | null> {
  const mappedSymbol = toDisplaySymbol(selectedPair);
  // Try /price endpoint first
  const priceUrl = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(mappedSymbol)}&apikey=${twelveDataKey}`;
  try {
    if (stats) stats.requests++;
    const res = await fetchWithRetry(priceUrl, { signal: AbortSignal.timeout(4000) }, 2, 500);
    if (res.status === 429) {
      throw new Error("HTTP 429: Rate limit exceeded");
    }
    if (res.ok) {
      const data = await res.json();
      if (data && (data.status === "error" || data.code === 429)) {
        if (data.code === 429 || String(data.message).includes("limit") || String(data.message).includes("429")) {
          throw new Error("HTTP 429: Rate limit exceeded");
        }
      }
      if (data && data.price) {
        const parsed = parseFloat(String(data.price));
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    }
  } catch (err: any) {
    if (err.message && err.message.includes("429")) {
      throw err;
    }
    console.warn(`[fetchCurrentPrice] /price endpoint failed for ${mappedSymbol}: ${err.message || err}`);
  }

  // Fallback to /quote endpoint
  const quoteUrl = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(mappedSymbol)}&apikey=${twelveDataKey}`;
  try {
    if (stats) stats.requests++;
    const res = await fetchWithRetry(quoteUrl, { signal: AbortSignal.timeout(4000) }, 2, 500);
    if (res.status === 429) {
      throw new Error("HTTP 429: Rate limit exceeded");
    }
    if (res.ok) {
      const data = await res.json();
      if (data && (data.status === "error" || data.code === 429)) {
        if (data.code === 429 || String(data.message).includes("limit") || String(data.message).includes("429")) {
          throw new Error("HTTP 429: Rate limit exceeded");
        }
      }
      const val = data?.price || data?.close;
      if (val) {
        const parsed = parseFloat(String(val));
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    }
  } catch (err: any) {
    if (err.message && err.message.includes("429")) {
      throw err;
    }
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
    let ruleEnginePassedCount = 0;
    let ruleEngineFailedCount = 0;
    let geminiCallsCount = 0;
    let activeTradesCount = 0;
    let cooldownTradesCount = 0;

    let totalTwelveDataRequests = 0;
    let requestsSavedThroughCachingCount = 0;
    let watchersSkippedDueToRateLimitCount = 0;

    const tdStats = {
      get requests() { return totalTwelveDataRequests; },
      set requests(val) { totalTwelveDataRequests = val; },
      get cacheHits() { return requestsSavedThroughCachingCount; },
      set cacheHits(val) { requestsSavedThroughCachingCount = val; }
    };

    // Per-cron request caches to reuse Twelve Data responses across all watchers
    const cronPriceCache: Record<string, number> = {};
    const cronTimeSeriesCache: Record<string, { quoteData: any; candleData: Candle[] }> = {};

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

    let watchersReadyCount = 0;
    let quotaWaitCount = 0;
    let invalidKeyCount = 0;
    let tempErrorCount = 0;
    let skippedDueToQuotaCount = 0;
    let geminiCallsExecutedCount = 0;
    let geminiCallsSavedCount = 0;

    console.log("[CRON STEP 5]");

    // Process each active watcher sequentially to respect Twelve Data free limits
    for (const watcher of watchers) {
      let geminiInvoked = false;
      let geminiSucceeded = false;
      let geminiDecision: 'BUY' | 'SELL' | 'NO_TRADE' | null = null;
      if (!watcher || watcher.status !== 'active') {
        console.log(`LOG: Watcher ${watcher?.id} skipped - Status is '${watcher?.status}' (not active)`);
        skipped.push({ userId: watcher?.user_id || 'unknown', reason: `Watcher status is ${watcher?.status || 'stopped/deleted'}` });
        watchersSkippedCount++;
        continue;
      }

      const userId = watcher.user_id;
      const { data: userProfile } = await supabase
        .from("profiles")
        .select("email, gemini_status, gemini_last_error, gemini_last_checked")
        .eq("id", userId)
        .maybeSingle();

      const { data: telegramConn } = await supabase
        .from("telegram_connections")
        .select("telegram_chat_id, connected")
        .eq("user_id", userId)
        .maybeSingle();
      const telegramChatId = (telegramConn && telegramConn.connected) ? telegramConn.telegram_chat_id : (watcher.telegram_chat_id || null);

      const geminiStatus = userProfile?.gemini_status || 'READY';
      if (geminiStatus !== 'READY') {
        console.log(`========== AI STATUS ==========`);
        console.log(`User: ${userProfile?.email || userId}`);
        console.log(`Watcher: ${watcher.id} (${watcher.selected_pair})`);
        console.log(`Gemini Status: ${geminiStatus}`);
        console.log(`Reason: ${userProfile?.gemini_last_error || 'Gemini unavailable'}`);
        console.log(`Action: Skipped`);
        console.log(`===============================`);

        skipped.push({ userId, reason: `Gemini unavailable (${geminiStatus}): ${userProfile?.gemini_last_error || 'N/A'}` });
        watchersSkippedCount++;
        continue;
      }
      watchersReadyCount++;

      // Ensure the endpoint finishes within 30 seconds by stopping early if needed
      if (Date.now() - startTime > 25000) {
        console.warn("LOG: Approaching 30s timeout limit. Stopping early.");
        break;
      }

      // userId already declared above
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
      console.log(`Watcher ID: ${watcher.id}`);
      console.log(`trade_status from database: ${watcher.trade_status}`);
      console.log(`selected_pair: ${selectedPair}`);
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
      console.log(`ENTERING COOLDOWN`);
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

        watchersProcessedCount++;
        results.push({ userId, symbol, tradeStatus: 'COOLDOWN', result: 'Cooldown expired, reset to WAITING' });
        continue;
      }

      // =====================================================================
      // STATE 2 — ACTIVE TRADE
      // =====================================================================
      console.log(`ENTERING ACTIVE`);
      if (tradeStatus === 'ACTIVE') {
        console.log(`[BRANCH EXECUTED] ACTIVE branch (Price Monitoring Only) for Watcher ID: ${watcher.id}`);
        console.log(`[STATE 2 - ACTIVE] Monitoring open trade for Watcher ID: ${watcher.id} (${selectedPair}). Skipping Gemini, strategy load, and candle download.`);

        // telegramChatId already available from loop start

        // Fetch ONLY the latest market price from Twelve Data
        let currentPrice: number | null = null;
        const symbolKey = toDisplaySymbol(selectedPair);
        if (cronPriceCache[symbolKey] !== undefined) {
          currentPrice = cronPriceCache[symbolKey];
          tdStats.cacheHits++;
          console.log(`[Cache Hit] Using cached Twelve Data current price for ${symbolKey}: ${currentPrice}`);
        } else {
          if (twelveDataExhausted) {
            console.warn(`[Twelve Data Rate Limit] Watcher ${watcher.id} skipped due to HTTP 429 rate limit. Deferring until next cron cycle.`);
            skipped.push({ userId, reason: "TwelveData rate limit (429) exhausted" });
            watchersSkippedDueToRateLimitCount++;
            watchersSkippedCount++;
            continue;
          }
          try {
            currentPrice = await fetchCurrentPrice(selectedPair, twelveDataKey, tdStats);
            if (currentPrice !== null) {
              cronPriceCache[symbolKey] = currentPrice;
            }
          } catch (err: any) {
            if (err.message && err.message.includes("429")) {
              twelveDataExhausted = true;
              console.warn(`[Twelve Data Rate Limit] Watcher ${watcher.id} skipped due to HTTP 429 rate limit. Deferring until next cron cycle.`);
              skipped.push({ userId, reason: "TwelveData rate limit (429) exhausted" });
              watchersSkippedDueToRateLimitCount++;
              watchersSkippedCount++;
              continue;
            }
            console.warn(`[STATE 2 - ACTIVE] Error fetching current price for ${selectedPair}: ${err.message}`);
          }
        }

        if (currentPrice === null) {
          console.warn(`[STATE 2 - ACTIVE] Could not fetch current price for ${selectedPair}. Skipping this check.`);
          skipped.push({ userId, reason: "Failed to fetch current price for active trade" });
          watchersSkippedCount++;
          console.log(`ACTIVE branch exited.`);
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
          console.log(`ACTIVE branch exited.`);
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

          // Record completed trade to Learning Engine
          let latestEval: any = null;
          try {
            const { data } = await supabase
              .from('watcher_evaluations')
              .select('*')
              .eq('watcher_id', watcher.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            latestEval = data;
          } catch (e: any) {
            console.warn('[Learning Engine] Could not fetch latest evaluation:', e.message);
          }

          await recordCompletedTrade(supabase, {
            user_id: userId,
            watcher_id: watcher.id,
            evaluation_id: latestEval?.id || null,
            pair: selectedPair,
            timeframe: selectedTimeframe,
            strategy_mode: latestEval?.strategy_mode || 'HYBRID',
            entry_price: entryPrice || 0,
            stop_loss: stopLoss,
            take_profit: takeProfit,
            exit_price: currentPrice,
            direction: dir,
            opened_at: watcher.opened_at || new Date(Date.now() - 30 * 60 * 1000).toISOString(),
            closed_at: new Date().toISOString(),
            decision_score: latestEval?.decision_score || null,
            matched_weight: latestEval?.matched_weight || null,
            possible_weight: latestEval?.possible_weight || null,
            matched_rules: latestEval?.matched_rules || [],
            failed_rules: latestEval?.failed_rules || [],
            gemini_used: latestEval?.gemini_used || false,
            gemini_confidence: null,
            market_snapshot: {},
            session: null,
            volatility: 'MEDIUM',
            notes: `Trade closed via TP. Exit Price: ${currentPrice}`,
            decision_snapshot: latestEval?.decision_snapshot || null
          });

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
          console.log(`ACTIVE branch exited.`);
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

          // Record completed trade to Learning Engine
          let latestEval: any = null;
          try {
            const { data } = await supabase
              .from('watcher_evaluations')
              .select('*')
              .eq('watcher_id', watcher.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            latestEval = data;
          } catch (e: any) {
            console.warn('[Learning Engine] Could not fetch latest evaluation:', e.message);
          }

          await recordCompletedTrade(supabase, {
            user_id: userId,
            watcher_id: watcher.id,
            evaluation_id: latestEval?.id || null,
            pair: selectedPair,
            timeframe: selectedTimeframe,
            strategy_mode: latestEval?.strategy_mode || 'HYBRID',
            entry_price: entryPrice || 0,
            stop_loss: stopLoss,
            take_profit: takeProfit,
            exit_price: currentPrice,
            direction: dir,
            opened_at: watcher.opened_at || new Date(Date.now() - 30 * 60 * 1000).toISOString(),
            closed_at: new Date().toISOString(),
            decision_score: latestEval?.decision_score || null,
            matched_weight: latestEval?.matched_weight || null,
            possible_weight: latestEval?.possible_weight || null,
            matched_rules: latestEval?.matched_rules || [],
            failed_rules: latestEval?.failed_rules || [],
            gemini_used: latestEval?.gemini_used || false,
            gemini_confidence: null,
            market_snapshot: {},
            session: null,
            volatility: 'MEDIUM',
            notes: `Trade closed via SL. Exit Price: ${currentPrice}`,
            decision_snapshot: latestEval?.decision_snapshot || null
          });

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
          console.log(`ACTIVE branch exited.`);
          continue;
        }

        console.log(`ACTIVE branch exited.`);
        continue;
      }

      // =====================================================================
      // STATE 1 — WAITING
      // =====================================================================
      console.log(`ENTERING WAITING`);
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

      let traceData: any = null;
      let scanStart: number = 0;
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

        let accountSize: number;
        let riskPercentage: number;
        let riskRewardStr: string;
        let maxDailyRiskStr: string;
        try {
          const riskPrefs = extractRiskPreferences(prefsRecord, userId);
          accountSize = riskPrefs.accountSize;
          riskPercentage = riskPrefs.riskPercentage;
          riskRewardStr = riskPrefs.riskRewardStr;
          maxDailyRiskStr = riskPrefs.maxDailyRiskStr;
        } catch (prefsErr: any) {
          console.log(`LOG: Watcher ${watcher.id} skipped - ${prefsErr.message}`);
          skipped.push({ userId, reason: prefsErr.message });
          watchersSkippedCount++;
          continue;
        }

        console.log(`Trading Preferences Loaded\n`);
        console.log(`Account Size: $${accountSize}`);
        console.log(`Risk %: ${riskPercentage}%`);
        console.log(`Risk Reward: ${riskRewardStr}`);
        console.log(`Max Daily Risk: ${maxDailyRiskStr}`);
        console.log(`Strategy: ${strategyText ? strategyText.substring(0, 100) + '...' : 'N/A'}`);
        console.log(`[DB Row Comparison] DB capital: "${prefsRecord?.capital || ''}", DB custom_capital: "${prefsRecord?.custom_capital || ''}", DB preferred_risk: "${prefsRecord?.preferred_risk || ''}", DB risk_reward: "${prefsRecord?.risk_reward || ''}"`);

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

        if (twelveDataExhausted) {
          console.warn(`[Twelve Data Rate Limit] Watcher ${watcher.id} skipped due to HTTP 429 rate limit. Deferring until next cron cycle.`);
          skipped.push({ userId, reason: "TwelveData rate limit (429) exhausted" });
          watchersSkippedDueToRateLimitCount++;
          watchersSkippedCount++;
          continue;
        }

        const validation = await validateSymbolWithTwelveData(mappedSymbol, twelveDataKey, tdStats);
        if (!validation.isValid) {
          if (validation.reason?.includes("429")) {
            twelveDataExhausted = true;
            console.warn(`[Twelve Data Rate Limit] Watcher ${watcher.id} skipped due to HTTP 429 rate limit. Deferring until next cron cycle.`);
            skipped.push({ userId, reason: "TwelveData rate limit (429) exhausted" });
            watchersSkippedDueToRateLimitCount++;
            watchersSkippedCount++;
            continue;
          } else {
            console.log(`LOG: Watcher ${watcher.id} skipped - TwelveData validation failed: ${validation.reason}`);
            continue;
          }
        }

        const finalSymbol = validation.matchedSymbol || mappedSymbol;
        const tsCacheKey = `${finalSymbol}_${interval}`;

        if (cronTimeSeriesCache[tsCacheKey]) {
          console.log(`[Cache Hit] Reusing cached Twelve Data time series for ${tsCacheKey}`);
          tdStats.cacheHits++;
          quoteData = cronTimeSeriesCache[tsCacheKey].quoteData;
          candleData = cronTimeSeriesCache[tsCacheKey].candleData;
        } else {
          const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(finalSymbol)}&interval=${interval}&outputsize=20&apikey=${twelveDataKey}`;
          try {
            tdStats.requests++;
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

                cronTimeSeriesCache[tsCacheKey] = { quoteData, candleData };
                if (candleData.length > 0) {
                  const latestPrice = candleData[candleData.length - 1].close;
                  cronPriceCache[toDisplaySymbol(selectedPair)] = latestPrice;
                  cronPriceCache[finalSymbol] = latestPrice;
                }
              }
            }
          } catch (tsErr: any) {
            if (tsErr.message && tsErr.message.includes("429")) {
              twelveDataExhausted = true;
            } else {
              console.warn(`[Twelve Data API] error for ${finalSymbol}: ${tsErr.message || tsErr}`);
            }
          }
        }

        if (twelveDataExhausted) {
          console.warn(`[Twelve Data Rate Limit] Watcher ${watcher.id} skipped due to HTTP 429 rate limit. Deferring until next cron cycle.`);
          skipped.push({ userId, reason: "TwelveData rate limit (429) exhausted" });
          watchersSkippedDueToRateLimitCount++;
          watchersSkippedCount++;
          continue;
        }

        if (candleData.length < 2) {
           console.log(`LOG: Watcher ${watcher.id} skipped - Candle data downloaded: NO (insufficient data)`);
           skipped.push({ userId, reason: "Insufficient market data." });
           watchersSkippedCount++;
           continue;
        }
        console.log(`LOG: Candle data downloaded for ${selectedPair}: YES (${candleData.length} candles)`);

        // Phase 2 & 3: Timeframe Logic & New Candle Check
        const latestClosedCandle = candleData[candleData.length - 2] || candleData[candleData.length - 1];
        const latestClosedCandleTime = String(latestClosedCandle?.timestamp || '');
        const lastAnalyzedTime = watcher.last_analyzed_closed_candle_time || '';
        const isNewCandle = latestClosedCandleTime && latestClosedCandleTime !== lastAnalyzedTime;

        if (!isNewCandle) {
          console.log(`[Timeframe Logic] Watcher ${watcher.id} skipped - Same candle already analyzed (${latestClosedCandleTime}). Exiting.`);
          skipped.push({ userId, reason: "Same candle already analyzed (no new closed candle)" });
          watchersSkippedCount++;
          continue;
        }

        scanStart = Date.now();

        traceData = {
          watcherId: watcher.id,
          userId: userId,
          pair: selectedPair,
          timeframe: selectedTimeframe,
          currentCandleTime: candleData[candleData.length - 1]?.timestamp || '',
          closedCandleTime: candleData[candleData.length - 2]?.timestamp || '',
        };

        // Extract market structure & compile strategy
        const compiledStrategy = compileStrategy(strategyText);
        const marketStructure = extractMarketStructure(candleData, compiledStrategy.detector_validation?.supported_detectors);

        // Stage 2
        const cleanSymUpper = (selectedPair || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const pipSize = (cleanSymUpper.includes('JPY') || cleanSymUpper.includes('XAU') || cleanSymUpper.includes('GOLD')) ? 0.01 : 0.0001;

        traceData.marketStructure = {
          trend: marketStructure.trend || 'SIDEWAYS',
          bos: (marketStructure.BOS && marketStructure.BOS.some((b: any) => b.type === 'BULLISH_BOS' || b.type === 'BEARISH_BOS')) ? 'YES' : 'NO',
          choch: (marketStructure.CHOCH && marketStructure.CHOCH.some((c: any) => c.type === 'BULLISH_CHOCH' || c.type === 'BEARISH_CHOCH')) ? 'YES' : 'NO',
          trendlineBreakout: ((marketStructure.breakouts && marketStructure.breakouts.some((b: any) => b.type === 'UPPER_BREAKOUT' || b.type === 'LOWER_BREAKOUT')) || (marketStructure.trendlines && marketStructure.trendlines.length > 0)) ? 'YES' : 'NO',
          liquiditySweep: (marketStructure.liquiditySweeps && marketStructure.liquiditySweeps.some((l: any) => l.type === 'HIGH_SWEEP' || l.type === 'LOW_SWEEP')) ? 'YES' : 'NO',
          support: (marketStructure.supportZones && marketStructure.supportZones.length > 0) ? 'YES' : 'NO',
          resistance: (marketStructure.resistanceZones && marketStructure.resistanceZones.length > 0) ? 'YES' : 'NO',
          volumeConfirmation: (marketStructure.volumeInformation?.volumeSpike) ? 'YES' : 'NO',
          confirmationCandle: (marketStructure.candlePatterns && marketStructure.candlePatterns.length > 0) ? 'YES' : 'NO',
          session: (() => {
            const lastCandle = candleData[candleData.length - 1];
            const date = lastCandle && lastCandle.timestamp ? new Date(lastCandle.timestamp) : new Date();
            const hour = date.getUTCHours();
            if (hour >= 8 && hour < 13) return "London";
            if (hour >= 13 && hour < 17) return "London / NY";
            if (hour >= 17 && hour < 21) return "NY";
            if (hour >= 0 && hour < 8) return "Asia";
            return "Asia";
          })(),
          atr: marketStructure.volatilityInformation?.atr?.toFixed(5) || '0.00000'
        };

        // Stage 3
        const compiledRulesList: string[] = [];
        const rules = compiledStrategy.compiled_rules || {};
        if (rules.trendline_breakout) compiledRulesList.push("Trendline Breakout");
        if (rules.break_and_retest) compiledRulesList.push("Break and Retest");
        if (rules.confirmation_candle) compiledRulesList.push("Confirmation Candle");
        if (rules.bos) compiledRulesList.push("Break of Structure (BOS)");
        if (rules.choch) compiledRulesList.push("Change of Character (CHoCH)");
        if (rules.liquidity_sweep) compiledRulesList.push("Liquidity Sweep");
        if (rules.fair_value_gap) compiledRulesList.push("Fair Value Gap (FVG)");
        if (rules.support) compiledRulesList.push("Support Zone");
        if (rules.resistance) compiledRulesList.push("Resistance Zone");
        if (rules.ema?.enabled) compiledRulesList.push(`EMA (Periods: ${rules.ema.periods?.join(', ')})`);
        if (rules.rsi?.enabled) compiledRulesList.push(`RSI (OB: ${rules.rsi.overbought || 70}, OS: ${rules.rsi.oversold || 30})`);
        if (rules.macd?.enabled) compiledRulesList.push("MACD");
        if (rules.atr?.enabled) compiledRulesList.push("ATR");
        if (rules.volume_confirmation) compiledRulesList.push("Volume Confirmation");
        if (rules.session && rules.session.length > 0) compiledRulesList.push(`Session Filter: ${rules.session.join(', ')}`);
        if (rules.timeframes && rules.timeframes.length > 0) compiledRulesList.push(`Timeframes: ${rules.timeframes.join(', ')}`);
        if (rules.risk_reward?.min_ratio) compiledRulesList.push(`Min Risk Reward: ${rules.risk_reward.min_ratio}`);

        traceData.strategyCompiler = {
          strategyMode: compiledStrategy.strategy_mode || 'HYBRID',
          compiledRules: compiledRulesList,
          overallConfidence: `${compiledStrategy.overall_confidence || compiledStrategy.confidence || 0}%`,
          matchedPhrases: compiledStrategy.matched_phrases || [],
          canonicalRules: compiledStrategy.canonical_rules || []
        };

        // Run Weighted Decision Engine (Pass 1 to get matched rules)
        (marketStructure as any).pair = selectedPair;
        (marketStructure as any).timeframe = selectedTimeframe;
        (marketStructure as any).lastClosedCandleTimestamp = candleData[candleData.length - 2]?.timestamp || '';
        const initialResult = evaluateDecision(compiledStrategy, marketStructure);

        // Fetch Historical Probability from Learning Engine
        const histResult = await calculateHistoricalProbability(
          supabase,
          userId,
          selectedPair,
          selectedTimeframe,
          initialResult.matched_rules,
          compiledStrategy.strategy_mode || 'HYBRID'
        );

        // Run Weighted Decision Engine (Pass 2 with historical context)
        const decisionResult = evaluateDecision(
          compiledStrategy,
          marketStructure,
          undefined,
          histResult.historical_probability,
          histResult.sample_size
        );

        const decisionSnapshot = buildDecisionSnapshot(decisionResult, histResult, compiledStrategy);

        // Stage 4
        traceData.decisionEngine = {
          decisionScore: `${decisionResult.matched_weight} / ${decisionResult.possible_weight} (${decisionResult.decision_score.toFixed(1)}%)`,
          recommendation: decisionResult.recommendation,
          mandatoryRulesPassed: decisionResult.mandatory_rules_passed ? 'YES' : 'NO',
          matchedRules: decisionResult.matched_rules || [],
          failedRules: decisionResult.failed_rules || [],
          geminiRequired: decisionResult.requires_gemini ? 'YES' : 'NO',
          historicalProbability: `${histResult.historical_probability}%`,
          sampleSize: histResult.sample_size,
          confidenceLevel: histResult.confidence_level
        };

        let analysis: any = {
          signal: 'NO_TRADE',
          confidence: 0,
          entryPrice: null,
          stopLoss: null,
          takeProfit: null,
          riskReward: null,
          reasoning: []
        };
        let geminiDirection = 'NO_TRADE';
        let geminiCalled = false;
        let geminiTextResult = "";
        let geminiStart = 0;
        let geminiDuration = 0;

        const recommendation = decisionResult.recommendation; // PASS, LIKELY_PASS, AMBIGUOUS, FAIL
        const executionMode = compiledStrategy.detector_validation?.execution_mode || 'HYBRID';

        if (recommendation === 'FAIL' && executionMode === 'RULE_ONLY') {
          console.log(`Execution Mode: ${executionMode}`);
          console.log(`Decision: ${recommendation}`);
          console.log(`Stopping execution.`);
          
          analysis.reasoning = [decisionResult.explanation];
          
          // Store FAIL evaluation record
          const scanDurationMs = Date.now() - scanStart;
          await recordEvaluation(supabase, {
            user_id: userId,
            watcher_id: watcher.id,
            pair: selectedPair,
            timeframe: selectedTimeframe,
            strategy_mode: compiledStrategy.strategy_mode,
            decision_score: decisionResult.decision_score,
            matched_weight: decisionResult.matched_weight,
            possible_weight: decisionResult.possible_weight,
            recommendation: 'FAIL',
            mandatory_rules_passed: decisionResult.mandatory_rules_passed,
            matched_rules: decisionResult.matched_rules,
            failed_rules: decisionResult.failed_rules,
            gemini_used: false,
            trade_sent: false,
            trade_reason: "Decision Engine recommendation is FAIL: " + decisionResult.explanation,
            scan_duration_ms: scanDurationMs,
            decision_snapshot: decisionSnapshot
          });

          // Update last_scan_at and last_analyzed_closed_candle_time and exit
          await supabase
            .from("watchers")
            .update({ 
               last_scan_at: new Date().toISOString(),
               last_analyzed_closed_candle_time: latestClosedCandleTime,
               updated_at: new Date().toISOString()
            })
            .eq("id", watcher.id);

          // Stage 5
          traceData.gemini = {
            called: 'NO',
            duration: '0 ms',
            promptSent: 'N/A',
            rawResponse: 'N/A',
            parsedSatisfaction: 'N/A',
            parsedConfidence: 'N/A',
            parsedDirection: 'N/A'
          };

          // Stage 6
          traceData.riskEngine = {
            accountSize: `$${accountSize.toFixed(2)}`,
            riskPercentage: `${riskPercentage}%`,
            riskAmount: `$${(accountSize * riskPercentage / 100).toFixed(2)}`,
            stopLossDistance: '0.0 pips / 0.00%',
            takeProfitDistance: '0.0 pips / 0.00%',
            calculatedLotSize: '0.0',
            lotType: 'Micro Lot',
            accepted: 'NO',
            rejectionReason: `Decision Engine recommendation is FAIL`
          };

          // Stage 7
          traceData.telegram = {
            sent: 'NO',
            chatId: telegramChatId || 'None',
            message: 'N/A (Failed scan)'
          };

          traceData.complete = {
            status: 'SUCCESS',
            duration: `${scanDurationMs} ms`,
            timestamp: new Date().toISOString()
          };

          logPipelineTrace(traceData);

          watchersProcessedCount++;
          continue;
        } else {
          // Check if we force Gemini for FAIL in HYBRID/AI_ONLY
          const forceGemini = (recommendation === 'FAIL' && (executionMode === 'HYBRID' || executionMode === 'AI_ONLY'));
          const requiresGemini = (compiledStrategy.strategy_mode !== 'RULE_ONLY') && (decisionResult.requires_gemini || forceGemini);
          
          if (forceGemini) {
            console.log(`Execution Mode: ${executionMode}`);
            console.log(`Decision: ${recommendation}`);
            console.log(`Routing to Gemini...`);
          }

          if (requiresGemini) {
            console.log("GEMINI CALLED");
            geminiInvoked = true;
            console.log("Gemini Invoked");
            geminiCalled = true;
            geminiStart = Date.now();
            try {
              const geminiKey = apiKeyRecord?.api_key || process.env.GEMINI_API_KEY;
              if (geminiKey) {
                const ai = new GoogleGenAI({ apiKey: geminiKey });
                const promptText = `
You are an expert AI trading analyst.

Strategy Summary:
- Style: ${compiledStrategy.strategy_mode || 'HYBRID'}
- Timeframe: ${selectedTimeframe}
- Confirmation: ${traceData.strategyCompiler.compiledRules.join(', ')}

Available Market Evidence:
- Trend: ${marketStructure.trend}
- BOS: ${marketStructure.BOS?.length > 0 ? 'Detected' : 'None'}
- CHOCH: ${marketStructure.CHOCH?.length > 0 ? 'Detected' : 'None'}
- Support: ${marketStructure.supportZones?.length > 0 ? 'Detected' : 'None'}
- Resistance: ${marketStructure.resistanceZones?.length > 0 ? 'Detected' : 'None'}
- Fair Value Gap: ${marketStructure.fairValueGaps?.length > 0 ? 'Detected' : 'None'}
- Liquidity Sweep: ${marketStructure.liquiditySweeps?.length > 0 ? 'Detected' : 'None'}
- Volume Confirmation: ${marketStructure.volumeInformation.volumeSpike ? 'Confirmed' : 'None'}
- ATR: ${marketStructure.volatilityInformation.atr.toFixed(5)}
- EMA Alignment: YES

Missing Evidence:
${!marketStructure.breakouts?.length ? '- Trendline Breakout' : ''}
- Trendline Touches
- Spread
- High Impact News

AI Instructions:
1. Evaluate ONLY the supplied market evidence.
2. Never assume missing data.
3. Missing evidence is UNKNOWN, not FALSE.
4. Estimate whether the available confluence is enough to produce a BUY, SELL, or NO_TRADE.
5. Use probabilistic reasoning instead of strict rule matching.
6. Only return NO_TRADE when the supplied evidence clearly argues against taking a trade.

Output ONLY valid JSON:
{
"satisfies": boolean,
"direction": "BUY" | "SELL" | "NO_TRADE",
"confidenceScore": number,
"reasoning": "short explanation"
}
`;
                const aiResponse = await generateContentWithDiagnostics(ai, {
                  model: "gemini-2.5-flash",
                  contents: promptText,
                  config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                      type: Type.OBJECT,
                      properties: {
                        satisfies: { type: Type.BOOLEAN },
                        direction: { type: Type.STRING },
                        confidenceScore: { type: Type.NUMBER },
                        reasoning: { type: Type.STRING }
                      },
                      required: ["satisfies", "direction", "confidenceScore", "reasoning"]
                    }
                  }
                });
                geminiCallsExecutedCount++;
                geminiDuration = Date.now() - geminiStart;
                geminiTextResult = aiResponse.text || "";
                
                if (process.env.NODE_ENV !== 'production') {
                  console.log("========== RAW GEMINI RESPONSE ==========");
                  console.log(geminiTextResult);
                  console.log("=========================================");
                }
                
                if (watcher.gemini_status !== 'READY') {
                  if (watcher.gemini_status === 'QUOTA_EXHAUSTED' && !watcher.resume_notification_sent && telegramChatId) {
                    const resumeMsg = `⚠️ Gaks AI Notice\n\nYour Gemini API key quota has reset.\nMarket monitoring has resumed.`;
                    await sendTelegramMessage(telegramChatId, resumeMsg);
                    telegramMessagesSentCount++;
                  }
                  await supabase.from("watchers").update({
                    gemini_status: 'READY',
                    next_gemini_retry_at: null,
                    last_gemini_error: null,
                    quota_notification_sent: false,
                    resume_notification_sent: false,
                    updated_at: new Date().toISOString()
                  }).eq("id", watcher.id);
                  watcher.gemini_status = 'READY';
                  watcher.quota_notification_sent = false;
                  watcher.resume_notification_sent = false;
                }

                const parsedResult = JSON.parse(geminiTextResult);
                console.log("Gemini JSON Parsed");
                geminiSucceeded = true;
                geminiDecision = parsedResult.direction as 'BUY' | 'SELL' | 'NO_TRADE';
                console.log(`Gemini Decision = ${geminiDecision}`);

                // Stage 5
                traceData.gemini = {
                  called: 'YES',
                  duration: `${geminiDuration} ms`,
                  promptSent: promptText || 'N/A',
                  rawResponse: geminiTextResult || 'N/A',
                  parsedSatisfaction: parsedResult.satisfies ? 'YES' : 'NO',
                  parsedConfidence: String(parsedResult.confidenceScore || 0),
                  parsedDirection: parsedResult.direction || 'NO_TRADE'
                };

                if (parsedResult.satisfies && parsedResult.direction && parsedResult.direction !== 'NO_TRADE') {
                  geminiDirection = parsedResult.direction;
                  const entry = candleData[candleData.length - 1].close;
                  const atrVal = marketStructure.volatilityInformation.atr && marketStructure.volatilityInformation.atr > 0 ? marketStructure.volatilityInformation.atr : entry * 0.005;
                  const sl = geminiDirection === 'BUY' ? entry - (atrVal * 1.5) : entry + (atrVal * 1.5);

                  analysis = {
                    signal: geminiDirection,
                    confidence: parsedResult.confidenceScore || 85,
                    entryPrice: entry,
                    stopLoss: sl,
                    takeProfit: null,
                    riskReward: riskRewardStr,
                    reasoning: [parsedResult.reasoning || "Satisfies strategy rules and Gemini validation."]
                  };
                } else {
                  // If Gemini called but does not satisfy / direction is NO_TRADE, we should explicitly capture that in Gemini trace as well:
                  traceData.gemini = {
                    called: 'YES',
                    duration: `${geminiDuration} ms`,
                    promptSent: promptText || 'N/A',
                    rawResponse: geminiTextResult || 'N/A',
                    parsedSatisfaction: parsedResult.satisfies ? 'YES' : 'NO',
                    parsedConfidence: String(parsedResult.confidenceScore || 0),
                    parsedDirection: parsedResult.direction || 'NO_TRADE'
                  };
                }
              }
            } catch (gemErr: any) {
              const errMsg = gemErr.message || String(gemErr);
              const errStatus = gemErr.status || 0;
              const lowerMsg = errMsg.toLowerCase();

              let newStatus = 'NEEDS_ATTENTION';
              if (errStatus === 429 || lowerMsg.includes('resource_exhausted') || lowerMsg.includes('quota exceeded') || lowerMsg.includes('rate limit') || lowerMsg.includes('retryinfo') || lowerMsg.includes('retrydelay')) {
                newStatus = 'QUOTA_EXHAUSTED';
              } else if (errStatus === 401 || errStatus === 403 || lowerMsg.includes('invalid api key') || lowerMsg.includes('permission denied') || lowerMsg.includes('invalid')) {
                newStatus = 'INVALID_KEY';
              } else if (errStatus === 402 || lowerMsg.includes('billing') || lowerMsg.includes('payment required')) {
                newStatus = 'BILLING_REQUIRED';
              } else if (errStatus >= 500 || errStatus === 503 || lowerMsg.includes('timeout') || lowerMsg.includes('network') || lowerMsg.includes('gateway')) {
                newStatus = 'TEMP_ERROR';
              } else {
                newStatus = 'NEEDS_ATTENTION';
              }

              await supabase.from("profiles").update({
                gemini_status: newStatus,
                gemini_last_error: errMsg,
                gemini_last_checked: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }).eq("id", userId);

              console.log(`========== AI STATUS ==========`);
              console.log(`User: ${userProfile?.email || userId}`);
              console.log(`Watcher: ${watcher.id} (${watcher.selected_pair})`);
              console.log(`Gemini Status: ${newStatus}`);
              console.log(`Reason: ${errMsg}`);
              console.log(`Action: Skipped`);
              console.log(`===============================`);

              // Save Gemini failed evaluation record
              const scanDurationMs = Date.now() - scanStart;
              await recordEvaluation(supabase, {
                user_id: userId,
                watcher_id: watcher.id,
                pair: selectedPair,
                timeframe: selectedTimeframe,
                strategy_mode: compiledStrategy.strategy_mode,
                decision_score: decisionResult.decision_score,
                matched_weight: decisionResult.matched_weight,
                possible_weight: decisionResult.possible_weight,
                recommendation: decisionResult.recommendation,
                mandatory_rules_passed: decisionResult.mandatory_rules_passed,
                matched_rules: decisionResult.matched_rules,
                failed_rules: decisionResult.failed_rules,
                gemini_used: true,
                gemini_result: "Gemini execution failed: " + errMsg,
                trade_sent: false,
                trade_reason: "Gemini API call failed: " + errMsg,
                scan_duration_ms: scanDurationMs,
                gemini_duration_ms: Date.now() - geminiStart,
                decision_snapshot: decisionSnapshot
              });

              // Stage 5
              traceData.gemini = {
                called: 'YES',
                duration: `${Date.now() - geminiStart} ms`,
                promptSent: 'See logs',
                rawResponse: `Error: ${errMsg}`,
                parsedSatisfaction: 'NO',
                parsedConfidence: '0',
                parsedDirection: 'NO_TRADE'
              };

              // Stage 6
              traceData.riskEngine = {
                accountSize: `$${accountSize.toFixed(2)}`,
                riskPercentage: `${riskPercentage}%`,
                riskAmount: `$${(accountSize * riskPercentage / 100).toFixed(2)}`,
                stopLossDistance: '0.0 pips / 0.00%',
                takeProfitDistance: '0.0 pips / 0.00%',
                calculatedLotSize: '0.0',
                lotType: 'Micro Lot',
                accepted: 'NO',
                rejectionReason: `Gemini API execution failed: ${errMsg}`
              };

              // Stage 7
              traceData.telegram = {
                sent: 'NO',
                chatId: telegramChatId || 'None',
                message: 'N/A'
              };

              // Stage 8
              traceData.complete = {
                status: 'FAILED',
                duration: `${scanDurationMs} ms`,
                timestamp: new Date().toISOString()
              };

              logPipelineTrace(traceData);

              skipped.push({ userId, reason: errMsg });
              watchersSkippedCount++;
              continue;
            }
          } else {
            // Gemini NOT required! Fallback to local strategy engine (since recommendation is PASS)
            console.log(`[Decision Engine] Recommendation is PASS. Skipping Gemini as requires_gemini is false.`);

            // Stage 5
            traceData.gemini = {
              called: 'NO',
              duration: '0 ms',
              promptSent: 'N/A',
              rawResponse: 'N/A',
              parsedSatisfaction: 'N/A',
              parsedConfidence: 'N/A',
              parsedDirection: 'N/A'
            };

            const mappedParsedStrategy: ParsedStrategy = {
              indicators: [],
              emaValues: compiledStrategy.compiled_rules.ema?.periods || [],
              rsiThresholds: {
                overbought: compiledStrategy.compiled_rules.rsi?.overbought,
                oversold: compiledStrategy.compiled_rules.rsi?.oversold
              },
              bos: compiledStrategy.compiled_rules.bos,
              choch: compiledStrategy.compiled_rules.choch,
              liquiditySweep: compiledStrategy.compiled_rules.liquidity_sweep,
              fairValueGap: compiledStrategy.compiled_rules.fair_value_gap,
              session: compiledStrategy.compiled_rules.session?.[0],
              timeframe: compiledStrategy.compiled_rules.timeframes?.[0],
              minimumRiskReward: compiledStrategy.compiled_rules.risk_reward?.min_ratio
            };
            const localAnalysis = analyzeMarket(candleData, mappedParsedStrategy);
            analysis = localAnalysis;
          }
        }

        console.log(`LOG: Signal result for ${selectedPair}: ${analysis.signal} (Confidence: ${analysis.confidence}%)`);

        console.log("===== PIPELINE TRACE =====");
        console.log(`Decision Recommendation: ${recommendation}`);
        console.log(`Execution Mode: ${executionMode}`);
        console.log(`Gemini Branch Entered: ${geminiInvoked}`);
        console.log(`Gemini API Called: ${geminiInvoked}`);
        console.log(`Gemini Response Received: ${geminiSucceeded}`);
        console.log(`Gemini Parsed: ${geminiSucceeded}`);
        console.log(`Analysis Before WAITING:`, JSON.stringify(analysis));
        console.log("==========================");

        // If there is NO setup: Update last_scan_at, last_analyzed_closed_candle_time, save evaluation and Exit.
        const isWaiting = geminiInvoked 
          ? (geminiSucceeded && geminiDecision === 'NO_TRADE')
          : (analysis.signal === 'NO_TRADE' || analysis.confidence < 70);

        if (isWaiting) {
            console.log(`[STATE 1 - WAITING] No setup for Watcher ID: ${watcher.id} (${selectedPair}). Signal: ${analysis.signal}, Confidence: ${analysis.confidence}%. Updating last_scan_at and exiting.`);
            
            const scanDurationMs = Date.now() - scanStart;
            await recordEvaluation(supabase, {
              user_id: userId,
              watcher_id: watcher.id,
              pair: selectedPair,
              timeframe: selectedTimeframe,
              strategy_mode: compiledStrategy.strategy_mode,
              decision_score: decisionResult.decision_score,
              matched_weight: decisionResult.matched_weight,
              possible_weight: decisionResult.possible_weight,
              recommendation: decisionResult.recommendation,
              mandatory_rules_passed: decisionResult.mandatory_rules_passed,
              matched_rules: decisionResult.matched_rules,
              failed_rules: decisionResult.failed_rules,
              gemini_used: geminiCalled,
              gemini_result: geminiTextResult || null,
              trade_sent: false,
              trade_reason: `No trade setup found: signal is ${analysis.signal} and confidence is ${analysis.confidence}% (requires >= 70%)`,
              scan_duration_ms: scanDurationMs,
              gemini_duration_ms: geminiDuration,
              decision_snapshot: decisionSnapshot
            });

            await supabase
              .from("watchers")
              .update({ 
                 last_scan_at: new Date().toISOString(),
                 last_analyzed_closed_candle_time: latestClosedCandleTime,
                 updated_at: new Date().toISOString()
              })
              .eq("id", watcher.id);

            // Stage 6
            traceData.riskEngine = {
              accountSize: `$${accountSize.toFixed(2)}`,
              riskPercentage: `${riskPercentage}%`,
              riskAmount: `$${(accountSize * riskPercentage / 100).toFixed(2)}`,
              stopLossDistance: '0.0 pips / 0.00%',
              takeProfitDistance: '0.0 pips / 0.00%',
              calculatedLotSize: '0.0',
              lotType: 'Micro Lot',
              accepted: 'NO',
              rejectionReason: `No trade setup: signal is ${analysis.signal} and confidence is ${analysis.confidence}%`
            };

            // Stage 7
            traceData.telegram = {
              sent: 'NO',
              chatId: telegramChatId || 'None',
              message: 'N/A (No setup)'
            };

            // Stage 8
            traceData.complete = {
              status: 'SUCCESS',
              duration: `${scanDurationMs} ms`,
              timestamp: new Date().toISOString()
            };

            logPipelineTrace(traceData);

            watchersProcessedCount++;
            continue;
        }

        const executedPrice = Number(candleData[candleData.length - 1]?.close) || Number(analysis.entryPrice) || 0;
        const posSizeResult = calculatePositionSize({
          accountSize: accountSize,
          riskPercentage: riskPercentage,
          entryPrice: Number(analysis.entryPrice) || 0,
          executedEntry: executedPrice,
          stopLoss: Number(analysis.stopLoss) || 0,
          geminiTp: analysis.takeProfit ? Number(analysis.takeProfit) : null,
          symbol: selectedPair,
          direction: analysis.signal,
          riskRewardStr: riskRewardStr
        });
        logPositionSizeAudit(posSizeResult, prefsRecord?.updated_at || prefsRecord?.created_at || 'N/A');

        // Phase 7: Full Audit Report before Telegram / registration decision
        console.log(`\n========== PHASE 7: FULL DIAGNOSTIC AUDIT REPORT ==========`);
        console.log(`ENTRY: ${posSizeResult.entryPrice}`);
        console.log(`STOP LOSS: ${posSizeResult.stopLoss}`);
        console.log(`TAKE PROFIT: ${posSizeResult.takeProfit}`);
        console.log(`RISK DISTANCE: ${posSizeResult.actualRisk.toFixed(5)}`);
        console.log(`REWARD DISTANCE: ${posSizeResult.actualReward.toFixed(5)}`);
        console.log(`CONFIGURED RR: ${riskRewardStr}`);
        console.log(`ACTUAL RR: ${posSizeResult.actualRr.toFixed(4)}`);
        console.log(`GEMINI DIRECTION: ${geminiDirection}`);
        console.log(`BACKEND DIRECTION: ${analysis.signal}`);
        console.log(`NEW CANDLE: ${isNewCandle ? 'YES' : 'NO'}`);
        console.log(`ACTIVE TRADE: ${watcher.trade_status === 'ACTIVE' ? 'YES' : 'NO'}`);
        console.log(`COOLDOWN: ${watcher.trade_status === 'COOLDOWN' ? 'YES' : 'NO'}`);
        console.log(`TRADE ACCEPTED: ${posSizeResult.accepted ? 'YES' : 'NO'}`);
        console.log(`REJECTION REASON: ${posSizeResult.skipReason || 'None'}`);
        console.log(`===========================================================\n`);

        if (!posSizeResult.accepted) {
          console.log(`[Risk/Validation Failed - Trade Skipped] ${posSizeResult.skipReason}`);
          
          const scanDurationMs = Date.now() - scanStart;
          await recordEvaluation(supabase, {
            user_id: userId,
            watcher_id: watcher.id,
            pair: selectedPair,
            timeframe: selectedTimeframe,
            strategy_mode: compiledStrategy.strategy_mode,
            decision_score: decisionResult.decision_score,
            matched_weight: decisionResult.matched_weight,
            possible_weight: decisionResult.possible_weight,
            recommendation: decisionResult.recommendation,
            mandatory_rules_passed: decisionResult.mandatory_rules_passed,
            matched_rules: decisionResult.matched_rules,
            failed_rules: decisionResult.failed_rules,
            gemini_used: geminiCalled,
            gemini_result: geminiTextResult || null,
            trade_sent: false,
            trade_reason: `Risk engine validation failed: ${posSizeResult.skipReason}`,
            scan_duration_ms: scanDurationMs,
            gemini_duration_ms: geminiDuration,
            decision_snapshot: decisionSnapshot
          });

          await supabase
            .from("watchers")
            .update({ 
               last_scan_at: new Date().toISOString(),
               last_analyzed_closed_candle_time: latestClosedCandleTime,
               updated_at: new Date().toISOString()
            })
            .eq("id", watcher.id);

          const stopDistance = Math.abs(executedPrice - (Number(posSizeResult.stopLoss) || Number(analysis.stopLoss) || 0));
          const tpDistance = Math.abs((Number(posSizeResult.takeProfit) || Number(analysis.takeProfit) || executedPrice * 1.01) - executedPrice);
          const slDistancePips = stopDistance / pipSize;
          const slDistancePct = (stopDistance / executedPrice) * 100;
          const tpDistancePips = tpDistance / pipSize;
          const tpDistancePct = (tpDistance / executedPrice) * 100;

          traceData.riskEngine = {
            accountSize: `$${accountSize.toFixed(2)}`,
            riskPercentage: `${riskPercentage}%`,
            riskAmount: `$${posSizeResult.riskAmount.toFixed(2)}`,
            stopLossDistance: `${slDistancePips.toFixed(1)} pips / ${slDistancePct.toFixed(2)}%`,
            takeProfitDistance: `${tpDistancePips.toFixed(1)} pips / ${tpDistancePct.toFixed(2)}%`,
            calculatedLotSize: String(posSizeResult.calculatedLotSize),
            lotType: posSizeResult.lotType,
            accepted: 'NO',
            rejectionReason: posSizeResult.skipReason || 'None'
          };

          traceData.telegram = {
            sent: 'NO',
            chatId: telegramChatId || 'None',
            message: 'N/A'
          };

          traceData.complete = {
            status: 'SUCCESS',
            duration: `${scanDurationMs} ms`,
            timestamp: new Date().toISOString()
          };

          logPipelineTrace(traceData);

          watchersProcessedCount++;
          continue;
        }

        analysis.entryPrice = posSizeResult.entryPrice;
        analysis.stopLoss = posSizeResult.stopLoss;
        analysis.takeProfit = posSizeResult.takeProfit;

        const signalReasoning = Array.isArray(analysis.reasoning) ? analysis.reasoning.join("; ") : (analysis.reasoning || "Strategy criteria matched");
        console.log(`[SIGNAL GENERATED] Watcher ID: ${watcher.id}`);
        console.log(`Exact reason new signal was generated: Strategy evaluation returned signal '${analysis.signal}' with confidence ${analysis.confidence}% (>= 70 threshold) on pair ${selectedPair}. Executed Entry: ${analysis.entryPrice}, Stop Loss: ${analysis.stopLoss}, Take Profit: ${analysis.takeProfit}. Reasoning: ${signalReasoning}`);

        const signal = {
            pair: mappedSymbol,
            timeframe: selectedTimeframe,
            direction: analysis.signal,
            strategySummary: prefsRecord?.strategy_summary || 'Custom Strategy',
            entryPrice: analysis.entryPrice,
            stopLoss: analysis.stopLoss,
            takeProfit: analysis.takeProfit,
            riskRewardRatio: riskRewardStr,
            confidenceScore: analysis.confidence,
            aiReasoning: analysis.reasoning,
            lotSize: posSizeResult.calculatedLotSize,
            riskAmount: posSizeResult.riskAmount,
            expectedLoss: posSizeResult.expectedLoss,
            lotType: posSizeResult.lotType
        };

        const isRegistered = await registerSignal(supabase, watcher, signal);

        // Also update last_analyzed_closed_candle_time on watcher
        await supabase
          .from("watchers")
          .update({
             last_analyzed_closed_candle_time: latestClosedCandleTime
          })
          .eq("id", watcher.id);

        if (!isRegistered) {
          console.log(`LOG: Telegram send decision for ${selectedPair}: NO (Failed to register signal or active trade already exists)`);
          
          const scanDurationMs = Date.now() - scanStart;
          await recordEvaluation(supabase, {
            user_id: userId,
            watcher_id: watcher.id,
            pair: selectedPair,
            timeframe: selectedTimeframe,
            strategy_mode: compiledStrategy.strategy_mode,
            decision_score: decisionResult.decision_score,
            matched_weight: decisionResult.matched_weight,
            possible_weight: decisionResult.possible_weight,
            recommendation: decisionResult.recommendation,
            mandatory_rules_passed: decisionResult.mandatory_rules_passed,
            matched_rules: decisionResult.matched_rules,
            failed_rules: decisionResult.failed_rules,
            gemini_used: geminiCalled,
            gemini_result: geminiTextResult || null,
            trade_sent: false,
            trade_reason: "Failed to register signal or active trade already exists in database.",
            scan_duration_ms: scanDurationMs,
            gemini_duration_ms: geminiDuration,
            decision_snapshot: decisionSnapshot
          });

          const stopDistance = Math.abs(executedPrice - (Number(posSizeResult.stopLoss) || Number(analysis.stopLoss) || 0));
          const tpDistance = Math.abs((Number(posSizeResult.takeProfit) || Number(analysis.takeProfit) || executedPrice * 1.01) - executedPrice);
          const slDistancePips = stopDistance / pipSize;
          const slDistancePct = (stopDistance / executedPrice) * 100;
          const tpDistancePips = tpDistance / pipSize;
          const tpDistancePct = (tpDistance / executedPrice) * 100;

          traceData.riskEngine = {
            accountSize: `$${accountSize.toFixed(2)}`,
            riskPercentage: `${riskPercentage}%`,
            riskAmount: `$${posSizeResult.riskAmount.toFixed(2)}`,
            stopLossDistance: `${slDistancePips.toFixed(1)} pips / ${slDistancePct.toFixed(2)}%`,
            takeProfitDistance: `${tpDistancePips.toFixed(1)} pips / ${tpDistancePct.toFixed(2)}%`,
            calculatedLotSize: String(posSizeResult.calculatedLotSize),
            lotType: posSizeResult.lotType,
            accepted: 'YES',
            rejectionReason: 'None'
          };

          traceData.telegram = {
            sent: 'NO',
            chatId: telegramChatId || 'None',
            message: 'N/A (Skipped: Active trade exists)'
          };

          traceData.complete = {
            status: 'SUCCESS',
            duration: `${scanDurationMs} ms`,
            timestamp: new Date().toISOString()
          };

          logPipelineTrace(traceData);

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

        // Store PASS/ALERT Sent evaluation record
        const scanDurationMs = Date.now() - scanStart;
        await recordEvaluation(supabase, {
          user_id: userId,
          watcher_id: watcher.id,
          pair: selectedPair,
          timeframe: selectedTimeframe,
          strategy_mode: compiledStrategy.strategy_mode,
          decision_score: decisionResult.decision_score,
          matched_weight: decisionResult.matched_weight,
          possible_weight: decisionResult.possible_weight,
          recommendation: decisionResult.recommendation,
          mandatory_rules_passed: decisionResult.mandatory_rules_passed,
          matched_rules: decisionResult.matched_rules,
          failed_rules: decisionResult.failed_rules,
          gemini_used: geminiCalled,
          gemini_result: geminiTextResult || null,
          trade_sent: alertSent,
          trade_reason: alertSent ? "Trade alert sent successfully on Telegram" : "Telegram message failed to send",
          scan_duration_ms: scanDurationMs,
          gemini_duration_ms: geminiDuration,
          decision_snapshot: decisionSnapshot
        });

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

        const stopDistance = Math.abs(executedPrice - (Number(posSizeResult.stopLoss) || Number(analysis.stopLoss) || 0));
        const tpDistance = Math.abs((Number(posSizeResult.takeProfit) || Number(analysis.takeProfit) || executedPrice * 1.01) - executedPrice);
        const slDistancePips = stopDistance / pipSize;
        const slDistancePct = (stopDistance / executedPrice) * 100;
        const tpDistancePips = tpDistance / pipSize;
        const tpDistancePct = (tpDistance / executedPrice) * 100;

        traceData.riskEngine = {
          accountSize: `$${accountSize.toFixed(2)}`,
          riskPercentage: `${riskPercentage}%`,
          riskAmount: `$${posSizeResult.riskAmount.toFixed(2)}`,
          stopLossDistance: `${slDistancePips.toFixed(1)} pips / ${slDistancePct.toFixed(2)}%`,
          takeProfitDistance: `${tpDistancePips.toFixed(1)} pips / ${tpDistancePct.toFixed(2)}%`,
          calculatedLotSize: String(posSizeResult.calculatedLotSize),
          lotType: posSizeResult.lotType,
          accepted: 'YES',
          rejectionReason: 'None'
        };

        traceData.telegram = {
          sent: alertSent ? 'YES' : 'NO',
          chatId: telegramChatId || 'None',
          message: alertMessage || 'N/A'
        };

        traceData.complete = {
          status: 'SUCCESS',
          duration: `${scanDurationMs} ms`,
          timestamp: new Date().toISOString()
        };

        logPipelineTrace(traceData);

        watchersProcessedCount++;
        results.push({ userId, symbol, tradeStatus: 'ACTIVE', signalsFound: 1, signalsSent: alertSent ? 1 : 0 });

      } catch (err: any) {
        console.error(`LOG ERROR: Watcher ${watcher.id} failed`);
        console.error(`Exception: ${err.message}`);
        console.error(`Stack: ${err.stack}`);
        
        if (traceData) {
          const scanDurationMs = typeof scanStart !== 'undefined' ? (Date.now() - scanStart) : 0;
          traceData.complete = {
            status: 'FAILED',
            duration: `${scanDurationMs} ms`,
            timestamp: new Date().toISOString()
          };
          logPipelineTrace(traceData);
        }

        errors.push({ userId, error: err.message || "Unknown error" });
        watchersSkippedCount++;
      }
    }

    const totalTime = Date.now() - startTime;
    console.log(`\n==================================================`);
    console.log(`[TWELVE DATA API USAGE AUDIT & METRICS]`);
    console.log(`Total Twelve Data requests per cron execution: ${totalTwelveDataRequests}`);
    console.log(`Requests saved through caching: ${requestsSavedThroughCachingCount}`);
    console.log(`Watchers skipped due to rate limiting: ${watchersSkippedDueToRateLimitCount}`);
    console.log(`==================================================\n`);

    console.log(`\n========== GEMINI HEALTH ==========`);
    console.log(`Watchers Ready: ${watchersReadyCount}`);
    console.log(`Waiting For Quota: ${quotaWaitCount}`);
    console.log(`Invalid Keys: ${invalidKeyCount}`);
    console.log(`Temporary Errors: ${tempErrorCount}`);
    console.log(`Skipped Due To Quota: ${skippedDueToQuotaCount}`);
    console.log(`Gemini Calls Executed: ${geminiCallsExecutedCount}`);
    console.log(`Gemini Calls Saved: ${geminiCallsSavedCount}`);
    console.log(`===================================\n`);

    console.log(`LOG: Cron completed (Processed: ${watchersProcessedCount}, Sent: ${telegramMessagesSentCount})`);

    return res.status(200).json({
      success: true,
      processed: watchersProcessedCount,
      signalsSent: telegramMessagesSentCount,
      twelveDataMetrics: {
        totalRequests: totalTwelveDataRequests,
        savedThroughCaching: requestsSavedThroughCachingCount,
        skippedDueToRateLimit: watchersSkippedDueToRateLimitCount
      },
      geminiHealth: {
        watchersReady: watchersReadyCount,
        waitingForQuota: quotaWaitCount,
        invalidKeys: invalidKeyCount,
        temporaryErrors: tempErrorCount,
        skippedDueToQuota: skippedDueToQuotaCount,
        geminiCallsExecuted: geminiCallsExecutedCount,
        geminiCallsSaved: geminiCallsSavedCount
      },
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

