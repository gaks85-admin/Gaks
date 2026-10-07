/**
 * GAKS AI — Backtesting Utilities
 * Provides functions for candle aggregation, time manipulation, and other common tasks.
 */

import { ParsedCandle } from './backtest-csv.js';

/**
 * Aggregates M1 (or smaller) candles into a higher timeframe (e.g., M5, H1).
 * @param candles Original candles (must be chronologically sorted)
 * @param timeframeMinutes Target timeframe in minutes
 */
export function aggregateCandles(candles: ParsedCandle[], timeframeMinutes: number): ParsedCandle[] {
  if (timeframeMinutes <= 1) return candles;
  if (!candles || candles.length === 0) return [];

  const aggregated: ParsedCandle[] = [];
  let currentGroup: ParsedCandle[] = [];
  
  // To ensure deterministic aggregation (e.g., 00:00-00:04, 00:05-00:09),
  // we group based on floor(timestamp_minutes / timeframeMinutes).
  
  let currentGroupStartTime: number | null = null;

  for (const candle of candles) {
    const timestamp = new Date(candle.timestamp).getTime();
    const timeframeMs = timeframeMinutes * 60 * 1000;
    
    // Calculate the start of the timeframe bucket
    const bucketStart = Math.floor(timestamp / timeframeMs) * timeframeMs;

    if (currentGroupStartTime === null) {
      currentGroupStartTime = bucketStart;
      currentGroup.push(candle);
    } else if (bucketStart === currentGroupStartTime) {
      currentGroup.push(candle);
    } else {
      // Finalize previous group
      aggregated.push(finalizeGroup(currentGroup, currentGroupStartTime));
      
      // Start new group
      currentGroup = [candle];
      currentGroupStartTime = bucketStart;
    }
  }

  // Finalize last group
  if (currentGroup.length > 0 && currentGroupStartTime !== null) {
    aggregated.push(finalizeGroup(currentGroup, currentGroupStartTime));
  }

  return aggregated;
}

function finalizeGroup(group: ParsedCandle[], bucketStart: number): ParsedCandle {
  const open = group[0].open;
  const close = group[group.length - 1].close;
  const high = Math.max(...group.map(c => c.high));
  const low = Math.min(...group.map(c => c.low));
  const volume = group.reduce((acc, c) => acc + (c.volume || 0), 0);
  
  return {
    timestamp: new Date(bucketStart).toISOString(),
    open,
    high,
    low,
    close,
    volume: volume || null
  };
}
