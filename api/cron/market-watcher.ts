import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from '@google/genai';
import { analyzeMarket, Candle } from '../../src/lib/strategy-engine.js';
import { ParsedStrategy } from '../../src/lib/strategy-parser.js';
import { buildTelegramAlertMessage } from '../../src/lib/telegram-formatter.js';
import { dispatchTradeAlert } from '../../src/lib/telegramWrapper.js';
import { extractRiskPreferences, calculatePositionSize, parseRiskRewardRatio } from '../../src/lib/risk-engine.js';
import { evaluateRules } from '../../src/lib/rule-engine.js';
import { compileStrategy } from '../../src/lib/strategy-compiler.js';
import { validateDetectors } from '../../src/lib/detector-capability-validator.js';
import { evaluateDecision } from '../../src/lib/decision-engine.js';
import { extractMarketStructure } from '../../src/lib/market-structure-engine.js';
import { calculateStructuralStopLoss, validateAndResolveStopLoss } from '../../src/lib/structural-stop-loss.js';
import { recordEvaluation } from '../../src/lib/explainability-engine.js';
import { calculateHistoricalProbability, recordCompletedTrade } from '../../src/lib/learning-engine.js';
import { RULE_WEIGHTS } from '../../src/lib/rule-weight-engine.js';
import { validateMarketDataIntegrity } from '../../src/lib/market-integrity.js';
import { normalizeConfidence } from '../../src/lib/confidence-engine.js';
import { evaluateQualityGate } from '../../src/lib/quality-gate.js';
import { checkSignalDeduplication } from '../../src/lib/signal-deduplication.js';
import { resolveUserGeminiKey, classifyAndRedactGeminiError } from '../../src/lib/gemini-key-resolver.js';
import { validateActiveTradeState, isWatcherDue } from '../../src/lib/trade-validator.js';
import { computeEquityAnalytics, deriveEquityState, fetchUserCompletedTrades } from '../../src/lib/equity-learning-engine.js';
import { evaluateRiskGovernor } from '../../src/lib/risk-governor.js';
import { evaluateAdaptiveLearning, fetchCompletedTradesForAdaptiveLearning } from '../../src/lib/adaptive-learning-engine.js';
import { calculateAdaptiveQualityRequirement } from '../../src/lib/quality-gate.js';
import { evaluateAdaptiveExecution } from '../../src/lib/adaptive-execution-engine.js';
import { evaluateClosedLoopCalibration } from '../../src/lib/closed-loop-calibration-engine.js';
import { resolveAuthoritativeDecision, DecisionGateResult } from '../../src/lib/decision-attribution.js';

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

    if (status === 404 || message.includes('not_found') || message.includes('no longer available') || message.includes('not found')) {
        return 'temporary_failure';
    }
    if (status === 401 || status === 403 || message.includes('invalid_api_key') || message.includes('api_key_invalid') || message.includes('permission denied')) {
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
    model: string = 'gemini-3.6-flash',
    config?: any
) {
    const { data: apiKeyData, error: apiKeyError } = await supabase
        .from('user_api_keys')
        .select('api_key')
        .eq('user_id', userId)
        .eq('provider', 'gemini')
        .maybeSingle();

    if (apiKeyError || !apiKeyData || !apiKeyData.api_key) {
        throw new Error('Gemini API key not found for user.');
    }

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

    const ai = new GoogleGenAI({ apiKey: apiKeyData.api_key });

    try {
        const geminiResponse = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: config
        });

        if (typeof geminiResponse.text === 'function') {
            return await (geminiResponse.text as any)();
        } else if (typeof geminiResponse.text === 'string') {
            return geminiResponse.text;
        } else {
            return (geminiResponse as any).candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        }
    } catch (error: any) {
        throw error;
    }
}


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

  const signalHash = `${watcher.id}_${signal.pair}_${signal.direction}_${signal.entryPrice}`;

  try {
    // 1. Duplicate Check via Supabase (15-min window per watcher)
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    
    // Check signal_fingerprints table in Supabase
    try {
      const { data: existingFingerprints } = await supabase
        .from('signal_fingerprints')
        .select('id')
        .eq('watcher_id', watcher.id)
        .eq('fingerprint', signalHash)
        .gte('created_at', fifteenMinutesAgo)
        .limit(1);

      if (existingFingerprints && existingFingerprints.length > 0) {
        console.log(`[registerSignal] Duplicate signal fingerprint detected in Supabase for watcher ${watcher.id}. Skipping.`);
        return false;
      }
    } catch (fpQueryErr) {
      console.warn(`[registerSignal] Error querying signal_fingerprints from Supabase:`, fpQueryErr);
    }

    // Secondary fallback check against scan_evaluations
    try {
      const { data: recentEvaluations } = await supabase
        .from('scan_evaluations')
        .select('id')
        .eq('watcher_id', watcher.id)
        .eq('pair', signal.pair)
        .eq('trade_sent', true)
        .gte('created_at', fifteenMinutesAgo)
        .limit(1);

      if (recentEvaluations && recentEvaluations.length > 0) {
        console.log(`[registerSignal] Recent trade alert already recorded in scan_evaluations for watcher ${watcher.id}. Skipping.`);
        return false;
      }
    } catch (evalErr) {
      // Ignore evaluation table check errors if table doesn't exist
    }

    // 2. Atomic fingerprint insertion FIRST to prevent concurrent duplicate signals across serverless cold starts
    try {
      const { error: insertFpErr } = await supabase
        .from('signal_fingerprints')
        .insert({
          watcher_id: watcher.id,
          fingerprint: signalHash,
          pair: signal.pair,
          direction: signal.direction,
          entry_price: String(signal.entryPrice),
          created_at: new Date().toISOString()
        });

      if (insertFpErr) {
        if (insertFpErr.code === '23505' || insertFpErr.message?.includes('unique') || insertFpErr.message?.includes('duplicate')) {
          console.log(`[registerSignal] Duplicate signal fingerprint blocked by database constraint for watcher ${watcher.id}. Skipping.`);
          return false;
        }
        console.warn(`[registerSignal] Could not insert signal fingerprint into Supabase:`, insertFpErr.message);
      }
    } catch (fpInsertEx) {
      console.warn(`[registerSignal] Exception inserting signal fingerprint:`, fpInsertEx);
    }

    // 3. Update watcher registration log in database
    const payload = {
      last_scan_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: updatedRows, error: updateError } = await supabase
      .from("watchers")
      .update(payload)
      .eq("id", watcher.id)
      .eq("trade_status", "WAITING")
      .select();

    if (updateError || !updatedRows || updatedRows.length === 0) {
      return false;
    }

    console.log(`[registerSignal] Signal registered successfully in Supabase for ${signal.pair}.`);
    return true;

  } catch (err: any) {
    console.error(`[registerSignal] Exception caught during signal registration:`, err);
    return false;
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
    
    const cleanCronSecret = cronSecretRaw ? cronSecretRaw.trim().replace(/^['"]|['"]$/g, '').trim() : "";

    // 1. Strictly enforce CRON_SECRET requirement (401 Unauthorized if missing on server)
    if (!cleanCronSecret) {
      console.warn("[CRON SECURITY REJECTED] CRON_SECRET environment variable is missing or empty on server.");
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        reason: "CRON_SECRET environment variable is not configured or is empty on the server."
      });
    }

    // 2. Require Bearer authentication (401 if missing, invalid format, or token mismatch)
    if (!authHeader) {
      console.warn("[CRON SECURITY REJECTED] Missing Authorization header.");
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        reason: "Authorization header is missing."
      });
    }

    const trimmedHeader = String(authHeader).trim();
    if (!trimmedHeader.toLowerCase().startsWith("bearer ")) {
      console.warn("[CRON SECURITY REJECTED] Authorization header does not use Bearer scheme.");
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        reason: "Authorization header must use Bearer scheme."
      });
    }

    const token = trimmedHeader.substring(7).trim().replace(/^['"]|['"]$/g, '').trim();

    if (!token || token !== cleanCronSecret) {
      console.warn("[CRON SECURITY REJECTED] Invalid or mismatched Bearer token provided.");
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        reason: "Invalid or mismatched Bearer token."
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
      .eq("status", "active")
      .order('last_scan_at', { ascending: true, nullsFirst: true });
      
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

      const SCAN_DUE_GRACE_MS = 30000;
      const dueResult = isWatcherDue(watcher, now, scanIntervalMinutes, SCAN_DUE_GRACE_MS);
      let isDue = dueResult.isDue;
      const dueReason = dueResult.reason;
      const nextScanDate = dueResult.nextScanDate;

      // Prevent duplicate scanning if two cron invocations overlap
      if (lastScanDate && (now.getTime() - lastScanDate.getTime() < 5000) && tradeStatus !== 'ACTIVE') {
        isDue = false;
      }

      const cooldownUntilStr = watcher.cooldown_until ? new Date(watcher.cooldown_until).toISOString() : 'NULL';

      console.log(`[Watcher Scheduling]
Watcher ID: ${watcher.id}
Symbol: ${selectedPair}
Last Scan: ${lastScanDate ? lastScanDate.toISOString() : 'NULL'}
Next Eligible: ${nextScanDate ? nextScanDate.toISOString() : 'NOW'}
Current Time: ${now.toISOString()}
Grace Window: ${SCAN_DUE_GRACE_MS} ms
Due: ${isDue ? 'YES' : 'NO'}
Reason: ${dueReason}`);

      console.log(`--- Processing Watcher ${watcher.id} (${selectedPair}) ---`);
      console.log(`Watcher ID: ${watcher.id}`);
      console.log(`trade_status from database: ${watcher.trade_status}`);
      console.log(`selected_pair: ${selectedPair}`);
      console.log(`State: ${tradeStatus}`);
      console.log(`Cooldown Until: ${cooldownUntilStr}`);
      console.log(`Trade Status: ${tradeStatus}`);

      if (!isDue) {
        console.log(`LOG: Watcher ${watcher.id} skipped - Not due yet`);
        skipped.push({ userId, reason: `Not due yet (${dueReason})` });
        watchersSkippedCount++;
        continue;
      }

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

        const activeValidation = validateActiveTradeState(watcher);
        if (!activeValidation.valid) {
          let currentPriceFetch: number | null = null;
          try {
            const symbolKey = toDisplaySymbol(selectedPair);
            if (cronPriceCache[symbolKey] !== undefined) {
              currentPriceFetch = cronPriceCache[symbolKey];
            } else {
              currentPriceFetch = await fetchCurrentPrice(selectedPair, twelveDataKey, tdStats);
            }
          } catch (e) {}

          console.error(`[ACTIVE STATE INVALID]
Watcher ID: ${watcher.id}
Symbol: ${selectedPair}
Direction: ${watcher.direction}
Entry: ${watcher.entry_price}
SL: ${watcher.stop_loss}
TP: ${watcher.take_profit}
Current Price: ${currentPriceFetch !== null ? currentPriceFetch : 'N/A'}
Reason: ${activeValidation.reason}`);

          const { error: invalidUpdateErr } = await supabase.from("watchers").update({
            trade_status: 'WAITING',
            active_trade_id: null,
            direction: null,
            entry_price: null,
            stop_loss: null,
            take_profit: null,
            signal_message_id: null,
            opened_at: null,
            closed_at: null,
            cooldown_until: null,
            last_scan_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }).eq("id", watcher.id);

          if (invalidUpdateErr) {
            console.error(`[ACTIVE STATE INVALID UPDATE ERROR] Watcher ID: ${watcher.id} failed to transition to WAITING:`, invalidUpdateErr.message);
          } else {
            console.log(`[ACTIVE STATE INVALID SUCCESS] Watcher ID: ${watcher.id} successfully transitioned to WAITING from invalid ACTIVE state.`);
          }

          skipped.push({ userId, reason: `Invalid ACTIVE state: ${activeValidation.reason}` });
          watchersSkippedCount++;
          console.log(`ACTIVE branch exited due to invalid state.`);
          continue;
        }

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

          const activeTradeId = watcher.active_trade_id || watcher.last_signal_data?.trade_id || watcher.last_signal_data?.tradeId || null;

          await recordCompletedTrade(supabase, {
            user_id: userId,
            watcher_id: watcher.id,
            trade_id: activeTradeId,
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
              active_trade_id: null,
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

          const activeTradeIdSL = watcher.active_trade_id || watcher.last_signal_data?.trade_id || watcher.last_signal_data?.tradeId || null;

          await recordCompletedTrade(supabase, {
            user_id: userId,
            watcher_id: watcher.id,
            trade_id: activeTradeIdSL,
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
              active_trade_id: null,
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

      let executionLogs: { time: string; message: string; type: 'info' | 'success' | 'error' | 'warning' }[] = [];
      const addLog = (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
        const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
        executionLogs.push({ time, message, type });
      };

      addLog("Cron Started", "success");
      addLog("Watcher Due / Grace Window Passed", "success");

      let scanStart: number = 0;
      try {
        addLog("Watcher Loaded", "success");
        addLog(`Pair: ${selectedPair}`);

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
        addLog("Strategy Loaded", "success");
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
        let positionMode: 'AUTO_RISK' | 'FIXED_LOT';
        let preferredLotSize: number | undefined;
        try {
          const riskPrefs = extractRiskPreferences(prefsRecord, userId);
          accountSize = riskPrefs.accountSize;
          riskPercentage = riskPrefs.riskPercentage;
          riskRewardStr = riskPrefs.riskRewardStr;
          maxDailyRiskStr = riskPrefs.maxDailyRiskStr;
          positionMode = riskPrefs.positionMode;
          preferredLotSize = riskPrefs.preferredLotSize;
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
          addLog("Candle Downloaded (Cache Hit)", "success");
          console.log(`[Cache Hit] Reusing cached Twelve Data time series for ${tsCacheKey}`);
          tdStats.cacheHits++;
          quoteData = cronTimeSeriesCache[tsCacheKey].quoteData;
          candleData = cronTimeSeriesCache[tsCacheKey].candleData;
        } else {
          addLog("Candle Downloaded", "success");
          const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(finalSymbol)}&interval=${interval}&outputsize=20&timezone=UTC&apikey=${twelveDataKey}`;
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

        // Fix 1: Validate Market Data Temporal Integrity
        const integrity = validateMarketDataIntegrity(selectedPair, candleData);
        if (!integrity.valid) {
          console.log(`[Market Data Integrity] Watcher ${watcher.id} (${selectedPair}) skipped - ${integrity.reason}`);
          skipped.push({ userId, reason: `Market data integrity check failed: ${integrity.reason}` });
          watchersSkippedCount++;

          const scanDurationMs = Date.now() - scanStart;
          await recordEvaluation(supabase, {
            user_id: userId,
            watcher_id: watcher.id,
            pair: selectedPair,
            timeframe: selectedTimeframe,
            strategy_mode: 'HYBRID',
            decision_score: 0,
            matched_weight: 0,
            possible_weight: 0,
            recommendation: 'FAIL',
            mandatory_rules_passed: false,
            matched_rules: [],
            failed_rules: [`Market Data Integrity Failed: ${integrity.reason}`],
            gemini_used: false,
            trade_sent: false,
            trade_reason: `Market data invalid (${integrity.status}): ${integrity.reason}`,
            scan_duration_ms: scanDurationMs,
            decision_snapshot: null
          });

          await supabase
            .from("watchers")
            .update({
               last_scan_at: new Date().toISOString(),
               updated_at: new Date().toISOString()
            })
            .eq("id", watcher.id);

          continue;
        }

        // Extract market structure & compile strategy
        addLog("Strategy Compiled", "success");
        const compiledStrategy = compileStrategy(strategyText);
        const strategyCompilationConfidenceRecord = normalizeConfidence(
          compiledStrategy.overall_confidence ?? compiledStrategy.confidence,
          'strategy_compilation',
          'Strategy Compiler'
        );
        const strategyCompilationConfidence = strategyCompilationConfidenceRecord.normalized;

        const marketStructure = extractMarketStructure(candleData, compiledStrategy.detector_validation?.supported_detectors);

        // Stage 2
        const cleanSymUpper = (selectedPair || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const pipSize = (cleanSymUpper.includes('JPY') || cleanSymUpper.includes('XAU') || cleanSymUpper.includes('GOLD')) ? 0.01 : 0.0001;

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

        const ruleDecisionScoreRecord = normalizeConfidence(
          decisionResult.decision_score,
          'rule_score',
          'Weighted Decision Engine'
        );
        const ruleDecisionScore = ruleDecisionScoreRecord.normalized;

        let decisionSnapshot: any = buildDecisionSnapshot(decisionResult, histResult, compiledStrategy);

        // Stage 4
        addLog("Decision Engine Complete", "success");
        addLog(`Decision Score: ${decisionResult.decision_score.toFixed(1)}%`);
        addLog(`Recommendation: ${decisionResult.recommendation}`);

        let analysis: any = {
          signal: 'NO_TRADE',
          confidence: 0,
          entryPrice: null,
          stopLoss: null,
          takeProfit: null,
          riskReward: null,
          reasoning: []
        };
        let parsedResult: any = null;
        let geminiDirection = 'NO_TRADE';
        let geminiCalled = false;
        let geminiTextResult = "";
        let geminiStart = 0;
        let geminiDuration = 0;
        let requiresGemini = false;

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

          watchersProcessedCount++;
          continue;
        } else {
          // Check if we force Gemini for FAIL in HYBRID/AI_ONLY or if AMBIGUOUS/requires_gemini is true
          const forceGemini = (recommendation === 'FAIL' && (executionMode === 'HYBRID' || executionMode === 'AI_ONLY'));
          requiresGemini = Boolean(decisionResult.requires_gemini || forceGemini || recommendation === 'AMBIGUOUS');
          
          console.log(`
[Decision Routing]
Strategy Mode: ${compiledStrategy.strategy_mode || 'HYBRID'}
Execution Mode: ${executionMode}
Rule Score: ${decisionResult.decision_score}
Rule Recommendation: ${recommendation}
Requires Gemini: ${requiresGemini ? 'YES' : 'NO'}
Reason: ${decisionResult.explanation || (requiresGemini ? 'Strategy configuration or score requires AI evaluation' : 'Rule evaluation sufficient')}
`.trim());

          if (requiresGemini) {
            addLog("Gemini Required", "success");
            addLog("Calling Gemini", "success");
            geminiInvoked = true;
            console.log("Gemini Invoked");
            geminiCalled = true;
            geminiStart = Date.now();

            const keyRes = await resolveUserGeminiKey(supabase, userId, watcher.id);

            if (!keyRes.keyPresent || !keyRes.apiKey) {
              console.log(`[Decision Engine] User ${userId} has no Gemini API key in user_api_keys. Forcing NO_TRADE.`);

              await supabase.from("profiles").update({
                gemini_status: 'NOT_CONNECTED',
                gemini_last_error: 'Missing Gemini API key',
                gemini_last_checked: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }).eq("id", userId);

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
                gemini_result: "Missing Gemini API key",
                trade_sent: false,
                trade_reason: "User has no Gemini API key configured",
                scan_duration_ms: scanDurationMs,
                gemini_duration_ms: Date.now() - geminiStart,
                decision_snapshot: decisionSnapshot
              });

              skipped.push({ userId, reason: "Missing Gemini API key" });
              watchersSkippedCount++;
              continue;
            }

            try {
              const geminiKey = keyRes.apiKey;
              if (geminiKey) {
                console.log("========== CALLING GEMINI ==========");
                console.log("Watcher ID:", watcher.id);
                console.log("Pair:", selectedPair);
                console.log("Timeframe:", selectedTimeframe);
                console.log("Decision Score:", decisionResult.decision_score);
                console.log("Recommendation:", recommendation);
                console.log("Gemini Required:", requiresGemini);
                console.log("Sending prompt to Gemini...");

                const ai = new GoogleGenAI({ apiKey: geminiKey });
                const currentPrice = candleData[candleData.length - 1].close;
                const promptText = `
You are an expert AI trading analyst.

Strategy Summary:
- Style: ${compiledStrategy.strategy_mode || 'HYBRID'}
- Timeframe: ${selectedTimeframe}

Current Price: ${currentPrice}

Detailed Numeric Market Structure & Key Levels:
- Trend: ${marketStructure.trend}
- Support Zones (Min-Max): ${marketStructure.supportZones?.map(s => `[${s.priceMin.toFixed(5)} - ${s.priceMax.toFixed(5)}]`).join(', ') || 'None'}
- Resistance Zones (Min-Max): ${marketStructure.resistanceZones?.map(r => `[${r.priceMin.toFixed(5)} - ${r.priceMax.toFixed(5)}]`).join(', ') || 'None'}
- Swing Highs: ${marketStructure.swingHighs?.slice(-3).map(s => s.price.toFixed(5)).join(', ') || 'None'}
- Swing Lows: ${marketStructure.swingLows?.slice(-3).map(s => s.price.toFixed(5)).join(', ') || 'None'}
- Fair Value Gaps: ${marketStructure.fairValueGaps?.slice(-3).map(f => `${f.type} (${f.bottom.toFixed(5)} - ${f.top.toFixed(5)})`).join(', ') || 'None'}
- Volume Confirmation: ${marketStructure.volumeInformation.volumeSpike ? 'Confirmed' : 'None'}
- ATR: ${marketStructure.volatilityInformation.atr.toFixed(5)}

AI Instructions:
1. Evaluate ONLY the supplied market evidence.
2. Determine whether the available confluence is enough to produce a BUY, SELL, or NO_TRADE.
3. If BUY or SELL, provide the exact Entry Price, Stop Loss, and Take Profit based on actual NUMERIC market structure.
4. For BUY: Stop Loss MUST be placed BELOW entry, below relevant support zone, swing low, or demand structure.
5. For SELL: Stop Loss MUST be placed ABOVE entry, above relevant resistance zone, swing high, or supply structure.
6. Identify the basis used for the Stop Loss in "stopLossBasis" (SUPPORT_ZONE, RESISTANCE_ZONE, SWING_LOW, SWING_HIGH, DEMAND_ZONE, SUPPLY_ZONE, STRUCTURAL_CANDLE, ATR_FALLBACK).
7. Only return NO_TRADE when the supplied evidence clearly argues against taking a trade.

Output ONLY valid JSON.
`;
                const aiResponse = await ai.models.generateContent({
                  model: "gemini-3.6-flash",
                  contents: promptText,
                  config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                      type: Type.OBJECT,
                      properties: {
                        satisfies: { type: Type.BOOLEAN },
                        direction: { type: Type.STRING },
                        confidenceScore: { type: Type.NUMBER },
                        entryPrice: { type: Type.NUMBER },
                        stopLoss: { type: Type.NUMBER },
                        takeProfit: { type: Type.NUMBER },
                        stopLossBasis: { type: Type.STRING },
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

                parsedResult = JSON.parse(geminiTextResult);
                addLog("Gemini Returned", "success");
                addLog("Parsed Gemini Output", "success");
                console.log("========== PARSED GEMINI OUTPUT ==========");
                console.log(parsedResult);

                geminiSucceeded = true;
                geminiDecision = parsedResult.direction as 'BUY' | 'SELL' | 'NO_TRADE';

                if (parsedResult.satisfies && parsedResult.direction && parsedResult.direction !== 'NO_TRADE') {
                  geminiDirection = parsedResult.direction;
                  const entry = Number(parsedResult.entryPrice) || candleData[candleData.length - 1].close;

                  // Resolve structural stop loss using market structure
                  const slResult = validateAndResolveStopLoss(
                    geminiDirection as 'BUY' | 'SELL',
                    entry,
                    parsedResult.stopLoss,
                    parsedResult.stopLossBasis,
                    marketStructure
                  );

                  let finalTP = Number(parsedResult.takeProfit);
                  const isTpValid = !isNaN(finalTP) && finalTP > 0 &&
                    (geminiDirection === 'BUY' ? finalTP > entry : finalTP < entry);

                  if (!isTpValid) {
                    const riskDist = Math.abs(entry - slResult.stopLoss);
                    const rrRatio = parseRiskRewardRatio(riskRewardStr);
                    finalTP = geminiDirection === 'BUY' ? entry + (riskDist * rrRatio) : entry - (riskDist * rrRatio);
                  }

                  const geminiConfRecord = normalizeConfidence(parsedResult.confidenceScore, 'gemini', 'Gemini AI Model');
                  const finalConfRecord = normalizeConfidence(geminiConfRecord.normalized, 'final_trade', 'Executable Signal');

                  console.log(`[Gemini Decision]
Required: YES
Status: APPROVED
Direction: ${geminiDirection}
Confidence: ${geminiConfRecord.normalized}%
Fallback: NO_TRADE`.trim());

                  console.log(`[TP Analysis]
Direction: ${geminiDirection}
Entry: ${entry}
SL: ${slResult.stopLoss}
TP1: ${finalTP}
TP2: ${parsedResult.tp2 ?? 'N/A'}
TP3: ${parsedResult.tp3 ?? 'N/A'}
TP Basis: ${parsedResult.stopLossBasis || 'Market Structure Target'}`);

                  analysis = {
                    signal: geminiDirection,
                    confidence: finalConfRecord.normalized,
                    entryPrice: entry,
                    stopLoss: slResult.stopLoss,
                    takeProfit: finalTP,
                    tp1: parsedResult.tp1 || finalTP,
                    tp2: parsedResult.tp2 || null,
                    tp3: parsedResult.tp3 || null,
                    stopLossBasis: slResult.stopLossBasis,
                    structuralLevel: slResult.structuralLevel,
                    riskReward: riskRewardStr,
                    reasoning: [parsedResult.reasoning || "Satisfies strategy rules and Gemini validation."]
                  };
                } else {
                  console.log(`[Gemini Decision]
Required: YES
Status: REJECTED
Direction: NO_TRADE
Confidence: 0%
Fallback: NO_TRADE`.trim());

                  analysis = {
                    signal: 'NO_TRADE',
                    confidence: 0,
                    reasoning: [parsedResult?.reasoning || "Gemini evaluated setup as NO_TRADE or unsatisfied."]
                  };
                }
              }
            } catch (gemErr: any) {
              console.error("========== GEMINI ERROR ==========");
              console.error(gemErr);

              const { profileStatus, diagnosticStatus, cleanErrorMessage } = classifyAndRedactGeminiError(gemErr);

              console.log(`[Gemini Key Resolution]
User ID: ${userId}
Watcher ID: ${watcher.id}
Key Source: user_api_keys
Key Present: YES
Key Redacted: ${keyRes.keyRedacted}
Status: ${diagnosticStatus}`);

              console.log(`[Gemini Decision]
Required: YES
Status: ${diagnosticStatus}
Direction: NO_TRADE
Confidence: 0%
Fallback: NO_TRADE`.trim());

              await supabase.from("profiles").update({
                gemini_status: profileStatus,
                gemini_last_error: cleanErrorMessage,
                gemini_last_checked: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }).eq("id", userId);

              console.log(`========== AI STATUS ==========`);
              console.log(`User: ${userProfile?.email || userId}`);
              console.log(`Watcher: ${watcher.id} (${watcher.selected_pair})`);
              console.log(`Gemini Status: ${profileStatus}`);
              console.log(`Reason: ${cleanErrorMessage}`);
              console.log(`Action: Skipped`);
              console.log(`===============================`);

              // Update last_scan_at and last_analyzed_closed_candle_time and exit
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
                gemini_result: "Gemini execution failed: " + cleanErrorMessage,
                trade_sent: false,
                trade_reason: "Gemini API call failed: " + cleanErrorMessage,
                scan_duration_ms: scanDurationMs,
                gemini_duration_ms: Date.now() - geminiStart,
                decision_snapshot: decisionSnapshot
              });

              skipped.push({ userId, reason: cleanErrorMessage });
              watchersSkippedCount++;
              continue;
            }
          } else {
            // Gemini NOT required! Fallback to local strategy engine (since recommendation is PASS)
            console.log(`[Decision Engine] Recommendation is ${recommendation}. Skipping Gemini as requires_gemini is false.`);

            if (recommendation === 'FAIL' || recommendation === 'AMBIGUOUS') {
              console.log(`[Decision Engine] Recommendation is ${recommendation}. Forcing NO_TRADE without Gemini approval.`);
              analysis = {
                signal: 'NO_TRADE',
                confidence: 0,
                reasoning: [`Rejected by Decision Engine (${recommendation} without Gemini approval)`]
              };
            } else {
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
              if (localAnalysis && localAnalysis.signal !== 'NO_TRADE' && localAnalysis.entryPrice) {
                const slResult = calculateStructuralStopLoss(
                  localAnalysis.signal as 'BUY' | 'SELL',
                  localAnalysis.entryPrice,
                  marketStructure
                );
                localAnalysis.stopLoss = slResult.stopLoss;
                (localAnalysis as any).stopLossBasis = slResult.stopLossBasis;
                (localAnalysis as any).structuralLevel = slResult.structuralLevel;

                const riskDist = Math.abs(localAnalysis.entryPrice - slResult.stopLoss);
                const rrRatio = parseRiskRewardRatio(riskRewardStr);
                localAnalysis.takeProfit = localAnalysis.signal === 'BUY'
                  ? localAnalysis.entryPrice + (riskDist * rrRatio)
                  : localAnalysis.entryPrice - (riskDist * rrRatio);
              }
              analysis = localAnalysis;
            }
          }
        }

        if (requiresGemini) {
          if (!geminiSucceeded || (analysis.signal !== 'BUY' && analysis.signal !== 'SELL')) {
            console.log(`[Safety Invariant] Gemini required. Executed: ${geminiCalled ? 'YES' : 'NO'}, Result: ${parsedResult?.direction || (geminiSucceeded ? 'NO_TRADE' : 'ERROR/UNAVAILABLE')}`);
            analysis = {
              signal: 'NO_TRADE',
              confidence: 0,
              entryPrice: null,
              stopLoss: null,
              takeProfit: null,
              riskReward: null,
              reasoning: analysis.reasoning?.length ? analysis.reasoning : ['Gemini required but did not produce valid BUY or SELL decision.']
            };
          }
        }

        console.log("========== FINAL SIGNAL ==========");
        console.log("Decision Recommendation:", recommendation);
        console.log("Gemini Direction:", parsedResult?.direction);
        console.log("Final Analysis Signal:", analysis.signal);
        console.log("Telegram Will Send:", analysis.signal !== "NO_TRADE");
        
        if (analysis.signal === 'BUY') {
          addLog("Final Signal: BUY", "success");
          console.log("FINAL DECISION: BUY");
        } else if (analysis.signal === 'SELL') {
          addLog("Final Signal: SELL", "success");
          console.log("FINAL DECISION: SELL");
        } else if (analysis.signal === 'NO_TRADE') {
          addLog("Final Signal: NO_TRADE", "success");
          console.log("FINAL DECISION: NO_TRADE");
        }
        
        console.log("==================================");

        console.log(`LOG: Signal result for ${selectedPair}: ${analysis.signal} (Confidence: ${analysis.confidence}%)`);

        let qualityResult: any = null;
        let governorResult: any = null;
        let calibrationResult: any = null;
        let adaptiveResult: any = null;
        let adaptiveReq: any = null;
        let executionResult: any = null;

        // Quality Gate Check (QUALITY OVER QUANTITY)
        if (analysis.signal === 'BUY' || analysis.signal === 'SELL') {
          qualityResult = evaluateQualityGate({
            ruleScore: ruleDecisionScore,
            marketStructure: marketStructure,
            mandatoryRulesPassed: decisionResult.mandatory_rules_passed ?? true,
            geminiApproved: geminiCalled ? geminiSucceeded : undefined,
            geminiRequired: requiresGemini,
            direction: analysis.signal,
            slValid: Boolean(analysis.stopLoss),
            tpValid: Boolean(analysis.takeProfit),
            rrValid: true,
            historicalProbability: histResult.historical_probability
          });

          if (!qualityResult.passed) {
            console.log(`[Signal Quality] Signal rejected by Quality Gate for ${selectedPair}: ${qualityResult.reason} (Score: ${qualityResult.qualityScore})`);
            analysis.signal = 'NO_TRADE';
          }
        }

        // Equity-Aware Learning & Risk Governor Evaluation
        if (analysis.signal === 'BUY' || analysis.signal === 'SELL') {
          try {
            const completedTrades = await fetchUserCompletedTrades(supabase, userId);
            const equityMetrics = computeEquityAnalytics(completedTrades);
            const equityState = deriveEquityState(accountSize, equityMetrics);
            governorResult = evaluateRiskGovernor({
              metrics: equityMetrics,
              equityState,
              candidate: {
                pair: selectedPair,
                timeframe: selectedTimeframe,
                strategySetup: compiledStrategy.strategy_mode,
                qualityScore: analysis.confidence,
                confidence: analysis.confidence
              }
            });

            if (governorResult.status === 'NO_TRADE') {
              console.log(`[Risk Governor] REJECTED signal for ${selectedPair}: Governor status is NO_TRADE. Reason: ${governorResult.reasonCodes.join(', ')}`);
              analysis.signal = 'NO_TRADE';
              if (analysis.reasoning) {
                if (Array.isArray(analysis.reasoning)) {
                  analysis.reasoning.push(`Risk Governor NO_TRADE: ${governorResult.explanation}`);
                } else {
                  analysis.reasoning = [analysis.reasoning, `Risk Governor NO_TRADE: ${governorResult.explanation}`];
                }
              } else {
                analysis.reasoning = [`Risk Governor NO_TRADE: ${governorResult.explanation}`];
              }
            } else if (governorResult.status === 'RESTRICTED_SELECTIVITY') {
              console.log(`[Risk Governor] RESTRICTED_SELECTIVITY active for ${selectedPair}. Reason: ${governorResult.reasonCodes.join(', ')}`);
              if (analysis.confidence < 80) {
                console.log(`[Risk Governor] Rejecting ${selectedPair} under RESTRICTED_SELECTIVITY because confidence (${analysis.confidence}%) is below strict 80% threshold.`);
                analysis.signal = 'NO_TRADE';
              }
            }
          } catch (govErr) {
            console.error('[Risk Governor Error] Failed to evaluate equity learning governor, proceeding with standard signal pipeline:', govErr);
          }
        }

        // Closed-Loop Strategy Calibration (Stage 3G)
        if (analysis.signal === 'BUY' || analysis.signal === 'SELL') {
          try {
            const completedTrades = await fetchCompletedTradesForAdaptiveLearning(supabase, userId);
            calibrationResult = evaluateClosedLoopCalibration({
              userId,
              pair: selectedPair,
              timeframe: selectedTimeframe,
              setup: compiledStrategy?.strategy_mode || 'HYBRID',
              direction: analysis.signal,
              marketRegime: analysis.regime || 'UNKNOWN',
              confidence: analysis.confidence,
              qualityScore: analysis.confidence,
              executionScore: 80,
              expectedRR: parseRiskRewardRatio(riskRewardStr),
              completedTrades
            });

            console.log(`[Closed-Loop Calibration] Action: ${calibrationResult.recommendedAction}, Evidence: ${calibrationResult.evidenceLevel}, Trades: ${calibrationResult.tradeCount}, Reliability: ${calibrationResult.overallReliability}`);

            if (calibrationResult.recommendedAction === 'NO_TRADE') {
              console.log(`[Closed-Loop Calibration] REJECTED signal for ${selectedPair} (${analysis.signal}): ${calibrationResult.explanation}`);
              analysis.signal = 'NO_TRADE';
              const calibMsg = `[Closed-Loop Calibration] NO_TRADE: ${calibrationResult.explanation}`;
              if (analysis.reasoning) {
                if (Array.isArray(analysis.reasoning)) {
                  analysis.reasoning.push(calibMsg);
                } else {
                  analysis.reasoning = [analysis.reasoning, calibMsg];
                }
              } else {
                analysis.reasoning = [calibMsg];
              }
            } else if (calibrationResult.recommendedAction === 'RESTRICT') {
              if (analysis.confidence < 80) {
                console.log(`[Closed-Loop Calibration] Rejecting ${selectedPair} under RESTRICT recommendation because confidence (${analysis.confidence}%) < 80% threshold.`);
                analysis.signal = 'NO_TRADE';
              }
            } else if (calibrationResult.recommendedAction === 'SELECTIVE') {
              if (analysis.confidence < 75) {
                console.log(`[Closed-Loop Calibration] Rejecting ${selectedPair} under SELECTIVE recommendation because confidence (${analysis.confidence}%) < 75% threshold.`);
                analysis.signal = 'NO_TRADE';
              }
            }
          } catch (calibErr) {
            console.error('[Closed-Loop Calibration Error] Failed to evaluate closed-loop calibration:', calibErr);
          }
        }

        // Adaptive Learning Evaluation (Stage 3B) & Adaptive Quality Requirement (Stage 3C)
        if (analysis.signal === 'BUY' || analysis.signal === 'SELL') {
          try {
            const completedTrades = await fetchCompletedTradesForAdaptiveLearning(supabase, userId);
            adaptiveResult = evaluateAdaptiveLearning({
              pair: selectedPair,
              timeframe: selectedTimeframe,
              setup: compiledStrategy?.strategy_mode || 'HYBRID',
              direction: analysis.signal,
              marketRegime: analysis.regime || 'UNKNOWN',
              completedTrades
            });

            adaptiveReq = calculateAdaptiveQualityRequirement({
              baseThreshold: 75,
              classification: adaptiveResult.classification,
              tier: adaptiveResult.tier,
              expectancyR: adaptiveResult.expectancyR,
              recentExpectancyR: adaptiveResult.recentExpectancyR,
              sampleSize: adaptiveResult.sampleSize
            });

            console.log(`
[Adaptive Quality]
Requested: ${selectedPair} + ${selectedTimeframe} + ${compiledStrategy?.strategy_mode || 'HYBRID'} + ${analysis.signal} + ${analysis.regime || 'UNKNOWN'}
Specific Sample: ${adaptiveResult.sampleSize}
Fallback: ${adaptiveResult.fallbackLevelUsed}
Classification: ${adaptiveResult.classification}
Expectancy: ${adaptiveResult.expectancyR.toFixed(2)}R
Recent Expectancy: ${adaptiveResult.recentExpectancyR.toFixed(2)}R
Base Quality: ${analysis.confidence}%
Adaptive Requirement: ${adaptiveReq.minRequired}%
Reason: ${adaptiveReq.reason}
            `.trim());

            if (adaptiveResult.decision === 'REJECT') {
              console.log(`[Adaptive Learning] REJECTED signal for ${selectedPair} (${analysis.signal}): ${adaptiveResult.reason}`);
              analysis.signal = 'NO_TRADE';
              if (analysis.reasoning) {
                if (Array.isArray(analysis.reasoning)) {
                  analysis.reasoning.push(`Adaptive Learning REJECT: ${adaptiveResult.explanation}`);
                } else {
                  analysis.reasoning = [analysis.reasoning, `Adaptive Learning REJECT: ${adaptiveResult.explanation}`];
                }
              } else {
                analysis.reasoning = [`Adaptive Learning REJECT: ${adaptiveResult.explanation}`];
              }
            } else if (adaptiveResult.decision === 'RESTRICT') {
              console.log(`[Adaptive Learning] RESTRICT active for ${selectedPair} (${analysis.signal}): ${adaptiveResult.reason}`);
              if (analysis.confidence < 85) {
                console.log(`[Adaptive Learning] Rejecting ${selectedPair} under RESTRICT decision because confidence (${analysis.confidence}%) is below strict 85% threshold.`);
                analysis.signal = 'NO_TRADE';
              }
            } else if (analysis.confidence < adaptiveReq.minRequired) {
              console.log(`[Adaptive Quality] REJECTED signal for ${selectedPair}: Quality score (${analysis.confidence}%) < adaptive requirement (${adaptiveReq.minRequired}%)`);
              analysis.signal = 'NO_TRADE';
              const qualMsg = `[Adaptive Quality] Historical configuration deterioration requires stronger confluence (Score ${analysis.confidence}% < ${adaptiveReq.minRequired}%).`;
              if (analysis.reasoning) {
                if (Array.isArray(analysis.reasoning)) {
                  analysis.reasoning.push(qualMsg);
                } else {
                  analysis.reasoning = [analysis.reasoning, qualMsg];
                }
              } else {
                analysis.reasoning = [qualMsg];
              }
            }

            // Adaptive Execution Timing (Stage 3D)
            if (analysis.signal === 'BUY' || analysis.signal === 'SELL') {
              try {
                executionResult = evaluateAdaptiveExecution({
                  pair: selectedPair,
                  timeframe: selectedTimeframe,
                  setup: compiledStrategy?.strategy_mode || 'HYBRID',
                  direction: analysis.signal,
                  marketRegime: analysis.regime || 'UNKNOWN',
                  entryPrice: analysis.entryPrice,
                  structurePrice: analysis.structurePrice || analysis.sl,
                  atr: analysis.atr,
                  completedTrades,
                  adaptiveQuality: adaptiveResult,
                  riskGovernor: governorResult
                });

                if (executionResult.status === 'WAIT') {
                  console.log(`[Adaptive Execution] WAIT state triggered for ${selectedPair}: ${executionResult.explanation}`);
                  analysis.signal = 'NO_TRADE';
                  const waitMsg = `[Adaptive Execution] WAIT: Sub-optimal execution timing (${executionResult.timingQuality}). ${executionResult.reasonCodes.join(', ')}`;
                  if (analysis.reasoning) {
                    if (Array.isArray(analysis.reasoning)) {
                      analysis.reasoning.push(waitMsg);
                    } else {
                      analysis.reasoning = [analysis.reasoning, waitMsg];
                    }
                  } else {
                    analysis.reasoning = [waitMsg];
                  }
                } else if (executionResult.status === 'NO_TRADE') {
                  console.log(`[Adaptive Execution] NO_TRADE triggered for ${selectedPair}: ${executionResult.explanation}`);
                  analysis.signal = 'NO_TRADE';
                  const rejMsg = `[Adaptive Execution] REJECT: Poor execution timing / entry chasing protection (${executionResult.reasonCodes.join(', ')}).`;
                  if (analysis.reasoning) {
                    if (Array.isArray(analysis.reasoning)) {
                      analysis.reasoning.push(rejMsg);
                    } else {
                      analysis.reasoning = [analysis.reasoning, rejMsg];
                    }
                  } else {
                    analysis.reasoning = [rejMsg];
                  }
                }
              } catch (execErr) {
                console.error('[Adaptive Execution Error] Failed to evaluate adaptive execution timing, proceeding with standard signal pipeline:', execErr);
              }
            }
          } catch (adaptErr) {
            console.error('[Adaptive Quality Error] Failed to evaluate adaptive quality requirement, proceeding with standard signal pipeline:', adaptErr);
          }
        }

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
          riskRewardStr: riskRewardStr,
          positionMode: positionMode,
          preferredLotSize: preferredLotSize
        });

        console.log(`
[Trade Risk]
Direction: ${analysis.signal}
Entry: ${posSizeResult.entryPrice}
SL: ${posSizeResult.stopLoss}
TP: ${posSizeResult.takeProfit}
SL Basis: ${analysis.stopLossBasis || 'STRUCTURAL'}
Structural Level: ${analysis.structuralLevel !== null && analysis.structuralLevel !== undefined ? analysis.structuralLevel : 'N/A'}
Stop Distance: ${posSizeResult.stopDistance.toFixed(5)}
Risk Amount: $${posSizeResult.riskAmount.toFixed(2)}
Required Lot: ${posSizeResult.exactLotSize}
Minimum Lot: ${posSizeResult.minLot}
Executable Lot: ${posSizeResult.accepted ? posSizeResult.calculatedLotSize : 'NONE'}
Theoretical Expected Loss: $${posSizeResult.expectedLossAtRequiredLot.toFixed(2)}
Minimum Lot Expected Loss: $${posSizeResult.expectedLossAtMinLot.toFixed(2)}
Expected Loss: $${posSizeResult.accepted ? posSizeResult.expectedLoss.toFixed(2) : posSizeResult.expectedLossAtRequiredLot.toFixed(2)}
Accepted: ${posSizeResult.accepted ? 'YES' : 'NO'}
${analysis.stopLossBasis === 'ATR_FALLBACK' ? `ATR: ${marketStructure.volatilityInformation.atr.toFixed(5)}\nATR Multiplier: 1.5` : ''}
`.trim());

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

          watchersProcessedCount++;
          continue;
        }

        const candidateTradeId = `TR-${watcher.id}-${Date.now()}`;

        const gatesList: DecisionGateResult[] = [
          {
            gate: 'MARKET_DATA',
            status: candleData && candleData.length > 0 ? 'PASS' : 'REJECT',
            reasonCode: candleData && candleData.length > 0 ? 'MARKET_DATA_VALID' : 'MARKET_DATA_EMPTY',
            reason: candleData && candleData.length > 0 ? 'Market candle data received and valid' : 'Market data missing or empty',
            timestamp: new Date().toISOString()
          },
          {
            gate: 'STRATEGY',
            status: recommendation !== 'FAIL' ? 'PASS' : 'REJECT',
            reasonCode: recommendation !== 'FAIL' ? 'STRATEGY_PASSED' : 'STRATEGY_FAILED',
            reason: decisionResult.explanation || `Strategy recommendation: ${recommendation}`,
            timestamp: new Date().toISOString()
          },
          {
            gate: 'GEMINI',
            status: !requiresGemini ? 'NOT_EVALUATED' : (geminiSucceeded ? 'PASS' : 'REJECT'),
            reasonCode: !requiresGemini ? 'NOT_EVALUATED' : (geminiSucceeded ? 'GEMINI_PASSED' : 'GEMINI_REJECTED'),
            reason: !requiresGemini ? 'Gemini AI verification not required' : (geminiSucceeded ? 'Gemini AI confirmed trade setup' : 'Gemini AI rejected or unavailable'),
            timestamp: new Date().toISOString()
          },
          {
            gate: 'QUALITY',
            status: qualityResult ? (qualityResult.passed ? 'PASS' : 'REJECT') : 'NOT_EVALUATED',
            reasonCode: qualityResult ? (qualityResult.passed ? 'QUALITY_PASSED' : 'QUALITY_REJECTED') : 'NOT_EVALUATED',
            reason: qualityResult?.reason || 'Quality gate validation',
            timestamp: new Date().toISOString()
          },
          {
            gate: 'ADAPTIVE_LEARNING',
            status: adaptiveResult ? (adaptiveResult.decision === 'REJECT' ? 'REJECT' : 'PASS') : 'NOT_EVALUATED',
            reasonCode: adaptiveResult ? (adaptiveResult.decision === 'REJECT' ? 'ADAPTIVE_LEARNING_REJECT' : 'ADAPTIVE_LEARNING_PASS') : 'NOT_EVALUATED',
            reason: adaptiveResult?.reason || 'Adaptive historical learning evaluation',
            timestamp: new Date().toISOString()
          },
          {
            gate: 'ADAPTIVE_QUALITY',
            status: adaptiveReq ? (analysis.confidence >= adaptiveReq.minRequired ? 'PASS' : 'REJECT') : 'NOT_EVALUATED',
            reasonCode: adaptiveReq ? (analysis.confidence >= adaptiveReq.minRequired ? 'ADAPTIVE_QUALITY_PASSED' : 'ADAPTIVE_QUALITY_REJECTED') : 'NOT_EVALUATED',
            reason: adaptiveReq?.reason || 'Adaptive quality requirement',
            timestamp: new Date().toISOString()
          },
          {
            gate: 'ADAPTIVE_EXECUTION',
            status: executionResult ? (executionResult.status === 'WAIT' ? 'WAIT' : (executionResult.status === 'NO_TRADE' ? 'REJECT' : 'PASS')) : 'NOT_EVALUATED',
            reasonCode: executionResult ? (executionResult.status === 'WAIT' ? 'ADAPTIVE_TIMING_WAIT' : (executionResult.status === 'NO_TRADE' ? 'ADAPTIVE_TIMING_REJECT' : 'ADAPTIVE_TIMING_PASS')) : 'NOT_EVALUATED',
            reason: executionResult?.explanation || 'Adaptive execution timing',
            timestamp: new Date().toISOString()
          },
          {
            gate: 'CLOSED_LOOP_CALIBRATION',
            status: calibrationResult ? (calibrationResult.recommendedAction === 'NO_TRADE' ? 'REJECT' : 'PASS') : 'NOT_EVALUATED',
            reasonCode: calibrationResult ? (calibrationResult.recommendedAction === 'NO_TRADE' ? 'CALIBRATION_REJECT' : 'CALIBRATION_PASS') : 'NOT_EVALUATED',
            reason: calibrationResult?.explanation || 'Closed-loop calibration check',
            timestamp: new Date().toISOString()
          },
          {
            gate: 'RISK_GOVERNOR',
            status: governorResult ? (governorResult.status === 'NO_TRADE' ? 'REJECT' : 'PASS') : 'NOT_EVALUATED',
            reasonCode: governorResult ? (governorResult.status === 'NO_TRADE' ? 'RISK_GOVERNOR_REJECT' : 'RISK_GOVERNOR_PASS') : 'NOT_EVALUATED',
            reason: governorResult?.explanation || 'Risk governor state check',
            timestamp: new Date().toISOString()
          },
          {
            gate: 'POSITION_SIZING',
            status: posSizeResult ? (posSizeResult.accepted ? 'PASS' : 'REJECT') : 'NOT_EVALUATED',
            reasonCode: posSizeResult ? (posSizeResult.accepted ? 'POSITION_SIZING_PASS' : 'POSITION_SIZING_REJECT') : 'NOT_EVALUATED',
            reason: posSizeResult?.skipReason || 'Position sizing calculated',
            timestamp: new Date().toISOString()
          },
          {
            gate: 'TRADE_GEOMETRY',
            status: posSizeResult ? (posSizeResult.accepted ? 'PASS' : 'REJECT') : 'NOT_EVALUATED',
            reasonCode: posSizeResult ? (posSizeResult.accepted ? 'GEOMETRY_VALID' : 'GEOMETRY_INVALID') : 'NOT_EVALUATED',
            reason: posSizeResult?.skipReason || 'Trade geometry and R:R structure valid',
            timestamp: new Date().toISOString()
          },
          {
            gate: 'FINAL_TELEGRAM',
            status: (analysis.signal !== 'NO_TRADE' && posSizeResult?.accepted && telegramChatId) ? 'PASS' : (analysis.signal === 'NO_TRADE' ? 'NOT_EVALUATED' : 'REJECT'),
            reasonCode: (analysis.signal !== 'NO_TRADE' && posSizeResult?.accepted && telegramChatId) ? 'TELEGRAM_AUTHORIZED' : 'TELEGRAM_GATE_REJECTED',
            reason: telegramChatId ? 'Telegram alert payload authorized' : 'Telegram chat not connected',
            timestamp: new Date().toISOString()
          }
        ];

        const attribution = resolveAuthoritativeDecision({
          userId,
          watcherId: watcher.id,
          pair: selectedPair,
          timeframe: selectedTimeframe,
          direction: analysis.signal,
          setup: compiledStrategy?.strategy_mode || 'HYBRID',
          regime: analysis.regime || 'UNKNOWN',
          entryPrice: analysis.entryPrice,
          stopLoss: analysis.stopLoss,
          takeProfit: analysis.takeProfit,
          expectedRR: parseRiskRewardRatio(riskRewardStr),
          positionSize: posSizeResult?.calculatedLotSize || null,
          confidence: analysis.confidence,
          qualityScore: analysis.confidence,
          tradeId: candidateTradeId,
          gates: gatesList
        });

        decisionSnapshot = {
          ...decisionSnapshot,
          attribution
        };

        if (attribution.finalDecision !== 'EXECUTE') {
          console.log(`[Authoritative Decision] Signal suppressed for Watcher ID: ${watcher.id} (${selectedPair}): Final decision is ${attribution.finalDecision} from gate ${attribution.rejectedGate || 'UNKNOWN'}.`);
          analysis.signal = 'NO_TRADE';

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
            trade_reason: `Authoritative decision rejected by gate ${attribution.rejectedGate}: ${attribution.rejectionReason}`,
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

          watchersProcessedCount++;
          continue;
        }

        let signal: any = null;
        let isRegistered = false;

        if (recommendation !== 'FAIL') {
          analysis.entryPrice = posSizeResult.entryPrice;
          analysis.stopLoss = posSizeResult.stopLoss;
          analysis.takeProfit = posSizeResult.takeProfit;

          const signalReasoning = Array.isArray(analysis.reasoning) ? analysis.reasoning.join("; ") : (analysis.reasoning || "Strategy criteria matched");
          console.log(`[SIGNAL GENERATED] Watcher ID: ${watcher.id}`);
          console.log(`Exact reason new signal was generated: Strategy evaluation returned signal '${analysis.signal}' with confidence ${analysis.confidence}% (>= 70 threshold) on pair ${selectedPair}. Executed Entry: ${analysis.entryPrice}, Stop Loss: ${analysis.stopLoss}, Take Profit: ${analysis.takeProfit}. Reasoning: ${signalReasoning}`);

          const actualRrVal = posSizeResult.actualRr;
          const formattedRr = actualRrVal > 0
            ? `1:${actualRrVal % 1 === 0 ? actualRrVal.toFixed(0) : actualRrVal.toFixed(2)}`
            : riskRewardStr;

          signal = {
              pair: mappedSymbol,
              timeframe: selectedTimeframe,
              direction: analysis.signal,
              strategySummary: prefsRecord?.strategy_summary || 'Custom Strategy',
              entryPrice: analysis.entryPrice,
              stopLoss: analysis.stopLoss,
              takeProfit: analysis.takeProfit,
              tp1: analysis.tp1 || analysis.takeProfit,
              tp2: analysis.tp2 || null,
              tp3: analysis.tp3 || null,
              riskRewardRatio: formattedRr,
              confidenceScore: analysis.confidence,
              aiReasoning: analysis.reasoning,
              lotSize: posSizeResult.calculatedLotSize,
              riskAmount: posSizeResult.riskAmount,
              expectedLoss: posSizeResult.expectedLoss,
              lotType: posSizeResult.lotType,
              tradeId: candidateTradeId,
              trade_id: candidateTradeId
          };

          isRegistered = await registerSignal(supabase, watcher, signal);
        } else {
          console.log(`[SIGNAL SKIPPED] Watcher ID: ${watcher.id} - Recommendation is FAIL. Setting signal to NO_TRADE.`);
          analysis.signal = 'NO_TRADE';
        }

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

          continue;
        }

        // Send ONE Telegram signal with Signal Deduplication Check
        let alertSent = false;
        let alertReason = "";

        const dedupCheck = checkSignalDeduplication({
          symbol: selectedPair,
          direction: analysis.signal,
          timeframe: selectedTimeframe,
          entryPrice: posSizeResult.entryPrice,
          stopLoss: posSizeResult.stopLoss,
          takeProfit: posSizeResult.takeProfit,
          setupCandleTimestamp: latestClosedCandleTime,
          previousSignal: watcher.last_signal_data || null
        });

        if (dedupCheck.suppressed) {
          alertReason = dedupCheck.reason || "Suppressed by Signal Deduplication";
          console.log(`[Signal Deduplication] Suppressed Telegram alert for Watcher ID: ${watcher.id} (${selectedPair}): ${dedupCheck.reason}`);
        } else {
          const dispatchRes = await dispatchTradeAlert(telegramChatId, signal);
          alertSent = dispatchRes.sent;
          alertReason = dispatchRes.reason;
          if (alertSent) {
            addLog("Telegram Sent", "success");
            telegramMessagesSentCount++;
            console.log(`LOG: Telegram message sent successfully for Watcher ID: ${watcher.id} (${selectedPair})`);
          } else {
            console.error(`LOG ERROR: Telegram message blocked or failed for Watcher ID: ${watcher.id} (${selectedPair}): ${alertReason}`);
          }
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
          trade_reason: alertReason || (alertSent ? "Trade alert sent successfully on Telegram" : "Telegram message failed to send"),
          scan_duration_ms: scanDurationMs,
          gemini_duration_ms: geminiDuration,
          decision_snapshot: decisionSnapshot
        });

        // Save active trade state in Supabase:
        // trade_status = 'ACTIVE', active_trade_id = candidateTradeId, entry_price, stop_loss, take_profit, direction, opened_at
        console.log(`[ACTIVE UPDATE START] Attempting to update Watcher ID: ${watcher.id} to trade_status = ACTIVE with trade_id: ${candidateTradeId} in Supabase...`);
        const { data: activeUpdateRows, error: activeUpdateErr } = await supabase
          .from("watchers")
          .update({ 
            trade_status: 'ACTIVE',
            active_trade_id: candidateTradeId,
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

        addLog("Scan Completed", "success");
        // Save execution logs to Supabase
        await supabase.from('execution_logs').insert({
          watcher_id: watcher.id,
          user_id: userId,
          pair: selectedPair,
          run_time: new Date().toISOString(),
          logs: executionLogs,
          final_signal: analysis.signal,
          decision_score: decisionResult.decision_score,
          status: 'success'
        });

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

    try {
      await supabase.from('system_health_logs').insert({
        service: 'Cron',
        status: 'healthy',
        latency_ms: Date.now() - startTime,
        message: `Cron execution completed. Processed: ${watchersProcessedCount}`
      });
    } catch {
      // ignore logging failure
    }

    // Cleanup old logs (keep only last 500 runs)
    try {
      const { data: cutoffData } = await supabase
        .from('execution_logs')
        .select('run_time')
        .order('run_time', { ascending: false })
        .range(500, 500)
        .maybeSingle();

      if (cutoffData) {
        await supabase
          .from('execution_logs')
          .delete()
          .lt('run_time', cutoffData.run_time);
      }
    } catch (e) {
      console.error("Failed to cleanup old logs:", e);
    }

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

