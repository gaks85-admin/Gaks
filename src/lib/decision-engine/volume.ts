import { CompiledRules } from '../strategy-compiler/types.js';
import { EvaluationResult } from './types.js';

export class VolumeEvaluator {
  evaluate(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.volume_confirmation) {
      return { matched: false, score: 0, scoreOutOf10: 0, reason: "Volume Confirmation rule not active in strategy." };
    }

    const isFlatMatched = market.volume_confirmation === true || market.volume_spike === true || market.volume_confirmation?.matched === true;
    const volInfo = market.volumeInformation;
    const latestVol = volInfo?.latestVolume || market.latestVolume;
    const avgVol = volInfo?.averageVolume || market.averageVolume;

    let scoreOutOf10 = 0;
    let matched = false;
    let reason = "";

    if (isFlatMatched || (volInfo && volInfo.volumeSpike) || (latestVol && avgVol && latestVol >= avgVol * 1.2)) {
      scoreOutOf10 = 10;
      matched = true;
      reason = "Strong volume spike & high market participation confirmed (10/10).";
    } else if (latestVol && avgVol && latestVol >= avgVol * 1.0) {
      scoreOutOf10 = 8;
      matched = true;
      reason = "Volume above average confirming participation (8/10).";
    } else if (latestVol && avgVol && latestVol >= avgVol * 0.7) {
      scoreOutOf10 = 6;
      matched = true;
      reason = "Moderate volume level near average participation (6/10).";
    } else if (market.volume_confirmation === false) {
      scoreOutOf10 = 0;
      matched = false;
      reason = "Low market volume participation detected (0/10).";
    } else {
      scoreOutOf10 = 0;
      matched = false;
      reason = "No significant volume increase detected (0/10).";
    }

    return {
      matched,
      score: scoreOutOf10 / 10,
      scoreOutOf10,
      reason
    };
  }
}
