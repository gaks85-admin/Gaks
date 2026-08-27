import { createClient } from '@supabase/supabase-js';
import { defaultMarketDataService, getRequiredCandleCountForTimeframe } from './market-data-service.js';
import { Candle, analyzeMarket } from './strategy-engine.js';
import { compileStrategy } from './strategy-compiler.js';
import { evaluateDecision } from './decision-engine.js';
import { extractMarketStructure } from './market-structure-engine.js';
import { extractRiskPreferences, calculatePositionSize } from './risk-engine.js';
import { resolveUserGeminiKey } from './gemini-key-resolver.js';
import { executeBoundedGeminiCall } from './geminiWrapper.js';
import { evaluateQualityGate } from './quality-gate.js';
import { resolveAuthoritativeDecision, DecisionGateResult, DecisionGateType, GateStatus } from './decision-attribution.js';
import { checkSignalDeduplication } from './signal-deduplication.js';
import { GoogleGenAI, Type } from '@google/genai';

export interface ReplayOptions {
  watcherId: string;
  pair?: string;
  timeframe?: string;
  historicalTimestamp?: string | number;
  skipGemini?: boolean;
  userApiKeyOverride?: string;
}

export interface MarketDataSnapshot {
  provider: string;
  symbol: string;
  canonicalSymbol: string;
  timeframe: string;
  candle_count: number;
  oldest_candle_timestamp: string;
  newest_candle_timestamp: string;
  newest_completed_candle_timestamp: string;
  candle_timestamp: string;
  current_server_timestamp: string;
  data_age: string;
  data_age_ms: number;
  max_allowed_age_ms: number;
  freshness_status: 'FRESH' | 'STALE' | 'HISTORICAL_REPLAY';
  timezone_normalization: string;
}

export interface TraceGate {
  gate: string;
  status: GateStatus;
  reason_code: string;
  reason: string;
  details?: any;
}

export interface DiagnosticReport {
  watcher_id: string;
  pair: string;
  timeframe: string;
  historical_timestamp: string | null;
  execution_timestamp: string;
  market_data_snapshot: MarketDataSnapshot;
  strategy_snapshot: {
    strategy_text_summary: string;
    strategy_mode: string;
    account_size: number;
    risk_percentage: number;
    risk_reward_ratio: number;
    strategy_hash: string;
  };
  rule_engine_evaluation: {
    matched_rules: string[];
    failed_rules: string[];
    matched_weight: number;
    possible_weight: number;
    decision_score: number;
    recommendation: string;
    explanation: string;
  };
  market_structure_snapshot: {
    trend: string;
    regime: string;
    fvg_present: boolean;
    swing_high: number;
    swing_low: number;
    atr: number;
    volume_trend: string;
  };
  gemini_prompt_snapshot: {
    system_instructions: string;
    strategy_instructions: string;
    market_summary: string;
    requested_output_schema: object;
  };
  raw_ai_decision: {
    ai_called: boolean;
    duration_ms: number;
    classification: 'SETUP_FOUND' | 'NO_SETUP' | 'INVALID_RESPONSE' | 'GEMINI_ERROR' | 'GEMINI_TIMEOUT' | 'GEMINI_QUOTA_EXHAUSTED' | 'SKIPPED_STALE_DATA' | 'SKIPPED_DRY_RUN';
    raw_response_text: string | null;
    clean_error_message: string | null;
    parsed_setup: {
      direction: 'BUY' | 'SELL' | 'NO_TRADE';
      entry_price: number | null;
      stop_loss: number | null;
      take_profit: number | null;
      confidence: number;
      setup_type: string | null;
      stop_loss_basis: string | null;
      reasoning: string | null;
    } | null;
  };
  post_gemini_validation_trace: {
    gates: TraceGate[];
    all_gates_passed: boolean;
    rejected_gate: string | null;
    rejection_reason: string | null;
  };
  duplicate_detection_audit: {
    is_duplicate: boolean;
    status: 'DUPLICATE_REJECTED' | 'PASSED' | 'NO_PREVIOUS_SIGNAL';
    previous_signal: {
      direction: string;
      entry_price: number;
      stop_loss: number;
      take_profit: number;
      alerted_at: string;
    } | null;
    comparison_details: {
      entry_price_diff_percent: number;
      entry_match_threshold_percent: number;
      sl_diff_percent: number;
      tp_diff_percent: number;
      cooldown_minutes: number;
      reason: string;
    };
  };
  final_watcher_result: {
    watcher_status: 'SIGNAL_SENT' | 'SIGNAL_NOT_SENT';
    final_decision: 'EXECUTE' | 'WAIT' | 'NO_TRADE' | 'REJECTED' | 'FAILED';
    summary_reason: string;
    trade_details: {
      symbol: string;
      direction: string;
      entry_price: number;
      stop_loss: number;
      take_profit: number;
      lot_size: number;
      risk_amount: number;
      actual_rr: number;
    } | null;
  };
  diagnostic_summary_text: string;
}

const getSupabase = () => {
  const url = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Supabase configuration missing');
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
};

export function getMaxAllowedAgeMs(timeframe: string): number {
  const tf = timeframe.toUpperCase().trim();
  switch (tf) {
    case 'M1': return 3 * 60 * 1000;         // 3m
    case 'M5': return 15 * 60 * 1000;        // 15m
    case 'M15': return 45 * 60 * 1000;       // 45m
    case 'M30': return 90 * 60 * 1000;       // 90m
    case 'H1': return 3 * 60 * 60 * 1000;    // 3h
    case 'H4': return 12 * 60 * 60 * 1000;   // 12h
    case 'D1': return 48 * 60 * 60 * 1000;   // 48h
    default: return 60 * 60 * 1000;          // 60m
  }
}

export function formatAgeString(ms: number): string {
  if (ms < 0) ms = 0;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  if (minutes < 60) return `${minutes}m${remSec}s`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return `${hours}h${remMin}m`;
}

function computeHash(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const DEFAULT_STRATEGY_TEXT = `# Institutional Multi-Timeframe Strategy
## Rules
1. Trend alignment on higher timeframe (H1/M15).
2. Key support/resistance or liquidity sweep.
3. Candlestick reversal trigger (Pinbar/Engulfing).
4. Mandatory 1:2 R:R minimum ratio.`;

function extractStrategyText(userStrategyRaw?: string | null, strategyId?: string | null): string {
  if (!userStrategyRaw || !userStrategyRaw.trim()) return DEFAULT_STRATEGY_TEXT;
  try {
    const parsed = JSON.parse(userStrategyRaw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.strategies)) {
      const active = parsed.strategies.find((s: any) => s.id === strategyId || s.isDefault) || parsed.strategies[0];
      return active ? (active.text || DEFAULT_STRATEGY_TEXT) : DEFAULT_STRATEGY_TEXT;
    }
  } catch (e) {
    // raw text
  }
  return userStrategyRaw;
}

/**
 * Runs a full diagnostic scan and replay for a market watcher without side effects.
 */
export async function runWatcherDiagnosticReplay(options: ReplayOptions): Promise<DiagnosticReport> {
  const supabase = getSupabase();
  const executionStartTime = new Date().toISOString();

  // 1. Fetch Watcher and User Profile
  const { data: watcher, error: watcherErr } = await supabase
    .from('watchers')
    .select('*')
    .eq('id', options.watcherId)
    .maybeSingle();

  if (watcherErr || !watcher) {
    throw new Error(`Watcher not found for ID '${options.watcherId}': ${watcherErr?.message || 'Invalid ID'}`);
  }

  const userId = watcher.user_id;
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  const selectedPair = (options.pair || watcher.selected_pair || 'BTCUSD').trim().toUpperCase();
  const selectedTimeframe = (options.timeframe || watcher.selected_timeframe || 'M5').trim().toUpperCase();

  // 2. Fetch Market Data via Twelve Data
  const requiredCount = getRequiredCandleCountForTimeframe(selectedTimeframe);
  const mdResult = await defaultMarketDataService.getMarketData({
    symbol: selectedPair,
    timeframe: selectedTimeframe,
    requiredCount,
    watcherId: watcher.id,
    userId,
    purpose: 'DIAGNOSTIC_REPLAY'
  });

  let rawCandles: Candle[] = mdResult.candles || [];

  // 3. Historical Replay Filtering (No Look-Ahead Bias)
  const isHistorical = !!options.historicalTimestamp;
  let historicalCutoffMs: number | null = null;
  if (isHistorical) {
    historicalCutoffMs = typeof options.historicalTimestamp === 'number'
      ? options.historicalTimestamp
      : new Date(options.historicalTimestamp!).getTime();
    
    if (!isNaN(historicalCutoffMs!)) {
      rawCandles = rawCandles.filter(c => {
        const cMs = new Date(c.timestamp).getTime();
        return !isNaN(cMs) && cMs <= historicalCutoffMs!;
      });
    }
  }

  // Ensure candles are sorted ascending by timestamp
  rawCandles.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const currentServerMs = Date.now();
  const newestCandle = rawCandles[rawCandles.length - 1];
  const oldestCandle = rawCandles[0];
  const newestCompletedCandle = rawCandles.length > 1 ? rawCandles[rawCandles.length - 2] : newestCandle;

  const newestCandleMs = newestCandle ? new Date(newestCandle.timestamp).getTime() : currentServerMs;
  const dataAgeMs = currentServerMs - newestCandleMs;
  const maxAllowedAgeMs = getMaxAllowedAgeMs(selectedTimeframe);

  let freshnessStatus: 'FRESH' | 'STALE' | 'HISTORICAL_REPLAY' = 'FRESH';
  if (isHistorical) {
    freshnessStatus = 'HISTORICAL_REPLAY';
  } else if (dataAgeMs > maxAllowedAgeMs) {
    freshnessStatus = 'STALE';
  }

  const marketDataSnapshot: MarketDataSnapshot = {
    provider: 'Twelve Data',
    symbol: selectedPair,
    canonicalSymbol: selectedPair.replace(/[^A-Z0-9]/g, ''),
    timeframe: selectedTimeframe,
    candle_count: rawCandles.length,
    oldest_candle_timestamp: oldestCandle ? new Date(oldestCandle.timestamp).toISOString() : 'NONE',
    newest_candle_timestamp: newestCandle ? new Date(newestCandle.timestamp).toISOString() : 'NONE',
    newest_completed_candle_timestamp: newestCompletedCandle ? new Date(newestCompletedCandle.timestamp).toISOString() : 'NONE',
    candle_timestamp: newestCandle ? new Date(newestCandle.timestamp).toISOString() : 'NONE',
    current_server_timestamp: new Date(currentServerMs).toISOString(),
    data_age: formatAgeString(dataAgeMs),
    data_age_ms: dataAgeMs,
    max_allowed_age_ms: maxAllowedAgeMs,
    freshness_status: freshnessStatus,
    timezone_normalization: 'UTC'
  };

  // 4. Extract Strategy and Risk Rules
  const rawStrategyText = extractStrategyText(profile?.strategy_text || watcher.strategy_text, watcher.strategy_id);
  const compiledStrategy = compileStrategy(rawStrategyText);
  const strategyHash = computeHash(rawStrategyText);

  const riskPrefs = extractRiskPreferences(profile?.risk_preferences || watcher.risk_preferences, watcher.account_balance || 10000);
  const accountBalance = riskPrefs.accountSize || 10000;
  const riskPercent = riskPrefs.riskPercentage || 1.0;
  const targetRr = 2.0;

  const strategySnapshot = {
    strategy_text_summary: rawStrategyText.slice(0, 300) + (rawStrategyText.length > 300 ? '...' : ''),
    strategy_mode: compiledStrategy.strategy_mode,
    account_size: accountBalance,
    risk_percentage: riskPercent,
    risk_reward_ratio: targetRr,
    strategy_hash: strategyHash
  };

  // 5. Market Structure Extraction & Rule Engine Evaluation
  const marketStructure = extractMarketStructure(rawCandles, compiledStrategy.detector_validation?.supported_detectors);
  (marketStructure as any).pair = selectedPair;
  (marketStructure as any).timeframe = selectedTimeframe;

  const decisionResult = evaluateDecision(compiledStrategy, marketStructure);
  const marketAnalysis = analyzeMarket(rawCandles, selectedTimeframe);
  const currentPrice = rawCandles.length > 0 ? rawCandles[rawCandles.length - 1].close : 0;

  const marketStructureSnapshot = {
    trend: marketStructure.trend || 'NEUTRAL',
    regime: 'RANGE',
    fvg_present: (marketStructure.fairValueGaps || []).length > 0,
    swing_high: (marketStructure.swingHighs || []).slice(-1)[0]?.price || currentPrice,
    swing_low: (marketStructure.swingLows || []).slice(-1)[0]?.price || currentPrice,
    atr: marketStructure.volatilityInformation?.atr || 0,
    volume_trend: marketStructure.volumeInformation?.volumeSpike ? 'SPIKE' : 'NORMAL'
  };

  // 6. Reconstruct Automated Gemini Prompt
  const promptSchema = {
    type: Type.OBJECT,
    properties: {
      satisfies: { type: Type.BOOLEAN, description: "Whether market satisfies strategy setup rules" },
      direction: { type: Type.STRING, enum: ["BUY", "SELL", "NO_TRADE"], description: "Trading direction" },
      confidence: { type: Type.NUMBER, description: "Confidence score between 0 and 100" },
      entryPrice: { type: Type.NUMBER, description: "Suggested entry price" },
      stopLoss: { type: Type.NUMBER, description: "Structural stop loss price" },
      takeProfit: { type: Type.NUMBER, description: "Take profit price" },
      setupType: { type: Type.STRING, description: "Identified setup pattern or strategy mode" },
      stopLossBasis: { type: Type.STRING, description: "Reasoning for SL level" },
      reasoning: { type: Type.STRING, description: "Detailed strategy alignment analysis" }
    },
    required: ["satisfies", "direction", "confidence", "reasoning"]
  };

  const systemInstructions = `You are Gaks AI, an institutional quantitative market analyst engine. Your job is to strictly evaluate whether current market price action and technical structure satisfy the user's trading strategy. Fail closed if requirements are not clearly met.`;
  const marketSummaryText = `Symbol: ${selectedPair} | Timeframe: ${selectedTimeframe} | Latest Price: ${currentPrice} | Trend: ${marketStructure.trend} | ATR: ${marketStructure.volatilityInformation?.atr || 0}`;

  const geminiPromptSnapshot = {
    system_instructions: systemInstructions,
    strategy_instructions: rawStrategyText,
    market_summary: marketSummaryText,
    requested_output_schema: promptSchema
  };

  // 7. Raw AI Decision Execution
  let aiCalled = false;
  let durationMs = 0;
  let classification: 'SETUP_FOUND' | 'NO_SETUP' | 'INVALID_RESPONSE' | 'GEMINI_ERROR' | 'GEMINI_TIMEOUT' | 'GEMINI_QUOTA_EXHAUSTED' | 'SKIPPED_STALE_DATA' | 'SKIPPED_DRY_RUN' = 'SKIPPED_DRY_RUN';
  let rawResponseText: string | null = null;
  let cleanErrorMessage: string | null = null;
  let parsedSetup: any = null;

  if (freshnessStatus === 'STALE' && !isHistorical) {
    classification = 'SKIPPED_STALE_DATA';
    cleanErrorMessage = `Market data is stale (${formatAgeString(dataAgeMs)} old > ${formatAgeString(maxAllowedAgeMs)} limit). Gemini call bypassed for safety.`;
  } else if (options.skipGemini) {
    classification = 'SKIPPED_DRY_RUN';
    cleanErrorMessage = 'Gemini execution bypassed due to skipGemini option';
  } else {
    // Resolve Gemini Key
    const resolvedKey = await resolveUserGeminiKey(supabase, userId, watcher.id, { pair: selectedPair, timeframe: selectedTimeframe });
    const apiKeyToUse = options.userApiKeyOverride || resolvedKey.apiKey;

    if (!apiKeyToUse) {
      classification = 'GEMINI_ERROR';
      cleanErrorMessage = 'No valid Gemini API key available for user profile';
    } else {
      aiCalled = true;
      const ai = new GoogleGenAI({ apiKey: apiKeyToUse });
      const startTime = Date.now();

      const promptString = `${systemInstructions}\n\nSTRATEGY:\n${rawStrategyText}\n\nMARKET DATA SUMMARY:\n${marketSummaryText}`;

      const aiResult = await executeBoundedGeminiCall(
        ai,
        {
          model: 'gemini-2.5-flash',
          contents: promptString,
          config: {
            responseMimeType: 'application/json',
            responseSchema: promptSchema
          },
          timeoutMs: 8000,
          apiDeadlineMs: 10000
        },
        {
          userId,
          watcherId: watcher.id,
          pair: selectedPair,
          timeframe: selectedTimeframe
        }
      );

      durationMs = Date.now() - startTime;

      if (!aiResult.success) {
        if (aiResult.errorType === 'QUOTA_EXHAUSTED' || aiResult.diagnosticStatus.startsWith('QUOTA_')) {
          classification = 'GEMINI_QUOTA_EXHAUSTED';
        } else if (aiResult.errorType === 'TIMEOUT') {
          classification = 'GEMINI_TIMEOUT';
        } else {
          classification = 'GEMINI_ERROR';
        }
        cleanErrorMessage = aiResult.cleanErrorMessage || 'Gemini request failed';
      } else {
        rawResponseText = aiResult.text || null;
        try {
          const parsed = JSON.parse(rawResponseText || '{}');
          const satisfies = parsed.satisfies === true;
          const dir = (parsed.direction || '').toUpperCase();
          const validDir = dir === 'BUY' || dir === 'SELL';

          if (satisfies && validDir) {
            classification = 'SETUP_FOUND';
            parsedSetup = {
              direction: dir as 'BUY' | 'SELL',
              entry_price: typeof parsed.entryPrice === 'number' ? parsed.entryPrice : currentPrice,
              stop_loss: typeof parsed.stopLoss === 'number' ? parsed.stopLoss : null,
              take_profit: typeof parsed.takeProfit === 'number' ? parsed.takeProfit : null,
              confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 75,
              setup_type: parsed.setupType || compiledStrategy.strategy_mode,
              stop_loss_basis: parsed.stopLossBasis || 'Structural Swing',
              reasoning: parsed.reasoning || 'AI identified valid setup'
            };
          } else {
            classification = 'NO_SETUP';
            parsedSetup = {
              direction: 'NO_TRADE',
              entry_price: null,
              stop_loss: null,
              take_profit: null,
              confidence: parsed.confidence || 0,
              setup_type: null,
              stop_loss_basis: null,
              reasoning: parsed.reasoning || 'AI evaluated market and found no trade setup'
            };
          }
        } catch (jsonErr: any) {
          classification = 'INVALID_RESPONSE';
          cleanErrorMessage = `Failed to parse Gemini JSON output: ${jsonErr.message}`;
        }
      }
    }
  }

  // Fallback setup if dry run or rule engine recommendation test
  if (!parsedSetup && decisionResult.recommendation !== 'FAIL') {
    const isBuy = decisionResult.recommendation === 'PASS' || decisionResult.recommendation === 'LIKELY_PASS';
    const entry = currentPrice || 100;
    const atr = marketStructure.volatilityInformation?.atr || (entry * 0.01);
    const sl = isBuy ? entry - (1.5 * atr) : entry + (1.5 * atr);
    const tp = isBuy ? entry + (3.0 * atr) : entry - (3.0 * atr);
    parsedSetup = {
      direction: isBuy ? 'BUY' : 'SELL',
      entry_price: entry,
      stop_loss: sl,
      take_profit: tp,
      confidence: Math.round((decisionResult.decision_score || 0.75) * 100),
      setup_type: compiledStrategy.strategy_mode,
      stop_loss_basis: 'ATR Structural Fallback',
      reasoning: 'Rule engine generated candidate setup'
    };
  }

  // 8. Post-Gemini Validation Tracing
  const gatesList: DecisionGateResult[] = [];

  // Gate 1: Market Data
  gatesList.push({
    gate: 'MARKET_DATA',
    status: rawCandles.length > 0 && freshnessStatus !== 'STALE' ? 'PASS' : 'REJECT',
    reasonCode: freshnessStatus === 'STALE' ? 'STALE_MARKET_DATA' : (rawCandles.length > 0 ? 'MARKET_DATA_VALID' : 'MARKET_DATA_EMPTY'),
    reason: freshnessStatus === 'STALE' ? `Market data stale (${marketDataSnapshot.data_age})` : `Received ${rawCandles.length} candles`,
    timestamp: new Date().toISOString()
  });

  // Gate 2: Strategy / Rule Engine
  gatesList.push({
    gate: 'STRATEGY',
    status: decisionResult.recommendation !== 'FAIL' ? 'PASS' : 'REJECT',
    reasonCode: decisionResult.recommendation !== 'FAIL' ? 'STRATEGY_PASSED' : 'STRATEGY_FAILED',
    reason: decisionResult.explanation || `Rule score: ${Math.round(decisionResult.decision_score * 100)}%`,
    timestamp: new Date().toISOString()
  });

  // Gate 3: Gemini AI Setup
  const geminiPassed = classification === 'SETUP_FOUND';
  gatesList.push({
    gate: 'GEMINI',
    status: geminiPassed ? 'PASS' : (classification === 'SKIPPED_DRY_RUN' ? 'NOT_EVALUATED' : 'REJECT'),
    reasonCode: geminiPassed ? 'GEMINI_PASSED' : classification,
    reason: geminiPassed ? 'Gemini AI confirmed setup' : (cleanErrorMessage || `AI status: ${classification}`),
    timestamp: new Date().toISOString()
  });

  // Gate 4: Quality Gate
  const qualityRes = evaluateQualityGate({
    ruleScore: Math.round(decisionResult.decision_score * 100),
    marketStructure: marketStructure,
    mandatoryRulesPassed: decisionResult.mandatory_rules_passed,
    direction: (parsedSetup?.direction || 'NO_TRADE') as 'BUY' | 'SELL' | 'NO_TRADE',
    slValid: true,
    tpValid: true,
    rrValid: true,
    consecutiveLosses: 0
  });

  gatesList.push({
    gate: 'QUALITY',
    status: qualityRes.passed ? 'PASS' : 'REJECT',
    reasonCode: qualityRes.passed ? 'QUALITY_PASSED' : 'QUALITY_REJECTED',
    reason: qualityRes.reason || `Quality score: ${qualityRes.qualityScore}%`,
    timestamp: new Date().toISOString()
  });

  // Gate 5: Position Sizing & Geometry
  let posSizeResult: any = null;
  if (parsedSetup && parsedSetup.direction !== 'NO_TRADE') {
    const isBuy = parsedSetup.direction === 'BUY';
    const entryP = parsedSetup.entry_price || currentPrice;
    const slP = parsedSetup.stop_loss || (isBuy ? entryP * 0.99 : entryP * 1.01);
    const tpP = parsedSetup.take_profit || (isBuy ? entryP * 1.02 : entryP * 0.98);

    posSizeResult = calculatePositionSize({
      accountSize: accountBalance,
      riskPercentage: riskPercent,
      entryPrice: entryP,
      stopLoss: slP,
      takeProfit: tpP,
      symbol: selectedPair
    });
  }

  gatesList.push({
    gate: 'POSITION_SIZING',
    status: posSizeResult && posSizeResult.accepted ? 'PASS' : 'REJECT',
    reasonCode: posSizeResult && posSizeResult.accepted ? 'POSITION_SIZING_PASS' : 'POSITION_SIZING_REJECT',
    reason: posSizeResult?.skipReason || (posSizeResult ? `Lot size: ${posSizeResult.calculatedLotSize}` : 'No setup direction'),
    timestamp: new Date().toISOString()
  });

  gatesList.push({
    gate: 'TRADE_GEOMETRY',
    status: posSizeResult && posSizeResult.accepted ? 'PASS' : 'REJECT',
    reasonCode: posSizeResult && posSizeResult.accepted ? 'GEOMETRY_VALID' : 'GEOMETRY_INVALID',
    reason: posSizeResult?.skipReason || `R:R ratio ${posSizeResult?.actualRr?.toFixed(2) || 'N/A'} >= ${targetRr}`,
    timestamp: new Date().toISOString()
  });

  const attribution = resolveAuthoritativeDecision({
    userId,
    watcherId: watcher.id,
    pair: selectedPair,
    timeframe: selectedTimeframe,
    direction: (parsedSetup?.direction || 'NO_TRADE') as 'BUY' | 'SELL' | 'NO_TRADE',
    setup: compiledStrategy.strategy_mode,
    regime: 'RANGE',
    entryPrice: parsedSetup?.entry_price || currentPrice,
    stopLoss: parsedSetup?.stop_loss || 0,
    takeProfit: parsedSetup?.take_profit || 0,
    expectedRR: posSizeResult?.actualRr || targetRr,
    positionSize: posSizeResult?.calculatedLotSize || 0.1,
    confidence: parsedSetup?.confidence || 75,
    qualityScore: qualityRes.qualityScore,
    tradeId: `TR-${watcher.id}-REPLAY`,
    gates: gatesList
  });

  const traceGates: TraceGate[] = gatesList.map(g => ({
    gate: g.gate,
    status: g.status,
    reason_code: g.reasonCode,
    reason: g.reason
  }));

  const rejectedGate = attribution.rejectedGate || (gatesList.find(g => g.status === 'REJECT')?.gate || null);
  const rejectionReason = attribution.rejectionReason || (gatesList.find(g => g.status === 'REJECT')?.reason || null);

  // 9. Duplicate Detection Audit
  let previousSignalData: any = null;
  if (watcher.last_signal_data) {
    try {
      previousSignalData = JSON.parse(watcher.last_signal_data);
    } catch (e) {
      // ignore
    }
  }

  if (!previousSignalData) {
    // Check signal_fingerprints
    const { data: fpData } = await supabase
      .from('signal_fingerprints')
      .select('*')
      .eq('watcher_id', watcher.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fpData) {
      previousSignalData = {
        symbol: selectedPair,
        direction: fpData.direction || 'BUY',
        timeframe: selectedTimeframe,
        entryPrice: fpData.entry_price || currentPrice,
        stopLoss: fpData.stop_loss || 0,
        takeProfit: fpData.take_profit || 0,
        alertedAt: fpData.created_at
      };
    }
  }

  let dupAudit: any = {
    is_duplicate: false,
    status: 'NO_PREVIOUS_SIGNAL',
    previous_signal: null,
    comparison_details: {
      entry_price_diff_percent: 0,
      entry_match_threshold_percent: 0.1,
      sl_diff_percent: 0,
      tp_diff_percent: 0,
      cooldown_minutes: 30,
      reason: 'No previous signal recorded for watcher within cooldown window'
    }
  };

  if (parsedSetup && parsedSetup.direction !== 'NO_TRADE') {
    const entryP = parsedSetup.entry_price || currentPrice;
    const slP = parsedSetup.stop_loss || (parsedSetup.direction === 'BUY' ? entryP * 0.99 : entryP * 1.01);
    const tpP = parsedSetup.take_profit || (parsedSetup.direction === 'BUY' ? entryP * 1.02 : entryP * 0.98);

    const dupCheckInput = {
      symbol: selectedPair,
      direction: parsedSetup.direction as 'BUY' | 'SELL',
      timeframe: selectedTimeframe,
      entryPrice: entryP,
      stopLoss: slP,
      takeProfit: tpP,
      previousSignal: previousSignalData,
      cooldownMinutes: 30
    };

    const dupRes = checkSignalDeduplication(dupCheckInput);

    if (previousSignalData) {
      const prevEntry = previousSignalData.entryPrice || entryP;
      const diffRatio = Math.abs(entryP - prevEntry) / (prevEntry || 1);
      const diffPercent = +(diffRatio * 100).toFixed(4);

      dupAudit = {
        is_duplicate: dupRes.suppressed,
        status: dupRes.suppressed ? 'DUPLICATE_REJECTED' : 'PASSED',
        previous_signal: {
          direction: previousSignalData.direction,
          entry_price: previousSignalData.entryPrice,
          stop_loss: previousSignalData.stopLoss,
          take_profit: previousSignalData.takeProfit,
          alerted_at: previousSignalData.alertedAt || 'UNKNOWN'
        },
        comparison_details: {
          entry_price_diff_percent: diffPercent,
          entry_match_threshold_percent: 0.1,
          sl_diff_percent: +((Math.abs(slP - (previousSignalData.stopLoss || slP)) / (previousSignalData.stopLoss || 1)) * 100).toFixed(4),
          tp_diff_percent: +((Math.abs(tpP - (previousSignalData.takeProfit || tpP)) / (previousSignalData.takeProfit || 1)) * 100).toFixed(4),
          cooldown_minutes: 30,
          reason: dupRes.reason || `New entry (${entryP}) vs Previous entry (${prevEntry}) diff is ${diffPercent}% (threshold <= 0.10%)`
        }
      };
    }
  }

  // 10. Final Watcher Result Summary
  const isSignalSent = attribution.finalDecision === 'EXECUTE' && !dupAudit.is_duplicate;
  const watcherStatus = isSignalSent ? 'SIGNAL_SENT' : 'SIGNAL_NOT_SENT';

  let summaryReason = attribution.rejectionReason || 'No trade setup identified by AI or rule engine';
  if (dupAudit.is_duplicate) {
    summaryReason = `DUPLICATE_REJECTED: ${dupAudit.comparison_details.reason}`;
  } else if (classification === 'SKIPPED_STALE_DATA') {
    summaryReason = `STALE_MARKET_DATA: ${cleanErrorMessage}`;
  } else if (classification === 'GEMINI_QUOTA_EXHAUSTED') {
    summaryReason = `GEMINI_QUOTA_EXHAUSTED: ${cleanErrorMessage}`;
  } else if (classification === 'GEMINI_TIMEOUT') {
    summaryReason = `GEMINI_TIMEOUT: ${cleanErrorMessage}`;
  }

  const tradeDetails = (isSignalSent && posSizeResult) ? {
    symbol: selectedPair,
    direction: parsedSetup.direction,
    entry_price: parsedSetup.entry_price || currentPrice,
    stop_loss: parsedSetup.stop_loss,
    take_profit: parsedSetup.take_profit,
    lot_size: posSizeResult.calculatedLotSize || 0.1,
    risk_amount: posSizeResult.riskAmount || (accountBalance * (riskPercent / 100)),
    actual_rr: posSizeResult.actualRr || targetRr
  } : null;

  // 11. Human-Readable Formatted Summary Text
  const diagnosticSummaryText = `
================================================================================
GAKS AI MARKET WATCHER DIAGNOSTIC & REPLAY SUMMARY
================================================================================
MARKET SNAPSHOT
Pair:                        ${selectedPair}
Timeframe:                   ${selectedTimeframe}
Execution Timestamp:         ${executionStartTime}
Historical Timestamp Filter: ${options.historicalTimestamp || 'NONE (Live Market Scan)'}
Candles Evaluated:           ${rawCandles.length} (Oldest: ${marketDataSnapshot.oldest_candle_timestamp} | Newest: ${marketDataSnapshot.newest_candle_timestamp})
Data Age:                    ${marketDataSnapshot.data_age} (Max Allowed: ${formatAgeString(maxAllowedAgeMs)})
Freshness Status:            ${freshnessStatus}

STRATEGY & RISK CONFIGURATION
Strategy Mode:               ${compiledStrategy.strategy_mode}
Strategy Hash:               ${strategyHash}
Account Capital:             $${accountBalance.toLocaleString()}
Risk Per Trade:              ${riskPercent}%
Target R:R Ratio:            1:${targetRr}

RULE ENGINE EVALUATION
Score:                       ${Math.round(decisionResult.decision_score * 100)}%
Recommendation:              ${decisionResult.recommendation}
Matched Rules:               ${decisionResult.matched_rules.length ? decisionResult.matched_rules.join(', ') : 'None'}
Failed Rules:                ${decisionResult.failed_rules.length ? decisionResult.failed_rules.join(', ') : 'None'}

AUTOMATED AI ANALYSIS (GEMINI 2.5 FLASH)
Classification:              ${classification}
AI Called:                   ${aiCalled ? 'YES' : 'NO'} (${durationMs}ms)
${classification === 'SETUP_FOUND' ? `
Direction:                   ${parsedSetup.direction}
Entry Price:                 ${parsedSetup.entry_price}
Stop Loss:                   ${parsedSetup.stop_loss} (${parsedSetup.stop_loss_basis})
Take Profit:                 ${parsedSetup.take_profit}
Confidence Score:            ${parsedSetup.confidence}%
Setup Reasoning:             ${parsedSetup.reasoning}` : `
Clean Error/Reason:          ${cleanErrorMessage || 'No setup returned by AI'}`}

VALIDATION & DUPLICATE TRACE
Overall Status:              ${attribution.finalDecision === 'EXECUTE' ? 'PASSED' : 'REJECTED'}
Rejected Gate:               ${rejectedGate || 'NONE'}
Rejection Reason:            ${rejectionReason || 'N/A'}
Duplicate Protection:        ${dupAudit.status} (${dupAudit.comparison_details.reason})

FINAL WATCHER OUTCOME
Status:                      ${watcherStatus}
Final Decision:              ${attribution.finalDecision}
Summary:                     ${summaryReason}
================================================================================
`.trim();

  return {
    watcher_id: watcher.id,
    pair: selectedPair,
    timeframe: selectedTimeframe,
    historical_timestamp: options.historicalTimestamp ? new Date(options.historicalTimestamp).toISOString() : null,
    execution_timestamp: executionStartTime,
    market_data_snapshot: marketDataSnapshot,
    strategy_snapshot: strategySnapshot,
    rule_engine_evaluation: {
      matched_rules: decisionResult.matched_rules,
      failed_rules: decisionResult.failed_rules,
      matched_weight: decisionResult.matched_weight,
      possible_weight: decisionResult.possible_weight,
      decision_score: decisionResult.decision_score,
      recommendation: decisionResult.recommendation,
      explanation: decisionResult.explanation
    },
    market_structure_snapshot: marketStructureSnapshot,
    gemini_prompt_snapshot: geminiPromptSnapshot,
    raw_ai_decision: {
      ai_called: aiCalled,
      duration_ms: durationMs,
      classification,
      raw_response_text: rawResponseText,
      clean_error_message: cleanErrorMessage,
      parsed_setup: parsedSetup
    },
    post_gemini_validation_trace: {
      gates: traceGates,
      all_gates_passed: attribution.finalDecision === 'EXECUTE',
      rejected_gate: rejectedGate,
      rejection_reason: rejectionReason
    },
    duplicate_detection_audit: dupAudit,
    final_watcher_result: {
      watcher_status: watcherStatus,
      final_decision: attribution.finalDecision,
      summary_reason: summaryReason,
      trade_details: tradeDetails
    },
    diagnostic_summary_text: diagnosticSummaryText
  };
}
