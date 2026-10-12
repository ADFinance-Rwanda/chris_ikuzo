const test = require('node:test');
const assert = require('node:assert/strict');
const { v4: uuidv4 } = require('uuid');
const { pool, query } = require('../src/services/db');
const {
  createTask,
  updateTask,
  getTask,
  listTasks,
  deleteTask
} = require('../src/services/taskRepository');
const { processOneJob } = require('../src/worker');
const { createProject, updateProject, deleteProject } = require('../src/services/projectRepository');

const tenantA = uuidv4();
const tenantB = uuidv4();
const projectA = uuidv4();
const userId = `integration-${uuidv4()}`;
test('PostgreSQL enforces tenant-safe task CRUD, idempotency, concurrency, and immutable audit', {
  skip: !process.env.TEST_DATABASE_URL
}, async (t) => {
  await query('INSERT INTO organizations (id, name) VALUES ($1, $2), ($3, $4)', [
    tenantA, 'Integration tenant A', tenantB, 'Integration tenant B'
  ]);
  await query('INSERT INTO projects (id, organization_id, name) VALUES ($1, $2, $3)', [
    projectA, tenantA, 'Integration project'
  ]);
  await query('INSERT INTO users (id, organization_id, username) VALUES ($1, $2, $3)', [
    userId, tenantA, 'integration-user'
  ]);
  t.after(async () => {
    await query('ALTER TABLE task_audit_logs DISABLE TRIGGER task_audit_logs_append_only');
    await query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    await query('ALTER TABLE task_audit_logs ENABLE TRIGGER task_audit_logs_append_only');
  });

  const input = {
    project_id: projectA,
    title: 'Transactional integration task',
    description: '',
    status: 'TODO',
    priority: 'MEDIUM',
    assignee_id: null,
    due_date: null,
    idempotency_key: `test:${uuidv4()}`
  };
  const first = await createTask({ organizationId: tenantA, data: input, userId });
  assert.equal(first.duplicate, false);
  assert.equal(await processOneJob(), true);
  const delivery = await query('SELECT 1 FROM notification_deliveries WHERE organization_id = $1 AND payload->>\'task_id\' = $2', [
    tenantA, first.task.id
  ]);
  assert.equal(delivery.rowCount, 1);

  const duplicate = await createTask({ organizationId: tenantA, data: input, userId });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.task.id, first.task.id);
  const reused = await createTask({
    organizationId: tenantA,
    data: { ...input, title: 'Different payload' },
    userId
  });
  assert.equal(reused.conflict, true);

  assert.equal(await getTask(tenantB, first.task.id), null);
  assert.equal(await getTask(tenantA, first.task.id, `other-${userId}`), null);
  assert.equal((await listTasks({ organizationId: tenantB, page: 1, limit: 10 })).total, 0);
  assert.equal((await updateTask({
    organizationId: tenantB,
    taskId: first.task.id,
    payload: { title: 'Cross-tenant attempt', version: 1 },
    userId
  })).found, false);
  assert.deepEqual(await deleteTask(tenantB, first.task.id, userId), { found: false });
  await assert.rejects(
    query('INSERT INTO tasks (id, organization_id, project_id, title, created_by) VALUES ($1, $2, $3, $4, $5)', [
      uuidv4(), tenantB, projectA, 'Invalid cross-tenant project', userId
    ]),
    (error) => error.code === '23503'
  );

  const [left, right] = await Promise.all([
    updateTask({
      organizationId: tenantA,
      taskId: first.task.id,
      payload: { title: 'Concurrent writer A', version: 1 },
      userId
    }),
    updateTask({
      organizationId: tenantA,
      taskId: first.task.id,
      payload: { title: 'Concurrent writer B', version: 1 },
      userId
    })
  ]);
  assert.equal([left, right].filter((result) => !result.conflict && result.found).length, 1);
  assert.equal([left, right].filter((result) => result.conflict).length, 1);
  assert.equal((await updateTask({
    organizationId: tenantA,
    taskId: first.task.id,
    payload: { title: 'Not authorized', version: 2 },
    userId: `other-${userId}`,
    memberOnly: true
  })).found, false);

  const tasks = await listTasks({ organizationId: tenantA, page: 1, limit: 10 });
  assert.equal(tasks.total, 1);
  assert.equal(tasks.rows[0].id, first.task.id);
  const audit = await query(
    'SELECT COUNT(*)::int AS count FROM task_audit_logs WHERE organization_id = $1 AND resource_id = $2',
    [tenantA, first.task.id]
  );
  assert.equal(audit.rows[0].count, 2);
  await assert.rejects(
    query('UPDATE task_audit_logs SET action = $1 WHERE organization_id = $2 AND resource_id = $3', [
      'TAMPERED', tenantA, first.task.id
    ]),
    /append-only/
  );

  assert.equal((await deleteTask(tenantA, first.task.id, userId)).found, true);

  const project = await createProject({
    organizationId: tenantA,
    data: { name: 'Created project', description: '' },
    userId
  });
  assert.equal((await updateProject({
    organizationId: tenantA,
    projectId: project.id,
    data: { status: 'archived' },
    userId
  })).status, 'archived');
  assert.equal(await deleteProject({ organizationId: tenantB, projectId: project.id, userId }), false);
  assert.equal(await deleteProject({ organizationId: tenantA, projectId: project.id, userId }), true);
});

test.after(async () => {
  await pool.end();
});
