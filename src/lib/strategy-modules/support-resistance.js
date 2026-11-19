function detectSupportResistanceZones(sortedCandles, swingHighs, swingLows, atr, currentPrice) {
  if (!sortedCandles || sortedCandles.length < 5) {
    return {
      supportZones: [],
      resistanceZones: [],
      supportNear: false,
      resistanceNear: false,
      supportRejection: false,
      resistanceRejection: false
    };
  }
  const effectiveAtr = atr > 0 ? atr : Math.max(1e-4, currentPrice * 2e-3);
  const clusterBand = effectiveAtr * 0.65;
  const recentCandles = sortedCandles.slice(-3);
  const clusterLevels = (points, side) => {
    const clusters = [];
    for (const pt of points) {
      const target = clusters.find(
        (c) => Math.abs(c.prices.reduce((a, b) => a + b, 0) / c.prices.length - pt.price) <= clusterBand
      );
      if (target) {
        target.prices.push(pt.price);
        target.indices.push(pt.index);
      } else {
        clusters.push({ prices: [pt.price], indices: [pt.index] });
      }
    }
    return clusters.map((c) => {
      const minP = Math.min(...c.prices);
      const maxP = Math.max(...c.prices);
      const pad = Math.max((maxP - minP) * 0.2, effectiveAtr * 0.15);
      const priceMin = Number((minP - pad).toFixed(5));
      const priceMax = Number((maxP + pad).toFixed(5));
      const midPrice = Number(((priceMin + priceMax) / 2).toFixed(5));
      const touchCount = c.prices.length;
      const distance = side === "SUPPORT" ? Math.max(0, currentPrice - priceMax) : Math.max(0, priceMin - currentPrice);
      const distanceAtr = Number((distance / effectiveAtr).toFixed(2));
      const isNear = currentPrice >= priceMin && currentPrice <= priceMax || distanceAtr <= 1.5;
      const hasRejection = recentCandles.some((bar) => {
        const range = Math.max(1e-6, bar.high - bar.low);
        if (side === "SUPPORT") {
          const lowerWick = Math.min(bar.open, bar.close) - bar.low;
          return bar.low <= priceMax && bar.close >= priceMin && (lowerWick / range >= 0.3 || bar.close > bar.open);
        } else {
          const upperWick = bar.high - Math.max(bar.open, bar.close);
          return bar.high >= priceMin && bar.close <= priceMax && (upperWick / range >= 0.3 || bar.close < bar.open);
        }
      });
      return {
        priceMin,
        priceMax,
        midPrice,
        strength: Math.min(5, touchCount + (hasRejection ? 1 : 0)),
        touchCount,
        distanceAtr,
        isNear,
        hasRejection
      };
    }).filter(
      (z) => side === "SUPPORT" ? z.priceMin <= currentPrice + effectiveAtr * 0.5 : z.priceMax >= currentPrice - effectiveAtr * 0.5
    ).sort((a, b) => a.distanceAtr - b.distanceAtr || b.strength - a.strength);
  };
  const supportZones = clusterLevels(swingLows || [], "SUPPORT");
  const resistanceZones = clusterLevels(swingHighs || [], "RESISTANCE");
  return {
    supportZones,
    resistanceZones,
    supportNear: supportZones.some((z) => z.isNear),
    resistanceNear: resistanceZones.some((z) => z.isNear),
    supportRejection: supportZones.some((z) => z.hasRejection),
    resistanceRejection: resistanceZones.some((z) => z.hasRejection)
  };
}
function getOrComputeSr(ctx) {
  if (!ctx.marketStructure._srAnalysis) {
    ctx.marketStructure._srAnalysis = detectSupportResistanceZones(
      ctx.sortedCandles,
      ctx.swingHighs,
      ctx.swingLows,
      ctx.atr,
      ctx.currentPrice
    );
  }
  return ctx.marketStructure._srAnalysis;
}
const SupportModule = {
  id: "support",
  name: "Support Zone",
  category: "ZONE",
  aliases: ["support", "support_zone"],
  requiresSwings: true,
  requiresAtr: true,
  execute: (ctx) => {
    const sr = getOrComputeSr(ctx);
    const nearest = sr.supportZones[0];
    const matched = sr.supportNear || sr.supportZones.length > 0;
    const scoreOutOf10 = sr.supportNear ? 10 : sr.supportZones.length > 0 ? 7 : 0;
    return {
      moduleId: "support",
      moduleName: "Support Zone",
      category: "ZONE",
      activated: true,
      executed: true,
      matched,
      scoreOutOf10,
      direction: matched ? "BULLISH" : "NEUTRAL",
      reason: nearest ? `Identified ${sr.supportZones.length} support zone(s); nearest [${nearest.priceMin} - ${nearest.priceMax}] (${nearest.distanceAtr} ATR away).` : "No structural support zone identified below current price.",
      evidence: sr.supportZones.slice(0, 3).map((z) => `Support [${z.priceMin} - ${z.priceMax}] (${z.touchCount} touches)`),
      metrics: { zoneCount: sr.supportZones.length, nearestDistanceAtr: nearest?.distanceAtr ?? null, isNear: sr.supportNear },
      structurePatch: {
        supportZones: sr.supportZones.map((z) => ({ priceMin: z.priceMin, priceMax: z.priceMax, strength: z.strength })),
        support: matched
      }
    };
  }
};
const ResistanceModule = {
  id: "resistance",
  name: "Resistance Zone",
  category: "ZONE",
  aliases: ["resistance", "resistance_zone"],
  requiresSwings: true,
  requiresAtr: true,
  execute: (ctx) => {
    const sr = getOrComputeSr(ctx);
    const nearest = sr.resistanceZones[0];
    const matched = sr.resistanceNear || sr.resistanceZones.length > 0;
    const scoreOutOf10 = sr.resistanceNear ? 10 : sr.resistanceZones.length > 0 ? 7 : 0;
    return {
      moduleId: "resistance",
      moduleName: "Resistance Zone",
      category: "ZONE",
      activated: true,
      executed: true,
      matched,
      scoreOutOf10,
      direction: matched ? "BEARISH" : "NEUTRAL",
      reason: nearest ? `Identified ${sr.resistanceZones.length} resistance zone(s); nearest [${nearest.priceMin} - ${nearest.priceMax}] (${nearest.distanceAtr} ATR away).` : "No structural resistance zone identified above current price.",
      evidence: sr.resistanceZones.slice(0, 3).map((z) => `Resistance [${z.priceMin} - ${z.priceMax}] (${z.touchCount} touches)`),
      metrics: { zoneCount: sr.resistanceZones.length, nearestDistanceAtr: nearest?.distanceAtr ?? null, isNear: sr.resistanceNear },
      structurePatch: {
        resistanceZones: sr.resistanceZones.map((z) => ({ priceMin: z.priceMin, priceMax: z.priceMax, strength: z.strength })),
        resistance: matched
      }
    };
  }
};
const SupportRejectionModule = {
  id: "support_rejection",
  name: "Support Rejection",
  category: "PRICE_ACTION",
  aliases: ["support_rejection"],
  requiresSwings: true,
  requiresAtr: true,
  execute: (ctx) => {
    const sr = getOrComputeSr(ctx);
    const matched = sr.supportRejection || ctx.marketStructure.zone_rejected === true;
    return {
      moduleId: "support_rejection",
      moduleName: "Support Rejection",
      category: "PRICE_ACTION",
      activated: true,
      executed: true,
      matched,
      scoreOutOf10: sr.supportRejection ? 10 : 0,
      direction: matched ? "BULLISH" : "NEUTRAL",
      reason: matched ? "Confirmed bullish lower-wick / close rejection off support zone." : "No bullish rejection bounce confirmed at support.",
      evidence: sr.supportZones.filter((z) => z.hasRejection).map((z) => `Rejection at [${z.priceMin} - ${z.priceMax}]`),
      metrics: { supportRejection: matched },
      structurePatch: {
        supportZones: sr.supportZones.map((z) => ({ priceMin: z.priceMin, priceMax: z.priceMax, strength: z.strength })),
        support_rejection: matched,
        lowerWickRejection: matched
      }
    };
  }
};
const ResistanceRejectionModule = {
  id: "resistance_rejection",
  name: "Resistance Rejection",
  category: "PRICE_ACTION",
  aliases: ["resistance_rejection"],
  requiresSwings: true,
  requiresAtr: true,
  execute: (ctx) => {
    const sr = getOrComputeSr(ctx);
    const matched = sr.resistanceRejection || ctx.marketStructure.zone_rejected === true;
    return {
      moduleId: "resistance_rejection",
      moduleName: "Resistance Rejection",
      category: "PRICE_ACTION",
      activated: true,
      executed: true,
      matched,
      scoreOutOf10: sr.resistanceRejection ? 10 : 0,
      direction: matched ? "BEARISH" : "NEUTRAL",
      reason: matched ? "Confirmed bearish upper-wick / close rejection off resistance zone." : "No bearish rejection bounce confirmed at resistance.",
      evidence: sr.resistanceZones.filter((z) => z.hasRejection).map((z) => `Rejection at [${z.priceMin} - ${z.priceMax}]`),
      metrics: { resistanceRejection: matched },
      structurePatch: {
        resistanceZones: sr.resistanceZones.map((z) => ({ priceMin: z.priceMin, priceMax: z.priceMax, strength: z.strength })),
        resistance_rejection: matched,
        upperWickRejection: matched
      }
    };
  }
};
export {
  ResistanceModule,
  ResistanceRejectionModule,
  SupportModule,
  SupportRejectionModule,
  detectSupportResistanceZones
};
