import { getSupabase } from '../../lib/supabase-server.js';

async function checkDatabaseSchema() {
  const supabase = getSupabase();
  console.log('--- Checking Supabase Database Connection & Schema ---');

  // 1. Test backtest_datasets
  try {
    const { data: datasets, error: dsErr } = await supabase.from('backtest_datasets').select('*').limit(1);
    if (dsErr) {
      console.log('backtest_datasets query error:', dsErr.code, dsErr.message);
    } else {
      console.log('backtest_datasets query SUCCESS! Rows found:', datasets?.length);
      if (datasets && datasets.length > 0) {
        console.log('Columns in backtest_datasets:', Object.keys(datasets[0]));
      } else {
        console.log('backtest_datasets is empty.');
      }
    }
  } catch (err: any) {
    console.log('Error querying backtest_datasets:', err.message);
  }

  // Check specific columns by trying to select them
  try {
    const { data, error } = await supabase.from('backtest_datasets').select('version, parent_id, metadata, validation_report, content_hash').limit(1);
    if (error) {
      console.log('backtest_datasets Stage D columns check ERROR:', error.code, error.message);
    } else {
      console.log('backtest_datasets Stage D columns (version, parent_id, metadata, validation_report, content_hash) EXIST!');
    }
  } catch (err: any) {
    console.log('Error selecting Stage D dataset columns:', err.message);
  }

  // 2. Test backtest_candles
  try {
    const { data: candles, error: cErr } = await supabase.from('backtest_candles').select('*').limit(1);
    if (cErr) {
      console.log('backtest_candles query error:', cErr.code, cErr.message);
    } else {
      console.log('backtest_candles query SUCCESS! Rows found:', candles?.length);
    }
  } catch (err: any) {
    console.log('Error querying backtest_candles:', err.message);
  }

  // 3. Test backtest_runs
  try {
    const { data: runs, error: rErr } = await supabase.from('backtest_runs').select('*').limit(1);
    if (rErr) {
      console.log('backtest_runs query error:', rErr.code, rErr.message);
    } else {
      console.log('backtest_runs query SUCCESS! Rows found:', runs?.length);
      if (runs && runs.length > 0) {
        console.log('Columns in backtest_runs:', Object.keys(runs[0]));
      }
    }
  } catch (err: any) {
    console.log('Error querying backtest_runs:', err.message);
  }

  try {
    const { data, error } = await supabase.from('backtest_runs').select('dataset_metadata, validation_report').limit(1);
    if (error) {
      console.log('backtest_runs Stage D columns check ERROR:', error.code, error.message);
    } else {
      console.log('backtest_runs Stage D columns (dataset_metadata, validation_report) EXIST!');
    }
  } catch (err: any) {
    console.log('Error selecting Stage D run columns:', err.message);
  }

  // 4. Test backtest_stress_suites
  try {
    const { data: suites, error: sErr } = await supabase.from('backtest_stress_suites').select('*').limit(1);
    if (sErr) {
      console.log('backtest_stress_suites query error:', sErr.code, sErr.message);
    } else {
      console.log('backtest_stress_suites query SUCCESS! Table EXISTS!');
    }
  } catch (err: any) {
    console.log('Error querying backtest_stress_suites:', err.message);
  }
}

checkDatabaseSchema();
