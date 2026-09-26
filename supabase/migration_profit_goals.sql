-- =========================================================================
-- PROFIT GOALS SCHEMA
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.profit_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    target_amount NUMERIC NOT NULL,
    start_amount NUMERIC NOT NULL,
    current_amount NUMERIC NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CONSTRAINT chk_profit_goal_status CHECK (status IN ('ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED')),
    timeframe TEXT NOT NULL, -- 'weekly', 'monthly'
    deadline TIMESTAMPTZ,
    settings_applied JSONB DEFAULT '{}'::jsonb,
    notified BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.profit_goals ENABLE ROW LEVEL SECURITY;

-- Create Policies
CREATE POLICY "Users can manage own profit goals"
  ON public.profit_goals
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admin override policy
CREATE POLICY "Admin can select all profit goals"
  ON public.profit_goals
  FOR SELECT
  TO authenticated
  USING (auth.email() = 'gaks6535@gmail.com');

-- Service role has full access
CREATE POLICY "Service role full access profit goals"
  ON public.profit_goals
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_profit_goals_user_id ON public.profit_goals(user_id);
CREATE INDEX IF NOT EXISTS idx_profit_goals_status ON public.profit_goals(status);

COMMENT ON TABLE public.profit_goals IS 'Tracks user profit targets and progress over time.';
