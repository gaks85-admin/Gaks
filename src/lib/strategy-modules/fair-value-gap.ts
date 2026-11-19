import { Candle } from '../strategy-engine.js';
import { ConceptExecutionContext, ConceptLogicModule, ConceptModuleResult } from './types.js';

export interface DetectedFvg {
  type: 'BULLISH_FVG' | 'BEARISH_FVG';
  top: number;
  bottom: number;
  candleIndex: number;
  isFilled: boolean;
  filledPercentage: number;
}

/**
 * Detects 3-candle Fair Value Gaps (imbalances) and measures subsequent fill percentage.
 */
export function detectFairValueGaps(sortedCandles: Candle[]): DetectedFvg[] {
  const fvgList: DetectedFvg[] = [];
  if (!sortedCandles || sortedCandles.length < 3) return fvgList;

  for (let i = 2; i < sortedCandles.length; i++) {
    let fvg: DetectedFvg | null = null;
    if (sortedCandles[i].low > sortedCandles[i - 2].high) {
      fvg = {
        type: 'BULLISH_FVG',
        top: sortedCandles[i].low,
        bottom: sortedCandles[i - 2].high,
        candleIndex: i,
        isFilled: false,
        filledPercentage: 0
      };
    } else if (sortedCandles[i].high < sortedCandles[i - 2].low) {
      fvg = {
        type: 'BEARISH_FVG',
        top: sortedCandles[i - 2].low,
        bottom: sortedCandles[i].high,
        candleIndex: i,
        isFilled: false,
        filledPercentage: 0
      };
    }

    if (fvg) {
      const gapSize = Math.max(0.000001, fvg.top - fvg.bottom);
      for (let j = i + 1; j < sortedCandles.length; j++) {
        if (fvg.type === 'BULLISH_FVG') {
          const penetration = Math.max(0, fvg.top - sortedCandles[j].low);
          fvg.filledPercentage = Math.max(fvg.filledPercentage, Math.min(1, penetration / gapSize));
          if (sortedCandles[j].low <= fvg.bottom) fvg.isFilled = true;
        } else {
          const penetration = Math.max(0, sortedCandles[j].high - fvg.bottom);
          fvg.filledPercentage = Math.max(fvg.filledPercentage, Math.min(1, penetration / gapSize));
          if (sortedCandles[j].high >= fvg.top) fvg.isFilled = true;
        }
        if (fvg.isFilled) break;
      }
      fvgList.push(fvg);
    }
  }

  return fvgList;
}

export const FairValueGapModule: ConceptLogicModule = {
  id: 'fair_value_gap',
  name: 'Fair Value Gap',
  category: 'ZONE',
  aliases: ['fair_value_gap', 'fvg'],
  requiresSwings: false,
  requiresAtr: false,
  execute: (ctx: ConceptExecutionContext): ConceptModuleResult => {
    const fvgs = detectFairValueGaps(ctx.sortedCandles);
    const unfilled = fvgs.filter(f => !f.isFilled);
    const recentUnfilled = unfilled.filter(f => f.candleIndex >= Math.max(0, ctx.sortedCandles.length - 45));
    const latest = recentUnfilled[recentUnfilled.length - 1] || unfilled[unfilled.length - 1] || fvgs[fvgs.length - 1];

    const matched = fvgs.length > 0;
    const scoreOutOf10 = recentUnfilled.length > 0 ? 10 : unfilled.length > 0 ? 8 : matched ? 6 : 0;

    return {
      moduleId: 'fair_value_gap',
      moduleName: 'Fair Value Gap',
      category: 'ZONE',
      activated: true,
      executed: true,
      matched,
      scoreOutOf10,
      direction: latest ? (latest.type === 'BULLISH_FVG' ? 'BULLISH' : 'BEARISH') : 'NEUTRAL',
      reason: latest
        ? `Detected ${unfilled.length} unfilled FVG(s) (${fvgs.length} total); latest ${latest.type} [${latest.bottom} - ${latest.top}].`
        : 'No Fair Value Gap (3-candle imbalance) detected in candle window.',
      evidence: recentUnfilled.slice(-3).map(
        f => `${f.type} [${f.bottom} - ${f.top}] (${Math.round(f.filledPercentage * 100)}% filled)`
      ),
      metrics: {
        totalFvgs: fvgs.length,
        unfilledFvgs: unfilled.length,
        recentUnfilledFvgs: recentUnfilled.length
      },
      structurePatch: {
        fairValueGaps: fvgs,
        fair_value_gap: matched,
        fvg: matched
      }
    };
  }
};
