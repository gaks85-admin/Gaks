const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const target = `        console.log(\`[Watchlist Debug] WATCHERS UPDATED\\nPrevious: \${watchlist.length}\\nCurrent: \${mapped.length}\\nReason: API LOAD\`);
        setWatchlist(mapped);
        localStorage.setItem('gaks_watchlist', JSON.stringify(mapped));
      } else {
        console.log(\`[Watchlist Debug] WATCHERS UPDATED\\nPrevious: \${watchlist.length}\\nCurrent: 0\\nReason: API EMPTY\`);
        // setWatchlist([]);
        // localStorage.removeItem('gaks_watchlist');
      }`;

const replacement = `        setWatchlist(prev => {
          const nextList = [...prev];
          mapped.forEach(incoming => {
             const existingIdx = nextList.findIndex(w => w.symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === incoming.symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase());
             if (existingIdx >= 0) {
                // Update existing, preserving live price/change which loadWatchlistFromSupabase resets to 0
                nextList[existingIdx] = { 
                  ...nextList[existingIdx], 
                  timeframe: incoming.timeframe,
                  name: incoming.name
                };
             } else {
                nextList.push(incoming);
             }
          });
          console.log(\`[Watchlist Debug] WATCHERS UPDATED\\nPrevious: \${prev.length}\\nCurrent: \${nextList.length}\\nReason: API LOAD MERGE\`);
          localStorage.setItem('gaks_watchlist', JSON.stringify(nextList));
          return nextList;
        });
      } else {
        console.log(\`[Watchlist Debug] API returned empty for watchers. Relying on loadWatcherStatus for cleanup.\`);
      }`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync('src/App.tsx', content);
  console.log("Success");
} else {
  console.log("Target not found");
}
