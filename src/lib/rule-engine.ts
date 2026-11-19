import { Candle } from './strategy-engine.js';
import { compileStrategy } from './strategy-compiler.js';
import { CompilerOutput } from './strategy-compiler/types.js';
import {
  BlueprintExecutionReport,
  ConceptModuleId,
  ConceptModuleResult,
  StrategyBlueprint,
  buildStrategyBlueprint,
  computeAtr,
  executeStrategyBlueprint
} from './strategy-modules/index.js';

export interface RuleEngineResult {
  trend: 'Bullish' | 'Bearish' | 'Neutral';
  atr: number;
  session: string;
  breakout: boolean;
  volumeConfirmed: boolean;
  supportProximity: boolean;
  resistanceProximity: boolean;
  score: number;
  passed: boolean;
  geminiCalled: boolean;
  blueprint?: StrategyBlueprint;
  activatedModules?: ConceptModuleId[];
  skippedModules?: ConceptModuleId[];
  passedModules?: ConceptModuleId[];
  failedModules?: ConceptModuleId[];
  moduleResults?: Record<string, ConceptModuleResult>;
  details: {
    watcherActive: boolean;
    tradeStatusOk: boolean;
    cooldownPassed: boolean;
    marketSessionActive: boolean;
    atrFilterPassed: boolean;
    emaTrendPassed: boolean;
    srProximityPassed: boolean;
    trendlineBreakoutPassed: boolean;
    volumeConfirmationPassed: boolean;
    userTimeframeValid: boolean;
    mandatoryRulesPassed?: boolean;
  };
}

export interface EvaluateRulesOptions {
  strategyText?: string;
  compiledStrategy?: CompilerOutput;
  blueprint?: StrategyBlueprint;
  now?: Date;
}

/**
 * Modular Blueprint Rule Engine:
 * Parses the watcher's user strategy input into a StrategyBlueprint and dynamically
 * activates & executes ONLY the relevant mathematical concept modules for that setup.
 */
export function evaluateRules(
  watcher: any,
  candles: Candle[],
  options: EvaluateRulesOptions = {}
): RuleEngineResult {
  const safeCandles = Array.isArray(candles) ? candles : [];
  const strategyText =
    options.strategyText ||
    watcher?.strategy_text ||
    watcher?.strategy ||
    watcher?.compiled_strategy_text ||
    '';

  let compiled: CompilerOutput | null = options.compiledStrategy || null;
  if (!compiled && typeof strategyText === 'string' && strategyText.trim().length > 0) {
    compiled = compileStrategy(strategyText);
  }

  const blueprint: StrategyBlueprint | undefined =
    options.blueprint ||
    compiled?.blueprint ||
    (compiled ? buildStrategyBlueprint(compiled) : undefined);

  // 1. Real Pre-Flight Watcher Checks (no hardcoded true bypasses)
  const watcherActive = Boolean(watcher && watcher.status === 'active');
  const tradeStatusOk = watcher?.has_open_trade !== true && watcher?.trade_status !== 'OPEN';
  const nowMs = (options.now || new Date()).getTime();
  const lastScan = watcher?.last_scan_at ? new Date(watcher.last_scan_at).getTime() : 0;
  const cooldownMs = 60 * 1000;
  const cooldownPassed = !watcher?.last_scan_at || nowMs - lastScan >= cooldownMs;
  const userTimeframeValid = Boolean(watcher?.selected_timeframe);

  // 2. Dynamically execute ONLY the mathematical modules requested by the user's strategy blueprint
  const report: BlueprintExecutionReport | null =
    blueprint && blueprint.activatedModuleIds.length > 0 && safeCandles.length >= 2
      ? executeStrategyBlueprint(compiled || blueprint, safeCandles, {
          pair: watcher?.selected_pair,
          timeframe: watcher?.selected_timeframe,
          now: options.now
        })
      : null;

  const ms = report?.marketStructure || {};
  const results = report?.resultsByModule || {};

  // Baseline ATR telemetry even if ATR filter wasn't explicitly added as a strategy rule
  const atr = Number((ms.volatilityInformation?.atr ?? computeAtr(safeCandles, 14)) || 0);

  // Determine directional trend from executed blueprint modules or price/swing structure
  const rawTrend = String(ms.trend || 'SIDEWAYS').toUpperCase();
  const trend: 'Bullish' | 'Bearish' | 'Neutral' =
    rawTrend === 'BULLISH' ? 'Bullish' : rawTrend === 'BEARISH' ? 'Bearish' : 'Neutral';

  // Read module outcomes truthfully (unactivated checks are not fabricated!)
  const isActivated = (id: ConceptModuleId) => Boolean(report?.executedModules.includes(id));

  const sessionRes = results['session'];
  const marketSessionActive = isActivated('session') ? Boolean(sessionRes?.matched) : true;
  const session = sessionRes?.metrics?.activeSessions?.join('/') || ms.session || 'Any UTC Session';

  const atrRes = results['atr'];
  const atrFilterPassed = isActivated('atr') ? Boolean(atrRes?.matched) : atr > 0;

  const emaRes = results['ema'];
  const emaTrendPassed = isActivated('ema') ? Boolean(emaRes?.matched) : true;

  const supportRes = results['support'] || results['support_rejection'];
  const resistanceRes = results['resistance'] || results['resistance_rejection'];
  const srActive =
    isActivated('support') ||
    isActivated('resistance') ||
    isActivated('support_rejection') ||
    isActivated('resistance_rejection');
  const supportProximity = Boolean(supportRes?.matched);
  const resistanceProximity = Boolean(resistanceRes?.matched);
  const srProximityPassed = srActive ? (supportProximity || resistanceProximity) : true;

  const breakoutRes = results['trendline_breakout'];
  const breakout = Boolean(breakoutRes?.matched);
  const trendlineBreakoutPassed = isActivated('trendline_breakout') ? breakout : true;

  const volumeRes = results['volume_confirmation'];
  const volumeConfirmed = Boolean(volumeRes?.matched);
  const volumeConfirmationPassed = isActivated('volume_confirmation') ? volumeConfirmed : true;

  const mandatoryRulesPassed = report ? report.mandatoryPassed : true;

  const details = {
    watcherActive,
    tradeStatusOk,
    cooldownPassed,
    marketSessionActive,
    atrFilterPassed,
    emaTrendPassed,
    srProximityPassed,
    trendlineBreakoutPassed,
    volumeConfirmationPassed,
    userTimeframeValid,
    mandatoryRulesPassed
  };

  // Compute genuine score from activated strategy modules + preflight gates
  const preflightPassed = watcherActive && tradeStatusOk && cooldownPassed && userTimeframeValid;
  const score = report
    ? report.score
    : Math.round(
        ([watcherActive, tradeStatusOk, cooldownPassed, atrFilterPassed, userTimeframeValid].filter(Boolean).length /
          5) *
          100
      );

  const passed = report
    ? Boolean(preflightPassed && report.passed)
    : Boolean(preflightPassed && atrFilterPassed);

  return {
    trend,
    atr,
    session,
    breakout,
    volumeConfirmed,
    supportProximity,
    resistanceProximity,
    score,
    passed,
    geminiCalled: false,
    blueprint,
    activatedModules: report?.activatedModules || [],
    skippedModules: report?.skippedModules || [],
    passedModules: report?.passedModules || [],
    failedModules: report?.failedModules || [],
    moduleResults: results,
    details
  };
}

export function logRuleEngineAudit(result: RuleEngineResult): void {
  console.log(`\n========== MODULAR RULE ENGINE ==========`);
  console.log(`Trend: ${result.trend}`);
  console.log(`ATR: ${result.atr.toFixed(5)}`);
  console.log(`Session: ${result.session}`);
  if (result.activatedModules && result.activatedModules.length > 0) {
    console.log(`Activated Modules (${result.activatedModules.length}): [${result.activatedModules.join(', ')}]`);
    console.log(`Passed Modules: [${(result.passedModules || []).join(', ')}]`);
    console.log(`Failed Modules: [${(result.failedModules || []).join(', ')}]`);
  }
  console.log(`Score: ${result.score}/100`);
  console.log(`Passed: ${result.passed ? 'YES' : 'NO'}`);
  console.log(`Gemini Called: ${result.geminiCalled ? 'YES' : 'NO'}`);
  console.log(`=========================================\n`);
}
