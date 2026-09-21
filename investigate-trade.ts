
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function investigate() {
  const { data: evaluations, error } = await supabase
    .from('watcher_evaluations')
    .select('*')
    .eq('pair', 'GBPUSD')
    .eq('trade_sent', true)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('Error fetching evaluations:', error);
    return;
  }

  if (!evaluations || evaluations.length === 0) {
    console.log('No evaluations found for GBPUSD.');
    return;
  }

  const eval_record = evaluations[0];
  console.log('--- TRADE INVESTIGATION REPORT ---');
  console.log(`Pair: ${eval_record.pair}`);
  console.log(`Recommendation: ${eval_record.recommendation}`);
  console.log(`Decision Score: ${eval_record.decision_score}`);
  console.log(`Gemini Used: ${eval_record.gemini_used}`);
  console.log(`Matched Rules: ${eval_record.matched_rules?.join(', ')}`);
  console.log(`Failed Rules: ${eval_record.failed_rules?.join(', ')}`);
  console.log(`Trade Sent: ${eval_record.trade_sent}`);
  console.log(`Trade Reason: ${eval_record.trade_reason}`);
  console.log('\n--- DECISION SNAPSHOT ---');
  console.log(JSON.stringify(eval_record.decision_snapshot, null, 2));
}

investigate();
