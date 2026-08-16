export interface WatcherLogContext {
  userEmail: string;
  watcherId: string;
  pair: string;
  timeframe: string;
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
    console.error(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: Watcher has no user ID`);
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
      console.error(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: Profiles query error - ${profileErr.message}`);
    } else if (profile && profile.email && profile.email.trim() !== '') {
      return { userEmail: profile.email.trim(), watcherId, pair, timeframe };
    } else if (profile && (!profile.email || profile.email.trim() === '')) {
      console.warn(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: User profile record found for ${userId} but email is missing`);
    }
  } catch (err: any) {
    console.error(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: Exception querying profiles - ${err?.message || err}`);
  }

  // 2. Fallback to Supabase Auth admin lookup
  if (supabase?.auth?.admin?.getUserById) {
    try {
      const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(userId);
      if (authErr) {
        console.error(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: Auth user lookup failed - ${authErr.message}`);
      } else if (authUser?.user?.email && authUser.user.email.trim() !== '') {
        return { userEmail: authUser.user.email.trim(), watcherId, pair, timeframe };
      } else if (authUser?.user) {
        console.warn(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: Auth user record found for ${userId} but email is missing`);
      } else {
        console.error(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: User record not found in profiles or auth for ID ${userId}`);
      }
    } catch (err: any) {
      console.error(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: Exception querying auth.admin - ${err?.message || err}`);
    }
  } else {
    console.error(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: User profile returned no email and auth.admin is unavailable`);
  }

  return { userEmail: 'unknown', watcherId, pair, timeframe };
}

export function logWatcherEvent(eventName: string, ctx: WatcherLogContext, details?: string | Record<string, any>): void {
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

export function logWatcherError(eventName: string, ctx: WatcherLogContext, error: any, details?: Record<string, any>): void {
  const header = formatWatcherHeader(eventName, ctx);
  const errMsg = error?.message || String(error || 'Unknown error');
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

export function logWatcherWarn(eventName: string, ctx: WatcherLogContext, message: string, details?: Record<string, any>): void {
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
