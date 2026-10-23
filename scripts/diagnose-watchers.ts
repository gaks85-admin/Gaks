
import { createClient } from '@supabase/supabase-js';

async function diagnoseWatchers() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

  if (!url || !key) {
    console.error("Missing Supabase config");
    return;
  }

  const supabase = createClient(url, key);

  const { data: watchers, error } = await supabase
    .from('watchers')
    .select('id, selected_pair, selected_timeframe, status, user_id')
    .eq('status', 'active');

  if (error) {
    console.error("Error fetching watchers:", error);
    return;
  }

  console.log("--- ACTIVE WATCHERS REPORT ---");
  console.log(`Total Count: ${watchers.length}`);
  watchers.forEach((w, i) => {
    console.log(`${i+1}. Pair: ${w.selected_pair} | TF: ${w.selected_timeframe} | User: ${w.user_id}`);
  });
  console.log("------------------------------");

  const uniqueKeys = new Set(watchers.map(w => `${w.selected_pair}:${w.selected_timeframe}`));
  console.log(`Unique Symbol:Timeframe combinations: ${uniqueKeys.size}`);
  Array.from(uniqueKeys).forEach(k => console.log(` - ${k}`));
}

diagnoseWatchers();
