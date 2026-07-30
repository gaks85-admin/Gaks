const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const target = `      setIsWatcherActive(true);
      setWatcherErrorMessage(null);
      triggerNotification(result.message || "AI Market Watcher activated successfully!", "success");

      // Refresh source of truth from Supabase instead of just mocking locally
      await loadWatchlistFromSupabase(session.user.id);`;

const replacement = `      setIsWatcherActive(true);
      setWatcherErrorMessage(null);
      triggerNotification(result.message || "AI Market Watcher activated successfully!", "success");

      // Optimistic update to guarantee visibility
      const cleanTarget = normalizeSymbol(targetSymbol);
      setWatchlist(prev => {
        const nextList = [...prev];
        const existingIdx = nextList.findIndex(w => w.symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === cleanTarget.replace(/[^a-zA-Z0-9]/g, '').toUpperCase());
        if (existingIdx >= 0) {
           nextList[existingIdx] = { ...nextList[existingIdx], timeframe: targetTimeframe };
        } else {
           nextList.push({
             symbol: cleanTarget,
             name: getFullNameForSymbol(cleanTarget),
             price: 0,
             change: 0,
             spread: 0,
             volatility: 'Medium',
             confidence: 0,
             direction: 'Neutral',
             history: [0,0,0,0,0,0,0],
             timeframe: targetTimeframe,
             status: 'active'
           });
        }
        localStorage.setItem('gaks_watchlist', JSON.stringify(nextList));
        return nextList;
      });

      // Refresh source of truth from Supabase instead of just mocking locally
      await loadWatchlistFromSupabase(session.user.id);`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync('src/App.tsx', content);
  console.log("Success");
} else {
  console.log("Target not found");
}
