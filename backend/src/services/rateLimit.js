const { increment } = require('./cache');

async function checkRateLimit({ key, limit = 60, windowSeconds = 60 }) {
  const bucketKey = `rate:${key}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
  const count = await increment(bucketKey);
  return { allowed: count <= limit, count, limit, windowSeconds };
}

module.exports = { checkRateLimit };
