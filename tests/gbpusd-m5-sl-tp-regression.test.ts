import assert from 'assert';
import { analyzeMarket, Candle } from '../src/lib/strategy-engine.js';
import {
  calculateStructuralStopLoss,
  getTimeframeMaxSlPips,
  validateZoneProximityAndStopLoss
} from '../src/lib/structural-stop-loss.js';
import { extractMarketStructure } from '../src/lib/market-structure-engine.js';
import { MarkedZone } from '../src/lib/zone-engine.js';

function createGbpusdM5TapCandles(): Candle[] {
  const candles: Candle[] = [];
  const baseMs = new Date('2026-11-18T12:00:00Z').getTime();
  const m5 = 5 * 60 * 1000;

  let p = 1.3160;
  for (let i = 0; i < 30; i++) {
    const o = p;
    const delta = i < 20 ? -0.00008 : 0.00004;
    p = o + delta;
    candles.push({
      timestamp: new Date(baseMs + i * m5).toISOString(),
      open: Number(o.toFixed(5)),
      high: Number((Math.max(o, p) + 0.00025).toFixed(5)),
      low: Number((Math.min(o, p) - 0.00025).toFixed(5)),
      close: Number(p.toFixed(5)),
      volume: 600
    });
  }

  // Final bearish rejection candle at 1.31500
  candles.push({
    timestamp: new Date(baseMs + 30 * m5).toISOString(),
    open: 1.31530,
    high: 1.31565,
    low: 1.31490,
    close: 1.31500,
    volume: 900
  });

  return candles;
}

function runTests() {
  console.log('=== GBPUSD M5 SL/TP WIDTH & STRUCTURAL RESOLUTION REGRESSION TESTS ===');

  const candles = createGbpusdM5TapCandles();
  const entryPrice = 1.31500;
  const pipSize = 0.0001;

  // 1. analyzeMarket must NOT produce 1% (131.5 pip) SL / 2% (263 pip) TP on Forex
  const analysis = analyzeMarket(
    candles,
    { bos: true, minimumRiskReward: 2 },
    'SELL'
  );
  assert.strictEqual(analysis.signal, 'SELL', 'Expected SELL signal');
  assert.ok(analysis.stopLoss && analysis.takeProfit, 'Expected non-null SL and TP');

  const analyzeSlPips = (analysis.stopLoss! - entryPrice) / pipSize;
  const analyzeTpPips = (entryPrice - analysis.takeProfit!) / pipSize;
  assert.ok(
    analyzeSlPips > 1 && analyzeSlPips <= 25,
    `Expected tight M5 ATR-based SL (1-25 pips), got ${analyzeSlPips.toFixed(1)} pips (${analysis.stopLoss})`
  );
  assert.ok(
    analyzeTpPips > 2 && analyzeTpPips <= 50,
    `Expected tight M5 R:R-scaled TP (2-50 pips), got ${analyzeTpPips.toFixed(1)} pips (${analysis.takeProfit})`
  );
  console.log(`✅ Test 1 Passed: analyzeMarket produced tight SL=${analyzeSlPips.toFixed(1)} pips (${analysis.stopLoss}), TP=${analyzeTpPips.toFixed(1)} pips (${analysis.takeProfit}).`);

  // 2. Normal M5 GBPUSD zone (e.g. 7.5 pip structural SL) must NOT be falsely rejected as too wide
  const m5Zone: MarkedZone = {
    id: 'zone_gbpusd_m5_test',
    type: 'BEARISH_ORDER_BLOCK',
    direction: 'SELL',
    low: 1.31500,
    high: 1.31565,
    invalidationLevel: 1.31585,
    strength: 90,
    createdAt: new Date().toISOString(),
    tapCount: 1,
    status: 'ZONE_TAPPED',
    timeframe: 'M5',
    reasoning: 'M5 Bearish OB'
  };

  const atr = 0.0005; // 5 pips M5 ATR
  const maxSlPips = getTimeframeMaxSlPips('M5', 'GBPUSD', atr, entryPrice);
  assert.ok(maxSlPips >= 8.0 && maxSlPips <= 15.0, `Expected bounded M5 Forex max SL in [8, 15] pips, got ${maxSlPips}`);

  const prox = validateZoneProximityAndStopLoss('SELL', entryPrice, m5Zone, 'M5', 'GBPUSD', atr);
  assert.strictEqual(prox.isLateEntry, false, 'Tapped M5 zone must not be marked late entry');
  assert.strictEqual(prox.isSlTooWide, false, `Valid 8.5 pip M5 zone SL must not be rejected as too wide (got ${prox.slDistancePips.toFixed(1)} pips)`);
  assert.ok(prox.slDistancePips <= maxSlPips + 0.01, `SL distance (${prox.slDistancePips.toFixed(1)}) must fit within maxSlPips (${maxSlPips})`);
  console.log(`✅ Test 2 Passed: M5 zone proximity & SL=${prox.stopLoss} (${prox.slDistancePips.toFixed(1)} pips <= ${maxSlPips} pips max) accepted cleanly.`);

  // 3. calculateStructuralStopLoss uses tight markedZone ceiling, never 1% (134 pips)
  const ms = extractMarketStructure(candles);
  ms.pair = 'GBPUSD';
  ms.timeframe = 'M5';
  (ms as any).markedZone = m5Zone;
  const structSl = calculateStructuralStopLoss('SELL', entryPrice, ms);
  const structSlPips = (structSl.stopLoss - entryPrice) / pipSize;
  assert.ok(structSlPips > 0 && structSlPips <= 15, `Structural SL must stay <= 15 pips on M5, got ${structSlPips.toFixed(1)} pips`);
  console.log(`✅ Test 3 Passed: Structural SL resolved cleanly at ${structSl.stopLoss} (${structSlPips.toFixed(1)} pips).`);

  console.log('=== ALL GBPUSD M5 SL/TP REGRESSION TESTS PASSED ===');
}

runTests();
