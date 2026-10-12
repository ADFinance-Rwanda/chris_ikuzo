const test = require('node:test');
const assert = require('node:assert/strict');
const { requireTenant, enforceTenantScope } = require('../src/middleware/tenant');

test('requireTenant sets tenant context from the authenticated user', () => {
  const req = { user: { sub: 'user-1', orgId: '00000000-0000-4000-8000-000000000001' } };
  const res = {
    statusCode: null,
    json(payload) { this.payload = payload; return this; }
  };
  let nextCalled = false;
  requireTenant(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.organizationId, '00000000-0000-4000-8000-000000000001');
  assert.equal(req.tenantId, '00000000-0000-4000-8000-000000000001');
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
    json(payload) { this.payload = payload; return this; }
  };
  let nextCalled = false;
  enforceTenantScope(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.payload.error, 'Organization mismatch');
});

test('requireTenant rejects identity without a trusted organization claim', () => {
  const req = { user: { sub: 'user-2' } };
  const res = {
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
  let nextCalled = false;
  requireTenant(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('requireTenant rejects malformed organization claim values', () => {
  const req = { user: { sub: 'user-3', orgId: 'not-a-uuid' } };
  const res = {
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
  let nextCalled = false;
  requireTenant(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});
