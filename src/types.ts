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

export interface PersonalNewsProtectionSettings {
  news_restriction_enabled: boolean;
  news_buffer_before_minutes: number;
  news_buffer_after_minutes: number;
}

export interface TradingPreferences {
  user_id?: string;
  strategy_text?: string;
  strategy_summary?: string | null;
  capital?: string;
  custom_capital?: string;
  preferred_risk?: string;
  max_daily_loss?: string;
  max_daily_risk?: string;
  risk_reward?: string;
  risk_reward_ratio?: string;
  account_type?: string;
  position_mode?: 'AUTO_RISK' | 'FIXED_LOT';
  position_sizing_mode?: 'AUTO_RISK' | 'FIXED_LOT';
  fixed_lot_size?: string;
  preferred_lot_size?: number;
  preferred_sessions?: string[];
  preferred_timeframes?: string[];
  news_restriction_enabled?: boolean;
  news_buffer_before_minutes?: number;
  news_buffer_after_minutes?: number;
  updated_at?: string;
}

