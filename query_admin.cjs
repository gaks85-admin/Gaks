const http = require('http');

const endpoints = [
  { url: '/api/admin/stats', method: 'GET' },
  { url: '/api/admin/users', method: 'GET' },
  { url: '/api/admin/users/action', method: 'POST', body: { userId: 'test', action: 'pause' } },
  { url: '/api/admin/watchers', method: 'GET' },
  { url: '/api/admin/watchers/action', method: 'POST', body: { watcherId: 'test', action: 'restart' } },
  { url: '/api/admin/signals', method: 'GET' },
  { url: '/api/admin/health', method: 'GET' },
  { url: '/api/admin/settings', method: 'GET' },
  { url: '/api/admin/settings', method: 'POST', body: { settings: {} } }
];

async function testEndpoint(ep) {
  return new Promise((resolve) => {
    const data = ep.body ? JSON.stringify(ep.body) : '';
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path: ep.url,
      method: ep.method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer dummy-token', // Dummy token for route testing (should trigger 401 JSON instead of HTML if route exists)
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        resolve({
          url: ep.url,
          method: ep.method,
          statusCode: res.statusCode,
          contentType: res.headers['content-type'],
          body: body
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        url: ep.url,
        method: ep.method,
        statusCode: 0,
        contentType: 'none',
        body: err.message
      });
    });

    if (data) {
      req.write(data);
    }
    req.end();
  });
}

async function run() {
  console.log('--- Testing Local Admin API Endpoints ---');
  for (const ep of endpoints) {
    const result = await testEndpoint(ep);
    console.log(`\nEndpoint: ${result.method} ${result.url}`);
    console.log(`Status Code: ${result.statusCode}`);
    console.log(`Content-Type: ${result.contentType}`);
    console.log(`Raw Body (first 300 chars): ${result.body.substring(0, 300)}`);
  }
}

run();
