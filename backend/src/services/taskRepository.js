const { createHash } = require('node:crypto');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('./db');
const { insertAuditLog } = require('./audit');

const editableColumns = {
  project_id: 'project_id',
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  assignee_id: 'assignee_id',
  due_date: 'due_date'
};

function normalizeTask(task) {
  if (!task) return null;
  return {
    ...task,
    id: String(task.id),
    organization_id: String(task.organization_id),
    project_id: String(task.project_id),
    assignee_id: task.assignee_id ? String(task.assignee_id) : null,
    version: Number(task.version),
    created_at: new Date(task.created_at).toISOString(),
    updated_at: new Date(task.updated_at).toISOString()
  };
}

async function listTasks({
  organizationId,
  page,
  limit,
  status,
  projectId,
  priority,
  assigneeId,
  dueAfter,
  dueBefore,
  search,
  memberId
}) {
  const params = [organizationId];
  const clauses = ['organization_id = $1'];
  let index = 2;

  if (memberId) {
    clauses.push(`(assignee_id = $${index} OR created_by = $${index})`);
    params.push(memberId);
    index += 1;
  }
  for (const [field, value] of Object.entries({
    status,
    project_id: projectId,
    priority,
    assignee_id: assigneeId
  })) {
    if (value === undefined) continue;
    clauses.push(`${field} = $${index++}`);
    params.push(value);
  }
  if (dueAfter) {
    clauses.push(`due_date >= $${index++}`);
    params.push(dueAfter);
  }
  if (dueBefore) {
    clauses.push(`due_date <= $${index++}`);
    params.push(dueBefore);
  }
  if (search) {
    clauses.push(`(title ILIKE $${index} OR description ILIKE $${index})`);
    params.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    index += 1;
  }

  const where = clauses.join(' AND ');
  const [count, rows] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total FROM tasks WHERE ${where}`, params),
    query(
      `SELECT * FROM tasks WHERE ${where} ORDER BY updated_at DESC, id LIMIT $${index} OFFSET $${index + 1}`,
      [...params, limit, (page - 1) * limit]
    )
  ]);
  return { rows: rows.rows.map(normalizeTask), total: count.rows[0].total };
}

async function getTask(organizationId, taskId, memberId) {
  const memberClause = memberId ? ' AND (assignee_id = $3 OR created_by = $3)' : '';
  const result = await query(
    `SELECT * FROM tasks WHERE organization_id = $1 AND id = $2${memberClause}`,
    memberId ? [organizationId, taskId, memberId] : [organizationId, taskId]
  );
  return normalizeTask(result.rows[0]);
}

function requestHash(data) {
  const { idempotency_key, ...payload } = data;
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function createTask({ organizationId, data, userId }) {
  const hash = requestHash(data);
  return withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO tasks (
        id, organization_id, project_id, title, description, status, priority,
        assignee_id, due_date, version, idempotency_key, idempotency_hash,
        created_by, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $11, $12,
        CASE WHEN $6 = 'DONE' THEN NOW() ELSE NULL END)
      ON CONFLICT (organization_id, idempotency_key) DO NOTHING
      RETURNING *`,
      [
        uuidv4(), organizationId, data.project_id, data.title, data.description,
        data.status, data.priority, data.assignee_id, data.due_date,
        data.idempotency_key || null, data.idempotency_key ? hash : null, userId
      ]
    );

    if (!result.rows[0] && data.idempotency_key) {
      const existing = await client.query(
        'SELECT * FROM tasks WHERE organization_id = $1 AND idempotency_key = $2',
        [organizationId, data.idempotency_key]
      );
      if (!existing.rows[0]) throw new Error('Idempotency conflict could not be resolved');
      return {
        task: normalizeTask(existing.rows[0]),
        duplicate: true,
        conflict: existing.rows[0].idempotency_hash !== hash
      };
    }
    if (!result.rows[0]) throw new Error('Task insert returned no row');

    const task = normalizeTask(result.rows[0]);
    await client.query(
      `INSERT INTO background_jobs (organization_id, job_type, payload, idempotency_key)
       VALUES ($1, 'TASK_CREATED_NOTIFICATION', $2::jsonb, $3)`,
      [
        organizationId,
        JSON.stringify({ task_id: task.id, title: task.title, created_by: userId }),
        `task-created:${task.id}`
      ]
    );
    await insertAuditLog(client, {
      organizationId,
      userId,
      action: 'TASK_CREATED',
      entityType: 'task',
      entityId: task.id,
      metadata: { title: task.title }
    });
    return { task, duplicate: false, conflict: false };
  });
}

async function updateTask({ organizationId, taskId, payload, userId, memberOnly = false }) {
  const fields = Object.entries(editableColumns)
    .filter(([field]) => Object.hasOwn(payload, field));
  const assignments = fields.map(([, column], index) => `${column} = $${index + 6}`);
  const values = fields.map(([field]) => payload[field]);
  const statusIndex = fields.findIndex(([field]) => field === 'status');
  if (statusIndex >= 0) {
    assignments.push(`completed_at = CASE WHEN $${statusIndex + 6} = 'DONE'
      THEN COALESCE(completed_at, NOW()) ELSE NULL END`);
  }
  assignments.push('version = version + 1', 'updated_at = NOW()');

  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE tasks SET ${assignments.join(', ')}
       WHERE organization_id = $1 AND id = $2 AND version = $3
         AND (NOT $4::boolean OR assignee_id = $5 OR created_by = $5)
       RETURNING *`,
      [organizationId, taskId, payload.version, memberOnly, userId, ...values]
    );

    if (!result.rows[0]) {
      const exists = await client.query(
        `SELECT 1 FROM tasks WHERE organization_id = $1 AND id = $2
         AND (NOT $3::boolean OR assignee_id = $4 OR created_by = $4)`,
        [organizationId, taskId, memberOnly, userId]
      );
      return { found: exists.rowCount > 0, conflict: exists.rowCount > 0 };
    }

    const task = normalizeTask(result.rows[0]);
    await insertAuditLog(client, {
      organizationId,
      userId,
      action: 'TASK_UPDATED',
      entityType: 'task',
      entityId: task.id,
      metadata: { version: task.version }
    });
    return { found: true, conflict: false, task };
  });
}

async function deleteTask(organizationId, taskId, userId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      'DELETE FROM tasks WHERE organization_id = $1 AND id = $2 RETURNING *',
      [organizationId, taskId]
    );
    if (!result.rows[0]) return { found: false };
    const task = normalizeTask(result.rows[0]);
    await insertAuditLog(client, {
      organizationId,
      userId,
      action: 'TASK_DELETED',
      entityType: 'task',
      entityId: task.id,
      metadata: { version: task.version }
    });
    return { found: true, task };
  });
}

module.exports = { listTasks, getTask, createTask, updateTask, deleteTask };
