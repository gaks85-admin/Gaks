import React, { useState, useEffect, useMemo } from 'react';
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
  Info
} from 'lucide-react';

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
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'strategy' | 'watcher'>('home');
  const [currentTime, setCurrentTime] = useState<Date>(new Date('2026-06-28T15:01:00'));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  
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
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);

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

  // Forex live rates initial data
  const [liveRates, setLiveRates] = useState<ForexPair[]>([
    {
      symbol: 'EURUSD',
      name: 'Euro / US Dollar',
      price: 1.0875,
      change: -0.56,
      sentiment: 'Bearish',
      history: [1.0920, 1.0910, 1.0895, 1.0890, 1.0882, 1.0870, 1.0875]
    },
    {
      symbol: 'GBPUSD',
      name: 'British Pound / US Dollar',
      price: 1.2734,
      change: -0.26,
      sentiment: 'Bearish',
      history: [1.2780, 1.2770, 1.2762, 1.2745, 1.2750, 1.2730, 1.2734]
    },
    {
      symbol: 'USDJPY',
      name: 'US Dollar / Japanese Yen',
      price: 156.42,
      change: -0.38,
      sentiment: 'Bearish',
      history: [157.10, 157.02, 156.85, 156.70, 156.62, 156.38, 156.42]
    },
    {
      symbol: 'USDCHF',
      name: 'US Dollar / Swiss Franc',
      price: 0.8945,
      change: 0.02,
      sentiment: 'Bullish',
      history: [0.8938, 0.8940, 0.8941, 0.8942, 0.8943, 0.8944, 0.8945]
    },
    {
      symbol: 'AUDUSD',
      name: 'Australian Dollar / US Dollar',
      price: 0.6612,
      change: -1.15,
      sentiment: 'Bearish',
      history: [0.6705, 0.6685, 0.6660, 0.6645, 0.6630, 0.6610, 0.6612]
    }
  ]);

  // Quick Analyze Mock Results
  const mockAnalysisPhrases = [
    "Divergence detected on EURUSD H1 chart near key support. Expect a potential reversal.",
    "USDJPY displaying a strong breakout sequence above daily consolidation range.",
    "High volatility expected in London session due to CPI release. Risk management is key.",
    "AUDUSD oversold on M15 RSI. Minor scalp buying opportunities detected.",
    "GBPUSD correlation with EURUSD remains tight at 0.92. Avoid double exposure."
  ];

  // Refresh live rates with minor realistic random walk
  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setLiveRates(prev =>
        prev.map(p => {
          const changePercent = (Math.random() * 0.4 - 0.2) / 100;
          const newPrice = Number((p.price * (1 + changePercent)).toFixed(p.price > 10 ? 2 : 4));
          const totalChange = Number((p.change + changePercent * 100).toFixed(2));
          const newHistory = [...p.history.slice(1), newPrice];
          return {
            ...p,
            price: newPrice,
            change: totalChange,
            sentiment: totalChange >= 0 ? 'Bullish' : 'Bearish',
            history: newHistory
          };
        })
      );
      // Update time slightly
      setCurrentTime(new Date());
      setIsRefreshing(false);
      triggerNotification("Rates updated successfully", "info");
    }, 800);
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
  const handleAddPair = (symbolToAdd: string) => {
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
      history: Array.from({ length: 7 }, () => finalPrice * (1 + (Math.random() * 0.02 - 0.01)))
    };

    const updatedWatchlist = [...watchlist, newPair];
    setWatchlist(updatedWatchlist);
    localStorage.setItem('gaks_watchlist', JSON.stringify(updatedWatchlist));
    setWatcherSearch('');
    triggerNotification(`${cleanSymbol} added to watchlist!`);
  };

  const handleRemovePair = (symbolToRemove: string) => {
    const updatedWatchlist = watchlist.filter(w => w.symbol !== symbolToRemove);
    setWatchlist(updatedWatchlist);
    localStorage.setItem('gaks_watchlist', JSON.stringify(updatedWatchlist));
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

  return (
    <div className="min-h-screen bg-[#030303] text-zinc-100 flex justify-center items-start font-sans antialiased overflow-x-hidden selection:bg-zinc-800 selection:text-white">
      {/* Maximum-width wrapper modeled for an incredible mobile aspect layout & gorgeous desktop presentation */}
      <div className="w-full max-w-md bg-[#080808] min-h-screen pb-32 border-x border-zinc-900 shadow-2xl relative flex flex-col">
        
        {/* Header - Matches Screenshot 2 */}
        <header className="px-6 py-5 border-b border-zinc-900/80 flex justify-between items-center bg-[#080808]/90 sticky top-0 z-40 backdrop-blur-md">
          <div className="flex items-center gap-1.5">
            <span className="text-xl font-bold tracking-tight text-white font-display">Gaks</span>
            <span className="text-sm font-semibold text-zinc-500 font-display">AI</span>
          </div>
          <button className="p-1.5 text-zinc-400 hover:text-white transition-all rounded-lg hover:bg-zinc-900" title="Logout">
            <LogOut className="w-5 h-5 stroke-[1.8]" />
          </button>
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

              {/* Add Custom Forex Ticker Form - Matches Screenshot 11 */}
              <div className="space-y-3">
                <div className="relative rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden focus-within:border-zinc-700">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input
                    type="text"
                    value={watcherSearch}
                    onChange={(e) => setWatcherSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddPair(watcherSearch)}
                    placeholder="Enter a Forex pair... EURUSD, XAUUSD,"
                    className="w-full bg-transparent border-0 py-3.5 pl-11 pr-4 text-xs font-semibold text-white focus:outline-none"
                  />
                </div>
                
                <button
                  onClick={() => handleAddPair(watcherSearch)}
                  className="w-full flex items-center justify-center gap-1.5 px-5 py-3.5 rounded-full bg-white text-xs font-bold text-black hover:bg-zinc-200 transition-all cursor-pointer shadow-sm"
                >
                  <Plus className="w-4 h-4 stroke-[3]" />
                  <span>Add Pair</span>
                </button>
              </div>

              {/* Quick Add Pills */}
              <div className="space-y-2.5">
                <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Quick add:</span>
                <div className="flex flex-wrap gap-2">
                  {['EURUSD', 'GBPUSD', 'XAUUSD', 'BTCUSD', 'NAS100', 'US30'].map(symbol => (
                    <button
                      key={symbol}
                      onClick={() => handleAddPair(symbol)}
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
            <div className={`p-2 rounded-2xl w-[80%] flex flex-col items-center gap-1.5 transition-all ${
              activeTab === 'home' ? 'bg-[#151515] text-white font-semibold' : ''
            }`}>
              <HomeIcon className="w-5 h-5 stroke-[1.8]" />
              <span className="text-[10px] uppercase tracking-wider font-bold">Home</span>
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
            <div className={`p-2 rounded-2xl w-[80%] flex flex-col items-center gap-1.5 transition-all ${
              activeTab === 'strategy' ? 'bg-[#151515] text-white font-semibold' : ''
            }`}>
              <TrendingUp className="w-5 h-5 stroke-[1.8]" />
              <span className="text-[10px] uppercase tracking-wider font-bold">Strategy</span>
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
            <div className={`p-2 rounded-2xl w-[80%] flex flex-col items-center gap-1.5 transition-all ${
              activeTab === 'watcher' ? 'bg-[#151515] text-white font-semibold' : ''
            }`}>
              <Eye className="w-5 h-5 stroke-[1.8]" />
              <span className="text-[10px] uppercase tracking-wider font-bold">Market Watcher</span>
            </div>
          </button>
        </nav>

      </div>
    </div>
  );
}
