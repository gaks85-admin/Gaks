-- ============================================================================
-- GAKS AI — BACKTESTING ENGINE: PERSISTENCE & HISTORY (PHASE 7)
-- Migration for backtest_runs and backtest_trades tables, indexes, and RLS policies.
-- ============================================================================

-- 1. Create backtest_runs table
CREATE TABLE IF NOT EXISTS public.backtest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  dataset_id UUID NOT NULL REFERENCES public.backtest_datasets(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  strategy_snapshot JSONB NOT NULL,
  simulation_config JSONB NOT NULL,
  starting_balance NUMERIC NOT NULL,
  ending_balance NUMERIC NOT NULL,
  net_profit NUMERIC NOT NULL,
  return_percent NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('processing', 'completed', 'failed')),
  analytics_snapshot JSONB NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes on backtest_runs
CREATE INDEX IF NOT EXISTS idx_backtest_runs_created_by ON public.backtest_runs(created_by);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_dataset_id ON public.backtest_runs(dataset_id);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_created_at ON public.backtest_runs(created_at DESC);

-- Enable RLS on backtest_runs
ALTER TABLE public.backtest_runs ENABLE ROW LEVEL SECURITY;

-- Select / Insert / Delete policy: Allow authenticated admins or creator
DROP POLICY IF EXISTS "Admins and creators can manage backtest_runs" ON public.backtest_runs;
CREATE POLICY "Admins and creators can manage backtest_runs"
ON public.backtest_runs
FOR ALL
TO authenticated
USING (public.is_admin() OR created_by = auth.uid())
WITH CHECK (public.is_admin() OR created_by = auth.uid());

-- Service role full access on backtest_runs
DROP POLICY IF EXISTS "Service role full access on backtest_runs" ON public.backtest_runs;
CREATE POLICY "Service role full access on backtest_runs"
ON public.backtest_runs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);


-- 2. Create backtest_trades table
CREATE TABLE IF NOT EXISTS public.backtest_trades (
  id TEXT PRIMARY KEY,
  backtest_run_id UUID NOT NULL REFERENCES public.backtest_runs(id) ON DELETE CASCADE,
  signal_id TEXT,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  direction TEXT NOT NULL,
  entry_timestamp TIMESTAMPTZ NOT NULL,
  exit_timestamp TIMESTAMPTZ NOT NULL,
  entry_price NUMERIC NOT NULL,
  exit_price NUMERIC NOT NULL,
  stop_loss NUMERIC NOT NULL,
  take_profit NUMERIC NOT NULL,
  lot_size NUMERIC NOT NULL,
  risk_amount NUMERIC NOT NULL,
  risk_reward_ratio NUMERIC NOT NULL,
  gross_pnl NUMERIC NOT NULL,
  spread_cost NUMERIC NOT NULL,
  slippage_cost NUMERIC NOT NULL,
  commission_cost NUMERIC NOT NULL,
  net_pnl NUMERIC NOT NULL,
  balance_before NUMERIC NOT NULL,
  balance_after NUMERIC NOT NULL,
  exit_reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes on backtest_trades
CREATE INDEX IF NOT EXISTS idx_backtest_trades_run_id ON public.backtest_trades(backtest_run_id);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_chronological ON public.backtest_trades(backtest_run_id, entry_timestamp ASC);

-- Enable RLS on backtest_trades
ALTER TABLE public.backtest_trades ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated admins or creators through backtest_runs join
DROP POLICY IF EXISTS "Admins and creators can manage backtest_trades" ON public.backtest_trades;
CREATE POLICY "Admins and creators can manage backtest_trades"
ON public.backtest_trades
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.backtest_runs r
    WHERE r.id = backtest_trades.backtest_run_id
      AND (public.is_admin() OR r.created_by = auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.backtest_runs r
    WHERE r.id = backtest_trades.backtest_run_id
      AND (public.is_admin() OR r.created_by = auth.uid())
  )
);

-- Service role full access on backtest_trades
DROP POLICY IF EXISTS "Service role full access on backtest_trades" ON public.backtest_trades;
CREATE POLICY "Service role full access on backtest_trades"
ON public.backtest_trades
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
