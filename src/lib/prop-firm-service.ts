export type AccountType = 'personal' | 'prop';

export interface PropFirmSettings {
  id?: string;
  user_id: string;
  firm_name: string;
  account_phase: string;
  account_size: number;
  profit_target?: number | null;
  profit_target_type?: 'PERCENTAGE' | 'AMOUNT' | null;
  daily_loss_limit: number;
  daily_loss_limit_type: 'PERCENTAGE' | 'AMOUNT';
  daily_loss_calculation_basis: 'BALANCE' | 'EQUITY';
  daily_reset_time?: string | null;
  daily_reset_timezone?: string | null;
  maximum_drawdown: number;
  drawdown_type: 'STATIC' | 'TRAILING';
  drawdown_calculation_basis: 'BALANCE' | 'EQUITY';
  risk_per_trade: number;
  risk_per_trade_type: 'PERCENTAGE' | 'AMOUNT';
  maximum_trades_per_day?: number | null;
  news_restriction_enabled: boolean;
  news_buffer_before_minutes: number;
  news_buffer_after_minutes: number;
  high_watermark_balance?: number | null;
  high_watermark_equity?: number | null;
  created_at?: string;
  updated_at?: string;
}

export function resolvePersistedAccountType(rawType?: string | null): AccountType {
  if (!rawType) return 'personal';
  const clean = String(rawType).toLowerCase().trim();
  if (clean === 'prop' || clean === 'prop_firm' || clean === 'propfirm') {
    return 'prop';
  }
  return 'personal';
}

export async function getPropFirmSettings(supabaseClient: any, userId: string): Promise<PropFirmSettings | null> {
  if (!supabaseClient || !userId) return null;
  try {
    const { data, error } = await supabaseClient
      .from('prop_firm_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return null;
    return data as PropFirmSettings;
  } catch {
    return null;
  }
}

export async function savePropFirmSettings(
  supabaseClient: any,
  userIdOrSettings: string | Partial<PropFirmSettings>,
  maybeSettings?: Partial<PropFirmSettings>
) {
  if (!supabaseClient) return { data: null, error: null };
  try {
    let payload: any = {};
    if (typeof userIdOrSettings === 'string') {
      payload = { user_id: userIdOrSettings, ...(maybeSettings || {}) };
    } else {
      payload = { ...(userIdOrSettings || {}) };
    }

    if (!payload.user_id) {
      return { data: null, error: new Error('Missing user_id for prop firm settings') };
    }

    const { data, error } = await supabaseClient
      .from('prop_firm_settings')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .maybeSingle();

    return { data, error };
  } catch (err: any) {
    return { data: null, error: err };
  }
}

export interface HwmSyncParams {
  accountSize?: number;
  currentBalance?: number;
  currentEquity?: number;
  existingHwmBalance?: number;
  existingHwmEquity?: number;
}

export async function syncPropFirmHighWatermarks(
  supabaseClient: any,
  userId: string,
  balanceOrParams: number | HwmSyncParams
): Promise<{ error: any; highWatermarkBalance?: number; highWatermarkEquity?: number }> {
  let bal: number;
  let eq: number | undefined;

  if (typeof balanceOrParams === 'number') {
    bal = balanceOrParams;
    eq = balanceOrParams;
  } else {
    const existingBal = balanceOrParams.existingHwmBalance ?? balanceOrParams.accountSize ?? 0;
    const existingEq = balanceOrParams.existingHwmEquity ?? balanceOrParams.accountSize ?? 0;
    bal = Math.max(existingBal, balanceOrParams.currentBalance ?? 0);
    eq = Math.max(existingEq, balanceOrParams.currentEquity ?? 0);
  }

  if (supabaseClient && userId) {
    try {
      await supabaseClient
        .from('prop_firm_settings')
        .update({
          high_watermark_balance: bal,
          high_watermark_equity: eq,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);
    } catch (err: any) {
      return { error: err, highWatermarkBalance: bal, highWatermarkEquity: eq };
    }
  }
  return { error: null, highWatermarkBalance: bal, highWatermarkEquity: eq };
}

export function computePropFirmResetBoundaryUtc(
  resetTimeOrNow?: string | Date,
  nowOrTz?: Date | string,
  _tz?: string
): Date {
  let now = new Date();
  if (resetTimeOrNow instanceof Date) {
    now = resetTimeOrNow;
  } else if (nowOrTz instanceof Date) {
    now = nowOrTz;
  }
  const boundary = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return boundary;
}

export function calculateSingleOpenWatcherRisk(watchers: any[]): number {
  return (watchers || []).reduce((sum, w) => sum + (Number(w.risk_amount) || 0), 0);
}

export function calculateSingleOpenWatcherFloatingPnl(watcher: any, quote: { bid: number; ask: number }): { success: boolean; pnl: number } {
  if (!watcher || !quote) return { success: false, pnl: 0 };
  const entryPrice = Number(watcher.entry_price);
  const lotSize = Number(watcher.lot_size);
  const exitPrice = watcher.direction === 'BUY' ? quote.bid : quote.ask;
  const pnl = (exitPrice - entryPrice) * lotSize * (watcher.direction === 'BUY' ? 100000 : -100000);
  return { success: true, pnl };
}

export async function computeAggregateOpenTradesFloatingPnl(watchers: any[], marketPrices: { marketPricesBySymbol: Record<string, number> }): Promise<{ success: boolean; pnl: number }> {
  let totalPnl = 0;
  for (const w of watchers) {
    const price = marketPrices.marketPricesBySymbol[w.selected_pair];
    if (!price) return { success: false, pnl: 0 };
    const res = calculateSingleOpenWatcherFloatingPnl(w, { bid: price, ask: price });
    if (!res.success) return { success: false, pnl: 0 };
    totalPnl += res.pnl;
  }
  return { success: true, pnl: totalPnl };
}

