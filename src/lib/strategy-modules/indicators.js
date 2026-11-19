import { computeEmaSeries, computeMacd, computeWilderRsi } from "./primitives.js";
const EmaModule = {
  id: "ema",
  name: "EMA Alignment",
  category: "INDICATOR",
  aliases: ["ema", "ema_alignment"],
  requiresSwings: false,
  requiresAtr: false,
  execute: (ctx) => {
    const closes = ctx.sortedCandles.map((c) => Number(c.close));
    const configuredPeriods = Array.isArray(ctx.moduleSpec.params?.periods) && ctx.moduleSpec.params.periods.length > 0 ? [...ctx.moduleSpec.params.periods].sort((a, b) => a - b) : [20, 50];
    const fastPeriod = configuredPeriods[0];
    const slowPeriod = configuredPeriods.length > 1 ? configuredPeriods[configuredPeriods.length - 1] : null;
    const fastSeries = computeEmaSeries(closes, fastPeriod);
    const latestFast = fastSeries[fastSeries.length - 1];
    const prevFast = fastSeries[Math.max(0, fastSeries.length - 2)];
    let aligned = false;
    let direction = "NEUTRAL";
    let crossover = false;
    const emaValues = { [`ema${fastPeriod}`]: Number((latestFast ?? ctx.currentPrice).toFixed(5)) };
    if (slowPeriod !== null) {
      const slowSeries = computeEmaSeries(closes, slowPeriod);
      const latestSlow = slowSeries[slowSeries.length - 1];
      const prevSlow = slowSeries[Math.max(0, slowSeries.length - 2)];
      emaValues[`ema${slowPeriod}`] = Number((latestSlow ?? ctx.currentPrice).toFixed(5));
      const bullAligned = ctx.currentPrice > latestFast && latestFast > latestSlow;
      const bearAligned = ctx.currentPrice < latestFast && latestFast < latestSlow;
      const bullCross = prevFast <= prevSlow && latestFast > latestSlow;
      const bearCross = prevFast >= prevSlow && latestFast < latestSlow;
      crossover = bullCross || bearCross;
      aligned = bullAligned || bearAligned || crossover;
      if (bullAligned || bullCross) direction = "BULLISH";
      else if (bearAligned || bearCross) direction = "BEARISH";
    } else {
      const bullAligned = ctx.currentPrice > latestFast;
      const bearAligned = ctx.currentPrice < latestFast;
      aligned = bullAligned || bearAligned;
      direction = bullAligned ? "BULLISH" : bearAligned ? "BEARISH" : "NEUTRAL";
    }
    const scoreOutOf10 = crossover ? 10 : aligned ? 9 : 2;
    return {
      moduleId: "ema",
      moduleName: "EMA Alignment",
      category: "INDICATOR",
      activated: true,
      executed: true,
      matched: aligned,
      scoreOutOf10,
      direction,
      reason: aligned ? `EMA (${configuredPeriods.join("/")}) ${crossover ? "crossover" : "alignment"} confirmed (${direction}).` : `Price is not cleanly aligned with EMA (${configuredPeriods.join("/")}).`,
      evidence: Object.entries(emaValues).map(([k, v]) => `${k.toUpperCase()}: ${v}`),
      metrics: {
        periods: configuredPeriods,
        crossover,
        ...emaValues
      },
      structurePatch: {
        ema: aligned,
        ema_crossover: crossover,
        emaValues
      }
    };
  }
};
const RsiModule = {
  id: "rsi",
  name: "RSI Filter",
  category: "INDICATOR",
  aliases: ["rsi", "rsi_filter"],
  requiresSwings: false,
  requiresAtr: false,
  execute: (ctx) => {
    const closes = ctx.sortedCandles.map((c) => Number(c.close));
    const rsi = computeWilderRsi(closes, 14);
    const overbought = ctx.moduleSpec.params?.overbought ?? 70;
    const oversold = ctx.moduleSpec.params?.oversold ?? 30;
    if (rsi === null) {
      return {
        moduleId: "rsi",
        moduleName: "RSI Filter",
        category: "INDICATOR",
        activated: true,
        executed: true,
        matched: false,
        scoreOutOf10: 0,
        direction: "NEUTRAL",
        reason: "Insufficient candle history to compute 14-period Wilder RSI.",
        evidence: [],
        metrics: { rsi: null, overbought, oversold }
      };
    }
    const roundedRsi = Number(rsi.toFixed(2));
    const isOverbought = roundedRsi >= overbought;
    const isOversold = roundedRsi <= oversold;
    const matched = isOverbought || isOversold;
    const direction = isOversold ? "BULLISH" : isOverbought ? "BEARISH" : "NEUTRAL";
    return {
      moduleId: "rsi",
      moduleName: "RSI Filter",
      category: "INDICATOR",
      activated: true,
      executed: true,
      matched,
      scoreOutOf10: matched ? 10 : 3,
      direction,
      reason: isOverbought ? `Wilder RSI(14) = ${roundedRsi} (>= ${overbought} Overbought).` : isOversold ? `Wilder RSI(14) = ${roundedRsi} (<= ${oversold} Oversold).` : `Wilder RSI(14) = ${roundedRsi} is neutral between ${oversold} and ${overbought}.`,
      evidence: [`RSI(14): ${roundedRsi} [OS<=${oversold}, OB>=${overbought}]`],
      metrics: { rsi: roundedRsi, overbought, oversold, isOverbought, isOversold },
      structurePatch: {
        rsi: roundedRsi,
        rsi_overbought: isOverbought,
        rsi_oversold: isOversold
      }
    };
  }
};
const MacdModule = {
  id: "macd",
  name: "MACD Filter",
  category: "INDICATOR",
  aliases: ["macd", "macd_filter"],
  requiresSwings: false,
  requiresAtr: false,
  execute: (ctx) => {
    const closes = ctx.sortedCandles.map((c) => Number(c.close));
    const macd = computeMacd(closes, 12, 26, 9);
    if (!macd) {
      return {
        moduleId: "macd",
        moduleName: "MACD Filter",
        category: "INDICATOR",
        activated: true,
        executed: true,
        matched: false,
        scoreOutOf10: 0,
        direction: "NEUTRAL",
        reason: "Insufficient candle history to compute MACD(12,26,9).",
        evidence: [],
        metrics: { macd: null }
      };
    }
    const bullCross = macd.prevHistogram <= 0 && macd.histogram > 0;
    const bearCross = macd.prevHistogram >= 0 && macd.histogram < 0;
    const bullMomentum = macd.macdLine > macd.signalLine && macd.histogram > 0;
    const bearMomentum = macd.macdLine < macd.signalLine && macd.histogram < 0;
    const matched = bullCross || bearCross || bullMomentum || bearMomentum;
    const direction = bullCross || bullMomentum ? "BULLISH" : bearCross || bearMomentum ? "BEARISH" : "NEUTRAL";
    return {
      moduleId: "macd",
      moduleName: "MACD Filter",
      category: "INDICATOR",
      activated: true,
      executed: true,
      matched,
      scoreOutOf10: bullCross || bearCross ? 10 : matched ? 8 : 2,
      direction,
      reason: matched ? `MACD(12,26,9) ${bullCross || bearCross ? "crossover" : "signal alignment"} confirmed (${direction}, hist=${macd.histogram.toFixed(5)}).` : "MACD signal line and histogram show flat/mixed momentum.",
      evidence: [`MACD: ${macd.macdLine.toFixed(5)}`, `Signal: ${macd.signalLine.toFixed(5)}`, `Hist: ${macd.histogram.toFixed(5)}`],
      metrics: {
        macdLine: Number(macd.macdLine.toFixed(5)),
        signalLine: Number(macd.signalLine.toFixed(5)),
        histogram: Number(macd.histogram.toFixed(5)),
        crossover: bullCross || bearCross
      },
      structurePatch: {
        macd: matched,
        macd_crossover: bullCross || bearCross,
        macdValues: macd
      }
    };
  }
};
const AtrModule = {
  id: "atr",
  name: "ATR Volatility Filter",
  category: "INDICATOR",
  aliases: ["atr", "atr_volatility_filter"],
  requiresSwings: false,
  requiresAtr: true,
  execute: (ctx) => {
    const atr = ctx.atr;
    const atrPct = ctx.currentPrice > 0 ? atr / ctx.currentPrice * 100 : 0;
    const volatilityLevel = atrPct >= 1.5 ? "HIGH" : atrPct < 0.015 ? "LOW" : "NORMAL";
    const matched = atr > 0 && volatilityLevel !== "LOW";
    return {
      moduleId: "atr",
      moduleName: "ATR Volatility Filter",
      category: "INDICATOR",
      activated: true,
      executed: true,
      matched,
      scoreOutOf10: matched ? 10 : 2,
      direction: "NEUTRAL",
      reason: matched ? `ATR(14) = ${atr.toFixed(5)} (${atrPct.toFixed(3)}% of price, ${volatilityLevel} volatility).` : `ATR(14) = ${atr.toFixed(5)} (${volatilityLevel}) \u2014 insufficient volatility.`,
      evidence: [`ATR(14): ${atr.toFixed(5)} (${atrPct.toFixed(3)}%)`],
      metrics: { atr: Number(atr.toFixed(5)), atrPercent: Number(atrPct.toFixed(4)), volatilityLevel },
      structurePatch: {
        atr: matched,
        volatilityInformation: { atr, volatilityLevel }
      }
    };
  }
};
const VolumeModule = {
  id: "volume_confirmation",
  name: "Volume Confirmation",
  category: "INDICATOR",
  aliases: ["volume_confirmation", "volume"],
  requiresSwings: false,
  requiresAtr: false,
  execute: (ctx) => {
    const lookback = ctx.sortedCandles.slice(-21, -1);
    const volumes = lookback.map((c) => Number(c.volume || 0));
    const hasVolumeFeed = volumes.some((v) => v > 0) || Number(ctx.latestCandle.volume || 0) > 0;
    if (!hasVolumeFeed) {
      return {
        moduleId: "volume_confirmation",
        moduleName: "Volume Confirmation",
        category: "INDICATOR",
        activated: true,
        executed: true,
        matched: false,
        scoreOutOf10: 0,
        direction: "NEUTRAL",
        reason: "Volume feed unavailable or zero across candle window; cannot confirm volume participation.",
        evidence: [],
        metrics: { averageVolume: 0, latestVolume: 0, ratio: 0, volumeSpike: false, hasVolumeFeed: false },
        structurePatch: {
          volume_confirmation: false,
          volumeInformation: { averageVolume: 0, latestVolume: 0, volumeSpike: false }
        }
      };
    }
    const avgVolume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : Number(ctx.latestCandle.volume || 0);
    const latestVolume = Number(ctx.latestCandle.volume || 0);
    const ratio = avgVolume > 0 ? latestVolume / avgVolume : 0;
    const volumeSpike = ratio >= 1.5;
    const matched = ratio >= 1.1;
    const scoreOutOf10 = volumeSpike ? 10 : ratio >= 1.2 ? 9 : matched ? 7 : 3;
    return {
      moduleId: "volume_confirmation",
      moduleName: "Volume Confirmation",
      category: "INDICATOR",
      activated: true,
      executed: true,
      matched,
      scoreOutOf10,
      direction: "NEUTRAL",
      reason: matched ? `Volume participation confirmed (${latestVolume.toFixed(0)} vs avg ${avgVolume.toFixed(0)}, ${ratio.toFixed(2)}x).` : `Low relative volume (${latestVolume.toFixed(0)} vs avg ${avgVolume.toFixed(0)}, ${ratio.toFixed(2)}x).`,
      evidence: [`Latest Vol: ${latestVolume.toFixed(0)}`, `Avg Vol(20): ${avgVolume.toFixed(0)} (${ratio.toFixed(2)}x)`],
      metrics: {
        averageVolume: Number(avgVolume.toFixed(2)),
        latestVolume,
        ratio: Number(ratio.toFixed(2)),
        volumeSpike,
        hasVolumeFeed: true
      },
      structurePatch: {
        volume_confirmation: matched,
        volumeInformation: { averageVolume: avgVolume, latestVolume, volumeSpike }
      }
    };
  }
};
export {
  AtrModule,
  EmaModule,
  MacdModule,
  RsiModule,
  VolumeModule
};
