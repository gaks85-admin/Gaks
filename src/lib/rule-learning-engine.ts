import { getSupabase } from '../../lib/supabase-server.js';
const defaultSupabase = getSupabase();

export interface HistoricalProbabilityResult {
  sample_size: number;
  win_rate: number;
  average_rr: number;
  average_decision_score: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  historical_probability: number;
}

/**
 * Calculates the Jaccard similarity index between two rule lists.
 */
export function calculateJaccardSimilarity(rules1: string[], rules2: string[]): number {
  const r1 = rules1 || [];
  const r2 = rules2 || [];
  if (r1.length === 0 && r2.length === 0) return 1.0;
  if (r1.length === 0 || r2.length === 0) return 0.0;
  
  const set1 = new Set(r1.map(r => r.toLowerCase().trim()));
  const set2 = new Set(r2.map(r => r.toLowerCase().trim()));
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}

/**
 * Searches completed trades to calculate historical probability of success based on similarity.
 * Supports polymorphic signatures:
 * 1. (supabase, userId, pair, timeframe, strategy_mode, matched_rules)
 * 2. (pair, timeframe, strategy_mode, matched_rules)
 */
export async function calculateHistoricalProbability(
  supabaseOrPair: any,
  userIdOrTimeframe: string,
  pairOrStrategyMode: string,
  timeframeOrMatchedRules: string | string[],
  strategyMode?: string,
  matchedRules?: string[]
): Promise<HistoricalProbabilityResult> {
  let client: any = defaultSupabase;
  let userId: string = '';
  let pair: string = '';
  let timeframe: string = '';
  let strategy_mode: string = 'HYBRID';
  let matched_rules: string[] = [];

  // Detect signature type
  if (supabaseOrPair && typeof supabaseOrPair === 'object' && typeof supabaseOrPair.from === 'function') {
    // Legacy / Admin signature: (supabase, userId, pair, timeframe, strategy_mode, matched_rules)
    client = supabaseOrPair;
    userId = userIdOrTimeframe;
    pair = pairOrStrategyMode;
    timeframe = timeframeOrMatchedRules as string;
    strategy_mode = strategyMode || 'HYBRID';
    matched_rules = matchedRules || [];
  } else {
    // Requested signature: (pair, timeframe, strategy_mode, matched_rules)
    pair = supabaseOrPair || '';
    timeframe = userIdOrTimeframe || '';
    strategy_mode = pairOrStrategyMode || 'HYBRID';
    matched_rules = (timeframeOrMatchedRules as string[]) || [];
    
    // Attempt to automatically derive userId if possible
    try {
      const { data: { user } } = await client.auth.getUser();
      if (user) {
        userId = user.id;
      }
    } catch {
      // Fallback
    }
  }

  const defaultResult: HistoricalProbabilityResult = {
    sample_size: 0,
    win_rate: 0,
    average_rr: 0,
    average_decision_score: 0,
    confidence: 'LOW',
    historical_probability: 0
  };

  try {
    let query = client
      .from('trade_learning')
      .select('*')
      .eq('pair', pair)
      .eq('timeframe', timeframe)
      .eq('strategy_mode', strategy_mode);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data: records, error } = await query;
    if (error || !records || records.length === 0) {
      return defaultResult;
    }

    // Filter by similar matched rules using Jaccard Similarity >= 0.5
    const currentRules = matched_rules || [];
    const similarTrades = records.filter((t: any) => {
      const histRules = Array.isArray(t.matched_rules) ? t.matched_rules : [];
      return calculateJaccardSimilarity(currentRules, histRules) >= 0.5;
    });

    const sample_size = similarTrades.length;
    if (sample_size === 0) {
      return defaultResult;
    }

    const wins = similarTrades.filter((t: any) => t.outcome === 'WIN').length;
    const win_rate = Number(((wins / sample_size) * 100).toFixed(2));

    // Calculate averages
    let rrSum = 0;
    let scoreSum = 0;
    similarTrades.forEach((t: any) => {
      rrSum += Number(t.rr_achieved || 0);
      scoreSum += Number(t.decision_score || 0);
    });

    const average_rr = Number((rrSum / sample_size).toFixed(2));
    const average_decision_score = Number((scoreSum / sample_size).toFixed(2));

    // Confidence mapping
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
    if (sample_size >= 100) {
      confidence = 'HIGH';
    } else if (sample_size >= 20) {
      confidence = 'MEDIUM';
    }

    return {
      sample_size,
      win_rate,
      average_rr,
      average_decision_score,
      confidence,
      historical_probability: win_rate
    };
  } catch (err: any) {
    console.error('[Rule Learning Engine] calculateHistoricalProbability error:', err.message);
    return defaultResult;
  }
}

/**
 * Computes advanced analytics for rule combinations, pairs, and timeframes.
 */
export async function calculateAdvancedLearningStats(supabase: any, userId: string) {
  const client = supabase || defaultSupabase;
  
  try {
    const { data: records, error } = await client
      .from('trade_learning')
      .select('*')
      .eq('user_id', userId);

    if (error || !records || records.length === 0) {
      return null;
    }

    // 1. Group by Rule Combination
    const comboMap = new Map<string, {
      wins: number;
      total: number;
      rrSum: number;
    }>();

    // 2. Group by Pair
    const pairMap = new Map<string, {
      wins: number;
      total: number;
    }>();

    // 3. Group by Timeframe
    const tfMap = new Map<string, {
      wins: number;
      total: number;
    }>();

    records.forEach((t: any) => {
      const isWin = t.outcome === 'WIN';
      const rr = Number(t.rr_achieved || 0);
      
      // Sort and join to represent rule combination
      const rules = Array.isArray(t.matched_rules) ? [...t.matched_rules].sort() : [];
      const comboKey = rules.length > 0 ? rules.join(' + ') : 'No Rules Matched';

      // Rule Combo stats
      const currentCombo = comboMap.get(comboKey) || { wins: 0, total: 0, rrSum: 0 };
      currentCombo.total += 1;
      if (isWin) currentCombo.wins += 1;
      currentCombo.rrSum += rr;
      comboMap.set(comboKey, currentCombo);

      // Pair stats
      const currentPair = pairMap.get(t.pair) || { wins: 0, total: 0 };
      currentPair.total += 1;
      if (isWin) currentPair.wins += 1;
      pairMap.set(t.pair, currentPair);

      // Timeframe stats
      const currentTf = tfMap.get(t.timeframe) || { wins: 0, total: 0 };
      currentTf.total += 1;
      if (isWin) currentTf.wins += 1;
      tfMap.set(t.timeframe, currentTf);
    });

    // Format Rule Combo stats
    const ruleCombos = Array.from(comboMap.entries()).map(([combo, data]) => {
      const winRate = Number(((data.wins / data.total) * 100).toFixed(1));
      const avgRR = Number((data.rrSum / data.total).toFixed(2));
      return {
        combination: combo,
        trades: data.total,
        winRate,
        averageRR: avgRR
      };
    });

    // Format Pair stats
    const pairs = Array.from(pairMap.entries()).map(([pair, data]) => {
      const winRate = Number(((data.wins / data.total) * 100).toFixed(1));
      return {
        pair,
        trades: data.total,
        winRate
      };
    });

    // Format Timeframe stats
    const timeframes = Array.from(tfMap.entries()).map(([timeframe, data]) => {
      const winRate = Number(((data.wins / data.total) * 100).toFixed(1));
      return {
        timeframe,
        trades: data.total,
        winRate
      };
    });

    // Sort to determine Best/Worst
    const sortedCombosByWinRate = [...ruleCombos].sort((a, b) => b.winRate - a.winRate || b.trades - a.trades);
    const sortedPairsByWinRate = [...pairs].sort((a, b) => b.winRate - a.winRate || b.trades - a.trades);
    const sortedTfsByWinRate = [...timeframes].sort((a, b) => b.winRate - a.winRate || b.trades - a.trades);

    return {
      bestCombinations: sortedCombosByWinRate.slice(0, 5),
      worstCombinations: [...sortedCombosByWinRate].reverse().slice(0, 5),
      bestPair: sortedPairsByWinRate[0] || null,
      worstPair: sortedPairsByWinRate[sortedPairsByWinRate.length - 1] || null,
      bestTimeframe: sortedTfsByWinRate[0] || null,
      worstTimeframe: sortedTfsByWinRate[sortedTfsByWinRate.length - 1] || null,
      ruleCombinations: sortedCombosByWinRate
    };
  } catch (err: any) {
    console.error('[Rule Learning Engine] calculateAdvancedLearningStats error:', err.message);
    return null;
  }
}
