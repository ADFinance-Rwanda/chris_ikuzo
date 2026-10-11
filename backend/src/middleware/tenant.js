function requireTenant(req, res, next) {
  const organizationId = req.user?.organizationId || req.user?.orgId;

  if (!organizationId) {
    return res.status(403).json({ error: 'Tenant context missing from authenticated user' });
  }

  req.user.organizationId = String(organizationId);
  req.user.orgId = String(organizationId);
  req.tenantId = String(organizationId);
  req.organizationId = String(organizationId);

  return next();
}

function enforceTenantScope(req, res, next) {
  const requestedOrgId = req.params.organizationId || req.query.organization_id || req.body?.organization_id;
  const tenantId = req.tenantId || req.organizationId || req.user?.organizationId || req.user?.orgId;

  if (requestedOrgId && String(requestedOrgId) !== String(tenantId)) {
    return res.status(403).json({ error: 'Organization mismatch' });
  }

  if (!tenantId) {
    return res.status(403).json({ error: 'No organization context available' });
  }

  req.tenantId = String(tenantId);
  req.organizationId = String(tenantId);

  return next();
}

module.exports = { requireTenant, enforceTenantScope };
