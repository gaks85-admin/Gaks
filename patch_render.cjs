const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const target = `{(watchlist || []).length === 0 || !isWatcherActive ? (`;
const replacement = `{(watchlist || []).length === 0 ? (`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync('src/App.tsx', content);
  console.log("Success");
} else {
  console.log("Target not found");
}
