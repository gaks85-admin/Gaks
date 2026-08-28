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
  AlertCircle,
  XCircle
} from 'lucide-react';
import { GEMINI_API_KEY_URL, GeminiTestResult, classifyCredentialType } from '../lib/apiKeys.js';

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
    <div className="space-y-8 sm:space-y-10 pb-28">
      
      {/* Premium Profile Header Card - Centered Design */}
      <div className="relative p-6 sm:p-10 rounded-3xl sm:rounded-[40px] border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#121214] shadow-sm sm:shadow-md">
        <div className="relative flex flex-col items-center text-center space-y-6">
          {/* Avatar Container */}
          <div className="relative group">
            <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center text-zinc-900 dark:text-white text-3xl sm:text-4xl font-bold uppercase shadow-xs">
              {profileAvatarUrl ? (
                <img src={profileAvatarUrl} alt="" className="w-full h-full object-cover rounded-3xl" referrerPolicy="no-referrer" />
              ) : (
                <span className="text-zinc-900 dark:text-zinc-100">
                  {profileFullName ? profileFullName.charAt(0) : 'U'}
                </span>
              )}
            </div>
            {/* Status Ring */}
            <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-2xl bg-white dark:bg-[#0c0c0e] border border-zinc-200 dark:border-zinc-800 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-col items-center gap-2">
              <h2 className="text-2xl sm:text-3xl font-semibold text-zinc-950 dark:text-white tracking-tighter font-display">{profileFullName || 'Gaks User'}</h2>
              <div className="flex items-center gap-2">
                <span className="inline-flex px-3 py-1 rounded-full bg-zinc-200 dark:bg-zinc-800/50 border border-zinc-300 dark:border-zinc-700/50 text-zinc-800 dark:text-zinc-200 text-[10px] font-bold uppercase tracking-widest">
                  {profilePlan || 'Free'} Plan
                </span>
                <div className="w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-800"></div>
                <p className="text-zinc-500 text-xs font-medium tracking-tight">{session?.user?.email}</p>
              </div>
            </div>
            
            <div className="pt-2 flex items-center justify-center gap-3">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
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
          
          <form onSubmit={handleUpdateProfile} className="p-5 sm:p-8 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0c0c0e] space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 block ml-1">Full Name</label>
                <div className="relative rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus-within:border-zinc-400 dark:focus-within:border-zinc-600 transition-colors">
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
                <div className="relative rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus-within:border-zinc-400 dark:focus-within:border-zinc-600 transition-colors">
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
                        className={`w-full text-left p-4 rounded-2xl border transition-colors relative ${
                          isSelected
                            ? 'bg-zinc-950 dark:bg-zinc-900 text-white border-zinc-950 dark:border-zinc-600 shadow-xs'
                            : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-300'
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
                                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 text-[8px] font-bold uppercase tracking-widest">
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
                                className="mt-2 px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-400 text-[9px] font-bold uppercase tracking-wider cursor-not-allowed opacity-60"
                              >
                                Upgrade Soon
                              </button>
                            )}
                          </div>
                        </div>
                        {isSelected && (
                          <div className="absolute top-2 right-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
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
              className="w-full flex items-center justify-center gap-2 px-5 py-4 rounded-full bg-zinc-900 dark:bg-white text-xs font-bold text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors cursor-pointer disabled:opacity-50"
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

        {/* AI Configuration / Gemini API Credential Section */}
        <div className="space-y-8">
          <div className="space-y-6">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <h3 className="text-xs font-bold text-zinc-900 dark:text-white uppercase tracking-widest">Gemini API Credential</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Gemini:</span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-[11px] font-semibold">
                  {geminiStatus === 'connected' && (
                    <>
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      <span className="text-emerald-600 dark:text-emerald-400">Connected</span>
                    </>
                  )}
                  {geminiStatus === 'quota_exhausted' && (
                    <>
                      <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                      <span className="text-amber-600 dark:text-amber-400">Quota exhausted</span>
                    </>
                  )}
                  {(geminiStatus === 'permission_denied' || geminiStatus === 'PERMISSION_ERROR') && (
                    <>
                      <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                      <span className="text-rose-600 dark:text-rose-400">Permission denied (403)</span>
                    </>
                  )}
                  {(geminiStatus === 'invalid' || geminiStatus === 'INVALID_KEY') && (
                    <>
                      <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                      <span className="text-rose-600 dark:text-rose-400">Invalid key</span>
                    </>
                  )}
                  {geminiStatus === 'temporary_error' && (
                    <>
                      <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                      <span className="text-amber-600 dark:text-amber-400">Temporary Error (503)</span>
                    </>
                  )}
                  {geminiStatus === 'timeout' && (
                    <>
                      <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                      <span className="text-amber-600 dark:text-amber-400">Timeout</span>
                    </>
                  )}
                  {geminiStatus === 'database_error' && (
                    <>
                      <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                      <span className="text-rose-600 dark:text-rose-400">Database Error</span>
                    </>
                  )}
                  {geminiStatus === 'network_error' && (
                    <>
                      <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                      <span className="text-rose-600 dark:text-rose-400">Network Error</span>
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
            
            <div className="p-5 sm:p-8 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0c0c0e] space-y-6">
              <div className="space-y-3">
                <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed font-medium">
                  Gaks AI supports current Gemini authorization keys (<code className="text-amber-600 dark:text-amber-400 font-mono">AQ...</code>) and standard Gemini API keys (<code className="text-amber-600 dark:text-amber-400 font-mono">AIza...</code>).
                </p>

                {/* Official Google AI Studio API Key URL */}
                <div>
                  <a
                    href={GEMINI_API_KEY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs font-bold transition-colors cursor-pointer"
                  >
                    <span>Get Gemini API Key →</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* 3-Step Guided Onboarding Helper */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                <div className="p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-1">
                  <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest">Step 1 — Get credential</div>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-snug">Open Google AI Studio and copy your Gemini API key or authorization credential.</p>
                </div>
                <div className="p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-1">
                  <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest">Step 2 — Paste credential</div>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-snug">Paste your key below. Both standard and authorization formats are accepted.</p>
                </div>
                <div className="p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-1">
                  <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest">Step 3 — Verify & Save</div>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-snug">Test the credential before saving. Only authenticated credentials can be saved.</p>
                </div>
              </div>

              {/* 403 Permission Denied Troubleshooting Alert */}
              {(geminiStatus === 'permission_denied' || geminiStatus === 'PERMISSION_ERROR' || geminiTestResult?.status === 'permission_denied' || geminiSaveError?.includes('denied access')) && (
                <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 space-y-2 text-xs">
                  <div className="flex items-center gap-2 font-bold text-rose-800 dark:text-rose-200">
                    <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                    <span>Google Project Denied Access (403 Permission Denied)</span>
                  </div>
                  <p className="leading-relaxed text-zinc-700 dark:text-zinc-300">
                    Google rejected your API key because its linked Google Cloud project was restricted or does not have Generative Language API access enabled.
                  </p>
                  <div className="pt-1 font-semibold text-rose-800 dark:text-rose-200">
                    Recommended Fix:
                  </div>
                  <ol className="list-decimal pl-5 space-y-1 leading-relaxed text-zinc-700 dark:text-zinc-300">
                    <li>Open <a href={GEMINI_API_KEY_URL} target="_blank" rel="noopener noreferrer" className="underline font-bold text-amber-600 dark:text-amber-400">Google AI Studio API Keys</a>.</li>
                    <li>Click <strong>&quot;Create API key&quot;</strong> and select <strong>&quot;Create API key in new project&quot;</strong> (creating a new project bypasses restrictions on your previous project).</li>
                    <li>Paste the new API key below and click <strong>&quot;Save &amp; Test&quot;</strong>.</li>
                  </ol>
                </div>
              )}

              {/* Key Input & Actions */}
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Gemini Credential</label>
                    {geminiKey.trim() && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                        {classifyCredentialType(geminiKey) === 'authorization' ? 'Authorization Key (AQ...)' : classifyCredentialType(geminiKey) === 'standard' ? 'Standard API Key (AIza...)' : 'Custom Credential'}
                      </span>
                    )}
                  </div>
                  <div className="relative rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus-within:border-zinc-400 dark:focus-within:border-zinc-600 transition-colors flex items-center pr-2">
                    <input
                      type={showKeyText ? "text" : "password"}
                      value={geminiKey}
                      onChange={(e) => setGeminiKey(e.target.value)}
                      placeholder="Paste your Gemini API key or authorization credential"
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
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <button
                    type="button"
                    onClick={handleTestGeminiKey}
                    disabled={isGeminiKeyTesting || isGeminiKeySaving || !geminiKey.trim()}
                    className="w-full sm:w-1/2 flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-bold text-zinc-900 dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isGeminiKeyTesting ? (
                      <>
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-zinc-900 dark:border-white border-t-transparent animate-spin"></div>
                        <span>Testing Credential...</span>
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
                    className="w-full sm:w-1/2 flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-zinc-900 dark:bg-white text-xs font-bold text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
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
                    geminiTestResult.status === 'connected' || geminiTestResult.success
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                      : geminiTestResult.status === 'quota_exhausted' || geminiTestResult.status === 'temporary_error' || geminiTestResult.status === 'timeout'
                      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                      : 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                  }`}>
                    <span>
                      {geminiTestResult.success
                        ? `${geminiTestResult.message} (${geminiTestResult.credentialType === 'authorization' ? 'Authorization Key' : 'Standard Key'})`
                        : geminiTestResult.message}
                    </span>
                  </div>
                )}

                {geminiSaveError && (
                  <div className="p-3.5 rounded-2xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs font-medium">
                    {geminiSaveError}
                  </div>
                )}

                {geminiSaveSuccess && (
                  <div className="p-3.5 rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-medium">
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
                
                <div className="p-5 sm:p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0c0c0e] flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-zinc-900 dark:text-white">Interface Theme</div>
                    <div className="text-[11px] text-zinc-500">Currently set to {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}</div>
                  </div>

                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-bold text-zinc-900 dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer flex items-center gap-2"
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
          className="w-full md:w-auto px-8 py-4 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-bold text-zinc-700 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out of Session</span>
        </button>
        
        <div className="flex-1 p-5 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0c0c0e] flex items-center gap-3">
          <Shield className="w-4 h-4 text-zinc-400 dark:text-zinc-600 shrink-0" />
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
            Identity managed by Supabase Auth. Data isolated via RLS policies.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SettingsTab;

