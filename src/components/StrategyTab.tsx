import React from 'react';
import { AlertTriangle, Check, Trash2, RefreshCw } from 'lucide-react';
import { Strategy } from '../types';

export interface StrategyTabProps {
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
  riskReward: string;
  setRiskReward: (val: string) => void;
  accountType: 'personal' | 'prop';
  setAccountType: (val: 'personal' | 'prop') => void;
  preferredSessions: string[];
  toggleSession: (session: string) => void;
  preferredTimeframes: string[];
  toggleTimeframe: (tf: string) => void;
  isPrefsDirty: boolean;
  savePreferences: () => void;
}

export const StrategyTab: React.FC<StrategyTabProps> = ({
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
  riskReward,
  setRiskReward,
  accountType,
  setAccountType,
  preferredSessions,
  toggleSession,
  preferredTimeframes,
  toggleTimeframe,
  isPrefsDirty,
  savePreferences,
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

      {/* Strategy Board & Editor */}
      <div className="grid grid-cols-1 gap-8">
        
        {/* Full Width Strategy Editor */}
        <div className="space-y-4">
          <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0c0c0e]/80 overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-900 flex flex-wrap items-center justify-between gap-3 bg-zinc-100/50 dark:bg-[#08080a]">
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${selectedStrat.id === activeStrategyId ? 'bg-white animate-pulse' : 'bg-zinc-600'}`}></span>
                <span className="text-xs font-bold text-zinc-700 dark:text-white uppercase tracking-wider">Strategy Editor</span>
              </div>

              <div className="flex items-center gap-2">
                {/* Delete Button */}
                <button
                  onClick={handleClearStrategy}
                  className="px-3 py-1.5 rounded-xl border border-red-950/20 dark:border-red-950/20 hover:border-red-500/40 bg-red-50 dark:bg-zinc-950/60 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-all cursor-pointer flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
                  title="Clear current strategy"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
                
                {/* Restore Button */}
                <button
                  onClick={handleRestoreStrategy}
                  className="px-3 py-1.5 rounded-xl border border-zinc-800 hover:border-zinc-700 bg-zinc-950/40 text-zinc-400 hover:text-white transition-all cursor-pointer flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
                  title="Restore last saved or default version"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Restore</span>
                </button>

                {selectedStrat.id === activeStrategyId ? (
                  <span className="text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-100 px-2.5 py-1 rounded-full font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-white"></span>
                    Active
                  </span>
                ) : (
                  <button
                    onClick={() => handleSetActiveStrategy(selectedStrat.id)}
                    className="px-3 py-1 text-[10px] bg-white text-black hover:bg-zinc-200 transition-all rounded-full font-bold uppercase tracking-wider cursor-pointer shadow-md"
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
                className="w-full min-h-[400px] bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-2xl p-6 text-[13px] text-zinc-800 dark:text-zinc-300 font-medium leading-relaxed resize-none font-sans focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-700 transition-colors shadow-sm"
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

      {/* Trading Preferences Card */}
      <div className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e]/80 space-y-6 shadow-sm">
        <div className="space-y-1">
          <h3 className="text-base font-bold text-zinc-950 dark:text-white font-display">Trading Preferences</h3>
          <p className="text-xs text-zinc-500">Tune how your AI sizes and times trades.</p>
        </div>

        <div className="space-y-5">
          
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
            <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Preferred Risk</label>
            <input
              type="text"
              value={preferredRisk}
              onChange={(e) => setPreferredRisk(e.target.value)}
              placeholder="e.g. 1% or 2.5%"
              className="w-full bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 focus:border-zinc-400 dark:focus:border-zinc-700 rounded-2xl px-4 py-3 text-xs font-semibold text-zinc-800 dark:text-white focus:outline-none shadow-sm transition-colors"
            />
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

          {/* Account Type (Personal or Prop Firm) */}
          <div className="space-y-2.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Account Type</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setAccountType('personal')}
                className={`p-4 rounded-2xl border text-center transition-all cursor-pointer ${
                  accountType === 'personal'
                    ? 'bg-zinc-50 dark:bg-zinc-100/5 border-zinc-300 dark:border-zinc-200 text-zinc-950 dark:text-white font-bold shadow-sm'
                    : 'bg-white dark:bg-zinc-950/40 border-zinc-200 dark:border-zinc-900 text-zinc-500 hover:border-zinc-400 dark:hover:border-zinc-800'
                }`}
              >
                <div className="text-xs font-semibold leading-relaxed">Personal</div>
                <div className="text-xs font-semibold leading-relaxed">Account</div>
              </button>
              <button
                onClick={() => setAccountType('prop')}
                className={`p-4 rounded-2xl border text-center transition-all cursor-pointer ${
                  accountType === 'prop'
                    ? 'bg-zinc-50 dark:bg-zinc-100/5 border-zinc-300 dark:border-zinc-200 text-zinc-950 dark:text-white font-bold shadow-sm'
                    : 'bg-white dark:bg-zinc-950/40 border-zinc-200 dark:border-zinc-900 text-zinc-500 hover:border-zinc-400 dark:hover:border-zinc-800'
                }`}
              >
                <div className="text-xs font-semibold leading-relaxed">Prop Firm</div>
                <div className="text-xs font-semibold leading-relaxed">Account</div>
              </button>
            </div>
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
      </div>

    </div>
  );
};

export default StrategyTab;
