
import { createClient } from '@supabase/supabase-js';

async function auditUserSignals() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

  if (!url || !key) {
    console.error("Missing Supabase config");
    return;
  }

  const supabase = createClient(url, key);

  // 1. Get user ID
  const { data: profile, error: pError } = await supabase
    .from('profiles')
    .select('id, email')
    .eq('email', 'gaks6535@gmail.com')
    .single();

  if (pError || !profile) {
    console.error("User not found:", pError);
    return;
  }

  const userId = profile.id;
  console.log(`Auditing User: ${profile.email} (${userId})`);

  // 2. Get active watchers
  const { data: watchers, error: wError } = await supabase
    .from('watchers')
    .select('*')
    .eq('user_id', userId);

  if (wError) {
    console.error("Error fetching watchers:", wError);
    return;
  }

  console.log("\n--- WATCHER STATES ---");
  for (const w of watchers) {
    console.log(`Pair: ${w.selected_pair} | Status: ${w.status} | Trade Status: ${w.trade_status}`);
    console.log(`Current Zone Status: ${w.zone_status}`);
    if (w.zone_high && w.zone_low) {
      console.log(`Zone Range: ${w.zone_low} - ${w.zone_high} (${w.zone_type})`);
    }
    console.log('---');
  }

  // 3. Get recent evaluations (last 7 days)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: evals, error: eError } = await supabase
    .from('watcher_evaluations')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', weekAgo)
    .order('created_at', { ascending: false });

  if (eError) {
    console.error("Error fetching evaluations:", eError);
  } else {
    console.log(`\n--- RECENT EVALUATIONS (${evals.length}) ---`);
    evals.slice(0, 30).forEach((e, i) => {
      console.log(`${i+1}. Time: ${e.created_at} | Pair: ${e.pair} | Rec: ${e.recommendation} | Score: ${e.decision_score}`);
      if (e.recommendation !== 'BUY' && e.recommendation !== 'SELL') {
          console.log(`   AI Reasoning: ${e.ai_reasoning || 'No AI reasoning'}`);
          if (e.failed_rules && e.failed_rules.length > 0) {
              console.log(`   Failed Rules: ${e.failed_rules.join(', ')}`);
          }
          if (e.matched_rules && e.matched_rules.length > 0) {
              console.log(`   Matched Rules: ${e.matched_rules.join(', ')}`);
          }
      } else {
          console.log(`   SIGNAL SENT! Direction: ${e.recommendation}`);
      }
      console.log('---');
    });
  }

  // 4. Check for completed trades (signals actually sent)
  const { data: trades, error: tError } = await supabase
    .from('trade_learning')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', weekAgo);

  if (tError) {
      console.error("Error fetching trades:", tError);
  } else {
      console.log(`\n--- COMPLETED TRADES (${trades.length}) ---`);
      trades.forEach(t => {
          console.log(`Pair: ${t.pair} | Direction: ${t.direction} | Outcome: ${t.outcome} | Closed At: ${t.closed_at} | Pips: ${t.pips}`);
      });
  }
}

auditUserSignals();
