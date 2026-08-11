export interface RiskPreferences {
  accountSize: number;
  riskPercentage: number;
  riskRewardStr: string;
  maxDailyRiskStr: string;
  strategySummary: string;
  dbTimestamp: string;
  positionMode: 'AUTO_RISK' | 'FIXED_LOT';
  preferredLotSize: number;
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
  executableLotDisplay?: string;
  theoreticalExpectedLoss?: number;
  positionMode?: 'AUTO_RISK' | 'FIXED_LOT';
  requestedFixedLot?: number;
}

export interface InstrumentSpec {
  symbol: string;
  assetClass: 'Forex' | 'Gold' | 'Indices' | 'Crypto';
  minLot: number;
  lotStep: number;
  contractSize: number;
  tickSize: number;
  source: string;
}

export function resolveInstrumentSpec(symbol: string): InstrumentSpec {
  const cleanSym = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  let assetClass: 'Forex' | 'Gold' | 'Indices' | 'Crypto' = 'Forex';
  let contractSize = 100000;
  let minLot = 0.01;
  let lotStep = 0.01;
  let tickSize = 0.0001;
  let source = 'Forex Specification Resolver';

  if (
    cleanSym.includes('BTC') ||
    cleanSym.includes('ETH') ||
    cleanSym.includes('SOL') ||
    cleanSym.includes('XRP') ||
    cleanSym.includes('CRYPTO')
  ) {
    assetClass = 'Crypto';
    contractSize = 1;
    minLot = 0.01;
    lotStep = 0.01;
    tickSize = 0.01;
    source = 'Crypto Specification Resolver';
  } else if (
    cleanSym.includes('XAU') ||
    cleanSym.includes('GOLD') ||
    cleanSym.includes('XAG') ||
    cleanSym.includes('SILVER')
  ) {
    assetClass = 'Gold';
    contractSize = (cleanSym.includes('XAG') || cleanSym.includes('SILVER')) ? 5000 : 100;
    minLot = 0.01;
    lotStep = 0.01;
    tickSize = 0.01;
    source = 'Metals Specification Resolver';
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
    minLot = 0.01;
    lotStep = 0.01;
    tickSize = 0.1;
    source = 'Indices Specification Resolver';
  } else {
    assetClass = 'Forex';
    contractSize = 100000;
    minLot = 0.01;
    lotStep = 0.01;
    tickSize = cleanSym.includes('JPY') ? 0.01 : 0.0001;
    source = 'Forex Specification Resolver';
  }

  console.log(`
[Instrument Spec]
Symbol: ${symbol}
Asset Class: ${assetClass.toUpperCase()}
Min Lot: ${minLot}
Lot Step: ${lotStep}
Contract Size: ${contractSize}
Source: ${source}
`.trim());

  return {
    symbol,
    assetClass,
    minLot,
    lotStep,
    contractSize,
    tickSize,
    source
  };
}

export function getTickSize(symbol: string): number {
  return resolveInstrumentSpec(symbol).tickSize;
}

export function logExecutionValidationAudit(
  intendedEntry: number,
  executedEntry: number,
  difference: number,
  slDistance: number,
  tpDistance: number,
  configuredRr: string,
  actualRr: number,
  expectedLoss: number,
  expectedProfit: number,
  passed: boolean
): void {
  console.log(`\n========== EXECUTION VALIDATION ==========`);
  console.log(`Intended Entry: ${intendedEntry}`);
  console.log(`Executed Entry: ${executedEntry}`);
  console.log(`Difference: ${difference.toFixed(5)}`);
  console.log(`SL Distance: ${slDistance.toFixed(5)}`);
  console.log(`TP Distance: ${tpDistance.toFixed(5)}`);
  console.log(`Configured RR: ${configuredRr}`);
  console.log(`Actual RR: ${actualRr.toFixed(4)}`);
  console.log(`Expected Loss: $${expectedLoss.toFixed(2)}`);
  console.log(`Expected Profit: $${expectedProfit.toFixed(2)}`);
  console.log(`PASS / FAIL: ${passed ? 'PASS' : 'FAIL'}`);
  console.log(`==========================================\n`);
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

  const rawAccountType = String(prefsRecord?.account_type || '');
  let rawMode = prefsRecord?.position_mode || prefsRecord?.position_size_mode;
  if (!rawMode && rawAccountType.includes('MODE:FIXED_LOT')) {
    rawMode = 'FIXED_LOT';
  }
  if (!rawMode) rawMode = 'AUTO_RISK';
  const positionMode: 'AUTO_RISK' | 'FIXED_LOT' = rawMode === 'FIXED_LOT' ? 'FIXED_LOT' : 'AUTO_RISK';

  let rawLot = prefsRecord?.preferred_lot_size || prefsRecord?.fixed_lot_size || prefsRecord?.custom_lot_size;
  if (!rawLot && rawAccountType.includes('|LOT:')) {
    const lotMatch = rawAccountType.match(/\|LOT:([0-9.]+)/);
    if (lotMatch) rawLot = lotMatch[1];
  }
  if (!rawLot) rawLot = '0.01';
  const parsedLot = parseFloat(String(rawLot).replace(/[^0-9.]/g, ""));
  const preferredLotSize = isNaN(parsedLot) || parsedLot <= 0 ? 0.01 : parsedLot;

  return {
    accountSize,
    riskPercentage,
    riskRewardStr,
    maxDailyRiskStr,
    strategySummary,
    dbTimestamp,
    positionMode,
    preferredLotSize
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
  reason: string,
  executableLotDisplay: string = accepted ? requiredLot.toString() : 'NONE'
): void {
  console.log(`\n========== RISK VALIDATION ==========`);
  console.log(`Capital: $${accountSize.toFixed(2)}`);
  console.log(`Risk %: ${riskPercentage}%`);
  console.log(`Risk Amount: $${riskAmount.toFixed(2)}`);
  console.log(`Required Lot: ${requiredLot.toFixed(4)}`);
  console.log(`Minimum Lot: ${minLot}`);
  console.log(`Executable Lot: ${executableLotDisplay}`);
  console.log(`Theoretical Expected Loss: $${expectedLossAtRequiredLot.toFixed(2)}`);
  console.log(`Minimum Lot Expected Loss: $${expectedLossAtMinLot.toFixed(2)}`);
  console.log(`Trade Accepted: ${accepted ? 'YES' : 'NO'}`);
  console.log(`Reason: ${reason}`);
  console.log(`====================================\n`);
}

/**
 * Calculates position size, strictly enforcing instrument-specific broker minimum lot,
 * backend TP calculation, and RR validation (within 1% tolerance).
 */
export function calculatePositionSize(config: {
  accountSize: number;
  riskPercentage: number;
  entryPrice: number;
  executedEntry?: number;
  stopLoss: number;
  takeProfit?: number | null;
  geminiTp?: number | null;
  symbol: string;
  direction?: string;
  riskRewardStr?: string;
  positionMode?: 'AUTO_RISK' | 'FIXED_LOT';
  preferredLotSize?: number;
}): PositionSizeResult {
  const riskAmount = config.accountSize * (config.riskPercentage / 100);
  const direction = (config.direction || 'BUY').toUpperCase();
  const userRr = config.riskRewardStr || '1:2';
  const targetRrRatio = parseRiskRewardRatio(userRr);

  // Resolve instrument specification
  const spec = resolveInstrumentSpec(config.symbol);
  const { assetClass, contractSize, minLot, lotStep, tickSize } = spec;

  // 1. Determine Intended Entry Price
  const intendedEntry = config.entryPrice;
  // 4. Retrieve Actual Executed Entry Price
  const executedEntry = config.executedEntry !== undefined ? config.executedEntry : intendedEntry;

  // 2. Calculate Risk Distance
  let riskDistance = direction === 'SELL' ? config.stopLoss - intendedEntry : intendedEntry - config.stopLoss;
  riskDistance = Math.abs(riskDistance);

  // 3. Calculate TP
  const rawProvidedTp = config.takeProfit !== undefined && config.takeProfit !== null ? Number(config.takeProfit) : (config.geminiTp !== undefined && config.geminiTp !== null ? Number(config.geminiTp) : null);
  const isProvidedTpValid = rawProvidedTp !== null && !isNaN(rawProvidedTp) && rawProvidedTp > 0 &&
    (direction === 'BUY' ? rawProvidedTp > executedEntry : rawProvidedTp < executedEntry);

  const calculatedTP = isProvidedTpValid
    ? rawProvidedTp!
    : (direction === 'SELL' ? intendedEntry - (riskDistance * targetRrRatio) : intendedEntry + (riskDistance * targetRrRatio));

  // Check tick difference
  const diff = Math.abs(executedEntry - intendedEntry);
  if (diff > tickSize) {
    console.log(`[Execution Validation] Executed entry (${executedEntry}) differs from intended entry (${intendedEntry}) by ${diff.toFixed(5)} (> 1 tick ${tickSize}). Automatically recomputing TP and SL.`);
  }

  // 5. Recalculate Stop Loss, Take Profit using ONLY the executed entry
  const executedSL = direction === 'SELL' ? executedEntry + riskDistance : executedEntry - riskDistance;
  const executedTP = isProvidedTpValid
    ? rawProvidedTp!
    : (direction === 'SELL' ? executedEntry - (riskDistance * targetRrRatio) : executedEntry + (riskDistance * targetRrRatio));

  const stopDistance = Math.abs(executedEntry - executedSL);
  const tpDistance = Math.abs(executedTP - executedEntry);
  const actualRisk = stopDistance;
  const actualReward = tpDistance;
  const actualRr = actualRisk > 0 ? actualReward / actualRisk : 0;

  // Phase 5: Stop Loss & Take Profit Structural Validation
  let slValidationPassed = true;
  let slValidationError = '';
  if (direction === 'SELL') {
    if (executedSL <= executedEntry || executedTP >= executedEntry) {
      slValidationPassed = false;
      slValidationError = `Invalid SELL StopLoss/TakeProfit: SL (${executedSL}) must be > Entry (${executedEntry}) and TP (${executedTP}) must be < Entry (${executedEntry})`;
    }
  } else {
    if (executedSL >= executedEntry || executedTP <= executedEntry) {
      slValidationPassed = false;
      slValidationError = `Invalid BUY StopLoss/TakeProfit: SL (${executedSL}) must be < Entry (${executedEntry}) and TP (${executedTP}) must be > Entry (${executedEntry})`;
    }
  }

  // Validate RR: actual R:R must satisfy target/minimum RR (within 1% or 0.01 tolerance)
  const expectedRrNumeric = targetRrRatio;
  const rrValidationPassed = expectedRrNumeric === 0 ? false : (actualRr >= expectedRrNumeric - 0.01);

  logRrValidationAudit(
    executedEntry,
    executedSL,
    executedTP,
    stopDistance,
    tpDistance,
    userRr,
    actualRr,
    rrValidationPassed && slValidationPassed
  );

  const cleanSym = (config.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  let pipValue = 10.00;
  let lossPerOneLot = 0;
  let profitPerOneLot = 0;

  if (assetClass === 'Crypto') {
    pipValue = 0.01;
    lossPerOneLot = stopDistance * contractSize;
    profitPerOneLot = tpDistance * contractSize;
  } else if (assetClass === 'Gold') {
    pipValue = contractSize * 0.01;
    lossPerOneLot = stopDistance * contractSize;
    profitPerOneLot = tpDistance * contractSize;
  } else if (assetClass === 'Indices') {
    pipValue = 0.01;
    lossPerOneLot = stopDistance * contractSize;
    profitPerOneLot = tpDistance * contractSize;
  } else {
    if (cleanSym.endsWith('USD')) {
      pipValue = 10.00;
      lossPerOneLot = stopDistance * contractSize;
      profitPerOneLot = tpDistance * contractSize;
    } else if (cleanSym.startsWith('USD')) {
      const pipSize = tickSize;
      pipValue = config.entryPrice > 0 ? (pipSize * contractSize) / config.entryPrice : 10.00;
      lossPerOneLot = config.entryPrice > 0 ? (stopDistance * contractSize) / config.entryPrice : stopDistance * contractSize;
      profitPerOneLot = config.entryPrice > 0 ? (tpDistance * contractSize) / config.entryPrice : 0;
    } else {
      const pipSize = tickSize;
      const estRate = cleanSym.includes('JPY') ? 155.00 : 1.00;
      pipValue = (pipSize * contractSize) / estRate;
      lossPerOneLot = (stopDistance * contractSize) / estRate;
      profitPerOneLot = (tpDistance * contractSize) / estRate;
    }
  }

  let exactLotSize = 0;
  let expectedLossAtRequiredLot = 0;
  let expectedLossAtMinLot = minLot * lossPerOneLot;
  let accepted = true;
  let skipReason = '';

  const positionMode = config.positionMode || 'AUTO_RISK';
  const preferredLotSize = config.preferredLotSize ?? 0.01;

  if (positionMode === 'FIXED_LOT') {
    const requestedLot = preferredLotSize;
    const expectedLossAtFixedLot = requestedLot * lossPerOneLot;
    const expectedProfitAtFixedLot = requestedLot * profitPerOneLot;
    const maxAllowedRisk = riskAmount;

    console.log(`
[Position Sizing]
Mode: FIXED_LOT
Requested Lot: ${requestedLot}
`.trim());

    if (requestedLot < minLot - 1e-7) {
      accepted = false;
      skipReason = `Fixed lot size (${requestedLot}) is below broker minimum lot (${minLot}).`;
    } else {
      const remainder = Math.abs((requestedLot * 1000) % (lotStep * 1000));
      if (remainder > 1e-4 && Math.abs(remainder - lotStep * 1000) > 1e-4) {
        accepted = false;
        skipReason = `Fixed lot size (${requestedLot}) is not aligned to broker lot step (${lotStep}).`;
      } else if (expectedLossAtFixedLot > maxAllowedRisk + 1e-4) {
        accepted = false;
        skipReason = `Fixed lot exceeds maximum allowed risk (Expected loss: $${expectedLossAtFixedLot.toFixed(2)} > Maximum allowed risk: $${maxAllowedRisk.toFixed(2)}).`;
      } else if (!slValidationPassed || !rrValidationPassed) {
        accepted = false;
        skipReason = !slValidationPassed
          ? `Stop loss validation failed: ${slValidationError}`
          : `RR validation failed. Expected RR: ${targetRrRatio}, Actual RR: ${actualRr.toFixed(4)}.`;
      }
    }

    const execDisplay = accepted ? requestedLot.toString() : 'NONE';
    console.log(`
[Trade Risk]
Position Mode: FIXED_LOT
Requested Lot: ${requestedLot}
Maximum Allowed Risk: $${maxAllowedRisk.toFixed(2)}
Expected Loss: $${expectedLossAtFixedLot.toFixed(2)}
Executable Lot: ${execDisplay}
Trade Accepted: ${accepted ? 'YES' : 'NO'}
${accepted ? '' : `Reason: ${skipReason}`}
`.trim());

    return {
      accountSize: config.accountSize,
      riskPercentage: config.riskPercentage,
      riskAmount,
      entryPrice: executedEntry,
      stopLoss: executedSL,
      takeProfit: executedTP,
      stopDistance,
      pipValue,
      contractSize,
      calculatedLotSize: accepted ? requestedLot : 0,
      exactLotSize: requestedLot,
      expectedLoss: expectedLossAtFixedLot,
      expectedProfit: accepted ? expectedProfitAtFixedLot : 0,
      assetClass,
      normalizedLotSize: accepted ? requestedLot : 0,
      lotType: classifyLotType(requestedLot),
      lotStep,
      minLot,
      symbol: config.symbol,
      accepted,
      skipReason: accepted ? `Fixed lot (${requestedLot}) accepted within maximum risk.` : skipReason,
      expectedLossAtRequiredLot: expectedLossAtFixedLot,
      expectedLossAtMinLot,
      userRr,
      geminiTp: config.geminiTp ?? config.takeProfit,
      actualRisk,
      actualReward,
      actualRr,
      rrValidationPassed: rrValidationPassed && slValidationPassed,
      executableLotDisplay: execDisplay,
      theoreticalExpectedLoss: expectedLossAtFixedLot,
      positionMode: 'FIXED_LOT',
      requestedFixedLot: requestedLot
    };
  }

  if (lossPerOneLot > 0 && config.accountSize > 0 && config.riskPercentage > 0) {
    exactLotSize = riskAmount / lossPerOneLot;
    expectedLossAtRequiredLot = exactLotSize * lossPerOneLot;

    // Strict validation: RequiredLot < minLot -> Reject trade. Do NOT round up to minLot. Use epsilon tolerance for float precision.
    if (exactLotSize < minLot - 1e-7) {
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
        skipReason,
        'NONE'
      );

      logExecutionValidationAudit(
        intendedEntry,
        executedEntry,
        diff,
        stopDistance,
        tpDistance,
        userRr,
        actualRr,
        expectedLossAtRequiredLot,
        0,
        false
      );

      return {
        accountSize: config.accountSize,
        riskPercentage: config.riskPercentage,
        riskAmount,
        entryPrice: executedEntry,
        stopLoss: executedSL,
        takeProfit: executedTP,
        stopDistance,
        pipValue,
        contractSize,
        calculatedLotSize: 0,
        exactLotSize: Number(exactLotSize.toFixed(4)),
        expectedLoss: expectedLossAtRequiredLot,
        expectedProfit: 0,
        assetClass,
        normalizedLotSize: 0,
        lotType: 'Below Minimum',
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
        rrValidationPassed,
        executableLotDisplay: 'NONE',
        theoreticalExpectedLoss: expectedLossAtRequiredLot
      };
    }

    if (!slValidationPassed) {
      accepted = false;
      skipReason = `Trade skipped. Stop loss validation failed: ${slValidationError}.`;
      logRiskValidationAudit(
        config.accountSize,
        config.riskPercentage,
        riskAmount,
        exactLotSize,
        minLot,
        expectedLossAtRequiredLot,
        expectedLossAtMinLot,
        accepted,
        skipReason,
        'NONE'
      );

      logExecutionValidationAudit(
        intendedEntry,
        executedEntry,
        diff,
        stopDistance,
        tpDistance,
        userRr,
        actualRr,
        expectedLossAtRequiredLot,
        0,
        false
      );

      return {
        accountSize: config.accountSize,
        riskPercentage: config.riskPercentage,
        riskAmount,
        entryPrice: executedEntry,
        stopLoss: executedSL,
        takeProfit: executedTP,
        stopDistance,
        pipValue,
        contractSize,
        calculatedLotSize: 0,
        exactLotSize: Number(exactLotSize.toFixed(4)),
        expectedLoss: expectedLossAtRequiredLot,
        expectedProfit: 0,
        assetClass,
        normalizedLotSize: 0,
        lotType: classifyLotType(minLot),
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
        rrValidationPassed: rrValidationPassed && slValidationPassed,
        executableLotDisplay: 'NONE',
        theoreticalExpectedLoss: expectedLossAtRequiredLot
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
        skipReason,
        'NONE'
      );

      logExecutionValidationAudit(
        intendedEntry,
        executedEntry,
        diff,
        stopDistance,
        tpDistance,
        userRr,
        actualRr,
        expectedLossAtRequiredLot,
        0,
        false
      );

      return {
        accountSize: config.accountSize,
        riskPercentage: config.riskPercentage,
        riskAmount,
        entryPrice: executedEntry,
        stopLoss: executedSL,
        takeProfit: executedTP,
        stopDistance,
        pipValue,
        contractSize,
        calculatedLotSize: 0,
        exactLotSize: Number(exactLotSize.toFixed(4)),
        expectedLoss: expectedLossAtRequiredLot,
        expectedProfit: 0,
        assetClass,
        normalizedLotSize: 0,
        lotType: classifyLotType(minLot),
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
        rrValidationPassed,
        executableLotDisplay: 'NONE',
        theoreticalExpectedLoss: expectedLossAtRequiredLot
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
    skipReason,
    calculatedLotSize.toString()
  );

  logExecutionValidationAudit(
    intendedEntry,
    executedEntry,
    diff,
    stopDistance,
    tpDistance,
    userRr,
    actualRr,
    expectedLoss,
    expectedProfit,
    accepted && rrValidationPassed
  );

  console.log(`
[Trade Risk]
Direction: ${direction}
Entry: ${executedEntry}
SL: ${executedSL}
TP: ${executedTP}
Stop Distance: ${stopDistance.toFixed(5)}
Risk Amount: $${riskAmount.toFixed(2)}
Required Lot: ${rawLotSizeFormatted}
Minimum Lot: ${minLot}
Executable Lot: ${accepted ? calculatedLotSize.toFixed(2) : 'NONE'}
Expected Loss: $${(accepted ? expectedLoss : expectedLossAtRequiredLot).toFixed(2)}
Minimum Lot Expected Loss: $${expectedLossAtMinLot.toFixed(2)}
R:R: 1:${actualRr.toFixed(2)}
Accepted: ${accepted ? 'YES' : 'NO'}
`.trim());

  return {
    accountSize: config.accountSize,
    riskPercentage: config.riskPercentage,
    riskAmount,
    entryPrice: executedEntry,
    stopLoss: executedSL,
    takeProfit: executedTP,
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
    rrValidationPassed,
    executableLotDisplay: calculatedLotSize.toString(),
    theoreticalExpectedLoss: expectedLossAtRequiredLot
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
