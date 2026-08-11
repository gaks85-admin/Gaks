import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLiveRates } from './hooks/useLiveRates';
import { supabase } from './supabaseClient';
import { getGeminiKey, saveGeminiKey, deleteGeminiKey, testGeminiKey, GeminiTestResult, GeminiTestStatus } from './lib/apiKeys';
import { toCanonicalSymbol, toDisplaySymbol, normalizeSymbol } from '../lib/market-utils';
import { parseUserStrategy } from "./lib/strategy-parser";
import { compileStrategy } from './lib/strategy-compiler';

const Auth = React.lazy(() => import('./components/Auth'));
import { AuthSkeleton } from './components/Auth';
const ResetPassword = React.lazy(() => import('./components/ResetPassword'));
import AdminDashboard from './components/admin/AdminDashboard';
import { StrategyTab } from './components/StrategyTab';
import { WatcherTab } from './components/WatcherTab';
import { SettingsTab } from './components/SettingsTab';

const TabLoading = () => (
  <div className="space-y-8 animate-pulse p-4">
    <div className="h-8 bg-zinc-200 dark:bg-zinc-800 rounded w-1/3"></div>
    <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-2/3"></div>
    <div className="h-64 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
  </div>
);
import {
  Home as HomeIcon,
  TrendingUp,
  Eye,
  LogOut,
  RefreshCw,
  Zap,
  Check,
  Plus,
  Search,
  Trash2,
  X,
  Play,
  RotateCcw,
  CloudLightning,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  TrendingDown,
  ChevronRight,
  Info,
  AlertTriangle,
  User as UserIcon,
  Settings as SettingsIcon,
  Shield,
  CheckCircle2,
  Lock,
  Key,
  Send,
  Minus,
  CreditCard,
  Globe,
  Palette,
  ChevronDown,
  Sun,
  Moon,
  Monitor
} from 'lucide-react';

import { getTelegramConnection, initiateTelegramConnection, getTelegramDeepLink } from './lib/telegram';
import { ForexPair, WatchlistItem, Strategy } from './types';


// Interfaces

const GAKS_DEFAULT_STRATEGY: Strategy = {
  id: 'default',
  name: 'Gaks AI Default Strategy',
  isDefault: true,
  text: `# Gaks AI Default Strategy

## 1. Overview
This is the default, institutional-grade multi-timeframe strategy designed for capturing consistent intraday trends in liquid assets (Forex, major Indices, and BTC). It relies on price action structures, key liquidity zones, and volume confirmation to filter out noise.

## 2. Core Methodology & Rules
- **Timeframe Alignment**: Primary analysis on the 1-Hour (H1) chart for structural trend direction, refined on the 15-Minute (M15) chart for precise execution triggers.
- **Support & Resistance / Liquidity**: Identify major daily/weekly highs, lows, and key order blocks. Signals are only generated when price tests these key institutional zones.
- **Momentum & Volume Confirmation**: A trade entry requires a strong candlestick rejection pattern (pin bar, engulfing) accompanied by volume expansion or a clear breakout of local structure (Break of Structure - BOS).
- **Trend Following**: Always prioritize trading in the direction of the dominant H1 market trend. Counter-trend setups require exceptional rejection patterns at critical daily boundaries.

## 3. Risk & Money Management (Strict 1% Rule)
- **Risk Per Trade**: Maximum of 1.0% of total account capital per trade setup.
- **Risk-to-Reward Ratio (R:R)**: Minimum target of 1:2. Trailing stops may be employed to secure profits once the first target (1:1) is achieved.
- **Stop Loss Placement**: Always placed structurally beyond the swing high/low of the trigger candlestick or key institutional zone boundary.
- **Daily Drawdown Cap**: If a user experiences 3 consecutive losses in a 24-hour cycle, trading must halt for that day to preserve capital and prevent emotional over-trading.`
};

const parseStrategyText = (rawText: string) => {
  if (!rawText || rawText.trim() === '' || rawText.trim() === '• Entry conditions\n• Confirmation indicators\n• Exit & stop-loss logic\n• Risk management rules') {
    return {
      activeId: 'default',
      strategies: [GAKS_DEFAULT_STRATEGY]
    };
  }

  try {
    const parsed = JSON.parse(rawText);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.strategies)) {
      const hasDefault = parsed.strategies.some((s: any) => s.isDefault || s.id === 'default');
      const list = hasDefault ? parsed.strategies : [GAKS_DEFAULT_STRATEGY, ...parsed.strategies];
      
      const updatedList = list.map((s: any) => {
        if (s.id === 'default' || s.isDefault) {
          return GAKS_DEFAULT_STRATEGY;
        }
        return s;
      });

      return {
        activeId: parsed.activeId || 'default',
        strategies: updatedList
      };
    }
  } catch (e) {
    const customStrategyId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + '-' + Date.now();
    const existingCustom: Strategy = {
      id: customStrategyId,
      name: 'My Custom Strategy',
      isDefault: false,
      text: rawText
    };
    return {
      activeId: customStrategyId,
      strategies: [GAKS_DEFAULT_STRATEGY, existingCustom]
    };
  }

  return {
    activeId: 'default',
    strategies: [GAKS_DEFAULT_STRATEGY]
  };
};

const serializeStrategies = (activeId: string, list: Strategy[]) => {
  return JSON.stringify({
    activeId,
    strategies: list
  });
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'strategy' | 'watcher' | 'settings' | 'admin'>('home');

  const [isResetPasswordPage, setIsResetPasswordPage] = useState(() => {
    if (typeof window !== 'undefined') {
      return (
        window.location.pathname === '/reset-password' ||
        window.location.hash.includes('type=recovery')
      );
    }
    return false;
  });

  useEffect(() => {
    const checkRoute = () => {
      if (
        window.location.pathname === '/reset-password' ||
        window.location.hash.includes('type=recovery')
      ) {
        setIsResetPasswordPage(true);
      } else if (window.location.pathname === '/admin') {
        setActiveTab('admin');
      }
    };

    checkRoute();
    window.addEventListener('popstate', checkRoute);
    window.addEventListener('hashchange', checkRoute);
    return () => {
      window.removeEventListener('popstate', checkRoute);
      window.removeEventListener('hashchange', checkRoute);
    };
  }, []);
  const [currentTime, setCurrentTime] = useState<Date>(new Date('2026-06-28T15:01:00'));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);

  // Theme State
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('gaks_theme');
      if (saved === 'light' || saved === 'dark') return saved;
    }
    return 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('gaks_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };
  
  // Auth & Profile states
  const [session, setSession] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  
  // Profile settings form states
  const [profileFullName, setProfileFullName] = useState('');
  const [profilePlan, setProfilePlan] = useState('Free');
  const [profileTelegram, setProfileTelegram] = useState(false);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState('');
  const [isProfileUpdating, setIsProfileUpdating] = useState(false);

  // Gemini API Key States
  const [geminiKey, setGeminiKey] = useState('');
  const [isGeminiKeyLoading, setIsGeminiKeyLoading] = useState(false);
  const [isGeminiKeySaving, setIsGeminiKeySaving] = useState(false);
  const [isGeminiKeyTesting, setIsGeminiKeyTesting] = useState(false);
  const [geminiKeyExists, setGeminiKeyExists] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState<string>('not_connected');
  const [geminiTestResult, setGeminiTestResult] = useState<GeminiTestResult | null>(null);
  const [geminiKeySuccess, setGeminiKeySuccess] = useState<string | null>(null);
  const [geminiKeyError, setGeminiKeyError] = useState<string | null>(null);

  // Watcher Engine States
  const [isWatcherActive, setIsWatcherActive] = useState(false);
  const [watcherErrorMessage, setWatcherErrorMessage] = useState<string | null>(null);

  // Telegram Integration States
  const [telegramConnection, setTelegramConnection] = useState<any>(null);
  const [isTelegramConnecting, setIsTelegramConnecting] = useState(false);
  const [isTelegramLoading, setIsTelegramLoading] = useState(false);
  const [telegramSuccessMessage, setTelegramSuccessMessage] = useState<string | null>(null);
  const [telegramErrorMessage, setTelegramErrorMessage] = useState<string | null>(null);


  // Strategy States
  const [strategyText, setStrategyText] = useState<string>('');
  const [strategies, setStrategies] = useState<Strategy[]>([GAKS_DEFAULT_STRATEGY]);
  const [activeStrategyId, setActiveStrategyId] = useState<string>('default');
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>('default');
  const [capital, setCapital] = useState<string>('$1,000');
  const [customCapital, setCustomCapital] = useState<string>('');
  const [preferredRisk, setPreferredRisk] = useState<string>('1%');
  const [riskReward, setRiskReward] = useState<string>('1:2');
  const [accountType, setAccountType] = useState<'personal' | 'prop'>('personal');
  const [positionMode, setPositionMode] = useState<'AUTO_RISK' | 'FIXED_LOT'>('AUTO_RISK');
  const [fixedLotSize, setFixedLotSize] = useState<string>('0.01');
  const [preferredSessions, setPreferredSessions] = useState<string[]>(['London', 'New York', 'Tokyo']);
  const [preferredTimeframes, setPreferredTimeframes] = useState<string[]>(['M15', 'H1']);
  const [lastSavedStrategyText, setLastSavedStrategyText] = useState<string>('');
  const strategyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const prevSelectedId = useRef<string>('default');

  // Auto-resize Strategy Editor
  useEffect(() => {
    if (activeTab === 'strategy' && strategyTextareaRef.current) {
      const textarea = strategyTextareaRef.current;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.max(400, textarea.scrollHeight)}px`;
    }
  }, [activeTab, strategies, selectedStrategyId]);

  const [initialPrefs, setInitialPrefs] = useState<{
    capital: string;
    customCapital: string;
    preferredRisk: string;
    riskReward: string;
    accountType: 'personal' | 'prop';
    positionMode: 'AUTO_RISK' | 'FIXED_LOT';
    fixedLotSize: string;
    preferredSessions: string[];
    preferredTimeframes: string[];
  }>({
    capital: '$1,000',
    customCapital: '',
    preferredRisk: '1%',
    riskReward: '1:2',
    accountType: 'personal',
    positionMode: 'AUTO_RISK',
    fixedLotSize: '0.01',
    preferredSessions: ['London', 'New York', 'Tokyo'],
    preferredTimeframes: ['M15', 'H1']
  });

  const isPrefsDirty = useMemo(() => {
    if (capital !== initialPrefs.capital) return true;
    if (customCapital !== initialPrefs.customCapital) return true;
    if (preferredRisk !== initialPrefs.preferredRisk) return true;
    if (riskReward !== initialPrefs.riskReward) return true;
    if (accountType !== initialPrefs.accountType) return true;
    if (positionMode !== initialPrefs.positionMode) return true;
    if (fixedLotSize !== initialPrefs.fixedLotSize) return true;
    
    if (preferredSessions.length !== initialPrefs.preferredSessions.length) return true;
    const sortedSessions = [...preferredSessions].sort();
    const sortedInitialSessions = [...initialPrefs.preferredSessions].sort();
    if (sortedSessions.some((s, idx) => s !== sortedInitialSessions[idx])) return true;

    if (preferredTimeframes.length !== initialPrefs.preferredTimeframes.length) return true;
    const sortedTimeframes = [...preferredTimeframes].sort();
    const sortedInitialTimeframes = [...initialPrefs.preferredTimeframes].sort();
    if (sortedTimeframes.some((t, idx) => t !== sortedInitialTimeframes[idx])) return true;

    return false;
  }, [capital, customCapital, preferredRisk, riskReward, accountType, positionMode, fixedLotSize, preferredSessions, preferredTimeframes, initialPrefs]);

  const ADMIN_EMAIL = "gaks6535@gmail.com";
  const isAdmin = useMemo(() => {
    return userProfile?.role === "admin" || session?.user?.email?.trim().toLowerCase() === ADMIN_EMAIL;
  }, [userProfile, session]);

  useEffect(() => {
    if (prevSelectedId.current !== selectedStrategyId) {
      const nextStrat = strategies.find(s => s.id === selectedStrategyId);
      if (nextStrat) {
        setLastSavedStrategyText(nextStrat.text);
      }
      prevSelectedId.current = selectedStrategyId;
    }
  }, [selectedStrategyId, strategies]);
  const [showNotification, setShowNotification] = useState<{message: string; type: 'success' | 'info'} | null>(null);

  // Market Watcher States
  const [watcherSearch, setWatcherSearch] = useState<string>('');
  const [watcherTimeframe, setWatcherTimeframe] = useState<string>('H1');
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);

  useEffect(() => {
    console.log(`[Watchlist Debug] Final rendered watcher count: ${watchlist.length}`);
  }, [watchlist.length]);

  // Real-time Watcher Status & Timeframe Validation States
  const [watcherTradeStatus, setWatcherTradeStatus] = useState<string>('WAITING');
  const [watcherLastScanAt, setWatcherLastScanAt] = useState<string>('');
  const [watcherLastCandle, setWatcherLastCandle] = useState<string>('');

  // Client-side Strategy Timeframe Compilation
  const compiledStrategyTimeframes = useMemo(() => {
    try {
      if (!strategyText || !strategyText.trim()) return [];
      
      let textToCompile = strategyText;
      // If it looks like JSON, extract the active strategy text
      if (strategyText.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(strategyText);
          if (parsed && parsed.strategies && Array.isArray(parsed.strategies)) {
             const active = parsed.strategies.find((s: any) => s.id === parsed.activeId) || parsed.strategies[0];
             if (active) textToCompile = active.text;
          }
        } catch (e) {
          // Not valid JSON or missing expected fields, fallback to raw text
        }
      }
      
      const res = compileStrategy(textToCompile);
      return res.compiled_rules?.timeframes || [];
    } catch (e) {
      console.warn("Error compiling strategy on client-side:", e);
      return [];
    }
  }, [strategyText]);

  // Check if there is a timeframe mismatch
  const isTimeframeMismatch = useMemo(() => {
    if (compiledStrategyTimeframes.length === 0 || !watcherTimeframe) return false;
    return !compiledStrategyTimeframes.some(
      tf => tf.toLowerCase().trim() === watcherTimeframe.toLowerCase().trim()
    );
  }, [compiledStrategyTimeframes, watcherTimeframe]);

  // Auto recommendation of timeframe
  useEffect(() => {
    if (compiledStrategyTimeframes.length === 1) {
      const tf = compiledStrategyTimeframes[0];
      setWatcherTimeframe(tf);
    }
  }, [compiledStrategyTimeframes]);

  // Watchlist Sync Helpers
  const loadWatchlistFromSupabase = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('watchers')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active');
      console.log(`[WATCHER LIFECYCLE] WATCHER FETCHED (loadWatchlistFromSupabase): ${JSON.stringify(data)}`);

      if (error) {
        console.warn("Could not load watchers from Supabase:", error.message);
        return;
      }

      console.log(`[Watchlist Debug] Refetched watcher count from DB: ${data ? data.length : 0}`);
      if (data && data.length > 0) {
        const mapped: WatchlistItem[] = data.map((item: any) => ({
          symbol: normalizeSymbol(item.selected_pair),
          name: getFullNameForSymbol(item.selected_pair),
          price: 0, // Will be updated by live rates or scan
          change: 0,
          spread: 0,
          volatility: 'Medium',
          confidence: 0,
          direction: 'Neutral',
          history: Array.from({ length: 7 }, () => 0), // Default history to prevent crashes
          timeframe: item.selected_timeframe || 'H1'
        }));
        setWatchlist(prev => {
          const nextList = [...prev];
          mapped.forEach(incoming => {
             const existingIdx = nextList.findIndex(w => w.symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === incoming.symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase());
             if (existingIdx >= 0) {
                // Update existing, preserving live price/change which loadWatchlistFromSupabase resets to 0
                nextList[existingIdx] = { 
                  ...nextList[existingIdx], 
                  timeframe: incoming.timeframe,
                  name: incoming.name
                };
             } else {
                nextList.push(incoming);
             }
          });
          console.log(`[Watchlist Debug] WATCHERS UPDATED\nPrevious: ${prev.length}\nCurrent: ${nextList.length}\nReason: API LOAD MERGE`);
          localStorage.setItem('gaks_watchlist', JSON.stringify(nextList));
          return nextList;
        });
      } else {
        console.log(`[Watchlist Debug] API returned empty for watchers. Relying on loadWatcherStatus for cleanup.`);
      }
    } catch (err) {
      console.error("Exception loading watchers from Supabase:", err);
    }
  };

  // Auth Restoration & Profile Initialization logic
  useEffect(() => {
    const fetchOrCreateUserProfile = async (user: any) => {
      if (!user) return null;
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();

        if (profile) {
          setUserProfile(profile);
          setProfileFullName(profile.full_name || '');
          setProfilePlan(profile.subscription_plan || 'Free');
          setProfileTelegram(profile.telegram_connected || false);
          setProfileAvatarUrl(profile.avatar_url || '');
          return profile;
        } else {
          // Auto-provision profile with 'Free' plan state for new signups (Email, Google, OAuth)
          const newProfile = {
            id: user.id,
            email: user.email,
            full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Gaks User',
            subscription_plan: 'Free',
            telegram_connected: false,
            avatar_url: user.user_metadata?.avatar_url || '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          await supabase.from('profiles').upsert(newProfile, { onConflict: 'id' });
          setUserProfile(newProfile);
          setProfileFullName(newProfile.full_name);
          setProfilePlan('Free');
          setProfileTelegram(false);
          setProfileAvatarUrl(newProfile.avatar_url);
          return newProfile;
        }
      } catch (err) {
        console.error('Error fetching or creating profile:', err);
        setProfilePlan('Free');
        return null;
      }
    };

    const loadUserData = async (user: any) => {
      if (!user) return;
      try {
        await Promise.all([
          fetchOrCreateUserProfile(user),
          loadWatchlistFromSupabase(user.id),
          loadTelegramConnection(user.id),
          loadTradingPreferences(user.id),
          loadWatcherStatus(user.id)
        ]);
      } catch (err) {
        console.error('Error fetching user data:', err);
      }
    };

    const initAuth = async () => {
      try {
        const { data: { session: activeSession } } = await supabase.auth.getSession();
        if (activeSession) {
          setSession(activeSession);
          await loadUserData(activeSession.user);
        }
      } catch (err) {
        console.error('Error restoring session:', err);
      } finally {
        setIsAuthLoading(false);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: string, currentSession: any) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsResetPasswordPage(true);
      }
      if (currentSession) {
        setSession(currentSession);
        // Trigger external async function rather than performing async work directly inside listener
        loadUserData(currentSession.user);
      } else {
        setSession(null);
        setUserProfile(null);
        setTelegramConnection(null);
        setTelegramSuccessMessage(null);
        setTelegramErrorMessage(null);
        setWatchlist([]);
        localStorage.removeItem('gaks_watchlist');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Poll & Listen for Telegram Connection activation
  useEffect(() => {
    if (!session?.user) return;

    const pendingToken = localStorage.getItem('gaks_pending_telegram_token');
    const pendingUserId = localStorage.getItem('gaks_pending_telegram_user');

    // Only set up listeners or polling if a Telegram connection is explicitly pending for this user
    if (!pendingToken || pendingUserId !== session.user.id) {
      return;
    }

    const checkAndTriggerActivation = async (): Promise<boolean> => {
      // Reload the state
      await loadTelegramConnection(session.user.id, false);
      
      const { data } = await getTelegramConnection(session.user.id);
      if (data && data.connected) {
        localStorage.removeItem('gaks_pending_telegram_token');
        localStorage.removeItem('gaks_pending_telegram_user');
        triggerNotification("Telegram linked successfully!", "success");
        setTelegramSuccessMessage("Telegram Connected!");
        return true;
      }
      return false;
    };

    // Initial check
    checkAndTriggerActivation();

    // 1. Focus listener: instantly checks when user switches back to this tab
    const handleFocus = () => {
      checkAndTriggerActivation();
    };
    window.addEventListener('focus', handleFocus);

    // 2. Realtime channel subscription on telegram_connections table
    const channel = supabase
      .channel(`telegram_conn_${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'telegram_connections',
          filter: `user_id=eq.${session.user.id}`
        },
        async () => {
          const isConnected = await checkAndTriggerActivation();
          if (isConnected) {
            supabase.removeChannel(channel);
          }
        }
      )
      .subscribe();

    // 3. Fallback polling interval (10s) only while pending
    const interval = setInterval(async () => {
      const isConnected = await checkAndTriggerActivation();
      if (isConnected) {
        clearInterval(interval);
        supabase.removeChannel(channel);
      }
    }, 10000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [session]);

  // Load from LocalStorage if available
  useEffect(() => {
    try {
      const savedStrategy = localStorage.getItem('gaks_strategy_text');
      if (savedStrategy) {
        setStrategyText(savedStrategy);
        const parsed = parseStrategyText(savedStrategy);
        setStrategies(parsed.strategies);
        setActiveStrategyId(parsed.activeId);
        setSelectedStrategyId(parsed.activeId);
        prevSelectedId.current = parsed.activeId;
        const activeStrat = parsed.strategies.find((s: any) => s.id === parsed.activeId);
        if (activeStrat) {
          setLastSavedStrategyText(activeStrat.text);
        }
      } else {
        const defaultState = {
          activeId: 'default',
          strategies: [GAKS_DEFAULT_STRATEGY]
        };
        const serialized = JSON.stringify(defaultState);
        setStrategyText(serialized);
        setStrategies(defaultState.strategies);
        setActiveStrategyId(defaultState.activeId);
        setSelectedStrategyId(defaultState.activeId);
        prevSelectedId.current = defaultState.activeId;
        setLastSavedStrategyText(GAKS_DEFAULT_STRATEGY.text);
        localStorage.setItem('gaks_strategy_text', serialized);
      }
      
      const savedCapital = localStorage.getItem('gaks_capital') || '$1,000';
      if (savedCapital) setCapital(savedCapital);

      const savedCustomCapital = localStorage.getItem('gaks_custom_capital') || '';
      if (savedCustomCapital) setCustomCapital(savedCustomCapital);
      
      const savedRisk = localStorage.getItem('gaks_preferred_risk') || '1%';
      if (savedRisk) setPreferredRisk(savedRisk);
      
      const savedRR = localStorage.getItem('gaks_risk_reward') || '1:2';
      if (savedRR) setRiskReward(savedRR);
      
      const savedAccount = localStorage.getItem('gaks_account_type') || 'personal';
      if (savedAccount === 'personal' || savedAccount === 'prop') setAccountType(savedAccount as 'personal' | 'prop');
      
      const savedSessions = localStorage.getItem('gaks_sessions') ? JSON.parse(localStorage.getItem('gaks_sessions')!) : ['London', 'New York', 'Tokyo'];
      if (savedSessions) setPreferredSessions(savedSessions);
      
      const savedTimeframes = localStorage.getItem('gaks_timeframes') ? JSON.parse(localStorage.getItem('gaks_timeframes')!) : ['M15', 'H1'];
      if (savedTimeframes) setPreferredTimeframes(savedTimeframes);

      setInitialPrefs({
        capital: savedCapital,
        customCapital: savedCustomCapital,
        preferredRisk: savedRisk,
        riskReward: savedRR,
        accountType: savedAccount as 'personal' | 'prop',
        preferredSessions: savedSessions,
        preferredTimeframes: savedTimeframes
      });

      const savedWatchlist = localStorage.getItem('gaks_watchlist');
      if (savedWatchlist) setWatchlist(JSON.parse(savedWatchlist));
    } catch (e) {
      console.error('Error loading saved state:', e);
    }
  }, []);

  // Show auto-dismiss notifications
  const triggerNotification = (message: string, type: 'success' | 'info' = 'success') => {
    setShowNotification({ message, type });
    setTimeout(() => {
      setShowNotification(null);
    }, 3000);
  };

  // Helper to format timestamps exactly as screenshots: "Sun, Jun 28, 03:01 PM"
  const formattedTime = useMemo(() => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const dayName = days[currentTime.getDay()];
    const monthName = months[currentTime.getMonth()];
    const dayNum = currentTime.getDate();
    
    let hours = currentTime.getHours();
    const minutes = currentTime.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    const minutesStr = minutes < 10 ? '0' + minutes : minutes;
    
    return `${dayName}, ${monthName} ${dayNum}, ${hours < 10 ? '0' + hours : hours}:${minutesStr} ${ampm}`;
  }, [currentTime]);

  // Forex live rates fetched from Express API (with public er-api.com USD rate mapping)
  const { rates: liveRates, isLoading: isRatesLoading, error: ratesError, refetch: refetchRates } = useLiveRates();

  // Sync live rates into the monitored watchlist for real-time price updates
  useEffect(() => {
    if (liveRates.length > 0) {
      setWatchlist(prevWatchlist => {
        if (prevWatchlist.length === 0) return prevWatchlist;
        
        const hasUpdates = prevWatchlist.some(item => {
          const live = liveRates.find(r => normalizeSymbol(r.symbol) === normalizeSymbol(item.symbol));
          return live && (live.price !== item.price || live.change !== item.change);
        });

        if (!hasUpdates) return prevWatchlist;

        const updated = prevWatchlist.map(item => {
          const live = liveRates.find(r => normalizeSymbol(r.symbol) === normalizeSymbol(item.symbol));
          if (live) {
            return {
              ...item,
              price: live.price,
              change: live.change,
              direction: live.change > 0 ? 'Bullish' : live.change < 0 ? 'Bearish' : 'Neutral',
              status: live.status
            };
          }
          return item;
        });
        return updated as WatchlistItem[];
      });
    }
  }, [liveRates]);

  // Quick Analyze Mock Results
  const mockAnalysisPhrases = [
    "Divergence detected on EURUSD H1 chart near key support. Expect a potential reversal.",
    "USDJPY displaying a strong breakout sequence above daily consolidation range.",
    "High volatility expected in London session due to CPI release. Risk management is key.",
    "AUDUSD oversold on M15 RSI. Minor scalp buying opportunities detected.",
    "GBPUSD correlation with EURUSD remains tight at 0.92. Avoid double exposure."
  ];

  // Refresh live rates from server-side API route /api/live-rates
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetchRates();
      setCurrentTime(new Date());
      triggerNotification("Rates updated from live Forex API", "info");
    } catch (err) {
      triggerNotification("Failed to refresh rates from API", "info");
    } finally {
      setIsRefreshing(false);
    }
  };

  // Quick Analyze Trigger
  const handleQuickAnalyze = () => {
    setIsAnalyzing(true);
    setAnalysisResult(null);
    setTimeout(() => {
      setIsAnalyzing(false);
      const randomPhrase = mockAnalysisPhrases[Math.floor(Math.random() * mockAnalysisPhrases.length)];
      setAnalysisResult(randomPhrase);
      triggerNotification("AI Quick Scan completed!", "success");
    }, 1200);
  };

  // Save Strategy Page Form
  const saveStrategyPlaybook = async () => {
    const selectedStrat = strategies.find(s => s.id === selectedStrategyId);
    if (!selectedStrat || selectedStrat.text.trim().length === 0) {
      triggerNotification("Strategy cannot be empty.", "info");
      return;
    }
    const serialized = serializeStrategies(activeStrategyId, strategies);
    setStrategyText(serialized);
    localStorage.setItem('gaks_strategy_text', serialized);
    setLastSavedStrategyText(selectedStrat.text);
    
    if (session?.user) {
      try {
        console.log(`[Strategy Parser] Strategy received: ${selectedStrat.name}`);
        let parsedJson = null;
        const geminiKey = await getGeminiKey();
        
        if (geminiKey) {
          try {
            parsedJson = await parseUserStrategy(selectedStrat.text, geminiKey);
            console.log("[Strategy Parser] Parsed JSON:", parsedJson);
          } catch (parseError) {
            console.error("[Strategy Parser] Parse failed:", parseError);
          }
        } else {
          console.warn("[Strategy Parser] No Gemini API key found. Skipping parsing.");
        }

        // Upsert to strategies table
        const { error: stratError } = await supabase
          .from('strategies')
          .upsert({
            id: selectedStrat.id,
            user_id: session.user.id,
            name: selectedStrat.name,
            text: selectedStrat.text,
            is_default: selectedStrat.isDefault || false,
            parsed_strategy: parsedJson,
            updated_at: new Date().toISOString()
          });
          
        if (stratError) {
           console.error("[Strategy Parser] Error saving strategy to public.strategies:", stratError.message);
        } else {
           console.log("[Strategy Parser] Save successful.");
        }

        const { error } = await supabase
          .from('trading_preferences')
          .upsert({
            user_id: session.user.id,
            strategy_text: serialized,
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id' });
          
        if (error) {
          console.error("Error saving strategy to Supabase:", error.message);
          triggerNotification("Saved locally. Supabase sync failed.", "info");
        } else {
          triggerNotification("Strategy playbook saved & synchronized successfully!");
          syncStrategySummary(serialized, session.user.id);
        }
      } catch (err: any) {
        console.error("Exception saving strategy to Supabase:", err);
        triggerNotification("Saved locally.", "info");
      }
    } else {
      triggerNotification("Strategy playbook saved successfully!");
    }
  };

  const syncStrategySummary = async (text: string, userId: string) => {
    try {
      await fetch('/api/strategy/summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`
        },
        body: JSON.stringify({ strategyText: text, userId })
      });
    } catch (err) {
      console.warn('Failed to sync strategy summary:', err);
    }
  };

  const handleSetActiveStrategy = async (id: string) => {
    setActiveStrategyId(id);
    const serialized = serializeStrategies(id, strategies);
    setStrategyText(serialized);
    localStorage.setItem('gaks_strategy_text', serialized);
    
    if (session?.user) {
      try {
        const { error } = await supabase
          .from('trading_preferences')
          .upsert({
            user_id: session.user.id,
            strategy_text: serialized,
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id' });
          
        if (error) {
          console.error("Error activating strategy:", error.message);
          triggerNotification("Activated locally. DB sync failed.", "info");
        } else {
          triggerNotification(`"${strategies.find(s => s.id === id)?.name}" is now active!`);
          syncStrategySummary(serialized, session.user.id);
        }
      } catch (err: any) {
        console.error("Exception activating strategy:", err);
        triggerNotification("Activated locally.", "info");
      }
    } else {
      triggerNotification(`"${strategies.find(s => s.id === id)?.name}" is now active!`);
    }
  };

  const handleCreateCustomStrategy = () => {
    const newId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + '-' + Date.now();
    const newStrategy: Strategy = {
      id: newId,
      name: `Custom Strategy ${strategies.filter(s => !s.isDefault).length + 1}`,
      isDefault: false,
      text: `• Entry conditions\n• Confirmation indicators\n• Exit & stop-loss logic\n• Risk management rules`
    };
    const updatedList = [...strategies, newStrategy];
    setStrategies(updatedList);
    setSelectedStrategyId(newId);
    
    const serialized = serializeStrategies(activeStrategyId, updatedList);
    setStrategyText(serialized);
    localStorage.setItem('gaks_strategy_text', serialized);
    triggerNotification("Custom strategy created!");
  };

  const handleDuplicateStrategy = (strategyToDuplicate: Strategy) => {
    const newId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + '-' + Date.now();
    const newStrategy: Strategy = {
      id: newId,
      name: `${strategyToDuplicate.name} (Copy)`,
      isDefault: false,
      text: strategyToDuplicate.text
    };
    const updatedList = [...strategies, newStrategy];
    setStrategies(updatedList);
    setSelectedStrategyId(newId);
    
    const serialized = serializeStrategies(activeStrategyId, updatedList);
    setStrategyText(serialized);
    localStorage.setItem('gaks_strategy_text', serialized);
    triggerNotification(`Duplicated "${strategyToDuplicate.name}"!`);
  };

  const handleDeleteStrategy = (id: string) => {
    if (id === 'default') {
      triggerNotification("The default strategy cannot be deleted.", "info");
      return;
    }
    
    const updatedList = strategies.filter(s => s.id !== id);
    let newActiveId = activeStrategyId;
    if (activeStrategyId === id) {
      newActiveId = 'default';
    }
    let newSelectedId = selectedStrategyId;
    if (selectedStrategyId === id) {
      newSelectedId = 'default';
    }
    
    setStrategies(updatedList);
    setActiveStrategyId(newActiveId);
    setSelectedStrategyId(newSelectedId);
    
    const serialized = serializeStrategies(newActiveId, updatedList);
    setStrategyText(serialized);
    localStorage.setItem('gaks_strategy_text', serialized);
    triggerNotification("Strategy deleted.");
  };

  const handleRenameStrategy = (newName: string) => {
    if (selectedStrategyId === 'default') return;
    const updatedList = strategies.map(s => {
      if (s.id === selectedStrategyId) {
        return { ...s, name: newName };
      }
      return s;
    });
    setStrategies(updatedList);
    const serialized = serializeStrategies(activeStrategyId, updatedList);
    setStrategyText(serialized);
    localStorage.setItem('gaks_strategy_text', serialized);
  };

  const handleStrategyTextChange = (newText: string) => {
    const updatedList = strategies.map(s => {
      if (s.id === selectedStrategyId) {
        return { ...s, text: newText };
      }
      return s;
    });
    setStrategies(updatedList);
    const serialized = serializeStrategies(activeStrategyId, updatedList);
    setStrategyText(serialized);
    localStorage.setItem('gaks_strategy_text', serialized);
  };

  const handleRestoreStrategy = () => {
    const textToRestore = lastSavedStrategyText || GAKS_DEFAULT_STRATEGY.text;
    const updatedList = strategies.map(s => {
      if (s.id === selectedStrategyId) {
        return { ...s, text: textToRestore };
      }
      return s;
    });
    setStrategies(updatedList);
    const serialized = serializeStrategies(activeStrategyId, updatedList);
    setStrategyText(serialized);
    localStorage.setItem('gaks_strategy_text', serialized);
    triggerNotification("Strategy restored from previous version.");
  };

  const handleClearStrategy = () => {
    if (!window.confirm("Are you sure you want to delete your strategy? This will clear the editor.")) return;
    
    const updatedList = strategies.map(s => {
      if (s.id === selectedStrategyId) {
        return { ...s, text: '' };
      }
      return s;
    });
    setStrategies(updatedList);
    const serialized = serializeStrategies(activeStrategyId, updatedList);
    setStrategyText(serialized);
    localStorage.setItem('gaks_strategy_text', serialized);
    triggerNotification("Strategy editor cleared.");
  };

  // Save Preferences Form
  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      setSession(null);
      setUserProfile(null);
      triggerNotification("Signed out successfully!", "info");
    } catch (e) {
      triggerNotification("Logout failed.", "info");
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !session.user) return;
    
    setIsProfileUpdating(true);
    try {
      // NOTE: subscription_plan is intentionally EXCLUDED from client updates.
      // Subscription plans must be updated authoritatively via trusted backend/Stripe webhooks.
      const { data, error } = await supabase
        .from('profiles')
        .update({
          full_name: profileFullName,
          telegram_connected: profileTelegram,
          avatar_url: profileAvatarUrl
        })
        .eq('id', session.user.id);

      if (error) {
        triggerNotification(error.message, "info");
        return;
      }
      
      setUserProfile({
        ...userProfile,
        full_name: profileFullName,
        telegram_connected: profileTelegram,
        avatar_url: profileAvatarUrl
      });
      triggerNotification("Profile details saved successfully!", "success");
    } catch (err: any) {
      triggerNotification(err.message || "Failed to update profile", "info");
    } finally {
      setIsProfileUpdating(false);
    }
  };

  const loadTelegramConnection = async (userId: string, showLoader = false) => {
    if (showLoader) {
      setIsTelegramLoading(true);
    }
    try {
      const { data, error } = await getTelegramConnection(userId);
      if (!error && data) {
        setTelegramConnection(data);
        // Sync profileTelegram state with DB
        if (data.connected !== profileTelegram) {
          setProfileTelegram(data.connected);
        }
      } else if (error) {
        console.error('Error fetching connection:', error);
      }
    } catch (err) {
      console.error('Error loading Telegram connection state:', err);
    } finally {
      if (showLoader) {
        setIsTelegramLoading(false);
      }
    }
  };

  const loadTradingPreferences = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('trading_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.warn("Could not load trading preferences from Supabase:", error.message);
        return;
      }

      if (data) {
        if (data.strategy_text) {
          setStrategyText(data.strategy_text);
          const parsed = parseStrategyText(data.strategy_text);
          setStrategies(parsed.strategies);
          setActiveStrategyId(parsed.activeId);
          setSelectedStrategyId(parsed.activeId);
          prevSelectedId.current = parsed.activeId;
          const activeStrat = parsed.strategies.find((s: any) => s.id === parsed.activeId);
          if (activeStrat) {
            setLastSavedStrategyText(activeStrat.text);
          }
        }
        const capVal = data.capital || '$1,000';
        const customCapVal = data.custom_capital || '';
        const riskVal = data.preferred_risk || '1%';
        const rrVal = data.risk_reward || '1:2';
        
        const rawAccountType = String(data.account_type || 'personal');
        const accountVal = rawAccountType.startsWith('prop') ? 'prop' : 'personal';

        let modeVal: 'AUTO_RISK' | 'FIXED_LOT' = 'AUTO_RISK';
        if (data.position_mode === 'FIXED_LOT' || data.position_size_mode === 'FIXED_LOT' || rawAccountType.includes('MODE:FIXED_LOT')) {
          modeVal = 'FIXED_LOT';
        }

        let lotVal = data.preferred_lot_size || data.fixed_lot_size || data.custom_lot_size;
        if (!lotVal && rawAccountType.includes('|LOT:')) {
          const match = rawAccountType.match(/\|LOT:([0-9.]+)/);
          if (match) lotVal = match[1];
        }
        if (!lotVal) lotVal = '0.01';

        const sessionsVal = data.preferred_sessions || ['London', 'New York', 'Tokyo'];
        const timeframesVal = data.preferred_timeframes || ['M15', 'H1'];

        setCapital(capVal);
        setCustomCapital(customCapVal);
        setPreferredRisk(riskVal);
        setRiskReward(rrVal);
        setAccountType(accountVal as 'personal' | 'prop');
        setPositionMode(modeVal);
        setFixedLotSize(String(lotVal));
        if (data.preferred_sessions) setPreferredSessions(data.preferred_sessions);
        if (data.preferred_timeframes) setPreferredTimeframes(data.preferred_timeframes);

        setInitialPrefs({
          capital: capVal,
          customCapital: customCapVal,
          preferredRisk: riskVal,
          riskReward: rrVal,
          accountType: accountVal as 'personal' | 'prop',
          positionMode: modeVal,
          fixedLotSize: String(lotVal),
          preferredSessions: sessionsVal,
          preferredTimeframes: timeframesVal
        });

        localStorage.setItem('gaks_capital', capVal);
        localStorage.setItem('gaks_custom_capital', customCapVal);
        localStorage.setItem('gaks_preferred_risk', riskVal);
        localStorage.setItem('gaks_risk_reward', rrVal);
        localStorage.setItem('gaks_account_type', accountVal);
        localStorage.setItem('gaks_position_mode', modeVal);
        localStorage.setItem('gaks_fixed_lot_size', String(lotVal));
        localStorage.setItem('gaks_sessions', JSON.stringify(sessionsVal));
        localStorage.setItem('gaks_timeframes', JSON.stringify(timeframesVal));
      }
    } catch (err: any) {
      console.error("Exception loading trading preferences:", err);
    }
  };

  const loadWatcherStatus = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('watchers')
        .select('id, status, selected_pair, selected_timeframe, trade_status, last_scan_at, last_analyzed_closed_candle_time')
        .eq('user_id', userId);
      console.log(`[WATCHER LIFECYCLE] WATCHER FETCHED (loadWatcherStatus): ${JSON.stringify(data)}`);
        
      if (data) {
        const anyActive = data.some(w => w.status === 'active');
        setIsWatcherActive(anyActive);
        
        // Sync watchlist with actual DB statuses to remove crons/server-stopped watchers
        // This avoids race conditions by ONLY removing if the DB explicitly says it's stopped/deleted.
        setWatchlist(prev => {
          if (!prev || prev.length === 0) return prev;
          const nextList = prev.filter(w => {
            const dbW = data.find(d => d.selected_pair && d.selected_pair.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === w.symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase());
            // If the DB explicitly says it's not active, remove it.
            // If it's missing entirely from the DB result (e.g. out-of-order race condition), KEEP IT.
            if (dbW && dbW.status !== 'active') {
              console.log(`[WATCHER LIFECYCLE] WATCHER REMOVED from UI: ${w.symbol}, Status: ${dbW.status}`);
              return false;
            }
            return true;
          });
          if (nextList.length !== prev.length) {
            if (nextList.length === 0) {
              console.log(`[WATCHER LIFECYCLE] WATCHER HIDDEN (Watchlist Empty)`);
              localStorage.removeItem('gaks_watchlist');
            }
            else localStorage.setItem('gaks_watchlist', JSON.stringify(nextList));
          }
          return nextList;
        });
      }

      if (data && data.length > 0) {
        const activeOne = data.find(w => w.status === 'active') || data[0];
        if (activeOne.selected_pair) setWatcherSearch(activeOne.selected_pair);
        if (activeOne.selected_timeframe) setWatcherTimeframe(activeOne.selected_timeframe);
        if (activeOne.trade_status) setWatcherTradeStatus(activeOne.trade_status);
        if (activeOne.last_scan_at) setWatcherLastScanAt(activeOne.last_scan_at);
        if (activeOne.last_analyzed_closed_candle_time) setWatcherLastCandle(activeOne.last_analyzed_closed_candle_time);
      }
    } catch (err) {
      console.error("Error loading watcher status:", err);
    }
  };

  // Poll watcher status in real-time to show the active evaluation state
  useEffect(() => {
    if (!session?.user?.id || !isWatcherActive) return;

    const interval = setInterval(() => {
      loadWatcherStatus(session.user.id);
    }, 5000);

    return () => clearInterval(interval);
  }, [session?.user?.id, isWatcherActive]);

  const handleConnectTelegram = async () => {
    if (!session || !session.user) {
      setTelegramErrorMessage('You must be logged in to connect Telegram.');
      triggerNotification('Auth session required.', 'info');
      return;
    }

    setIsTelegramConnecting(true);
    setTelegramErrorMessage(null);
    setTelegramSuccessMessage(null);

    try {
      const { token, alreadyConnected, error } = await initiateTelegramConnection(session.user.id);

      if (error) {
        setTelegramErrorMessage(error.message || 'Failed to initialize Telegram connection.');
        triggerNotification(error.message || 'Failed to initialize Telegram connection.', 'info');
        return;
      }

      if (alreadyConnected) {
        setTelegramSuccessMessage('Telegram is already connected.');
        triggerNotification('Telegram is already connected.', 'info');
        return;
      }

      if (token) {
        setTelegramSuccessMessage('Deep link generated! Redirecting to Gaks AI Bot...');
        triggerNotification('Deep link generated! Opening Telegram...', 'success');
        
        // Save pending details locally to auto-trigger simulation when returning
        localStorage.setItem('gaks_pending_telegram_token', token);
        localStorage.setItem('gaks_pending_telegram_user', session.user.id);

        // Refresh local telegram connection record
        await loadTelegramConnection(session.user.id, false);

        const deepLink = getTelegramDeepLink(token);
        
        // Redirect after short delay so user can see success feedback
        setTimeout(() => {
          window.open(deepLink, '_blank');
        }, 800);
      }
    } catch (err: any) {
      setTelegramErrorMessage(err.message || 'An unexpected error occurred during configuration.');
      triggerNotification('Connection attempt failed.', 'info');
    } finally {
      setIsTelegramConnecting(false);
    }
  };

  // Load Gemini key
  const loadUserGeminiKey = async () => {
    setIsGeminiKeyLoading(true);
    setGeminiKeySuccess(null);
    setGeminiKeyError(null);
    try {
      const key = await getGeminiKey();
      if (key) {
        setGeminiKey(key);
        setGeminiKeyExists(true);
        setGeminiStatus('connected');
      } else {
        setGeminiKey('');
        setGeminiKeyExists(false);
        setGeminiStatus('not_connected');
      }
    } catch (err: any) {
      console.error("Error loading Gemini key:", err);
      setGeminiStatus('not_connected');
    } finally {
      setIsGeminiKeyLoading(false);
    }
  };

  const handleTestGeminiKey = async () => {
    setGeminiKeySuccess(null);
    setGeminiKeyError(null);
    setGeminiTestResult(null);
    const trimmed = geminiKey.trim();
    if (!trimmed) {
      const res = { status: 'invalid' as const, message: '✕ Invalid Gemini API key' };
      setGeminiTestResult(res);
      setGeminiStatus('invalid');
      return;
    }

    setIsGeminiKeyTesting(true);
    try {
      const res = await testGeminiKey(trimmed);
      setGeminiTestResult(res);
      setGeminiStatus(res.status);
      if (res.status === 'connected') {
        triggerNotification("✓ Gemini API connected", "success");
      } else {
        triggerNotification(res.message, "info");
      }
    } catch (err: any) {
      const res = { status: 'connection_failed' as const, message: '⚠ Gemini connection failed' };
      setGeminiTestResult(res);
      setGeminiStatus('connection_failed');
      triggerNotification("⚠ Gemini connection failed", "info");
    } finally {
      setIsGeminiKeyTesting(false);
    }
  };

  const handleSaveGeminiKey = async () => {
    setGeminiKeySuccess(null);
    setGeminiKeyError(null);
    setGeminiTestResult(null);
    const trimmed = geminiKey.trim();
    if (!trimmed) {
      setGeminiKeyError("API key cannot be empty.");
      triggerNotification("API key cannot be empty.", "info");
      return;
    }

    setIsGeminiKeySaving(true);
    try {
      const result = await saveGeminiKey(trimmed);
      if (result.success) {
        setGeminiKeyExists(true);
        setGeminiStatus(result.status || 'connected');
        setWatcherErrorMessage(null);
        setGeminiKeySuccess(geminiKeyExists ? "Gemini API key updated successfully!" : "Gemini API key saved successfully!");
        triggerNotification(geminiKeyExists ? "Gemini API key updated!" : "Gemini API key saved!", "success");
      } else {
        const errorMsg = result.error || "Could not save Gemini API key. Please try again.";
        setGeminiKeyError(errorMsg);
        if (result.status) {
          setGeminiStatus(result.status);
        }
        triggerNotification(errorMsg, "info");
      }
    } catch (err: any) {
      const errorMsg = "Could not save Gemini API key. Please try again.";
      setGeminiKeyError(errorMsg);
      triggerNotification(errorMsg, "info");
    } finally {
      setIsGeminiKeySaving(false);
    }
  };

  const handleDeleteGeminiKey = async () => {
    setGeminiKeySuccess(null);
    setGeminiKeyError(null);
    setGeminiTestResult(null);
    if (!window.confirm("Are you sure you want to delete your saved Gemini API key?")) {
      return;
    }

    setIsGeminiKeySaving(true);
    try {
      const result = await deleteGeminiKey();
      if (result.success) {
        setGeminiKey('');
        setGeminiKeyExists(false);
        setGeminiStatus('not_connected');
        setGeminiKeySuccess("Gemini API key deleted successfully!");
        triggerNotification("Gemini API key deleted!", "info");
      } else {
        setGeminiKeyError(result.error || "Failed to delete API key.");
        triggerNotification(result.error || "Failed to delete API key.", "info");
      }
    } catch (err: any) {
      setGeminiKeyError(err.message || "An unexpected error occurred.");
    } finally {
      setIsGeminiKeySaving(false);
    }
  };

  // Activate and Start AI Market Watcher with backend requirements validation
  const startAiMarketWatcher = async (symbolToAdd?: string, timeframeToWatch?: string) => {
    setWatcherErrorMessage(null);
    
    if (!session?.user) {
      setWatcherErrorMessage("You must be logged in to activate the AI Market Watcher.");
      triggerNotification("Auth session required", "info");
      return;
    }

    const targetSymbol = symbolToAdd || watcherSearch;
    const targetTimeframe = timeframeToWatch || watcherTimeframe;

    if (!targetSymbol || !targetTimeframe) {
      setWatcherErrorMessage("Please select a pair and timeframe before activating.");
      triggerNotification("Selection required", "info");
      return;
    }

    if (!geminiKeyExists) {
      setWatcherErrorMessage("Gemini API key is required to activate Market Watcher. Please configure your Gemini API key under Settings.");
      return;
    }

    try {
      // First ensure local changes are synced to Supabase (so backend checks pass)
      triggerNotification("Synchronizing local setup with Gaks AI...", "info");
      
      // Save playbooks & preferences to Supabase first so the backend validation doesn't fail on stale cache
      const { error: playbookErr } = await supabase
        .from('trading_preferences')
        .upsert({
          user_id: session.user.id,
          strategy_text: strategyText,
          capital: capital,
          custom_capital: customCapital,
          preferred_risk: preferredRisk,
          risk_reward: riskReward,
          account_type: accountType,
          preferred_sessions: preferredSessions,
          preferred_timeframes: preferredTimeframes,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

      if (playbookErr) {
        console.warn("Could not auto-sync trading preferences to Supabase:", playbookErr.message);
      }

      console.log(`[WATCHER LIFECYCLE] Frontend payload sent to backend for ${targetSymbol} / ${targetTimeframe}`);
      // Call secure backend activation route
      const response = await fetch('/api/watcher/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`
        },
        body: JSON.stringify({ 
          userId: session.user.id,
          selectedPair: targetSymbol,
          selectedTimeframe: targetTimeframe
        })
      });

      const contentType = response.headers.get("content-type");
      let result;
      
      if (contentType && contentType.includes("application/json")) {
        result = await response.json();
      } else {
        const text = await response.text();
        console.error("Non-JSON response from /api/watcher/start:", response.status, text.substring(0, 200));
        throw new Error(`Server returned an invalid response (${response.status}). This endpoint may be missing or misconfigured.`);
      }

      if (!response.ok || !result.success) {
        const errMsg = result.error || "Failed to activate AI Market Watcher.";
        setWatcherErrorMessage(errMsg);
        return;
      }

      setIsWatcherActive(true);
      setWatcherErrorMessage(null);
      triggerNotification(result.message || "AI Market Watcher activated successfully!", "success");

      // Optimistic update to guarantee visibility
      const cleanTarget = normalizeSymbol(targetSymbol);
      setWatchlist(prev => {
        const nextList = [...prev];
        const existingIdx = nextList.findIndex(w => w.symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === cleanTarget.replace(/[^a-zA-Z0-9]/g, '').toUpperCase());
        if (existingIdx >= 0) {
           nextList[existingIdx] = { ...nextList[existingIdx], timeframe: targetTimeframe };
        } else {
           nextList.push({
             symbol: cleanTarget,
             name: getFullNameForSymbol(cleanTarget),
             price: 0,
             change: 0,
             spread: 0,
             volatility: 'Medium',
             confidence: 0,
             direction: 'Neutral',
             history: [0,0,0,0,0,0,0],
             timeframe: targetTimeframe,
             status: 'active'
           });
        }
        localStorage.setItem('gaks_watchlist', JSON.stringify(nextList));
        return nextList;
      });

      // Refresh source of truth from Supabase instead of just mocking locally
      await loadWatchlistFromSupabase(session.user.id);
      
      // Clear UI state
      setWatcherSearch("");
    } catch (err: any) {
      console.error("Exception in startAiMarketWatcher:", err);
      setWatcherErrorMessage(err.message || "An unexpected error occurred during activation.");
    }
  };

  const stopAiMarketWatcher = async () => {
    if (session?.user) {
      try {
        await fetch('/api/watcher/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: session.user.id })
        }).catch(err => console.error("Error calling /api/watcher/stop:", err));

        await supabase
          .from('watchers')
          .update({
            status: 'stopped',
            trade_status: 'WAITING',
            entry_price: null,
            stop_loss: null,
            take_profit: null,
            direction: null,
            opened_at: null,
            closed_at: null,
            cooldown_until: null,
            signal_message_id: null,
            last_scan_at: null,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', session.user.id);
      } catch (err) {
        console.error("Error stopping watcher:", err);
      }
    }
    setIsWatcherActive(false);
    console.log(`[Watchlist Debug] WATCHERS UPDATED\nPrevious: ${watchlist.length}\nCurrent: 0\nReason: STOP`);
    setWatchlist([]);
    localStorage.removeItem('gaks_watchlist');
    triggerNotification("AI Market Watcher stopped.", "info");
  };

  // Load Gemini API Key when session changes
  useEffect(() => {
    if (session?.user) {
      loadUserGeminiKey();
    } else {
      setGeminiKey('');
      setGeminiKeyExists(false);
      setIsWatcherActive(false);
    }
  }, [session]);

  const savePreferences = async () => {
    // Client-side validation
    if (positionMode === 'FIXED_LOT') {
      const parsedLot = parseFloat(fixedLotSize);
      if (isNaN(parsedLot) || parsedLot <= 0) {
        triggerNotification("Please enter a valid fixed lot size greater than 0.", "info");
        return;
      }
    }
    if (capital === 'Custom') {
      const parsedCustomCap = parseFloat(customCapital.replace(/[^0-9.]/g, ''));
      if (isNaN(parsedCustomCap) || parsedCustomCap <= 0) {
        triggerNotification("Please enter a valid custom account capital.", "info");
        return;
      }
    }

    const encodedAccountType = `${accountType}|MODE:${positionMode}|LOT:${fixedLotSize}`;
    
    if (session?.user) {
      try {
        const payload = {
          user_id: session.user.id,
          capital: capital,
          custom_capital: customCapital,
          preferred_risk: preferredRisk,
          risk_reward: riskReward,
          account_type: encodedAccountType,
          preferred_sessions: preferredSessions,
          preferred_timeframes: preferredTimeframes,
          strategy_text: strategyText,
          updated_at: new Date().toISOString()
        };

        const { error } = await supabase
          .from('trading_preferences')
          .upsert(payload, { onConflict: 'user_id' });
          
        if (error) {
          console.error(`[Preferences Sync]\nUser ID: ${session.user.id}\nOperation: UPSERT\nStatus: FAILED\nError: ${error.message}\nDatabase Code: ${error.code || 'N/A'}`);
          triggerNotification("Could not save preferences. Please try again.", "info");
        } else {
          console.log(`[Preferences Sync]\nUser ID: ${session.user.id}\nOperation: UPSERT\nStatus: SUCCESS`);
          
          setInitialPrefs({
            capital,
            customCapital,
            preferredRisk,
            riskReward,
            accountType,
            positionMode,
            fixedLotSize,
            preferredSessions,
            preferredTimeframes
          });

          localStorage.setItem('gaks_capital', capital);
          localStorage.setItem('gaks_custom_capital', customCapital);
          localStorage.setItem('gaks_preferred_risk', preferredRisk);
          localStorage.setItem('gaks_risk_reward', riskReward);
          localStorage.setItem('gaks_account_type', accountType);
          localStorage.setItem('gaks_position_mode', positionMode);
          localStorage.setItem('gaks_fixed_lot_size', fixedLotSize);
          localStorage.setItem('gaks_sessions', JSON.stringify(preferredSessions));
          localStorage.setItem('gaks_timeframes', JSON.stringify(preferredTimeframes));

          triggerNotification("Preferences saved.");
        }
      } catch (err: any) {
        console.error(`[Preferences Sync]\nUser ID: ${session.user.id}\nOperation: UPSERT\nStatus: FAILED\nError: ${err?.message || err}`);
        triggerNotification("Could not save preferences. Please try again.", "info");
      }
    } else {
      setInitialPrefs({
        capital,
        customCapital,
        preferredRisk,
        riskReward,
        accountType,
        positionMode,
        fixedLotSize,
        preferredSessions,
        preferredTimeframes
      });

      localStorage.setItem('gaks_capital', capital);
      localStorage.setItem('gaks_custom_capital', customCapital);
      localStorage.setItem('gaks_preferred_risk', preferredRisk);
      localStorage.setItem('gaks_risk_reward', riskReward);
      localStorage.setItem('gaks_account_type', accountType);
      localStorage.setItem('gaks_position_mode', positionMode);
      localStorage.setItem('gaks_fixed_lot_size', fixedLotSize);
      localStorage.setItem('gaks_sessions', JSON.stringify(preferredSessions));
      localStorage.setItem('gaks_timeframes', JSON.stringify(preferredTimeframes));

      triggerNotification("Preferences saved.");
    }
  };

  // Toggle Preferred Sessions list
  const toggleSession = (session: string) => {
    setPreferredSessions(prev =>
      prev.includes(session) ? prev.filter(s => s !== session) : [...prev, session]
    );
  };

  // Toggle Preferred Timeframes list
  const toggleTimeframe = (tf: string) => {
    setPreferredTimeframes(prev =>
      prev.includes(tf) ? prev.filter(t => t !== tf) : [...prev, tf]
    );
  };

  // Market Watcher Add Ticker
  const handleAddPair = async (symbolToAdd: string, timeframeToWatch: string = 'H1') => {
    const cleanSymbol = normalizeSymbol(symbolToAdd);
    if (!cleanSymbol) return;

    // Check if we already have live data for this
    const live = liveRates.find(r => normalizeSymbol(r.symbol) === normalizeSymbol(cleanSymbol));

    const newPair: WatchlistItem = {
      symbol: cleanSymbol,
      name: getFullNameForSymbol(cleanSymbol),
      price: live ? live.price : 0,
      change: live ? live.change : 0,
      spread: 0,
      volatility: 'Medium',
      confidence: 0,
      direction: live ? (live.change > 0 ? 'Bullish' : live.change < 0 ? 'Bearish' : 'Neutral') : 'Neutral',
      history: live ? live.history : [],
      timeframe: timeframeToWatch,
      status: live ? 'active' : 'unavailable'
    };

    setWatchlist(prev => {
      let updatedWatchlist;
      if (prev.some(w => normalizeSymbol(w.symbol) === normalizeSymbol(cleanSymbol))) {
        updatedWatchlist = prev.map(w => normalizeSymbol(w.symbol) === normalizeSymbol(cleanSymbol) ? { ...w, timeframe: timeframeToWatch } : w);
      } else {
        updatedWatchlist = [...prev, newPair];
      }
      localStorage.setItem('gaks_watchlist', JSON.stringify(updatedWatchlist));
      return updatedWatchlist;
    });

    setWatcherSearch(cleanSymbol);
      
    if (session?.user) {
      console.log(`[Watchlist Debug] Watchers before insert: ${watchlist.length}`);
      
      const doStartWatcher = async () => {
        try {
          const response = await fetch('/api/watcher/start', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token || ''}`
            },
            body: JSON.stringify({
              userId: session.user.id,
              selectedPair: cleanSymbol,
              selectedTimeframe: timeframeToWatch
            })
          });
          
          console.log(`[Watchlist Debug] Insert response status: ${response.status}`);
          
          // Immediate refetch from DB so the UI always reflects what the DB actually stored
          await loadWatchlistFromSupabase(session.user.id);
          
          console.log(`[Watchlist Debug] Final rendered watcher count loaded from Supabase.`);
        } catch (err) {
          console.error("Error creating watcher in handleAddPair:", err);
        }
      };
      
      doStartWatcher();
    }
      
    triggerNotification(`${cleanSymbol} added to watchlist!`);
  };

  const handleRemovePair = (symbolToRemove: string) => {
    const canonical = normalizeSymbol(symbolToRemove);
    if (isAdmin) {
      setWatchlist(prev => {
        const updated = prev.filter(w => normalizeSymbol(w.symbol) !== canonical);
        localStorage.setItem('gaks_watchlist', JSON.stringify(updated));
        return updated;
      });
      
      if (session?.user) {
        fetch('/api/watcher/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: session.user.id, selected_pair: symbolToRemove })
        }).catch(err => console.error("Error calling /api/watcher/stop:", err));

        supabase
          .from('watchers')
          .update({
            status: 'stopped',
            trade_status: 'WAITING',
            entry_price: null,
            stop_loss: null,
            take_profit: null,
            direction: null,
            opened_at: null,
            closed_at: null,
            cooldown_until: null,
            signal_message_id: null,
            last_scan_at: null,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', session.user.id)
          .eq('selected_pair', symbolToRemove)
          .then();
      }
    } else {
      stopAiMarketWatcher();
    }
    
    triggerNotification(`${toDisplaySymbol(symbolToRemove)} removed from watchlist`, 'info');
  };

  const getFullNameForSymbol = (symbol: string): string => {
    if (!symbol) return 'Unknown Asset';
    return toDisplaySymbol(symbol);
  };

  // Helper to generate coordinates for sparkline graph
  const getSparklinePaths = (points: number[] = [], width = 100, height = 30) => {
    if (!Array.isArray(points) || points.length === 0) {
      return { lineD: 'M 0 0', fillD: 'M 0 0 Z' };
    }
    
    // Safety check for all elements being numbers
    const validPoints = points.filter(p => typeof p === 'number' && !isNaN(p));
    if (validPoints.length === 0) {
      return { lineD: 'M 0 0', fillD: 'M 0 0 Z' };
    }

    if (validPoints.length === 1) {
      const y = height / 2;
      return { lineD: `M 0 ${y} L ${width} ${y}`, fillD: `M 0 ${y} L ${width} ${y} L ${width} ${height} L 0 ${height} Z` };
    }

    const min = Math.min(...validPoints);
    const max = Math.max(...validPoints);
    const range = max - min || 1;
    const coords = validPoints.map((val, i) => {
      const x = (i / (validPoints.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 6) - 3;
      return { x, y };
    });
    
    if (!coords[0]) return { lineD: 'M 0 0', fillD: 'M 0 0 Z' };

    let lineD = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 1; i < coords.length; i++) {
      const cpX = (coords[i-1].x + coords[i].x) / 2;
      lineD += ` C ${cpX} ${coords[i-1].y}, ${cpX} ${coords[i].y}, ${coords[i].x} ${coords[i].y}`;
    }
    
    const fillD = `${lineD} L ${width} ${height} L 0 ${height} Z`;
    return { lineD, fillD };
  };

  if (isResetPasswordPage) {
    return (
      <React.Suspense fallback={<AuthSkeleton />}>
        <ResetPassword
          onComplete={() => {
            setIsResetPasswordPage(false);
            window.history.pushState({}, '', '/');
          }}
        />
      </React.Suspense>
    );
  }

  if (isAuthLoading) {
    return <AuthSkeleton />;
  }

  if (!session) {
    return (
      <React.Suspense fallback={<AuthSkeleton />}>
        <Auth onAuthSuccess={(newSession) => setSession(newSession)} />
      </React.Suspense>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-[#030303] text-zinc-950 dark:text-zinc-100 flex justify-center items-start font-sans antialiased overflow-x-hidden selection:bg-zinc-200 dark:selection:bg-zinc-800 selection:text-zinc-900 dark:selection:text-white transition-colors duration-300">
      {/* Maximum-width wrapper modeled for an incredible mobile aspect layout & gorgeous desktop presentation */}
      <div className="w-full max-w-md bg-white dark:bg-[#080808] min-h-screen pb-36 border-x border-zinc-100 dark:border-zinc-900 shadow-2xl relative flex flex-col transition-colors duration-300">
        
        {/* Minimalist Header - Matches reference UI */}
        <header className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-900/80 flex justify-between items-center bg-white/90 dark:bg-[#080808]/90 sticky top-0 z-40 backdrop-blur-md transition-colors duration-300">
          <div className="flex items-center gap-1 cursor-pointer" onClick={() => setActiveTab('home')}>
            <span className="text-[20px] font-semibold tracking-[-0.03em] text-zinc-950 dark:text-white font-sans">Gaks</span>
            <span className="text-[16px] font-normal tracking-normal text-zinc-400 dark:text-zinc-500 font-sans">AI</span>
          </div>
          <div className="flex items-center gap-3">
            {activeTab !== 'home' && userProfile && (
              <div 
                onClick={() => setActiveTab('settings')}
                className="flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800/60 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all cursor-pointer"
              >
                <div className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-white/10 text-zinc-950 dark:text-white flex items-center justify-center text-[10px] font-semibold uppercase overflow-hidden shrink-0">
                  {profileAvatarUrl ? (
                    <img src={profileAvatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    profileFullName ? profileFullName.charAt(0) : 'U'
                  )}
                </div>
                <span className="text-[11px] font-normal text-zinc-700 dark:text-zinc-300 max-w-[80px] truncate">{profileFullName}</span>
              </div>
            )}
            <button 
              onClick={toggleTheme}
              className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white transition-all rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer" 
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {theme === 'dark' ? <Sun className="w-4.5 h-4.5 stroke-[1.8]" /> : <Moon className="w-4.5 h-4.5 stroke-[1.8]" />}
            </button>
            <button 
              onClick={handleLogout}
              className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white transition-all rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer" 
              title="Logout"
            >
              <LogOut className="w-4.5 h-4.5 stroke-[1.8]" />
            </button>
          </div>
        </header>

        {/* Global Floating Toast Notification */}
        {showNotification && (
          <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-sm px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center gap-2.5 shadow-xl animate-bounce">
            <div className={`p-1 rounded-full ${showNotification.type === 'success' ? 'bg-zinc-800 text-zinc-200' : 'bg-blue-500/10 text-blue-400'}`}>
              <Check className="w-4 h-4 stroke-[2.5]" />
            </div>
            <span className="text-xs font-normal text-zinc-200">{showNotification.message}</span>
          </div>
        )}

        {/* Dynamic scanning indicator */}
        {isAnalyzing && (
          <div className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center justify-center p-6 backdrop-blur-sm">
            <div className="w-16 h-16 rounded-full border-4 border-zinc-800 border-t-white animate-spin mb-6"></div>
            <h3 className="text-lg font-semibold tracking-tight text-white mb-2">Analyzing Markets...</h3>
            <p className="text-xs font-normal text-zinc-400 text-center max-w-xs leading-relaxed">
              Scanning technical oscillators, volume profiles, and historical candle patterns for perfect entries.
            </p>
          </div>
        )}

        {/* Main Content Scroll Container */}
        <main className="flex-1 px-6 pt-6">

          {/* ==================== TAB 1: HOME ==================== */}
          {activeTab === 'home' && (
            <div className="space-y-6 animate-fade-in pb-8">
              
              {/* Live markets status & date row */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-[#121214] w-fit">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse shadow-[0_0_8px_rgba(255,255,255,0.8)]"></span>
                  <span className="text-[13px] text-zinc-600 dark:text-zinc-300 font-normal tracking-normal">Live · markets open</span>
                </div>
                <span className="text-[13px] text-zinc-400 dark:text-zinc-500 font-normal tracking-normal">
                  Updated {formattedTime}
                </span>
              </div>

              {/* Title & Description Header */}
              <div className="space-y-2">
                <h1 className="text-[32px] sm:text-[36px] font-semibold tracking-[-0.035em] text-zinc-950 dark:text-white leading-[1.15] font-sans max-w-[280px] sm:max-w-md">
                  Good signal, good trade.
                </h1>
                <p className="text-[15px] sm:text-[16px] font-normal tracking-[-0.01em] text-zinc-500 dark:text-zinc-400 leading-[1.45] max-w-[340px] sm:max-w-lg">
                  Your AI-curated view of the forex market — refreshed every few seconds.
                </p>
              </div>

              {/* Action Buttons - matched proportions and typography */}
              <div className="flex gap-3.5">
                <button
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="h-11 sm:h-12 flex-1 flex items-center justify-center gap-2 px-5 rounded-full border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-[#141416] text-[14px] sm:text-[15px] font-medium tracking-[-0.01em] text-zinc-950 dark:text-white hover:bg-zinc-100 dark:hover:bg-[#1f1f22] hover:border-zinc-300 dark:hover:border-zinc-700 transition-all cursor-pointer shadow-sm"
                >
                  <RefreshCw className={`w-4 h-4 stroke-[1.8] ${isRefreshing ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
                <button
                  onClick={handleQuickAnalyze}
                  className="h-11 sm:h-12 flex-1 flex items-center justify-center gap-2 px-5 rounded-full bg-zinc-950 dark:bg-white text-[14px] sm:text-[15px] font-semibold tracking-[-0.01em] text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all cursor-pointer shadow-md"
                >
                  <Zap className="w-4 h-4 stroke-[2] fill-current opacity-10 dark:fill-black/10" />
                  <span>Quick Analyze</span>
                </button>
              </div>

              {/* AI Quick Scan recommendation result if present */}
              {analysisResult && (
                <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 flex gap-3.5 items-start">
                  <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500 dark:text-amber-400 shrink-0">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-zinc-950 dark:text-white uppercase tracking-wider">Gaks AI Recommendation</h4>
                    <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">{analysisResult}</p>
                  </div>
                </div>
              )}

              {/* Live Rates Card Deck */}
              <div className="space-y-3.5">
                <div className="space-y-0.5">
                  <h2 className="text-[19px] sm:text-[21px] font-semibold tracking-[-0.025em] text-zinc-950 dark:text-white font-sans">Live Rates</h2>
                  <p className="text-[13px] text-zinc-500 font-normal tracking-normal">Major forex pairs</p>
                </div>

                <div className="space-y-3.5">
                  {isRatesLoading && liveRates.length === 0 ? (
                    [1, 2, 3].map(i => (
                      <div
                        key={i}
                        className="p-6 rounded-3xl border border-zinc-100 dark:border-zinc-800/60 bg-zinc-50/50 dark:bg-[#111113]/60 animate-pulse flex flex-col justify-between min-h-[140px]"
                      >
                        <div className="flex justify-between items-start">
                          <div className="space-y-2">
                            <div className="h-5 w-24 bg-zinc-200 dark:bg-zinc-800 rounded-lg"></div>
                            <div className="h-3 w-32 bg-zinc-100 dark:bg-zinc-900 rounded-md"></div>
                          </div>
                          <div className="h-6 w-16 bg-zinc-200/80 dark:bg-zinc-800/80 rounded-full"></div>
                        </div>
                        <div className="mt-6 flex items-end justify-between gap-4">
                          <div className="w-1/2 h-10 bg-zinc-100/80 dark:bg-zinc-900/80 rounded-xl"></div>
                          <div className="space-y-2 flex flex-col items-end">
                            <div className="h-7 w-28 bg-zinc-200 dark:bg-zinc-800 rounded-lg"></div>
                            <div className="h-4 w-16 bg-zinc-100 dark:bg-zinc-900 rounded-md"></div>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    liveRates.map(pair => {
                      const isNegativeChange = pair.change < 0;
                      const chartColor = pair.sentiment === 'Bullish' ? "#10b981" : pair.sentiment === 'Bearish' ? "#ef4444" : "#71717a";
                      const { lineD, fillD } = getSparklinePaths(pair.history, 110, 28);

                      return (
                        <div
                          key={pair.symbol}
                          className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-[#111113]/90 relative overflow-hidden flex flex-col justify-between hover:border-zinc-300 dark:hover:border-zinc-700 transition-all shadow-lg"
                        >
                          {/* Top Info Row */}
                          <div className="flex justify-between items-start z-10">
                            <div className="space-y-0.5">
                              <h3 className="text-[17px] sm:text-[18px] font-semibold text-zinc-950 dark:text-white tracking-[-0.02em] font-sans">{pair.symbol}</h3>
                              <p className="text-[13px] text-zinc-500 font-normal tracking-normal">{pair.name}</p>
                            </div>
                            <span className={`px-3 py-1 rounded-full text-[12px] font-medium tracking-normal border flex items-center gap-1.5 ${
                              pair.sentiment === 'Bullish'
                                ? 'bg-emerald-50 dark:bg-[#0c1c0c] text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-950/80'
                                : pair.sentiment === 'Bearish'
                                ? 'bg-red-50 dark:bg-[#200c0c] text-red-600 dark:text-[#ef4444] border-red-100 dark:border-[#3f1616]'
                                : 'bg-zinc-50 dark:bg-[#1a1a1e] text-zinc-500 dark:text-[#a1a1aa] border-zinc-200 dark:border-[#27272a]'
                            }`}>
                              {pair.sentiment === 'Bullish' && <TrendingUp className="w-3.5 h-3.5 shrink-0" />}
                              {pair.sentiment === 'Bearish' && <TrendingDown className="w-3.5 h-3.5 shrink-0" />}
                              {pair.sentiment === 'Neutral' && <Minus className="w-3.5 h-3.5 shrink-0" />}
                              <span>{pair.sentiment}</span>
                            </span>
                          </div>

                          {/* Bottom Row: Thinner Chart & Rate Display */}
                          <div className="mt-6 flex items-end justify-between gap-4">
                            {/* Left Curve Plot (Visual Sparkline) */}
                            <div className="w-1/2 max-w-[180px] h-12 opacity-90">
                              <svg className="w-full h-full overflow-visible" viewBox="0 0 110 28" preserveAspectRatio="none">
                                <defs>
                                  <linearGradient id={`grad-${pair.symbol}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={chartColor} stopOpacity="0.25"/>
                                    <stop offset="100%" stopColor={chartColor} stopOpacity="0.0"/>
                                  </linearGradient>
                                </defs>
                                <path d={fillD} fill={`url(#grad-${pair.symbol})`} />
                                <path d={lineD} fill="none" stroke={chartColor} strokeWidth="1.2" />
                              </svg>
                            </div>

                            {/* Right Rate / Badge Column */}
                            <div className="text-right space-y-1 z-10">
                              {pair.status === 'unavailable' ? (
                                <div className="text-[12px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Data unavailable</div>
                              ) : (
                                <>
                                  <div className="text-[24px] sm:text-[26px] font-semibold text-zinc-950 dark:text-white tracking-[-0.03em] font-sans tabular-nums">{pair.price.toLocaleString(undefined, { minimumFractionDigits: pair.price > 10 ? 2 : 4 })}</div>
                                  <div className={`text-[13px] sm:text-[14px] font-medium tracking-normal flex items-center justify-end gap-1 ${isNegativeChange ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                    {isNegativeChange ? <ArrowDownRight className="w-4 h-4 stroke-[2]" /> : <ArrowUpRight className="w-4 h-4 stroke-[2]" />}
                                    <span>{isNegativeChange ? '' : '+'}{pair.change.toFixed(2)}%</span>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Top Movers Section */}
              <div className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-[#111113]/80 space-y-4">
                <div className="flex justify-between items-baseline">
                  <h3 className="text-[16px] sm:text-[17px] font-semibold tracking-[-0.02em] text-zinc-950 dark:text-white font-sans">Top Movers</h3>
                  <span className="text-[12px] text-zinc-500 font-normal tracking-normal">Biggest % change today</span>
                </div>
                <div className="divide-y divide-zinc-200 dark:divide-zinc-900">
                  {isRatesLoading && liveRates.length === 0 ? (
                    <div className="space-y-3 py-2 animate-pulse">
                      {[1, 2, 3, 4].map(i => (
                        <div key={i} className="flex justify-between items-center py-2.5">
                          <div className="space-y-1.5">
                            <div className="h-4 w-16 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
                            <div className="h-2.5 w-24 bg-zinc-100 dark:bg-zinc-900 rounded"></div>
                          </div>
                          <div className="space-y-1.5 flex flex-col items-end">
                            <div className="h-4 w-14 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
                            <div className="h-2.5 w-10 bg-zinc-100 dark:bg-zinc-900 rounded"></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : liveRates.filter(r => r.status !== 'unavailable' && r.price > 0).length > 0 ? (
                    [...liveRates]
                      .filter(r => r.status !== 'unavailable' && r.price > 0)
                      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
                      .slice(0, 5)
                      .map((mover, idx) => (
                        <div key={idx} className="py-3 flex justify-between items-center first:pt-0 last:pb-0">
                          <div>
                            <div className="text-[14px] sm:text-[15px] font-semibold tracking-[-0.015em] text-zinc-950 dark:text-white">{mover.symbol}</div>
                            <div className="text-[12px] text-zinc-500 font-normal tracking-normal">{mover.name}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[14px] sm:text-[15px] font-semibold tracking-[-0.02em] text-zinc-950 dark:text-white tabular-nums">{mover.price.toLocaleString(undefined, { minimumFractionDigits: mover.price > 10 ? 2 : 4 })}</div>
                            <div className={`text-[13px] font-medium tracking-normal ${mover.change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-[#ef4444]'}`}>
                              {mover.change >= 0 ? '+' : ''}{mover.change.toFixed(2)}%
                            </div>
                          </div>
                        </div>
                      ))
                  ) : (
                    <div className="py-8 text-center text-zinc-500 text-xs font-medium">
                      Gathering market movement data...
                    </div>
                  )}
                </div>
              </div>

              {/* Trending Pairs Grid */}
              <div className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-[#111113]/80 space-y-4">
                <div className="flex flex-col">
                  <span className="text-[19px] sm:text-[21px] font-semibold tracking-[-0.025em] text-zinc-950 dark:text-white font-sans">Trending Pairs</span>
                  <span className="text-[13px] text-zinc-500 mt-0.5 font-normal tracking-normal">What traders are watching</span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {isRatesLoading && liveRates.length === 0 ? (
                    [1, 2, 3, 4].map(i => (
                      <div key={i} className="p-4 rounded-2xl border border-zinc-100 dark:border-zinc-800/60 bg-zinc-100/60 dark:bg-[#161618]/60 flex flex-col justify-between h-24 sm:h-28 animate-pulse">
                        <div className="flex justify-between items-center">
                          <div className="h-4 w-14 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
                          <div className="h-3 w-10 bg-zinc-100 dark:bg-zinc-900 rounded"></div>
                        </div>
                        <div className="w-full h-8 bg-zinc-200/80 dark:bg-zinc-900/80 rounded-lg mt-3"></div>
                      </div>
                    ))
                  ) : liveRates.filter(r => r.status !== 'unavailable' && r.price > 0).length > 0 ? (
                    liveRates.filter(r => r.status !== 'unavailable' && r.price > 0).slice(0, 4).map((trend, idx) => {
                      const isBearish = trend.change < 0;
                      const { lineD, fillD } = getSparklinePaths(trend.history.length > 0 ? trend.history : [10, 10, 10], 80, 18);
                      return (
                        <div key={idx} className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-[#161618] relative overflow-hidden flex flex-col justify-between h-24 sm:h-28 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all shadow-sm">
                          <div className="flex justify-between items-center z-10">
                            <span className="text-[14px] sm:text-[15px] font-semibold tracking-[-0.02em] text-zinc-950 dark:text-white">{trend.symbol}</span>
                            <span className={`text-[13px] font-medium tracking-normal ${isBearish ? 'text-red-600 dark:text-[#ef4444]' : 'text-emerald-600 dark:text-emerald-400'}`}>
                              {trend.change >= 0 ? '+' : ''}{trend.change.toFixed(2)}%
                            </span>
                          </div>
                          {/* Mini Sparkline in trend cards - thinner stroke */}
                          <div className="h-8 sm:h-10 w-full opacity-90 z-0 mt-2">
                            {trend.history.length > 0 && (
                              <svg className="w-full h-full overflow-visible" viewBox="0 0 80 18" preserveAspectRatio="none">
                                <defs>
                                  <linearGradient id={`trend-grad-${idx}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={isBearish ? "#ef4444" : "#10b981"} stopOpacity="0.25"/>
                                    <stop offset="100%" stopColor={isBearish ? "#ef4444" : "#10b981"} stopOpacity="0.0"/>
                                  </linearGradient>
                                </defs>
                                <path d={fillD} fill={`url(#trend-grad-${idx})`} />
                                <path d={lineD} fill="none" stroke={isBearish ? "#ef4444" : "#10b981"} strokeWidth="1.2" />
                              </svg>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="col-span-2 py-6 text-center text-zinc-500 text-xs font-medium">Awaiting trend data...</div>
                  )}
                </div>
              </div>

              {/* Market Heatmap Section */}
              <div className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#111113]/80 space-y-4">
                <div className="flex flex-col">
                  <span className="text-[19px] sm:text-[21px] font-semibold tracking-[-0.025em] text-zinc-950 dark:text-white font-sans">Market Heatmap</span>
                  <span className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5 font-normal tracking-normal">Performance at a glance</span>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                  {isRatesLoading && liveRates.length === 0 ? (
                    [1, 2, 3, 4, 5, 6].map(i => (
                      <div key={i} className="aspect-square rounded-2xl bg-zinc-100 dark:bg-zinc-900/50 border border-zinc-200/40 dark:border-zinc-800/40 flex flex-col justify-center items-center p-2 animate-pulse gap-1">
                        <div className="h-3 w-8 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
                        <div className="h-2.5 w-6 bg-zinc-100 dark:bg-zinc-900 rounded"></div>
                      </div>
                    ))
                  ) : liveRates.filter(r => r.status !== 'unavailable' && r.price > 0).length > 0 ? (
                    liveRates.filter(r => r.status !== 'unavailable' && r.price > 0).slice(0, 18).map((pair, idx) => {
                      const isBearish = pair.change < 0;
                      const absChange = Math.abs(pair.change);
                      
                      // Intensity: Very Light, Medium, Strong, Vivid
                      const intensity = absChange < 0.25 ? 'opacity-30' : absChange < 0.75 ? 'opacity-50' : absChange < 1.5 ? 'opacity-70' : 'opacity-100';
                      
                      const bgColor = isBearish 
                        ? `bg-rose-600 ${intensity}` 
                        : `bg-emerald-600 ${intensity}`;

                      return (
                        <div
                          key={idx}
                          className={`aspect-[4/3] rounded-2xl p-3 flex flex-col justify-between transition-all hover:scale-[1.05] cursor-pointer ${bgColor} shadow-sm`}
                        >
                          <div className="flex justify-between items-start">
                            <span className="text-[10px] sm:text-[11px] font-bold text-white tracking-wide">{pair.symbol}</span>
                            {isBearish ? <TrendingDown className="w-3 h-3 text-white/90" /> : <TrendingUp className="w-3 h-3 text-white/90" />}
                          </div>
                          <div className="text-[12px] sm:text-[13px] font-bold text-white text-right">
                             {pair.change >= 0 ? '+' : ''}{pair.change.toFixed(2)}%
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="col-span-3 sm:col-span-4 lg:col-span-6 py-8 text-center text-zinc-400 dark:text-zinc-500 text-xs font-medium">Generating heatmap from live data...</div>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* ==================== TAB 2: STRATEGY ==================== */}
          {activeTab === 'strategy' && (
            <StrategyTab
              strategies={strategies}
              selectedStrategyId={selectedStrategyId}
              activeStrategyId={activeStrategyId}
              lastSavedStrategyText={lastSavedStrategyText}
              GAKS_DEFAULT_STRATEGY={GAKS_DEFAULT_STRATEGY}
              strategyTextareaRef={strategyTextareaRef}
              handleClearStrategy={handleClearStrategy}
              handleRestoreStrategy={handleRestoreStrategy}
              handleSetActiveStrategy={handleSetActiveStrategy}
              handleStrategyTextChange={handleStrategyTextChange}
              saveStrategyPlaybook={saveStrategyPlaybook}
              capital={capital}
              setCapital={setCapital}
              customCapital={customCapital}
              setCustomCapital={setCustomCapital}
              preferredRisk={preferredRisk}
              setPreferredRisk={setPreferredRisk}
              riskReward={riskReward}
              setRiskReward={setRiskReward}
              positionMode={positionMode}
              setPositionMode={setPositionMode}
              fixedLotSize={fixedLotSize}
              setFixedLotSize={setFixedLotSize}
              accountType={accountType}
              setAccountType={setAccountType}
              preferredSessions={preferredSessions}
              toggleSession={toggleSession}
              preferredTimeframes={preferredTimeframes}
              toggleTimeframe={toggleTimeframe}
              isPrefsDirty={isPrefsDirty}
              savePreferences={savePreferences}
            />
          )}

          {/* ==================== TAB 3: MARKET WATCHER ==================== */}
          {activeTab === 'watcher' && (
            <WatcherTab
              isTelegramLoading={isTelegramLoading}
              telegramConnection={telegramConnection}
              isTelegramConnecting={isTelegramConnecting}
              handleConnectTelegram={handleConnectTelegram}
              isWatcherActive={isWatcherActive}
              watcherTradeStatus={watcherTradeStatus}
              watcherSearch={watcherSearch}
              setWatcherSearch={setWatcherSearch}
              watcherTimeframe={watcherTimeframe}
              setWatcherTimeframe={setWatcherTimeframe}
              watcherLastScanAt={watcherLastScanAt}
              watcherLastCandle={watcherLastCandle}
              watcherErrorMessage={watcherErrorMessage}
              isTimeframeMismatch={isTimeframeMismatch}
              compiledStrategyTimeframes={compiledStrategyTimeframes}
              watchlist={watchlist}
              stopAiMarketWatcher={stopAiMarketWatcher}
              startAiMarketWatcher={startAiMarketWatcher}
              isAdmin={isAdmin}
              triggerNotification={triggerNotification}
              getSparklinePaths={getSparklinePaths}
              handleRemovePair={handleRemovePair}
              geminiKeyExists={geminiKeyExists}
              onGoToSettings={() => setActiveTab('settings')}
            />
          )}

          {/* ==================== TAB 4: SETTINGS & PROFILE ==================== */}
          {activeTab === 'settings' && (
            <SettingsTab
              profileAvatarUrl={profileAvatarUrl}
              setProfileAvatarUrl={setProfileAvatarUrl}
              profileFullName={profileFullName}
              setProfileFullName={setProfileFullName}
              profilePlan={profilePlan}
              setProfilePlan={setProfilePlan}
              session={session}
              handleUpdateProfile={handleUpdateProfile}
              isProfileUpdating={isProfileUpdating}
              geminiKey={geminiKey}
              setGeminiKey={setGeminiKey}
              geminiKeyExists={geminiKeyExists}
              handleSaveGeminiKey={handleSaveGeminiKey}
              isGeminiKeySaving={isGeminiKeySaving}
              handleLogout={handleLogout}
              theme={theme}
              toggleTheme={toggleTheme}
              handleTestGeminiKey={handleTestGeminiKey}
              isGeminiKeyTesting={isGeminiKeyTesting}
              geminiTestResult={geminiTestResult}
              geminiStatus={geminiStatus}
              handleDeleteGeminiKey={handleDeleteGeminiKey}
              geminiSaveError={geminiKeyError}
              geminiSaveSuccess={geminiKeySuccess}
            />
          )}

          {/* ==================== TAB 5: ADMIN ==================== */}
          {activeTab === 'admin' && (
            <AdminDashboard userProfile={userProfile} session={session} authLoading={isAuthLoading} />
          )}

        </main>

        {/* Floating/Bottom Navigation Bar - Matches minimalist reference UI */}
        <nav className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[416px] bg-white/95 dark:bg-[#0c0c0e]/95 border border-zinc-200 dark:border-zinc-800/80 px-4 py-2 z-50 backdrop-blur-xl rounded-full flex justify-between items-center shadow-2xl">
          <button
            onClick={() => setActiveTab('home')}
            className={`flex-1 flex flex-col items-center gap-1 cursor-pointer transition-all ${
              activeTab === 'home'
                ? 'text-zinc-950 dark:text-white'
                : 'text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300'
            }`}
          >
            <div className={`py-1.5 px-3 rounded-2xl flex flex-col items-center gap-1 transition-all ${
              activeTab === 'home' ? 'bg-zinc-100 dark:bg-[#1a1a1e] text-zinc-950 dark:text-white shadow-sm font-medium' : ''
            }`}>
              <HomeIcon className="w-4 h-4 stroke-[1.8]" />
              <span className="text-[10px] font-medium tracking-normal">Home</span>
            </div>
          </button>

          <button
            onClick={() => setActiveTab('strategy')}
            className={`flex-1 flex flex-col items-center gap-1 cursor-pointer transition-all ${
              activeTab === 'strategy'
                ? 'text-zinc-950 dark:text-white'
                : 'text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300'
            }`}
          >
            <div className={`py-1.5 px-3 rounded-2xl flex flex-col items-center gap-1 transition-all ${
              activeTab === 'strategy' ? 'bg-zinc-100 dark:bg-[#1a1a1e] text-zinc-950 dark:text-white shadow-sm font-medium' : ''
            }`}>
              <TrendingUp className="w-4 h-4 stroke-[1.8]" />
              <span className="text-[10px] font-medium tracking-normal">Strategy</span>
            </div>
          </button>

          <button
            onClick={() => setActiveTab('watcher')}
            className={`flex-1 flex flex-col items-center gap-1 cursor-pointer transition-all ${
              activeTab === 'watcher'
                ? 'text-zinc-950 dark:text-white'
                : 'text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300'
            }`}
          >
            <div className={`py-1.5 px-3 rounded-2xl flex flex-col items-center gap-1 transition-all ${
              activeTab === 'watcher' ? 'bg-zinc-100 dark:bg-[#1a1a1e] text-zinc-950 dark:text-white shadow-sm font-medium' : ''
            }`}>
              <Eye className="w-4 h-4 stroke-[1.8]" />
              <span className="text-[10px] font-medium tracking-normal">Watcher</span>
            </div>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`flex-1 flex flex-col items-center gap-1 cursor-pointer transition-all ${
              activeTab === 'settings'
                ? 'text-zinc-950 dark:text-white'
                : 'text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300'
            }`}
          >
            <div className={`py-1.5 px-3 rounded-2xl flex flex-col items-center gap-1 transition-all ${
              activeTab === 'settings' ? 'bg-zinc-100 dark:bg-[#1a1a1e] text-zinc-950 dark:text-white shadow-sm font-medium' : ''
            }`}>
              <SettingsIcon className="w-4 h-4 stroke-[1.8]" />
              <span className="text-[10px] font-medium tracking-normal">Settings</span>
            </div>
          </button>
          
          {session?.user?.email === 'gaks6535@gmail.com' && (
            <button
              onClick={() => setActiveTab('admin')}
              className={`flex-1 flex flex-col items-center gap-1 cursor-pointer transition-all ${
                activeTab === 'admin'
                  ? 'text-zinc-950 dark:text-white'
                  : 'text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300'
              }`}
            >
              <div className={`py-1.5 px-3 rounded-2xl flex flex-col items-center gap-1 transition-all ${
                activeTab === 'admin' ? 'bg-zinc-100 dark:bg-[#1a1a1e] text-zinc-950 dark:text-white shadow-sm font-medium' : ''
              }`}>
                <Shield className="w-4 h-4 stroke-[1.8]" />
                <span className="text-[10px] font-medium tracking-normal">Admin</span>
              </div>
            </button>
          )}
        </nav>

      </div>
    </div>
  );
}
