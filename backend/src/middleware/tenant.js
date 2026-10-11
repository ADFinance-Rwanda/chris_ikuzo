function requireTenant(req, res, next) {
  const organizationId = req.user?.orgId;

  if (!organizationId) {
    return res.status(403).json({ error: 'Tenant context missing from authenticated user' });
  }

  req.tenantId = organizationId;
  req.organizationId = organizationId;

  return next();
}

function enforceTenantScope(req, res, next) {
  const requestedOrgId = req.params.organizationId || req.query.organization_id || req.body?.organization_id;
  const tenantId = req.tenantId || req.organizationId;

  if (requestedOrgId && String(requestedOrgId) !== String(tenantId)) {
    return res.status(403).json({ error: 'Organization mismatch' });
  }

  if (!tenantId) {
    return res.status(403).json({ error: 'No organization context available' });
  }

  return next();
}

module.exports = { requireTenant, enforceTenantScope };
