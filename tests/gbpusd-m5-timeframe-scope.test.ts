import assert from 'assert';
import {
  identifyCandidateZones,
  identifyMarkedZone,
  isZoneOutOfTimeframeScope,
  MarkedZone
} from '../src/lib/zone-engine.js';
import { extractMarketStructure } from '../src/lib/market-structure-engine.js';
import { Candle } from '../src/lib/strategy-engine.js';

/**
 * Builds 120 M5 GBPUSD candles covering [1.3145 - 1.3210] matching the user's M5 screenshot,
 * with a clean M5 Bearish Order Block at ~[1.3192 - 1.3198] followed by downward displacement
 * to current price 1.31655.
 */
function createGbpusdM5Candles(): Candle[] {
  const candles: Candle[] = [];
  const baseMs = new Date('2026-11-18T05:00:00Z').getTime();
  const m5 = 5 * 60 * 1000;

  // 1. Initial drift 1.3175 -> 1.3208 (candles 0..39)
  let p = 1.3175;
  for (let i = 0; i < 40; i++) {
    const o = p;
    p += i < 20 ? 0.00014 : -0.00005;
    candles.push({
      timestamp: new Date(baseMs + i * m5).toISOString(),
      open: Number(o.toFixed(5)),
      high: Number((Math.max(o, p) + 0.00025).toFixed(5)),
      low: Number((Math.min(o, p) - 0.00025).toFixed(5)),
      close: Number(p.toFixed(5)),
      volume: 450
    });
  }

  // 2. Rally up to M5 Swing High OB around 1.3192 - 1.3198 (candles 40..59)
  let up = candles[candles.length - 1].close;
  for (let i = 40; i < 60; i++) {
    const o = up;
    up += 0.00006;
    candles.push({
      timestamp: new Date(baseMs + i * m5).toISOString(),
      open: Number(o.toFixed(5)),
      high: Number((up + 0.0002).toFixed(5)),
      low: Number((o - 0.00015).toFixed(5)),
      close: Number(up.toFixed(5)),
      volume: 500
    });
  }

  // Index 60: Clear M5 Bearish OB up-candle [1.3192 - 1.3198]
  candles.push({
    timestamp: new Date(baseMs + 60 * m5).toISOString(),
    open: 1.31920,
    high: 1.31980,
    low: 1.31910,
    close: 1.31970,
    volume: 950
  });

  // 3. Sharp bearish displacement down from 1.31970 -> 1.31520 (candles 61..85)
  let down = 1.31970;
  for (let i = 61; i <= 85; i++) {
    const o = down;
    down -= 0.00018;
    candles.push({
      timestamp: new Date(baseMs + i * m5).toISOString(),
      open: Number(o.toFixed(5)),
      high: Number((o + 0.00008).toFixed(5)),
      low: Number((down - 0.00012).toFixed(5)),
      close: Number(down.toFixed(5)),
      volume: 1100
    });
  }

  // 4. Recent M5 price action consolidating around 1.3155 - 1.3172, ending at 1.31655 (candles 86..119)
  let cons = 1.3155;
  for (let i = 86; i < 120; i++) {
    const o = cons;
    cons = i === 119 ? 1.31655 : 1.3158 + ((i % 5) * 0.0002);
    candles.push({
      timestamp: new Date(baseMs + i * m5).toISOString(),
      open: Number(o.toFixed(5)),
      high: Number((Math.max(o, cons) + 0.00025).toFixed(5)),
      low: Number((Math.min(o, cons) - 0.00025).toFixed(5)),
      close: Number(cons.toFixed(5)),
      volume: 600
    });
  }

  return candles;
}

/**
 * Builds H4 candles spanning prior days where an old H4 Bearish Order Block sits at [1.32314 - 1.32443].
 */
function createGbpusdH4Candles(): Candle[] {
  const candles: Candle[] = [];
  const baseMs = new Date('2026-11-12T04:00:00Z').getTime();
  const h4 = 4 * 60 * 60 * 1000;

  let p = 1.3290;
  for (let i = 0; i < 12; i++) {
    const o = p;
    p -= 0.00045;
    candles.push({
      timestamp: new Date(baseMs + i * h4).toISOString(),
      open: Number(o.toFixed(5)),
      high: Number((o + 0.0008).toFixed(5)),
      low: Number((p - 0.0008).toFixed(5)),
      close: Number(p.toFixed(5)),
      volume: 5000
    });
  }

  // Index 12: Exact off-chart H4 Bearish OB [1.32314 - 1.32443]
  candles.push({
    timestamp: new Date(baseMs + 12 * h4).toISOString(),
    open: 1.32314,
    high: 1.32443,
    low: 1.32290,
    close: 1.32410,
    volume: 12000
  });

  // Massive H4 drop down to 1.31655
  let drop = 1.32410;
  for (let i = 13; i < 36; i++) {
    const o = drop;
    drop = i === 35 ? 1.31655 : drop - 0.00033;
    candles.push({
      timestamp: new Date(baseMs + i * h4).toISOString(),
      open: Number(o.toFixed(5)),
      high: Number((o + 0.0004).toFixed(5)),
      low: Number((drop - 0.0004).toFixed(5)),
      close: Number(drop.toFixed(5)),
      volume: 8000
    });
  }

  return candles;
}

function runSuite() {
  console.log('=== GBPUSD M5 TIMEFRAME SCOPE & HTF INJECTION REGRESSION TEST ===');

  const m5Candles = createGbpusdM5Candles();
  const h4Candles = createGbpusdH4Candles();
  const activePrice = 1.31655;

  const m5High = Math.max(...m5Candles.map(c => c.high));
  const m5Low = Math.min(...m5Candles.map(c => c.low));
  console.log(`M5 Range: [${m5Low} - ${m5High}], Active Price: ${activePrice}`);

  const ms = extractMarketStructure(m5Candles);
  ms.pair = 'GBPUSD';
  ms.timeframe = 'M5';
  ms.htfTrend = 'BEARISH';
  ms.htfTimeframe = 'H4';
  ms.htfAllowedDirection = 'SELL';
  ms.htfCandles = h4Candles;
  ms.htfMarketStructure = extractMarketStructure(h4Candles);

  // 1. Ensure identifyCandidateZones NEVER injects off-chart H4 zones [1.32314 - 1.32443]
  const candidates = identifyCandidateZones(m5Candles, ms, null, activePrice);
  assert.ok(candidates.length > 0, 'M5 watcher must discover M5 candidates');

  const offChartH4Leak = candidates.some(c => c.low >= 1.3225 || c.high >= 1.3225);
  assert.strictEqual(
    offChartH4Leak,
    false,
    `FAIL: Off-chart H4 zone leaked into M5 candidates: ${JSON.stringify(candidates.map(c => [c.low, c.high]))}`
  );

  const selected = identifyMarkedZone(m5Candles, ms, null, activePrice);
  assert.ok(selected, 'Selected zone must exist');
  assert.strictEqual(selected!.timeframe, 'M5', 'Selected zone must be stamped with M5 timeframe');
  assert.ok(
    selected!.low >= m5Low && selected!.high <= m5High,
    `Selected zone [${selected!.low} - ${selected!.high}] must lie within visible M5 chart range [${m5Low} - ${m5High}]`
  );
  console.log(`✅ Test 1 Passed: M5 watcher marked [${selected!.low} - ${selected!.high}] (${selected!.timeframe}), blocking off-chart H4 injection.`);

  // 2. Ensure stale already-persisted [1.32314 - 1.32443] DB zone is purged by isZoneOutOfTimeframeScope
  const staleBuggyZone: MarkedZone = {
    id: 'zone_GBPUSD_sell_stale',
    type: 'BEARISH_ORDER_BLOCK',
    direction: 'SELL',
    low: 1.32314,
    high: 1.32443,
    invalidationLevel: 1.32463,
    strength: 100,
    createdAt: new Date().toISOString(),
    createdCandleTime: '2026-11-14T04:00:00.000Z',
    tapCount: 0,
    status: 'WAITING_FOR_TAP',
    timeframe: 'M5', // Even with corrupted 'M5' fallback stamp!
    reasoning: 'Old H4 leak'
  };

  const staleScope = isZoneOutOfTimeframeScope(staleBuggyZone, m5Candles, activePrice, 'M5', 'GBPUSD');
  assert.strictEqual(staleScope.outOfScope, true, 'Stale off-chart [1.32314 - 1.32443] must be flagged outOfScope');
  console.log(`✅ Test 2 Passed: Stale off-chart zone flagged for purge (${staleScope.reason}).`);

  // 3. Ensure explicit timeframe mismatch (H4 vs M5) is caught
  const explicitMismatchZone: MarkedZone = {
    ...selected!,
    timeframe: 'H4'
  };
  const mismatchScope = isZoneOutOfTimeframeScope(explicitMismatchZone, m5Candles, activePrice, 'M5', 'GBPUSD');
  assert.strictEqual(mismatchScope.outOfScope, true, 'Mismatched H4 zone on M5 watcher must be flagged outOfScope');
  console.log('✅ Test 3 Passed: Explicit timeframe mismatch caught.');

  // 4. Ensure legitimate selected M5 zone passes scope validation cleanly
  const validScope = isZoneOutOfTimeframeScope(selected!, m5Candles, activePrice, 'M5', 'GBPUSD');
  assert.strictEqual(validScope.outOfScope, false, `Valid M5 zone should remain in scope, got: ${validScope.reason}`);
  console.log('✅ Test 4 Passed: Valid M5 zone remains active in scope.');

  console.log('=== ALL GBPUSD M5 TIMEFRAME SCOPE TESTS PASSED ===');
}

runSuite();
