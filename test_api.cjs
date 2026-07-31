const http = require('http');

const data = JSON.stringify({
  userId: 'test_user_123',
  selectedPair: 'BTC/USD',
  selectedTimeframe: 'H1'
});

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/watcher/start',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => console.log('Response:', body));
});

req.on('error', e => console.error('Error:', e));
req.write(data);
req.end();
