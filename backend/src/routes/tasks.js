const express = require('express');
const { z } = require('zod');
const { requireAuth, requireRole, asyncHandler } = require('../middleware/auth');
const { requireTenant, enforceTenantScope } = require('../middleware/tenant');
const { rateLimit } = require('../middleware/rateLimit');
const {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask
} = require('../services/taskRepository');
const { invalidateDashboard } = require('../services/dashboard');

const router = express.Router();
const uuid = z.string().uuid();
const taskSchema = z.object({
  project_id: uuid,
  title: z.string().trim().min(1).max(255),
  description: z.string().max(2000).default(''),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).default('TODO'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  assignee_id: z.string().min(1).nullable().default(null),
  due_date: z.string().datetime({ offset: true }).nullable().default(null)
}).strict();
const updateTaskSchema = z.object({
  project_id: uuid.optional(),
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  assignee_id: z.string().min(1).nullable().optional(),
  due_date: z.string().datetime({ offset: true }).nullable().optional(),
  version: z.number().int().positive()
}).strict();
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional(),
  project_id: uuid.optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  assignee_id: z.string().min(1).optional(),
  due_after: z.string().datetime({ offset: true }).optional(),
  due_before: z.string().datetime({ offset: true }).optional(),
  search: z.string().max(200).optional()
}).strict();

router.use(requireAuth, requireTenant, enforceTenantScope);

router.get('/', requireRole('MEMBER'), rateLimit({ limit: 120, windowSeconds: 60 }), asyncHandler(async (req, res) => {
  const filters = querySchema.safeParse(req.query);
  if (!filters.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: filters.error.flatten() });
  }
  const { page, limit, ...criteria } = filters.data;
  const { rows, total } = await listTasks({
    organizationId: req.organizationId,
    page,
    limit,
    ...criteria,
    projectId: criteria.project_id,
    assigneeId: criteria.assignee_id,
    dueAfter: criteria.due_after,
    dueBefore: criteria.due_before,
    memberId: req.user.roles.includes('MEMBER')
      && !req.user.roles.some((role) => ['PROJECT_MANAGER', 'ORG_ADMIN', 'SUPER_ADMIN'].includes(role))
      ? req.user.sub
      : undefined
  });
  return res.json({
    data: rows,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
  });
}));

router.post('/', requireRole('MEMBER'), rateLimit({ limit: 60, windowSeconds: 60 }), asyncHandler(async (req, res) => {
  const parsed = taskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
  }
  const key = req.get('Idempotency-Key');
  if (key && (key.length > 255 || key.trim() !== key)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid Idempotency-Key header' });
  }
  const { task, duplicate, conflict } = await createTask({
    organizationId: req.organizationId,
    data: { ...parsed.data, idempotency_key: key || null },
    userId: req.user.sub
  });
  if (conflict) {
    return res.status(409).json({ error: 'IDEMPOTENCY_KEY_REUSED', message: 'Use a new key for a different request' });
  }
  if (!duplicate) await invalidateDashboard(req.organizationId);
  return res.status(duplicate ? 200 : 201).json(task);
}));

router.get('/:id', requireRole('MEMBER'), rateLimit({ limit: 120, windowSeconds: 60 }), asyncHandler(async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ error: 'NOT_FOUND' });
  const memberId = req.user.roles.includes('MEMBER')
    && !req.user.roles.some((role) => ['PROJECT_MANAGER', 'ORG_ADMIN', 'SUPER_ADMIN'].includes(role))
    ? req.user.sub
    : undefined;
  const task = await getTask(req.organizationId, req.params.id, memberId);
  if (!task) return res.status(404).json({ error: 'NOT_FOUND' });
  return res.json(task);
}));

router.put('/:id', requireRole('MEMBER'), rateLimit({ limit: 60, windowSeconds: 60 }), asyncHandler(async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ error: 'NOT_FOUND' });
  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
  }
  const { found, conflict, task } = await updateTask({
    organizationId: req.organizationId,
    taskId: req.params.id,
    payload: parsed.data,
    userId: req.user.sub,
    memberOnly: req.user.roles.includes('MEMBER')
      && !req.user.roles.some((role) => ['PROJECT_MANAGER', 'ORG_ADMIN', 'SUPER_ADMIN'].includes(role))
  });
  if (!found) return res.status(404).json({ error: 'NOT_FOUND' });
  if (conflict) return res.status(409).json({ error: 'VERSION_CONFLICT', message: 'Reload the latest task before retrying' });
  await invalidateDashboard(req.organizationId);
  return res.json(task);
}));

router.delete('/:id', requireRole('PROJECT_MANAGER'), rateLimit({ limit: 30, windowSeconds: 60 }), asyncHandler(async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ error: 'NOT_FOUND' });
  const { found } = await deleteTask(req.organizationId, req.params.id, req.user.sub);
  if (!found) return res.status(404).json({ error: 'NOT_FOUND' });
  await invalidateDashboard(req.organizationId);
  return res.status(204).send();
}));

module.exports = router;
