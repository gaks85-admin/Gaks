/**
 * GAKS AI — Backtest Persistence & History Service (Phase 7)
 * Manages atomic persistence, retrieval, listing, and deletion of completed backtest runs,
 * configuration snapshots, trade records, and analytics snapshots with filesystem fallback.
 */

import fs from 'fs';
import path from 'path';
import { getSupabase } from '../../lib/supabase-server.js';
import { BacktestEngineResult, BacktestTradeRecord, BacktestAnalyticsResult } from './backtest-types.js';

export interface BacktestRunRecord {
  id: string;
  createdBy: string;
  datasetId: string;
  symbol: string;
  timeframe: string;
  strategySnapshot: any;
  simulationConfig: any;
  startingBalance: number;
  endingBalance: number;
  netProfit: number;
  returnPercent: number;
  status: 'processing' | 'completed' | 'failed';
  analyticsSnapshot: BacktestAnalyticsResult;
  errorMessage?: string;
  createdAt: string;
  completedAt: string;
  trades?: BacktestTradeRecord[];
}

const FALLBACK_DIR = path.join(process.cwd(), '.data', 'backtest');

function ensureFallbackDir() {
  if (!fs.existsSync(FALLBACK_DIR)) {
    fs.mkdirSync(FALLBACK_DIR, { recursive: true });
  }
}

function getFallbackRunsFile(): string {
  ensureFallbackDir();
  return path.join(FALLBACK_DIR, 'runs.json');
}

function readFallbackRuns(): BacktestRunRecord[] {
  try {
    const file = getFallbackRunsFile();
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

function saveFallbackRuns(runs: BacktestRunRecord[]) {
  try {
    ensureFallbackDir();
    fs.writeFileSync(getFallbackRunsFile(), JSON.stringify(runs, null, 2), 'utf8');
  } catch (err) {
    console.error('[Backtest Persistence Fallback] Error saving runs:', err);
  }
}

/**
 * Persists a completed backtest engine result atomically.
 */
export async function saveBacktestRun(params: {
  userId: string;
  engineResult: BacktestEngineResult;
  strategySnapshot: any;
  simulationConfig: any;
}): Promise<{ success: boolean; runId?: string; error?: string }> {
  const { userId, engineResult, strategySnapshot, simulationConfig } = params;
  if (!engineResult || !engineResult.analytics) {
    return { success: false, error: 'Invalid or missing engine result / analytics' };
  }

  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  const analytics = engineResult.analytics;

  const runRecord: BacktestRunRecord = {
    id: runId,
    createdBy: userId,
    datasetId: engineResult.datasetId,
    symbol: engineResult.symbol,
    timeframe: engineResult.timeframe,
    strategySnapshot: strategySnapshot || {},
    simulationConfig: simulationConfig || {},
    startingBalance: engineResult.initialBalance,
    endingBalance: engineResult.finalBalance,
    netProfit: engineResult.totalNetPnL,
    returnPercent: analytics.returnPercent,
    status: 'completed',
    analyticsSnapshot: analytics,
    createdAt: now,
    completedAt: now,
    trades: engineResult.trades || []
  };

  const supabase = getSupabase();

  try {
    // 1. Insert into backtest_runs
    const { error: runErr } = await supabase.from('backtest_runs').insert({
      id: runId,
      created_by: userId,
      dataset_id: engineResult.datasetId,
      symbol: engineResult.symbol,
      timeframe: engineResult.timeframe,
      strategy_snapshot: strategySnapshot || {},
      simulation_config: simulationConfig || {},
      starting_balance: engineResult.initialBalance,
      ending_balance: engineResult.finalBalance,
      net_profit: engineResult.totalNetPnL,
      return_percent: analytics.returnPercent,
      status: 'completed',
      analytics_snapshot: analytics,
      created_at: now,
      completed_at: now
    });

    if (runErr) {
      console.warn('[Backtest Persistence] Supabase backtest_runs insert error (using fallback):', runErr.message);
      throw runErr;
    }

    // 2. Insert trades into backtest_trades if any
    if (engineResult.trades && engineResult.trades.length > 0) {
      const tradeRows = engineResult.trades.map(t => ({
        id: t.id || crypto.randomUUID(),
        backtest_run_id: runId,
        signal_id: t.signalId,
        symbol: t.symbol,
        timeframe: t.timeframe,
        direction: t.direction,
        entry_timestamp: t.entryTimestamp,
        exit_timestamp: t.exitTimestamp,
        entry_price: t.entryPrice,
        exit_price: t.exitPrice,
        stop_loss: t.stopLoss,
        take_profit: t.takeProfit,
        lot_size: t.lotSize,
        risk_amount: t.riskAmount,
        risk_reward_ratio: t.riskRewardRatio,
        gross_pnl: t.grossPnL,
        spread_cost: t.spreadCost,
        slippage_cost: t.slippageCost,
        commission_cost: t.commissionCost,
        net_pnl: t.netPnL,
        balance_before: t.balanceBefore,
        balance_after: t.balanceAfter,
        exit_reason: t.exitReason,
        created_at: now
      }));

      const { error: tradeErr } = await supabase.from('backtest_trades').insert(tradeRows);
      if (tradeErr) {
        console.warn('[Backtest Persistence] Supabase backtest_trades insert error:', tradeErr.message);
        // Clean up run if trades fail to maintain atomicity
        await supabase.from('backtest_runs').delete().eq('id', runId);
        throw tradeErr;
      }
    }

    return { success: true, runId };
  } catch {
    // Fallback to local JSON storage
    const runs = readFallbackRuns();
    runs.unshift(runRecord);
    saveFallbackRuns(runs);
    return { success: true, runId };
  }
}

/**
 * Retrieves a historical backtest run by ID with its trades and analytics.
 */
export async function getBacktestRun(runId: string): Promise<BacktestRunRecord | null> {
  if (!runId) return null;
  const supabase = getSupabase();

  try {
    const { data: runData, error: runErr } = await supabase
      .from('backtest_runs')
      .select('*')
      .eq('id', runId)
      .maybeSingle();

    if (runErr || !runData) {
      throw new Error(runErr?.message || 'Run not found in database');
    }

    const { data: tradesData } = await supabase
      .from('backtest_trades')
      .select('*')
      .eq('backtest_run_id', runId)
      .order('entry_timestamp', { ascending: true });

    const trades: BacktestTradeRecord[] = (tradesData || []).map((t: any) => ({
      id: t.id,
      signalId: t.signal_id,
      symbol: t.symbol,
      timeframe: t.timeframe,
      direction: t.direction,
      entryTimestamp: t.entry_timestamp,
      exitTimestamp: t.exit_timestamp,
      entryPrice: Number(t.entry_price),
      exitPrice: Number(t.exit_price),
      stopLoss: Number(t.stop_loss),
      takeProfit: Number(t.take_profit),
      lotSize: Number(t.lot_size),
      riskAmount: Number(t.risk_amount),
      riskRewardRatio: Number(t.risk_reward_ratio),
      grossPnL: Number(t.gross_pnl),
      spreadCost: Number(t.spread_cost),
      slippageCost: Number(t.slippage_cost),
      commissionCost: Number(t.commission_cost),
      netPnL: Number(t.net_pnl),
      balanceBefore: Number(t.balance_before),
      balanceAfter: Number(t.balance_after),
      exitReason: t.exit_reason
    }));

    return {
      id: runData.id,
      createdBy: runData.created_by,
      datasetId: runData.dataset_id,
      symbol: runData.symbol,
      timeframe: runData.timeframe,
      strategySnapshot: runData.strategy_snapshot,
      simulationConfig: runData.simulation_config,
      startingBalance: Number(runData.starting_balance),
      endingBalance: Number(runData.ending_balance),
      netProfit: Number(runData.net_profit),
      returnPercent: Number(runData.return_percent),
      status: runData.status,
      analyticsSnapshot: runData.analytics_snapshot,
      errorMessage: runData.error_message,
      createdAt: runData.created_at,
      completedAt: runData.completed_at,
      trades
    };
  } catch {
    // Fallback search
    const runs = readFallbackRuns();
    const found = runs.find(r => r.id === runId);
    return found || null;
  }
}

/**
 * Lists historical backtest runs.
 */
export async function listBacktestRuns(): Promise<BacktestRunRecord[]> {
  const supabase = getSupabase();
  const fallback = readFallbackRuns().map(r => ({
    ...r,
    trades: []
  }));

  try {
    const { data, error } = await supabase
      .from('backtest_runs')
      .select('id, created_by, dataset_id, symbol, timeframe, starting_balance, ending_balance, net_profit, return_percent, status, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      return fallback;
    }

    const dbRuns = (data || []).map((r: any) => ({
      id: r.id,
      createdBy: r.created_by,
      datasetId: r.dataset_id,
      symbol: r.symbol,
      timeframe: r.timeframe,
      strategySnapshot: {},
      simulationConfig: {},
      startingBalance: Number(r.starting_balance),
      endingBalance: Number(r.ending_balance),
      netProfit: Number(r.net_profit),
      returnPercent: Number(r.return_percent),
      status: r.status,
      analyticsSnapshot: {} as any,
      createdAt: r.created_at,
      completedAt: r.created_at
    }));

    const map = new Map<string, BacktestRunRecord>();
    for (const r of fallback) map.set(r.id, r);
    for (const r of dbRuns) map.set(r.id, r);
    return Array.from(map.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return fallback;
  }
}

/**
 * Deletes a historical backtest run (and its associated trades). Preserves datasets.
 */
export async function deleteBacktestRun(runId: string): Promise<{ success: boolean; error?: string }> {
  if (!runId) return { success: false, error: 'Run ID is required' };
  const supabase = getSupabase();

  // Always remove from fallback store
  const runs = readFallbackRuns();
  const filtered = runs.filter(r => r.id !== runId);
  saveFallbackRuns(filtered);

  try {
    const { error } = await supabase
      .from('backtest_runs')
      .delete()
      .eq('id', runId);

    if (error && error.code !== 'PGRST205' && !error.message?.includes('does not exist')) {
      console.warn('[Backtest Persistence] Supabase delete notice:', error.message);
    }
    return { success: true };
  } catch {
    return { success: true };
  }
}
