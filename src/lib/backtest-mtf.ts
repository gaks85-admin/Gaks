/**
 * GAKS AI — Multi-Timeframe Alignment Engine (Stage D5)
 * Ensures deterministic, lookahead-bias-free alignment between parent and child timeframes.
 * Supports explicit OPEN and CLOSE timestamp conventions.
 */

import { ParsedCandle } from './backtest-csv.js';
import { timeframeToMinutes } from './timeframe.js';

export type TimestampConvention = 'OPEN' | 'CLOSE';

export interface MTFContext {
  parentTimeframe: string;
  childTimeframe: string;
  parentCandles: ParsedCandle[];
  timestampConvention?: TimestampConvention;
}

/**
 * Returns parent candles that are FULLY CLOSED as of `childTimestamp`.
 * Prevents lookahead bias by ensuring only completed parent candles are accessible.
 *
 * @param childTimestamp Current decision timestamp (OPEN time of child candle by standard)
 * @param parentCandles Historical parent candles sorted ascending
 * @param parentTimeframe Parent timeframe (e.g. 'H1', 'H4')
 * @param convention 'OPEN' (standard) or 'CLOSE'
 */
export function getClosedParentCandles(
  childTimestamp: string,
  parentCandles: ParsedCandle[],
  parentTimeframe: string,
  convention: TimestampConvention = 'OPEN'
): ParsedCandle[] {
  if (!parentCandles || parentCandles.length === 0) return [];

  const childTs = new Date(childTimestamp).getTime();
  const parentMins = timeframeToMinutes(parentTimeframe);
  const parentMs = parentMins * 60 * 1000;

  return parentCandles.filter(p => {
    const pTs = new Date(p.timestamp).getTime();

    if (convention === 'OPEN') {
      // OPEN convention: Candle starting at pTs closes at pTs + parentMs.
      // It is closed if pTs + parentMs <= childTs.
      return (pTs + parentMs) <= childTs;
    } else {
      // CLOSE convention: Candle timestamped pTs closed at pTs.
      // It is closed if pTs <= childTs.
      return pTs <= childTs;
    }
  });
}

/**
 * Maps a child candle timestamp to its enclosing parent candle.
 */
export function getParentForChild(
  childTimestamp: string,
  parentCandles: ParsedCandle[],
  parentTimeframe: string,
  convention: TimestampConvention = 'OPEN'
): ParsedCandle | null {
  if (!parentCandles || parentCandles.length === 0) return null;

  const childTs = new Date(childTimestamp).getTime();
  const parentMins = timeframeToMinutes(parentTimeframe);
  const parentMs = parentMins * 60 * 1000;

  return parentCandles.find(p => {
    const pTs = new Date(p.timestamp).getTime();

    if (convention === 'OPEN') {
      // Child falls in [pTs, pTs + parentMs)
      return childTs >= pTs && childTs < (pTs + parentMs);
    } else {
      // Child falls in (pTs - parentMs, pTs]
      return childTs > (pTs - parentMs) && childTs <= pTs;
    }
  }) || null;
}

/**
 * Validates alignment integrity between child and parent timeframe datasets.
 */
export function validateMTFAlignment(
  childCandles: ParsedCandle[],
  parentCandles: ParsedCandle[],
  parentTimeframe: string,
  convention: TimestampConvention = 'OPEN'
): { success: boolean; errors: string[]; alignedCount: number } {
  const errors: string[] = [];
  const parentMins = timeframeToMinutes(parentTimeframe);
  const parentMs = parentMins * 60 * 1000;

  if (!childCandles || childCandles.length === 0 || !parentCandles || parentCandles.length === 0) {
    return { success: false, errors: ['Empty dataset(s) provided for MTF alignment check'], alignedCount: 0 };
  }

  const firstParentTs = new Date(parentCandles[0].timestamp).getTime();
  const lastParentTs = new Date(parentCandles[parentCandles.length - 1].timestamp).getTime();
  const lastParentEnd = convention === 'OPEN' ? lastParentTs + parentMs : lastParentTs;

  let alignedCount = 0;

  for (let i = 0; i < childCandles.length; i++) {
    const cTs = new Date(childCandles[i].timestamp).getTime();

    if (cTs >= firstParentTs && cTs < lastParentEnd) {
      const parent = getParentForChild(childCandles[i].timestamp, parentCandles, parentTimeframe, convention);
      if (!parent) {
        errors.push(`Child candle at ${childCandles[i].timestamp} has no enclosing parent candle in dataset`);
        if (errors.length >= 5) break; // Limit report size
      } else {
        alignedCount++;
      }
    }
  }

  return { success: errors.length === 0, errors, alignedCount };
}
