import { Candle } from './strategy-engine.js';

export interface SwingLevel {
  index: number;
  price: number;
  timestamp: string | number;
  isBroken: boolean;
  brokenByIndex?: number;
}

export interface FVG {
  type: 'BULLISH_FVG' | 'BEARISH_FVG';
  top: number;
  bottom: number;
  candleIndex: number;
  isFilled: boolean;
  filledPercentage: number; // 0 to 1
}

export interface MarketStructure {
  watcherId?: string;
  pair?: string;
  timeframe?: string;
  trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  swingHighs: SwingLevel[];
  swingLows: SwingLevel[];
  supportZones: { priceMin: number; priceMax: number; strength: number }[];
  resistanceZones: { priceMin: number; priceMax: number; strength: number }[];
  fairValueGaps: FVG[];
  BOS: { 
    type: 'BULLISH_BOS' | 'BEARISH_BOS' | 'NONE'; 
    price: number; 
    candleIndex: number;
    evidence: string;
    levelIndex: number;
  }[];
  CHOCH: { 
    type: 'BULLISH_CHOCH' | 'BEARISH_CHOCH' | 'NONE'; 
    price: number; 
    candleIndex: number;
    evidence: string;
  }[];
  liquiditySweeps: { 
    type: 'HIGH_SWEEP' | 'LOW_SWEEP' | 'NONE'; 
    price: number; 
    candleIndex: number;
    levelPrice: number;
    rejectionEvidence: string;
  }[];
  candlePatterns: { pattern: string; candleIndex: number; direction: 'BULLISH' | 'BEARISH' }[];
  volumeInformation: { averageVolume: number; latestVolume: number; volumeSpike: boolean };
  volatilityInformation: { atr: number; volatilityLevel: 'HIGH' | 'NORMAL' | 'LOW' };
  latestCandles: Candle[];
}

/**
 * Pure market structure extraction engine.
 * Reads candles and extracts factual observations only.
 */
export function extractMarketStructure(candles: Candle[], supportedDetectors?: string[]): MarketStructure {
  if (!candles || candles.length < 5) {
    return {
      trend: 'SIDEWAYS',
      swingHighs: [],
      swingLows: [],
      supportZones: [],
      resistanceZones: [],
      fairValueGaps: [],
      BOS: [],
      CHOCH: [],
      liquiditySweeps: [],
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

  const shouldRun = (id: string) => !supportedDetectors || supportedDetectors.includes(id.toLowerCase());

  // 1. Swing Detection (Fractal)
  const swingHighs: SwingLevel[] = [];
  const swingLows: SwingLevel[] = [];

  for (let i = 2; i < sortedCandles.length - 2; i++) {
    const h = highs[i];
    const l = lows[i];
    if (h >= highs[i - 1] && h >= highs[i - 2] && h >= highs[i + 1] && h >= highs[i + 2]) {
      swingHighs.push({ index: i, price: h, timestamp: sortedCandles[i].timestamp, isBroken: false });
    }
    if (l <= lows[i - 1] && l <= lows[i - 2] && l <= lows[i + 1] && l <= lows[i + 2]) {
      swingLows.push({ index: i, price: l, timestamp: sortedCandles[i].timestamp, isBroken: false });
    }
  }

  // 2. Deterministic BOS Detection
  const bosList: MarketStructure['BOS'] = [];
  if (shouldRun('bos')) {
    // Bullish BOS: Candle close > protected swing high
    swingHighs.forEach((sh, shIdx) => {
      for (let j = sh.index + 1; j < sortedCandles.length; j++) {
        if (closes[j] > sh.price) {
          sh.isBroken = true;
          sh.brokenByIndex = j;
          bosList.push({
            type: 'BULLISH_BOS',
            price: sh.price,
            candleIndex: j,
            evidence: `Candle at index ${j} (close: ${closes[j]}) closed above swing high at index ${sh.index} (price: ${sh.price})`,
            levelIndex: shIdx
          });
          break; // Level consumed
        }
      }
    });

    // Bearish BOS: Candle close < protected swing low
    swingLows.forEach((sl, slIdx) => {
      for (let j = sl.index + 1; j < sortedCandles.length; j++) {
        if (closes[j] < sl.price) {
          sl.isBroken = true;
          sl.brokenByIndex = j;
          bosList.push({
            type: 'BEARISH_BOS',
            price: sl.price,
            candleIndex: j,
            evidence: `Candle at index ${j} (close: ${closes[j]}) closed below swing low at index ${sl.index} (price: ${sl.price})`,
            levelIndex: slIdx
          });
          break; // Level consumed
        }
      }
    });
  }

  // 3. CHOCH Detection
  const chochList: MarketStructure['CHOCH'] = [];
  let currentTrend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' = 'SIDEWAYS';
  
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const lastH = swingHighs[swingHighs.length - 1].price;
    const prevH = swingHighs[swingHighs.length - 2].price;
    const lastL = swingLows[swingLows.length - 1].price;
    const prevL = swingLows[swingLows.length - 2].price;

    if (lastH > prevH && lastL > prevL) currentTrend = 'BULLISH';
    else if (lastH < prevH && lastL < prevL) currentTrend = 'BEARISH';
  }

  if (shouldRun('choch') && currentTrend !== 'SIDEWAYS') {
    if (currentTrend === 'BULLISH') {
      const protectedLow = swingLows[swingLows.length - 1];
      for (let j = protectedLow.index + 1; j < sortedCandles.length; j++) {
        if (closes[j] < protectedLow.price) {
          chochList.push({
            type: 'BEARISH_CHOCH',
            price: protectedLow.price,
            candleIndex: j,
            evidence: `Bullish trend protected low at index ${protectedLow.index} (price: ${protectedLow.price}) broken by close at index ${j} (price: ${closes[j]})`
          });
          break;
        }
      }
    } else {
      const protectedHigh = swingHighs[swingHighs.length - 1];
      for (let j = protectedHigh.index + 1; j < sortedCandles.length; j++) {
        if (closes[j] > protectedHigh.price) {
          chochList.push({
            type: 'BULLISH_CHOCH',
            price: protectedHigh.price,
            candleIndex: j,
            evidence: `Bearish trend protected high at index ${protectedHigh.index} (price: ${protectedHigh.price}) broken by close at index ${j} (price: ${closes[j]})`
          });
          break;
        }
      }
    }
  }

  // 4. FVG Detection & Filling State
  const fvgList: FVG[] = [];
  if (shouldRun('fvg')) {
    for (let i = 2; i < sortedCandles.length; i++) {
      let fvg: FVG | null = null;
      if (lows[i] > highs[i - 2]) {
        fvg = { type: 'BULLISH_FVG', top: lows[i], bottom: highs[i - 2], candleIndex: i, isFilled: false, filledPercentage: 0 };
      } else if (highs[i] < lows[i - 2]) {
        fvg = { type: 'BEARISH_FVG', top: lows[i - 2], bottom: highs[i], candleIndex: i, isFilled: false, filledPercentage: 0 };
      }

      if (fvg) {
        const gapSize = fvg.top - fvg.bottom;
        for (let j = i + 1; j < sortedCandles.length; j++) {
          if (fvg.type === 'BULLISH_FVG') {
            const penetration = Math.max(0, fvg.top - lows[j]);
            fvg.filledPercentage = Math.max(fvg.filledPercentage, Math.min(1, penetration / gapSize));
            if (lows[j] <= fvg.bottom) fvg.isFilled = true;
          } else {
            const penetration = Math.max(0, highs[j] - fvg.bottom);
            fvg.filledPercentage = Math.max(fvg.filledPercentage, Math.min(1, penetration / gapSize));
            if (highs[j] >= fvg.top) fvg.isFilled = true;
          }
          if (fvg.isFilled) break;
        }
        fvgList.push(fvg);
      }
    }
  }

  // 5. Liquidity Sweep Detection
  const sweepList: MarketStructure['liquiditySweeps'] = [];
  if (shouldRun('liquidity_sweep')) {
    const historicalLevels = [...swingHighs, ...swingLows].filter(s => s.index < sortedCandles.length - 10);
    for (let i = sortedCandles.length - 5; i < sortedCandles.length; i++) {
      for (const level of historicalLevels) {
        const isHigh = swingHighs.includes(level);
        if (isHigh) {
          if (highs[i] > level.price && closes[i] < level.price) {
            sweepList.push({
              type: 'HIGH_SWEEP',
              price: highs[i],
              candleIndex: i,
              levelPrice: level.price,
              rejectionEvidence: `Price wicked to ${highs[i]} above level ${level.price} but closed at ${closes[i]}`
            });
          }
        } else {
          if (lows[i] < level.price && closes[i] > level.price) {
            sweepList.push({
              type: 'LOW_SWEEP',
              price: lows[i],
              candleIndex: i,
              levelPrice: level.price,
              rejectionEvidence: `Price wicked to ${lows[i]} below level ${level.price} but closed at ${closes[i]}`
            });
          }
        }
      }
    }
  }

  // 6. Volatility & Volume
  let totalTrueRange = 0;
  for (let i = 1; i < sortedCandles.length; i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    totalTrueRange += tr;
  }
  const atr = sortedCandles.length > 1 ? totalTrueRange / (sortedCandles.length - 1) : (highs[0] - lows[0]);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / (volumes.length || 1);
  const latestVol = volumes[volumes.length - 1] || 0;

  return {
    trend: currentTrend,
    swingHighs,
    swingLows,
    supportZones: [],
    resistanceZones: [],
    fairValueGaps: fvgList,
    BOS: bosList,
    CHOCH: chochList,
    liquiditySweeps: sweepList,
    candlePatterns: [], // To be implemented with detailed logic if requested
    volumeInformation: { averageVolume: avgVolume, latestVolume: latestVol, volumeSpike: latestVol > avgVolume * 1.5 },
    volatilityInformation: { atr, volatilityLevel: atr > (closes[closes.length - 1] * 0.02) ? 'HIGH' : 'NORMAL' },
    latestCandles: sortedCandles.slice(-20)
  };
}

