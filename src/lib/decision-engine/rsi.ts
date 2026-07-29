import { CompiledRules } from '../strategy-compiler/types';
import { EvaluationResult } from './types';

export class RsiEvaluator {
  evaluate(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.rsi || !rules.rsi.enabled) {
      return { matched: false, score: 0, reason: "RSI rule not active in strategy." };
    }

    const overboughtThreshold = rules.rsi.overbought ?? 70;
    const oversoldThreshold = rules.rsi.oversold ?? 30;

    let matched = false;
    let detail = "";

    // If market has numeric rsi
    if (typeof market.rsi === 'number') {
      const val = market.rsi;
      if (val >= overboughtThreshold) {
        matched = true;
        detail = `RSI is ${val} (Overbought >= ${overboughtThreshold}).`;
      } else if (val <= oversoldThreshold) {
        matched = true;
        detail = `RSI is ${val} (Oversold <= ${oversoldThreshold}).`;
      } else {
        detail = `RSI is ${val} (Neutral between ${oversoldThreshold} and ${overboughtThreshold}).`;
      }
    } else if (typeof market.rsi === 'boolean') {
      matched = market.rsi;
      detail = matched ? "RSI criteria matched (boolean trigger)." : "RSI criteria failed (boolean trigger).";
    } else if (typeof market.rsi === 'string') {
      const clean = market.rsi.toLowerCase();
      if (clean.includes('oversold') || clean.includes('overbought')) {
        matched = true;
        detail = `RSI is in ${market.rsi} zone.`;
      } else {
        detail = `RSI is ${market.rsi}.`;
      }
    } else if (market.rsi_oversold === true || market.rsi_overbought === true) {
      matched = true;
      detail = `RSI is overbought/oversold.`;
    } else {
      detail = "No RSI information found in market structure.";
    }

    return {
      matched,
      score: matched ? 1 : 0,
      reason: matched ? `RSI matched: ${detail}` : `RSI failed: ${detail}`
    };
  }
}
