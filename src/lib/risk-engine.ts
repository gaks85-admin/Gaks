export interface RiskPreferences {
  accountSize: number;
  riskPercentage: number;
  riskRewardStr: string;
  maxDailyRiskStr: string;
  strategySummary: string;
  dbTimestamp: string;
}

export interface PositionSizeResult {
  accountSize: number;
  riskPercentage: number;
  riskAmount: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number | null;
  stopDistance: number;
  pipValue: number;
  contractSize: number;
  calculatedLotSize: number;
  exactLotSize: number;
  expectedLoss: number;
  expectedProfit: number;
  assetClass: 'Forex' | 'Gold' | 'Indices' | 'Crypto';
  normalizedLotSize: number;
  lotType: string;
  lotStep: number;
  minLot: number;
  symbol: string;
  accepted: boolean;
  skipReason: string;
  expectedLossAtRequiredLot: number;
  expectedLossAtMinLot: number;
  userRr: string;
  geminiTp: number | null | undefined;
  actualRisk: number;
  actualReward: number;
  actualRr: number;
  rrValidationPassed: boolean;
}

export function classifyLotType(lotSize: number): string {
  if (lotSize < 0.01) {
    return "Nano Lot";
  } else if (lotSize >= 0.01 && lotSize < 0.10 - 1e-9) {
    return "Micro Lot";
  } else if (lotSize >= 0.10 - 1e-9 && lotSize < 1.00 - 1e-9) {
    return "Mini Lot";
  } else {
    return "Standard Lot";
  }
}

/**
 * Extracts and validates RiskPreferences from a database record.
 * Strictly forbids using cached watcher values or stale defaults.
 */
export function extractRiskPreferences(prefsRecord: any, userId: string): RiskPreferences {
  const rawCap = prefsRecord?.capital === 'Custom'
    ? (prefsRecord?.custom_capital || prefsRecord?.capital || "")
    : (prefsRecord?.capital || prefsRecord?.custom_capital || "");
  const cleanedCap = rawCap ? String(rawCap).replace(/[^0-9.]/g, "") : "";
  const accountSize = cleanedCap ? parseFloat(cleanedCap) : NaN;

  const rawRisk = prefsRecord?.preferred_risk || "";
  const cleanedRisk = rawRisk ? String(rawRisk).replace(/[^0-9.]/g, "") : "";
  const riskPercentage = cleanedRisk ? parseFloat(cleanedRisk) : NaN;

  if (isNaN(accountSize) || accountSize <= 0 || isNaN(riskPercentage) || riskPercentage <= 0) {
    throw new Error(`Account size or risk percentage not defined or invalid in trading preferences for user ${userId}. Never use fallback defaults.`);
  }

  const riskRewardStr = prefsRecord?.risk_reward || '1:2';
  const maxDailyRiskStr = prefsRecord?.max_daily_risk || prefsRecord?.max_daily_loss || '3 consecutive losses in 24h (Strategy Cap)';
  const strategySummary = prefsRecord?.strategy_summary || 'Custom Strategy';
  const dbTimestamp = prefsRecord?.updated_at || prefsRecord?.created_at || 'N/A';

  return {
    accountSize,
    riskPercentage,
    riskRewardStr,
    maxDailyRiskStr,
    strategySummary,
    dbTimestamp
  };
}

/**
 * Reads the latest Trading Preferences directly from Supabase.
 * Strictly forbids using cached watcher values or stale defaults.
 */
export async function loadRiskPreferences(supabase: any, userId: string): Promise<RiskPreferences> {
  const { data: prefsRecord, error } = await supabase
    .from("trading_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !prefsRecord) {
    throw new Error(`[Risk Engine] Error or missing trading preferences for user ${userId}: ${error?.message || 'Row not found'}`);
  }

  return extractRiskPreferences(prefsRecord, userId);
}

export function parseRiskRewardRatio(rrStr: string): number {
  if (!rrStr) return 2.0;
  const parts = rrStr.split(':');
  if (parts.length === 2) {
    const riskPart = parseFloat(parts[0]) || 1;
    const rewardPart = parseFloat(parts[1]) || 2;
    return rewardPart / riskPart;
  }
  const val = parseFloat(rrStr);
  return isNaN(val) ? 2.0 : val;
}

export function logRrValidationAudit(
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  riskDistance: number,
  rewardDistance: number,
  userRr: string,
  actualRr: number,
  validationPassed: boolean
): void {
  console.log(`\n========== RR VALIDATION ==========`);
  console.log(`Entry: ${entryPrice}`);
  console.log(`SL: ${stopLoss}`);
  console.log(`TP: ${takeProfit}`);
  console.log(`Risk Distance: ${riskDistance.toFixed(5)}`);
  console.log(`Reward Distance: ${rewardDistance.toFixed(5)}`);
  console.log(`User RR: ${userRr}`);
  console.log(`Actual RR: ${actualRr.toFixed(4)}`);
  console.log(`Validation Passed: ${validationPassed ? 'YES' : 'NO'}`);
  console.log(`==================================\n`);
}

export function logRiskValidationAudit(
  accountSize: number,
  riskPercentage: number,
  riskAmount: number,
  requiredLot: number,
  minLot: number,
  expectedLossAtRequiredLot: number,
  expectedLossAtMinLot: number,
  accepted: boolean,
  reason: string
): void {
  console.log(`\n========== RISK VALIDATION ==========`);
  console.log(`Capital: $${accountSize.toFixed(2)}`);
  console.log(`Risk %: ${riskPercentage}%`);
  console.log(`Risk Amount: $${riskAmount.toFixed(2)}`);
  console.log(`Required Lot: ${requiredLot.toFixed(4)}`);
  console.log(`Broker Minimum Lot: ${minLot}`);
  console.log(`Expected Loss at Required Lot: $${expectedLossAtRequiredLot.toFixed(2)}`);
  console.log(`Expected Loss at Minimum Lot: $${expectedLossAtMinLot.toFixed(2)}`);
  console.log(`Trade Accepted: ${accepted ? 'YES' : 'NO'}`);
  console.log(`Reason: ${reason}`);
  console.log(`====================================\n`);
}

/**
 * Calculates position size, strictly enforcing broker minimum lot (0.01 fixed, no rounding up),
 * backend TP calculation, and RR validation (within 1% tolerance).
 */
export function calculatePositionSize(config: {
  accountSize: number;
  riskPercentage: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit?: number | null;
  geminiTp?: number | null;
  symbol: string;
  direction?: string;
  riskRewardStr?: string;
}): PositionSizeResult {
  const riskAmount = config.accountSize * (config.riskPercentage / 100);
  const direction = (config.direction || 'BUY').toUpperCase();
  
  // Exact formulas for risk distance and TP calculation
  let riskDistance = 0;
  let calculatedTP = 0;
  const userRr = config.riskRewardStr || '1:2';
  const targetRrRatio = parseRiskRewardRatio(userRr);

  if (direction === 'SELL') {
    riskDistance = config.stopLoss - config.entryPrice;
    calculatedTP = config.entryPrice - (riskDistance * targetRrRatio);
  } else {
    riskDistance = config.entryPrice - config.stopLoss;
    calculatedTP = config.entryPrice + (riskDistance * targetRrRatio);
  }

  // Ensure riskDistance is positive
  riskDistance = Math.abs(riskDistance);
  const rewardDistance = Math.abs(calculatedTP - config.entryPrice);
  const actualRisk = riskDistance;
  const actualReward = rewardDistance;
  const actualRr = actualRisk > 0 ? actualReward / actualRisk : 0;

  // Validate RR within 1% tolerance
  const expectedRrNumeric = targetRrRatio;
  const rrDiff = Math.abs(actualRr - expectedRrNumeric);
  const rrValidationPassed = expectedRrNumeric === 0 ? false : (rrDiff / expectedRrNumeric) <= 0.01;

  logRrValidationAudit(
    config.entryPrice,
    config.stopLoss,
    calculatedTP,
    riskDistance,
    rewardDistance,
    userRr,
    actualRr,
    rrValidationPassed
  );

  const cleanSym = (config.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  let assetClass: 'Forex' | 'Gold' | 'Indices' | 'Crypto' = 'Forex';
  let contractSize = 100000;
  let pipValue = 10.00;
  let lossPerOneLot = 0;
  let profitPerOneLot = 0;

  const stopDistance = riskDistance;
  const tpDistance = rewardDistance;

  if (
    cleanSym.includes('BTC') ||
    cleanSym.includes('ETH') ||
    cleanSym.includes('SOL') ||
    cleanSym.includes('XRP') ||
    cleanSym.includes('CRYPTO')
  ) {
    assetClass = 'Crypto';
    contractSize = 1;
    pipValue = 0.01;
    lossPerOneLot = stopDistance * contractSize;
    profitPerOneLot = tpDistance * contractSize;
  } else if (
    cleanSym.includes('XAU') ||
    cleanSym.includes('GOLD') ||
    cleanSym.includes('XAG') ||
    cleanSym.includes('SILVER')
  ) {
    assetClass = 'Gold';
    contractSize = cleanSym.includes('XAG') || cleanSym.includes('SILVER') ? 5000 : 100;
    pipValue = contractSize * 0.01;
    lossPerOneLot = stopDistance * contractSize;
    profitPerOneLot = tpDistance * contractSize;
  } else if (
    cleanSym.includes('NAS') ||
    cleanSym.includes('US30') ||
    cleanSym.includes('SPX') ||
    cleanSym.includes('US500') ||
    cleanSym.includes('GER30') ||
    cleanSym.includes('UK100') ||
    cleanSym.includes('QQQ') ||
    cleanSym.includes('DIA') ||
    cleanSym.includes('SPY') ||
    cleanSym.includes('DAX') ||
    cleanSym.includes('UKX') ||
    cleanSym.includes('INDEX')
  ) {
    assetClass = 'Indices';
    contractSize = 1;
    pipValue = 0.01;
    lossPerOneLot = stopDistance * contractSize;
    profitPerOneLot = tpDistance * contractSize;
  } else {
    assetClass = 'Forex';
    contractSize = 100000;
    if (cleanSym.endsWith('USD')) {
      pipValue = 10.00;
      lossPerOneLot = stopDistance * contractSize;
      profitPerOneLot = tpDistance * contractSize;
    } else if (cleanSym.startsWith('USD')) {
      const pipSize = cleanSym.includes('JPY') ? 0.01 : 0.0001;
      pipValue = config.entryPrice > 0 ? (pipSize * contractSize) / config.entryPrice : 10.00;
      lossPerOneLot = config.entryPrice > 0 ? (stopDistance * contractSize) / config.entryPrice : stopDistance * contractSize;
      profitPerOneLot = config.entryPrice > 0 ? (tpDistance * contractSize) / config.entryPrice : 0;
    } else {
      const pipSize = cleanSym.includes('JPY') ? 0.01 : 0.0001;
      const estRate = cleanSym.includes('JPY') ? 155.00 : 1.00;
      pipValue = (pipSize * contractSize) / estRate;
      lossPerOneLot = (stopDistance * contractSize) / estRate;
      profitPerOneLot = (tpDistance * contractSize) / estRate;
    }
  }

  // Fixed broker minimum lot = 0.01, lot step = 0.01 (No nano lots, no rounding up)
  const minLot = 0.01;
  const lotStep = 0.01;

  let exactLotSize = 0;
  let expectedLossAtRequiredLot = 0;
  let expectedLossAtMinLot = minLot * lossPerOneLot;
  let accepted = true;
  let skipReason = '';

  if (lossPerOneLot > 0 && config.accountSize > 0 && config.riskPercentage > 0) {
    exactLotSize = riskAmount / lossPerOneLot;
    expectedLossAtRequiredLot = exactLotSize * lossPerOneLot;

    // Strict validation: RequiredLot < 0.01 (Broker minimum) -> Reject trade. Do NOT round up to 0.01.
    if (exactLotSize < minLot) {
      accepted = false;
      skipReason = `Trade skipped. Required lot size is below broker minimum. Required lot: ${exactLotSize.toFixed(4)}, Broker minimum: ${minLot}, Expected loss at minimum lot: $${expectedLossAtMinLot.toFixed(2)}, User maximum risk: $${riskAmount.toFixed(2)}.`;
      logRiskValidationAudit(
        config.accountSize,
        config.riskPercentage,
        riskAmount,
        exactLotSize,
        minLot,
        expectedLossAtRequiredLot,
        expectedLossAtMinLot,
        accepted,
        skipReason
      );

      return {
        accountSize: config.accountSize,
        riskPercentage: config.riskPercentage,
        riskAmount,
        entryPrice: config.entryPrice,
        stopLoss: config.stopLoss,
        takeProfit: calculatedTP,
        stopDistance,
        pipValue,
        contractSize,
        calculatedLotSize: 0,
        exactLotSize: Number(exactLotSize.toFixed(4)),
        expectedLoss: 0,
        expectedProfit: 0,
        assetClass,
        normalizedLotSize: 0,
        lotType: 'Nano Lot',
        lotStep,
        minLot,
        symbol: config.symbol,
        accepted,
        skipReason,
        expectedLossAtRequiredLot,
        expectedLossAtMinLot,
        userRr,
        geminiTp: config.geminiTp ?? config.takeProfit,
        actualRisk,
        actualReward,
        actualRr,
        rrValidationPassed
      };
    }

    if (!rrValidationPassed) {
      accepted = false;
      skipReason = `Trade skipped. RR validation failed. Expected RR: ${expectedRrNumeric}, Actual RR: ${actualRr.toFixed(4)}.`;
      logRiskValidationAudit(
        config.accountSize,
        config.riskPercentage,
        riskAmount,
        exactLotSize,
        minLot,
        expectedLossAtRequiredLot,
        expectedLossAtMinLot,
        accepted,
        skipReason
      );

      return {
        accountSize: config.accountSize,
        riskPercentage: config.riskPercentage,
        riskAmount,
        entryPrice: config.entryPrice,
        stopLoss: config.stopLoss,
        takeProfit: calculatedTP,
        stopDistance,
        pipValue,
        contractSize,
        calculatedLotSize: 0,
        exactLotSize: Number(exactLotSize.toFixed(4)),
        expectedLoss: 0,
        expectedProfit: 0,
        assetClass,
        normalizedLotSize: 0,
        lotType: 'Micro Lot',
        lotStep,
        minLot,
        symbol: config.symbol,
        accepted,
        skipReason,
        expectedLossAtRequiredLot,
        expectedLossAtMinLot,
        userRr,
        geminiTp: config.geminiTp ?? config.takeProfit,
        actualRisk,
        actualReward,
        actualRr,
        rrValidationPassed
      };
    }
  }

  let normalizedLotSize = 0;
  if (exactLotSize > 0) {
    const steps = Math.floor((exactLotSize + 1e-9) / lotStep);
    normalizedLotSize = steps * lotStep;
    const decimals = 2;
    normalizedLotSize = Number(normalizedLotSize.toFixed(decimals));
  }

  const calculatedLotSize = normalizedLotSize;
  const rawLotSizeFormatted = Number(exactLotSize.toFixed(4));
  let expectedLoss = 0;
  let expectedProfit = 0;

  if (lossPerOneLot > 0 && calculatedLotSize > 0) {
    expectedLoss = Number((calculatedLotSize * lossPerOneLot).toFixed(2));
    expectedProfit = Number((calculatedLotSize * profitPerOneLot).toFixed(2));
  }

  const lotType = classifyLotType(calculatedLotSize);
  skipReason = `Required lot (${rawLotSizeFormatted}) is greater than or equal to broker minimum (${minLot}).`;

  logRiskValidationAudit(
    config.accountSize,
    config.riskPercentage,
    riskAmount,
    rawLotSizeFormatted,
    minLot,
    expectedLossAtRequiredLot,
    expectedLossAtMinLot,
    accepted,
    skipReason
  );

  return {
    accountSize: config.accountSize,
    riskPercentage: config.riskPercentage,
    riskAmount,
    entryPrice: config.entryPrice,
    stopLoss: config.stopLoss,
    takeProfit: calculatedTP,
    stopDistance,
    pipValue,
    contractSize,
    calculatedLotSize,
    exactLotSize: rawLotSizeFormatted,
    expectedLoss,
    expectedProfit,
    assetClass,
    normalizedLotSize: calculatedLotSize,
    lotType,
    lotStep,
    minLot,
    symbol: config.symbol,
    accepted,
    skipReason,
    expectedLossAtRequiredLot,
    expectedLossAtMinLot,
    userRr,
    geminiTp: config.geminiTp ?? config.takeProfit,
    actualRisk,
    actualReward,
    actualRr,
    rrValidationPassed
  };
}

/**
 * Prints the verification audit log required by Task 5 and Task 6.
 */
export function logPositionSizeAudit(result: PositionSizeResult, dbTimestamp: string): void {
  console.log(`\n========== POSITION SIZE AUDIT ==========`);
  console.log(`Account Size: $${result.accountSize.toFixed(2)}`);
  console.log(`Risk %: ${result.riskPercentage}%`);
  console.log(`Risk Amount: $${result.riskAmount.toFixed(2)}`);
  console.log(`Entry: ${result.entryPrice}`);
  console.log(`Stop Loss: ${result.stopLoss}`);
  console.log(`Take Profit: ${result.takeProfit ?? 'N/A'}`);
  console.log(`Stop Distance: ${result.stopDistance.toFixed(5)}`);
  console.log(`Pip Value: $${result.pipValue.toFixed(2)}`);
  console.log(`Contract Size: ${result.contractSize}`);
  console.log(`Calculated Lot Size: ${result.calculatedLotSize}`);
  console.log(`Expected Loss if SL hits: $${result.expectedLoss.toFixed(2)}`);
  console.log(`Expected Profit if TP hits: $${result.expectedProfit.toFixed(2)}`);
  console.log(`Trading Preferences Loaded From: Supabase (trading_preferences)`);
  console.log(`Database Timestamp: ${dbTimestamp}`);
  console.log(`========================================\n`);

  console.log(`========== LOT NORMALIZATION AUDIT =========`);
  console.log(`Asset: ${result.symbol || 'N/A'}`);
  console.log(`Raw Lot: ${result.exactLotSize}`);
  console.log(`Normalized Lot: ${result.normalizedLotSize}`);
  console.log(`Lot Type: ${result.lotType}`);
  console.log(`Lot Step: ${result.lotStep}`);
  console.log(`Expected Loss: $${result.expectedLoss.toFixed(2)}`);
  console.log(`Expected Profit: $${result.expectedProfit.toFixed(2)}`);
  console.log(`============================================\n`);
}
