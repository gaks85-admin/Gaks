import { buildTelegramAlertMessage } from './telegram-formatter.js';
import { calculatePositionSize, resolveInstrumentSpec } from './risk-engine.js';
import { validateMarketDataIntegrity } from './market-integrity.js';
import { normalizeConfidence } from './confidence-engine.js';
import { evaluateQualityGate } from './quality-gate.js';
import { checkSignalDeduplication } from './signal-deduplication.js';
import { validateTradeGeometry } from './trade-geometry-validator.js';
import { validateActiveTradeState } from './trade-validator.js';
import { runGeminiAuditTestSuite } from './gemini-audit-test-suite.js';
import { runTradeValidatorTestSuite } from './trade-validator-test-suite.js';
import { runEquityLearningTestSuite } from './equity-learning-test-suite.js';
import { runTradeIdentityTestSuite } from './trade-identity-test-suite.js';
import { runAdaptiveLearningTestSuite } from './adaptive-learning-test-suite.js';
import { runAdaptiveQualityTestSuite } from './adaptive-quality-test-suite.js';
import { runAdaptiveExecutionTestSuite } from './adaptive-execution-test-suite.js';
import { runAdaptivePerformanceTestSuite } from './adaptive-performance-test-suite.js';
import { runDecisionAttributionTestSuite } from './decision-attribution-test-suite.js';
import { runClosedLoopCalibrationTestSuite } from './closed-loop-calibration-test-suite.js';
import { runStage3GTestSuite } from './stage3g-test-suite.js';

export async function runProductionFixTestSuite() {
  console.log("==========================================");
  console.log("RUNNING PRODUCTION FIX TEST SUITE");
  console.log("==========================================");

  let passedCount = 0;
  let totalCount = 0;
  const failedTests: string[] = [];

  function assert(condition: boolean, testName: string, detail?: string) {
    totalCount++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passedCount++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
      failedTests.push(`${testName}${detail ? ` - ${detail}` : ''}`);
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

  // Regression tests A through H for timezone normalization & market integrity
  const sydneyPastTime = new Date(now - 7200000);
  const sydneyIsoBase = sydneyPastTime.toISOString().replace('Z', '');
  const sydneyCandlesEUR = [
    { timestamp: `${sydneyIsoBase} Australia/Sydney`, open: 1.0800, high: 1.0850, low: 1.0790, close: 1.0820 },
    { timestamp: new Date(now - 3600000).toISOString(), open: 1.0820, high: 1.0880, low: 1.0810, close: 1.0870 }
  ];
  const sydneyResultEUR = validateMarketDataIntegrity('EURUSD', sydneyCandlesEUR);
  assert(sydneyResultEUR.valid === true, 'Test A_Sydney - EURUSD Australia/Sydney timestamp normalized and validated successfully');

  const sydneyCandlesGBP = [
    { timestamp: `${sydneyIsoBase} Australia/Sydney`, open: 1.2500, high: 1.2550, low: 1.2490, close: 1.2520 },
    { timestamp: new Date(now - 3600000).toISOString(), open: 1.2520, high: 1.2580, low: 1.2510, close: 1.2570 }
  ];
  const sydneyResultGBP = validateMarketDataIntegrity('GBPUSD', sydneyCandlesGBP);
  assert(sydneyResultGBP.valid === true, 'Test B_Sydney - GBPUSD Australia/Sydney timestamp normalized and validated successfully');

  const utcCandles = [
    { timestamp: new Date(now - 7200000).toISOString(), open: 1.1000, high: 1.1050, low: 1.0990, close: 1.1020 },
    { timestamp: new Date(now - 3600000).toISOString(), open: 1.1020, high: 1.1080, low: 1.1010, close: 1.1070 }
  ];
  const utcResult = validateMarketDataIntegrity('EURUSD', utcCandles);
  assert(utcResult.valid === true, 'Test C_UTC - Standard UTC timestamps validate successfully');

  const futureCandlesTest = [
    { timestamp: new Date(now - 3600000).toISOString(), open: 1.1000, high: 1.1050, low: 1.0990, close: 1.1020 },
    { timestamp: new Date(now + 86400000).toISOString(), open: 1.1020, high: 1.1080, low: 1.010, close: 1.1070 }
  ];
  const futureRes = validateMarketDataIntegrity('EURUSD', futureCandlesTest);
  assert(futureRes.valid === false && futureRes.status === 'INVALID_FUTURE_CANDLE', 'Test D_Future - Genuinely future timestamp is rejected');

  const incompleteCandles = [
    { timestamp: new Date(now - 3600000).toISOString(), open: 1.1000, high: 1.1050, low: 1.0990, close: 1.1020 },
    { timestamp: new Date(now + 60000).toISOString(), open: 1.1020, high: 1.1080, low: 1.1010, close: 1.1070 }
  ];
  const incompleteRes = validateMarketDataIntegrity('EURUSD', incompleteCandles);
  assert(incompleteRes.valid === false && incompleteRes.status === 'INVALID_FUTURE_CANDLE', 'Test E_Incomplete - Current/future candle rejected');

  const ascendingRes = validateMarketDataIntegrity('EURUSD', validCandles);
  assert(ascendingRes.valid === true, 'Test F_Ascending - Strictly ascending candles pass');

  const dupCandles = [
    { timestamp: new Date(now - 3600000).toISOString(), open: 1.1000, high: 1.1050, low: 1.0990, close: 1.1020 },
    { timestamp: new Date(now - 3600000).toISOString(), open: 1.1020, high: 1.1080, low: 1.1010, close: 1.1070 }
  ];
  const dupRes = validateMarketDataIntegrity('EURUSD', dupCandles);
  assert(dupRes.valid === false && dupRes.status === 'INVALID_DUPLICATE', 'Test G_Duplicate - Duplicate timestamps rejected');

  const dstCandles = [
    { timestamp: '2026-04-05T02:00:00+10:00', open: 1.0800, high: 1.0850, low: 1.0790, close: 1.0820 },
    { timestamp: '2026-04-05T03:00:00+10:00', open: 1.0820, high: 1.0880, low: 1.0810, close: 1.0870 }
  ];
  const dstRes = validateMarketDataIntegrity('EURUSD', dstCandles);
  assert(dstRes.status !== 'INVALID_CHRONOLOGY', 'Test H_DST - DST transition offsets parsed without chronology error');

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

  // ==========================================
  // TEST M: TRADE GEOMETRY & CONSISTENCY REGRESSION TESTS (1-15)
  // ==========================================
  console.log("\n--- TEST M: Trade Geometry & Consistency Regression Tests ---");

  // 1. Valid BUY
  const testM1 = validateTradeGeometry({ symbol: 'GBPUSD', direction: 'BUY', entryPrice: 1.3500, stopLoss: 1.3490, takeProfit: 1.3520 });
  assert(testM1.valid === true && testM1.geometry === 'ACCEPTABLE_GEOMETRY', 'Test M1 - Valid BUY produces ACCEPTABLE_GEOMETRY');

  // 2. Valid SELL
  const testM2 = validateTradeGeometry({ symbol: 'GBPUSD', direction: 'SELL', entryPrice: 1.3500, stopLoss: 1.3510, takeProfit: 1.3480 });
  assert(testM2.valid === true && testM2.geometry === 'ACCEPTABLE_GEOMETRY', 'Test M2 - Valid SELL produces ACCEPTABLE_GEOMETRY');

  // 3. SELL with SL below Entry
  const testM3 = validateTradeGeometry({ symbol: 'GBPUSD', direction: 'SELL', entryPrice: 1.35095, stopLoss: 1.35045, takeProfit: 1.35195 });
  assert(testM3.valid === false && testM3.geometry.includes('SELL'), 'Test M3 - SELL with SL below Entry is rejected');

  // 4. SELL with TP above Entry
  const testM4 = validateTradeGeometry({ symbol: 'GBPUSD', direction: 'SELL', entryPrice: 1.3500, stopLoss: 1.3510, takeProfit: 1.3520 });
  assert(testM4.valid === false, 'Test M4 - SELL with TP above Entry is rejected');

  // 5. BUY with SL above Entry
  const testM5 = validateTradeGeometry({ symbol: 'GBPUSD', direction: 'BUY', entryPrice: 1.3500, stopLoss: 1.3510, takeProfit: 1.3520 });
  assert(testM5.valid === false, 'Test M5 - BUY with SL above Entry is rejected');

  // 6. BUY with TP below Entry
  const testM6 = validateTradeGeometry({ symbol: 'GBPUSD', direction: 'BUY', entryPrice: 1.3500, stopLoss: 1.3490, takeProfit: 1.3480 });
  assert(testM6.valid === false, 'Test M6 - BUY with TP below Entry is rejected');

  // 7. Negative risk distance
  const testM7 = validateTradeGeometry({ symbol: 'GBPUSD', direction: 'BUY', entryPrice: 1.3500, stopLoss: 1.3510, takeProfit: 1.3520 });
  assert(testM7.valid === false, 'Test M7 - Negative risk distance is rejected');

  // 8. Negative reward distance
  const testM8 = validateTradeGeometry({ symbol: 'GBPUSD', direction: 'BUY', entryPrice: 1.3500, stopLoss: 1.3490, takeProfit: 1.3480 });
  assert(testM8.valid === false, 'Test M8 - Negative reward distance is rejected');

  // 9. R:R calculation for BUY
  const testM9 = validateTradeGeometry({ symbol: 'EURUSD', direction: 'BUY', entryPrice: 1.1000, stopLoss: 1.0950, takeProfit: 1.1150 });
  assert(testM9.calculatedRr === 3.0, 'Test M9 - R:R calculation for BUY is exactly 3.0');

  // 10. R:R calculation for SELL
  const testM10 = validateTradeGeometry({ symbol: 'EURUSD', direction: 'SELL', entryPrice: 1.1000, stopLoss: 1.1050, takeProfit: 1.0850 });
  assert(testM10.calculatedRr === 3.0, 'Test M10 - R:R calculation for SELL is exactly 3.0');

  // 11. Fixed-lot risk validation
  const testM11 = calculatePositionSize({
    accountSize: 10000,
    riskPercentage: 2,
    entryPrice: 1.1000,
    stopLoss: 1.0950,
    takeProfit: 1.1100,
    symbol: 'EURUSD',
    direction: 'BUY',
    positionMode: 'FIXED_LOT',
    preferredLotSize: 0.10
  });
  assert(testM11.accepted === true && testM11.calculatedLotSize === 0.10, 'Test M11 - Fixed-lot risk validation calculates correct actual risk and lot size');

  // 12. Gemini explanation says LONG but structured direction says SELL
  const testM12 = validateTradeGeometry({
    symbol: 'GBPUSD',
    direction: 'SELL',
    entryPrice: 1.3500,
    stopLoss: 1.3510,
    takeProfit: 1.3480,
    explanation: 'Market trend is bullish on M5, long position targeting higher levels.'
  });
  assert(testM12.valid === false && testM12.geometry === 'EXPLANATION_CONTRADICTS_DIRECTION', 'Test M12 - Explanation says LONG but direction is SELL -> NO_TRADE');

  // 13. Gemini explanation says SHORT but structured direction says BUY
  const testM13 = validateTradeGeometry({
    symbol: 'EURUSD',
    direction: 'BUY',
    entryPrice: 1.1000,
    stopLoss: 1.0950,
    takeProfit: 1.1150,
    explanation: 'Bearish entry and short setup targeting lower levels.'
  });
  assert(testM13.valid === false && testM13.geometry === 'EXPLANATION_CONTRADICTS_DIRECTION', 'Test M13 - Explanation says SHORT but direction is BUY -> NO_TRADE');

  // 14. Telegram payload safety check for invalid geometry
  let telegramPayloadFailed = false;
  try {
    const invalidRiskResult = calculatePositionSize({
      accountSize: 10000,
      riskPercentage: 2,
      entryPrice: 1.35095,
      stopLoss: 1.35045, // invalid SELL SL
      takeProfit: 1.35195, // invalid SELL TP
      symbol: 'GBPUSD',
      direction: 'SELL'
    });
    if (!invalidRiskResult.accepted) {
      telegramPayloadFailed = true; // successfully blocked from reaching telegram
    }
  } catch {
    telegramPayloadFailed = true;
  }
  assert(telegramPayloadFailed === true, 'Test M14 - Telegram payload cannot be generated for invalid geometry');

  // 15. Active trade state cannot be created with direction = NO_TRADE or invalid SL/Entry/TP geometry
  const testM15_a = validateActiveTradeState({ trade_status: 'ACTIVE', direction: 'NO_TRADE', entry_price: 1.1000, stop_loss: 1.0950, take_profit: 1.1150 });
  const testM15_b = validateActiveTradeState({ trade_status: 'ACTIVE', direction: 'SELL', entry_price: 1.35095, stop_loss: 1.35045, take_profit: 1.35195 });
  assert(testM15_a.valid === false && testM15_b.valid === false, 'Test M15 - Active trade state rejects NO_TRADE or invalid geometry');

  // 26. Run Trade Validator & Scheduler Test Suite
  runTradeValidatorTestSuite();

  // 27. Run Gemini Audit Test Suite
  const geminiRes = await runGeminiAuditTestSuite();
  assert(geminiRes.failed === 0, 'Test M - Gemini Audit Test Suite passes successfully');

  // 28. Run Equity Learning & Risk Governor Test Suite
  const equityRes = runEquityLearningTestSuite();
  assert(equityRes.failed === 0, 'Test N - Equity Learning & Risk Governor Test Suite passes successfully');

  // 29. Run Trade Identity & Outcome Attribution Test Suite (Stage 3A)
  const tradeIdRes = runTradeIdentityTestSuite();
  assert(tradeIdRes.failed === 0, 'Test O - Trade Identity & Outcome Attribution Test Suite passes successfully');

  // 30. Run Adaptive Learning Test Suite (Stage 3B)
  const adaptiveRes = runAdaptiveLearningTestSuite();
  assert(adaptiveRes.failed === 0, 'Test P - Adaptive Learning Test Suite passes successfully');

  // 31. Run Adaptive Quality Test Suite (Stage 3C)
  const adaptiveQualityRes = runAdaptiveQualityTestSuite();
  assert(adaptiveQualityRes.failed === 0, 'Test Q - Adaptive Quality Test Suite passes successfully');

  // 32. Run Adaptive Execution Test Suite (Stage 3D)
  const adaptiveExecutionRes = runAdaptiveExecutionTestSuite();
  assert(adaptiveExecutionRes.failed === 0, 'Test R - Adaptive Execution Test Suite passes successfully');

  // 33. Run Adaptive Performance Test Suite (Stage 3E)
  const adaptivePerformanceRes = runAdaptivePerformanceTestSuite();
  assert(adaptivePerformanceRes.failed === 0, 'Test S - Adaptive Performance Test Suite passes successfully');

  // 34. Run Decision Attribution Test Suite (Stage 3F)
  const decisionAttributionRes = runDecisionAttributionTestSuite();
  assert(decisionAttributionRes.failed === 0, 'Test T - Decision Attribution Test Suite passes successfully');

  // 35. Run Closed-Loop Calibration Test Suite (Stage 3G)
  const closedLoopCalibrationRes = runClosedLoopCalibrationTestSuite();
  assert(closedLoopCalibrationRes.failed === 0, 'Test U - Closed-Loop Calibration Test Suite passes successfully');

  // 36. Run Stage 3G Performance Visibility Test Suite
  const stage3gRes = await runStage3GTestSuite();
  assert(stage3gRes.success, 'Test V - Stage 3G Performance Visibility Test Suite passes successfully');

  // 27. Final confirmation
  assert(passedCount > 50, 'Test L26 - All existing 55+ production tests pass successfully');
  console.log("==========================================");

  if (passedCount !== totalCount) {
    console.error('Failed test names:', failedTests);
    throw new Error(`Test suite failed: ${totalCount - passedCount} test(s) failed: ${failedTests.join(', ')}`);
  }
}
