// ============================================================
// Tracking Routes — Sync de posiciones GPS de técnicos
// Persistencia: PostgreSQL
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const router = express.Router();

// POST /api/tracking/sync — Recibir posiciones del técnico
router.post('/sync', authenticateToken, async (req, res) => {
  try {
    const { posiciones } = req.body;
    if (!Array.isArray(posiciones)) {
      return res.status(400).json({ estado: 'error', mensaje: 'Se requiere un arreglo de posiciones' });
    }

    let sincronizadas = 0;
    for (const p of posiciones) {
      await db.query(
        `INSERT INTO tracking (usuario_id, latitud, longitud, altitud, precision_metros,
          velocidad, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          p.usuario_id || req.user.id,
          p.latitud,
          p.longitud,
          p.altitud || null,
          p.precision_metros || p.precision_gps || p.precision || null,
          p.velocidad || null,
          p.timestamp || p.timestamp_dispositivo || new Date().toISOString(),
        ]
      );
      sincronizadas++;
    }

    console.log(`[Tracking] ${sincronizadas} posiciones sincronizadas por ${req.user.usuario}`);
    res.json({
      estado: 'ok',
      mensaje: `${sincronizadas} posiciones sincronizadas`,
      sincronizadas,
    });
  } catch (error) {
    console.error('[Tracking] Error en sync:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al sincronizar posiciones' });
  }
});

// GET /api/tracking/ultimas — Última posición de cada técnico
router.get('/ultimas', authenticateToken, async (req, res) => {
  try {
    const posiciones = await db.queryAll(`
      SELECT DISTINCT ON (t.usuario_id)
        t.id, t.usuario_id, t.latitud, t.longitud, t.altitud,
        t.precision_metros, t.velocidad, t.timestamp, t.created_at,
        u.nombre AS usuario_nombre, u.usuario AS usuario_login
      FROM tracking t
      JOIN usuarios u ON u.id = t.usuario_id
      ORDER BY t.usuario_id, t.created_at DESC
    `);

    res.json({
      estado: 'ok',
      total: posiciones.length,
      posiciones,
    });
  } catch (error) {
    console.error('[Tracking] Error al obtener últimas:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener posiciones' });
  }
});

// GET /api/tracking/historial/:usuarioId — Historial de un técnico
router.get('/historial/:usuarioId', authenticateToken, async (req, res) => {
  try {
    const { usuarioId } = req.params;

    // Verificar permisos: técnico solo ve su propio historial
    if (req.user.rol === 'tecnico' && req.user.id !== usuarioId) {
      return res.status(403).json({ estado: 'error', mensaje: 'No tienes permiso para ver este historial' });
    }

    const posiciones = await db.queryAll(
      `SELECT t.*, u.nombre AS usuario_nombre
       FROM tracking t
       JOIN usuarios u ON u.id = t.usuario_id
       WHERE t.usuario_id = $1
       ORDER BY t.created_at ASC`,
      [usuarioId]
    );

    res.json({
      estado: 'ok',
      total: posiciones.length,
      posiciones,
    });
  } catch (error) {
    console.error('[Tracking] Error al obtener historial:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener historial' });
  }
});

module.exports = router;
