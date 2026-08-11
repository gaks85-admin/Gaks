export interface TradeGeometryInput {
  symbol: string;
  direction: 'BUY' | 'SELL' | string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  minRr?: number;
  explanation?: string;
  positionMode?: 'AUTO_RISK' | 'FIXED_LOT';
  lotSize?: number;
  maxAllowedRisk?: number;
  actualRisk?: number;
}

export interface TradeGeometryResult {
  valid: boolean;
  geometry: string;
  direction: string;
  riskDistance: number;
  rewardDistance: number;
  calculatedRr: number;
  directionConsistent: boolean;
  explanationConsistent: boolean;
  reason: string;
}

export function validateTradeGeometry(input: TradeGeometryInput): TradeGeometryResult {
  const dir = (input.direction || '').toUpperCase().trim();
  const symbol = input.symbol || 'UNKNOWN';
  const entry = Number(input.entryPrice);
  const sl = Number(input.stopLoss);
  const tp = Number(input.takeProfit);
  const minRr = input.minRr !== undefined ? input.minRr : 1.5;
  const explanation = (input.explanation || '').toLowerCase();

  let directionConsistent = true;
  if (dir !== 'BUY' && dir !== 'SELL') {
    return {
      valid: false,
      geometry: 'INVALID_DIRECTION',
      direction: dir || 'NONE',
      riskDistance: 0,
      rewardDistance: 0,
      calculatedRr: 0,
      directionConsistent: false,
      explanationConsistent: true,
      reason: `Invalid or missing trade direction ('${input.direction}'). Must be BUY or SELL.`
    };
  }

  if (isNaN(entry) || !Number.isFinite(entry) || entry <= 0 ||
      isNaN(sl) || !Number.isFinite(sl) || sl <= 0 ||
      isNaN(tp) || !Number.isFinite(tp) || tp <= 0) {
    return {
      valid: false,
      geometry: 'INVALID_PRICE_NUMBERS',
      direction: dir,
      riskDistance: 0,
      rewardDistance: 0,
      calculatedRr: 0,
      directionConsistent: true,
      explanationConsistent: true,
      reason: `Invalid price numbers: Entry=${input.entryPrice}, SL=${input.stopLoss}, TP=${input.takeProfit}. Must be positive finite numbers.`
    };
  }

  let riskDistance = 0;
  let rewardDistance = 0;
  let geometry = 'VALID';

  if (dir === 'BUY') {
    // BUY: SL < Entry < TP
    riskDistance = entry - sl;
    rewardDistance = tp - entry;

    if (sl >= entry && entry >= tp) {
      geometry = 'INVALID_BUY_GEOMETRY';
    } else if (sl >= entry) {
      geometry = 'INVALID_BUY_SL_ABOVE_ENTRY';
    } else if (entry >= tp) {
      geometry = 'INVALID_BUY_TP_BELOW_ENTRY';
    } else if (riskDistance <= 0) {
      geometry = 'INVALID_NEGATIVE_RISK';
    } else if (rewardDistance <= 0) {
      geometry = 'INVALID_NEGATIVE_REWARD';
    }
  } else {
    // SELL: TP < Entry < SL
    riskDistance = sl - entry;
    rewardDistance = entry - tp;

    if (tp >= entry && entry >= sl) {
      geometry = 'INVALID_SELL_GEOMETRY';
    } else if (sl <= entry) {
      geometry = 'INVALID_SELL_SL_BELOW_ENTRY';
    } else if (tp >= entry) {
      geometry = 'INVALID_SELL_TP_ABOVE_ENTRY';
    } else if (riskDistance <= 0) {
      geometry = 'INVALID_NEGATIVE_RISK';
    } else if (rewardDistance <= 0) {
      geometry = 'INVALID_NEGATIVE_REWARD';
    }
  }

  if (geometry !== 'VALID') {
    let reason = '';
    if (dir === 'BUY') {
      if (sl >= entry) reason = `BUY requires SL (${sl}) < Entry (${entry}). Got SL >= Entry.`;
      else if (entry >= tp) reason = `BUY requires Entry (${entry}) < TP (${tp}). Got Entry >= TP.`;
      else reason = `Invalid BUY geometry: SL=${sl}, Entry=${entry}, TP=${tp}.`;
    } else {
      if (sl <= entry) reason = `SELL requires SL (${sl}) > Entry (${entry}). Got SL <= Entry.`;
      else if (tp >= entry) reason = `SELL requires TP (${tp}) < Entry (${entry}). Got TP >= Entry.`;
      else reason = `Invalid SELL geometry: TP=${tp}, Entry=${entry}, SL=${sl}.`;
    }

    return {
      valid: false,
      geometry,
      direction: dir,
      riskDistance,
      rewardDistance,
      calculatedRr: riskDistance > 0 ? Number((rewardDistance / riskDistance).toFixed(4)) : 0,
      directionConsistent,
      explanationConsistent: true,
      reason
    };
  }

  const calculatedRr = riskDistance > 0 ? Number((rewardDistance / riskDistance).toFixed(4)) : 0;

  // Check explanation consistency against direction
  let explanationConsistent = true;
  if (explanation) {
    if (dir === 'SELL') {
      const bullishTerms = ['long position', 'bullish entry', 'buy setup', 'target higher levels', 'bullish', 'buying', 'target higher'];
      for (const term of bullishTerms) {
        if (explanation.includes(term)) {
          explanationConsistent = false;
          break;
        }
      }
    } else if (dir === 'BUY') {
      const bearishTerms = ['short position', 'bearish entry', 'sell setup', 'target lower levels', 'bearish', 'selling', 'target lower'];
      for (const term of bearishTerms) {
        if (explanation.includes(term)) {
          explanationConsistent = false;
          break;
        }
      }
    }
  }

  if (!explanationConsistent) {
    return {
      valid: false,
      geometry: 'EXPLANATION_CONTRADICTS_DIRECTION',
      direction: dir,
      riskDistance,
      rewardDistance,
      calculatedRr,
      directionConsistent,
      explanationConsistent: false,
      reason: `Explanation contradicts direction (${dir}): explanation contains bullish/bearish language inconsistent with trade direction.`
    };
  }

  if (calculatedRr < minRr - 0.01) {
    return {
      valid: false,
      geometry: 'RR_BELOW_MINIMUM',
      direction: dir,
      riskDistance,
      rewardDistance,
      calculatedRr,
      directionConsistent,
      explanationConsistent,
      reason: `Calculated R:R (${calculatedRr}) is below minimum required (${minRr}).`
    };
  }

  // Audit log output as required
  console.log(`[Final Trade Geometry]
Symbol: ${symbol}
Direction: ${dir}
Entry: ${entry}
SL: ${sl}
TP: ${tp}
Risk Distance: ${riskDistance.toFixed(5)}
Reward Distance: ${rewardDistance.toFixed(5)}
Calculated R:R: ${calculatedRr}
Geometry: ACCEPTABLE_GEOMETRY
Direction Consistent: YES
Explanation Consistent: ${explanationConsistent ? 'YES' : 'NO'}
Position Mode: ${input.positionMode || 'AUTO_RISK'}
Lot Size: ${input.lotSize !== undefined ? input.lotSize : 'N/A'}
Actual Risk: ${input.actualRisk !== undefined ? input.actualRisk : 'N/A'}
Max Allowed Risk: ${input.maxAllowedRisk !== undefined ? input.maxAllowedRisk : 'N/A'}
Final Decision: ACCEPT`);

  return {
    valid: true,
    geometry: 'ACCEPTABLE_GEOMETRY',
    direction: dir,
    riskDistance,
    rewardDistance,
    calculatedRr,
    directionConsistent,
    explanationConsistent,
    reason: 'Valid geometry and consistent explanation.'
  };
}
