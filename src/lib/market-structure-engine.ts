import { Candle } from './strategy-engine.js';

export interface MarketStructure {
  trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  swingHighs: { index: number; price: number; timestamp: any }[];
  swingLows: { index: number; price: number; timestamp: any }[];
  supportZones: { priceMin: number; priceMax: number; strength: number }[];
  resistanceZones: { priceMin: number; priceMax: number; strength: number }[];
  trendlines: { type: 'UPPER' | 'LOWER'; slope: number; startPrice: number; endPrice: number }[];
  breakouts: { type: 'UPPER_BREAKOUT' | 'LOWER_BREAKOUT' | 'NONE'; candleIndex: number; price: number }[];
  retests: { confirmed: boolean; level: number; candleIndex: number }[];
  liquiditySweeps: { type: 'HIGH_SWEEP' | 'LOW_SWEEP' | 'NONE'; price: number; candleIndex: number }[];
  fairValueGaps: { type: 'BULLISH_FVG' | 'BEARISH_FVG'; top: number; bottom: number; candleIndex: number }[];
  BOS: { type: 'BULLISH_BOS' | 'BEARISH_BOS' | 'NONE'; price: number; candleIndex: number }[];
  CHOCH: { type: 'BULLISH_CHOCH' | 'BEARISH_CHOCH' | 'NONE'; price: number; candleIndex: number }[];
  candlePatterns: { pattern: string; candleIndex: number; direction: 'BULLISH' | 'BEARISH' }[];
  volumeInformation: { averageVolume: number; latestVolume: number; volumeSpike: boolean };
  volatilityInformation: { atr: number; volatilityLevel: 'HIGH' | 'NORMAL' | 'LOW' };
  latestCandles: Candle[];
}

/**
 * Pure market structure extraction engine.
 * Reads candles and extracts factual observations only.
 * NEVER decides BUY or SELL. NEVER reads preferences, risk, or RR.
 */
export function extractMarketStructure(candles: Candle[]): MarketStructure {
  if (!candles || candles.length === 0) {
    return {
      trend: 'SIDEWAYS',
      swingHighs: [],
      swingLows: [],
      supportZones: [],
      resistanceZones: [],
      trendlines: [],
      breakouts: [],
      retests: [],
      liquiditySweeps: [],
      fairValueGaps: [],
      BOS: [],
      CHOCH: [],
      candlePatterns: [],
      volumeInformation: { averageVolume: 0, latestVolume: 0, volumeSpike: false },
      volatilityInformation: { atr: 0, volatilityLevel: 'NORMAL' },
      latestCandles: []
    };
  }

  const sortedCandles = [...candles].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const closes = sortedCandles.map(c => c.close);
  const highs = sortedCandles.map(c => c.high);
  const lows = sortedCandles.map(c => c.low);
  const volumes = sortedCandles.map(c => c.volume || 0);

  // 1. Swing Highs & Lows (5-candle fractal method)
  const swingHighs: { index: number; price: number; timestamp: any }[] = [];
  const swingLows: { index: number; price: number; timestamp: any }[] = [];

  for (let i = 2; i < sortedCandles.length - 2; i++) {
    const h = highs[i];
    const l = lows[i];
    if (h >= highs[i - 1] && h >= highs[i - 2] && h >= highs[i + 1] && h >= highs[i + 2]) {
      swingHighs.push({ index: i, price: h, timestamp: sortedCandles[i].timestamp });
    }
    if (l <= lows[i - 1] && l <= lows[i - 2] && l <= lows[i + 1] && l <= lows[i + 2]) {
      swingLows.push({ index: i, price: l, timestamp: sortedCandles[i].timestamp });
    }
  }

  // 2. Trend determination
  let trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' = 'SIDEWAYS';
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const lastHigh = swingHighs[swingHighs.length - 1].price;
    const prevHigh = swingHighs[swingHighs.length - 2].price;
    const lastLow = swingLows[swingLows.length - 1].price;
    const prevLow = swingLows[swingLows.length - 2].price;

    if (lastHigh > prevHigh && lastLow > prevLow) {
      trend = 'BULLISH';
    } else if (lastHigh < prevHigh && lastLow < prevLow) {
      trend = 'BEARISH';
    }
  } else {
    // Fallback EMA check
    const recentClose = closes[closes.length - 1];
    const firstClose = closes[0];
    if (recentClose > firstClose * 1.01) trend = 'BULLISH';
    else if (recentClose < firstClose * 0.99) trend = 'BEARISH';
  }

  // 3. Support & Resistance Zones
  const supportZones: { priceMin: number; priceMax: number; strength: number }[] = [];
  const resistanceZones: { priceMin: number; priceMax: number; strength: number }[] = [];

  if (swingLows.length > 0) {
    const recentLow = swingLows[swingLows.length - 1].price;
    supportZones.push({ priceMin: recentLow * 0.995, priceMax: recentLow * 1.005, strength: swingLows.length });
  }
  if (swingHighs.length > 0) {
    const recentHigh = swingHighs[swingHighs.length - 1].price;
    resistanceZones.push({ priceMin: recentHigh * 0.995, priceMax: recentHigh * 1.005, strength: swingHighs.length });
  }

  // 4. Volatility (ATR approx) & Volume
  let totalTrueRange = 0;
  for (let i = 1; i < sortedCandles.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    totalTrueRange += tr;
  }
  const atr = sortedCandles.length > 1 ? totalTrueRange / (sortedCandles.length - 1) : (highs[0] - lows[0]);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / (volumes.length || 1);
  const latestVol = volumes[volumes.length - 1] || 0;

  // 5. Fair Value Gaps (FVG)
  const fairValueGaps: { type: 'BULLISH_FVG' | 'BEARISH_FVG'; top: number; bottom: number; candleIndex: number }[] = [];
  for (let i = 2; i < sortedCandles.length; i++) {
    // Bullish FVG: Low of candle[i] > High of candle[i-2]
    if (lows[i] > highs[i - 2]) {
      fairValueGaps.push({ type: 'BULLISH_FVG', top: lows[i], bottom: highs[i - 2], candleIndex: i });
    }
    // Bearish FVG: High of candle[i] < Low of candle[i-2]
    if (highs[i] < lows[i - 2]) {
      fairValueGaps.push({ type: 'BEARISH_FVG', top: lows[i - 2], bottom: highs[i], candleIndex: i });
    }
  }

  // 6. Break of Structure (BOS) & Change of Character (CHOCH)
  const BOS: { type: 'BULLISH_BOS' | 'BEARISH_BOS' | 'NONE'; price: number; candleIndex: number }[] = [];
  const CHOCH: { type: 'BULLISH_CHOCH' | 'BEARISH_CHOCH' | 'NONE'; price: number; candleIndex: number }[] = [];

  if (swingHighs.length >= 2) {
    const lastSh = swingHighs[swingHighs.length - 1];
    const prevSh = swingHighs[swingHighs.length - 2];
    if (lastSh.price > prevSh.price) {
      BOS.push({ type: 'BULLISH_BOS', price: prevSh.price, candleIndex: lastSh.index });
    } else {
      CHOCH.push({ type: 'BEARISH_CHOCH', price: prevSh.price, candleIndex: lastSh.index });
    }
  }

  if (swingLows.length >= 2) {
    const lastSl = swingLows[swingLows.length - 1];
    const prevSl = swingLows[swingLows.length - 2];
    if (lastSl.price < prevSl.price) {
      BOS.push({ type: 'BEARISH_BOS', price: prevSl.price, candleIndex: lastSl.index });
    } else {
      CHOCH.push({ type: 'BULLISH_CHOCH', price: prevSl.price, candleIndex: lastSl.index });
    }
  }

  // 7. Candle Patterns (Pin bar, Engulfing)
  const candlePatterns: { pattern: string; candleIndex: number; direction: 'BULLISH' | 'BEARISH' }[] = [];
  const lastIdx = sortedCandles.length - 1;
  const lastC = sortedCandles[lastIdx];
  const prevC = sortedCandles[lastIdx - 1] || lastC;

  const body = Math.abs(lastC.close - lastC.open);
  const totalRange = lastC.high - lastC.low;
  if (totalRange > 0) {
    const upperShadow = lastC.high - Math.max(lastC.open, lastC.close);
    const lowerShadow = Math.min(lastC.open, lastC.close) - lastC.low;

    if (lowerShadow > body * 2 && upperShadow < body * 0.5) {
      candlePatterns.push({ pattern: 'Pin Bar / Hammer', candleIndex: lastIdx, direction: 'BULLISH' });
    } else if (upperShadow > body * 2 && lowerShadow < body * 0.5) {
      candlePatterns.push({ pattern: 'Shooting Star', candleIndex: lastIdx, direction: 'BEARISH' });
    }
  }

  // Engulfing
  if (lastIdx > 0) {
    const prevBody = Math.abs(prevC.close - prevC.open);
    const currBody = Math.abs(lastC.close - lastC.open);
    if (lastC.close > lastC.open && prevC.close < prevC.open && currBody > prevBody) {
      candlePatterns.push({ pattern: 'Bullish Engulfing', candleIndex: lastIdx, direction: 'BULLISH' });
    } else if (lastC.close < lastC.open && prevC.close > prevC.open && currBody > prevBody) {
      candlePatterns.push({ pattern: 'Bearish Engulfing', candleIndex: lastIdx, direction: 'BEARISH' });
    }
  }

  return {
    trend,
    swingHighs,
    swingLows,
    supportZones,
    resistanceZones,
    trendlines: [],
    breakouts: [],
    retests: [],
    liquiditySweeps: [],
    fairValueGaps,
    BOS,
    CHOCH,
    candlePatterns,
    volumeInformation: { averageVolume: avgVolume, latestVolume: latestVol, volumeSpike: latestVol > avgVolume * 1.5 },
    volatilityInformation: { atr, volatilityLevel: atr > (closes[closes.length - 1] * 0.02) ? 'HIGH' : 'NORMAL' },
    latestCandles: sortedCandles.slice(-20)
  };
}
