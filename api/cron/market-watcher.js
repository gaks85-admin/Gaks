import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { CronTimer } from '../../src/lib/cron-timer.js';
import { logWatcherEvent, logWatcherError, logWatcherWarn, resolveWatcherUserContext, isDebugMode } from '../../src/lib/watcher-logger.js';
import { GoogleGenAI, Type } from '@google/genai';
import { analyzeMarket } from '../../src/lib/strategy-engine.js';
import { buildTelegramTradeOutcomeMessage } from '../../src/lib/telegram-formatter.js';
import { dispatchTradeAlert } from '../../src/lib/telegramWrapper.js';
import { extractRiskPreferences, calculatePositionSize, parseRiskRewardRatio } from '../../src/lib/risk-engine.js';
import { compileStrategy } from '../../src/lib/strategy-compiler.js';
import { evaluateDecision } from '../../src/lib/decision-engine.js';
import { extractMarketStructure } from '../../src/lib/market-structure-engine.js';
import { evaluateEconomicNewsGate } from '../../src/lib/economic-news-gate.js';
import { validateExecutionFreshness } from '../../src/lib/execution-freshness.js';
import { revalidatePreExecution } from '../../src/lib/pre-execution-validator.js';
import { calculateStructuralStopLoss, validateAndResolveStopLoss, validateZoneProximityAndStopLoss } from '../../src/lib/structural-stop-loss.js';
import { getBrokerProvider } from '../../src/lib/broker-factory.js';
import { recordEvaluation } from '../../src/lib/explainability-engine.js';
import { defaultMarketDataService, getMarketDataStats, getRequiredCandleCountForTimeframe } from '../../src/lib/market-data-service.js';
import { calculateHistoricalProbability, recordCompletedTrade, getUserWinRateStats } from '../../src/lib/learning-engine.js';
import { calculatePipsDistance, calculateUnrealizedPnlR } from '../../src/lib/active-trade-monitor.js';
import { diagnoseLossOutcome } from '../../src/lib/trade-post-mortem-engine.js';
import { BrokerReconciliationService } from '../../src/lib/broker-reconciliation-service.js';
import { SafetyGovernor, defaultSafetyLimits } from '../../src/lib/safety-governor.js';
import { SupervisedMicrolotGovernor } from '../../src/lib/microlot-governor.js';
import { RULE_WEIGHTS } from '../../src/lib/rule-weight-engine.js';
import { validateMarketDataIntegrity } from '../../src/lib/market-integrity.js';
import { normalizeConfidence } from '../../src/lib/confidence-engine.js';
import { evaluateQualityGate, calculateAdaptiveQualityRequirement, calculateConsecutiveLossesForWatcher } from '../../src/lib/quality-gate.js';
import { checkSignalDeduplication } from '../../src/lib/signal-deduplication.js';
import { resolveUserGeminiKey, classifyAndRedactGeminiError } from '../../src/lib/gemini-key-resolver.js';
import { executeBoundedGeminiCall, runGeminiRequest as runGeminiWrapperRequest, GEMINI_MARKET_WATCHER_MODEL } from '../../src/lib/geminiWrapper.js';
import { validateActiveTradeState, isWatcherDue } from '../../src/lib/trade-validator.js';
import { computeEquityAnalytics, deriveEquityState, fetchUserCompletedTrades, computeDailyPnL } from '../../src/lib/equity-learning-engine.js';
import { evaluateRiskGovernor } from '../../src/lib/risk-governor.js';
import { evaluateAdaptiveLearning, fetchCompletedTradesForAdaptiveLearning } from '../../src/lib/adaptive-learning-engine.js';
import { evaluateAdaptiveExecution } from '../../src/lib/adaptive-execution-engine.js';
import { evaluateClosedLoopCalibration } from '../../src/lib/closed-loop-calibration-engine.js';
import { resolveAuthoritativeDecision } from '../../src/lib/decision-attribution.js';
import { processWithConcurrency } from '../../src/lib/concurrency.js';
import { identifyCandidateZones, evaluateZoneState, recordRejectedZone, getRejectedZones } from '../../src/lib/zone-engine.js';
import { curateZonesWithAI } from '../../src/lib/zone-curator.js';
import { evaluateWatcherPropFirmGate, resolvePersistedAccountType, syncPropFirmStateForActiveWatcher } from '../../src/lib/prop-firm-watcher-gate.js';
import { resolveHigherTimeframeTrend } from '../../src/lib/htf-trend-engine.js';
import { getMarketSchedule } from '../../src/lib/market-hours.js';
const MARKET_WATCHER_DECISION_MODE_OVERRIDE = 'RULE_ONLY';
const activeZonesMemoryMap = globalThis.__activeWatcherZones || new Map();
globalThis.__activeWatcherZones = activeZonesMemoryMap;
export function getScanIntervalMinutes(watcher) {
    const rawInterval = watcher?.scan_interval ?? watcher?.scan_interval_minutes;
    if (rawInterval !== undefined && rawInterval !== null && rawInterval !== '') {
        const parsed = typeof rawInterval === 'number' ? rawInterval : parseInt(String(rawInterval), 10);
        if (!isNaN(parsed) && parsed > 0) {
            return parsed;
        }
    }
    const tf = (watcher?.selected_timeframe || '').toUpperCase().trim();
    if (tf === 'M1' || tf === '1M' || tf === '1')
        return 1;
    if (tf === 'M5' || tf === '5M' || tf === '5')
        return 5;
    if (tf === 'M15' || tf === '15M' || tf === '15')
        return 15;
    if (tf === 'M30' || tf === '30M' || tf === '30')
        return 30;
    if (tf === 'H1' || tf === '1H' || tf === '60')
        return 60;
    if (tf === 'H4' || tf === '4H' || tf === '240')
        return 240;
    if (tf === 'D1' || tf === '1D' || tf === '1440')
        return 1440;
    return 5;
}
export async function syncProfitGoal(supabase, userId, currentEquity, telegramChatId) {
    try {
        const { data: goal, error } = await supabase
            .from('profit_goals')
            .select('*')
            .eq('user_id', userId)
            .in('status', ['ACTIVE', 'AWAITING_DECISION'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error || !goal)
            return null;
        const now = new Date();
        const deadline = new Date(goal.deadline);
        const isExpired = deadline < now;
        const isReached = currentEquity >= goal.target_amount;
        const isActuallyNewProgress = currentEquity > goal.start_amount;
        let updates = {
            current_amount: currentEquity,
            updated_at: now.toISOString()
        };
        if (isReached && goal.status !== 'COMPLETED' && isActuallyNewProgress) {
            updates.status = 'COMPLETED';
            updates.notified = true;
            if (telegramChatId) {
                await sendTelegramMessage(telegramChatId, `🏆 *Profit Goal Achieved!*\n\nCongratulations! Your account equity has reached $${currentEquity.toLocaleString()}, meeting your target of $${goal.target_amount.toLocaleString()}.\n\n*Progress:* You grew the account from $${goal.start_amount.toLocaleString()} to $${currentEquity.toLocaleString()}.\n*Status:* Challenge Completed.\n*Note:* Trading is now paused for this challenge to secure your profits. You can start a new challenge from the dashboard.`);
            }
        }
        else if (isExpired && goal.status === 'ACTIVE') {
            updates.status = 'AWAITING_DECISION';
            if (!goal.notified_expiry) {
                updates.notified_expiry = true;
                if (telegramChatId) {
                    await sendTelegramMessage(telegramChatId, `⚠️ *Profit Goal Deadline Reached*\n\nYour challenge deadline has passed, but the target hasn't been reached yet.\n\n*Current Equity:* $${currentEquity.toLocaleString()}\n*Target:* $${goal.target_amount.toLocaleString()}\n\nPlease visit the dashboard to *Extend Time* or *Skip Challenge*. Trading is paused until you decide.`);
                }
            }
        }
        await supabase.from('profit_goals').update(updates).eq('id', goal.id);
        return { ...goal, ...updates };
    }
    catch (err) {
        console.error('[Profit Goal Sync Error]', err);
        return null;
    }
}
export function buildDecisionSnapshot(decisionResult, histResult, compiledStrategy) {
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
export function classifyGeminiError(error) {
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
export async function runGeminiRequest(supabase, userId, prompt, model = GEMINI_MARKET_WATCHER_MODEL, config) {
    return await runGeminiWrapperRequest(supabase, userId, prompt, model, config);
}
export function toValidUuid(val) {
    if (typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) {
        return val;
    }
    return crypto.randomUUID();
}
let hasSignalFingerprintsTable = true;
const inMemorySignalFingerprints = new Map();
export async function registerSignal(supabase, watcher, signal) {
    const currentStatus = (watcher?.trade_status || 'WAITING').toUpperCase().trim();
    if (currentStatus === 'ACTIVE') {
        console.log(`[registerSignal] Watcher ${watcher.id} is currently ACTIVE (trade_id: ${watcher.active_trade_id || 'ACTIVE'}). Skipping to prevent duplicate signals.`);
        return false;
    }
    const signalHash = `${watcher.id}_${signal.pair}_${signal.direction}_${signal.entryPrice}`;
    try {
        const fifteenMinutesAgoMs = Date.now() - 15 * 60 * 1000;
        for (const [key, ts] of inMemorySignalFingerprints.entries()) {
            if (ts < fifteenMinutesAgoMs) {
                inMemorySignalFingerprints.delete(key);
            }
        }
        if (hasSignalFingerprintsTable) {
            try {
                const fifteenMinutesAgo = new Date(fifteenMinutesAgoMs).toISOString();
                const { data: existingFingerprints, error: fpQueryErr } = await supabase
                    .from('signal_fingerprints')
                    .select('id')
                    .eq('watcher_id', watcher.id)
                    .eq('fingerprint', signalHash)
                    .gte('created_at', fifteenMinutesAgo)
                    .limit(1);
                if (fpQueryErr) {
                    if (fpQueryErr.code === 'PGRST205' || fpQueryErr.message?.includes('schema cache') || fpQueryErr.message?.includes('does not exist')) {
                        hasSignalFingerprintsTable = false;
                    }
                }
                else if (existingFingerprints && existingFingerprints.length > 0) {
                    console.log(`[registerSignal] Duplicate signal fingerprint detected in Supabase for watcher ${watcher.id}. Skipping.`);
                    return false;
                }
            }
            catch (fpQueryErr) {
                if (fpQueryErr?.message?.includes('schema cache') || fpQueryErr?.message?.includes('does not exist')) {
                    hasSignalFingerprintsTable = false;
                }
            }
        }
        if (hasSignalFingerprintsTable) {
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
                    if (insertFpErr.code === 'PGRST205' || insertFpErr.message?.includes('schema cache') || insertFpErr.message?.includes('does not exist')) {
                        hasSignalFingerprintsTable = false;
                    }
                    else if (insertFpErr.code === '23505' || insertFpErr.message?.includes('unique') || insertFpErr.message?.includes('duplicate')) {
                        console.log(`[registerSignal] Duplicate signal fingerprint blocked by database constraint for watcher ${watcher.id}. Skipping.`);
                        return false;
                    }
                    else {
                        console.warn(`[registerSignal] Signal fingerprint persistence notice:`, insertFpErr.message);
                    }
                }
            }
            catch (fpInsertEx) {
                if (fpInsertEx?.message?.includes('schema cache') || fpInsertEx?.message?.includes('does not exist')) {
                    hasSignalFingerprintsTable = false;
                }
            }
        }
        inMemorySignalFingerprints.set(signalHash, Date.now());
        const payload = {
            last_scan_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        try {
            await supabase
                .from("watchers")
                .update(payload)
                .eq("id", watcher.id);
        }
        catch (updateErr) {
            console.warn(`[registerSignal] Watcher timestamp update notice:`, updateErr.message);
        }
        console.log(`[registerSignal] Signal registered successfully in Supabase for ${signal.pair}.`);
        return true;
    }
    catch (err) {
        console.error(`[registerSignal] Exception caught during signal registration:`, err);
        return true;
    }
}
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
export const toCanonicalSymbol = (symbol) => {
    if (!symbol)
        return '';
    return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
};
export const toDisplaySymbol = (symbol) => {
    const canonical = toCanonicalSymbol(symbol);
    const mappings = {
        'EURUSD': 'EUR/USD', 'GBPUSD': 'GBP/USD', 'USDJPY': 'USD/JPY', 'AUDUSD': 'AUD/USD',
        'USDCAD': 'USD/CAD', 'USDCHF': 'USD/CHF', 'NZDUSD': 'NZD/USD', 'BTCUSD': 'BTC/USD',
        'ETHUSD': 'ETH/USD', 'XAUUSD': 'XAU/USD', 'XAGUSD': 'XAG/USD', 'NAS100': 'NAS100',
        'US30': 'US30', 'SPX500': 'SPX500', 'GER30': 'GER30', 'UK100': 'UK100'
    };
    if (mappings[canonical])
        return mappings[canonical];
    if (canonical.length === 6 && /^[A-Z]{6}$/.test(canonical)) {
        return `${canonical.slice(0, 3)}/${canonical.slice(3)}`;
    }
    return canonical;
};
export const mapTimeframeToInterval = (tf) => {
    if (!tf)
        return '1h';
    const u = tf.toUpperCase();
    if (u === 'M1' || u === '1M')
        return '1min';
    if (u === 'M5' || u === '5M')
        return '5min';
    if (u === 'M15' || u === '15M')
        return '15min';
    if (u === 'M30' || u === '30M')
        return '30min';
    if (u === 'H1' || u === '1H')
        return '1h';
    if (u === 'H2' || u === '2H')
        return '2h';
    if (u === 'H4' || u === '4H')
        return '4h';
    if (u === 'D1' || u === 'D' || u === 'DAILY')
        return '1day';
    if (u === 'W1' || u === 'W' || u === 'WEEKLY')
        return '1week';
    return '1h';
};
export async function sendTelegramMessage(chatId, text) {
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
            console.warn(`Telegram API Error: ${response.status} - ${errText}. Retrying without parse_mode...`);
            const fallbackResponse = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, text: text })
            });
            if (!fallbackResponse.ok) {
                const fbErr = await fallbackResponse.text();
                console.error(`Telegram API Error (Plain text fallback): ${fallbackResponse.status} - ${fbErr}`);
                return false;
            }
            return true;
        }
        return true;
    }
    catch (error) {
        console.error("Error sending Telegram message:", error);
        return false;
    }
}
async function fetchWithRetry(url, options = {}, maxRetries = 3, baseDelayMs = 1000) {
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
                return response;
            }
            console.warn(`[Fetch Retry] Attempt ${attempt} returned status ${response.status}. Retrying in ${baseDelayMs * Math.pow(2, attempt - 1)}ms...`);
        }
        catch (err) {
            if (attempt >= maxRetries) {
                throw err;
            }
            console.warn(`[Fetch Retry] Attempt ${attempt} threw network error: ${err.message || err}. Retrying in ${baseDelayMs * Math.pow(2, attempt - 1)}ms...`);
        }
        await new Promise(resolve => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt - 1)));
    }
    throw new Error(`Fetch failed after ${maxRetries} attempts`);
}
const symbolValidationCache = {};
async function validateSymbolWithTwelveData(symbol, apiKey, stats) {
    const res = await defaultMarketDataService.validateSymbol(symbol);
    if (stats) {
        const glob = getMarketDataStats();
        stats.requests = glob.requests;
        stats.cacheHits = glob.cacheHits;
    }
    return res;
}
export async function fetchCurrentPrice(selectedPair, twelveDataKey, stats) {
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
function extractStrategyTextById(strategyTextRaw, strategyId) {
    if (!strategyTextRaw || !strategyTextRaw.trim())
        return DEFAULT_STRATEGY_TEXT;
    const defaultTemplate = `• Entry conditions\n• Confirmation indicators\n• Exit & stop-loss logic\n• Risk management rules`;
    if (strategyTextRaw.trim() === defaultTemplate.trim())
        return DEFAULT_STRATEGY_TEXT;
    try {
        const parsed = JSON.parse(strategyTextRaw);
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.strategies)) {
            const targetId = strategyId || parsed.activeId;
            const active = parsed.strategies.find((s) => {
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
    }
    catch (e) {
    }
    return strategyTextRaw;
}
export default async function handler(req, res) {
    try {
        console.log("[CRON STEP 1] Handler entered");
        const startTime = Date.now();
        const cronTimer = new CronTimer({ warningThresholdMs: 25000, timeLimitMs: 30000 });
        const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
        const twelveDataKey = process.env.TWELVE_DATA_API_KEY;
        const cronSecretRaw = process.env.CRON_SECRET;
        const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
        const liveTradingEnabled = process.env.LIVE_TRADING_ENABLED === 'true';
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
        const supabase = createClient(supabaseUrl, supabaseKey);
        const brokerProvider = getBrokerProvider();
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
        if (req.method === "OPTIONS") {
            return res.status(200).end();
        }
        if (req.method !== 'POST' && req.method !== 'GET') {
            return res.status(405).json({ success: false, error: "Method Not Allowed. Use POST or GET." });
        }
        if (process.env.GLOBAL_TRADING_ENABLED === 'false') {
            console.warn('[Stage 8 Kill Switch] GLOBAL_TRADING_ENABLED is false. Halting all operations.');
            return res.status(200).json({ success: true, message: "Global trading kill switch is ON. No operations performed." });
        }
        let unresolvedAlerts = [];
        try {
            const { data: alerts } = await supabase
                .from('reconciliation_alerts')
                .select('id')
                .eq('is_resolved', false)
                .in('severity', ['CRITICAL', 'HIGH']);
            unresolvedAlerts = alerts || [];
        }
        catch (err) {
            console.error('[CRON ERROR] Failed to fetch reconciliation alerts:', err);
        }
        if (unresolvedAlerts.length > 0) {
            console.error(`[Stage 8 Halt] Found ${unresolvedAlerts.length} unresolved high-severity reconciliation alerts. HALTING TRADING.`);
            return res.status(200).json({
                success: false,
                trading_state: 'RECONCILIATION_HALT',
                error: "Trading halted due to unresolved reconciliation discrepancies. Manual intervention required."
            });
        }
        let watchersProcessedCount = 0;
        let watchersSkippedCount = 0;
        let watchersSkippedWeekendCount = 0;
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
        if (isDebugMode()) {
            console.log("DEBUG CRON AUTH:", {
                method: req.method,
                authorization: req.headers.authorization || req.headers['authorization'] || null,
            });
        }
        const authHeader = req.headers.authorization || req.headers['authorization'] || req.headers['x-cron-secret'] || (req.query && req.query.secret ? `Bearer ${req.query.secret}` : null);
        const cleanCronSecret = cronSecretRaw ? cronSecretRaw.trim().replace(/^['"]|['"]$/g, '').trim() : "";
        if (!cleanCronSecret) {
            console.warn("[CRON SECURITY REJECTED] CRON_SECRET environment variable is missing or empty on server.");
            return res.status(401).json({
                success: false,
                error: "Unauthorized",
                reason: "CRON_SECRET environment variable is not configured or is empty on the server."
            });
        }
        if (!authHeader) {
            console.warn("[CRON SECURITY REJECTED] Missing Authorization header or secret.");
            return res.status(401).json({
                success: false,
                error: "Unauthorized",
                reason: "Authorization header or secret parameter is missing."
            });
        }
        const trimmedHeader = String(authHeader).trim();
        let token = trimmedHeader;
        if (trimmedHeader.toLowerCase().startsWith("bearer ")) {
            token = trimmedHeader.substring(7).trim();
        }
        token = token.replace(/^['"]|['"]$/g, '').trim();
        if (!token || token !== cleanCronSecret) {
            console.warn("[CRON SECURITY REJECTED] Invalid or mismatched Bearer token provided.");
            return res.status(401).json({
                success: false,
                error: "Unauthorized",
                reason: "Invalid or mismatched token."
            });
        }
        console.log("[CRON STEP 2]");
        if (!twelveDataKey) {
            throw new Error("Missing TWELVE_DATA_API_KEY environment variable.");
        }
        const governor = new SafetyGovernor(defaultSafetyLimits);
        const reconService = new BrokerReconciliationService(brokerProvider, supabase);
        let brokerAccount = null;
        try {
            brokerAccount = await brokerProvider.getAccount();
        }
        catch (err) {
            console.error('[CRON ERROR] Failed to fetch broker account:', err);
        }
        if (brokerAccount) {
            const globalHalt = await governor.checkGlobalSafety(brokerAccount, 0, 0);
            if (globalHalt.isHalted) {
                console.warn(`[SAFETY HALT] Trading is globally halted: ${globalHalt.reason}`);
                return res.status(200).json({
                    success: true,
                    message: 'Trading globally halted',
                    reason: globalHalt.reason
                });
            }
        }
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
        const userLastGeminiExecutionMap = new Map();
        const activeUserGeminiPromises = new Map();
        const cronAnalysisCache = new Map();
        const quotaExhaustedUsers = new Set();
        const PROCESSING_DEADLINE_MS = 50000;
        const cronStartedAt = startTime;
        const processingDeadline = cronStartedAt + PROCESSING_DEADLINE_MS;
        function hasProcessingTimeRemaining() {
            return Date.now() < processingDeadline;
        }
        function remainingProcessingMs() {
            return Math.max(0, processingDeadline - Date.now());
        }
        const userIds = watchers ? Array.from(new Set(watchers.map(w => w.user_id))) : [];
        const [profilesRes, prefsRes, telegramRes, apiKeysRes, propFirmRes] = await Promise.all([
            (async () => {
                try {
                    return await supabase.from('profiles').select('*').in('id', userIds);
                }
                catch (err) {
                    console.error('[CRON PREFETCH ERROR] Profiles lookup failed:', err);
                    return { data: null, error: err };
                }
            })(),
            (async () => {
                try {
                    return await supabase.from('trading_preferences').select('*').in('user_id', userIds);
                }
                catch (err) {
                    console.error('[CRON PREFETCH ERROR] Prefs lookup failed:', err);
                    return { data: null, error: err };
                }
            })(),
            (async () => {
                try {
                    return await supabase.from('telegram_connections').select('*').in('user_id', userIds);
                }
                catch (err) {
                    console.error('[CRON PREFETCH ERROR] Telegram lookup failed:', err);
                    return { data: null, error: err };
                }
            })(),
            (async () => {
                try {
                    return await supabase.from('user_api_keys').select('*').eq('provider', 'gemini').in('user_id', userIds);
                }
                catch (err) {
                    console.error('[CRON PREFETCH ERROR] API Keys lookup failed:', err);
                    return { data: null, error: err };
                }
            })(),
            (async () => {
                try {
                    return await supabase.from('prop_firm_settings').select('*').in('user_id', userIds);
                }
                catch (err) {
                    console.error('[CRON PREFETCH ERROR] Prop Firm Settings lookup failed:', err);
                    return { data: null, error: err };
                }
            })()
        ]);
        const allProfiles = profilesRes?.data || [];
        const allPrefs = prefsRes?.data || [];
        const allTelegram = telegramRes?.data || [];
        const allApiKeys = apiKeysRes?.data || [];
        const allPropFirm = propFirmRes?.data || [];
        const profileMap = new Map(allProfiles.map(p => [p.id, p]));
        const prefsMap = new Map(allPrefs.map(p => [p.user_id, p]));
        const telegramMap = new Map(allTelegram.map(t => [t.user_id, t]));
        const apiKeysMap = new Map(allApiKeys.map(k => [k.user_id, k]));
        const propFirmMap = new Map(allPropFirm.map(p => [p.user_id, p]));
        const cronCandleCache = new Map();
        const cronPriceCache = new Map();
        const uniqueMarketDataKeysInCron = new Set();
        let twelveDataRequestsInCron = 0;
        let twelveDataCacheHitsInCron = 0;
        let twelveDataDeduplicationsInCron = 0;
        let twelveDataTimeoutsInCron = 0;
        let twelveDataInvalidResponsesInCron = 0;
        let twelveDataStaleDataSkipsInCron = 0;
        const uniqueRequests = new Set();
        const requestArgs = [];
        if (watchers) {
            for (const w of watchers) {
                const symbol = w.selected_pair || w.pair;
                const timeframe = w.selected_timeframe || w.timeframe;
                if (symbol && timeframe) {
                    const canonical = toCanonicalSymbol(symbol);
                    const reqKey = `${canonical}:${timeframe}`;
                    if (!uniqueRequests.has(reqKey)) {
                        uniqueRequests.add(reqKey);
                        requestArgs.push({
                            symbol,
                            timeframe,
                            requiredCount: getRequiredCandleCountForTimeframe(timeframe)
                        });
                    }
                }
            }
        }
        if (requestArgs.length > 0) {
            console.log(`[PRE-FETCH] Fetching market data for ${requestArgs.length} unique pairs...`);
            await Promise.all(requestArgs.map(args => fetchMarketDataForCron(args).catch(() => null)));
        }
        let earlyExit = false;
        let earlyExitReason = "";
        let gemini503CountInCron = 0;
        let geminiTemporarilyUnavailable = false;
        async function fetchMarketDataForCron(reqArgs) {
            const canonical = toCanonicalSymbol(reqArgs.symbol);
            const cacheKey = `twelve-data:${canonical}:${reqArgs.timeframe}:${reqArgs.requiredCount}`;
            uniqueMarketDataKeysInCron.add(cacheKey);
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
                return cronCandleCache.get(cacheKey);
            }
            const promise = (async () => {
                const res = await defaultMarketDataService.getMarketData(reqArgs);
                if (res.fromCache) {
                    twelveDataCacheHitsInCron++;
                    requestsSavedThroughCachingCount++;
                }
                else if (res.isValid) {
                    twelveDataRequestsInCron++;
                    totalTwelveDataRequests++;
                }
                else {
                    if (res.reason === 'TWELVE_DATA_TIMEOUT')
                        twelveDataTimeoutsInCron++;
                    if (res.reason === 'MARKET_DATA_INVALID' || res.reason === 'TWELVE_DATA_INVALID_RESPONSE')
                        twelveDataInvalidResponsesInCron++;
                    if (res.reason === 'TWELVE_DATA_STALE')
                        twelveDataStaleDataSkipsInCron++;
                    if (res.reason === 'TWELVE_DATA_RATE_LIMITED' || res.errorType === 'QUOTA_EXHAUSTED')
                        watchersSkippedDueToRateLimitCount++;
                }
                return res;
            })();
            cronCandleCache.set(cacheKey, promise);
            return promise;
        }
        async function fetchCurrentPriceForCron(selectedPair, twelveDataKeyStr, stats) {
            const canonical = toCanonicalSymbol(selectedPair);
            if (cronPriceCache.has(canonical)) {
                twelveDataCacheHitsInCron++;
                requestsSavedThroughCachingCount++;
                return cronPriceCache.get(canonical);
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
        if (watchers && watchers.length > 0) {
            watchers.sort((a, b) => {
                const aCandle = a.last_analyzed_closed_candle_time || '';
                const bCandle = b.last_analyzed_closed_candle_time || '';
                if (!aCandle && bCandle)
                    return -1;
                if (aCandle && !bCandle)
                    return 1;
                const aScan = a.last_scan_at ? new Date(a.last_scan_at).getTime() : 0;
                const bScan = b.last_scan_at ? new Date(b.last_scan_at).getTime() : 0;
                return aScan - bScan;
            });
        }
        if (isDebugMode()) {
            console.log(`LOG: Processing ${watchers.length} active watcher(s) sequentially with strict 25s global deadline...`);
        }
        async function processSingleWatcher(watcher, brokerAccount) {
            let isWatcherSkipped = true;
            let geminiInvoked = false;
            let geminiSucceeded = false;
            let geminiDecision = null;
            const userId = watcher?.user_id || 'unknown';
            const logCtx = await resolveWatcherUserContext(supabase, watcher);
            const userEmail = logCtx.userEmail;
            const selectedPair = toCanonicalSymbol(watcher?.selected_pair || "") || watcher?.selected_pair || 'unknown';
            const symbol = selectedPair;
            const selectedTimeframe = logCtx.timeframe;
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
                const userProfile = profileMap.get(userId) || null;
                logWatcherEvent('WATCHER START', logCtx, `Status: ${watcher.status}`);
                const telegramConn = telegramMap.get(userId);
                const telegramChatId = (telegramConn && telegramConn.connected) ? telegramConn.telegram_chat_id : (watcher.telegram_chat_id || null);
                if (brokerAccount?.equity) {
                    const profitGoal = await syncProfitGoal(supabase, userId, brokerAccount.equity, telegramChatId);
                    if (profitGoal && profitGoal.status === 'AWAITING_DECISION') {
                        console.log(`[PROFIT GOAL PROTECTION] Watcher ${watcher.id} paused - User needs to decide on expired goal.`);
                        skipped.push({ userId, reason: "Profit goal expired. Awaiting user decision (Extend/Skip)." });
                        watchersSkippedCount++;
                        return;
                    }
                    if (profitGoal && profitGoal.status === 'COMPLETED') {
                        console.log(`[PROFIT GOAL COMPLETED] Goal reached. Trading paused for this challenge.`);
                        skipped.push({ userId, reason: "Profit goal reached. Challenge completed." });
                        watchersSkippedCount++;
                        return;
                    }
                }
                watchersReadyCount++;
                cronTimer.startStage("Watcher Scheduling & Due Check", watcher?.id);
                let tradeStatus = (watcher.trade_status || 'WAITING').toUpperCase().trim();
                const now = new Date();
                const scanIntervalMinutes = getScanIntervalMinutes(watcher);
                let lastScanDate = null;
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
                const marketSchedule = getMarketSchedule(selectedPair, now);
                if (!marketSchedule.isOpen && marketSchedule.closesOnWeekends) {
                    logWatcherEvent('WEEKEND SKIP', logCtx, {
                        'Pair': selectedPair,
                        'Asset Class': marketSchedule.assetClass,
                        'Market Status': 'WEEKEND_CLOSED',
                        'Reason': marketSchedule.reason,
                        'Reason WAT': marketSchedule.reasonWat,
                        'Next Open (WAT / Nigeria)': marketSchedule.nextOpenWatFormatted || 'Sunday 10:00 PM WAT',
                        'Next Open (NY)': marketSchedule.nextOpenTimeFormatted || 'Sunday 5:00 PM ET',
                        'Current WAT Time': marketSchedule.currentWatTime.formatted,
                        'Current NY Time': marketSchedule.currentNyTime.formatted,
                        'Action': 'Candle download excluded on weekends'
                    });
                    console.log(`[WEEKEND MARKET EXCLUDED] Watcher ${watcher.id} (${selectedPair}): Market closed for weekend. Next open: ${marketSchedule.nextOpenWatFormatted || 'Sunday 10:00 PM WAT'} (${marketSchedule.nextOpenTimeFormatted || 'Sunday 5:00 PM ET'}). Candle downloads paused.`);
                    skipped.push({
                        userId,
                        reason: `Market closed for weekend (${selectedPair} ${marketSchedule.assetClass} - ${marketSchedule.reasonWat}). Next open: ${marketSchedule.nextOpenWatFormatted || 'Sunday 10:00 PM WAT'}`
                    });
                    watchersSkippedWeekendCount++;
                    watchersSkippedCount++;
                    return;
                }
                cronTimer.startStage("CAS Idempotency Lock", watcher.id);
                const lockTime = now.toISOString();
                let lockQuery = supabase.from("watchers").update({ last_scan_at: lockTime }).eq("id", watcher.id);
                if (watcher.last_scan_at) {
                    lockQuery = lockQuery.eq("last_scan_at", watcher.last_scan_at);
                }
                else {
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
                if (tradeStatus === 'COOLDOWN') {
                    cronTimer.startStage("State 3 - Cooldown Check", watcher.id);
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
                    }
                    else {
                        console.log(`[COOLDOWN RESET SUCCESS] Watcher ID: ${watcher.id} successfully reset to WAITING in Supabase.`);
                    }
                    watchersProcessedCount++;
                    isWatcherSkipped = false;
                    results.push({ userId, symbol, tradeStatus: 'COOLDOWN', result: 'Cooldown expired, reset to WAITING' });
                    return;
                }
                console.log(`ENTERING ACTIVE`);
                if (tradeStatus === 'ACTIVE') {
                    cronTimer.startStage("State 2 - Active Trade Monitoring", watcher.id);
                    console.log(`[BRANCH EXECUTED] ACTIVE branch (Price Monitoring Only) for Watcher ID: ${watcher.id}`);
                    const activeValidation = validateActiveTradeState(watcher);
                    if (!activeValidation.valid) {
                        let currentPriceFetch = null;
                        try {
                            currentPriceFetch = await fetchCurrentPriceForCron(selectedPair, twelveDataKey, tdStats);
                        }
                        catch (e) { }
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
                        }
                        else {
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
                    const isLiveExecution = (process.env.EXECUTION_MODE || '').toUpperCase() === 'LIVE' && watcher.execution_source === 'LIVE';
                    if (isLiveExecution && watcher.active_trade_id) {
                        const brokerPos = await brokerProvider.getPosition(selectedPair);
                        if (!brokerPos) {
                            logWatcherWarn('TRADE RECONCILIATION', logCtx, `Active trade ${watcher.active_trade_id} not found at broker. Closing in DB.`);
                            const history = await brokerProvider.getExecutionHistory(selectedPair, 5);
                            const closeExecution = history.find(e => e.orderId === watcher.active_trade_id || e.symbol === selectedPair);
                            const closePrice = closeExecution?.price || 0;
                            const pnl = await brokerProvider.getTradePnL(watcher.active_trade_id);
                            await recordCompletedTrade(supabase, {
                                user_id: userId,
                                watcher_id: watcher.id,
                                trade_id: watcher.active_trade_id,
                                pair: selectedPair,
                                timeframe: selectedTimeframe,
                                strategy_mode: watcher.strategy_mode || "HYBRID",
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
                                cooldown_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                                updated_at: new Date().toISOString()
                            }).eq("id", watcher.id);
                            if (telegramChatId) {
                                await sendTelegramMessage(telegramChatId, `🔔 Broker Reconciliation\nTrade for ${selectedPair} was closed at broker. Database synchronized.`);
                            }
                            return;
                        }
                        else {
                            logWatcherEvent('TRADE RECONCILIATION', logCtx, `Trade confirmed at broker: ${watcher.active_trade_id}`);
                        }
                    }
                    let currentPrice = null;
                    if (twelveDataExhausted) {
                        logWatcherWarn('LIVE RATES ERROR', logCtx, 'TwelveData rate limit (429) exhausted. Deferring until next cron cycle.');
                        skipped.push({ userId, reason: "TwelveData rate limit (429) exhausted" });
                        watchersSkippedDueToRateLimitCount++;
                        watchersSkippedCount++;
                        return;
                    }
                    try {
                        currentPrice = await fetchCurrentPriceForCron(selectedPair, twelveDataKey, tdStats);
                    }
                    catch (err) {
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
                    await syncPropFirmStateForActiveWatcher({
                        supabase,
                        userId,
                        rawAccountType: prefsMap.get(userId)?.account_type,
                        symbol: selectedPair,
                        currentMarketPrice: currentPrice
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
                    }
                    else if (isSell) {
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
                    if (isTP) {
                        console.log(`[STATE 2 - ACTIVE] ✅ Target reached for Watcher ID: ${watcher.id} (${selectedPair})! Exit price: ${currentPrice}, TP: ${takeProfit}`);
                        let latestEval = null;
                        try {
                            const { data } = await supabase
                                .from('watcher_evaluations')
                                .select('*')
                                .eq('watcher_id', watcher.id)
                                .order('created_at', { ascending: false })
                                .limit(1)
                                .maybeSingle();
                            latestEval = data;
                        }
                        catch (e) {
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
                        if (telegramChatId) {
                            try {
                                const stats = await getUserWinRateStats(supabase, userId, selectedPair);
                                const pipsDistance = Math.abs(calculatePipsDistance(selectedPair, entryPrice || currentPrice, currentPrice));
                                const realizedR = calculateUnrealizedPnlR(dir, entryPrice || currentPrice, stopLoss || 0, currentPrice);
                                const tpMsg = buildTelegramTradeOutcomeMessage({
                                    pair: selectedPair,
                                    direction: dir,
                                    entryPrice: entryPrice || 0,
                                    exitPrice: currentPrice,
                                    stopLoss,
                                    takeProfit,
                                    outcome: 'WIN',
                                    pips: pipsDistance,
                                    realizedR: realizedR > 0 ? realizedR : 2.0,
                                    totalTrades: stats.totalTrades,
                                    wins: stats.wins,
                                    losses: stats.losses,
                                    winRate: stats.winRate,
                                    pairTotalTrades: stats.pairTotalTrades,
                                    pairWins: stats.pairWins,
                                    pairWinRate: stats.pairWinRate
                                });
                                await sendTelegramMessage(telegramChatId, tpMsg);
                                telegramMessagesSentCount++;
                            }
                            catch (tgErr) {
                                console.error(`[TELEGRAM OUTCOME ERROR] Error sending TP outcome message:`, tgErr);
                            }
                        }
                        const { data: tpCooldownData, error: tpCooldownErr } = await supabase
                            .from("watchers")
                            .update({
                            trade_status: 'COOLDOWN',
                            active_trade_id: null,
                            zone_data: null,
                            zone_status: 'NO_ZONE',
                            zone_high: null,
                            zone_low: null,
                            closed_at: new Date().toISOString(),
                            cooldown_until: cooldownUntilIso,
                            last_scan_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        })
                            .eq("id", watcher.id)
                            .select();
                        if (tpCooldownErr || !tpCooldownData || tpCooldownData.length === 0) {
                            console.error(`[COOLDOWN UPDATE ERROR] Watcher ID: ${watcher.id} failed to update to COOLDOWN:`, tpCooldownErr?.message || 'No rows returned');
                        }
                        else {
                            console.log(`[COOLDOWN UPDATE SUCCESS] Watcher ID: ${watcher.id} successfully updated to trade_status = COOLDOWN in Supabase.`);
                        }
                        await syncPropFirmStateForActiveWatcher({
                            supabase,
                            userId,
                            rawAccountType: prefsMap.get(userId)?.account_type,
                            symbol: selectedPair,
                            currentMarketPrice: currentPrice
                        });
                        watchersProcessedCount++;
                        isWatcherSkipped = false;
                        results.push({ userId, symbol, tradeStatus: 'COOLDOWN', result: 'Closed TP' });
                        console.log(`ACTIVE branch exited.`);
                        return;
                    }
                    if (isSL) {
                        console.log(`[STATE 2 - ACTIVE] ❌ Stop loss hit for Watcher ID: ${watcher.id} (${selectedPair})! Exit price: ${currentPrice}, SL: ${stopLoss}`);
                        let latestEval = null;
                        try {
                            const { data } = await supabase
                                .from('watcher_evaluations')
                                .select('*')
                                .eq('watcher_id', watcher.id)
                                .order('created_at', { ascending: false })
                                .limit(1)
                                .maybeSingle();
                            latestEval = data;
                        }
                        catch (e) {
                            console.warn('[Learning Engine] Could not fetch latest evaluation:', e.message);
                        }
                        const activeTradeIdSL = watcher.active_trade_id || watcher.last_signal_data?.trade_id || watcher.last_signal_data?.tradeId || null;
                        let lossPostMortem = null;
                        try {
                            lossPostMortem = diagnoseLossOutcome({
                                pair: selectedPair,
                                timeframe: selectedTimeframe,
                                direction: dir,
                                entryPrice: entryPrice || 0,
                                stopLoss: stopLoss,
                                takeProfit: takeProfit,
                                exitPrice: currentPrice,
                                openedAt: watcher.opened_at,
                                closedAt: new Date().toISOString(),
                                matchedRules: latestEval?.matched_rules || [],
                                failedRules: latestEval?.failed_rules || []
                            });
                        }
                        catch (pmErr) {
                            console.warn("[Post-Mortem Engine] Failed to diagnose loss in market-watcher.ts:", pmErr);
                        }
                        const decisionSnapshotWithPM = {
                            ...(latestEval?.decision_snapshot || {}),
                            ...(lossPostMortem ? { loss_post_mortem: lossPostMortem } : {})
                        };
                        const notesWithPM = lossPostMortem
                            ? `Trade closed via SL. Exit: ${currentPrice}. AI Post-Mortem: ${lossPostMortem.rootCauseTitle} - ${lossPostMortem.preventiveAdjustment}`
                            : `Trade closed via SL. Exit Price: ${currentPrice}`;
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
                            market_snapshot: lossPostMortem ? { loss_post_mortem: lossPostMortem } : {},
                            session: null,
                            volatility: 'MEDIUM',
                            notes: notesWithPM,
                            decision_snapshot: decisionSnapshotWithPM
                        });
                        if (telegramChatId) {
                            try {
                                const stats = await getUserWinRateStats(supabase, userId, selectedPair);
                                const pipsDistance = Math.abs(calculatePipsDistance(selectedPair, entryPrice || currentPrice, currentPrice));
                                const slMsg = buildTelegramTradeOutcomeMessage({
                                    pair: selectedPair,
                                    direction: dir,
                                    entryPrice: entryPrice || 0,
                                    exitPrice: currentPrice,
                                    stopLoss,
                                    takeProfit,
                                    outcome: 'LOSS',
                                    pips: pipsDistance,
                                    realizedR: -1.0,
                                    totalTrades: stats.totalTrades,
                                    wins: stats.wins,
                                    losses: stats.losses,
                                    winRate: stats.winRate,
                                    pairTotalTrades: stats.pairTotalTrades,
                                    pairWins: stats.pairWins,
                                    pairWinRate: stats.pairWinRate,
                                    lossPostMortem
                                });
                                await sendTelegramMessage(telegramChatId, slMsg);
                                telegramMessagesSentCount++;
                            }
                            catch (tgErr) {
                                console.error(`[TELEGRAM OUTCOME ERROR] Error sending SL outcome message:`, tgErr);
                            }
                        }
                        const cooldownUntilSl = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
                        console.log(`[LOSS COOLDOWN] Watcher ${watcher.id} entered 4-hour cooldown after STOP_LOSS.`);
                        const { data: slCooldownData, error: slCooldownErr } = await supabase
                            .from("watchers")
                            .update({
                            trade_status: 'COOLDOWN',
                            active_trade_id: null,
                            zone_data: null,
                            zone_status: 'NO_ZONE',
                            zone_high: null,
                            zone_low: null,
                            closed_at: new Date().toISOString(),
                            cooldown_until: cooldownUntilSl,
                            last_scan_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        })
                            .eq("id", watcher.id)
                            .select();
                        if (slCooldownErr || !slCooldownData || slCooldownData.length === 0) {
                            console.error(`[COOLDOWN UPDATE ERROR] Watcher ID: ${watcher.id} failed to update to COOLDOWN:`, slCooldownErr?.message || 'No rows returned');
                        }
                        else {
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
                console.log(`ENTERING WAITING`);
                if (tradeStatus !== 'WAITING') {
                    console.warn(`[STATE GUARD] Watcher ID: ${watcher.id} is in status '${tradeStatus}' (not WAITING). Bypassing signal generation.`);
                    return;
                }
                const cleanPairUpper = (selectedPair || '').replace('/', '').toUpperCase();
                let hasActiveTradeOnPair = (watchers || []).some((w) => {
                    if (w.user_id !== userId)
                        return false;
                    const wPair = (w.selected_pair || w.symbol || '').replace('/', '').toUpperCase();
                    return wPair === cleanPairUpper && (w.trade_status || '').toUpperCase() === 'ACTIVE';
                });
                if (!hasActiveTradeOnPair) {
                    try {
                        const { data: dbActiveList } = await supabase
                            .from("watchers")
                            .select("id, selected_pair, trade_status, status")
                            .eq("user_id", userId)
                            .eq("status", "active")
                            .eq("trade_status", "ACTIVE");
                        if (dbActiveList && dbActiveList.length > 0) {
                            hasActiveTradeOnPair = dbActiveList.some((w) => {
                                const p = (w.selected_pair || '').replace('/', '').toUpperCase();
                                return p === cleanPairUpper;
                            });
                        }
                    }
                    catch (dbErr) {
                    }
                }
                if (hasActiveTradeOnPair) {
                    console.log(`[ACTIVE TRADE LOCK] Pair ${selectedPair} currently has an ACTIVE trade in progress. Skipping zone marking until the active trade hits TP or SL.`);
                    watchersProcessedCount++;
                    isWatcherSkipped = false;
                    results.push({ userId, symbol: selectedPair, tradeStatus: 'WAITING', result: 'Active trade open on pair; awaiting TP or SL before marking new zone.' });
                    return;
                }
                cronTimer.startStage("State 1 - Load Preferences & Strategy", watcher.id);
                console.log(`[BRANCH EXECUTED] WAITING branch for Watcher ID: ${watcher.id}`);
                let executionLogs = [];
                const addLog = (message, type = 'info') => {
                    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
                    executionLogs.push({ time, message, type });
                };
                addLog("Cron Started", "success");
                addLog("Watcher Due / Grace Window Passed", "success");
                let scanStart = 0;
                try {
                    addLog("Watcher Loaded", "success");
                    addLog(`Pair: ${selectedPair}`);
                    const prefsRecord = prefsMap.get(userId);
                    const apiKeyRecord = apiKeysMap.get(userId);
                    const rawStrategyText = prefsRecord?.strategy_text;
                    let executionMode = 'HYBRID';
                    if (prefsRecord?.account_type) {
                        const amMatch = prefsRecord.account_type.match(/ANALYSIS:([^|]+)/);
                        if (amMatch) {
                            const parsed = amMatch[1];
                            if (parsed === 'RULE_ONLY' || parsed === 'AI_ONLY') {
                                executionMode = parsed;
                            }
                        }
                    }
                    if (MARKET_WATCHER_DECISION_MODE_OVERRIDE) {
                        executionMode = MARKET_WATCHER_DECISION_MODE_OVERRIDE;
                    }
                    console.log(`[DECISION MODE] ${executionMode}${MARKET_WATCHER_DECISION_MODE_OVERRIDE ? ' (TEMPORARY OVERRIDE)' : ''}`);
                    console.log(`[ANALYSIS MODE] Watcher: ${watcher.id} | Resulting Mode: ${executionMode}`);
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
                    if (!telegramChatId) {
                        console.log(`LOG: Watcher ${watcher.id} skipped - Telegram not connected`);
                        skipped.push({ userId, reason: "Telegram not connected" });
                        watchersSkippedCount++;
                        return;
                    }
                    const rawAccountType = prefsRecord?.account_type;
                    const resolvedAccountType = resolvePersistedAccountType(rawAccountType);
                    let accountSize;
                    let riskPercentage;
                    let riskRewardStr;
                    let maxDailyRiskStr;
                    let maxDailyLossAmount = 100;
                    let positionMode = 'AUTO_RISK';
                    let preferredLotSize;
                    if (resolvedAccountType === 'prop') {
                        const propFirmSettings = propFirmMap.get(userId);
                        if (!propFirmSettings) {
                            console.log(`[ACCOUNT CONFIG] Watcher ${watcher.id} skipped - Prop firm settings missing for user ${userId} (PROP_FIRM_SETTINGS_UNAVAILABLE)`);
                            skipped.push({ userId, reason: "PROP_FIRM_SETTINGS_UNAVAILABLE" });
                            watchersSkippedCount++;
                            return;
                        }
                        accountSize = Number(propFirmSettings.account_size);
                        if (!Number.isFinite(accountSize) || accountSize <= 0) {
                            console.log(`[ACCOUNT CONFIG] Watcher ${watcher.id} skipped - Invalid Prop Firm account_size (${propFirmSettings.account_size})`);
                            skipped.push({ userId, reason: "INVALID_PROP_FIRM_ACCOUNT_SIZE" });
                            watchersSkippedCount++;
                            return;
                        }
                        const rawRiskPerTrade = Number(propFirmSettings.risk_per_trade);
                        if (propFirmSettings.risk_per_trade_type === 'PERCENTAGE') {
                            riskPercentage = rawRiskPerTrade;
                        }
                        else {
                            riskPercentage = (rawRiskPerTrade / accountSize) * 100;
                        }
                        if (!Number.isFinite(riskPercentage) || riskPercentage <= 0) {
                            console.log(`[ACCOUNT CONFIG] Watcher ${watcher.id} skipped - Invalid Prop Firm risk_per_trade (${propFirmSettings.risk_per_trade})`);
                            skipped.push({ userId, reason: "INVALID_PROP_FIRM_RISK_PER_TRADE" });
                            watchersSkippedCount++;
                            return;
                        }
                        riskRewardStr = prefsRecord?.risk_reward || '1:2';
                        maxDailyRiskStr = propFirmSettings.daily_loss_limit !== null && propFirmSettings.daily_loss_limit !== undefined
                            ? `${propFirmSettings.daily_loss_limit}%`
                            : '5%';
                        maxDailyLossAmount = propFirmSettings.daily_loss_limit_type === 'PERCENTAGE'
                            ? (accountSize * Number(propFirmSettings.daily_loss_limit || 5)) / 100
                            : Number(propFirmSettings.daily_loss_limit || 500);
                        positionMode = 'AUTO_RISK';
                        preferredLotSize = undefined;
                        console.log(`\n[ACCOUNT CONFIG]`);
                        console.log(`Type: PROP FIRM`);
                        console.log(`Firm: ${propFirmSettings.firm_name || 'Generic'}`);
                        console.log(`Phase: ${propFirmSettings.account_phase || 'Phase 1'}`);
                        console.log(`Account Size: $${accountSize.toLocaleString()}`);
                        console.log(`Risk Per Trade: ${riskPercentage}%`);
                        console.log(`Daily Loss Limit: ${propFirmSettings.daily_loss_limit ?? 'N/A'}${propFirmSettings.daily_loss_limit_type === 'PERCENTAGE' ? '%' : '$'} (${propFirmSettings.daily_loss_calculation_basis || 'BALANCE'})`);
                        console.log(`Max Drawdown: ${propFirmSettings.maximum_drawdown ?? 'N/A'}${propFirmSettings.drawdown_type === 'TRAILING' ? '% (TRAILING)' : '% (STATIC)'}`);
                        console.log(`Strategy: ${strategyText ? strategyText.substring(0, 100) + '...' : 'N/A'}`);
                    }
                    else if (resolvedAccountType === 'personal') {
                        let riskPrefs;
                        try {
                            riskPrefs = extractRiskPreferences(prefsRecord, userId);
                            accountSize = riskPrefs.accountSize;
                            riskPercentage = riskPrefs.riskPercentage;
                            riskRewardStr = riskPrefs.riskRewardStr;
                            maxDailyRiskStr = riskPrefs.maxDailyRiskStr;
                            maxDailyLossAmount = riskPrefs.maxDailyLossAmount || 100;
                            positionMode = riskPrefs.positionMode;
                            preferredLotSize = riskPrefs.preferredLotSize;
                        }
                        catch (prefsErr) {
                            console.log(`LOG: Watcher ${watcher.id} skipped - ${prefsErr.message}`);
                            skipped.push({ userId, reason: prefsErr.message });
                            watchersSkippedCount++;
                            return;
                        }
                        console.log(`\n[ACCOUNT CONFIG]`);
                        console.log(`Type: PERSONAL`);
                        console.log(`Account Size: $${accountSize}`);
                        console.log(`Risk: ${riskPercentage}%`);
                        console.log(`Risk Reward: ${riskRewardStr}`);
                        console.log(`Max Daily Risk: ${maxDailyRiskStr}`);
                        console.log(`Position Mode: ${positionMode}`);
                        console.log(`Strategy: ${strategyText ? strategyText.substring(0, 100) + '...' : 'N/A'}`);
                    }
                    else {
                        console.log(`[ACCOUNT CONFIG] Watcher ${watcher.id} skipped - Account type is unconfigured or invalid (${rawAccountType})`);
                        skipped.push({ userId, reason: "ACCOUNT_TYPE_UNCONFIGURED" });
                        watchersSkippedCount++;
                        return;
                    }
                    if (executionMode !== 'RULE_ONLY' && (!apiKeyRecord || !apiKeyRecord.api_key)) {
                        console.log(`LOG: Watcher ${watcher.id} skipped - Gemini API Key missing (Execution mode is ${executionMode})`);
                        skipped.push({ userId, reason: "Gemini API Key missing" });
                        watchersSkippedCount++;
                        return;
                    }
                    const mappedSymbol = toDisplaySymbol(selectedPair);
                    let quoteData = null;
                    let candleData = [];
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
                        }
                        else {
                            console.warn(`[Twelve Data API] error for ${mappedSymbol}: ${tsResult.reason}`);
                        }
                    }
                    else {
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
                    addLog("Strategy Compiled", "success");
                    cronTimer.startStage("Market Structure & Strategy Compilation", watcher.id);
                    const compiledStrategy = compileStrategy(strategyText);
                    const strategyCompilationConfidenceRecord = normalizeConfidence(compiledStrategy.overall_confidence ?? compiledStrategy.confidence, 'strategy_compilation', 'Strategy Compiler');
                    const strategyCompilationConfidence = strategyCompilationConfidenceRecord.normalized;
                    const marketStructure = extractMarketStructure(candleData, compiledStrategy.detector_validation?.supported_detectors);
                    const htfPreference = compiledStrategy.compiled_rules?.preferred_htf || 'H4';
                    const htfTrendResult = await resolveHigherTimeframeTrend(selectedPair, candleData, selectedTimeframe, { preferredHtf: htfPreference });
                    marketStructure.htfTrend = htfTrendResult.trend;
                    marketStructure.htfTimeframe = htfTrendResult.timeframe;
                    marketStructure.htfReason = htfTrendResult.reason;
                    marketStructure.htfAllowedDirection = htfTrendResult.allowedDirection;
                    marketStructure.htfBiasAligned = true;
                    console.log(`[HTF TREND] Watcher ID: ${watcher.id} (${selectedPair}): ${htfTrendResult.timeframe} Trend is ${htfTrendResult.trend} (${htfTrendResult.reason}). Enforcing trend-following zone markout.`);
                    logWatcherEvent('HTF TREND EVALUATION', logCtx, {
                        'HTF Timeframe': htfTrendResult.timeframe,
                        'HTF Trend': htfTrendResult.trend,
                        'Allowed Direction': htfTrendResult.allowedDirection,
                        'Reason': htfTrendResult.reason
                    });
                    if (htfTrendResult.trend === 'SIDEWAYS' || htfTrendResult.allowedDirection === 'NONE') {
                        console.log(`[HTF SIDEWAYS NO-TRADE] Watcher ID: ${watcher.id} (${selectedPair}): ${htfTrendResult.timeframe} Trend is SIDEWAYS / unclear (${htfTrendResult.reason}). Defaulting strictly to NO TRADE.`);
                        logWatcherEvent('SIDEWAYS NO TRADE', logCtx, `Higher timeframe (${htfTrendResult.timeframe}) trend is SIDEWAYS / unclear. Enforcing default NO TRADE.`);
                        if (activeZonesMemoryMap.has(watcher.id) || watcher.zone_data) {
                            activeZonesMemoryMap.delete(watcher.id);
                            await supabase.from("watchers").update({
                                zone_data: null,
                                zone_status: 'NO_ZONE',
                                zone_high: null,
                                zone_low: null,
                                zone_type: null,
                                zone_invalidation_level: null,
                                updated_at: new Date().toISOString()
                            }).eq("id", watcher.id);
                        }
                        const scanDurationMs = Date.now() - scanStart;
                        await recordEvaluation(supabase, {
                            watcher_id: watcher.id,
                            user_id: userId,
                            pair: selectedPair,
                            timeframe: selectedTimeframe,
                            strategy_mode: executionMode,
                            decision_score: 0,
                            matched_weight: 0,
                            possible_weight: 0,
                            recommendation: 'FAIL',
                            mandatory_rules_passed: false,
                            matched_rules: [],
                            failed_rules: [`Higher timeframe (${htfTrendResult.timeframe}) trend is SIDEWAYS / unclear`],
                            gemini_used: false,
                            trade_sent: false,
                            trade_reason: `Higher timeframe (${htfTrendResult.timeframe}) trend is SIDEWAYS / unclear: ${htfTrendResult.reason}. Defaulting strictly to NO TRADE until a clear trend is established.`,
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
                        results.push({ userId, symbol: selectedPair, tradeStatus: 'SIDEWAYS_NO_TRADE', result: 'Trend is sideways or unclear. Defaulting to NO TRADE.' });
                        return;
                    }
                    cronTimer.startStage("Stateful Zone Evaluation", watcher.id);
                    const latestCandle = candleData[candleData.length - 1];
                    const activeCurrentPrice = latestCandle?.close || 0;
                    let currentZone = null;
                    if (watcher.zone_data) {
                        try {
                            currentZone = typeof watcher.zone_data === 'string' ? JSON.parse(watcher.zone_data) : watcher.zone_data;
                        }
                        catch (e) {
                            currentZone = null;
                        }
                    }
                    if (!currentZone && activeZonesMemoryMap.has(watcher.id)) {
                        currentZone = activeZonesMemoryMap.get(watcher.id) || null;
                        if (currentZone) {
                            console.log(`[ZONE MEMORY RESTORE] Watcher ID: ${watcher.id}: Retained active ${currentZone.type} zone [${currentZone.low} - ${currentZone.high}] (${currentZone.direction}) from runtime memory.`);
                        }
                    }
                    let lastZoneEval = null;
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
                            currentZone = null;
                        }
                        else if (!zoneEval.isTapped) {
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
                                strategy_mode: executionMode,
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
                        }
                        else {
                            const isLiveInZone = activeCurrentPrice >= currentZone.low && activeCurrentPrice <= currentZone.high;
                            const tapStatusMsg = isLiveInZone
                                ? `Price ${activeCurrentPrice} tapped marked zone [${currentZone.low} - ${currentZone.high}] (${currentZone.type})`
                                : `Marked zone [${currentZone.low} - ${currentZone.high}] (${currentZone.type}) was tapped (Current Price: ${activeCurrentPrice})`;
                            console.log(`[ZONE TAPPED] Watcher ID: ${watcher.id} (${selectedPair}): ${tapStatusMsg}. Proceeding to confirmation analysis.`);
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
                    if (!currentZone) {
                        const isActuallyActive = (tradeStatus === 'ACTIVE' || watcher.trade_status === 'ACTIVE' || watcher.active_trade_id || hasActiveTradeOnPair) && watcher.status === 'active';
                        if (isActuallyActive) {
                            console.log(`[ZONE MARKING BLOCKED] Watcher ID: ${watcher.id} (${selectedPair}) has an active trade in progress. Must hit TP or SL before marking another zone.`);
                            watchersProcessedCount++;
                            isWatcherSkipped = false;
                            results.push({ userId, symbol: selectedPair, tradeStatus: watcher.trade_status, result: 'Awaiting TP or SL before marking new zone.' });
                            return;
                        }
                        const rejectedList = getRejectedZones(watcher.id);
                        const candidates = identifyCandidateZones(candleData, marketStructure, compiledStrategy, activeCurrentPrice, rejectedList);
                        let discoveredZone = null;
                        let curationReason = '';
                        if (candidates.length > 0) {
                            const userGeminiKey = await resolveUserGeminiKey(supabase, userId);
                            const isAiCuratable = candidates.length > 1 && userGeminiKey && executionMode !== 'RULE_ONLY';
                            if (isAiCuratable) {
                                console.log(`[AI ZONE CURATION] Watcher ID: ${watcher.id} (${selectedPair}): Multiple candidates found (${candidates.length}). Curating with Gemini...`);
                                const curationResult = await curateZonesWithAI(supabase, candidates, marketStructure, watcher.strategy_text || '', userId, selectedPair, candleData);
                                if (curationResult) {
                                    discoveredZone = curationResult.winner;
                                    curationReason = curationResult.aiReason;
                                }
                            }
                            else {
                                discoveredZone = candidates[0];
                                curationReason = discoveredZone.reasoning;
                            }
                        }
                        if (discoveredZone) {
                            if (curationReason) {
                                discoveredZone.reasoning = `[AI CURATED] ${curationReason}`;
                            }
                            console.log(`[ZONE MARKED] Watcher ID: ${watcher.id} (${selectedPair}): Identified ${discoveredZone.type} (${discoveredZone.direction}) [${discoveredZone.low} - ${discoveredZone.high}].`);
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
                                strategy_mode: executionMode,
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
                        }
                        else {
                            console.log(`[ZONE SEARCH] Watcher ID: ${watcher.id} (${selectedPair}): No distinct structural POI/Zone identified in current market structure. Waiting for new structural formation.`);
                            logWatcherEvent('ZONE SEARCH', logCtx, 'No high-quality structural POI/Zone identified in current candles.');
                            const rules = compiledStrategy?.compiled_rules;
                            const requiresZoneSetup = Boolean(rules?.order_block ||
                                rules?.supply_demand ||
                                rules?.unmitigated_zone ||
                                rules?.fair_value_gap ||
                                rules?.support ||
                                rules?.resistance ||
                                rules?.support_rejection ||
                                rules?.resistance_rejection ||
                                rules?.liquidity_sweep);
                            if (requiresZoneSetup) {
                                console.log(`[WAITING FOR SETUP] Watcher ID: ${watcher.id} (${selectedPair}): Strategy requires a structural zone/setup. Bypassing decision score trace and AI evaluation.`);
                                const scanDurationMs = Date.now() - scanStart;
                                await recordEvaluation(supabase, {
                                    user_id: userId,
                                    watcher_id: watcher.id,
                                    pair: selectedPair,
                                    timeframe: selectedTimeframe,
                                    strategy_mode: executionMode,
                                    decision_score: 0,
                                    matched_weight: 0,
                                    possible_weight: 0,
                                    recommendation: 'FAIL',
                                    mandatory_rules_passed: false,
                                    matched_rules: [],
                                    failed_rules: ['No distinct structural POI/Zone identified in current market structure'],
                                    gemini_used: false,
                                    trade_sent: false,
                                    trade_reason: 'No distinct structural POI/Zone identified in current market structure. Waiting for new structural formation.',
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
                                results.push({ userId, symbol, tradeStatus: 'WAITING_FOR_SETUP', result: 'No structural POI/Zone identified. Waiting for new formation.' });
                                return;
                            }
                        }
                    }
                    const cleanSymUpper = (selectedPair || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                    const pipSize = (cleanSymUpper.includes('JPY') || cleanSymUpper.includes('XAU') || cleanSymUpper.includes('GOLD')) ? 0.01 : 0.0001;
                    cronTimer.startStage("Decision Engine Evaluation", watcher.id);
                    marketStructure.watcherId = watcher.id;
                    marketStructure.pair = selectedPair;
                    marketStructure.timeframe = selectedTimeframe;
                    marketStructure.lastClosedCandleTimestamp = candleData[candleData.length - 2]?.timestamp || '';
                    marketStructure.markedZone = currentZone;
                    marketStructure.zone_status = currentZone?.status || 'NO_ZONE';
                    marketStructure.zone_tapped = Boolean(currentZone && (currentZone.status === 'ZONE_TAPPED' || currentZone.status === 'CONFIRMED' || lastZoneEval?.isTapped));
                    marketStructure.zone_rejected = Boolean(lastZoneEval?.isRejected || currentZone?.status === 'CONFIRMED');
                    marketStructure.rejectionConfirmed = Boolean(lastZoneEval?.isRejected || currentZone?.status === 'CONFIRMED');
                    marketStructure.zone_direction = currentZone?.direction;
                    const initialResult = evaluateDecision(compiledStrategy, marketStructure);
                    const histResult = await calculateHistoricalProbability(supabase, userId, selectedPair, selectedTimeframe, initialResult.matched_rules, compiledStrategy.strategy_mode || 'HYBRID');
                    marketStructure.watcherId = watcher.id;
                    marketStructure.pair = selectedPair;
                    marketStructure.timeframe = selectedTimeframe;
                    const decisionResult = evaluateDecision(compiledStrategy, marketStructure, undefined, histResult.historical_probability, histResult.sample_size);
                    const ruleDecisionScoreRecord = normalizeConfidence(decisionResult.decision_score, 'rule_score', 'Weighted Decision Engine');
                    const ruleDecisionScore = ruleDecisionScoreRecord.normalized;
                    let decisionSnapshot = buildDecisionSnapshot(decisionResult, histResult, compiledStrategy);
                    addLog("Decision Engine Complete", "success");
                    addLog(`Decision Score: ${decisionResult.decision_score?.toFixed(1) || '0.0'}%`);
                    addLog(`Recommendation: ${decisionResult.recommendation}`);
                    let analysis = {
                        signal: 'NO_TRADE',
                        confidence: 0,
                        entryPrice: null,
                        stopLoss: null,
                        takeProfit: null,
                        riskReward: null,
                        reasoning: []
                    };
                    let parsedResult = null;
                    let geminiRes = null;
                    let geminiDirection = 'NO_TRADE';
                    let geminiCalled = false;
                    let geminiTextResult = "";
                    let geminiStart = 0;
                    let geminiDuration = 0;
                    let requiresGemini = false;
                    let usedFallback = false;
                    let fallbackReason = '';
                    const recommendation = decisionResult.recommendation;
                    const PRE_FILTER_MIN_SCORE = 75;
                    const mandatoryPassed = decisionResult.mandatory_rules_passed !== false;
                    const meetsQualityThreshold = (decisionResult.decision_score ?? 0) >= PRE_FILTER_MIN_SCORE;
                    const isViableRecommendation = recommendation === 'PASS' || recommendation === 'LIKELY_PASS';
                    const passesDeterministicGate = executionMode === 'AI_ONLY' || (mandatoryPassed && meetsQualityThreshold && isViableRecommendation);
                    if (!passesDeterministicGate) {
                        console.log(`
[DETERMINISTIC PRE-FILTER GATE: REJECTED (NO_TRADE)]
Watcher ID: ${watcher.id}
Pair: ${selectedPair}
Timeframe: ${selectedTimeframe}
Strategy Mode: ${compiledStrategy.strategy_mode || 'HYBRID'}
Decision Score: ${decisionResult.decision_score?.toFixed(1) || '0.0'}% (Threshold: >= ${PRE_FILTER_MIN_SCORE}%)
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
                            strategy_mode: executionMode,
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
                        if (currentZone && (currentZone.status === 'ZONE_TAPPED' || currentZone.status === 'CONFIRMED' || lastZoneEval?.isTapped)) {
                            const rejectReason = decisionResult.no_trade_reason ||
                                decisionResult.explanation ||
                                `Deterministic pre-filter rejected setup (Score: ${decisionResult.decision_score?.toFixed(1) || '0.0'}% < ${PRE_FILTER_MIN_SCORE}%)`;
                            recordRejectedZone(watcher.id, currentZone, rejectReason);
                            activeZonesMemoryMap.delete(watcher.id);
                            console.log(`[ZONE REJECTED BY QUALITY CONTROL] Watcher ID: ${watcher.id} (${selectedPair}): Setup on marked zone [${currentZone.low} - ${currentZone.high}] (${currentZone.type}) was rejected by deterministic pre-filter gate: ${rejectReason}. Clearing zone to prevent dwelling. Waiting for another zone to appear.`);
                            logWatcherEvent('ZONE REJECTED BY QUALITY CONTROL', logCtx, {
                                'Zone Type': currentZone.type,
                                'Zone Bounds': `[${currentZone.low} - ${currentZone.high}]`,
                                'Direction': currentZone.direction,
                                'Reason': rejectReason,
                                'Action': 'WAITING_FOR_ANOTHER_ZONE'
                            });
                            await supabase
                                .from("watchers")
                                .update({
                                zone_data: null,
                                zone_status: 'NO_ZONE',
                                zone_high: null,
                                zone_low: null,
                                zone_type: null,
                                zone_invalidation_level: null,
                                zone_tapped_at: null,
                                last_scan_at: new Date().toISOString(),
                                last_analyzed_closed_candle_time: latestClosedCandleTime,
                                updated_at: new Date().toISOString()
                            })
                                .eq("id", watcher.id);
                            currentZone = null;
                        }
                        else {
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
                        results.push({ userId, symbol, tradeStatus: 'WAITING', result: 'Pre-filtered NO_TRADE' });
                        return;
                    }
                    console.log(`
[DETERMINISTIC PRE-FILTER GATE: PASSED]
Watcher ID: ${watcher.id}
Pair: ${selectedPair}
Timeframe: ${selectedTimeframe}
Strategy Mode: ${compiledStrategy.strategy_mode || 'HYBRID'}
Decision Score: ${decisionResult.decision_score?.toFixed(1) || '0.0'}%
Recommendation: ${recommendation}
Action: PROCEED_TO_EXECUTION_GATE
`.trim());
                    requiresGemini = (executionMode !== 'RULE_ONLY');
                    if (!requiresGemini) {
                        console.log(`[Gemini Routing] Watcher: ${watcher.id} | Strategy Mode: ${compiledStrategy.strategy_mode || 'RULE_ONLY'} | Gemini Required: NO | Gemini Check: SKIPPED`);
                        if (userProfile?.gemini_status && userProfile.gemini_status !== 'READY') {
                            console.log(`[Gemini Isolation] RULE_ONLY watcher bypassed user Gemini status gate`);
                        }
                    }
                    else {
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
                        cronTimer.startStage("Gemini AI Execution", watcher.id);
                        const geminiStatus = userProfile?.gemini_status || 'READY';
                        if (geminiStatus !== 'READY') {
                            let allowProbationaryRetry = false;
                            if (geminiStatus === 'QUOTA_EXHAUSTED' || geminiStatus === 'TEMP_ERROR' || geminiStatus === 'NEEDS_ATTENTION') {
                                const lastChecked = userProfile?.gemini_last_checked ? new Date(userProfile.gemini_last_checked).getTime() : 0;
                                const updated = userProfile?.updated_at ? new Date(userProfile.updated_at).getTime() : 0;
                                const lastErrorTime = Math.max(lastChecked, updated);
                                const elapsedMs = Date.now() - lastErrorTime;
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
                        if (!usedFallback) {
                            const lastAiTime = userLastGeminiExecutionMap.get(userId) || 0;
                            const timeSinceLastAi = Date.now() - lastAiTime;
                            if (timeSinceLastAi < 30000) {
                                const remainingSec = Math.ceil((30000 - timeSinceLastAi) / 1000);
                                console.log(`[USER AI COOLDOWN] User ${userId} executed AI call ${Math.round(timeSinceLastAi / 1000)}s ago (<30s threshold). Falling back to RULE_ONLY (Remaining: ${remainingSec}s).`);
                                watchersSkippedByUserCooldownCount++;
                                usedFallback = true;
                                fallbackReason = 'AI_COOLDOWN';
                                console.log(`[GEMINI FALLBACK] Reason: AI_COOLDOWN | Source: RULE_ONLY`);
                            }
                        }
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
                        }
                        else {
                            const activeUserPromise = activeUserGeminiPromises.get(userId);
                            if (activeUserPromise) {
                                console.log(`[PER-USER CONCURRENCY GUARD] User ${userId} has active Gemini call in-flight. Waiting...`);
                                await activeUserPromise;
                            }
                            userLastGeminiExecutionMap.set(userId, Date.now());
                            let resolveMutex;
                            const userMutexPromise = new Promise((res) => { resolveMutex = res; });
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
                                }
                                else {
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
                                    }
                                    else if (remainingBeforeGemini < 9500 || !hasProcessingTimeRemaining()) {
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
                                            strategy_mode: executionMode,
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
                                    }
                                    else {
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
${currentZone ? `- Zone: ${currentZone.type} (${currentZone.direction}) [${currentZone.low?.toFixed(5) || '0.00000'} - ${currentZone.high?.toFixed(5) || '0.00000'}]
- Invalidation Level: ${currentZone.invalidationLevel?.toFixed(5) || '0.00000'}
- Status: ${currentZone.status} (Tapped: YES, Rejection Confirmed: ${lastZoneEval?.isRejected || currentZone.status === 'CONFIRMED' ? 'YES' : 'IN_PROGRESS'})` : '- None'}

Detailed Numeric Market Structure & Key Levels:
- Trend: ${marketStructure.trend}
- Support Zones (Min-Max): ${marketStructure.supportZones?.map(s => `[${s.priceMin?.toFixed(5) || '0.00000'} - ${s.priceMax?.toFixed(5) || '0.00000'}]`).join(', ') || 'None'}
- Resistance Zones (Min-Max): ${marketStructure.resistanceZones?.map(r => `[${r.priceMin?.toFixed(5) || '0.00000'} - ${r.priceMax?.toFixed(5) || '0.00000'}]`).join(', ') || 'None'}
- Swing Highs: ${marketStructure.swingHighs?.slice(-3).map(s => s.price?.toFixed(5) || '0.00000').join(', ') || 'None'}
- Swing Lows: ${marketStructure.swingLows?.slice(-3).map(s => s.price?.toFixed(5) || '0.00000').join(', ') || 'None'}
- Fair Value Gaps: ${marketStructure.fairValueGaps?.slice(-3).map(f => `${f.type} (${f.bottom?.toFixed(5) || '0.00000'} - ${f.top?.toFixed(5) || '0.00000'})`).join(', ') || 'None'}
- Volume Confirmation: ${marketStructure.volumeInformation?.volumeSpike ? 'Confirmed' : 'None'}
- ATR: ${marketStructure.volatilityInformation?.atr?.toFixed(5) || '0.00000'}

AI Instructions:
1. Evaluate ONLY the supplied market evidence and marked POI zone.
2. If Confirmation Mode is Default Confirmation (Tap & Rejection of Marked Zone), price has tapped the marked POI zone and held above/below invalidation. Provide a ${currentZone?.direction || 'directional'} trade approval in accordance with the zone.
3. TIMEFRAME & STOP LOSS SCALING:
- This is a ${selectedTimeframe} trade. Keep Stop Loss tight and proportionate to ${selectedTimeframe} (typically 5 to 10 pips for M5/M15). Never output wide H1/H4 swing stop losses.
- If current price (${currentPrice}) has already moved significantly away from the marked POI zone in the target direction (late entry / chasing after the move has started), evaluate as NO_TRADE. Do NOT chase late entries.
4. If BUY or SELL, provide the exact Entry Price, Stop Loss, and Take Profit based on actual NUMERIC market structure.
5. For BUY: Stop Loss MUST be placed BELOW entry, at or below marked zone invalidation level (${currentZone?.direction === 'BUY' ? (currentZone.invalidationLevel?.toFixed(5) || '0.00000') : 'support structure'}).
6. For SELL: Stop Loss MUST be placed ABOVE entry, at or above marked zone invalidation level (${currentZone?.direction === 'SELL' ? (currentZone.invalidationLevel?.toFixed(5) || '0.00000') : 'resistance structure'}).
7. Identify the basis used for the Stop Loss in "stopLossBasis" (SUPPORT_ZONE, RESISTANCE_ZONE, SWING_LOW, SWING_HIGH, DEMAND_ZONE, SUPPLY_ZONE, ORDER_BLOCK, STRUCTURAL_CANDLE, ATR_FALLBACK).
8. Only return NO_TRADE when the supplied evidence clearly argues against taking a trade.

Output ONLY valid JSON.
`;
                                        const geminiRes = await executeBoundedGeminiCall(ai, {
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
                                        }, {
                                            userId: userId,
                                            userEmail: logCtx.userEmail,
                                            watcherId: watcher.id,
                                            pair: selectedPair,
                                            timeframe: selectedTimeframe,
                                            keySource: keyRes.keySource
                                        });
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
                                            }
                                            else if (geminiRes.errorType === 'CANCELLED' || geminiRes.diagnosticStatus === 'CANCELLED') {
                                                tempErrorCount++;
                                                curReason = 'CANCELLED';
                                            }
                                            else if (geminiRes.errorType === 'QUOTA_EXHAUSTED') {
                                                quotaExhaustedUsers.add(userId);
                                                geminiQuotaErrorsCount++;
                                                geminiCallsQuotaExhaustedCount++;
                                                skippedDueToQuotaCount++;
                                                watchersSkippedByGemini429Count++;
                                                curReason = 'QUOTA_EXHAUSTED';
                                            }
                                            else if (geminiRes.errorType === 'TEMPORARY_ERROR') {
                                                tempErrorCount++;
                                                if (geminiRes.diagnosticStatus === 'TEMPORARY_504') {
                                                    gemini504Count++;
                                                }
                                                else {
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
                                            }
                                            else if (geminiRes.errorType === 'INVALID_CREDENTIALS') {
                                                invalidKeyCount++;
                                                curReason = 'INVALID_KEY';
                                            }
                                            else if (geminiRes.errorType === 'PERMISSION_ERROR') {
                                                permissionErrorCount++;
                                                curReason = 'INVALID_KEY';
                                            }
                                            else if (geminiRes.errorType === 'INVALID_REQUEST') {
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
                                        }
                                        else {
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
                                            }
                                            catch (parseErr) {
                                                const errMsg = `Malformed AI JSON output: ${parseErr.message}`;
                                                console.error(`[GEMINI PARSE ERROR] User: ${logCtx.userEmail} | Watcher: ${watcher.id} | ${errMsg}`);
                                                usedFallback = true;
                                                fallbackReason = 'INVALID_RESPONSE';
                                                console.log(`[GEMINI FALLBACK] Reason: INVALID_RESPONSE | Source: RULE_ONLY`);
                                            }
                                            addLog("Gemini Returned", "success");
                                            addLog("Parsed Gemini Output", "success");
                                            geminiSucceeded = true;
                                            geminiDecision = parsedResult.direction;
                                            if (parsedResult.satisfies && parsedResult.direction && parsedResult.direction !== 'NO_TRADE') {
                                                geminiDirection = parsedResult.direction;
                                                const entry = Number(parsedResult.entryPrice) || candleData[candleData.length - 1].close;
                                                let proximityValidation = null;
                                                if (currentZone && geminiDirection === currentZone.direction) {
                                                    proximityValidation = validateZoneProximityAndStopLoss(geminiDirection, entry, currentZone, selectedTimeframe, selectedPair, marketStructure?.volatilityInformation?.atr);
                                                    if (proximityValidation?.isLateEntry) {
                                                        console.log(`[GEMINI LATE ENTRY REJECTED] Watcher ID: ${watcher.id} (${selectedPair}): ${proximityValidation.lateReason}`);
                                                        parsedResult.satisfies = false;
                                                        parsedResult.direction = 'NO_TRADE';
                                                        parsedResult.reasoning = proximityValidation.lateReason;
                                                    }
                                                    else if (proximityValidation?.isSlTooWide) {
                                                        console.log(`[GEMINI STOP LOSS TOO WIDE] Watcher ID: ${watcher.id} (${selectedPair}): Stop loss distance (${proximityValidation.slDistancePips?.toFixed(1) || '0.0'} pips) exceeds maximum allowable limit for ${selectedTimeframe}. Setup rejected.`);
                                                        parsedResult.satisfies = false;
                                                        parsedResult.direction = 'NO_TRADE';
                                                        parsedResult.reasoning = `Stop loss distance (${proximityValidation.slDistancePips?.toFixed(1) || '0.0'} pips) is too wide for ${selectedTimeframe}. Setup rejected.`;
                                                    }
                                                }
                                                if (parsedResult.satisfies && parsedResult.direction !== 'NO_TRADE') {
                                                    if (currentZone) {
                                                        marketStructure.markedZone = currentZone;
                                                    }
                                                    const candidateSl = proximityValidation?.stopLoss || parsedResult.stopLoss;
                                                    const candidateBasis = proximityValidation?.stopLossBasis || parsedResult.stopLossBasis;
                                                    const slResult = validateAndResolveStopLoss(geminiDirection, entry, candidateSl, candidateBasis, marketStructure);
                                                    let finalTP = Number(parsedResult.takeProfit);
                                                    const riskDist = Math.abs(entry - slResult.stopLoss);
                                                    const rrRatio = parseRiskRewardRatio(riskRewardStr);
                                                    const isTpValid = !isNaN(finalTP) && finalTP > 0 &&
                                                        (geminiDirection === 'BUY' ? finalTP > entry : finalTP < entry) &&
                                                        Math.abs(finalTP - entry) <= (riskDist * rrRatio * 1.35);
                                                    if (!isTpValid) {
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
                                                }
                                                else {
                                                    geminiDirection = 'NO_TRADE';
                                                    logWatcherEvent('Gemini Decision', logCtx, {
                                                        'Status': 'REJECTED',
                                                        'Direction': 'NO_TRADE',
                                                        'Confidence': '0%',
                                                        'Fallback': 'NO_TRADE'
                                                    });
                                                    analysis = {
                                                        signal: 'NO_TRADE',
                                                        confidence: 0,
                                                        reasoning: [parsedResult?.reasoning || "Setup rejected due to late entry or invalid structure."]
                                                    };
                                                }
                                            }
                                            else {
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
                            }
                            catch (gemErr) {
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
                            }
                            finally {
                                resolveMutex();
                                if (activeUserGeminiPromises.get(userId) === userMutexPromise) {
                                    activeUserGeminiPromises.delete(userId);
                                }
                            }
                        }
                        if (usedFallback) {
                            console.log(`[Gemini Fallback Execution] Running deterministic rule-only fallback engine due to Gemini ${fallbackReason}.`);
                            const mappedParsedStrategy = {
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
                            const activeZoneDir = currentZone?.direction;
                            let localAnalysis = analyzeMarket(candleData, mappedParsedStrategy, activeZoneDir);
                            if (currentZone && (currentZone.status === 'ZONE_TAPPED' || currentZone.status === 'CONFIRMED' || lastZoneEval?.isTapped)) {
                                const signalDir = currentZone.direction;
                                if (!localAnalysis || localAnalysis.signal !== signalDir) {
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
                                        reasoning: [`[Break & Retest Confirmation] Price tapped marked ${currentZone.type} [${currentZone.low} - ${currentZone.high}] and confirmed retest in ${signalDir} direction while holding invalidation (${sl}).`]
                                    };
                                }
                            }
                            const localSignal = localAnalysis?.signal || 'NO_TRADE';
                            console.log(`[RULE_ONLY DECISION] Direction: ${localSignal}`);
                            if (localAnalysis && localAnalysis.signal !== 'NO_TRADE' && localAnalysis.entryPrice) {
                                if (currentZone) {
                                    marketStructure.markedZone = currentZone;
                                }
                                const slResult = calculateStructuralStopLoss(localAnalysis.signal, localAnalysis.entryPrice, marketStructure);
                                localAnalysis.stopLoss = slResult.stopLoss;
                                localAnalysis.stopLossBasis = slResult.stopLossBasis;
                                localAnalysis.structuralLevel = slResult.structuralLevel;
                                const riskDist = Math.abs(localAnalysis.entryPrice - slResult.stopLoss);
                                const rrRatio = parseRiskRewardRatio(riskRewardStr);
                                localAnalysis.takeProfit = localAnalysis.signal === 'BUY'
                                    ? localAnalysis.entryPrice + (riskDist * rrRatio)
                                    : localAnalysis.entryPrice - (riskDist * rrRatio);
                            }
                            analysis = localAnalysis || { signal: 'NO_TRADE', confidence: 0, reasoning: ['Rule-only engine produced no signal'] };
                        }
                        else if (!geminiSucceeded || (analysis.signal !== 'BUY' && analysis.signal !== 'SELL')) {
                            const isBreakRetestConfirmed = Boolean(currentZone && (currentZone.status === 'CONFIRMED' ||
                                lastZoneEval?.isRejected ||
                                lastZoneEval?.isConfirmed ||
                                ((currentZone.status === 'ZONE_TAPPED' || lastZoneEval?.isTapped) && (compiledStrategy.compiled_rules?.tap_and_rejection || (lastZoneEval?.retestCandleCount || 0) >= 1))));
                            if (isBreakRetestConfirmed && currentZone) {
                                console.log(`[Break and Retest Confirmed] Zone ${currentZone.type} verified. Validating entry proximity and Stop Loss scaling.`);
                                const signalDir = currentZone.direction;
                                const proximityValidation = validateZoneProximityAndStopLoss(signalDir, activeCurrentPrice, currentZone, selectedTimeframe, selectedPair, marketStructure?.volatilityInformation?.atr);
                                if (proximityValidation.isLateEntry) {
                                    console.log(`[LATE ENTRY REJECTED] Watcher ID: ${watcher.id} (${selectedPair}): ${proximityValidation.lateReason}`);
                                    analysis = {
                                        signal: 'NO_TRADE',
                                        confidence: 0,
                                        entryPrice: null,
                                        stopLoss: null,
                                        takeProfit: null,
                                        riskReward: null,
                                        reasoning: [proximityValidation.lateReason || 'Late entry rejected to prevent chasing market move.']
                                    };
                                }
                                else if (proximityValidation.isSlTooWide) {
                                    console.log(`[STOP LOSS TOO WIDE] Watcher ID: ${watcher.id} (${selectedPair}): Stop loss distance (${proximityValidation.slDistancePips.toFixed(1)} pips) exceeds maximum allowable limit for ${selectedTimeframe}. Setup rejected.`);
                                    analysis = {
                                        signal: 'NO_TRADE',
                                        confidence: 0,
                                        entryPrice: null,
                                        stopLoss: null,
                                        takeProfit: null,
                                        riskReward: null,
                                        reasoning: [`Stop loss distance (${proximityValidation.slDistancePips.toFixed(1)} pips) is too wide for ${selectedTimeframe}. Setup rejected.`]
                                    };
                                }
                                else {
                                    const entry = proximityValidation.entryPrice;
                                    const sl = proximityValidation.stopLoss;
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
                                        stopLossBasis: proximityValidation.stopLossBasis,
                                        structuralLevel: proximityValidation.structuralLevel,
                                        riskReward: riskRewardStr,
                                        reasoning: [
                                            `[Break & Retest Confirmation] Price tapped marked ${currentZone.type} [${currentZone.low.toFixed(5)} - ${currentZone.high.toFixed(5)}] and confirmed retest in ${signalDir} direction holding tight structural Stop Loss (${sl.toFixed(5)} - ${proximityValidation.slDistancePips.toFixed(1)} pips).`
                                        ]
                                    };
                                }
                            }
                            else {
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
                    }
                    else {
                        console.log(`[Decision Engine] Recommendation is ${recommendation}. Skipping Gemini as requires_gemini is false.`);
                        const isBreakRetestConfirmed = Boolean(currentZone && (currentZone.status === 'CONFIRMED' ||
                            lastZoneEval?.isRejected ||
                            lastZoneEval?.isConfirmed ||
                            ((currentZone.status === 'ZONE_TAPPED' || lastZoneEval?.isTapped) && (compiledStrategy.compiled_rules?.tap_and_rejection || (lastZoneEval?.retestCandleCount || 0) >= 1))));
                        if ((recommendation === 'FAIL' || recommendation === 'AMBIGUOUS') && !isBreakRetestConfirmed) {
                            console.log(`[Decision Engine] Recommendation is ${recommendation}. Forcing NO_TRADE without Gemini approval.`);
                            analysis = {
                                signal: 'NO_TRADE',
                                confidence: 0,
                                reasoning: [`Rejected by Decision Engine (${recommendation} without Gemini approval)`]
                            };
                        }
                        else {
                            const mappedParsedStrategy = {
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
                            const activeZoneDir = currentZone?.direction;
                            let localAnalysis = analyzeMarket(candleData, mappedParsedStrategy, activeZoneDir);
                            if (currentZone && (currentZone.status === 'ZONE_TAPPED' || currentZone.status === 'CONFIRMED' || lastZoneEval?.isTapped)) {
                                const signalDir = currentZone.direction;
                                if (!localAnalysis || localAnalysis.signal !== signalDir) {
                                    const proximityValidation = validateZoneProximityAndStopLoss(signalDir, activeCurrentPrice, currentZone, selectedTimeframe, selectedPair, marketStructure?.volatilityInformation?.atr);
                                    if (proximityValidation.isLateEntry || proximityValidation.isSlTooWide) {
                                        console.log(`[LOCAL ENGINE REJECT] Watcher ID: ${watcher.id} (${selectedPair}): ${proximityValidation.lateReason || 'Stop loss too wide for timeframe'}`);
                                        localAnalysis = {
                                            signal: 'NO_TRADE',
                                            confidence: 0,
                                            reasoning: [proximityValidation.lateReason || 'Stop loss too wide for timeframe']
                                        };
                                    }
                                    else {
                                        const entry = proximityValidation.entryPrice;
                                        const sl = proximityValidation.stopLoss;
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
                                            stopLossBasis: proximityValidation.stopLossBasis,
                                            structuralLevel: proximityValidation.structuralLevel,
                                            riskReward: riskRewardStr,
                                            reasoning: [`[Break & Retest Confirmation] Price tapped marked ${currentZone.type} [${currentZone.low.toFixed(5)} - ${currentZone.high.toFixed(5)}] and confirmed retest in ${signalDir} direction while holding tight structural Stop Loss (${sl.toFixed(5)}).`]
                                        };
                                    }
                                }
                            }
                            if (localAnalysis && localAnalysis.signal !== 'NO_TRADE' && localAnalysis.entryPrice) {
                                if (currentZone) {
                                    marketStructure.markedZone = currentZone;
                                }
                                const slResult = calculateStructuralStopLoss(localAnalysis.signal, localAnalysis.entryPrice, marketStructure);
                                localAnalysis.stopLoss = slResult.stopLoss;
                                localAnalysis.stopLossBasis = slResult.stopLossBasis;
                                localAnalysis.structuralLevel = slResult.structuralLevel;
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
                    }
                    else if (analysis.signal === 'SELL') {
                        addLog("Final Signal: SELL", "success");
                        console.log("FINAL DECISION: SELL");
                    }
                    else if (analysis.signal === 'NO_TRADE') {
                        addLog("Final Signal: NO_TRADE", "success");
                        console.log("FINAL DECISION: NO_TRADE");
                    }
                    console.log("==================================");
                    console.log(`LOG: Signal result for ${selectedPair}: ${analysis.signal} (Confidence: ${analysis.confidence}%)`);
                    cronTimer.startStage("Quality Gate & Risk Governor", watcher.id);
                    let qualityResult = null;
                    let governorResult = null;
                    let calibrationResult = null;
                    let adaptiveResult = null;
                    let adaptiveReq = null;
                    let executionResult = null;
                    let completedTradesForStreak = [];
                    let consecutiveLosses = 0;
                    try {
                        completedTradesForStreak = await fetchCompletedTradesForAdaptiveLearning(supabase, userId);
                        consecutiveLosses = calculateConsecutiveLossesForWatcher(completedTradesForStreak, watcher.id);
                        console.log(`[Loss-Streak Protection] Watcher ID: ${watcher.id}, Consecutive Losses: ${consecutiveLosses}`);
                    }
                    catch (tradeErr) {
                        console.error('[Completed Trades Fetch Error] Failed to compute consecutive losses:', tradeErr);
                    }
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
                            console.log(`[QUALITY GATE REJECT] Watcher ID: ${watcher.id} (${selectedPair}): Setup rejected by Quality Gate: ${qualityResult.reason} (Score: ${qualityResult.qualityScore})`);
                            analysis.signal = 'NO_TRADE';
                            analysis.reasoning = [`Quality Gate REJECT: ${qualityResult.reason}`];
                        }
                    }
                    if (analysis.signal === 'BUY' || analysis.signal === 'SELL') {
                        try {
                            const completedTrades = await fetchUserCompletedTrades(supabase, userId);
                            const equityMetrics = computeEquityAnalytics(completedTrades);
                            const dailyPnL = computeDailyPnL(completedTrades, accountSize);
                            const equityState = deriveEquityState(accountSize, equityMetrics);
                            governorResult = evaluateRiskGovernor({
                                metrics: equityMetrics,
                                equityState: {
                                    ...equityState,
                                    dailyPnL,
                                    maxDailyLossAmount: maxDailyLossAmount
                                },
                                candidate: {
                                    pair: selectedPair,
                                    timeframe: selectedTimeframe,
                                    strategySetup: compiledStrategy.strategy_mode,
                                    qualityScore: analysis.confidence,
                                    confidence: analysis.confidence
                                }
                            });
                            if (governorResult.status === 'NO_TRADE' || governorResult.status === 'RESTRICTED_SELECTIVITY') {
                                console.log(`[RISK GOVERNOR REJECT] Watcher ID: ${watcher.id} (${selectedPair}): Setup rejected by Risk Governor: ${governorResult.explanation || governorResult.status}`);
                                analysis.signal = 'NO_TRADE';
                                analysis.reasoning = [`Risk Governor REJECT: ${governorResult.explanation || governorResult.status}`];
                            }
                        }
                        catch (govErr) {
                            console.error('[Risk Governor Error] Failed to evaluate equity learning governor, proceeding with standard signal pipeline:', govErr);
                        }
                    }
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
                            if (calibrationResult.recommendedAction === 'NO_TRADE' || calibrationResult.recommendedAction === 'RESTRICT') {
                                console.log(`[CALIBRATION REJECT] Watcher ID: ${watcher.id} (${selectedPair}): Setup rejected by Calibration: ${calibrationResult.recommendedAction}`);
                                analysis.signal = 'NO_TRADE';
                                analysis.reasoning = [`Closed-Loop Calibration REJECT: ${calibrationResult.recommendedAction}`];
                            }
                        }
                        catch (calibErr) {
                            console.error('[Closed-Loop Calibration Error] Failed to evaluate closed-loop calibration:', calibErr);
                        }
                    }
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
                            if (adaptiveResult.decision === 'REJECT') {
                                console.log(`[ADAPTIVE LEARNING REJECT] Watcher ID: ${watcher.id} (${selectedPair}): Setup rejected by Adaptive Learning: ${adaptiveResult.reason}`);
                                analysis.signal = 'NO_TRADE';
                                analysis.reasoning = [`Adaptive Learning REJECT: ${adaptiveResult.reason}`];
                            }
                            else if (analysis.confidence < adaptiveReq.minRequired) {
                                console.log(`[ADAPTIVE QUALITY REJECT] Watcher ID: ${watcher.id} (${selectedPair}): Setup rejected by Adaptive Quality: Confidence ${analysis.confidence}% < ${adaptiveReq.minRequired}%`);
                                analysis.signal = 'NO_TRADE';
                                analysis.reasoning = [`Adaptive Quality REJECT: Confidence ${analysis.confidence}% < ${adaptiveReq.minRequired}%`];
                            }
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
                                if (executionResult.status === 'WAIT' || executionResult.status === 'NO_TRADE') {
                                    console.log(`[ADAPTIVE TIMING REJECT] Watcher ID: ${watcher.id} (${selectedPair}): Setup rejected by Adaptive Execution Timing: ${executionResult.explanation}`);
                                    analysis.signal = 'NO_TRADE';
                                    analysis.reasoning = [`Adaptive Timing REJECT: ${executionResult.explanation}`];
                                }
                            }
                            catch (execErr) {
                                console.error('[Adaptive Execution Error] Failed to evaluate adaptive execution timing, proceeding with standard signal pipeline:', execErr);
                            }
                        }
                        catch (adaptErr) {
                            console.error('[Adaptive Quality Error] Failed to evaluate adaptive quality requirement, proceeding with standard signal pipeline:', adaptErr);
                        }
                    }
                    if (analysis.signal === 'BUY' || analysis.signal === 'SELL') {
                        analysis.confidence = Math.max(analysis.confidence || 0, 85);
                    }
                    const isWaiting = (analysis.signal !== 'BUY' && analysis.signal !== 'SELL');
                    if (isWaiting) {
                        const qualityReason = analysis.reasoning?.join('; ') || 'Quality control features rejected setup';
                        if (currentZone && (currentZone.status === 'ZONE_TAPPED' || currentZone.status === 'CONFIRMED' || lastZoneEval?.isTapped)) {
                            recordRejectedZone(watcher.id, currentZone, qualityReason);
                            activeZonesMemoryMap.delete(watcher.id);
                            console.log(`[ZONE REJECTED BY QUALITY CONTROL] Watcher ID: ${watcher.id} (${selectedPair}): Setup on marked zone [${currentZone.low} - ${currentZone.high}] (${currentZone.type}) was rejected by quality control: ${qualityReason}. Clearing zone to prevent dwelling. Waiting for another zone to appear.`);
                            logWatcherEvent('ZONE REJECTED BY QUALITY CONTROL', logCtx, {
                                'Zone Type': currentZone.type,
                                'Zone Bounds': `[${currentZone.low} - ${currentZone.high}]`,
                                'Direction': currentZone.direction,
                                'Reason': qualityReason,
                                'Action': 'WAITING_FOR_ANOTHER_ZONE'
                            });
                            await supabase
                                .from("watchers")
                                .update({
                                zone_data: null,
                                zone_status: 'NO_ZONE',
                                zone_high: null,
                                zone_low: null,
                                zone_type: null,
                                zone_invalidation_level: null,
                                zone_tapped_at: null,
                                last_scan_at: new Date().toISOString(),
                                last_analyzed_closed_candle_time: latestClosedCandleTime,
                                updated_at: new Date().toISOString()
                            })
                                .eq("id", watcher.id);
                            currentZone = null;
                        }
                        else {
                            await supabase
                                .from("watchers")
                                .update({
                                last_scan_at: new Date().toISOString(),
                                last_analyzed_closed_candle_time: latestClosedCandleTime,
                                updated_at: new Date().toISOString()
                            })
                                .eq("id", watcher.id);
                        }
                        logWatcherEvent('SIGNAL SKIPPED', logCtx, {
                            'Reason': qualityReason,
                            'Signal': analysis.signal,
                            'Confidence': `${analysis.confidence}%`
                        });
                        const scanDurationMs = Date.now() - scanStart;
                        await recordEvaluation(supabase, {
                            user_id: userId,
                            watcher_id: watcher.id,
                            pair: selectedPair,
                            timeframe: selectedTimeframe,
                            strategy_mode: executionMode,
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
                            trade_reason: `Trade setup rejected: ${qualityReason}`,
                            scan_duration_ms: scanDurationMs,
                            gemini_duration_ms: geminiDuration,
                            decision_snapshot: decisionSnapshot
                        });
                        watchersProcessedCount++;
                        isWatcherSkipped = false;
                        results.push({ userId, symbol, tradeStatus: 'WAITING', result: `Setup rejected: ${qualityReason}` });
                        return;
                    }
                    cronTimer.startStage("Position Sizing & Validation", watcher.id);
                    const persistedAccountType = resolvePersistedAccountType(prefsRecord?.account_type);
                    if (persistedAccountType === 'personal') {
                        const todayStart = new Date();
                        todayStart.setUTCHours(0, 0, 0, 0);
                        const { data: todayTrades } = await supabase
                            .from('trade_learning')
                            .select('net_pnl')
                            .eq('user_id', userId)
                            .gte('created_at', todayStart.toISOString());
                        let totalLossToday = 0;
                        if (todayTrades && todayTrades.length > 0) {
                            for (const t of todayTrades) {
                                const pnl = Number(t.net_pnl);
                                if (!isNaN(pnl) && pnl < 0) {
                                    totalLossToday += Math.abs(pnl);
                                }
                            }
                        }
                        const maxDailyLossAllowed = maxDailyLossAmount || 100;
                        if (totalLossToday >= maxDailyLossAllowed) {
                            logWatcherWarn('DAILY LOSS LIMIT', logCtx, `User daily loss limit reached ($${totalLossToday.toFixed(2)} >= $${maxDailyLossAllowed}). Halting new trades for today.`);
                            analysis.signal = 'NO_TRADE';
                            analysis.reasoning = [`Daily Loss Limit Reached: Lost $${totalLossToday.toFixed(2)} today (Limit: $${maxDailyLossAllowed})`];
                            await supabase.from('watcher_evaluations').insert({
                                user_id: userId,
                                watcher_id: watcher.id,
                                symbol,
                                timeframe: selectedTimeframe,
                                strategy_mode: executionMode,
                                market_price: Number(candleData[candleData.length - 1]?.close) || 0,
                                decision_score: 0,
                                matched_weight: 0,
                                possible_weight: 100,
                                matched_rules: [],
                                failed_rules: ['DAILY_LOSS_LIMIT_REACHED'],
                                gemini_used: false,
                                trade_sent: false,
                                trade_reason: `Trade setup rejected: Daily loss limit ($${maxDailyLossAllowed}) reached (Today loss: $${totalLossToday.toFixed(2)})`,
                                scan_duration_ms: Date.now() - scanStart
                            });
                            watchersProcessedCount++;
                            isWatcherSkipped = false;
                            results.push({ userId, symbol, tradeStatus: 'WAITING', result: `Daily loss limit ($${maxDailyLossAllowed}) reached` });
                            return;
                        }
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
                    const brokerExecutionMode = process.env.EXECUTION_MODE || 'THEORETICAL';
                    if (!posSizeResult.accepted) {
                        console.log(`[POSITION SIZING REJECT] Watcher ID: ${watcher.id} (${selectedPair}): Setup rejected by position sizing / risk controls (${posSizeResult.skipReason}).`);
                        analysis.signal = 'NO_TRADE';
                        analysis.reasoning = [`Position Sizing REJECT: ${posSizeResult.skipReason}`];
                        if (currentZone) {
                            const rejectReason = `Position sizing rejected: ${posSizeResult.skipReason}`;
                            recordRejectedZone(watcher.id, currentZone, rejectReason);
                            activeZonesMemoryMap.delete(watcher.id);
                            console.log(`[ZONE REJECTED BY QUALITY CONTROL] Watcher ID: ${watcher.id} (${selectedPair}): Setup on marked zone [${currentZone.low} - ${currentZone.high}] (${currentZone.type}) was rejected by position sizing (${posSizeResult.skipReason}). Clearing zone to prevent dwelling. Waiting for another zone to appear.`);
                            await supabase
                                .from("watchers")
                                .update({
                                zone_data: null,
                                zone_status: 'NO_ZONE',
                                zone_high: null,
                                zone_low: null,
                                zone_type: null,
                                zone_invalidation_level: null,
                                zone_tapped_at: null,
                                last_scan_at: new Date().toISOString(),
                                last_analyzed_closed_candle_time: latestClosedCandleTime,
                                updated_at: new Date().toISOString()
                            })
                                .eq("id", watcher.id);
                            currentZone = null;
                        }
                        else {
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
                        results.push({ userId, symbol, tradeStatus: 'WAITING', result: `Position sizing rejected: ${posSizeResult.skipReason}` });
                        return;
                    }
                    const propFirmSettingsForNews = resolvedAccountType === 'prop' ? propFirmMap.get(userId) : null;
                    const isPropNews = resolvedAccountType === 'prop';
                    const newsRestrictionEnabled = isPropNews
                        ? propFirmSettingsForNews?.news_restriction_enabled === true
                        : prefsRecord?.news_restriction_enabled === true;
                    const bufferBeforeMinutes = isPropNews
                        ? Number(propFirmSettingsForNews?.news_buffer_before_minutes ?? 5)
                        : Number(prefsRecord?.news_buffer_before_minutes ?? 30);
                    const bufferAfterMinutes = isPropNews
                        ? Number(propFirmSettingsForNews?.news_buffer_after_minutes ?? 5)
                        : Number(prefsRecord?.news_buffer_after_minutes ?? 30);
                    const newsGateOutcome = await evaluateEconomicNewsGate({
                        accountType: isPropNews ? 'prop' : 'personal',
                        symbol: selectedPair,
                        newsRestrictionEnabled,
                        bufferBeforeMinutes,
                        bufferAfterMinutes,
                        supabase
                    });
                    const newsGateResult = newsGateOutcome.newsGateResult;
                    const marketCandleTimestampMs = new Date(tsResult.candles[tsResult.candles.length - 1]?.timestamp || Date.now()).getTime();
                    const freshnessResult = validateExecutionFreshness({
                        signalGeneratedAt: Date.now(),
                        marketDataTimestamp: marketCandleTimestampMs,
                        currentPrice: executedPrice,
                        entryPrice: posSizeResult.entryPrice || executedPrice,
                        stopLoss: posSizeResult.stopLoss,
                        takeProfit: posSizeResult.takeProfit || 0,
                        instrument: selectedPair,
                        timeframe: selectedTimeframe,
                        isBuy: analysis.signal === 'BUY',
                        bypassFreshnessCheck: true
                    }, executedPrice * 0.9999, executedPrice * 1.0001);
                    const finalValidation = revalidatePreExecution({
                        marketDataAvailable: true,
                        marketDataFreshness: freshnessResult,
                        currentPrice: executedPrice,
                        spread: (executedPrice * 1.0001) - (executedPrice * 0.9999),
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
                        temporaryBypassAllPostSignalConfirmations: true
                    });
                    if (finalValidation.status === 'FINAL_EXECUTION_REJECTED') {
                        console.log(`[PRE-EXECUTION REJECT] Watcher ID: ${watcher.id} (${selectedPair}): Setup rejected by pre-execution validation: ${finalValidation.rejectionReason}`);
                        analysis.signal = 'NO_TRADE';
                        analysis.reasoning = [`Pre-Execution REJECT: ${finalValidation.rejectionReason}`];
                        if (currentZone) {
                            const rejectReason = `Pre-execution validation rejected: ${finalValidation.rejectionReason}`;
                            recordRejectedZone(watcher.id, currentZone, rejectReason);
                            activeZonesMemoryMap.delete(watcher.id);
                            console.log(`[ZONE REJECTED BY QUALITY CONTROL] Watcher ID: ${watcher.id} (${selectedPair}): Setup on marked zone [${currentZone.low} - ${currentZone.high}] (${currentZone.type}) was rejected by pre-execution validation (${finalValidation.rejectionReason}). Clearing zone to prevent dwelling. Waiting for another zone to appear.`);
                            await supabase
                                .from("watchers")
                                .update({
                                zone_data: null,
                                zone_status: 'NO_ZONE',
                                zone_high: null,
                                zone_low: null,
                                zone_type: null,
                                zone_invalidation_level: null,
                                zone_tapped_at: null,
                                last_scan_at: new Date().toISOString(),
                                last_analyzed_closed_candle_time: latestClosedCandleTime,
                                updated_at: new Date().toISOString()
                            })
                                .eq("id", watcher.id);
                            currentZone = null;
                        }
                        else {
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
                        results.push({ userId, symbol, tradeStatus: 'WAITING', result: `Pre-execution rejected: ${finalValidation.rejectionReason}` });
                        return;
                    }
                    const proposedTradeRisk = typeof posSizeResult.expectedLoss === 'number' &&
                        Number.isFinite(posSizeResult.expectedLoss) &&
                        posSizeResult.expectedLoss > 0
                        ? posSizeResult.expectedLoss
                        : posSizeResult.riskAmount;
                    const propFirmGateOutcome = await evaluateWatcherPropFirmGate({
                        supabase,
                        userId,
                        symbol: selectedPair,
                        rawAccountType: prefsRecord?.account_type,
                        proposedTradeRisk,
                        currentMarketPrice: executedPrice
                    });
                    if (propFirmGateOutcome.evaluated) {
                        decisionSnapshot = {
                            ...decisionSnapshot,
                            propFirmEvaluation: {
                                accountType: propFirmGateOutcome.accountType,
                                allowed: propFirmGateOutcome.allowed,
                                blockReason: propFirmGateOutcome.blockReason,
                                firmName: propFirmGateOutcome.firmName,
                                accountPhase: propFirmGateOutcome.accountPhase,
                                resetBoundaryUtc: propFirmGateOutcome.resetBoundaryUtc,
                                checks: propFirmGateOutcome.decision?.checks || []
                            }
                        };
                    }
                    if (!propFirmGateOutcome.allowed) {
                        const propBlockReason = propFirmGateOutcome.blockReason || 'Blocked by Prop Firm Rule Engine.';
                        analysis.signal = 'NO_TRADE';
                        analysis.reasoning = [`[PropFirmGate] ${propBlockReason}`];
                        if (currentZone) {
                            const rejectReason = `Prop Firm Gate rejected: ${propBlockReason}`;
                            recordRejectedZone(watcher.id, currentZone, rejectReason);
                            activeZonesMemoryMap.delete(watcher.id);
                            console.log(`[ZONE REJECTED BY PROP FIRM GATE] Watcher ID: ${watcher.id} (${selectedPair}): Setup on marked zone [${currentZone.low} - ${currentZone.high}] (${currentZone.type}) was rejected by Prop Firm Gate (${propBlockReason}). Clearing zone to prevent dwelling.`);
                            await supabase
                                .from("watchers")
                                .update({
                                zone_data: null,
                                zone_status: 'NO_ZONE',
                                zone_high: null,
                                zone_low: null,
                                zone_type: null,
                                zone_invalidation_level: null,
                                zone_tapped_at: null,
                                last_scan_at: new Date().toISOString(),
                                last_analyzed_closed_candle_time: latestClosedCandleTime,
                                updated_at: new Date().toISOString()
                            })
                                .eq("id", watcher.id);
                            currentZone = null;
                        }
                        else {
                            await supabase
                                .from("watchers")
                                .update({
                                last_scan_at: new Date().toISOString(),
                                last_analyzed_closed_candle_time: latestClosedCandleTime,
                                updated_at: new Date().toISOString()
                            })
                                .eq("id", watcher.id);
                        }
                        const failedPropRules = (propFirmGateOutcome.decision?.checks || [])
                            .filter(c => c.status === 'BLOCK' || c.status === 'CONFIG_ERROR' || c.status === 'UNAVAILABLE')
                            .map(c => `PROP_FIRM_${c.rule}_${c.status}`);
                        const scanDurationMs = Date.now() - scanStart;
                        await recordEvaluation(supabase, {
                            user_id: userId,
                            watcher_id: watcher.id,
                            pair: selectedPair,
                            timeframe: selectedTimeframe,
                            strategy_mode: executionMode,
                            decision_score: decisionResult.decision_score,
                            matched_weight: decisionResult.matched_weight,
                            possible_weight: decisionResult.possible_weight,
                            recommendation: decisionResult.recommendation,
                            mandatory_rules_passed: decisionResult.mandatory_rules_passed,
                            matched_rules: decisionResult.matched_rules,
                            failed_rules: [...(decisionResult.failed_rules || []), ...(failedPropRules.length > 0 ? failedPropRules : ['PROP_FIRM_GATE_BLOCKED'])],
                            gemini_used: geminiCalled,
                            gemini_result: geminiTextResult || null,
                            trade_sent: false,
                            trade_reason: `PROP_FIRM_GATE_BLOCKED: ${propBlockReason}`,
                            scan_duration_ms: scanDurationMs,
                            gemini_duration_ms: geminiDuration,
                            execution_source: brokerExecutionMode,
                            decision_snapshot: decisionSnapshot
                        });
                        watchersProcessedCount++;
                        isWatcherSkipped = false;
                        results.push({ userId, symbol, tradeStatus: 'WAITING', result: `Prop Firm Gate blocked: ${propBlockReason}` });
                        return;
                    }
                    const liveTradingEnabled = process.env.LIVE_TRADING_ENABLED === 'true';
                    let brokerQuote;
                    let brokerQuoteFreshnessPassed = false;
                    try {
                        console.log(`[Stage 7] Fetching fresh broker quote for ${selectedPair}...`);
                        brokerQuote = await getBrokerProvider().getQuote(selectedPair);
                        if (brokerQuote) {
                            const quoteAgeMs = Date.now() - brokerQuote.timestamp;
                            const maxQuoteAgeMs = Number(process.env.BROKER_QUOTE_MAX_AGE_MS) || 5000;
                            brokerQuoteFreshnessPassed = quoteAgeMs <= maxQuoteAgeMs;
                            console.log(`[Broker Quote]
Symbol: ${brokerQuote.symbol}
Bid: ${brokerQuote.bid}
Ask: ${brokerQuote.ask}
Spread: ${brokerQuote.spread?.toFixed(5) || '0.00000'}
Age: ${quoteAgeMs}ms (Threshold: ${maxQuoteAgeMs}ms)
Freshness: ${brokerQuoteFreshnessPassed ? 'PASS' : 'FAIL'}
Source: ${brokerQuote.source}`);
                        }
                    }
                    catch (quoteErr) {
                        console.error(`[Broker Quote Error] Failed to fetch quote for ${selectedPair}:`, quoteErr.message);
                    }
                    const maxSpreadThreshold = Number(process.env.BROKER_MAX_SPREAD_PERCENT) || 0.0005;
                    const maxEntryDriftThreshold = Number(process.env.BROKER_MAX_ENTRY_DRIFT_PERCENT) || 0.001;
                    const currentExecutionPrice = analysis.signal === 'BUY' ? brokerQuote?.ask : brokerQuote?.bid;
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
                        intendedEntryPrice: posSizeResult.entryPrice || executedPrice,
                        temporaryBypassAllPostSignalConfirmations: true
                    });
                    if (brokerValidation.status === 'FINAL_EXECUTION_REJECTED') {
                        console.log(`[TEMPORARY DISENGAGEMENT] Suppressed broker quote gate rejection '${brokerValidation.rejectionReason}' for Watcher ID: ${watcher.id} (${selectedPair}). Authorizing signal based solely on break and retest confirmation.`);
                    }
                    const microlotGovernor = new SupervisedMicrolotGovernor(brokerProvider);
                    const riskAmount = posSizeResult.riskAmount || (posSizeResult.calculatedLotSize * 10);
                    const microlotResult = await microlotGovernor.validateExecution(selectedPair, riskAmount);
                    if (!microlotResult.accepted) {
                        console.warn(`[Stage 8/17 Microlot Rejected] ${microlotResult.reason}`);
                        const scanDurationMs = Date.now() - scanStart;
                        await recordEvaluation(supabase, {
                            user_id: userId,
                            watcher_id: watcher.id,
                            pair: selectedPair,
                            timeframe: selectedTimeframe,
                            strategy_mode: executionMode,
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
                    cronTimer.startStage("Broker Order & Signal Registration", watcher.id);
                    const stableClientOrderId = `cl-${watcher.id}-${latestClosedCandleTime.replace(/[:.-]/g, '')}`;
                    let brokerOrder = null;
                    try {
                        brokerOrder = await brokerProvider.findOrderByClientOrderId(stableClientOrderId);
                        if (brokerOrder) {
                            console.log(`[Stage 8 Recovery] Existing order found for ${selectedPair} (ID: ${brokerOrder.orderId}). Rehydrating state.`);
                        }
                        else {
                            const existingPos = await brokerProvider.getPosition(selectedPair);
                            if (existingPos) {
                                console.log(`[Stage 8 Protection] Existing position found for ${selectedPair} at broker. Skipping duplicate execution.`);
                                return;
                            }
                            const orderParams = {
                                symbol: selectedPair,
                                type: 'MARKET',
                                side: analysis.signal === 'BUY' ? 'BUY' : 'SELL',
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
                            }
                            else if (brokerExecutionMode === 'PAPER') {
                                console.log(`[PAPER EXECUTION] Routing PAPER order for ${selectedPair}...`);
                                brokerOrder = await brokerProvider.placeOrder(orderParams);
                            }
                            else {
                                console.log(`[THEORETICAL EXECUTION] Recording THEORETICAL order for ${selectedPair}...`);
                                brokerOrder = await brokerProvider.placeOrder(orderParams);
                            }
                        }
                        if (!brokerOrder || brokerOrder.status === 'REJECTED') {
                            throw new Error(brokerOrder?.status === 'REJECTED' ? 'Broker rejected the order' : 'Empty response from broker');
                        }
                    }
                    catch (execErr) {
                        console.error(`[EXECUTION FAILED] Fail-closed logic triggered for Watcher ${watcher.id}:`, execErr.message);
                        const scanDurationMs = Date.now() - scanStart;
                        await recordEvaluation(supabase, {
                            user_id: userId,
                            watcher_id: watcher.id,
                            pair: selectedPair,
                            timeframe: selectedTimeframe,
                            strategy_mode: executionMode,
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
                    const candidateTradeUuid = toValidUuid(brokerOrder.tradeId);
                    const candidateTradeId = candidateTradeUuid;
                    const gatesList = [
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
                    if (attribution.finalDecision !== 'EXECUTE' && analysis.signal !== 'BUY' && analysis.signal !== 'SELL') {
                        console.log(`[Authoritative Decision] Signal suppressed for Watcher ID: ${watcher.id} (${selectedPair}): Final decision is ${attribution.finalDecision} from gate ${attribution.rejectedGate || 'UNKNOWN'}.`);
                        analysis.signal = 'NO_TRADE';
                        const scanDurationMs = Date.now() - scanStart;
                        await recordEvaluation(supabase, {
                            user_id: userId,
                            watcher_id: watcher.id,
                            pair: selectedPair,
                            timeframe: selectedTimeframe,
                            strategy_mode: executionMode,
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
                    let signal = null;
                    let isRegistered = false;
                    if (analysis.signal === 'BUY' || analysis.signal === 'SELL' || recommendation !== 'FAIL') {
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
                    }
                    else {
                        logWatcherEvent('SIGNAL SKIPPED', logCtx, 'No actionable signal. Setting signal to NO_TRADE.');
                        analysis.signal = 'NO_TRADE';
                    }
                    await supabase
                        .from("watchers")
                        .update({
                        last_analyzed_closed_candle_time: latestClosedCandleTime
                    })
                        .eq("id", watcher.id);
                    if (!isRegistered && (analysis.signal !== 'BUY' && analysis.signal !== 'SELL')) {
                        logWatcherEvent('SIGNAL REGISTERED', logCtx, 'Failed to register signal or active trade already exists in database');
                        const scanDurationMs = Date.now() - scanStart;
                        await recordEvaluation(supabase, {
                            user_id: userId,
                            watcher_id: watcher.id,
                            pair: selectedPair,
                            timeframe: selectedTimeframe,
                            strategy_mode: executionMode,
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
                    cronTimer.startStage("Telegram Alert & DB Persistence", watcher.id);
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
                        }
                        else {
                            signalsSuppressedAsDuplicatesCount++;
                        }
                        logWatcherEvent('Signal Deduplication', logCtx, `Suppressed Telegram alert: ${dedupCheck.reason}`);
                    }
                    else {
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
                        }
                        else {
                            logWatcherError('SIGNAL REGISTERED', logCtx, `Telegram message blocked or failed: ${alertReason}`);
                        }
                    }
                    const scanDurationMs = Date.now() - scanStart;
                    await recordEvaluation(supabase, {
                        user_id: userId,
                        watcher_id: watcher.id,
                        pair: selectedPair,
                        timeframe: selectedTimeframe,
                        strategy_mode: executionMode,
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
                    logWatcherEvent('ACTIVE UPDATE START', logCtx, `Updating trade_status = ACTIVE with trade_id: ${candidateTradeUuid}`);
                    activeZonesMemoryMap.delete(watcher.id);
                    let activePayload = {
                        trade_status: 'ACTIVE',
                        active_trade_id: candidateTradeUuid,
                        entry_price: analysis.entryPrice,
                        stop_loss: analysis.stopLoss,
                        take_profit: analysis.takeProfit,
                        direction: analysis.signal,
                        lot_size: posSizeResult?.calculatedLotSize ?? null,
                        expected_loss: posSizeResult?.expectedLoss ?? null,
                        risk_amount: posSizeResult?.riskAmount ?? null,
                        contract_size: posSizeResult?.contractSize ?? null,
                        last_signal_data: signal ?? null,
                        zone_status: 'CONFIRMED',
                        opened_at: new Date().toISOString(),
                        closed_at: null,
                        cooldown_until: null,
                        last_scan_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    };
                    let { data: activeUpdateRows, error: activeUpdateErr } = await supabase
                        .from("watchers")
                        .update(activePayload)
                        .eq("id", watcher.id)
                        .select();
                    if (activeUpdateErr &&
                        (activeUpdateErr.message?.includes('lot_size') ||
                            activeUpdateErr.message?.includes('expected_loss') ||
                            activeUpdateErr.message?.includes('risk_amount') ||
                            activeUpdateErr.message?.includes('contract_size') ||
                            activeUpdateErr.message?.includes('last_signal_data'))) {
                        delete activePayload.lot_size;
                        delete activePayload.expected_loss;
                        delete activePayload.risk_amount;
                        delete activePayload.contract_size;
                        delete activePayload.last_signal_data;
                        const fallbackRes = await supabase
                            .from("watchers")
                            .update(activePayload)
                            .eq("id", watcher.id)
                            .select();
                        activeUpdateRows = fallbackRes.data;
                        activeUpdateErr = fallbackRes.error;
                    }
                    if (activeUpdateErr && activeUpdateErr.message?.includes('zone_status')) {
                        delete activePayload.zone_status;
                        const fallbackRes = await supabase
                            .from("watchers")
                            .update(activePayload)
                            .eq("id", watcher.id)
                            .select();
                        activeUpdateRows = fallbackRes.data;
                        activeUpdateErr = fallbackRes.error;
                    }
                    if (activeUpdateErr && (activeUpdateErr.code === '22P02' || activeUpdateErr.message?.includes('active_trade_id'))) {
                        console.warn(`[ACTIVE UPDATE WARNING] Retrying without active_trade_id for Watcher ID: ${watcher.id}:`, activeUpdateErr.message);
                        delete activePayload.active_trade_id;
                        const fallbackRes = await supabase
                            .from("watchers")
                            .update(activePayload)
                            .eq("id", watcher.id)
                            .select();
                        activeUpdateRows = fallbackRes.data;
                        activeUpdateErr = fallbackRes.error;
                    }
                    if (activeUpdateErr) {
                        console.error(`[ACTIVE UPDATE CRITICAL] Retrying with minimal active payload for Watcher ID: ${watcher.id}:`, activeUpdateErr.message);
                        const minPayload = {
                            trade_status: 'ACTIVE',
                            entry_price: analysis.entryPrice,
                            stop_loss: analysis.stopLoss,
                            take_profit: analysis.takeProfit,
                            direction: analysis.signal,
                            opened_at: new Date().toISOString(),
                            last_scan_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        };
                        const fallbackRes = await supabase
                            .from("watchers")
                            .update(minPayload)
                            .eq("id", watcher.id)
                            .select();
                        activeUpdateRows = fallbackRes.data;
                        activeUpdateErr = fallbackRes.error;
                    }
                    const dbUpdateActiveSucceeded = !activeUpdateErr && activeUpdateRows && activeUpdateRows.length > 0;
                    if (dbUpdateActiveSucceeded) {
                        logWatcherEvent('ACTIVE UPDATE SUCCESS', logCtx, 'Watcher successfully updated to trade_status = ACTIVE in Supabase.');
                    }
                    else {
                        logWatcherError('ACTIVE UPDATE FAILED', logCtx, activeUpdateErr?.message || 'No rows returned from update');
                    }
                    addLog("Scan Completed", "success");
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
                }
                catch (err) {
                    const fallbackCtx = typeof logCtx !== 'undefined' ? logCtx : await resolveWatcherUserContext(supabase, watcher);
                    logWatcherError('WATCHER ERROR', fallbackCtx, err);
                    errors.push({ userId, error: err.message || "Unknown error" });
                    watchersSkippedCount++;
                }
            }
            finally {
                cronTimer.endWatcher(isWatcherSkipped, watcher?.id);
            }
        }
        const CONCURRENCY_LIMIT = 10;
        await processWithConcurrency(watchers, CONCURRENCY_LIMIT, async (watcher) => {
            if (!hasProcessingTimeRemaining()) {
                if (!earlyExit) {
                    console.warn(`[CRON DEADLINE] Global processing deadline reached (${Date.now() - cronStartedAt}ms elapsed / ${PROCESSING_DEADLINE_MS}ms budget). Halting watcher loop.`);
                    earlyExit = true;
                    earlyExitReason = "PROCESSING_DEADLINE";
                    cronTimer.markEarlyExit();
                }
                return;
            }
            await processSingleWatcher(watcher, brokerAccount);
        });
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
            }
            catch {
            }
        }
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
            }
            catch (e) {
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
            watchersSkippedWeekend: watchersSkippedWeekendCount,
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
                watchersSkippedWeekend: watchersSkippedWeekendCount,
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
    }
    catch (err) {
        console.error("[CRON FATAL]", err);
        return res.status(500).json({
            success: false,
            error: String(err)
        });
    }
}
