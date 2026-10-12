const express = require('express');
const { requireAuth, asyncHandler } = require('../middleware/auth');
const { requireTenant } = require('../middleware/tenant');
const { query } = require('../services/db');

const router = express.Router();

router.get('/', requireAuth, requireTenant, asyncHandler(async (req, res) => {
  const result = await query(
    `INSERT INTO users (id, organization_id, email, username, roles)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       username = EXCLUDED.username,
       roles = EXCLUDED.roles,
       updated_at = NOW()
     WHERE users.organization_id = EXCLUDED.organization_id
     RETURNING id, organization_id, email, username, roles`,
    [
      req.user.sub,
      req.organizationId,
      req.user.email || null,
      req.user.username || req.user.sub,
      req.user.roles
    ]
  );
  if (!result.rows[0]) {
    return res.status(403).json({ error: 'TENANT_MEMBERSHIP_MISMATCH' });
  }
  return res.json(result.rows[0]);
}));

module.exports = router;
