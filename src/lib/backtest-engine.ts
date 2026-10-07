/**
 * GAKS AI — Deterministic Backtesting Engine (Phase 4)
 * Sequentially evaluates historical OHLC candle datasets without look-ahead bias,
 * live market calls, or Gemini API dependencies.
 */

import {
  BacktestConfig,
  BacktestCandleContext,
  BacktestSignal,
  BacktestTradeRecord,
  BacktestState,
  BacktestEngineResult,
  BacktestStrategy
} from './backtest-types.js';
import { ParsedCandle } from './backtest-csv.js';
import { getBacktestDatasetDetails, getBacktestDatasetCandles } from './backtest-service.js';
import { resolveBacktestStrategy } from './backtest-strategy.js';
import { simulateTradeLifecycle } from './backtest-trade-simulator.js';
import { calculateBacktestAnalytics } from './backtest-analytics.js';

/**
 * Executes a deterministic backtest over a Phase 3 historical dataset.
 */
export async function runBacktest(config: BacktestConfig): Promise<BacktestEngineResult> {
  // 1. Validate Configuration
  if (!config) {
    return createFailedResult(config, 'Configuration object is required');
  }
  if (!config.datasetId || typeof config.datasetId !== 'string' || !config.datasetId.trim()) {
    return createFailedResult(config, 'Valid datasetId is required');
  }
  if (typeof config.initialBalance !== 'number' || isNaN(config.initialBalance) || config.initialBalance <= 0) {
    return createFailedResult(config, 'Initial balance must be a positive number');
  }

  // 2. Load & Validate Dataset
  const datasetDetails = await getBacktestDatasetDetails(config.datasetId);
  if (!datasetDetails.success || !datasetDetails.dataset) {
    return createFailedResult(config, datasetDetails.error || `Dataset with ID "${config.datasetId}" not found`);
  }

  const dataset = datasetDetails.dataset;

  // REJECT non-ready datasets
  if (dataset.status !== 'ready') {
    return createFailedResult(
      config,
      `Cannot run backtest: Dataset "${dataset.name}" is in status "${dataset.status}". Only "ready" datasets can be backtested.`
    );
  }

  // Symbol & Timeframe mismatch warnings/checks
  const normSymbol = (config.symbol || dataset.symbol).trim().toUpperCase();
  const normTimeframe = (config.timeframe || dataset.timeframe).trim().toUpperCase();

  let candles: ParsedCandle[] = await getBacktestDatasetCandles(config.datasetId);
  if (!candles || candles.length === 0) {
    if (datasetDetails.sampleCandles && datasetDetails.sampleCandles.length > 0) {
      candles = datasetDetails.sampleCandles;
    } else {
      return createFailedResult(config, 'Dataset contains zero candles');
    }
  }

  // Ensure strict chronological sorting (timestamp ASC)
  candles = [...candles].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Validate internal chronological integrity
  for (let i = 1; i < candles.length; i++) {
    const prevTs = new Date(candles[i - 1].timestamp).getTime();
    const currTs = new Date(candles[i].timestamp).getTime();

    if (currTs < prevTs) {
      return createFailedResult(config, `Dataset timestamps out of order at index ${i}: ${candles[i].timestamp} < ${candles[i - 1].timestamp}`);
    }
    if (currTs === prevTs) {
      return createFailedResult(config, `Duplicate timestamp detected at index ${i}: ${candles[i].timestamp}`);
    }
  }

  // 3. Time range filtering (if startTime / endTime specified)
  if (config.startTime) {
    const startTs = new Date(config.startTime).getTime();
    candles = candles.filter(c => new Date(c.timestamp).getTime() >= startTs);
  }
  if (config.endTime) {
    const endTs = new Date(config.endTime).getTime();
    candles = candles.filter(c => new Date(c.timestamp).getTime() <= endTs);
  }

  if (candles.length === 0) {
    return createFailedResult(config, 'No candles remaining after applying start/end time filter');
  }

  // 4. Initialize Isolated Backtest State
  const state: BacktestState = {
    balance: config.initialBalance,
    equity: config.initialBalance,
    currentTimestamp: candles[0].timestamp,
    candleIndex: 0,
    signalsGenerated: 0,
    tradesCompleted: 0,
    openPositions: []
  };

  // 5. Instantiate Deterministic Strategy Evaluator
  const strategy: BacktestStrategy = resolveBacktestStrategy(config.strategyId, config.strategyText);

  const signals: BacktestSignal[] = [];
  const trades: BacktestTradeRecord[] = [];
  const rejectedSignals: { timestamp: string; reason: string; direction: string }[] = [];

  let activeTradeUntilIndex = -1;

  // 6. Chronological Engine Loop (NO LOOK-AHEAD BIAS)
  const MAX_HISTORY = 500; // Limit history passed to strategy for performance (enough for EMA 200, ATR, etc.)

  for (let i = 0; i < candles.length; i++) {
    const currentCandle = candles[i];
    
    // Optimizing memory: Instead of slicing whole history, only take what's needed
    const historyStart = Math.max(0, i - MAX_HISTORY);
    const previousCandles = candles.slice(historyStart, i); 

    state.currentTimestamp = currentCandle.timestamp;
    state.candleIndex = i;

    // Do not evaluate new signals if a position is currently open
    if (i <= activeTradeUntilIndex) {
      continue;
    }

    const context: BacktestCandleContext = {
      current: currentCandle,
      previous: previousCandles,
      index: i,
      symbol: normSymbol,
      timeframe: normTimeframe
    };

    // Evaluate strategy
    const signal = strategy.evaluate(context);
    if (signal) {
      signals.push(signal);
      state.signalsGenerated++;

      // Simulate Trade Lifecycle over remaining historical candles
      const remainingCandles = candles.slice(i);
      const simResult = simulateTradeLifecycle({
        signal,
        datasetId: config.datasetId,
        signalIndex: signals.length - 1,
        candles: remainingCandles,
        currentBalance: state.balance,
        simConfig: config.simulation,
        symbol: normSymbol,
        timeframe: normTimeframe
      });

      if (simResult.trade) {
        const simTrade = simResult.trade;
        trades.push(simTrade);
        state.tradesCompleted++;
        state.balance = simTrade.balanceAfter;
        state.equity = simTrade.balanceAfter;

        // Skip candle indices while trade was active
        const exitIndex = candles.findIndex(c => c.timestamp === simTrade.exitTimestamp);
        if (exitIndex !== -1) {
          activeTradeUntilIndex = exitIndex;
        }
      } else {
        rejectedSignals.push({
          timestamp: currentCandle.timestamp,
          reason: simResult.rejectionReason || 'Unknown rejection',
          direction: signal.direction
        });
      }
    }
  }

  const startTime = candles[0].timestamp;
  const endTime = candles[candles.length - 1].timestamp;
  const totalNetPnL = Math.round((state.balance - config.initialBalance) * 100) / 100;

  const analytics = calculateBacktestAnalytics({
    trades,
    startingBalance: config.initialBalance,
    datasetId: config.datasetId,
    symbol: normSymbol,
    timeframe: normTimeframe,
    startTime,
    endTime,
    strategyId: strategy.id,
    strategyName: strategy.name
  });

  return {
    success: true,
    datasetId: config.datasetId,
    symbol: normSymbol,
    timeframe: normTimeframe,
    startTime,
    endTime,
    initialBalance: config.initialBalance,
    finalBalance: state.balance,
    totalNetPnL,
    candlesProcessed: candles.length,
    signalsGenerated: signals.length,
    tradesCompleted: trades.length,
    signals,
    trades,
    rejectedSignals,
    analytics
  };
}

function createFailedResult(config: Partial<BacktestConfig>, error: string): BacktestEngineResult {
  return {
    success: false,
    datasetId: config?.datasetId || '',
    symbol: (config?.symbol || '').toUpperCase(),
    timeframe: (config?.timeframe || '').toUpperCase(),
    startTime: '',
    endTime: '',
    initialBalance: config?.initialBalance || 0,
    finalBalance: config?.initialBalance || 0,
    totalNetPnL: 0,
    candlesProcessed: 0,
    signalsGenerated: 0,
    tradesCompleted: 0,
    signals: [],
    trades: [],
    error
  };
}
