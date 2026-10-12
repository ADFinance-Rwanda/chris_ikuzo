const { spawnSync } = require('node:child_process');
const path = require('node:path');

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('Set TEST_DATABASE_URL to a disposable PostgreSQL database before running integration tests.');
  }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { migrate } = require('./migrate');
  const { pool } = require('../backend/src/services/db');
  await migrate();
  await pool.end();

  const result = spawnSync(process.execPath, ['--test', 'test/integration.test.js', 'test/api.integration.test.js'], {
    cwd: path.resolve(__dirname, '../backend'),
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  process.exitCode = result.status || 0;
}

main().catch((error) => {
  console.error('Integration test setup failed:', error.message);
  process.exitCode = 1;
});
