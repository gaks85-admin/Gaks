import React, { useState, useEffect, useMemo } from 'react';
import { useLiveRates } from './hooks/useLiveRates';
import { supabase } from './supabaseClient';
import { getGeminiKey, saveGeminiKey, deleteGeminiKey } from './lib/apiKeys';
import Auth from './components/Auth';
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

import { getTelegramConnection, initiateTelegramConnection, getTelegramDeepLink, simulateTelegramBotActivation } from './lib/telegram';


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

export default function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'strategy' | 'watcher' | 'settings'>('home');
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
  const [strategyText, setStrategyText] = useState<string>(
    `• Entry conditions\n• Confirmation indicators\n• Exit & stop-loss logic\n• Risk management rules`
  );
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

      if (pendingToken && pendingUserId === session.user.id) {
        // Since they returned to the tab after clicking "Connect", we automatically
        // simulate the bot activation in the DB / LocalStorage
        const success = await simulateTelegramBotActivation(session.user.id, pendingToken);
        if (success) {
          localStorage.removeItem('gaks_pending_telegram_token');
          localStorage.removeItem('gaks_pending_telegram_user');
          triggerNotification("Telegram linked successfully!", "success");
          setTelegramSuccessMessage("Telegram Connected!");
        }
      }
      
      // Reload the state (this updates the UI instantly!)
      await loadTelegramConnection(session.user.id, false);
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
      if (savedStrategy) setStrategyText(savedStrategy);
      
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
  const saveStrategyPlaybook = () => {
    localStorage.setItem('gaks_strategy_text', strategyText);
    triggerNotification("Strategy playbook saved successfully!");
  };

  const resetStrategyPlaybook = () => {
    const defaultPlaybook = `• Entry conditions\n• Confirmation indicators\n• Exit & stop-loss logic\n• Risk management rules`;
    setStrategyText(defaultPlaybook);
    localStorage.setItem('gaks_strategy_text', defaultPlaybook);
    triggerNotification("Playbook reset to template", "info");
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

  // Start AI Market Watcher
  const startAiMarketWatcher = async () => {
    setWatcherErrorMessage(null);
    try {
      const key = await getGeminiKey();
      if (!key) {
        setWatcherErrorMessage("Please add your Gemini API key in Settings before starting the AI Market Watcher.");
        triggerNotification("Gemini API key required", "info");
        return;
      }

      // Check Telegram connection requirement
      if (!session?.user) {
        setWatcherErrorMessage("You must be logged in to activate the AI Market Watcher.");
        triggerNotification("Auth session required", "info");
        return;
      }

      setIsTelegramLoading(true);
      const { data: conn, error: connErr } = await getTelegramConnection(session.user.id);
      setIsTelegramLoading(false);

      if (connErr) {
        setWatcherErrorMessage("Failed to check Telegram connection status: " + (connErr.message || connErr));
        triggerNotification("Connection check failed", "info");
        return;
      }

      if (!conn || !conn.connected) {
        setWatcherErrorMessage("Please connect your Telegram account before activating the AI Market Watcher.");
        triggerNotification("Telegram connection required", "info");
        return;
      }

      // Prepare infrastructure by passing to backend
      const response = await fetch('/api/watcher/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ apiKey: key })
      });

      if (!response.ok) {
        throw new Error("Failed to initialize backend analysis service.");
      }

      setIsWatcherActive(true);
      triggerNotification("AI Market Watcher started!", "success");
    } catch (err: any) {
      setWatcherErrorMessage(err.message || "An unexpected error occurred.");
      triggerNotification("Failed to start Watcher", "info");
    }
  };

  const stopAiMarketWatcher = () => {
    setIsWatcherActive(false);
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

  const savePreferences = () => {
    localStorage.setItem('gaks_capital', capital);
    localStorage.setItem('gaks_custom_capital', customCapital);
    localStorage.setItem('gaks_preferred_risk', preferredRisk);
    localStorage.setItem('gaks_risk_reward', riskReward);
    localStorage.setItem('gaks_account_type', accountType);
    localStorage.setItem('gaks_sessions', JSON.stringify(preferredSessions));
    localStorage.setItem('gaks_timeframes', JSON.stringify(preferredTimeframes));
    triggerNotification("Trading preferences successfully saved!");
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

    // Check if already in watchlist
    if (watchlist.some(w => w.symbol === cleanSymbol)) {
      triggerNotification(`${cleanSymbol} is already in your watchlist`, 'info');
      setWatcherSearch('');
      return;
    }

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

    const updatedWatchlist = [...watchlist, newPair];
    setWatchlist(updatedWatchlist);
    localStorage.setItem('gaks_watchlist', JSON.stringify(updatedWatchlist));
    setWatcherSearch('');
    
    if (session?.user) {
      addWatchlistItemToSupabase(newPair, session.user.id);
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

              {/* Strategy Editor Card */}
              <div className="rounded-3xl border border-zinc-800 bg-[#0c0c0e]/80 overflow-hidden flex flex-col">
                <div className="px-5 py-3 border-b border-zinc-900 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span className="text-xs font-semibold text-zinc-400">Strategy Editor</span>
                </div>
                
                <div className="p-5 flex flex-col gap-4">
                  <textarea
                    value={strategyText}
                    onChange={(e) => setStrategyText(e.target.value)}
                    placeholder="Describe your trading strategy in detail..."
                    className="w-full h-44 bg-zinc-950/60 border border-zinc-900 rounded-2xl p-4 text-xs font-medium text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-700 leading-relaxed resize-none font-sans"
                  />

                  {/* Card Actions */}
                  <div className="flex justify-between items-center pt-1">
                    <div className="flex gap-2">
                      <button
                        onClick={resetStrategyPlaybook}
                        className="p-2 rounded-xl border border-zinc-800 hover:border-zinc-700 bg-zinc-950/40 text-zinc-400 hover:text-white transition-all flex items-center gap-1.5 text-xs font-medium cursor-pointer"
                        title="Reset playbook"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Reset</span>
                      </button>
                      <button
                        onClick={syncStrategy}
                        className="p-2 rounded-xl border border-zinc-800 hover:border-zinc-700 bg-zinc-950/40 text-zinc-400 hover:text-white transition-all flex items-center gap-1.5 text-xs font-medium cursor-pointer"
                        title="Sync playbook"
                      >
                        <CloudLightning className="w-3.5 h-3.5" />
                        <span>Sync</span>
                      </button>
                    </div>
                    
                    <button
                      onClick={saveStrategyPlaybook}
                      className="px-5 py-2 rounded-full bg-white text-xs font-bold text-black hover:bg-zinc-200 transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Save Strategy</span>
                    </button>
                  </div>
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
                          <div className={`w-3.5 h-3.5 rounded-full ${isWatcherActive ? 'bg-purple-500 animate-pulse' : 'bg-zinc-700'}`}></div>
                          {isWatcherActive && <div className="absolute inset-0 rounded-full bg-purple-500 animate-ping opacity-70"></div>}
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-white">AI Market Watcher Engine</h4>
                          <p className="text-[10px] text-zinc-400">
                            Status: <span className={isWatcherActive ? 'text-purple-400 font-bold' : 'text-zinc-500 font-bold'}>{isWatcherActive ? 'ACTIVE & MONITORED' : 'STANDBY'}</span>
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={isWatcherActive ? stopAiMarketWatcher : startAiMarketWatcher}
                        className={`px-5 py-2.5 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm ${
                          isWatcherActive 
                            ? 'bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700' 
                            : 'bg-purple-600 text-white hover:bg-purple-500 active:scale-95'
                        }`}
                      >
                        {isWatcherActive ? (
                          <>
                            <X className="w-3.5 h-3.5" />
                            <span>Stop Engine</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Start Engine</span>
                          </>
                        )}
                      </button>
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
                  <Sparkles className="w-4 h-4 text-purple-400 animate-pulse" />
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
                            if (!watcherSearch.trim()) {
                              triggerNotification('Please enter a valid asset symbol first.', 'info');
                            } else {
                              handleAddPair(watcherSearch, watcherTimeframe);
                            }
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
                                ? 'bg-purple-600 text-white shadow-sm shadow-purple-900/20'
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
                  <button
                    onClick={() => {
                      if (!watcherSearch.trim()) {
                        triggerNotification('Please enter a valid asset symbol first.', 'info');
                        return;
                      }
                      handleAddPair(watcherSearch, watcherTimeframe);
                    }}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-full bg-white text-xs font-bold text-black hover:bg-zinc-200 active:scale-[0.98] transition-all cursor-pointer shadow-sm font-display mt-2"
                  >
                    <Play className="w-3.5 h-3.5 fill-current text-purple-600 stroke-purple-600" />
                    <span>Activate Market Watcher</span>
                  </button>
                </div>
              </div>

              {/* Quick Add Pills */}
              <div className="space-y-2.5">
                <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Select Symbol to Configure:</span>
                <div className="flex flex-wrap gap-2">
                  {['EURUSD', 'GBPUSD', 'XAUUSD', 'BTCUSD', 'NAS100', 'US30'].map(symbol => (
                    <button
                      key={symbol}
                      onClick={() => {
                        setWatcherSearch(symbol);
                        triggerNotification(`Selected ${symbol}. Choose a timeframe and press Activate.`, 'info');
                      }}
                      className="px-3.5 py-1.5 rounded-full text-xs font-semibold border border-zinc-900 bg-zinc-950/40 text-zinc-300 hover:text-white hover:border-zinc-800 transition-all cursor-pointer"
                    >
                      {symbol}
                    </button>
                  ))}
                </div>
              </div>

              {/* Watchlist Display area */}
              <div className="space-y-4">
                {watchlist.length === 0 ? (
                  /* Empty state - Matches Screenshot 11 exactly */
                  <div className="p-12 rounded-3xl border border-zinc-800 bg-[#0c0c0e]/40 flex flex-col items-center text-center space-y-4">
                    <div className="w-12 h-12 rounded-full bg-zinc-950/80 border border-zinc-900 flex items-center justify-center text-zinc-400">
                      <Search className="w-5 h-5 text-zinc-400 stroke-[1.8]" />
                    </div>
                    <div className="space-y-1.5 max-w-[240px]">
                      <h3 className="text-sm font-bold text-white">Your watchlist is empty</h3>
                      <p className="text-[11px] text-zinc-500 leading-relaxed">
                        Add a symbol above to start tracking live prices, spread, volatility and AI confidence.
                      </p>
                    </div>
                  </div>
                ) : (
                  /* Watchlisted symbols cards deck */
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">Your Tracking Watchlist ({watchlist.length})</h4>
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
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider bg-purple-950/30 text-purple-400 border border-purple-900/40 uppercase">
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
                                <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse"></div>
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
                  <Sparkles className="w-5 h-5 text-purple-500" />
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
                      className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-purple-600 text-xs font-bold text-white hover:bg-purple-500 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isGeminiKeySaving ? (
                        <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin"></div>
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
        </nav>

      </div>
    </div>
  );
}
