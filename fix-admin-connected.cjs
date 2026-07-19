const fs = require('fs');

let content = fs.readFileSync('api/admin.ts', 'utf8');

content = content.replace(/geminiStatus = geminiReturnedText === 'OK' \? 'ONLINE' : 'ERROR';/g, "geminiStatus = geminiReturnedText === 'OK' ? 'Connected' : 'ERROR';");

fs.writeFileSync('api/admin.ts', content);
