export function isDebugMode() {
    return process.env.LOG_LEVEL === 'debug' || process.env.DEBUG === 'true';
}
export function formatShortId(id) {
    if (!id)
        return 'unknown';
    if (id.length <= 8)
        return id;
    return `${id.slice(0, 8)}...`;
}
export function formatShortUser(user) {
    if (!user)
        return 'unknown';
    if (user.includes('@')) {
        const parts = user.split('@');
        const name = parts[0].length > 8 ? `${parts[0].slice(0, 8)}...` : parts[0];
        return `${name}@...`;
    }
    return formatShortId(user);
}
export function logWatcherStart(ctx, status = 'ACTIVE') {
    console.log(`[WATCHER] user=${formatShortUser(ctx.userEmail)} | watcher=${formatShortId(ctx.watcherId)} | pair=${ctx.pair} | tf=${ctx.timeframe} | status=${status}`);
}
export function logWatcherResult(ctx, result, details = {}) {
    const user = formatShortUser(ctx.userEmail);
    const watcher = formatShortId(ctx.watcherId);
    const pair = ctx.pair || 'UNKNOWN';
    const tf = ctx.timeframe || 'UNKNOWN';
    const duration = details.durationMs !== undefined ? `${details.durationMs}ms` : '0ms';
    if (result === 'TRADE') {
        console.log(`[WATCHER] user=${user} | watcher=${watcher} | pair=${pair} | tf=${tf} | result=TRADE | signal=${details.signal || 'BUY'} | lot=${details.lot ?? '0.01'} | sl=${details.sl ?? 'N/A'} | tp=${details.tp ?? 'N/A'} | duration=${duration}`);
    }
    else if (result === 'ERROR') {
        console.log(`[WATCHER] user=${user} | watcher=${watcher} | pair=${pair} | tf=${tf} | result=ERROR | reason=${details.reason || 'unknown_error'} | duration=${duration}`);
    }
    else {
        console.log(`[WATCHER] user=${user} | watcher=${watcher} | pair=${pair} | tf=${tf} | result=NO_TRADE | reason=${details.reason || 'no_setup'} | duration=${duration}`);
    }
}
export function formatWatcherHeader(eventName, ctx) {
    const email = ctx.userEmail || 'unknown';
    const watcherId = ctx.watcherId || 'unknown';
    const pair = ctx.pair || 'unknown';
    const timeframe = ctx.timeframe || 'unknown';
    return `[${eventName}] User: ${email} | Watcher: ${watcherId} | Pair: ${pair} | TF: ${timeframe}`;
}
export async function resolveWatcherUserContext(supabase, watcher) {
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
        }
        else if (profile && profile.email && profile.email.trim() !== '') {
            return { userEmail: profile.email.trim(), watcherId, pair, timeframe };
        }
        else if (profile && (!profile.email || profile.email.trim() === '')) {
            if (isDebugMode()) {
                console.warn(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: User profile record found for ${userId} but email is missing`);
            }
        }
    }
    catch (err) {
        if (isDebugMode()) {
            console.error(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: Exception querying profiles - ${err?.message || err}`);
        }
    }
    if (supabase?.auth?.admin?.getUserById) {
        try {
            const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(userId);
            if (authErr) {
                if (isDebugMode()) {
                    console.error(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: Auth user lookup failed - ${authErr.message}`);
                }
            }
            else if (authUser?.user?.email && authUser.user.email.trim() !== '') {
                return { userEmail: authUser.user.email.trim(), watcherId, pair, timeframe };
            }
            else if (authUser?.user) {
                if (isDebugMode()) {
                    console.warn(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: Auth user record found for ${userId} but email is missing`);
                }
            }
            else {
                if (isDebugMode()) {
                    console.error(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: User record not found in profiles or auth for ID ${userId}`);
                }
            }
        }
        catch (err) {
            if (isDebugMode()) {
                console.error(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: Exception querying auth.admin - ${err?.message || err}`);
            }
        }
    }
    else {
        if (isDebugMode()) {
            console.error(`[WATCHER CONTEXT ERROR] Watcher: ${watcherId} | Reason: User profile returned no email and auth.admin is unavailable`);
        }
    }
    return { userEmail: 'unknown', watcherId, pair, timeframe };
}
export function logWatcherEvent(eventName, ctx, details) {
    if (isDebugMode()) {
        const header = formatWatcherHeader(eventName, ctx);
        if (!details) {
            console.log(header);
            return;
        }
        if (typeof details === 'string') {
            console.log(`${header}\n${details}`);
        }
        else {
            const lines = Object.entries(details)
                .filter(([_, v]) => v !== undefined && v !== null)
                .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                .join('\n');
            console.log(lines ? `${header}\n${lines}` : header);
        }
    }
}
export function logWatcherError(eventName, ctx, error, details) {
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
            if (lines)
                body += `\n${lines}`;
        }
        console.error(`${header}\n${body}`);
    }
}
export function logWatcherWarn(eventName, ctx, message, details) {
    if (isDebugMode()) {
        const header = formatWatcherHeader(eventName, ctx);
        let body = `Warning: ${message}`;
        if (details) {
            const lines = Object.entries(details)
                .filter(([_, v]) => v !== undefined && v !== null)
                .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                .join('\n');
            if (lines)
                body += `\n${lines}`;
        }
        console.warn(`${header}\n${body}`);
    }
}
