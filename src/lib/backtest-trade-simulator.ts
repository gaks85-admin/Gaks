/**
 * GAKS AI — Deterministic Trade Simulator
 * Simulates realistic trade execution, position lifecycle, SL/TP resolution,
 * spread, slippage, commission, and risk-based lot sizing over historical candles.
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
  simConfig?: BacktestSimulationConfig;
  symbol: string;
  timeframe: string;
}

/**
 * Simulates a single trade lifecycle from signal generation to exit.
 * Execution Convention:
 * Signal generated at candle N close -> Entry executed at candle N+1 open.
 */
export function simulateTradeLifecycle(params: SimulateTradeParams): TradeSimulationResult {
  const {
    signal,
    datasetId,
    signalIndex,
    candles,
    startIndex,
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

  const posSizeResult = calculatePositionSize({
    accountSize: currentBalance,
    riskPercentage: riskPercent,
    positionMode: simConfig.positionMode,
    preferredLotSize: simConfig.preferredLotSize,
    entryPrice: rawEntryPrice,
    stopLoss,
    takeProfit,
    symbol
  });

  if (!posSizeResult.accepted || posSizeResult.lots <= 0) {
    return { trade: null, rejectionReason: posSizeResult.reason || 'Position size calculation rejected' };
  }

  const lotSize = posSizeResult.lots;
  const pipsToPrice = spec.tickSize;

  // 4. Spread, Slippage, Commission Costs
  const spreadPips = simConfig.spreadPips || 0;
  const slippagePips = simConfig.slippagePips || 0;
  const commissionPerLot = simConfig.commissionPerLot || 0;

  const spreadInPrice = spreadPips * pipsToPrice;
  const slippageInPrice = slippagePips * pipsToPrice;

  // Executed entry price includes entry slippage & half spread
  const executedEntryPrice = direction === 'LONG'
    ? rawEntryPrice + slippageInPrice + (spreadInPrice / 2)
    : rawEntryPrice - slippageInPrice - (spreadInPrice / 2);

  const sameCandlePolicy = simConfig.sameCandlePolicy || 'STOP_LOSS_FIRST';

  let exitTimestamp = entryCandle.timestamp;
  let exitPrice = executedEntryPrice;
  let exitReason: TradeExitReason = 'DATASET_END';
  let tradeExited = false;

  // 5. Candle-by-Candle Position Lifecycle Monitoring
  for (let i = entryCandleIndex; i < candles.length; i++) {
    const c = candles[i];

    if (direction === 'LONG') {
      const hitSL = c.low <= stopLoss;
      const hitTP = c.high >= takeProfit;

      if (hitSL && hitTP) {
        // Same-candle SL & TP ambiguity resolution
        if (sameCandlePolicy === 'STOP_LOSS_FIRST') {
          exitPrice = stopLoss - slippageInPrice;
          exitReason = 'SAME_CANDLE_STOP_LOSS';
        } else {
          exitPrice = takeProfit - slippageInPrice;
          exitReason = 'TAKE_PROFIT';
        }
        exitTimestamp = c.timestamp;
        tradeExited = true;
        break;
      } else if (hitSL) {
        exitPrice = stopLoss - slippageInPrice;
        exitReason = 'STOP_LOSS';
        exitTimestamp = c.timestamp;
        tradeExited = true;
        break;
      } else if (hitTP) {
        exitPrice = takeProfit - slippageInPrice;
        exitReason = 'TAKE_PROFIT';
        exitTimestamp = c.timestamp;
        tradeExited = true;
        break;
      }
    } else {
      // SHORT
      const hitSL = c.high >= stopLoss;
      const hitTP = c.low <= takeProfit;

      if (hitSL && hitTP) {
        if (sameCandlePolicy === 'STOP_LOSS_FIRST') {
          exitPrice = stopLoss + slippageInPrice;
          exitReason = 'SAME_CANDLE_STOP_LOSS';
        } else {
          exitPrice = takeProfit + slippageInPrice;
          exitReason = 'TAKE_PROFIT';
        }
        exitTimestamp = c.timestamp;
        tradeExited = true;
        break;
      } else if (hitSL) {
        exitPrice = stopLoss + slippageInPrice;
        exitReason = 'STOP_LOSS';
        exitTimestamp = c.timestamp;
        tradeExited = true;
        break;
      } else if (hitTP) {
        exitPrice = takeProfit + slippageInPrice;
        exitReason = 'TAKE_PROFIT';
        exitTimestamp = c.timestamp;
        tradeExited = true;
        break;
      }
    }
  }

  // 6. Dataset End Handling (if trade remained open until last candle)
  if (!tradeExited) {
    const lastCandle = candles[candles.length - 1];
    exitTimestamp = lastCandle.timestamp;
    exitPrice = lastCandle.close;
    exitReason = 'DATASET_END';
  }

  // 7. Calculate Financial Outcomes
  const contractSize = spec.contractSize;

  // Net PnL is the realized difference between executed prices minus commission.
  // executedEntryPrice and exitPrice ALREADY include spread and slippage.
  const commissionCost = Math.round((commissionPerLot * lotSize) * 100) / 100;
  
  let realizedPriceDiff = 0;
  if (direction === 'LONG') {
    realizedPriceDiff = exitPrice - executedEntryPrice;
  } else {
    realizedPriceDiff = executedEntryPrice - exitPrice;
  }

  const netPnL = Math.round((realizedPriceDiff * lotSize * contractSize - commissionCost) * 100) / 100;

  // For reporting/transparency only:
  const spreadCost = spreadInPrice * lotSize * contractSize;
  const slippageCost = slippageInPrice * 2 * lotSize * contractSize; 
  const totalCosts = Math.round((spreadCost + slippageCost + commissionCost) * 100) / 100;

  const balanceBefore = currentBalance;
  const balanceAfter = Math.round((currentBalance + netPnL) * 100) / 100;

  const slDistance = Math.abs(executedEntryPrice - stopLoss);
  const tpDistance = Math.abs(takeProfit - executedEntryPrice);
  const riskRewardRatio = slDistance > 0 ? Math.round((tpDistance / slDistance) * 100) / 100 : 2.0;

  // Deterministic trade ID
  const cleanTs = entryCandle.timestamp.replace(/[^0-9]/g, '');
  const tradeId = `tr_${datasetId}_${signalIndex}_${cleanTs}`;

  return {
    trade: {
      id: tradeId,
      signalId: signal.id,
      symbol,
      timeframe,
      direction,
      entryTimestamp: entryCandle.timestamp,
      exitTimestamp,
      entryPrice: Math.round(executedEntryPrice * 100000) / 100000,
      exitPrice: Math.round(exitPrice * 100000) / 100000,
      stopLoss,
      takeProfit,
      lotSize,
      riskAmount: Math.round(posSizeResult.riskAmount * 100) / 100,
      riskRewardRatio,
      grossPnL: Math.round((netPnL + totalCosts) * 100) / 100,
      spreadCost: Math.round(spreadCost * 100) / 100,
      slippageCost: Math.round(slippageCost * 100) / 100,
      commissionCost,
      netPnL,
      balanceBefore,
      balanceAfter,
      exitReason
    },
    exitIndex: candles.findIndex(c => c.timestamp === exitTimestamp)
  };
}
