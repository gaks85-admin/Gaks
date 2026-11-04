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

export async function syncPropFirmHighWatermarks(supabaseClient: any, userId: string, balance: number) {
  if (!supabaseClient || !userId) return { error: null };
  try {
    await supabaseClient
      .from('prop_firm_settings')
      .update({
        high_watermark_balance: balance,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);
    return { error: null };
  } catch {
    return { error: null };
  }
}

export function computePropFirmResetBoundaryUtc(now = new Date()): Date {
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

