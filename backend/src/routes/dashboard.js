const express = require('express');
const { requireAuth, requireRole, asyncHandler } = require('../middleware/auth');
const { requireTenant, enforceTenantScope } = require('../middleware/tenant');
const { getDashboard, addDashboardRequest } = require('../services/dashboard');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();
router.use(requireAuth, requireTenant, enforceTenantScope);

router.get('/', requireRole('MEMBER'), asyncHandler(async (req, res) => {
  const isMember = req.user.roles.includes('MEMBER')
    && !req.user.roles.some((role) => ['PROJECT_MANAGER', 'ORG_ADMIN', 'SUPER_ADMIN'].includes(role));
  return res.json(await getDashboard({
    organizationId: req.organizationId,
    userId: req.user.sub,
    isMember
  }));
}));

router.post('/refresh', requireRole('PROJECT_MANAGER'), rateLimit({ limit: 10, windowSeconds: 60 }), asyncHandler(async (req, res) => {
  await addDashboardRequest({ organizationId: req.organizationId, userId: req.user.sub });
  return res.status(202).json({ status: 'queued' });
}));

module.exports = router;
