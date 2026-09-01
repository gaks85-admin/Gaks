import { Candle } from './strategy-engine.js';
import { MarketStructure, FVG, SwingLevel } from './market-structure-engine.js';
import { CompilerOutput } from './strategy-compiler/types.js';

export type ZoneType =
  | 'SUPPORT'
  | 'RESISTANCE'
  | 'DEMAND'
  | 'SUPPLY'
  | 'BULLISH_FVG'
  | 'BEARISH_FVG'
  | 'BULLISH_ORDER_BLOCK'
  | 'BEARISH_ORDER_BLOCK'
  | 'SWING_LOW_LIQUIDITY'
  | 'SWING_HIGH_LIQUIDITY'
  | 'KEY_LEVEL';

export type ZoneStatus =
  | 'NO_ZONE'
  | 'WAITING_FOR_TAP'
  | 'ZONE_TAPPED'
  | 'CONFIRMED'
  | 'INVALIDATED'
  | 'EXPIRED';

export interface MarkedZone {
  id: string;
  type: ZoneType;
  direction: 'BUY' | 'SELL';
  high: number;
  low: number;
  invalidationLevel: number;
  strength: number; // 0 to 100
  createdAt: string;
  createdCandleTime?: string;
  tappedAt?: string | null;
  tapCount: number;
  status: ZoneStatus;
  reasoning: string;
  candleIndex?: number;
}

export interface ZoneEvaluationResult {
  status: ZoneStatus;
  isTapped: boolean;
  isInvalidated: boolean;
  reason: string;
  updatedZone: MarkedZone;
}

/**
 * Generates a unique zone identifier.
 */
export function generateZoneId(pair: string, type: ZoneType, direction: string): string {
  const cleanPair = (pair || 'ZONE').replace(/[^a-zA-Z0-9]/g, '');
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).substring(2, 6);
  return `zone_${cleanPair}_${direction.toLowerCase()}_${timestamp}_${randomSuffix}`;
}

/**
 * Calculates ATR and price buffer for zone boundary and invalidation cushioning.
 */
function calculateBuffer(candles: Candle[], currentPrice: number): { atr: number; buffer: number } {
  if (!candles || candles.length < 2) {
    const atrFallback = currentPrice * 0.005;
    return { atr: atrFallback, buffer: Math.max(atrFallback * 0.2, currentPrice * 0.0005) };
  }

  let totalTr = 0;
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    totalTr += tr;
  }

  const atr = totalTr / (candles.length - 1);
  const buffer = Math.max(atr * 0.2, currentPrice * 0.0005);
  return { atr, buffer };
}

/**
 * Identifies high-quality Point of Interest (POI) / Marked Zone from market structure and historical candles.
 * 
 * Evaluates in priority:
 * 1. Fresh Fair Value Gaps (Bullish/Bearish FVGs)
 * 2. Order Blocks / Demand / Supply structure
 * 3. Protected Swing Highs / Swing Lows (Liquidity Levels)
 * 4. Structural Support & Resistance Zones
 */
export function identifyMarkedZone(
  candles: Candle[],
  marketStructure: MarketStructure,
  compiledStrategy?: CompilerOutput | null,
  currentPrice?: number
): MarkedZone | null {
  if (!candles || candles.length < 5) return null;

  const sortedCandles = [...candles].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const latestCandle = sortedCandles[sortedCandles.length - 1];
  const activePrice = (currentPrice && currentPrice > 0) ? currentPrice : latestCandle.close;
  const { atr, buffer } = calculateBuffer(sortedCandles, activePrice);

  const trend = marketStructure?.trend || 'SIDEWAYS';
  const pair = marketStructure?.pair || 'MARKET';

  // Strategy preference filtering: 100% align with user's configured rules
  const rules = compiledStrategy?.compiled_rules;
  const hasOrderBlockPreference = !!(rules?.order_block || rules?.supply_demand || rules?.unmitigated_zone);
  const hasFvgPreference = !!rules?.fair_value_gap;
  const hasSrPreference = !!(rules?.support || rules?.resistance || rules?.support_rejection || rules?.resistance_rejection);
  const hasLiquidityPreference = !!rules?.liquidity_sweep;

  const isStrategyFiltered = hasOrderBlockPreference || hasFvgPreference || hasSrPreference || hasLiquidityPreference;
  const allowFvg = isStrategyFiltered ? hasFvgPreference : true;
  const allowOrderBlocks = isStrategyFiltered ? hasOrderBlockPreference : true;
  const allowLiquidity = isStrategyFiltered ? hasLiquidityPreference : true;
  const allowSr = isStrategyFiltered ? hasSrPreference : true;
  const enforceUnmitigated = rules?.unmitigated_zone !== false; // Default true for quality order blocks

  const candidateZones: MarkedZone[] = [];

  // =========================================================================
  // 1. ORDER BLOCKS & SUPPLY / DEMAND (Strict Unmitigated Discovery)
  // =========================================================================
  if (allowOrderBlocks) {
    // Scan historical candles for fresh, unmitigated order blocks
    for (let i = sortedCandles.length - 2; i >= Math.max(1, sortedCandles.length - 35); i--) {
      const c = sortedCandles[i];
      const nextC = sortedCandles[i + 1];
      const body = Math.abs(c.close - c.open);
      const nextBody = Math.abs(nextC.close - nextC.open);

      // Bullish Demand Order Block: Down or base candle followed by strong upward displacement
      const isBullishDisplacement = (nextC.close > c.high || (nextC.close > nextC.open && nextBody > Math.max(body * 1.2, atr * 0.7)));
      if ((c.close <= c.open || body <= atr * 0.5) && isBullishDisplacement && c.low < activePrice) {
        const obHigh = Number(Math.max(c.open, c.high).toFixed(5));
        const obLow = Number(c.low.toFixed(5));
        const invalidation = Number((obLow - buffer).toFixed(5));

        // Check if any subsequent candle already mitigated this zone
        let isMitigated = false;
        for (let k = i + 2; k < sortedCandles.length - 1; k++) {
          if (sortedCandles[k].low <= obHigh) {
            isMitigated = true;
            break;
          }
        }

        if (!enforceUnmitigated || !isMitigated) {
          const distanceRatio = Math.abs(activePrice - obHigh) / activePrice;
          const proximityScore = Math.max(0, 98 - (distanceRatio * 1000));
          const strength = Math.round(proximityScore * (trend === 'BULLISH' ? 1.0 : 0.85));

          candidateZones.push({
            id: generateZoneId(pair, 'BULLISH_ORDER_BLOCK', 'BUY'),
            type: 'BULLISH_ORDER_BLOCK',
            direction: 'BUY',
            high: obHigh,
            low: obLow,
            invalidationLevel: invalidation,
            strength,
            createdAt: new Date().toISOString(),
            createdCandleTime: String(c.timestamp),
            tappedAt: null,
            tapCount: 0,
            status: 'WAITING_FOR_TAP',
            reasoning: `Fresh unmitigated Demand Zone / Bullish Order Block [${obLow} - ${obHigh}].`,
            candleIndex: i
          });
        }
      }

      // Bearish Supply Order Block: Up or base candle followed by sharp downward displacement
      const isBearishDisplacement = (nextC.close < c.low || (nextC.close < nextC.open && nextBody > Math.max(body * 1.2, atr * 0.7)));
      if ((c.close >= c.open || body <= atr * 0.5) && isBearishDisplacement && c.high > activePrice) {
        const obHigh = Number(c.high.toFixed(5));
        const obLow = Number(Math.min(c.open, c.low).toFixed(5));
        const invalidation = Number((obHigh + buffer).toFixed(5));

        // Check if any subsequent candle already mitigated this zone
        let isMitigated = false;
        for (let k = i + 2; k < sortedCandles.length - 1; k++) {
          if (sortedCandles[k].high >= obLow) {
            isMitigated = true;
            break;
          }
        }

        if (!enforceUnmitigated || !isMitigated) {
          const distanceRatio = Math.abs(obLow - activePrice) / activePrice;
          const proximityScore = Math.max(0, 98 - (distanceRatio * 1000));
          const strength = Math.round(proximityScore * (trend === 'BEARISH' ? 1.0 : 0.85));

          candidateZones.push({
            id: generateZoneId(pair, 'BEARISH_ORDER_BLOCK', 'SELL'),
            type: 'BEARISH_ORDER_BLOCK',
            direction: 'SELL',
            high: obHigh,
            low: obLow,
            invalidationLevel: invalidation,
            strength,
            createdAt: new Date().toISOString(),
            createdCandleTime: String(c.timestamp),
            tappedAt: null,
            tapCount: 0,
            status: 'WAITING_FOR_TAP',
            reasoning: `Fresh unmitigated Supply Zone / Bearish Order Block [${obLow} - ${obHigh}].`,
            candleIndex: i
          });
        }
      }
    }
  }

  // =========================================================================
  // 2. FAIR VALUE GAPS (FVG) - Only if enabled in user strategy
  // =========================================================================
  if (allowFvg && marketStructure?.fairValueGaps && marketStructure.fairValueGaps.length > 0) {
    // Unfilled or partially filled FVGs
    for (const fvg of marketStructure.fairValueGaps) {
      if (fvg.isFilled) continue;

      if (fvg.type === 'BULLISH_FVG' && fvg.top <= activePrice * 1.015) {
        // Bullish Demand FVG below or near current price
        const low = Number(fvg.bottom.toFixed(5));
        const high = Number(fvg.top.toFixed(5));
        const invalidation = Number((low - buffer).toFixed(5));
        
        const distanceRatio = Math.abs(activePrice - high) / activePrice;
        const proximityScore = Math.max(0, 100 - (distanceRatio * 1000));
        const strength = Math.round(proximityScore * (trend === 'BULLISH' ? 1.0 : 0.8));

        candidateZones.push({
          id: generateZoneId(pair, 'BULLISH_FVG', 'BUY'),
          type: 'BULLISH_FVG',
          direction: 'BUY',
          high,
          low,
          invalidationLevel: invalidation,
          strength,
          createdAt: new Date().toISOString(),
          createdCandleTime: String(latestCandle.timestamp),
          tappedAt: null,
          tapCount: 0,
          status: 'WAITING_FOR_TAP',
          reasoning: `Bullish Fair Value Gap [${low} - ${high}] identified as key institutional demand area.`,
          candleIndex: fvg.candleIndex
        });
      } else if (fvg.type === 'BEARISH_FVG' && fvg.bottom >= activePrice * 0.985) {
        // Bearish Supply FVG above or near current price
        const low = Number(fvg.bottom.toFixed(5));
        const high = Number(fvg.top.toFixed(5));
        const invalidation = Number((high + buffer).toFixed(5));

        const distanceRatio = Math.abs(low - activePrice) / activePrice;
        const proximityScore = Math.max(0, 100 - (distanceRatio * 1000));
        const strength = Math.round(proximityScore * (trend === 'BEARISH' ? 1.0 : 0.8));

        candidateZones.push({
          id: generateZoneId(pair, 'BEARISH_FVG', 'SELL'),
          type: 'BEARISH_FVG',
          direction: 'SELL',
          high,
          low,
          invalidationLevel: invalidation,
          strength,
          createdAt: new Date().toISOString(),
          createdCandleTime: String(latestCandle.timestamp),
          tappedAt: null,
          tapCount: 0,
          status: 'WAITING_FOR_TAP',
          reasoning: `Bearish Fair Value Gap [${low} - ${high}] identified as key institutional supply area.`,
          candleIndex: fvg.candleIndex
        });
      }
    }
  }

  // =========================================================================
  // 3. KEY SWING LEVELS & LIQUIDITY POOLS - Only if allowed
  // =========================================================================
  if (allowLiquidity && marketStructure?.swingLows && marketStructure.swingLows.length > 0) {
    const validSwingLows = marketStructure.swingLows.filter(s => !s.isBroken && s.price < activePrice);
    if (validSwingLows.length > 0) {
      const nearestLow = validSwingLows[validSwingLows.length - 1];
      const lowPrice = Number(nearestLow.price.toFixed(5));
      const zoneHigh = Number((lowPrice + buffer * 0.8).toFixed(5));
      const invalidation = Number((lowPrice - buffer).toFixed(5));

      const distanceRatio = Math.abs(activePrice - zoneHigh) / activePrice;
      const strength = Math.round(Math.max(0, 85 - (distanceRatio * 1000)));

      candidateZones.push({
        id: generateZoneId(pair, 'SWING_LOW_LIQUIDITY', 'BUY'),
        type: 'SWING_LOW_LIQUIDITY',
        direction: 'BUY',
        high: zoneHigh,
        low: lowPrice,
        invalidationLevel: invalidation,
        strength,
        createdAt: new Date().toISOString(),
        createdCandleTime: String(nearestLow.timestamp),
        tappedAt: null,
        tapCount: 0,
        status: 'WAITING_FOR_TAP',
        reasoning: `Protected Swing Low liquidity zone at price ${lowPrice}.`,
        candleIndex: nearestLow.index
      });
    }
  }

  if (allowLiquidity && marketStructure?.swingHighs && marketStructure.swingHighs.length > 0) {
    const validSwingHighs = marketStructure.swingHighs.filter(s => !s.isBroken && s.price > activePrice);
    if (validSwingHighs.length > 0) {
      const nearestHigh = validSwingHighs[validSwingHighs.length - 1];
      const highPrice = Number(nearestHigh.price.toFixed(5));
      const zoneLow = Number((highPrice - buffer * 0.8).toFixed(5));
      const invalidation = Number((highPrice + buffer).toFixed(5));

      const distanceRatio = Math.abs(zoneLow - activePrice) / activePrice;
      const strength = Math.round(Math.max(0, 85 - (distanceRatio * 1000)));

      candidateZones.push({
        id: generateZoneId(pair, 'SWING_HIGH_LIQUIDITY', 'SELL'),
        type: 'SWING_HIGH_LIQUIDITY',
        direction: 'SELL',
        high: highPrice,
        low: zoneLow,
        invalidationLevel: invalidation,
        strength,
        createdAt: new Date().toISOString(),
        createdCandleTime: String(nearestHigh.timestamp),
        tappedAt: null,
        tapCount: 0,
        status: 'WAITING_FOR_TAP',
        reasoning: `Protected Swing High liquidity zone at price ${highPrice}.`,
        candleIndex: nearestHigh.index
      });
    }
  }

  // =========================================================================
  // 4. STRUCTURAL SUPPORT / RESISTANCE ZONES - Only if allowed
  // =========================================================================
  if (allowSr && marketStructure?.supportZones && marketStructure.supportZones.length > 0) {
    for (const sz of marketStructure.supportZones) {
      if (sz.priceMin < activePrice) {
        const low = Number(sz.priceMin.toFixed(5));
        const high = Number(sz.priceMax.toFixed(5));
        const invalidation = Number((low - buffer).toFixed(5));

        candidateZones.push({
          id: generateZoneId(pair, 'SUPPORT', 'BUY'),
          type: 'SUPPORT',
          direction: 'BUY',
          high,
          low,
          invalidationLevel: invalidation,
          strength: Math.min(100, (sz.strength || 1) * 20),
          createdAt: new Date().toISOString(),
          createdCandleTime: String(latestCandle.timestamp),
          tappedAt: null,
          tapCount: 0,
          status: 'WAITING_FOR_TAP',
          reasoning: `Structural Support Zone [${low} - ${high}].`
        });
      }
    }
  }

  if (allowSr && marketStructure?.resistanceZones && marketStructure.resistanceZones.length > 0) {
    for (const rz of marketStructure.resistanceZones) {
      if (rz.priceMax > activePrice) {
        const low = Number(rz.priceMin.toFixed(5));
        const high = Number(rz.priceMax.toFixed(5));
        const invalidation = Number((high + buffer).toFixed(5));

        candidateZones.push({
          id: generateZoneId(pair, 'RESISTANCE', 'SELL'),
          type: 'RESISTANCE',
          direction: 'SELL',
          high,
          low,
          invalidationLevel: invalidation,
          strength: Math.min(100, (rz.strength || 1) * 20),
          createdAt: new Date().toISOString(),
          createdCandleTime: String(latestCandle.timestamp),
          tappedAt: null,
          tapCount: 0,
          status: 'WAITING_FOR_TAP',
          reasoning: `Structural Resistance Zone [${low} - ${high}].`
        });
      }
    }
  }

  if (candidateZones.length === 0) {
    return null;
  }

  // Filter candidates aligned with trend if trend is strong
  let filteredCandidates = candidateZones;
  if (trend === 'BULLISH') {
    const buyCandidates = candidateZones.filter(z => z.direction === 'BUY');
    if (buyCandidates.length > 0) filteredCandidates = buyCandidates;
  } else if (trend === 'BEARISH') {
    const sellCandidates = candidateZones.filter(z => z.direction === 'SELL');
    if (sellCandidates.length > 0) filteredCandidates = sellCandidates;
  }

  // Sort by highest strength and closest proximity
  filteredCandidates.sort((a, b) => b.strength - a.strength);

  return filteredCandidates[0];
}

/**
 * Checks whether price or incoming candle has tapped/entered the zone.
 */
export function isPriceInOrTappingZone(
  zone: MarkedZone,
  candle: Candle,
  currentPrice?: number
): boolean {
  if (!zone || !candle) return false;

  const low = candle.low;
  const high = candle.high;

  // Candle range overlaps zone range
  const candleOverlaps = (low <= zone.high && high >= zone.low);

  if (candleOverlaps) return true;

  if (currentPrice !== undefined && currentPrice !== null && !isNaN(currentPrice)) {
    if (currentPrice >= zone.low && currentPrice <= zone.high) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluates the current state of an existing marked zone:
 * 1. Checks for structural invalidation (e.g. candle close through zone & invalidation level)
 * 2. Checks for price tap/entry
 * 3. Checks for zone expiration/staleness
 */
export function evaluateZoneState(
  zone: MarkedZone,
  latestCandle: Candle,
  currentPrice: number,
  atr?: number
): ZoneEvaluationResult {
  const updatedZone: MarkedZone = { ...zone };

  // =========================================================================
  // 1. STRUCTURAL INVALIDATION CHECK
  // =========================================================================
  if (zone.direction === 'BUY') {
    // For a BUY (Demand) zone:
    // If the latest closed candle closes BELOW the invalidation level, the zone is structurally broken.
    if (latestCandle.close < zone.invalidationLevel || currentPrice < zone.invalidationLevel) {
      updatedZone.status = 'INVALIDATED';
      return {
        status: 'INVALIDATED',
        isTapped: false,
        isInvalidated: true,
        reason: `Zone invalidated: Price (${currentPrice.toFixed(5)}) or Candle Close (${latestCandle.close.toFixed(5)}) broke below invalidation level (${zone.invalidationLevel.toFixed(5)}).`,
        updatedZone
      };
    }
  } else if (zone.direction === 'SELL') {
    // For a SELL (Supply) zone:
    // If the latest closed candle closes ABOVE the invalidation level, the zone is structurally broken.
    if (latestCandle.close > zone.invalidationLevel || currentPrice > zone.invalidationLevel) {
      updatedZone.status = 'INVALIDATED';
      return {
        status: 'INVALIDATED',
        isTapped: false,
        isInvalidated: true,
        reason: `Zone invalidated: Price (${currentPrice.toFixed(5)}) or Candle Close (${latestCandle.close.toFixed(5)}) broke above invalidation level (${zone.invalidationLevel.toFixed(5)}).`,
        updatedZone
      };
    }
  }

  // =========================================================================
  // 2. TAP DETECTION CHECK
  // =========================================================================
  const tapped = isPriceInOrTappingZone(zone, latestCandle, currentPrice);

  if (tapped) {
    updatedZone.status = 'ZONE_TAPPED';
    updatedZone.tappedAt = new Date().toISOString();
    updatedZone.tapCount = (zone.tapCount || 0) + 1;

    return {
      status: 'ZONE_TAPPED',
      isTapped: true,
      isInvalidated: false,
      reason: `Zone tapped: Price (${currentPrice.toFixed(5)}) / Candle range [${latestCandle.low} - ${latestCandle.high}] entered marked zone [${zone.low} - ${zone.high}].`,
      updatedZone
    };
  }

  // =========================================================================
  // 3. WAITING STATE (Price has not yet reached the zone)
  // =========================================================================
  updatedZone.status = 'WAITING_FOR_TAP';
  return {
    status: 'WAITING_FOR_TAP',
    isTapped: false,
    isInvalidated: false,
    reason: `Waiting for tap: Price (${currentPrice.toFixed(5)}) is outside zone [${zone.low} - ${zone.high}] (${zone.direction} setup).`,
    updatedZone
  };
}
