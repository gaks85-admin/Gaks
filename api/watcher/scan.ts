import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from "@google/genai";
import { defaultMarketDataService, getMarketDataStats } from '../../src/lib/market-data-service.js';
import { analyzeMarket, Candle } from "../../src/lib/strategy-engine.js";
import { extractRiskPreferences, calculatePositionSize, parseRiskRewardRatio } from "../../src/lib/risk-engine.js";
import { calculateStructuralStopLoss, validateAndResolveStopLoss } from "../../src/lib/structural-stop-loss.js";
import { evaluateRules } from "../../src/lib/rule-engine.js";
import { compileStrategy } from "../../src/lib/strategy-compiler.js";
import { evaluateDecision } from "../../src/lib/decision-engine.js";
import { extractMarketStructure } from "../../src/lib/market-structure-engine.js";
import { recordEvaluation } from "../../src/lib/explainability-engine.js";
import { validateMarketDataIntegrity } from "../../src/lib/market-integrity.js";
import { normalizeConfidence } from "../../src/lib/confidence-engine.js";
import { resolveUserGeminiKey, classifyAndRedactGeminiError } from "../../src/lib/gemini-key-resolver.js";
import { executeBoundedGeminiCall } from "../../src/lib/geminiWrapper.js";
import { computeEquityAnalytics, deriveEquityState, fetchUserCompletedTrades } from "../../src/lib/equity-learning-engine.js";
import { evaluateRiskGovernor } from "../../src/lib/risk-governor.js";
import { evaluateAdaptiveLearning, fetchCompletedTradesForAdaptiveLearning } from "../../src/lib/adaptive-learning-engine.js";
import { evaluateQualityGate, calculateAdaptiveQualityRequirement } from "../../src/lib/quality-gate.js";
import { evaluateAdaptiveExecution } from "../../src/lib/adaptive-execution-engine.js";
import { evaluateClosedLoopCalibration } from "../../src/lib/closed-loop-calibration-engine.js";
import { resolveAuthoritativeDecision, DecisionGateResult } from "../../src/lib/decision-attribution.js";
import { calculateHistoricalProbability, recordCompletedTrade } from "../../src/lib/learning-engine.js";
import { validateActiveTradeState } from "../../src/lib/trade-validator.js";
import { buildActiveTradeTelemetry, evaluateActiveTradeExit } from "../../src/lib/active-trade-monitor.js";


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
  const res = await defaultMarketDataService.validateSymbol(symbol);
  if (res.isValid) {
    return { isValid: true, matchedSymbol: res.matchedSymbol, instrumentType: res.instrumentType };
  }
  return { isValid: true, matchedSymbol: symbol };
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

  let userId = req.body.userId;

  // 2. Supabase Connection & Auth
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

    if (token) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (user) userId = user.id;
    }
  } catch (err: any) {
    console.error("Supabase connection/auth failed");
    console.error(`Exception: ${err.message}`);
  }

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: "Authentication failed."
    });
  }

  try {
    // 3. Active Watchers Found
    let watcherQuery = supabase
      .from("watchers")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active");

    if (req.body?.symbol || req.body?.selected_pair) {
      watcherQuery = watcherQuery.eq("selected_pair", req.body?.symbol || req.body?.selected_pair);
    }

    const { data: watcher, error: watcherError } = await watcherQuery.limit(1).maybeSingle();

    if (watcherError) throw watcherError;
    if (!watcher) throw new Error("No watcher found.");

    // =====================================================================
    // STATE 2 — ACTIVE TRADE MONITORING (Parity with Cron Engine)
    // =====================================================================
    const tradeStatus = (watcher.trade_status || 'WAITING').toUpperCase().trim();
    if (tradeStatus === 'ACTIVE') {
      const activeValidation = validateActiveTradeState(watcher);
      if (!activeValidation.valid) {
        console.warn(`[Manual Scan] Invalid ACTIVE trade state detected for watcher ${watcher.id}: ${activeValidation.reason}. Healing to WAITING.`);
        await supabase.from("watchers").update({
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

        return res.status(200).json({
          success: true,
          data: {
            watcher_id: watcher.id,
            pair: watcher.selected_pair,
            signal: 'WAIT',
            status: 'WAITING',
            healed: true,
            reasoning: [`Invalid active trade state healed to WAITING: ${activeValidation.reason}`]
          }
        });
      }

      // Fetch latest market price for active position
      const symbol = watcher.selected_pair;
      let currentPrice: number | null = null;
      try {
        currentPrice = await defaultMarketDataService.fetchCurrentPrice(symbol);
      } catch (err: any) {
        console.warn(`[Manual Scan] Could not fetch real-time price from Provider:`, err.message);
      }

      if (currentPrice === null || isNaN(currentPrice)) {
        return res.status(200).json({
          success: true,
          data: {
            watcher_id: watcher.id,
            pair: symbol,
            signal: 'WAIT',
            status: 'ACTIVE',
            subStatus: 'HOLDING',
            message: 'Active trade open. Market price temporarily unavailable.',
            active_trade: {
              trade_id: watcher.active_trade_id,
              direction: watcher.direction,
              entry_price: watcher.entry_price,
              stop_loss: watcher.stop_loss,
              take_profit: watcher.take_profit,
              opened_at: watcher.opened_at
            }
          }
        });
      }

      const entryPrice = parseFloat(String(watcher.entry_price));
      const stopLoss = parseFloat(String(watcher.stop_loss));
      const takeProfit = parseFloat(String(watcher.take_profit));
      const dir = (watcher.direction || '').toUpperCase().trim();
      const exitEval = evaluateActiveTradeExit(dir, entryPrice, stopLoss, takeProfit, currentPrice);
      const telemetry = buildActiveTradeTelemetry(watcher, currentPrice);

      // 1. Target Reached (TP_HIT)
      if (exitEval.exitStatus === 'TP_HIT') {
        const { data: conn } = await supabase
          .from("telegram_connections")
          .select("telegram_chat_id, connected")
          .eq("user_id", userId)
          .maybeSingle();

        if (conn?.connected && conn?.telegram_chat_id) {
          await sendTelegramMessage(conn.telegram_chat_id, `✅ Trade closed\nTarget reached`);
        }

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
        } catch (e) {}

        const activeTradeId = watcher.active_trade_id || watcher.last_signal_data?.trade_id || null;

        await recordCompletedTrade(supabase, {
          user_id: userId,
          watcher_id: watcher.id,
          trade_id: activeTradeId,
          evaluation_id: latestEval?.id || null,
          pair: symbol,
          timeframe: watcher.selected_timeframe || 'H1',
          strategy_mode: latestEval?.strategy_mode || 'HYBRID',
          entry_price: entryPrice,
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
          notes: `Trade closed via TP. Exit Price: ${currentPrice}`,
          decision_snapshot: latestEval?.decision_snapshot || null
        });

        const cooldownUntilIso = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        await supabase.from("watchers").update({
          trade_status: 'COOLDOWN',
          active_trade_id: null,
          closed_at: new Date().toISOString(),
          cooldown_until: cooldownUntilIso,
          last_scan_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }).eq("id", watcher.id);

        return res.status(200).json({
          success: true,
          data: {
            watcher_id: watcher.id,
            pair: symbol,
            signal: 'NO_TRADE',
            status: 'COOLDOWN',
            resolution: 'TP_HIT',
            outcome: 'WIN',
            realizedR: exitEval.realizedR,
            exitPrice: currentPrice,
            telemetry,
            message: `Target reached! Trade closed at ${currentPrice} (+${exitEval.realizedR}R)`
          }
        });
      }

      // 2. Stop Loss Hit (SL_HIT)
      if (exitEval.exitStatus === 'SL_HIT') {
        const { data: conn } = await supabase
          .from("telegram_connections")
          .select("telegram_chat_id, connected")
          .eq("user_id", userId)
          .maybeSingle();

        if (conn?.connected && conn?.telegram_chat_id) {
          await sendTelegramMessage(conn.telegram_chat_id, `❌ Trade closed\nStop loss hit`);
        }

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
        } catch (e) {}

        const activeTradeId = watcher.active_trade_id || watcher.last_signal_data?.trade_id || null;

        await recordCompletedTrade(supabase, {
          user_id: userId,
          watcher_id: watcher.id,
          trade_id: activeTradeId,
          evaluation_id: latestEval?.id || null,
          pair: symbol,
          timeframe: watcher.selected_timeframe || 'H1',
          strategy_mode: latestEval?.strategy_mode || 'HYBRID',
          entry_price: entryPrice,
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
          notes: `Trade closed via SL. Exit Price: ${currentPrice}`,
          decision_snapshot: latestEval?.decision_snapshot || null
        });

        const cooldownUntilIso = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
        console.log(`[LOSS COOLDOWN] Watcher ${watcher.id} entered 4-hour cooldown after STOP_LOSS.`);
        await supabase.from("watchers").update({
          trade_status: 'COOLDOWN',
          active_trade_id: null,
          closed_at: new Date().toISOString(),
          cooldown_until: cooldownUntilIso,
          last_scan_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }).eq("id", watcher.id);

        return res.status(200).json({
          success: true,
          data: {
            watcher_id: watcher.id,
            pair: symbol,
            signal: 'NO_TRADE',
            status: 'COOLDOWN',
            resolution: 'SL_HIT',
            outcome: 'LOSS',
            realizedR: -1.0,
            exitPrice: currentPrice,
            telemetry,
            message: `Stop loss hit. Trade closed at ${currentPrice} (-1.0R)`
          }
        });
      }

      // 3. Trade is currently HOLDING
      return res.status(200).json({
        success: true,
        data: {
          watcher_id: watcher.id,
          pair: symbol,
          signal: 'WAIT',
          status: 'ACTIVE',
          subStatus: 'HOLDING',
          telemetry,
          message: `Active trade holding: ${telemetry ? `${telemetry.unrealizedPnlR >= 0 ? '+' : ''}${telemetry.unrealizedPnlR}R (${telemetry.pipsInProfit >= 0 ? '+' : ''}${telemetry.pipsInProfit} pips)` : 'Monitoring price'}`
        }
      });
    }

    // Cooldown Expiry Auto-Reset
    if (tradeStatus === 'COOLDOWN') {
      const cooldownUntil = watcher.cooldown_until ? new Date(watcher.cooldown_until).getTime() : 0;
      if (Date.now() >= cooldownUntil) {
        await supabase.from("watchers").update({
          trade_status: 'WAITING',
          cooldown_until: null,
          updated_at: new Date().toISOString()
        }).eq("id", watcher.id);
        watcher.trade_status = 'WAITING';
      } else {
        const remainingSec = Math.max(0, Math.round((cooldownUntil - Date.now()) / 1000));
        return res.status(200).json({
          success: true,
          data: {
            watcher_id: watcher.id,
            pair: watcher.selected_pair,
            signal: 'WAIT',
            status: 'COOLDOWN',
            remainingSeconds: remainingSec,
            reasoning: [`Watcher is in cooldown for ${remainingSec} more seconds.`]
          }
        });
      }
    }
    
    // 4. Strategy Loaded
    const { data: prefsRecord } = await supabase
      .from("trading_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    const strategyText = extractStrategyTextById(prefsRecord?.strategy_text || '', watcher.strategy_id);

    const riskPrefs = extractRiskPreferences(prefsRecord, userId);
    const accountSize = riskPrefs.accountSize;
    const riskPercentage = riskPrefs.riskPercentage;
    const riskRewardStr = riskPrefs.riskRewardStr;
    const maxDailyRiskStr = riskPrefs.maxDailyRiskStr;
    const positionMode = riskPrefs.positionMode;
    const preferredLotSize = riskPrefs.preferredLotSize;

    // 5. Compiled Strategy Loaded
    const compiledStrategy = compileStrategy(strategyText);

    // 6. Candle Data Downloaded
    const symbol = watcher.selected_pair;
    const mappedSymbol = symbol; // Simplified for logging
    const selectedTimeframe = watcher.selected_timeframe || 'H1';
    const interval = '1h'; // Simplified

    const reqArgs = {
      symbol: mappedSymbol,
      timeframe: selectedTimeframe,
      requiredCount: 20,
      watcherId: watcher.id,
      userId: userId,
      purpose: 'Manual Watcher Scan'
    };
    const tsResult = await defaultMarketDataService.getMarketData(reqArgs);
    const candleData = tsResult.candles || [];

    if (!tsResult.isValid || candleData.length < 2) {
      const isQuota = tsResult.errorType === 'QUOTA_EXHAUSTED' || tsResult.reason === 'MARKET_DATA_PROVIDER_QUOTA_EXHAUSTED' || tsResult.reason?.includes('429');
      const failReason = isQuota ? 'MARKET_DATA_PROVIDER_QUOTA_EXHAUSTED' : (tsResult.reason || 'Insufficient market candle data.');
      
      console.warn(`[MANUAL SCAN MARKET DATA] Watcher ${watcher.id} (${symbol}): ${failReason}`);
      return res.json({
        success: true,
        data: {
          watcher_id: watcher.id,
          pair: symbol,
          signal: 'NO_TRADE',
          confidence: 0,
          reasoning: [`Market Data Check: ${failReason}`],
          reasonCode: isQuota ? 'MARKET_DATA_PROVIDER_QUOTA_EXHAUSTED' : 'MARKET_DATA_UNAVAILABLE',
          marketDataUnavailable: true,
          creditsUsed: tsResult.creditsUsed ?? null,
          creditsRemaining: tsResult.creditsRemaining ?? null
        }
      });
    }

    // Fix 1: Validate Market Data Temporal Integrity
    const integrity = validateMarketDataIntegrity(symbol, candleData);
    if (!integrity.valid) {
      console.log(`[Market Data Integrity] Watcher ${watcher.id} (${symbol}) failed integrity check: ${integrity.reason}`);
      return res.json({
        success: true,
        data: {
          watcher_id: watcher.id,
          pair: symbol,
          signal: 'NO_TRADE',
          confidence: 0,
          reasoning: [`Market Data Integrity Check Failed: ${integrity.reason}`],
          integrity
        }
      });
    }

    const scanStart = Date.now();

    // 7. Extract Market Structure & Compile Strategy
    const marketStructure = extractMarketStructure(candleData);
    const strategyCompilationConfidenceRecord = normalizeConfidence(
      compiledStrategy.overall_confidence ?? compiledStrategy.confidence,
      'strategy_compilation',
      'Strategy Compiler'
    );
    const strategyCompilationConfidence = strategyCompilationConfidenceRecord.normalized;

    // Stage 2
    const cleanSymUpper = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const pipSize = (cleanSymUpper.includes('JPY') || cleanSymUpper.includes('XAU') || cleanSymUpper.includes('GOLD')) ? 0.01 : 0.0001;

    // 8. Weighted Decision Engine Execution (Pass 1 to get matched rules)
    (marketStructure as any).pair = symbol;
    (marketStructure as any).timeframe = selectedTimeframe;
    (marketStructure as any).lastClosedCandleTimestamp = candleData[candleData.length - 2]?.timestamp || '';
    const initialResult = evaluateDecision(compiledStrategy, marketStructure);

    // Fetch Historical Probability from Learning Engine
    const histResult = await calculateHistoricalProbability(
      supabase,
      userId,
      symbol,
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

    let analysis: any = {
      signal: 'NO_TRADE',
      confidence: 0,
      entryPrice: null,
      stopLoss: null,
      takeProfit: null,
      riskReward: null,
      reasoning: []
    };

    let geminiCalled = false;
    let geminiSucceeded = false;
    let geminiTextResult = "";
    let geminiStart = 0;
    let geminiDuration = 0;

    const recommendation = decisionResult.recommendation; // PASS, LIKELY_PASS, AMBIGUOUS, FAIL
    const executionMode = compiledStrategy.strategy_mode || 'HYBRID';
    const forceGemini = (recommendation === 'FAIL' && (executionMode === 'HYBRID' || executionMode === 'AI_ONLY'));
    const requiresGemini = Boolean(decisionResult.requires_gemini || forceGemini || recommendation === 'AMBIGUOUS');

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
      geminiCalled = true;
      geminiStart = Date.now();

      const keyRes = await resolveUserGeminiKey(supabase, userId, watcher?.id || 'manual-scan');

      if (!keyRes.keyPresent || !keyRes.apiKey) {
        console.log(`[Decision Engine] User ${userId} has no Gemini API key in user_api_keys. Forcing NO_TRADE.`);

        await supabase.from("profiles").update({
          gemini_status: 'NOT_CONNECTED',
          gemini_last_error: 'Missing Gemini API key',
          gemini_last_checked: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }).eq("id", userId);

        analysis = {
          signal: 'NO_TRADE',
          confidence: 0,
          entryPrice: null,
          stopLoss: null,
          takeProfit: null,
          riskReward: null,
          reasoning: ['User has no Gemini API key configured. Gemini required for execution.']
        };
      } else {
        const geminiKey = keyRes.apiKey;
        try {
          const ai = new GoogleGenAI({ apiKey: geminiKey });
          const currentPrice = candleData[candleData.length - 1].close;
          const promptText = `
You are an expert AI trading assistant.
Evaluate whether the market conditions satisfy the user's strategy and derive structural trade levels.

Current Price: ${currentPrice}

Detailed Numeric Market Structure & Key Levels:
- Trend: ${marketStructure.trend}
- Support Zones (Min-Max): ${marketStructure.supportZones?.map(s => `[${s.priceMin.toFixed(5)} - ${s.priceMax.toFixed(5)}]`).join(', ') || 'None'}
- Resistance Zones (Min-Max): ${marketStructure.resistanceZones?.map(r => `[${r.priceMin.toFixed(5)} - ${r.priceMax.toFixed(5)}]`).join(', ') || 'None'}
- Swing Highs: ${marketStructure.swingHighs?.slice(-3).map(s => s.price.toFixed(5)).join(', ') || 'None'}
- Swing Lows: ${marketStructure.swingLows?.slice(-3).map(s => s.price.toFixed(5)).join(', ') || 'None'}
- Fair Value Gaps: ${marketStructure.fairValueGaps?.slice(-3).map(f => `${f.type} (${f.bottom.toFixed(5)} - ${f.top.toFixed(5)})`).join(', ') || 'None'}
- Volume Confirmation: ${marketStructure.volumeInformation.volumeSpike ? 'Confirmed' : 'Normal'}
- ATR: ${marketStructure.volatilityInformation.atr.toFixed(5)}

User's Trading Strategy:
${strategyText}

AI Instructions:
1. Determine if conditions satisfy the strategy ('BUY', 'SELL', 'NO_TRADE').
2. For BUY: Stop Loss MUST be placed BELOW entry, below relevant support zone, swing low, or demand structure.
3. For SELL: Stop Loss MUST be placed ABOVE entry, above relevant resistance zone, swing high, or supply structure.
4. Identify stopLossBasis (SUPPORT_ZONE, RESISTANCE_ZONE, SWING_LOW, SWING_HIGH, DEMAND_ZONE, SUPPLY_ZONE, STRUCTURAL_CANDLE, ATR_FALLBACK).

Answer with JSON matching schema.
`;
          const geminiRes = await executeBoundedGeminiCall(
            ai,
            {
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
              },
              timeoutMs: 10500,
              apiDeadlineMs: 10000,
              maxRetriesFor503: 1,
              backoffMsFor503: 500
            },
            {
              userId,
              watcherId: watcher?.id || 'manual-scan',
              pair: watcher?.pair || 'unknown',
              timeframe: watcher?.timeframe || 'unknown',
              keySource: keyRes.keySource,
              requestId: `req_scan_${watcher?.id || 'manual'}_${Date.now()}`
            }
          );
          geminiDuration = geminiRes.durationMs;
          if (!geminiRes.success || !geminiRes.text) {
            throw new Error(geminiRes.cleanErrorMessage || "Gemini execution failed");
          }
          geminiTextResult = geminiRes.text;
          const parsedResult = JSON.parse(geminiTextResult);

          if (parsedResult.satisfies && parsedResult.direction && parsedResult.direction !== 'NO_TRADE') {
            geminiSucceeded = true;
            const signalDir = parsedResult.direction as 'BUY' | 'SELL';
            const entry = Number(parsedResult.entryPrice) || candleData[candleData.length - 1].close;

            const slResult = validateAndResolveStopLoss(
              signalDir,
              entry,
              parsedResult.stopLoss,
              parsedResult.stopLossBasis,
              marketStructure
            );

            let finalTP = Number(parsedResult.takeProfit);
            const isTpValid = !isNaN(finalTP) && finalTP > 0 &&
              (signalDir === 'BUY' ? finalTP > entry : finalTP < entry);

            if (!isTpValid) {
              const riskDist = Math.abs(entry - slResult.stopLoss);
              const rrRatio = parseRiskRewardRatio(riskRewardStr);
              finalTP = signalDir === 'BUY' ? entry + (riskDist * rrRatio) : entry - (riskDist * rrRatio);
            }

            const geminiConfRecord = normalizeConfidence(parsedResult.confidenceScore, 'gemini', 'Gemini AI Model');
            const finalConfRecord = normalizeConfidence(geminiConfRecord.normalized, 'final_trade', 'Executable Signal');

            console.log(`[Gemini Decision]
Required: YES
Status: APPROVED
Direction: ${signalDir}
Confidence: ${geminiConfRecord.normalized}%
Fallback: NO_TRADE`.trim());

            console.log(`[TP Analysis]
Direction: ${signalDir}
Entry: ${entry}
SL: ${slResult.stopLoss}
TP1: ${finalTP}
TP2: ${parsedResult.tp2 ?? 'N/A'}
TP3: ${parsedResult.tp3 ?? 'N/A'}
TP Basis: ${parsedResult.stopLossBasis || 'Market Structure Target'}`);

            analysis = {
              signal: signalDir,
              confidence: finalConfRecord.normalized,
              entryPrice: entry,
              stopLoss: slResult.stopLoss,
              stopLossBasis: slResult.stopLossBasis,
              structuralLevel: slResult.structuralLevel,
              takeProfit: finalTP,
              tp1: parsedResult.tp1 || finalTP,
              tp2: parsedResult.tp2 || null,
              tp3: parsedResult.tp3 || null,
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
              entryPrice: null,
              stopLoss: null,
              takeProfit: null,
              riskReward: null,
              reasoning: [parsedResult?.reasoning || "Gemini evaluated setup as NO_TRADE or unsatisfied."]
            };
          }
        } catch (gemErr: any) {
          console.warn(`[Gemini Validation Error]: Rejecting trade due to Gemini failure:`, gemErr.message);

          const { profileStatus, diagnosticStatus, cleanErrorMessage } = classifyAndRedactGeminiError(gemErr);

          console.log(`[Gemini Key Resolution]
User ID: ${userId}
Watcher ID: ${watcher?.id || 'manual-scan'}
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

          analysis = {
            signal: 'NO_TRADE',
            confidence: 0,
            entryPrice: null,
            stopLoss: null,
            takeProfit: null,
            riskReward: null,
            reasoning: [`Gemini API call failed (${diagnosticStatus}): ${cleanErrorMessage}`]
          };
          if (geminiStart > 0) {
            geminiDuration = Date.now() - geminiStart;
          }
        }
      }
    } else {
      // Gemini NOT required! Check recommendation
      if (recommendation === 'FAIL' || recommendation === 'AMBIGUOUS') {
        console.log(`[Decision Engine] Recommendation is ${recommendation}. Forcing NO_TRADE without Gemini approval.`);
        analysis = {
          signal: 'NO_TRADE',
          confidence: 0,
          entryPrice: null,
          stopLoss: null,
          takeProfit: null,
          riskReward: null,
          reasoning: [`Rejected by Decision Engine (${recommendation} without Gemini approval)`]
        };
      } else {
        console.log(`[Decision Engine] Recommendation is ${recommendation}. Evaluating local strategy engine.`);
        const localAnalysis = analyzeMarket(candleData, compiledStrategy as any);
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

    if (requiresGemini) {
      if (analysis.signal !== 'BUY' && analysis.signal !== 'SELL') {
        console.log(`[Safety Invariant] Gemini required. Executed: ${geminiCalled ? 'YES' : 'NO'}, Final Signal reset to NO_TRADE.`);
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

    // Quality Gate Check (QUALITY OVER QUANTITY)
    let qualityResult: any = null;
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
        historicalProbability: histResult?.historical_probability || 50
      });

      if (!qualityResult.passed) {
        console.log(`[Signal Quality] Signal rejected by Quality Gate for ${symbol}: ${qualityResult.reason} (Score: ${qualityResult.qualityScore})`);
        analysis.signal = 'NO_TRADE';
      }
    }

    // Adaptive Learning Evaluation (Stage 3B) & Adaptive Quality Requirement (Stage 3C)
    let adaptiveResult: any = null;
    let adaptiveReq: any = null;
    let executionResult: any = null;
    let calibrationResult: any = null;
    let governorResult: any = null;

    if (analysis.signal === 'BUY' || analysis.signal === 'SELL') {
      try {
        const completedTrades = await fetchCompletedTradesForAdaptiveLearning(supabase, userId);
        adaptiveResult = evaluateAdaptiveLearning({
          pair: symbol,
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
Requested: ${symbol} + ${selectedTimeframe} + ${compiledStrategy?.strategy_mode || 'HYBRID'} + ${analysis.signal} + ${analysis.regime || 'UNKNOWN'}
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
          console.log(`[Adaptive Learning] REJECTED signal for ${symbol} (${analysis.signal}): ${adaptiveResult.reason}`);
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
          console.log(`[Adaptive Learning] RESTRICT active for ${symbol} (${analysis.signal}): ${adaptiveResult.reason}`);
          if (analysis.confidence < 85) {
            console.log(`[Adaptive Learning] Rejecting ${symbol} under RESTRICT decision because confidence (${analysis.confidence}%) is below strict 85% threshold.`);
            analysis.signal = 'NO_TRADE';
          }
        } else if (analysis.confidence < adaptiveReq.minRequired) {
          console.log(`[Adaptive Quality] REJECTED signal for ${symbol}: Quality score (${analysis.confidence}%) < adaptive requirement (${adaptiveReq.minRequired}%)`);
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
              pair: symbol,
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
              console.log(`[Adaptive Execution] WAIT state triggered for ${symbol}: ${executionResult.explanation}`);
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
              console.log(`[Adaptive Execution] NO_TRADE triggered for ${symbol}: ${executionResult.explanation}`);
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
            console.error('[Adaptive Execution Error] Failed to evaluate adaptive execution timing in manual scan:', execErr);
          }
        }
      } catch (adaptErr) {
        console.error('[Adaptive Quality Error] Failed to evaluate adaptive quality requirement in manual scan:', adaptErr);
      }
    }

    // Closed-Loop Strategy Calibration (Stage 3G)
    if (analysis.signal === 'BUY' || analysis.signal === 'SELL') {
      try {
        const completedTrades = await fetchCompletedTradesForAdaptiveLearning(supabase, userId);
        calibrationResult = evaluateClosedLoopCalibration({
          userId,
          pair: symbol,
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
          console.log(`[Closed-Loop Calibration] REJECTED signal for ${symbol} (${analysis.signal}): ${calibrationResult.explanation}`);
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
            console.log(`[Closed-Loop Calibration] Rejecting ${symbol} under RESTRICT recommendation because confidence (${analysis.confidence}%) < 80% threshold.`);
            analysis.signal = 'NO_TRADE';
          }
        } else if (calibrationResult.recommendedAction === 'SELECTIVE') {
          if (analysis.confidence < 75) {
            console.log(`[Closed-Loop Calibration] Rejecting ${symbol} under SELECTIVE recommendation because confidence (${analysis.confidence}%) < 75% threshold.`);
            analysis.signal = 'NO_TRADE';
          }
        }
      } catch (calibErr) {
        console.error('[Closed-Loop Calibration Error] Failed to evaluate closed-loop calibration in manual scan:', calibErr);
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
            pair: symbol,
            timeframe: selectedTimeframe,
            strategySetup: compiledStrategy?.strategy_mode || 'DEFAULT',
            qualityScore: analysis.confidence,
            confidence: analysis.confidence
          }
        });

        if (governorResult.status === 'NO_TRADE') {
          console.log(`[Risk Governor] REJECTED signal for ${symbol}: Governor status is NO_TRADE. Reason: ${governorResult.reasonCodes.join(', ')}`);
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
          console.log(`[Risk Governor] RESTRICTED_SELECTIVITY active for ${symbol}. Reason: ${governorResult.reasonCodes.join(', ')}`);
          if (analysis.confidence < 80) {
            console.log(`[Risk Governor] Rejecting ${symbol} under RESTRICTED_SELECTIVITY because confidence (${analysis.confidence}%) is below strict 80% threshold.`);
            analysis.signal = 'NO_TRADE';
          }
        }
      } catch (govErr) {
        console.error('[Risk Governor Error] Failed to evaluate equity learning governor in manual scan:', govErr);
      }
    }

    let riskResult = { accepted: false, skipReason: "No trade setup" };
    let posSizeResult: any = null;

    if (analysis.signal !== 'NO_TRADE' && analysis.confidence >= 70) {
      const executedPrice = Number(candleData[candleData.length - 1]?.close) || Number(analysis.entryPrice) || 0;
      posSizeResult = calculatePositionSize({
        accountSize: accountSize,
        riskPercentage: riskPercentage,
        entryPrice: Number(analysis.entryPrice) || 0,
        executedEntry: executedPrice,
        stopLoss: Number(analysis.stopLoss) || 0,
        takeProfit: analysis.takeProfit ? Number(analysis.takeProfit) : null,
        geminiTp: analysis.takeProfit ? Number(analysis.takeProfit) : null,
        symbol: symbol,
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
Risk Amount: ${posSizeResult.riskAmount.toFixed(2)}
Required Lot: ${posSizeResult.exactLotSize}
Minimum Lot: ${posSizeResult.minLot}
Executable Lot: ${posSizeResult.accepted ? posSizeResult.calculatedLotSize : 'NONE'}
Theoretical Expected Loss: ${posSizeResult.expectedLossAtRequiredLot.toFixed(2)}
Minimum Lot Expected Loss: ${posSizeResult.expectedLossAtMinLot.toFixed(2)}
Expected Loss: ${posSizeResult.accepted ? posSizeResult.expectedLoss.toFixed(2) : posSizeResult.expectedLossAtRequiredLot.toFixed(2)}
Accepted: ${posSizeResult.accepted ? 'YES' : 'NO'}
${analysis.stopLossBasis === 'ATR_FALLBACK' ? `ATR: ${marketStructure.volatilityInformation.atr.toFixed(5)}\nATR Multiplier: 1.5` : ''}
`.trim());
      riskResult = {
        accepted: posSizeResult.accepted,
        skipReason: posSizeResult.skipReason
      };

      analysis.entryPrice = posSizeResult.entryPrice;
      analysis.stopLoss = posSizeResult.stopLoss;
      analysis.takeProfit = posSizeResult.takeProfit;
      analysis.riskReward = parseRiskRewardRatio(riskRewardStr);
      (analysis as any).riskRewardStr = riskRewardStr;
      (analysis as any).accepted = posSizeResult.accepted;
      (analysis as any).skipReason = posSizeResult.skipReason;
      (analysis as any).lotSize = posSizeResult.calculatedLotSize;
      (analysis as any).riskAmount = posSizeResult.riskAmount;
      (analysis as any).expectedLoss = posSizeResult.expectedLoss;
      (analysis as any).expectedProfit = posSizeResult.expectedProfit;
      (analysis as any).lotType = posSizeResult.lotType;

      if (!posSizeResult.accepted) {
        console.log(`[Risk Validation Failed - Trade Skipped] ${posSizeResult.skipReason}`);
        analysis.signal = 'NO_TRADE';
      }
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
        status: analysis.signal !== 'NO_TRADE' && posSizeResult?.accepted ? 'PASS' : 'NOT_EVALUATED',
        reasonCode: analysis.signal !== 'NO_TRADE' && posSizeResult?.accepted ? 'TELEGRAM_AUTHORIZED' : 'TELEGRAM_GATE_REJECTED',
        reason: 'Telegram notification gate verification',
        timestamp: new Date().toISOString()
      }
    ];

    const attribution = resolveAuthoritativeDecision({
      userId,
      watcherId: watcher.id,
      pair: symbol,
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

    const decisionSnapshot = {
      attribution
    };

    if (attribution.finalDecision !== 'EXECUTE') {
      analysis.signal = 'NO_TRADE';
    }

    // 10. Telegram Send Decision (No actual telegram sending in manual scan)
    const shouldSend = analysis.signal !== 'NO_TRADE' && analysis.confidence >= 70;

    const scanDurationMs = Date.now() - scanStart;

    // 11. Store evaluation record in the Explainability Engine
    try {
      await recordEvaluation(supabase, {
        user_id: userId,
        watcher_id: watcher.id,
        pair: symbol,
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
        trade_sent: false, // Manual scan doesn't send real alerts
        trade_reason: "Manual scan completed: " + (analysis.signal !== 'NO_TRADE' ? `Setup found (${analysis.signal})` : (riskResult.skipReason || "No setup found")),
        scan_duration_ms: scanDurationMs,
        gemini_duration_ms: geminiDuration,
        decision_snapshot: decisionSnapshot
      });
    } catch (evalErr) {
      console.warn(`[Explainability Engine Warning] Failed to log scan evaluation:`, evalErr);
    }

    return res.json({ success: true, analysis });

  } catch (err: any) {
    console.error("Manual scan failed");
    console.error(`Exception: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
}

