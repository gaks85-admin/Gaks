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

/**
 * Calculates position size ensuring Maximum loss = Risk Amount exactly.
 */
export function calculatePositionSize(config: {
  accountSize: number;
  riskPercentage: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit?: number | null;
  symbol: string;
}): PositionSizeResult {
  const riskAmount = config.accountSize * (config.riskPercentage / 100);
  const stopDistance = Math.abs(config.entryPrice - config.stopLoss);
  const cleanSym = (config.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  let assetClass: 'Forex' | 'Gold' | 'Indices' | 'Crypto' = 'Forex';
  let contractSize = 100000;
  let pipValue = 10.00;
  let lossPerOneLot = 0;
  let profitPerOneLot = 0;

  const tpDistance = config.takeProfit ? Math.abs(config.takeProfit - config.entryPrice) : 0;

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

  let exactLotSize = 0;
  let expectedLoss = 0;
  let expectedProfit = 0;

  if (lossPerOneLot > 0 && config.accountSize > 0 && config.riskPercentage > 0) {
    exactLotSize = riskAmount / lossPerOneLot;
    expectedLoss = exactLotSize * lossPerOneLot;
    expectedProfit = exactLotSize * profitPerOneLot;
  }

  const calculatedLotSize = Number(exactLotSize.toFixed(4));

  return {
    accountSize: config.accountSize,
    riskPercentage: config.riskPercentage,
    riskAmount,
    entryPrice: config.entryPrice,
    stopLoss: config.stopLoss,
    takeProfit: config.takeProfit ?? null,
    stopDistance,
    pipValue,
    contractSize,
    calculatedLotSize,
    exactLotSize,
    expectedLoss,
    expectedProfit,
    assetClass
  };
}

/**
 * Prints the verification audit log required by Task 5.
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
}
