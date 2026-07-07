const https = require('https');

const host = 'ais-dev-q2ths52sprlvvot4gaq4np-575365946474.europe-west1.run.app';
const endpoints = [
  { url: '/api/admin/stats', method: 'GET' }
];

async function testEndpoint(ep) {
  return new Promise((resolve) => {
    const data = ep.body ? JSON.stringify(ep.body) : '';
    const req = https.request({
      hostname: host,
      path: ep.url,
      method: ep.method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer dummy-token',
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
          headers: res.headers,
          body: body
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        url: ep.url,
        method: ep.method,
        statusCode: 0,
        headers: {},
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
  const result = await testEndpoint(endpoints[0]);
  console.log(`Endpoint: ${result.method} ${result.url}`);
  console.log(`Status Code: ${result.statusCode}`);
  console.log(`Headers:`, JSON.stringify(result.headers, null, 2));
  console.log(`Raw Body (first 300 chars): ${result.body.substring(0, 300)}`);
}

run();
