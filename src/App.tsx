import React, { useState, useEffect, useMemo } from 'react';
import { useLiveRates } from './hooks/useLiveRates';
import { supabase } from './supabaseClient';
import { getGeminiKey, saveGeminiKey, deleteGeminiKey } from './lib/apiKeys';
import Auth from './components/Auth';
import AdminDashboard from './components/admin/AdminDashboard';
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
  User as UserIcon,
  Settings as SettingsIcon,
  Shield,
  CheckCircle2,
  Lock,
  Key,
  Send
} from 'lucide-react';

import { getTelegramConnection, initiateTelegramConnection, getTelegramDeepLink } from './lib/telegram';


// Interfaces
interface ForexPair {
  symbol: string;
  name: string;
  price: number;
  change: number;
  sentiment: 'Bearish' | 'Bullish';
  history: number[];
}

interface WatchlistItem {
  symbol: string;
  name: string;
  price: number;
  change: number;
  spread: number;
  volatility: 'Low' | 'Medium' | 'High';
  confidence: number;
  direction: 'Bullish' | 'Bearish' | 'Neutral';
  history: number[];
  timeframe: string;
}

interface Strategy {
  id: string;
  name: string;
  text: string;
  isDefault: boolean;
}

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
    const existingCustom: Strategy = {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'My Custom Strategy',
      isDefault: false,
      text: rawText
    };
    return {
      activeId: '11111111-1111-1111-1111-111111111111',
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

  useEffect(() => {
    if (window.location.pathname === '/admin') {
      setActiveTab('admin');
    }
  }, []);
  const [currentTime, setCurrentTime] = useState<Date>(new Date('2026-06-28T15:01:00'));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  
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
  const [geminiKeyExists, setGeminiKeyExists] = useState(false);
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
  const [preferredSessions, setPreferredSessions] = useState<string[]>(['London', 'New York', 'Tokyo']);
  const [preferredTimeframes, setPreferredTimeframes] = useState<string[]>(['M15', 'H1']);
  const [showNotification, setShowNotification] = useState<{message: string; type: 'success' | 'info'} | null>(null);

  // Market Watcher States
  const [watcherSearch, setWatcherSearch] = useState<string>('');
  const [watcherTimeframe, setWatcherTimeframe] = useState<string>('H1');
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);

  // Watchlist Sync Helpers
  const loadWatchlistFromSupabase = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('watchlist_items')
        .select('*')
        .eq('user_id', userId);

      if (error) {
        console.warn("Could not load watchlist items from Supabase (falling back to local storage):", error.message);
        return;
      }

      if (data && data.length > 0) {
        const mapped: WatchlistItem[] = data.map((item: any) => ({
          symbol: item.symbol,
          name: item.name,
          price: Number(item.price),
          change: Number(item.change),
          spread: Number(item.spread),
          volatility: item.volatility,
          confidence: item.confidence,
          direction: item.direction,
          history: item.history || [],
          timeframe: item.timeframe || 'H1'
        }));
        setWatchlist(mapped);
        localStorage.setItem('gaks_watchlist', JSON.stringify(mapped));
      }
    } catch (err) {
      console.error("Exception loading watchlist from Supabase:", err);
    }
  };

  const addWatchlistItemToSupabase = async (item: WatchlistItem, userId: string) => {
    try {
      const { error } = await supabase
        .from('watchlist_items')
        .upsert({
          user_id: userId,
          symbol: item.symbol,
          name: item.name,
          price: item.price,
          change: item.change,
          spread: item.spread,
          volatility: item.volatility,
          confidence: item.confidence,
          direction: item.direction,
          history: item.history,
          timeframe: item.timeframe || 'H1',
          created_at: new Date().toISOString()
        }, { onConflict: 'user_id,symbol' });

      if (error) {
        console.warn("Could not save watchlist item to Supabase (using local storage fallback):", error.message);
      }
    } catch (err) {
      console.error("Exception saving watchlist item to Supabase:", err);
    }
  };

  const deleteWatchlistItemFromSupabase = async (symbol: string, userId: string) => {
    try {
      const { error } = await supabase
        .from('watchlist_items')
        .delete()
        .eq('user_id', userId)
        .eq('symbol', symbol);

      if (error) {
        console.warn("Could not delete watchlist item from Supabase (using local storage fallback):", error.message);
      }
    } catch (err) {
      console.error("Exception deleting watchlist item from Supabase:", err);
    }
  };

  // Auth Restoration & Change Subscription logic
  useEffect(() => {
    const initAuth = async () => {
      try {
        const { data: { session: activeSession } } = await supabase.auth.getSession();
        if (activeSession) {
          setSession(activeSession);
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', activeSession.user.id)
            .single();
            
          if (profile) {
            setUserProfile(profile);
            setProfileFullName(profile.full_name);
            setProfilePlan(profile.subscription_plan || 'Free');
            setProfileTelegram(profile.telegram_connected || false);
            setProfileAvatarUrl(profile.avatar_url || '');
          }
          // Sync watchlist
          loadWatchlistFromSupabase(activeSession.user.id);
          
          // Load Telegram Connection
          loadTelegramConnection(activeSession.user.id);
          
          // Load Trading Preferences
          loadTradingPreferences(activeSession.user.id);
          
          // Load Watcher Status
          loadWatcherStatus(activeSession.user.id);
        }
      } catch (err) {
        console.error('Error restoring session:', err);
      } finally {
        setIsAuthLoading(false);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: string, currentSession: any) => {
      if (currentSession) {
        setSession(currentSession);
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', currentSession.user.id)
          .single();
          
        if (profile) {
          setUserProfile(profile);
          setProfileFullName(profile.full_name);
          setProfilePlan(profile.subscription_plan || 'Free');
          setProfileTelegram(profile.telegram_connected || false);
          setProfileAvatarUrl(profile.avatar_url || '');
        }
        // Sync watchlist
        loadWatchlistFromSupabase(currentSession.user.id);
        
        // Load Telegram Connection
        loadTelegramConnection(currentSession.user.id);
        
        // Load Trading Preferences
        loadTradingPreferences(currentSession.user.id);
        
        // Load Watcher Status
        loadWatcherStatus(currentSession.user.id);
      } else {
        setSession(null);
        setUserProfile(null);
        setTelegramConnection(null);
        setTelegramSuccessMessage(null);
        setTelegramErrorMessage(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Poll & Listen for Telegram Connection activation
  useEffect(() => {
    if (!session?.user) return;

    const checkAndTriggerActivation = async () => {
      const pendingToken = localStorage.getItem('gaks_pending_telegram_token');
      const pendingUserId = localStorage.getItem('gaks_pending_telegram_user');

      // Reload the state (this updates the UI instantly if the backend updated it)
      await loadTelegramConnection(session.user.id, false);
      
      if (pendingToken && pendingUserId === session.user.id) {
        // We need to check if it's connected now
        const { data } = await getTelegramConnection(session.user.id);
        if (data && data.connected) {
          localStorage.removeItem('gaks_pending_telegram_token');
          localStorage.removeItem('gaks_pending_telegram_user');
          triggerNotification("Telegram linked successfully!", "success");
          setTelegramSuccessMessage("Telegram Connected!");
        }
      }
    };

    // Initial check
    checkAndTriggerActivation();

    // 1. Focus listener: instantly updates when user switches back to this tab
    const handleFocus = () => {
      checkAndTriggerActivation();
    };
    window.addEventListener('focus', handleFocus);

    // 2. Continuous Polling interval: background check every 4 seconds
    const interval = setInterval(() => {
      checkAndTriggerActivation();
    }, 4000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      clearInterval(interval);
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
        localStorage.setItem('gaks_strategy_text', serialized);
      }
      
      const savedCapital = localStorage.getItem('gaks_capital');
      if (savedCapital) setCapital(savedCapital);

      const savedCustomCapital = localStorage.getItem('gaks_custom_capital');
      if (savedCustomCapital) setCustomCapital(savedCustomCapital);
      
      const savedRisk = localStorage.getItem('gaks_preferred_risk');
      if (savedRisk) setPreferredRisk(savedRisk);
      
      const savedRR = localStorage.getItem('gaks_risk_reward');
      if (savedRR) setRiskReward(savedRR);
      
      const savedAccount = localStorage.getItem('gaks_account_type');
      if (savedAccount === 'personal' || savedAccount === 'prop') setAccountType(savedAccount);
      
      const savedSessions = localStorage.getItem('gaks_sessions');
      if (savedSessions) setPreferredSessions(JSON.parse(savedSessions));
      
      const savedTimeframes = localStorage.getItem('gaks_timeframes');
      if (savedTimeframes) setPreferredTimeframes(JSON.parse(savedTimeframes));

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
    const serialized = serializeStrategies(activeStrategyId, strategies);
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
          console.error("Error saving strategy to Supabase:", error.message);
          triggerNotification("Saved locally. Supabase sync failed.", "info");
        } else {
          triggerNotification("Strategy playbook saved & synchronized successfully!");
        }
      } catch (err: any) {
        console.error("Exception saving strategy to Supabase:", err);
        triggerNotification("Saved locally.", "info");
      }
    } else {
      triggerNotification("Strategy playbook saved successfully!");
    }
  };

  const resetStrategyPlaybook = () => {
    if (selectedStrategyId === 'default') {
      const updatedList = strategies.map(s => {
        if (s.id === 'default') {
          return { ...s, text: GAKS_DEFAULT_STRATEGY.text };
        }
        return s;
      });
      setStrategies(updatedList);
      const serialized = serializeStrategies(activeStrategyId, updatedList);
      setStrategyText(serialized);
      localStorage.setItem('gaks_strategy_text', serialized);
      triggerNotification("Default strategy restored to institutional playbook", "info");
    } else {
      const updatedList = strategies.map(s => {
        if (s.id === selectedStrategyId) {
          return { ...s, text: `• Entry conditions\n• Confirmation indicators\n• Exit & stop-loss logic\n• Risk management rules` };
        }
        return s;
      });
      setStrategies(updatedList);
      const serialized = serializeStrategies(activeStrategyId, updatedList);
      setStrategyText(serialized);
      localStorage.setItem('gaks_strategy_text', serialized);
      triggerNotification("Playbook reset to blank template", "info");
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
    if (selectedStrategyId === 'default') return;
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

  const syncStrategy = () => {
    triggerNotification("Syncing playbook with Gaks AI Engine...");
    setTimeout(() => {
      triggerNotification("All parameters synchronized successfully!");
    }, 1500);
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
      const { data, error } = await supabase
        .from('profiles')
        .update({
          full_name: profileFullName,
          subscription_plan: profilePlan,
          telegram_connected: profileTelegram,
          avatar_url: profileAvatarUrl,
        })
        .eq('id', session.user.id);

      if (error) {
        triggerNotification(error.message, "info");
      } else {
        setUserProfile({
          ...userProfile,
          full_name: profileFullName,
          subscription_plan: profilePlan,
          telegram_connected: profileTelegram,
          avatar_url: profileAvatarUrl,
        });
        triggerNotification("Profile details saved successfully!", "success");
      }
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
        }
        if (data.capital) setCapital(data.capital);
        if (data.custom_capital) setCustomCapital(data.custom_capital);
        if (data.preferred_risk) setPreferredRisk(data.preferred_risk);
        if (data.risk_reward) setRiskReward(data.risk_reward);
        if (data.account_type === 'personal' || data.account_type === 'prop') {
          setAccountType(data.account_type);
        }
        if (data.preferred_sessions) setPreferredSessions(data.preferred_sessions);
        if (data.preferred_timeframes) setPreferredTimeframes(data.preferred_timeframes);
      }
    } catch (err: any) {
      console.error("Exception loading trading preferences:", err);
    }
  };

  const loadWatcherStatus = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('watchers')
        .select('status, selected_pair, selected_timeframe')
        .eq('user_id', userId)
        .maybeSingle();
        
      if (data) {
        setIsWatcherActive(data.status === 'active');
        if (data.selected_pair) setWatcherSearch(data.selected_pair);
        if (data.selected_timeframe) setWatcherTimeframe(data.selected_timeframe);
      }
    } catch (err) {
      console.error("Error loading watcher status:", err);
    }
  };

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
      } else {
        setGeminiKey('');
        setGeminiKeyExists(false);
      }
    } catch (err: any) {
      console.error("Error loading Gemini key:", err);
    } finally {
      setIsGeminiKeyLoading(false);
    }
  };

  const handleSaveGeminiKey = async () => {
    setGeminiKeySuccess(null);
    setGeminiKeyError(null);
    const trimmed = geminiKey.trim();
    if (!trimmed) {
      setGeminiKeyError("API Key cannot be empty.");
      triggerNotification("API Key cannot be empty.", "info");
      return;
    }

    setIsGeminiKeySaving(true);
    try {
      const result = await saveGeminiKey(trimmed);
      if (result.success) {
        setGeminiKeyExists(true);
        setGeminiKeySuccess(geminiKeyExists ? "Gemini API key updated successfully!" : "Gemini API key saved successfully!");
        triggerNotification(geminiKeyExists ? "Gemini API key updated!" : "Gemini API key saved!", "success");
      } else {
        setGeminiKeyError(result.error || "Failed to save API key.");
        triggerNotification(result.error || "Failed to save API key.", "info");
      }
    } catch (err: any) {
      setGeminiKeyError(err.message || "An unexpected error occurred.");
    } finally {
      setIsGeminiKeySaving(false);
    }
  };

  const handleDeleteGeminiKey = async () => {
    setGeminiKeySuccess(null);
    setGeminiKeyError(null);
    if (!window.confirm("Are you sure you want to delete your saved Gemini API key?")) {
      return;
    }

    setIsGeminiKeySaving(true);
    try {
      const result = await deleteGeminiKey();
      if (result.success) {
        setGeminiKey('');
        setGeminiKeyExists(false);
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
        triggerNotification(errMsg, "info");
        return;
      }

      setIsWatcherActive(true);
      setWatcherErrorMessage(null);
      triggerNotification(result.message || "AI Market Watcher activated successfully!", "success");

      handleAddPair(targetSymbol, targetTimeframe);
    } catch (err: any) {
      console.error("Exception in startAiMarketWatcher:", err);
      setWatcherErrorMessage(err.message || "An unexpected error occurred during activation.");
      triggerNotification("Activation failed", "info");
    }
  };

  const stopAiMarketWatcher = async () => {
    if (session?.user) {
      try {
        await supabase
          .from('watchers')
          .update({ status: 'inactive', updated_at: new Date().toISOString() })
          .eq('user_id', session.user.id);
          
        await supabase
          .from('watchlist_items')
          .delete()
          .eq('user_id', session.user.id);
      } catch (err) {
        console.error("Error stopping watcher:", err);
      }
    }
    setIsWatcherActive(false);
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
    localStorage.setItem('gaks_capital', capital);
    localStorage.setItem('gaks_custom_capital', customCapital);
    localStorage.setItem('gaks_preferred_risk', preferredRisk);
    localStorage.setItem('gaks_risk_reward', riskReward);
    localStorage.setItem('gaks_account_type', accountType);
    localStorage.setItem('gaks_sessions', JSON.stringify(preferredSessions));
    localStorage.setItem('gaks_timeframes', JSON.stringify(preferredTimeframes));
    
    if (session?.user) {
      try {
        const { error } = await supabase
          .from('trading_preferences')
          .upsert({
            user_id: session.user.id,
            capital: capital,
            custom_capital: customCapital,
            preferred_risk: preferredRisk,
            risk_reward: riskReward,
            account_type: accountType,
            preferred_sessions: preferredSessions,
            preferred_timeframes: preferredTimeframes,
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id' });
          
        if (error) {
          console.error("Error saving preferences to Supabase:", error.message);
          triggerNotification("Preferences saved locally. Sync failed.", "info");
        } else {
          triggerNotification("Trading preferences saved & synced successfully!");
        }
      } catch (err: any) {
        console.error("Exception saving preferences to Supabase:", err);
        triggerNotification("Preferences saved locally.", "info");
      }
    } else {
      triggerNotification("Trading preferences successfully saved!");
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
  const handleAddPair = (symbolToAdd: string, timeframeToWatch: string = 'H1') => {
    const cleanSymbol = symbolToAdd.trim().toUpperCase();
    if (!cleanSymbol) return;

    // Generate random realistic metrics for this symbol
    const basePrice = cleanSymbol.includes('JPY') ? 150 + Math.random() * 20 : 1 + Math.random() * 1.5;
    const isGold = cleanSymbol.includes('XAU') || cleanSymbol.includes('GOLD');
    const isCrypto = cleanSymbol.includes('BTC') || cleanSymbol.includes('ETH');
    const finalPrice = isGold ? 2300 + Math.random() * 100 : isCrypto ? (cleanSymbol.includes('BTC') ? 60000 + Math.random() * 5000 : 3000 + Math.random() * 200) : basePrice;

    const changeVal = Number((Math.random() * 3 - 1.5).toFixed(2));
    const newPair: WatchlistItem = {
      symbol: cleanSymbol,
      name: getFullNameForSymbol(cleanSymbol),
      price: Number(finalPrice.toFixed(isGold || isCrypto ? 2 : 4)),
      change: changeVal,
      spread: Number((0.2 + Math.random() * 1.8).toFixed(1)),
      volatility: Math.random() > 0.6 ? 'High' : Math.random() > 0.3 ? 'Medium' : 'Low',
      confidence: Math.floor(55 + Math.random() * 40),
      direction: changeVal > 0.3 ? 'Bullish' : changeVal < -0.3 ? 'Bearish' : 'Neutral',
      history: Array.from({ length: 7 }, () => finalPrice * (1 + (Math.random() * 0.02 - 0.01))),
      timeframe: timeframeToWatch
    };

    const updatedWatchlist = [newPair];
    setWatchlist(updatedWatchlist);
    localStorage.setItem('gaks_watchlist', JSON.stringify(updatedWatchlist));
    setWatcherSearch(cleanSymbol);
    
    if (session?.user) {
      // First, delete old watchlist items to maintain only one
      supabase.from('watchlist_items').delete().eq('user_id', session.user.id).then(() => {
        addWatchlistItemToSupabase(newPair, session.user.id);
      });
    }
    
    triggerNotification(`${cleanSymbol} added to watchlist!`);
  };

  const handleRemovePair = (symbolToRemove: string) => {
    const updatedWatchlist = watchlist.filter(w => w.symbol !== symbolToRemove);
    setWatchlist(updatedWatchlist);
    localStorage.setItem('gaks_watchlist', JSON.stringify(updatedWatchlist));
    
    if (session?.user) {
      deleteWatchlistItemFromSupabase(symbolToRemove, session.user.id);
    }
    
    triggerNotification(`${symbolToRemove} removed from watchlist`, 'info');
  };

  const getFullNameForSymbol = (symbol: string): string => {
    const map: Record<string, string> = {
      EURUSD: 'Euro / US Dollar',
      GBPUSD: 'British Pound / US Dollar',
      XAUUSD: 'Gold / US Dollar',
      BTCUSD: 'Bitcoin / US Dollar',
      ETHUSD: 'Ethereum / US Dollar',
      NAS100: 'Nasdaq 100 Index',
      US30: 'Dow Jones 30 Index',
      USDJPY: 'US Dollar / Japanese Yen',
      USDCHF: 'US Dollar / Swiss Franc',
      AUDUSD: 'Australian Dollar / US Dollar',
      EURGBP: 'Euro / British Pound',
      GBPJPY: 'British Pound / Japanese Yen'
    };
    return map[symbol] || `${symbol.slice(0,3)} / ${symbol.slice(3)}`;
  };

  // Helper to generate coordinates for sparkline graph
  const getSparklinePaths = (points: number[], width = 100, height = 30) => {
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const coords = points.map((val, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 6) - 3;
      return { x, y };
    });
    
    let lineD = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 1; i < coords.length; i++) {
      const cpX = (coords[i-1].x + coords[i].x) / 2;
      lineD += ` C ${cpX} ${coords[i-1].y}, ${cpX} ${coords[i].y}, ${coords[i].x} ${coords[i].y}`;
    }
    
    const fillD = `${lineD} L ${width} ${height} L 0 ${height} Z`;
    return { lineD, fillD };
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen w-full bg-[#030303] flex flex-col justify-center items-center gap-4">
        <div className="w-10 h-10 rounded-full border-2 border-zinc-900 border-t-zinc-400 animate-spin"></div>
        <div className="flex items-center gap-1.5">
          <span className="text-xl font-bold tracking-tight text-white font-display">Gaks</span>
          <span className="text-sm font-semibold text-zinc-500 font-display">AI</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Auth onAuthSuccess={(newSession) => setSession(newSession)} />;
  }

  return (
    <div className="min-h-screen bg-[#030303] text-zinc-100 flex justify-center items-start font-sans antialiased overflow-x-hidden selection:bg-zinc-800 selection:text-white">
      {/* Maximum-width wrapper modeled for an incredible mobile aspect layout & gorgeous desktop presentation */}
      <div className="w-full max-w-md bg-[#080808] min-h-screen pb-32 border-x border-zinc-900 shadow-2xl relative flex flex-col">
        
        {/* Header - Matches Screenshot 2 */}
        <header className="px-6 py-5 border-b border-zinc-900/80 flex justify-between items-center bg-[#080808]/90 sticky top-0 z-40 backdrop-blur-md">
          <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => setActiveTab('home')}>
            <span className="text-xl font-bold tracking-tight text-white font-display">Gaks</span>
            <span className="text-sm font-semibold text-zinc-500 font-display">AI</span>
          </div>
          <div className="flex items-center gap-3">
            {userProfile && (
              <div 
                onClick={() => setActiveTab('settings')}
                className="flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900/50 border border-zinc-800/60 hover:border-zinc-700 transition-all cursor-pointer"
              >
                <div className="w-5 h-5 rounded-full bg-white/10 text-white flex items-center justify-center text-[10px] font-bold uppercase overflow-hidden shrink-0">
                  {profileAvatarUrl ? (
                    <img src={profileAvatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    profileFullName ? profileFullName.charAt(0) : 'U'
                  )}
                </div>
                <span className="text-[10px] font-semibold text-zinc-300 max-w-[80px] truncate">{profileFullName}</span>
              </div>
            )}
            <button 
              onClick={handleLogout}
              className="p-1.5 text-zinc-400 hover:text-white transition-all rounded-lg hover:bg-zinc-900 cursor-pointer animate-fade-in" 
              title="Logout"
            >
              <LogOut className="w-4.5 h-4.5 stroke-[1.8]" />
            </button>
          </div>
        </header>

        {/* Global Floating Toast Notification */}
        {showNotification && (
          <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-sm px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center gap-2.5 shadow-xl animate-bounce">
            <div className={`p-1 rounded-full ${showNotification.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-blue-500/10 text-blue-400'}`}>
              <Check className="w-4 h-4 stroke-[2.5]" />
            </div>
            <span className="text-xs font-medium text-zinc-200">{showNotification.message}</span>
          </div>
        )}

        {/* Dynamic scanning indicator */}
        {isAnalyzing && (
          <div className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center justify-center p-6 backdrop-blur-sm">
            <div className="w-16 h-16 rounded-full border-4 border-zinc-800 border-t-white animate-spin mb-6"></div>
            <h3 className="text-lg font-bold font-display text-white mb-2">Analyzing Markets...</h3>
            <p className="text-xs text-zinc-400 text-center max-w-xs leading-relaxed">
              Scanning technical oscillators, volume profiles, and historical candle patterns for perfect entries.
            </p>
          </div>
        )}

        {/* Main Content Scroll Container */}
        <main className="flex-1 px-6 pt-6">

          {/* ==================== TAB 1: HOME ==================== */}
          {activeTab === 'home' && (
            <div className="space-y-8 animate-fade-in">
              
              {/* Live markets status & date row */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-zinc-800 bg-zinc-950/60 w-fit">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span className="text-xs text-zinc-400 font-medium">Live · markets open</span>
                </div>
                <span className="text-[11px] text-zinc-500 font-medium tracking-tight mt-0.5 sm:mt-0">
                  Updated {formattedTime}
                </span>
              </div>

              {/* Title & Description Header */}
              <div className="space-y-2.5">
                <h1 className="text-3xl font-bold tracking-tight text-white font-display">
                  Good signal, good trade.
                </h1>
                <p className="text-xs text-zinc-400 leading-relaxed max-w-sm">
                  Your AI-curated view of the forex market — refreshed every few seconds.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-full border border-zinc-800 bg-zinc-950/40 text-xs font-semibold text-white hover:bg-zinc-900 hover:border-zinc-700 transition-all cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
                <button
                  onClick={handleQuickAnalyze}
                  className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-white text-xs font-bold text-black hover:bg-zinc-200 transition-all cursor-pointer shadow-md"
                >
                  <Zap className="w-4 h-4 fill-black" />
                  <span>Quick Analyze</span>
                </button>
              </div>

              {/* AI Quick Scan recommendation result if present */}
              {analysisResult && (
                <div className="p-4 rounded-2xl border border-zinc-800 bg-zinc-900/30 flex gap-3.5 items-start">
                  <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 shrink-0">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">Gaks AI Recommendation</h4>
                    <p className="text-xs text-zinc-300 leading-relaxed">{analysisResult}</p>
                  </div>
                </div>
              )}

              {/* Live Rates Card Deck */}
              <div className="space-y-4">
                <div className="space-y-0.5">
                  <h2 className="text-xl font-bold tracking-tight text-white font-display">Live Rates</h2>
                  <p className="text-xs text-zinc-500">Major forex pairs</p>
                </div>

                <div className="space-y-3">
                  {liveRates.map(pair => {
                    const isBearish = pair.sentiment === 'Bearish';
                    const { lineD, fillD } = getSparklinePaths(pair.history, 110, 24);

                    return (
                      <div
                        key={pair.symbol}
                        className="p-5 rounded-3xl border border-zinc-800 bg-[#0f0f11] relative overflow-hidden flex justify-between items-start hover:border-zinc-700 transition-all"
                      >
                        {/* Left Info Column */}
                        <div className="space-y-1 z-10">
                          <h3 className="text-lg font-bold text-white font-display tracking-tight">{pair.symbol}</h3>
                          <p className="text-[11px] text-zinc-500 font-medium">{pair.name}</p>
                        </div>

                        {/* Middle Curve Plot (Visual Sparkline) */}
                        <div className="absolute bottom-5 left-6 right-36 h-6 pointer-events-none opacity-80">
                          <svg className="w-full h-full overflow-visible" viewBox="0 0 110 24" preserveAspectRatio="none">
                            <defs>
                              <linearGradient id={`grad-${pair.symbol}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={isBearish ? "#ef4444" : "#22c55e"} stopOpacity="0.15"/>
                                <stop offset="100%" stopColor={isBearish ? "#ef4444" : "#22c55e"} stopOpacity="0.0"/>
                              </linearGradient>
                            </defs>
                            <path d={fillD} fill={`url(#grad-${pair.symbol})`} />
                            <path d={lineD} fill="none" stroke={isBearish ? "#b91c1c" : "#15803d"} strokeWidth="1.5" />
                          </svg>
                        </div>

                        {/* Right Rate / Badge Column */}
                        <div className="flex flex-col items-end gap-1.5 z-10">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border ${
                            isBearish
                              ? 'bg-[#1c0c0c] text-red-500 border-red-950/80'
                              : 'bg-[#0c1c0c] text-emerald-500 border-emerald-950/80'
                          }`}>
                            {pair.sentiment}
                          </span>
                          <div className="text-right space-y-0.5">
                            <div className="text-base font-bold text-white tracking-tight">{pair.price.toLocaleString(undefined, { minimumFractionDigits: pair.price > 10 ? 2 : 4 })}</div>
                            <div className={`text-xs font-semibold flex items-center justify-end gap-0.5 ${isBearish ? 'text-red-500' : 'text-emerald-500'}`}>
                              {isBearish ? <ArrowDownRight className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
                              <span>{isBearish ? '' : '+'}{pair.change.toFixed(2)}%</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Top Movers Section */}
              <div className="p-6 rounded-3xl border border-zinc-800 bg-[#0c0c0e]/80 space-y-5">
                <div className="flex justify-between items-baseline">
                  <h3 className="text-base font-bold text-white font-display">Top Movers</h3>
                  <span className="text-[11px] text-zinc-500 font-medium">Biggest % change today</span>
                </div>
                <div className="divide-y divide-zinc-900">
                  {[
                    { symbol: 'XAUUSD', name: 'Gold / US Dollar', price: '2,342.50', change: '-1.43%', neg: true },
                    { symbol: 'USDJPY', name: 'US Dollar / Japanese Yen', price: '156.42', change: '-1.54%', neg: true },
                    { symbol: 'GBPJPY', name: 'British Pound / Japanese Yen', price: '199.21', change: '-1.50%', neg: true },
                    { symbol: 'NAS100', name: 'Nasdaq 100', price: '19,420.00', change: '-1.20%', neg: true },
                    { symbol: 'USDCHF', name: 'US Dollar / Swiss Franc', price: '0.8945', change: '-1.14%', neg: true },
                    { symbol: 'XAUUSD', name: 'Gold / US Dollar', price: '2,342.50', change: '-1.29%', neg: true },
                    { symbol: 'XAUUSD', name: 'Gold / US Dollar', price: '2,342.50', change: '-1.14%', neg: true }
                  ].map((mover, idx) => (
                    <div key={idx} className="py-3 flex justify-between items-center first:pt-0 last:pb-0">
                      <div>
                        <div className="text-xs font-bold text-white">{mover.symbol}</div>
                        <div className="text-[10px] text-zinc-500">{mover.name}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-bold text-white tracking-tight">{mover.price}</div>
                        <div className="text-[11px] font-semibold text-red-500">{mover.change}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Trending Pairs Grid */}
              <div className="p-6 rounded-3xl border border-zinc-800 bg-[#0c0c0e]/80 space-y-4">
                <div className="flex flex-col">
                  <span className="text-base font-bold text-white font-display">Trending Pairs</span>
                  <span className="text-[11px] text-zinc-500 mt-0.5">What traders are watching</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { s: 'BTCUSD', c: '-0.07%', p: [100, 80, 90, 70, 75, 50, 48] },
                    { s: 'ETHUSD', c: '-1.48%', p: [100, 75, 80, 50, 45, 30, 20] },
                    { s: 'XAUUSD', c: '-0.27%', p: [100, 95, 85, 90, 70, 68, 65] },
                    { s: 'NAS100', c: '-0.61%', p: [100, 90, 80, 85, 70, 65, 58] }
                  ].map((trend, idx) => {
                    const { lineD, fillD } = getSparklinePaths(trend.p, 80, 15);
                    return (
                      <div key={idx} className="p-4 rounded-2xl border border-zinc-900 bg-zinc-950/40 relative overflow-hidden flex flex-col justify-between h-20">
                        <div className="flex justify-between items-center z-10">
                          <span className="text-xs font-bold text-white tracking-tight">{trend.s}</span>
                          <span className="text-[10px] font-bold text-red-500">{trend.c}</span>
                        </div>
                        {/* Mini Sparkline in trend cards */}
                        <div className="h-4 w-full opacity-60 z-0">
                          <svg className="w-full h-full" viewBox="0 0 80 15" preserveAspectRatio="none">
                            <defs>
                              <linearGradient id={`trend-grad-${idx}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#ef4444" stopOpacity="0.2"/>
                                <stop offset="100%" stopColor="#ef4444" stopOpacity="0.0"/>
                              </linearGradient>
                            </defs>
                            <path d={fillD} fill={`url(#trend-grad-${idx})`} />
                            <path d={lineD} fill="none" stroke="#ef4444" strokeWidth="1.2" />
                          </svg>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Market Heatmap Section */}
              <div className="p-6 rounded-3xl border border-zinc-800 bg-[#0c0c0e]/80 space-y-4">
                <div className="flex flex-col">
                  <span className="text-base font-bold text-white font-display">Market Heatmap</span>
                  <span className="text-[11px] text-zinc-500 mt-0.5">Performance at a glance</span>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {[
                    { s: 'EURUSD', c: '-1.29%', alpha: 'bg-red-800 border-red-700/60' },
                    { s: 'GBPUSD', c: '-0.99%', alpha: 'bg-red-900/80 border-red-800/40' },
                    { s: 'USDJPY', c: '-0.96%', alpha: 'bg-red-900/80 border-red-800/40' },
                    { s: 'USDCHF', c: '-0.56%', alpha: 'bg-red-950 border-red-900/30' },
                    { s: 'AUDUSD', c: '-0.13%', alpha: 'bg-red-950/60 border-zinc-900' },
                    { s: 'XAUUSD', c: '-0.42%', alpha: 'bg-red-950 border-red-900/30' },
                    { s: 'BTCUSD', c: '-0.07%', alpha: 'bg-[#1a0f0f] border-zinc-900' },
                    { s: 'ETHUSD', c: '-1.48%', alpha: 'bg-red-800 border-red-700/60' },
                    { s: 'XAUUSD', c: '-0.27%', alpha: 'bg-red-950/60 border-zinc-900' },
                    { s: 'NAS100', c: '-0.61%', alpha: 'bg-[#401212] border-red-950' },
                    { s: 'GBPJPY', c: '-0.92%', alpha: 'bg-red-900/80 border-red-800/40' },
                    { s: 'USDJPY', c: '-0.81%', alpha: 'bg-red-900/70 border-red-900/40' }
                  ].map((cell, idx) => (
                    <div
                      key={idx}
                      className={`aspect-square rounded-xl border flex flex-col justify-center items-center p-1 text-center transition-all hover:scale-[1.03] ${cell.alpha}`}
                    >
                      <span className="text-[9px] font-bold text-white leading-none mb-1">{cell.s}</span>
                      <span className="text-[8px] font-medium text-zinc-300 leading-none">{cell.c}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}

          {/* ==================== TAB 2: STRATEGY ==================== */}
          {activeTab === 'strategy' && (
            <div className="space-y-8 animate-fade-in">
              
              {/* Header Title */}
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight text-white font-display">Strategy</h1>
                <p className="text-xs text-zinc-400 leading-relaxed max-w-sm">
                  Write the playbook your AI assistant trades with.
                </p>
                <div className="flex items-center gap-1.5 pt-0.5">
                  <Check className="w-4 h-4 text-emerald-500 stroke-[2.5]" />
                  <span className="text-xs text-zinc-400 font-medium">All changes saved</span>
                </div>
              </div>

              {/* Strategy Board & Editor */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                {/* Left Panel: Strategies List */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">My Playbooks</h3>
                    <button
                      onClick={handleCreateCustomStrategy}
                      className="px-3 py-1.5 rounded-xl border border-zinc-800 hover:border-zinc-700 bg-zinc-950/40 text-zinc-300 hover:text-white transition-all flex items-center gap-1 text-xs font-medium cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>New</span>
                    </button>
                  </div>

                  <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                    {strategies.map((strat) => {
                      const isActive = strat.id === activeStrategyId;
                      const isSelected = strat.id === selectedStrategyId;
                      return (
                        <div
                          key={strat.id}
                          onClick={() => setSelectedStrategyId(strat.id)}
                          className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col gap-3 ${
                            isSelected
                              ? 'border-emerald-500/50 bg-emerald-500/5'
                              : 'border-zinc-900 bg-[#0c0c0e]/40 hover:border-zinc-800'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-1">
                              <div className="font-semibold text-xs text-white truncate max-w-[150px]">
                                {strat.name}
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {strat.isDefault ? (
                                  <span className="px-1.5 py-0.5 text-[8px] font-bold tracking-wider uppercase bg-zinc-800 text-zinc-300 rounded">
                                    Default
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.5 text-[8px] font-bold tracking-wider uppercase bg-zinc-900 text-emerald-400 border border-emerald-500/20 rounded">
                                    Custom
                                  </span>
                                )}
                                {isActive && (
                                  <span className="px-1.5 py-0.5 text-[8px] font-bold tracking-wider uppercase bg-emerald-500/10 text-emerald-400 rounded flex items-center gap-1">
                                    <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse"></span>
                                    Active
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              {/* Duplicate Action */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDuplicateStrategy(strat);
                                }}
                                className="p-1.5 rounded-lg border border-zinc-850 hover:border-zinc-700 bg-zinc-950/60 text-zinc-400 hover:text-white transition-all cursor-pointer"
                                title="Duplicate strategy"
                              >
                                <Plus className="w-3 h-3" />
                              </button>

                              {/* Delete Action (only for non-default) */}
                              {!strat.isDefault && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteStrategy(strat.id);
                                  }}
                                  className="p-1.5 rounded-lg border border-red-950/20 hover:border-red-900/40 bg-zinc-950/60 text-red-400 hover:text-red-300 transition-all cursor-pointer"
                                  title="Delete strategy"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Action Button inside card if not active */}
                          {!isActive && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSetActiveStrategy(strat.id);
                              }}
                              className="w-full py-1.5 rounded-xl border border-zinc-800 hover:border-zinc-700 bg-zinc-950/40 hover:bg-zinc-950 text-center text-[9px] font-bold uppercase tracking-wider text-zinc-400 hover:text-white transition-all cursor-pointer"
                            >
                              Activate Strategy
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Right Panel: Selected Strategy Editor */}
                <div className="lg:col-span-2 space-y-4">
                  {(() => {
                    const selectedStrat = strategies.find(s => s.id === selectedStrategyId) || GAKS_DEFAULT_STRATEGY;
                    return (
                      <div className="rounded-3xl border border-zinc-800 bg-[#0c0c0e]/80 overflow-hidden flex flex-col">
                        <div className="px-5 py-4 border-b border-zinc-900 flex flex-wrap items-center justify-between gap-3 bg-[#08080a]">
                          <div className="flex items-center gap-2.5">
                            <span className={`w-2 h-2 rounded-full ${selectedStrat.id === activeStrategyId ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`}></span>
                            
                            {/* Rename input if custom, else static label */}
                            {selectedStrat.isDefault ? (
                              <span className="text-xs font-bold text-white uppercase tracking-wider">{selectedStrat.name}</span>
                            ) : (
                              <input
                                type="text"
                                value={selectedStrat.name}
                                onChange={(e) => handleRenameStrategy(e.target.value)}
                                className="bg-transparent border-b border-dashed border-zinc-850 hover:border-zinc-700 focus:border-emerald-500 focus:outline-none text-xs font-bold text-white uppercase tracking-wider pb-0.5"
                                title="Click to rename"
                                placeholder="Rename Strategy..."
                              />
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {selectedStrat.isDefault && (
                              <span className="text-[10px] bg-zinc-900/60 border border-zinc-800 text-zinc-400 px-2.5 py-1 rounded-full font-semibold">
                                Built-in Default
                              </span>
                            )}
                            {selectedStrat.id === activeStrategyId ? (
                              <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded-full font-bold uppercase tracking-wider flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                Currently Active
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
                          {selectedStrat.isDefault && (
                            <div className="p-3.5 rounded-2xl bg-zinc-950/60 border border-zinc-900 text-zinc-400 text-xs leading-relaxed flex items-start gap-2.5">
                              <Info className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                              <div>
                                This is our institutional **Gaks AI Default Strategy**. It is optimized for the free-tier Twelve Data feeds. If you wish to customize these rules, click the **Duplicate** button to create your own editable playbook copy.
                              </div>
                            </div>
                          )}

                          <textarea
                            value={selectedStrat.text}
                            onChange={(e) => handleStrategyTextChange(e.target.value)}
                            readOnly={selectedStrat.isDefault}
                            placeholder="Describe your trading strategy in detail..."
                            className={`w-full h-80 bg-zinc-950/60 border border-zinc-900 rounded-2xl p-4 text-xs font-medium leading-relaxed resize-none font-sans focus:outline-none ${
                              selectedStrat.isDefault
                                ? 'text-zinc-500 cursor-not-allowed border-zinc-950 bg-zinc-950/30'
                                : 'text-zinc-300 focus:border-zinc-700'
                            }`}
                          />

                          {/* Card Actions */}
                          <div className="flex justify-between items-center pt-1">
                            <div className="flex gap-2">
                              {!selectedStrat.isDefault && (
                                <button
                                  onClick={resetStrategyPlaybook}
                                  className="p-2 rounded-xl border border-zinc-800 hover:border-zinc-700 bg-zinc-950/40 text-zinc-400 hover:text-white transition-all flex items-center gap-1.5 text-xs font-medium cursor-pointer"
                                  title="Reset playbook"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                  <span>Reset</span>
                                </button>
                              )}
                              <button
                                onClick={syncStrategy}
                                className="p-2 rounded-xl border border-zinc-800 hover:border-zinc-700 bg-zinc-950/40 text-zinc-400 hover:text-white transition-all flex items-center gap-1.5 text-xs font-medium cursor-pointer"
                                title="Sync playbook"
                              >
                                <CloudLightning className="w-3.5 h-3.5" />
                                <span>Sync</span>
                              </button>
                            </div>

                            {!selectedStrat.isDefault && (
                              <button
                                onClick={saveStrategyPlaybook}
                                className="px-5 py-2 rounded-full bg-white text-xs font-bold text-black hover:bg-zinc-200 transition-all flex items-center gap-1.5 cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                                <span>Save Changes</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

              </div>

              {/* Trading Preferences Card - Matches Screenshot 9 */}
              <div className="p-6 rounded-3xl border border-zinc-800 bg-[#0c0c0e]/80 space-y-6">
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-white font-display">Trading Preferences</h3>
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
                                ? 'bg-zinc-100 text-zinc-900 border-zinc-100 shadow-md'
                                : 'bg-zinc-950/40 text-zinc-400 border-zinc-900 hover:border-zinc-800 hover:text-white'
                            }`}
                          >
                            {option}
                          </button>
                        );
                      })}
                    </div>
                    
                    {/* Render custom capital field if selected */}
                    {capital === 'Custom' && (
                      <div className="mt-2.5 relative rounded-2xl border border-zinc-800 overflow-hidden bg-zinc-950/60 focus-within:border-zinc-700">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-500">$</span>
                        <input
                          type="number"
                          value={customCapital}
                          onChange={(e) => setCustomCapital(e.target.value)}
                          placeholder="Enter your custom capital size..."
                          className="w-full bg-transparent border-0 py-2.5 pl-8 pr-4 text-xs text-white focus:outline-none focus:ring-0"
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
                      className="w-full bg-zinc-950/60 border border-zinc-900 focus:border-zinc-700 rounded-2xl px-4 py-3 text-xs font-semibold text-white focus:outline-none"
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
                      className="w-full bg-zinc-950/60 border border-zinc-900 focus:border-zinc-700 rounded-2xl px-4 py-3 text-xs font-semibold text-white focus:outline-none"
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
                            ? 'bg-zinc-100/5 border-zinc-200 text-white font-bold'
                            : 'bg-zinc-950/40 border-zinc-900 text-zinc-500 hover:border-zinc-800'
                        }`}
                      >
                        <div className="text-xs font-semibold leading-relaxed">Personal</div>
                        <div className="text-xs font-semibold leading-relaxed">Account</div>
                      </button>
                      <button
                        onClick={() => setAccountType('prop')}
                        className={`p-4 rounded-2xl border text-center transition-all cursor-pointer ${
                          accountType === 'prop'
                            ? 'bg-zinc-100/5 border-zinc-200 text-white font-bold'
                            : 'bg-zinc-950/40 border-zinc-900 text-zinc-500 hover:border-zinc-800'
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
                                ? 'bg-zinc-100/5 text-white border-zinc-300'
                                : 'bg-zinc-950/40 text-zinc-500 border-zinc-900 hover:border-zinc-800'
                            }`}
                          >
                            {isChecked && <Check className="w-3 h-3 text-white stroke-[3]" />}
                            <span>{session}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Preferred Timeframes - Matches Screenshot 10 */}
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
                                ? 'bg-zinc-100/5 text-white border-zinc-300'
                                : 'bg-zinc-950/40 text-zinc-500 border-zinc-900 hover:border-zinc-800'
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
                    onClick={savePreferences}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-white text-xs font-bold text-black hover:bg-zinc-200 transition-all cursor-pointer shadow-md mt-4"
                  >
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Save Preferences</span>
                  </button>

                </div>
              </div>

            </div>
          )}

          {/* ==================== TAB 3: MARKET WATCHER ==================== */}
          {activeTab === 'watcher' && (
            <div className="space-y-8 animate-fade-in">
              
              {/* Header Title */}
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight text-white font-display">Market Watcher</h1>
                <p className="text-xs text-zinc-400 leading-relaxed max-w-sm">
                  Build a personal watchlist with AI signals and confidence scoring.
                </p>
              </div>

              {/* AI Watcher Activation Widget */}
              <div className="p-5 rounded-3xl border border-zinc-800 bg-[#0c0c0e]/60 space-y-4">
                {isTelegramLoading ? (
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded-full border-2 border-zinc-700 border-t-zinc-400 animate-spin"></div>
                      <div>
                        <h4 className="text-xs font-bold text-zinc-300">Checking Telegram Connection...</h4>
                        <p className="text-[10px] text-zinc-500">Querying secure alert routing states</p>
                      </div>
                    </div>
                  </div>
                ) : !telegramConnection?.connected ? (
                  <div className="space-y-4 w-full">
                    <div className="p-4 rounded-2xl border border-amber-500/10 bg-amber-500/5 text-amber-400 text-xs space-y-2">
                      <div className="flex items-center gap-2 font-semibold">
                        <Info className="w-4 h-4 shrink-0 text-amber-400" />
                        <span>Telegram Connection Required</span>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-normal">
                        Please connect your Telegram account before activating the AI Market Watcher.
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-4 pt-1">
                      <div className="flex items-center gap-3">
                        <div className="w-3.5 h-3.5 rounded-full bg-zinc-700"></div>
                        <div>
                          <h4 className="text-xs font-bold text-white">AI Market Watcher Engine</h4>
                          <p className="text-[10px] text-zinc-500">Status: <span className="font-bold">STANDBY (LINK REQUIRED)</span></p>
                        </div>
                      </div>

                      <button
                        onClick={handleConnectTelegram}
                        disabled={isTelegramConnecting}
                        className="px-5 py-2.5 rounded-full text-xs font-bold bg-white text-black hover:bg-zinc-200 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer shadow-md disabled:opacity-50"
                      >
                        {isTelegramConnecting ? (
                          <div className="w-3.5 h-3.5 rounded-full border-2 border-black border-t-transparent animate-spin"></div>
                        ) : (
                          <>
                            <Send className="w-3.5 h-3.5" />
                            <span>Connect Telegram</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="w-full space-y-4">
                    {/* Connection status bar */}
                    <div className="p-4 rounded-2xl border border-emerald-500/10 bg-emerald-500/5 text-emerald-400 text-xs flex items-center justify-between">
                      <div className="flex items-center gap-2 font-semibold">
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                        <span>Telegram Connected</span>
                      </div>
                      {telegramConnection?.telegram_username && (
                        <span className="text-[10px] font-mono text-emerald-400/80 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                          @{telegramConnection.telegram_username}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className={`w-3.5 h-3.5 rounded-full ${isWatcherActive ? 'bg-white animate-pulse' : 'bg-zinc-700'}`}></div>
                          {isWatcherActive && <div className="absolute inset-0 rounded-full bg-white animate-ping opacity-70"></div>}
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-white">AI Market Watcher Engine</h4>
                          <p className="text-[10px] text-zinc-400">
                            Status: <span className={isWatcherActive ? 'text-white font-bold' : 'text-zinc-500 font-bold'}>{isWatcherActive ? 'ACTIVE & MONITORED' : 'STANDBY'}</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {watcherErrorMessage && (
                  <div className="p-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-start gap-2">
                    <Info className="w-4 h-4 mt-0.5 shrink-0" />
                    <p className="leading-normal">{watcherErrorMessage}</p>
                  </div>
                )}
              </div>

              {/* Add Custom Forex Ticker Form with Timeframe and Activate Button */}
              <div className="p-6 rounded-3xl border border-zinc-800 bg-[#0c0c0e]/80 space-y-5">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-white animate-pulse" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">Configure Market Watcher</h3>
                </div>
                
                <div className="space-y-4">
                  {/* Pair input */}
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 block">Forex Pair / Asset Symbol</label>
                    <div className="relative rounded-2xl border border-zinc-900 bg-zinc-950/60 overflow-hidden focus-within:border-zinc-700">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                      <input
                        type="text"
                        value={watcherSearch}
                        onChange={(e) => setWatcherSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          }
                        }}
                        placeholder="Enter symbol... e.g. EURUSD, GBPUSD, XAUUSD"
                        className="w-full bg-transparent border-0 py-3.5 pl-11 pr-4 text-xs font-semibold text-white focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Timeframe selector */}
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 block">Analysis Timeframe</label>
                    <div className="flex flex-wrap gap-1.5 p-1 rounded-2xl border border-zinc-900 bg-zinc-950/40">
                      {['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'Daily'].map(tf => {
                        const isSelected = watcherTimeframe === tf;
                        return (
                          <button
                            key={tf}
                            type="button"
                            onClick={() => setWatcherTimeframe(tf)}
                            className={`flex-1 min-w-[42px] py-2 rounded-xl text-[10px] font-bold transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-white text-zinc-950 shadow-sm'
                                : 'text-zinc-400 hover:text-white hover:bg-zinc-900/40'
                            }`}
                          >
                            {tf}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Activation Trigger */}
                  {isWatcherActive ? (
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={stopAiMarketWatcher}
                        className="flex-1 flex items-center justify-center gap-2 px-5 py-3.5 rounded-full text-xs font-bold transition-all shadow-sm font-display bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Stop Watcher</span>
                      </button>
                      <button
                        disabled={!watcherSearch.trim() || !watcherTimeframe}
                        onClick={() => {
                          if (!watcherSearch.trim() || !watcherTimeframe) return;
                          startAiMarketWatcher(watcherSearch, watcherTimeframe);
                        }}
                        className={`flex-1 flex items-center justify-center gap-2 px-5 py-3.5 rounded-full text-xs font-bold transition-all shadow-sm font-display ${
                          !watcherSearch.trim() || !watcherTimeframe
                            ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-70'
                            : 'bg-white text-black hover:bg-zinc-200 active:scale-[0.98] cursor-pointer'
                        }`}
                      >
                        <Play className={`w-3.5 h-3.5 fill-current ${(!watcherSearch.trim() || !watcherTimeframe) ? 'text-zinc-500' : 'text-zinc-950 stroke-zinc-950'}`} />
                        <span>Update Watcher</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      disabled={!watcherSearch.trim() || !watcherTimeframe}
                      onClick={() => {
                        if (!watcherSearch.trim() || !watcherTimeframe) return;
                        startAiMarketWatcher(watcherSearch, watcherTimeframe);
                      }}
                      className={`w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-full text-xs font-bold transition-all shadow-sm font-display mt-2 ${
                        !watcherSearch.trim() || !watcherTimeframe
                          ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-70'
                          : 'bg-white text-black hover:bg-zinc-200 active:scale-[0.98] cursor-pointer'
                      }`}
                    >
                      <Play className={`w-3.5 h-3.5 fill-current ${(!watcherSearch.trim() || !watcherTimeframe) ? 'text-zinc-500' : 'text-zinc-950 stroke-zinc-950'}`} />
                      <span>Activate Market Watcher</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Quick Add Pills */}
              <div className="space-y-2.5">
                <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Select Symbol to Configure:</span>
                <div className="flex flex-wrap gap-2">
                  {['EURUSD', 'GBPUSD', 'XAUUSD', 'BTCUSD', 'NAS100', 'US30'].map(symbol => {
                    const isSelected = watcherSearch.trim().toUpperCase() === symbol;
                    return (
                      <button
                        key={symbol}
                        onClick={() => {
                          setWatcherSearch(symbol);
                          triggerNotification(`Selected ${symbol}. Choose a timeframe and press Activate.`, 'info');
                        }}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1.5 ${
                          isSelected
                            ? 'border-white bg-white text-black'
                            : 'border-zinc-900 bg-zinc-950/40 text-zinc-300 hover:text-white hover:border-zinc-800'
                        }`}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5" />}
                        {symbol}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Watchlist Display area */}
              <div className="space-y-4">
                {watchlist.length === 0 || !isWatcherActive ? (
                  /* Empty state - Matches Screenshot 11 exactly */
                  <div className="p-12 rounded-3xl border border-zinc-800 bg-[#0c0c0e]/40 flex flex-col items-center text-center space-y-4">
                    <div className="w-12 h-12 rounded-full bg-zinc-950/80 border border-zinc-900 flex items-center justify-center text-zinc-400">
                      <Search className="w-5 h-5 text-zinc-400 stroke-[1.8]" />
                    </div>
                    <div className="space-y-1.5 max-w-[240px]">
                      <h3 className="text-sm font-bold text-white">No pair selected</h3>
                      <p className="text-[11px] text-zinc-500 leading-relaxed">
                        Select a symbol above to configure the Market Watcher.
                      </p>
                    </div>
                  </div>
                ) : (
                  /* Watchlisted symbols cards deck */
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">Monitored Pair</h4>
                    {watchlist.map(pair => {
                      const isBullish = pair.direction === 'Bullish';
                      const isBearish = pair.direction === 'Bearish';
                      const { lineD, fillD } = getSparklinePaths(pair.history, 100, 24);
                      
                      return (
                        <div
                          key={pair.symbol}
                          className="p-5 rounded-3xl border border-zinc-800 bg-[#0f0f11] flex flex-col gap-4 hover:border-zinc-700 transition-all relative overflow-hidden"
                        >
                          <div className="flex justify-between items-start">
                            <div className="space-y-0.5">
                              <h3 className="text-base font-bold text-white font-display tracking-tight flex items-center gap-2">
                                <span>{pair.symbol}</span>
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider uppercase border ${
                                  isBullish
                                    ? 'bg-[#0c1c0c] text-emerald-500 border-emerald-950/80'
                                    : isBearish
                                    ? 'bg-[#1c0c0c] text-red-500 border-red-950/80'
                                    : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                                }`}>
                                  {pair.direction}
                                </span>
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider bg-zinc-900 text-zinc-300 border border-zinc-800/80 uppercase">
                                  {pair.timeframe || 'H1'}
                                </span>
                              </h3>
                              <p className="text-[10px] text-zinc-500 font-medium">{pair.name}</p>
                            </div>

                            <button
                              onClick={() => handleRemovePair(pair.symbol)}
                              className="p-1 text-zinc-600 hover:text-red-400 transition-colors rounded-lg hover:bg-zinc-950/80 cursor-pointer"
                              title="Remove pair"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Bid/Ask Price display & tiny sparkline wave */}
                          <div className="flex justify-between items-end">
                            {/* Wave graphics */}
                            <div className="h-6 w-24 opacity-60 pointer-events-none">
                              <svg className="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
                                <defs>
                                  <linearGradient id={`watcher-grad-${pair.symbol}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={isBearish ? "#ef4444" : isBullish ? "#22c55e" : "#a1a1aa"} stopOpacity="0.15"/>
                                    <stop offset="100%" stopColor={isBearish ? "#ef4444" : isBullish ? "#22c55e" : "#a1a1aa"} stopOpacity="0.0"/>
                                  </linearGradient>
                                </defs>
                                <path d={fillD} fill={`url(#watcher-grad-${pair.symbol})`} />
                                <path d={lineD} fill="none" stroke={isBearish ? "#b91c1c" : isBullish ? "#15803d" : "#71717a"} strokeWidth="1.5" />
                              </svg>
                            </div>

                            <div className="text-right">
                              <div className="text-lg font-bold text-white tracking-tight">{pair.price.toLocaleString(undefined, { minimumFractionDigits: pair.price > 10 ? 2 : 4 })}</div>
                              <div className={`text-xs font-semibold flex items-center justify-end gap-0.5 ${pair.change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                {pair.change >= 0 ? '+' : ''}{pair.change}%
                              </div>
                            </div>
                          </div>

                          {/* Extra info panel: Spread, Volatility, AI Confidence meter */}
                          <div className="pt-3 border-t border-zinc-900/60 grid grid-cols-3 gap-2">
                            <div className="space-y-0.5">
                              <div className="text-[9px] uppercase font-bold text-zinc-500">Spread</div>
                              <div className="text-xs font-semibold text-zinc-300">{pair.spread} pips</div>
                            </div>
                            <div className="space-y-0.5">
                              <div className="text-[9px] uppercase font-bold text-zinc-500">Volatility</div>
                              <div className={`text-xs font-semibold ${pair.volatility === 'High' ? 'text-amber-400' : 'text-zinc-300'}`}>{pair.volatility}</div>
                            </div>
                            <div className="space-y-0.5">
                              <div className="text-[9px] uppercase font-bold text-zinc-500">AI Confidence</div>
                              <div className="text-xs font-bold text-white flex items-center gap-1">
                                <span>{pair.confidence}%</span>
                                <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>
          )}

          {/* ==================== TAB 4: SETTINGS & PROFILE ==================== */}
          {activeTab === 'settings' && (
            <div className="space-y-8 animate-fade-in pb-12">
              
              {/* Header Title */}
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight text-white font-display">Account & Profile</h1>
                <p className="text-xs text-zinc-400 leading-relaxed max-w-sm">
                  Manage your personal user credentials, profiles database and live Gaks AI subscriptions.
                </p>
              </div>

              {/* User Profile Form */}
              <form onSubmit={handleUpdateProfile} className="p-6 rounded-3xl border border-zinc-800 bg-[#0c0c0e]/80 space-y-6">
                <div className="flex items-center gap-4 border-b border-zinc-900 pb-5">
                  <div className="relative w-14 h-14 rounded-2xl bg-zinc-950 border border-zinc-800 flex items-center justify-center text-white text-lg font-bold uppercase overflow-hidden shrink-0">
                    {profileAvatarUrl ? (
                      <img src={profileAvatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      profileFullName ? profileFullName.charAt(0) : 'U'
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">{profileFullName || 'Gaks User'}</h3>
                    <p className="text-[11px] text-zinc-500">{session?.user?.email}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      <span className="text-[9px] uppercase tracking-wider font-bold text-zinc-400">Database Synchronized</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  {/* Full Name Input */}
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 block">Full Name</label>
                    <div className="relative rounded-2xl border border-zinc-900 bg-zinc-950/60 focus-within:border-zinc-700 overflow-hidden">
                      <input
                        type="text"
                        value={profileFullName}
                        onChange={(e) => setProfileFullName(e.target.value)}
                        placeholder="John Doe"
                        required
                        className="w-full bg-transparent border-0 px-4 py-3 text-xs text-white focus:outline-none focus:ring-0"
                      />
                    </div>
                  </div>

                  {/* Email Input (Read only) */}
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 block">Email Address (Primary)</label>
                    <div className="relative rounded-2xl border border-zinc-900 bg-zinc-900/20 overflow-hidden cursor-not-allowed">
                      <input
                        type="email"
                        value={session?.user?.email || ''}
                        disabled
                        className="w-full bg-transparent border-0 px-4 py-3 text-xs text-zinc-500 focus:outline-none focus:ring-0 cursor-not-allowed"
                      />
                    </div>
                  </div>

                  {/* Avatar URL Input */}
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 block">Profile Image URL</label>
                    <div className="relative rounded-2xl border border-zinc-900 bg-zinc-950/60 focus-within:border-zinc-700 overflow-hidden">
                      <input
                        type="url"
                        value={profileAvatarUrl}
                        onChange={(e) => setProfileAvatarUrl(e.target.value)}
                        placeholder="https://images.unsplash.com/photo-..."
                        className="w-full bg-transparent border-0 px-4 py-3 text-xs text-white focus:outline-none focus:ring-0"
                      />
                    </div>
                  </div>

                  {/* Subscription Plan Selector */}
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 block">Gaks Subscription Plan</label>
                    <div className="grid grid-cols-3 gap-2">
                      {['Free', 'Premium', 'Premium Pro'].map((plan) => {
                        const isSelected = profilePlan === plan;
                        return (
                          <button
                            type="button"
                            key={plan}
                            onClick={() => setProfilePlan(plan)}
                            className={`py-2 px-1.5 rounded-xl text-[10px] font-bold border transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-white text-black border-white'
                                : 'bg-zinc-950/40 border-zinc-900 text-zinc-500 hover:border-zinc-800 hover:text-zinc-300'
                            }`}
                          >
                            {plan}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Telegram Notifications Integration */}
                  <div className="flex items-center justify-between p-4 rounded-2xl border border-zinc-900 bg-zinc-950/30">
                    <div className="space-y-0.5">
                      <h4 className="text-xs font-bold text-white">Telegram Signal Alerts</h4>
                      <p className="text-[10px] text-zinc-500">Receive real-time forex signal scans on Telegram.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setProfileTelegram(!profileTelegram)}
                      className={`w-11 h-6 rounded-full p-1 transition-colors duration-200 focus:outline-none ${
                        profileTelegram ? 'bg-emerald-500' : 'bg-zinc-800'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                          profileTelegram ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isProfileUpdating}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-full bg-white text-xs font-bold text-black hover:bg-zinc-200 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isProfileUpdating ? (
                    <div className="w-4 h-4 rounded-full border-2 border-black border-t-transparent animate-spin"></div>
                  ) : (
                    <>
                      <Check className="w-4 h-4 stroke-[2.5]" />
                      <span>Save Profile & Settings</span>
                    </>
                  )}
                </button>
              </form>

              {/* Telegram Connection Section */}
              <div className="p-6 rounded-3xl border border-zinc-800 bg-[#0c0c0e]/80 space-y-6">
                <div className="flex items-center gap-3 border-b border-zinc-900 pb-5">
                  <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0">
                    <Send className="w-4 h-4 text-sky-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Telegram Connection</h3>
                    <p className="text-[11px] text-zinc-400">
                      Link your personal Telegram chat identifier to receive custom system alerts.
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  {/* Connection Status Indicator */}
                  <div className="p-4 rounded-2xl border border-zinc-900 bg-zinc-950/40 flex items-center justify-between">
                    <div className="space-y-1">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 block">Connection Status</span>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${telegramConnection?.connected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`}></span>
                        <span className="text-xs font-bold text-white">
                          {telegramConnection?.connected ? 'Connected' : 'Not Connected'}
                        </span>
                      </div>
                      {telegramConnection?.connected && telegramConnection?.telegram_username && (
                        <p className="text-[10px] text-zinc-500">
                          Linked Username: <span className="font-mono text-sky-400">@{telegramConnection.telegram_username}</span>
                        </p>
                      )}
                    </div>

                    {telegramConnection?.connected ? (
                      <span className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                        Active
                      </span>
                    ) : (
                      <span className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-bold">
                        Pending
                      </span>
                    )}
                  </div>

                  {/* Status Alerts */}
                  {telegramSuccessMessage && (
                    <div className="flex items-center gap-2 p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px]">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{telegramSuccessMessage}</span>
                    </div>
                  )}

                  {telegramErrorMessage && (
                    <div className="flex items-center gap-2 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px]">
                      <Info className="w-4 h-4 shrink-0" />
                      <span>{telegramErrorMessage}</span>
                    </div>
                  )}

                  {/* Connect / Reconnect Button */}
                  <button
                    type="button"
                    onClick={handleConnectTelegram}
                    disabled={isTelegramConnecting}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-full bg-white text-xs font-bold text-black hover:bg-zinc-200 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isTelegramConnecting ? (
                      <div className="w-4 h-4 rounded-full border-2 border-black border-t-transparent animate-spin"></div>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>{telegramConnection?.connected ? 'Reconnect Telegram' : 'Connect Telegram'}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* AI Settings Section */}
              <div className="p-6 rounded-3xl border border-zinc-800 bg-[#0c0c0e]/80 space-y-6">
                <div className="flex items-center gap-3 border-b border-zinc-900 pb-5">
                  <Sparkles className="w-5 h-5 text-white" />
                  <div>
                    <h3 className="text-sm font-bold text-white">AI Settings</h3>
                    <p className="text-[11px] text-zinc-500">Configure your personal Gemini API key for Gaks AI integrations.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 block">Gemini API Key</label>
                    <div className="relative rounded-2xl border border-zinc-900 bg-zinc-950/60 focus-within:border-zinc-700 overflow-hidden">
                      <input
                        type="password"
                        value={geminiKey}
                        onChange={(e) => {
                          setGeminiKey(e.target.value);
                          setGeminiKeySuccess(null);
                          setGeminiKeyError(null);
                        }}
                        placeholder={geminiKeyExists ? "••••••••••••••••••••••••••••" : "Enter your AI Studio Gemini API Key"}
                        className="w-full bg-transparent border-0 px-4 py-3 text-xs text-white focus:outline-none focus:ring-0"
                      />
                    </div>
                    <p className="text-[10px] text-zinc-500 leading-normal">
                      Your API key is stored securely in Supabase and only transmitted through protected channels to execute model inferences.
                    </p>
                  </div>

                  {geminiKeySuccess && (
                    <div className="flex items-center gap-2 p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px]">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{geminiKeySuccess}</span>
                    </div>
                  )}

                  {geminiKeyError && (
                    <div className="flex items-center gap-2 p-3.5 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-[11px]">
                      <Info className="w-4 h-4 shrink-0" />
                      <span>{geminiKeyError}</span>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleSaveGeminiKey}
                      disabled={isGeminiKeySaving || isGeminiKeyLoading}
                      className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-white text-xs font-bold text-zinc-950 hover:bg-zinc-200 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isGeminiKeySaving ? (
                        <div className="w-4 h-4 rounded-full border-2 border-zinc-950 border-t-transparent animate-spin"></div>
                      ) : geminiKeyExists ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Update Gemini Key</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Save Gemini Key</span>
                        </>
                      )}
                    </button>

                    {geminiKeyExists && (
                      <button
                        type="button"
                        onClick={handleDeleteGeminiKey}
                        disabled={isGeminiKeySaving || isGeminiKeyLoading}
                        className="px-4 py-3 rounded-full border border-zinc-800 text-xs font-semibold text-zinc-400 hover:text-red-400 hover:border-red-900/40 transition-all cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Platform Security Badge */}
              <div className="p-5 rounded-3xl border border-zinc-900 bg-zinc-950/40 flex items-start gap-3">
                <Shield className="w-5 h-5 text-zinc-500 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-zinc-300">Row Level Security Enabled</h4>
                  <p className="text-[10px] text-zinc-500 leading-relaxed">
                    Your personal profile records and watchlist preferences are safely isolated with modern Postgres RLS policies. Only you have decryption authorization.
                  </p>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'admin' && (
            <AdminDashboard userProfile={userProfile} session={session} authLoading={isAuthLoading} />
          )}

        </main>

        {/* Floating/Bottom Navigation Bar - Matches Screenshots exactly */}
        <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-[#080808]/95 border-t border-zinc-900/90 px-6 py-4.5 z-40 backdrop-blur-md flex justify-between items-center shadow-2xl">
          <button
            onClick={() => setActiveTab('home')}
            className={`flex-1 flex flex-col items-center gap-1 cursor-pointer transition-all ${
              activeTab === 'home'
                ? 'text-white'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <div className={`p-2 rounded-2xl w-[90%] flex flex-col items-center gap-1.5 transition-all ${
              activeTab === 'home' ? 'bg-[#151515] text-white font-semibold' : ''
            }`}>
              <HomeIcon className="w-4.5 h-4.5 stroke-[1.8]" />
              <span className="text-[9px] uppercase tracking-wider font-bold">Home</span>
            </div>
          </button>

          <button
            onClick={() => setActiveTab('strategy')}
            className={`flex-1 flex flex-col items-center gap-1 cursor-pointer transition-all ${
              activeTab === 'strategy'
                ? 'text-white'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <div className={`p-2 rounded-2xl w-[90%] flex flex-col items-center gap-1.5 transition-all ${
              activeTab === 'strategy' ? 'bg-[#151515] text-white font-semibold' : ''
            }`}>
              <TrendingUp className="w-4.5 h-4.5 stroke-[1.8]" />
              <span className="text-[9px] uppercase tracking-wider font-bold">Strategy</span>
            </div>
          </button>

          <button
            onClick={() => setActiveTab('watcher')}
            className={`flex-1 flex flex-col items-center gap-1 cursor-pointer transition-all ${
              activeTab === 'watcher'
                ? 'text-white'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <div className={`p-2 rounded-2xl w-[90%] flex flex-col items-center gap-1.5 transition-all ${
              activeTab === 'watcher' ? 'bg-[#151515] text-white font-semibold' : ''
            }`}>
              <Eye className="w-4.5 h-4.5 stroke-[1.8]" />
              <span className="text-[9px] uppercase tracking-wider font-bold">Watcher</span>
            </div>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`flex-1 flex flex-col items-center gap-1 cursor-pointer transition-all ${
              activeTab === 'settings'
                ? 'text-white'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <div className={`p-2 rounded-2xl w-[90%] flex flex-col items-center gap-1.5 transition-all ${
              activeTab === 'settings' ? 'bg-[#151515] text-white font-semibold' : ''
            }`}>
              <SettingsIcon className="w-4.5 h-4.5 stroke-[1.8]" />
              <span className="text-[9px] uppercase tracking-wider font-bold">Settings</span>
            </div>
          </button>
          
          {session?.user?.email === 'gaks6535@gmail.com' && (
            <button
              onClick={() => setActiveTab('admin')}
              className={`flex-1 flex flex-col items-center gap-1 cursor-pointer transition-all ${
                activeTab === 'admin'
                  ? 'text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <div className={`p-2 rounded-2xl w-[90%] flex flex-col items-center gap-1.5 transition-all ${
                activeTab === 'admin' ? 'bg-[#151515] text-white font-semibold' : ''
              }`}>
                <Shield className="w-4.5 h-4.5 stroke-[1.8]" />
                <span className="text-[9px] uppercase tracking-wider font-bold">Admin</span>
              </div>
            </button>
          )}
        </nav>

      </div>
    </div>
  );
}
