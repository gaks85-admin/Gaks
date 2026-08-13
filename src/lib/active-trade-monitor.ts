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
  if (clean.includes('JPY') || clean.includes('XAU') || clean.includes('GOLD') || clean.includes('BTC')) {
    return 0.01;
  }
  if (clean.includes('US30') || clean.includes('NAS100') || clean.includes('SPX500') || clean.includes('GER40')) {
    return 1.0;
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
 * Evaluates whether an open trade has hit TP, SL, or is currently holding.
 */
export function evaluateActiveTradeExit(
  direction: string,
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  currentPrice: number
): { exitStatus: 'TP_HIT' | 'SL_HIT' | 'HOLDING'; realizedR: number; outcome: 'WIN' | 'LOSS' | 'ACTIVE' } {
  const isBuy = direction.toUpperCase() === 'BUY' || direction.toUpperCase() === 'LONG';
  const isSell = direction.toUpperCase() === 'SELL' || direction.toUpperCase() === 'SHORT';

  const riskDist = isBuy ? entryPrice - stopLoss : stopLoss - entryPrice;
  const rewardDist = isBuy ? takeProfit - entryPrice : entryPrice - takeProfit;
  const targetR = riskDist > 0 ? Math.round((rewardDist / riskDist) * 1000) / 1000 : 2.0;

  if (isBuy) {
    if (currentPrice >= takeProfit) {
      return { exitStatus: 'TP_HIT', realizedR: targetR, outcome: 'WIN' };
    }
    if (currentPrice <= stopLoss) {
      return { exitStatus: 'SL_HIT', realizedR: -1.0, outcome: 'LOSS' };
    }
  } else if (isSell) {
    if (currentPrice <= takeProfit) {
      return { exitStatus: 'TP_HIT', realizedR: targetR, outcome: 'WIN' };
    }
    if (currentPrice >= stopLoss) {
      return { exitStatus: 'SL_HIT', realizedR: -1.0, outcome: 'LOSS' };
    }
  }

  const currentUnrealizedR = calculateUnrealizedPnlR(direction, entryPrice, stopLoss, currentPrice);
  return { exitStatus: 'HOLDING', realizedR: currentUnrealizedR, outcome: 'ACTIVE' };
}

/**
 * Builds a structured, complete active trade telemetry payload from watcher data and current price.
 */
export function buildActiveTradeTelemetry(watcher: any, currentPrice: number): ActiveTradeTelemetry | null {
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
    status: exitEval.exitStatus,
    openedAt,
    durationMinutes
  };
}
