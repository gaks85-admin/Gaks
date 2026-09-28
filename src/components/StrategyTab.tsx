import React from 'react';
import { AlertTriangle, Check, Trash2, RefreshCw } from 'lucide-react';
import { Strategy } from '../types';
import ProfitGoalOptimizer from './ProfitGoalOptimizer';

export interface StrategyTabProps {
  userId: string;
  supabase: any;
  strategies: Strategy[];
  selectedStrategyId: string;
  activeStrategyId: string;
  lastSavedStrategyText: string;
  GAKS_DEFAULT_STRATEGY: Strategy;
  strategyTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  handleClearStrategy: () => void;
  handleRestoreStrategy: () => void;
  handleSetActiveStrategy: (id: string) => void;
  handleStrategyTextChange: (val: string) => void;
  saveStrategyPlaybook: () => void;
  capital: string;
  setCapital: (val: string) => void;
  customCapital: string;
  setCustomCapital: (val: string) => void;
  preferredRisk: string;
  setPreferredRisk: (val: string) => void;
  maxDailyLoss: string;
  setMaxDailyLoss: (val: string) => void;
  riskReward: string;
  setRiskReward: (val: string) => void;
  positionMode: 'AUTO_RISK' | 'FIXED_LOT';
  setPositionMode: (val: 'AUTO_RISK' | 'FIXED_LOT') => void;
  fixedLotSize: string;
  setFixedLotSize: (val: string) => void;
  accountType: 'personal' | 'prop' | null;
  setAccountType: (val: 'personal' | 'prop' | null) => void;
  propFirmName: string;
  setPropFirmName: (val: string) => void;
  propFirmAccountPhase: string;
  setPropFirmAccountPhase: (val: string) => void;
  propFirmAccountSize: string;
  setPropFirmAccountSize: (val: string) => void;
  propFirmProfitTarget: string;
  setPropFirmProfitTarget: (val: string) => void;
  propFirmProfitTargetType: 'PERCENTAGE' | 'AMOUNT';
  setPropFirmProfitTargetType: (val: 'PERCENTAGE' | 'AMOUNT') => void;
  propFirmDailyLossLimit: string;
  setPropFirmDailyLossLimit: (val: string) => void;
  propFirmDailyLossLimitType: 'PERCENTAGE' | 'AMOUNT';
  setPropFirmDailyLossLimitType: (val: 'PERCENTAGE' | 'AMOUNT') => void;
  propFirmDailyLossCalcBasis: 'BALANCE' | 'EQUITY';
  setPropFirmDailyLossCalcBasis: (val: 'BALANCE' | 'EQUITY') => void;
  propFirmDailyResetTime: string;
  setPropFirmDailyResetTime: (val: string) => void;
  propFirmDailyResetTimezone: string;
  setPropFirmDailyResetTimezone: (val: string) => void;
  propFirmMaxDrawdown: string;
  setPropFirmMaxDrawdown: (val: string) => void;
  propFirmDrawdownType: 'STATIC' | 'TRAILING';
  setPropFirmDrawdownType: (val: 'STATIC' | 'TRAILING') => void;
  propFirmDrawdownCalcBasis: 'BALANCE' | 'EQUITY';
  setPropFirmDrawdownCalcBasis: (val: 'BALANCE' | 'EQUITY') => void;
  propFirmRiskPerTrade: string;
  setPropFirmRiskPerTrade: (val: string) => void;
  propFirmRiskPerTradeType: 'PERCENTAGE' | 'AMOUNT';
  setPropFirmRiskPerTradeType: (val: 'PERCENTAGE' | 'AMOUNT') => void;
  propFirmMaxTradesPerDay: string;
  setPropFirmMaxTradesPerDay: (val: string) => void;
  propFirmNewsRestriction: boolean;
  setPropFirmNewsRestriction: (val: boolean) => void;
  propFirmNewsBufferBefore: string;
  setPropFirmNewsBufferBefore: (val: string) => void;
  propFirmNewsBufferAfter: string;
  setPropFirmNewsBufferAfter: (val: string) => void;
  preferredSessions: string[];
  toggleSession: (session: string) => void;
  preferredTimeframes: string[];
  toggleTimeframe: (tf: string) => void;
  isPrefsDirty: boolean;
  savePreferences: () => void;
  triggerNotification: (msg: string, type?: 'success' | 'info') => void;
  isAdmin?: boolean;
}

export const StrategyTab: React.FC<StrategyTabProps> = ({
  userId,
  supabase,
  strategies,
  selectedStrategyId,
  activeStrategyId,
  lastSavedStrategyText,
  GAKS_DEFAULT_STRATEGY,
  strategyTextareaRef,
  handleClearStrategy,
  handleRestoreStrategy,
  handleSetActiveStrategy,
  handleStrategyTextChange,
  saveStrategyPlaybook,
  capital,
  setCapital,
  customCapital,
  setCustomCapital,
  preferredRisk,
  setPreferredRisk,
  maxDailyLoss,
  setMaxDailyLoss,
  riskReward,
  setRiskReward,
  positionMode,
  setPositionMode,
  fixedLotSize,
  setFixedLotSize,
  accountType,
  setAccountType,
  propFirmName,
  setPropFirmName,
  propFirmAccountPhase,
  setPropFirmAccountPhase,
  propFirmAccountSize,
  setPropFirmAccountSize,
  propFirmProfitTarget,
  setPropFirmProfitTarget,
  propFirmProfitTargetType,
  setPropFirmProfitTargetType,
  propFirmDailyLossLimit,
  setPropFirmDailyLossLimit,
  propFirmDailyLossLimitType,
  setPropFirmDailyLossLimitType,
  propFirmDailyLossCalcBasis,
  setPropFirmDailyLossCalcBasis,
  propFirmDailyResetTime,
  setPropFirmDailyResetTime,
  propFirmDailyResetTimezone,
  setPropFirmDailyResetTimezone,
  propFirmMaxDrawdown,
  setPropFirmMaxDrawdown,
  propFirmDrawdownType,
  setPropFirmDrawdownType,
  propFirmDrawdownCalcBasis,
  setPropFirmDrawdownCalcBasis,
  propFirmRiskPerTrade,
  setPropFirmRiskPerTrade,
  propFirmRiskPerTradeType,
  setPropFirmRiskPerTradeType,
  propFirmMaxTradesPerDay,
  setPropFirmMaxTradesPerDay,
  propFirmNewsRestriction,
  setPropFirmNewsRestriction,
  propFirmNewsBufferBefore,
  setPropFirmNewsBufferBefore,
  propFirmNewsBufferAfter,
  setPropFirmNewsBufferAfter,
  preferredSessions,
  toggleSession,
  preferredTimeframes,
  toggleTimeframe,
  isPrefsDirty,
  savePreferences,
  triggerNotification,
  isAdmin = false,
}) => {
  const selectedStrat = strategies.find(s => s.id === selectedStrategyId) || GAKS_DEFAULT_STRATEGY;
  const currentStrategyText = selectedStrat.text || '';
  const isDirty = lastSavedStrategyText !== currentStrategyText;
  const canSave = isDirty && currentStrategyText.trim().length > 0;

  return (
    <div className="space-y-8 animate-fade-in">
      
      {/* Header Title */}
      <div className="space-y-2">
        <h1 className="text-[32px] sm:text-[36px] font-semibold tracking-[-0.035em] text-zinc-950 dark:text-white leading-[1.15] font-sans">Strategy</h1>
        <p className="text-[15px] sm:text-[16px] font-normal tracking-[-0.01em] text-zinc-500 dark:text-zinc-400 leading-[1.45] max-w-sm">
          Write the playbook your AI assistant trades with.
        </p>
        <div className="flex items-center gap-1.5 pt-0.5">
          {isDirty ? (
            <>
              <AlertTriangle className="w-4 h-4 text-amber-500 animate-pulse" />
              <span className="text-xs text-amber-500 font-medium">Unsaved changes in editor</span>
            </>
          ) : (
            <>
              <Check className="w-4 h-4 text-zinc-300 stroke-[2.5]" />
              <span className="text-xs text-zinc-400 dark:text-zinc-500 font-medium">All changes saved</span>
            </>
          )}
        </div>
      </div>

      {/* 1. Account Type Selection (PRIMARY CHOICE) */}
      <div className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e]/80 space-y-4 shadow-sm animate-fade-in">
        <div className="space-y-1">
          <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-500 flex items-center gap-2">
            <span className="w-1 h-1 rounded-full bg-zinc-400"></span>
            Account Type
          </label>
          <p className="text-[11px] text-zinc-500">Choose your account type to configure the right trading settings.</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => setAccountType('personal')}
            className={`p-5 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center gap-1.5 ${
              accountType === 'personal'
                ? 'bg-zinc-950 dark:bg-white border-zinc-950 dark:border-white text-white dark:text-zinc-950 font-bold shadow-lg scale-[1.02]'
                : 'bg-white dark:bg-zinc-950/40 border-zinc-200 dark:border-zinc-900 text-zinc-500 hover:border-zinc-400 dark:hover:border-zinc-800'
            }`}
          >
            <div className="text-[13px] uppercase tracking-wide">Personal</div>
            <div className="text-[10px] opacity-70 font-medium">Standard Account</div>
          </button>
          <button
            onClick={() => setAccountType('prop')}
            className={`p-5 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center gap-1.5 ${
              accountType === 'prop'
                ? 'bg-zinc-950 dark:bg-white border-zinc-950 dark:border-white text-white dark:text-zinc-950 font-bold shadow-lg scale-[1.02]'
                : 'bg-white dark:bg-zinc-950/40 border-zinc-200 dark:border-zinc-900 text-zinc-500 hover:border-zinc-400 dark:hover:border-zinc-800'
            }`}
          >
            <div className="text-[13px] uppercase tracking-wide">Prop Firm</div>
            <div className="text-[10px] opacity-70 font-medium">Evaluation / Funded</div>
          </button>
        </div>
      </div>

      {!accountType ? (
         <div className="py-16 flex flex-col items-center justify-center text-center space-y-4 bg-zinc-50/50 dark:bg-zinc-950/30 rounded-[40px] border border-dashed border-zinc-200 dark:border-zinc-800 animate-fade-in">
           <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
             <RefreshCw className="w-6 h-6 text-zinc-400 animate-spin-slow" />
           </div>
           <div className="space-y-1">
             <p className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-200">Configuration Pending</p>
             <p className="text-xs text-zinc-500 max-w-[240px]">Select an account type above to unlock your strategy and risk settings.</p>
           </div>
         </div>
      ) : (
        <>
          {/* Strategy Board & Editor */}
      <div className="grid grid-cols-1 gap-8">
        
        {/* Full Width Strategy Editor */}
        <div className="space-y-4">
          <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0c0c0e]/80 overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-900 flex flex-wrap items-center justify-between gap-3 bg-zinc-100/70 dark:bg-[#08080a]">
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${selectedStrat.id === activeStrategyId ? 'bg-zinc-950 dark:bg-white animate-pulse' : 'bg-zinc-400 dark:bg-zinc-600'}`}></span>
                <span className="text-xs font-bold text-zinc-800 dark:text-white uppercase tracking-wider">Strategy Editor</span>
              </div>

              <div className="flex items-center gap-2">
                {/* Delete Button */}
                <button
                  onClick={handleClearStrategy}
                  className="px-3 py-1.5 rounded-xl border border-red-200 dark:border-red-950/20 hover:border-red-300 dark:hover:border-red-500/40 bg-red-50 dark:bg-zinc-950/60 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-all cursor-pointer flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
                  title="Clear current strategy"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
                
                {/* Restore Button */}
                <button
                  onClick={handleRestoreStrategy}
                  className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-white dark:bg-zinc-950/40 text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white transition-all cursor-pointer flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider shadow-xs"
                  title="Restore last saved or default version"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Restore</span>
                </button>

                {selectedStrat.id === activeStrategyId ? (
                  <span className="text-[10px] bg-zinc-200 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 px-2.5 py-1 rounded-full font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-950 dark:bg-white"></span>
                    Active
                  </span>
                ) : (
                  <button
                    onClick={() => handleSetActiveStrategy(selectedStrat.id)}
                    className="px-3 py-1 text-[10px] bg-zinc-950 dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all rounded-full font-bold uppercase tracking-wider cursor-pointer shadow-md"
                  >
                    Activate
                  </button>
                )}
              </div>
            </div>

            <div className="p-5 flex flex-col gap-4">
              <textarea
                ref={strategyTextareaRef}
                value={selectedStrat.text}
                onChange={(e) => handleStrategyTextChange(e.target.value)}
                placeholder="Describe your trading strategy in detail..."
                className="w-full h-[250px] sm:h-[320px] max-h-[380px] bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-2xl p-4 sm:p-6 text-[13px] text-zinc-800 dark:text-zinc-300 font-medium leading-relaxed overflow-y-auto resize-y font-sans focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-700 transition-colors shadow-sm"
              />

              {selectedStrat.text.trim().length === 0 && (
                <p className="text-rose-600 dark:text-red-400 text-[11px] font-semibold flex items-center gap-1.5 px-1 animate-fade-in">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Strategy cannot be empty.</span>
                </p>
              )}

              {/* Card Actions */}
              <div className="flex justify-center items-center pt-2">
                <button
                  onClick={saveStrategyPlaybook}
                  disabled={!canSave}
                  className={`px-10 py-3 rounded-full text-xs font-bold transition-all flex items-center gap-2 shadow-lg ${
                    canSave 
                      ? 'bg-zinc-950 dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 cursor-pointer active:scale-[0.98]' 
                      : 'bg-zinc-200 dark:bg-[#5A5A5A] text-zinc-400 dark:text-zinc-300 cursor-not-allowed'
                  }`}
                >
                  <Check className="w-4 h-4 stroke-[2.5]" />
                  <span>Save Changes</span>
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>

      {isAdmin && (
        <ProfitGoalOptimizer 
          userId={userId}
          supabase={supabase}
          triggerNotification={triggerNotification}
          currentCapital={capital === 'Custom' ? customCapital : capital}
          isAdmin={isAdmin}
          onApplySettings={(settings) => {
            setPreferredRisk(settings.preferredRisk);
            setMaxDailyLoss(settings.maxDailyLoss);
            setRiskReward(settings.riskReward);
          }}
        />
      )}

      {/* Trading Preferences Card */}
      <div className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e]/80 space-y-8 shadow-sm">
        <div className="space-y-1">
          <h3 className="text-base font-bold text-zinc-950 dark:text-white font-display uppercase tracking-tight">Trading Preferences</h3>
          <p className="text-xs text-zinc-500">Tune how your AI sizes and times trades.</p>
        </div>

        <div className="space-y-8">
          {accountType === 'personal' && (
            <div className="space-y-6 pt-2 animate-fade-in">
              {/* Capital Size Selection */}
              <div className="space-y-2.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Capital</label>
                <div className="flex flex-wrap gap-2">
                  {['$100', '$500', '$1,000', '$10,000', 'Custom'].map(option => {
                    const isSelected = capital === option;
                    return (
                      <button
                        key={option}
                        onClick={() => setCapital(option)}
                        className={`px-4 py-2 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-950 dark:border-zinc-100 shadow-md'
                            : 'bg-white dark:bg-zinc-950/40 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-900 hover:border-zinc-400 dark:hover:border-zinc-800 hover:text-zinc-900 dark:hover:text-white'
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
                
                {/* Render custom capital field if selected */}
                {capital === 'Custom' && (
                  <div className="mt-2.5 relative rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-white dark:bg-zinc-950/60 focus-within:border-zinc-400 dark:focus-within:border-zinc-700 shadow-sm">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-500">$</span>
                    <input
                      type="number"
                      value={customCapital}
                      onChange={(e) => setCustomCapital(e.target.value)}
                      placeholder="Enter your custom capital size..."
                      className="w-full bg-transparent border-0 py-2.5 pl-8 pr-4 text-xs text-zinc-800 dark:text-white focus:outline-none focus:ring-0"
                    />
                  </div>
                )}
              </div>

              {/* Preferred Risk Input */}
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Preferred Risk (Maximum Risk Cap)</label>
                <input
                  type="text"
                  value={preferredRisk}
                  onChange={(e) => setPreferredRisk(e.target.value)}
                  placeholder="e.g. 1% or 2.5%"
                  className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 focus:border-zinc-400 dark:focus:border-zinc-700 rounded-2xl px-4 py-3 text-xs font-semibold text-zinc-800 dark:text-white focus:outline-none shadow-sm transition-colors"
                />
              </div>

              {/* Max Daily Loss Limit Input */}
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Max Daily Loss Limit ($)</label>
                <div className="relative rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-white dark:bg-zinc-950/60 focus-within:border-zinc-400 dark:focus-within:border-zinc-700 shadow-sm">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-500">$</span>
                  <input
                    type="text"
                    value={maxDailyLoss}
                    onChange={(e) => setMaxDailyLoss(e.target.value)}
                    placeholder="e.g. 100 or 250"
                    className="w-full bg-transparent border-0 py-3 pl-8 pr-4 text-xs font-semibold text-zinc-800 dark:text-white focus:outline-none focus:ring-0"
                  />
                </div>
                <p className="text-[11px] text-zinc-400">Trading halts automatically for the day if cumulative losses reach this amount.</p>
              </div>
            </div>
          )}

          {accountType === 'prop' && (
            <div className="space-y-6 pt-2 animate-fade-in">
              <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 flex gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-500 shrink-0" />
                <div className="space-y-1">
                  <p className="text-[11px] font-bold text-amber-800 dark:text-amber-400 uppercase tracking-wide">Prop Firm Rule Synchronization</p>
                  <p className="text-[10px] text-amber-700/80 dark:text-amber-500/80 leading-relaxed">
                    Configure your firm's rules exactly as they appear in your agreement. Gaks AI will enforce these limits to protect your account.
                  </p>
                </div>
              </div>

              {/* Account Section */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Account</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Firm Name *</label>
                    <input
                      type="text"
                      value={propFirmName}
                      onChange={(e) => setPropFirmName(e.target.value)}
                      placeholder="e.g. FTMO, MyFundedFX"
                      className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-800 dark:text-white focus:outline-none focus:border-zinc-400"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Account Phase *</label>
                    <input
                      type="text"
                      value={propFirmAccountPhase}
                      onChange={(e) => setPropFirmAccountPhase(e.target.value)}
                      placeholder="e.g. Phase 1, Funded"
                      className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-800 dark:text-white focus:outline-none focus:border-zinc-400"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Account Size ($) *</label>
                    <input
                      type="text"
                      value={propFirmAccountSize}
                      onChange={(e) => setPropFirmAccountSize(e.target.value)}
                      placeholder="100000"
                      className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-800 dark:text-white focus:outline-none focus:border-zinc-400"
                    />
                  </div>
                </div>
              </div>

              {/* Profit Target Section */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Profit Target</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Profit Target Value</label>
                    <input
                      type="text"
                      value={propFirmProfitTarget}
                      onChange={(e) => setPropFirmProfitTarget(e.target.value)}
                      placeholder="8"
                      className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-800 dark:text-white focus:outline-none focus:border-zinc-400"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Profit Target Type</label>
                    <select
                      value={propFirmProfitTargetType}
                      onChange={(e) => setPropFirmProfitTargetType(e.target.value as any)}
                      className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-800 dark:text-white focus:outline-none focus:border-zinc-400"
                    >
                      <option value="PERCENTAGE">PERCENTAGE (%)</option>
                      <option value="AMOUNT">AMOUNT ($)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Daily Loss Section */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Daily Loss</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Daily Loss Limit *</label>
                    <input
                      type="text"
                      value={propFirmDailyLossLimit}
                      onChange={(e) => setPropFirmDailyLossLimit(e.target.value)}
                      placeholder="5"
                      className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-800 dark:text-white focus:outline-none focus:border-zinc-400"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Limit Type</label>
                    <select
                      value={propFirmDailyLossLimitType}
                      onChange={(e) => setPropFirmDailyLossLimitType(e.target.value as any)}
                      className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-800 dark:text-white focus:outline-none focus:border-zinc-400"
                    >
                      <option value="PERCENTAGE">PERCENTAGE (%)</option>
                      <option value="AMOUNT">AMOUNT ($)</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Calculation Basis</label>
                    <select
                      value={propFirmDailyLossCalcBasis}
                      onChange={(e) => setPropFirmDailyLossCalcBasis(e.target.value as any)}
                      className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-800 dark:text-white focus:outline-none focus:border-zinc-400"
                    >
                      <option value="BALANCE">BALANCE</option>
                      <option value="EQUITY">EQUITY</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Daily Reset Time</label>
                    <input
                      type="text"
                      value={propFirmDailyResetTime}
                      onChange={(e) => setPropFirmDailyResetTime(e.target.value)}
                      placeholder="00:00"
                      className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-800 dark:text-white focus:outline-none focus:border-zinc-400"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Reset Timezone</label>
                    <input
                      type="text"
                      value={propFirmDailyResetTimezone}
                      onChange={(e) => setPropFirmDailyResetTimezone(e.target.value)}
                      placeholder="UTC"
                      className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-800 dark:text-white focus:outline-none focus:border-zinc-400"
                    />
                  </div>
                </div>
              </div>

              {/* Drawdown Section */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Drawdown</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Maximum Drawdown *</label>
                    <input
                      type="text"
                      value={propFirmMaxDrawdown}
                      onChange={(e) => setPropFirmMaxDrawdown(e.target.value)}
                      placeholder="10"
                      className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-800 dark:text-white focus:outline-none focus:border-zinc-400"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Drawdown Type</label>
                    <select
                      value={propFirmDrawdownType}
                      onChange={(e) => setPropFirmDrawdownType(e.target.value as any)}
                      className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-800 dark:text-white focus:outline-none focus:border-zinc-400"
                    >
                      <option value="STATIC">STATIC</option>
                      <option value="TRAILING">TRAILING</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Calculation Basis</label>
                    <select
                      value={propFirmDrawdownCalcBasis}
                      onChange={(e) => setPropFirmDrawdownCalcBasis(e.target.value as any)}
                      className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-800 dark:text-white focus:outline-none focus:border-zinc-400"
                    >
                      <option value="BALANCE">BALANCE</option>
                      <option value="EQUITY">EQUITY</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Risk Section */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Risk</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Risk Per Trade *</label>
                    <input
                      type="text"
                      value={propFirmRiskPerTrade}
                      onChange={(e) => setPropFirmRiskPerTrade(e.target.value)}
                      placeholder="1"
                      className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-800 dark:text-white focus:outline-none focus:border-zinc-400"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Risk Type</label>
                    <select
                      value={propFirmRiskPerTradeType}
                      onChange={(e) => setPropFirmRiskPerTradeType(e.target.value as any)}
                      className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-800 dark:text-white focus:outline-none focus:border-zinc-400"
                    >
                      <option value="PERCENTAGE">PERCENTAGE (%)</option>
                      <option value="AMOUNT">AMOUNT ($)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Trading Limits */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Trading Limits</h3>
                <div className="grid grid-cols-1 sm:grid-cols-1 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Maximum Trades Per Day (blank for unlimited)</label>
                    <input
                      type="number"
                      value={propFirmMaxTradesPerDay}
                      onChange={(e) => setPropFirmMaxTradesPerDay(e.target.value)}
                      placeholder="e.g. 3"
                      className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-800 dark:text-white focus:outline-none focus:border-zinc-400"
                    />
                  </div>
                </div>
              </div>

              {/* News Restriction */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">News Restriction</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                  <div className="space-y-1.5 flex items-center gap-3 pt-4">
                    <input
                      type="checkbox"
                      id="newsRest"
                      checked={propFirmNewsRestriction}
                      onChange={(e) => setPropFirmNewsRestriction(e.target.checked)}
                      className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-0 cursor-pointer"
                    />
                    <label htmlFor="newsRest" className="text-xs font-bold text-zinc-700 dark:text-zinc-300 cursor-pointer">Enable News Restriction</label>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Mins Before News</label>
                    <input
                      type="number"
                      value={propFirmNewsBufferBefore}
                      onChange={(e) => setPropFirmNewsBufferBefore(e.target.value)}
                      className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-800 dark:text-white focus:outline-none focus:border-zinc-400"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Mins After News</label>
                    <input
                      type="number"
                      value={propFirmNewsBufferAfter}
                      onChange={(e) => setPropFirmNewsBufferAfter(e.target.value)}
                      className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-800 dark:text-white focus:outline-none focus:border-zinc-400"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {accountType && (
            <div className="space-y-8 pt-4 border-t border-zinc-100 dark:border-zinc-900 animate-fade-in">
              {/* Position Sizing Mode Selection */}
              <div className="space-y-2.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Position Size Mode</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPositionMode('AUTO_RISK')}
                    className={`p-3 rounded-2xl border text-center transition-all cursor-pointer text-xs font-bold ${
                      positionMode === 'AUTO_RISK'
                        ? 'bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-950 dark:border-zinc-100 shadow-sm'
                        : 'bg-white dark:bg-zinc-950/40 border-zinc-200 dark:border-zinc-900 text-zinc-500 hover:border-zinc-400 dark:hover:border-zinc-800'
                    }`}
                  >
                    Auto Risk (%)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPositionMode('FIXED_LOT')}
                    className={`p-3 rounded-2xl border text-center transition-all cursor-pointer text-xs font-bold ${
                      positionMode === 'FIXED_LOT'
                        ? 'bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-950 dark:border-zinc-100 shadow-sm'
                        : 'bg-white dark:bg-zinc-950/40 border-zinc-200 dark:border-zinc-900 text-zinc-500 hover:border-zinc-400 dark:hover:border-zinc-800'
                    }`}
                  >
                    Fixed Lot
                  </button>
                </div>
                
                {positionMode === 'FIXED_LOT' && (
                  <div className="space-y-1.5 mt-2 animate-fade-in">
                    <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Fixed Lot Size</label>
                    <input
                      type="text"
                      value={fixedLotSize}
                      onChange={(e) => setFixedLotSize(e.target.value)}
                      placeholder="e.g. 0.05 or 0.20"
                      className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 focus:border-zinc-400 dark:focus:border-zinc-700 rounded-2xl px-4 py-2.5 text-xs font-semibold text-zinc-800 dark:text-white focus:outline-none shadow-sm transition-colors"
                    />
                  </div>
                )}
              </div>

              {/* Risk : Reward Ratio Input */}
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Risk : Reward Ratio</label>
                <input
                  type="text"
                  value={riskReward}
                  onChange={(e) => setRiskReward(e.target.value)}
                  placeholder="e.g. 1:2 or 1:3"
                  className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 focus:border-zinc-400 dark:focus:border-zinc-700 rounded-2xl px-4 py-3 text-xs font-semibold text-zinc-800 dark:text-white focus:outline-none shadow-sm transition-colors"
                />
              </div>

              {/* Preferred Session */}
              <div className="space-y-2.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Preferred Session</label>
                <div className="flex flex-wrap gap-2">
                  {['London', 'New York', 'Tokyo', 'Sydney'].map(session => {
                    const isChecked = preferredSessions.includes(session);
                    return (
                      <button
                        key={session}
                        onClick={() => toggleSession(session)}
                        className={`px-4 py-2 rounded-full text-xs font-semibold border flex items-center gap-1.5 transition-all cursor-pointer ${
                          isChecked
                            ? 'bg-zinc-950 dark:bg-zinc-100/5 text-white dark:text-white border-zinc-950 dark:border-zinc-300 shadow-sm'
                            : 'bg-white dark:bg-zinc-950/40 text-zinc-500 border-zinc-200 dark:border-zinc-900 hover:border-zinc-400 dark:hover:border-zinc-800'
                        }`}
                      >
                        {isChecked && <Check className="w-3 h-3 text-white stroke-[3]" />}
                        <span>{session}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Preferred Timeframes */}
              <div className="space-y-2.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Preferred Timeframes</label>
                <div className="flex flex-wrap gap-2">
                  {['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'Daily'].map(tf => {
                    const isChecked = preferredTimeframes.includes(tf);
                    return (
                      <button
                        key={tf}
                        onClick={() => toggleTimeframe(tf)}
                        className={`w-11 h-11 rounded-full text-xs font-semibold border flex items-center justify-center transition-all cursor-pointer ${
                          isChecked
                            ? 'bg-zinc-950 dark:bg-zinc-100/5 text-white dark:text-white border-zinc-950 dark:border-zinc-300 shadow-sm'
                            : 'bg-white dark:bg-zinc-950/40 text-zinc-500 border-zinc-200 dark:border-zinc-900 hover:border-zinc-400 dark:hover:border-zinc-800'
                        }`}
                      >
                        {tf}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Save Preferences Trigger */}
              <button
                disabled={!isPrefsDirty}
                onClick={savePreferences}
                className={`w-full flex items-center justify-center gap-2 px-5 py-3 rounded-full transition-all shadow-md mt-4 ${
                  isPrefsDirty
                    ? 'bg-zinc-950 dark:bg-white text-white dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-200 cursor-pointer'
                    : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 cursor-not-allowed opacity-70'
                }`}
              >
                <Check className={`w-3.5 h-3.5 stroke-[2.5] ${isPrefsDirty ? 'text-white dark:text-zinc-950' : 'text-zinc-400 dark:text-zinc-500'}`} />
                <span>Save Preferences</span>
              </button>
            </div>
          )}
        </div>
      </div>
      </>
      )}

    </div>
  );
};

export default StrategyTab;
