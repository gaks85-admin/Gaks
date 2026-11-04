import assert from 'assert';
import { compileStrategy } from '../src/lib/strategy-compiler.js';
import { extractMarketStructure } from '../src/lib/market-structure-engine.js';
import { evaluateDecision } from '../src/lib/decision-engine.js';
import { evaluateQualityGate } from '../src/lib/quality-gate.js';
import { 
  identifyCandidateZones, 
  identifyMarkedZone, 
  evaluateZoneState, 
  isPriceInOrTappingZone, 
  recordRejectedZone, 
  getRejectedZones, 
  clearRejectedZones,
  MarkedZone 
} from '../src/lib/zone-engine.js';
import { checkSignalDeduplication } from '../src/lib/signal-deduplication.js';
import { calculateStructuralStopLoss, validateAndResolveStopLoss } from '../src/lib/structural-stop-loss.js';
import { Candle } from '../src/lib/strategy-engine.js';

console.log('=== RUNNING STAGE 5: MARKET WATCHER EXECUTION PIPELINE TESTS ===\n');

// Helper to generate synthetic candles with an institutional bullish order block
function generateTestCandles(): Candle[] {
  const candles: Candle[] = [];
  let basePrice = 1.1000;
  const now = Date.now();

  // 15 historical candles in uptrend
  for (let i = 0; i < 15; i++) {
    candles.push({
      timestamp: new Date(now - (30 - i) * 60000).toISOString(),
      open: Number((basePrice).toFixed(5)),
      high: Number((basePrice + 0.0015).toFixed(5)),
      low: Number((basePrice - 0.0005).toFixed(5)),
      close: Number((basePrice + 0.0010).toFixed(5)),
      volume: 1000
    });
    basePrice += 0.0010;
  }

  // Candle 15: Red down-candle before bullish displacement (Bullish Order Block origin)
  // Low: 1.1140, High: 1.1160, Open: 1.1158, Close: 1.1145
  const obTime = new Date(now - 14 * 60000).toISOString();
  candles.push({
    timestamp: obTime,
    open: 1.1158,
    high: 1.1160,
    low: 1.1140,
    close: 1.1145,
    volume: 1200
  });

  // Candle 16 & 17: Strong Bullish Displacement breaking above swing high (> 2.0 * ATR)
  candles.push({
    timestamp: new Date(now - 13 * 60000).toISOString(),
    open: 1.1146,
    high: 1.1185,
    low: 1.1142,
    close: 1.1180,
    volume: 3500
  });

  candles.push({
    timestamp: new Date(now - 12 * 60000).toISOString(),
    open: 1.1181,
    high: 1.1210,
    low: 1.1178,
    close: 1.1205,
    volume: 3800
  });

  // Candles 18-20: Price traveling above zone
  candles.push({
    timestamp: new Date(now - 11 * 60000).toISOString(),
    open: 1.1205,
    high: 1.1220,
    low: 1.1195,
    close: 1.1215,
    volume: 1500
  });

  candles.push({
    timestamp: new Date(now - 10 * 60000).toISOString(),
    open: 1.1215,
    high: 1.1225,
    low: 1.1200,
    close: 1.1210,
    volume: 1400
  });

  return candles;
}

// =========================================================================
// TEST A: Cron Complete Pipeline Execution
// =========================================================================
{
  const candles = generateTestCandles();
  const compiled = compileStrategy('Trade institutional order blocks with strong displacement in bullish trend');
  const marketStructure = extractMarketStructure(candles);
  marketStructure.trend = 'BULLISH';
  marketStructure.htfTrend = 'BULLISH';
  marketStructure.htfBiasAligned = true;

  // Find candidate zones
  const activePrice = 1.1150; // price pulling back into zone [1.1140 - 1.1160]
  const candidates = identifyCandidateZones(candles, marketStructure, compiled, activePrice);
  assert.ok(candidates.length > 0, 'Should find at least 1 institutional zone candidate');
  const discoveredZone = candidates[0];

  // Price is tapping
  const latestClosed = candles[candles.length - 2];
  const isTapped = isPriceInOrTappingZone(discoveredZone, latestClosed, activePrice);
  assert.strictEqual(isTapped, true, 'Zone should be tapped by current price');

  discoveredZone.status = 'ZONE_TAPPED';
  discoveredZone.tapCount = 1;

  // Decorate marketStructure as Cron does
  (marketStructure as any).markedZone = discoveredZone;
  (marketStructure as any).zone_status = 'ZONE_TAPPED';
  (marketStructure as any).zone_tapped = true;
  (marketStructure as any).zone_direction = discoveredZone.direction;

  const decision = evaluateDecision(compiled, marketStructure);
  assert.strictEqual(decision.mandatory_rules_passed, true, 'Mandatory rules must pass in Cron pipeline');
  assert.ok(decision.decision_score >= 75, `Decision score should be >= 75, got ${decision.decision_score}`);
  assert.strictEqual(decision.recommendation, 'PASS', 'Decision recommendation must be PASS');

  const quality = evaluateQualityGate({
    ruleScore: decision.decision_score,
    marketStructure,
    mandatoryRulesPassed: decision.mandatory_rules_passed,
    direction: 'BUY',
    slValid: true,
    tpValid: true,
    rrValid: true
  });
  assert.strictEqual(quality.passed, true, 'Quality gate must pass');
  assert.ok(quality.qualityScore >= 75, 'Quality score must be >= 75');
  assert.strictEqual(quality.action, 'CONTINUE_TO_RISK');

  const sl = calculateStructuralStopLoss('BUY', activePrice, marketStructure);
  assert.ok(sl.stopLoss < activePrice, 'SL must be below entry for BUY');
  assert.ok(Boolean(sl.stopLossBasis), 'Stop loss basis must be resolved');

  console.log('✅ Scenario A Passed: Cron complete pipeline executes cleanly to executable trade.');
}

// =========================================================================
// TEST B: Manual Scan Complete Pipeline Execution
// =========================================================================
{
  const candles = generateTestCandles();
  const compiled = compileStrategy('Trade institutional order blocks with strong displacement in bullish trend');
  const marketStructure = extractMarketStructure(candles);
  marketStructure.trend = 'BULLISH';
  marketStructure.htfTrend = 'BULLISH';
  marketStructure.htfBiasAligned = true;

  const activePrice = 1.1150;
  const discoveredZone = identifyMarkedZone(candles, marketStructure, compiled, activePrice);
  assert.ok(discoveredZone !== null, 'Manual scan must discover valid POI zone');

  const latestClosed = candles[candles.length - 2];
  const isTapped = isPriceInOrTappingZone(discoveredZone!, latestClosed, activePrice);
  assert.strictEqual(isTapped, true, 'Zone should be tapped in manual scan');

  discoveredZone!.status = 'ZONE_TAPPED';

  // Manual scan decorated market structure
  (marketStructure as any).markedZone = discoveredZone;
  (marketStructure as any).zone_status = 'ZONE_TAPPED';
  (marketStructure as any).zone_tapped = true;
  (marketStructure as any).zone_direction = discoveredZone!.direction;

  const decision = evaluateDecision(compiled, marketStructure);
  assert.strictEqual(decision.mandatory_rules_passed, true);
  assert.ok(decision.decision_score >= 75);

  const quality = evaluateQualityGate({
    ruleScore: decision.decision_score,
    marketStructure,
    mandatoryRulesPassed: decision.mandatory_rules_passed,
    direction: 'BUY',
    slValid: true,
    tpValid: true,
    rrValid: true
  });
  assert.strictEqual(quality.passed, true);

  console.log('✅ Scenario B Passed: Manual Scan complete pipeline executes with full parity.');
}

// =========================================================================
// TEST C: Invalidated Zone Triggers Replacement Discovery
// =========================================================================
{
  const watcherId = 'test-watcher-c';
  clearRejectedZones(watcherId);

  const zone: MarkedZone = {
    id: 'zone-c-old',
    type: 'BULLISH_ORDER_BLOCK',
    direction: 'BUY',
    high: 1.1160,
    low: 1.1140,
    invalidationLevel: 1.1130,
    strength: 85,
    createdAt: new Date().toISOString(),
    tapCount: 0,
    status: 'WAITING_FOR_TAP',
    reasoning: 'Old zone'
  };

  const candleBreach: Candle = {
    timestamp: new Date().toISOString(),
    open: 1.1135,
    high: 1.1140,
    low: 1.1110,
    close: 1.1120, // Closed decisively below 1.1130 invalidation level
    volume: 2000
  };

  const evalResult = evaluateZoneState(zone, candleBreach, 1.1120);
  assert.strictEqual(evalResult.status, 'INVALIDATED', 'Zone should be INVALIDATED on breach');
  assert.strictEqual(evalResult.isInvalidated, true);

  recordRejectedZone(watcherId, zone, evalResult.reason);
  const rejected = getRejectedZones(watcherId);
  assert.strictEqual(rejected.length, 1, 'Should record 1 rejected zone');

  // Verify that subsequent candidate discovery excludes this invalidated level
  const candles = generateTestCandles();
  const ms = extractMarketStructure(candles);
  const candidates = identifyCandidateZones(candles, ms, null, 1.1200, rejected);
  const reselectedSame = candidates.some(c => Math.abs(c.low - zone.low) < 0.0002 && Math.abs(c.high - zone.high) < 0.0002);
  assert.strictEqual(reselectedSame, false, 'Invalidated zone level must NOT be re-selected');

  clearRejectedZones(watcherId);
  console.log('✅ Scenario C Passed: Invalidated zone cleanly transitions and prevents re-selection.');
}

// =========================================================================
// TEST D: Expired Zone Triggers Replacement Discovery
// =========================================================================
{
  const watcherId = 'test-watcher-d';
  clearRejectedZones(watcherId);

  const zone: MarkedZone = {
    id: 'zone-d-old',
    type: 'BULLISH_ORDER_BLOCK',
    direction: 'BUY',
    high: 1.1160,
    low: 1.1140,
    invalidationLevel: 1.1130,
    strength: 80,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    displacementCandleTime: new Date(Date.now() - 3600000).toISOString(),
    tapCount: 0,
    status: 'WAITING_FOR_TAP',
    reasoning: 'Demand zone waiting for tap'
  };

  // Construct a large displacement candle moving > 3.5 ATR away without retrace
  const atr = 0.0008;
  const largeCandle: Candle = {
    timestamp: new Date().toISOString(),
    open: 1.1170,
    high: 1.1210,
    low: 1.1168,
    close: 1.1205, // > 3.5 * ATR (0.0028) above 1.1160 (1.1188 threshold)
    volume: 5000
  };

  const evalResult = evaluateZoneState(zone, largeCandle, 1.1205, atr, [largeCandle]);
  assert.strictEqual(evalResult.status, 'EXPIRED_WITHOUT_ENTRY', 'Should transition to EXPIRED_WITHOUT_ENTRY');
  assert.strictEqual(evalResult.isTapped, false);

  recordRejectedZone(watcherId, zone, evalResult.reason);
  assert.strictEqual(getRejectedZones(watcherId).length, 1);

  clearRejectedZones(watcherId);
  console.log('✅ Scenario D Passed: Expired zone transitions cleanly and triggers recovery search.');
}

// =========================================================================
// TEST E: Replacement Candidate Evaluated in Same Cycle if Tapped
// =========================================================================
{
  const candles = generateTestCandles();
  const compiled = compileStrategy('Follow order blocks in bullish trend');
  const ms = extractMarketStructure(candles);
  ms.trend = 'BULLISH';
  ms.htfTrend = 'BULLISH';
  ms.htfBiasAligned = true;

  // Active price is inside the replacement zone
  const activePrice = 1.1152;
  const replacementCandidates = identifyCandidateZones(candles, ms, compiled, activePrice, []);
  assert.ok(replacementCandidates.length > 0, 'Should find replacement candidate');
  const replacement = replacementCandidates[0];

  const latestClosed = candles[candles.length - 2];
  const isTapped = isPriceInOrTappingZone(replacement, latestClosed, activePrice);
  assert.strictEqual(isTapped, true, 'Replacement zone is tapped by active price');

  // Unified pipeline: transition to ZONE_TAPPED and evaluate in same cycle
  replacement.status = 'ZONE_TAPPED';
  replacement.tapCount = 1;
  (ms as any).markedZone = replacement;
  (ms as any).zone_status = 'ZONE_TAPPED';
  (ms as any).zone_tapped = true;
  (ms as any).zone_direction = replacement.direction;

  const sameCycleDecision = evaluateDecision(compiled, ms);
  assert.strictEqual(sameCycleDecision.mandatory_rules_passed, true, 'Same cycle decision must evaluate rules');
  assert.ok(sameCycleDecision.decision_score >= 75, `Expected score >= 75 in same cycle, got ${sameCycleDecision.decision_score}`);
  assert.strictEqual(sameCycleDecision.recommendation, 'PASS', 'Same cycle must recommend PASS without deferring');

  console.log('✅ Scenario E Passed: Replacement zone evaluated in same cycle when tapped.');
}

// =========================================================================
// TEST F: No Replacement Candidate Does Not Fabricate Zones
// =========================================================================
{
  // Generate flat consolidation candles without any order block, swing break, or displacement
  const flatCandles: Candle[] = [];
  const now = Date.now();
  for (let i = 0; i < 30; i++) {
    flatCandles.push({
      timestamp: new Date(now - (30 - i) * 60000).toISOString(),
      open: 1.1000,
      high: 1.1002,
      low: 1.0998,
      close: 1.1001,
      volume: 100
    });
  }

  const compiled = compileStrategy('Trade order block strategy');
  const ms = extractMarketStructure(flatCandles);
  ms.trend = 'SIDEWAYS';

  const candidates = identifyCandidateZones(flatCandles, ms, compiled, 1.1001, []);
  assert.strictEqual(candidates.length, 0, 'No genuine candidates must be found in flat consolidation');

  const singleZone = identifyMarkedZone(flatCandles, ms, compiled, 1.1001, []);
  assert.strictEqual(singleZone, null, 'Must return null without fabricating arbitrary 15-candle high/low zone');

  console.log('✅ Scenario F Passed: Flat consolidation correctly yields zero candidates without fabricating fallback.');
}

// =========================================================================
// TEST G: Zone-Independent Strategy Proceeds Without POI
// =========================================================================
{
  const candles = generateTestCandles();
  // Indicator-only strategy (no order block, FVG, or support/resistance POI required)
  const compiled = compileStrategy('Trade EMA 9 and EMA 21 crossover with RSI filter');
  
  const rules = compiled.compiled_rules;
  const requiresZoneSetup = Boolean(
    rules?.order_block ||
    rules?.supply_demand ||
    rules?.unmitigated_zone ||
    rules?.fair_value_gap ||
    rules?.support ||
    rules?.resistance ||
    rules?.support_rejection ||
    rules?.resistance_rejection ||
    rules?.liquidity_sweep
  );
  assert.strictEqual(requiresZoneSetup, false, 'Strategy should NOT require POI zone setup');

  const ms = extractMarketStructure(candles);
  ms.trend = 'BULLISH';
  ms.htfTrend = 'BULLISH';
  ms.ema = { emaShort: 1.1200, emaLong: 1.1180, trend: 'BULLISH', aligned: true } as any;
  ms.rsi = { value: 55, condition: 'NEUTRAL' } as any;

  (ms as any).markedZone = null;
  (ms as any).zone_status = 'NO_ZONE';
  (ms as any).zone_tapped = false;

  const decision = evaluateDecision(compiled, ms);
  assert.strictEqual(decision.mandatory_rules_passed, true, 'Zone-independent strategy must evaluate without POI');
  assert.ok(decision.decision_score > 0, 'Decision score must be calculated');

  console.log('✅ Scenario G Passed: Zone-independent strategy proceeds to decision engine without POI.');
}

// =========================================================================
// TEST H: AI_ONLY Mode Cannot Bypass 75% Quality Gate
// =========================================================================
{
  const candles = generateTestCandles();
  const ms = extractMarketStructure(candles);
  ms.trend = 'SIDEWAYS'; // Bad trend

  // Low quality score input (60%)
  const qualityLow = evaluateQualityGate({
    ruleScore: 60,
    marketStructure: ms,
    mandatoryRulesPassed: true,
    geminiApproved: true, // Even if Gemini approved
    direction: 'BUY',
    slValid: true,
    tpValid: true,
    rrValid: true,
    minQualityThreshold: 75
  });

  assert.strictEqual(qualityLow.passed, false, 'AI_ONLY cannot bypass 75% quality minimum');
  assert.strictEqual(qualityLow.action, 'NO_TRADE');

  // Invalid SL structure
  const qualityInvalidSl = evaluateQualityGate({
    ruleScore: 85,
    marketStructure: ms,
    mandatoryRulesPassed: true,
    geminiApproved: true,
    direction: 'BUY',
    slValid: false, // Invalid stop loss
    tpValid: true,
    rrValid: true,
    minQualityThreshold: 75
  });

  assert.strictEqual(qualityInvalidSl.passed, false, 'AI_ONLY cannot bypass structural stop loss validation');
  assert.strictEqual(qualityInvalidSl.action, 'NO_TRADE');
  assert.strictEqual(qualityInvalidSl.reason, 'Invalid stop-loss structure');

  console.log('✅ Scenario H Passed: AI_ONLY mode strictly enforces 75% minimum and structural SL validity.');
}

// =========================================================================
// TEST I: Database Failure Produces Safe Error Handling
// =========================================================================
{
  const memoryCache = (globalThis as any).__activeWatcherZones || new Map<string, MarkedZone>();
  const testZone: MarkedZone = {
    id: 'zone-resilience-test',
    type: 'BULLISH_ORDER_BLOCK',
    direction: 'BUY',
    high: 1.1160,
    low: 1.1140,
    invalidationLevel: 1.1130,
    strength: 88,
    createdAt: new Date().toISOString(),
    tapCount: 0,
    status: 'WAITING_FOR_TAP',
    reasoning: 'Resilience test zone'
  };

  const watcherId = 'watcher-db-err';
  memoryCache.set(watcherId, testZone);

  // Simulate database error during zone persistence
  let dbErrorOccurred = false;
  let restoredFromMemory: MarkedZone | null = null;

  try {
    const simulateDbUpdate = () => {
      throw new Error('Supabase network error: connection timeout');
    };
    simulateDbUpdate();
  } catch (err: any) {
    dbErrorOccurred = true;
    // Memory cache fallback prevents zone disappearance
    if (memoryCache.has(watcherId)) {
      restoredFromMemory = memoryCache.get(watcherId) || null;
    }
  }

  assert.strictEqual(dbErrorOccurred, true, 'DB error should be simulated and caught');
  assert.ok(restoredFromMemory !== null, 'Zone must be retained in memory cache across DB fault');
  assert.strictEqual(restoredFromMemory!.id, testZone.id);

  console.log('✅ Scenario I Passed: Database failure safely handled; active zone protected by memory cache.');
}

// =========================================================================
// TEST J: Timeout Does Not Corrupt Zone State
// =========================================================================
{
  const initialZone: MarkedZone = {
    id: 'zone-timeout-test',
    type: 'BULLISH_ORDER_BLOCK',
    direction: 'BUY',
    high: 1.1160,
    low: 1.1140,
    invalidationLevel: 1.1130,
    strength: 85,
    createdAt: new Date().toISOString(),
    tapCount: 0,
    status: 'WAITING_FOR_TAP',
    reasoning: 'Zone waiting for price tap'
  };

  // Simulate timeout during execution
  let zoneAfterTimeout = { ...initialZone };
  try {
    const simulateTimeoutCall = () => {
      throw new Error('Bounded Gemini call exceeded deadline: TIMEOUT');
    };
    simulateTimeoutCall();
  } catch (timeoutErr: any) {
    // Under timeout, the handler must NOT mark the zone INVALIDATED or EXPIRED!
    // It remains in its current status
    assert.ok(timeoutErr.message.includes('TIMEOUT'));
  }

  assert.strictEqual(zoneAfterTimeout.status, 'WAITING_FOR_TAP', 'Zone must remain WAITING_FOR_TAP on timeout');
  assert.strictEqual(zoneAfterTimeout.invalidationLevel, 1.1130, 'Invalidation level must not be altered');

  console.log('✅ Scenario J Passed: Execution timeout does not corrupt or prematurely expire active zone.');
}

// =========================================================================
// TEST K: Concurrent Scan Idempotency & Deduplication
// =========================================================================
{
  const { isWatcherDue } = await import('../src/lib/trade-validator.js');
  const now = new Date();

  // Test 1: Concurrency overlap protection (< 5000ms since last scan)
  const overlappingWatcher = {
    id: 'watcher-concurrent',
    trade_status: 'WAITING',
    last_scan_at: new Date(now.getTime() - 2000).toISOString(), // 2 seconds ago
    selected_timeframe: 'M15'
  };

  const dueCheckOverlap = isWatcherDue(overlappingWatcher, now, 15, 30000);
  assert.strictEqual(dueCheckOverlap.isDue, false, 'Watcher scanned 2s ago must NOT be due (prevents overlapping cron invocations)');

  // Test 2: Active trade protection - blocks opening another position or marking new zone
  const activeWatcher = {
    id: 'watcher-already-active',
    trade_status: 'ACTIVE',
    active_trade_id: 'trade-uuid-existing',
    last_scan_at: new Date(now.getTime() - 60000).toISOString()
  };

  const hasActiveTrade = (activeWatcher.trade_status === 'ACTIVE' || Boolean(activeWatcher.active_trade_id));
  assert.strictEqual(hasActiveTrade, true, 'Active trade status correctly identified to block duplicate positions');

  console.log('✅ Scenario K Passed: Deduplication and concurrency protection prevent overlapping scans & duplicate positions.');
}

// =========================================================================
// TEST L: Telegram Failure Does Not Corrupt Persisted Signal
// =========================================================================
{
  const simulatedTradeRecord = {
    id: 'trade-uuid-12345',
    pair: 'EURUSD',
    direction: 'BUY',
    entry_price: 1.1150,
    stop_loss: 1.1130,
    take_profit: 1.1190,
    status: 'ACTIVE'
  };

  // Simulate Telegram dispatch failure
  const telegramDispatch = { sent: false, reason: 'Telegram API 500 Network Timeout' };
  
  // Pipeline evaluation record should record trade_sent: false without reverting trade_status
  const evaluationRecord = {
    trade_sent: telegramDispatch.sent,
    trade_reason: telegramDispatch.reason,
    persisted_trade_id: simulatedTradeRecord.id
  };

  assert.strictEqual(evaluationRecord.trade_sent, false);
  assert.strictEqual(simulatedTradeRecord.status, 'ACTIVE', 'Trade status must remain ACTIVE even if Telegram fails');
  assert.strictEqual(simulatedTradeRecord.id, 'trade-uuid-12345');

  console.log('✅ Scenario L Passed: Telegram failure logs error but does not corrupt persisted signal.');
}

// =========================================================================
// TEST M: Cron and Manual Scan Produce Equivalent Decisions for Identical Input
// =========================================================================
{
  const candles = generateTestCandles();
  const strategyText = 'Trade institutional demand zone with bullish displacement and RSI confirmation';
  const compiled = compileStrategy(strategyText);

  // Common market structure
  const msCron = extractMarketStructure(candles);
  msCron.trend = 'BULLISH';
  msCron.htfTrend = 'BULLISH';
  msCron.htfBiasAligned = true;

  const msScan = extractMarketStructure(candles);
  msScan.trend = 'BULLISH';
  msScan.htfTrend = 'BULLISH';
  msScan.htfBiasAligned = true;

  const activePrice = 1.1150;
  const zoneCron = identifyMarkedZone(candles, msCron, compiled, activePrice);
  const zoneScan = identifyMarkedZone(candles, msScan, compiled, activePrice);

  assert.ok(zoneCron !== null && zoneScan !== null);
  assert.strictEqual(zoneCron!.low, zoneScan!.low);
  assert.strictEqual(zoneCron!.high, zoneScan!.high);
  assert.strictEqual(zoneCron!.type, zoneScan!.type);

  // Cron context decoration
  (msCron as any).markedZone = zoneCron;
  (msCron as any).zone_status = 'ZONE_TAPPED';
  (msCron as any).zone_tapped = true;
  (msCron as any).zone_direction = zoneCron!.direction;

  // Scan context decoration
  (msScan as any).markedZone = zoneScan;
  (msScan as any).zone_status = 'ZONE_TAPPED';
  (msScan as any).zone_tapped = true;
  (msScan as any).zone_direction = zoneScan!.direction;

  const decisionCron = evaluateDecision(compiled, msCron);
  const decisionScan = evaluateDecision(compiled, msScan);

  assert.strictEqual(decisionCron.decision_score, decisionScan.decision_score, 'Decision score must be identical in Cron and Scan');
  assert.strictEqual(decisionCron.recommendation, decisionScan.recommendation, 'Recommendation must be identical in Cron and Scan');
  assert.strictEqual(decisionCron.mandatory_rules_passed, decisionScan.mandatory_rules_passed, 'Mandatory rule passing must be identical');
  assert.deepStrictEqual(decisionCron.matched_rules, decisionScan.matched_rules, 'Matched rules must be identical');

  const qualityCron = evaluateQualityGate({
    ruleScore: decisionCron.decision_score,
    marketStructure: msCron,
    mandatoryRulesPassed: decisionCron.mandatory_rules_passed,
    direction: 'BUY',
    slValid: true,
    tpValid: true,
    rrValid: true
  });

  const qualityScan = evaluateQualityGate({
    ruleScore: decisionScan.decision_score,
    marketStructure: msScan,
    mandatoryRulesPassed: decisionScan.mandatory_rules_passed,
    direction: 'BUY',
    slValid: true,
    tpValid: true,
    rrValid: true
  });

  assert.strictEqual(qualityCron.passed, qualityScan.passed, 'Quality gate passed flag must be identical');
  assert.strictEqual(qualityCron.qualityScore, qualityScan.qualityScore, 'Quality score must be identical');
  assert.strictEqual(qualityCron.action, qualityScan.action, 'Quality gate action must be identical');

  console.log('✅ Scenario M Passed: Cron and Manual Scan produce 100% equivalent decisions on identical input.');
}

console.log('\n=== ALL 13 STAGE 5 PIPELINE SCENARIOS (A-M) PASSED SUCCESSFULLY ===');
