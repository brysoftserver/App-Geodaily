// ============================================================
// Auth Routes — Login, Verify, Logout
// ============================================================

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// --- Usuarios mock para desarrollo ---
const USERS = [
  {
    id: 'tec-001',
    usuario: 'tecnico1',
    contrasena_hash: bcrypt.hashSync('123456', 10),
    nombre: 'Carlos Martínez',
    email: 'carlos@geodaily.app',
    rol: 'tecnico',
    telefono: '3151234567',
  },
  {
    id: 'sup-001',
    usuario: 'supervisor1',
    contrasena_hash: bcrypt.hashSync('123456', 10),
    nombre: 'María Gómez',
    email: 'maria@geodaily.app',
    rol: 'supervisor',
    telefono: '3157654321',
  },
  {
    id: 'adm-001',
    usuario: 'admin1',
    contrasena_hash: bcrypt.hashSync('admin123', 10),
    nombre: 'Admin GEODAILY',
    email: 'admin@geodaily.app',
    rol: 'admin',
    telefono: '3150000000',
  },
];

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { usuario, contrasena } = req.body;

    if (!usuario || !contrasena) {
      return res.status(400).json({
        success: false,
        error: 'Usuario y contraseña son requeridos',
      });
    }

    const user = USERS.find((u) => u.usuario === usuario);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Usuario o contraseña incorrectos',
      });
    }

    const validPassword = await bcrypt.compare(contrasena, user.contrasena_hash);
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        error: 'Usuario o contraseña incorrectos',
      });
    }

    const tokenPayload = {
      id: user.id,
      usuario: user.usuario,
      nombre: user.nombre,
      rol: user.rol,
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      success: true,
      token,
      usuario: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol,
        telefono: user.telefono,
      },
    });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/auth/verify
router.get('/verify', authenticateToken, (req, res) => {
  res.json({
    success: true,
    usuario: {
      id: req.user.id,
      nombre: req.user.nombre,
      rol: req.user.rol,
    },
  });
});

// GET /api/auth/me
router.get('/me', authenticateToken, (req, res) => {
  const user = USERS.find((u) => u.id === req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
  }
  res.json({
    success: true,
    usuario: {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      rol: user.rol,
      telefono: user.telefono,
    },
  });
});

module.exports = router;
