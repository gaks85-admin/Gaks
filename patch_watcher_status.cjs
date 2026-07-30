const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const target = `      if (data && data.length > 0) {
        // If any watcher is active, we consider the watcher service "active" for the UI badge
        const anyActive = data.some(w => w.status === 'active');
        setIsWatcherActive(anyActive);
        
        // Use the first active watcher to populate search/timeframe defaults
        const activeOne = data.find(w => w.status === 'active') || data[0];
        if (activeOne.selected_pair) setWatcherSearch(activeOne.selected_pair);
        if (activeOne.selected_timeframe) setWatcherTimeframe(activeOne.selected_timeframe);
        if (activeOne.trade_status) setWatcherTradeStatus(activeOne.trade_status);
        if (activeOne.last_scan_at) setWatcherLastScanAt(activeOne.last_scan_at);
        if (activeOne.last_analyzed_closed_candle_time) setWatcherLastCandle(activeOne.last_analyzed_closed_candle_time);
      } else {
        setIsWatcherActive(false);
      }`;

const replacement = `      if (data) {
        const anyActive = data.some(w => w.status === 'active');
        setIsWatcherActive(anyActive);
        
        // Sync watchlist with actual DB statuses to remove crons/server-stopped watchers
        // This avoids race conditions by ONLY removing if the DB explicitly says it's stopped/deleted.
        setWatchlist(prev => {
          if (!prev || prev.length === 0) return prev;
          const nextList = prev.filter(w => {
            const dbW = data.find(d => d.selected_pair && d.selected_pair.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === w.symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase());
            // If the DB explicitly says it's not active, remove it.
            // If it's missing entirely from the DB result (e.g. out-of-order race condition), KEEP IT.
            if (dbW && dbW.status !== 'active') return false;
            return true;
          });
          if (nextList.length !== prev.length) {
            if (nextList.length === 0) localStorage.removeItem('gaks_watchlist');
            else localStorage.setItem('gaks_watchlist', JSON.stringify(nextList));
          }
          return nextList;
        });
      }

      if (data && data.length > 0) {
        const activeOne = data.find(w => w.status === 'active') || data[0];
        if (activeOne.selected_pair) setWatcherSearch(activeOne.selected_pair);
        if (activeOne.selected_timeframe) setWatcherTimeframe(activeOne.selected_timeframe);
        if (activeOne.trade_status) setWatcherTradeStatus(activeOne.trade_status);
        if (activeOne.last_scan_at) setWatcherLastScanAt(activeOne.last_scan_at);
        if (activeOne.last_analyzed_closed_candle_time) setWatcherLastCandle(activeOne.last_analyzed_closed_candle_time);
      }`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync('src/App.tsx', content);
  console.log("Success");
} else {
  console.log("Target not found");
}
