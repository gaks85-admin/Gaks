-- =========================================================================
-- LEARNING ENGINE SCHEMA (trade_learning)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.trade_learning (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    watcher_id UUID NOT NULL REFERENCES public.watchers(id) ON DELETE CASCADE,
    evaluation_id UUID REFERENCES public.watcher_evaluations(id) ON DELETE SET NULL,
    pair TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    strategy_mode TEXT NOT NULL,
    entry_price NUMERIC NOT NULL,
    stop_loss NUMERIC,
    take_profit NUMERIC,
    exit_price NUMERIC NOT NULL,
    outcome TEXT NOT NULL CONSTRAINT chk_trade_outcome CHECK (outcome IN ('WIN', 'LOSS', 'BREAKEVEN')),
    rr_expected NUMERIC,
    rr_achieved NUMERIC,
    pips NUMERIC,
    trade_duration_minutes INTEGER,
    decision_score NUMERIC,
    matched_weight NUMERIC,
    possible_weight NUMERIC,
    matched_rules JSONB DEFAULT '[]'::jsonb,
    failed_rules JSONB DEFAULT '[]'::jsonb,
    gemini_used BOOLEAN DEFAULT false,
    gemini_confidence NUMERIC,
    market_snapshot JSONB DEFAULT '{}'::jsonb,
    session TEXT,
    volatility TEXT,
    notes TEXT,
    decision_snapshot JSONB DEFAULT '{}'::jsonb
);

-- Ensure decision_snapshot column exists for backward compatibility / existing tables
ALTER TABLE public.trade_learning ADD COLUMN IF NOT EXISTS decision_snapshot JSONB DEFAULT '{}'::jsonb;

-- Enable Row Level Security (RLS) for trade_learning
ALTER TABLE public.trade_learning ENABLE ROW LEVEL SECURITY;

-- Create Policies for trade_learning
CREATE POLICY "Users can read own trade learning"
  ON public.trade_learning
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own trade learning"
  ON public.trade_learning
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own trade learning"
  ON public.trade_learning
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own trade learning"
  ON public.trade_learning
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Admin override policy
CREATE POLICY "Admin can select all trade learning"
  ON public.trade_learning
  FOR SELECT
  TO authenticated
  USING (auth.email() = 'gaks6535@gmail.com');

-- Service role has full access
CREATE POLICY "Service role full access"
  ON public.trade_learning
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Indexes for performance optimization on analytical queries
CREATE INDEX IF NOT EXISTS idx_trade_learning_user_id ON public.trade_learning(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_learning_watcher_id ON public.trade_learning(watcher_id);
CREATE INDEX IF NOT EXISTS idx_trade_learning_evaluation_id ON public.trade_learning(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_trade_learning_created_at ON public.trade_learning(created_at);
CREATE INDEX IF NOT EXISTS idx_trade_learning_outcome ON public.trade_learning(outcome);
CREATE INDEX IF NOT EXISTS idx_trade_learning_pair ON public.trade_learning(pair);
CREATE INDEX IF NOT EXISTS idx_trade_learning_timeframe ON public.trade_learning(timeframe);

COMMENT ON TABLE public.trade_learning IS 'Stores historical completed trade outcomes and associated execution parameters for statistical learning analytics.';
