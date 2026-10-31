/**
 * GAKS AI — Backtesting Engine Types
 * Defines strongly typed contracts for deterministic backtest configuration,
 * context, state, signals, and strategy adapters.
 */

import { ParsedCandle } from './backtest-csv.js';

import { PropFirmSettings } from './prop-firm-service.js';

export interface HistoricalEconomicEvent {
  id?: string;
  symbol?: string;
  currency?: string;
  timestamp: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
}

export interface HistoricalRestrictionsSummary {
  enabledGates: {
    marketHours: boolean;
    sessionFilter: boolean;
    economicNews: boolean;
    qualityGate: boolean;
    riskGovernor: boolean;
    cooldown: boolean;
    propFirm: boolean;
  };
  gateExecutionOrder: string[];
  totalCandidatesEvaluated: number;
  totalSignalsPassed: number;
  rejectionsByGate: {
    marketHours: number;
    sessionFilter: number;
    economicNews: number;
    qualityGate: number;
    riskGovernor: number;
    cooldown: number;
    propFirm: number;
  };
  rejectionDetails: {
    gate: string;
    reason: string;
    timestamp: string;
    direction: string;
  }[];
  propFirmAudit?: {
    accountType: 'personal' | 'prop';
    settingsApplied: boolean;
    isBreached: boolean;
    breachReason?: string;
    breachTimestamp?: string;
    dailyLossLimit: number;
    maxDailyLossEncountered: number;
    maxDrawdownLimit: number;
    maxDrawdownEncountered: number;
    drawdownType: 'STATIC' | 'TRAILING';
  };
  economicNewsStatus: {
    status: 'NOT_AVAILABLE' | 'AVAILABLE';
    message: string;
    eventsLoaded: number;
  };
  unsimulatableLiveChecks: {
    name: string;
    status: 'UNSIMULATABLE_IN_HISTORICAL_BACKTEST';
    reason: string;
  }[];
}

export interface BacktestSimulationConfig {
  riskPercent?: number; // e.g. 1.0 = 1% risk per trade
  riskRewardRatio?: number; // Overrides strategy default if provided
  useCompounding?: boolean; // If true, risks % of current balance. If false, risks % of initial balance.
  positionMode?: 'AUTO_RISK' | 'FIXED_LOT'; // Default: AUTO_RISK
  preferredLotSize?: number; // Default: 0.01
  spreadPips?: number; // Spread cost in pips/points
  slippagePips?: number; // Slippage cost in pips/points
  commissionPerLot?: number; // USD per round-turn lot or per side
  commissionType?: 'PER_LOT_PER_SIDE' | 'ROUND_TURN_PER_LOT' | 'FIXED_PER_TRADE' | 'ZERO'; // Default: ROUND_TURN_PER_LOT
  fixedCommissionPerTrade?: number; // Fixed USD per trade if FIXED_PER_TRADE
  swapLongPerLotPerNight?: number; // Swap cost per lot per night for long (USD)
  swapShortPerLotPerNight?: number; // Swap cost per lot per night for short (USD)
  tripleSwapDay?: number; // Day of week for triple swap (0=Sun, 3=Wed, etc.)
  rolloverHourUtc?: number; // Hour of day in UTC for broker rollover (default 22)
  instrumentSpreads?: Record<string, number>; // Instrument-specific spread overrides
  instrumentSlippages?: Record<string, number>; // Instrument-specific slippage overrides
  instrumentCommissions?: Record<string, number>; // Instrument-specific commission overrides
  instrumentSwaps?: Record<string, { long: number; short: number }>; // Instrument-specific swap overrides
  sameCandlePolicy?: 'STOP_LOSS_FIRST' | 'TAKE_PROFIT_FIRST'; // Default: STOP_LOSS_FIRST
  executionModel?: 'NEXT_CANDLE_OPEN' | 'SAME_CANDLE_CLOSE'; // Default: NEXT_CANDLE_OPEN
  enforceMarketHours?: boolean; // Default: true
  enforceSessions?: boolean; // Default: true
  enforceQualityGate?: boolean; // Default: true
  enforceRiskGovernor?: boolean; // Default: true
  enforceCooldown?: boolean; // Default: true
  enforcePropFirm?: boolean; // Default: true
}

export interface BacktestConfig {
  datasetId: string;
  strategyId?: string;
  strategyText?: string;
  initialBalance: number;
  accountType?: string;
  propFirmSettings?: PropFirmSettings | null;
  historicalNewsEvents?: HistoricalEconomicEvent[] | null;
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

export type TradeExitReason = 'STOP_LOSS' | 'TAKE_PROFIT' | 'SAME_CANDLE_STOP_LOSS' | 'DATASET_END' | 'BREAKEVEN';

export interface BacktestTradeRecord {
  id: string;
  signalId: string;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  entryTimestamp: string;
  exitTimestamp: string;
  requestedEntryPrice: number;
  entryPrice: number;
  requestedExitPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  riskAmount: number;
  riskRewardRatio: number;
  grossPnL: number;
  spreadCost: number;
  entrySlippageCost: number;
  exitSlippageCost: number;
  slippageCost: number;
  entryCommission: number;
  exitCommission: number;
  commissionCost: number;
  swapCost: number;
  rolloverNightsCount: number;
  netPnL: number;
  balanceBefore: number;
  balanceAfter: number;
  exitReason: TradeExitReason;
  outcome?: 'WIN' | 'LOSS' | 'BREAKEVEN';
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

  // Trading Costs Breakdown
  totalSpreadCost: number;
  totalSlippageCost: number;
  totalCommissionCost: number;
  totalSwapCost: number;
  totalTradingCosts: number;
  costBreakdownByInstrument: Record<string, { spread: number; slippage: number; commission: number; swap: number; total: number }>;
}

export interface TradeSimulationResult {
  trade: BacktestTradeRecord | null;
  rejectionReason?: string;
  exitIndex?: number;
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
  restrictionsSummary?: HistoricalRestrictionsSummary;
  analytics?: BacktestAnalyticsResult;
  error?: string;
}

export interface BacktestStrategy {
  id: string;
  name: string;
  evaluate(context: BacktestCandleContext, simConfig?: BacktestSimulationConfig): BacktestSignal | null;
  reset?(): void;
}
