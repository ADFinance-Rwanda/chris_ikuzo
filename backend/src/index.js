const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const { ping: redisPing } = require('./services/cache');
const { query, pool } = require('./services/db');
const tasksRouter = require('./routes/tasks');
const projectsRouter = require('./routes/projects');
const dashboardRouter = require('./routes/dashboard');
const meRouter = require('./routes/me');
const config = require('./config');

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173')
  .split(',').map((origin) => origin.trim()).filter(Boolean);

app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS'));
  },
  allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const requestedId = req.get('X-Request-Id');
  req.requestId = requestedId && /^[\w.-]{1,128}$/.test(requestedId)
    ? requestedId
    : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

async function checkKeycloak() {
  try {
    const response = await fetch(config.keycloak.jwksUri, { signal: AbortSignal.timeout(3000) });
    return response.ok ? 'ok' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

async function checkDatabase() {
  try {
    await query('SELECT 1');
    return 'ok';
  } catch {
    return 'unavailable';
  }
}

async function getDependencyHealth() {
  const [dbStatus, redisStatus, keycloakStatus] = await Promise.all([
    checkDatabase(),
    redisPing(),
    checkKeycloak()
  ]);
  const ready = dbStatus === 'ok' && redisStatus === 'PONG' && keycloakStatus === 'ok';
  return { dbStatus, redisStatus, keycloakStatus, ready };
}

app.get('/health', (req, res) => res.json({ status: 'ok', app: config.app.name }));
app.get('/ready', async (req, res, next) => {
  try {
    const health = await getDependencyHealth();
    return res.status(health.ready ? 200 : 503).json({
      status: health.ready ? 'ready' : 'not ready',
      database: health.dbStatus,
      redis: health.redisStatus,
      keycloak: health.keycloakStatus
    });
  } catch (error) {
    return next(error);
  }
});

app.use('/api/me', meRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/dashboard', dashboardRouter);

app.use((req, res) => res.status(404).json({ error: 'NOT_FOUND' }));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.type === 'entity.parse.failed'
    ? 400
    : error.code === '23505'
      ? 409
      : ['22P02', '23502', '23503', '23514'].includes(error.code)
        ? 400
        : 500;
  console.error(JSON.stringify({
    level: 'error',
    request_id: req.requestId,
    method: req.method,
    path: req.path,
    code: error.code || error.type || 'INTERNAL_ERROR',
    message: error.message
  }));
  return res.status(status).json({
    error: status === 500 ? 'INTERNAL_SERVER_ERROR' : status === 409 ? 'CONFLICT' : 'INVALID_REQUEST',
    request_id: req.requestId
  });
});

if (require.main === module) {
  const server = app.listen(config.port, () => {
    console.log(`${config.app.name} listening on port ${config.port}`);
  });
  const shutdown = async () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = app;
