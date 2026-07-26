// ============================================================
// Notificaciones en-app — bandeja + contador de no leídas
// ============================================================
// Notificaciones simples dentro de la app (no push): se crean desde el
// propio backend (ej. al registrar una novedad de revisión) y el técnico/
// supervisor las ve en una campanita con contador dentro de su menú.
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const router = express.Router();

/** Crear una notificación para un usuario — usado por otras rutas (ej. revisiones.js) */
async function crearNotificacion(usuarioId, tipo, titulo, mensaje, formularioId) {
  if (!usuarioId) return;
  try {
    await db.query(
      `INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, formulario_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [usuarioId, tipo, titulo, mensaje || null, formularioId || null]
    );
  } catch (error) {
    console.error('[Notificaciones] Error creando notificación:', error.message);
  }
}

// GET /api/notificaciones — Listado del usuario autenticado (más recientes primero)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const notificaciones = await db.queryAll(
      `SELECT id, tipo, titulo, mensaje, formulario_id, leida, created_at
       FROM notificaciones
       WHERE usuario_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.user.id]
    );
    res.json({ estado: 'ok', notificaciones });
  } catch (error) {
    console.error('[Notificaciones] Error al listar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener notificaciones' });
  }
});

// GET /api/notificaciones/no-leidas/count — Contador para el badge
router.get('/no-leidas/count', authenticateToken, async (req, res) => {
  try {
    const row = await db.queryOne(
      `SELECT COUNT(*)::int AS total FROM notificaciones WHERE usuario_id = $1 AND leida = FALSE`,
      [req.user.id]
    );
    res.json({ estado: 'ok', total: row?.total || 0 });
  } catch (error) {
    console.error('[Notificaciones] Error al contar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al contar notificaciones' });
  }
});

// POST /api/notificaciones/:id/leer — Marcar una como leída
router.post('/:id/leer', authenticateToken, async (req, res) => {
  try {
    await db.query(
      `UPDATE notificaciones SET leida = TRUE WHERE id = $1 AND usuario_id = $2`,
      [req.params.id, req.user.id]
    );
    res.json({ estado: 'ok' });
  } catch (error) {
    console.error('[Notificaciones] Error al marcar leída:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al marcar como leída' });
  }
});

// POST /api/notificaciones/leer-todas — Marcar todas como leídas
router.post('/leer-todas', authenticateToken, async (req, res) => {
  try {
    await db.query(
      `UPDATE notificaciones SET leida = TRUE WHERE usuario_id = $1 AND leida = FALSE`,
      [req.user.id]
    );
    res.json({ estado: 'ok' });
  } catch (error) {
    console.error('[Notificaciones] Error al marcar todas leídas:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al marcar todas como leídas' });
  }
});

module.exports = router;
module.exports.crearNotificacion = crearNotificacion;
