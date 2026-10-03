import { TradingPreferences } from './types.js';

export interface PositionSizeParams {
  accountSize: number;
  riskPercentage: number;
  entryPrice: number;
  executedEntry?: number;
  stopLoss: number;
  geminiTp?: number;
  symbol: string;
  instrument?: string;
  minLot?: number;
  maxLot?: number;
  lotStep?: number;
  contractSize?: number;
}

export interface PositionSizeResult {
  accepted: boolean;
  lots: number;
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
  if (prefsRecord?.max_daily_risk) {
    const parsed = parseFloat(String(prefsRecord.max_daily_risk).replace(/[^0-9.]/g, ''));
    if (!isNaN(parsed) && parsed > 0) {
      maxDailyLossAmount = parsed;
    }
  }

  const positionMode = prefsRecord?.position_sizing_mode || 'AUTO_RISK';
  const preferredLotSize = prefsRecord?.preferred_lot_size;

  return {
    accountSize,
    riskPercentage,
    maxDailyLossAmount,
    positionMode,
    preferredLotSize,
    riskRewardStr: prefsRecord?.risk_reward_ratio || '1:2',
    maxDailyRiskStr: prefsRecord?.max_daily_risk || '3%'
  };
}

export function calculatePositionSize(params: PositionSizeParams): PositionSizeResult {
  const {
    accountSize,
    riskPercentage,
    entryPrice,
    stopLoss,
    symbol,
    minLot = 0.01,
    maxLot = 100,
    lotStep = 0.01,
    contractSize = symbol.toUpperCase().includes('XAU') || symbol.toUpperCase().includes('GOLD') ? 100 : 100000
  } = params;

  if (accountSize <= 0 || riskPercentage <= 0) {
    return {
      accepted: false,
      lots: 0,
      riskAmount: 0,
      expectedLoss: 0,
      reason: 'Invalid account size or risk percentage'
    };
  }

  const riskAmount = (accountSize * riskPercentage) / 100;
  const slDistance = Math.abs(entryPrice - stopLoss);

  if (slDistance <= 0) {
    return {
      accepted: false,
      lots: 0,
      riskAmount,
      expectedLoss: 0,
      reason: 'Stop loss is equal to entry price'
    };
  }

  // Loss per 1.0 lot = slDistance * contractSize
  const lossPerLot = slDistance * contractSize;
  const rawLots = riskAmount / lossPerLot;

  // Round down to lotStep
  const steppedLots = Math.floor(rawLots / lotStep) * lotStep;
  const roundedLots = Math.round(steppedLots * 100) / 100;

  if (roundedLots < minLot) {
    const lossAtMinLot = minLot * lossPerLot;
    return {
      accepted: false,
      lots: minLot,
      riskAmount,
      expectedLoss: Math.round(lossAtMinLot * 100) / 100,
      reason: `Calculated lot size (${rawLots.toFixed(4)}) is below broker minimum lot (${minLot}). Risk amount $${riskAmount.toFixed(2)} is too small for SL distance ${slDistance.toFixed(2)}.`
    };
  }

  const finalLots = Math.min(roundedLots, maxLot);
  const expectedLoss = Math.round(finalLots * lossPerLot * 100) / 100;

  return {
    accepted: true,
    lots: finalLots,
    riskAmount: Math.round(riskAmount * 100) / 100,
    expectedLoss
  };
}
