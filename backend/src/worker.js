const { withTransaction, pool } = require('./services/db');

const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS || 1000);
const maxAttempts = 5;

async function processOneJob() {
  const job = await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE background_jobs
       SET status = 'processing', attempts = attempts + 1, locked_at = NOW()
       WHERE id = (
         SELECT id FROM background_jobs
         WHERE (status = 'pending' AND run_at <= NOW())
            OR (status = 'processing' AND locked_at < NOW() - INTERVAL '5 minutes')
         ORDER BY run_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING *`
    );
    return result.rows[0] || null;
  });
  if (!job) return false;

  try {
    await withTransaction(async (client) => {
      if (job.job_type === 'TASK_CREATED_NOTIFICATION') {
        await client.query(
          `INSERT INTO notification_deliveries (job_id, organization_id, payload)
           VALUES ($1, $2, $3::jsonb) ON CONFLICT (job_id) DO NOTHING`,
          [job.id, job.organization_id, JSON.stringify(job.payload)]
        );
      } else if (job.job_type === 'DASHBOARD_REFRESH') {
        await client.query('SELECT COUNT(*) FROM tasks WHERE organization_id = $1', [job.organization_id]);
      } else {
        throw new Error(`Unsupported job type: ${job.job_type}`);
      }
      await client.query(
        `UPDATE background_jobs SET status = 'complete', completed_at = NOW(),
         locked_at = NULL, last_error = NULL WHERE id = $1`,
        [job.id]
      );
    });
    console.log(JSON.stringify({ level: 'info', event: 'job.complete', job_id: job.id, type: job.job_type, attempt: job.attempts }));
  } catch (error) {
    const terminal = job.attempts >= maxAttempts;
    const delaySeconds = Math.min(300, 5 * (2 ** (job.attempts - 1)));
    await withTransaction((client) => client.query(
      `UPDATE background_jobs
       SET status = $2,
           run_at = CASE WHEN $2 = 'pending' THEN NOW() + ($3 * INTERVAL '1 second') ELSE run_at END,
           locked_at = NULL,
           last_error = $4
       WHERE id = $1`,
      [job.id, terminal ? 'dead' : 'pending', delaySeconds, error.message.slice(0, 1000)]
    ));
    console.error(JSON.stringify({
      level: terminal ? 'error' : 'warn',
      event: terminal ? 'job.dead' : 'job.retry',
      job_id: job.id,
      type: job.job_type,
      attempt: job.attempts,
      error: error.message
    }));
  }
  return true;
}

async function run() {
  console.log('Background worker started');
  while (true) {
    try {
      if (!await processOneJob()) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    } catch (error) {
      console.error('Worker poll failed:', error.message);
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
}

if (require.main === module) {
  run().catch(async (error) => {
    console.error('Worker stopped:', error.message);
    await pool.end();
    process.exitCode = 1;
  });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
      await pool.end();
      process.exit(0);
    });
  }
}

module.exports = { processOneJob };
