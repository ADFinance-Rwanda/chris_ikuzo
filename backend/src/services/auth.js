const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const config = require('../config');

const client = jwksClient({
  jwksUri: config.keycloak.jwksUri,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 10 * 60 * 1000
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
      return;
    }

    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  });
}

function verifyAccessToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, getKey, {
      issuer: config.keycloak.issuer,
      audience: config.keycloak.allowedAudiences,
      algorithms: ['RS256']
    }, (error, decoded) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(decoded);
    });
  });
}

function extractUserContext(payload) {
  const orgId = [
    payload.org_id,
    payload.organization_id,
    payload.organizationId,
    payload.tenant_id,
    payload.tenantId,
    payload['organization-id'],
    payload.organizations?.[0]?.id,
    payload.organizations?.[0]?.organization_id,
    payload.org?.id,
    payload.org_id,
    payload.claims?.organization_id
  ].find((value) => value !== undefined && value !== null && value !== '');

  const roleSources = [
    payload.realm_access?.roles,
    payload.resource_access?.[config.keycloak.audience]?.roles,
    payload.resource_access?.account?.roles,
    payload.roles,
    payload.client_roles,
    payload.groups
  ];

  const roles = roleSources.flatMap((value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return [value];
    return [];
  });

  return {
    sub: payload.sub,
    email: payload.email,
    username: payload.preferred_username || payload.username,
    orgId: orgId ? String(orgId) : null,
    roles: Array.from(new Set(roles)),
    claims: payload
  };
}

module.exports = { verifyAccessToken, extractUserContext };
