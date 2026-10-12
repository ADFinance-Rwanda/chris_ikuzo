const express = require('express');
const { z } = require('zod');
const { requireAuth, requireRole, asyncHandler } = require('../middleware/auth');
const { requireTenant, enforceTenantScope } = require('../middleware/tenant');
const {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject
} = require('../services/projectRepository');
const { invalidateDashboard } = require('../services/dashboard');

const router = express.Router();
const uuid = z.string().uuid();
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['active', 'archived']).optional()
}).strict();
const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(4000).default('')
}).strict();
const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  status: z.enum(['active', 'archived']).optional()
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');

router.use(requireAuth, requireTenant, enforceTenantScope);

router.get('/', requireRole('MEMBER'), asyncHandler(async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
  const { rows, total } = await listProjects({ organizationId: req.organizationId, ...parsed.data });
  return res.json({
    data: rows,
    pagination: {
      page: parsed.data.page,
      limit: parsed.data.limit,
      total,
      total_pages: Math.ceil(total / parsed.data.limit)
    }
  });
}));

router.post('/', requireRole('PROJECT_MANAGER'), asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
  const project = await createProject({
    organizationId: req.organizationId,
    data: parsed.data,
    userId: req.user.sub
  });
  await invalidateDashboard(req.organizationId);
  return res.status(201).json(project);
}));

router.get('/:id', requireRole('MEMBER'), asyncHandler(async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ error: 'NOT_FOUND' });
  const project = await getProject(req.organizationId, req.params.id);
  if (!project) return res.status(404).json({ error: 'NOT_FOUND' });
  return res.json(project);
}));

router.put('/:id', requireRole('ORG_ADMIN'), asyncHandler(async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ error: 'NOT_FOUND' });
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
  const project = await updateProject({
    organizationId: req.organizationId,
    projectId: req.params.id,
    data: parsed.data,
    userId: req.user.sub
  });
  if (!project) return res.status(404).json({ error: 'NOT_FOUND' });
  await invalidateDashboard(req.organizationId);
  return res.json(project);
}));

router.delete('/:id', requireRole('ORG_ADMIN'), asyncHandler(async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ error: 'NOT_FOUND' });
  const deleted = await deleteProject({
    organizationId: req.organizationId,
    projectId: req.params.id,
    userId: req.user.sub
  });
  if (!deleted) return res.status(404).json({ error: 'NOT_FOUND' });
  await invalidateDashboard(req.organizationId);
  return res.status(204).send();
}));

module.exports = router;
