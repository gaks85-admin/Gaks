
import { createClient } from '@supabase/supabase-js';
import { defaultMarketDataService } from '../src/lib/market-data-service.js';
import { extractMarketStructure } from '../src/lib/market-structure-engine.js';
import { identifyCandidateZones, evaluateZoneState, isPriceInOrTappingZone } from '../src/lib/zone-engine.js';
import { compileStrategy } from '../src/lib/strategy-compiler.js';
import { evaluateDecision } from '../src/lib/decision-engine.js';
import { evaluateQualityGate } from '../src/lib/quality-gate.js';

async function qualityShake() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  const email = 'gaks6535@gmail.com';

  if (!url || !key) {
    console.error("Missing Supabase config");
    return;
  }

  const supabase = createClient(url, key);

  // 1. Get user ID
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single();

  if (!profile) {
    console.error("User not found");
    return;
  }

  const userId = profile.id;

  // 2. Get active watchers
  const { data: watchers } = await supabase
    .from('watchers')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (!watchers || watchers.length === 0) {
    console.log("No active watchers found for this user.");
    return;
  }

  console.log(`--- QUALITY SHAKE FOR ${email} ---`);
  console.log(`Active Watchers: ${watchers.length}\n`);

  for (const w of watchers) {
    console.log(`Analyzing ${w.selected_pair} (${w.selected_timeframe})...`);
    
    // Fetch market data
    const req = {
      symbol: w.selected_pair,
      timeframe: w.selected_timeframe,
      requiredCount: 120
    };
    
    const marketData = await defaultMarketDataService.getMarketData(req);
    if (!marketData.isValid) {
      console.log(`  [FAIL] Failed to fetch market data: ${marketData.reason}`);
      continue;
    }

    const candles = marketData.candles;
    const currentPrice = marketData.currentPrice || candles[candles.length - 1].close;

    // Extract structure
    const ms = extractMarketStructure(candles, w.selected_pair);
    console.log(`  Trend: ${ms.trend} | HTF Trend: ${ms.htfTrend || 'N/A'}`);
    
    // Compile strategy
    const compiledStrategy = compileStrategy(w.strategy_text || '');
    
    // Check zones
    const candidates = identifyCandidateZones(candles, ms, compiledStrategy, currentPrice);
    console.log(`  Candidate Zones Found: ${candidates.length}`);
    
    if (candidates.length > 0) {
        candidates.slice(0, 2).forEach((c, idx) => {
            console.log(`    ${idx+1}. ${c.type} (${c.direction}) | Range: ${c.low} - ${c.high} | Strength: ${c.strength}`);
        });
    }

    // Evaluate existing zone if any
    if (w.zone_status && w.zone_status !== 'NO_ZONE') {
        const existingZone = {
            id: w.active_zone_id,
            type: w.zone_type,
            direction: w.zone_direction,
            high: w.zone_high,
            low: w.zone_low,
            invalidationLevel: w.zone_invalidation,
            status: w.zone_status,
            createdAt: w.zone_created_at
        };
        
        const evalResult = evaluateZoneState(existingZone as any, candles[candles.length - 1], currentPrice, 0.0005, candles, ms);
        console.log(`  Active Zone Evaluation: ${evalResult.status}`);
        console.log(`  Reason: ${evalResult.reason}`);
        
        if (evalResult.status === 'ZONE_TAPPED' || evalResult.status === 'CONFIRMED') {
            // Check decision
            const decision = evaluateDecision(candles, compiledStrategy, ms, w.zone_direction);
            console.log(`  Decision recommendation: ${decision.recommendation}`);
            
            // Check quality gate
            const quality = evaluateQualityGate({
                ruleScore: decision.decision_score,
                marketStructure: ms,
                mandatoryRulesPassed: decision.mandatory_rules_passed,
                direction: w.zone_direction,
                slValid: true,
                tpValid: true,
                rrValid: true
            });
            console.log(`  Quality Gate: ${quality.passed ? 'PASSED' : 'FAILED'} (${quality.qualityScore}%)`);
            console.log(`  Quality Reason: ${quality.reason}`);
        }
    } else {
        console.log(`  No active zone being tracked.`);
    }
    console.log('---');
  }
}

qualityShake();
