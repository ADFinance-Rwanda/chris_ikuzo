const redis = require('redis');
const config = require('../config');

let client;

function getClient() {
  if (!client) {
    client = redis.createClient({
      url: config.redisUrl,
      socket: {
        reconnectStrategy: false,
        connectTimeout: 250,
        lazyConnect: true
      }
    });
    client.on('error', (err) => {
      console.warn('Redis client error:', err.message || 'redis unavailable');
    });
  }
  return client;
}

async function connect() {
  const redisClient = getClient();
  if (!redisClient.isOpen) {
    try {
      await redisClient.connect();
    } catch (error) {
      return redisClient;
    }
  }
  return redisClient;
}

async function ping() {
  try {
    const redisClient = await connect();
    return await redisClient.ping();
  } catch (error) {
    return 'unavailable';
  }
}

async function get(key) {
  try {
    const redisClient = await connect();
    const value = await redisClient.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    return null;
  }
}

async function set(key, value, expirySeconds) {
  try {
    const redisClient = await connect();
    const serialized = JSON.stringify(value);
    if (expirySeconds) {
      await redisClient.set(key, serialized, { EX: expirySeconds });
      return;
    }
    await redisClient.set(key, serialized);
  } catch (error) {
    // graceful degradation
  }
}

async function increment(key) {
  try {
    const redisClient = await connect();
    return await redisClient.incr(key);
  } catch (error) {
    return 0;
  }
}

module.exports = { connect, ping, get, set, increment };
