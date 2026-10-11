require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '******localhost:5432/appdb',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  keycloak: {
    issuer: process.env.KEYCLOAK_ISSUER || 'http://localhost:8080/realms/master',
    audience: process.env.KEYCLOAK_CLIENT_ID || 'app-backend',
    jwksUri: process.env.KEYCLOAK_JWKS_URI || 'http://localhost:8080/realms/master/protocol/openid-connect/certs',
    realm: process.env.KEYCLOAK_REALM || 'master'
  },
  app: {
    name: 'chris-ikuzo-backend'
  }
};

module.exports = config;
