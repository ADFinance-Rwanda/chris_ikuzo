const express = require('express');
const { z } = require('zod');
const { v4: uuidv4 } = require('uuid');
const { requireAuth, requireRole } = require('../middleware/auth');
const { requireTenant, enforceTenantScope } = require('../middleware/tenant');
const { rateLimit } = require('../middleware/rateLimit');
const { addAuditLog } = require('../services/audit');

const router = express.Router();

const taskSchema = z.object({
  project_id: z.string().min(1),
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional().default(''),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).default('TODO'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  assignee_id: z.string().min(1).optional().nullable(),
  due_date: z.string().datetime({ offset: true }).optional().nullable(),
  version: z.number().int().nonnegative().optional()
});

const updateTaskSchema = taskSchema.partial();

const taskStore = new Map();

function normalizeTask(task, organizationId) {
  return {
    ...task,
    organization_id: organizationId,
    version: task.version ?? 1,
    created_at: task.created_at || new Date().toISOString(),
    updated_at: task.updated_at || new Date().toISOString()
  };
}

router.use(requireAuth, requireTenant, enforceTenantScope);

router.get('/', requireRole('admin', 'manager', 'member'), rateLimit({ limit: 120, windowSeconds: 60 }), async (req, res) => {
  const organizationId = req.organizationId;
  const tasks = Array.from(taskStore.values())
    .filter((task) => task.organization_id === organizationId)
    .map((task) => ({ ...task, organization_id: organizationId }));

  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);
  const status = req.query.status;
  const projectId = req.query.project_id;

  let filtered = tasks;
  if (status) filtered = filtered.filter((task) => task.status === status);
  if (projectId) filtered = filtered.filter((task) => task.project_id === projectId);

  const total = filtered.length;
  const start = (page - 1) * limit;
  const paged = filtered.slice(start, start + limit);

  res.json({
    data: paged,
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
  const taskId = uuidv4();
  const now = new Date().toISOString();
  const task = normalizeTask({
    id: taskId,
    organization_id: organizationId,
    ...parsed.data,
    created_at: now,
    updated_at: now,
    version: 1
  }, organizationId);

  taskStore.set(taskId, task);
  await addAuditLog({
    organizationId,
    userId: req.user?.sub,
    action: 'create',
    resourceType: 'task',
    resourceId: taskId,
    metadata: { title: task.title }
  });

  res.status(201).json(task);
});

router.get('/:id', requireRole('admin', 'manager', 'member'), rateLimit({ limit: 120, windowSeconds: 60 }), (req, res) => {
  const task = taskStore.get(req.params.id);
  if (!task || task.organization_id !== req.organizationId) {
    return res.status(404).json({ error: 'Task not found' });
  }
  res.json(task);
});

router.put('/:id', requireRole('admin', 'manager', 'member'), rateLimit({ limit: 60, windowSeconds: 60 }), async (req, res) => {
  const existing = taskStore.get(req.params.id);
  if (!existing || existing.organization_id !== req.organizationId) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const requestedVersion = Number(req.body?.version ?? existing.version);
  if (requestedVersion !== existing.version) {
    return res.status(409).json({ error: 'Conflict: task version mismatch' });
  }

  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid task update payload', details: parsed.error.issues });
  }

  const updatedTask = normalizeTask({
    ...existing,
    ...parsed.data,
    version: existing.version + 1,
    updated_at: new Date().toISOString()
  }, req.organizationId);

  taskStore.set(req.params.id, updatedTask);
  await addAuditLog({
    organizationId: req.organizationId,
    userId: req.user?.sub,
    action: 'update',
    resourceType: 'task',
    resourceId: req.params.id,
    metadata: { version: updatedTask.version }
  });

  res.json(updatedTask);
});

router.delete('/:id', requireRole('admin', 'manager'), rateLimit({ limit: 60, windowSeconds: 60 }), async (req, res) => {
  const task = taskStore.get(req.params.id);
  if (!task || task.organization_id !== req.organizationId) {
    return res.status(404).json({ error: 'Task not found' });
  }

  taskStore.delete(req.params.id);
  await addAuditLog({
    organizationId: req.organizationId,
    userId: req.user?.sub,
    action: 'delete',
    resourceType: 'task',
    resourceId: req.params.id,
    metadata: {}
  });
  res.status(204).send();
});

module.exports = router;
