-- Migration: Integrate the Strategy system with the AI Market Watcher engine with strict UUID mapping.

-- 1. Create a default trading preferences record for existing auth users who don't have one
INSERT INTO public.trading_preferences (user_id, strategy_text)
SELECT id, '• Entry conditions\n• Confirmation indicators\n• Exit & stop-loss logic\n• Risk management rules'
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- 2. Create the strategies table to store custom and default user strategies
CREATE TABLE IF NOT EXISTS public.strategies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Enable RLS for strategies
ALTER TABLE public.strategies ENABLE ROW LEVEL SECURITY;

-- Create Policies for strategies if they do not exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'strategies' AND policyname = 'select_all_strategies') THEN
    CREATE POLICY select_all_strategies ON public.strategies FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'strategies' AND policyname = 'insert_own_strategies') THEN
    CREATE POLICY insert_own_strategies ON public.strategies FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'strategies' AND policyname = 'update_own_strategies') THEN
    CREATE POLICY update_own_strategies ON public.strategies FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'strategies' AND policyname = 'delete_own_strategies') THEN
    CREATE POLICY delete_own_strategies ON public.strategies FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

-- 3. Insert global default strategy
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

-- 4. Modify the watchers table strategy_id column
-- First convert existing values ('default' -> '00000000-0000-0000-0000-000000000000', 'legacy-custom' -> '11111111-1111-1111-1111-111111111111', etc) and cast to UUID
ALTER TABLE public.watchers ALTER COLUMN strategy_id TYPE UUID USING (
  CASE 
    WHEN strategy_id = 'default' OR strategy_id IS NULL THEN '00000000-0000-0000-0000-000000000000'::UUID
    WHEN strategy_id = 'legacy-custom' THEN '11111111-1111-1111-1111-111111111111'::UUID
    ELSE '00000000-0000-0000-0000-000000000000'::UUID
  END
);

ALTER TABLE public.watchers ALTER COLUMN strategy_id SET DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.watchers ALTER COLUMN strategy_id SET NOT NULL;

-- 5. Add Foreign Key constraint to checkers
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.table_constraints tc 
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'watchers' AND kcu.column_name = 'strategy_id' AND tc.constraint_type = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE public.watchers ADD CONSTRAINT fk_watchers_strategy FOREIGN KEY (strategy_id) REFERENCES public.strategies(id);
  END IF;
END $$;
