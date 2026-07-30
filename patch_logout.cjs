const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const target = `      } else {
        setSession(null);
        setUserProfile(null);
        setTelegramConnection(null);
        setTelegramSuccessMessage(null);
        setTelegramErrorMessage(null);
      }`;

const replacement = `      } else {
        setSession(null);
        setUserProfile(null);
        setTelegramConnection(null);
        setTelegramSuccessMessage(null);
        setTelegramErrorMessage(null);
        setWatchlist([]);
        localStorage.removeItem('gaks_watchlist');
      }`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync('src/App.tsx', content);
  console.log("Success");
} else {
  console.log("Target not found");
}
