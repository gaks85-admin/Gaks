const fs = require('fs');

let content = fs.readFileSync('api/debug/gemini.ts', 'utf8');

content = content.replace(/googleApiKeyExists,/g, "googleApiKeyExists,\n        geminiApiKeyExists,\n        apiKeyPresent: googleApiKeyExists || geminiApiKeyExists,");

fs.writeFileSync('api/debug/gemini.ts', content);
