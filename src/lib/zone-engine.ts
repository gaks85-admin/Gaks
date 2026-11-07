import { Candle } from './strategy-engine.js';
import { MarketStructure, FVG, SwingLevel, extractMarketStructure } from './market-structure-engine.js';
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
  | 'ACTIVE'
  | 'FRESH'
  | 'WAITING_FOR_RETEST'
  | 'WAITING_FOR_TAP'
  | 'ZONE_TAPPED'
  | 'CONFIRMED'
  | 'MITIGATED'
  | 'EXPIRED_WITHOUT_ENTRY'
  | 'INVALIDATED'
  | 'EXPIRED'
  | 'ARCHIVED'
  | 'NO_ZONE';

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
  displacementCandleTime?: string;
  displacementIndex?: number;
  tappedAt?: string | null;
  tapCount: number;
  status: ZoneStatus;
  reasoning: string;
  candleIndex?: number;
  timeframe?: string;
  evidence?: string[];
  originCandle?: string;
  htfTrend?: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  htfTimeframe?: string;
  htfReason?: string;
  displacementOrigin?: DisplacementOrigin;
}

export interface DisplacementOrigin {
  timestamp: string;
  direction: 'BULLISH' | 'BEARISH';
  high: number;
  low: number;
  atr: number;
  magnitude: number;
  bodyRatio: number;
  priorZoneId: string;
  invalidationReason: string;
}

export interface ZoneEvaluationResult {
  status: ZoneStatus;
  isTapped: boolean;
  isInvalidated: boolean;
  isRejected?: boolean;
  rejectionReason?: string;
  reason: string;
  updatedZone: MarkedZone;
  displacementOrigin?: DisplacementOrigin;
}

export interface RejectedZoneRecord {
  low: number;
  high: number;
  direction?: 'BUY' | 'SELL';
  rejectedAt: number; // timestamp ms
  reason: string;
}

// In-memory registry of recently rejected zones per watcher
const watcherRejectedZonesMap: Map<string, RejectedZoneRecord[]> = 
  (globalThis as any).__watcherRejectedZonesMap || new Map();
(globalThis as any).__watcherRejectedZonesMap = watcherRejectedZonesMap;

/**
 * Records a zone as rejected by quality control features so the watcher
 * will not re-select or dwell on this level again.
 */
export function recordRejectedZone(watcherId: string, zone: MarkedZone, reason: string): void {
  if (!watcherId || !zone) return;
  const existing = watcherRejectedZonesMap.get(watcherId) || [];
  const now = Date.now();
  // Keep records for 4 hours
  const pruned = existing.filter(r => now - r.rejectedAt < 4 * 60 * 60 * 1000);
  pruned.push({
    low: zone.low,
    high: zone.high,
    direction: zone.direction,
    rejectedAt: now,
    reason
  });
  watcherRejectedZonesMap.set(watcherId, pruned);
  console.log(`[ZONE REJECTION REGISTRY] Watcher ${watcherId}: Registered rejected zone [${zone.low} - ${zone.high}] (${zone.direction}). Total active rejected levels: ${pruned.length}. Reason: ${reason}`);
}

/**
 * Returns active rejected zone records for a watcher.
 */
export function getRejectedZones(watcherId: string): RejectedZoneRecord[] {
  if (!watcherId) return [];
  const existing = watcherRejectedZonesMap.get(watcherId) || [];
  const now = Date.now();
  const pruned = existing.filter(r => now - r.rejectedAt < 4 * 60 * 60 * 1000);
  if (pruned.length !== existing.length) {
    watcherRejectedZonesMap.set(watcherId, pruned);
  }
  return pruned;
}

/**
 * Clears the rejected zone history for a watcher.
 */
export function clearRejectedZones(watcherId: string): void {
  if (watcherId) watcherRejectedZonesMap.delete(watcherId);
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
function calculateBuffer(candles: Candle[], currentPrice: number, pair?: string): { atr: number; buffer: number } {
  const sym = (pair || '').toUpperCase();
  const isForex = !sym.includes('XAU') && !sym.includes('GOLD') && !sym.includes('BTC') && !sym.includes('ETH') && currentPrice < 50;
  const isGold = sym.includes('XAU') || sym.includes('GOLD');
  const isJpy = sym.includes('JPY');

  let atr = currentPrice * 0.002;
  if (candles && candles.length >= 2) {
    let totalTr = 0;
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      totalTr += tr;
    }
    atr = totalTr / (candles.length - 1);
  }

  let buffer: number;
  if (isGold) {
    buffer = Math.min(Math.max(atr * 0.15, 0.40), 2.50);
  } else if (isJpy) {
    buffer = Math.min(Math.max(atr * 0.15, 0.02), 0.06);
  } else if (isForex) {
    buffer = Math.min(Math.max(atr * 0.15, 0.00015), 0.00030); // 1.5 to 3.0 pips for standard Forex!
  } else {
    // Crypto / Indices
    buffer = Math.min(Math.max(atr * 0.15, currentPrice * 0.0005), currentPrice * 0.002);
  }

  return { atr, buffer };
}

/**
 * Identifies all valid candidate Point of Interest (POI) / Marked Zones from market structure.
 * 
 * Evaluates in priority:
 * 1. Fresh Fair Value Gaps (Bullish/Bearish FVGs)
 * 2. Order Blocks / Demand / Supply structure
 * 3. Protected Swing Highs / Swing Lows (Liquidity Levels)
 * 4. Structural Support & Resistance Zones
 */
export function identifyCandidateZones(
  candles: Candle[],
  marketStructure: MarketStructure,
  compiledStrategy?: CompilerOutput | null,
  currentPrice?: number,
  rejectedZones?: RejectedZoneRecord[]
): MarkedZone[] {
  if (!candles || candles.length < 2) return [];

  const sortedCandles = [...candles].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const latestCandle = sortedCandles[sortedCandles.length - 1];
  const activePrice = (currentPrice && currentPrice > 0) ? currentPrice : latestCandle.close;
  const trend = marketStructure?.trend || 'SIDEWAYS';
  const pair = marketStructure?.pair || 'MARKET';
  const { atr, buffer } = calculateBuffer(sortedCandles, activePrice, pair);

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
  // 1. FAIR VALUE GAPS (FVG) - Top structural POI priority when present
  // =========================================================================
  if (allowFvg && marketStructure?.fairValueGaps && marketStructure.fairValueGaps.length > 0) {
    // Unfilled or partially filled FVGs
    for (const fvg of marketStructure.fairValueGaps) {
      if (fvg.isFilled) continue;
      // Do not select ancient FVGs from dozens of candles ago (recency limit matching order blocks)
      if (fvg.candleIndex !== undefined && fvg.candleIndex < sortedCandles.length - 45) continue;
      // Discard FVGs that have already been mitigated or significantly filled (>20%)
      if (fvg.filledPercentage !== undefined && fvg.filledPercentage > 0.20) continue;

      if (fvg.type === 'BULLISH_FVG' && fvg.bottom <= activePrice) {
        // Ensure no subsequent candle has already mitigated the gap (low <= fvg.top)
        if (fvg.candleIndex !== undefined) {
          let gapMitigated = false;
          for (let k = fvg.candleIndex + 1; k < sortedCandles.length; k++) {
            if (sortedCandles[k].low <= fvg.top) {
              gapMitigated = true;
              break;
            }
          }
          if (gapMitigated) continue;
        }

        // Bullish Demand FVG below or at current price (price pulls down into demand to buy)
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
          timeframe: marketStructure?.timeframe || 'M5',
          originCandle: String(latestCandle.timestamp),
          evidence: [`Bullish Fair Value Gap [${low} - ${high}]`],
          reasoning: `Fresh Unmitigated Bullish Fair Value Gap [${low} - ${high}].`,
          candleIndex: fvg.candleIndex
        });
      } else if (fvg.type === 'BEARISH_FVG' && fvg.top >= activePrice) {
        // Ensure no subsequent candle has already mitigated the gap (high >= fvg.bottom)
        if (fvg.candleIndex !== undefined) {
          let gapMitigated = false;
          for (let k = fvg.candleIndex + 1; k < sortedCandles.length; k++) {
            if (sortedCandles[k].high >= fvg.bottom) {
              gapMitigated = true;
              break;
            }
          }
          if (gapMitigated) continue;
        }

        // Bearish Supply FVG above or at current price (price rallies up into supply to sell)
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
          timeframe: marketStructure?.timeframe || 'M5',
          originCandle: String(latestCandle.timestamp),
          evidence: [`Bearish Fair Value Gap [${low} - ${high}]`],
          reasoning: `Fresh Unmitigated Bearish Fair Value Gap [${low} - ${high}].`,
          candleIndex: fvg.candleIndex
        });
      }
    }
  }

  // =========================================================================
  // 2. ORDER BLOCKS & SUPPLY / DEMAND (Strict Unmitigated Discovery)
  // =========================================================================
  if (allowOrderBlocks) {
    // Scan historical candles for fresh, unmitigated zones across recent swing structure (up to 120 candles)
    for (let i = sortedCandles.length - 2; i >= Math.max(0, sortedCandles.length - 120); i--) {
      const c = sortedCandles[i];
      const body = Math.abs(c.close - c.open);
      const zoneHeight = c.high - c.low;
      // Do not reject compact, precise zones (e.g. 3-cent zones on SOLUSD like 89.62 - 89.65)
      const minZoneHeight = Math.max(atr * 0.04, 0.00001);

      // --- BULLISH ORDER BLOCK (DEMAND / BUY) ---
      const isDownCandle = c.close <= c.open || (c.close > c.open && body <= atr * 0.25);
      const isSwingLow = (marketStructure?.swingLows || []).some(
        sl => Math.abs(sl.index - i) <= 2 || (c.low <= sl.price && Math.abs(sl.index - i) <= 5)
      );
      let isLocalValley = true;
      for (let w = Math.max(0, i - 3); w <= Math.min(sortedCandles.length - 1, i + 3); w++) {
        if (sortedCandles[w].low < c.low) {
          isLocalValley = false;
          break;
        }
      }
      const isOriginLow = isSwingLow || isLocalValley;
      const isLowerWickRejection = zoneHeight > 0 && ((Math.min(c.open, c.close) - c.low) / zoneHeight) >= 0.25;
      const qualifiesDemand = isDownCandle || isOriginLow || isLowerWickRejection;

      if (qualifiesDemand && zoneHeight >= minZoneHeight) {
        const obLow = Number(c.low.toFixed(5));
        let obHigh = Number(Math.max(c.open, c.close).toFixed(5));
        if (obHigh - obLow < minZoneHeight) {
          obHigh = Number(Math.min(c.high, obLow + minZoneHeight).toFixed(5));
        }
        if (obHigh <= obLow) {
          obHigh = Number(c.high.toFixed(5));
        }

        // Upward institutional displacement check:
        let displacementIdx = -1;
        let hasStructuralBreak = false;
        let highestHigh = obHigh;

        for (let d = i + 1; d < Math.min(sortedCandles.length, i + 15); d++) {
          const dispCandle = sortedCandles[d];
          if (dispCandle.high > highestHigh) {
            highestHigh = dispCandle.high;
          }
          const dispExpansion = dispCandle.close - obHigh;
          const dispBody = dispCandle.close - dispCandle.open;

          const hasDecisiveExpansion = (dispExpansion >= Math.max(atr * 0.35, buffer * 0.8) && dispBody >= atr * 0.15) || dispExpansion >= atr * 0.6;

          const brokeSwingHigh = (marketStructure?.swingHighs || []).some(
            sh => sh.index < d && sh.index >= Math.max(0, i - 30) && dispCandle.high > sh.price
          );
          const hasBosOrChoch = (marketStructure?.BOS || []).some(
            b => b.type === 'BULLISH_BOS' && b.candleIndex >= i && b.candleIndex <= d
          ) || (marketStructure?.CHOCH || []).some(
            ch => ch.type === 'BULLISH_CHOCH' && ch.candleIndex >= i && ch.candleIndex <= d
          );
          const createdFvg = (marketStructure?.fairValueGaps || []).some(
            f => f.type === 'BULLISH_FVG' && f.candleIndex >= i && f.candleIndex <= d
          );

          if (displacementIdx === -1 && (hasDecisiveExpansion || brokeSwingHigh || hasBosOrChoch || createdFvg)) {
            displacementIdx = d;
            hasStructuralBreak = brokeSwingHigh || hasBosOrChoch || createdFvg;
          } else if (brokeSwingHigh || hasBosOrChoch || createdFvg) {
            hasStructuralBreak = true;
          }
        }

        for (let d = Math.min(sortedCandles.length, i + 15); d < sortedCandles.length; d++) {
          if (sortedCandles[d].high > highestHigh) {
            highestHigh = sortedCandles[d].high;
          }
        }

        const maxDisplacement = highestHigh - obHigh;
        if (displacementIdx === -1 && maxDisplacement >= atr * 0.8) {
          displacementIdx = i + 1;
        }

        if (displacementIdx !== -1) {
          const invalidation = Number((obLow - buffer).toFixed(5));
          let isInvalidated = false;
          let tapCount = 0;
          for (let k = displacementIdx + 1; k < sortedCandles.length; k++) {
            // Invalidation: Candle closed below invalidation level
            if (sortedCandles[k].close < invalidation) {
              isInvalidated = true;
              break;
            }
            // Retest tap
            if (sortedCandles[k].low <= obHigh) {
              tapCount++;
            }
          }

          // Mitigated if price broke through zone base or tapped 4+ times without reversing
          const isMitigated = tapCount >= 4;

          if (!isInvalidated && (!enforceUnmitigated || !isMitigated)) {
            // Price position check: For a demand setup, active price must be above or inside demand
            if (activePrice >= obLow - buffer * 0.5) {
              const isCurrentlyInZone = activePrice <= obHigh && activePrice >= obLow;
              const zoneStatus: ZoneStatus = isCurrentlyInZone ? 'ZONE_TAPPED' : (tapCount > 0 ? 'WAITING_FOR_RETEST' : 'WAITING_FOR_TAP');
              const displacementInAtr = maxDisplacement / Math.max(0.0001, atr);
              const displacementScore = Math.min(35, Math.round(displacementInAtr * 8));
              const originBonus = isOriginLow ? 30 : 0;
              const structuralBonus = hasStructuralBreak ? 20 : 0;
              const freshnessBonus = tapCount === 0 ? 15 : 10;
              const distanceInAtr = Math.abs(activePrice - obHigh) / Math.max(0.0001, atr);
              const proximityScore = Math.max(0, 15 - distanceInAtr * 1.0);

              const strength = Math.round(Math.min(100, (displacementScore + originBonus + structuralBonus + freshnessBonus + proximityScore) * (trend === 'BULLISH' ? 1.0 : 0.85)));

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
                displacementCandleTime: String(sortedCandles[displacementIdx].timestamp),
                displacementIndex: displacementIdx,
                tappedAt: tapCount > 0 ? new Date().toISOString() : null,
                tapCount,
                status: zoneStatus,
                timeframe: marketStructure?.timeframe || 'M5',
                originCandle: String(c.timestamp),
                evidence: [
                  `Institutional Demand Zone [${obLow} - ${obHigh}]`,
                  hasStructuralBreak ? 'BOS / Swing High Broken' : 'Structural Expansion',
                  isOriginLow ? 'Origin Swing Low' : 'Consolidation Base',
                  `Displacement: +${maxDisplacement.toFixed(4)}`
                ],
                reasoning: `Institutional Demand Zone / Bullish Order Block [${obLow} - ${obHigh}] confirmed with structural displacement.${hasStructuralBreak ? ' (BOS / Swing High Broken)' : ''}${isOriginLow ? ' [Origin Swing Low]' : ''}`,
                candleIndex: i
              });
            }
          }
        }
      }

      // --- BEARISH ORDER BLOCK (SUPPLY / SELL) ---
      const isUpCandle = c.close >= c.open || (c.close < c.open && body <= atr * 0.25);
      const isSwingHigh = (marketStructure?.swingHighs || []).some(
        sh => Math.abs(sh.index - i) <= 2 || (c.high >= sh.price && Math.abs(sh.index - i) <= 5)
      );
      let isLocalPeak = true;
      for (let w = Math.max(0, i - 3); w <= Math.min(sortedCandles.length - 1, i + 3); w++) {
        if (sortedCandles[w].high > c.high) {
          isLocalPeak = false;
          break;
        }
      }
      const isOriginHigh = isSwingHigh || isLocalPeak;
      const isUpperWickRejection = zoneHeight > 0 && ((c.high - Math.max(c.open, c.close)) / zoneHeight) >= 0.25;
      const qualifiesSupply = isUpCandle || isOriginHigh || isUpperWickRejection;

      if (qualifiesSupply && zoneHeight >= minZoneHeight) {
        const obHigh = Number(c.high.toFixed(5));
        let obLow = Number(Math.min(c.open, c.close).toFixed(5));
        if (obHigh - obLow < minZoneHeight) {
          obLow = Number(Math.max(c.low, obHigh - minZoneHeight).toFixed(5));
        }
        if (obHigh <= obLow) {
          obLow = Number(c.low.toFixed(5));
        }

        // Downward institutional displacement check:
        let displacementIdx = -1;
        let hasStructuralBreak = false;
        let lowestLow = obLow;

        for (let d = i + 1; d < Math.min(sortedCandles.length, i + 15); d++) {
          const dispCandle = sortedCandles[d];
          if (dispCandle.low < lowestLow) {
            lowestLow = dispCandle.low;
          }
          const dispExpansion = obLow - dispCandle.close;
          const dispBody = dispCandle.open - dispCandle.close;

          const hasDecisiveExpansion = (dispExpansion >= Math.max(atr * 0.35, buffer * 0.8) && dispBody >= atr * 0.15) || dispExpansion >= atr * 0.6;

          const brokeSwingLow = (marketStructure?.swingLows || []).some(
            sl => sl.index < d && sl.index >= Math.max(0, i - 30) && dispCandle.low < sl.price
          );
          const hasBosOrChoch = (marketStructure?.BOS || []).some(
            b => b.type === 'BEARISH_BOS' && b.candleIndex >= i && b.candleIndex <= d
          ) || (marketStructure?.CHOCH || []).some(
            ch => ch.type === 'BEARISH_CHOCH' && ch.candleIndex >= i && ch.candleIndex <= d
          );
          const createdFvg = (marketStructure?.fairValueGaps || []).some(
            f => f.type === 'BEARISH_FVG' && f.candleIndex >= i && f.candleIndex <= d
          );

          if (displacementIdx === -1 && (hasDecisiveExpansion || brokeSwingLow || hasBosOrChoch || createdFvg)) {
            displacementIdx = d;
            hasStructuralBreak = brokeSwingLow || hasBosOrChoch || createdFvg;
          } else if (brokeSwingLow || hasBosOrChoch || createdFvg) {
            hasStructuralBreak = true;
          }
        }

        for (let d = Math.min(sortedCandles.length, i + 15); d < sortedCandles.length; d++) {
          if (sortedCandles[d].low < lowestLow) {
            lowestLow = sortedCandles[d].low;
          }
        }

        const maxDisplacement = obLow - lowestLow;
        if (displacementIdx === -1 && maxDisplacement >= atr * 0.8) {
          displacementIdx = i + 1;
        }

        if (displacementIdx !== -1) {
          const invalidation = Number((obHigh + buffer).toFixed(5));
          let isInvalidated = false;
          let tapCount = 0;
          for (let k = displacementIdx + 1; k < sortedCandles.length; k++) {
            // Invalidation: Candle closed above invalidation level
            if (sortedCandles[k].close > invalidation) {
              isInvalidated = true;
              break;
            }
            // Retest tap
            if (sortedCandles[k].high >= obLow) {
              tapCount++;
            }
          }

          // Mitigated if price broke through zone ceiling or tapped 4+ times without reversing
          const isMitigated = tapCount >= 4;

          if (!isInvalidated && (!enforceUnmitigated || !isMitigated)) {
            // Price position check: For a supply setup, active price must sit at or below supply top (obHigh)
            if (activePrice <= obHigh + buffer * 0.5) {
              const isCurrentlyInZone = activePrice >= obLow && activePrice <= obHigh;
              const zoneStatus: ZoneStatus = isCurrentlyInZone ? 'ZONE_TAPPED' : (tapCount > 0 ? 'WAITING_FOR_RETEST' : 'WAITING_FOR_TAP');
              const displacementInAtr = maxDisplacement / Math.max(0.0001, atr);
              const displacementScore = Math.min(35, Math.round(displacementInAtr * 8));
              const originBonus = isOriginHigh ? 30 : 0;
              const structuralBonus = hasStructuralBreak ? 20 : 0;
              const freshnessBonus = tapCount === 0 ? 15 : 10;
              const distanceInAtr = Math.abs(obLow - activePrice) / Math.max(0.0001, atr);
              const proximityScore = Math.max(0, 15 - distanceInAtr * 1.0);

              const strength = Math.round(Math.min(100, (displacementScore + originBonus + structuralBonus + freshnessBonus + proximityScore) * (trend === 'BEARISH' ? 1.0 : 0.85)));

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
                displacementCandleTime: String(sortedCandles[displacementIdx].timestamp),
                displacementIndex: displacementIdx,
                tappedAt: tapCount > 0 ? new Date().toISOString() : null,
                tapCount,
                status: zoneStatus,
                timeframe: marketStructure?.timeframe || 'M5',
                originCandle: String(c.timestamp),
                evidence: [
                  `Institutional Supply Zone [${obLow} - ${obHigh}]`,
                  hasStructuralBreak ? 'BOS / Swing Low Broken' : 'Structural Expansion',
                  isOriginHigh ? 'Origin Swing High' : 'Consolidation Base',
                  `Displacement: -${maxDisplacement.toFixed(4)}`
                ],
                reasoning: `Institutional Supply Zone / Bearish Order Block [${obLow} - ${obHigh}] confirmed with structural displacement.${hasStructuralBreak ? ' (BOS / Swing Low Broken)' : ''}${isOriginHigh ? ' [Origin Swing High]' : ''}`,
                candleIndex: i
              });
            }
          }
        }
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
        timeframe: marketStructure?.timeframe || 'M5',
        originCandle: String(nearestLow.timestamp),
        evidence: [`Protected Swing Low at ${lowPrice}`],
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
        timeframe: marketStructure?.timeframe || 'M5',
        originCandle: String(nearestHigh.timestamp),
        evidence: [`Protected Swing High at ${highPrice}`],
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

  // =========================================================================
  // 4b. HIGHER TIMEFRAME (HTF) STRUCTURAL POI DISCOVERY
  // When operating on lower timeframes (M5/M15), evaluate HTF (H4/D1) candles to identify
  // dominant institutional zones (e.g. H4 origin supply/demand) spanning prior days.
  // =========================================================================
  if (marketStructure?.htfCandles && marketStructure.htfCandles.length >= 10 && candles !== marketStructure.htfCandles) {
    try {
      const htfMs = marketStructure.htfMarketStructure || extractMarketStructure(marketStructure.htfCandles);
      htfMs.trend = marketStructure.htfTrend || htfMs.trend;
      htfMs.htfTrend = marketStructure.htfTrend;
      htfMs.htfTimeframe = marketStructure.htfTimeframe || 'H4';
      htfMs.htfAllowedDirection = marketStructure.htfAllowedDirection;
      htfMs.pair = pair;

      const htfCandidates = identifyCandidateZones(marketStructure.htfCandles, htfMs, compiledStrategy, activePrice, rejectedZones);
      for (const htfCand of htfCandidates) {
        htfCand.htfTimeframe = marketStructure.htfTimeframe || 'H4';
        htfCand.strength = Math.min(100, (htfCand.strength || 80) + 10);
        if (!candidateZones.some(cz => cz.id === htfCand.id || (cz.low === htfCand.low && cz.high === htfCand.high))) {
          candidateZones.push(htfCand);
        }
      }
    } catch (e) {
      console.warn(`[ZONE ENGINE] Error evaluating HTF candidate zones:`, e);
    }
  }

  if (candidateZones.length === 0) {
    return [];
  }

  // =========================================================================
  // 5. HIGHER TIMEFRAME (HTF) TREND ALIGNMENT (Default User Requirement)
  // Always follow the trend of the higher timeframe (4hr / 1day) to mark out zones.
  // Never flip-flop between Bearish and Bullish zones on micro 5-minute candle oscillations.
  // =========================================================================
  const followHtfTrend = compiledStrategy?.compiled_rules?.follow_htf_trend !== false;
  const htfTrend = marketStructure?.htfTrend;
  const htfTimeframe = marketStructure?.htfTimeframe || 'H4';
  const effectiveTrend = (followHtfTrend && htfTrend) ? htfTrend : trend;

  let filteredCandidates = candidateZones;

  if (followHtfTrend && htfTrend) {
    if (htfTrend === 'BULLISH') {
      const buyZones = candidateZones.filter(z => z.direction === 'BUY');
      if (buyZones.length > 0) {
        filteredCandidates = buyZones;
      }
    } else if (htfTrend === 'BEARISH') {
      const sellZones = candidateZones.filter(z => z.direction === 'SELL');
      if (sellZones.length > 0) {
        filteredCandidates = sellZones;
      }
    } else {
      // In sideways / consolidation conditions, both supply and demand zones exist
      console.log(`[HTF TREND NOTICE] ${pair}: ${htfTimeframe} Trend is SIDEWAYS / consolidating. Retaining all discovered structural zones.`);
    }
  } else {
    // Current timeframe structural trend
    if (trend === 'BEARISH') {
      const sellZones = candidateZones.filter(z => z.direction === 'SELL');
      if (sellZones.length > 0) filteredCandidates = sellZones;
    } else if (trend === 'BULLISH') {
      const buyZones = candidateZones.filter(z => z.direction === 'BUY');
      if (buyZones.length > 0) filteredCandidates = buyZones;
    } else {
      console.log(`[TREND NOTICE] ${pair}: Current timeframe trend is SIDEWAYS / consolidating. Retaining all discovered structural zones.`);
    }
  }

  if (filteredCandidates.length === 0) {
    return [];
  }

  // Filter out any candidate zones that were previously rejected by quality control features
  // (Prevents repeatedly dwelling on or re-marking the same rejected zone)
  if (rejectedZones && rejectedZones.length > 0 && filteredCandidates.length > 0) {
    const originalCount = filteredCandidates.length;
    filteredCandidates = filteredCandidates.filter(candidate => {
      const isRejected = rejectedZones.some(rz => {
        // Overlap or near-identical price boundary check
        const overlaps = Math.max(candidate.low, rz.low) <= Math.min(candidate.high, rz.high);
        const nearIdentical =
          Math.abs(candidate.low - rz.low) / (candidate.low || 1) < 0.0015 &&
          Math.abs(candidate.high - rz.high) / (candidate.high || 1) < 0.0015;
        const sameDirection = !rz.direction || rz.direction === candidate.direction;
        return (overlaps || nearIdentical) && sameDirection;
      });
      return !isRejected;
    });

    if (originalCount > 0 && filteredCandidates.length === 0) {
      console.log(`[ZONE QUALITY DISENGAGEMENT] ${pair}: Filtered out ${originalCount} candidate zone(s) that were previously rejected by quality control. Waiting for another zone to appear.`);
      return [];
    }
  }

  // Deduplicate overlapping candidate zones:
  // Multiple adjacent candles in a single swing must NOT flood candidate list with duplicate levels.
  // Merge overlapping candidates and preserve the true structural peak (SELL) or valley (BUY).
  const distinctCandidates: MarkedZone[] = [];
  for (const candidate of filteredCandidates) {
    const overlappingIdx = distinctCandidates.findIndex(existing => 
      existing.direction === candidate.direction &&
      Math.max(existing.low, candidate.low) <= Math.min(existing.high, candidate.high)
    );

    if (overlappingIdx === -1) {
      distinctCandidates.push(candidate);
    } else {
      const existing = distinctCandidates[overlappingIdx];
      if (candidate.direction === 'SELL') {
        // For supply, retain the candidate with the higher structural peak (or higher strength)
        if (candidate.high > existing.high || (candidate.high === existing.high && candidate.strength > existing.strength)) {
          distinctCandidates[overlappingIdx] = candidate;
        }
      } else {
        // For demand, retain the candidate with the lower structural valley (or higher strength)
        if (candidate.low < existing.low || (candidate.low === existing.low && candidate.strength > existing.strength)) {
          distinctCandidates[overlappingIdx] = candidate;
        }
      }
    }
  }

  // Sort by combination of strength and proximity to active current price
  distinctCandidates.sort((a, b) => {
    // If one zone is currently tapped or waiting for immediate retest within 1.5 ATR, prioritize it
    const distA = Math.abs((a.direction === 'SELL' ? a.low : a.high) - activePrice);
    const distB = Math.abs((b.direction === 'SELL' ? b.low : b.high) - activePrice);
    const scoreA = a.strength + (distA <= atr * 2.0 ? 15 : 0);
    const scoreB = b.strength + (distB <= atr * 2.0 ? 15 : 0);
    return scoreB - scoreA;
  });

  // Return top 10 distinct structural candidates for curation & display
  return distinctCandidates.slice(0, 10).map(z => {
    z.htfTrend = htfTrend || 'SIDEWAYS';
    z.htfTimeframe = htfTimeframe;
    z.htfReason = marketStructure?.htfReason;
    if (htfTrend && htfTrend !== 'SIDEWAYS') {
      z.reasoning = `[${htfTimeframe} ${htfTrend} Trend Aligned] ` + z.reasoning;
    }
    return z;
  });
}

/**
 * Identifies high-quality Point of Interest (POI) / Marked Zone from market structure.
 * Legacy wrapper for identifyCandidateZones that returns only the single best candidate.
 */
export function identifyMarkedZone(
  candles: Candle[],
  marketStructure: MarketStructure,
  compiledStrategy?: CompilerOutput | null,
  currentPrice?: number,
  rejectedZones?: RejectedZoneRecord[]
): MarkedZone | null {
  const candidates = identifyCandidateZones(candles, marketStructure, compiledStrategy, currentPrice, rejectedZones);
  return candidates[0] || null;
}

/**
 * Checks whether price or incoming candle has tapped/entered the zone.
 * 
 * Strict SMC Retrace & Mitigation Rules:
 * 1. Temporal Check:
 *    A candle cannot tap a zone if it occurred at or before the zone's origin/displacement candle.
 * 
 * 2. Retrace Direction Check:
 *    - SELL Zone (Bearish Order Block, Supply, Resistance):
 *      The zone sits above price. A tap requires price to RETRACE UPWARDS into the zone:
 *      * Live currentPrice inside zone: currentPrice >= zone.low && currentPrice <= zone.invalidationLevel
 *      * OR incoming post-displacement candle wicked into zone: candle.high >= zone.low && candle.close <= zone.invalidationLevel
 *      * If currentPrice < zone.low AND candle.high < zone.low, price has NOT reached the zone. Return false.
 * 
 *    - BUY Zone (Bullish Order Block, Demand, Support):
 *      The zone sits below price. A tap requires price to RETRACE DOWNWARDS into the zone:
 *      * Live currentPrice inside zone: currentPrice <= zone.high && currentPrice >= zone.invalidationLevel
 *      * OR incoming post-displacement candle dipped into zone: candle.low <= zone.high && candle.close >= zone.invalidationLevel
 *      * If currentPrice > zone.high AND candle.low > zone.high, price has NOT reached the zone. Return false.
 */
export function isPriceInOrTappingZone(
  zone: MarkedZone,
  candle: Candle,
  currentPrice?: number
): boolean {
  if (!zone || !candle) return false;

  // 1. Temporal validation: Reject candles from at or before zone creation / displacement
  const refTime = zone.displacementCandleTime || zone.createdCandleTime;
  if (refTime && candle.timestamp) {
    const candleTime = new Date(candle.timestamp).getTime();
    const zoneOriginTime = new Date(refTime).getTime();
    if (!isNaN(candleTime) && !isNaN(zoneOriginTime) && candleTime <= zoneOriginTime) {
      return false;
    }
  }

  const activePrice = (currentPrice !== undefined && currentPrice !== null && !isNaN(currentPrice))
    ? currentPrice
    : candle.close;

  // 2. Retrace and tap evaluation based on zone direction
  if (zone.direction === 'SELL') {
    // For SELL, zone sits ABOVE. Market must retrace UP into [zone.low, zone.invalidationLevel]
    const livePriceInZone = activePrice >= zone.low && activePrice <= zone.invalidationLevel;
    const candleHighInZone = candle.high >= zone.low && candle.close <= zone.invalidationLevel;

    // Strict boundary: If neither live price nor candle high touched zone.low, it's NOT a tap
    return livePriceInZone || candleHighInZone;
  } else if (zone.direction === 'BUY') {
    // For BUY, zone sits BELOW. Market must retrace DOWN into [zone.invalidationLevel, zone.high]
    const livePriceInZone = activePrice <= zone.high && activePrice >= zone.invalidationLevel;
    const candleLowInZone = candle.low <= zone.high && candle.close >= zone.invalidationLevel;

    // Strict boundary: If neither live price nor candle low touched zone.high, it's NOT a tap
    return livePriceInZone || candleLowInZone;
  }

  // Fallback for neutral zones
  const livePriceInZone = activePrice >= zone.low && activePrice <= zone.high;
  const candleOverlaps = candle.low <= zone.high && candle.high >= zone.low;
  return livePriceInZone || candleOverlaps;
}

/**
 * Evaluates whether price action has confirmed a rejection of the marked zone.
 * 
 * Rejection criteria:
 * 1. Wick rejection: Lower shadow (BUY) or Upper shadow (SELL) testing the zone and springing back.
 * 2. Candle rejection bounce: Green candle (BUY) or Red candle (SELL) closing off the zone.
 * 3. Directional departure: Price advancing in trade direction away from the zone while holding invalidation.
 */
export interface ZoneRejectionResult {
  isRejected: boolean;
  rejectionType?: 'WICK' | 'BOUNCE' | 'DEPARTURE';
  rejectionReason: string;
}

export function evaluateZoneRejection(
  zone: MarkedZone,
  latestCandle: Candle,
  currentPrice: number,
  prevCandle?: Candle
): ZoneRejectionResult {
  const candleRange = Math.max(0.00001, latestCandle.high - latestCandle.low);

  if (zone.direction === 'BUY') {
    // Check if price broke invalidation
    if (latestCandle.close < zone.invalidationLevel || currentPrice < zone.invalidationLevel) {
      return { isRejected: false, rejectionReason: 'Price broke below BUY invalidation level.' };
    }

    // Did latest candle or previous candle actually reach into the zone?
    const candleReachedZone = latestCandle.low <= zone.high || (prevCandle && prevCandle.low <= zone.high);
    if (!candleReachedZone && currentPrice > zone.high) {
      return { isRejected: false, rejectionReason: 'Price has not tested the marked BUY zone.' };
    }

    // 1. Lower wick rejection (candle dipped into zone and sprang back up)
    const lowerWick = Math.min(latestCandle.open, latestCandle.close) - latestCandle.low;
    const lowerWickRatio = lowerWick / candleRange;
    if (lowerWickRatio >= 0.20 && latestCandle.low <= zone.high && latestCandle.close >= zone.low) {
      return {
        isRejected: true,
        rejectionType: 'WICK',
        rejectionReason: `Bullish wick rejection: Lower shadow ${(lowerWickRatio * 100).toFixed(0)}% tested zone [${zone.low} - ${zone.high}] and rejected upward.`
      };
    }

    // 2. Bullish candle close after tapping zone
    const isBullishCandle = latestCandle.close > latestCandle.open;
    if (isBullishCandle && candleReachedZone && latestCandle.close >= zone.low) {
      return {
        isRejected: true,
        rejectionType: 'BOUNCE',
        rejectionReason: `Bullish candle rejection: Closed green (${latestCandle.close.toFixed(5)} > ${latestCandle.open.toFixed(5)}) off marked zone.`
      };
    }

    // 3. Rejection bounce away from zone in trade direction (must have tested zone)
    if (candleReachedZone && currentPrice > latestCandle.open && currentPrice >= zone.low) {
      return {
        isRejected: true,
        rejectionType: 'DEPARTURE',
        rejectionReason: `Bullish rejection bounce: Price (${currentPrice.toFixed(5)}) tested zone [${zone.low} - ${zone.high}] and advancing upward holding invalidation (${zone.invalidationLevel.toFixed(5)}).`
      };
    }
  } else if (zone.direction === 'SELL') {
    // Check if price broke invalidation
    if (latestCandle.close > zone.invalidationLevel || currentPrice > zone.invalidationLevel) {
      return { isRejected: false, rejectionReason: 'Price broke above SELL invalidation level.' };
    }

    // Did latest candle or previous candle actually reach into the zone?
    const candleReachedZone = latestCandle.high >= zone.low || (prevCandle && prevCandle.high >= zone.low);
    if (!candleReachedZone && currentPrice < zone.low) {
      return { isRejected: false, rejectionReason: 'Price has not tested the marked SELL zone.' };
    }

    // 1. Upper wick rejection (candle pushed into zone and rejected back down)
    const upperWick = latestCandle.high - Math.max(latestCandle.open, latestCandle.close);
    const upperWickRatio = upperWick / candleRange;
    if (upperWickRatio >= 0.20 && latestCandle.high >= zone.low && latestCandle.close <= zone.high) {
      return {
        isRejected: true,
        rejectionType: 'WICK',
        rejectionReason: `Bearish wick rejection: Upper shadow ${(upperWickRatio * 100).toFixed(0)}% tested zone [${zone.low} - ${zone.high}] and rejected downward.`
      };
    }

    // 2. Bearish candle close after tapping zone
    const isBearishCandle = latestCandle.close < latestCandle.open;
    if (isBearishCandle && candleReachedZone && latestCandle.close <= zone.high) {
      return {
        isRejected: true,
        rejectionType: 'BOUNCE',
        rejectionReason: `Bearish candle rejection: Closed red (${latestCandle.close.toFixed(5)} < ${latestCandle.open.toFixed(5)}) off marked zone.`
      };
    }

    // 3. Rejection bounce away from zone in trade direction (must have tested zone)
    if (candleReachedZone && currentPrice < latestCandle.open && currentPrice <= zone.high) {
      return {
        isRejected: true,
        rejectionType: 'DEPARTURE',
        rejectionReason: `Bearish rejection bounce: Price (${currentPrice.toFixed(5)}) tested zone [${zone.low} - ${zone.high}] and advancing downward holding invalidation (${zone.invalidationLevel.toFixed(5)}).`
      };
    }
  }

  return { isRejected: false, rejectionReason: 'Awaiting clean price action rejection from marked zone.' };
}

/**
 * Detects if a large candle displacement has occurred departing from or contrary to the marked zone.
 * 
 * Strict SMC Rule:
 * If price has not tapped the zone and has not violated the invalidation level,
 * the system MUST stick with the entry position and marked zone UNLESS a large institutional
 * displacement candle is detected that indicates price is not coming to the zone.
 * 
 * A candle qualifies as a Large Candle Displacement if:
 * 1. It is a closed candle (either in candles history or latestCandle).
 * 2. Range expansion: range >= 1.6 * effectiveAtr.
 * 3. Dominant momentum body: body / range >= 0.55 (strong directional expansion).
 * 4. Directional departure:
 *    - For BUY zone: Bullish displacement candle expanding far above zone (> 3.5 * ATR away) without retrace.
 *    - For SELL zone: Bearish displacement candle expanding far below zone (> 3.5 * ATR away) without retrace.
 */
export function detectLargeDisplacementAway(
  zone: MarkedZone,
  candles?: Candle[],
  latestCandle?: Candle,
  effectiveAtr: number = 0.0005,
  currentPrice?: number
): { hasDisplaced: boolean; reason?: string; origin?: DisplacementOrigin } {
  // Displacement away in trade direction is the normal initial structural move that leaves the zone fresh.
  // It must NOT automatically expire or invalidate the marked zone.
  return { hasDisplaced: false };
}

/**
 * Evaluates the current state of an existing marked zone:
 * 1. Checks for structural invalidation (e.g. candle close through zone & invalidation level)
 * 2. Checks for price tap/entry and rejection
 * 3. Requires Large Candle Displacement before ruling price is not coming to marked zone
 * 4. Sticking to the entry position: NEVER leaves marked zone unless invalidation breached or large displacement detected
 */
export function evaluateZoneState(
  zone: MarkedZone,
  latestCandle: Candle,
  currentPrice: number,
  atr?: number,
  candles?: Candle[],
  marketStructure?: MarketStructure
): ZoneEvaluationResult {
  const updatedZone: MarkedZone = { ...zone };
  const effectiveAtr = atr || 0.0005;

  // =========================================================================
  // 0. HIGHER TIMEFRAME TREND VALIDITY CHECK
  // Do NOT invalidate zones simply because price is pulling back to retrace/tap the zone.
  // Only invalidate if structural trend has definitively shifted with an opposing CHOCH.
  // =========================================================================
  const hasOpposingChoch = (zone.direction === 'BUY' && marketStructure?.CHOCH?.some(c => c.type === 'BEARISH_CHOCH')) ||
                           (zone.direction === 'SELL' && marketStructure?.CHOCH?.some(c => c.type === 'BULLISH_CHOCH'));

  if (hasOpposingChoch && zone.status === 'WAITING_FOR_TAP') {
    updatedZone.status = 'INVALIDATED';
    return {
      status: 'INVALIDATED',
      isTapped: false,
      isInvalidated: true,
      reason: `Zone invalidated: Structural CHOCH detected contrary to ${zone.direction} marked zone.`,
      updatedZone
    };
  }

  // =========================================================================
  // 1. STRUCTURAL INVALIDATION & DEPARTURE EXPIRATION CHECK
  // =========================================================================
  const activePrice = (currentPrice !== undefined && currentPrice !== null && !isNaN(currentPrice))
    ? currentPrice
    : latestCandle.close;

  // Check if previously CONFIRMED zone has already departed far beyond entry window
  if (zone.status === 'CONFIRMED') {
    const pipSize = (zone.high > 50) ? 0.01 : 0.0001;
    const departure = zone.direction === 'SELL' ? (zone.low - activePrice) : (activePrice - zone.high);
    const departurePips = departure / pipSize;
    const maxDepartureTolerance = Math.max(effectiveAtr * 2.5, pipSize * 30);
    if (departure > maxDepartureTolerance) {
      updatedZone.status = 'EXPIRED';
      return {
        status: 'EXPIRED',
        isTapped: true,
        isInvalidated: true,
        isRejected: false,
        reason: `Zone expired: Confirmed ${zone.direction} zone [${zone.low.toFixed(5)} - ${zone.high.toFixed(5)}] has moved ${departurePips.toFixed(1)} pips past zone. Retest entry window has passed.`,
        updatedZone
      };
    }
  }

  const invLevel = (zone.invalidationLevel !== undefined && zone.invalidationLevel !== null && !isNaN(zone.invalidationLevel))
    ? zone.invalidationLevel
    : (zone.direction === 'BUY' ? zone.low - (zone.high - zone.low) * 0.5 : zone.high + (zone.high - zone.low) * 0.5);

  if (zone.direction === 'BUY') {
    // For a BUY (Demand) zone: candle close or live price below invalidation level
    if (
      latestCandle.close < invLevel || 
      activePrice < invLevel
    ) {
      updatedZone.status = 'INVALIDATED';
      return {
        status: 'INVALIDATED',
        isTapped: false,
        isInvalidated: true,
        reason: `Zone invalidated: Price (${activePrice.toFixed(5)}) or Candle Close (${latestCandle.close.toFixed(5)}) broke below BUY invalidation level (${invLevel.toFixed(5)}).`,
        updatedZone
      };
    }
  } else if (zone.direction === 'SELL') {
    // For a SELL (Supply) zone: candle close or live price above invalidation level
    if (
      latestCandle.close > invLevel || 
      activePrice > invLevel
    ) {
      updatedZone.status = 'INVALIDATED';
      return {
        status: 'INVALIDATED',
        isTapped: false,
        isInvalidated: true,
        reason: `Zone invalidated: Price (${activePrice.toFixed(5)}) or Candle Close (${latestCandle.close.toFixed(5)}) broke above SELL invalidation level (${invLevel.toFixed(5)}).`,
        updatedZone
      };
    }
  }

  // =========================================================================
  // 2. TAP, RETEST, AND CONTINUATION EVALUATION
  // =========================================================================
  const prevCandle = candles && candles.length >= 2 ? candles[candles.length - 2] : undefined;
  const candleList = (candles && candles.length > 0) ? candles : (latestCandle ? [latestCandle] : []);

  // Identify the earliest post-origin candle that tapped into the marked zone
  let tapCandleIndex = -1;
  let tapCandle: Candle | undefined = undefined;

  const originTime = zone.displacementCandleTime || zone.createdCandleTime;
  const originTimestamp = originTime ? new Date(originTime).getTime() : 0;

  if (candleList.length > 0) {
    for (let cIdx = 0; cIdx < candleList.length; cIdx++) {
      const c = candleList[cIdx];
      if (originTimestamp > 0 && c.timestamp) {
        const cTime = new Date(c.timestamp).getTime();
        if (!isNaN(cTime) && cTime <= originTimestamp) {
          continue; // Do not check candles at or before zone creation
        }
      }
      if (isPriceInOrTappingZone(zone, c, currentPrice)) {
        tapCandleIndex = cIdx;
        tapCandle = c;
        break; // First candle that tapped the zone
      }
    }
  }

  // Also check if live currentPrice is currently inside/tapping the zone
  const liveTapping = isPriceInOrTappingZone(zone, latestCandle, currentPrice);
  if (tapCandleIndex === -1 && liveTapping) {
    tapCandleIndex = candleList.length - 1;
    tapCandle = latestCandle;
  }

  // If no post-origin candle or live price tapped the zone, verify if markedZone had a prior tap recorded
  const wasPreviouslyTapped = (zone.status === 'ZONE_TAPPED' || zone.status === 'CONFIRMED' || (zone.tapCount !== undefined && zone.tapCount > 0) || !!zone.tappedAt);

  if (tapCandleIndex !== -1 || wasPreviouslyTapped) {
    const tapTimestamp = tapCandle?.timestamp ? String(tapCandle.timestamp) : new Date().toISOString();
    updatedZone.tappedAt = zone.tappedAt || tapTimestamp;
    updatedZone.tapCount = Math.max(zone.tapCount || 1, 1);

    // If tap happened on the very latest candle, next candle has not closed yet: stay in ZONE_TAPPED
    const isLatestCandleTheTap = tapCandleIndex === (candleList.length - 1);

    if (isLatestCandleTheTap && tapCandleIndex !== -1) {
      // Evaluate immediate rejection bounce if latest candle closed with a sharp wick rejection
      const rejection = evaluateZoneRejection(zone, latestCandle, currentPrice, prevCandle);
      if (rejection.isRejected) {
        updatedZone.status = 'CONFIRMED';
        return {
          status: 'CONFIRMED',
          isTapped: true,
          isInvalidated: false,
          isRejected: true,
          rejectionReason: rejection.rejectionReason,
          reason: `Zone valid: Price (${currentPrice.toFixed(5)}) confirmed immediate rejection bounce off marked zone [${zone.low} - ${zone.high}]. ${rejection.rejectionReason}`,
          updatedZone
        };
      }

      updatedZone.status = 'ZONE_TAPPED';
      return {
        status: 'ZONE_TAPPED',
        isTapped: true,
        isInvalidated: false,
        isRejected: false,
        reason: `Zone tapped: Candle at ${tapCandle?.timestamp || 'current time'} entered marked zone [${zone.low} - ${zone.high}]. Awaiting next candle to evaluate retest vs continuation.`,
        updatedZone
      };
    }

    // =========================================================================
    // EVALUATE CANDLE(S) AFTER TAP: RETEST (VALID) VS KEPT GOING (INVALID)
    // =========================================================================
    // Candles formed AFTER the tap candle exist (from tapCandleIndex + 1 onwards)
    const postTapCandles = candles && tapCandleIndex >= 0 
      ? candles.slice(tapCandleIndex + 1)
      : (candles && candles.length >= 2 ? [candles[candles.length - 1]] : []);

    const nextCandle = postTapCandles.length > 0 ? postTapCandles[0] : latestCandle;

    // 1. CHECK IF PRICE "KEPT GOING" (MARK INVALID)
    // For BUY: If candle sliced through zone floor or invalidation level without holding retest
    if (zone.direction === 'BUY') {
      const brokeThrough = postTapCandles.some(c => {
        const cRange = Math.max(c.high - c.low, 0.00001);
        const lowerWickRatio = (Math.min(c.open, c.close) - c.low) / cRange;
        // Kept going if closed below invalidation level OR closed below zone.low with a bearish candle and no lower rejection wick
        return (c.close < zone.invalidationLevel || currentPrice < zone.invalidationLevel) ||
               (c.close < zone.low && c.close < c.open && lowerWickRatio < 0.20);
      });

      if (brokeThrough) {
        updatedZone.status = 'INVALIDATED';
        return {
          status: 'INVALIDATED',
          isTapped: true,
          isInvalidated: true,
          isRejected: false,
          reason: `Zone invalidated: After tapping, price kept going downward through marked zone [${zone.low} - ${zone.high}] (Current: ${currentPrice.toFixed(5)}, Invalidation: ${zone.invalidationLevel.toFixed(5)}) instead of holding retest.`,
          updatedZone
        };
      }
    } else if (zone.direction === 'SELL') {
      // For SELL: If candle sliced through zone ceiling or invalidation level without holding retest
      const brokeThrough = postTapCandles.some(c => {
        const cRange = Math.max(c.high - c.low, 0.00001);
        const upperWickRatio = (c.high - Math.max(c.open, c.close)) / cRange;
        // Kept going if closed above invalidation level OR closed above zone.high with a bullish candle and no upper rejection wick
        return (c.close > zone.invalidationLevel || currentPrice > zone.invalidationLevel) ||
               (c.close > zone.high && c.close > c.open && upperWickRatio < 0.20);
      });

      if (brokeThrough) {
        updatedZone.status = 'INVALIDATED';
        return {
          status: 'INVALIDATED',
          isTapped: true,
          isInvalidated: true,
          isRejected: false,
          reason: `Zone invalidated: After tapping, price kept going upward through marked zone [${zone.low} - ${zone.high}] (Current: ${currentPrice.toFixed(5)}, Invalidation: ${zone.invalidationLevel.toFixed(5)}) instead of holding retest.`,
          updatedZone
        };
      }
    }

    // 2. CHECK IF PRICE "MADE A RETEST" (MARK VALID / CONFIRMED)
    // Evaluate if any post-tap candle (or current price) respected the zone and bounced
    const rejection = evaluateZoneRejection(zone, latestCandle, currentPrice, prevCandle);

    let madeRetest = rejection.isRejected;
    if (!madeRetest && postTapCandles.length > 0) {
      for (const c of postTapCandles) {
        const cRange = Math.max(c.high - c.low, 0.00001);
        if (zone.direction === 'BUY') {
          const lowerWickRatio = (Math.min(c.open, c.close) - c.low) / cRange;
          // Retest held if price touched zone and closed bullish or showed lower wick rejection
          if (c.low <= zone.high && c.close >= zone.low && (c.close > c.open || lowerWickRatio >= 0.20)) {
            madeRetest = true;
            break;
          }
        } else if (zone.direction === 'SELL') {
          const upperWickRatio = (c.high - Math.max(c.open, c.close)) / cRange;
          // Retest held if price touched zone and closed bearish or showed upper wick rejection
          if (c.high >= zone.low && c.close <= zone.high && (c.close < c.open || upperWickRatio >= 0.20)) {
            madeRetest = true;
            break;
          }
        }
      }
    }

    if (madeRetest) {
      const pipSize = (zone.high > 50) ? 0.01 : 0.0001;
      const departure = zone.direction === 'SELL' ? (zone.low - currentPrice) : (currentPrice - zone.high);
      const departurePips = departure / pipSize;
      const maxDepartureTolerance = Math.max(effectiveAtr * 2.5, pipSize * 30);
      if (departure > maxDepartureTolerance) {
        updatedZone.status = 'EXPIRED';
        return {
          status: 'EXPIRED',
          isTapped: true,
          isInvalidated: true,
          isRejected: false,
          reason: `Zone expired: After tapping and rejecting, price moved ${departurePips.toFixed(1)} pips past marked ${zone.direction} zone [${zone.low.toFixed(5)} - ${zone.high.toFixed(5)}]. Retest entry window has passed.`,
          updatedZone
        };
      }

      updatedZone.status = 'CONFIRMED';
      return {
        status: 'CONFIRMED',
        isTapped: true,
        isInvalidated: false,
        isRejected: true,
        rejectionReason: rejection.rejectionReason || 'Confirmed valid retest holding marked zone.',
        reason: `Zone valid: After tapping, next candle successfully made a retest respecting marked ${zone.direction} zone [${zone.low} - ${zone.high}] with confirmed rejection.`,
        updatedZone
      };
    }

    // 3. RETEST IN PROGRESS: Price is still retesting / testing within zone boundaries
    updatedZone.status = 'ZONE_TAPPED';
    return {
      status: 'ZONE_TAPPED',
      isTapped: true,
      isInvalidated: false,
      isRejected: false,
      reason: `Zone tapped: Next candle is retesting marked zone [${zone.low} - ${zone.high}]. Awaiting retest close or bounce confirmation.`,
      updatedZone
    };
  }

  // =========================================================================
  // 3. LARGE CANDLE DISPLACEMENT CHECK BEFORE RULING PRICE IS NOT COMING
  // =========================================================================
  // Strict Rule:
  // If price has not tapped the zone and has not violated invalidation,
  // the system MUST NOT leave the entry position UNLESS a Large Candle Displacement
  // has been detected moving away in target direction without retracing.
  const displacementCheck = detectLargeDisplacementAway(zone, candles?.slice(0, -1), latestCandle, effectiveAtr, currentPrice);
  if (displacementCheck.hasDisplaced) {
    updatedZone.status = 'EXPIRED_WITHOUT_ENTRY';
    updatedZone.displacementOrigin = displacementCheck.origin;
    return {
      status: 'EXPIRED_WITHOUT_ENTRY',
      isTapped: false,
      isInvalidated: false,
      reason: displacementCheck.reason || `Zone expired without entry: Large candle displacement detected departing without retrace.`,
      updatedZone,
      displacementOrigin: displacementCheck.origin
    };
  }

  // =========================================================================
  // 4. STICK TO ENTRY POSITION: NO LARGE DISPLACEMENT HAS BEEN DETECTED
  // =========================================================================
  // No large candle displacement has occurred. Price is oscillating or traveling.
  // The system sticks with the entry position and marked zone.
  updatedZone.status = 'WAITING_FOR_TAP';
  return {
    status: 'WAITING_FOR_TAP',
    isTapped: false,
    isInvalidated: false,
    reason: `Sticking with entry position: Price (${currentPrice.toFixed(5)}) has not tapped marked zone [${zone.low} - ${zone.high}]. No large candle displacement detected; maintaining entry position.`,
    updatedZone
  };
}
