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
  risk_per_trade: number | null;
  risk_per_trade_type: 'PERCENTAGE' | 'AMOUNT' | null;
  maximum_trades_per_day: number | null;
  news_restriction_enabled: boolean;
  news_buffer_before_minutes: number;
  news_buffer_after_minutes: number;
  created_at?: string;
  updated_at?: string;
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

export async function savePropFirmSettings(supabase: any, userId: string, settings: Partial<PropFirmSettings>): Promise<{ success: boolean; error?: string }> {
  const payload = {
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
    risk_per_trade: settings.risk_per_trade !== undefined ? settings.risk_per_trade : null,
    risk_per_trade_type: settings.risk_per_trade_type !== undefined ? settings.risk_per_trade_type : null,
    maximum_trades_per_day: settings.maximum_trades_per_day !== undefined ? settings.maximum_trades_per_day : null,
    news_restriction_enabled: settings.news_restriction_enabled ?? false,
    news_buffer_before_minutes: settings.news_buffer_before_minutes ?? 5,
    news_buffer_after_minutes: settings.news_buffer_after_minutes ?? 5,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('prop_firm_settings')
    .upsert(payload, { onConflict: 'user_id' });

  if (error) {
    if (error.code === 'PGRST205' || error.message?.includes('schema cache') || error.message?.includes('relation') || error.message?.includes('does not exist')) {
      return { success: false, error: 'Prop firm settings table (prop_firm_settings) does not exist in database. Please apply migration_prop_firm_settings.sql.' };
    }
    console.error('[PropFirmService] Error saving prop firm settings:', error.message);
    return { success: false, error: error.message };
  }

  return { success: true };
}
