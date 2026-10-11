const test = require('node:test');
const assert = require('node:assert/strict');
const { requireTenant, enforceTenantScope } = require('../src/middleware/tenant');

test('requireTenant sets tenant context from the authenticated user', () => {
  const req = {
    user: { sub: 'user-1', orgId: 'org-123' }
  };
  const res = {
    statusCode: null,
    json(payload) {
      this.payload = payload;
      return this;
    }
  };

  let nextCalled = false;
  requireTenant(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.organizationId, 'org-123');
  assert.equal(req.tenantId, 'org-123');
});

test('enforceTenantScope rejects mismatched organization ids from request data', () => {
  const req = {
    user: { organizationId: 'org-9' },
    params: { organizationId: 'org-10' },
    query: {},
    body: {}
  };
  const res = {
    statusCode: null,
    json(payload) {
      this.payload = payload;
      return this;
    }
  };

  let nextCalled = false;
  enforceTenantScope(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.payload.error, 'Organization mismatch');
});
