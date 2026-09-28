import 'dotenv/config';
import { FmpEconomicCalendarProvider } from '../src/lib/providers/fmp-economic-calendar-provider';
import { EconomicEventService } from '../src/lib/economic-event-service';
import { supabase } from '../src/supabaseClient';

async function verify() {
  console.log("=== GAKS AI PIPELINE VERIFICATION ===");
  
  // 1. Check Environment
  const fmpKey = process.env.FMP_API_KEY;
  console.log(`FMP_API_KEY configured: ${fmpKey ? 'YES' : 'NO'}`);
  
  if (!fmpKey) {
    console.warn("FMP_API_KEY is missing in process.env. Checking other sources...");
  }

  // 2. Check FMP Connection
  console.log("\n--- Testing FMP Connection ---");
  const provider = new FmpEconomicCalendarProvider();
  
  // Use a small range: today to tomorrow
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const nextWeek = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];
  
  try {
    const events = await provider.getUpcomingEvents(today, nextWeek);
    
    if (events.length > 0) {
      console.log(`FMP Request Status: SUCCESS`);
      console.log(`Number of events returned: ${events.length}`);
      
      console.log("\n--- First 3 normalized events ---");
      events.slice(0, 3).forEach(e => {
        console.log(`- ${e.eventName} (${e.currency}) | Impact: ${e.impact} | Scheduled: ${e.scheduledAt}`);
      });
      
      // 3. Check Normalization
      console.log("\n--- Normalization Sanity Check (First Event) ---");
      const e = events[0];
      console.log(JSON.stringify(e, null, 2));
      
      // 4. Check Supabase Sync
      console.log("\n--- Testing Supabase Sync ---");
      const econService = new EconomicEventService(provider);
      
      console.log(`Attempting syncEvents for range ${today} to ${nextWeek}...`);
      await econService.syncEvents(today, nextWeek);
      
      // Verify count in DB
      const { count, error } = await supabase
        .from('economic_events')
        .select('*', { count: 'exact', head: true })
        .gte('scheduled_at', today + 'T00:00:00Z');
        
      if (error) {
        console.error(`Supabase Query Error: ${error.message}`);
        if (error.code === '42P01') {
          console.error("Table 'economic_events' does not exist!");
        }
      } else {
        console.log(`Supabase verification: ${count} events currently in DB.`);
        
        const { data: highImpact } = await supabase
          .from('economic_events')
          .select('event_name, currency, scheduled_at')
          .eq('impact', 'HIGH')
          .gte('scheduled_at', today + 'T00:00:00Z');
          
        console.log(`High-impact events found in DB: ${highImpact?.length || 0}`);
        if (highImpact && highImpact.length > 0) {
          highImpact.slice(0, 5).forEach(hi => {
            console.log(`  - [HIGH] ${hi.event_name} (${hi.currency}) at ${hi.scheduled_at}`);
          });
        }
      }
    } else {
      console.log("No events found for the next 7 days in FMP. (Provider might have returned empty due to missing key or real lack of events)");
    }
  } catch (error: any) {
    console.error(`Pipeline verification failed: ${error.message}`);
    console.error(error);
  }
}

verify().catch(console.error);
