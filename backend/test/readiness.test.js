const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/index');

const server = app.listen(0);

async function getJson(path) {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
  return { status: response.status, body: await response.json() };
}

test('ready endpoint declares service readiness based on dependency health', async () => {
  const result = await getJson('/ready');
  assert.equal(result.status, 503);
  assert.equal(result.body.status, 'not ready');
  assert.ok(['unavailable', 'PONG'].includes(result.body.redis));
  await new Promise((resolve) => server.close(resolve));
});
