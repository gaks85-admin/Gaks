import assert from 'assert';
import { Candle } from '../src/lib/strategy-engine.js';
import { compileStrategy } from '../src/lib/strategy-compiler.js';
import { extractMarketStructure } from '../src/lib/market-structure-engine.js';
import { evaluateRules } from '../src/lib/rule-engine.js';
import { evaluateDecision } from '../src/lib/decision-engine.js';
import {
  buildStrategyBlueprint,
  executeStrategyBlueprint,
  detectOrderBlocks,
  detectLiquiditySweeps,
  detectFairValueGaps,
  detectTrendlineBreakoutAndRetest,
  detectConfirmationCandles,
  detectFractalSwings,
  computeAtr
} from '../src/lib/strategy-modules/index.js';

function makeCandles(
  specs: Array<{ o: number; h: number; l: number; c: number; v?: number }>,
  startMs = Date.UTC(2026, 10, 18, 13, 0, 0),
  stepMs = 5 * 60 * 1000
): Candle[] {
  return specs.map((s, idx) => ({
    timestamp: new Date(startMs + idx * stepMs).toISOString(),
    open: s.o,
    high: s.h,
    low: s.l,
    close: s.c,
    volume: s.v ?? 100
  }));
}

console.log('=== MODULAR STRATEGY BLUEPRINT TEST SUITE ===');

// --- Test 1: Blueprint parses ONLY user-requested concepts & fixes detector coverage/aliases ---
{
  const obStrategy = compileStrategy(
    'Mandatory: Order Block and BOS. Optional: EMA 20 and 50.'
  );
  assert(obStrategy.blueprint, 'Compiler must attach StrategyBlueprint');
  const activeOb = obStrategy.blueprint!.activatedModuleIds;
  assert(activeOb.includes('order_block'), 'Order Block module must be activated');
  assert(activeOb.includes('bos'), 'BOS module must be activated');
  assert(activeOb.includes('ema'), 'EMA module must be activated');
  assert(!activeOb.includes('liquidity_sweep'), 'Liquidity Sweep must NOT be activated when not in strategy');
  assert(!activeOb.includes('fair_value_gap'), 'FVG must NOT be activated when not in strategy');
  assert(!activeOb.includes('rsi'), 'RSI must NOT be activated when not in strategy');
  assert(
    obStrategy.blueprint!.mandatoryModuleIds.includes('order_block') &&
      obStrategy.blueprint!.mandatoryModuleIds.includes('bos'),
    'Order Block and BOS must be flagged mandatory in blueprint'
  );
  assert.strictEqual(
    obStrategy.detector_validation?.coverage,
    100,
    'Active-only detector validation must report 100% coverage for supported rule sets'
  );

  const liqStrategy = compileStrategy(
    'Mandatory: Liquidity Sweep and Fair Value Gap with RSI oversold below 30'
  );
  const activeLiq = liqStrategy.blueprint!.activatedModuleIds;
  assert(activeLiq.includes('liquidity_sweep'), 'Liquidity Sweep module must be activated');
  assert(activeLiq.includes('fair_value_gap'), 'Fair Value Gap module must be activated');
  assert(activeLiq.includes('rsi'), 'RSI module must be activated');
  assert(!activeLiq.includes('order_block'), 'Order Block must NOT be activated for Liquidity/FVG/RSI setup');
  assert(!activeLiq.includes('macd'), 'MACD must NOT be activated when not requested');
  assert(
    Array.isArray(liqStrategy.detector_validation?.supported_detectors) &&
      liqStrategy.detector_validation.supported_detectors.includes('fvg') &&
      liqStrategy.detector_validation.supported_detectors.includes('fair_value_gap'),
    'supported_detectors must expose both fvg and fair_value_gap aliases'
  );
  console.log('✅ Test 1 Passed: Blueprint selective activation & detector alias parity verified.');
}

// --- Test 2: Order Block Math Module (Valid OB vs Flat/Invalidated Market) ---
{
  // Build a genuine Bullish Order Block with swing high break + displacement + retest tap
  const bullishObCandles = makeCandles([
    { o: 1.1020, h: 1.1024, l: 1.1014, c: 1.1016 }, // 0
    { o: 1.1016, h: 1.1021, l: 1.1011, c: 1.1013 }, // 1
    { o: 1.1013, h: 1.1028, l: 1.1012, c: 1.1025 }, // 2: Fractal swing high = 1.1028
    { o: 1.1025, h: 1.1026, l: 1.1015, c: 1.1017 }, // 3
    { o: 1.1017, h: 1.1019, l: 1.1008, c: 1.1010 }, // 4
    { o: 1.1010, h: 1.1012, l: 1.1000, c: 1.1002 }, // 5: Origin Bearish OB candle [1.1000 - 1.1010]
    { o: 1.1002, h: 1.1022, l: 1.1001, c: 1.1020 }, // 6: Impulsive bullish departure
    { o: 1.1020, h: 1.1045, l: 1.1019, c: 1.1042 }, // 7: Breaks above 1.1028 (BOS + FVG)
    { o: 1.1042, h: 1.1048, l: 1.1032, c: 1.1035 }, // 8
    { o: 1.1035, h: 1.1036, l: 1.1018, c: 1.1020 }, // 9
    { o: 1.1020, h: 1.1021, l: 1.1006, c: 1.1014 }  // 10: Taps OB [1.1000 - 1.1010] and rejects upward
  ]);

  const obs = detectOrderBlocks(bullishObCandles);
  assert(obs.length > 0 && obs[0].type === 'BULLISH_ORDER_BLOCK', 'Must detect valid Bullish Order Block');
  assert(obs[0].isTappedNow, 'Latest candle tapping into [1.1000 - 1.1010] must register active tap');

  // Dynamic blueprint isolation: Order Block + BOS strategy skips Liquidity Sweep & FVG
  const compiledObBos = compileStrategy('Mandatory: Order Block and BOS.');
  const msIsolated = extractMarketStructure(bullishObCandles, compiledObBos.blueprint);
  assert(msIsolated.activatedModules!.includes('order_block'), 'order_block must be in activatedModules');
  assert(msIsolated.activatedModules!.includes('bos'), 'bos must be in activatedModules');
  assert(!msIsolated.activatedModules!.includes('liquidity_sweep'), 'liquidity_sweep must NOT execute');
  assert.strictEqual(msIsolated.liquiditySweeps.length, 0, 'Unactivated liquiditySweep detector must remain empty');
  assert(Array.isArray(msIsolated.orderBlocks) && msIsolated.orderBlocks.length > 0, 'Activated order_block must populate orderBlocks');

  const decision = evaluateDecision(compiledObBos, msIsolated);
  assert(decision.mandatory_rules_passed, 'Mandatory OB + BOS must pass on genuine OB breakout & tap structure');

  // Flat market: Order Block detector must return empty
  const flatCandles = makeCandles(
    Array.from({ length: 20 }, () => ({ o: 1.1000, h: 1.1001, l: 1.0999, c: 1.1000 }))
  );
  const flatObs = detectOrderBlocks(flatCandles);
  assert.strictEqual(flatObs.length, 0, 'Flat market must produce zero Order Blocks');
  console.log('✅ Test 2 Passed: Order Block math module & selective blueprint isolation verified.');
}

// --- Test 3: Liquidity Sweep Math Module (Wick Sweep + Close Inside vs Clean Breakout) ---
{
  // Construct swing low at index 3 (low = 1.1000), resting liquidity swept at last bar (low = 1.0991, close = 1.1006)
  const sweepCandles = makeCandles([
    { o: 1.1030, h: 1.1035, l: 1.1020, c: 1.1022 }, // 0
    { o: 1.1022, h: 1.1025, l: 1.1010, c: 1.1012 }, // 1
    { o: 1.1012, h: 1.1015, l: 1.1004, c: 1.1006 }, // 2
    { o: 1.1006, h: 1.1010, l: 1.1000, c: 1.1008 }, // 3: Swing Low at 1.1000
    { o: 1.1008, h: 1.1018, l: 1.1005, c: 1.1016 }, // 4
    { o: 1.1016, h: 1.1024, l: 1.1012, c: 1.1020 }, // 5
    { o: 1.1020, h: 1.1022, l: 1.1011, c: 1.1013 }, // 6
    { o: 1.1013, h: 1.1015, l: 1.1003, c: 1.1005 }, // 7
    { o: 1.1005, h: 1.1010, l: 1.0991, c: 1.1008 }  // 8: LOW_SWEEP below 1.1000 closing back at 1.1008
  ]);

  const swings = detectFractalSwings(sweepCandles, 2);
  const atr = computeAtr(sweepCandles, 14);
  const { sweeps } = detectLiquiditySweeps(sweepCandles, swings.swingHighs, swings.swingLows, atr);
  assert(sweeps.some(s => s.type === 'LOW_SWEEP'), 'Must detect bullish sell-side LOW_SWEEP');

  // Clean breakdown (closes BELOW 1.1000 at 1.0985) must NOT register as a liquidity sweep rejection
  const breakoutCandles = [
    ...sweepCandles.slice(0, 8),
    ...makeCandles([{ o: 1.1005, h: 1.1006, l: 1.0983, c: 1.0985 }], Date.UTC(2026, 10, 18, 13, 40, 0))
  ];
  const noSweep = detectLiquiditySweeps(breakoutCandles, swings.swingHighs, swings.swingLows, atr);
  assert.strictEqual(noSweep.sweeps.length, 0, 'Clean close breakdown without reclaim must NOT trigger liquidity sweep');

  const compiledLiq = compileStrategy('Mandatory: Liquidity Sweep required.');
  const report = executeStrategyBlueprint(compiledLiq, sweepCandles);
  assert.deepStrictEqual(report.executedModules, ['liquidity_sweep'], 'Only liquidity_sweep module must execute');
  assert(report.passed && report.mandatoryPassed, 'Blueprint must pass on genuine liquidity sweep');
  console.log('✅ Test 3 Passed: Liquidity Sweep math module accurately distinguishes trap sweeps from breakouts.');
}

// --- Test 4: Dynamic FVG, Trendline, Confirmation Candle, & Indicator Math (Zero Fake Passes!) ---
{
  // Rising series creating a Bullish FVG and Bullish EMA alignment
  const fvgTrendCandles = makeCandles([
    { o: 100.0, h: 100.5, l: 99.8, c: 100.3, v: 90 },
    { o: 100.3, h: 100.8, l: 100.1, c: 100.6, v: 95 },
    { o: 100.6, h: 101.2, l: 100.4, c: 101.0, v: 100 },
    { o: 101.0, h: 103.5, l: 100.9, c: 103.2, v: 180 },
    { o: 103.2, h: 104.5, l: 102.5, c: 104.0, v: 160 } // low 102.5 > candle[2].high 101.2 => Bullish FVG [101.2 - 102.5]
  ]);
  const fvgs = detectFairValueGaps(fvgTrendCandles);
  assert(fvgs.some(f => f.type === 'BULLISH_FVG' && !f.isFilled), 'Must detect unfilled Bullish FVG');

  // Confirmation candle test: Bullish Engulfing
  const engulfCandles = makeCandles([
    { o: 105.0, h: 105.2, l: 104.0, c: 104.2 },
    { o: 104.1, h: 106.0, l: 104.0, c: 105.8 }
  ]);
  const patterns = detectConfirmationCandles(engulfCandles, 1.0);
  assert(patterns.some(p => p.pattern === 'BULLISH_ENGULFING'), 'Must detect Bullish Engulfing candle');

  // Rule Engine ZERO fake passes: RSI overbought/oversold strategy fails on mild steady trend (RSI ~ 100 vs wait -> RSI oversold only vs neutral)
  // Build oscillating candles so Wilder RSI stays near ~50 (neither >= 80 nor <= 20)
  const neutralOscCandles = makeCandles(
    Array.from({ length: 24 }, (_, idx) => {
      const base = idx % 2 === 0 ? 100.0 : 100.5;
      return { o: base, h: base + 0.6, l: base - 0.6, c: idx % 2 === 0 ? 100.4 : 100.1, v: 100 };
    })
  );
  const rsiWatcher = {
    id: 'w-rsi',
    status: 'active',
    selected_pair: 'SOLUSD',
    selected_timeframe: 'M5',
    strategy_text: 'Mandatory: RSI overbought 80 or oversold 20'
  };
  const rsiRuleRes = evaluateRules(rsiWatcher, neutralOscCandles);
  assert.strictEqual(
    rsiRuleRes.passed,
    false,
    'Modular Rule Engine must FAIL when mandatory RSI condition is neutral (~50), with no hardcoded || true bypass'
  );
  assert(
    rsiRuleRes.activatedModules?.includes('rsi') && !rsiRuleRes.activatedModules.includes('order_block'),
    'evaluateRules must activate ONLY RSI module for RSI strategy'
  );

  // Trendline breakout & retest detection
  const tlCandles = makeCandles([
    { o: 110.0, h: 110.5, l: 109.5, c: 110.0 },
    { o: 110.0, h: 111.0, l: 109.8, c: 110.8 },
    { o: 110.8, h: 113.0, l: 110.5, c: 111.2 }, // 2: Swing High 1 = 113.0
    { o: 111.2, h: 111.5, l: 110.2, c: 110.5 },
    { o: 110.5, h: 110.8, l: 109.2, c: 109.8 },
    { o: 109.8, h: 110.2, l: 109.4, c: 110.0 },
    { o: 110.0, h: 111.4, l: 109.8, c: 110.2 }, // 6: Lower Swing High 2 = 111.4
    { o: 110.2, h: 110.4, l: 109.0, c: 109.4 },
    { o: 109.4, h: 109.6, l: 108.8, c: 109.1 },
    { o: 109.1, h: 111.5, l: 109.0, c: 111.2 }, // 9: Decisive breakout above descending trendline (~110.2)
    { o: 111.2, h: 111.3, l: 109.7, c: 110.9 }  // 10: Retests descending trendline (~109.8) & closes bullishly above it
  ]);
  const tlSwings = detectFractalSwings(tlCandles, 2);
  const tlResult = detectTrendlineBreakoutAndRetest(tlCandles, tlSwings.swingHighs, tlSwings.swingLows, computeAtr(tlCandles, 14));
  assert(tlResult.breakouts.some(b => b.type === 'UPPER_BREAKOUT'), 'Must detect UPPER_BREAKOUT above descending trendline');
  assert(tlResult.retests.some(r => r.confirmed && r.type === 'BULLISH_RETEST'), 'Must detect confirmed break and retest');

  console.log('✅ Test 4 Passed: FVG, Confirmation Candle, RSI Rule Engine gating, and Trendline Breakout/Retest verified.');
}

console.log('ALL MODULAR STRATEGY BLUEPRINT TESTS PASSED!');
