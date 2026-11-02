import { BacktestSimulationConfig, BacktestTradeRecord } from './backtest-types';
import { resolveInstrumentSpec } from './risk-engine';

export interface CostCalculationResult {
  spreadCost: number;
  entrySlippageCost: number;
  exitSlippageCost: number;
  entryCommission: number;
  exitCommission: number;
  swapCost: number;
  totalCosts: number;
}

export function calculateCosts(
  trade: Partial<BacktestTradeRecord>,
  config: BacktestSimulationConfig,
  symbol: string,
  entryTimestamp?: string,
  exitTimestamp?: string
): CostCalculationResult {
  const spec = resolveInstrumentSpec(symbol);
  const pipsToPrice = spec.pipSize || spec.tickSize;
  const contractSize = spec.contractSize;
  const lotSize = trade.lotSize || 0;

  // Spread
  let spreadCost = 0;
  const spreadValuePips = config.spreadSettings?.valuePips ?? config.spreadPips ?? 0;
  const isSpreadEnabled = config.spreadSettings ? config.spreadSettings.type === 'FIXED' : spreadValuePips > 0;
  if (isSpreadEnabled && spreadValuePips > 0) {
    spreadCost = spreadValuePips * pipsToPrice * lotSize * contractSize;
  }

  // Slippage
  let entrySlippageCost = 0;
  let exitSlippageCost = 0;
  const slippageValuePips = config.slippageSettings?.valuePips ?? config.slippagePips ?? 0;
  const isSlippageEnabled = config.slippageSettings ? config.slippageSettings.type === 'FIXED' : slippageValuePips > 0;
  if (isSlippageEnabled && slippageValuePips > 0) {
    entrySlippageCost = slippageValuePips * pipsToPrice * lotSize * contractSize;
    exitSlippageCost = slippageValuePips * pipsToPrice * lotSize * contractSize;
  }

  // Commission
  let entryCommission = 0;
  let exitCommission = 0;
  const commissionValuePerLot = config.commissionSettings?.valuePerLot ?? config.commissionPerLot ?? 0;
  const commissionType = config.commissionSettings?.type ?? (commissionValuePerLot > 0 ? 'ROUND_TURN_PER_LOT' : 'ZERO');
  
  if (commissionType === 'PER_LOT_PER_SIDE' && commissionValuePerLot > 0) {
    entryCommission = commissionValuePerLot * lotSize;
    exitCommission = commissionValuePerLot * lotSize;
  } else if (commissionType === 'ROUND_TURN_PER_LOT' && commissionValuePerLot > 0) {
    entryCommission = commissionValuePerLot * lotSize;
    exitCommission = 0; // Round-turn charged on entry
  }

  // Swap
  let swapCost = 0;
  if (config.swapSettings?.enabled && entryTimestamp && exitTimestamp) {
    const entryDate = new Date(entryTimestamp);
    const exitDate = new Date(exitTimestamp);
    
    // Rollover logic: count days crossed at 23:59:59
    let rollovers = 0;
    const cursor = new Date(entryDate);
    cursor.setUTCHours(23, 59, 59, 999);
    
    while (cursor < exitDate) {
      rollovers++;
      const dayOfWeek = cursor.getUTCDay();
      // Triple swap on specified day (e.g. Wednesday for Forex, day 3)
      if (config.swapSettings.tripleSwapDay !== undefined && dayOfWeek === config.swapSettings.tripleSwapDay) {
        rollovers += 2;
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    
    const rate = trade.direction === 'LONG' ? (config.swapSettings.longRatePerLot || 0) : (config.swapSettings.shortRatePerLot || 0);
    swapCost = rate * lotSize * rollovers;
  }
  
  const totalCosts = spreadCost + entrySlippageCost + exitSlippageCost + entryCommission + exitCommission + swapCost;

  return {
    spreadCost: Math.round(spreadCost * 100) / 100,
    entrySlippageCost: Math.round(entrySlippageCost * 100) / 100,
    exitSlippageCost: Math.round(exitSlippageCost * 100) / 100,
    entryCommission: Math.round(entryCommission * 100) / 100,
    exitCommission: Math.round(exitCommission * 100) / 100,
    swapCost: Math.round(swapCost * 100) / 100,
    totalCosts: Math.round(totalCosts * 100) / 100
  };
}

export interface CalculateSwapCostParams {
  entryTimestamp: string;
  exitTimestamp: string;
  direction: 'LONG' | 'SHORT';
  lotSize: number;
  swapLongPerLotPerNight: number;
  swapShortPerLotPerNight: number;
  tripleSwapDay?: number;
  rolloverHour?: number;
  rolloverTimezone?: string;
}

export function calculateSwapCost(params: CalculateSwapCostParams): { swapCost: number; rolloverNightsCount: number } {
  const {
    entryTimestamp,
    exitTimestamp,
    direction,
    lotSize,
    swapLongPerLotPerNight,
    swapShortPerLotPerNight,
    tripleSwapDay = 3,
    rolloverHour = 22
  } = params;

  const entryTime = new Date(entryTimestamp).getTime();
  const exitTime = new Date(exitTimestamp).getTime();

  if (isNaN(entryTime) || isNaN(exitTime) || exitTime <= entryTime) {
    return { swapCost: 0, rolloverNightsCount: 0 };
  }

  const ratePerNight = direction === 'LONG' ? swapLongPerLotPerNight : swapShortPerLotPerNight;
  if (ratePerNight === 0 || isNaN(ratePerNight)) {
    return { swapCost: 0, rolloverNightsCount: 0 };
  }

  let totalSwap = 0;
  let rolloverNightsCount = 0;

  const startDate = new Date(entryTime);
  startDate.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(exitTime);
  endDate.setUTCHours(0, 0, 0, 0);

  const curr = new Date(startDate.getTime());
  curr.setUTCDate(curr.getUTCDate() - 1);

  const maxDays = 1000;
  let daysProcessed = 0;

  while (curr.getTime() <= endDate.getTime() && daysProcessed < maxDays) {
    daysProcessed++;
    const rolloverTs = Date.UTC(curr.getUTCFullYear(), curr.getUTCMonth(), curr.getUTCDate(), rolloverHour, 0, 0);
    const rolloverDate = new Date(rolloverTs);
    const dayOfWeek = rolloverDate.getUTCDay();

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      curr.setUTCDate(curr.getUTCDate() + 1);
      continue;
    }

    if (entryTime < rolloverTs && exitTime >= rolloverTs) {
      rolloverNightsCount++;
      const multiplier = dayOfWeek === tripleSwapDay ? 3 : 1;
      totalSwap += ratePerNight * lotSize * multiplier;
    }
    curr.setUTCDate(curr.getUTCDate() + 1);
  }

  return {
    swapCost: Math.round(totalSwap * 100) / 100,
    rolloverNightsCount
  };
}
