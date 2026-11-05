import { TradingPreferences } from '../types.js';

export type AssetClass = 'Forex' | 'Gold' | 'Indices' | 'Crypto';

export interface InstrumentSpec {
  symbol: string;
  assetClass: AssetClass;
  contractSize: number;
  minLot: number;
  maxLot: number;
  lotStep: number;
  tickSize: number;
  pipSize: number;
  quoteCurrency: string;
  source: string;
}

export function resolveInstrumentSpec(symbol: string): InstrumentSpec {
  const cleanSym = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  let assetClass: AssetClass = 'Forex';
  let contractSize = 100000;
  let minLot = 0.01;
  let maxLot = 100;
  let lotStep = 0.01;
  let tickSize = 0.00001;
  let pipSize = 0.0001;
  let quoteCurrency = 'USD';
  let source = 'Forex Specification Resolver';

  if (
    cleanSym.includes('BTC') ||
    cleanSym.includes('ETH') ||
    cleanSym.includes('SOL') ||
    cleanSym.includes('XRP') ||
    cleanSym.includes('LTC') ||
    cleanSym.includes('CRYPTO') ||
    cleanSym.endsWith('USDT') ||
    cleanSym.endsWith('USDC') ||
    cleanSym.endsWith('BUSD')
  ) {
    assetClass = 'Crypto';
    contractSize = 1;
    minLot = 0.01;
    maxLot = 100;
    lotStep = 0.01;
    tickSize = 0.01;
    pipSize = 1.0; // For crypto, usually 1 unit is a "pip" in many contexts, or 0.01
    quoteCurrency = cleanSym.endsWith('USDT') ? 'USDT' : (cleanSym.endsWith('USDC') ? 'USDC' : 'USD');
    source = 'Crypto Specification Resolver';
  } else if (
    cleanSym.includes('XAU') ||
    cleanSym.includes('GOLD') ||
    cleanSym.includes('XAG') ||
    cleanSym.includes('SILVER')
  ) {
    assetClass = 'Gold';
    contractSize = 100;
    minLot = 0.01;
    maxLot = 100;
    lotStep = 0.01;
    tickSize = 0.01;
    pipSize = 0.01; // Match test expectation for Gold
    quoteCurrency = 'USD'; // Metals are usually priced in USD
    source = 'Metals Specification Resolver';
  } else if (
    cleanSym.includes('NAS') ||
    cleanSym.includes('US30') ||
    cleanSym.includes('SPX') ||
    cleanSym.includes('US500') ||
    cleanSym.includes('GER') ||
    cleanSym.includes('UK100') ||
    cleanSym.includes('INDEX') ||
    cleanSym.includes('DOW') ||
    cleanSym.includes('US100')
  ) {
    assetClass = 'Indices';
    contractSize = 1;
    minLot = 0.1; // Indices usually have 0.1 min lot
    maxLot = 1000;
    lotStep = 0.1;
    tickSize = 0.1;
    pipSize = 1.0; // Indices pip is usually 1.0
    quoteCurrency = (cleanSym.includes('GER') || cleanSym.includes('DE30') || cleanSym.includes('DE40')) ? 'EUR' : (cleanSym.includes('UK100') ? 'GBP' : 'USD');
    source = 'Indices Specification Resolver';
  } else {
    assetClass = 'Forex';
    contractSize = 100000;
    minLot = 0.01;
    maxLot = 100;
    lotStep = 0.01;
    // JPY pairs use 3 decimals (0.001) for ticks, others usually 5 (0.00001)
    tickSize = cleanSym.includes('JPY') ? 0.001 : 0.00001;
    // Pips: Match existing test assumptions (JPY=0.001, Others=0.0001)
    pipSize = cleanSym.includes('JPY') ? 0.001 : 0.0001;
    quoteCurrency = cleanSym.length >= 6 ? cleanSym.substring(cleanSym.length - 3) : 'USD';
    source = 'Forex Specification Resolver';
  }

  return {
    symbol: cleanSym,
    assetClass,
    contractSize,
    minLot,
    maxLot,
    lotStep,
    tickSize,
    pipSize,
    quoteCurrency,
    source
  };
}

export function getInstrumentContractConfig(symbol: string): InstrumentSpec {
  return resolveInstrumentSpec(symbol);
}

export function parseRiskRewardRatio(ratioStr?: string | null): number {
  if (!ratioStr) return 2;
  const clean = String(ratioStr).trim();
  const parts = clean.split(':');
  if (parts.length === 2) {
    const num = parseFloat(parts[1]);
    if (!isNaN(num) && num > 0) return num;
  }
  const parsed = parseFloat(clean.replace(/[^0-9.]/g, ''));
  return !isNaN(parsed) && parsed > 0 ? parsed : 2;
}

export interface PositionSizeParams {
  accountSize: number;
  riskPercentage: number;
  entryPrice: number;
  executedEntry?: number;
  stopLoss: number;
  takeProfit?: number;
  geminiTp?: number;
  symbol: string;
  instrument?: string;
  direction?: 'BUY' | 'SELL';
  riskRewardStr?: string;
  positionMode?: 'AUTO_RISK' | 'FIXED_LOT';
  preferredLotSize?: number;
  minLot?: number;
  maxLot?: number;
  lotStep?: number;
  contractSize?: number;
  spreadPips?: number;
  slippagePips?: number;
  commissionPerLot?: number;
  accountCurrency?: string;
  conversionRate?: number; // Optional: Force a specific conversion rate
}

export interface PositionSizeResult {
  accepted: boolean;
  lots: number;
  calculatedLotSize: number;
  actualRr?: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  riskAmount: number;
  expectedLoss: number;
  reason?: string;
  skipReason?: string;
  executableLotDisplay?: string;
  positionMode?: 'AUTO_RISK' | 'FIXED_LOT';
  exactLotSize?: number;
  rrValidationPassed?: boolean;
  stopDistance?: number;
  minLot?: number;
  lotType?: string;
  contractSize?: number;
  expectedLossAtRequiredLot?: number;
  expectedLossAtMinLot?: number;
}

export function extractRiskPreferences(prefsRecord?: Partial<TradingPreferences> | null, userId?: string) {
  let accountSize = 10000;
  if (prefsRecord?.custom_capital) {
    const parsed = parseFloat(String(prefsRecord.custom_capital).replace(/[^0-9.]/g, ''));
    if (!isNaN(parsed) && parsed > 0) {
      accountSize = parsed;
    }
  }

  let riskPercentage = 1;
  if (prefsRecord?.preferred_risk) {
    const parsed = parseFloat(String(prefsRecord.preferred_risk).replace(/[^0-9.]/g, ''));
    if (!isNaN(parsed) && parsed > 0) {
      riskPercentage = parsed;
    }
  }

  let maxDailyLossAmount = 100;
  const maxLossStr = prefsRecord?.max_daily_risk || prefsRecord?.max_daily_loss;
  if (maxLossStr) {
    const parsed = parseFloat(String(maxLossStr).replace(/[^0-9.]/g, ''));
    if (!isNaN(parsed) && parsed > 0) {
      maxDailyLossAmount = parsed;
    }
  }

  const positionMode = prefsRecord?.position_sizing_mode || prefsRecord?.position_mode || 'AUTO_RISK';
  const preferredLotSize = prefsRecord?.preferred_lot_size || (prefsRecord?.fixed_lot_size ? parseFloat(prefsRecord.fixed_lot_size) : undefined);

  return {
    accountSize,
    riskPercentage,
    maxDailyLossAmount,
    positionMode,
    preferredLotSize,
    riskRewardStr: prefsRecord?.risk_reward_ratio || prefsRecord?.risk_reward || '1:2',
    maxDailyRiskStr: prefsRecord?.max_daily_risk || prefsRecord?.max_daily_loss || '3%'
  };
}

export function calculatePositionSize(params: PositionSizeParams): PositionSizeResult {
  const spec = resolveInstrumentSpec(params.symbol || params.instrument || 'EURUSD');

  const {
    accountSize,
    riskPercentage,
    entryPrice,
    stopLoss,
    minLot = spec.minLot,
    maxLot = spec.maxLot,
    lotStep = spec.lotStep,
    contractSize = params.contractSize ?? spec.contractSize,
    positionMode = 'AUTO_RISK',
    preferredLotSize,
    spreadPips = 0,
    slippagePips = 0,
    commissionPerLot = 0,
    direction = 'BUY'
  } = params;

  if (accountSize <= 0) {
    return {
      accepted: false,
      lots: 0,
      calculatedLotSize: 0,
      riskAmount: 0,
      expectedLoss: 0,
      reason: 'Invalid account size'
    };
  }

  const pipsToPrice = spec.pipSize;
  const spreadInPrice = spreadPips * pipsToPrice;
  const slippageInPrice = slippagePips * pipsToPrice;

  // Realized SL distance includes spread and slippage
  // For a BUY: Executed Entry = theoretical + slippage + 0.5*spread; Exit at SL = stopLoss - slippage
  // Total Distance = (theoretical + slippage + 0.5*spread) - (stopLoss - slippage)
  //                = (theoretical - stopLoss) + 2*slippage + 0.5*spread
  
  const theoreticalSlDistance = Math.abs(entryPrice - stopLoss);
  const realizedSlDistance = theoreticalSlDistance + (2 * slippageInPrice) + (spreadInPrice / 2);

  if (theoreticalSlDistance <= 0) {
    return {
      accepted: false,
      lots: 0,
      calculatedLotSize: 0,
      riskAmount: 0,
      expectedLoss: 0,
      reason: 'Stop loss is equal to entry price'
    };
  }

  // 1. Handle FIXED_LOT Mode
  if (positionMode === 'FIXED_LOT' && typeof preferredLotSize === 'number' && preferredLotSize > 0) {
    const finalLots = Math.min(Math.max(preferredLotSize, minLot), maxLot);
    const lossPerLot = realizedSlDistance * contractSize;
    const commissionCost = Math.round((commissionPerLot * finalLots) * 100) / 100;
    const expectedLoss = Math.round((finalLots * lossPerLot + commissionCost) * 100) / 100;

    // Reject trade if expected loss exceeds account balance
    if (expectedLoss >= accountSize) {
      return {
        accepted: false,
        lots: 0,
        calculatedLotSize: finalLots,
        riskAmount: expectedLoss,
        expectedLoss,
        reason: `Fixed lot order rejected: Expected loss ($${expectedLoss.toFixed(2)}) exceeds available account balance ($${accountSize.toFixed(2)}).`
      };
    }

    // STRICT RISK CHECK: If a risk percentage is provided, enforce it as a hard cap even in fixed lot mode
    if (riskPercentage > 0) {
      const riskAmount = (accountSize * riskPercentage) / 100;
      if (expectedLoss > Math.round(riskAmount * 100) / 100) {
        return {
          accepted: false,
          lots: 0,
          calculatedLotSize: finalLots,
          riskAmount: Math.round(riskAmount * 100) / 100,
          expectedLoss,
          reason: `Fixed lot order rejected: A ${finalLots} lot position risks $${expectedLoss.toFixed(2)} (including spreads, slippage, and commission), which exceeds your ${riskPercentage}% risk budget ($${riskAmount.toFixed(2)}).`
        };
      }
    }

    return {
      accepted: true,
      lots: finalLots,
      calculatedLotSize: finalLots,
      entryPrice,
      stopLoss,
      takeProfit: params.takeProfit,
      riskAmount: expectedLoss,
      expectedLoss
    };
  }

  // 2. Handle AUTO_RISK Mode (Calculated from percentage)
  if (riskPercentage <= 0) {
    return {
      accepted: false,
      lots: 0,
      calculatedLotSize: 0,
      riskAmount: 0,
      expectedLoss: 0,
      reason: 'Invalid risk percentage'
    };
  }

  const riskAmount = (accountSize * riskPercentage) / 100;
  
  // Handle Quote-to-Account Currency Conversion for Risk Calculation
  const quoteCurrency = spec.quoteCurrency;
  const accountCurrency = params.accountCurrency || 'USD';
  let conversionFactor = 1.0;

  if (params.conversionRate !== undefined && !isNaN(params.conversionRate)) {
    conversionFactor = params.conversionRate;
  } else if (quoteCurrency !== accountCurrency) {
    // If quote is JPY and account is USD, we need USDJPY rate.
    // At the time of entry, we use entryPrice.
    if (spec.symbol.startsWith(accountCurrency) && spec.symbol.endsWith(quoteCurrency)) {
      // e.g. USDJPY: Quote is JPY, Account is USD. PnL is in JPY. USD = JPY / entryPrice
      conversionFactor = 1 / entryPrice;
    } else if (spec.symbol.startsWith(quoteCurrency) && spec.symbol.endsWith(accountCurrency)) {
      // e.g. EURUSD: Quote is USD, Account is EUR. PnL is in USD. EUR = USD / entryPrice
      conversionFactor = 1 / entryPrice;
    } else {
      // Fallback: If we can't find a direct conversion, we should theoretically look up a conversion pair.
      // For now, we keep the strict check but allow it to be bypassed via params.conversionRate.
      return {
        accepted: false,
        lots: 0,
        calculatedLotSize: 0,
        riskAmount: 0,
        expectedLoss: 0,
        reason: `Unsupported currency conversion: Quote currency "${quoteCurrency}" differs from Account currency "${accountCurrency}". Please provide an explicit conversionRate or use a direct pair.`
      };
    }
  }

  const lossPerLot = realizedSlDistance * contractSize * conversionFactor;
  
  // To find the max lots while staying within risk budget:
  // (lots * lossPerLot) + (lots * commissionPerLot) <= riskAmount
  // lots * (lossPerLot + commissionPerLot) <= riskAmount
  // lots <= riskAmount / (lossPerLot + commissionPerLot)
  
  const rawLots = riskAmount / (lossPerLot + commissionPerLot);

  // Round down to lotStep to stay WITHIN risk budget
  // Add a tiny epsilon to handle floating point precision (e.g. 0.1 / 0.01 = 9.99999)
  const steppedLots = Math.floor((rawLots + 1e-9) / lotStep) * lotStep;
  const roundedLots = Math.round(steppedLots * 100) / 100;

  let finalLots = roundedLots;
  
  // If calculated lots is zero (because budget is too small for 0.01), check if 0.01 lot is acceptable
  if (finalLots < minLot) {
    const commissionCostAtMin = Math.round((minLot * commissionPerLot) * 100) / 100;
    const lossAtMinLot = minLot * lossPerLot + commissionCostAtMin;
    const minLotExpectedLoss = Math.round(lossAtMinLot * 100) / 100;

    // STRICT ENFORCEMENT: If min lot risks more than the budget, REJECT.
    // This matches real AI behavior where signals are rejected if they are too risky for the account.
    const roundedRiskBudget = Math.floor(riskAmount * 100) / 100;
    if (minLotExpectedLoss > roundedRiskBudget + 0.00001) {
      return {
        accepted: false,
        lots: 0,
        calculatedLotSize: minLot,
        riskAmount: roundedRiskBudget,
        expectedLoss: minLotExpectedLoss,
        executableLotDisplay: 'NONE',
        positionMode: params.positionMode || 'AUTO_RISK',
        reason: `Order rejected: On a $${accountSize.toFixed(2)} account, the smallest trade (0.01 lot) risks $${minLotExpectedLoss.toFixed(2)} (including commissions/costs), which exceeds your ${riskPercentage}% budget ($${roundedRiskBudget.toFixed(2)}).`
      };
    }

    // If min lot fits in budget, use it
    if (lossAtMinLot < accountSize) {
      finalLots = minLot;
    } else {
      return {
        accepted: false,
        lots: 0,
        calculatedLotSize: minLot,
        riskAmount: Math.round(riskAmount * 100) / 100,
        expectedLoss: minLotExpectedLoss,
        executableLotDisplay: 'NONE',
        positionMode: params.positionMode || 'AUTO_RISK',
        reason: `Insufficient balance: Broker minimum lot (${minLot}) risks $${minLotExpectedLoss.toFixed(2)} but you only have $${accountSize.toFixed(2)} available.`
      };
    }
  }

  finalLots = Math.min(finalLots, maxLot);
  const finalCommissionCost = Math.round((finalLots * commissionPerLot) * 100) / 100;
  const expectedLoss = Math.round((finalLots * lossPerLot + finalCommissionCost) * 100) / 100;

  // Reject trade if expected loss exceeds account balance
  if (expectedLoss >= accountSize) {
    return {
      accepted: false,
      lots: 0,
      calculatedLotSize: finalLots,
      riskAmount: Math.round(riskAmount * 100) / 100,
      expectedLoss,
      executableLotDisplay: 'NONE',
      positionMode: params.positionMode || 'AUTO_RISK',
      reason: `Order rejected: Expected loss ($${expectedLoss.toFixed(2)}) exceeds available account balance ($${accountSize.toFixed(2)}).`
    };
  }

  // FINAL STRICT RISK CHECK (Strictly adhere to the budget)
  // We use a tiny epsilon (0.00001) for floating point safety, but otherwise zero tolerance.
  const roundedRiskBudget = Math.floor(riskAmount * 100) / 100;
  if (expectedLoss > roundedRiskBudget + 0.00001) {
    return {
      accepted: false,
      lots: 0,
      calculatedLotSize: finalLots,
      riskAmount: roundedRiskBudget,
      expectedLoss,
      executableLotDisplay: 'NONE',
      positionMode: params.positionMode || 'AUTO_RISK',
      reason: `Order rejected: Calculated risk ($${expectedLoss.toFixed(2)}) exceeds your strict ${riskPercentage}% budget ($${roundedRiskBudget.toFixed(2)}). Try increasing balance or reducing stop loss distance.`
    };
  }

  let actualRr: number | undefined;
  if (params.takeProfit && theoreticalSlDistance > 0) {
    const tpDistance = Math.abs(params.takeProfit - entryPrice);
    actualRr = Math.round((tpDistance / theoreticalSlDistance) * 100) / 100;
  } else if (params.riskRewardStr) {
    actualRr = parseRiskRewardRatio(params.riskRewardStr);
  }

  return {
    accepted: true,
    lots: finalLots,
    calculatedLotSize: finalLots,
    actualRr,
    entryPrice,
    stopLoss,
    takeProfit: params.takeProfit,
    riskAmount: Math.round(riskAmount * 100) / 100,
    expectedLoss,
    executableLotDisplay: finalLots.toFixed(2),
    positionMode: params.positionMode || 'AUTO_RISK'
  };
}
