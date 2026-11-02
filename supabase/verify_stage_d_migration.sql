-- ============================================================================
-- GAKS AI — STAGE D READ-ONLY PRODUCTION VERIFICATION SCRIPT
-- Execute this query in the Supabase SQL Editor AFTER running migration_backtest_stage_d.sql
-- ============================================================================

SELECT
  'backtest_datasets.version' AS object_checked,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'backtest_datasets' AND column_name = 'version'
  ) AS exists_in_db
UNION ALL
SELECT
  'backtest_datasets.parent_id',
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'backtest_datasets' AND column_name = 'parent_id'
  )
UNION ALL
SELECT
  'backtest_datasets.metadata',
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'backtest_datasets' AND column_name = 'metadata'
  )
UNION ALL
SELECT
  'backtest_datasets.validation_report',
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'backtest_datasets' AND column_name = 'validation_report'
  )
UNION ALL
SELECT
  'backtest_datasets.content_hash',
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'backtest_datasets' AND column_name = 'content_hash'
  )
UNION ALL
SELECT
  'backtest_runs.dataset_metadata',
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'backtest_runs' AND column_name = 'dataset_metadata'
  )
UNION ALL
SELECT
  'backtest_runs.validation_report',
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'backtest_runs' AND column_name = 'validation_report'
  )
UNION ALL
SELECT
  'backtest_stress_suites table',
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'backtest_stress_suites'
  )
UNION ALL
SELECT
  'backtest_stress_suites.created_by ON DELETE SET NULL FK',
  EXISTS (
    SELECT 1 FROM information_schema.referential_constraints rc
    JOIN information_schema.key_column_usage kcu ON rc.constraint_name = kcu.constraint_name
    WHERE kcu.table_name = 'backtest_stress_suites' AND kcu.column_name = 'created_by' AND rc.delete_rule = 'SET NULL'
  )
UNION ALL
SELECT
  'backtest_stress_suites.baseline_run_id ON DELETE SET NULL FK',
  EXISTS (
    SELECT 1 FROM information_schema.referential_constraints rc
    JOIN information_schema.key_column_usage kcu ON rc.constraint_name = kcu.constraint_name
    WHERE kcu.table_name = 'backtest_stress_suites' AND kcu.column_name = 'baseline_run_id' AND rc.delete_rule = 'SET NULL'
  );
