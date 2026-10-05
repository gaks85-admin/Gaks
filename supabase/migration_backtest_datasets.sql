-- ============================================================================
-- GAKS AI — BACKTESTING ENGINE: HISTORICAL DATASETS (PHASE 3)
-- Migration for backtest_datasets and backtest_candles
-- ============================================================================

-- 1. Create backtest_datasets table
CREATE TABLE IF NOT EXISTS public.backtest_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes on backtest_datasets
CREATE INDEX IF NOT EXISTS idx_backtest_datasets_status ON public.backtest_datasets(status);
CREATE INDEX IF NOT EXISTS idx_backtest_datasets_symbol_timeframe ON public.backtest_datasets(symbol, timeframe);

-- Enable RLS on backtest_datasets
ALTER TABLE public.backtest_datasets ENABLE ROW LEVEL SECURITY;

-- Select policy: Allow authenticated admins or creator
DROP POLICY IF EXISTS "Admins can view backtest_datasets" ON public.backtest_datasets;
CREATE POLICY "Admins can view backtest_datasets"
ON public.backtest_datasets
FOR SELECT
TO authenticated
USING (public.is_admin() OR created_by = auth.uid());

-- Service role full access
DROP POLICY IF EXISTS "Service role full access on backtest_datasets" ON public.backtest_datasets;
CREATE POLICY "Service role full access on backtest_datasets"
ON public.backtest_datasets
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 2. Create backtest_candles table
CREATE TABLE IF NOT EXISTS public.backtest_candles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES public.backtest_datasets(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  open NUMERIC NOT NULL,
  high NUMERIC NOT NULL,
  low NUMERIC NOT NULL,
  close NUMERIC NOT NULL,
  volume NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint: dataset_id + timestamp to prevent duplicate candles
CREATE UNIQUE INDEX IF NOT EXISTS idx_backtest_candles_dataset_timestamp
ON public.backtest_candles(dataset_id, timestamp);

-- Index for chronological retrieval in backtesting (dataset_id, timestamp ASC)
CREATE INDEX IF NOT EXISTS idx_backtest_candles_dataset_chronological
ON public.backtest_candles(dataset_id, timestamp ASC);

-- Enable RLS on backtest_candles
ALTER TABLE public.backtest_candles ENABLE ROW LEVEL SECURITY;

-- Select policy: Allow authenticated admins or creator
DROP POLICY IF EXISTS "Admins can view backtest_candles" ON public.backtest_candles;
CREATE POLICY "Admins can view backtest_candles"
ON public.backtest_candles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.backtest_datasets d
    WHERE d.id = backtest_candles.dataset_id
      AND (public.is_admin() OR d.created_by = auth.uid())
  )
);

-- Service role full access on backtest_candles
DROP POLICY IF EXISTS "Service role full access on backtest_candles" ON public.backtest_candles;
CREATE POLICY "Service role full access on backtest_candles"
ON public.backtest_candles
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
