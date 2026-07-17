// ============================================================
// Auth Middleware — JWT verification
// ============================================================

const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET no configurado. Define la variable de entorno JWT_SECRET antes de iniciar el servidor.');
}
const JWT_SECRET = process.env.JWT_SECRET;

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
