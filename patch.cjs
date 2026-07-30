const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const target = `    setWatchlist(prev => {
      let updatedWatchlist;
      if (isAdmin) {
        if (prev.some(w => normalizeSymbol(w.symbol) === normalizeSymbol(cleanSymbol))) {
          updatedWatchlist = prev.map(w => normalizeSymbol(w.symbol) === normalizeSymbol(cleanSymbol) ? { ...w, timeframe: timeframeToWatch } : w);
        } else {
          updatedWatchlist = [...prev, newPair];
        }
      } else {
        updatedWatchlist = [newPair];
      }
      localStorage.setItem('gaks_watchlist', JSON.stringify(updatedWatchlist));
      return updatedWatchlist;
    });

    setWatcherSearch(cleanSymbol);
      
    if (session?.user) {
      if (isAdmin) {
        // No-op for now, adding logic for admin multiple watchers if needed
      } else {
        // User is not admin, they only have one watcher. The startAiMarketWatcher handles upsert.
      }
    }
      
    triggerNotification(\`\${cleanSymbol} added to watchlist!\`);
  };`;

const replacement = `    setWatchlist(prev => {
      let updatedWatchlist;
      if (prev.some(w => normalizeSymbol(w.symbol) === normalizeSymbol(cleanSymbol))) {
        updatedWatchlist = prev.map(w => normalizeSymbol(w.symbol) === normalizeSymbol(cleanSymbol) ? { ...w, timeframe: timeframeToWatch } : w);
      } else {
        updatedWatchlist = [...prev, newPair];
      }
      localStorage.setItem('gaks_watchlist', JSON.stringify(updatedWatchlist));
      return updatedWatchlist;
    });

    setWatcherSearch(cleanSymbol);
      
    if (session?.user) {
      console.log(\`[Watchlist Debug] Watchers before insert: \${watchlist.length}\`);
      
      const doStartWatcher = async () => {
        try {
          const response = await fetch('/api/watcher/start', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': \`Bearer \${session.access_token || ''}\`
            },
            body: JSON.stringify({
              userId: session.user.id,
              selectedPair: cleanSymbol,
              selectedTimeframe: timeframeToWatch
            })
          });
          
          console.log(\`[Watchlist Debug] Insert response status: \${response.status}\`);
          
          // Immediate refetch from DB so the UI always reflects what the DB actually stored
          await loadWatchlistFromSupabase(session.user.id);
          
          console.log(\`[Watchlist Debug] Final rendered watcher count loaded from Supabase.\`);
        } catch (err) {
          console.error("Error creating watcher in handleAddPair:", err);
        }
      };
      
      doStartWatcher();
    }
      
    triggerNotification(\`\${cleanSymbol} added to watchlist!\`);
  };`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync('src/App.tsx', content);
  console.log("Success");
} else {
  console.log("Target not found");
}
