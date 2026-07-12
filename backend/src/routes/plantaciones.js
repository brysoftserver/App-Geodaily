// ============================================================
// Plantaciones Routes — Sync + CRUD de plantaciones en mapa
// Persistencia: PostgreSQL
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const router = express.Router();

// POST /api/plantaciones/sync — Recibir plantaciones del técnico
router.post('/sync', authenticateToken, async (req, res) => {
  try {
    const { plantaciones } = req.body;
    if (!Array.isArray(plantaciones)) {
      return res.status(400).json({ estado: 'error', mensaje: 'Se requiere un arreglo de plantaciones' });
    }

    let sincronizadas = 0;
    for (const p of plantaciones) {
      const id = p.id || `plant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await db.query(
        `INSERT INTO plantaciones (id, usuario_id, formulario_id, especie, cantidad, latitud, longitud, altitud, metadata_json, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           cantidad = EXCLUDED.cantidad,
           metadata_json = EXCLUDED.metadata_json,
           timestamp = EXCLUDED.timestamp`,
        [
          id,
          p.usuario_id || req.user.id,
          p.formulario_id || null,
          p.especie || 'Desconocida',
          p.cantidad || 1,
          p.latitud || 0,
          p.longitud || 0,
          p.altitud || null,
          JSON.stringify(p.metadata_json || p.datos || {}),
          p.timestamp || p.timestamp_dispositivo || new Date().toISOString(),
        ]
      );
      sincronizadas++;
    }

    console.log(`[Plantaciones] ${sincronizadas} plantaciones sincronizadas por ${req.user.usuario}`);
    res.json({
      estado: 'ok',
      mensaje: `${sincronizadas} plantaciones sincronizadas`,
      sincronizadas,
    });
  } catch (error) {
    console.error('[Plantaciones] Error en sync:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al sincronizar plantaciones' });
  }
});

// GET /api/plantaciones — Obtener todas las plantaciones
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { rol, id: usuario_id } = req.user;
    let sql = `
      SELECT p.id, p.usuario_id, p.formulario_id, p.especie, p.cantidad,
        p.latitud, p.longitud, p.altitud, p.metadata_json, p.timestamp, p.sincronizado, p.created_at,
        u.nombre AS usuario_nombre
      FROM plantaciones p
      JOIN usuarios u ON u.id = p.usuario_id
    `;
    const params = [];

    if (rol === 'tecnico') {
      sql += ' WHERE p.usuario_id = $1';
      params.push(usuario_id);
    }

    sql += ' ORDER BY p.created_at DESC';

    const lista = await db.queryAll(sql, params);

    res.json({
      estado: 'ok',
      total: lista.length,
      plantaciones: lista,
    });
  } catch (error) {
    console.error('[Plantaciones] Error al listar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener plantaciones' });
  }
});

// DELETE /api/plantaciones/:id — Solo admin puede eliminar
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.rol !== 'admin') {
      return res.status(403).json({ estado: 'error', mensaje: 'Solo administradores pueden eliminar plantaciones' });
    }

    const result = await db.remove('plantaciones', 'id', req.params.id);
    if (!result) {
      return res.status(404).json({ estado: 'error', mensaje: 'Plantación no encontrada' });
    }

    await db.query(
      'INSERT INTO actividad_log (usuario_id, accion, detalle_json) VALUES ($1, $2, $3)',
      [req.user.id, 'eliminar_plantacion', JSON.stringify({ plantacion_id: req.params.id })]
    );

    console.log(`[Plantaciones] Eliminada: ${req.params.id} por admin ${req.user.usuario}`);
    res.json({ estado: 'ok', mensaje: 'Plantación eliminada correctamente' });
  } catch (error) {
    console.error('[Plantaciones] Error al eliminar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar plantación' });
  }
});

// GET /api/plantaciones/resumen — Resumen agrupado por especie
router.get('/resumen', authenticateToken, async (req, res) => {
  try {
    const resumen = await db.queryAll(`
      SELECT COALESCE(NULLIF(especie, ''), 'Desconocida') AS especie,
        SUM(cantidad) AS total, COUNT(*) AS conteo
      FROM plantaciones
      GROUP BY especie
      ORDER BY total DESC
    `);

    res.json({
      estado: 'ok',
      resumen,
    });
  } catch (error) {
    console.error('[Plantaciones] Error en resumen:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener resumen' });
  }
});

module.exports = router;
