import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { 
  Award, TrendingUp, TrendingDown, Percent, Clock, Zap, Cpu,
  Bookmark, Activity, HelpCircle, ArrowRight, RefreshCw, BarChart2, CheckCircle2, AlertTriangle
} from 'lucide-react';

interface TradeLearning {
  id: string;
  created_at: string;
  user_id: string;
  watcher_id: string;
  evaluation_id: string | null;
  pair: string;
  timeframe: string;
  strategy_mode: string;
  entry_price: number;
  stop_loss: number | null;
  take_profit: number | null;
  exit_price: number;
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN';
  rr_expected: number | null;
  rr_achieved: number | null;
  pips: number | null;
  trade_duration_minutes: number | null;
  decision_score: number | null;
  matched_weight: number | null;
  possible_weight: number | null;
  matched_rules: string[];
  failed_rules: string[];
  gemini_used: boolean;
  gemini_confidence: number | null;
  session: string | null;
  volatility: string | null;
  notes: string | null;
  decision_snapshot?: any;
}

export default function LearningAnalyticsPage({ fetchWithAuth }: { fetchWithAuth: any }) {
  const [trades, setTrades] = useState<TradeLearning[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'rules' | 'pairs' | 'history' | 'rule-learning'>('overview');
  
  // Replay modal state
  const [selectedEvaluation, setSelectedEvaluation] = useState<any | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);

  const fetchLearningData = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: dbErr } = await supabase
        .from('trade_learning')
        .select('*')
        .order('created_at', { ascending: false });

      if (dbErr) {
        throw dbErr;
      }
      setTrades(data || []);
    } catch (err: any) {
      console.error('[Learning Analytics] Fetch Error:', err.message);
      setError(err.message || 'Failed to load completed trade learnings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLearningData();
  }, []);

  const handleReplay = async (tradeOrId: any) => {
    // If we passed the full trade object and it has decision_snapshot, use it immediately
    if (tradeOrId && typeof tradeOrId === 'object' && tradeOrId.decision_snapshot && Object.keys(tradeOrId.decision_snapshot).length > 0) {
      const snap = tradeOrId.decision_snapshot;
      setSelectedEvaluation({
        id: tradeOrId.evaluation_id || tradeOrId.id,
        pair: tradeOrId.pair,
        timeframe: tradeOrId.timeframe,
        strategy_mode: snap.strategy_mode || tradeOrId.strategy_mode,
        decision_score: snap.decision_score ?? tradeOrId.decision_score,
        matched_weight: snap.matched_weight ?? tradeOrId.matched_weight,
        possible_weight: snap.possible_weight ?? tradeOrId.possible_weight,
        recommendation: snap.recommendation || 'PASS',
        matched_rules: snap.matched_rules || tradeOrId.matched_rules || [],
        failed_rules: snap.failed_rules || tradeOrId.failed_rules || [],
        gemini_used: tradeOrId.gemini_used,
        gemini_result: tradeOrId.notes,
        gemini_duration_ms: 0,
      });
      return;
    }

    const evaluationId = typeof tradeOrId === 'string' ? tradeOrId : tradeOrId?.evaluation_id;
    if (!evaluationId) {
      alert('Original evaluation record could not be found.');
      return;
    }

    setReplayLoading(true);
    setSelectedEvaluation(null);
    try {
      const { data, error: dbErr } = await supabase
        .from('watcher_evaluations')
        .select('*')
        .eq('id', evaluationId)
        .maybeSingle();

      if (dbErr) throw dbErr;
      if (!data) {
        alert('Original evaluation record could not be found in the database.');
      } else {
        setSelectedEvaluation(data);
      }
    } catch (err: any) {
      console.error('[Learning Replay] Error:', err.message);
      alert(`Failed to retrieve evaluation trace: ${err.message}`);
    } finally {
      setReplayLoading(false);
    }
  };

  // Compute Statistics
  const stats = React.useMemo(() => {
    if (trades.length === 0) return null;

    const total = trades.length;
    const wins = trades.filter(t => t.outcome === 'WIN').length;
    const losses = trades.filter(t => t.outcome === 'LOSS').length;
    const breakevens = trades.filter(t => t.outcome === 'BREAKEVEN').length;
    
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    
    let totalRR = 0;
    let rrCount = 0;
    let totalScore = 0;
    let totalDuration = 0;
    let totalPips = 0;

    trades.forEach(t => {
      if (t.rr_achieved !== null && t.rr_achieved !== undefined) {
        totalRR += Number(t.rr_achieved);
        rrCount++;
      }
      if (t.decision_score !== null) {
        totalScore += Number(t.decision_score);
      }
      if (t.trade_duration_minutes !== null) {
        totalDuration += Number(t.trade_duration_minutes);
      }
      if (t.pips !== null) {
        totalPips += Number(t.pips);
      }
    });

    const averageRR = rrCount > 0 ? totalRR / rrCount : 0;
    const averageScore = total > 0 ? totalScore / total : 0;
    const averageDuration = total > 0 ? totalDuration / total : 0;

    // Gemini Saved Calls (rule-only trades)
    const geminiSaved = trades.filter(t => !t.gemini_used).length;
    const estimatedCostSaved = geminiSaved * 0.015; // $0.015 per saved call

    // Rule Rankings
    const ruleMap = new Map<string, { wins: number; total: number; rrSum: number }>();
    trades.forEach(t => {
      const rules = Array.isArray(t.matched_rules) ? t.matched_rules : [];
      rules.forEach(r => {
        const cur = ruleMap.get(r) || { wins: 0, total: 0, rrSum: 0 };
        cur.total += 1;
        if (t.outcome === 'WIN') cur.wins += 1;
        cur.rrSum += (t.rr_achieved || 0);
        ruleMap.set(r, cur);
      });
    });

    const ruleStatsList = Array.from(ruleMap.entries()).map(([rule, data]) => ({
      rule,
      total: data.total,
      winRate: (data.wins / data.total) * 100,
      avgRR: data.rrSum / data.total
    }));

    const topWinningRules = [...ruleStatsList]
      .filter(r => r.total >= 1)
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 5);

    const topLosingRules = [...ruleStatsList]
      .filter(r => r.total >= 1)
      .sort((a, b) => a.winRate - b.winRate)
      .slice(0, 5);

    // Pair Statistics
    const pairMap = new Map<string, { wins: number; total: number; pips: number; rrSum: number }>();
    trades.forEach(t => {
      const cur = pairMap.get(t.pair) || { wins: 0, total: 0, pips: 0, rrSum: 0 };
      cur.total += 1;
      if (t.outcome === 'WIN') cur.wins += 1;
      cur.pips += (t.pips || 0);
      cur.rrSum += (t.rr_achieved || 0);
      pairMap.set(t.pair, cur);
    });

    const pairStatsList = Array.from(pairMap.entries()).map(([pair, data]) => ({
      pair,
      total: data.total,
      winRate: (data.wins / data.total) * 100,
      pips: data.pips,
      avgRR: data.rrSum / data.total
    })).sort((a, b) => b.pips - a.pips);

    // Timeframe Statistics
    const tfMap = new Map<string, { wins: number; total: number; pips: number }>();
    trades.forEach(t => {
      const cur = tfMap.get(t.timeframe) || { wins: 0, total: 0, pips: 0 };
      cur.total += 1;
      if (t.outcome === 'WIN') cur.wins += 1;
      cur.pips += (t.pips || 0);
      tfMap.set(t.timeframe, cur);
    });

    const tfStatsList = Array.from(tfMap.entries()).map(([timeframe, data]) => ({
      timeframe,
      total: data.total,
      winRate: (data.wins / data.total) * 100,
      pips: data.pips
    })).sort((a, b) => b.winRate - a.winRate);

    // Session Statistics
    const sessionMap = new Map<string, { wins: number; total: number; pips: number }>();
    trades.forEach(t => {
      const cur = sessionMap.get(t.session || 'Unknown') || { wins: 0, total: 0, pips: 0 };
      cur.total += 1;
      if (t.outcome === 'WIN') cur.wins += 1;
      cur.pips += (t.pips || 0);
      sessionMap.set(t.session || 'Unknown', cur);
    });

    const sessionStatsList = Array.from(sessionMap.entries()).map(([session, data]) => ({
      session,
      total: data.total,
      winRate: (data.wins / data.total) * 100,
      pips: data.pips
    })).sort((a, b) => b.winRate - a.winRate);

    // Strategy Mode Performance
    const modeMap = new Map<string, { wins: number; total: number; rrSum: number }>();
    trades.forEach(t => {
      const cur = modeMap.get(t.strategy_mode) || { wins: 0, total: 0, rrSum: 0 };
      cur.total += 1;
      if (t.outcome === 'WIN') cur.wins += 1;
      cur.rrSum += (t.rr_achieved || 0);
      modeMap.set(t.strategy_mode, cur);
    });

    const modeStatsList = Array.from(modeMap.entries()).map(([mode, data]) => ({
      mode,
      total: data.total,
      winRate: (data.wins / data.total) * 100,
      avgRR: data.rrSum / data.total
    }));

    // Advanced Rule Combination Performance
    const comboMap = new Map<string, { wins: number; total: number; rrSum: number }>();
    trades.forEach(t => {
      const rules = Array.isArray(t.matched_rules) ? [...t.matched_rules].sort() : [];
      const comboKey = rules.length > 0 ? rules.join(' + ') : 'No Rules Matched';
      const cur = comboMap.get(comboKey) || { wins: 0, total: 0, rrSum: 0 };
      cur.total += 1;
      if (t.outcome === 'WIN') cur.wins += 1;
      cur.rrSum += (t.rr_achieved || 0);
      comboMap.set(comboKey, cur);
    });

    const ruleCombosList = Array.from(comboMap.entries()).map(([combination, data]) => ({
      combination,
      total: data.total,
      winRate: (data.wins / data.total) * 100,
      avgRR: data.rrSum / data.total
    }));

    const bestRuleCombos = [...ruleCombosList]
      .filter(r => r.total >= 1)
      .sort((a, b) => b.winRate - a.winRate || b.total - a.total);

    const worstRuleCombos = [...ruleCombosList]
      .filter(r => r.total >= 1)
      .sort((a, b) => a.winRate - b.winRate || a.total - b.total);

    // Best / Worst Pairs by Win Rate
    const sortedPairsByWinRate = [...pairStatsList].sort((a, b) => b.winRate - a.winRate);
    const bestPair = sortedPairsByWinRate[0] || null;
    const worstPair = sortedPairsByWinRate.length > 1 ? sortedPairsByWinRate[sortedPairsByWinRate.length - 1] : sortedPairsByWinRate[0];

    // Best / Worst Timeframes by Win Rate
    const sortedTfsByWinRate = [...tfStatsList].sort((a, b) => b.winRate - a.winRate);
    const bestTimeframe = sortedTfsByWinRate[0] || null;
    const worstTimeframe = sortedTfsByWinRate.length > 1 ? sortedTfsByWinRate[sortedTfsByWinRate.length - 1] : sortedTfsByWinRate[0];

    return {
      total,
      wins,
      losses,
      breakevens,
      winRate,
      averageRR,
      averageScore,
      averageDuration,
      totalPips,
      geminiSaved,
      estimatedCostSaved,
      topWinningRules,
      topLosingRules,
      pairStatsList,
      tfStatsList,
      sessionStatsList,
      modeStatsList,
      ruleCombosList,
      bestRuleCombos,
      worstRuleCombos,
      bestPair,
      worstPair,
      bestTimeframe,
      worstTimeframe
    };
  }, [trades]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
        <RefreshCw className="w-8 h-8 animate-spin text-sky-500 mb-3" />
        <span className="text-xs font-semibold">Analyzing historical outcomes...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 m-6 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-3">
        <AlertTriangle className="w-5 h-5" />
        <span className="text-sm font-semibold">{error}</span>
      </div>
    );
  }

  if (trades.length === 0 || !stats) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-full mb-4">
          <Activity className="w-8 h-8 text-zinc-500" />
        </div>
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">No completed trades recorded</h3>
        <p className="text-xs text-zinc-500 max-w-sm mt-1.5 leading-relaxed">
          The Gaks AI Learning Engine will automatically ingest closed trade statistics once an active position is terminated by Take Profit (TP) or Stop Loss (SL).
        </p>
        <button onClick={fetchLearningData} className="mt-5 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-xs font-bold uppercase tracking-wider rounded-xl border border-zinc-800 transition-colors flex items-center gap-2 cursor-pointer">
          <RefreshCw className="w-3.5 h-3.5" /> Reload Data
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-zinc-900 pb-5 gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-white font-display">Gaks Learning Analytics</h2>
          <p className="text-xs text-zinc-500">Autonomous historical statistical engine updating offline probability thresholds</p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={fetchLearningData} 
            className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl hover:bg-zinc-800 text-zinc-300 transition-colors cursor-pointer"
            title="Refresh Learning Calculations"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex gap-1 border-b border-zinc-900/60 pb-px">
        {[
          { id: 'overview', label: 'Overview Metrics' },
          { id: 'rules', label: 'Rule Performance' },
          { id: 'pairs', label: 'Pair & Timeframe' },
          { id: 'rule-learning', label: 'Rule Learning Engine' },
          { id: 'history', label: 'Trade Audit Ledger' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer ${activeTab === tab.id ? 'border-sky-500 text-white font-extrabold' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview Tab Content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Key Metric Blocks */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 flex justify-between items-start shadow-xl">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Overall Win Rate</span>
                <p className="text-3xl font-extrabold text-white mt-1.5 font-display">{stats.winRate.toFixed(1)}%</p>
                <div className="flex items-center gap-1 mt-2">
                  <span className="text-[10px] text-zinc-400">Wins: <strong>{stats.wins}</strong></span>
                  <span className="text-[10px] text-zinc-600">•</span>
                  <span className="text-[10px] text-zinc-400">Losses: <strong>{stats.losses}</strong></span>
                </div>
              </div>
              <div className="p-2.5 bg-sky-500/10 text-sky-400 rounded-xl">
                <Percent className="w-4.5 h-4.5" />
              </div>
            </div>

            <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 flex justify-between items-start shadow-xl">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Average Risk:Reward</span>
                <p className="text-3xl font-extrabold text-white mt-1.5 font-display">1:{stats.averageRR.toFixed(2)}</p>
                <span className="text-[10px] text-zinc-400 block mt-2">Achieved RR ratio per trade</span>
              </div>
              <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl">
                <Award className="w-4.5 h-4.5" />
              </div>
            </div>

            <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 flex justify-between items-start shadow-xl">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Net Profit (PIPs)</span>
                <p className={`text-3xl font-extrabold mt-1.5 font-display ${stats.totalPips >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {stats.totalPips >= 0 ? '+' : ''}{stats.totalPips.toFixed(1)} pips
                </p>
                <span className="text-[10px] text-zinc-400 block mt-2">Aggregated pip movement</span>
              </div>
              <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl">
                <TrendingUp className="w-4.5 h-4.5" />
              </div>
            </div>

            <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 flex justify-between items-start shadow-xl">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Gemini Saved Calls</span>
                <p className="text-3xl font-extrabold text-white mt-1.5 font-display">{stats.geminiSaved}</p>
                <span className="text-[10px] text-zinc-400 block mt-2">Rule-only trades (Saved ~${stats.estimatedCostSaved.toFixed(2)})</span>
              </div>
              <div className="p-2.5 bg-purple-500/10 text-purple-400 rounded-xl">
                <Cpu className="w-4.5 h-4.5" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Hybrid vs AI performance */}
            <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 shadow-xl space-y-4">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-sky-400" /> Hybrid vs AI vs Rule-Only Modes
              </h3>
              <div className="space-y-3.5">
                {stats.modeStatsList.map((m, i) => (
                  <div key={i} className="flex justify-between items-center py-2.5 border-b border-zinc-900 last:border-0">
                    <div>
                      <span className="text-xs font-bold text-white uppercase">{m.mode.replace('_', ' ')}</span>
                      <p className="text-[10px] text-zinc-500 mt-0.5">{m.total} completed positions</p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-white">{m.winRate.toFixed(1)}% WR</span>
                      <p className="text-[10px] text-emerald-400 mt-0.5">Avg RR: 1:{m.avgRR.toFixed(2)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* General Info */}
            <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 shadow-xl space-y-4">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                <Clock className="w-4 h-4 text-sky-400" /> Operational Context
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center py-1.5 border-b border-zinc-900">
                  <span className="text-xs text-zinc-500">Avg Trade Duration</span>
                  <span className="text-xs font-mono text-zinc-200">{stats.averageDuration >= 60 ? `${Math.floor(stats.averageDuration / 60)}h ${stats.averageDuration % 60}m` : `${stats.averageDuration} mins`}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-zinc-900">
                  <span className="text-xs text-zinc-500">Average Decision Score</span>
                  <span className="text-xs font-mono text-zinc-200">{stats.averageScore.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-zinc-900">
                  <span className="text-xs text-zinc-500">Total Statistical Pool</span>
                  <span className="text-xs font-mono text-zinc-200">{stats.total} samples analyzed</span>
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-xs text-zinc-500">Autonomous Calibration Status</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 px-2 py-0.5 border border-emerald-500/20 rounded-full">ACTIVE</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rules Tab Content */}
      {activeTab === 'rules' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Winning Rules */}
          <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 shadow-xl space-y-4">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" /> Top Performing Strategy Rules
            </h3>
            {stats.topWinningRules.length === 0 ? (
              <p className="text-xs text-zinc-600 py-4 text-center">No rule data available yet.</p>
            ) : (
              <div className="space-y-3">
                {stats.topWinningRules.map((r, i) => (
                  <div key={i} className="flex justify-between items-center p-3 rounded-xl bg-zinc-900/40 border border-zinc-900">
                    <div>
                      <span className="text-xs font-bold text-white block">{r.rule}</span>
                      <span className="text-[10px] text-zinc-500">Matched in {r.total} trades</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-extrabold text-emerald-400 block">{r.winRate.toFixed(1)}% WR</span>
                      <span className="text-[10px] text-zinc-500">Avg RR: 1:{r.avgRR.toFixed(1)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top Losing Rules */}
          <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 shadow-xl space-y-4">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-red-400 flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-400" /> Lowest Performing Strategy Rules
            </h3>
            {stats.topLosingRules.length === 0 ? (
              <p className="text-xs text-zinc-600 py-4 text-center">No rule data available yet.</p>
            ) : (
              <div className="space-y-3">
                {stats.topLosingRules.map((r, i) => (
                  <div key={i} className="flex justify-between items-center p-3 rounded-xl bg-zinc-900/40 border border-zinc-900">
                    <div>
                      <span className="text-xs font-bold text-white block">{r.rule}</span>
                      <span className="text-[10px] text-zinc-500">Matched in {r.total} trades</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-extrabold text-red-400 block">{r.winRate.toFixed(1)}% WR</span>
                      <span className="text-[10px] text-zinc-500">Avg RR: 1:{r.avgRR.toFixed(1)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pairs Tab Content */}
      {activeTab === 'pairs' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Pair Statistics */}
            <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 shadow-xl space-y-4 lg:col-span-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-sky-400" /> Trading Asset Outcomes
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-zinc-400 border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-900 text-[10px] uppercase font-bold tracking-wider text-zinc-500">
                      <th className="py-2.5">Asset Pair</th>
                      <th className="py-2.5">Positions</th>
                      <th className="py-2.5 text-center">Win Rate</th>
                      <th className="py-2.5 text-right">Avg R:R</th>
                      <th className="py-2.5 text-right">Total PIPs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.pairStatsList.map((p, i) => (
                      <tr key={i} className="border-b border-zinc-900/60 last:border-0 hover:bg-zinc-900/20 transition-colors">
                        <td className="py-3 font-bold text-white">{p.pair}</td>
                        <td className="py-3">{p.total}</td>
                        <td className="py-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${p.winRate >= 60 ? 'bg-emerald-500/10 text-emerald-400' : p.winRate >= 40 ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'}`}>
                            {p.winRate.toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-3 text-right">1:{p.avgRR.toFixed(1)}</td>
                        <td className={`py-3 text-right font-semibold ${p.pips >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {p.pips >= 0 ? '+' : ''}{p.pips.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Timeframe & Session */}
            <div className="space-y-6">
              {/* Session Performance */}
              <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 shadow-xl space-y-4">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-sky-400" /> Session Distribution
                </h3>
                <div className="space-y-3">
                  {stats.sessionStatsList.map((s, i) => (
                    <div key={i} className="flex justify-between items-center py-2 border-b border-zinc-900 last:border-0">
                      <div>
                        <span className="text-xs font-bold text-zinc-200">{s.session}</span>
                        <p className="text-[10px] text-zinc-500 mt-0.5">{s.total} trades</p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-extrabold text-white">{s.winRate.toFixed(1)}% WR</span>
                        <p className={`text-[10px] mt-0.5 ${s.pips >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {s.pips >= 0 ? '+' : ''}{s.pips.toFixed(1)} pips
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Timeframe performance */}
              <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 shadow-xl space-y-4">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                  <Percent className="w-4 h-4 text-sky-400" /> Timeframe Accuracy
                </h3>
                <div className="space-y-3">
                  {stats.tfStatsList.map((t, i) => (
                    <div key={i} className="flex justify-between items-center py-2 border-b border-zinc-900 last:border-0">
                      <span className="text-xs font-bold text-zinc-200">{t.timeframe}</span>
                      <div className="text-right">
                        <span className="text-xs font-bold text-white">{t.winRate.toFixed(1)}% WR</span>
                        <p className="text-[10px] text-zinc-500 mt-0.5">{t.total} total positions</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rule Learning Engine Tab Content */}
      {activeTab === 'rule-learning' && (
        <div className="space-y-6">
          {/* Best/Worst Pairs & Timeframes Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Best Asset Pair */}
            <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 shadow-xl space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Best Performing Pair</span>
              {stats.bestPair ? (
                <div>
                  <h4 className="text-2xl font-extrabold text-white font-display">{stats.bestPair.pair}</h4>
                  <p className="text-xs text-zinc-400 mt-1">Win Rate: <span className="font-bold text-emerald-400">{stats.bestPair.winRate.toFixed(1)}%</span> ({stats.bestPair.total} trades)</p>
                </div>
              ) : (
                <p className="text-xs text-zinc-500">No data available</p>
              )}
            </div>

            {/* Worst Asset Pair */}
            <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 shadow-xl space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-red-400">Worst Performing Pair</span>
              {stats.worstPair ? (
                <div>
                  <h4 className="text-2xl font-extrabold text-white font-display">{stats.worstPair.pair}</h4>
                  <p className="text-xs text-zinc-400 mt-1">Win Rate: <span className="font-bold text-red-400">{stats.worstPair.winRate.toFixed(1)}%</span> ({stats.worstPair.total} trades)</p>
                </div>
              ) : (
                <p className="text-xs text-zinc-500">No data available</p>
              )}
            </div>

            {/* Best Timeframe */}
            <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 shadow-xl space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Best Timeframe</span>
              {stats.bestTimeframe ? (
                <div>
                  <h4 className="text-2xl font-extrabold text-white font-display">{stats.bestTimeframe.timeframe}</h4>
                  <p className="text-xs text-zinc-400 mt-1">Win Rate: <span className="font-bold text-emerald-400">{stats.bestTimeframe.winRate.toFixed(1)}%</span> ({stats.bestTimeframe.total} trades)</p>
                </div>
              ) : (
                <p className="text-xs text-zinc-500">No data available</p>
              )}
            </div>

            {/* Worst Timeframe */}
            <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 shadow-xl space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-red-400">Worst Timeframe</span>
              {stats.worstTimeframe ? (
                <div>
                  <h4 className="text-2xl font-extrabold text-white font-display">{stats.worstTimeframe.timeframe}</h4>
                  <p className="text-xs text-zinc-400 mt-1">Win Rate: <span className="font-bold text-red-400">{stats.worstTimeframe.winRate.toFixed(1)}%</span> ({stats.worstTimeframe.total} trades)</p>
                </div>
              ) : (
                <p className="text-xs text-zinc-500">No data available</p>
              )}
            </div>
          </div>

          {/* Rule Combinations Leaderboard */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top 5 Best Rule Combos */}
            <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 shadow-xl space-y-4">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                🏆 Best Performing Rule Combinations
              </h3>
              <div className="space-y-3">
                {stats.bestRuleCombos.slice(0, 5).map((c, i) => (
                  <div key={i} className="p-3 rounded-xl bg-zinc-900/30 border border-zinc-900 flex flex-col justify-between gap-2">
                    <div className="flex flex-wrap gap-1">
                      {c.combination.split(' + ').map((rule: string, idx: number) => (
                        <span key={idx} className="px-1.5 py-0.5 rounded text-[9px] bg-sky-500/10 text-sky-400 font-medium">
                          {rule}
                        </span>
                      ))}
                    </div>
                    <div className="flex justify-between items-center text-xs mt-1">
                      <span className="text-zinc-500">Sample size: <strong className="text-zinc-300">{c.total}</strong></span>
                      <div className="space-x-3">
                        <span className="font-bold text-emerald-400">{c.winRate.toFixed(1)}% WR</span>
                        <span className="text-zinc-400 font-medium">Avg R:R: 1:{c.avgRR.toFixed(1)}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {stats.bestRuleCombos.length === 0 && (
                  <p className="text-xs text-zinc-500">No rule combinations found</p>
                )}
              </div>
            </div>

            {/* Top 5 Worst Rule Combos */}
            <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 shadow-xl space-y-4">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-red-400 flex items-center gap-2">
                ⚠️ Worst Performing Rule Combinations
              </h3>
              <div className="space-y-3">
                {stats.worstRuleCombos.slice(0, 5).map((c, i) => (
                  <div key={i} className="p-3 rounded-xl bg-zinc-900/30 border border-zinc-900 flex flex-col justify-between gap-2">
                    <div className="flex flex-wrap gap-1">
                      {c.combination.split(' + ').map((rule: string, idx: number) => (
                        <span key={idx} className="px-1.5 py-0.5 rounded text-[9px] bg-sky-500/10 text-sky-400 font-medium">
                          {rule}
                        </span>
                      ))}
                    </div>
                    <div className="flex justify-between items-center text-xs mt-1">
                      <span className="text-zinc-500">Sample size: <strong className="text-zinc-300">{c.total}</strong></span>
                      <div className="space-x-3">
                        <span className="font-bold text-red-400">{c.winRate.toFixed(1)}% WR</span>
                        <span className="text-zinc-400 font-medium">Avg R:R: 1:{c.avgRR.toFixed(1)}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {stats.worstRuleCombos.length === 0 && (
                  <p className="text-xs text-zinc-500">No rule combinations found</p>
                )}
              </div>
            </div>
          </div>

          {/* All Rule Combinations Data Matrix */}
          <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 shadow-xl space-y-4">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
              📊 Rule Combination Performance Matrix
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-400 border-collapse">
                <thead>
                  <tr className="border-b border-zinc-900 text-[10px] uppercase font-bold tracking-wider text-zinc-500">
                    <th className="py-2.5">Rule Combination</th>
                    <th className="py-2.5">Trades</th>
                    <th className="py-2.5 text-center">Win Rate</th>
                    <th className="py-2.5 text-right">Average R:R</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.ruleCombosList.map((c, i) => (
                    <tr key={i} className="border-b border-zinc-900/60 last:border-0 hover:bg-zinc-900/20 transition-colors">
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1 max-w-xl">
                          {c.combination.split(' + ').map((rule: string, idx: number) => (
                            <span key={idx} className="px-1.5 py-0.5 rounded text-[9px] bg-zinc-900 text-zinc-300 border border-zinc-800">
                              {rule}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 font-semibold text-zinc-300">{c.total}</td>
                      <td className="py-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${c.winRate >= 60 ? 'bg-emerald-500/10 text-emerald-400' : c.winRate >= 40 ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'}`}>
                          {c.winRate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-3 text-right font-semibold text-zinc-300">1:{c.avgRR.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* History Audit Ledger Tab */}
      {activeTab === 'history' && (
        <div className="bg-zinc-950 rounded-2xl border border-zinc-900 shadow-xl overflow-hidden">
          <div className="p-4 bg-zinc-950 border-b border-zinc-900">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-400">Completed Position Records</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-400 border-collapse">
              <thead>
                <tr className="border-b border-zinc-900 bg-zinc-900/20 text-[10px] uppercase font-bold tracking-wider text-zinc-500">
                  <th className="p-4">Time Closed</th>
                  <th className="p-4">Asset</th>
                  <th className="p-4 text-center">Outcome</th>
                  <th className="p-4 text-right">Entry</th>
                  <th className="p-4 text-right">Exit</th>
                  <th className="p-4 text-right">PIPs</th>
                  <th className="p-4 text-right">R:R</th>
                  <th className="p-4 text-center">Pipeline Trace</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr key={i} className="border-b border-zinc-900/60 last:border-0 hover:bg-zinc-900/40 transition-colors">
                    <td className="p-4 whitespace-nowrap text-zinc-500">{new Date(t.created_at).toLocaleString()}</td>
                    <td className="p-4 whitespace-nowrap font-bold text-white">
                      {t.pair} <span className="text-[10px] text-zinc-500 font-medium bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800 ml-1">{t.timeframe}</span>
                    </td>
                    <td className="p-4 whitespace-nowrap text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${t.outcome === 'WIN' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : t.outcome === 'LOSS' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'}`}>
                        {t.outcome}
                      </span>
                    </td>
                    <td className="p-4 whitespace-nowrap text-right font-mono text-zinc-300">{Number(t.entry_price).toFixed(5)}</td>
                    <td className="p-4 whitespace-nowrap text-right font-mono text-zinc-300">{Number(t.exit_price).toFixed(5)}</td>
                    <td className={`p-4 whitespace-nowrap text-right font-semibold ${Number(t.pips) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {Number(t.pips) >= 0 ? '+' : ''}{t.pips}
                    </td>
                    <td className="p-4 whitespace-nowrap text-right text-zinc-300">1:{t.rr_achieved ? Number(t.rr_achieved).toFixed(2) : 'N/A'}</td>
                    <td className="p-4 whitespace-nowrap text-center">
                      {(t.decision_snapshot && Object.keys(t.decision_snapshot).length > 0) || t.evaluation_id ? (
                        <button
                          onClick={() => handleReplay(t)}
                          disabled={replayLoading}
                          className="px-2.5 py-1 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                        >
                          Replay Scan
                        </button>
                      ) : (
                        <span className="text-[10px] text-zinc-600">N/A</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Trace Replay Modal */}
      {selectedEvaluation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-zinc-950 border border-zinc-800 w-full max-w-2xl rounded-2xl flex flex-col max-h-[85vh] shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-zinc-900 flex justify-between items-center bg-zinc-900/25">
              <div>
                <h3 className="text-sm font-extrabold uppercase text-white">Original Pipeline Evaluation Trace</h3>
                <p className="text-[10px] text-zinc-500 mt-0.5">ID: {selectedEvaluation.id}</p>
              </div>
              <button 
                onClick={() => setSelectedEvaluation(null)}
                className="p-1.5 hover:bg-zinc-900 rounded-lg text-zinc-500 hover:text-white transition-all cursor-pointer"
              >
                <RefreshCw className="w-4 h-4 rotate-45" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-zinc-900/30 rounded-xl border border-zinc-900">
                  <span className="text-[9px] uppercase tracking-wider text-zinc-500 block mb-0.5">Evaluation Context</span>
                  <div className="space-y-1">
                    <p className="text-zinc-300 font-bold">Asset: {selectedEvaluation.pair}</p>
                    <p className="text-zinc-400">Timeframe: {selectedEvaluation.timeframe}</p>
                    <p className="text-zinc-400">Mode: {selectedEvaluation.strategy_mode}</p>
                  </div>
                </div>
                <div className="p-3 bg-zinc-900/30 rounded-xl border border-zinc-900">
                  <span className="text-[9px] uppercase tracking-wider text-zinc-500 block mb-0.5">Compliance Scoring</span>
                  <div className="space-y-1">
                    <p className="text-zinc-300 font-bold">Compliance: {selectedEvaluation.decision_score}%</p>
                    <p className="text-zinc-400">Matched Weight: {selectedEvaluation.matched_weight} of {selectedEvaluation.possible_weight}</p>
                    <p className="text-zinc-400">Recommendation: <strong className="text-sky-400">{selectedEvaluation.recommendation}</strong></p>
                  </div>
                </div>
              </div>

              {/* Matched Rules */}
              <div className="p-4 bg-zinc-900/20 border border-zinc-900 rounded-xl space-y-2">
                <h4 className="text-[10px] font-bold text-white uppercase tracking-wider">Matched strategy components</h4>
                <div className="flex flex-wrap gap-1.5">
                  {Array.isArray(selectedEvaluation.matched_rules) && selectedEvaluation.matched_rules.length > 0 ? (
                    selectedEvaluation.matched_rules.map((rule: string, i: number) => (
                      <span key={i} className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold rounded">
                        {rule}
                      </span>
                    ))
                  ) : (
                    <span className="text-zinc-500 text-[10px]">No rules matched.</span>
                  )}
                </div>
              </div>

              {/* Failed Rules */}
              <div className="p-4 bg-zinc-900/20 border border-zinc-900 rounded-xl space-y-2">
                <h4 className="text-[10px] font-bold text-white uppercase tracking-wider">Failed strategy components</h4>
                <div className="flex flex-wrap gap-1.5">
                  {Array.isArray(selectedEvaluation.failed_rules) && selectedEvaluation.failed_rules.length > 0 ? (
                    selectedEvaluation.failed_rules.map((rule: string, i: number) => (
                      <span key={i} className="px-2 py-0.5 bg-red-500/10 text-red-400 border border-red-500/20 text-[10px] font-bold rounded">
                        {rule}
                      </span>
                    ))
                  ) : (
                    <span className="text-zinc-500 text-[10px]">No rules failed.</span>
                  )}
                </div>
              </div>

              {/* Gemini details */}
              {selectedEvaluation.gemini_used && (
                <div className="p-4 bg-zinc-900/20 border border-zinc-900 rounded-xl space-y-2">
                  <h4 className="text-[10px] font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-purple-400" /> Gemini Neural Refinement
                  </h4>
                  <p className="text-[11px] text-zinc-300 italic leading-relaxed whitespace-pre-wrap bg-zinc-900 p-3 rounded-lg border border-zinc-800">
                    {selectedEvaluation.gemini_result}
                  </p>
                  <p className="text-[9px] text-zinc-500">Processing duration: {selectedEvaluation.gemini_duration_ms}ms</p>
                </div>
              )}
            </div>
            
            <div className="p-4 border-t border-zinc-900 flex justify-end">
              <button 
                onClick={() => setSelectedEvaluation(null)}
                className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-xs font-bold uppercase tracking-wider border border-zinc-800 rounded-xl transition-colors cursor-pointer"
              >
                Close Trace
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
