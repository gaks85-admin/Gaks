import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase credentials in environment.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  console.log("=========================================");
  console.log("🔍 GAKS AI SIGNAL AUDIT & DIAGNOSTIC RUN 🔍");
  console.log("=========================================");

  // Step 1: Find user id for gaks6535@gmail.com
  const { data: users, error: userErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', 'gaks6535@gmail.com');

  if (userErr || !users || users.length === 0) {
    console.error("Could not find user with email gaks6535@gmail.com:", userErr?.message || "No rows returned");
    process.exit(1);
  }

  const user = users[0];
  const userId = user.id;
  console.log(`User Profile Found: ID=${userId}, Email=${user.email}`);

  // Step 2: Query watchers for this user
  const { data: watchers, error: watcherErr } = await supabase
    .from('watchers')
    .select('*')
    .eq('user_id', userId);

  if (watcherErr) {
    console.error("Error querying watchers:", watcherErr.message);
  } else {
    console.log(`Found ${watchers?.length || 0} watchers:`);
    for (const w of watchers || []) {
      console.log(`- Watcher ID: ${w.id}, Pair: ${w.selected_pair}, Timeframe: ${w.selected_timeframe}, Status: ${w.status}, Cooldown Until: ${w.cooldown_until || 'None'}`);
    }
  }

  // Step 3: Query recent evaluations for this user
  console.log("\n--- EVALUATIONS ANALYSIS ---");
  const { data: evals, error: evalErr } = await supabase
    .from('watcher_evaluations')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (evalErr) {
    console.error("Error querying evaluations:", evalErr.message);
  } else {
    console.log(`Total evaluations recorded: ${evals?.length || 0}`);
    
    let totalEvals = evals?.length || 0;
    let geminiUsed = 0;
    let geminiSucceeded = 0;
    let geminiFailed = 0;
    let decisionExecute = 0;
    let decisionWait = 0;
    let decisionNoTrade = 0;

    let failedMandatoryOverridden = 0;

    for (const ev of evals || []) {
      if (ev.gemini_used) geminiUsed++;
      
      const gemResStr = String(ev.gemini_result || '');
      if (gemResStr.includes("failed") || gemResStr.includes("Error") || ev.trade_reason?.includes("failed")) {
        geminiFailed++;
      } else if (ev.gemini_used) {
        geminiSucceeded++;
      }

      if (ev.final_decision === 'EXECUTE') {
        decisionExecute++;
      } else if (ev.final_decision === 'WAIT') {
        decisionWait++;
      } else {
        decisionNoTrade++;
      }

      // Check for Gemini overriding failed mandatory rules
      // e.g. rule_score or failed rules vs decision
      const score = Number(ev.rule_score || 0);
      const isFailRecommendation = ev.rule_recommendation === 'FAIL';
      const hasFailedRules = ev.failed_rules && ev.failed_rules.length > 0;
      if ((isFailRecommendation || hasFailedRules || score < 50) && ev.final_decision === 'EXECUTE') {
        failedMandatoryOverridden++;
        console.log(`⚠️ Overridden Case Found! Evaluation ID: ${ev.id}`);
        console.log(`   - CreatedAt: ${ev.created_at}`);
        console.log(`   - Pair: ${ev.pair}, Timeframe: ${ev.timeframe}`);
        console.log(`   - Rule Score: ${score}, Rec: ${ev.rule_recommendation}`);
        console.log(`   - Failed Rules: ${JSON.stringify(ev.failed_rules)}`);
        console.log(`   - Gemini Used: ${ev.gemini_used}`);
        console.log(`   - Final Decision: ${ev.final_decision}`);
        console.log(`   - Gemini Result/Reason: ${ev.gemini_result} | Reason: ${ev.trade_reason}`);
      }
    }

    console.log(`\nMetrics Summary:`);
    console.log(`- Gemini Used count: ${geminiUsed}`);
    console.log(`- Gemini Succeeded count: ${geminiSucceeded}`);
    console.log(`- Gemini Failed count: ${geminiFailed}`);
    console.log(`- Final Decision: EXECUTE=${decisionExecute}, WAIT=${decisionWait}, NO_TRADE=${decisionNoTrade}`);
    console.log(`- Deterministic Mandatory-Rule Failures Overridden by Gemini: ${failedMandatoryOverridden}`);
  }

  // Step 4: Query trade_learning records (signals / actual trades)
  console.log("\n--- TRADE PERFORMANCE ANALYSIS ---");
  const { data: trades, error: tradeErr } = await supabase
    .from('trade_learning')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (tradeErr) {
    console.error("Error querying trade_learning:", tradeErr.message);
  } else {
    console.log(`Total trades recorded: ${trades?.length || 0}`);
    
    let totalTrades = trades?.length || 0;
    let wins = 0;
    let losses = 0;
    let breakevens = 0;
    let other = 0;
    let totalR = 0;
    let consecutiveLosses = 0;
    let maxConsecutiveLosses = 0;
    let activeStreak = 0;

    const tradesByPair: Record<string, { total: number, win: number, loss: number, be: number }> = {};
    const tradesByTf: Record<string, { total: number, win: number, loss: number, be: number }> = {};
    const tradesBySetup: Record<string, { total: number, win: number, loss: number, be: number }> = {};
    const tradesByDirection: Record<string, { total: number, win: number, loss: number, be: number }> = {};

    let prevTradeTime = 0;
    let totalTimeBetween = 0;
    let minTimeBetween = Infinity;
    let timeIntervalCount = 0;

    for (const t of trades || []) {
      const outcome = String(t.outcome || '').toUpperCase();
      if (outcome.includes('WIN')) {
        wins++;
        consecutiveLosses = 0;
      } else if (outcome.includes('LOSS')) {
        losses++;
        consecutiveLosses++;
        if (consecutiveLosses > maxConsecutiveLosses) {
          maxConsecutiveLosses = consecutiveLosses;
        }
      } else if (outcome.includes('BREAKEVEN') || outcome.includes('BE')) {
        breakevens++;
        consecutiveLosses = 0;
      } else {
        other++;
      }

      // R result calculation
      const rVal = Number(t.r_multiplier || t.risk_reward_multiplier || 0);
      totalR += rVal;

      // Grouping
      const p = t.pair || 'Unknown';
      if (!tradesByPair[p]) tradesByPair[p] = { total: 0, win: 0, loss: 0, be: 0 };
      tradesByPair[p].total++;
      if (outcome.includes('WIN')) tradesByPair[p].win++;
      else if (outcome.includes('LOSS')) tradesByPair[p].loss++;
      else if (outcome.includes('BREAKEVEN') || outcome.includes('BE')) tradesByPair[p].be++;

      const tf = t.timeframe || 'Unknown';
      if (!tradesByTf[tf]) tradesByTf[tf] = { total: 0, win: 0, loss: 0, be: 0 };
      tradesByTf[tf].total++;
      if (outcome.includes('WIN')) tradesByTf[tf].win++;
      else if (outcome.includes('LOSS')) tradesByTf[tf].loss++;
      else if (outcome.includes('BREAKEVEN') || outcome.includes('BE')) tradesByTf[tf].be++;

      const setup = t.setup || 'Unknown';
      if (!tradesBySetup[setup]) tradesBySetup[setup] = { total: 0, win: 0, loss: 0, be: 0 };
      tradesBySetup[setup].total++;
      if (outcome.includes('WIN')) tradesBySetup[setup].win++;
      else if (outcome.includes('LOSS')) tradesBySetup[setup].loss++;
      else if (outcome.includes('BREAKEVEN') || outcome.includes('BE')) tradesBySetup[setup].be++;

      const dir = t.direction || 'Unknown';
      if (!tradesByDirection[dir]) tradesByDirection[dir] = { total: 0, win: 0, loss: 0, be: 0 };
      tradesByDirection[dir].total++;
      if (outcome.includes('WIN')) tradesByDirection[dir].win++;
      else if (outcome.includes('LOSS')) tradesByDirection[dir].loss++;
      else if (outcome.includes('BREAKEVEN') || outcome.includes('BE')) tradesByDirection[dir].be++;

      // Time calculation
      const currTime = new Date(t.created_at || t.opened_at).getTime();
      if (prevTradeTime > 0) {
        const diff = currTime - prevTradeTime;
        totalTimeBetween += diff;
        timeIntervalCount++;
        if (diff < minTimeBetween) {
          minTimeBetween = diff;
        }
      }
      prevTradeTime = currTime;
    }

    const winRate = totalTrades > 0 ? (wins / (wins + losses)) * 100 : 0;
    // Expectancy: (WinRate * AvgWinR) - (LossRate * AvgLossR)
    // Or just simple totalR / totalTrades if we use R units
    const avgR = totalTrades > 0 ? totalR / totalTrades : 0;
    const avgTimeBetweenMinutes = timeIntervalCount > 0 ? (totalTimeBetween / timeIntervalCount) / (1000 * 60) : 0;
    const minTimeBetweenMinutes = minTimeBetween !== Infinity ? minTimeBetween / (1000 * 60) : 0;

    console.log(`- Wins: ${wins}`);
    console.log(`- Losses: ${losses}`);
    console.log(`- Breakevens: ${breakevens}`);
    console.log(`- Other/Active: ${other}`);
    console.log(`- Win Rate (excluding Breakevens/Other): ${winRate.toFixed(2)}%`);
    console.log(`- Total R-multiplier accumulated: ${totalR.toFixed(2)}R`);
    console.log(`- Average R per trade: ${avgR.toFixed(2)}R`);
    console.log(`- Maximum Consecutive Losses: ${maxConsecutiveLosses}`);
    console.log(`- Average time between signals: ${avgTimeBetweenMinutes.toFixed(2)} mins`);
    console.log(`- Minimum time between signals: ${minTimeBetweenMinutes.toFixed(2)} mins`);

    console.log("\nPerformance by Pair:");
    console.log(JSON.stringify(tradesByPair, null, 2));

    console.log("\nPerformance by Timeframe:");
    console.log(JSON.stringify(tradesByTf, null, 2));

    console.log("\nPerformance by Setup Type:");
    console.log(JSON.stringify(tradesBySetup, null, 2));

    console.log("\nPerformance by Direction:");
    console.log(JSON.stringify(tradesByDirection, null, 2));
  }

  // Step 5: Query Telegram signals sent if any table exists
  console.log("\n--- TELEGRAM SENT SIGNALS ---");
  const { data: signalsSent, error: sigErr } = await supabase
    .from('signals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (sigErr) {
    console.error("Error querying signals:", sigErr.message);
  } else {
    console.log(`Total signals generated in signals table: ${signalsSent?.length || 0}`);
    for (const sig of (signalsSent || []).slice(0, 5)) {
      console.log(`- CreatedAt: ${sig.created_at}, Pair: ${sig.pair}, SignalType: ${sig.signal_type}, Confidence: ${sig.confidence}`);
    }
  }

  console.log("\n=========================================");
}

main().catch(console.error);
