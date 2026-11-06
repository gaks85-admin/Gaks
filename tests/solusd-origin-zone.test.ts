import { identifyCandidateZones, identifyMarkedZone } from '../src/lib/zone-engine.js';
import { MarketStructure } from '../src/lib/market-structure-engine.js';
import { Candle } from '../src/lib/strategy-engine.js';

function createSolusdCandles(): Candle[] {
  const candles: Candle[] = [];
  const baseTime = Date.now() - 50 * 4 * 3600 * 1000;

  // 1. Initial uptrend to 97.00 peak
  let currentPrice = 90.0;
  for (let i = 0; i < 20; i++) {
    const open = currentPrice;
    currentPrice += 0.35;
    candles.push({
      timestamp: new Date(baseTime + i * 4 * 3600 * 1000).toISOString(),
      open,
      high: currentPrice + 0.2,
      low: open - 0.1,
      close: currentPrice,
      volume: 1000
    });
  }

  // 2. Swing High / Origin Candle at index 20 (95.5 - 97.0)
  candles.push({
    timestamp: new Date(baseTime + 20 * 4 * 3600 * 1000).toISOString(),
    open: 95.50,
    high: 97.00,
    low: 95.30,
    close: 96.80,
    volume: 3500
  });

  // 3. Massive bearish displacement plunge from 96.80 down to 89.00
  let dropPrice = 96.80;
  for (let i = 21; i < 30; i++) {
    const open = dropPrice;
    dropPrice -= 0.85;
    candles.push({
      timestamp: new Date(baseTime + i * 4 * 3600 * 1000).toISOString(),
      open,
      high: open + 0.1,
      low: dropPrice - 0.2,
      close: dropPrice,
      volume: 4000
    });
  }

  // 4. Micro inside candle at 90.31 - 90.51 near current price (index 30)
  candles.push({
    timestamp: new Date(baseTime + 30 * 4 * 3600 * 1000).toISOString(),
    open: 90.35,
    high: 90.51,
    low: 90.31,
    close: 90.48,
    volume: 500
  });

  // 5. Current price candle at 89.98 (index 31)
  candles.push({
    timestamp: new Date(baseTime + 31 * 4 * 3600 * 1000).toISOString(),
    open: 90.48,
    high: 90.50,
    low: 89.85,
    close: 89.98,
    volume: 1200
  });

  return candles;
}

async function runTest() {
  console.log("=== TESTING SOLUSD INSTITUTIONAL ORIGIN ZONE MARKOUT ===");
  const candles = createSolusdCandles();
  const atr = 1.5;

  const mockStructure: MarketStructure = {
    trend: 'BEARISH',
    htfTrend: 'BEARISH',
    htfTimeframe: 'H4',
    htfReason: 'Lower Highs and Lower Lows with strong bearish displacement',
    htfAllowedDirection: 'SELL',
    swingHighs: [
      { index: 20, price: 97.00, timestamp: candles[20].timestamp, isBroken: false }
    ],
    swingLows: [
      { index: 10, price: 93.00, timestamp: candles[10].timestamp, isBroken: true, brokenByIndex: 25 }
    ],
    BOS: [
      { type: 'BEARISH_BOS', price: 93.00, candleIndex: 25, evidence: 'Broken swing low' }
    ],
    CHOCH: [],
    fairValueGaps: [
      { type: 'BEARISH_FVG', top: 96.00, bottom: 94.50, candleIndex: 22, strength: 80, isMitigated: false }
    ],
    orderBlocks: [],
    liquidityLevels: [],
    candlestickPatterns: [],
    volatilityInformation: { atr, volatilityLevel: 'Normal' },
    trendMetrics: { isTrending: true, trendStrength: 85 }
  };

  const activePrice = 89.98;
  const candidates = identifyCandidateZones(candles, mockStructure, null, activePrice);

  console.log(`Identified ${candidates.length} candidate zones.`);
  candidates.forEach((c, idx) => {
    console.log(`  Candidate ${idx + 1}: ${c.type} [${c.low} - ${c.high}], Strength: ${c.strength}, Reasoning: ${c.reasoning}`);
  });

  const bestZone = identifyMarkedZone(candles, mockStructure, null, activePrice);
  if (!bestZone) {
    throw new Error("FAIL: No zone marked!");
  }

  console.log(`\nMarked Best Zone: [${bestZone.low} - ${bestZone.high}] (${bestZone.type}) with Strength: ${bestZone.strength}`);
  
  // Assertion 1: Best zone must be the institutional origin zone at 95.30 - 97.00
  if (bestZone.high < 96.00 || bestZone.low < 95.00) {
    throw new Error(`FAIL: Expected institutional origin zone ~[95.30 - 97.00], but got [${bestZone.low} - ${bestZone.high}]`);
  }

  // Assertion 2: The micro inside candle at 90.31 - 90.51 must NOT be selected
  if (bestZone.high <= 91.00) {
    throw new Error(`FAIL: Selected micro candle near current price instead of institutional supply zone!`);
  }

  // Assertion 3: Direction must be SELL matching the BEARISH trend
  if (bestZone.direction !== 'SELL') {
    throw new Error(`FAIL: Expected direction SELL, got ${bestZone.direction}`);
  }

  console.log("✅ SUCCESS: Institutional Origin Zone [95.30 - 97.00] accurately marked and prioritized over micro candles!");
}

runTest().catch(err => {
  console.error(err);
  process.exit(1);
});
