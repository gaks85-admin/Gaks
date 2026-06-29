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

