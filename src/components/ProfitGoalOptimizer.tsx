import React, { useState, useEffect } from 'react';
import { Target, TrendingUp, ShieldAlert, Zap, ArrowRight, BrainCircuit, Check, Trophy, AlertCircle, XCircle } from 'lucide-react';

interface RecommendedSettings {
  riskPerTrade: string;
  maxDailyLoss: string;
  minRR: string;
  tradesPerPeriod: number;
  expectedWinRate: number;
}

interface ProfitGoal {
  id: string;
  target_amount: number;
  start_amount: number;
  current_amount: number;
  status: 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  timeframe: string;
  deadline: string;
  settings_applied: any;
}

interface ProfitGoalOptimizerProps {
  userId: string;
  supabase: any;
  triggerNotification?: (msg: string, type?: 'success' | 'info') => void;
  currentCapital: string;
  onApplySettings: (settings: {
    preferredRisk: string;
    maxDailyLoss: string;
    riskReward: string;
  }) => void;
}

export const ProfitGoalOptimizer: React.FC<ProfitGoalOptimizerProps> = ({
  userId,
  supabase,
  triggerNotification,
  currentCapital,
  onApplySettings
}) => {
  const [profitGoal, setProfitGoal] = useState<string>('');
  const [timeframe, setTimeframe] = useState<'weekly' | 'monthly'>('monthly');
  const [recommendation, setRecommendation] = useState<RecommendedSettings | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [activeGoal, setActiveGoal] = useState<ProfitGoal | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const capitalNum = parseFloat(currentCapital.replace(/[^0-9.]/g, '')) || 1000;

  useEffect(() => {
    if (userId && supabase) {
      fetchActiveGoal();
    }
  }, [userId, supabase]);

  const fetchActiveGoal = async () => {
    setIsLoading(true);
    try {
      if (!userId || !supabase) {
        setIsLoading(false);
        return;
      }

      // Fetch either ACTIVE or recently COMPLETED/FAILED goals that haven't been notified
      const { data, error } = await supabase
        .from('profit_goals')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['ACTIVE', 'COMPLETED', 'FAILED'])
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        // If it's COMPLETED or FAILED but already notified, don't show it as the primary view
        if ((data.status === 'COMPLETED' || data.status === 'FAILED') && data.notified) {
          setActiveGoal(null);
        } else {
          setActiveGoal(data);
        }
      } else {
        setActiveGoal(null);
      }
    } catch (err) {
      console.error('Error fetching profit goal:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDismissGoal = async () => {
    if (!activeGoal || !supabase) return;
    try {
      await supabase
        .from('profit_goals')
        .update({ notified: true })
        .eq('id', activeGoal.id);
      setActiveGoal(null);
      if (triggerNotification) triggerNotification("Goal dismissed.", "info");
    } catch (err) {
      console.error('Error dismissing goal:', err);
    }
  };

  const calculateSettings = () => {
    if (!profitGoal || parseFloat(profitGoal) <= 0) {
      if (triggerNotification) triggerNotification("Please enter a valid profit goal.", "info");
      return;
    }

    setIsCalculating(true);
    setApplied(false);
    
    // Simulate AI calculation
    setTimeout(() => {
      const goal = parseFloat(profitGoal) || 0;
      if (goal <= 0) {
        setIsCalculating(false);
        return;
      }

      const targetPercent = (goal / capitalNum) * 100;
      let risk = 1;
      let rr = "1:2";
      let trades = timeframe === 'weekly' ? 5 : 20;
      let winRate = 50;

      if (targetPercent > 20) {
        risk = 2.5;
        rr = "1:3";
        winRate = 45;
      } else if (targetPercent > 10) {
        risk = 1.5;
        rr = "1:2.5";
        winRate = 48;
      } else {
        risk = 0.5;
        rr = "1:2";
        winRate = 50;
      }

      const dailyLoss = (capitalNum * (risk / 100) * 2.5).toFixed(0);

      setRecommendation({
        riskPerTrade: `${risk}%`,
        maxDailyLoss: dailyLoss,
        minRR: rr,
        tradesPerPeriod: trades,
        expectedWinRate: winRate
      });
      setIsCalculating(false);
      if (triggerNotification) triggerNotification("AI settings generated!", "success");
    }, 800);
  };

  const handleApply = async () => {
    if (!recommendation) {
      if (triggerNotification) triggerNotification("No recommendation to apply.", "info");
      return;
    }

    if (!userId || !supabase) {
      if (triggerNotification) triggerNotification("Authentication required to start challenge.", "info");
      console.error("Missing userId or supabase", { userId, hasSupabase: !!supabase });
      return;
    }

    setIsApplying(true);

    try {
      // 1. Cancel any existing active goal
      if (activeGoal && activeGoal.status === 'ACTIVE') {
        const { error: cancelErr } = await supabase
          .from('profit_goals')
          .update({ status: 'CANCELLED' })
          .eq('id', activeGoal.id);
        
        if (cancelErr) {
          console.warn("Could not cancel previous goal:", cancelErr.message);
        }
      }

      const deadline = new Date();
      if (timeframe === 'weekly') {
        deadline.setDate(deadline.getDate() + 7);
      } else {
        deadline.setMonth(deadline.getMonth() + 1);
      }

      const goalAmount = parseFloat(profitGoal);
      
      // 2. Insert new goal
      const { data, error } = await supabase
        .from('profit_goals')
        .insert({
          user_id: userId,
          target_amount: capitalNum + goalAmount,
          start_amount: capitalNum,
          current_amount: capitalNum,
          status: 'ACTIVE',
          timeframe: timeframe,
          deadline: deadline.toISOString(),
          settings_applied: recommendation,
          notified: false
        })
        .select()
        .single();

      if (error) {
        console.error('Database Error starting challenge:', error);
        if (triggerNotification) triggerNotification(`DB Error: ${error.message}`, "info");
        setIsApplying(false);
        return;
      }

      // 3. Apply to UI/App State (Local State)
      onApplySettings({
        preferredRisk: recommendation.riskPerTrade,
        maxDailyLoss: recommendation.maxDailyLoss,
        riskReward: recommendation.minRR
      });

      if (data) {
        setActiveGoal(data);
        setApplied(true);
        if (triggerNotification) triggerNotification("Performance Challenge Started!", "success");
        
        setTimeout(() => {
          setApplied(false);
          setRecommendation(null);
          setProfitGoal('');
        }, 3000);
      }
    } catch (err: any) {
      console.error('Exception saving profit goal:', err);
      if (triggerNotification) triggerNotification(`Error: ${err.message || 'Unknown error'}`, "info");
    } finally {
      setIsApplying(false);
    }
  };

  const handleCancelGoal = async () => {
    if (!activeGoal || !supabase) return;
    if (!window.confirm('Are you sure you want to cancel your current profit goal?')) return;

    try {
      await supabase
        .from('profit_goals')
        .update({ status: 'CANCELLED' })
        .eq('id', activeGoal.id);
      setActiveGoal(null);
    } catch (err) {
      console.error('Error cancelling goal:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="p-12 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0c0c0e]/40 flex items-center justify-center">
        <RefreshCw className="w-5 h-5 text-zinc-400 animate-spin" />
      </div>
    );
  }

  // If a goal is active or recently completed, show the status view
  if (activeGoal) {
    const totalTarget = activeGoal.target_amount - activeGoal.start_amount;
    const currentProfit = activeGoal.current_amount - activeGoal.start_amount;
    const progressPercent = Math.max(0, Math.min(100, (currentProfit / totalTarget) * 100));
    const isAhead = currentProfit > 0;
    
    if (activeGoal.status === 'COMPLETED') {
      return (
        <div className="p-8 rounded-3xl border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-center space-y-4 shadow-xl shadow-emerald-500/10 animate-in zoom-in-95 duration-500">
          <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/40">
            <Trophy className="w-8 h-8 text-white" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-zinc-900 dark:text-white">Goal Achieved!</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Congratulations! You've reached your target of <span className="font-bold text-emerald-600 dark:text-emerald-400">${activeGoal.target_amount.toLocaleString()}</span>.
            </p>
          </div>
          <button 
            onClick={handleDismissGoal}
            className="px-8 py-3 rounded-2xl bg-zinc-950 dark:bg-white text-white dark:text-zinc-950 text-xs font-bold shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            Start New Challenge
          </button>
        </div>
      );
    }

    if (activeGoal.status === 'FAILED') {
      return (
        <div className="p-8 rounded-3xl border border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-center space-y-4 shadow-xl shadow-rose-500/10 animate-in zoom-in-95 duration-500">
          <div className="w-16 h-16 rounded-full bg-rose-500 flex items-center justify-center mx-auto shadow-lg shadow-rose-500/40">
            <AlertCircle className="w-8 h-8 text-white" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-zinc-900 dark:text-white">Challenge Ended</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              The deadline for your profit goal has passed. Don't worry, every loss is a lesson. Let's analyze and try again.
            </p>
          </div>
          <button 
            onClick={handleDismissGoal}
            className="px-8 py-3 rounded-2xl bg-zinc-950 dark:bg-white text-white dark:text-zinc-950 text-xs font-bold shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            Analyze & Re-configure
          </button>
        </div>
      );
    }

    return (
      <div className="p-6 rounded-3xl border border-indigo-500/20 bg-indigo-50/30 dark:bg-indigo-500/5 space-y-6 shadow-sm animate-in fade-in zoom-in-95 duration-300">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Trophy className="w-5 h-5 text-white" />
            </div>
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-zinc-950 dark:text-white uppercase tracking-tight">Active Profit Challenge</h3>
              <p className="text-[11px] text-zinc-500">Targeting ${activeGoal.target_amount.toLocaleString()} by {new Date(activeGoal.deadline).toLocaleDateString()}</p>
            </div>
          </div>
          <button 
            onClick={handleCancelGoal}
            className="p-2 text-zinc-400 hover:text-rose-500 transition-colors"
            title="Cancel Goal"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex items-end justify-between">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Progress</span>
              <div className="flex items-baseline gap-1.5">
                <span className={`text-2xl font-bold ${isAhead ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {isAhead ? '+' : ''}${currentProfit.toFixed(2)}
                </span>
                <span className="text-xs text-zinc-500 font-medium">/ ${totalTarget.toLocaleString()} goal</span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{progressPercent.toFixed(1)}%</span>
            </div>
          </div>

          <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-3 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-1000 ease-out ${isAhead ? 'bg-indigo-500 shadow-[0_0_12px_rgba(99,102,241,0.5)]' : 'bg-rose-500'}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="p-3 rounded-2xl bg-white/50 dark:bg-zinc-950/40 border border-zinc-200/50 dark:border-zinc-800/50">
              <p className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Time Remaining</p>
              <p className="text-xs font-bold text-zinc-900 dark:text-white">
                {Math.ceil((new Date(activeGoal.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))} Days
              </p>
            </div>
            <div className="p-3 rounded-2xl bg-white/50 dark:bg-zinc-950/40 border border-zinc-200/50 dark:border-zinc-800/50">
              <p className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Status</p>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase">Tracking</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0c0c0e]/40 space-y-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-base font-bold text-zinc-950 dark:text-white flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-indigo-500" />
            AI Profit Goal Optimizer
          </h3>
          <p className="text-xs text-zinc-500">Set a target. The AI handles the math and tracks your progress.</p>
        </div>
        <div className="px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
          Performance Challenge
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Profit Target (above ${capitalNum.toLocaleString()})</label>
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
            <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Target Timeframe</label>
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
            <span>{isCalculating ? 'AI Math Simulation...' : 'Generate Settings & Start'}</span>
          </button>
        </div>

        <div className="relative">
          {!recommendation ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl space-y-3">
              <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
                <Target className="w-6 h-6 text-zinc-300" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-bold text-zinc-400">Challenge Ready</p>
                <p className="text-[10px] text-zinc-500 max-w-[180px]">Input your target to see AI-optimized risk configurations.</p>
              </div>
            </div>
          ) : (
            <div className="h-full p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-indigo-500/30 shadow-xl shadow-indigo-500/5 space-y-5 animate-in fade-in slide-in-from-right-4">
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                <TrendingUp className="w-4 h-4" />
                <span className="text-[11px] font-bold uppercase tracking-wider">AI Challenge Configuration</span>
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
                  disabled={isApplying || applied}
                  className={`w-full py-2.5 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-2 ${
                    applied
                      ? 'bg-emerald-500 text-white'
                      : 'bg-zinc-950 dark:bg-white text-white dark:text-zinc-950 hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed'
                  }`}
                >
                  {isApplying ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : applied ? (
                    <>
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                      <span>Challenge Started!</span>
                    </>
                  ) : (
                    <>
                      <span>Start Challenge</span>
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
