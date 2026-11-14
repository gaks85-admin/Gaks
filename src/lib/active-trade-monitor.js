import { validateActiveTradeState } from "./trade-validator.js";
function getPipSize(symbol) {
  const clean = (symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.includes("US30") || clean.includes("DJ30") || clean.includes("DOW") || clean.includes("NAS") || clean.includes("NDX") || clean.includes("US100") || clean.includes("SPX") || clean.includes("SP500") || clean.includes("US500") || clean.includes("US2000") || clean.includes("GER") || clean.includes("DE30") || clean.includes("DE40") || clean.includes("DAX") || clean.includes("UK100") || clean.includes("FTSE") || clean.includes("JP225") || clean.includes("HK50") || clean.includes("AUS200") || clean.includes("INDEX")) {
    return 1;
  }
  if (clean.includes("XRP") || clean.includes("ADA") || clean.includes("DOGE") || clean.includes("SHIB") || clean.includes("TRX") || clean.includes("XLM") || clean.includes("VET") || clean.includes("HBAR")) {
    return 1e-4;
  }
  if (clean.includes("JPY") || clean.includes("XAU") || clean.includes("GOLD") || clean.includes("XAG") || clean.includes("SILVER") || clean.includes("BTC") || clean.includes("ETH") || clean.includes("SOL") || clean.includes("LTC") || clean.includes("BNB") || clean.includes("AVAX") || clean.includes("BCH") || clean.endsWith("USDT") || clean.endsWith("USDC") || clean.endsWith("BUSD")) {
    return 0.01;
  }
  return 1e-4;
}
function calculatePipsDistance(symbol, priceA, priceB) {
  const pipSize = getPipSize(symbol);
  if (pipSize <= 0) return 0;
  const pips = Math.abs(priceA - priceB) / pipSize;
  return Math.round(pips * 10) / 10;
}
function calculateUnrealizedPnlR(direction, entryPrice, stopLoss, currentPrice) {
  const isBuy = direction.toUpperCase() === "BUY" || direction.toUpperCase() === "LONG";
  const riskDist = isBuy ? entryPrice - stopLoss : stopLoss - entryPrice;
  if (riskDist <= 0 || isNaN(riskDist)) {
    return 0;
  }
  const profitDist = isBuy ? currentPrice - entryPrice : entryPrice - currentPrice;
  const rawR = profitDist / riskDist;
  return Math.round(rawR * 1e3) / 1e3;
}
function evaluateActiveTradeExit(direction, entryPrice, stopLoss, takeProfit, currentPrice) {
  const isBuy = direction.toUpperCase() === "BUY" || direction.toUpperCase() === "LONG";
  const isSell = direction.toUpperCase() === "SELL" || direction.toUpperCase() === "SHORT";
  const riskDist = isBuy ? entryPrice - stopLoss : stopLoss - entryPrice;
  const rewardDist = isBuy ? takeProfit - entryPrice : entryPrice - takeProfit;
  const targetR = riskDist > 0 ? Math.round(rewardDist / riskDist * 1e3) / 1e3 : 2;
  if (isBuy) {
    if (currentPrice >= takeProfit) {
      return { exitStatus: "TP_HIT", realizedR: targetR, outcome: "WIN" };
    }
    if (currentPrice <= stopLoss) {
      return { exitStatus: "SL_HIT", realizedR: -1, outcome: "LOSS" };
    }
  } else if (isSell) {
    if (currentPrice <= takeProfit) {
      return { exitStatus: "TP_HIT", realizedR: targetR, outcome: "WIN" };
    }
    if (currentPrice >= stopLoss) {
      return { exitStatus: "SL_HIT", realizedR: -1, outcome: "LOSS" };
    }
  }
  const currentUnrealizedR = calculateUnrealizedPnlR(direction, entryPrice, stopLoss, currentPrice);
  return { exitStatus: "HOLDING", realizedR: currentUnrealizedR, outcome: "ACTIVE" };
}
function buildActiveTradeTelemetry(watcher, currentPrice) {
  const validation = validateActiveTradeState(watcher);
  if (!validation.valid) {
    return null;
  }
  const symbol = watcher.selected_pair || watcher.symbol || "UNKNOWN";
  const timeframe = watcher.selected_timeframe || watcher.timeframe || "H1";
  const dir = (watcher.direction || "").toUpperCase().trim();
  const direction = dir === "SELL" || dir === "SHORT" ? "SELL" : "BUY";
  const entryPrice = parseFloat(String(watcher.entry_price));
  const stopLoss = parseFloat(String(watcher.stop_loss));
  const takeProfit = parseFloat(String(watcher.take_profit));
  const tradeId = watcher.active_trade_id || watcher.last_signal_data?.trade_id || watcher.last_signal_data?.tradeId || null;
  const exitEval = evaluateActiveTradeExit(direction, entryPrice, stopLoss, takeProfit, currentPrice);
  const unrealizedPnlR = calculateUnrealizedPnlR(direction, entryPrice, stopLoss, currentPrice);
  const pipSize = getPipSize(symbol);
  const pipsToTP = calculatePipsDistance(symbol, currentPrice, takeProfit);
  const pipsToSL = calculatePipsDistance(symbol, currentPrice, stopLoss);
  const isBuy = direction === "BUY";
  const pipsInProfit = isBuy ? Math.round((currentPrice - entryPrice) / pipSize * 10) / 10 : Math.round((entryPrice - currentPrice) / pipSize * 10) / 10;
  const totalRange = Math.abs(takeProfit - stopLoss);
  let progressPercentage = 50;
  if (totalRange > 0) {
    if (isBuy) {
      progressPercentage = Math.min(100, Math.max(0, Math.round((currentPrice - stopLoss) / totalRange * 100)));
    } else {
      progressPercentage = Math.min(100, Math.max(0, Math.round((stopLoss - currentPrice) / totalRange * 100)));
    }
  }
  const riskDist = isBuy ? entryPrice - stopLoss : stopLoss - entryPrice;
  const rewardDist = isBuy ? takeProfit - entryPrice : entryPrice - takeProfit;
  const targetPnlR = riskDist > 0 ? Math.round(rewardDist / riskDist * 1e3) / 1e3 : 2;
  const openedAt = watcher.opened_at || null;
  let durationMinutes = 0;
  if (openedAt) {
    const openedMs = new Date(openedAt).getTime();
    if (!isNaN(openedMs)) {
      durationMinutes = Math.max(0, Math.round((Date.now() - openedMs) / 6e4));
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
export {
  buildActiveTradeTelemetry,
  calculatePipsDistance,
  calculateUnrealizedPnlR,
  evaluateActiveTradeExit,
  getPipSize
};
