import { Candle } from './strategy-engine.js';
import { CompilerOutput } from './strategy-compiler/types.js';
import {
  ALL_CONCEPT_MODULES,
  ConceptModuleId,
  ConceptModuleResult,
  StrategyBlueprint,
  buildStrategyBlueprint,
  executeStrategyBlueprint,
  resolveConceptModuleId
} from './strategy-modules/index.js';

export interface SwingLevel {
  index: number;
  price: number;
  timestamp: string | number;
  isBroken: boolean;
  brokenByIndex?: number;
}

export interface FVG {
  type: 'BULLISH_FVG' | 'BEARISH_FVG';
  top: number;
  bottom: number;
  candleIndex: number;
  isFilled: boolean;
  filledPercentage: number; // 0 to 1
}

export interface MarketStructure {
  watcherId?: string;
  pair?: string;
  timeframe?: string;
  trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  htfTrend?: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  htfTimeframe?: string;
  htfReason?: string;
  htfAllowedDirection?: 'BUY' | 'SELL' | 'BOTH' | 'NONE';
  htfBiasAligned?: boolean;
  htfCandles?: Candle[];
  htfMarketStructure?: MarketStructure;
  swingHighs: SwingLevel[];
  swingLows: SwingLevel[];
  supportZones: { priceMin: number; priceMax: number; strength: number }[];
  resistanceZones: { priceMin: number; priceMax: number; strength: number }[];
  fairValueGaps: FVG[];
  orderBlocks?: any[];
  trendlines?: any[];
  breakouts?: any[];
  retests?: any[];
  BOS: {
    type: 'BULLISH_BOS' | 'BEARISH_BOS' | 'NONE';
    price: number;
    candleIndex: number;
    evidence: string;
    levelIndex: number;
  }[];
  CHOCH: {
    type: 'BULLISH_CHOCH' | 'BEARISH_CHOCH' | 'NONE';
    price: number;
    candleIndex: number;
    evidence: string;
  }[];
  liquiditySweeps: {
    type: 'HIGH_SWEEP' | 'LOW_SWEEP' | 'NONE';
    price: number;
    candleIndex: number;
    levelPrice: number;
    rejectionEvidence: string;
  }[];
  candlePatterns: { pattern: string; candleIndex: number; direction: 'BULLISH' | 'BEARISH' }[];
  volumeInformation: { averageVolume: number; latestVolume: number; volumeSpike: boolean };
  volatilityInformation: { atr: number; volatilityLevel: 'HIGH' | 'NORMAL' | 'LOW' };
  latestCandles: Candle[];
  activatedModules?: ConceptModuleId[];
  moduleResults?: Record<string, ConceptModuleResult>;
  [key: string]: any;
}

function emptyMarketStructure(): MarketStructure {
  return {
    trend: 'SIDEWAYS',
    swingHighs: [],
    swingLows: [],
    supportZones: [],
    resistanceZones: [],
    fairValueGaps: [],
    orderBlocks: [],
    BOS: [],
    CHOCH: [],
    liquiditySweeps: [],
    candlePatterns: [],
    volumeInformation: { averageVolume: 0, latestVolume: 0, volumeSpike: false },
    volatilityInformation: { atr: 0, volatilityLevel: 'NORMAL' },
    latestCandles: [],
    activatedModules: []
  };
}

/**
 * Pure modular market structure extraction engine.
 * - When `blueprintOrDetectors` is supplied (StrategyBlueprint, CompilerOutput, or string[] detector list),
 *   dynamically activates and runs ONLY the mathematical concept modules chosen for that strategy.
 * - When omitted (`undefined`), runs the full structural extraction suite for backwards compatibility.
 */
export function extractMarketStructure(
  candles: Candle[],
  blueprintOrDetectors?: string[] | StrategyBlueprint | CompilerOutput
): MarketStructure {
  if (!candles || candles.length < 5) {
    return emptyMarketStructure();
  }

  let blueprint: StrategyBlueprint;
  let overrideModuleIds: ConceptModuleId[] | undefined;

  if (!blueprintOrDetectors) {
    // Unfiltered mode: run all structural, zone, price-action & volatility modules
    const allIds: ConceptModuleId[] = ALL_CONCEPT_MODULES.map(m => m.id);
    blueprint = {
      version: '1.0',
      activatedModuleIds: allIds,
      mandatoryModuleIds: [],
      optionalModuleIds: allIds,
      modules: [],
      preferredHtf: 'H4',
      strategyMode: 'RULE_ONLY',
      executionMode: 'RULE_ONLY'
    };
    overrideModuleIds = [
      'bos',
      'choch',
      'fair_value_gap',
      'order_block',
      'liquidity_sweep',
      'support',
      'resistance',
      'trendline_breakout',
      'break_and_retest',
      'confirmation_candle',
      'atr',
      'volume_confirmation'
    ];
  } else if (Array.isArray(blueprintOrDetectors)) {
    const resolved = blueprintOrDetectors
      .map(id => resolveConceptModuleId(id))
      .filter((id): id is ConceptModuleId => id !== null);
    const deduped = [...new Set(resolved)];
    blueprint = {
      version: '1.0',
      activatedModuleIds: deduped,
      mandatoryModuleIds: [],
      optionalModuleIds: deduped,
      modules: [],
      preferredHtf: 'H4',
      strategyMode: 'RULE_ONLY',
      executionMode: 'RULE_ONLY'
    };
    overrideModuleIds = deduped;
  } else if ('compiled_rules' in blueprintOrDetectors) {
    blueprint = blueprintOrDetectors.blueprint || buildStrategyBlueprint(blueprintOrDetectors);
    overrideModuleIds = blueprint.activatedModuleIds;
  } else {
    blueprint = blueprintOrDetectors;
    overrideModuleIds = blueprint.activatedModuleIds;
  }

  const report = executeStrategyBlueprint(blueprint, candles, { overrideModuleIds });
  return report.marketStructure as MarketStructure;
}
