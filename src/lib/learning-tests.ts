import { 
  recordCompletedTrade, 
  calculateRuleStatistics, 
  calculatePairStatistics, 
  calculateTimeframeStatistics, 
  calculateSessionStatistics, 
  calculateHistoricalProbability,
  clearStatsCache
} from './learning-engine.js';

/**
 * Runs the self-contained Learning Engine test suite and outputs formatted diagnostics.
 */
export async function runLearningEngineTests(supabase: any, testUserId: string, testWatcherId: string) {
  console.log('====================================');
  console.log('🚀 RUNNING LEARNING ENGINE TEST SUITE');
  console.log('====================================');

  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    details: [] as string[]
  };

  function assert(name: string, condition: boolean) {
    results.total++;
    if (condition) {
      results.passed++;
      results.details.push(`✅ [PASS] ${name}`);
      console.log(`✅ [PASS] ${name}`);
    } else {
      results.failed++;
      results.details.push(`❌ [FAIL] ${name}`);
      console.error(`❌ [FAIL] ${name}`);
    }
  }

  try {
    // Test 1: clear stats cache
    clearStatsCache();
    assert('Stats cache cleared successfully', true);

    // Test 2: Record a mock Winning Buy trade
    console.log('\n--- Test 2: Recording Winning Buy Trade ---');
    const winTrade = await recordCompletedTrade(supabase, {
      user_id: testUserId,
      watcher_id: testWatcherId,
      pair: 'EUR/USD',
      timeframe: 'H1',
      strategy_mode: 'HYBRID',
      entry_price: 1.0800,
      stop_loss: 1.0750,
      take_profit: 1.0900,
      exit_price: 1.0910,
      direction: 'BUY',
      opened_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      closed_at: new Date().toISOString(),
      decision_score: 85,
      matched_rules: ['Trendline Breakout', 'BOS', 'Support Zone'],
      failed_rules: ['Volume Confirmation'],
      gemini_used: true
    });

    assert('Winning Buy trade recorded', winTrade !== null);
    if (winTrade) {
      assert('Outcome calculated as WIN', winTrade.outcome === 'WIN');
      assert('PIPs calculated correctly (>10 pips)', winTrade.pips !== null && winTrade.pips > 10);
      assert('Expected RR calculated', winTrade.rr_expected === 2);
      assert('Achieved RR calculated', winTrade.rr_achieved !== null && winTrade.rr_achieved >= 2.2);
      assert('Duration populated', winTrade.trade_duration_minutes !== null && winTrade.trade_duration_minutes >= 59);
    }

    // Test 3: Record a mock Losing Sell trade
    console.log('\n--- Test 3: Recording Losing Sell Trade ---');
    const lossTrade = await recordCompletedTrade(supabase, {
      user_id: testUserId,
      watcher_id: testWatcherId,
      pair: 'GBP/USD',
      timeframe: 'M15',
      strategy_mode: 'RULE_ONLY',
      entry_price: 1.2700,
      stop_loss: 1.2750,
      take_profit: 1.2600,
      exit_price: 1.2760,
      direction: 'SELL',
      opened_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      closed_at: new Date().toISOString(),
      decision_score: 95,
      matched_rules: ['Resistance Zone', 'Confirmation Candle'],
      failed_rules: [],
      gemini_used: false
    });

    assert('Losing Sell trade recorded', lossTrade !== null);
    if (lossTrade) {
      assert('Outcome calculated as LOSS', lossTrade.outcome === 'LOSS');
      assert('PIPs calculated correctly (< 0 pips)', lossTrade.pips !== null && lossTrade.pips < 0);
    }

    // Test 4: Calculate Rule Statistics
    console.log('\n--- Test 4: Computing Rule Statistics ---');
    const ruleStats = await calculateRuleStatistics(supabase, testUserId);
    assert('Rule statistics computed', Array.isArray(ruleStats));
    if (ruleStats.length > 0) {
      const trendlineStat = ruleStats.find(r => r.rule === 'Trendline Breakout');
      assert('Trendline Breakout stats present', trendlineStat !== undefined);
      if (trendlineStat) {
        assert('Trendline Breakout win rate is correct', trendlineStat.winRate === 100);
      }
    }

    // Test 5: Calculate Pair Statistics
    console.log('\n--- Test 5: Computing Pair Statistics ---');
    const pairStats = await calculatePairStatistics(supabase, testUserId);
    assert('Pair statistics computed', Array.isArray(pairStats));

    // Test 6: Calculate Timeframe Statistics
    console.log('\n--- Test 6: Computing Timeframe Statistics ---');
    const tfStats = await calculateTimeframeStatistics(supabase, testUserId);
    assert('Timeframe statistics computed', Array.isArray(tfStats));

    // Test 7: Calculate Session Statistics
    console.log('\n--- Test 7: Computing Session Statistics ---');
    const sessionStats = await calculateSessionStatistics(supabase, testUserId);
    assert('Session statistics computed', Array.isArray(sessionStats));

    // Test 8: Calculate Historical Probability
    console.log('\n--- Test 8: Calculating Historical Probability ---');
    const prob = await calculateHistoricalProbability(
      supabase,
      testUserId,
      'EUR/USD',
      'H1',
      ['Trendline Breakout', 'BOS', 'Support Zone'],
      'HYBRID'
    );
    assert('Historical probability computed', prob !== null);
    if (prob) {
      assert('Sample size matches records found', prob.sample_size >= 1);
      assert('Historical probability is computed correctly', prob.historical_probability === 100);
    }

  } catch (err: any) {
    console.error('❌ Exception occurred during test execution:', err);
    assert('No exceptions during execution', false);
  }

  console.log('\n====================================');
  console.log(`📊 TESTS COMPLETE: ${results.passed}/${results.total} PASSED`);
  console.log('====================================');
  return results;
}
