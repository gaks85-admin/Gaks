import { validateActiveTradeState } from './trade-validator.js';

export interface ActiveTradeTelemetry {
  tradeId: string | null;
  symbol: string;
  timeframe: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  currentPrice: number;
  unrealizedPnlR: number;
  targetPnlR: number;
  pipsToTP: number;
  pipsToSL: number;
  pipsInProfit: number;
  progressPercentage: number;
  status: 'HOLDING' | 'TP_HIT' | 'SL_HIT';
  openedAt: string | null;
  durationMinutes: number;
}

/**
 * Calculates pip size for standard forex pairs, commodities, and indices.
 */
export function getPipSize(symbol: string): number {
  const clean = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (
    clean.includes('US30') || clean.includes('DJ30') || clean.includes('DOW') ||
    clean.includes('NAS') || clean.includes('NDX') || clean.includes('US100') ||
    clean.includes('SPX') || clean.includes('SP500') || clean.includes('US500') ||
    clean.includes('US2000') || clean.includes('GER') || clean.includes('DE30') ||
    clean.includes('DE40') || clean.includes('DAX') || clean.includes('UK100') ||
    clean.includes('FTSE') || clean.includes('JP225') || clean.includes('HK50') ||
    clean.includes('AUS200') || clean.includes('INDEX')
  ) {
    return 1.0;
  }
  if (
    clean.includes('XRP') || clean.includes('ADA') || clean.includes('DOGE') ||
    clean.includes('SHIB') || clean.includes('TRX') || clean.includes('XLM') ||
    clean.includes('VET') || clean.includes('HBAR')
  ) {
    return 0.0001;
  }
  if (
    clean.includes('JPY') || clean.includes('XAU') || clean.includes('GOLD') ||
    clean.includes('XAG') || clean.includes('SILVER') || clean.includes('BTC') ||
    clean.includes('ETH') || clean.includes('SOL') || clean.includes('LTC') ||
    clean.includes('BNB') || clean.includes('AVAX') || clean.includes('BCH') ||
    clean.endsWith('USDT') || clean.endsWith('USDC') || clean.endsWith('BUSD')
  ) {
    return 0.01;
  }
  return 0.0001;
}

/**
 * Calculates pip distance between two prices for a given symbol.
 */
export function calculatePipsDistance(symbol: string, priceA: number, priceB: number): number {
  const pipSize = getPipSize(symbol);
  if (pipSize <= 0) return 0;
  const pips = Math.abs(priceA - priceB) / pipSize;
  return Math.round(pips * 10) / 10;
}

/**
 * Calculates current unrealized R-multiple for an open position.
 */
export function calculateUnrealizedPnlR(
  direction: string,
  entryPrice: number,
  stopLoss: number,
  currentPrice: number
): number {
  const isBuy = direction.toUpperCase() === 'BUY' || direction.toUpperCase() === 'LONG';
  const riskDist = isBuy ? entryPrice - stopLoss : stopLoss - entryPrice;

  if (riskDist <= 0 || isNaN(riskDist)) {
    return 0;
  }

  const profitDist = isBuy ? currentPrice - entryPrice : entryPrice - currentPrice;
  const rawR = profitDist / riskDist;
  return Math.round(rawR * 1000) / 1000;
}

/**
 * Evaluates whether an open trade has hit TP, SL, or is currently holding
 * based on a single price snapshot. Checks STOP LOSS BEFORE TAKE PROFIT
 * (`STOP_LOSS_FIRST`) so crossed or ambiguous states never misreport a loss as a win.
 */
export function evaluateActiveTradeExit(
  direction: string,
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  currentPrice: number,
  spreadBufferPrice: number = 0
): { exitStatus: 'TP_HIT' | 'SL_HIT' | 'HOLDING'; realizedR: number; outcome: 'WIN' | 'LOSS' | 'ACTIVE' } {
  const isBuy = direction.toUpperCase() === 'BUY' || direction.toUpperCase() === 'LONG';
  const isSell = direction.toUpperCase() === 'SELL' || direction.toUpperCase() === 'SHORT';

  const riskDist = isBuy ? entryPrice - stopLoss : stopLoss - entryPrice;
  const rewardDist = isBuy ? takeProfit - entryPrice : entryPrice - takeProfit;
  const targetR = riskDist > 0 ? Math.round((rewardDist / riskDist) * 1000) / 1000 : 2.0;
  const spread = typeof spreadBufferPrice === 'number' && !isNaN(spreadBufferPrice) && spreadBufferPrice > 0 ? spreadBufferPrice : 0;

  if (isBuy) {
    if (currentPrice <= stopLoss + spread) {
      return { exitStatus: 'SL_HIT', realizedR: -1.0, outcome: 'LOSS' };
    }
    if (currentPrice >= takeProfit) {
      return { exitStatus: 'TP_HIT', realizedR: targetR, outcome: 'WIN' };
    }
  } else if (isSell) {
    if (currentPrice + spread >= stopLoss) {
      return { exitStatus: 'SL_HIT', realizedR: -1.0, outcome: 'LOSS' };
    }
    if (currentPrice <= takeProfit) {
      return { exitStatus: 'TP_HIT', realizedR: targetR, outcome: 'WIN' };
    }
  }

  const currentUnrealizedR = calculateUnrealizedPnlR(direction, entryPrice, stopLoss, currentPrice);
  return { exitStatus: 'HOLDING', realizedR: currentUnrealizedR, outcome: 'ACTIVE' };
}

export interface ActiveTradeCandle {
  timestamp: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
}

function parseCandleOpenMs(ts: string | number): number {
  if (typeof ts === 'number') {
    if (!isFinite(ts)) return NaN;
    return ts < 1e12 ? ts * 1000 : ts;
  }
  return new Date(ts).getTime();
}

export interface ActiveTradeMonitoringPlan {
  timeframe: 'M1' | 'M5' | 'M15' | 'H1';
  requiredCount: number;
}

export interface EvaluateActiveTradeHistoryInput {
  direction: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  openedAt?: string | null;
  currentPrice?: number | null;
  candles?: ActiveTradeCandle[] | null;
  spreadBufferPrice?: number;
  sameCandlePolicy?: 'STOP_LOSS_FIRST' | 'TAKE_PROFIT_FIRST';
  entryTimestampToleranceMs?: number;
}

export interface ActiveTradeHistoryExitEvaluation {
  exitStatus: 'TP_HIT' | 'SL_HIT' | 'HOLDING';
  realizedR: number;
  outcome: 'WIN' | 'LOSS' | 'ACTIVE';
  exitPrice: number;
  triggeredBy: 'CANDLE_HISTORY' | 'SPOT_PRICE' | 'HOLDING';
  triggerCandleTimestamp?: string;
  ambiguousSameCandle?: boolean;
}

/**
 * Computes the finest discrete candle timeframe and output size that covers `[openedAt, now]`
 * while preserving Twelve Data cache-key reuse across watchers.
 */
export function resolveActiveTradeMonitoringPlan(
  openedAt?: string | null,
  nowMs: number = Date.now()
): ActiveTradeMonitoringPlan {
  if (!openedAt) {
    return { timeframe: 'M5', requiredCount: 60 };
  }
  const openedMs = new Date(openedAt).getTime();
  if (isNaN(openedMs) || openedMs > nowMs) {
    return { timeframe: 'M1', requiredCount: 60 };
  }

  const elapsedMinutes = Math.max(1, Math.ceil((nowMs - openedMs) / 60000));
  if (elapsedMinutes <= 150) {
    return { timeframe: 'M1', requiredCount: 180 };
  }
  if (elapsedMinutes <= 450) {
    return { timeframe: 'M1', requiredCount: 500 };
  }
  if (elapsedMinutes <= 1440) {
    return { timeframe: 'M5', requiredCount: 300 };
  }
  if (elapsedMinutes <= 4320) {
    return { timeframe: 'M15', requiredCount: 300 };
  }
  return { timeframe: 'H1', requiredCount: 300 };
}

/**
 * Replays chronological intrabar OHLC candles since `openedAt` to determine whether
 * SL or TP was triggered first between polling runs, then falls back to `currentPrice`.
 * Uses conservative `STOP_LOSS_FIRST` tie-breaking when both levels are touched in the same bar.
 */
export function evaluateActiveTradeExitWithHistory(
  input: EvaluateActiveTradeHistoryInput
): ActiveTradeHistoryExitEvaluation {
  const {
    direction,
    entryPrice,
    stopLoss,
    takeProfit,
    openedAt,
    currentPrice = null,
    candles = null,
    spreadBufferPrice = 0,
    sameCandlePolicy = 'STOP_LOSS_FIRST',
    entryTimestampToleranceMs = 5000
  } = input;

  const isBuy = direction.toUpperCase() === 'BUY' || direction.toUpperCase() === 'LONG';
  const isSell = direction.toUpperCase() === 'SELL' || direction.toUpperCase() === 'SHORT';

  const riskDist = isBuy ? entryPrice - stopLoss : stopLoss - entryPrice;
  const rewardDist = isBuy ? takeProfit - entryPrice : entryPrice - takeProfit;
  const targetR = riskDist > 0 ? Math.round((rewardDist / riskDist) * 1000) / 1000 : 2.0;
  const spread = typeof spreadBufferPrice === 'number' && !isNaN(spreadBufferPrice) && spreadBufferPrice > 0 ? spreadBufferPrice : 0;

  const openedMs = openedAt ? new Date(openedAt).getTime() : NaN;

  if (!isNaN(openedMs) && Array.isArray(candles) && candles.length > 0 && (isBuy || isSell)) {
    const eligibleCandles = candles
      .map((c) => ({ candle: c, openMs: parseCandleOpenMs(c.timestamp) }))
      .filter(({ candle, openMs }) =>
        !isNaN(openMs) &&
        openMs >= openedMs - entryTimestampToleranceMs &&
        typeof candle.high === 'number' && isFinite(candle.high) &&
        typeof candle.low === 'number' && isFinite(candle.low)
      )
      .sort((a, b) => a.openMs - b.openMs);

    for (const { candle, openMs } of eligibleCandles) {
      const candleTs = typeof candle.timestamp === 'string' ? candle.timestamp : new Date(openMs).toISOString();
      const hitSL = isBuy
        ? candle.low <= stopLoss + spread
        : candle.high + spread >= stopLoss;
      const hitTP = isBuy
        ? candle.high >= takeProfit
        : candle.low <= takeProfit;

      if (hitSL && hitTP) {
        if (sameCandlePolicy === 'TAKE_PROFIT_FIRST') {
          return {
            exitStatus: 'TP_HIT',
            realizedR: targetR,
            outcome: 'WIN',
            exitPrice: takeProfit,
            triggeredBy: 'CANDLE_HISTORY',
            triggerCandleTimestamp: candleTs,
            ambiguousSameCandle: true
          };
        }
        return {
          exitStatus: 'SL_HIT',
          realizedR: -1.0,
          outcome: 'LOSS',
          exitPrice: stopLoss,
          triggeredBy: 'CANDLE_HISTORY',
          triggerCandleTimestamp: candleTs,
          ambiguousSameCandle: true
        };
      }

      if (hitSL) {
        return {
          exitStatus: 'SL_HIT',
          realizedR: -1.0,
          outcome: 'LOSS',
          exitPrice: stopLoss,
          triggeredBy: 'CANDLE_HISTORY',
          triggerCandleTimestamp: candleTs
        };
      }

      if (hitTP) {
        return {
          exitStatus: 'TP_HIT',
          realizedR: targetR,
          outcome: 'WIN',
          exitPrice: takeProfit,
          triggeredBy: 'CANDLE_HISTORY',
          triggerCandleTimestamp: candleTs
        };
      }
    }
  }

  if (typeof currentPrice === 'number' && !isNaN(currentPrice) && isFinite(currentPrice)) {
    const spotEval = evaluateActiveTradeExit(direction, entryPrice, stopLoss, takeProfit, currentPrice, spread);
    if (spotEval.exitStatus === 'SL_HIT') {
      return {
        exitStatus: 'SL_HIT',
        realizedR: -1.0,
        outcome: 'LOSS',
        exitPrice: stopLoss,
        triggeredBy: 'SPOT_PRICE'
      };
    }
    if (spotEval.exitStatus === 'TP_HIT') {
      return {
        exitStatus: 'TP_HIT',
        realizedR: spotEval.realizedR,
        outcome: 'WIN',
        exitPrice: takeProfit,
        triggeredBy: 'SPOT_PRICE'
      };
    }
    return {
      exitStatus: 'HOLDING',
      realizedR: spotEval.realizedR,
      outcome: 'ACTIVE',
      exitPrice: currentPrice,
      triggeredBy: 'HOLDING'
    };
  }

  return {
    exitStatus: 'HOLDING',
    realizedR: 0,
    outcome: 'ACTIVE',
    exitPrice: entryPrice,
    triggeredBy: 'HOLDING'
  };
}

/**
 * Builds a structured, complete active trade telemetry payload from watcher data and current price.
 */
export function buildActiveTradeTelemetry(
  watcher: any,
  currentPrice: number,
  options?: { exitStatus?: 'HOLDING' | 'TP_HIT' | 'SL_HIT' }
): ActiveTradeTelemetry | null {
  const validation = validateActiveTradeState(watcher);
  if (!validation.valid) {
    return null;
  }

  const symbol = watcher.selected_pair || watcher.symbol || 'UNKNOWN';
  const timeframe = watcher.selected_timeframe || watcher.timeframe || 'H1';
  const dir = (watcher.direction || '').toUpperCase().trim();
  const direction: 'BUY' | 'SELL' = (dir === 'SELL' || dir === 'SHORT') ? 'SELL' : 'BUY';
  const entryPrice = parseFloat(String(watcher.entry_price));
  const stopLoss = parseFloat(String(watcher.stop_loss));
  const takeProfit = parseFloat(String(watcher.take_profit));
  const tradeId = watcher.active_trade_id || watcher.last_signal_data?.trade_id || watcher.last_signal_data?.tradeId || null;

  const exitEval = evaluateActiveTradeExit(direction, entryPrice, stopLoss, takeProfit, currentPrice);
  const resolvedStatus = options?.exitStatus || exitEval.exitStatus;
  const unrealizedPnlR = calculateUnrealizedPnlR(direction, entryPrice, stopLoss, currentPrice);

  const pipSize = getPipSize(symbol);
  const pipsToTP = calculatePipsDistance(symbol, currentPrice, takeProfit);
  const pipsToSL = calculatePipsDistance(symbol, currentPrice, stopLoss);
  
  const isBuy = direction === 'BUY';
  const pipsInProfit = isBuy 
    ? Math.round(((currentPrice - entryPrice) / pipSize) * 10) / 10
    : Math.round(((entryPrice - currentPrice) / pipSize) * 10) / 10;

  const totalRange = Math.abs(takeProfit - stopLoss);
  let progressPercentage = 50;
  if (totalRange > 0) {
    if (isBuy) {
      progressPercentage = Math.min(100, Math.max(0, Math.round(((currentPrice - stopLoss) / totalRange) * 100)));
    } else {
      progressPercentage = Math.min(100, Math.max(0, Math.round(((stopLoss - currentPrice) / totalRange) * 100)));
    }
  }

  const riskDist = isBuy ? entryPrice - stopLoss : stopLoss - entryPrice;
  const rewardDist = isBuy ? takeProfit - entryPrice : entryPrice - takeProfit;
  const targetPnlR = riskDist > 0 ? Math.round((rewardDist / riskDist) * 1000) / 1000 : 2.0;

  const openedAt = watcher.opened_at || null;
  let durationMinutes = 0;
  if (openedAt) {
    const openedMs = new Date(openedAt).getTime();
    if (!isNaN(openedMs)) {
      durationMinutes = Math.max(0, Math.round((Date.now() - openedMs) / 60000));
    }
  }

  return {
    tradeId,
    symbol,
    timeframe,
    direction,
    entryPrice,
    stopLoss,
    takeProfit,
    currentPrice,
    unrealizedPnlR,
    targetPnlR,
    pipsToTP,
    pipsToSL,
    pipsInProfit,
    progressPercentage,
    status: resolvedStatus,
    openedAt,
    durationMinutes
  };
}
