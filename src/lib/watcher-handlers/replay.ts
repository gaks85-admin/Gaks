import { runWatcherDiagnosticReplay } from '../watcher-diagnostic-engine.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST or GET.' });
  }

  try {
    const params = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    const watcherId = params.watcher_id || params.watcherId;
    const pair = params.pair;
    const timeframe = params.timeframe;
    const historicalTimestamp = params.historical_timestamp || params.timestamp;
    const skipGemini = params.skipGemini === true || params.skip_gemini === 'true';

    if (!watcherId) {
      return res.status(400).json({
        error: 'Missing required parameter: watcher_id',
        usage: {
          endpoint: '/api/watcher/replay',
          method: 'POST',
          body: {
            watcher_id: 'string (required)',
            pair: 'string (optional, e.g. BTCUSD)',
            timeframe: 'string (optional, e.g. M5)',
            historical_timestamp: 'string or number (optional ISO date or epoch ms)',
            skipGemini: 'boolean (optional)'
          }
        }
      });
    }

    const report = await runWatcherDiagnosticReplay({
      watcherId: String(watcherId).trim(),
      pair: pair ? String(pair).trim().toUpperCase() : undefined,
      timeframe: timeframe ? String(timeframe).trim().toUpperCase() : undefined,
      historicalTimestamp: historicalTimestamp ? (isNaN(Number(historicalTimestamp)) ? historicalTimestamp : Number(historicalTimestamp)) : undefined,
      skipGemini
    });

    return res.status(200).json(report);

  } catch (err: any) {
    console.error('[API Watcher Replay Error]:', err);
    return res.status(500).json({
      error: 'Diagnostic replay execution failed',
      message: err.message || String(err)
    });
  }
}
