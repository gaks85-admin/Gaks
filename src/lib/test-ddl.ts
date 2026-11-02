import { getSupabase } from '../../lib/supabase-server.js';

async function testDDL() {
  const supabase = getSupabase();
  console.log('--- Testing Supabase DDL execution ---');

  try {
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `ALTER TABLE public.backtest_datasets ADD COLUMN IF NOT EXISTS version TEXT DEFAULT '1.0.0' NOT NULL;`
    });
    if (error) {
      console.log('rpc exec_sql error:', error.message);
    } else {
      console.log('rpc exec_sql SUCCESS! Output:', data);
    }
  } catch (err: any) {
    console.log('rpc exec_sql exception:', err.message);
  }
}

testDDL();
