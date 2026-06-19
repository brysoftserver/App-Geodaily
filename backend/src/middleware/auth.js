// ============================================================
// Auth Middleware — JWT verification
// ============================================================

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'geodaily-dev-secret-cambio-en-produccion';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ estado: 'error', mensaje: 'Token requerido' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ estado: 'error', mensaje: 'Token inválido o expirado' });
  }
}

module.exports = { authenticateToken, JWT_SECRET };
