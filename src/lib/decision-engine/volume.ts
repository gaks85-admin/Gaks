import { CompiledRules } from '../strategy-compiler/types.js';
import { EvaluationResult } from './types.js';

export class VolumeEvaluator {
  evaluate(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.volume_confirmation) {
      return { matched: false, score: 0, reason: "Volume Confirmation rule not active in strategy." };
    }

    const isFlatMatched = market.volume_confirmation === true || market.volume_spike === true;
    const isNestedMatched = market.volumeInformation && 
      (market.volumeInformation.volumeSpike === true || market.volumeInformation.latestVolume > market.volumeInformation.averageVolume * 1.2);

    const matched = isFlatMatched || !!isNestedMatched;

    return {
      matched,
      score: matched ? 1 : 0,
      reason: matched
        ? "Volume spike or increased participation confirms market action."
        : "No significant volume increase or spike detected."
    };
  }
}
