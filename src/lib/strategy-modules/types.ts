import { Candle } from '../strategy-engine.js';
import { CompiledRules, CompilerOutput } from '../strategy-compiler/types.js';

export type ConceptModuleCategory =
  | 'STRUCTURE'
  | 'ZONE'
  | 'INDICATOR'
  | 'PRICE_ACTION'
  | 'FILTER'
  | 'RISK';

export type ConceptModuleId =
  | 'order_block'
  | 'supply_demand'
  | 'unmitigated_zone'
  | 'demand_zone'
  | 'supply_zone'
  | 'liquidity_sweep'
  | 'fair_value_gap'
  | 'bos'
  | 'choch'
  | 'support'
  | 'resistance'
  | 'support_rejection'
  | 'resistance_rejection'
  | 'trendline_breakout'
  | 'break_and_retest'
  | 'confirmation_candle'
  | 'ema'
  | 'rsi'
  | 'macd'
  | 'atr'
  | 'volume_confirmation'
  | 'session'
  | 'timeframes'
  | 'risk_reward'
  | 'tap_and_rejection';

export interface StrategyBlueprintModuleSpec {
  id: ConceptModuleId;
  name: string;
  category: ConceptModuleCategory;
  mandatory: boolean;
  weight: number;
  params: Record<string, any>;
  matchedPhrase?: string;
}

export interface StrategyBlueprint {
  version: string;
  activatedModuleIds: ConceptModuleId[];
  mandatoryModuleIds: ConceptModuleId[];
  optionalModuleIds: ConceptModuleId[];
  modules: StrategyBlueprintModuleSpec[];
  preferredHtf: 'H4' | 'D1';
  strategyMode: 'RULE_ONLY' | 'HYBRID' | 'AI_ONLY';
  executionMode: 'RULE_ONLY' | 'HYBRID' | 'AI_ONLY';
}

export interface DetectedOrderBlock {
  type: 'BULLISH_ORDER_BLOCK' | 'BEARISH_ORDER_BLOCK';
  direction: 'BUY' | 'SELL';
  high: number;
  low: number;
  invalidationLevel: number;
  candleIndex: number;
  displacementIndex: number;
  displacement: number;
  displacementAtrRatio: number;
  hasStructuralBreak: boolean;
  isOriginSwing: boolean;
  tapCount: number;
  isMitigated: boolean;
  isInvalidated: boolean;
  isTappedNow: boolean;
  strength: number;
  timestamp: string | number;
  evidence: string[];
}

export interface DetectedLiquidityPool {
  side: 'BUY_SIDE' | 'SELL_SIDE';
  price: number;
  candleIndex: number;
  timestamp: string | number;
  isEqualLevel: boolean;
  touchCount: number;
}

export interface DetectedLiquiditySweep {
  type: 'HIGH_SWEEP' | 'LOW_SWEEP';
  direction: 'BULLISH' | 'BEARISH';
  price: number;
  candleIndex: number;
  levelPrice: number;
  sweepDepth: number;
  sweepDepthAtr: number;
  rejectionWickRatio: number;
  rejectionEvidence: string;
}

export interface DetectedTrendline {
  side: 'ASCENDING_SUPPORT' | 'DESCENDING_RESISTANCE';
  startIndex: number;
  endIndex: number;
  startPrice: number;
  endPrice: number;
  slope: number;
  projectedLatestPrice: number;
}

export interface DetectedTrendlineBreakout {
  type: 'UPPER_BREAKOUT' | 'LOWER_BREAKOUT';
  direction: 'BULLISH' | 'BEARISH';
  candleIndex: number;
  breakPrice: number;
  trendlinePrice: number;
  evidence: string;
}

export interface DetectedRetest {
  type: 'BULLISH_RETEST' | 'BEARISH_RETEST';
  candleIndex: number;
  levelPrice: number;
  confirmed: boolean;
  evidence: string;
}

export interface ConceptExecutionContext {
  sortedCandles: Candle[];
  latestCandle: Candle;
  currentPrice: number;
  atr: number;
  swingHighs: any[];
  swingLows: any[];
  pair?: string;
  timeframe?: string;
  compiledRules: CompiledRules;
  compiledStrategy?: CompilerOutput;
  moduleSpec: StrategyBlueprintModuleSpec;
  marketStructure: Record<string, any>;
  now?: Date;
}

export interface ConceptModuleResult {
  moduleId: ConceptModuleId;
  moduleName: string;
  category: ConceptModuleCategory;
  activated: boolean;
  executed: boolean;
  matched: boolean;
  scoreOutOf10: number;
  direction?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  reason: string;
  evidence: string[];
  metrics: Record<string, any>;
  structurePatch?: Record<string, any>;
}

export interface ConceptLogicModule {
  id: ConceptModuleId;
  name: string;
  category: ConceptModuleCategory;
  aliases: string[];
  requiresSwings?: boolean;
  requiresAtr?: boolean;
  dependsOn?: ConceptModuleId[];
  execute: (ctx: ConceptExecutionContext) => ConceptModuleResult;
}

export interface BlueprintExecutionReport {
  blueprint: StrategyBlueprint;
  activatedModules: ConceptModuleId[];
  executedModules: ConceptModuleId[];
  skippedModules: ConceptModuleId[];
  passedModules: ConceptModuleId[];
  failedModules: ConceptModuleId[];
  resultsByModule: Record<string, ConceptModuleResult>;
  marketStructure: any;
  score: number;
  mandatoryPassed: boolean;
  passed: boolean;
}
