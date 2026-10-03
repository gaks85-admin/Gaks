-- =========================================================================
-- STRATEGY SUMMARY MIGRATION
-- Adds strategy_summary column to trading_preferences table
-- =========================================================================

ALTER TABLE public.trading_preferences
  ADD COLUMN IF NOT EXISTS strategy_summary TEXT;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
