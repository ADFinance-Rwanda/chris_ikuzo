const { query } = require('./db');
const { get, set, getClient, connect } = require('./cache');

async function getDashboard({ organizationId, userId, isMember }) {
  const scopeKey = isMember ? `user:${userId}` : 'organization';
  const cacheKey = `dashboard:${organizationId}:${scopeKey}`;
  const cached = await get(cacheKey);
  if (cached) return cached;

  const params = [organizationId];
  const memberClause = isMember ? ' AND (assignee_id = $2 OR created_by = $2)' : '';
  if (isMember) params.push(userId);
  const taskFilter = `organization_id = $1${memberClause}`;

  const [statusRows, priorityRows, summary, trends, projectCount] = await Promise.all([
    query(`SELECT status, COUNT(*)::int AS count FROM tasks WHERE ${taskFilter} GROUP BY status`, params),
    query(`SELECT priority, COUNT(*)::int AS count FROM tasks WHERE ${taskFilter} GROUP BY priority`, params),
    query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'DONE')::int AS completed,
              COUNT(*) FILTER (WHERE status <> 'DONE')::int AS pending,
              COUNT(*) FILTER (WHERE status <> 'DONE' AND due_date < NOW())::int AS overdue,
              CASE WHEN COUNT(*) = 0 THEN 0
                ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'DONE') / COUNT(*), 1)
              END AS completion_rate
       FROM tasks WHERE ${taskFilter}`,
      params
    ),
    query(
      `SELECT day::date AS date,
              COALESCE(created_count, 0)::int AS created,
              COALESCE(completed_count, 0)::int AS completed
       FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day') AS days(day)
       LEFT JOIN (
         SELECT created_at::date AS date, COUNT(*) AS created_count
         FROM tasks WHERE ${taskFilter} AND created_at >= CURRENT_DATE - INTERVAL '29 days'
         GROUP BY created_at::date
       ) created ON created.date = day::date
       LEFT JOIN (
         SELECT completed_at::date AS date, COUNT(*) AS completed_count
         FROM tasks WHERE ${taskFilter} AND completed_at >= CURRENT_DATE - INTERVAL '29 days'
         GROUP BY completed_at::date
       ) completed ON completed.date = day::date
       ORDER BY date`,
      params
    ),
    query('SELECT COUNT(*)::int AS total FROM projects WHERE organization_id = $1', [organizationId])
  ]);

  const byStatus = Object.fromEntries(['TODO', 'IN_PROGRESS', 'DONE'].map((key) => [key, 0]));
  const byPriority = Object.fromEntries(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((key) => [key, 0]));
  for (const row of statusRows.rows) byStatus[row.status] = row.count;
  for (const row of priorityRows.rows) byPriority[row.priority] = row.count;

  const dashboard = {
    projects: projectCount.rows[0].total,
    tasks: summary.rows[0],
    by_status: byStatus,
    by_priority: byPriority,
    daily_trend: trends.rows.map((row) => ({
      date: new Date(row.date).toISOString().slice(0, 10),
      created: row.created,
      completed: row.completed
    }))
  };
  await set(cacheKey, dashboard, 60);
  return dashboard;
}

async function invalidateDashboard(organizationId) {
  try {
    const client = await connect();
    const keys = getClient().scanIterator({ MATCH: `dashboard:${organizationId}:*`, COUNT: 100 });
    for await (const key of keys) await getClient().del(key);
  } catch (error) {
    console.warn('Dashboard cache invalidation failed; cached data expires within 60 seconds:', error.message);
  }
}

async function addDashboardRequest({ organizationId, userId }) {
  const result = await query(
    `INSERT INTO background_jobs (organization_id, job_type, payload, idempotency_key)
     VALUES ($1, 'DASHBOARD_REFRESH', $2::jsonb, $3)
     ON CONFLICT (organization_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [
      organizationId,
      JSON.stringify({ requested_by: userId }),
      `dashboard-refresh:${userId}:${Math.floor(Date.now() / 60000)}`
    ]
  );
  return result.rowCount > 0;
}

module.exports = { getDashboard, invalidateDashboard, addDashboardRequest };
