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

export const STRICT_MAX_GEMINI_CALLS_PER_USER_PER_DAY = 10;

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

  // Strictly enforce a maximum limit of 10 Gemini API calls per user per day
  const maxLimit = STRICT_MAX_GEMINI_CALLS_PER_USER_PER_DAY;
  const usageKey = `${userId}_${dateLagos}`;

  let currentCount = 0;
  try {
    const { data, error } = await supabase
      .from('gemini_daily_usage')
      .select('request_count')
      .eq('user_id', userId)
      .eq('date_lagos', dateLagos)
      .maybeSingle();

    if (error) {
      const mem = inMemoryDailyUsage.get(usageKey);
      if (mem && mem.date === dateLagos) {
        currentCount = mem.count;
      }
    } else if (data) {
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
    const { error: upsertErr } = await supabase
      .from('gemini_daily_usage')
      .upsert({
        user_id: userId,
        date_lagos: dateLagos,
        request_count: newCount,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,date_lagos' });
    if (upsertErr && upsertErr.code !== 'PGRST205' && !upsertErr.message?.includes('does not exist')) {
      console.warn('[Gemini Budget Tracker] Upsert warning:', upsertErr.message);
    }
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
  const maxLimit = STRICT_MAX_GEMINI_CALLS_PER_USER_PER_DAY;
  const usageKey = `${userId}_${dateLagos}`;
  let currentCount = 0;
  try {
    const { data, error } = await supabase
      .from('gemini_daily_usage')
      .select('request_count')
      .eq('user_id', userId)
      .eq('date_lagos', dateLagos)
      .maybeSingle();
    if (error) {
      const mem = inMemoryDailyUsage.get(usageKey);
      if (mem && mem.date === dateLagos) currentCount = mem.count;
    } else if (data) {
      currentCount = data.request_count || 0;
    }
  } catch {
    const mem = inMemoryDailyUsage.get(usageKey);
    if (mem && mem.date === dateLagos) currentCount = mem.count;
  }
  return { currentCount, maxLimit, isAdmin, dateLagos };
}
