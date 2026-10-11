const test = require('node:test');
const assert = require('node:assert/strict');
const { extractUserContext } = require('../src/services/auth');

test('extractUserContext resolves tenant and roles from Keycloak user claims', () => {
  const payload = {
    sub: 'user-123',
    preferred_username: 'demo-user',
    email: 'demo@example.com',
    org_id: 'org-42',
    realm_access: { roles: ['member'] },
    resource_access: {
      'app-backend': { roles: ['admin'] }
    }
  };

  const context = extractUserContext(payload);

  assert.equal(context.sub, 'user-123');
  assert.equal(context.orgId, 'org-42');
  assert.deepEqual(context.roles, ['member', 'admin']);
  assert.equal(context.username, 'demo-user');
});

test('extractUserContext accepts alternate tenant claim names', () => {
  const payload = {
    sub: 'user-456',
    preferred_username: 'ops-user',
    organization_id: 'tenant-9',
    roles: ['manager']
  };

  const context = extractUserContext(payload);

  assert.equal(context.orgId, 'tenant-9');
  assert.deepEqual(context.roles, ['manager']);
});
