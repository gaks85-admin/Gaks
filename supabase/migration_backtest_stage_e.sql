-- ============================================================================
-- GAKS AI — STAGE E PRODUCTION SUPABASE MIGRATION SCRIPT (SECURITY HARDENED)
-- Non-destructive, idempotent migration for Scientific Validation Engine (E1–E8)
-- ============================================================================

-- 1. CREATE SCIENTIFIC VALIDATION EXPERIMENTS TABLE
CREATE TABLE IF NOT EXISTS public.backtest_scientific_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  dataset_id UUID REFERENCES public.backtest_datasets(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  status TEXT DEFAULT 'completed' NOT NULL, -- PASS, FAIL, INCONCLUSIVE
  summary_reason TEXT,
  results JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Ensure ON DELETE SET NULL behavior on existing deployments
ALTER TABLE public.backtest_scientific_experiments
  ALTER COLUMN created_by DROP NOT NULL,
  ALTER COLUMN dataset_id DROP NOT NULL;

-- Optimization Indexes
CREATE INDEX IF NOT EXISTS idx_backtest_scientific_exp_dataset_id ON public.backtest_scientific_experiments(dataset_id);
CREATE INDEX IF NOT EXISTS idx_backtest_scientific_exp_created_at ON public.backtest_scientific_experiments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_scientific_exp_status ON public.backtest_scientific_experiments(status);

-- 2. HARDENED ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.backtest_scientific_experiments ENABLE ROW LEVEL SECURITY;

-- Clean up any draft policies
DROP POLICY IF EXISTS "Admin full access on backtest_scientific_experiments" ON public.backtest_scientific_experiments;
DROP POLICY IF EXISTS "Service role full access on backtest_scientific_experiments" ON public.backtest_scientific_experiments;

-- Restrict ordinary users. Grant full access strictly to verified Admin
CREATE POLICY "Admin full access on backtest_scientific_experiments"
  ON public.backtest_scientific_experiments
  FOR ALL
  TO authenticated
  USING (auth.email() = 'gaks6535@gmail.com')
  WITH CHECK (auth.email() = 'gaks6535@gmail.com');

-- Grant service role full access for server-side API execution
CREATE POLICY "Service role full access on backtest_scientific_experiments"
  ON public.backtest_scientific_experiments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. DOCUMENTATION COMMENTS
COMMENT ON TABLE public.backtest_scientific_experiments IS 'GAKS AI Scientific Validation Experiments (Stage E1-E8) with ON DELETE SET NULL historical preservation';
