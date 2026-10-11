const { Client } = require('pg');
const config = require('../config');

let client;

function getClient() {
  if (!client) {
    client = new Client({ connectionString: config.databaseUrl });
  }
  return client;
}

async function connect() {
  const dbClient = getClient();
  if (!dbClient._connected) {
    await dbClient.connect();
  }
  return dbClient;
}

async function query(text, params = []) {
  const dbClient = await connect();
  return dbClient.query(text, params);
}

module.exports = { connect, query };
