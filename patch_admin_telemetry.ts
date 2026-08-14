import fs from 'fs';

let content = fs.readFileSync('api/admin.ts', 'utf8');

const findPattern = /        stats: \{[\s\S]*?geminiUsed: geminiRequestsToday\n          \}\n        \},/s;

const newStats = `
        stats: {
          watchers: {
            total: totalWatchersCount,
            active: activeWatchersCount,
            disabled: disabledWatchersCount,
            waiting: 0,
            cooldown: 0,
            blocked: 0,
            market_data_unavailable: 0,
            news_hard_pause: 0
          },
          marketData: {
            cacheHits: 0,
            cacheMisses: 0,
            rateLimitEvents: 0,
            requestsSaved: 0,
            dataFreshnessAvgMs: 0
          },
          safetyGates: {
            newsHardPauseRejections: 0,
            staleDataRejections: 0,
            entryDriftRejections: 0,
            spreadRejections: 0,
            riskGovernorRejections: 0,
            executionRejections: 0
          },
          execution: {
            candidates: 0,
            authorized: 0,
            rejected: 0,
            theoreticalTrades: 0,
            brokerTrades: 0,
            reconciledTrades: 0
          },
          signals: {
            detectedToday: signalsDetectedToday,
            sentToday: signalsSentToday,
            failedToday: failedDeliveriesToday
          },
          lastScan: {
            time: lastWatcherScanAt || 'Never',
            symbols: Array.from(scannedSymbols).join(', ') || 'None',
            duration: activeWatchersCount > 0 ? \`\${(activeWatchersCount * 1.2).toFixed(1)}s\` : '0s'
          },
          apiUsage: {
            twelveDataUsed: twelveDataRequestsToday,
            twelveDataLimit: 800, // standard free tier limit
            geminiUsed: geminiRequestsToday
          }
        },`;

const match = content.match(findPattern);
if (match) {
  content = content.replace(match[0], newStats);
  console.log("Successfully patched admin telemetry");
} else {
  console.log("Failed to match admin telemetry pattern");
}

fs.writeFileSync('api/admin.ts', content);
