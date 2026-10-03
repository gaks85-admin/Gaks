export type AccountType = 'personal' | 'prop';

export interface TradingPreferences {
  id?: string;
  user_id: string;
  account_type: AccountType;
  custom_capital?: string;
  preferred_risk?: string;
  max_daily_risk?: string;
  risk_reward_ratio?: string;
  position_sizing_mode?: 'AUTO_RISK' | 'FIXED_LOT';
  preferred_lot_size?: number;
  strategy_summary?: string | null;
  // Personal Account News Protection
  news_restriction_enabled?: boolean;
  news_buffer_before_minutes?: number;
  news_buffer_after_minutes?: number;
  updated_at?: string;
  created_at?: string;
}

export interface PropFirmSettings {
  id?: string;
  user_id: string;
  firm_name: string;
  account_phase: string;
  account_size: number;
  risk_per_trade: number;
  risk_per_trade_type: 'PERCENTAGE' | 'MONETARY' | 'FIXED';
  daily_loss_limit_type: 'PERCENTAGE' | 'MONETARY' | 'FIXED';
  daily_loss_limit_value: number;
  max_drawdown_limit_type: 'PERCENTAGE' | 'MONETARY' | 'FIXED';
  max_drawdown_limit_value: number;
  news_restriction_enabled?: boolean;
  news_buffer_before_minutes?: number;
  news_buffer_after_minutes?: number;
  high_watermark?: number;
  daily_high_watermark?: number;
  updated_at?: string;
  created_at?: string;
}

export interface EconomicEvent {
  id: string;
  name: string;
  currency: string;
  impact: 'LOW' | 'MEDIUM' | 'HIGH';
  scheduled_at: string;
  actual?: string | null;
  forecast?: string | null;
  previous?: string | null;
}

export interface NewsGateEvaluation {
  status: 'CLEAR' | 'BLOCKED';
  event?: string | null;
  currency?: string | null;
  scheduledAt?: string | null;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  reason?: string | null;
}
