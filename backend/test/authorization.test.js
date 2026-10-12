const test = require('node:test');
const assert = require('node:assert/strict');
const { requireRole } = require('../src/middleware/auth');

function authorize(userRoles, requiredRole) {
  const req = { user: { roles: userRoles } };
  const res = {
    statusCode: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
  let nextCalled = false;
  requireRole(requiredRole)(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

test('role hierarchy permits a project manager to manage tasks', () => {
  assert.equal(authorize(['PROJECT_MANAGER'], 'PROJECT_MANAGER').nextCalled, true);
});

test('members cannot manage projects and super admins inherit tenant-scoped permissions', () => {
  assert.equal(authorize(['MEMBER'], 'ORG_ADMIN').res.statusCode, 403);
  assert.equal(authorize(['SUPER_ADMIN'], 'ORG_ADMIN').nextCalled, true);
});
