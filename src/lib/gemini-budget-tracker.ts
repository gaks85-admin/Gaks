import { SupabaseClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL } from './auth-admin.js';

export interface BudgetCheckResult {
  allowed: boolean;
  currentCount: number;
  maxLimit: number;
  isAdmin: boolean;
  dateLagos: string;
  reason?: string;
}

export function getLagosCalendarDate(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
  } catch {
    const d = new Date();
    d.setHours(d.getHours() + 1);
    return d.toISOString().split('T')[0];
  }
}

const inMemoryDailyUsage = new Map<string, { count: number; date: string }>();

export async function checkAndIncrementGeminiBudget(
  supabase: SupabaseClient,
  userId: string,
  userEmail?: string | null
): Promise<BudgetCheckResult> {
  const dateLagos = getLagosCalendarDate();
  
  let isAdmin = (userEmail || '').toLowerCase().trim() === ADMIN_EMAIL.toLowerCase().trim();
  if (!isAdmin && userId && supabase) {
    try {
      const { data: adminRecord } = await supabase
        .from('app_admins')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle();
      if (adminRecord) isAdmin = true;
    } catch {
      // ignore
    }
  }

  const maxLimit = isAdmin ? 15 : 10;
  const usageKey = `${userId}_${dateLagos}`;

  let currentCount = 0;
  try {
    const { data, error } = await supabase
      .from('gemini_daily_usage')
      .select('request_count')
      .eq('user_id', userId)
      .eq('date_lagos', dateLagos)
      .maybeSingle();

    if (!error && data) {
      currentCount = data.request_count || 0;
    }
  } catch {
    const mem = inMemoryDailyUsage.get(usageKey);
    if (mem && mem.date === dateLagos) {
      currentCount = mem.count;
    }
  }

  if (currentCount >= maxLimit) {
    return {
      allowed: false,
      currentCount,
      maxLimit,
      isAdmin,
      dateLagos,
      reason: 'GEMINI_DAILY_BUDGET_EXHAUSTED'
    };
  }

  const newCount = currentCount + 1;
  inMemoryDailyUsage.set(usageKey, { count: newCount, date: dateLagos });

  try {
    await supabase
      .from('gemini_daily_usage')
      .upsert({
        user_id: userId,
        date_lagos: dateLagos,
        request_count: newCount,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,date_lagos' });
  } catch (err: any) {
    if (err?.code !== 'PGRST205' && !err?.message?.includes('does not exist')) {
      console.warn('[Gemini Budget Tracker] Upsert warning:', err?.message || err);
    }
  }

  return {
    allowed: true,
    currentCount: newCount,
    maxLimit,
    isAdmin,
    dateLagos
  };
}

export async function getGeminiBudgetStatus(
  supabase: SupabaseClient,
  userId: string,
  userEmail?: string | null
): Promise<{ currentCount: number; maxLimit: number; isAdmin: boolean; dateLagos: string }> {
  const dateLagos = getLagosCalendarDate();
  let isAdmin = (userEmail || '').toLowerCase().trim() === ADMIN_EMAIL.toLowerCase().trim();
  if (!isAdmin && userId && supabase) {
    try {
      const { data: adminRecord } = await supabase
        .from('app_admins')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle();
      if (adminRecord) isAdmin = true;
    } catch {}
  }
  const maxLimit = isAdmin ? 15 : 10;
  let currentCount = 0;
  try {
    const { data } = await supabase
      .from('gemini_daily_usage')
      .select('request_count')
      .eq('user_id', userId)
      .eq('date_lagos', dateLagos)
      .maybeSingle();
    if (data) currentCount = data.request_count || 0;
  } catch {
    const mem = inMemoryDailyUsage.get(`${userId}_${dateLagos}`);
    if (mem && mem.date === dateLagos) currentCount = mem.count;
  }
  return { currentCount, maxLimit, isAdmin, dateLagos };
}
