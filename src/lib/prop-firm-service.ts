export interface PropFirmSettings {
  id?: string;
  user_id: string;
  firm_name: string | null;
  account_phase: string | null;
  account_size: number | null;
  profit_target: number | null;
  profit_target_type: 'PERCENTAGE' | 'AMOUNT' | null;
  daily_loss_limit: number | null;
  daily_loss_limit_type: 'PERCENTAGE' | 'AMOUNT' | null;
  daily_loss_calculation_basis: 'BALANCE' | 'EQUITY' | null;
  daily_reset_time: string | null;
  daily_reset_timezone: string | null;
  maximum_drawdown: number | null;
  drawdown_type: 'STATIC' | 'TRAILING' | null;
  drawdown_calculation_basis: 'BALANCE' | 'EQUITY' | null;
  high_watermark_balance?: number | null;
  high_watermark_equity?: number | null;
  risk_per_trade: number | null;
  risk_per_trade_type: 'PERCENTAGE' | 'AMOUNT' | null;
  maximum_trades_per_day: number | null;
  news_restriction_enabled: boolean;
  news_buffer_before_minutes: number;
  news_buffer_after_minutes: number;
  created_at?: string;
  updated_at?: string;
}

export interface PropFirmHwmSyncInput {
  accountSize: number;
  currentBalance: number;
  currentEquity?: number | null;
  historicalPeakBalance?: number | null;
  existingHwmBalance?: number | null;
  existingHwmEquity?: number | null;
}

export interface PropFirmHwmSyncResult {
  highWatermarkBalance: number;
  highWatermarkEquity: number;
  updated: boolean;
  persisted: boolean;
}

function isPositiveFiniteNum(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val > 0;
}

const userHwmLocks = new Map<string, Promise<void>>();
const clientHwmState = new WeakMap<object, Map<string, { accountSize: number; balance: number; equity: number }>>();

function getClientUserHwmFloor(
  supabase: any,
  userId: string,
  accountSize: number
): { balance: number; equity: number } {
  if (!supabase || typeof supabase !== 'object') {
    return { balance: accountSize, equity: accountSize };
  }
  let map = clientHwmState.get(supabase);
  if (!map) {
    map = new Map();
    clientHwmState.set(supabase, map);
  }
  const existing = map.get(userId);
  if (!existing || (accountSize > 0 && existing.accountSize > 0 && existing.accountSize !== accountSize)) {
    const init = { accountSize, balance: accountSize, equity: accountSize };
    map.set(userId, init);
    return { balance: init.balance, equity: init.equity };
  }
  return { balance: existing.balance, equity: existing.equity };
}

function setClientUserHwmFloor(
  supabase: any,
  userId: string,
  accountSize: number,
  balance: number,
  equity: number,
  forceReset = false
): void {
  if (!supabase || typeof supabase !== 'object') return;
  let map = clientHwmState.get(supabase);
  if (!map) {
    map = new Map();
    clientHwmState.set(supabase, map);
  }
  const prev = map.get(userId);
  if (forceReset || !prev || (accountSize > 0 && prev.accountSize > 0 && prev.accountSize !== accountSize)) {
    map.set(userId, { accountSize, balance, equity });
  } else {
    map.set(userId, {
      accountSize: accountSize || prev.accountSize,
      balance: Math.max(prev.balance, balance),
      equity: Math.max(prev.equity, equity)
    });
  }
}

async function withUserHwmLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const key = userId || '__default__';
  const prev = userHwmLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>(resolve => {
    release = resolve;
  });
  userHwmLocks.set(key, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (userHwmLocks.get(key) === next) {
      userHwmLocks.delete(key);
    }
  }
}

/**
 * Computes and persists monotonic high-water marks (`high_watermark_balance` and `high_watermark_equity`)
 * for a Prop Firm user. Concurrency-safe: serializes per-user updates, reads latest DB state when available,
 * uses atomic SQL RPC (`sync_prop_firm_high_watermarks`) when available, and never writes a lower HWM.
 */
export async function syncPropFirmHighWatermarks(
  supabase: any,
  userId: string,
  input: PropFirmHwmSyncInput
): Promise<PropFirmHwmSyncResult> {
  return withUserHwmLock(userId, async () => {
    const baseSize = isPositiveFiniteNum(input.accountSize) ? input.accountSize : 0;
    const floor = getClientUserHwmFloor(supabase, userId, baseSize);

    let dbHwmBalance: number | null = null;
    let dbHwmEquity: number | null = null;

    if (supabase && typeof supabase.from === 'function' && userId) {
      try {
        const tableRef = supabase.from('prop_firm_settings');
        if (typeof tableRef.select === 'function') {
          const query = tableRef.select('high_watermark_balance, high_watermark_equity, account_size');
          if (query && typeof query.eq === 'function') {
            const eqRes = query.eq('user_id', userId);
            if (eqRes && typeof eqRes.maybeSingle === 'function') {
              const { data } = await eqRes.maybeSingle();
              if (data) {
                if (isPositiveFiniteNum(Number(data.high_watermark_balance))) {
                  dbHwmBalance = Number(data.high_watermark_balance);
                }
                if (isPositiveFiniteNum(Number(data.high_watermark_equity))) {
                  dbHwmEquity = Number(data.high_watermark_equity);
                }
              }
            }
          }
        }
      } catch {
        // Ignore if mock client does not implement select()
      }
    }

    const balanceCandidates: number[] = [baseSize, floor.balance];
    if (isPositiveFiniteNum(input.existingHwmBalance)) balanceCandidates.push(input.existingHwmBalance);
    if (isPositiveFiniteNum(dbHwmBalance)) balanceCandidates.push(dbHwmBalance);
    if (isPositiveFiniteNum(input.historicalPeakBalance)) balanceCandidates.push(input.historicalPeakBalance);
    if (isPositiveFiniteNum(input.currentBalance)) balanceCandidates.push(input.currentBalance);

    let nextHwmBalance = Number(Math.max(...balanceCandidates).toFixed(4));

    const equityCandidates: number[] = [baseSize, floor.equity];
    if (isPositiveFiniteNum(input.existingHwmEquity)) equityCandidates.push(input.existingHwmEquity);
    if (isPositiveFiniteNum(dbHwmEquity)) equityCandidates.push(dbHwmEquity);
    if (isPositiveFiniteNum(input.currentEquity)) equityCandidates.push(input.currentEquity);

    let nextHwmEquity = Number(Math.max(...equityCandidates).toFixed(4));

    const knownPersistedBal = Math.max(
      isPositiveFiniteNum(input.existingHwmBalance) ? input.existingHwmBalance : 0,
      isPositiveFiniteNum(dbHwmBalance) ? dbHwmBalance : 0,
      floor.balance > baseSize ? floor.balance : 0
    );
    const knownPersistedEq = Math.max(
      isPositiveFiniteNum(input.existingHwmEquity) ? input.existingHwmEquity : 0,
      isPositiveFiniteNum(dbHwmEquity) ? dbHwmEquity : 0,
      floor.equity > baseSize ? floor.equity : 0
    );

    const updated =
      nextHwmBalance > knownPersistedBal + 1e-6 ||
      nextHwmEquity > knownPersistedEq + 1e-6;

    setClientUserHwmFloor(supabase, userId, baseSize, nextHwmBalance, nextHwmEquity);

    let persisted = false;
    if (updated && supabase && userId) {
      // 1. Prefer atomic PostgreSQL RPC when supported by the Supabase client
      if (typeof supabase.rpc === 'function') {
        try {
          const { data: rpcData, error: rpcErr } = await supabase.rpc('sync_prop_firm_high_watermarks', {
            p_user_id: userId,
            p_candidate_balance: nextHwmBalance,
            p_candidate_equity: nextHwmEquity
          });
          if (!rpcErr) {
            persisted = true;
            const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
            if (row) {
              if (isPositiveFiniteNum(Number(row.high_watermark_balance))) {
                nextHwmBalance = Math.max(nextHwmBalance, Number(row.high_watermark_balance));
              }
              if (isPositiveFiniteNum(Number(row.high_watermark_equity))) {
                nextHwmEquity = Math.max(nextHwmEquity, Number(row.high_watermark_equity));
              }
              setClientUserHwmFloor(supabase, userId, baseSize, nextHwmBalance, nextHwmEquity);
            }
          }
        } catch {
          // Fallback to table update if RPC is not deployed
        }
      }

      // 2. Fallback to serialized monotonic row update
      if (!persisted && typeof supabase.from === 'function') {
        try {
          const tableRef = supabase.from('prop_firm_settings');
          if (typeof tableRef.update === 'function') {
            const { error } = await tableRef
              .update({
                high_watermark_balance: nextHwmBalance,
                high_watermark_equity: nextHwmEquity,
                updated_at: new Date().toISOString()
              })
              .eq('user_id', userId);
            if (!error) {
              persisted = true;
            }
          }
        } catch {
          // Non-fatal persistence failure; caller holds authoritative in-memory HWM for current evaluation
        }
      }
    }

    return {
      highWatermarkBalance: nextHwmBalance,
      highWatermarkEquity: nextHwmEquity,
      updated,
      persisted
    };
  });
}

export async function getPropFirmSettings(supabase: any, userId: string): Promise<PropFirmSettings | null> {
  const { data, error } = await supabase
    .from('prop_firm_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (error.code === 'PGRST205' || error.message?.includes('schema cache') || error.message?.includes('relation') || error.message?.includes('does not exist')) {
      console.warn('[PropFirmService] prop_firm_settings table not yet created in Supabase. Please apply migration_prop_firm_settings.sql.');
      return null;
    }
    console.error('[PropFirmService] Error loading prop firm settings:', error.message);
    return null;
  }

  return data || null;
}

export async function savePropFirmSettings(
  supabase: any,
  userId: string,
  settings: Partial<PropFirmSettings>
): Promise<{ success: boolean; error?: string }> {
  return withUserHwmLock(userId, async () => {
    let existingRow: PropFirmSettings | null = null;
    try {
      if (supabase && typeof supabase.from === 'function') {
        existingRow = await getPropFirmSettings(supabase, userId);
      }
    } catch {
      existingRow = null;
    }

    const incomingAccountSize =
      settings.account_size !== undefined && settings.account_size !== null
        ? Number(settings.account_size)
        : (existingRow?.account_size ?? null);
    const validAccountSize = isPositiveFiniteNum(incomingAccountSize) ? incomingAccountSize : null;
    const baseSize = validAccountSize ?? 0;

    // A challenge reset ONLY occurs when an existing row's challenge identity (account_size, firm_name, or account_phase) explicitly changes.
    const isChallengeReset =
      existingRow !== null &&
      ((settings.account_size !== undefined && Number(existingRow.account_size) !== Number(settings.account_size)) ||
        (settings.firm_name !== undefined && existingRow.firm_name !== settings.firm_name) ||
        (settings.account_phase !== undefined && existingRow.account_phase !== settings.account_phase));

    const floor = getClientUserHwmFloor(supabase, userId, baseSize);

    // Protect runtime HWM from accidental client/UI overwrite (e.g. null or lower values in settings payload).
    let resolvedHwmBalance: number | null = validAccountSize;
    let resolvedHwmEquity: number | null = validAccountSize;

    if (isChallengeReset) {
      resolvedHwmBalance = validAccountSize;
      resolvedHwmEquity = validAccountSize;
      if (validAccountSize !== null) {
        setClientUserHwmFloor(supabase, userId, validAccountSize, validAccountSize, validAccountSize, true);
      }
    } else {
      const balCandidates: number[] = [];
      if (validAccountSize !== null) balCandidates.push(validAccountSize);
      if (floor.balance > 0) balCandidates.push(floor.balance);
      if (isPositiveFiniteNum(existingRow?.high_watermark_balance)) {
        balCandidates.push(Number(existingRow!.high_watermark_balance));
      }
      if (isPositiveFiniteNum(settings.high_watermark_balance)) {
        balCandidates.push(Number(settings.high_watermark_balance));
      }
      resolvedHwmBalance = balCandidates.length > 0 ? Math.max(...balCandidates) : null;

      const eqCandidates: number[] = [];
      if (validAccountSize !== null) eqCandidates.push(validAccountSize);
      if (floor.equity > 0) eqCandidates.push(floor.equity);
      if (isPositiveFiniteNum(existingRow?.high_watermark_equity)) {
        eqCandidates.push(Number(existingRow!.high_watermark_equity));
      }
      if (isPositiveFiniteNum(settings.high_watermark_equity)) {
        eqCandidates.push(Number(settings.high_watermark_equity));
      }
      resolvedHwmEquity = eqCandidates.length > 0 ? Math.max(...eqCandidates) : null;

      if (resolvedHwmBalance !== null && resolvedHwmEquity !== null) {
        setClientUserHwmFloor(supabase, userId, baseSize, resolvedHwmBalance, resolvedHwmEquity);
      }
    }

    const payload: Record<string, any> = {
      user_id: userId,
      firm_name: settings.firm_name !== undefined ? settings.firm_name : null,
      account_phase: settings.account_phase !== undefined ? settings.account_phase : null,
      account_size: settings.account_size !== undefined ? settings.account_size : null,
      profit_target: settings.profit_target !== undefined ? settings.profit_target : null,
      profit_target_type: settings.profit_target_type !== undefined ? settings.profit_target_type : null,
      daily_loss_limit: settings.daily_loss_limit !== undefined ? settings.daily_loss_limit : null,
      daily_loss_limit_type: settings.daily_loss_limit_type !== undefined ? settings.daily_loss_limit_type : null,
      daily_loss_calculation_basis: settings.daily_loss_calculation_basis !== undefined ? settings.daily_loss_calculation_basis : null,
      daily_reset_time: settings.daily_reset_time !== undefined ? settings.daily_reset_time : null,
      daily_reset_timezone: settings.daily_reset_timezone !== undefined ? settings.daily_reset_timezone : null,
      maximum_drawdown: settings.maximum_drawdown !== undefined ? settings.maximum_drawdown : null,
      drawdown_type: settings.drawdown_type !== undefined ? settings.drawdown_type : null,
      drawdown_calculation_basis: settings.drawdown_calculation_basis !== undefined ? settings.drawdown_calculation_basis : null,
      high_watermark_balance: resolvedHwmBalance,
      high_watermark_equity: resolvedHwmEquity,
      risk_per_trade: settings.risk_per_trade !== undefined ? settings.risk_per_trade : null,
      risk_per_trade_type: settings.risk_per_trade_type !== undefined ? settings.risk_per_trade_type : null,
      maximum_trades_per_day: settings.maximum_trades_per_day !== undefined ? settings.maximum_trades_per_day : null,
      news_restriction_enabled: settings.news_restriction_enabled ?? false,
      news_buffer_before_minutes: settings.news_buffer_before_minutes ?? 5,
      news_buffer_after_minutes: settings.news_buffer_after_minutes ?? 5,
      updated_at: new Date().toISOString()
    };

    let { error } = await supabase
      .from('prop_firm_settings')
      .upsert(payload, { onConflict: 'user_id' });

    // Graceful fallback if high_watermark_balance / high_watermark_equity columns are not yet migrated in DB
    if (error && (error.message?.includes('high_watermark_balance') || error.message?.includes('high_watermark_equity'))) {
      const fallbackPayload = { ...payload };
      delete fallbackPayload.high_watermark_balance;
      delete fallbackPayload.high_watermark_equity;
      const retryRes = await supabase
        .from('prop_firm_settings')
        .upsert(fallbackPayload, { onConflict: 'user_id' });
      error = retryRes.error;
    }

    if (error) {
      if (error.code === 'PGRST205' || error.message?.includes('schema cache') || error.message?.includes('relation') || error.message?.includes('does not exist')) {
        return { success: false, error: 'Prop firm settings table (prop_firm_settings) does not exist in database. Please apply migration_prop_firm_settings.sql.' };
      }
      console.error('[PropFirmService] Error saving prop firm settings:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  });
}
