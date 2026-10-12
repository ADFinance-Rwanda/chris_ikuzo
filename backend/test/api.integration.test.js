const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { generateKeyPairSync } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

test('authenticated HTTP APIs enforce roles, tenant scope, task CRUD, versions, and idempotency', {
  skip: !process.env.TEST_DATABASE_URL
}, async (t) => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.KEYCLOAK_CLIENT_ID = 'app-backend';
  process.env.KEYCLOAK_ALLOWED_AUDIENCES = 'app-backend';

  const issuer = `http://127.0.0.1:${await listenJwksServer()}`;
  const jwksPort = Number(new URL(issuer).port);
  process.env.KEYCLOAK_ISSUER = issuer;
  process.env.KEYCLOAK_JWKS_URI = `${issuer}/certs`;

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwksServer.removeAllListeners('request');
  jwksServer.on('request', (req, res) => {
    if (req.url !== '/certs') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys: [{ ...jwk, kid: 'api-test-key', use: 'sig', alg: 'RS256' }] }));
  });

  const rateLimitModule = require('../src/middleware/rateLimit');
  rateLimitModule.rateLimit = () => (req, res, next) => next();
  const { query, pool } = require('../src/services/db');
  const app = require('../src/index');

  const tenantA = uuidv4();
  const tenantB = uuidv4();
  const projectA = uuidv4();
  const projectB = uuidv4();
  const memberA = `member-a-${uuidv4()}`;
  const memberB = `member-b-${uuidv4()}`;
  const managerB = `manager-b-${uuidv4()}`;
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  function token(sub, organizationId, roles) {
    return jwt.sign({
      sub,
      org_id: organizationId,
      preferred_username: sub,
      realm_access: { roles }
    }, privateKey, {
      algorithm: 'RS256',
      keyid: 'api-test-key',
      issuer,
      audience: 'app-backend',
      expiresIn: '5m'
    });
  }

  async function request(path, actor, options = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${actor}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    });
    return {
      status: response.status,
      body: response.status === 204 ? null : await response.json()
    };
  }

  try {
    await query(
      'INSERT INTO organizations (id, name) VALUES ($1, $2), ($3, $4)',
      [tenantA, 'HTTP tenant A', tenantB, 'HTTP tenant B']
    );
    await query(
      'INSERT INTO projects (id, organization_id, name) VALUES ($1, $2, $3), ($4, $5, $6)',
      [projectA, tenantA, 'Project A', projectB, tenantB, 'Project B']
    );
    t.after(async () => {
      await new Promise((resolve) => jwksServer.close(resolve));
      await query('ALTER TABLE task_audit_logs DISABLE TRIGGER task_audit_logs_append_only');
      await query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[tenantA, tenantB]]);
      await query('ALTER TABLE task_audit_logs ENABLE TRIGGER task_audit_logs_append_only');
      await pool.end();
    });

    const memberAToken = token(memberA, tenantA, ['member']);
    const memberBToken = token(memberB, tenantB, ['member']);
    const managerBToken = token(managerB, tenantB, ['manager']);

    assert.equal((await request('/api/me', memberAToken)).status, 200);
    assert.equal((await request('/api/me', memberBToken)).status, 200);
    assert.equal((await request('/api/projects', memberAToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Not permitted', description: '' })
    })).status, 403);

    const invalid = await request('/api/tasks', memberAToken, {
      method: 'POST',
      body: JSON.stringify({ project_id: projectA, title: '' })
    });
    assert.equal(invalid.status, 400);
    const project = await request(`/api/projects/${projectA}`, memberAToken);
    assert.equal(project.status, 200);
    assert.equal((await request(`/api/projects/${projectA}`, memberBToken)).status, 404);

    const payload = {
      project_id: projectA,
      title: 'HTTP integration task',
      description: '',
      status: 'TODO',
      priority: 'HIGH',
      assignee_id: null,
      due_date: null
    };
    const key = uuidv4();
    const created = await request('/api/tasks', memberAToken, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(payload)
    });
    assert.equal(created.status, 201);
    const duplicate = await request('/api/tasks', memberAToken, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(payload)
    });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.id, created.body.id);
    const keyReuse = await request('/api/tasks', memberAToken, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ ...payload, title: 'Changed request' })
    });
    assert.equal(keyReuse.status, 409);

    assert.equal((await request(`/api/tasks/${created.body.id}`, memberAToken)).status, 200);
    assert.equal((await request(`/api/tasks/${created.body.id}`, memberBToken)).status, 404);
    assert.equal((await request(`/api/tasks?organization_id=${tenantB}`, memberAToken)).status, 403);
    const outsiderUpdate = await request(`/api/tasks/${created.body.id}`, managerBToken, {
      method: 'PUT',
      body: JSON.stringify({ title: 'Cross tenant', version: 1 })
    });
    assert.equal(outsiderUpdate.status, 404);
    assert.equal((await request(`/api/tasks/${created.body.id}`, managerBToken, {
      method: 'DELETE'
    })).status, 404);

    const updated = await request(`/api/tasks/${created.body.id}`, memberAToken, {
      method: 'PUT',
      body: JSON.stringify({ status: 'DONE', version: 1 })
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.version, 2);
    assert.equal((await request(`/api/tasks/${created.body.id}`, memberAToken, {
      method: 'PUT',
      body: JSON.stringify({ title: 'Stale writer', version: 1 })
    })).status, 409);
    assert.equal((await request('/api/tasks?limit=0', memberAToken)).status, 400);

    const deleted = await request(`/api/tasks/${created.body.id}`, token(`manager-a-${uuidv4()}`, tenantA, ['manager']), {
      method: 'DELETE'
    });
    assert.equal(deleted.status, 204);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    if (jwksServer.listening) await new Promise((resolve) => jwksServer.close(resolve));
  }
});

const jwksServer = createServer();

function listenJwksServer() {
  return new Promise((resolve, reject) => {
    jwksServer.once('error', reject);
    jwksServer.listen(0, '127.0.0.1', () => {
      jwksServer.removeListener('error', reject);
      resolve(jwksServer.address().port);
    });
  });
}
