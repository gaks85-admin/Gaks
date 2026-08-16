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

  return `[${eventName}]
User: ${email}
Watcher: ${watcherId}
Pair: ${pair}
Timeframe: ${timeframe}`;
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
