import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  Shield, 
  Activity, 
  Layers, 
  Sparkles, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Info, 
  Clock, 
  Crosshair, 
  BarChart3, 
  PieChart 
} from 'lucide-react';
import { PerformanceSnapshot, PerformanceBreakdownItem } from '../lib/performance-snapshot';
import { LearningStatus } from '../lib/learning-status';

export interface LearningPerformanceViewProps {
  userId?: string;
  authToken?: string;
}

export const LearningPerformanceView: React.FC<LearningPerformanceViewProps> = ({ userId, authToken }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<PerformanceSnapshot | null>(null);
  const [learningStatus, setLearningStatus] = useState<LearningStatus | null>(null);
  const [activeTab, setActiveTab] = useState<'pairs' | 'setups' | 'timeframes' | 'directions' | 'regimes' | 'execution'>('pairs');

  const fetchPerformanceData = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const res = await fetch('/api/performance/snapshot', {
        method: authToken ? 'GET' : 'POST',
        headers,
        body: !authToken && userId ? JSON.stringify({ userId }) : undefined
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSnapshot(data.snapshot);
        setLearningStatus(data.learningStatus);
      } else {
        setError(data.error || 'Failed to load performance snapshot');
      }
    } catch (err: any) {
      console.error('Error loading performance snapshot:', err);
      setError(err.message || 'Error connecting to performance API');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPerformanceData();
  }, [userId, authToken]);

  if (loading) {
    return (
      <div className="p-8 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e]/60 space-y-4 animate-pulse">
        <div className="h-6 bg-zinc-200 dark:bg-zinc-800 rounded w-1/3"></div>
        <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-2/3"></div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4">
          <div className="h-20 bg-zinc-200 dark:bg-zinc-800 rounded-2xl"></div>
          <div className="h-20 bg-zinc-200 dark:bg-zinc-800 rounded-2xl"></div>
          <div className="h-20 bg-zinc-200 dark:bg-zinc-800 rounded-2xl"></div>
          <div className="h-20 bg-zinc-200 dark:bg-zinc-800 rounded-2xl"></div>
        </div>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e]/60 space-y-4 text-center">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
        <h3 className="text-base font-semibold text-zinc-900 dark:text-white">Performance Visibility Unavailable</h3>
        <p className="text-xs text-zinc-500">{error || 'No performance snapshot data returned.'}</p>
        <button
          onClick={fetchPerformanceData}
          className="px-4 py-2 text-xs font-semibold rounded-xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-90 inline-flex items-center gap-2"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'STRONG': return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
      case 'MODERATE': return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
      case 'WEAK': return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
      default: return 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20';
    }
  };

  const getGovColor = (status: string) => {
    switch (status) {
      case 'NORMAL': return 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'RESTRICTED_SELECTIVITY': return 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20';
      case 'NO_TRADE': return 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20';
      default: return 'text-zinc-600 dark:text-zinc-400 bg-zinc-500/10 border-zinc-500/20';
    }
  };

  const currentBreakdownMap: Record<string, PerformanceBreakdownItem> = 
    activeTab === 'pairs' ? snapshot.breakdownByPair :
    activeTab === 'setups' ? snapshot.breakdownBySetup :
    activeTab === 'timeframes' ? snapshot.breakdownByTimeframe :
    activeTab === 'directions' ? snapshot.breakdownByDirection :
    activeTab === 'regimes' ? snapshot.breakdownByRegime : snapshot.breakdownByExecutionTiming;

  const breakdownKeys = Object.keys(currentBreakdownMap);

  return (
    <div className="space-y-6 animate-fade-in">
      
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-500" />
            <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">AI Learning & Performance Visibility</h2>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Real-time attribution and closed-loop calibration based on completed trade outcomes.
          </p>
        </div>
        <button
          onClick={fetchPerformanceData}
          className="self-start sm:self-center px-3 py-1.5 text-xs font-medium rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Top Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Trades & Evidence */}
        <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e]/60 space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Completed Trades</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${getTierColor(snapshot.evidenceTier)}`}>
              {snapshot.evidenceTier}
            </span>
          </div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-white">{snapshot.totalCompletedTrades}</div>
          <div className="text-[11px] text-zinc-500">
            {snapshot.wins} W / {snapshot.losses} L / {snapshot.breakevens} BE
          </div>
        </div>

        {/* Realized R & Expectancy */}
        <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e]/60 space-y-2">
          <div className="text-xs text-zinc-500">Total Realized R</div>
          <div className={`text-2xl font-bold ${snapshot.totalRealizedR >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {snapshot.totalRealizedR >= 0 ? `+${snapshot.totalRealizedR}` : snapshot.totalRealizedR}R
          </div>
          <div className="text-[11px] text-zinc-500">
            Expectancy: {snapshot.expectancyR >= 0 ? `+${snapshot.expectancyR}` : snapshot.expectancyR}R / trade
          </div>
        </div>

        {/* Win Rate */}
        <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e]/60 space-y-2">
          <div className="text-xs text-zinc-500">Win Rate</div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-white">{snapshot.winRate}%</div>
          <div className="text-[11px] text-zinc-500">
            Avg Win: +{snapshot.averageWinR}R | Loss: -{snapshot.averageLossR}R
          </div>
        </div>

        {/* Estimated Equity & Drawdown */}
        <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e]/60 space-y-2">
          <div className="text-xs text-zinc-500">Estimated Equity</div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-white">${snapshot.estimatedEquity.toLocaleString()}</div>
          <div className="text-[11px] text-zinc-500">
            Drawdown: {snapshot.estimatedDrawdownPercent}% from peak
          </div>
        </div>
      </div>

      {/* Risk Governor Visibility Card */}
      <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e]/60 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-indigo-500" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Risk Governor Visibility</h3>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${getGovColor(snapshot.riskGovernorVisibility.status)}`}>
            {snapshot.riskGovernorVisibility.status}
          </span>
        </div>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          The Risk Governor enforces automatic selectivity controls based on historical loss streaks, drawdowns, and pair/setup performance deterioration.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-xs">
          <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200/60 dark:border-zinc-800/60">
            <span className="text-[10px] text-zinc-500 block">Consecutive Losses</span>
            <span className="font-semibold text-zinc-900 dark:text-white">{snapshot.consecutiveLosses}</span>
          </div>
          <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200/60 dark:border-zinc-800/60">
            <span className="text-[10px] text-zinc-500 block">Peak Drawdown</span>
            <span className="font-semibold text-zinc-900 dark:text-white">{snapshot.estimatedDrawdownPercent}%</span>
          </div>
          <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200/60 dark:border-zinc-800/60">
            <span className="text-[10px] text-zinc-500 block">Sample Evaluated</span>
            <span className="font-semibold text-zinc-900 dark:text-white">{snapshot.totalCompletedTrades} trades</span>
          </div>
          <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200/60 dark:border-zinc-800/60">
            <span className="text-[10px] text-zinc-500 block">Trigger Conditions</span>
            <span className="font-semibold text-zinc-900 dark:text-white truncate block">
              {snapshot.riskGovernorVisibility.triggeringConditions.length > 0 
                ? snapshot.riskGovernorVisibility.triggeringConditions.join(', ')
                : 'None (Healthy)'}
            </span>
          </div>
        </div>
      </div>

      {/* Learning Status Insights */}
      {learningStatus && (
        <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e]/60 space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-500" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">What the AI Has Learned</h3>
          </div>
          <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200 leading-relaxed">
            {learningStatus.summary}
          </p>

          <div className="space-y-1.5 pt-1">
            {learningStatus.keyInsights.map((insight, idx) => (
              <div key={idx} className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <span>{insight}</span>
              </div>
            ))}
            {learningStatus.pairInsights.map((insight, idx) => (
              <div key={`p-${idx}`} className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <Info className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                <span>{insight}</span>
              </div>
            ))}
            {learningStatus.setupInsights.map((insight, idx) => (
              <div key={`s-${idx}`} className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <Layers className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                <span>{insight}</span>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60 text-[11px] text-zinc-500 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span>{learningStatus.governorInsight}</span>
            <span className="font-mono text-[10px] text-zinc-400">{learningStatus.adaptiveHierarchyInsight}</span>
          </div>
        </div>
      )}

      {/* Breakdown Section */}
      <div className="space-y-4">
        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
          {(['pairs', 'setups', 'timeframes', 'directions', 'regimes', 'execution'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-xl capitalize transition-all ${
                activeTab === tab
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Breakdown Items Table / List */}
        <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e]/60 space-y-3">
          <div className="text-xs font-semibold text-zinc-900 dark:text-white flex items-center justify-between">
            <span className="capitalize">{activeTab} Performance Breakdown</span>
            <span className="text-[11px] text-zinc-500 font-normal">{breakdownKeys.length} categories tracked</span>
          </div>

          {breakdownKeys.length === 0 ? (
            <div className="text-center py-6 text-xs text-zinc-500">
              No completed trade data recorded for {activeTab} yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-400 font-medium text-[11px]">
                    <th className="pb-2">Category</th>
                    <th className="pb-2 text-center">Trades</th>
                    <th className="pb-2 text-center">Win Rate</th>
                    <th className="pb-2 text-center">Expectancy</th>
                    <th className="pb-2 text-center">Realized R</th>
                    <th className="pb-2 text-center">Evidence Tier</th>
                    <th className="pb-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                  {breakdownKeys.map(key => {
                    const item = currentBreakdownMap[key];
                    return (
                      <tr key={key} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50">
                        <td className="py-2.5 font-semibold text-zinc-900 dark:text-white">{item.key}</td>
                        <td className="py-2.5 text-center text-zinc-600 dark:text-zinc-300">
                          {item.sampleSize} ({item.wins}W / {item.losses}L)
                        </td>
                        <td className="py-2.5 text-center text-zinc-900 dark:text-white font-medium">
                          {item.winRate}%
                        </td>
                        <td className={`py-2.5 text-center font-medium ${item.expectancyR >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {item.expectancyR >= 0 ? `+${item.expectancyR}` : item.expectancyR}R
                        </td>
                        <td className={`py-2.5 text-center font-medium ${item.realizedR >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {item.realizedR >= 0 ? `+${item.realizedR}` : item.realizedR}R
                        </td>
                        <td className="py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${getTierColor(item.evidenceTier)}`}>
                            {item.evidenceTier}
                          </span>
                        </td>
                        <td className="py-2.5 text-right font-medium text-zinc-500">
                          {item.performanceState}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

    </div>
  );
};
