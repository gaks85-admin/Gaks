
import { createClient } from '@supabase/supabase-js';

const toCanonicalSymbol = (symbol: string): string => {
  if (!symbol) return '';
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
};

async function fixWatchers() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

  if (!url || !key) {
    console.error("Missing Supabase config");
    return;
  }

  const supabase = createClient(url, key);

  console.log("Fetching active watchers...");
  const { data: watchers, error } = await supabase
    .from('watchers')
    .select('*')
    .eq('status', 'active');

  if (error) {
    console.error("Error fetching watchers:", error);
    return;
  }

  console.log(`Found ${watchers.length} active watchers.`);

  const userWatchers = new Map<string, any[]>();
  for (const w of watchers) {
    if (!userWatchers.has(w.user_id)) {
      userWatchers.set(w.user_id, []);
    }
    userWatchers.get(w.user_id)!.push(w);
  }

  for (const [userId, items] of userWatchers.entries()) {
    console.log(`Checking user: ${userId}`);
    const seen = new Set<string>();
    
    for (const w of items) {
      const canonical = toCanonicalSymbol(w.selected_pair || w.pair || "");
      const tf = (w.selected_timeframe || w.timeframe || "").toUpperCase().trim();
      const key = `${canonical}:${tf}`;

      if (seen.has(key)) {
        console.log(` - DUPLICATE DETECTED: ${w.selected_pair} (${tf}). Deactivating...`);
        await supabase
          .from('watchers')
          .update({ status: 'stopped', updated_at: new Date().toISOString() })
          .eq('id', w.id);
      } else {
        seen.add(key);
        // Normalize the existing record if it's not already canonical
        // Actually, we should probably keep a human-friendly version like USD/CAD if that's what's there,
        // but the cron uses canonical for deduplication.
        // However, if the user sees "USD/CAD" and "Usdcad ", it's confusing.
        // Let's normalize it to a clean format: uppercase, trimmed, and maybe with a slash if it's 6 chars?
        // No, let's just make it canonical for consistency.
        const normalized = canonical; 
        if (w.selected_pair !== normalized) {
             console.log(` - Normalizing ${w.selected_pair} -> ${normalized}`);
             await supabase
                .from('watchers')
                .update({ selected_pair: normalized, updated_at: new Date().toISOString() })
                .eq('id', w.id);
        }
      }
    }
  }

  console.log("Cleanup complete.");
}

fixWatchers();
