const { checkRateLimit } = require('../services/rateLimit');

function rateLimit({ limit = 60, windowSeconds = 60 }) {
  return async (req, res, next) => {
    const key = req.user?.sub || req.ip || 'anonymous';
    const result = await checkRateLimit({ key, limit, windowSeconds });

    if (!result.allowed) {
      return res.status(429).json({ error: 'Rate limit exceeded', limit: result.limit, count: result.count });
    }

    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, result.limit - result.count)));
    return next();
  };
}

module.exports = { rateLimit };
