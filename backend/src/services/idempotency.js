const { get, set } = require('./cache');

async function getIdempotencyRecord({ organizationId, key }) {
  if (!key) return null;
  return get(`idempotency:${organizationId}:${key}`);
}

async function storeIdempotencyRecord({ organizationId, key, response, ttlSeconds = 86400 }) {
  if (!key) return null;
  await set(`idempotency:${organizationId}:${key}`, response, ttlSeconds);
  return response;
}

module.exports = { getIdempotencyRecord, storeIdempotencyRecord };
