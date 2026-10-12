const fs = require('node:fs/promises');
const path = require('node:path');
if (process.env.MIGRATION_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
}
const { pool } = require('../backend/src/services/db');

async function ensureRuntimeRole(client) {
  const username = process.env.RUNTIME_DB_USER;
  const password = process.env.RUNTIME_DB_PASSWORD;
  if (!username && !password) return;
  if (!username || !password || !/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(username)) {
    throw new Error('RUNTIME_DB_USER and RUNTIME_DB_PASSWORD must both be configured');
  }
  const existing = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [username]);
  const escapedPassword = password.replaceAll("'", "''");
  if (existing.rowCount) {
    await client.query(`ALTER ROLE "${username}" WITH LOGIN PASSWORD '${escapedPassword}'`);
  } else {
    await client.query(`CREATE ROLE "${username}" WITH LOGIN PASSWORD '${escapedPassword}'`);
  }
  const database = await client.query('SELECT current_database() AS name');
  const dbIdentifier = database.rows[0].name.replaceAll('"', '""');
  await client.query(`GRANT CONNECT ON DATABASE "${dbIdentifier}" TO "${username}"`);
}

async function migrate() {
  const directory = process.env.MIGRATIONS_DIR
    || path.resolve(__dirname, '../database/migrations');
  const files = (await fs.readdir(directory))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
  const client = await pool.connect();

  try {
    await ensureRuntimeRole(client);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    for (const file of files) {
      await client.query('BEGIN');
      try {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['schema-migrations']);
        const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
        if (!applied.rowCount) {
          await client.query(await fs.readFile(path.join(directory, file), 'utf8'));
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
          console.log(`Applied migration ${file}`);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    if (process.env.RUNTIME_DB_USER) {
      const username = process.env.RUNTIME_DB_USER;
      await client.query(`GRANT USAGE ON SCHEMA public TO "${username}"`);
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${username}"`);
      await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON task_audit_logs FROM "${username}"`);
      await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${username}"`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${username}"`);
    }
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrate().catch((error) => {
    console.error('Database migration failed:', error.message);
    process.exitCode = 1;
  }).finally(() => pool.end());
}

module.exports = { migrate };
