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

/**
 * Igual que authenticateToken, pero también acepta el token como query
 * param (?token=...). Solo se usa en rutas que se cargan desde un <img>/
 * <video> del navegador (react-native-web) — esas etiquetas no pueden
 * enviar la cabecera Authorization, así que en web es la única forma de
 * autenticar la petición. En nativo (iOS/Android) se sigue usando la
 * cabecera de siempre.
 */
function authenticateTokenOrQuery(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;

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

module.exports = { authenticateToken, authenticateTokenOrQuery, JWT_SECRET };
