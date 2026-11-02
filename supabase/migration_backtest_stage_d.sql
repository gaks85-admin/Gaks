-- ============================================================================
-- GAKS AI — STAGE D PRODUCTION SUPABASE MIGRATION SCRIPT (SECURITY HARDENED)
-- Non-destructive, idempotent migration for Stage D Historical Data Infrastructure
-- ============================================================================

-- 1. ADD MISSING STAGE D COLUMNS TO `backtest_datasets`
ALTER TABLE public.backtest_datasets
  ADD COLUMN IF NOT EXISTS version TEXT DEFAULT '1.0.0' NOT NULL,
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.backtest_datasets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS validation_report JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Optimization Indexes
CREATE INDEX IF NOT EXISTS idx_backtest_datasets_parent_id ON public.backtest_datasets(parent_id);
CREATE INDEX IF NOT EXISTS idx_backtest_datasets_symbol_timeframe ON public.backtest_datasets(symbol, timeframe);

-- 2. ADD MISSING STAGE D COLUMNS TO `backtest_runs`
ALTER TABLE public.backtest_runs
  ADD COLUMN IF NOT EXISTS dataset_metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS validation_report JSONB DEFAULT '{}'::jsonb;

-- Lookup Index for deletion integrity and query speed
CREATE INDEX IF NOT EXISTS idx_backtest_runs_dataset_id ON public.backtest_runs(dataset_id);

-- 3. CREATE STRESS TEST SUITES TABLE `backtest_stress_suites`
-- Foreign Keys set to ON DELETE SET NULL to preserve historical stress audit records
CREATE TABLE IF NOT EXISTS public.backtest_stress_suites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  baseline_run_id UUID REFERENCES public.backtest_runs(id) ON DELETE SET NULL,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Ensure nullable columns and ON DELETE SET NULL behavior on existing deployments
ALTER TABLE public.backtest_stress_suites
  ALTER COLUMN created_by DROP NOT NULL,
  ALTER COLUMN baseline_run_id DROP NOT NULL;

-- Optimization Indexes
CREATE INDEX IF NOT EXISTS idx_backtest_stress_suites_baseline_run_id ON public.backtest_stress_suites(baseline_run_id);
CREATE INDEX IF NOT EXISTS idx_backtest_stress_suites_created_at ON public.backtest_stress_suites(created_at DESC);

-- 4. HARDENED ROW LEVEL SECURITY (RLS) FOR `backtest_stress_suites`
ALTER TABLE public.backtest_stress_suites ENABLE ROW LEVEL SECURITY;

-- Clean up any overly permissive policies from earlier drafts
DROP POLICY IF EXISTS "Allow authenticated read access" ON public.backtest_stress_suites;
DROP POLICY IF EXISTS "Allow authenticated insert access" ON public.backtest_stress_suites;
DROP POLICY IF EXISTS "Allow service role full access" ON public.backtest_stress_suites;
DROP POLICY IF EXISTS "Admin full access on backtest_stress_suites" ON public.backtest_stress_suites;
DROP POLICY IF EXISTS "Service role full access on backtest_stress_suites" ON public.backtest_stress_suites;

-- Restrict ordinary `anon` and `authenticated` users. Grant full access strictly to verified Admin
CREATE POLICY "Admin full access on backtest_stress_suites"
  ON public.backtest_stress_suites
  FOR ALL
  TO authenticated
  USING (auth.email() = 'gaks6535@gmail.com')
  WITH CHECK (auth.email() = 'gaks6535@gmail.com');

-- Grant service role full access for server-side API execution
CREATE POLICY "Service role full access on backtest_stress_suites"
  ON public.backtest_stress_suites
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 5. DOCUMENTATION COMMENTS
COMMENT ON TABLE public.backtest_datasets IS 'GAKS AI Historical Datasets with Stage D versioning, content hash, and validation reports';
COMMENT ON TABLE public.backtest_stress_suites IS 'GAKS AI Execution Stress Test Suite Results (C7 / Stage D) with ON DELETE SET NULL historical preservation';
