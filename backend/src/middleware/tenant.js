function sendForbidden(res, message) {
  if (!res) {
    return null;
  }

  if (typeof res.status === 'function') {
    return res.status(403).json({ error: message });
  }

  res.statusCode = 403;
  res.payload = { error: message };
  return res;
}

function requireTenant(req, res, next) {
  const organizationId = req.user?.organizationId || req.user?.orgId;

  if (!organizationId) {
    return sendForbidden(res, 'Tenant context missing from authenticated user');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(organizationId))) {
    return sendForbidden(res, 'Tenant context is invalid');
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
    return sendForbidden(res, 'Organization mismatch');
  }

  if (!tenantId) {
    return sendForbidden(res, 'No organization context available');
  }

  req.tenantId = String(tenantId);
  req.organizationId = String(tenantId);

  return next();
}

module.exports = { requireTenant, enforceTenantScope };
