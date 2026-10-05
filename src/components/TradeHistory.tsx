import React, { useState, useEffect } from 'react';
import { 
  History, 
  TrendingUp, 
  TrendingDown, 
  AlertCircle, 
  Clock, 
  ExternalLink,
  ChevronRight,
  Target,
  ShieldAlert,
  ArrowRight
} from 'lucide-react';
import { supabase } from '../supabaseClient';

interface Trade {
  id: string;
  pair: string;
  entry_price: number;
  exit_price: number;
  realized_r: number;
  outcome: string;
  closed_at: string;
  direction: string;
  notes?: string;
}

interface TradeHistoryProps {
  userId: string;
}

export const TradeHistory: React.FC<TradeHistoryProps> = ({ userId }) => {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTradeHistory = async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('trade_learning')
        .select('id, pair, entry_price, exit_price, stop_loss, take_profit, realized_r, rr_achieved, outcome, created_at, notes')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (fetchError) throw fetchError;

      const mappedTrades: Trade[] = (data || []).map((row: any) => {
        let dir = 'BUY';
        if (row.take_profit && row.entry_price) {
          dir = row.take_profit > row.entry_price ? 'BUY' : 'SELL';
        } else if (row.stop_loss && row.entry_price) {
          dir = row.stop_loss < row.entry_price ? 'BUY' : 'SELL';
        } else if (row.outcome === 'WIN') {
          dir = row.exit_price > row.entry_price ? 'BUY' : 'SELL';
        } else {
          dir = row.exit_price < row.entry_price ? 'BUY' : 'SELL';
        }

        return {
          id: row.id,
          pair: row.pair,
          entry_price: Number(row.entry_price) || 0,
          exit_price: Number(row.exit_price) || 0,
          realized_r: Number(row.realized_r ?? row.rr_achieved) || 0,
          outcome: row.outcome || 'BREAKEVEN',
          closed_at: row.created_at,
          direction: dir,
          notes: row.notes
        };
      });

      setTrades(mappedTrades);
    } catch (err: any) {
      console.error('Error fetching trade history:', err);
      setError(err.message || 'Failed to load trade history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTradeHistory();
  }, [userId]);

  const getOutcomeBadge = (trade: Trade) => {
    const outcome = trade.outcome?.toUpperCase();
    const notes = trade.notes?.toLowerCase() || '';
    
    let label = outcome;
    if (notes.includes('tp')) label = 'TP';
    else if (notes.includes('sl')) label = 'SL';
    else if (notes.includes('manual')) label = 'Manual';

    const colors: Record<string, string> = {
      'WIN': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
      'LOSS': 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
      'BREAKEVEN': 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20',
      'TP': 'bg-emerald-500 text-white border-transparent',
      'SL': 'bg-rose-500 text-white border-transparent',
      'MANUAL': 'bg-amber-500 text-white border-transparent'
    };

    const finalLabel = ['TP', 'SL', 'Manual'].includes(label) ? label : outcome;

    return (
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${colors[finalLabel] || colors[outcome] || colors['BREAKEVEN']}`}>
        {finalLabel}
      </span>
    );
  };

  if (loading && trades.length === 0) {
    return (
      <div className="p-8 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e]/60 space-y-4 animate-pulse">
        <div className="h-6 bg-zinc-200 dark:bg-zinc-800 rounded w-1/4"></div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-zinc-200 dark:bg-zinc-800 rounded-2xl"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-2xl bg-indigo-500/10 flex items-center justify-center">
            <History className="w-4 h-4 text-indigo-500" />
          </div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-900 dark:text-white">Trade History</h3>
        </div>
        <button 
          onClick={fetchTradeHistory}
          className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          Refresh
        </button>
      </div>

      {trades.length === 0 ? (
        <div className="p-8 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 text-center space-y-2">
          <Clock className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto" />
          <p className="text-xs text-zinc-500">No resolved trades found in your history.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e]/60">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-400 font-bold uppercase tracking-widest text-[10px]">
                  <th className="px-4 py-3">Asset</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Entry</th>
                  <th className="px-4 py-3 text-right">Exit</th>
                  <th className="px-4 py-3 text-center">PnL (R)</th>
                  <th className="px-4 py-3 text-center">Outcome</th>
                  <th className="px-4 py-3 text-right">Closed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {trades.map((trade) => (
                  <tr key={trade.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors group">
                    <td className="px-4 py-3.5">
                      <div className="flex flex-col">
                        <span className="font-bold text-zinc-950 dark:text-white">{trade.pair}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`font-bold ${trade.direction === 'BUY' ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {trade.direction}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-zinc-600 dark:text-zinc-400">
                      {trade.entry_price.toFixed(5)}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-zinc-600 dark:text-zinc-400">
                      {trade.exit_price.toFixed(5)}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span className={`font-bold tabular-nums ${trade.realized_r >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {trade.realized_r >= 0 ? '+' : ''}{trade.realized_r.toFixed(2)}R
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      {getOutcomeBadge(trade)}
                    </td>
                    <td className="px-4 py-3.5 text-right text-zinc-500 text-[10px]">
                      {new Date(trade.closed_at).toLocaleDateString()}
                      <br />
                      {new Date(trade.closed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      <p className="text-[10px] text-zinc-400 dark:text-zinc-600 text-center italic">
        Displaying latest 20 resolved trades. Performance stats are synced with the Learning Engine.
      </p>
    </div>
  );
};

export default TradeHistory;
