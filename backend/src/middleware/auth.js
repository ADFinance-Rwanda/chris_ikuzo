const { verifyAccessToken, extractUserContext } = require('../services/auth');

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  try {
    const payload = await verifyAccessToken(token);
    req.user = extractUserContext(payload);
    if (!req.user.sub) {
      return res.status(401).json({ error: 'Invalid access token' });
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    const userRoles = req.user?.roles || [];
    const roleRank = { MEMBER: 1, PROJECT_MANAGER: 2, ORG_ADMIN: 3, SUPER_ADMIN: 4 };
    const requiredRank = Math.min(...roles.map((role) => roleRank[role]));
    const hasRequiredRole = userRoles.some((role) => roleRank[role] >= requiredRank);

    if (!hasRequiredRole) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }

    next();
  };
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = { requireAuth, requireRole, asyncHandler };
