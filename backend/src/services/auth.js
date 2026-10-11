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
      audience: config.keycloak.audience,
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
  const orgId = payload.org_id || payload.organization_id || payload.tenant_id || payload['organization-id'];
  const roles = payload.realm_access?.roles || payload.resource_access?.[config.keycloak.audience]?.roles || [];

  return {
    sub: payload.sub,
    email: payload.email,
    username: payload.preferred_username || payload.username,
    orgId: orgId ? String(orgId) : null,
    roles: Array.isArray(roles) ? roles : [],
    claims: payload
  };
}

module.exports = { verifyAccessToken, extractUserContext };
