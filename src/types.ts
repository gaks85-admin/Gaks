export interface ForexPair {
  symbol: string;
  name: string;
  price: number;
  change: number;
  sentiment: 'Bearish' | 'Bullish' | 'Neutral';
  history: number[];
  status?: 'active' | 'unavailable';
}

export interface WatchlistItem {
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
  status?: 'active' | 'unavailable';
}

export interface Strategy {
  id: string;
  name: string;
  text: string;
  isDefault: boolean;
}
