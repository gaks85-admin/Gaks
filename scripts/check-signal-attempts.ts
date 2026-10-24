
import { createClient } from '@supabase/supabase-js';

async function checkSignalAttempts() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

  if (!url || !key) {
    console.error("Missing Supabase config");
    return;
  }

  const supabase = createClient(url, key);

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', 'gaks6535@gmail.com')
    .single();

  if (!profile) return;

  const { data: signalAttempts, error } = await supabase
    .from('watcher_evaluations')
    .select('*')
    .eq('user_id', profile.id)
    .in('recommendation', ['BUY', 'SELL'])
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  if (error) {
    console.error("Error:", error);
  } else {
    console.log(`Found ${signalAttempts.length} signal attempts (BUY/SELL recommendations).`);
    signalAttempts.forEach(a => {
      console.log(`Time: ${a.created_at} | Pair: ${a.pair} | Rec: ${a.recommendation} | Decision: ${a.decision_score}`);
    });
  }
}

checkSignalAttempts();
