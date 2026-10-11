const express = require('express');
const { z } = require('zod');
const { requireAuth, requireRole } = require('../middleware/auth');
const { requireTenant, enforceTenantScope } = require('../middleware/tenant');
const { rateLimit } = require('../middleware/rateLimit');
const { addAuditLog } = require('../services/audit');
const {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask
} = require('../services/taskRepository');
const { getIdempotencyRecord, storeIdempotencyRecord } = require('../services/idempotency');

const router = express.Router();

const taskSchema = z.object({
  project_id: z.string().min(1),
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional().default(''),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).default('TODO'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  assignee_id: z.string().min(1).optional().nullable(),
  due_date: z.string().datetime({ offset: true }).optional().nullable(),
  version: z.number().int().nonnegative().optional(),
  idempotency_key: z.string().min(1).max(255).optional()
});

const updateTaskSchema = taskSchema.partial();

router.use(requireAuth, requireTenant, enforceTenantScope);

router.get('/', requireRole('admin', 'manager', 'member'), rateLimit({ limit: 120, windowSeconds: 60 }), async (req, res) => {
  const organizationId = req.organizationId;
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);
  const status = req.query.status;
  const projectId = req.query.project_id;
  const priority = req.query.priority;
  const assigneeId = req.query.assignee_id;
  const search = req.query.search;

  const { rows, total } = await listTasks({
    organizationId,
    page,
    limit,
    status,
    projectId,
    priority,
    assigneeId,
    search
  });

  return res.json({
    data: rows,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.max(1, Math.ceil(total / limit))
    }
  });
});

router.post('/', requireRole('admin', 'manager', 'member'), rateLimit({ limit: 60, windowSeconds: 60 }), async (req, res) => {
  const parsed = taskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid task payload', details: parsed.error.issues });
  }

  const organizationId = req.organizationId;
  const idempotencyKey = parsed.data.idempotency_key || req.headers['x-idempotency-key'];

  if (idempotencyKey) {
    const cached = await getIdempotencyRecord({ organizationId, key: idempotencyKey });
    if (cached) {
      return res.status(200).json(cached);
    }
  }

  const { task, duplicate } = await createTask({
    organizationId,
    data: { ...parsed.data, idempotency_key: idempotencyKey || parsed.data.idempotency_key || null },
    userId: req.user?.sub
  });

  if (duplicate) {
    if (idempotencyKey) {
      await storeIdempotencyRecord({ organizationId, key: idempotencyKey, response: task, ttlSeconds: 86400 });
    }
    return res.status(200).json(task);
  }

  await addAuditLog({
    organizationId,
    userId: req.user?.sub,
    action: 'create',
    resourceType: 'task',
    resourceId: task.id,
    metadata: { title: task.title, idempotency_key: idempotencyKey || null }
  });

  if (idempotencyKey) {
    await storeIdempotencyRecord({ organizationId, key: idempotencyKey, response: task, ttlSeconds: 86400 });
  }

  return res.status(201).json(task);
});

router.get('/:id', requireRole('admin', 'manager', 'member'), rateLimit({ limit: 120, windowSeconds: 60 }), async (req, res) => {
  const task = await getTask(req.organizationId, req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  return res.json(task);
});

router.put('/:id', requireRole('admin', 'manager', 'member'), rateLimit({ limit: 60, windowSeconds: 60 }), async (req, res) => {
  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid task update payload', details: parsed.error.issues });
  }

  const { found, conflict, task } = await updateTask({
    organizationId: req.organizationId,
    taskId: req.params.id,
    payload: parsed.data
  });

  if (!found) {
    return res.status(404).json({ error: 'Task not found' });
  }
  if (conflict) {
    return res.status(409).json({ error: 'Conflict: task version mismatch' });
  }

  await addAuditLog({
    organizationId: req.organizationId,
    userId: req.user?.sub,
    action: 'update',
    resourceType: 'task',
    resourceId: req.params.id,
    metadata: { version: task.version }
  });

  return res.json(task);
});

router.delete('/:id', requireRole('admin', 'manager'), rateLimit({ limit: 60, windowSeconds: 60 }), async (req, res) => {
  const { found, task } = await deleteTask(req.organizationId, req.params.id);
  if (!found) {
    return res.status(404).json({ error: 'Task not found' });
  }

  await addAuditLog({
    organizationId: req.organizationId,
    userId: req.user?.sub,
    action: 'delete',
    resourceType: 'task',
    resourceId: req.params.id,
    metadata: {}
  });

  return res.status(204).send();
});

module.exports = router;
