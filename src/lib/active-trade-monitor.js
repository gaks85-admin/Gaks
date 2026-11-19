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
function evaluateActiveTradeExit(direction, entryPrice, stopLoss, takeProfit, currentPrice, spreadBufferPrice = 0) {
  const isBuy = direction.toUpperCase() === "BUY" || direction.toUpperCase() === "LONG";
  const isSell = direction.toUpperCase() === "SELL" || direction.toUpperCase() === "SHORT";
  const riskDist = isBuy ? entryPrice - stopLoss : stopLoss - entryPrice;
  const rewardDist = isBuy ? takeProfit - entryPrice : entryPrice - takeProfit;
  const targetR = riskDist > 0 ? Math.round(rewardDist / riskDist * 1e3) / 1e3 : 2;
  const spread = typeof spreadBufferPrice === "number" && !isNaN(spreadBufferPrice) && spreadBufferPrice > 0 ? spreadBufferPrice : 0;
  if (isBuy) {
    if (currentPrice <= stopLoss + spread) {
      return { exitStatus: "SL_HIT", realizedR: -1, outcome: "LOSS" };
    }
    if (currentPrice >= takeProfit) {
      return { exitStatus: "TP_HIT", realizedR: targetR, outcome: "WIN" };
    }
  } else if (isSell) {
    if (currentPrice + spread >= stopLoss) {
      return { exitStatus: "SL_HIT", realizedR: -1, outcome: "LOSS" };
    }
    if (currentPrice <= takeProfit) {
      return { exitStatus: "TP_HIT", realizedR: targetR, outcome: "WIN" };
    }
  }
  const currentUnrealizedR = calculateUnrealizedPnlR(direction, entryPrice, stopLoss, currentPrice);
  return { exitStatus: "HOLDING", realizedR: currentUnrealizedR, outcome: "ACTIVE" };
}
function parseCandleOpenMs(ts) {
  if (typeof ts === "number") {
    if (!isFinite(ts)) return NaN;
    return ts < 1e12 ? ts * 1e3 : ts;
  }
  return new Date(ts).getTime();
}
function resolveActiveTradeMonitoringPlan(openedAt, nowMs = Date.now()) {
  if (!openedAt) {
    return { timeframe: "M5", requiredCount: 60 };
  }
  const openedMs = new Date(openedAt).getTime();
  if (isNaN(openedMs) || openedMs > nowMs) {
    return { timeframe: "M1", requiredCount: 60 };
  }
  const elapsedMinutes = Math.max(1, Math.ceil((nowMs - openedMs) / 6e4));
  if (elapsedMinutes <= 150) {
    return { timeframe: "M1", requiredCount: 180 };
  }
  if (elapsedMinutes <= 450) {
    return { timeframe: "M1", requiredCount: 500 };
  }
  if (elapsedMinutes <= 1440) {
    return { timeframe: "M5", requiredCount: 300 };
  }
  if (elapsedMinutes <= 4320) {
    return { timeframe: "M15", requiredCount: 300 };
  }
  return { timeframe: "H1", requiredCount: 300 };
}
function evaluateActiveTradeExitWithHistory(input) {
  const {
    direction,
    entryPrice,
    stopLoss,
    takeProfit,
    openedAt,
    currentPrice = null,
    candles = null,
    spreadBufferPrice = 0,
    sameCandlePolicy = "STOP_LOSS_FIRST",
    entryTimestampToleranceMs = 5e3
  } = input;
  const isBuy = direction.toUpperCase() === "BUY" || direction.toUpperCase() === "LONG";
  const isSell = direction.toUpperCase() === "SELL" || direction.toUpperCase() === "SHORT";
  const riskDist = isBuy ? entryPrice - stopLoss : stopLoss - entryPrice;
  const rewardDist = isBuy ? takeProfit - entryPrice : entryPrice - takeProfit;
  const targetR = riskDist > 0 ? Math.round(rewardDist / riskDist * 1e3) / 1e3 : 2;
  const spread = typeof spreadBufferPrice === "number" && !isNaN(spreadBufferPrice) && spreadBufferPrice > 0 ? spreadBufferPrice : 0;
  const openedMs = openedAt ? new Date(openedAt).getTime() : NaN;
  if (!isNaN(openedMs) && Array.isArray(candles) && candles.length > 0 && (isBuy || isSell)) {
    const eligibleCandles = candles.map((c) => ({ candle: c, openMs: parseCandleOpenMs(c.timestamp) })).filter(
      ({ candle, openMs }) => !isNaN(openMs) && openMs >= openedMs - entryTimestampToleranceMs && typeof candle.high === "number" && isFinite(candle.high) && typeof candle.low === "number" && isFinite(candle.low)
    ).sort((a, b) => a.openMs - b.openMs);
    for (const { candle, openMs } of eligibleCandles) {
      const candleTs = typeof candle.timestamp === "string" ? candle.timestamp : new Date(openMs).toISOString();
      const hitSL = isBuy ? candle.low <= stopLoss + spread : candle.high + spread >= stopLoss;
      const hitTP = isBuy ? candle.high >= takeProfit : candle.low <= takeProfit;
      if (hitSL && hitTP) {
        if (sameCandlePolicy === "TAKE_PROFIT_FIRST") {
          return {
            exitStatus: "TP_HIT",
            realizedR: targetR,
            outcome: "WIN",
            exitPrice: takeProfit,
            triggeredBy: "CANDLE_HISTORY",
            triggerCandleTimestamp: candleTs,
            ambiguousSameCandle: true
          };
        }
        return {
          exitStatus: "SL_HIT",
          realizedR: -1,
          outcome: "LOSS",
          exitPrice: stopLoss,
          triggeredBy: "CANDLE_HISTORY",
          triggerCandleTimestamp: candleTs,
          ambiguousSameCandle: true
        };
      }
      if (hitSL) {
        return {
          exitStatus: "SL_HIT",
          realizedR: -1,
          outcome: "LOSS",
          exitPrice: stopLoss,
          triggeredBy: "CANDLE_HISTORY",
          triggerCandleTimestamp: candleTs
        };
      }
      if (hitTP) {
        return {
          exitStatus: "TP_HIT",
          realizedR: targetR,
          outcome: "WIN",
          exitPrice: takeProfit,
          triggeredBy: "CANDLE_HISTORY",
          triggerCandleTimestamp: candleTs
        };
      }
    }
  }
  if (typeof currentPrice === "number" && !isNaN(currentPrice) && isFinite(currentPrice)) {
    const spotEval = evaluateActiveTradeExit(direction, entryPrice, stopLoss, takeProfit, currentPrice, spread);
    if (spotEval.exitStatus === "SL_HIT") {
      return {
        exitStatus: "SL_HIT",
        realizedR: -1,
        outcome: "LOSS",
        exitPrice: stopLoss,
        triggeredBy: "SPOT_PRICE"
      };
    }
    if (spotEval.exitStatus === "TP_HIT") {
      return {
        exitStatus: "TP_HIT",
        realizedR: spotEval.realizedR,
        outcome: "WIN",
        exitPrice: takeProfit,
        triggeredBy: "SPOT_PRICE"
      };
    }
    return {
      exitStatus: "HOLDING",
      realizedR: spotEval.realizedR,
      outcome: "ACTIVE",
      exitPrice: currentPrice,
      triggeredBy: "HOLDING"
    };
  }
  return {
    exitStatus: "HOLDING",
    realizedR: 0,
    outcome: "ACTIVE",
    exitPrice: entryPrice,
    triggeredBy: "HOLDING"
  };
}
function buildActiveTradeTelemetry(watcher, currentPrice, options) {
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
  const resolvedStatus = options?.exitStatus || exitEval.exitStatus;
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
    status: resolvedStatus,
    openedAt,
    durationMinutes
  };
}
export {
  buildActiveTradeTelemetry,
  calculatePipsDistance,
  calculateUnrealizedPnlR,
  evaluateActiveTradeExit,
  evaluateActiveTradeExitWithHistory,
  getPipSize,
  resolveActiveTradeMonitoringPlan
};
