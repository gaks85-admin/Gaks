const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const target = `      if (data && data.length > 0) {
        const mapped: WatchlistItem[] = data.map((item: any) => ({`;

const replacement = `      console.log(\`[Watchlist Debug] Refetched watcher count from DB: \${data ? data.length : 0}\`);
      if (data && data.length > 0) {
        const mapped: WatchlistItem[] = data.map((item: any) => ({`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync('src/App.tsx', content);
  console.log("Success");
} else {
  console.log("Target not found");
}
