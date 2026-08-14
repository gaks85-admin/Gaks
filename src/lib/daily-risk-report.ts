import { SupabaseClient } from '@supabase/supabase-js';

export interface DailyRiskReport {
  timestamp: string;
  totalScans: number;
  totalCandidates: number;
  totalRejected: number;
  totalPaperTrades: number;
  winRate: number;
  lossRate: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdown: number;
  totalPnL: number;
  avgSlippage: number;
  avgLatency: number;
  reconciliationMismatches: number;
  rejectionsByGate: Record<string, number>;
}

export async function generateDailyRiskReport(supabase: SupabaseClient, userId: string): Promise<DailyRiskReport> {
  const today = new Date().setHours(0, 0, 0, 0);
  const todayIso = new Date(today).toISOString();

  // 1. Fetch Evaluations
  const { data: evals } = await supabase
    .from('watcher_evaluations')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', todayIso);

  // 2. Fetch Trades
  const { data: trades } = await supabase
    .from('trade_learning')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', todayIso);

  // 3. Fetch Alerts
  const { data: alerts } = await supabase
    .from('reconciliation_alerts')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', todayIso);

  const totalScans = evals?.length || 0;
  const paperTrades = trades?.filter(t => t.execution_source === 'PAPER') || [];
  const totalRejected = evals?.filter(e => !e.trade_sent).length || 0;
  
  const rejectionsByGate: Record<string, number> = {};
  evals?.forEach(e => {
    if (!e.trade_sent && e.trade_reason) {
      const gate = e.trade_reason.split(':')[0];
      rejectionsByGate[gate] = (rejectionsByGate[gate] || 0) + 1;
    }
  });

  const wins = paperTrades.filter(t => t.outcome === 'WIN').length;
  const losses = paperTrades.filter(t => t.outcome === 'LOSS').length;
  const winRate = paperTrades.length > 0 ? (wins / paperTrades.length) * 100 : 0;
  
  const totalProfit = paperTrades.reduce((acc, t) => acc + (t.actual_pnl > 0 ? t.actual_pnl : 0), 0);
  const totalLoss = Math.abs(paperTrades.reduce((acc, t) => acc + (t.actual_pnl < 0 ? t.actual_pnl : 0), 0));
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;

  const avgSlippage = paperTrades.length > 0 
    ? paperTrades.reduce((acc, t) => acc + (t.slippage_pips || 0), 0) / paperTrades.length 
    : 0;

  return {
    timestamp: new Date().toISOString(),
    totalScans,
    totalCandidates: totalScans, // In this system, every scan is a potential candidate
    totalRejected,
    totalPaperTrades: paperTrades.length,
    winRate,
    lossRate: paperTrades.length > 0 ? (losses / paperTrades.length) * 100 : 0,
    profitFactor,
    expectancy: paperTrades.length > 0 ? (totalProfit - totalLoss) / paperTrades.length : 0,
    maxDrawdown: 0, // Simplified for now
    totalPnL: totalProfit - totalLoss,
    avgSlippage,
    avgLatency: 0, // Simplified
    reconciliationMismatches: alerts?.length || 0,
    rejectionsByGate
  };
}
