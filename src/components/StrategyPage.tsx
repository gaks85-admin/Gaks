import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase-client.js';
import { TradingPreferences, AccountType } from '../lib/types.js';
import { Shield, AlertCircle, CheckCircle2, Sliders, DollarSign, Clock } from 'lucide-react';

interface StrategyPageProps {
  userId?: string;
}

export const StrategyPage: React.FC<StrategyPageProps> = ({ userId = 'demo-user-1' }) => {
  const [accountType, setAccountType] = useState<AccountType>('personal');
  const [customCapital, setCustomCapital] = useState<string>('10000');
  const [preferredRisk, setPreferredRisk] = useState<string>('1%');
  const [riskReward, setRiskReward] = useState<string>('1:2');
  const [maxDailyRisk, setMaxDailyRisk] = useState<string>('3%');
  const [strategySummary, setStrategySummary] = useState<string>('');

  // Personal Account News Protection
  const [newsEnabled, setNewsEnabled] = useState<boolean>(false);
  const [bufferBefore, setBufferBefore] = useState<number>(30);
  const [bufferAfter, setBufferAfter] = useState<number>(30);

  // Baseline state for dirty check
  const [baseline, setBaseline] = useState<{
    accountType: AccountType;
    customCapital: string;
    preferredRisk: string;
    riskReward: string;
    maxDailyRisk: string;
    strategySummary: string;
    newsEnabled: boolean;
    bufferBefore: number;
    bufferAfter: number;
  }>({
    accountType: 'personal',
    customCapital: '10000',
    preferredRisk: '1%',
    riskReward: '1:2',
    maxDailyRisk: '3%',
    strategySummary: '',
    newsEnabled: false,
    bufferBefore: 30,
    bufferAfter: 30,
  });

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch preferences on mount
  useEffect(() => {
    async function loadPreferences() {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('trading_preferences')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();

        if (error) {
          console.error('Error fetching preferences:', error);
        } else if (data) {
          const type = (data.account_type || 'personal') as AccountType;
          const cap = data.custom_capital || '10000';
          const risk = data.preferred_risk || '1%';
          const rr = data.risk_reward_ratio || '1:2';
          const maxRisk = data.max_daily_risk || '3%';
          const summary = data.strategy_summary || '';
          const nEnabled = Boolean(data.news_restriction_enabled);
          const bBefore = typeof data.news_buffer_before_minutes === 'number' ? data.news_buffer_before_minutes : 30;
          const bAfter = typeof data.news_buffer_after_minutes === 'number' ? data.news_buffer_after_minutes : 30;

          setAccountType(type);
          setCustomCapital(cap);
          setPreferredRisk(risk);
          setRiskReward(rr);
          setMaxDailyRisk(maxRisk);
          setStrategySummary(summary);
          setNewsEnabled(nEnabled);
          setBufferBefore(bBefore);
          setBufferAfter(bAfter);

          setBaseline({
            accountType: type,
            customCapital: cap,
            preferredRisk: risk,
            riskReward: rr,
            maxDailyRisk: maxRisk,
            strategySummary: summary,
            newsEnabled: nEnabled,
            bufferBefore: bBefore,
            bufferAfter: bAfter,
          });
        }
      } catch (err: any) {
        console.error('Failed to load preferences:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadPreferences();
  }, [userId]);

  // Determine dirty state
  const isDirty =
    accountType !== baseline.accountType ||
    customCapital !== baseline.customCapital ||
    preferredRisk !== baseline.preferredRisk ||
    riskReward !== baseline.riskReward ||
    maxDailyRisk !== baseline.maxDailyRisk ||
    strategySummary !== baseline.strategySummary ||
    newsEnabled !== baseline.newsEnabled ||
    bufferBefore !== baseline.bufferBefore ||
    bufferAfter !== baseline.bufferAfter;

  const handleSave = async () => {
    setErrorMessage(null);
    setSaveSuccess(false);

    // Validation
    if (bufferBefore < 0 || bufferBefore > 1440 || !Number.isInteger(bufferBefore)) {
      setErrorMessage('Buffer before must be an integer between 0 and 1440 minutes.');
      return;
    }

    if (bufferAfter < 0 || bufferAfter > 1440 || !Number.isInteger(bufferAfter)) {
      setErrorMessage('Buffer after must be an integer between 0 and 1440 minutes.');
      return;
    }

    setIsSaving(true);
    try {
      const payload: Partial<TradingPreferences> = {
        user_id: userId,
        account_type: accountType,
        custom_capital: customCapital,
        preferred_risk: preferredRisk,
        risk_reward_ratio: riskReward,
        max_daily_risk: maxDailyRisk,
        strategy_summary: strategySummary,
        news_restriction_enabled: newsEnabled,
        news_buffer_before_minutes: bufferBefore,
        news_buffer_after_minutes: bufferAfter,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('trading_preferences')
        .upsert(payload, { onConflict: 'user_id' });

      if (error) {
        throw error;
      }

      setBaseline({
        accountType,
        customCapital,
        preferredRisk,
        riskReward,
        maxDailyRisk,
        strategySummary,
        newsEnabled,
        bufferBefore,
        bufferAfter,
      });

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err: any) {
      console.error('Failed to save preferences:', err);
      setErrorMessage(err.message || 'Failed to save preferences.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-400">
        <Clock className="w-6 h-6 animate-spin mr-2" />
        Loading strategy preferences...
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Sliders className="w-6 h-6 text-emerald-400" />
            Strategy & Risk Configuration
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Configure risk management, position sizing, and economic news protection rules.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAccountType('personal')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              accountType === 'personal'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'bg-slate-900 text-slate-400 border border-slate-800 hover:bg-slate-800'
            }`}
          >
            Personal Account
          </button>
          <button
            onClick={() => setAccountType('prop')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              accountType === 'prop'
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                : 'bg-slate-900 text-slate-400 border border-slate-800 hover:bg-slate-800'
            }`}
          >
            Prop Firm Account
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-sm flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {saveSuccess && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-sm flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>Preferences saved successfully. Watcher execution parameters updated.</span>
        </div>
      )}

      {/* Account Type Notice */}
      {accountType === 'prop' ? (
        <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl text-blue-300 text-sm">
          <p className="font-semibold mb-1">Prop Firm Authority Active</p>
          <p className="text-slate-300">
            For Prop Firm accounts, account sizing and hard risk parameters are authoritatively controlled by your dedicated Prop Firm Settings. Personal account news settings do not override Prop Firm rules.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Sizing & Risk Controls */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-emerald-400" />
              Personal Account Capital & Risk
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Custom Capital ($)</label>
                <input
                  type="text"
                  value={customCapital}
                  onChange={(e) => setCustomCapital(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-emerald-500"
                  placeholder="10000"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Preferred Risk Per Trade</label>
                <input
                  type="text"
                  value={preferredRisk}
                  onChange={(e) => setPreferredRisk(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-emerald-500"
                  placeholder="1%"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Risk to Reward Ratio</label>
                <input
                  type="text"
                  value={riskReward}
                  onChange={(e) => setRiskReward(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-emerald-500"
                  placeholder="1:2"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Max Daily Risk / Loss ($)</label>
                <input
                  type="text"
                  value={maxDailyRisk}
                  onChange={(e) => setMaxDailyRisk(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-emerald-500"
                  placeholder="3%"
                />
              </div>
            </div>
          </div>

          {/* Personal Account News Protection */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-emerald-400" />
                  News Protection
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Automatically halt trade execution during scheduled high-impact economic news events.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={newsEnabled}
                  onChange={(e) => setNewsEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                <span className="ml-3 text-sm font-medium text-slate-200">
                  {newsEnabled ? 'Active' : 'Disabled'}
                </span>
              </label>
            </div>

            {newsEnabled ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-slate-800/80">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Pause Before News (minutes)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={bufferBefore}
                    onChange={(e) => setBufferBefore(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Blocks execution if high-impact news occurs within {bufferBefore}m.
                  </span>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Pause After News (minutes)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={bufferAfter}
                    onChange={(e) => setBufferAfter(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Prevents execution until {bufferAfter}m after high-impact news release.
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-slate-950/40 rounded-lg border border-slate-800/50 text-xs text-slate-500">
                News protection is currently OFF. Trades will execute regardless of economic calendar releases.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="flex justify-end pt-4 border-t border-slate-800">
        <button
          onClick={handleSave}
          disabled={!isDirty || isSaving}
          className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${
            isDirty && !isSaving
              ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20 cursor-pointer'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
          }`}
        >
          {isSaving ? 'Saving...' : 'Save Preferences'}
        </button>
      </div>
    </div>
  );
};
