const { getClient, connect } = require('./cache');

async function addAuditLog({ organizationId, userId, action, resourceType, resourceId, metadata = {} }) {
  const redisClient = getClient();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    organization_id: organizationId,
    user_id: userId,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    metadata,
    created_at: new Date().toISOString()
  };

  try {
    const client = await connect();
    await client.lPush(`audit:${organizationId}`, JSON.stringify(entry));
    await client.lTrim(`audit:${organizationId}`, 0, 999);
  } catch (error) {
    // graceful degradation for audit logging
  }

  return entry;
}

module.exports = { addAuditLog };
