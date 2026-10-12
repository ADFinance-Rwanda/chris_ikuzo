const test = require('node:test');
const assert = require('node:assert/strict');

if (process.env.TEST_REDIS_URL) {
  process.env.REDIS_URL = process.env.TEST_REDIS_URL;
}
const { checkRateLimit } = require('../src/services/rateLimit');
const { getClient } = require('../src/services/cache');

test('Redis rate limiter atomically counts and rejects requests over limit', {
  skip: !process.env.TEST_REDIS_URL
}, async () => {
  const key = `integration-test-${Date.now()}-${Math.random()}`;
  const first = await checkRateLimit({ key, limit: 2, windowSeconds: 10 });
  const second = await checkRateLimit({ key, limit: 2, windowSeconds: 10 });
  const third = await checkRateLimit({ key, limit: 2, windowSeconds: 10 });
  assert.deepEqual([first.count, second.count, third.count], [1, 2, 3]);
  assert.deepEqual([first.allowed, second.allowed, third.allowed], [true, true, false]);
  await getClient().del(`rate:${key}:${Math.floor(Date.now() / 10000)}`);
  await getClient().quit();
});
