import { getSupabase } from '../../lib/supabase-server.js';
const defaultSupabase = getSupabase();


export interface TradeLearningRecord {
  id?: string;
  trade_id?: string | null;
  created_at?: string;
  user_id: string;
  watcher_id: string;
  evaluation_id?: string | null;
  pair: string;
  timeframe: string;
  strategy_mode: string;
  entry_price: number;
  stop_loss?: number | null;
  take_profit?: number | null;
  exit_price: number;
  outcome?: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'BROKER_REALIZED_WIN' | 'BROKER_REALIZED_LOSS' | 'BROKER_REALIZED_BREAKEVEN';
  rr_expected?: number | null;
  rr_achieved?: number | null;
  pips?: number | null;
  trade_duration_minutes?: number | null;
  decision_score?: number | null;
  matched_weight?: number | null;
  possible_weight?: number | null;
  matched_rules?: string[] | any;
  failed_rules?: string[] | any;
  gemini_used?: boolean;
  gemini_confidence?: number | null;
  market_snapshot?: any;
  session?: string | null;
  volatility?: string | null;
  notes?: string | null;
  decision_snapshot?: any;
  
  // Broker Fields
  execution_mode?: 'THEORETICAL' | 'PAPER' | 'LIVE';
  actual_entry_price?: number | null;
  requested_entry_price?: number | null;
  entry_slippage_pips?: number | null;
  gross_pnl?: number | null;
  net_pnl?: number | null;
  fees?: number | null;
  commission?: number | null;
  swap?: number | null;
  slippage_pips?: number | null;
  realized_r?: number | null;
  broker_order_id?: string | null;
  outcome_source?: 'THEORETICAL' | 'BROKER_RECONCILIATION' | 'MANUAL';
}

// In-memory cache for stats calculations
interface CacheEntry {
  data: any;
  timestamp: number;
}
const statsCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30000; // 30 seconds caching

function getFromCache(key: string): any | null {
  const entry = statsCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data;
  }
  return null;
}

function setToCache(key: string, data: any) {
  statsCache.set(key, { data, timestamp: Date.now() });
}

export function clearStatsCache() {
  statsCache.clear();
}

/**
 * Calculates and inserts a completed trade into the trade_learning database.
 * Returns the inserted record or null.
 */
export async function recordCompletedTrade(
  supabase: any,
  params: {
    user_id: string;
    watcher_id: string;
    trade_id?: string | null;
    evaluation_id?: string | null;
    pair: string;
    timeframe: string;
    strategy_mode: string;
    entry_price: number;
    stop_loss?: number | null;
    take_profit?: number | null;
    exit_price: number;
    direction: string; // 'BUY', 'SELL', etc.
    opened_at: string | Date;
    closed_at: string | Date;
    outcome?: 'WIN' | 'LOSS' | 'BREAKEVEN' | string;
    decision_score?: number | null;
    matched_weight?: number | null;
    possible_weight?: number | null;
    matched_rules?: string[];
    failed_rules?: string[];
    gemini_used?: boolean;
    gemini_confidence?: number | null;
    market_snapshot?: any;
    session?: string | null;
    volatility?: string | null;
    notes?: string | null;
    decision_snapshot?: any;
    
    // Broker Fields
    execution_mode?: 'THEORETICAL' | 'PAPER' | 'LIVE';
    actual_entry_price?: number | null;
    requested_entry_price?: number | null;
    entry_slippage_pips?: number | null;
    gross_pnl?: number | null;
    net_pnl?: number | null;
    fees?: number | null;
    commission?: number | null;
    swap?: number | null;
    slippage_pips?: number | null;
    realized_r?: number | null;
    broker_order_id?: string | null;
    outcome_source?: 'THEORETICAL' | 'BROKER_RECONCILIATION' | 'MANUAL';
  }
): Promise<TradeLearningRecord | null> {
  const client = supabase || defaultSupabase;
  const start = Date.now();

  try {
    // 1. Strict user_id validation
    if (!params.user_id || typeof params.user_id !== 'string' || !params.user_id.trim()) {
      console.error('[Learning Engine] user_id is required to record completed trade. Aborting.');
      return null;
    }

    // 2. Strict idempotency check using trade_id
    if (params.trade_id && client && typeof client.from === 'function') {
      try {
        const { data: existingTrade } = await client
          .from('trade_learning')
          .select('*')
          .eq('trade_id', params.trade_id)
          .maybeSingle();

        if (existingTrade) {
          console.log(`[Learning Engine] Trade ${params.trade_id} already recorded in trade_learning. Idempotent return.`);
          return existingTrade;
        }
      } catch (e: any) {
        console.warn(`[Learning Engine] Idempotency check error for trade_id ${params.trade_id}:`, e.message);
      }
    }

    // If outcome is genuinely undefined or null, fail safely without recording or crashing
    if (params.outcome === undefined || params.outcome === null || String(params.outcome).trim() === '') {
      console.warn(`[Learning Engine] Genuinely unavailable, empty or undefined outcome for trade ${params.trade_id || 'unknown'}. Aborting recording to learning dataset.`);
      return null;
    }

    const dir = (params.direction || '').toUpperCase().trim();
    const isBuy = dir === 'BUY' || dir === 'LONG';
    const cleanSym = (params.pair || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const isJpyOrGold = cleanSym.includes('JPY') || cleanSym.includes('XAU') || cleanSym.includes('GOLD');
    const pipSize = isJpyOrGold ? 0.01 : 0.0001;

    // Calculate PIPs
    const diff = params.exit_price - params.entry_price;
    const pips = isBuy ? diff / pipSize : -diff / pipSize;

    // Calculate Outcome
    let outcome: any = 'BREAKEVEN';
    if (params.outcome) {
      const sanitized = String(params.outcome).toUpperCase().trim();
      const terminalOutcomes = ['WIN', 'LOSS', 'BREAKEVEN', 'BROKER_REALIZED_WIN', 'BROKER_REALIZED_LOSS', 'BROKER_REALIZED_BREAKEVEN'];
      if (terminalOutcomes.includes(sanitized)) {
        outcome = sanitized;
      } else {
        if (Math.abs(pips) < 1.0) {
          outcome = 'BREAKEVEN';
        } else if (pips > 0) {
          outcome = 'WIN';
        } else {
          outcome = 'LOSS';
        }
      }
    }

    // Calculate expected & achieved RR
    const sl = params.stop_loss ? Number(params.stop_loss) : null;
    const tp = params.take_profit ? Number(params.take_profit) : null;
    const risk = sl ? Math.abs(params.entry_price - sl) : 0;
    const expectedReward = tp ? Math.abs(tp - params.entry_price) : 0;
    const achievedReward = isBuy ? (params.exit_price - params.entry_price) : (params.entry_price - params.exit_price);

    const rr_expected = risk > 0 ? Number((expectedReward / risk).toFixed(2)) : null;
    const rr_achieved = risk > 0 ? Number((achievedReward / risk).toFixed(2)) : null;

    // Calculate duration
    const trade_duration_minutes = Math.round(
      (new Date(params.closed_at).getTime() - new Date(params.opened_at).getTime()) / (1000 * 60)
    );

    // Session derivation fallback
    let session = params.session;
    if (!session) {
      const hour = new Date(params.opened_at).getUTCHours();
      if (hour >= 8 && hour < 13) session = 'London';
      else if (hour >= 13 && hour < 17) session = 'London / NY';
      else if (hour >= 17 && hour < 21) session = 'NY';
      else session = 'Asia';
    }

    const payload: TradeLearningRecord = {
      user_id: params.user_id,
      watcher_id: params.watcher_id,
      trade_id: params.trade_id || null,
      evaluation_id: params.evaluation_id || null,
      pair: params.pair,
      timeframe: params.timeframe,
      strategy_mode: params.strategy_mode || 'HYBRID',
      entry_price: params.entry_price,
      stop_loss: sl,
      take_profit: tp,
      exit_price: params.exit_price,
      outcome,
      rr_expected,
      rr_achieved,
      pips: Number(pips.toFixed(1)),
      trade_duration_minutes,
      decision_score: params.decision_score || null,
      matched_weight: params.matched_weight || null,
      possible_weight: params.possible_weight || null,
      matched_rules: params.matched_rules || [],
      failed_rules: params.failed_rules || [],
      gemini_used: params.gemini_used || false,
      gemini_confidence: params.gemini_confidence || null,
      market_snapshot: params.market_snapshot || {},
      session,
      volatility: params.volatility || 'MEDIUM',
      notes: params.notes || `Auto-recorded by Learning Engine. Outcome: ${outcome}`,
      decision_snapshot: params.decision_snapshot || {},
      
      // Broker Fields
      execution_mode: params.execution_mode || 'THEORETICAL',
      actual_entry_price: params.actual_entry_price || null,
      requested_entry_price: params.requested_entry_price || null,
      entry_slippage_pips: params.entry_slippage_pips || null,
      gross_pnl: params.gross_pnl || null,
      net_pnl: params.net_pnl || null,
      fees: params.fees || null,
      commission: params.commission || null,
      swap: params.swap || null,
      slippage_pips: params.slippage_pips || null,
      realized_r: params.realized_r || null,
      broker_order_id: params.broker_order_id || null,
      outcome_source: params.outcome_source || 'THEORETICAL'
    };

    console.log(`[Learning Engine] Recording completed trade: Pair ${payload.pair}, Outcome: ${payload.outcome}, Pips: ${payload.pips}`);

    // Insert into database
    const { data, error } = await client
      .from('trade_learning')
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error('[Learning Engine] DB Insert Error:', error.message);
      throw error;
    }

    // Clear stats cache so new trades are immediately integrated
    clearStatsCache();

    console.log(`[Learning Engine] Trade successfully recorded in ${Date.now() - start}ms`);
    return data;
  } catch (err: any) {
    console.error('[Learning Engine] Failed to record completed trade:', err.message);
    return null;
  }
}

/**
 * Fetches all trade learning records for a specific user.
 */
async function fetchAllUserTrades(supabase: any, userId: string): Promise<TradeLearningRecord[]> {
  const client = supabase || defaultSupabase;
  if (!userId) return [];

  const { data, error } = await client
    .from('trade_learning')
    .select('*')
    .eq('user_id', userId)
    .in('outcome', ['WIN', 'LOSS', 'BREAKEVEN']);

  if (error) {
    console.error('[Learning Engine] Fetch trades error:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Calculates learning statistics for each rule.
 */
export async function calculateRuleStatistics(supabase: any, userId: string): Promise<any[]> {
  const cacheKey = `rules_stats_${userId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const trades = await fetchAllUserTrades(supabase, userId);
  if (trades.length === 0) return [];

  const ruleMap = new Map<string, {
    wins: number;
    total: number;
    rrSum: number;
    durationSum: number;
    scoreSum: number;
  }>();

  trades.forEach(t => {
    const rulesList = Array.isArray(t.matched_rules) ? t.matched_rules : [];
    const isWin = t.outcome === 'WIN';
    const rr = t.rr_achieved || 0;
    const duration = t.trade_duration_minutes || 0;
    const score = t.decision_score || 0;

    rulesList.forEach((ruleName: string) => {
      const current = ruleMap.get(ruleName) || { wins: 0, total: 0, rrSum: 0, durationSum: 0, scoreSum: 0 };
      current.total += 1;
      if (isWin) current.wins += 1;
      current.rrSum += rr;
      current.durationSum += duration;
      current.scoreSum += score;
      ruleMap.set(ruleName, current);
    });
  });

  const stats = Array.from(ruleMap.entries()).map(([ruleName, data]) => {
    return {
      rule: ruleName,
      trades: data.total,
      winRate: Number(((data.wins / data.total) * 100).toFixed(2)),
      averageRR: Number((data.rrSum / data.total).toFixed(2)),
      averageDuration: Math.round(data.durationSum / data.total),
      averageDecisionScore: Number((data.scoreSum / data.total).toFixed(1))
    };
  });

  // Sort by win rate descending
  stats.sort((a, b) => b.winRate - a.winRate);
  setToCache(cacheKey, stats);
  return stats;
}

/**
 * Calculates statistics grouped by trading pair.
 */
export async function calculatePairStatistics(supabase: any, userId: string): Promise<any[]> {
  const cacheKey = `pair_stats_${userId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const trades = await fetchAllUserTrades(supabase, userId);
  if (trades.length === 0) return [];

  const pairMap = new Map<string, {
    wins: number;
    total: number;
    rrSum: number;
    pipsSum: number;
    durationSum: number;
  }>();

  trades.forEach(t => {
    const isWin = t.outcome === 'WIN';
    const rr = t.rr_achieved || 0;
    const pips = t.pips || 0;
    const duration = t.trade_duration_minutes || 0;

    const current = pairMap.get(t.pair) || { wins: 0, total: 0, rrSum: 0, pipsSum: 0, durationSum: 0 };
    current.total += 1;
    if (isWin) current.wins += 1;
    current.rrSum += rr;
    current.pipsSum += pips;
    current.durationSum += duration;
    pairMap.set(t.pair, current);
  });

  const stats = Array.from(pairMap.entries()).map(([pair, data]) => {
    return {
      pair,
      trades: data.total,
      winRate: Number(((data.wins / data.total) * 100).toFixed(2)),
      averageRR: Number((data.rrSum / data.total).toFixed(2)),
      totalPips: Number(data.pipsSum.toFixed(1)),
      averageDuration: Math.round(data.durationSum / data.total)
    };
  });

  stats.sort((a, b) => b.winRate - a.winRate);
  setToCache(cacheKey, stats);
  return stats;
}

/**
 * Calculates statistics grouped by timeframe.
 */
export async function calculateTimeframeStatistics(supabase: any, userId: string): Promise<any[]> {
  const cacheKey = `tf_stats_${userId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const trades = await fetchAllUserTrades(supabase, userId);
  if (trades.length === 0) return [];

  const tfMap = new Map<string, {
    wins: number;
    total: number;
    rrSum: number;
    pipsSum: number;
  }>();

  trades.forEach(t => {
    const isWin = t.outcome === 'WIN';
    const rr = t.rr_achieved || 0;
    const pips = t.pips || 0;

    const current = tfMap.get(t.timeframe) || { wins: 0, total: 0, rrSum: 0, pipsSum: 0 };
    current.total += 1;
    if (isWin) current.wins += 1;
    current.rrSum += rr;
    current.pipsSum += pips;
    tfMap.set(t.timeframe, current);
  });

  const stats = Array.from(tfMap.entries()).map(([timeframe, data]) => {
    return {
      timeframe,
      trades: data.total,
      winRate: Number(((data.wins / data.total) * 100).toFixed(2)),
      averageRR: Number((data.rrSum / data.total).toFixed(2)),
      totalPips: Number(data.pipsSum.toFixed(1))
    };
  });

  stats.sort((a, b) => b.winRate - a.winRate);
  setToCache(cacheKey, stats);
  return stats;
}

/**
 * Calculates statistics grouped by trading session.
 */
export async function calculateSessionStatistics(supabase: any, userId: string): Promise<any[]> {
  const cacheKey = `session_stats_${userId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const trades = await fetchAllUserTrades(supabase, userId);
  if (trades.length === 0) return [];

  const sessionMap = new Map<string, {
    wins: number;
    total: number;
    rrSum: number;
    pipsSum: number;
  }>();

  trades.forEach(t => {
    const isWin = t.outcome === 'WIN';
    const rr = t.rr_achieved || 0;
    const pips = t.pips || 0;
    const s = t.session || 'Unknown';

    const current = sessionMap.get(s) || { wins: 0, total: 0, rrSum: 0, pipsSum: 0 };
    current.total += 1;
    if (isWin) current.wins += 1;
    current.rrSum += rr;
    current.pipsSum += pips;
    sessionMap.set(s, current);
  });

  const stats = Array.from(sessionMap.entries()).map(([session, data]) => {
    return {
      session,
      trades: data.total,
      winRate: Number(((data.wins / data.total) * 100).toFixed(2)),
      averageRR: Number((data.rrSum / data.total).toFixed(2)),
      totalPips: Number(data.pipsSum.toFixed(1))
    };
  });

  stats.sort((a, b) => b.winRate - a.winRate);
  setToCache(cacheKey, stats);
  return stats;
}

import { calculateHistoricalProbability as calculateNewProb } from './rule-learning-engine.js';

export interface HistoricalProbabilityResult {
  historical_probability: number;
  sample_size: number;
  confidence_level: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT_DATA';
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  win_rate?: number;
  average_rr?: number;
}

/**
 * Queries database to compute the historical success rate of setups with similar
 * parameters: same pair, timeframe, strategy mode, and similar matched rules combination.
 */
export async function calculateHistoricalProbability(
  supabase: any,
  userId: string,
  pair: string,
  timeframe: string,
  matchedRules: string[],
  strategyMode: string
): Promise<HistoricalProbabilityResult> {
  const result = await calculateNewProb(supabase, userId, pair, timeframe, strategyMode, matchedRules);
  return {
    historical_probability: result.historical_probability,
    sample_size: result.sample_size,
    confidence_level: result.sample_size === 0 ? 'INSUFFICIENT_DATA' : result.confidence as any,
    confidence: result.confidence,
    win_rate: result.win_rate,
    average_rr: result.average_rr
  };
}
