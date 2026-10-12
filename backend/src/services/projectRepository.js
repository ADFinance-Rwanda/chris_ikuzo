const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('./db');
const { insertAuditLog } = require('./audit');

function normalizeProject(project) {
  return project && {
    ...project,
    id: String(project.id),
    organization_id: String(project.organization_id),
    created_at: new Date(project.created_at).toISOString(),
    updated_at: new Date(project.updated_at).toISOString()
  };
}

async function listProjects({ organizationId, page, limit, status }) {
  const params = [organizationId];
  let statusClause = '';
  if (status) {
    params.push(status);
    statusClause = ` AND status = $${params.length}`;
  }
  const where = `organization_id = $1${statusClause}`;
  const [count, rows] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total FROM projects WHERE ${where}`, params),
    query(
      `SELECT * FROM projects WHERE ${where} ORDER BY updated_at DESC, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]
    )
  ]);
  return { rows: rows.rows.map(normalizeProject), total: count.rows[0].total };
}

async function getProject(organizationId, projectId) {
  const result = await query(
    'SELECT * FROM projects WHERE organization_id = $1 AND id = $2',
    [organizationId, projectId]
  );
  return normalizeProject(result.rows[0]);
}

async function createProject({ organizationId, data, userId }) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO projects (id, organization_id, name, description)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [uuidv4(), organizationId, data.name, data.description]
    );
    const project = normalizeProject(result.rows[0]);
    await insertAuditLog(client, {
      organizationId,
      userId,
      action: 'PROJECT_CREATED',
      entityType: 'project',
      entityId: project.id,
      metadata: { name: project.name }
    });
    return project;
  });
}

async function updateProject({ organizationId, projectId, data, userId }) {
  const fields = ['name', 'description', 'status'].filter((field) => Object.hasOwn(data, field));
  if (!fields.length) return getProject(organizationId, projectId);
  const assignments = fields.map((field, index) => `${field} = $${index + 3}`);
  assignments.push('updated_at = NOW()');
  const values = fields.map((field) => data[field]);

  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE projects SET ${assignments.join(', ')}
       WHERE organization_id = $1 AND id = $2 RETURNING *`,
      [organizationId, projectId, ...values]
    );
    if (!result.rows[0]) return null;
    const project = normalizeProject(result.rows[0]);
    await insertAuditLog(client, {
      organizationId,
      userId,
      action: 'PROJECT_UPDATED',
      entityType: 'project',
      entityId: project.id,
      metadata: { status: project.status }
    });
    return project;
  });
}

async function deleteProject({ organizationId, projectId, userId }) {
  return withTransaction(async (client) => {
    const result = await client.query(
      'DELETE FROM projects WHERE organization_id = $1 AND id = $2 RETURNING *',
      [organizationId, projectId]
    );
    if (!result.rows[0]) return false;
    await insertAuditLog(client, {
      organizationId,
      userId,
      action: 'PROJECT_DELETED',
      entityType: 'project',
      entityId: projectId
    });
    return true;
  });
}

module.exports = { listProjects, getProject, createProject, updateProject, deleteProject };
