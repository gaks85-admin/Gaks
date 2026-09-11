import { MarketStructure } from './market-structure-engine.js';

export interface StructuralStopLossResult {
  stopLoss: number;
  stopLossBasis: 'SUPPORT_ZONE' | 'RESISTANCE_ZONE' | 'SWING_LOW' | 'SWING_HIGH' | 'DEMAND_ZONE' | 'SUPPLY_ZONE' | 'ORDER_BLOCK' | 'STRUCTURAL_CANDLE' | 'ATR_FALLBACK';
  structuralLevel: number | null;
}

/**
 * Returns the maximum allowable stop loss distance in pips for a given timeframe and asset.
 * Prevents an intraday M5/M15 trade from carrying an H4 swing-sized stop loss.
 */
export function getTimeframeMaxSlPips(timeframe?: string, symbol?: string): number {
  const tf = (timeframe || 'M5').toUpperCase();
  const sym = (symbol || '').toUpperCase();
  const isGold = sym.includes('XAU') || sym.includes('GOLD');
  const isJpy = sym.includes('JPY');

  if (isGold) {
    if (tf === 'M1' || tf === 'M5') return 15; // $1.50 on Gold
    if (tf === 'M15') return 25; // $2.50 on Gold
    if (tf === 'M30') return 40;
    if (tf === 'H1') return 60;
    return 100;
  }

  if (isJpy) {
    if (tf === 'M1' || tf === 'M5') return 5.0;
    if (tf === 'M15') return 8.0;
    if (tf === 'M30') return 12.0;
    if (tf === 'H1') return 20.0;
    return 40.0;
  }

  // Major Forex (EURUSD, GBPUSD, etc.)
  if (tf === 'M1' || tf === 'M5') return 5.0; // Max 5 pips on M5
  if (tf === 'M15') return 8.0; // Max 8 pips on M15
  if (tf === 'M30') return 12.0;
  if (tf === 'H1') return 18.0;
  if (tf === 'H4') return 35.0;
  return 8.0;
}

/**
 * Returns the maximum allowable price departure in pips past a marked zone before a trade is deemed
 * a late entry / chasing market move that has already occurred.
 */
export function getMaxDeparturePips(timeframe?: string, symbol?: string, atr?: number): number {
  const tf = (timeframe || 'M5').toUpperCase();
  const sym = (symbol || '').toUpperCase();
  const isGold = sym.includes('XAU') || sym.includes('GOLD');

  if (isGold) {
    if (tf === 'M1' || tf === 'M5') return 15; // $1.50 departure
    if (tf === 'M15') return 25;
    return 50;
  }

  // For Forex:
  if (tf === 'M1' || tf === 'M5') return 3.5; // Maximum 3.5 pips past the zone
  if (tf === 'M15') return 5.0; // Maximum 5.0 pips past the zone
  if (tf === 'M30') return 7.5;
  if (tf === 'H1') return 12.0;
  return 25.0;
}

export interface ZoneProximityAndSlResult {
  isLateEntry: boolean;
  lateReason?: string;
  entryPrice: number;
  stopLoss: number;
  stopLossBasis: 'ORDER_BLOCK' | 'SUPPLY_ZONE' | 'DEMAND_ZONE' | 'STRUCTURAL_ZONE' | 'SWING_HIGH' | 'SWING_LOW' | 'ATR_FALLBACK';
  structuralLevel: number | null;
  slDistancePips: number;
  isSlTooWide: boolean;
}

/**
 * Validates zone proximity (preventing late entries and chasing) and calculates a tight,
 * timeframe-scaled structural stop loss.
 */
export function validateZoneProximityAndStopLoss(
  direction: 'BUY' | 'SELL',
  currentPrice: number,
  zone: { low: number; high: number; invalidationLevel: number; type?: string; direction?: string },
  timeframe?: string,
  symbol?: string,
  atr?: number
): ZoneProximityAndSlResult {
  const sym = (symbol || '').toUpperCase();
  const tf = (timeframe || 'M5').toUpperCase();
  const pipSize = (sym.includes('JPY') || sym.includes('XAU') || sym.includes('GOLD') || currentPrice > 50) ? 0.01 : 0.0001;
  const effectiveAtr = atr && atr > 0 ? atr : currentPrice * 0.0005;
  const maxDeparturePips = getMaxDeparturePips(tf, sym, effectiveAtr);
  const maxSlPips = getTimeframeMaxSlPips(tf, sym);

  // 1. Check late entry / departure past zone
  let departurePips = 0;
  if (direction === 'SELL') {
    if (currentPrice < zone.low) {
      departurePips = (zone.low - currentPrice) / pipSize;
    }
  } else {
    if (currentPrice > zone.high) {
      departurePips = (currentPrice - zone.high) / pipSize;
    }
  }

  if (departurePips > maxDeparturePips) {
    return {
      isLateEntry: true,
      lateReason: `Late entry rejected: Price (${currentPrice.toFixed(5)}) has moved ${departurePips.toFixed(1)} pips past marked ${zone.type || 'POI'} [${zone.low.toFixed(5)} - ${zone.high.toFixed(5)}] in ${direction} direction (Max allowable departure: ${maxDeparturePips.toFixed(1)} pips). Entry window closed; trade would chase the move and inflate Stop Loss.`,
      entryPrice: currentPrice,
      stopLoss: zone.invalidationLevel,
      stopLossBasis: direction === 'SELL' ? 'SUPPLY_ZONE' : 'DEMAND_ZONE',
      structuralLevel: direction === 'SELL' ? zone.high : zone.low,
      slDistancePips: Math.abs(currentPrice - zone.invalidationLevel) / pipSize,
      isSlTooWide: true
    };
  }

  // 2. Resolve tight timeframe-appropriate Stop Loss
  const buffer = Math.max(effectiveAtr * 0.15, pipSize * 1.5);
  let resolvedSl = zone.invalidationLevel;
  const basis: any = zone.type?.includes('ORDER_BLOCK') ? 'ORDER_BLOCK' : (direction === 'SELL' ? 'SUPPLY_ZONE' : 'DEMAND_ZONE');

  let slDistancePips = Math.abs(currentPrice - resolvedSl) / pipSize;

  // If raw invalidation exceeds max allowable SL for timeframe, clamp to tight zone boundary + buffer
  if (slDistancePips > maxSlPips) {
    if (direction === 'SELL') {
      const tightSl = zone.high + buffer;
      const tightDistancePips = Math.abs(currentPrice - tightSl) / pipSize;
      if (tightDistancePips <= maxSlPips) {
        resolvedSl = Number(tightSl.toFixed(5));
        slDistancePips = tightDistancePips;
      }
    } else {
      const tightSl = zone.low - buffer;
      const tightDistancePips = Math.abs(currentPrice - tightSl) / pipSize;
      if (tightDistancePips <= maxSlPips) {
        resolvedSl = Number(tightSl.toFixed(5));
        slDistancePips = tightDistancePips;
      }
    }
  }

  const isSlTooWide = slDistancePips > (maxSlPips * 1.25);

  return {
    isLateEntry: false,
    entryPrice: currentPrice,
    stopLoss: Number(resolvedSl.toFixed(5)),
    stopLossBasis: basis,
    structuralLevel: direction === 'SELL' ? zone.high : zone.low,
    slDistancePips,
    isSlTooWide
  };
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

  const tf = (marketStructure as any)?.timeframe || 'M5';
  const sym = (marketStructure as any)?.pair || '';
  const pipSize = (sym.includes('JPY') || sym.includes('XAU') || sym.includes('GOLD') || entryPrice > 50) ? 0.01 : 0.0001;
  const maxSlPips = getTimeframeMaxSlPips(tf, sym);
  const maxSlDistance = maxSlPips * pipSize;

  // Buffer: 20% of ATR or 0.05% of entry price, whichever is greater
  const buffer = Math.max(atr * 0.2, entryPrice * 0.0005);

  if (direction === 'BUY') {
    // 0. Marked Zone (Order Block / Demand POI) below entry
    const markedZone = (marketStructure as any)?.markedZone;
    if (markedZone && markedZone.direction === 'BUY' && markedZone.invalidationLevel && markedZone.invalidationLevel < entryPrice) {
      const rawDist = entryPrice - markedZone.invalidationLevel;
      if (rawDist <= maxSlDistance) {
        return {
          stopLoss: Number(markedZone.invalidationLevel.toFixed(5)),
          stopLossBasis: markedZone.type?.includes('ORDER_BLOCK') ? 'ORDER_BLOCK' : 'DEMAND_ZONE',
          structuralLevel: Number(markedZone.low.toFixed(5))
        };
      }
      // If raw invalidation is too wide for timeframe, clamp to zone low - buffer
      const tightSl = markedZone.low - buffer;
      if (tightSl < entryPrice && (entryPrice - tightSl) <= maxSlDistance) {
        return {
          stopLoss: Number(tightSl.toFixed(5)),
          stopLossBasis: 'DEMAND_ZONE',
          structuralLevel: Number(markedZone.low.toFixed(5))
        };
      }
    }

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
    const fallbackDist = Math.min(atr * 0.75, maxSlDistance);
    const fallbackSL = entryPrice - fallbackDist;
    return {
      stopLoss: Number(fallbackSL.toFixed(5)),
      stopLossBasis: 'ATR_FALLBACK',
      structuralLevel: null
    };
  } else {
    // SELL direction
    // 0. Marked Zone (Order Block / Supply POI) above entry
    const markedZone = (marketStructure as any)?.markedZone;
    if (markedZone && markedZone.direction === 'SELL' && markedZone.invalidationLevel && markedZone.invalidationLevel > entryPrice) {
      const rawDist = markedZone.invalidationLevel - entryPrice;
      if (rawDist <= maxSlDistance) {
        return {
          stopLoss: Number(markedZone.invalidationLevel.toFixed(5)),
          stopLossBasis: markedZone.type?.includes('ORDER_BLOCK') ? 'ORDER_BLOCK' : 'SUPPLY_ZONE',
          structuralLevel: Number(markedZone.high.toFixed(5))
        };
      }
      // If raw invalidation is too wide for timeframe, clamp to zone high + buffer
      const tightSl = markedZone.high + buffer;
      if (tightSl > entryPrice && (tightSl - entryPrice) <= maxSlDistance) {
        return {
          stopLoss: Number(tightSl.toFixed(5)),
          stopLossBasis: 'SUPPLY_ZONE',
          structuralLevel: Number(markedZone.high.toFixed(5))
        };
      }
    }

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
    const fallbackDist = Math.min(atr * 0.75, maxSlDistance);
    const fallbackSL = entryPrice + fallbackDist;
    return {
      stopLoss: Number(fallbackSL.toFixed(5)),
      stopLossBasis: 'ATR_FALLBACK',
      structuralLevel: null
    };
  }
}

/**
 * Validates model-returned SL or applies deterministic structural SL fallback.
 * Enforces timeframe-scaled maximum distance so models cannot propose swing-scale stops on M5.
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

  const tf = (marketStructure as any)?.timeframe || 'M5';
  const sym = (marketStructure as any)?.pair || '';
  const pipSize = (sym.includes('JPY') || sym.includes('XAU') || sym.includes('GOLD') || entryPrice > 50) ? 0.01 : 0.0001;
  const maxSlPips = getTimeframeMaxSlPips(tf, sym);
  const maxReasonableDistance = maxSlPips * pipSize * 1.25;

  if (typeof modelSL === 'number' && !isNaN(modelSL) && isFinite(modelSL) && modelSL > 0 && modelSL !== entryPrice) {
    const isBuyValid = direction === 'BUY' && modelSL < entryPrice;
    const isSellValid = direction === 'SELL' && modelSL > entryPrice;

    const distance = Math.abs(entryPrice - modelSL);

    if ((isBuyValid || isSellValid) && distance <= maxReasonableDistance) {
      const allowedBases = [
        'SUPPORT_ZONE', 'RESISTANCE_ZONE', 'SWING_LOW', 'SWING_HIGH',
        'DEMAND_ZONE', 'SUPPLY_ZONE', 'ORDER_BLOCK', 'STRUCTURAL_CANDLE', 'ATR_FALLBACK'
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

  // Model SL invalid, missing, or too wide for timeframe -> fallback to deterministic structural SL
  return {
    stopLoss: deterministicResult.stopLoss,
    stopLossBasis: deterministicResult.stopLossBasis,
    structuralLevel: deterministicResult.structuralLevel,
    validated: false
  };
}
