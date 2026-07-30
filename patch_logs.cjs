const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// We want to wrap setWatchlist to log the changes
// But we can just add logs before setWatchlist calls

content = content.replace(
  `setWatchlist(mapped);`,
  `console.log(\`[Watchlist Debug] WATCHERS UPDATED\\nPrevious: \${watchlist.length}\\nCurrent: \${mapped.length}\\nReason: API LOAD\`);
        setWatchlist(mapped);`
);

content = content.replace(
  `setWatchlist([]);
        localStorage.removeItem('gaks_watchlist');`,
  `console.log(\`[Watchlist Debug] WATCHERS UPDATED\\nPrevious: \${watchlist.length}\\nCurrent: 0\\nReason: API EMPTY\`);
        // setWatchlist([]);
        // localStorage.removeItem('gaks_watchlist');`
);

content = content.replace(
  `setWatchlist([]);
    localStorage.removeItem('gaks_watchlist');
    triggerNotification("AI Market Watcher stopped.", "info");`,
  `console.log(\`[Watchlist Debug] WATCHERS UPDATED\\nPrevious: \${watchlist.length}\\nCurrent: 0\\nReason: STOP\`);
    setWatchlist([]);
    localStorage.removeItem('gaks_watchlist');
    triggerNotification("AI Market Watcher stopped.", "info");`
);

fs.writeFileSync('src/App.tsx', content);
console.log("Success");
