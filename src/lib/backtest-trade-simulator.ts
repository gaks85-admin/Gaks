/**
 * GAKS AI — Deterministic Trade Simulator with Execution Cost Engine (Stage C1–C4)
 * Simulates realistic trade execution, position lifecycle, SL/TP resolution,
 * spread (bid/ask), slippage, commission, swap and overnight rollover financing over historical candles.
 * ABSOLUTE RULE: 100% Deterministic, zero live market or external API calls.
 */

import {
  BacktestSignal,
  BacktestSimulationConfig,
  BacktestTradeRecord,
  TradeExitReason,
  TradeSimulationResult
} from './backtest-types.js';
import { ParsedCandle } from './backtest-csv.js';
import { resolveInstrumentSpec, calculatePositionSize } from './risk-engine.js';

export interface SimulateTradeParams {
  signal: BacktestSignal;
  datasetId: string;
  signalIndex: number;
  candles: ParsedCandle[];
  startIndex: number;
  currentBalance: number;
  initialBalance: number;
  simConfig?: BacktestSimulationConfig;
  symbol: string;
  timeframe: string;
}

/**
 * Calculates overnight swap and rollover financing costs.
 * Applies swap only when a trade crosses the broker rollover boundary (default 22:00 UTC).
 * Supports long and short swap rates, and triple-swap weekday (default Wednesday = day 3).
 */
export function calculateSwapCost(params: {
  entryTimestamp: string;
  exitTimestamp: string;
  direction: 'LONG' | 'SHORT';
  lotSize: number;
  swapLongPerLotPerNight: number;
  swapShortPerLotPerNight: number;
  tripleSwapDay?: number;
  rolloverHourUtc?: number;
}): { swapCost: number; rolloverNightsCount: number } {
  const {
    entryTimestamp,
    exitTimestamp,
    direction,
    lotSize,
    swapLongPerLotPerNight,
    swapShortPerLotPerNight,
    tripleSwapDay = 3,
    rolloverHourUtc = 22
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
  while (curr.getTime() <= endDate.getTime()) {
    const rolloverTs = new Date(
      Date.UTC(curr.getUTCFullYear(), curr.getUTCMonth(), curr.getUTCDate(), rolloverHourUtc, 0, 0)
    ).getTime();

    if (entryTime < rolloverTs && exitTime >= rolloverTs) {
      rolloverNightsCount++;
      const dayOfWeek = new Date(rolloverTs).getUTCDay();
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

/**
 * Simulates a single trade lifecycle from signal generation to exit with realistic costs.
 * Execution Convention:
 * Signal generated at candle N close -> Entry executed at candle N+1 open.
 */
export function simulateTradeLifecycle(params: SimulateTradeParams): TradeSimulationResult {
  const {
    signal,
    datasetId,
    signalIndex,
    candles,
    startIndex = 0,
    currentBalance,
    simConfig = {},
    symbol,
    timeframe
  } = params;

  if (!signal || !candles || candles.length < 2 || currentBalance <= 0) {
    return { trade: null, rejectionReason: 'Insufficient data or invalid balance' };
  }

  const executionModel = simConfig.executionModel || 'NEXT_CANDLE_OPEN';
  const entryCandleIndex = (executionModel === 'NEXT_CANDLE_OPEN' ? 1 : 0) + startIndex;

  if (entryCandleIndex >= candles.length) {
    return { trade: null, rejectionReason: 'Signal occurred at end of dataset' };
  }

  const entryCandle = candles[entryCandleIndex];
  const direction: 'LONG' | 'SHORT' = signal.direction === 'BUY' ? 'LONG' : 'SHORT';

  // 1. Determine Initial Entry Price
  const rawEntryPrice = executionModel === 'NEXT_CANDLE_OPEN' ? entryCandle.open : signal.entryPrice;
  const stopLoss = signal.stopLoss;
  const takeProfit = signal.takeProfit;

  if (stopLoss === undefined || takeProfit === undefined || isNaN(stopLoss) || isNaN(takeProfit)) {
    return { trade: null, rejectionReason: 'Missing or invalid SL/TP levels' };
  }

  // 2. Validate SL and TP Directional Geometry
  if (direction === 'LONG') {
    if (stopLoss >= rawEntryPrice || takeProfit <= rawEntryPrice) {
      return { trade: null, rejectionReason: `Invalid trade geometry: Entry=${rawEntryPrice}, SL=${stopLoss}, TP=${takeProfit}` };
    }
  } else {
    if (stopLoss <= rawEntryPrice || takeProfit >= rawEntryPrice) {
      return { trade: null, rejectionReason: `Invalid trade geometry: Entry=${rawEntryPrice}, SL=${stopLoss}, TP=${takeProfit}` };
    }
  }

  // 3. Resolve Instrument Specs and Position Size
  const spec = resolveInstrumentSpec(symbol);
  const riskPercent = simConfig.riskPercent !== undefined && simConfig.riskPercent > 0 ? simConfig.riskPercent : 1.0;
  const initialBal = params.initialBalance !== undefined && !isNaN(params.initialBalance) ? params.initialBalance : currentBalance;
  const riskCalculationBalance = simConfig.useCompounding ? currentBalance : initialBal;

  // Resolve Spreads, Slippages, Commissions
  const spreadPips = (simConfig.instrumentSpreads && simConfig.instrumentSpreads[symbol] !== undefined)
    ? simConfig.instrumentSpreads[symbol]
    : (simConfig.spreadPips ?? 0);
  const slippagePips = (simConfig.instrumentSlippages && simConfig.instrumentSlippages[symbol] !== undefined)
    ? simConfig.instrumentSlippages[symbol]
    : (simConfig.slippagePips ?? 0);

  const pipsToPrice = spec.tickSize;
  const spreadInPrice = spreadPips * pipsToPrice;
  const halfSpread = spreadInPrice / 2;
  const slippageInPrice = slippagePips * pipsToPrice;

  // Position sizing takes into account entry cost parameters
  const posSizeResult = calculatePositionSize({
    accountSize: riskCalculationBalance,
    riskPercentage: riskPercent,
    positionMode: simConfig.positionMode,
    preferredLotSize: simConfig.preferredLotSize,
    entryPrice: rawEntryPrice,
    stopLoss,
    takeProfit,
    symbol,
    spreadPips,
    slippagePips,
    commissionPerLot: simConfig.commissionPerLot,
    direction: signal.direction
  });

  if (!posSizeResult.accepted || posSizeResult.lots <= 0) {
    return { trade: null, rejectionReason: posSizeResult.reason || 'Position size calculation rejected' };
  }

  const lotSize = posSizeResult.lots;
  const contractSize = spec.contractSize;

  // 4. Executed Entry Price (Ask for LONG, Bid for SHORT)
  const requestedEntryPrice = rawEntryPrice;
  const executedEntryPrice = direction === 'LONG'
    ? rawEntryPrice + halfSpread + slippageInPrice
    : rawEntryPrice - halfSpread - slippageInPrice;

  const spreadCost = Math.round((spreadInPrice * lotSize * contractSize) * 100) / 100;
  const entrySlippageCost = Math.round((slippageInPrice * lotSize * contractSize) * 100) / 100;

  const sameCandlePolicy = simConfig.sameCandlePolicy || 'STOP_LOSS_FIRST';

  let exitTimestamp = entryCandle.timestamp;
  let requestedExitPrice = executedEntryPrice;
  let exitPrice = executedEntryPrice;
  let exitReason: TradeExitReason = 'DATASET_END';
  let tradeExited = false;

  // 5. Candle-by-Candle Position Lifecycle Monitoring
  for (let i = entryCandleIndex; i < candles.length; i++) {
    const c = candles[i];

    if (direction === 'LONG') {
      // For LONG, exit is a SELL (Bid price). Bid = Mid - halfSpread
      const bidHigh = c.high - halfSpread;
      const bidLow = c.low - halfSpread;
      const bidOpen = c.open - halfSpread;

      const hitSL = bidLow <= stopLoss;
      const hitTP = bidHigh >= takeProfit;

      if (hitSL && hitTP) {
        if (sameCandlePolicy === 'STOP_LOSS_FIRST') {
          requestedExitPrice = stopLoss;
          exitPrice = stopLoss - slippageInPrice;
          exitReason = 'SAME_CANDLE_STOP_LOSS';
        } else {
          requestedExitPrice = takeProfit;
          exitPrice = takeProfit - slippageInPrice;
          exitReason = 'TAKE_PROFIT';
        }
        exitTimestamp = c.timestamp;
        tradeExited = true;
        break;
      } else if (hitSL) {
        requestedExitPrice = stopLoss;
        // Gap handling: If open is already below SL, fill at open (Bid)
        exitPrice = Math.min(bidOpen, stopLoss) - slippageInPrice;
        exitReason = 'STOP_LOSS';
        exitTimestamp = c.timestamp;
        tradeExited = true;
        break;
      } else if (hitTP) {
        requestedExitPrice = takeProfit;
        exitPrice = takeProfit - slippageInPrice;
        exitReason = 'TAKE_PROFIT';
        exitTimestamp = c.timestamp;
        tradeExited = true;
        break;
      }
    } else {
      // For SHORT, exit is a BUY (Ask price). Ask = Mid + halfSpread
      const askHigh = c.high + halfSpread;
      const askLow = c.low + halfSpread;
      const askOpen = c.open + halfSpread;

      const hitSL = askHigh >= stopLoss;
      const hitTP = askLow <= takeProfit;

      if (hitSL && hitTP) {
        if (sameCandlePolicy === 'STOP_LOSS_FIRST') {
          requestedExitPrice = stopLoss;
          exitPrice = stopLoss + slippageInPrice;
          exitReason = 'SAME_CANDLE_STOP_LOSS';
        } else {
          requestedExitPrice = takeProfit;
          exitPrice = takeProfit + slippageInPrice;
          exitReason = 'TAKE_PROFIT';
        }
        exitTimestamp = c.timestamp;
        tradeExited = true;
        break;
      } else if (hitSL) {
        requestedExitPrice = stopLoss;
        // Gap handling: If open is already above SL, fill at open (Ask)
        exitPrice = Math.max(askOpen, stopLoss) + slippageInPrice;
        exitReason = 'STOP_LOSS';
        exitTimestamp = c.timestamp;
        tradeExited = true;
        break;
      } else if (hitTP) {
        requestedExitPrice = takeProfit;
        exitPrice = takeProfit + slippageInPrice;
        exitReason = 'TAKE_PROFIT';
        exitTimestamp = c.timestamp;
        tradeExited = true;
        break;
      }
    }
  }

  if (!tradeExited) {
    const lastCandle = candles[candles.length - 1];
    exitTimestamp = lastCandle.timestamp;
    requestedExitPrice = lastCandle.close;
    exitPrice = lastCandle.close;
    exitReason = 'DATASET_END';
  }

  const exitSlippageCost = Math.round((slippageInPrice * lotSize * contractSize) * 100) / 100;
  const slippageCost = Math.round((entrySlippageCost + exitSlippageCost) * 100) / 100;

  // 6. Commission Calculation
  const commissionType = simConfig.commissionType || (simConfig.commissionPerLot !== undefined ? 'ROUND_TURN_PER_LOT' : 'ZERO');
  const rawCommissionPerLot = (simConfig.instrumentCommissions && simConfig.instrumentCommissions[symbol] !== undefined)
    ? simConfig.instrumentCommissions[symbol]
    : (simConfig.commissionPerLot ?? 0);

  let totalCommission = 0;
  if (commissionType === 'ZERO') {
    totalCommission = 0;
  } else if (commissionType === 'FIXED_PER_TRADE') {
    totalCommission = simConfig.fixedCommissionPerTrade ?? 5.0;
  } else if (commissionType === 'PER_LOT_PER_SIDE') {
    totalCommission = rawCommissionPerLot * lotSize * 2;
  } else {
    // ROUND_TURN_PER_LOT
    totalCommission = rawCommissionPerLot * lotSize;
  }

  totalCommission = Math.round(totalCommission * 100) / 100;
  const entryCommission = Math.round((totalCommission / 2) * 100) / 100;
  const exitCommission = Math.round((totalCommission - entryCommission) * 100) / 100;
  const commissionCost = totalCommission;

  // 7. Swap & Rollover Calculation
  const defaultSwaps = (simConfig.instrumentSwaps && simConfig.instrumentSwaps[symbol])
    ? simConfig.instrumentSwaps[symbol]
    : { long: simConfig.swapLongPerLotPerNight ?? 0, short: simConfig.swapShortPerLotPerNight ?? 0 };

  const swapRes = calculateSwapCost({
    entryTimestamp: entryCandle.timestamp,
    exitTimestamp,
    direction,
    lotSize,
    swapLongPerLotPerNight: defaultSwaps.long,
    swapShortPerLotPerNight: defaultSwaps.short,
    tripleSwapDay: simConfig.tripleSwapDay ?? 3,
    rolloverHourUtc: simConfig.rolloverHourUtc ?? 22
  });

  const swapCost = swapRes.swapCost;
  const rolloverNightsCount = swapRes.rolloverNightsCount;

  // 8. Financial Outcomes
  let realizedPriceDiff = 0;
  if (direction === 'LONG') {
    realizedPriceDiff = exitPrice - executedEntryPrice;
  } else {
    realizedPriceDiff = executedEntryPrice - exitPrice;
  }

  const grossPnL = Math.round((realizedPriceDiff * lotSize * contractSize) * 100) / 100;
  const netPnL = Math.round((grossPnL - commissionCost + swapCost) * 100) / 100;

  const balanceBefore = currentBalance;
  const balanceAfter = Math.round((currentBalance + netPnL) * 100) / 100;

  const slDistance = Math.abs(executedEntryPrice - stopLoss);
  const tpDistance = Math.abs(takeProfit - executedEntryPrice);
  const riskRewardRatio = slDistance > 0 ? Math.round((tpDistance / slDistance) * 100) / 100 : 2.0;

  const cleanTs = entryCandle.timestamp.replace(/[^0-9]/g, '');
  const tradeId = `tr_${datasetId}_${signalIndex}_${cleanTs}`;

  const tradeRecord: BacktestTradeRecord = {
    id: tradeId,
    signalId: signal.id,
    symbol,
    timeframe,
    direction,
    entryTimestamp: entryCandle.timestamp,
    exitTimestamp,
    requestedEntryPrice: Math.round(requestedEntryPrice * 100000) / 100000,
    entryPrice: Math.round(executedEntryPrice * 100000) / 100000,
    requestedExitPrice: Math.round(requestedExitPrice * 100000) / 100000,
    exitPrice: Math.round(exitPrice * 100000) / 100000,
    stopLoss,
    takeProfit,
    lotSize,
    riskAmount: Math.round(posSizeResult.riskAmount * 100) / 100,
    riskRewardRatio,
    grossPnL,
    spreadCost,
    entrySlippageCost,
    exitSlippageCost,
    slippageCost,
    entryCommission,
    exitCommission,
    commissionCost,
    swapCost,
    rolloverNightsCount,
    netPnL,
    balanceBefore,
    balanceAfter,
    exitReason
  };

  const exitIndex = candles.findIndex(c => c.timestamp === exitTimestamp);

  return {
    ...tradeRecord,
    trade: tradeRecord,
    exitIndex
  } as any;
}
