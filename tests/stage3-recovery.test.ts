import { 
  evaluateZoneState, 
  identifyCandidateZones, 
  MarkedZone, 
  Candle,
  recordRejectedZone,
  getRejectedZones,
  clearRejectedZones
} from '../src/lib/zone-engine.js';
import { MarketStructure } from '../src/lib/market-structure-engine.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[TEST FAILED] ${message}`);
  }
}

console.log('=== RUNNING STAGE 3: STRUCTURAL ZONE DISCOVERY & RECOVERY TESTS ===');

// --- Test 1: Zone survival on SIDEWAYS condition ---
// This is mainly logic in the handler, but we can verify evaluateZoneState doesn't invalidate on sideways trend alone.
{
  const zone: MarkedZone = {
    id: 'test_zone_1',
    type: 'BULLISH_ORDER_BLOCK',
    direction: 'BUY',
    high: 1.1020,
    low: 1.1010,
    invalidationLevel: 1.1000,
    strength: 90,
    createdAt: new Date().toISOString(),
    status: 'WAITING_FOR_TAP',
    reasoning: 'Test zone',
    tapCount: 0
  };

  const currentCandle: Candle = {
    timestamp: '2026-11-04T10:00:00.000Z',
    open: 1.1030,
    high: 1.1040,
    low: 1.1025,
    close: 1.1035,
    volume: 100
  };

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
    volatilityInformation: { atr: 0.0010, volatility: 'NORMAL' },
    volumeInformation: { volumeSpike: false, currentVolume: 100, averageVolume: 100 },
    htfTrend: 'SIDEWAYS'
  };

  const result = evaluateZoneState(zone, currentCandle, 1.1035, 0.0010, [currentCandle], marketStructure);
  
  assert(result.status === 'WAITING_FOR_TAP', `Expected status WAITING_FOR_TAP, got ${result.status}`);
  assert(result.isInvalidated === false, 'Zone should not be invalidated by SIDEWAYS market structure');
  console.log('✅ Test 1 Passed: Zone survives SIDEWAYS condition in evaluateZoneState.');
}

// --- Test 2: Displacement Tracking on EXPIRED_WITHOUT_ENTRY ---
{
  const zone: MarkedZone = {
    id: 'test_zone_2',
    type: 'BULLISH_ORDER_BLOCK',
    direction: 'BUY',
    high: 1.1020,
    low: 1.1010,
    invalidationLevel: 1.1000,
    strength: 90,
    createdAt: new Date().toISOString(),
    createdCandleTime: '2026-11-04T09:00:00.000Z',
    status: 'WAITING_FOR_TAP',
    reasoning: 'Test zone',
    tapCount: 0
  };

  // Large displacement candle (range = 0.0030, ATR = 0.0010, range = 3.0 * ATR)
  // Departed far: close = 1.1020 + 3.5 * 0.0010 = 1.1055
  const largeCandle: Candle = {
    timestamp: '2026-11-04T10:00:00.000Z',
    open: 1.1030,
    high: 1.1070,
    low: 1.1025,
    close: 1.1065,
    volume: 1000
  };

  const result = evaluateZoneState(zone, largeCandle, 1.1065, 0.0010, [largeCandle]);
  
  assert(result.status === 'EXPIRED_WITHOUT_ENTRY', `Expected EXPIRED_WITHOUT_ENTRY, got ${result.status}`);
  assert(result.isInvalidated === false, 'EXPIRED_WITHOUT_ENTRY is not a SL breach, but status triggers recovery in handlers');
  assert(result.displacementOrigin !== undefined, 'Displacement origin should be recorded');
  assert(result.displacementOrigin?.direction === 'BULLISH', 'Direction should be BULLISH');
  assert(result.updatedZone.displacementOrigin !== undefined, 'Updated zone should carry displacement origin');
  
  console.log('✅ Test 2 Passed: Displacement origin correctly tracked on EXPIRED_WITHOUT_ENTRY.');
}

// --- Test 3: Immediate Recovery excludes rejected level ---
{
  const watcherId = 'watcher_recovery_test';
  clearRejectedZones(watcherId);

  const invalidatedZone: MarkedZone = {
    id: 'invalid_zone_1',
    type: 'BULLISH_ORDER_BLOCK',
    direction: 'BUY',
    high: 1.1020,
    low: 1.1010,
    invalidationLevel: 1.1000,
    strength: 90,
    createdAt: new Date().toISOString(),
    status: 'INVALIDATED',
    reasoning: 'Breached',
    tapCount: 0
  };

  recordRejectedZone(watcherId, invalidatedZone, 'Breached in test');

  const candles: Candle[] = [
    { timestamp: '2026-11-04T09:00:00.000Z', open: 1.1005, high: 1.1020, low: 1.1010, close: 1.1015, volume: 500 }
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
    volatilityInformation: { atr: 0.0010, volatility: 'NORMAL' },
    volumeInformation: { volumeSpike: false, currentVolume: 100, averageVolume: 100 }
  };

  const rejectedList = getRejectedZones(watcherId);
  const candidates = identifyCandidateZones(candles, marketStructure, null, 1.1015, rejectedList);
  
  // Even if the candles structure still looks like an OB at 1.1010-1.1020, it should be excluded
  const isSelected = candidates.some(c => c.low === invalidatedZone.low && c.high === invalidatedZone.high);
  assert(!isSelected, 'Invalidated zone level should be excluded from immediate re-discovery');
  
  console.log('✅ Test 3 Passed: Immediate recovery correctly excludes the recently invalidated level.');
}

// --- Test 4: Unified Consistency (Manual check of implementation) ---
console.log('ℹ️ Test 4: Manual Verification - market-watcher.ts and scan.ts now both use globalThis.__activeWatcherZones.');

// --- Test 5: SIDEWAYS trend blocks new zone creation ---
{
  const candles: Candle[] = [
    { timestamp: '2026-11-04T09:00:00.000Z', open: 1.1005, high: 1.1020, low: 1.1010, close: 1.1015, volume: 500 }
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
    volatilityInformation: { atr: 0.0010, volatility: 'NORMAL' },
    volumeInformation: { volumeSpike: false, currentVolume: 100, averageVolume: 100 },
    htfTrend: 'SIDEWAYS'
  };

  const candidates = identifyCandidateZones(candles, marketStructure, null, 1.1015);
  assert(candidates.length === 0, 'New zone creation should be blocked by SIDEWAYS HTF trend');
  console.log('✅ Test 5 Passed: SIDEWAYS HTF trend correctly blocks new zone creation.');
}

// --- Test 6: Rejected memory does NOT block different level ---
{
  const watcherId = 'watcher_rejection_isolation_test';
  clearRejectedZones(watcherId);

  const rejectedZone: MarkedZone = {
    id: 'rejected_1',
    type: 'BULLISH_ORDER_BLOCK',
    direction: 'BUY',
    high: 1.1020,
    low: 1.1010,
    invalidationLevel: 1.1000,
    strength: 90,
    createdAt: new Date().toISOString(),
    status: 'INVALIDATED',
    reasoning: 'Rejected',
    tapCount: 0
  };

  recordRejectedZone(watcherId, rejectedZone, 'Test rejection');

  // New candles at a completely different price level
  // Stabilize ATR first with small candles
  const differentLevelCandles: Candle[] = [
    { timestamp: '2026-11-04T10:15:00.000Z', open: 1.1060, high: 1.1062, low: 1.1058, close: 1.1060, volume: 100 },
    { timestamp: '2026-11-04T10:30:00.000Z', open: 1.1060, high: 1.1062, low: 1.1058, close: 1.1060, volume: 100 },
    // Candle: Down candle (Demand base)
    { timestamp: '2026-11-04T10:45:00.000Z', open: 1.1060, high: 1.1065, low: 1.1050, close: 1.1055, volume: 100 },
    // Candle: Strong Upward displacement
    { timestamp: '2026-11-04T11:00:00.000Z', open: 1.1055, high: 1.1100, low: 1.1055, close: 1.1100, volume: 500 }
  ];

  const activePrice = 1.1100;

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
    volatilityInformation: { atr: 0.0010, volatility: 'NORMAL' },
    volumeInformation: { volumeSpike: false, currentVolume: 100, averageVolume: 100 }
  };

  const rejectedList = getRejectedZones(watcherId);
  const candidatesRaw = identifyCandidateZones(differentLevelCandles, marketStructure, null, activePrice);
  console.log(`[DEBUG] Candidates before rejection filter: ${candidatesRaw.length}`);
  if (candidatesRaw.length > 0) {
    console.log(`[DEBUG] Candidate 0: low=${candidatesRaw[0].low}, high=${candidatesRaw[0].high}`);
  }

  const candidates = identifyCandidateZones(differentLevelCandles, marketStructure, null, activePrice, rejectedList);
  console.log(`[DEBUG] Candidates after rejection filter: ${candidates.length}`);
  
  assert(candidates.length > 0, 'Rejected zone memory should not block a genuinely different POI level');
  assert(candidates[0].low === 1.1050, `Expected new level 1.1050, got ${candidates[0].low}`);
  console.log('✅ Test 6 Passed: Rejected-zone memory does not block genuinely different valid replacements.');
}

console.log('=== ALL STAGE 3 RECOVERY TESTS PASSED ===');
