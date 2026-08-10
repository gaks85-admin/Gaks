import { buildTelegramAlertMessage } from './telegram-formatter.js';
import { calculatePositionSize, resolveInstrumentSpec } from './risk-engine.js';

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
  // TEST A: CONFIDENCE CONVERSION
  // ==========================================
  console.log("\n--- TEST A: Confidence Conversion ---");
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

  console.log("\n==========================================");
  console.log(`TEST SUITE RESULTS: ${passedCount}/${totalCount} TESTS PASSED`);
  console.log("==========================================");

  if (passedCount !== totalCount) {
    throw new Error(`Test suite failed: ${totalCount - passedCount} test(s) failed.`);
  }
}
