// ============================================================
// Mediciones Routes — Sync + CRUD de mediciones de terreno
// Persistencia: PostgreSQL
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const router = express.Router();

// POST /api/mediciones/sync — Recibir mediciones del técnico
router.post('/sync', authenticateToken, async (req, res) => {
  try {
    const { mediciones } = req.body;
    if (!Array.isArray(mediciones)) {
      return res.status(400).json({ estado: 'error', mensaje: 'Se requiere un arreglo de mediciones' });
    }

    let sincronizadas = 0;
    for (const m of mediciones) {
      const id = m.id || `med-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await db.query(
        `INSERT INTO mediciones (id, usuario_id, formulario_id, tipo_medicion, valor, unidad, latitud, longitud, metadata_json, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           valor = EXCLUDED.valor,
           metadata_json = EXCLUDED.metadata_json,
           timestamp = EXCLUDED.timestamp`,
        [
          id,
          m.usuario_id || req.user.id,
          m.formulario_id || null,
          m.tipo_medicion || m.tipo || 'general',
          m.valor || 0,
          m.unidad || '',
          m.latitud || null,
          m.longitud || null,
          JSON.stringify(m.metadata_json || m.datos || {}),
          m.timestamp || m.timestamp_dispositivo || new Date().toISOString(),
        ]
      );
      sincronizadas++;
    }

    console.log(`[Mediciones] ${sincronizadas} mediciones sincronizadas por ${req.user.usuario}`);
    res.json({
      estado: 'ok',
      mensaje: `${sincronizadas} mediciones sincronizadas`,
      sincronizadas,
    });
  } catch (error) {
    console.error('[Mediciones] Error en sync:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al sincronizar mediciones' });
  }
});

// GET /api/mediciones — Obtener todas las mediciones
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { rol, id: usuario_id } = req.user;
    let sql = `
      SELECT m.id, m.usuario_id, m.formulario_id, m.tipo_medicion, m.valor,
        m.unidad, m.latitud, m.longitud, m.metadata_json, m.timestamp, m.sincronizado, m.created_at,
        u.nombre AS usuario_nombre
      FROM mediciones m
      JOIN usuarios u ON u.id = m.usuario_id
    `;
    const params = [];

    if (rol === 'tecnico') {
      sql += ' WHERE m.usuario_id = $1';
      params.push(usuario_id);
    }

    sql += ' ORDER BY m.created_at DESC';

    const lista = await db.queryAll(sql, params);

    res.json({
      estado: 'ok',
      total: lista.length,
      mediciones: lista,
    });
  } catch (error) {
    console.error('[Mediciones] Error al listar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener mediciones' });
  }
});

// DELETE /api/mediciones/:id — Solo admin puede eliminar
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.rol !== 'admin') {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo administradores pueden eliminar mediciones' });
    }

    const result = await db.remove('mediciones', 'id', req.params.id);
    if (!result) {
      return res.status(404).json({ estado: 'error', mensaje: 'Medición no encontrada' });
    }

    await db.query(
      'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
      [req.user.id, 'eliminar_medicion', JSON.stringify({ medicion_id: req.params.id })]
    );

    console.log(`[Mediciones] Eliminada: ${req.params.id} por admin ${req.user.usuario}`);
    res.json({ estado: 'ok', mensaje: 'Medición eliminada correctamente' });
  } catch (error) {
    console.error('[Mediciones] Error al eliminar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar medición' });
  }
});

module.exports = router;
