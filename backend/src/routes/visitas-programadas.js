// ============================================================
// Visitas Programadas Routes — Sync + CRUD de visitas planificadas
// Compartidas entre todo el equipo (técnico → roles superiores)
// Persistencia: PostgreSQL
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const router = express.Router();

// POST /api/visitas-programadas/sync — Recibir visitas programadas del técnico
router.post('/sync', authenticateToken, async (req, res) => {
  try {
    const { visitas } = req.body;
    if (!Array.isArray(visitas)) {
      return res.status(400).json({ estado: 'error', mensaje: 'Se requiere un arreglo de visitas' });
    }

    let sincronizadas = 0;
    for (const v of visitas) {
      const id = v.id || `visita-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await db.query(
        `INSERT INTO visitas_programadas (id, usuario_id, titulo, ubicacion, fecha, estado, timestamp_dispositivo)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           titulo = EXCLUDED.titulo,
           ubicacion = EXCLUDED.ubicacion,
           fecha = EXCLUDED.fecha,
           estado = EXCLUDED.estado`,
        [
          id,
          v.usuario_id || req.user.id,
          v.titulo || '',
          v.ubicacion || '',
          v.fecha,
          v.estado || 'pendiente',
          v.timestamp_dispositivo || new Date().toISOString(),
        ]
      );
      sincronizadas++;
    }

    console.log(`[VisitasProgramadas] ${sincronizadas} visita(s) sincronizada(s) por ${req.user.usuario}`);
    res.json({
      estado: 'ok',
      mensaje: `${sincronizadas} visita(s) sincronizada(s)`,
      sincronizadas,
    });
  } catch (error) {
    console.error('[VisitasProgramadas] Error en sync:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al sincronizar visitas programadas' });
  }
});

// GET /api/visitas-programadas — Listar. El calendario es universal: todos
// los roles, incluido técnico, ven TODAS las visitas planificadas por
// cualquier técnico — no solo las propias.
router.get('/', authenticateToken, async (req, res) => {
  try {
    const sql = `
      SELECT vp.id, vp.usuario_id, vp.titulo, vp.ubicacion, vp.fecha, vp.estado, vp.created_at,
        u.nombre AS usuario_nombre
      FROM visitas_programadas vp
      JOIN usuarios u ON u.id = vp.usuario_id
      ORDER BY vp.fecha ASC
    `;

    const lista = await db.queryAll(sql, []);

    res.json({
      estado: 'ok',
      total: lista.length,
      visitas: lista,
    });
  } catch (error) {
    console.error('[VisitasProgramadas] Error al listar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al obtener visitas programadas' });
  }
});

// DELETE /api/visitas-programadas/:id — El dueño o un admin puede eliminar
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const existente = await db.queryOne('SELECT usuario_id FROM visitas_programadas WHERE id = $1', [req.params.id]);
    if (!existente) {
      return res.status(404).json({ estado: 'error', mensaje: 'Visita programada no encontrada' });
    }
    if (req.user.rol !== 'admin' && existente.usuario_id !== req.user.id) {
      return res.status(403).json({ estado: 'error', mensaje: 'No autorizado' });
    }

    await db.remove('visitas_programadas', 'id', req.params.id);

    console.log(`[VisitasProgramadas] Eliminada: ${req.params.id} por ${req.user.usuario}`);
    res.json({ estado: 'ok', mensaje: 'Visita programada eliminada correctamente' });
  } catch (error) {
    console.error('[VisitasProgramadas] Error al eliminar:', error);
    res.status(500).json({ estado: 'error', mensaje: 'Error al eliminar visita programada' });
  }
});

module.exports = router;
