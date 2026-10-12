const { v4: uuidv4 } = require('uuid');

async function insertAuditLog(client, {
  organizationId,
  userId,
  action,
  entityType,
  entityId,
  metadata = {}
}) {
  await client.query(
    `INSERT INTO task_audit_logs
      (id, organization_id, user_id, action, resource_type, resource_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [uuidv4(), organizationId, userId || null, action, entityType, String(entityId), JSON.stringify(metadata)]
  );
}

module.exports = { insertAuditLog };
