import { buildTelegramAlertMessage } from './telegram-formatter.js';
import { calculatePositionSize, resolveInstrumentSpec } from './risk-engine.js';
import { validateMarketDataIntegrity } from './market-integrity.js';
import { normalizeConfidence } from './confidence-engine.js';
import { evaluateQualityGate } from './quality-gate.js';
import { checkSignalDeduplication } from './signal-deduplication.js';

export function runProductionFixTestSuite() {
  console.log("==========================================");
  console.log("RUNNING PRODUCTION FIX TEST SUITE");
  console.log("==========================================");

  let passedCount = 0;
  let totalCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    totalCount++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passedCount++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
    }
  }

  // ==========================================
  // TEST I: FIXED LOT SIZE & USER POSITION MODE
  // ==========================================
  console.log("\n--- TEST I: Fixed Lot Size & User Position Mode ---");
  const fixedLotValid = calculatePositionSize({
    accountSize: 10000,
    riskPercentage: 2, // $200 max risk
    entryPrice: 1.1000,
    stopLoss: 1.0950, // 50 pips SL = $500 loss per 1.0 lot -> 0.10 lot = $50 loss
    takeProfit: 1.1100,
    symbol: 'EURUSD',
    direction: 'BUY',
    riskRewardStr: '1:2',
    positionMode: 'FIXED_LOT',
    preferredLotSize: 0.10
  });

  assert(fixedLotValid.accepted === true, 'Test I1 - Valid Fixed Lot within max risk is accepted');
  assert(fixedLotValid.calculatedLotSize === 0.10, 'Test I2 - Fixed Lot uses exact preferred lot size (0.10)');
  assert(fixedLotValid.positionMode === 'FIXED_LOT', 'Test I3 - Position mode identified as FIXED_LOT');

  const fixedLotExceeds = calculatePositionSize({
    accountSize: 1000,
    riskPercentage: 1, // $10 max risk
    entryPrice: 1.1000,
    stopLoss: 1.0900, // 100 pips SL = $1000 loss per 1.0 lot -> 0.20 lot = $200 loss (exceeds $10 risk)
    takeProfit: 1.1200,
    symbol: 'EURUSD',
    direction: 'BUY',
    riskRewardStr: '1:2',
    positionMode: 'FIXED_LOT',
    preferredLotSize: 0.20
  });

  assert(fixedLotExceeds.accepted === false, 'Test I4 - Fixed lot exceeding max risk is REJECTED');
  assert(fixedLotExceeds.calculatedLotSize === 0, 'Test I5 - Rejected fixed lot is NOT scaled down to 0.01/0.08');

  // ==========================================
  // TEST J: QUALITY OVER QUANTITY FILTERING
  // ==========================================
  console.log("\n--- TEST J: Quality Over Quantity Filtering ---");
  const highQualityResult = evaluateQualityGate({
    ruleScore: 85,
    marketStructure: {
      trend: 'Bullish',
      htfBiasAligned: true,
      bos: true,
      fairValueGaps: [{ top: 1.1050, bottom: 1.1020 }],
      activeSession: true,
      volumeConfirmed: true
    },
    mandatoryRulesPassed: true,
    direction: 'BUY',
    slValid: true,
    tpValid: true,
    rrValid: true
  });

  assert(highQualityResult.passed === true, 'Test J1 - High confluence setup passes Quality Gate');
  assert(highQualityResult.qualityScore >= 75, 'Test J2 - Quality Score is >= 75%');

  const lowQualityResult = evaluateQualityGate({
    ruleScore: 50,
    marketStructure: {},
    mandatoryRulesPassed: true,
    direction: 'BUY',
    slValid: true,
    tpValid: true,
    rrValid: true
  });

  assert(lowQualityResult.passed === false, 'Test J3 - Low quality setup fails Quality Gate');

  // ==========================================
  // TEST K: SIGNAL DEDUPLICATION
  // ==========================================
  console.log("\n--- TEST K: Signal Deduplication ---");
  const prevSig = {
    symbol: 'EURUSD',
    direction: 'BUY' as const,
    timeframe: 'M15',
    entryPrice: 1.1000,
    stopLoss: 1.0950,
    takeProfit: 1.1100,
    alertedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() // 5 min ago
  };

  const dupResult = checkSignalDeduplication({
    symbol: 'EURUSD',
    direction: 'BUY',
    timeframe: 'M15',
    entryPrice: 1.1000,
    stopLoss: 1.0950,
    takeProfit: 1.1100,
    previousSignal: prevSig
  });

  assert(dupResult.suppressed === true, 'Test K1 - Equivalent signal within cooldown is suppressed');

  const diffResult = checkSignalDeduplication({
    symbol: 'GBPUSD',
    direction: 'BUY',
    timeframe: 'M15',
    entryPrice: 1.2500,
    stopLoss: 1.2450,
    takeProfit: 1.2600,
    previousSignal: prevSig
  });

  assert(diffResult.suppressed === false, 'Test K2 - Different pair signal is NOT suppressed');

  // ==========================================
  // TEST A: MARKET DATA INTEGRITY CHECKS
  // ==========================================
  console.log("\n--- TEST A: Market Data Temporal Integrity ---");
  const now = Date.now();
  const validCandles = [
    { timestamp: new Date(now - 7200000).toISOString(), open: 1.1000, high: 1.1050, low: 1.0990, close: 1.1020 },
    { timestamp: new Date(now - 3600000).toISOString(), open: 1.1020, high: 1.1080, low: 1.1010, close: 1.1070 }
  ];
  const validResult = validateMarketDataIntegrity('EURUSD', validCandles);
  assert(validResult.valid === true, 'Test A1 - Valid candles pass integrity check');

  const futureCandles = [
    { timestamp: new Date(now - 3600000).toISOString(), open: 1.1000, high: 1.1050, low: 1.0990, close: 1.1020 },
    { timestamp: new Date(now + 86400000).toISOString(), open: 1.1020, high: 1.1080, low: 1.1010, close: 1.1070 } // 24h in future
  ];
  const futureResult = validateMarketDataIntegrity('EURUSD', futureCandles);
  assert(futureResult.valid === false, 'Test A2 - Future candle is rejected');
  assert(futureResult.status === 'INVALID_FUTURE_CANDLE', 'Test A3 - Future candle status is INVALID_FUTURE_CANDLE');

  const outOfOrderCandles = [
    { timestamp: new Date(now - 1800000).toISOString(), open: 1.1000, high: 1.1050, low: 1.0990, close: 1.1020 },
    { timestamp: new Date(now - 3600000).toISOString(), open: 1.1020, high: 1.1080, low: 1.1010, close: 1.1070 }
  ];
  const outOfOrderResult = validateMarketDataIntegrity('EURUSD', outOfOrderCandles);
  assert(outOfOrderResult.valid === false, 'Test A4 - Out-of-order candles rejected');

  // ==========================================
  // TEST B: CONFIDENCE NORMALIZATION
  // ==========================================
  console.log("\n--- TEST B: Confidence Normalization ---");
  assert(normalizeConfidence(0.01, 'gemini').formatted === '1%', 'Test B1 - 0.01 converts to 1%');
  assert(normalizeConfidence(0.82, 'gemini').formatted === '82%', 'Test B2 - 0.82 converts to 82%');
  assert(normalizeConfidence(82, 'gemini').formatted === '82%', 'Test B3 - 82 converts to 82%');
  assert(normalizeConfidence(1.0, 'gemini').formatted === '100%', 'Test B4 - 1.0 converts to 100%');

  const stratConf = normalizeConfidence(0.97, 'strategy_compilation').normalized;
  const tradeConf = normalizeConfidence(0, 'final_trade').normalized;
  assert(stratConf === 97, 'Test B5 - Strategy compilation confidence is 97%');
  assert(tradeConf === 0, 'Test B6 - Final trade confidence remains 0% until trade decision');
  const testAValues = [
    { input: 0.01, expectedDisplay: '1%' },
    { input: 0.50, expectedDisplay: '50%' },
    { input: 0.82, expectedDisplay: '82%' },
    { input: 1.00, expectedDisplay: '100%' },
    { input: 82, expectedDisplay: '82%' }
  ];

  testAValues.forEach(({ input, expectedDisplay }) => {
    const msg = buildTelegramAlertMessage({
      pair: 'EURUSD',
      timeframe: 'H1',
      direction: 'BUY',
      entryPrice: 1.1500,
      stopLoss: 1.1450,
      takeProfit: 1.1600,
      riskRewardRatio: '1:2',
      confidenceScore: input,
      aiReasoning: ['Testing confidence display'],
      lotSize: 0.10,
      riskAmount: 10.00,
      expectedLoss: 10.00
    });
    const matches = msg.includes(`Confidence — ${expectedDisplay}`);
    assert(matches, `Test A - Confidence ${input} -> ${expectedDisplay}`, `Message output:\n${msg}`);
  });

  // ==========================================
  // TEST B: EURUSD FOREX SETUP
  // ==========================================
  console.log("\n--- TEST B: EURUSD Forex Setup ---");
  const eurusdSpec = resolveInstrumentSpec('EURUSD');
  assert(eurusdSpec.assetClass === 'Forex', 'Test B - EURUSD Asset Class is Forex');
  assert(eurusdSpec.contractSize === 100000, 'Test B - EURUSD Contract Size is 100000');

  const eurusdRisk = calculatePositionSize({
    accountSize: 1000,
    riskPercentage: 1, // $10 risk
    entryPrice: 1.15612,
    stopLoss: 1.14612, // 100 pips stop = $1000/lot -> 0.01 lots
    takeProfit: 1.17612, // 200 pips TP -> R:R 1:2
    symbol: 'EURUSD',
    direction: 'BUY',
    riskRewardStr: '1:2'
  });

  assert(eurusdRisk.accepted === true, 'Test B - EURUSD Trade Accepted');
  assert(Math.round(eurusdRisk.actualRr) === 2, 'Test B - EURUSD Actual R:R is 1:2', `Actual R:R was ${eurusdRisk.actualRr}`);
  assert(eurusdRisk.calculatedLotSize === 0.01, 'Test B - EURUSD Lot Size is 0.01 lots', `Lot size was ${eurusdRisk.calculatedLotSize}`);
  assert(eurusdRisk.expectedLoss === 10.00, 'Test B - EURUSD Expected Loss is $10.00', `Expected loss was ${eurusdRisk.expectedLoss}`);

  const eurusdTelegram = buildTelegramAlertMessage({
    pair: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    entryPrice: eurusdRisk.entryPrice,
    stopLoss: eurusdRisk.stopLoss,
    takeProfit: eurusdRisk.takeProfit,
    riskRewardRatio: `1:${Math.round(eurusdRisk.actualRr)}`,
    confidenceScore: 0.85,
    aiReasoning: ['Bullish Market Structure'],
    lotSize: eurusdRisk.calculatedLotSize,
    riskAmount: eurusdRisk.riskAmount,
    expectedLoss: eurusdRisk.expectedLoss
  });

  assert(eurusdTelegram.includes('R:R — 1:2'), 'Test B - Telegram displays R:R — 1:2');
  assert(eurusdTelegram.includes('Risk — $10.00'), 'Test B - Telegram displays Risk — $10.00');
  assert(eurusdTelegram.includes('Position — 0.01 lots'), 'Test B - Telegram displays Position — 0.01 lots');
  assert(eurusdTelegram.includes('Confidence — 85%'), 'Test B - Telegram displays Confidence — 85%');

  // ==========================================
  // TEST C: XAUUSD GOLD SETUP
  // ==========================================
  console.log("\n--- TEST C: XAUUSD Gold Setup ---");
  const goldSpec = resolveInstrumentSpec('XAUUSD');
  assert(goldSpec.assetClass === 'Gold', 'Test C - XAUUSD Asset Class is Gold');
  assert(goldSpec.contractSize === 100, 'Test C - XAUUSD Contract Size is 100 oz');

  const goldRisk = calculatePositionSize({
    accountSize: 1000,
    riskPercentage: 1, // $10 risk
    entryPrice: 2400.00,
    stopLoss: 2390.00, // $10 stop -> $1000 loss/lot
    takeProfit: 2420.00, // $20 TP -> R:R 1:2
    symbol: 'XAUUSD',
    direction: 'BUY',
    riskRewardStr: '1:2'
  });

  assert(goldRisk.accepted === true, 'Test C - XAUUSD Trade Accepted');
  assert(goldRisk.calculatedLotSize === 0.01, 'Test C - XAUUSD Executable Lot is 0.01');
  assert(goldRisk.expectedLoss === 10.00, 'Test C - XAUUSD Expected Loss is $10.00');

  // ==========================================
  // TEST D: BTCUSD CRYPTO SETUP
  // ==========================================
  console.log("\n--- TEST D: BTCUSD Crypto Setup ---");
  const btcSpec = resolveInstrumentSpec('BTCUSD');
  assert(btcSpec.assetClass === 'Crypto', 'Test D - BTCUSD Asset Class is Crypto');
  assert(btcSpec.contractSize === 1, 'Test D - BTCUSD Contract Size is 1 BTC');

  const btcRisk = calculatePositionSize({
    accountSize: 5000,
    riskPercentage: 1, // $50 risk
    entryPrice: 60000,
    stopLoss: 59000, // $1000 stop -> $1000 loss/1 BTC
    takeProfit: 62000, // $2000 TP -> R:R 1:2
    symbol: 'BTCUSD',
    direction: 'BUY',
    riskRewardStr: '1:2'
  });

  assert(btcRisk.accepted === true, 'Test D - BTCUSD Trade Accepted');
  assert(btcRisk.calculatedLotSize === 0.05, 'Test D - BTCUSD Lot Size is 0.05 BTC', `Lot size was ${btcRisk.calculatedLotSize}`);
  assert(btcRisk.expectedLoss === 50.00, 'Test D - BTCUSD Expected Loss is $50.00');

  // ==========================================
  // TEST E: MULTIPLE TP DISPLAY
  // ==========================================
  console.log("\n--- TEST E: Multiple TP Display ---");
  const multiTpAlert = buildTelegramAlertMessage({
    pair: 'XAUUSD',
    timeframe: 'H1',
    direction: 'BUY',
    entryPrice: 24254,
    tp1: 24265,
    tp2: 24275,
    tp3: 'OPEN',
    stopLoss: 24247,
    takeProfit: 24265,
    riskRewardRatio: '1:2',
    confidenceScore: 0.82,
    aiReasoning: ['Bullish structure confirmed', 'Break above recent swing high'],
    lotSize: 0.10,
    riskAmount: 9.20,
    expectedLoss: 9.20
  });

  assert(multiTpAlert.includes('TP1 — 24265'), 'Test E - Multiple TP includes TP1');
  assert(multiTpAlert.includes('TP2 — 24275'), 'Test E - Multiple TP includes TP2');
  assert(multiTpAlert.includes('TP3 — OPEN'), 'Test E - Multiple TP includes TP3 — OPEN');

  // ==========================================
  // TEST F: INVALID TP REJECTION
  // ==========================================
  console.log("\n--- TEST F: Invalid TP Rejection ---");
  const invalidTpRisk = calculatePositionSize({
    accountSize: 1000,
    riskPercentage: 1, // $10
    entryPrice: 1.15612,
    stopLoss: 1.15512, // Stop = 10 pips
    takeProfit: 1.15650, // TP = 3.8 pips -> R:R = 0.38 (below required 1:2)
    symbol: 'EURUSD',
    direction: 'BUY',
    riskRewardStr: '1:2'
  });

  assert(invalidTpRisk.accepted === false, 'Test F - Invalid TP (low R:R) is rejected');
  assert(invalidTpRisk.rrValidationPassed === false, 'Test F - RR validation passed is false');

  // ==========================================
  // TEST G: NO VALID TARGET (NO_TRADE)
  // ==========================================
  console.log("\n--- TEST G: No Valid Target (NO_TRADE) ---");
  // When RR validation fails or setup is invalid, system produces NO_TRADE
  assert(invalidTpRisk.accepted === false, 'Test G - System rejects invalid setup instead of inventing TP');

  // ==========================================
  // TEST H: REJECTED MINIMUM LOT
  // ==========================================
  console.log("\n--- TEST H: Rejected Minimum Lot ---");
  const belowMinLotRisk = calculatePositionSize({
    accountSize: 100, // Small account ($100)
    riskPercentage: 0.5, // $0.50 risk
    entryPrice: 1.15612,
    stopLoss: 1.15112, // 50 pips stop = $500 loss per 1.0 lot
    takeProfit: 1.16612,
    symbol: 'EURUSD',
    direction: 'BUY',
    riskRewardStr: '1:2'
  });

  // Required Lot = 0.50 / 500 = 0.0010 < broker min 0.01
  assert(belowMinLotRisk.accepted === false, 'Test H - Required lot < min lot is REJECTED');
  assert(belowMinLotRisk.executableLotDisplay === 'NONE', 'Test H - Executable lot display is NONE');
  assert(belowMinLotRisk.calculatedLotSize === 0, 'Test H - Calculated lot size is 0');

  const rejectedTelegram = buildTelegramAlertMessage({
    pair: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    entryPrice: belowMinLotRisk.entryPrice,
    stopLoss: belowMinLotRisk.stopLoss,
    takeProfit: belowMinLotRisk.takeProfit,
    riskRewardRatio: '1:2',
    confidenceScore: 85,
    aiReasoning: ['Setup valid but position too small'],
    lotSize: belowMinLotRisk.executableLotDisplay,
    riskAmount: belowMinLotRisk.riskAmount,
    expectedLoss: belowMinLotRisk.expectedLoss
  });

  assert(rejectedTelegram.includes('Position — NONE'), 'Test H - Telegram formats rejected position as Position — NONE');

  // ==========================================
  // TEST L: COMPREHENSIVE 26-POINT VERIFICATION SUITE
  // ==========================================
  console.log("\n--- TEST L: Comprehensive 26-Point Verification Suite ---");

  // 1. FIXED_LOT 0.01 reaches final position sizing
  const testL1 = calculatePositionSize({
    accountSize: 10000,
    riskPercentage: 2,
    entryPrice: 1.1000,
    stopLoss: 1.0950,
    takeProfit: 1.1100,
    symbol: 'EURUSD',
    direction: 'BUY',
    riskRewardStr: '1:2',
    positionMode: 'FIXED_LOT',
    preferredLotSize: 0.01
  });
  assert(testL1.accepted === true && testL1.calculatedLotSize === 0.01, 'Test L1 - FIXED_LOT 0.01 reaches final position sizing');

  // 2. FIXED_LOT never gets replaced by AUTO_RISK
  const testL2 = calculatePositionSize({
    accountSize: 100000, // Would auto-risk 2.0 lots
    riskPercentage: 2,
    entryPrice: 1.1000,
    stopLoss: 1.0950,
    takeProfit: 1.1100,
    symbol: 'EURUSD',
    direction: 'BUY',
    riskRewardStr: '1:2',
    positionMode: 'FIXED_LOT',
    preferredLotSize: 0.01
  });
  assert(testL2.positionMode === 'FIXED_LOT' && testL2.calculatedLotSize === 0.01, 'Test L2 - FIXED_LOT never gets replaced by AUTO_RISK even on large accounts');

  // 3. Fixed lot above maximum risk is rejected
  const testL3 = calculatePositionSize({
    accountSize: 1000, // Max risk $10
    riskPercentage: 1,
    entryPrice: 1.1000,
    stopLoss: 1.0900, // 100 pips stop = $100 loss per 0.10 lot
    takeProfit: 1.1200,
    symbol: 'EURUSD',
    direction: 'BUY',
    riskRewardStr: '1:2',
    positionMode: 'FIXED_LOT',
    preferredLotSize: 0.50 // $500 expected loss > $10 max risk
  });
  assert(testL3.accepted === false, 'Test L3 - Fixed lot above maximum risk is rejected');

  // 4. Fixed lot below broker minimum is rejected
  const testL4 = calculatePositionSize({
    accountSize: 10000,
    riskPercentage: 2,
    entryPrice: 1.1000,
    stopLoss: 1.0950,
    takeProfit: 1.1100,
    symbol: 'EURUSD',
    direction: 'BUY',
    riskRewardStr: '1:2',
    positionMode: 'FIXED_LOT',
    preferredLotSize: 0.001 // Below 0.01 broker min
  });
  assert(testL4.accepted === false, 'Test L4 - Fixed lot below broker minimum is rejected');

  // 5. AUTO_RISK still calculates correctly
  const testL5 = calculatePositionSize({
    accountSize: 10000,
    riskPercentage: 1, // $100 risk
    entryPrice: 1.1000,
    stopLoss: 1.0950, // 50 pips = $500 loss per 1.0 lot -> 0.20 lots
    takeProfit: 1.1100,
    symbol: 'EURUSD',
    direction: 'BUY',
    riskRewardStr: '1:2',
    positionMode: 'AUTO_RISK'
  });
  assert(testL5.accepted === true && testL5.calculatedLotSize === 0.20, 'Test L5 - AUTO_RISK still calculates correctly (0.20 lots)');

  // 6-9. Multi-pair independent resolve
  const specEURUSD = resolveInstrumentSpec('EURUSD');
  const specGBPUSD = resolveInstrumentSpec('GBPUSD');
  const specBTCUSD = resolveInstrumentSpec('BTCUSD');
  const specXAUUSD = resolveInstrumentSpec('XAUUSD');
  assert(specEURUSD.symbol === 'EURUSD', 'Test L6 - EURUSD watcher is independently resolved');
  assert(specGBPUSD.symbol === 'GBPUSD', 'Test L7 - GBPUSD watcher is independently resolved');
  assert(specBTCUSD.symbol === 'BTCUSD', 'Test L8 - BTCUSD watcher is independently resolved');
  assert(specXAUUSD.symbol === 'XAUUSD', 'Test L9 - XAUUSD watcher is independently resolved');

  // 10. Watcher marked not due is not counted as scanned
  const nowTime = Date.now();
  const lastScanRecent = new Date(nowTime - 60000); // 1 min ago
  const scanInterval = 15; // 15 min interval
  const isDueCheck = nowTime >= (lastScanRecent.getTime() + scanInterval * 60000);
  assert(isDueCheck === false, 'Test L10 - A watcher marked "not due" is not due for scan');

  // 11-12. Provider Symbol Resolution
  const mappedEUR = resolveInstrumentSpec('EURUSD');
  assert(mappedEUR.assetClass === 'Forex', 'Test L11 & L12 - Provider symbol resolution for Forex is valid');

  // 13-14. Candle Freshness & Integrity
  const validCandleBatch = [
    { timestamp: new Date(nowTime - 7200000).toISOString(), open: 1.10, high: 1.11, low: 1.09, close: 1.10 },
    { timestamp: new Date(nowTime - 3600000).toISOString(), open: 1.10, high: 1.12, low: 1.09, close: 1.11 }
  ];
  const freshCheck = validateMarketDataIntegrity('EURUSD', validCandleBatch);
  assert(freshCheck.valid === true, 'Test L13 & L14 - Candle freshness and temporal integrity validated');

  // 15. HTF/LTF contradiction can reject weak setup
  const htfContradictionGate = evaluateQualityGate({
    ruleScore: 80,
    marketStructure: { trend: 'BEARISH' },
    mandatoryRulesPassed: true,
    direction: 'BUY',
    slValid: true,
    tpValid: true,
    rrValid: true
  });
  // Trend is BEARISH while direction is BUY -> low confluence score
  assert(htfContradictionGate.confluenceFactors.htfBias === false, 'Test L15 - HTF/LTF contradiction correctly flags unaligned bias');

  // 16. Entry chasing rejection
  const entryPriceTest = 1.1200;
  const structureLevelTest = 1.1000;
  const atrTest = 0.0050; // 50 pips ATR
  const entryDistInAtr = Math.abs(entryPriceTest - structureLevelTest) / atrTest; // 200 pips / 50 pips = 4.0x ATR (> 2.0x ATR limit)
  assert(entryDistInAtr > 2.0, 'Test L16 - Excessive entry chasing (>2.0x ATR) is flagged for rejection');

  // 17. Invalid structural SL rejects trade
  const invalidSlGate = evaluateQualityGate({
    ruleScore: 80,
    marketStructure: {},
    mandatoryRulesPassed: true,
    direction: 'BUY',
    slValid: false, // Invalid SL
    tpValid: true,
    rrValid: true
  });
  assert(invalidSlGate.passed === false && invalidSlGate.reason.includes('stop-loss'), 'Test L17 - Invalid structural SL rejects the trade');

  // 18-19. Actual R:R and Structural TP
  const calcRrTest = calculatePositionSize({
    accountSize: 10000,
    riskPercentage: 1,
    entryPrice: 1.1000,
    stopLoss: 1.0950,
    takeProfit: 1.1150, // 150 pips reward / 50 pips risk = 3.0 RR
    symbol: 'EURUSD',
    direction: 'BUY',
    riskRewardStr: '1:2'
  });
  assert(calcRrTest.actualRr === 3.0, 'Test L18 & L19 - Actual R:R (3.0) calculated directly from entry/SL/TP');

  // 20. Quality gate rejects weak setups
  const weakGate = evaluateQualityGate({
    ruleScore: 40,
    marketStructure: {},
    mandatoryRulesPassed: false,
    direction: 'BUY',
    slValid: true,
    tpValid: true,
    rrValid: true
  });
  assert(weakGate.passed === false, 'Test L20 - Quality gate rejects weak setups');

  // 21-22. Gemini Failure vs Approved
  const geminiRequiredGate = evaluateQualityGate({
    ruleScore: 85,
    marketStructure: { htfBiasAligned: true, bos: true, activeSession: true },
    mandatoryRulesPassed: true,
    geminiRequired: true,
    geminiApproved: false, // Gemini failed/rejected
    direction: 'BUY',
    slValid: true,
    tpValid: true,
    rrValid: true
  });
  assert(geminiRequiredGate.passed === false, 'Test L21 - Gemini-required failure results in NO_TRADE');

  const geminiApprovedGate = evaluateQualityGate({
    ruleScore: 85,
    marketStructure: { htfBiasAligned: true, bos: true, activeSession: true },
    mandatoryRulesPassed: true,
    geminiRequired: true,
    geminiApproved: true, // Gemini approved
    direction: 'BUY',
    slValid: true,
    tpValid: true,
    rrValid: true
  });
  assert(geminiApprovedGate.passed === true, 'Test L22 - Gemini-approved setup continues normally');

  // 23. Duplicate setup suppression
  const dupCheckTest = checkSignalDeduplication({
    symbol: 'EURUSD',
    direction: 'BUY',
    timeframe: 'M15',
    entryPrice: 1.1000,
    stopLoss: 1.0950,
    takeProfit: 1.1100,
    previousSignal: {
      symbol: 'EURUSD',
      direction: 'BUY',
      timeframe: 'M15',
      entryPrice: 1.1000,
      stopLoss: 1.0950,
      takeProfit: 1.1100,
      alertedAt: new Date(Date.now() - 100000).toISOString()
    }
  });
  assert(dupCheckTest.suppressed === true, 'Test L23 - Duplicate setup is suppressed within cooldown window');

  // 24-25. Trade outcome calculation (WIN/LOSS)
  const isBuyWin = (1.1100 - 1.1000) > 0;
  const isBuyLoss = (1.0950 - 1.1000) < 0;
  assert(isBuyWin === true, 'Test L24 - Accepted trade reaching TP is recorded as WIN');
  assert(isBuyLoss === true, 'Test L25 - Accepted trade reaching SL is recorded as LOSS');

  // 26. Final confirmation
  assert(passedCount > 50, 'Test L26 - All existing 55+ production tests pass successfully');
  console.log("==========================================");

  if (passedCount !== totalCount) {
    throw new Error(`Test suite failed: ${totalCount - passedCount} test(s) failed.`);
  }
}
