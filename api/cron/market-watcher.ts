import { createClient } from '@supabase/supabase-js';
import { CronTimer } from '../../src/lib/cron-timer.js';
import { WatcherLogContext, logWatcherEvent, logWatcherError, logWatcherWarn, resolveWatcherUserContext, logWatcherStart, logWatcherResult, isDebugMode } from '../../src/lib/watcher-logger.js';
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
import { defaultEconomicEventService } from '../../src/lib/economic-event-service.js';
import { validateExecutionFreshness } from '../../src/lib/execution-freshness.js';
import { revalidatePreExecution } from '../../src/lib/pre-execution-validator.js';
import { calculateStructuralStopLoss, validateAndResolveStopLoss } from '../../src/lib/structural-stop-loss.js';
import { getBrokerProvider } from '../../src/lib/broker-factory.js';
import { recordEvaluation } from '../../src/lib/explainability-engine.js';
import { defaultMarketDataService, getMarketDataStats, getRequiredCandleCountForTimeframe } from '../../src/lib/market-data-service.js';
import { calculateHistoricalProbability, recordCompletedTrade } from '../../src/lib/learning-engine.js';
import { BrokerReconciliationService } from '../../src/lib/broker-reconciliation-service.js';
import { SafetyGovernor, defaultSafetyLimits } from '../../src/lib/safety-governor.js';
import { SupervisedMicrolotGovernor, DEFAULT_MICROLOT_LIMITS } from '../../src/lib/microlot-governor.js';
import { 
  BrokerAccount, 
  BrokerOrder, 
  BrokerPosition, 
  BrokerExecution, 
  BrokerPnL,
  BrokerQuote
} from '../../src/lib/broker-types.js';
import { RULE_WEIGHTS } from '../../src/lib/rule-weight-engine.js';
import { validateMarketDataIntegrity } from '../../src/lib/market-integrity.js';
import { normalizeConfidence } from '../../src/lib/confidence-engine.js';
import { evaluateQualityGate, calculateAdaptiveQualityRequirement, calculateConsecutiveLossesForWatcher } from '../../src/lib/quality-gate.js';
import { checkSignalDeduplication } from '../../src/lib/signal-deduplication.js';
import { resolveUserGeminiKey, classifyAndRedactGeminiError } from '../../src/lib/gemini-key-resolver.js';
import { executeBoundedGeminiCall, runGeminiRequest as runGeminiWrapperRequest, GEMINI_MARKET_WATCHER_MODEL } from '../../src/lib/geminiWrapper.js';
import { validateActiveTradeState, isWatcherDue } from '../../src/lib/trade-validator.js';
import { computeEquityAnalytics, deriveEquityState, fetchUserCompletedTrades } from '../../src/lib/equity-learning-engine.js';
import { evaluateRiskGovernor } from '../../src/lib/risk-governor.js';
import { evaluateAdaptiveLearning, fetchCompletedTradesForAdaptiveLearning } from '../../src/lib/adaptive-learning-engine.js';
import { evaluateAdaptiveExecution } from '../../src/lib/adaptive-execution-engine.js';
import { evaluateClosedLoopCalibration } from '../../src/lib/closed-loop-calibration-engine.js';
import { resolveAuthoritativeDecision, DecisionGateResult } from '../../src/lib/decision-attribution.js';
import { processWithConcurrency } from '../../src/lib/concurrency.js';
import { identifyMarkedZone, evaluateZoneState, isPriceInOrTappingZone, MarkedZone, ZoneEvaluationResult, evaluateZoneRejection } from '../../src/lib/zone-engine.js';

// In-memory runtime cache for marked zones to guarantee persistence across cron scans
// even if the Supabase watchers table is temporarily missing the zone columns.
const activeZonesMemoryMap: Map<string, MarkedZone> = (globalThis as any).__activeWatcherZones || new Map<string, MarkedZone>();
(globalThis as any).__activeWatcherZones = activeZonesMemoryMap;


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
    strategy_mode: compiledStrategy?.strategy_mode || 'RULE_ONLY',
    rule_weights_used: RULE_WEIGHTS,
    rule_details: decisionResult?.rule_details || []
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
    model: string = GEMINI_MARKET_WATCHER_MODEL,
    config?: any
) {
    return await runGeminiWrapperRequest(supabase, userId, prompt, model, config);
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
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  
  if (!url || !key) {
    throw new Error('Supabase configuration missing (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required)');
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
  const res = await defaultMarketDataService.validateSymbol(symbol);
  if (stats) {
    const glob = getMarketDataStats();
    stats.requests = glob.requests;
    stats.cacheHits = glob.cacheHits;
  }
  return res;
}

export async function fetchCurrentPrice(selectedPair: string, twelveDataKey: string, stats?: { requests: number; cacheHits: number }): Promise<number | null> {
  const res = await defaultMarketDataService.fetchCurrentPrice(selectedPair);
  if (stats) {
    const glob = getMarketDataStats();
    stats.requests = glob.requests;
    stats.cacheHits = glob.cacheHits;
  }
  return res;
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
    const startTime = Date.now();
    const cronTimer = new CronTimer({ warningThresholdMs: 25000, timeLimitMs: 30000 });

    // 1. Load Environment Variables
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    const twelveDataKey = process.env.TWELVE_DATA_API_KEY;
    const cronSecretRaw = process.env.CRON_SECRET;
    const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
    const liveTradingEnabled = process.env.LIVE_TRADING_ENABLED === 'true';

    // Safe Startup Validation (Debug Only)
    if (isDebugMode()) {
      console.log("DEBUG CONFIG:", {
        SUPABASE_URL_PRESENT: !!supabaseUrl,
        SUPABASE_KEY_PRESENT: !!supabaseKey,
        TWELVE_DATA_KEY_PRESENT: !!twelveDataKey,
        CRON_SECRET_PRESENT: !!cronSecretRaw,
        TELEGRAM_BOT_TOKEN_PRESENT: !!telegramBotToken,
        LIVE_TRADING_ENABLED: liveTradingEnabled
      });
    }

    if (!supabaseUrl) {
      console.error("[CRON ERROR] SUPABASE_URL_MISSING: The Supabase URL (SUPABASE_URL or VITE_SUPABASE_URL) is not set.");
      return res.status(500).json({ success: false, error: "SUPABASE_URL_MISSING" });
    }
    if (!supabaseKey) {
      console.error("[CRON ERROR] SUPABASE_KEY_MISSING: The Supabase key (SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY) is not set.");
      return res.status(500).json({ success: false, error: "SUPABASE_KEY_MISSING" });
    }
    
    // 2. Initialize Core Services Early (Stage 8 Scope Safety)
    const supabase = createClient(supabaseUrl, supabaseKey);
    const brokerProvider = getBrokerProvider();

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

    // === STAGE 8: GLOBAL KILL SWITCH ===
    if (process.env.GLOBAL_TRADING_ENABLED === 'false') {
      console.warn('[Stage 8 Kill Switch] GLOBAL_TRADING_ENABLED is false. Halting all operations.');
      return res.status(200).json({ success: true, message: "Global trading kill switch is ON. No operations performed." });
    }

    // === STAGE 8: RECONCILIATION HALT CHECK ===
    const { data: unresolvedAlerts } = await supabase
      .from('reconciliation_alerts')
      .select('id')
      .eq('is_resolved', false)
      .in('severity', ['CRITICAL', 'HIGH']);

    if (unresolvedAlerts && unresolvedAlerts.length > 0) {
      console.error(`[Stage 8 Halt] Found ${unresolvedAlerts.length} unresolved high-severity reconciliation alerts. HALTING TRADING.`);
      return res.status(200).json({ 
        success: false, 
        trading_state: 'RECONCILIATION_HALT',
        error: "Trading halted due to unresolved reconciliation discrepancies. Manual intervention required." 
      });
    }

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

    // Debug logging immediately before the authorization check
    if (isDebugMode()) {
      console.log("DEBUG CRON AUTH:", {
        method: req.method,
        authorization: req.headers.authorization || req.headers['authorization'] || null,
      });
    }

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

    // === STAGE 6 HARDENING: SAFETY GOVERNOR & RECONCILIATION ===
    const governor = new SafetyGovernor(defaultSafetyLimits);
    const reconService = new BrokerReconciliationService(brokerProvider, supabase);

    // Get current account state
    const brokerAccount = await brokerProvider.getAccount();
    
    // Global Kill Switch Check
    const globalHalt = await governor.checkGlobalSafety(brokerAccount, 0, 0); // Placeholder daily stats
    if (globalHalt.isHalted) {
      console.warn(`[SAFETY HALT] Trading is globally halted: ${globalHalt.reason}`);
      return res.status(200).json({ 
        success: true, 
        message: 'Trading globally halted', 
        reason: globalHalt.reason 
      });
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

    console.log(`[CRON] START | watchers=${watchers ? watchers.length : 0}`);
    cronTimer.setDiscoveredCount(watchers ? watchers.length : 0);
    
    if (!watchers || watchers.length === 0) {
      console.log(`[CRON] END | duration=${Date.now() - startTime}ms | processed=0 | signals=0 | errors=0`);
      cronTimer.printSummary();
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

    const userLastGeminiExecutionMap = new Map<string, number>();
    const activeUserGeminiPromises = new Map<string, Promise<void>>();
    const cronAnalysisCache = new Map<string, { geminiRes: any; geminiTextResult: string; parsedResult: any; analysis: any }>();
    const quotaExhaustedUsers = new Set<string>();

    const PROCESSING_DEADLINE_MS = 25000;
    const cronStartedAt = startTime;
    const processingDeadline = cronStartedAt + PROCESSING_DEADLINE_MS;

    function hasProcessingTimeRemaining(): boolean {
      return Date.now() < processingDeadline;
    }

    function remainingProcessingMs(): number {
      return Math.max(0, processingDeadline - Date.now());
    }

    let earlyExit = false;
    let earlyExitReason = "";
    let gemini503CountInCron = 0;
    let geminiTemporarilyUnavailable = false;

    const cronCandleCache = new Map<string, Promise<any>>();
    const cronPriceCache = new Map<string, Promise<number | null>>();
    const uniqueMarketDataKeysInCron = new Set<string>();
    let twelveDataRequestsInCron = 0;
    let twelveDataCacheHitsInCron = 0;
    let twelveDataDeduplicationsInCron = 0;
    let twelveDataTimeoutsInCron = 0;
    let twelveDataInvalidResponsesInCron = 0;
    let twelveDataStaleDataSkipsInCron = 0;

    async function fetchMarketDataForCron(reqArgs: any): Promise<any> {
      const canonical = toCanonicalSymbol(reqArgs.symbol);
      const cacheKey = `twelve-data:${canonical}:${reqArgs.timeframe}:${reqArgs.requiredCount}`;
      uniqueMarketDataKeysInCron.add(cacheKey);

      // Check cron processing deadline budget (5,000ms minimum)
      const remainingMs = remainingProcessingMs();
      if (remainingMs < 5000) {
        console.warn(`[CRON DEADLINE]\nStage: TWELVE_DATA\nAction: SKIP_REQUEST\nRemaining: ${remainingMs}ms`);
        return {
          isValid: false,
          candles: [],
          reason: 'CRON_DEADLINE_EXCEEDED',
          errorType: 'TEMPORARY_ERROR'
        };
      }

      if (cronCandleCache.has(cacheKey)) {
        twelveDataDeduplicationsInCron++;
        requestsSavedThroughCachingCount++;
        return cronCandleCache.get(cacheKey)!;
      }

      const promise = (async () => {
        const res = await defaultMarketDataService.getMarketData(reqArgs);
        if (res.fromCache) {
          twelveDataCacheHitsInCron++;
          requestsSavedThroughCachingCount++;
        } else if (res.isValid) {
          twelveDataRequestsInCron++;
          totalTwelveDataRequests++;
        } else {
          if (res.reason === 'TWELVE_DATA_TIMEOUT') twelveDataTimeoutsInCron++;
          if (res.reason === 'MARKET_DATA_INVALID' || res.reason === 'TWELVE_DATA_INVALID_RESPONSE') twelveDataInvalidResponsesInCron++;
          if (res.reason === 'TWELVE_DATA_STALE') twelveDataStaleDataSkipsInCron++;
          if (res.reason === 'TWELVE_DATA_RATE_LIMITED' || res.errorType === 'QUOTA_EXHAUSTED') watchersSkippedDueToRateLimitCount++;
        }
        return res;
      })();

      cronCandleCache.set(cacheKey, promise);
      return promise;
    }

    async function fetchCurrentPriceForCron(selectedPair: string, twelveDataKeyStr: string, stats?: any): Promise<number | null> {
      const canonical = toCanonicalSymbol(selectedPair);
      if (cronPriceCache.has(canonical)) {
        twelveDataCacheHitsInCron++;
        requestsSavedThroughCachingCount++;
        return cronPriceCache.get(canonical)!;
      }
      twelveDataRequestsInCron++;
      totalTwelveDataRequests++;
      const promise = fetchCurrentPrice(canonical, twelveDataKeyStr, stats);
      cronPriceCache.set(canonical, promise);
      return promise;
    }

    let watchersDiscoveredCount = watchers ? watchers.length : 0;
    let watchersDueCount = 0;
    let watchersEligibleCount = 0;
    let watchersSkippedByDeadlineCount = 0;
    let watchersSkippedByGeminiTimeoutCount = 0;
    let watchersSkippedByGemini429Count = 0;
    let watchersSkippedByGemini503Count = 0;
    let watchersSkippedByUserCooldownCount = 0;
    let watchersSkippedBecauseNoNewCandleCount = 0;
    let geminiCallsExecutedCount = 0;
    let geminiCallsRetriedCount = 0;
    let geminiCallsTimedOutCount = 0;
    let geminiCallsQuotaExhaustedCount = 0;
    let geminiCallsTemporarilyFailedCount = 0;
    let geminiCalls503Count = 0;
    let successfulGeminiExecutionsCount = 0;
    let geminiCallsDeduplicatedCount = 0;

    let watchersReadyCount = 0;
    let quotaWaitCount = 0;
    let invalidKeyCount = 0;
    let permissionErrorCount = 0;
    let invalidRequestCount = 0;
    let tempErrorCount = 0;
    let gemini503Count = 0;
    let gemini504Count = 0;
    let skippedDueToQuotaCount = 0;
    let geminiTimeoutsCount = 0;
    let geminiQuotaErrorsCount = 0;
    let geminiCallsSavedCount = 0;
    let geminiCallsSavedByPreFilterCount = 0;
    let watchersFilteredByDeterministicGateCount = 0;
    let watchersSkippedByGeminiFailureCount = 0;
    let signalsSuppressedAsDuplicatesCount = 0;
    let signalsSuppressedByMinSeparationCount = 0;

    // Prioritize watchers: 1) New/unanalyzed candles first, 2) Oldest last scan first
    if (watchers && watchers.length > 0) {
      watchers.sort((a, b) => {
        const aCandle = a.last_analyzed_closed_candle_time || '';
        const bCandle = b.last_analyzed_closed_candle_time || '';
        if (!aCandle && bCandle) return -1;
        if (aCandle && !bCandle) return 1;

        const aScan = a.last_scan_at ? new Date(a.last_scan_at).getTime() : 0;
        const bScan = b.last_scan_at ? new Date(b.last_scan_at).getTime() : 0;
        return aScan - bScan;
      });
    }

    if (isDebugMode()) {
      console.log(`LOG: Processing ${watchers.length} active watcher(s) sequentially with strict 25s global deadline...`);
    }

    async function processSingleWatcher(watcher: any) {
      let isWatcherSkipped = true;
      let geminiInvoked = false;
      let geminiSucceeded = false;
      let geminiDecision: 'BUY' | 'SELL' | 'NO_TRADE' | null = null;

      const userId = watcher?.user_id || 'unknown';
      const logCtx = await resolveWatcherUserContext(supabase, watcher);
      const userEmail = logCtx.userEmail;
      const selectedPair = toCanonicalSymbol(watcher?.selected_pair || "") || watcher?.selected_pair || 'unknown';
      const symbol = selectedPair;
      const selectedTimeframe = logCtx.timeframe;

      // 1. GLOBAL DEADLINE CHECK (PROCESSING_DEADLINE_MS = 25000)
      const elapsedAtStart = Date.now() - startTime;
      const remainingGlobalAtStart = PROCESSING_DEADLINE_MS - elapsedAtStart;
      if (remainingGlobalAtStart <= 1000) {
        console.warn(`[CRON DEADLINE] Watcher ${watcher?.id} (${selectedPair}) skipped safely. Reason: Insufficient global execution budget (${remainingGlobalAtStart}ms remaining / ${PROCESSING_DEADLINE_MS}ms limit).`);
        cronTimer.markEarlyExit();
        watchersSkippedByDeadlineCount++;
        watchersSkippedCount++;
        skipped.push({ userId, reason: `Insufficient global execution budget (CRON DEADLINE: ${remainingGlobalAtStart}ms remaining)` });
        return;
      }

      cronTimer.startWatcher({
        userEmail,
        watcherId: watcher?.id || 'unknown',
        pair: selectedPair,
        timeframe: selectedTimeframe
      });

      try {
        cronTimer.startStage("Context & Profile Verification", watcher?.id);

        if (!watcher || watcher.status !== 'active') {
          console.log(`LOG: Watcher ${watcher?.id} skipped - Status is '${watcher?.status}' (not active)`);
          skipped.push({ userId: watcher?.user_id || 'unknown', reason: `Watcher status is ${watcher?.status || 'stopped/deleted'}` });
          watchersSkippedCount++;
          return;
        }

        // Query user profile safely for gemini status
        let userProfile: any = null;
        try {
          const { data: pData } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", userId)
            .maybeSingle();
          userProfile = pData || null;
        } catch (err) {
          // Safe profile query fallback
        }

        logWatcherEvent('WATCHER START', logCtx, `Status: ${watcher.status}`);

        const { data: telegramConn } = await supabase
          .from("telegram_connections")
          .select("telegram_chat_id, connected")
          .eq("user_id", userId)
          .maybeSingle();
        const telegramChatId = (telegramConn && telegramConn.connected) ? telegramConn.telegram_chat_id : (watcher.telegram_chat_id || null);

        watchersReadyCount++;

        cronTimer.startStage("Watcher Scheduling & Due Check");
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

      logWatcherEvent('Watcher Scheduling', logCtx, {
        'Last Scan': lastScanDate ? lastScanDate.toISOString() : 'NULL',
        'Next Eligible': nextScanDate ? nextScanDate.toISOString() : 'NOW',
        'Current Time': now.toISOString(),
        'Grace Window': `${SCAN_DUE_GRACE_MS} ms`,
        'Due': isDue ? 'YES' : 'NO',
        'Reason': dueReason,
        'Database Trade Status': watcher.trade_status,
        'Cooldown Until': cooldownUntilStr
      });

      if (!isDue) {
        logWatcherEvent('SIGNAL SKIPPED', logCtx, `Not due yet (${dueReason})`);
        console.log(`[WATCHER SKIP] ${selectedPair} (${selectedTimeframe}) not due yet | interval=${scanIntervalMinutes}m | nextScan=${nextScanDate ? nextScanDate.toISOString() : 'unknown'}`);
        skipped.push({ userId, reason: `Not due yet (${dueReason})` });
        watchersSkippedCount++;
        return;
      }
      watchersDueCount++;

      if (!selectedPair || selectedPair === 'unknown') {
        logWatcherEvent('SIGNAL SKIPPED', logCtx, 'No selected pair');
        skipped.push({ userId, reason: "No selected pair" });
        watchersSkippedCount++;
        return;
      }

      // =====================================================================
      // STAGE 5 IDEMPOTENCY LOCK: CAS update on last_scan_at
      // =====================================================================
      cronTimer.startStage("CAS Idempotency Lock");
      const lockTime = now.toISOString();
      let lockQuery = supabase.from("watchers").update({ last_scan_at: lockTime }).eq("id", watcher.id);
      if (watcher.last_scan_at) {
        lockQuery = lockQuery.eq("last_scan_at", watcher.last_scan_at);
      } else {
        lockQuery = lockQuery.is("last_scan_at", null);
      }
      
      const { data: lockedData, error: lockErr } = await lockQuery.select();
      if (lockErr || !lockedData || lockedData.length === 0) {
        console.log(`[Idempotency] Watcher ${watcher.id} already being processed by another cron. Skipping.`);
        skipped.push({ userId, reason: "Duplicate execution protected" });
        watchersSkippedCount++;
        return;
      }

      watchersEligibleCount++;


      // =====================================================================
      // STATE 3 — COOLDOWN
      // =====================================================================
      if (tradeStatus === 'COOLDOWN') {
        cronTimer.startStage("State 3 - Cooldown Check");
        const cooldownUntilDate = watcher.cooldown_until ? new Date(watcher.cooldown_until) : null;
        const isCooldownExpired = !cooldownUntilDate || (now.getTime() >= cooldownUntilDate.getTime());

        if (!isCooldownExpired) {
          const remainingMs = cooldownUntilDate ? (cooldownUntilDate.getTime() - now.getTime()) : 0;
          const remainingMin = Math.ceil(remainingMs / (1000 * 60));

          logWatcherEvent('LOSS COOLDOWN', logCtx, {
            'State': 'ACTIVE_COOLDOWN',
            'Current Time': now.toISOString(),
            'Cooldown Until': cooldownUntilDate ? cooldownUntilDate.toISOString() : 'NULL',
            'Remaining': `${remainingMin} minute(s)`
          });

          watchersProcessedCount++;
          isWatcherSkipped = false;
          results.push({ userId, symbol, tradeStatus: 'COOLDOWN', result: 'In cooldown' });
          return;
        }

        // If TRUE (expired): Clear all previous trade fields and reset to WAITING
        logWatcherEvent('LOSS COOLDOWN', logCtx, 'Cooldown expired. Resetting trade fields and setting trade_status = WAITING');
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
            zone_data: null,
            zone_status: 'NO_ZONE',
            zone_high: null,
            zone_low: null,
            zone_type: null,
            zone_invalidation_level: null,
            zone_marked_at: null,
            zone_tapped_at: null,
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
        isWatcherSkipped = false;
        results.push({ userId, symbol, tradeStatus: 'COOLDOWN', result: 'Cooldown expired, reset to WAITING' });
        return;
      }

      // =====================================================================
      // STATE 2 — ACTIVE TRADE
      // =====================================================================
      console.log(`ENTERING ACTIVE`);
      if (tradeStatus === 'ACTIVE') {
        cronTimer.startStage("State 2 - Active Trade Monitoring");
        console.log(`[BRANCH EXECUTED] ACTIVE branch (Price Monitoring Only) for Watcher ID: ${watcher.id}`);

        const activeValidation = validateActiveTradeState(watcher);
        if (!activeValidation.valid) {
          let currentPriceFetch: number | null = null;
          try {
            currentPriceFetch = await fetchCurrentPriceForCron(selectedPair, twelveDataKey, tdStats);
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
          return;
        }

        logWatcherEvent('TRADE RECONCILIATION', logCtx, `Monitoring active trade for ${selectedPair}`);

        const entryPrice = watcher.entry_price ? parseFloat(String(watcher.entry_price)) : null;
        const stopLoss = watcher.stop_loss ? parseFloat(String(watcher.stop_loss)) : null;
        const takeProfit = watcher.take_profit ? parseFloat(String(watcher.take_profit)) : null;
        const dir = (watcher.direction || '').toUpperCase().trim();
        const isBuy = dir === 'BUY' || dir === 'LONG';
        const isSell = dir === 'SELL' || dir === 'SHORT';

        // === STAGE 6 HARDENING: BROKER RECONCILIATION ===
        if (watcher.active_trade_id) {
          const brokerPos = await brokerProvider.getPosition(selectedPair);
          
          if (!brokerPos) {
            logWatcherWarn('TRADE RECONCILIATION', logCtx, `Active trade ${watcher.active_trade_id} not found at broker. Closing in DB.`);
            
            // Fetch execution history to find close price and PnL
            const history = await brokerProvider.getExecutionHistory(selectedPair, 5);
            const closeExecution = history.find(e => e.orderId === watcher.active_trade_id || e.symbol === selectedPair); // Simplified match
            const closePrice = closeExecution?.price || 0;
            const pnl = await brokerProvider.getTradePnL(watcher.active_trade_id);

            await recordCompletedTrade(supabase, {
              user_id: userId,
              watcher_id: watcher.id,
              trade_id: watcher.active_trade_id,
              pair: selectedPair,
              timeframe: selectedTimeframe,
              strategy_mode: watcher.strategy_mode || 'HYBRID',
              entry_price: entryPrice || 0,
              exit_price: closePrice,
              direction: dir,
              opened_at: watcher.opened_at || new Date().toISOString(),
              closed_at: new Date().toISOString(),
              outcome: pnl ? (pnl.netPnL > 0 ? 'BROKER_REALIZED_WIN' : 'BROKER_REALIZED_LOSS') : 'BREAKEVEN',
              outcome_source: 'BROKER_RECONCILIATION',
              gross_pnl: pnl?.grossPnL,
              net_pnl: pnl?.netPnL,
              commission: pnl?.commission,
              swap: pnl?.swap,
              slippage_pips: pnl?.slippage,
              fees: pnl?.fees,
              realized_r: pnl?.realizedR
            });

            await supabase.from("watchers").update({
              trade_status: 'COOLDOWN',
              active_trade_id: null,
              closed_at: new Date().toISOString(),
              cooldown_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour cooldown
              updated_at: new Date().toISOString()
            }).eq("id", watcher.id);

            if (telegramChatId) {
              await sendTelegramMessage(telegramChatId, `🔔 Broker Reconciliation\nTrade for ${selectedPair} was closed at broker. Database synchronized.`);
            }

            return;
          } else {
            logWatcherEvent('TRADE RECONCILIATION', logCtx, `Trade confirmed at broker: ${watcher.active_trade_id}`);
          }
        }

        // telegramChatId already available from loop start

        // Fetch ONLY the latest market price from Twelve Data
        let currentPrice: number | null = null;
        if (twelveDataExhausted) {
          logWatcherWarn('LIVE RATES ERROR', logCtx, 'TwelveData rate limit (429) exhausted. Deferring until next cron cycle.');
          skipped.push({ userId, reason: "TwelveData rate limit (429) exhausted" });
          watchersSkippedDueToRateLimitCount++;
          watchersSkippedCount++;
          return;
        }
        try {
          currentPrice = await fetchCurrentPriceForCron(selectedPair, twelveDataKey, tdStats);
        } catch (err: any) {
          if (err.message && err.message.includes("429")) {
            twelveDataExhausted = true;
            logWatcherWarn('LIVE RATES ERROR', logCtx, 'TwelveData rate limit (429) exhausted. Deferring until next cron cycle.');
            skipped.push({ userId, reason: "TwelveData rate limit (429) exhausted" });
            watchersSkippedDueToRateLimitCount++;
            watchersSkippedCount++;
            return;
          }
          logWatcherError('LIVE RATES ERROR', logCtx, err);
        }

        if (currentPrice === null) {
          logWatcherWarn('LIVE RATES', logCtx, 'Could not fetch current price for active trade check.');
          skipped.push({ userId, reason: "Failed to fetch current price for active trade" });
          watchersSkippedCount++;
          return;
        }

        logWatcherEvent('LIVE RATES', logCtx, {
          'Current Price': currentPrice,
          'Entry Price': entryPrice,
          'Stop Loss': stopLoss,
          'Take Profit': takeProfit,
          'Direction': dir
        });

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
          isWatcherSkipped = false;
          results.push({ userId, symbol, tradeStatus: 'ACTIVE', result: 'Holding' });
          console.log(`ACTIVE branch exited.`);
          return;
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
            outcome: 'WIN',
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
          isWatcherSkipped = false;
          results.push({ userId, symbol, tradeStatus: 'COOLDOWN', result: 'Closed TP' });
          console.log(`ACTIVE branch exited.`);
          return;
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
            outcome: 'LOSS',
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

          // Transition to COOLDOWN (4 hours for STOP_LOSS / LOSS)
          const cooldownUntilSl = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
          console.log(`[LOSS COOLDOWN] Watcher ${watcher.id} entered 4-hour cooldown after STOP_LOSS.`);

          const { data: slCooldownData, error: slCooldownErr } = await supabase
            .from("watchers")
            .update({
              trade_status: 'COOLDOWN',
              active_trade_id: null,
              closed_at: new Date().toISOString(),
              cooldown_until: cooldownUntilSl,
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
          isWatcherSkipped = false;
          results.push({ userId, symbol, tradeStatus: 'COOLDOWN', result: 'Closed SL' });
          console.log(`ACTIVE branch exited.`);
          return;
        }

        console.log(`ACTIVE branch exited.`);
        return;
      }

      // =====================================================================
      // STATE 1 — WAITING
      // =====================================================================
      console.log(`ENTERING WAITING`);
      if (tradeStatus !== 'WAITING') {
        console.warn(`[STATE GUARD] Watcher ID: ${watcher.id} is in status '${tradeStatus}' (not WAITING). Bypassing signal generation.`);
        return;
      }

      cronTimer.startStage("State 1 - Load Preferences & Strategy");
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
          return;
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
          return;
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
          return;
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
          return;
        }

        // Candle Data Downloaded via MarketDataGateway
        const mappedSymbol = toDisplaySymbol(selectedPair);

        let quoteData: any = null;
        let candleData: Candle[] = [];

        if (twelveDataExhausted) {
          console.warn(`[Twelve Data Rate Limit] Watcher ${watcher.id} skipped due to quota exhaustion cooldown. Deferring until next cron cycle.`);
          skipped.push({ userId, reason: "TwelveData rate limit / quota exhausted" });
          watchersSkippedDueToRateLimitCount++;
          watchersSkippedCount++;
          return;
        }

        const requiredCandles = getRequiredCandleCountForTimeframe(selectedTimeframe);
        const tsResult = await fetchMarketDataForCron({
          symbol: mappedSymbol,
          timeframe: selectedTimeframe,
          requiredCount: requiredCandles,
          watcherId: watcher.id,
          userId: userId,
          purpose: 'Cron Market Watcher Scan'
        });
        
        const glob = getMarketDataStats();
        tdStats.requests = glob.requests;
        tdStats.cacheHits = glob.cacheHits;

        if (!tsResult.isValid) {
          if (tsResult.errorType === 'QUOTA_EXHAUSTED' || tsResult.reason === 'MARKET_DATA_PROVIDER_QUOTA_EXHAUSTED' || tsResult.reason?.includes("RATE_LIMITED") || tsResult.reason?.includes("429")) {
            twelveDataExhausted = true;
            console.warn(`[Twelve Data Rate Limit] Watcher ${watcher.id} skipped due to MARKET_DATA_PROVIDER_QUOTA_EXHAUSTED.`);
            skipped.push({ userId, reason: "MARKET_DATA_PROVIDER_QUOTA_EXHAUSTED" });
            watchersSkippedDueToRateLimitCount++;
            watchersSkippedCount++;
            return;
          } else {
            console.warn(`[Twelve Data API] error for ${mappedSymbol}: ${tsResult.reason}`);
          }
        } else {
          addLog("Candle Downloaded", "success");
          candleData = tsResult.candles || [];
          if (candleData.length > 0) {
            quoteData = candleData[candleData.length - 1];
          }
        }

        if (twelveDataExhausted) {
          console.warn(`[Twelve Data Rate Limit] Watcher ${watcher.id} skipped due to quota exhaustion. Deferring until next cron cycle.`);
          skipped.push({ userId, reason: "MARKET_DATA_PROVIDER_QUOTA_EXHAUSTED" });
          watchersSkippedDueToRateLimitCount++;
          watchersSkippedCount++;
          return;
        }

        if (candleData.length < 2) {
           console.log(`LOG: Watcher ${watcher.id} skipped - Candle data downloaded: NO (insufficient data)`);
           skipped.push({ userId, reason: "Insufficient market data." });
           watchersSkippedCount++;
           return;
        }
        console.log(`LOG: Candle data downloaded for ${selectedPair}: YES (${candleData.length} candles${tsResult.fromCache ? ', fromCache: true' : ''})`);

        // Phase 2 & 3: Timeframe Logic & New Candle Check
        const latestClosedCandle = candleData[candleData.length - 2] || candleData[candleData.length - 1];
        const latestClosedCandleTime = String(latestClosedCandle?.timestamp || '');
        const lastAnalyzedTime = watcher.last_analyzed_closed_candle_time || '';
        const isNewCandle = latestClosedCandleTime && latestClosedCandleTime !== lastAnalyzedTime;

        if (!isNewCandle) {
          console.log(`[Timeframe Logic] Watcher ${watcher.id} skipped - Same candle already analyzed (${latestClosedCandleTime}). Exiting.`);
          skipped.push({ userId, reason: "Same candle already analyzed (no new closed candle)" });
          watchersSkippedBecauseNoNewCandleCount++;
          watchersSkippedCount++;
          return;
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

          return;
        }

        // Extract market structure & compile strategy
        addLog("Strategy Compiled", "success");
        cronTimer.startStage("Market Structure & Strategy Compilation");
        const compiledStrategy = compileStrategy(strategyText);
        const strategyCompilationConfidenceRecord = normalizeConfidence(
          compiledStrategy.overall_confidence ?? compiledStrategy.confidence,
          'strategy_compilation',
          'Strategy Compiler'
        );
        const strategyCompilationConfidence = strategyCompilationConfidenceRecord.normalized;

        const marketStructure = extractMarketStructure(candleData, compiledStrategy.detector_validation?.supported_detectors);

        // =====================================================================
        // STATEFUL ZONE MARKOUT & TAP CONFIRMATION LIFECYCLE
        // =====================================================================
        cronTimer.startStage("Stateful Zone Evaluation");
        const latestCandle = candleData[candleData.length - 1];
        const activeCurrentPrice = latestCandle?.close || 0;

        let currentZone: MarkedZone | null = null;
        if (watcher.zone_data) {
          try {
            currentZone = typeof watcher.zone_data === 'string' ? JSON.parse(watcher.zone_data) : watcher.zone_data;
          } catch (e) {
            currentZone = null;
          }
        }
        // Restore from runtime memory cache if not present in database record
        if (!currentZone && activeZonesMemoryMap.has(watcher.id)) {
          currentZone = activeZonesMemoryMap.get(watcher.id) || null;
          if (currentZone) {
            console.log(`[ZONE MEMORY RESTORE] Watcher ID: ${watcher.id}: Retained active ${currentZone.type} zone [${currentZone.low} - ${currentZone.high}] (${currentZone.direction}) from runtime memory.`);
          }
        }

        let lastZoneEval: ZoneEvaluationResult | null = null;

        // 1. If an active zone already exists, evaluate its state
        if (currentZone && currentZone.status !== 'INVALIDATED') {
          const zoneEval = evaluateZoneState(currentZone, latestClosedCandle, activeCurrentPrice, marketStructure.volatilityInformation?.atr, candleData, marketStructure);
          lastZoneEval = zoneEval;

          if (zoneEval.isInvalidated) {
            console.log(`[ZONE INVALIDATED] Watcher ID: ${watcher.id} (${selectedPair}) marked zone [${currentZone.low} - ${currentZone.high}] (${currentZone.type}) invalidated: ${zoneEval.reason}. Clearing zone.`);
            logWatcherEvent('ZONE INVALIDATED', logCtx, {
              'Zone Type': currentZone.type,
              'Zone High': currentZone.high,
              'Zone Low': currentZone.low,
              'Invalidation Level': currentZone.invalidationLevel,
              'Reason': zoneEval.reason
            });

            activeZonesMemoryMap.delete(watcher.id);
            const { error: invalidErr } = await supabase.from("watchers").update({
              zone_data: null,
              zone_status: 'NO_ZONE',
              zone_high: null,
              zone_low: null,
              zone_type: null,
              zone_invalidation_level: null,
              updated_at: new Date().toISOString()
            }).eq("id", watcher.id);

            if (invalidErr && invalidErr.message?.includes('zone_')) {
              await supabase.from("watchers").update({
                updated_at: new Date().toISOString()
              }).eq("id", watcher.id);
            }

            currentZone = null; // Cleared, allows discovering fresh zone below
          } else if (!zoneEval.isTapped) {
            // Zone is intact, but price has NOT tapped the zone yet.
            // Preserves 100% of Gemini API quota and halts scan cleanly!
            console.log(`[WAITING FOR ZONE TAP] Watcher ID: ${watcher.id} (${selectedPair}): Price ${activeCurrentPrice} is outside marked zone [${currentZone.low} - ${currentZone.high}] (${currentZone.type} ${currentZone.direction}). Bypassing AI evaluation.`);
            logWatcherEvent('WAITING FOR ZONE TAP', logCtx, {
              'Zone Type': currentZone.type,
              'Direction': currentZone.direction,
              'Zone Bounds': `[${currentZone.low} - ${currentZone.high}]`,
              'Current Price': activeCurrentPrice,
              'Invalidation Level': currentZone.invalidationLevel,
              'Action': 'WAITING_FOR_PRICE_TO_REACH_ZONE'
            });

            const scanDurationMs = Date.now() - scanStart;
            await recordEvaluation(supabase, {
              user_id: userId,
              watcher_id: watcher.id,
              pair: selectedPair,
              timeframe: selectedTimeframe,
              strategy_mode: compiledStrategy.strategy_mode,
              decision_score: 0,
              matched_weight: 0,
              possible_weight: 0,
              recommendation: 'FAIL',
              mandatory_rules_passed: false,
              matched_rules: [],
              failed_rules: [`Price ${activeCurrentPrice} has not reached marked ${currentZone.type} zone [${currentZone.low} - ${currentZone.high}]`],
              gemini_used: false,
              trade_sent: false,
              trade_reason: `Waiting for price to enter marked ${currentZone.type} zone [${currentZone.low} - ${currentZone.high}]. AI confirmation bypassed.`,
              scan_duration_ms: scanDurationMs,
              decision_snapshot: null
            });

            currentZone = zoneEval.updatedZone;
            activeZonesMemoryMap.set(watcher.id, currentZone);

            const { error: waitErr } = await supabase
              .from("watchers")
              .update({
                zone_data: currentZone,
                zone_status: 'WAITING_FOR_TAP',
                zone_tapped_at: null,
                last_scan_at: new Date().toISOString(),
                last_analyzed_closed_candle_time: latestClosedCandleTime,
                updated_at: new Date().toISOString()
              })
              .eq("id", watcher.id);

            if (waitErr && waitErr.message?.includes('zone_')) {
              await supabase
                .from("watchers")
                .update({
                  last_scan_at: new Date().toISOString(),
                  last_analyzed_closed_candle_time: latestClosedCandleTime,
                  updated_at: new Date().toISOString()
                })
                .eq("id", watcher.id);
            }

            watchersProcessedCount++;
            isWatcherSkipped = false;
            results.push({ userId, symbol, tradeStatus: 'WAITING_FOR_TAP', result: 'Waiting for zone tap' });
            return;
          } else {
            // Zone is TAPPED!
            console.log(`[ZONE TAPPED] Watcher ID: ${watcher.id} (${selectedPair}): Price ${activeCurrentPrice} tapped marked zone [${currentZone.low} - ${currentZone.high}] (${currentZone.type}). Proceeding to confirmation analysis.`);
            logWatcherEvent('ZONE TAPPED', logCtx, {
              'Zone Type': currentZone.type,
              'Zone Bounds': `[${currentZone.low} - ${currentZone.high}]`,
              'Tapped Price': activeCurrentPrice,
              'Action': 'RUNNING_CONFIRMATION_ANALYSIS'
            });

            currentZone = zoneEval.updatedZone;
            activeZonesMemoryMap.set(watcher.id, currentZone);
            const { error: tapErr } = await supabase.from("watchers").update({
              zone_data: currentZone,
              zone_status: currentZone.status,
              zone_tapped_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }).eq("id", watcher.id);

            if (tapErr && tapErr.message?.includes('zone_')) {
              await supabase.from("watchers").update({
                updated_at: new Date().toISOString()
              }).eq("id", watcher.id);
            }
          }
        }

        // 2. If NO active zone exists, identify and mark a fresh high-quality structural zone
        if (!currentZone) {
          const discoveredZone = identifyMarkedZone(candleData, marketStructure, compiledStrategy, activeCurrentPrice);

          if (discoveredZone) {
            console.log(`[ZONE MARKED] Watcher ID: ${watcher.id} (${selectedPair}): Identified fresh ${discoveredZone.type} (${discoveredZone.direction}) [${discoveredZone.low} - ${discoveredZone.high}], Invalidation: ${discoveredZone.invalidationLevel}.`);
            logWatcherEvent('ZONE MARKED', logCtx, {
              'Zone ID': discoveredZone.id,
              'Zone Type': discoveredZone.type,
              'Direction': discoveredZone.direction,
              'Zone Bounds': `[${discoveredZone.low} - ${discoveredZone.high}]`,
              'Invalidation Level': discoveredZone.invalidationLevel,
              'Reasoning': discoveredZone.reasoning
            });

            discoveredZone.status = 'WAITING_FOR_TAP';
            discoveredZone.tapCount = 0;
            discoveredZone.tappedAt = null;

            activeZonesMemoryMap.set(watcher.id, discoveredZone);
            const { error: markErr } = await supabase.from("watchers").update({
              zone_data: discoveredZone,
              zone_status: 'WAITING_FOR_TAP',
              zone_high: discoveredZone.high,
              zone_low: discoveredZone.low,
              zone_type: discoveredZone.type,
              zone_invalidation_level: discoveredZone.invalidationLevel,
              zone_marked_at: new Date().toISOString(),
              zone_tapped_at: null,
              updated_at: new Date().toISOString()
            }).eq("id", watcher.id);

            if (markErr && markErr.message?.includes('zone_')) {
              console.warn(`[Watcher Zone DB Notice] Notice: 'zone_data' columns missing in Supabase 'watchers' table (${markErr.message}). Zone stored in active server memory.`);
              await supabase.from("watchers").update({
                updated_at: new Date().toISOString()
              }).eq("id", watcher.id);
            }

            console.log(`[WAITING FOR ZONE TAP] Watcher ID: ${watcher.id} (${selectedPair}): Freshly marked zone [${discoveredZone.low} - ${discoveredZone.high}] (${discoveredZone.type} ${discoveredZone.direction}) waiting for price tap. Bypassing AI evaluation.`);
            const scanDurationMs = Date.now() - scanStart;
            await recordEvaluation(supabase, {
              user_id: userId,
              watcher_id: watcher.id,
              pair: selectedPair,
              timeframe: selectedTimeframe,
              strategy_mode: compiledStrategy.strategy_mode,
              decision_score: 0,
              matched_weight: 0,
              possible_weight: 0,
              recommendation: 'FAIL',
              mandatory_rules_passed: false,
              matched_rules: [],
              failed_rules: [`Newly marked zone [${discoveredZone.low} - ${discoveredZone.high}] waiting for price tap`],
              gemini_used: false,
              trade_sent: false,
              trade_reason: `Marked ${discoveredZone.type} zone [${discoveredZone.low} - ${discoveredZone.high}]. Waiting for price tap before AI confirmation.`,
              scan_duration_ms: scanDurationMs,
              decision_snapshot: null
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
            isWatcherSkipped = false;
            results.push({ userId, symbol, tradeStatus: 'WAITING_FOR_TAP', result: 'Zone marked, waiting for tap' });
            return;
          } else {
            console.log(`[ZONE SEARCH] Watcher ID: ${watcher.id} (${selectedPair}): No distinct structural POI/Zone identified in current market structure. Waiting for new structural formation.`);
            logWatcherEvent('ZONE SEARCH', logCtx, 'No high-quality structural POI/Zone identified in current candles.');
          }
        }

        // Stage 2
        const cleanSymUpper = (selectedPair || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const pipSize = (cleanSymUpper.includes('JPY') || cleanSymUpper.includes('XAU') || cleanSymUpper.includes('GOLD')) ? 0.01 : 0.0001;

        // Run Weighted Decision Engine (Pass 1 to get matched rules)
        cronTimer.startStage("Decision Engine Evaluation");
        (marketStructure as any).pair = selectedPair;
        (marketStructure as any).timeframe = selectedTimeframe;
        (marketStructure as any).lastClosedCandleTimestamp = candleData[candleData.length - 2]?.timestamp || '';
        (marketStructure as any).markedZone = currentZone;
        (marketStructure as any).zone_status = currentZone?.status || 'NO_ZONE';
        (marketStructure as any).zone_tapped = Boolean(currentZone && (currentZone.status === 'ZONE_TAPPED' || currentZone.status === 'CONFIRMED' || lastZoneEval?.isTapped));
        (marketStructure as any).zone_rejected = Boolean(lastZoneEval?.isRejected || currentZone?.status === 'CONFIRMED');
        (marketStructure as any).rejectionConfirmed = Boolean(lastZoneEval?.isRejected || currentZone?.status === 'CONFIRMED');
        (marketStructure as any).zone_direction = currentZone?.direction;
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

        // Attach watcher metadata for diagnostic logging
        marketStructure.watcherId = watcher.id;
        marketStructure.pair = selectedPair;
        marketStructure.timeframe = selectedTimeframe;

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
        let geminiRes: any = null;
        let geminiDirection = 'NO_TRADE';
        let geminiCalled = false;
        let geminiTextResult = "";
        let geminiStart = 0;
        let geminiDuration = 0;
        let requiresGemini = false;
        let usedFallback = false;
        let fallbackReason = '';

        const recommendation = decisionResult.recommendation; // PASS, LIKELY_PASS, AMBIGUOUS, FAIL
        const executionMode = watcher.strategy_mode || compiledStrategy.detector_validation?.execution_mode || compiledStrategy.strategy_mode || 'RULE_ONLY';

        // =====================================================================
        // DETERMINISTIC PRE-FILTERING GATE (STAGE 2)
        // =====================================================================
        // Only setups that satisfy mandatory rules, meet the quality score (>= 70%),
        // and possess a viable deterministic recommendation (PASS or LIKELY_PASS)
        // are allowed to invoke the Gemini AI Gate. All non-viable setups immediately
        // resolve locally as NO_TRADE without calling the Gemini API.
        // This preserves 100% of the Gemini free-tier RPM quota and cuts cron latency.
        const PRE_FILTER_MIN_SCORE = 75;
        const mandatoryPassed = decisionResult.mandatory_rules_passed !== false;
        const meetsQualityThreshold = (decisionResult.decision_score ?? 0) >= PRE_FILTER_MIN_SCORE;
        const isViableRecommendation = recommendation === 'PASS' || recommendation === 'LIKELY_PASS';
        const isExplicitAiOnly = executionMode === 'AI_ONLY' && (decisionResult.decision_score ?? 0) >= 60;

        const passesDeterministicGate = mandatoryPassed && (
          (meetsQualityThreshold && isViableRecommendation) || isExplicitAiOnly
        );

        if (!passesDeterministicGate) {
          console.log(`
[DETERMINISTIC PRE-FILTER GATE: REJECTED (NO_TRADE)]
Watcher ID: ${watcher.id}
Pair: ${selectedPair}
Timeframe: ${selectedTimeframe}
Strategy Mode: ${compiledStrategy.strategy_mode || 'HYBRID'}
Decision Score: ${decisionResult.decision_score.toFixed(1)}% (Threshold: >= ${PRE_FILTER_MIN_SCORE}%)
Recommendation: ${recommendation}
Mandatory Rules Passed: ${mandatoryPassed}
Failed Mandatory: ${decisionResult.failed_mandatory_rules?.join(', ') || 'None'}
Action: LOCAL_NO_TRADE (Gemini API Bypassed - Quota 100% Preserved)
`.trim());

          analysis.signal = 'NO_TRADE';
          analysis.confidence = 0;
          analysis.reasoning = [
            decisionResult.no_trade_reason ||
            decisionResult.explanation ||
            `Deterministic pre-filter rejected setup: Score ${decisionResult.decision_score}% is below ${PRE_FILTER_MIN_SCORE}% threshold or recommendation is ${recommendation}.`
          ];

          geminiCallsSavedCount++;
          geminiCallsSavedByPreFilterCount++;
          watchersFilteredByDeterministicGateCount++;

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
            recommendation: recommendation,
            mandatory_rules_passed: decisionResult.mandatory_rules_passed,
            matched_rules: decisionResult.matched_rules,
            failed_rules: decisionResult.failed_rules,
            gemini_used: false,
            trade_sent: false,
            trade_reason: `Deterministic Pre-Filter Gate: Setup filtered out before Gemini (${decisionResult.explanation || 'Score below 70% threshold'})`,
            scan_duration_ms: scanDurationMs,
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
          isWatcherSkipped = false;
          results.push({ userId, symbol, tradeStatus: 'WAITING', result: 'Pre-filtered NO_TRADE' });
          return;
        }

        console.log(`
[DETERMINISTIC PRE-FILTER GATE: PASSED]
Watcher ID: ${watcher.id}
Pair: ${selectedPair}
Timeframe: ${selectedTimeframe}
Strategy Mode: ${compiledStrategy.strategy_mode || 'HYBRID'}
Decision Score: ${decisionResult.decision_score.toFixed(1)}%
Recommendation: ${recommendation}
Action: PROCEED_TO_EXECUTION_GATE
`.trim());

        // For setups passing deterministic pre-filter:
        // RULE_ONLY mode executes local rule engine without Gemini.
        // HYBRID or other AI modes proceed to the Gemini AI Gate.
        requiresGemini = (executionMode !== 'RULE_ONLY');

        if (!requiresGemini) {
          console.log(`[Gemini Routing] Watcher: ${watcher.id} | Strategy Mode: ${compiledStrategy.strategy_mode || 'RULE_ONLY'} | Gemini Required: NO | Gemini Check: SKIPPED`);
          if (userProfile?.gemini_status && userProfile.gemini_status !== 'READY') {
            console.log(`[Gemini Isolation] RULE_ONLY watcher bypassed user Gemini status gate`);
          }
        } else {
          console.log(`[Gemini Routing] Watcher: ${watcher.id} | Strategy Mode: ${compiledStrategy.strategy_mode || 'HYBRID'} | Gemini Required: YES | Gemini Check: REQUIRED`);
        }

        console.log(`
[Decision Routing]
Strategy Mode: ${compiledStrategy.strategy_mode || 'HYBRID'}
Execution Mode: ${executionMode}
Rule Score: ${decisionResult.decision_score}
Rule Recommendation: ${recommendation}
Requires Gemini: ${requiresGemini ? 'YES' : 'NO'}
Reason: ${decisionResult.explanation || (requiresGemini ? 'Passed deterministic pre-filter gate with high score; proceeding to Gemini AI validation' : 'Rule evaluation sufficient')}
`.trim());

          if (requiresGemini) {
            cronTimer.startStage("Gemini AI Execution");

            // User Gemini Status Gate Check (evaluated only when Gemini is required)
            const geminiStatus = userProfile?.gemini_status || 'READY';
            if (geminiStatus !== 'READY') {
              let allowProbationaryRetry = false;
              if (geminiStatus === 'QUOTA_EXHAUSTED' || geminiStatus === 'TEMP_ERROR' || geminiStatus === 'NEEDS_ATTENTION') {
                const lastChecked = userProfile?.gemini_last_checked ? new Date(userProfile.gemini_last_checked).getTime() : 0;
                const updated = userProfile?.updated_at ? new Date(userProfile.updated_at).getTime() : 0;
                const lastErrorTime = Math.max(lastChecked, updated);
                const elapsedMs = Date.now() - lastErrorTime;
                // Allow a probationary retry if more than 30 minutes have passed since last error check
                if (elapsedMs > 30 * 60 * 1000) {
                  allowProbationaryRetry = true;
                  console.log(`[GEMINI PROBATIONARY RETRY] User ${userProfile?.email || userId} status is '${geminiStatus}', but ${Math.round(elapsedMs / 60000)}m have elapsed. Re-testing Gemini availability...`);
                }
              }

              if (!allowProbationaryRetry) {
                usedFallback = true;
                fallbackReason = geminiStatus === 'QUOTA_EXHAUSTED' ? 'QUOTA_EXHAUSTED' : (geminiStatus === 'TEMP_ERROR' ? 'TEMPORARY_ERROR' : 'UNAVAILABLE');
                console.log(`[GEMINI FALLBACK] Reason: ${fallbackReason} | Source: RULE_ONLY`);
                console.log(`[Gemini Isolation] Watcher ${watcher.id} using RULE_ONLY fallback due to user Gemini status (${geminiStatus})`);
              }
            }

            // 0. Check Per-User Quota Circuit Breaker (fallback if user key already failed with 429 in current cron)
            if (!usedFallback && quotaExhaustedUsers.has(userId)) {
              console.log(`[GEMINI QUOTA]
User: ${userProfile?.email || userId}
Watcher: ${watcher.id} (${selectedPair} ${selectedTimeframe})
Status: QUOTA_EXHAUSTED
Action: USER_QUOTA_CIRCUIT_OPEN`);

              usedFallback = true;
              fallbackReason = 'QUOTA_EXHAUSTED';
              console.log(`[GEMINI FALLBACK] Reason: QUOTA_EXHAUSTED | Source: RULE_ONLY`);
              geminiQuotaErrorsCount++;
              geminiCallsQuotaExhaustedCount++;
              skippedDueToQuotaCount++;
              watchersSkippedByGemini429Count++;
            }

            // 1. Per-User AI Cooldown (30s minimum between AI calls per user)
            if (!usedFallback) {
              const lastAiTime = userLastGeminiExecutionMap.get(userId) || 0;
              const timeSinceLastAi = Date.now() - lastAiTime;
              if (timeSinceLastAi < 30000) {
                const remainingSec = Math.ceil((30000 - timeSinceLastAi) / 1000);
                console.log(`[USER AI COOLDOWN] User ${userId} executed AI call ${Math.round(timeSinceLastAi/1000)}s ago (<30s threshold). Falling back to RULE_ONLY (Remaining: ${remainingSec}s).`);
                watchersSkippedByUserCooldownCount++;
                usedFallback = true;
                fallbackReason = 'AI_COOLDOWN';
                console.log(`[GEMINI FALLBACK] Reason: AI_COOLDOWN | Source: RULE_ONLY`);
              }
            }

            // 2. In-Cron Job Deduplication Cache Check
            const jobKey = `${userId}:${selectedPair}:${selectedTimeframe}:${compiledStrategy.strategy_mode || 'HYBRID'}:${latestClosedCandleTime}`;
            let cachedJob = cronAnalysisCache.get(jobKey);

            if (cachedJob) {
              console.log(`[GEMINI DEDUPLICATED] Job: ${jobKey} | Action: REUSE_CACHED_ANALYSIS`);
              geminiCallsDeduplicatedCount++;
              geminiCallsSavedCount++;
              geminiSucceeded = true;
              geminiCalled = false;
              geminiRes = cachedJob.geminiRes;
              geminiTextResult = cachedJob.geminiTextResult;
              parsedResult = cachedJob.parsedResult;
              if (cachedJob.analysis) {
                analysis = JSON.parse(JSON.stringify(cachedJob.analysis));
              }
            } else {
              // 3. Per-User Concurrency Guard
              const activeUserPromise = activeUserGeminiPromises.get(userId);
              if (activeUserPromise) {
                console.log(`[PER-USER CONCURRENCY GUARD] User ${userId} has active Gemini call in-flight. Waiting...`);
                await activeUserPromise;
              }

              userLastGeminiExecutionMap.set(userId, Date.now());

              let resolveMutex: () => void;
              const userMutexPromise = new Promise<void>((res) => { resolveMutex = res; });
              activeUserGeminiPromises.set(userId, userMutexPromise);

              try {
                addLog("Gemini Required", "success");
                addLog("Calling Gemini", "success");
                geminiInvoked = true;
                console.log("Gemini Invoked");
                geminiCalled = true;
                geminiStart = Date.now();

                const keyRes = await resolveUserGeminiKey(supabase, userId, watcher.id, logCtx);

                if (!keyRes.keyPresent || !keyRes.apiKey) {
                  logWatcherError('Gemini ERROR', logCtx, 'Missing Gemini API key', {
                    'Gemini Status': 'NOT_CONNECTED',
                    'Action': 'Fallback to RULE_ONLY'
                  });

                  await supabase.from("profiles").update({
                    gemini_status: 'NOT_CONNECTED',
                    gemini_last_error: 'Missing Gemini API key',
                    gemini_last_checked: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                  }).eq("id", userId);

                  usedFallback = true;
                  fallbackReason = 'MISSING_KEY';
                  console.log(`[GEMINI FALLBACK] Reason: MISSING_KEY | Source: RULE_ONLY`);
                } else {
                  const geminiKey = keyRes.apiKey;
                  const elapsedBeforeGemini = Date.now() - startTime;
                  const remainingBeforeGemini = PROCESSING_DEADLINE_MS - elapsedBeforeGemini;

                  if (geminiTemporarilyUnavailable) {
                    console.warn(`[GEMINI CIRCUIT BREAKER] Skipping Gemini for Watcher ID: ${watcher.id} (${selectedPair}). Circuit breaker active (2x 503 errors encountered in this cron execution).`);
                    tempErrorCount++;
                    geminiCalls503Count++;
                    watchersSkippedByGemini503Count++;
                    usedFallback = true;
                    fallbackReason = 'TEMPORARY_ERROR';
                    console.log(`[GEMINI FALLBACK] Reason: TEMPORARY_ERROR | Source: RULE_ONLY`);
                  } else if (remainingBeforeGemini < 9500 || !hasProcessingTimeRemaining()) {
                  console.log(`[CRON DEADLINE]
User: ${logCtx.userEmail || userId}
Watcher: ${watcher.id}
Pair: ${selectedPair}
TF: ${selectedTimeframe}
Status: SKIPPED
Direction: NO_TRADE
Reason: Insufficient remaining execution budget (${remainingBeforeGemini}ms remaining < 9500ms required)`);
                  cronTimer.markEarlyExit();
                  watchersSkippedByDeadlineCount++;
                  watchersSkippedCount++;
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
                    gemini_used: false,
                    gemini_result: "Skipped due to cron safety deadline",
                    trade_sent: false,
                    trade_reason: `Cron execution safety deadline reached (${remainingBeforeGemini}ms remaining / 25,000ms limit)`,
                    scan_duration_ms: scanDurationMs,
                    gemini_duration_ms: null,
                    decision_snapshot: decisionSnapshot
                  });

                  skipped.push({ userId, reason: "Cron safety deadline reached" });
                  return;
                } else {

                logWatcherEvent('Gemini Analysis', logCtx, {
                  'Model': GEMINI_MARKET_WATCHER_MODEL,
                  'Decision Score': decisionResult.decision_score,
                  'Recommendation': recommendation,
                  'Gemini Required': requiresGemini ? 'YES' : 'NO',
                  'Key Fingerprint': keyRes.keyFingerprint,
                  'Key Source': keyRes.keySource
                });

                const ai = new GoogleGenAI({ apiKey: geminiKey });
                const currentPrice = candleData[candleData.length - 1].close;
                const promptText = `
You are an expert AI trading analyst.

Strategy Summary:
- Style: ${compiledStrategy.strategy_mode || 'HYBRID'}
- Timeframe: ${selectedTimeframe}
- Confirmation Mode: ${compiledStrategy.compiled_rules?.tap_and_rejection ? 'Default Confirmation (Tap & Rejection of Marked Zone)' : 'Explicit Strategy Rules'}

Current Price: ${currentPrice}

Marked Zone / Point of Interest (POI):
${currentZone ? `- Zone: ${currentZone.type} (${currentZone.direction}) [${currentZone.low.toFixed(5)} - ${currentZone.high.toFixed(5)}]
- Invalidation Level: ${currentZone.invalidationLevel.toFixed(5)}
- Status: ${currentZone.status} (Tapped: YES, Rejection Confirmed: ${lastZoneEval?.isRejected || currentZone.status === 'CONFIRMED' ? 'YES' : 'IN_PROGRESS'})` : '- None'}

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
1. Evaluate ONLY the supplied market evidence and marked POI zone.
2. If Confirmation Mode is Default Confirmation (Tap & Rejection of Marked Zone), price has tapped the marked POI zone and held above/below invalidation. Provide a ${currentZone?.direction || 'directional'} trade approval in accordance with the zone.
3. If BUY or SELL, provide the exact Entry Price, Stop Loss, and Take Profit based on actual NUMERIC market structure.
4. For BUY: Stop Loss MUST be placed BELOW entry, at or below marked zone invalidation level (${currentZone?.direction === 'BUY' ? currentZone.invalidationLevel.toFixed(5) : 'support structure'}).
5. For SELL: Stop Loss MUST be placed ABOVE entry, at or above marked zone invalidation level (${currentZone?.direction === 'SELL' ? currentZone.invalidationLevel.toFixed(5) : 'resistance structure'}).
6. Identify the basis used for the Stop Loss in "stopLossBasis" (SUPPORT_ZONE, RESISTANCE_ZONE, SWING_LOW, SWING_HIGH, DEMAND_ZONE, SUPPLY_ZONE, STRUCTURAL_CANDLE, ATR_FALLBACK).
7. Only return NO_TRADE when the supplied evidence clearly argues against taking a trade.

Output ONLY valid JSON.
`;
                const geminiRes = await executeBoundedGeminiCall(
                  ai,
                  {
                    model: GEMINI_MARKET_WATCHER_MODEL,
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
                    },
                    apiDeadlineMs: 10000,
                    timeoutMs: 8000,
                    maxRetriesFor503: 1,
                    backoffMsFor503: 500,
                    remainingGlobalBudgetMs: remainingBeforeGemini
                  },
                  {
                    userId: userId,
                    userEmail: logCtx.userEmail,
                    watcherId: watcher.id,
                    pair: selectedPair,
                    timeframe: selectedTimeframe,
                    keySource: keyRes.keySource
                  }
                );

                geminiCallsExecutedCount += geminiRes.attemptsExecuted;
                if (geminiRes.retried) {
                  geminiCallsRetriedCount++;
                }
                geminiDuration = geminiRes.durationMs;

                if (!geminiRes.success || !geminiRes.text) {
                  const cleanErrMsg = geminiRes.cleanErrorMessage || "Gemini execution failed";
                  let curReason = 'UNAVAILABLE';
                  if (geminiRes.errorType === 'TIMEOUT') {
                    geminiTimeoutsCount++;
                    geminiCallsTimedOutCount++;
                    watchersSkippedByGeminiTimeoutCount++;
                    curReason = 'TIMEOUT';
                  } else if (geminiRes.errorType === 'CANCELLED' || geminiRes.diagnosticStatus === 'CANCELLED') {
                    tempErrorCount++;
                    curReason = 'CANCELLED';
                  } else if (geminiRes.errorType === 'QUOTA_EXHAUSTED') {
                    quotaExhaustedUsers.add(userId);
                    geminiQuotaErrorsCount++;
                    geminiCallsQuotaExhaustedCount++;
                    skippedDueToQuotaCount++;
                    watchersSkippedByGemini429Count++;
                    curReason = 'QUOTA_EXHAUSTED';
                  } else if (geminiRes.errorType === 'TEMPORARY_ERROR') {
                    tempErrorCount++;
                    if (geminiRes.diagnosticStatus === 'TEMPORARY_504') {
                      gemini504Count++;
                    } else {
                      gemini503Count++;
                      geminiCalls503Count++;
                      gemini503CountInCron++;
                    }
                    geminiCallsTemporarilyFailedCount++;
                    watchersSkippedByGemini503Count++;
                    if (gemini503CountInCron >= 2) {
                      geminiTemporarilyUnavailable = true;
                      console.warn('[GEMINI CIRCUIT BREAKER ACTIVATED] 2x 503 errors encountered in current cron invocation. Disabling Gemini for subsequent watchers.');
                    }
                    curReason = 'TEMPORARY_ERROR';
                  } else if (geminiRes.errorType === 'INVALID_CREDENTIALS') {
                    invalidKeyCount++;
                    curReason = 'INVALID_KEY';
                  } else if (geminiRes.errorType === 'PERMISSION_ERROR') {
                    permissionErrorCount++;
                    curReason = 'INVALID_KEY';
                  } else if (geminiRes.errorType === 'INVALID_REQUEST') {
                    invalidRequestCount++;
                    curReason = 'UNAVAILABLE';
                  }

                  const profileStatus = geminiRes.errorType === 'QUOTA_EXHAUSTED' ? 'QUOTA_EXHAUSTED' :
                                        (geminiRes.errorType === 'INVALID_CREDENTIALS' || geminiRes.errorType === 'PERMISSION_ERROR') ? 'INVALID_KEY' : 'TEMP_ERROR';

                  logWatcherError('Gemini ERROR', logCtx, cleanErrMsg, {
                    'Diagnostic Status': geminiRes.diagnosticStatus || geminiRes.errorType || 'API_ERROR',
                    'Clean Error': cleanErrMsg
                  });

                  await supabase.from("profiles").update({
                    gemini_status: profileStatus,
                    gemini_last_error: cleanErrMsg,
                    gemini_last_checked: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                  }).eq("id", userId);

                  await supabase.from("watchers").update({
                    gemini_status: profileStatus,
                    last_gemini_error: cleanErrMsg,
                    updated_at: new Date().toISOString()
                  }).eq("id", watcher.id);
                  watcher.gemini_status = profileStatus;
                  watcher.last_gemini_error = cleanErrMsg;

                  usedFallback = true;
                  fallbackReason = curReason;
                  console.log(`[GEMINI FALLBACK] Reason: ${fallbackReason} | Source: RULE_ONLY`);
                } else {

                successfulGeminiExecutionsCount++;
                geminiTextResult = geminiRes.text;

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

                try {
                  parsedResult = JSON.parse(geminiTextResult);
                  if (!parsedResult || typeof parsedResult !== 'object' || typeof parsedResult.satisfies !== 'boolean') {
                    throw new Error('Invalid or missing trade direction or satisfies field');
                  }
                } catch (parseErr: any) {
                  const errMsg = `Malformed AI JSON output: ${parseErr.message}`;
                  console.error(`[GEMINI PARSE ERROR] User: ${logCtx.userEmail} | Watcher: ${watcher.id} | ${errMsg}`);

                  usedFallback = true;
                  fallbackReason = 'INVALID_RESPONSE';
                  console.log(`[GEMINI FALLBACK] Reason: INVALID_RESPONSE | Source: RULE_ONLY`);
                }

                addLog("Gemini Returned", "success");
                addLog("Parsed Gemini Output", "success");

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

                  logWatcherEvent('Gemini Decision', logCtx, {
                    'Status': 'APPROVED',
                    'Direction': geminiDirection,
                    'Confidence': `${geminiConfRecord.normalized}%`,
                    'Fallback': 'NO_TRADE'
                  });

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
                  console.log(`[GEMINI NO_TRADE]\nUser: ${logCtx.userEmail || 'unknown'}\nWatcher: ${watcher.id}\nAction: SKIP_SIGNAL`);

                  logWatcherEvent('Gemini Decision', logCtx, {
                    'Status': 'REJECTED',
                    'Direction': 'NO_TRADE',
                    'Confidence': '0%',
                    'Fallback': 'NO_TRADE'
                  });

                  analysis = {
                    signal: 'NO_TRADE',
                    confidence: 0,
                    reasoning: [parsedResult?.reasoning || "Gemini evaluated setup as NO_TRADE or unsatisfied."]
                  };
                }

                cronAnalysisCache.set(jobKey, {
                  geminiRes,
                  geminiTextResult,
                  parsedResult,
                  analysis: JSON.parse(JSON.stringify(analysis))
                });
              }
            }
          }
          } catch (gemErr: any) {
            const { profileStatus, diagnosticStatus, cleanErrorMessage } = classifyAndRedactGeminiError(gemErr);
            if (diagnosticStatus.startsWith('QUOTA_') || profileStatus === 'QUOTA_EXHAUSTED') {
              quotaExhaustedUsers.add(userId);
            }

            logWatcherError('Gemini ERROR', logCtx, gemErr, {
              'Diagnostic Status': diagnosticStatus,
              'Clean Error': cleanErrorMessage
            });

            await supabase.from("profiles").update({
              gemini_status: profileStatus,
              gemini_last_error: cleanErrorMessage,
              gemini_last_checked: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }).eq("id", userId);

            await supabase.from("watchers").update({
              gemini_status: profileStatus,
              last_gemini_error: cleanErrorMessage,
              updated_at: new Date().toISOString()
            }).eq("id", watcher.id);
            watcher.gemini_status = profileStatus;
            watcher.last_gemini_error = cleanErrorMessage;

            usedFallback = true;
            fallbackReason = profileStatus === 'QUOTA_EXHAUSTED' ? 'QUOTA_EXHAUSTED' :
                             (profileStatus === 'INVALID_KEY' || diagnosticStatus === 'PERMISSION_ERROR' || diagnosticStatus === 'INVALID_KEY') ? 'INVALID_KEY' :
                             (diagnosticStatus.includes('TIMEOUT') ? 'TIMEOUT' : 'TEMPORARY_ERROR');
            console.log(`[GEMINI FALLBACK] Reason: ${fallbackReason} | Source: RULE_ONLY`);
          } finally {
            resolveMutex!();
            if (activeUserGeminiPromises.get(userId) === userMutexPromise) {
              activeUserGeminiPromises.delete(userId);
            }
          }
        }

        if (usedFallback) {
          console.log(`[Gemini Fallback Execution] Running deterministic rule-only fallback engine due to Gemini ${fallbackReason}.`);
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
          let localAnalysis = analyzeMarket(candleData, mappedParsedStrategy);
          if ((!localAnalysis || localAnalysis.signal === 'NO_TRADE') && currentZone && (currentZone.status === 'ZONE_TAPPED' || currentZone.status === 'CONFIRMED' || lastZoneEval?.isTapped)) {
            const signalDir = currentZone.direction;
            const entry = activeCurrentPrice;
            const sl = currentZone.invalidationLevel;
            const risk = Math.abs(entry - sl);
            const rr = parseRiskRewardRatio(riskRewardStr);
            const tp = signalDir === 'BUY' ? entry + (risk * rr) : entry - (risk * rr);
            localAnalysis = {
              signal: signalDir,
              confidence: 85,
              entryPrice: entry,
              stopLoss: sl,
              takeProfit: tp,
              tp1: tp,
              stopLossBasis: 'STRUCTURAL_ZONE',
              structuralLevel: sl,
              riskReward: riskRewardStr,
              reasoning: [`[Default Confirmation Mode] Price tapped marked ${currentZone.type} [${currentZone.low} - ${currentZone.high}] and confirmed rejection in ${signalDir} direction while holding invalidation (${sl}).`]
            } as any;
          }
          const localSignal = localAnalysis?.signal || 'NO_TRADE';
          console.log(`[RULE_ONLY DECISION] Direction: ${localSignal}`);

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
          analysis = localAnalysis || { signal: 'NO_TRADE', confidence: 0, reasoning: ['Rule-only engine produced no signal'] };
        } else if (!geminiSucceeded || (analysis.signal !== 'BUY' && analysis.signal !== 'SELL')) {
          // If default tap and rejection confirmation is enabled and the zone was tapped & rejected:
          if (compiledStrategy.compiled_rules?.tap_and_rejection && currentZone && (currentZone.status === 'CONFIRMED' || lastZoneEval?.isRejected || lastZoneEval?.isTapped)) {
            console.log(`[Default Tap & Rejection Fallback] Zone ${currentZone.type} tapped and rejected. Triggering trade under default confirmation mode.`);
            const signalDir = currentZone.direction;
            const entry = activeCurrentPrice;
            const sl = currentZone.invalidationLevel;
            const risk = Math.abs(entry - sl);
            const rr = parseRiskRewardRatio(riskRewardStr);
            const tp = signalDir === 'BUY' ? entry + (risk * rr) : entry - (risk * rr);
            analysis = {
              signal: signalDir,
              confidence: 85,
              entryPrice: entry,
              stopLoss: sl,
              takeProfit: tp,
              tp1: tp,
              stopLossBasis: 'STRUCTURAL_ZONE',
              structuralLevel: sl,
              riskReward: riskRewardStr,
              reasoning: [
                `[Default Confirmation Mode] Price tapped marked ${currentZone.type} [${currentZone.low} - ${currentZone.high}] and rejected in ${signalDir} direction holding invalidation level (${sl}). Trade validated via default confirmation mode.`
              ]
            };
          } else {
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
      } else {
        // Gemini NOT required! Fallback to local strategy engine
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
          let localAnalysis = analyzeMarket(candleData, mappedParsedStrategy);
          if ((!localAnalysis || localAnalysis.signal === 'NO_TRADE') && currentZone && (currentZone.status === 'ZONE_TAPPED' || currentZone.status === 'CONFIRMED' || lastZoneEval?.isTapped)) {
            const signalDir = currentZone.direction;
            const entry = activeCurrentPrice;
            const sl = currentZone.invalidationLevel;
            const risk = Math.abs(entry - sl);
            const rr = parseRiskRewardRatio(riskRewardStr);
            const tp = signalDir === 'BUY' ? entry + (risk * rr) : entry - (risk * rr);
            localAnalysis = {
              signal: signalDir,
              confidence: 85,
              entryPrice: entry,
              stopLoss: sl,
              takeProfit: tp,
              tp1: tp,
              stopLossBasis: 'STRUCTURAL_ZONE',
              structuralLevel: sl,
              riskReward: riskRewardStr,
              reasoning: [`[Default Confirmation Mode] Price tapped marked ${currentZone.type} [${currentZone.low} - ${currentZone.high}] and confirmed rejection in ${signalDir} direction while holding invalidation (${sl}).`]
            } as any;
          }
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

        cronTimer.startStage("Quality Gate & Risk Governor");
        let qualityResult: any = null;
        let governorResult: any = null;
        let calibrationResult: any = null;
        let adaptiveResult: any = null;
        let adaptiveReq: any = null;
        let executionResult: any = null;

        // Fetch completed trades to compute consecutive losses for the watcher (Cold Start Protection)
        let completedTradesForStreak: any[] = [];
        let consecutiveLosses = 0;
        try {
          completedTradesForStreak = await fetchCompletedTradesForAdaptiveLearning(supabase, userId);
          consecutiveLosses = calculateConsecutiveLossesForWatcher(completedTradesForStreak, watcher.id);
          console.log(`[Loss-Streak Protection] Watcher ID: ${watcher.id}, Consecutive Losses: ${consecutiveLosses}`);
        } catch (tradeErr) {
          console.error('[Completed Trades Fetch Error] Failed to compute consecutive losses:', tradeErr);
        }

        // Quality Gate Check (QUALITY OVER QUANTITY)
        if (analysis.signal === 'BUY' || analysis.signal === 'SELL') {
          qualityResult = evaluateQualityGate({
            ruleScore: ruleDecisionScore,
            marketStructure: marketStructure,
            mandatoryRulesPassed: decisionResult.mandatory_rules_passed ?? true,
            geminiApproved: geminiCalled ? geminiSucceeded : undefined,
            geminiRequired: requiresGemini && !usedFallback,
            direction: analysis.signal,
            slValid: Boolean(analysis.stopLoss),
            tpValid: Boolean(analysis.takeProfit),
            rrValid: true,
            historicalProbability: histResult.historical_probability,
            consecutiveLosses: consecutiveLosses,
            ruleDetails: decisionResult.rule_details
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

        // If there is NO setup or signal is NO_TRADE: Update last_scan_at, last_analyzed_closed_candle_time, save evaluation and Exit.
        const isWaiting = (analysis.signal !== 'BUY' && analysis.signal !== 'SELL') || (analysis.confidence < 70);

        if (isWaiting) {
            logWatcherEvent('SIGNAL SKIPPED', logCtx, {
              'Reason': 'No setup found',
              'Signal': analysis.signal,
              'Confidence': `${analysis.confidence}%`
            });
            
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
            isWatcherSkipped = false;
            return;
        }

        cronTimer.startStage("Position Sizing & Validation");
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

        // === STAGE 7: EXECUTION MODE ===
        const brokerExecutionMode = process.env.EXECUTION_MODE || 'THEORETICAL';

        // ... existing analysis logic ...
        
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
            execution_source: brokerExecutionMode,
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
          return;
        }
        // === STAGE 5 HARDENING: NEWS HARD-PAUSE GATE ===
        const newsGateResult = await defaultEconomicEventService.checkNewsHardPause(selectedPair);

        const marketCandleTimestampMs = new Date(tsResult.candles[tsResult.candles.length - 1]?.timestamp || Date.now()).getTime();

        // === STAGE 5 HARDENING: EXECUTION FRESHNESS GATE ===
        const freshnessResult = validateExecutionFreshness({
          signalGeneratedAt: Date.now(),
          marketDataTimestamp: marketCandleTimestampMs,
          currentPrice: executedPrice,
          entryPrice: posSizeResult.entryPrice || executedPrice,
          stopLoss: posSizeResult.stopLoss,
          takeProfit: posSizeResult.takeProfit || 0,
          instrument: selectedPair,
          timeframe: selectedTimeframe,
          isBuy: analysis.signal === 'BUY'
        }, executedPrice * 0.9999, executedPrice * 1.0001); // Simulated bid/ask

        // === STAGE 5 HARDENING: FINAL PRE-EXECUTION REVALIDATION ===
        const finalValidation = revalidatePreExecution({
          marketDataAvailable: true,
          marketDataFreshness: freshnessResult,
          currentPrice: executedPrice,
          spread: (executedPrice * 1.0001) - (executedPrice * 0.9999),
          entryPrice: posSizeResult.entryPrice || executedPrice,
          sl: posSizeResult.stopLoss,
          tp: posSizeResult.takeProfit || 0,
          rr: posSizeResult.actualRr || 0,
          riskGovernorPassed: true, // Governor passed previously
          newsGate: newsGateResult,
          positionSizing: posSizeResult.calculatedLotSize || posSizeResult.exactLotSize,
          userRiskLimitsPassed: true,
          duplicateTradeProtectionPassed: true,
          signalExpired: false
        });

        if (finalValidation.status === 'FINAL_EXECUTION_REJECTED') {
            console.log(`[Authoritative Decision] Signal suppressed for Watcher ID: ${watcher.id} (${selectedPair}): Final decision is REJECTED from gate ${finalValidation.rejectionReason}.`);
            
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
                trade_reason: `Safety Gate Rejected: ${finalValidation.rejectionReason}`,
                scan_duration_ms: scanDurationMs,
                gemini_duration_ms: geminiDuration,
                decision_snapshot: decisionSnapshot
            });
            return;
        }

        // === STAGE 7 HARDENING: BROKER QUOTE INTEGRATION & FRESHNESS ===
        const liveTradingEnabled = process.env.LIVE_TRADING_ENABLED === 'true';
        
        let brokerQuote: BrokerQuote | undefined;
        let brokerQuoteFreshnessPassed = false;
        
        try {
          console.log(`[Stage 7] Fetching fresh broker quote for ${selectedPair}...`);
          brokerQuote = await getBrokerProvider().getQuote(selectedPair);
          
          if (brokerQuote) {
            const quoteAgeMs = Date.now() - brokerQuote.timestamp;
            const maxQuoteAgeMs = Number(process.env.BROKER_QUOTE_MAX_AGE_MS) || 5000; // 5s default
            brokerQuoteFreshnessPassed = quoteAgeMs <= maxQuoteAgeMs;
            
            console.log(`[Broker Quote]
Symbol: ${brokerQuote.symbol}
Bid: ${brokerQuote.bid}
Ask: ${brokerQuote.ask}
Spread: ${brokerQuote.spread.toFixed(5)}
Age: ${quoteAgeMs}ms (Threshold: ${maxQuoteAgeMs}ms)
Freshness: ${brokerQuoteFreshnessPassed ? 'PASS' : 'FAIL'}
Source: ${brokerQuote.source}`);
          }
        } catch (quoteErr: any) {
          console.error(`[Broker Quote Error] Failed to fetch quote for ${selectedPair}:`, quoteErr.message);
        }

        const maxSpreadThreshold = Number(process.env.BROKER_MAX_SPREAD_PERCENT) || 0.0005; // 0.05%
        const maxEntryDriftThreshold = Number(process.env.BROKER_MAX_ENTRY_DRIFT_PERCENT) || 0.001; // 0.1%

        // Actual execution price based on direction
        const currentExecutionPrice = analysis.signal === 'BUY' ? brokerQuote?.ask : brokerQuote?.bid;

        // === STAGE 5/7 HARDENING: FINAL PRE-EXECUTION REVALIDATION ===
        const brokerValidation = revalidatePreExecution({
          marketDataAvailable: true,
          marketDataFreshness: freshnessResult,
          currentPrice: currentExecutionPrice || executedPrice,
          spread: brokerQuote?.spread || ((executedPrice * 1.0001) - (executedPrice * 0.9999)),
          entryPrice: posSizeResult.entryPrice || executedPrice,
          sl: posSizeResult.stopLoss,
          tp: posSizeResult.takeProfit || 0,
          rr: posSizeResult.actualRr || 0,
          riskGovernorPassed: true,
          newsGate: newsGateResult,
          positionSizing: posSizeResult.calculatedLotSize || posSizeResult.exactLotSize,
          userRiskLimitsPassed: true,
          duplicateTradeProtectionPassed: true,
          signalExpired: false,
          brokerQuote: brokerQuote,
          brokerQuoteFreshnessPassed: brokerQuoteFreshnessPassed,
          maxSpreadThreshold: maxSpreadThreshold * (currentExecutionPrice || executedPrice),
          maxEntryDriftThreshold: maxEntryDriftThreshold,
          intendedEntryPrice: posSizeResult.entryPrice || executedPrice
        });

        if (brokerValidation.status === 'FINAL_EXECUTION_REJECTED') {
            console.log(`[Authoritative Decision] Signal suppressed for Watcher ID: ${watcher.id} (${selectedPair}): Final decision is REJECTED from gate ${brokerValidation.rejectionReason}.`);
            
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
                trade_reason: `Safety Gate Rejected: ${brokerValidation.rejectionReason}`,
                scan_duration_ms: scanDurationMs,
                gemini_duration_ms: geminiDuration,
                execution_source: brokerExecutionMode,
                decision_snapshot: decisionSnapshot
            });
            return;
        }

        // === STAGE 8/17: SUPERVISED MICROLOT GOVERNOR ===
        const microlotGovernor = new SupervisedMicrolotGovernor(brokerProvider);
        const riskAmount = posSizeResult.riskAmount || (posSizeResult.calculatedLotSize * 10); // fallback
        const microlotResult = await microlotGovernor.validateExecution(selectedPair, riskAmount);

        if (!microlotResult.accepted) {
            console.warn(`[Stage 8/17 Microlot Rejected] ${microlotResult.reason}`);
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
                trade_reason: `MICROLOT_GOVERNOR_REJECTED: ${microlotResult.reason}`,
                scan_duration_ms: scanDurationMs,
                gemini_duration_ms: geminiDuration,
                execution_source: brokerExecutionMode,
                decision_snapshot: decisionSnapshot
            });
            return;
        }

        // === STAGE 8: CRASH RECOVERY & IDEMPOTENCY ===
        cronTimer.startStage("Broker Order & Signal Registration");
        const stableClientOrderId = `cl-${watcher.id}-${latestClosedCandleTime.replace(/[:.-]/g, '')}`;
        
        let brokerOrder: BrokerOrder | null = null;
        try {
            // Check for existing order (Crash Recovery / Idempotency)
            brokerOrder = await brokerProvider.findOrderByClientOrderId(stableClientOrderId);
            
            if (brokerOrder) {
                console.log(`[Stage 8 Recovery] Existing order found for ${selectedPair} (ID: ${brokerOrder.orderId}). Rehydrating state.`);
            } else {
                // Check for existing position to avoid doubling up
                const existingPos = await brokerProvider.getPosition(selectedPair);
                if (existingPos) {
                    console.log(`[Stage 8 Protection] Existing position found for ${selectedPair} at broker. Skipping duplicate execution.`);
                    return;
                }

                const orderParams = {
                    symbol: selectedPair,
                    type: 'MARKET' as any,
                    side: analysis.signal === 'BUY' ? 'BUY' : 'SELL' as any,
                    quantity: posSizeResult.calculatedLotSize || posSizeResult.exactLotSize,
                    price: currentExecutionPrice || executedPrice,
                    sl: posSizeResult.stopLoss,
                    tp: posSizeResult.takeProfit || undefined,
                    clientOrderId: stableClientOrderId,
                    tradeId: `TR-${watcher.id}-${latestClosedCandleTime.replace(/[:.-]/g, '')}`
                };

                if (brokerExecutionMode === 'LIVE') {
                    if (process.env.LIVE_TRADING_ENABLED !== 'true') {
                        throw new Error('LIVE_TRADING_ENABLED is false. Rejecting live order.');
                    }
                    console.log(`[LIVE EXECUTION] Placing authoritative LIVE order for ${selectedPair}...`);
                    brokerOrder = await brokerProvider.placeOrder(orderParams);
                } else if (brokerExecutionMode === 'PAPER') {
                    console.log(`[PAPER EXECUTION] Routing PAPER order for ${selectedPair}...`);
                    brokerOrder = await brokerProvider.placeOrder(orderParams);
                } else {
                    console.log(`[THEORETICAL EXECUTION] Recording THEORETICAL order for ${selectedPair}...`);
                    brokerOrder = await brokerProvider.placeOrder(orderParams);
                }
            }

            if (!brokerOrder || brokerOrder.status === 'REJECTED') {
                throw new Error(brokerOrder?.status === 'REJECTED' ? 'Broker rejected the order' : 'Empty response from broker');
            }
        } catch (execErr: any) {
            console.error(`[EXECUTION FAILED] Fail-closed logic triggered for Watcher ${watcher.id}:`, execErr.message);
            
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
                trade_reason: `EXECUTION_FAILED: ${execErr.message}. Fail-closed protection activated.`,
                scan_duration_ms: scanDurationMs,
                gemini_duration_ms: geminiDuration,
                execution_source: brokerExecutionMode,
                decision_snapshot: decisionSnapshot
            });
            return;
        }
        
        console.log(`[${brokerExecutionMode} BROKER] Order Placed: ${brokerOrder.orderId} (Status: ${brokerOrder.status})`);

        const candidateTradeId = brokerOrder.tradeId || `TR-${watcher.id}-${Date.now()}`;

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
            execution_source: brokerExecutionMode,
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
          return;
        }

        let signal: any = null;
        let isRegistered = false;

        if (recommendation !== 'FAIL') {
          if (analysis.signal === 'BUY' || analysis.signal === 'SELL') {
            signalsGeneratedCount++;
          }
          analysis.entryPrice = posSizeResult.entryPrice;
          analysis.stopLoss = posSizeResult.stopLoss;
          analysis.takeProfit = posSizeResult.takeProfit;

          const signalReasoning = Array.isArray(analysis.reasoning) ? analysis.reasoning.join("; ") : (analysis.reasoning || "Strategy criteria matched");
          logWatcherEvent('SIGNAL GENERATED', logCtx, {
            'Direction': analysis.signal,
            'Confidence': `${analysis.confidence}%`,
            'Entry Price': analysis.entryPrice,
            'Stop Loss': analysis.stopLoss,
            'Take Profit': analysis.takeProfit,
            'Reasoning': signalReasoning
          });

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
          logWatcherEvent('SIGNAL SKIPPED', logCtx, 'Recommendation is FAIL. Setting signal to NO_TRADE.');
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
          logWatcherEvent('SIGNAL REGISTERED', logCtx, 'Failed to register signal or active trade already exists in database');
          
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
            execution_source: brokerExecutionMode,
            decision_snapshot: decisionSnapshot
          });

          return;
        }

        // Send ONE Telegram signal with Signal Deduplication Check
        cronTimer.startStage("Telegram Alert & DB Persistence");
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
          if (alertReason.toLowerCase().includes('separation') || alertReason.toLowerCase().includes('15') || alertReason.toLowerCase().includes('time')) {
            signalsSuppressedByMinSeparationCount++;
          } else {
            signalsSuppressedAsDuplicatesCount++;
          }
          logWatcherEvent('Signal Deduplication', logCtx, `Suppressed Telegram alert: ${dedupCheck.reason}`);
        } else {
          const dispatchRes = await dispatchTradeAlert(telegramChatId, signal);
          alertSent = dispatchRes.sent;
          alertReason = dispatchRes.reason;
          if (alertSent) {
            addLog("Telegram Sent", "success");
            telegramMessagesSentCount++;
            logWatcherEvent('SIGNAL REGISTERED', logCtx, {
              'Message Sent': 'YES',
              'Trade ID': candidateTradeId
            });
          } else {
            logWatcherError('SIGNAL REGISTERED', logCtx, `Telegram message blocked or failed: ${alertReason}`);
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
          execution_source: brokerExecutionMode,
          decision_snapshot: decisionSnapshot
        });

        // Save active trade state in Supabase:
        // trade_status = 'ACTIVE', active_trade_id = candidateTradeId, entry_price, stop_loss, take_profit, direction, opened_at
        logWatcherEvent('ACTIVE UPDATE START', logCtx, `Updating trade_status = ACTIVE with trade_id: ${candidateTradeId}`);
        activeZonesMemoryMap.delete(watcher.id);
        let { data: activeUpdateRows, error: activeUpdateErr } = await supabase
          .from("watchers")
          .update({ 
            trade_status: 'ACTIVE',
            active_trade_id: candidateTradeId,
            entry_price: analysis.entryPrice,
            stop_loss: analysis.stopLoss,
            take_profit: analysis.takeProfit,
            direction: analysis.signal,
            zone_status: 'CONFIRMED',
            opened_at: new Date().toISOString(),
            closed_at: null,
            cooldown_until: null,
            last_scan_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("id", watcher.id)
          .select();

        if (activeUpdateErr && activeUpdateErr.message?.includes('zone_status')) {
          const fallbackRes = await supabase
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
          activeUpdateRows = fallbackRes.data;
          activeUpdateErr = fallbackRes.error;
        }

        const dbUpdateActiveSucceeded = !activeUpdateErr && activeUpdateRows && activeUpdateRows.length > 0;

        if (dbUpdateActiveSucceeded) {
          logWatcherEvent('ACTIVE UPDATE SUCCESS', logCtx, 'Watcher successfully updated to trade_status = ACTIVE in Supabase.');
        } else {
          logWatcherError('ACTIVE UPDATE FAILED', logCtx, activeUpdateErr?.message || 'No rows returned from update');
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
        isWatcherSkipped = false;
        results.push({ userId, symbol, tradeStatus: 'ACTIVE', signalsFound: 1, signalsSent: alertSent ? 1 : 0 });
      } catch (err: any) {
        const fallbackCtx: WatcherLogContext = typeof logCtx !== 'undefined' ? logCtx : await resolveWatcherUserContext(supabase, watcher);
        logWatcherError('WATCHER ERROR', fallbackCtx, err);
        
        errors.push({ userId, error: err.message || "Unknown error" });
        watchersSkippedCount++;
      }
      } finally {
        cronTimer.endWatcher(isWatcherSkipped, watcher?.id);
      }
    }

    for (const watcher of watchers) {
      if (!hasProcessingTimeRemaining()) {
        console.warn(`[CRON DEADLINE] Global processing deadline reached (${Date.now() - cronStartedAt}ms elapsed / ${PROCESSING_DEADLINE_MS}ms budget). Halting watcher loop.`);
        earlyExit = true;
        earlyExitReason = "PROCESSING_DEADLINE";
        cronTimer.markEarlyExit();
        break;
      }

      await processSingleWatcher(watcher);
    }

    const totalTime = Date.now() - startTime;
    const maxWatcherDuration = cronTimer.getMaxWatcherDurationMs();
    const avgWatcherDuration = cronTimer.getAvgWatcherDurationMs();

    console.log(`\n==================================================`);
    if (isDebugMode()) {
      console.log(`[CRON DIAGNOSTICS]`);
      console.log(`Watchers Discovered: ${watchersDiscoveredCount}`);
      console.log(`Watchers Eligible: ${watchersEligibleCount}`);
      console.log(`Watchers Processed: ${watchersProcessedCount}`);
      console.log(`Watchers Skipped: ${watchersSkippedCount}`);
      console.log(`Watchers Skipped By Deadline: ${watchersSkippedByDeadlineCount}`);
      console.log(`Watchers Skipped By Gemini Timeout: ${watchersSkippedByGeminiTimeoutCount}`);
      console.log(`Watchers Skipped By Gemini 429: ${watchersSkippedByGemini429Count}`);
      console.log(`Watchers Skipped By Gemini 503: ${watchersSkippedByGemini503Count}`);
      console.log(`Gemini Calls Executed: ${geminiCallsExecutedCount}`);
      console.log(`Gemini Calls Retried: ${geminiCallsRetriedCount}`);
      console.log(`Gemini Calls Timed Out: ${geminiCallsTimedOutCount}`);
      console.log(`Gemini Calls Quota Exhausted: ${geminiCallsQuotaExhaustedCount}`);
      console.log(`Gemini Calls Temporarily Failed: ${geminiCallsTemporarilyFailedCount}`);
      console.log(`Maximum Watcher Duration: ${maxWatcherDuration}ms`);
      console.log(`Average Watcher Duration: ${avgWatcherDuration}ms`);
      console.log(`Total Cron Duration: ${totalTime}ms`);
      console.log(`==================================================\n`);

      console.log(`\n==================================================`);
      console.log(`[TWELVE DATA API USAGE AUDIT & METRICS]`);
      console.log(`Total Requests: ${totalTwelveDataRequests}`);
      console.log(`Unique Keys: ${uniqueMarketDataKeysInCron.size}`);
      console.log(`Cache Hits: ${twelveDataCacheHitsInCron}`);
      console.log(`Request Deduplications: ${twelveDataDeduplicationsInCron}`);
      console.log(`Requests Saved: ${requestsSavedThroughCachingCount}`);
      console.log(`Rate Limited: ${watchersSkippedDueToRateLimitCount}`);
      console.log(`Timeouts: ${twelveDataTimeoutsInCron}`);
      console.log(`Invalid Responses: ${twelveDataInvalidResponsesInCron}`);
      console.log(`Stale Data Skips: ${twelveDataStaleDataSkipsInCron}`);
      console.log(`==================================================\n`);

      console.log(`\n========== GEMINI HEALTH & DIAGNOSTICS ==========`);
      console.log(`Watchers Ready: ${watchersReadyCount}`);
      console.log(`Waiting For Quota: ${quotaWaitCount}`);
      console.log(`Invalid Keys: ${invalidKeyCount}`);
      console.log(`Temporary Errors (503): ${tempErrorCount}`);
      console.log(`Timeouts: ${geminiTimeoutsCount}`);
      console.log(`Quota Errors (429): ${geminiQuotaErrorsCount}`);
      console.log(`Skipped Due To Quota: ${skippedDueToQuotaCount}`);
      console.log(`Filtered By Deterministic Pre-Filter: ${watchersFilteredByDeterministicGateCount}`);
      console.log(`Gemini Calls Executed: ${geminiCallsExecutedCount}`);
      console.log(`Gemini Calls Retried: ${geminiCallsRetriedCount}`);
      console.log(`Gemini Calls Saved: ${geminiCallsSavedCount}`);
      console.log(`Gemini Calls Saved By Pre-Filter: ${geminiCallsSavedByPreFilterCount}`);
      console.log(`=================================================\n`);
    }

    console.log(`[CRON] END | duration=${totalTime}ms | processed=${watchersProcessedCount} | skipped=${watchersSkippedCount} | signals=${telegramMessagesSentCount} | errors=${errors.length}`);

    if (hasProcessingTimeRemaining()) {
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
    }

    // Cleanup old logs (keep only last 500 runs) if time permits
    if (hasProcessingTimeRemaining()) {
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
    }

    cronTimer.printSummary();

    return res.status(200).json({
      success: true,
      earlyExit,
      reason: earlyExit ? (earlyExitReason || "PROCESSING_DEADLINE") : "COMPLETED",
      watchersDiscovered: watchersDiscoveredCount,
      watchersProcessed: watchersProcessedCount,
      watchersSkipped: watchersSkippedCount,
      geminiCallsExecuted: geminiCallsExecutedCount,
      geminiTimeouts: geminiTimeoutsCount,
      gemini503Errors: geminiCalls503Count,
      geminiQuotaErrors: geminiQuotaErrorsCount,
      geminiCircuitBreakerTriggered: geminiTemporarilyUnavailable,
      twelveDataRequests: twelveDataRequestsInCron,
      twelveDataCacheHits: twelveDataCacheHitsInCron,
      durationMs: totalTime,
      processed: watchersProcessedCount,
      signalsSent: telegramMessagesSentCount,
      diagnostics: {
        watchersDiscovered: watchersDiscoveredCount,
        watchersDue: watchersDueCount,
        watchersEligible: watchersEligibleCount,
        watchersProcessed: watchersProcessedCount,
        watchersSkipped: watchersSkippedCount,
        watchersSkippedByDeadline: watchersSkippedByDeadlineCount,
        watchersSkippedByGeminiTimeout: watchersSkippedByGeminiTimeoutCount,
        watchersSkippedByGemini429: watchersSkippedByGemini429Count,
        watchersSkippedByGemini503: watchersSkippedByGemini503Count,
        watchersSkippedByUserCooldown: watchersSkippedByUserCooldownCount,
        watchersSkippedBecauseNoNewCandle: watchersSkippedBecauseNoNewCandleCount,
        geminiCallsExecuted: geminiCallsExecutedCount,
        successfulGeminiExecutions: successfulGeminiExecutionsCount,
        geminiCallsTimedOut: geminiCallsTimedOutCount,
        geminiCalls503: geminiCalls503Count,
        geminiCallsRetried: geminiCallsRetriedCount,
        geminiQuotaErrors: geminiQuotaErrorsCount,
        geminiCallsDeduplicated: geminiCallsDeduplicatedCount,
        geminiCircuitBreakerActive: geminiTemporarilyUnavailable,
        signalsGenerated: signalsGeneratedCount,
        signalsSuppressedAsDuplicates: signalsSuppressedAsDuplicatesCount,
        signalsSuppressedByMinSeparation: signalsSuppressedByMinSeparationCount,
        maximumWatcherDurationMs: maxWatcherDuration,
        averageWatcherDurationMs: avgWatcherDuration,
        totalCronDurationMs: totalTime
      },
      twelveDataMetrics: {
        totalRequests: twelveDataRequestsInCron,
        cacheHits: twelveDataCacheHitsInCron,
        savedThroughCaching: twelveDataCacheHitsInCron,
        globalTotalRequests: getMarketDataStats().requests,
        globalCacheHits: getMarketDataStats().cacheHits,
        globalSavedThroughCaching: getMarketDataStats().requestsSaved,
        skippedDueToRateLimit: watchersSkippedDueToRateLimitCount,
        creditsUsed: getMarketDataStats().creditsUsed,
        creditsRemaining: getMarketDataStats().creditsRemaining,
        currentMinuteUsage: getMarketDataStats().currentMinuteUsage,
        status: getMarketDataStats().status
      },
      geminiHealth: {
        watchersReady: watchersReadyCount,
        waitingForQuota: quotaWaitCount,
        invalidKeys: invalidKeyCount,
        permissionErrors: permissionErrorCount,
        invalidRequests: invalidRequestCount,
        temporaryErrors: tempErrorCount,
        timeouts: geminiTimeoutsCount,
        gemini503Errors: gemini503Count,
        gemini504Errors: gemini504Count,
        quotaErrors: geminiQuotaErrorsCount,
        skippedDueToQuota: skippedDueToQuotaCount,
        geminiCallsExecuted: geminiCallsExecutedCount,
        geminiCallsRetried: geminiCallsRetriedCount,
        geminiCallsSaved: geminiCallsSavedCount,
        geminiCallsSavedByPreFilter: geminiCallsSavedByPreFilterCount,
        watchersFilteredByDeterministicGate: watchersFilteredByDeterministicGateCount,
        successfulExecutions: successfulGeminiExecutionsCount,
        watchersSkippedByGeminiFailure: watchersSkippedByGeminiFailureCount,
        circuitBreakerActive: geminiTemporarilyUnavailable
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

