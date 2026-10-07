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
  source: string;
}

export function resolveInstrumentSpec(symbol: string): InstrumentSpec {
  const cleanSym = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  let assetClass: AssetClass = 'Forex';
  let contractSize = 100000;
  let minLot = 0.01;
  let maxLot = 100;
  let lotStep = 0.01;
  let tickSize = 0.0001;
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
    source = 'Metals Specification Resolver';
  } else if (
    cleanSym.includes('NAS') ||
    cleanSym.includes('US30') ||
    cleanSym.includes('SPX') ||
    cleanSym.includes('US500') ||
    cleanSym.includes('GER') ||
    cleanSym.includes('UK100') ||
    cleanSym.includes('INDEX') ||
    cleanSym.includes('DOW')
  ) {
    assetClass = 'Indices';
    contractSize = 1;
    minLot = 0.01;
    maxLot = 100;
    lotStep = 0.01;
    tickSize = 0.1;
    source = 'Indices Specification Resolver';
  } else {
    assetClass = 'Forex';
    contractSize = 100000;
    minLot = 0.01;
    maxLot = 100;
    lotStep = 0.01;
    tickSize = cleanSym.includes('JPY') ? 0.001 : 0.0001;
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
    preferredLotSize
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

  const slDistance = Math.abs(entryPrice - stopLoss);
  if (slDistance <= 0) {
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
    const lossPerLot = slDistance * contractSize;
    const expectedLoss = Math.round(finalLots * lossPerLot * 100) / 100;

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
  const lossPerLot = slDistance * contractSize;
  const rawLots = riskAmount / lossPerLot;

  // Round down to lotStep
  const steppedLots = Math.floor(rawLots / lotStep) * lotStep;
  const roundedLots = Math.round(steppedLots * 100) / 100;

  let finalLots = roundedLots;
  if (finalLots < minLot) {
    const lossAtMinLot = minLot * lossPerLot;
    if (lossAtMinLot < accountSize) {
      finalLots = minLot;
    } else {
      return {
        accepted: false,
        lots: 0,
        calculatedLotSize: minLot,
        riskAmount,
        expectedLoss: Math.round(lossAtMinLot * 100) / 100,
        reason: `Calculated lot size (${rawLots.toFixed(4)}) is below broker minimum lot (${minLot}) and exceeds account balance.`
      };
    }
  }

  finalLots = Math.min(finalLots, maxLot);
  const expectedLoss = Math.round(finalLots * lossPerLot * 100) / 100;

  // Reject trade if expected loss exceeds account balance
  if (expectedLoss >= accountSize) {
    return {
      accepted: false,
      lots: 0,
      calculatedLotSize: finalLots,
      riskAmount,
      expectedLoss,
      reason: `Order rejected: Expected loss ($${expectedLoss.toFixed(2)}) exceeds available account balance ($${accountSize.toFixed(2)}).`
    };
  }

  // Reject trade if expected loss exceeds user's requested risk budget by a significant margin.
  // We allow a tiny tolerance ($0.05) for rounding, but otherwise we must respect the budget.
  const maxAllowedRisk = riskAmount + 0.05;

  if (expectedLoss > maxAllowedRisk) {
    let reason = `Order rejected: Expected loss ($${expectedLoss.toFixed(2)}) exceeds your configured risk budget ($${riskAmount.toFixed(2)}).`;
    if (accountSize <= 100 && finalLots === minLot) {
      reason = `Order rejected: On a $${accountSize.toFixed(2)} account, the smallest possible trade (0.01 lot) risks $${expectedLoss.toFixed(2)}, which exceeds your ${riskPercentage}% risk budget ($${riskAmount.toFixed(2)}). Try a larger balance or a tighter stop loss.`;
    }
    return {
      accepted: false,
      lots: 0,
      calculatedLotSize: finalLots,
      riskAmount,
      expectedLoss,
      reason
    };
  }

  let actualRr: number | undefined;
  if (params.takeProfit && slDistance > 0) {
    const tpDistance = Math.abs(params.takeProfit - entryPrice);
    actualRr = Math.round((tpDistance / slDistance) * 100) / 100;
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
    expectedLoss
  };
}
