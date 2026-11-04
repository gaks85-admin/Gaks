import { 
  evaluateZoneState, 
  detectLargeDisplacementAway, 
  identifyCandidateZones, 
  MarkedZone, 
  Candle 
} from '../src/lib/zone-engine.js';
import { MarketStructure } from '../src/lib/market-structure-engine.js';
import { compileStrategy } from '../src/lib/strategy-compiler.js';
import { evaluateDecision } from '../src/lib/decision-engine.js';
import fs from 'fs';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[TEST FAILED] ${message}`);
  }
}

console.log('=== RUNNING DETERMINISTIC ZONE LIFECYCLE & RESELECTION REGRESSION TESTS ===');

// --- Test A: Bearish supply zone with strong bearish displacement away ---
{
  const zone: MarkedZone = {
    id: 'zone_supply_1',
    type: 'BEARISH_ORDER_BLOCK',
    direction: 'SELL',
    high: 1.39758,
    low: 1.39673,
    invalidationLevel: 1.39800,
    strength: 90,
    createdAt: new Date().toISOString(),
    createdCandleTime: '2026-11-04T05:00:00.000Z',
    tapCount: 0,
    status: 'WAITING_FOR_TAP',
    reasoning: 'Bearish supply zone'
  };

  const candle: Candle = {
    timestamp: '2026-11-04T05:15:00.000Z',
    open: 1.39450,
    high: 1.39460,
    low: 1.39300,
    close: 1.39337,
    volume: 1000
  };

  const candles: Candle[] = [
    { timestamp: '2026-11-04T05:00:00.000Z', open: 1.39600, high: 1.39758, low: 1.39580, close: 1.39673, volume: 500 },
    candle
  ];

  const result = evaluateZoneState(zone, candle, 1.39337, 0.00080, candles);
  assert(result.status === 'EXPIRED_WITHOUT_ENTRY', `Expected EXPIRED_WITHOUT_ENTRY status for displacement away, got: ${result.status}`);
  assert(result.isTapped === false, 'Expected isTapped false for displacement away');
  assert(result.isInvalidated === false, 'Expected isInvalidated false (displacement is not a SL breach)');
  console.log('✅ Test A Passed: Bearish supply zone correctly transitioned to EXPIRED_WITHOUT_ENTRY on large displacement away.');
}

// --- Test B: Bullish demand zone with strong bullish displacement away ---
{
  const zone: MarkedZone = {
    id: 'zone_demand_1',
    type: 'BULLISH_ORDER_BLOCK',
    direction: 'BUY',
    high: 1.10200,
    low: 1.10100,
    invalidationLevel: 1.10000,
    strength: 90,
    createdAt: new Date().toISOString(),
    createdCandleTime: '2026-11-04T05:00:00.000Z',
    tapCount: 0,
    status: 'WAITING_FOR_TAP',
    reasoning: 'Bullish demand zone'
  };

  const candle: Candle = {
    timestamp: '2026-11-04T05:15:00.000Z',
    open: 1.10300,
    high: 1.10700,
    low: 1.10280,
    close: 1.10680,
    volume: 1000
  };

  const candles: Candle[] = [
    { timestamp: '2026-11-04T05:00:00.000Z', open: 1.10150, high: 1.10200, low: 1.10100, close: 1.10180, volume: 500 },
    candle
  ];

  const result = evaluateZoneState(zone, candle, 1.10680, 0.00080, candles);
  assert(result.status === 'EXPIRED_WITHOUT_ENTRY', `Expected EXPIRED_WITHOUT_ENTRY for Bullish demand displacement away, got: ${result.status}`);
  console.log('✅ Test B Passed: Bullish demand zone correctly transitioned to EXPIRED_WITHOUT_ENTRY.');
}

// --- Test C: Genuine structural invalidation ---
{
  const zone: MarkedZone = {
    id: 'zone_demand_2',
    type: 'BULLISH_ORDER_BLOCK',
    direction: 'BUY',
    high: 1.10200,
    low: 1.10100,
    invalidationLevel: 1.10000,
    strength: 90,
    createdAt: new Date().toISOString(),
    tapCount: 0,
    status: 'WAITING_FOR_TAP',
    reasoning: 'Bullish demand zone'
  };

  const candle: Candle = {
    timestamp: '2026-11-04T05:15:00.000Z',
    open: 1.10050,
    high: 1.10080,
    low: 1.09850,
    close: 1.09880,
    volume: 1000
  };

  const result = evaluateZoneState(zone, candle, 1.09880, 0.00080, [candle]);
  assert(result.status === 'INVALIDATED', `Expected INVALIDATED for breach below invalidation level, got: ${result.status}`);
  assert(result.isInvalidated === true, 'Expected isInvalidated true');
  console.log('✅ Test C Passed: Genuine structural invalidation correctly set status to INVALIDATED.');
}

// --- Test D: Mitigated zone handling ---
{
  const candles: Candle[] = [
    { timestamp: '2026-11-04T04:00:00.000Z', open: 1.1000, high: 1.1020, low: 1.0990, close: 1.1015, volume: 100 },
    { timestamp: '2026-11-04T04:15:00.000Z', open: 1.1015, high: 1.1050, low: 1.1010, close: 1.1045, volume: 200 },
    { timestamp: '2026-11-04T04:30:00.000Z', open: 1.1045, high: 1.1045, low: 1.0995, close: 1.1020, volume: 150 }
  ];

  const marketStructure: MarketStructure = {
    trend: 'BULLISH',
    pair: 'EURUSD',
    timeframe: 'M15',
    swingHighs: [],
    swingLows: [],
    supportZones: [],
    resistanceZones: [],
    fairValueGaps: [],
    liquiditySweeps: [],
    volatilityInformation: { atr: 0.0008, volatility: 'NORMAL' },
    volumeInformation: { volumeSpike: false, currentVolume: 150, averageVolume: 100 }
  };

  const candidates = identifyCandidateZones(candles, marketStructure, null, 1.1020);
  assert(Array.isArray(candidates), 'Expected candidate array returned');
  console.log('✅ Test D Passed: Mitigated zone properly handled without runtime error.');
}

// --- Test E: Candidate selection from valid structural POI ---
{
  const candles: Candle[] = [
    { timestamp: '2026-11-04T04:00:00.000Z', open: 1.3960, high: 1.3970, low: 1.3955, close: 1.3965, volume: 100 },
    { timestamp: '2026-11-04T04:15:00.000Z', open: 1.3965, high: 1.3970, low: 1.3910, close: 1.3915, volume: 500 }, // Impulsive displacement
    { timestamp: '2026-11-04T04:30:00.000Z', open: 1.3915, high: 1.3920, low: 1.3900, close: 1.3905, volume: 100 },
    { timestamp: '2026-11-04T04:45:00.000Z', open: 1.3905, high: 1.3910, low: 1.3890, close: 1.3895, volume: 100 },
    { timestamp: '2026-11-04T05:00:00.000Z', open: 1.3895, high: 1.3900, low: 1.3880, close: 1.3885, volume: 100 }
  ];

  const marketStructure: MarketStructure = {
    trend: 'BEARISH',
    pair: 'USDCAD',
    timeframe: 'M15',
    swingHighs: [],
    swingLows: [],
    supportZones: [],
    resistanceZones: [],
    fairValueGaps: [],
    liquiditySweeps: [],
    volatilityInformation: { atr: 0.0008, volatility: 'NORMAL' },
    volumeInformation: { volumeSpike: false, currentVolume: 100, averageVolume: 100 },
    htfTrend: 'BEARISH',
    htfTimeframe: 'H4'
  };

  const candidates = identifyCandidateZones(candles, marketStructure, null, 1.3885);
  assert(candidates.length > 0, 'Expected genuine structural OB identified from displacement');
  assert(candidates[0].direction === 'SELL', 'Expected BEARISH SELL candidate matching BEARISH trend');
  console.log('✅ Test E Passed: Genuine candidate selection confirmed from displacement structure.');
}

// --- Test F: No valid candidate (Honest empty return) ---
{
  const flatCandles: Candle[] = [
    { timestamp: '2026-11-04T04:00:00.000Z', open: 1.1000, high: 1.1002, low: 1.0998, close: 1.1001, volume: 100 },
    { timestamp: '2026-11-04T04:15:00.000Z', open: 1.1001, high: 1.1003, low: 1.0999, close: 1.1000, volume: 100 },
    { timestamp: '2026-11-04T04:30:00.000Z', open: 1.1000, high: 1.1002, low: 1.0998, close: 1.1001, volume: 100 },
    { timestamp: '2026-11-04T04:45:00.000Z', open: 1.1001, high: 1.1003, low: 1.0999, close: 1.1000, volume: 100 },
    { timestamp: '2026-11-04T05:00:00.000Z', open: 1.1000, high: 1.1002, low: 1.0998, close: 1.1001, volume: 100 }
  ];

  const marketStructure: MarketStructure = {
    trend: 'SIDEWAYS',
    pair: 'EURUSD',
    timeframe: 'M15',
    swingHighs: [],
    swingLows: [],
    supportZones: [],
    resistanceZones: [],
    fairValueGaps: [],
    liquiditySweeps: [],
    volatilityInformation: { atr: 0.0008, volatility: 'NORMAL' },
    volumeInformation: { volumeSpike: false, currentVolume: 100, averageVolume: 100 }
  };

  const candidates = identifyCandidateZones(flatCandles, marketStructure, null, 1.1001);
  assert(candidates.length === 0, `Expected empty [] candidate array when no structural POI exists, got length ${candidates.length}`);
  console.log('✅ Test F Passed: No valid candidate and no fabricated fallback confirmed.');
}

// --- Test G: Mandatory zone-dependent strategy check ---
{
  const strategyText = `# Strategy
## Rules
- Entry on unmitigated order block test
- Minimum RR 1:2`;

  const compiled = compileStrategy(strategyText);
  assert(compiled.mandatory_rules.includes('order_block'), 'Expected order_block to be in mandatory_rules');
  console.log('✅ Test G Passed: Strategy order block requirement correctly identified as mandatory.');
}

// --- Test H: Zone-independent strategy evaluation ---
{
  const strategyText = `# Indicator Strategy
## Rules
- EMA 20 crossover
- RSI above 50
- Minimum RR 1:2`;

  const compiled = compileStrategy(strategyText);
  assert(!compiled.mandatory_rules.includes('order_block'), 'Indicator strategy must not require order_block');

  const marketStructure: any = {
    trend: 'BULLISH',
    pair: 'EURUSD',
    timeframe: 'H1',
    ema: { enabled: true, aligned: true },
    rsi: { enabled: true, value: 55, condition: 'BULLISH' },
    risk_reward: { min_ratio: 2 }
  };

  const decision = evaluateDecision(compiled, marketStructure);
  assert(decision.mandatory_rules_passed === true, 'Zone-independent strategy must pass mandatory rules when indicators align');
  console.log('✅ Test H Passed: Legitimate zone-independent strategy evaluation confirmed.');
}

// --- Test I: Duplicate rejected zone prevention ---
{
  const rejected = [{ low: 1.3960, high: 1.3970, direction: 'SELL' as const, rejectedAt: Date.now(), reason: 'Quality Gate' }];
  const candles: Candle[] = [
    { timestamp: '2026-11-04T04:00:00.000Z', open: 1.3960, high: 1.3970, low: 1.3955, close: 1.3965, volume: 100 },
    { timestamp: '2026-11-04T04:15:00.000Z', open: 1.3965, high: 1.3970, low: 1.3910, close: 1.3915, volume: 500 },
    { timestamp: '2026-11-04T04:30:00.000Z', open: 1.3915, high: 1.3920, low: 1.3900, close: 1.3905, volume: 100 },
    { timestamp: '2026-11-04T04:45:00.000Z', open: 1.3905, high: 1.3910, low: 1.3890, close: 1.3895, volume: 100 },
    { timestamp: '2026-11-04T05:00:00.000Z', open: 1.3895, high: 1.3900, low: 1.3880, close: 1.3885, volume: 100 }
  ];

  const marketStructure: MarketStructure = {
    trend: 'BEARISH',
    pair: 'USDCAD',
    timeframe: 'M15',
    swingHighs: [],
    swingLows: [],
    supportZones: [],
    resistanceZones: [],
    fairValueGaps: [],
    liquiditySweeps: [],
    volatilityInformation: { atr: 0.0008, volatility: 'NORMAL' },
    volumeInformation: { volumeSpike: false, currentVolume: 100, averageVolume: 100 }
  };

  const candidates = identifyCandidateZones(candles, marketStructure, null, 1.3885, rejected);
  const selectedMatchesRejected = candidates.some(c => c.low === 1.3960 && c.high === 1.3970);
  assert(!selectedMatchesRejected, 'Rejected zone must not be reselected');
  console.log('✅ Test I Passed: Duplicate rejected zone prevention confirmed.');
}

// --- Test J: Cron and Scan Handler Parity ---
{
  const scanContent = fs.readFileSync('src/lib/watcher-handlers/scan.ts', 'utf-8');
  const cronContent = fs.readFileSync('api/cron/market-watcher.ts', 'utf-8');

  // 1. Override flag parity
  assert(scanContent.includes("MARKET_WATCHER_DECISION_MODE_OVERRIDE: 'RULE_ONLY' | 'HYBRID' | 'AI_ONLY' | null = null"), 'scan.ts decision mode override must be null');
  assert(cronContent.includes("MARKET_WATCHER_DECISION_MODE_OVERRIDE: ExecutionMode | null = null") || cronContent.includes("MARKET_WATCHER_DECISION_MODE_OVERRIDE = null"), 'market-watcher.ts decision mode override must be null');

  // 2. Shared core module imports and usage parity
  assert((scanContent.includes('identifyCandidateZones') || scanContent.includes('identifyMarkedZone')) && cronContent.includes('identifyCandidateZones'), 'Both entry points must use zone engine candidate selection');
  assert(scanContent.includes('evaluateZoneState') && cronContent.includes('evaluateZoneState'), 'Both entry points must use evaluateZoneState');
  assert(scanContent.includes('compileStrategy') && cronContent.includes('compileStrategy'), 'Both entry points must use compileStrategy');
  assert(scanContent.includes('evaluateDecision') && cronContent.includes('evaluateDecision'), 'Both entry points must use evaluateDecision');
  assert(scanContent.includes('recordRejectedZone') && cronContent.includes('recordRejectedZone'), 'Both entry points must use recordRejectedZone');

  // 3. Direct behavioral parity test for zone-centric vs zone-independent strategies
  const obStrategy = compileStrategy('# SMC Strategy\n- Order Block');
  const emptyMS: MarketStructure = { trend: 'SIDEWAYS', pair: 'EURUSD', timeframe: 'M15', swingHighs: [], swingLows: [], supportZones: [], resistanceZones: [], fairValueGaps: [], liquiditySweeps: [], volatilityInformation: { atr: 0.0008, volatility: 'NORMAL' }, volumeInformation: { volumeSpike: false, currentVolume: 100, averageVolume: 100 } };
  
  const obDecision = evaluateDecision(obStrategy, emptyMS);
  assert(obDecision.mandatory_rules_passed === false, 'Zone-centric strategy without candidate zone must fail mandatory rules');

  const indStrategy = compileStrategy('# Indicator Strategy\n- EMA 20\n- RSI above 50');
  const indMS: any = { trend: 'BULLISH', pair: 'EURUSD', timeframe: 'M15', ema: { enabled: true, aligned: true }, rsi: { enabled: true, value: 60, condition: 'BULLISH' }, risk_reward: { min_ratio: 2 } };
  const indDecision = evaluateDecision(indStrategy, indMS);
  assert(indDecision.mandatory_rules_passed === true, 'Zone-independent strategy must pass mandatory rules when indicators align');

  console.log('✅ Test J Passed: Cron and Scan handler decision mode override and behavioral parity confirmed.');
}

// --- Test K: No lookahead verification across Scenarios A, B, and C ---
{
  // Red origin candle at T0
  const c0: Candle = { timestamp: '2026-11-04T04:00:00.000Z', open: 1.1015, high: 1.1020, low: 1.0990, close: 1.0995, volume: 100 };
  // Pause candle at T1 (before confirmation/displacement)
  const c1: Candle = { timestamp: '2026-11-04T04:15:00.000Z', open: 1.0995, high: 1.1000, low: 1.0992, close: 1.0998, volume: 100 };
  // Impulsive displacement candle at T2
  const c2: Candle = { timestamp: '2026-11-04T04:30:00.000Z', open: 1.0998, high: 1.1090, low: 1.0995, close: 1.1085, volume: 500 };

  const marketStructurePast: MarketStructure = {
    trend: 'BULLISH',
    pair: 'EURUSD',
    timeframe: 'M15',
    swingHighs: [],
    swingLows: [],
    supportZones: [],
    resistanceZones: [],
    fairValueGaps: [],
    liquiditySweeps: [],
    volatilityInformation: { atr: 0.0008, volatility: 'NORMAL' },
    volumeInformation: { volumeSpike: false, currentVolume: 100, averageVolume: 100 }
  };

  // Scenario A — Before confirmation candle closes (evaluated on history [c0, c1])
  const earlyCandidates = identifyCandidateZones([c0, c1], marketStructurePast, null, 1.0998);
  assert(earlyCandidates.length === 0, 'Scenario A: No zone should be generated before displacement candle closes at T1');

  // Scenario B — At confirmation (evaluated on history [c0, c1, c2] at T2 close)
  const lateCandidates = identifyCandidateZones([c0, c1, c2], marketStructurePast, null, 1.1085);
  assert(lateCandidates.length > 0, 'Scenario B: Zone must become eligible at or after displacement candle closes at T2');
  assert(lateCandidates[0].createdCandleTime === '2026-11-04T04:00:00.000Z', 'Scenario B: Zone createdCandleTime must equal red origin candle timestamp');
  assert(lateCandidates[0].displacementCandleTime === '2026-11-04T04:30:00.000Z', 'Scenario B: Zone displacementCandleTime must equal displacement candle timestamp');

  // Scenario C — No future data leakage (isolated evaluation window)
  const fullDataset = [c0, c1, c2];
  const slicedAtT1 = fullDataset.slice(0, 2);
  const candidatesAtT1 = identifyCandidateZones(slicedAtT1, marketStructurePast, null, 1.0998);
  assert(candidatesAtT1.length === 0, 'Scenario C: Evaluator sliced at T1 must not leak T2 future candle data');

  console.log('✅ Test K Passed: No-lookahead temporal eligibility boundary verified across Scenarios A, B, and C.');
}

console.log('=== ALL DETERMINISTIC ZONE LIFECYCLE TESTS PASSED SUCCESSFULLY ===');
