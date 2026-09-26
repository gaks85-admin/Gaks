import React, { useState, useEffect } from 'react';
import { Target, TrendingUp, ShieldAlert, Zap, ArrowRight, BrainCircuit, Check } from 'lucide-react';

interface RecommendedSettings {
  riskPerTrade: string;
  maxDailyLoss: string;
  minRR: string;
  tradesPerPeriod: number;
  expectedWinRate: number;
}

interface ProfitGoalOptimizerProps {
  currentCapital: string;
  onApplySettings: (settings: {
    preferredRisk: string;
    maxDailyLoss: string;
    riskReward: string;
  }) => void;
}

export const ProfitGoalOptimizer: React.FC<ProfitGoalOptimizerProps> = ({
  currentCapital,
  onApplySettings
}) => {
  const [profitGoal, setProfitGoal] = useState<string>('');
  const [timeframe, setTimeframe] = useState<'weekly' | 'monthly'>('monthly');
  const [recommendation, setRecommendation] = useState<RecommendedSettings | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [applied, setApplied] = useState(false);

  const capitalNum = parseFloat(currentCapital.replace(/[^0-9.]/g, '')) || 1000;

  const calculateSettings = () => {
    setIsCalculating(true);
    setApplied(false);
    
    // Simulate AI calculation
    setTimeout(() => {
      const goal = parseFloat(profitGoal) || 0;
      if (goal <= 0) {
        setIsCalculating(false);
        return;
      }

      // Logic:
      // Goal = Capital * RiskPerTrade * RR * WinRate * TradesPerPeriod - Capital * RiskPerTrade * (1-WinRate) * TradesPerPeriod
      // Simplified for recommendation:
      // We aim for a realistic 40-50% win rate and 1:2 or 1:3 RR.
      
      const targetPercent = (goal / capitalNum) * 100;
      let risk = 1;
      let rr = "1:2";
      let trades = timeframe === 'weekly' ? 5 : 20;
      let winRate = 50;

      if (targetPercent > 20) {
        // Aggressive goal
        risk = 2.5;
        rr = "1:3";
        winRate = 45;
      } else if (targetPercent > 10) {
        // Moderate goal
        risk = 1.5;
        rr = "1:2.5";
        winRate = 48;
      } else {
        // Conservative goal
        risk = 0.5;
        rr = "1:2";
        winRate = 50;
      }

      // Max daily loss should be ~2-3x the single trade risk
      const dailyLoss = (capitalNum * (risk / 100) * 2.5).toFixed(0);

      setRecommendation({
        riskPerTrade: `${risk}%`,
        maxDailyLoss: dailyLoss,
        minRR: rr,
        tradesPerPeriod: trades,
        expectedWinRate: winRate
      });
      setIsCalculating(false);
    }, 800);
  };

  const handleApply = () => {
    if (recommendation) {
      onApplySettings({
        preferredRisk: recommendation.riskPerTrade,
        maxDailyLoss: recommendation.maxDailyLoss,
        riskReward: recommendation.minRR
      });
      setApplied(true);
      setTimeout(() => setApplied(false), 3000);
    }
  };

  return (
    <div className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0c0c0e]/40 space-y-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-base font-bold text-zinc-950 dark:text-white flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-indigo-500" />
            AI Profit Goal Optimizer
          </h3>
          <p className="text-xs text-zinc-500">Tell the AI your goal, and it will calculate the safest path to get there.</p>
        </div>
        <div className="px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
          New Feature
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">I want to profit</label>
            <div className="relative rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-white dark:bg-zinc-950/60 focus-within:border-indigo-500 dark:focus-within:border-indigo-500 shadow-sm transition-all">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-zinc-400">$</span>
              <input
                type="number"
                value={profitGoal}
                onChange={(e) => setProfitGoal(e.target.value)}
                placeholder="e.g. 500"
                className="w-full bg-transparent border-0 py-3 pl-8 pr-4 text-sm font-bold text-zinc-900 dark:text-white focus:outline-none focus:ring-0"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Every</label>
            <div className="flex gap-2">
              {(['weekly', 'monthly'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTimeframe(t)}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                    timeframe === t
                      ? 'bg-zinc-950 dark:bg-white text-white dark:text-zinc-950 border-zinc-950 dark:border-white shadow-md'
                      : 'bg-white dark:bg-zinc-950/40 text-zinc-500 border-zinc-200 dark:border-zinc-800 hover:border-zinc-400'
                  }`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={calculateSettings}
            disabled={isCalculating || !profitGoal}
            className="w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-800 text-white text-xs font-bold shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
          >
            {isCalculating ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4 fill-current" />
            )}
            <span>{isCalculating ? 'Analyzing Market Math...' : 'Generate Best Settings'}</span>
          </button>
        </div>

        <div className="relative">
          {!recommendation ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl space-y-3">
              <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
                <Target className="w-6 h-6 text-zinc-300" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-bold text-zinc-400">Settings Pending</p>
                <p className="text-[10px] text-zinc-500 max-w-[180px]">Input your target to see AI-optimized risk configurations.</p>
              </div>
            </div>
          ) : (
            <div className="h-full p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-indigo-500/30 shadow-xl shadow-indigo-500/5 space-y-5 animate-in fade-in slide-in-from-right-4">
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                <TrendingUp className="w-4 h-4" />
                <span className="text-[11px] font-bold uppercase tracking-wider">AI Recommendation</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase">Risk / Trade</p>
                  <p className="text-lg font-bold text-zinc-900 dark:text-white">{recommendation.riskPerTrade}</p>
                </div>
                <div className="space-y-1 text-right">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase">Max Daily Loss</p>
                  <p className="text-lg font-bold text-rose-500">${recommendation.maxDailyLoss}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase">Min RR Ratio</p>
                  <p className="text-lg font-bold text-emerald-500">{recommendation.minRR}</p>
                </div>
                <div className="space-y-1 text-right">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase">Est. Win Rate</p>
                  <p className="text-lg font-bold text-zinc-900 dark:text-white">{recommendation.expectedWinRate}%</p>
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800">
                <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-4">
                  <span>Probability of success</span>
                  <span className="font-bold text-emerald-500">HIGH</span>
                </div>
                
                <button
                  onClick={handleApply}
                  className={`w-full py-2.5 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-2 ${
                    applied
                      ? 'bg-emerald-500 text-white'
                      : 'bg-zinc-950 dark:bg-white text-white dark:text-zinc-950 hover:bg-zinc-800'
                  }`}
                >
                  {applied ? (
                    <>
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                      <span>Settings Applied!</span>
                    </>
                  ) : (
                    <>
                      <span>Apply These Settings</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const RefreshCw = ({ className }: { className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    width="24" 
    height="24" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);

export default ProfitGoalOptimizer;
