import React from 'react';
import { WatchlistItem } from '../types';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface Props {
  watchlist: WatchlistItem[];
  onRemove: (symbol: string) => void;
  getSparklinePaths: (points: number[] | undefined, width: number, height: number) => { lineD: string; fillD: string };
}

const sentimentColors = {
  Bullish: { bg: 'bg-[#10b981]', border: 'border-[#10b981]', text: 'text-white', glow: 'shadow-[0_0_15px_rgba(16,185,129,0.3)]', bar: 'bg-[#10b981]' },
  Bearish: { bg: 'bg-[#ef4444]', border: 'border-[#ef4444]', text: 'text-white', glow: 'shadow-[0_0_15px_rgba(239,68,68,0.3)]', bar: 'bg-[#ef4444]' },
  Neutral: { bg: 'bg-[#6b7280]', border: 'border-[#6b7280]', text: 'text-white', glow: '', bar: 'bg-[#6b7280]' }
};

export const MarketHeatMap: React.FC<Props> = ({ watchlist, onRemove, getSparklinePaths }) => {
  const sortedWatchlist = [...watchlist].sort((a, b) => b.confidence - a.confidence);

  const bullishCount = watchlist.filter(w => w.direction === 'Bullish').length;
  const bearishCount = watchlist.filter(w => w.direction === 'Bearish').length;
  const neutralCount = watchlist.filter(w => w.direction === 'Neutral').length;

  const overallSentiment = bullishCount > bearishCount ? 'Bullish' : bearishCount > bullishCount ? 'Bearish' : 'Neutral';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-6 rounded-3xl border border-zinc-800 bg-[#0c0c0e]/80">
        <div className="text-sm font-semibold text-zinc-400">
          🟢 Bullish: {bullishCount}
        </div>
        <div className="text-sm font-semibold text-zinc-400">
          🔴 Bearish: {bearishCount}
        </div>
        <div className="text-sm font-semibold text-zinc-400">
          ⚪ Neutral: {neutralCount}
        </div>
        <div className="text-sm font-semibold text-white">
          Overall: <span className={overallSentiment === 'Bullish' ? 'text-emerald-500' : overallSentiment === 'Bearish' ? 'text-red-500' : 'text-zinc-500'}>{overallSentiment}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {sortedWatchlist.map(pair => {
          const sentiment = sentimentColors[pair.direction];
          const isStrong = pair.confidence >= 80;
          const pulseClass = isStrong ? 'animate-pulse' : '';
          
          return (
            <div
              key={pair.symbol}
              className={`p-6 rounded-2xl border ${sentiment.border} bg-[#111113]/90 flex flex-col gap-4 transition-all duration-300 ${sentiment.glow} ${pulseClass}`}
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    {pair.symbol}
                    {pair.direction === 'Bullish' && <TrendingUp className="w-4 h-4 text-emerald-500" />}
                    {pair.direction === 'Bearish' && <TrendingDown className="w-4 h-4 text-red-500" />}
                  </h3>
                  <p className="text-xs text-zinc-400">{pair.name}</p>
                </div>
                <div className={`px-2 py-1 rounded-md ${sentiment.bg} ${sentiment.text} text-xs font-bold`}>
                  {pair.direction}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>Confidence</span>
                  <span>{pair.confidence}%</span>
                </div>
                <div className="w-full bg-zinc-800 rounded-full h-2">
                  <div className={`${sentiment.bar} h-2 rounded-full`} style={{ width: `${pair.confidence}%` }}></div>
                </div>
              </div>

              <div className="text-2xl font-bold text-white">
                {pair.price}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
