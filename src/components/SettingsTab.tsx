import React, { useState } from 'react';
import { 
  Shield, 
  User as UserIcon, 
  Check, 
  LogOut, 
  Sparkles,
  Sun,
  Moon,
  ExternalLink,
  Eye,
  EyeOff,
  CheckCircle2,
  Trash2,
  AlertTriangle,
  XCircle
} from 'lucide-react';
import { GEMINI_API_KEY_URL, GeminiTestResult } from '../lib/apiKeys.js';

export interface SettingsTabProps {
  profileAvatarUrl: string;
  setProfileAvatarUrl: (val: string) => void;
  profileFullName: string;
  setProfileFullName: (val: string) => void;
  profilePlan: string;
  setProfilePlan?: (val: string) => void;
  session: any;
  handleUpdateProfile: (e: React.FormEvent) => void;
  isProfileUpdating: boolean;
  geminiKey: string;
  setGeminiKey: (val: string) => void;
  geminiKeyExists: boolean;
  handleSaveGeminiKey: () => void;
  isGeminiKeySaving: boolean;
  handleLogout: () => void;
  theme?: 'light' | 'dark';
  toggleTheme?: () => void;
  // Gemini Onboarding Props
  handleTestGeminiKey?: () => void;
  isGeminiKeyTesting?: boolean;
  geminiTestResult?: GeminiTestResult | null;
  geminiStatus?: 'connected' | 'not_connected' | 'quota_exhausted' | 'invalid' | 'connection_failed' | string;
  handleDeleteGeminiKey?: () => void;
  geminiSaveError?: string | null;
  geminiSaveSuccess?: string | null;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  profileAvatarUrl,
  setProfileAvatarUrl,
  profileFullName,
  setProfileFullName,
  profilePlan,
  setProfilePlan,
  session,
  handleUpdateProfile,
  isProfileUpdating,
  geminiKey,
  setGeminiKey,
  geminiKeyExists,
  handleSaveGeminiKey,
  isGeminiKeySaving,
  handleLogout,
  theme = 'dark',
  toggleTheme,
  handleTestGeminiKey,
  isGeminiKeyTesting = false,
  geminiTestResult = null,
  geminiStatus = 'not_connected',
  handleDeleteGeminiKey,
  geminiSaveError = null,
  geminiSaveSuccess = null,
}) => {
  const [showKeyText, setShowKeyText] = useState(false);

  return (
    <div className="space-y-10 animate-fade-in pb-20">
      
      {/* Premium Profile Header Card - Centered Design */}
      <div className="relative p-10 rounded-[40px] border border-zinc-200 dark:border-zinc-800/50 bg-gradient-to-b from-zinc-50 to-white dark:from-[#121214] dark:to-[#08080a] overflow-hidden shadow-2xl">
        {/* Subtle glow effect */}
        <div className="absolute -top-20 -left-20 w-64 h-64 bg-zinc-500/5 blur-[100px] rounded-full"></div>
        <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-zinc-500/5 blur-[100px] rounded-full"></div>
        
        <div className="relative flex flex-col items-center text-center space-y-6">
          {/* Avatar Container */}
          <div className="relative group">
            <div className="w-28 h-28 rounded-[32px] bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/80 flex items-center justify-center text-zinc-900 dark:text-white text-4xl font-bold uppercase overflow-hidden shadow-2xl group-hover:border-zinc-300 dark:group-hover:border-zinc-700 transition-all duration-500">
              {profileAvatarUrl ? (
                <img src={profileAvatarUrl} alt="" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" referrerPolicy="no-referrer" />
              ) : (
                <span className="bg-gradient-to-br from-zinc-950 to-zinc-600 dark:from-white dark:to-zinc-400 bg-clip-text text-transparent">
                  {profileFullName ? profileFullName.charAt(0) : 'U'}
                </span>
              )}
            </div>
            {/* Status Ring */}
            <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-2xl bg-white dark:bg-[#0c0c0e] border border-zinc-200 dark:border-zinc-800 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.6)]"></div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-col items-center gap-2">
              <h2 className="text-3xl font-semibold text-zinc-950 dark:text-white tracking-tighter font-display">{profileFullName || 'Gaks User'}</h2>
              <div className="flex items-center gap-2">
                <span className="inline-flex px-3 py-1 rounded-full bg-zinc-200 dark:bg-zinc-800/50 border border-zinc-300 dark:border-zinc-700/50 text-zinc-800 dark:text-zinc-200 text-[10px] font-bold uppercase tracking-widest">
                  {profilePlan || 'Free'} Plan
                </span>
                <div className="w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-800"></div>
                <p className="text-zinc-500 text-xs font-medium tracking-tight">{session?.user?.email}</p>
              </div>
            </div>
            
            <div className="pt-2 flex items-center justify-center gap-3">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-100/50 dark:bg-zinc-950/40 border border-zinc-200 dark:border-zinc-900/50">
                <Shield className="w-3 h-3 text-zinc-400" />
                <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Database Synced</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Profile Form */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 px-1">
            <UserIcon className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
            <h3 className="text-xs font-bold text-zinc-900 dark:text-white uppercase tracking-widest">Profile Configuration</h3>
          </div>
          
          <form onSubmit={handleUpdateProfile} className="p-8 rounded-[32px] border border-zinc-100 dark:border-zinc-900 bg-zinc-50/50 dark:bg-[#0c0c0e]/60 space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 block ml-1">Full Name</label>
                <div className="relative rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/40 focus-within:border-zinc-400 dark:focus-within:border-zinc-700 transition-all overflow-hidden">
                  <input
                    type="text"
                    value={profileFullName}
                    onChange={(e) => setProfileFullName(e.target.value)}
                    placeholder="Your full name"
                    required
                    className="w-full bg-transparent border-0 px-4 py-3.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:ring-0 font-medium"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 block ml-1">Profile Image URL</label>
                <div className="relative rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/40 focus-within:border-zinc-400 dark:focus-within:border-zinc-700 transition-all overflow-hidden">
                  <input
                    type="url"
                    value={profileAvatarUrl}
                    onChange={(e) => setProfileAvatarUrl(e.target.value)}
                    placeholder="https://images.unsplash.com/photo-..."
                    className="w-full bg-transparent border-0 px-4 py-3.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:ring-0 font-medium"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 block ml-1">Gaks Subscription Tier</label>
                  <span className="text-[10px] text-zinc-400 font-medium">Stripe Payment Gateway Pending</span>
                </div>
                <div className="space-y-3">
                  {[
                    { id: 'Free', price: '$0', desc: 'Basic market scanning, decision engine analysis, and single-pair active watcher.' },
                    { id: 'Premium', price: '$29', desc: 'Advanced AI watchers, higher throughput, and real-time Telegram alerts.' },
                    { id: 'Premium Pro', price: '$99', desc: 'Enterprise-grade execution engine, custom signal logic, and priority feeds.' }
                  ].map((plan) => {
                    const isSelected = (profilePlan || 'Free') === plan.id;
                    const isPaid = plan.id !== 'Free';
                    return (
                      <div
                        key={plan.id}
                        className={`w-full text-left p-4 rounded-2xl border transition-all relative ${
                          isSelected
                            ? 'bg-zinc-950 dark:bg-zinc-900/60 text-white border-zinc-950 dark:border-zinc-500 shadow-md'
                            : 'bg-white dark:bg-zinc-950/20 border-zinc-200 dark:border-zinc-800/80 text-zinc-900 dark:text-zinc-300 opacity-90'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-[13px] font-bold tracking-tight ${isSelected ? 'text-white' : 'text-zinc-900 dark:text-zinc-300'}`}>
                                {plan.id}
                              </span>
                              {isSelected ? (
                                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[8px] font-bold uppercase tracking-widest">
                                  Current Plan
                                </span>
                              ) : isPaid ? (
                                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/60 text-zinc-600 dark:text-zinc-400 text-[8px] font-bold uppercase tracking-widest">
                                  Stripe Required
                                </span>
                              ) : null}
                            </div>
                            <p className={`text-[10px] font-medium leading-relaxed max-w-[210px] ${isSelected ? 'text-zinc-400' : 'text-zinc-500'}`}>
                              {plan.desc}
                            </p>
                          </div>
                          <div className="text-right flex flex-col items-end">
                            <div className={`text-[15px] font-bold tracking-tight ${isSelected ? 'text-white' : 'text-zinc-900 dark:text-zinc-100'}`}>
                              {plan.price}
                            </div>
                            <div className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Per Month</div>
                            {!isSelected && isPaid && (
                              <button
                                type="button"
                                disabled
                                title="Paid subscription via Stripe integration coming soon"
                                className="mt-2 px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/50 text-zinc-400 text-[9px] font-bold uppercase tracking-wider cursor-not-allowed opacity-60"
                              >
                                Upgrade Soon
                              </button>
                            )}
                          </div>
                        </div>
                        {isSelected && (
                          <div className="absolute top-2 right-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,1)]"></div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-zinc-500 font-medium italic text-center pt-1">
                  All accounts default to the Free plan until verified Stripe payments are connected. Manual plan switching is disabled.
                </p>
              </div>
            </div>

            <button
              type="submit"
              disabled={isProfileUpdating}
              className="w-full flex items-center justify-center gap-2 px-5 py-4 rounded-full bg-zinc-900 dark:bg-white text-xs font-bold text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all cursor-pointer disabled:opacity-50"
            >
              {isProfileUpdating ? (
                <div className="w-4 h-4 rounded-full border-2 border-white dark:border-black border-t-transparent animate-spin"></div>
              ) : (
                <>
                  <Check className="w-4 h-4 stroke-[2.5]" />
                  <span>Update Profile</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* AI Configuration / Gemini API Key Section */}
        <div className="space-y-8">
          <div className="space-y-6">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <h3 className="text-xs font-bold text-zinc-900 dark:text-white uppercase tracking-widest">Gemini API Key</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Gemini:</span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-[11px] font-semibold">
                  {geminiStatus === 'connected' && (
                    <>
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span className="text-emerald-600 dark:text-emerald-400">Connected</span>
                    </>
                  )}
                  {geminiStatus === 'quota_exhausted' && (
                    <>
                      <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                      <span className="text-amber-600 dark:text-amber-400">Quota exhausted</span>
                    </>
                  )}
                  {geminiStatus === 'invalid' && (
                    <>
                      <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                      <span className="text-rose-600 dark:text-rose-400">Invalid key</span>
                    </>
                  )}
                  {geminiStatus === 'connection_failed' && (
                    <>
                      <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                      <span className="text-rose-600 dark:text-rose-400">Connection failed</span>
                    </>
                  )}
                  {(geminiStatus === 'not_connected' || !geminiStatus) && (
                    <>
                      <span className="w-2 h-2 rounded-full bg-zinc-400"></span>
                      <span className="text-zinc-500 dark:text-zinc-400">Not connected</span>
                    </>
                  )}
                </span>
              </div>
            </div>
            
            <div className="p-8 rounded-[32px] border border-zinc-100 dark:border-zinc-900 bg-zinc-50/50 dark:bg-[#0c0c0e]/60 space-y-6">
              <div className="space-y-3">
                <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed font-medium">
                  Your Gemini API key allows Gaks AI to use Gemini when a market setup requires additional AI evaluation.
                </p>

                {/* Official Google AI Studio API Key URL */}
                <div>
                  <a
                    href={GEMINI_API_KEY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-amber-500/10 to-amber-600/10 hover:from-amber-500/20 hover:to-amber-600/20 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs font-bold transition-all shadow-xs group cursor-pointer"
                  >
                    <span>Get Gemini API Key →</span>
                    <ExternalLink className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                  </a>
                </div>
              </div>

              {/* 3-Step Guided Onboarding Helper */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                <div className="p-3.5 rounded-2xl bg-white dark:bg-zinc-950/40 border border-zinc-200/80 dark:border-zinc-800/80 space-y-1">
                  <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest">Step 1 — Get your key</div>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-snug">Open Google AI Studio and create a Gemini API key.</p>
                </div>
                <div className="p-3.5 rounded-2xl bg-white dark:bg-zinc-950/40 border border-zinc-200/80 dark:border-zinc-800/80 space-y-1">
                  <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest">Step 2 — Copy it</div>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-snug">Copy the generated API key.</p>
                </div>
                <div className="p-3.5 rounded-2xl bg-white dark:bg-zinc-950/40 border border-zinc-200/80 dark:border-zinc-800/80 space-y-1">
                  <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest">Step 3 — Paste it here</div>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-snug">Return to Gaks AI, paste the key, test it, and save it.</p>
                </div>
              </div>

              {/* Key Input & Actions */}
              <div className="space-y-4 pt-2">
                <div className="relative rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/40 focus-within:border-zinc-400 dark:focus-within:border-zinc-700 transition-all overflow-hidden flex items-center pr-2">
                  <input
                    type={showKeyText ? "text" : "password"}
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder="Paste your Gemini API key"
                    className="w-full bg-transparent border-0 px-4 py-3.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:ring-0 font-mono placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKeyText(!showKeyText)}
                    className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                    title={showKeyText ? "Hide key" : "Show key"}
                  >
                    {showKeyText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <button
                    type="button"
                    onClick={handleTestGeminiKey}
                    disabled={isGeminiKeyTesting || isGeminiKeySaving || !geminiKey.trim()}
                    className="w-full sm:w-1/2 flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-bold text-zinc-900 dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isGeminiKeyTesting ? (
                      <>
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-zinc-900 dark:border-white border-t-transparent animate-spin"></div>
                        <span>Testing Key...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        <span>Test API Key</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveGeminiKey}
                    disabled={isGeminiKeySaving || isGeminiKeyTesting || !geminiKey.trim()}
                    className="w-full sm:w-1/2 flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-zinc-900 dark:bg-white text-xs font-bold text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                  >
                    {isGeminiKeySaving ? (
                      <>
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-white dark:border-black border-t-transparent animate-spin"></div>
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>Save API Key</span>
                      </>
                    )}
                  </button>

                  {geminiKeyExists && handleDeleteGeminiKey && (
                    <button
                      type="button"
                      onClick={handleDeleteGeminiKey}
                      disabled={isGeminiKeySaving || isGeminiKeyTesting}
                      className="p-3 rounded-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 transition-colors cursor-pointer disabled:opacity-40 shrink-0"
                      title="Delete saved API key"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Feedback Badges */}
                {geminiTestResult && (
                  <div className={`p-3.5 rounded-2xl border text-xs font-semibold flex items-center gap-2 ${
                    geminiTestResult.status === 'connected'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                      : geminiTestResult.status === 'quota_exhausted'
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                  }`}>
                    <span>{geminiTestResult.message}</span>
                  </div>
                )}

                {geminiSaveError && !geminiTestResult && (
                  <div className="p-3.5 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-medium">
                    {geminiSaveError}
                  </div>
                )}

                {geminiSaveSuccess && !geminiTestResult && (
                  <div className="p-3.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                    {geminiSaveSuccess}
                  </div>
                )}
              </div>
            </div>
            
            {/* Appearance Section */}
            {toggleTheme && (
              <div className="space-y-4 pt-2">
                <div className="flex items-center gap-2 px-1">
                  <Sun className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
                  <h3 className="text-xs font-bold text-zinc-900 dark:text-white uppercase tracking-widest">Appearance</h3>
                </div>
                
                <div className="p-6 rounded-[28px] border border-zinc-100 dark:border-zinc-900 bg-zinc-50/50 dark:bg-[#0c0c0e]/60 flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-zinc-900 dark:text-white">Interface Theme</div>
                    <div className="text-[11px] text-zinc-500">Currently set to {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}</div>
                  </div>

                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-bold text-zinc-900 dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-all cursor-pointer flex items-center gap-2"
                  >
                    {theme === 'dark' ? (
                      <>
                        <Sun className="w-4 h-4 text-amber-500" />
                        <span>Light Mode</span>
                      </>
                    ) : (
                      <>
                        <Moon className="w-4 h-4 text-blue-500" />
                        <span>Dark Mode</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Actions */}
      <div className="flex flex-col md:flex-row items-center gap-4">
        <button
          onClick={handleLogout}
          className="w-full md:w-auto px-8 py-4 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-bold text-zinc-700 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white hover:border-zinc-300 dark:hover:border-zinc-700 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out of Session</span>
        </button>
        
        <div className="flex-1 p-5 rounded-3xl border border-zinc-200 dark:border-zinc-900 bg-zinc-50 dark:bg-zinc-950/20 flex items-center gap-3">
          <Shield className="w-4 h-4 text-zinc-400 dark:text-zinc-600 shrink-0" />
          <p className="text-[10px] text-zinc-500 dark:text-zinc-600 leading-relaxed">
            Identity managed by Supabase Auth. Data isolated via RLS policies.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SettingsTab;

