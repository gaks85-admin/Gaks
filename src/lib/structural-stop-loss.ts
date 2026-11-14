import { MarketStructure } from './market-structure-engine.js';

export interface StructuralStopLossResult {
  stopLoss: number;
  stopLossBasis: 'SUPPORT_ZONE' | 'RESISTANCE_ZONE' | 'SWING_LOW' | 'SWING_HIGH' | 'DEMAND_ZONE' | 'SUPPLY_ZONE' | 'ORDER_BLOCK' | 'STRUCTURAL_CANDLE' | 'ATR_FALLBACK';
  structuralLevel: number | null;
}

const CRYPTO_BASES = new Set([
  'BTC', 'ETH', 'SOL', 'XRP', 'LTC', 'ADA', 'DOGE', 'BNB', 'AVAX', 'DOT',
  'LINK', 'MATIC', 'POL', 'UNI', 'NEAR', 'TRX', 'ATOM', 'BCH', 'SHIB', 'TON',
  'SUI', 'PEPE', 'ARB', 'OP', 'APT', 'AAVE', 'ALGO', 'FIL', 'ICP', 'VET',
  'HBAR', 'XLM', 'FTM', 'SAND', 'MANA', 'AXS', 'CRV', 'MKR', 'SNX', 'COMP',
  'INJ', 'RUNE', 'SEI', 'TIA', 'WIF', 'BONK', 'FLOKI', 'ETC', 'XMR', 'ZEC',
  'DASH', 'EOS', 'XTZ', 'THETA', 'KAVA', 'ZIL', 'ENS', 'LDO', 'CRYPTO'
]);

function classifyInstrument(symbol?: string): 'GOLD' | 'SILVER' | 'INDICES' | 'CRYPTO' | 'JPY' | 'FOREX' {
  const sym = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!sym) return 'FOREX';

  const cryptoBase = sym.replace(/(USDT|USDC|BUSD|USD|EUR|GBP|JPY|AUD|CAD|CHF)$/, '');
  if (
    CRYPTO_BASES.has(sym) ||
    CRYPTO_BASES.has(cryptoBase) ||
    sym.includes('CRYPTO') ||
    sym.endsWith('USDT') ||
    sym.endsWith('USDC') ||
    sym.endsWith('BUSD')
  ) {
    return 'CRYPTO';
  }
  if (sym.includes('XAU') || sym.includes('GOLD')) return 'GOLD';
  if (sym.includes('XAG') || sym.includes('SILVER')) return 'SILVER';
  if (
    sym.includes('NAS') || sym.includes('NDX') || sym.includes('US100') || sym.includes('USTEC') ||
    sym.includes('US30') || sym.includes('DJ30') || sym.includes('WS30') || sym.includes('DOW') ||
    sym.includes('SPX') || sym.includes('SP500') || sym.includes('US500') ||
    sym.includes('US2000') || sym.includes('RUT') ||
    sym.includes('GER') || sym.includes('DE30') || sym.includes('DE40') || sym.includes('DAX') ||
    sym.includes('UK100') || sym.includes('FTSE') || sym.includes('FRA40') || sym.includes('CAC40') ||
    sym.includes('EU50') || sym.includes('STOXX') || sym.includes('JP225') || sym.includes('NIKKEI') ||
    sym.includes('HK50') || sym.includes('HSI') || sym.includes('AUS200') || sym.includes('ASX200') ||
    sym.includes('INDEX')
  ) {
    return 'INDICES';
  }
  if (sym.includes('JPY')) return 'JPY';
  return 'FOREX';
}

function getAssetPipSize(symbol?: string, price?: number): number {
  const kind = classifyInstrument(symbol);
  if (kind === 'INDICES') return 1.0;
  if (kind === 'GOLD' || kind === 'SILVER' || kind === 'JPY') return 0.01;
  if (kind === 'CRYPTO') {
    if (price && price >= 1000) return 1.0;
    if (price && price >= 10) return 0.01;
    return 0.0001;
  }
  return (price && price > 50) ? 0.01 : 0.0001;
}

function getAssetBuffer(kind: ReturnType<typeof classifyInstrument>, atr: number, pipSize: number, price: number): number {
  if (kind === 'GOLD') return Math.min(Math.max(atr * 0.15, 0.40), 2.50);
  if (kind === 'SILVER') return Math.min(Math.max(atr * 0.15, 0.03), 0.25);
  if (kind === 'INDICES') return Math.min(Math.max(atr * 0.15, 2.0), 15.0);
  if (kind === 'CRYPTO') return Math.min(Math.max(atr * 0.15, price * 0.0005), price * 0.005);
  if (kind === 'JPY') return Math.min(Math.max(atr * 0.15, 0.015), 0.06);
  return Math.min(Math.max(atr * 0.15, pipSize * 1.5), pipSize * 2.5);
}

function getPricePrecision(kind: ReturnType<typeof classifyInstrument>, price: number): number {
  if (kind === 'FOREX') return 5;
  if (kind === 'JPY') return 3;
  if (kind === 'GOLD' || kind === 'INDICES') return 2;
  if (price >= 1000) return 2;
  if (price >= 10) return 3;
  return 5;
}

/**
 * Returns the maximum allowable stop loss distance in pips for a given timeframe and asset.
 * Asset-aware across Forex, JPY crosses, Gold, Silver, Indices, and Crypto.
 */
export function getTimeframeMaxSlPips(timeframe?: string, symbol?: string, atr?: number, currentPrice?: number): number {
  const tf = (timeframe || 'M5').toUpperCase();
  const kind = classifyInstrument(symbol);
  const pipSize = getAssetPipSize(symbol, currentPrice);
  const atrPips = atr && atr > 0 ? atr / pipSize : 0;

  if (kind === 'GOLD') {
    const base = tf === 'M1' || tf === 'M5' ? 250 : tf === 'M15' ? 400 : tf === 'M30' ? 550 : tf === 'H1' ? 800 : 1500;
    return atrPips > 0 ? Math.max(base, atrPips * 2.5) : base;
  }

  if (kind === 'SILVER') {
    const base = tf === 'M1' || tf === 'M5' ? 25 : tf === 'M15' ? 40 : tf === 'M30' ? 60 : tf === 'H1' ? 85 : 150;
    return atrPips > 0 ? Math.max(base, atrPips * 2.5) : base;
  }

  if (kind === 'INDICES') {
    const base = tf === 'M1' ? 18 : tf === 'M5' ? 30 : tf === 'M15' ? 50 : tf === 'M30' ? 75 : tf === 'H1' ? 120 : 220;
    return atrPips > 0 ? Math.max(base, atrPips * 2.5) : base;
  }

  if (kind === 'CRYPTO') {
    const defaultByTf = tf === 'M1' ? 60 : tf === 'M5' ? 120 : tf === 'M15' ? 180 : tf === 'M30' ? 260 : tf === 'H1' ? 380 : 650;
    if (atrPips > 0) {
      const mult = tf === 'M1' ? 2.2 : tf === 'M5' ? 2.8 : tf === 'M15' ? 3.2 : tf === 'M30' ? 3.5 : tf === 'H1' ? 4.0 : 5.0;
      return Math.max(20, atrPips * mult);
    }
    return defaultByTf;
  }

  if (kind === 'JPY') {
    if (tf === 'M1' || tf === 'M5') return 5.0;
    if (tf === 'M15') return 8.0;
    if (tf === 'M30') return 12.0;
    if (tf === 'H1') return 20.0;
    return 40.0;
  }

  // Major & Cross Forex (EURUSD, GBPUSD, EURGBP, etc.)
  if (tf === 'M1') return 4.0;
  if (tf === 'M5') return 6.5;
  if (tf === 'M15') return 10.0;
  if (tf === 'M30') return 15.0;
  if (tf === 'H1') return 22.0;
  if (tf === 'H4') return 40.0;
  return 10.0;
}

/**
 * Returns the maximum allowable price departure in pips past a marked zone before a trade is deemed
 * a late entry / chasing market move that has already occurred.
 */
export function getMaxDeparturePips(timeframe?: string, symbol?: string, atr?: number, currentPrice?: number): number {
  const tf = (timeframe || 'M5').toUpperCase();
  const kind = classifyInstrument(symbol);
  const pipSize = getAssetPipSize(symbol, currentPrice);
  const atrPips = atr && atr > 0 ? atr / pipSize : 0;

  if (kind === 'GOLD') {
    const base = tf === 'M1' || tf === 'M5' ? 150 : tf === 'M15' ? 250 : 500;
    return atrPips > 0 ? Math.max(base, atrPips * 1.8) : base;
  }

  if (kind === 'SILVER') {
    const base = tf === 'M1' || tf === 'M5' ? 15 : tf === 'M15' ? 25 : 50;
    return atrPips > 0 ? Math.max(base, atrPips * 1.8) : base;
  }

  if (kind === 'INDICES') {
    const base = tf === 'M1' || tf === 'M5' ? 20 : tf === 'M15' ? 35 : tf === 'M30' ? 55 : 90;
    return atrPips > 0 ? Math.max(base, atrPips * 1.8) : base;
  }

  if (kind === 'CRYPTO') {
    const defaultByTf = tf === 'M1' || tf === 'M5' ? 80 : tf === 'M15' ? 130 : tf === 'M30' ? 180 : 280;
    if (atrPips > 0) {
      const mult = tf === 'M1' || tf === 'M5' ? 2.0 : tf === 'M15' ? 2.5 : 3.0;
      return Math.max(12, atrPips * mult);
    }
    return defaultByTf;
  }

  if (kind === 'JPY') {
    if (tf === 'M1' || tf === 'M5') return 5.0;
    if (tf === 'M15') return 8.0;
    if (tf === 'M30') return 12.0;
    if (tf === 'H1') return 18.0;
    return 30.0;
  }

  // Standard Forex
  if (tf === 'M1' || tf === 'M5') return 3.5;
  if (tf === 'M15') return 5.0;
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
 * asset- & timeframe-scaled structural stop loss.
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
  const kind = classifyInstrument(sym);
  const pipSize = getAssetPipSize(sym, currentPrice);
  const defaultAtrPct = kind === 'FOREX' || kind === 'JPY' ? 0.0005 : 0.0025;
  const effectiveAtr = atr && atr > 0 ? atr : currentPrice * defaultAtrPct;
  const maxDeparturePips = getMaxDeparturePips(tf, sym, effectiveAtr, currentPrice);
  const maxSlPips = getTimeframeMaxSlPips(tf, sym, effectiveAtr, currentPrice);
  const precision = getPricePrecision(kind, currentPrice);

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
      lateReason: `Late entry rejected: Price (${currentPrice.toFixed(precision)}) has moved ${departurePips.toFixed(1)} pips past marked ${zone.type || 'POI'} [${zone.low?.toFixed(precision) || '0'} - ${zone.high?.toFixed(precision) || '0'}] in ${direction} direction (Max allowable departure: ${maxDeparturePips.toFixed(1)} pips). Entry window closed; trade would chase the move and inflate Stop Loss.`,
      entryPrice: currentPrice,
      stopLoss: zone.invalidationLevel,
      stopLossBasis: direction === 'SELL' ? 'SUPPLY_ZONE' : 'DEMAND_ZONE',
      structuralLevel: direction === 'SELL' ? zone.high : zone.low,
      slDistancePips: Math.abs(currentPrice - zone.invalidationLevel) / pipSize,
      isSlTooWide: true
    };
  }

  const buffer = getAssetBuffer(kind, effectiveAtr, pipSize, currentPrice);
  const basis: any = zone.type?.includes('ORDER_BLOCK') ? 'ORDER_BLOCK' : (direction === 'SELL' ? 'SUPPLY_ZONE' : 'DEMAND_ZONE');

  let resolvedSl = direction === 'SELL' ? (zone.high + buffer) : (zone.low - buffer);

  if (zone.invalidationLevel) {
    if (direction === 'SELL' && zone.invalidationLevel > currentPrice) {
      const invDistPips = (zone.invalidationLevel - currentPrice) / pipSize;
      if (invDistPips <= maxSlPips) {
        resolvedSl = Math.min(zone.invalidationLevel, zone.high + buffer * 1.5);
      }
    } else if (direction === 'BUY' && zone.invalidationLevel < currentPrice) {
      const invDistPips = (currentPrice - zone.invalidationLevel) / pipSize;
      if (invDistPips <= maxSlPips) {
        resolvedSl = Math.max(zone.invalidationLevel, zone.low - buffer * 1.5);
      }
    }
  }

  if (direction === 'SELL') {
    resolvedSl = Math.min(resolvedSl, currentPrice + (maxSlPips * pipSize));
  } else {
    resolvedSl = Math.max(resolvedSl, currentPrice - (maxSlPips * pipSize));
  }

  const slDistancePips = Math.abs(currentPrice - resolvedSl) / pipSize;
  const isSlTooWide = slDistancePips > (maxSlPips * 1.25);

  return {
    isLateEntry: false,
    entryPrice: currentPrice,
    stopLoss: Number(resolvedSl.toFixed(precision)),
    stopLossBasis: basis,
    structuralLevel: direction === 'SELL' ? zone.high : zone.low,
    slDistancePips,
    isSlTooWide
  };
}

/**
 * Deterministically calculates a structural stop loss based on market structure.
 */
export function calculateStructuralStopLoss(
  direction: 'BUY' | 'SELL',
  entryPrice: number,
  marketStructure: MarketStructure
): StructuralStopLossResult {
  const tf = (marketStructure as any)?.timeframe || 'M5';
  const sym = (marketStructure as any)?.pair || '';
  const kind = classifyInstrument(sym);
  const pipSize = getAssetPipSize(sym, entryPrice);
  const defaultAtrPct = kind === 'FOREX' || kind === 'JPY' ? 0.0008 : 0.003;

  const atr = marketStructure?.volatilityInformation?.atr && marketStructure.volatilityInformation.atr > 0
    ? marketStructure.volatilityInformation.atr
    : entryPrice * defaultAtrPct;

  const maxSlPips = getTimeframeMaxSlPips(tf, sym, atr, entryPrice);
  const maxSlDistance = maxSlPips * pipSize;
  const buffer = getAssetBuffer(kind, atr, pipSize, entryPrice);
  const minSlDistance = Math.min(Math.max(atr * 0.8, pipSize * 2.5), maxSlDistance * 0.6);
  const precision = getPricePrecision(kind, entryPrice);

  if (direction === 'BUY') {
    const markedZone = (marketStructure as any)?.markedZone;
    let finalSl: number | null = null;
    let finalBasis: StructuralStopLossResult['stopLossBasis'] | null = null;
    let finalStructural: number | null = null;

    if (markedZone && markedZone.direction === 'BUY') {
      const zoneFloor = typeof markedZone.low === 'number' ? markedZone.low : (markedZone.invalidationLevel || entryPrice - buffer);
      const tightSl = zoneFloor - buffer;

      if (markedZone.invalidationLevel && markedZone.invalidationLevel < entryPrice && (entryPrice - markedZone.invalidationLevel) <= maxSlDistance) {
        finalSl = Math.max(markedZone.invalidationLevel, tightSl - buffer);
      } else {
        finalSl = tightSl;
      }

      if (finalSl >= entryPrice || (entryPrice - finalSl) > maxSlDistance) {
        finalSl = entryPrice - maxSlDistance;
      }

      finalBasis = markedZone.type?.includes('ORDER_BLOCK') ? 'ORDER_BLOCK' : 'DEMAND_ZONE';
      finalStructural = zoneFloor;
    }

    if (!finalSl && marketStructure?.supportZones && marketStructure.supportZones.length > 0) {
      const validSupports = marketStructure.supportZones.filter(z => z.priceMin < entryPrice);
      if (validSupports.length > 0) {
        const nearestSupport = validSupports.reduce((prev, curr) => curr.priceMin > prev.priceMin ? curr : prev);
        const sl = Math.max(nearestSupport.priceMin - buffer, entryPrice - maxSlDistance);
        if (sl < entryPrice && sl > 0) {
          finalSl = sl;
          finalBasis = 'SUPPORT_ZONE';
          finalStructural = nearestSupport.priceMin;
        }
      }
    }

    if (!finalSl && marketStructure?.swingLows && marketStructure.swingLows.length > 0) {
      const validLows = marketStructure.swingLows.filter(s => s.price < entryPrice);
      if (validLows.length > 0) {
        const recentLow = validLows[validLows.length - 1].price;
        const sl = Math.max(recentLow - buffer, entryPrice - maxSlDistance);
        if (sl < entryPrice && sl > 0) {
          finalSl = sl;
          finalBasis = 'SWING_LOW';
          finalStructural = recentLow;
        }
      }
    }

    if (!finalSl && marketStructure?.fairValueGaps && marketStructure.fairValueGaps.length > 0) {
      const validFvgs = marketStructure.fairValueGaps.filter(f => f.type === 'BULLISH_FVG' && f.bottom < entryPrice);
      if (validFvgs.length > 0) {
        const fvg = validFvgs[validFvgs.length - 1];
        const sl = Math.max(fvg.bottom - buffer, entryPrice - maxSlDistance);
        if (sl < entryPrice && sl > 0) {
          finalSl = sl;
          finalBasis = 'DEMAND_ZONE';
          finalStructural = fvg.bottom;
        }
      }
    }

    if (!finalSl && marketStructure?.latestCandles && marketStructure.latestCandles.length > 0) {
      const recentLows = marketStructure.latestCandles.map(c => c.low).filter(l => l < entryPrice);
      if (recentLows.length > 0) {
        const lowestCandleLow = Math.min(...recentLows);
        const sl = Math.max(lowestCandleLow - buffer, entryPrice - maxSlDistance);
        if (sl < entryPrice && sl > 0) {
          finalSl = sl;
          finalBasis = 'STRUCTURAL_CANDLE';
          finalStructural = lowestCandleLow;
        }
      }
    }

    let stopLoss = finalSl ?? (entryPrice - Math.min(atr * 0.75, maxSlDistance));
    const basis: StructuralStopLossResult['stopLossBasis'] = finalBasis ?? 'ATR_FALLBACK';

    if ((entryPrice - stopLoss) < minSlDistance) {
      stopLoss = entryPrice - minSlDistance;
    }

    if ((entryPrice - stopLoss) > maxSlDistance * 1.15) {
      stopLoss = entryPrice - maxSlDistance;
    }

    return {
      stopLoss: Number(stopLoss.toFixed(precision)),
      stopLossBasis: basis,
      structuralLevel: finalStructural ? Number(finalStructural.toFixed(precision)) : null
    };
  } else {
    const markedZone = (marketStructure as any)?.markedZone;
    let finalSl: number | null = null;
    let finalBasis: StructuralStopLossResult['stopLossBasis'] | null = null;
    let finalStructural: number | null = null;

    if (markedZone && markedZone.direction === 'SELL') {
      const zoneCeiling = typeof markedZone.high === 'number' ? markedZone.high : (markedZone.invalidationLevel || entryPrice + buffer);
      const tightSl = zoneCeiling + buffer;

      if (markedZone.invalidationLevel && markedZone.invalidationLevel > entryPrice && (markedZone.invalidationLevel - entryPrice) <= maxSlDistance) {
        finalSl = Math.min(markedZone.invalidationLevel, tightSl + buffer);
      } else {
        finalSl = tightSl;
      }

      if (finalSl !== null && (finalSl <= entryPrice || (finalSl - entryPrice) > maxSlDistance)) {
        finalSl = entryPrice + maxSlDistance;
      }

      finalBasis = markedZone.type?.includes('ORDER_BLOCK') ? 'ORDER_BLOCK' : 'SUPPLY_ZONE';
      finalStructural = zoneCeiling;
    }

    if (!finalSl && marketStructure?.resistanceZones && marketStructure.resistanceZones.length > 0) {
      const validResistances = marketStructure.resistanceZones.filter(z => z.priceMax > entryPrice);
      if (validResistances.length > 0) {
        const nearestResistance = validResistances.reduce((prev, curr) => curr.priceMax < prev.priceMax ? curr : prev);
        const sl = Math.min(nearestResistance.priceMax + buffer, entryPrice + maxSlDistance);
        if (sl > entryPrice) {
          finalSl = sl;
          finalBasis = 'RESISTANCE_ZONE';
          finalStructural = nearestResistance.priceMax;
        }
      }
    }

    if (!finalSl && marketStructure?.swingHighs && marketStructure.swingHighs.length > 0) {
      const validHighs = marketStructure.swingHighs.filter(s => s.price > entryPrice);
      if (validHighs.length > 0) {
        const recentHigh = validHighs[validHighs.length - 1].price;
        const sl = Math.min(recentHigh + buffer, entryPrice + maxSlDistance);
        if (sl > entryPrice) {
          finalSl = sl;
          finalBasis = 'SWING_HIGH';
          finalStructural = recentHigh;
        }
      }
    }

    if (!finalSl && marketStructure?.fairValueGaps && marketStructure.fairValueGaps.length > 0) {
      const validFvgs = marketStructure.fairValueGaps.filter(f => f.type === 'BEARISH_FVG' && f.top > entryPrice);
      if (validFvgs.length > 0) {
        const fvg = validFvgs[validFvgs.length - 1];
        const sl = Math.min(fvg.top + buffer, entryPrice + maxSlDistance);
        if (sl > entryPrice) {
          finalSl = sl;
          finalBasis = 'SUPPLY_ZONE';
          finalStructural = fvg.top;
        }
      }
    }

    if (!finalSl && marketStructure?.latestCandles && marketStructure.latestCandles.length > 0) {
      const recentHighs = marketStructure.latestCandles.map(c => c.high).filter(h => h > entryPrice);
      if (recentHighs.length > 0) {
        const highestCandleHigh = Math.max(...recentHighs);
        const sl = Math.min(highestCandleHigh + buffer, entryPrice + maxSlDistance);
        if (sl > entryPrice) {
          finalSl = sl;
          finalBasis = 'STRUCTURAL_CANDLE';
          finalStructural = highestCandleHigh;
        }
      }
    }

    let stopLoss = finalSl ?? (entryPrice + Math.min(atr * 0.75, maxSlDistance));
    const basis: StructuralStopLossResult['stopLossBasis'] = finalBasis ?? 'ATR_FALLBACK';

    if ((stopLoss - entryPrice) < minSlDistance) {
      stopLoss = entryPrice + minSlDistance;
    }

    if ((stopLoss - entryPrice) > maxSlDistance * 1.15) {
      stopLoss = entryPrice + maxSlDistance;
    }

    return {
      stopLoss: Number(stopLoss.toFixed(precision)),
      stopLossBasis: basis,
      structuralLevel: finalStructural ? Number(finalStructural.toFixed(precision)) : null
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

  const tf = (marketStructure as any)?.timeframe || 'M5';
  const sym = (marketStructure as any)?.pair || '';
  const kind = classifyInstrument(sym);
  const pipSize = getAssetPipSize(sym, entryPrice);
  const atr = marketStructure?.volatilityInformation?.atr;
  const maxSlPips = getTimeframeMaxSlPips(tf, sym, atr, entryPrice);
  const maxReasonableDistance = maxSlPips * pipSize * 1.25;
  const precision = getPricePrecision(kind, entryPrice);

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
        stopLoss: Number(modelSL.toFixed(precision)),
        stopLossBasis: basis,
        structuralLevel: deterministicResult.structuralLevel,
        validated: true
      };
    }
  }

  return {
    stopLoss: deterministicResult.stopLoss,
    stopLossBasis: deterministicResult.stopLossBasis,
    structuralLevel: deterministicResult.structuralLevel,
    validated: false
  };
}
