import { MarketStructure } from './market-structure-engine.js';

export interface StructuralStopLossResult {
  stopLoss: number;
  stopLossBasis: 'SUPPORT_ZONE' | 'RESISTANCE_ZONE' | 'SWING_LOW' | 'SWING_HIGH' | 'DEMAND_ZONE' | 'SUPPLY_ZONE' | 'STRUCTURAL_CANDLE' | 'ATR_FALLBACK';
  structuralLevel: number | null;
}

/**
 * Deterministically calculates a structural stop loss based on market structure.
 * 
 * Priorities for BUY:
 * 1. Support Zone (priceMin below entry)
 * 2. Swing Low (price below entry)
 * 3. Demand Zone / Bullish FVG (bottom below entry)
 * 4. Structural Candle Low (lowest low of recent candles below entry)
 * 5. ATR Fallback (entry - 1.5 * ATR)
 * 
 * Priorities for SELL:
 * 1. Resistance Zone (priceMax above entry)
 * 2. Swing High (price above entry)
 * 3. Supply Zone / Bearish FVG (top above entry)
 * 4. Structural Candle High (highest high of recent candles above entry)
 * 5. ATR Fallback (entry + 1.5 * ATR)
 */
export function calculateStructuralStopLoss(
  direction: 'BUY' | 'SELL',
  entryPrice: number,
  marketStructure: MarketStructure
): StructuralStopLossResult {
  const atr = marketStructure?.volatilityInformation?.atr && marketStructure.volatilityInformation.atr > 0
    ? marketStructure.volatilityInformation.atr
    : entryPrice * 0.005;

  // Buffer: 20% of ATR or 0.05% of entry price, whichever is greater
  const buffer = Math.max(atr * 0.2, entryPrice * 0.0005);

  if (direction === 'BUY') {
    // 1. Support Zones below entry
    if (marketStructure?.supportZones && marketStructure.supportZones.length > 0) {
      const validSupports = marketStructure.supportZones.filter(z => z.priceMin < entryPrice);
      if (validSupports.length > 0) {
        // Pick nearest support below entry (highest priceMin below entry)
        const nearestSupport = validSupports.reduce((prev, curr) => curr.priceMin > prev.priceMin ? curr : prev);
        const sl = nearestSupport.priceMin - buffer;
        if (sl < entryPrice && sl > 0) {
          return {
            stopLoss: Number(sl.toFixed(5)),
            stopLossBasis: 'SUPPORT_ZONE',
            structuralLevel: Number(nearestSupport.priceMin.toFixed(5))
          };
        }
      }
    }

    // 2. Swing Lows below entry
    if (marketStructure?.swingLows && marketStructure.swingLows.length > 0) {
      const validLows = marketStructure.swingLows.filter(s => s.price < entryPrice);
      if (validLows.length > 0) {
        // Pick the recent swing low below entry
        const recentLow = validLows[validLows.length - 1].price;
        const sl = recentLow - buffer;
        if (sl < entryPrice && sl > 0) {
          return {
            stopLoss: Number(sl.toFixed(5)),
            stopLossBasis: 'SWING_LOW',
            structuralLevel: Number(recentLow.toFixed(5))
          };
        }
      }
    }

    // 3. Bullish FVG (Demand Zone) below entry
    if (marketStructure?.fairValueGaps && marketStructure.fairValueGaps.length > 0) {
      const validFvgs = marketStructure.fairValueGaps.filter(f => f.type === 'BULLISH_FVG' && f.bottom < entryPrice);
      if (validFvgs.length > 0) {
        const fvg = validFvgs[validFvgs.length - 1];
        const sl = fvg.bottom - buffer;
        if (sl < entryPrice && sl > 0) {
          return {
            stopLoss: Number(sl.toFixed(5)),
            stopLossBasis: 'DEMAND_ZONE',
            structuralLevel: Number(fvg.bottom.toFixed(5))
          };
        }
      }
    }

    // 4. Structural Candle Low (lowest low of recent candles below entry)
    if (marketStructure?.latestCandles && marketStructure.latestCandles.length > 0) {
      const recentLows = marketStructure.latestCandles.map(c => c.low).filter(l => l < entryPrice);
      if (recentLows.length > 0) {
        const lowestCandleLow = Math.min(...recentLows);
        const sl = lowestCandleLow - buffer;
        if (sl < entryPrice && sl > 0) {
          return {
            stopLoss: Number(sl.toFixed(5)),
            stopLossBasis: 'STRUCTURAL_CANDLE',
            structuralLevel: Number(lowestCandleLow.toFixed(5))
          };
        }
      }
    }

    // 5. ATR Fallback
    const fallbackSL = entryPrice - (atr * 1.5);
    return {
      stopLoss: Number(fallbackSL.toFixed(5)),
      stopLossBasis: 'ATR_FALLBACK',
      structuralLevel: null
    };
  } else {
    // SELL direction
    // 1. Resistance Zones above entry
    if (marketStructure?.resistanceZones && marketStructure.resistanceZones.length > 0) {
      const validResistances = marketStructure.resistanceZones.filter(z => z.priceMax > entryPrice);
      if (validResistances.length > 0) {
        // Pick nearest resistance above entry (lowest priceMax above entry)
        const nearestResistance = validResistances.reduce((prev, curr) => curr.priceMax < prev.priceMax ? curr : prev);
        const sl = nearestResistance.priceMax + buffer;
        if (sl > entryPrice) {
          return {
            stopLoss: Number(sl.toFixed(5)),
            stopLossBasis: 'RESISTANCE_ZONE',
            structuralLevel: Number(nearestResistance.priceMax.toFixed(5))
          };
        }
      }
    }

    // 2. Swing Highs above entry
    if (marketStructure?.swingHighs && marketStructure.swingHighs.length > 0) {
      const validHighs = marketStructure.swingHighs.filter(s => s.price > entryPrice);
      if (validHighs.length > 0) {
        const recentHigh = validHighs[validHighs.length - 1].price;
        const sl = recentHigh + buffer;
        if (sl > entryPrice) {
          return {
            stopLoss: Number(sl.toFixed(5)),
            stopLossBasis: 'SWING_HIGH',
            structuralLevel: Number(recentHigh.toFixed(5))
          };
        }
      }
    }

    // 3. Bearish FVG (Supply Zone) above entry
    if (marketStructure?.fairValueGaps && marketStructure.fairValueGaps.length > 0) {
      const validFvgs = marketStructure.fairValueGaps.filter(f => f.type === 'BEARISH_FVG' && f.top > entryPrice);
      if (validFvgs.length > 0) {
        const fvg = validFvgs[validFvgs.length - 1];
        const sl = fvg.top + buffer;
        if (sl > entryPrice) {
          return {
            stopLoss: Number(sl.toFixed(5)),
            stopLossBasis: 'SUPPLY_ZONE',
            structuralLevel: Number(fvg.top.toFixed(5))
          };
        }
      }
    }

    // 4. Structural Candle High (highest high of recent candles above entry)
    if (marketStructure?.latestCandles && marketStructure.latestCandles.length > 0) {
      const recentHighs = marketStructure.latestCandles.map(c => c.high).filter(h => h > entryPrice);
      if (recentHighs.length > 0) {
        const highestCandleHigh = Math.max(...recentHighs);
        const sl = highestCandleHigh + buffer;
        if (sl > entryPrice) {
          return {
            stopLoss: Number(sl.toFixed(5)),
            stopLossBasis: 'STRUCTURAL_CANDLE',
            structuralLevel: Number(highestCandleHigh.toFixed(5))
          };
        }
      }
    }

    // 5. ATR Fallback
    const fallbackSL = entryPrice + (atr * 1.5);
    return {
      stopLoss: Number(fallbackSL.toFixed(5)),
      stopLossBasis: 'ATR_FALLBACK',
      structuralLevel: null
    };
  }
}

/**
 * Validates model-returned SL or applies deterministic structural SL fallback.
 */
export function validateAndResolveStopLoss(
  direction: 'BUY' | 'SELL',
  entryPrice: number,
  modelSL: number | undefined | null,
  modelSLBasis: string | undefined | null,
  marketStructure: MarketStructure
): {
  stopLoss: number;
  stopLossBasis: string;
  structuralLevel: number | null;
  validated: boolean;
} {
  const deterministicResult = calculateStructuralStopLoss(direction, entryPrice, marketStructure);

  if (typeof modelSL === 'number' && !isNaN(modelSL) && isFinite(modelSL) && modelSL > 0 && modelSL !== entryPrice) {
    const isBuyValid = direction === 'BUY' && modelSL < entryPrice;
    const isSellValid = direction === 'SELL' && modelSL > entryPrice;

    const atr = marketStructure?.volatilityInformation?.atr || entryPrice * 0.005;
    const distance = Math.abs(entryPrice - modelSL);
    const maxReasonableDistance = Math.max(entryPrice * 0.15, atr * 10);

    if ((isBuyValid || isSellValid) && distance <= maxReasonableDistance) {
      const allowedBases = [
        'SUPPORT_ZONE', 'RESISTANCE_ZONE', 'SWING_LOW', 'SWING_HIGH',
        'DEMAND_ZONE', 'SUPPLY_ZONE', 'STRUCTURAL_CANDLE', 'ATR_FALLBACK'
      ];
      const basis = modelSLBasis && allowedBases.includes(modelSLBasis)
        ? modelSLBasis
        : deterministicResult.stopLossBasis;

      return {
        stopLoss: Number(modelSL.toFixed(5)),
        stopLossBasis: basis,
        structuralLevel: deterministicResult.structuralLevel,
        validated: true
      };
    }
  }

  // Model SL invalid or missing -> fallback to deterministic structural SL
  return {
    stopLoss: deterministicResult.stopLoss,
    stopLossBasis: deterministicResult.stopLossBasis,
    structuralLevel: deterministicResult.structuralLevel,
    validated: false
  };
}
