// ============================================================
// Auth Routes — Login, Verify, Logout
// ============================================================

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// --- Cargar usuarios desde JSON y hashear contraseñas al arrancar ---
const usuariosPath = path.join(__dirname, '..', 'data', 'usuarios.json');
const rawUsers = JSON.parse(fs.readFileSync(usuariosPath, 'utf8'));

// Hashear contraseñas una vez al arrancar
const USERS = rawUsers.map((u) => ({
  id: u.id,
  usuario: u.usuario,
  contrasena_hash: bcrypt.hashSync(u.contrasena, 10),
  nombre: u.nombre,
  cedula: u.cedula || '',
  email: u.email,
  rol: u.rol,
  telefono: u.telefono,
}));

console.log(`[Auth] ${USERS.length} usuarios cargados (${USERS.filter(u => u.rol === 'tecnico').length} técnicos)`);

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
      cedula: user.cedula,
      rol: user.rol,
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      success: true,
      token,
      usuario: {
        id: user.id,
        nombre: user.nombre,
        cedula: user.cedula,
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
      cedula: user.cedula,
      email: user.email,
      rol: user.rol,
      telefono: user.telefono,
    },
  });
});

module.exports = router;
