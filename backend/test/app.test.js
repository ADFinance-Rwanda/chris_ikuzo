const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/index');

const server = app.listen(0);

async function request(path, options) {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, options);
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json()
  };
}

test('health endpoint is a dependency-independent liveness check', async () => {
  const result = await request('/health');
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'ok');
  assert.ok(result.headers.get('x-request-id'));
});

test('protected task requests reject missing bearer tokens before database access', async () => {
  const result = await request('/api/tasks');
  assert.equal(result.status, 401);
  assert.equal(result.body.error, 'Missing bearer token');
});

test('unknown endpoints return a stable JSON error', async () => {
  const result = await request('/missing');
  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'NOT_FOUND');
  await new Promise((resolve) => server.close(resolve));
});
