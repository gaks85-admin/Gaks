/**
 * GAKS AI — Backtesting Engine Types
 * Defines strongly typed contracts for deterministic backtest configuration,
 * context, state, signals, and strategy adapters.
 */

import { ParsedCandle } from './backtest-csv.js';

export interface BacktestSimulationConfig {
  riskPercent?: number; // e.g. 1.0 = 1% risk per trade
  spreadPips?: number; // Spread cost in pips/points
  slippagePips?: number; // Slippage cost in pips/points
  commissionPerLot?: number; // USD per round-turn lot
  sameCandlePolicy?: 'STOP_LOSS_FIRST' | 'TAKE_PROFIT_FIRST'; // Default: STOP_LOSS_FIRST
  executionModel?: 'NEXT_CANDLE_OPEN' | 'SAME_CANDLE_CLOSE'; // Default: NEXT_CANDLE_OPEN
}

export interface BacktestConfig {
  datasetId: string;
  strategyId?: string;
  strategyText?: string;
  initialBalance: number;
  accountType?: string;
  timeframe: string;
  symbol: string;
  startTime?: string;
  endTime?: string;
  simulation?: BacktestSimulationConfig;
}

export interface BacktestCandleContext {
  current: ParsedCandle;
  previous: ParsedCandle[];
  index: number;
  symbol: string;
  timeframe: string;
}

export type SignalDirection = 'BUY' | 'SELL';

export interface BacktestSignal {
  id: string;
  timestamp: string;
  symbol: string;
  timeframe: string;
  direction: SignalDirection;
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  reason: string;
  confidence: number;
}

export type TradeExitReason = 'STOP_LOSS' | 'TAKE_PROFIT' | 'SAME_CANDLE_STOP_LOSS' | 'DATASET_END';

export interface BacktestTradeRecord {
  id: string;
  signalId: string;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  entryTimestamp: string;
  exitTimestamp: string;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  riskAmount: number;
  riskRewardRatio: number;
  grossPnL: number;
  spreadCost: number;
  slippageCost: number;
  commissionCost: number;
  netPnL: number;
  balanceBefore: number;
  balanceAfter: number;
  exitReason: TradeExitReason;
}

export interface BacktestState {
  balance: number;
  equity: number;
  currentTimestamp: string;
  candleIndex: number;
  signalsGenerated: number;
  tradesCompleted: number;
  openPositions: unknown[];
}

export interface EquityCurvePoint {
  timestamp: string;
  balance: number;
  tradeId?: string;
  drawdown: number;
  drawdownPercent: number;
}

export interface DirectionalAnalytics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  netPnL: number;
  winRate: number | null;
}

export interface BestWorstTradeInfo {
  id: string;
  netPnL: number;
  entryTimestamp: string;
}

export interface BacktestAnalyticsResult {
  datasetId: string;
  symbol: string;
  timeframe: string;
  startTime: string;
  endTime: string;
  strategyId?: string;
  strategyName?: string;
  
  // Account Results
  startingBalance: number;
  endingBalance: number;
  netProfit: number;
  returnPercent: number;

  // Trade Counts & Rates
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRate: number | null;
  lossRate: number | null;

  // Financial P/L Metrics
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;

  // Averages & Expectancy
  averageTrade: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  expectancy: number | null;

  // Maximum Drawdown
  maxDrawdownCurrency: number;
  maxDrawdownPercent: number;
  peakBalanceAtMaxDrawdown: number;
  troughBalanceAtMaxDrawdown: number;

  // Equity Curve Series
  equityCurve: EquityCurvePoint[];

  // Duration
  averageDurationMinutes: number | null;
  longestDurationMinutes: number | null;
  shortestDurationMinutes: number | null;

  // Exit Reason Breakdown
  exitReasonBreakdown: Record<string, number>;

  // Long vs Short
  longTrades: DirectionalAnalytics;
  shortTrades: DirectionalAnalytics;

  // Risk / Reward Analytics
  averagePlannedRR: number | null;
  averageRealizedR: number | null;
  totalRealizedR: number | null;
  winningTradeAverageR: number | null;
  losingTradeAverageR: number | null;

  // Streaks
  longestWinningStreak: number;
  longestLosingStreak: number;
  currentWinningStreak: number;
  currentLosingStreak: number;

  // Best & Worst
  bestTrade: BestWorstTradeInfo | null;
  worstTrade: BestWorstTradeInfo | null;
}

export interface TradeSimulationResult {
  trade: BacktestTradeRecord | null;
  rejectionReason?: string;
}

export interface BacktestEngineResult {
  success: boolean;
  datasetId: string;
  symbol: string;
  timeframe: string;
  startTime: string;
  endTime: string;
  initialBalance: number;
  finalBalance: number;
  totalNetPnL: number;
  candlesProcessed: number;
  signalsGenerated: number;
  tradesCompleted: number;
  signals: BacktestSignal[];
  trades: BacktestTradeRecord[];
  rejectedSignals?: {
    timestamp: string;
    reason: string;
    direction: string;
  }[];
  analytics?: BacktestAnalyticsResult;
  error?: string;
}

export interface BacktestStrategy {
  id: string;
  name: string;
  evaluate(context: BacktestCandleContext): BacktestSignal | null;
}
