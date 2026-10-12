const redis = require('redis');
const config = require('../config');

let client;

function getClient() {
  if (!client) {
    client = redis.createClient({
      url: config.redisUrl,
      socket: {
        reconnectStrategy: false,
        connectTimeout: 1000,
        lazyConnect: true
      }
    });
    client.on('error', (error) => {
      console.error('Redis client error:', error.message);
    });
  }
  return client;
}

async function connect() {
  const redisClient = getClient();
  if (!redisClient.isOpen) await redisClient.connect();
  return redisClient;
}

async function ping() {
  try {
    return await (await connect()).ping();
  } catch {
    return 'unavailable';
  }
}

async function get(key) {
  try {
    const value = await (await connect()).get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.warn('Redis cache read failed:', error.message);
    return null;
  }
}

async function set(key, value, expirySeconds) {
  try {
    const client = await connect();
    const serialized = JSON.stringify(value);
    if (expirySeconds) {
      await client.set(key, serialized, { EX: expirySeconds });
    } else {
      await client.set(key, serialized);
    }
    return true;
  } catch (error) {
    console.warn('Redis cache write failed:', error.message);
    return false;
  }
}

module.exports = { getClient, connect, ping, get, set };
