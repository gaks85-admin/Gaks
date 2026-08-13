import { createClient } from '@supabase/supabase-js';
import { recordCompletedTrade } from '../../src/lib/learning-engine.js';
import { validateActiveTradeState } from '../../src/lib/trade-validator.js';
import { calculateUnrealizedPnlR, evaluateActiveTradeExit } from '../../src/lib/active-trade-monitor.js';

const getSupabase = () => {
  const url = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Supabase configuration missing');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
};

export default async function handler(req: any, res: any) {
  const supabase = getSupabase();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  let userId = req.body.userId;
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
    if (token) {
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) userId = user.id;
    }
  } catch (err) {
    console.warn("Auth token lookup failed:", err);
  }

  if (!userId) {
    return res.status(401).json({ success: false, error: "Authentication required" });
  }

  const { watcherId, exitPrice, resolutionType, notes } = req.body;

  if (!watcherId) {
    return res.status(400).json({ success: false, error: "Missing watcherId" });
  }

  try {
    // 1. Fetch the active watcher
    const { data: watcher, error: watcherErr } = await supabase
      .from('watchers')
      .select('*')
      .eq('id', watcherId)
      .eq('user_id', userId)
      .maybeSingle();

    if (watcherErr || !watcher) {
      return res.status(404).json({ success: false, error: "Active watcher not found" });
    }

    if (watcher.trade_status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        error: `Cannot resolve trade: watcher is currently in '${watcher.trade_status}' state (must be ACTIVE)`
      });
    }

    const activeValidation = validateActiveTradeState(watcher);
    if (!activeValidation.valid) {
      // Heal invalid watcher state
      await supabase.from('watchers').update({
        trade_status: 'WAITING',
        active_trade_id: null,
        updated_at: new Date().toISOString()
      }).eq('id', watcher.id);

      return res.status(400).json({
        success: false,
        error: `Invalid active trade state healed to WAITING: ${activeValidation.reason}`
      });
    }

    const entryPrice = parseFloat(String(watcher.entry_price));
    const stopLoss = parseFloat(String(watcher.stop_loss));
    const takeProfit = parseFloat(String(watcher.take_profit));
    const direction = (watcher.direction || 'BUY').toUpperCase();
    const finalExitPrice = typeof exitPrice === 'number' && !isNaN(exitPrice) ? exitPrice : entryPrice;
    const tradeId = watcher.active_trade_id || watcher.last_signal_data?.trade_id || null;

    let pnlR = 0;
    let outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' = 'BREAKEVEN';

    if (resolutionType === 'TP_HIT') {
      outcome = 'WIN';
      const exitEval = evaluateActiveTradeExit(direction, entryPrice, stopLoss, takeProfit, takeProfit);
      pnlR = exitEval.realizedR;
    } else if (resolutionType === 'SL_HIT') {
      outcome = 'LOSS';
      pnlR = -1.0;
    } else if (resolutionType === 'BREAKEVEN') {
      outcome = 'BREAKEVEN';
      pnlR = 0.0;
    } else {
      // Manual close at specific exit price
      pnlR = calculateUnrealizedPnlR(direction, entryPrice, stopLoss, finalExitPrice);
      if (pnlR > 0.05) outcome = 'WIN';
      else if (pnlR < -0.05) outcome = 'LOSS';
      else outcome = 'BREAKEVEN';
    }

    // 2. Fetch latest evaluation for metadata
    let latestEval: any = null;
    try {
      const { data } = await supabase
        .from('watcher_evaluations')
        .select('*')
        .eq('watcher_id', watcher.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      latestEval = data;
    } catch (e) {
      console.warn("Could not fetch latest evaluation for resolution:", e);
    }

    // 3. Record completed trade
    await recordCompletedTrade(supabase, {
      user_id: userId,
      watcher_id: watcher.id,
      trade_id: tradeId,
      evaluation_id: latestEval?.id || null,
      pair: watcher.selected_pair,
      timeframe: watcher.selected_timeframe || 'H1',
      strategy_mode: latestEval?.strategy_mode || 'HYBRID',
      entry_price: entryPrice,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      exit_price: finalExitPrice,
      direction: direction,
      opened_at: watcher.opened_at || new Date(Date.now() - 60000).toISOString(),
      closed_at: new Date().toISOString(),
      decision_score: latestEval?.decision_score || null,
      matched_weight: latestEval?.matched_weight || null,
      possible_weight: latestEval?.possible_weight || null,
      matched_rules: latestEval?.matched_rules || [],
      failed_rules: latestEval?.failed_rules || [],
      gemini_used: latestEval?.gemini_used || false,
      notes: notes || `Manual resolution: ${resolutionType || 'MANUAL_CLOSE'} at price ${finalExitPrice}`,
      decision_snapshot: latestEval?.decision_snapshot || null
    });

    // 4. Update watcher to COOLDOWN
    const cooldownUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await supabase
      .from('watchers')
      .update({
        trade_status: 'COOLDOWN',
        active_trade_id: null,
        closed_at: new Date().toISOString(),
        cooldown_until: cooldownUntil,
        last_scan_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', watcher.id);

    return res.status(200).json({
      success: true,
      data: {
        watcherId: watcher.id,
        tradeId,
        outcome,
        pnlR,
        exitPrice: finalExitPrice,
        resolvedAt: new Date().toISOString()
      }
    });
  } catch (err: any) {
    console.error("[Resolve Trade API] Error:", err);
    return res.status(500).json({ success: false, error: err.message || "Internal server error" });
  }
}
