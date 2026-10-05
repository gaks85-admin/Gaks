/**
 * GAKS AI — Deterministic Backtest Performance Analytics (Phase 6)
 * Pure, deterministic analytics module that calculates account results, win rates,
 * profit factor, maximum drawdown, equity curve, trade duration, streaks, and R-multiples
 * from completed Phase 5 trade records.
 */

import {
  BacktestTradeRecord,
  BacktestAnalyticsResult,
  EquityCurvePoint,
  DirectionalAnalytics,
  BestWorstTradeInfo
} from './backtest-types.js';

export interface CalculateAnalyticsParams {
  trades: BacktestTradeRecord[];
  startingBalance: number;
  datasetId?: string;
  symbol?: string;
  timeframe?: string;
  startTime?: string;
  endTime?: string;
  strategyId?: string;
  strategyName?: string;
}

export function calculateBacktestAnalytics(params: CalculateAnalyticsParams): BacktestAnalyticsResult {
  const {
    trades = [],
    startingBalance = 100000,
    datasetId = '',
    symbol = '',
    timeframe = '',
    startTime = '',
    endTime = '',
    strategyId = '',
    strategyName = ''
  } = params;

  // Ensure deterministic chronological ordering by entry timestamp
  const sortedTrades = [...trades].sort(
    (a, b) => new Date(a.entryTimestamp).getTime() - new Date(b.entryTimestamp).getTime()
  );

  const totalTrades = sortedTrades.length;

  // Zero-trade safe defaults
  if (totalTrades === 0) {
    const startPoint: EquityCurvePoint = {
      timestamp: startTime || 'START',
      balance: startingBalance,
      drawdown: 0,
      drawdownPercent: 0
    };

    const emptyDirectional: DirectionalAnalytics = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      breakevenTrades: 0,
      netPnL: 0,
      winRate: null
    };

    return {
      datasetId,
      symbol,
      timeframe,
      startTime,
      endTime,
      strategyId,
      strategyName,
      startingBalance,
      endingBalance: startingBalance,
      netProfit: 0,
      returnPercent: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      breakevenTrades: 0,
      winRate: null,
      lossRate: null,
      grossProfit: 0,
      grossLoss: 0,
      profitFactor: null,
      averageTrade: null,
      averageWin: null,
      averageLoss: null,
      expectancy: null,
      maxDrawdownCurrency: 0,
      maxDrawdownPercent: 0,
      peakBalanceAtMaxDrawdown: startingBalance,
      troughBalanceAtMaxDrawdown: startingBalance,
      equityCurve: [startPoint],
      averageDurationMinutes: null,
      longestDurationMinutes: null,
      shortestDurationMinutes: null,
      exitReasonBreakdown: {},
      longTrades: emptyDirectional,
      shortTrades: emptyDirectional,
      averagePlannedRR: null,
      averageRealizedR: null,
      totalRealizedR: null,
      winningTradeAverageR: null,
      losingTradeAverageR: null,
      longestWinningStreak: 0,
      longestLosingStreak: 0,
      currentWinningStreak: 0,
      currentLosingStreak: 0,
      bestTrade: null,
      worstTrade: null
    };
  }

  // 1. Classification and P/L Totals
  let winningTrades = 0;
  let losingTrades = 0;
  let breakevenTrades = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  // Long vs Short Tracking
  let longTotal = 0, longWins = 0, longLosses = 0, longBreakeven = 0, longPnL = 0;
  let shortTotal = 0, shortWins = 0, shortLosses = 0, shortBreakeven = 0, shortPnL = 0;

  // R-Multiple Tracking
  let totalPlannedRRSum = 0;
  let plannedRRCount = 0;
  let totalRealizedRSum = 0;
  let realizedRCount = 0;
  let winningRealizedRSum = 0;
  let winningRCount = 0;
  let losingRealizedRSum = 0;
  let losingRCount = 0;

  // Duration Tracking
  let totalDurationMs = 0;
  let longestDurationMs = -1;
  let shortestDurationMs = Infinity;

  // Streaks
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;

  // Best / Worst
  let bestTrade: BestWorstTradeInfo | null = null;
  let worstTrade: BestWorstTradeInfo | null = null;

  // Exit Reasons
  const exitReasonBreakdown: Record<string, number> = {};

  // Maximum Drawdown & Equity Curve
  let runningPeak = startingBalance;
  let maxDrawdownCurrency = 0;
  let maxDrawdownPercent = 0;
  let peakAtMaxDd = startingBalance;
  let troughAtMaxDd = startingBalance;

  const equityCurve: EquityCurvePoint[] = [
    {
      timestamp: startTime || sortedTrades[0].entryTimestamp,
      balance: startingBalance,
      drawdown: 0,
      drawdownPercent: 0
    }
  ];

  sortedTrades.forEach(t => {
    const netPnL = t.netPnL;

    // Classification
    if (netPnL > 0) {
      winningTrades++;
      grossProfit += netPnL;

      currentWinStreak++;
      currentLossStreak = 0;
      if (currentWinStreak > longestWinStreak) longestWinStreak = currentWinStreak;
    } else if (netPnL < 0) {
      losingTrades++;
      grossLoss += Math.abs(netPnL);

      currentLossStreak++;
      currentWinStreak = 0;
      if (currentLossStreak > longestLossStreak) longestLossStreak = currentLossStreak;
    } else {
      breakevenTrades++;
      currentWinStreak = 0;
      currentLossStreak = 0;
    }

    // Directional
    if (t.direction === 'LONG') {
      longTotal++;
      longPnL += netPnL;
      if (netPnL > 0) longWins++;
      else if (netPnL < 0) longLosses++;
      else longBreakeven++;
    } else {
      shortTotal++;
      shortPnL += netPnL;
      if (netPnL > 0) shortWins++;
      else if (netPnL < 0) shortLosses++;
      else shortBreakeven++;
    }

    // Exit Reason
    const reason = t.exitReason || 'UNKNOWN';
    exitReasonBreakdown[reason] = (exitReasonBreakdown[reason] || 0) + 1;

    // Duration
    const entryTime = new Date(t.entryTimestamp).getTime();
    const exitTime = new Date(t.exitTimestamp).getTime();
    if (!isNaN(entryTime) && !isNaN(exitTime) && exitTime >= entryTime) {
      const durationMs = exitTime - entryTime;
      totalDurationMs += durationMs;
      if (durationMs > longestDurationMs) longestDurationMs = durationMs;
      if (durationMs < shortestDurationMs) shortestDurationMs = durationMs;
    }

    // R-Multiples
    if (t.riskRewardRatio && !isNaN(t.riskRewardRatio)) {
      totalPlannedRRSum += t.riskRewardRatio;
      plannedRRCount++;
    }

    if (t.riskAmount && t.riskAmount > 0) {
      const realizedR = netPnL / t.riskAmount;
      totalRealizedRSum += realizedR;
      realizedRCount++;

      if (netPnL > 0) {
        winningRealizedRSum += realizedR;
        winningRCount++;
      } else if (netPnL < 0) {
        losingRealizedRSum += realizedR;
        losingRCount++;
      }
    }

    // Best / Worst
    if (!bestTrade || netPnL > bestTrade.netPnL) {
      bestTrade = { id: t.id, netPnL, entryTimestamp: t.entryTimestamp };
    }
    if (!worstTrade || netPnL < worstTrade.netPnL) {
      worstTrade = { id: t.id, netPnL, entryTimestamp: t.entryTimestamp };
    }

    // Equity Curve & Drawdown
    const currBalance = t.balanceAfter;
    if (currBalance > runningPeak) {
      runningPeak = currBalance;
    }

    const currentDrawdown = runningPeak - currBalance;
    const currentDrawdownPct = runningPeak > 0 ? (currentDrawdown / runningPeak) * 100 : 0;

    if (currentDrawdown > maxDrawdownCurrency) {
      maxDrawdownCurrency = currentDrawdown;
      maxDrawdownPercent = currentDrawdownPct;
      peakAtMaxDd = runningPeak;
      troughAtMaxDd = currBalance;
    }

    equityCurve.push({
      timestamp: t.exitTimestamp,
      balance: Math.round(currBalance * 100) / 100,
      tradeId: t.id,
      drawdown: Math.round(currentDrawdown * 100) / 100,
      drawdownPercent: Math.round(currentDrawdownPct * 100) / 100
    });
  });

  // Final Calculations & Rounding
  const endingBalance = sortedTrades[sortedTrades.length - 1].balanceAfter;
  const netProfit = Math.round((endingBalance - startingBalance) * 100) / 100;
  const returnPercent = startingBalance > 0 ? Math.round((netProfit / startingBalance) * 10000) / 100 : 0;

  const winRate = Math.round((winningTrades / totalTrades) * 10000) / 100;
  const lossRate = Math.round((losingTrades / totalTrades) * 10000) / 100;

  const roundedGrossProfit = Math.round(grossProfit * 100) / 100;
  const roundedGrossLoss = Math.round(grossLoss * 100) / 100;

  // Profit Factor (safe null when 0 gross loss)
  const profitFactor = roundedGrossLoss === 0
    ? null
    : Math.round((roundedGrossProfit / roundedGrossLoss) * 100) / 100;

  // Averages
  const averageTrade = Math.round((netProfit / totalTrades) * 100) / 100;
  const averageWin = winningTrades > 0 ? Math.round((roundedGrossProfit / winningTrades) * 100) / 100 : null;
  const averageLoss = losingTrades > 0 ? Math.round((roundedGrossLoss / losingTrades) * 100) / 100 : null;

  // Expectancy = (winRate * avgWin) - (lossRate * avgLoss)
  let expectancy: number | null = null;
  if (winningTrades > 0 || losingTrades > 0) {
    const winProb = winningTrades / totalTrades;
    const lossProb = losingTrades / totalTrades;
    const avgW = averageWin || 0;
    const avgL = averageLoss || 0;
    expectancy = Math.round((winProb * avgW - lossProb * avgL) * 100) / 100;
  }

  // Duration
  const averageDurationMinutes = totalDurationMs > 0 ? Math.round((totalDurationMs / totalTrades / (1000 * 60)) * 10) / 10 : null;
  const longestDurationMinutes = longestDurationMs >= 0 ? Math.round((longestDurationMs / (1000 * 60)) * 10) / 10 : null;
  const shortestDurationMinutes = shortestDurationMs !== Infinity ? Math.round((shortestDurationMs / (1000 * 60)) * 10) / 10 : null;

  // Directional Summaries
  const longTrades: DirectionalAnalytics = {
    totalTrades: longTotal,
    winningTrades: longWins,
    losingTrades: longLosses,
    breakevenTrades: longBreakeven,
    netPnL: Math.round(longPnL * 100) / 100,
    winRate: longTotal > 0 ? Math.round((longWins / longTotal) * 10000) / 100 : null
  };

  const shortTrades: DirectionalAnalytics = {
    totalTrades: shortTotal,
    winningTrades: shortWins,
    losingTrades: shortLosses,
    breakevenTrades: shortBreakeven,
    netPnL: Math.round(shortPnL * 100) / 100,
    winRate: shortTotal > 0 ? Math.round((shortWins / shortTotal) * 10000) / 100 : null
  };

  // Risk / Reward Averages
  const averagePlannedRR = plannedRRCount > 0 ? Math.round((totalPlannedRRSum / plannedRRCount) * 100) / 100 : null;
  const averageRealizedR = realizedRCount > 0 ? Math.round((totalRealizedRSum / realizedRCount) * 100) / 100 : null;
  const totalRealizedR = realizedRCount > 0 ? Math.round(totalRealizedRSum * 100) / 100 : null;
  const winningTradeAverageR = winningRCount > 0 ? Math.round((winningRealizedRSum / winningRCount) * 100) / 100 : null;
  const losingTradeAverageR = losingRCount > 0 ? Math.round((losingRealizedRSum / losingRCount) * 100) / 100 : null;

  return {
    datasetId,
    symbol,
    timeframe,
    startTime: startTime || sortedTrades[0].entryTimestamp,
    endTime: endTime || sortedTrades[sortedTrades.length - 1].exitTimestamp,
    strategyId,
    strategyName,
    startingBalance,
    endingBalance: Math.round(endingBalance * 100) / 100,
    netProfit,
    returnPercent,
    totalTrades,
    winningTrades,
    losingTrades,
    breakevenTrades,
    winRate,
    lossRate,
    grossProfit: roundedGrossProfit,
    grossLoss: roundedGrossLoss,
    profitFactor,
    averageTrade,
    averageWin,
    averageLoss,
    expectancy,
    maxDrawdownCurrency: Math.round(maxDrawdownCurrency * 100) / 100,
    maxDrawdownPercent: Math.round(maxDrawdownPercent * 100) / 100,
    peakBalanceAtMaxDrawdown: Math.round(peakAtMaxDd * 100) / 100,
    troughBalanceAtMaxDrawdown: Math.round(troughAtMaxDd * 100) / 100,
    equityCurve,
    averageDurationMinutes,
    longestDurationMinutes,
    shortestDurationMinutes,
    exitReasonBreakdown,
    longTrades,
    shortTrades,
    averagePlannedRR,
    averageRealizedR,
    totalRealizedR,
    longestWinningStreak: longestWinStreak,
    longestLosingStreak: longestLossStreak,
    currentWinningStreak: currentWinStreak,
    currentLosingStreak: currentLossStreak,
    bestTrade,
    worstTrade
  };
}
