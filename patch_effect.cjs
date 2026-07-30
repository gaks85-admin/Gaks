const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const target = `  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);`;

const replacement = `  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);

  useEffect(() => {
    console.log(\`[Watchlist Debug] Final rendered watcher count: \${watchlist.length}\`);
  }, [watchlist.length]);`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync('src/App.tsx', content);
  console.log("Success");
} else {
  console.log("Target not found");
}
