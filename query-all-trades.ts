import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase credentials.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  console.log("\n=== ALL EXECUTED EVALUATIONS ===");
  const { data: evals, error: evalErr } = await supabase
    .from('watcher_evaluations')
    .select('*')
    .eq('recommendation', 'EXECUTE')
    .order('created_at', { ascending: false });

  if (evalErr) {
    console.error("Error fetching executed evaluations:", evalErr);
    return;
  }

  console.log(`Total executed evaluations: ${evals?.length || 0}`);
  for (const ev of evals || []) {
    console.log(`ID: ${ev.id}, Created: ${ev.created_at}, User: ${ev.user_id}, Pair: ${ev.pair}, TF: ${ev.timeframe}, DecisionScore: ${ev.decision_score}, MandatoryPassed: ${ev.mandatory_rules_passed}, GeminiUsed: ${ev.gemini_used}, GeminiResult: ${ev.gemini_result ? String(ev.gemini_result).substring(0, 150) : null}`);
  }
}

main().catch(console.error);
