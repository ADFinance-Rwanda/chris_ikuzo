const { v4: uuidv4 } = require('uuid');
const { query } = require('./db');

const memoryStore = new Map();

function normalizeTask(task) {
  if (!task) return null;

  return {
    ...task,
    id: String(task.id),
    organization_id: String(task.organization_id),
    project_id: String(task.project_id),
    assignee_id: task.assignee_id ? String(task.assignee_id) : null,
    version: Number(task.version ?? 1),
    created_at: task.created_at || new Date().toISOString(),
    updated_at: task.updated_at || new Date().toISOString()
  };
}

function fallbackListTasks({ organizationId, page = 1, limit = 20, status, projectId, priority, assigneeId, search }) {
  const tasks = Array.from(memoryStore.values()).filter((task) => task.organization_id === organizationId);

  let filtered = tasks;
  if (status) filtered = filtered.filter((task) => task.status === status);
  if (projectId) filtered = filtered.filter((task) => task.project_id === projectId);
  if (priority) filtered = filtered.filter((task) => task.priority === priority);
  if (assigneeId) filtered = filtered.filter((task) => task.assignee_id === assigneeId);
  if (search) {
    const needle = search.toLowerCase();
    filtered = filtered.filter((task) => (
      task.title?.toLowerCase().includes(needle) ||
      task.description?.toLowerCase().includes(needle)
    ));
  }

  const total = filtered.length;
  const start = (Number(page) - 1) * Number(limit);
  const paged = filtered.slice(start, start + Number(limit));

  return { rows: paged.map(normalizeTask), total };
}

async function listTasks({ organizationId, page = 1, limit = 20, status, projectId, priority, assigneeId, search }) {
  const safeLimit = Number(limit) || 20;
  const safePage = Number(page) || 1;

  try {
    const params = [organizationId];
    const clauses = ['organization_id = $1'];
    let index = 2;

    if (status) {
      clauses.push(`status = $${index}`);
      params.push(status);
      index += 1;
    }
    if (projectId) {
      clauses.push(`project_id = $${index}`);
      params.push(projectId);
      index += 1;
    }
    if (priority) {
      clauses.push(`priority = $${index}`);
      params.push(priority);
      index += 1;
    }
    if (assigneeId) {
      clauses.push(`assignee_id = $${index}`);
      params.push(assigneeId);
      index += 1;
    }
    if (search) {
      clauses.push(`(LOWER(title) LIKE LOWER($${index}) OR LOWER(description) LIKE LOWER($${index + 1}))`);
      params.push(`%${search}%`, `%${search}%`);
      index += 2;
    }

    const where = clauses.join(' AND ');
    const totalResult = await query(`SELECT COUNT(*)::int AS total FROM tasks WHERE ${where}`, params);
    const rowsResult = await query(
      `SELECT * FROM tasks WHERE ${where} ORDER BY updated_at DESC LIMIT $${index} OFFSET $${index + 1}`,
      [...params, safeLimit, (safePage - 1) * safeLimit]
    );

    return {
      rows: rowsResult.rows.map(normalizeTask),
      total: Number(totalResult.rows[0]?.total || 0)
    };
  } catch (error) {
    return fallbackListTasks({ organizationId, page: safePage, limit: safeLimit, status, projectId, priority, assigneeId, search });
  }
}

async function getTask(organizationId, taskId) {
  try {
    const result = await query('SELECT * FROM tasks WHERE organization_id = $1 AND id = $2', [organizationId, taskId]);
    return normalizeTask(result.rows[0] || null);
  } catch (error) {
    const task = Array.from(memoryStore.values()).find((item) => item.organization_id === organizationId && item.id === taskId);
    return normalizeTask(task || null);
  }
}

async function createTask({ organizationId, data, userId }) {
  const taskId = data.id || uuidv4();
  const now = new Date().toISOString();
  const task = normalizeTask({
    ...data,
    id: taskId,
    organization_id: organizationId,
    project_id: data.project_id,
    title: data.title,
    description: data.description || '',
    status: data.status || 'TODO',
    priority: data.priority || 'MEDIUM',
    assignee_id: data.assignee_id || null,
    due_date: data.due_date || null,
    version: data.version ?? 1,
    idempotency_key: data.idempotency_key || null,
    created_at: now,
    updated_at: now
  });

  try {
    if (task.idempotency_key) {
      const match = await query('SELECT * FROM tasks WHERE organization_id = $1 AND idempotency_key = $2 LIMIT 1', [organizationId, task.idempotency_key]);
      if (match.rows[0]) {
        return { task: normalizeTask(match.rows[0]), duplicate: true };
      }
    }

    const result = await query(
      `INSERT INTO tasks (
        id, organization_id, project_id, title, description, status, priority, assignee_id,
        due_date, version, idempotency_key, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [task.id, task.organization_id, task.project_id, task.title, task.description, task.status, task.priority, task.assignee_id, task.due_date, task.version, task.idempotency_key, task.created_at, task.updated_at]
    );

    return { task: normalizeTask(result.rows[0]), duplicate: false };
  } catch (error) {
    const existing = Array.from(memoryStore.values()).find((item) => item.organization_id === organizationId && item.idempotency_key === task.idempotency_key);
    if (existing) {
      return { task: normalizeTask(existing), duplicate: true };
    }

    memoryStore.set(task.id, task);
    return { task, duplicate: false };
  }
}

async function updateTask({ organizationId, taskId, payload }) {
  try {
    const existing = await query('SELECT * FROM tasks WHERE organization_id = $1 AND id = $2', [organizationId, taskId]);
    if (!existing.rows[0]) {
      return { found: false };
    }

    const current = normalizeTask(existing.rows[0]);
    const requestedVersion = Number(payload.version ?? current.version);
    if (requestedVersion !== current.version) {
      return { found: true, conflict: true };
    }

    const next = normalizeTask({
      ...current,
      ...payload,
      id: current.id,
      organization_id: organizationId,
      project_id: payload.project_id || current.project_id,
      title: payload.title || current.title,
      description: payload.description ?? current.description,
      status: payload.status || current.status,
      priority: payload.priority || current.priority,
      assignee_id: payload.assignee_id ?? current.assignee_id,
      due_date: payload.due_date ?? current.due_date,
      version: current.version + 1,
      updated_at: new Date().toISOString()
    });

    const result = await query(
      `UPDATE tasks SET project_id = $3, title = $4, description = $5, status = $6, priority = $7,
       assignee_id = $8, due_date = $9, version = $10, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [taskId, organizationId, next.project_id, next.title, next.description, next.status, next.priority, next.assignee_id, next.due_date, next.version]
    );

    return { found: true, conflict: false, task: normalizeTask(result.rows[0]) };
  } catch (error) {
    const current = Array.from(memoryStore.values()).find((item) => item.organization_id === organizationId && item.id === taskId);
    if (!current) return { found: false };

    const requestedVersion = Number(payload.version ?? current.version);
    if (requestedVersion !== current.version) {
      return { found: true, conflict: true };
    }

    const next = normalizeTask({
      ...current,
      ...payload,
      version: current.version + 1,
      updated_at: new Date().toISOString()
    });
    memoryStore.set(taskId, next);
    return { found: true, conflict: false, task: next };
  }
}

async function deleteTask(organizationId, taskId) {
  try {
    const result = await query('DELETE FROM tasks WHERE id = $1 AND organization_id = $2 RETURNING *', [taskId, organizationId]);
    if (!result.rows[0]) return { found: false };
    return { found: true, task: normalizeTask(result.rows[0]) };
  } catch (error) {
    const task = Array.from(memoryStore.values()).find((item) => item.organization_id === organizationId && item.id === taskId);
    if (!task) return { found: false };
    memoryStore.delete(taskId);
    return { found: true, task: normalizeTask(task) };
  }
}

module.exports = {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  memoryStore
};
