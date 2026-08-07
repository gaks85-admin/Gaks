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
  Check 
} from 'lucide-react';
import { WatchlistItem } from '../types';
import { normalizeSymbol } from '../../lib/market-utils';

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
}) => {
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
            <div className="p-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 text-zinc-200 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-zinc-200" />
                <span>Telegram Connected</span>
              </div>
              {telegramConnection?.telegram_username && (
                <span className="text-[10px] font-mono text-zinc-300 bg-zinc-800 px-2 py-0.5 rounded-full">
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
                            ? 'bg-rose-950/60 text-rose-300 border-rose-900/80'
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
