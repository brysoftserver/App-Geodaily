// ============================================================
// GEODAILY — Auth Routes
// Login, Verify, CRUD de usuarios (admin)
// Persistencia: PostgreSQL + MinIO (carpetas por usuario)
// ============================================================

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');
const db = require('../database');
const storage = require('../storage');

const router = express.Router();

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

    const user = await db.queryOne(
      'SELECT * FROM usuarios WHERE usuario = $1 AND activo = TRUE',
      [usuario]
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Usuario o contraseña incorrectos',
      });
    }

    const validPassword = await bcrypt.compare(contrasena, user.contrasena);
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        error: 'Usuario o contraseña incorrectos',
      });
    }

    await db.query(
      'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
      [user.id, 'login', JSON.stringify({ ip: req.ip })]
    );

    const tokenPayload = {
      id: user.id,
      usuario: user.usuario,
      nombre: user.nombre,
      cedula: user.cedula,
      rol: user.rol,
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

    // Asegurar carpetas en MinIO al hacer login
    try {
      await storage.createUserFolders(user.rol, user.usuario);
    } catch (storageErr) {
      console.warn(`[Auth] No se pudieron crear carpetas MinIO para ${user.usuario}:`, storageErr.message);
    }

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
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await db.queryOne(
      'SELECT id, usuario, nombre, cedula, email, rol, telefono, created_at FROM usuarios WHERE id = $1',
      [req.user.id]
    );
    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }
    res.json({ success: true, usuario: user });
  } catch (error) {
    console.error('[Auth] Me error:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// ============================================================
// CRUD DE USUARIOS (solo admin) + carpetas MinIO automáticas
// ============================================================

// GET /api/auth/usuarios — Listar todos (admin)
router.get('/usuarios', authenticateToken, async (req, res) => {
  try {
    if (req.user.rol !== 'admin') {
      return res.status(403).json({ success: false, error: 'Solo administradores' });
    }
    const usuarios = await db.queryAll(
      'SELECT id, usuario, nombre, cedula, email, rol, telefono, activo, created_at FROM usuarios ORDER BY nombre'
    );
    res.json({ success: true, total: usuarios.length, usuarios });
  } catch (error) {
    console.error('[Auth] Listar usuarios error:', error);
    res.status(500).json({ success: false, error: 'Error al listar usuarios' });
  }
});

// POST /api/auth/usuarios — Crear usuario (admin) + carpetas en MinIO
router.post('/usuarios', authenticateToken, async (req, res) => {
  try {
    if (req.user.rol !== 'admin') {
      return res.status(403).json({ success: false, error: 'Solo administradores' });
    }

    const { usuario, contrasena, nombre, cedula, email, rol, telefono } = req.body;

    if (!usuario || !contrasena || !nombre || !rol) {
      return res.status(400).json({
        success: false,
        error: 'Campos requeridos: usuario, contrasena, nombre, rol',
      });
    }

    const rolesValidos = ['tecnico', 'supervisor', 'interventor', 'gerente', 'admin'];
    if (!rolesValidos.includes(rol)) {
      return res.status(400).json({ success: false, error: `Rol inválido. Debe ser: ${rolesValidos.join(', ')}` });
    }

    const existente = await db.queryOne('SELECT id FROM usuarios WHERE usuario = $1', [usuario]);
    if (existente) {
      return res.status(409).json({ success: false, error: 'El nombre de usuario ya existe' });
    }

    const prefixMap = { tecnico: 'tec', supervisor: 'sup', interventor: 'int', gerente: 'ger', admin: 'adm' };
    const prefix = prefixMap[rol];
    const count = await db.queryOne('SELECT COUNT(*) as total FROM usuarios WHERE id LIKE $1', [`${prefix}-%`]);
    const nextNum = String((parseInt(count?.total || '0') + 1)).padStart(3, '0');
    const id = `${prefix}-${nextNum}`;

    const hash = await bcrypt.hash(contrasena, 10);

    const nuevoUsuario = await db.insert('usuarios', {
      id, usuario, contrasena: hash, nombre,
      cedula: cedula || '', email: email || '', rol, telefono: telefono || '',
      activo: true,
    });

    // Crear carpetas en MinIO para el nuevo usuario
    try {
      await storage.createUserFolders(rol, usuario);
      console.log(`[Auth] 📁 Carpetas MinIO creadas para ${rol}/${usuario}`);
    } catch (storageErr) {
      console.warn('[Auth] No se pudieron crear carpetas MinIO:', storageErr.message);
    }

    await db.query(
      'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
      [req.user.id, 'crear_usuario', JSON.stringify({ nuevo_id: id, nombre, rol })]
    );

    console.log(`[Auth] ✅ Usuario creado: ${id} — ${nombre} (${rol})`);

    res.status(201).json({
      success: true,
      mensaje: 'Usuario creado correctamente',
      usuario: {
        id: nuevoUsuario.id, usuario: nuevoUsuario.usuario,
        nombre: nuevoUsuario.nombre, cedula: nuevoUsuario.cedula,
        email: nuevoUsuario.email, rol: nuevoUsuario.rol, telefono: nuevoUsuario.telefono,
      },
    });
  } catch (error) {
    console.error('[Auth] Crear usuario error:', error);
    res.status(500).json({ success: false, error: 'Error al crear usuario' });
  }
});

// PUT /api/auth/usuarios/:id — Actualizar usuario (admin)
router.put('/usuarios/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.rol !== 'admin') {
      return res.status(403).json({ success: false, error: 'Solo administradores' });
    }

    const { id } = req.params;
    const { nombre, cedula, email, rol, telefono, activo, contrasena } = req.body;

    const updates = {};
    if (nombre !== undefined) updates.nombre = nombre;
    if (cedula !== undefined) updates.cedula = cedula;
    if (email !== undefined) updates.email = email;
    if (rol !== undefined) updates.rol = rol;
    if (telefono !== undefined) updates.telefono = telefono;
    if (activo !== undefined) updates.activo = activo;
    if (contrasena) updates.contrasena = await bcrypt.hash(contrasena, 10);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No hay campos para actualizar' });
    }

    const actualizado = await db.update('usuarios', updates, 'id', id);
    if (!actualizado) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    if (rol) {
      try { await storage.createUserFolders(actualizado.rol, actualizado.usuario); } catch (e) {}
    }

    await db.query(
      'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
      [req.user.id, 'actualizar_usuario', JSON.stringify({ usuario_id: id })]
    );

    res.json({ success: true, mensaje: 'Usuario actualizado', usuario: actualizado });
  } catch (error) {
    console.error('[Auth] Actualizar usuario error:', error);
    res.status(500).json({ success: false, error: 'Error al actualizar usuario' });
  }
});

// DELETE /api/auth/usuarios/:id — Desactivar usuario (admin)
router.delete('/usuarios/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.rol !== 'admin') {
      return res.status(403).json({ success: false, error: 'Solo administradores' });
    }

    const result = await db.update('usuarios', { activo: false }, 'id', req.params.id);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    await db.query(
      'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
      [req.user.id, 'desactivar_usuario', JSON.stringify({ usuario_id: req.params.id })]
    );

    res.json({ success: true, mensaje: 'Usuario desactivado correctamente' });
  } catch (error) {
    console.error('[Auth] Eliminar usuario error:', error);
    res.status(500).json({ success: false, error: 'Error al eliminar usuario' });
  }
});

module.exports = router;
