import React from 'react';
import { 
  Info, 
  Send, 
  CheckCircle2, 
  Sparkles, 
  Search, 
  AlertTriangle, 
  X, 
  Play, 
  Check,
  TrendingUp,
  TrendingDown,
  Target,
  ShieldAlert,
  Clock,
  Activity,
  Zap
} from 'lucide-react';
import { WatchlistItem } from '../types';
import { normalizeSymbol } from '../../lib/market-utils';

export interface ActiveTradeData {
  watcherId?: string;
  tradeId?: string | null;
  symbol: string;
  timeframe: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  currentPrice?: number;
  openedAt?: string | null;
}

export interface WatcherTabProps {
  isTelegramLoading: boolean;
  telegramConnection: { connected: boolean; telegram_username?: string } | null;
  isTelegramConnecting: boolean;
  handleConnectTelegram: () => void;
  isWatcherActive: boolean;
  watcherTradeStatus: string;
  watcherSearch: string;
  setWatcherSearch: (val: string) => void;
  watcherTimeframe: string;
  setWatcherTimeframe: (val: string) => void;
  watcherLastScanAt: string | null;
  watcherLastCandle: string | null;
  watcherErrorMessage: string | null;
  isTimeframeMismatch: boolean;
  compiledStrategyTimeframes: string[];
  watchlist: WatchlistItem[];
  stopAiMarketWatcher: () => void;
  startAiMarketWatcher: (symbol: string, tf: string) => void;
  isAdmin: boolean;
  triggerNotification: (msg: string, type?: 'success' | 'error' | 'info') => void;
  getSparklinePaths: (points?: number[], width?: number, height?: number) => { lineD: string; fillD: string };
  handleRemovePair: (symbol: string) => void;
  geminiKeyExists?: boolean;
  onGoToSettings?: () => void;
  activeTrade?: ActiveTradeData | null;
  watcherZone?: {
    id?: string;
    type?: string;
    direction?: 'BUY' | 'SELL';
    high?: number;
    low?: number;
    invalidationLevel?: number;
    status?: string;
    reasoning?: string;
    tappedAt?: string | null;
  } | null;
  onResolveTrade?: (watcherId: string, resolutionType: 'TP_HIT' | 'SL_HIT' | 'BREAKEVEN' | 'MANUAL_CLOSE', exitPrice?: number) => Promise<void>;
  isResolvingTrade?: boolean;
}

export const WatcherTab: React.FC<WatcherTabProps> = ({
  isTelegramLoading,
  telegramConnection,
  isTelegramConnecting,
  handleConnectTelegram,
  isWatcherActive,
  watcherTradeStatus,
  watcherSearch,
  setWatcherSearch,
  watcherTimeframe,
  setWatcherTimeframe,
  watcherLastScanAt,
  watcherLastCandle,
  watcherErrorMessage,
  isTimeframeMismatch,
  compiledStrategyTimeframes,
  watchlist,
  stopAiMarketWatcher,
  startAiMarketWatcher,
  isAdmin,
  triggerNotification,
  getSparklinePaths,
  handleRemovePair,
  geminiKeyExists = true,
  onGoToSettings,
  activeTrade,
  watcherZone,
  onResolveTrade,
  isResolvingTrade = false,
}) => {
  // Derive telemetry if activeTrade is available
  const activeTelemetry = React.useMemo(() => {
    if (!activeTrade || !activeTrade.entryPrice || !activeTrade.stopLoss || !activeTrade.takeProfit) {
      return null;
    }
    const cleanSym = (activeTrade.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const pipSize = (cleanSym.includes('JPY') || cleanSym.includes('XAU') || cleanSym.includes('GOLD') || cleanSym.includes('BTC')) ? 0.01 : 0.0001;
    const isBuy = (activeTrade.direction || 'BUY').toUpperCase() === 'BUY';
    const currentPrice = activeTrade.currentPrice || activeTrade.entryPrice;
    
    const riskDist = isBuy ? activeTrade.entryPrice - activeTrade.stopLoss : activeTrade.stopLoss - activeTrade.entryPrice;
    const rewardDist = isBuy ? activeTrade.takeProfit - activeTrade.entryPrice : activeTrade.entryPrice - activeTrade.takeProfit;
    const profitDist = isBuy ? currentPrice - activeTrade.entryPrice : activeTrade.entryPrice - currentPrice;

    const unrealizedR = riskDist > 0 ? Math.round((profitDist / riskDist) * 100) / 100 : 0;
    const targetR = riskDist > 0 ? Math.round((rewardDist / riskDist) * 100) / 100 : 2.0;

    const pipsProfit = Math.round((profitDist / pipSize) * 10) / 10;
    const pipsToTP = Math.round((Math.abs(activeTrade.takeProfit - currentPrice) / pipSize) * 10) / 10;
    const pipsToSL = Math.round((Math.abs(activeTrade.stopLoss - currentPrice) / pipSize) * 10) / 10;

    const totalRange = Math.abs(activeTrade.takeProfit - activeTrade.stopLoss);
    let progressPct = 50;
    if (totalRange > 0) {
      if (isBuy) {
        progressPct = Math.min(100, Math.max(0, Math.round(((currentPrice - activeTrade.stopLoss) / totalRange) * 100)));
      } else {
        progressPct = Math.min(100, Math.max(0, Math.round(((activeTrade.stopLoss - currentPrice) / totalRange) * 100)));
      }
    }

    return {
      unrealizedR,
      targetR,
      pipsProfit,
      pipsToTP,
      pipsToSL,
      progressPct,
      currentPrice
    };
  }, [activeTrade]);
  return (
    <div className="space-y-8 animate-fade-in">
      
      {/* Header Title */}
      <div className="space-y-2">
        <h1 className="text-[32px] sm:text-[36px] font-semibold tracking-[-0.035em] text-zinc-950 dark:text-white leading-[1.15] font-sans">Market Watcher</h1>
        <p className="text-[15px] sm:text-[16px] font-normal tracking-[-0.01em] text-zinc-500 dark:text-zinc-400 leading-[1.45] max-w-sm">
          Build a personal watchlist with AI signals and confidence scoring.
        </p>
      </div>

      {/* AI Watcher Activation Widget */}
      <div className="p-5 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e]/60 space-y-4 shadow-sm">
        {isTelegramLoading ? (
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-400 dark:border-t-zinc-400 animate-spin"></div>
              <div>
                <h4 className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Checking Telegram Connection...</h4>
                <p className="text-[10px] text-zinc-500">Querying secure alert routing states</p>
              </div>
            </div>
          </div>
        ) : !telegramConnection?.connected ? (
          <div className="space-y-4 w-full">
            <div className="p-4 rounded-2xl border border-amber-500/10 bg-amber-500/5 text-amber-600 dark:text-amber-400 text-xs space-y-2">
              <div className="flex items-center gap-2 font-semibold">
                <Info className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>Telegram Connection Required</span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-normal">
                Please connect your Telegram account before activating the AI Market Watcher.
              </p>
            </div>

            <div className="flex items-center justify-between gap-4 pt-1">
              <div className="flex items-center gap-3">
                <div className="w-3.5 h-3.5 rounded-full bg-zinc-200 dark:bg-zinc-700"></div>
                <div>
                  <h4 className="text-xs font-bold text-zinc-950 dark:text-white">AI Market Watcher Engine</h4>
                  <p className="text-[10px] text-zinc-500">Status: <span className="font-bold">STANDBY (LINK REQUIRED)</span></p>
                </div>
              </div>

              <button
                onClick={handleConnectTelegram}
                disabled={isTelegramConnecting}
                className="px-5 py-2.5 rounded-full text-xs font-bold bg-zinc-950 dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer shadow-md disabled:opacity-50"
              >
                {isTelegramConnecting ? (
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-white dark:border-black border-t-transparent animate-spin"></div>
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
            <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 text-zinc-900 dark:text-zinc-200 text-xs flex items-center justify-between shadow-xs">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>Telegram Connected</span>
              </div>
              {telegramConnection?.telegram_username && (
                <span className="text-[10px] font-mono text-zinc-700 dark:text-zinc-300 bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
                  @{telegramConnection.telegram_username}
                </span>
              )}
            </div>

            {!geminiKeyExists && !isWatcherActive && (
              <div className="p-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold">
                    <Info className="w-4 h-4 shrink-0 text-amber-500" />
                    <span>Gemini API Key Required</span>
                  </div>
                  {onGoToSettings && (
                    <button
                      type="button"
                      onClick={onGoToSettings}
                      className="px-3 py-1 rounded-full bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 font-semibold text-[11px] transition-colors cursor-pointer"
                    >
                      Configure in Settings &rarr;
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-normal">
                  Market Watcher requires a valid Gemini API key to perform automated market analysis. Please add your key in Settings before activating.
                </p>
              </div>
            )}

            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className={`w-3.5 h-3.5 rounded-full ${isWatcherActive ? 'bg-zinc-950 dark:bg-white animate-pulse' : 'bg-zinc-200 dark:bg-zinc-700'}`}></div>
                  {isWatcherActive && <div className="absolute inset-0 rounded-full bg-zinc-950 dark:bg-white animate-ping opacity-70"></div>}
                </div>
                <div>
                  <h4 className="text-xs font-bold text-zinc-950 dark:text-white">AI Market Watcher Engine</h4>
                  <div className="text-[10px] text-zinc-500 dark:text-zinc-400 space-y-0.5">
                    <p>
                      Status: <span className={isWatcherActive ? 'text-zinc-950 dark:text-white font-bold' : (!geminiKeyExists ? 'text-amber-500 font-bold' : 'text-zinc-400 dark:text-zinc-500 font-bold')}>
                        {isWatcherActive 
                          ? `ACTIVE & MONITORED (${watcherTradeStatus})` 
                          : (!geminiKeyExists ? 'STANDBY (GEMINI KEY REQUIRED)' : 'STANDBY')}
                      </span>
                    </p>
                    {isWatcherActive && watcherSearch && (
                      <p className="text-[9px] text-zinc-500 font-mono">
                        Action: Analyzing {watcherSearch} on {watcherTimeframe}
                      </p>
                    )}
                    {isWatcherActive && watcherLastScanAt && (
                      <p className="text-[9px] text-zinc-500 font-mono">
                        Last Scan: {new Date(watcherLastScanAt).toLocaleTimeString()}
                      </p>
                    )}
                    {isWatcherActive && watcherLastCandle && (
                      <p className="text-[9px] text-zinc-500 font-mono">
                        Last Candle: {watcherLastCandle}
                      </p>
                    )}
                  </div>
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

      {/* Marked Trading Zone Card (When waiting for tap or tapped) */}
      {isWatcherActive && watcherTradeStatus !== 'ACTIVE' && watcherZone && (
        <div className={`p-5 rounded-3xl border ${
          watcherZone.status === 'ZONE_TAPPED'
            ? 'border-indigo-500/30 dark:border-indigo-500/20 bg-indigo-500/5 dark:bg-indigo-950/20'
            : 'border-amber-500/30 dark:border-amber-500/20 bg-amber-500/5 dark:bg-amber-950/20'
        } space-y-4 shadow-sm animate-fade-in`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Target className={`w-4 h-4 ${watcherZone.status === 'ZONE_TAPPED' ? 'text-indigo-500' : 'text-amber-500'}`} />
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">
                Marked Zone Markout
              </span>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border ${
                watcherZone.status === 'ZONE_TAPPED'
                  ? 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-800'
                  : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800'
              }`}>
                {watcherZone.status === 'ZONE_TAPPED' ? 'ZONE TAPPED · EVALUATING CONFIRMATION' : 'WAITING FOR PRICE TAP'}
              </span>
              {watcherZone.type && (
                <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-md uppercase">
                  {watcherZone.type} ({watcherZone.direction || 'ZONE'})
                </span>
              )}
            </div>
            {watcherZone.reasoning && (
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400 italic">
                {watcherZone.reasoning}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-2xl bg-white/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 space-y-0.5 shadow-xs">
              <span className="text-[10px] uppercase font-bold text-zinc-500 block">Zone High</span>
              <span className="text-xs sm:text-sm font-bold font-mono text-zinc-900 dark:text-white tabular-nums">
                {watcherZone.high}
              </span>
            </div>
            <div className="p-3 rounded-2xl bg-white/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 space-y-0.5 shadow-xs">
              <span className="text-[10px] uppercase font-bold text-zinc-500 block">Zone Low</span>
              <span className="text-xs sm:text-sm font-bold font-mono text-zinc-900 dark:text-white tabular-nums">
                {watcherZone.low}
              </span>
            </div>
            {watcherZone.invalidationLevel && (
              <div className="p-3 rounded-2xl bg-white/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 space-y-0.5 shadow-xs">
                <span className="text-[10px] uppercase font-bold text-rose-500 block">Invalidation Level</span>
                <span className="text-xs sm:text-sm font-bold font-mono text-zinc-900 dark:text-white tabular-nums">
                  {watcherZone.invalidationLevel}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Active Trade Live Telemetry Card (When in ACTIVE trade status) */}
      {isWatcherActive && watcherTradeStatus === 'ACTIVE' && activeTrade && activeTelemetry && (
        <div className="p-6 rounded-3xl border border-emerald-500/30 dark:border-emerald-500/20 bg-emerald-500/5 dark:bg-[#0c1610]/80 space-y-5 shadow-md animate-fade-in relative overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                Active Live Position
              </span>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border ${
                activeTrade.direction === 'BUY'
                  ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                  : 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800'
              }`}>
                {activeTrade.direction}
              </span>
              <span className="text-xs font-bold text-zinc-900 dark:text-white">
                {activeTrade.symbol} · {activeTrade.timeframe}
              </span>
              {activeTrade.tradeId && (
                <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-md">
                  {activeTrade.tradeId}
                </span>
              )}
            </div>

            <div className="text-right">
              <div className={`text-base sm:text-lg font-bold font-mono tracking-tight ${
                activeTelemetry.unrealizedR >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'
              }`}>
                {activeTelemetry.unrealizedR >= 0 ? '+' : ''}{activeTelemetry.unrealizedR.toFixed(2)} R
                <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400 ml-1.5 font-sans">
                  ({activeTelemetry.pipsProfit >= 0 ? '+' : ''}{activeTelemetry.pipsProfit} pips)
                </span>
              </div>
            </div>
          </div>

          {/* 4-Metric Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
            <div className="p-3 rounded-2xl bg-white/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 space-y-0.5 shadow-xs">
              <span className="text-[10px] uppercase font-bold text-zinc-500 block">Entry Price</span>
              <span className="text-xs sm:text-sm font-bold font-mono text-zinc-900 dark:text-white tabular-nums">
                {activeTrade.entryPrice}
              </span>
            </div>
            <div className="p-3 rounded-2xl bg-white/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 space-y-0.5 shadow-xs">
              <span className="text-[10px] uppercase font-bold text-zinc-500 block">Current Price</span>
              <span className="text-xs sm:text-sm font-bold font-mono text-zinc-900 dark:text-white tabular-nums">
                {activeTelemetry.currentPrice}
              </span>
            </div>
            <div className="p-3 rounded-2xl bg-white/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 space-y-0.5 shadow-xs">
              <span className="text-[10px] uppercase font-bold text-rose-500 block">Stop Loss</span>
              <div className="flex items-center justify-between">
                <span className="text-xs sm:text-sm font-bold font-mono text-zinc-900 dark:text-white tabular-nums">
                  {activeTrade.stopLoss}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono">
                  {activeTelemetry.pipsToSL}p
                </span>
              </div>
            </div>
            <div className="p-3 rounded-2xl bg-white/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 space-y-0.5 shadow-xs">
              <span className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400 block">Take Profit</span>
              <div className="flex items-center justify-between">
                <span className="text-xs sm:text-sm font-bold font-mono text-zinc-900 dark:text-white tabular-nums">
                  {activeTrade.takeProfit}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono">
                  {activeTelemetry.pipsToTP}p
                </span>
              </div>
            </div>
          </div>

          {/* Visual Range Bar */}
          <div className="space-y-1.5 pt-1">
            <div className="flex justify-between text-[10px] font-bold text-zinc-500">
              <span className="text-rose-500">SL: {activeTrade.stopLoss}</span>
              <span className="text-zinc-600 dark:text-zinc-300">Progress: {activeTelemetry.progressPct}%</span>
              <span className="text-emerald-600 dark:text-emerald-400">TP: {activeTrade.takeProfit} ({activeTelemetry.targetR}R)</span>
            </div>
            <div className="w-full h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden relative">
              <div 
                className={`h-full transition-all duration-500 ${
                  activeTelemetry.unrealizedR >= 0 ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
                style={{ width: `${activeTelemetry.progressPct}%` }}
              ></div>
            </div>
          </div>

          {/* Manual Outcome Resolution Controls */}
          {onResolveTrade && activeTrade.watcherId && (
            <div className="pt-2 border-t border-emerald-500/20 dark:border-emerald-500/10 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                Manual broker sync actions:
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  disabled={isResolvingTrade}
                  onClick={() => onResolveTrade(activeTrade.watcherId!, 'TP_HIT', activeTrade.takeProfit)}
                  className="px-3 py-1.5 rounded-xl text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-all cursor-pointer shadow-xs disabled:opacity-50"
                >
                  Hit Target (+{activeTelemetry.targetR}R)
                </button>
                <button
                  disabled={isResolvingTrade}
                  onClick={() => onResolveTrade(activeTrade.watcherId!, 'BREAKEVEN', activeTrade.entryPrice)}
                  className="px-3 py-1.5 rounded-xl text-[10px] font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-all cursor-pointer shadow-xs disabled:opacity-50"
                >
                  Breakeven (0.0R)
                </button>
                <button
                  disabled={isResolvingTrade}
                  onClick={() => onResolveTrade(activeTrade.watcherId!, 'SL_HIT', activeTrade.stopLoss)}
                  className="px-3 py-1.5 rounded-xl text-[10px] font-bold bg-rose-600 hover:bg-rose-700 text-white transition-all cursor-pointer shadow-xs disabled:opacity-50"
                >
                  Hit Stop (-1.0R)
                </button>
                <button
                  disabled={isResolvingTrade}
                  onClick={() => onResolveTrade(activeTrade.watcherId!, 'MANUAL_CLOSE', activeTelemetry.currentPrice)}
                  className="px-3 py-1.5 rounded-xl text-[10px] font-bold border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 transition-all cursor-pointer shadow-xs disabled:opacity-50"
                >
                  Close at Market
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add Custom Forex Ticker Form with Timeframe and Activate Button */}
      <div className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e]/80 space-y-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-zinc-950 dark:text-white animate-pulse" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Configure Market Watcher</h3>
        </div>
        
        <div className="space-y-4">
          {/* Pair input */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 block">Forex Pair / Asset Symbol</label>
            <div className="relative rounded-2xl border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950/60 overflow-hidden focus-within:border-zinc-400 dark:focus-within:border-zinc-700 shadow-sm">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 dark:text-zinc-500" />
              <input
                type="text"
                value={watcherSearch}
                onChange={(e) => setWatcherSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                className="w-full bg-transparent border-0 py-3.5 pl-11 pr-4 text-xs font-semibold text-zinc-800 dark:text-white focus:outline-none"
              />
            </div>
          </div>

           {/* Timeframe selector */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 block">Analysis Timeframe</label>
            <div className="flex flex-wrap gap-1.5 p-1 rounded-2xl border border-zinc-200 dark:border-zinc-900 bg-zinc-50 dark:bg-zinc-950/40 shadow-inner">
              {['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'Daily'].map(tf => {
                const isSelected = watcherTimeframe === tf;
                return (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => setWatcherTimeframe(tf)}
                    className={`flex-1 min-w-[42px] py-2 rounded-xl text-[10px] font-bold transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-white shadow-sm border border-zinc-200 dark:border-zinc-800'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white hover:bg-white/50 dark:hover:bg-zinc-900/40'
                    }`}
                  >
                    {tf}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Timeframe Mismatch Warning */}
          {isTimeframeMismatch && (
            <div className="p-4 rounded-2xl border border-rose-500/10 bg-rose-500/5 text-rose-600 dark:text-rose-400 text-xs space-y-2">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400 animate-pulse" />
                <span>Strategy Timeframe Mismatch</span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-normal">
                Your strategy was written for: <span className="font-bold text-zinc-950 dark:text-white">{compiledStrategyTimeframes.join(', ')}</span>.
                You selected: <span className="font-bold text-zinc-950 dark:text-white">{watcherTimeframe}</span>.
                <br />
                Please select <span className="font-bold text-zinc-950 dark:text-white">{compiledStrategyTimeframes.join(' or ')}</span> or edit your strategy.
              </p>
            </div>
          )}

          {/* Activation Trigger */}
          {(() => {
            const isPairInWatchlist = (watchlist || []).some(w => w && w.symbol && normalizeSymbol(w.symbol) === normalizeSymbol(watcherSearch || ''));
            
            if (isWatcherActive && (isAdmin || isPairInWatchlist)) {
              const isUpdateDisabled = !watcherSearch.trim() || !watcherTimeframe || isTimeframeMismatch;
              return (
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={stopAiMarketWatcher}
                    className="flex-1 flex items-center justify-center gap-2 px-5 py-3.5 rounded-full text-xs font-bold transition-all shadow-sm font-display bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white hover:border-zinc-400 dark:hover:border-zinc-700 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Stop Watcher</span>
                  </button>
                  <button
                    disabled={isUpdateDisabled}
                    onClick={() => {
                      if (isUpdateDisabled) return;
                      startAiMarketWatcher(watcherSearch, watcherTimeframe);
                    }}
                    className={`flex-1 flex items-center justify-center gap-2 px-5 py-3.5 rounded-full text-xs font-bold transition-all shadow-sm font-display ${
                      isUpdateDisabled
                        ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 cursor-not-allowed'
                        : 'bg-zinc-950 dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 active:scale-[0.98] cursor-pointer'
                    }`}
                  >
                    <Play className={`w-3.5 h-3.5 fill-current ${isUpdateDisabled ? 'text-zinc-400 dark:text-zinc-500' : 'text-white dark:text-zinc-950 stroke-white dark:stroke-zinc-950'}`} />
                    <span>Update Watcher</span>
                  </button>
                </div>
              );
            } else {
              const isDisabled = (isWatcherActive && !isAdmin) || !watcherSearch.trim() || !watcherTimeframe || isTimeframeMismatch || !geminiKeyExists;
              return (
                <div className="space-y-3 mt-2">
                  <button
                    disabled={isDisabled}
                    onClick={() => {
                      if (isDisabled) return;
                      startAiMarketWatcher(watcherSearch, watcherTimeframe);
                    }}
                    className={`w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-full text-xs font-bold transition-all shadow-sm font-display ${
                      isDisabled
                        ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 cursor-not-allowed'
                        : 'bg-zinc-950 dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200 active:scale-[0.98] cursor-pointer'
                    }`}
                  >
                    <Play className={`w-3.5 h-3.5 fill-current ${isDisabled ? 'text-zinc-400 dark:text-zinc-500' : 'text-white dark:text-zinc-950 stroke-white dark:stroke-zinc-950'}`} />
                    <span>Activate Market Watcher</span>
                  </button>

                  {!geminiKeyExists && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 text-center font-medium">
                      Gemini API key required. Configure your key in Settings to activate.
                    </p>
                  )}
                  
                  {isWatcherActive && !isAdmin && (
                    <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 text-center text-[11px] leading-relaxed shadow-inner">
                      Free accounts can monitor one market at a time.
                    </div>
                  )}
                </div>
              );
            }
          })()}
        </div>
      </div>

      {/* Quick Add Pills */}
      <div className="space-y-2.5">
        <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Select Symbol to Configure:</span>
        <div className="flex flex-wrap gap-2">
          {['EURUSD', 'GBPUSD', 'XAUUSD', 'BTCUSD', 'NAS100', 'US30'].map(symbol => {
            const isSelected = normalizeSymbol(watcherSearch) === normalizeSymbol(symbol);
            return (
              <button
                key={symbol}
                onClick={() => {
                  setWatcherSearch(symbol);
                  triggerNotification(`Selected ${symbol}. Choose a timeframe and press Activate.`, 'info');
                }}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1.5 ${
                  isSelected
                    ? 'border-zinc-950 dark:border-white bg-zinc-950 dark:bg-white text-white dark:text-black shadow-md'
                    : 'border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950/40 text-zinc-500 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white hover:border-zinc-400 dark:hover:border-zinc-800'
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
        {(watchlist || []).length === 0 ? (
          /* Empty state */
          <div className="p-12 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0e]/40 flex flex-col items-center text-center space-y-4 shadow-sm">
            <div className="w-12 h-12 rounded-full bg-zinc-50 dark:bg-zinc-950/80 border border-zinc-100 dark:border-zinc-900 flex items-center justify-center text-zinc-400">
              <Search className="w-5 h-5 text-zinc-400 dark:text-zinc-500 stroke-[1.8]" />
            </div>
            <div className="space-y-1.5 max-w-[240px]">
              <h3 className="text-sm font-bold text-zinc-950 dark:text-white">No pair selected</h3>
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                Select a symbol above to configure the Market Watcher.
              </p>
            </div>
          </div>
        ) : (
          /* Watchlisted symbols cards deck */
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">Monitored Pair</h4>
            {(watchlist || []).map(pair => {
              if (!pair) return null;
              const isBullish = pair.direction === 'Bullish';
              const isBearish = pair.direction === 'Bearish';
              const { lineD, fillD } = getSparklinePaths(pair.history, 100, 24);
              
              return (
                <div
                  key={pair.symbol}
                  className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#111113]/90 flex flex-col gap-4 hover:border-zinc-400 dark:hover:border-zinc-700 transition-all relative overflow-hidden shadow-lg"
                >
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <h3 className="text-base font-bold text-zinc-950 dark:text-white font-display tracking-tight flex items-center gap-2">
                        <span>{pair.symbol}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider uppercase border ${
                          isBullish
                            ? 'bg-emerald-50 dark:bg-[#0c1c0c] text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-950/80'
                            : isBearish
                            ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300 border-rose-200 dark:border-rose-900/80'
                            : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800'
                        }`}>
                          {pair.direction}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800/80 uppercase">
                          {pair.timeframe || 'H1'}
                        </span>
                      </h3>
                      <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">{pair.name}</p>
                    </div>

                    <button
                      onClick={() => handleRemovePair(pair.symbol)}
                      className="p-1 text-zinc-400 dark:text-zinc-600 hover:text-rose-600 dark:hover:text-rose-400 transition-colors rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-950/80 cursor-pointer"
                      title="Remove pair"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Bid/Ask Price display & tiny sparkline wave */}
                  <div className="flex justify-between items-end">
                    {/* Wave graphics */}
                    <div className="h-6 w-24 opacity-80 pointer-events-none">
                      {pair.status !== 'unavailable' && pair.history.length > 0 && (
                        <svg className="w-full h-full overflow-visible" viewBox="0 0 100 24" preserveAspectRatio="none">
                          <defs>
                            <linearGradient id={`watcher-grad-${pair.symbol}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={isBearish ? "#ef4444" : "#10b981"} stopOpacity="0.25"/>
                              <stop offset="100%" stopColor={isBearish ? "#ef4444" : "#10b981"} stopOpacity="0.0"/>
                            </linearGradient>
                          </defs>
                          <path d={fillD} fill={`url(#watcher-grad-${pair.symbol})`} />
                          <path d={lineD} fill="none" stroke={isBearish ? "#ef4444" : "#10b981"} strokeWidth="1.2" />
                        </svg>
                      )}
                    </div>

                    <div className="text-right">
                      {pair.status === 'unavailable' || pair.price === 0 ? (
                        <div className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Data unavailable</div>
                      ) : (
                        <>
                          <div className="text-lg font-bold text-zinc-950 dark:text-white tracking-tight">{(pair.price || 0).toLocaleString(undefined, { minimumFractionDigits: (pair.price || 0) > 10 ? 2 : 4 })}</div>
                          <div className={`text-xs font-semibold flex items-center justify-end gap-0.5 ${pair.change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-400'}`}>
                            {pair.change >= 0 ? '+' : ''}{pair.change}%
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Extra info panel: Spread, Volatility, AI Confidence meter */}
                  <div className="pt-3 border-t border-zinc-100 dark:border-zinc-900/60 grid grid-cols-3 gap-2">
                    <div className="space-y-0.5">
                      <div className="text-[9px] uppercase font-bold text-zinc-500">Spread</div>
                      <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{pair.spread} pips</div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-[9px] uppercase font-bold text-zinc-500">Volatility</div>
                      <div className={`text-xs font-semibold ${pair.volatility === 'High' ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-700 dark:text-zinc-300'}`}>{pair.volatility}</div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-[9px] uppercase font-bold text-zinc-500">AI Confidence</div>
                      <div className="text-xs font-bold text-zinc-950 dark:text-white flex items-center gap-1">
                        <span>{pair.confidence}%</span>
                        <div className="w-1.5 h-1.5 rounded-full bg-zinc-950 dark:bg-white animate-pulse"></div>
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
  );
};

export default WatcherTab;
