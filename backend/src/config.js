require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const realm = process.env.KEYCLOAK_REALM || 'chris-ikuzo';
const clientId = process.env.KEYCLOAK_CLIENT_ID || 'app-backend';
const configuredAudiences = (process.env.KEYCLOAK_ALLOWED_AUDIENCES || `${clientId},account`)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const allowedAudiences = Array.from(new Set([clientId, ...configuredAudiences]));

const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '******localhost:5432/appdb',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  keycloak: {
    issuer: process.env.KEYCLOAK_ISSUER || `http://localhost:8080/realms/${realm}`,
    audience: clientId,
    allowedAudiences,
    jwksUri: process.env.KEYCLOAK_JWKS_URI || `http://localhost:8080/realms/${realm}/protocol/openid-connect/certs`,
    realm,
    clientId
  },
  app: {
    name: 'chris-ikuzo-backend'
  }
};

module.exports = config;
