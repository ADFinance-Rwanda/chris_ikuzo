const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/index');

const server = app.listen(0);

async function getHealth() {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  return { status: response.status, body: await response.json() };
}

test('health endpoint returns a status payload', async () => {
  const result = await getHealth();
  assert.equal(result.status, 200);
  assert.ok(['ok', 'degraded'].includes(result.body.status));
  await new Promise((resolve) => server.close(resolve));
});
