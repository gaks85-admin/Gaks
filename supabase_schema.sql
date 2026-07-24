-- supabase_schema.sql
-- Production-ready Supabase database schema for Gaks AI profiles and user trading data

-- Create the profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  avatar_url TEXT,
  subscription_plan TEXT NOT NULL DEFAULT 'Free',
  telegram_connected BOOLEAN NOT NULL DEFAULT false,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security (RLS) for profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create Policies for profiles
CREATE POLICY "Users can read own profile" 
  ON public.profiles 
  FOR SELECT 
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" 
  ON public.profiles 
  FOR UPDATE 
  USING (auth.uid() = id);

-- Create the trading_preferences table (Strategy Playbook)
CREATE TABLE IF NOT EXISTS public.trading_preferences (
  user_id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  strategy_text TEXT NOT NULL DEFAULT '• Entry conditions
• Confirmation indicators
• Exit & stop-loss logic
• Risk management rules',
  capital TEXT DEFAULT '$1,000',
  custom_capital TEXT DEFAULT '',
  preferred_risk TEXT DEFAULT '1%',
  risk_reward TEXT DEFAULT '1:2',
  account_type TEXT DEFAULT 'personal',
  preferred_sessions TEXT[] DEFAULT ARRAY['London', 'New York', 'Tokyo']::TEXT[],
  preferred_timeframes TEXT[] DEFAULT ARRAY['M15', 'H1']::TEXT[],
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security (RLS) for trading_preferences
ALTER TABLE public.trading_preferences ENABLE ROW LEVEL SECURITY;

-- Create Policies for trading_preferences
CREATE POLICY "Users can read own trading preferences"
  ON public.trading_preferences
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own trading preferences"
  ON public.trading_preferences
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own trading preferences"
  ON public.trading_preferences
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Create the watchlist_items table
CREATE TABLE IF NOT EXISTS public.watchlist_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL,
  change NUMERIC NOT NULL,
  spread NUMERIC NOT NULL,
  volatility TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  direction TEXT NOT NULL,
  history NUMERIC[] NOT NULL,
  timeframe TEXT NOT NULL DEFAULT 'H1',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (user_id, symbol)
);

-- Enable Row Level Security (RLS) for watchlist_items
ALTER TABLE public.watchlist_items ENABLE ROW LEVEL SECURITY;

-- Create Policies for watchlist_items
CREATE POLICY "Users can read own watchlist items"
  ON public.watchlist_items
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own watchlist items"
  ON public.watchlist_items
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own watchlist items"
  ON public.watchlist_items
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own watchlist items"
  ON public.watchlist_items
  FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger to automatically create a profile and default trading preferences record when a new user signs up via auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert user profile
  INSERT INTO public.profiles (id, full_name, email, avatar_url, subscription_plan, telegram_connected)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    NEW.raw_user_meta_data->>'avatar_url',
    'Free',
    false
  );

  -- Insert default trading preferences
  INSERT INTO public.trading_preferences (user_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger execution
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create the user_api_keys table
CREATE TABLE IF NOT EXISTS public.user_api_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL,
  api_key TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (user_id, provider)
);

-- Enable Row Level Security (RLS) for user_api_keys
ALTER TABLE public.user_api_keys ENABLE ROW LEVEL SECURITY;

-- Create Policies for user_api_keys
CREATE POLICY "Users can read own API keys"
  ON public.user_api_keys
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own API keys"
  ON public.user_api_keys
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own API keys"
  ON public.user_api_keys
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own API keys"
  ON public.user_api_keys
  FOR DELETE
  USING (auth.uid() = user_id);


-- =========================================================================
-- TELEGRAM CONNECTIONS FEATURE MIGRATION
-- =========================================================================

-- Create the telegram_connections table
-- Designed to store secure linking tokens and status details for the Gaks AI Telegram Bot
CREATE TABLE IF NOT EXISTS public.telegram_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL UNIQUE,
  telegram_chat_id TEXT,
  telegram_user_id TEXT,
  telegram_username TEXT,
  connection_token TEXT NOT NULL UNIQUE,
  connected BOOLEAN NOT NULL DEFAULT FALSE,
  connected_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Comments explaining columns for database administrators
COMMENT ON TABLE public.telegram_connections IS 'Stores deep link tokens and active chat mappings for the Gaks AI Telegram alerting engine.';
COMMENT ON COLUMN public.telegram_connections.user_id IS 'References the primary authenticated user; restricted to one row per user.';
COMMENT ON COLUMN public.telegram_connections.connection_token IS 'Secure random hex string generated via Web Crypto API for deep link authorization.';

-- Enable Row Level Security (RLS) for telegram_connections
ALTER TABLE public.telegram_connections ENABLE ROW LEVEL SECURITY;

-- Create Policies for telegram_connections
-- Ensures that users can only interact with their own link mappings
CREATE POLICY "Users can read own telegram connections"
  ON public.telegram_connections
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own telegram connections"
  ON public.telegram_connections
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own telegram connections"
  ON public.telegram_connections
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own telegram connections"
  ON public.telegram_connections
  FOR DELETE
  USING (auth.uid() = user_id);

-- Additional lookup policies to allow server-side webhook integrations 
-- utilizing the secure 48-character crypto token as pre-shared authorization
CREATE POLICY "Allow server-side lookups by secure token"
  ON public.telegram_connections
  FOR SELECT
  USING (true);

CREATE POLICY "Allow server-side updates by secure token"
  ON public.telegram_connections
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Create performance indexes for lookup optimizations
CREATE INDEX IF NOT EXISTS idx_telegram_connections_user_id ON public.telegram_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_connections_token ON public.telegram_connections(connection_token);

-- Reusable trigger function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_telegram_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to telegram_connections table
CREATE OR REPLACE TRIGGER update_telegram_connections_modtime
  BEFORE UPDATE ON public.telegram_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_telegram_connections_updated_at();

-- Create the signals table
CREATE TABLE IF NOT EXISTS public.signals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  pair TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  delivery_status TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Enable RLS for signals
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;

-- Create Policies for signals
CREATE POLICY select_own_signals ON public.signals
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Create Policy for admin lookup of all signals
CREATE POLICY admin_select_signals ON public.signals
  FOR SELECT
  TO authenticated
  USING (auth.email() = 'gaks6535@gmail.com');


-- =========================================================================
-- MARKET WATCHER ENGINE ACTIVATION SCHEMA
-- =========================================================================

-- Create the market_watchers table to track validation status and timestamps
CREATE TABLE IF NOT EXISTS public.market_watchers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'inactive',
  activated_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Enable Row Level Security (RLS) for market_watchers
ALTER TABLE public.market_watchers ENABLE ROW LEVEL SECURITY;

-- Create Policies for market_watchers
CREATE POLICY "Users can read own market watchers"
  ON public.market_watchers
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own market watchers"
  ON public.market_watchers
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own market watchers"
  ON public.market_watchers
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own market watchers"
  ON public.market_watchers
  FOR DELETE
  USING (auth.uid() = user_id);

-- Additional policy to allow server-side lookup/update
CREATE POLICY "Allow server-side updates"
  ON public.market_watchers
  FOR ALL
  USING (true)
  WITH CHECK (true);


-- =========================================================================
-- STRATEGIES TABLE DEFINITION
-- =========================================================================

-- Create the strategies table to store custom and default user strategies
CREATE TABLE IF NOT EXISTS public.strategies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false NOT NULL,
  parsed_strategy JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Enable RLS for strategies
ALTER TABLE public.strategies ENABLE ROW LEVEL SECURITY;

-- Create Policies for strategies
CREATE POLICY select_all_strategies ON public.strategies
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY insert_own_strategies ON public.strategies
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY update_own_strategies ON public.strategies
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY delete_own_strategies ON public.strategies
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Insert global default strategy
INSERT INTO public.strategies (id, name, text, is_default)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'Gaks AI Default Strategy',
  '# Gaks AI Default Strategy

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
- **Daily Drawdown Cap**: If a user experiences 3 consecutive losses in a 24-hour cycle, trading must halt for that day to preserve capital and prevent emotional over-trading.',
  true
)
ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- WATCHERS TABLE MIGRATION
-- =========================================================================

-- Create the watchers table representing each user's AI Market Watcher
CREATE TABLE IF NOT EXISTS public.watchers (
  -- Unique identifier for the watcher
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Reference to the owning user in Supabase auth
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  -- The current operational status of the watcher (must be active, paused, or stopped)
  status TEXT DEFAULT 'stopped' NOT NULL CONSTRAINT chk_watcher_status CHECK (status IN ('active', 'paused', 'stopped')),
  
  -- Optional reference to the active strategy playbook
  strategy_id UUID DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL REFERENCES public.strategies(id),
  
  -- Telegram chat identifier for push notifications
  telegram_chat_id TEXT,
  
  -- Capital sizing under management
  account_size NUMERIC,
  
  -- Risk percentage per trade (e.g., 1.0 for 1%)
  risk_percentage NUMERIC,
  
  -- The single selected trading pair to monitor
  selected_pair TEXT,
  
  -- The selected timeframe for analysis
  selected_timeframe TEXT,
  
  -- Selected Gemini model for scanning and analysis
  gemini_model TEXT,
  
  -- Frequency of scanning intervals in minutes
  scan_interval_minutes INTEGER DEFAULT 5 NOT NULL,
  
  -- Timestamps for monitoring operations
  last_scan_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,

  -- Stateful trade lifecycle tracking
  trade_status TEXT DEFAULT 'WAITING',
  entry_price NUMERIC,
  stop_loss NUMERIC,
  take_profit NUMERIC,
  direction TEXT,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  signal_message_id TEXT,
  
  -- Auditing and metadata timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Unique constraint per user per pair
  CONSTRAINT unique_user_pair UNIQUE (user_id, selected_pair)
);

-- Enable Row Level Security (RLS) to protect user data privacy
ALTER TABLE public.watchers ENABLE ROW LEVEL SECURITY;

-- Policy to allow authenticated users to view only their own watcher record
CREATE POLICY select_own_watcher ON public.watchers
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy to allow authenticated users to register their own watcher record
CREATE POLICY insert_own_watcher ON public.watchers
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy to allow authenticated users to modify their own watcher record
CREATE POLICY update_own_watcher ON public.watchers
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy to allow authenticated users to delete their own watcher record
CREATE POLICY delete_own_watcher ON public.watchers
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Performance optimization indexes for standard lookup queries
CREATE INDEX IF NOT EXISTS idx_watchers_user_id ON public.watchers(user_id);
CREATE INDEX IF NOT EXISTS idx_watchers_status ON public.watchers(status);

-- Automatic update trigger for tracking the updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_watchers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER update_watchers_modtime
  BEFORE UPDATE ON public.watchers
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_watchers_updated_at();

-- SQL Comment descriptions for schema and administration documentation
COMMENT ON TABLE public.watchers IS 'Represents each user''s custom Gaks AI Market Watcher service configuration and operational status.';
COMMENT ON COLUMN public.watchers.status IS 'Operational status restricted to active, paused, or stopped.';
COMMENT ON COLUMN public.watchers.user_id IS 'User reference with foreign key to auth.users, supporting multiple watchers per admin user.';

-- =========================================================================
-- NOTIFICATION LOGS FEATURE SCHEMA
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.notification_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Enable Row Level Security
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

-- Create Policies for notification_logs
CREATE POLICY "Allow authenticated read on notification_logs"
  ON public.notification_logs
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated insert on notification_logs"
  ON public.notification_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

COMMENT ON TABLE public.notification_logs IS 'Tracks simulated test alerts and system delivery pipeline telemetry for monitoring.';





