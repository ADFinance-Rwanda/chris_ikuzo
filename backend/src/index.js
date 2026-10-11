const express = require('express');
const cors = require('cors');
const { ping: redisPing } = require('./services/cache');
const { query } = require('./services/db');
const tasksRouter = require('./routes/tasks');
const config = require('./config');

const app = express();
app.use(cors());
app.use(express.json());

async function getDependencyHealth() {
  const dbStatus = await checkDatabase();
  const redisStatus = await redisPing();
  const ready = dbStatus === 'ok' && redisStatus === 'PONG';

  return { dbStatus, redisStatus, ready };
}

app.get('/health', async (req, res) => {
  const { dbStatus, redisStatus, ready } = await getDependencyHealth();
  res.json({
    status: ready ? 'ok' : 'degraded',
    database: dbStatus,
    redis: redisStatus,
    ready,
    app: config.app.name,
    environment: config.nodeEnv
  });
});

app.get('/ready', async (req, res) => {
  try {
    const { dbStatus, redisStatus, ready } = await getDependencyHealth();
    if (ready) {
      return res.json({ status: 'ready', database: dbStatus, redis: redisStatus, app: config.app.name, environment: config.nodeEnv });
    }
    return res.status(503).json({ status: 'not ready', database: dbStatus, redis: redisStatus, app: config.app.name, environment: config.nodeEnv });
  } catch (error) {
    return res.status(503).json({ status: 'not ready', error: error.message, app: config.app.name, environment: config.nodeEnv });
  }
});

app.use('/api/tasks', tasksRouter);

async function checkDatabase() {
  try {
    await query('SELECT 1');
    return 'ok';
  } catch (error) {
    return 'unavailable';
  }
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`${config.app.name} listening on port ${config.port}`);
  });
}

module.exports = app;
