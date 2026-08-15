import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase credentials.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  console.log("=== DISTINCT RECOMMENDATIONS ===");
  // We can query 100 rows to see what is in recommendation and trade_reason
  const { data: rows, error } = await supabase
    .from('watcher_evaluations')
    .select('recommendation, trade_sent, trade_reason, gemini_used')
    .limit(100);

  if (error) {
    console.error("Error fetching rows:", error);
    return;
  }

  const recSet = new Set<string>();
  const tradeSentSet = new Set<boolean>();
  let yesTradeSent = 0;

  for (const r of rows || []) {
    recSet.add(r.recommendation);
    tradeSentSet.add(r.trade_sent);
    if (r.trade_sent) yesTradeSent++;
  }

  console.log("Distinct recommendations in first 100:", Array.from(recSet));
  console.log("Distinct trade_sent in first 100:", Array.from(tradeSentSet));
  console.log("Count of trade_sent=true in first 100:", yesTradeSent);

  // Let's count globally
  const { data: allRows, error: allErr } = await supabase
    .from('watcher_evaluations')
    .select('recommendation, trade_sent')
    .eq('trade_sent', true);

  if (allErr) {
    console.error("Error fetching all trade_sent rows:", allErr);
  } else {
    console.log(`Total trade_sent = true across entire database: ${allRows?.length || 0}`);
    const globalRecSet = new Set<string>();
    for (const r of allRows || []) {
      globalRecSet.add(r.recommendation);
    }
    console.log("Recommendations for trade_sent = true:", Array.from(globalRecSet));
  }
}

main().catch(console.error);
