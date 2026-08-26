import watcherStartHandler from '../src/lib/watcher-handlers/start.js';
import watcherStopHandler from '../src/lib/watcher-handlers/stop.js';
import watcherScanHandler from '../src/lib/watcher-handlers/scan.js';
import watcherResolveTradeHandler from '../src/lib/watcher-handlers/resolve-trade.js';
import watcherReplayHandler from '../src/lib/watcher-handlers/replay.js';

export default async function handler(req: any, res: any) {
  // CORS configuration
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const urlPath = req.url || req.path || '';

  if (urlPath.includes('/start') || urlPath.includes('/activate')) {
    return watcherStartHandler(req, res);
  }
  if (urlPath.includes('/stop')) {
    return watcherStopHandler(req, res);
  }
  if (urlPath.includes('/scan')) {
    return watcherScanHandler(req, res);
  }
  if (urlPath.includes('/resolve-trade')) {
    return watcherResolveTradeHandler(req, res);
  }
  if (urlPath.includes('/replay')) {
    return watcherReplayHandler(req, res);
  }
  if (urlPath.includes('/test-rule-consistency')) {
    try {
      const { runRulePipelineConsistencyTestSuite } = await import('../src/lib/rule-pipeline-consistency-test-suite.js');
      const results = runRulePipelineConsistencyTestSuite();
      const allPassed = results.every((r: any) => r.passed);
      return res.json({
        success: allPassed,
        total: results.length,
        passedCount: results.filter((r: any) => r.passed).length,
        results
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(404).json({ success: false, error: `Watcher sub-route not found: ${urlPath}` });
}
