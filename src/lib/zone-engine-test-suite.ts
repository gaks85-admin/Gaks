import {
  identifyMarkedZone,
  evaluateZoneState,
  isPriceInOrTappingZone,
  MarkedZone,
  ZoneEvaluationResult
} from './zone-engine.js';
import { Candle } from './strategy-engine.js';
import { MarketStructure } from './market-structure-engine.js';

export function runZoneEngineTestSuite(): { passed: boolean; results: { name: string; success: boolean; error?: string }[] } {
  const results: { name: string; success: boolean; error?: string }[] = [];

  function assert(condition: boolean, message: string) {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  function test(name: string, fn: () => void) {
    try {
      fn();
      results.push({ name, success: true });
    } catch (err: any) {
      results.push({ name, success: false, error: err.message });
    }
  }

  // Generate synthetic candles
  function createSyntheticCandles(basePrice: number, count: number, trend: 'UP' | 'DOWN' | 'RANGE' = 'RANGE'): Candle[] {
    const candles: Candle[] = [];
    let price = basePrice;
    const now = Date.now();

    for (let i = 0; i < count; i++) {
      const time = new Date(now - (count - i) * 15 * 60 * 1000).toISOString();
      let delta = (Math.random() - 0.5) * 0.0010;
      if (trend === 'UP') delta += 0.0005;
      if (trend === 'DOWN') delta -= 0.0005;

      const open = price;
      const close = price + delta;
      const high = Math.max(open, close) + Math.random() * 0.0004;
      const low = Math.min(open, close) - Math.random() * 0.0004;
      candles.push({ timestamp: time, open, high, low, close, volume: 1000 });
      price = close;
    }
    return candles;
  }

  // =========================================================================
  // Test 1: Discover Bullish FVG Zone
  // =========================================================================
  test('1. Should discover a Bullish FVG Zone when market structure contains bullish FVG', () => {
    const candles = createSyntheticCandles(1.1000, 30, 'UP');
    const mockStructure: MarketStructure = {
      trend: 'BULLISH',
      swingHighs: [],
      swingLows: [],
      supportZones: [],
      resistanceZones: [],
      fairValueGaps: [
        {
          type: 'BULLISH_FVG',
          top: 1.0980,
          bottom: 1.0950,
          candleIndex: 15,
          isFilled: false,
          filledPercentage: 0
        }
      ],
      BOS: [],
      CHOCH: [],
      liquiditySweeps: [],
      candlePatterns: [],
      volumeInformation: { averageVolume: 1000, latestVolume: 1200, volumeSpike: false },
      volatilityInformation: { atr: 0.0015, volatilityLevel: 'NORMAL' },
      latestCandles: candles.slice(-20)
    };

    const zone = identifyMarkedZone(candles, mockStructure, null, 1.1050);
    assert(zone !== null, 'Zone must not be null');
    assert(zone?.type === 'BULLISH_FVG', 'Zone type should be BULLISH_FVG');
    assert(zone?.direction === 'BUY', 'Zone direction should be BUY');
    assert(zone?.high === 1.0980, 'Zone high should equal FVG top');
    assert(zone?.low === 1.0950, 'Zone low should equal FVG bottom');
    assert(zone?.invalidationLevel < 1.0950, 'Invalidation level must be below zone low');
    assert(zone?.status === 'WAITING_FOR_TAP', 'Initial status must be WAITING_FOR_TAP');
  });

  // =========================================================================
  // Test 2: Discover Bearish Order Block Zone
  // =========================================================================
  test('2. Should discover Bearish Order Block Zone when bearish displacement occurs', () => {
    const candles: Candle[] = [
      { timestamp: '2026-01-01T00:00:00Z', open: 1.2000, high: 1.2020, low: 1.1990, close: 1.2010, volume: 100 },
      { timestamp: '2026-01-01T00:15:00Z', open: 1.2010, high: 1.2050, low: 1.2005, close: 1.2045, volume: 100 }, // Up candle before drop
      { timestamp: '2026-01-01T00:30:00Z', open: 1.2045, high: 1.2048, low: 1.1960, close: 1.1970, volume: 500 }, // Strong drop
      { timestamp: '2026-01-01T00:45:00Z', open: 1.1970, high: 1.1985, low: 1.1950, close: 1.1955, volume: 200 },
      { timestamp: '2026-01-01T01:00:00Z', open: 1.1955, high: 1.1960, low: 1.1940, close: 1.1945, volume: 200 }
    ];

    const mockStructure: MarketStructure = {
      trend: 'BEARISH',
      swingHighs: [{ index: 1, price: 1.2050, timestamp: '2026-01-01T00:15:00Z', isBroken: false }],
      swingLows: [],
      supportZones: [],
      resistanceZones: [],
      fairValueGaps: [],
      BOS: [],
      CHOCH: [],
      liquiditySweeps: [],
      candlePatterns: [],
      volumeInformation: { averageVolume: 200, latestVolume: 200, volumeSpike: false },
      volatilityInformation: { atr: 0.0030, volatilityLevel: 'NORMAL' },
      latestCandles: candles
    };

    const zone = identifyMarkedZone(candles, mockStructure, null, 1.1945);
    assert(zone !== null, 'Zone must be identified');
    assert(zone?.direction === 'SELL', 'Zone direction must be SELL');
    assert(zone?.high >= 1.2045, 'Zone high must capture the order block upper boundary');
    assert(zone?.invalidationLevel > zone?.high!, 'Invalidation must be above zone high for SELL');
  });

  // =========================================================================
  // Test 3: Tap Detection - Waiting vs Tapped
  // =========================================================================
  test('3. Should correctly identify WAITING vs TAPPED states based on price', () => {
    const testZone: MarkedZone = {
      id: 'test_zone_1',
      type: 'BULLISH_FVG',
      direction: 'BUY',
      high: 1.0980,
      low: 1.0950,
      invalidationLevel: 1.0930,
      strength: 85,
      createdAt: new Date().toISOString(),
      tapCount: 0,
      status: 'WAITING_FOR_TAP',
      reasoning: 'Test Bullish Zone'
    };

    // Case A: Price is far above zone -> WAITING_FOR_TAP
    const farCandle: Candle = { timestamp: '2026-01-01T02:00:00Z', open: 1.1020, high: 1.1030, low: 1.1015, close: 1.1025 };
    const evalA = evaluateZoneState(testZone, farCandle, 1.1025);
    assert(evalA.status === 'WAITING_FOR_TAP', 'Status should be WAITING_FOR_TAP');
    assert(!evalA.isTapped, 'Should not be tapped');
    assert(!evalA.isInvalidated, 'Should not be invalidated');

    // Case B: Candle low wicks into zone -> ZONE_TAPPED or CONFIRMED (if rejected)
    const tapCandle: Candle = { timestamp: '2026-01-01T02:15:00Z', open: 1.1010, high: 1.1015, low: 1.0970, close: 1.0985 };
    const evalB = evaluateZoneState(testZone, tapCandle, 1.0985);
    assert(evalB.isTapped, 'isTapped must be true');
    assert(evalB.status === 'ZONE_TAPPED' || evalB.status === 'CONFIRMED', 'Status should transition to ZONE_TAPPED or CONFIRMED');
    assert(evalB.updatedZone.tapCount === 1, 'Tap count should increment to 1');
  });

  // =========================================================================
  // Test 4: Zone Invalidation Check
  // =========================================================================
  test('4. Should transition to INVALIDATED when candle closes past invalidation level', () => {
    const testZone: MarkedZone = {
      id: 'test_zone_buy',
      type: 'BULLISH_ORDER_BLOCK',
      direction: 'BUY',
      high: 1.0980,
      low: 1.0950,
      invalidationLevel: 1.0930,
      strength: 90,
      createdAt: new Date().toISOString(),
      tapCount: 0,
      status: 'WAITING_FOR_TAP',
      reasoning: 'Test Bullish OB'
    };

    // Broken Candle: Closes at 1.0920 (below invalidation 1.0930)
    const brokenCandle: Candle = { timestamp: '2026-01-01T03:00:00Z', open: 1.0960, high: 1.0965, low: 1.0910, close: 1.0920 };
    const evalResult = evaluateZoneState(testZone, brokenCandle, 1.0920);

    assert(evalResult.status === 'INVALIDATED', 'Status must be INVALIDATED');
    assert(evalResult.isInvalidated === true, 'isInvalidated must be true');
    assert(!evalResult.isTapped, 'isTapped should be false when invalidated');
  });

  // =========================================================================
  // Test 5: Bearish Zone Invalidation Check
  // =========================================================================
  test('5. Should transition to INVALIDATED when candle closes above SELL invalidation level', () => {
    const testZoneSell: MarkedZone = {
      id: 'test_zone_sell',
      type: 'BEARISH_FVG',
      direction: 'SELL',
      high: 1.3050,
      low: 1.3020,
      invalidationLevel: 1.3070,
      strength: 88,
      createdAt: new Date().toISOString(),
      tapCount: 0,
      status: 'WAITING_FOR_TAP',
      reasoning: 'Test Bearish FVG'
    };

    // Broken Candle: Closes at 1.3085 (above invalidation 1.3070)
    const brokenCandle: Candle = { timestamp: '2026-01-01T03:00:00Z', open: 1.3040, high: 1.3090, low: 1.3030, close: 1.3085 };
    const evalResult = evaluateZoneState(testZoneSell, brokenCandle, 1.3085);

    assert(evalResult.status === 'INVALIDATED', 'Status must be INVALIDATED for broken SELL zone');
    assert(evalResult.isInvalidated === true, 'isInvalidated must be true');
  });

  // =========================================================================
  // Test 6: Runaway Price Expiration Check (Price moved away without tapping)
  // =========================================================================
  test('6. Should expire zone when price runs away in target direction without tapping', () => {
    const testZoneBuy: MarkedZone = {
      id: 'test_zone_runaway_buy',
      type: 'BULLISH_ORDER_BLOCK',
      direction: 'BUY',
      high: 1.3517,
      low: 1.3510,
      invalidationLevel: 1.3503,
      strength: 92,
      createdAt: new Date().toISOString(),
      tapCount: 0,
      status: 'WAITING_FOR_TAP',
      reasoning: 'Test Bullish OB'
    };

    // Price expands up to 1.3590 (over 70 pips above zone, without ever tapping 1.3517)
    const runawayCandle: Candle = { timestamp: '2026-01-01T04:00:00Z', open: 1.3575, high: 1.3595, low: 1.3570, close: 1.3590 };
    const evalResult = evaluateZoneState(testZoneBuy, runawayCandle, 1.3590, 0.0010);

    assert(evalResult.status === 'EXPIRED', 'Status must transition to EXPIRED when price runs away');
    assert(evalResult.isInvalidated === true, 'isInvalidated must be true so zone is cleared for a new setup');
    assert(!evalResult.isTapped, 'isTapped must be false');
  });

  // =========================================================================
  // Test 7: Stick to Entry Position Check (No Large Displacement Detected)
  // =========================================================================
  test('7. Should stick to entry position and NOT expire zone when no large candle displacement is detected', () => {
    const testZoneBuy: MarkedZone = {
      id: 'test_zone_stick_entry',
      type: 'BULLISH_ORDER_BLOCK',
      direction: 'BUY',
      high: 1.3517,
      low: 1.3510,
      invalidationLevel: 1.3503,
      strength: 90,
      createdAt: new Date().toISOString(),
      tapCount: 0,
      status: 'WAITING_FOR_TAP',
      reasoning: 'Test Bullish OB'
    };

    // Normal small candles / consolidation / minor pullback
    const normalCandle: Candle = { timestamp: '2026-01-01T04:00:00Z', open: 1.3525, high: 1.3530, low: 1.3520, close: 1.3525 };
    const bearishStructure = { trend: 'BEARISH' } as any;
    const evalResult = evaluateZoneState(testZoneBuy, normalCandle, 1.3525, 0.0010, undefined, bearishStructure);

    assert(evalResult.status === 'WAITING_FOR_TAP', 'Status must stay WAITING_FOR_TAP (sticking with entry position)');
    assert(evalResult.isInvalidated === false, 'isInvalidated must be false when no large displacement candle is detected');
    assert(!evalResult.isTapped, 'isTapped must be false');
  });

  // =========================================================================
  // Test 8: Specific Regression Test for EURUSD Bearish OB False Tap
  // =========================================================================
  test('8. Should NOT flag false positive tap when price 1.16194 is below Bearish OB [1.16264 - 1.16287]', () => {
    const now = new Date();
    const bearishOB: MarkedZone = {
      id: 'watcher_3e79f868_bearish_ob',
      type: 'BEARISH_ORDER_BLOCK',
      direction: 'SELL',
      high: 1.16287,
      low: 1.16264,
      invalidationLevel: 1.16337,
      strength: 88,
      createdAt: now.toISOString(),
      createdCandleTime: new Date(now.getTime() - 30 * 60000).toISOString(),
      displacementCandleTime: new Date(now.getTime() - 15 * 60000).toISOString(),
      displacementIndex: 2,
      tapCount: 0,
      status: 'WAITING_FOR_TAP',
      reasoning: 'Fresh Unmitigated Supply Zone / Bearish Order Block [1.16264 - 1.16287].'
    };

    // Subsequent candle trading below the supply zone (price 1.16194, high 1.16210, low 1.16180)
    const candleBelowZone: Candle = {
      timestamp: new Date(now.getTime() - 10 * 60000).toISOString(),
      open: 1.16205,
      high: 1.16210,
      low: 1.16180,
      close: 1.16194
    };

    const evalBelow = evaluateZoneState(bearishOB, candleBelowZone, 1.16194);
    assert(!evalBelow.isTapped, 'Price 1.16194 below Bearish OB must NOT be marked as tapped');
    assert(evalBelow.status === 'WAITING_FOR_TAP', 'Status must remain WAITING_FOR_TAP');
    assert(!evalBelow.isInvalidated, 'Zone must not be invalidated');

    // Subsequent candle retracing up into the Bearish OB [1.16264 - 1.16287] (high reaches 1.16275)
    const candleRetracingIntoZone: Candle = {
      timestamp: new Date(now.getTime() - 5 * 60000).toISOString(),
      open: 1.16220,
      high: 1.16275,
      low: 1.16210,
      close: 1.16250
    };

    const evalRetrace = evaluateZoneState(bearishOB, candleRetracingIntoZone, 1.16250);
    assert(evalRetrace.isTapped, 'When candle high reaches 1.16275 into zone [1.16264 - 1.16287], it MUST be tapped');
    assert(evalRetrace.updatedZone.tapCount === 1, 'Tap count should increment to 1');
  });

  // =========================================================================
  // Test 9: Strict Discipline Test - Stick with Entry Position Across Multiple Candles
  // until Large Candle Displacement Occurs
  // =========================================================================
  test('9. Should strictly hold entry position across small candles and only rule invalid upon Large Candle Displacement', () => {
    const baseTime = Date.now();
    const plannedDemandZone: MarkedZone = {
      id: 'watcher_planned_entry_demand',
      type: 'BULLISH_ORDER_BLOCK',
      direction: 'BUY',
      high: 1.1020,
      low: 1.1000,
      invalidationLevel: 1.0970,
      strength: 95,
      createdAt: new Date(baseTime - 120 * 60000).toISOString(),
      createdCandleTime: new Date(baseTime - 120 * 60000).toISOString(),
      displacementCandleTime: new Date(baseTime - 105 * 60000).toISOString(),
      displacementIndex: 1,
      tapCount: 0,
      status: 'WAITING_FOR_TAP',
      reasoning: 'H1 Bullish Order Block planned entry [1.1000 - 1.1020].'
    };

    const atr = 0.0010;

    // Series of 5 small/chop candles hovering between 1.1030 and 1.1060 (no tap, no invalidation, no large displacement)
    const smallCandles: Candle[] = [
      { timestamp: new Date(baseTime - 90 * 60000).toISOString(), open: 1.1040, high: 1.1048, low: 1.1035, close: 1.1042 },
      { timestamp: new Date(baseTime - 75 * 60000).toISOString(), open: 1.1042, high: 1.1052, low: 1.1038, close: 1.1049 },
      { timestamp: new Date(baseTime - 60 * 60000).toISOString(), open: 1.1049, high: 1.1055, low: 1.1040, close: 1.1045 },
      { timestamp: new Date(baseTime - 45 * 60000).toISOString(), open: 1.1045, high: 1.1058, low: 1.1042, close: 1.1050 },
      { timestamp: new Date(baseTime - 30 * 60000).toISOString(), open: 1.1050, high: 1.1060, low: 1.1045, close: 1.1055 }
    ];

    // Evaluate across these small candles: Must NOT change or leave entry position
    const evalSticking = evaluateZoneState(plannedDemandZone, smallCandles[smallCandles.length - 1], 1.1055, atr, smallCandles);
    assert(evalSticking.status === 'WAITING_FOR_TAP', 'Status MUST stay WAITING_FOR_TAP across small candles');
    assert(evalSticking.isInvalidated === false, 'isInvalidated MUST be false (do not leave entry position)');
    assert(!evalSticking.isTapped, 'isTapped must be false');

    // Now, a Large Bullish Displacement Candle occurs (range 0.0028 >= 1.6*ATR, strong body 0.0022, closing at 1.1078 > zone.high + 3.5*ATR)
    const largeDisplacementCandle: Candle = {
      timestamp: new Date(baseTime - 15 * 60000).toISOString(),
      open: 1.1055,
      high: 1.1080,
      low: 1.1052,
      close: 1.1078
    };
    const candlesWithDisplacement = [...smallCandles, largeDisplacementCandle];

    // Evaluate with large displacement candle: Now it can rule price is not coming back
    const evalWithDisplacement = evaluateZoneState(plannedDemandZone, largeDisplacementCandle, 1.1078, atr, candlesWithDisplacement);
    assert(evalWithDisplacement.status === 'EXPIRED', 'Status should transition to EXPIRED only after Large Candle Displacement');
    assert(evalWithDisplacement.isInvalidated === true, 'isInvalidated must be true once large displacement departs');
  });

  const allPassed = results.every(r => r.success);
  return { passed: allPassed, results };
}

// Auto-run if executed directly
const res = runZoneEngineTestSuite();
console.log(`[ZONE ENGINE TEST SUITE] Passed: ${res.passed}`);
res.results.forEach(r => console.log(`  - ${r.name}: ${r.success ? 'PASSED' : 'FAILED: ' + r.error}`));
