export interface WatcherLogContext {
  userEmail: string;
  watcherId: string;
  pair: string;
  timeframe: string;
}

export function isDebugMode(): boolean {
  return process.env.LOG_LEVEL === 'debug' || process.env.DEBUG === 'true';
}

export function formatShortId(id?: string): string {
  if (!id) return 'unknown';
  if (id.length <= 8) return id;
  return `${id.slice(0, 8)}...`;
}

export function formatShortUser(user?: string): string {
  if (!user) return 'unknown';
  if (user.includes('@')) {
    const parts = user.split('@');
    const name = parts[0].length > 8 ? `${parts[0].slice(0, 8)}...` : parts[0];
    return `${name}@...`;
  }
  return formatShortId(user);
}

export function logWatcherStart(ctx: WatcherLogContext, status: string = 'ACTIVE'): void {
  console.log(`[WATCHER] user=${formatShortUser(ctx.userEmail)} | watcher=${formatShortId(ctx.watcherId)} | pair=${ctx.pair} | tf=${ctx.timeframe} | status=${status}`);
}

export function logWatcherResult(
  ctx: WatcherLogContext,
  result: 'TRADE' | 'NO_TRADE' | 'ERROR',
  details: { reason?: string; signal?: string; lot?: number | string; sl?: number | string; tp?: number | string; durationMs?: number } = {}
): void {
  const user = formatShortUser(ctx.userEmail);
  const watcher = formatShortId(ctx.watcherId);
  const pair = ctx.pair || 'UNKNOWN';
  const tf = ctx.timeframe || 'UNKNOWN';
  const duration = details.durationMs !== undefined ? `${details.durationMs}ms` : '0ms';

  if (result === 'TRADE') {
    console.log(`[WATCHER] user=${user} | watcher=${watcher} | pair=${pair} | tf=${tf} | result=TRADE | signal=${details.signal || 'BUY'} | lot=${details.lot ?? '0.01'} | sl=${details.sl ?? 'N/A'} | tp=${details.tp ?? 'N/A'} | duration=${duration}`);
  } else if (result === 'ERROR') {
    console.log(`[WATCHER] user=${user} | watcher=${watcher} | pair=${pair} | tf=${tf} | result=ERROR | reason=${details.reason || 'unknown_error'} | duration=${duration}`);
  } else {
    console.log(`[WATCHER] user=${user} | watcher=${watcher} | pair=${pair} | tf=${tf} | result=NO_TRADE | reason=${details.reason || 'no_setup'} | duration=${duration}`);
  }
}

export function formatWatcherHeader(eventName: string, ctx: WatcherLogContext): string {
  const email = ctx.userEmail || 'unknown';
  const watcherId = ctx.watcherId || 'unknown';
  const pair = ctx.pair || 'unknown';
  const timeframe = ctx.timeframe || 'unknown';

  return `[${eventName}] User: ${email} | Watcher: ${watcherId} | Pair: ${pair} | TF: ${timeframe}`;
}

/**
 * Resolves user context authoritatively for a watcher for production logging.
 * Does NOT modify trading logic or database state.
 */
export async function resolveWatcherUserContext(
  supabase: any,
  watcher: any
): Promise<WatcherLogContext> {
  const watcherId = watcher?.id || 'unknown';
  const pair = watcher?.selected_pair || watcher?.pair || 'unknown';
  const timeframe = watcher?.selected_timeframe || watcher?.timeframe || 'H1';
  const userId = watcher?.user_id;

  if (!userId) {
    if (isDebugMode()) {
      console.error(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: Watcher has no user ID`);
    }
    return { userEmail: 'unknown', watcherId, pair, timeframe };
  }

  // 1. Try profiles table (selecting existing valid columns: email, full_name)
  try {
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', userId)
      .maybeSingle();

    if (profileErr) {
      if (isDebugMode()) {
        console.error(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: Profiles query error - ${profileErr.message}`);
      }
    } else if (profile && profile.email && profile.email.trim() !== '') {
      return { userEmail: profile.email.trim(), watcherId, pair, timeframe };
    } else if (profile && (!profile.email || profile.email.trim() === '')) {
      if (isDebugMode()) {
        console.warn(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: User profile record found for ${userId} but email is missing`);
      }
    }
  } catch (err: any) {
    if (isDebugMode()) {
      console.error(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: Exception querying profiles - ${err?.message || err}`);
    }
  }

  // 2. Fallback to Supabase Auth admin lookup
  if (supabase?.auth?.admin?.getUserById) {
    try {
      const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(userId);
      if (authErr) {
        if (isDebugMode()) {
          console.error(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: Auth user lookup failed - ${authErr.message}`);
        }
      } else if (authUser?.user?.email && authUser.user.email.trim() !== '') {
        return { userEmail: authUser.user.email.trim(), watcherId, pair, timeframe };
      } else if (authUser?.user) {
        if (isDebugMode()) {
          console.warn(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: Auth user record found for ${userId} but email is missing`);
        }
      } else {
        if (isDebugMode()) {
          console.error(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: User record not found in profiles or auth for ID ${userId}`);
        }
      }
    } catch (err: any) {
      if (isDebugMode()) {
        console.error(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: Exception querying auth.admin - ${err?.message || err}`);
      }
    }
  } else {
    if (isDebugMode()) {
      console.error(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: User profile returned no email and auth.admin is unavailable`);
    }
  }

  return { userEmail: 'unknown', watcherId, pair, timeframe };
}

export function logWatcherEvent(eventName: string, ctx: WatcherLogContext, details?: string | Record<string, any>): void {
  if (isDebugMode()) {
    const header = formatWatcherHeader(eventName, ctx);
    if (!details) {
      console.log(header);
      return;
    }
    if (typeof details === 'string') {
      console.log(`${header}\n${details}`);
    } else {
      const lines = Object.entries(details)
        .filter(([_, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('\n');
      console.log(lines ? `${header}\n${lines}` : header);
    }
  }
}

export function logWatcherError(eventName: string, ctx: WatcherLogContext, error: any, details?: Record<string, any>): void {
  const shortId = formatShortId(ctx.watcherId);
  const errMsg = error?.message || String(error || 'Unknown error');
  console.error(`[WATCHER] ERROR | pair=${ctx.pair} | watcher=${shortId} | reason=${errMsg}`);
  if (isDebugMode()) {
    const header = formatWatcherHeader(eventName, ctx);
    let body = `Error: ${errMsg}`;
    if (details) {
      const lines = Object.entries(details)
        .filter(([_, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('\n');
      if (lines) body += `\n${lines}`;
    }
    console.error(`${header}\n${body}`);
  }
}

export function logWatcherWarn(eventName: string, ctx: WatcherLogContext, message: string, details?: Record<string, any>): void {
  if (isDebugMode()) {
    const header = formatWatcherHeader(eventName, ctx);
    let body = `Warning: ${message}`;
    if (details) {
      const lines = Object.entries(details)
        .filter(([_, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('\n');
      if (lines) body += `\n${lines}`;
    }
    console.warn(`${header}\n${body}`);
  }
}

