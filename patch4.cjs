const fs = require('fs');

let code = fs.readFileSync('api/cron/market-watcher.ts', 'utf8');

const oldLogic = `        // Fetch live market data from Twelve Data
        const symbol = selectedPair;
        const url = \`https://api.twelvedata.com/quote?symbol=\\$\\{encodeURIComponent(symbol)\\}&apikey=\\$\\{twelveDataKey\\}\`;
        console.log(\`[TwelveData Request] Method: GET, URL: https://api.twelvedata.com/quote?symbol=\\$\\{encodeURIComponent(symbol)\\}\`);
        console.log(\`[User \\$\\{userId\\}] Requesting TwelveData: https://api.twelvedata.com/quote?symbol=\\$\\{encodeURIComponent(symbol)\\}\`);
        const tdRes = await fetch(url);`;

const newLogic = `        // Map common app symbols to Twelve Data format
        let mappedSymbol = selectedPair;
        if (mappedSymbol === 'NAS100') {
          mappedSymbol = 'IXIC';
        } else if (mappedSymbol === 'US30') {
          mappedSymbol = 'DJI';
        } else if (mappedSymbol === 'SPX500' || mappedSymbol === 'US500') {
          mappedSymbol = 'SPX';
        } else if (mappedSymbol.endsWith('USD') && mappedSymbol.length > 3 && !mappedSymbol.includes('/')) {
          mappedSymbol = mappedSymbol.slice(0, -3) + '/USD';
        } else if (mappedSymbol.endsWith('JPY') && mappedSymbol.length > 3 && !mappedSymbol.includes('/')) {
          mappedSymbol = mappedSymbol.slice(0, -3) + '/JPY';
        } else if (mappedSymbol.endsWith('EUR') && mappedSymbol.length > 3 && !mappedSymbol.includes('/')) {
          mappedSymbol = mappedSymbol.slice(0, -3) + '/EUR';
        } else if (mappedSymbol.endsWith('GBP') && mappedSymbol.length > 3 && !mappedSymbol.includes('/')) {
          mappedSymbol = mappedSymbol.slice(0, -3) + '/GBP';
        }

        const url = \`https://api.twelvedata.com/quote?symbol=\\$\\{encodeURIComponent(mappedSymbol)\\}&apikey=\\$\\{twelveDataKey\\}\`;
        console.log(\`[Twelve Data API] GET https://api.twelvedata.com/quote?symbol=\\$\\{encodeURIComponent(mappedSymbol)\\}\`);
        
        const tdRes = await fetch(url);`;

code = code.replace(oldLogic, newLogic);
fs.writeFileSync('api/cron/market-watcher.ts', code);
