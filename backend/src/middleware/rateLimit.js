const { checkRateLimit } = require('../services/rateLimit');

function rateLimit({ limit = 60, windowSeconds = 60 }) {
  return async (req, res, next) => {
    const key = `${req.organizationId}:${req.user?.sub || req.ip}`;
    try {
      const result = await checkRateLimit({ key, limit, windowSeconds });
      if (!result.allowed) {
        return res.status(429).json({
          error: 'RATE_LIMIT_EXCEEDED',
          limit: result.limit,
          count: result.count,
          window_seconds: result.windowSeconds
        });
      }
      res.setHeader('X-RateLimit-Limit', String(result.limit));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, result.limit - result.count)));
      return next();
    } catch (error) {
      console.error('Rate limiter unavailable:', error.message);
      return res.status(503).json({ error: 'RATE_LIMITER_UNAVAILABLE' });
    }
  };
}

module.exports = { rateLimit };
