const { getClient, connect } = require('./cache');

const incrementAndExpire = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

async function checkRateLimit({ key, limit = 60, windowSeconds = 60 }) {
  const bucketKey = `rate:${key}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
  const client = await connect();
  if (!client.isReady) {
    throw new Error('Rate limit store unavailable');
  }
  const count = Number(await getClient().eval(incrementAndExpire, {
    keys: [bucketKey],
    arguments: [String(windowSeconds * 2)]
  }));
  return { allowed: count <= limit, count, limit, windowSeconds };
}

module.exports = { checkRateLimit };
